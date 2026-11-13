<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import type { ConversationView } from '#lib/server/work-conversations.ts';
  import type { ChatEvent } from '#lib/staff/chat.ts';
  import { newTurnId } from '#lib/staff/chat-input.ts';
  import { call, stream } from './api.ts';
  import { wins } from './windows.svelte.ts';
  import Markdown from './Markdown.svelte';

  let {
    id,
    work,
    version,
    visible,
    onstaff
  }: {
    id: string;
    work: { id: number; title: string };
    version: number;
    visible: boolean;
    onstaff: (id: string) => void;
  } = $props();
  let data = $state<ConversationView>();
  let target = $state('');
  let message = $state('');
  let problem = $state('');
  let sending = $state(false);
  let active = $state<{ runId: string; staffId: string }>();
  let requestId = $state('');
  let partial = $state('');
  let doing = $state('');
  let accepted = false;
  let loadNumber = 0;
  let disposed = false;
  let bottom: HTMLDivElement;
  const url = $derived(`/api/work/${work.id}/conversation` as const);
  const busy = $derived(sending || !!active);
  const name = (staffId: string) =>
    data?.work.people.find((p) => p.id === staffId)?.name ?? staffId;

  async function load() {
    const n = ++loadNumber;
    try {
      const next = await call<ConversationView>(url);
      if (disposed || n !== loadNumber) return;
      data = next;
      active = next.active;
      wins.titles[id] = next.work.title;
      if (!next.work.people.some((p) => p.id === target))
        target =
          next.work.people.find((p) => p.id === next.work.lead)?.id ??
          next.work.people[0]?.id ??
          '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    version;
    void load();
  });
  $effect(() => {
    wins.dirty[id] = !!message.trim();
    wins.busy[id] = busy;
  });
  $effect(() => {
    if (visible) {
      data?.messages.length;
      partial;
      void tick().then(() => bottom?.scrollIntoView({ block: 'nearest' }));
    }
  });
  onDestroy(() => {
    disposed = true;
  });

  async function send() {
    if (!message.trim() || !target || busy || data?.work.stopped) return;
    const text = message;
    const staffId = target;
    requestId = newTurnId();
    partial = '';
    problem = '';
    doing = '';
    accepted = false;
    sending = true;
    try {
      await stream<ChatEvent>(url, { requestId, staffId, message: text }, (e) => {
        if (e.type === 'reply') {
          accepted = true;
          active = { runId: e.runId, staffId };
          // The owner may already be drafting the next message while this runs.
          if (message === text) message = '';
          void load();
        } else if (e.type === 'delta') partial += e.text;
        else if (e.type === 'tool') doing = e.name;
        else if (e.type === 'error') problem = e.message;
        else if (e.type === 'done') partial = e.text;
      });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
      await load();
      if (!accepted && data?.messages.some((m) => m.requestId === requestId) && message === text)
        message = '';
    }
  }
  async function stop() {
    if (!active) return;
    try {
      await call(url, { runId: active.runId }, 'DELETE');
      await load();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Work conversation">
  <header class="border-b border-hairline p-4">
    <h2 class="font-medium text-ink">{data?.work.title ?? work.title}</h2>
    <p class="mt-1 text-xs text-muted">A shared conversation for the Odds on this work.</p>
    {#if data}
      <div class="mt-2 flex flex-wrap gap-2">
        {#each data.work.people as person (person.id)}
          <button class="text-xs text-sea hover:text-ink" onclick={() => onstaff(person.id)}
            >{person.name}'s main chat</button
          >
        {/each}
      </div>
    {/if}
  </header>
  <div class="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
    {#if !data}<p class="text-sm text-muted">Loading the conversation…</p>
    {:else if !data.messages.length}<p class="text-sm text-muted">
        Ask about this work. {name(data.work.lead)} leads it.
      </p>{/if}
    <div class="flex flex-col gap-4">
      {#each data?.messages ?? [] as turn (turn.id)}
        <div class="ms-auto w-[90%] rounded-xl bg-sea/10 p-3 text-sm">
          <span class="mb-1 block text-xs text-muted">You · to {name(turn.staffId)}</span>
          <Markdown text={turn.message} />
        </div>
        <div class="me-auto w-[90%] rounded-xl border border-hairline p-3 text-sm">
          <span class="mb-1 block text-xs text-muted">{name(turn.staffId)}</span>
          {#if turn.status === 'replying'}
            {#if turn.requestId === requestId && partial}<Markdown text={partial} />{/if}
            <p class="mt-1 text-xs text-muted">{name(turn.staffId)} is {doing || 'replying'}…</p>
          {:else}
            <Markdown text={turn.reply ?? ''} />
            {#if turn.status === 'failed' || turn.status === 'stopped'}
              <button
                class="mt-2 text-xs text-sea hover:text-ink"
                disabled={busy || !!message.trim() || data?.work.stopped}
                onclick={() => {
                  message = turn.message;
                  target = turn.staffId;
                }}>Use this message again</button
              >
            {/if}
          {/if}
        </div>
      {/each}
    </div>
    <div bind:this={bottom}></div>
  </div>
  <form
    class="border-t border-hairline p-3"
    onsubmit={(e) => {
      e.preventDefault();
      void send();
    }}
  >
    {#if data?.work.stopped}<p class="mb-2 text-sm text-muted">
        This work is stopped. You can still read its conversation.
      </p>{/if}
    {#if problem}<p class="mb-2 text-sm text-coral" role="alert">{problem}</p>{/if}
    <label class="mb-2 flex items-center gap-2 text-xs text-muted"
      >Answering
      <select
        class="min-w-0 rounded border border-hairline bg-night p-1 text-ink"
        bind:value={target}
        disabled={!data || data.work.stopped || !data.work.people.length}
      >
        {#each data?.work.people ?? [] as person (person.id)}
          <option value={person.id}
            >{person.name}{person.id === data?.work.lead ? ' · lead' : ''}</option
          >
        {/each}
      </select>
    </label>
    <textarea
      class="w-full resize-y rounded-lg border border-hairline bg-night p-2 text-sm text-ink"
      rows="3"
      aria-label="Message about this work"
      placeholder="Talk about this work…"
      bind:value={message}
      disabled={!data || data.work.stopped || !target}></textarea>
    <div class="mt-2 flex items-center justify-end gap-3">
      {#if active}<button type="button" class="text-sm text-coral hover:text-ink" onclick={stop}
          >Stop reply</button
        >{/if}
      <button
        type="submit"
        class="rounded-lg bg-sea px-3 py-1.5 text-sm text-night disabled:opacity-40"
        disabled={!message.trim() || !target || busy || data?.work.stopped}
        >{busy ? 'Replying…' : 'Send'}</button
      >
    </div>
  </form>
</section>
