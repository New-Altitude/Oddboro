// Turns text into a vector on this Mac, through Ollama's nomic-embed-text, so
// nothing written to the ledger leaves the machine. Returns null when Ollama is
// not running or too slow; the row is still written and found by its words.
const OLLAMA = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
export const EMBED_MODEL = 'nomic-embed-text';
/** Long enough to load the model cold. Every ledger write waits on this. */
export const EMBED_TIMEOUT_MS = 15_000;
/** A stuck Ollama costs one wait, not one per line. */
const PAUSE_MS = 60_000;
let pausedUntil = 0;

/** `document` for text being stored, `query` for text being searched with. */
export async function embed(
  text: string,
  as: 'document' | 'query',
  timeoutMs = EMBED_TIMEOUT_MS
): Promise<number[] | null> {
  if (Date.now() < pausedUntil) return null;
  try {
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: 'POST',
      body: JSON.stringify({ model: EMBED_MODEL, input: `search_${as}: ${text}` }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { embeddings?: number[][] };
    return body.embeddings?.[0] ?? null;
  } catch (e) {
    // Only a stuck Ollama pauses it. One that is not running refuses at once,
    // so the next line may try again.
    if ((e as { name?: string }).name === 'TimeoutError') pausedUntil = Date.now() + PAUSE_MS;
    return null;
  }
}
