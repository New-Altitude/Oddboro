// Test-only: the sign-in and persona tests import it, and no office module
// does. A stand-in for New Altitude's sign-in, on 127.0.0.1 only: the members'
// site documents, the OAuth server (registration, PKCE codes, rotating refresh
// tokens that keep the scope they were granted with, revoke), `/api/me`, the
// personas with an Odd (`/api/personas/odds`), each persona door's own
// document, and the door itself (`POST /<slug>/stream`), which answers with
// whatever body a test sets. It records every request. Its name does not
// end in .test.ts, so `npm test` never runs it as a test. For a hand check,
// start it alone: node -e "import('<this file>').then((m) => m.fakeNewAltitude(4598))"
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse
} from 'node:http';

export type Seen = { method: string; path: string; headers: IncomingHttpHeaders; body: string };

/** Who the fake says signed in. `image` is sent, as New Altitude sends it, and never kept. */
export const MEMBER = {
  id: 'member-1',
  name: 'Ada Member',
  email: 'ada@example.test',
  image: 'https://example.test/ada.png'
};

/** The made-up persona `pat`, as `/api/personas/odds` lists it. */
export const PAT = JSON.parse(
  readFileSync(new URL('./fixtures/persona-pat.json', import.meta.url), 'utf8')
) as Record<string, unknown>;

/** The conversation the fake's door says a turn ran in, whatever the office claimed. */
export const DOOR_SESSION = '7d2e4b1a-9c3f-4e5d-8a6b-2c1d0e9f8a7b';

/** More scopes than the office asks for, so a test sees the SDK asked for fewer. */
const SITE_SCOPES = ['profile', 'personas', 'other.read', 'other.write'];

/** Each way the fake loses an answer after acting on the request, with the code Node 24 gives fetch for it. */
export const LOST_ANSWERS = [
  ['lose', 'UND_ERR_SOCKET'],
  ['reset', 'ECONNRESET']
] as const;

export type FakeNewAltitude = {
  origin: string;
  /** Every request, in order. */
  seen: Seen[];
  /** How long the next tokens last, in seconds. */
  expiresIn: number;
  /** The OAuth error the next refresh gets instead of new tokens. */
  refuseNextRefresh?: { error: string; error_description?: string };
  /** Paths whose requests get no answer: the connection drops, as with a server that is down. */
  down: Set<string>;
  /** Paths answered with this status and an error instead of their usual answer. */
  refused: Map<string, number>;
  /** Paths that answer 500, as a server with a fault does. */
  failing: Set<string>;
  /** Paths whose next request the fake acts on, then drops the connection: the answer is lost. */
  lose: Set<string>;
  /** As `lose`, but the connection is reset, so fetch fails with ECONNRESET. */
  reset: Set<string>;
  /** Hold the next request to `path` until the returned function is called. */
  hold(path: string): Promise<() => void>;
  /** A connector's sign-in, as if it had finished here: its refresh token is live. */
  issue(refresh: string): void;
  /** A sign-in made earlier with `scope`, as if it had finished here: both tokens are live. */
  issueGrant(access: string, refresh: string, scope: string): void;
  /** What `/api/personas/odds` lists for a token that holds `personas`; `pat` until a test sets it. */
  odds: unknown[];
  /** The settled body a persona's door answers a turn with; an answered turn until a test sets it. */
  door: Record<string, unknown>;
  close(): Promise<void>;
};

export async function fakeNewAltitude(port = 0): Promise<FakeNewAltitude> {
  let n = 0;
  /** Each code's PKCE challenge and the scope it was asked with. */
  const challenges = new Map<string, { challenge: string; scope: string }>();
  /** Each live token, to the scope of its grant. */
  const access = new Map<string, string>();
  const refresh = new Map<string, string>();
  const waiting = new Map<string, (release: () => void) => void>();
  /** Answers to drop instead of send (`lose`, `reset`), and how the socket goes. */
  const losing = new WeakMap<ServerResponse, 'destroy' | 'resetAndDestroy'>();

  const fake: FakeNewAltitude = {
    origin: '',
    seen: [],
    expiresIn: 3600,
    down: new Set(),
    refused: new Map(),
    failing: new Set(),
    lose: new Set(),
    reset: new Set(),
    hold: (path) => new Promise((ready) => waiting.set(path, ready)),
    issue: (token) => void refresh.set(token, ''),
    issueGrant: (a, r, scope) => {
      access.set(a, scope);
      refresh.set(r, scope);
    },
    odds: [PAT],
    door: {
      outcome: 'answered',
      frame: 'From what my hands found:',
      reply: 'Ship it on Friday.',
      caveat: 'This is my view, not advice.',
      answer: { sessionId: DOOR_SESSION, turnIndex: 0 }
    },
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      })
  };

  function tokens(res: ServerResponse, scope: string) {
    n++;
    access.set(`access-${n}`, scope);
    refresh.set(`refresh-${n}`, scope);
    send(res, 200, {
      access_token: `access-${n}`,
      refresh_token: `refresh-${n}`,
      token_type: 'Bearer',
      expires_in: fake.expiresIn,
      scope
    });
  }
  /** The scope of the live access token a request carries, or undefined. */
  const bearerScope = (req: IncomingMessage) =>
    access.get(req.headers.authorization?.replace(/^Bearer /, '') ?? '');

  function send(res: ServerResponse, status: number, body: unknown) {
    const drop = losing.get(res);
    if (drop) return void res.socket?.[drop]();
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }

  async function answer(req: IncomingMessage, res: ServerResponse, path: string, body: string) {
    const url = new URL(req.url ?? '/', fake.origin);
    const form = new URLSearchParams(body);
    if (path === '/.well-known/oauth-protected-resource')
      return send(res, 200, {
        // Another origin on purpose: the office must send the configured site.
        resource: 'https://other.example',
        authorization_servers: [fake.origin],
        bearer_methods_supported: ['header'],
        scopes_supported: SITE_SCOPES
      });
    if (path === '/.well-known/oauth-authorization-server')
      return send(res, 200, {
        issuer: fake.origin,
        authorization_endpoint: `${fake.origin}/authorize`,
        token_endpoint: `${fake.origin}/token`,
        registration_endpoint: `${fake.origin}/register`,
        revocation_endpoint: `${fake.origin}/revoke`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['other.admin', ...SITE_SCOPES]
      });
    if (path === '/register' && req.method === 'POST')
      return send(res, 201, { ...JSON.parse(body), client_id: 'client-1' });
    if (path === '/authorize') {
      // Signs in at once and sends the browser back, as a member who is already signed in sees.
      const code = `code-${challenges.size + 1}`;
      challenges.set(code, {
        challenge: url.searchParams.get('code_challenge') ?? '',
        scope: url.searchParams.get('scope') ?? ''
      });
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (path === '/token' && req.method === 'POST') {
      if (form.get('grant_type') === 'authorization_code') {
        const asked = challenges.get(form.get('code') ?? '');
        challenges.delete(form.get('code') ?? '');
        const proof = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (!asked || proof !== asked.challenge) return send(res, 400, { error: 'invalid_grant' });
        return tokens(res, asked.scope);
      }
      const token = form.get('refresh_token') ?? '';
      const refused = fake.refuseNextRefresh;
      fake.refuseNextRefresh = undefined;
      const granted = refresh.get(token);
      // A refresh token works once; a second use is refused, as New Altitude does.
      if (refused || granted === undefined || !refresh.delete(token))
        return send(res, 400, refused ?? { error: 'invalid_grant' });
      // A refresh may narrow its grant's scope, never widen it; with none it keeps the grant's.
      const want = form.get('scope');
      if (want && !want.split(' ').every((w) => granted.split(' ').includes(w)))
        return send(res, 400, { error: 'invalid_scope' });
      return tokens(res, want ?? granted);
    }
    if (path === '/revoke' && req.method === 'POST') {
      refresh.delete(form.get('token') ?? '');
      return send(res, 200, {});
    }
    if (path === '/api/me') {
      if (bearerScope(req) === undefined) return send(res, 401, { error: 'invalid_token' });
      return send(res, 200, MEMBER);
    }
    if (path === '/api/personas/odds') {
      if (!bearerScope(req)?.split(' ').includes('personas'))
        return send(res, 401, { error: 'invalid_token' });
      return send(res, 200, { odds: fake.odds });
    }
    // Each persona door's own document echoes the door asked for, as New Altitude's does.
    const door = /^\/\.well-known\/oauth-protected-resource(\/[a-z0-9-]+\/stream)$/.exec(path);
    if (door)
      return send(res, 200, {
        resource: `${fake.origin}${door[1]}`,
        authorization_servers: [fake.origin],
        bearer_methods_supported: ['header'],
        scopes_supported: ['stream']
      });
    if (/^\/[a-z0-9-]+\/stream$/.test(path) && req.method === 'POST') {
      if (!bearerScope(req)?.split(' ').includes('stream'))
        return send(res, 401, { error: 'invalid_token' });
      // As a turn past the door's keep-alive point answers: spaces, then the JSON.
      res.writeHead(200, { 'content-type': 'application/json' });
      return void res.end(`  ${JSON.stringify(fake.door)}`);
    }
    send(res, 404, { error: 'not_found' });
  }

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', async () => {
      const path = new URL(req.url ?? '/', 'http://fake').pathname;
      const body = Buffer.concat(chunks).toString('utf8');
      fake.seen.push({ method: req.method ?? '', path, headers: req.headers, body });
      if (fake.down.has(path)) return void req.socket.destroy();
      const refused = fake.refused.get(path);
      if (refused) return send(res, refused, { error: 'refused' });
      if (fake.failing.has(path)) return send(res, 500, { error: 'server_error' });
      if (fake.lose.delete(path)) losing.set(res, 'destroy');
      if (fake.reset.delete(path)) losing.set(res, 'resetAndDestroy');
      const ready = waiting.get(path);
      if (ready) {
        waiting.delete(path);
        await new Promise<void>((release) => ready(release));
      }
      await answer(req, res, path, body);
    });
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  fake.origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return fake;
}
