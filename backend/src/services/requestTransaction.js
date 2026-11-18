const { AsyncLocalStorage } = require('node:async_hooks');

const transactions = new AsyncLocalStorage();

function bindPool(pool) {
    return new Proxy(pool, {
        get(target, name) {
            const context = transactions.getStore();
            if (context && ['query', 'execute'].includes(name)) return context.facade[name];
            if (context && name === 'getConnection') return async () => context.facade;
            const value = Reflect.get(target, name);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}

function createContext(connection, deadline) {
    const context = { connection, deadline, rollbackOnly: false, cancelled: false, completed: false, closing: false };
    function query(method, sql, values) {
        if (context.cancelled || context.rollbackOnly || context.completed || context.closing) return Promise.reject(new Error('TRANSACTION_CLOSED'));
        const remaining = deadline - Date.now();
        if (remaining <= 0) return Promise.reject(new Error('TRANSACTION_TIMEOUT'));
        const options = typeof sql === 'string' ? { sql } : { ...sql };
        options.timeout = Math.min(15000, remaining);
        return connection[method](options, values);
    }
    context.facade = {
        query: (sql, values) => query('query', sql, values),
        execute: (sql, values) => query('execute', sql, values),
        async beginTransaction() {},
        async commit() {},
        async rollback() { context.rollbackOnly = true; },
        release() {}
    };
    return context;
}

module.exports = {
    bindPool, createContext,
    runWithTransaction: (context, work) => transactions.run(context, work)
};
