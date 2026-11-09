<script lang="ts">
  import { onDestroy } from 'svelte';
  import { AGENT_NAMES, OFFICE_ACCOUNT } from '@oddboro/ledger/agents';
  import type { ChatSignIn } from '#lib/server/staff.ts';
  import { AgentTools } from './agent-tools.svelte.ts';
  import { call } from './api.ts';
  import { toolAction } from './tool-action.ts';

  let {
    request,
    name,
    onready,
    onedit,
    retryLabel = 'Retry message'
  }: {
    request: ChatSignIn;
    name: string;
    onready: () => void;
    onedit?: () => void;
    retryLabel?: string;
  } = $props();
  const tools = new AgentTools();
  const agent = $derived(request.agent);
  const tool = $derived(tools.tools.find((t) => t.id === agent));
  const action = $derived(toolAction(tool));
  const added = $derived(
    request.account === OFFICE_ACCOUNT
      ? undefined
      : tools.accounts.find((a) => a.id === request.account && a.agent === agent)
  );
  const signIn = $derived(
    added?.signIn ?? (request.account === OFFICE_ACCOUNT ? tool?.signIn : undefined)
  );
  let key = $state('');
  let busy = $state(false);
  let problem = $state('');
  let active = true;
  onDestroy(() => {
    active = false;
  });

  async function connect() {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      if (request.how === 'key') {
        if (agent === 'claude') await call('/api/setup/claude', { key }, 'PUT');
        else if (!(await tools.setKey(agent, key))) return;
        key = '';
      } else {
        if (!(await tools.signIn(agent, added?.id))) return;
        await tools.load();
        if (!signIn?.signedIn) {
          problem = 'The account is still signed out. Try signing in again.';
          return;
        }
      }
      if (active) onready();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:window onfocus={() => tools.load()} />
<div class="ms-auto w-[85%] space-y-1.5 rounded-lg border border-hairline p-2 text-xs">
  <p class="font-medium">
    {name} needs {AGENT_NAMES[agent]} · {added?.label ??
      (request.account === OFFICE_ACCOUNT ? 'Office' : request.account)}
  </p>
  {#if tool && action === 'update'}
    <button class="text-sea" onclick={() => tools.install(agent, 'update')}
      >Update {tool.name}</button
    >
  {:else if action === 'installing'}
    <p>Installing {AGENT_NAMES[agent]}…</p>
  {:else if tool && action === 'install'}
    <button class="text-sea" disabled={signIn?.installing} onclick={() => tools.install(agent)}
      >Install {tool.name}</button
    >
  {:else if tools.loaded && !signIn}
    <p>This account is unavailable. Check {name}'s Model settings.</p>
  {:else if request.how === 'key'}
    <form
      class="flex flex-wrap gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <input
        class="min-w-0 flex-1 rounded-md bg-raise px-2"
        type="password"
        aria-label="{AGENT_NAMES[agent]} API key"
        placeholder="API key"
        autocomplete="off"
        bind:value={key}
      />
      <button class="text-sea" disabled={busy || !key.trim()}>Save key and continue</button>
    </form>
  {:else if signIn?.waiting}
    {#if signIn.waiting.url}
      <a href={signIn.waiting.url} target="_blank" rel="noopener noreferrer" class="text-sea"
        >Open sign-in page</a
      >
    {/if}
    <button class="ms-2 text-muted" onclick={() => tools.cancel(agent)}>Cancel sign-in</button>
  {:else}
    <button class="text-sea" disabled={!signIn || busy} onclick={connect}
      >Sign in and continue</button
    >
    {#if signIn?.signedIn || signIn?.ownLogin}<button
        class="ms-2 text-sea"
        disabled={busy}
        onclick={onready}>{retryLabel}</button
      >{/if}
  {/if}
  {#if onedit}<button class="block text-muted" onclick={onedit}>Back to message</button>{/if}
  {#if problem || tools.problems[agent]}<p class="text-coral" role="alert">
      {problem || tools.problems[agent]}
    </p>{/if}
</div>
