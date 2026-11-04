// Runs the office as a login service, so staff keep working with no terminal
// open: launchd on a Mac, a systemd user unit on Linux, a Task Scheduler task
// on Windows. On a Mac, caffeinate -s keeps it awake while it is on power and
// the office runs. Logs go to ~/Library/Logs/oddboro-office.log on a Mac,
// ~/.local/state/oddboro/office.log on Linux and
// %LOCALAPPDATA%\Oddboro\Logs\office.log on Windows.
//
//   npm run service:install -w apps/office     start now and at every login
//   npm run service:uninstall -w apps/office   stop it and remove it
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAC, OFFICE_LOG as LOG, installService, removeService } from '@oddboro/ledger/platform';

const LABEL = 'com.oddboro.office';
const OFFICE = fileURLToPath(new URL('..', import.meta.url));
// Vite's own script under this Node, which works on every system. The shim in
// node_modules/.bin is a shell script Windows cannot run.
const VITE = [process.execPath, join(OFFICE, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js')];

if (process.argv[2] === 'uninstall') {
  await removeService(LABEL);
  console.log('The office service is off.');
  process.exit(0);
}

// The service gets this shell's PATH, so it finds node, claude and uvx the
// same way a terminal does.
const env: Record<string, string> = {};
for (const k of ['PATH', 'HOME']) if (process.env[k]) env[k] = process.env[k];
const started = await installService({
  label: LABEL,
  cwd: OFFICE,
  args: MAC ? ['/usr/bin/caffeinate', '-s', ...VITE, 'dev'] : [...VITE, 'dev'],
  env,
  throttle: 30,
  log: LOG
});
if (!started) {
  console.log(`The office service did not start. Its log is in ${LOG}.`);
  process.exit(1);
}
console.log('The office runs at login now: http://127.0.0.1:4500');
