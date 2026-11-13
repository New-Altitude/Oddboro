<script lang="ts">
  // An Odd's home on its info page: the room it lives in and its own seat
  // there. Change opens the rooms and their seats; Save moves it, and it walks
  // to the new seat the next time it works. Another Odd's seat is shown as
  // theirs and cannot be picked.
  import { call } from './api.ts';
  import type { StaffProfile } from '../staff/roster.ts';
  import type { HomeRoom } from '../staff/home.ts';

  type Props = { profile: StaffProfile; homes: HomeRoom[] };
  let { profile, homes }: Props = $props();

  const here = $derived(homes.find((r) => r.id === profile.room));
  const seatNow = $derived(here?.seats.find((s) => s.id === profile.seat));

  let changing = $state(false);
  let room = $state('');
  let seat = $state('');
  let busy = $state(false);
  let problem = $state('');
  const seats = $derived(homes.find((r) => r.id === room)?.seats ?? []);
  const free = (id: string) => (s: HomeRoom['seats'][number]) => !s.owner || s.owner.id === id;

  function open() {
    room = profile.room;
    seat = profile.seat ?? '';
    problem = '';
    changing = true;
  }

  /** A new room starts on its first free seat. */
  function pickRoom(id: string) {
    room = id;
    seat = homes.find((r) => r.id === id)?.seats.find(free(profile.id))?.id ?? '';
  }

  async function save() {
    busy = true;
    problem = '';
    try {
      await call(`/api/staff/${profile.id}/home`, { room, seat: seat || null }, 'PUT');
      changing = false;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<section aria-label="Home">
  <div class="flex items-center justify-between">
    <h3 class="text-xs font-semibold text-ink">Home</h3>
    {#if !changing && homes.length}
      <button class="text-xs text-sea hover:underline" onclick={open}>Change</button>
    {/if}
  </div>
  <p class="mt-1 text-xs text-muted">
    {here?.name ?? profile.room}{seatNow ? `, ${seatNow.label}` : ', any free seat'}{here?.wing
      ? ` · ${here.wing} wing`
      : ''}
  </p>
  {#if changing}
    <div class="mt-2 flex flex-col gap-2 rounded-xl bg-raise p-3">
      <div class="grid grid-cols-2 gap-1.5">
        {#each homes as r (r.id)}
          <button
            class="rounded-lg px-2.5 py-1.5 text-start text-xs {room === r.id
              ? 'bg-sea/25 ring-1 ring-sea'
              : 'bg-night/40'}"
            onclick={() => pickRoom(r.id)}>{r.name}</button
          >
        {/each}
      </div>
      {#if seats.length}
        <div class="text-[11px] text-muted">Seat</div>
        <div class="flex flex-wrap gap-1.5">
          {#each seats as s (s.id)}
            {@const theirs = s.owner && s.owner.id !== profile.id}
            <button
              class="rounded-lg px-2.5 py-1 text-xs disabled:opacity-50 {seat === s.id
                ? 'bg-sea/25 ring-1 ring-sea'
                : 'bg-night/40'}"
              disabled={!!theirs}
              onclick={() => (seat = s.id)}>{s.label}{theirs ? ` · ${s.owner!.name}` : ''}</button
            >
          {/each}
          <button
            class="rounded-lg px-2.5 py-1 text-xs {seat === ''
              ? 'bg-sea/25 ring-1 ring-sea'
              : 'bg-night/40'}"
            onclick={() => (seat = '')}>Any free seat</button
          >
        </div>
      {/if}
      {#if problem}<p class="text-xs text-ember">{problem}</p>{/if}
      <div class="flex justify-end gap-2">
        <button class="rounded-lg px-3 py-1.5 text-xs text-muted" onclick={() => (changing = false)}
          >Cancel</button
        >
        <button
          class="rounded-lg bg-sea/25 px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
          disabled={busy || !room}
          onclick={save}>Save</button
        >
      </div>
    </div>
  {/if}
</section>
