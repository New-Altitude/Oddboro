// A change to a layout saves over it, so its room names stay, and can be
// undone. A layout the owner is not in can be removed, with its room names
// but not its art. Moving in says in the ledger what happened. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { db } from './pglite.ts';
import type { FloorPlan, OfficeSpec } from '@oddboro/world';
import { art, ledger, offices, roomNames } from '../src/schema.ts';
import { desc, eq } from 'drizzle-orm';

const { layoutKey, moveIn, officeLayouts, removeOffice, saveArt, saveOffice, undoOffice } =
  await import('../src/offices.ts');

const drawing = (name: string) => ({
  description: `An office called ${name}`,
  spec: { name, rooms: [] } as unknown as OfficeSpec,
  plan: { name } as unknown as FloorPlan,
  templates: {},
  kinds: {}
});
const goTo = (id: number, name: string) =>
  moveIn('main-street', { id, key: layoutKey(id), name, rooms: {}, seats: {} });

test('a change saves over its layout, and a layout the owner left can be removed', async () => {
  const first = await saveOffice(drawing('Odd Orbit Station'));
  await goTo(first.id, first.name);
  await db.insert(roomNames).values({ office: layoutKey(first.id), room: 'gym', name: 'Zero G' });
  await saveArt(
    [{ name: 'star-chart', kind: 'wall-prop', about: 'A chart of the stars', px: 'x' }],
    first.id
  );

  // A change keeps the id, takes the new name, and keeps the room names.
  const changed = await saveOffice(drawing('Odd Orbit Station II'), first.id);
  assert.equal(changed.id, first.id);
  assert.equal(changed.name, 'Odd Orbit Station II');
  assert.equal((await db.select().from(offices)).length, 1);
  assert.equal(
    (
      await db
        .select()
        .from(roomNames)
        .where(eq(roomNames.office, layoutKey(first.id)))
    ).length,
    1
  );

  // The layout the owner is in cannot be removed.
  assert.equal(await removeOffice(first.id), undefined);
  assert.equal((await db.select().from(offices)).length, 1);

  // Once the owner moves elsewhere it can, with its room names. Its art stays.
  const second = await saveOffice(drawing('Main Hall'));
  await goTo(second.id, second.name);
  assert.equal(await removeOffice(first.id), 'Odd Orbit Station II');
  assert.deepEqual(
    (await db.select({ id: offices.id }).from(offices)).map((o) => o.id),
    [second.id]
  );
  assert.equal(
    (
      await db
        .select()
        .from(roomNames)
        .where(eq(roomNames.office, layoutKey(first.id)))
    ).length,
    0
  );
  const [kept] = await db.select().from(art).where(eq(art.name, 'star-chart'));
  assert.equal(kept?.drawnFor, null);

  // A change to a layout removed meanwhile is kept as a new one.
  const again = await saveOffice(drawing('Odd Orbit Station'), first.id);
  assert.notEqual(again.id, first.id);
});

test('undo brings back the version before the last change, and undoing again redoes it', async () => {
  const first = await saveOffice(drawing('Harbour'));
  assert.equal(await undoOffice(first.id), undefined);
  const canUndo = async () => (await officeLayouts()).find((l) => l.id === first.id)?.canUndo;
  assert.equal(await canUndo(), false);

  await saveOffice(drawing('Harbour with a pool'), first.id);
  assert.equal(await canUndo(), true);

  const undone = await undoOffice(first.id);
  assert.equal(undone?.id, first.id);
  assert.equal(undone?.name, 'Harbour');
  assert.equal(undone?.description, 'An office called Harbour');
  assert.equal(undone?.previous?.name, 'Harbour with a pool');

  const redone = await undoOffice(first.id);
  assert.equal(redone?.name, 'Harbour with a pool');
  assert.equal(redone?.previous?.name, 'Harbour');
});

test('moving in says what happened in the ledger', async () => {
  const last = async () =>
    (await db.select().from(ledger).orderBy(desc(ledger.id)).limit(1))[0]?.title;
  const office = await saveOffice(drawing('Lighthouse'));
  await goTo(office.id, office.name);
  assert.equal(await last(), 'Moved the office into Lighthouse');
  await moveIn(
    'main-street',
    { id: office.id, key: layoutKey(office.id), name: office.name, rooms: {}, seats: {} },
    'Undid the last change to Lighthouse'
  );
  assert.equal(await last(), 'Undid the last change to Lighthouse');
});
