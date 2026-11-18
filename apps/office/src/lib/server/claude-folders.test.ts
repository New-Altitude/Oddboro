// Setup's Claude folders (`/api/setup/claude-folders`): the owner names a
// Claude Code folder by typing its path, and takes one out again. Each is kept
// as typed, and anything that would shut every Odd's folder is refused. The
// ledger's claude-folders.test.ts holds the list itself. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { test } from 'node:test';
import { L, onPlatform, request, withEnv } from './office-under-test.ts';

const { ADVANCED_OFF } = await import('./project-sessions/controller.ts');
const { readEnv } = await import('@oddboro/ledger/env');

type Listed = {
  folders: { path: string; isDefault: boolean; found: boolean; mark: string }[];
  suggested: string[];
};

/** What the route said when it refused, or undefined when it answered. */
async function refused(answer: Promise<Response>) {
  try {
    await answer;
  } catch (e) {
    const h = e as { status: number; body: { message: string } };
    return { status: h.status, message: h.body.message };
  }
}
const route = '/api/setup/claude-folders';
const list = async () => (await (await request(route, 'GET')).json()) as Listed;
const put = async (body: { add: string } | { remove: string }) =>
  (await (await request(route, 'PUT', { body })).json()) as Listed;
const notNamed = (body: { add: string } | { remove: string }) =>
  refused(request(route, 'PUT', { body }));
const stored = () => readEnv()[L.CLAUDE_FOLDERS_KEY];

/** Each system, with the character that joins its named folders in `.env`. */
const SYSTEMS = [
  { platform: 'darwin', joins: ':' },
  { platform: 'linux', joins: ':' },
  { platform: 'win32', joins: ';' }
] as const;

test('Setup names and removes Claude folders on a Mac, Linux and Windows', async (t) => {
  await L.setOwnerName('Tester');
  assert.equal((await refused(request(route, 'GET')))?.status, 403);
  assert.deepEqual(await notNamed({ add: tmpdir() }), { status: 403, message: ADVANCED_OFF });
  await request('/api/setup/advanced', 'PUT', { body: { on: true } });

  for (const { platform, joins } of SYSTEMS)
    await t.test(
      platform,
      {
        skip:
          process.platform === 'win32' &&
          platform !== 'win32' &&
          'a Windows path holds a colon, the list’s delimiter on a Mac and Linux'
      },
      () =>
        onPlatform(platform, async () => {
          // HOME on a Mac and Linux, USERPROFILE on Windows: `~` is this folder.
          const h = mkdtempSync(join(tmpdir(), 'oddboro-owner-'));
          const elsewhere = mkdtempSync(join(tmpdir(), 'oddboro-claude-'));
          try {
            await withEnv({ HOME: h, USERPROFILE: h }, async () => {
              for (const d of ['.claude', '.claude-b', 'a#b', `a${joins}b`]) mkdirSync(join(h, d));
              const b = join(h, '.claude-b');
              // A folder reached through a link, as a shell's own path to it.
              const target = join(elsewhere, 'claude-c');
              mkdirSync(target);
              const link = join(h, '.claude-c');
              symlinkSync(target, link, 'junction');
              writeFileSync(join(h, 'notes.txt'), 'not a folder');
              // Projects' own settings folders: one outside the home, one in it,
              // one reached through a link, and two spelled in capitals.
              const repo = join(elsewhere, 'repo', '.claude');
              const shop = join(h, 'code', 'shop', '.claude');
              const capitals = join(elsewhere, 'other', '.CLAUDE');
              const titled = join(elsewhere, 'third', '.Claude');
              for (const d of [repo, shop, capitals, titled]) mkdirSync(d, { recursive: true });
              symlinkSync(repo, join(h, '.claude-repo'), 'junction');
              // A link to `~/.claude` is `~/.claude`.
              symlinkSync(join(h, '.claude'), join(h, '.claude-home'), 'junction');
              mkdirSync(join(L.accountsHome(), 'claude'), { recursive: true });

              const always = '~/.claude is always in the list.';
              const broad =
                'That folder is your home, a whole drive, or holds your home or the office. Name the Claude folder itself.';
              const office = 'That folder is part of the office.';
              const characters = `A Claude folder’s path cannot hold #, ${joins} or a line break.`;
              const project = 'That’s a project’s settings folder, not a Claude account folder.';
              for (const [add, message] of [
                ['.claude-b', 'Type the folder’s full path, or start it with ~.'],
                [join(h, 'notes.txt'), 'There is no folder there.'],
                ['~/.claude', always],
                ['~/.claude-home', always],
                ['~', broad],
                [h, broad],
                [parse(h).root, broad],
                [dirname(h), broad],
                [L.home(), office],
                [join(L.accountsHome(), 'claude'), office],
                [join(h, 'a#b'), characters],
                [join(h, `a${joins}b`), characters],
                [`${b}\nODDBORO_PORT=1`, characters],
                [repo, project],
                [`${repo}/`, project],
                [shop, project],
                ['~/code/shop/.claude', project],
                ['~/code/shop/.claude/', project],
                ['~/.claude-repo', project],
                // A project's `.claude` in any case, on every system.
                [capitals, project],
                [titled, project]
              ])
                assert.deepEqual(await notNamed({ add }), { status: 400, message }, add);
              assert.equal(stored(), undefined);

              // `~` expands, and a trailing slash goes.
              await put({ add: '~/.claude-b/' });
              // Kept as typed, not by its real path: Claude Code names its Keychain sign-in after it.
              const named = await put({ add: link });
              assert.equal(stored(), `${b}${joins}${link}`);
              // The same folder by its real path is already there.
              assert.deepEqual(await put({ add: realpathSync.native(target) }), named);
              assert.equal(stored(), `${b}${joins}${link}`);

              const listed = await list();
              assert.deepEqual(listed, named);
              assert.deepEqual(
                listed.folders.map(({ path, isDefault, found }) => ({ path, isDefault, found })),
                [
                  { path: join(h, '.claude'), isDefault: true, found: true },
                  { path: b, isDefault: false, found: true },
                  { path: link, isDefault: false, found: true }
                ]
              );

              const dotClaude = join(h, '.claude');
              for (const remove of [dotClaude, realpathSync.native(dotClaude)])
                assert.deepEqual(await notNamed({ remove }), { status: 400, message: always });
              await put({ remove: b });
              assert.equal(stored(), link);
              assert.deepEqual(
                (await put({ remove: link })).folders.map((f) => f.path),
                [join(h, '.claude')]
              );
              assert.equal(stored(), undefined);

              // A second home's `.claude` holds what Claude Code keeps in an
              // account folder, so it is one, by its path or through a link.
              const workHome = join(h, 'work-home', '.claude');
              mkdirSync(join(workHome, 'projects'), { recursive: true });
              writeFileSync(join(workHome, 'history.jsonl'), '');
              const workLink = join(h, '.claude-work');
              symlinkSync(workHome, workLink, 'junction');
              await put({ add: '~/work-home/.claude' });
              assert.equal(stored(), workHome);
              await put({ remove: workHome });
              await put({ add: workLink });
              assert.equal(stored(), workLink);
              await put({ remove: workLink });
              assert.equal(stored(), undefined);
            });
          } finally {
            L.setClaudeFolders([]);
            rmSync(h, { recursive: true, force: true });
            rmSync(elsewhere, { recursive: true, force: true });
          }
        })
    );
});

test('Setup suggests the account folders in the home folder not named yet, on a Mac, Linux and Windows', async (t) => {
  await L.setOwnerName('Tester');
  await request('/api/setup/advanced', 'PUT', { body: { on: true } });
  // What Claude Code keeps in an account folder; a folder needs both to be suggested.
  assert.deepEqual(L.CLAUDE_ACCOUNT_MARKS, ['history.jsonl', 'projects']);
  /** Makes `folder` holding `marks`: the history a file, the projects a folder. */
  const marked = (folder: string, marks = L.CLAUDE_ACCOUNT_MARKS) => {
    mkdirSync(folder, { recursive: true });
    for (const m of marks)
      if (m === 'projects') mkdirSync(join(folder, m));
      else writeFileSync(join(folder, m), '');
  };

  for (const { platform } of SYSTEMS)
    await t.test(
      platform,
      {
        skip:
          process.platform === 'win32' &&
          platform !== 'win32' &&
          'a Windows path holds a colon, the list’s delimiter on a Mac and Linux'
      },
      () =>
        onPlatform(platform, async () => {
          const h = mkdtempSync(join(tmpdir(), 'oddboro-owner-'));
          const elsewhere = mkdtempSync(join(tmpdir(), 'oddboro-claude-'));
          try {
            await withEnv({ HOME: h, USERPROFILE: h }, async () => {
              mkdirSync(join(h, '.claude'));
              // Nothing to suggest is an empty list, so Setup shows no heading.
              assert.deepEqual((await list()).suggested, []);

              // `~/.claude` and a link to it are always listed, never suggested.
              marked(join(h, '.claude'));
              symlinkSync(join(h, '.claude'), join(h, '.claude-home'), 'junction');
              marked(join(h, '.claude-work'));
              marked(join(h, '.Claude-Caps'));
              // A link counts by its own name, as a typed path is kept.
              const target = join(elsewhere, 'linked');
              marked(target);
              symlinkSync(target, join(h, '.claude-linked'), 'junction');
              // Not suggested: a folder missing a mark, a project's settings
              // below the home's top level, a file, and a name not starting `.claude`.
              for (const m of L.CLAUDE_ACCOUNT_MARKS) marked(join(h, `.claude-only-${m}`), [m]);
              marked(join(h, 'code', 'shop', '.claude'));
              writeFileSync(join(h, '.claude-file'), 'not a folder');
              marked(join(h, 'claude-work'));

              const all = ['~/.Claude-Caps', '~/.claude-linked', '~/.claude-work'];
              assert.deepEqual((await list()).suggested, all);

              // A suggestion is added as typing it is: stored by the path `~` gives.
              const work = join(h, '.claude-work');
              assert.deepEqual((await put({ add: '~/.claude-work' })).suggested, [
                '~/.Claude-Caps',
                '~/.claude-linked'
              ]);
              assert.equal(stored(), work);
              assert.deepEqual((await put({ remove: work })).suggested, all);

              const link = join(h, '.claude-linked');
              assert.deepEqual((await put({ add: '~/.claude-linked' })).suggested, [
                '~/.Claude-Caps',
                '~/.claude-work'
              ]);
              assert.equal(stored(), link);
              await put({ remove: link });
              // The link's folder named by its real path is the same folder.
              const real = realpathSync.native(target);
              assert.deepEqual((await put({ add: real })).suggested, [
                '~/.Claude-Caps',
                '~/.claude-work'
              ]);
              await put({ remove: real });
              assert.equal(stored(), undefined);
            });
          } finally {
            L.setClaudeFolders([]);
            rmSync(h, { recursive: true, force: true });
            rmSync(elsewhere, { recursive: true, force: true });
          }
        })
    );
});
