// Installing the office's coding tools from the page, each tool's own installer
// run to its end. Run with `npm test -w @oddboro/office`.
import {
  GROK_HOME,
  CODEX_HOME,
  send,
  waitFor,
  follow,
  signIn,
  lastLogin,
  refused,
  installRuns,
  installed,
  toolIn
} from './agent-tools-under-test.ts';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  L,
  assertKeychainUntouched,
  awayFromHome,
  bin,
  chatOf,
  folder,
  installers,
  nodeBin,
  onPlatform
} from './office-under-test.ts';
import { onPath } from './on-path.ts';
import { toolAction } from '../ui/tool-action.ts';

const claudeRoute = await import('../../routes/api/setup/claude/+server.ts');

/** Start `tool`'s install from the page, as on a Mac. */
const install = (tool: string) =>
  onPlatform('darwin', async () => follow(await send('POST', tool, { action: 'install' })));

/** `fn` on a Mac with none of the tools on PATH, only the installers' stand-ins, and an empty home. */
async function withNoTools<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const path = process.env.PATH;
  process.env.PATH = `${installers}:${nodeBin}:/usr/bin:/bin`;
  try {
    // The installers run here are the stand-ins, never the Mac's own.
    assert.equal(onPath('npm'), join(installers, 'npm'));
    assert.equal(onPath('bash'), join(installers, 'bash'));
    return await awayFromHome(fn);
  } finally {
    process.env.PATH = path;
  }
}

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

test('Install with no npm on PATH says to install Node.js, never a spawn error, and runs nothing', async () => {
  const path = process.env.PATH;
  // Node alone, the way the app runs on a Mac whose npm comes from nvm set up in ~/.zshrc.
  process.env.PATH = nodeBin;
  try {
    assert.equal(onPath('npm'), undefined);
    const from = installed().length;
    await awayFromHome(async () => {
      await assert.rejects(
        onPlatform('darwin', () => send('POST', 'codex', { action: 'install' })),
        refused(
          400,
          'Codex installs with npm, which comes with Node.js, and the office cannot find npm on this Mac. Install Node.js from nodejs.org, then quit and reopen Oddboro.'
        )
      );
      const t = await toolIn('codex');
      assert.equal(t?.signIn?.installing, false);
      assert.equal(toolAction(t), 'install');
      // Claude Code's install in Setup takes npm too, off Windows.
      await assert.rejects(
        onPlatform('linux', () =>
          claudeRoute.POST({
            request: new Request('http://office/api/setup/claude', {
              method: 'POST',
              body: JSON.stringify({ action: 'install' })
            })
          } as unknown as Parameters<typeof claudeRoute.POST>[0])
        ),
        refused(
          400,
          'Claude Code installs with npm, which comes with Node.js, and the office cannot find npm on this computer. Install Node.js from nodejs.org, then quit and reopen Oddboro.'
        )
      );
    });
    assert.equal(installed().length, from, 'an installer ran');
  } finally {
    process.env.PATH = path;
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
      assert.ok(run.args.includes('--prompt-file'), run.args.join(' '));
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
  assert.ok(!L.AGENT_PLATFORMS.gemini.runs.includes('darwin'));
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
