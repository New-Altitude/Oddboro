<script lang="ts">
  // A call with one Odd, over any tab. It is that Odd's ordinary chat
  // (`/api/staff/[id]/chat`): the chat's last lines open it as captions, and
  // a reply shows as it streams. Talk opens the Type box, so the phone
  // keyboard's own mic dictates. Back names where the call was opened from.
  // The timer ticks only while the call is on screen, and the bars move only
  // while a reply is coming in.
  import { tick } from 'svelte';
  import type { Desk } from '@oddboro/ledger';
  import type { ApiUrl } from '#lib/ui/api.ts';
  import Markdown from '#lib/ui/Markdown.svelte';
  import { serviceNames } from '#lib/ui/service-names.svelte.ts';
  import { hideChoiceLines } from '#lib/choices.ts';
  import type { ChatEntry } from '#lib/staff/chat.ts';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import { toolWords, type Work } from '#lib/staff/work.ts';
  import OddFace from './OddFace.svelte';
  import {
    alsoLine,
    captionsFrom,
    clock,
    readChatStream,
    waitingFor,
    type Caption
  } from './phone-call.ts';

  type Props = {
    odd: StaffProfile;
    /** Where the call was opened from, for Back: "Home", "Messages", "Desk" or a goal's name. */
    from: string;
    desk: Desk;
    work: Work[] | undefined;
    /** Bumps on a change the chat reloads for, as on the computer. */
    version: number;
    /** Ends the call. */
    onend: () => void;
    /** Opens a desk item, by its key, on the Desk tab. */
    onopen: (key: string) => void;
    ondesk: () => void;
    /** A reply landed, so the chat's last line changed. */
    onsaid: () => void;
  };
  let { odd, from, desk, work, version, onend, onopen, ondesk, onsaid }: Props = $props();

  let captions = $state<Caption[]>([]);
  let choices = $state<string[]>([]);
  /** True while the office still answers a message sent elsewhere, such as at the computer. */
  let busyElsewhere = $state(false);
  let sending = $state(false);
  /** What the Odd is doing while no words have come yet. */
  let doing = $state('');
  let problem = $state('');
  let draft = $state('');
  let typing = $state(false);
  let talkHint = $state(false);
  let box: HTMLTextAreaElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  async function scrollDown() {
    await tick();
    list?.scrollTo({ top: list.scrollHeight });
  }

  async function load() {
    try {
      const r = await fetch(`/api/staff/${odd.id}/chat` satisfies ApiUrl);
      if (!r.ok) throw new Error(await r.text());
      const d = (await r.json()) as { history: ChatEntry[]; busy: boolean };
      // A reply streaming in meanwhile is on screen already: keep it.
      if (sending) return;
      problem = '';
      captions = captionsFrom(d.history);
      const last = d.history.at(-1);
      choices = last?.from === 'staff' && last.choices?.length ? last.choices : [];
      busyElsewhere = d.busy;
      void scrollDown();
    } catch {
      problem = "Can't reach the office. It tries again when the office changes.";
    }
  }
  $effect(() => {
    void version;
    void load();
  });

  // The timer: from when the call opened, once a second, only while the page shows.
  const started = Date.now();
  let now = $state(Date.now());
  $effect(() => {
    let t: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      clearInterval(t);
      t = undefined;
      now = Date.now();
      if (document.visibilityState === 'visible') t = setInterval(() => (now = Date.now()), 1000);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', run);
    };
  });

  const waiting = $derived(waitingFor(desk, odd.id));
  const also = $derived(alsoLine(work, new Date(now - (now % 60_000))));
  const live = $derived(captions.at(-1)?.live === true);
  const talking = $derived(live && !!captions.at(-1)?.text);
  const status = $derived(
    talking
      ? 'Talking'
      : sending
        ? doing || 'Thinking'
        : busyElsewhere
          ? 'Replying at the office'
          : 'On the line'
  );

  /** Sends a message, unless the Odd is still replying; says whether it went. */
  async function say(message: string): Promise<boolean> {
    const text = message.trim();
    if (!text || sending) return false;
    // A reply at the computer ending tells the phone nothing: ask again first.
    if (busyElsewhere) await load();
    if (busyElsewhere || sending) return false;
    void talk(text);
    return true;
  }

  async function talk(text: string) {
    problem = '';
    choices = [];
    sending = true;
    doing = '';
    captions.push({ from: 'owner', text });
    captions.push({ from: 'staff', text: '', live: true });
    const reply = captions[captions.length - 1];
    void scrollDown();
    try {
      const res = await fetch(`/api/staff/${odd.id}/chat` satisfies ApiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text })
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);
      await readChatStream(res.body, (ev) => {
        if (ev.type === 'delta') {
          reply.text += ev.text;
          doing = '';
        } else if (ev.type === 'tool') doing = toolWords(ev.name, serviceNames.byId);
        else if (ev.type === 'done') {
          reply.text = ev.text;
          choices = ev.choices ?? [];
        } else if (ev.type === 'error') {
          reply.text = ev.message;
          reply.failed = true;
        }
        void scrollDown();
      });
    } catch (err) {
      reply.text = err instanceof Error ? err.message : String(err);
      reply.failed = true;
    } finally {
      reply.live = false;
      sending = false;
      doing = '';
      onsaid();
      void scrollDown();
    }
  }

  function send(e: SubmitEvent) {
    e.preventDefault();
    void say(draft).then((went) => {
      if (!went) return;
      draft = '';
      talkHint = false;
    });
  }

  /** Opens the Type box. With `talk`, says to use the keyboard's mic. */
  async function openBox(talk: boolean) {
    typing = true;
    talkHint = talk;
    await tick();
    box?.focus();
  }
</script>

<section class="call flex h-full flex-col" aria-label={`Call with ${odd.name}`}>
  <header class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pt-4">
    <button
      class="flex items-center gap-1 justify-self-start rounded-lg px-1 text-muted"
      onclick={onend}
    >
      <svg
        class="size-4 rtl:-scale-x-100"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg
      >
      <span class="max-w-[7rem] truncate">{from}</span>
    </button>
    <div class="min-w-0 text-center">
      <h1 class="truncate text-xl font-semibold text-ink">{odd.name}</h1>
      <p class="flex items-center justify-center gap-1.5 truncate text-sm text-moss">
        <span class="size-2 shrink-0 rounded-full bg-moss" aria-hidden="true"></span>
        <span class="truncate">{odd.role} · on a call</span>
      </p>
    </div>
    <span class="justify-self-end text-sm text-muted tabular-nums" aria-label="Call time"
      >{clock(now - started)}</span
    >
  </header>

  <div class="flex flex-col items-center px-4 pt-5">
    <div class="portrait rounded-[2.75rem] p-1.5">
      <OddFace {odd} class="size-40 rounded-[2.25rem] sm:size-48" />
    </div>
    <div class="bars mt-4 flex h-6 items-end gap-1" class:moving={talking} aria-hidden="true">
      {#each [0.35, 0.7, 0.5, 1, 0.6, 0.8, 0.3] as h, i (i)}
        <span class="w-1.5 rounded-full bg-sea" style={`--h:${h}; --i:${i}`}></span>
      {/each}
    </div>
    <p class="mt-2 max-w-full truncate text-sm text-muted" aria-live="polite">
      {status}{#if also}<span> · {also}</span>{/if}
    </p>
  </div>

  {#if waiting.length}
    {@const first = waiting[0]}
    <div
      class="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-ember/40 bg-ember/10 px-4 py-2.5"
    >
      <div class="min-w-0 flex-1">
        <p class="head text-ember">Waiting on you</p>
        <p class="truncate text-ink">
          {first.row.title}{#if waiting.length > 1}<span class="text-muted">
              and {waiting.length - 1} more</span
            >{/if}
        </p>
      </div>
      <button
        class="shrink-0 rounded-xl bg-ember px-4 font-medium text-night"
        onclick={() => onopen(first.key)}>Open</button
      >
    </div>
  {/if}

  <ol bind:this={list} class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-4">
    {#each captions as c, i (i)}
      <li
        class="max-w-[85%] rounded-2xl px-4 py-2.5 text-[1.05rem] leading-snug {c.from === 'owner'
          ? 'self-end bg-sea text-night'
          : c.failed
            ? 'self-start bg-coral/15 text-coral'
            : 'self-start bg-panel-solid text-ink'}"
      >
        {#if c.from === 'staff' && !c.failed}
          {#if c.live && !c.text}
            <span class="text-muted">{status}</span>
          {:else}
            <Markdown text={c.live ? hideChoiceLines(c.text) : c.text} staff={odd.id} />
          {/if}
        {:else}
          {c.text}
        {/if}
      </li>
    {:else}
      <li class="self-center py-4 text-sm text-muted">Say something to {odd.name}.</li>
    {/each}
    {#if choices.length && !sending}
      <li class="flex flex-col items-end gap-2">
        {#each choices as c (c)}
          <button
            class="rounded-2xl border border-sea/50 px-4 text-start text-ink"
            onclick={() => say(c)}>{c}</button
          >
        {/each}
      </li>
    {/if}
  </ol>

  {#if problem}
    <p class="px-4 pb-2 text-sm text-coral">{problem}</p>
  {/if}

  {#if typing}
    <form class="flex items-end gap-2 px-4 pb-3" onsubmit={send}>
      <label class="min-w-0 flex-1">
        <span class="sr-only">Message {odd.name}</span>
        {#if talkHint}
          <span class="mb-1 block text-xs text-muted"
            >Tap the mic on your keyboard and talk. Send when you're done.</span
          >
        {/if}
        <textarea
          bind:this={box}
          bind:value={draft}
          rows="2"
          class="w-full resize-none rounded-2xl border border-hairline bg-panel-solid px-4 py-2.5 text-ink placeholder:text-faint"
          placeholder={`Message ${odd.name}`}></textarea>
      </label>
      <button
        class="rounded-2xl bg-sea px-4 font-medium text-night disabled:opacity-40"
        disabled={!draft.trim() || sending}>Send</button
      >
    </form>
  {/if}
  {#if busyElsewhere && !sending}
    <p class="px-4 pb-2 text-sm text-muted">
      {odd.name} is still answering a message from the office.
    </p>
  {/if}

  <nav class="controls flex items-start justify-around px-2 pt-2" aria-label="Call controls">
    <button class="ctl" onclick={() => (typing ? (typing = false) : openBox(false))}>
      <span class="disc bg-panel-solid text-muted" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M3 7h18v11H3zM7 11h1m3 0h1m3 0h1m-9 3h8" /></svg>
      </span>
      {typing ? 'Hide' : 'Type'}
    </button>
    <button class="ctl" onclick={() => openBox(true)}>
      <span class="disc big bg-sea text-night" aria-hidden="true">
        <svg viewBox="0 0 24 24"
          ><path
            d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3M6 11a6 6 0 0 0 12 0M12 17v4"
          /></svg
        >
      </span>
      Talk
    </button>
    <button class="ctl" onclick={ondesk}>
      <span class="disc bg-panel-solid text-muted" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h3" /></svg>
      </span>
      Desk
    </button>
    <button class="ctl" onclick={onend}>
      <span class="disc bg-coral text-night" aria-hidden="true">
        <svg viewBox="0 0 24 24"
          ><path d="M3 14c5-5 13-5 18 0l-2.5 2.5-3.5-1.5v-2.5a10 10 0 0 0-6 0V15l-3.5 1.5z" /></svg
        >
      </span>
      End
    </button>
  </nav>
</section>

<style>
  .call {
    background: radial-gradient(
      ellipse 90% 45% at 50% 22%,
      var(--color-sea-night),
      var(--color-night)
    );
    padding-block-end: env(safe-area-inset-bottom);
  }
  .portrait {
    background: var(--color-sea);
    box-shadow: 0 0 3rem -0.5rem color-mix(in srgb, var(--color-sea) 55%, transparent);
  }
  .head {
    font-size: 0.75rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }
  .bars span {
    height: calc(var(--h) * 100%);
    opacity: 0.45;
    transition: opacity 0.2s;
  }
  /* The bars move only while a reply is coming in, and stand still under reduced motion. */
  .bars.moving span {
    opacity: 1;
    animation: talk 0.9s ease-in-out infinite alternate;
    animation-delay: calc(var(--i) * -0.13s);
  }
  @media (prefers-reduced-motion: reduce) {
    .bars.moving span {
      animation: none;
    }
  }
  @keyframes talk {
    from {
      transform: scaleY(0.35);
    }
    to {
      transform: scaleY(1);
    }
  }
  .bars span {
    transform-origin: bottom;
  }
  .ctl {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.875rem;
    color: var(--color-muted);
  }
  .disc {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.75rem;
    height: 3.75rem;
    border-radius: 9999px;
  }
  .disc.big {
    width: 4.75rem;
    height: 4.75rem;
  }
  .disc svg {
    width: 1.6rem;
    height: 1.6rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
