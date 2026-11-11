// The owner's New Altitude account as the office knows it. The server, the
// page's data, the live line and the sign-in block all use these, so the page
// loads this file too and it imports nothing.

/** Who signed in, as New Altitude said. Only these three are kept. */
export type Account = { id: string; name: string | null; email: string };

/**
 * `in` while the sign-in holds tokens, `expired` once New Altitude refused to
 * renew them (the account is kept, so the page can say whose it was), `out`
 * with no account.
 */
export type AccountStatus =
  { state: 'out' } | { state: 'in'; account: Account } | { state: 'expired'; account: Account };
