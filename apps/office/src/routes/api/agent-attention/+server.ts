import { json } from '@sveltejs/kit';
import { agentAttention } from '#lib/server/agent-attention.ts';

let reading: ReturnType<typeof agentAttention> | undefined;
export async function GET() {
  reading ??= agentAttention().finally(() => {
    reading = undefined;
  });
  return json(await reading, { headers: { 'cache-control': 'no-store' } });
}
