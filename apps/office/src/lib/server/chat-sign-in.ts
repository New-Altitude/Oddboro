// Read the account used by a failed reply. A retry still uses the saved turn.
import { accountOf, OFFICE_ACCOUNT, type StaffRow } from '@oddboro/ledger';
import type { ChatSignIn } from '#lib/staff/chat.ts';
import { apiKey, claudeAccount, claudeSettings } from './claude.ts';
import { claudeSignInState, signInState } from './agent-sign-in.ts';
import { NOT_SIGNED_IN } from './launch.ts';

export async function missingChatSignIn(
  who: StaffRow,
  failure: string
): Promise<ChatSignIn | undefined> {
  // A persona's chat answers through New Altitude, whose own access says what to renew.
  if (who.package) return;
  const agent = who.agent;
  const account = await accountOf(who);
  if (agent === 'claude') {
    if (account === OFFICE_ACCOUNT && claudeSettings().auth === 'key')
      return apiKey() ? undefined : { agent, account, how: 'key' };
    const signed = await claudeSignInState(
      account,
      account === OFFICE_ACCOUNT ? claudeAccount : undefined
    );
    return signed.signedIn || signed.ownLogin ? undefined : { agent, account, how: signed.how };
  }
  const state = signInState(agent, account);
  if (!state.signedIn || (agent === 'grok' && failure === `Grok ${NOT_SIGNED_IN}`))
    return { agent, account, how: state.how };
}
