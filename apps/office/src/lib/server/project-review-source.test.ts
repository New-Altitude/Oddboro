import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { reviewSource, reviewMessage } from './project-review-source.ts';

test('the approved review keeps exact lines, omission count and revision without silent truncation', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'review-source-')));
  try {
    await writeFile(join(dir, 'plan.md'), 'before\nselected {owner} text\nafter');
    const source = await reviewSource(dir, 'plan.md', 2, 2);
    assert.equal(source.excerpt, 'selected {owner} text');
    assert.equal(source.omitted, 'before\n\nafter'.length);
    assert.match(reviewMessage('Check this.', source), /selected \{owner\} text/);
    assert.throws(() => reviewMessage('x'.repeat(4000), source), /Nothing was sent/);
    await writeFile(join(dir, 'plan.md'), 'changed');
    assert.notEqual((await reviewSource(dir, 'plan.md', 1, 1)).sha256, source.sha256);
    await assert.rejects(reviewSource(dir, '../outside', 1, 1));
    await writeFile(join(dir, 'binary'), Buffer.from([0, 1]));
    await assert.rejects(reviewSource(dir, 'binary', 1, 1), /text file/);
    await writeFile(join(dir, 'large'), 'x'.repeat(1_000_001));
    await assert.rejects(reviewSource(dir, 'large', 1, 1), /smaller/);
    if (process.platform !== 'win32') {
      await symlink(tmpdir(), join(dir, 'escape'));
      await assert.rejects(reviewSource(dir, 'escape', 1, 1), /inside/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the persona sees the question and the exact approved context', (t) => {
  t.assert.snapshot(
    reviewMessage('Does this argument hold?', {
      file: 'argument.md',
      sha256: 'reviewed-revision',
      start: 3,
      end: 4,
      omitted: 40,
      excerpt: 'A fact about the project.\nA claim to review.'
    })
  );
});
