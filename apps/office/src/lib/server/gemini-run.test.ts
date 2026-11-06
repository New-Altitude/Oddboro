// A Gemini Odd's run as the office starts it, in an office under test
// (office-under-test.ts) with a stand-in `gemini` first on PATH: its
// arguments and environment, the run folder with its policy, settings and
// instructions, the policy's write rules on a thread and on the owner's edit,
// a message that starts with "/", its own process group, how its stream
// reaches the floor and the usage records, a missing key, and that "Runs on"
// offers Gemini nowhere until its live test. What the policy allows is proved against Gemini's own engine
// in gemini-policy.test.ts. Run with `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  L,
  OFFICE_GEMINI_KEY,
  PATCH,
  agents,
  chat,
  chatOf,
  folder,
  gave,
  odd,
  assertKeychainUntouched,
  ownerData,
  plain,
  runOf
} from './office-under-test.ts';

// After the office under test set its home and secret store, so the launch reads those.
const { LAUNCHES } = await import('./cli.ts');
const { clearGeminiKey, setGeminiKey } = await import('./gemini.ts');

await L.pg`insert into staff ${L.pg([
  { ...odd('gemma', 'Gemma'), agent: 'gemini' },
  { ...odd('gina', 'Gina'), agent: 'gemini' }
])}`;

const GEMINI_HOME = join(folder, 'gemini');
const RUNS = join(GEMINI_HOME, 'runs');
/** One chat message's error, for a run that never replies. */
async function chatError(id: string, message = 'Hello.'): Promise<string> {
  let error = '';
  await chat(id, message, (e) => {
    if (e.type === 'error') error = e.message;
  });
  return error;
}
/** A new chat session for `id`, as if it never chatted. */
const forget = (id: string) => rmSync(L.chatSession(id), { force: true });
/**
 * Whether a rule of a run's policy with `decision` matches a write to `path`,
 * as Gemini matches it: the arguments as JSON, each pair between NULs. Each
 * value the office writes is a JSON string, one key a line.
 */
function writeRule(policy: string, decision: 'allow' | 'deny', path: string): boolean {
  const args = `{\0"content":"x"\0,\0"file_path":${JSON.stringify(path)}\0}`;
  return policy
    .split('[[rule]]\n')
    .filter(Boolean)
    .map(
      (block) =>
        Object.fromEntries(
          block
            .trim()
            .split('\n')
            .map((l) => [l.slice(0, l.indexOf(' = ')), JSON.parse(l.slice(l.indexOf(' = ') + 3))])
        ) as Record<string, unknown>
    )
    .some(
      (r) =>
        r.decision === decision &&
        typeof r.argsPattern === 'string' &&
        new RegExp(r.argsPattern).test(args)
    );
}

test("a Gemini Odd's first chat starts gemini with stream-json, the run's own policy and the owner's data folder to read, its message on stdin", async () => {
  forget('gemma');
  const run = await chatOf('gemma');
  assert.deepEqual(plain(run.args), [
    '-o',
    'stream-json',
    '--policy',
    '<home>/gemini/runs/<id>/policy.toml',
    '--include-directories',
    '<home>/data'
  ]);
  assert.match(run.system, /You are Gemma\./);
  assert.ok(run.message.endsWith('Hello.'), run.message);
});

test("a Gemini run signs in with the office's key alone, in the office's Gemini home, and gets no Gemini or Google variable, Anthropic key or node options of the office's own", async () => {
  const run = await chatOf('gemma');
  const dir = join(RUNS, run.env.RUN_KEY);
  assert.deepEqual(run.geminiEnv, {
    GEMINI_API_KEY: 'the-office-key-for-tests-01',
    GEMINI_CLI_HOME: GEMINI_HOME,
    GEMINI_CLI_TRUST_WORKSPACE: 'true',
    GEMINI_CLI_SYSTEM_SETTINGS_PATH: join(dir, 'settings.json'),
    GEMINI_SYSTEM_MD: join(dir, 'system.md')
  });
});

test("a Gemini run's settings pick the API key, skip every .env in its folder and above it, send no usage statistics and carry the office's MCP server, readable by the owner alone", async () => {
  const run = await chatOf('gemma');
  const { mcpServers, ...rest } = run.settings ?? {};
  assert.deepEqual(rest, {
    security: { auth: { selectedType: 'gemini-api-key' } },
    advanced: { ignoreLocalEnv: true },
    privacy: { usageStatisticsEnabled: false }
  });
  assert.deepEqual(Object.keys(mcpServers ?? {}), ['office']);
  assert.equal(run.settingsMode, 0o600);
  assert.equal(run.runMode, 0o700);
});

test("a Gemini run's folder goes when it ends, and one a run that died with the office left goes at the next run", async () => {
  await chatOf('gemma');
  assert.deepEqual(readdirSync(RUNS), []);
  mkdirSync(join(RUNS, 'died-with-the-office'));
  await chatOf('gemma');
  assert.deepEqual(readdirSync(RUNS), []);
});

test("a Gemini Odd's chat policy allows writes in its own folder only and refuses its instruction files there", async () => {
  const policy = (await chatOf('gemma')).policy ?? '';
  const own = join(folder, 'staff', 'gemma');
  assert.ok(writeRule(policy, 'allow', join(own, 'notes.md')));
  assert.ok(!writeRule(policy, 'allow', join(folder, 'staff', 'gina', 'notes.md')));
  assert.ok(!writeRule(policy, 'allow', join(ownerData, 'notes.md')));
  assert.ok(writeRule(policy, 'deny', join(own, 'GEMINI.md')));
});

test("a Gemini colleague's run on a thread reads the thread's folder and writes only its own part of it", async () => {
  const h = await gave('gemma', 'gina', { title: 'Gemini thread' });
  const run = await runOf(h.id);
  const thread = L.threadFolder(h.thread);
  const after = (flag: string) => run.args.flatMap((a, i) => (run.args[i - 1] === flag ? [a] : []));
  assert.deepEqual(after('--include-directories'), [ownerData, thread]);
  const policy = run.policy ?? '';
  assert.ok(writeRule(policy, 'allow', join(folder, 'staff', 'gina', 'notes.md')));
  assert.ok(writeRule(policy, 'allow', join(thread, 'gina', 'notes.md')));
  assert.ok(writeRule(policy, 'deny', join(thread, 'gina', '.gemini', 'settings.json')));
  assert.ok(!writeRule(policy, 'allow', join(thread, 'notes.md')));
  assert.ok(!writeRule(policy, 'allow', join(thread, 'gemma', 'notes.md')));
});

test("a Gemini run reading the owner's edit is refused a write to that file in any case", async () => {
  const dir = join(folder, 'staff', 'gina', 'notes');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plan.md'), 'The owner wrote this.');
  assert.ok(
    await L.learnFromEdit('gina', { path: 'notes/plan.md', before: 'Gina wrote this.' }, 'x')
  );
  const [f] = await L.pg<{ id: number }[]>`
    select id from follow_ups where staff_id = 'gina' and kind = 'edited' and outcome is null`;
  const policy = (await runOf(f.id)).policy ?? '';
  assert.ok(writeRule(policy, 'deny', join(dir, 'plan.md')));
  assert.ok(writeRule(policy, 'deny', join(dir, '..', 'NOTES', 'Plan.MD')));
  assert.ok(!writeRule(policy, 'deny', join(dir, 'plan.md.old')));
});

test('a Gemini run starts as a process group of its own, so its MCP servers stop with it', async () => {
  const dir = join(folder, 'staff', 'gemma');
  const launch = await LAUNCHES.gemini({
    key: 'own-group',
    staffId: 'gemma',
    dir,
    reads: [],
    writes: [dir],
    system: 'You are Gemma.',
    input: 'Hello.',
    servers: {},
    allowed: [],
    timeoutMs: 60_000
  });
  assert.ok('args' in launch, JSON.stringify(launch));
  launch.done();
  assert.equal(launch.ownGroup, true);
});

test('a message that starts with "/" reaches Gemini as words, never as one of its own commands', async () => {
  forget('gemma');
  const run = await chatOf('gemma', '/help me plan the week');
  assert.ok(run.message.endsWith('/help me plan the week'), run.message);
});

test("Gemini's file tools reach the floor by Claude Code's names and its MCP calls as mcp__server__tool, and the reply is the last message, its pieces joined", async () => {
  const run = await chatOf('gina');
  assert.deepEqual(run.tools, ['Read', 'mcp__office__raise_ask']);
  // chatOf parsed the reply whole, so its two pieces joined with nothing between them.
  assert.ok(!run.message.includes('Looking.'));
});

test("a Gemini run's tokens are recorded per model with cached tokens apart from the rest of its input", async () => {
  await chatOf('gina');
  let rows: Record<string, unknown>[] = [];
  for (let i = 0; i < 100 && !rows.length; i++) {
    rows = await L.pg`
      select model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
      from usage where staff_id = 'gina'`;
    if (!rows.length) await new Promise((r) => setTimeout(r, 20));
  }
  // The stand-in's result: 1000 in, 600 of them cached; 50 out.
  assert.deepEqual(rows[0], {
    model: 'gemini-test',
    input_tokens: 400,
    output_tokens: 50,
    cache_read_tokens: 600,
    cache_write_tokens: 0
  });
});

test("a Gemini Odd's next chat resumes the session its last one started", async () => {
  forget('gina');
  const first = await chatOf('gina');
  assert.ok(!first.args.includes('--resume'), 'a first chat resumed a session');
  const next = await chatOf('gina');
  assert.deepEqual(next.args.slice(-2), ['--resume', '0a0a0a0a-0000-4000-8000-00000000ce01']);
});

test('a Gemini Odd is told it has file tools only, each given the full path', async () => {
  const run = await chatOf('gemma');
  assert.match(
    run.system,
    /Your own tools work on files only: no shell and no web\. Give each file tool the file's full path\./
  );
});

test("a Gemini result that fails ends the run with Gemini's own words", async () => {
  assert.equal(await chatError('gemma', 'End in error'), 'Quota used up.');
});

test('with no Gemini key in the office, the run points to its Access tab to add one, and starts nothing; a key added there reaches the next run', async () => {
  const launches = () => readFileSync(join(GEMINI_HOME, 'launches.log'), 'utf8').length;
  const before = launches();
  // Google stood in for: it takes every key, since the key's trial is not under test here.
  const fetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}');
  try {
    clearGeminiKey();
    assert.equal(
      await chatError('gemma'),
      "Gemini has no API key in this office. Add one on this Odd's Access tab, under Runs on."
    );
    assert.equal(launches(), before, 'gemini started');
    assert.deepEqual(await setGeminiKey('added-later-key-for-tests-01'), { ok: true });
    assert.equal((await chatOf('gemma')).geminiEnv?.GEMINI_API_KEY, 'added-later-key-for-tests-01');
  } finally {
    await setGeminiKey(OFFICE_GEMINI_KEY);
    globalThis.fetch = fetch;
  }
});

/** The owner's PATCH of an Odd from its card. */
const patch = (id: string, body: unknown) =>
  PATCH({
    params: { id },
    request: new Request(`http://office/api/staff/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    })
  } as unknown as Parameters<typeof PATCH>[0]);
/** The ids "Runs on" lists here. */
const offered = async () =>
  (
    (await (await agents.GET({} as Parameters<typeof agents.GET>[0])).json()) as {
      tools: { id: string }[];
    }
  ).tools.map((t) => t.id);

test('"Runs on" offers Gemini on no system until its live test, and no Odd moves to it', async () => {
  assert.ok(!L.agentsOn(process.platform).includes('gemini'));
  assert.ok(!(await offered()).includes('gemini'));
  await assert.rejects(
    async () => patch('gemma', { agent: 'gemini' }),
    (e: unknown) => (e as { status?: number }).status === 400
  );
});

test('once its list names this system, "Runs on" offers Gemini and an Odd moves to it', async () => {
  const before = L.AGENT_PLATFORMS.gemini;
  L.AGENT_PLATFORMS.gemini = [process.platform];
  try {
    assert.ok(L.agentsOn(process.platform).includes('gemini'));
    assert.ok((await offered()).includes('gemini'));
    assert.equal((await patch('sam', { agent: 'gemini' })).status, 200);
    assert.equal((await L.staffer('sam'))?.agent, 'gemini');
  } finally {
    L.AGENT_PLATFORMS.gemini = before;
    await patch('sam', { agent: 'claude' });
  }
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
