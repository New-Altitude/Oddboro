import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  projectReviewsFor,
  cancelProjectReview,
  returnProjectReview,
  roster
} from '@oddboro/ledger';
import { previewProjectReview, askProjectReview } from '#lib/server/project-reviews.ts';
import { projectController } from '#lib/server/project-sessions/controller.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) =>
  json({
    reviews: await projectReviewsFor(url.searchParams.get('session') ?? ''),
    personas: (await roster())
      .filter((s) => s.package && !s.leftAt)
      .map((s) => ({ id: s.id, name: s.name, slug: s.package!.slug, quiet: s.package!.quiet }))
  });
const id = z.string().uuid();
const command = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('preview'),
    sessionId: id,
    personaId: z.string().min(1),
    file: z.string().min(1).max(4096),
    start: z.number().int().positive(),
    end: z.number().int().positive(),
    question: z.string().trim().min(1).max(3000)
  }),
  z.object({ action: z.literal('ask'), id }),
  z.object({ action: z.literal('cancel'), id }),
  z.object({ action: z.literal('return'), id, recommendation: z.string().max(8000) })
]);
export const POST: RequestHandler = async ({ request }) => {
  const parsed = command.safeParse(await request.json().catch(() => null));
  if (!parsed.success) error(400, 'Choose a review and the text to share.');
  const a = parsed.data;
  try {
    if (a.action === 'preview') return json(await previewProjectReview(a));
    if (a.action === 'ask') return json(await askProjectReview(a.id));
    if (a.action === 'cancel') await cancelProjectReview(a.id);
    if (a.action === 'return') {
      const r = await returnProjectReview(a.id, a.recommendation);
      // A disconnected conversation keeps the durable assignment until reconnection.
      if (projectController().view(r.sessionId).connected)
        await projectController().work(r.sessionId);
    }
    return json({ ok: true });
  } catch (e) {
    error(409, e instanceof Error ? e.message : 'The review could not complete.');
  }
};
