import assert from 'node:assert/strict';
import { test } from 'node:test';
import { L, onPlatform, request } from './office-under-test.ts';
import { preferences, todayStories, type Command, type NewsroomView } from '../newsroom/edition.ts';
const call = async (body: Command) =>
  (await request('/api/newsroom', 'POST', { body })).json() as Promise<NewsroomView>;
const prefs = preferences.parse({ delivery: 'alerts', quietStart: '00:00', quietEnd: '00:00' });
const story = {
  id: 'board',
  title: 'Board deliberates',
  summary: 'A decision is pending.',
  consequence: 'Leadership is uncertain.',
  topic: 'business',
  sources: [{ label: 'Board', url: 'https://example.org/board' }],
  placement: 'brief',
  revision: 1,
  alert: null,
  alertText: '',
  changed: '2026-11-12T14:30:00Z',
  withdrawn: false
};
const opening = {
  version: 1,
  name: 'AI Newsroom',
  persona: 'editor',
  day: '2026-11-12',
  updated: story.changed,
  checked: story.changed,
  coverage: [],
  stories: [story],
  publications: []
};
test('Add opens a sourced edition on each system without an account; alerts follow revisions and reading choices', async (t) => {
  let edition: unknown = opening;
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json(edition));
  for (const os of ['darwin', 'linux', 'win32'] as const) {
    await onPlatform(os, async () => {
      const before = fetch.mock.callCount();
      const first = await call({ op: 'add' });
      assert.equal(first.edition?.stories[0].id, 'board');
      assert.equal(first.staff, undefined);
      assert.equal(first.notices.length, 0);
      await call({ op: 'add' });
      assert.equal(fetch.mock.callCount(), before + 1);
      await call({ op: 'remove' });
    });
  }
  await call({ op: 'add' });
  await call({ op: 'preferences', prefs });
  await call({ op: 'mark', id: 'board', mark: 'saved', on: true });
  await call({ op: 'visit' });
  const confirmed = {
    ...story,
    revision: 2,
    title: 'Board confirms the change',
    alert: 'action',
    alertText: 'Read the transition plan.'
  };
  edition = { ...opening, stories: [confirmed] };
  let v = await call({ op: 'refresh' });
  assert.deepEqual(
    v.notices.map((n) => n.key),
    ['board-2']
  );
  assert.equal(v.kept[0].revision, 2);
  assert.equal((await call({ op: 'refresh' })).notices.length, 1);
  v = await call({ op: 'mark', id: 'board', mark: 'muted', on: true });
  assert.deepEqual(todayStories(v.edition!, v.prefs, v.marks), []);
  edition = {
    ...opening,
    stories: [{ ...confirmed, revision: 3, alert: 'correction', withdrawn: true }]
  };
  v = await call({ op: 'refresh' });
  assert.equal(v.notices[0].key, 'board-3');
  assert.equal(v.kept[0].withdrawn, true);
  edition = {
    ...opening,
    stories: [{ ...story, sources: [{ label: 'Bad', url: 'javascript:alert(1)' }] }]
  };
  v = await call({ op: 'refresh' });
  assert.equal(v.kept[0].revision, 3);
  assert.ok(v.problem);
  await L.pg`update staff set package = '{"slug":"editor","version":1}' where id='sam'`;
  const pub = {
    id: 'paper',
    group: 'paper',
    title: 'New experiment',
    channel: 'article',
    published: story.changed,
    url: 'https://example.org/paper',
    withdrawn: false
  };
  await call({ op: 'preferences', prefs: { ...prefs, creator: 'chat' } });
  edition = { ...opening, publications: [pub] };
  await call({ op: 'refresh' });
  const { chatLog } = await import('./staff.ts');
  const intros = async () => (await chatLog('sam')).filter((m) => m.text.startsWith('New from '));
  assert.equal((await intros()).length, 1);
  edition = {
    ...opening,
    publications: [
      { ...pub, title: 'Corrected title' },
      { ...pub, id: 'video', channel: 'video', url: 'https://example.org/video' }
    ]
  };
  await call({ op: 'refresh' });
  assert.equal((await intros()).length, 1);
  assert.match((await intros())[0].text, /Corrected title/);
  edition = { ...opening, publications: [{ ...pub, withdrawn: true }] };
  await call({ op: 'refresh' });
  assert.doesNotMatch((await intros())[0].text, /example.org\/paper/);
  await call({ op: 'remove' });
});
