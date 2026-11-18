const { createHash } = require('node:crypto');
const { validateState, WRITE_PROTOCOL, clusterError } = require('./clusterState');
const { createContext, runWithTransaction } = require('./requestTransaction');

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    }
    return value;
}

function payloadHash(req) {
    return createHash('sha256').update(JSON.stringify([req.method, req.originalUrl, canonical(req.body ?? null)])).digest('hex');
}

function acquire(pool, deadline) {
    return new Promise((resolve, reject) => {
        let expired = false;
        const timer = setTimeout(() => {
            expired = true;
            reject(clusterError('ADMISSION_TIMEOUT'));
        }, Math.max(1, deadline - Date.now()));
        pool.getConnection().then(connection => {
            clearTimeout(timer);
            if (expired) connection.release();
            else resolve(connection);
        }, error => { clearTimeout(timer); reject(error); });
    });
}

function checkPermission(state, config, identity, gate) {
    const binding = state.nodes[config.node];
    if (state.protocol !== WRITE_PROTOCOL || !state.activationComplete || state.activeWriter !== config.node ||
        state.state === 'MAINTENANCE' || state.epoch !== config.epoch) throw clusterError('NODE_INACTIVE');
    if (binding.nodeId !== config.nodeName || binding.database !== config.database ||
        binding.serverUuid !== identity.serverUuid || binding.username !== config.username ||
        String(binding.epoch) !== config.epoch || identity.databaseName !== config.database ||
        gate?.namespace !== config.namespace || gate.node_id !== config.node ||
        gate.database_name !== config.database || gate.server_uuid !== identity.serverUuid ||
        String(gate.epoch) !== config.epoch || Number(gate.enabled) !== 1 ||
        gate.manifest_id !== binding.manifestId || Number(identity.readOnly) !== 0 ||
        Number(identity.superReadOnly) !== 0) throw clusterError('DATABASE_BINDING_INVALID');
}

function transactionMiddleware({ controlPool, dataPool, config }) {
    return async (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        const key = req.get('Idempotency-Key');
        if (!/^[a-zA-Z0-9._:-]{8,128}$/.test(key || '')) {
            return res.status(428).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Yêu cầu cần mã giao dịch để tránh ghi trùng.' });
        }
        if (req.originalUrl.length > 512) return res.status(414).json({ success: false, code: 'REQUEST_PATH_TOO_LONG' });
        const hash = payloadHash(req);
        const deadline = Date.now() + 5000;
        let control;
        let connection;
        let context;
        try {
            control = await acquire(controlPool, deadline);
            const query = (connection, sql, values) => connection.query({ sql, values, timeout: Math.max(1, deadline - Date.now()) });
            await query(control, 'START TRANSACTION');
            const [rows] = await query(control, 'SELECT * FROM cluster_state WHERE namespace=? FOR SHARE', [config.namespace]);
            const state = validateState(rows.length === 1 ? rows[0] : null, config.namespace);
            if (state.activeWriter !== config.node || state.epoch !== config.epoch || state.protocol !== WRITE_PROTOCOL) {
                throw clusterError('NODE_INACTIVE');
            }
            if (req.get('X-ShopOnline-Gateway') === '1' &&
                req.get('X-ShopOnline-Gateway-Generation') !== state.gatewayGeneration) throw clusterError('STALE_GATEWAY_GENERATION');
            connection = await acquire(dataPool, deadline);
            await query(connection, 'START TRANSACTION');
            const [[identity]] = await query(connection, `SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid,
                @@GLOBAL.read_only AS readOnly, @@GLOBAL.super_read_only AS superReadOnly`);
            const [gates] = await query(connection, 'SELECT * FROM runtime_write_gate WHERE singleton_id=1 FOR SHARE');
            checkPermission(state, config, identity, gates.length === 1 ? gates[0] : null);
            await query(control, 'COMMIT');
            control.release();
            control = null;
            context = createContext(connection, Date.now() + 30000);
            try {
                await context.facade.query(`INSERT INTO runtime_write_receipts
                    (namespace,request_key,payload_sha256,node_id,epoch,method,request_path,state)
                    VALUES (?,?,?,?,?,?,?,'RESERVED')`,
                [config.namespace, key, hash, config.node, config.epoch, req.method, req.originalUrl]);
            } catch (error) {
                if (error.code !== 'ER_DUP_ENTRY') throw error;
                const [[receipt]] = await context.facade.query(
                    'SELECT * FROM runtime_write_receipts WHERE namespace=? AND request_key=? FOR SHARE', [config.namespace, key]);
                await connection.rollback();
                connection.release();
                connection = null;
                if (!receipt || receipt.state !== 'COMMITTED') throw clusterError('COMMIT_OUTCOME_UNKNOWN');
                if (receipt.payload_sha256 !== hash) return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'Mã giao dịch đã được dùng cho nội dung khác.' });
                const body = typeof receipt.response_body === 'string' ? JSON.parse(receipt.response_body) : receipt.response_body;
                return res.status(receipt.response_status).set('Idempotency-Replayed', 'true').json(body);
            }
        } catch (error) {
            if (control) { control.destroy(); control = null; }
            if (connection) { connection.destroy(); connection = null; }
            return res.status(503).json({ success: false, code: error.clusterCode || 'WRITE_ADMISSION_UNAVAILABLE', requestKey: key,
                message: 'Chưa thể xác nhận quyền ghi. Hãy giữ nguyên mã giao dịch khi thử lại.' });
        }

        const originalJson = res.json.bind(res);
        let finalizing = false;
        const timer = setTimeout(() => cancel('TRANSACTION_TIMEOUT', true), 30000);
        function cancel(code, respond) {
            if (context.completed || context.cancelled) return;
            context.cancelled = true;
            clearTimeout(timer);
            connection.destroy();
            if (respond && !res.headersSent && !res.destroyed) {
                originalJson.call(res.status(503), { success: false, code, requestKey: key,
                    message: 'Kết quả đang được xác minh. Hãy giữ nguyên mã giao dịch.' });
            }
        }
        req.once('aborted', () => cancel('REQUEST_ABORTED', false));
        res.once('close', () => { if (!context.completed) cancel('REQUEST_ABORTED', false); });
        res.json = body => {
            if (finalizing || context.cancelled || context.completed) return res;
            const status = res.statusCode;
            const serialized = JSON.stringify(body);
            finalizing = true;
            context.closing = true;
            (async () => {
                let committing = false;
                try {
                    if (status >= 400 || context.rollbackOnly) {
                        await connection.rollback();
                    } else {
                        await connection.query({ sql: `UPDATE runtime_write_receipts SET state='COMMITTED', response_status=?, response_body=?
                            WHERE namespace=? AND request_key=?`, values: [status, serialized, config.namespace, key],
                            timeout: Math.max(1, Math.min(15000, context.deadline - Date.now())) });
                        committing = true;
                        await connection.commit();
                    }
                    context.completed = true;
                    clearTimeout(timer);
                    connection.release();
                    if (!res.destroyed && !res.headersSent) originalJson(JSON.parse(serialized));
                } catch (error) {
                    context.completed = true;
                    clearTimeout(timer);
                    connection.destroy();
                    if (!res.destroyed && !res.headersSent) {
                        res.status(503);
                        originalJson({ success: false, code: committing ? 'COMMIT_OUTCOME_UNKNOWN' : 'WRITE_ABORTED', requestKey: key,
                            message: 'Hãy kiểm tra kết quả bằng mã giao dịch trước khi gửi lại.' });
                    }
                }
            })();
            return res;
        };
        runWithTransaction(context, next);
    };
}

module.exports = { canonical, payloadHash, acquire, checkPermission, transactionMiddleware };
