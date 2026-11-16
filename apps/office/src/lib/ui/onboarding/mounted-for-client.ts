// A Svelte component mounted in a browser-like document under node --test, so a
// test types, clicks and reads what the page shows. Tests only.
//
// Importing this file makes its test file a client one: components load
// compiled for the client, and the document's classes and objects stand in
// for the browser's on `globalThis`, as the page has them.
import { after } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Window } from 'happy-dom';
import type { Component, ComponentProps } from 'svelte';
import { svelteUnderNode } from './svelte-under-node.ts';

svelteUnderNode('client');

const browser = new Window({ url: 'http://localhost/' });
// What Svelte's client code and the components reach for by name. Node has its
// own Event; the document's replaces it, so an event a test makes with
// `new Event('input')` is one the document's elements take.
const names = {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  localStorage: browser.localStorage,
  Node: browser.Node,
  Element: browser.Element,
  HTMLElement: browser.HTMLElement,
  HTMLInputElement: browser.HTMLInputElement,
  HTMLSelectElement: browser.HTMLSelectElement,
  HTMLTemplateElement: browser.HTMLTemplateElement,
  Text: browser.Text,
  Comment: browser.Comment,
  DocumentFragment: browser.DocumentFragment,
  Event: browser.Event,
  CustomEvent: browser.CustomEvent,
  InputEvent: browser.InputEvent,
  KeyboardEvent: browser.KeyboardEvent,
  MouseEvent: browser.MouseEvent,
  FocusEvent: browser.FocusEvent,
  MutationObserver: browser.MutationObserver,
  ResizeObserver: browser.ResizeObserver,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: browser.requestAnimationFrame.bind(browser),
  cancelAnimationFrame: browser.cancelAnimationFrame.bind(browser)
};
for (const [name, value] of Object.entries(names)) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
// The document's timers would keep the test process open past its last test.
after(() => browser.happyDOM.close());

/** A component in the document, and the controls a test needs on it. */
export type Mounted = {
  /** The element the component mounted into, in the document's body. */
  target: HTMLElement;
  /** Applies every pending change to the document now: Svelte's client `flushSync`. */
  flush: () => void;
  /** Takes the component and its element out of the document. */
  unmount: () => Promise<void>;
};

/**
 * The component in the .svelte file at `source`, mounted with `props` in a
 * fresh element of the document. `C` is the type of that file's own import
 * (`typeof NewSessionForm`).
 *
 * Flush through `flush`, never `flushSync` or `tick` from a static
 * `import ... from 'svelte'` at the top of the test: a static import resolves
 * before this file runs, so it gets Svelte's server entry, where `flushSync`
 * does nothing and `tick` waits for nothing. A test that needs more of
 * Svelte imports it with `await import('svelte')`, after this file.
 */
// `Component<any>` is the bound Svelte's own `ComponentProps` takes: any
// component, whatever its props, which `props` must then match.
export async function mountedForClient<C extends Component<any>>(
  source: string,
  props: ComponentProps<C>
): Promise<Mounted> {
  const svelte = await import('svelte');
  // The module is that very file, compiled, so it has the component's own type.
  const component = ((await import(pathToFileURL(source).href)) as { default: C }).default;
  const target = document.createElement('div');
  document.body.append(target);
  const shown = svelte.mount(component, { target, props });
  svelte.flushSync();
  return {
    target,
    flush: svelte.flushSync,
    unmount: async () => {
      await svelte.unmount(shown);
      target.remove();
    }
  };
}
