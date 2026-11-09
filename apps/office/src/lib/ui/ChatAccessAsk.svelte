<script lang="ts">
  import { untrack } from 'svelte';
  import type { Delivery } from '@oddboro/ledger';
  import { FOLDER_LABEL } from '@oddboro/ledger/access';
  import FolderAsk from './FolderAsk.svelte';
  import { call } from './api.ts';

  let {
    item,
    name,
    onchanged
  }: {
    item: Pick<Delivery, 'id' | 'status' | 'why' | 'folder' | 'web'>;
    name: string;
    onchanged: () => void;
  } = $props();
  // The parent keys this editor by ask id. Office updates and picker focus keep the owner's edits.
  let path = $state(untrack(() => item.folder?.path ?? ''));
  let level = $state(untrack(() => item.folder?.level ?? 'read'));
  let changing = $state(false);
  let picking = $state(false);
  let busy = $state(false);
  let problem = $state('');

  async function decide(decision: 'approve' | 'deny') {
    if (busy || picking || item.status !== 'open') return;
    busy = true;
    problem = '';
    const url = `/api/asks/${item.id}`;
    try {
      if (decision === 'approve' && item.folder) await call(`${url}/folder`, { path, level });
      else await call(url, { decision });
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      onchanged();
    }
  }
</script>

<div class="space-y-1.5 rounded-lg border border-hairline p-2 text-xs">
  {#if item.status === 'open' && item.why}<p>{item.why}</p>{/if}
  {#each item.web ?? [] as target (target.id)}
    <p>
      <strong>{target.name}</strong> · {target.result ??
        (target.alreadyOn ? 'Already on. ' : '') + target.reach}
    </p>
  {/each}
  {#if item.folder?.given}
    <p>{name} · {FOLDER_LABEL[item.folder.given.level]} · {item.folder.given.path}</p>
  {/if}
  {#if item.status === 'open'}
    {#if item.folder}
      <dl><FolderAsk {name} bind:path bind:level bind:changing bind:picking /></dl>
    {/if}
    <div class="flex flex-wrap gap-2">
      <button class="text-muted" disabled={busy || picking} onclick={() => decide('deny')}
        >Deny</button
      >
      {#if item.folder && !changing}
        <button class="text-sea" disabled={busy} onclick={() => (changing = true)}>Change</button>
      {/if}
      <button
        class="rounded-md bg-sea px-2 py-1 text-night"
        disabled={busy || picking || (!!item.folder && !path.trim())}
        onclick={() => decide('approve')}>{item.folder ? 'Give access' : 'Allow browsing'}</button
      >
    </div>
  {/if}
  {#if problem}<p class="text-coral" role="alert">{problem}</p>{/if}
</div>
