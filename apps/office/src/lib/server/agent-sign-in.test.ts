// Signing in the office's coding tools from the page
// (agent-sign-in.ts and routes/api/agents/[tool]), in an office under test
// (office-under-test.ts) whose stand-in `grok`, `codex` and `claude` play each
// sign-in: what "Runs on" and setup's Your AI list hear of each tool on a Mac,
// Linux and Windows, the tool the office runs on and a hire that starts on it,
// Grok's and Codex's browser sign-ins in the office's own homes, starting over
// and Cancel, Sign out that never runs a tool's own
// logout, Gemini's key, kept in the stand-in secret store once Google (stood
// in for) takes it, Claude Code's sign-in on the same runner, and the one
// action each row offers. Installing each tool is in agent-install.test.ts.
// Run with `npm test -w @oddboro/office`.
import {
  GROK_HOME,
  CODEX_HOME,
  send,
  type Listing,
  listing,
  listed,
  waitFor,
  follow,
  signIn,
  lastLogin,
  refused
} from './agent-tools-under-test.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  L,
  OFFICE_GEMINI_KEY,
  agents,
  assertKeychainUntouched,
  chatOf,
  folder,
  onPlatform,
  secretReads,
  secrets
} from './office-under-test.ts';
import { offersSignOut, toolAction, type ToolAction } from '../ui/tool-action.ts';
import type { AgentTool } from '../../routes/api/agents/+server.ts';

const claudeRoute = await import('../../routes/api/setup/claude/+server.ts');
const { geminiKeyMissing, clearGeminiKey, setGeminiKey } = await import('./gemini.ts');
const { claudeSignIn } = await import('./agent-sign-in.ts');
const { vendorEnv } = await import('./launch.ts');

/** Pick the office's tool as the page does, on `platform`. */
const pickOffice = (office: unknown, platform: NodeJS.Platform = 'darwin') =>
  onPlatform(platform, () =>
    agents.PUT({
      request: new Request('http://office/api/agents', {
        method: 'PUT',
        body: JSON.stringify({ office })
      })
    } as unknown as Parameters<typeof agents.PUT>[0])
  );
const stateOf = async (id: string) => (await listed()).find((t) => t.id === id)?.signIn;

const loginPid = (home: string) => Number(readFileSync(join(home, 'login.pid'), 'utf8'));
/** Whether a process is gone. */
const gone = (pid: number) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
};
/** The sign-in the office's Codex home starts with under test: a file with no account in it. */
const codexAsBefore = () => writeFileSync(join(CODEX_HOME, 'auth.json'), '{}');
/** A sign-in in the office's Grok home for `email`, as `grok login` keeps one. */
function grokSignedInAs(email: string): void {
  mkdirSync(GROK_HOME, { recursive: true });
  writeFileSync(
    join(GROK_HOME, 'auth.json'),
    JSON.stringify({ 'https://auth.x.ai::test': { email, expires_at: '2099-01-01T00:00:00Z' } })
  );
}

test('the "Runs on" list says which tools the office is signed in to, with the account', async () => {
  const tools = await listed();
  assert.deepEqual(tools.find((t) => t.id === 'grok')?.signIn, {
    how: 'browser',
    installing: false,
    signedIn: false
  });
  assert.deepEqual(tools.find((t) => t.id === 'codex')?.signIn, {
    how: 'browser',
    installing: false,
    signedIn: true
  });
  // The office's own Claude Code folder, which nobody signed in under test.
  assert.deepEqual(tools.find((t) => t.id === 'claude')?.signIn, {
    how: 'browser',
    installing: false,
    signedIn: false
  });
  grokSignedInAs('owner@example.com');
  try {
    assert.deepEqual(await stateOf('grok'), {
      how: 'browser',
      installing: false,
      signedIn: true,
      account: 'owner@example.com'
    });
  } finally {
    rmSync(join(GROK_HOME, 'auth.json'), { force: true });
  }
  // Linux offers Claude Code, Grok and Codex, so their sign-ins show there.
  const linux = await listed('linux');
  assert.deepEqual(
    linux.filter((t) => t.signIn).map((t) => t.id),
    ['claude', 'grok', 'codex']
  );
});

test("signing in to Grok from the page runs its browser sign-in in the office's Grok home, hands the page its sign-in address, and the list says signed in once it finishes", async () => {
  try {
    const s = await signIn('grok');
    const url = await s.url();
    assert.match(url, /^https:\/\/auth\.x\.ai\//);
    assert.deepEqual(await stateOf('grok'), {
      how: 'browser',
      installing: false,
      signedIn: false,
      waiting: { url }
    });
    assert.deepEqual(lastLogin(GROK_HOME), {
      args: ['login', '--oauth', '--leader-socket', join(GROK_HOME, 'leader.sock')],
      home: GROK_HOME
    });
    writeFileSync(join(GROK_HOME, 'login.go'), '');
    assert.deepEqual((await s.ended).at(-1), { done: true, ok: true });
    assert.deepEqual(await stateOf('grok'), {
      how: 'browser',
      installing: false,
      signedIn: true,
      account: 'owner@example.com'
    });
  } finally {
    rmSync(join(GROK_HOME, 'auth.json'), { force: true });
  }
});

test("signing in to Codex keeps the sign-in as a file in the office's Codex home and shows the account from it", async () => {
  rmSync(join(CODEX_HOME, 'auth.json'));
  // The sign-in writes the home's config first, or Codex would keep its sign-in in the keychain.
  rmSync(join(CODEX_HOME, 'config.toml'), { force: true });
  try {
    const s = await signIn('codex');
    const url = await s.url();
    // Its own callback server on http://localhost comes first, and is not the page.
    assert.match(url, /^https:\/\/auth\.openai\.com\//);
    const login = lastLogin(CODEX_HOME);
    assert.equal(login.home, CODEX_HOME);
    assert.ok(login.configFirst, 'the sign-in started before the home had its config.toml');
    const store = login.args.indexOf('cli_auth_credentials_store="file"');
    assert.ok(store > 0 && login.args[store - 1] === '-c', login.args.join(' '));
    writeFileSync(join(CODEX_HOME, 'login.go'), '');
    assert.deepEqual((await s.ended).at(-1), { done: true, ok: true });
    assert.deepEqual(await stateOf('codex'), {
      how: 'browser',
      installing: false,
      signedIn: true,
      account: 'owner@example.com'
    });
  } finally {
    codexAsBefore();
  }
});

test('a second sign-in starts the first over, and Cancel stops a waiting one and its command', async () => {
  const first = await signIn('grok');
  await first.url();
  const firstPid = loginPid(GROK_HOME);
  const second = await signIn('grok');
  assert.deepEqual(await first.end(), [{ line: 'Started over.' }, { done: true, ok: false }]);
  await second.url();
  const secondPid = loginPid(GROK_HOME);
  assert.notEqual(secondPid, firstPid);
  assert.deepEqual(await (await send('DELETE', 'grok')).json(), { stopped: true });
  assert.deepEqual(await second.end(), [{ line: 'Cancelled.' }, { done: true, ok: false }]);
  for (const pid of [firstPid, secondPid])
    await waitFor(() => gone(pid) || undefined, `sign-in ${pid} to stop`);
  assert.deepEqual(await (await send('DELETE', 'grok')).json(), { stopped: false });
  assert.equal((await stateOf('grok'))?.waiting, undefined);
});

test("signing out removes only the office home's sign-in and never runs a tool's own logout", async () => {
  grokSignedInAs('owner@example.com');
  try {
    for (const [tool, home] of [
      ['grok', GROK_HOME],
      ['codex', CODEX_HOME]
    ] as const) {
      assert.ok(existsSync(join(home, 'auth.json')), `${tool} starts signed in`);
      const res = await onPlatform('darwin', () => send('POST', tool, { action: 'sign-out' }));
      assert.equal(((await res.json()) as { signedIn: boolean }).signedIn, false, tool);
      assert.equal((await stateOf(tool))?.signedIn, false, tool);
      assert.ok(!existsSync(join(home, 'auth.json')), `${tool}'s sign-in is still there`);
      assert.ok(!existsSync(join(home, 'logouts.log')), `${tool}'s own logout ran`);
    }
    // A sign-in still waiting stops first.
    const waiting = await signIn('grok');
    await waiting.url();
    await onPlatform('darwin', () => send('POST', 'grok', { action: 'sign-out' }));
    assert.deepEqual(await waiting.end(), [{ line: 'Signed out.' }, { done: true, ok: false }]);
    assert.ok(!existsSync(join(GROK_HOME, 'logouts.log')), "grok's own logout ran");
  } finally {
    rmSync(join(GROK_HOME, 'auth.json'), { force: true });
    codexAsBefore();
  }
});

test('Gemini stays off the list and its sign-in until its list names this system, then shows with no other change', async () => {
  assert.ok(!L.AGENT_PLATFORMS.gemini.runs.includes('darwin'));
  assert.equal(
    (await listed()).find((t) => t.id === 'gemini'),
    undefined
  );
  await assert.rejects(
    onPlatform('darwin', () => send('POST', 'gemini', { action: 'sign-out' })),
    refused(404)
  );
  await assert.rejects(
    onPlatform('darwin', () => send('PUT', 'gemini', { key: OFFICE_GEMINI_KEY })),
    refused(404)
  );
  const before = L.AGENT_PLATFORMS.gemini.runs;
  L.AGENT_PLATFORMS.gemini.runs = ['darwin'];
  try {
    assert.deepEqual(await stateOf('gemini'), {
      how: 'key',
      installing: false,
      signedIn: true
    });
  } finally {
    L.AGENT_PLATFORMS.gemini.runs = before;
  }
});

test('a Gemini key from the page is tried once with Google, then kept in the keychain for the next run; a key that fails is not kept', async () => {
  const GOOD = 'good-gemini-key-for-tests-0001';
  const asked: { url: string; key: string | null }[] = [];
  let down = false;
  const fetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    asked.push({ url: String(url), key: new Headers(init?.headers).get('x-goog-api-key') });
    if (down) throw new TypeError('fetch failed');
    return new Response('{}', {
      status: [GOOD, OFFICE_GEMINI_KEY].includes(asked.at(-1)?.key ?? '') ? 200 : 403
    });
  };
  const before = L.AGENT_PLATFORMS.gemini.runs;
  L.AGENT_PLATFORMS.gemini.runs = ['darwin'];
  const put = (key: string) => onPlatform('darwin', () => send('PUT', 'gemini', { key }));
  try {
    await assert.rejects(
      put('has a space'),
      refused(400, 'That does not look like a Gemini API key.')
    );
    assert.equal(asked.length, 0, 'a key of the wrong shape went to Google');
    await assert.rejects(
      put('bad-gemini-key-for-tests-0001'),
      refused(400, 'That key did not work. Check it in Google AI Studio.')
    );
    assert.equal(secrets.get('gemini:API_KEY'), OFFICE_GEMINI_KEY);
    down = true;
    await assert.rejects(
      put(GOOD),
      refused(
        400,
        'The office could not reach Google to try the key. Check the connection, then try again.'
      )
    );
    assert.equal(secrets.get('gemini:API_KEY'), OFFICE_GEMINI_KEY);
    down = false;
    const kept = await put(` ${GOOD}\n`);
    assert.equal(((await kept.json()) as { signedIn: boolean }).signedIn, true);
    assert.equal(secrets.get('gemini:API_KEY'), GOOD);
    assert.ok(asked.at(-1)?.url.startsWith('https://generativelanguage.googleapis.com/'));
    assert.equal(asked.at(-1)?.key, GOOD);
    await onPlatform('darwin', () => send('POST', 'gemini', { action: 'sign-out' }));
    assert.ok(!secrets.has('gemini:API_KEY'), "Gemini's key is still in the keychain");
    assert.equal((await stateOf('gemini'))?.signedIn, false);
    assert.equal(
      geminiKeyMissing(),
      "Gemini has no API key in this office. Add one on this Odd's Settings tab, under Model."
    );
    await assert.rejects(
      onPlatform('darwin', () => send('POST', 'gemini', { action: 'sign-in' })),
      refused(400, 'Gemini takes an API key.')
    );
  } finally {
    await setGeminiKey(OFFICE_GEMINI_KEY);
    globalThis.fetch = fetch;
    L.AGENT_PLATFORMS.gemini.runs = before;
  }
});

test("the keychain is read once however many times Gemini's state is asked, with a key or without", async () => {
  const before = L.AGENT_PLATFORMS.gemini.runs;
  L.AGENT_PLATFORMS.gemini.runs = ['darwin'];
  const reads = () => secretReads.filter((n) => n === 'gemini:API_KEY').length;
  /** Reads of the key across three loads of the list and one run's check, from cold. */
  const readsFromCold = async (signedIn: boolean) => {
    const from = reads();
    for (let i = 0; i < 3; i++) assert.equal((await stateOf('gemini'))?.signedIn, signedIn);
    assert.equal(geminiKeyMissing() === undefined, signedIn);
    return reads() - from;
  };
  try {
    // Cold, as after a restart: Sign out asks the keychain again next time.
    clearGeminiKey();
    assert.equal(await readsFromCold(false), 1);
    clearGeminiKey();
    secrets.set('gemini:API_KEY', OFFICE_GEMINI_KEY);
    assert.equal(await readsFromCold(true), 1);
  } finally {
    L.AGENT_PLATFORMS.gemini.runs = before;
    secrets.set('gemini:API_KEY', OFFICE_GEMINI_KEY);
  }
});

test("Claude Code's sign-in from Setup still streams through the same runner, says it is waiting, and can be cancelled", async () => {
  const s = follow(
    await claudeRoute.POST({
      request: new Request('http://office/api/setup/claude', {
        method: 'POST',
        body: JSON.stringify({ action: 'sign-in' })
      })
    } as unknown as Parameters<typeof claudeRoute.POST>[0])
  );
  assert.match(await s.url(), /^https:\/\/claude\.ai\//);
  const settings = await claudeRoute.GET({} as Parameters<typeof claudeRoute.GET>[0]);
  assert.equal(((await settings.json()) as { signingIn: boolean }).signingIn, true);
  const stopped = await claudeRoute.DELETE({} as Parameters<typeof claudeRoute.DELETE>[0]);
  assert.deepEqual(await stopped.json(), { stopped: true });
  assert.deepEqual(await s.end(), [{ line: 'Cancelled.' }, { done: true, ok: false }]);
});

test("every grok the office starts outside a run names the office's own leader socket, and a run names none", async () => {
  const leader = ['--leader-socket', join(GROK_HOME, 'leader.sock')];
  const s = await signIn('grok');
  await s.url();
  assert.deepEqual(lastLogin(GROK_HOME).args.slice(-2), leader);
  await send('DELETE', 'grok');
  await s.ended;
  // A sign-in that could run out within a chat's time is renewed first, outside the sandbox.
  const signedIn = (inMs: number) =>
    JSON.stringify({
      'https://auth.x.ai::test': { expires_at: new Date(Date.now() + inMs).toISOString() }
    });
  writeFileSync(join(GROK_HOME, 'auth.json'), signedIn(12 * 60_000));
  writeFileSync(join(GROK_HOME, 'renewed.json'), signedIn(6 * 60 * 60_000));
  try {
    const run = await chatOf('gus');
    assert.deepEqual(JSON.parse(readFileSync(join(GROK_HOME, 'models-args.json'), 'utf8')), [
      'models',
      ...leader
    ]);
    assert.ok(!run.args.includes('--leader-socket'), run.args.join(' '));
  } finally {
    for (const f of ['auth.json', 'renewed.json', 'models.log', 'models-args.json'])
      rmSync(join(GROK_HOME, f), { force: true });
  }
});

test('Your AI lists every tool once on a Mac, Linux and Windows: the ones this system offers to pick, the rest greyed with why', async () => {
  const ids = (l: Listing) => [...l.tools.map((t) => t.id), ...l.later.map((t) => t.id)].sort();
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const l = await listing(platform);
    assert.deepEqual(ids(l), [...L.AGENTS].sort(), platform);
    assert.equal(l.office, 'claude', platform);
  }
  const mac = await listing('darwin');
  assert.deepEqual(
    mac.tools.map((t) => t.id),
    ['claude', 'grok', 'codex']
  );
  assert.deepEqual(mac.later, [
    { id: 'gemini', name: 'Gemini', why: 'Coming soon. We are still testing it.' }
  ]);
  for (const platform of ['linux', 'win32'] as const) {
    const l = await listing(platform);
    assert.deepEqual(
      l.tools.map((t) => t.id),
      ['claude', 'grok', 'codex'],
      platform
    );
    assert.deepEqual(
      l.later.map((t) => [t.id, t.why]),
      [['gemini', 'Coming soon. We are still testing it.']],
      platform
    );
  }
  // A tool offered on a Mac alone is greyed elsewhere with why.
  const grokRuns = L.AGENT_PLATFORMS.grok.runs;
  L.AGENT_PLATFORMS.grok.runs = ['darwin'];
  try {
    const l = await listing('linux');
    assert.deepEqual(
      l.tools.map((t) => t.id),
      ['claude', 'codex']
    );
    assert.deepEqual(
      l.later.map((t) => [t.id, t.why]),
      [
        ['grok', 'Mac only for now.'],
        ['gemini', 'Coming soon. We are still testing it.']
      ]
    );
  } finally {
    L.AGENT_PLATFORMS.grok.runs = grokRuns;
  }
  // Gemini moves from greyed to offered once its list names this system, with no other change.
  const before = L.AGENT_PLATFORMS.gemini.runs;
  L.AGENT_PLATFORMS.gemini.runs = ['darwin'];
  try {
    const l = await listing('darwin');
    assert.deepEqual(
      l.tools.map((t) => t.id),
      ['claude', 'grok', 'codex', 'gemini']
    );
    assert.deepEqual(l.later, []);
  } finally {
    L.AGENT_PLATFORMS.gemini.runs = before;
  }
});

test('each listed tool says how it takes Run commands on that system, so the hire drawer names that switch only where the owner can move it', async () => {
  for (const platform of ['darwin', 'linux', 'win32'] as const) {
    const { tools } = await listing(platform);
    for (const t of tools)
      assert.deepEqual(t.commandsHow, L.commandsHow(t.id, platform), `${t.id} on ${platform}`);
  }
  const stateOn = async (id: string, platform: NodeJS.Platform) =>
    (await listed(platform)).find((t) => t.id === id)?.commandsHow.state;
  assert.equal(await stateOn('claude', 'darwin'), 'switch');
  assert.equal(await stateOn('claude', 'linux'), 'never');
  // Codex follows the switch on a Mac and Linux, and never on Windows.
  assert.equal(await stateOn('codex', 'darwin'), 'switch');
  assert.equal(await stateOn('codex', 'linux'), 'switch');
  assert.equal(await stateOn('codex', 'win32'), 'never');
});

test('the office runs on the tool picked at setup, only one this system offers, and a hire with no tool starts on it', async () => {
  const before = process.env.OFFICE_AGENT;
  const envFile = join(folder, 'none.env');
  const hadEnv = existsSync(envFile) ? readFileSync(envFile) : undefined;
  try {
    const picked = await pickOffice('grok');
    assert.deepEqual(await picked.json(), { office: 'grok' });
    assert.equal((await listing('darwin')).office, 'grok');
    assert.match(readFileSync(envFile, 'utf8'), /^OFFICE_AGENT=grok$/m);
    const hired = await L.hire({
      name: 'Ida',
      role: 'Tester',
      remit: 'Test work.',
      desk: 'You are Ida.',
      room: 'workspace',
      permission: 'draft',
      sprite: 'staff',
      variant: 'a',
      portrait: 'a'
    } as Parameters<typeof L.hire>[0]);
    assert.equal(hired.agent, 'grok');
    // Gemini is offered nowhere yet.
    for (const [office, platform] of [
      ['gemini', 'darwin'],
      ['gemini', 'linux'],
      ['gemini', 'win32'],
      ['nonsense', 'darwin']
    ] as const)
      await assert.rejects(pickOffice(office, platform), (e: { status?: number }) => {
        assert.equal(e.status, 400, `${office} on ${platform}`);
        return true;
      });
    assert.equal((await listing('linux')).office, 'grok');
    // An office moved to a system that does not offer its tool runs on Claude Code.
    const grokRuns = L.AGENT_PLATFORMS.grok.runs;
    L.AGENT_PLATFORMS.grok.runs = ['darwin'];
    try {
      assert.equal((await listing('linux')).office, 'claude');
    } finally {
      L.AGENT_PLATFORMS.grok.runs = grokRuns;
    }
  } finally {
    if (before === undefined) delete process.env.OFFICE_AGENT;
    else process.env.OFFICE_AGENT = before;
    if (hadEnv) writeFileSync(envFile, hadEnv);
    else rmSync(envFile, { force: true });
  }
});

test('each tool state offers exactly one action, and a signed-in tool still offers Sign in again', () => {
  const tool = (installed: boolean, signIn?: AgentTool['signIn']): AgentTool => ({
    id: 'grok',
    name: 'Grok',
    installed,
    commandsHow: L.commandsHow('grok', 'darwin'),
    ...(signIn ? { signIn } : {})
  });
  const browser = { how: 'browser', installing: false } as const;
  const key = { how: 'key', installing: false } as const;
  const cases: [string, AgentTool | undefined, ToolAction][] = [
    ['a tool this computer does not offer', undefined, 'none'],
    [
      'Claude Code, signed in on its own card',
      {
        id: 'claude',
        name: 'Claude Code',
        installed: true,
        commandsHow: L.commandsHow('claude', 'darwin')
      },
      'none'
    ],
    ['not installed', tool(false, { ...browser, signedIn: false }), 'install'],
    ['installing', tool(false, { ...browser, installing: true, signedIn: false }), 'installing'],
    [
      'installing once its command is there and a sign-in file reads as signed in',
      tool(true, { ...browser, installing: true, signedIn: true }),
      'installing'
    ],
    ['a key tool not installed', tool(false, { ...key, signedIn: false }), 'install'],
    ['signed out', tool(true, { ...browser, signedIn: false }), 'sign-in'],
    [
      'waiting on its page',
      tool(true, { ...browser, signedIn: false, waiting: { url: 'https://auth.x.ai/' } }),
      'cancel'
    ],
    [
      'waiting before its page shows',
      tool(true, { ...browser, signedIn: false, waiting: {} }),
      'cancel'
    ],
    [
      'signed in',
      tool(true, { ...browser, signedIn: true, account: 'owner@example.com' }),
      'sign-in-again'
    ],
    ['a key tool with no key', tool(true, { ...key, signedIn: false }), 'key'],
    ['a key tool with its key', tool(true, { ...key, signedIn: true }), 'key']
  ];
  for (const [state, t, action] of cases) assert.equal(toolAction(t), action, state);
});

test('Sign out shows only beside an installed tool signed in, and never while it installs', () => {
  const grok = (installed: boolean, installing: boolean): AgentTool => ({
    id: 'grok',
    name: 'Grok',
    installed,
    commandsHow: L.commandsHow('grok', 'darwin'),
    signIn: { how: 'browser', installing, signedIn: true }
  });
  assert.equal(offersSignOut(grok(true, false)), true);
  // The office under test's Codex home holds a sign-in file before Codex is there.
  assert.equal(offersSignOut(grok(false, false)), false);
  assert.equal(offersSignOut(grok(false, true)), false);
  assert.equal(offersSignOut(grok(true, true)), false);
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});

test("in the Linux app, a sign-in starts with the computer's own libraries, so it can open the browser", () => {
  const names = ['APPIMAGE', 'APPDIR', 'LD_LIBRARY_PATH', 'APPIMAGE_ORIGINAL_LD_LIBRARY_PATH'];
  const before = Object.fromEntries(names.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    APPIMAGE: '/opt/Oddboro.AppImage',
    APPDIR: '/tmp/.mount_Oddboro',
    LD_LIBRARY_PATH: '/tmp/.mount_Oddboro/usr/lib'
  });
  delete process.env.APPIMAGE_ORIGINAL_LD_LIBRARY_PATH;
  try {
    // Claude Code's sign-in, and every other tool's (vendorEnv), lose the AppImage's glib.
    assert.equal(claudeSignIn().env.LD_LIBRARY_PATH, undefined);
    assert.equal(vendorEnv(['CODEX_']).LD_LIBRARY_PATH, undefined);
    // A library path from before the app started comes back.
    process.env.APPIMAGE_ORIGINAL_LD_LIBRARY_PATH = '/opt/nvidia';
    assert.equal(claudeSignIn().env.LD_LIBRARY_PATH, '/opt/nvidia');
  } finally {
    for (const k of names)
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
  }
});
