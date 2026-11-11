// Draw a person, or redraw them with the owner's note, from words, a headshot,
// or both. Runs as the office: one to two minutes from words, five to seven
// from a headshot. Nothing is saved until
// the owner keeps the look, and the headshot never is.
import { error, json } from '@sveltejs/kit';
import { drawLook, drawnFrom } from '#lib/server/looks.ts';
import type { RequestHandler } from './$types';

/** The page shrinks a headshot to 512 px before sending it, so this is generous. */
const PHOTO_MAX = 1_500_000;
/** Models a drawing may ask for by name, to compare them. The page never sends one. */
const MODELS = ['claude-opus-5-5', 'claude-fable-5-2', 'claude-fable-5-1'];

export const POST: RequestHandler = async ({ request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (k: string, max: number) =>
    typeof b[k] === 'string' ? (b[k] as string).trim().slice(0, max) : '';
  const photo =
    typeof b.photo === 'string'
      ? /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(b.photo)
      : null;
  if (b.photo && !photo) error(400, 'The headshot must be a JPEG, PNG, WebP or GIF');
  if (photo && photo[2].length > PHOTO_MAX)
    error(413, 'The headshot is too big. Try a smaller one');
  try {
    return json(
      await drawLook({
        description: text('description', 1000),
        name: text('name', 40),
        role: text('role', 60),
        staffId: text('staffId', 60) || undefined,
        note: text('note', 600) || undefined,
        previous: b.previous ? drawnFrom(b.previous as Record<string, unknown>) : undefined,
        photo: photo ? { mediaType: photo[1], data: photo[2] } : undefined,
        model: MODELS.includes(text('model', 40)) ? text('model', 40) : undefined,
        // The page drops the request to stop the drawing (Build from parts, or Stop).
        signal: request.signal
      })
    );
  } catch (e) {
    error(502, e instanceof Error ? e.message : String(e));
  }
};
