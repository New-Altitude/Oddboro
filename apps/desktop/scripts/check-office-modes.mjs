/** Exercise the bundled service and CLI without a GUI or owner credentials.
 * Pass the debug executable to also exercise the native supervisor. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as wait } from 'node:timers/promises';
const exec = promisify(execFile);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = join(desktop, 'stage');
const bundled = join(
  desktop,
  'src-tauri',
  'binaries',
  readdirSync(join(desktop, 'src-tauri', 'binaries')).find((f) => f.startsWith('node-'))
);
const scripts = join(stage, 'apps', 'office', 'scripts');
const exe = process.argv[2];
const temp = mkdtempSync(join(tmpdir(), 'ob-modes-'));
const office = join(temp, 'office'),
  bin = join(temp, 'bin'),
  log = join(temp, 'office.log');
mkdirSync(office);
mkdirSync(bin);
async function port() {
  const s = createServer();
  await new Promise((ok, no) => s.once('error', no).listen(0, '127.0.0.1', ok));
  const p = s.address().port;
  await new Promise((ok) => s.close(ok));
  return String(p);
}
const webPort = await port(),
  dbPort = await port();
assert.notEqual(webPort, dbPort);
const base = 'http://127.0.0.1:' + webPort;
const env = {
  ...process.env,
  HOME: temp,
  USERPROFILE: temp,
  ODDBORO_HOME: office,
  ODDBORO_LOG: log,
  ODDBORO_SECRETS: 'office',
  ODDBORO_PORT: webPort,
  ODDBORO_DB_PORT: dbPort,
  PORT: webPort,
  HOST: '127.0.0.1',
  ORIGIN: base,
  ODDBORO_APP: '1',
  ODDBORO_CODE: stage,
  ODDBORO_VERSION: '0.0.1',
  ODDBORO_SERVICE_MODE: '1',
  ODDBORO_SERVICE_KEY: randomBytes(32).toString('hex'),
  ODDBORO_UPDATE_URL: 'http://127.0.0.1:9/no-updates',
  SHUTDOWN_TIMEOUT: '1',
  OLLAMA_URL: 'http://127.0.0.1:9',
  PATH:
    bin +
    (process.platform === 'win32' ? ';' : ':') +
    dirname(bundled) +
    (process.platform === 'win32' ? ';' + process.env.SystemRoot + '\\System32' : ':/usr/bin:/bin'),
  SHELL: join(bin, 'login-shell')
};
for (const k of [
  'DATABASE_URL',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_HOME',
  'CLAUDE_CONFIG_DIR',
  'ODDBORO_AUTH',
  'ODDBORO_ENV',
  'OFFICE_AGENT',
  'ODDBORO_SERVER_URL',
  'ODDBORO_EXECUTABLE'
])
  delete env[k];
if (process.platform !== 'win32') {
  const shell = env.SHELL;
  writeFileSync(shell, '#!/bin/sh\nprintf "ODDBORO_PATH=%s\\n" "$PATH"\n');
  chmodSync(shell, 0o700);
  const tool = join(bin, 'claude');
  writeFileSync(
    tool,
    '#!/bin/sh\nexec "' + bundled + '" "' + join(bin, 'provider.cjs') + '" "$@"\n'
  );
  chmodSync(tool, 0o700);
  writeFileSync(
    join(bin, 'provider.cjs'),
    `const a=process.argv.slice(2);
if(a.includes('--version')) console.log('2.1.318 (Claude Code)');
else if(a[0]==='auth') console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'}));
else {let answered=false;const answer=()=>{if(answered)return;answered=true;
setTimeout(()=>{console.log(JSON.stringify({type:'result',subtype:'success',result:'The provider finished the assigned review.'}));process.exit(0)},400)};
process.stdin.on('data',answer);process.stdin.on('end',answer)}`
  );
}
const cli = async (...args) =>
  JSON.parse(
    (
      await exec(
        exe || bundled,
        [...(exe ? [] : [join(scripts, 'office-cli.mjs')]), ...args, '--json'],
        { env, timeout: 60000 }
      )
    ).stdout
  );
let child,
  output = '';
async function start() {
  if (!exe)
    writeFileSync(
      join(office, 'service.json'),
      JSON.stringify({ key: env.ODDBORO_SERVICE_KEY, port: Number(webPort), version: '0.0.1' }),
      { mode: 0o600 }
    );
  child = spawn(exe || bundled, exe ? ['--headless'] : [join(scripts, 'service-entry.mjs')], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: join(stage, 'apps', 'office')
  });
  child.stdout.on('data', (b) => (output += b));
  child.stderr.on('data', (b) => (output += b));
  await until(async () => {
    if (child.exitCode != null) throw Error('Office exited ' + child.exitCode);
    return (await fetch(base + '/api/health').then((r) => r.json())).readyMs != null;
  }, 'ready');
}
async function until(f, label) {
  let error;
  for (let i = 0; i < 180; i++) {
    try {
      if (await f()) return;
    } catch (e) {
      error = e;
    }
    if (child?.exitCode != null) break;
    await wait(300);
  }
  throw Error('Timed out: ' + label + ' ' + (error?.message || ''));
}
async function stop() {
  if (exe) assert.equal((await cli('stop')).stopped, true);
  else {
    // The Rust supervisor normally removes the descriptor when Node exits.
    const { ownerRequest } = await import('../stage/apps/office/scripts/service-channel.mjs');
    const res = await ownerRequest(office, env.ODDBORO_SERVICE_KEY, 'POST', '/service/stop', {});
    res.resume();
  }
  const expected = exe ? 0 : 75;
  for (let i = 0; i < 200 && child.exitCode === null; i++) await wait(100);
  assert.equal(child.exitCode, expected);
}
try {
  await start();
  const status = await cli('status');
  assert.equal(status.welcomed, false);
  if (exe) {
    const first = await cli('status');
    await Promise.all([cli('start'), cli('start')]);
    assert.equal((await cli('status')).pid, first.pid);
  }
  const initial = await fetch(base + '/workspace');
  assert.equal(initial.status, 200);
  assert.match(await initial.text(), /Set up your office/);
  const manager = (await cli('setup', 'Modes tester', 'America/Los_Angeles', 'marshall')).manager
    .id;
  const hire = await cli('hire', 'River', 'Analyst', 'Check assignment results');
  assert.ok(hire.id);
  const ids = (await cli('odds')).map((x) => x.id);
  assert.ok(ids.includes(manager) && ids.includes(hire.id));
  if (process.platform !== 'win32') {
    for (const odd of [manager, hire.id]) {
      const turn = randomUUID(),
        message = 'Review the brief for ' + odd + '.';
      await until(async () => !(await cli('chat', odd)).busy, 'first day');
      const accepted = await cli('assign', odd, message, '--turn', turn);
      assert.equal(accepted.turnId, turn);
      // The assigning client has exited. A different HTTP client reads the saved reply.
      await until(async () => {
        const { history } = await fetch(base + '/api/staff/' + odd + '/chat').then((r) => r.json());
        return history.some(
          (m) => m.turnId === turn && m.from === 'staff' && m.text.includes('provider finished')
        );
      }, 'persisted provider reply for ' + odd);
      await cli('assign', odd, message, '--turn', turn);
      assert.equal(
        (await cli('chat', odd)).history.filter((m) => m.turnId === turn && m.from === 'owner')
          .length,
        1
      );
    }
  }
  const fixture = async (code, ...args) =>
    JSON.parse(
      (
        await exec(bundled, ['--input-type=module', '-e', code, ...args], { env, cwd: stage })
      ).stdout
        .trim()
        .split('\n')
        .at(-1)
    );
  const askIds = await fixture(
    `import {raiseAsk,pg} from '@oddboro/ledger';const ids=[];
 for(const title of ['Check the cover page','Check the table of contents']){
 const {ask}=await raiseAsk(process.argv[1],{title,why:'The reviewer needs a decision.',ifApproved:'Finish the internal review.'});ids.push(ask.id)}
 await pg.end();console.log(JSON.stringify(ids));`,
    manager
  );
  const pending = await cli('inbox');
  assert.ok(pending.asks.some((a) => a.id === askIds[0]));
  assert.equal((await cli('inspect', String(askIds[0]))).title, 'Check the cover page');
  const decide = await fetch(base + '/api/asks/' + askIds[0], {
    method: 'POST',
    headers: { origin: base, 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' })
  });
  assert.equal(decide.status, 200);
  await assert.rejects(() => cli('decline', String(askIds[0])));
  await cli('decline', String(askIds[1]));
  assert.equal((await cli('inspect', String(askIds[1]))).status, 'denied');
  if (process.platform !== 'win32') {
    const job = await cli(
      'request',
      'POST',
      '/api/staff/' + manager + '/jobs',
      JSON.stringify({
        name: 'Check after detach',
        instructions: 'Review the brief.',
        schedule: { every: 'minutes', n: 5 }
      })
    );
    // Advance just this fixture's due time to avoid a five-minute sleep. Nothing calls runJob.
    await fixture(
      `import {pg} from '@oddboro/ledger';await pg\`update jobs set next_run_at=now()+interval '2 seconds' where id=\${Number(process.argv[1])}\`;await pg.end();console.log('true');`,
      String(job.id)
    );
    await wait(4500);
    await until(async () => {
      const rows = await cli('request', 'GET', '/api/staff/' + manager + '/jobs');
      return rows.find((j) => j.id === job.id)?.lastRun?.finishedAt;
    }, 'scheduled result');
    const count = await fixture(
      `import {pg} from '@oddboro/ledger';const [r]=await pg\`select count(*)::int AS n from runs where job_id=\${Number(process.argv[1])}\`;await pg.end();console.log(r.n);`,
      String(job.id)
    );
    assert.equal(count, 1);
  }
  assert.match(await (await fetch(base + '/workspace')).text(), /River/);
  const page = await fetch(base + '/?view=office', { redirect: 'manual' });
  assert.equal(page.status, 303);
  assert.equal(
    (
      await fetch(base + '/', { headers: { cookie: 'oddboro-view=workspace' }, redirect: 'manual' })
    ).headers.get('location'),
    '/workspace'
  );
  await stop();
  await start();
  assert.equal((await cli('status')).welcomed, true);
  assert.deepEqual(
    (await cli('odds')).map((x) => x.id),
    ids
  );
  await stop();
  console.log(
    'Verified fresh setup, shared roster, view selection, stop, restart and retained IDs' +
      (process.platform === 'win32'
        ? '.'
        : ', including saved replies after disconnect and idempotent retry.')
  );
} catch (e) {
  console.error((existsSync(log) ? readFileSync(log, 'utf8') : output).slice(-2200));
  throw e;
} finally {
  if (child && child.exitCode === null) {
    child.stdin.end();
    child.kill();
  }
  if (child?.exitCode !== null) rmSync(temp, { recursive: true, force: true });
}
