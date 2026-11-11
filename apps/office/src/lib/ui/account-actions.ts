// What the page asks the office to do with the owner's New Altitude sign-in.
// The sign-in block and the Setup section call these and keep only their own
// busy, problem and waiting state, so each request is written once.
import type { AccountStatus } from '#lib/account.ts';
import { account } from './account.svelte.ts';
import { call } from './api.ts';

/**
 * The live check: the office refreshes a sign-in close to running out, so one
 * New Altitude refused shows as ran out.
 */
export async function checkAccount(): Promise<void> {
  const r = await call<{ status: AccountStatus }>('/api/account');
  account.status = r.status;
}

/** Start a sign-in: the New Altitude page to open, or '' when a kept sign-in still worked. */
export async function signIn(): Promise<string> {
  const { url } = await call<{ url: string }>('/api/account', undefined, 'POST');
  return url;
}

/** End the sign-in at New Altitude and on this computer. */
export async function signOut(): Promise<void> {
  const r = await call<{ status: AccountStatus }>('/api/account', undefined, 'DELETE');
  account.status = r.status;
}

/**
 * Sign out, then start a new sign-in. Sign-out comes first because the office
 * finishes no sign-in while one holds tokens. Until the new one finishes the
 * office is signed out, so a refused start or a Cancel leaves it that way.
 */
export async function switchAccount(): Promise<string> {
  await signOut();
  return signIn();
}
