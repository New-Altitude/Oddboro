<script lang="ts">
  // The "Runs on" picker, on the Settings tab and in the hire drawer: the tools
  // this system offers (`/api/agents`), so both offer the same ones. Beside it,
  // the picked tool's one action (`toolAction`, the same as under setup's Your
  // AI tiles: Install for a picked tool that is missing, else its sign-in),
  // and Sign out when it is signed in, so a run refused for its
  // sign-in has its fix where its message points. On an Odd's Model tab the
  // tiles pick (`actionsOnly`), so only the actions show.
  import type { Agent } from '@oddboro/ledger/agents';
  import { AgentTools } from './agent-tools.svelte.ts';
  import { INSTALL_NOTES, MAKERS, offersSignOut, toolAction } from './tool-action.ts';

  type Props = {
    /** The tool picked now. */
    value: Agent;
    /** The actual model source, or undefined to inherit the office selection. */
    model?: string | null;
    /** The owner picked another. The caller reads `select.value`, and may set it back. */
    onpick?: (select: HTMLSelectElement) => void;
    /** Only the picked tool's actions, with no picker: the Model tab's tiles pick. */
    actionsOnly?: boolean;
    /** Only Install and Update: the Model tab signs each account in itself. */
    installOnly?: boolean;
    /** Margin and text size, from where it sits. */
    class?: string;
  };
  let {
    value,
    model,
    onpick,
    actionsOnly = false,
    installOnly = false,
    class: cls = ''
  }: Props = $props();

  const tools = new AgentTools();
  /** Only tools on this computer, and the one picked now even when that one is missing. */
  const offered = $derived(tools.tools.filter((t) => t.installed || t.id === value));
  const picked = $derived(tools.tools.find((t) => t.id === value));
  const action = $derived(toolAction(picked));
  const throughMagpie = $derived(
    (model === undefined ? tools.officeModel : model)?.startsWith('magpie:') &&
      ['pi', 'claude', 'codex'].includes(value)
  );
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

{#if actionsOnly ? !!picked : offered.length}
  <div class={cls}>
    <div class="flex flex-wrap items-center gap-2" class:even={actionsOnly}>
      {#if !actionsOnly}
        <label class="flex flex-1 items-center gap-2 text-muted">
          Runs on
          <select
            class="flex-1 rounded-lg bg-raise px-1.5 py-1 text-ink"
            {value}
            onchange={(e) => onpick?.(e.currentTarget)}
          >
            {#each offered as t (t.id)}
              <option
                value={t.id}
                disabled={t.id === 'pi' &&
                  !(model === undefined ? tools.officeModel : model)?.startsWith('magpie:')}
                >{t.id === 'pi' &&
                !(model === undefined ? tools.officeModel : model)?.startsWith('magpie:')
                  ? 'Pi (built-in; choose a Magpie model in Setup)'
                  : t.installed
                    ? t.signIn && !t.signIn.signedIn && !throughMagpie
                      ? `${t.name} (not signed in)`
                      : t.name
                    : `${t.name} (not on this ${tools.computer})`}</option
              >
            {/each}
          </select>
        </label>
      {/if}
      {#if picked?.id === 'pi'}
        <span class="text-xs text-muted"
          >{picked.installed && !picked.tooOld
            ? 'Pi is included. Choose a Magpie model; no separate login is needed.'
            : 'The included Pi runner is unavailable. Rebuild or reinstall Oddboro.'}</span
        >
      {:else if picked && throughMagpie && !installOnly}
        <span class="text-xs text-muted">Uses the selected Magpie model connection.</span>
      {:else if picked && (picked.signIn || action === 'update') && (!installOnly || ['install', 'installing', 'update'].includes(action))}
        {@const t = picked}
        {#if action === 'update'}
          <button class="small" onclick={() => tools.install(t.id, 'update')}>Update</button>
        {:else if action === 'install'}
          <button class="small" onclick={() => tools.install(t.id)}>Install</button>
        {:else if action === 'installing'}
          <span class="text-muted">{tools.updating[t.id] ? 'Updating...' : 'Installing...'}</span>
        {:else if action === 'sign-in'}
          <button class="small" onclick={() => tools.signIn(t.id)}>Sign in</button>
        {:else if action === 'cancel'}
          {#if t.signIn?.waiting?.url}
            <a
              class="small"
              href={t.signIn.waiting.url}
              target="_blank"
              rel="noopener noreferrer"
              title="{MAKERS[t.id]}'s sign-in page">Open sign-in page</a
            >
          {/if}
          <button class="small" onclick={() => tools.cancel(t.id)}>Cancel</button>
        {:else if action === 'sign-in-again'}
          <button class="small" onclick={() => tools.signIn(t.id)}>Sign in again</button>
        {:else if action === 'key'}
          <button class="small" onclick={() => (keyOpen = !keyOpen)}
            >{t.signIn?.signedIn ? 'Use another key' : 'Add a key'}</button
          >
        {/if}
        {#if offersSignOut(t) && !installOnly}
          <button class="small" disabled={tools.busy === t.id} onclick={() => tools.signOut(t.id)}
            >Sign out</button
          >
        {/if}
      {/if}
    </div>
    {#if picked && (action === 'install' || action === 'installing') && INSTALL_NOTES[picked.id]}
      <p class="mt-1 text-muted">{INSTALL_NOTES[picked.id]}</p>
    {/if}
    {#if picked?.signIn && !throughMagpie && action === 'key' && keyOpen}
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
  /* Every action one size and one style: on the Model tab they share the row evenly. */
  .small {
    display: inline-block;
    border-radius: 0.5rem;
    text-align: center;
    background: var(--color-raise);
    /* As the Settings tab's own buttons (Add service), so none sits tight in its box. */
    padding-block: 0.25rem;
    padding-inline: 0.625rem;
    color: var(--color-ink);
  }
  .even .small {
    flex: 1 1 0;
    padding-block: 0.375rem;
  }
  .small:hover {
    background: rgb(255 255 255 / 0.12);
  }
  .small:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
