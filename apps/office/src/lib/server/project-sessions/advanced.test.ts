// Project sessions sit behind Advanced mode: off, every project route and
// stream refuses and an Odd keeps no grant; on is the owner's recorded yes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { L, request } from '../office-under-test.ts';

const { ADVANCED_OFF } = await import('./controller.ts');
const events = await import('../../../routes/api/project-sessions/[id]/events/+server.ts');

/** What a route said when it refused, or undefined when it answered. */
async function refused(answer: Response | Promise<Response>) {
  try {
    await answer;
  } catch (e) {
    const h = e as { status: number; body: { message: string } };
    return { status: h.status, message: h.body.message };
  }
}
const projects = (body: unknown) => request('/api/project-sessions', 'POST', { body });
const advanced = (on: boolean) => request('/api/setup/advanced', 'PUT', { body: { on } });
/** The session's event stream, as the owner's own page opens it. */
const stream = (id: string) => {
  const url = new URL(`http://office/api/project-sessions/${id}/events`);
  return events.GET({
    params: { id },
    url,
    request: new Request(url, { headers: { 'sec-fetch-site': 'same-origin' } })
  } as never);
};
const lines = async (title: string) =>
  L.pg<{ body: string }[]>`select body from ledger where kind = 'decision' and title = ${title}`;

test('with advanced mode off, every project route and stream refuses in plain words', async () => {
  await L.setOwnerName('Tester');
  assert.deepEqual(await refused(projects({ action: 'connections' })), {
    status: 403,
    message: ADVANCED_OFF
  });
  assert.equal((await refused(stream(randomUUID())))?.status, 403);
});

test('turning advanced mode on records the owner’s yes, and turning it off revokes grants, stops waiting work and ends open views', async () => {
  assert.deepEqual(await (await advanced(true)).json(), { on: true });
  const [yes] = await lines('Turned on advanced mode');
  assert.match(yes.body, /runs with your permissions on this computer, outside Oddboro’s limits/);
  assert.deepEqual(await (await projects({ action: 'connections' })).json(), []);

  const s = await L.connectProject('claude', randomUUID(), '/fixture/app', 'App');
  await L.shareProject(s.id, 'paige');
  await L.letSendUnasked(s.id, 'paige');
  const waiting = await L.requestProject({
    id: randomUUID(),
    sessionId: s.id,
    prompt: 'Run the tests.',
    staffId: 'paige',
    draft: true
  });
  assert.equal(waiting.state, 'proposed');
  const [listed] = (await (await projects({ action: 'connections' })).json()) as {
    status: string;
  }[];
  assert.equal(listed.status, 'waiting');

  const view = (await stream(s.id)).body!.getReader();
  const first = new TextDecoder().decode((await view.read()).value);
  assert.match(first, /^event: session/);

  assert.deepEqual(await (await advanced(false)).json(), { on: false });
  let rest = '';
  for (;;) {
    const { done, value } = await view.read();
    if (done) break;
    rest += new TextDecoder().decode(value);
  }
  assert.match(rest, /event: end/);
  assert.equal((await lines('Turned off advanced mode')).length, 1);
  const [after] = await L.pg<{ staff_id: string | null; sends_unasked: string | null }[]>`
    select staff_id, sends_unasked from project_sessions where id = ${s.id}`;
  assert.deepEqual(after, { staff_id: null, sends_unasked: null });
  const [work] = await L.pg<{ state: string }[]>`
    select state from project_requests where id = ${waiting.id}`;
  assert.equal(work.state, 'stopped');
  assert.equal((await refused(projects({ action: 'connections' })))?.status, 403);
});
