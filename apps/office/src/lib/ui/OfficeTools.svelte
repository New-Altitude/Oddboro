<script lang="ts">
  import type { Agent } from '@oddboro/ledger/agents';
  import type { AgentTools } from './agent-tools.svelte.ts';
  import ClaudeCard from './onboarding/ClaudeCard.svelte';
  import ToolTiles from './ToolTiles.svelte';
  import type { AgentTool } from '../../routes/api/agents/+server.ts';
  import { INSTALL_NOTES, MAKERS, offersSignOut, offersUpdate, toolAction } from './tool-action.ts';

  // What the office runs on, on setup's Your AI card (onboarding/AiCard.svelte)
  // and in the Setup tab (Welcome.svelte): a square tile for every coding
  // tool, with its maker's mark, on every system (ToolTiles.svelte, as on an
  // Odd's Model tab). A tile this system offers picks the office's tool; one it
  // does not offer yet is greyed, with why.
  // Below the tiles, the picked tool's own panel: install it, sign in on its
  // maker's page, or take an API key, each with its one action (`toolAction`,
  // as beside "Runs on"). Each says its version: one older than the office
  // runs offers Update first, and one with a newer version out offers it in
  // one click. Claude Code's panel is ClaudeCard: its plan or key, and its model.
  // Each tile says Ready when its tool is signed in, whichever tool is picked:
  // Claude Code's when its plan is signed in or a key is in use (`keyInUse`).
  type Props = {
    tools: AgentTools;
    /** Claude's model, when the office runs on Claude Code. */
    onmodel?: (m: 'opus' | 'sonnet') => void;
    /** Whether Claude Code can run Odds: signed in, or a key in use. */
    onclaudeready?: (ready: boolean) => void;
  };
  let { tools, onmodel = () => {}, onclaudeready = () => {} }: Props = $props();

  /** What the Claude panel last said: signed in on the plan, or a key in use. */
  let claudeReady = $state<boolean | undefined>();
  /** The key a key tool's field holds, by tool. */
  let keys = $state<Partial<Record<Agent, string>>>({});
  /** Key tools whose field is open over a key they already have. */
  let replacing = $state<Partial<Record<Agent, boolean>>>({});

  const picked = $derived(tools.tools.find((t) => t.id === tools.office));

  async function saveKey(id: Agent) {
    if (await tools.setKey(id, (keys[id] ?? '').trim())) {
      keys[id] = '';
      replacing[id] = false;
    }
  }

  /** A tile's one-word state. */
  function stateOf(id: Agent): string {
    const t = tools.tools.find((x) => x.id === id);
    if (!t) return '';
    const busy = tools.updating[id] ? 'Updating' : 'Installing';
    if (id === 'claude') {
      if (tools.installingClaude) return busy;
      if (!t.installed) return 'Install';
      if (t.tooOld) return 'Update';
      // The panel's word once it has spoken, which stays after another tool is picked.
      return (claudeReady ?? (!!t.signIn?.signedIn || !!t.keyInUse)) ? 'Ready' : 'Installed';
    }
    const action = toolAction(t);
    if (action === 'install') return 'Install';
    if (action === 'installing') return busy;
    if (action === 'update') return 'Update';
    if (action === 'cancel') return 'Signing in';
    return t.signIn?.signedIn ? 'Ready' : 'Sign in';
  }
</script>

{#snippet versionLine(t: AgentTool)}
  {#if t.tooOld}
    <p class="mt-2 text-sm text-coral">
      {t.name}
      {t.version} is older than this office runs ({t.tooOld} or newer). Update it to go on.
    </p>
  {:else if t.version}
    <p class="mt-2 text-xs text-muted">
      Version {t.version}{t.newer ? `. ${t.newer} is out.` : ''}
    </p>
  {/if}
{/snippet}

{#snippet updateButton(t: AgentTool)}
  {#if t.tooOld}
    <button class="wide" onclick={() => tools.install(t.id, 'update')}>Update {t.name}</button>
  {:else if offersUpdate(t)}
    <button class="wide" onclick={() => tools.install(t.id, 'update')}>Update to {t.newer}</button>
  {/if}
{/snippet}

<!-- A sign-in finished on its own page shows here when the owner comes back. -->
<svelte:window onfocus={() => tools.waiting && void tools.load()} />

<ToolTiles
  {tools}
  picked={tools.office}
  onpick={(id) => tools.pickOffice(id)}
  {stateOf}
  label="What your office runs on"
/>

{#if picked}
  <div class="mt-3">
    {#if picked.id === 'claude'}
      {#if !picked.installed}
        <div class="panel p-3">
          <p class="text-sm">
            {tools.installingClaude
              ? 'Installing Claude Code.'
              : `Claude Code, by ${MAKERS.claude}, is not on this ${tools.computer} yet.`}
          </p>
          {#if !tools.installingClaude}
            <button class="btn mt-2" onclick={() => tools.install('claude')}
              >Install Claude Code</button
            >
          {/if}
        </div>
      {:else}
        {#if tools.installingClaude || picked.tooOld || offersUpdate(picked) || picked.version}
          <div class="panel mb-3">
            <div class="px-3 pb-3">
              {#if tools.installingClaude}
                <p class="mt-2 text-sm text-muted">Updating Claude Code.</p>
              {:else}
                {@render versionLine(picked)}
              {/if}
            </div>
            {#if !tools.installingClaude}{@render updateButton(picked)}{/if}
          </div>
        {/if}
        <ClaudeCard
          {onmodel}
          onready={(r) => {
            claudeReady = r;
            onclaudeready(r);
          }}
        />
      {/if}
    {:else}
      {@const t = picked}
      {@const s = t.signIn}
      {@const action = toolAction(t)}
      <div class="panel">
        <div class="p-3">
          <div class="text-[10px] tracking-[0.14em] text-muted uppercase">
            {s?.how === 'key' ? 'API key' : 'Signed in as'}
          </div>
          <p class="mt-1 text-sm wrap-anywhere">
            {#if action === 'install'}
              <span class="text-muted">{t.name} is not on this {tools.computer} yet.</span>
            {:else if action === 'installing'}
              <span class="text-muted"
                >{tools.updating[t.id] ? 'Updating' : 'Installing'} {t.name}.</span
              >
            {:else if action === 'cancel'}
              <span class="text-muted">Finish signing in on {MAKERS[t.id]}'s page.</span>
              {#if s?.waiting?.url}
                <a class="link" href={s.waiting.url} target="_blank" rel="noopener noreferrer"
                  >Open the page</a
                >
              {/if}
            {:else if s?.how === 'key'}
              <span class:text-muted={!s.signedIn}
                >{s.signedIn
                  ? "Your key is in this computer's password store."
                  : 'No API key yet.'}</span
              >
            {:else if s?.signedIn}
              <span class="font-medium">{s.account ?? 'Your account'}</span>
            {:else}
              <span class="text-muted">{t.name} is not signed in for this office.</span>
            {/if}
          </p>
          {#if (action === 'install' || action === 'installing') && INSTALL_NOTES[t.id] && !tools.updating[t.id]}
            <p class="mt-2 text-xs text-faint">{INSTALL_NOTES[t.id]}</p>
          {:else if action !== 'installing'}
            {@render versionLine(t)}
          {/if}
          {#if s && action === 'key' && (!s.signedIn || replacing[t.id])}
            <form
              class="mt-2"
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
                The office tries the key once, then keeps it in this computer's password store,
                never in a file.
              </p>
            </form>
          {/if}
        </div>
        {#if action === 'install'}
          <button class="wide" onclick={() => tools.install(t.id)}>Install {t.name}</button>
        {:else if action === 'sign-in'}
          <button class="wide" onclick={() => tools.signIn(t.id)}
            >Sign in with {MAKERS[t.id]}</button
          >
        {:else if action === 'cancel'}
          <button class="wide" onclick={() => tools.signIn(t.id)}
            >Open the sign-in page again</button
          >
          <button class="wide" onclick={() => tools.cancel(t.id)}>Cancel signing in</button>
        {:else if action === 'sign-in-again'}
          <button class="wide" onclick={() => tools.signIn(t.id)}>Switch account</button>
        {:else if action === 'key' && s?.signedIn}
          <button class="wide" onclick={() => (replacing[t.id] = !replacing[t.id])}
            >Use another key</button
          >
        {/if}
        {#if offersSignOut(t)}
          <button class="wide" disabled={tools.busy === t.id} onclick={() => tools.signOut(t.id)}
            >Sign out</button
          >
        {/if}
        {#if action !== 'installing'}{@render updateButton(t)}{/if}
      </div>
    {/if}
    {#if tools.problems[picked.id]}
      <p class="mt-2 rounded-lg bg-coral/15 px-3 py-2 text-sm text-coral">
        {tools.problems[picked.id]}
      </p>
    {/if}
  </div>
{/if}

<style>
  .panel {
    overflow: hidden;
    border-radius: 0.75rem;
    background: var(--color-raise);
  }
  .wide {
    display: block;
    width: 100%;
    border-top: 1px solid var(--color-hairline);
    background: rgb(255 255 255 / 0.04);
    padding: 0.6rem;
    font-size: 0.875rem;
    color: var(--color-muted);
  }
  .wide:hover {
    background: rgb(255 255 255 / 0.08);
    color: var(--color-ink);
  }
</style>
