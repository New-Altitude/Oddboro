<script lang="ts">
  import type { ArtKind, ArtRequest, DrawnArt } from '@oddboro/sprites/art';
  import { LIMITS, type OfficeSpec, type SpriteCatalog, type World } from '@oddboro/world';
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { addArt, type ArtSheet } from '../floor/art.ts';
  import { Floor, sharedAtlas } from '../floor/engine.ts';
  import { call, follow } from './api.ts';
  import { wins } from './windows.svelte.ts';

  // The owner describes the office they want and the office draws it: the
  // spec first, then each piece the library lacks, then a preview to pan
  // around. Redraw with a note until it is right, then move in. The office
  // the owner is in changes the same way: a note redraws it from its spec.
  // Earlier layouts stay, to move back to.
  type Props = { id: string; catalog: SpriteCatalog; staffCount: number; current: string };
  let { id, catalog, staffCount, current }: Props = $props();

  type Drawn = {
    spec: OfficeSpec;
    world: World;
    notes: string[];
    missing: string[];
    seats: number;
    /** Drawn for this office; kept when the owner moves in. */
    art: DrawnArt[];
    artSheet?: ArtSheet;
    artCatalog: SpriteCatalog;
  };
  type Line =
    | { step: 'spec'; name: string; drawing: ArtRequest[] }
    | { step: 'art'; name: string; ok: boolean }
    | { step: 'check' }
    | { step: 'more'; drawing: ArtRequest[] }
    | { step: 'plan'; world: World }
    | ({ step: 'done' } & Drawn)
    | { step: 'moved'; name: string }
    | { step: 'error'; message: string };
  type Piece = { name: string; kind: ArtKind; state: 'drawing' | 'done' | 'failed' };
  type Layout = {
    id: number;
    name: string;
    description: string;
    active: boolean;
    movedInAt: string | null;
  };

  /** The words for a new office. */
  let description = $state('');
  /** The words the drawing came from, then each change asked of it since. */
  let basis = $state('');
  let changes = $state<string[]>([]);
  let note = $state('');
  /** The layout the owner is in, to change with a note. */
  let here = $state<{ spec: OfficeSpec; description: string } | undefined>();
  let drawn = $state<Drawn | undefined>();
  let drawing = $state(false);
  /** While drawing: the office's name once the spec is in, and each piece being drawn. */
  let progress = $state<
    { name: string; pieces: Piece[]; checking?: boolean; more?: boolean } | undefined
  >();
  let moving = $state(false);
  let problem = $state('');
  let layouts = $state<Layout[]>([]);
  let sample = $state<{ name: string; active: boolean } | undefined>();
  let big = $state<HTMLDialogElement>();
  let bigOpen = $state(false);

  const KIND: Record<string, string> = {
    office: 'your office',
    workspace: 'desks',
    lobby: 'lobby',
    kitchen: 'kitchen',
    break: 'break room',
    library: 'library',
    gym: 'gym',
    mail: 'mail room',
    meeting: 'meeting room'
  };

  $effect(() => {
    void call<{
      layouts: Layout[];
      current?: { spec: OfficeSpec; description: string };
      sample: { name: string; active: boolean };
    }>('/api/office/layouts').then((r) => {
      layouts = r.layouts;
      here = r.current;
      sample = r.sample;
    });
  });

  $effect(() => {
    wins.busy[id] = drawing || moving;
    wins.dirty[id] = !!drawn;
    wins.titles[id] = drawn ? `Office: ${drawn.spec.name}` : 'Office';
  });

  /** The preview: the real floor, built from the drawing, at midday. */
  /**
   * The preview: one floor for as long as it shows. A rebuilt drawing swaps
   * into it rather than making a new floor, so nothing flashes and the camera
   * stays where the owner had it.
   */
  const preview =
    (world: () => World, onFloor?: (f: Floor | undefined) => void): Attachment<HTMLDivElement> =>
    (el) => {
      let floor: Floor | undefined;
      let gone = false;
      void sharedAtlas(catalog).then(async (atlas) => {
        if (gone) return;
        floor = await Floor.create(el, untrack(world), atlas, { preview: true });
        if (gone) return floor.destroy();
        floor.setHour(13);
        floors.add(floor);
        onFloor?.(floor);
      });
      return () => {
        gone = true;
        onFloor?.(undefined);
        if (floor) floors.delete(floor);
        floor?.destroy();
      };
    };
  /** The previews showing now, to swap a new drawing into. */
  const floors = new Set<Floor>();
  $effect(() => {
    const w = drawn?.world;
    if (!w) return;
    // A new size (a redraw, not a change by hand) glides out to show all of it.
    untrack(() => {
      for (const f of floors)
        if (f.world !== w)
          f.swap(w, { fit: w.width !== f.world.width || w.height !== f.world.height });
    });
  });

  function openBig() {
    bigOpen = true;
    big?.showModal();
  }

  /** The words to save with the office: where it started, then each change. */
  const words = (from: string, more: string[]) =>
    [from, ...more.map((c) => `Then: ${c}`)].join('\n').slice(0, LIMITS.description);

  /**
   * `new` draws the owner's words from scratch, `again` redraws this drawing
   * with the note, and `change` redraws the office the owner is in with it.
   */
  async function draw(how: 'new' | 'again' | 'change') {
    const from =
      how === 'new'
        ? description.trim()
        : how === 'change'
          ? here?.description || (here?.spec.name ?? '')
          : basis;
    const asked = how === 'again' ? changes : [];
    const ask = note.trim();
    const previous = how === 'again' ? drawn?.spec : how === 'change' ? here?.spec : undefined;
    big?.close();
    problem = '';
    drawing = true;
    progress = undefined;
    try {
      let done: Drawn | undefined;
      // The drawing runs on the server; this follows it until it is done.
      const job = await call<{ id: number }>('/api/office/design', {
        description: words(from, asked),
        ...(previous ? { note: ask, previous, art: how === 'again' ? drawn?.art : [] } : {})
      });
      await follow<Line>(`/api/office/design?id=${job.id}`, (l) => {
        if (l.step === 'spec')
          progress = {
            name: l.name,
            pieces: l.drawing.map((d) => ({ name: d.name, kind: d.kind, state: 'drawing' }))
          };
        else if (l.step === 'art') {
          const p = progress?.pieces.find((x) => x.name === l.name);
          if (p) p.state = l.ok ? 'done' : 'failed';
        } else if (l.step === 'check') {
          if (progress) progress.checking = true;
        } else if (l.step === 'more') {
          // The look-over asked for more pieces: they draw now, after it.
          if (progress) {
            progress.checking = false;
            progress.more = true;
            progress.pieces.push(
              ...l.drawing.map((d) => ({ name: d.name, kind: d.kind, state: 'drawing' as const }))
            );
          }
        } else if (l.step === 'done') done = l;
        else if (l.step === 'error') throw new Error(l.message);
      });
      if (!done) throw new Error('The drawing stopped before it finished. Try again.');
      // The new pieces go in the atlas before the preview asks for them.
      await addArt(await sharedAtlas(catalog), done.artSheet, done.artCatalog);
      drawn = done;
      basis = from;
      changes = previous && ask ? [...asked, ask] : asked;
      note = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      drawing = false;
    }
  }

  async function moveIn() {
    if (!drawn) return;
    problem = '';
    moving = true;
    try {
      await call('/api/office/move-in', {
        spec: drawn.spec,
        description: words(basis, changes),
        art: drawn.art
      });
      location.reload();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      moving = false;
    }
  }

  async function moveBack(l: { id: number | 'sample' }) {
    problem = '';
    moving = true;
    try {
      await call(`/api/office/layouts/${l.id}`, {});
      location.reload();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      moving = false;
    }
  }

  const ART_KIND: Record<ArtKind, string> = {
    prop: 'furniture',
    'wall-prop': 'on the wall',
    'desk-prop': 'on every desk',
    floor: 'floor',
    wall: 'walls'
  };
  const MARK = { drawing: '·', done: '✓', failed: '✗' } as const;
  const TONE = { drawing: 'text-faint', done: 'text-moss', failed: 'text-coral' } as const;
  const spaced = (name: string) => name.replaceAll('-', ' ');
  const field = 'w-full rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint';
</script>

<section class="flex h-full min-h-0 flex-col" aria-label="Design the office">
  <header class="border-b border-hairline p-3">
    <div class="font-pixel text-lg leading-none">Office</div>
    <div class="mt-1 text-xs text-muted">
      Say what you want and the office draws it. Nothing changes until you move in.
    </div>
  </header>

  {#if wins.confirm?.id === id}
    <div class="flex flex-wrap items-center gap-2 border-b border-hairline bg-ember/10 px-3 py-2">
      <span class="flex-1 text-xs text-ink"
        >{drawing ? 'Still drawing the office.' : 'You have not moved into this drawing.'} Close anyway?</span
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
    {#if !drawn}
      {#if here}
        <div class="flex flex-col gap-1">
          <span class="text-xs text-muted">What should change in {current}?</span>
          <div class="flex gap-2">
            <input
              class={field}
              placeholder="e.g. a bigger kitchen, a reading loft off the lounge"
              bind:value={note}
              disabled={drawing || moving}
              onkeydown={(e) => e.key === 'Enter' && note.trim() && !drawing && draw('change')}
            />
            <button
              class="shrink-0 rounded-lg bg-sea px-3 py-2 text-xs font-medium text-night disabled:opacity-40"
              disabled={!note.trim() || drawing || moving}
              onclick={() => draw('change')}>Change it</button
            >
          </div>
          <details class="text-xs text-muted">
            <summary class="cursor-pointer hover:text-ink">The words {current} came from</summary>
            <p class="mt-1 whitespace-pre-line">{here.description}</p>
          </details>
        </div>
      {/if}
      <label class="flex flex-col gap-1">
        <span class="text-xs text-muted"
          >{here
            ? 'Or describe a new office from scratch'
            : `What should ${current} look like?`}</span
        >
        <textarea
          rows="5"
          class={field}
          maxlength={LIMITS.description}
          placeholder="e.g. A warm old library feel: wood floors, lots of plants, a reading room with a fireplace, a big kitchen where everyone eats together, a small gym, and desks for about ten."
          bind:value={description}
          disabled={drawing || moving}></textarea>
      </label>
      <button
        class="rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-40 {here
          ? 'bg-raise hover:bg-sea/20'
          : 'bg-sea text-night'}"
        disabled={!description.trim() || drawing || moving}
        onclick={() => draw('new')}>{drawing ? 'Drawing the office' : 'Draw it'}</button
      >
    {/if}
    {#if drawing}
      <div class="flex flex-col gap-1 text-xs text-muted">
        <p class="flex items-center gap-2">
          <span class="busy"></span>{progress?.checking
            ? `Looking over ${progress.name}, inside and out, the way someone walking in would.`
            : progress?.more
              ? `Drawing what the look-over asked for, to finish the look.`
              : progress
                ? `Drawing ${progress.name}.`
                : 'Planning the office. This takes about a minute.'}
        </p>
        {#if progress?.pieces.length}
          <p>
            It needs {progress.pieces.length === 1 ? 'a piece' : `${progress.pieces.length} pieces`}
            the office has no art for, so it is drawing {progress.pieces.length === 1
              ? 'it'
              : 'them'} now. A minute or two.
          </p>
          <ul class="flex flex-col gap-1">
            {#each progress.pieces as p (p.name)}
              <li class="flex gap-2 rounded-lg bg-raise px-2.5 py-1.5">
                <span class="w-3 {TONE[p.state]}" aria-label={p.state}>{MARK[p.state]}</span>
                <span class="min-w-0 flex-1 truncate text-ink">{spaced(p.name)}</span>
                <span class="text-faint">{ART_KIND[p.kind]}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}
    {#if problem}
      <p class="rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
    {/if}

    {#if drawn}
      <div>
        <div class="flex items-baseline gap-2">
          <span class="font-pixel text-base">{drawn.spec.name}</span>
          <span class="min-w-0 flex-1 text-xs text-muted"
            >{drawn.spec.rooms.length} rooms · {drawn.seats} work seats for {staffCount} staff</span
          >
          <button class="shrink-0 text-xs text-sea underline underline-offset-2" onclick={openBig}
            >View larger</button
          >
        </div>
        <div
          {@attach preview(() => drawn!.world)}
          class="mt-2 h-96 overflow-hidden rounded-xl bg-night"
          aria-label="A preview of the office. Drag to look around; scroll to zoom."
        ></div>
      </div>
      <ul class="flex flex-col gap-1 text-xs">
        {#each drawn.spec.rooms as r, i (i)}
          <li class="flex gap-2 rounded-lg bg-raise px-2.5 py-1.5">
            <span class="min-w-0 flex-1 truncate text-ink">{r.name}</span>
            <span class="text-faint"
              >{r.kind === 'workspace' ? `${r.seats} desks` : KIND[r.kind]}{r.size
                ? ` · ${r.size}`
                : ''}</span
            >
          </li>
        {/each}
      </ul>
      {#each drawn.notes as n (n)}
        <p class="text-xs text-muted">{n}</p>
      {/each}
      {#if drawn.art.length}
        <p class="text-xs text-muted">
          Drawn for this office: {drawn.art.map((a) => spaced(a.name)).join(', ')}. They join the
          library when you move in.
        </p>
      {/if}
      {#if drawn.missing.length}
        <p class="text-xs text-muted">
          What a floor seen from above cannot show: {drawn.missing.join('; ')}.
        </p>
      {/if}
      <div class="flex gap-2">
        <input
          class={field}
          placeholder="What to change, e.g. a bigger gym, no break room"
          bind:value={note}
          disabled={drawing || moving}
          onkeydown={(e) => e.key === 'Enter' && !drawing && draw('again')}
        />
        <button
          class="shrink-0 rounded-lg bg-raise px-3 py-2 text-xs font-medium hover:bg-sea/20 disabled:opacity-40"
          disabled={drawing || moving}
          onclick={() => draw('again')}>Redraw</button
        >
      </div>
      <button
        class="rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
        disabled={drawing || moving}
        onclick={moveIn}>{moving ? 'Moving in' : `Move into ${drawn.spec.name}`}</button
      >
      <p class="text-[11px] text-faint">
        Odds whose room is gone move to the workspace with the most free desks. Your old layout
        stays below, to move back to.
        <button
          class="text-muted underline underline-offset-2 hover:text-ink disabled:opacity-40"
          disabled={drawing || moving}
          onclick={() => {
            drawn = undefined;
          }}>Start over</button
        >
      </p>

      <dialog
        bind:this={big}
        class="m-auto h-[calc(100dvh-2rem)] max-h-none w-[calc(100vw-2rem)] max-w-none flex-col overflow-hidden rounded-2xl bg-panel-solid p-0 text-ink backdrop:bg-night/70 open:flex"
        aria-label={`${drawn.spec.name}, larger`}
        onclose={() => (bigOpen = false)}
      >
        <div class="flex items-baseline gap-2 border-b border-hairline px-4 py-3">
          <span class="font-pixel text-lg">{drawn.spec.name}</span>
          <span class="min-w-0 flex-1 text-xs text-muted"
            >{drawn.spec.rooms.map((r) => r.name).join(' · ')}</span
          >
          <button
            class="shrink-0 rounded-lg bg-sea px-2.5 py-1 text-xs font-medium text-night disabled:opacity-40"
            disabled={moving}
            onclick={moveIn}>{moving ? 'Saving' : 'Save to the office'}</button
          >
          <button
            class="shrink-0 rounded-lg bg-raise px-2.5 py-1 text-xs hover:bg-sea/20"
            onclick={() => big?.close()}>Close</button
          >
        </div>
        <div class="flex min-h-0 flex-1">
          {#if bigOpen}
            <div class="relative min-h-0 min-w-0 flex-1">
              <div
                {@attach preview(() => drawn!.world)}
                class="absolute inset-0 overflow-hidden bg-night"
                role="application"
                aria-label="The office, larger. Drag to look around; scroll to zoom."
              ></div>
            </div>
          {/if}
        </div>
        <div class="flex gap-2 border-t border-hairline p-3">
          <input
            class={field}
            placeholder="What to change, e.g. a bigger gym, no break room"
            bind:value={note}
            disabled={drawing || moving}
            onkeydown={(e) => e.key === 'Enter' && !drawing && draw('again')}
          />
          <button
            class="shrink-0 rounded-lg bg-sea px-3 py-2 text-xs font-medium text-night disabled:opacity-40"
            disabled={drawing || moving}
            onclick={() => draw('again')}>Redraw</button
          >
        </div>
      </dialog>
    {/if}

    {#if layouts.length || sample}
      <div class="mt-2 flex flex-col gap-1">
        <div class="text-xs text-muted">Your layouts</div>
        {#each layouts as l (l.id)}
          <div class="flex items-center gap-2 rounded-lg bg-raise px-2.5 py-1.5 text-xs">
            <span class="min-w-0 flex-1 truncate text-ink" title={l.description}>{l.name}</span>
            {#if l.active}
              <span class="text-faint">You are here</span>
            {:else}
              <button
                class="text-sea underline underline-offset-2 disabled:opacity-40"
                disabled={drawing || moving}
                onclick={() => moveBack(l)}>Move back</button
              >
            {/if}
          </div>
        {/each}
        {#if sample}
          <div class="flex items-center gap-2 rounded-lg bg-raise px-2.5 py-1.5 text-xs">
            <span class="min-w-0 flex-1 truncate text-ink">{sample.name}, the sample office</span>
            {#if sample.active}
              <span class="text-faint">You are here</span>
            {:else}
              <button
                class="text-sea underline underline-offset-2 disabled:opacity-40"
                disabled={drawing || moving}
                onclick={() => moveBack({ id: 'sample' })}>Move back</button
              >
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .busy {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 9999px;
    background: var(--color-ember);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .busy {
      animation: none;
    }
  }
</style>
