// The project and its saved Claude conversations, for the controller's tests.
// It imports only Node, so a test file can import it before its mocks.
import { mkdirSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const project = join(homedir(), 'app');
mkdirSync(project, { recursive: true });
/** The project folder by its real path, as connect stores it. */
export const app = realpathSync(project);

/**
 * Save a conversation of the project in the Claude folder `dir`, as Claude
 * Code does, last changed `at` seconds from now when given.
 */
export function save(dir: string, id: string, at?: number) {
  const where = join(dir, 'projects', app.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(where, { recursive: true });
  const file = join(where, id + '.jsonl');
  writeFileSync(
    file,
    JSON.stringify({ type: 'user', cwd: app, message: { content: 'Work' } }) + '\n'
  );
  if (at !== undefined) utimesSync(file, Date.now() / 1000 + at, Date.now() / 1000 + at);
}
