<script lang="ts">
  // The folder an Odd asked for (`ask_for_folder`), on its card on the Desk:
  // the folder with the home written `~`, and what the Odd may do there. With
  // Change, the owner narrows it before giving it: the path field with the
  // system's own picker (`/api/folders/pick`), as on the Folders tab, and the
  // level. The Desk's Give access sends what is here; the server checks it as
  // the Folders tab's are checked.
  import { FOLDER_LABEL, type FolderAccess } from '@oddboro/ledger/access';
  import { call } from './api.ts';

  type Props = {
    /** The Odd that asked, by name. */
    name: string;
    /** The folder to give, as typed, picked or asked for. */
    path: string;
    level: FolderAccess;
    /** Whether the editor is open. */
    changing: boolean;
    picking?: boolean;
  };
  let {
    name,
    path = $bindable(),
    level = $bindable(),
    changing = $bindable(),
    picking = $bindable(false)
  }: Props = $props();

  const ACCESS: FolderAccess[] = ['read', 'write'];
  /** Why no picker opens here, or why picking failed: the typed path stays. */
  let problem = $state('');

  async function choose() {
    problem = '';
    picking = true;
    try {
      const r = await call<{ path?: string; cancelled?: true; unavailable?: string }>(
        '/api/folders/pick',
        { for: name }
      );
      if (r.unavailable) problem = `${r.unavailable} Type its path instead.`;
      else if (r.path) path = r.path;
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
    } finally {
      picking = false;
    }
  }
</script>

<div>
  <dt class="text-xs text-muted">The folder</dt>
  <dd class="mt-1 flex flex-col gap-1.5">
    {#if changing}
      <div class="flex gap-1.5">
        <input
          class="min-w-0 flex-1 rounded-lg bg-raise px-2 py-1 text-sm outline-none placeholder:text-faint"
          aria-label="The folder to give {name}, by its path"
          placeholder="~/Documents/Taxes"
          autocomplete="off"
          spellcheck="false"
          bind:value={path}
        />
        <button
          type="button"
          class="shrink-0 rounded-lg bg-raise px-2.5 py-1 text-xs font-medium hover:bg-sea/20 disabled:opacity-40"
          disabled={picking}
          onclick={choose}>{picking ? 'Pick it in the window' : 'Choose'}</button
        >
      </div>
      <span
        class="flex self-start rounded-lg bg-night/60 p-0.5"
        role="radiogroup"
        aria-label="What {name} may do there"
      >
        {#each ACCESS as a (a)}
          <button
            type="button"
            class="rounded-md px-2 py-0.5 text-xs whitespace-nowrap {level === a
              ? 'bg-sea/25 text-ink'
              : 'text-muted hover:text-ink'}"
            role="radio"
            aria-checked={level === a}
            onclick={() => (level = a)}>{FOLDER_LABEL[a]}</button
          >
        {/each}
      </span>
      {#if problem}<p class="text-[11px] text-coral">{problem}</p>{/if}
    {:else}
      <div class="flex items-center gap-2 rounded-lg bg-raise px-2.5 py-2">
        <svg
          class="size-4 shrink-0 text-muted"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M1.75 4.25v8.5h12.5v-7h-6.5l-1.5-1.5h-4.5z" /></svg
        >
        <span class="min-w-0 flex-1 truncate text-sm" title={path}>{path}</span>
        <span class="shrink-0 text-xs text-muted">{FOLDER_LABEL[level]}</span>
      </div>
    {/if}
  </dd>
</div>
