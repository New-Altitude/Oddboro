// The owner changes a lesson an Odd kept: Keep one that waits, Undo it, reword
// it, say where it applies, or say who it is for.
import { error, json } from '@sveltejs/kit';
import { APPLIES_TO_MAX, changeLesson, type LessonScope } from '@oddboro/ledger';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === 'string' ? body.text.trim() : undefined;
  if (text !== undefined && (!text || text.length > 240))
    error(400, 'A lesson is one sentence, up to 240 characters');
  // A string says where it applies; empty or null, everywhere.
  const appliesTo =
    body.appliesTo === null || typeof body.appliesTo === 'string' ? body.appliesTo : undefined;
  if (appliesTo && appliesTo.trim().length > APPLIES_TO_MAX)
    error(400, `Where a lesson applies is a few words, up to ${APPLIES_TO_MAX} characters`);
  const scope = ['me', 'everyone'].includes(body.scope as string)
    ? (body.scope as LessonScope)
    : undefined;
  const status = ['live', 'undone'].includes(body.status as string)
    ? (body.status as 'live' | 'undone')
    : undefined;
  if (!text && appliesTo === undefined && !scope && !status) error(400, 'Say what to change');
  const row = await changeLesson(Number(params.id), { text, appliesTo, scope, status });
  if (!row) error(404, 'No such lesson');
  return json(row);
};
