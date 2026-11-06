<script lang="ts">
  import type { Candidate, HeldBack } from '@oddboro/ledger';
  import { OFFICE_TOOLS } from '@oddboro/ledger/tools';
  import { call } from './api.ts';
  import RunsOn from './RunsOn.svelte';
  import type { StaffProfile } from '../staff/roster.ts';

  type Grant = {
    connector: string;
    name: string;
    level: 'read' | 'act';
    /** What a run reaches, like "3 tools" or "every tool". */
    reach: string;
    heldBack: HeldBack | null;
  };
  type Own = { id: string; name: string; description: string; kind: string; ready: boolean };
  type Props = { profile: StaffProfile; version: number };
  let { profile, version }: Props = $props();

  let grants = $state<Grant[]>([]);
  let adding = $state(false);
  let q = $state('');
  let found = $state<{ catalog: Own[]; registry: Candidate[]; problem?: string }>({
    catalog: [],
    registry: []
  });
  let pick = $state<{ id: string; name: string; kind: string } | undefined>();
  let level = $state<'read' | 'act'>('read');
  let problem = $state('');
  let done = $state('');

  $effect(() => {
    void version;
    call<Grant[]>(`/api/staff/${profile.id}/access`)
      .then((g) => (grants = g))
      .catch(() => {});
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!adding) return;
    const query = q;
    clearTimeout(timer);
    timer = setTimeout(() => {
      call<typeof found>(`/api/connectors?q=${encodeURIComponent(query)}`)
        .then((r) => (found = r))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  });

  async function grant() {
    if (!pick) return;
    problem = '';
    try {
      await call(`/api/staff/${profile.id}/access`, { connector: pick.id, level });
      done = `A task with the steps to connect ${pick.name} is on your desk.`;
      adding = false;
      pick = undefined;
      q = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  async function revoke(g: Grant) {
    await call(
      `/api/staff/${profile.id}/access?connector=${encodeURIComponent(g.connector)}`,
      undefined,
      'DELETE'
    );
  }

  const LEVEL = { read: 'Read only', act: 'Read and write' } as const;
  /** Why its runs leave a granted tool out, for the owner. Grants are read or act, so only act can sit above a level. */
  const HELD_BACK: Record<HeldBack, string> = {
    'above its level': 'held back until you set its level to Acts on its own',
    'still connecting': 'waiting on your steps',
    'sign-in ran out': 'sign in again'
  };
  const RANK = { read: 0, draft: 1, act: 2 } as const;
  const levels = ['read', 'act'] as const;
  /** Never above the staffer's own level. */
  const allowed = (l: 'read' | 'act') => RANK[profile.permission] >= RANK[l];
  const isUrl = $derived(/^https:\/\/\S+$/.test(q.trim()));

  const PERMISSIONS = [
    { id: 'read', label: 'Reads and reports' },
    { id: 'draft', label: 'Drafts for your yes' },
    { id: 'act', label: 'Acts on its own' }
  ] as const;
  const GRANTABLE = OFFICE_TOOLS.filter((t) => !t.always);
  async function setTool(tool: string, on: boolean) {
    problem = '';
    try {
      await call(`/api/staff/${profile.id}`, { tool, on }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  async function setAgent(select: HTMLSelectElement) {
    problem = '';
    try {
      await call(`/api/staff/${profile.id}`, { agent: select.value }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      // The Odd stayed on its tool, and the profile did not change, so nothing redraws the select.
      select.value = profile.agent;
    }
  }

  async function setPermission(permission: string) {
    problem = '';
    try {
      await call(`/api/staff/${profile.id}`, { permission }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <div class="flex items-center border-b border-hairline p-3">
    <div class="flex-1">
      <div class="text-sm font-medium">{profile.name}'s access</div>
      <div class="mt-0.5 text-xs text-muted">What it may use, in the office and outside it.</div>
    </div>
  </div>
  <div class="border-b border-hairline px-3 py-2">
    <div class="text-[11px] text-muted">Permission level</div>
    <div class="mt-1 flex gap-1" role="group" aria-label="Permission level">
      {#each PERMISSIONS as p (p.id)}
        <button
          class="flex-1 rounded-lg px-1.5 py-1 text-[11px] {profile.permission === p.id
            ? 'bg-sea/25 text-ink'
            : 'bg-raise text-muted'}"
          aria-pressed={profile.permission === p.id}
          onclick={() => setPermission(p.id)}>{p.label}</button
        >
      {/each}
    </div>
    <RunsOn value={profile.agent} onpick={setAgent} class="mt-2 text-[11px]" />
  </div>
  <div class="flex-1 overflow-y-auto p-3">
    <section aria-labelledby="office-tools">
      <h3 id="office-tools" class="text-[11px] text-muted">In the office</h3>
      <ul class="mt-1.5 flex flex-col gap-1 rounded-xl bg-raise p-1.5">
        {#each GRANTABLE as t (t.id)}
          <li>
            <label
              class="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-night/40"
            >
              <input
                type="checkbox"
                class="mt-0.5"
                checked={profile.tools.includes(t.id)}
                onchange={(e) => setTool(t.id, e.currentTarget.checked)}
              />
              <span class="min-w-0 flex-1">
                <span class="block text-sm">{t.name}</span>
                <span class="block text-xs text-muted">{t.does}</span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
      <p class="mt-1.5 text-[11px] text-faint">
        Every Odd can also raise asks, see how you decided them, and see its own access.
      </p>
    </section>

    <div class="mt-4 mb-1.5 flex items-center justify-between">
      <h3 class="text-[11px] text-muted">Outside tools</h3>
      {#if !adding}
        <button
          class="rounded-lg bg-raise px-2.5 py-1 text-xs font-medium hover:bg-sea/20"
          onclick={() => {
            adding = true;
            done = '';
          }}>Add access</button
        >
      {/if}
    </div>
    {#if done}
      <p class="mb-3 rounded-lg bg-sea/15 px-3 py-2 text-xs text-ink">{done}</p>
    {/if}
    {#if adding}
      <div class="mb-3 flex flex-col gap-2 rounded-xl bg-raise p-3">
        {#if !pick}
          <input
            class="rounded-lg bg-night/60 px-3 py-2 text-sm outline-none placeholder:text-faint"
            placeholder="Search tools, or paste a hosted server's https address"
            bind:value={q}
          />
          <ul class="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {#if isUrl}
              <li>
                <button
                  class="w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-night/60"
                  onclick={() =>
                    (pick = { id: q.trim(), name: new URL(q.trim()).hostname, kind: 'http' })}
                >
                  <span class="block">Connect {new URL(q.trim()).hostname}</span>
                  <span class="block text-xs text-muted"
                    >A hosted MCP server. You sign in to it next.</span
                  >
                </button>
              </li>
            {/if}
            {#each found.catalog as c (c.id)}
              <li>
                <button
                  class="w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-night/60"
                  onclick={() => (pick = c)}
                >
                  <span class="block"
                    >{c.name} <span class="text-[11px] text-moss">in the office</span></span
                  >
                  <span class="block text-xs text-muted">{c.description}</span>
                </button>
              </li>
            {/each}
            {#each found.registry as c (c.registry)}
              <li>
                <button
                  class="w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-night/60 disabled:opacity-40"
                  disabled={!!c.unsupported}
                  onclick={() => (pick = { id: c.registry, name: c.name, kind: c.kind ?? 'stdio' })}
                >
                  <span class="block"
                    >{c.name} <span class="text-[11px] text-faint">{c.registry}</span></span
                  >
                  <span class="block text-xs text-muted">{c.unsupported ?? c.description}</span>
                </button>
              </li>
            {/each}
            {#if found.problem}
              <li class="text-xs text-coral">{found.problem}</li>
            {/if}
          </ul>
        {:else}
          <div class="text-sm font-medium">{pick.name}</div>
          <div class="flex gap-1.5">
            {#each levels as l (l)}
              <button
                class="flex-1 rounded-lg px-2 py-1.5 text-xs disabled:opacity-40 {level === l
                  ? 'bg-sea/25'
                  : 'bg-night/60'}"
                disabled={!allowed(l)}
                title={allowed(l)
                  ? ''
                  : `${profile.name} needs the ${l} level first. Change it above.`}
                onclick={() => (level = l)}>{LEVEL[l]}</button
              >
            {/each}
          </div>
          <div class="flex gap-2">
            <button
              class="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-ink"
              onclick={() => (pick = undefined)}>Back</button
            >
            <button
              class="flex-1 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
              onclick={grant}>Grant</button
            >
          </div>
        {/if}
        <button
          class="text-xs text-muted hover:text-ink"
          onclick={() => {
            adding = false;
            pick = undefined;
          }}>Cancel</button
        >
      </div>
    {/if}
    {#if !grants.length && !adding}
      <p class="py-4 text-center text-sm text-muted">No outside tools yet.</p>
    {/if}
    <ul class="flex flex-col gap-2">
      {#each grants as g (g.connector)}
        <li class="rounded-xl bg-raise p-3 text-sm">
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <div class="font-medium">{g.name}</div>
              <div class="text-xs text-muted">
                {LEVEL[g.level]} · {g.reach}{g.heldBack ? ` · ${HELD_BACK[g.heldBack]}` : ''}
              </div>
            </div>
            <button class="text-xs text-muted hover:text-coral" onclick={() => revoke(g)}
              >Revoke</button
            >
          </div>
        </li>
      {/each}
    </ul>
    {#if problem}
      <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
    {/if}
  </div>
</div>
