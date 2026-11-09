<script lang="ts">
  // Where the data lives: your computer in the middle with the office on its screen,
  // Anthropic and the tools you connect at the edges on dashed lines you open,
  // and New Altitude off the map, reached only by the error reports and the sign-in the owner chooses.
  //
  // Each fact lights the part of the map it is about and dims the rest. While
  // the section is on screen the highlight steps through the four facts. The
  // active fact's start rule fills top to bottom as the step's timer, and the
  // step moves on when the fill ends (animationend, so no timer and no drift).
  // The fill pauses where it is off screen and in a hidden tab, and there is
  // no cycle under reduced motion. Pointing at, focusing or tapping a fact hands control to the
  // visitor and the cycle stops for good on this page view.
  import SectionHeader from '#lib/components/SectionHeader.svelte';
  import { reducedMotion, reveal, stagger, visible } from '#lib/motion/index.ts';

  const facts = [
    {
      title: 'Only your computer can reach it.',
      text: 'The office listens at 127.0.0.1, a local address nothing outside your computer can reach.',
      shows: 'Highlights your computer in the diagram.'
    },
    {
      title: 'Nothing comes to us unless you say so.',
      text: 'New Altitude runs no server for your office. If you sign in to a New Altitude account, your sign-in comes to us. If you also turn on error reports, they go to our relay so we can fix what broke. Nothing else does.',
      shows:
        "Highlights New Altitude, off the map, and the two dashed lines, the only paths your office's data takes. Error reports and a New Altitude sign-in reach us only if you choose them."
    },
    {
      title: 'Your AI works under your own account.',
      text: 'Odds think with Claude Code, Codex or Grok, signed in to your own account. We are not in that loop.',
      shows: 'Highlights your AI, your own account and the line to it.'
    },
    {
      title: 'No account needed.',
      text: 'Nothing to sign up for and no key to request. If you have a New Altitude account, you can sign in and choose to send error reports; nothing else changes.',
      shows: 'Highlights the two accounts in the diagram, both of them yours.'
    }
  ];

  // The parts of the map, and the facts that light each one. A part outside
  // the active fact dims; `soft` dims it lightly instead.
  type Part = 'a' | 'la' | 'mac' | 'lb' | 'tools' | 'cap' | 'na';
  const LIT: Record<Part, number[]> = {
    a: [2, 3],
    la: [1, 2],
    mac: [0],
    lb: [1],
    tools: [3],
    cap: [1],
    na: [1]
  };
  const SOFT: Partial<Record<Part, number[]>> = { mac: [2] };

  const STEP_MS = 4000;
  const still = reducedMotion();

  // Stacked (below lg) the diagram sits above the list, so a tapped fact could
  // light a diagram scrolled out of view: bring it back, unless it already shows.
  let map = $state<HTMLElement>();
  function showMap() {
    if (!map || window.matchMedia('(min-width: 64rem)').matches) return;
    const r = map.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    map.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'nearest' });
  }

  let step = $state(-1);
  let inView = $state(false);
  let hidden = $state(false);
  let taken = $state(false);
  let hovered = $state<number | null>(null);
  let focused = $state<number | null>(null);
  let picked = $state<number | null>(null);
  const buttons: HTMLButtonElement[] = $state([]);

  const active = $derived(hovered ?? focused ?? picked ?? (taken || still ? -1 : step));
  const level = (p: Part) =>
    active < 0 || LIT[p].includes(active) ? '' : SOFT[p]?.includes(active) ? 'soft' : 'dim';

  const cycling = $derived(!taken && !still && step >= 0);
  const paused = $derived(!inView || hidden);
  // The first time the section is on screen, the cycle starts at fact one.
  $effect(() => {
    if (step < 0 && !taken && !still && inView && !hidden) step = 0;
  });
  const filled = (e: AnimationEvent, i: number) => {
    if (cycling && step === i && e.pseudoElement === '::before') step = (i + 1) % facts.length;
  };

  const take = () => (taken = true);
  const keys = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    buttons[(i + d + facts.length) % facts.length]?.focus();
  };
</script>

<svelte:document onvisibilitychange={() => (hidden = document.hidden)} />

<SectionHeader
  eyebrow="On your computer"
  title="Your office lives on your computer."
  lede="The office is a program on your Mac, Windows or Linux computer with its own database. There is no Oddboro server. Your Odds, your goals, your decisions and the people in your life stay on the machine in front of you."
/>

<div
  use:visible={(on) => (inView = on)}
  data-active={active}
  style="--step-ms:{STEP_MS}ms"
  class:cycling
  class:paused
  class="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-16"
>
  <figure
    bind:this={map}
    use:reveal
    class="map rounded-card border-hairline relative scroll-mt-24 border p-5 sm:p-6"
  >
    <figcaption class="text-faint mb-6 text-center text-xs font-semibold tracking-wide uppercase">
      Where the data lives
    </figcaption>
    <!-- Rows 1 to 3 are the screen's height band: the screen spans them, and
         the cards and links sit in the auto middle row with equal 1fr rows
         either side, so their centres land on the screen's centre and both
         cards take the taller one's height. Row 4 holds the stand and labels. -->
    <div
      class="grid gap-x-3 sm:grid-cols-[minmax(7rem,1fr)_auto_minmax(0,2.2fr)_auto_minmax(7rem,1fr)] sm:grid-rows-[1fr_auto_1fr_auto]"
    >
      <div
        class="part edge edge-a border-hairline bg-raise rounded-lg border p-3 text-center {level(
          'a'
        )}"
        class:pop={active === 2 || active === 3}
      >
        <p class="who text-ink text-sm font-semibold">Your AI</p>
        <p class="text-muted mt-0.5 text-xs">Claude, Codex or Grok, on your account.</p>
      </div>
      <div class="part link link-a {level('la')}" aria-hidden="true"></div>

      <div
        class="part screen pixel bg-night border-hairline relative overflow-hidden rounded-md border {level(
          'mac'
        )}"
      >
        <div
          class="art h-full w-full"
          style="background-image:var(--art-lit);background-size:1280px 1232px;background-position:-560px -30px"
        ></div>
        <span
          class="glass border-hairline text-ink absolute start-2 bottom-2 rounded-full border px-2 py-0.5 text-[10px] font-medium"
        >
          the office
        </span>
      </div>
      <div class="part below pb-3 sm:pb-0 {level('mac')}">
        <div class="stand mx-auto" aria-hidden="true"></div>
        <p class="text-ink mt-3 text-center text-sm font-semibold">Your computer</p>
        <p class="text-muted text-center text-xs">The office and its database, at 127.0.0.1</p>
      </div>

      <div class="part link link-b {level('lb')}" aria-hidden="true"></div>
      <div
        class="part edge edge-b border-hairline bg-raise rounded-lg border p-3 text-center {level(
          'tools'
        )}"
        class:pop={active === 3}
      >
        <p class="who text-ink text-sm font-semibold">Your tools</p>
        <p class="text-muted mt-0.5 text-xs">Your sign-in, if you give one.</p>
      </div>
    </div>

    <p class="part text-faint mt-5 text-center text-xs {level('cap')}">
      Only you open the dashed lines.
    </p>
    <div
      class="part border-faint/50 mt-5 flex items-center justify-center gap-3 border-t border-dashed pt-5 {level(
        'na'
      )}"
    >
      <span
        class="cross text-coral font-pixel text-lg leading-none"
        class:pop={active === 1}
        aria-hidden="true">×</span
      >
      <p class="text-muted text-xs">
        <span class="text-ink font-semibold">New Altitude</span> is off the map. Your office's data never
        flows here. Error reports and a sign-in do, only if you choose them.
      </p>
    </div>
  </figure>

  <ul use:stagger={{ step: 100 }} class="space-y-5">
    {#each facts as f, i (f.title)}
      <li
        class="fact border-hairline relative border-s-2 ps-4"
        class:on={active === i}
        onanimationend={(e) => filled(e, i)}
      >
        <div class="fact-body" class:back={active >= 0 && active !== i}>
          <h3 class="text-ink font-semibold">
            <button
              bind:this={buttons[i]}
              type="button"
              class="cursor-pointer text-start after:absolute after:inset-0"
              aria-pressed={picked === i}
              aria-describedby="fact-{i}-text fact-{i}-shows"
              onpointerenter={(e) => {
                if (e.pointerType !== 'mouse') return;
                take();
                hovered = i;
              }}
              onpointerleave={() => (hovered = null)}
              onfocus={() => {
                take();
                focused = i;
              }}
              onblur={() => (focused = null)}
              onclick={() => {
                take();
                picked = i;
                showMap();
              }}
              onkeydown={(e) => keys(e, i)}>{f.title}</button
            >
          </h3>
          <p id="fact-{i}-text" class="text-muted mt-1 text-[15px] leading-relaxed">{f.text}</p>
          <span id="fact-{i}-shows" class="sr-only">{f.shows}</span>
        </div>
      </li>
    {/each}
  </ul>
</div>

<style>
  .map {
    background: radial-gradient(60% 60% at 50% 40%, var(--color-sea-deep) 0%, transparent 70%);
  }
  .screen,
  .below {
    width: 100%;
    max-width: 20rem;
    justify-self: center;
  }
  .screen {
    align-self: center;
    aspect-ratio: 16 / 10;
    box-shadow: var(--shadow-float);
  }
  .stand {
    width: 3rem;
    height: 0.6rem;
    background: var(--color-raise);
    border: 1px solid var(--color-hairline);
    border-top: 0;
    border-radius: 0 0 6px 6px;
  }
  @media (min-width: 640px) {
    .edge-a {
      grid-area: 2 / 1;
    }
    .link-a {
      grid-area: 2 / 2;
    }
    .screen {
      grid-area: 1 / 3 / 4;
    }
    .below {
      grid-area: 4 / 3;
    }
    .link-b {
      grid-area: 2 / 4;
    }
    .edge-b {
      grid-area: 2 / 5;
    }
  }
  /* A dashed line from the Mac out to an edge. Vertical when the map stacks. */
  .link {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 3.5rem;
    min-height: 2.5rem;
  }
  .link::before {
    content: '';
    position: absolute;
    inset: 50% 0 auto 0;
    border-top: 2px dashed var(--color-sea);
    opacity: 0.6;
  }
  @media (max-width: 639px) {
    .link {
      min-height: 3.5rem;
    }
    .link::before {
      inset: 0 auto 0 50%;
      border-top: 0;
      border-inline-start: 2px dashed var(--color-sea);
    }
  }

  /* The linked highlight. Opacity and transform only, a quick crossfade. */
  .part,
  .cross,
  .who,
  .fact-body,
  .fact::before {
    transition:
      opacity 250ms ease,
      transform 250ms ease;
  }
  .part.dim {
    opacity: 0.35;
  }
  .part.soft {
    opacity: 0.6;
  }
  .edge.pop {
    transform: scale(1.03);
  }
  .cross {
    display: inline-block;
  }
  .cross.pop {
    transform: scale(1.5);
  }
  /* No account needed: the account lines lead, the names step back. */
  [data-active='3'] .who {
    opacity: 0.55;
  }

  /* The active fact: a rule twice as thick in sea over the hairline track, and
     the others ease back, so it never rests on colour alone. While the cycle
     runs the rule is the step's timer, filling top to bottom; once the visitor
     takes over, the chosen fact's rule shows full and still. */
  .fact::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: -3px;
    width: 4px;
    border-radius: 2px;
    background: var(--color-sea);
    opacity: 0;
    transform-origin: top;
  }
  .fact.on::before {
    opacity: 1;
  }
  .cycling .fact.on::before {
    animation: fill var(--step-ms) linear forwards;
  }
  .paused .fact.on::before {
    animation-play-state: paused;
  }
  @keyframes fill {
    from {
      transform: scaleY(0);
    }
    to {
      transform: none;
    }
  }
  .fact-body.back {
    opacity: 0.6;
  }
  .fact button:focus-visible {
    outline: none;
  }
  .fact:has(button:focus-visible) {
    outline: 2px solid var(--color-sea);
    outline-offset: 4px;
    border-radius: 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    .part,
    .cross,
    .who,
    .fact-body,
    .fact::before {
      transition: none;
      animation: none;
    }
    .edge.pop,
    .cross.pop {
      transform: none;
    }
  }
</style>
