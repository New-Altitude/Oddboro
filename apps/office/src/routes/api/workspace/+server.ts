import { json } from '@sveltejs/kit';
import { workspace } from '#lib/server/workspace.ts';
export const GET = async () => json(await workspace());
