import assert from 'node:assert/strict';
import * as processes from 'node:child_process';
import { mock, test } from 'node:test';
import { promisify } from 'node:util';

const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
let result = 'test credential';
const execFile = Object.assign(() => {}, {
  [promisify.custom]: async (_path: string, args: string[], opts: { env: NodeJS.ProcessEnv }) => {
    calls.push({ args, env: opts.env });
    if (!result) throw new Error('CLI output that must stay out of the Desk');
    return { stdout: result };
  }
});
mock.module('node:child_process', { exports: { ...processes, execFile } });
mock.module(new URL('./on-path.ts', import.meta.url).href, { exports: { onPath: () => 'op' } });
const { readOnePasswordField } = await import('./one-password.ts');

test('only a field reference reaches the CLI, and a later connection reads the current field', async () => {
  await assert.rejects(readOnePasswordField('op://vault/item'), /Copy the secret reference/);
  assert.equal(calls.length, 0);
  const ref = 'op://Office vault/Inspection register/keys/API key';
  assert.equal(await readOnePasswordField(ref), 'test credential');
  assert.deepEqual(calls[0].args, ['read', '--no-newline', ref]);
  result = 'rotated credential';
  assert.equal(await readOnePasswordField(ref), result);
  result = '';
  await assert.rejects(readOnePasswordField(ref), {
    message: '1Password could not read that field. Check the reference and your CLI access.'
  });
});
