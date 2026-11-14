import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from './pglite.ts';
import { staff } from '../src/schema.ts';
import type { PublicationEvent } from '../src/publications.ts';
const P = await import('../src/publications.ts');
const { setQuiet } = await import('../src/personas.ts');
const ok = () => true;
function item(sequence: number, kind: 'article' | 'video'): PublicationEvent {
  return {
    sequence,
    id: kind,
    kind,
    revision: 1,
    action: 'published',
    slug: 'pat',
    title: `An example ${kind}`,
    url: 'https://example.com/read',
    publishedAt: '2026-01-01T00:00:00Z'
  };
}
test('a follow starts at the current head, keeps both formats once, changes only the right edition, and stops on disconnect', async () => {
  await db.insert(staff).values({
    id: 'pat',
    name: 'Pat',
    role: 'Tester',
    remit: 'Test.',
    variant: 'a',
    portrait: 'a',
    desk: 'A desk.',
    package: { slug: 'pat', version: 1, disclosure: 'AI persona' }
  });
  await P.setPublicationMode('pat', 'one', 'desktop', 2);
  const send = (events: PublicationEvent[], through: number) =>
    P.receivePublications('one', events, through, ['pat'], ok);
  assert.deepEqual(await send([item(1, 'article')], 2), []);
  const batch = [item(3, 'article'), item(4, 'video')];
  assert.deepEqual(await P.receivePublications('other', batch, 4, ['pat'], ok), []);
  assert.deepEqual(await P.receivePublications('one', batch, 4, [], ok), []);
  await assert.rejects(
    P.receivePublications(
      'one',
      batch,
      4,
      ['pat'],
      (() => {
        let i = 0;
        return () => ++i === 1;
      })()
    )
  );
  assert.equal((await P.publicationLines('pat')).length, 0);
  assert.equal((await P.followedPublications('one'))[0]?.position, '2');
  assert.equal((await send(batch, 4)).length, 2);
  assert.deepEqual(await send(batch, 4), []);
  const lines = await P.publicationLines('pat');
  assert.equal(lines.length, 2);
  await P.readPublications('pat', [lines[0]!.publication.id]);
  assert.equal((await P.unreadPublications())[0]?.count, 1);
  await send(
    [
      { ...item(5, 'article'), action: 'corrected', revision: 3, title: 'Correct title' },
      { ...item(6, 'article'), action: 'corrected', revision: 2 },
      { ...item(7, 'video'), action: 'withdrawn', revision: 2 }
    ],
    7
  );
  const cards = (await P.publicationLines('pat')).map((x) => x.publication);
  assert.equal(cards.find((x) => x.kind === 'article')?.title, 'Correct title');
  assert.ok(cards.find((x) => x.kind === 'video')?.withdrawn);
  await setQuiet('pat', 'grant');
  assert.deepEqual(await P.followedPublications('one'), []);
  assert.equal((await P.publicationLines('pat')).length, 2);
});
