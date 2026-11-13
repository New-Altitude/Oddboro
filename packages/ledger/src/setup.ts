// Sets up an office on this computer (a Mac, Linux or Windows) and opens it in the
// browser, where the owner meets it. Asks nothing: it checks the computer, starts the office (now and at
// every login) and opens it at its best address. The office keeps its own
// database unless .env names one, and brings its tables up to date as it
// starts. It compiles the art first, which git does not keep. Everything else,
// from the owner's name to their Claude login, the browser walks through.
// Safe to run again.
//
//   npm run setup                  check, start and open the office
//   npm run setup -- --check       check everything, change nothing
//   npm run setup -- --env <file>  check against a different .env, to try one out
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkDatabase, checkMachine, type Check } from './checks.ts';
import { OFFICE_LOG, openUrl, restartService, serviceInstalled } from './platform.ts';
import { ENV_FILE, readEnv } from './env.ts';
import { OFFICE_URL } from './home.ts';
import { OWNER_PARAM } from './owner-key.ts';
import { setupAddress } from './setup-address.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const ENV = args.includes('--env') ? args[args.indexOf('--env') + 1] : ENV_FILE;
const OFFICE = OFFICE_URL;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const MARK = { ok: '\x1b[32m✓\x1b[0m', optional: '\x1b[33m!\x1b[0m', missing: '\x1b[31m✗\x1b[0m' };

function show(c: Check) {
  console.log(`  ${MARK[c.state]} ${c.name.padEnd(14)} ${c.found}`);
  if (c.fix && c.state !== 'ok') console.log(`    ${dim(c.fix)}`);
}

// npm through its own script under this Node, which `npm run` names in
// npm_execpath: on Windows npm is a .cmd that Node will not start without a shell.
const npm = (npmArgs: string[]) => {
  const script = process.env.npm_execpath;
  const [cmd, all] = script ? [process.execPath, [script, ...npmArgs]] : ['npm', npmArgs];
  return new Promise<boolean>((done) =>
    spawn(cmd, all, { cwd: REPO, stdio: 'inherit' })
      .on('error', () => done(false))
      .on('close', (code) => done(code === 0))
  );
};

// ---------------------------------------------------------------------------

console.log(
  `\n${bold('Oddboro setup')}${CHECK_ONLY ? dim('  checking only, nothing changes') : ''}\n`
);

// The browser fixes a missing Claude Code or sign-in, and the office no longer
// needs Docker or uv to open. Only the system and Node have to be right first.
const machine = (await checkMachine()).filter((c) => !['docker', 'uv', 'service'].includes(c.id));
machine.forEach(show);
const blocking = machine.filter((c) => c.state === 'missing' && ['mac', 'node'].includes(c.id));

const url = readEnv(ENV).DATABASE_URL;
let database = true;
if (url) {
  const r = await checkDatabase(url);
  r.checks.forEach(show);
  database = r.checks.every((c) => c.state !== 'missing');
} else
  show({ id: 'database', name: 'Database', state: 'ok', found: 'Postgres, built into the office' });

if (CHECK_ONLY || blocking.length || !database) {
  const fine = !blocking.length && database;
  console.log(
    `\n${fine ? 'Everything the office needs to open is ready.' : `Fix what is marked ${MARK.missing} above, then run ${bold('npm run setup')} again.`}\n`
  );
  process.exit(fine ? 0 : 1);
}

if (ENV !== ENV_FILE) {
  console.log(
    `\n${dim(`This run checks ${ENV}, so the office service is left alone. Try it with`)}\n  ODDBORO_ENV=${ENV} npm run dev\n`
  );
  process.exit(0);
}

// The art is compiled, not kept in git: a fresh clone has none until this runs.
console.log(`\n${dim('Drawing the office.')}`);
if (!(await npm(['run', 'sprites', '--silent']))) {
  console.log(`${MARK.missing} The art did not compile. The error is above.`);
  process.exit(1);
}

console.log(`\n${dim('Starting the office.')}`);
if (await serviceInstalled('com.oddboro.office')) await restartService('com.oddboro.office');
else if (!(await npm(['run', 'service:install', '-w', 'apps/office']))) {
  console.log(`${MARK.missing} The office did not start. The error is above.`);
  process.exit(1);
}

// The office answers only its owner's key, so setup sends it, and opens the
// browser with it, only where the office proved this run that it holds it.
const found = await setupAddress();
if (!found) {
  console.log(
    `${MARK.missing} The office did not answer at ${OFFICE}. Its log is in ${OFFICE_LOG}.`
  );
  process.exit(1);
}
// The page takes its key from the address once and keeps it as a cookie. Only
// the browser gets the key: the line below prints the address without it.
await openUrl(`${found.address}/?${OWNER_PARAM}=${found.key}`);
console.log(
  `\n${MARK.ok} ${bold('Ready.')} The office is open in your browser. Close this window whenever you like.\n  ${dim(found.address)}\n`
);
