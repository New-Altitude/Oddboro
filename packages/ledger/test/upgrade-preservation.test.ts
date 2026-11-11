// Upgrade an already populated 0.0.10 office through the real startup path,
// then restart twice. The old rows and files must not be recreated or edited.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { fileHashes, releaseDatabase, sameReleasedRows, snapshot } from './upgrade-copy.ts';
const worker = fileURLToPath(new URL('./upgrade-office-worker.ts', import.meta.url));
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
async function restart(home: string) {
  const port = await freePort();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      env: {
        ...process.env,
        ODDBORO_UPGRADE_CHECK: '1',
        ODDBORO_HOME: home,
        ODDBORO_ENV: join(home, 'absent.env'),
        ODDBORO_VERSION: 'upgrade-test',
        ODDBORO_DB_PORT: String(port),
        DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
        ODDBORO_LOCAL_DB: '1'
      },
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let error = '';
    child.stderr.on('data', (b) => (error += String(b)));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(error))));
  });
}
test(
  'a populated released office preserves its records, files, IDs and one usable backup through upgrade and two restarts',
  { timeout: 45000 },
  async () => {
    const home = mkdtempSync(join(tmpdir(), 'oddboro-upgrade-'));
    try {
      const db = await releaseDatabase(home);
      await db.exec(`
      INSERT INTO owner (name,welcomed_at) VALUES ('Fixture owner',now());
      INSERT INTO staff (id,name,role,remit,variant,portrait,desk,permission) VALUES
        ('manager','Robin','Office Manager','Keep the office moving.','a','a','A custom manager description.','draft'),
        ('voice','Pat','Adviser','An ordinary Odd awaiting a persona.','b','b','Keep the original notes.','draft'),
        ('writer','Wren','Reporter','Write the brief.','c','c','Use approved sources.','read'),
        ('reviewer','Finch','Editor','Review the brief.','d','d','Keep exact quotes.','draft');
      INSERT INTO goals (title,done_when) VALUES ('Existing integration','One verified review in the original conversation.'),('Existing daily brief','Reviewed by the deadline.');
      INSERT INTO staff_goals (staff_id,goal_id,part) VALUES ('manager',1,'Lead'),('voice',1,'Review'),('writer',2,'Produce'),('reviewer',2,'Review');
      INSERT INTO threads (title,goal_id,hub_id,holder_id) VALUES ('Existing project',1,'manager','voice'),('Existing newsroom',2,'writer','reviewer');
      INSERT INTO jobs (staff_id,name,instructions,schedule,next_run_at) VALUES
        ('writer','Existing producer','Keep these instructions.', '{"every":"day","at":"06:00"}', now()+interval '1 hour'),
        ('reviewer','Existing reviewer','Keep these review steps.', '{"every":"day","at":"06:15"}', now()+interval '2 hours');
      INSERT INTO runs (job_id,staff_id,status,summary,finished_at) VALUES (1,'writer','done','An earlier source.',now());
      INSERT INTO asks (staff_id,kind,title,why,if_approved,status,reason) VALUES ('manager','hire','Old persona proposal','Keep the unresolved intent.','Connect the intended persona.','open',null),('manager','approval','Prior decision','Keep this decision.','Continue.','approved','Exact owner answer.');
      INSERT INTO tasks (staff_id,title,why,steps) VALUES ('manager','Old setup task','Waiting for connection.','[{"text":"The owner already did this","done":true,"answer":"Exact preserved answer"},{"text":"Still waiting","done":false}]');
      INSERT INTO follow_ups (staff_id,kind,task_id,thread_id,note) VALUES ('manager','after_task',1,1,'Continue the same work.');
      INSERT INTO connectors (id,name,description,kind,config) VALUES ('fixture-source','Fixture source','An existing connection.','mcp','{}');
      INSERT INTO grants (staff_id,connector_id,level) VALUES ('writer','fixture-source','read');
      INSERT INTO reports (staff_id,title,body) VALUES ('writer','Last result','Last verified output.');
      INSERT INTO ledger (kind,actor,title,body) VALUES ('work','manager','Prior decision','Exact owner answer.');
    `);
      const before = await snapshot(db);
      await db.close();
      const files = {
        'staff/manager/chat.jsonl':
          '{"from":"owner","text":"Keep the existing work.","at":"2026-11-01T12:00:00Z"}\n',
        'staff/voice/notes/identity.md': 'Original intended persona and unresolved consultation.\n',
        'threads/2/writer/source.md': 'Existing source, verbatim.\n',
        'threads/2/reviewer/edition.md': 'Existing reviewed edition.\n'
      };
      for (const [name, body] of Object.entries(files)) {
        mkdirSync(join(home, name, '..'), { recursive: true });
        writeFileSync(join(home, name), body);
      }
      writeFileSync(join(home, 'version'), '0.0.10\n');
      const hashes = fileHashes(home);
      for (let i = 0; i < 3; i++) {
        await restart(home);
        const current = await PGlite.create(join(home, 'db'), { extensions: { vector } });
        const after = await snapshot(current);
        sameReleasedRows(before, after);
        for (const name of [
          'persona_requests',
          'persona_consultations',
          'persona_revisions',
          'project_sessions',
          'project_requests',
          'project_reviews',
          'scheduled_results',
          'result_editions'
        ])
          assert.deepEqual(after[name], [], name + ' started work during database upgrade');
        assert.equal(
          (
            await current.query<{ count: number }>(
              'select count(*)::int from drizzle.__drizzle_migrations'
            )
          ).rows[0].count,
          readMigrationFiles({
            migrationsFolder: fileURLToPath(new URL('../migrations/', import.meta.url))
          }).length
        );
        await current.close();
        const kept = fileHashes(home);
        for (const path of Object.keys(files)) assert.equal(kept[path], hashes[path], path);
      }
      const backups = readdirSync(join(home, 'backups'));
      assert.equal(backups.length, 1);
      const saved = await PGlite.create(join(home, 'backups', backups[0], 'db'), {
        extensions: { vector }
      });
      sameReleasedRows(before, await snapshot(saved));
      await saved.close();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }
);
