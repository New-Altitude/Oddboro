// Find existing reads Claude Code's own session files, as the Agent SDK's
// listSessions did, from fixture files in a throwaway Claude folder.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { claudeHome, savedClaudeSessions } from './claude-sessions.ts';

const lines = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
const user = (content: unknown, extra: object = {}) => ({
  type: 'user',
  parentUuid: null,
  cwd: FOLDER,
  message: { role: 'user', content },
  ...extra
});
const FOLDER = '/work/my-app.v2';

test('saved Claude conversations come back with their title, folder and last change, newest first', async () => {
  const home = await mkdtemp(join(tmpdir(), 'office-claude-'));
  try {
    // Claude Code's key: each character but a letter or digit becomes "-".
    const dir = join(home, 'projects', '-work-my-app-v2');
    await mkdir(dir, { recursive: true });
    const file = async (id: string, body: string, at: number) => {
      const path = join(dir, id + '.jsonl');
      await writeFile(path, body);
      await utimes(path, at / 1000, at / 1000);
    };
    const [named, prompted, titled, command, sidechain, moved, newer] = Array.from(
      { length: 7 },
      () => randomUUID()
    );
    await file(
      named,
      lines(
        user('First question'),
        { type: 'ai-title', aiTitle: 'Claude’s title' },
        { type: 'custom-title', customTitle: 'Old name' },
        { type: 'custom-title', customTitle: 'Release checklist' }
      ),
      1_800_000_000_000
    );
    await file(
      prompted,
      lines(
        { type: 'mode', mode: 'normal' },
        user('<system-reminder>A note Claude added</system-reminder>'),
        user('Hello', { isMeta: true }),
        user([{ type: 'tool_result', content: 'ignored' }]),
        user([{ type: 'text', text: '  Fix the\nlogin   page ' }])
      ),
      1_700_000_000_000
    );
    await file(
      titled,
      lines(user('Write the docs'), { type: 'ai-title', aiTitle: 'Docs for the API' }),
      1_600_000_000_000
    );
    await file(
      command,
      lines(user('<command-name>/clear</command-name><command-args></command-args>')),
      1_500_000_000_000
    );
    await file(sidechain, lines({ ...user('A subagent'), isSidechain: true }), 1_900_000_000_000);
    // Carried on in a newer file: only the newer one shows.
    await file(
      moved,
      lines(user('Earlier half'), { type: 'continued-in', continuedInSessionId: newer }),
      1_400_000_000_000
    );
    await file(newer, lines(user('Later half')), 1_450_000_000_000);
    await writeFile(join(dir, 'notes.jsonl'), lines(user('Not a session')));
    await writeFile(join(dir, randomUUID() + '.jsonl'), lines({ type: 'mode' }));

    const rows = await savedClaudeSessions(FOLDER, home);
    assert.deepEqual(
      rows.map((r) => [r.sessionId, r.title, r.cwd, r.lastModified]),
      [
        [named, 'Release checklist', FOLDER, 1_800_000_000_000],
        [prompted, 'Fix the login   page', FOLDER, 1_700_000_000_000],
        [titled, 'Docs for the API', FOLDER, 1_600_000_000_000],
        [command, '/clear', FOLDER, 1_500_000_000_000],
        [newer, 'Later half', FOLDER, 1_450_000_000_000]
      ]
    );
    assert.deepEqual(await savedClaudeSessions('/work/other', home), []);
    assert.deepEqual(await savedClaudeSessions(FOLDER, join(home, 'missing')), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('a long folder finds its hashed key, and only its own folder counts', async () => {
  const home = await mkdtemp(join(tmpdir(), 'office-claude-'));
  try {
    const folder = '/work/' + 'deep/'.repeat(45) + 'app';
    const key = folder.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 200) + '-1x2y3z';
    await mkdir(join(home, 'projects', key), { recursive: true });
    const id = randomUUID();
    await writeFile(
      join(home, 'projects', key, id + '.jsonl'),
      lines({ type: 'user', cwd: folder, message: { content: 'Deep work' } })
    );
    const [row] = await savedClaudeSessions(folder, home);
    assert.equal(row.sessionId, id);
    assert.equal(row.cwd, folder);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("Claude's folder follows CLAUDE_CONFIG_DIR, as the native client does", () => {
  assert.equal(claudeHome({ CLAUDE_CONFIG_DIR: '/accounts/work' }), '/accounts/work');
  assert.match(claudeHome({}), /\.claude$/);
});
