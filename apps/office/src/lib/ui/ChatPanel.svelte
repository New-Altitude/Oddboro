<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { HandOffLine, HandOffStep, LessonLine, PokeRow, ThreadLine } from '@oddboro/ledger';
  import { FIRST_QUESTIONS, firstQuestionIn } from '@oddboro/ledger/first-questions';
  import { clockTime } from '@oddboro/ledger/time';
  import Markdown from './Markdown.svelte';
  import Lesson from './Lesson.svelte';
  import { call } from './api.ts';
  import { when, workLine } from './format.ts';
  import { chatRequest, takeDraft, type Delivered } from './chat-about.svelte.ts';
  import type { StaffProfile } from '../staff/roster.ts';
  import { runningFor, toolWords, type Work } from '../staff/work.ts';
  import { counting, dayBreaks, fullDate, stamp, took } from './chat-lines.ts';
  import { serviceNames } from './service-names.svelte.ts';

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
    /** Everything the Odd is working on now, shown at the foot of the chat. */
    work: Work[];
    /** Opens the info page at In progress. */
    onwork: () => void;
  };

  let { profile, version, onstart, onend, visible, onitem, work, onwork }: Props = $props();

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
    /** How long the run behind a reply took, in milliseconds. */
    took?: number;
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
    took?: number;
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
  /**
   * What the owner sent while a reply was still coming: it goes once that
   * reply ends. A second Send while one waits joins it, so the Odd answers
   * both in one turn.
   */
  let waiting = $state<{ text: string; re?: Delivered } | undefined>();
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

  /**
   * The clock the chat's times read. It moves when the page re-renders
   * anyway, and once a minute only while a stamp still counts minutes or work
   * is in progress, so a still chat redraws nothing.
   */
  let clock = $state(Date.now());
  const ticking = $derived(
    work.length > 0 || lines.some((l) => l.at && counting(l.at, new Date(clock)))
  );
  $effect(() => {
    if (!visible || !ticking) return;
    const timer = setInterval(() => (clock = Date.now()), 60_000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    void work;
    void lines.length;
    void visible;
    clock = Date.now();
  });
  /** The day break above each line, if any. */
  const breaks = $derived(
    dayBreaks(
      lines.map((l) => l.at),
      new Date(clock)
    )
  );

  /** The line whose text was just copied, which says so for a moment. */
  let copied = $state<number | undefined>();
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    copied = i;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = undefined), 1500);
  }

  /** Pokes the staffer set that have not landed yet. */
  let upcoming = $state<PokeRow[]>([]);

  function load(id: string) {
    fetch(`/api/staff/${id}/chat`)
      .then((r) => r.json())
      .then((d: { history: Entry[]; busy: boolean }) => {
        // A message that started meanwhile is streaming into the list: keep it.
        if (sending) return;
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
    if (!message) return;
    const re = replyTo;
    draft = '';
    replyTo = undefined;
    if (sending) {
      waiting = waiting
        ? { text: `${waiting.text}\n\n${message}`, re: waiting.re ?? re }
        : { text: message, re };
      scrollDown();
      return;
    }
    await say(message, re);
  }

  /** Take back the message waiting to go: it returns to the box. */
  function unwait() {
    if (!waiting) return;
    draft = draft.trim() ? `${waiting.text}\n\n${draft}` : waiting.text;
    replyTo ??= waiting.re;
    waiting = undefined;
    void tick().then(() => {
      fit();
      box?.focus();
    });
  }

  /**
   * The answers to tap under the manager's first questions (`FIRST_QUESTIONS`):
   * only while the question is the chat's last line. Typing an answer works too.
   */
  const answers = $derived.by(() => {
    const last = lines.at(-1);
    if (sending || !last || last.from !== 'staff' || last.pending || last.failed) return [];
    return FIRST_QUESTIONS[firstQuestionIn(last.text)]?.answers ?? [];
  });

  /** Send one message and stream the reply into the chat. */
  async function say(message: string, re?: Delivered) {
    sending = true;
    status = 'Thinking';
    lines.push({ from: 'owner', text: message, re, at: new Date().toISOString() });
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
          } else if (ev.type === 'tool') status = toolWords(ev.name, serviceNames.byId);
          else if (ev.type === 'done') {
            reply.text = ev.text;
            reply.pending = false;
            reply.at = new Date().toISOString();
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
      const next = waiting;
      waiting = undefined;
      // What the owner sent meanwhile goes now; its reply reloads the chat after.
      if (next) void say(next.text, next.re);
      // Show what the reply changed: a report it read, a lesson it kept.
      else if (!reply.failed) load(profile.id);
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

<!-- The line under a message: when, how long its run took, Reply when there is something to reply about, then Copy, split by thin bars. -->
{#snippet meta(line: Line, i: number)}
  <div
    class="meta -mt-1 flex items-center text-[11px] leading-none text-faint {line.from === 'owner'
      ? 'owner ms-auto me-1'
      : 'ms-1 me-auto'}"
  >
    {#if line.at}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex: focusing the time shows its full date, as hovering does. -->
      <span class="stamp" tabindex="0">
        <time datetime={line.at}>{stamp(line.at, new Date(clock))}</time>
        <span class="tip" role="tooltip">{fullDate(line.at)}</span>
      </span>
    {/if}
    {#if line.took}<span>{took(line.took)}</span>{/if}
    {#if line.item}
      {@const it = line.item}
      <button
        class="hover:text-ink"
        aria-label={`Reply about ${it.title}`}
        onclick={() => reply(it)}>Reply</button
      >
    {/if}
    <button
      class="stamp hover:text-ink"
      aria-label={copied === i ? 'Copied' : 'Copy this message'}
      onclick={() => copy(i, line.text)}
    >
      <svg
        class="size-3"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
        aria-hidden="true"
        ><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5" /><path
          d="M10.5 5.5V3.5A1.5 1.5 0 0 0 9 2H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"
        /></svg
      >
      {#if copied === i}<span class="tip shown" aria-live="polite">Copied</span>{/if}
    </button>
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
      {#if breaks[i]}
        <!-- A new day in the office's time zone. -->
        <div class="flex items-center gap-2 py-1 text-[11px] text-faint">
          <span class="h-px flex-1 bg-hairline"></span>{breaks[i]}<span
            class="h-px flex-1 bg-hairline"
          ></span>
        </div>
      {/if}
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
          {KIND[it.kind]}
        </div>
        <div class="me-auto w-[85%]" data-item={keyOf(it)}>
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
        </div>
        {@render meta(line, i)}
      {:else}
        {#if line.re}
          <button
            class="-mb-1 me-1 ms-auto max-w-[85%] truncate text-[10px] text-faint hover:text-ink"
            title={`Open ${line.re.title}`}
            onclick={() => line.re && pick(line.re)}>↩ {line.re.title}</button
          >
        {/if}
        {#if line.poke}
          <div class="-mb-1 ms-1 text-[10px] tracking-[0.16em] text-ember uppercase">Poke</div>
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
        {:else}
          {@render meta(line, i)}
        {/if}
      {/if}
    {/each}
    {#if waiting}
      <!-- Sent while the reply above was still coming: it goes when that reply ends. -->
      <div class="ms-auto flex max-w-[85%] flex-col items-end gap-0.5">
        <div
          class="rounded-2xl rounded-ee-md border border-dashed border-sea/40 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink"
        >
          {waiting.text}
        </div>
        <div class="flex gap-3 pe-1 text-[10px] text-faint">
          <span>Sends when {profile.name} finishes</span>
          <button class="hover:text-coral" onclick={unwait}>Cancel</button>
        </div>
      </div>
    {/if}
    {#if answers.length}
      <!-- Each answer a full-width choice on the owner's side, the default first and marked. -->
      <div class="ms-auto flex w-[85%] flex-col gap-1.5" role="group" aria-label="Answers">
        {#each answers as a, n (a)}
          <button class="choice" onclick={() => say(a)}>
            <span class="min-w-0 flex-1">{a}</span>
            {#if n === 0}<span class="default">Default</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
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

  {#if work.length}
    <!-- What the Odd is working on now, one line each; a click opens In progress. -->
    <button
      class="flex flex-col gap-0.5 border-t border-hairline px-3 py-1.5 text-start text-xs text-muted transition-colors hover:bg-raise"
      title="Open In progress"
      onclick={onwork}
    >
      {#each work as w (w.id)}
        <span class="flex w-full min-w-0 items-center gap-1.5">
          <span class="size-1.5 shrink-0 rounded-full {w.queued ? 'bg-faint' : 'bg-ember'}"></span>
          <span class="min-w-0 truncate text-ink">{w.label}</span>
          <span class="shrink-0 text-faint"
            >· {w.queued ? 'waiting for a free slot' : runningFor(w.since, clock)}</span
          >
          {#if !w.queued}
            <span class="min-w-0 truncate"
              >· {w.doing ? toolWords(w.doing, serviceNames.byId) : 'Thinking'}</span
            >
          {/if}
        </span>
      {/each}
    </button>
  {/if}

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
      {onkeydown}></textarea>
    <button
      class="rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
      disabled={!draft.trim()}>Send</button
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
  /* The line under a message: its parts split by a thin bar. */
  .meta > * + * {
    margin-inline-start: 0.5rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 1px solid var(--color-hairline);
  }
  .meta button {
    padding-block: 2px;
  }
  /* The full date over a time, and Copied over the copy button: CSS only. */
  .stamp {
    position: relative;
    border-radius: 3px;
  }
  .stamp:focus-visible {
    outline: 1px solid var(--color-sea);
    outline-offset: 2px;
  }
  .tip {
    position: absolute;
    inset-block-end: calc(100% + 6px);
    inset-inline-start: -4px;
    z-index: 10;
    padding: 4px 8px;
    border-radius: 6px;
    background: var(--color-panel-solid);
    box-shadow: var(--shadow-float);
    color: var(--color-ink);
    font-size: 11px;
    line-height: 1.2;
    white-space: nowrap;
    pointer-events: none;
    visibility: hidden;
  }
  .owner .tip {
    inset-inline-start: auto;
    inset-inline-end: -4px;
  }
  .stamp:hover .tip,
  .stamp:focus-visible .tip,
  .tip.shown {
    visibility: visible;
  }
  .choice:first-child {
    border-color: color-mix(in srgb, var(--color-sea) 55%, transparent);
  }
  .default {
    flex-shrink: 0;
    color: var(--color-sea);
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  /* A long hand-off text fades out where it is cut, until the owner opens it. */
  .clamped {
    mask-image: linear-gradient(to bottom, black 70%, transparent);
  }
</style>
