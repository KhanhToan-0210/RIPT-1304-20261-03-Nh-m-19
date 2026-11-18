const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { bindPool, createContext, runWithTransaction } = require('../src/services/requestTransaction');
const { payloadHash, checkPermission, acquire, transactionMiddleware } = require('../src/services/writeTransaction');
const { renderConfig } = require('../../gateway/render-config.cjs');

const config = { node: 'A', nodeName: 'c2a-primary', namespace: 'shoponline-c2a-20261118',
    database: 'shoponline_check_c2a_a_test', username: 'c2_writer_a_1', epoch: '1', mode: 'c2', valid: true };
const uuid = '12345678-1234-1234-1234-123456789abc';
const binding = { database: config.database, serverUuid: uuid, nodeId: config.nodeName,
    username: config.username, epoch: '1', manifestId: 'snapshot-test' };
const state = { protocol: 'c2-runtime-v2', state: 'PRIMARY_ACTIVE', activeWriter: 'A',
    activationComplete: true, epoch: '1', nodes: { A: binding } };
const identity = { databaseName: config.database, serverUuid: uuid, readOnly: '0', superReadOnly: '0' };
const gate = { namespace: config.namespace, node_id: 'A', database_name: config.database,
    server_uuid: uuid, epoch: '1', enabled: 1, manifest_id: 'snapshot-test' };

test('payload hashes preserve object order independence and bind method/path/content', () => {
    const req = { method: 'POST', originalUrl: '/api/orders', body: { b: 2, a: [1] } };
    assert.equal(payloadHash(req), payloadHash({ ...req, body: { a: [1], b: 2 } }));
    assert.notEqual(payloadHash(req), payloadHash({ ...req, originalUrl: '/api/products' }));
    assert.notEqual(payloadHash(req), payloadHash({ ...req, body: { a: [2], b: 2 } }));
});

test('writer admission requires the complete actual identity and epoch', () => {
    assert.doesNotThrow(() => checkPermission(state, config, identity, gate));
    for (const changed of [{ ...identity, databaseName: 'shoponline' }, { ...identity, serverUuid: 'wrong' },
        { ...identity, readOnly: '1' }, { ...identity, superReadOnly: '1' }]) {
        assert.throws(() => checkPermission(state, config, changed, gate));
    }
    for (const changed of [{ ...gate, enabled: 0 }, { ...gate, epoch: '0' },
        { ...gate, node_id: 'B' }, { ...gate, manifest_id: 'stale' }]) {
        assert.throws(() => checkPermission(state, config, identity, changed));
    }
    assert.throws(() => checkPermission({ ...state, activeWriter: 'B' }, config, identity, gate));
    assert.throws(() => checkPermission(state, { ...config, username: 'old_writer' }, identity, gate));
});

test('controller transactions share the outer connection without early commit/release', async () => {
    const events = [];
    const raw = { query: async () => { events.push('query'); return [[]]; } };
    const pool = bindPool({ query: () => assert.fail('outside transaction'), getConnection: () => assert.fail('second connection') });
    const context = createContext(raw, Date.now() + 5000);
    await runWithTransaction(context, async () => {
        const connection = await pool.getConnection();
        await connection.beginTransaction();
        await pool.query('UPDATE products SET stock=stock-1');
        await connection.commit();
        connection.release();
    });
    assert.deepEqual(events, ['query']);
    await context.facade.rollback();
    await assert.rejects(context.facade.query('INSERT INTO orders'), /TRANSACTION_CLOSED/);
});

test('a connection arriving after admission timeout is released without SQL', async () => {
    let released = false;
    const pool = { getConnection: () => new Promise(resolve => setTimeout(() => resolve({ release() { released = true; } }), 30)) };
    await assert.rejects(acquire(pool, Date.now() + 5), { clusterCode: 'ADMISSION_TIMEOUT' });
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(released, true);
});

test('controller SQL cannot escape after response finalization or outer commit', async () => {
    const raw = { query: () => assert.fail('SQL escaped the transaction') };
    const closing = createContext(raw, Date.now() + 5000);
    closing.closing = true;
    await assert.rejects(closing.facade.query('UPDATE products'), /TRANSACTION_CLOSED/);
    const completed = createContext(raw, Date.now() + 5000);
    completed.completed = true;
    await assert.rejects(completed.facade.query('UPDATE products'), /TRANSACTION_CLOSED/);
});

function fixture({ commitUnknown = false, duplicate = false, conflict = false } = {}) {
    const events = [];
    const row = { namespace: config.namespace, protocol: state.protocol, state: 'PRIMARY_ACTIVE', active_writer: 'A',
        revision: '10', epoch: '1', gateway_generation: '1', activation_complete: 1,
        nodes: { A: binding, B: { ...binding, nodeId: 'c2a-standby' } }, transition_id: null };
    const body = { name: 'TEST' };
    const hash = payloadHash({ method: 'POST', originalUrl: '/api/test', body });
    const control = { async query({ sql }) {
        events.push('control:' + sql.split(' ')[0]);
        return sql.startsWith('SELECT') ? [[row]] : [[]];
    }, release() { events.push('control:release'); }, destroy() { events.push('control:destroy'); } };
    const data = { async query({ sql }) {
        events.push('data:' + sql.split(' ')[0]);
        if (sql.includes('DATABASE()')) return [[identity]];
        if (sql.includes('runtime_write_gate')) return [[gate]];
        if (sql.startsWith('INSERT INTO runtime_write_receipts') && duplicate) throw Object.assign(new Error(), { code: 'ER_DUP_ENTRY' });
        if (sql.startsWith('SELECT * FROM runtime_write_receipts')) return [[{ payload_sha256: conflict ? 'different' : hash,
            state: 'COMMITTED', response_status: 201, response_body: { id: 'saved' } }]];
        return [{ affectedRows: 1 }];
    }, async commit() { events.push('data:COMMIT'); if (commitUnknown) throw new Error('ACK lost'); },
    async rollback() { events.push('data:ROLLBACK'); }, release() { events.push('data:release'); }, destroy() { events.push('data:destroy'); } };
    const dataPool = bindPool({ getConnection: async () => data });
    const app = express();
    app.use(express.json());
    app.use(transactionMiddleware({ config, controlPool: { getConnection: async () => control }, dataPool }));
    app.post('/api/test', async (req, res) => {
        const connection = await dataPool.getConnection();
        await connection.beginTransaction();
        await dataPool.query('UPDATE products SET stock=stock-1');
        await connection.commit();
        connection.release();
        res.status(201).json({ id: 'new' });
    });
    return { app, events, body };
}

async function runCase(options, check) {
    const f = fixture(options);
    const server = f.app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/test', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'unit-key-123', Connection: 'close' }, body: JSON.stringify(f.body)
        });
        await check(response, f.events);
    } finally { await new Promise(resolve => server.close(resolve)); }
}

test('response succeeds only after outer receipt/data commit', async () => runCase({}, async (response, events) => {
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'new' });
    assert.equal(events.filter(e => e === 'data:COMMIT').length, 1);
    assert.ok(events.indexOf('control:COMMIT') < events.indexOf('data:INSERT'));
    assert.ok(events.indexOf('data:COMMIT') < events.indexOf('data:release'));
}));

test('lost commit ACK reports UNKNOWN without a false success', async () => runCase({ commitUnknown: true }, async response => {
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'COMMIT_OUTCOME_UNKNOWN');
}));

test('same key returns the committed outcome before controller DML', async () => runCase({ duplicate: true }, async (response, events) => {
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { id: 'saved' });
    assert.equal(events.filter(e => e === 'data:UPDATE').length, 0);
    assert.ok(events.includes('data:ROLLBACK'));
}));

test('same key with a different payload returns 409', async () => runCase({ duplicate: true, conflict: true }, async response => {
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'IDEMPOTENCY_KEY_CONFLICT');
}));

test('gateway configs have one selected node and disable upstream retry', () => {
    const text = renderConfig({ target: 'B', generation: '2', stage: 'active', transitionId: null, environment: 'test' });
    assert.match(text, /standby-web:3000/);
    assert.doesNotMatch(text, /primary-web:3000/);
    assert.match(text, /proxy_next_upstream off/);
    assert.throws(() => renderConfig({ target: 'C', generation: '2' }));
});
