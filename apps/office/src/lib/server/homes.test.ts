// Where the office recommends each Odd lives: its run's rooms, kept only when
// real, the plain rules for the rest, and seats handed out so none is held
// twice. The office run is stubbed. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { HomeRoom } from '../staff/home.ts';

/** What the stubbed office run says next, and the messages it was sent. */
let reply = { ok: true, text: '' };
const sent: string[] = [];
mock.module(new URL('./office-run.ts', import.meta.url).href, {
  namedExports: {
    runAsOffice: async (message: string) => {
      sent.push(message);
      return reply;
    }
  }
});
const { recommendHomes } = await import('./homes.ts');

const ROOMS: HomeRoom[] = [
  {
    id: 'workspace',
    place: 'workspace#0',
    name: 'Studio',
    wing: 'Product',
    seats: [
      { id: 'ws/1', label: 'Desk 1', owner: { id: 'ivy', name: 'Ivy' } },
      { id: 'ws/2', label: 'Desk 2' },
      { id: 'ws/3', label: 'Desk 3' }
    ]
  },
  {
    id: 'library',
    place: 'library#0',
    name: 'Library',
    seats: [{ id: 'lib/1', label: 'Library table 1' }]
  }
];
const IVY = { id: 'ivy', name: 'Ivy', role: 'Designer', room: 'workspace', seat: 'ws/1' };
const odd = (id: string, role: string) => ({ id, name: id, role, remit: '' });

test("the office's rooms are kept, with a free seat each, and its reasons", async () => {
  reply = {
    ok: true,
    text: 'Here you go: {"homes": [{"odd": "rowan", "room": "workspace", "why": "Sits with Ivy, the designer."}, {"odd": "max", "room": "workspace", "why": "Next to Rowan."}]}'
  };
  const { homes, note } = await recommendHomes(
    [odd('rowan', 'Product manager'), odd('max', 'Developer')],
    ROOMS,
    [IVY]
  );
  assert.equal(note, undefined);
  assert.deepEqual(homes, [
    {
      id: 'rowan',
      room: 'workspace',
      seat: 'ws/2',
      why: 'Sits with Ivy, the designer.',
      by: 'office'
    },
    { id: 'max', room: 'workspace', seat: 'ws/3', why: 'Next to Rowan.', by: 'office' }
  ]);
  assert.match(sent.at(-1)!, /Studio, a workspace room in the Product wing/);
  assert.match(sent.at(-1)!, /Lives here: Ivy \(Designer\)/);
});

test('a room the office made up, or a failed run, falls back to the rules', async () => {
  reply = { ok: true, text: '{"homes": [{"odd": "rowan", "room": "attic", "why": "Quiet."}]}' };
  const {
    homes: [made]
  } = await recommendHomes([odd('rowan', 'Researcher')], ROOMS, [IVY]);
  assert.equal(made.by, 'rules');
  assert.equal(made.room, 'library');
  // An Odd that has a home keeps it when the office gives no word for it.
  const {
    homes: [kept]
  } = await recommendHomes([odd('ivy', 'Researcher')], ROOMS, [IVY]);
  assert.deepEqual(kept, {
    id: 'ivy',
    room: 'workspace',
    seat: 'ws/1',
    why: 'Stays where it lives now.',
    by: 'rules'
  });
  reply = { ok: true, text: 'Not logged in · Please run /login' };
  const {
    homes: [failed],
    note
  } = await recommendHomes([odd('rowan', 'Researcher')], ROOMS, [IVY]);
  assert.equal(failed.by, 'rules');
  assert.equal(
    note,
    'The office could not answer (Not logged in · Please run /login), so these come from simple rules by role.'
  );
});

test('a reply that corrects its first try counts its last whole answer', async () => {
  reply = {
    ok: true,
    text: '{"homes": [{"odd": "rowan", "room": "library", "word": ""\n\nCorrection, valid JSON only:\n\n{ "homes": [{"odd": "rowan", "room": "library", "why": "Books."}]}'
  };
  const { homes, note } = await recommendHomes([odd('rowan', 'Researcher')], ROOMS, [IVY]);
  assert.equal(note, undefined);
  assert.deepEqual(homes[0], {
    id: 'rowan',
    room: 'library',
    seat: 'lib/1',
    why: 'Books.',
    by: 'office'
  });
});

test('an Odd staying in its room keeps its seat, and nobody takes it', async () => {
  reply = {
    ok: true,
    text: '{"homes": [{"odd": "max", "room": "workspace", "why": "Stays."}, {"odd": "ivy", "room": "workspace", "why": "Stays."}]}'
  };
  const { homes } = await recommendHomes([odd('max', 'Developer'), odd('ivy', 'Designer')], ROOMS, [
    IVY
  ]);
  assert.equal(homes.find((h) => h.id === 'ivy')?.seat, 'ws/1');
  assert.equal(homes.find((h) => h.id === 'max')?.seat, 'ws/2');
});
