<script lang="ts">
  import { checkAccount, signIn, switchAccount } from './account-actions.ts';
  import { account } from './account.svelte.ts';

  // Signing in to the owner's New Altitude account: the words and the buttons
  // for each state. Setup's Account section shows it and adds Sign out; a
  // later offer to sign in can show it too. Text sizes follow the parent's.
  //
  // The state is the server's: the page's `account` object, set from the page
  // data and the live line, so a sign-in finished in another tab shows here
  // with no reload. Only `waiting` is this block's own: the page it opened.
  let waiting = $state<{ url: string }>();
  let busy = $state(false);
  let problem = $state('');

  $effect(() => {
    if (account.status.state === 'in') waiting = undefined;
  });

  // The live check, once per showing, never on a timer.
  $effect(() => {
    // The page keeps the status it loaded; the office not answering shows elsewhere.
    checkAccount().catch(() => undefined);
  });

  /** Run a start (Sign in, or Switch account) and open the page it answers. */
  async function begin(start: () => Promise<string>) {
    busy = true;
    problem = '';
    try {
      const url = await start();
      // '' when a kept sign-in still worked: the live line brings the new status.
      if (url) {
        // Safari can block a window opened after an await, so the waiting
        // state links to the same page. The return value is null with noopener.
        window.open(url, '_blank', 'noopener');
        waiting = { url };
      }
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const primary = 'rounded-lg bg-sea px-3 py-2 font-medium text-night disabled:opacity-40';
  const plain = 'rounded-lg bg-raise px-3 py-2 font-medium text-ink hover:bg-sea/20';

  /** What a state shows: a question for a heading, a line, and a button that starts a sign-in. */
  type View = {
    question?: string;
    line: string;
    action?: { label: string; start: () => Promise<string>; style: string };
  };
  // A state added to `AccountStatus` fails svelte-check at the default until
  // it has its own words here.
  const view = $derived.by((): View => {
    const status = account.status;
    switch (status.state) {
      case 'out':
        return {
          question: 'Have a New Altitude account?',
          line: 'Sign in if you have one. Oddboro works the same without it.',
          action: { label: 'Sign in', start: signIn, style: primary }
        };
      case 'in':
        return {
          line: `Signed in to New Altitude as ${status.account.email}.`,
          action: { label: 'Switch account', start: switchAccount, style: plain }
        };
      case 'expired':
        return {
          line: 'Your New Altitude sign-in ran out.',
          action: { label: 'Sign in again', start: signIn, style: primary }
        };
      default: {
        const unhandled: never = status;
        return unhandled;
      }
    }
  });
</script>

{#if waiting}
  <p class="leading-relaxed text-ink">
    Finish signing in on the page that opened. You may be asked to accept New Altitude's Beta Terms.
  </p>
  <div class="mt-3 flex flex-wrap items-center gap-3">
    <a
      class="text-sea underline underline-offset-2"
      href={waiting.url}
      target="_blank"
      rel="noopener">Open the sign-in page</a
    >
    <button class={plain} onclick={() => (waiting = undefined)}>Cancel</button>
  </div>
{:else}
  {#if view.question}
    <p class="text-[1.3em] font-semibold text-ink">{view.question}</p>
    <p class="mt-1 leading-relaxed text-muted">{view.line}</p>
  {:else}
    <p class="leading-relaxed text-ink">{view.line}</p>
  {/if}
  {#if view.action}
    {@const action = view.action}
    <div class="mt-3">
      <button class={action.style} disabled={busy} onclick={() => begin(action.start)}
        >{action.label}</button
      >
    </div>
  {/if}
{/if}
{#if problem}
  <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-coral" role="alert">{problem}</p>
{/if}
