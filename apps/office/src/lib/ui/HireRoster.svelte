<script lang="ts">
  import type { AgentSource } from '@oddboro/ledger/agents';
  import type { ComponentProps } from 'svelte';
  import type { StaffProfile } from '../staff/roster.ts';
  import HireDrawer from './HireDrawer.svelte';
  import { wins } from './windows.svelte.ts';

  let props: Omit<
    ComponentProps<typeof HireDrawer>,
    'file' | 'format' | 'onfiles' | 'onskip' | 'onupdated'
  > = $props();
  let format = $state<AgentSource['format']>('claude');
  let files = $state<File[]>([]);
  let index = $state(0);
  let hired = $state<StaffProfile[]>([]);
  let updated = $state(0);
  let skipped = $state(0);
  // A hire can finish before the office's next roster update reaches the page.
  const staff = $derived([
    ...props.staff,
    ...hired.filter((p) => !props.staff.some((s) => s.id === p.id))
  ]);

  function next() {
    index++;
    if (index === files.length) {
      wins.titles[props.id] = 'Roster reviewed';
      wins.dirty[props.id] = false;
    }
  }

  function joined(p: StaffProfile) {
    if (!files.length) return props.onhired(p);
    hired.push(p);
    next();
  }
</script>

{#if files.length && index === files.length}
  <section class="flex flex-col items-start gap-3 p-3 text-sm" aria-label="Roster reviewed">
    <p>{hired.length} hired · {updated} updated · {skipped} skipped</p>
    <button class="rounded-lg bg-sea px-3 py-2 text-night" onclick={props.ondone}>Done</button>
  </section>
{:else}
  <div class="flex h-full min-h-0 flex-col">
    {#if files.length}
      <p class="border-b border-hairline px-3 py-2 text-xs text-muted">
        File {index + 1} of {files.length}: {files[index].name}
      </p>
    {/if}
    <div class="flex min-h-0 flex-1 flex-col">
      {#key files[index]}
        <HireDrawer
          {...props}
          {staff}
          file={files[index]}
          {format}
          onfiles={(picked, source) => {
            format = source;
            files = picked;
          }}
          onhired={joined}
          onskip={() => {
            skipped++;
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
  </div>
{/if}
