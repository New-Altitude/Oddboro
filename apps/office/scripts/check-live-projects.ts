// Opt-in acceptance test. Uses both installed, signed-in CLIs and their normal
// project permissions. Run against a test office with a throwaway project.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpath, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OFFICE_PORT } from '@oddboro/ledger/home';
import { ownerCookie } from '@oddboro/ledger/owner-key';

const [address, directory] = process.argv.slice(2);
if (!address || !directory)
  throw new Error(
    'Usage: node apps/office/scripts/check-live-projects.ts http://127.0.0.1:PORT /path/to/test-project'
  );
const office = new URL(address);
assert.equal(office.hostname, '127.0.0.1', 'Use a local test office.');
// The office refuses a request without the owner's key, and the key's cookie is
// named by the office's port. Both come from ODDBORO_PORT and ODDBORO_HOME, so
// they must name the test office, or every request is refused.
assert.equal(
  Number(office.port),
  OFFICE_PORT,
  "Set ODDBORO_PORT and ODDBORO_HOME to the test office's port and home."
);
const folder = await realpath(directory);
const api = async <T>(action: string, fields: Record<string, unknown> = {}): Promise<T> => {
  const response = await fetch(new URL('/api/project-sessions', office), {
    method: 'POST',
    headers: {
      Origin: office.origin,
      'Content-Type': 'application/json',
      cookie: ownerCookie()
    },
    body: JSON.stringify({ action, ...fields })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(action + ': ' + body.message);
  return body;
};
type Session = { id: string; nativeId: string };
type History = { view: { note: string }; work: { id: string; answer?: string; state: string }[] };
const marker = randomUUID(),
  file = 'office-check-' + randomUUID() + '.txt';
await writeFile(join(folder, file), marker + '\n', { flag: 'wx' });
try {
  for (const agent of ['codex', 'claude']) {
    const title = 'Native review ' + agent + ' ' + marker.slice(0, 8);
    const session = await api<Session>('connect', { agent, folder, title });
    console.log(
      'In the test office open Projects > ' +
        title +
        '. Answer native trust or permission prompts there if needed.'
    );
    const key = randomUUID();
    await api('send', {
      id: session.id,
      key,
      prompt:
        'Read the attached project file. Return its exact contents to the office. Do not change files.',
      file
    });
    const stop = Date.now() + 180000;
    let last = '';
    while (Date.now() < stop) {
      const history = await api<History>('history', { id: session.id });
      const row = history.work.find((r) => r.id === key);
      if (row?.state === 'done') {
        assert.ok(
          row.answer?.includes(marker),
          'Expected the value only present in the project file.'
        );
        await api('disconnect', { id: session.id });
        const resumed = await api<Session>('connect', {
          agent,
          folder,
          nativeId: session.nativeId,
          handedOver: true
        });
        assert.equal(resumed.id, session.id);
        assert.equal(resumed.nativeId, session.nativeId);
        await api('disconnect', { id: session.id });
        console.log(
          agent + ' read the fixture, returned its contents and resumed the same native ID.'
        );
        break;
      }
      if (row && ['stopped', 'failed', 'uncertain'].includes(row.state))
        throw new Error(agent + ': ' + row.state);
      if (history.view.note !== last) {
        last = history.view.note;
        console.log(agent + ': ' + last);
      }
      await delay(500);
      if (Date.now() >= stop)
        throw new Error('Timed out. Inspect the ' + agent + ' session in the test office.');
    }
  }
} finally {
  await unlink(join(folder, file));
}
