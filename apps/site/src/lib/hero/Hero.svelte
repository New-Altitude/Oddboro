<script lang="ts">
  // The hero: the office goes up on its lot the way it does in the product
  // (chalk, floors, walls, furniture, lamps), the bus brings the Office
  // Manager, Odds settle at their desks, and a bubble over each head says
  // what it is doing. The art and every position come from scene.json, which
  // scripts/art.ts writes from the office's own packages.
  //
  // A camera frames it: the whole lot while the office goes up, then twice as
  // close to follow the bus, the manager and the Odd to the owner's door,
  // and back out for the last beat, so the sprites read at every size.
  //
  // The sequence plays once and settles. Then the office keeps living: every
  // so often one Odd finishes its job, takes a break to read or rest, and
  // comes back to start its next one. Both pause off screen, "Play it again"
  // restarts the sequence, and under reduced motion the finished office shows
  // at once and nothing moves.
  // The markup's defaults are the finished state at one pixel per art pixel,
  // so the page is whole before any script runs.
  import { onMount } from 'svelte';
  import scene from './scene.json';
  import {
    along,
    clamp,
    easeInOut,
    easeOut,
    lerp,
    linear,
    Player,
    Timeline,
    type Path
  } from './choreo.ts';
  import { reducedMotion, reveal, visible } from '#lib/motion/index.ts';
  import { SITE } from '#lib/site.ts';
  import { theme } from '#lib/theme.svelte.ts';
  import DownloadButton from '#lib/components/DownloadButton.svelte';
  import GitHubMark from '#lib/components/GitHubMark.svelte';
  import HeadlineOdd from './HeadlineOdd.svelte';

  const { width: W, height: H, pieces, areas, walkers, bus, door, staff } = scene;
  const TILE = scene.tile;
  const SPEED = 80; // pixels per second: five tiles
  const row = (pose: string) => Math.max(0, staff.rows.indexOf(pose));

  // What each Odd works on after the build, in order. Edit the copy here.
  // `doing` is the bubble while the job runs at the Odd's seat; `done` is the
  // line when it finishes, just before the Odd takes a break. Each list cycles,
  // and its first `doing` must match that Odd's bubble in scene.json, since
  // that is what the build ends on. Keep each line under about 32 characters.
  const JOBS: Record<string, { doing: string; done: string }[]> = {
    // Ada, the Writer
    ada: [
      { doing: 'Drafting the Friday report', done: 'Friday report is on your desk' },
      { doing: 'Drafting a thank-you note', done: 'Thank-you note is ready' },
      { doing: 'Writing the newsletter', done: 'Newsletter draft is ready' }
    ],
    // Theo, the Researcher
    theo: [
      { doing: 'Searching the ledger', done: 'Found what you decided last time' },
      { doing: 'Reading the lease', done: 'Lease summary is ready' },
      { doing: 'Checking the budget', done: 'Budget notes are on your desk' }
    ],
    // Marshall, the Office Manager
    marshall: [
      { doing: 'Back from lunch', done: 'Back at the desk' },
      { doing: 'Writing your daily report', done: 'Daily report is ready' },
      { doing: 'Checking on the team', done: 'Everyone is on track' },
      { doing: 'Drafting a job for a new Odd', done: 'New job is ready for your yes' }
    ]
  };
  // What a free Odd's bubble says at a spot, keyed by the spot's bubble in
  // scene.json. A spot not listed shows its scene.json bubble.
  const AT_SPOT: Record<string, string> = {
    'Looking something up': 'Reading',
    'Taking a break': 'Taking a break'
  };

  // The beats, in ms. Each one starts where the office's own reveal would.
  const CHALK = 300;
  const FLOORS = 800;
  const WALLS = 1500;
  const PROPS = 2500;
  const LIT = 3400;
  const BUS_IN = 2600;
  const BUS_ARRIVE = BUS_IN + 2600;
  const BUS_OPEN = BUS_ARRIVE + 150;
  const STEP_OFF = BUS_OPEN + 250;
  const MANAGER_GO = STEP_OFF + 500;
  const BUS_CLOSE = MANAGER_GO + 900;
  const BUS_LEAVE = BUS_CLOSE + 300;
  const BUS_GONE = BUS_LEAVE + 2600;
  const QUESTION_GO = MANAGER_GO + 1300;

  const finals = walkers.map((w) => {
    const [x, y] = w.path[w.path.length - 1];
    return { x, y };
  });
  const walkMs = (w: (typeof walkers)[number]) => ((w.path.length - 1) * TILE * 1000) / SPEED;
  const startOf = (w: (typeof walkers)[number], i: number) =>
    w.from === 'bus' ? MANAGER_GO : w.from === 'seat' ? QUESTION_GO : LIT + 900 + i * 260;
  const arriveOf = (w: (typeof walkers)[number], i: number) =>
    w.from === 'here' ? startOf(w, i) : startOf(w, i) + walkMs(w);
  const END = Math.max(...walkers.map((w, i) => arriveOf(w, i) + 900), BUS_GONE);

  // The caption under the stage, one line per beat. The art follows the theme
  // through the --art-* variables, so by day the lamps beat is the doors
  // opening: the same crossfade, with nothing to light.
  const beats = (day: boolean): [number, string][] => [
    [CHALK, 'Setup marks out the lot.'],
    [FLOORS, 'The floors go down.'],
    [WALLS, 'The walls go up.'],
    [PROPS, 'The furniture moves in.'],
    [LIT, day ? 'Doors open.' : 'Lights on.'],
    [LIT + 900, 'Your Odds sit down to work.'],
    [BUS_ARRIVE, 'The bus is here.'],
    [MANAGER_GO, 'Your Office Manager walks in.'],
    [QUESTION_GO, 'An Odd needs your yes.'],
    [END - 600, 'Open for business.']
  ];

  let wrap = $state<HTMLDivElement>();
  let root = $state<HTMLDivElement>();
  let hud = $state<HTMLDivElement>();
  let controls = $state<HTMLDivElement>();
  // The stage's own scale: one CSS pixel per art pixel when the column has
  // room, else a half. The camera zooms by up to twice that. Written by
  // layout(), not bound, so the camera stays the one writer of transforms.
  let zoom = 1;
  // Each bubble's width, measured once, so a bubble near the edge can be kept
  // inside the stage without reading layout every frame.
  let widths: number[] = [];
  // Where each bubble points: the walker's seat, or wherever a trip has it.
  const pos = finals.map((f) => ({ ...f }));
  // The camera's last placement, so a trip can place its bubble between frames.
  let view = { tx: 0, ty: 0, z: 1 };
  let bubbleEls: HTMLElement[] = [];

  function placeBubble(b: HTMLElement, i: number) {
    const { tx, ty, z } = view;
    // A bubble whose head is on the stage stays inside it, tail still over
    // the head. One whose head the camera cannot see stays out of sight.
    const x = (pos[i].x + staff.w / 2) * z + tx;
    const half = (widths[i] ?? 0) / 2 + 6;
    const cx = Math.min(W * zoom - half, Math.max(half, x));
    b.style.visibility = x < 0 || x > W * zoom ? 'hidden' : '';
    b.style.insetInlineStart = `${cx}px`;
    b.style.setProperty('--tail', `${Math.max(8 - half, Math.min(half - 8, x - cx))}px`);
    b.style.top = `${(pos[i].y - TILE - 6) * z + ty}px`;
  }
  let now = $state(END);
  const beat = $derived.by(() => {
    const list = beats(theme.current === 'day');
    let text = list[0][1];
    for (const [at, words] of list) if (now >= at) text = words;
    return text;
  });
  let ended = $state(true);
  let reduced = $state(false);
  let player: Player | undefined;
  let onScreen = true;

  /** One CSS pixel per art pixel when it fits, else a half, centred. */
  const fit = (avail: number) => (avail >= W ? 1 : 0.5);

  // The camera: where its centre is in art pixels, and how close, relative
  // to the stage's scale (1 shows the whole lot, 2 is twice as close). A
  // repeated shot holds; the move between two different shots eases.
  type View = [cx: number, cy: number, k: number];
  type Shot = [at: number, ...View];
  const busView: View = [bus.stop + bus.w / 2 - 40, bus.y - 30, 2];
  const lobbyView: View = [finals[2].x - 20, finals[2].y + 20, 2];
  const doorView: View = [(finals[3].x + walkers[3].path[0][0]) / 2, 150, 2];
  const shots: Shot[] = [
    [0, W / 2, H / 2, 1],
    [BUS_IN + 700, W / 2, H / 2, 1],
    [BUS_IN + 1700, ...busView],
    [BUS_CLOSE, ...busView],
    [BUS_CLOSE + 1000, ...lobbyView],
    [QUESTION_GO + 400, ...lobbyView],
    [QUESTION_GO + 1300, ...doorView],
    [END - 1700, ...doorView],
    [END - 800, W / 2, H / 2, 1]
  ];
  /** The last shot. On a half-size stage the whole lot is too small to read, so it stays close. */
  const finale = (): Shot => (zoom >= 1 ? shots[shots.length - 1] : [END - 800, 300, 220, 2]);

  function cam(t: number): { cx: number; cy: number; k: number } {
    const list = [...shots.slice(0, -1), finale()];
    let a = list[0];
    let b = list[0];
    for (let i = 0; i < list.length; i++) {
      if (list[i][0] <= t) {
        a = list[i];
        b = list[Math.min(i + 1, list.length - 1)];
      }
    }
    const p = b[0] > a[0] ? easeInOut(clamp((t - a[0]) / (b[0] - a[0]))) : 1;
    const k = lerp(a[3], b[3], p);
    // The viewport never leaves the art: the centre stays half a viewport in.
    const hw = W / (2 * k);
    const hh = H / (2 * k);
    return {
      cx: Math.min(W - hw, Math.max(hw, lerp(a[1], b[1], p))),
      cy: Math.min(H - hh, Math.max(hh, lerp(a[2], b[2], p))),
      k
    };
  }

  /** Size the stage to its scale. The camera then places the scene inside it. */
  function layout(avail: number) {
    zoom = fit(avail);
    for (const el of [wrap!, controls!]) el.style.width = `${W * zoom}px`;
    wrap!.style.height = `${H * zoom}px`;
    widths = [...hud!.querySelectorAll<HTMLElement>('[data-bubble]')].map((b) => b.offsetWidth);
  }

  function build(): Timeline {
    const tl = new Timeline();
    const all = (sel: string) => [...root!.querySelectorAll<HTMLElement>(sel)];
    const one = (sel: string, from: HTMLElement = root!) => from.querySelector<HTMLElement>(sel)!;
    const chalk = one('[data-chalk]');
    const floors = all('[data-floor]');
    const walls = all('[data-wall]');
    const props = all('[data-prop]');
    const lits = all('[data-lit]');
    const busEl = one('[data-bus]');
    const busStrip = one('[data-bus-strip]');
    const doorEl = one('[data-door]');
    const walkerEls = all('[data-walker]');
    const cels = all('[data-cel]');
    const sheets = all('[data-sheet]');
    const bubbles = [...hud!.querySelectorAll<HTMLElement>('[data-bubble]')];
    bubbleEls = bubbles;

    tl.add(
      0,
      END,
      (_, t) => {
        const { cx, cy, k } = cam(t);
        const z = zoom * k;
        const tx = Math.round((W * zoom) / 2 - cx * z);
        const ty = Math.round((H * zoom) / 2 - cy * z);
        root!.style.transform = `translate(${tx}px, ${ty}px) scale(${z})`;
        view = { tx, ty, z };
        bubbles.forEach(placeBubble);
      },
      linear
    );

    tl.add(CHALK, 400, (k) => (chalk.style.opacity = String(k)));
    floors.forEach((el, i) => tl.add(FLOORS + i * 70, 240, (k) => (el.style.opacity = String(k))));
    walls.forEach((el, i) =>
      tl.add(WALLS + i * 70, 320, (k) => {
        // Rise from the base: the bottom edge holds still.
        el.style.opacity = String(Math.min(1, k * 1.5));
        el.style.transform = `scaleY(${0.2 + 0.8 * k})`;
      })
    );
    tl.add(WALLS + walls.length * 70 + 200, 300, (k) => (chalk.style.opacity = String(1 - k)));
    props.forEach((el, i) =>
      tl.add(PROPS + i * 120, 180, (k) => {
        // A tile's fall into place.
        el.style.opacity = String(k);
        el.style.transform = `translateY(${-TILE * (1 - k)}px)`;
      })
    );
    lits.forEach((el) => tl.add(LIT, 800, (k) => (el.style.opacity = String(k))));

    tl.add(
      BUS_IN,
      BUS_GONE - BUS_IN,
      (_, t) => {
        let x = bus.stop;
        let moving = false;
        if (t < BUS_ARRIVE) {
          x = lerp(-bus.w, bus.stop, easeOut(clamp((t - BUS_IN) / 2600)));
          moving = true;
        } else if (t >= BUS_LEAVE) {
          x = lerp(bus.stop, W + 40, easeInOut(clamp((t - BUS_LEAVE) / 2600)));
          moving = true;
        }
        const shown = t >= BUS_IN && t < BUS_GONE;
        busEl.style.opacity = shown ? '1' : '0';
        busEl.style.transform = `translate(${Math.round(x)}px, ${bus.y}px)`;
        const frame = moving ? Math.floor(t / 120) % 2 : t >= BUS_OPEN && t < BUS_CLOSE ? 2 : 0;
        busStrip.style.transform = `translateX(${-frame * bus.w}px)`;
      },
      linear
    );

    walkers.forEach((w, i) => {
      const el = walkerEls[i];
      const cel = cels[i];
      const sheet = sheets[i];
      const bubble = bubbles[i];
      const start = startOf(w, i);
      const arrive = arriveOf(w, i);
      const bubbleAt = w.from === 'here' ? start + 700 : arrive + 300;
      tl.add(
        0,
        END,
        (_, t) => {
          let [x, y] = w.path[0];
          let pose = w.pose;
          let frame = 0;
          let flip = false;
          let shown = true;
          let pop = 1;
          let atDoor = false;
          if (w.from === 'here') {
            shown = t >= start;
            pop = easeOut(clamp((t - start) / 240));
          } else if (t < start) {
            if (w.from === 'seat') {
              shown = t >= LIT;
              pose = w.seated ?? w.pose;
            } else {
              shown = t >= STEP_OFF;
              pose = 'idle-down';
            }
          } else {
            const a = along(w.path as Path, ((t - start) * SPEED) / 1000, TILE);
            x = a.x;
            y = a.y;
            if (!a.done) {
              pose = a.dir === 'up' ? 'walk-up' : a.dir === 'down' ? 'walk-down' : 'walk-side';
              flip = a.dir === 'left';
              frame = a.frame;
              atDoor = Math.abs(x - door.tile[0]) < 24 && Math.abs(y - door.tile[1]) < 28;
            }
          }
          el.style.opacity = shown ? String(pop) : '0';
          el.style.transform = `translate(${x}px, ${y - TILE}px) scale(${0.7 + 0.3 * pop})`;
          el.style.zIndex = String(y + TILE + 10);
          cel.style.transform = flip ? 'scaleX(-1)' : 'none';
          sheet.style.transform = `translate(${-frame * staff.w}px, ${-row(pose) * staff.h}px)`;
          if (w.from === 'bus') doorEl.style.opacity = atDoor ? '1' : '0';
          const b = easeOut(clamp((t - bubbleAt) / 260));
          bubble.style.opacity = String(b);
          bubble.style.transform = `translate(-50%, ${(1 - b) * 6}px) scale(${0.6 + 0.4 * b})`;
        },
        linear
      );
    });
    return tl;
  }

  const caption = (t: number) => (now = t);

  // The ambient trips, the way the real office moves its Odds. An Odd on a
  // job stays at its seat; only a free one gets up. So a trip is: the job
  // ends and the bubble says so, the Odd walks to a spot to read or rest,
  // stays a while, walks back, and its next job starts. One trip at a time.
  //
  // Each trip is a pure function of its own clock, like the sequence. The
  // clock starts negative: the gap before the trip, when nothing moves. Frames
  // run only while something moves or fades; every still stretch (the gap,
  // the done line, the stay) is one timeout.
  type Errand = { out: Path; back: Path; pose: string; flip: boolean; bubble: string };
  const errandsOf = walkers.map((w) => (w as { errands?: Errand[] }).errands ?? []);
  const jobsOf = walkers.map((w) => JOBS[w.name] ?? []);
  const travellers = walkers.flatMap((_, i) =>
    errandsOf[i].length && jobsOf[i].length ? [i] : []
  );
  const HOLD = 1800; // the done line, before the Odd gets up
  const DWELL = 6000;
  const FADE = 260;
  const walkLen = (p: Path) => ((p.length - 1) * TILE * 1000) / SPEED;
  const gap = () => 4000 + Math.random() * 5000;
  const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

  type Trip = { i: number; e: Errand; job: number; arrive: number; leave: number; home: number };
  const amb = {
    trip: undefined as Trip | undefined,
    s: 0, // the trip's clock, in ms; below zero is the gap before it
    job: walkers.map(() => 0), // each Odd's current job in JOBS
    last: -1, // who went last, so nobody goes twice in a row
    on: false,
    raf: 0,
    frameAt: 0,
    timer: 0,
    waitFrom: 0,
    waitTo: 0
  };

  function planTrip(first: boolean) {
    const who = travellers.length > 1 ? travellers.filter((i) => i !== amb.last) : travellers;
    const i = pick(who);
    const e = pick(errandsOf[i]);
    const arrive = HOLD + FADE + walkLen(e.out);
    const leave = arrive + DWELL;
    amb.trip = { i, e, job: amb.job[i], arrive, leave, home: leave + walkLen(e.back) };
    amb.s = first ? -2500 : -gap();
  }

  /** Where the clock is in a still stretch, the time that stretch ends. */
  function stillUntil(t: Trip, s: number): number | undefined {
    if (s < 0) return 0;
    if (s >= FADE && s < HOLD) return HOLD;
    if (s >= t.arrive + FADE && s < t.leave - FADE) return t.leave - FADE;
    return undefined;
  }

  function drawWalker(i: number, x: number, y: number, pose: string, frame = 0, flip = false) {
    const el = root!.querySelectorAll<HTMLElement>('[data-walker]')[i];
    const cel = el.querySelector<HTMLElement>('[data-cel]')!;
    const sheet = el.querySelector<HTMLElement>('[data-sheet]')!;
    el.style.opacity = '1';
    el.style.transform = `translate(${x}px, ${y - TILE}px)`;
    el.style.zIndex = String(y + TILE + 10);
    cel.style.transform = flip ? 'scaleX(-1)' : 'none';
    sheet.style.transform = `translate(${-frame * staff.w}px, ${-row(pose) * staff.h}px)`;
  }

  function showBubble(i: number, text: string, k: number) {
    const b = bubbleEls[i];
    if (!b) return;
    if (b.textContent !== text) {
      b.textContent = text;
      widths[i] = b.offsetWidth;
    }
    b.style.opacity = String(k);
    b.style.transform = `translate(-50%, ${(1 - k) * 6}px) scale(${0.6 + 0.4 * k})`;
    placeBubble(b, i);
  }

  /** Draw the trip at its clock. Before it starts, the sequence's end stands. */
  function drawTrip() {
    const t = amb.trip;
    if (!t || amb.s < 0) return;
    const { i, e, arrive, leave, home } = t;
    const w = walkers[i];
    const jobs = jobsOf[i];
    const s = amb.s;
    const seat = () => {
      pos[i] = { ...finals[i] };
      drawWalker(i, finals[i].x, finals[i].y, w.pose);
    };
    const walking = (p: Path, d: number) => {
      const a = along(p, (d * SPEED) / 1000, TILE);
      pos[i] = { x: a.x, y: a.y };
      const pose = a.dir === 'up' ? 'walk-up' : a.dir === 'down' ? 'walk-down' : 'walk-side';
      drawWalker(i, a.x, a.y, pose, a.frame, a.dir === 'left');
    };
    const done = jobs[t.job].done;
    const spot = AT_SPOT[e.bubble] ?? e.bubble;
    if (s < HOLD) {
      // The job ends: the same bubble says so, with a small pop.
      seat();
      showBubble(i, done, 0.6 + 0.4 * easeOut(clamp(s / FADE)));
    } else if (s < HOLD + FADE) {
      seat();
      showBubble(i, done, 1 - (s - HOLD) / FADE);
    } else if (s < arrive) {
      walking(e.out, s - HOLD - FADE);
      showBubble(i, done, 0);
    } else if (s < leave) {
      const [x, y] = e.out[e.out.length - 1];
      pos[i] = { x, y };
      drawWalker(i, x, y, e.pose, 0, e.flip);
      showBubble(i, spot, easeOut(Math.min(clamp((s - arrive) / FADE), clamp((leave - s) / FADE))));
    } else if (s < home) {
      walking(e.back, s - leave);
      showBubble(i, spot, 0);
    } else {
      // Back at the seat, and the next job starts.
      seat();
      showBubble(i, jobs[(t.job + 1) % jobs.length].doing, easeOut(clamp((s - home) / FADE)));
    }
  }

  /** Draw now, then wait out a still stretch or ask for the next frame. */
  function ambientRun() {
    const t = amb.trip;
    if (!amb.on || !t) return;
    if (amb.s >= t.home + FADE) {
      amb.s = t.home + FADE;
      drawTrip();
      amb.job[t.i] = (t.job + 1) % jobsOf[t.i].length;
      amb.last = t.i;
      planTrip(false);
    }
    drawTrip();
    const until = stillUntil(amb.trip!, amb.s);
    if (until === undefined) {
      amb.frameAt = performance.now();
      amb.raf = requestAnimationFrame(ambientFrame);
      return;
    }
    amb.waitFrom = performance.now();
    amb.waitTo = until;
    amb.timer = window.setTimeout(() => {
      amb.timer = 0;
      amb.s = until;
      ambientRun();
    }, until - amb.s);
  }

  function ambientFrame(now: number) {
    amb.raf = 0;
    amb.s += Math.min(250, Math.max(0, now - amb.frameAt));
    ambientRun();
  }

  function ambientStart() {
    if (amb.on || reduced || !ended || !onScreen || document.hidden) return;
    if (!travellers.length) return;
    amb.on = true;
    if (!amb.trip) planTrip(true);
    ambientRun();
  }

  function ambientStop() {
    amb.on = false;
    cancelAnimationFrame(amb.raf);
    amb.raf = 0;
    if (amb.timer) {
      // Keep the time already waited, so a resume carries on from here.
      clearTimeout(amb.timer);
      amb.timer = 0;
      amb.s = Math.min(amb.waitTo, amb.s + performance.now() - amb.waitFrom);
    }
  }

  /** Back to everyone at their seats on their first job, for a replay. */
  function ambientReset() {
    ambientStop();
    amb.trip = undefined;
    amb.last = -1;
    amb.job = walkers.map(() => 0);
    finals.forEach((f, i) => (pos[i] = { ...f }));
    bubbleEls.forEach((b, i) => {
      b.textContent = walkers[i].bubble;
      widths[i] = b.offsetWidth;
    });
  }

  /** The art the active theme shows, read off the elements, so one set loads. */
  function artUrls(): string[] {
    const urls = new Set<string>();
    for (const el of root!.querySelectorAll<HTMLElement>('.art'))
      for (const m of getComputedStyle(el).backgroundImage.matchAll(/url\("?([^")]+)"?\)/g))
        urls.add(m[1]);
    return [...urls];
  }
  const loaded = (src: string) =>
    new Promise<void>((done) => {
      const img = new Image();
      img.onload = () => done();
      img.onerror = () => done();
      img.src = src;
    });

  function replay() {
    if (!player || reduced) return;
    ambientReset();
    ended = false;
    player.restart();
  }

  // The song the office plays when it welcomes a new owner. Silent until the
  // visitor asks for it; turning it on after the build ended plays the build
  // again, so the song and the office go up together.
  let song = $state<HTMLAudioElement>();
  let singing = $state(false);

  function toggleSong() {
    if (!song) return;
    if (singing) {
      song.pause();
      return;
    }
    if (song.ended) song.currentTime = 0;
    song.volume = 0.6;
    void song.play().then(
      () => {
        if (ended) replay();
      },
      () => {}
    );
  }

  onMount(() => {
    reduced = reducedMotion();
    // The column decides the scale; the stage itself is as wide as the art.
    const column = wrap!.parentElement!;
    layout(column.clientWidth);
    const tl = build();
    player = new Player(tl, caption, () => {
      ended = true;
      ambientStart();
    });
    // A new size redraws the moment the viewer is at, camera included.
    const ro = new ResizeObserver(() => {
      layout(column.clientWidth);
      player?.seek(player.t);
      if (ended) drawTrip();
    });
    ro.observe(column);
    if (reduced) {
      player.seek(tl.end);
      return () => ro.disconnect();
    }
    ended = false;
    player.seek(0);
    Promise.all(artUrls().map(loaded)).then(() => {
      if (onScreen && !document.hidden) player?.play();
    });
    // A hidden tab pauses the sequence, so it carries on where it was.
    const onVisibility = () => {
      if (!document.hidden) return seen(onScreen);
      player?.pause();
      ambientStop();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      player?.pause();
      ambientStop();
    };
  });

  function seen(on: boolean) {
    onScreen = on;
    if (!player || reduced) return;
    if (ended) return on ? ambientStart() : ambientStop();
    if (on) player.play();
    else player.pause();
  }
</script>

<!-- The lot is the largest thing on a first visit, and the stylesheet names it
     only through a variable, so the browser would find it late. The system
     setting picks the theme for a first visit; a stored pick that differs
     costs one extra image. -->
<svelte:head>
  <link
    rel="preload"
    as="image"
    href="/art/lot.png"
    media="(prefers-color-scheme: dark)"
    fetchpriority="high"
  />
  <link
    rel="preload"
    as="image"
    href="/art/day/lot.png"
    media="(prefers-color-scheme: light)"
    fetchpriority="high"
  />
</svelte:head>

<section class="relative overflow-hidden" aria-labelledby="hero-title">
  <div
    class="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_70%_0%,var(--color-sea-deep)_0%,transparent_70%)] opacity-70"
    aria-hidden="true"
  ></div>
  <div
    class="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(20rem,29rem)_minmax(0,1fr)] lg:gap-10 lg:px-8 lg:pt-20 lg:pb-24"
  >
    <div use:reveal class="max-w-xl">
      <p class="text-sea mb-4 text-sm font-semibold tracking-wide uppercase">
        Too much on your plate?
      </p>
      <h1
        id="hero-title"
        class="font-pixel text-ink text-5xl leading-[1.02] text-balance sm:text-6xl lg:text-[3.75rem]"
      >
        Hire
        <span class="inline-flex items-baseline gap-3 whitespace-nowrap"
          ><span class="text-sea">Odds.</span><HeadlineOdd /></span
        >
      </h1>
      <p class="text-muted mt-6 text-lg leading-relaxed text-pretty">
        Oddboro is a pixel office on your computer where AI workers, called Odds, take jobs off your
        hands. Watch them work: where an Odd stands shows what it's doing. Each one gets only the
        access its job needs.
      </p>
      <div class="mt-8 flex flex-wrap items-center gap-3">
        <DownloadButton
          class="bg-sea text-night rounded-md px-5 py-3 text-base font-semibold transition-opacity hover:opacity-90"
        />
        <a
          href={SITE.github}
          rel="noopener"
          class="border-hairline text-ink hover:bg-raise flex items-center gap-2 rounded-md border px-5 py-3 text-base font-medium"
        >
          <GitHubMark class="size-4" />
          View on GitHub
        </a>
      </div>
      <p class="text-faint mt-6 text-sm text-pretty">
        Open source, Apache 2.0. Runs on a Mac, Windows or Linux, with Claude Code, Codex or Grok on
        your own account.
        <a href="/releases/" class="hover:text-ink underline underline-offset-2">All downloads</a>
      </p>
    </div>

    <div class="column min-w-0">
      <div
        bind:this={wrap}
        use:visible={seen}
        class="stage rounded-card border-hairline bg-night relative mx-auto max-w-full overflow-hidden border"
      >
        <div
          bind:this={root}
          class="scene pixel"
          style:width="{W}px"
          style:height="{H}px"
          role="img"
          aria-label="A pixel-art office goes up on its lot. The bus pulls up, the Office Manager walks in, and Odds work at their desks."
        >
          <div
            class="layer art"
            style="width:{W}px;height:{H}px;background-image:var(--art-lot)"
          ></div>
          {#each pieces.floors as p (p.area)}
            <div
              data-floor
              class="piece"
              style="inset-inline-start:{p.x}px;top:{p.y}px;width:{p.w}px;height:{p.h}px;background-image:var(--art-floors);background-position:{-p.x}px {-p.y}px"
            ></div>
          {/each}
          {#each pieces.walls as p (p.area)}
            <div
              data-wall
              class="piece wall"
              style="inset-inline-start:{p.x}px;top:{p.y}px;width:{p.w}px;height:{p.h}px;background-image:var(--art-walls);background-position:{-p.x}px {-p.y}px"
            ></div>
          {/each}
          {#each pieces.props as p (p.area)}
            <div
              data-prop
              class="piece"
              style="inset-inline-start:{p.x}px;top:{p.y}px;width:{p.w}px;height:{p.h}px;background-image:var(--art-props);background-position:{-p.x}px {-p.y}px"
            ></div>
          {/each}
          <div
            data-lit
            class="layer art"
            style="width:{W}px;height:{H}px;background-image:var(--art-lit);z-index:4"
          ></div>
          <svg
            data-chalk
            class="layer"
            width={W}
            height={H}
            viewBox="0 0 {W} {H}"
            style="z-index:5;opacity:0"
            aria-hidden="true"
          >
            {#each areas as a (a.id)}
              <rect
                x={a.x + 0.5}
                y={a.y + 0.5}
                width={a.w - 1}
                height={a.h - 1}
                fill="none"
                stroke="var(--color-ink)"
                stroke-opacity="0.4"
                stroke-width="0.6"
                stroke-dasharray="3 2"
              />
            {/each}
          </svg>
          <div
            data-door
            class="abs art"
            style="inset-inline-start:{door.x}px;top:{door.y}px;width:{door.w}px;height:{door.h}px;background-image:var(--art-door-open);z-index:6;opacity:0"
          ></div>
          <div
            data-bus
            class="abs"
            style="width:{bus.w}px;height:{bus.h}px;overflow:hidden;z-index:{bus.y +
              bus.h +
              10};opacity:0;transform:translate({bus.stop}px,{bus.y}px)"
          >
            <div
              data-bus-strip
              class="abs art"
              style="width:{bus.w * 3}px;height:{bus.h}px;background-image:var(--art-bus)"
            ></div>
          </div>
          {#each walkers as w, i (w.name)}
            <div
              data-walker
              class="abs"
              style="width:{staff.w}px;height:{staff.h}px;z-index:{finals[i].y +
                TILE +
                10};transform:translate({finals[i].x}px,{finals[i].y - TILE}px)"
            >
              <div
                data-cel
                class="abs"
                style="width:{staff.w}px;height:{staff.h}px;overflow:hidden"
              >
                <div
                  data-sheet
                  class="abs art"
                  style="width:{staff.w * staff.frames}px;height:{staff.h *
                    staff.rows
                      .length}px;background-image:var(--art-{w.name});transform:translate(0,{-row(
                    w.pose
                  ) * staff.h}px)"
                ></div>
              </div>
            </div>
            {#each w.overlays as o, j (j)}
              <div
                data-lit
                class="piece"
                style="inset-inline-start:{o.x}px;top:{o.y}px;width:{o.w}px;height:{o.h}px;background-image:var(--art-pieces);background-position:{-o.x}px {-o.y}px;z-index:{o.y +
                  o.h +
                  10}"
              ></div>
            {/each}
          {/each}
        </div>

        <button
          type="button"
          class="sound glass text-ink absolute end-3 top-3 z-10 flex items-center gap-1.5 rounded-full py-1.5 ps-2.5 pe-3 text-xs font-medium"
          class:on={singing}
          aria-label={singing ? 'Mute the welcome song' : 'Unmute: play the welcome song'}
          onclick={toggleSong}
        >
          <svg viewBox="0 0 16 16" class="size-3.5" aria-hidden="true">
            <path d="M2 6h3l4-3v10l-4-3H2z" fill="currentColor" />
            {#if singing}
              <path
                d="M11 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6 6 0 0 1 0 9"
                stroke="currentColor"
                stroke-width="1.5"
                fill="none"
              />
            {:else}
              <path d="M11 6l4 4M15 6l-4 4" stroke="currentColor" stroke-width="1.5" />
            {/if}
          </svg>
          <span aria-hidden="true">{singing ? 'Mute' : 'Unmute'}</span>
        </button>
        <audio
          bind:this={song}
          src="/audio/good-morning-neighbor.m4a"
          preload="none"
          onplay={() => (singing = true)}
          onpause={() => (singing = false)}
        ></audio>

        <div bind:this={hud} class="pointer-events-none absolute inset-0" aria-hidden="true">
          {#each walkers as w, i (w.name)}
            <div
              data-bubble
              class="bubble glass {w.ask ? 'ember' : ''}"
              style:inset-inline-start="{finals[i].x + staff.w / 2}px"
              style:top="{finals[i].y - TILE - 6}px"
            >
              {w.bubble}
            </div>
          {/each}
        </div>
      </div>

      <div
        bind:this={controls}
        class="controls mx-auto mt-3 flex min-h-8 max-w-full items-center justify-between gap-4 px-1"
      >
        <p class="text-faint flex items-center gap-2 text-xs" aria-hidden="true">
          <span class="size-1.5 rounded-full {ended ? 'bg-faint' : 'bg-sea'}"></span>
          {beat}
        </p>
        {#if !reduced}
          <button
            type="button"
            onclick={replay}
            class="text-muted hover:text-ink hover:bg-raise shrink-0 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-opacity {ended
              ? 'opacity-100'
              : 'pointer-events-none opacity-0'}"
            tabindex={ended ? 0 : -1}
          >
            Play it again
          </button>
        {/if}
      </div>
    </div>
  </div>
</section>

<style>
  /* The stage's first size, before layout() runs, is the one layout() will
     pick, so nothing below it moves when the script arrives. These are the
     scene's width and height from scene.json, and the half of each that
     fit() picks when the column is narrower than the scene. */
  .column {
    container-type: inline-size;
  }
  .stage,
  .controls {
    width: 640px;
  }
  .stage {
    height: 616px;
    box-shadow: var(--shadow-float), var(--shadow-glow);
  }
  @container (width < 640px) {
    .stage,
    .controls {
      width: 320px;
    }
    .stage {
      height: 308px;
    }
    .scene {
      transform: scale(0.5);
    }
  }
  .sound {
    border: 1px solid var(--color-hairline);
  }
  .sound:hover,
  .sound.on {
    border-color: var(--color-sea);
  }
  .sound.on svg {
    color: var(--color-sea);
  }
  .scene {
    position: absolute;
    top: 0;
    inset-inline-start: 0;
    transform-origin: 0 0;
    user-select: none;
  }
  .layer,
  .abs,
  .piece {
    position: absolute;
    top: 0;
    inset-inline-start: 0;
    display: block;
  }
  .piece {
    background-repeat: no-repeat;
    image-rendering: pixelated;
    z-index: 1;
  }
  .wall {
    transform-origin: 50% 100%;
    z-index: 2;
  }
  .bubble {
    position: absolute;
    transform: translate(-50%, 0);
    white-space: nowrap;
    border: 1px solid var(--color-hairline);
    border-radius: 999px;
    padding: 0.2rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1.2;
    color: var(--color-ink);
    box-shadow: 0 6px 18px -8px rgb(0 0 0 / 0.8);
  }
  .bubble::after {
    content: '';
    position: absolute;
    top: 100%;
    inset-inline-start: calc(50% + var(--tail, 0px));
    width: 0;
    height: 0;
    margin-inline-start: -4px;
    border: 4px solid transparent;
    border-top-color: var(--color-hairline);
  }
  .bubble.ember {
    color: var(--color-night);
    background: var(--color-ember);
    border-color: var(--color-ember);
  }
  .bubble.ember::after {
    border-top-color: var(--color-ember);
  }
</style>
