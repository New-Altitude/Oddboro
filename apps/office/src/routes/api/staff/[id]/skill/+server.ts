import { error, json } from '@sveltejs/kit';
import { setStaffSkill, staffer } from '@oddboro/ledger';
import { skillProblem } from '#lib/staff/skill.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const who = await staffer(params.id);
  if (!who || who.package) error(404, 'No such local Odd.');
  return json({ skill: who.skill });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const body = await request.json().catch(() => null);
  if (
    !body ||
    (body.skill !== null && typeof body.skill !== 'string') ||
    (body.was !== null && typeof body.was !== 'string')
  )
    error(400, 'Choose a skill first.');
  if (body.skill !== null) {
    const problem = skillProblem(body.skill);
    if (problem) error(400, problem);
  }
  if (!(await setStaffSkill(params.id, body.was, body.skill)))
    error(409, 'Reopen Skill to review the current copy before saving.');
  return json({ ok: true });
};
