// Hard rule 4: nothing leaves the office without the owner's yes. Each call the
// office's own code makes in its own process, by a name counted here, is
// declared in scripts/outbound.ts with whose yes covers it. Fails when a file's
// calls differ from its entry, when an entry's file has none, and when no call
// is found at all (nothing to check).
//
// It counts, with comments taken out: `fetch(`, `navigator.sendBeacon(`, the
// connector transports, `WebSocket`, `EventSource` and `XMLHttpRequest` as
// each is made, the AWS SDK's clients the office signs in with as each is made
// (their sends go through a variable), `Sentry.init(`, and each function and class in `NET_MODULES`
// (those that open a connection from Node's http, https, http2, tls and net
// modules, every lookup in `dns` and `dns/promises`, and undici's `request`,
// `fetch`, `stream`, `pipeline`, `connect`, `upgrade`, `Client` and `Pool`)
// as it is made (a `net.Socket` counts where it is made, not where it
// connects), however the file imports the module (named, default or `* as`). In the desktop app: the
// updater, `reqwest` and Sentry. It matches names in text because the guards
// take no dependencies, so it does not count:
// - child processes, such as `npm install -g`, `grok update --check` and each
//   AI tool's run, which sends the owner's words to that tool's maker;
// - what the desktop updater does after `updater_builder`;
// - a module loaded with `require` or `import()`;
// - a call through `dns.promises`, or through a name a counted one was copied to;
// - `dgram` `createSocket().send`, undici `Agent().request`, `new http.ClientRequest`
//   and `new tls.TLSSocket`, which are not in `NET_MODULES`;
// - what markup loads, such as `<img src="https://...">` in a `.svelte` file;
// - a library's own calls that start from a name not listed here.
import { read, repoFiles, report, withoutComments } from './lib/files.ts';
import { OUTBOUND } from './outbound.ts';

const OFFICE = /^(apps\/office\/src\/.+\.(ts|svelte)|packages\/[^/]+\/src\/.+\.ts)$/;
const DESKTOP = /^apps\/desktop\/src-tauri\/src\/.+\.rs$/;

// `fetch(` not after a dot or a name, so `globalThis.fetch(` counts once.
const TS_CALLS =
  /(?<![.\w$])fetch\s*\(|\b(?:globalThis|window|self)\.fetch\s*\(|\bnavigator\.sendBeacon\s*\(|\bnew\s+(?:StreamableHTTPClientTransport|SSEClientTransport|WebSocket|EventSource|XMLHttpRequest)\s*\(|\bnew\s+(?:SSOOIDCClient|SSOClient|SecretsManagerClient)\s*\(|\bSentry\.init\s*\(/
    .source;
const RS_CALLS = /\bsentry::init\(|\breqwest::|\.updater_builder\(|\.updater\s*\(/g;

const DNS = [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTlsa',
  'resolveTxt',
  'reverse'
];
/**
 * The modules that reach the network: on each, the functions that open a
 * connection or ask a name server (`calls`), and the classes that do once
 * made (`makes`), whose later calls on a variable the text cannot follow.
 */
const NET_MODULES: Record<string, { calls: string[]; makes: string[] }> = {
  http: { calls: ['request', 'get'], makes: [] },
  https: { calls: ['request', 'get'], makes: [] },
  http2: { calls: ['connect'], makes: [] },
  tls: { calls: ['connect'], makes: [] },
  net: { calls: ['connect', 'createConnection'], makes: ['Socket'] },
  dns: { calls: DNS, makes: ['Resolver'] },
  'dns/promises': { calls: DNS, makes: ['Resolver'] },
  undici: {
    calls: ['request', 'fetch', 'stream', 'pipeline', 'connect', 'upgrade'],
    makes: ['Client', 'Pool']
  }
};
const NET_IMPORT = new RegExp(
  `\\bimport\\s+(?!type\\s)([^'";]*?)\\s*from\\s*['"](?:node:)?(${Object.keys(NET_MODULES).join('|')})['"]`,
  'g'
);

/**
 * The calls a file makes through the modules in `NET_MODULES`, as patterns: a
 * default or `* as` import's name before `.request(` or after `new` before
 * `.Socket(` and the like, and a named import's own local name, such as
 * `request(`, `tlsConnect(` or `new Socket(`.
 */
function netCalls(text: string): string[] {
  const escape = (n: string) => n.replaceAll('$', '\\$');
  return [...text.matchAll(NET_IMPORT)].flatMap(([, clause, module]) => {
    const { calls, makes } = NET_MODULES[module];
    const whole = [...clause.matchAll(/^\s*([\w$]+)\s*(?:,|$)|\*\s*as\s+([\w$]+)/g)].flatMap(
      (m) => m[1] ?? m[2] ?? []
    );
    const named = (clause.match(/\{([^}]*)\}/)?.[1] ?? '')
      .split(',')
      .map((item) => item.trim().split(/\s+as\s+/))
      .map(([name, local]) => ({ name, local: escape(local ?? name) }));
    return [
      ...whole.map((n) => `\\b${escape(n)}\\.(?:${calls.join('|')})\\s*\\(`),
      ...(makes.length
        ? whole.map((n) => `\\bnew\\s+${escape(n)}\\.(?:${makes.join('|')})\\s*\\(`)
        : []),
      ...named.flatMap(({ name, local }) =>
        calls.includes(name)
          ? [`(?<![.\\w$])${local}\\s*\\(`]
          : makes.includes(name)
            ? [`\\bnew\\s+${local}\\s*\\(`]
            : []
      )
    ];
  });
}

/**
 * A Svelte file's markup comments taken out, kept as blank lines. It reads
 * again from the start after each one, since taking out the inner comment of
 * `<!-<!-- x -->- y -->` makes another. An opener with no `-->` loses only
 * itself: Svelte refuses one in markup, so in a file that builds it is text
 * in a script, and the calls after it must still count.
 */
function withoutMarkupComments(text: string): string {
  const OPEN = '<!--';
  const CLOSE = '-->';
  for (let at = text.indexOf(OPEN); at !== -1; at = text.indexOf(OPEN)) {
    const close = text.indexOf(CLOSE, at + OPEN.length);
    const end = close === -1 ? at + OPEN.length : close + CLOSE.length;
    const newlines = text.slice(at, end).split('\n').length - 1;
    text = text.slice(0, at) + '\n'.repeat(newlines) + text.slice(end);
  }
  return text;
}

/** Each call site in the file, as `file:line`. */
function callsIn(file: string): string[] {
  let text = withoutComments(read(file));
  if (file.endsWith('.svelte')) text = withoutMarkupComments(text);
  const calls = file.endsWith('.rs')
    ? RS_CALLS
    : new RegExp([TS_CALLS, ...netCalls(text)].join('|'), 'g');
  return text
    .split('\n')
    .flatMap((line, i) => (line.match(calls) ?? []).map(() => `${file}:${i + 1}`));
}

const found = new Map<string, string[]>();
for (const file of repoFiles()) {
  if (!(OFFICE.test(file) || DESKTOP.test(file)) || file.endsWith('.test.ts')) continue;
  const sites = callsIn(file);
  if (sites.length) found.set(file, sites);
}

const failures: string[] = [];
if (!found.size) failures.push('found no outbound call anywhere: nothing to check');
for (const [file, sites] of found) {
  const entry = OUTBOUND.find((o) => o.file === file);
  if (!entry)
    failures.push(
      `${sites.join(', ')}: calls out with no entry in scripts/outbound.ts. Add one saying where it goes, what it sends and whose yes covers it.`
    );
  else if (entry.calls !== sites.length)
    failures.push(
      `${file}: has ${sites.length} outbound call(s) (${sites.join(', ')}), scripts/outbound.ts says ${entry.calls}. Update its entry.`
    );
}
for (const entry of OUTBOUND)
  if (!found.has(entry.file))
    failures.push(
      `${entry.file}: has no outbound call, but scripts/outbound.ts declares ${entry.calls}. Remove its entry.`
    );
report('outbound', failures);
