<script lang="ts">
  // The range of what an Odd takes off your plate: every job as one line you
  // can pick, and the picked one as a job card. The card says what the Odd
  // does with the tools the office really gives it, and the least access that
  // takes. Nothing here leaves the page.
  import { JOB_ICONS } from '#lib/job-icons.ts';
  import SectionHeader from '#lib/components/SectionHeader.svelte';
  import { blinks, reveal, stagger } from '#lib/motion/index.ts';

  type Level = 'read' | 'draft' | 'act';
  type Job = {
    id: string;
    for: string;
    role: string;
    /** What the role owns, in one line, under the role's name. */
    line: string;
    portrait: 'ada' | 'theo' | 'juno';
    does: string[];
    level: Level;
    /** Each tool the Odd connects, and what it may do there: read or write. */
    tools: { name: string; can: string[] }[];
    /** A line under the tools, when the access needs one. */
    note?: string;
    you: string;
  };

  const JOBS: Job[] = [
    {
      id: 'inbox',
      for: 'managing your email inbox',
      role: 'Inbox Odd',
      line: 'Keeps your inbox down to what needs you.',
      portrait: 'ada',
      does: [
        'Reads your Gmail, once you connect it, and tells you what needs an answer.',
        'Drafts replies for you to change and send.',
        'Proposes filters that label and archive the rest.'
      ],
      level: 'read',
      tools: [{ name: 'Gmail', can: ['read'] }],
      you: 'You click Send on each reply, and Create on each filter.'
    },
    {
      id: 'drive',
      for: 'keeping your shared docs up to date',
      role: 'Docs Odd',
      line: 'Keeps the files you share with your team current.',
      portrait: 'juno',
      does: [
        'Reads the Docs and Sheets in your Google Drive, once you connect it.',
        'Adds notes and decisions to a shared Doc, and fills in your tracker Sheet.',
        'Starts a new Doc or Sheet when a project needs one.'
      ],
      level: 'draft',
      tools: [{ name: 'Google Drive', can: ['read', 'write'] }],
      note: 'At draft, each change waits for your yes.',
      you: 'You say yes to each change before your team sees it.'
    },
    {
      id: 'workouts',
      for: 'planning your workouts',
      role: 'Training Odd',
      line: 'Fits your training into the week you actually have.',
      portrait: 'theo',
      does: [
        'Writes a plan for the week around the goal you set.',
        'Pokes you in chat before each session.',
        'Plans next week from your training log, if you keep one on your computer.'
      ],
      level: 'read',
      tools: [],
      note: 'No outside tools.',
      you: 'You show up. Tell it in chat when a session moves.'
    },
    {
      id: 'dates',
      for: 'remembering the dates that matter',
      role: 'Dates Odd',
      line: 'Makes sure no birthday or anniversary sneaks up on you.',
      portrait: 'ada',
      does: [
        'Reads the birthdays and anniversaries in your people list, which stays on your computer.',
        'Pokes you in chat a week ahead, and again the day before.',
        'Drafts the note, so it is ready when you are.'
      ],
      level: 'draft',
      tools: [],
      note: 'No outside tools.',
      you: 'You send the note. The Odd never does.'
    },
    {
      id: 'news',
      for: 'keeping up with the news',
      role: 'News Odd',
      line: 'Keeps you current on what you follow, without the scroll.',
      portrait: 'theo',
      does: [
        'Searches the web for the topics you follow, once you turn on Browse the web for it.',
        'Leaves you a short brief each morning, with links.'
      ],
      level: 'read',
      tools: [],
      note: 'No outside tools. It searches with its own.',
      you: 'You read one brief. Nothing goes out.'
    },
    {
      id: 'bills',
      for: 'bills and renewals',
      role: 'Bills Odd',
      line: 'Keeps every bill and renewal in view before it is due.',
      portrait: 'juno',
      does: [
        'Lists what is due and when, from what you tell it in chat.',
        'Pokes you in chat before each due date.'
      ],
      level: 'read',
      tools: [],
      note: 'No outside tools.',
      you: 'You pay. The Odd never touches the payment.'
    },
    {
      id: 'tools',
      for: 'the app your work lives in',
      role: 'Any Odd',
      line: 'Works in the app you already use, once you say yes.',
      portrait: 'juno',
      does: [
        'Finds the app in the public MCP Registry and asks you for it.',
        'Works in it once you connect it: read only, or read and write.',
        'Changes things in it only with write: at draft each change waits for your yes, at act it goes ahead.'
      ],
      level: 'read',
      tools: [{ name: 'Your tool', can: ['read'] }],
      note: 'Write needs the draft level or higher.',
      you: 'You approve the tool, sign in yourself, and can take it back any time.'
    }
  ];

  const LEVELS: Level[] = ['read', 'draft', 'act'];
  // One colour for every level: the number of lit pills says the level, so no
  // level reads as better or worse, and green, amber and coral keep the status
  // meanings they have in the office.
  const LEVEL: Record<Level, { label: string }> = {
    read: { label: 'Read' },
    draft: { label: 'Draft' },
    act: { label: 'Act' }
  };

  let picked = $state(JOBS[0].id);
  const job = $derived(JOBS.find((j) => j.id === picked)!);
</script>

{#snippet panel(j: Job, cls: string, live = false)}
  <div class="bg-night rounded-[11px] p-5 [grid-area:1/1] sm:p-6 {cls}">
    <div class="flex items-center gap-3">
      {#if live}
        <!-- Only the picked panel blinks; the unseen sizing copies run nothing. -->
        <div use:blinks class="blinker relative shrink-0">
          <img
            src="/art/portrait-{j.portrait}.png"
            alt=""
            width="48"
            height="48"
            class="pixel rounded-md"
            draggable="false"
          />
          <img
            src="/art/portrait-{j.portrait}-blink.png"
            alt=""
            aria-hidden="true"
            width="48"
            height="48"
            class="blink-frame pixel absolute inset-0 rounded-md"
            draggable="false"
          />
        </div>
      {:else}
        <img
          src="/art/portrait-{j.portrait}.png"
          alt=""
          width="48"
          height="48"
          class="pixel rounded-md"
          draggable="false"
        />
      {/if}
      <div>
        <p class="text-ink text-xl leading-tight font-semibold">{j.role}</p>
        <p class="text-muted mt-0.5 text-sm">{j.line}</p>
      </div>
    </div>

    <p class="text-faint mt-6 text-xs font-semibold tracking-wide uppercase">What it does</p>
    <ol class="mt-3 space-y-2.5 text-[15px]">
      {#each j.does as line, i (line)}
        <li class="text-muted flex gap-3">
          <span class="font-pixel text-sea w-4 shrink-0" aria-hidden="true">{i + 1}</span>{line}
        </li>
      {/each}
    </ol>

    <dl class="border-hairline mt-6 space-y-3 border-t pt-5 text-[15px]">
      <div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
        <dt class="text-faint w-28 shrink-0 text-xs font-semibold tracking-wide uppercase">
          Access
        </dt>
        <dd class="flex flex-col items-start gap-2.5">
          <!-- The same shape on every card: the three levels as pills, lit up to the
               Odd's own (filled, not just coloured), then one chip per tool. -->
          <p class="flex gap-1.5">
            <span class="sr-only">{LEVEL[j.level].label} level</span>
            {#each LEVELS as l, k (l)}
              {@const lit = k <= LEVELS.indexOf(j.level)}
              <span
                class="rounded-md border px-2.5 py-0.5 text-xs font-semibold {lit
                  ? 'border-sea bg-sea text-night'
                  : 'border-hairline text-faint'}"
                aria-hidden="true">{LEVEL[l].label}</span
              >
            {/each}
          </p>
          {#if j.tools.length}
            <ul class="flex flex-wrap gap-2" aria-label="Tools">
              {#each j.tools as t (t.name)}
                <li
                  class="border-hairline bg-raise flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"
                >
                  <span class="text-ink font-semibold">{t.name}</span>
                  <span class="text-muted">{t.can.join(', ')}</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if j.note}<p class="text-faint text-sm">{j.note}</p>{/if}
        </dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
        <dt class="text-faint w-28 shrink-0 text-xs font-semibold tracking-wide uppercase">
          Your part
        </dt>
        <dd class="text-muted">{j.you}</dd>
      </div>
    </dl>
  </div>
{/snippet}

<SectionHeader
  eyebrow="Hire an Odd"
  title="Hire Odds for everything you want off your plate."
  lede="Each Odd is an AI worker with one job. Pick a job to see what that Odd does and the access it needs."
/>

<div
  class="mt-12 grid items-start gap-8 lg:items-center lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12"
>
  <!-- The list hangs into the gutter by one row's start padding and border,
       so the row's icon sits on the header's edge and only the highlight reaches
       past it. On a phone the focus ring sits on the row edge, inside the 16px gutter.
       Wider, it keeps the usual 3px offset, which the gutter has room for. -->
  <ul
    use:stagger={{ step: 60 }}
    class="-ms-[calc(--spacing(3)+1px)] space-y-1"
    aria-label="Jobs an Odd can take"
  >
    {#each JOBS as j (j.id)}
      {@const on = picked === j.id}
      <li>
        <button
          type="button"
          aria-pressed={on}
          aria-controls="hire-card"
          class="flex w-full items-start gap-3 rounded-lg border py-3 ps-3 pe-4 text-start text-[15px] leading-6 max-sm:focus-visible:outline-offset-0! {on
            ? 'border-sea bg-raise'
            : 'hover:bg-raise border-transparent'}"
          onclick={() => (picked = j.id)}
        >
          <!-- The icon leads the row on the header's edge. At 24px it is two
               screen pixels per art pixel, and one line tall, so it centres on
               the first line and wrapped lines align with the text. -->
          <svg
            width="24"
            height="24"
            viewBox="0 0 12 12"
            class="shrink-0 {on ? 'text-sea' : 'text-icon'}"
            aria-hidden="true"
            shape-rendering="crispEdges"
          >
            <path d={JOB_ICONS[j.id]} fill="currentColor" />
          </svg>
          <span>
            <span class="text-muted">Hire an Odd for</span>
            <span class="text-ink font-semibold">{j.for}.</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>

  <div use:reveal={{ delay: 120 }}>
    <article
      id="hire-card"
      class="card rounded-card border-hairline bg-panel-solid border p-1"
      aria-live="polite"
    >
      <div class="flex items-center justify-between px-4 py-2.5">
        <p class="font-pixel text-muted text-sm tracking-wide">Job card</p>
        <p class="text-xs">
          <span class="text-faint">Least access:</span>
          <span class="text-sea font-semibold">{LEVEL[job.level].label}</span>
        </p>
      </div>
      <!-- Every job's panel sits unseen in the same cell at lg, so the cell is as
           tall as the tallest job and the list, centred on it, never moves.
           The picked panel stretches to that height with its content at the top,
           so the card keeps one size. Below lg the list is not centred on the
           card, so the card keeps its own height there. -->
      <div class="grid">
        {#each JOBS as j (j.id)}
          <div class="invisible hidden [grid-area:1/1] lg:grid" aria-hidden="true" inert>
            {@render panel(j, '')}
          </div>
        {/each}
        {#key job.id}
          {@render panel(job, 'pop-in', true)}
        {/key}
      </div>
    </article>
  </div>
</div>

<style>
  .card {
    box-shadow: var(--shadow-float);
  }
</style>
