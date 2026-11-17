// The Projects window and its New session form, mounted in a browser-like
// document against a stand-in office, with what a test drives them by: the
// office's answers, the requests sent, and typing, picking and clicking as the
// owner does. Tests only. It sits outside `onboarding/`, so a change here is
// not read as a change to setup (hard rule 14).
//
// Importing it makes the test file a client one, as `mounted-for-client.ts`
// says, and puts the stand-in office's `fetch` and a quiet `EventSource` on
// `globalThis`. A test sends an event on one of its streams with `streamAt(url).send`.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mountedForClient, type Mounted } from './onboarding/mounted-for-client.ts';
import { newSessionFields, type Choice, type FormChange } from './project-form.ts';
import type NewSessionFormComponent from './NewSessionForm.svelte';
import type ProjectSessionsComponent from './ProjectSessions.svelte';

const here = dirname(fileURLToPath(import.meta.url));

/** One request the window sent to the project sessions route. */
export type Sent = { action: string } & Record<string, unknown>;
/** What the stand-in office answers a request with: a body, a whole response, or a wait. */
export type Answer = (sent: Sent) => unknown;
let answer: Answer = () => ({});
/** Every request the window sent since the last `office`, in order. */
export const sent: Sent[] = [];
/** What Choose folder's own route answers. */
let picked: unknown = {};
globalThis.fetch = (async (url: string, init: RequestInit) => {
  if (url === '/api/folders/pick') return Response.json(picked);
  const body = JSON.parse(String(init.body)) as Sent;
  sent.push(body);
  const reply = await answer(body);
  return reply instanceof Response ? reply : Response.json(reply);
}) as typeof fetch;
/** Every stream the window opened since the last `office`, in order. */
const streams: QuietStream[] = [];
/**
 * A live-update stream that sends nothing until a test calls `send`. Not an
 * `EventTarget`: the mounted document brings its own `Event`, which Node's
 * `EventTarget` refuses.
 */
class QuietStream {
  readonly url: string;
  onerror: (() => void) | null = null;
  #listeners = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(url: string) {
    this.url = url;
    streams.push(this);
  }
  addEventListener(type: string, listener: (e: { data: string }) => void) {
    this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
  }
  close() {}
  /** Sends `type` with `data` as JSON to every listener, as the office's stream does. */
  send(type: string, data: unknown = null) {
    for (const listener of this.#listeners.get(type) ?? [])
      listener({ data: JSON.stringify(data) });
  }
}
Object.defineProperty(globalThis, 'EventSource', {
  value: QuietStream,
  configurable: true,
  writable: true
});
/** The newest stream the window opened whose URL starts with `start`. */
export function streamAt(start: string): QuietStream {
  const found = streams.findLast((s) => s.url.startsWith(start));
  assert.ok(found, `a stream at ${start}`);
  return found;
}

export const FOLDERS = [
  { path: '/work/claude-a', mark: 'owner@example.com' },
  { path: '/work/claude-b', mark: 'second@example.com' }
];
export const REFUSED = 'Claude is replying in that terminal.';
/** The office refusing an action with `message`, as its route does. */
export const refused = (message: string) => Response.json({ message }, { status: 409 });

/**
 * A stand-in office with `sessions`, each showing `view`, and the two Claude
 * folders. Choose folder answers `picked`, and anything else `more`.
 */
export function office({
  sessions = [],
  view,
  picked: chosen = {},
  more = () => ({})
}: { sessions?: unknown[]; view?: unknown; picked?: unknown; more?: Answer } = {}) {
  sent.length = 0;
  streams.length = 0;
  picked = chosen;
  answer = (s) => {
    if (s.action === 'connections') return sessions;
    if (s.action === 'folders') return FOLDERS;
    if (s.action === 'history') return { work: [], view };
    return more(s);
  };
}
/** The requests sent for `action`. */
export const asked = (action: string) => sent.filter((s) => s.action === action);

/** Lets every request answered so far land, and the window show it. */
export async function settled(shown: Mounted) {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
    shown.flush();
  }
}
/** The Projects window, mounted, with what the office answered as it opened shown. */
export async function projectsWindow() {
  const shown = await mountedForClient<typeof ProjectSessionsComponent>(
    join(here, 'ProjectSessions.svelte'),
    { staff: [], version: 0, ask: { n: 0 } }
  );
  await settled(shown);
  return shown;
}

/**
 * The New session form alone, on the continue path for ~/app with `candidates`
 * found, `problemRow`'s row showing the office's refusal, and what each of its
 * callbacks got.
 */
export async function form({
  candidates,
  problemRow
}: {
  candidates: Choice[];
  problemRow?: string;
}) {
  const reported: FormChange[] = [];
  const chosen: Choice[] = [];
  const moved: Choice[] = [];
  const nothing = () => {};
  const mounted = await mountedForClient<typeof NewSessionFormComponent>(
    join(here, 'NewSessionForm.svelte'),
    {
      folder: '/work/app',
      agent: 'claude',
      socket: '',
      name: '',
      startIn: '',
      filter: '',
      path: 'continue',
      fields: newSessionFields({
        path: 'continue',
        folder: '/work/app',
        agent: 'claude',
        claudeFolders: 1,
        handingOver: false
      }),
      folders: [],
      candidates,
      found: true,
      listing: false,
      busy: false,
      problem: problemRow ? REFUSED : undefined,
      place: problemRow ? 'row' : undefined,
      problemRow,
      setup: undefined,
      onfilter: nothing,
      onchange: (change) => reported.push(change),
      onpick: nothing,
      onpath: nothing,
      onstart: nothing,
      onchoose: (c) => chosen.push(c),
      onmove: (c) => moved.push(c),
      onsetuperror: nothing,
      onhandover: nothing
    }
  );
  return { ...mounted, reported, chosen, moved };
}

/**
 * An element as a failed assertion shows it: its tag, label and text. A failed
 * assertion on the element itself prints the whole document, for a minute.
 */
export function described(element: unknown) {
  if (!(element instanceof Element)) return String(element);
  const label = element.getAttribute('aria-label');
  const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  return `<${element.tagName.toLowerCase()}${label ? ` aria-label="${label}"` : ''}> "${text}"`;
}
/** Asserts `found` is the very element `wanted`, or that both are `null`. */
export function sameElement(found: unknown, wanted: unknown, message: string) {
  assert.ok(found === wanted, `${message}: found ${described(found)}, wanted ${described(wanted)}`);
}
/** The one element `selector` finds in `root`. */
export function one<E extends Element>(root: Element, selector: string): E {
  const found = root.querySelector<E>(selector);
  assert.ok(found, `one ${selector}`);
  return found;
}
/** Every button in `root` reading `words`. */
export function buttons(root: Element, words: string) {
  return [...root.querySelectorAll('button')].filter((b) => b.textContent?.trim() === words);
}
/** The one button in `root` reading `words`. */
export function button(root: Element, words: string) {
  const found = buttons(root, words);
  assert.equal(found.length, 1, `one button reading "${words}"`);
  return found[0];
}
export const folderField = (root: Element) =>
  one<HTMLInputElement>(root, 'input[placeholder^="Folder path"]');
/** Types `value` into the folder field, one `input` per keystroke, and stays in it. */
export function typeFolder(root: Element, value: string) {
  const field = folderField(root);
  for (let end = 1; end <= value.length; end++) {
    field.value = value.slice(0, end);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
/** Types `value` into the folder field and leaves it, as the owner does. */
export function enterFolder(root: Element, value: string) {
  typeFolder(root, value);
  folderField(root).dispatchEvent(new Event('change', { bubbles: true }));
}
/** Picks `value` in the list `label` names, as the owner does. */
export function pick(root: Element, label: string, value: string) {
  const list = one<HTMLSelectElement>(root, `select[aria-label="${label}"]`);
  list.value = value;
  list.dispatchEvent(new Event('change', { bubbles: true }));
}
/** The line a found conversation's row sits on, with any button beside it. */
export function lineOf(root: Element, c: Choice) {
  const own = [...root.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(c.id.slice(0, 8))
  );
  return own?.parentElement ?? null;
}
