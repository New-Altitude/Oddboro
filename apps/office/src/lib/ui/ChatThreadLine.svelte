<script lang="ts">
  import type { SvelteSet } from 'svelte/reactivity';
  import type { HandOffLine } from '@oddboro/ledger';
  import Markdown from './Markdown.svelte';
  import type { Delivered } from './chat-about.svelte.ts';
  import { KIND, LONG, lead, threadSteps, type Line } from './chat-threads.ts';
  import { when, workLine } from './format.ts';
  import { handOffProgress, type ReaderProps } from '../staff/odd-now.ts';

  // A chat line about work handed on: a thread's card in its lead's chat, or a
  // hand-off asked, replied to or picked up. What is open lives in the chat's
  // one `opened`, since the chat's lines are not all keyed.

  type Props = {
    line: Line;
    /** The hand-off stories and texts the owner opened. */
    opened: SvelteSet<string>;
    nowOf: ReaderProps['nowOf'];
    /** The Odd whose chat this is. */
    staffId: string;
    /** Opens something waiting on the owner, as a desk item's card does. */
    onpick: (d: Delivered) => void;
  };

  let { line, opened, nowOf, staffId, onpick }: Props = $props();

  const toggle = (key: string) => opened.delete(key) || opened.add(key);
</script>

<!-- A hand-off text: its opening paragraph until the owner opens the rest. -->
{#snippet full(text: string, key: string, staff: string)}
  {@const short = lead(text)}
  {@const open = opened.has(key)}
  <div class={!open && short.text.length > LONG ? 'clamped max-h-40 overflow-hidden' : ''}>
    <Markdown text={open ? text : short.text} {staff} />
  </div>
  {#if short.more || short.text.length > LONG}
    <button class="mt-1 text-xs text-muted hover:text-ink" onclick={() => toggle(key)}
      >{open ? 'Show less' : 'Show all'}</button
    >
  {/if}
{/snippet}

<!-- The whole of a hand-off, in the giver's chat: what it asked, and what came back. -->
{#snippet story(h: HandOffLine)}
  <div class="mt-2 flex flex-col gap-2 border-t border-sea/20 pt-2 text-ink">
    <div>
      <span class="block text-xs text-muted">{h.from} asked</span>
      {@render full(h.brief, `${h.id}-brief`, h.fromId)}
    </div>
    {#each h.backs as b, n (n)}
      <div class="border-s-2 border-sea ps-2">
        <span class="block text-xs text-muted"
          >{b.answered ? 'You answered' : `${h.to} replied`} · {when(b.at)}</span
        >
        {@render full(b.text, `${h.id}-back-${n}`, h.toId)}
      </div>
    {:else}
      <span class="text-xs text-muted">{h.to} has not replied yet.</span>
    {/each}
  </div>
{/snippet}

<!-- Where the Odd asked a colleague, on its thread's card: one line whose status moves, the story inside. -->
{#snippet gave(h: HandOffLine)}
  {@const p = handOffProgress(h, nowOf)}
  <div class="rounded-xl border border-sea/40 px-3 py-2">
    <button
      class="flex w-full items-baseline gap-2 text-start"
      aria-expanded={opened.has(`${h.id}-card`)}
      onclick={() => toggle(`${h.id}-card`)}
    >
      <span class="min-w-0 flex-1">
        <span class="block text-xs text-muted">↳ Asked {h.to} · {when(h.at)}</span>
        <span class="block font-medium break-words text-ink">{h.title}</span>
      </span>
      <span class="text-xs text-sea">{opened.has(`${h.id}-card`) ? 'Close' : 'Open'}</span>
    </button>
    <span class="text-xs {p.yours ? 'text-ember' : 'text-muted'}">{p.text}</span>
    {#if opened.has(`${h.id}-card`)}{@render story(h)}{/if}
  </div>
{/snippet}

{#if line.thread}
  <!-- One card per piece of work the Odd leads: where it stands, and each step on Open. -->
  {@const t = line.thread.line}
  {@const p = workLine({ ...t, lead: t.hub })}
  {@const key = `thread-${t.id}`}
  <div class="me-auto w-[85%] rounded-2xl rounded-es-md border border-sea/40 px-3 py-2 text-sm">
    <button
      class="flex w-full items-baseline gap-2 text-start"
      aria-expanded={opened.has(key)}
      onclick={() => toggle(key)}
    >
      <span class="min-w-0 flex-1">
        <span class="block font-medium break-words text-ink">{t.title}</span>
        <span class="block text-xs text-muted">{when(t.at)}</span>
      </span>
      <span class="text-xs text-sea">{opened.has(key) ? 'Close' : 'Open'}</span>
    </button>
    <span class="text-xs {p.yours ? 'text-ember' : 'text-muted'}">{p.text}</span>
    {#each t.waiting as w (`${w.kind}-${w.id}`)}
      <button
        class="mt-1 block text-start text-xs text-ember hover:text-ink"
        onclick={() => onpick(w)}>{KIND[w.kind]}: {w.title}</button
      >
    {/each}
    {#if opened.has(key)}
      <div class="mt-2 flex flex-col gap-2 border-t border-sea/20 pt-2 text-ink">
        {#each threadSteps(line.thread) as s, n (n)}
          {#if 'h' in s}
            {@render gave(s.h)}
          {:else}
            <div class="border-s-2 border-sea ps-2">
              <span class="block text-xs text-muted"
                >{t.hub} picked it back up · {when(s.at)}{s.run.outcome ? '' : ' · working'}</span
              >
              {#if s.run.text}{@render full(s.run.text, `${key}-run-${n}`, staffId)}{/if}
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
{:else if line.handOff}
  {@const h = line.handOff.line}
  {@const step = line.handOff.step}
  {@const p = handOffProgress(h, nowOf)}
  {#if step === 'given'}
    <!-- In the colleague's chat, the hand-off is the giver asking. -->
    <div class="-mb-1 ms-1 text-[10px] tracking-[0.16em] text-sea uppercase">
      {h.from} asked{line.at ? ` · ${when(line.at)}` : ''}
    </div>
    <div
      class="me-auto max-w-[85%] rounded-2xl rounded-es-md border-s-2 border-sea bg-raise px-3 py-2 text-sm leading-relaxed break-words text-ink"
    >
      <span class="mb-1 block font-medium">{h.title}</span>
      {@render full(h.brief, `${h.id}-brief`, h.fromId)}
    </div>
    {#if !h.backs.length}
      <div class="-mt-1 ms-1 text-xs text-muted">{p.text}</div>
    {/if}
  {:else}
    <!-- The colleague's reply in its own chat, or the giver's pick-up in the giver's. -->
    {@const reply = step === 'reply'}
    {@const n = line.handOff.back ?? 0}
    {@const b = h.backs[n]}
    {@const text = (reply ? b?.text : b?.pickUp.text) ?? ''}
    {#if reply}
      <div class="-mb-1 ms-1 text-[10px] tracking-[0.16em] text-sea uppercase">
        Reply to {h.from}{line.at ? ` · ${when(line.at)}` : ''}
      </div>
    {/if}
    <div
      class="me-auto max-w-[85%] rounded-2xl rounded-es-md bg-raise px-3 py-2 text-sm leading-relaxed break-words text-ink"
    >
      {@render full(text, `${h.id}-${step}-${n}`, reply ? h.toId : h.fromId)}
      {#if !reply}
        <button
          class="mt-2 block text-start text-xs text-sea hover:text-ink"
          aria-expanded={opened.has(`${h.id}-from`)}
          onclick={() => toggle(`${h.id}-from`)}>↳ From {h.to}'s work: {h.title}</button
        >
        {#if opened.has(`${h.id}-from`)}{@render story(h)}{/if}
      {/if}
    </div>
    {#if reply && n === h.backs.findLastIndex((x) => !x.answered) && (h.status === 'waiting' || (h.status === 'failed' && !h.answered))}
      <!-- How it stands, under the colleague's latest reply, when the owner has to know: the giver's card says it too. -->
      <div class="-mt-1 ms-1 text-xs {h.status === 'waiting' ? 'text-ember' : 'text-muted'}">
        {h.status === 'waiting' ? 'Waiting on you' : 'Could not finish'}
      </div>
    {/if}
  {/if}
{/if}

<style>
  /* A long hand-off text fades out where it is cut, until the owner opens it. */
  .clamped {
    mask-image: linear-gradient(to bottom, black 70%, transparent);
  }
</style>
