<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { AgentTools } from './agent-tools.svelte.ts';
  import type { MagpieGroup, MagpieLogin, MagpieProvider, MagpieRouting } from '../magpie.ts';
  import MagpieProviderKeys from './MagpieProviderKeys.svelte';
  import { MagpieConnection } from './magpie.svelte.ts';
  import { magpieChoices, magpieModels, magpieSignInUrl, magpieSignInActive } from './magpie-ui.ts';

  let {
    tools,
    connection = new MagpieConnection(),
    onsetup
  }: { tools: AgentTools; connection?: MagpieConnection; onsetup?: () => Promise<void> } = $props();
  const snapshot = $derived(connection.state);
  // A catalog connection grants model use only. The server also refuses every
  // management action until a separate management connection is authorized.
  const canManage = $derived(snapshot?.access === 'manage');
  let managementUrl = $state('http://127.0.0.1:3430');
  let gatewayUrl = $state('');
  let managementKey = $state('');
  let accessLink = $state('');
  let manualConnection = $state(false);
  let inferenceToken = $state('');
  let shared = $state(false);
  let existing = $state(false);
  let gatewayOpen = $state(false);
  let localGatewayUrl = $state('http://127.0.0.1:3425');
  let connectionLocation = $state<'local' | 'server'>('local');
  let suggestedSetup: unknown;
  $effect(() => {
    if (
      connection.setup?.status === 'authorization-required' &&
      connection.setup !== suggestedSetup
    ) {
      suggestedSetup = connection.setup;
      accessLink = managementKey = inferenceToken = '';
      manualConnection = false;
      connectionLocation = connection.state?.location === 'server' ? 'server' : 'local';
      existing = true;
      const candidate = connection.candidates[0];
      managementUrl =
        candidate?.managementUrl || connection.state?.managementUrl || 'http://127.0.0.1:3430';
      gatewayUrl =
        connectionLocation === 'server' || connection.state?.access === 'use'
          ? connection.state?.gatewayUrl || ''
          : '';
    }
  });
  let providerOpen = $state(false);
  let providersHeading = $state<HTMLHeadingElement>();
  let routingHeading = $state<HTMLHeadingElement>();
  let providerId = $state('');
  let providerName = $state('');
  let preset = $state('');
  let chat = $state('');
  let responses = $state('');
  let anthropic = $state('');
  let providerKey = $state('');
  let models = $state('');
  let isNew = $state(true);
  let groupOpen = $state(false);
  let groupId = $state('');
  let groupEditing = $state(false);
  let groupName = $state('');
  let members = $state<string[]>([]);
  let routing = $state<MagpieRouting>('order');
  let firstToken = $state(0);
  let patience = $state(0);
  let callback = $state('');
  let inspect = $state(false);
  let loginMethods = $state<Record<string, number>>({});
  let activeLogin = $state<{ agent: string; method: number; type: string }>();
  let promptValue = $state('');
  let loginKey = $state('');
  let discoverySearched = $state(false);
  let localSearched = $state(false);
  let discoveredPicks = $state<string[]>([]);

  // Access links contain management credentials. Keep them only in this form,
  // never in navigation, local storage, candidates or the public connection.
  onDestroy(() => {
    accessLink =
      managementKey =
      inferenceToken =
      providerKey =
      loginKey =
      promptValue =
      callback =
        '';
  });

  async function beginSignIn(login: MagpieLogin) {
    if (activeLogin || magpieSignInActive(connection.signIn?.state)) return;
    connection.signIn = undefined;
    const method = loginMethods[login.id] ?? 0;
    activeLogin = { agent: login.id, method, type: login.methods[method]?.type ?? '' };
    promptValue = loginKey = '';
    connection.inputs = {};
    if (!(await connection.act({ action: 'signin-prompt', agent: login.id, method })))
      activeLogin = undefined;
    else await continueSignIn();
  }

  async function continueSignIn() {
    if (!activeLogin || connection.prompt || (activeLogin.type === 'api' && !loginKey)) return;
    const key = loginKey;
    loginKey = '';
    if (
      await connection.act({
        action: 'signin-start',
        ...activeLogin,
        inputs: connection.inputs,
        ...(key ? { key } : {})
      })
    )
      activeLogin = undefined;
    await tools.load();
  }

  async function answerPrompt() {
    if (!activeLogin || !connection.prompt) return;
    const value = promptValue;
    const key = connection.prompt.key;
    promptValue = '';
    if (
      await connection.act({
        action: 'signin-prompt',
        agent: activeLogin.agent,
        method: activeLogin.method,
        inputs: connection.inputs,
        key,
        value
      })
    )
      await continueSignIn();
  }

  function clearLogin() {
    activeLogin = undefined;
    promptValue = loginKey = callback = '';
    connection.prompt = null;
    connection.inputs = {};
  }

  async function importSelected() {
    const picks = connection.discovered
      .filter((candidate) =>
        discoveredPicks.includes(JSON.stringify([candidate.source, candidate.ref]))
      )
      .map(({ source, ref }) => ({ source, ref }));
    if (
      snapshot?.shared &&
      !confirm(
        'Add the selected accounts to the shared Magpie setup? Other Magpie clients can use these accounts.'
      )
    )
      return;
    if (await connection.act({ action: 'import-selected', picks })) {
      discoveredPicks = [];
      discoverySearched = false;
    }
    await tools.load();
  }
  const choices = $derived(magpieChoices(snapshot));
  const signInUrl = $derived(magpieSignInUrl(connection.signIn?.url ?? ''));
  const routes: { id: MagpieRouting; name: string }[] = [
    { id: '', name: 'Magpie default' },
    { id: 'order', name: 'In member order' },
    { id: 'rotate', name: 'Rotate members' },
    { id: 'usage', name: 'By usage' },
    { id: 'pace', name: 'By pace' },
    { id: 'weight', name: 'By weight' },
    { id: 'free', name: 'Free first' },
    { id: 'fast', name: 'Fastest first' },
    { id: 'cheap', name: 'Cheapest first' },
    { id: 'drain', name: 'Drain accounts' },
    { id: 'expiring', name: 'Expiring accounts first' }
  ];

  function chooseConnectionLocation(location: 'local' | 'server') {
    connectionLocation = location;
    accessLink = managementKey = inferenceToken = '';
    manualConnection = false;
    shared = false;
    localSearched = false;
    managementUrl = location === 'local' ? 'http://127.0.0.1:3430' : '';
    // A management upgrade must prove it belongs to the gateway already in use.
    // Fresh local links can discover their own inference settings instead.
    gatewayUrl = location === 'local' && snapshot?.access === 'use' ? snapshot.gatewayUrl : '';
    connection.problem = '';
  }

  function openServer() {
    if (connection.busy) return;
    gatewayOpen = false;
    chooseConnectionLocation('server');
    existing = true;
  }

  async function openManagement() {
    if (connection.busy) return;
    gatewayOpen = false;
    chooseConnectionLocation('local');
    existing = true;
    localSearched = true;
    managementKey = inferenceToken = '';
    shared = false;
    if (await connection.act({ action: 'find-existing' })) {
      const candidate = connection.candidates[0];
      if (candidate) {
        managementUrl = candidate.managementUrl;
        if (manualConnection) gatewayUrl = candidate.gatewayUrl || 'http://127.0.0.1:3425';
      }
    }
  }

  async function openExisting() {
    if (connection.busy) return;
    cancelExisting();
    localGatewayUrl = 'http://127.0.0.1:3425';
    gatewayOpen = true;
    await connectLocalGateway();
  }

  async function connectLocalGateway() {
    if (connection.busy) return;
    if (await connection.act({ action: 'connect-gateway', gatewayUrl: localGatewayUrl.trim() })) {
      gatewayOpen = existing = false;
      providerOpen = groupOpen = false;
      accessLink = managementKey = inferenceToken = providerKey = '';
      discoveredPicks = [];
      discoverySearched = inspect = false;
      clearLogin();
      await tools.load();
    }
  }

  function cancelExisting() {
    existing = false;
    accessLink = managementKey = inferenceToken = '';
    manualConnection = false;
    shared = false;
    connection.problem = '';
  }

  async function connect() {
    if (connection.busy || !shared) return;
    const link = accessLink.trim();
    const key = managementKey;
    const token = inferenceToken.trim();
    accessLink = managementKey = inferenceToken = '';
    if (
      await connection.act({
        action: 'connect',
        location: connectionLocation,
        ...(manualConnection ? { managementUrl, managementKey: key } : { accessLink: link }),
        // A local link can discover both inference settings on the server.
        // Sending blank/default fields would replace those authenticated values.
        ...(gatewayUrl.trim() ? { gatewayUrl: gatewayUrl.trim() } : {}),
        ...(token ? { inferenceToken: token } : {}),
        shared: true
      })
    ) {
      gatewayOpen = existing = false;
      providerOpen = groupOpen = false;
      providerKey = callback = '';
      discoveredPicks = [];
      discoverySearched = inspect = false;
      clearLogin();
      await tools.load();
    }
  }

  async function startBuiltIn() {
    if (connection.busy) return;
    if (
      snapshot?.connected &&
      !confirm(
        'Switch Oddboro to its separate built-in Magpie? It has its own providers, models and groups. The existing Magpie keeps its setup and continues running.'
      )
    )
      return;
    accessLink = managementKey = inferenceToken = '';
    if (await connection.act({ action: 'start-managed' })) {
      cancelExisting();
      gatewayOpen = false;
      providerOpen = groupOpen = false;
      providerKey = '';
      discoverySearched = inspect = false;
      discoveredPicks = [];
      clearLogin();
      await tools.load();
    }
  }

  function editProvider(provider?: MagpieProvider) {
    isNew = !provider;
    providerId = provider?.id ?? '';
    providerName = provider?.name ?? '';
    preset = provider?.preset ?? '';
    chat = provider?.chat ?? '';
    responses = provider?.responses ?? '';
    anthropic = provider?.anthropic ?? '';
    models =
      provider?.models
        .map((m) =>
          m.id.startsWith(`${provider.id}/`) ? m.id.slice(provider.id.length + 1) : m.id
        )
        .join('\n') ?? '';
    providerKey = '';
    providerOpen = true;
  }

  async function saveProvider() {
    const key = providerKey;
    providerKey = '';
    if (
      await connection.act({
        action: 'provider-save',
        provider: {
          id: providerId.trim(),
          name: providerName.trim(),
          preset,
          chat,
          responses,
          anthropic,
          ...(key ? { key } : {}),
          models: magpieModels(models),
          new: isNew
        }
      })
    )
      providerOpen = false;
    await tools.load();
  }

  function editGroup(group?: MagpieGroup) {
    groupEditing = !!group;
    groupId = group?.id ?? '';
    groupName = group?.name ?? '';
    members = group ? [...group.members] : [];
    routing = group?.routing ?? 'order';
    firstToken = group?.firstToken ?? 0;
    patience = group?.patience ?? 0;
    groupOpen = true;
  }

  async function saveGroup() {
    if (
      await connection.act({
        action: 'group-save',
        group: {
          id: groupId.trim(),
          name: groupName.trim(),
          members,
          routing,
          firstToken,
          patience
        }
      })
    )
      groupOpen = false;
    await tools.load();
  }

  async function disconnect() {
    if (
      !confirm(
        'Disconnect Oddboro from Magpie? Saved Magpie models will be unavailable until you reconnect. Your providers and groups stay saved.'
      )
    )
      return;
    await connection.act({ action: 'disconnect' });
    providerKey = accessLink = managementKey = inferenceToken = callback = '';
    providerOpen = groupOpen = false;
    gatewayOpen = false;
    clearLogin();
    await tools.load();
  }

  async function remove(kind: 'provider' | 'group', id: string, name: string) {
    if (
      !confirm(
        `Delete ${kind} ${name}?${snapshot?.shared ? ' This changes the shared Magpie setup for every client.' : ''} Existing routes using it may stop working.`
      )
    )
      return;
    await connection.act(
      kind === 'provider' ? { action: 'provider-delete', id } : { action: 'group-delete', id }
    );
    await tools.load();
  }

  async function sendCallback() {
    if (!connection.signIn) return;
    const url = callback;
    callback = '';
    await connection.act({ action: 'signin-callback', id: connection.signIn.id, url });
    await tools.load();
  }
</script>

{#snippet inferenceFields()}
  <label
    >{connectionLocation === 'server'
      ? 'Server inference URL (HTTPS, reachable from Oddboro)'
      : 'Inference gateway URL'}<input
      class="field"
      type="url"
      required={connectionLocation === 'server' || manualConnection}
      placeholder={connectionLocation === 'local' && !manualConnection
        ? 'Detect from connected Magpie'
        : undefined}
      disabled={connection.busy}
      bind:value={gatewayUrl}
    /></label
  >
  <label
    >{connectionLocation === 'server'
      ? 'Server inference API token'
      : 'Inference token (if required)'}<input
      class="field"
      type="password"
      autocomplete="off"
      disabled={connection.busy}
      required={connectionLocation === 'server'}
      minlength={connectionLocation === 'server' ? 16 : undefined}
      bind:value={inferenceToken}
    /></label
  >
{/snippet}

{#snippet builtInChoice()}
  <div class="mt-3">
    <button
      class="btn"
      disabled={!snapshot?.managedAvailable || connection.busy}
      onclick={startBuiltIn}>Use built-in Magpie</button
    >
    <p class="mt-1 text-xs text-muted">
      A separate copy for Oddboro, with its own providers, models and groups. It does not import
      your existing Magpie setup. You will connect a provider and choose a model there.
    </p>
    {#if !snapshot?.managedAvailable}<p class="mt-1 text-xs text-muted">
        The compatible bundled runtime is unavailable. Rebuild or reinstall Oddboro, or connect an
        existing installation.
      </p>{/if}
  </div>
{/snippet}

{#snippet localGatewayConnection()}
  <form
    class="box mt-2"
    aria-label="Connect local model gateway"
    onsubmit={(event) => {
      event.preventDefault();
      void connectLocalGateway();
    }}
  >
    <p class="text-sm font-medium">Use an existing local gateway</p>
    <p class="mt-1 text-xs text-muted">
      Your current connection and route stay in use until this gateway is verified. This connects
      its published models and routing aliases, without management access or changing its setup.
    </p>
    <label
      >Local gateway URL<input
        class="field"
        type="url"
        required
        disabled={connection.busy}
        bind:value={localGatewayUrl}
      /></label
    >
    <p class="mt-1 text-xs text-muted">
      Use the inference address on the computer hosting Oddboro. If Magpie uses a different local
      port, enter it here. A gateway that requires a token needs a management connection instead.
    </p>
    <div class="mt-2 flex flex-wrap gap-2">
      <button class="btn" disabled={connection.busy}>Connect model gateway</button>
      <button
        class="btn ghost"
        type="button"
        disabled={connection.busy}
        onclick={() => {
          gatewayOpen = false;
          connection.problem = '';
        }}>Cancel gateway connection</button
      >
      <button class="btn ghost" type="button" disabled={connection.busy} onclick={openManagement}
        >Connect management instead</button
      >
    </div>
  </form>
{/snippet}

{#snippet existingConnection()}
  <form
    class="box mt-2"
    aria-label="Connect existing Magpie"
    onsubmit={(event) => {
      event.preventDefault();
      void connect();
    }}
  >
    {#if snapshot?.connected}<p class="mt-1 text-xs text-muted">
        Your current Magpie stays connected until the new connection is authenticated and verified.
        Cancel keeps your current models and route.
      </p>{/if}
    <fieldset class="mt-2">
      <legend class="text-sm font-medium">Where Magpie runs</legend>
      <label class="member"
        ><input
          type="radio"
          name="magpie-connection-location"
          checked={connectionLocation === 'local'}
          disabled={connection.busy}
          onchange={() => chooseConnectionLocation('local')}
        />On the computer running Oddboro</label
      >
      <label class="member"
        ><input
          type="radio"
          name="magpie-connection-location"
          checked={connectionLocation === 'server'}
          disabled={connection.busy}
          onchange={() => chooseConnectionLocation('server')}
        />On a Magpie server</label
      >
    </fieldset>
    {#if !manualConnection}
      <label
        >Magpie access link<input
          class="field"
          type="password"
          required
          autocomplete="off"
          spellcheck="false"
          disabled={connection.busy}
          placeholder="Paste the full access link from Magpie"
          bind:value={accessLink}
        /></label
      >
      <p class="mt-1 text-xs text-muted">
        Copy the full Browser access link from Magpie and paste it here. It contains the management
        key, so Oddboro keeps it hidden and clears this field after connecting.
      </p>
    {/if}
    <button
      class="btn ghost mt-2"
      type="button"
      aria-expanded={manualConnection}
      disabled={connection.busy}
      onclick={() => {
        accessLink = managementKey = inferenceToken = '';
        manualConnection = !manualConnection;
        if (connectionLocation === 'local')
          gatewayUrl = manualConnection
            ? connection.candidates[0]?.gatewayUrl ||
              snapshot?.gatewayUrl ||
              'http://127.0.0.1:3425'
            : snapshot?.access === 'use'
              ? snapshot.gatewayUrl
              : '';
      }}>{manualConnection ? 'Use an access link instead' : 'Enter URL and key manually'}</button
    >
    {#if manualConnection}
      {#if connectionLocation === 'local'}
        <button
          type="button"
          class="btn ghost mt-2"
          disabled={connection.busy}
          onclick={async () => {
            localSearched = true;
            await connection.act({ action: 'find-existing' });
          }}>Find local management endpoint</button
        >
        {#if localSearched && !connection.busy && !connection.candidates.length && !connection.problem}<p
            class="mt-2 text-xs text-muted"
          >
            No local management endpoint found. Use the address shown by your Magpie installation.
          </p>{/if}
        {#each connection.candidates as candidate (candidate.managementUrl)}<button
            class="btn ghost mt-2"
            type="button"
            disabled={connection.busy}
            onclick={() => {
              managementUrl = candidate.managementUrl;
              if (candidate.gatewayUrl) gatewayUrl = candidate.gatewayUrl;
            }}>{candidate.managementUrl}</button
          >{/each}
      {/if}
      <label
        >{connectionLocation === 'server'
          ? 'Server management URL (HTTPS)'
          : 'Management URL'}<input
          class="field"
          type="url"
          required
          disabled={connection.busy}
          placeholder={connectionLocation === 'server' ? 'https://magpie.example.com' : undefined}
          bind:value={managementUrl}
        /></label
      >
      <label
        >Management run key<input
          class="field"
          type="password"
          required
          autocomplete="off"
          disabled={connection.busy}
          bind:value={managementKey}
        /></label
      >
    {/if}
    {#if connectionLocation === 'server' || manualConnection}
      {@render inferenceFields()}
    {:else}
      <details class="mt-2">
        <summary class="text-xs text-muted">Inference settings (optional)</summary>
        {@render inferenceFields()}
      </details>
    {/if}
    <p class="mt-2 text-xs text-muted">
      {#if connectionLocation === 'server'}
        The computer hosting Oddboro must reach this server. Its HTTPS inference address and
        separate API token are still required. No desktop popup is needed.
      {:else}
        Detection runs on the computer hosting Oddboro. Enable Browser access in Magpie if needed,
        then press Check Magpie again or paste its access link. A phone cannot open that computer's
        tray app.
      {/if}
    </p>
    <p class="notice mt-2">
      This connects the same shared setup used by other Magpie clients. Provider, account and group
      edits here also affect those clients.
    </p>
    <label class="member"
      ><input type="checkbox" required disabled={connection.busy} bind:checked={shared} />I
      understand that edits change the shared Magpie setup.</label
    >
    <div class="mt-2 flex flex-wrap gap-2">
      <button class="btn" disabled={connection.busy || !shared}
        >{connectionLocation === 'server' ? 'Connect to server' : 'Connect'}</button
      ><button class="btn ghost" type="button" disabled={connection.busy} onclick={cancelExisting}
        >Cancel connection</button
      >
    </div>
  </form>
{/snippet}

<svelte:window
  onfocus={() => {
    void connection.refresh();
    void tools.load();
  }}
/>

<section class="magpie mt-4" aria-label="Models and connections" aria-busy={connection.busy}>
  <div class="flex flex-wrap items-center gap-2">
    <h3 class="flex-1 text-sm font-semibold">Models &amp; connections</h3>
    <button
      class="btn ghost"
      disabled={connection.busy || connection.loading}
      onclick={() => connection.refresh()}>Refresh</button
    >
  </div>
  <p class="mt-1 text-xs text-muted">
    Magpie connects model providers and routes requests. Your selected agent tool still runs each
    Odd with its existing permissions.
  </p>
  {#if tools.officeModel?.startsWith('magpie:') && !snapshot?.connected}
    <div class="box mt-2">
      <p class="text-xs text-muted">
        The office still uses {tools.officeModel.slice(7)} through Magpie. Reconnect below or switch to
        a direct account.
      </p>
      {#if tools.selectedOffice === 'pi'}
        <p class="mt-2 text-xs text-muted">
          To use a direct account, choose a direct tool tile above.
        </p>
      {:else}
        <button
          class="btn ghost mt-2"
          disabled={!!tools.busy}
          onclick={async () => {
            if (await tools.pickMagpieModel(null)) tools.modelSource = 'direct';
          }}>Use a direct account</button
        >
      {/if}
    </div>
  {/if}
  {#if connection.setup}
    <p class="mt-2 text-sm" role="status">{connection.setup.message}</p>
    {#if connection.setup.status === 'authorization-required'}<p class="notice mt-2">
        Enable Browser access and check again, or paste its full access link below. You can also
        choose the separate built-in copy. After connection, edits here change its shared setup for
        other clients.
      </p>{/if}
    {#if connection.setup.status !== 'connected' && onsetup}<button
        class="btn ghost mt-2"
        disabled={connection.busy}
        onclick={onsetup}>Check Magpie again</button
      >{/if}
  {/if}
  {#if connection.problem}<p class="mt-2 text-sm text-coral" role="alert">
      {connection.problem}
    </p>
    {#if onsetup && !connection.setup}<button
        class="btn ghost mt-2"
        disabled={connection.busy}
        onclick={onsetup}>Retry Magpie setup</button
      >{/if}{/if}
  {#if !snapshot}
    <p class="mt-2 text-sm text-muted">
      {connection.loading
        ? 'Reading model connections.'
        : 'Could not read model connections. Refresh to try again.'}
    </p>
  {:else}
    {#if snapshot.problem}<p class="mt-2 text-sm text-coral" role="alert">
        {snapshot.problem}
      </p>{/if}
    {#if snapshot.connected}
      <div class="box mt-3">
        <p class="text-sm font-medium">
          {snapshot.mode === 'managed'
            ? 'Built-in Magpie'
            : snapshot.location === 'server'
              ? 'Magpie server'
              : 'Existing Magpie'} · {snapshot.access === 'use'
            ? snapshot.ready
              ? 'Models connected'
              : 'Models unavailable'
            : snapshot.ready
              ? 'Gateway ready'
              : 'Gateway unavailable'}
        </p>
        {#if snapshot.version}<p class="mt-1 text-xs text-muted">Version {snapshot.version}</p>{/if}
        <p class="mt-1 text-xs text-muted wrap-anywhere">
          {#if canManage && snapshot.managementUrl}Management: {snapshot.managementUrl}<br
            />{/if}Models:
          {snapshot.gatewayUrl}
        </p>
        {#if snapshot.access === 'use'}<p class="notice mt-2" role="note">
            Connected for model use. Choose a published model or routing alias below. Your existing
            Magpie keeps its setup; management access is only needed to edit it here.
          </p>{/if}
        {#if canManage && snapshot.shared}<p class="notice mt-2" role="note">
            You are editing the existing shared Magpie setup. Provider, account and routing changes
            also affect its other clients. Disconnecting stops Oddboro's use.
          </p>{/if}
        {#if snapshot.notice && snapshot.notice !== connection.setup?.message}<p
            class="mt-2 text-xs text-muted"
          >
            {snapshot.notice}
          </p>{/if}
        {#if !canManage}
          <button class="btn mt-2" disabled={connection.busy} onclick={openManagement}
            >Manage connection</button
          >
          <details class="mt-2">
            <summary class="text-xs text-muted">Other connections</summary>
            <button class="btn ghost mt-2" disabled={connection.busy} onclick={openServer}
              >Connect to a Magpie server</button
            >
            {@render builtInChoice()}
          </details>
        {:else}
          {#if snapshot.mode === 'managed'}
            <p class="mt-2 text-xs text-muted">
              This built-in copy has its own models and groups. Connect an existing local
              installation or a Magpie server to use its setup.
            </p>
            <button class="btn mt-2" disabled={connection.busy} onclick={openExisting}
              >Use existing Magpie</button
            >
          {/if}
          <button class="btn ghost mt-2" disabled={connection.busy} onclick={openServer}
            >Connect to a Magpie server</button
          >
          {#if snapshot.mode !== 'managed'}{@render builtInChoice()}{/if}
        {/if}
        {#if gatewayOpen}{@render localGatewayConnection()}{/if}
        {#if existing}{@render existingConnection()}{/if}
        <button class="btn ghost mt-2" disabled={connection.busy} onclick={disconnect}
          >Disconnect</button
        >
      </div>

      <div class="box mt-3">
        <h4 class="text-sm font-medium">Office model</h4>
        <p class="mt-1 text-xs text-muted">
          Used by the Office Manager, new Odds and Odds on the office default. Pi is included with
          Oddboro and uses Magpie. Existing Claude Code and Codex runners remain alternatives where
          offered.
        </p>
        <label class="mt-2 block text-xs"
          >Model source and route
          <select
            class="field mt-1 w-full"
            value={tools.officeModel?.startsWith('magpie:') ? tools.officeModel : ''}
            disabled={connection.busy ||
              !!tools.busy ||
              !['pi', 'claude', 'codex'].includes(tools.selectedOffice)}
            onchange={async (event) => {
              const select = event.currentTarget;
              if (!(await tools.pickMagpieModel(select.value || null)))
                select.value = tools.officeModel?.startsWith('magpie:') ? tools.officeModel : '';
            }}
          >
            <option value=""
              >{tools.magpieSelected ? 'Choose a model or group' : 'Direct account'}</option
            >
            {#if tools.officeModel?.startsWith('magpie:') && !choices.some((m) => m.id === tools.officeModel)}<option
                value={tools.officeModel}>{tools.officeModel.slice(7)} (unavailable)</option
              >{/if}
            {#each choices as model (model.id)}<option value={model.id}>{model.name}</option>{/each}
          </select>
        </label>
        {#if !choices.length}<p class="mt-2 text-xs text-muted">
            {snapshot.access === 'use'
              ? 'This gateway lists no available model routes. Refresh or choose another connection.'
              : 'First connect a provider below. Then choose its model or create a routing group here.'}
          </p>{/if}
        {#if canManage}
          <div class="mt-2 flex flex-wrap gap-2">
            {#if !choices.length}<button class="btn ghost" onclick={() => providersHeading?.focus()}
                >Connect a provider</button
              >{/if}
            <button class="btn ghost" onclick={() => routingHeading?.focus()}
              >Groups &amp; routing</button
            >
          </div>
        {/if}
        {#if tools.officeModel?.startsWith('magpie:')}<p class="mt-2 text-xs text-muted">
            Magpie handles the model sign-in. Your agent tool must still be installed. Looks use the
            existing build-from-parts option until the selected route is qualified for drawing.
          </p>{/if}
      </div>

      {#if canManage}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <h4 bind:this={providersHeading} tabindex="-1" class="flex-1 text-sm font-medium">
            Providers &amp; accounts
          </h4>
          <button class="btn" disabled={connection.busy} onclick={() => editProvider()}
            >Add API provider</button
          >
        </div>
        {#if !snapshot.providers.length}<p class="mt-2 text-xs text-muted">
            No model providers yet. Add an API provider or use a supported sign-in below.
          </p>{/if}
        {#each snapshot.providers as provider (`${snapshot.mode}:${snapshot.managementUrl}:${provider.id}`)}
          <div class="box mt-2">
            <p class="text-sm font-medium">{provider.name}</p>
            <p class="mt-1 text-xs text-muted">
              {provider.off ? 'Turned off in Magpie' : provider.ready ? 'Ready' : 'Not ready'} · {provider.keySet
                ? 'API key saved'
                : 'No API key saved'}
            </p>
            <p class="mt-1 text-xs text-muted wrap-anywhere">
              {provider.models.length
                ? provider.models.map((m) => m.name).join(', ')
                : 'No models available. Check the provider endpoint and account.'}
            </p>
            <div class="mt-2 flex gap-2">
              <button
                class="btn ghost"
                disabled={connection.busy}
                onclick={() => editProvider(provider)}>Edit</button
              ><button
                class="btn ghost"
                disabled={connection.busy}
                onclick={() => remove('provider', provider.id, provider.name)}>Delete</button
              >
            </div>
            <MagpieProviderKeys
              {provider}
              shared={snapshot.shared}
              busy={connection.busy}
              onaction={async (action) => {
                const ok = await connection.act(action);
                if (ok) await tools.load();
                return ok;
              }}
            />
          </div>
        {/each}
        {#if providerOpen}
          <form
            class="box mt-2"
            onsubmit={(event) => {
              event.preventDefault();
              void saveProvider();
            }}
          >
            <h4 class="text-sm font-medium">{isNew ? 'Add API provider' : 'Edit provider'}</h4>
            {#if snapshot.shared}<p class="notice mt-2">
                Saving changes this provider for all clients of this Magpie.
              </p>{/if}
            <label
              >Provider ID<input
                class="field"
                required
                maxlength="80"
                readonly={!isNew}
                bind:value={providerId}
              /></label
            >
            <label
              >Name<input class="field" required maxlength="100" bind:value={providerName} /></label
            >
            <label
              >Provider preset<select class="field" bind:value={preset}
                ><option value="">Custom endpoints</option
                >{#each snapshot.presets as p (p.id)}<option value={p.id}>{p.name}</option
                  >{/each}</select
              ></label
            >
            <label>Chat API endpoint<input class="field" type="url" bind:value={chat} /></label>
            <label
              >Responses API endpoint<input
                class="field"
                type="url"
                bind:value={responses}
              /></label
            >
            <label
              >Anthropic API endpoint<input
                class="field"
                type="url"
                bind:value={anthropic}
              /></label
            >
            <label
              >{isNew ? 'API key' : 'Replace API key (blank keeps the saved key)'}<input
                class="field"
                type="password"
                autocomplete="off"
                spellcheck="false"
                bind:value={providerKey}
              /></label
            >
            <p class="mt-1 text-xs text-muted">
              Saved keys stay with Magpie and never appear here. To remove a provider and its saved
              key, delete that provider.
            </p>
            <label
              >Model IDs (one per line; blank uses Magpie's provider list)<textarea
                class="field"
                rows="3"
                bind:value={models}></textarea></label
            >
            <div class="mt-2 flex gap-2">
              <button
                class="btn"
                disabled={connection.busy || !providerId.trim() || !providerName.trim()}
                >Save provider</button
              ><button
                class="btn ghost"
                type="button"
                onclick={() => {
                  providerOpen = false;
                  providerKey = '';
                }}>Cancel</button
              >
            </div>
          </form>
        {/if}
        <div class="box mt-3">
          <h4 class="text-sm font-medium">Supported sign-ins</h4>
          <p class="mt-1 text-xs text-muted">
            Magpie manages each account. A provider may open its own consent page.
          </p>
          {#if !snapshot.logins.length}<p class="mt-2 text-xs text-muted">
              This Magpie has no installed sign-in provider. Add an API provider above.
            </p>{/if}
          {#each snapshot.logins as login (login.id)}
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <span class="flex-1 text-xs">{login.name}{login.signedIn ? ' · Signed in' : ''}</span>
              {#if login.methods.length > 1}<label class="text-xs"
                  ><span class="sr-only">{login.name} sign-in method</span><select
                    class="field"
                    bind:value={loginMethods[login.id]}
                    disabled={connection.busy ||
                      !!activeLogin ||
                      magpieSignInActive(connection.signIn?.state)}
                    >{#each login.methods as method, index (index)}<option value={index}
                        >{method.label || method.type}</option
                      >{/each}</select
                  ></label
                >{/if}
              <button
                class="btn ghost"
                disabled={!login.supported ||
                  connection.busy ||
                  !!activeLogin ||
                  magpieSignInActive(connection.signIn?.state)}
                onclick={() => beginSignIn(login)}>Sign in</button
              >
            </div>
            {#if !login.supported}<p class="mt-1 text-xs text-muted">
                {login.reason || 'This sign-in is not supported by this Magpie.'}
              </p>{/if}
          {/each}
          {#if activeLogin}
            <div class="mt-3">
              {#if connection.prompt}
                {@const question = connection.prompt}
                <form
                  onsubmit={(event) => {
                    event.preventDefault();
                    void answerPrompt();
                  }}
                >
                  <label
                    >{question.label}{#if question.options.length}<select
                        class="field"
                        bind:value={promptValue}
                        required
                        ><option value="">Choose an option</option
                        >{#each question.options as option (option.value)}<option
                            value={option.value}>{option.label}</option
                          >{/each}</select
                      >{:else}<input
                        class="field"
                        type="password"
                        autocomplete="off"
                        placeholder={question.placeholder}
                        bind:value={promptValue}
                        required
                      />{/if}</label
                  ><button class="btn mt-2" disabled={connection.busy || !promptValue}
                    >Continue</button
                  >
                </form>
              {:else if activeLogin.type === 'api'}
                <form
                  onsubmit={(event) => {
                    event.preventDefault();
                    void continueSignIn();
                  }}
                >
                  <label
                    >Provider API key<input
                      class="field"
                      type="password"
                      autocomplete="off"
                      bind:value={loginKey}
                      required
                    /></label
                  ><button class="btn mt-2" disabled={connection.busy || !loginKey}
                    >Save provider key</button
                  >
                </form>
              {:else}<button class="btn" disabled={connection.busy} onclick={continueSignIn}
                  >Retry sign-in</button
                >{/if}
              <button class="btn ghost mt-2" disabled={connection.busy} onclick={clearLogin}
                >Cancel</button
              >
            </div>
          {/if}
          {#if connection.signIn}
            {@const flow = connection.signIn}
            <div class="mt-3" role="status">
              <p class="text-sm">Sign-in: {flow.state}</p>
              {#if flow.instructions}<p class="mt-1 text-xs text-muted">{flow.instructions}</p>{/if}
              {#if flow.code}<p class="mt-1 text-sm">Code: <code>{flow.code}</code></p>{/if}
              {#if flow.user}<p class="mt-1 text-xs">Account: {flow.user}</p>{/if}
              {#if flow.error}<p class="mt-1 text-xs text-coral">{flow.error}</p>{/if}
              {#if signInUrl}<a
                  class="link mt-2 inline-block"
                  href={signInUrl}
                  target="_blank"
                  rel="noopener noreferrer">Open provider sign-in page</a
                >{/if}
              {#if flow.pasteCallback || flow.pasteCode || flow.pasteKey}
                <form
                  class="mt-2"
                  onsubmit={(event) => {
                    event.preventDefault();
                    void sendCallback();
                  }}
                >
                  <label
                    >{flow.pasteCallback
                      ? 'Callback URL'
                      : flow.pasteCode
                        ? 'Authorization code'
                        : 'Provider key'}<input
                      class="field"
                      type="password"
                      autocomplete="off"
                      bind:value={callback}
                    /></label
                  ><button class="btn mt-2" disabled={connection.busy || !callback.trim()}
                    >Continue sign-in</button
                  >
                </form>
              {/if}
              {#if magpieSignInActive(flow.state)}
                <div class="mt-2 flex gap-2">
                  <button
                    class="btn ghost"
                    disabled={connection.busy}
                    onclick={async () => {
                      await connection.refresh();
                      await tools.load();
                    }}>Check sign-in</button
                  ><button
                    class="btn ghost"
                    disabled={connection.busy}
                    onclick={async () => {
                      if (await connection.act({ action: 'signin-cancel', id: flow.id }))
                        clearLogin();
                    }}>Cancel sign-in</button
                  >
                </div>
              {:else}<button
                  class="btn ghost mt-2"
                  onclick={() => {
                    connection.signIn = undefined;
                    clearLogin();
                  }}>Dismiss sign-in status</button
                >{/if}
            </div>
          {/if}
        </div>

        <div class="box mt-3">
          <h4 class="text-sm font-medium">Find supported existing accounts</h4>
          <p class="mt-1 text-xs text-muted">
            Only search after you choose to. Select which supported accounts to add; unselected
            accounts stay unchanged.
          </p>
          <button
            class="btn ghost mt-2"
            disabled={!snapshot.discoverySupported || connection.busy}
            onclick={async () => {
              discoveredPicks = [];
              discoverySearched = true;
              await connection.act({ action: 'discovery', enabled: true });
            }}>Search supported local sign-ins</button
          >
          {#if !snapshot.discoverySupported}<p class="mt-2 text-xs text-muted">
              Local discovery is unavailable for this runtime. Add an API provider or use an
              available explicit sign-in.
            </p>{/if}
          {#if snapshot.mode === 'managed' && connection.discovered.some((candidate) => candidate.status === 'shared-read-only')}
            <p class="notice mt-2">
              The built-in runtime reads the selected Codex sign-in without copying or renewing it.
              Renew expired sign-ins in Codex.
            </p>
          {/if}
          {#if discoverySearched && !connection.busy && !connection.discovered.length && !connection.problem}<p
              class="mt-2 text-xs text-muted"
            >
              No supported local sign-ins found.
            </p>{/if}
          {#each connection.discovered as candidate (JSON.stringify( [candidate.source, candidate.ref] ))}
            <label class="member"
              >{#if candidate.status === 'shared-read-only'}<input
                  type="radio"
                  name="magpie-existing-codex"
                  checked={discoveredPicks.includes(
                    JSON.stringify([candidate.source, candidate.ref])
                  )}
                  onchange={() =>
                    (discoveredPicks = [JSON.stringify([candidate.source, candidate.ref])])}
                  disabled={!candidate.canImport || connection.busy}
                />{:else}<input
                  type="checkbox"
                  value={JSON.stringify([candidate.source, candidate.ref])}
                  bind:group={discoveredPicks}
                  disabled={!candidate.canImport || connection.busy}
                />{/if}<span
                >{candidate.name || candidate.ref} · {candidate.source} · {candidate.status}{!candidate.canImport
                  ? ' (cannot add)'
                  : ''}</span
              ></label
            >
          {/each}
          {#if connection.discovered.length}<button
              class="btn mt-2"
              disabled={!discoveredPicks.length || connection.busy}
              onclick={importSelected}>Add selected accounts</button
            >{/if}
        </div>
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <h4 bind:this={routingHeading} tabindex="-1" class="flex-1 text-sm font-medium">
            Groups &amp; routing
          </h4>
          <button class="btn" disabled={connection.busy} onclick={() => editGroup()}
            >Create group</button
          >
        </div>
        <p class="mt-1 text-xs text-muted">
          Groups choose among member models. Member order determines the fallback order for ordered
          routing.
        </p>
        {#if !snapshot.groups.length}<p class="mt-2 text-xs text-muted">
            No routing groups yet. Connect models first, then create a group.
          </p>{/if}
        {#each snapshot.groups as group (group.id)}
          <div class="box mt-2">
            <p class="text-sm font-medium">
              {group.name} · {group.ready ? 'Ready' : 'No ready members'}
            </p>
            <p class="mt-1 text-xs text-muted wrap-anywhere">
              {group.members.join(' → ') || 'No members'} · {routes.find(
                (r) => r.id === group.routing
              )?.name ?? group.routing}
            </p>
            <div class="mt-2 flex gap-2">
              <button class="btn ghost" disabled={connection.busy} onclick={() => editGroup(group)}
                >Edit routing</button
              ><button
                class="btn ghost"
                disabled={connection.busy}
                onclick={() => remove('group', group.id, group.name)}>Delete</button
              >
            </div>
          </div>
        {/each}
        {#if groupOpen}
          <form
            class="box mt-2"
            onsubmit={(event) => {
              event.preventDefault();
              void saveGroup();
            }}
          >
            <h4 class="text-sm font-medium">Group routing</h4>
            {#if snapshot.shared}<p class="notice mt-2">
                Saving changes this group's routing for all clients of this Magpie.
              </p>{/if}
            <label
              >Group ID<input
                class="field"
                required
                bind:value={groupId}
                readonly={groupEditing}
              /></label
            >
            <label>Group name<input class="field" required bind:value={groupName} /></label>
            <label
              >Routing<select class="field" bind:value={routing}
                >{#each routes as route (route.id)}<option value={route.id}>{route.name}</option
                  >{/each}</select
              ></label
            >
            <fieldset class="mt-2">
              <legend class="text-xs">Member models</legend
              >{#each snapshot.models as model (model.id)}<label class="member"
                  ><input type="checkbox" value={model.id} bind:group={members} />{model.name} ({model.provider})</label
                >{/each}
              {#each snapshot.groups.filter((g) => g.ready && g.id !== groupId) as nested (nested.id)}<label
                  class="member"
                  ><input type="checkbox" value={nested.ref} bind:group={members} />{nested.name} (routing
                  group)</label
                >{/each}
            </fieldset>
            {#if !snapshot.models.length}<p class="mt-1 text-xs text-muted">
                No models available to add.
              </p>{/if}
            {#if members.length}<ol class="mt-2 space-y-1">
                {#each members as member, i (member)}<li class="flex items-center gap-2 text-xs">
                    <span class="min-w-0 flex-1 wrap-anywhere">{i + 1}. {member}</span><button
                      class="btn ghost"
                      type="button"
                      aria-label="Move {member} earlier"
                      disabled={i === 0}
                      onclick={() => {
                        const next = [...members];
                        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                        members = next;
                      }}>↑</button
                    ><button
                      class="btn ghost"
                      type="button"
                      aria-label="Move {member} later"
                      disabled={i === members.length - 1}
                      onclick={() => {
                        const next = [...members];
                        [next[i], next[i + 1]] = [next[i + 1]!, next[i]!];
                        members = next;
                      }}>↓</button
                    ><button
                      class="btn ghost"
                      type="button"
                      aria-label="Remove {member} from group"
                      onclick={() => (members = members.filter((m) => m !== member))}>Remove</button
                    >
                  </li>{/each}
              </ol>{/if}
            <label
              >First-token timeout (seconds, 0 waits without a timeout)<input
                class="field"
                type="number"
                min="0"
                max="600"
                bind:value={firstToken}
              /></label
            >
            <label
              >Fallback patience (seconds, 0 uses Magpie default, -1 skips retries)<input
                class="field"
                type="number"
                min="-1"
                max="240"
                bind:value={patience}
              /></label
            >
            <div class="mt-2 flex gap-2">
              <button
                class="btn"
                disabled={connection.busy ||
                  !groupId.trim() ||
                  !groupName.trim() ||
                  !members.length}>Save group</button
              ><button class="btn ghost" type="button" onclick={() => (groupOpen = false)}
                >Cancel</button
              >
            </div>
          </form>
        {/if}
        <div class="box mt-3">
          <button
            class="btn ghost"
            disabled={connection.busy || connection.loading}
            onclick={async () => {
              inspect = true;
              await connection.act({ action: 'inspect' });
            }}>Inspect recent routes</button
          >
          <p class="mt-1 text-xs text-muted">
            Reads gateway request metadata on demand. It sends no model request.
          </p>
          {#if inspect}{#if snapshot.calls.length}<ul class="mt-2 space-y-2">
                {#each snapshot.calls as request, index (index)}<li class="text-xs wrap-anywhere">
                    {request.model} → {request.provider || 'No provider'} · HTTP {request.status} · {request.duration}
                    ms<br /><span class="text-muted">{request.at}</span>
                    {#if request.inputTokens !== undefined || request.outputTokens !== undefined || request.cachedTokens !== undefined}<p
                        class="mt-1 text-muted"
                      >
                        Tokens: {request.inputTokens ?? 'unavailable'} in · {request.outputTokens ??
                          'unavailable'} out · {request.cachedTokens ?? 'unavailable'} cached
                      </p>{/if}
                    {#if request.fallbackUsed}<p class="mt-1 text-muted">Fallback used.</p>{/if}
                    {#if request.attempts?.length}<ul
                        class="mt-1 space-y-1"
                        aria-label="Route attempts"
                      >
                        {#each request.attempts as attempt, i (i)}<li>
                            {attempt.provider || 'No provider'} · {attempt.model} · HTTP {attempt.status}
                            · {attempt.failed ? 'Failed' : 'Completed'}
                          </li>{/each}
                      </ul>{/if}
                  </li>{/each}
              </ul>{:else}<p class="mt-2 text-xs text-muted">
                No recent routes recorded by this Magpie.
              </p>{/if}{/if}
        </div>
      {/if}
    {:else}
      <div class="box mt-3">
        <p class="text-sm font-medium">Choose a Magpie connection</p>
        <p class="mt-1 text-xs text-muted">
          Connect your existing setup with its access link, or use a separate built-in copy.
        </p>
        {@render builtInChoice()}
      </div>
      <button class="btn ghost mt-2" disabled={connection.busy} onclick={openExisting}
        >Connect existing Magpie</button
      >
      <button class="btn ghost mt-2" disabled={connection.busy} onclick={openServer}
        >Connect to a Magpie server</button
      >
      {#if gatewayOpen}{@render localGatewayConnection()}{/if}
      {#if existing}{@render existingConnection()}{/if}
    {/if}
  {/if}
</section>

<style>
  .btn {
    border-radius: 0.625rem;
    background: var(--color-raise);
    padding-block: 0.55rem;
    padding-inline: 0.9rem;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-ink);
  }
  .btn:hover:not(:disabled) {
    background: var(--color-hairline);
  }
  .btn.ghost {
    color: var(--color-muted);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn:focus-visible,
  .field:focus-visible {
    outline: 2px solid var(--color-sea);
    outline-offset: 2px;
  }
  .field {
    min-inline-size: 0;
    inline-size: 100%;
    border: 1px solid var(--color-hairline);
    border-radius: 0.625rem;
    background: var(--color-raise);
    padding-block: 0.55rem;
    padding-inline: 0.75rem;
    font-size: 0.875rem;
    color: var(--color-ink);
  }
  .link {
    color: var(--color-sea);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .box {
    border: 1px solid var(--color-hairline);
    border-radius: 0.75rem;
    padding: 0.75rem;
    background: var(--color-raise);
  }
  .notice {
    border-inline-start: 2px solid var(--color-ember);
    padding-inline-start: 0.625rem;
    font-size: 0.75rem;
    color: var(--color-muted);
  }
  form > label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-block-start: 0.625rem;
    font-size: 0.75rem;
  }
  .member {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-block-start: 0.5rem;
    font-size: 0.75rem;
  }
  input[type='checkbox'] {
    flex: 0 0 auto;
  }
</style>
