<script lang="ts">
  import { NEVER_CARRIED, answerDiagnostics, diagnostics } from './diagnostics.svelte.ts';

  // The ask about error and trace reports: what they carry, and the two
  // answers. The first-visit card and the Desk item both show this one.
  // Each button keeps the answer at once.
  let busy = $state(false);
  let problem = $state('');

  async function answer(a: 'yes' | 'no') {
    busy = true;
    problem = '';
    try {
      await answerDiagnostics(a);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const button =
    'rounded-lg bg-raise px-3 py-2 text-sm font-medium text-ink hover:bg-sea/20 disabled:opacity-40 aria-pressed:bg-sea aria-pressed:text-night';
</script>

<p class="text-sm leading-relaxed text-muted">
  When something in Oddboro breaks, it can send New Altitude a report: what went wrong, where in the
  code, and how long the office took to do things. {NEVER_CARRIED} Sentry, the service that stores them,
  keeps the approximate location (city and country) your internet address points to, never the address
  itself. You can turn this off in Setup at any time.
</p>
<div class="mt-3 flex flex-wrap gap-2">
  <button
    class={button}
    aria-pressed={diagnostics.answer === 'yes'}
    disabled={busy}
    onclick={() => answer('yes')}>Send reports</button
  >
  <button
    class={button}
    aria-pressed={diagnostics.answer === 'no'}
    disabled={busy}
    onclick={() => answer('no')}>Don't send</button
  >
</div>
{#if problem}
  <p class="mt-2 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral" role="alert">{problem}</p>
{/if}
