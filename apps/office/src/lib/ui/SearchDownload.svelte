<script lang="ts">
  import type { Check, SearchLine } from '@oddboro/ledger/checks';
  import { stream } from './api.ts';

  // Ledger search's Download button, on Setup's line for it in the welcome
  // and in the Setup tab. Nothing downloads until the owner clicks it. While
  // it downloads, a bar and "52 of 138 MB" take the button's place, moved by
  // each megabyte the office says has arrived. Then the office checks the
  // model and answers with the line as it now stands.
  type Props = { check: Check; ondone: (check: Check) => void };
  let { check, ondone }: Props = $props();

  let busy = $state(false);
  let problem = $state('');
  let got = $state(0);
  let of = $state(0);
  const mb = (bytes: number) => Math.round(bytes / 1_000_000);

  async function download() {
    busy = true;
    problem = '';
    got = 0;
    of = 0;
    let done: Check | undefined;
    try {
      await stream<SearchLine>('/api/setup/search', {}, (line) => {
        if ('got' in line) ({ got, of } = line);
        else if ('check' in line) done = line.check;
        else problem = line.problem;
      });
      if (done) ondone(done);
      else problem ||= 'The download stopped before the office said it was done. Try again.';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<span class="flex flex-wrap items-center gap-2">
  {#if busy}
    <span
      class="h-1.5 w-40 overflow-hidden rounded-full bg-night/40"
      role="progressbar"
      aria-label="Search model downloaded"
      aria-valuemin={0}
      aria-valuemax={of || 1}
      aria-valuenow={got}
    >
      <span class="bar block h-full bg-sea" style="inline-size: {of ? (100 * got) / of : 0}%"
      ></span>
    </span>
    <span class="text-muted tabular-nums">
      {of ? `${mb(got)} of ${mb(of)} MB` : 'Starting the download…'}
    </span>
  {:else}
    <button class="btn" onclick={download}>Download (about {check.download} MB)</button>
    <span class="text-faint">Finds entries by meaning, not only by their words.</span>
  {/if}
</span>
{#if problem}
  <span class="block text-coral" role="alert">{problem}</span>
{/if}

<style>
  .bar {
    transition: inline-size 400ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
</style>
