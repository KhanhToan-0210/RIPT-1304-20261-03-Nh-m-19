const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { randomBytes, randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { validateDump } = require('../database/c2a-snapshot.cjs');
const { ROOT, RUNTIME, ENV_FILE, PROJECT, PHASE_B, DB_NAMES, readEnvironment,
    docker, compose, serviceId, c2Sql, capture, protectedBaseline, saveJson, assertGitBaseline } = require('./c2a-lib.cjs');

async function checkPort(port) {
    await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
}

function initializeEnvironment() {
    fs.mkdirSync(RUNTIME, { recursive: true });
    if (!fs.existsSync(ENV_FILE)) {
        const keys = ['CONTROL_ROOT', 'PRIMARY_ROOT', 'STANDBY_ROOT', 'PRIMARY_READER',
            'STANDBY_READER', 'CONTROL_A', 'CONTROL_B'];
        fs.writeFileSync(ENV_FILE, keys.map(key => 'C2A_' + key + '_PASSWORD=' + randomBytes(24).toString('hex')).join('\n') + '\n', { flag: 'wx' });
    }
    return readEnvironment();
}

function requireSameSnapshot(expected, actual) {
    if (expected.schemaSha256 !== actual.schemaSha256 || expected.businessSha256 !== actual.businessSha256) {
        throw new Error('SNAPSHOT_COMPARISON_FAILED');
    }
}

async function bootstrap() {
    const completeFile = path.join(RUNTIME, 'bootstrap-complete.json');
    if (fs.existsSync(completeFile)) {
        console.log('C2a is already bootstrapped. Run node scripts/test-c2a.cjs to inspect it.');
        return;
    }
    for (const port of [18080, 18100, 18101]) await checkPort(port);
    const before = protectedBaseline();
    saveJson('protected-before.json', before);
    const secrets = initializeEnvironment();
    compose(['config', '--quiet']);
    const manifestId = 'c2a-' + randomUUID();
    const manifest = { manifestId, project: PROJECT, sourceProject: PHASE_B,
        startedAt: new Date().toISOString(), status: 'PREPARING', sourceMode: 'online',
        source: capture(PHASE_B, 'primary-web') };
    const sourceDbId = serviceId(PHASE_B, 'primary-db');
    const sourceUuid = docker(['exec', sourceDbId, 'sh', '-c',
        'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --batch --skip-column-names --execute="SELECT @@server_uuid"'
    ]).toString('utf8').trim();
    if (manifest.source.identity.databaseName !== 'shoponline_check_phase_b' ||
        manifest.source.identity.serverUuid !== sourceUuid) throw new Error('SOURCE_DATABASE_BINDING_INVALID');
    const dumpCommand = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --user=root --default-character-set=utf8mb4 --single-transaction --quick --skip-lock-tables --skip-add-drop-table --no-tablespaces --set-gtid-purged=OFF shoponline_check_phase_b';
    const bytes = docker(['exec', sourceDbId, 'sh', '-c', dumpCommand]);
    manifest.dump = validateDump(bytes);
    manifest.dumpFinishedAt = new Date().toISOString();
    requireSameSnapshot(manifest.source, capture(PHASE_B, 'primary-web'));
    const artifact = path.join(RUNTIME, manifestId + '.sql');
    fs.writeFileSync(artifact, bytes, { flag: 'wx' });
    manifest.status = 'SOURCE_VERIFIED';
    saveJson('snapshot-manifest.json', manifest);
    console.log('Verified snapshot from PHA B A. Starting isolated ' + PROJECT + '.');

    compose(['up', '-d', '--wait', '--wait-timeout', '180', 'control-db', 'primary-db', 'standby-db', 'gateway'], { timeout: 240000 });
    const transition = 'bootstrap-' + randomUUID();
    c2Sql('control-db', `START TRANSACTION;
        SELECT revision FROM cluster_state WHERE namespace = '${PROJECT}' FOR UPDATE;
        INSERT INTO transition_journal (transition_id, namespace, action, step, status, owner_id,
            source_node, expected_revision, epoch, details)
        VALUES ('${transition}', '${PROJECT}', 'BOOTSTRAP_C2A', 'RESTORE', 'IN_PROGRESS',
            'bootstrap-host-${process.pid}', 'A', 1, 0, JSON_OBJECT('manifestId','${manifestId}'));
        UPDATE cluster_state SET transition_id = '${transition}', revision = revision + 1 WHERE namespace = '${PROJECT}';
        COMMIT;`, 'shoponline_control_c2a');

    const nodes = {};
    for (const [node, service, passwordKey, user, nodeId] of [
        ['A', 'primary-db', 'C2A_PRIMARY_READER_PASSWORD', 'c2a_reader_a', 'c2a-primary'],
        ['B', 'standby-db', 'C2A_STANDBY_READER_PASSWORD', 'c2a_reader_b', 'c2a-standby']
    ]) {
        const database = DB_NAMES[node];
        // Plain CREATE refuses an existing database and preserves partial failures.
        c2Sql(service, 'CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
        const onDisk = fs.readFileSync(artifact);
        if (validateDump(onDisk).sha256 !== manifest.dump.sha256) throw new Error('DUMP_CHECKSUM_MISMATCH');
        c2Sql(service, onDisk, database);
        c2Sql(service, fs.readFileSync(path.join(ROOT, 'database/runtime-schema.sql')), database);
        const uuid = c2Sql(service, 'SELECT @@server_uuid;').toString('utf8').trim();
        if (!/^[a-f0-9-]{36}$/i.test(uuid)) throw new Error('SERVER_UUID_INVALID');
        nodes[node] = { nodeId, database, serverUuid: uuid, manifestId };
        c2Sql(service, `INSERT INTO runtime_write_gate
            (singleton_id, namespace, node_id, database_name, server_uuid, manifest_id, transition_id)
            VALUES (1, '${PROJECT}', '${node}', '${database}', '${uuid}', '${manifestId}', '${transition}');
            CREATE USER '${user}'@'%' IDENTIFIED BY '${secrets[passwordKey]}';
            GRANT SELECT ON \`${database}\`.* TO '${user}'@'%';`, database);
        c2Sql(service, 'SET PERSIST super_read_only = ON; SET PERSIST read_only = ON;');
    }
    for (const node of ['A', 'B']) {
        c2Sql('control-db', `CREATE USER 'c2a_control_${node.toLowerCase()}'@'%' IDENTIFIED BY '${secrets['C2A_CONTROL_' + node + '_PASSWORD']}';
            GRANT SELECT ON shoponline_control_c2a.* TO 'c2a_control_${node.toLowerCase()}'@'%';`);
    }
    compose(['up', '-d', '--build', '--wait', '--wait-timeout', '180', 'primary-web', 'standby-web'], { timeout: 240000 });
    manifest.targets = {};
    for (const [node, service] of [['A', 'primary-web'], ['B', 'standby-web']]) {
        const actual = capture(PROJECT, service);
        requireSameSnapshot(manifest.source, actual);
        if (actual.identity.databaseName !== nodes[node].database ||
            actual.identity.serverUuid !== nodes[node].serverUuid ||
            actual.identity.readOnly !== 1 || actual.identity.superReadOnly !== 1) throw new Error('TARGET_SEAL_INVALID');
        manifest.targets[node] = actual;
    }
    completeBootstrap(manifest, transition, nodes, before);
}

function completeBootstrap(manifest, transition, nodes, before) {
    const manifestId = manifest.manifestId;
    const nodesJson = JSON.stringify(nodes);
    c2Sql('control-db', `START TRANSACTION;
        SELECT revision FROM cluster_state WHERE namespace = '${PROJECT}' FOR UPDATE;
        UPDATE cluster_state SET nodes = '${nodesJson}', transition_id = NULL,
            revision = revision + 1 WHERE namespace = '${PROJECT}' AND state = 'MAINTENANCE' AND active_writer IS NULL;
        ${['A', 'B'].map(node => `INSERT INTO snapshot_verifications
          (namespace,node_id,manifest_id,database_name,server_uuid,dump_sha256,business_sha256,schema_sha256,verified,sealed)
          VALUES ('${PROJECT}','${node}','${manifestId}','${nodes[node].database}','${nodes[node].serverUuid}',
           '${manifest.dump.sha256}','${manifest.source.businessSha256}','${manifest.source.schemaSha256}',TRUE,TRUE);`).join('\n')}
        UPDATE transition_journal SET step = 'SEALED', status = 'COMPLETE'
            WHERE transition_id = '${transition}';
        COMMIT;`, 'shoponline_control_c2a');
    const after = protectedBaseline();
    saveJson('protected-after-bootstrap.json', after);
    manifest.protectedUnchanged = isDeepStrictEqual(before, after);
    manifest.finishedAt = new Date().toISOString();
    manifest.status = 'VERIFIED_SEALED_MAINTENANCE';
    saveJson('snapshot-manifest.json', manifest);
    saveJson('bootstrap-complete.json', { project: PROJECT, manifestId, transition, nodes,
        protectedUnchanged: manifest.protectedUnchanged, state: 'MAINTENANCE', writer: null });
    if (!manifest.protectedUnchanged) throw new Error('PROTECTED_BASELINE_CHANGED_REQUIRES_REVIEW');
    console.log('PASS C2a bootstrap: two verified copies, closed gates, SELECT-only web accounts, MAINTENANCE.');
}

async function resumeBootstrap() {
    const manifest = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'snapshot-manifest.json'), 'utf8'));
    const before = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'protected-before.json'), 'utf8'));
    if (manifest.project !== PROJECT || !/^c2a-[a-f0-9-]{36}$/.test(manifest.manifestId)) throw new Error('MANIFEST_SCOPE_INVALID');
    const artifact = fs.readFileSync(path.join(RUNTIME, manifest.manifestId + '.sql'));
    if (validateDump(artifact).sha256 !== manifest.dump.sha256) throw new Error('DUMP_CHECKSUM_MISMATCH');
    const source = capture(PHASE_B, 'primary-web');
    if (source.businessSha256 !== manifest.source.businessSha256) throw new Error('SOURCE_CHANGED_DURING_RECOVERY');
    if (!manifest.source.schemaFingerprintVersion) {
        for (const [table, definition] of Object.entries(source.definitions)) {
            if (definition !== manifest.source.schema[table]) throw new Error('SOURCE_SCHEMA_CHANGED_DURING_RECOVERY');
        }
        manifest.schemaFingerprintUpgrade = { from: 1, to: 2,
            originalSha256: manifest.source.schemaSha256, checkedAt: new Date().toISOString() };
    } else {
        requireSameSnapshot(manifest.source, source);
    }
    manifest.source = source;
    const state = JSON.parse(c2Sql('control-db', `SELECT JSON_OBJECT('state',state,'writer',active_writer,
        'epoch',CAST(epoch AS CHAR),'transition',transition_id,'activation',activation_complete)
        FROM cluster_state WHERE namespace='${PROJECT}';`, 'shoponline_control_c2a'));
    if (state.state !== 'MAINTENANCE' || state.writer !== null || state.epoch !== '0' ||
        state.activation !== 0 || !/^bootstrap-[a-f0-9-]{36}$/.test(state.transition)) throw new Error('RECOVERY_STATE_INVALID');
    const nodes = {};
    manifest.targets = {};
    for (const [node, service, dbService, nodeId] of [
        ['A', 'primary-web', 'primary-db', 'c2a-primary'], ['B', 'standby-web', 'standby-db', 'c2a-standby']]) {
        const actual = capture(PROJECT, service);
        requireSameSnapshot(source, actual);
        const gate = JSON.parse(c2Sql(dbService, `SELECT JSON_OBJECT('enabled',enabled,
            'epoch',CAST(epoch AS CHAR),'namespace',namespace,'node',node_id,'database',database_name,
            'uuid',server_uuid,'manifest',manifest_id) FROM runtime_write_gate WHERE singleton_id=1;`, DB_NAMES[node]));
        if (actual.identity.databaseName !== DB_NAMES[node] || actual.identity.readOnly !== 1 ||
            actual.identity.superReadOnly !== 1 || gate.enabled !== 0 || gate.epoch !== '0' ||
            gate.namespace !== PROJECT || gate.node !== node || gate.database !== DB_NAMES[node] ||
            gate.uuid !== actual.identity.serverUuid || gate.manifest !== manifest.manifestId) throw new Error('RECOVERY_GATE_INVALID');
        nodes[node] = { nodeId, database: DB_NAMES[node], serverUuid: actual.identity.serverUuid, manifestId: manifest.manifestId };
        manifest.targets[node] = actual;
    }
    completeBootstrap(manifest, state.transition, nodes, before);
}

async function main() {
    assertGitBaseline();
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && !['--prepare', '--resume'].includes(args[0]))) throw new Error('ARGUMENTS_INVALID');
    if (args[0] === '--prepare') {
        initializeEnvironment();
        compose(['config', '--quiet']);
        console.log('PASS C2a environment preparation and static Compose validation.');
        return;
    }
    docker(['version', '--format', '{{.Server.Version}}']);
    fs.mkdirSync(RUNTIME, { recursive: true });
    const lockPath = path.join(RUNTIME, 'bootstrap.lock');
    const lock = fs.openSync(lockPath, 'wx');
    try {
        fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        if (args[0] === '--resume') await resumeBootstrap();
        else await bootstrap();
    } finally {
        fs.closeSync(lock);
        fs.unlinkSync(lockPath);
    }
}

if (require.main === module) main().catch(error => {
    console.error(error.message);
    console.error('C2a partial resources and artifacts are retained for inspection.');
    process.exitCode = 1;
});

module.exports = { requireSameSnapshot };
