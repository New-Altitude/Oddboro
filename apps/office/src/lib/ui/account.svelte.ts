// The page's view of the owner's New Altitude sign-in. Set from the page data,
// then from the live line's account events and the sign-in block's own
// answers, so the card and Setup always show the same state.
import type { AccountStatus } from '#lib/account.ts';

export const account = $state<{ status: AccountStatus }>({ status: { state: 'out' } });
