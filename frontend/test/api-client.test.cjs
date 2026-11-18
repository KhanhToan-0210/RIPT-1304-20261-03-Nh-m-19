const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function client() {
    const saved = new Map();
    const calls = [];
    let nextResponse;
    const context = {
        window: {}, Headers, crypto: { randomUUID: () => 'idempotency-unit-key' },
        localStorage: { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) },
        fetch: async (url, options) => { calls.push(options.headers.get('Idempotency-Key')); return nextResponse(); }
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/api-client.js'), 'utf8'), context);
    return { api: context.window.ShopOnlineApi, saved, calls,
        respond(status, body) { nextResponse = () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); },
        disconnect() { nextResponse = () => { throw new Error('network disconnected'); }; } };
}

test('network/UNKNOWN outcomes retain the key and a retry reuses it', async () => {
    const c = client();
    const options = { method: 'POST', body: '{"items":[]}' };
    c.disconnect();
    await assert.rejects(c.api.mutate('/api/orders', options));
    c.respond(503, { code: 'COMMIT_OUTCOME_UNKNOWN' });
    await c.api.mutate('/api/orders', options);
    c.respond(201, { order: { id: 'saved' } });
    await c.api.mutate('/api/orders', options);
    assert.deepEqual(c.calls, ['idempotency-unit-key', 'idempotency-unit-key', 'idempotency-unit-key']);
    assert.equal(Object.keys(c.api.pending()).length, 0);
});

test('changing an unresolved payload is blocked before sending', async () => {
    const c = client();
    c.disconnect();
    await assert.rejects(c.api.mutate('/api/orders', { method: 'POST', body: 'old' }));
    await assert.rejects(c.api.mutate('/api/orders', { method: 'POST', body: 'new' }));
    assert.equal(c.calls.length, 1);
});

test('known maintenance refusal clears pending so the user can edit', async () => {
    const c = client();
    c.respond(503, { code: 'MAINTENANCE' });
    await c.api.mutate('/api/orders', { method: 'POST', body: 'old' });
    assert.equal(Object.keys(c.api.pending()).length, 0);
});
