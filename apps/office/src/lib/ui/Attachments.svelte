<script lang="ts">
  import type { AttachmentRow } from '@oddboro/ledger';
  import FileEditor from './FileEditor.svelte';
  import { offers } from './viewer.ts';
  import { openFile, type FileRef } from './windows.svelte.ts';

  // The files a staffer attached to an ask or a task. A Markdown one opens in
  // the editor right here; anything else opens in its own window. One from a
  // thread's folder shows by its bare name and opens to read only (`offers`).
  type Props = {
    items: AttachmentRow[];
    /** Where a Markdown file starts: Edit when the owner has to fill it in. */
    start?: 'view' | 'edit';
    reference?: boolean;
    ondirty?: (dirty: boolean) => void;
  };
  let { items, start = 'view', reference = false, ondirty }: Props = $props();

  const ref = (f: AttachmentRow): FileRef => ({
    staff: f.staffId,
    path: f.path,
    readOnly: reference
  });
  // svelte-ignore state_referenced_locally: each file starts in this mode, then the owner switches it
  let mode = $state<Record<number, 'view' | 'edit'>>(
    Object.fromEntries(items.map((f) => [f.id, offers(ref(f)).edit ? start : 'view']))
  );
  let dirty = $state<Record<number, boolean>>({});
  $effect(() => ondirty?.(Object.values(dirty).some(Boolean)));

  const name = (f: AttachmentRow) => f.path.split('/').pop() ?? f.path;
  const isMarkdown = (f: AttachmentRow) => f.mediaType === 'text/markdown';
  const kind = (f: AttachmentRow) =>
    isMarkdown(f) ? 'Markdown' : (f.path.split('.').pop()?.toUpperCase() ?? 'File');
</script>

{#if items.length}
  <section class="mt-4 flex flex-col gap-2" aria-label="Attachments">
    <h3 class="text-xs text-muted">Attached</h3>
    {#each items as f (f.id)}
      <div class="rounded-xl bg-raise p-3">
        <div class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">{name(f)}</div>
            <div class="truncate text-[11px] text-faint">{kind(f)} · {offers(ref(f)).shown}</div>
          </div>
          {#if isMarkdown(f) && offers(ref(f)).edit}
            <div
              class="flex gap-0.5 rounded-full bg-night/60 p-0.5"
              role="group"
              aria-label={`View or edit ${name(f)}`}
            >
              {#each [{ id: 'view', label: 'View' }, { id: 'edit', label: 'Edit' }] as const as m (m.id)}
                <button
                  class="rounded-full px-2.5 py-0.5 text-xs {mode[f.id] === m.id
                    ? 'bg-sea/30 text-ink'
                    : 'text-muted'}"
                  aria-pressed={mode[f.id] === m.id}
                  onclick={() => (mode[f.id] = m.id)}>{m.label}</button
                >
              {/each}
            </div>
          {/if}
          <button
            class="rounded-lg px-2 py-1 text-xs text-muted hover:text-ink"
            title="Open it in its own window"
            onclick={() => openFile(ref(f))}>{isMarkdown(f) ? 'Pop out' : 'Open'}</button
          >
        </div>
        {#if isMarkdown(f)}
          <div class="mt-2">
            <FileEditor
              file={ref(f)}
              mode={reference ? 'view' : mode[f.id]}
              inline
              ondirty={(d) => (dirty[f.id] = d)}
            />
          </div>
        {/if}
      </div>
    {/each}
  </section>
{/if}
