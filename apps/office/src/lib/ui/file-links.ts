// Which file names in an Odd's text lead somewhere, for `Markdown.svelte`. One
// map for the page: each name is asked about once, so a re-render or the same
// name in another message asks nothing new. It is not refreshed, so a file
// written after its name was first shown stays unlinked until the page reloads.
import { SvelteMap } from 'svelte/reactivity';
import { call } from './api.ts';
import type { FileRef } from './windows.svelte.ts';

const keyOf = (f: FileRef): string => `${f.staff}:${f.path}`;
const answers = new SvelteMap<string, string | null>();
const asked = new Set<string>();

/**
 * A name as written, with any %-escapes turned back into characters. Text that
 * is not valid escaping (like "100%" in a CSS snippet) stays as it is, since
 * decodeURI throws on it and a throw here takes the whole page down.
 */
export function plainName(text: string): string {
  const t = text.trim();
  try {
    return decodeURI(t);
  } catch {
    return t;
  }
}

/** The path a name opens by, null when it opens nothing, undefined until the office says. */
export const openedAs = (f: FileRef): string | null | undefined => answers.get(keyOf(f));

/** Ask the office, in one call, about the names nobody has asked about yet. */
export function askAbout(names: FileRef[]): Promise<void> {
  const fresh = new Map<string, FileRef>();
  for (const f of names) if (!asked.has(keyOf(f))) fresh.set(keyOf(f), f);
  if (!fresh.size) return Promise.resolve();
  for (const key of fresh.keys()) asked.add(key);
  const files = [...fresh.values()];
  return call<(string | null)[]>('/api/files/resolve', { files }).then(
    (paths) => files.forEach((f, i) => answers.set(keyOf(f), paths[i] ?? null)),
    (e: unknown) => {
      // Shown unlinked rather than as links that may lead nowhere.
      console.error('Could not check which files exist:', e);
      for (const f of files) answers.set(keyOf(f), null);
    }
  );
}
