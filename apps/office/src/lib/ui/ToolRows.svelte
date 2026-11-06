<script lang="ts">
  import type { Agent } from '@oddboro/ledger/agents';
  import type { AgentTools } from './agent-tools.svelte.ts';
  import { INSTALL_NOTES, MAKERS, offersSignOut, signInRows, toolAction } from './tool-action.ts';

  // Other AI tools, on onboarding's card (onboarding/ToolsCard.svelte) and in
  // the Setup window (Welcome.svelte): each coding tool this system offers
  // besides Claude Code, with its sign-in in the office. A tool not installed
  // installs from here with its own installer. A browser tool signs in on its
  // maker's page and can sign in again over a sign-in that stopped working; a
  // key tool takes an API key. Each row's one action comes from `toolAction`,
  // as beside "Runs on".
  type Props = { tools: AgentTools };
  let { tools }: Props = $props();

  const rows = $derived(signInRows(tools.tools));
  /** The key a key tool's field holds, by tool. */
  let keys = $state<Partial<Record<Agent, string>>>({});
  /** Key tools whose field is open over a key they already have. */
  let replacing = $state<Partial<Record<Agent, boolean>>>({});

  async function saveKey(id: Agent) {
    if (await tools.setKey(id, (keys[id] ?? '').trim())) {
      keys[id] = '';
      replacing[id] = false;
    }
  }
</script>

<!-- A sign-in finished on its own page shows here when the owner comes back. -->
<svelte:window onfocus={() => tools.waiting && void tools.load()} />

<ul class="flex flex-col gap-1 rounded-xl bg-raise p-1.5">
  {#each rows as { tool: t, signIn: s } (t.id)}
    {@const action = toolAction(t)}
    <!-- A stack, so the state keeps the row's whole width in a narrow panel. -->
    <li class="flex flex-col gap-1.5 rounded-lg px-2 py-2">
      <span
        ><span class="font-medium">{t.name}</span><span class="text-muted">, by {MAKERS[t.id]}</span
        ></span
      >
      <span class="text-sm wrap-anywhere text-muted">
        {#if action === 'install'}
          Not installed
        {:else if action === 'installing'}
          Installing...
        {:else if action === 'cancel'}
          Finish signing in on {MAKERS[t.id]}'s sign-in page.
          {#if s.waiting?.url}
            <a class="link" href={s.waiting.url} target="_blank" rel="noopener noreferrer"
              >Open the page</a
            >
          {/if}
        {:else if s.how === 'key'}
          {s.signedIn ? 'Uses your API key' : 'No API key yet'}
        {:else if s.signedIn}
          {s.account ? `Signed in as ${s.account}` : 'Signed in'}
        {:else}
          Not signed in
        {/if}
      </span>
      <!-- Installing offers nothing, and a key tool with no key takes it in the form below. -->
      {#if action !== 'installing' && (action !== 'key' || s.signedIn)}
        <div class="flex flex-wrap gap-2">
          {#if action === 'install'}
            <button class="btn" onclick={() => tools.install(t.id)}>Install</button>
          {:else if action === 'sign-in'}
            <button class="btn" onclick={() => tools.signIn(t.id)}>Sign in</button>
          {:else if action === 'cancel'}
            <button class="btn" onclick={() => tools.cancel(t.id)}>Cancel</button>
          {:else if action === 'sign-in-again'}
            <button class="btn" onclick={() => tools.signIn(t.id)}>Sign in again</button>
          {:else if action === 'key'}
            <button class="btn" onclick={() => (replacing[t.id] = !replacing[t.id])}
              >Use another key</button
            >
          {/if}
          {#if offersSignOut(t)}
            <button class="btn" disabled={tools.busy === t.id} onclick={() => tools.signOut(t.id)}
              >Sign out</button
            >
          {/if}
        </div>
      {/if}
      {#if (action === 'install' || action === 'installing') && INSTALL_NOTES[t.id]}
        <p class="text-xs text-muted">{INSTALL_NOTES[t.id]}</p>
      {:else if action === 'key' && (!s.signedIn || replacing[t.id])}
        <form
          novalidate
          onsubmit={(e) => {
            e.preventDefault();
            if (keys[t.id]?.trim()) void saveKey(t.id);
          }}
        >
          <div class="flex gap-2">
            <input
              class="field min-w-0 flex-1"
              type="password"
              aria-label="{t.name} API key"
              placeholder="{t.name} API key"
              autocomplete="off"
              spellcheck="false"
              bind:value={keys[t.id]}
            />
            <button class="btn" disabled={!keys[t.id]?.trim() || tools.busy === t.id}
              >{tools.busy === t.id ? 'Trying it' : 'Use this key'}</button
            >
          </div>
          <p class="mt-2 text-xs text-faint">
            Get a key at aistudio.google.com/apikey. The office tries it once, then keeps it in this
            computer's password store, never in a file.
          </p>
        </form>
      {/if}
      {#if tools.problems[t.id]}
        <p class="rounded-lg bg-coral/15 px-3 py-2 text-sm text-coral">
          {tools.problems[t.id]}
        </p>
      {/if}
    </li>
  {/each}
</ul>
