// The first stage of office-under-test.ts, not an entry point: the office's
// throwaway folder and the bin its stand-ins go in.
import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const folder = mkdtempSync(join(tmpdir(), 'oddboro-staff-run-'));
/** The owner's data folder in the office's home, which every Odd reads. */
export const ownerData = join(folder, 'data');
/**
 * The test database's port, which only Windows uses: on a Mac and Linux the
 * database listens on a socket in the office home (db.ts). A port the system
 * picks (listen on 0) comes from the range it also gives outgoing
 * connections, and the database listens only later: in between, another test
 * file's database or any connection could take it, and the database's listen
 * then kills this process (EADDRINUSE). So: below every system's range for
 * those (Linux 32768, the Mac and Windows 49152), by process id, which no two
 * test files running at once share, and the next one up if something already
 * listens there.
 */
async function databasePort(): Promise<number> {
  for (let port = 20_000 + (process.pid % 12_000); ; port = port >= 31_999 ? 20_000 : port + 1) {
    const free = await new Promise<boolean>((done) => {
      const s = createServer()
        .once('error', () => done(false))
        .listen(port, '127.0.0.1', () => s.close(() => done(true)));
    });
    if (free) return port;
  }
}
const port = await databasePort();
// The stand-in for Claude Code: it reads the message, then reports one tool
// call and a result that carries what the office gave the run, the variables
// Run commands sets among it, and whether the git template folder those name
// was there and empty as it ran (`done()` removes it after), and npm's
// settings. It takes the markers every stand-in takes (`SHARED`, below). A
// message whose last line says "Refuse the open
// network", in a run whose sandbox opens every host, gets the words Claude
// Code's binary refuses that with, on stderr, and exit 1, after any hold;
// "Refuse the open network and wait." says the same words, then never ends.
// Only the last line, since a later prompt can quote an earlier message.
// "Succeed with an error." ends on a success result that says is_error, and
// "Succeed with no text." on a success result with no text.
// One that says "Think aloud: <words>." on any line streams <words> as
// text first. A run with --input-format stream-json starts on its first user
// line, as Claude Code does, and keeps each user line after it, text only, in
// "added" (Send now), answering all of them in its one result. Each user line
// after that result gets a result of its own, "Then: <words>", as the office
// closes its stdin, as Claude Code answers words that came too late for its
// turn; it ends then.
// "claude auth status" says signed out at once, "claude auth logout" ends at
// once, and "claude auth login" prints its sign-in page and waits until it is
// stopped, as Setup's sign-in waits on the owner.
export const bin = join(folder, 'bin');
mkdirSync(bin);
/**
 * Node alone, for the stand-ins, never node's own bin folder: a tool the
 * owner installed with npm (a real grok or codex) lives there, and a test
 * that found it would start it for real, a sign-in page in their browser.
 */
export const nodeBin = join(folder, 'node-bin');
mkdirSync(nodeBin);
symlinkSync(process.execPath, join(nodeBin, 'node'));
/**
 * With this variable set, a stand-in exits 0 before it reads its input, as a
 * tool that fails as it starts does. A variable, not words in the message: the
 * Claude, Codex and Gemini stand-ins get the message on stdin, so they could
 * not see a marker there without reading it.
 */
export const EXIT_BEFORE_READING = 'ODDBORO_STAND_IN_EXIT_BEFORE_READING';

export { port };
