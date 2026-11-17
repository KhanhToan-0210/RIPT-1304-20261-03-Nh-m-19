const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../src/config/db');
const app = require('../server');

let server;
let base;
const originalQuery = pool.query;

before(async () => {
    pool.query = async () => { throw Object.assign(new Error('private SQL and connection details'), { code: 'ECONNREFUSED' }); };
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    pool.query = originalQuery;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
});

test('malformed JSON returns a JSON 400 response', async () => {
    const response = await fetch(base + '/api/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid'
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).success, false);
});

test('unknown API routes return JSON 404', async () => {
    const response = await fetch(base + '/api/missing');
    assert.equal(response.status, 404);
    assert.equal((await response.json()).success, false);
});

test('database failures return JSON 500 without private details', async () => {
    const response = await fetch(base + '/api/products');
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.doesNotMatch(JSON.stringify(body), /private SQL|ECONNREFUSED|connection details/);
});

test('database failure keeps health at 503', async () => {
    const response = await fetch(base + '/health');
    assert.equal(response.status, 503);
    assert.equal((await response.json()).database, 'disconnected');
});

test('oversized API payload returns JSON 413', async () => {
    const response = await fetch(base + '/api/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x'.repeat(110000) })
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).success, false);
});
