<script lang="ts">
  import FileEditor from './FileEditor.svelte';
  import { offers, openInBrowser, whose } from './viewer.ts';
  import { close, wins, type FileRef } from './windows.svelte.ts';

  /** `nameOf` gives an Odd's name from its id. */
  type Props = { id: string; file: FileRef; nameOf: (staffId: string) => string };
  let { id, file, nameOf }: Props = $props();

  let editor: FileEditor | undefined = $state();
  let mode = $state<'view' | 'edit'>('view');

  const name = $derived(file.path.split('/').pop() ?? file.path);
  const offered = $derived(offers(file));
  /** Why the page did not open, shown until the next try. */
  let pageProblem = $state('');
  let opening = $state(false);

  async function openPage() {
    opening = true;
    pageProblem = '';
    try {
      await openInBrowser(file);
    } catch (e) {
      pageProblem = e instanceof Error ? e.message : String(e);
    } finally {
      opening = false;
    }
  }
</script>

<section class="flex h-full min-h-0 flex-col" aria-label={`File ${name}`}>
  <header class="flex items-center gap-2 border-b border-hairline p-3">
    <button
      class="rounded-full px-2 py-1 text-sm text-muted hover:text-ink"
      onclick={() => close(id)}>Back</button
    >
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-medium">{name}</div>
      <div class="truncate text-[11px] text-muted">{whose(file, nameOf)}</div>
    </div>
    {#if offered.browser}
      <button
        class="rounded-lg border border-hairline px-2 py-1 text-xs text-sea disabled:opacity-40"
        disabled={opening}
        onclick={openPage}>Open in browser</button
      >
    {/if}
    {#if offered.edit}
      <div class="flex gap-0.5 rounded-full bg-raise p-0.5" role="group" aria-label="View or edit">
        {#each [{ id: 'view', label: 'View' }, { id: 'edit', label: 'Edit' }] as const as m (m.id)}
          <button
            class="rounded-full px-2.5 py-0.5 text-xs {mode === m.id
              ? 'bg-sea/30 text-ink'
              : 'text-muted'}"
            aria-pressed={mode === m.id}
            onclick={() => (mode = m.id)}>{m.label}</button
          >
        {/each}
      </div>
    {/if}
  </header>

  {#if pageProblem}
    <p class="mx-3 mt-3 rounded-lg bg-coral/15 px-3 py-2 text-xs text-coral">{pageProblem}</p>
  {/if}

  {#if wins.confirm?.id === id}
    <div class="flex flex-wrap items-center gap-2 border-b border-hairline bg-ember/10 px-3 py-2">
      <span class="flex-1 text-xs text-ink">You have unsaved changes.</span>
      <button
        class="rounded-lg bg-sea px-2.5 py-1 text-xs font-medium text-night"
        onclick={async () => {
          const go = wins.confirm?.go;
          if (go && (await editor?.save())) go();
        }}>Save and close</button
      >
      <button
        class="rounded-lg bg-raise px-2.5 py-1 text-xs hover:bg-coral/25"
        onclick={() => wins.confirm?.go()}>Discard</button
      >
      <button
        class="rounded-lg px-2.5 py-1 text-xs text-muted hover:text-ink"
        onclick={() => (wins.confirm = undefined)}>Keep editing</button
      >
    </div>
  {/if}

  <FileEditor bind:this={editor} {file} bind:mode ondirty={(d) => (wins.dirty[id] = d)} />
</section>
