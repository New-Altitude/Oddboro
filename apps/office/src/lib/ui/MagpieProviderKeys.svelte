<script lang="ts">
  import type { MagpieAction, MagpieProvider } from '../magpie.ts';
  let {
    provider,
    shared,
    busy,
    onaction
  }: {
    provider: MagpieProvider;
    shared: boolean;
    busy: boolean;
    onaction: (action: MagpieAction) => Promise<boolean>;
  } = $props();
  let open = $state(false);
  let replacing = $state<string>();
  let secret = $state('');
  let name = $state('');

  function edit(ref?: string) {
    replacing = ref;
    secret = name = '';
    open = true;
  }
  function cancel() {
    secret = name = '';
    replacing = undefined;
    open = false;
  }
  async function save() {
    const key = secret;
    secret = '';
    const action: MagpieAction = replacing
      ? { action: 'key-replace', id: provider.id, ref: replacing, key }
      : { action: 'key-add', id: provider.id, key, name: name.trim() };
    if (await onaction(action)) cancel();
  }
  async function remove(ref: string, label: string) {
    if (
      !confirm(
        `Remove ${label} from ${provider.name}? Routes using this key may stop working.${shared ? ' This changes the shared Magpie setup for all clients.' : ''}`
      )
    )
      return;
    await onaction({ action: 'key-remove', id: provider.id, ref });
  }
  async function toggle(ref: string, on: boolean, label: string) {
    if (
      !on &&
      !confirm(
        `Turn off ${label}? Magpie will stop routing requests through this key.${shared ? ' Other clients of this Magpie are affected.' : ''}`
      )
    )
      return;
    await onaction({ action: 'key-toggle', id: provider.id, ref, on });
  }
</script>

{#if !provider.subscription}
  <section class="mt-3 border-t border-hairline pt-2" aria-label="API keys for {provider.name}">
    <h5 class="text-xs font-medium">API keys</h5>
    <p class="mt-1 text-xs text-muted">
      Saved key values stay hidden. Add, replace or remove a key here.
    </p>
    {#each provider.keys ?? [] as key, index (key.id)}
      {@const label = key.name || `API key ${index + 1}`}
      <div class="mt-2">
        <p class="text-xs">{label} · {key.on ? 'On' : 'Off'}{key.active ? ' · Active' : ''}</p>
        <div class="mt-1 flex flex-wrap gap-2">
          <button class="key-button" disabled={busy} onclick={() => edit(key.id)}
            >Replace <span class="sr-only">{label}</span></button
          >
          <button class="key-button" disabled={busy} onclick={() => toggle(key.id, !key.on, label)}
            >{key.on ? 'Turn off' : 'Turn on'} <span class="sr-only">{label}</span></button
          >
          <button class="key-button" disabled={busy} onclick={() => remove(key.id, label)}
            >Remove <span class="sr-only">{label}</span></button
          >
        </div>
      </div>
    {/each}
    {#if !open}
      <button class="key-button mt-2" disabled={busy} onclick={() => edit()}>Add API key</button>
    {:else}
      <form
        class="mt-2"
        onsubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {#if shared}<p class="text-xs text-muted">
            Saving changes this provider's key for all clients of this Magpie.
          </p>{/if}
        {#if !replacing}<label class="mt-2 block text-xs"
            >Key name (optional)<input
              class="key-field mt-1"
              maxlength="100"
              bind:value={name}
            /></label
          >{/if}
        <label class="mt-2 block text-xs"
          >{replacing ? 'Replacement API key' : 'New API key'}<input
            class="key-field mt-1"
            type="password"
            autocomplete="off"
            spellcheck="false"
            required
            bind:value={secret}
          /></label
        >
        <div class="mt-2 flex gap-2">
          <button class="key-button" disabled={busy || !secret.trim()}
            >{replacing ? 'Save replacement key' : 'Save API key'}</button
          ><button class="key-button" type="button" disabled={busy} onclick={cancel}>Cancel</button>
        </div>
      </form>
    {/if}
  </section>
{/if}

<style>
  .key-button {
    border-radius: 0.5rem;
    background: var(--color-raise);
    padding-block: 0.375rem;
    padding-inline: 0.625rem;
    font-size: 0.75rem;
    color: var(--color-ink);
  }
  .key-button:hover:not(:disabled) {
    background: var(--color-hairline);
  }
  .key-button:disabled {
    opacity: 0.4;
  }
  .key-button:focus-visible,
  .key-field:focus-visible {
    outline: 2px solid var(--color-sea);
    outline-offset: 2px;
  }
  .key-field {
    inline-size: 100%;
    min-inline-size: 0;
    border: 1px solid var(--color-hairline);
    border-radius: 0.5rem;
    background: var(--color-raise);
    padding-block: 0.375rem;
    padding-inline: 0.625rem;
    font-size: 0.875rem;
    color: var(--color-ink);
  }
</style>
