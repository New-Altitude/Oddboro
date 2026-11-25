// Draw an office from the owner's words, or redraw one with a note. POST starts
// the drawing on the server and returns at once. GET follows it, a line of JSON
// at a time: the spec once it is written, the floor with stand-ins, each piece
// of art as it is drawn, then the built floor to preview. A page that reloads
// gets every line again. PUT { moveIn: true } moves in as soon as it is done,
// over the layout the owner is in, or into another one when POST said
// `new: true`. Nothing changes until the owner moves in. One drawing at a time.
import { error, json } from '@sveltejs/kit';
import { ART_LIMITS, type DrawnArt } from '@oddboro/sprites/art';
import { LIMITS, type OfficeSpec } from '@oddboro/world';
import {
  currentDesign,
  followDesign,
  moveInWhenDone,
  startDesign,
  type DesignLine
} from '#lib/server/design-job.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as {
    description?: unknown;
    note?: unknown;
    previous?: OfficeSpec;
    art?: unknown;
    moveIn?: unknown;
    new?: unknown;
  };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (!description) error(400, 'Say what you want the office to look like');
  if (description.length > LIMITS.description)
    error(400, `Keep it to ${LIMITS.description} characters`);
  try {
    const job = startDesign(
      {
        description,
        note: typeof b.note === 'string' ? b.note.trim().slice(0, 500) : undefined,
        previous: b.previous,
        art: Array.isArray(b.art) ? (b.art.slice(0, ART_LIMITS.office) as DrawnArt[]) : [],
        new: b.new === true
      },
      b.moveIn === true
    );
    return json({ id: job.id });
  } catch (e) {
    error(409, e instanceof Error ? e.message : String(e));
  }
};

export const GET: RequestHandler = ({ url }) => {
  const job = currentDesign();
  const id = Number(url.searchParams.get('id'));
  if (!job || (id && job.id !== id)) error(404, 'No drawing under way');
  const encoder = new TextEncoder();
  let stop = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(out) {
      stop = followDesign(
        job,
        (line: DesignLine) => out.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)),
        () => out.close()
      );
    },
    cancel() {
      stop();
    }
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
};

export const PUT: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as { moveIn?: unknown };
  const job = currentDesign();
  if (!job) error(404, 'No drawing under way');
  if (b.moveIn === true) await moveInWhenDone(job);
  return json({ ok: true });
};
