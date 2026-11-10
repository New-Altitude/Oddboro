// Start the office over, as if this Mac had never had one, so the next visit
// is a new owner's first. Nothing is deleted: the office's own database, the
// staff's homes, the threads' folders and the office's notes move into a
// dated folder under ~/.oddboro/backups, and .env is copied there before its
// office settings are cleared. A database .env named stays as it was, just no longer used.
// The family files in data/ stay where they are. Asks for the word "reset"
// before it moves anything.
//
//   npm run reset
import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { ENV_FILE, readEnv, writeEnv } from './env.ts';
import { home } from './home.ts';
import { stopServiceSync } from './platform.ts';

const HOME = home();
// Thread folders go with the database that numbers them, so a new office
// never reuses an id over an old thread's files.
const MOVED = ['db', 'staff', 'threads', 'office'].filter((d) => existsSync(join(HOME, d)));
const CLEARED = [
  'DATABASE_URL',
  'POSTGRES_PASSWORD',
  'OFFICE_TIME_ZONE',
  'OFFICE_MODEL',
  'OFFICE_AUTH',
  'OFFICE_AGENT',
  'OFFICE_DIAGNOSTICS'
].filter((k) => k in readEnv());
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP = join(HOME, 'backups', stamp);

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
console.log(`\n${bold('Start the office over')}\n`);
console.log(`These move to ${BACKUP}:`);
for (const d of MOVED) console.log(`  ~/.oddboro/${d}`);
if (existsSync(ENV_FILE)) console.log(`  a copy of ${ENV_FILE}`);
if (CLEARED.length) console.log(`\nThese come out of .env: ${CLEARED.join(', ')}.`);
if (readEnv().DATABASE_URL)
  console.log('The database DATABASE_URL names is left as it is. The office stops using it.');
console.log('\nThe office service stops. data/ stays put.\n');

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('Type reset to go ahead: ');
rl.close();
if (answer.trim() !== 'reset') {
  console.log('Nothing moved.');
  process.exit(0);
}

// The office server holds its database open, so it stops first.
stopServiceSync('com.oddboro.office');
mkdirSync(BACKUP, { recursive: true });
for (const d of MOVED) renameSync(join(HOME, d), join(BACKUP, d));
if (existsSync(ENV_FILE)) copyFileSync(ENV_FILE, join(BACKUP, '.env'));
writeEnv(Object.fromEntries(CLEARED.map((k) => [k, ''])));

console.log(`\nDone. Everything is in ${BACKUP}.`);
console.log(`Run ${bold('npm run setup')} to open the office as a new owner.\n`);
