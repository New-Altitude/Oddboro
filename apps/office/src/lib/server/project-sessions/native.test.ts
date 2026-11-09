import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectInput } from './native.ts';

test('a file reference stays in its worktree and a native image gets a local image input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-project-'));
  try {
    const folder = join(await realpath(root), 'work');
    await mkdir(folder);
    await writeFile(join(folder, 'picture.png'), 'fixture');
    await writeFile(join(root, 'outside.txt'), 'outside');
    const content = await projectInput(folder, 'Describe the picture', 'picture.png');
    assert.match(content.text, /picture\.png/);
    assert.deepEqual(content.input[1], { type: 'localImage', path: join(folder, 'picture.png') });
    await assert.rejects(projectInput(folder, 'Read', '../outside.txt'), /inside this project/);
    await assert.rejects(projectInput(folder, 'Read', join(root, 'outside.txt')), /relative/);
    if (process.platform !== 'win32') {
      await symlink(join(root, 'outside.txt'), join(folder, 'link'));
      await assert.rejects(projectInput(folder, 'Read', 'link'), /inside this project/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
