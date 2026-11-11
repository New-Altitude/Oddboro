<script lang="ts">
  // One email reply an Odd proposed (a `reply` ask), reviewed on the Desk:
  // the Odd's summary of the email it answers, that email itself on demand,
  // then the reply to edit and send, save to Gmail drafts, send back with a
  // note, skip or discard. Back and Next, and the arrow keys outside a field,
  // step through the open replies, oldest first.
  import type { AskRow, ReplyDraft } from '@oddboro/ledger';
  import { untrack } from 'svelte';
  import ChatFiles from './ChatFiles.svelte';
  import Markdown from './Markdown.svelte';
  import ReviewNav from './ReviewNav.svelte';
  import { call } from './api.ts';
  import { after, around } from './review-steps.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  type Props = {
    ask: AskRow & { reply: ReplyDraft };
    /** Every open reply on the desk, oldest first. */
    replies: AskRow[];
    staff: StaffProfile[];
    /** The ask this one reworks, when the owner sent that one back. */
    reworks: AskRow | null;
    /** Open another reply by its ask id, or go back to the desk with none. */
    ongo: (id: number | undefined) => void;
    /** Open an Odd's card. */
    onstaff: (id: string) => void;
  };
  let { ask: a, replies, staff, reworks, ongo, onstaff }: Props = $props();

  const nameOf = (id: string | null) => staff.find((p) => p.id === id)?.name ?? id ?? 'the Odd';
  const from = $derived(nameOf(a.staffId));
  const next = $derived(around(replies, a.id).next);

  // The parent keys this view on the ask, so each reply starts from what the
  // Odd wrote, and a desk reload never undoes the owner's edits.
  const wrote = untrack(() => a.reply);
  let to = $state(wrote.to.join(', '));
  let cc = $state(wrote.cc.join(', '));
  let subject = $state(wrote.subject);
  let body = $state(wrote.body);
  /** The Odd's files, and the ones still going: the owner may take any off, never add one. */
  const attached = wrote.attachments ?? [];
  let keep = $state(attached.map((f) => f.path));
  let busy = $state(false);
  let problem = $state('');
  /** Ask for changes or Discard, waiting for its note. */
  let mode = $state<'changes' | 'discard' | undefined>();
  let note = $state('');

  type Original = { from: string; date: string; subject: string; body: string };
  let shown = $state(false);
  let original = $state<Original | undefined>();
  let originalProblem = $state('');
  /** Unfold the email it answers, read from Gmail the first time. */
  async function unfold() {
    shown = !shown;
    if (!shown || original) return;
    originalProblem = '';
    try {
      original = await call<Original>(`/api/asks/${a.id}/original`);
    } catch (e) {
      originalProblem = e instanceof Error ? e.message : String(e);
    }
  }

  const list = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  async function act(fn: () => Promise<unknown>, then: number | undefined) {
    busy = true;
    problem = '';
    try {
      await fn();
      ongo(then);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  const go = (action: 'send' | 'draft') =>
    act(
      () =>
        call(`/api/asks/${a.id}/reply`, {
          action,
          to: list(to),
          cc: list(cc),
          subject,
          body,
          attachments: keep
        }),
      after(replies, a.id)
    );
  const decide = (decision: 'iterate' | 'deny') =>
    act(() => call(`/api/asks/${a.id}`, { decision, reason: note.trim() }), after(replies, a.id));

  /** Skip leaves it on the desk and moves on, round to the first. */
  const skip = () => ongo((next ?? (replies[0]?.id !== a.id ? replies[0] : undefined))?.id);

  /** The body grows with what it holds. */
  function grow(el: HTMLTextAreaElement) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    el.addEventListener('input', fit);
    return { destroy: () => el.removeEventListener('input', fit) };
  }
</script>

<ReviewNav label="Reply" ask={a} list={replies} {staff} {busy} {ongo} {onstaff}>
  {#if reworks}
    <div class="mt-3 rounded-lg bg-sea/10 px-2.5 py-2 text-xs">
      <div class="text-muted">Reworks “{reworks.title}”</div>
      {#if reworks.reason}<div class="mt-0.5">You asked: {reworks.reason}</div>{/if}
    </div>
  {/if}

  <div class="mt-3 rounded-xl bg-raise px-3 py-2.5 text-sm">
    <div class="text-xs text-muted">{from}'s summary</div>
    <p class="mt-0.5 leading-relaxed">{a.reply.summary}</p>
    {#if a.reply.gmailThreadId}
      <button
        class="mt-1.5 text-xs text-sea underline underline-offset-2"
        aria-expanded={shown}
        onclick={unfold}>{shown ? 'Hide the email it answers' : 'Show the email it answers'}</button
      >
      {#if shown}
        {#if original}
          <div class="mt-2 border-t border-hairline pt-2 text-xs">
            <div><span class="text-muted">From:</span> {original.from}</div>
            <div><span class="text-muted">Date:</span> {original.date}</div>
            <div><span class="text-muted">Subject:</span> {original.subject}</div>
            <pre
              class="mt-2 max-h-72 overflow-y-auto font-sans text-xs leading-relaxed break-words whitespace-pre-wrap">{original.body}</pre>
          </div>
        {:else if originalProblem}
          <p class="mt-2 text-xs text-coral">{originalProblem}</p>
        {:else}
          <p class="mt-2 text-xs text-faint">Reading it from Gmail.</p>
        {/if}
      {/if}
    {:else}
      <p class="mt-1 text-xs text-faint">A new email, not a reply.</p>
    {/if}
  </div>

  <div class="mt-3 text-sm">
    <div class="text-xs text-muted">Why</div>
    <div class="mt-0.5"><Markdown text={a.why} staff={a.staffId} /></div>
  </div>

  <div class="mt-3 flex flex-col gap-2 text-sm">
    {#if a.reply.account}
      <div class="flex items-center gap-2">
        <span class="w-14 shrink-0 text-xs text-muted">From</span>
        <span class="min-w-0 flex-1 truncate px-2.5">{a.reply.account}</span>
      </div>
    {/if}
    <label class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-xs text-muted">To</span>
      <input
        class="min-w-0 flex-1 rounded-lg bg-raise px-2.5 py-1.5 outline-none"
        bind:value={to}
        disabled={busy}
      />
    </label>
    <label class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-xs text-muted">Cc</span>
      <input
        class="min-w-0 flex-1 rounded-lg bg-raise px-2.5 py-1.5 outline-none"
        bind:value={cc}
        disabled={busy}
      />
    </label>
    <label class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-xs text-muted">Subject</span>
      <input
        class="min-w-0 flex-1 rounded-lg bg-raise px-2.5 py-1.5 outline-none"
        bind:value={subject}
        disabled={busy}
      />
    </label>
    <textarea
      aria-label="The reply"
      rows="6"
      class="w-full resize-none overflow-hidden rounded-lg bg-raise px-3 py-2 leading-relaxed outline-none"
      bind:value={body}
      disabled={busy}
      use:grow></textarea>
    {#if attached.length}
      <div class="flex flex-col gap-1.5">
        <span class="text-xs text-muted"
          >Attached{keep.length < attached.length
            ? ` (${attached.length - keep.length} taken off)`
            : ''}</span
        >
        {#if keep.length}
          <ChatFiles
            files={attached
              .map((f, n) => ({
                key: f.path,
                tag: f.name,
                mediaType: f.mediaType,
                size: f.size,
                url: `/api/asks/${a.id}/attachments/${n}`
              }))
              .filter((f) => keep.includes(f.key))}
            onremove={(k) => (keep = keep.filter((p) => p !== k))}
          />
        {:else}
          <button
            class="self-start text-xs text-sea hover:text-ink"
            onclick={() => (keep = attached.map((f) => f.path))}>Put them back</button
          >
        {/if}
      </div>
    {/if}
  </div>

  {#if mode}
    <label class="mt-3 block text-xs text-muted" for="reply-note"
      >{mode === 'changes'
        ? `What should ${from} change?`
        : 'Why, if you want to say (optional)'}</label
    >
    <textarea
      id="reply-note"
      rows="3"
      class="mt-1 w-full resize-y rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint"
      placeholder={mode === 'changes' ? 'Say what to change.' : `${from} reads it for next time.`}
      bind:value={note}></textarea>
    <div class="mt-2 flex gap-2">
      <button
        class="rounded-lg px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-40"
        disabled={busy}
        onclick={() => ((mode = undefined), (note = ''))}>Cancel</button
      >
      {#if mode === 'changes'}
        <button
          class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
          disabled={busy || !note.trim()}
          onclick={() => decide('iterate')}>Send back to {from}</button
        >
      {:else}
        <button
          class="flex-1 rounded-lg bg-raise px-3 py-2 text-sm font-medium hover:bg-coral/25 disabled:opacity-40"
          disabled={busy}
          onclick={() => decide('deny')}>Discard it</button
        >
      {/if}
    </div>
  {:else}
    <div class="mt-3 flex gap-2">
      <button
        class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
        disabled={busy}
        onclick={() => go('send')}>{busy ? 'Working' : 'Send'}</button
      >
      <button
        class="flex-1 rounded-lg bg-raise px-3 py-2 text-sm font-medium hover:bg-sea/25 disabled:opacity-40"
        disabled={busy}
        onclick={() => go('draft')}>Save to Gmail drafts</button
      >
    </div>
    <div class="mt-2 flex gap-2">
      <button
        class="flex-1 rounded-lg bg-raise px-3 py-1.5 text-xs hover:bg-sea/25 disabled:opacity-40"
        disabled={busy}
        onclick={() => (mode = 'changes')}>Ask for changes</button
      >
      <button
        class="flex-1 rounded-lg bg-raise px-3 py-1.5 text-xs text-muted hover:text-ink disabled:opacity-40"
        disabled={busy}
        onclick={skip}>Skip</button
      >
      <button
        class="flex-1 rounded-lg bg-raise px-3 py-1.5 text-xs hover:bg-coral/25 disabled:opacity-40"
        disabled={busy}
        onclick={() => (mode = 'discard')}>Discard</button
      >
    </div>
    <p class="mt-1.5 text-[11px] text-faint">
      Nothing goes until you click Send. Save to Gmail drafts leaves it in your Gmail, unsent.
    </p>
  {/if}
  {#if problem}
    <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
  {/if}
</ReviewNav>
