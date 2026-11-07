<script lang="ts">
  import type { Agent } from '@oddboro/ledger/agents';
  import type { AgentTools } from './agent-tools.svelte.ts';
  import { MagpieConnection } from './magpie.svelte.ts';
  import { magpieRunner } from './magpie-ui.ts';
  import MagpieSetup from './MagpieSetup.svelte';
  import ClaudeCard from './onboarding/ClaudeCard.svelte';
  import ToolTiles from './ToolTiles.svelte';
  import type { AgentTool } from '../../routes/api/agents/+server.ts';
  import { INSTALL_NOTES, MAKERS, offersSignOut, offersUpdate, toolAction } from './tool-action.ts';

  // Setup and onboarding expose one Magpie source tile, not a separate Pi setup.
  // `tools.office` still stores the real runner. New Magpie choices use bundled
  // Pi; `officeConfigured` preserves an owner's explicit Claude/Codex choice.
  // The connection/model save stays separate from runner selection in the API,
  // while this shared component presents one flow and hides direct login panels.
  // An Odd's advanced ToolTiles still names the actual Pi runner when needed.
  // The run layer owns the shared office file MCP and tool approval gates;
  // choosing a model source here never grants folders or outside write access.
  type Props = {
    tools: AgentTools;
    /** Claude's model, when the office runs on Claude Code. */
    onmodel?: (m: 'opus' | 'sonnet') => void;
    /** Whether Claude Code can run Odds: signed in, or a key in use. */
    onclaudeready?: (ready: boolean) => void;
  };
  let { tools, onmodel = () => {}, onclaudeready = () => {} }: Props = $props();

  let claudeReady = $state(false);
  const connection = new MagpieConnection();
  let choosing = $state(false);
  const magpieState = $derived(
    connection.busy || choosing
      ? 'Checking'
      : connection.setup?.status === 'authorization-required'
        ? 'Connect'
        : connection.setup?.status === 'unavailable'
          ? 'Unavailable'
          : tools.tools.find((tool) => tool.id === tools.selectedOffice)?.magpieReady
            ? 'Ready'
            : connection.state?.connected
              ? 'Choose model'
              : 'Set up'
  );

  async function chooseMagpie() {
    if (choosing || connection.busy) return;
    tools.modelSource = 'magpie';
    tools.officeProblem = '';
    choosing = true;
    try {
      const runner = magpieRunner(tools.office, tools.tools, tools.officeConfigured);
      if (!runner) {
        connection.problem = 'The included Pi runner is unavailable. Rebuild or reinstall Oddboro.';
        return;
      }
      if (runner !== tools.office && !(await tools.pickOffice(runner))) return;
      await connection.act({ action: 'setup' });
      await tools.load();
    } finally {
      choosing = false;
    }
  }

  async function chooseDirect(id: Agent) {
    if (choosing || connection.busy) return;
    choosing = true;
    try {
      if (await tools.pickOffice(id, null)) tools.modelSource = 'direct';
    } finally {
      choosing = false;
    }
  }

  async function chooseIncludedPi() {
    if (choosing || connection.busy) return;
    choosing = true;
    try {
      // Deliberate runner migration keeps the current gateway selection. An
      // incomplete connection is allowed here; onboarding still gates Next.
      if (await tools.pickOffice('pi')) tools.modelSource = 'magpie';
    } finally {
      choosing = false;
    }
  }
  /** The key a key tool's field holds, by tool. */
  let keys = $state<Partial<Record<Agent, string>>>({});
  /** Key tools whose field is open over a key they already have. */
  let replacing = $state<Partial<Record<Agent, boolean>>>({});

  const picked = $derived(tools.tools.find((t) => t.id === tools.selectedOffice));

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
    if (id === 'pi') return t.installed && !t.tooOld ? 'Included' : 'Unavailable';
    const busy = tools.updating[id] ? 'Updating' : 'Installing';
    if (id === 'claude') {
      if (tools.installingClaude) return busy;
      if (!t.installed) return 'Install';
      if (t.tooOld) return 'Update';
      return tools.office === 'claude' && claudeReady ? 'Ready' : 'Installed';
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
  {#if t.tooOld && t.id === 'pi'}
    <p class="mt-2 text-sm text-coral">
      The included Pi version does not match this office. Rebuild or reinstall Oddboro.
    </p>
  {:else if t.tooOld}
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
  hideBuiltInPi
  picked={tools.magpieSelected ? 'magpie' : tools.office}
  onpick={chooseDirect}
  magpie={{
    state: magpieState,
    disabled: !tools.loaded || choosing || connection.busy,
    onpick: () => {
      void chooseMagpie();
    }
  }}
  {stateOf}
  label="What your office runs on"
/>
{#if tools.officeProblem}<p class="mt-2 text-sm text-coral" role="alert">
    {tools.officeProblem}
  </p>{/if}

{#if picked}
  <div class="mt-3">
    {#if tools.magpieSelected}
      <div class="panel p-3">
        <p class="text-sm">Magpie supplies the model. {picked.name} runs your Odds.</p>
        <p class="mt-1 text-xs text-muted">
          {choosing || connection.busy
            ? 'Checking for existing Magpie, then setting up the built-in runtime if needed.'
            : !picked.installed
              ? picked.id === 'pi'
                ? 'The included Pi runner is unavailable. Rebuild or reinstall Oddboro.'
                : `Install ${picked.name} to use your selected runner with Magpie.`
              : picked.magpieReady
                ? 'The gateway is ready. A direct vendor sign-in is not needed for this route.'
                : 'Finish the Magpie connection and choose a ready model or group below.'}
        </p>
        {#if picked.id === 'pi'}<p class="mt-1 text-xs text-muted">
            Pi is included with Oddboro. It needs no separate install or login.
          </p>{/if}
        {#if picked.id !== 'pi' && tools.tools.some((tool) => tool.id === 'pi')}
          <button class="btn mt-2" disabled={choosing || connection.busy} onclick={chooseIncludedPi}
            >Use included Pi</button
          >
          <p class="mt-1 text-xs text-muted">Keep this Magpie connection and selected model.</p>
        {/if}
        <p class="mt-1 text-xs text-muted">Magpie setup checks the computer running Oddboro.</p>
        {@render versionLine(picked)}
        {#if !picked.installed && picked.id !== 'pi'}<button
            class="wide mt-2"
            disabled={choosing || connection.busy}
            onclick={() => tools.install(picked.id)}>Install {picked.name}</button
          >{:else if picked.tooOld && picked.id !== 'pi'}{@render updateButton(picked)}{/if}
      </div>
    {:else if picked.id === 'pi'}
      <p class="text-sm text-muted">
        Pi is included and requires a Magpie model. Choose the Magpie tile to connect it.
      </p>
    {:else if picked.id === 'claude'}
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

{#if tools.magpieSelected}<MagpieSetup {tools} {connection} onsetup={chooseMagpie} />{/if}

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
