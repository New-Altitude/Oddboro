<script lang="ts">
  import type { Desk, TaskRow } from '@oddboro/ledger';
  import Markdown from './Markdown.svelte';
  import TaskResponse from './TaskResponse.svelte';
  import { current, drafts, writing, staleDraft } from './task-response.svelte.ts';
  import Attachments from './Attachments.svelte';
  import PostalMailbox from './PostalMailbox.svelte';
  import AwsSignIn from './AwsSignIn.svelte';
  import AwsSecretPick from './AwsSecretPick.svelte';
  import { AWS_GUIDES, siteLink } from '../site.ts';
  import { tickable } from '@oddboro/ledger/tools';
  import type { DeskItem } from '@oddboro/ledger/desk-answers';
  import type { StaffProfile } from '../staff/roster.ts';
  import { chatAnswer, stepText, stepsToGo } from './task-steps.ts';

  // An open task on the Desk: its steps with their actions, its response and
  // files, the note and Mark done. The drawer keeps the state, which this
  // writes through its bindings, and the actions.

  type Props = {
    open: { key: string; row: TaskRow };
    desk: Desk;
    /** The Odd who sent the task, if any. */
    from: StaffProfile | undefined;
    busy: boolean;
    toolList: Record<number, { name: string; description: string; readOnly: boolean }[]>;
    who: (id: string | null) => StaffProfile | undefined;
    attached: (kind: Exclude<DeskItem, 'report'>, id: number) => Desk['attachments'];
    step: (t: TaskRow, index: number, body: Record<string, unknown>) => Promise<void>;
    saveSecret: (t: TaskRow, index: number) => Promise<void>;
    hostedSignIn: (t: TaskRow, index: number) => Promise<void>;
    loadTools: (t: TaskRow, index: number) => Promise<void>;
    finish: (t: TaskRow, done: boolean) => Promise<void>;
    unsaved: boolean;
    note: string;
    secret: Record<number, string>;
  };
  let {
    open,
    desk,
    from,
    busy,
    toolList,
    who,
    attached,
    step,
    saveSecret,
    hostedSignIn,
    loadTools,
    finish,
    unsaved = $bindable(),
    note = $bindable(),
    secret = $bindable()
  }: Props = $props();

  const t = $derived(open.row);
  const toGo = $derived(stepsToGo(t.steps));
  const response = $derived(current(t));
  const draft = $derived(drafts[t.id]);
  const needsSave = $derived(!!draft || (response.response !== null && !response.responseVersion));
  const blockedResponse = $derived(
    writing[t.id] ||
      staleDraft(draft, response) ||
      (needsSave && !(draft?.text ?? response.response)?.trim())
  );
  const how = $derived(
    chatAnswer({ ...t, response: response.response }, attached('task', t.id).length > 0)
  );
</script>

<p class="mt-2 text-sm leading-relaxed text-muted">{t.why}</p>
<!-- A question with one answer has no steps: its answer goes in the response below. -->
<ol class="mt-3 flex flex-col gap-2" class:hidden={!t.steps.length}>
  {#each t.steps as s, index (index)}
    <li class="flex gap-2.5 rounded-xl bg-raise px-3 py-2.5 text-sm" class:opacity-60={s.done}>
      <span class="font-pixel text-faint">{index + 1}.</span>
      <div class="min-w-0 flex-1">
        <div class="flex items-start gap-2">
          {#if tickable(s)}
            <input
              type="checkbox"
              class="mt-1"
              checked={s.done}
              disabled={busy}
              aria-label={s.done ? `Undo step ${index + 1}` : `Mark step ${index + 1} done`}
              onchange={() => step(t, index, { op: s.done ? 'untick' : 'tick' })}
            />
          {/if}
          <div class="min-w-0 flex-1">
            <Markdown
              text={stepText(s.text)}
              staff={t.staffId ?? undefined}
              copyCode
              class={s.done ? 'line-through' : ''}
            />
            {#if s.action?.kind === 'aws' && !s.done && AWS_GUIDES[s.action.connector]}
              {@const guide = AWS_GUIDES[s.action.connector]}
              <p class="mt-1 leading-relaxed">
                New to this?
                <a
                  class="text-sea underline hover:text-ink"
                  href={siteLink(guide.path)}
                  target="_blank"
                  rel="noopener">{guide.label}, step by step</a
                >: the role, and where to find each of these.
              </p>
            {/if}
          </div>
          <!-- A chosen mailbox changes only by revoking its grants, so its step has no Undo. -->
          {#if s.done && !tickable(s) && s.action?.kind !== 'postal'}
            <button
              class="ms-auto shrink-0 text-xs text-muted underline hover:text-ink disabled:opacity-40"
              disabled={busy}
              onclick={() => step(t, index, { op: 'untick' })}>Undo</button
            >
          {/if}
        </div>
        {#if s.action?.kind === 'oauth' && !s.done}
          <button
            class="mt-2 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
            disabled={busy}
            onclick={() => hostedSignIn(t, index)}>Sign in</button
          >
          <details class="mt-2 text-xs text-muted">
            <summary class="cursor-pointer">The service won't let me sign in</summary>
            <p class="mt-2">
              If your organization blocks the app, check with the person who manages the account.
              Once they approve it, return here and click Sign in.
            </p>
            {#if s.action.google}
              <p class="mt-2">
                If Google says Oddboro is limited to test users or has reached its user limit, open
                an Odd's chat and choose More, then Report a bug. Include the error message only.
                The report is public.
              </p>
            {/if}
          </details>
        {:else if s.action?.kind === 'postal'}
          {#if s.done}
            {#if s.answer}<p class="mt-1.5 text-xs text-muted">{s.answer}</p>{/if}
          {:else}
            {#key t.id}<PostalMailbox
                taskId={t.id}
                {index}
                odd={who(t.staffId)?.name ?? 'the Odd'}
              />{/key}
          {/if}
        {:else if s.action?.kind === 'aws'}
          {#if s.done}
            {#if s.answer}<p class="mt-1.5 text-xs text-muted">{s.answer}</p>{/if}
          {:else}
            <AwsSignIn taskId={t.id} {index} connector={s.action.connector} />
          {/if}
        {:else if s.action?.kind === 'secret' && !s.done}
          <div class="mt-2 flex gap-2">
            <input
              type="password"
              class="min-w-0 flex-1 rounded-lg bg-night/60 px-2.5 py-1.5 text-xs outline-none"
              placeholder={s.action.name === 'Authorization' ? 'API key' : s.action.name}
              bind:value={secret[index]}
            />
            <button
              class="rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
              disabled={busy || !secret[index]?.trim()}
              onclick={() => saveSecret(t, index)}>Save</button
            >
          </div>
          <AwsSecretPick taskId={t.id} {index} />
        {:else if s.action?.kind === 'secret' && s.answer}
          <p class="mt-1.5 text-xs text-muted">{s.answer}</p>
        {:else if s.action?.kind === 'tools' && !s.done}
          {#if !toolList[index]}
            <button
              class="mt-2 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
              disabled={busy}
              onclick={() => loadTools(t, index)}>{busy ? 'Connecting' : 'Connect'}</button
            >
          {:else}
            {@const list = toolList[index]}
            <p class="mt-2 text-xs text-muted">
              {#if list.some((tool) => tool.readOnly)}
                Read only reaches the tools marked reads only: the ones the service says only read,
                less any whose name says it changes something. Read and write reaches every tool.
              {:else if list.length}
                None of these tools only read, so a Read only grant reaches none of them. Read and
                write reaches every tool. To share a saved result instead,
                <a
                  class="text-sea underline"
                  href={siteLink('/info/folder-sharing/')}
                  target="_blank"
                  rel="noreferrer">give the Odd a folder it can read</a
                >.
              {:else}
                The service returned no tools. Check the account and its access, then reconnect.
              {/if}
            </p>
            <ul class="mt-1.5 flex max-h-48 flex-col gap-1 overflow-y-auto">
              {#each list as tool (tool.name)}
                <li class="text-xs">
                  <code class="text-sea">{tool.name}</code>
                  {#if tool.readOnly}<span class="text-moss"> reads only</span>{:else}<span
                      class="text-faint"
                    >
                      Read and write only</span
                    >{/if}
                  <span class="block text-faint">{tool.description.slice(0, 120)}</span>
                </li>
              {/each}
            </ul>
            <button
              class="mt-2 rounded-lg bg-sea px-3 py-1.5 text-xs font-medium text-night disabled:opacity-40"
              disabled={busy}
              onclick={() => step(t, index, { op: 'confirm-tools' })}>Confirm</button
            >
          {/if}
        {:else if s.action?.kind === 'choice'}
          {#if s.answer}
            <div class="mt-1.5 text-xs text-sea">You chose: {s.answer}</div>
          {:else}
            <div class="mt-2 flex flex-col gap-1.5" role="group" aria-label="Choices">
              {#each s.action.options as option (option)}
                <button
                  class="choice"
                  disabled={busy}
                  onclick={() => step(t, index, { op: 'choose', answer: option })}>{option}</button
                >
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </li>
  {/each}
</ol>
{#key open.key}
  {#if t.staffId && !t.askId}
    <TaskResponse
      task={t}
      odd={who(t.staffId)?.name}
      files={attached('task', t.id)}
      open={!!how && !how.choice}
    />
  {/if}
  <Attachments
    items={attached('task', t.id)}
    reference={response.response !== null}
    start="edit"
    ondirty={(d) => (unsaved = d)}
  />
{/key}
<label class="mt-4 block text-xs text-muted" for="note">Note (optional)</label>
<textarea
  id="note"
  rows="2"
  class="mt-1 w-full resize-none rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint"
  placeholder="Anything your Odds should know"
  bind:value={note}></textarea>
<!-- A connect-only ask's task starts no work of its own: the proposal it serves does. -->
{#if from && !desk.connectOnly.includes(t.id)}
  <p class="mt-2 text-[11px] text-faint">
    {from.name} picks up from here as soon as you mark it done.
  </p>
{/if}
<div class="mt-3 flex gap-2">
  <button
    class="rounded-lg bg-raise px-3 py-2 text-sm text-muted hover:text-ink disabled:opacity-40"
    disabled={busy || unsaved}
    onclick={() => finish(t, false)}>Drop it</button
  >
  <button
    class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
    disabled={busy || unsaved || blockedResponse || toGo > 0}
    onclick={() => finish(t, true)}
    >{unsaved
      ? 'Save the attached file first'
      : toGo
        ? `${toGo} ${toGo === 1 ? 'step' : 'steps'} to go`
        : needsSave
          ? 'Save and finish'
          : 'Mark done'}</button
  >
</div>
