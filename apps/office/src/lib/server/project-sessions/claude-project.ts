import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import {
  cpSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  readFileSync,
  rmSync,
  existsSync,
  watch,
  type FSWatcher
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { home, STAFF_SERVER, type ProjectSession, type ProjectRequest } from '@oddboro/ledger';
import { nativeCommand, nativeEnv } from './native.ts';
import { savedClaudeSessions } from './claude-sessions.ts';
type Active = {
  sessionId?: string;
  id?: string;
  kind: string;
  cwd: string;
  name?: string;
  status?: string;
  waitingFor?: string;
};
export async function claudeProjects(folder: string) {
  const [exe, prefix] = nativeCommand('claude');
  const [history, processes] = await Promise.all([
    savedClaudeSessions(folder),
    promisify(execFile)(exe, [...prefix, 'agents', '--json', '--cwd', folder], {
      env: nativeEnv(),
      cwd: folder,
      timeout: 10000,
      maxBuffer: 4_000_000
    })
  ]);
  const active = (JSON.parse(processes.stdout) as Active[]).filter(
    (a) => a.cwd === folder && a.sessionId
  );
  const rows = new Map(
    history
      .filter((h) => !h.cwd || h.cwd === folder)
      .map((h) => [
        h.sessionId,
        {
          id: h.sessionId,
          title: h.title,
          updated: h.lastModified,
          live: false,
          job: ''
        }
      ])
  );
  for (const a of active)
    rows.set(a.sessionId!, {
      id: a.sessionId!,
      title: a.name || rows.get(a.sessionId!)?.title || 'Claude Code',
      updated: rows.get(a.sessionId!)?.updated || Date.now(),
      live: true,
      job: a.id || ''
    });
  return [...rows.values()].sort((a, b) => b.updated - a.updated);
}
const jsonFile = (p: string, data: unknown) => {
  const tmp = p + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, p);
};
const boxOf = (s: ProjectSession) => home('project-sessions', s.id, 'inbox');
export function prepareClaude(s: ProjectSession) {
  const root = home('project-sessions', s.id),
    market = join(root, 'market'),
    plugin = join(market, 'plugin'),
    box = boxOf(s);
  mkdirSync(box, { recursive: true, mode: 0o700 });
  mkdirSync(join(market, '.claude-plugin'), { recursive: true, mode: 0o700 });
  const ledger = dirname(dirname(STAFF_SERVER));
  cpSync(join(ledger, 'project-plugin'), plugin, { recursive: true });
  // Claude keys installed plugins by name. Two live conversations in one
  // project must keep distinct helpers even after both plugins are reloaded.
  const manifest = join(plugin, '.claude-plugin', 'plugin.json');
  const pluginName = 'oddboro-project-' + s.id;
  jsonFile(manifest, { ...JSON.parse(readFileSync(manifest, 'utf8')), name: pluginName });
  const ext = STAFF_SERVER.endsWith('.ts') ? '.ts' : '.js';
  const link = {
    command: process.execPath,
    args: [join(ledger, 'src', 'project-session-tools' + ext), box, s.nativeId, s.folder]
  };
  jsonFile(join(plugin, '.mcp.json'), { mcpServers: { oddboro_project: link } });
  // The shell line is fixed; paths and session identity live in the adjacent
  // launcher file as quoted JavaScript data, never as shell input.
  writeFileSync(
    join(plugin, 'start-watch.mjs'),
    'process.argv.push(' +
      JSON.stringify(box) +
      ',' +
      JSON.stringify(s.nativeId) +
      '); await import("./watch.mjs");\n'
  );
  // The monitor runs in a POSIX shell, including Git Bash on Windows.
  // Desktop installs can have a bundled Node without a node on the PATH.
  const node = process.execPath.replaceAll('\\', '/').replaceAll("'", "'\\''");
  mkdirSync(join(plugin, 'monitors'), { recursive: true });
  jsonFile(join(plugin, 'monitors', 'monitors.json'), [
    {
      name: 'office-work',
      command: "'" + node + "'" + ' "${CLAUDE_PLUGIN_ROOT}/start-watch.mjs"',
      description: 'Work from your connected Oddboro office'
    }
  ]);
  jsonFile(join(market, '.claude-plugin', 'marketplace.json'), {
    name: 'oddboro-' + s.id,
    owner: { name: 'Oddboro' },
    plugins: [
      {
        name: pluginName,
        source: './plugin',
        description: 'Connect this project session to your office.'
      }
    ]
  });
  return { plugin, market, box };
}
export function postClaude(s: ProjectSession, r: ProjectRequest) {
  jsonFile(join(boxOf(s), 'offer.json'), { id: r.id, prompt: r.prompt });
}
/** Keep a correction against its original assignment until Claude acknowledges it. */
export function correctClaude(s: ProjectSession, id: string, prompt: string) {
  const box = boxOf(s),
    file = join(box, 'correction.json');
  if (JSON.parse(readFileSync(join(box, 'offer.json'), 'utf8')).id !== id)
    throw new Error('That assignment has ended.');
  if (existsSync(file)) {
    const old = JSON.parse(readFileSync(file, 'utf8'));
    if (old.id === id && !existsSync(join(box, old.key + '.correction-read')))
      throw new Error('Claude has not picked up the previous correction yet.');
  }
  jsonFile(file, { id, key: randomUUID(), prompt });
}
export function clearClaude(s: ProjectSession, id: string) {
  const file = join(boxOf(s), 'offer.json');
  if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).id === id) rmSync(file);
}
export function hearClaude(
  s: ProjectSession,
  read: (id: string, answer?: string) => Promise<void>,
  corrected: (id: string) => void,
  failure: (e: unknown) => void
): FSWatcher {
  const box = boxOf(s);
  const check = (name: string) => {
    if (/^[0-9a-f-]{36}\.correction-read$/.test(name)) {
      try {
        corrected(JSON.parse(readFileSync(join(box, name), 'utf8')).id);
      } catch (e) {
        failure(e);
      }
      return;
    }
    const m = /^([0-9a-f-]{36})\.(accepted|reply)$/.exec(name);
    if (!m) return;
    try {
      const body = JSON.parse(readFileSync(join(box, name), 'utf8'));
      void read(m[1], m[2] === 'reply' ? body.answer : undefined).catch(failure);
    } catch (e) {
      failure(e);
    }
  };
  const w = watch(box, (_event, name) => {
    if (name) check(name);
  });
  // A reply published while the office was down must still reach its request.
  const offer = join(box, 'offer.json');
  if (existsSync(offer)) {
    const { id } = JSON.parse(readFileSync(offer, 'utf8'));
    for (const suffix of ['accepted', 'reply'])
      if (existsSync(join(box, id + '.' + suffix))) check(id + '.' + suffix);
  }
  return w;
}
