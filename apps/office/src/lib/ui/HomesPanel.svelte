<script lang="ts">
  // Where every Odd lives, in one window. Each row is an Odd with its room and
  // seat, both changeable. Ask the office reads every Odd's role and remit and
  // fills each row with the home it recommends and why; nothing moves until
  // Save homes, which moves every changed Odd at once, so two can swap seats.
  // Odds are grouped by the wing their room is in, and Wings names each room's.
  import Pixel from './Pixel.svelte';
  import { call } from './api.ts';
  import type { StaffProfile } from '../staff/roster.ts';
  import type { HomeRoom } from '../staff/home.ts';

  type Props = {
    staff: StaffProfile[];
    homes: HomeRoom[];
    /** Called just before a room is added, so the page keeps this window open through the move. */
    onaddroom: () => void;
  };
  let { staff, homes, onaddroom }: Props = $props();

  /** The Add a room form: a workspace with desks, or a meeting room, where the owner places it. */
  let kind = $state<'workspace' | 'meeting'>('workspace');
  let roomName = $state('');
  let desks = $state(4);
  let side = $state<'' | 'west' | 'east'>('');
  let row = $state<'' | 'back' | 'front'>('');
  let adding = $state(false);
  async function addRoom() {
    adding = true;
    problem = '';
    saved = '';
    onaddroom();
    try {
      await call('/api/rooms', {
        kind,
        name: roomName,
        seats: desks,
        ...(side ? { side } : {}),
        ...(row ? { row } : {})
      });
      saved = `Added ${roomName.trim()}. Everyone kept their home.`;
      roomName = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      adding = false;
    }
  }

  type Row = { room: string; seat: string; why?: string; by?: 'office' | 'rules' };
  /** The owner's draft, by Odd id. An Odd without one shows where it lives now. */
  let draft = $state<Record<string, Row>>({});
  const rowOf = (p: StaffProfile): Row => draft[p.id] ?? { room: p.room, seat: p.seat ?? '' };
  const changed = $derived(
    staff.filter((p) => {
      const r = rowOf(p);
      return r.room !== p.room || r.seat !== (p.seat ?? '');
    })
  );
  /** Whose seat each is in the draft, so no two Odds pick the same one. */
  const seatHolder = $derived(
    Object.fromEntries(
      staff.map((p) => [rowOf(p).seat, p.id] as const).filter(([seat]) => seat)
    ) as Record<string, string>
  );

  let asking = $state(false);
  let saving = $state(false);
  let problem = $state('');
  let saved = $state('');
  /** Why the office's own picks are missing, when the rules filled in. */
  let note = $state('');

  function set(id: string, row: Row) {
    draft[id] = row;
    saved = '';
  }
  /** A new room starts on its first seat nobody else holds in the draft. */
  function pickRoom(p: StaffProfile, room: string) {
    const free = homes
      .find((r) => r.id === room)
      ?.seats.find((s) => !seatHolder[s.id] || seatHolder[s.id] === p.id);
    set(p.id, { room, seat: free?.id ?? '' });
  }

  async function ask() {
    asking = true;
    problem = '';
    try {
      const r = await call<{ homes: (Row & { id: string })[]; note?: string }>('/api/homes', {});
      note = r.note ?? '';
      for (const h of r.homes)
        draft[h.id] = { room: h.room, seat: h.seat ?? '', why: h.why, by: h.by };
      saved = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      asking = false;
    }
  }

  const COMMON = '';
  /** Every wing named so far, for the wing fields to offer. */
  const wingNames = $derived([...new Set(homes.flatMap((r) => (r.wing ? [r.wing] : [])))]);
  /** The Odds by the wing of the room they live in now, named wings first. */
  const groups = $derived.by(() => {
    const wingOf = (p: StaffProfile) => homes.find((r) => r.id === p.room)?.wing ?? COMMON;
    return [...wingNames, COMMON]
      .map((wing) => ({ wing, odds: staff.filter((p) => wingOf(p) === wing) }))
      .filter((g) => g.odds.length);
  });

  /** Put a room in a wing, or none. The office reloads with it. */
  async function setWing(r: HomeRoom, wing: string) {
    problem = '';
    try {
      await call('/api/rooms/wing', { room: r.place, wing }, 'PUT');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  async function save() {
    saving = true;
    problem = '';
    try {
      const moves = changed.map((p) => ({ id: p.id, ...rowOf(p) }));
      await call(
        '/api/homes',
        { homes: moves.map(({ id, room, seat }) => ({ id, room, seat })) },
        'PUT'
      );
      saved = moves.length === 1 ? 'Moved 1 Odd.' : `Moved ${moves.length} Odds.`;
      draft = {};
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      saving = false;
    }
  }
</script>

{#snippet oddRow(p: StaffProfile)}
  {@const row = rowOf(p)}
  {@const seats = homes.find((r) => r.id === row.room)?.seats ?? []}
  {@const moved = changed.includes(p)}
  <li class="flex gap-3 rounded-xl px-2 py-2.5" class:bg-raise={moved}>
    <div class="size-10 shrink-0 overflow-hidden rounded-lg">
      <Pixel
        src={p.look?.portrait}
        frame={`${p.portrait}/default`}
        fallback={`${p.sprite}@${p.variant}/idle-down-0`}
        scale={1}
        label={`Portrait of ${p.name}`}
        class="block"
      />
    </div>
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm text-ink">
        {p.name} <span class="text-xs text-muted">· {p.role}</span>
      </div>
      <div class="mt-1.5 flex gap-1.5">
        <select
          class="min-w-0 flex-1 rounded-lg bg-night/40 px-2 py-1 text-xs text-ink"
          aria-label={`${p.name}'s room`}
          value={row.room}
          onchange={(e) => pickRoom(p, e.currentTarget.value)}
        >
          {#each homes as r (r.id)}
            <option value={r.id}>{r.name}</option>
          {/each}
        </select>
        <select
          class="min-w-0 flex-1 rounded-lg bg-night/40 px-2 py-1 text-xs text-ink"
          aria-label={`${p.name}'s seat`}
          value={row.seat}
          onchange={(e) => set(p.id, { ...row, seat: e.currentTarget.value })}
        >
          <option value="">Any free seat</option>
          {#each seats as s (s.id)}
            {@const holder = seatHolder[s.id]}
            {@const other = holder && holder !== p.id}
            <option value={s.id} disabled={!!other}
              >{s.label}{other
                ? ` · ${staff.find((x) => x.id === holder)?.name ?? ''}`
                : ''}</option
            >
          {/each}
        </select>
      </div>
      {#if row.why}
        <p class="mt-1 text-[11px] text-muted">
          {row.by === 'office' ? 'The office:' : 'Suggested:'}
          {row.why}
        </p>
      {/if}
    </div>
  </li>
{/snippet}

<div class="flex h-full flex-col">
  <div class="border-b border-hairline p-3">
    <div class="text-sm font-medium">Where everyone lives</div>
    <p class="mt-0.5 text-xs text-muted">
      Each Odd works at its own seat. Ask the office for a home that fits each one's role, then
      change anything before you save.
    </p>
    <div class="mt-2 flex gap-2">
      <button
        class="flex-1 rounded-lg bg-raise px-3 py-1.5 text-xs text-ink hover:bg-sea/20 disabled:opacity-50"
        disabled={asking || !staff.length || !homes.length}
        onclick={ask}>{asking ? 'Asking the office…' : 'Ask the office'}</button
      >
      <button
        class="flex-1 rounded-lg bg-sea/25 px-3 py-1.5 text-xs font-medium text-ink disabled:opacity-50"
        disabled={saving || !changed.length}
        onclick={save}
        >{saving
          ? 'Saving…'
          : changed.length
            ? `Save homes (${changed.length})`
            : 'Save homes'}</button
      >
    </div>
    {#if problem}<p class="mt-2 text-xs text-ember">{problem}</p>{/if}
    {#if note}<p class="mt-2 text-xs text-muted">{note}</p>{/if}
    {#if saved}<p class="mt-2 text-xs text-sea">{saved}</p>{/if}
  </div>
  <div class="flex-1 overflow-y-auto p-2">
    <details class="mb-2 rounded-xl bg-raise/60 px-3 py-2">
      <summary class="cursor-pointer text-xs font-medium text-ink">Wings</summary>
      <p class="mt-1 text-[11px] text-muted">
        A wing groups rooms for one part of your life, like Work, School or Hobbies. Name any wing
        you like. A room in no wing is common space every Odd uses.
      </p>
      <datalist id="wing-names">
        {#each wingNames as w (w)}<option value={w}></option>{/each}
      </datalist>
      <div class="mt-2 flex flex-col gap-1.5">
        {#each homes as r (r.id)}
          <label class="flex items-center gap-2 text-xs">
            <span class="w-28 shrink-0 truncate text-ink">{r.name}</span>
            <input
              class="min-w-0 flex-1 rounded-lg bg-night/40 px-2 py-1 text-ink"
              list="wing-names"
              maxlength="24"
              placeholder="Common space"
              value={r.wing ?? ''}
              onchange={(e) => setWing(r, e.currentTarget.value)}
            />
          </label>
        {/each}
      </div>
    </details>
    <details class="mb-2 rounded-xl bg-raise/60 px-3 py-2">
      <summary class="cursor-pointer text-xs font-medium text-ink">Add a room</summary>
      <div class="mt-2 flex flex-col gap-2 text-xs">
        <div class="flex gap-2">
          <label class="flex flex-1 flex-col gap-1">
            <span class="text-muted">Kind</span>
            <select class="rounded-lg bg-night/40 px-2 py-1.5 text-ink" bind:value={kind}>
              <option value="workspace">Workspace, with desks</option>
              <option value="meeting">Meeting room</option>
            </select>
          </label>
          {#if kind === 'workspace'}
            <label class="flex w-20 flex-col gap-1">
              <span class="text-muted">Desks</span>
              <input
                class="rounded-lg bg-night/40 px-2 py-1.5 text-ink"
                type="number"
                min="1"
                max="12"
                bind:value={desks}
              />
            </label>
          {/if}
        </div>
        <label class="flex flex-col gap-1">
          <span class="text-muted">Name</span>
          <input
            class="rounded-lg bg-night/40 px-2 py-1.5 text-ink"
            maxlength="24"
            placeholder={kind === 'meeting' ? 'Huddle' : 'Product team'}
            bind:value={roomName}
          />
        </label>
        <div class="flex gap-2">
          <label class="flex flex-1 flex-col gap-1">
            <span class="text-muted">Which end</span>
            <select class="rounded-lg bg-night/40 px-2 py-1.5 text-ink" bind:value={side}>
              <option value="">Wherever it fits</option>
              <option value="west">West end</option>
              <option value="east">East end</option>
            </select>
          </label>
          <label class="flex flex-1 flex-col gap-1">
            <span class="text-muted">Which row</span>
            <select class="rounded-lg bg-night/40 px-2 py-1.5 text-ink" bind:value={row}>
              <option value="">Either</option>
              <option value="back">Back row</option>
              <option value="front">Front row, by the street</option>
            </select>
          </label>
        </div>
        <p class="text-faint">
          The office adds it at once. Every room and seat keeps its place and its Odd. On Main
          Street, the office first becomes your own, with the same rooms.
        </p>
        <button
          class="self-end rounded-lg bg-sea/25 px-3 py-1.5 font-medium text-ink disabled:opacity-50"
          disabled={adding || !roomName.trim()}
          onclick={addRoom}>{adding ? 'Adding…' : 'Add room'}</button
        >
      </div>
    </details>
    {#each groups as g (g.wing)}
      <h3 class="px-2 pt-2 pb-1 font-pixel text-[11px] tracking-[0.18em] text-faint uppercase">
        {g.wing === COMMON ? 'Common space' : `${g.wing} wing`}
      </h3>
      <ul>
        {#each g.odds as p (p.id)}
          {@render oddRow(p)}
        {/each}
      </ul>
    {/each}
  </div>
</div>
