const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDump, sha256, captureDatabase } = require('../../database/c2a-snapshot.cjs');
const { c2Sql, serviceId } = require('../../scripts/c2a-lib.cjs');
const { requireSameSnapshot } = require('../../scripts/bootstrap-c2a.cjs');

const sql = ['products', 'orders', 'order_items'].map(t => 'CREATE TABLE `' + t + '` (id INT);').join('\n');

test('dump validation preserves raw UTF-8 bytes and checksum', () => {
    const bytes = Buffer.from(sql + '\n-- Tiếng Việt');
    assert.deepEqual(validateDump(bytes), { bytes: bytes.length, encoding: 'UTF-8', sha256: sha256(bytes) });
});

for (const bytes of [Buffer.alloc(0), Buffer.from(sql, 'utf16le'), Buffer.from([0xff, 0xfe]),
    Buffer.from([0xc3, 0x28]), Buffer.from('SELECT 1;'), Buffer.from('USE shoponline;\n' + sql),
    Buffer.from('/*!50000 DROP DATABASE shoponline */;\n' + sql)]) {
    test('invalid dump is rejected before import ' + sha256(bytes).slice(0, 8), () => {
        assert.throws(() => validateDump(bytes));
    });
}

test('resource scope rejects demo targets before invoking Docker', () => {
    assert.throws(() => c2Sql('primary-web', 'SELECT 1'), /SQL_SCOPE_INVALID/);
    assert.throws(() => c2Sql('primary-db', 'SELECT 1', 'shoponline'), /SQL_SCOPE_INVALID/);
    assert.throws(() => serviceId('demo', 'primary-db'), /PROJECT_SCOPE_INVALID/);
});

test('snapshot comparison catches row changes even when counts match', () => {
    const before = { schemaSha256: 'schema', businessSha256: 'rows-before' };
    assert.doesNotThrow(() => requireSameSnapshot(before, { ...before }));
    assert.throws(() => requireSameSnapshot(before, { ...before, businessSha256: 'rows-after' }));
    assert.throws(() => requireSameSnapshot(before, { ...before, schemaSha256: 'different-fk' }));
});

function snapshotConnection(invalidRows = 0) {
    const calls = [];
    return {
        calls,
        async query(query) {
            calls.push(query);
            if (query.includes('DATABASE() AS')) return [[{ databaseName: 'shoponline_check_phase_b', serverUuid: 'source', readOnly: '0', superReadOnly: '0' }]];
            if (query.includes('TABLE_NAME AS name')) return [[...['products', 'orders', 'order_items'].map(name => ({ name, engine: 'InnoDB', type: 'BASE TABLE' }))]];
            if (query.includes('information_schema.TABLES')) return [[{ ENGINE: 'InnoDB', AUTO_INCREMENT: '2' }]];
            if (query.includes('information_schema.COLUMNS')) return [[{ COLUMN_NAME: 'id', COLUMN_TYPE: 'int' }]];
            if (query.includes('information_schema.STATISTICS')) return [[{ INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id' }]];
            if (query.includes('information_schema.TRIGGERS')) return [[{ count: 0 }]];
            if (query.startsWith('SHOW CREATE')) return [[{ 'Create Table': query }]];
            if (query.startsWith('SELECT *')) return [[{ id: 1, price: '1234567890123.45', name: 'Tiếng Việt', nullable: null }]];
            if (query.includes('AS count')) return [[{ count: invalidRows }]];
            return [[]];
        },
        async commit() { calls.push('COMMIT'); },
        async rollback() { calls.push('ROLLBACK'); }
    };
}

test('snapshot capture uses a read-only consistent transaction and hashes full rows', async () => {
    const connection = snapshotConnection();
    const result = await captureDatabase(connection);
    assert.ok(connection.calls.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
    assert.equal(connection.calls.at(-1), 'COMMIT');
    assert.equal(result.data.products.count, 1);
    assert.equal(result.identity.readOnly, 0);
    assert.equal(result.schemaFingerprintVersion, 2);
    assert.equal(result.data.products.sha256, sha256(JSON.stringify([{ id: 1, price: '1234567890123.45', name: 'Tiếng Việt', nullable: null }])));
    assert.ok(!connection.calls.some(q => /^(INSERT|UPDATE|DELETE|ALTER|CREATE)\s/.test(q)));
});

test('invalid source data aborts capture without publishing a verified snapshot', async () => {
    const connection = snapshotConnection(1);
    await assert.rejects(captureDatabase(connection), /SNAPSHOT_DATA_CONSTRAINT_INVALID/);
    assert.equal(connection.calls.at(-1), 'ROLLBACK');
    assert.ok(!connection.calls.includes('COMMIT'));
});

test('schema fingerprint uses structural metadata despite SHOW CREATE formatting differences', async () => {
    const first = snapshotConnection();
    const second = snapshotConnection();
    const query = second.query.bind(second);
    second.query = async sql => {
        if (sql.startsWith('SHOW CREATE')) return [[{ 'Create Table': sql + ' CHARACTER SET utf8mb4' }]];
        return query(sql);
    };
    const source = await captureDatabase(first);
    const target = await captureDatabase(second);
    assert.notDeepEqual(source.definitions, target.definitions);
    assert.equal(source.schemaSha256, target.schemaSha256);
});

test('schema fingerprint detects a changed column type', async () => {
    const source = await captureDatabase(snapshotConnection());
    const changed = snapshotConnection();
    const query = changed.query.bind(changed);
    changed.query = async sql => {
        if (sql.includes('information_schema.COLUMNS')) return [[{ COLUMN_NAME: 'id', COLUMN_TYPE: 'bigint' }]];
        return query(sql);
    };
    const target = await captureDatabase(changed);
    assert.notEqual(source.schemaSha256, target.schemaSha256);
});
