import { json } from '@sveltejs/kit';
import { hudDecisions, isWaitingChat } from '#lib/hud-decisions.ts';
import { nativeWaits } from '#lib/server/agent-attention.ts';
import { workspace } from '#lib/server/workspace.ts';
import type { RequestHandler } from './$types';

let native: ReturnType<typeof nativeWaits> | undefined;
let checked = 0;
export const GET: RequestHandler = async ({ url }) => {
  const id = url.searchParams.get('id');
  // Office changes can arrive in bursts. Recheck standalone tools when opening a specific item.
  const readNative = !id || /^(claude|codex)-/.test(id);
  if (readNative && (id || !native || Date.now() - checked >= 20_000)) {
    checked = Date.now();
    native = nativeWaits();
  }
  const [office, agents] = await Promise.all([workspace(), readNative ? native : undefined]);
  const all = hudDecisions(office, agents?.items ?? []);
  const result = id
    ? { decision: all.find((d) => d.id === id) ?? null }
    : {
        decisions: all.map((d) => ({
          id: d.id,
          source: d.source,
          title: d.title,
          waitingChat: isWaitingChat(d)
        }))
      };
  return json(
    { ...result, partial: agents?.partial ?? false },
    { headers: { 'cache-control': 'no-store' } }
  );
};
