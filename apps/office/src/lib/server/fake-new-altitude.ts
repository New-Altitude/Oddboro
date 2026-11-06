// Test-only: the sign-in tests import it, and no office module does. A
// stand-in for New Altitude's sign-in, on 127.0.0.1 only: the members' site
// documents, the OAuth server (registration, PKCE codes, rotating refresh
// tokens, revoke) and `/api/me`. It records every request. Its name does not
// end in .test.ts, so `npm test` never runs it as a test. For a hand check,
// start it alone: node -e "import('<this file>').then((m) => m.fakeNewAltitude(4598))"
import { createHash } from 'node:crypto';
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

/** More scopes than `profile`, so a test sees the SDK asked for fewer. */
const SITE_SCOPES = ['profile', 'other.read', 'other.write'];

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
  close(): Promise<void>;
};

export async function fakeNewAltitude(port = 0): Promise<FakeNewAltitude> {
  let n = 0;
  const challenges = new Map<string, string>();
  const access = new Set<string>();
  const refresh = new Set<string>();
  const waiting = new Map<string, (release: () => void) => void>();
  /** Answers to drop instead of send (`lose`, `reset`), and how the socket goes. */
  const losing = new WeakMap<ServerResponse, 'destroy' | 'resetAndDestroy'>();

  const fake: FakeNewAltitude = {
    origin: '',
    seen: [],
    expiresIn: 3600,
    down: new Set(),
    failing: new Set(),
    lose: new Set(),
    reset: new Set(),
    hold: (path) => new Promise((ready) => waiting.set(path, ready)),
    issue: (token) => void refresh.add(token),
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      })
  };

  function tokens(res: ServerResponse) {
    n++;
    access.add(`access-${n}`);
    refresh.add(`refresh-${n}`);
    send(res, 200, {
      access_token: `access-${n}`,
      refresh_token: `refresh-${n}`,
      token_type: 'Bearer',
      expires_in: fake.expiresIn,
      scope: 'profile'
    });
  }

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
      challenges.set(code, url.searchParams.get('code_challenge') ?? '');
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { location: back.toString() }).end();
      return;
    }
    if (path === '/token' && req.method === 'POST') {
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = challenges.get(form.get('code') ?? '');
        challenges.delete(form.get('code') ?? '');
        const proof = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url');
        if (!challenge || proof !== challenge) return send(res, 400, { error: 'invalid_grant' });
        return tokens(res);
      }
      const token = form.get('refresh_token') ?? '';
      const refused = fake.refuseNextRefresh;
      fake.refuseNextRefresh = undefined;
      // A refresh token works once; a second use is refused, as New Altitude does.
      if (refused || !refresh.delete(token))
        return send(res, 400, refused ?? { error: 'invalid_grant' });
      return tokens(res);
    }
    if (path === '/revoke' && req.method === 'POST') {
      refresh.delete(form.get('token') ?? '');
      return send(res, 200, {});
    }
    if (path === '/api/me') {
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
      if (!access.has(token)) return send(res, 401, { error: 'invalid_token' });
      return send(res, 200, MEMBER);
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
