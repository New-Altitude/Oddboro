// mountedForClient puts a real component in a browser-like document, so a test
// drives it as the owner does: typing, leaving a field, clicking.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mountedForClient } from './mounted-for-client.ts';
import type NewSessionFormComponent from '../NewSessionForm.svelte';
import type ProjectSessionsComponent from '../ProjectSessions.svelte';
import { NO_FOLDER, type FormChange } from '../project-form.ts';

const ui = join(dirname(fileURLToPath(import.meta.url)), '..');

function button(root: HTMLElement, words: string): HTMLButtonElement {
  const found = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes(words));
  assert.ok(found, `a button reading "${words}"`);
  return found;
}

test('Typing, leaving a field and a click on a mounted component reach its callbacks', async () => {
  const seen: (FormChange | 'pick')[] = [];
  const nothing = () => {};
  const form = await mountedForClient<typeof NewSessionFormComponent>(
    join(ui, 'NewSessionForm.svelte'),
    {
      folder: '',
      agent: 'claude',
      socket: '',
      name: '',
      startIn: '',
      filter: '',
      path: undefined,
      fields: {
        account: false,
        start: false,
        list: false,
        refresh: false,
        handover: false,
        socket: false
      },
      folders: [],
      candidates: [],
      found: false,
      listing: false,
      busy: false,
      problem: undefined,
      place: undefined,
      problemRow: undefined,
      setup: undefined,
      onfilter: nothing,
      onchange: (change) => seen.push(change),
      onpick: () => seen.push('pick'),
      onpath: nothing,
      onstart: nothing,
      onchoose: nothing,
      onmove: nothing,
      onsetuperror: nothing,
      onhandover: nothing
    }
  );
  const folder = form.target.querySelector('input');
  assert.ok(folder, 'the Project folder field');
  folder.value = '/work/app';
  folder.dispatchEvent(new Event('input', { bubbles: true }));
  folder.dispatchEvent(new Event('change', { bubbles: true }));
  button(form.target, 'Choose folder').click();
  form.flush();
  assert.deepEqual(seen, ['typed', 'folder', 'pick']);
  await form.unmount();
  assert.equal(form.target.isConnected, false);
});

test('A component that imports components, a stylesheet and a .svelte.ts module mounts whole, and a click in the nested one changes what the outer one shows', async () => {
  const asked: string[] = [];
  // The window lists its sessions and Claude folders as it mounts; none here.
  globalThis.fetch = async (_url, init) => {
    asked.push(JSON.parse(String(init?.body)).action);
    return Response.json([]);
  };
  const projects = await mountedForClient<typeof ProjectSessionsComponent>(
    join(ui, 'ProjectSessions.svelte'),
    { staff: [], version: 0, ask: { n: 0 } }
  );
  // The two lists answer in the same turn of the event loop they were asked in.
  await new Promise((done) => setImmediate(done));
  projects.flush();
  assert.deepEqual(asked.toSorted(), ['connections', 'folders']);
  assert.ok(projects.target.querySelector('nav[aria-label="Sessions"]'), 'the session list');
  assert.equal(projects.target.querySelector('h3')?.textContent, 'New session');
  assert.ok(!projects.target.textContent?.includes(NO_FOLDER));
  button(projects.target, 'Continue an earlier one').click();
  projects.flush();
  assert.ok(
    projects.target.textContent?.includes(NO_FOLDER),
    'the continue path asks for a folder'
  );
  await projects.unmount();
});
