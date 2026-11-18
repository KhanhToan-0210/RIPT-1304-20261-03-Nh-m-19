const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const mysql = require('mysql2/promise');
const { renderConfig } = require('./render-config.cjs');
const { validateState, WRITE_PROTOCOL } = require('./clusterState.cjs');

const namespace = 'shoponline-c2a-20261118';
const pool = mysql.createPool({
    host: process.env.CONTROL_DB_HOST, user: process.env.CONTROL_DB_USER,
    password: process.env.CONTROL_DB_PASSWORD, database: process.env.CONTROL_DB_NAME,
    connectTimeout: 1000, connectionLimit: 2, waitForConnections: false,
    supportBigNumbers: true, bigNumberStrings: true
});
let nginx;
let appliedHash;
let stopping = false;

function apply(route) {
    const text = renderConfig(route);
    const hash = createHash('sha256').update(text).digest('hex');
    if (appliedHash === hash) return;
    fs.mkdirSync('/state', { recursive: true });
    const file = '/state/g' + route.generation + '-' + hash + '.conf';
    if (!fs.existsSync(file)) fs.writeFileSync(file, text, { flag: 'wx' });
    if (fs.readFileSync(file, 'utf8') !== text) throw new Error('GATEWAY_BUNDLE_MISMATCH');
    const test = spawnSync('nginx', ['-t', '-c', file]);
    if (test.status !== 0) {
        console.error(test.stderr?.toString().slice(0, 1500));
        throw new Error('NGINX_CONFIG_INVALID');
    }
    const temporary = '/state/current-' + randomUUID();
    const previous = fs.existsSync('/state/current.conf') ? fs.readlinkSync('/state/current.conf') : null;
    fs.symlinkSync(file, temporary);
    fs.renameSync(temporary, '/state/current.conf');
    if (!nginx) {
        nginx = spawn('nginx', ['-c', '/state/current.conf', '-g', 'daemon off;'], { stdio: 'inherit' });
        nginx.on('exit', code => { if (!stopping) process.exit(code || 1); });
    } else {
        const reload = spawnSync('nginx', ['-s', 'reload', '-c', '/state/current.conf']);
        if (reload.status !== 0) {
            if (previous) {
                const rollback = '/state/rollback-' + randomUUID();
                fs.symlinkSync(previous, rollback);
                fs.renameSync(rollback, '/state/current.conf');
                spawnSync('nginx', ['-s', 'reload', '-c', '/state/current.conf']);
            }
            throw new Error('NGINX_RELOAD_FAILED');
        }
    }
    appliedHash = hash;
    fs.writeFileSync('/state/applied.json', JSON.stringify({ ...route, phase: 'reload_requested', configSha256: hash, file, time: new Date().toISOString() }) + '\n');
    console.log(JSON.stringify({ event: 'GATEWAY_RELOAD_REQUESTED', target: route.target, generation: route.generation, stage: route.stage, configSha256: hash }));
}

async function desiredRoute() {
    const maintenance = { target: null, generation: '0', stage: 'maintenance', transitionId: null, environment: 'test' };
    if (process.env.APP_ENV !== 'test' || process.env.CLUSTER_NAMESPACE !== namespace) return maintenance;
    const [rows] = await pool.query({ sql: 'SELECT * FROM cluster_state WHERE namespace=?', values: [namespace], timeout: 1000 });
    const state = validateState(rows.length === 1 ? rows[0] : null, namespace);
    if (state.protocol !== WRITE_PROTOCOL) return maintenance;
    const plan = state.nodes.gateway;
    if (!plan || !['A', 'B'].includes(plan.target) || String(plan.generation) !== state.gatewayGeneration) return maintenance;
    let intent;
    if (state.state === 'MAINTENANCE') {
        if (state.activeWriter !== null || state.transitionId !== plan.transitionId || !['candidate', 'armed'].includes(plan.stage)) return maintenance;
        intent = plan.stage === 'armed' ? 'promotion' : 'candidate';
    } else {
        if (state.activeWriter !== plan.target || !state.activationComplete) return maintenance;
        intent = 'active';
    }
    const host = plan.target === 'A' ? 'primary-web' : 'standby-web';
    const query = intent === 'active' ? '' : '?intent=' + intent + '&transition_id=' + plan.transitionId;
    const response = await fetch('http://' + host + ':3000/ready' + query, {
        headers: { Connection: 'close' }, signal: AbortSignal.timeout(2500)
    });
    if (!response.ok) return maintenance;
    const ready = await response.json();
    const binding = state.nodes[plan.target];
    if (ready.nodeId !== plan.target || ready.epoch !== state.epoch ||
        ready.database.databaseName !== binding.database || ready.database.serverUuid !== binding.serverUuid) return maintenance;
    return { target: plan.target, generation: state.gatewayGeneration, stage: intent === 'active' ? 'active' : plan.stage,
        transitionId: state.transitionId, epoch: state.epoch, environment: 'test' };
}

async function main() {
    apply({ target: null, generation: '0', stage: 'maintenance', transitionId: null, environment: 'test' });
    while (!stopping) {
        try { apply(await desiredRoute()); }
        catch (error) {
            console.error('GATEWAY_MAINTENANCE', error.code || error.message);
            apply({ target: null, generation: '0', stage: 'maintenance', transitionId: null, environment: 'test' });
        }
        await new Promise(resolve => setTimeout(resolve, 750));
    }
}

process.on('SIGTERM', () => { stopping = true; nginx?.kill('SIGTERM'); pool.end().finally(() => process.exit(0)); });
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
