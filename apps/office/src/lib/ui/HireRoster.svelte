<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import type { StaffProfile } from '../staff/roster.ts';
  import HireDrawer from './HireDrawer.svelte';
  import { wins } from './windows.svelte.ts';

  // Hire, for one agent file or several. Several open the same hire window one
  // file at a time; each hire or update saves as it happens, and Skip leaves a
  // file out. A file an Odd came from offers that Odd first, as a single import does.
  let props: Omit<
    ComponentProps<typeof HireDrawer>,
    'file' | 'place' | 'onfiles' | 'onskip' | 'onupdated'
  > = $props();
  let files = $state<File[]>([]);
  let index = $state(0);
  let hired = $state<StaffProfile[]>([]);
  let updated = $state(0);
  let upToDate = $state(0);
  let skipped = $state(0);
  // A hire can finish before the office's next roster update reaches the page,
  // and a later file from the same agent should still find it.
  const staff = $derived([
    ...props.staff,
    ...hired.filter((p) => !props.staff.some((s) => s.id === p.id))
  ]);

  /** The end count, such as "1 hired · 1 already up to date", leaving out any zero. */
  const count = $derived(
    (
      [
        [hired.length, 'hired'],
        [updated, 'updated'],
        [upToDate, 'already up to date'],
        [skipped, 'skipped']
      ] as const
    )
      .filter(([n]) => n)
      .map(([n, what]) => `${n} ${what}`)
      .join(' · ')
  );

  function next() {
    index++;
    if (index === files.length) {
      wins.titles[props.id] = 'Agent files reviewed';
      wins.dirty[props.id] = false;
    }
  }
</script>

{#if files.length && index === files.length}
  <section class="flex flex-col items-start gap-3 p-3 text-sm" aria-label="Agent files reviewed">
    <p>{count}</p>
    <button class="rounded-lg bg-sea px-3 py-2 text-night" onclick={props.ondone}>Done</button>
  </section>
{:else}
  <div class="flex h-full min-h-0 flex-col">
    {#key files[index]}
      <HireDrawer
        {...props}
        {staff}
        file={files[index]}
        place="File {index + 1} of {files.length}"
        onfiles={(picked) => (files = picked)}
        onhired={(p) => {
          if (!files.length) return props.onhired(p);
          hired.push(p);
          next();
        }}
        onskip={(current) => {
          if (current) upToDate++;
          else skipped++;
          next();
        }}
        onupdated={files.length
          ? () => {
              updated++;
              next();
            }
          : undefined}
      />
    {/key}
  </div>
{/if}
