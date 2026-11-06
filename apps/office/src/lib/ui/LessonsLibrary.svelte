<script lang="ts">
  // Everything the office knows about the owner, in one place: the lessons for
  // every Odd, the lessons one Odd follows, or all of them, searchable on the
  // page. Guesses waiting for the owner's Keep come first, and each names the
  // Odd that heard it, with the same controls as in that Odd's chat and
  // Lessons tab.
  import type { LibraryLesson } from '@oddboro/ledger';
  import Lesson from './Lesson.svelte';
  import { call } from './api.ts';
  import type { StaffProfile } from '../staff/roster.ts';
  import type { LessonsFilter } from './windows.svelte.ts';

  type Shown = LibraryLesson & { heardByName: string };
  type Props = { staff: StaffProfile[]; version: number; filter: LessonsFilter };
  let { staff, version, filter = $bindable() }: Props = $props();

  let lessons = $state<Shown[]>([]);
  let loaded = $state(false);
  let problem = $state('');
  let query = $state('');

  $effect(() => {
    void version;
    call<Shown[]>('/api/lessons')
      .then((l) => {
        lessons = l;
        problem = '';
      })
      .catch((e) => (problem = e instanceof Error ? e.message : String(e)))
      .finally(() => (loaded = true));
  });

  const keyOf = (f: LessonsFilter) => (typeof f === 'object' ? `odd:${f.staff}` : f);
  const choices = $derived<{ label: string; filter: LessonsFilter }[]>([
    { label: 'About you', filter: 'about' },
    ...staff.map((s) => ({ label: s.name, filter: { staff: s.id } })),
    { label: 'All', filter: 'all' }
  ]);
  /** The Odd whose lessons show: what it follows, with its own uses. */
  const odd = $derived(typeof filter === 'object' ? filter.staff : undefined);
  const oddName = $derived(staff.find((s) => s.id === odd)?.name ?? odd);

  /**
   * The lessons the filter and the search leave, each with the uses the filter
   * counts: the one Odd's, else every Odd's together.
   */
  const shown = $derived.by(() => {
    const words = query.trim().toLowerCase();
    return lessons
      .filter((l) => filter === 'all' || !l.staffId || l.staffId === odd)
      .filter(
        (l) =>
          !words ||
          [l.text, l.quote, l.appliesTo ?? ''].some((t) => t.toLowerCase().includes(words))
      )
      .map((l) => (odd ? { ...l, ...(l.usesBy[odd] ?? { uses: 0, lastUsedAt: null }) } : l));
  });
  const groups = $derived([
    { label: 'Waiting for your Keep', lessons: shown.filter((l) => l.status === 'waiting') },
    { label: 'Kept', lessons: shown.filter((l) => l.status !== 'waiting') }
  ]);
</script>

<div class="flex h-full flex-col">
  <div class="flex flex-col gap-2 border-b border-hairline p-3">
    <input
      type="search"
      class="w-full rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint focus:ring-1 focus:ring-sea/60"
      placeholder="Find a lesson by its words or where it applies"
      aria-label="Find a lesson"
      bind:value={query}
    />
    <div class="flex flex-wrap gap-1" role="group" aria-label="Whose lessons">
      {#each choices as c (keyOf(c.filter))}
        <button
          class="rounded-full px-2.5 py-0.5 text-xs {keyOf(filter) === keyOf(c.filter)
            ? 'bg-sea/30 text-ink'
            : 'bg-raise text-muted hover:text-ink'}"
          aria-pressed={keyOf(filter) === keyOf(c.filter)}
          onclick={() => (filter = c.filter)}>{c.label}</button
        >
      {/each}
    </div>
  </div>
  <div class="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
    {#if problem}
      <p class="text-sm text-coral">{problem}</p>
    {:else if loaded && !shown.length}
      <p class="m-auto max-w-[260px] text-center text-sm text-muted">
        {#if query.trim()}
          No lesson here says that.
        {:else if odd}
          Correct {oddName} once, in chat or in a reason on an ask, and it keeps the lesson here.
        {:else}
          Tell any Odd how the whole office should work, like how much to do without checking with
          you, and it shows here. Every Odd follows it from then on.
        {/if}
      </p>
    {/if}
    {#each groups as g (g.label)}
      {#if g.lessons.length}
        <h3 class="text-[11px] text-muted">{g.label}</h3>
        {#each g.lessons as l (l.id)}
          <div class="flex flex-col gap-1">
            <p class="ms-1 text-xs text-faint">{l.heardByName} heard this</p>
            <Lesson lesson={l} name={l.heardByName} />
          </div>
        {/each}
      {/if}
    {/each}
  </div>
</div>
