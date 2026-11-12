<script lang="ts">
  import type { Check } from '@oddboro/ledger/checks';
  import type { System } from '@oddboro/ledger/platform';
  import { systemWords } from '@oddboro/ledger/system-words';
  import type { Address } from '#lib/address.ts';
  import { call } from '../api.ts';
  import AddressSection from './AddressSection.svelte';
  import NotifyHelp from './NotifyHelp.svelte';
  import { browserNeeds } from './notify-help.ts';

  // The first card: what the Mac has, ticked off one at a time. Anything
  // missing gets a button that fixes it from here. The owner moves on with
  // Next once everything is there.
  export type Setup = {
    checks: Check[];
    owner: string;
    suggested: string;
    app?: boolean;
    system?: System;
    /** Whether the office can show its own notifications on this computer. */
    notify?: boolean;
    /** Whether this system has a notification settings page the office can open. */
    notifySettings?: boolean;
  };
  type Props = { onnext: () => void; onsetup: (s: Setup) => void };
  let { onnext, onsetup }: Props = $props();

  // Docker, uv and the login service are for later; Node is right or setup would not have run.
  // Claude Code is on the Your AI card, beside the other tools the office can run on.
  const SHOWN = ['mac', 'database', 'pgvector', 'notify', 'ollama'];
  let checks = $state<Check[] | undefined>();
  /** In the Mac app, which shows its own notifications and has no browser tab. */
  let app = $state(false);
  let system = $state<System | undefined>();
  let canNotify = $state(true);
  let canOpenSettings = $state(false);
  /** What the owner calls this computer: "Your Mac", and "This computer" off a Mac. */
  const words = $derived(systemWords(system));
  const browserNeedsMore = $derived(browserNeeds(system));
  let problem = $state('');

  async function load() {
    problem = '';
    try {
      const s = await call<Setup>('/api/setup');
      onsetup(s);
      app = !!s.app;
      system = s.system;
      canNotify = s.notify !== false;
      canOpenSettings = !!s.notifySettings;
      checks = s.checks.filter((c) => SHOWN.includes(c.id));
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    void load();
  });

  const missing = $derived(checks?.filter((c) => c.state === 'missing').length ?? 0);
  const MARK = { ok: '✓', optional: '!', missing: '✗' } as const;
  const TONE = { ok: 'text-moss', optional: 'text-ember', missing: 'text-coral' } as const;

  // The office's address, http://oddboro.localhost through Caddy, in
  // whichever way this computer allows (lib/server/address.ts).
  let addr = $state<Address | undefined>();
  $effect(() => {
    void call<Address>('/api/setup/address')
      .then((a) => (addr = a))
      .catch(() => {});
  });

  // Notifications. The Mac's come from the office itself, so they reach the
  // owner with the page closed. In the app macOS shows them as Oddboro's; from
  // the repo, as Script Editor's. Either has to be allowed. From the repo on
  // Windows they come as Windows PowerShell's, and on Linux from notify-send. The browser's tell
  // the owner about their desk while the tab is in the background; the app has
  // no tab, so it skips them. Neither holds up Next.
  let mac = $state<'idle' | 'sent' | 'shown' | 'missing'>('idle');
  let browser = $state<NotificationPermission | 'unsupported'>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  );
  async function testMac() {
    const r = await call<{ ok: boolean }>('/api/setup/notify', { action: 'test' }).catch(() => ({
      ok: false
    }));
    mac = r.ok ? 'sent' : 'missing';
  }
  const openSettings = () => void call('/api/setup/notify', { action: 'settings' }).catch(() => {});
  /** The browser came back without a yes or a no: it asked quietly, or not at all. */
  let quiet = $state(false);
  async function allowBrowser() {
    browser = await Notification.requestPermission();
    quiet = browser === 'default';
    if (browser !== 'granted') return;
    try {
      localStorage.setItem('oddboro.notify', '1');
    } catch {
      // No storage: the Desk's switch turns them on later.
    }
  }
</script>

<p class="text-lg font-semibold">
  {#if !checks}
    Checking your computer.
  {:else if !missing}
    Everything the office needs is here.
  {:else}
    {missing === 1 ? 'One thing' : `${missing} things`} to fix before the office can open.
  {/if}
</p>

{#if checks}
  <ul class="mt-3 grid gap-1">
    {#each checks as c, i (c.id)}
      <li
        class="tick grid grid-cols-[1.25rem_7.5rem_1fr] items-baseline gap-2 rounded-lg bg-raise px-3 py-1.5 text-sm"
        style="animation-delay: {120 * (i + 1)}ms"
      >
        <span class="font-bold {TONE[c.state]}" aria-label={c.state}>{MARK[c.state]}</span>
        <span>{c.name}</span>
        <span class="min-w-0 text-muted">{c.found}</span>
        {#if c.state !== 'ok' && c.fix}
          <span class="col-start-2 col-end-4 text-xs text-faint">{c.fix.replaceAll('`', '')}</span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

{#if checks && addr}
  <AddressSection bind:addr {words} />
{/if}

{#if checks}
  <div class="mt-4">
    <div class="text-[10px] tracking-[0.14em] text-muted uppercase">Notifications</div>
    <div class="mt-2 grid gap-1">
      {#if canNotify}
        <div class="rounded-lg bg-raise px-3 py-2 text-sm">
          <div class="flex items-center gap-3">
            <span class="min-w-0 flex-1">
              {app ? 'Oddboro' : words.label}
              <span class="block text-xs text-muted"
                >{app
                  ? 'Pings from your Odds, even with the window closed.'
                  : 'Pings from your Odds, even with the office closed.'}</span
              >
            </span>
            {#if mac === 'shown'}
              <span class="text-xs text-moss">✓ On</span>
            {:else if mac === 'idle'}
              <button class="btn" onclick={testMac}>Send a test</button>
            {/if}
          </div>
          {#if mac === 'sent'}
            <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span class="flex-1 text-muted">Did a notification appear?</span>
              <button class="btn" onclick={() => (mac = 'shown')}>Yes</button>
              <button
                class="btn"
                onclick={() => {
                  mac = 'missing';
                  openSettings();
                }}>No</button
              >
            </div>
          {:else if mac === 'missing'}
            <NotifyHelp
              {system}
              {app}
              canOpen={canOpenSettings}
              onOpen={openSettings}
              onTest={testMac}
            />
          {/if}
        </div>
      {/if}
      {#if !app}
        <div class="flex items-center gap-3 rounded-lg bg-raise px-3 py-2 text-sm">
          <span class="min-w-0 flex-1">
            This browser
            <span class="block text-xs text-muted"
              >When something new lands on your desk and the tab is in the background.</span
            >
          </span>
          {#if browser === 'granted'}
            <span class="text-xs text-moss">✓ On</span>
          {:else if browser === 'denied'}
            <span class="text-xs text-muted">Blocked in this site's settings</span>
          {:else if browser !== 'unsupported'}
            <button class="btn" onclick={allowBrowser}>{quiet ? 'Ask again' : 'Allow'}</button>
          {/if}
        </div>
        {#if quiet && browser === 'default'}
          <p class="mt-2 text-xs text-muted">
            Your browser did not ask out loud. Look for a bell in the address bar and allow
            notifications there, or allow them for this site in the browser's site settings.
            {#if browserNeedsMore}
              {browserNeedsMore}
            {/if}
          </p>
        {:else if browser === 'denied'}
          <p class="mt-2 text-xs text-muted">
            To turn them on, allow notifications for this site in the browser's site settings (the
            icon to the left of the address), then reload.
          </p>
        {/if}
      {/if}
    </div>
  </div>
{/if}

{#if problem}
  <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-sm text-coral">{problem}</p>
{/if}

<div class="mt-4 flex items-center gap-3">
  <span class="flex-1"></span>
  {#if missing}
    <button class="link text-sm" onclick={load}>Check again</button>
  {/if}
  <button class="btn primary" disabled={!checks || missing > 0} onclick={onnext}>Next</button>
</div>

<style>
  .tick {
    animation: tick 200ms both;
  }
  @keyframes tick {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
