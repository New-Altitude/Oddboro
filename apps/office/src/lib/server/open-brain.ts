// The office's opt-in Brain connection. No Odd receives the key or write access.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
  addConnector,
  catalog,
  connector,
  connectorReady,
  notesOf,
  job as jobById,
  enabledJobs,
  ensureConnector,
  home,
  readsOnly,
  type ConnectorRow
} from '@oddboro/ledger';
import { agentCommand } from './agent-sign-in.ts';
import { getSecret, setSecret } from './keychain.ts';
import { upstream } from './access.ts';
import { replace } from './launch.ts';
import { runAsOffice } from './office-run.ts';
import {
  decisionBrief,
  DREAM_SYSTEM,
  reviewWork,
  type DreamReview,
  type DreamWork,
  type Evidence
} from './dream-review.ts';
import { loadPairs, pendingDecisions, unpairBrain } from './brain-project.ts';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const dir = () => home('dreaming');
const setup = () => join(dir(), 'connection.json');
const receipts = () => join(dir(), 'captures');
type Connection = { id: string; url: string };
function current(): Connection | undefined {
  return existsSync(setup()) ? JSON.parse(readFileSync(setup(), 'utf8')) : undefined;
}
type Checked = { id: string; at: number; review: DreamReview; jobs: string };
const reviewPath = () => join(dir(), 'review.json');
let checked: Checked | undefined;
function lastReview(): Checked | undefined {
  if (!checked && existsSync(reviewPath())) {
    try {
      checked = JSON.parse(readFileSync(reviewPath(), 'utf8'));
    } catch {
      /* Rebuild on the next review. */
    }
  }
  return checked;
}
let problem = '';
let queue = Promise.resolve();
export function inOrder<T>(op: () => Promise<T>): Promise<T> {
  const next = queue.then(op);
  queue = next.then(
    () => {},
    () => {}
  );
  return next;
}
export async function brainState() {
  const connection = current();
  lastReview();
  return {
    url: connection?.url,
    checkedAt: checked?.at,
    affected: Object.keys(checked?.review.byJob ?? {}).length,
    findings: Object.entries(checked?.review.byJob ?? {})
      .filter(([, sources]) => sources.length)
      .map(([id, sources]) => ({
        id,
        name:
          (JSON.parse(checked!.jobs) as DreamWork[]).find((w) => String(w.id) === id)?.name ?? id,
        sources
      })),
    hosts: (['codex', 'claude'] as const).filter((host) => agentCommand(host)),
    problem,
    pairs: loadPairs().map(({ id, host, workspace }) => ({
      id,
      host,
      workspace,
      verified: existsSync(join(receipts(), id)) && readdirSync(join(receipts(), id)).length > 0
    })),
    existing: (await catalog())
      .filter(
        (c) =>
          c.kind === 'http' &&
          c.readyAt &&
          c.config.url?.endsWith('/open-brain-mcp') &&
          c.config.headers?.includes('x-brain-key')
      )
      .map((c) => c.config.url!)
  };
}

async function toolsFor(client: Client) {
  const { tools } = await client.listTools();
  for (const name of ['search', 'fetch'])
    if (!tools.some((t) => t.name === name && readsOnly(t)))
      throw new Error(
        'This Brain must offer read-only search and fetch. Check the Open Brain MCP address.'
      );
  return tools;
}

export async function connectBrain(address: string, key: string) {
  const url = new URL(address);
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  )
    throw new Error('Use an HTTPS Brain address, or a local Brain on this computer.');
  if (
    url.username ||
    url.password ||
    url.hash ||
    [...url.searchParams.keys()].some((k) => k !== 'key')
  )
    throw new Error('Use the Open Brain MCP address.');
  key = key.trim() || url.searchParams.get('key') || '';
  url.search = '';
  const before = current();
  if (before && before.url !== url.href) throw new Error('Disconnect the current Brain first.');
  let row = (await catalog()).find((c) => c.kind === 'http' && c.config.url === url.href);
  if (!row) {
    if (url.protocol === 'https:')
      row = (await ensureConnector(url.href, { keyHeader: 'x-brain-key' })).connector;
    else
      row = await addConnector({
        id: 'brain-local-' + url.port,
        name: 'Local Open Brain',
        kind: 'http',
        description: 'Open Brain on this computer',
        config: { url: url.href, headers: ['x-brain-key'] }
      });
  }
  if (!row || row.config.url !== url.href || !row.config.headers?.includes('x-brain-key'))
    throw new Error('Use the Open Brain service with its x-brain-key header.');
  if (!key && !getSecret(row.id, 'x-brain-key') && !row.config.fromAws?.['x-brain-key'])
    throw new Error('Enter the Brain access key.');
  const client = await upstream(row, false, key ? { 'x-brain-key': key } : undefined);
  try {
    const tools = await toolsFor(client);
    if (key && row.config.fromAws?.['x-brain-key'])
      throw new Error('Leave the key empty to reuse the connected AWS key.');
    if (key) setSecret(row.id, 'x-brain-key', key);
    if (!row.readyAt)
      await connectorReady(
        row.id,
        tools.map((t) => t.name),
        tools.filter(readsOnly).map((t) => t.name),
        notesOf(tools)
      );
  } finally {
    await client.close();
  }
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  replace(setup(), JSON.stringify({ id: row.id, url: url.href }));
  if (existsSync(reviewPath())) unlinkSync(reviewPath());
  checked = undefined;
  problem = '';
}
export function disconnectBrain() {
  if (existsSync(setup())) unlinkSync(setup());
  if (existsSync(reviewPath())) unlinkSync(reviewPath());
  checked = undefined;
  problem = '';
  rmSync(receipts(), { recursive: true, force: true });
  const failures: Error[] = [];
  for (const pair of loadPairs()) {
    try {
      unpairBrain(pair.id);
    } catch (e) {
      if (e instanceof Error) failures.push(e);
    }
  }
  if (failures.length)
    throw new Error(
      'Disconnected. A project settings file could not be cleaned up. Its hook is inactive.'
    );
}

async function callText(client: Client, name: string, args: Record<string, string>) {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 15000 });
  if (
    name === 'fetch' &&
    result.isError &&
    Array.isArray(result.content) &&
    result.content.some(
      (b) =>
        b.type === 'text' &&
        /0 rows|cannot coerce the result to a single json object|multiple \(or no\) rows returned/i.test(
          String(b.text)
        )
    )
  )
    return 'null';
  if (result.isError || !Array.isArray(result.content))
    throw new Error('Open Brain could not complete ' + name + '. Check its connection.');
  const block = result.content.find((b) => b.type === 'text');
  if (!block || typeof block.text !== 'string')
    throw new Error('Open Brain returned no result for ' + name + '.');
  return block.text;
}
async function search(client: Client, query: string): Promise<string[]> {
  const parsed = JSON.parse(await callText(client, 'search', { query }));
  if (!Array.isArray(parsed.results)) throw new Error('Open Brain returned an unreadable search.');
  return parsed.results
    .slice(0, 10)
    .map((r: { id: string }) => r.id)
    .filter((id: unknown) => typeof id === 'string');
}
async function fetchRecord(client: Client, id: string): Promise<Evidence | undefined> {
  const r = JSON.parse(await callText(client, 'fetch', { id }));
  if (r === null) return;
  if (r.id !== id || typeof r.text !== 'string')
    throw new Error('Open Brain returned an unreadable record.');
  if (
    r.metadata?.source === 'agent_memory' ||
    r.metadata?.source_type === 'agent_memory' ||
    r.metadata?.sensitivity_tier === 'restricted'
  )
    return;
  return {
    id,
    text: r.text,
    date: r.metadata?.updated_at ?? r.metadata?.created_at ?? ''
  };
}

async function reviewConnection(c: ConnectorRow, work: DreamWork[], force: boolean) {
  lastReview();
  const jobs = JSON.stringify(work);
  const pending = pendingDecisions();
  if (
    !force &&
    !pending.length &&
    checked?.id === c.id &&
    checked.jobs === jobs &&
    Date.now() - checked.at < 60000
  )
    return checked.review;
  const proofs = new Map<string, { hash: string; at: string }>();
  for (const p of loadPairs()) {
    const folder = join(receipts(), p.id);
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder)) {
      const { id, hash, at } = JSON.parse(readFileSync(join(folder, file), 'utf8'));
      proofs.set(id, { hash, at });
    }
  }
  const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');
  const client = await upstream(c);
  try {
    const tools = await toolsFor(client);
    const records = new Map<string, Evidence>();
    for (const d of pending) {
      const receiptDir = join(receipts(), d.pairId);
      const receipt = join(receiptDir, d.turn);
      if (existsSync(receipt)) {
        unlinkSync(d.path);
        continue;
      }
      if (!tools.some((t) => t.name === 'capture_thought'))
        throw new Error('This Brain cannot save paired project decisions.');
      const locate = async () => {
        for (const id of await search(client, d.content)) {
          const item = await fetchRecord(client, id);
          if (item?.text === d.content) return item;
        }
      };
      let found = await locate();
      if (!found) {
        await callText(client, 'capture_thought', { content: d.content });
        found = await locate();
      }
      if (!found) throw new Error('The Brain has not confirmed the saved decision yet.');
      mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
      const hash = hashOf(found.text);
      replace(receipt, JSON.stringify({ id: found.id, hash, at: d.at }));
      proofs.set(found.id, { hash, at: d.at });
      records.set(found.id, found);
      unlinkSync(d.path);
    }
    const newlyCaptured = [...records.keys()];
    const source = {
      read: async (jobs: DreamWork[]) => {
        const prior =
          checked?.id === c.id
            ? jobs.flatMap((j) => checked!.review.byJob[j.id] ?? []).map((e) => e.id)
            : [];
        const ids = new Set<string>([...newlyCaptured, ...prior]);
        for (const q of new Set(jobs.map((j) => j.name)))
          for (const id of await search(client, q)) ids.add(id);
        for (const id of ids)
          if (!records.has(id)) {
            const r = await fetchRecord(client, id);
            if (r) records.set(id, r);
          }
        return [...ids]
          .flatMap((id) => records.get(id) ?? [])
          .map((r) => {
            const proof = proofs.get(r.id);
            const ownerQuote = proof?.hash === hashOf(r.text);
            return {
              ...r,
              text: r.text.slice(0, 2800),
              date: (ownerQuote && proof?.at) || r.date,
              ownerQuote
            };
          })
          .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
      }
    };
    const review = await reviewWork(
      work,
      source,
      async (data) => {
        const answer = await runAsOffice(data, {
          system: DREAM_SYSTEM,
          kind: 'office',
          timeoutMs: 90000,
          effort: 'low'
        });
        if (!answer.ok)
          throw new Error('The office could not review the Brain. Check the office AI sign-in.');
        return answer.text;
      },
      checked?.id === c.id ? checked.review : undefined
    );
    checked = { id: c.id, at: Date.now(), review, jobs };
    replace(reviewPath(), JSON.stringify(checked));
    problem = '';
    return review;
  } finally {
    await client.close();
  }
}

export async function reviewBrain(job?: DreamWork, force = false): Promise<string> {
  if (!current()) return '';
  return inOrder(async () => {
    const active = current();
    if (!active) return '';
    try {
      const c = await connector(active.id);
      if (!c || c.config.url !== active.url) throw new Error('Connect Open Brain again.');
      const rows: DreamWork[] = await enabledJobs();
      if (job) {
        const currentJob = await jobById(job.id);
        if (
          !currentJob ||
          currentJob.staffId !== job.staffId ||
          currentJob.instructions !== job.instructions
        )
          return '';
        if (!rows.some((j) => j.id === job.id)) rows.push(currentJob);
      }
      const work = rows
        .map(({ id, name, staffId, instructions }) => ({
          id,
          name,
          staffId,
          instructions: instructions.slice(0, 1000)
        }))
        .sort((a, b) => a.id - b.id);
      const review = await reviewConnection(c, work, force);
      if (!job) return '';
      const latest = await jobById(job.id);
      return latest?.staffId === job.staffId && latest.instructions === job.instructions
        ? decisionBrief(review.byJob[job.id] ?? [])
        : '';
    } catch (e) {
      problem = e instanceof Error ? e.message : 'Open Brain is unavailable.';
      if (force) throw e;
      return '\nThe office could not check Open Brain for this run. Do not assume a previous decision is current.';
    }
  });
}

let looking = false;
let nextLook = 0;
export function checkBrainOnClock() {
  if (looking || Date.now() < nextLook || !existsSync(setup())) return;
  looking = true;
  nextLook = Date.now() + 60000;
  void reviewBrain()
    .catch(() => {})
    .finally(() => {
      looking = false;
    });
}
