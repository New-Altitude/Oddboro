// How the office is doing, for a test or a bug report: its version and pid,
// how long each startup step took, how many pages hold the live line, and how
// many errors pages have reported. A read, so any program on this computer
// may ask: it holds nothing private.
import { json } from '@sveltejs/kit';
import { health } from '#lib/server/health.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json(health());
