<script lang="ts">
  import type { Check } from '@oddboro/ledger/checks';
  import { call, stream } from '../api.ts';

  // The first card: what the Mac has, ticked off one at a time. Anything
  // missing gets a button that fixes it from here. The owner moves on with
  // Next once everything is there.
  export type Setup = { checks: Check[]; owner: string; suggested: string; app?: boolean };
  type Props = { onnext: () => void; onkey: () => void; onsetup: (s: Setup) => void };
  let { onnext, onkey, onsetup }: Props = $props();

  // Docker, uv and the login service are for later; Node is right or setup would not have run.
  const SHOWN = ['mac', 'claude', 'database', 'pgvector', 'notify', 'ollama'];
  let checks = $state<Check[] | undefined>();
  /** In the Mac app, which shows its own notifications and has no browser tab. */
  let app = $state(false);
  let problem = $state('');
  let fixing = $state<'install' | 'sign-in' | undefined>();
  /** Counts fixes, so a sign-in that was started over or cancelled no longer changes the card. */
  let attempt = 0;
  let log = $state<string[]>([]);

  async function load() {
    problem = '';
    try {
      const s = await call<Setup>('/api/setup');
      onsetup(s);
      app = !!s.app;
      checks = s.checks.filter((c) => SHOWN.includes(c.id));
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }
  $effect(() => {
    void load();
  });

  /** Install Claude Code, or sign it in. Signing in again while one waits starts over. */
  async function fix(action: 'install' | 'sign-in') {
    const mine = ++attempt;
    fixing = action;
    problem = '';
    log = [];
    try {
      await stream<{ line?: string; done?: boolean; ok?: boolean }>(
        '/api/setup/claude',
        { action },
        (l) => {
          if (l.line && mine === attempt) log = [...log.slice(-2), l.line];
        }
      );
    } catch (e) {
      if (mine === attempt) problem = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === attempt) {
        fixing = undefined;
        await load();
      }
    }
  }

  /** Stop a sign-in that is waiting on its page. */
  async function cancelSignIn() {
    attempt++;
    fixing = undefined;
    log = [];
    try {
      await call('/api/setup/claude', undefined, 'DELETE');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
    await load();
  }

  const missing = $derived(checks?.filter((c) => c.state === 'missing').length ?? 0);
  const claude = $derived(checks?.find((c) => c.id === 'claude'));
  const MARK = { ok: '✓', optional: '!', missing: '✗' } as const;
  const TONE = { ok: 'text-moss', optional: 'text-ember', missing: 'text-coral' } as const;

  // The office's address, http://oddboro.localhost through Caddy, in
  // whichever way this Mac allows (lib/server/address.ts).
  type Address = { host: string } & (
    | { state: 'ready'; url: string; secure: boolean; canSecure: boolean }
    | { state: 'own'; installed: boolean }
    | { state: 'shared' }
    | { state: 'blocked'; holder: string }
  );
  let addr = $state<Address | undefined>();
  let addrBusy = $state(false);
  let addrProblem = $state('');
  $effect(() => {
    void call<Address>('/api/setup/address')
      .then((a) => (addr = a))
      .catch(() => {});
  });
  async function setUpAddress(action?: 'secure') {
    addrBusy = true;
    addrProblem = '';
    try {
      addr = await call<Address>('/api/setup/address', action ? { action } : {});
    } catch (e) {
      addrProblem = e instanceof Error ? e.message : String(e);
    } finally {
      addrBusy = false;
    }
  }
  const here = typeof location !== 'undefined' ? location.origin : '';
  // Firefox keeps its own list of trusted certificates, not the Mac's.
  const firefox = typeof navigator !== 'undefined' && /Firefox\//.test(navigator.userAgent);

  // Notifications. The Mac's come from the office itself, so they reach the
  // owner with the page closed. In the app macOS shows them as Oddboro's; from
  // the repo, as Script Editor's. Either has to be allowed. The browser's tell
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
        {#if c.state !== 'ok' && c.fix && c.id !== 'claude'}
          <span class="col-start-2 col-end-4 text-xs text-faint">{c.fix.replaceAll('`', '')}</span>
        {/if}
      </li>
    {/each}
  </ul>
  {#if claude?.state === 'missing'}
    <div class="mt-3 flex flex-wrap items-center gap-2 text-sm">
      {#if fixing === 'install'}
        <span class="text-muted">Installing Claude Code.</span>
      {:else if fixing}
        <span class="text-muted">Finish signing in on the page that opened.</span>
        <button class="link" onclick={() => fix('sign-in')}>Open it again</button>
        <button class="link" onclick={cancelSignIn}>Cancel</button>
      {:else if claude.found === 'Not installed'}
        <button class="btn" onclick={() => fix('install')}>Install Claude Code</button>
      {:else}
        <button class="btn" onclick={() => fix('sign-in')}>Sign in with Claude</button>
      {/if}
      <span class="text-muted">
        or <button class="link" onclick={onkey}>use an API key</button>
      </span>
    </div>
    {#if log.length}
      <pre class="mt-2 overflow-x-auto text-xs text-faint">{log.join('\n')}</pre>
    {/if}
  {/if}
{/if}

{#if checks && addr}
  <div class="mt-4">
    <div class="text-[10px] tracking-[0.14em] text-muted uppercase">Address</div>
    <div class="mt-2 rounded-lg bg-raise px-3 py-2 text-sm">
      <div class="flex items-center gap-3">
        <span class="min-w-0 flex-1">
          {addr.state === 'blocked' ? `${addr.host}:4500` : addr.host}
          <span class="block text-xs text-muted">
            {#if addr.state === 'ready' && addr.secure}
              The office's address on this Mac, secure. No port to remember.
            {:else if addr.state === 'ready' && addr.canSecure}
              Make it secure so your browser can show notifications. It takes your Mac's password,
              once.
            {:else if addr.state === 'ready'}
              The office's address on this Mac. No port to remember.
            {:else if addr.state === 'own'}
              {addr.installed
                ? 'Caddy answers at this address and hands it to the office, from every login on.'
                : 'The office downloads Caddy, a small web server, to answer at this address from every login on.'}
            {:else if addr.state === 'shared'}
              Your Caddy holds port 80. The office adds its site to it and leaves your config files
              alone.
            {:else}
              {addr.holder} holds port 80, so the office keeps its port in the address.
            {/if}
          </span>
        </span>
        {#if addr.state === 'ready'}
          {#if addr.canSecure}
            <button class="btn" disabled={addrBusy} onclick={() => setUpAddress('secure')}
              >{addrBusy ? 'Waiting for your password' : 'Make it secure'}</button
            >
          {:else if here === addr.url}
            <span class="text-xs text-moss">✓ {addr.secure ? 'Secure' : 'On'}</span>
          {:else}
            <a class="btn" href={addr.url}>Open it there</a>
          {/if}
        {:else if addr.state === 'own'}
          <button class="btn" disabled={addrBusy} onclick={() => setUpAddress()}
            >{addrBusy ? 'Setting up' : 'Set it up'}</button
          >
        {:else if addr.state === 'shared'}
          <button class="btn" disabled={addrBusy} onclick={() => setUpAddress()}
            >{addrBusy ? 'Adding it' : 'Add the office to your Caddy'}</button
          >
        {/if}
      </div>
      {#if addrProblem}
        <p class="mt-2 text-xs text-coral">{addrProblem}</p>
      {/if}
      {#if firefox && addr.host === 'local.oddboro.com'}
        <p class="mt-2 rounded-md bg-ember/15 px-2.5 py-1.5 text-xs text-ember">
          Firefox keeps its own list of trusted certificates, so it may warn about this address even
          after your Mac trusts it. To fix it, open <code>about:config</code> in Firefox and set
          <code>security.enterprise_roots.enabled</code> to true, or use Safari or Chrome for the office.
        </p>
      {/if}
    </div>
  </div>
{/if}

{#if checks}
  <div class="mt-4">
    <div class="text-[10px] tracking-[0.14em] text-muted uppercase">Notifications</div>
    <div class="mt-2 grid gap-1">
      <div class="rounded-lg bg-raise px-3 py-2 text-sm">
        <div class="flex items-center gap-3">
          <span class="min-w-0 flex-1">
            {app ? 'Oddboro' : 'Your Mac'}
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
          <ol class="mt-2 list-decimal space-y-1 ps-4 text-xs text-muted">
            <li>
              In System Settings, open Notifications.
              <button class="link" onclick={openSettings}>Open it</button>
            </li>
            {#if app}
              <li>Find Oddboro. Turn on Allow notifications.</li>
            {:else}
              <li>
                Find Script Editor: it carries the office's notifications. Turn on Allow
                notifications.
              </li>
              <li>
                If Script Editor is not listed, open it once from Applications, Utilities, then come
                back.
              </li>
            {/if}
            <li><button class="link" onclick={testMac}>Send another test</button>.</li>
          </ol>
        {/if}
      </div>
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
            notifications there, or allow them for this site in the browser's site settings. On a
            Mac, the browser itself also needs notifications on in System Settings, Notifications.
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
