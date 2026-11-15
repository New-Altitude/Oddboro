<script lang="ts">
  // A goal's page on the phone: why it matters, what done looks like, how far
  // along it is and who is on it, then the team's work as one conversation,
  // read only: each hand-off with its brief, each result coming back, and what
  // of it waits on the owner, with the same buttons as the Desk tab's cards
  // (`cardButtons` in `phone-desk.ts`). Call opens the lead's chat. The box at
  // the foot sends the owner's words to the lead's own chat.
  import type { Desk } from '@oddboro/ledger';
  import type { StaffProfile } from '#lib/staff/roster.ts';
  import type { PhoneGoal } from '#lib/server/phone-goals.ts';
  import { call, type ApiUrl } from '#lib/ui/api.ts';
  import { ago } from '#lib/ui/format.ts';
  import Markdown from '#lib/ui/Markdown.svelte';
  import OddFace from './OddFace.svelte';
  import { cardButtons, cardLine, type CardButton, type DeskCard } from './phone-desk.ts';
  import { goalLines, messageLead, progressLine, workLine } from './phone-goals.ts';

  type Props = {
    goal: PhoneGoal;
    desk: Desk;
    staff: StaffProfile[];
    onback: () => void;
    /** Opens a call with an Odd. */
    oncall: (id: string) => void;
    /** Opens an Odd's chat. */
    onchat: (id: string) => void;
    /** Opens a desk item, by its key, on the Desk tab. */
    onopen: (key: string) => void;
  };
  let { goal, desk, staff, onback, oncall, onchat, onopen }: Props = $props();

  const who = (id: string | null | undefined) => staff.find((p) => p.id === id);
  const lead = $derived(who(goal.leadId));
  const lines = $derived(goalLines(goal.entries, goal.open, desk));

  /** Steps opened in full; the rest show their first lines. */
  const long = (text: string) => text.length > 280 || text.split(/\r?\n/).length > 6;
  let full = $state<Record<string, boolean>>({});

  /** The card a tap is posting for, and each card's last problem, by key. */
  let busy = $state<string | undefined>();
  let problems = $state<Record<string, string>>({});
  async function tap(c: DeskCard, b: CardButton) {
    if (b.id === 'open' || b.id === 'reply') return onopen(c.key);
    busy = c.key;
    delete problems[c.key];
    try {
      // The live line reloads the desk and this page, which takes the card off.
      await call(b.post.url as ApiUrl, b.post.body);
    } catch (e) {
      problems[c.key] = e instanceof Error ? e.message : String(e);
    } finally {
      busy = undefined;
    }
  }
  const style = (b: CardButton) =>
    b.id === 'yes' ? 'bg-sea text-night' : 'bg-white/10 text-ink hover:bg-coral/25';

  let message = $state('');
  let sending = $state(false);
  /** How the last message went, in words built from the route's answer. */
  let sent = $state<{ ok: boolean; line: string } | undefined>();
  async function send(e: SubmitEvent) {
    e.preventDefault();
    const to = lead;
    const words = message.trim();
    if (!to || !words || sending) return;
    sending = true;
    sent = { ok: true, line: `Sending to ${to.name}.` };
    message = '';
    try {
      await messageLead(to.id, words, () => {
        sent = { ok: true, line: `Sent to ${to.name}. ${to.name} is replying.` };
      });
      sent = { ok: true, line: `${to.name} replied in your chat.` };
    } catch (err) {
      // Not sent: the words go back in the box.
      message = words;
      sent = { ok: false, line: err instanceof Error ? err.message : String(err) };
    } finally {
      sending = false;
    }
  }
</script>

<div class="flex h-full flex-col">
  <header class="flex items-center gap-2 border-b border-hairline py-3 ps-1 pe-4">
    <button
      class="flex w-11 shrink-0 items-center justify-center text-muted"
      aria-label="Back to Goals"
      onclick={onback}
    >
      <svg
        class="size-5 rtl:-scale-x-100"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg
      >
    </button>
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold text-ink">{goal.title}</h1>
      <p class="truncate text-sm text-muted">
        <span class="capitalize">{goal.area}</span> · {goal.when}
      </p>
    </div>
    {#if lead}
      <button
        class="flex shrink-0 items-center gap-2 rounded-full border border-sea px-4 text-sea"
        aria-label={`Call ${lead.name}, the lead`}
        onclick={() => oncall(lead.id)}
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
        Call
      </button>
    {/if}
  </header>

  <div class="min-h-0 flex-1 overflow-y-auto">
    <section class="border-b border-hairline px-5 py-4">
      {#if goal.why}
        <p class="text-ink"><span class="text-muted">Why:</span> {goal.why}</p>
      {/if}
      {#if goal.doneWhen}
        <p class="mt-1 text-ink"><span class="text-muted">Done when:</span> {goal.doneWhen}</p>
      {/if}
      {#if goal.progress.total}
        <div
          class="mt-3 h-1.5 overflow-hidden rounded-full bg-hairline"
          role="progressbar"
          aria-label="Parts done"
          aria-valuemin={0}
          aria-valuemax={goal.progress.total}
          aria-valuenow={goal.progress.done}
        >
          <div
            class="h-full rounded-full bg-sea"
            style:inline-size={`${(goal.progress.done / goal.progress.total) * 100}%`}
          ></div>
        </div>
      {/if}
      <div class="mt-3 flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <p class="text-muted">{progressLine(goal.progress)}</p>
          {#if goal.progress.note}
            <p class="mt-0.5 line-clamp-2 text-sm text-faint">{goal.progress.note}</p>
          {/if}
        </div>
        <span class="flex shrink-0">
          {#each goal.faces.slice(0, 5) as id, n (id)}
            <OddFace
              odd={who(id)}
              class="size-9 rounded-full ring-2 ring-night {n ? '-ms-3' : ''}"
            />
          {/each}
        </span>
      </div>
    </section>

    <section class="px-4 py-4" aria-label="The team's work">
      <ul class="flex flex-col gap-5">
        {#each lines as l (l.kind === 'entry' ? l.entry.key : l.card.key)}
          {#if l.kind === 'entry'}
            {@const e = l.entry}
            {@const w = workLine(e)}
            <li class="flex gap-3">
              <OddFace odd={who(e.by)} name={e.name} class="size-10 rounded-lg" />
              <div class="min-w-0 flex-1">
                <p class="flex items-baseline gap-2">
                  <span class="font-semibold text-ink">{e.name}</span>
                  <span class="text-sm text-faint">{ago(e.at)}</span>
                </p>
                {#if e.text}
                  <div class="text-ink" class:line-clamp-6={!full[e.key]}>
                    <Markdown text={e.text} staff={e.by} />
                  </div>
                  {#if !full[e.key] && long(e.text)}
                    <button class="text-sm text-sea" onclick={() => (full[e.key] = true)}
                      >Show all</button
                    >
                  {/if}
                {/if}
                {#if w && e.work}
                  <div
                    class="mt-2 rounded-xl border border-hairline border-s-4 border-s-sea px-4 py-2.5"
                  >
                    <p class="font-medium text-ink">{w}</p>
                    <p class="text-muted">{e.work.title}</p>
                  </div>
                {/if}
              </div>
            </li>
          {:else}
            {@const c = l.card}
            {@const from = who(c.row.staffId)}
            <li class="rounded-xl border-s-4 border-s-ember bg-ember/10 px-4 py-3">
              <p class="font-medium text-ink">Waiting on you · {c.row.title}</p>
              <p class="line-clamp-2 text-ember">
                {from?.name ?? 'The office'}{cardLine(c) ? ` · ${cardLine(c)}` : ''}
              </p>
              <div class="mt-3 flex gap-2">
                {#each cardButtons(c) as b (b.id)}
                  <button
                    class="flex-1 rounded-xl px-3 py-2.5 font-medium disabled:opacity-40 {style(b)}"
                    disabled={busy === c.key}
                    onclick={() => tap(c, b)}>{b.label}</button
                  >
                {/each}
              </div>
              {#if problems[c.key]}
                <p class="mt-2 text-sm text-coral" role="alert">{problems[c.key]}</p>
              {/if}
            </li>
          {/if}
        {:else}
          <li class="py-6 text-center text-muted">No work on this goal yet.</li>
        {/each}
      </ul>
    </section>
  </div>

  {#if lead}
    <form class="border-t border-hairline px-4 py-3" onsubmit={send}>
      {#if sent}
        <p class="mb-2 text-sm {sent.ok ? 'text-muted' : 'text-coral'}" role="status">
          {sent.line}
          {#if sent.ok && !sending}
            <button type="button" class="ms-1 text-sea" onclick={() => onchat(lead.id)}
              >Open the chat</button
            >
          {/if}
        </p>
      {/if}
      <div class="flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-2xl border border-hairline bg-transparent px-3 py-2.5 text-ink placeholder:text-faint"
          placeholder={`Message the team (goes to ${lead.name}, the lead)`}
          aria-label={`Message the team. It goes to ${lead.name}, the lead.`}
          bind:value={message}
          disabled={sending}
        />
        {#if message.trim() || sending}
          <button
            class="shrink-0 rounded-2xl bg-sea px-4 font-medium text-night disabled:opacity-40"
            disabled={sending}>Send</button
          >
        {/if}
      </div>
    </form>
  {/if}
</div>
