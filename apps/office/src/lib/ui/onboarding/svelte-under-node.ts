// Lets a test process import Svelte components as the app's build would, so a
// test loads a component by its own path. Tests only.
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';

/** Who the components are compiled for: the server renders HTML, the client mounts. */
export type SvelteTarget = 'client' | 'server';

let compiledFor: SvelteTarget | undefined;

/**
 * From here on, this process imports `.svelte` and `.svelte.ts` files compiled
 * for `generate`, and a `.css` import as an empty module. The client adds the
 * `browser` condition, so `svelte` itself resolves to its client entry, the one
 * with `mount`.
 *
 * Node keeps a module by its URL, so a component loaded for one target cannot
 * load for the other in the same process. A test file therefore uses one
 * target, and asking for the other throws. node --test runs each file in its
 * own process, so the hooks reach only the file that registers them.
 */
export function svelteUnderNode(generate: SvelteTarget): void {
  if (compiledFor === generate) return;
  if (compiledFor) {
    throw new Error(
      `This test process already compiles Svelte for the ${compiledFor}. A test file uses one target; put the ${generate} tests in their own file.`
    );
  }
  compiledFor = generate;
  registerHooks({
    resolve(specifier, context, next) {
      if (generate === 'server') return next(specifier, context);
      return next(specifier, {
        ...context,
        conditions: [...new Set(['browser', ...context.conditions])]
      });
    },
    load(url, context, next) {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
      if (url.endsWith('.svelte')) {
        const filename = fileURLToPath(url);
        const { js } = compile(readFileSync(filename, 'utf8'), { generate, filename });
        return { format: 'module', source: js.code, shortCircuit: true };
      }
      if (/\.svelte\.(ts|js)$/.test(url)) {
        const filename = fileURLToPath(url);
        const source = readFileSync(filename, 'utf8');
        // The module compiler reads JavaScript only, as the app's build hands
        // it a .svelte.ts file with its types already gone.
        const js = filename.endsWith('.ts') ? stripTypeScriptTypes(source) : source;
        return {
          format: 'module',
          source: compileModule(js, { generate, filename }).js.code,
          shortCircuit: true
        };
      }
      return next(url, context);
    }
  });
}
