<script lang="ts">
  // The warning before the owner gives an Odd a whole drive or system files
  // (`FOLDER_WARNING` in the ledger): a warning icon, the server's line, a
  // link to the site's page on why, and Accept and Cancel. Accept gives the
  // folder; Cancel gives nothing.
  import { siteLink } from '#lib/site.ts';

  type Props = {
    /** The folder, as the owner reads it. */
    folder: string;
    /** The server's line. */
    warning: string;
    busy?: boolean;
    onaccept: () => void;
    oncancel: () => void;
  };
  let { folder, warning, busy = false, onaccept, oncancel }: Props = $props();
</script>

<div
  class="flex flex-col gap-2 rounded-lg border border-ember/50 bg-ember/10 px-3 py-2.5"
  role="alert"
>
  <div class="flex gap-2">
    <svg
      class="mt-0.5 size-4 shrink-0 text-ember"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-label="Warning"
      role="img"
      ><path d="M8 1.75 15 14.25H1z" /><path d="M8 6.25v3.5" /><path d="M8 11.75v.01" /></svg
    >
    <div class="min-w-0 text-xs">
      <p class="truncate font-medium text-ink" title={folder}>{folder}</p>
      <p class="mt-0.5 text-muted">
        {warning}
        <a
          class="text-ink underline underline-offset-2 hover:text-sea"
          href={siteLink('/info/folder-sharing/')}
          target="_blank"
          rel="noopener">More info</a
        >
      </p>
    </div>
  </div>
  <div class="flex justify-end gap-1.5">
    <button
      type="button"
      class="rounded-lg bg-raise px-2.5 py-1 text-xs font-medium hover:bg-sea/20 disabled:opacity-40"
      disabled={busy}
      onclick={oncancel}>Cancel</button
    >
    <button
      type="button"
      class="rounded-lg bg-ember/25 px-2.5 py-1 text-xs font-medium text-ink hover:bg-ember/40 disabled:opacity-40"
      disabled={busy}
      onclick={onaccept}>Accept</button
    >
  </div>
</div>
