// Real persona HTTP and database, with no paid coding-tool run.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { L, secrets, folder } from './office-under-test.ts';
import { fakeNewAltitude, MEMBER } from './fake-new-altitude.ts';
const fake = await fakeNewAltitude();
process.env.ODDBORO_ACCOUNT_SITE = fake.origin;
/** A sign-in kept as the callback keeps it, with both tokens live at the fake. */
function signedIn(id: string, scope: string, token: string, extra: object = {}) {
  fake.issueGrant(`access-${token}`, `refresh-${token}`, scope);
  secrets.set(
    `${id}:oauth`,
    JSON.stringify({
      tokens: {
        access_token: `access-${token}`,
        refresh_token: `refresh-${token}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope
      },
      savedAt: Date.now(),
      ...extra
    })
  );
}
signedIn('new-altitude-account', 'profile personas', 'seed', {
  profile: { id: MEMBER.id, name: MEMBER.name, email: MEMBER.email },
  discovery: { authorizationServerUrl: fake.origin }
});
signedIn('new-altitude-persona-pat', 'stream', 'door');
// After the office under test is set up, as its own imports are.
const { installPersona } = await import('./persona.ts');
await L.setOwnerName('Ada');
await installPersona('pat');
const pat = (await L.personaOdd('pat'))!;
assert.ok(pat, 'pat was not installed');

after(() => fake.close());

const { previewProjectReview, askProjectReview } = await import('./project-reviews.ts');
const { sql } = await import('../../../../../packages/ledger/src/db.ts');
const project = join(realpathSync(folder), 'project');
mkdirSync(project);
writeFileSync(
  join(project, 'argument.md'),
  'A unique project fact.\nUse the local editorial skill.\nOmitted material.'
);
const deliveries = () => fake.seen.filter((r) => r.method === 'POST' && r.path === '/pat/stream');

for (const agent of ['codex', 'claude'] as const)
  test(`${agent}: a real persona answer retains approved context, sources and original session`, async () => {
    const s = await L.connectProject(agent, randomUUID(), project, 'Original');
    const untouched = await L.connectProject(agent, randomUUID(), project, 'Another conversation');
    await L.shareProject(s.id, pat.id);
    const draft = await previewProjectReview({
      sessionId: s.id,
      personaId: pat.id,
      file: 'argument.md',
      start: 1,
      end: 2,
      question: 'Review the argument; preserve {owner} literally.'
    });
    const count = deliveries().length;
    fake.door = {
      ...fake.door,
      reply: 'Keep the project fact. [Source](https://example.test/evidence)'
    };
    const answer = await askProjectReview(draft.id);
    assert.equal(answer?.state, 'answered');
    assert.equal(deliveries().length, count + 1);
    assert.equal(JSON.parse(deliveries().at(-1)!.body).message, draft.message);
    assert.equal(draft.source.omitted, '\nOmitted material.'.length);
    await askProjectReview(draft.id);
    assert.equal(deliveries().length, count + 1, 'repeated request reuses authentic answer');
    const returned = await L.returnProjectReview(draft.id, 'Keep the editorial skill separate.');
    assert.equal(returned.sessionId, s.id);
    assert.ok(returned.prompt.includes(answer!.answer!));
    assert.equal((await L.projectWork(untouched.id)).length, 0);
    // Simulate a restart after the consultation was saved but before its review row was finished.
    await sql`UPDATE project_reviews SET state = 'asking', answer = NULL WHERE id = ${draft.id}`;
    assert.equal((await askProjectReview(draft.id))?.answer, answer?.answer);
    assert.equal(deliveries().length, count + 1, 'recovery reads the kept consultation');
  });

test('changed sources, unavailable personas and overlong context fail before the door', async () => {
  const s = await L.connectProject('codex', randomUUID(), project, 'Review validation');
  await L.shareProject(s.id, pat.id);
  const params = {
    sessionId: s.id,
    personaId: pat.id,
    file: 'argument.md',
    start: 1,
    end: 2,
    question: 'Check.'
  };
  const draft = await previewProjectReview(params);
  const original = readFileSync(join(project, 'argument.md'), 'utf8');
  const count = deliveries().length;
  writeFileSync(join(project, 'argument.md'), 'changed');
  await assert.rejects(askProjectReview(draft.id), /source changed/);
  writeFileSync(join(project, 'argument.md'), original);
  await assert.rejects(
    previewProjectReview({ ...params, question: 'x'.repeat(4000) }),
    /Nothing was sent/
  );
  await assert.rejects(previewProjectReview({ ...params, personaId: 'missing' }), /connected/);
  assert.equal(deliveries().length, count);
});
