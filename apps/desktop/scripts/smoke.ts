// What must work in the app before a release goes out, checked on the real
// build: it installs and starts, says the version it is, refuses a write from
// anyone but its own page, takes the page's writes, passes its setup checks,
// onboards, shows its page in the real window and answers a press there,
// quits cleanly and starts again with its data. Each step is one row of a
// table; a failed required row fails the run. `driver.ts` does the driving.
//
//   node apps/desktop/scripts/smoke.ts --artifact <installer|AppImage|dmg> --version 0.0.9
//   node apps/desktop/scripts/smoke.ts --from <folder> --version 0.0.9
//   node apps/desktop/scripts/smoke.ts --installed [--app <path>] [--version 0.0.9]
//   node apps/desktop/scripts/smoke.ts --stage
//
// --from takes the one build of that version in a folder (a build job's
// output). --installed runs the app already on this computer, apart from its
// office. --stage runs the staged server, after stage.ts. --signed adds
// Gatekeeper's checks on a Mac. --out sets where results go. --annotate
// writes every result as a GitHub annotation.
import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { arch, release, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  accessibilityPage,
  automationPage,
  BASE,
  DB_PORT,
  fileVersion,
  getJson,
  installLinux,
  installMac,
  installWindows,
  type Installed,
  launch,
  LINUX,
  logText,
  MAC,
  makeRun,
  type Page,
  pageHeaders,
  plist,
  PORT,
  ps,
  quit,
  ready,
  run,
  screenshot,
  send,
  shellPids,
  sleep,
  stubClaude,
  tcp,
  uninstallEntry,
  until,
  webdriverStart,
  WIN
} from './driver.ts';

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '..');
const CI = process.env.GITHUB_ACTIONS === 'true';

const { values: args } = parseArgs({
  options: {
    artifact: { type: 'string' },
    from: { type: 'string' },
    installed: { type: 'boolean', default: false },
    app: { type: 'string' },
    stage: { type: 'boolean', default: false },
    version: { type: 'string' },
    signed: { type: 'boolean', default: false },
    out: { type: 'string' },
    annotate: { type: 'boolean', default: false },
    relaunches: { type: 'string', default: '2' },
    'replace-installed': { type: 'boolean', default: false }
  }
});

const OUT = args.out ?? mkdtempSync(join(tmpdir(), 'oddboro-smoke-'));
const t0 = Date.now();
const log = (line: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`);

type Result = { step: string; ok: boolean; required: boolean; ms: number; detail: string };
const results: Result[] = [];

const oneLine = (value: unknown) =>
  (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''))
    .replace(/\s+/g, ' ')
    .slice(0, 2000);

async function step<T>(
  name: string,
  required: boolean,
  f: () => Promise<T> | T
): Promise<T | undefined> {
  const started = Date.now();
  try {
    const value = await f();
    results.push({
      step: name,
      ok: true,
      required,
      ms: Date.now() - started,
      detail: oneLine(value)
    });
    log(`ok   ${name}: ${oneLine(value)}`);
    return value;
  } catch (e) {
    const detail = oneLine(e instanceof Error ? e.message : e);
    results.push({ step: name, ok: false, required, ms: Date.now() - started, detail });
    log(`${required ? 'FAIL' : 'no  '} ${name}: ${detail}`);
    return undefined;
  }
}

function expectStatus(r: { status: number; text: string }, status: number): string {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status} ${r.text}`);
  return `${r.status} ${r.text}`;
}

/** The office's version: /api/health on a build that has it, /api/update before. */
async function runningVersion(): Promise<{ version: string; health: boolean }> {
  const health = await fetch(`${BASE}/api/health`).then(
    (r) => (r.ok ? r.json() : undefined),
    () => undefined
  );
  if (health) return { version: (health as { version: string }).version, health: true };
  return { version: (await getJson<{ current: string }>('/api/update')).current, health: false };
}

/** The checks every start of the office gets, the staged server's included. */
async function officeChecks(expect: { version?: string; claude: boolean }): Promise<boolean> {
  const found = await step('says the version it is', true, async () => {
    const r = await runningVersion();
    if (expect.version && r.version !== expect.version)
      throw new Error(`${r.version}, not ${expect.version}`);
    return r;
  });
  await step('refuses a write with no Origin', true, async () =>
    expectStatus(await send('DELETE', '/api/pokes/999999', {}), 403)
  );
  await step('takes a write shaped as the page sends it, with Sec-Fetch-Site', true, async () =>
    expectStatus(await send('DELETE', '/api/pokes/999999', pageHeaders(true)), 404)
  );
  await step('takes it with Origin only, as older WebKit sends it', true, async () =>
    expectStatus(await send('DELETE', '/api/pokes/999999', pageHeaders(false)), 404)
  );
  // The checks start programs (claude --version and others): 35 s on the arm64 Windows runner.
  await step(
    `passes its setup checks${expect.claude ? ', Claude Code found (PR #18)' : ''}`,
    true,
    async () => {
      const { checks } = await getJson<{ checks: { id: string; state: string; found: string }[] }>(
        '/api/setup',
        90
      );
      const summary = checks.map((c) => `${c.id}: ${c.state} (${c.found})`).join('; ');
      const state = (id: string) => checks.find((c) => c.id === id)?.state;
      if (state('database') !== 'ok') throw new Error(`the database is not ok: ${summary}`);
      if (expect.claude && state('claude') !== 'ok')
        throw new Error(`the stand-in Claude Code was not found: ${summary}`);
      return summary;
    }
  );
  // Each ledger line waits for its embedding: with Ollama installed, the first
  // one loads the model cold, about 20 s.
  await step('onboards with a ready-made manager', true, async () =>
    expectStatus(
      await send(
        'POST',
        '/api/onboarding',
        pageHeaders(true),
        { name: 'Smoke', zone: 'America/Los_Angeles', manager: { preset: 'marshall' } },
        90
      ),
      200
    )
  );
  return found?.health ?? false;
}

/**
 * The real window: the welcome's Next moves it on to the name step. Before
 * onboarding, on a fresh home. "Changed" alone would prove nothing: the music
 * player's clock ticks on the welcome too. Next stays disabled until the
 * welcome's system checks are in, so the press is tried until it lands. A
 * press matches the button's whole name, never "Next track".
 */
async function windowCheck(page: Page): Promise<string> {
  let lastRead = '';
  const before = await until(
    'a Next button in the window',
    async () => {
      lastRead = await page
        .read()
        .catch((e: unknown) => `read failed: ${e instanceof Error ? e.message : e}`);
      return lastRead.includes('Next') ? lastRead : undefined;
    },
    60
  ).catch((e: unknown) => {
    throw new Error(
      `${e instanceof Error ? e.message : e}. Last read: ${lastRead.slice(0, 600) || '(nothing)'}`
    );
  });
  let lastTry = '';
  const after = await until(
    'the name step after Next',
    async () => {
      await page
        .press('Next')
        .catch((e: unknown) => (lastTry = e instanceof Error ? e.message : String(e)));
      await sleep(2000);
      const text = await page.read();
      return /call you/i.test(text) ? text : undefined;
    },
    90
  ).catch((e: unknown) => {
    throw new Error(
      `${e instanceof Error ? e.message : e}${lastTry ? ` (last press: ${lastTry})` : ''}`
    );
  });
  return `before: ${before.slice(0, 300)} || after Next: ${after.slice(0, 400)}`;
}

function report(): never {
  const logFile = join(OUT, 'office.log');
  if (!existsSync(logFile) && currentRun) writeFileSync(logFile, logText(currentRun));
  const failed = results.filter((r) => r.required && !r.ok);
  const env = `${process.platform} ${arch()} ${release()}${process.env.ImageOS ? `, image ${process.env.ImageOS} ${process.env.ImageVersion}` : ''}`;
  writeFileSync(
    join(OUT, 'results.json'),
    JSON.stringify({ version: args.version, env, results }, null, 2) + '\n'
  );
  const cell = (s: string) => s.replace(/\|/g, '\\|');
  const summary = [
    `### Smoke: ${failed.length ? `${failed.length} required step(s) failed` : 'every required step passed'}`,
    '',
    `${env}${args.version ? `, Oddboro ${args.version}` : ''}`,
    '',
    '| Step | Result | Time | Detail |',
    '| --- | --- | --- | --- |',
    ...results.map(
      (r) =>
        `| ${cell(r.step)} | ${r.ok ? 'ok' : r.required ? '**FAIL**' : 'no'} | ${r.ms} ms | ${cell(r.detail.slice(0, 400))} |`
    ),
    ''
  ].join('\n');
  writeFileSync(join(OUT, 'summary.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (CI) {
    const escape = (t: string) =>
      t.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const title = (t: string) => escape(t).replace(/:/g, '%3A').replace(/,/g, '%2C');
    for (const r of failed)
      console.log(`::error title=${title(`Smoke - ${r.step}`)}::${escape(r.detail)}`);
    // The fork reads results through GitHub's public API, which serves
    // annotations without a login. GitHub keeps 10 notices a step.
    if (args.annotate) {
      const lines = results.map(
        (r) =>
          `${r.ok ? 'ok' : r.required ? 'FAIL' : 'no'} | ${r.step} | ${r.ms} ms | ${r.detail.slice(0, 300)}`
      );
      console.log(`::notice title=Smoke results::${escape([env, ...lines].join('\n'))}`);
      for (const r of results.filter((r) => r.detail.length > 300).slice(0, 9))
        console.log(`::notice title=${title(`Detail - ${r.step}`)}::${escape(r.detail)}`);
    }
  }
  log(
    `${failed.length ? `${failed.length} required step(s) failed` : 'every required step passed'}. Results in ${OUT}`
  );
  process.exit(failed.length ? 1 : 0);
}

let currentRun: ReturnType<typeof makeRun> | undefined;

/** The staged server, run as the app runs it, without the app. */
async function smokeStage(): Promise<void> {
  const stage = join(DESKTOP, 'stage');
  const binaries = join(DESKTOP, 'src-tauri', 'binaries');
  const node = existsSync(binaries)
    ? readdirSync(binaries).find((n) => n.startsWith('node-'))
    : undefined;
  if (!existsSync(join(stage, 'apps', 'office', 'build', 'index.js')) || !node)
    throw new Error('No staged server: run node apps/desktop/scripts/stage.ts first');
  const r = makeRun(OUT);
  currentRun = r;
  const start = (): ChildProcess => {
    appendFileSync(r.log, `--- start at ${new Date().toISOString()}\n`);
    const server = spawn(
      join(binaries, node),
      [join(stage, 'apps', 'office', 'build', 'index.js')],
      {
        cwd: join(stage, 'apps', 'office'),
        env: {
          ...process.env,
          ...r.env,
          PORT: String(PORT),
          HOST: '127.0.0.1',
          ORIGIN: BASE,
          ODDBORO_CODE: stage,
          // As in the app: the server quits when asked, and a versioned first
          // start in an empty home makes its folder and records the version.
          ODDBORO_APP: '1',
          ODDBORO_VERSION: '0.0.0-smoke'
        },
        // A held stdin, as the app gives it: the server quits when it closes.
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    server.stdout?.on('data', (d) => appendFileSync(r.log, d));
    server.stderr?.on('data', (d) => appendFileSync(r.log, d));
    return server;
  };
  const answered = (server: ChildProcess) =>
    until(
      'an answer from the staged office',
      async () => {
        if (server.exitCode !== null)
          throw new Error(
            `it exited ${server.exitCode}: ${readFileSync(r.log, 'utf8').slice(-800)}`
          );
        return (await fetch(`${BASE}/api/update`, { signal: AbortSignal.timeout(2000) })).ok
          ? true
          : undefined;
      },
      90
    );
  /** As the app asks: SIGTERM, or on Windows, which has none, by closing stdin. */
  const stop = async (server: ChildProcess) => {
    const started = Date.now();
    if (WIN) server.stdin?.end();
    else server.kill('SIGTERM');
    const quit = await new Promise((done) => {
      server.once('exit', () => done(true));
      setTimeout(() => done(false), 10_000);
    });
    if (!quit) {
      server.kill('SIGKILL');
      throw new Error('it did not quit within 10 s of being asked');
    }
    return `quit in ${Date.now() - started} ms`;
  };

  let server = start();
  if (!(await step('the staged office answers', true, () => answered(server)))) return;
  const health = await officeChecks({ version: '0.0.0-smoke', claude: false });
  await step('serves its health, with every startup step', health, async () => {
    const h = await getJson<{ steps: Record<string, number>; readyMs: number | null }>(
      '/api/health'
    );
    if (!h.readyMs || !h.steps.tables) throw new Error(JSON.stringify(h));
    return h;
  });
  await step("takes the page's report for the log, and nobody else's", health, async () => {
    expectStatus(
      await send('POST', '/api/client-log', pageHeaders(true), { kind: 'error', message: 'smoke' }),
      200
    );
    expectStatus(
      await send('POST', '/api/client-log', {}, { kind: 'error', message: 'smoke' }),
      403
    );
    await sleep(500);
    if (!readFileSync(r.log, 'utf8').includes('page: error smoke'))
      throw new Error('no page: line in the log');
    return 'logged once, refused without the page';
  });
  await step('quits when asked, as the app asks', true, () => stop(server));
  server = start();
  await step('starts again with its data', true, async () => {
    await answered(server);
    const setup = await getJson<{ welcomed?: boolean }>('/api/setup', 90);
    if (!setup.welcomed) throw new Error('it forgot the onboarding');
    return 'still onboarded';
  });
  await stop(server).catch(() => undefined);
}

/** The built app: installed, started, driven through its real window. */
async function smokeApp(): Promise<void> {
  let installed: Installed | undefined;
  if (args.installed) {
    installed = await step('the app on this computer', true, () => {
      const exe =
        args.app ??
        (WIN
          ? join(process.env.LOCALAPPDATA ?? '', 'Oddboro', 'oddboro.exe')
          : MAC
            ? join(
                '/Applications/Oddboro.app/Contents/MacOS',
                plist('/Applications/Oddboro.app', 'CFBundleExecutable')
              )
            : '');
      if (!exe || !existsSync(exe))
        throw new Error(`no app at ${exe || '(Linux needs --app <AppImage>)'}`);
      return { exe, dir: exe };
    });
  } else {
    const file = args.artifact ?? findBuild(args.from!, args.version!);
    // The Windows installer replaces the Oddboro installed for this user, and
    // the run uninstalls it after. Fine on a runner, not on someone's computer.
    if (WIN && !CI && !args['replace-installed'])
      throw new Error(
        'On Windows this replaces, then uninstalls, your Oddboro. Pass --replace-installed to go on, or use --installed.'
      );
    installed = await step(`installs ${file.split(/[\\/]/).pop()}`, true, () =>
      WIN ? installWindows(file) : MAC ? installMac(file) : installLinux(file)
    );
  }
  if (!installed) return;
  const { exe, dir } = installed;

  if (WIN && !args.installed) {
    await step('the uninstall entry names the version', true, () => {
      const got = uninstallEntry();
      if (args.version && got !== args.version)
        throw new Error(`${got || 'no entry'}, not ${args.version}`);
      return got;
    });
    await step('the Start menu has its shortcut (notifications need it)', true, () => {
      const lnk = join(
        process.env.APPDATA ?? '',
        'Microsoft',
        'Windows',
        'Start Menu',
        'Programs',
        'Oddboro.lnk'
      );
      if (existsSync(lnk)) return lnk;
      const found = ps(
        `@(@($env:APPDATA, $env:ProgramData, [Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory')) | Where-Object { $_ } | ForEach-Object { Get-ChildItem -LiteralPath $_ -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*ddboro*' } } | ForEach-Object { $_.FullName }) -join ', '`
      );
      throw new Error(`${lnk} is missing. Oddboro shortcuts anywhere: ${found || 'none'}`);
    });
  }
  if (WIN)
    await step('oddboro.exe carries the version', !!args.version, () => {
      const got = fileVersion(exe);
      if (args.version && got !== args.version && got !== `${args.version}.0`)
        throw new Error(`${got}, not ${args.version}`);
      return got;
    });
  if (MAC) {
    await step('Info.plist names the version', !!args.version, () => {
      const got = plist(dir, 'CFBundleShortVersionString');
      if (args.version && got !== args.version) throw new Error(`${got}, not ${args.version}`);
      return got;
    });
    if (args.signed) {
      await step('the signature holds (codesign)', true, () =>
        run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', dir])
      );
      await step('Gatekeeper accepts it as notarized (spctl)', true, () => {
        const out = run('spctl', ['--assess', '--type', 'execute', '-vv', dir]);
        if (!out.includes('Notarized Developer ID')) throw new Error(out);
        return out;
      });
      await step('its notarization ticket is stapled', true, () =>
        run('xcrun', ['stapler', 'validate', dir])
      );
    }
  }
  const claude = CI && !args.installed;
  if (claude) await step('a stand-in Claude Code where an install puts it', true, stubClaude);

  const r = makeRun(OUT);
  currentRun = r;
  if (shellPids().length)
    throw new Error(
      'Oddboro is already running here. Quit it first: Linux and Windows keep to one Oddboro at a time.'
    );
  if ((await tcp(PORT)) || (await tcp(DB_PORT)))
    throw new Error(`Port ${PORT} or ${DB_PORT} is taken`);

  // The first start comes with its window: Linux through tauri-driver, which
  // starts the app itself, Windows and the Mac by reading the window as is.
  let app: ChildProcess | undefined;
  let page: Page | undefined;
  let stopDriven: (() => Promise<void>) | undefined;
  let script: ((body: string) => Promise<unknown>) | undefined;
  const started = await step('the first start answers', true, async () => {
    if (LINUX) {
      const t = Date.now();
      const driven = await webdriverStart(exe, r);
      ({ page, script } = driven);
      stopDriven = driven.stop;
      return `${Date.now() - t} ms, through tauri-driver`;
    }
    app = launch(exe, r);
    const ms = await ready(app, r);
    page = WIN ? automationPage(app.pid ?? 0) : accessibilityPage(app.pid ?? 0);
    return `${ms} ms`;
  });
  if (!started || !page) return;

  await step('the real window shows the welcome, and Next moves it to the name step', true, () =>
    windowCheck(page!)
  );
  if (script)
    await step('a write from inside the real page reaches its route', true, async () => {
      const status = await script!(
        "return (await fetch('/api/pokes/999999', { method: 'DELETE', headers: { 'content-type': 'application/json' } })).status;"
      );
      if (status !== 404) throw new Error(`got ${status}`);
      return status;
    });
  const health = await officeChecks({ version: args.version, claude });
  await step('the log has the window loading the page, and the page booting', health, async () => {
    const text = await until(
      'both lines',
      async () => {
        const t = logText(r);
        return t.includes('office page loaded') && t.includes('page: boot') ? t : undefined;
      },
      30
    );
    return text
      .split('\n')
      .filter((l) => /opening: pid|office page loaded|page: boot|office: ready/.test(l))
      .join(' / ');
  });
  await step('no errors in the page', health, async () => {
    const h = await getJson<{ pageErrors: number; pages: number }>('/api/health');
    if (h.pageErrors)
      throw new Error(
        `${h.pageErrors} page error(s): ${logText(r)
          .split('\n')
          .filter((l) => l.includes('page: error'))
          .join(' / ')}`
      );
    return `${h.pages} page(s) on the live line, no errors`;
  });
  await step('a screenshot', false, () => screenshot(join(OUT, 'screen.png')));
  await step('quits with Node and both ports gone', true, async () => {
    if (stopDriven) {
      await stopDriven();
      return 'stopped through tauri-driver; the relaunches quit with SIGTERM';
    }
    return `${await quit(app!, r)} ms`;
  });

  const relaunches = Number(args.relaunches);
  await step(`starts again ${relaunches} times, with its data`, true, async () => {
    const times: number[] = [];
    for (let i = 1; i <= relaunches; i++) {
      const again = launch(exe, r);
      times.push(await ready(again, r));
      if (i === 1) {
        const setup = await getJson<{ welcomed?: boolean }>('/api/setup', 90);
        if (!setup.welcomed) throw new Error('it forgot the onboarding');
      }
      await quit(again, r);
    }
    return `starts (ms): ${times.join(', ')}`;
  });
  if (installed.uninstall) await step('uninstalls silently', true, installed.uninstall);
}

/** The one build of this version in a build job's output. */
function findBuild(folder: string, version: string): string {
  if (!version) throw new Error('--from needs --version');
  const ext = WIN ? '-setup.exe' : MAC ? '.dmg' : '.AppImage';
  const found = readdirSync(folder).filter(
    (n) => n.startsWith(`Oddboro_${version}_`) && n.endsWith(ext)
  );
  if (found.length !== 1)
    throw new Error(`expected one Oddboro_${version}_*${ext} in ${folder}, found ${found.length}`);
  return join(folder, found[0]);
}

try {
  if (args.stage) await smokeStage();
  else if (args.artifact || args.from || args.installed) await smokeApp();
  else throw new Error('Say what to test: --artifact, --from, --installed or --stage');
} catch (e) {
  results.push({
    step: 'set up',
    ok: false,
    required: true,
    ms: 0,
    detail: oneLine(e instanceof Error ? e.message : e)
  });
}
report();
