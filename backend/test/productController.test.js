const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function controllerWith(pool) {
    const context = { exports: {}, require: () => pool, console };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/productController.js'), 'utf8'), context);
    return context.exports;
}

function response() {
    return {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
}

const product = { id: 1, name: 'HP', price: '100.00', stock: 5, image: null, description: '' };

test('metadata update preserves stock changed by a concurrent order', async () => {
    const calls = [];
    const pool = { async query(sql, values) {
        calls.push({ sql, values });
        if (sql.startsWith('UPDATE')) return [{ affectedRows: 1 }];
        return [[{ ...product, stock: calls.length === 1 ? 5 : 3 }]];
    } };
    const res = response();
    await controllerWith(pool).updateProduct({ params: { id: '1' }, body: { name: 'New name' } }, res, assert.fail);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.stock, 3);
    assert.doesNotMatch(calls.find(call => call.sql.startsWith('UPDATE')).sql, /SET.*stock\s*=/);
});

test('stock adjustment requires the value read by the caller', async () => {
    let writes = 0;
    const pool = { async query(sql) {
        if (sql.startsWith('UPDATE')) writes++;
        return [[product]];
    } };
    const res = response();
    await controllerWith(pool).updateProduct({ params: { id: '1' }, body: { stock: 10 } }, res, assert.fail);
    assert.equal(res.statusCode, 428);
    assert.equal(writes, 0);
});

test('stale expectedStock returns 409 after the atomic update fails', async () => {
    const pool = { async query(sql, values) {
        if (sql.startsWith('UPDATE')) {
            assert.match(sql, /WHERE id = \? AND stock = \?/);
            assert.equal(values.at(-1), 5);
            return [{ affectedRows: 0 }];
        }
        return [[product]];
    } };
    const res = response();
    await controllerWith(pool).updateProduct({ params: { id: '1' }, body: { stock: 10, expectedStock: 5 } }, res, assert.fail);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.success, false);
});

for (const expectedStock of [null, -1, 1.5, true, '5x', 2147483648, [5], {}]) {
    test(`invalid expectedStock ${JSON.stringify(expectedStock)} is rejected`, async () => {
        const res = response();
        const pool = { query: async () => [[product]] };
        await controllerWith(pool).updateProduct({ params: { id: '1' }, body: { stock: 10, expectedStock } }, res, assert.fail);
        assert.equal(res.statusCode, 400);
    });
}

test('database failures reach the JSON error middleware', async () => {
    const failure = new Error('database unavailable');
    let forwarded;
    const pool = { query: async () => { throw failure; } };
    await controllerWith(pool).updateProduct({ params: { id: '1' }, body: {} }, response(), error => { forwarded = error; });
    assert.equal(forwarded, failure);
});
