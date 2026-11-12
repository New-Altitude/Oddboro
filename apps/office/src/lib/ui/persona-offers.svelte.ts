// The New Altitude personas offered to this owner (`/api/personas`), and the
// calls that add, reconnect or disconnect one (`/api/personas/[slug]`).
// Onboarding's persona card and Setup's Account section each make their own
// PersonaOffers, the way AgentTools is made. What each persona is waiting on,
// or what went wrong, is one map for the page, so the offer and a quiet Odd's
// chat show the same thing.
//
// Nothing polls. Each list reads the offers again when it is made, when the
// account signs in, and after the live line brings news of a persona.
import type { AccountStatus } from '#lib/account.ts';
import type { Offers } from '#lib/persona.ts';
import { switchAccount } from './account-actions.ts';
import { account } from './account.svelte.ts';
import { call } from './api.ts';

/** Bumped when a persona changed, so every list on the page reads the offers again. */
let changes = $state(0);

/** By slug: the sign-in page a persona waits on, a call under way, or what went wrong. */
export const personas = $state<
  Record<string, { busy?: boolean; waiting?: string; problem?: string }>
>({});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** What the offers say when New Altitude sent no list. */
export const OFFERS_LINE: Record<Exclude<Offers['state'], 'ok'>, string> = {
  out: 'Sign in to New Altitude first.',
  rescope: 'Sign in again to see the New Altitude personas your account can use.',
  refused: "New Altitude turned down this account's request for personas.",
  unreachable: 'New Altitude did not answer. Try again in a minute.'
};

/** The live line's news of a persona: a sign-in finished, it joined, or it could not. */
export function personaNews(e: { slug: string; problem?: string }) {
  personas[e.slug] = e.problem ? { problem: e.problem } : {};
  changes++;
}

/**
 * Start the persona's own sign-in (Add and Reconnect). Its page opens; the
 * live line says when it is done. `askId` is the hire ask it is added in
 * place of: its join answers that ask.
 */
export async function connect(slug: string, askId?: number) {
  personas[slug] = { busy: true };
  try {
    const { url } = await call<{ url: string }>(
      `/api/personas/${slug}`,
      askId === undefined ? undefined : { askId },
      'POST'
    );
    // '' when a kept sign-in still worked: the live line brings the news.
    personas[slug] = url ? { waiting: url } : {};
    // Safari can block a window opened after an await, so the waiting state
    // links to the same page.
    if (url) window.open(url, '_blank', 'noopener');
  } catch (e) {
    personas[slug] = { problem: message(e) };
  }
}

/** Disconnect: the persona's sign-in ends and its Odd goes quiet. */
export async function disconnect(slug: string) {
  personas[slug] = { busy: true };
  try {
    await call(`/api/personas/${slug}`, undefined, 'DELETE');
    personas[slug] = {};
  } catch (e) {
    personas[slug] = { problem: message(e) };
  }
  changes++;
}

/**
 * A persona Odd quiet because its access ended: read New Altitude's list
 * again, which wakes the Odd if the persona is listed once more.
 */
export async function checkAgain(slug: string, name: string) {
  personas[slug] = { busy: true };
  try {
    const o = await call<Offers>('/api/personas');
    if (o.state !== 'ok') personas[slug] = { problem: OFFERS_LINE[o.state] };
    else if (o.offers.some((x) => x.slug === slug && !x.quiet)) personas[slug] = {};
    else personas[slug] = { problem: `New Altitude still gives ${name} no access.` };
  } catch (e) {
    personas[slug] = { problem: message(e) };
  }
  changes++;
}

export class PersonaOffers {
  /** Undefined until the first answer. */
  state = $state<Offers>();
  /** Reading the offers, or signing in again. */
  busy = $state(false);
  /** The page Sign in again opened, until the account is back in. */
  signingIn = $state<string>();
  problem = $state('');
  // Derived, so a new status object with the same state reads nothing again.
  #signedIn = $derived(account.status.state === 'in');

  /** Made while a component starts, since it reads the offers in an effect of that component. */
  constructor() {
    $effect(() => {
      void changes;
      if (!this.#signedIn) {
        this.state = { state: 'out' };
        return;
      }
      this.signingIn = undefined;
      void this.load();
    });
  }

  /** Read the offers: on start, on sign-in, after a change, and on Try again. */
  async load() {
    this.busy = true;
    try {
      this.state = await call<Offers>('/api/personas');
    } catch {
      // The office did not answer: the block keeps what it had, and the next change reads again.
    } finally {
      this.busy = false;
    }
  }

  /**
   * An account signed in before personas existed: sign out, then sign in
   * again, which asks for personas. A refresh can never widen a sign-in.
   */
  async signInAgain() {
    this.busy = true;
    this.problem = '';
    try {
      const url = await switchAccount();
      if (url) {
        window.open(url, '_blank', 'noopener');
        this.signingIn = url;
      }
    } catch (e) {
      this.problem = message(e);
    } finally {
      this.busy = false;
    }
  }
}
