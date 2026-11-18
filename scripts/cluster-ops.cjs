const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { validateDump } = require('../database/c2a-snapshot.cjs');
const { validateState, WRITE_PROTOCOL } = require('../backend/src/services/clusterState');
const { ROOT, RUNTIME, ENV_FILE, PROJECT, readEnvironment, docker, compose, serviceId,
    c2Sql, assertGitBaseline } = require('./c2a-lib.cjs');

const EVIDENCE = path.join(ROOT, '.runtime', 'evidence-20261118');
const BACKUPS = path.join(ROOT, '.runtime', 'c2-backups');
const LOCK = PROJECT + '.switch';
const service = node => node === 'A' ? 'primary-db' : 'standby-db';
const web = node => node === 'A' ? 'primary-web' : 'standby-web';
const slot = node => node === 'A' ? 'PRIMARY' : 'STANDBY';
const stamp = () => new Date().toISOString();

function save(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function updateEnvironment(changes) {
    const env = { ...readEnvironment(), ...changes };
    const temporary = ENV_FILE + '.next';
    fs.writeFileSync(temporary, Object.entries(env).map(([key, value]) => key + '=' + value).join('\n') + '\n');
    fs.renameSync(temporary, ENV_FILE);
    return env;
}

function secret(key) {
    const env = readEnvironment();
    if (env[key]) return env[key];
    const value = randomBytes(24).toString('hex');
    updateEnvironment({ [key]: value });
    return value;
}

async function http(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { Connection: 'close', ...options.headers }, signal: AbortSignal.timeout(10000) });
    return { status: response.status, data: await response.json() };
}

async function waitFor(check, seconds = 30) {
    const until = Date.now() + seconds * 1000;
    let last;
    do {
        try { const result = await check(); if (result) return result; } catch (error) { last = error; }
        await delay(350);
    } while (Date.now() < until);
    throw last || new Error('PRECONDITION_TIMEOUT');
}

function inspect(node, database) {
    const input = JSON.stringify({ host: service(node), database, user: 'c2_inspector_' + node.toLowerCase(),
        password: secret('C2_INSPECTOR_' + node + '_PASSWORD') });
    return JSON.parse(docker(['exec', '-i', serviceId(PROJECT, 'gateway'), 'node', '/app/database/inspect-c2.cjs'], { input }));
}

function compare(expected, actual) {
    if (expected.schemaSha256 !== actual.schemaSha256 || expected.businessSha256 !== actual.businessSha256) {
        throw new Error('SNAPSHOT_DATA_OR_SCHEMA_MISMATCH');
    }
}

function fence(node, binding, transition) {
    const db = binding.database;
    const dbService = service(node);
    const initial = JSON.parse(c2Sql(dbService, `SELECT JSON_OBJECT('enabled',enabled,'epoch',CAST(epoch AS CHAR),
        'readOnly',@@GLOBAL.read_only,'superReadOnly',@@GLOBAL.super_read_only)
        FROM runtime_write_gate WHERE singleton_id=1;`, db));
    const users = c2Sql(dbService, "SELECT User,account_locked FROM mysql.user WHERE User REGEXP '^c2_writer_[ab]_[0-9]+$';")
        .toString().trim().split(/\r?\n/).filter(Boolean).map(line => line.split('\t'));
    function killWriterSessions() {
        const sessions = c2Sql(dbService, "SELECT ID FROM information_schema.PROCESSLIST WHERE USER REGEXP '^c2_writer_[ab]_[0-9]+$';")
            .toString().trim().split(/\r?\n/).filter(Boolean);
        for (const id of sessions) {
            if (!/^\d+$/.test(id)) throw new Error('SESSION_SCOPE_INVALID');
            try { c2Sql(dbService, 'KILL CONNECTION ' + id + ';'); }
            catch (error) { if (!/1094|Unknown thread/.test(error.message)) throw error; }
        }
    }
    const needsAdminWrite = initial.enabled === 1 || users.some(([, locked]) => locked !== 'Y');
    if (needsAdminWrite && (initial.readOnly === 1 || initial.superReadOnly === 1)) {
        // The coordinator is already in MAINTENANCE. End old writer sessions
        // before the administrative window needed to persist the closed fence.
        killWriterSessions();
        c2Sql(dbService, 'SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;');
    }
    if (initial.enabled === 1) {
        c2Sql(dbService, `SET SESSION innodb_lock_wait_timeout=30;
            UPDATE runtime_write_gate SET enabled=FALSE, transition_id='${transition}'
            WHERE singleton_id=1 AND epoch=${binding.epoch || initial.epoch} AND namespace='${PROJECT}' AND database_name='${db}';`, db);
    }
    for (const [user, locked] of users) if (locked !== 'Y') c2Sql(dbService, `ALTER USER '${user}'@'%' ACCOUNT LOCK;`);
    killWriterSessions();
    c2Sql(dbService, 'SET GLOBAL super_read_only=ON; SET GLOBAL read_only=ON;');
    const proof = JSON.parse(c2Sql(dbService, `SELECT JSON_OBJECT(
        'database',DATABASE(),'uuid',@@server_uuid,'readOnly',@@GLOBAL.read_only,'superReadOnly',@@GLOBAL.super_read_only,
        'gateEnabled',(SELECT enabled FROM runtime_write_gate WHERE singleton_id=1),
        'epoch',(SELECT CAST(epoch AS CHAR) FROM runtime_write_gate WHERE singleton_id=1),
        'writerSessions',(SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER REGEXP '^c2_writer_[ab]_[0-9]+$'),
        'writerTransactions',(SELECT COUNT(*) FROM information_schema.INNODB_TRX t JOIN information_schema.PROCESSLIST p
            ON p.ID=t.trx_mysql_thread_id WHERE p.USER REGEXP '^c2_writer_[ab]_[0-9]+$'),
        'lockedAccounts',(SELECT COUNT(*) FROM mysql.user WHERE User REGEXP '^c2_writer_[ab]_[0-9]+$' AND account_locked='Y'),
        'unlockedAccounts',(SELECT COUNT(*) FROM mysql.user WHERE User REGEXP '^c2_writer_[ab]_[0-9]+$' AND account_locked<>'Y'));
        `, db));
    if (proof.uuid !== binding.serverUuid || proof.database !== db || proof.readOnly !== 1 || proof.superReadOnly !== 1 ||
        proof.gateEnabled !== 0 || proof.writerSessions !== 0 || proof.writerTransactions !== 0 || proof.unlockedAccounts !== 0) {
        throw new Error('SOURCE_FENCE_NOT_PROVEN');
    }
    return { ...proof, verifiedAt: stamp() };
}

function backup(node, binding, mode, transition) {
    const before = inspect(node, binding.database);
    const id = 'snapshot-' + randomUUID();
    const startedAt = stamp();
    const command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysqldump --user=root --default-character-set=utf8mb4 --single-transaction --quick --skip-lock-tables --skip-add-drop-table --no-tablespaces --set-gtid-purged=OFF ' + binding.database;
    const bytes = docker(['exec', serviceId(PROJECT, service(node)), 'sh', '-c', command]);
    const dump = validateDump(bytes, { requireRuntime: true });
    const after = inspect(node, binding.database);
    compare(before, after);
    fs.mkdirSync(BACKUPS, { recursive: true });
    const sqlFile = path.join(BACKUPS, id + '.sql');
    fs.writeFileSync(sqlFile, bytes, { flag: 'wx' });
    const manifest = { id, node, project: PROJECT, database: binding.database, serverUuid: binding.serverUuid,
        mode, transition, startedAt, finishedAt: stamp(), dump, snapshot: after, sqlFile };
    save(path.join(BACKUPS, id + '.json'), manifest);
    return manifest;
}

function restore(node, manifest, epoch, transition, username) {
    const dbService = service(node);
    const database = 'shoponline_check_c2a_' + node.toLowerCase() + '_r_' + Date.now() + '_' + randomBytes(3).toString('hex');
    const bytes = fs.readFileSync(manifest.sqlFile);
    if (validateDump(bytes, { requireRuntime: true }).sha256 !== manifest.dump.sha256) throw new Error('DUMP_CHECKSUM_MISMATCH');
    c2Sql(dbService, 'SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;');
    c2Sql(dbService, 'CREATE DATABASE `' + database + '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;');
    c2Sql(dbService, bytes, database);
    const uuid = c2Sql(dbService, 'SELECT @@server_uuid;').toString().trim();
    const inspector = 'c2_inspector_' + node.toLowerCase();
    const readerPassword = secret('C2_INSPECTOR_' + node + '_PASSWORD');
    c2Sql(dbService, `CREATE USER IF NOT EXISTS '${inspector}'@'%' IDENTIFIED BY '${readerPassword}';
        GRANT SELECT ON \`${database}\`.* TO '${inspector}'@'%';
        UPDATE runtime_write_gate SET node_id='${node}', database_name='${database}', server_uuid='${uuid}',
            epoch=${epoch}, enabled=FALSE, manifest_id='${manifest.id}', transition_id='${transition}' WHERE singleton_id=1;`, database);
    let writerPassword;
    if (username) {
        writerPassword = secret('C2_WRITER_' + node + '_' + epoch + '_PASSWORD');
        c2Sql(dbService, `CREATE USER '${username}'@'%' IDENTIFIED BY '${writerPassword}';
            GRANT SELECT ON \`${database}\`.* TO '${username}'@'%';
            ${Object.entries({ products: 'INSERT, UPDATE, DELETE', orders: 'INSERT, UPDATE',
                order_items: 'INSERT', runtime_write_receipts: 'INSERT, UPDATE' }).map(([table, rights]) =>
                'GRANT ' + rights + ' ON `' + database + '`.`' + table + '` TO \'' + username + '\'@\'%\';').join('\n')}`);
    }
    c2Sql(dbService, 'SET GLOBAL super_read_only=ON; SET GLOBAL read_only=ON;');
    const actual = inspect(node, database);
    compare(manifest.snapshot, actual);
    return { nodeId: node === 'A' ? 'c2a-primary' : 'c2a-standby', database, serverUuid: uuid,
        manifestId: manifest.id, epoch: String(epoch), username: username || inspector, writerPassword, actual };
}

async function coordinator() {
    const runtimeModule = path.join(ROOT, '.runtime', 'c2-cli-deps', 'node_modules', 'mysql2', 'promise.js');
    const mysql = fs.existsSync(runtimeModule) ? require(runtimeModule) : require('mysql2/promise');
    const connection = await mysql.createConnection({ host: '127.0.0.1', port: 18106, user: 'c2_coordinator',
        password: secret('C2_COORDINATOR_PASSWORD'), database: 'shoponline_control_c2a',
        supportBigNumbers: true, bigNumberStrings: true, connectTimeout: 5000 });
    const [[lock]] = await connection.query('SELECT GET_LOCK(?,0) AS acquired, CONNECTION_ID() AS owner', [LOCK]);
    if (Number(lock.acquired) !== 1) { await connection.end(); throw new Error('TRANSITION_BUSY'); }
    async function assertOwner() {
        const [[row]] = await connection.query('SELECT IS_USED_LOCK(?) AS owner, CONNECTION_ID() AS currentOwner', [LOCK]);
        if (String(row.owner) !== String(row.currentOwner)) throw new Error('COORDINATOR_LOCK_LOST');
    }
    async function state() {
        await assertOwner();
        const [[row]] = await connection.query('SELECT * FROM cluster_state WHERE namespace=?', [PROJECT]);
        return validateState(row, PROJECT);
    }
    return { connection, state, assertOwner, owner: String(lock.owner), close: () => connection.end() };
}

async function journalStep(owner, id, step, details) {
    await owner.assertOwner();
    await owner.connection.query('UPDATE transition_journal SET step=?,details=JSON_MERGE_PATCH(details,?) WHERE transition_id=? AND status=\'IN_PROGRESS\'',
        [step, JSON.stringify(details), id]);
}

async function routePlan(owner, target, epoch, generation, transition, stage, binding) {
    const state = await owner.state();
    const nodes = { ...state.nodes, [target]: binding || state.nodes[target],
        gateway: { target, generation, transitionId: transition, stage } };
    await owner.connection.query('UPDATE cluster_state SET nodes=?,revision=revision+1 WHERE namespace=? AND state=\'MAINTENANCE\' AND transition_id=? AND epoch=?',
        [JSON.stringify(nodes), PROJECT, transition, epoch]);
}

async function waitRoute(target, generation, transition, stage) {
    return waitFor(async () => {
        const route = await http('http://127.0.0.1:18080/gateway/status');
        if (route.status !== 200 || route.data.target !== target || route.data.generation !== generation || route.data.stage !== stage) return false;
        const candidate = await http('http://127.0.0.1:18080/__candidate');
        if (candidate.status !== 200 || candidate.data.nodeId !== target || candidate.data.generation !== generation) return false;
        const workers = docker(['exec', serviceId(PROJECT, 'gateway'), 'ps', '-o', 'args']).toString();
        if (workers.includes('worker process is shutting down')) return false;
        return { route: route.data, readiness: candidate.data, observedAt: stamp() };
    }, 30);
}

async function rebindReader(owner, node, binding) {
    const prefix = 'C2A_' + slot(node);
    updateEnvironment({ [prefix + '_DB_NAME']: binding.database, [prefix + '_DB_USER']: 'c2_inspector_' + node.toLowerCase(),
        [prefix + '_READER_PASSWORD']: secret('C2_INSPECTOR_' + node + '_PASSWORD'), [prefix + '_EPOCH']: binding.epoch || '0' });
    compose(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', web(node)], { timeout: 120000 });
    const state = await owner.state();
    state.nodes[node].username = 'c2_inspector_' + node.toLowerCase();
    await owner.connection.query('UPDATE cluster_state SET nodes=?,revision=revision+1 WHERE namespace=?', [JSON.stringify(state.nodes), PROJECT]);
}

async function transitionTo(target, { initial = false } = {}) {
    const owner = await coordinator();
    const id = 'transition-' + randomUUID();
    const evidence = { id, target, initial, startedAt: stamp(), events: [] };
    let published = false;
    try {
        const before = await owner.state();
        if (before.transitionId || (initial ? before.state !== 'MAINTENANCE' || before.activeWriter !== null : !before.activeWriter || before.activeWriter === target)) {
            throw new Error('TRANSITION_PRECONDITION_FAILED');
        }
        const source = before.activeWriter || before.nodes.canonicalSource || 'A';
        const epoch = (BigInt(before.epoch) + 1n).toString();
        const generation = (BigInt(before.gatewayGeneration) + 1n).toString();
        evidence.source = source;
        evidence.sourceBinding = before.nodes[source];
        await owner.connection.beginTransaction();
        await owner.connection.query('SELECT revision FROM cluster_state WHERE namespace=? FOR UPDATE', [PROJECT]);
        await owner.connection.query(`INSERT INTO transition_journal (transition_id,namespace,action,step,status,owner_id,
            source_node,target_node,expected_revision,epoch,details) VALUES (?,?,?,'FREEZE','IN_PROGRESS',?,?,?,?,?,?)`,
        [id, PROJECT, initial ? 'INITIAL_ACTIVATION' : 'SWITCH', owner.owner, source, target, before.revision, epoch,
            JSON.stringify({ sourceBinding: before.nodes[source], beforeState: before, ownerPid: process.pid,
                oldEpoch: before.epoch, canonicalSource: source, startedAt: evidence.startedAt })]);
        const [frozen] = await owner.connection.query(`UPDATE cluster_state SET state='MAINTENANCE',active_writer=NULL,
            activation_complete=FALSE,transition_id=?,epoch=?,gateway_generation=?,revision=revision+1,
            nodes=JSON_SET(nodes,'$.gateway',JSON_OBJECT('target',NULL,'stage','maintenance','generation',?))
            WHERE namespace=? AND revision=?`, [id, epoch, generation, generation, PROJECT, before.revision]);
        if (frozen.affectedRows !== 1) throw new Error('STATE_REVISION_CONFLICT');
        await owner.connection.commit();
        evidence.frozenAt = stamp();
        await owner.assertOwner();
        evidence.sourceFence = fence(source, before.nodes[source], id);
        if (source !== target) evidence.targetFence = fence(target, before.nodes[target], id);
        else evidence.targetFence = fence('B', before.nodes.B, id);
        await journalStep(owner, id, 'FENCED', { sourceFence: evidence.sourceFence, targetFence: evidence.targetFence });
        const manifest = backup(source, before.nodes[source], 'frozen', id);
        evidence.snapshot = { id: manifest.id, sqlFile: manifest.sqlFile, dump: manifest.dump, startedAt: manifest.startedAt, finishedAt: manifest.finishedAt };
        await owner.assertOwner();
        const username = 'c2_writer_' + target.toLowerCase() + '_' + epoch;
        const restored = restore(target, manifest, epoch, id, username);
        const { writerPassword, actual, ...binding } = restored;
        evidence.targetBinding = binding;
        evidence.comparison = { schema: actual.schemaSha256, data: actual.businessSha256, expectedSchema: manifest.snapshot.schemaSha256,
            expectedData: manifest.snapshot.businessSha256, counts: Object.fromEntries(Object.entries(actual.data).map(([t, d]) => [t, d.count])), result: 'PASS' };
        await owner.connection.query(`INSERT INTO snapshot_verifications (namespace,node_id,manifest_id,database_name,server_uuid,dump_sha256,
            business_sha256,schema_sha256,verified,sealed) VALUES (?,?,?,?,?,?,?,?,TRUE,TRUE)
            ON DUPLICATE KEY UPDATE manifest_id=VALUES(manifest_id),database_name=VALUES(database_name),server_uuid=VALUES(server_uuid),
            dump_sha256=VALUES(dump_sha256),business_sha256=VALUES(business_sha256),schema_sha256=VALUES(schema_sha256),verified=TRUE,sealed=TRUE,verified_at=CURRENT_TIMESTAMP(6)`,
        [PROJECT, target, manifest.id, binding.database, binding.serverUuid, manifest.dump.sha256, actual.businessSha256, actual.schemaSha256]);
        await routePlan(owner, target, epoch, generation, id, 'candidate', binding);
        const prefix = 'C2A_' + slot(target);
        updateEnvironment({ [prefix + '_DB_NAME']: binding.database, [prefix + '_DB_USER']: username,
            [prefix + '_READER_PASSWORD']: writerPassword, [prefix + '_EPOCH']: epoch });
        compose(['up', '-d', '--no-deps', '--wait', '--wait-timeout', '90', web(target)], { timeout: 120000 });
        evidence.candidate = await waitRoute(target, generation, id, 'candidate');
        await journalStep(owner, id, 'ROUTE_VERIFIED', { binding, comparison: evidence.comparison, candidateAt: stamp() });
        await owner.assertOwner();
        if (source !== target) evidence.finalSourceFence = fence(source, before.nodes[source], id);
        c2Sql(service(target), `SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;
            UPDATE runtime_write_gate SET enabled=TRUE WHERE singleton_id=1 AND epoch=${epoch} AND transition_id='${id}';`, binding.database);
        await owner.connection.query('UPDATE snapshot_verifications SET sealed=FALSE WHERE namespace=? AND node_id=?', [PROJECT, target]);
        await routePlan(owner, target, epoch, generation, id, 'armed');
        evidence.armedRoute = await waitRoute(target, generation, id, 'armed');
        await owner.assertOwner();
        await owner.connection.beginTransaction();
        await owner.connection.query('SELECT revision FROM cluster_state WHERE namespace=? FOR UPDATE', [PROJECT]);
        const state = target === 'A' ? 'PRIMARY_ACTIVE' : 'STANDBY_ACTIVE';
        const [publishedState] = await owner.connection.query(`UPDATE cluster_state SET state=?,active_writer=?,activation_complete=TRUE,
            transition_id=NULL,revision=revision+1,nodes=JSON_SET(nodes,'$.gateway.stage','active','$.canonicalSource',?)
            WHERE namespace=? AND state='MAINTENANCE' AND epoch=? AND transition_id=?`, [state, target, target, PROJECT, epoch, id]);
        if (publishedState.affectedRows !== 1) throw new Error('PUBLISH_REVISION_CONFLICT');
        await owner.connection.query(`UPDATE transition_journal SET step='PUBLISHED',status='COMPLETE',
            details=JSON_MERGE_PATCH(details,?) WHERE transition_id=?`, [JSON.stringify({ publishedAt: stamp(), targetBinding: binding,
                canonicalSource: target, comparison: evidence.comparison }), id]);
        await owner.connection.commit();
        published = true;
        evidence.publishedAt = stamp();
        evidence.ready = await waitFor(async () => {
            const r = await http('http://127.0.0.1:18080/ready');
            return r.status === 200 && r.data.nodeId === target && r.data.database.databaseName === binding.database && r;
        });
        evidence.serviceRestoredAt = stamp();
        if (source !== target) {
            // Bring the old web back once with its stale writer account, then test denial.
            compose(['start', web(source)]);
            const denied = await waitFor(async () => {
                const port = source === 'A' ? 18100 : 18101;
                const r = await http('http://127.0.0.1:' + port + '/api/products', { method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'stale-' + id },
                    body: JSON.stringify({ name: 'blocked stale writer', price: 1 }) });
                return r.status === 503 && r.data.code === 'NODE_INACTIVE' && r;
            });
            evidence.staleSourceDenied = denied;
            await rebindReader(owner, source, before.nodes[source]);
        }
        evidence.finishedAt = stamp();
        evidence.result = 'PASS';
        save(path.join(EVIDENCE, id + '.json'), evidence);
        save(path.join(EVIDENCE, 'latest-transition.json'), evidence);
        console.log(JSON.stringify({ result: 'PASS', target, database: binding.database, epoch, transition: id,
            evidence: path.relative(ROOT, path.join(EVIDENCE, id + '.json')) }));
        return evidence;
    } catch (error) {
        evidence.result = 'FAIL';
        evidence.error = error.message;
        evidence.published = published;
        evidence.failedAt = stamp();
        save(path.join(EVIDENCE, id + '.json'), evidence);
        // A pending or uncertain publish is reconciled from durable state, never by routing to an old DB.
        throw error;
    } finally { await owner.close(); }
}

async function onlineBackup() {
    const owner = await coordinator();
    try {
        const state = await owner.state();
        if (!state.activeWriter || state.transitionId) throw new Error('ACTIVE_WRITER_REQUIRED');
        const manifest = backup(state.activeWriter, state.nodes[state.activeWriter], 'online', null);
        save(path.join(EVIDENCE, 'latest-online-backup.json'), { ...manifest, sqlFile: path.relative(ROOT, manifest.sqlFile) });
        console.log(JSON.stringify({ result: 'PASS', snapshot: manifest.id, node: state.activeWriter, database: manifest.database, dump: manifest.dump }));
        return manifest;
    } finally { await owner.close(); }
}

async function abortPending() {
    const owner = await coordinator();
    try {
        const state = await owner.state();
        if (state.state !== 'MAINTENANCE' || state.activeWriter !== null || !state.transitionId) throw new Error('NO_UNPUBLISHED_TRANSITION');
        const [[journal]] = await owner.connection.query('SELECT * FROM transition_journal WHERE transition_id=?', [state.transitionId]);
        const details = typeof journal.details === 'string' ? JSON.parse(journal.details) : journal.details;
        if (journal.status !== 'IN_PROGRESS' || !details.beforeState || !details.sourceBinding) throw new Error('RECOVERY_JOURNAL_INVALID');
        if (details.ownerPid && details.ownerPid !== process.pid) {
            let alive = false;
            try { process.kill(details.ownerPid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
            if (alive) throw new Error('PREVIOUS_OWNER_STILL_ALIVE');
        }
        for (const node of ['A', 'B']) {
            const unfinished = Number(c2Sql(service(node), `SELECT COUNT(*) FROM information_schema.PROCESSLIST p
                LEFT JOIN information_schema.INNODB_TRX t ON t.trx_mysql_thread_id=p.ID
                WHERE p.USER='root' AND p.ID<>CONNECTION_ID()
                  AND (t.trx_id IS NOT NULL OR (p.COMMAND<>'Sleep' AND COALESCE(p.INFO,'')<>'SELECT 1'));`).toString().trim());
            if (unfinished !== 0) throw new Error('ADMIN_COMMAND_STILL_RUNNING');
        }
        const proofs = {};
        for (const node of ['A', 'B']) proofs[node] = fence(node, state.nodes[node], state.transitionId);
        const source = details.canonicalSource;
        const nodes = { ...state.nodes, [source]: details.sourceBinding, canonicalSource: source,
            gateway: { target: null, stage: 'maintenance', generation: (BigInt(state.gatewayGeneration) + 1n).toString() } };
        await owner.connection.beginTransaction();
        await owner.connection.query(`UPDATE cluster_state SET nodes=?,transition_id=NULL,revision=revision+1,
            epoch=epoch+1,gateway_generation=gateway_generation+1 WHERE namespace=? AND state='MAINTENANCE' AND transition_id=?`,
        [JSON.stringify(nodes), PROJECT, state.transitionId]);
        await owner.connection.query(`UPDATE transition_journal SET status='FAILED',step='ABORTED_ZERO_WRITER',
            details=JSON_MERGE_PATCH(details,?) WHERE transition_id=?`,
        [JSON.stringify({ recoveryAt: stamp(), recoveryOwner: owner.owner, recoveryProofs: proofs, canonicalSource: source }), state.transitionId]);
        await owner.connection.commit();
        save(path.join(EVIDENCE, 'recovery-' + state.transitionId + '.json'), { result: 'PASS', source, proofs, time: stamp(), writer: null });
        console.log('PASS rollback to MAINTENANCE with zero writer; canonical data source ' + source + ' retained.');
    } finally { await owner.close(); }
}

async function restoreCheck() {
    const owner = await coordinator();
    try {
        const state = await owner.state();
        if (!state.activeWriter || state.transitionId) throw new Error('ACTIVE_WRITER_REQUIRED');
        const target = state.activeWriter === 'A' ? 'B' : 'A';
        const id = 'restore-check-' + randomUUID();
        const proof = fence(target, state.nodes[target], id);
        const manifest = backup(state.activeWriter, state.nodes[state.activeWriter], 'online-restore-check', id);
        const restored = restore(target, manifest, (BigInt(state.epoch) + 1n).toString(), id, null);
        const evidence = { result: 'PASS', time: stamp(), source: state.activeWriter, target,
            sourceDatabase: manifest.database, restoredDatabase: restored.database, snapshotId: manifest.id,
            dump: manifest.dump, targetFence: proof, comparison: {
                schemaSha256: restored.actual.schemaSha256, businessSha256: restored.actual.businessSha256,
                counts: Object.fromEntries(Object.entries(restored.actual.data).map(([t, v]) => [t, v.count])) },
            servingDatabaseChanged: false };
        save(path.join(EVIDENCE, id + '.json'), evidence);
        console.log(JSON.stringify(evidence));
        return evidence;
    } finally { await owner.close(); }
}

async function setup() {
    const state = JSON.parse(c2Sql('control-db', `SELECT JSON_OBJECT('state',state,'writer',active_writer,'transition',transition_id)
        FROM cluster_state WHERE namespace='${PROJECT}';`, 'shoponline_control_c2a'));
    if (state.state !== 'MAINTENANCE' || state.writer !== null || state.transition) throw new Error('SETUP_REQUIRES_MAINTENANCE');
    const adminPassword = secret('C2_COORDINATOR_PASSWORD');
    const gatewayPassword = secret('C2_GATEWAY_PASSWORD');
    c2Sql('control-db', `CREATE USER IF NOT EXISTS 'c2_coordinator'@'%' IDENTIFIED BY '${adminPassword}';
        GRANT ALL PRIVILEGES ON shoponline_control_c2a.* TO 'c2_coordinator'@'%';
        CREATE USER IF NOT EXISTS 'c2_gateway_reader'@'%' IDENTIFIED BY '${gatewayPassword}';
        GRANT SELECT ON shoponline_control_c2a.* TO 'c2_gateway_reader'@'%';`);
    for (const node of ['A', 'B']) {
        const password = secret('C2_INSPECTOR_' + node + '_PASSWORD');
        const name = 'c2_inspector_' + node.toLowerCase();
        const db = node === 'A' ? 'shoponline_check_c2a_a_20261118' : 'shoponline_check_c2a_b_20261118';
        c2Sql(service(node), `SET GLOBAL super_read_only=OFF; SET GLOBAL read_only=OFF;
            CREATE USER IF NOT EXISTS '${name}'@'%' IDENTIFIED BY '${password}';
            GRANT SELECT ON \`${db}\`.* TO '${name}'@'%';
            SET GLOBAL super_read_only=ON; SET GLOBAL read_only=ON;`);
    }
    c2Sql('control-db', `UPDATE cluster_state SET protocol='${WRITE_PROTOCOL}',revision=revision+1
        WHERE namespace='${PROJECT}' AND state='MAINTENANCE' AND active_writer IS NULL;`, 'shoponline_control_c2a');
    updateEnvironment({ C2_CLUSTER_MODE: 'c2' });
    compose(['config', '--quiet']);
    compose(['up', '-d', '--build', '--wait', '--wait-timeout', '180'], { timeout: 600000 });
    console.log('PASS C2 runtime deployed in MAINTENANCE with zero writer.');
}

async function main() {
    assertGitBaseline();
    const [command, target] = process.argv.slice(2);
    if (command === 'setup') return setup();
    if (command === 'activate' && target === 'A') return transitionTo('A', { initial: true });
    if (command === 'switch' && ['A', 'B'].includes(target)) return transitionTo(target);
    if (command === 'backup' && !target) return onlineBackup();
    if (command === 'abort' && !target) return abortPending();
    if (command === 'restore-check' && !target) return restoreCheck();
    throw new Error('Usage: cluster-ops.cjs setup | activate A | switch A|B | backup | abort | restore-check');
}

if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { compare, fence, restore, inspect, http, waitFor, coordinator, transitionTo, onlineBackup, restoreCheck, EVIDENCE };
