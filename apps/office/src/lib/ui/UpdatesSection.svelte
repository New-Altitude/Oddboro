<script lang="ts">
  import { clockTime } from '@oddboro/ledger/time';
  import { call, type ApiUrl } from './api.ts';
  import UpdateReady, { type UpdateStatus } from './UpdateReady.svelte';
  let { showWindow = true }: { showWindow?: boolean } = $props();

  // The Setup tab's Updates section: the version this is, Check now, the
  // owner's switch for the checks the app makes on its own, a ready update
  // with Install now, Install tonight and Wait, and the window Install
  // tonight uses. It hears the server when an update lands, so nothing polls.
  let update = $state<UpdateStatus | undefined>();
  let start = $state('02:00');
  let end = $state('04:00');
  let busy = $state(false);
  let problem = $state('');

  async function load() {
    try {
      update = await call<UpdateStatus>('/api/update');
      start = update.window.start;
      end = update.window.end;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  $effect(() => {
    void load();
    const events = new EventSource('/api/events' satisfies ApiUrl);
    events.onmessage = (m) => {
      const e = JSON.parse(m.data) as { type: string; table?: string };
      if (e.type === 'change' && e.table === 'app_update') void load();
    };
    return () => events.close();
  });

  async function act(body: unknown, method?: string) {
    problem = '';
    busy = true;
    try {
      update = await call<UpdateStatus>('/api/update', body, method);
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  const saveWindow = () => {
    if (update && (start !== update.window.start || end !== update.window.end))
      void act({ start, end }, 'PUT');
  };

  const lastCheck = $derived.by(() => {
    const c = update?.checked;
    if (!c || c.result === 'ready') return '';
    const at = clockTime(new Date(c.at));
    return c.result === 'none'
      ? `Checked at ${at}. This is the newest version.`
      : `The check at ${at} failed: ${c.problem}`;
  });
  const field = 'rounded-lg bg-raise px-2 py-1.5 text-xs outline-none';
</script>

<section class="flex flex-col gap-2" aria-label="Updates">
  <div class="flex items-center">
    <h3 class="flex-1 text-xs tracking-[0.16em] text-sea uppercase">Updates</h3>
    {#if update?.managed && !update.ready}
      <button
        class="text-xs text-sea underline underline-offset-2 disabled:opacity-40"
        disabled={busy || update.checking}
        onclick={() => act({ action: 'check' })}
        >{update.checking ? 'Checking' : 'Check now'}</button
      >
    {/if}
  </div>
  {#if !update}
    <p class="text-xs text-muted">Looking up the version.</p>
  {:else}
    <p class="text-xs text-muted">
      {update.current === 'development'
        ? 'This is a development build. Only the Oddboro app updates itself.'
        : `This is Oddboro ${update.current}. An update installs only when you say.`}
    </p>
    {#if update.ready}
      <UpdateReady {update} {busy} act={(action) => act({ action })} />
    {:else if lastCheck}
      <p class="text-xs text-faint">{lastCheck}</p>
    {/if}
    {#if update.managed && showWindow}
      <button
        class="flex items-center gap-3 rounded-lg bg-raise px-3 py-2 text-start text-xs disabled:opacity-40"
        role="switch"
        aria-checked={update.checks}
        aria-describedby="update-checks"
        disabled={busy}
        onclick={() => act({ action: update?.checks ? 'checks-off' : 'checks-on' })}
      >
        <span class="min-w-0 flex-1 text-ink">Check for updates on its own</span>
        <span
          class="flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 {update.checks
            ? 'justify-end bg-sea'
            : 'justify-start bg-night/60'}"
          aria-hidden="true"
        >
          <span class="size-4 rounded-full {update.checks ? 'bg-night' : 'bg-muted'}"></span>
        </span>
      </button>
      <p id="update-checks" class="text-xs leading-relaxed text-muted">
        {update.checks
          ? 'Oddboro asks GitHub for a newer version when it opens and every 4 hours.'
          : 'Oddboro looks for a newer version only when you press Check now.'}
        A check tells GitHub this app's version and system, and installs nothing.
      </p>
    {/if}
    {#if showWindow}
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span>Install tonight installs between</span>
        <input
          class={field}
          type="time"
          aria-label="Window start"
          bind:value={start}
          onchange={saveWindow}
        />
        <span>and</span>
        <input
          class={field}
          type="time"
          aria-label="Window end"
          bind:value={end}
          onchange={saveWindow}
        />
        <span>office time.</span>
      </div>
    {/if}
  {/if}
  {#if problem}
    <p class="rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
  {/if}
</section>
