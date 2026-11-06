// Where Oddboro keeps the owner's office, where its own code lives, and the
// port it answers on. A release sets these from the app (apps/desktop); in
// development they fall back to ~/.oddboro, this repo and port 4500.
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * True inside the Mac app (apps/desktop), which opens the office in its own
 * window: no web address, no Caddy.
 */
export const IN_APP = process.env.ODDBORO_APP === '1';

/** The owner's office: the database, staff folders, sign-ins and data. */
export const HOME = process.env.ODDBORO_HOME || join(homedir(), '.oddboro');
export const home = (...parts: string[]): string => join(HOME, ...parts);

/** An Odd's one chat session, which every chat resumes (staff.ts). */
export const chatSession = (id: string): string => home('staff', id, 'session.json');

/** The code: this repo in development, the app's Resources/server folder in a release. */
export const CODE = process.env.ODDBORO_CODE || fileURLToPath(new URL('../../..', import.meta.url));

/** The office's own port, and the database's inside it. */
export const OFFICE_PORT = Number(process.env.ODDBORO_PORT) || 4500;
export const OFFICE_URL = `http://127.0.0.1:${OFFICE_PORT}`;
export const DATABASE_PORT = Number(process.env.ODDBORO_DB_PORT) || 54329;

/** The staff tool server beside this file: mcp.ts in development, mcp.js in a release. */
export const STAFF_SERVER = fileURLToPath(
  new URL(`./mcp${extname(fileURLToPath(import.meta.url))}`, import.meta.url)
);
