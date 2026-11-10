// The owner's New Altitude account. GET checks it live (a request to New
// Altitude only when the token is close to running out), POST starts a
// sign-in and answers the page to open, DELETE signs out.
import { error, json } from '@sveltejs/kit';
import {
  accountStatus,
  accountToken,
  signOut,
  SignInRefused,
  startAccountSignIn
} from '#lib/server/account.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  await accountToken();
  return json({ status: accountStatus() });
};

export const POST: RequestHandler = async () => {
  try {
    return json(await startAccountSignIn());
  } catch (e) {
    if (e instanceof SignInRefused) error(409, e.message);
    console.error('[account]', e);
    error(502, 'New Altitude did not answer. Try again in a minute.');
  }
};

export const DELETE: RequestHandler = async () => {
  await signOut();
  return json({ status: accountStatus() });
};
