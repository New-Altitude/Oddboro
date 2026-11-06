// What a resumed chat session is told about its instructions. Claude Code
// keeps a session's first system prompt when it resumes, and ignores a new
// --append-system-prompt, so a resumed run puts what changed in its message.
import { writeFileSync } from 'node:fs';

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

/** What session.json holds: the session, and the sections it last saw. */
export type Saved = { sessionId: string; seen?: Sections };

/** Writes session.json after a run, with what the session saw, so its next turn sends only what changed. */
export function saveSession(file: string, saved: Required<Saved>): void {
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
  const { sessionId, seen } = raw as { sessionId?: unknown; seen?: unknown };
  if (typeof sessionId !== 'string') return undefined;
  const isSections =
    typeof seen === 'object' &&
    seen !== null &&
    Object.values(seen).every((v) => typeof v === 'string');
  return isSections ? { sessionId, seen: seen as Sections } : { sessionId };
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
