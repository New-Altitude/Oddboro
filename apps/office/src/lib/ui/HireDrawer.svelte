<script lang="ts">
  import { onMount } from 'svelte';
  import type { HireProposal, Schedule } from '@oddboro/ledger';
  import { AGENT_NAMES, type Agent } from '@oddboro/ledger/agents';
  import { OFFICE_TOOLS } from '@oddboro/ledger/tools';
  import Pixel from './Pixel.svelte';
  import LookStudio, { type Drawn } from './LookStudio.svelte';
  import SchedulePicker from './SchedulePicker.svelte';
  import RunsOn from './RunsOn.svelte';
  import { call } from './api.ts';
  import { wins } from './windows.svelte.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  type Props = {
    /** Rooms on the floor a staffer can work in: template id and name. */
    rooms: { id: string; name: string }[];
    /** A hire a staffer proposed. Hiring from it approves that ask. */
    from?: { askId: number; staff: string; proposal: HireProposal };
    /** The window this hire is open in. */
    id: string;
    onhired: (p: StaffProfile) => void;
  };
  let { rooms, from, id, onhired }: Props = $props();

  const STEPS = ['Who', 'Where', 'Job description', 'First job', 'Review'];
  let step = $state(0);
  let name = $state('');
  let role = $state('');
  /** The look the owner kept for them. Nobody is hired without one. */
  let look = $state<Drawn | undefined>();
  let appearance = $state('');
  let room = $state('');
  let brief = $state('');
  let remit = $state('');
  let desk = $state('');
  let permission = $state<'read' | 'draft' | 'act'>('read');
  /** The tool its runs go through, its hello first. Stored with the hire. */
  let agent = $state<Agent>('claude');
  let jobName = $state('');
  let jobInstructions = $state('');
  /** Shown only once the owner names a job, so an empty job never reads as an hourly one. */
  let jobSchedule = $state<Schedule>({ every: 'minutes', n: 60 });
  /** Most first jobs make something for the owner to read, so this starts on. */
  let jobReport = $state(true);
  /** Office tools from the proposal. Without one, a hire gets the starters. */
  let tools = $state<string[] | undefined>();
  let busy = $state(false);
  let problem = $state('');

  // Fill the window from the proposal. The job description is read from its
  // file now, so edits the owner made in the viewer are in it.
  onMount(() => {
    if (!from) return;
    const p = from.proposal;
    name = p.name;
    role = p.role;
    remit = p.remit;
    permission = p.permission;
    room =
      rooms.find((r) => r.id === p.room || r.name.toLowerCase() === p.room?.toLowerCase())?.id ??
      '';
    tools = p.tools;
    appearance = p.appearance ?? '';
    if (p.job) {
      jobName = p.job.name;
      jobInstructions = p.job.instructions;
      jobSchedule = p.job.schedule;
      jobReport = p.job.report ?? true;
    }
    busy = true;
    call<{ content: string }>(
      `/api/files?staff=${encodeURIComponent(from.staff)}&path=${encodeURIComponent(p.jobDescriptionFile)}`
    )
      .then((f) => (desk = f.content))
      .catch((e: unknown) => {
        problem = `Could not read the job description: ${e instanceof Error ? e.message : e}`;
      })
      .finally(() => (busy = false));
  });

  // The tab says who is being hired, and closing it asks first once there is
  // something to lose.
  $effect(() => {
    wins.titles[id] = name.trim() ? `Hire ${name.trim()}` : 'New hire';
    wins.dirty[id] = !!(name.trim() || desk.trim() || look);
  });

  /** A job goes with the hire only when it has a name. */
  const hasJob = $derived(!!jobName.trim());
  /** A hire with no job starts nothing alone: a goal's lead passes it each piece (`firstDay`). */
  const noJob = $derived(
    from?.proposal.goal
      ? "No job: its goal's lead passes it each piece of work"
      : 'No job: works only when a colleague passes it work'
  );

  const ready = $derived([
    !!name.trim() && !!role.trim() && !!look,
    !!room,
    !!remit.trim() && !!desk.trim(),
    !jobName.trim() === !jobInstructions.trim(),
    true
  ]);

  async function draftDesk() {
    busy = true;
    problem = '';
    try {
      const r = await call<{ desk: string }>('/api/staff/draft', {
        brief,
        name,
        role,
        permission,
        room: rooms.find((r) => r.id === room)?.name ?? ''
      });
      desk = r.desk;
      if (!remit.trim()) remit = brief.trim().slice(0, 200);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function hire() {
    busy = true;
    problem = '';
    try {
      const p = await call<StaffProfile>('/api/staff', {
        name,
        role,
        look: look?.look,
        portraitPx: look?.portraitPx,
        newParts: look?.newParts,
        room,
        permission,
        agent,
        remit,
        desk,
        tools,
        askId: from?.askId,
        job: hasJob
          ? {
              name: jobName,
              instructions: jobInstructions,
              schedule: jobSchedule,
              report: jobReport
            }
          : undefined
      });
      onhired(p);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const field = 'w-full rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint';
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Hire an Odd">
  <header class="border-b border-hairline p-3">
    <div class="flex items-center">
      <div class="flex-1">
        <div class="font-pixel text-lg leading-none">Hire</div>
        <div class="mt-1 text-xs text-muted">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}{from ? ' · from a proposal' : ''}
        </div>
      </div>
    </div>
    <ol class="mt-2 flex gap-1" aria-hidden="true">
      {#each STEPS as s, i (s)}
        <li class="h-1 flex-1 rounded-full {i <= step ? 'bg-sea' : 'bg-raise'}"></li>
      {/each}
    </ol>
  </header>

  {#if wins.confirm?.id === id}
    <div class="flex flex-wrap items-center gap-2 border-b border-hairline bg-ember/10 px-3 py-2">
      <span class="flex-1 text-xs text-ink"
        >{wins.busy[id] ? `Still drawing ${name || 'them'}.` : 'This hire is not finished.'} Close anyway?</span
      >
      <button
        class="rounded-lg bg-raise px-2.5 py-1 text-xs hover:bg-coral/25"
        onclick={() => wins.confirm?.go()}>Close it</button
      >
      <button
        class="rounded-lg px-2.5 py-1 text-xs text-muted hover:text-ink"
        onclick={() => (wins.confirm = undefined)}>Keep it open</button
      >
    </div>
  {/if}

  <div class="flex flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
    {#if step === 0}
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Name</span>
        <input class={field} placeholder="e.g. Mira" bind:value={name} />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Role</span>
        <input class={field} placeholder="e.g. Mail Clerk" bind:value={role} />
      </label>
      <LookStudio
        {name}
        {role}
        bind:description={appearance}
        kept={look}
        keepLabel="Keep this look"
        onkeep={(d) => {
          look = d;
        }}
        onbusy={(b) => (wins.busy[id] = b)}
      />
    {:else if step === 1}
      <div class="text-xs text-muted">The room {name || 'they'} works in.</div>
      <div class="grid grid-cols-2 gap-2">
        {#each rooms as r (r.id)}
          <button
            class="rounded-xl px-3 py-2 text-start {room === r.id
              ? 'bg-sea/25 ring-1 ring-sea'
              : 'bg-raise'}"
            onclick={() => (room = r.id)}>{r.name}</button
          >
        {/each}
      </div>
    {:else if step === 2}
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">What is the job, in a sentence?</span>
        <textarea
          rows="2"
          class="{field} resize-none"
          placeholder="e.g. Sort my personal email and bring me anything that needs me"
          bind:value={brief}></textarea>
      </label>
      <button
        class="rounded-lg bg-raise px-3 py-2 text-xs font-medium hover:bg-sea/20 disabled:opacity-40"
        disabled={busy || !brief.trim()}
        onclick={draftDesk}>{busy ? 'Drafting' : 'Draft it'}</button
      >
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">One line for the card</span>
        <input class={field} placeholder="What this Odd is for" bind:value={remit} />
      </label>
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted">Job description (its instructions)</span>
        <textarea rows="10" class="{field} font-mono text-xs" bind:value={desk}></textarea>
      </label>
      <div>
        <div class="text-xs text-muted">Permission</div>
        <div class="mt-1 flex gap-1.5">
          <button
            class="flex-1 rounded-lg px-2 py-1.5 text-xs {permission === 'read'
              ? 'bg-sea/25'
              : 'bg-raise'}"
            onclick={() => (permission = 'read')}>Reads and reports</button
          >
          <button
            class="flex-1 rounded-lg px-2 py-1.5 text-xs {permission === 'draft'
              ? 'bg-sea/25'
              : 'bg-raise'}"
            onclick={() => (permission = 'draft')}>Drafts for your yes</button
          >
          <button
            class="flex-1 rounded-lg px-2 py-1.5 text-xs {permission === 'act'
              ? 'bg-sea/25'
              : 'bg-raise'}"
            onclick={() => (permission = 'act')}>Acts on its own</button
          >
        </div>
        <!-- Every option's value is a tool id `/api/agents` sent, so the cast holds. -->
        <RunsOn
          value={agent}
          onpick={(select) => (agent = select.value as Agent)}
          class="mt-2 text-xs"
        />
      </div>
    {:else if step === 3}
      <p class="text-xs text-muted">
        Optional. Access to tools comes later, when they ask for it on their Access tab.
      </p>
      <div class="flex flex-col gap-2 rounded-xl bg-raise p-3">
        <span class="text-xs text-muted">A first job</span>
        {#if !jobName.trim() && !jobInstructions.trim()}
          <span class="text-xs text-ink">{noJob}</span>
        {/if}
        <input
          class="{field} bg-night/60"
          placeholder="Name, e.g. Sort personal mail"
          bind:value={jobName}
        />
        <textarea
          rows="4"
          class="{field} resize-none bg-night/60"
          placeholder="What to do each run"
          bind:value={jobInstructions}></textarea>
        {#if hasJob}
          <SchedulePicker bind:value={jobSchedule} />
          <label class="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" bind:checked={jobReport} /> Put the result on my desk as a report
          </label>
        {/if}
      </div>
    {:else}
      <dl class="flex flex-col gap-2">
        <div>
          <dt class="text-xs text-muted">Who</dt>
          <dd>{name}, {role}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Where</dt>
          <dd>{rooms.find((r) => r.id === room)?.name}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">For</dt>
          <dd>{remit}</dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Permission</dt>
          <dd>
            {permission === 'read'
              ? 'Reads and reports'
              : permission === 'draft'
                ? 'Drafts for your yes'
                : 'Acts on its own'}
          </dd>
        </div>
        <div>
          <dt class="text-xs text-muted">Runs on</dt>
          <dd>{AGENT_NAMES[agent]}</dd>
        </div>
        {#if tools}
          <div>
            <dt class="text-xs text-muted">Office tools</dt>
            <dd>
              {tools.map((t) => OFFICE_TOOLS.find((o) => o.id === t)?.name ?? t).join(', ') ||
                'Only the ones every Odd has'}
            </dd>
          </div>
        {/if}
        <div>
          <dt class="text-xs text-muted">First job</dt>
          <dd>
            {hasJob ? `${jobName.trim()}${jobReport ? ', reports to your desk' : ''}` : noJob}
          </dd>
        </div>
      </dl>
      <div class="flex items-end justify-center gap-6 rounded-xl bg-raise p-3">
        {#if look}
          <Pixel src={look.portrait} scale={3} label={`${name}, portrait`} class="block" />
          <Pixel
            src={look.sheet}
            crop={{ x: look.frames['idle-down-0'] ?? 0, y: 0, w: 16, h: 32 }}
            scale={4}
            label={`${name}, standing`}
            class="block"
          />
        {/if}
      </div>
    {/if}
    {#if problem}
      <p class="rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
    {/if}
  </div>

  <footer class="flex gap-2 border-t border-hairline p-3">
    <button
      class="rounded-lg bg-raise px-3 py-2 text-sm disabled:opacity-40"
      disabled={step === 0 || busy}
      onclick={() => step--}>Back</button
    >
    {#if step < STEPS.length - 1}
      <button
        class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
        disabled={!ready[step] || busy}
        onclick={() => step++}>Next</button
      >
    {:else}
      <button
        class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
        disabled={busy}
        onclick={hire}>{busy ? 'Hiring' : `Hire ${name}`}</button
      >
    {/if}
  </footer>
</section>
