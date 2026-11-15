<script lang="ts">
  // The phone's Messages: one row per Odd, with its dot and its chat's last
  // line (`previewLine`), each opening its own chat (`ChatPanel.svelte`), as
  // on the computer. An open chat's header has Call. No unread counts yet:
  // the phone does not keep what was read.
  import type { Desk } from '@oddboro/ledger';
  import ChatPanel from '#lib/ui/ChatPanel.svelte';
  import type { Delivered } from '#lib/ui/chat-about.svelte.ts';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import type { Work } from '#lib/staff/work.ts';
  import OddFace from './OddFace.svelte';
  import { aroundLine, waitingOdds, type Presence } from './phone-home.ts';
  import { previewLine, type LastLine } from './phone-messages.ts';

  type Props = {
    staff: StaffProfile[];
    /** The Odd whose chat is open, if any. */
    chatting: string | undefined;
    onchat: (id: string | undefined) => void;
    /** Opens a call with an Odd. */
    oncall: (id: string) => void;
    version: number;
    visible: boolean;
    desk: Desk;
    working: Record<string, string>;
    inProgress: Record<string, Work[]>;
    toStart: Record<string, Work[]>;
    /** Each Odd's chat's last line, by its id. */
    lastLines: Record<string, LastLine>;
    onitem: (staffId: string, d: Delivered) => void;
    /** A chat's reply started or ended, so its last line changed. */
    onsaid: () => void;
  };
  let {
    staff,
    chatting,
    onchat,
    oncall,
    version,
    visible,
    desk,
    working,
    inProgress,
    toStart,
    lastLines,
    onitem,
    onsaid
  }: Props = $props();
  const chatWith = $derived(staff.find((p) => p.id === chatting));
  const nothing = () => {};
  const waiting = $derived(waitingOdds(desk));
  const presence = (id: string): Presence =>
    aroundLine({ working: working[id], work: inProgress[id], waiting: waiting.has(id) }).presence;
  const DOT: Record<Presence, string> = {
    working: 'bg-sea',
    waiting: 'bg-ember',
    free: 'bg-faint'
  };
  const PRESENCE: Record<Presence, string> = {
    working: 'working',
    waiting: 'waiting on you',
    free: 'free'
  };
</script>

<div class="flex h-full flex-col">
  {#if chatWith}
    <div class="flex items-center gap-2 border-b border-hairline px-3 py-1.5">
      <button
        class="flex items-center gap-1.5 rounded-lg bg-raise px-3 text-sm text-ink"
        onclick={() => onchat(undefined)}
      >
        <svg
          class="size-3 rtl:-scale-x-100"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg
        >
        Messages
      </button>
      <span class="min-w-0 flex-1 truncate font-medium">{chatWith.name}</span>
      <button
        class="flex size-11 shrink-0 items-center justify-center rounded-full bg-raise text-sea"
        aria-label={`Call ${chatWith.name}`}
        onclick={() => oncall(chatWith.id)}
      >
        <svg
          class="size-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
          aria-hidden="true"
          ><path
            d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"
          /></svg
        >
      </button>
    </div>
    {#key chatWith.id}
      <div class="min-h-0 flex-1">
        <!-- A plan's hires wait on the Desk tab as Open cards: the phone has no hire window. -->
        <ChatPanel
          profile={chatWith}
          {desk}
          {staff}
          onplan={nothing}
          {version}
          onstart={nothing}
          onend={onsaid}
          {visible}
          onitem={(d) => onitem(chatWith.id, d)}
          work={[...(inProgress[chatWith.id] ?? []), ...(toStart[chatWith.id] ?? [])]}
          onwork={nothing}
        />
      </div>
    {/key}
  {:else}
    <header class="border-b border-hairline px-5 pt-6 pb-4">
      <h1 class="text-2xl font-semibold text-ink">Messages</h1>
    </header>
    <ul class="flex flex-col overflow-y-auto px-2 py-2">
      {#each staff as p (p.id)}
        {@const dot = presence(p.id)}
        <li>
          <button
            class="flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-start"
            onclick={() => onchat(p.id)}
          >
            <span class="relative shrink-0">
              <OddFace odd={p} class="size-14 rounded-xl" />
              <span
                class="absolute -end-1 -bottom-1 size-3.5 rounded-full ring-2 ring-night {DOT[dot]}"
              ></span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-lg font-medium text-ink">{p.name}</span>
              <span class="block truncate text-muted"
                ><span class="sr-only">{PRESENCE[dot]}: </span>{previewLine(lastLines[p.id])}</span
              >
            </span>
          </button>
        </li>
      {:else}
        <li class="py-10 text-center text-muted">No Odds in the office yet.</li>
      {/each}
    </ul>
  {/if}
</div>
