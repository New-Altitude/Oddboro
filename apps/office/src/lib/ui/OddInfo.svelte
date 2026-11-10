<script lang="ts">
  // An Odd's info page, opened from its name in the panel's header: one
  // scrolling page of sections, the most useful first. Who it is and what it
  // is doing now, with what its runs go through; what is in progress; its
  // jobs, each to edit, with when it runs next; its job description; its
  // stats; and its look, to redraw, with Send to a place. The header's
  // in-progress count opens it at In progress (`focus`).
  import { onMount } from 'svelte';
  import { LEVEL_LABEL } from '@oddboro/ledger/access';
  import { AGENT_NAMES, EFFORT_NAMES, MODELS } from '@oddboro/ledger/agents';
  import Pixel from './Pixel.svelte';
  import JobDescription from './JobDescription.svelte';
  import JobsSection from './JobsSection.svelte';
  import LookStudio from './LookStudio.svelte';
  import WorkSection from './WorkSection.svelte';
  import { call } from './api.ts';
  import type { Work } from '../staff/work.ts';
  import { ACTIVITY_LABEL, type Activity, type StaffProfile } from '../staff/roster.ts';

  type Props = {
    profile: StaffProfile;
    activity: Activity;
    version: number;
    working: string | undefined;
    work: Work[];
    /** Bumped to scroll to In progress. */
    focus: number;
    onsend: () => void;
  };
  let { profile, activity, version, working, work, focus, onsend }: Props = $props();

  let inProgress = $state<HTMLElement>();
  $effect(() => {
    if (focus && inProgress) inProgress.scrollIntoView({ block: 'start' });
  });

  const hired = $derived(
    new Date(`${profile.hired}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  );
  /** What its runs go through, as one quiet line: the tool, its model and how hard it thinks. */
  const runsOn = $derived.by(() => {
    const model = MODELS[profile.agent].find(
      (m) => m.id === (profile.model ?? profile.officeModel)
    );
    return [
      AGENT_NAMES[profile.agent],
      (profile.model ?? profile.officeModel)?.startsWith('magpie:')
        ? `Magpie: ${(profile.model ?? profile.officeModel)!.slice(7)}`
        : model?.name,
      profile.effort && `thinks ${EFFORT_NAMES[profile.effort].toLowerCase()}`
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /** Its walking look, facing front and to the side: a drawn look's frames, read once. */
  let frames = $state<{ sheet: string; frames: Record<string, number> } | undefined>();
  onMount(() => {
    if (!profile.look) return;
    call<{ sheet: string; frames: Record<string, number> }>(profile.look.sheet)
      .then((f) => (frames = f))
      .catch(() => {});
  });

  let redrawing = $state(false);
  let appearance = $state('');
</script>

<div class="flex h-full flex-col gap-5 overflow-y-auto p-3">
  <section class="flex gap-3 rounded-xl bg-raise p-3" aria-label="Who">
    <div
      class="portrait flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-lg"
    >
      <Pixel
        src={profile.look?.portrait}
        frame={`${profile.portrait}/default`}
        fallback={`${profile.sprite}@${profile.variant}/idle-down-0`}
        scale={2}
        label={`Portrait of ${profile.name}`}
        class="block"
      />
    </div>
    <div class="min-w-0 flex-1">
      <div class="font-pixel text-2xl leading-none">{profile.name}</div>
      <div class="mt-1 text-sm text-ember">{profile.role}</div>
      <div class="mt-2 flex items-center gap-1.5 text-xs text-ink">
        <span class="dot" class:live={activity !== 'home'}></span>
        <span class="truncate">{working ? `Running ${working}` : ACTIVITY_LABEL[activity]}</span>
      </div>
      <div class="mt-1 truncate text-[11px] text-muted">{runsOn}</div>
    </div>
  </section>
  <p class="-mt-3 px-1 text-xs leading-relaxed text-muted">
    {profile.remit}
    <span class="block text-[11px] text-faint"
      >{LEVEL_LABEL[profile.permission]} · Hired {hired}</span
    >
  </p>

  <div bind:this={inProgress} class="scroll-mt-3">
    <WorkSection {profile} items={work} />
  </div>

  <JobsSection {profile} {version} {working} />

  <JobDescription {profile} {version} />

  <section aria-label="Stats">
    <h3 class="mb-2 text-xs font-semibold text-ink">Stats</h3>
    <div class="-mx-4">
      <!-- Loaded when shown: its charts (layerchart) stay out of the first page. -->
      {#await import('./UsageStats.svelte') then { default: UsageStats }}
        <UsageStats staffId={profile.id} {version} />
      {/await}
    </div>
  </section>

  <section aria-label="Look">
    <h3 class="text-xs font-semibold text-ink">Look</h3>
    <div class="mt-2 flex items-end justify-center gap-5 rounded-xl bg-raise p-3">
      <div class="portrait overflow-hidden rounded-lg">
        <Pixel
          src={profile.look?.portrait}
          frame={`${profile.portrait}/default`}
          fallback={`${profile.sprite}@${profile.variant}/idle-down-0`}
          scale={3}
          label={`Portrait of ${profile.name}`}
          class="block"
        />
      </div>
      {#if frames}
        {#each ['idle-down-0', 'idle-side-0'] as f (f)}
          <Pixel
            src={frames.sheet}
            crop={{ x: frames.frames[f] ?? 0, y: 0, w: 16, h: 32 }}
            scale={4}
            label={f === 'idle-down-0' ? `${profile.name}, standing` : ''}
            class="block"
          />
        {/each}
      {/if}
    </div>
    <div class="mt-2 flex gap-1.5">
      <!-- A persona Odd's look is its package's, the same in every office. -->
      {#if !profile.persona}
        <button
          class="flex-1 rounded-lg bg-raise px-3 py-2 text-xs text-ink hover:bg-sea/20"
          aria-expanded={redrawing}
          onclick={() => (redrawing = !redrawing)}>Redraw look</button
        >
      {/if}
      <button
        class="flex-1 rounded-lg bg-raise px-3 py-2 text-xs text-ink hover:bg-sea/20"
        onclick={onsend}>Send to a place</button
      >
    </div>
    {#if redrawing}
      <div class="mt-3">
        <LookStudio
          name={profile.name}
          role={profile.role}
          staffId={profile.id}
          current={profile.look?.spec}
          bind:description={appearance}
          keepLabel="Keep and save"
          onkeep={async (d) => {
            await call(`/api/staff/${profile.id}/look`, d, 'PUT');
            redrawing = false;
          }}
        />
      </div>
    {/if}
  </section>
</div>

<style>
  .portrait {
    background:
      radial-gradient(
        70% 70% at 50% 35%,
        color-mix(in srgb, var(--color-sea) 35%, transparent),
        transparent 70%
      ),
      linear-gradient(var(--color-sea-deep), var(--color-sea-night));
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 99px;
    background: var(--color-faint);
  }
  .dot.live {
    background: var(--color-moss);
    box-shadow: 0 0 8px var(--color-moss);
  }
</style>
