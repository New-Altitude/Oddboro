<script lang="ts">
  // The "Runs on" picker, on the Access tab and in the hire drawer: the tools
  // this system offers (`/api/agents`), so both offer the same ones. Beside it,
  // the picked tool's one action (`toolAction`, the same as on onboarding's
  // Other AI tools card: Install for a picked tool that is missing, else its
  // sign-in), and Sign out when it is signed in, so a run refused for its
  // sign-in has its fix where its message points.
  import type { Agent } from '@oddboro/ledger/agents';
  import { AgentTools } from './agent-tools.svelte.ts';
  import { INSTALL_NOTES, MAKERS, offersSignOut, toolAction } from './tool-action.ts';

  type Props = {
    /** The tool picked now. */
    value: Agent;
    /** The owner picked another. The caller reads `select.value`, and may set it back. */
    onpick: (select: HTMLSelectElement) => void;
    /** Margin and text size, from where it sits. */
    class?: string;
  };
  let { value, onpick, class: cls = '' }: Props = $props();

  const tools = new AgentTools();
  /** Only tools on this computer, and the one picked now even when that one is missing. */
  const offered = $derived(tools.tools.filter((t) => t.installed || t.id === value));
  const picked = $derived(tools.tools.find((t) => t.id === value));
  const action = $derived(toolAction(picked));
  /** The key field, opened by the key button. */
  let keyOpen = $state(false);
  let key = $state('');

  async function saveKey(id: Agent) {
    if (await tools.setKey(id, key.trim())) {
      key = '';
      keyOpen = false;
    }
  }
</script>

<!-- A sign-in finished on its own page shows here when the owner comes back. -->
<svelte:window onfocus={() => tools.waiting && void tools.load()} />

{#if offered.length}
  <div class={cls}>
    <div class="flex flex-wrap items-center gap-2">
      <label class="flex flex-1 items-center gap-2 text-muted">
        Runs on
        <select
          class="flex-1 rounded-lg bg-raise px-1.5 py-1 text-ink"
          {value}
          onchange={(e) => onpick(e.currentTarget)}
        >
          {#each offered as t (t.id)}
            <option value={t.id}
              >{t.installed
                ? t.signIn && !t.signIn.signedIn
                  ? `${t.name} (not signed in)`
                  : t.name
                : `${t.name} (not on this ${tools.computer})`}</option
            >
          {/each}
        </select>
      </label>
      {#if picked?.signIn}
        {@const t = picked}
        {#if action === 'install'}
          <button class="small" onclick={() => tools.install(t.id)}>Install {t.name}</button>
        {:else if action === 'installing'}
          <span class="text-muted">Installing...</span>
        {:else if action === 'sign-in'}
          <button class="small" onclick={() => tools.signIn(t.id)}>Sign in to {t.name}</button>
        {:else if action === 'cancel'}
          {#if t.signIn?.waiting?.url}
            <a
              class="text-sea underline"
              href={t.signIn.waiting.url}
              target="_blank"
              rel="noopener noreferrer">Open {MAKERS[t.id]}'s sign-in page</a
            >
          {/if}
          <button class="small" onclick={() => tools.cancel(t.id)}>Cancel</button>
        {:else if action === 'sign-in-again'}
          <button class="small" onclick={() => tools.signIn(t.id)}>Sign in again</button>
        {:else if action === 'key'}
          <button class="small" onclick={() => (keyOpen = !keyOpen)}
            >{t.signIn?.signedIn ? 'Use another key' : `Add a ${t.name} key`}</button
          >
        {/if}
        {#if offersSignOut(t)}
          <button class="small" disabled={tools.busy === t.id} onclick={() => tools.signOut(t.id)}
            >Sign out</button
          >
        {/if}
      {/if}
    </div>
    {#if picked && (action === 'install' || action === 'installing') && INSTALL_NOTES[picked.id]}
      <p class="mt-1 text-muted">{INSTALL_NOTES[picked.id]}</p>
    {/if}
    {#if picked?.signIn && action === 'key' && keyOpen}
      {@const t = picked}
      <form
        class="mt-1 flex gap-2"
        novalidate
        onsubmit={(e) => {
          e.preventDefault();
          if (key.trim()) void saveKey(t.id);
        }}
      >
        <input
          class="min-w-0 flex-1 rounded-lg bg-raise px-1.5 py-1 text-ink"
          type="password"
          aria-label="{t.name} API key"
          placeholder="{t.name} API key"
          autocomplete="off"
          spellcheck="false"
          bind:value={key}
        />
        <button class="small" disabled={!key.trim() || tools.busy === t.id}
          >{tools.busy === t.id ? 'Trying it' : 'Use this key'}</button
        >
      </form>
    {/if}
    {#if picked && tools.problems[picked.id]}
      <p class="mt-1 text-coral">{tools.problems[picked.id]}</p>
    {/if}
  </div>
{/if}

<style>
  .small {
    border-radius: 0.5rem;
    background: var(--color-raise);
    /* As the Access tab's own buttons (Add access), so none sits tight in its box. */
    padding-block: 0.25rem;
    padding-inline: 0.625rem;
    color: var(--color-ink);
  }
  .small:hover {
    background: rgb(255 255 255 / 0.12);
  }
  .small:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
