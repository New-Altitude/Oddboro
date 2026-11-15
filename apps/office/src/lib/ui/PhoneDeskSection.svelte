<script lang="ts">
  // The Setup window's Your phone section: the desk on the owner's phone over
  // Tailscale (`#lib/server/tailscale.ts`, `docs/remote-desk.md`). It reads
  // where things stand when it opens and on Check again, and nothing polls.
  // Each step shows only while it is still to do: Tailscale here and signed
  // in, `tailscale serve` pointing at the phone's door (a command the owner runs),
  // and the name let in (one click). Then the desk's link and a QR code.
  import qrcode from 'qrcode-generator';
  import { call } from './api.ts';
  import type { PhoneDesk } from '#lib/server/tailscale.ts';

  let desk = $state<PhoneDesk | undefined>();
  let busy = $state(false);
  let problem = $state('');
  let copied = $state(false);

  async function load() {
    busy = true;
    problem = '';
    try {
      desk = await call<PhoneDesk>('/api/phone');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
  $effect(() => void load());

  async function letIn() {
    busy = true;
    problem = '';
    try {
      desk = (await call<{ desk: PhoneDesk }>('/api/phone', {})).desk;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      // No clipboard here: the command stays on screen to copy by hand.
    }
  }

  /** The link as a QR code: one path of the dark squares, in a grid of `size` with a margin of 2. */
  const qr = $derived.by(() => {
    if (desk?.tailscale !== 'on') return undefined;
    const code = qrcode(0, 'M');
    code.addData(desk.link);
    code.make();
    const n = code.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) if (code.isDark(y, x)) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    return { d, size: n + 4 };
  });
</script>

<section class="flex flex-col gap-2">
  <div class="flex items-center">
    <h3 class="flex-1 text-xs tracking-[0.16em] text-sea uppercase">Your phone</h3>
    <button
      class="text-xs text-sea underline underline-offset-2 disabled:opacity-40"
      disabled={busy}
      onclick={load}>{busy ? 'Checking' : 'Check again'}</button
    >
  </div>
  <p class="text-xs text-muted">
    Open your desk on your phone from anywhere, over Tailscale. Only your own devices can reach it.
  </p>

  {#if !desk}
    <p class="text-xs text-muted">Checking Tailscale.</p>
  {:else if desk.tailscale === 'missing'}
    <p class="rounded-lg bg-raise px-2.5 py-2 text-xs">
      Install Tailscale on this computer and on your phone, from
      <a
        class="text-sea underline underline-offset-2"
        href="https://tailscale.com/download"
        target="_blank"
        rel="noopener">tailscale.com/download</a
      >, and sign in to the same account on both. Then press Check again.
    </p>
  {:else if desk.tailscale === 'off'}
    <p class="rounded-lg bg-raise px-2.5 py-2 text-xs">
      Tailscale is on this computer but not running or not signed in. Open it, sign in, then press
      Check again.
    </p>
  {:else}
    {@const d = desk}
    <p class="text-xs text-muted">
      This computer on Tailscale: <span class="text-ink">{d.name}</span>
    </p>
    {#if !d.serving}
      <div class="rounded-lg bg-raise px-2.5 py-2 text-xs">
        <p>Run this once in a terminal, so Tailscale sends that name to the office:</p>
        <div class="mt-1.5 flex items-center gap-2">
          <code class="min-w-0 flex-1 rounded-md bg-night/50 px-2 py-1 font-mono break-all"
            >{d.serveCommand}</code
          >
          <button class="text-sea underline underline-offset-2" onclick={() => copy(d.serveCommand)}
            >{copied ? 'Copied' : 'Copy'}</button
          >
        </div>
        <p class="mt-1.5 text-faint">
          Use serve, never funnel: funnel puts the name on the open internet. Then press Check
          again.
        </p>
      </div>
    {/if}
    {#if !d.allowed}
      <button
        class="rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
        disabled={busy}
        onclick={letIn}>Let my phone in</button
      >
      <p class="text-[11px] text-faint">
        The phone's door then opens to {d.name}. Nothing else changes: it listens on this computer
        only, and lets in only your own tailnet.
      </p>
    {:else}
      {#if d.serving}
        <div class="flex items-center gap-3 rounded-lg bg-raise px-2.5 py-2 text-xs">
          {#if qr}
            <svg
              class="size-28 shrink-0 rounded-md bg-white text-night"
              viewBox="0 0 {qr.size} {qr.size}"
              role="img"
              aria-label="A QR code of the desk's link"
              shape-rendering="crispEdges"><path d={qr.d} fill="currentColor" /></svg
            >
          {/if}
          <div class="min-w-0">
            <p>With Tailscale on, scan this with your phone's camera, or open:</p>
            <p class="mt-1 break-all text-sea">{d.link}</p>
            <p class="mt-1.5 text-faint">
              Then add it to your home screen, and tap Buzz me there to get a buzz when something
              lands.
            </p>
          </div>
        </div>
      {/if}
    {/if}
  {/if}

  {#if problem}
    <p class="rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
  {/if}
</section>
