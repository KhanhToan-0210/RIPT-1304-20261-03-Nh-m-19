const mysql = require('mysql2/promise');

function createControlPool(env) {
    return mysql.createPool({
        host: env.CONTROL_DB_HOST,
        port: Number(env.CONTROL_DB_PORT || 3306),
        user: env.CONTROL_DB_USER,
        password: env.CONTROL_DB_PASSWORD,
        database: env.CONTROL_DB_NAME,
        connectionLimit: 4,
        waitForConnections: false,
        connectTimeout: 1000,
        supportBigNumbers: true,
        bigNumberStrings: true
    });
}

module.exports = { createControlPool };
