// A chat whose session has grown too long rolls into a fresh one. Every model
// call in a session reads all of it, so a long chat costs more with each
// message. Before the owner's next message, the Odd writes a handover note in
// the old session; the fresh one opens with that note and the chat's latest
// lines (`replay`), and finds anything older with `search_chats`.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { chatSession, home, OFFICE_FILES, type StaffRow } from '@oddboro/ledger';
import { officeDay } from '@oddboro/ledger/time';
import { parseSession } from './resume.ts';
import { run } from './staff.ts';

/**
 * A session that read this many tokens in one model call starts fresh before
 * the next message. A fresh session begins near 20,000 (the office's
 * instructions, its tools, the note and the latest lines), so each call
 * after a roll reads a fraction of what it did.
 */
export const ROLLOVER_TOKENS = 80_000;

const HANDOVER_TIMEOUT_MS = 3 * 60_000;

/** The note an Odd's chat keeps from its last session. */
export const handoverFile = (id: string) => home('staff', id, OFFICE_FILES.handover);

/**
 * How many tokens the chat's saved session holds, in this tool folder: what
 * its next message reads. Nothing when the next message starts a fresh one.
 */
export function sessionTokens(id: string, toolHome: string): number | undefined {
  const file = chatSession(id);
  if (!existsSync(file)) return undefined;
  const saved = parseSession(readFileSync(file, 'utf8'));
  return saved && (saved.home ?? '') === toolHome ? saved.context : undefined;
}

/** Whether the chat's saved session, in this tool folder, has grown past `ROLLOVER_TOKENS`. */
export function outgrown(id: string, toolHome: string): boolean {
  return (sessionTokens(id, toolHome) ?? 0) >= ROLLOVER_TOKENS;
}

/** What the Odd is asked, in the session that ends. */
export const HANDOVER_ASK = [
  'This chat has grown long, so this session ends here. Your next reply starts in a fresh session that has not seen this one.',
  'Write the note the fresh session reads first. Use these headings, in this order, and leave out a heading with nothing under it:',
  '',
  '## Where things stand',
  '## Open promises: what you said you would do, for whom, and by when',
  "## {owner}'s decisions",
  '## Waiting on',
  '## Topics covered: a short list, so you know what to search for',
  '',
  'Plain words, under 400 words in all. Reply with the note only. Older turns stay searchable with search_chats.'
].join('\n');

/**
 * Ask the Odd for its handover note in the session that ends, keep the note,
 * and end the session, so the next run starts a fresh one. A note that does
 * not come leaves the session as it was: the chat goes on, and the next
 * message tries again. Runs under the chat's own run (`runId`), so its Stop
 * stops this too.
 */
export async function rollOver(who: StaffRow, runId: string): Promise<boolean> {
  const r = await run(who, HANDOVER_ASK, {
    kind: 'chat',
    runId,
    sessionFile: chatSession(who.id),
    timeoutMs: HANDOVER_TIMEOUT_MS
  }).catch(() => undefined);
  const note = r?.ok ? r.text.trim() : '';
  if (!note) return false;
  writeFileSync(handoverFile(who.id), note);
  rmSync(chatSession(who.id), { force: true });
  return true;
}

/** What a fresh session hears first: the note its chat's last session wrote, when there is one. */
export function handoverBrief(id: string): string[] {
  const file = handoverFile(id);
  if (!existsSync(file)) return [];
  const note = readFileSync(file, 'utf8').trim();
  if (!note) return [];
  return [
    [
      `(Your handover note, written ${officeDay(statSync(file).mtime)} when the last session of this chat ended. The chat's earlier turns are not in this session: search them with search_chats before you say you do not know something, or ask {owner} again.)`,
      '',
      note
    ].join('\n')
  ];
}
