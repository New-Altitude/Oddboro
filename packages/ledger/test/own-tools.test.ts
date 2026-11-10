// Run commands, Browse the web and folders the owner gives an Odd: which tool
// follows the switch and which is offered in its place, what each owner change
// records, and which folders are refused at the door. Run with
// `npm test -w @oddboro/ledger`.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';
import { AGENTS, COMMANDS_WHY, commandsHow, type Agent } from '../src/agents.ts';
import { staff } from '../src/schema.ts';
import { db, sql } from './pglite.ts';

// A home of the test's own, with the office's home and code inside it, set
// before office.ts loads: home.ts fixes both at import.
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'own-tools-')));
// Windows ignores HOME and reads USERPROFILE.
process.env.HOME = process.env.USERPROFILE = HOME;
process.env.ODDBORO_HOME = join(HOME, '.oddboro');
process.env.ODDBORO_CODE = join(HOME, 'code', 'oddboro');
process.env.OLLAMA_URL = 'http://127.0.0.1:9';
after(() => rmSync(HOME, { recursive: true, force: true }));
const O = await import('../src/office.ts');

/** Makes a folder under the test's home, and gives back its path. */
function folder(...parts: string[]): string {
  const p = join(HOME, ...parts);
  mkdirSync(p, { recursive: true });
  return p;
}

// Every await comes before the first test: the database closes once the tests end.
await db.insert(staff).values({
  id: 'ziva',
  name: 'Ziva',
  role: 'r',
  variant: 'v',
  portrait: 'p',
  remit: 'r',
  desk: 'd'
});

beforeEach(async () => {
  await sql`delete from ledger`;
});

test('commandsHow per tool and system', () => {
  const want: Record<Agent, Record<'darwin' | 'linux' | 'win32', string>> = {
    claude: { darwin: 'switch', linux: 'never', win32: 'never' },
    codex: { darwin: 'switch', linux: 'switch', win32: 'never' },
    grok: { darwin: 'never', linux: 'never', win32: 'never' },
    gemini: { darwin: 'never', linux: 'never', win32: 'never' }
  };
  // Under a switch locked off, the tool that follows it on that system: Claude
  // Code on a Mac, Codex on Linux, and none on Windows.
  const offers: Record<'darwin' | 'linux' | 'win32', Agent | undefined> = {
    darwin: 'claude',
    linux: 'codex',
    win32: undefined
  };
  for (const agent of AGENTS)
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      const how = commandsHow(agent, platform);
      assert.equal(how.state, want[agent][platform], `${agent} on ${platform}`);
      assert.equal(
        'why' in how ? how.why : undefined,
        how.state === 'switch' ? undefined : COMMANDS_WHY[agent]
      );
      // Only a switch locked off offers another tool.
      assert.equal(
        'offer' in how ? how.offer : undefined,
        how.state === 'never' ? offers[platform] : undefined,
        `${agent} on ${platform}`
      );
    }
  assert.deepEqual(COMMANDS_WHY, {
    claude: 'Not tested on this system yet.',
    codex: 'Not safe on Windows yet: Codex cannot keep commands in this Odd’s folders here.',
    grok: "Not with Grok yet: its sandbox can't keep commands off the internet on every system.",
    gemini: 'Not tested with Gemini yet.'
  });
});

const titles = async () =>
  (await sql<{ title: string }>`select title from ledger order by id`).map((r) => r.title);

/** `fn`, run as if the office ran on `platform`. */
async function onPlatform(platform: NodeJS.Platform, fn: () => Promise<void>): Promise<void> {
  const real = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    await fn();
  } finally {
    if (real) Object.defineProperty(process, 'platform', real);
  }
}

test("a switch or a move that opens or closes commands' internet says so in its Ledger line", async () => {
  const odd = (id: string, o: { agent: Agent; commands: boolean; web: boolean }) => ({
    id,
    name: id,
    role: 'r',
    variant: 'v',
    portrait: 'p',
    remit: 'r',
    desk: 'd',
    ...o
  });
  await db
    .insert(staff)
    .values([
      odd('Nell', { agent: 'claude', commands: true, web: false }),
      odd('Otis', { agent: 'claude', commands: false, web: false }),
      odd('Gale', { agent: 'grok', commands: true, web: true }),
      odd('Wren', { agent: 'claude', commands: false, web: true }),
      odd('Cass', { agent: 'codex', commands: false, web: false }),
      odd('Hale', { agent: 'grok', commands: false, web: true })
    ]);
  await onPlatform('darwin', async () => {
    await O.setOwnTool('Nell', 'web', true);
    await O.setOwnTool('Nell', 'web', false);
    await O.setOwnTool('Otis', 'web', true);
    await O.setAgent('Gale', 'claude');
    // Run commands, with Browse the web already on, opens the internet too.
    await O.setOwnTool('Wren', 'commands', true);
    await O.setOwnTool('Wren', 'commands', false);
    // Codex's commands stay off the internet, so neither its web nor a move to it opens it.
    await O.setOwnTool('Cass', 'web', true);
    await O.setAgent('Hale', 'codex');
  });
  const lines = await sql<{ title: string; body: string }>`
    select title, body from ledger order by id`;
  assert.deepEqual(
    lines.map((l) => [l.title, l.body]),
    [
      ['Let Nell browse the web', O.NETWORK_NOTE.on],
      ['Stopped Nell browsing the web', O.NETWORK_NOTE.off],
      ['Let Otis browse the web', ''],
      ['Moved Gale from Grok to Claude Code', O.NETWORK_NOTE.on],
      ['Let Wren run commands', O.NETWORK_NOTE.on],
      ['Stopped Wren running commands', O.NETWORK_NOTE.off],
      ['Let Cass browse the web', ''],
      ['Moved Hale from Grok to Codex', '']
    ]
  );
  assert.deepEqual(O.NETWORK_NOTE, {
    on: 'Its commands can reach the internet now.',
    off: 'Its commands are off the internet now.',
    held: 'This version of Claude Code refuses to let commands reach the whole internet. Commands keep working, with no network. Restarting the office lifts this.'
  });
});

test("while the office holds the network, a change that would open a Claude Code Odd's commands to the internet says the hold's words", async () => {
  const odd = (id: string, agent: Agent, web: boolean) => ({
    id,
    name: id,
    role: 'r',
    variant: 'v',
    portrait: 'p',
    remit: 'r',
    desk: 'd',
    agent,
    commands: true,
    web
  });
  await db.insert(staff).values([odd('Ivy', 'claude', false), odd('Jude', 'codex', true)]);
  await onPlatform('darwin', async () => {
    await O.holdNetwork();
    try {
      await O.setOwnTool('Ivy', 'web', true);
      await O.setAgent('Jude', 'claude');
      await O.setOwnTool('Ivy', 'web', false);
    } finally {
      O.resetHeldNetwork();
    }
  });
  const lines = await sql<{ title: string; body: string }>`
    select title, body from ledger order by id`;
  assert.deepEqual(
    lines.map((l) => [l.title, l.body]),
    [
      ["Kept Odds' commands off the internet", O.NETWORK_NOTE.held],
      ['Let Ivy browse the web', O.NETWORK_NOTE.held],
      ['Moved Jude from Codex to Claude Code', O.NETWORK_NOTE.held],
      ['Stopped Ivy browsing the web', O.NETWORK_NOTE.off]
    ]
  );
});

test('setOwnTool and setFolder record one line each', async () => {
  await O.setOwnTool('ziva', 'commands', true);
  await O.setOwnTool('ziva', 'commands', true);
  await O.setOwnTool('ziva', 'commands', false);
  await O.setOwnTool('ziva', 'web', true);
  await O.setOwnTool('ziva', 'web', true);
  await O.setOwnTool('ziva', 'web', false);
  const game = folder('Documents', 'GitHub', 'my-game');
  const shownGame = join('~', 'Documents', 'GitHub', 'my-game');
  await O.setFolder('ziva', game, 'read');
  await O.setFolder('ziva', game, 'read');
  await O.setFolder('ziva', game, 'write');
  assert.deepEqual((await O.staffer('ziva'))?.folders, [{ path: game, write: true }]);
  await O.setFolder('ziva', game, null);
  await O.setFolder('ziva', game, null);
  assert.deepEqual(await titles(), [
    'Let Ziva run commands',
    'Stopped Ziva running commands',
    'Let Ziva browse the web',
    'Stopped Ziva browsing the web',
    `Let Ziva read ${shownGame}`,
    `Let Ziva read and change ${shownGame}`,
    `Took ${shownGame} from Ziva`
  ]);
  const row = await O.staffer('ziva');
  assert.deepEqual([row?.commands, row?.web, row?.folders], [false, false, []]);
});

test('checkFolder refuses what holds keys, the home, the office and its code, and what holds the home', () => {
  const R = O.FOLDER_REFUSED;
  // The glob line names its character: the next test reads it.
  const { glob: _glob, ...fixed } = R;
  assert.deepEqual(fixed, {
    missing: 'No such folder.',
    home: 'Pick a folder inside your home, not the whole home.',
    secrets: 'That folder holds your keys or sign-ins.',
    code: "That folder holds Oddboro's own code.",
    nested: 'That folder is inside one this Odd already has, or holds one.',
    broad: 'That folder is a whole drive or holds system files. Ask for a narrower one.'
  });
  const refused = (path: string) => O.checkFolder(path);
  for (const s of O.SECRET_STORES) folder(s);
  folder('.ssh', 'keys');
  folder('.oddboro', 'staff');
  folder('code', 'oddboro', 'apps');
  writeFileSync(join(HOME, 'notes.txt'), 'x');

  assert.deepEqual(refused('~/nowhere'), { refused: R.missing });
  assert.deepEqual(refused('~/notes.txt'), { refused: R.missing });
  assert.deepEqual(refused('relative/path'), { refused: R.missing });
  assert.deepEqual(refused('~'), { refused: R.home });
  assert.deepEqual(refused(HOME), { refused: R.home });
  // A folder holding the home holds its secret stores, whether they exist or not.
  assert.deepEqual(refused(tmpdir()), { refused: R.secrets });
  for (const s of O.SECRET_STORES) assert.deepEqual(refused(`~/${s}`), { refused: R.secrets }, s);
  assert.deepEqual(refused('~/.ssh/keys'), { refused: R.secrets });
  assert.deepEqual(refused('~/.oddboro/staff'), { refused: R.secrets });
  assert.deepEqual(refused('~/code'), { refused: R.code });
  assert.deepEqual(refused('~/code/oddboro/apps'), { refused: R.code });

  // A name that only starts like a secret store is not one.
  const sshx = folder('.sshx');
  assert.deepEqual(refused('~/.sshx'), { real: sshx });
  assert.deepEqual(refused(' ~/.sshx/ '), { real: sshx });
});

test('checkFolder refuses a folder whose real path holds a character Codex reads as a glob, naming it, and takes {, } and !', () => {
  const R = O.FOLDER_REFUSED;
  assert.equal(R.glob('['), "That folder's path has a character an Odd's tool can't take: [");
  folder('Photos [2024]');
  assert.deepEqual(O.checkFolder('~/Photos [2024]'), { refused: R.glob('[') });
  // Windows takes no * or ? in a name, so no such folder is there to give.
  if (process.platform !== 'win32') {
    folder('a*b', 'inner');
    assert.deepEqual(O.checkFolder('~/a*b/inner'), { refused: R.glob('*') });
    folder('q?x');
    assert.deepEqual(O.checkFolder('~/q?x'), { refused: R.glob('?') });
  }
  folder('a]b');
  assert.deepEqual(O.checkFolder('~/a]b'), { refused: R.glob(']') });
  const braces = folder('x{y}');
  assert.deepEqual(O.checkFolder('~/x{y}'), { real: braces });
  const bang = folder('i!j');
  assert.deepEqual(O.checkFolder('~/i!j'), { real: bang });
  // A typed path with no such character, whose real path has one.
  symlinkSync(folder('pics [old]'), join(HOME, 'pics'), 'junction');
  assert.deepEqual(O.checkFolder('~/pics'), { refused: R.glob('[') });
});

test('the secret stores are the ones the office keeps shut', () => {
  assert.deepEqual(O.SECRET_STORES, [
    '.ssh',
    '.aws',
    '.gnupg',
    '.config',
    'Library',
    'AppData',
    '.claude',
    '.claude.json',
    '.google_workspace_mcp',
    '.grok',
    '.codex',
    '.gemini'
  ]);
});

test(
  'on a Mac, checkFolder refuses a secret store or the office typed in another case',
  { skip: process.platform !== 'darwin' && "only a Mac's disk ignores case" },
  () => {
    folder('.ssh');
    folder('.claude');
    folder('.oddboro');
    folder('Library', 'Keychains');
    for (const typed of ['~/.SSH', '~/LIBRARY', '~/library/Keychains', '~/.CLAUDE', '~/.Oddboro'])
      assert.deepEqual(O.checkFolder(typed), { refused: O.FOLDER_REFUSED.secrets }, typed);
  }
);

test('checkFolder refuses a link into a secret store, and a folder holding where one leads', () => {
  folder('.ssh');
  symlinkSync(join(HOME, '.ssh'), join(HOME, 'x'), 'junction');
  assert.deepEqual(O.checkFolder('~/x'), { refused: O.FOLDER_REFUSED.secrets });
  // A secret store that is itself a link, as a dotfiles folder makes one.
  rmSync(join(HOME, '.gnupg'), { recursive: true, force: true });
  symlinkSync(folder('dots', 'gnupg'), join(HOME, '.gnupg'), 'junction');
  assert.deepEqual(O.checkFolder('~/dots'), { refused: O.FOLDER_REFUSED.secrets });
  // A folder that only holds a `.ssh` of its own is not a secret store.
  const project = folder('project');
  folder('project', '.ssh');
  assert.deepEqual(O.checkFolder('~/project'), { real: project });
});

/** A folder outside the test's home, made now, by its real path. */
function outside(...parts: string[]): string {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'outside-')));
  after(() => rmSync(top, { recursive: true, force: true }));
  const p = join(top, ...parts);
  mkdirSync(p, { recursive: true });
  return p;
}

test(
  'checkFolder gives a folder outside the home, warning first when it sits in system files',
  { skip: process.platform === 'win32' && "Windows' temp folder sits in the home's AppData" },
  () => {
    assert.equal(
      O.FOLDER_WARNING,
      "This folder is a whole drive or holds system files, so an Odd could reach everything inside it. We don't recommend giving it."
    );
    // The system's temp folder is in /private (a Mac) or /tmp (Linux): system files.
    const out = outside('projects', 'game');
    assert.deepEqual(O.checkFolder(out), { warning: O.FOLDER_WARNING });
    assert.deepEqual(O.checkFolder(out, true), { real: out });
    // A folder in the home never warns, wherever the home sits.
    const inHome = folder('Projects', 'game');
    assert.deepEqual(O.checkFolder(inHome), { real: inHome });
  }
);

test(
  'outside the home, checkFolder refuses a secret store by what it holds, in the folder, above it and one level down',
  { skip: process.platform === 'win32' && "Windows' temp folder sits in the home's AppData" },
  () => {
    const R = O.FOLDER_REFUSED;
    const keys = outside('keys');
    mkdirSync(join(keys, '.ssh'));
    assert.deepEqual(O.checkFolder(keys, true), { refused: R.secrets });
    assert.deepEqual(O.checkFolder(join(keys, '.ssh'), true), { refused: R.secrets });

    // A coding tool's home by its sign-in or history, at the top or above.
    const drive = outside('drive');
    mkdirSync(join(drive, '.codex', 'sessions'), { recursive: true });
    writeFileSync(join(drive, '.codex', 'auth.json'), '{}');
    assert.deepEqual(O.checkFolder(drive, true), { refused: R.secrets });
    assert.deepEqual(O.checkFolder(join(drive, '.codex', 'sessions'), true), {
      refused: R.secrets
    });
    const claude = outside('claude-home');
    mkdirSync(join(claude, '.claude'));
    writeFileSync(join(claude, '.claude', 'history.jsonl'), '');
    assert.deepEqual(O.checkFolder(claude, true), { refused: R.secrets });

    // A project's own .claude or .codex of settings is no store.
    const project = outside('project');
    mkdirSync(join(project, '.claude'));
    writeFileSync(join(project, '.claude', 'settings.json'), '{}');
    mkdirSync(join(project, '.codex'));
    writeFileSync(join(project, '.codex', 'config.toml'), '');
    assert.deepEqual(O.checkFolder(project, true), { real: project });

    // Deeper than one level is not looked at: the site's page says so.
    const deep = outside('deep');
    mkdirSync(join(deep, 'backup', '.ssh'), { recursive: true });
    assert.deepEqual(O.checkFolder(deep, true), { real: deep });
  }
);

test(
  'broadFolder is a whole drive or volume, or system files, and never a folder in the home',
  { skip: process.platform === 'win32' && 'the paths here are a Mac and Linux' },
  () => {
    for (const p of ['/', '/usr', '/usr/local/share', '/bin'])
      assert.equal(O.broadFolder(p), true, p);
    assert.equal(O.broadFolder('/Volumes/Data'), true);
    assert.equal(O.broadFolder('/mnt/d'), true);
    assert.equal(O.broadFolder('/media/ada/disk'), true);
    assert.equal(O.broadFolder('/run/media/ada/disk'), true);
    for (const p of ['/Volumes/Data/Projects', '/mnt/d/projects', '/opt/projects', '/srv/site'])
      assert.equal(O.broadFolder(p), false, p);
    assert.equal(O.broadFolder(folder('Projects')), false);
  }
);
