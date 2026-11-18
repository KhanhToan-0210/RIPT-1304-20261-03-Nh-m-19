const PROTOCOL = 'c2a-foundation-v1';
const WRITE_PROTOCOL = 'c2-runtime-v2';

function clusterError(code) {
    return Object.assign(new Error(code), { clusterCode: code });
}

function validateState(row, namespace) {
    if (!row || row.namespace !== namespace || ![PROTOCOL, WRITE_PROTOCOL].includes(row.protocol)) {
        throw clusterError('COORDINATOR_STATE_INVALID');
    }
    const expectedWriter = {
        MAINTENANCE: null,
        PRIMARY_ACTIVE: 'A',
        STANDBY_ACTIVE: 'B',
        FAILBACK_PENDING: 'B'
    };
    if (!Object.hasOwn(expectedWriter, row.state) ||
        row.active_writer !== expectedWriter[row.state]) {
        throw clusterError('WRITER_STATE_INVALID');
    }
    for (const field of ['revision', 'epoch', 'gateway_generation']) {
        if (!/^\d+$/.test(String(row[field]))) {
            throw clusterError('COORDINATOR_STATE_INVALID');
        }
    }
    if (row.active_writer && (String(row.epoch) === '0' || row.activation_complete !== 1)) {
        throw clusterError('ACTIVATION_INCOMPLETE');
    }
    let nodes;
    try {
        nodes = typeof row.nodes === 'string' ? JSON.parse(row.nodes) : row.nodes;
    } catch {
        throw clusterError('DATABASE_BINDING_INVALID');
    }
    for (const node of ['A', 'B']) {
        const binding = nodes?.[node];
        if (!binding || typeof binding.nodeId !== 'string' ||
            !/^shoponline_check_c2a_[a-z0-9_]+$/.test(binding.database) ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(binding.serverUuid) ||
            typeof binding.manifestId !== 'string') {
            throw clusterError('DATABASE_BINDING_INVALID');
        }
    }
    return {
        namespace: row.namespace,
        protocol: row.protocol,
        state: row.state,
        activeWriter: row.active_writer,
        revision: String(row.revision),
        epoch: String(row.epoch),
        gatewayGeneration: String(row.gateway_generation),
        transitionId: row.transition_id,
        activationComplete: row.activation_complete === 1,
        nodes
    };
}

function createClusterReader({ controlPool, dataPool, config }) {
    async function readState() {
        const [rows] = await controlPool.query({
            sql: 'SELECT * FROM cluster_state WHERE namespace = ?',
            values: [config.namespace],
            timeout: 1000
        });
        if (rows.length !== 1) throw clusterError('COORDINATOR_STATE_INVALID');
        return validateState(rows[0], config.namespace);
    }

    async function readIdentity() {
        const [rows] = await dataPool.query({
            sql: `SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid,
                         @@GLOBAL.read_only AS readOnly,
                         @@GLOBAL.super_read_only AS superReadOnly`,
            timeout: 1000
        });
        const [gates] = await dataPool.query({
            sql: 'SELECT * FROM runtime_write_gate WHERE singleton_id = 1',
            timeout: 1000
        });
        if (rows.length !== 1 || gates.length !== 1) throw clusterError('RUNTIME_GATE_INVALID');
        const identity = rows[0];
        const gate = gates[0];
        if (identity.databaseName !== config.database ||
            gate.namespace !== config.namespace || gate.node_id !== config.node ||
            gate.database_name !== identity.databaseName ||
            gate.server_uuid !== identity.serverUuid || gate.schema_version !== 2) {
            throw clusterError('DATABASE_BINDING_INVALID');
        }
        return {
            ...identity,
            readOnly: Number(identity.readOnly) === 1,
            superReadOnly: Number(identity.superReadOnly) === 1,
            gate: {
                enabled: gate.enabled === 1,
                epoch: String(gate.epoch),
                manifestId: gate.manifest_id,
                schemaVersion: gate.schema_version
            }
        };
    }

    return { readState, readIdentity };
}

module.exports = { PROTOCOL, WRITE_PROTOCOL, clusterError, validateState, createClusterReader };
