<script lang="ts">
  import type { AskRow, Desk, LedgerRow, ReportRow, Step, TaskRow } from '@oddboro/ledger';
  import Pixel from './Pixel.svelte';
  import Markdown from './Markdown.svelte';
  import Attachments from './Attachments.svelte';
  import DiagnosticsAsk from './DiagnosticsAsk.svelte';
  import SelectToChat from './SelectToChat.svelte';
  import { call } from './api.ts';
  import { ago, when } from './format.ts';
  import { openFile, wins } from './windows.svelte.ts';
  import { replyAbout, showInChat } from './chat-about.svelte.ts';
  import { OFFICE_TOOLS } from '@oddboro/ledger/tools';
  import { describe } from '@oddboro/ledger/time';
  import { tickable } from '@oddboro/ledger/tools';
  import { untrack } from 'svelte';
  import { goalWhen } from '@oddboro/ledger/goals';
  import type { StaffProfile } from '../staff/roster.ts';

  type Props = {
    desk: Desk;
    staff: StaffProfile[];
    /** Ask about error and trace reports, first, until the owner answers. */
    askDiagnostics: boolean;
    /** Open on this item when set, e.g. after clicking a waiting staffer. */
    focus?: string;
    notify: boolean;
    onnotify: (on: boolean) => void;
    /** Approving a proposed hire opens the hire window with it. */
    onhire: (a: AskRow) => void;
    /** Approving a goal plan opens a hire window for each hire in it. */
    onplan: (hires: AskRow[]) => void;
    /** Open a staffer's card, from the name on an item. */
    onstaff: (id: string) => void;
  };
  let { desk, staff, askDiagnostics, focus, notify, onnotify, onhire, onplan, onstaff }: Props =
    $props();

  type Item =
    | { key: string; kind: 'ask'; at: string; row: AskRow }
    | { key: string; kind: 'task'; at: string; row: TaskRow }
    | { key: string; kind: 'report'; at: string; row: ReportRow };

  const items = $derived<Item[]>(
    [
      ...desk.asks.map((row) => ({
        key: `ask-${row.id}`,
        kind: 'ask' as const,
        at: String(row.createdAt),
        row
      })),
      ...desk.tasks.map((row) => ({
        key: `task-${row.id}`,
        kind: 'task' as const,
        at: String(row.createdAt),
        row
      })),
      ...desk.reports.map((row) => ({
        key: `report-${row.id}`,
        kind: 'report' as const,
        at: String(row.createdAt),
        row
      }))
    ].sort((a, b) => a.at.localeCompare(b.at))
  );

  const waiting = $derived(items.length + Number(askDiagnostics));

  let openKey = $state<string | undefined>();
  /** An attached file with edits the owner has not saved. */
  let unsaved = $state(false);
  $effect(() => {
    wins.dirty.desk = unsaved;
  });

  /** Open an item, and select it in the chat of the staffer who delivered it. */
  function show(key: string | undefined) {
    openKey = key;
    unsaved = false;
    const i = items.find((x) => x.key === key);
    if (i?.row.staffId) showInChat(i.row.staffId, delivered(i));
  }
  const delivered = (i: Item) => ({ kind: i.kind, id: i.row.id, title: i.row.title });
  /** Moving off an item with unsaved edits waits for the owner to say so. */
  function go(key: string | undefined) {
    if (unsaved) wins.confirm = { id: 'desk', go: () => ((wins.confirm = undefined), show(key)) };
    else show(key);
  }
  // Only a new focus opens an item. `go` reads the desk, and a desk that
  // changes (a step ticked) must not reopen whatever was focused last.
  $effect(() => {
    const f = focus;
    if (f) untrack(() => go(f));
  });
  const attached = (kind: 'ask' | 'task', id: number) =>
    desk.attachments.filter((f) => (kind === 'ask' ? f.askId : f.taskId) === id);
  const open = $derived(items.find((i) => i.key === openKey));
  const who = (id: string | null) => staff.find((p) => p.id === id);

  let busy = $state(false);
  let problem = $state('');
  let reason = $state('');
  let reportWhenDone = $state(false);
  let note = $state('');
  let precedent = $state<LedgerRow[]>([]);
  /** The ask this one reworks, when the owner sent that one back. */
  let reworks = $state<AskRow | null>(null);
  let secret = $state<Record<number, string>>({});
  let toolList = $state<Record<number, { name: string; description: string; readOnly: boolean }[]>>(
    {}
  );
  let readPick = $state<Record<string, boolean>>({});
  /** The parts of a goal plan the owner unticked. Every part starts ticked. */
  let skip = $state<Record<number, boolean>>({});

  // Each newly opened item starts clean, and an ask brings its closest past
  // decisions. Keyed on the item, not its row: the desk reloading (a step
  // ticked) must not wipe a half-typed note.
  $effect(() => {
    const key = openKey;
    const i = untrack(() => items.find((x) => x.key === key));
    reason = '';
    reportWhenDone = false;
    note = '';
    problem = '';
    precedent = [];
    reworks = null;
    skip = {};
    secret = {};
    if (i?.kind === 'ask')
      call<{ precedent: LedgerRow[]; revises: AskRow | null }>(`/api/asks/${i.row.id}`)
        .then((r) => {
          precedent = r.precedent;
          reworks = r.revises;
        })
        .catch(() => {});
  });

  async function act(fn: () => Promise<unknown>, close = false) {
    busy = true;
    problem = '';
    try {
      await fn();
      if (close) show(undefined);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const decide = (a: AskRow, decision: 'approve' | 'deny' | 'iterate') =>
    act(async () => {
      const picks = a.plan?.items.map((_, i) => i).filter((i) => !skip[i]);
      const r = await call<{ hires?: AskRow[] }>(`/api/asks/${a.id}`, {
        decision,
        reason,
        report: reportWhenDone,
        picks
      });
      if (r.hires?.length) onplan(r.hires);
    }, true);
  const picked = (a: AskRow) => a.plan?.items.filter((_, i) => !skip[i]).length ?? 0;
  const nameOf = (id: string) => staff.find((p) => p.id === id)?.name ?? id;
  const toolName = (id: string) => OFFICE_TOOLS.find((t) => t.id === id)?.name ?? id;
  const LEVEL = { read: 'Reads and reports', draft: 'Drafts for your yes', act: 'Acts on its own' };
  const step = (t: TaskRow, index: number, body: Record<string, unknown>) =>
    act(() => call(`/api/tasks/${t.id}`, { index, ...body }));
  async function saveSecret(t: TaskRow, index: number) {
    await step(t, index, { op: 'secret', value: secret[index] });
    if (!problem) secret[index] = '';
  }
  const tickEvery = (t: TaskRow) => act(() => call(`/api/tasks/${t.id}`, { op: 'tick-all' }));
  const toTick = (t: TaskRow) => t.steps.filter((s) => !s.done && tickable(s)).length;
  const finish = (t: TaskRow, done: boolean) =>
    act(() => call(`/api/tasks/${t.id}`, { op: 'finish', done, note }), true);

  /** The service's sign-in page opens in a new tab; the step ticks when the owner comes back. */
  async function hostedSignIn(t: TaskRow, index: number) {
    await act(async () => {
      const r = await call<{ url?: string }>(`/api/tasks/${t.id}`, { op: 'oauth', index });
      if (r.url) window.open(r.url, '_blank', 'noopener');
    });
  }

  async function loadTools(t: TaskRow, index: number) {
    await act(async () => {
      const r = await call<{ tools: { name: string; description: string; readOnly: boolean }[] }>(
        `/api/tasks/${t.id}`,
        { op: 'tools', index }
      );
      toolList[index] = r.tools;
      for (const tool of r.tools) readPick[tool.name] = tool.readOnly;
    });
  }

  const LABEL = { ask: 'Ask', task: 'Task', report: 'Report' } as const;
  const doneCount = (steps: Step[]) => steps.filter((s) => s.done).length;
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Your desk">
  <header class="flex items-center gap-2 border-b border-hairline p-3">
    {#if open}
      <button
        class="rounded-full px-2 py-1 text-sm text-muted hover:text-ink"
        onclick={() => go(undefined)}>Back</button
      >
    {/if}
    <div class="flex-1">
      <div class="font-pixel text-lg leading-none">Your desk</div>
      <div class="mt-1 text-xs text-muted">
        {waiting ? `${waiting} waiting on you` : 'Nothing waiting on you'}
      </div>
    </div>
    <label
      class="flex items-center gap-1.5 text-[11px] text-muted"
      title="A Mac notification when something new lands"
    >
      <input type="checkbox" checked={notify} onchange={(e) => onnotify(e.currentTarget.checked)} />
      Notify me
    </label>
  </header>

  {#if wins.confirm?.id === 'desk'}
    <div class="flex flex-wrap items-center gap-2 border-b border-hairline bg-ember/10 px-3 py-2">
      <span class="flex-1 text-xs text-ink">An attached file has unsaved changes.</span>
      <button
        class="rounded-lg bg-raise px-2.5 py-1 text-xs hover:bg-coral/25"
        onclick={() => wins.confirm?.go()}>Discard</button
      >
      <button
        class="rounded-lg px-2.5 py-1 text-xs text-muted hover:text-ink"
        onclick={() => (wins.confirm = undefined)}>Keep editing</button
      >
    </div>
  {/if}

  <div class="flex-1 overflow-y-auto p-3">
    {#if !open}
      {#if !waiting}
        <p class="py-10 text-center text-sm text-muted">
          Desk clear. Your Odds will bring you anything that needs you.
        </p>
      {/if}
      <ul class="flex flex-col gap-1.5">
        {#if askDiagnostics}
          <li class="rounded-xl bg-raise px-3 py-2.5" aria-label="From Oddboro">
            <span class="block text-[10px] tracking-[0.16em] text-ember uppercase"
              >From Oddboro</span
            >
            <div class="mt-1"><DiagnosticsAsk /></div>
          </li>
        {/if}
        {#each items as i (i.key)}
          {@const from = who(i.row.staffId)}
          <li>
            <button
              class="flex w-full items-start gap-3 rounded-xl bg-raise px-3 py-2.5 text-start transition-colors hover:bg-sea/15"
              onclick={() => go(i.key)}
            >
              {#if from}
                <Pixel
                  src={from.look?.portrait}
                  frame={`${from.portrait}/default`}
                  fallback={`${from.sprite}@${from.variant}/idle-down-0`}
                  scale={1}
                  label={from.name}
                  class="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sea-deep"
                />
              {/if}
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2 text-[10px] tracking-[0.16em] uppercase">
                  <span class={i.kind === 'report' ? 'text-sea' : 'text-ember'}
                    >{LABEL[i.kind]}</span
                  >
                  <span class="text-faint">{from?.name ?? 'Office'} · {ago(i.at)}</span>
                </span>
                <span class="mt-0.5 block text-sm text-ink">{i.row.title}</span>
                {#if i.kind === 'task'}
                  <span class="mt-0.5 block text-xs text-muted"
                    >{doneCount(i.row.steps)} of {i.row.steps.length} steps done</span
                  >
                {/if}
              </span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      {@const from = who(open.row.staffId)}
      {#if from}
        <button
          class="mb-3 flex w-full items-center gap-3 rounded-xl bg-raise px-3 py-2.5 text-start transition-colors hover:bg-sea/15"
          title={`Open ${from.name}'s card`}
          onclick={() => onstaff(from.id)}
        >
          <Pixel
            src={from.look?.portrait}
            frame={`${from.portrait}/default`}
            fallback={`${from.sprite}@${from.variant}/idle-down-0`}
            scale={1}
            label={from.name}
            class="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-sea-deep"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-sm font-medium text-ink">{from.name}</span>
            <span class="block text-xs text-muted">{from.role}</span>
            {#if from.remit}
              <span class="mt-0.5 block truncate text-[11px] text-faint">{from.remit}</span>
            {/if}
          </span>
        </button>
      {/if}
      <div class="text-[10px] tracking-[0.16em] uppercase">
        <span class={open.kind === 'report' ? 'text-sea' : 'text-ember'}>{LABEL[open.kind]}</span>
        <span class="text-faint">· {from ? '' : 'Office · '}{when(open.at)}</span>
      </div>
      <h2 class="mt-1 text-base leading-snug font-medium">{open.row.title}</h2>

      {#if open.kind === 'ask'}
        {@const a = open.row}
        <dl class="mt-3 flex flex-col gap-3 text-sm">
          {#if reworks}
            <div class="rounded-lg bg-sea/10 px-2.5 py-2 text-xs">
              <div class="text-muted">Reworks “{reworks.title}”</div>
              {#if reworks.reason}<div class="mt-0.5">You asked: {reworks.reason}</div>{/if}
            </div>
          {/if}
          <div>
            <dt class="text-xs text-muted">Why</dt>
            <dd class="mt-0.5"><Markdown text={a.why} staff={a.staffId} /></dd>
          </div>
          {#if a.hire}
            {@const h = a.hire}
            <div>
              <dt class="text-xs text-muted">The hire</dt>
              <dd class="mt-1 flex flex-col gap-1 rounded-lg bg-raise px-2.5 py-2 text-xs">
                <div><span class="text-muted">Who:</span> {h.name}, {h.role}</div>
                <div><span class="text-muted">For:</span> {h.remit}</div>
                <div><span class="text-muted">Permission:</span> {LEVEL[h.permission]}</div>
                {#if h.room}<div><span class="text-muted">Room:</span> {h.room}</div>{/if}
                {#if h.tools?.length}
                  <div>
                    <span class="text-muted">Office tools:</span>
                    {h.tools.map(toolName).join(', ')}
                  </div>
                {/if}
                {#if h.job}
                  <div>
                    <span class="text-muted">First job:</span>
                    {h.job.name}, {describe(h.job.schedule)}
                  </div>
                {/if}
                <div>
                  <span class="text-muted">Job description:</span>
                  <button
                    class="text-sea underline underline-offset-2"
                    onclick={() => openFile({ staff: a.staffId, path: h.jobDescriptionFile })}
                    >{h.jobDescriptionFile}</button
                  >
                </div>
              </dd>
            </div>
          {:else if a.goal}
            {@const g = a.goal}
            <div>
              <dt class="text-xs text-muted">The goal</dt>
              <dd class="mt-1 flex flex-col gap-1 rounded-lg bg-raise px-2.5 py-2 text-xs">
                <div class="text-sm text-ink">{g.title}</div>
                {#if g.why}<div><span class="text-muted">Why:</span> {g.why}</div>{/if}
                {#if g.doneWhen}
                  <div><span class="text-muted">Done when:</span> {g.doneWhen}</div>
                {/if}
                <div><span class="text-muted">When:</span> {goalWhen(g)} · {g.area}</div>
              </dd>
              <p class="mt-1.5 text-[11px] text-faint">
                Setting it sends {who(a.staffId)?.name ?? 'your manager'} off to plan it. The plan comes
                back to your desk.
              </p>
            </div>
          {:else if a.plan}
            {@const plan = a.plan}
            <div>
              <dt class="text-xs text-muted">The plan · untick any part to leave it out</dt>
              <dd class="mt-1 flex flex-col gap-1.5">
                {#each plan.items as item, i (i)}
                  <label
                    class="flex cursor-pointer items-start gap-2.5 rounded-lg bg-raise px-2.5 py-2 text-xs"
                    class:opacity-50={skip[i]}
                  >
                    <input
                      type="checkbox"
                      class="mt-0.5"
                      checked={!skip[i]}
                      onchange={(e) => (skip[i] = !e.currentTarget.checked)}
                    />
                    <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                      {#if item.kind === 'hire'}
                        {@const h = item.hire}
                        <span class="text-sm text-ink">Hire {h.name}, {h.role}</span>
                        <span>{item.part}</span>
                        <span class="text-muted"
                          >{LEVEL[h.permission]}{h.room ? ` · ${h.room}` : ''}</span
                        >
                        {#if h.job}
                          <span class="text-muted"
                            >First job: {h.job.name}, {describe(h.job.schedule)}</span
                          >
                        {/if}
                        <span class="flex flex-wrap gap-x-2">
                          <button
                            type="button"
                            class="text-sea underline underline-offset-2"
                            onclick={() =>
                              openFile({ staff: a.staffId, path: h.jobDescriptionFile })}
                            >Job description</button
                          >
                          {#if h.intakeFile}
                            {@const intake = h.intakeFile}
                            <button
                              type="button"
                              class="text-sea underline underline-offset-2"
                              onclick={() => openFile({ staff: a.staffId, path: intake })}
                              >Your intake answers</button
                            >
                          {/if}
                        </span>
                      {:else}
                        <span class="text-sm text-ink">{nameOf(item.staff)} takes it on</span>
                        <span>{item.part}</span>
                        {#if item.job}
                          <span class="text-muted"
                            >New job: {item.job.name}, {describe(item.job.schedule)}</span
                          >
                        {/if}
                        {#if item.editJob}
                          <span class="text-muted"
                            >Changes its job "{item.editJob.name}"{item.editJob.schedule
                              ? ` to ${describe(item.editJob.schedule).toLowerCase()}`
                              : ''}</span
                          >
                        {/if}
                      {/if}
                    </span>
                  </label>
                {/each}
                {#if plan.ownerSteps?.length}
                  <div class="rounded-lg bg-ember/10 px-2.5 py-2 text-xs">
                    <div class="text-muted">Yours to do, as a task on your desk</div>
                    <ol class="mt-1 list-decimal ps-4">
                      {#each plan.ownerSteps as s, i (i)}<li>{s}</li>{/each}
                    </ol>
                  </div>
                {/if}
              </dd>
              <p class="mt-1.5 text-[11px] text-faint">
                Odds already here take on their part as soon as you approve. Each hire opens in the
                hire window.
              </p>
            </div>
          {:else}
            <div>
              <dt class="text-xs text-muted">If you approve</dt>
              <dd class="mt-0.5"><Markdown text={a.ifApproved} staff={a.staffId} /></dd>
            </div>
          {/if}
          {#if precedent.length}
            <div>
              <dt class="text-xs text-muted">Like this before</dt>
              <dd class="mt-1 flex flex-col gap-1">
                {#each precedent as p (p.id)}
                  <div class="rounded-lg bg-raise px-2.5 py-1.5 text-xs">
                    <div>{p.title}</div>
                    <div class="mt-0.5 text-faint">
                      {when(p.createdAt)} · {p.reason
                        ? `Your reason: ${p.reason}`
                        : 'No reason given'}
                    </div>
                  </div>
                {/each}
              </dd>
            </div>
          {/if}
        </dl>
        {#key open.key}
          <Attachments items={attached('ask', a.id)} ondirty={(d) => (unsaved = d)} />
        {/key}
        <label class="mt-4 block text-xs text-muted" for="reason">Reason, or what to change</label>
        <textarea
          id="reason"
          rows="3"
          class="mt-1 w-full resize-y rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint"
          placeholder="Optional to approve or deny. Needed to iterate: say what to change."
          bind:value={reason}></textarea>
        {#if a.kind === 'approval'}
          <label class="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" bind:checked={reportWhenDone} /> Report when done
          </label>
          <p class="mt-1 text-[11px] text-faint">
            {who(a.staffId)?.name ?? 'The Odd'} starts as soon as you approve. You hear back if it fails
            or needs you{reportWhenDone ? ', and when it is done' : ''}.
          </p>
        {/if}
        <div class="mt-3 flex gap-2">
          <button
            class="flex-1 rounded-lg bg-raise px-3 py-2 text-sm font-medium hover:bg-coral/25 disabled:opacity-40"
            disabled={busy || unsaved}
            onclick={() => decide(a, 'deny')}>Deny</button
          >
          <button
            class="flex-1 rounded-lg bg-raise px-3 py-2 text-sm font-medium hover:bg-sea/25 disabled:opacity-40"
            disabled={busy || unsaved || !reason.trim()}
            title={reason.trim() ? '' : 'Say what to change in the box above first'}
            onclick={() => decide(a, 'iterate')}>Iterate</button
          >
          {#if a.kind === 'hire'}
            <button
              class="flex-[1.4] rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
              disabled={busy || unsaved}
              onclick={() => onhire(a)}>Open hire window</button
            >
          {:else}
            <button
              class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
              disabled={busy || unsaved || (a.kind === 'plan' && !picked(a))}
              onclick={() => decide(a, 'approve')}
              >{a.kind === 'goal'
                ? 'Set the goal'
                : a.plan && picked(a) < a.plan.items.length
                  ? `Approve ${picked(a)} of ${a.plan.items.length}`
                  : 'Approve'}</button
            >
          {/if}
        </div>
        <p class="mt-1.5 text-[11px] text-faint">
          Iterate sends it back to {who(a.staffId)?.name ?? 'the Odd'} with your words, and the new version
          comes back to your desk.
        </p>
      {:else if open.kind === 'task'}
        {@const t = open.row}
        <p class="mt-2 text-sm leading-relaxed text-muted">{t.why}</p>
        {#if toTick(t) > 1}
          <div class="mt-3 flex justify-end">
            <button
              class="rounded-lg bg-raise px-2.5 py-1 text-xs text-muted hover:bg-sea/20 hover:text-ink disabled:opacity-40"
              disabled={busy}
              onclick={() => tickEvery(t)}>Tick all {toTick(t)}</button
            >
          </div>
        {/if}
        <ol class="mt-3 flex flex-col gap-2">
          {#each t.steps as s, index (index)}
            <li
              class="flex gap-2.5 rounded-xl bg-raise px-3 py-2.5 text-sm"
              class:opacity-60={s.done}
            >
              <span class="font-pixel text-faint">{index + 1}.</span>
              <div class="min-w-0 flex-1">
                <div class="flex items-start gap-2">
                  {#if tickable(s)}
                    <input
                      type="checkbox"
                      class="mt-1"
                      checked={s.done}
                      disabled={busy}
                      aria-label={s.done ? `Undo step ${index + 1}` : `Mark step ${index + 1} done`}
                      onchange={() => step(t, index, { op: s.done ? 'untick' : 'tick' })}
                    />
                  {/if}
                  <span class="leading-relaxed" class:line-through={s.done}>{s.text}</span>
                  {#if s.done && !tickable(s)}
                    <button
                      class="ms-auto shrink-0 text-xs text-muted underline hover:text-ink disabled:opacity-40"
                      disabled={busy}
                      onclick={() => step(t, index, { op: 'untick' })}>Undo</button
                    >
                  {/if}
                </div>
                {#if s.action?.kind === 'oauth' && !s.done}
                  <button
                    class="mt-2 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
                    disabled={busy}
                    onclick={() => hostedSignIn(t, index)}>Sign in</button
                  >
                {:else if s.action?.kind === 'secret' && !s.done}
                  <div class="mt-2 flex gap-2">
                    <input
                      type="password"
                      class="min-w-0 flex-1 rounded-lg bg-night/60 px-2.5 py-1.5 text-xs outline-none"
                      placeholder={s.action.name === 'Authorization' ? 'API key' : s.action.name}
                      bind:value={secret[index]}
                    />
                    <button
                      class="rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
                      disabled={busy || !secret[index]?.trim()}
                      onclick={() => saveSecret(t, index)}>Save</button
                    >
                  </div>
                {:else if s.action?.kind === 'tools' && !s.done}
                  {#if !toolList[index]}
                    <button
                      class="mt-2 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
                      disabled={busy}
                      onclick={() => loadTools(t, index)}>{busy ? 'Connecting' : 'Connect'}</button
                    >
                  {:else}
                    {@const list = toolList[index]}
                    <p class="mt-2 text-xs text-muted">
                      Ticked tools are the ones the Odd may use. Only tick tools that read.
                    </p>
                    <ul class="mt-1.5 flex max-h-48 flex-col gap-1 overflow-y-auto">
                      {#each list as tool (tool.name)}
                        <li>
                          <label class="flex items-start gap-2 text-xs">
                            <input
                              type="checkbox"
                              class="mt-0.5"
                              bind:checked={readPick[tool.name]}
                            />
                            <span>
                              <code class="text-sea">{tool.name}</code>
                              {#if tool.readOnly}<span class="text-moss"> reads only</span>{/if}
                              <span class="block text-faint">{tool.description.slice(0, 120)}</span>
                            </span>
                          </label>
                        </li>
                      {/each}
                    </ul>
                    <button
                      class="mt-2 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
                      disabled={busy}
                      onclick={() =>
                        step(t, index, {
                          op: 'confirm-tools',
                          tools: list.map((x) => x.name),
                          readTools: list.filter((x) => readPick[x.name]).map((x) => x.name)
                        })}>Confirm</button
                    >
                  {/if}
                {:else if s.action?.kind === 'choice'}
                  {#if s.answer}
                    <div class="mt-1.5 text-xs text-sea">You chose: {s.answer}</div>
                  {:else}
                    <div class="mt-2 flex flex-wrap gap-2">
                      {#each s.action.options as option (option)}
                        <button
                          class="rounded-lg bg-night/60 px-3 py-1.5 text-xs font-medium hover:bg-sea/25 disabled:opacity-40"
                          disabled={busy}
                          onclick={() => step(t, index, { op: 'choose', answer: option })}
                          >{option}</button
                        >
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            </li>
          {/each}
        </ol>
        {#key open.key}
          <Attachments items={attached('task', t.id)} start="edit" ondirty={(d) => (unsaved = d)} />
        {/key}
        <label class="mt-4 block text-xs text-muted" for="note">Note (optional)</label>
        <textarea
          id="note"
          rows="2"
          class="mt-1 w-full resize-none rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint"
          placeholder="Anything your Odds should know"
          bind:value={note}></textarea>
        {#if from}
          <p class="mt-2 text-[11px] text-faint">
            {from.name} picks up from here as soon as you mark it done.
          </p>
        {/if}
        <div class="mt-3 flex gap-2">
          <button
            class="rounded-lg bg-raise px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-40"
            disabled={busy || unsaved}
            onclick={() => finish(t, false)}>Drop it</button
          >
          <button
            class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
            disabled={busy || unsaved || doneCount(t.steps) < t.steps.length}
            onclick={() => finish(t, true)}
            >{unsaved
              ? 'Save the attached file first'
              : doneCount(t.steps) < t.steps.length
                ? `${t.steps.length - doneCount(t.steps)} steps to go`
                : 'Mark done'}</button
          >
        </div>
      {:else}
        {@const r = open.row}
        <SelectToChat {staff} author={r.staffId} what={`report "${r.title}"`}>
          <Markdown text={r.body} staff={r.staffId} class="mt-3 text-sm" />
        </SelectToChat>
        <p class="mt-2 text-[11px] text-faint">
          Select any part of it to chat with an Odd about it.
        </p>
        <p class="mt-4 text-[11px] text-faint">
          Feedback goes to {from?.name ?? 'the Odd'} as a reply in their chat. Replying marks it read.
        </p>
        <div class="mt-2 flex gap-2">
          {#if r.staffId}
            {@const author = r.staffId}
            <button
              class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night"
              onclick={() => replyAbout(author, { kind: 'report', id: r.id, title: r.title })}
              >Reply to {from?.name ?? 'them'}</button
            >
          {/if}
          <button
            class="rounded-lg bg-raise px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-40"
            disabled={busy}
            onclick={() => act(() => call(`/api/reports/${r.id}`, {}), true)}>Read</button
          >
        </div>
      {/if}
      {#if problem}
        <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
      {/if}
    {/if}
  </div>
</section>
