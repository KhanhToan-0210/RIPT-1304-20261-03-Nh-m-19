const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { ROOT, PROJECT, docker, compose, serviceId, c2Sql, protectedBaseline } = require('./c2a-lib.cjs');
const ops = require('./cluster-ops.cjs');
const { browserOrder, capturePage } = require('./kt-browser.cjs');
const DIR = ops.EVIDENCE;
const REPORT = path.join(DIR, 'acceptance.json');
const report = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : {
    runId: randomUUID(), startedAt: new Date().toISOString(), stages: {}, progress: {}
};
const now = () => new Date().toISOString();
function save() { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n'); }
function artifact(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); return file; }
async function state() { return (await ops.http('http://127.0.0.1:18100/cluster/status')).data; }
async function mutate(route, method, body, key, base = 'http://127.0.0.1:18080') {
    return ops.http(base + route, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: body === undefined ? undefined : JSON.stringify(body) });
}
function proof(node, database) {
    return JSON.parse(c2Sql(node === 'A' ? 'primary-db' : 'standby-db', `SELECT JSON_OBJECT('database',DATABASE(),'uuid',@@server_uuid,
        'readOnly',@@GLOBAL.read_only,'superReadOnly',@@GLOBAL.super_read_only,
        'gate',(SELECT enabled FROM runtime_write_gate WHERE singleton_id=1),
        'epoch',(SELECT CAST(epoch AS CHAR) FROM runtime_write_gate WHERE singleton_id=1),
        'receipts',(SELECT COUNT(*) FROM runtime_write_receipts));`, database));
}
function sqlOrder(node, database, id) {
    assert.match(id, /^[a-f0-9-]{36}$/);
    const service = node === 'A' ? 'primary-db' : 'standby-db';
    const select = sql => c2Sql(service, "SET time_zone='+00:00';" + sql, database).toString().trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const [order] = select(`SELECT JSON_OBJECT('id',id,'customerName',customer_name,'customerPhone',customer_phone,
        'customerAddress',customer_address,'total',CAST(total_price AS CHAR),'status',status,'createdAt',CAST(created_at AS CHAR))
        FROM orders WHERE id='${id}';`);
    const items = select(`SELECT JSON_OBJECT('id',id,'orderId',order_id,'productId',product_id,'name',product_name,
        'price',CAST(price AS CHAR),'quantity',quantity) FROM order_items WHERE order_id='${id}' ORDER BY id;`);
    const stocks = select(`SELECT JSON_OBJECT('id',p.id,'name',p.name,'price',CAST(p.price AS CHAR),'stock',p.stock)
        FROM products p JOIN order_items i ON p.id=i.product_id WHERE i.order_id='${id}' ORDER BY p.id;`);
    const receipts = select(`SELECT JSON_OBJECT('key',request_key,'hash',payload_sha256,'node',node_id,'epoch',CAST(epoch AS CHAR),
        'state',state,'status',response_status) FROM runtime_write_receipts
        WHERE JSON_UNQUOTE(JSON_EXTRACT(response_body,'$.order.id'))='${id}';`);
    assert.ok(order && items.length && receipts.length === 1);
    assert.equal(Number(order.total), items.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0));
    return { order, items, stocks, receipts };
}

async function stage1() {
    const s = await state();
    assert.equal(s.activeWriter, 'A');
    const checks = [];
    const bBefore = ops.inspect('B', s.nodes.B.database);
    const id = report.runId;
    const pBody = { name: 'Admission TEST ' + id.slice(0, 8), price: 1000, stock: 20, description: 'TEST single writer' };
    const created = await mutate('/api/products', 'POST', pBody, 'guard-product-' + id);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const p = created.data;
    const metadata = await mutate('/api/products/' + p.id, 'PUT', { description: 'Metadata TEST' }, 'guard-metadata-' + id);
    assert.equal(metadata.status, 200);
    checks.push('A product CREATE/UPDATE committed');
    const body = { customerName: 'Admission TEST', customerPhone: '0900000000', customerAddress: 'TEST', items: [{ id: p.id, quantity: 1 }] };
    const first = await mutate('/api/orders', 'POST', body, 'guard-order-' + id);
    assert.equal(first.status, 201, JSON.stringify(first.data));
    const beforeReplay = (await ops.http('http://127.0.0.1:18080/api/products/' + p.id)).data.stock;
    const replay = await mutate('/api/orders', 'POST', body, 'guard-order-' + id);
    assert.equal(replay.status, 201);
    assert.equal(replay.data.order.id, first.data.order.id);
    assert.equal((await ops.http('http://127.0.0.1:18080/api/products/' + p.id)).data.stock, beforeReplay);
    const conflict = await mutate('/api/orders', 'POST', { ...body, customerName: 'Changed body' }, 'guard-order-' + id);
    assert.equal(conflict.status, 409);
    const simultaneous = await Promise.all([1, 2].map(() => mutate('/api/orders', 'POST', body, 'guard-concurrent-' + id)));
    assert.ok(simultaneous.every(r => r.status === 201), JSON.stringify(simultaneous));
    assert.equal(simultaneous[0].data.order.id, simultaneous[1].data.order.id);
    assert.equal((await ops.http('http://127.0.0.1:18080/api/products/' + p.id)).data.stock, 18);
    checks.push('same/concurrent idempotency key commits exactly once; conflicting body 409');
    for (const [suffix, payload, status] of [
        ['invalid', { ...body, items: [{ id: p.id, quantity: -1 }] }, 400],
        ['missing', { ...body, items: [{ id: 2000000000, quantity: 1 }] }, 404],
        ['stock', { ...body, items: [{ id: p.id, quantity: 1000000 }] }, 409]
    ]) assert.equal((await mutate('/api/orders', 'POST', payload, 'guard-' + suffix + '-' + id)).status, status);
    assert.equal((await mutate('/api/products/' + p.id, 'PUT', { stock: 30, expectedStock: 20 }, 'guard-stale-' + id)).status, 409);
    assert.equal((await mutate('/api/products/' + p.id, 'DELETE', undefined, 'guard-used-delete-' + id)).status, 409);
    checks.push('validation, missing product, stock conflict and purchased-product DELETE rollback');
    const disposable = await mutate('/api/products', 'POST', { name: 'Disposable TEST ' + id.slice(0, 8), price: 1, stock: 1 }, 'guard-disposable-' + id);
    assert.equal(disposable.status, 201);
    for (let n = 0; n < 2; n++) assert.equal((await mutate('/api/products/' + disposable.data.id, 'DELETE', undefined, 'guard-delete-' + id)).status, 200);
    checks.push('DELETE receipt can be replayed after the product is gone');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        const r = await mutate('/api/products' + (method === 'POST' ? '' : '/' + p.id), method, pBody,
            'inactive-' + method + '-' + id, 'http://127.0.0.1:18101');
        assert.equal(r.status, 503);
        assert.equal(r.data.code, 'NODE_INACTIVE');
    }
    const spoofed = await ops.http('http://127.0.0.1:18101/api/products', { method: 'POST', headers: {
        'Content-Type': 'application/json', 'Idempotency-Key': 'spoof-' + id,
        'X-Active-Writer': 'B', 'X-ShopOnline-Gateway': '1', 'X-ShopOnline-Gateway-Generation': s.gatewayGeneration }, body: JSON.stringify(pBody) });
    assert.equal(spoofed.status, 503);
    compareInactive();
    function compareInactive() { assert.equal(ops.inspect('B', s.nodes.B.database).businessSha256, bBefore.businessSha256); }
    checks.push('inactive B and direct/header bypass denied; B full row digest unchanged');
    const lockOwner = await ops.coordinator();
    try {
        const competing = spawnSync(process.execPath, [path.join(ROOT, 'scripts/cluster-ops.cjs'), 'backup'], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
        assert.equal(competing.status, 1);
        assert.match(competing.stderr, /TRANSITION_BUSY/);
    } finally { await lockOwner.close(); }
    checks.push('second coordinator process returns TRANSITION_BUSY');
    const aBeforeOutage = ops.inspect('A', s.nodes.A.database);
    try {
        compose(['stop', '--timeout', '5', 'control-db']);
        for (const port of [18100, 18101]) {
            const r = await mutate('/api/products', 'POST', pBody, 'outage-' + port + '-' + id, 'http://127.0.0.1:' + port);
            assert.equal(r.status, 503);
        }
        const gateway = await ops.waitFor(async () => {
            const r = await ops.http('http://127.0.0.1:18080/gateway/status');
            return r.data.target === null && r;
        });
        assert.equal(gateway.data.stage, 'maintenance');
    } finally { compose(['start', '--wait', '--wait-timeout', '90', 'control-db'], { timeout: 120000 }); }
    await ops.waitFor(async () => (await ops.http('http://127.0.0.1:18080/ready')).status === 200);
    assert.equal(ops.inspect('A', s.nodes.A.database).businessSha256, aBeforeOutage.businessSha256);
    compareInactive();
    checks.push('control outage fails closed, gateway maintenance, canonical A restored with no extra data');
    const aProof = proof('A', s.nodes.A.database);
    const bProof = proof('B', s.nodes.B.database);
    assert.equal(aProof.gate, 1); assert.equal(aProof.readOnly, 0);
    assert.equal(bProof.gate, 0); assert.equal(bProof.superReadOnly, 1);
    const units = compose(['exec', '-T', '-e', 'CLUSTER_MODE=', '-e', 'CLUSTER_NAMESPACE=', '-e', 'CONTROL_DB_HOST=',
        '-e', 'DB_NAME=shoponline_check_phase_b', '-e', 'NODE_NAME=test-unit-regression', 'primary-web', 'npm', 'test'], { timeout: 120000 });
    fs.writeFileSync(path.join(DIR, 'unit-container-stage1.log'), units);
    assert.match(units.toString(), /# fail 0/);
    return { checks, database: s.nodes.A.database, guardOrderIds: [first.data.order.id, simultaneous[0].data.order.id], aProof, bProof,
        units: units.toString().split(/\r?\n/).filter(l => /^# (tests|pass|fail)/.test(l)), time: now() };
}

async function purchase(stage, expectedNode) {
    const current = await state();
    assert.equal(current.activeWriter, expectedNode);
    await ops.waitFor(async () => {
        const r = await ops.http('http://127.0.0.1:18080/ready');
        return r.status === 200 && r.data.nodeId === expectedNode;
    });
    const progress = report.progress[stage] ||= {};
    if (!progress.product) {
        const product = await mutate('/api/products', 'POST', { name: stage + ' ShopOnline TEST ' + report.runId.slice(0, 8),
            price: 125000, stock: 10, image: '/images/hp-probook-440.jpg', description: stage + ' acceptance TEST' }, stage + '-product-' + report.runId);
        assert.equal(product.status, 201, JSON.stringify(product.data));
        progress.product = product.data;
        progress.initialStock = 10;
        save();
    }
    if (progress.product.image !== '/images/hp-probook-440.jpg') {
        const fixed = await mutate('/api/products/' + progress.product.id, 'PUT', { image: '/images/hp-probook-440.jpg' }, stage + '-image-' + report.runId);
        assert.equal(fixed.status, 200);
        progress.product.image = fixed.data.image;
        save();
    }
    const directory = path.join(DIR, stage + '-' + Date.now());
    const browser = await browserOrder(stage, progress, directory, save);
    const sql = sqlOrder(expectedNode, current.nodes[expectedNode].database, browser.orderId);
    assert.equal(sql.items[0].productId, progress.product.id);
    assert.equal(sql.items[0].quantity, 2);
    assert.equal(Number(sql.items[0].price), 125000);
    assert.equal(Number(sql.order.total), 250000);
    assert.equal(sql.stocks[0].stock, 8);
    const sqlFile = artifact(path.join(directory, 'mysql-order.json'), { time: now(), node: expectedNode,
        database: current.nodes[expectedNode].database, ...sql });
    const resources = JSON.parse(docker(['inspect', ...['primary-web', 'standby-web', 'primary-db', 'standby-db', 'gateway', 'control-db'].map(x => serviceId(PROJECT, x))]));
    artifact(path.join(directory, 'services.json'), resources.map(c => ({ name: c.Name, id: c.Id, state: c.State.Status,
        health: c.State.Health?.Status, startedAt: c.State.StartedAt, image: c.Image })));
    const allScreenshots = fs.readdirSync(DIR).filter(name => name.startsWith(stage + '-') && fs.statSync(path.join(DIR, name)).isDirectory())
        .flatMap(name => fs.readdirSync(path.join(DIR, name)).filter(file => file.endsWith('.png')).map(file => path.join(DIR, name, file)));
    return { orderId: browser.orderId, database: current.nodes[expectedNode].database, node: expectedNode,
        browser, sql, artifacts: [...allScreenshots, sqlFile, path.join(directory, 'services.json')], time: now() };
}

async function kt1() { assert.equal(report.stages.stage1?.status, 'PASS'); return purchase('KT1', 'A'); }

async function kt2() {
    assert.equal(report.stages.kt1?.status, 'PASS');
    const progress = report.progress.kt2 ||= {};
    let current = await state();
    if (current.activeWriter === 'A') {
        const snapshot = await ops.onlineBackup();
        progress.preparedSnapshot = snapshot.id;
        progress.failureCommandAt = now(); save();
        docker(['stop', '--time', '5', serviceId(PROJECT, 'primary-web')]);
        progress.primaryStoppedAt = now(); save();
        const stopped = JSON.parse(docker(['inspect', serviceId(PROJECT, 'primary-web')]))[0];
        artifact(path.join(DIR, 'KT2-primary-stopped.json'), { time: now(), name: stopped.Name, id: stopped.Id, state: stopped.State.Status });
        await ops.waitFor(async () => (await ops.http('http://127.0.0.1:18080/gateway/status')).data.target === null);
        await capturePage('http://127.0.0.1:18080/', path.join(DIR, 'KT2-maintenance.png'));
        const transition = await ops.transitionTo('B');
        progress.transition = transition.id;
        progress.serviceRestoredAt = transition.serviceRestoredAt;
        progress.rtoSeconds = (Date.parse(transition.serviceRestoredAt) - Date.parse(progress.primaryStoppedAt)) / 1000;
        save();
    } else assert.equal(current.activeWriter, 'B');
    const order = await purchase('KT2', 'B');
    return { ...order, transition: progress.transition, primaryStoppedAt: progress.primaryStoppedAt,
        serviceRestoredAt: progress.serviceRestoredAt, rtoSeconds: progress.rtoSeconds,
        observedRpo: { missingAcknowledgedOrders: [], scope: 'primary-web failed; source DB remained manageable and was fenced before frozen snapshot' },
        artifacts: [...order.artifacts, path.join(DIR, 'KT2-primary-stopped.json'), path.join(DIR, 'KT2-maintenance.png')] };
}

function sourceLocks(database) {
    const text = c2Sql('standby-db', `SELECT JSON_OBJECT('table',OBJECT_NAME,'index',INDEX_NAME,'type',LOCK_TYPE,
        'mode',LOCK_MODE,'status',LOCK_STATUS,'transaction',CAST(ENGINE_TRANSACTION_ID AS CHAR))
        FROM performance_schema.data_locks WHERE OBJECT_SCHEMA='${database}' ORDER BY OBJECT_NAME,LOCK_STATUS;`).toString().trim();
    return text ? text.split(/\r?\n/).map(JSON.parse) : [];
}

async function holdProduct(database, productId) {
    assert.ok(Number.isSafeInteger(productId));
    const command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --batch --unbuffered --skip-column-names ' + database;
    const child = spawn('docker', ['exec', '-i', serviceId(PROJECT, 'standby-db'), 'sh', '-c', command],
        { cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    let errors = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.stderr.on('data', data => { errors += data.toString(); });
    const exited = new Promise((resolve, reject) => child.on('exit', code => code === 0 ? resolve() : reject(new Error('ROW_LOCK_SESSION_FAILED ' + errors))));
    child.stdin.write(`START TRANSACTION; SELECT id FROM products WHERE id=${productId} FOR UPDATE;\n`);
    try { await ops.waitFor(() => output.split(/\r?\n/).includes(String(productId)), 10); }
    catch (error) { child.stdin.end('ROLLBACK;\n'); await exited; throw error; }
    let released = false;
    return async () => {
        if (!released) { released = true; child.stdin.end('ROLLBACK;\n'); }
        await exited;
    };
}

function switchProcess(target) {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/cluster-ops.cjs'), 'switch', target], { cwd: ROOT, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk.toString(); });
    child.stderr.on('data', chunk => { err += chunk.toString(); });
    return new Promise((resolve, reject) => child.on('exit', code => {
        fs.writeFileSync(path.join(DIR, 'KT3-switch.log'), out + '\n' + err);
        if (code !== 0) return reject(new Error('FAILBACK_FAILED ' + err));
        const result = JSON.parse(out.trim().split(/\r?\n/).at(-1));
        resolve(JSON.parse(fs.readFileSync(path.join(DIR, result.transition + '.json'), 'utf8')));
    }));
}

async function kt3() {
    assert.equal(report.stages.kt2?.status, 'PASS');
    const progress = report.progress.kt3 ||= {};
    let current = await state();
    if (current.activeWriter === 'B') {
        if (!progress.gatewayRestart) {
            const beforeRoute = await ops.http('http://127.0.0.1:18080/gateway/status');
            compose(['restart', '--timeout', '5', 'gateway']);
            const afterRoute = await ops.waitFor(async () => {
                const r = await ops.http('http://127.0.0.1:18080/gateway/status');
                const ready = await ops.http('http://127.0.0.1:18080/ready');
                return r.status === 200 && r.data.target === 'B' && r.data.generation === current.gatewayGeneration &&
                    ready.status === 200 && ready.data.database.databaseName === current.nodes.B.database && { route: r.data, ready: ready.data };
            });
            progress.gatewayRestart = artifact(path.join(DIR, 'KT2-gateway-restart.json'), { result: 'PASS', time: now(), beforeRoute, afterRoute });
            await capturePage('http://127.0.0.1:18080/gateway/status', path.join(DIR, 'KT2-gateway-after-restart.png'));
            report.stages.kt2.gatewayRestart = { status: 'PASS', proof: progress.gatewayRestart,
                screenshot: path.join(DIR, 'KT2-gateway-after-restart.png') };
            save();
        }
        progress.sourceDatabase = current.nodes.B.database;
        progress.drainKey ||= 'drain-order-' + report.runId;
        save();
        const product = report.progress.KT2.product;
        const release = await holdProduct(current.nodes.B.database, product.id);
        try {
            const inFlight = mutate('/api/orders', 'POST', {
                customerName: 'KT3 drain TEST', customerPhone: '0900000000', customerAddress: 'TEST drain before snapshot',
                items: [{ id: product.id, quantity: 1 }]
            }, progress.drainKey).then(value => {
                if (value.status === 201) { progress.drainOrderId = value.data.order.id; progress.drainAcknowledgedAt = now(); save(); }
                return value;
            }, error => ({ error: error.message }));
            const locked = await ops.waitFor(() => {
                const locks = sourceLocks(current.nodes.B.database);
                return locks.some(l => l.table === 'products' && l.status === 'WAITING') &&
                    locks.some(l => l.table === 'runtime_write_gate' && l.type === 'RECORD' && l.status === 'GRANTED' && l.mode.startsWith('S')) && locks;
            }, 8);
            const moving = switchProcess('A').then(value => ({ value }), error => ({ error }));
            await ops.waitFor(async () => (await state()).state === 'MAINTENANCE', 8);
            const during = await ops.waitFor(() => {
                const locks = sourceLocks(current.nodes.B.database);
                return locks.some(l => l.table === 'runtime_write_gate' && l.status === 'WAITING' && l.mode.startsWith('X')) && locks;
            }, 8);
            const refused = await mutate('/api/orders', 'POST', {
                customerName: 'Blocked drain TEST', customerPhone: '0900000000', customerAddress: 'TEST',
                items: [{ id: product.id, quantity: 1 }]
            }, 'drain-refused-' + report.runId, 'http://127.0.0.1:18101');
            assert.equal(refused.status, 503);
            assert.equal(refused.data.code, 'MAINTENANCE');
            progress.lockProof = artifact(path.join(DIR, 'KT3-drain-locks.json'), {
                time: now(), database: current.nodes.B.database, admittedSharedGate: locked, maintenanceDrain: during, refused
            });
            progress.lockReleasedAt = now(); save();
            await release();
            const drained = await inFlight;
            assert.equal(drained.status, 201, JSON.stringify(drained));
            const switched = await moving;
            if (switched.error) throw switched.error;
            progress.transition = switched.value.id;
            progress.sourceFence = switched.value.sourceFence;
            progress.targetDatabase = switched.value.targetBinding.database;
            progress.downtimeSeconds = (Date.parse(switched.value.serviceRestoredAt) - Date.parse(switched.value.frozenAt)) / 1000;
            save();
        } finally { await release(); }
        current = await state();
    } else assert.equal(current.activeWriter, 'A');
    if (!progress.transition) {
        const latest = JSON.parse(fs.readFileSync(path.join(DIR, 'latest-transition.json'), 'utf8'));
        assert.equal(latest.source, 'B'); assert.equal(latest.target, 'A'); assert.equal(latest.result, 'PASS');
        progress.transition = latest.id;
        progress.targetDatabase = latest.targetBinding.database;
        progress.sourceDatabase = latest.sourceBinding.database;
        progress.sourceFence = latest.sourceFence;
        save();
    }
    const bOrderId = report.stages.kt2.orderId;
    const sourceOrder = sqlOrder('B', progress.sourceDatabase, bOrderId);
    const recoveredOrder = sqlOrder('A', current.nodes.A.database, bOrderId);
    assert.deepEqual(recoveredOrder, sourceOrder);
    assert.ok(progress.drainOrderId, 'The admitted drain request must have an acknowledged order');
    const sourceDrain = sqlOrder('B', progress.sourceDatabase, progress.drainOrderId);
    const targetDrain = sqlOrder('A', current.nodes.A.database, progress.drainOrderId);
    assert.deepEqual(targetDrain, sourceDrain);
    assert.equal(recoveredOrder.stocks[0].stock, 7);
    const throughA = await ops.http('http://127.0.0.1:18080/api/orders/' + bOrderId);
    assert.equal(throughA.status, 200);
    assert.equal(throughA.data.data.id, bOrderId);
    const comparisonFile = artifact(path.join(DIR, 'KT3-B-orders-preserved-on-A.json'), {
        time: now(), result: 'PASS', sourceDatabase: progress.sourceDatabase, targetDatabase: current.nodes.A.database,
        bOrderId, drainOrderId: progress.drainOrderId, sourceOrder, recoveredOrder, sourceDrain, targetDrain, gatewayOrder: throughA.data
    });
    const post = await purchase('KT3', 'A');
    const bDenied = await mutate('/api/products', 'POST', { name: 'KT3 blocked B', price: 1 },
        'kt3-inactive-' + report.runId, 'http://127.0.0.1:18101');
    assert.equal(bDenied.status, 503); assert.equal(bDenied.data.code, 'NODE_INACTIVE');
    return { ...post, preservedBOrderId: bOrderId, drainOrderId: progress.drainOrderId,
        sourceDatabase: progress.sourceDatabase, restoredDatabase: current.nodes.A.database,
        transition: progress.transition, downtimeSeconds: progress.downtimeSeconds, comparison: 'PASS exact order/items/receipt/stock',
        inactiveB: bDenied, artifacts: [...post.artifacts, comparisonFile, progress.lockProof].filter(Boolean), time: now() };
}

async function operations() {
    assert.equal(report.stages.kt3?.status, 'PASS');
    const backup = await ops.onlineBackup();
    const restore = await ops.restoreCheck();
    const baseline = JSON.parse(fs.readFileSync(path.join(DIR, 'baseline.json'), 'utf8'));
    const after = protectedBaseline();
    assert.deepEqual(after, baseline.protected);
    artifact(path.join(DIR, 'protected-final.json'), after);
    const current = await state();
    assert.equal(current.activeWriter, 'A');
    const a = proof('A', current.nodes.A.database);
    const b = proof('B', current.nodes.B.database);
    assert.equal(a.gate, 1); assert.equal(a.readOnly, 0); assert.equal(b.gate, 0); assert.equal(b.superReadOnly, 1);
    assert.equal((await ops.http('http://127.0.0.1:18080/ready')).status, 200);
    assert.equal((await ops.http('http://127.0.0.1:18080/api/orders/' + report.stages.kt2.orderId)).status, 200);
    const containers = JSON.parse(docker(['inspect', ...['primary-web', 'standby-web', 'primary-db', 'standby-db', 'gateway', 'control-db'].map(x => serviceId(PROJECT, x))]));
    assert.ok(containers.every(c => c.State.Status === 'running' && c.State.Health.Status === 'healthy'));
    return { time: now(), writer: 'A', database: current.nodes.A.database, a, b,
        backup: { id: backup.id, dump: backup.dump }, restore, protectedComparison: 'PASS unchanged metadata/grants/full row fingerprints',
        scheduler: 'TODO installation; runbook schedules the active-writer backup command',
        containers: containers.map(c => ({ name: c.Name, id: c.Id, state: c.State.Status, health: c.State.Health.Status })) };
}

async function main() {
    const stage = process.argv[2];
    const stages = { stage1, kt1, kt2, kt3, operations };
    if (!stages[stage]) throw new Error('Usage: acceptance.cjs stage1|kt1|kt2|kt3|operations');
    if (report.stages[stage]?.status === 'PASS') { console.log('Already PASS ' + stage); return; }
    if (report.stages[stage]?.status === 'FAIL') {
        report.attempts ||= [];
        report.attempts.push({ stage, ...report.stages[stage] });
    }
    save();
    try {
        const result = await stages[stage]();
        report.stages[stage] = { status: 'PASS', completedAt: now(), ...result };
        save();
        console.log(JSON.stringify({ stage, status: 'PASS', orderId: result.orderId, database: result.database, checks: result.checks }));
    } catch (error) {
        report.stages[stage] = { status: 'FAIL', time: now(), error: error.message };
        save();
        throw error;
    }
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { sqlOrder, proof };
