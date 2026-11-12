// A bug report about Oddboro that an Odd drafted in a chat run with
// `draft_bug_report` (mcp-people.ts). The tool server keeps it beside the
// Odd's chat until the run ends, and the office then puts it on the run's
// reply, where File this opens it in the report form. Nothing here files
// anything.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { home, OFFICE_FILES } from './home.ts';

/** What the report form starts with: a title and the details. */
export type BugDraft = { title: string; body: string };

const draftFile = (staffId: string) => home('staff', staffId, OFFICE_FILES.bugDraft);

/** Keep `draft` for the chat run `run`. A second draft in the same run replaces the first. */
export function keepBugDraft(staffId: string, run: string, draft: BugDraft): void {
  mkdirSync(home('staff', staffId), { recursive: true });
  writeFileSync(draftFile(staffId), JSON.stringify({ run, title: draft.title, body: draft.body }));
}

/**
 * The draft the chat run `run` kept, once. The file goes either way, so a
 * draft from a run that failed or was stopped never reaches a later reply.
 */
export function takeBugDraft(staffId: string, run: string): BugDraft | undefined {
  const file = draftFile(staffId);
  if (!existsSync(file)) return undefined;
  try {
    const kept = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return kept.run === run && typeof kept.title === 'string' && typeof kept.body === 'string'
      ? { title: kept.title, body: kept.body }
      : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(file, { force: true });
  }
}
