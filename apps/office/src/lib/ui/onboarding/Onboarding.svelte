<script module lang="ts">
  import type { SpriteCatalog, World } from '@oddboro/world';
  import type { ArtSheet } from '../../floor/art.ts';
  import type { Beat } from '../../floor/reveal.ts';

  /** What the first run asks of the page's floor. */
  export type Stage = {
    bus():
      { arrive(): Promise<void>; open(): void; leave(): Promise<void>; gone(): void } | undefined;
    /**
     * Put the drawn art in the atlas, swap to the office with every part hidden,
     * and raise it beat by beat. Then it takes its name.
     */
    build(
      world: World,
      name: string,
      onBeat: (b: Beat) => void,
      art?: { sheet?: ArtSheet; catalog?: SpriteCatalog }
    ): Promise<void>;
    /** Bring a new hire from the bus stop to the owner's desk. `skip` puts them there at once. */
    walkIn(id: string, skip: Promise<void>): Promise<void>;
    /** Load the office as the server now has it, once the drawing has landed or stopped. */
    reload(): Promise<void>;
    zone(z: string): void;
    name(n: string): void;
    finish(id: string): void;
  };
</script>

<script lang="ts">
  import { setZone } from '@oddboro/ledger/time';
  import type { StaffProfile } from '../../staff/roster.ts';
  import { AgentTools } from '../agent-tools.svelte.ts';
  import { call, follow } from '../api.ts';
  import AiCard from './AiCard.svelte';
  import MacCard, { type Setup } from './MacCard.svelte';
  import ManagerCard, { type Custom, type Preset } from './ManagerCard.svelte';
  import type { Built } from '../OddParts.svelte';
  import SpaceCard from './SpaceCard.svelte';
  import { STEPS, TITLE, type Step } from './steps.ts';
  import { selectOnFocus } from '../select-on-focus.ts';

  // A new owner's first visit, over the live floor: six cards, the same on a
  // Mac, Linux and Windows (hard rule 14), then the office going up on their
  // lot and their manager arriving by bus. The slow parts
  // start the moment their inputs exist: the office draws from when the owner
  // leaves "Your space", and a described manager from when they leave theirs.
  // So Open the office starts the show at once instead of a wait.
  type Props = { stage: Stage; sample?: World };
  let { stage, sample }: Props = $props();

  let step = $state<Step>('mac');
  let backward = $state(false);

  // The coding tools, read from the first card on, so Your AI shows at once.
  const agentTools = new AgentTools();

  function go(to: Step) {
    backward = STEPS.indexOf(to) < STEPS.indexOf(step);
    step = to;
  }
  const next = () => go(STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(step) + 1)]);
  const back = () => go(STEPS[Math.max(0, STEPS.indexOf(step) - 1)]);

  // You
  // The Mac's name waits in the field as a suggestion. The lot reads "Your Lot"
  // until the owner types a name or takes the suggestion.
  let name = $state('');
  function onsetup(s: Setup) {
    if (!name) name = s.owner || s.suggested;
  }

  // Your office manager
  let presets = $state<Preset[]>([]);
  let pick = $state('marshall');
  /** Claude's Sonnet cannot design an office, so that card offers only what is ready. */
  let canDraw = $state(true);
  /** Only some tools and models draw a look (`drawsLooks`); on the rest a manager of your own is built from parts. */
  let canDrawLooks = $state(true);
  function ondraw(can: boolean, looks: boolean) {
    canDraw = can;
    canDrawLooks = looks;
    if (!looks && pick === 'custom') pick = 'built';
    if (canDraw) return;
    if (!design) {
      mainStreet = true;
      description = '';
    }
  }
  let custom = $state<Custom>({ name: '', description: '' });
  /** The manager built from parts, when the owner builds one. */
  let builtManager = $state<Built | undefined>();
  type Drawn = { look: unknown; portraitPx: string; newParts: unknown[] };
  let look = $state<{
    for: string;
    drawing: boolean;
    drawn?: Drawn;
    portrait?: string;
    problem?: string;
  }>();
  let drawingLook: Promise<void> | undefined;
  $effect(() => {
    void call<Preset[]>('/api/onboarding').then((p) => (presets = p));
  });

  function drawManager() {
    if (pick !== 'custom') return;
    const key = `${custom.name.trim()}|${custom.description.trim()}`;
    if (look?.for === key && !look.problem) return;
    look = { for: key, drawing: true };
    drawingLook = call<Drawn & { portrait: string }>('/api/looks', {
      description: custom.description.trim() || custom.name.trim(),
      name: custom.name.trim(),
      role: 'Office Manager'
    }).then(
      (p) => {
        if (look?.for !== key) return;
        look = {
          for: key,
          drawing: false,
          drawn: { look: p.look, portraitPx: p.portraitPx, newParts: p.newParts },
          portrait: p.portrait
        };
      },
      (e) => {
        if (look?.for === key)
          look = { for: key, drawing: false, problem: e instanceof Error ? e.message : String(e) };
      }
    );
  }

  // Your space, and the drawing it starts
  let description = $state('');
  /** Main Street is the default; describing an office, or picking a chip, turns it off. */
  let mainStreet = $state(true);
  let strip = $state('');
  let stripDone = $state(false);
  type Line =
    | { step: 'spec'; name: string; drawing: { name: string }[] }
    | { step: 'plan'; world: World }
    | { step: 'art'; name: string; ok: boolean }
    | { step: 'check' }
    | { step: 'more'; drawing: { name: string }[] }
    | {
        step: 'done';
        world: World;
        spec: { name: string };
        artSheet?: ArtSheet;
        artCatalog?: SpriteCatalog;
      }
    | { step: 'moved'; name: string }
    | { step: 'error'; message: string };
  const later = <T,>() => {
    let resolve!: (v: T) => void;
    return { promise: new Promise<T>((r) => (resolve = r)), resolve };
  };
  const finished = later<World | null>();
  /** Whether the office moved into the drawing. */
  const moved = later<boolean>();
  let drawnArt: { sheet?: ArtSheet; catalog?: SpriteCatalog } | undefined;
  /** The pieces the design is drawing, for the card the reveal waits behind. */
  let pieces = $state({ done: 0, total: 0 });
  let design = $state<{ name?: string; failed?: boolean; ended?: boolean } | undefined>();

  const rooms = (w: World) => w.rooms.filter((r) => !r.outdoor && r.sign !== false).length;
  const piece = (n: string) => `the ${n.replaceAll('-', ' ')}`;

  function onLine(l: Line) {
    if (!design) return;
    if (l.step === 'spec') {
      design.name = l.name;
      strip = l.drawing.length
        ? `Planned ${l.name}. Drawing ${l.drawing.length} new ${l.drawing.length === 1 ? 'piece' : 'pieces'}.`
        : `Planned ${l.name}.`;
      pieces = { done: 0, total: l.drawing.length };
    } else if (l.step === 'art') {
      pieces.done++;
      strip = l.ok
        ? `Drew ${piece(l.name)}.`
        : `${piece(l.name)} did not come out, so the office leaves it out.`;
    } else if (l.step === 'check') strip = `Looking ${design.name ?? 'it'} over.`;
    else if (l.step === 'more') {
      pieces.total += l.drawing.length;
      strip = `Drawing ${l.drawing.length} more.`;
    } else if (l.step === 'done') {
      design.ended = true;
      design.name = l.spec.name;
      drawnArt = { sheet: l.artSheet, catalog: l.artCatalog };
      finished.resolve(l.world);
      strip = `${l.spec.name} is ready.`;
      stripDone = true;
    } else if (l.step === 'moved') moved.resolve(true);
    else if (l.step === 'error') {
      design.ended = true;
      design.failed = true;
      finished.resolve(null);
      moved.resolve(false);
      strip = 'The design did not come out. You will start on Main Street.';
    }
  }

  async function startDesign() {
    if (design || mainStreet) return;
    design = {};
    strip = 'Planning the office.';
    let url = '/api/office/design';
    try {
      const job = await call<{ id: number }>('/api/office/design', { description });
      url += `?id=${job.id}`;
    } catch {
      // Already drawing one, from before a reload: follow that.
    }
    await follow<Line>(url, onLine).catch((e) =>
      onLine({ step: 'error', message: e instanceof Error ? e.message : String(e) })
    );
    // The server stopped before it finished.
    if (!design.ended) onLine({ step: 'error', message: 'The drawing stopped.' });
  }

  // Open the office
  let zone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone);
  let zoneOpen = $state(false);
  let zoneFind = $state('');
  const ZONES = Intl.supportedValuesOf('timeZone');
  const zoneLabel = (z: string) => {
    try {
      const n = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'long' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value;
      return (n ?? z).replace(/ (Standard|Daylight|Summer) Time$/, ' Time');
    } catch {
      return z;
    }
  };
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let going = $state(false);
  let problem = $state('');
  let caption = $state('');
  let revealing = $state(false);
  /** The office is still drawing: the reveal waits behind a card until it is. */
  let laying = $state(false);
  /** The manager is on the way, and Skip puts them at the owner's desk at once. */
  let arriving = $state(false);
  let skipped = $state(false);
  const skip = later<void>();
  const until = (p: Promise<unknown> | undefined) => Promise.race([p, skip.promise]);
  function skipArrival() {
    skipped = true;
    skip.resolve();
  }

  const managerName = $derived(
    pick === 'custom' || pick === 'built'
      ? custom.name.trim()
      : (presets.find((p) => p.id === pick)?.name ?? '')
  );

  const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

  async function open() {
    problem = '';
    going = true;
    const who = managerName;
    const custom_ = pick === 'custom';
    // The hire waits for a described manager's look. The show does not.
    const hire = (async () => {
      let manager: Record<string, unknown>;
      if (custom_) {
        await drawingLook;
        if (!look?.drawn)
          throw new Error(
            `${who}'s look did not come out${look?.problem ? `: ${look.problem}` : ''}. Pick a ready-made manager, or describe them again.`
          );
        manager = {
          name: custom.name.trim(),
          description: custom.description.trim(),
          drawn: look.drawn
        };
      } else if (pick === 'built' && builtManager)
        manager = {
          name: custom.name.trim(),
          description: '',
          drawn: {
            look: builtManager.look,
            portraitPx: builtManager.portraitPx,
            newParts: []
          }
        };
      else manager = { preset: pick };
      const r = await call<{ manager: StaffProfile }>('/api/onboarding', {
        name: name.trim(),
        zone,
        manager
      });
      setZone(zone);
      stage.zone(zone);
      return r.manager;
    })();
    // A ready-made manager hires in a moment, so a problem shows on this card.
    if (!custom_)
      try {
        await hire;
      } catch (e) {
        problem = message(e);
        going = false;
        return;
      }
    void reveal(hire, who);
  }

  const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const BEAT = {
    chalk: 'Marking out the rooms.',
    floors: 'Laying the floors.',
    walls: 'Raising the walls.',
    furniture: 'Moving the furniture in.',
    done: ''
  } as const;

  // Kept between tries, so a manager picked again after a failed look walks
  // into the office already standing.
  let built: World | null | undefined;
  /** A described manager still drawing: their card stays up while the office goes up. */
  let waitingFor = $state('');

  async function reveal(hire: Promise<StaffProfile>, who: string) {
    revealing = true;
    // A ready-made manager is ready at once; a described one keeps a card up until drawn.
    const ready = await Promise.race([hire.then(() => true), wait(300).then(() => false)]).catch(
      () => false
    );
    if (!ready) waitingFor = who;
    if (built === undefined) {
      caption = `Opening ${name.trim()}'s office.`;
      if (mainStreet || !design) {
        finished.resolve(null);
        moved.resolve(false);
      }
      // Nothing goes up until every drawn piece is in, so the office rises
      // the way it will look.
      laying = !!design && !design.ended;
      let plan = await finished.promise;
      laying = false;
      let officeName = mainStreet || !design?.name ? 'Main Street' : design.name;
      if (!plan && (mainStreet || !design)) plan = sample ?? null;
      else if (!plan) {
        plan = sample ?? null;
        officeName = 'Main Street';
        caption =
          'The design did not come out. You are on Main Street for now. Open the Office window to try again.';
        await wait(3000);
      }
      if (plan) {
        caption = `${officeName}. ${rooms(plan)} rooms.`;
        await wait(1200);
        await stage.build(plan, officeName, (b) => (caption = BEAT[b] || caption), drawnArt);
        caption = `Welcome to ${officeName}.`;
        await wait(1200);
      }
      built = plan;
    }
    let manager: StaffProfile;
    try {
      manager = await hire;
    } catch (e) {
      // Back to the cards over the office, to pick again.
      caption = '';
      waitingFor = '';
      problem = message(e);
      going = false;
      revealing = false;
      go('manager');
      return;
    }
    // The manager is ready: the bus brings them, unless the owner skips it.
    waitingFor = '';
    arriving = true;
    const ride = stage.bus();
    void skip.promise.then(() => ride?.gone());
    caption = `${manager.name} is on the way.`;
    await until(ride?.arrive());
    if (!skipped) {
      ride?.open();
      caption = `${manager.name} is here.`;
      await until(wait(800));
    }
    if (!skipped) caption = `${manager.name} is on the way to your office.`;
    const leaving = until(wait(2500)).then(() => (skipped ? undefined : ride?.leave()));
    await stage.walkIn(manager.id, skip.promise);
    await leaving;
    arriving = false;
    caption = '';
    // Once the office has moved in, the page takes its name and id from the server.
    void moved.promise.then(() => stage.reload());
    stage.finish(manager.id);
  }
</script>

<div class="onboarding flex min-h-0 flex-1 flex-col overflow-y-auto">
  {#if !revealing}
    <section aria-label="Welcome to Oddboro">
      {#if strip}
        <div class="strip" class:done={stripDone} role="status">
          <i aria-hidden="true"></i><span>{strip}</span>
        </div>
      {/if}
      {#key step}
        <div class="card p-4" class:backward>
          <div class="mb-1 font-pixel text-xs tracking-[0.14em] text-sea uppercase">
            {TITLE[step]}
          </div>
          {#if problem && (step === 'go' || step === 'manager')}
            <p class="mb-3 rounded-lg bg-coral/15 px-3 py-2 text-sm text-coral" role="alert">
              {problem}
            </p>
          {/if}
          {#if step === 'mac'}
            <MacCard onnext={next} {onsetup} />
          {:else if step === 'you'}
            <form
              novalidate
              onsubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                stage.name(name);
                next();
              }}
            >
              <label class="text-lg font-semibold" for="onboarding-name"
                >What should your Odds call you?</label
              >
              <input
                id="onboarding-name"
                class="field mt-3 w-full"
                placeholder="Your first name"
                maxlength="30"
                autocomplete="given-name"
                bind:value={name}
                oninput={() => stage.name(name)}
                {@attach selectOnFocus}
                {@attach (n) => n.focus()}
              />
              <div class="mt-4 flex items-center gap-3">
                <button type="button" class="btn ghost" onclick={back}>Back</button>
                <span class="flex-1"></span>
                <button class="btn primary" disabled={!name.trim()}>That's me</button>
              </div>
            </form>
          {:else if step === 'ai'}
            <AiCard tools={agentTools} onnext={next} onback={back} {ondraw} />
          {:else if step === 'manager'}
            <ManagerCard
              {presets}
              bind:pick
              bind:custom
              bind:built={builtManager}
              canDraw={canDrawLooks}
              drawn={look?.portrait}
              drawing={!!look?.drawing && pick === 'custom'}
              onback={back}
              onnext={() => {
                drawManager();
                next();
              }}
            />
          {:else if step === 'space'}
            <SpaceCard
              bind:description
              bind:mainStreet
              drawing={!!design}
              {canDraw}
              onback={back}
              onnext={() => {
                void startDesign();
                next();
              }}
            />
          {:else}
            <dl class="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt class="text-muted">You</dt>
              <dd>{name.trim()}</dd>
              <dt class="text-muted">Manager</dt>
              <dd>
                {managerName}, Office Manager{pick === 'custom' && look?.drawing
                  ? ' (still drawing)'
                  : ''}
              </dd>
              <dt class="text-muted">Office</dt>
              <dd>
                {mainStreet
                  ? 'Main Street, as it is'
                  : design?.failed
                    ? 'Main Street for now. The design did not come out.'
                    : (design?.name ?? 'Being planned')}
              </dd>
              <dt class="text-muted">Clock</dt>
              <dd>
                {zoneLabel(zone)}{zone === here ? ", your computer's" : ''}.
                <button class="link" onclick={() => (zoneOpen = !zoneOpen)}>Change</button>
              </dd>
            </dl>
            {#if zoneOpen}
              <div class="mt-3 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                <label class="sr-only" for="onboarding-zone-find">Find a time zone</label>
                <input
                  id="onboarding-zone-find"
                  class="field"
                  placeholder="Find a city"
                  autocomplete="off"
                  bind:value={zoneFind}
                />
                <label class="sr-only" for="onboarding-zone">Time zone</label>
                <select id="onboarding-zone" class="field" size="4" bind:value={zone}>
                  {#each ZONES.filter((z) => z
                      .toLowerCase()
                      .includes(zoneFind.trim().toLowerCase().replaceAll(' ', '_'))) as z (z)}
                    <option value={z}>{z.replaceAll('_', ' ')}</option>
                  {/each}
                </select>
              </div>
            {/if}
            <div class="mt-4 flex flex-wrap items-center gap-3">
              <button class="btn ghost" onclick={back}>Back</button>
              <span class="flex-1"></span>
              <button class="btn primary big" disabled={going} onclick={open}
                >{going ? 'Opening' : 'Open the office'}</button
              >
            </div>
          {/if}
        </div>
      {/key}
    </section>
  {:else}
    <section class="p-4" role="status" aria-label="Opening the office">
      <div class="mb-1 font-pixel text-xs tracking-[0.14em] text-sea uppercase">
        Opening the office
      </div>
      {#key caption}
        <p class="caption text-lg font-semibold">{caption}</p>
      {/key}
      {#if arriving && !skipped}
        <button class="btn mt-3" onclick={skipArrival}>Skip</button>
      {/if}
      {#if laying}
        <div class="mt-4 flex items-center gap-4 rounded-xl bg-raise p-3">
          <div class="tiles grid size-14 shrink-0 grid-cols-3 gap-0.5 rounded-lg bg-night/40 p-2">
            {#each { length: 9 }, i (i)}
              <span
                class="rounded-[2px] bg-sea"
                style="animation-delay: {(i % 3) * 120 + Math.floor(i / 3) * 360}ms"
              ></span>
            {/each}
          </div>
          <div class="min-w-0 flex-1">
            <p class="font-semibold">Building the layout for {design?.name ?? 'your office'}.</p>
            <p class="mt-1 text-sm text-muted">
              {strip || 'Planning the rooms.'} It goes up once every piece is drawn.
            </p>
            {#if pieces.total}
              <div
                class="mt-2 h-1 overflow-hidden rounded-full bg-night/40"
                role="progressbar"
                aria-label="Pieces drawn"
                aria-valuemin={0}
                aria-valuemax={pieces.total}
                aria-valuenow={Math.min(pieces.done, pieces.total)}
              >
                <div
                  class="bar h-full origin-left bg-sea"
                  style="transform: scaleX({Math.min(1, pieces.done / pieces.total)})"
                ></div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
      {#if waitingFor}
        <div class="mt-4 flex items-center gap-4 rounded-xl bg-raise p-3">
          <div class="drawing grid size-14 shrink-0 place-items-center rounded-lg bg-night/40">
            <span class="font-pixel text-2xl text-sea" aria-hidden="true">✎</span>
          </div>
          <div>
            <p class="font-semibold">Drawing {waitingFor}.</p>
            <p class="mt-1 text-sm text-muted">
              {waitingFor} comes to work as soon as they are drawn. The office goes up meanwhile.
            </p>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .card {
    animation: slide 240ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  .card.backward {
    animation-name: slide-back;
  }
  @keyframes slide {
    from {
      opacity: 0;
      transform: translateX(16px);
    }
  }
  @keyframes slide-back {
    from {
      opacity: 0;
      transform: translateX(-16px);
    }
  }
  :global([dir='rtl']) .card {
    animation-name: slide-back;
  }
  :global([dir='rtl']) .card.backward {
    animation-name: slide;
  }
  /* Tiles laid row by row, over and over, while the office draws. */
  .tiles span {
    animation: lay 1.8s ease-in-out infinite both;
  }
  @keyframes lay {
    0% {
      opacity: 0;
      transform: scale(0.4);
    }
    25%,
    75% {
      opacity: 1;
      transform: scale(1);
    }
    100% {
      opacity: 0;
      transform: scale(0.4);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tiles span {
      animation: none;
    }
  }
  .bar {
    transition: transform 400ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  :global([dir='rtl']) .bar {
    transform-origin: right;
  }
  .drawing span {
    animation: sketch 1.4s ease-in-out infinite;
  }
  @keyframes sketch {
    50% {
      transform: translate(3px, -2px) rotate(-8deg);
    }
  }
  .caption {
    animation: rise 280ms cubic-bezier(0.2, 0.7, 0.2, 1);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  .strip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-bottom: 1px solid var(--color-hairline);
    background: color-mix(in srgb, var(--color-sea) 8%, transparent);
    padding: 0.3rem 1rem;
    font-size: 0.75rem;
    color: var(--color-muted);
  }
  .strip i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--color-sea);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .strip.done i {
    animation: none;
    background: var(--color-moss);
  }
  @keyframes pulse {
    50% {
      opacity: 0.4;
      transform: scale(0.5);
    }
  }
  .onboarding :global(.btn) {
    border-radius: 0.625rem;
    background: var(--color-raise);
    padding: 0.55rem 0.9rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-ink);
    transition: transform 120ms;
  }
  .onboarding :global(.btn:hover) {
    background: rgb(255 255 255 / 0.12);
  }
  .onboarding :global(.btn:active) {
    transform: translateY(1px);
  }
  .onboarding :global(.btn:disabled) {
    opacity: 0.4;
    cursor: default;
  }
  .onboarding :global(.btn.primary) {
    background: var(--color-sea);
    color: var(--color-night);
  }
  .onboarding :global(.btn.big) {
    padding: 0.75rem 1.4rem;
    font-size: 0.95rem;
  }
  .onboarding :global(.btn.ghost) {
    background: none;
    color: var(--color-muted);
    padding-inline: 0.5rem;
  }
  .onboarding :global(.link) {
    color: var(--color-sea);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .onboarding :global(.field) {
    border: 1px solid transparent;
    border-radius: 0.625rem;
    background: var(--color-raise);
    padding: 0.55rem 0.75rem;
    font-size: 0.875rem;
    color: var(--color-ink);
    outline: none;
  }
  .onboarding :global(.field::placeholder) {
    color: var(--color-faint);
  }
  .onboarding :global(.field:focus) {
    border-color: var(--color-sea);
  }
  .onboarding :global(.chip) {
    border: 1px solid var(--color-hairline);
    border-radius: 999px;
    background: var(--color-raise);
    padding: 0.3rem 0.7rem;
    font-size: 0.75rem;
    color: var(--color-ink);
  }
  .onboarding :global(.chip.on) {
    border-color: var(--color-sea);
    background: color-mix(in srgb, var(--color-sea) 14%, transparent);
  }
  .onboarding :global(.chip:disabled) {
    opacity: 0.5;
  }
</style>
