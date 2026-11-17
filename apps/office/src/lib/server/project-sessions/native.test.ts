import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { canMoveHere, projectFolder, projectInput } from './native.ts';

test('a project folder typed from ~ opens in the home folder, and ~other is refused', async () => {
  const folder = await mkdtemp(join(homedir(), 'project-'));
  try {
    const real = await realpath(folder);
    assert.equal(await projectFolder(`~/${basename(folder)}`), real);
    assert.equal(await projectFolder('~'), await realpath(homedir()));
    assert.equal(await projectFolder(real), real);
    await assert.rejects(projectFolder('~other'), {
      message: 'Choose a folder by its full path, such as ~/my-project.'
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('a project folder that is not there, or a path through a file, says the folder is not there', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'office-project-')));
  try {
    await writeFile(join(root, 'notes.txt'), 'a file, not a folder');
    for (const typed of [join(root, 'gone'), join(root, 'notes.txt', 'app')])
      await assert.rejects(projectFolder(typed), {
        message: 'That folder is not there. Check the path, such as ~/my-project.'
      });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Move here works on a Mac and Linux, and not on Windows', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    for (const [system, moves] of [
      ['darwin', true],
      ['linux', true],
      ['win32', false]
    ] as const) {
      Object.defineProperty(process, 'platform', { value: system });
      assert.equal(canMoveHere(), moves, system);
    }
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});

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

test('native clients get named provider settings and no office credentials', async () => {
  const { nativeEnv } = await import('./native.ts');
  const values = {
    OPENAI_API_KEY: 'fixture-provider-key',
    DATABASE_URL: 'fixture-database',
    GATEWAY_TOKEN: 'fixture-gateway',
    PROJECT_WORK_LEVEL: 'act',
    STAFF_ID: 'fixture-odd',
    ODDBORO_HOME: 'fixture-office'
  };
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    const env = nativeEnv();
    assert.equal(env.OPENAI_API_KEY, values.OPENAI_API_KEY);
    for (const key of Object.keys(values).filter((key) => key !== 'OPENAI_API_KEY'))
      assert.equal(env[key], undefined, key);
  } finally {
    for (const [key, value] of Object.entries(before))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
