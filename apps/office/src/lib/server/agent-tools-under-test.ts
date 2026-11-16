// What the coding tools' tests share: the sign-in route as the page calls it,
// the tools' homes, and waiting for a sign-in or an install to settle.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'node:test';
import { agents, folder, installs, onPlatform } from './office-under-test.ts';
import type { AgentTool, LaterTool } from '../../routes/api/agents/+server.ts';

const route = await import('../../routes/api/agents/[tool]/+server.ts');

const { SLOTS } = await import('./agent-sign-in.ts');

// A test that fails or runs out of time leaves its install or sign-in running,
// and every test after it would find that tool still busy.
afterEach(() => {
  for (const slot of Object.values(SLOTS)) slot.stop('The test ended.');
});

const GROK_HOME = join(folder, 'accounts', 'grok', 'office');
const CODEX_HOME = join(folder, 'accounts', 'codex', 'office');

/** One request to the sign-in route for `tool`, as the page sends it. */
function send(method: 'POST' | 'PUT' | 'DELETE', tool: string, body?: unknown) {
  const event = {
    params: { tool },
    request: new Request(`http://office/api/agents/${tool}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
  } as unknown as Parameters<typeof route.POST>[0];
  return route[method](event);
}
type Listing = { office: string; tools: AgentTool[]; later: LaterTool[] };
/** What "Runs on" and the Your AI list hear, as on `platform`. */
async function listing(platform: NodeJS.Platform = 'darwin'): Promise<Listing> {
  return onPlatform(platform, async () => {
    const res = await agents.GET({} as Parameters<typeof agents.GET>[0]);
    return (await res.json()) as Listing;
  });
}
/** The tools "Runs on" and the list hear of, as on a Mac. */
const listed = async (platform: NodeJS.Platform = 'darwin') => (await listing(platform)).tools;

/**
 * `check` once it gives a value, within 30 s: a stand-in installer can take
 * seconds to start on a busy machine, and a value ends the wait at once.
 */
async function waitFor<T>(check: () => T | undefined, what: string): Promise<T> {
  const until = Date.now() + 30_000;
  for (;;) {
    const v = check();
    if (v !== undefined) return v;
    if (Date.now() > until) assert.fail(`still waiting: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

type Line = { line?: string; url?: string; done?: boolean; ok?: boolean };
/** A streamed sign-in: the lines so far, the sign-in page's address once printed, and every line once it ends. */
function follow(res: Response) {
  const seen: Line[] = [];
  assert.ok(res.body, 'the sign-in streams nothing');
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const ended = (async () => {
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return seen;
      buf += value;
      for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
        seen.push(JSON.parse(buf.slice(0, i)) as Line);
        buf = buf.slice(i + 1);
      }
    }
  })();
  return {
    ended,
    url: () => waitFor(() => seen.find((l) => l.url)?.url, 'the sign-in page'),
    /** The last two lines once it ends: why, and how. */
    end: async () => (await ended).slice(-2)
  };
}
/** Start `tool`'s sign-in from the page, as on a Mac. */
const signIn = (tool: string) =>
  onPlatform('darwin', async () => follow(await send('POST', tool, { action: 'sign-in' })));
/** What the stand-in `login` of the tool in `home` was started with, last. */
const lastLogin = (home: string) =>
  JSON.parse(
    readFileSync(join(home, 'logins.jsonl'), 'utf8').trim().split('\n').at(-1) ?? '{}'
  ) as {
    args: string[];
    home: string;
    configFirst?: boolean;
  };

/** A route's refusal: its status and the words the owner reads. */
const refused = (status: number, message?: string) => (e: unknown) => {
  const r = e as { status?: number; body?: { message?: string } };
  return r.status === status && (message === undefined || r.body?.message === message);
};

/** Every installer the page ran so far, as its stand-in logged it: its name and arguments, and the names in its environment. */
const installRuns = (): { args: string[]; env: string[] }[] =>
  existsSync(installs)
    ? readFileSync(installs, 'utf8')
        .split('\n')
        .slice(0, -1) // The child may still be writing the last line.
        .map((l) => JSON.parse(l) as { args: string[]; env: string[] })
    : [];
/** Every installer the page ran so far, by its name and arguments. */
const installed = (): string[][] => installRuns().map((r) => r.args);

const toolIn = async (id: string) => (await listed()).find((t) => t.id === id);

export {
  GROK_HOME,
  CODEX_HOME,
  send,
  type Listing,
  listing,
  listed,
  waitFor,
  follow,
  signIn,
  lastLogin,
  refused,
  installRuns,
  installed,
  toolIn
};
