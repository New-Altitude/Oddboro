// What the owner tells a colleague in chat about a thread reaches the
// thread's lead: the colleague's chat lists the threads it works on and does
// not lead, and tell_lead passes the owner's own words to the lead. The
// office's own code on every migration, in an in-memory PGlite that stands in
// for db.ts (pglite.ts). Run with `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { connectors, followUps, grants, staff, threads } from '../src/schema.ts';
import { db } from './pglite.ts';

// Loaded once db.ts is this database, so every query they make lands here.
const { handOff } = await import('../src/hand-offs.ts');
const { raiseAsk } = await import('../src/office.ts');
const { exchangeForLead, tellLead, threadFolder, threadPart, threadsOn, threadsOnBrief } =
  await import('../src/threads.ts');

const odd = (id: string, name: string) => ({
  id,
  name,
  role: 'Tester',
  remit: 'Tests.',
  variant: 'a',
  portrait: 'a',
  permission: 'draft' as const,
  desk: `You are ${name}.`
});
await db.insert(staff).values([odd('cole', 'Cole'), odd('bram', 'Bram'), odd('rex', 'Rex')]);

/** `hub` hands `to` a piece of work on a new thread. Returns the thread. */
async function onThread(hub: string, to: string, title: string): Promise<number> {
  const r = await handOff({
    from: hub,
    to,
    work: { title: 'Draw the presets', brief: 'Draw two presets.' },
    thread: { title }
  });
  assert.ok('id' in r, JSON.stringify(r));
  return r.thread;
}
const presets = await onThread('cole', 'bram', 'Presets for the sim');
const ownThread = await onThread('bram', 'rex', 'Bram leads this one');

const said = 'Thanks Bram. On the presets: make the colours warmer.\nAlso, lunch at one?';
const reading = 'Sam wants the presets in warmer colours.';
const tell = (staffId: string, threadId: number, words = 'make the colours warmer.') =>
  tellLead({ staffId, threadId, owner: 'Sam', said, words, reading });
const resumes = (id: number) =>
  db
    .select()
    .from(followUps)
    .where(and(eq(followUps.threadId, id), eq(followUps.kind, 'resume')));

// Gil holds Gmail. Lena leads work Gil is on and lacks it; Mae leads other
// work Gil is on and holds it too. Every office has Gmail (0009_google): mark
// it connected, so Mae's grant is in force. Set up here, above the first test:
// under --test-force-exit the runner drops every test registered after a
// top-level await.
await db.insert(staff).values([odd('gil', 'Gil'), odd('lena', 'Lena'), odd('mae', 'Mae')]);
await db.update(connectors).set({ readyAt: new Date() }).where(eq(connectors.id, 'gmail'));
await db.insert(grants).values([
  { staffId: 'gil', connectorId: 'gmail', level: 'read' },
  { staffId: 'mae', connectorId: 'gmail', level: 'read' }
]);

test("a colleague's chat lists the threads it works on and does not lead, with each lead and where it stands", async () => {
  const rows = await threadsOn('bram');
  assert.deepEqual(rows, [
    { id: presets, title: 'Presets for the sim', stage: 'under_way', lead: 'Cole', goalId: null }
  ]);
  const brief = threadsOnBrief(rows);
  assert.match(brief, /^## Work you are on$/m);
  assert.ok(brief.includes(`- Work ${presets}: Presets for the sim, led by Cole (under way).`));
  assert.match(brief, /pass their words to its lead with tell_lead/);
  assert.equal(threadsOnBrief(await threadsOn('cole')), '');
});

test("tell_lead writes one resume for the lead, with the owner's words, the colleague's reading labelled as not theirs, and the last exchange, on one line", async () => {
  const r = await tellLead({
    staffId: 'bram',
    threadId: presets,
    owner: 'Sam',
    said,
    words: 'make the colours warmer.',
    reading: 'Sam wants the presets\nin warmer colours.',
    exchange: 'Just before, Sam said: "Done yet?".\nBram replied: "Nearly.".'
  });
  assert.deepEqual(r, { lead: 'Cole' });
  const [wake, ...more] = await resumes(presets);
  assert.equal(more.length, 0);
  assert.equal(wake.staffId, 'cole');
  assert.equal(
    wake.note,
    'Bram passed you what Sam told them in chat about this work. You decide what comes of it and hand on any work it needs; Bram does nothing more with it. Sam\'s words: make the colours warmer. Bram\'s own reading, which is not Sam\'s words: Sam wants the presets in warmer colours. Just before, Sam said: "Done yet?". Bram replied: "Nearly.".'
  );
});

test('a tell_lead with no reading is refused', async () => {
  const quiet = await onThread('cole', 'bram', 'Presets with no reading');
  const r = await tellLead({
    staffId: 'bram',
    threadId: quiet,
    owner: 'Sam',
    said,
    words: 'make the colours warmer.',
    reading: ' \n '
  });
  assert.ok('problem' in r && r.problem.includes('in reading'), JSON.stringify(r));
  assert.equal((await resumes(quiet)).length, 0);
});

test("a colleague's chat is told to work out a clarification in chat and pass nothing on", async () => {
  const rows = await threadsOn('bram');
  assert.match(threadsOnBrief(rows), /work it out in chat and pass nothing on/);
});

test("words that are not the owner's are refused, so nothing else reaches the lead as theirs", async () => {
  const before = (await resumes(presets)).length;
  const r = await tell('bram', presets, 'make the colours colder.');
  assert.ok('problem' in r && r.problem.includes('copied exactly'), JSON.stringify(r));
  assert.equal((await resumes(presets)).length, before);
});

test('tell_lead on a thread the Odd leads is refused', async () => {
  const r = await tell('bram', ownThread);
  assert.ok('problem' in r && r.problem.includes('You lead work'), JSON.stringify(r));
  assert.equal((await resumes(ownThread)).length, 0);
});

test('tell_lead on a thread the Odd is not on is refused', async () => {
  const r = await tell('rex', presets);
  assert.ok('problem' in r && r.problem.includes('is not work you are on'), JSON.stringify(r));
});

test('tell_lead on a thread the owner stopped is refused', async () => {
  const stopped = await onThread('cole', 'bram', 'Stopped work');
  await db
    .update(threads)
    .set({ status: 'stopped', endedAt: new Date() })
    .where(eq(threads.id, stopped));
  const r = await tell('bram', stopped);
  assert.ok('problem' in r && r.problem.includes('stopped'), JSON.stringify(r));
  assert.equal((await resumes(stopped)).length, 0);
});

test("a colleague's chat says the work waits on the owner while an ask raised on it is open", async () => {
  const raised = await onThread('cole', 'bram', 'Presets to buy');
  await raiseAsk('cole', {
    title: 'Buy a preset pack',
    why: 'It saves a day.',
    ifApproved: 'I buy it.',
    threadId: raised
  });
  const row = (await threadsOn('bram')).find((t) => t.id === raised);
  assert.ok(row, 'Bram is not on the work');
  assert.equal(row.stage, 'waiting_on_you');
  assert.ok(threadsOnBrief([row]).includes('led by Cole (waiting on {owner})'));
});

const exchange = 'Just before, Sam said: "Any news?".\nGil replied: "The bank wrote back.".';
const fromGil = async (lead: string, title: string, exchange?: string) => {
  const id = await onThread(lead, 'gil', title);
  const r = await tellLead({
    staffId: 'gil',
    threadId: id,
    owner: 'Sam',
    said,
    words: 'make the colours warmer.',
    reading,
    exchange
  });
  assert.ok('lead' in r, JSON.stringify(r));
  const [wake] = await resumes(id);
  return wake.note ?? '';
};
const gilsReading = `Gil's own reading, which is not Sam's words: ${reading}`;

test('a lead holding every tool the colleague holds reads the last exchange in full', async () => {
  assert.ok(
    (await fromGil('mae', 'Mae holds Gmail', exchange)).endsWith(
      `${gilsReading} Just before, Sam said: "Any news?". Gil replied: "The bank wrote back.".`
    )
  );
});

test("a lead lacking a tool the colleague holds reads the owner's line and not the colleague's, and is told one line was left out", async () => {
  const note = await fromGil('lena', 'Lena lacks Gmail', exchange);
  assert.ok(
    note.endsWith(
      `${gilsReading} Just before, Sam said: "Any news?". One line Gil said in that chat is left out, since Gil has Gmail and you do not.`
    ),
    note
  );
  assert.ok(!note.includes('bank'), note);
});

test("a colleague's line alone is left out for a lead lacking its tools", async () => {
  const note = await fromGil(
    'lena',
    'Lena lacks Gmail, Gil spoke first',
    'Just before, Gil said: "The bank wrote back.".'
  );
  assert.ok(
    note.endsWith(
      `${gilsReading} One line Gil said in that chat is left out, since Gil has Gmail and you do not.`
    ),
    note
  );
});

test("with no exchange, a lead lacking the colleague's tools reads the note as it was", async () => {
  assert.ok((await fromGil('lena', 'Lena lacks Gmail, no exchange')).endsWith(gilsReading));
});

test("with the colleague's line set to be quoted, a lead lacking its tools reads the exchange in full", () => {
  assert.equal(
    exchangeForLead(exchange, 'Gil', [{ id: 'gmail', name: 'Gmail' }], 'quoted'),
    'Just before, Sam said: "Any news?". Gil replied: "The bank wrote back.".'
  );
});

/** A file the owner attached, kept outside every work: what `tellLead` copies in. */
function attached(name: string, text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'oddboro-attached-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const real = join(dir, name);
  writeFileSync(real, text);
  return { real, name: `attachments-${name}`, named: name };
}
// A junction on Windows, which needs no admin.
const linkFolder = (to: string, at: string) =>
  symlinkSync(to, at, process.platform === 'win32' ? 'junction' : 'dir');

test("a file the owner attached lands in the colleague's part once, and told again it is left as it is and listed again", async () => {
  const work = await onThread('cole', 'rex', 'Presets with a sketch');
  const sketch = attached('sketch.png', 'png');
  const at = join(threadPart(work, 'rex'), 'attachments-sketch.png');
  for (const time of ['first', 'again']) {
    const r = await tellLead({
      staffId: 'rex',
      threadId: work,
      owner: 'Sam',
      said,
      words: 'make the colours warmer.',
      reading,
      files: { carry: [sketch], unfit: [] }
    });
    assert.deepEqual(r, { lead: 'Cole', files: [{ named: 'sketch.png', at }] }, time);
  }
  assert.equal(readFileSync(at, 'utf8'), 'png');
  const [wake] = await resumes(work);
  const lines = (wake.note ?? '').split('\n');
  assert.equal(lines.length, 2, 'the second joins the pick-up still to start');
  for (const line of lines)
    assert.ok(
      line.endsWith(
        `Rex's own reading, which is not Sam's words: ${reading} Sam attached a file to that message, now in this work: sketch.png at ${at}.`
      ),
      line
    );
});

test("a file that cannot land never holds back the owner's words: the lead is told which did not come and why", async () => {
  const work = await onThread('cole', 'rex', 'Presets with a linked part');
  const elsewhere = mkdtempSync(join(tmpdir(), 'oddboro-elsewhere-'));
  after(() => rmSync(elsewhere, { recursive: true, force: true }));
  mkdirSync(threadFolder(work), { recursive: true });
  linkFolder(elsewhere, threadPart(work, 'rex'));
  const r = await tellLead({
    staffId: 'rex',
    threadId: work,
    owner: 'Sam',
    said,
    words: 'make the colours warmer.',
    reading,
    files: {
      carry: [attached('swatch.png', 'png')],
      unfit: [{ named: 'Image #2', why: 'it is reached through a link' }]
    }
  });
  assert.ok('lead' in r, JSON.stringify(r));
  assert.deepEqual(readdirSync(elsewhere), [], 'nothing landed through the link');
  const [wake] = await resumes(work);
  assert.ok(
    wake.note?.endsWith(
      `Rex's own reading, which is not Sam's words: ${reading} 2 files Sam attached did not come: swatch.png, since the part of the work it would land in is a link; Image #2, since it is reached through a link.`
    ),
    wake.note ?? ''
  );
});
