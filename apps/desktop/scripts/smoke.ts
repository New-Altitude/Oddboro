// What must work in the app before a release goes out, checked on the real
// build: it installs and starts, says the version it is, refuses anything
// without the app's key, refuses a write from anyone but its own page, takes
// the page's writes, passes its setup checks, onboards, shows its page in the
// real window and answers a press there, quits cleanly and starts again with
// its data. Each step is one row of a table; a failed required row fails the
// run. `driver.ts` does the driving.
//
// The office in the app answers only requests with the app's key, which the
// real app's shell keeps in memory. So the checks that need the office's
// answers run where a key can come along: on the staged server (--stage),
// which this run starts and gives a key as the shell would, and on Linux from
// inside the real page. On a Mac and Windows the real app's run reads the
// setup checks from the log instead: the office writes `office: setup <id>
// ok|fail` for each when the window's welcome asks for them. Onboarding and
// its data across a restart are not checked there. The shell starts each of
// the office's lines with the time in UTC (`2026-11-13T04:16:47.786Z office:
// ...`); builds before that wrote none, so the log's patterns take either.
//
//   node apps/desktop/scripts/smoke.ts --artifact <installer|AppImage|dmg> --version 0.0.9
//   node apps/desktop/scripts/smoke.ts --from <folder> --version 0.0.9
//   node apps/desktop/scripts/smoke.ts --installed [--app <path>] [--version 0.0.9]
//   node apps/desktop/scripts/smoke.ts --stage
//   node apps/desktop/scripts/smoke.ts --from <folder> --version 0.0.9 --previous-from <folder> --previous-version 0.0.8
//
// --from takes the one build of that version in a folder (a build job's
// output). --installed runs the app already on this computer, on its own
// port, home and log. --stage runs the staged server, after stage.ts.
// --previous-from installs that release first and this build over it, as an
// owner who has it gets the next version.
// --signed adds Gatekeeper's checks on a Mac. --out sets where results go.
// --annotate writes every result as a GitHub annotation. --keep keeps the
// run's home for a look after; otherwise it goes when the run ends.
//
// Off CI a run never touches the owner's secrets: the office runs with no
// secret store (ODDBORO_SECRETS=office). The Mac app keeps its secrets
// through its shell, in the Keychain the owner's Oddboro uses, so off CI it
// runs only with --my-keychain.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
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
  databaseId,
  DB_PORT,
  type Driven,
  fileVersion,
  firstStarts,
  getJson,
  inPage,
  installLinux,
  installMac,
  installWindows,
  type Installed,
  launch,
  LINUX,
  logText,
  MAC,
  keyLine,
  makeRun,
  type Office,
  type Page,
  pageHeaders,
  plist,
  PORT,
  ps,
  quit,
  quitCommand,
  ready,
  run,
  type Run,
  screenshot,
  send,
  shellPids,
  sleep,
  stopRun,
  stubClaude,
  tcp,
  uninstallEntry,
  until,
  webdriverStart,
  WIN,
  withKey
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
    'previous-from': { type: 'string' },
    'previous-version': { type: 'string' },
    signed: { type: 'boolean', default: false },
    out: { type: 'string' },
    annotate: { type: 'boolean', default: false },
    relaunches: { type: 'string', default: '2' },
    'replace-installed': { type: 'boolean', default: false },
    'my-keychain': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false }
  }
});

const OUT = args.out ?? mkdtempSync(join(tmpdir(), 'oddboro-smoke-'));
// Made first: a run refused before it starts still writes its results here.
mkdirSync(OUT, { recursive: true });
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
async function runningVersion(office: Office): Promise<{ version: string; health: boolean }> {
  const health = await office.getJson<{ version: string }>('/api/health').catch(() => undefined);
  if (health) return { version: health.version, health: true };
  return {
    version: (await office.getJson<{ current: string }>('/api/update')).current,
    health: false
  };
}

/** The version the office's first log line names (`office: <version> on ...`). */
function loggedVersion(log: string): { version: string; health: boolean } {
  const found = [...log.matchAll(/^(?:\S+Z )?office: (\S+) on /gm)].at(-1);
  if (!found) throw new Error('no office: line in the log');
  return { version: found[1], health: true };
}

/** What a request without the app's key gets (`apps/office/src/lib/server/app-key.ts`). */
const OPEN_FROM_APP = 'This office opens only in the Oddboro app. Open Oddboro to see it.';

/** A row that needs the app's key, which only the real app's shell holds. */
const keptInTheApp = (name: string, instead = '--stage checks it') =>
  step(name, false, () => {
    throw new Error(`not checked here: the app keeps its key to itself. ${instead}`);
  });

const ONBOARDING = { name: 'Smoke', zone: 'America/Los_Angeles', manager: { preset: 'marshall' } };

const UPGRADE = !!args['previous-from'];
const TITLE = UPGRADE ? 'Upgrade' : 'Smoke';

/** Each setup check's last state in the log (`office: setup <id> ok|fail`), by id. */
function setupFromLog(log: string): Map<string, string> {
  return new Map(
    [...log.matchAll(/^(?:\S+Z )?office: setup ([a-z0-9-]+) (ok|fail)$/gm)].map((m) => [m[1], m[2]])
  );
}

/** The setup checks pass: the database, and Claude Code where the run put a stand-in. */
function setupPasses(state: (id: string) => string | undefined, claude: boolean, summary: string) {
  if (state('database') !== 'ok') throw new Error(`the database is not ok: ${summary}`);
  if (claude && state('claude') !== 'ok')
    throw new Error(`the stand-in Claude Code was not found: ${summary}`);
  return summary;
}

/**
 * The checks every start of the office gets, the staged server's included.
 * `office` asks with the app's key: over HTTP with the one this run gave the
 * staged server, from inside the page on Linux, or none for the real app on a
 * Mac and Windows, where the version comes from the log.
 */
async function officeChecks(
  expect: { version?: string; claude: boolean },
  office: Office | undefined,
  log: () => string,
  http: boolean
): Promise<boolean> {
  const found = await step('says the version it is', true, async () => {
    const r = office ? await runningVersion(office) : loggedVersion(log());
    if (expect.version && r.version !== expect.version)
      throw new Error(`${r.version}, not ${expect.version}`);
    return r;
  });
  await step("refuses any request without the app's key, a read too", true, async () => {
    for (const [method, headers] of [
      ['GET', {}],
      ['DELETE', pageHeaders(true)]
    ] as const) {
      const r = await send(method, '/api/pokes/999999', headers);
      if (r.status !== 403 || r.text !== OPEN_FROM_APP)
        throw new Error(`${method}: expected 403 "${OPEN_FROM_APP}", got ${r.status} ${r.text}`);
    }
    return `403 ${OPEN_FROM_APP}`;
  });
  await step("serves the page's own built files without the key", true, async () =>
    JSON.stringify(await getJson('/_app/version.json'))
  );
  // A request the page's browser makes always carries its own Origin, so these need HTTP.
  if (office && http) {
    await step('refuses a write with the key but no Origin', true, async () =>
      expectStatus(await office.send('DELETE', '/api/pokes/999999', {}), 403)
    );
    await step('takes a write shaped as the page sends it, with Sec-Fetch-Site', true, async () =>
      expectStatus(await office.send('DELETE', '/api/pokes/999999', pageHeaders(true)), 404)
    );
    await step('takes it with Origin only, as older WebKit sends it', true, async () =>
      expectStatus(await office.send('DELETE', '/api/pokes/999999', pageHeaders(false)), 404)
    );
  }
  const setupName = `passes its setup checks${expect.claude ? ', Claude Code found (PR #18)' : ''}`;
  const onboardName = 'onboards with a ready-made manager';
  if (!office) {
    // The window's welcome has asked for the checks by now; they can take 35 s on a slow runner.
    await step(setupName, true, async () => {
      const states = await until(
        'the setup checks in the log',
        async () => {
          const seen = setupFromLog(log());
          return seen.has('database') ? seen : undefined;
        },
        90
      );
      const summary = [...states].map(([id, state]) => `${id}: ${state}`).join('; ');
      return setupPasses((id) => states.get(id), expect.claude, summary);
    });
    await keptInTheApp(onboardName);
    return found?.health ?? false;
  }
  // The checks start programs (claude --version and others): 35 s on the arm64 Windows runner.
  await step(setupName, true, async () => {
    const { checks } = await office.getJson<{
      checks: { id: string; state: string; found: string }[];
    }>('/api/setup', 90);
    const summary = checks.map((c) => `${c.id}: ${c.state} (${c.found})`).join('; ');
    return setupPasses((id) => checks.find((c) => c.id === id)?.state, expect.claude, summary);
  });
  // Each ledger line waits for its embedding: with the search model downloaded,
  // the first one loads it, well under a second on an M-series Mac.
  await step(onboardName, true, async () =>
    expectStatus(
      await office.send('POST', '/api/onboarding', pageHeaders(true), ONBOARDING, 90),
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

/** The run's home, and on Windows its WebView2 profile, gone unless --keep. */
function cleanUp(): void {
  if (!currentRun || args.keep) return;
  for (const dir of [currentRun.home, currentRun.env.WEBVIEW2_USER_DATA_FOLDER])
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}

function report(): never {
  const logFile = join(OUT, 'office.log');
  if (!existsSync(logFile) && currentRun) writeFileSync(logFile, logText(currentRun));
  try {
    cleanUp();
  } catch (e) {
    log(`could not remove the run's home: ${e instanceof Error ? e.message : e}`);
  }
  const failed = results.filter((r) => r.required && !r.ok);
  const env = `${process.platform} ${arch()} ${release()}${process.env.ImageOS ? `, image ${process.env.ImageOS} ${process.env.ImageVersion}` : ''}`;
  writeFileSync(
    join(OUT, 'results.json'),
    JSON.stringify({ version: args.version, env, results }, null, 2) + '\n'
  );
  const cell = (s: string) => s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  const summary = [
    `### ${TITLE}: ${failed.length ? `${failed.length} required step(s) failed` : 'every required step passed'}`,
    '',
    `${env}${args.version ? `, Oddboro ${args.version}` : ''}${UPGRADE ? ` over ${args['previous-version']}` : ''}`,
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
      console.log(`::error title=${title(`${TITLE} - ${r.step}`)}::${escape(r.detail)}`);
    // The fork reads results through GitHub's public API, which serves
    // annotations without a login. GitHub keeps 10 notices a step.
    if (args.annotate) {
      const lines = results.map(
        (r) =>
          `${r.ok ? 'ok' : r.required ? 'FAIL' : 'no'} | ${r.step} | ${r.ms} ms | ${r.detail.slice(0, 300)}`
      );
      console.log(`::notice title=${TITLE} results::${escape([env, ...lines].join('\n'))}`);
      for (const r of results.filter((r) => r.detail.length > 300).slice(0, 9))
        console.log(`::notice title=${title(`Detail - ${r.step}`)}::${escape(r.detail)}`);
    }
  }
  log(
    `${failed.length ? `${failed.length} required step(s) failed` : 'every required step passed'}. Results in ${OUT}${args.keep && currentRun ? `, its home in ${currentRun.home}` : ''}`
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
  // A fresh key, as the app's shell makes one, given to the server the same way.
  const key = randomBytes(32).toString('hex');
  const office = withKey(key);
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
          // No secret store: never the owner's Keychain or keyring.
          ODDBORO_SECRETS: 'office',
          // As in the app: the server quits when asked, and a versioned first
          // start in an empty home makes its folder and records the version.
          ODDBORO_APP: '1',
          ODDBORO_VERSION: '0.0.0-smoke',
          // So Sentry starts in the staged server. The home is new, so the owner
          // has not said yes and nothing is sent; port 9 would take nothing anyway.
          ODDBORO_DIAGNOSTICS_DSN: 'http://oddboro@127.0.0.1:9/oddboro/0'
        },
        // A held stdin, as the app gives it: the server quits when it closes.
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );
    server.stdout?.on('data', (d) => appendFileSync(r.log, d));
    server.stderr?.on('data', (d) => appendFileSync(r.log, d));
    server.stdin?.write(keyLine(key));
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
        const res = await office
          .send('GET', '/api/update', {}, undefined, 2)
          .catch(() => undefined);
        return res?.status === 200 ? true : undefined;
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
  if (!(await step('the staged office answers', true, () => answered(server)))) {
    await stop(server).catch(() => undefined);
    return;
  }
  // As the shell checks before it trusts the server on the port.
  await step('proves it holds the key it was given, without the key', true, async () => {
    const nonce = randomBytes(32).toString('hex');
    const r = await send('GET', `/api/proof?nonce=${nonce}`, {});
    const want = createHmac('sha256', key).update(`oddboro-proof:${nonce}`).digest('hex');
    if (r.status !== 200 || r.text !== want) throw new Error(`got ${r.status} ${r.text}`);
    return 'HMAC-SHA256 of the label and the nonce';
  });
  const health = await officeChecks(
    { version: '0.0.0-smoke', claude: false },
    office,
    () => readFileSync(r.log, 'utf8'),
    true
  );
  await step('serves its health, with every startup step', health, async () => {
    const h = await office.getJson<{ steps: Record<string, number>; readyMs: number | null }>(
      '/api/health'
    );
    if (!h.readyMs || !h.steps.tables || h.steps.key === undefined)
      throw new Error(JSON.stringify(h));
    return h;
  });
  await step("takes the page's report for the log, and nobody else's", health, async () => {
    expectStatus(
      await office.send('POST', '/api/client-log', pageHeaders(true), {
        kind: 'error',
        message: 'smoke'
      }),
      200
    );
    expectStatus(
      await office.send('POST', '/api/client-log', {}, { kind: 'error', message: 'smoke' }),
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
    const setup = await office.getJson<{ welcomed?: boolean }>('/api/setup', 90);
    if (!setup.welcomed) throw new Error('it forgot the onboarding');
    return 'still onboarded';
  });
  await stop(server).catch(() => undefined);
}

/** Off CI, what a run would do to the owner's own Oddboro, refused unless they said so. */
function refuseOwnersApp(installs: boolean): void {
  if (MAC && !CI && !args['my-keychain'])
    throw new Error(
      'On a Mac the app reads the Keychain your Oddboro uses, so this run would have your sign-ins. Pass --my-keychain to go on, or run it on CI.'
    );
  // Before any install: the Windows installer replaces the running app.
  if (shellPids().length)
    throw new Error(
      'Oddboro is already running here. Quit it first: Linux and Windows keep to one Oddboro at a time.'
    );
  // The Windows installer replaces the Oddboro installed for this user, and
  // the run uninstalls it after. Fine on a runner, not on someone's computer.
  if (installs && WIN && !CI && !args['replace-installed'])
    throw new Error(
      'On Windows this replaces, then uninstalls, your Oddboro. Pass --replace-installed to go on, or use --installed.'
    );
}

/** Installs a build, in place of `over` when given, with the Windows installer's own rows. */
async function installBuild(
  file: string,
  version: string | undefined,
  over?: { installed: Installed; version: string }
): Promise<Installed | undefined> {
  const name = file.split(/[\\/]/).pop();
  const installed = await step(
    over ? `installs ${name} over ${over.version}` : `installs ${name}`,
    true,
    () =>
      WIN ? installWindows(file) : MAC ? installMac(file, over?.installed.dir) : installLinux(file)
  );
  if (!installed || !WIN) return installed;
  await step('the uninstall entry names the version', true, () => {
    const got = uninstallEntry();
    if (version && got !== version) throw new Error(`${got || 'no entry'}, not ${version}`);
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
  return installed;
}

/** The version the app's own files carry: `oddboro.exe` on Windows, `Info.plist` on a Mac. */
async function versionOnDisk({ exe, dir }: Installed, version: string | undefined): Promise<void> {
  if (WIN)
    await step('oddboro.exe carries the version', !!version, () => {
      const got = fileVersion(exe);
      if (version && got !== version && got !== `${version}.0`)
        throw new Error(`${got}, not ${version}`);
      return got;
    });
  if (MAC)
    await step('Info.plist names the version', !!version, () => {
      const got = plist(dir, 'CFBundleShortVersionString');
      if (version && got !== version) throw new Error(`${got}, not ${version}`);
      return got;
    });
}

/** A start with its window, and how to drive and end it. */
type Started = {
  page: Page;
  app?: ChildProcess;
  /** Linux: a script in the real page, which carries the window's key. */
  script?: Driven['script'];
  /** Linux: ends the WebDriver session and the app with it. */
  stop?: Driven['stop'];
};

/**
 * A start that comes with its window: Linux through tauri-driver, which starts
 * the app itself, Windows and the Mac by reading the window as is.
 */
async function startWithWindow(exe: string, r: Run): Promise<{ started: Started; detail: string }> {
  const t = Date.now();
  if (LINUX) {
    const { page, script, stop } = await webdriverStart(exe, r);
    return {
      started: { page, script, stop },
      detail: `${Date.now() - t} ms, through tauri-driver`
    };
  }
  const app = launch(exe, r);
  const ms = await ready(app, r);
  return {
    started: { app, page: WIN ? automationPage(app.pid ?? 0) : accessibilityPage(app.pid ?? 0) },
    detail: `${ms} ms`
  };
}

/** A row for a start with its window: the start, or undefined when the row failed. */
async function startRow(name: string, exe: string, r: Run): Promise<Started | undefined> {
  let started: Started | undefined;
  await step(name, true, async () => {
    const s = await startWithWindow(exe, r);
    started = s.started;
    return s.detail;
  });
  return started;
}

/** The version the office says: from inside the page on Linux, from the log elsewhere. */
async function saysVersion(started: Started, r: Run, version: string): Promise<string> {
  const said = started.script
    ? await runningVersion(inPage(started.script))
    : loggedVersion(logText(r));
  if (said.version !== version) throw new Error(`${said.version}, not ${version}`);
  return said.version;
}

/** What the office said of its database in the log after `from` (NEW-1776). */
const databaseSaid = (r: Run, from: number) =>
  logText(r)
    .slice(from)
    .match(/office: database ([^\n]*)/)?.[1] ?? 'no "office: database" line';

/** Quits a start made by `startWithWindow`, noting what the office said of its database. */
async function quitStarted(
  started: Started,
  r: Run,
  exe: string,
  closing: string[]
): Promise<string> {
  if (started.stop) return `${await started.stop()}; the relaunches quit with SIGTERM`;
  const from = logText(r).length;
  const ms = await quit(started.app!, r, WIN ? exe : undefined);
  closing.push(databaseSaid(r, from));
  return `${ms} ms${WIN ? ', by `oddboro --quit`' : ''}`;
}

/**
 * Starts the app `times` times more. Windows quits by `oddboro --quit` each
 * time; the Mac and Linux by SIGTERM, and by `oddboro --quit` the last time,
 * so every system's --quit is tried.
 */
async function relaunch(exe: string, r: Run, times: number, closing: string[]): Promise<string> {
  const ms: number[] = [];
  for (let i = 1; i <= times; i++) {
    const again = launch(exe, r);
    ms.push(await ready(again, r));
    const from = logText(r).length;
    await quit(again, r, WIN || i === times ? exe : undefined);
    closing.push(databaseSaid(r, from));
  }
  return `starts (ms): ${ms.join(', ')}; the last quit by \`oddboro --quit\``;
}

/** Each quit closed the office's database first, by its `office: database closed` line. */
function closedEachTime(closing: string[]): string {
  if (!closing.length || closing.some((c) => c !== 'closed'))
    throw new Error(`the office said, quit by quit: ${closing.join('; ') || 'nothing'}`);
  return `closed at all ${closing.length} quits`;
}

/** The built app: installed, started, driven through its real window. */
async function smokeApp(): Promise<void> {
  refuseOwnersApp(!args.installed);
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
  } else
    installed = await installBuild(
      args.artifact ?? findBuild(args.from!, args.version!),
      args.version
    );
  if (!installed) return;
  const { exe, dir } = installed;

  await versionOnDisk(installed, args.version);
  if (MAC) {
    if (args.signed) {
      await step('the signature holds (codesign)', true, () =>
        run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', dir])
      );
      await step('Gatekeeper accepts it as notarized (spctl)', true, () => {
        const out = run('spctl', ['--assess', '--type', 'execute', '-vv', dir]);
        if (!out.includes('Notarized Developer ID')) throw new Error(out);
        return out;
      });
      // stapler asks Apple's servers too, and a dropped connection there is no
      // fault of the build: up to three tries for that, none for a bad ticket.
      await step('its notarization ticket is stapled', true, async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            return run('xcrun', ['stapler', 'validate', dir]);
          } catch (e) {
            if (attempt === 3 || !String(e).includes('NSURLErrorDomain')) throw e;
            await sleep(10_000);
          }
        }
      });
    }
  }
  // Not for --installed: a build from before ODDBORO_EXTRA_PATH would not look there.
  const claude = !args.installed;
  const standIn = claude
    ? await step('a stand-in Claude Code in a folder of its own', true, () =>
        stubClaude(mkdtempSync(join(tmpdir(), 'oddboro-smoke-bin-')))
      )
    : undefined;

  const r = makeRun(OUT);
  currentRun = r;
  if (standIn) r.env.ODDBORO_EXTRA_PATH = dirname(standIn.program);
  // Linux and Windows: the office then has no secret store. The Mac's shell
  // sets its own, which --my-keychain accepted above.
  if (!CI) r.env.ODDBORO_SECRETS = 'office';
  if ((await tcp(PORT)) || (await tcp(DB_PORT)))
    throw new Error(`Port ${PORT} or ${DB_PORT} is taken`);

  const first = await startRow('the first start answers', exe, r);
  if (!first) return;
  const { page, script } = first;

  await step('the real window shows the welcome, and Next moves it to the name step', true, () =>
    windowCheck(page)
  );
  if (script)
    await step('a write from inside the real page reaches its route', true, async () => {
      const status = await script(
        "return (await fetch('/api/pokes/999999', { method: 'DELETE', headers: { 'content-type': 'application/json' } })).status;"
      );
      if (status !== 404) throw new Error(`got ${status}`);
      return status;
    });
  // On Linux the checks ask from inside the real page, which carries the key.
  const health = await officeChecks(
    { version: args.version, claude },
    script ? inPage(script) : undefined,
    () => logText(r),
    false
  );
  if (standIn)
    await step('the office found Claude Code in ODDBORO_EXTRA_PATH first', true, () => {
      const calls = existsSync(standIn.ran) ? readFileSync(standIn.ran, 'utf8').trim() : '';
      if (!calls) throw new Error(`the stand-in in ${dirname(standIn.program)} never ran`);
      return `it ran: ${[...new Set(calls.split('\n'))].join('; ')}`;
    });
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
    const errors = logText(r)
      .split('\n')
      .filter((l) => l.includes('page: error'));
    if (errors.length) throw new Error(`${errors.length} page error(s): ${errors.join(' / ')}`);
    return 'no page: error line in the log';
  });
  // Both sides log where they are: the shell's launch line, and in the app the
  // office's own `office: port <n>, home <folder>` line (hooks.server.ts).
  // Required once the office writes that line; builds before NEW-1694 do not.
  const lines = logText(r).split('\n');
  const officeLine = lines.filter((l) => /^(?:\S+Z )?office: port \d+, home /.test(l)).at(-1);
  await step(
    'the shell and the office agree on the port and the home folder',
    officeLine !== undefined,
    () => {
      const launch = lines.filter((l) => l.includes('opening: pid')).at(-1);
      const shell = launch?.match(/, port (\d+), home (.+?), webview /);
      if (!shell) throw new Error(`no launch line with a port and a home: ${launch ?? '(none)'}`);
      const office = officeLine?.match(/^(?:\S+Z )?office: port (\d+), home (.+)$/);
      if (!office) throw new Error('no office: port line in the log');
      const said = {
        shell: { port: shell[1], home: shell[2] },
        office: { port: office[1], home: office[2].trim() }
      };
      for (const [who, s] of Object.entries(said))
        if (s.port !== String(PORT) || s.home !== r.home)
          throw new Error(
            `the ${who} says port ${s.port} and home ${s.home}; the run set port ${PORT} and home ${r.home}`
          );
      return `port ${PORT} and home ${r.home}, in the shell's launch line and the office's own`;
    }
  );
  await step('a screenshot', false, () => screenshot(join(OUT, 'screen.png')));
  // What the office said of its database at each quit (NEW-1776). Not for the
  // first quit on Linux: ending the WebDriver session can end the shell
  // before Node's last line reaches the log.
  const closing: string[] = [];
  await step('quits with Node and both ports gone', true, () =>
    quitStarted(first, r, exe, closing)
  );
  // Its data is checked on the staged server (--stage), which this run can give a key.
  const relaunches = Number(args.relaunches);
  await step(`starts again ${relaunches} times, with its data`, true, () =>
    relaunch(exe, r, relaunches, closing)
  );
  // A build from before NEW-1776 says nothing of its database, so not for --installed.
  if (!args.installed)
    await step('each quit closes the office database first (NEW-1776)', true, () =>
      closedEachTime(closing)
    );
  // A build from before --quit would start instead, so not for --installed.
  if (!args.installed)
    await step('`oddboro --quit` with nothing running starts nothing', true, async () => {
      const code = await quitCommand(exe, r);
      if (code !== 0) throw new Error(`it exited ${code}`);
      if (await tcp(PORT)) {
        const left = await stopRun(r, '--quit with nothing running');
        throw new Error(`something answers on ${PORT} after it (${left})`);
      }
      return 'it exited 0, and nothing answers on the port';
    });
  if (installed.uninstall) await step('uninstalls silently', true, installed.uninstall);
}

/**
 * The last release installed and started on a new home, then this build
 * installed over it, in the same place and on the same home: how every owner
 * who has Oddboro gets the next version. #40 broke this path, when the 0.0.6
 * Windows installer held 0.0.5 and every Windows app updated forever.
 */
async function smokeUpgrade(): Promise<void> {
  const last = args['previous-version'];
  const version = args.version;
  if (!last || !version)
    throw new Error('--previous-from needs --previous-version, and --version for this build');
  refuseOwnersApp(true);
  const lastFile = findBuild(args['previous-from']!, last);
  const file = args.artifact ?? findBuild(args.from!, version);

  const r = makeRun(OUT);
  currentRun = r;
  if (!CI) r.env.ODDBORO_SECRETS = 'office';
  if ((await tcp(PORT)) || (await tcp(DB_PORT)))
    throw new Error(`Port ${PORT} or ${DB_PORT} is taken`);

  const before = await step(
    `installs the last release, ${lastFile.split(/[\\/]/).pop()}`,
    true,
    () => (WIN ? installWindows(lastFile) : MAC ? installMac(lastFile) : installLinux(lastFile))
  );
  if (!before) return;
  const was = await startRow(`${last} starts on a new home`, before.exe, r);
  if (!was) return;
  await step(`it says it is ${last}`, true, () => saysVersion(was, r, last));
  if (was.script) {
    const office = inPage(was.script);
    await step(`onboards ${last}, from inside its page`, true, async () => {
      await office.getJson('/api/setup', 90);
      return expectStatus(
        await office.send('POST', '/api/onboarding', pageHeaders(true), ONBOARDING, 90),
        200
      );
    });
  } else await keptInTheApp(`onboards ${last}`, 'Its database stands in, below');
  const id = await step(`${last} makes its database`, true, async () => {
    await until(
      'office: ready in the log',
      async () => (/office: ready/.test(logText(r)) ? true : undefined),
      90
    );
    return databaseId(r.home);
  });
  await step(`${last} quits`, true, async () => {
    try {
      return await quitStarted(was, r, before.exe, []);
    } catch (e) {
      // Windows has no signal a script can send, and a build from before
      // `oddboro --quit` ignores it, so quit() stopped it instead.
      if (WIN && String(e).includes('did not reach it'))
        return `stopped: ${last} has no \`oddboro --quit\``;
      throw e;
    }
  });
  if (!id) return;

  const installed = await installBuild(file, version, { installed: before, version: last });
  if (!installed) return;
  await versionOnDisk(installed, version);
  const from = logText(r).length;
  const now = await startRow(`${version} starts on the home ${last} left`, installed.exe, r);
  if (!now) return;
  await step(`it says it is ${version}`, true, () => saysVersion(now, r, version));
  const first = await step(
    `it logs its first start after ${last}, with the database backed up first`,
    true,
    async () => {
      const line = await until(
        'a first start line',
        async () => firstStarts(logText(r).slice(from))[0],
        60
      );
      if (line.version !== version || line.after !== last)
        throw new Error(
          `first start of ${line.version} after ${line.after ?? 'nothing'}, not ${version} after ${last}`
        );
      if (!line.backup) throw new Error('it made no backup');
      return line;
    }
  );
  await step(`it opens the database ${last} made, not a new one`, true, () => {
    const opened = databaseId(r.home);
    if (opened !== id) throw new Error(`system identifier ${opened}, not ${last}'s ${id}`);
    if (!first?.backup) return `system identifier ${id}`;
    const copy = databaseId(first.backup);
    if (copy !== id) throw new Error(`the backup holds ${copy}, not ${id}`);
    return `system identifier ${id}, in the database and its backup`;
  });
  if (now.script) {
    const office = inPage(now.script);
    await step(`its database passes the setup check, and it is still onboarded`, true, async () => {
      const setup = await office.getJson<{
        welcomed?: boolean;
        checks: { id: string; state: string }[];
      }>('/api/setup', 90);
      const database = setup.checks.find((c) => c.id === 'database')?.state;
      if (database !== 'ok') throw new Error(`the database check: ${database ?? 'missing'}`);
      if (!setup.welcomed) throw new Error(`it forgot the onboarding ${last} took`);
      return 'database ok, still onboarded';
    });
  } else
    await step('its database passes the setup check', true, async () => {
      const states = await until(
        'the setup checks in the log',
        async () => {
          const seen = setupFromLog(logText(r).slice(from));
          return seen.has('database') ? seen : undefined;
        },
        90
      );
      if (states.get('database') !== 'ok') throw new Error(`database: ${states.get('database')}`);
      return 'database: ok';
    });
  await step('its page boots, with no errors', true, async () => {
    const text = await until(
      'page: boot in the log',
      async () => {
        const t = logText(r).slice(from);
        return t.includes('page: boot') ? t : undefined;
      },
      60
    );
    const errors = text.split('\n').filter((l) => l.includes('page: error'));
    if (errors.length) throw new Error(`${errors.length} page error(s): ${errors.join(' / ')}`);
    return 'page: boot, and no page: error line';
  });
  const closing: string[] = [];
  await step(`${version} quits`, true, () => quitStarted(now, r, installed.exe, closing));
  const relaunches = Number(args.relaunches);
  await step(`starts again ${relaunches} times`, true, () =>
    relaunch(installed.exe, r, relaunches, closing)
  );
  await step(
    'no second update: one first start, one backup, the same version each start',
    true,
    () => {
      const log = logText(r).slice(from);
      const starts = firstStarts(log);
      const backups = readdirSync(join(r.home, 'backups')).filter((n) =>
        n.startsWith(`pre-${version}-`)
      );
      if (starts.length !== 1 || backups.length !== 1)
        throw new Error(
          `${starts.length} first start line(s) and ${backups.length} backup(s) of ${version}`
        );
      const versions = [...log.matchAll(/^(?:\S+Z )?office: (\S+) on /gm)].map((m) => m[1]);
      if (versions.some((v) => v !== version))
        throw new Error(`the office said, start by start: ${versions.join(', ')}`);
      return `one first start of ${version} and one backup (${backups[0]}); ${versions.length} starts, each ${version}`;
    }
  );
  await step(`each quit of ${version} closes the office database first (NEW-1776)`, true, () =>
    closedEachTime(closing)
  );
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
  else if (UPGRADE) await smokeUpgrade();
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
