<script lang="ts" module>
  // Every Odd is on the rail at the end edge (OddsRail.svelte), not here.
  const SECTIONS = [
    { id: 'desk', label: 'Desk' },
    { id: 'goals', label: 'Goals' },
    { id: 'lessons', label: 'Lessons' },
    { id: 'ledger', label: 'Ledger' },
    { id: 'services', label: 'Services' },
    { id: 'projects', label: 'Projects' },
    { id: 'hire', label: 'Hire' },
    { id: 'office', label: 'Office' }
  ] as const;
  /** A section's button on the plate. */
  export type Section = (typeof SECTIONS)[number]['id'];
</script>

<script lang="ts">
  import { zoneName, zoneShort } from '@oddboro/ledger/time';
  import { advanced, wins, type Win } from './windows.svelte.ts';
  import BusySquare from './BusySquare.svelte';
  import RestoredNote from './RestoredNote.svelte';

  // The office plate: the office's name, its clock and Setup, then a button
  // for each section, which brings that section's window forward.

  type Props = {
    /** Drawn at the top of the open start panel, with the button that folds it away. */
    open: boolean;
    /** The lot during the first run, then the office. */
    plateName: string;
    office: { name: string };
    clock: string;
    /** What the header calls this computer. */
    computer: string;
    /** The backup this start restored, until the owner closes its line. */
    restored: { madeAt: string } | undefined;
    firstRun: boolean;
    leftOpen: boolean;
    /** The window in front, if any. */
    front: Win | undefined;
    deskCount: number;
    onsetup: () => void;
    onhide: () => void;
    ontoggle: (id: Section) => void;
  };

  let {
    open,
    plateName,
    office,
    clock,
    computer,
    restored,
    firstRun,
    leftOpen,
    front,
    deskCount,
    onsetup,
    onhide,
    ontoggle
  }: Props = $props();

  /** The sections the top bar offers: Projects only in Advanced mode. */
  const sections = $derived(SECTIONS.filter((s) => s.id !== 'projects' || advanced.on));
</script>

<div class="flex items-start gap-3 {open ? 'border-b border-hairline p-3' : ''}">
  <div class="min-w-0 flex-1">
    <div class="text-[10px] tracking-[0.22em] text-sea uppercase">Oddboro</div>
    <!-- A long name clips with an ellipsis. The clock keeps its place. -->
    <div class="flex items-baseline gap-2">
      <span
        class="min-w-0 truncate font-pixel text-2xl leading-tight max-sm:text-xl"
        title={plateName}>{plateName}</span
      >
      <span
        class="shrink-0 text-base font-semibold whitespace-nowrap text-ink tabular-nums"
        title={`${office.name} keeps ${zoneName()}`}
        >{clock} <span class="text-xs font-medium text-muted">{zoneShort()}</span></span
      >
    </div>
    <div class="text-xs text-muted max-sm:hidden" class:hidden={firstRun}>
      {computer} ·
      <button class="underline underline-offset-2 hover:text-ink" onclick={onsetup}>Setup</button>
    </div>
    {#if restored && !firstRun}
      <RestoredNote {restored} />
    {/if}
  </div>
  {#if open && !firstRun}
    <button
      class="rounded-full px-2 py-1 text-muted hover:text-ink"
      aria-label="Fold the panel away"
      title="Fold away. Open windows stay open."
      onclick={onhide}>✕</button
    >
  {/if}
</div>
<!-- The command center's buttons arrive with the office, once the first run is over. -->
<div class="flex flex-wrap gap-1.5 {open ? 'px-3 pt-2' : 'mt-2'}" class:hidden={firstRun}>
  {#each sections as sec (sec.id)}
    {@const pressed = leftOpen && front?.kind === sec.id}
    <button
      class="rounded-full px-3 py-1 text-xs whitespace-nowrap {pressed
        ? 'bg-sea/25 text-ink'
        : 'bg-raise text-muted hover:text-ink'}"
      aria-pressed={pressed}
      onclick={() => ontoggle(sec.id)}
      >{sec.label}{#if sec.id === 'desk' && deskCount}<span class="ms-1 text-ember"
          >{deskCount}</span
        >{/if}{#if wins.list.some((w) => w.kind === sec.id && wins.busy[w.id])}<BusySquare
          class="ms-1.5"
        />{/if}</button
    >
  {/each}
  {#if !leftOpen && wins.list.length}
    <button
      class="rounded-full bg-raise px-3 py-1 text-xs whitespace-nowrap text-ink hover:bg-sea/20"
      onclick={() => (wins.shown = true)}
      >{wins.list.length} open{#if Object.values(wins.busy).some(Boolean)}<BusySquare
          class="ms-1.5"
        />{/if}</button
    >
  {/if}
</div>
