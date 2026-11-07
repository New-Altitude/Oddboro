// Synthetic local service for Magpie ownership tests. It never contacts a provider.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const args = process.argv.slice(2);
const address = args[args.indexOf('--addr') + 1];
const data = args[args.indexOf('--data-dir') + 1];
const gatewayAddress = process.env.MAGPIE_ADDR || '';
const fixture = JSON.parse(readFileSync(join(dirname(process.argv[1]), 'fixture.json'), 'utf8'));
writeFileSync(
  join(data, 'fixture-process.json'),
  JSON.stringify({ pid: process.pid, args, inherited: !!process.env.AWS_SECRET_ACCESS_KEY })
);
const identity = {
  app: 'magpie',
  apiVersion: 1,
  version: fixture.wrongVersion ? 'wrong-version' : 'fixture-1',
  embedded: true,
  instanceId: process.env.MAGPIE_EMBEDDED_INSTANCE_ID,
  capabilities: ['providers', 'groups', ...(fixture.capabilities || [])]
};
const gateway = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.MAGPIE_EMBEDDED_GATEWAY_KEY}`)
    return response.writeHead(401).end();
  response.setHeader('Content-Type', 'application/json');
  response.end(
    JSON.stringify({ ...identity, ...(fixture.wrongNonce ? { instanceId: 'wrong' } : {}) })
  );
});
let signedIn = false;
const web = createServer(async (request, response) => {
  if (
    request.headers.cookie !==
    `magpie_web_${address.split(':').at(-1)}=${process.env.MAGPIE_WEB_KEY}`
  )
    return response.writeHead(403).end();
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/api/integration/discovery')
    return response.end(
      JSON.stringify({
        sources: [
          {
            source: 'codex-file',
            ref: '/synthetic/private/codex-home',
            user: 'fixture@example.invalid',
            plan: 'test'
          }
        ]
      })
    );
  if (request.url === '/api/integration/discovery/select') {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    writeFileSync(join(data, 'selected-source.json'), JSON.stringify(body));
    return response.end(JSON.stringify({ ok: true }));
  }
  if (request.url === '/api/signin')
    return response.end(
      JSON.stringify({
        id: 'codex-fixture',
        agent: 'codex',
        state: 'waiting',
        url: 'https://login.example.invalid/synthetic'
      })
    );
  if (request.url === '/api/signin/codex-fixture/callback') {
    signedIn = true;
    return response.writeHead(204).end();
  }
  if (request.url === '/api/signin/codex-fixture/cancel') return response.writeHead(204).end();
  if (request.url === '/api/signin/codex-fixture')
    return response.end(
      JSON.stringify({ id: 'codex-fixture', agent: 'codex', state: signedIn ? 'done' : 'waiting' })
    );
  if (request.url === '/api/integration') return response.end(JSON.stringify(identity));
  if (request.url === '/api/groups')
    return response.end(
      JSON.stringify({
        groups: [],
        models: [{ id: 'fixture/one', name: 'One', provider: 'fixture' }]
      })
    );
  response.end(
    JSON.stringify({
      providers: [
        {
          id: 'fixture',
          name: 'Fixture',
          ready: true,
          off: false,
          models: [{ id: 'one', name: 'One', on: true }],
          key: { set: true }
        }
      ],
      presets: [],
      plugins: [],
      gateway: {
        running: true,
        mine: true,
        pid: process.pid,
        url: `http://${process.env.MAGPIE_ADDR}`,
        calls: []
      }
    })
  );
});
gateway.listen(Number(gatewayAddress.split(':').at(-1)), '127.0.0.1', () =>
  web.listen(Number(address.split(':').at(-1)), '127.0.0.1')
);
process.on('SIGTERM', () => {
  web.close();
  gateway.close();
  process.exit(0);
});

process.stdin.resume();
process.stdin.on('end', () => {
  web.close();
  gateway.close();
  process.exit(0);
});
