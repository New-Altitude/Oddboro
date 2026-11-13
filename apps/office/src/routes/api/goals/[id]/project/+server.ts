import { json } from '@sveltejs/kit';
import { goalProject } from '#lib/server/goal-projects.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => json(await goalProject(Number(params.id)));
