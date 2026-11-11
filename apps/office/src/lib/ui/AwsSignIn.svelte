<script lang="ts">
  // The desk step that connects one AWS tool: the owner signs in to AWS on its
  // own page (once for every AWS tool), then picks the role this tool uses and
  // its Region. Picking connects it: for AWS read only and builder, the office
  // first checks the role cannot read a secret value. Nothing here is a secret.
  import { AWS_GUIDES, siteLink } from '../site.ts';
  import { call } from './api.ts';

  type Role = { accountId: string; accountName: string; roleName: string };
  type Current = {
    place: { startUrl: string; ssoRegion: string } | null;
    signedIn: boolean;
    /** AWS's page and code while a sign-in waits, from whichever tab started it. */
    signingIn: { url: string; code: string } | null;
    aws: { accountId: string; role: string; region: string } | null;
  };

  let { taskId, index, connector }: { taskId: number; index: number; connector: string } = $props();

  const SECRETS = $derived(connector === 'aws-secrets');
  const roleLabel = $derived(
    SECRETS
      ? 'The role the office reads your secrets with'
      : connector === 'aws-build'
        ? 'The role your Odds build in AWS with'
        : 'The role your Odds read AWS with'
  );
  const regionLabel = $derived(SECRETS ? 'Region your secrets are in' : 'Region your work is in');

  let startUrl = $state('');
  let ssoRegion = $state('us-east-1');
  let code = $state('');
  let page = $state('');
  let roles = $state<Role[] | null>(null);
  let accountId = $state('');
  let role = $state('');
  let region = $state('');
  let busy = $state(false);
  let waiting = $state(false);
  let problem = $state('');
  let saved: Current['aws'] = null;

  // A newer portal URL names its Region (ssoins-….us-east-1.portal.amazonaws.com,
  // or ssoins-….portal.us-east-1.app.aws), so the owner need not type it.
  function regionFromUrl() {
    const named = startUrl.match(
      /[.-]([a-z]{2}(?:-[a-z]+)+-\d)\.portal\.|\.portal\.([a-z]{2}(?:-[a-z]+)+-\d)\./
    );
    if (named) ssoRegion = named[1] ?? named[2];
  }

  const post = <T,>(body: Record<string, unknown>) =>
    call<T>(`/api/tasks/${taskId}`, { index, ...body });

  // Signed in already, by this tool or another: straight to the roles. A
  // sign-in still waiting on AWS's page (the desk closed and opened again, or opened in another tab)
  // waits here too, and moves on when the owner approves it.
  $effect(() => {
    post<Current>({ op: 'aws-current' })
      .then((r) => {
        saved = r.aws;
        if (r.place) ({ startUrl, ssoRegion } = r.place);
        if (r.signedIn) return loadRoles();
        if (r.signingIn) {
          ({ url: page, code } = r.signingIn);
          waiting = true;
          return loadRoles().finally(() => (waiting = false));
        }
      })
      .catch((e) => (problem = e instanceof Error ? e.message : String(e)));
  });

  const accounts = $derived(
    [...new Map((roles ?? []).map((r) => [r.accountId, r.accountName])).entries()].map(
      ([id, name]) => ({ id, name })
    )
  );
  const inAccount = $derived((roles ?? []).filter((r) => r.accountId === accountId));

  async function loadRoles() {
    const found = await post<{ roles: Role[] }>({ op: 'aws-roles' });
    roles = found.roles;
    accountId = saved?.accountId ?? found.roles[0]?.accountId ?? '';
    role = saved?.role ?? '';
    region = saved?.region ?? '';
  }

  async function lookAgain() {
    busy = true;
    problem = '';
    try {
      await loadRoles();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function signIn() {
    busy = true;
    problem = '';
    roles = null;
    try {
      const r = await post<{ url: string; code: string }>({
        op: 'aws-sign-in',
        startUrl,
        ssoRegion
      });
      code = r.code;
      page = r.url;
      window.open(r.url, '_blank', 'noopener');
      waiting = true;
      await loadRoles();
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      waiting = false;
    }
  }

  async function connect() {
    busy = true;
    problem = '';
    try {
      // The step ticks on the server; the desk reloads with it done.
      await post({ op: 'aws-choose', accountId, role, region });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="mt-2 flex flex-col gap-2 text-xs">
  {#if !roles}
    <label class="flex flex-col gap-1">
      <span class="text-muted">AWS access portal URL</span>
      <input
        class="rounded-lg bg-night/60 px-2.5 py-1.5 outline-none"
        placeholder="https://ssoins-….us-east-1.portal.amazonaws.com"
        bind:value={startUrl}
        oninput={regionFromUrl}
        disabled={busy}
      />
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-muted">Identity Center Region</span>
      <input
        class="rounded-lg bg-night/60 px-2.5 py-1.5 outline-none"
        placeholder="us-east-1"
        bind:value={ssoRegion}
        disabled={busy}
      />
    </label>
    {#if waiting}
      <p class="text-muted">
        Approve the sign-in on AWS's page{code ? `, which shows the code ${code}` : ''}. This waits
        for you.
        {#if page}
          <a class="underline hover:text-ink" href={page} target="_blank" rel="noopener"
            >Open it again</a
          >
        {/if}
      </p>
    {:else}
      <button
        class="self-start rounded-lg bg-sea px-3 py-1.5 font-medium text-night disabled:opacity-40"
        disabled={busy || !startUrl.trim() || !ssoRegion.trim()}
        onclick={signIn}>Sign in</button
      >
    {/if}
  {:else if !roles.length}
    <p class="text-muted">
      You are signed in, and your AWS user has no roles yet. Make the role and give it to your user
      (<a
        class="underline hover:text-ink"
        href={siteLink(AWS_GUIDES[connector]?.path ?? '/connectors/aws-sign-in/')}
        target="_blank"
        rel="noopener">how</a
      >), then click Look again.
    </p>
    <div class="flex gap-2">
      <button
        class="rounded-lg bg-sea px-3 py-1.5 font-medium text-night disabled:opacity-40"
        disabled={busy}
        onclick={lookAgain}>Look again</button
      >
      <button
        class="rounded-lg bg-night/60 px-3 py-1.5 text-muted hover:text-ink disabled:opacity-40"
        disabled={busy}
        onclick={() => (roles = null)}>Sign in again</button
      >
    </div>
  {:else}
    {#if accounts.length > 1}
      <label class="flex flex-col gap-1">
        <span class="text-muted">Account</span>
        <select class="rounded-lg bg-night/60 px-2.5 py-1.5" bind:value={accountId} disabled={busy}>
          {#each accounts as a (a.id)}
            <option value={a.id}>{a.name} ({a.id})</option>
          {/each}
        </select>
      </label>
    {/if}
    <label class="flex flex-col gap-1">
      <span class="text-muted">{roleLabel}</span>
      <select class="rounded-lg bg-night/60 px-2.5 py-1.5" bind:value={role} disabled={busy}>
        <option value="">Pick a role</option>
        {#each inAccount as r (r.roleName)}
          <option value={r.roleName}>{r.roleName}</option>
        {/each}
      </select>
    </label>
    <label class="flex flex-col gap-1">
      <span class="text-muted">{regionLabel}</span>
      <input
        class="rounded-lg bg-night/60 px-2.5 py-1.5 outline-none"
        placeholder="Such as us-east-2"
        bind:value={region}
        disabled={busy}
      />
    </label>
    <div class="flex gap-2">
      <button
        class="rounded-lg bg-sea px-3 py-1.5 font-medium text-night disabled:opacity-40"
        disabled={busy || !role || !region.trim()}
        onclick={connect}
        >{busy
          ? SECRETS
            ? 'Connecting'
            : 'Checking'
          : SECRETS
            ? 'Connect'
            : 'Check and connect'}</button
      >
      <button
        class="rounded-lg bg-night/60 px-3 py-1.5 text-muted hover:text-ink disabled:opacity-40"
        disabled={busy}
        onclick={() => (roles = null)}>Sign in again</button
      >
    </div>
  {/if}
  {#if problem}<p class="text-ember">{problem}</p>{/if}
</div>
