// The office's opt-in Brain connection. No Odd receives the key or write access.
import { capturePages, newestCapture } from './brain-pages.ts';
import { recentCaptures, textHash } from './brain-recent.ts';
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
type Connection = { id: string; url: string; recentStart?: string[]; position?: string | null };
function current(): Connection | undefined {
  return existsSync(setup()) ? JSON.parse(readFileSync(setup(), 'utf8')) : undefined;
}
type Checked = {
  id: string;
  at: number;
  review: DreamReview;
  jobs: string;
  recent?: string[];
  position?: string | null;
};
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
  const paged = checked?.position !== undefined || connection?.position !== undefined;
  return {
    url: connection?.url,
    checkedAt: checked?.at,
    paged,
    watchesCaptures: paged || !!(checked?.recent ?? connection?.recentStart),
    catchingUp: checked?.position !== undefined && checked.at === 0,
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
  const sameAccess = before?.id === row.id && (!key || key === getSecret(row.id, 'x-brain-key'));
  let recentStart = sameAccess ? (lastReview()?.recent ?? before?.recentStart) : undefined;
  let position = sameAccess ? before?.position : undefined;
  const client = await upstream(row, false, key ? { 'x-brain-key': key } : undefined);
  try {
    const tools = await toolsFor(client);
    if (!sameAccess && tools.some((t) => t.name === 'list_thoughts_page' && readsOnly(t))) {
      position = await newestCapture((args) => callText(client, 'list_thoughts_page', args));
    } else if (
      position === undefined &&
      !recentStart &&
      tools.some((t) => t.name === 'list_thoughts' && readsOnly(t))
    ) {
      recentStart = (await recentCaptures((limit) => callText(client, 'list_thoughts', { limit })))
        .head;
    }
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
  replace(setup(), JSON.stringify({ id: row.id, url: url.href, recentStart, position }));
  if (!sameAccess) {
    if (existsSync(reviewPath())) unlinkSync(reviewPath());
    checked = undefined;
  }
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

async function callText(client: Client, name: string, args: Record<string, string | number>) {
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
type Fetched = { hash: string; record?: Evidence };
async function fetchRecord(client: Client, id: string): Promise<Fetched | undefined> {
  const r = JSON.parse(await callText(client, 'fetch', { id }));
  if (r === null) return;
  if (r.id !== id || typeof r.text !== 'string')
    throw new Error('Open Brain returned an unreadable record.');
  const hash = textHash(r.text);
  if (
    r.metadata?.source === 'agent_memory' ||
    r.metadata?.source_type === 'agent_memory' ||
    r.metadata?.sensitivity_tier === 'restricted'
  )
    return { hash };
  return {
    hash,
    record: { id, text: r.text, date: r.metadata?.updated_at ?? r.metadata?.created_at ?? '' }
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
  const client = await upstream(c);
  try {
    const tools = await toolsFor(client);
    const fetched = new Map<string, Fetched | undefined>();
    const read = async (id: string) => {
      if (!fetched.has(id)) fetched.set(id, await fetchRecord(client, id));
      return fetched.get(id);
    };
    const locate = async (text: string) => {
      const hash = textHash(text);
      for (const item of fetched.values()) if (item?.hash === hash) return item;
      for (const id of await search(client, text)) {
        const item = await read(id);
        if (item?.hash === hash) return item;
      }
    };
    const captured: string[] = [];
    for (const d of pending) {
      const receiptDir = join(receipts(), d.pairId);
      const receipt = join(receiptDir, d.turn);
      if (existsSync(receipt)) {
        unlinkSync(d.path);
        continue;
      }
      if (!tools.some((t) => t.name === 'capture_thought'))
        throw new Error('This Brain cannot save paired project decisions.');
      let match = await locate(d.content);
      if (!match) {
        await callText(client, 'capture_thought', { content: d.content });
        match = await locate(d.content);
      }
      const found = match?.record;
      if (!found)
        throw new Error('The Brain has not confirmed a shareable copy of the saved decision yet.');
      mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
      const hash = textHash(found.text);
      replace(receipt, JSON.stringify({ id: found.id, hash, at: d.at }));
      proofs.set(found.id, { hash, at: d.at });
      captured.push(found.id);
      unlinkSync(d.path);
    }
    const setup = current();
    let recent = checked?.recent ?? setup?.recentStart;
    const saved = checked?.position !== undefined ? checked.position : setup?.position;
    const paged = tools.some((t) => t.name === 'list_thoughts_page' && readsOnly(t));
    const listsCaptures = tools.some((t) => t.name === 'list_thoughts' && readsOnly(t));
    if (saved !== undefined && !paged)
      throw new Error(
        'Open Brain no longer offers capture pages. The office kept its saved position.'
      );
    if (recent && !paged && !listsCaptures)
      throw new Error('Open Brain no longer offers its read-only list of recent captures.');

    const searches: string[][] = [];
    for (const name of [...new Set(work.map((j) => j.name))].sort())
      searches.push(await search(client, name));
    if (work.length && !paged && listsCaptures) {
      const incoming = await recentCaptures(
        (limit) => callText(client, 'list_thoughts', { limit }),
        recent,
        tools.some((t) => t.name === 'thought_stats' && readsOnly(t))
          ? async () => {
              const stats = await callText(client, 'thought_stats', {});
              const count = /^Total thoughts: (\d+)$/m.exec(stats);
              if (!count) throw new Error('Open Brain could not confirm its capture count.');
              return Number(count[1]);
            }
          : undefined
      );
      for (const text of incoming.added) {
        const match = await locate(text);
        if (!match)
          throw new Error(
            'Open Brain listed a new capture but could not verify its exact record. The office will check again.'
          );
        if (match.record) captured.push(match.record.id);
      }
      recent = incoming.head;
    }
    const pages =
      paged && work.length
        ? capturePages((args) => callText(client, 'list_thoughts_page', args), saved, recent)
        : [{ records: [], position: saved, done: true }];
    let review = checked?.id === c.id ? checked.review : undefined;
    for await (const batch of pages) {
      const incoming: string[] = [];
      for (const row of batch.records) {
        if (row.text === undefined || !row.hash || row.date === undefined) continue;
        const id = row.position.split('/')[1];
        fetched.set(id, { hash: row.hash, record: { id, text: row.text, date: row.date } });
        incoming.push(id);
      }
      const prior = work.map((j) => (review?.byJob[j.id] ?? []).map((r) => r.id));
      const groups = [incoming, captured, ...prior, ...searches];
      const records = new Map<string, Evidence>();
      for (const id of new Set(groups.flat())) {
        const item = await read(id);
        if (!item?.record) continue;
        const proof = proofs.get(id);
        const ownerQuote = proof?.hash === item.hash;
        records.set(id, {
          ...item.record,
          text: item.record.text.slice(0, 2800),
          date: (ownerQuote && proof?.at) || item.record.date,
          ownerQuote
        });
      }
      const source = {
        read: async () => groups.map((ids) => ids.flatMap((id) => records.get(id) ?? []))
      };
      // A later page can add an unrelated fact. Keep established matches only
      // for unchanged assignments and records that still pass the source read.
      const retained: Record<string, Evidence[]> = {};
      if (paged && checked?.id === c.id && review) {
        const previousJobs: DreamWork[] = JSON.parse(checked.jobs);
        for (const j of work) {
          const previousJob = previousJobs.find((p) => p.id === j.id);
          if (
            !previousJob ||
            previousJob.name !== j.name ||
            previousJob.staffId !== j.staffId ||
            previousJob.instructions !== j.instructions
          )
            continue;
          const matches = (review.byJob[j.id] ?? []).filter((item) => {
            const now = records.get(item.id);
            return (
              now &&
              now.text === item.text &&
              now.date === item.date &&
              now.ownerQuote === item.ownerQuote
            );
          });
          if (matches.length) retained[j.id] = matches;
        }
      }
      review = await reviewWork(
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
        review,
        retained
      );
      const next = {
        id: c.id,
        at: batch.done ? Date.now() : 0,
        review,
        jobs,
        recent: batch.position === undefined ? recent : undefined,
        position: batch.position
      };
      replace(reviewPath(), JSON.stringify(next));
      checked = next;
      problem = '';
      // Only records referenced by retained findings or the office searches can be needed again.
      for (const id of incoming) fetched.delete(id);
    }
    if (!review) throw new Error('The office did not finish checking the Brain.');
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
