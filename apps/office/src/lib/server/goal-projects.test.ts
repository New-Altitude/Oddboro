import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { L, refusal } from './office-under-test.ts';

const update = await import('../../routes/api/goals/[id]/+server.ts');
const project = await import('../../routes/api/goals/[id]/project/+server.ts');
const { readStaffFile } = await import('./files.ts');
const { projectFolder } = await import('./goal-projects.ts');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'oddboro-goal-project-')));
after(() => rmSync(root, { recursive: true, force: true }));
for (const folder of ['orchard', 'garden']) mkdirSync(join(root, folder));

async function goal(title: string) {
  const [row] = await L.pg<
    { id: number }[]
  >`insert into goals (title) values (${title}) returning id`;
  return row.id;
}
const save = async (id: number, body: unknown) =>
  update.PUT({
    params: { id: String(id) },
    request: new Request('http://office', { method: 'PUT', body: JSON.stringify(body) })
  } as Parameters<typeof update.PUT>[0]);
const read = async (id: number) =>
  project.GET({ params: { id: String(id) } } as Parameters<typeof project.GET>[0]);

test('attaching, changing and removing a project link preserves the goal and gives no Odd new access', async () => {
  const id = await goal('Grow fruit');
  const original = await L.goal(id);
  assert.equal(original?.projectFolder, null, 'existing goals need no project');
  const folders = (await L.staffer('lead'))?.folders;
  await save(id, { projectFolder: join(root, 'orchard') });
  assert.equal(
    (await L.goalsWindow()).goals.find((g) => g.id === id)?.projectFolder,
    join(root, 'orchard')
  );
  await save(id, { projectFolder: join(root, 'garden') });
  assert.equal((await L.goal(id))?.projectFolder, join(root, 'garden'));
  await save(id, { projectFolder: null });
  const kept = await L.goal(id);
  assert.equal(kept?.projectFolder, null);
  assert.equal(kept?.title, original?.title);
  assert.equal(kept?.status, original?.status);
  assert.deepEqual((await L.staffer('lead'))?.folders, folders);
  const decisions =
    await L.pg`select body from ledger where kind = 'decision' and title = 'Changed the goal: Grow fruit'`;
  assert.equal(decisions.length, 3);
  assert.equal((await refusal(read(id))).status, 404);
});

test('a project link uses one real folder and refuses missing, private, file and malformed paths', async () => {
  const id = await goal('Keep boundaries');
  const folder = join(root, 'orchard');
  symlinkSync(folder, join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await save(id, { projectFolder: join(root, 'alias') });
  assert.equal((await L.goal(id))?.projectFolder, folder);
  const file = join(root, 'only-a-file');
  writeFileSync(file, 'A file');
  for (const value of [join(root, 'gone'), file, L.home(), L.CODE, 4, {}, 'x'.repeat(4097)]) {
    assert.equal((await refusal(save(id, { projectFolder: value }))).status, 400);
    assert.equal((await L.goal(id))?.projectFolder, folder);
  }
  for (const body of [null, [], 4]) assert.equal((await refusal(save(id, body))).status, 400);
  assert.equal(projectFolder(''), null);
  for (const bad of [NaN, -1, 2 ** 31]) assert.equal((await refusal(read(bad))).status, 404);
});

test('a project brings together only linked work, keeps its waiting decision, and opens shared output without scanning the project folder', async () => {
  const first = await goal('Plan the orchard');
  const second = await goal('Plant the orchard');
  const other = await goal('Plan the garden');
  for (const id of [first, second]) await save(id, { projectFolder: join(root, 'orchard') });
  await save(other, { projectFolder: join(root, 'garden') });
  const work: number[] = [];
  for (const [i, id] of [first, second, other].entries()) {
    const [{ id: tid }] = await L.pg<
      { id: number }[]
    >`insert into threads (title, hub_id, holder_id, goal_id) values (${`Work ${i}`}, 'lead', 'lead', ${id}) returning id`;
    work.push(tid);
    const part = L.threadPart(tid, 'lead');
    mkdirSync(part, { recursive: true });
    writeFileSync(join(part, `output-${i}.md`), `Shared ${i}`);
    writeFileSync(join(part, 'AGENTS.md'), 'Instructions');
    writeFileSync(join(part, '.env'), 'Not listed');
    symlinkSync(join(root, 'only-a-file'), join(part, 'outside.md'));
  }
  writeFileSync(join(root, 'orchard', 'private-project-file.txt'), 'Not granted');
  await L.pg`insert into tasks (staff_id, title, why, steps, thread_id) values ('lead', 'Choose the trees', 'Your decision', '[]', ${work[0]})`;
  const window = await L.goalsWindow();
  assert.equal(window.goals.find((g) => g.id === first)?.threads[0].stage, 'waiting_on_you');
  const body = await (await read(first)).json();
  assert.deepEqual(body.files.map((f: { path: string }) => f.path.split('/').at(-1)).sort(), [
    'output-0.md',
    'output-1.md'
  ]);
  for (const f of body.files) {
    const opened = await readStaffFile(f.staff, f.path);
    assert.match(opened.content, /^Shared [01]$/);
  }
  assert.equal(body.capped, false);
  assert.equal((await L.goal(other))?.projectFolder, join(root, 'garden'));
});

test('native sessions stay hidden with Advanced mode off and match the linked folder when it is on', async () => {
  const id = await goal('Connect the orchard');
  await save(id, { projectFolder: join(root, 'orchard') });
  for (const name of ['orchard', 'garden'])
    await L.pg`insert into project_sessions (id, agent, native_id, folder, title) values (${name}, 'claude', ${name}, ${join(root, name)}, ${name})`;
  await L.setOwnerName(await L.ownerName());
  await L.setAdvancedMode(false);
  const hidden = await (await read(id)).json();
  assert.equal(hidden.advanced, false);
  assert.deepEqual(hidden.sessions, []);
  await L.setAdvancedMode(true);
  const shown = await (await read(id)).json();
  assert.equal(shown.advanced, true);
  assert.deepEqual(
    shown.sessions.map((s: { id: string }) => s.id),
    ['orchard']
  );
  await L.setAdvancedMode(false);
  assert.deepEqual((await (await read(id)).json()).sessions, []);
});
