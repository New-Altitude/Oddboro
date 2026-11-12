// Find existing asks Claude Code which sessions run in a project. When it
// cannot answer, the owner reads plain words, never the raw error of starting
// the command.
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLAUDE_LIST_FAILED, claudeProjects } from './claude-project.ts';

test('with no Claude Code on this computer, listing a project says it is not installed, with no raw error or path', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'office-claude-project-')));
  const path = process.env.PATH;
  // An empty folder as the whole PATH, so no claude can be found.
  process.env.PATH = root;
  try {
    const refused = await claudeProjects(root).then(
      () => assert.fail('listing should have failed'),
      (e: Error) => e.message
    );
    assert.equal(refused, CLAUDE_LIST_FAILED.missing);
    assert.equal(refused, 'Claude Code is not installed on this computer.');
    assert.doesNotMatch(refused, /ENOENT/);
    assert.ok(!refused.includes(root), refused);
  } finally {
    process.env.PATH = path;
    await rm(root, { recursive: true, force: true });
  }
});
