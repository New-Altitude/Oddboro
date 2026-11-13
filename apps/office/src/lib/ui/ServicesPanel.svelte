<script lang="ts">
  // The Services window: every outside service in the office, whether it is
  // connected, and which Odds hold it at what level. A click on an Odd opens
  // its card, where its own Services tab grants and revokes. Each service can
  // be renamed here, and an AWS tool moved to another role or Region.
  import type { OfficeService } from '@oddboro/ledger';
  import { GRANT_LABEL, type GrantLevel } from '@oddboro/ledger/access';
  import { call } from './api.ts';
  import Pixel from './Pixel.svelte';
  import ServiceActions from './ServiceActions.svelte';
  import ServiceName from './ServiceName.svelte';
  import type { StaffProfile } from '../staff/roster.ts';

  type Props = { staff: StaffProfile[]; version: number; onstaff: (id: string) => void };
  let { staff, version, onstaff }: Props = $props();

  let list = $state<OfficeService[] | undefined>();
  let problem = $state('');
  let find = $state('');

  $effect(() => {
    void version;
    call<OfficeService[]>('/api/services')
      .then((r) => {
        list = r;
        problem = '';
      })
      .catch((e) => (problem = e instanceof Error ? e.message : String(e)));
  });

  const shown = $derived(
    (list ?? []).filter((s) => {
      const f = find.trim().toLowerCase();
      return (
        !f ||
        s.name.toLowerCase().includes(f) ||
        s.odds.some((o) => o.name.toLowerCase().includes(f))
      );
    })
  );
  const profile = (id: string) => staff.find((p) => p.id === id);
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex-1 overflow-y-auto p-3">
    <input
      class="mb-3 w-full rounded-lg bg-raise px-2.5 py-1.5 text-sm outline-none placeholder:text-faint"
      type="search"
      aria-label="Find a service or an Odd"
      placeholder="Find a service or an Odd"
      autocomplete="off"
      spellcheck="false"
      bind:value={find}
    />
    {#if list && !list.length}
      <p class="py-10 text-center text-sm text-muted">
        No services yet. Give an Odd one from its Settings tab, under Services.
      </p>
    {:else if list && !shown.length}
      <p class="py-4 text-center text-sm text-muted">Nothing here matches "{find.trim()}".</p>
    {/if}
    <ul class="flex flex-col gap-2">
      {#each shown as s (s.id)}
        <li class="rounded-xl bg-raise p-3 text-sm">
          <div class="flex items-center gap-2">
            <div class="min-w-0 flex-1"><ServiceName id={s.id} name={s.name} /></div>
            <span class="shrink-0 text-[11px] {s.ready ? 'text-moss' : 'text-ember'}"
              >{s.ready ? 'Connected' : 'Waiting on your steps'}</span
            >
          </div>
          <p class="mt-0.5 line-clamp-2 text-xs text-muted">{s.description}</p>
          {#if s.odds.length}
            <ul class="mt-2 flex flex-wrap gap-1.5" aria-label="Odds that use {s.name}">
              {#each s.odds as o (o.id)}
                {@const p = profile(o.id)}
                <li>
                  <button
                    class="flex items-center gap-1.5 rounded-lg bg-night/40 py-1 ps-1 pe-2 text-start hover:bg-sea/15"
                    title={`Open ${o.name}'s card`}
                    onclick={() => onstaff(o.id)}
                  >
                    {#if p}
                      <Pixel
                        src={p.look?.portrait}
                        frame={`${p.portrait}/default`}
                        fallback={`${p.sprite}@${p.variant}/idle-down-0`}
                        scale={1}
                        label={p.name}
                        class="flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md bg-sea-deep"
                      />
                    {/if}
                    <span>
                      <span class="block text-xs text-ink">{o.name}</span>
                      <span class="block text-[10px] text-muted"
                        >{GRANT_LABEL[o.level as GrantLevel] ?? o.level}</span
                      >
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="mt-2 text-xs text-faint">No Odd uses it now.</p>
          {/if}
          {#if s.aws && s.ready}<ServiceActions id={s.id} />{/if}
        </li>
      {/each}
    </ul>
    {#if problem}
      <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
    {/if}
  </div>
</div>
