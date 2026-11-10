<script lang="ts">
  // Least access, as a working mock of an Odd's Settings: the Odd's level,
  // the two tools connected for it, and what it can do with that mix right
  // now. It follows the office's own rules: a grant never sits above the
  // Odd's level, and a grant above a lowered level waits. Nothing here leaves
  // the page.
  import SectionHeader from '#lib/components/SectionHeader.svelte';
  import { blinks, reveal, stagger } from '#lib/motion/index.ts';

  const points = [
    {
      title: 'One level per Odd.',
      text: 'Every Odd holds one level: read, draft or act. A new Odd starts at read with no outside tools. Only you raise it.'
    },
    {
      title: 'An Odd asks. You connect.',
      text: 'An Odd finds the tool it needs and asks you for it. You sign in yourself.'
    },
    {
      title: 'Read only, or read and write.',
      text: 'You connect each tool read only, or with write. At draft, each change it wants to make waits for your yes. At act, that one Odd uses that one tool without asking. Lower the level and the grant waits. Revoke it and it is gone.'
    },
    {
      title: 'Drafts still come to you.',
      text: 'An Odd at draft prepares the note, the plan or the list and puts it on your desk. You approve it, deny it, or send it back for another pass.'
    }
  ];

  type Level = 'read' | 'draft' | 'act';
  const RANK: Record<Level, number> = { read: 0, draft: 1, act: 2 };
  const LEVELS: { id: Level; label: string; does: string }[] = [
    {
      id: 'read',
      label: 'Reads and reports',
      does: 'Reads and reports. Anything it wants done goes on your desk as an ask.'
    },
    {
      id: 'draft',
      label: 'Drafts for your yes',
      does: 'Prepares work and puts it on your desk for your yes.'
    },
    {
      id: 'act',
      label: 'Acts on its own',
      does: 'Does housekeeping inside the office on its own.'
    }
  ];

  type Tool = {
    id: 'notes' | 'todo';
    name: string;
    from: string;
    /** `asks`: what write does at draft, where each change waits for your yes. */
    grants: { id: Level; label: string; does: string; asks?: string }[];
  };
  const TOOLS: Tool[] = [
    {
      id: 'notes',
      name: 'Your notes app',
      from: 'From the MCP Registry',
      grants: [
        { id: 'read', label: 'Read only', does: 'Reads your notes.' },
        {
          id: 'act',
          label: 'Read and write',
          does: 'Adds and edits notes without asking.',
          asks: 'Asks your yes before each note it adds or edits.'
        }
      ]
    },
    {
      id: 'todo',
      name: 'Your to-do app',
      from: 'From the MCP Registry',
      grants: [
        { id: 'read', label: 'Read only', does: 'Reads your to-do list.' },
        {
          id: 'act',
          label: 'Read and write',
          does: 'Adds and ticks off to-dos without asking.',
          asks: 'Asks your yes before each to-do it adds or ticks off.'
        }
      ]
    }
  ];

  const NAME = 'Juno';
  /** The lowest level a grant works at: write works from draft, where each change waits for your yes. */
  const needs = (g: Level): Level => (g === 'read' ? 'read' : 'draft');
  const above = (g: Level) => RANK[needs(g)] > RANK[level];
  let level = $state<Level>('draft');
  let grant = $state<Record<Tool['id'], Level | undefined>>({ notes: 'read', todo: 'read' });

  /** What the Odd can do now: its level, then each grant up to that level. */
  const can = $derived.by(() => {
    const lines = [LEVELS.find((l) => l.id === level)!.does];
    for (const t of TOOLS) {
      const g = grant[t.id];
      if (!g || above(g)) continue;
      for (const option of t.grants)
        if (RANK[option.id] <= RANK[g])
          lines.push(level === 'draft' && option.asks ? option.asks : option.does);
    }
    return lines;
  });

  // The lines a press just added or reworded, so only those flash once. A
  // line that stays keeps its node and its key, and never animates.
  let fresh = $state(new Set<string>());
  function change(apply: () => void) {
    const before = new Set(can);
    apply();
    fresh = new Set(can.filter((line) => !before.has(line)));
  }

  // Unselected reads as pressable (a border, hover to ink), selected is
  // filled, and a grant above the level is dashed with faint text.
  const OPTION_IDLE =
    'border-hairline bg-raise text-muted cursor-pointer hover:border-faint hover:text-ink';
  const OPTION_DISABLED = 'border-faint/40 text-faint cursor-not-allowed border-dashed';
</script>

<div class="grid items-start gap-12 lg:grid-cols-2 lg:gap-16">
  <div>
    <SectionHeader
      eyebrow="Least access"
      title="You decide how far each Odd goes."
      lede="An Odd acts for you only as far as you let it. You grant access one Odd and one tool at a time, and you can lower it or take it back whenever you like."
    />
    <ol use:stagger={{ step: 110 }} class="mt-10 space-y-6">
      {#each points as p, i (p.title)}
        <li class="flex gap-4">
          <span
            class="font-pixel text-sea border-hairline bg-raise flex size-9 shrink-0 items-center justify-center rounded-md border text-base"
            aria-hidden="true">{i + 1}</span
          >
          <div>
            <h3 class="text-ink text-lg font-semibold">{p.title}</h3>
            <p class="text-muted mt-1 text-[15px] leading-relaxed">{p.text}</p>
          </div>
        </li>
      {/each}
    </ol>
  </div>

  <div use:reveal={{ delay: 150 }} class="lg:pt-12">
    <div class="desk rounded-card border-hairline bg-panel-solid relative border p-1">
      <div class="flex items-center justify-between px-4 py-2.5">
        <div class="flex items-center gap-2">
          <p class="font-pixel text-muted text-sm tracking-wide">{NAME}'s access</p>
          <span
            class="border-hairline bg-raise text-ink inline-flex items-center gap-1 rounded-full border py-0.5 ps-1.5 pe-2 text-[11px] leading-4 font-medium"
          >
            <svg
              class="text-sea size-3 shrink-0"
              viewBox="0 0 6 9"
              shape-rendering="crispEdges"
              fill="currentColor"
              aria-hidden="true"
              ><path
                d="M0 0h1v8H0zM1 1h1v6H1zM2 2h1v4H2zM3 3h1v3H3zM4 4h1v1H4zM3 6h1v1H3zM4 7h1v2H4z"
              /></svg
            >Try it
          </span>
        </div>
        <p class="text-faint text-xs">Level: {level}</p>
      </div>
      <div class="bg-night rounded-[11px] p-5 sm:p-6">
        <div class="flex items-center gap-3">
          <div use:blinks class="blinker relative shrink-0">
            <img
              src="/art/portrait-juno.png"
              alt=""
              width="48"
              height="48"
              class="pixel rounded-md"
              draggable="false"
            />
            <img
              src="/art/portrait-juno-blink.png"
              alt=""
              aria-hidden="true"
              width="48"
              height="48"
              class="blink-frame pixel absolute inset-0 rounded-md"
              draggable="false"
            />
          </div>
          <div>
            <p class="text-ink text-xl leading-tight font-semibold">{NAME}</p>
            <p class="text-muted mt-0.5 text-sm">Keeps your notes and to-dos in order.</p>
          </div>
        </div>

        <p class="text-muted mt-5 text-sm">
          Change {NAME}'s level or a tool, and watch what {NAME} can do.
        </p>
        <p class="text-faint mt-4 text-xs font-semibold tracking-wide uppercase">Level</p>
        <div class="mt-2 grid grid-cols-3 gap-1" role="group" aria-label="{NAME}'s level">
          {#each LEVELS as l (l.id)}
            {@const on = level === l.id}
            <button
              type="button"
              aria-pressed={on}
              class="rounded-md border px-2 py-2 text-xs font-medium {on
                ? 'border-sea bg-sea text-night'
                : OPTION_IDLE}"
              onclick={() => change(() => (level = l.id))}
            >
              {l.label}
            </button>
          {/each}
        </div>

        <p class="text-faint mt-6 text-xs font-semibold tracking-wide uppercase">Tools</p>
        <ul class="mt-2 space-y-3">
          {#each TOOLS as t (t.id)}
            {@const g = grant[t.id]}
            <li class="border-hairline rounded-lg border p-3">
              <div class="flex items-baseline justify-between gap-3">
                <p class="text-ink text-sm font-semibold">
                  {t.name} <span class="text-faint text-xs font-normal">{t.from}</span>
                </p>
                {#if g}
                  <button
                    type="button"
                    class="text-faint hover:text-coral shrink-0 text-xs font-medium"
                    onclick={() => change(() => (grant[t.id] = undefined))}
                  >
                    Revoke <span class="sr-only">{t.name}</span>
                  </button>
                {/if}
              </div>
              {#if g}
                <div class="mt-2 flex gap-1" role="group" aria-label="{t.name} access">
                  {#each t.grants as option (option.id)}
                    {@const on = g === option.id}
                    {@const locked = above(option.id)}
                    <button
                      type="button"
                      aria-pressed={on}
                      disabled={locked && !on}
                      aria-describedby={locked && !on ? `lock-${t.id}-${option.id}` : undefined}
                      class="flex-1 rounded-md border px-2 py-1.5 text-xs {on
                        ? 'border-sea bg-sea-deep text-ink'
                        : locked
                          ? OPTION_DISABLED
                          : OPTION_IDLE}"
                      onclick={() => change(() => (grant[t.id] = option.id))}
                    >
                      {option.label}
                    </button>
                  {/each}
                </div>
                {#each t.grants as option (option.id)}
                  {#if above(option.id) && g !== option.id}
                    <p id="lock-{t.id}-{option.id}" class="text-faint mt-2 text-xs">
                      {option.label} needs {NAME} at {needs(option.id)} or higher.
                    </p>
                  {/if}
                {/each}
                {#if above(g)}
                  <p class="text-ember mt-2 text-xs">
                    Waits until {NAME} is back at {needs(g)} or higher.
                  </p>
                {/if}
              {:else}
                <p class="text-muted mt-1.5 text-xs">
                  Not connected. {NAME} can ask for it again.
                  <button
                    type="button"
                    class="text-sea ms-1 font-medium underline-offset-4 hover:underline"
                    onclick={() => change(() => (grant[t.id] = 'read'))}
                  >
                    Connect read only
                  </button>
                </p>
              {/if}
            </li>
          {/each}
        </ul>

        <div class="border-hairline mt-6 border-t pt-5" aria-live="polite">
          <p class="text-faint text-xs font-semibold tracking-wide uppercase">
            What {NAME} can do now
          </p>
          <ul class="isolate mt-3 space-y-2 text-[15px]">
            {#each can as line (line)}
              <li class="text-muted relative flex gap-2.5" class:fresh={fresh.has(line)}>
                <span class="text-moss shrink-0" aria-hidden="true">✓</span>{line}
              </li>
            {/each}
          </ul>
        </div>
      </div>
    </div>
    <p class="text-faint mt-3 text-center text-xs">
      This is a mock of an Odd's Settings. Nothing you press here leaves the page.
    </p>
  </div>
</div>

<style>
  .desk {
    box-shadow: var(--shadow-float);
  }

  /* A line a press just added or reworded: it rises in, and a sea-deep wash
     behind it fades out. Once, about 800ms, then still. Opacity and transform
     only; off under reduced motion. */
  .fresh {
    animation: line-in 0.8s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  }
  .fresh::before {
    content: '';
    position: absolute;
    inset: -2px -6px;
    z-index: -1;
    border-radius: 6px;
    background: var(--color-sea-deep);
    opacity: 0;
    animation: line-wash 0.9s ease-out;
  }
  @keyframes line-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.98);
    }
    40% {
      opacity: 1;
      transform: none;
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes line-wash {
    from,
    35% {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .fresh,
    .fresh::before {
      animation: none;
    }
  }
</style>
