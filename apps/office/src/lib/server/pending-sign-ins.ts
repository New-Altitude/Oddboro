// A browser may finish sign-in after the office restarts. Keep its state next
// to the PKCE verifier in the secret store, with a short expiry, never in logs.
import { getSecret, setSecret } from './keychain.ts';
const KEY = ['new-altitude-account', 'pending'] as const;
const MAX_AGE = 30 * 60_000;
type Entry = { id: string; until: number };
export class PendingSignIns {
  private read(): Record<string, Entry> {
    const raw = getSecret(...KEY);
    if (!raw) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          ([, e]) =>
            e && typeof e.id === 'string' && typeof e.until === 'number' && e.until > Date.now()
        )
      );
    } catch {
      return {};
    }
  }
  get(state: string): string | undefined {
    return this.read()[state]?.id;
  }
  set(state: string, id: string): this {
    setSecret(
      ...KEY,
      JSON.stringify({ ...this.read(), [state]: { id, until: Date.now() + MAX_AGE } })
    );
    return this;
  }
  delete(state: string): boolean {
    const entries = this.read();
    const found = state in entries;
    delete entries[state];
    setSecret(...KEY, JSON.stringify(entries));
    return found;
  }
  *[Symbol.iterator](): IterableIterator<[string, string]> {
    for (const [state, e] of Object.entries(this.read())) yield [state, e.id];
  }
}
