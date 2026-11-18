<script lang="ts">
  import { chatRequest } from './chat-about.svelte.ts';
  import { serviceNames } from './service-names.svelte.ts';
  import { runningFor, toolWords, type Work, type WorkAbout } from '../staff/work.ts';

  // What the Odd is working on now, at the foot of its chat, one line each,
  // with Message <lead> on work another Odd leads.

  type Props = {
    work: Work[];
    /** The chat's clock, which moves once a minute while work runs. */
    clock: number;
    /** Opens the info page at In progress. */
    onwork: () => void;
  };

  let { work, clock, onwork }: Props = $props();

  function direct(target: WorkAbout) {
    chatRequest.work = target;
    chatRequest.staff = target.leadId;
  }
</script>

{#if work.length}
  <!-- What the Odd is working on now, one line each; a click opens In progress. -->
  <div
    class="flex flex-col gap-0.5 border-t border-hairline px-3 py-1.5 text-start text-xs text-muted transition-colors hover:bg-raise"
  >
    {#each work as w (w.id)}
      <span class="flex w-full min-w-0 items-center gap-1.5">
        <span class="size-1.5 shrink-0 rounded-full {w.queued ? 'bg-faint' : 'bg-ember'}"></span>
        <button
          class="min-w-0 truncate text-ink hover:underline"
          title="Open In progress"
          onclick={onwork}>{w.label}</button
        >
        <span class="shrink-0 text-faint"
          >· {w.toStart
            ? 'waiting to start'
            : w.queued
              ? 'waiting for a free slot'
              : runningFor(w.since, clock)}</span
        >
        {#if !w.queued}
          <span class="min-w-0 truncate"
            >· {w.doing ? toolWords(w.doing, serviceNames.byId) : 'Thinking'}</span
          >
        {/if}
        {#if w.about && !w.queued}
          {@const target = w.about}
          <button
            class="ms-auto min-w-0 truncate text-sea"
            title={`Message ${target.lead} about ${target.title}`}
            onclick={() => direct(target)}
            >{target.kind === 'goal' ? target.title + ' · ' : ''}Message {target.lead}</button
          >
        {/if}
      </span>
    {/each}
  </div>
{/if}
