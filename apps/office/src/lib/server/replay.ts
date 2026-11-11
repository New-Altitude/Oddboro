// What a new chat session hears of the chat it never saw. A session is new
// after the owner moves an Odd to another coding tool, or when its session
// file is gone, and without this "What did I just ask you?" means nothing to
// it. It gets the latest of the chat word for word, from `chat.jsonl` (the
// record the owner sees, never written back), and the files that changed
// during it in the Odd's own folder and in the folders the owner gave it to
// change, among the first 2,000 entries of each. A chat run writes only
// there. Server only.
import { opendirSync, statSync, type Dir } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { OFFICE_FILES, shownFolder } from '@oddboro/ledger';
import type { ChatEntry } from '../staff/chat.ts';
import { retoldFiles, retoldLine, type RetoldEntry } from './chat-preface.ts';

/** At most this many characters of chat text, and the files retold under it, go into one replay. */
export const REPLAY_CHARS = 24_000;
/** At most this many changed files are named; the rest are counted. */
export const REPLAY_FILES = 30;
/** At most this many entries of each folder walked are looked at, so a big folder costs no more. */
const WALK_ENTRIES = 2_000;

/** The files a replay names, newest first, and whether the walk took in folders the owner gave the Odd. */
export type Changed = { files: string[]; granted: boolean };

/**
 * A line a replay may hold: one with text that someone said. A failed run's
 * error is the office's, so it is never replayed as the Odd's words; the
 * owner's line before it stays.
 */
const said = (e: ChatEntry) => !!e.text && !e.failed;

/** What a line takes of the budget: its text and the files retold under it, which go or stay with it. */
const cost = (e: RetoldEntry) => e.text.length + retoldFiles(e).length;

/**
 * The lines a replay holds, oldest first: the newest lines said (`said`)
 * whose text and retold files fit the budget together. A newest line over
 * the budget alone keeps its files and the end of its text that fits beside
 * them, after a `…`.
 */
export function replayed<E extends RetoldEntry>(entries: E[], budget = REPLAY_CHARS): E[] {
  const lines = entries.filter(said);
  let total = 0;
  let from = lines.length;
  while (from > 0 && total + cost(lines[from - 1]) <= budget) total += cost(lines[--from]);
  const newest = lines.at(-1);
  if (from === lines.length && newest) {
    const room = Math.max(0, budget - retoldFiles(newest).length);
    return [{ ...newest, text: `…${newest.text.slice(newest.text.length - room)}` }];
  }
  return lines.slice(from);
}

/**
 * Where in `entries` the lines `replayed` kept sit: the last `kept.length`
 * lines said. By position, since a cut newest line is a copy.
 */
export function replayedAt(entries: ChatEntry[], kept: ChatEntry[]): number[] {
  if (!kept.length) return [];
  return entries.flatMap((e, i) => (said(e) ? [i] : [])).slice(-kept.length);
}

/**
 * The time the replay's file list starts from, or undefined when it keeps
 * nothing. An Odd's reply is written to the chat after its run, beside the
 * owner line that started it, so a replay that opens on the Odd's line starts
 * from the line before it, when the run began.
 */
export function replaySince(entries: ChatEntry[], kept: ChatEntry[]): string | undefined {
  const [first] = replayedAt(entries, kept);
  if (first === undefined) return undefined;
  const oldest = entries[first];
  return oldest.from === 'owner' ? oldest.at : (entries[first - 1]?.at ?? oldest.at);
}

/** The earlier chat, word for word, with each owner line's files as they are now, for a session that never saw it. Pure. */
export function replay(entries: RetoldEntry[], changed: Changed, budget = REPLAY_CHARS): string {
  const kept = replayed(entries, budget);
  const lines = kept.map(retoldLine);
  const more = changed.files.length - REPLAY_FILES;
  const files =
    changed.files.slice(0, REPLAY_FILES).join(', ') + (more > 0 ? `, and ${more} more` : '');
  // Who changed a file is not known (its time says when, not who), so neither line says the Odd did.
  const list = changed.granted
    ? `(Files that changed during it, in your folder and the folders {owner} gave you, newest first: ${files}.)`
    : `(Files in your folder that changed during it: ${files}.)`;
  // The rest is in the office's own record, which the Odd may read: nothing of the chat is out of reach.
  const older = kept.length < entries.filter(said).length || kept[0]?.text.startsWith('…');
  return [
    '(This is a new session, so you do not remember your chat with {owner} so far. Here is the latest of it, word for word, oldest first:)',
    lines.join('\n'),
    ...(older
      ? [
          `(The chat goes back further. All of it is in ${OFFICE_FILES.chat} in your folder, one line per message, oldest first. Read it when something earlier matters.)`
        ]
      : []),
    ...(changed.files.length ? [list] : [])
  ].join('\n\n');
}

type Found = { path: string; at: number };

/**
 * Files under `root` changed at or after `from`, breadth first. The walk
 * stops after `WALK_ENTRIES` entries, and reads each folder an entry at a
 * time, so no folder is read past the cap: a folder of 100,000 entries costs
 * what one of 2,000 does. Hidden names, `node_modules` and links are passed
 * over: a link may point out of the folder.
 */
function changedIn(root: string, from: number, skip: Set<string>): Found[] {
  const found: Found[] = [];
  const folders = [root];
  let looked = 0;
  for (let i = 0; i < folders.length && looked < WALK_ENTRIES; i++) {
    let dir: Dir | undefined;
    try {
      dir = opendirSync(folders[i]);
      for (let e = dir.readSync(); e && looked < WALK_ENTRIES; e = dir.readSync()) {
        looked++;
        if (e.name.startsWith('.')) continue;
        const path = join(folders[i], e.name);
        if (e.isDirectory()) {
          if (e.name !== 'node_modules') folders.push(path);
        } else if (e.isFile() && !skip.has(path)) {
          // A file a job removed since the folder was read is not there to name.
          const at = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
          if (at !== undefined && at >= from) found.push({ path, at });
        }
      }
    } catch {
      // A folder the Odd shut, or one a job removed mid-walk: its files go
      // unnamed, since the replay is a help and never stops the chat.
    } finally {
      dir?.closeSync();
    }
  }
  return found;
}

/**
 * Files changed at or after `since`, newest first: in the Odd's folder `dir`
 * as paths relative to it, less the office's own files there (`skip`, full
 * paths), and in each `granted` folder as the owner reads its path
 * (`shownFolder`). A granted folder inside another is walked once, with it.
 */
export function changedSince(
  dir: string,
  since: string,
  skip: string[],
  granted: string[]
): Changed {
  const from = Date.parse(since);
  const roots = [...new Set(granted)];
  const outer = roots.filter((g) => !roots.some((o) => g.startsWith(o + sep)));
  const found = [
    ...changedIn(dir, from, new Set(skip)).map((f) => ({ ...f, path: relative(dir, f.path) })),
    ...outer.flatMap((g) =>
      changedIn(g, from, new Set()).map((f) => ({
        ...f,
        path: `${shownFolder(g)}/${relative(g, f.path)}`
      }))
    )
  ];
  return {
    files: found.sort((a, b) => b.at - a.at).map((f) => f.path),
    granted: outer.length > 0
  };
}
