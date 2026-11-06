// Where New Altitude's sign-in page sends the owner back. Trades the code for
// the sign-in; every open office page hears the change on its live line. Every
// failure is a message here, never a throw.
import { finishAccountSignIn, SignInRefused } from '#lib/server/account.ts';
import type { PageServerLoad } from './$types';

const failed = (message: string) => ({ ok: false, title: 'Not signed in', message });

export const load: PageServerLoad = async ({ url }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const denied = url.searchParams.get('error');
  if (denied) return failed(`New Altitude said: ${denied}. Try Sign in again from Oddboro.`);
  if (!code || !state)
    return failed('The sign-in came back without a code. Try Sign in again from Oddboro.');
  try {
    const { email } = await finishAccountSignIn(state, code);
    return {
      ok: true,
      title: 'Signed in',
      message: `You are signed in to New Altitude as ${email}. You can close this tab.`
    };
  } catch (e) {
    if (e instanceof SignInRefused) return failed(e.message);
    console.error('[account]', e);
    return failed('New Altitude did not finish the sign-in. Try Sign in again from Oddboro.');
  }
};
