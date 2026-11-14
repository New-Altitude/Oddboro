// What the office tells a test or a bug report about itself: each startup
// step and how long it took (also written as an `office:` line, which the
// app's shell keeps in office.log), how many pages hold the live line, and
// how many errors pages have reported. GET /api/health serves it, and
// POST /api/client-log brings the page's own reports here.

/** At most this many page lines a minute, so a page stuck in a loop cannot fill the log. */
export const PAGE_LINES_PER_MINUTE = 30;
const PAGE_LINE_MAX = 600;

const steps: Record<string, number> = {};
let readyMs: number | undefined;
let pages = 0;
let pageErrors = 0;
let minute = 0;
let pageLines = 0;

/** Runs one startup step and records how long it took. */
export async function timed<T>(name: string, step: () => Promise<T> | T): Promise<T> {
  const started = performance.now();
  const result = await step();
  steps[name] = Math.round(performance.now() - started);
  console.log(`office: ${name} in ${steps[name]} ms`);
  return result;
}

/**
 * In the app, one line per setup check the page asked for: `office: setup
 * <id> ok`, or `fail` for anything not ok. Only the check's id and whether it
 * passed, never what it found, so the log names no path, version or account.
 * The release smoke test reads them, since the app's office answers it
 * nothing without the app's key. Written only when a request computes the
 * checks, never on a timer.
 */
export function logSetup(
  checks: { id: string; state: string }[],
  inApp = process.env.ODDBORO_APP === '1'
): void {
  if (!inApp) return;
  for (const c of checks)
    console.log(
      `office: setup ${c.id.replace(/[^a-z0-9-]/gi, '')} ${c.state === 'ok' ? 'ok' : 'fail'}`
    );
}

/** The office answers from here on. Node's own start counts too. */
export function markReady(): void {
  readyMs = Math.round(process.uptime() * 1000);
  console.log(`office: ready ${readyMs} ms after Node started`);
}

export function pageOpened(): void {
  pages++;
}

export function pageClosed(): void {
  pages = Math.max(0, pages - 1);
}

/**
 * One `page:` line, cut short. `oddboro:` is what the app's shell watches
 * stdout for (notifications, Keychain requests, Check now), so a page can
 * never say it.
 */
export function pageLine(kind: string, text: string): string {
  const clean = text
    .replace(/\s+/g, ' ')
    .replace(/oddboro:/gi, 'oddboro_')
    .trim();
  return `page: ${kind} ${clean.slice(0, PAGE_LINE_MAX)}`;
}

/** A page's report: counted if an error, logged unless this minute's lines are spent. */
export function pageReport(
  kind: 'boot' | 'error',
  text: string,
  now = Date.now()
): { logged: boolean } {
  if (kind === 'error') pageErrors++;
  const thisMinute = Math.floor(now / 60_000);
  if (thisMinute !== minute) {
    minute = thisMinute;
    pageLines = 0;
  }
  if (++pageLines > PAGE_LINES_PER_MINUTE) return { logged: false };
  console.log(pageLine(kind, text));
  return { logged: true };
}

export function health() {
  return {
    version: process.env.ODDBORO_VERSION || 'development',
    pid: process.pid,
    uptimeMs: Math.round(process.uptime() * 1000),
    readyMs: readyMs ?? null,
    steps: { ...steps },
    pages,
    pageErrors
  };
}
