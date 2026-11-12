import {
  hasOwnerKey,
  isExceptionPath,
  isOwnerKey,
  notTheOwner,
  OWNER_PARAM
} from '@oddboro/ledger/owner-key';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { ownerKeyAtStart } from './src/lib/server/owner-key-start.ts';

/** The repository's root folder, where every uploaded map's sources start. */
const REPO = fileURLToPath(new URL('../..', import.meta.url));

/**
 * One source of a map as Sentry gets it: relative to the repository, with
 * forward slashes, such as `apps/office/src/routes/+page.svelte`. Every
 * release job builds the same code, so the same file gets the same debug id
 * on every system, and whichever job's upload Sentry keeps must name its
 * sources the same way. Sentry's own default resolves each source against
 * the build's working folder, not the map's, and keeps the system's
 * separator, so a Windows job uploaded `..\..\src\...`. `paths` is
 * `node:path`, or `path.win32` in a test.
 */
export function mapSource(source: string, mapDir: string, root = REPO, paths = path): string {
  return paths.relative(root, paths.resolve(mapDir, source)).split(paths.sep).join('/');
}

/**
 * Sentry's build plugin. It uploads the office's source maps only when the
 * release build holds SENTRY_AUTH_TOKEN (SENTRY_ORG and SENTRY_PROJECT come
 * from the environment too); without one it makes no request at all. It never
 * reports the build itself, and wraps nothing at build time: the office sets
 * Sentry up by hand (src/instrumentation.server.ts, src/hooks.*.ts).
 */
export function buildOptions(env: NodeJS.ProcessEnv) {
  return {
    autoInstrument: false,
    buildTimeInstrumentation: false,
    telemetry: false,
    autoUploadSourceMaps: !!env.SENTRY_AUTH_TOKEN,
    // Maps match by debug id. Injecting a release would stamp the page with
    // the git hash, which matches no server release (oddboro@<version>). With
    // no release made, nothing may finalize it or set its commits either:
    // each would ask Sentry for a release that is not there (404).
    release: { create: false, finalize: false, setCommits: false as const, inject: false },
    sourcemaps: {
      rewriteSources: (source: string, _map: unknown, context?: { mapDir: string }) =>
        context ? mapSource(source, context.mapDir) : source
    }
  };
}

/**
 * A request's target split once, at its first `?`: the path is the raw text
 * before it, and the key is the owner's parameter in the query after it. Vite
 * and Kit's dev handler route on that raw text, so the guard reads exactly
 * it. A URL parse reads `//x/api/gateway/notes` as host `x`, and a decode
 * turns `%5c` into a Windows folder separator after the guard has passed it.
 */
function target(raw: string): { path: string; key: string | null } {
  const at = raw.indexOf('?');
  if (at === -1) return { path: raw, key: null };
  return { path: raw.slice(0, at), key: new URLSearchParams(raw.slice(at + 1)).get(OWNER_PARAM) };
}

/**
 * The owner's key rule at the dev server's door, the same one the office's
 * `guardOffice` keeps: a request goes on with the key in its cookie, with the
 * right key in its address (the office then sets the cookie), or to an exact
 * exception route, whose own proof the office checks after. Anything else gets
 * the office's refusal. A wrong key in the address is refused like no key.
 */
export function ownerOnlyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): void {
  const { path, key } = target(req.url ?? '');
  if (hasOwnerKey(req.headers.cookie ?? null) || isOwnerKey(key) || isExceptionPath(path)) {
    next();
    return;
  }
  const { status, type, body } = notTheOwner(path);
  res.statusCode = status;
  res.setHeader('content-type', type);
  res.end(body);
}

/**
 * In dev, Vite answers many requests before the office's own check runs:
 * `/@fs/<any file>`, `/@vite/client`, the project's files, and live reload.
 * So this plugin, the first, applies the owner's key rule ahead of all of them.
 */
export function ownerOnly(): Plugin {
  return {
    name: 'oddboro:owner-only',
    apply: 'serve',
    configureServer(server) {
      // Kit runs the office's init(), which makes the key, only inside its
      // request handler, on the first request. This guard refuses a request
      // without the key before Kit sees it, so without this call nothing in
      // dev makes the key, and the app's shell, which reads the key file once
      // the office answers, would open on the refusal page. A key file it
      // cannot use stops the start with one sentence saying what to do.
      ownerKeyAtStart();
      // Vite adds its live-reload upgrade listener when it makes the server,
      // before this hook runs. A listener added with `on` would run after
      // Vite's, which has already sent its 101 by then, so this one goes
      // first and closes an upgrade without the key.
      server.httpServer?.prependListener('upgrade', (req: IncomingMessage, socket: Duplex) => {
        if (!hasOwnerKey(req.headers.cookie ?? null)) socket.destroy();
      });
      // Middleware added here runs before Vite's file, module and page middleware.
      server.middlewares.use(ownerOnlyMiddleware);
    }
  };
}

/**
 * Vite's dev server has a route, `/__open-in-editor`, that opens a file in an
 * editor, and it runs before the office's own check (`guardOffice`). Nothing
 * in the office uses it; only Vite's error overlay links there. So it is
 * refused outright, rather than through the office's check, which would bring
 * the server's modules into this config.
 */
export function noEditorLaunch(): Plugin {
  return {
    name: 'oddboro:no-editor-launch',
    apply: 'serve',
    // Middleware added here runs before Vite's own, its editor route included.
    configureServer(server) {
      server.middlewares.use('/__open-in-editor', (_req, res) => {
        res.statusCode = 403;
        res.end('The office opens no editor');
      });
    }
  };
}

/**
 * Where the office links to the public site's guides (`lib/site.ts`). A
 * developer's `npm run dev` starts the site beside the office, so it links to
 * the site's dev server on 4501. Everything else links to oddboro.com: a
 * build, and the office `npm run setup` keeps running from source, which
 * starts Vite itself rather than through npm. ODDBORO_SITE_URL overrides both.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  if (env.ODDBORO_SITE_URL) return env.ODDBORO_SITE_URL.replace(/\/+$/, '');
  return env.npm_lifecycle_event === 'dev' ? 'http://localhost:4501' : 'https://oddboro.com';
}

// Port 4500 unless ODDBORO_PORT says otherwise, to run a second office beside
// the owner's. A build leaves the workspace packages out: they find their own
// files (migrations, sprites, rooms) beside their code, so a release ships them
// whole (apps/desktop/scripts/stage.ts). In dev Vite keeps loading them, so
// they reload on save.
const port = Number(process.env.ODDBORO_PORT) || 4500;
export default defineConfig(({ command }) => ({
  // Sentry's plugin goes before SvelteKit's, as Sentry's setup asks.
  plugins: [
    ownerOnly(),
    noEditorLaunch(),
    tailwindcss(),
    sentrySvelteKit(buildOptions(process.env)),
    sveltekit({ adapter: adapter() })
  ],
  define: { __SITE_URL__: JSON.stringify(siteUrl()) },
  // The office's addresses through Caddy (lib/server/address.ts).
  server: {
    port,
    strictPort: true,
    host: '127.0.0.1',
    allowedHosts: ['local.oddboro.com', 'oddboro.localhost']
  },
  // Rolldown, not ssr.external: this keeps a workspace package and its subpaths
  // out of the server build. The adapter also leaves out whatever package.json
  // lists under dependencies, so the office lists only the workspace packages
  // there, and every third-party package under devDependencies, which bundles
  // it: the app then ships none of them (issue #13). Sentry is the exception:
  // it stays under dependencies, since its tracing hooks modules as they load.
  environments:
    command === 'build'
      ? { ssr: { build: { rolldownOptions: { external: [/^@oddboro\//] } } } }
      : undefined,
  preview: { port, strictPort: true }
}));
