import { error, json } from '@sveltejs/kit';
import {
  brainState,
  connectBrain,
  disconnectBrain,
  inOrder,
  reviewBrain
} from '#lib/server/open-brain.ts';
import { pairBrain, unpairBrain } from '#lib/server/brain-project.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await brainState());

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  try {
    switch (body.action) {
      case 'connect':
        await inOrder(() => connectBrain(body.url, body.key ?? ''));
        await reviewBrain(undefined, true);
        break;
      case 'check':
        await reviewBrain(undefined, true);
        break;
      case 'pair':
        if ((body.host !== 'claude' && body.host !== 'codex') || typeof body.path !== 'string')
          throw new Error('Choose a chat app and its project folder.');
        await inOrder(async () => {
          if (!(await brainState()).url) throw new Error('Connect Open Brain first.');
          pairBrain(body.host, body.path);
        });
        break;
      case 'unpair':
        await inOrder(async () => unpairBrain(body.id));
        break;
      case 'disconnect':
        await inOrder(async () => disconnectBrain());
        break;
      default:
        throw new Error('Choose an Open Brain action.');
    }
  } catch (e) {
    error(400, e instanceof Error ? e.message : 'Open Brain could not complete this action.');
  }
  return json(await brainState());
};
