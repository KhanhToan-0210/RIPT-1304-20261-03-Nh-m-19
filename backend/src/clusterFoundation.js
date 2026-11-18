const { createControlPool } = require('./config/controlDb');
const { createClusterReader, WRITE_PROTOCOL, clusterError } = require('./services/clusterState');
const { createWriteGuard, unavailable } = require('./middleware/writeGuard');

function clusterConfig(env) {
    const enabled = Boolean(env.CLUSTER_MODE || env.CLUSTER_NAMESPACE ||
        env.CONTROL_DB_HOST || /^shoponline_check_c2a_/.test(env.DB_NAME || '') ||
        /^c2a-/.test(env.NODE_NAME || ''));
    return {
        enabled,
        valid: ['c2a', 'c2'].includes(env.CLUSTER_MODE) && env.APP_ENV === 'test' &&
            env.CLUSTER_NAMESPACE === 'shoponline-c2a-20261118' &&
            ['A', 'B'].includes(env.CLUSTER_NODE) &&
            env.NODE_NAME === (env.CLUSTER_NODE === 'A' ? 'c2a-primary' : 'c2a-standby') &&
            /^shoponline_check_c2a_[a-z0-9_]+$/.test(env.DB_NAME || '') &&
            env.CONTROL_DB_NAME === 'shoponline_control_c2a' &&
            Boolean(env.CONTROL_DB_HOST && env.CONTROL_DB_USER && env.CONTROL_DB_PASSWORD) &&
            (env.CLUSTER_MODE !== 'c2' || Boolean(env.DB_USER && /^\d+$/.test(env.CLUSTER_EPOCH || ''))),
        mode: env.CLUSTER_MODE,
        namespace: env.CLUSTER_NAMESPACE,
        node: env.CLUSTER_NODE,
        nodeName: env.NODE_NAME,
        database: env.DB_NAME,
        username: env.DB_USER,
        epoch: String(env.CLUSTER_EPOCH || '0')
    };
}

function installClusterFoundation(app, { dataPool, env, controlPool }) {
    const config = clusterConfig(env);
    if (!config.enabled) return null;
    const coordinator = controlPool || (config.valid ? createControlPool(env) : null);
    const reader = createClusterReader({ controlPool: coordinator, dataPool, config });
    app.use(createWriteGuard({ readState: reader.readState, config }));

    app.get('/live', (req, res) => res.json({
        status: 'alive', environment: env.APP_ENV, node: config.nodeName
    }));
    app.get('/health', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!config.valid) return unavailable(res, 'CLUSTER_CONFIGURATION_INVALID');
        try {
            const database = await reader.readIdentity();
            return res.json({
                status: 'ok', environment: 'test', node: config.nodeName,
                namespace: config.namespace, database
            });
        } catch (error) {
            return unavailable(res, error.clusterCode || 'DATABASE_UNAVAILABLE');
        }
    });
    app.get('/cluster/status', async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!config.valid) return unavailable(res, 'CLUSTER_CONFIGURATION_INVALID');
        try {
            return res.json(await reader.readState());
        } catch (error) {
            return unavailable(res, error.clusterCode || 'COORDINATOR_UNAVAILABLE');
        }
    });
    async function readiness(intent = 'active', transitionId) {
        const candidate = ['candidate', 'promotion'].includes(intent);
        if (!config.valid || config.mode !== 'c2') throw clusterError('WRITE_ACTIVATION_REQUIRED');
        const state = await reader.readState();
        const database = await reader.readIdentity();
        const binding = state.nodes[config.node];
        if (state.protocol !== WRITE_PROTOCOL || binding.database !== database.databaseName ||
            binding.serverUuid !== database.serverUuid || binding.nodeId !== config.nodeName ||
            String(binding.epoch) !== config.epoch || database.gate.epoch !== config.epoch ||
            binding.username !== config.username || binding.manifestId !== database.gate.manifestId) {
            throw clusterError('DATABASE_BINDING_INVALID');
        }
        const [tables] = await dataPool.query({ sql: `SELECT TABLE_NAME AS name FROM information_schema.TABLES
            WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME`, timeout: 1000 });
        const required = ['products', 'orders', 'order_items', 'runtime_write_gate', 'runtime_write_receipts'];
        if (!required.every(name => tables.some(table => table.name === name))) throw clusterError('SCHEMA_MISMATCH');
        const [[verification]] = await coordinator.query({ sql: `SELECT * FROM snapshot_verifications
            WHERE namespace=? AND node_id=?`, values: [config.namespace, config.node], timeout: 1000 });
        if (!verification || Number(verification.verified) !== 1 || verification.database_name !== database.databaseName ||
            verification.server_uuid !== database.serverUuid || verification.manifest_id !== binding.manifestId) {
            throw clusterError('SNAPSHOT_UNVERIFIED');
        }
        if (candidate) {
            const sealed = intent === 'candidate';
            if (state.state !== 'MAINTENANCE' || state.activeWriter !== null || state.transitionId !== transitionId ||
                database.gate.enabled === sealed || database.readOnly !== sealed || database.superReadOnly !== sealed ||
                Number(verification.sealed) !== Number(sealed) ||
                (intent === 'promotion' && (state.nodes.gateway?.stage !== 'armed' || state.nodes.gateway?.target !== config.node))) {
                throw clusterError('CANDIDATE_NOT_SEALED');
            }
        } else if (state.activeWriter !== config.node || state.state === 'MAINTENANCE' || !state.activationComplete ||
            state.epoch !== config.epoch || !database.gate.enabled || database.readOnly || database.superReadOnly) {
            throw clusterError('NODE_INACTIVE');
        }
        return { status: candidate ? 'candidate_ready' : 'ready', environment: 'test', node: config.nodeName,
            nodeId: config.node, epoch: state.epoch, generation: state.gatewayGeneration, state: state.state,
            database, manifestId: binding.manifestId };
    }
    app.get('/ready', async (req, res) => {
        try { return res.json(await readiness(req.query.intent || 'active', req.query.transition_id)); }
        catch (error) { return unavailable(res, error.clusterCode || 'READINESS_UNAVAILABLE'); }
    });
    app.get('/api/write-status/:key', async (req, res) => {
        try {
            await readiness();
            const [[receipt]] = await dataPool.query('SELECT * FROM runtime_write_receipts WHERE namespace=? AND request_key=?',
                [config.namespace, req.params.key]);
            return res.json(receipt?.state === 'COMMITTED'
                ? { outcome: 'COMMITTED', requestKey: req.params.key, status: receipt.response_status, response: receipt.response_body }
                : { outcome: 'UNKNOWN', requestKey: req.params.key });
        } catch (error) { return unavailable(res, error.clusterCode || 'OUTCOME_UNAVAILABLE'); }
    });
    app.use('/api', async (req, res, next) => {
        if (!config.valid) return unavailable(res, 'CLUSTER_CONFIGURATION_INVALID');
        try {
            if (config.mode !== 'c2') { await reader.readState(); return unavailable(res, 'MAINTENANCE'); }
            const status = await readiness();
            if (req.get('X-ShopOnline-Gateway') === '1' &&
                req.get('X-ShopOnline-Gateway-Generation') !== status.generation) return unavailable(res, 'STALE_GATEWAY_GENERATION');
            res.set('X-ShopOnline-Node', config.node);
            res.set('X-ShopOnline-Epoch', config.epoch);
            return next();
        } catch (error) {
            return unavailable(res, error.clusterCode || 'COORDINATOR_UNAVAILABLE');
        }
    });
    return { config, reader, controlPool: coordinator };
}

module.exports = { clusterConfig, installClusterFoundation };
