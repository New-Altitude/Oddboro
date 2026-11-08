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
