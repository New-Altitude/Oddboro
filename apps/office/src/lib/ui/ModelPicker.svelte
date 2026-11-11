<script lang="ts">
  // What an Odd runs on: the tool's tiles, the account it signs in with, the
  // model and how hard it thinks. An Odd's Model tab, where each pick saves at
  // once, and the hire window, where they wait for the hire, show this one. A
  // caller's own row (the Model tab's Permission level) sits between the model
  // and the thinking.
  import type { Snippet } from 'svelte';
  import {
    AGENT_NAMES,
    EFFORT_NAMES,
    EFFORT_ORDER,
    effortsOf,
    MANAGER_EFFORT_FLOOR,
    MODELS,
    OFFICE_ACCOUNT,
    type Agent,
    type Effort
  } from '@oddboro/ledger/agents';
  import type { AgentTools } from './agent-tools.svelte.ts';
  import RunsOn from './RunsOn.svelte';
  import ToolTiles from './ToolTiles.svelte';
  import { toolAction } from './tool-action.ts';
  import type { AgentTool } from '../../routes/api/agents/+server.ts';

  type SignInState = NonNullable<AgentTool['signIn']>;

  type Props = {
    tools: AgentTools;
    /** Whose runs these are, for the labels. */
    name: string;
    agent: Agent;
    /** The account it signs in with on that tool; none is the Office account. */
    account?: string | null;
    /** Its own model; none is the office's. */
    model?: string | null;
    /** The office's model on that tool, for the Office default card. */
    officeModel?: string;
    /** The level its runs take now. */
    effort?: Effort;
    /** The Office Manager runs the floor, so its levels below Medium are off. */
    manager?: boolean;
    onagent: (agent: Agent) => void;
    /** An account's id: `OFFICE_ACCOUNT` or one the owner added. */
    onaccount: (id: string) => void | Promise<void>;
    /** A model's id, or null for the office's. */
    onmodel: (model: string | null) => void;
    oneffort: (effort: Effort) => void;
    /** The caller's own row, between the model and the thinking. */
    children?: Snippet;
  };
  let {
    tools,
    name,
    agent,
    account,
    model,
    officeModel,
    effort,
    manager = false,
    onagent,
    onaccount,
    onmodel,
    oneffort,
    children
  }: Props = $props();

  /**
   * The accounts its tool signs in with: the Office account, then the ones
   * the owner added (accounts.ts). Gemini takes one key for the office, so it
   * has none to pick.
   */
  const accountList = $derived(
    agent === 'gemini'
      ? []
      : [
          {
            id: OFFICE_ACCOUNT,
            label: 'Office',
            signIn: tools.tools.find((t) => t.id === agent)?.signIn
          },
          ...tools.accounts.filter((a) => a.agent === agent)
        ]
  );
  /** The account it uses: one it was moved to that is still there, else Office. */
  const onAccount = $derived(accountList.some((a) => a.id === account) ? account! : OFFICE_ACCOUNT);
  const picked = $derived(accountList.find((a) => a.id === onAccount));
  let addingAccount = $state(false);
  let naming = $state('');
  /** The added account being renamed, and the name typed so far. */
  let renaming = $state<string | undefined>();
  let newName = $state('');

  async function rename(id: string) {
    if (await tools.renameAccount(agent, id, newName)) renaming = undefined;
  }

  /** A card's second line: who it is signed in as, or what it waits on. */
  function aboutAccount(s: SignInState | undefined): string {
    if (!s) return '';
    if (s.waiting) return 'Signing in';
    if (s.signedIn) return s.account ?? 'Signed in';
    if (s.ownLogin) return `Your own login for now`;
    return 'Not signed in';
  }

  /** Add an account, move to it, and open its sign-in. */
  async function addAccount() {
    const id = await tools.addAccount(agent, naming);
    if (!id) return;
    addingAccount = false;
    naming = '';
    await onaccount(id);
  }

  /** A tile's one word: Ready when runs can start on that tool now. */
  function stateOf(id: Agent): string {
    const t = tools.tools.find((x) => x.id === id);
    if (!t) return '';
    if (id === 'claude') return !t.installed ? 'Install' : t.tooOld ? 'Update' : 'Ready';
    const a = toolAction(t);
    if (a === 'install') return 'Install';
    if (a === 'installing') return tools.updating[id] ? 'Updating' : 'Installing';
    if (a === 'update') return 'Update';
    if (a === 'cancel') return 'Signing in';
    return t.signIn?.signedIn ? 'Ready' : 'Sign in';
  }

  const belowFloor = (e: Effort) =>
    manager && EFFORT_ORDER.indexOf(e) < EFFORT_ORDER.indexOf(MANAGER_EFFORT_FLOOR);

  /** The levels its runs take, on its own model when it has one. */
  const efforts = $derived(effortsOf(agent, model));

  /** A model's thinking levels, lowest to highest, for its card. */
  function levelsOf(id: string): string {
    const l = effortsOf(agent, id);
    return `Thinks ${EFFORT_NAMES[l[0]]} to ${EFFORT_NAMES[l[l.length - 1]]}`;
  }
</script>

{#snippet check()}
  <svg
    class="size-4 shrink-0 text-sea"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg
  >
{/snippet}

<ToolTiles {tools} picked={agent} onpick={onagent} {stateOf} label="What {name} runs on" />
<RunsOn value={agent} actionsOnly installOnly={agent !== 'gemini'} class="text-[11px]" />
{#if accountList.length}
  <div>
    <h3 class="text-xs font-semibold text-ink">Signed in with</h3>
    <div class="mt-1 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Account">
      {#each accountList as a (a.id)}
        {@const on = onAccount === a.id}
        <button
          class="card {on ? 'on' : ''}"
          role="radio"
          aria-checked={on}
          title={a.signIn?.ownLogin
            ? `Until you sign the office in, these runs use your own login, ${a.signIn.ownLogin}.`
            : undefined}
          onclick={() => !on && onaccount(a.id)}
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-ink">{a.label}</span>
            <span
              class="block truncate text-[10px] {a.signIn?.signedIn ? 'text-sea' : 'text-muted'}"
              >{aboutAccount(a.signIn)}</span
            >
          </span>
          {#if on}{@render check()}{/if}
        </button>
      {/each}
      {#if addingAccount}
        <form
          class="card col-span-2 gap-1.5"
          novalidate
          onsubmit={(e) => {
            e.preventDefault();
            if (naming.trim()) void addAccount();
          }}
        >
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="min-w-0 flex-1 rounded-md bg-night/50 px-2 py-1 text-xs outline-none placeholder:text-faint"
            aria-label="Name the account"
            placeholder="Name it, like Work or Personal"
            maxlength="40"
            autocomplete="off"
            autofocus
            bind:value={naming}
          />
          <button class="act" disabled={!naming.trim()}>Add and sign in</button>
          <button class="act" type="button" onclick={() => (addingAccount = false)}>Cancel</button>
        </form>
      {:else}
        <button class="card add" onclick={() => (addingAccount = true)}>
          <span class="text-xs text-muted">+ Add a sign-in</span>
        </button>
      {/if}
    </div>
    {#if picked?.signIn}
      {@const s = picked.signIn}
      {@const added = picked.id !== OFFICE_ACCOUNT}
      {#if s.ownLogin}
        <p class="mt-1.5 text-[10px] text-muted">
          Your office does not have its own {AGENT_NAMES[agent]} sign-in yet, so these runs use your own
          login, {s.ownLogin}. Sign the office in to keep the two apart.
        </p>
      {/if}
      <div class="mt-1.5 flex gap-1.5">
        {#if s.waiting}
          {#if s.waiting.url}
            <a class="act" href={s.waiting.url} target="_blank" rel="noopener noreferrer"
              >Open sign-in page</a
            >
          {/if}
          <button class="act" onclick={() => tools.cancel(agent)}>Cancel</button>
        {:else if s.signedIn}
          <button class="act" onclick={() => tools.signIn(agent, added ? picked.id : undefined)}
            >Switch account</button
          >
          <button
            class="act"
            disabled={tools.busy === agent}
            onclick={() => tools.signOut(agent, added ? picked.id : undefined)}>Sign out</button
          >
        {:else}
          <button class="act" onclick={() => tools.signIn(agent, added ? picked.id : undefined)}
            >Sign in</button
          >
        {/if}
        {#if added && !s.waiting}
          <button
            class="act"
            onclick={() => {
              renaming = picked.id;
              newName = picked.label;
            }}>Rename</button
          >
          <button
            class="act"
            disabled={tools.busy === agent}
            onclick={() => tools.removeAccount(agent, picked.id)}>Remove</button
          >
        {/if}
      </div>
      {#if added && renaming === picked.id}
        <form
          class="mt-1.5 flex gap-1.5"
          novalidate
          onsubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) void rename(picked.id);
          }}
        >
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="min-w-0 flex-1 rounded-lg bg-raise px-2 py-1 text-xs outline-none placeholder:text-faint"
            aria-label="A new name for {picked.label}"
            maxlength="40"
            autocomplete="off"
            autofocus
            bind:value={newName}
          />
          <button class="act" disabled={!newName.trim()}>Save</button>
          <button class="act" type="button" onclick={() => (renaming = undefined)}>Cancel</button>
        </form>
      {/if}
      {#if tools.problems[agent]}
        <p class="mt-1 text-[11px] text-coral">{tools.problems[agent]}</p>
      {/if}
    {/if}
  </div>
{/if}
{#if MODELS[agent].length}
  {@const office = MODELS[agent].find((m) => m.id === officeModel)}
  <div>
    <h3 class="text-xs font-semibold text-ink">Model</h3>
    <div class="mt-1 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Model">
      {#each [{ id: '', name: 'Office default', about: office ? `Now ${office.name}` : "The office's" }, ...MODELS[agent].map( (m) => ({ id: m.id, name: m.name, about: levelsOf(m.id) }) )] as m (m.id)}
        {@const on = (model ?? '') === m.id}
        <button
          class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-start {on
            ? 'bg-sea/15 ring-1 ring-sea'
            : 'bg-raise hover:bg-night/40'}"
          role="radio"
          aria-checked={on}
          onclick={() => !on && onmodel(m.id || null)}
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-ink">{m.name}</span>
            <span class="block truncate text-[10px] text-muted">{m.about}</span>
          </span>
          {#if on}{@render check()}{/if}
        </button>
      {/each}
    </div>
  </div>
{/if}
{@render children?.()}
<div>
  {#if efforts.length}
    <h3 class="text-xs font-semibold text-ink">Thinking</h3>
    <div class="mt-1 flex gap-1" role="radiogroup" aria-label="How hard {name} thinks">
      {#each efforts as e (e)}
        <button
          class="flex-1 rounded-lg px-1 py-2 text-xs whitespace-nowrap disabled:opacity-40 {effort ===
          e
            ? 'bg-sea/25 text-ink'
            : 'bg-raise text-muted hover:text-ink'}"
          role="radio"
          aria-checked={effort === e}
          disabled={belowFloor(e)}
          title={belowFloor(e)
            ? `The Office Manager thinks at ${EFFORT_NAMES[MANAGER_EFFORT_FLOOR]} or more`
            : undefined}
          onclick={() => effort !== e && oneffort(e)}>{EFFORT_NAMES[e]}</button
        >
      {/each}
    </div>
    <p class="mt-1 text-[10px] text-faint">
      Higher thinks longer and uses more of your plan.{manager
        ? ` The Office Manager stays at ${EFFORT_NAMES[MANAGER_EFFORT_FLOOR]} or more.`
        : ''}
    </p>
  {/if}
</div>

<style>
  /* An account or model card: one per choice, a check on the one picked. */
  .card {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border-radius: 0.5rem;
    background: var(--color-raise);
    padding: 0.5rem 0.625rem;
    text-align: start;
  }
  button.card:hover {
    background: color-mix(in srgb, var(--color-night) 40%, var(--color-raise));
  }
  .card.on {
    background: color-mix(in srgb, var(--color-sea) 15%, transparent);
    box-shadow: inset 0 0 0 1px var(--color-sea);
  }
  .card.add {
    justify-content: center;
    border: 1px dashed var(--color-hairline);
    background: transparent;
  }
  /* Every account action one size and one style, sharing the row evenly. */
  .act {
    display: inline-block;
    flex: 1 1 0;
    border-radius: 0.5rem;
    background: var(--color-raise);
    padding-block: 0.375rem;
    padding-inline: 0.625rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--color-ink);
  }
  .act:hover {
    background: rgb(255 255 255 / 0.12);
  }
  .act:disabled {
    opacity: 0.4;
  }
</style>
