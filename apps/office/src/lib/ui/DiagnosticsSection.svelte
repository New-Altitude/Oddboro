<script lang="ts">
  import { NEVER_CARRIED, answerDiagnostics, diagnostics } from './diagnostics.svelte.ts';

  // The Setup window's Diagnostics section: one switch for error and trace
  // reports. Off keeps `no` at once; the office stops sending from the next
  // report, with no restart.
  let busy = $state(false);
  let problem = $state('');
  const on = $derived(diagnostics.answer === 'yes');

  async function flip() {
    busy = true;
    problem = '';
    try {
      await answerDiagnostics(on ? 'no' : 'yes');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section class="flex flex-col gap-2" aria-label="Diagnostics">
  <h3 class="text-xs tracking-[0.16em] text-sea uppercase">Diagnostics</h3>
  <button
    class="flex items-center gap-3 rounded-lg bg-raise px-3 py-2 text-start text-xs disabled:opacity-40"
    role="switch"
    aria-checked={on}
    aria-describedby="diagnostics-sent"
    disabled={busy}
    onclick={flip}
  >
    <span class="min-w-0 flex-1 text-ink">Send error and tracing reports to New Altitude</span>
    <span
      class="flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 {on
        ? 'justify-end bg-sea'
        : 'justify-start bg-night/60'}"
      aria-hidden="true"
    >
      <span class="size-4 rounded-full {on ? 'bg-night' : 'bg-muted'}"></span>
    </span>
  </button>
  <p id="diagnostics-sent" class="text-xs text-muted">
    {NEVER_CARRIED}
    <a
      class="text-sea underline underline-offset-2"
      href="https://oddboro.com/privacy"
      target="_blank"
      rel="noreferrer">What is sent</a
    >
  </p>
  {#if problem}
    <p class="rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral" role="alert">{problem}</p>
  {/if}
</section>
