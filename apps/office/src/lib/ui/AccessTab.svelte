<script lang="ts">
  import type { Candidate, HeldBack } from '@oddboro/ledger';
  import {
    POSTAL_ID,
    GRANT_LABEL,
    LEVEL_LABEL,
    LEVELS,
    GRANT_NEEDS,
    grantWorks,
    writesWait,
    MODEL_SECTION,
    OFFICE_SECTION,
    SWITCH_NAMES,
    type GrantLevel,
    type Level
  } from '@oddboro/ledger/access';
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
  import { OFFICE_TOOLS } from '@oddboro/ledger/tools';
  import { AgentTools } from './agent-tools.svelte.ts';
  import { call } from './api.ts';
  import FoldersList from './FoldersList.svelte';
  import RunsOn from './RunsOn.svelte';
  import ServiceActions from './ServiceActions.svelte';
  import ToolTiles from './ToolTiles.svelte';
  import { toolAction } from './tool-action.ts';
  import type { StaffProfile } from '../staff/roster.ts';
  import type { AgentTool } from '../../routes/api/agents/+server.ts';

  type SignInState = NonNullable<AgentTool['signIn']>;

  type Grant = {
    connector: string;
    name: string;
    level: GrantLevel;
    /** What a run reaches, like "3 tools" or "every tool". */
    reach: string;
    heldBack: HeldBack | null;
    /** An AWS tool already connected, which can move to another role or Region. */
    changes: boolean;
  };
  /** A Google connector: one account of Gmail or Google Drive. */
  type Google = { product: 'gmail' | 'drive'; name: string; account?: string };
  type Own = {
    id: string;
    name: string;
    description: string;
    kind: string;
    ready: boolean;
    byAddress: boolean;
    keyHeader?: string;
    google?: Google;
  };
  /** A hosted server named by its address lets the office in with a sign-in, or a key in a header. */
  type Pick = {
    id: string;
    name: string;
    kind: string;
    byAddress?: boolean;
    keyHeader?: string;
    ready?: boolean;
    google?: Google;
  };
  type Props = { profile: StaffProfile; version: number };
  let { profile, version }: Props = $props();

  let grants = $state<Grant[]>([]);
  let adding = $state(false);
  let q = $state('');
  let found = $state<{ catalog: Own[]; registry: Candidate[]; problem?: string }>({
    catalog: [],
    registry: []
  });
  let pick = $state<Pick | undefined>();
  let level = $state<GrantLevel>('read');
  let useKey = $state(false);
  let keyHeader = $state('');
  /** Pick a tool. One named by its address starts on the way in it has, or a sign-in. */
  function choose(p: Pick) {
    pick = p;
    if (p.id === POSTAL_ID) level = 'read';
    another = false;
    useKey = !!p.keyHeader;
    keyHeader = p.keyHeader ?? 'Authorization';
  }
  /** Gmail or Google Drive, picked once one account of it is connected: the connected accounts, to pick one or add another. */
  const accounts = $derived(
    pick?.google
      ? found.catalog.filter((c) => c.ready && c.google?.product === pick?.google?.product)
      : []
  );
  /** A new connector for one more Google account, made as the grant goes. */
  let another = $state(false);
  /**
   * Another Google account: one of this product still waiting on its sign-in
   * when there is one, so empty ones never pile up, else a new one.
   */
  function addAnother() {
    const spare = found.catalog.find(
      (c) => !c.ready && c.google?.product === pick?.google?.product
    );
    another = !spare;
    if (spare) pick = { ...spare, byAddress: false };
  }
  /** Whether the grant goes to an account not signed in yet: a new one, or a connector still waiting on its sign-in. */
  const newAccount = $derived(another || (!!pick?.google && !pick.ready));
  let problem = $state('');
  /** Why the one-click move was refused. It shows under its button, since the tab's foot is out of sight. */
  let refused = $state('');
  let done = $state('');

  $effect(() => {
    void version;
    call<Grant[]>(`/api/staff/${profile.id}/access`)
      .then((g) => (grants = g))
      .catch(() => {});
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    if (!adding) return;
    const query = q;
    clearTimeout(timer);
    timer = setTimeout(() => {
      call<typeof found>(`/api/connectors?q=${encodeURIComponent(query)}`)
        .then((r) => (found = r))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  });

  async function grant() {
    if (!pick) return;
    problem = refused = '';
    try {
      const r = await call<{ task: boolean }>(`/api/staff/${profile.id}/access`, {
        connector: pick.id,
        level,
        another: another || undefined,
        way: pick.byAddress ? { keyHeader: useKey ? keyHeader.trim() : undefined } : undefined
      });
      const what =
        accounts.length && newAccount
          ? `another Google account for ${pick.google?.name}`
          : pick.name;
      done = r.task
        ? `A task with the steps to connect ${what} is on your desk.`
        : `${profile.name} can use ${pick.name} now.`;
      adding = false;
      pick = undefined;
      q = '';
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  /** Read only or Read and write, in place: the tool stays signed in. */
  async function relevel(g: Grant, to: GrantLevel) {
    if (g.level === to) return;
    problem = '';
    try {
      await call(`/api/staff/${profile.id}/access`, { connector: g.connector, level: to }, 'PATCH');
      // The grants table's change brings the list back from the office, as a revoke does.
      g.level = to;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  async function revoke(g: Grant) {
    problem = '';
    try {
      await call(
        `/api/staff/${profile.id}/access?connector=${encodeURIComponent(g.connector)}`,
        undefined,
        'DELETE'
      );
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  /** Why its runs leave a granted tool out, for the owner. Grants are read or act, so only act can sit above a level. */
  const HELD_BACK: Record<HeldBack, string> = {
    'above its level': `held back until you set its level to ${LEVEL_LABEL[GRANT_NEEDS.act]} or higher`,
    'still connecting': 'waiting on your steps',
    'sign-in ran out': 'sign in again'
  };
  const levels: GrantLevel[] = ['read', 'act'];
  /** Write works from Draft, where each change waits for the owner's yes. */
  const allowed = (l: GrantLevel) => grantWorks(l, profile.permission);
  const isUrl = $derived(/^https:\/\/\S+$/.test(q.trim()));

  const GRANTABLE = OFFICE_TOOLS.filter((t) => !t.always);
  async function setTool(tool: string, on: boolean) {
    problem = refused = '';
    try {
      await call(`/api/staff/${profile.id}`, { tool, on }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  /** The page shows how Run commands reaches the Odd's tool and what its runs get; only the server works either out. */
  const how = $derived(profile.reach.commandsHow);
  async function setOwnTool(which: 'commands' | 'web', box: HTMLInputElement) {
    problem = refused = '';
    try {
      await call(`/api/staff/${profile.id}`, { [which]: box.checked }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      // The switch did not change, so nothing redraws the box.
      box.checked = !box.checked;
    }
  }

  /** The tools, for the Model tab's tiles: the same list setup shows. */
  const agentTools = new AgentTools();

  /**
   * The accounts its tool signs in with: the Office account, then the ones
   * the owner added (accounts.ts). Gemini takes one key for the office, so it
   * has none to pick.
   */
  const accountList = $derived(
    profile.agent === 'gemini'
      ? []
      : [
          {
            id: OFFICE_ACCOUNT,
            label: 'Office',
            signIn: agentTools.tools.find((t) => t.id === profile.agent)?.signIn
          },
          ...agentTools.accounts.filter((a) => a.agent === profile.agent)
        ]
  );
  /** The account it uses: one it was moved to that is still there, else Office. */
  const onAccount = $derived(
    accountList.some((a) => a.id === profile.account) ? profile.account! : OFFICE_ACCOUNT
  );
  const picked = $derived(accountList.find((a) => a.id === onAccount));
  let addingAccount = $state(false);
  let naming = $state('');
  /** The added account being renamed, and the name typed so far. */
  let renaming = $state<string | undefined>();
  let newName = $state('');

  async function rename(account: string) {
    if (await agentTools.renameAccount(profile.agent, account, newName)) renaming = undefined;
  }

  /** A card's second line: who it is signed in as, or what it waits on. */
  function aboutAccount(s: SignInState | undefined): string {
    if (!s) return '';
    if (s.waiting) return 'Signing in';
    if (s.signedIn) return s.account ?? 'Signed in';
    if (s.ownLogin) return `Your own login for now`;
    return 'Not signed in';
  }

  async function pickAccount(id: string) {
    problem = refused = '';
    try {
      await call(
        `/api/staff/${profile.id}`,
        { account: id === OFFICE_ACCOUNT ? null : id },
        'PATCH'
      );
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  /** Add an account, move this Odd to it, and open its sign-in. */
  async function addAccount() {
    const id = await agentTools.addAccount(profile.agent, naming);
    if (!id) return;
    addingAccount = false;
    naming = '';
    await pickAccount(id);
  }

  async function pickAgent(agent: Agent) {
    problem = refused = '';
    try {
      await call(`/api/staff/${profile.id}`, { agent }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  /** A tile's one word for this Odd: Ready when its runs can start on that tool now. */
  function stateOf(id: Agent): string {
    const t = agentTools.tools.find((x) => x.id === id);
    if (!t) return '';
    if (id === 'claude') return !t.installed ? 'Install' : t.tooOld ? 'Update' : 'Ready';
    const a = toolAction(t);
    if (a === 'install') return 'Install';
    if (a === 'installing') return agentTools.updating[id] ? 'Updating' : 'Installing';
    if (a === 'update') return 'Update';
    if (a === 'cancel') return 'Signing in';
    return t.signIn?.signedIn ? 'Ready' : 'Sign in';
  }

  /** The Office Manager runs the floor, so its levels below Medium are off. */
  const manager = $derived(profile.role === 'Office Manager');
  const belowFloor = (e: Effort) =>
    manager && EFFORT_ORDER.indexOf(e) < EFFORT_ORDER.indexOf(MANAGER_EFFORT_FLOOR);

  /** The levels its runs take, on its own model when it has one. */
  const efforts = $derived(effortsOf(profile.agent, profile.model));

  async function setModel(model: string | null) {
    problem = refused = '';
    try {
      await call(`/api/staff/${profile.id}`, { model }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  /** A model's thinking levels, lowest to highest, for its card. */
  function levelsOf(model: string): string {
    const l = effortsOf(profile.agent, model);
    return `Thinks ${EFFORT_NAMES[l[0]]} to ${EFFORT_NAMES[l[l.length - 1]]}`;
  }

  async function setEffort(effort: Effort) {
    problem = refused = '';
    try {
      await call(`/api/staff/${profile.id}`, { effort }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
  }

  /** The one click under a switch the Odd's tool cannot follow: the move and the switch, in one PATCH. */
  async function moveFor(offer: Agent) {
    problem = refused = '';
    try {
      await call(`/api/staff/${profile.id}`, { agent: offer, commands: true }, 'PATCH');
    } catch (e) {
      refused = e instanceof Error ? e.message : String(e);
    }
  }

  /**
   * The four tabs: the model its runs go through (the tool, its permission
   * level and how hard it thinks), what it may do in the office (Run
   * commands, Browse the web and the office's own tools), the folders it is
   * given, and the outside services it may use. Each has an icon, which is
   * all it shows when the bar is too narrow for the words.
   */
  const TABS = [
    {
      id: 'model',
      label: MODEL_SECTION,
      icon: 'M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6zM10 10h4v4h-4z'
    },
    {
      id: 'office',
      label: OFFICE_SECTION,
      icon: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3'
    },
    {
      id: 'folders',
      label: 'Folders',
      icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
    },
    {
      id: 'services',
      label: 'Services',
      icon: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4'
    }
  ] as const;
  let tab = $state<(typeof TABS)[number]['id']>('model');

  /** What the owner typed to find an entry in the open list, as each list grows. */
  let find = $state('');
  const matches = (...texts: string[]) => {
    const f = find.trim().toLowerCase();
    return !f || texts.some((t) => t.toLowerCase().includes(f));
  };
  const FIND_IN = {
    office: 'Find an office tool',
    folders: 'Find a folder',
    services: 'Find a service'
  } as const;
  const officeTools = $derived(GRANTABLE.filter((t) => matches(t.name, t.does)));
  const shownGrants = $derived(grants.filter((g) => matches(g.name, GRANT_LABEL[g.level])));
  const commandsShown = $derived(
    matches(SWITCH_NAMES.commands, how.state === 'switch' ? '' : how.why)
  );
  const webShown = $derived(matches(SWITCH_NAMES.web, profile.webLine));

  async function setPermission(permission: Level) {
    problem = refused = '';
    try {
      await call(`/api/staff/${profile.id}`, { permission }, 'PATCH');
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    }
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

<div class="flex h-full min-h-0 flex-col">
  <div
    class="tabs flex gap-1 border-b border-hairline px-3 py-2"
    role="tablist"
    aria-label="Access"
  >
    {#each TABS as t (t.id)}
      <button
        id="access-tab-{t.id}-{profile.id}"
        class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs {tab ===
        t.id
          ? 'bg-sea/25 text-ink'
          : 'bg-raise text-muted hover:text-ink'}"
        role="tab"
        aria-selected={tab === t.id}
        aria-controls="access-panel-{profile.id}"
        aria-label={t.label}
        title={t.label}
        onclick={() => {
          tab = t.id;
          find = '';
        }}
      >
        <svg
          class="size-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d={t.icon} /></svg
        >
        <span class="word">{t.label}</span>
      </button>
    {/each}
  </div>
  <div
    id="access-panel-{profile.id}"
    class="flex-1 overflow-y-auto p-3"
    role="tabpanel"
    aria-labelledby="access-tab-{tab}-{profile.id}"
  >
    {#if tab !== 'model'}
      <input
        class="mb-2 w-full rounded-lg bg-raise px-2.5 py-1.5 text-sm outline-none placeholder:text-faint"
        type="search"
        aria-label={FIND_IN[tab]}
        placeholder={FIND_IN[tab]}
        autocomplete="off"
        spellcheck="false"
        bind:value={find}
      />
    {/if}
    {#if tab === 'model'}
      <section aria-label={MODEL_SECTION} class="flex flex-col gap-3">
        <ToolTiles
          tools={agentTools}
          picked={profile.agent}
          onpick={pickAgent}
          {stateOf}
          label="What {profile.name} runs on"
        />
        <RunsOn
          value={profile.agent}
          actionsOnly
          installOnly={profile.agent !== 'gemini'}
          class="text-[11px]"
        />
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
                  onclick={() => !on && pickAccount(a.id)}
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-xs font-medium text-ink">{a.label}</span>
                    <span
                      class="block truncate text-[10px] {a.signIn?.signedIn
                        ? 'text-sea'
                        : 'text-muted'}">{aboutAccount(a.signIn)}</span
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
                  <button class="act" type="button" onclick={() => (addingAccount = false)}
                    >Cancel</button
                  >
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
                  Your office does not have its own {AGENT_NAMES[profile.agent]} sign-in yet, so these
                  runs use your own login, {s.ownLogin}. Sign the office in to keep the two apart.
                </p>
              {/if}
              <div class="mt-1.5 flex gap-1.5">
                {#if s.waiting}
                  {#if s.waiting.url}
                    <a class="act" href={s.waiting.url} target="_blank" rel="noopener noreferrer"
                      >Open sign-in page</a
                    >
                  {/if}
                  <button class="act" onclick={() => agentTools.cancel(profile.agent)}
                    >Cancel</button
                  >
                {:else if s.signedIn}
                  <button
                    class="act"
                    onclick={() => agentTools.signIn(profile.agent, added ? picked.id : undefined)}
                    >Sign in again</button
                  >
                  <button
                    class="act"
                    disabled={agentTools.busy === profile.agent}
                    onclick={() => agentTools.signOut(profile.agent, added ? picked.id : undefined)}
                    >Sign out</button
                  >
                {:else}
                  <button
                    class="act"
                    onclick={() => agentTools.signIn(profile.agent, added ? picked.id : undefined)}
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
                    disabled={agentTools.busy === profile.agent}
                    onclick={() => agentTools.removeAccount(profile.agent, picked.id)}
                    >Remove</button
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
                  <button class="act" type="button" onclick={() => (renaming = undefined)}
                    >Cancel</button
                  >
                </form>
              {/if}
              {#if agentTools.problems[profile.agent]}
                <p class="mt-1 text-[11px] text-coral">{agentTools.problems[profile.agent]}</p>
              {/if}
            {/if}
          </div>
        {/if}
        {#if MODELS[profile.agent].length}
          {@const office = MODELS[profile.agent].find((m) => m.id === profile.officeModel)}
          <div>
            <h3 class="text-xs font-semibold text-ink">Model</h3>
            <div class="mt-1 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Model">
              {#each [{ id: '', name: 'Office default', about: office ? `Now ${office.name}` : "The office's" }, ...MODELS[profile.agent].map( (m) => ({ id: m.id, name: m.name, about: levelsOf(m.id) }) )] as m (m.id)}
                {@const on = (profile.model ?? '') === m.id}
                <button
                  class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-start {on
                    ? 'bg-sea/15 ring-1 ring-sea'
                    : 'bg-raise hover:bg-night/40'}"
                  role="radio"
                  aria-checked={on}
                  onclick={() => !on && setModel(m.id || null)}
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
        <div>
          <h3 class="text-xs font-semibold text-ink">Permission level</h3>
          <div class="mt-1 flex gap-1" role="group" aria-label="Permission level">
            {#each LEVELS as l (l)}
              <button
                class="flex-1 rounded-lg px-1.5 py-2 text-xs {profile.permission === l
                  ? 'bg-sea/25 text-ink'
                  : 'bg-raise text-muted'}"
                aria-pressed={profile.permission === l}
                onclick={() => setPermission(l)}>{LEVEL_LABEL[l]}</button
              >
            {/each}
          </div>
        </div>
        <div>
          {#if efforts.length}
            <h3 class="text-xs font-semibold text-ink">Thinking</h3>
            <div
              class="mt-1 flex gap-1"
              role="radiogroup"
              aria-label="How hard {profile.name} thinks"
            >
              {#each efforts as e (e)}
                <button
                  class="flex-1 rounded-lg px-1 py-2 text-xs whitespace-nowrap disabled:opacity-40 {profile.effort ===
                  e
                    ? 'bg-sea/25 text-ink'
                    : 'bg-raise text-muted hover:text-ink'}"
                  role="radio"
                  aria-checked={profile.effort === e}
                  disabled={belowFloor(e)}
                  title={belowFloor(e)
                    ? `The Office Manager thinks at ${EFFORT_NAMES[MANAGER_EFFORT_FLOOR]} or more`
                    : undefined}
                  onclick={() => profile.effort !== e && setEffort(e)}>{EFFORT_NAMES[e]}</button
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
      </section>
    {:else if tab === 'folders'}
      <FoldersList {profile} {find} />
    {:else if tab === 'office'}
      <section aria-label="In the office">
        <h3 class="mb-1.5 text-xs font-semibold text-ink">In the office</h3>
        <ul class="flex flex-col gap-1 rounded-xl bg-raise p-1.5">
          <!-- The label wraps only the switch's name, so the offer below it is a button of its own. -->
          {#if commandsShown}
            <li
              class="flex items-start gap-2.5 rounded-lg px-2 py-1.5 {how.state === 'switch'
                ? 'hover:bg-night/40'
                : ''}"
            >
              <input
                id="commands-{profile.id}"
                type="checkbox"
                class="mt-0.5 {how.state === 'switch' ? 'cursor-pointer' : ''}"
                checked={profile.reach.commands}
                disabled={how.state !== 'switch'}
                onchange={(e) => setOwnTool('commands', e.currentTarget)}
              />
              <span class="min-w-0 flex-1">
                <label
                  for="commands-{profile.id}"
                  class="block text-sm {how.state === 'switch' ? 'cursor-pointer' : ''}"
                  >{SWITCH_NAMES.commands}</label
                >
                {#if how.state !== 'switch'}
                  <span class="block text-xs text-muted">{how.why}</span>
                {/if}
                {#if how.state === 'never' && how.offer}
                  {@const offer = how.offer}
                  <button
                    class="mt-0.5 block text-start text-xs text-sea hover:text-ink"
                    onclick={() => moveFor(offer)}
                    >Switch {profile.name} to {AGENT_NAMES[offer]}?</button
                  >
                  {#if refused}
                    <span class="block text-xs text-muted">{refused}</span>
                  {/if}
                {/if}
              </span>
            </li>
          {/if}
          {#if webShown}
            <li>
              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-night/40"
              >
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={profile.web}
                  onchange={(e) => setOwnTool('web', e.currentTarget)}
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm">{SWITCH_NAMES.web}</span>
                  <span class="block text-xs text-muted">{profile.webLine}</span>
                </span>
              </label>
            </li>
          {/if}
          {#each officeTools as t (t.id)}
            <li>
              <label
                class="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-night/40"
              >
                <input
                  type="checkbox"
                  class="mt-0.5"
                  checked={profile.tools.includes(t.id)}
                  onchange={(e) => setTool(t.id, e.currentTarget.checked)}
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm">{t.name}</span>
                  <span class="block text-xs text-muted">{t.does}</span>
                </span>
              </label>
            </li>
          {/each}
          {#if !commandsShown && !webShown && !officeTools.length}
            <li class="px-2 py-1.5 text-sm text-muted">Nothing here matches "{find.trim()}".</li>
          {/if}
        </ul>
        <p class="mt-1.5 text-[11px] text-faint">
          Every Odd can also raise asks, see how you decided them, and see its own access.
        </p>
      </section>
    {:else}
      <div class="mb-1.5 flex items-center justify-between">
        <h3 class="text-xs font-semibold text-ink">Services</h3>
        {#if !adding}
          <button
            class="rounded-lg bg-raise px-2.5 py-1 text-xs font-medium hover:bg-sea/20"
            onclick={() => {
              adding = true;
              done = '';
            }}><span aria-hidden="true">+</span> Add service</button
          >
        {/if}
      </div>
      {#if done}
        <p class="mb-3 rounded-lg bg-sea/15 px-3 py-2 text-xs text-ink">{done}</p>
      {/if}
      {#if adding}
        <div class="mb-3 flex flex-col gap-2 rounded-xl bg-raise p-3">
          {#if !pick}
            <input
              class="rounded-lg bg-night/60 px-3 py-2 text-sm outline-none placeholder:text-faint"
              placeholder="Search tools, or paste a hosted server's https address"
              bind:value={q}
            />
            <!-- No scroll box of its own: the list runs the panel's full height, and the panel scrolls. -->
            <ul class="flex flex-col gap-1">
              {#if isUrl}
                <li>
                  <button
                    class="w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-night/60"
                    onclick={() =>
                      choose({
                        id: q.trim(),
                        name: new URL(q.trim()).hostname,
                        kind: 'http',
                        byAddress: true
                      })}
                  >
                    <span class="block">Connect {new URL(q.trim()).hostname}</span>
                    <span class="block text-xs text-muted"
                      >A hosted MCP server. You sign in or give it a key next.</span
                    >
                  </button>
                </li>
              {/if}
              {#each found.catalog as c (c.id)}
                <li>
                  <button
                    class="w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-night/60"
                    onclick={() => choose({ ...c, byAddress: c.byAddress && !c.ready })}
                  >
                    <span class="block"
                      >{c.name} <span class="text-[11px] text-moss">in the office</span></span
                    >
                    <span class="block text-xs text-muted">{c.description}</span>
                  </button>
                </li>
              {/each}
              {#each found.registry as c (c.registry)}
                <li>
                  <button
                    class="w-full rounded-lg px-2 py-1.5 text-start text-sm hover:bg-night/60 disabled:opacity-40"
                    disabled={!!c.unsupported}
                    onclick={() =>
                      choose({ id: c.registry, name: c.name, kind: c.kind ?? 'stdio' })}
                  >
                    <span class="block"
                      >{c.name} <span class="text-[11px] text-faint">{c.registry}</span></span
                    >
                    <span class="block text-xs text-muted">{c.unsupported ?? c.description}</span>
                  </button>
                </li>
              {/each}
              {#if found.problem}
                <li class="text-xs text-coral">{found.problem}</li>
              {/if}
            </ul>
          {:else}
            <div class="text-sm font-medium">{pick.google?.name ?? pick.name}</div>
            {#if accounts.length}
              <div class="flex flex-col gap-1" role="group" aria-label="Which Google account">
                {#each accounts as c (c.id)}
                  {@const on = !newAccount && pick.id === c.id}
                  <button
                    class="rounded-lg px-2 py-1.5 text-start text-xs {on
                      ? 'bg-sea/25'
                      : 'bg-night/60'}"
                    aria-pressed={on}
                    onclick={() => {
                      another = false;
                      pick = { ...c, byAddress: false };
                    }}>{c.google?.account ?? c.name}</button
                  >
                {/each}
                <button
                  class="rounded-lg px-2 py-1.5 text-start text-xs {newAccount
                    ? 'bg-sea/25'
                    : 'bg-night/60'}"
                  aria-pressed={newAccount}
                  onclick={addAnother}>Another Google account</button
                >
              </div>
              {#if newAccount}
                <p class="text-[11px] text-faint">
                  You sign in to it from a task on your desk next, and pick the account there.
                </p>
              {/if}
            {/if}
            {#if pick.byAddress}
              <div class="flex gap-1.5" role="group" aria-label="How it lets the office in">
                {#each [false, true] as key (key)}
                  <button
                    class="flex-1 rounded-lg px-2 py-1.5 text-xs {useKey === key
                      ? 'bg-sea/25'
                      : 'bg-night/60'}"
                    aria-pressed={useKey === key}
                    onclick={() => (useKey = key)}>{key ? 'Takes a key' : 'Signs in'}</button
                  >
                {/each}
              </div>
              {#if useKey}
                <label class="flex flex-col gap-1 text-xs text-muted">
                  The header the key goes in
                  <input
                    class="rounded-lg bg-night/60 px-3 py-2 text-sm text-ink outline-none placeholder:text-faint"
                    placeholder="Authorization"
                    spellcheck="false"
                    autocomplete="off"
                    bind:value={keyHeader}
                  />
                </label>
                <p class="text-[11px] text-faint">
                  The server's setup guide names it, like x-api-key. You paste the key on your desk
                  next, and it goes in this computer's password store.
                </p>
              {/if}
            {/if}
            <div class="flex gap-1.5">
              {#each levels.filter((l) => pick?.id !== POSTAL_ID || l === 'read') as l (l)}
                <button
                  class="flex-1 rounded-lg px-2 py-1.5 text-xs disabled:opacity-40 {level === l
                    ? 'bg-sea/25'
                    : 'bg-night/60'}"
                  disabled={!allowed(l)}
                  onclick={() => (level = l)}>{GRANT_LABEL[l]}</button
                >
              {/each}
            </div>
            {#if pick.id === POSTAL_ID}
              <p class="text-xs text-muted">
                Reads one mailbox, including mail for every recipient there.
              </p>
            {:else if !allowed('act')}
              <!-- Said in sight, not in a tooltip, with the one click that allows it. -->
              <p class="text-[11px] text-muted">
                {GRANT_LABEL.act} needs {profile.name} at {LEVEL_LABEL[GRANT_NEEDS.act]} or higher.
                <button
                  class="text-sea underline underline-offset-2 hover:text-ink"
                  onclick={() => setPermission(GRANT_NEEDS.act)}
                  >Set {profile.name} to {LEVEL_LABEL[GRANT_NEEDS.act]}</button
                >
              </p>
            {:else if level === 'act' && writesWait('act', profile.permission)}
              <p class="text-[11px] text-muted">
                At {LEVEL_LABEL.draft}, each change {profile.name} makes in {pick.name} waits on your
                desk for your yes.
              </p>
            {/if}
            <div class="flex gap-2">
              <button
                class="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-ink"
                onclick={() => (pick = undefined)}>Back</button
              >
              <button
                class="flex-1 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
                disabled={!!pick.byAddress && useKey && !keyHeader.trim()}
                onclick={grant}>Grant</button
              >
            </div>
          {/if}
          <button
            class="text-xs text-muted hover:text-ink"
            onclick={() => {
              adding = false;
              pick = undefined;
            }}>Cancel</button
          >
        </div>
      {/if}
      {#if !grants.length && !adding}
        <p class="py-4 text-center text-sm text-muted">No services yet.</p>
      {/if}
      {#if grants.length && !shownGrants.length}
        <p class="py-4 text-center text-sm text-muted">Nothing here matches "{find.trim()}".</p>
      {/if}
      <ul class="flex flex-col gap-2">
        {#each shownGrants as g (g.connector)}
          <li class="rounded-xl bg-raise p-3 text-sm">
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="font-medium">{g.name}</div>
                <div class="text-xs text-muted">
                  {GRANT_LABEL[g.level]} · {g.reach}{g.heldBack
                    ? ` · ${HELD_BACK[g.heldBack]}`
                    : writesWait(g.level, profile.permission)
                      ? ' · each change waits for your yes'
                      : ''}
                </div>
              </div>
              <button class="text-xs text-muted hover:text-coral" onclick={() => revoke(g)}
                >Revoke</button
              >
            </div>
            <div class="mt-2 flex gap-1" role="group" aria-label={`${g.name} level`}>
              {#each levels.filter((l) => g.connector !== POSTAL_ID || l === 'read') as l (l)}
                <button
                  class="flex-1 rounded-lg px-2 py-1 text-xs disabled:opacity-40 {g.level === l
                    ? 'bg-sea/25 text-ink'
                    : 'bg-night/40 text-muted hover:text-ink'}"
                  aria-pressed={g.level === l}
                  disabled={!allowed(l)}
                  title={allowed(l)
                    ? ''
                    : `${profile.name} needs Drafts for your yes or higher first. Change it above.`}
                  onclick={() => relevel(g, l)}>{GRANT_LABEL[l]}</button
                >
              {/each}
            </div>
            <ServiceActions id={g.connector} name={g.name} changes={g.changes} />
          </li>
        {/each}
      </ul>
    {/if}
    {#if problem}
      <p class="mt-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{problem}</p>
    {/if}
  </div>
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
  /* The tab bar is its own container: too narrow for the words, each tab shows its icon alone. */
  .tabs {
    container-type: inline-size;
  }
  @container (max-width: 22rem) {
    .word {
      display: none;
    }
  }
</style>
