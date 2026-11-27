<script lang="ts" module>
  /** What `/api/update` answers, as the page reads it. */
  export type UpdateStatus = {
    ready: boolean;
    version: string | null;
    installAt: string | null;
    holding: boolean;
    current: string;
    managed: boolean;
    window: { start: string; end: string };
    checked: { at: string; result: 'none' | 'ready' | 'failed'; problem?: string } | null;
    checking: boolean;
    checks: boolean;
    waited: boolean;
  };
  export type UpdateAction = 'install-now' | 'install-tonight' | 'wait';
</script>

<script lang="ts">
  import { clockTime } from '@oddboro/ledger/time';
  import { siteLink } from '../site.ts';

  // A ready update and the owner's three answers: Install now, Install
  // tonight, or Wait. Nothing installs until they pick one of the first two.
  // What's new opens the version's entry on oddboro.com's releases page, which
  // links its code. Setup's Updates section and the floor's notice both show it.
  type Props = {
    update: UpdateStatus;
    busy: boolean;
    act: (action: UpdateAction) => void;
  };
  let { update, busy, act }: Props = $props();

  const when = $derived(update.installAt ? clockTime(new Date(update.installAt)) : '');
  const button =
    'rounded-lg bg-raise px-3 py-2 text-xs font-medium hover:bg-sea/20 disabled:opacity-40';
</script>

<div class="flex flex-col gap-2 rounded-lg bg-sea/15 px-3 py-2 text-xs" role="status">
  <p class="text-ink">
    <span class="font-medium">Oddboro {update.version} is ready.</span>
    <a
      class="text-sea underline underline-offset-2"
      href={siteLink(`/releases#v${update.version}`)}
      target="_blank"
      rel="noreferrer">What's new</a
    >
  </p>
  <p class="text-muted">
    {#if update.holding}
      Your Odds start nothing new and finish what they have. Oddboro then installs it and opens
      again.
    {:else if update.installAt}
      It installs at {when}. Your Odds stop starting new work 15 minutes before.
    {:else}
      It installs only when you say.
    {/if}
  </p>
  <div class="flex flex-wrap gap-2">
    <button
      class="rounded-lg bg-sea px-3 py-2 text-xs font-medium text-night disabled:opacity-40"
      disabled={busy || update.holding}
      onclick={() => act('install-now')}>Install now</button
    >
    {#if !update.installAt}
      <button class={button} disabled={busy} onclick={() => act('install-tonight')}
        >Install tonight</button
      >
    {/if}
    <button class={button} disabled={busy} onclick={() => act('wait')}>Wait</button>
  </div>
</div>
