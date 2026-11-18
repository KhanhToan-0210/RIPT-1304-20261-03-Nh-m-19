const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { clusterConfig, installClusterFoundation } = require('../src/clusterFoundation');
const { createWriteGuard } = require('../src/middleware/writeGuard');
const { validateState, createClusterReader } = require('../src/services/clusterState');

const env = {
    APP_ENV: 'test', CLUSTER_MODE: 'c2a', CLUSTER_NAMESPACE: 'shoponline-c2a-20261118',
    CLUSTER_NODE: 'A', NODE_NAME: 'c2a-primary', DB_NAME: 'shoponline_check_c2a_a_20261118',
    CONTROL_DB_HOST: 'control-db', CONTROL_DB_NAME: 'shoponline_control_c2a',
    CONTROL_DB_USER: 'reader', CONTROL_DB_PASSWORD: 'test'
};
const binding = { nodeId: 'c2a-primary', database: env.DB_NAME,
    serverUuid: '12345678-1234-1234-1234-123456789abc', manifestId: 'snapshot-test' };
const row = {
    namespace: env.CLUSTER_NAMESPACE, protocol: 'c2a-foundation-v1', state: 'MAINTENANCE',
    active_writer: null, epoch: '0', revision: '9007199254740993', gateway_generation: '0',
    activation_complete: 0, transition_id: null, nodes: { A: binding, B: { ...binding, nodeId: 'c2a-standby' } }
};

function response() {
    return { statusCode: 200, set() { return this; }, status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; } };
}

test('legacy PHA B configuration does not enable cluster foundation', () => {
    assert.equal(clusterConfig({ APP_ENV: 'test', NODE_NAME: 'test-primary', DB_NAME: 'shoponline_check_phase_b' }).enabled, false);
});

for (const change of [{ CLUSTER_MODE: '' }, { APP_ENV: 'production' }, { CLUSTER_NODE: 'C' },
    { CLUSTER_NAMESPACE: 'demo' }, { CONTROL_DB_PASSWORD: '' }, { NODE_NAME: 'test-primary' }, { DB_NAME: 'shoponline' }]) {
    test('partial or wrong C2 configuration remains enabled and closed ' + JSON.stringify(change), () => {
        const config = clusterConfig({ ...env, ...change });
        assert.equal(config.enabled, true);
        assert.equal(config.valid, false);
    });
}

test('coordinator integer tokens retain precision', () => {
    assert.equal(validateState(row, env.CLUSTER_NAMESPACE).revision, '9007199254740993');
});

for (const change of [{ namespace: 'demo' }, { protocol: 'unknown' }, { state: 'UNKNOWN' },
    { active_writer: 'A' }, { nodes: '{}' }, { nodes: '{broken' }, { epoch: undefined },
    { state: 'PRIMARY_ACTIVE', active_writer: 'A', epoch: '1', activation_complete: 0 }]) {
    test('invalid coordinator state is rejected ' + JSON.stringify(change), () => {
        assert.throws(() => validateState({ ...row, ...change }, env.CLUSTER_NAMESPACE));
    });
}

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'PROPFIND']) {
    test(method + ' cannot reach a mutation handler in maintenance', async () => {
        let reached = false;
        const res = response();
        const guard = createWriteGuard({ config: clusterConfig(env), readState: async () => validateState(row, env.CLUSTER_NAMESPACE) });
        await guard({ method, headers: { 'x-active-node': 'A', 'x-writer': 'true' } }, res, () => { reached = true; });
        assert.equal(reached, false);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.code, 'MAINTENANCE');
    });
}

test('coordinator failures are sanitized and never reach the handler', async () => {
    const guard = createWriteGuard({ config: clusterConfig(env), readState: async () => { throw new Error('password=private'); } });
    const res = response();
    await guard({ method: 'POST' }, res, assert.fail);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'COORDINATOR_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(res.body), /private|password/);
});

test('permission is fetched again on every mutation', async () => {
    let reads = 0;
    const guard = createWriteGuard({ config: clusterConfig(env), readState: async () => {
        reads++;
        if (reads === 2) throw new Error('disconnected');
        return validateState(row, env.CLUSTER_NAMESPACE);
    } });
    const first = response();
    const second = response();
    await guard({ method: 'POST' }, first, assert.fail);
    await guard({ method: 'POST' }, second, assert.fail);
    assert.equal(reads, 2);
    assert.equal(second.body.code, 'COORDINATOR_UNAVAILABLE');
});

test('even an active state cannot enable C2a autocommit handlers', async () => {
    const state = validateState({ ...row, state: 'PRIMARY_ACTIVE', active_writer: 'A', epoch: '1', activation_complete: 1 }, env.CLUSTER_NAMESPACE);
    const guard = createWriteGuard({ config: clusterConfig(env), readState: async () => state });
    const res = response();
    await guard({ method: 'POST' }, res, assert.fail);
    assert.equal(res.body.code, 'WRITE_ACTIVATION_REQUIRED');
});

test('inactive node is denied independently of client headers', async () => {
    const guard = createWriteGuard({ config: clusterConfig(env), readState: async () => ({ state: 'STANDBY_ACTIVE', activeWriter: 'B' }) });
    const res = response();
    await guard({ method: 'DELETE', headers: { 'x-active-writer': 'A' } }, res, assert.fail);
    assert.equal(res.body.code, 'NODE_INACTIVE');
});

test('identity comes from the data pool and rejects the wrong database', async () => {
    const reader = createClusterReader({ config: clusterConfig(env), controlPool: {}, dataPool: {
        async query({ sql }) {
            if (sql.includes('DATABASE()')) return [[{ databaseName: 'shoponline', serverUuid: binding.serverUuid }]];
            return [[{ namespace: env.CLUSTER_NAMESPACE, node_id: 'A', database_name: 'shoponline', server_uuid: binding.serverUuid, schema_version: 2 }]];
        }
    } });
    await assert.rejects(reader.readIdentity(), { clusterCode: 'DATABASE_BINDING_INVALID' });
});

test('normal Express entry points guard every route before parsing or dispatch', async () => {
    const app = express();
    let hits = 0;
    installClusterFoundation(app, { dataPool: {}, env, controlPool: { query: async () => [[row]] } });
    app.use(express.json());
    app.all('*', (req, res) => { hits++; res.json({ unexpected: true }); });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const base = 'http://127.0.0.1:' + server.address().port;
        for (const route of ['/api/products', '/api/orders', '/future-write', '/health']) {
            const r = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid' });
            assert.equal(r.status, 503);
            assert.equal((await r.json()).code, 'MAINTENANCE');
        }
        assert.equal((await fetch(base + '/live')).status, 200);
        assert.equal((await fetch(base + '/ready')).status, 503);
        assert.equal((await fetch(base + '/cluster/status')).status, 200);
        assert.equal(hits, 0);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
