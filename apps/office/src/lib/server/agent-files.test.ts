// Every AI tool's own files are in the office's two walls: the instruction
// files no run may write (`INSTRUCTIONS`) and the folders no run may read and
// no Odd may be given (`SECRET_STORES`). Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import './office-under-test.ts';

// After the office under test set its home, as the office's own imports are.
const { AGENT_FILES, AGENTS, SECRET_STORES } = await import('@oddboro/ledger');
const { INSTRUCTIONS } = await import('./files.ts');

test("every AI tool's own instruction files and home folders are in INSTRUCTIONS and SECRET_STORES", () => {
  const missing = AGENTS.flatMap((agent) => [
    ...AGENT_FILES[agent].instructions
      .filter((name) => !INSTRUCTIONS.includes(name))
      .map((name) => `${agent}: ${name} is not in INSTRUCTIONS`),
    ...AGENT_FILES[agent].homes
      .filter((name) => !SECRET_STORES.includes(name))
      .map((name) => `${agent}: ${name} is not in SECRET_STORES`)
  ]);
  assert.deepEqual(missing, []);
});
