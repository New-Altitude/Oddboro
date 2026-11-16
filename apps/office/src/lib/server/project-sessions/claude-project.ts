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
import {
  claudeFolderEnv,
  claudeFolderFound,
  claudeFolders,
  home,
  STAFF_SERVER,
  PROJECT_RECEIVERS,
  type ProjectSession,
  type ProjectRequest
} from '@oddboro/ledger';
import { pathToFileURL } from 'node:url';
import { AGENT_NAMES } from '@oddboro/ledger/agents';
import { currentSystem, probe } from '@oddboro/ledger/platform';
import { computerWord } from '@oddboro/ledger/system-words';
import { canMoveHere, nativeCommand, nativeEnv } from './native.ts';
import { savedClaudeSessions, type SavedClaude } from './claude-sessions.ts';
import { claudeFolderMark } from '../claude.ts';
/** The kinds of session `claude agents` lists that this office reads. */
const KINDS = ['interactive', 'background'] as const;
type Active = {
  sessionId?: string;
  id?: string;
  /** Missing for a kind this office does not read. */
  kind?: (typeof KINDS)[number];
  /** The session's process, listed only while it runs. */
  pid?: number;
  cwd: string;
  name?: string;
  status?: string;
  waitingFor?: string;
};
/**
 * What the owner reads when Claude Code cannot list a project's conversations.
 * The project-sessions route shows a thrown message as it is, so a raw error
 * from starting the command (its path, ENOENT) never reaches the owner.
 * `missing` names the system as it is when the listing fails, not as this file
 * loaded, since a test fakes the system after that.
 */
export const CLAUDE_LIST_FAILED = {
  missing: () => `${AGENT_NAMES.claude} is not installed on this ${computerWord(currentSystem())}.`,
  failed: `${AGENT_NAMES.claude} could not list this project's conversations. Try again.`
};

/**
 * The sessions `claude agents --json` printed, or undefined when it printed
 * anything but a list. Entries that are not objects are left out. A session
 * of a kind this office does not read keeps no kind and no process, so it
 * reads as not running, with no job.
 */
function agentList(out: string): Active[] | undefined {
  let list: unknown;
  try {
    list = JSON.parse(out);
  } catch {
    // The caller tells the owner the listing failed; the parser's own words
    // would show them a raw SyntaxError.
    return undefined;
  }
  if (!Array.isArray(list)) return undefined;
  return list
    .filter((a): a is Record<string, unknown> => typeof a === 'object' && a !== null)
    .map((a) => {
      const kind = KINDS.find((k) => k === a.kind);
      const pid = kind && typeof a.pid === 'number' && Number.isInteger(a.pid) ? a.pid : undefined;
      // The other fields are read as Claude Code prints them, as they were
      // before kind and pid were checked.
      return { ...(a as Omit<Active, 'kind' | 'pid'>), kind, pid };
    });
}

/**
 * The Claude Code sessions running in `folder`, from `claude agents --json` in
 * the Claude folder `dir`. With `all`, stopped and finished background
 * sessions too, which list with no process.
 */
export async function claudeAgents(
  folder: string,
  dir: string,
  { all }: { all?: boolean } = {}
): Promise<Active[]> {
  const [exe, prefix] = nativeCommand('claude');
  const args = ['agents', '--json', '--cwd', folder, ...(all ? ['--all'] : [])];
  const r = await probe(exe, [...prefix, ...args], {
    env: claudeFolderEnv(dir, nativeEnv()),
    cwd: folder,
    timeout: 10000,
    maxBuffer: 4_000_000
  });
  switch (r.status) {
    case 'ok': {
      const list = agentList(r.out);
      if (!list) throw new Error(CLAUDE_LIST_FAILED.failed);
      return list;
    }
    case 'missing':
      throw new Error(CLAUDE_LIST_FAILED.missing());
    case 'failed':
    case 'timeout':
      throw new Error(CLAUDE_LIST_FAILED.failed);
    default: {
      const missed: never = r;
      throw new Error(`claude agents came back as ${JSON.stringify(missed)}`);
    }
  }
}

/**
 * One conversation the continue path's list shows. `configDir` is the Claude
 * folder that holds it, or null when that is not known yet (connect finds it
 * later). `live` means a process runs it. `job` is its background session's
 * short id, or empty when it has none. A running one carries its process and
 * status, so connect's one read serves Move here.
 */
export type ClaudeConversation = {
  id: string;
  title: string;
  updated: number;
  live: boolean;
  job: string;
  pid?: number;
  status?: string;
  /** Open in a terminal, and Move here can bring it in on this computer. */
  movable: boolean;
  configDir: string | null;
};

/** Whether a conversation is open in a terminal: running, with no background session. */
export const inTerminal = (r: Pick<ClaudeConversation, 'live' | 'job'> | undefined) =>
  !!r?.live && !r.job;

/** What one Claude folder says about `folder`: its saved conversations, and those running, if it could say. */
type FolderAnswer = { dir: string; saved: SavedClaude[]; running?: Active[] };

/**
 * The conversations of `folder` across the Claude folders answered, newest
 * first. A saved one belongs to the folder whose file holds it, the newest file
 * when two do. A running one with no saved file yet belongs to a folder only
 * when that one folder alone listed it.
 */
function conversations(folder: string, answers: FolderAnswer[]): ClaudeConversation[] {
  const rows = new Map<string, ClaudeConversation>();
  for (const { dir, saved } of answers)
    for (const h of saved) {
      if (h.cwd && h.cwd !== folder) continue;
      const had = rows.get(h.sessionId);
      if (had && had.updated >= h.lastModified) continue;
      rows.set(h.sessionId, {
        id: h.sessionId,
        title: h.title,
        updated: h.lastModified,
        live: false,
        job: '',
        movable: false,
        configDir: dir
      });
    }
  const listedBy = new Map<string, { a: Active; dirs: string[] }>();
  for (const { dir, running } of answers)
    for (const a of running ?? []) {
      if (a.cwd !== folder || !a.sessionId) continue;
      const seen = listedBy.get(a.sessionId);
      if (!seen) listedBy.set(a.sessionId, { a, dirs: [dir] });
      else {
        if (!seen.dirs.includes(dir)) seen.dirs.push(dir);
        // A stopped background session the owner resumed in a terminal lists
        // twice under one id. The row with a process is the one that runs.
        if (a.pid !== undefined && seen.a.pid === undefined) seen.a = a;
      }
    }
  for (const [id, { a, dirs }] of listedBy) {
    const had = rows.get(id);
    const live = a.pid !== undefined;
    const job = a.kind === 'background' ? (a.id ?? '') : '';
    const open = inTerminal({ live, job });
    // A terminal session with no saved conversation yet, such as a fresh
    // claude, has nothing to continue: Claude Code cannot resume it.
    if (open && !had) continue;
    rows.set(id, {
      id,
      title: a.name || had?.title || 'Claude Code',
      updated: had?.updated || Date.now(),
      live,
      job,
      pid: a.pid,
      status: a.status,
      movable: open && canMoveHere(),
      configDir: had?.configDir ?? (dirs.length === 1 ? dirs[0] : null)
    });
  }
  return [...rows.values()].sort((a, b) => b.updated - a.updated);
}

/** What the Claude folder `dir` holds for `folder`, with what `running` found running there. */
const folderAnswer = (folder: string, dir: string, running: Promise<Active[] | undefined>) =>
  Promise.all([savedClaudeSessions(folder, dir), running]).then(([saved, live]): FolderAnswer => ({
    dir,
    saved,
    running: live
  }));

/** The conversations of `folder` in the one Claude folder `dir`. A failure to list them is thrown. */
export async function claudeProjectsIn(folder: string, dir: string) {
  return conversations(folder, [
    await folderAnswer(folder, dir, claudeAgents(folder, dir, { all: true }))
  ]);
}

/**
 * The conversations of `folder` in every Claude folder named in Setup. A named
 * folder not on the disk is skipped, since a `claude` command could create it;
 * `~/.claude` is always tried, so a computer without Claude Code still hears
 * so. A named folder whose `claude agents` fails is logged and left out of the
 * running ones, so one bad folder never fails the list for the others.
 */
export async function claudeProjects(folder: string): Promise<ClaudeConversation[]> {
  const [own, ...named] = claudeFolders();
  const leftOut = (dir: string) => (e: unknown) => {
    console.error(`Claude Code could not list what runs in the Claude folder ${dir}:`, e);
    return undefined;
  };
  return conversations(
    folder,
    await Promise.all([
      folderAnswer(folder, own, claudeAgents(folder, own, { all: true })),
      ...named
        .filter(claudeFolderFound)
        .map((dir) =>
          folderAnswer(folder, dir, claudeAgents(folder, dir, { all: true }).catch(leftOut(dir)))
        )
    ])
  );
}

/**
 * Each Claude folder's mark, one `claudeFolderMark` per distinct folder however
 * many rows share it, so a list reads each login once.
 */
export async function folderMarks(
  dirs: (string | null)[],
  { fresh }: { fresh: boolean }
): Promise<Map<string, string>> {
  const distinct = [...new Set(dirs.filter((d): d is string => d !== null))];
  return new Map(
    await Promise.all(distinct.map(async (d) => [d, await claudeFolderMark(d, { fresh })] as const))
  );
}

/** The continue path's list: `claudeProjects`, each row with its folder's mark, its login read fresh. */
export async function markedClaudeProjects(folder: string) {
  const rows = await claudeProjects(folder);
  const marks = await folderMarks(
    rows.map((r) => r.configDir),
    { fresh: true }
  );
  return rows.map((r) => ({
    ...r,
    mark: r.configDir === null ? null : (marks.get(r.configDir) ?? null)
  }));
}

const jsonFile = (p: string, data: unknown) => {
  const tmp = p + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, p);
};
/** What preparing a plugin needs of a session, so Start can prepare one before its row exists. */
type Prepared = Pick<ProjectSession, 'id' | 'nativeId' | 'folder'>;
const boxOf = (s: Prepared) => home('project-sessions', s.id, 'inbox');
export function prepareClaude(s: Prepared) {
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
      ',' +
      JSON.stringify(s.folder) +
      '); await import(' +
      JSON.stringify(pathToFileURL(join(ledger, 'src', 'project-watch' + ext)).href) +
      ');\n'
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
/** Each send checks both live receivers, with no prompt leaving before they answer. */
export async function checkClaudeReceiver(s: ProjectSession) {
  const box = boxOf(s),
    key = randomUUID();
  const replies = PROJECT_RECEIVERS.map((receiver) => join(box, key + '.' + receiver));
  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (replies.every((file) => existsSync(file))) resolve();
      };
      watcher = watch(box, check);
      watcher.on('error', reject);
      timer = setTimeout(
        () =>
          reject(
            new Error(
              'Claude’s office plugin is not ready. In Details, connect the plugin and reload it in this conversation, then retry. Nothing was sent.'
            )
          ),
        30_000
      );
      jsonFile(join(box, 'probe.json'), { key });
      check();
    });
  } finally {
    watcher?.close();
    clearTimeout(timer);
    for (const file of [join(box, 'probe.json'), ...replies]) rmSync(file, { force: true });
  }
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
