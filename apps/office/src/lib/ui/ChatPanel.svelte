<script lang="ts">
  import { tick } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { clockTime } from '@oddboro/ledger/time';
  import ChatAccessAsk from './ChatAccessAsk.svelte';
  import ChatSignInCard from './ChatSignInCard.svelte';
  import Markdown from './Markdown.svelte';
  import TaskResponse from './TaskResponse.svelte';
  import { saved } from './task-response.svelte.ts';
  import GoalProposal from './GoalProposal.svelte';
  import BugReport from './BugReport.svelte';
  import { failedReply } from '../bug-report.ts';
  import UpdatesSection from './UpdatesSection.svelte';
  import Lesson from './Lesson.svelte';
  import PersonaQuiet from './PersonaQuiet.svelte';
  import ChatFiles from './ChatFiles.svelte';
  import ChatComposer from './ChatComposer.svelte';
  import ChatThreadLine from './ChatThreadLine.svelte';
  import ChatWorkNow from './ChatWorkNow.svelte';
  import { hideChoiceLines } from '#lib/choices.ts';
  import { ChatSession, type SessionProps } from './chat-session.svelte.ts';
  import { KIND, STATUS, keyOf, type Line } from './chat-threads.ts';
  import { workItems, type ReaderProps } from '../staff/odd-now.ts';
  import { counting, dayBreaks, fullDate, stamp, took } from './chat-lines.ts';

  type Props = ReaderProps &
    SessionProps & {
      /** Opens the info page at In progress. */
      onwork: () => void;
    };

  let {
    now,
    nowOf,
    profile,
    desk,
    staff,
    onplan,
    version,
    onstart,
    onend,
    visible,
    onitem,
    onwork
  }: Props = $props();
  /** Everything the Odd is working on now, shown at the foot of the chat. */
  const work = $derived(workItems(now));

  // A hidden list has no height to scroll, so catch up when it shows.
  $effect(() => {
    if (visible) scrollDown();
  });

  /** The hand-off stories and texts the owner opened, one set for every line. */
  const opened = new SvelteSet<string>();

  let composer: ChatComposer | undefined = $state();
  // Getters, not values: the session reads each prop live, and an effect of it
  // tracks only the props it reads.
  const session = new ChatSession(
    {
      get profile() {
        return profile;
      },
      get desk() {
        return desk;
      },
      get version() {
        return version;
      },
      get visible() {
        return visible;
      },
      get onstart() {
        return onstart;
      },
      get onend() {
        return onend;
      },
      get onplan() {
        return onplan;
      },
      get onitem() {
        return onitem;
      }
    },
    { focus: (how) => composer?.focus(how), scrollDown }
  );

  // Bring the selected delivery into view once the history is in.
  $effect(() => {
    if (!session.selected || !session.loaded || !visible) return;
    void tick().then(() =>
      list
        ?.querySelector(`[data-item="${session.selected}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    );
  });
  /** What the bug report form starts with, while it is open. */
  let bugReport = $state<{ title?: string; body: string }>();
  // One live section per chat, even when the owner asked about updates before.
  const latestUpdate = $derived(session.lines.findLast((line) => line.updates));
  let list: HTMLDivElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();

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
   * anyway, and once a minute only while a stamp still counts minutes or a
   * run is going, so a still chat redraws nothing.
   */
  let clock = $state(Date.now());
  const ticking = $derived(
    work.some((w) => !w.queued) ||
      session.lines.some((l) => l.at && counting(l.at, new Date(clock)))
  );
  $effect(() => {
    if (!visible || !ticking) return;
    const timer = setInterval(() => (clock = Date.now()), 60_000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    void work;
    void session.lines.length;
    void visible;
    clock = Date.now();
  });
  /** The day break above each line, if any. */
  const breaks = $derived(
    dayBreaks(
      session.lines.map((l) => l.at),
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
</script>

<!-- What the Odd is doing, under the reply it is working on, with Stop beside it. -->
{#snippet doing(extra: string)}
  <div class="meta {extra} ms-1 me-auto flex items-center text-xs text-muted">
    <span aria-live="polite"
      >{profile.name} is {session.status ? session.status.toLowerCase() : 'replying'}…</span
    >
    {#if session.active}
      <button
        type="button"
        class="text-coral hover:text-ink"
        disabled={session.stopping}
        onclick={() => session.stop()}>Stop</button
      >
    {/if}
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
        onclick={() => session.reply(it)}>Reply</button
      >
    {/if}
    <button
      class="stamp hover:text-ink"
      aria-label={copied === i ? 'Copied' : line.item ? 'Copy this card' : 'Copy this message'}
      onclick={() => copy(i, line.item ? session.cardCopy(line.item) : line.text)}
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
  {#if profile.persona}
    <div class="flex flex-col gap-2 border-b border-hairline p-3 text-xs">
      <p class="leading-relaxed text-muted">{profile.persona.disclosure}</p>
      {#if profile.persona.quiet}
        <PersonaQuiet
          slug={profile.persona.slug}
          name={profile.name}
          quiet={profile.persona.quiet}
        />
      {/if}
    </div>
  {/if}
  <div
    bind:this={list}
    {@attach pin}
    class="flex flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-3"
  >
    {#if session.loaded && session.lines.length === 0}
      <p class="m-auto max-w-[240px] text-center text-sm text-muted">
        Say hello to {profile.name}, who walks to your office while you talk.
      </p>
    {/if}
    {#each session.lines as line, i (line.item ? keyOf(line.item) : i)}
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
      {:else if line.thread || line.handOff}
        <ChatThreadLine
          {line}
          {opened}
          {nowOf}
          staffId={profile.id}
          onpick={(d) => session.pick(d)}
        />
      {:else if line.item}
        {@const it = line.item}
        {@const box = `block w-full rounded-2xl rounded-es-md bg-raise px-3 py-2 text-start text-sm ${
          session.selected === keyOf(it) ? 'ring-1 ring-sea' : ''
        }`}
        <div class="-mb-1 ms-1 text-[10px] tracking-[0.16em] text-sea uppercase">
          {KIND[it.kind]}
        </div>
        <div class="me-auto w-[85%]" data-item={keyOf(it)}>
          {#snippet face()}
            <span class="block font-medium break-words text-ink">{it.title}</span>
            <span class="flex flex-wrap items-baseline gap-x-3 text-xs">
              <span
                class={it.status === 'open' || it.status === 'new' ? 'text-ember' : 'text-muted'}
                >{STATUS[it.status] ?? it.status}</span
              >
              {#if session.opens(it)}
                <span class="text-sea"
                  >{it.kind === 'report' && !desk.reports.some((r) => r.id === it.id)
                    ? 'Open report'
                    : 'Open on Desk'}</span
                >
              {/if}
            </span>
          {/snippet}
          <!-- The whole card opens it, its title still selectable: a click that ends a selection opens nothing. Its controls sit below, outside the button. -->
          {#if session.opens(it)}
            <button
              type="button"
              class="{box} cursor-pointer select-text hover:bg-sea/10 focus-visible:ring-1 focus-visible:ring-sea focus-visible:outline-none"
              aria-current={session.selected === keyOf(it) ? 'true' : undefined}
              onclick={() => {
                if (!window.getSelection()?.toString()) session.pick(it);
              }}>{@render face()}</button
            >
          {:else}
            <div class={box} aria-current={session.selected === keyOf(it) ? 'true' : undefined}>
              {@render face()}
            </div>
          {/if}
          {#if it.note}
            <p class="mt-1 px-3 text-xs whitespace-pre-wrap text-muted">{it.note}</p>
          {/if}
          {#if it.status === 'open'}
            {@const a = session.proposal(it)}
            {@const t = session.question(it)}
            {#if a}
              <dl class="mt-2 px-2">
                {#if a.why}<div class="mb-2 text-xs text-muted">{a.why}</div>{/if}
                <GoalProposal
                  {a}
                  {staff}
                  skip={session.skipped[a.id] ?? {}}
                  onskip={(i, value) => {
                    session.skipped[a.id] = { ...session.skipped[a.id], [i]: value };
                  }}
                />
              </dl>
              <div class="mt-2 flex gap-2">
                <button
                  class="choice"
                  disabled={session.saving || !session.decisionMode}
                  onclick={() => session.reply(it, 'change')}>Change</button
                >
                <button
                  class="choice"
                  disabled={session.saving ||
                    !session.decisionMode ||
                    session.picks(a)?.length === 0}
                  onclick={() => session.decide(it, 'approve')}
                  >{a.goal
                    ? 'Set the goal'
                    : `Approve ${session.picks(a)?.length} of ${a.plan?.items.length}`}</button
                >
              </div>
            {:else if t}
              <div class="mt-2 px-2 text-xs text-muted">
                <p>{t.why}</p>
                {#if t.steps.length}
                  <ol class="list-decimal ps-4">
                    {#each t.steps as step, n (n)}<li>{step.text}</li>{/each}
                  </ol>
                {/if}
                {#if t.choice}
                  <!-- A tap is the answer: it finishes the task, as the Desk's choice and Mark done would. -->
                  <div class="mt-2 flex flex-col gap-1.5" role="group" aria-label="Choices">
                    {#each t.choice.options as option (option)}
                      <button
                        class="choice"
                        disabled={session.saving || !session.decisionMode}
                        onclick={() => session.decide(it, 'choose', option)}>{option}</button
                      >
                    {/each}
                  </div>
                {:else}
                  <!-- The one place the chat takes a typed answer to a task. -->
                  <TaskResponse
                    task={t.task}
                    odd={profile.name}
                    files={t.files}
                    open
                    inChat
                    held={session.saving || !session.decisionMode}
                    onfinish={() => session.load(profile.id)}
                  />
                {/if}
              </div>
            {/if}
          {:else if it.kind === 'task' && it.responseVersion}
            <details
              class="mt-1 px-3 text-xs text-muted"
              ontoggle={(e) => e.currentTarget.open && session.readResponse(it.id)}
            >
              <summary class="cursor-pointer text-sea">Your response</summary>
              <p class="mt-1 whitespace-pre-wrap text-ink">
                {saved[it.id]?.response ?? session.unread[it.id] ?? 'Opening'}
              </p>
            </details>
          {/if}
          {#if it.kind === 'ask' && (it.switches || it.folder?.given || (it.folder && it.status === 'open'))}
            <!-- The Desk's folder and switch handlers, answered where the work stopped. -->
            {#key it.id}
              <ChatAccessAsk
                item={it}
                name={profile.name}
                onchanged={() => session.load(profile.id)}
              />
            {/key}
          {/if}
        </div>
        {@render meta(line, i)}
      {:else}
        {#if line.re}
          <!-- The owner's line replies about a card; an Odd's told line answers what the owner said on it. -->
          <button
            class="-mb-1 max-w-[85%] truncate text-[10px] text-faint hover:text-ink {line.from ===
            'owner'
              ? 'me-1 ms-auto'
              : 'ms-1 me-auto'}"
            title={`Open ${line.re.title}`}
            onclick={() => line.re && session.pick(line.re)}>↩ {line.re.title}</button
          >
        {/if}
        {#if line.poke}
          <div class="-mb-1 ms-1 text-[10px] tracking-[0.16em] text-ember uppercase">Poke</div>
        {/if}
        {#if line.files?.length}
          <div class="ms-auto max-w-[85%]">
            <ChatFiles
              end
              files={line.files.map((f) => ({ ...f, key: f.name, url: session.attachmentUrl(f) }))}
            />
          </div>
        {/if}
        <div
          class="max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed break-words
          {line.from === 'owner'
            ? 'ms-auto rounded-ee-md bg-sea/25 whitespace-pre-wrap text-ink'
            : `me-auto rounded-es-md bg-raise ${line.failed || line.runFailed ? 'text-coral whitespace-pre-wrap' : 'text-ink'}`}"
        >
          {#if line.pending && !line.text}
            <span class="dots" aria-label="Replying"><span></span><span></span><span></span></span>
          {:else if line.from === 'staff' && !line.failed}
            <!-- While it streams, its choice lines wait to become buttons. -->
            <Markdown
              text={line.pending ? hideChoiceLines(line.text) : line.text}
              staff={profile.id}
            />
          {:else}
            {line.text}
          {/if}
        </div>
        {#if line.bug && !line.pending}
          <!-- The Odd drafted a bug report: the form opens with it, and files nothing by itself. -->
          <div class="ms-auto w-[85%]">
            <button class="choice" onclick={() => (bugReport = line.bug)}
              >File this bug report</button
            >
          </div>
        {/if}
        {#if line === latestUpdate && !line.pending}
          <div class="my-3 rounded-lg border border-line p-3">
            <UpdatesSection showWindow={false} />
          </div>
        {/if}
        {#if session.retryable(line, i)}
          {#if session.blocked && session.blocked.turnId === line.turnId}
            <ChatSignInCard
              request={session.blocked.signIn}
              name={profile.name}
              onready={() => session.continueChat(line.turnId!)}
              onedit={() => session.hold()}
            />
          {:else}
            <button
              class="ms-auto text-xs text-sea hover:text-ink"
              onclick={() => session.say(line.text, line.re, line.files ?? [], line)}
              >Retry reply</button
            >
          {/if}
        {/if}
        {#if line.pending}
          {@render doing('-mt-1')}
        {:else}
          {@render meta(line, i)}
        {/if}
      {/if}
    {/each}
    {#if session.active && !session.lines.some((l) => l.pending)}
      <!-- A reply still running from before this chat opened. -->
      {@render doing('')}
    {/if}
    {#if session.waiting}
      <!-- Sent while the reply above was still coming: it goes when that reply ends. -->
      <div class="ms-auto flex max-w-[85%] flex-col items-end gap-0.5">
        {#if session.waiting.files.length}
          <ChatFiles
            end
            files={session.waiting.files.map((f) => ({
              ...f,
              key: f.name,
              url: session.attachmentUrl(f)
            }))}
          />
        {/if}
        {#if session.waiting.text}
          <div
            class="rounded-2xl rounded-ee-md border border-dashed border-sea/40 px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink"
          >
            {session.waiting.text}
          </div>
        {/if}
        <div class="flex items-center gap-3 pe-1 text-[10px] text-faint">
          {#if session.offersNow(session.waiting)}
            <button
              class="text-sea hover:text-ink disabled:opacity-40"
              disabled={session.adding || !!session.waiting.files.length}
              title={session.waiting.files.length
                ? `Send now cannot carry files. This goes when ${profile.name} finishes.`
                : `Add this to ${profile.name}'s reply now`}
              onclick={() => session.sendNow()}>Send now (Ctrl+Enter)</button
            >
            <span class="h-3 border-s border-hairline" aria-hidden="true"></span>
          {/if}
          <span>Queued</span>
          <button class="hover:text-coral" onclick={() => session.unwait()}>Cancel</button>
        </div>
      </div>
    {/if}
    {#if session.answers.list.length}
      <!-- Each answer a full-width choice on the owner's side; a first question's default is first and marked. -->
      <div class="ms-auto flex w-[85%] flex-col gap-1.5" role="group" aria-label="Answers">
        {#each session.answers.list as a, n (a)}
          <button class="choice" onclick={() => session.say(a)}>
            <span class="min-w-0 flex-1">{a}</span>
            {#if session.answers.first && n === 0}<span class="default">Default</span>{/if}
          </button>
        {/each}
      </div>
    {/if}
    <!-- A poke to come keeps its words until it lands as a message, at the bottom. -->
    {#each session.upcoming as p (p.id)}
      <div class="me-auto ms-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <span>{profile.name} will message you at {clockTime(new Date(p.at))}.</span>
        <button class="text-sea hover:text-ink" onclick={() => session.pokeNow(p)}>Send now</button>
        <button
          class="text-faint hover:text-coral"
          aria-label={`Cancel the ${clockTime(new Date(p.at))} poke`}
          onclick={() => session.cancel(p)}>Cancel</button
        >
      </div>
    {/each}
  </div>

  <ChatWorkNow {work} {clock} {onwork} />

  <ChatComposer
    bind:this={composer}
    {session}
    {profile}
    {visible}
    {root}
    {list}
    onbug={() => (bugReport = { body: failedReply(session.lines) })}
  />
</div>

{#if bugReport !== undefined}
  <BugReport
    initial={bugReport}
    staff={profile.id}
    onclose={() => (bugReport = undefined)}
    onfiled={() => {
      if (!session.sending) session.load(profile.id);
    }}
  />
{/if}

<style>
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
</style>
