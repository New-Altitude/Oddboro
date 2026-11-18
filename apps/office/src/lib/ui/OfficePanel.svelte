<script lang="ts" module>
  /** The Desk loads when it first opens, and once the floor draws (the page's head start). */
  export const loadDeskDrawer = () => import('#lib/ui/DeskDrawer.svelte');
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { AskRow, Desk, GoalThread } from '@oddboro/ledger';
  import type { SpriteCatalog } from '@oddboro/world';
  import type { StaffProfile } from '../staff/roster.ts';
  import type { FloorCrew } from './floor-crew.svelte.ts';
  import BusySquare from './BusySquare.svelte';
  import FloorControls, { type Light } from './FloorControls.svelte';
  import SidePanel from './SidePanel.svelte';
  import { close, open, openHire, wins, type Win } from './windows.svelte.ts';

  // The start panel once the office is open: the plate, a tab for each open
  // window, every window's body, and the floor's controls at its foot.

  type Props = {
    width: number;
    light: Light;
    crew: FloorCrew;
    /** The office plate, drawn open at the top. */
    plate: Snippet<[boolean]>;
    innerWidth: number;
    /** The panel's narrowest width, which drops at phone width while Projects is in front. */
    min: number;
    /** Projects in front stretches the panel, keeping this many px free at the end edge. */
    reach: number | undefined;
    /** Focus in the front Projects window gives its terminal the panel's height. */
    focusFolds: boolean;
    desk: Desk;
    deskCount: number;
    deskFocus: string | undefined;
    staff: StaffProfile[];
    version: number;
    ledgerVersion: number;
    notify: boolean;
    office: { name: string; catalog: SpriteCatalog };
    hireRooms: { id: string; name: string }[];
    onhire: (a: AskRow) => void;
    onplan: (hires: AskRow[]) => void;
    onselect: (id: string) => void;
    onthread: (t: GoalThread) => void;
    onnotify: (on: boolean) => void;
    onrefresh: () => void;
  };

  let {
    width = $bindable(),
    light = $bindable(),
    crew,
    plate,
    innerWidth,
    min,
    reach,
    focusFolds,
    desk,
    deskCount,
    deskFocus,
    staff,
    version,
    ledgerVersion,
    notify,
    office,
    hireRooms,
    onhire,
    onplan,
    onselect,
    onthread,
    onnotify,
    onrefresh
  }: Props = $props();

  function winTitle(w: Win): string {
    if (w.kind === 'desk') return 'Desk';
    if (w.kind === 'ledger') return 'Ledger';
    if (w.kind === 'projects') return 'Projects';
    if (w.kind === 'services') return 'Services';
    if (w.kind === 'goals') return 'Goals';
    if (w.kind === 'lessons') return 'Lessons';
    if (w.kind === 'office') return wins.titles[w.id] ?? 'Office';
    if (w.kind === 'setup') return crew.welcomed ? 'Setup' : 'Welcome';
    if (w.kind === 'file') return w.file.path.split('/').pop() ?? w.file.path;
    if (w.kind === 'report') return w.report.title;
    return wins.titles[w.id] ?? (w.from ? `Hire ${w.from.proposal.name}` : 'New hire');
  }
</script>

<SidePanel
  side="start"
  label="Office panel"
  bind:width
  {min}
  max={Math.max(760, Math.round(innerWidth * 0.4))}
  storageKey="oddboro.panel.start"
  onTop={wins.raised}
  {reach}
>
  <div class="flex h-full min-h-0 flex-col">
    <!-- Under Focus the plate and the music bar hide but stay mounted, so the
         music, the theme and the restored note keep their state. -->
    <div class="pb-2" class:hidden={focusFolds}>{@render plate(true)}</div>
    <!-- One tab per open window. Every window stays mounted, so each keeps its place.
         The row leaves under Focus: it carries `flex`, and `hidden` beside it
         would win only by the stylesheet's order. -->
    {#if !focusFolds}
      <div
        class="flex gap-1 overflow-x-auto border-t border-hairline px-2 pt-2"
        role="tablist"
        aria-label="Open windows"
      >
        {#each wins.list as w (w.id)}
          <div
            class="flex shrink-0 items-center rounded-t-lg {wins.active === w.id
              ? 'bg-raise text-ink'
              : 'text-muted hover:text-ink'}"
          >
            <button
              role="tab"
              aria-selected={wins.active === w.id}
              class="flex max-w-44 items-center gap-1.5 truncate py-1.5 ps-2.5 pe-1 text-xs"
              onclick={() => {
                wins.active = w.id;
                wins.raised = true;
              }}
              >{#if wins.busy[w.id]}<BusySquare />{/if}{winTitle(
                w
              )}{#if w.kind === 'desk' && deskCount}<span class="text-ember">{deskCount}</span
                >{/if}{#if wins.dirty[w.id]}<span class="text-ember" aria-label="unsaved">•</span
                >{/if}</button
            >
            <button
              class="px-1.5 py-1.5 text-[10px] text-faint hover:text-coral"
              aria-label={`Close ${winTitle(w)}`}
              onclick={() => close(w.id)}>✕</button
            >
          </div>
        {/each}
      </div>
    {/if}
    <div class="min-h-0 flex-1 border-t border-hairline">
      {#each wins.list as w (w.id)}
        <div class="h-full min-h-0" class:hidden={wins.active !== w.id} role="tabpanel">
          <!-- Each window's code loads when it first opens. -->
          {#if w.kind === 'desk'}
            {#await loadDeskDrawer() then { default: DeskDrawer }}
              <DeskDrawer {desk} {staff} focus={deskFocus} {onhire} {onplan} onstaff={onselect} />
            {/await}
          {:else if w.kind === 'goals'}
            {#await import('#lib/ui/GoalsPanel.svelte') then { default: GoalsPanel }}
              <GoalsPanel {staff} {version} {onthread} />
            {/await}
          {:else if w.kind === 'lessons'}
            {#await import('#lib/ui/LessonsLibrary.svelte') then { default: LessonsLibrary }}
              <LessonsLibrary {staff} {version} bind:filter={w.filter} />
            {/await}
          {:else if w.kind === 'ledger'}
            {#await import('#lib/ui/LedgerPanel.svelte') then { default: LedgerPanel }}
              <LedgerPanel {staff} version={ledgerVersion} />
            {/await}
          {:else if w.kind === 'projects'}
            {#await import('#lib/ui/ProjectSessions.svelte') then { default: ProjectSessions }}
              <ProjectSessions {staff} {version} ask={w.ask} />
            {/await}
          {:else if w.kind === 'services'}
            {#await import('#lib/ui/ServicesPanel.svelte') then { default: ServicesPanel }}
              <ServicesPanel {staff} {version} onstaff={onselect} />
            {/await}
          {:else if w.kind === 'setup'}
            {#await import('#lib/ui/Welcome.svelte') then { default: Welcome }}
              <Welcome
                office={office.name}
                welcomed={crew.welcomed}
                ondesign={() => open({ id: 'office', kind: 'office' })}
                onhire={() => openHire()}
                onmeet={(id) => onselect(id)}
                ondone={() => {
                  crew.welcomed = true;
                  close(w.id, true);
                }}
                {notify}
                {onnotify}
              />
            {/await}
          {:else if w.kind === 'office'}
            <!-- Loaded when opened: it draws with PixiJS, which the first page leaves out. -->
            {#await import('#lib/ui/OfficeDesigner.svelte') then { default: OfficeDesigner }}
              <OfficeDesigner
                id={w.id}
                catalog={office.catalog}
                staffCount={staff.length}
                current={office.name}
              />
            {/await}
          {:else if w.kind === 'hire'}
            {#await import('#lib/ui/HireDrawer.svelte') then { default: HireDrawer }}
              <HireDrawer
                id={w.id}
                rooms={hireRooms}
                from={w.from}
                onhired={(p) => {
                  close(w.id, true);
                  onrefresh();
                  onselect(p.id);
                }}
                ondone={() => {
                  close(w.id, true);
                  onrefresh();
                }}
              />
            {/await}
          {:else if w.kind === 'report'}
            {#await import('#lib/ui/ReportView.svelte') then { default: ReportView }}
              <ReportView report={w.report} {staff} />
            {/await}
          {:else}
            {#await import('#lib/ui/FileViewer.svelte') then { default: FileViewer }}
              <FileViewer
                id={w.id}
                file={w.file}
                nameOf={(id) => staff.find((p) => p.id === id)?.name ?? id}
              />
            {/await}
          {/if}
        </div>
      {/each}
    </div>
    <!-- The music keeps its place and size while Projects widens the panel. -->
    <div class="border-t border-hairline px-3 py-2" class:hidden={focusFolds}>
      <div style="max-inline-size: {width - 24}px">
        <FloorControls
          bind:light
          onfit={() => crew.fitFloor()}
          onzoom={(d) => crew.floor?.zoomBy(d)}
        />
      </div>
    </div>
  </div>
</SidePanel>
