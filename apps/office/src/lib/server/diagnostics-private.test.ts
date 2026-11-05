// A report never carries what the owner typed, who they are, the hosts they
// connect or the folders they keep, from any field, on the server or from the
// page, and still keeps every message that comes from code. Run with
// `npm test -w @oddboro/office`.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { CODE } from '@oddboro/ledger/home';
import type { ErrorEvent } from '@sentry/core';
import type { Folders } from '#lib/diagnostics.ts';
import {
  ofType,
  PAGE,
  recorder,
  sender,
  tempOffice,
  throwing,
  traceHeader,
  until,
  type Route
} from './diagnostics-harness.ts';
// By the ledger's own path, not the package name: if the two ever loaded as
// two copies, `isFixedError` would miss this one and the message would be withheld.
import { fixedError } from '../../../../../packages/ledger/src/errors.ts';

// The plants. They stay up here: a report keeps the lines of code around each
// frame, and a line that wrote one of them would carry it to the door.
const OWNER = 'Ada Quill';
const ODD = 'Juno Brightwater';
const CHAT = 'please book the dentist for Tuesday';
const EMAIL = 'ada.quill@example.com';
const FOLDER_NAME = 'plant-folder';
const FOLDER = join(homedir(), FOLDER_NAME);
/** A tool or computer of the owner's, named after them. */
const NAS = 'ada-quill-family-nas.example';
/** Browser extension ids. Chrome's names the extension; Firefox's and Safari's are random for each install. */
const EXTENSIONS = {
  chrome: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa',
  firefox: '1b2c3d4e-5f60-4a1b-8c9d-0e1f2a3b4c5d',
  safari: 'abcdef12-3456-4789-abcd-ef0123456789'
};
/** A `blob:` URL's own id, which is all of it that may leave. */
const BLOB = '0f1e2d3c-4b5a-4968-8776-655443322110';
const PLANTS = [
  OWNER,
  ODD,
  CHAT,
  EMAIL,
  FOLDER,
  FOLDER_NAME,
  NAS,
  homedir(),
  ...Object.values(EXTENSIONS)
];
/** A page frame from each kind of URL that is not the office's. */
const OTHER_FRAMES: [string, string][] = [
  [`chrome-extension://${EXTENSIONS.chrome}/inline/injected.js`, 'injected.js'],
  [`moz-extension://${EXTENSIONS.firefox}/content/wrap.js`, 'wrap.js'],
  [`safari-web-extension://${EXTENSIONS.safari}/script.js`, 'script.js'],
  [`file://${FOLDER}/clients/x.html`, 'x.html'],
  [`blob:https://${NAS}/${BLOB}`, BLOB]
];
/** A stack whose top frame is a file in a folder of the owner's, outside Oddboro. */
const PLANTED_STACK = [
  "Error: a frame in a folder of the owner's",
  `    at plant (${join(FOLDER, 'clients', 'x.js')}:1:1)`,
  `    at own (${join(CODE, 'apps', 'office', 'src', 'own.ts')}:2:2)`,
  '    at pkg (/opt/elsewhere/node_modules/pkg/index.js:3:3)',
  '    at process.processTicksAndRejections (node:internal/process/task_queues:4:4)'
].join('\n');

const door = await recorder();
const thirdParty = await recorder();
const { folder } = tempOffice('diagnostics-private');
process.env.ODDBORO_DIAGNOSTICS_DSN = `http://oddboro@127.0.0.1:${door.port}/oddboro/0`;
await import('../../instrumentation.server.ts');
const Sentry = await import('@sentry/sveltekit');
const hooks = await import('../../hooks.server.ts');
const relayRoute = await import('../../routes/api/diagnostics/envelope/+server.ts');
const { reportPath, scrubSpan } = await import('#lib/diagnostics.ts');
const send = sender(hooks.handle);
// As the built office sets it. The SDK then writes a frame outside the build
// as `app:///` and its whole path, the shape the path rule must cut.
Object.assign(globalThis, { __sentry_sveltekit_output_dir: join(CODE, 'apps', 'office', 'build') });

after(() => {
  door.close();
  thirdParty.close();
  rmSync(folder, { recursive: true, force: true });
});

const id = (bytes: number) => randomBytes(bytes).toString('hex');

/** A page envelope with plants in every field the browser SDK could fill. */
function pageEnvelope(): string {
  const trace = id(16);
  const header = {
    event_id: id(16),
    sent_at: new Date().toISOString(),
    dsn: 'http://page@127.0.0.1/0',
    trace: { trace_id: trace, public_key: 'page', transaction: OWNER }
  };
  const planted = {
    event_id: id(16),
    platform: 'javascript',
    exception: {
      values: [
        { type: 'Error', value: ODD },
        { type: 'Error', value: CHAT }
      ]
    },
    request: { url: `http://127.0.0.1:4500/?who=${OWNER}`, headers: { 'x-who': EMAIL } },
    transaction: `/api/staff/${OWNER}`,
    contexts: { trace: { trace_id: trace, span_id: id(8), data: { who: OWNER } } },
    tags: { who: OWNER },
    user: { email: EMAIL },
    extra: { chat: CHAT },
    breadcrumbs: [{ message: CHAT }]
  };
  const kept = {
    event_id: id(16),
    platform: 'javascript',
    exception: {
      values: [
        {
          type: 'TypeError',
          value: 'renderFloor is not a function',
          stacktrace: { frames: OTHER_FRAMES.map(([url]) => ({ filename: url, abs_path: url })) }
        }
      ]
    },
    transaction: '/'
  };
  const string = (value: string) => ({ type: 'string', value });
  const spans = {
    version: 2,
    items: [
      {
        trace_id: trace,
        span_id: id(8),
        name: `GET /api/staff/${OWNER}`,
        start_timestamp: 1,
        end_timestamp: 2,
        status: 'ok',
        is_segment: true,
        attributes: {
          'sentry.segment.name.source': string('url'),
          'url.full': string(`http://127.0.0.1:4500/?email=${EMAIL}`),
          'http.route': string(`/api/staff/${OWNER}`),
          'server.address': string(`${ODD}/x`),
          'owner.chat': string(CHAT)
        }
      }
    ]
  };
  return [
    header,
    { type: 'event' },
    planted,
    { type: 'event' },
    kept,
    { type: 'span', item_count: 1, content_type: 'application/vnd.sentry.items.span.v2+json' },
    spans
  ]
    .map((x) => JSON.stringify(x))
    .join('\n');
}

/** Every form a plant could take in the door's bytes. */
function forms(bytes: string): string[] {
  const unescaped = bytes
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replaceAll('\\/', '/')
    .replaceAll('\\\\', '\\');
  const decoded = (s: string) =>
    s.replace(/(%[0-9A-Fa-f]{2})+/g, (m) => {
      try {
        return decodeURIComponent(m);
      } catch {
        // Half a character: leave it as it came.
        return m;
      }
    });
  return [bytes, unescaped, decoded(bytes), decoded(unescaped.replaceAll('+', ' '))];
}

test('a report carries no owner name, Odd name, chat line, email or home path from any field, and keeps each message that comes from code', async () => {
  process.env.OFFICE_DIAGNOSTICS = 'yes';
  Sentry.setTag('owner', OWNER);
  Sentry.setExtra('chat', CHAT);
  Sentry.setUser({ email: EMAIL, username: OWNER });
  Sentry.setContext('family', { who: ODD });
  console.log(CHAT);

  const staff = {
    route: '/api/staff/[id]',
    path: `/api/staff/${encodeURIComponent(OWNER)}?email=${EMAIL}`,
    headers: { 'x-who': EMAIL }
  };
  await send({
    ...staff,
    resolve: throwing(() => new Error(`${OWNER} asked: ${CHAT}`, { cause: new Error(ODD) }))
  });
  await send({
    ...staff,
    resolve: () => new Response(readFileSync(join(FOLDER, `${OWNER}.txt`)))
  });
  await send({
    ...staff,
    resolve: throwing(() => {
      const pg = Object.assign(new Error(`duplicate key for ${OWNER}`), {
        name: 'PostgresError',
        code: '23505',
        table_name: 'staff',
        constraint_name: 'staff_name_key',
        detail: `Key (name)=(${ODD}) already exists.`,
        parameters: [EMAIL]
      });
      return Object.assign(new Error(`Failed query: insert into staff params: ${EMAIL}`), {
        name: 'DrizzleQueryError',
        cause: pg
      });
    })
  });
  await send({
    ...staff,
    resolve: () => new Response(String((undefined as unknown as Record<string, unknown>)[OWNER]))
  });
  await send({ ...staff, resolve: throwing(() => fixedError('Diagnostics test fixed message')) });
  // A build that names its files gives each a debug id, and the report lists
  // each file that has one as a debug image.
  Object.assign(globalThis, { _sentryDebugIds: { [PLANTED_STACK]: id(16) } });
  await send({
    ...staff,
    resolve: throwing(() => Object.assign(new Error('planted frames'), { stack: PLANTED_STACK }))
  });
  Reflect.deleteProperty(globalThis, '_sentryDebugIds');
  Sentry.withIsolationScope((scope) => {
    // What the HTTP integration names a request no route matched.
    scope.setTransactionName(`GET /api/staff/${OWNER}`);
    Sentry.captureException(new Error(`${ODD} isolated`));
  });
  await send({
    ...staff,
    headers: {
      ...staff.headers,
      'sentry-trace': traceHeader(),
      baggage: `sentry-transaction=${encodeURIComponent(OWNER)},sentry-public_key=page`
    },
    resolve: async () => {
      await fetch(`http://127.0.0.1:${thirdParty.port}/${encodeURIComponent(OWNER)}?e=${EMAIL}`);
      // The same tool by its other loopback names. Nothing answers on IPv6.
      await fetch(`http://localhost:${thirdParty.port}/`).catch(() => {});
      await fetch(`http://[::1]:${thirdParty.port}/`).catch(() => {});
      // The host does not exist: only the span the request makes matters.
      await fetch(`http://${NAS}:8123/mcp?token=${EMAIL}`, { method: 'POST' }).catch(() => {});
      Sentry.getActiveSpan()?.setAttribute('owner.name', OWNER);
      Sentry.startSpan(
        { name: 'lookup', op: 'db', attributes: { 'server.address': NAS } },
        () => {}
      );
      Sentry.startSpan(
        { name: 'lookup', op: 'db', attributes: { 'server.address': `${ODD}/x` } },
        () => {}
      );
      // @ts-expect-error A name nothing defines: V8 writes it into the message from the code.
      return notDefinedAnywhere;
    }
  });
  const relayed = await send({
    route: '/api/diagnostics/envelope',
    method: 'POST',
    headers: { ...PAGE, 'content-type': 'application/x-sentry-envelope' },
    body: pageEnvelope(),
    // Typed for its own route's event, which is the one the harness builds.
    resolve: relayRoute.POST as Route
  });
  assert.equal(relayed.status, 200);
  await Sentry.flush(5000);
  await until(() => door.got.some((g) => g.body.includes('"name":"POST"')));

  assert.ok(door.got.length > 0);
  const bytes = door.got.map((g) => `${g.url}\n${JSON.stringify(g.headers)}\n${g.body}`).join('\n');
  // A loopback port names the tool listening on it.
  const tool = ['127.0.0.1', 'localhost', '[::1]'].map((host) => `${host}:${thirdParty.port}`);
  for (const form of forms(bytes))
    for (const plant of [...PLANTS, ...tool]) assert.ok(!form.includes(plant), plant);
  for (const kept of [
    'Diagnostics test fixed message',
    'notDefinedAnywhere is not defined',
    'ENOENT open',
    'SQLSTATE 23505',
    'staff_name_key',
    'table staff',
    "Cannot read properties of undefined (reading '[key]')",
    'renderFloor is not a function',
    '"transaction":"GET /api/staff/[id]"',
    '"transaction":"/"',
    '"name":"POST"',
    '"name":"GET"',
    '"filename":"app:///apps/office/src/lib/server/diagnostics-private.test.ts"',
    '"filename":"app:///apps/office/src/own.ts"',
    '"filename":"app:///node_modules/pkg/index.js"',
    '"filename":"app:///x.js"',
    '"code_file":"app:///x.js"',
    ...OTHER_FRAMES.map(([, file]) => `"filename":"${file}"`),
    '[withheld]'
  ])
    assert.ok(bytes.includes(kept), kept);
});

test('a span the rule cannot read leaves bare, never as it came', () => {
  const span = {
    trace_id: 'a'.repeat(32),
    span_id: 'b'.repeat(16),
    parent_span_id: 'c'.repeat(16),
    start_timestamp: 1,
    end_timestamp: 2,
    status: 'ok' as const,
    is_segment: false,
    name: `${OWNER} ${CHAT}`,
    get attributes(): Record<string, unknown> {
      throw new Error('unreadable');
    }
  };
  assert.deepEqual(scrubSpan(span), {
    trace_id: 'a'.repeat(32),
    span_id: 'b'.repeat(16),
    parent_span_id: 'c'.repeat(16),
    start_timestamp: 1,
    end_timestamp: 2,
    status: 'ok',
    is_segment: false,
    name: 'span',
    attributes: {}
  });
});

/** A span with the attributes given: raw on the server, `{ type, value }` from the page. */
const spanNamed = (name: string, attributes: Record<string, unknown>) => ({
  trace_id: 'a'.repeat(32),
  span_id: 'b'.repeat(16),
  start_timestamp: 1,
  end_timestamp: 2,
  status: 'ok' as const,
  is_segment: false,
  name,
  attributes
});

test('an outgoing request is named by its method alone, to the office or any other service, and no span keeps the address or port it reached', () => {
  const request = (url: string, host: string) =>
    scrubSpan(
      spanNamed(`POST ${url}`, {
        'sentry.op': 'http.client',
        'http.request.method': 'POST',
        'url.full': url,
        'server.address': host,
        'server.port': new URL(url).port
      })
    );
  for (const [url, host] of [
    // Home Assistant, Ollama and n8n on the owner's computer.
    ['http://127.0.0.1:8123/mcp_server/sse', '127.0.0.1'],
    ['http://localhost:11434/api/chat', 'localhost'],
    ['http://[::1]:5678/webhook/x', '::1'],
    // The office itself.
    ['http://127.0.0.1:4500/api/ledger', '127.0.0.1'],
    ['https://local.oddboro.com/api/ledger', 'local.oddboro.com'],
    [`http://${NAS}:8123/mcp?token=x`, NAS]
  ]) {
    const span = request(url, host);
    assert.deepEqual(
      [span.name, span.attributes],
      ['POST', { 'sentry.op': 'http.client', 'http.request.method': 'POST' }],
      url
    );
  }
  const db = (host: string) =>
    scrubSpan(
      spanNamed('select', {
        'sentry.op': 'db',
        'db.system': 'postgresql',
        'server.address': host,
        'server.port': 54329
      })
    );
  for (const host of ['127.0.0.1', NAS])
    assert.deepEqual(
      [db(host).name, db(host).attributes],
      ['db', { 'sentry.op': 'db', 'db.system': 'postgresql' }],
      host
    );
});

test("the page's own spans keep their route names, and its requests are named by their method alone", () => {
  const string = (value: string) => ({ type: 'string', value });
  const page = (name: string, attributes: Record<string, unknown>) =>
    scrubSpan(spanNamed(name, attributes));
  const load = page('/', {
    'sentry.op': string('pageload'),
    'sentry.segment.name.source': string('route')
  });
  assert.equal(load.name, '/');
  const fetched = page('GET https://local.oddboro.com/api/ledger', {
    'sentry.op': string('http.client'),
    'http.request.method': string('GET'),
    'url.full': string('https://local.oddboro.com/api/ledger'),
    'server.address': string('local.oddboro.com')
  });
  assert.equal(fetched.name, 'GET');
  assert.deepEqual(fetched.attributes, {
    'sentry.op': string('http.client'),
    'http.request.method': string('GET')
  });
});

test("a file path keeps Oddboro's own folders and a package's, and only the file name of anything else in the home folder", () => {
  const home = '/home/ada';
  const dev = { root: `${home}/git/oddboro`, home };
  const app = { root: '/Applications/Oddboro.app/Contents/Resources/server', home };
  const winHome = 'C:\\Users\\ada';
  const win = { root: `${winHome}\\AppData\\Local\\Oddboro\\server`, home: winHome };
  // As the SvelteKit SDK hands a Windows frame over: its drive already dropped.
  const sdkHome = '/Users/ada';
  const cases: [string, Folders, string][] = [
    [
      `${home}/git/oddboro/apps/office/build/server/index.js`,
      dev,
      'apps/office/build/server/index.js'
    ],
    [`${app.root}/apps/office/build/server/index.js`, app, 'apps/office/build/server/index.js'],
    [
      `${app.root}/node_modules/@sentry/core/build/esm/index.js`,
      app,
      'node_modules/@sentry/core/build/esm/index.js'
    ],
    [`${home}/.npm-global/lib/node_modules/pkg/index.js`, dev, 'node_modules/pkg/index.js'],
    [`${home}/${FOLDER_NAME}/clients/x.js`, dev, 'x.js'],
    [
      `${winHome.replaceAll('\\', '/')}/AppData/Local/Oddboro/server/apps/office/build/server/index.js`,
      win,
      'apps/office/build/server/index.js'
    ],
    [`${winHome}\\${FOLDER_NAME}\\clients\\x.js`, win, 'x.js'],
    [
      `${sdkHome}/AppData/Local/Oddboro/server/packages/ledger/src/db.ts`,
      win,
      'packages/ledger/src/db.ts'
    ],
    [`${sdkHome}/${FOLDER_NAME}/x.js`, win, 'x.js'],
    ['/usr/lib/libgtk-3.so.0', dev, '/usr/lib/libgtk-3.so.0'],
    [
      '/Applications/Oddboro.app/Contents/MacOS/oddboro',
      dev,
      '/Applications/Oddboro.app/Contents/MacOS/oddboro'
    ],
    ['node:internal/process/task_queues', dev, 'node:internal/process/task_queues'],
    ['<anonymous>', dev, '<anonymous>'],
    [`${home}/x.js`, { home: '/' }, `${home}/x.js`]
  ];
  for (const [path, folders, want] of cases) assert.equal(reportPath(path, folders), want, path);
});

/**
 * The frames of a page report with a frame from each of `urls`, as the door
 * gets them once the relay passes the report on, reached on `origin`.
 */
async function relayedFrames(origin: string, urls: string[]): Promise<unknown[][]> {
  const eventId = id(16);
  const envelope = [
    { event_id: eventId, sent_at: new Date().toISOString(), dsn: 'http://page@127.0.0.1/0' },
    { type: 'event' },
    {
      event_id: eventId,
      platform: 'javascript',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'renderFloor is not a function',
            stacktrace: { frames: urls.map((url) => ({ filename: url, abs_path: url, lineno: 1 })) }
          }
        ]
      }
    }
  ]
    .map((x) => JSON.stringify(x))
    .join('\n');
  const relayed = await send({
    origin,
    route: '/api/diagnostics/envelope',
    method: 'POST',
    headers: { ...PAGE, origin, 'content-type': 'application/x-sentry-envelope' },
    body: envelope,
    resolve: relayRoute.POST as Route
  });
  assert.equal(relayed.status, 200);
  const sent = () =>
    ofType(door.got, 'event')
      .map(([, payload]) => payload as ErrorEvent)
      .find((e) => e.event_id === eventId);
  await until(() => sent() !== undefined);
  return (sent()?.exception?.values?.[0].stacktrace?.frames ?? []).map((f) => [
    f.filename,
    f.abs_path
  ]);
}

test("a page frame keeps the path of the office's own code files, whether the office sees its own URL as http or https, and only the file name of a script from another loopback port, any other host, a browser extension, a file or a blob", async () => {
  process.env.OFFICE_DIAGNOSTICS = 'yes';
  const loopback = 'http://127.0.0.1:4500';
  const named = 'https://local.oddboro.com';
  const own = `${loopback}/_app/immutable/chunks/floor.js`;
  const ownNamed = `${named}/_app/immutable/entry/app.js`;
  // Each URL, then what leaves when the page reached the office on `loopback`, and on `named`.
  const cases: [url: string, onLoopback: string, onNamed: string][] = [
    [own, own, 'floor.js'],
    [ownNamed, ownNamed, ownNamed],
    [`${loopback}/staff/7`, loopback, '7'],
    [`${named}/staff/${OWNER}`, named, named],
    ['http://127.0.0.1:11434/x.js', 'x.js', 'x.js'],
    ['http://localhost:5678/static/y.js', 'y.js', 'y.js'],
    ['http://localhost:4500/_app/immutable/chunks/z.js', 'z.js', 'z.js'],
    ['https://local.oddboro.com:11434/w.js', 'w.js', 'w.js'],
    [`blob:${loopback}/${BLOB}`, BLOB, BLOB],
    [`https://${NAS}/scripts/helper.js?who=${EMAIL}`, 'helper.js', 'helper.js'],
    ...OTHER_FRAMES.map(([url, file]): [string, string, string] => [url, file, file]),
    ['node:fs', 'node:fs', 'node:fs'],
    ['C:\\x\\y.js', 'C:\\x\\y.js', 'C:\\x\\y.js']
  ];
  const urls = cases.map(([url]) => url);
  assert.deepEqual(
    await relayedFrames(loopback, urls),
    cases.map(([, want]) => [want, want])
  );
  assert.deepEqual(
    await relayedFrames(named, urls),
    cases.map(([, , want]) => [want, want])
  );
  // The built office names its own URL https, while the desktop window loads
  // the page over http: the frames are the same as on `loopback`.
  assert.deepEqual(
    await relayedFrames('https://127.0.0.1:4500', urls),
    cases.map(([, want]) => [want, want])
  );
});
