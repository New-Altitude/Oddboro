// A response belongs to the task, even while its editor or chat is closed.
import type { TaskRow } from '@oddboro/ledger';
import { call } from './api.ts';

type Draft = { text: string; version: number };
export type SavedResponse = Pick<TaskRow, 'response' | 'responseVersion'>;
export const drafts = $state<Record<number, Draft | undefined>>({});
export const saved = $state<Record<number, SavedResponse | undefined>>({});
export const writing = $state<Record<number, boolean>>({});

export function current(t: Pick<TaskRow, 'id'> & SavedResponse): SavedResponse {
  const local = saved[t.id];
  return local && local.responseVersion >= t.responseVersion && local.response !== null ? local : t;
}

// A lost reply may leave these exact words saved one version beyond the draft.
export function alreadySaved(draft: Draft, row?: SavedResponse) {
  return row?.responseVersion === draft.version + 1 && row.response === draft.text;
}

export function staleDraft(draft: Draft | undefined, row: SavedResponse) {
  return !!draft && draft.version !== row.responseVersion && !alreadySaved(draft, row);
}

export async function saveResponse(id: number, draft: Draft, finish?: { note?: string }) {
  writing[id] = true;
  try {
    const url = `/api/tasks/${id}`;
    const known = saved[id];
    const row =
      finish && known && alreadySaved(draft, known)
        ? known
        : await call<SavedResponse>(url, {
            op: 'response',
            version: draft.version,
            response: draft.text
          });
    saved[id] = row;
    if (finish) await call(url, { op: 'finish', version: row.responseVersion, note: finish.note });
    delete drafts[id];
    return row;
  } catch (error) {
    // A stale save keeps its draft. Show the version it would overwrite on retry.
    const latest = await call<SavedResponse>(`/api/tasks/${id}`).catch(() => undefined);
    if (latest) saved[id] = latest;
    if (finish && alreadySaved(draft, saved[id])) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Version ${draft.version + 1} was saved. Could not confirm completion: ${reason}`
      );
    }
    throw error;
  } finally {
    delete writing[id];
  }
}

type Correction = {
  id: number;
  title: string;
  version: number;
  before: string;
  after: string;
  passage: string;
  words: string;
};
export const corrections = $state<Record<string, Correction | undefined>>({});
