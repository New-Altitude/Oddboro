// Installing the office's coding tools and signing them in from the page
// (agent-sign-in.ts and routes/api/agents/[tool]), in an office under test
// (office-under-test.ts) whose stand-in `grok`, `codex` and `claude` play each
// sign-in and stand-in `npm` and `bash` each installer: what "Runs on" and
// the Other AI tools card hear of each tool, each tool's own installer run to
// its end, one at a time, a Grok installed only in xAI's install folder found
// without a restart, Grok's and Codex's browser sign-ins in the office's own
// homes, starting over and Cancel, Sign out that never runs a tool's own
// logout, Gemini's key, kept in the stand-in secret store once Google (stood
// in for) takes it, Claude Code's sign-in on the same runner, and the one
// action each row offers. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  L,
  OFFICE_GEMINI_KEY,
  agents,
  assertKeychainUntouched,
  awayFromHome,
  bin,
  chatOf,
  folder,
  installers,
  installs,
  onPlatform,
  secretReads,
  secrets
} from './office-under-test.ts';
import { onPath } from './on-path.ts';
import {
  offersOtherTools,
  offersSignOut,
  signInRows,
  toolAction,
  type ToolAction
} from '../ui/tool-action.ts';
import type { AgentTool } from '../../routes/api/agents/+server.ts';

const route = await import('../../routes/api/agents/[tool]/+server.ts');
const claudeRoute = await import('../../routes/api/setup/claude/+server.ts');
const { geminiKeyMissing, clearGeminiKey, setGeminiKey } = await import('./gemini.ts');

const GROK_HOME = join(folder, 'grok');
const CODEX_HOME = join(folder, 'codex');

/** One request to the sign-in route for `tool`, as the page sends it. */
function send(method: 'POST' | 'PUT' | 'DELETE', tool: string, body?: unknown) {
  const event = {
    params: { tool },
    request: new Request(`http://office/api/agents/${tool}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } as unknown as Parameters<typeof route.POST>[0];
  return route[method](event);
}
/** The tools "Runs on" and the card hear of, as on a Mac. */
async function listed(platform: NodeJS.Platform = 'darwin'): Promise<AgentTool[]> {
  return onPlatform(platform, async () => {
    const res = await agents.GET({} as Parameters<typeof agents.GET>[0]);
    return ((await res.json()) as { tools: AgentTool[] }).tools;
  });
}
const stateOf = async (id: string) => (await listed()).find((t) => t.id === id)?.signIn;

/** `check` once it gives a value, within 4 s. */
async function waitFor<T>(check: () => T | undefined, what: string): Promise<T> {
  const until = Date.now() + 4000;
  for (;;) {
    const v = check();
    if (v !== undefined) return v;
    if (Date.now() > until) assert.fail(`still waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Line = { line?: string; url?: string; done?: boolean; ok?: boolean };
/** A streamed sign-in: the lines so far, the sign-in page's address once printed, and every line once it ends. */
function follow(res: Response) {
  const seen: Line[] = [];
  assert.ok(res.body, 'the sign-in streams nothing');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const ended = (async () => {
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return seen;
      buf += value;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        seen.push(JSON.parse(buf.slice(0, i)) as Line);
        buf = buf.slice(i + 1);
      }
    }
  })();
  return {
    ended,
    url: () => waitFor(() => seen.find((l) => l.url)?.url, 'the sign-in page'),
    /** The last two lines once it ends: why, and how. */
    end: async () => (await ended).slice(-2)
  };
}
/** Start `tool`'s sign-in from the page, as on a Mac. */
const signIn = (tool: string) =>
  onPlatform('darwin', async () => follow(await send('POST', tool, { action: 'sign-in' })));
/** What the stand-in `login` of the tool in `home` was started with, last. */
const lastLogin = (home: string) =>
  JSON.parse(
    readFileSync(join(home, 'logins.jsonl'), 'utf8').trim().split('\n').at(-1) ?? '{}'
  ) as {
    args: string[];
    home: string;
    configFirst?: boolean;
  };
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
/** A route's refusal: its status and the words the owner reads. */
const refused = (status: number, message?: string) => (e: unknown) => {
  const r = e as { status?: number; body?: { message?: string } };
  return r.status === status && (message === undefined || r.body?.message === message);
};

/** Start `tool`'s install from the page, as on a Mac. */
const install = (tool: string) =>
  onPlatform('darwin', async () => follow(await send('POST', tool, { action: 'install' })));
/** Every installer the page ran so far, as its stand-in logged it: its name and arguments, and the names in its environment. */
const installRuns = (): { args: string[]; env: string[] }[] =>
  existsSync(installs)
    ? readFileSync(installs, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { args: string[]; env: string[] })
    : [];
/** Every installer the page ran so far, by its name and arguments. */
const installed = (): string[][] => installRuns().map((r) => r.args);
/** `fn` on a Mac with none of the tools on PATH, only the installers' stand-ins, and an empty home. */
async function withNoTools<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const path = process.env.PATH;
  process.env.PATH = `${installers}:${dirname(process.execPath)}:/usr/bin:/bin`;
  try {
    // The installers run here are the stand-ins, never the Mac's own.
    assert.equal(onPath('npm'), join(installers, 'npm'));
    assert.equal(onPath('bash'), join(installers, 'bash'));
    return await awayFromHome(fn);
  } finally {
    process.env.PATH = path;
  }
}
const toolIn = async (id: string) => (await listed()).find((t) => t.id === id);

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
  assert.equal(tools.find((t) => t.id === 'claude')?.signIn, undefined);
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
  const linux = await listed('linux');
  assert.deepEqual(
    linux.filter((t) => t.signIn),
    []
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
  assert.ok(!L.AGENT_PLATFORMS.gemini.includes('darwin'));
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
  const before = L.AGENT_PLATFORMS.gemini;
  L.AGENT_PLATFORMS.gemini = ['darwin'];
  try {
    assert.deepEqual(await stateOf('gemini'), {
      how: 'key',
      installing: false,
      signedIn: true
    });
  } finally {
    L.AGENT_PLATFORMS.gemini = before;
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
  const before = L.AGENT_PLATFORMS.gemini;
  L.AGENT_PLATFORMS.gemini = ['darwin'];
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
      "Gemini has no API key in this office. Add one on this Odd's Access tab, under Runs on."
    );
    await assert.rejects(
      onPlatform('darwin', () => send('POST', 'gemini', { action: 'sign-in' })),
      refused(400, 'Gemini takes an API key.')
    );
  } finally {
    await setGeminiKey(OFFICE_GEMINI_KEY);
    globalThis.fetch = fetch;
    L.AGENT_PLATFORMS.gemini = before;
  }
});

test("the keychain is read once however many times Gemini's state is asked, with a key or without", async () => {
  const before = L.AGENT_PLATFORMS.gemini;
  L.AGENT_PLATFORMS.gemini = ['darwin'];
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
    L.AGENT_PLATFORMS.gemini = before;
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

test('Other AI tools, on onboarding and in Setup, has a row for each tool this system offers but Claude Code, and none where Claude Code is the only one', async () => {
  const ids = async (platform: NodeJS.Platform) =>
    signInRows(await listed(platform)).map(({ tool, signIn }) => {
      assert.equal(signIn, tool.signIn);
      return tool.id;
    });
  assert.deepEqual(await ids('darwin'), ['grok', 'codex']);
  assert.deepEqual(await ids('linux'), []);
  // Gemini gets its row once its list names this system, with no other change.
  const before = L.AGENT_PLATFORMS.gemini;
  L.AGENT_PLATFORMS.gemini = ['darwin'];
  try {
    assert.deepEqual(await ids('darwin'), ['grok', 'codex', 'gemini']);
  } finally {
    L.AGENT_PLATFORMS.gemini = before;
  }
});

test('the Other AI tools card shows only where a tool can be signed in to', async () => {
  assert.equal(offersOtherTools(await listed('darwin')), true);
  // Linux offers Claude Code alone, which signs in on its own card.
  assert.deepEqual(
    (await listed('linux')).map((t) => t.id),
    ['claude']
  );
  assert.equal(offersOtherTools(await listed('linux')), false);
  assert.equal(offersOtherTools([]), false);
});

test('each tool state offers exactly one action, and a signed-in tool still offers Sign in again', () => {
  const tool = (installed: boolean, signIn?: AgentTool['signIn']): AgentTool => ({
    id: 'grok',
    name: 'Grok',
    installed,
    ...(signIn ? { signIn } : {})
  });
  const browser = { how: 'browser', installing: false } as const;
  const key = { how: 'key', installing: false } as const;
  const cases: [string, AgentTool | undefined, ToolAction][] = [
    ['a tool this computer does not offer', undefined, 'none'],
    [
      'Claude Code, signed in on its own card',
      { id: 'claude', name: 'Claude Code', installed: true },
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
    signIn: { how: 'browser', installing, signedIn: true }
  });
  assert.equal(offersSignOut(grok(true, false)), true);
  // The office under test's Codex home holds a sign-in file before Codex is there.
  assert.equal(offersSignOut(grok(false, false)), false);
  assert.equal(offersSignOut(grok(false, true)), false);
  assert.equal(offersSignOut(grok(true, true)), false);
});

test("Install runs each tool's own installer to its end, one at a time, with no Grok or xAI setting of the office's, and nothing else about that tool starts or stops while it runs", async () => {
  // Grok settings in the office's environment, which would send xAI's installer
  // elsewhere, and an xAI one, which no installer gets either.
  const officeSettings = ['GROK_BIN_DIR', 'GROK_DEPLOYMENT_KEY', 'XAI_API_KEY_FOR_TEST'];
  for (const k of officeSettings) process.env[k] = 'from-the-office';
  try {
    await withNoTools(async () => {
      const from = installed().length;
      const codex = await install('codex');
      await waitFor(() => installed()[from], 'the Codex installer');
      assert.deepEqual(installed()[from], ['npm', 'install', '-g', '@openai/codex']);
      const t = await toolIn('codex');
      assert.equal(t?.signIn?.installing, true);
      assert.equal(toolAction(t), 'installing');
      for (const [method, body] of [
        ['POST', { action: 'install' }],
        ['POST', { action: 'sign-in' }],
        ['POST', { action: 'sign-out' }],
        ['DELETE', undefined]
      ] as const)
        await assert.rejects(
          onPlatform('darwin', () => send(method, 'codex', body)),
          refused(409, 'Codex is still installing.'),
          `${method} ${JSON.stringify(body)}`
        );
      assert.ok(
        existsSync(join(CODEX_HOME, 'auth.json')),
        'a refused Sign out removed the sign-in'
      );
      // Another tool's install is its own: Grok's runs xAI's script as its usage line says.
      const grok = await install('grok');
      await waitFor(() => installed()[from + 1], 'the Grok installer');
      assert.deepEqual(installed()[from + 1], [
        'bash',
        '-c',
        'curl -fsSL https://x.ai/cli/install.sh | bash'
      ]);
      writeFileSync(join(folder, 'npm.go'), '');
      assert.deepEqual(await codex.end(), [{ line: 'Installing.' }, { done: true, ok: true }]);
      assert.equal((await toolIn('codex'))?.signIn?.installing, false);
      assert.equal((await toolIn('grok'))?.signIn?.installing, true);
      writeFileSync(join(folder, 'bash.go'), '');
      assert.deepEqual((await grok.ended).at(-1), { done: true, ok: true });
      assert.equal((await toolIn('grok'))?.signIn?.installing, false);
    });
  } finally {
    for (const k of officeSettings) delete process.env[k];
  }
  // Neither installer got them, while each got the office's PATH.
  for (const run of installRuns().slice(-2)) {
    assert.ok(run.env.includes('PATH'), run.args.join(' '));
    for (const k of officeSettings) assert.ok(!run.env.includes(k), `${run.args[0]} got ${k}`);
  }
});

test("an install that fails says the installer's last line and leaves the tool on Install", async () => {
  writeFileSync(join(folder, 'npm.fail'), '');
  try {
    await withNoTools(async () => {
      const codex = await install('codex');
      assert.deepEqual(await codex.end(), [
        { line: 'npm error: could not install' },
        { done: true, ok: false }
      ]);
      const t = await toolIn('codex');
      assert.equal(t?.installed, false);
      assert.equal(toolAction(t), 'install');
    });
  } finally {
    rmSync(join(folder, 'npm.fail'));
  }
});

test("a Grok installed from the page only into xAI's install folder is offered, signs in, renews and runs without restarting the office", async () => {
  await withNoTools(async (home) => {
    assert.equal((await toolIn('grok'))?.installed, false);
    const grok = await install('grok');
    // xAI's installer links grok in before it ends: still Installing, with nothing to press.
    const own = join(home, '.grok', 'bin', 'grok');
    mkdirSync(dirname(own), { recursive: true });
    copyFileSync(join(bin, 'grok'), own);
    chmodSync(own, 0o755);
    const during = await toolIn('grok');
    assert.equal(during?.installed, true);
    assert.equal(toolAction(during), 'installing');
    writeFileSync(join(folder, 'bash.go'), '');
    assert.deepEqual((await grok.ended).at(-1), { done: true, ok: true });
    assert.equal(toolAction(await toolIn('grok')), 'sign-in');
    // The sign-in starts the grok in that folder, since none is on PATH.
    const s = await signIn('grok');
    await s.url();
    assert.equal(lastLogin(GROK_HOME).home, GROK_HOME);
    await send('DELETE', 'grok');
    await s.ended;
    // So do the renewal before a run and the run itself.
    const signedIn = (inMs: number) =>
      JSON.stringify({
        'https://auth.x.ai::test': { expires_at: new Date(Date.now() + inMs).toISOString() }
      });
    writeFileSync(join(GROK_HOME, 'auth.json'), signedIn(12 * 60_000));
    writeFileSync(join(GROK_HOME, 'renewed.json'), signedIn(6 * 60 * 60_000));
    try {
      const run = await chatOf('gus');
      assert.ok(existsSync(join(GROK_HOME, 'models-args.json')), 'the renewal did not run');
      assert.ok(
        run.args.some((a) => a.startsWith('--single=')),
        run.args.join(' ')
      );
    } finally {
      for (const f of ['auth.json', 'renewed.json', 'models.log', 'models-args.json'])
        rmSync(join(GROK_HOME, f), { force: true });
    }
  });
});

test("a file in xAI's install folder that cannot run is not an installed Grok", async () => {
  await withNoTools(async (home) => {
    const own = join(home, '.grok', 'bin', 'grok');
    mkdirSync(dirname(own), { recursive: true });
    copyFileSync(join(bin, 'grok'), own);
    chmodSync(own, 0o644);
    const t = await toolIn('grok');
    assert.equal(t?.installed, false);
    assert.equal(toolAction(t), 'install');
  });
});

test('a sign-in for a tool the office cannot find says to install it, never a spawn error', async () => {
  await withNoTools(async () => {
    await assert.rejects(
      onPlatform('darwin', () => send('POST', 'grok', { action: 'sign-in' })),
      refused(400, 'Grok is not on this Mac. Install it first.')
    );
    assert.equal((await toolIn('grok'))?.signIn?.waiting, undefined, 'a sign-in started');
  });
});

test('Gemini cannot be installed while its list does not name this system', async () => {
  assert.ok(!L.AGENT_PLATFORMS.gemini.includes('darwin'));
  const from = installed().length;
  await assert.rejects(
    onPlatform('darwin', () => send('POST', 'gemini', { action: 'install' })),
    refused(404)
  );
  assert.equal(installed().length, from, 'an installer ran');
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
