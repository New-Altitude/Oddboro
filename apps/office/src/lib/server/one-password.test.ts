import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import * as platform from '@oddboro/ledger/platform';

const calls: string[][] = [];
let result = 'test credential';
mock.module('@oddboro/ledger/platform', {
  exports: {
    ...platform,
    probe: async (cmd: string, args: string[]) => {
      assert.equal(cmd, 'op');
      calls.push(args);
      return result
        ? { status: 'ok', out: result, err: '' }
        : { status: 'failed', out: '', err: 'CLI output that must stay out of the Desk' };
    }
  }
});
const { readOnePasswordField } = await import('./one-password.ts');

test('only a field reference reaches the CLI, and a later connection reads the current field', async () => {
  await assert.rejects(readOnePasswordField('op://vault/item'), /Copy the secret reference/);
  assert.equal(calls.length, 0);
  const ref = 'op://Office vault/Inspection register/keys/API key';
  assert.equal(await readOnePasswordField(ref), 'test credential');
  assert.deepEqual(calls[0], ['read', '--no-newline', ref]);
  result = 'rotated credential';
  assert.equal(await readOnePasswordField(ref), result);
  result = '';
  await assert.rejects(readOnePasswordField(ref), {
    message: '1Password could not read that field. Check the reference and your CLI access.'
  });
});
