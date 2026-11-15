import { json, error } from '@sveltejs/kit';
import { runsGoing } from '@oddboro/ledger/run-registry';
import { computerActivity, type ComputerActivity } from '#lib/server/computer-activity.ts';

// Several windows can open the panel together. Drop the sample as soon as they have it.
let sampling: Promise<ComputerActivity> | undefined;
export async function GET() {
  sampling ??= computerActivity(
    () =>
      new Map(
        [...runsGoing.values()].flatMap((r) =>
          r.process
            ? [
                [
                  r.process.pid,
                  { agent: r.process.agent, staffId: r.staffId, task: r.work?.label ?? r.kind }
                ] as const
              ]
            : []
        )
      )
  ).finally(() => {
    sampling = undefined;
  });
  try {
    return json(await sampling, { headers: { 'cache-control': 'no-store' } });
  } catch {
    error(503, 'The office could not read process usage on this computer. Refresh to try again.');
  }
}
