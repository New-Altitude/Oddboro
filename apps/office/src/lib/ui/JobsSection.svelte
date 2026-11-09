<script lang="ts">
  import type { JobRow, RunRow, Schedule } from '@oddboro/ledger';
  import { describe, zoneName } from '@oddboro/ledger/time';
  import SchedulePicker from './SchedulePicker.svelte';
  import ChatSignInCard from './ChatSignInCard.svelte';
  import type { ChatSignIn } from '../server/agent-sign-in.ts';
  import { chatAbout, showInChat } from './chat-about.svelte.ts';
  import Markdown from './Markdown.svelte';
  import { call } from './api.ts';
  import { ago, nextWhen } from './format.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  // An Odd's jobs, on its info page: each with its schedule, its last run and
  // its next ("Next run today at 3:00 PM", or Paused). Clicking a job opens it
  // to edit in place, and "+ Add a job" adds one.
  type Job = JobRow & { lastRun?: RunRow };
  type Props = {
    profile: StaffProfile;
    /** Bumps when jobs or runs change, so the list reloads. */
    version: number;
    working: string | undefined;
  };
  let { profile, version, working }: Props = $props();

  let jobs = $state<Job[]>([]);
  /** The job being edited, 'new' for one being added, or nothing. */
  let editing = $state<number | 'new' | undefined>();
  let name = $state('');
  let instructions = $state('');
  let schedule = $state<Schedule>({ every: 'day', at: '07:00' });
  let report = $state(false);
  let files = $state<Job['files']>(null);
  let share = $state(false);
  type Review = {
    signIns: { name: string; request: ChatSignIn }[];
    browse: { id: string; name: string; ask?: { id: number; title: string } }[];
    blocks: string[];
    waiting?: string;
    checkedAt: string | null;
  };
  let review = $state<Review>();
  let problem = $state('');

  $effect(() => {
    void version;
    call<Job[]>(`/api/staff/${profile.id}/jobs`)
      .then((j) => (jobs = j))
      .catch(() => {});
  });

  async function act(fn: () => Promise<unknown>) {
    problem = '';
    try {
      await fn();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  async function check(id: number) {
    const fresh = await call<Review>(`/api/jobs/${id}`);
    if (editing === id) review = fresh;
  }

  function open(j?: Job) {
    problem = '';
    name = j?.name ?? '';
    instructions = j?.instructions ?? '';
    schedule = j ? { ...j.schedule } : { every: 'day', at: '07:00' };
    report = j?.report ?? false;
    files = j?.files ?? null;
    share = !!files?.share;
    editing = j ? j.id : 'new';
    review = undefined;
    if (j?.files) void act(() => check(j.id));
  }

  async function save() {
    await act(async () => {
      if (editing === 'new')
        await call(`/api/staff/${profile.id}/jobs`, { name, instructions, schedule, report });
      else
        await call(`/api/jobs/${editing}`, {
          op: 'update',
          name,
          instructions,
          schedule,
          report,
          ...(files && share !== !!files.share ? { share, expectedFiles: files } : {})
        });
      editing = undefined;
    });
  }
</script>

<section aria-label="Jobs">
  <div class="flex items-center gap-2">
    <h3 class="flex-1 text-xs font-semibold text-ink">Jobs</h3>
    {#if editing === undefined}
      <button
        class="rounded-lg bg-raise px-2.5 py-1 text-xs font-medium hover:bg-sea/20"
        onclick={() => open()}>+ Add a job</button
      >
    {/if}
  </div>
  <p class="mt-0.5 text-[11px] text-muted">
    {working
      ? `Running ${working} now.`
      : `What it does on its own, and how often, in ${zoneName()}.`}
  </p>
  <div class="mt-2">
    {#snippet form()}
      <div class="flex flex-col gap-2 rounded-xl bg-raise p-3">
        <input
          class="rounded-lg bg-night/60 px-3 py-2 text-sm outline-none placeholder:text-faint"
          placeholder="Name, e.g. Sort personal mail"
          aria-label="Job name"
          bind:value={name}
        />
        <textarea
          rows="8"
          class="resize-y rounded-lg bg-night/60 px-3 py-2 text-sm outline-none placeholder:text-faint"
          placeholder="What to do each run, as numbered steps"
          aria-label="What to do each run"
          bind:value={instructions}></textarea>
        <SchedulePicker bind:value={schedule} />
        {#if files}
          <div aria-live="polite" class="text-xs text-muted">
            {#if review}
              {#each review.blocks as block (block)}<p>{block}</p>{/each}
              {#each review.signIns as sign}
                <ChatSignInCard
                  request={sign.request}
                  name={sign.name}
                  onready={() => typeof editing === 'number' && act(() => check(Number(editing)))}
                  retryLabel="Check job again"
                />
              {/each}
              {#each review.browse as odd (odd.id)}
                <button
                  class="text-sea"
                  onclick={() =>
                    odd.ask
                      ? showInChat(odd.id, { kind: 'ask', ...odd.ask })
                      : chatAbout(
                          odd.id,
                          `Please ask for Browse the web for your part of "${name}".`
                        )}
                  >{odd.ask ? 'Review browsing request' : 'Request browsing'} in {odd.name}'s chat</button
                >
              {/each}
              {#if review.waiting}<p>{review.waiting}</p>{/if}
              <p>
                {review.checkedAt
                  ? `Last scheduled file check ${ago(review.checkedAt)}.`
                  : `Waiting for a scheduled run to check ${files.output}.`}
              </p>
              {#if files.sources?.length}<p>
                  The run checks its source sign-ins when it starts.
                </p>{/if}
            {:else if !problem}
              Checking access for these files…
            {/if}
          </div>
        {:else if editing !== 'new'}
          <p class="text-xs text-muted">
            To exchange files with a colleague, ask {profile.name} in chat to link this job to that work.
          </p>
        {/if}
        {#if files?.sources?.length}
          <label class="flex items-center gap-2 text-xs text-muted"
            ><input type="checkbox" bind:checked={share} />
            Allow colleagues on this work to read {files.output} with material from {files.sources.join(
              ', '
            )}.
          </label>
        {/if}
        <label class="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" bind:checked={report} /> Put the result on my desk as a report
        </label>
        <div class="flex gap-2">
          <button
            class="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-ink"
            onclick={() => (editing = undefined)}>Cancel</button
          >
          <button
            class="flex-1 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
            disabled={!name.trim() || !instructions.trim()}
            onclick={save}>{editing === 'new' ? 'Add job' : 'Save changes'}</button
          >
        </div>
      </div>
    {/snippet}
    {#if editing === 'new'}
      <div class="mb-3">{@render form()}</div>
    {/if}
    {#if !jobs.length && editing !== 'new'}
      <p class="rounded-xl bg-raise px-3 py-3 text-sm text-muted">
        No jobs yet. A job runs on its own on a schedule.
      </p>
    {/if}
    <ul class="flex flex-col gap-2">
      {#each jobs as j (j.id)}
        {#if editing === j.id}
          <li>{@render form()}</li>
        {:else}
          <li class="rounded-xl bg-raise p-3 text-sm" class:opacity-60={!j.enabled}>
            <button
              class="flex w-full items-start gap-2 text-start"
              title="Edit {j.name}"
              onclick={() => open(j)}
            >
              <span class="min-w-0 flex-1">
                <span class="block font-medium hover:underline hover:underline-offset-2"
                  >{j.name}</span
                >
                <span class="block text-xs text-muted">
                  {describe(j.schedule)}{j.report ? ' · report to your desk' : ''}
                </span>
              </span>
              {#if working === j.name}
                <span class="rounded-full bg-moss/20 px-2 py-0.5 text-[11px] text-moss"
                  >Running</span
                >
              {/if}
            </button>
            <div class="mt-2 grid grid-cols-2 gap-1 text-[11px]">
              <span class={j.enabled ? 'text-ink' : 'text-muted'}
                >{j.enabled
                  ? j.nextRunAt
                    ? `Next run ${nextWhen(j.nextRunAt)}`
                    : 'No next run'
                  : 'Paused'}</span
              >
              <span class="text-faint"
                >Last run {j.lastRun
                  ? `${j.lastRun.status === 'failed' ? 'failed ' : ''}${ago(j.lastRun.startedAt)}${j.lastRun.trigger === 'manual' ? ', by you' : ''}`
                  : 'never'}</span
              >
            </div>
            {#if j.lastRun?.summary}
              <details class="mt-1 text-xs text-muted">
                <summary class="cursor-pointer text-faint">Last result</summary>
                <Markdown text={j.lastRun.summary} staff={profile.id} class="mt-1" />
              </details>
            {/if}
            <div class="mt-2 flex gap-1.5">
              <button
                class="rounded-lg bg-night/60 px-2.5 py-1 text-xs hover:bg-sea/25 disabled:opacity-40"
                disabled={!!working}
                onclick={() => act(() => call(`/api/jobs/${j.id}`, { op: 'run' }))}>Run now</button
              >
              <button
                class="rounded-lg bg-night/60 px-2.5 py-1 text-xs hover:bg-sea/25"
                onclick={() =>
                  act(() => call(`/api/jobs/${j.id}`, { op: 'update', enabled: !j.enabled }))}
                >{j.enabled ? 'Pause' : 'Resume'}</button
              >
              {#if !j.enabled && !j.lastRun}
                <button
                  class="rounded-lg px-2.5 py-1 text-xs text-muted hover:text-coral"
                  onclick={() => act(() => call(`/api/jobs/${j.id}`, { op: 'delete' }))}
                  >Remove</button
                >
              {/if}
            </div>
          </li>
        {/if}
      {/each}
    </ul>
    {#if problem}
      <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
    {/if}
  </div>
</section>
