// Drawing an office runs as a job on the server, not inside one request, so a
// page that closes or reloads loses nothing: it follows the job again and gets
// every line so far, then the rest as it happens. One drawing at a time. When
// the owner opens their office for the first time, the job moves them in as
// soon as it is done. A server restart drops the job; the page offers to start
// it again from the same words.
import { EventEmitter } from 'node:events';
import type { DrawnArt } from '@oddboro/sprites/art';
import type { OfficeSpec } from '@oddboro/world';
import { fixedError } from '@oddboro/ledger/errors';
import { drawOffice, type DrawnOffice, type Progress } from './office-design.ts';
import { moveInto } from './move-in.ts';

export type DesignLine =
  | Progress
  | ({ step: 'done' } & Omit<DrawnOffice, 'plan' | 'templates' | 'kinds' | 'seats'> & {
        seats: number;
      })
  | { step: 'error'; message: string }
  | { step: 'moved'; name: string };

export type DesignRequest = {
  description: string;
  note?: string;
  previous?: OfficeSpec;
  art?: DrawnArt[];
};

type Job = {
  id: number;
  description: string;
  lines: DesignLine[];
  finished: boolean;
  /** Move in when the drawing is done, without asking. */
  moveIn: boolean;
  result?: DrawnOffice;
  moved: boolean;
  feed: EventEmitter;
};

const g = globalThis as unknown as { designJob?: Job; designJobs?: number };

export const currentDesign = (): Job | undefined => g.designJob;

/** Start drawing. Throws while another drawing is still running. */
export function startDesign(req: DesignRequest, moveIn = false): Job {
  if (g.designJob && !g.designJob.finished)
    throw fixedError('The office is already drawing one. Wait for it to finish.');
  const job: Job = {
    id: (g.designJobs = (g.designJobs ?? 0) + 1),
    description: req.description,
    lines: [],
    finished: false,
    moveIn,
    moved: false,
    feed: new EventEmitter().setMaxListeners(20)
  };
  g.designJob = job;
  const send = (line: DesignLine) => {
    job.lines.push(line);
    job.feed.emit('line', line);
  };
  void drawOffice(req, send)
    .then(async (d) => {
      job.result = d;
      send({
        step: 'done',
        spec: d.spec,
        world: d.world,
        notes: d.notes,
        missing: d.missing,
        seats: Object.values(d.seats).reduce((n, s) => n + s, 0),
        art: d.art,
        artSheet: d.artSheet,
        artCatalog: d.artCatalog
      });
      if (job.moveIn) await move(job, send);
    })
    .catch((e) => send({ step: 'error', message: e instanceof Error ? e.message : String(e) }))
    .finally(() => {
      job.finished = true;
      job.feed.emit('end');
    });
  return job;
}

/** Every line so far, then each new one, until the job ends. Returns a stop. */
export function followDesign(
  job: Job,
  on: (line: DesignLine) => void,
  end: () => void
): () => void {
  for (const line of job.lines) on(line);
  if (job.finished) {
    end();
    return () => {};
  }
  // A follower stops hearing lines when the job ends: a move-in after the end
  // must not write to a stream that already closed.
  const done = () => {
    job.feed.off('line', on);
    end();
  };
  job.feed.on('line', on);
  job.feed.once('end', done);
  return () => {
    job.feed.off('line', on);
    job.feed.off('end', done);
  };
}

/** Move in as soon as the drawing is done, or now if it already is. */
export async function moveInWhenDone(job: Job): Promise<void> {
  job.moveIn = true;
  if (job.result && !job.moved)
    await move(job, (line) => {
      job.lines.push(line);
      job.feed.emit('line', line);
    });
}

async function move(job: Job, send: (line: DesignLine) => void): Promise<void> {
  if (!job.result || job.moved) return;
  job.moved = true;
  try {
    await moveInto(job.result.spec, job.result.art, job.description);
    send({ step: 'moved', name: job.result.spec.name });
  } catch (e) {
    job.moved = false;
    send({ step: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}
