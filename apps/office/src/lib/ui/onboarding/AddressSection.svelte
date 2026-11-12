<script lang="ts">
  import type { SystemWords } from '@oddboro/ledger/system-words';
  import { shownAddress, type Address } from '#lib/address.ts';
  import { call } from '../api.ts';

  // The address on Setup's first card, and the buttons that move it to a name
  // with no port. MacCard loads the address only in the browser, so this is
  // its own component: a test renders it on the server with an address.
  type Props = { addr: Address; words: SystemWords };
  let { addr = $bindable(), words }: Props = $props();
  const thisComputer = $derived(`this ${words.word}`);

  let addrBusy = $state(false);
  let addrProblem = $state('');
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
</script>

<div class="mt-4">
  <div class="text-[10px] tracking-[0.14em] text-muted uppercase">Address</div>
  <div class="mt-2 rounded-lg bg-raise px-3 py-2 text-sm">
    <div class="flex items-center gap-3">
      <span class="min-w-0 flex-1">
        {shownAddress(addr)}
        <span class="block text-xs text-muted">
          {#if addr.state === 'ready' && addr.secure}
            The office's address on {thisComputer}, secure. No port to remember.
          {:else if addr.state === 'ready' && addr.canSecure}
            Make it secure so your browser can show notifications. {words.trustAsks}
          {:else if addr.state === 'ready'}
            The office's address on {thisComputer}. No port to remember.
          {:else if addr.state === 'own'}
            {addr.installed
              ? 'Caddy answers at this address and hands it to the office, from every login on.'
              : 'The office downloads Caddy, a small web server, to answer at this address from every login on.'}
          {:else if addr.state === 'shared'}
            Your Caddy holds port 80. The office adds its site to it and leaves your config files
            alone.
          {:else if addr.state === 'unchecked'}
            The office could not check what holds port 80 on {thisComputer}, so it keeps its port in
            the address.
          {:else}
            {addr.holder} holds port 80, so the office keeps its port in the address.
          {/if}
        </span>
      </span>
      {#if addr.state === 'ready'}
        {#if addr.canSecure}
          <button class="btn" disabled={addrBusy} onclick={() => setUpAddress('secure')}
            >{addrBusy ? words.trustWaiting : 'Make it secure'}</button
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
        after {thisComputer} trusts it. To fix it, open <code>about:config</code> in Firefox and set
        <code>security.enterprise_roots.enabled</code> to true, or use {words.notFirefox} for the office.
      </p>
    {/if}
  </div>
</div>
