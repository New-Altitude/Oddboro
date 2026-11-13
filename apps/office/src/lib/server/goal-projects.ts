import { error } from '@sveltejs/kit';
import { readdirSync, realpathSync, type Dirent } from 'node:fs';
import { join } from 'node:path';
import {
  advancedMode,
  checkFolder,
  goal,
  home,
  goalsWindow,
  projectOverview,
  threadFolder,
  type ProjectAgent,
  type ProjectStatus
} from '@oddboro/ledger';
import { workName, THREADS_DIR } from '@oddboro/ledger/work-paths';
import { listStorage, STORAGE_CAP, type StoredEntry } from './storage.ts';

/** A link organizes the owner's view. It never gives an Odd access to a folder. */
export function projectFolder(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 4096) error(400, 'Choose a project folder');
  let checked;
  try {
    // The wide-folder warning protects grants. This link grants nothing.
    checked = checkFolder(value, true);
  } catch {
    error(400, 'Could not read that folder. Choose a folder you can open.');
  }
  if ('refused' in checked) error(400, checked.refused);
  if (!('real' in checked)) error(400, 'Choose a project folder');
  return checked.real;
}

export type GoalProject = {
  folder: string;
  advanced: boolean;
  sessions: { id: string; title: string; agent: ProjectAgent; status: ProjectStatus }[];
  files: (StoredEntry & { staff: string; work: string })[];
  capped: boolean;
};

/** Files are the work's existing shared outputs, opened through the same file viewer as Storage. */
export async function goalProject(id: number): Promise<GoalProject> {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2 ** 31 - 1) error(404, 'No such goal');
  const g = await goal(id);
  if (!g?.projectFolder) error(404, 'This goal has no project folder');
  const [window, advanced] = await Promise.all([goalsWindow(), advancedMode()]);
  const work = window.goals
    .filter((row) => row.projectFolder === g.projectFolder)
    .flatMap((row) => row.threads);
  const files: GoalProject['files'] = [];
  let room = STORAGE_CAP;
  let capped = false;
  for (const t of work) {
    const root = threadFolder(t.id);
    let parts: Dirent[];
    try {
      // The viewer refuses a link at any level of a work folder, so the list does too.
      if (realpathSync(root) !== join(realpathSync(home(THREADS_DIR)), String(t.id))) continue;
      parts = readdirSync(root, { withFileTypes: true });
    } catch {
      // Work with no shared output yet has no folder to list.
      continue;
    }
    for (const part of parts) {
      if (!part.isDirectory() || part.name.startsWith('.')) continue;
      const listed = listStorage(join(root, part.name), room);
      for (const f of listed.entries) {
        if (!f.dir)
          files.push({
            ...f,
            path: workName(t.id, `${part.name}/${f.path}`),
            staff: t.hubId,
            work: t.title
          });
      }
      room -= listed.entries.length;
      if (listed.capped) capped = true;
    }
  }
  const sessions = advanced
    ? (await projectOverview())
        .filter((s) => s.folder === g.projectFolder)
        .map(({ id, title, agent, status }) => ({ id, title, agent, status }))
    : [];
  return { folder: g.projectFolder, advanced, sessions, files, capped };
}
