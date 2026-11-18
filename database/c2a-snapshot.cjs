const { createHash } = require('node:crypto');
const { TextDecoder } = require('node:util');

const BUSINESS_TABLES = ['products', 'orders', 'order_items'];
const RUNTIME_TABLES = ['runtime_write_gate', 'runtime_write_receipts'];

function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}

function validateDump(bytes, { requireRuntime = false } = {}) {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('DUMP_EMPTY');
    if ((bytes[0] === 0xff && bytes[1] === 0xfe) ||
        (bytes[0] === 0xfe && bytes[1] === 0xff) || bytes.includes(0)) {
        throw new Error('DUMP_ENCODING_INVALID');
    }
    let sql;
    try {
        sql = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        throw new Error('DUMP_ENCODING_INVALID');
    }
    if (/(?:^|;)\s*(?:\/\*!\d*\s*)?(?:USE\s|(?:CREATE|DROP|ALTER)\s+DATABASE\s)/im.test(sql)) {
        throw new Error('DUMP_DATABASE_SWITCH');
    }
    for (const table of [...BUSINESS_TABLES, ...(requireRuntime ? RUNTIME_TABLES : [])]) {
        if (!sql.includes('CREATE TABLE `' + table + '`')) throw new Error('DUMP_SCHEMA_INCOMPLETE');
    }
    return { bytes: bytes.length, encoding: 'UTF-8', sha256: sha256(bytes) };
}

async function captureDatabase(connection, { allowRuntime = false, includeReceipts = false } = {}) {
    if (includeReceipts && !allowRuntime) throw new Error('SNAPSHOT_RUNTIME_REQUIRED');
    await connection.query("SET time_zone = '+00:00'");
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    try {
        const [[identity]] = await connection.query(
            `SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid,
                    VERSION() AS version, @@GLOBAL.read_only AS readOnly,
                    @@GLOBAL.super_read_only AS superReadOnly`
        );
        identity.readOnly = Number(identity.readOnly);
        identity.superReadOnly = Number(identity.superReadOnly);
        if (!/^shoponline_check_/.test(identity.databaseName)) throw new Error('SNAPSHOT_SCOPE_INVALID');
        const [tables] = await connection.query(
            `SELECT TABLE_NAME AS name, ENGINE AS engine, TABLE_TYPE AS type
             FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`
        );
        const expected = [...BUSINESS_TABLES, ...(allowRuntime ? RUNTIME_TABLES : [])].sort();
        if (JSON.stringify(tables.map(t => t.name).sort()) !== JSON.stringify(expected) ||
            tables.some(t => t.engine !== 'InnoDB' || t.type !== 'BASE TABLE')) {
            throw new Error('SNAPSHOT_TABLE_INVENTORY_INVALID');
        }
        const [[objects]] = await connection.query(
            `SELECT (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()) +
                    (SELECT COUNT(*) FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE()) +
                    (SELECT COUNT(*) FROM information_schema.EVENTS WHERE EVENT_SCHEMA = DATABASE()) AS count`
        );
        if (Number(objects.count) !== 0) throw new Error('SNAPSHOT_UNSUPPORTED_OBJECTS');
        const schema = {};
        const definitions = {};
        const data = {};
        for (const table of [...BUSINESS_TABLES, ...(includeReceipts ? ['runtime_write_receipts'] : [])]) {
            const [[definition]] = await connection.query('SHOW CREATE TABLE `' + table + '`');
            definitions[table] = definition['Create Table'];
            const [columns] = await connection.query(
                `SELECT COLUMN_NAME, ORDINAL_POSITION, COLUMN_DEFAULT, IS_NULLABLE, COLUMN_TYPE,
                        CHARACTER_SET_NAME, COLLATION_NAME, EXTRA, GENERATION_EXPRESSION, COLUMN_COMMENT
                 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
                 ORDER BY ORDINAL_POSITION`, [table]);
            const [indexes] = await connection.query(
                `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, COLLATION, SUB_PART,
                        NULLABLE, INDEX_TYPE, EXPRESSION, IS_VISIBLE
                 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?
                 ORDER BY INDEX_NAME, SEQ_IN_INDEX`, [table]);
            const [foreignKeys] = await connection.query(
                `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.ORDINAL_POSITION,
                        k.POSITION_IN_UNIQUE_CONSTRAINT, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME,
                        (k.REFERENCED_TABLE_SCHEMA=DATABASE()) AS REFERENCES_LOCAL_DATABASE,
                        r.UPDATE_RULE, r.DELETE_RULE, r.MATCH_OPTION
                 FROM information_schema.KEY_COLUMN_USAGE k
                 JOIN information_schema.REFERENTIAL_CONSTRAINTS r
                   ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
                 WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=?
                 ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`, [table]);
            const [checks] = await connection.query(
                `SELECT c.CONSTRAINT_NAME, c.CHECK_CLAUSE, t.ENFORCED
                 FROM information_schema.CHECK_CONSTRAINTS c
                 JOIN information_schema.TABLE_CONSTRAINTS t
                   ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME
                 WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=? AND t.CONSTRAINT_TYPE='CHECK'
                 ORDER BY c.CONSTRAINT_NAME`, [table]);
            const [properties] = await connection.query(
                `SELECT ENGINE, ROW_FORMAT, TABLE_COLLATION, AUTO_INCREMENT, CREATE_OPTIONS, TABLE_COMMENT
                 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?`, [table]);
            if (columns.length === 0 || properties.length !== 1 ||
                !indexes.some(index => index.INDEX_NAME === 'PRIMARY') ||
                foreignKeys.some(key => Number(key.REFERENCES_LOCAL_DATABASE) !== 1)) {
                throw new Error('SNAPSHOT_SCHEMA_METADATA_INCOMPLETE');
            }
            schema[table] = { columns, indexes, foreignKeys, checks, properties };
            const order = table === 'runtime_write_receipts' ? 'namespace, request_key' : 'id';
            const [rows] = await connection.query('SELECT * FROM `' + table + '` ORDER BY ' + order);
            data[table] = { count: rows.length, sha256: sha256(JSON.stringify(rows)) };
        }
        const [[invalid]] = await connection.query(
            `SELECT
              (SELECT COUNT(*) FROM products WHERE price < 0 OR stock < 0) +
              (SELECT COUNT(*) FROM orders o WHERE total_price <> COALESCE(
                  (SELECT SUM(i.price * i.quantity) FROM order_items i WHERE i.order_id = o.id), 0)) +
              (SELECT COUNT(*) FROM order_items i
                  LEFT JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id
                  WHERE o.id IS NULL OR p.id IS NULL OR i.price < 0 OR i.quantity <= 0) AS count`
        );
        if (Number(invalid.count) !== 0) throw new Error('SNAPSHOT_DATA_CONSTRAINT_INVALID');
        await connection.commit();
        return { identity, schema, definitions, schemaFingerprintVersion: 2, data,
            schemaSha256: sha256(JSON.stringify(schema)),
            businessSha256: sha256(JSON.stringify(data)) };
    } catch (error) {
        await connection.rollback();
        throw error;
    }
}

if (require.main === module) {
    (async () => {
        if (process.env.APP_ENV !== 'test' ||
            !['test-primary', 'test-standby', 'c2a-primary', 'c2a-standby'].includes(process.env.NODE_NAME)) {
            throw new Error('SNAPSHOT_ENVIRONMENT_INVALID');
        }
        const mysql = require('/app/backend/node_modules/mysql2/promise');
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST, user: process.env.DB_USER,
            password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
            supportBigNumbers: true, bigNumberStrings: true, dateStrings: true
        });
        try {
            const snapshot = await captureDatabase(connection, {
                allowRuntime: ['c2a', 'c2'].includes(process.env.CLUSTER_MODE),
                includeReceipts: process.argv.includes('--receipts')
            });
            console.log(JSON.stringify(snapshot));
        } finally {
            await connection.end();
        }
    })().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
}

module.exports = { BUSINESS_TABLES, sha256, validateDump, captureDatabase };
