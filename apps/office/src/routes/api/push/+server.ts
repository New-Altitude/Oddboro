// A buzz on the owner's phone (`#lib/server/push.ts`). GET gives the office's
// public key, which the phone's push service needs, making it the first time.
// POST `{ address }` turns the buzz on for that phone, and DELETE with the
// same body turns it off. Only the office's own page reaches these, as with
// every action, so only the owner's phone desk can add a phone.
import { error, json } from '@sveltejs/kit';
import { secretStore } from '@oddboro/ledger/secrets';
import { addPhone, isPushAddress, publicKey, removePhone } from '#lib/server/push.ts';
import type { RequestHandler } from './$types';

/** The store must answer before a key or a phone can be kept. */
function needStore(): void {
  const store = secretStore();
  if (!store.ok)
    error(
      503,
      `This computer's secret store is ${store.problem}, so the office cannot buzz a phone.`
    );
}

async function address(request: Request): Promise<string> {
  const body: unknown = await request.json().catch(() => undefined);
  const a = body && typeof body === 'object' && 'address' in body ? body.address : undefined;
  if (typeof a !== 'string' || !isPushAddress(a)) error(400, "That is not a phone's push address.");
  return a;
}

export const GET: RequestHandler = () => {
  needStore();
  return json({ key: publicKey() });
};

export const POST: RequestHandler = async ({ request }) => {
  needStore();
  addPhone(await address(request));
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
  needStore();
  removePhone(await address(request));
  return json({ ok: true });
};
