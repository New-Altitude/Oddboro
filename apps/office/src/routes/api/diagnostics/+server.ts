// The owner's answer about error and trace reports. PUT `{ answer }`, yes or
// no, keeps it in the office's settings file and in this process, so the
// gate (`#lib/server/diagnostics.ts`) honours it from the next report on.
import { error, json } from '@sveltejs/kit';
import { writeEnv } from '@oddboro/ledger/env';
import { answerFrom } from '#lib/diagnostics.ts';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = async ({ request }) => {
  const body: unknown = await request.json().catch(() => undefined);
  const answer = answerFrom(body && typeof body === 'object' && 'answer' in body && body.answer);
  if (answer === 'unasked') error(400, 'Answer yes or no');
  writeEnv({ OFFICE_DIAGNOSTICS: answer });
  process.env.OFFICE_DIAGNOSTICS = answer;
  return json({ answer });
};
