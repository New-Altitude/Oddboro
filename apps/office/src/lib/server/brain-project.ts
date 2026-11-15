// Pair just the folder picked by the owner. A hook carries no Brain key.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { STAFF_SERVER, checkFolder, currentPlatform, home } from '@oddboro/ledger';

export type BrainHost = 'codex' | 'claude';
type Pair = { id: string; host: BrainHost; workspace: string; key: string; command: string };
const pairs = () => home('dreaming', 'pairs');
const pairPath = (id: string) => join(pairs(), id + '.json');
export function loadPairs(): Pair[] {
  if (!existsSync(pairs())) return [];
  return readdirSync(pairs())
    .filter((name) => /^[\da-f-]{36}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(pairs(), name), 'utf8')) as Pair);
}
function plain(path: string) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error('Choose a folder with no linked settings or decision files.');
}
function atomic(path: string, text: string) {
  const tmp = path + '.' + randomUUID() + '.tmp';
  writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
  try {
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
type Group = { hooks?: { type: string; command?: string }[] };
function editHook(pair: Pair, add: boolean) {
  const dir = join(pair.workspace, pair.host === 'claude' ? '.claude' : '.codex');
  plain(dir);
  if (!add && !existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, pair.host === 'claude' ? 'settings.local.json' : 'hooks.json');
  plain(file);
  if (!add && !existsSync(file)) return;
  const cfg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  cfg.hooks ??= {};
  const list: Group[] = cfg.hooks.UserPromptSubmit ?? [];
  const own = (g: Group) => g.hooks?.length === 1 && g.hooks[0].command === pair.command;
  cfg.hooks.UserPromptSubmit = list.filter((g) => !own(g));
  if (add) cfg.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: pair.command }] });
  atomic(file, JSON.stringify(cfg, null, 2) + '\n');
}
function quoteArgument(value: string) {
  if (currentPlatform() === 'win32') {
    if (/[%!"\r\n]/.test(value)) throw new Error('This path cannot be used by a project hook.');
    return '"' + value + '"';
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}
export function pairBrain(host: BrainHost, path: string) {
  const checked = checkFolder(path);
  if (!('real' in checked))
    throw new Error('refused' in checked ? checked.refused : checked.warning);
  const workspace = checked.real;
  if (!lstatSync(workspace).isDirectory()) throw new Error('Choose one project folder.');
  const existing = loadPairs().find((p) => p.workspace === workspace && p.host === host);
  const id = existing?.id ?? randomUUID();
  // Both development and desktop releases put the hook beside the staff server.
  const helper = join(dirname(STAFF_SERVER), 'brain-capture.mjs');
  const command = [process.execPath, helper, pairPath(id), host].map(quoteArgument).join(' ');
  const pair = existing ?? { id, workspace, host, key: randomBytes(32).toString('hex'), command };
  const outbox = join(workspace, '.oddboro-decisions');
  plain(outbox);
  mkdirSync(outbox, { recursive: true, mode: 0o700 });
  const ignore = join(outbox, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 });
  mkdirSync(pairs(), { recursive: true, mode: 0o700 });
  if (existing && existing.command !== command) editHook(existing, false);
  pair.command = command;
  editHook(pair, true);
  atomic(pairPath(id), JSON.stringify(pair));
}
export function unpairBrain(id: string) {
  const pair = loadPairs().find((p) => p.id === id);
  if (!pair) return;
  // Disable first so a moved project or a changed settings file cannot keep sharing.
  rmSync(pairPath(pair.id), { force: true });
  if (existsSync(pair.workspace) && realpathSync(pair.workspace) === pair.workspace)
    editHook(pair, false);
}
export type ProjectDecision = {
  path: string;
  content: string;
  at: string;
  pairId: string;
  turn: string;
};
export function pendingDecisions(): ProjectDecision[] {
  const decisions: ProjectDecision[] = [];
  for (const pair of loadPairs()) {
    const dir = join(pair.workspace, '.oddboro-decisions');
    if (!existsSync(dir) || realpathSync(dir) !== dir) continue;
    for (const file of readdirSync(dir).filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
      const path = join(dir, file);
      const st = lstatSync(path);
      if (!st.isFile() || st.nlink !== 1 || st.size > 40000) continue;
      let rows: unknown;
      try {
        rows = JSON.parse(readFileSync(path, 'utf8'));
      } catch {
        continue;
      }
      if (!Array.isArray(rows)) continue;
      const at = rows[0]?.at;
      if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) continue;
      const turn = file.slice(0, -5);
      const quotes = rows
        .filter(
          (r) =>
            r?.at === at &&
            typeof r.quote === 'string' &&
            r.quote.length <= 1400 &&
            createHmac('sha256', pair.key)
              .update(turn + '\n' + at + '\n' + r.quote)
              .digest('hex') === r.proof
        )
        .map((r) => r.quote as string);
      if (quotes.join('\n').length > 2450) continue;
      if (quotes.length)
        decisions.push({
          path,
          pairId: pair.id,
          turn,
          at,
          content:
            'Project: ' +
            basename(dirname(dir)) +
            '\nOwner decision in ' +
            pair.host +
            ': ' +
            [...new Set(quotes)].join('\n') +
            '\nSource turn: ' +
            turn
        });
    }
  }
  return decisions.sort((a, b) => a.at.localeCompare(b.at));
}
