// Ledger rows and searches need the same model and the same 768 dimensions.
export const EMBED_MODEL = 'nomic-embed-text';
/** Long enough to load the model cold. Every ledger write waits on this. */
export const EMBED_TIMEOUT_MS = 15_000;
const PAUSE_MS = 60_000;
let pausedUntil = 0;

/** Send one request. Setup uses a fixed sample to test the owner's endpoint. */
export async function requestEmbedding(
  text: string,
  as: 'document' | 'query',
  timeoutMs: number,
  env: NodeJS.Dict<string> = process.env
): Promise<number[] | null> {
  const endpoint = env.OFFICE_EMBEDDINGS_URL;
  const ollama = env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
  const model = endpoint ? env.OFFICE_EMBEDDINGS_MODEL || EMBED_MODEL : EMBED_MODEL;
  const res = await fetch(endpoint || `${ollama}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    redirect: 'error',
    body: JSON.stringify({ model, input: `search_${as}: ${text}` }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) return null;
  const body = await res.json();
  const vector = endpoint ? body?.data?.[0]?.embedding : body?.embeddings?.[0];
  return Array.isArray(vector) && vector.length === 768 && vector.every(Number.isFinite)
    ? vector
    : null;
}

/** A refused connection or unusable result leaves the row available by its words. */
export async function embed(
  text: string,
  as: 'document' | 'query',
  timeoutMs = EMBED_TIMEOUT_MS
): Promise<number[] | null> {
  if (Date.now() < pausedUntil) return null;
  try {
    return await requestEmbedding(text, as, timeoutMs);
  } catch (e) {
    if ((e as { name?: string }).name === 'TimeoutError') pausedUntil = Date.now() + PAUSE_MS;
    return null;
  }
}
