import { json, error } from '@sveltejs/kit';
import { readComputerActivity } from '#lib/server/computer-activity.ts';

export async function GET() {
  try {
    return json(await readComputerActivity(), { headers: { 'cache-control': 'no-store' } });
  } catch {
    error(503, 'The office could not read process usage on this computer. Refresh to try again.');
  }
}
