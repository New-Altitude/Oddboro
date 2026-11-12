// Claude Code's saved conversations for one project folder, read from the files
// Claude Code writes itself: `<its folder>/projects/<project key>/<id>.jsonl`.
// Only what Find existing shows: each conversation's ID, title, folder and
// last change. A large file is read at its two ends only.
import { access, open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { nativeEnv, UUID } from './native.ts';

export type SavedClaude = {
  sessionId: string;
  /** The name the owner gave it, else Claude's title for it, else its first prompt. */
  title: string;
  /** The folder it ran in, when the file says. */
  cwd?: string;
  /** When the file last changed, in milliseconds. */
  lastModified: number;
};

type Entry = {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  customTitle?: string;
  aiTitle?: string;
  lastPrompt?: string;
  summary?: string;
  cwd?: string;
  continuedInSessionId?: string;
  message?: { content?: unknown };
};

/** Claude Code's own folder, as the native client the office opens finds it. */
export const claudeHome = (env: Record<string, string | undefined> = nativeEnv()) =>
  env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

/**
 * Claude Code's key for a project folder: each character but a letter or digit
 * becomes `-`. A key past 200 characters is cut there and ends in a hash.
 */
const KEY_LIMIT = 200;
const projectKey = (folder: string) => folder.replace(/[^a-zA-Z0-9]/g, '-');

/** How much of each end of a file is read. Titles and the first prompt sit there. */
const EDGE = 64 * 1024;

async function ends(file: string, size: number) {
  const handle = await open(file, 'r');
  try {
    const read = async (at: number, length: number) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, at);
      return buffer.toString('utf8', 0, bytesRead);
    };
    const head = await read(0, Math.min(size, EDGE));
    return { head, tail: size > EDGE ? await read(size - EDGE, EDGE) : head };
  } finally {
    await handle.close();
  }
}

/** Each whole line that is a JSON object. A line cut at a read's edge is skipped. */
const entries = (text: string): Entry[] =>
  text.split('\n').flatMap((line) => {
    try {
      const v: unknown = JSON.parse(line);
      return v && typeof v === 'object' ? [v as Entry] : [];
    } catch {
      return [];
    }
  });

const last = (rows: Entry[], key: 'customTitle' | 'aiTitle' | 'lastPrompt' | 'summary') =>
  rows.findLast((r) => typeof r[key] === 'string' && r[key].trim())?.[key]?.trim();

/**
 * The owner's first real prompt: no tool result, no note Claude added. A
 * conversation that only ran a command, such as /clear, is named by it.
 */
function firstPrompt(rows: Entry[]) {
  let command: string | undefined;
  for (const r of rows) {
    if (r.type !== 'user' || r.isMeta || r.isCompactSummary) continue;
    const content = r.message?.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? (content as { type?: string; text?: string }[]).find((c) => c.type === 'text')?.text
          : undefined;
    const words = text?.replace(/\n/g, ' ').trim();
    if (!words) continue;
    if (!words.startsWith('<')) return words.slice(0, 200);
    command ??= /<command-name>([^<]+)<\/command-name>/.exec(words)?.[1]?.trim();
  }
  return command;
}

async function readSession(file: string, sessionId: string): Promise<SavedClaude | undefined> {
  const info = await stat(file);
  if (!info.isFile()) return;
  const { head, tail } = await ends(file, info.size);
  const top = entries(head);
  const end = entries(tail);
  // A subagent's transcript is no conversation of the owner's.
  if (top[0]?.isSidechain) return;
  // A conversation Claude carried on in a newer file shows once, as that file.
  const moved = end.findLast((r) => ['user', 'assistant', 'continued-in'].includes(r.type ?? ''));
  const next = moved?.type === 'continued-in' ? moved.continuedInSessionId : undefined;
  if (
    next &&
    UUID.test(next) &&
    (await access(join(dirname(file), next + '.jsonl')).then(
      () => true,
      () => false
    ))
  )
    return;
  const title =
    last(end, 'customTitle') ||
    last(top, 'customTitle') ||
    last(end, 'aiTitle') ||
    last(top, 'aiTitle') ||
    last(end, 'lastPrompt') ||
    last(end, 'summary') ||
    firstPrompt(top);
  if (!title) return;
  const cwd = top.find((r) => typeof r.cwd === 'string')?.cwd;
  return { sessionId, title, cwd, lastModified: Math.trunc(info.mtimeMs) };
}

/** Every saved Claude Code conversation for `folder`, newest first. */
export async function savedClaudeSessions(
  folder: string,
  home = claudeHome()
): Promise<SavedClaude[]> {
  const projects = join(home, 'projects');
  const key = projectKey(folder);
  const names = await readdir(projects).catch(() => [] as string[]);
  const dirs = names.filter((name) =>
    key.length <= KEY_LIMIT ? name === key : name.startsWith(key.slice(0, KEY_LIMIT) + '-')
  );
  const rows: SavedClaude[] = [];
  for (const dir of dirs) {
    const files = await readdir(join(projects, dir)).catch(() => [] as string[]);
    for (const name of files) {
      const id = name.endsWith('.jsonl') ? name.slice(0, -'.jsonl'.length) : '';
      if (!UUID.test(id)) continue;
      const row = await readSession(join(projects, dir, name), id).catch(() => undefined);
      if (row) rows.push(row);
    }
  }
  return rows.sort((a, b) => b.lastModified - a.lastModified);
}
