// The office's own database (local-db.ts) in a throwaway folder on a free port,
// with every migration, and the office tool server (src/mcp.ts) over it in a
// process of its own, as the office starts one for each run. A test file
// imports this before it loads any of the office's modules, since they read
// where everything is as they start. The database stops when the file ends, so
// the suite exits.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const folder = mkdtempSync(join(tmpdir(), 'oddboro-tool-server-'));
const port = await new Promise<number>((done) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const p = (s.address() as { port: number }).port;
    s.close(() => done(p));
  });
});
const place = {
  ODDBORO_HOME: folder,
  ODDBORO_DB_PORT: String(port),
  // A file that does not exist, so no .env reaches this office.
  ODDBORO_ENV: join(folder, 'none.env'),
  DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
  ODDBORO_LOCAL_DB: '1',
  OLLAMA_URL: 'http://127.0.0.1:9'
};
Object.assign(process.env, place);
const { startLocalDatabase } = await import('../src/local-db.ts');
const stopDatabase = await startLocalDatabase();
const { bringUpToDate } = await import('../src/upgrade.ts');
await bringUpToDate();
const { db, sql } = await import('../src/db.ts');
export { db, sql };

const clients: Client[] = [];
/** The tool server of the Odd `staffId`, started as the office starts it for a run with `env`. */
export async function toolServer(staffId: string, env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../src/mcp.ts', import.meta.url))],
      env: { PATH: process.env.PATH ?? '', ...place, STAFF_ID: staffId, ...env },
      stderr: 'ignore'
    })
  );
  clients.push(client);
  return client;
}

after(async () => {
  for (const c of clients) await c.close();
  await sql.end();
  await stopDatabase();
  rmSync(folder, { recursive: true, force: true });
});
