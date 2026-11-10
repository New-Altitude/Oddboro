// What a resumed chat session is told about its instructions. Claude Code
// keeps a session's first system prompt when it resumes, and ignores a new
// --append-system-prompt, so a resumed run puts what changed in its message.
import { readFileSync, writeFileSync } from 'node:fs';

/** A system prompt by section: heading line to the section's whole text. */
export type Sections = Record<string, string>;

/** Where the prompt says the time. Kept out of the comparison, since it changes every run. */
export const NOW = '{now}';

/** The job description has no heading of its own; in an update it gets this one. */
const JOB = '## Your job description';

/**
 * Splits a system prompt that opens with the job description into its
 * sections. The job description can hold `##` headings of its own, so it is
 * one section, cut off by its length, not by its headings.
 */
export function sectionsOf(system: string, desk: string): Sections {
  if (!system.startsWith(desk))
    throw new Error('The system prompt does not open with the job description.');
  const [first, ...rest] = system.slice(desk.length).split(/^(?=## )/m);
  const headed = first.startsWith('## ');
  // Anything before the first heading belongs to the job description.
  const sections: Sections = {
    [JOB]: [JOB, desk.trim(), headed ? '' : first.trim()].filter(Boolean).join('\n\n')
  };
  for (const part of headed ? [first, ...rest] : rest) {
    const heading = part.split('\n', 1)[0].trim();
    const text = part.trim();
    sections[heading] = sections[heading] ? `${sections[heading]}\n\n${text}` : text;
  }
  return sections;
}

/**
 * What session.json holds: the session, the sections it last saw, and the
 * tool folder it lives in (an account's, or '' for the owner's own Claude
 * login). A session lives in its tool's folder, so a run in another one (the
 * Odd moved to another account) starts a new session, which hears the chat.
 */
export type Saved = { sessionId: string; seen?: Sections; home?: string; source?: string };

/** Writes session.json after a run, with what the session saw, so its next turn sends only what changed. */
export function saveSession(file: string, saved: Saved & { seen: Sections; home: string }): void {
  writeFileSync(file, JSON.stringify(saved));
}

/**
 * Reads session.json. A file without `seen` was written before the office
 * kept it, so its session gets the whole prompt once.
 */
export function parseSession(text: string): Saved | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // A broken file starts a new session rather than stop the chat.
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { sessionId, seen, home, source } = raw as {
    sessionId?: unknown;
    seen?: unknown;
    home?: unknown;
    source?: unknown;
  };
  if (typeof sessionId !== 'string') return undefined;
  const where = {
    ...(typeof home === 'string' ? { home } : {}),
    ...(typeof source === 'string' ? { source } : {})
  };
  const isSections =
    typeof seen === 'object' &&
    seen !== null &&
    Object.values(seen).every((v) => typeof v === 'string');
  return isSections ? { sessionId, seen: seen as Sections, ...where } : { sessionId, ...where };
}

/** The session a session file names, or undefined when the file is missing or unreadable, so the next run starts a new one. */
export function sessionIdIn(file: string, home: string, source = ''): string | undefined {
  try {
    const saved = parseSession(readFileSync(file, 'utf8'));
    // One saved before the office kept its folder lived in the owner's own Claude login or a tool's old home: ''.
    return saved && (saved.home ?? '') === home && (saved.source ?? '') === source
      ? saved.sessionId
      : undefined;
  } catch {
    // A missing file means a new session, and one that cannot be read cannot be resumed.
    return undefined;
  }
}

/**
 * The lines that open a resumed run's message: the time, then every section
 * that differs from what the session last saw, in full, and any it saw that
 * the prompt no longer has. With nothing seen, every section counts as changed.
 */
export function catchUp(seen: Sections | undefined, now: Sections, time: string): string {
  const changed = Object.keys(now).filter((h) => seen?.[h] !== now[h]);
  const gone = Object.keys(seen ?? {}).filter((h) => !(h in now));
  const lines = [`(It is ${time} now.)`];
  if (changed.length)
    lines.push(
      `(The office updated your instructions since you last saw them. These sections now read as follows and replace the earlier versions:\n\n${changed.map((h) => now[h]).join('\n\n')})`
    );
  if (gone.length)
    lines.push(
      `(These sections of your instructions no longer apply: ${gone.map((h) => h.slice(3)).join(', ')}.)`
    );
  return `${lines.join('\n\n')}\n\n`.replaceAll(NOW, time);
}
