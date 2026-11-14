import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { identityFile } from './service-identity.mjs';
import { ownerRequest } from './service-channel.mjs';

const argv = process.argv.slice(2);
const raw = argv.includes('--json');
const [command, ...args] = argv.filter((a) => a !== '--json');
const home = process.env.ODDBORO_HOME || join(homedir(), '.oddboro');
const help = `oddboro COMMAND [--json]

start | status | stop | login on|off|status | open workspace | open office
setup OWNER TIME_ZONE MANAGER [PROVIDER]   managers: status --json
tools | sign-in PROVIDER | hire NAME ROLE REMIT
odds | inbox | assign ODD MESSAGE [--turn UUID] | chat ODD | follow ODD
steer ODD RUN MESSAGE | stop-run ODD RUN | report ID
inspect ID | approve ID | decline ID [REASON]
advanced on|off | projects | project ACTION JSON | terminal SESSION
request METHOD /api/PATH [JSON]   access a specific office operation`;

function required(i, name) {
  if (!args[i]) throw Error('Provide ' + name + '.');
  return args[i];
}
function paired() {
  return JSON.parse(readFileSync(identityFile(home), 'utf8'));
}
async function response(method, path, body) {
  const res = await ownerRequest(home, paired().key, method, path, body);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const parts = [];
    for await (const p of res) parts.push(p);
    const text = Buffer.concat(parts).toString();
    let why = text;
    try {
      why = JSON.parse(text).message ?? text;
    } catch {
      /* Plain error response. */
    }
    throw Error(why || 'Office returned ' + res.statusCode);
  }
  return res;
}
async function json(path, body, method = body === undefined ? 'GET' : 'POST') {
  const stream = await response(method, path, body);
  const parts = [];
  for await (const data of stream) parts.push(data);
  const s = Buffer.concat(parts).toString();
  return s ? JSON.parse(s) : null;
}
const chat = () => '/api/staff/' + encodeURIComponent(required(0, 'an Odd ID')) + '/chat';
const project = (action, fields = {}) => json('/api/project-sessions', { ...fields, action });
const out = (v) =>
  console.log(typeof v === 'string' && !raw ? v : JSON.stringify(v, null, raw ? 0 : 2));
async function* events(stream) {
  let event = 'message';
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (line.startsWith('event: ')) event = line.slice(7);
      if (line.startsWith('data: ')) {
        yield [event, JSON.parse(line.slice(6))];
        event = 'message';
      }
    }
  } finally {
    stream.destroy();
  }
}
async function terminal(id) {
  const stdin = process.stdin,
    stdout = process.stdout;
  if (!stdin.isTTY || !stdout.isTTY) throw Error('Open a terminal to take control.');
  await project('terminal', { id });
  const view = randomUUID();
  const stream = await response(
    'GET',
    '/api/project-sessions/' + encodeURIComponent(id) + '/events?terminal=1&view=' + view
  );
  let write = false,
    pending = Promise.resolve();
  async function resize() {
    if (write) await project('size', { id, view, cols: stdout.columns, rows: stdout.rows });
  }
  function queue(f) {
    pending = pending.then(f).catch((e) => stream.destroy(e));
  }
  function input(b) {
    const data = b.toString();
    if (data === '\x1d') {
      stream.destroy();
      return;
    }
    if (write) queue(() => project('keys', { id, view, data }));
  }
  const sized = () => queue(resize);
  const wasRaw = stdin.isRaw;
  try {
    await project('control', { id, view });
    stdin.setRawMode(true);
    stdin.on('data', input);
    stdout.on('resize', sized);
    for await (const [kind, value] of events(stream)) {
      if (kind === 'screen' || kind === 'output') stdout.write(value);
      if (kind === 'control') {
        write = value;
        if (write) await resize();
      }
      if (kind === 'end') break;
    }
  } finally {
    stdin.off('data', input);
    stdin.setRawMode(wasRaw);
    stdin.pause();
    stdout.off('resize', sized);
    stream.destroy();
    await pending;
  }
}
async function run() {
  if (!command || ['help', '--help', '-h'].includes(command)) return out(help);
  if (command === 'login') {
    const p = await import('@oddboro/ledger/platform');
    const label = 'com.oddboro.office';
    if (args[0] === 'status') return out({ enabled: await p.serviceInstalled(label) });
    if (args[0] === 'off') {
      await p.removeService(label);
      return out({ enabled: await p.serviceInstalled(label) });
    }
    if (args[0] !== 'on' || !process.env.ODDBORO_EXECUTABLE)
      throw Error('Choose on, off, or status using the installed executable.');
    // start is idempotent. Reuse a source installation's service label.
    const env = { ODDBORO_HOME: home };
    for (const k of ['ODDBORO_PORT', 'ODDBORO_DB_PORT'])
      if (process.env[k]) env[k] = process.env[k];
    const ok = await p.installService({
      label,
      args: [process.env.ODDBORO_EXECUTABLE, 'start'],
      env,
      log: p.OFFICE_LOG,
      headless: true
    });
    if (!ok) throw Error('Could not register Oddboro at login.');
    return out({ enabled: true });
  }
  if (command === 'start') {
    const exe = process.env.ODDBORO_EXECUTABLE;
    if (!exe) throw Error('Use the installed Oddboro executable to start the office.');
    try {
      await json('/api/health');
      return out('Office is running.');
    } catch {
      /* A stopped office has no socket. */
    }
    const child = spawn(exe, ['--headless'], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true
    });
    let failed;
    child.once('error', (e) => {
      failed = e;
    });
    child.unref();
    for (let i = 0; i < 180; i++) {
      if (failed) throw failed;
      try {
        const h = await json('/api/health');
        if (h.readyMs != null) return out(h);
      } catch {
        /* Waiting for this office. */
      }
      if (child.exitCode !== null) break;
      await delay(500);
    }
    throw Error(
      'The office did not start. Check its log or run oddboro --headless in the foreground.'
    );
  }
  if (command === 'stop') {
    const key = paired().key;
    const result = await json('/service/stop', {});
    for (let n = 0; n < 300; n++) {
      try {
        if (paired().key !== key) return out(result);
      } catch (e) {
        if (e.code === 'ENOENT') return out(result);
        throw e;
      }
      await delay(100);
    }
    throw Error('The office did not finish stopping. Check its status.');
  }
  if (command === 'open') {
    if (!['workspace', 'office'].includes(args[0])) throw Error('Choose workspace or office.');
    await json('/api/health');
    const url =
      'http://127.0.0.1:' +
      paired().port +
      (args[0] === 'workspace' ? '/workspace' : '/?view=office');
    const exec =
      process.platform === 'darwin'
        ? ['open', url]
        : process.platform === 'win32'
          ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
          : ['xdg-open', url];
    const proc = spawn(exec[0], exec.slice(1), { stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => {
      proc.once('error', reject);
      proc.once('exit', (c) => (c === 0 ? resolve() : reject(Error('Could not open the office.'))));
    });
    return;
  }
  if (command === 'tools') return out(await json('/api/agents'));
  if (command === 'sign-in') {
    const stream = await response(
      'POST',
      '/api/agents/' + encodeURIComponent(required(0, 'a provider')),
      { action: 'sign-in' }
    );
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      const step = JSON.parse(line);
      if (raw) out(step);
      else if (step.url || step.line) out(step.url || step.line);
      if (step.done && !step.ok) throw Error('Provider sign-in did not finish.');
    }
    return;
  }
  if (command === 'setup') {
    const s = await json('/api/workspace');
    if (s.welcomed) throw Error('This office has already been set up.');
    const owner = required(0, 'your name'),
      zone = required(1, 'a time zone'),
      preset = required(2, 'a manager ID');
    if (args[3]) await json('/api/agents', { office: args[3] }, 'PUT');
    return out(await json('/api/onboarding', { name: owner, zone, manager: { preset } }));
  }
  if (command === 'hire')
    return out(
      await json('/api/staff', {
        plain: true,
        name: required(0, 'a name'),
        role: required(1, 'a role'),
        remit: required(2, 'a remit'),
        desk: args[2],
        permission: 'read'
      })
    );
  if (['status', 'odds', 'inbox'].includes(command)) {
    const w = await json('/api/workspace');
    if (command === 'inbox') return out(w.desk);
    if (command === 'odds')
      return out(
        w.staff.map(({ id, name, role }) => ({ id, name, role, work: w.inProgress[id] ?? [] }))
      );
    return out({
      ...(await json('/api/health')),
      welcomed: w.welcomed,
      managers: w.managers,
      working: w.working,
      advanced: w.advanced
    });
  }
  if (command === 'chat') return out(await json(chat()));
  if (command === 'assign') {
    const message = required(1, 'a message');
    const turn = args.indexOf('--turn');
    const turnId = turn < 0 ? randomUUID() : required(turn + 1, 'the turn ID');
    const stream = await response('POST', chat(), { turnId, message });
    for await (const [, e] of events(stream)) {
      if (e.type === 'error') throw Error(e.message);
      if (e.type === 'reply' || e.type === 'done') return out({ turnId, ...e });
    }
    throw Error('The office disconnected. Check chat history for turn ' + turnId + '.');
  }
  if (command === 'follow') {
    const path = chat();
    const stream = await response('GET', '/api/events');
    out(await json(path));
    for await (const [, e] of events(stream)) if (e.table === 'chat') out(await json(path));
    return;
  }
  if (command === 'steer' || command === 'stop-run')
    return out(
      await json(
        chat(),
        {
          runId: required(1, 'the run ID'),
          ...(command === 'steer' ? { message: required(2, 'a message') } : {})
        },
        command === 'steer' ? 'PATCH' : 'DELETE'
      )
    );
  if (command === 'report')
    return out(await json('/api/reports/' + encodeURIComponent(required(0, 'a report ID'))));
  if (['inspect', 'approve', 'decline'].includes(command)) {
    const path = '/api/asks/' + encodeURIComponent(required(0, 'a request ID'));
    const { ask } = await json(path);
    if (command === 'inspect') return out(ask);
    if (process.stdin.isTTY) {
      console.error(ask.title + '\n' + ask.why);
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const yes = await new Promise((resolve) =>
        rl.question(command + ' this request? [y/N] ', resolve)
      );
      rl.close();
      if (yes.toLowerCase() !== 'y') throw Error('Decision cancelled.');
    }
    return out(
      await json(path, { decision: command === 'approve' ? 'approve' : 'deny', reason: args[1] })
    );
  }
  if (command === 'advanced') {
    if (!['on', 'off'].includes(args[0])) throw Error('Choose on or off.');
    if (args[0] === 'on' && !args.includes('--accept-project-access'))
      throw Error(
        'Native sessions run with your computer permissions. Add --accept-project-access to enable them.'
      );
    return out(await json('/api/setup/advanced', { on: args[0] === 'on' }, 'PUT'));
  }
  if (command === 'projects') return out(await project('connections'));
  if (command === 'project')
    return out(await project(required(0, 'a session action'), JSON.parse(args[1] ?? '{}')));
  if (command === 'terminal') return terminal(required(0, 'a session ID'));
  if (command === 'request') {
    const method = required(0, 'an HTTP method').toUpperCase(),
      path = required(1, 'an office API path');
    if (!path.startsWith('/api/')) throw Error('Choose an office API path.');
    return out(await json(path, args[2] === undefined ? undefined : JSON.parse(args[2]), method));
  }
  throw Error('Unknown command. Run oddboro help.');
}
try {
  await run();
} catch (e) {
  console.error(e.code === 'ENOENT' ? 'Office is stopped. Run oddboro start.' : e.message);
  process.exitCode = 1;
}
