<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { HandOffLine, HandOffStep, LessonLine, PokeRow, ThreadLine } from '@oddboro/ledger';
  import { clockTime } from '@oddboro/ledger/time';
  import Markdown from './Markdown.svelte';
  import Lesson from './Lesson.svelte';
  import { call } from './api.ts';
  import { when, workLine } from './format.ts';
  import { chatRequest, takeDraft, type Delivered } from './chat-about.svelte.ts';
  import type { StaffProfile } from '../staff/roster.ts';
  import { toolWords } from '../staff/work.ts';

  type Props = {
    profile: StaffProfile;
    /** Bumps when the office changes, e.g. a poke lands or is set. */
    version: number;
    /** Fires when a message goes out, so the floor can send the staffer to the owner's office. */
    onstart: () => void;
    /** Fires when the reply is complete or fails. */
    onend: () => void;
    /** False while another tab covers the chat. It stays mounted either way. */
    visible: boolean;
    /** Opens something the staffer delivered, on the start side. */
    onitem: (item: Delivered) => void;
  };

  let { profile, version, onstart, onend, visible, onitem }: Props = $props();

  // A hidden list has no height to scroll, so catch up when it shows.
  $effect(() => {
    if (visible) scrollDown();
  });

  type Line = {
    from: 'owner' | 'staff';
    text: string;
    pending?: boolean;
    failed?: boolean;
    /** Delivered later by the office, at `at`. */
    poke?: boolean;
    at?: string;
    /** Something the staffer put on the desk, shown where it landed. */
    item?: Delivered & { status: string };
    /** What the owner's message replied about. */
    re?: Delivered;
    /** A lesson the staffer kept, shown where it kept it. */
    lesson?: LessonLine;
    /** One step of work handed to a colleague, or from one. */
    handOff?: { line: HandOffLine; step: HandOffStep; back?: number };
    /** A thread the staffer leads, with each hand-off it gave on it. */
    thread?: { line: ThreadLine; steps: HandOffLine[] };
  };
  type Entry = {
    at: string;
    from: 'owner' | 'staff';
    text: string;
    poke?: true;
    item?: Delivered & { status: string };
    re?: Delivered;
    lesson?: LessonLine;
    handOff?: { line: HandOffLine; step: HandOffStep; back?: number };
    thread?: { line: ThreadLine; steps: HandOffLine[] };
  };

  /** Where a hand-off stands, in words, and whether the owner has to act. */
  function progress(h: HandOffLine): { text: string; yours: boolean } {
    if (h.status === 'queued') return { text: `${h.to} has not started yet`, yours: false };
    // Back on it: the owner answered what an earlier step put on the desk.
    if (h.status === 'working')
      return { text: `${h.to} is ${h.backs.length ? 'back on it' : 'on it'}`, yours: false };
    // A denial or a dropped task is the owner's answer, not the colleague failing.
    const ended = h.answered
      ? 'You answered'
      : {
          done: `${h.to} finished`,
          failed: `${h.to} could not finish`,
          waiting: `${h.to} is waiting on you`
        }[h.status];
    const next = h.backs.at(-1)?.pickUp.status;
    if (!next || next === 'queued' || next === 'working')
      return { text: `${ended} · ${h.from} is taking it from here`, yours: h.status === 'waiting' };
    // Something on the desk outranks how the pick-up went: it still needs the owner.
    if (next === 'waiting' || h.status === 'waiting')
      return { text: 'Waiting on you', yours: true };
    if (next === 'failed') return { text: `${h.from} could not pick it up`, yours: false };
    return { text: h.status === 'done' ? 'Done' : ended, yours: false };
  }
  /** A thread's steps in the order they happened: each hand-off given, and each run of the hub's own. */
  function threadSteps(
    t: NonNullable<Line['thread']>
  ): ({ at: string; h: HandOffLine } | { at: string; run: ThreadLine['runs'][number] })[] {
    return [
      ...t.steps.map((h) => ({ at: String(h.at), h })),
      ...t.line.runs.map((run) => ({ at: String(run.at), run }))
    ].sort((a, b) => a.at.localeCompare(b.at));
  }
  /** A block that only names what follows: headings, or a bold line on its own. */
  const label = (block: string) =>
    block.split('\n').every((l) => /^(#{1,6}\s.*|\*\*[^*]+\*\*:?)$/.test(l.trim()));
  /**
   * What the owner sees of a hand-off's text before opening it: its opening
   * paragraph, which the Odds' briefs ask them to write for the owner, with any
   * label above it. A lead still over `LONG` is cut and fades.
   */
  function lead(text: string): { text: string; more: boolean } {
    const blocks = text
      .replace(/\r\n?/g, '\n')
      .trim()
      .split(/\n\s*\n/);
    const i = blocks.findIndex((b) => !label(b));
    if (i < 0 || i === blocks.length - 1) return { text, more: false };
    return { text: blocks.slice(0, i + 1).join('\n\n'), more: true };
  }
  const LONG = 600;
  /** The hand-off stories and texts the owner opened. */
  const opened = new SvelteSet<string>();
  const toggle = (key: string) => opened.delete(key) || opened.add(key);

  const KIND: Record<Delivered['kind'], string> = {
    ask: 'Ask',
    task: 'Task for you',
    report: 'Report'
  };
  const STATUS: Record<string, string> = {
    open: 'Waiting on you',
    approved: 'Approved',
    denied: 'Denied',
    revise: 'Sent back',
    done: 'Done',
    dropped: 'Dropped',
    new: 'New',
    read: 'Read'
  };
  const keyOf = (d: Delivered) => `${d.kind}-${d.id}`;

  /** The delivery selected here, e.g. opened on the desk. */
  const selected = $derived(
    chatRequest.focus?.staff === profile.id ? keyOf(chatRequest.focus.item) : undefined
  );
  /** The delivery the next message replies about. */
  let replyTo = $state<Delivered | undefined>();

  function pick(d: Delivered) {
    chatRequest.focus = { staff: profile.id, item: d };
    onitem(d);
  }
  async function reply(d: Delivered) {
    chatRequest.focus = { staff: profile.id, item: d };
    replyTo = d;
    await tick();
    box?.focus();
  }

  // Reply on the desk or a report window arrives here once the chat shows.
  $effect(() => {
    const r = chatRequest.reply;
    if (r?.staff !== profile.id || !visible) return;
    chatRequest.reply = undefined;
    void reply(r.item);
  });

  // Bring the selected delivery into view once the history is in.
  $effect(() => {
    if (!selected || !loaded || !visible) return;
    void tick().then(() =>
      list
        ?.querySelector(`[data-item="${selected}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    );
  });
  let lines = $state<Line[]>([]);
  let draft = $state('');
  let sending = $state(false);
  let status = $state('');
  let loaded = $state(false);
  let list: HTMLDivElement | undefined = $state();

  async function scrollDown() {
    await tick();
    list?.scrollTo({ top: list.scrollHeight });
  }

  // Reading the newest message stays reading it when the list gets shorter:
  // the input growing as the owner types, the panel resizing.
  function pin(node: HTMLDivElement) {
    let atBottom = true;
    const scrolled = () => (atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 8);
    const resized = new ResizeObserver(() => {
      if (atBottom) node.scrollTop = node.scrollHeight;
    });
    node.addEventListener('scroll', scrolled);
    resized.observe(node);
    return () => {
      node.removeEventListener('scroll', scrolled);
      resized.disconnect();
    };
  }

  /** Pokes the staffer set that have not landed yet. */
  let upcoming = $state<PokeRow[]>([]);

  function load(id: string) {
    fetch(`/api/staff/${id}/chat`)
      .then((r) => r.json())
      .then((d: { history: Entry[]; busy: boolean }) => {
        lines = d.history.map((h) => ({ ...h }));
        loaded = true;
        scrollDown();
      })
      .catch(() => (loaded = true));
    call<PokeRow[]>(`/api/staff/${id}/pokes`)
      .then((p) => (upcoming = p))
      .catch(() => {});
  }

  $effect(() => {
    loaded = false;
    load(profile.id);
  });
  // A poke landing or being set changes the office: catch up, unless a reply
  // is streaming into the list right now.
  let seen = 0;
  $effect(() => {
    if (version === seen) return;
    seen = version;
    if (!sending) load(profile.id);
  });

  // The chat on screen means its pokes are read; the page then lets the staffer go.
  // Also when one lands while the chat is open: it shows, so it is read.
  $effect(() => {
    void lines.length;
    if (visible && loaded) void call(`/api/staff/${profile.id}/pokes`, {}).catch(() => {});
  });

  async function now(p: PokeRow) {
    await call(`/api/pokes/${p.id}`, {}).catch(() => {});
    upcoming = upcoming.filter((x) => x.id !== p.id);
  }

  async function cancel(p: PokeRow) {
    await call(`/api/pokes/${p.id}`, undefined, 'DELETE').catch(() => {});
    upcoming = upcoming.filter((x) => x.id !== p.id);
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    const message = draft.trim();
    if (!message || sending) return;
    const re = replyTo;
    draft = '';
    replyTo = undefined;
    sending = true;
    status = 'Thinking';
    lines.push({ from: 'owner', text: message, re });
    lines.push({ from: 'staff', text: '', pending: true });
    const reply = lines[lines.length - 1];
    scrollDown();
    onstart();
    try {
      const res = await fetch(`/api/staff/${profile.id}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, re: re && { kind: re.kind, id: re.id } })
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6)) as
            | { type: 'delta'; text: string }
            | { type: 'tool'; name: string }
            | { type: 'done'; text: string }
            | { type: 'error'; message: string };
          if (ev.type === 'delta') {
            reply.text += ev.text;
            status = '';
          } else if (ev.type === 'tool') status = toolWords(ev.name);
          else if (ev.type === 'done') {
            reply.text = ev.text;
            reply.pending = false;
          } else if (ev.type === 'error') {
            reply.text = ev.message;
            reply.pending = false;
            reply.failed = true;
          }
          scrollDown();
        }
      }
    } catch (err) {
      reply.text = err instanceof Error ? err.message : String(err);
      reply.failed = true;
    } finally {
      reply.pending = false;
      sending = false;
      status = '';
      onend();
      scrollDown();
      // Show what the reply changed: a report it read, a lesson it kept.
      if (!reply.failed) load(profile.id);
    }
  }

  // A chat started from a report arrives as a draft: add it to the box and
  // put the cursor at the end, for the owner to say what the owner wants. One
  // started from the agents search arrives empty and only takes the cursor.
  $effect(() => {
    if (chatRequest.drafts[profile.id] === undefined || !visible) return;
    const d = takeDraft(profile.id) ?? '';
    if (d) draft = draft.trim() ? `${draft.trimEnd()}\n\n${d}` : d;
    void tick().then(() => {
      fit();
      box?.focus();
      box?.setSelectionRange(draft.length, draft.length);
    });
  });

  // The input grows with what the owner types, up to most of the panel. Dragging
  // the bar above it sets how tall it is at least, and that height is kept.
  const MIN_INPUT = 38;
  let box: HTMLTextAreaElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();
  let floor = $state(MIN_INPUT);
  try {
    floor = Math.max(MIN_INPUT, Number(localStorage.getItem('oddboro.chat.input')) || MIN_INPUT);
  } catch {
    // No storage: start at one line.
  }
  const ceiling = () => Math.max(MIN_INPUT, (root?.clientHeight ?? 600) * 0.6);

  function fit() {
    if (!box) return;
    // Measured first: the brief auto height below scrolls the list on its own.
    const pinned = list ? list.scrollHeight - list.scrollTop - list.clientHeight < 8 : false;
    box.style.blockSize = 'auto';
    box.style.blockSize = `${Math.min(ceiling(), Math.max(floor, box.scrollHeight))}px`;
    if (pinned && list) list.scrollTop = list.scrollHeight;
  }
  $effect(() => {
    void draft;
    void floor;
    void visible;
    fit();
  });

  let pull: { y: number; h: number } | undefined;
  function grab(e: PointerEvent) {
    pull = { y: e.clientY, h: box?.offsetHeight ?? floor };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function drag(e: PointerEvent) {
    // The input sits at the bottom, so pulling the bar up makes it taller.
    if (pull)
      floor = Math.round(Math.min(ceiling(), Math.max(MIN_INPUT, pull.h + pull.y - e.clientY)));
  }
  function release() {
    if (!pull) return;
    pull = undefined;
    keep();
  }
  function nudge(e: KeyboardEvent) {
    const step = e.key === 'ArrowUp' ? 24 : e.key === 'ArrowDown' ? -24 : 0;
    if (!step) return;
    e.preventDefault();
    floor = Math.min(ceiling(), Math.max(MIN_INPUT, floor + step));
    keep();
  }
  function keep() {
    try {
      localStorage.setItem('oddboro.chat.input', String(floor));
    } catch {
      // Private window: the height lasts this visit only.
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }
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
  {@const p = progress(h)}
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

<div class="flex h-full min-h-0 flex-col" bind:this={root}>
  <div
    bind:this={list}
    {@attach pin}
    class="flex flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-3"
  >
    {#if loaded && lines.length === 0}
      <p class="m-auto max-w-[240px] text-center text-sm text-muted">
        Say hello to {profile.name}, who walks to your office while you talk.
      </p>
    {/if}
    {#each lines as line, i (i)}
      {#if line.lesson}
        <Lesson lesson={line.lesson} name={profile.name} />
      {:else if line.thread}
        <!-- One card per piece of work the Odd leads: where it stands, and each step on Open. -->
        {@const t = line.thread.line}
        {@const p = workLine({ ...t, lead: t.hub })}
        {@const key = `thread-${t.id}`}
        <div
          class="me-auto w-[85%] rounded-2xl rounded-es-md border border-sea/40 px-3 py-2 text-sm"
        >
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
              onclick={() => pick(w)}>{KIND[w.kind]}: {w.title}</button
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
                      >{t.hub} picked it back up · {when(s.at)}{s.run.outcome
                        ? ''
                        : ' · working'}</span
                    >
                    {#if s.run.text}{@render full(s.run.text, `${key}-run-${n}`, profile.id)}{/if}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {:else if line.handOff}
        {@const h = line.handOff.line}
        {@const step = line.handOff.step}
        {@const p = progress(h)}
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
      {:else if line.item}
        {@const it = line.item}
        <div class="-mb-1 ms-1 text-[10px] tracking-[0.16em] text-sea uppercase">
          {KIND[it.kind]}{line.at ? ` · ${when(line.at)}` : ''}
        </div>
        <div class="me-auto flex w-[85%] flex-col items-start gap-1" data-item={keyOf(it)}>
          <button
            class="w-full rounded-2xl rounded-es-md bg-raise px-3 py-2 text-start text-sm transition-colors hover:bg-sea/15 {selected ===
            keyOf(it)
              ? 'ring-1 ring-sea'
              : ''}"
            aria-pressed={selected === keyOf(it)}
            title={`Open this ${KIND[it.kind].toLowerCase()}`}
            onclick={() => pick(it)}
          >
            <span class="block font-medium break-words text-ink">{it.title}</span>
            <span
              class="text-xs {it.status === 'open' || it.status === 'new'
                ? 'text-ember'
                : 'text-muted'}">{STATUS[it.status] ?? it.status}</span
            >
          </button>
          <button
            class="ms-1 text-xs text-muted hover:text-ink"
            aria-label={`Reply about ${it.title}`}
            onclick={() => reply(it)}>Reply</button
          >
        </div>
      {:else}
        {#if line.re}
          <button
            class="-mb-1 me-1 ms-auto max-w-[85%] truncate text-[10px] text-faint hover:text-ink"
            title={`Open ${line.re.title}`}
            onclick={() => line.re && pick(line.re)}>↩ {line.re.title}</button
          >
        {/if}
        {#if line.poke}
          <div class="-mb-1 ms-1 text-[10px] tracking-[0.16em] text-ember uppercase">
            Poke{line.at ? ` · ${clockTime(new Date(line.at))}` : ''}
          </div>
        {/if}
        <div
          class="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words
          {line.from === 'owner'
            ? 'ms-auto rounded-ee-md bg-sea/25 whitespace-pre-wrap text-ink'
            : 'me-auto rounded-es-md bg-raise text-ink'}"
          class:text-coral={line.failed}
        >
          {#if line.pending && !line.text}
            <span class="dots" aria-label="Replying"><span></span><span></span><span></span></span>
          {:else if line.from === 'staff' && !line.failed}
            <Markdown text={line.text} staff={profile.id} />
          {:else}
            {line.text}
          {/if}
        </div>
        {#if line.pending}
          <!-- What the staffer is doing, under the reply it is working on. -->
          <div class="-mt-1 ms-1 text-xs text-muted" aria-live="polite">
            {profile.name} is {status ? status.toLowerCase() : 'replying'}…
          </div>
        {/if}
      {/if}
    {/each}
    <!-- A poke to come keeps its words until it lands as a message, at the bottom. -->
    {#each upcoming as p (p.id)}
      <div class="me-auto ms-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>{profile.name} will message you at {clockTime(new Date(p.at))}.</span>
        <button class="text-sea hover:text-ink" onclick={() => now(p)}>Send now</button>
        <button
          class="text-faint hover:text-coral"
          aria-label={`Cancel the ${clockTime(new Date(p.at))} poke`}
          onclick={() => cancel(p)}>Cancel</button
        >
      </div>
    {/each}
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions: a focusable separator is the ARIA pattern for a keyboard-resizable pane. -->
  <div
    class="grip"
    role="separator"
    aria-orientation="horizontal"
    aria-label="Resize the message box"
    aria-valuenow={floor}
    tabindex="0"
    onpointerdown={grab}
    onpointermove={drag}
    onpointerup={release}
    onpointercancel={release}
    onkeydown={nudge}
  ></div>
  {#if replyTo}
    <div class="flex items-center gap-2 px-3 pb-1.5 text-xs text-muted">
      <span class="min-w-0 flex-1 truncate"
        >Replying about {KIND[replyTo.kind].toLowerCase()} “{replyTo.title}”</span
      >
      <button
        class="shrink-0 px-1 text-faint hover:text-coral"
        aria-label="Stop replying"
        onclick={() => (replyTo = undefined)}>✕</button
      >
    </div>
  {/if}
  <form class="flex items-end gap-2 px-3 pb-3" novalidate onsubmit={send}>
    <textarea
      bind:this={box}
      class="min-h-[38px] flex-1 resize-none overflow-y-auto rounded-lg bg-raise px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
      rows="1"
      placeholder={replyTo ? `Reply to ${profile.name}` : `Message ${profile.name}`}
      bind:value={draft}
      {onkeydown}
      disabled={sending}></textarea>
    <button
      class="rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
      disabled={sending || !draft.trim()}>Send</button
    >
  </form>
</div>

<style>
  .grip {
    position: relative;
    block-size: 12px;
    border-block-start: 1px solid var(--color-hairline);
    cursor: row-resize;
    touch-action: none;
  }
  .grip::after {
    content: '';
    position: absolute;
    inset-block-start: 4px;
    inset-inline: calc(50% - 16px);
    block-size: 3px;
    border-radius: 3px;
    background: var(--color-hairline);
  }
  .grip:hover::after,
  .grip:focus-visible::after {
    background: var(--color-muted);
  }
  .grip:focus-visible {
    outline: none;
  }
  .dots {
    display: inline-flex;
    gap: 3px;
    padding: 4px 0;
  }
  .dots span {
    width: 5px;
    height: 5px;
    border-radius: 99px;
    background: var(--color-muted);
    animation: blink 1.2s infinite ease-in-out;
  }
  .dots span:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dots span:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes blink {
    0%,
    80%,
    100% {
      opacity: 0.25;
    }
    40% {
      opacity: 1;
    }
  }
  /* A long hand-off text fades out where it is cut, until the owner opens it. */
  .clamped {
    mask-image: linear-gradient(to bottom, black 70%, transparent);
  }
</style>
