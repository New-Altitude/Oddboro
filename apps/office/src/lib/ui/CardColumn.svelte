<script lang="ts" module>
  /** The card loads when it first opens, and once the floor draws (the page's head start). */
  export const loadStaffCard = () => import('#lib/ui/StaffCard.svelte');
</script>

<script lang="ts">
  import { fly } from 'svelte/transition';
  import type { AskRow } from '@oddboro/ledger';
  import type { Activity, StaffProfile } from '../staff/roster.ts';
  import type { PlaceGroup } from '../staff/places.ts';
  import { nowIn, readerProps, type OddNow, type Snapshot } from '../staff/odd-now.ts';
  import type { FloorCrew } from './floor-crew.svelte.ts';
  import { chatAbout, type Delivered } from './chat-about.svelte.ts';
  import OddsRail from './OddsRail.svelte';
  import SidePanel from './SidePanel.svelte';

  // The end side of the screen: the Odds rail, and the picked Odd's card in
  // its own panel.

  type Props = {
    width: number;
    crew: FloorCrew;
    showRail: boolean;
    profile: StaffProfile | undefined;
    rightCollapsed: boolean;
    selected: string | undefined;
    selectedActivity: Activity;
    staff: StaffProfile[];
    version: number;
    places: PlaceGroup[];
    cardShow: { id: string; tab: 'work'; n: number } | undefined;
    findAgent: number;
    railAsked: boolean;
    oddsNow: Record<string, OddNow>;
    snapshot: Snapshot;
    headings: Record<string, string | undefined>;
    oncollapse: () => void;
    onleave: () => void;
    onwiden: (open: boolean) => void;
    onselect: (id: string | undefined) => void;
    onplan: (hires: AskRow[]) => void;
    onitem: (staffId: string, d: Delivered) => boolean;
  };

  let {
    width = $bindable(),
    crew,
    showRail,
    profile,
    rightCollapsed,
    selected,
    selectedActivity,
    staff,
    version,
    places,
    cardShow,
    findAgent,
    railAsked,
    oddsNow,
    snapshot,
    headings,
    oncollapse,
    onleave,
    onwiden,
    onselect,
    onplan,
    onitem
  }: Props = $props();

  /** The Odd's panel slides in from the screen's edge (the left in a right-to-left page). */
  const fromEdge = (far = 48) => ({
    x: (getComputedStyle(document.documentElement).direction === 'rtl' ? -1 : 1) * far,
    duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200
  });
</script>

<!-- The end side: every Odd on the rail, and the picked one's panel beside it.
     Folding the panel (») leaves the rail, where the Odd's avatar opens it again. -->
{#if showRail}
  <!-- Fills the screen so the rail keeps its place while it slides toward the edge. -->
  <div class="pointer-events-none absolute inset-0 z-20" transition:fly={fromEdge(80)}>
    <OddsRail
      {staff}
      nowOf={nowIn(oddsNow)}
      {headings}
      selected={profile && !rightCollapsed ? selected : undefined}
      find={findAgent}
      searching={railAsked}
      {onleave}
      {onselect}
      onchat={(id) => chatAbout(id, '')}
      {onwiden}
    />
  </div>
{/if}
{#if profile && !rightCollapsed}
  <SidePanel
    side="end"
    label="Selected Odd"
    bind:width
    inset={0}
    min={360}
    max={1000}
    storageKey="oddboro.panel.end"
  >
    {#key profile.id}
      <div class="h-full" in:fly={fromEdge()}>
        {#await loadStaffCard() then { default: StaffCard }}
          <StaffCard
            {...readerProps(snapshot, oddsNow, profile.id, onplan)}
            {profile}
            activity={selectedActivity}
            {version}
            show={cardShow?.id === profile.id ? cardShow : undefined}
            {places}
            manual={!!crew.manual[profile.id]}
            sentTo={crew.manual[profile.id]}
            held={crew.held}
            onsend={(place) => crew.send(profile.id, place)}
            onschedule={() => crew.backToSchedule(profile.id)}
            onchatstart={() => crew.chatStart(profile.id)}
            onchatend={() => crew.chatEnd(profile.id)}
            {oncollapse}
            onclose={() => onselect(undefined)}
            onitem={(d) => onitem(profile.id, d)}
          />
        {/await}
      </div>
    {/key}
  </SidePanel>
{/if}
