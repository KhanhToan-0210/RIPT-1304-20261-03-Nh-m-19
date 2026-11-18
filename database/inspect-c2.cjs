const fs = require('node:fs');
const mysql = require('/app/backend/node_modules/mysql2/promise');
const { captureDatabase } = require('./c2a-snapshot.cjs');

(async () => {
    const config = JSON.parse(fs.readFileSync(0, 'utf8'));
    if (process.env.APP_ENV !== 'test' || process.env.CLUSTER_NAMESPACE !== 'shoponline-c2a-20261118' ||
        !['primary-db', 'standby-db'].includes(config.host) ||
        !/^shoponline_check_c2a_[a-z0-9_]+$/.test(config.database) ||
        !['c2_inspector_a', 'c2_inspector_b'].includes(config.user)) throw new Error('INSPECT_SCOPE_INVALID');
    const connection = await mysql.createConnection({ ...config, dateStrings: true,
        supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 5000 });
    try {
        const snapshot = await captureDatabase(connection, { allowRuntime: true, includeReceipts: true });
        console.log(JSON.stringify(snapshot));
    } finally { await connection.end(); }
})().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
