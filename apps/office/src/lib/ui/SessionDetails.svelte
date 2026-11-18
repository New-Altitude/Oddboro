<script lang="ts">
  import type { ProjectRequest } from '@oddboro/ledger';
  import type { StaffProfile } from '../staff/roster.ts';
  import type { Row, View } from './ProjectSessions.svelte';

  // The open session's Details drawer, over its terminal: Codex's question, an
  // instruction or correction to send, which Odd may send work, how to connect an
  // existing Claude terminal, and the session's requests.
  type Props = {
    selected: Row;
    /** Undefined until the session's view lands. */
    view?: View;
    work: ProjectRequest[];
    staff: StaffProfile[];
    busy: boolean;
    /** Runs one owner action, its error shown over the terminal. */
    run: (fn: () => Promise<unknown>) => Promise<void>;
    /** Sends `op` for this session, then reads the session again. */
    action: (op: string, fields?: Record<string, unknown>) => Promise<void>;
    oddOf: (id: string | null) => StaffProfile | undefined;
    onclose: () => void;
    // The window keeps what is typed here, so shutting the drawer keeps it and
    // opening another session clears it.
    draft: string;
    file: string;
    replies: Record<string, string>;
    /** The Odd waiting on the owner's second yes to send without asking. */
    unasked?: string;
  };
  let {
    selected,
    view,
    work,
    staff,
    busy,
    run,
    action,
    oddOf,
    onclose,
    draft = $bindable(),
    file = $bindable(),
    replies = $bindable(),
    unasked = $bindable()
  }: Props = $props();

  /** Each request's state, as the owner reads it. */
  const STATE: Record<ProjectRequest['state'], string> = {
    proposed: 'Waiting for you',
    queued: 'Queued',
    authorized: 'Queued',
    sending: 'Sending',
    working: 'Working',
    done: 'Done',
    stopped: 'Stopped',
    uncertain: 'Check the conversation',
    failed: 'Failed'
  };
  async function send() {
    const text = draft.trim();
    if (!text) return;
    const turn = view?.turn || (selected.agent === 'claude' ? view?.requestId : undefined);
    if (turn) await action('steer', { turn, prompt: text, file: file.trim() || undefined });
    else
      await action('send', {
        key: crypto.randomUUID(),
        prompt: text,
        file: file.trim() || undefined
      });
    draft = '';
    file = '';
  }
</script>

<aside
  id="project-details"
  class="drawer absolute inset-y-0 end-0 flex flex-col gap-3 overflow-y-auto border-s border-hairline p-3"
  aria-label="Session details"
>
  <div class="flex items-center">
    <h3 class="flex-1 text-xs tracking-[0.16em] text-sea uppercase">Details</h3>
    <button
      class="rounded-full px-2 py-0.5 text-muted hover:text-ink"
      aria-label="Close details"
      onclick={onclose}>✕</button
    >
  </div>
  <p class="text-xs break-all text-muted">
    {selected.title} · {selected.folder} · {selected.nativeId}
  </p>
  {#if view?.account}<p class="text-xs text-muted">
      Codex sign-in at connection: {view.account}
    </p>{/if}
  {#if selected.mark}<p class="text-xs text-muted">
      Claude folder: {selected.mark}
    </p>{/if}

  {#if view?.question}<div class="flex flex-col gap-2 rounded-lg bg-ember/10 p-2">
      <strong class="text-ink">Codex needs your answer</strong>
      <pre class="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(
          view.question.params,
          null,
          2
        )}</pre>
      {#if ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval'].includes(view.question.method)}
        <div class="flex gap-2">
          <button
            class="btn"
            onclick={() =>
              run(() =>
                action('answer', {
                  request: view?.question?.id,
                  key: view?.question?.key,
                  pick: 'accept'
                })
              )}>Allow once</button
          ><button
            class="btn"
            onclick={() =>
              run(() =>
                action('answer', {
                  request: view?.question?.id,
                  key: view?.question?.key,
                  pick: 'decline'
                })
              )}>Decline</button
          >
        </div>
      {:else if view.question.method === 'item/tool/requestUserInput'}
        {#each view.question.params.questions as { id: string; question: string; options?: { label: string }[]; isSecret?: boolean }[] as q (q.id)}
          <label
            >{q.question}<input
              class="field w-full"
              type={q.isSecret ? 'password' : 'text'}
              bind:value={replies[q.id]}
              placeholder={q.options?.map((o) => o.label).join(' / ')}
            /></label
          >
        {/each}
        <button
          class="btn self-start"
          onclick={() =>
            run(async () => {
              await action('answer', {
                request: view?.question?.id,
                key: view?.question?.key,
                pick: 'accept',
                answers: Object.fromEntries(Object.entries(replies).map(([k, v]) => [k, [v]]))
              });
              replies = {};
            })}>Send answers</button
        >
      {:else}<p>Use the native terminal to review this request.</p>{/if}
    </div>{/if}

  {#if view?.connected}
    <form
      class="flex flex-col gap-2"
      onsubmit={(e) => {
        e.preventDefault();
        void run(send);
      }}
    >
      <label
        >{view.turn || (selected.agent === 'claude' && view.requestId)
          ? 'Correction to the current work'
          : 'Instruction'}
        <textarea class="field w-full" rows="3" bind:value={draft}></textarea></label
      >
      <label
        >Project file (optional)<input
          class="field w-full"
          bind:value={file}
          placeholder="Path inside this project"
        /></label
      >
      <div class="flex gap-2">
        <button class="btn" disabled={busy || !draft.trim()}
          >{view.turn || (selected.agent === 'claude' && view.requestId)
            ? 'Send correction'
            : 'Send instruction'}</button
        >
        {#if view.turn || view.requestId}<button
            class="btn"
            type="button"
            onclick={() => run(() => action('stop', { expected: view?.turn || view?.requestId }))}
            >Stop</button
          >{/if}
      </div>
    </form>
  {/if}
  {#if view?.reply}<pre class="whitespace-pre-wrap">{view.reply}</pre>{/if}

  <label
    >Odd allowed to send work with this session’s project tools
    <select
      class="field w-full"
      value={selected.staffId ?? ''}
      disabled={busy}
      onchange={(e) =>
        run(() => action('share', { staffId: (e.target as HTMLSelectElement).value || null }))}
    >
      <option value="">Only me</option>{#each staff as s (s.id)}<option value={s.id}
          >{s.name}</option
        >{/each}
    </select>
  </label>
  {#if selected.staffId}
    {@const odd = oddOf(selected.staffId)?.name ?? 'This Odd'}
    <!-- Every assignment from an Odd waits for Take over and send, unless the owner ticks this. -->
    <label class="tick"
      ><input
        type="checkbox"
        checked={selected.sendsUnasked === selected.staffId}
        disabled={busy}
        onchange={(e) => {
          const box = e.target as HTMLInputElement;
          const on = box.checked;
          box.checked = !on;
          if (on) unasked = selected.staffId ?? undefined;
          else void run(() => action('unasked', { staffId: null }));
        }}
      />Let {odd} send work without asking</label
    >
    {#if unasked === selected.staffId}<div
        class="flex flex-col gap-2 rounded-lg bg-ember/10 p-2"
        role="alertdialog"
        aria-labelledby="unasked-warning"
      >
        <p id="unasked-warning" class="text-ink">
          {odd} will send work into this session without asking you. It runs with your permissions.
        </p>
        <div class="flex gap-2">
          <button
            class="btn"
            onclick={() =>
              run(async () => {
                await action('unasked', { staffId: unasked });
                unasked = undefined;
              })}>Let {odd} send</button
          ><button class="btn" onclick={() => (unasked = undefined)}>Not now</button>
        </div>
      </div>{/if}
  {/if}

  {#if selected.agent === 'claude' && view?.market}
    <details>
      <summary class="cursor-pointer text-xs text-muted">
        Connect an existing Claude terminal to office assignments
      </summary>
      <p class="text-xs">
        In that conversation, add the local marketplace, install its plugin, then reload plugins. If
        it is already installed, update it with /plugin before reloading. New sessions opened here
        load it at launch.
      </p>
      <pre class="whitespace-pre-wrap break-all">/plugin marketplace add {JSON.stringify(
          view.market
        )} --scope local{'\n'}/plugin install oddboro-project-{selected.id}@oddboro-{selected.id} --scope local{'\n'}/reload-plugins</pre>
    </details>
  {/if}

  {#if work.length}
    <h3 class="text-xs tracking-[0.16em] text-sea uppercase">Requests</h3>
  {/if}
  {#each work as r (r.id)}<div class="flex flex-col gap-1 border-t border-hairline pt-2">
      <strong class="text-[10px] tracking-[0.16em] text-ember uppercase"
        >{STATE[r.state]}{#if r.staffId}<span class="text-faint">
            · {oddOf(r.staffId)?.name ?? 'An Odd'}</span
          >{/if}</strong
      >
      <p class="whitespace-pre-wrap">{r.prompt}</p>
      {#if r.file}<p class="text-xs text-muted">Project file: {r.file}</p>{/if}
      {#if r.answer}<p class="whitespace-pre-wrap text-muted">{r.answer}</p>{/if}
      {#if r.state === 'proposed' || r.state === 'failed'}<p class="text-xs text-muted">
          This runs with your permissions on this computer.
        </p>
        <div class="flex gap-2">
          <button
            class="btn"
            onclick={() => run(() => action('decide', { key: r.id, approve: true }))}
            >{r.state === 'failed' ? 'Retry assignment' : 'Take over and send'}</button
          ><button
            class="btn"
            onclick={() => run(() => action('decide', { key: r.id, approve: false }))}
            >Decline</button
          >
        </div>{/if}
      {#if r.state === 'uncertain'}<button
          class="btn self-start"
          onclick={() => run(() => action('resolve', { key: r.id }))}
          >I checked the native conversation</button
        >{/if}
    </div>{/each}
</aside>

<style>
  pre {
    border-radius: 0.5rem;
    background: var(--color-night);
    padding: 0.5rem;
    font-size: 0.75rem;
  }
  /* Over the terminal, solid, so the terminal's text never shows through. Its width,
     --drawer, is set on the terminal area in ProjectSessions.svelte. */
  .drawer {
    inline-size: min(var(--drawer), 100%);
    background: var(--color-panel-solid);
    box-shadow: var(--shadow-float);
  }
</style>
