const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ROOT, RUNTIME, PROJECT, DB_NAMES, docker, compose, serviceId,
    c2Sql, capture, protectedBaseline, saveJson, assertGitBaseline } = require('./c2a-lib.cjs');

async function request(base, route, method = 'GET', body) {
    const r = await fetch(base + route, {
        method, signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json', Connection: 'close', 'X-Active-Writer': 'A',
            'X-ShopOnline-Gateway-Generation': '999', 'X-Cluster-State': 'PRIMARY_ACTIVE' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return { status: r.status, body: await r.json() };
}

function runtimeState(service, database) {
    return JSON.parse(c2Sql(service, `SELECT JSON_OBJECT(
        'readOnly', @@GLOBAL.read_only, 'superReadOnly', @@GLOBAL.super_read_only,
        'actualDatabase', DATABASE(), 'serverUuid', @@server_uuid,
        'gateCount', (SELECT COUNT(*) FROM runtime_write_gate),
        'enabled', (SELECT enabled FROM runtime_write_gate WHERE singleton_id=1),
        'epoch', (SELECT CAST(epoch AS CHAR) FROM runtime_write_gate WHERE singleton_id=1),
        'receipts', (SELECT COUNT(*) FROM runtime_write_receipts),
        'tableCount', (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()));`, database));
}

async function main() {
    assertGitBaseline();
    docker(['version', '--format', '{{.Server.Version}}']);
    const boot = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'bootstrap-complete.json'), 'utf8'));
    assert.equal(boot.project, PROJECT);
    const protectedBefore = protectedBaseline();
    const dataBefore = { A: capture(PROJECT, 'primary-web'), B: capture(PROJECT, 'standby-web') };
    const initial = await request('http://127.0.0.1:18100', '/cluster/status');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.state, 'MAINTENANCE');
    assert.equal(initial.body.activeWriter, null);
    const results = [];
    async function check(id, work) {
        try {
            const details = await work();
            results.push({ id, status: 'PASS', details });
            console.log('PASS ' + id);
        } catch (error) {
            results.push({ id, status: 'FAIL', error: error.message });
            console.error('FAIL ' + id + ' ' + error.message);
        }
    }

    await check('C2A-01 isolated services, network and volumes', async () => {
        const ids = ['primary-web', 'standby-web', 'primary-db', 'standby-db', 'control-db', 'gateway'].map(s => serviceId(PROJECT, s));
        const containers = JSON.parse(docker(['inspect', ...ids]));
        const volumes = new Set();
        for (const container of containers) {
            assert.equal(container.State.Status, 'running');
            assert.equal(container.State.Health.Status, 'healthy');
            assert.ok(Object.keys(container.NetworkSettings.Networks).every(n => n.startsWith(PROJECT + '_')));
            for (const mount of container.Mounts.filter(m => m.Destination === '/var/lib/mysql')) volumes.add(mount.Name);
            if (container.Config.Labels['com.docker.compose.service'].endsWith('-db')) {
                assert.equal(Object.keys(container.HostConfig.PortBindings || {}).length, 0);
            }
        }
        assert.equal(volumes.size, 3);
        return { services: 6, volumes: [...volumes] };
    });

    await check('C2A-02 control schema, journal and writer constraints', async () => {
        const tables = c2Sql('control-db', 'SHOW TABLES;', 'shoponline_control_c2a').toString('utf8').trim().split(/\r?\n/).sort();
        assert.deepEqual(tables, ['cluster_state', 'snapshot_verifications', 'transition_journal']);
        const journal = c2Sql('control-db', "SELECT status, step FROM transition_journal WHERE action='BOOTSTRAP_C2A';", 'shoponline_control_c2a').toString('utf8').trim();
        assert.equal(journal, 'COMPLETE\tSEALED');
        for (const update of ["active_writer = 'A'", "state = 'PRIMARY_ACTIVE', active_writer = NULL, activation_complete = TRUE, epoch = 1"]) {
            assert.throws(() => c2Sql('control-db', `UPDATE cluster_state SET ${update} WHERE namespace='${PROJECT}';`, 'shoponline_control_c2a'), /3819|chk_cluster_writer/);
        }
        assert.equal((await request('http://127.0.0.1:18100', '/cluster/status')).body.activeWriter, null);
    });

    await check('C2A-03 runtime initialization and verified source snapshot', async () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'snapshot-manifest.json'), 'utf8'));
        for (const [node, service] of [['A', 'primary-db'], ['B', 'standby-db']]) {
            const actual = runtimeState(service, DB_NAMES[node]);
            assert.equal(actual.tableCount, 5);
            assert.equal(actual.actualDatabase, boot.nodes[node].database);
            assert.equal(actual.serverUuid, boot.nodes[node].serverUuid);
            assert.equal(actual.enabled, 0);
            assert.equal(actual.epoch, '0');
            assert.equal(actual.gateCount, 1);
            assert.equal(actual.receipts, 0);
            assert.equal(actual.readOnly, 1);
            assert.equal(actual.superReadOnly, 1);
            assert.equal(dataBefore[node].schemaSha256, manifest.source.schemaSha256);
            assert.equal(dataBefore[node].businessSha256, manifest.source.businessSha256);
        }
    });

    await check('C2A-04 gateway maintenance default', async () => {
        compose(['exec', '-T', 'gateway', 'nginx', '-t']);
        assert.equal((await request('http://127.0.0.1:18080', '/live')).status, 200);
        for (const [route, method] of [['/', 'GET'], ['/api/products', 'POST'], ['/api/orders', 'POST'], ['/ready', 'GET']]) {
            const r = await request('http://127.0.0.1:18080', route, method, method === 'POST' ? {} : undefined);
            assert.equal(r.status, 503);
            assert.equal(r.body.code, 'MAINTENANCE');
            assert.equal(r.body.writer, null);
        }
    });

    await check('C2A-05 direct ports and all mutation routes remain closed', async () => {
        const calls = [
            ['/api/products', 'POST', { name: 'C2a blocked product', price: 1000, stock: 5 }],
            ['/api/products/1', 'PUT', { name: 'C2a blocked update' }],
            ['/api/products/1', 'PATCH', { stock: 1 }],
            ['/api/products/1', 'DELETE'],
            ['/api/orders', 'POST', { customerName: 'C2a', customerPhone: '0900000000', customerAddress: 'TEST', items: [{ id: 1, quantity: 1 }] }],
            ['/future-write', 'POST', {}]
        ];
        for (const base of ['http://127.0.0.1:18100', 'http://127.0.0.1:18101']) {
            assert.equal((await request(base, '/live')).status, 200);
            const health = await request(base, '/health');
            assert.equal(health.status, 200);
            assert.equal(health.body.environment, 'test');
            assert.equal(health.body.database.gate.enabled, false);
            assert.equal((await request(base, '/ready')).status, 503);
            for (const [route, method, body] of calls) {
                const r = await request(base, route, method, body);
                assert.equal(r.status, 503);
                assert.equal(r.body.code, 'MAINTENANCE');
            }
        }
    });

    await check('C2A-06 database and coordinator accounts have SELECT only', async () => {
        const program = `
         const mysql=require('/app/backend/node_modules/mysql2/promise');
         (async()=>{for(const control of [false,true]) {
          const c=await mysql.createConnection({host:process.env[control?'CONTROL_DB_HOST':'DB_HOST'],
           user:process.env[control?'CONTROL_DB_USER':'DB_USER'],password:process.env[control?'CONTROL_DB_PASSWORD':'DB_PASSWORD'],
           database:process.env[control?'CONTROL_DB_NAME':'DB_NAME']});
          try {const [grants]=await c.query('SHOW GRANTS FOR CURRENT_USER()');
           const text=JSON.stringify(grants);
           if (/GRANT (?:ALL|INSERT|UPDATE|DELETE|CREATE)/.test(text) || !text.includes('GRANT SELECT')) throw Error('EXCESS_PRIVILEGES');
           let denied=false;try {await c.query(control?'UPDATE cluster_state SET revision=revision':'UPDATE products SET stock=stock WHERE id=0');}
           catch(e) {if(['ER_TABLEACCESS_DENIED_ERROR','ER_OPTION_PREVENTS_STATEMENT'].includes(e.code)) denied=true;else throw e;}
           if(!denied) throw Error('DML_NOT_DENIED');
          } finally {await c.end();}
         }console.log('SELECT_ONLY');})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});`;
        for (const service of ['primary-web', 'standby-web']) {
            assert.equal(docker(['exec', '-i', serviceId(PROJECT, service), 'node', '-'], { input: program }).toString('utf8').trim(), 'SELECT_ONLY');
        }
    });

    await check('C2A-07 control database outage fails closed and recovers', async () => {
        try {
            compose(['stop', '--timeout', '5', 'control-db']);
            for (const base of ['http://127.0.0.1:18100', 'http://127.0.0.1:18101']) {
                const r = await request(base, '/api/products', 'POST', { name: 'Blocked during outage', price: 1 });
                assert.equal(r.status, 503);
                assert.equal(r.body.code, 'COORDINATOR_UNAVAILABLE');
                assert.equal((await request(base, '/cluster/status')).status, 503);
            }
            assert.equal((await request('http://127.0.0.1:18080', '/')).status, 503);
        } finally {
            compose(['start', '--wait', '--wait-timeout', '90', 'control-db'], { timeout: 120000 });
        }
        const recovered = await request('http://127.0.0.1:18100', '/cluster/status');
        assert.equal(recovered.status, 200);
        assert.equal(recovered.body.state, 'MAINTENANCE');
        assert.equal(recovered.body.activeWriter, null);
    });

    await check('C2A-08 inactive business data and receipts stay unchanged', async () => {
        for (const [node, service, dbService] of [['A', 'primary-web', 'primary-db'], ['B', 'standby-web', 'standby-db']]) {
            const after = capture(PROJECT, service);
            assert.equal(after.businessSha256, dataBefore[node].businessSha256);
            assert.equal(after.schemaSha256, dataBefore[node].schemaSha256);
            const state = runtimeState(dbService, DB_NAMES[node]);
            assert.equal(state.receipts, 0);
            assert.equal(state.enabled, 0);
        }
    });

    await check('C2A-09 PHA B and demo metadata, privileges and full data match', async () => {
        const after = protectedBaseline();
        saveJson('protected-after-tests.json', after);
        assert.deepEqual(after, protectedBefore);
        const bootBaseline = JSON.parse(fs.readFileSync(path.join(RUNTIME, 'protected-before.json'), 'utf8'));
        assert.deepEqual(after, bootBaseline);
    });

    await check('C2A-10 unit regression inside C2 Node image', async () => {
        const output = compose(['exec', '-T',
            '-e', 'CLUSTER_MODE=', '-e', 'CLUSTER_NAMESPACE=', '-e', 'CONTROL_DB_HOST=',
            '-e', 'DB_NAME=shoponline_check_phase_b', '-e', 'NODE_NAME=test-unit-regression',
            'primary-web', 'npm', 'test'], { timeout: 120000 });
        fs.writeFileSync(path.join(RUNTIME, 'unit-container.log'), output);
        assert.match(output.toString('utf8'), /# fail 0/);
        return output.toString('utf8').split(/\r?\n/).filter(l => /^# (tests|pass|fail|duration_ms)/.test(l));
    });

    saveJson('test-results.json', { project: PROJECT, date: new Date().toISOString(), results,
        outsideC2a: 'NOT RUN: active writer, A-to-B, drain, commit receipt, dynamic reload, failback' });
    if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
}

if (require.main === module) main().catch(error => {
    saveJson('test-results.json', { project: PROJECT, status: 'BLOCKED', error: error.message });
    console.error(error.message);
    process.exitCode = 1;
});
