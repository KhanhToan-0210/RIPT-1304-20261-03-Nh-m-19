const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function unavailable(res, code) {
    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', '5');
    return res.status(503).json({
        success: false,
        code,
        message: 'Hệ thống đang bảo trì. Vui lòng thử lại sau.'
    });
}

function createWriteGuard({ readState, config }) {
    return async (req, res, next) => {
        if (SAFE_METHODS.has(req.method)) return next();
        if (!config.valid) return unavailable(res, 'CLUSTER_CONFIGURATION_INVALID');
        try {
            const state = await readState();
            if (state.state === 'MAINTENANCE') return unavailable(res, 'MAINTENANCE');
            if (state.activeWriter !== config.node) return unavailable(res, 'NODE_INACTIVE');
            // Foundation mode stays closed. Runtime mode continues through
            // the transaction admission middleware before any handler DML.
            if (config.mode !== 'c2' || state.protocol !== 'c2-runtime-v2') {
                return unavailable(res, 'WRITE_ACTIVATION_REQUIRED');
            }
            if (!req.path?.startsWith('/api/')) return unavailable(res, 'WRITE_ROUTE_UNSUPPORTED');
            return next();
        } catch (error) {
            return unavailable(res, error.clusterCode || 'COORDINATOR_UNAVAILABLE');
        }
    };
}

module.exports = { createWriteGuard, unavailable };
