// The office's own database (local-db.ts) in a throwaway folder, on a free
// port on Windows, with every migration, and the office tool server (src/mcp.ts) over it in a
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
/**
 * The test database's port. A port the system picks (listen on 0) comes from
 * the range it also gives outgoing connections, and the database listens only
 * later: in between, another test file's database or any connection could
 * take it, and the database's listen then kills this process (EADDRINUSE).
 * So: below every system's range for those (Linux 32768, the Mac and Windows
 * 49152), by process id, which no two test files running at once share, and
 * the next one up if something already listens there.
 */
async function databasePort(): Promise<number> {
  for (let port = 20_000 + (process.pid % 12_000); ; port = port >= 31_999 ? 20_000 : port + 1) {
    const free = await new Promise<boolean>((done) => {
      const s = createServer()
        .once('error', () => done(false))
        .listen(port, '127.0.0.1', () => s.close(() => done(true)));
    });
    if (free) return port;
  }
}
const port = await databasePort();
const place = {
  ODDBORO_HOME: folder,
  ODDBORO_DB_PORT: String(port),
  // A file that does not exist, so no .env reaches this office.
  ODDBORO_ENV: join(folder, 'none.env'),
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

// The tool servers close together: a file can start over 60, and each close
// may wait up to 4 seconds for its server to end. The cleanup has a limit of its
// own, since a slow runner took it past the 15 seconds each test gets.
after(
  async () => {
    await Promise.all(clients.map((c) => c.close()));
    await sql.end();
    await stopDatabase();
    rmSync(folder, { recursive: true, force: true });
  },
  { timeout: 60_000 }
);
