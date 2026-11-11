// Where Oddboro keeps the owner's office, where its own code lives, and the
// port it answers on. A release sets these from the app (apps/desktop); in
// development they fall back to ~/.oddboro, this repo and port 4500.
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True inside the Mac app (apps/desktop), which opens the office in its own
 * window: no web address, no Caddy.
 */
export const IN_APP = process.env.ODDBORO_APP === '1';

/**
 * Under `node --test`, which sets NODE_TEST_CONTEXT in every test process and
 * its children. A test once wrote the owner's real office, so under test the
 * office never falls back to ~/.oddboro or the live office's port.
 */
const UNDER_TEST = !!process.env.NODE_TEST_CONTEXT;

/** The owner's office: the database, staff folders, sign-ins and data. */
const HOME = process.env.ODDBORO_HOME || (UNDER_TEST ? undefined : join(homedir(), '.oddboro'));
/** Under test with no ODDBORO_HOME: a folder of its own, made on first use, removed at exit. */
let testHome: string | undefined;
function officeHome(): string {
  if (HOME) return HOME;
  if (!testHome) {
    const made = mkdtempSync(join(tmpdir(), 'oddboro-test-'));
    process.on('exit', () => rmSync(made, { recursive: true, force: true }));
    testHome = made;
  }
  return testHome;
}
export const home = (...parts: string[]): string => join(officeHome(), ...parts);

/** Every account's folder: each coding tool's sign-ins, one folder each (accounts.ts). */
export const accountsHome = (): string => home('accounts');
/** One account's folder: the home its tool runs with (`GROK_HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR`). */
export const accountHome = (tool: string, account: string): string =>
  home('accounts', tool, account);

/**
 * The office's own files at the top of an Odd's folder, by what each holds:
 * the chat log (staff.ts), the chat's run session, and a persona's session at
 * its door (persona-door.ts). Each writer takes its name from here, so an
 * Odd never mails one, the Storage tab never lists one, and a replay never
 * names one as a change (`OFFICE_FILE_NAMES`).
 */
export const OFFICE_FILES = {
  chat: 'chat.jsonl',
  session: 'session.json',
  personaSession: 'persona-session.json'
} as const;
export const OFFICE_FILE_NAMES: readonly string[] = Object.values(OFFICE_FILES);

/** An Odd's one chat session, which every chat resumes (staff.ts). */
export const chatSession = (id: string): string => home('staff', id, OFFICE_FILES.session);

/** The code: this repo in development, the app's Resources/server folder in a release. */
export const CODE = process.env.ODDBORO_CODE || fileURLToPath(new URL('../../..', import.meta.url));

/** The office's own port, and the database's inside it. */
export const OFFICE_PORT = Number(process.env.ODDBORO_PORT) || 4500;
export const OFFICE_URL = `http://127.0.0.1:${OFFICE_PORT}`;
export const DATABASE_PORT = Number(process.env.ODDBORO_DB_PORT) || (UNDER_TEST ? 54399 : 54329);

/** The staff tool server beside this file: mcp.ts in development, mcp.js in a release. */
export const STAFF_SERVER = fileURLToPath(
  new URL(`./mcp${extname(fileURLToPath(import.meta.url))}`, import.meta.url)
);
/** The office's file tools beside this file (files-server.ts): how a run reads and changes files. */
export const FILES_SERVER = fileURLToPath(
  new URL(`./files-server${extname(fileURLToPath(import.meta.url))}`, import.meta.url)
);
