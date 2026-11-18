// A Svelte component compiled for the server, so a test renders it as the
// page would show it, with `render` from svelte/server. Tests only.
import { pathToFileURL } from 'node:url';
import { svelteUnderNode } from './svelte-under-node.ts';

/**
 * The component in the .svelte file at `source`, compiled with every
 * component, `.svelte.ts` module and stylesheet it imports. `C` is the type of
 * that file's own import (`typeof NotifyHelp`).
 */
export async function compiledForServer<C>(source: string): Promise<C> {
  svelteUnderNode('server');
  // The module is that very file, compiled, so it has the component's own type.
  return ((await import(pathToFileURL(source).href)) as { default: C }).default;
}
