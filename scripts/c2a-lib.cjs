const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME = path.join(ROOT, '.runtime', 'c2a');
const ENV_FILE = path.join(RUNTIME, 'compose.env');
const PROJECT = 'shoponline-c2a-20261118';
const PHASE_B = 'shoponline-test-b-20261117';
const COMPOSE = path.join(ROOT, 'compose.c2.test.yml');
const DB_NAMES = { A: 'shoponline_check_c2a_a_20261118', B: 'shoponline_check_c2a_b_20261118' };

function readEnvironment() {
    return Object.fromEntries(fs.readFileSync(ENV_FILE, 'utf8').trim().split(/\r?\n/).map(line => {
        const at = line.indexOf('=');
        return [line.slice(0, at), line.slice(at + 1)];
    }));
}

function redact(value) {
    let text = String(value);
    if (fs.existsSync(ENV_FILE)) {
        for (const [key, secret] of Object.entries(readEnvironment())) {
            if (key.endsWith('_PASSWORD')) text = text.split(secret).join('[redacted]');
        }
    }
    return text;
}

function docker(args, { input, timeout = 45000 } = {}) {
    const result = spawnSync('docker', args, {
        cwd: ROOT, input, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true
    });
    if (result.error || result.status !== 0) {
        throw new Error('DOCKER_COMMAND_FAILED ' + redact(result.error?.message || result.stderr?.toString('utf8')));
    }
    return result.stdout;
}

function compose(args, options) {
    return docker(['compose', '--env-file', ENV_FILE, '-f', COMPOSE, '-p', PROJECT, ...args], options);
}

function serviceId(project, service) {
    if (![PROJECT, PHASE_B].includes(project)) throw new Error('PROJECT_SCOPE_INVALID');
    const ids = docker(['ps', '-aq', '--filter', 'label=com.docker.compose.project=' + project,
        '--filter', 'label=com.docker.compose.service=' + service]).toString('utf8').trim().split(/\r?\n/).filter(Boolean);
    if (ids.length !== 1) throw new Error('SERVICE_ID_AMBIGUOUS ' + project + '/' + service);
    const [container] = JSON.parse(docker(['inspect', ids[0]]));
    if (container.Config.Labels['com.docker.compose.project'] !== project ||
        container.Config.Labels['com.docker.compose.service'] !== service) throw new Error('RESOURCE_SCOPE_INVALID');
    if (service.endsWith('-db') && !container.Mounts.some(m =>
        m.Destination === '/var/lib/mysql' && m.Type === 'volume' && m.Name.startsWith(project + '_'))) {
        throw new Error('VOLUME_SCOPE_INVALID');
    }
    return ids[0];
}

function c2Sql(service, sql, database) {
    if (!['primary-db', 'standby-db', 'control-db'].includes(service) ||
        (database && database !== 'shoponline_control_c2a' && !/^shoponline_check_c2a_[a-z0-9_]+$/.test(database))) {
        throw new Error('SQL_SCOPE_INVALID');
    }
    const command = 'export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"; exec mysql --user=root --default-character-set=utf8mb4 --batch --raw --skip-column-names' +
        (database ? ' ' + database : '');
    return docker(['exec', '-i', serviceId(PROJECT, service), 'sh', '-c', command], { input: sql });
}

function capture(project, service) {
    return JSON.parse(docker(['exec', serviceId(project, service), 'node', '/app/database/c2a-snapshot.cjs']));
}

// The program is passed as stdin. Every database statement is read-only.
const fingerprintProgram = `
const mysql = require('/app/backend/node_modules/mysql2/promise');
const { createHash } = require('node:crypto');
(async () => {
 const c = await mysql.createConnection({host: process.env.DB_HOST, user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, database: process.env.DB_NAME, dateStrings: true,
  supportBigNumbers: true, bigNumberStrings: true});
 try {
  await c.query("SET time_zone = '+00:00'");
  await c.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await c.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  const [[identity]] = await c.query('SELECT DATABASE() AS databaseName, @@server_uuid AS serverUuid, @@GLOBAL.read_only AS readOnly, @@GLOBAL.super_read_only AS superReadOnly');
  const [grants] = await c.query('SHOW GRANTS FOR CURRENT_USER()');
  const [tables] = await c.query('SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME');
  const data = {};
  for (const {name} of tables) {
   if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('TABLE_NAME_INVALID');
   const [[schema]] = await c.query('SHOW CREATE TABLE ' + name);
   const [rows] = await c.query('SELECT * FROM ' + name);
   const normalized = rows.map(row => JSON.stringify(row)).sort();
   data[name] = {count: rows.length, sha256: createHash('sha256').update(JSON.stringify([schema, normalized])).digest('hex')};
  }
  await c.commit();
  console.log(JSON.stringify({identity, grants, data}));
 } finally { await c.end(); }
})().catch(e => {console.error(e.code || e.message); process.exitCode=1;});
`;

function protectedBaseline() {
    const bIds = ['primary-web', 'standby-web', 'primary-db', 'standby-db'].map(s => serviceId(PHASE_B, s));
    const demoNames = ['primary-web', 'standby-web', 'primary-db', 'standby-db'];
    const containers = JSON.parse(docker(['inspect', ...demoNames, ...bIds]));
    const resources = containers.map(c => ({
        name: c.Name, id: c.Id, startedAt: c.State.StartedAt,
        mounts: c.Mounts, ports: c.HostConfig.PortBindings,
        configSha256: createHash('sha256').update(JSON.stringify(c.Config)).digest('hex')
    })).sort((a, b) => a.name.localeCompare(b.name));
    const fingerprints = {};
    for (const [name, id] of [['demo-A', 'primary-web'], ['demo-B', 'standby-web'],
        ['phase-b-A', bIds[0]], ['phase-b-B', bIds[1]]]) {
        fingerprints[name] = JSON.parse(docker(['exec', '-i', id, 'node', '-'], { input: fingerprintProgram }));
    }
    return { resources, fingerprints };
}

function saveJson(name, value) {
    fs.mkdirSync(RUNTIME, { recursive: true });
    fs.writeFileSync(path.join(RUNTIME, name), JSON.stringify(value, null, 2) + '\n');
}

function assertGitBaseline() {
    const options = { cwd: ROOT, encoding: 'utf8', windowsHide: true };
    const branch = spawnSync('git', ['branch', '--show-current'], options);
    const ancestry = spawnSync('git', ['merge-base', '--is-ancestor',
        '17c46552eb27a744c447bb7f323fb591e7f5058b', 'HEAD'], options);
    if (branch.status !== 0 || branch.stdout.trim() !== 'integration/shoponline-completion' ||
        ancestry.status !== 0) throw new Error('GIT_BASELINE_CHANGED');
}

module.exports = { ROOT, RUNTIME, ENV_FILE, PROJECT, PHASE_B, DB_NAMES,
    readEnvironment, docker, compose, serviceId, c2Sql, capture, protectedBaseline, saveJson, assertGitBaseline };
