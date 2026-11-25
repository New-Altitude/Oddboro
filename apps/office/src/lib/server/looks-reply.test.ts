// Reading a drawn look out of Claude's reply. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReply } from './looks.ts';

const json = (hair: string) => '```json\n' + JSON.stringify({ hair }) + '\n```';
const portrait = (rows: string[]) =>
  '```px\nsprite portrait-neil\nsize 4 3\nlayer overlay\n\nframe default\n' +
  rows.join('\n') +
  '\n```';

test('a portrait sent again after a mistake is the one kept', () => {
  const broken = portrait(['7777', '7777', '7777777']);
  const fixed = portrait(['7777', '7777', '7k77']);
  const r = parseReply(
    `${json('crop')}\n\n${broken}\n\nWait, that last row is wrong: here is the full corrected portrait:\n\n${fixed}`
  );
  assert.deepEqual(r.problems, []);
  assert.match(r.drawn!.portraitPx, /7k77/);
  assert.doesNotMatch(r.drawn!.portraitPx, /7777777/);
});

test('the last json block and the last copy of a new part win', () => {
  const part = (row: string) =>
    `\`\`\`px\nsprite hair-tuft\nsize 1 1\nframe default\n${row}\n\`\`\``;
  const r = parseReply(
    [json('crop'), portrait(['7777', '7777', '7777']), part('a'), json('tuft'), part('b')].join(
      '\n\n'
    )
  );
  assert.equal((r.drawn!.look as { hair: string }).hair, 'tuft');
  assert.equal(r.drawn!.newParts.length, 1);
  assert.match(r.drawn!.newParts[0].px, /\nb\n$/);
});
