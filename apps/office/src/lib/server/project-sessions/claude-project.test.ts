// Find existing asks Claude Code which sessions run in a project. When it
// cannot answer, the owner reads plain words, never the raw error of starting
// the command.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLAUDE_LIST_FAILED, claudeProjects } from './claude-project.ts';

/** The office's words for each system it runs on, written out. */
const NOT_INSTALLED: [NodeJS.Platform, string][] = [
  ['darwin', 'Claude Code is not installed on this Mac.'],
  ['linux', 'Claude Code is not installed on this computer.'],
  ['win32', 'Claude Code is not installed on this computer.']
];

test('with no Claude Code on this computer, listing a project says it is not installed on this Mac or computer, with no raw error or path', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-project-')));
  const path = process.env.PATH;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  // An empty folder as the whole PATH, so no claude can be found.
  process.env.PATH = root;
  try {
    for (const [system, words] of NOT_INSTALLED) {
      Object.defineProperty(process, 'platform', { value: system });
      const refused = await claudeProjects(root).then(
        () => assert.fail('listing should have failed'),
        (e: Error) => e.message
      );
      assert.equal(refused, CLAUDE_LIST_FAILED.missing(), system);
      assert.equal(refused, words, system);
      assert.doesNotMatch(refused, /ENOENT/);
      assert.ok(!refused.includes(root), refused);
    }
  } finally {
    Object.defineProperty(process, 'platform', platform);
    process.env.PATH = path;
    await rm(root, { recursive: true, force: true });
  }
});
