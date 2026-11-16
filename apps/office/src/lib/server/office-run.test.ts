// An office run on Codex or Grok: the tool's own sandboxed launch and what it
// leaves behind. Run with `npm test -w @oddboro/office`.
import {
  GROK_HOME,
  send,
  type Listing,
  listing,
  waitFor,
  follow,
  installed,
  toolIn
} from './agent-tools-under-test.ts';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  L,
  assertKeychainUntouched,
  bin,
  chatOf,
  folder,
  nodeBin,
  onPlatform,
  withEnv
} from './office-under-test.ts';
import { toolAction } from '../ui/tool-action.ts';

test("an office run on Codex or Grok goes through the tool's own sandboxed launch with no MCP, no shell and no file tool, sends its pictures, and leaves nothing behind", async () => {
  const { runAsOffice } = await import('./office-run.ts');
  const picture = { mediaType: 'image/png', data: Buffer.from('a picture').toString('base64') };
  const ask = () =>
    runAsOffice('Draw a desk for {owner}.', {
      system: 'You draw for {owner}.',
      kind: 'look',
      timeoutMs: 60_000,
      effort: 'low',
      images: [picture]
    });
  const gaveOf = (text: string) =>
    JSON.parse(text.slice(0, text.lastIndexOf('\nOutcome:'))) as Record<string, unknown>;
  const runs = join(folder, 'office', 'runs');

  const codex = await withEnv({ OFFICE_AGENT: 'codex' }, ask);
  assert.ok(codex.ok, codex.text);
  const c = gaveOf(codex.text) as {
    args: string[];
    pictures: boolean[];
    servers: object;
    permissions: { network: { enabled: boolean } };
    message: string;
    system: string;
  };
  assert.deepEqual(c.pictures, [true]);
  assert.ok(c.args.includes('model_reasoning_effort="low"'), c.args.join(' '));
  assert.deepEqual(c.servers, {});
  // No shell: the pictures come with the message, and there is nothing else to read.
  assert.ok(c.args.includes('features.shell_tool=false'), c.args.join(' '));
  assert.ok(c.args.includes('features.unified_exec=false'), c.args.join(' '));
  assert.equal(c.permissions.network.enabled, false);
  assert.ok(!c.message.includes('{owner}') && c.message.startsWith('Draw a desk for '));
  assert.ok(!c.system.includes('{owner}'));
  assert.deepEqual(readdirSync(runs), []);

  const signedIn = { expires_at: new Date(Date.now() + 86_400_000).toISOString() };
  mkdirSync(GROK_HOME, { recursive: true });
  writeFileSync(
    join(GROK_HOME, 'auth.json'),
    JSON.stringify({ 'https://auth.x.ai::test': signedIn })
  );
  try {
    const grok = await withEnv({ OFFICE_AGENT: 'grok' }, ask);
    assert.ok(grok.ok, grok.text);
    const g = gaveOf(grok.text) as {
      args: string[];
      prompt: { type: string; data?: string; mimeType?: string; text?: string }[];
      env?: unknown;
    };
    // With a picture, the message goes as content blocks, in a .json file and never on the command line.
    const file = g.args[g.args.indexOf('--prompt-file') + 1];
    assert.ok(file.endsWith('.prompt.json'), file);
    assert.ok(
      !g.args.some((a) => a.includes(picture.data)),
      'the picture went on the command line'
    );
    // No file tool, never Grok's whole set, so it answers from the message, at the effort asked.
    // Grok has no "no tools", so todo_write, which touches no file, stands in.
    assert.equal(g.args[g.args.indexOf('--tools') + 1], 'todo_write');
    assert.ok(g.args.includes('--reasoning-effort=low'), g.args.join(' '));
    assert.deepEqual(g.prompt[0], { type: 'image', data: picture.data, mimeType: 'image/png' });
    assert.match(String(g.prompt[1].text), /^Draw a desk for /);
    assert.equal(g.env, undefined);
    assert.deepEqual(readdirSync(runs), []);
  } finally {
    rmSync(join(GROK_HOME, 'auth.json'), { force: true });
  }

  // A sign-in that ran out and cannot renew refuses the run, pointing to setup, not to an Odd's Settings tab.
  const ended = { expires_at: new Date(Date.now() - 60_000).toISOString() };
  writeFileSync(join(GROK_HOME, 'auth.json'), JSON.stringify({ 'https://auth.x.ai::test': ended }));
  try {
    const refused = await withEnv({ OFFICE_AGENT: 'grok' }, ask);
    assert.equal(refused.ok, false);
    assert.match(refused.text, /in Setup, under Your AI/);
    assert.deepEqual(readdirSync(runs), []);
  } finally {
    for (const f of ['auth.json', 'models.log', 'models-args.json'])
      rmSync(join(GROK_HOME, f), { force: true });
  }
});

test('versions compare by their numbers, so 1.0.9 is older than 1.0.62 and 2.1.318 is not older than itself', () => {
  assert.equal(L.olderThan('0.149.1', '0.166.0'), true);
  assert.equal(L.olderThan('1.0.9', '1.0.62'), true);
  assert.equal(L.olderThan('2.1.99', '2.1.318'), true);
  assert.equal(L.olderThan('2.1.318', '2.1.318'), false);
  assert.equal(L.olderThan('1.0.70', '1.0.62'), false);
  assert.equal(L.olderThan('1.0', '1.0.0'), false);
});

test('a tool older than the office runs shows Update, its runs are refused saying where to update, and Update runs its updater', async () => {
  const versions = join(folder, 'versions');
  mkdirSync(versions, { recursive: true });
  // The office reads a version again only when the tool's file changes, as an update changes it.
  const touch = () =>
    utimesSync(join(bin, 'codex'), new Date(), new Date(Date.now() + 1000 * Math.random()));
  writeFileSync(join(versions, 'codex'), '0.149.1');
  touch();
  try {
    const codex = await toolIn('codex');
    assert.equal(codex?.version, '0.149.1');
    assert.equal(codex?.tooOld, L.MIN_VERSIONS.codex);
    assert.equal(toolAction(codex), 'update');

    const { runAsOffice } = await import('./office-run.ts');
    const run = await withEnv({ OFFICE_AGENT: 'codex' }, () =>
      runAsOffice('Hello.', { system: 'Say hello.', kind: 'look', timeoutMs: 60_000 })
    );
    assert.deepEqual(run, {
      ok: false,
      text: 'Codex 0.149.1 is older than this office runs (0.166.0 or newer). Update it in Setup, under Your AI.'
    });

    const from = installed().length;
    const update = await onPlatform('darwin', async () =>
      follow(await send('POST', 'codex', { action: 'update' }))
    );
    await waitFor(() => installed()[from], 'the Codex update');
    assert.deepEqual(installed()[from], ['npm', 'install', '-g', '@openai/codex@latest']);
    // The stand-in npm ends once told to.
    writeFileSync(join(folder, 'npm.go'), '');
    await update.end();
  } finally {
    rmSync(versions, { recursive: true, force: true });
    touch();
  }
  // At the oldest the office runs, nothing to update.
  const after = await toolIn('codex');
  assert.equal(after?.version, '0.166.0');
  assert.equal(after?.tooOld, undefined);
  assert.notEqual(toolAction(after), 'update');
});

test("the staff tool server offers its tools though it may not read .env, as inside Grok's sandbox, and a Grok run hands it the office's settings", async () => {
  // Grok's sandbox shows .env to the server but refuses to open it; a file it may not read stands in.
  const locked = join(folder, 'locked.env');
  writeFileSync(locked, 'OFFICE_TIME_ZONE=Europe/Paris\n');
  chmodSync(locked, 0o000);
  try {
    const { spawn } = await import('node:child_process');
    const server = spawn(process.execPath, [L.STAFF_SERVER], {
      env: { ...process.env, ODDBORO_ENV: locked, STAFF_ID: 'gus' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    server.stderr.on('data', (d) => (err += d));
    const tools = new Promise<string[]>((done, fail) => {
      server.stdout.on('data', (d) => {
        out += d;
        for (let i = out.indexOf('\n'); i >= 0; i = out.indexOf('\n')) {
          const m = JSON.parse(out.slice(0, i)) as {
            id?: number;
            result?: { tools: { name: string }[] };
          };
          out = out.slice(i + 1);
          if (m.id === 2) done(m.result?.tools.map((t) => t.name) ?? []);
        }
      });
      server.on('close', (code) => fail(new Error(`The server stopped (exit ${code}): ${err}`)));
    });
    const send = (m: object) => server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
    send({
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '1' }
      }
    });
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list' });
    try {
      assert.ok((await tools).includes('search_ledger'));
    } finally {
      server.kill();
    }
  } finally {
    chmodSync(locked, 0o600);
    rmSync(locked, { force: true });
  }
  // A Grok run's agent file sets the office's settings on the server itself.
  const gave = await withEnv({ OFFICE_TIME_ZONE: 'Europe/Paris' }, () => chatOf('gus'));
  assert.equal(gave.env.OFFICE_TIME_ZONE, 'Europe/Paris');
});

test('only Claude Code on Opus or Codex on Sol or Astra draws a look; on any other a hire builds one from parts, with a portrait from the same parts, that the hire takes', async () => {
  const { drawsLooks } = await import('@oddboro/ledger/agents');
  for (const [agent, model, draws] of [
    ['claude', undefined, true],
    ['claude', 'opus', true],
    ['claude', 'claude-fable-5-2', true],
    ['claude', 'claude-fable-5-1', true],
    ['claude', 'sonnet', false],
    ['codex', undefined, true],
    ['codex', 'gpt-6.1-sol', true],
    ['codex', 'gpt-6-astra', true],
    ['codex', 'gpt-6-luna', false],
    ['grok', undefined, false],
    ['gemini', undefined, false]
  ] as const)
    assert.equal(drawsLooks(agent, model), draws, `${agent} on ${model}`);

  const looks = await import('../../routes/api/looks/+server.ts');
  const parts = await import('../../routes/api/looks/parts/+server.ts');
  const list = await import('../../routes/api/me/parts/+server.ts');
  const post = <R extends { POST: (e: never) => unknown }>(r: R, body: unknown) =>
    r.POST({
      request: new Request('http://office/api', { method: 'POST', body: JSON.stringify(body) })
    } as never) as Promise<Response>;

  await withEnv({ OFFICE_AGENT: 'grok' }, async () => {
    assert.equal(((await listing()) as Listing & { drawsLooks: boolean }).drawsLooks, false);
    await assert.rejects(post(looks, { description: 'Red hair', name: 'Ida' }), (e: object) => {
      assert.match(String((e as { body?: { message?: string } }).body?.message), /from parts/);
      return true;
    });
    const p = (await (await list.GET({} as never)).json()) as {
      hair: string[];
      top: string[];
      bottom: string[];
      colours: Record<string, { name: string }[]>;
    };
    const look = {
      hair: p.hair[0],
      top: p.top[0],
      bottom: p.bottom[0],
      colours: {
        hair: p.colours.hair[0].name,
        skin: p.colours.skin[0].name,
        top: p.colours.cloth[0].name,
        bottom: p.colours.cloth[1].name,
        shoes: p.colours.shoes[0].name
      }
    };
    const built = (await (await post(parts, { look })).json()) as {
      look: object;
      portraitPx: string;
      newParts: unknown[];
      portrait: string;
      sheet: string;
      problems: string[];
    };
    assert.deepEqual(built.problems, []);
    assert.deepEqual(built.newParts, []);
    // A face shape is a part like the rest, and a look may leave it out.
    assert.deepEqual((p as unknown as { face: string[] }).face.sort(), ['soft', 'strong']);
    for (const face of ['soft', 'strong']) {
      const f = (await (await post(parts, { look: { ...look, face } })).json()) as {
        problems: string[];
      };
      assert.deepEqual(f.problems, [], face);
    }
    await assert.rejects(post(parts, { look: { ...look, face: 'no-such-face' } }), (e: object) => {
      assert.equal((e as { status?: number }).status, 400);
      return true;
    });
    assert.match(built.portrait, /^data:image\/png;base64,/);
    assert.match(built.sheet, /^data:image\/png;base64,/);
    // The hire's own check takes it as it takes a drawn look.
    const { drawnFrom, problemsWith } = await import('./looks.ts');
    assert.deepEqual(await problemsWith(drawnFrom(built)!), []);
    await assert.rejects(post(parts, { look: { ...look, hair: 'no-such-hair' } }), (e: object) => {
      assert.equal((e as { status?: number }).status, 400);
      return true;
    });
  });
  await withEnv({ OFFICE_AGENT: 'codex' }, async () =>
    assert.equal(((await listing()) as Listing & { drawsLooks: boolean }).drawsLooks, true)
  );
});

test('an office run stops when its signal does, as a drawing left for parts', async () => {
  const { runAsOffice } = await import('./office-run.ts');
  const runs = join(folder, 'office', 'runs');
  const stopped = new AbortController();
  stopped.abort();
  const run = await withEnv({ OFFICE_AGENT: 'codex' }, () =>
    runAsOffice('Draw a desk.', {
      system: 'You draw.',
      kind: 'look',
      timeoutMs: 60_000,
      signal: stopped.signal
    })
  );
  assert.deepEqual(run, { ok: false, text: 'Stopped.' });
  assert.deepEqual(existsSync(runs) ? readdirSync(runs) : [], []);
});

test('an office run on a tool that is not installed says so, not that it is not signed in', async () => {
  const { runAsOffice } = await import('./office-run.ts');
  const path = process.env.PATH;
  process.env.PATH = nodeBin;
  try {
    const run = await withEnv({ OFFICE_AGENT: 'codex' }, () =>
      runAsOffice('Draw a desk.', { system: 'You draw.', kind: 'office', timeoutMs: 60_000 })
    );
    assert.deepEqual(run, {
      ok: false,
      text: 'Codex is not installed. Install it in Setup, under Your AI.'
    });
  } finally {
    process.env.PATH = path;
  }
});

test('no test reached the keychain', () => {
  assertKeychainUntouched();
});
