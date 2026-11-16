<script lang="ts">
  import type { AskRow, Desk, LedgerRow } from '@oddboro/ledger';
  import Markdown from './Markdown.svelte';
  import Attachments from './Attachments.svelte';
  import FolderAsk from './FolderAsk.svelte';
  import FolderWarning from './FolderWarning.svelte';
  import GoalProposal from './GoalProposal.svelte';
  import { when } from './format.ts';
  import { openFile } from './windows.svelte.ts';
  import { OFFICE_TOOLS, yesOrNo } from '@oddboro/ledger/tools';
  import { describe } from '@oddboro/ledger/time';
  import type { DeskItem } from '@oddboro/ledger/desk-answers';
  import { LEVEL_LABEL, type FolderAccess } from '@oddboro/ledger/access';
  import type { StaffProfile } from '../staff/roster.ts';
  import { yesSaid } from './yes-said.ts';

  // An open ask on the Desk: what it asks, past decisions like it, the reason
  // box and its answer buttons. The drawer keeps the state, which this writes
  // through its bindings, and the actions.

  type Props = {
    open: { key: string; row: AskRow };
    staff: StaffProfile[];
    /** The ask this one reworks, when the owner sent that one back. */
    reworks: AskRow | null;
    precedent: LedgerRow[];
    busy: boolean;
    who: (id: string | null) => StaffProfile | undefined;
    attached: (kind: Exclude<DeskItem, 'report'>, id: number) => Desk['attachments'];
    decide: (a: AskRow, decision: 'approve' | 'deny' | 'iterate') => Promise<void>;
    makeCall: (a: AskRow) => Promise<void>;
    giveFolder: (a: AskRow, accept?: boolean) => Promise<void>;
    /** Approving a proposed hire opens the hire window with it. */
    onhire: (a: AskRow) => void;
    skip: Record<number, boolean>;
    folderPath: string;
    folderLevel: FolderAccess;
    changing: boolean;
    folderWarning: string;
    unsaved: boolean;
    reason: string;
    reportWhenDone: boolean;
  };
  let {
    open,
    staff,
    reworks,
    precedent,
    busy,
    who,
    attached,
    decide,
    makeCall,
    giveFolder,
    onhire,
    skip = $bindable(),
    folderPath = $bindable(),
    folderLevel = $bindable(),
    changing = $bindable(),
    folderWarning = $bindable(),
    unsaved = $bindable(),
    reason = $bindable(),
    reportWhenDone = $bindable()
  }: Props = $props();

  const a = $derived(open.row);
  /** A held call's inputs, as the tool takes them, for the owner to read. */
  const inputs = (args: Record<string, unknown>) => JSON.stringify(args, null, 2);
  const picked = (a: AskRow) => a.plan?.items.filter((_, i) => !skip[i]).length ?? 0;
  const toolName = (id: string) => OFFICE_TOOLS.find((t) => t.id === id)?.name ?? id;
</script>

<dl class="mt-3 flex flex-col gap-3 text-sm">
  {#if reworks}
    <div class="rounded-lg bg-sea/10 px-2.5 py-2 text-xs">
      <div class="text-muted">Reworks “{reworks.title}”</div>
      {#if reworks.reason}<div class="mt-0.5">You asked: {reworks.reason}</div>{/if}
    </div>
  {/if}
  <div>
    <dt class="text-xs text-muted">Why</dt>
    <dd class="mt-0.5"><Markdown text={a.why} staff={a.staffId} /></dd>
  </div>
  {#if a.hire}
    {@const h = a.hire}
    <div>
      <dt class="text-xs text-muted">The hire</dt>
      <dd class="mt-1 flex flex-col gap-1 rounded-lg bg-raise px-2.5 py-2 text-xs">
        <div><span class="text-muted">Who:</span> {h.name}, {h.role}</div>
        <div><span class="text-muted">For:</span> {h.remit}</div>
        <div><span class="text-muted">Permission:</span> {LEVEL_LABEL[h.permission]}</div>
        {#if h.room}<div><span class="text-muted">Room:</span> {h.room}</div>{/if}
        {#if h.tools?.length}
          <div>
            <span class="text-muted">Office tools:</span>
            {h.tools.map(toolName).join(', ')}
          </div>
        {/if}
        {#if h.job}
          <div>
            <span class="text-muted">First job:</span>
            {h.job.name}, {describe(h.job.schedule)}
          </div>
        {/if}
        <div>
          <span class="text-muted">Job description:</span>
          <button
            class="text-sea underline underline-offset-2"
            onclick={() => openFile({ staff: a.staffId, path: h.jobDescriptionFile })}
            >{h.jobDescriptionFile}</button
          >
        </div>
      </dd>
    </div>
  {:else if a.goal || a.plan}
    <GoalProposal {a} {staff} {skip} onskip={(i, skipped) => (skip[i] = skipped)} />
  {:else if a.call}
    {@const c = a.call}
    {#snippet exact()}
      <dd class="mt-1 flex flex-col gap-1 rounded-lg bg-raise px-2.5 py-2 text-xs">
        <div><span class="text-muted">Tool:</span> {c.tool}</div>
        <div class="text-muted">Inputs:</div>
        <pre
          class="max-h-72 overflow-auto rounded-md bg-night/50 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">{inputs(
            c.arguments
          )}</pre>
      </dd>
    {/snippet}
    <div>
      {#if c.said && c.shown?.length}
        <!-- What it does in words, and each email it does it to, as Gmail showed them when it was held. -->
        <dt class="text-xs text-muted">{c.said}</dt>
        <dd class="mt-1 rounded-lg bg-raise px-2.5 py-2 text-xs">
          <ul class="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {#each c.shown as item, n (n)}
              <li class="break-words">{item}</li>
            {/each}
          </ul>
        </dd>
        <details class="mt-2">
          <summary class="cursor-pointer text-xs text-muted hover:text-ink"
            >The call, exactly as the office makes it</summary
          >
          {@render exact()}
        </details>
      {:else}
        <dt class="text-xs text-muted">The call, exactly as the office makes it</dt>
        {@render exact()}
      {/if}
      {#if c.before?.length}
        <!-- What this call may apply: the run's calls to the same service its standing yes let through. -->
        <details class="mt-2" open>
          <summary class="cursor-pointer text-xs text-muted hover:text-ink"
            >Made without asking before this call ({c.before.length})</summary
          >
          <ul class="mt-1 flex flex-col gap-1">
            {#each c.before as b, n (n)}
              <li class="rounded-lg bg-raise px-2.5 py-2 text-xs">
                <div><span class="text-muted">Tool:</span> {b.tool}</div>
                <pre
                  class="mt-1 max-h-48 overflow-auto rounded-md bg-night/50 px-2 py-1.5 font-mono text-[11px] whitespace-pre-wrap">{inputs(
                    b.arguments
                  )}</pre>
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      <p class="mt-1.5 text-[11px] text-faint">
        Nothing has changed yet. Approve, and the office makes this call once, then {who(a.staffId)
          ?.name ?? 'the Odd'} carries on with what it returns.
      </p>
    </div>
  {:else if a.folder}
    <FolderAsk
      name={who(a.staffId)?.name ?? 'the Odd'}
      bind:path={folderPath}
      bind:level={folderLevel}
      bind:changing
    />
    {#if folderWarning}
      <FolderWarning
        folder={folderPath}
        warning={folderWarning}
        {busy}
        onaccept={() => giveFolder(a, true)}
        oncancel={() => (folderWarning = '')}
      />
    {/if}
  {:else}
    <div>
      <dt class="text-xs text-muted">If you approve</dt>
      <dd class="mt-0.5"><Markdown text={a.ifApproved} staff={a.staffId} /></dd>
    </div>
  {/if}
  {#if precedent.length}
    <div>
      <dt class="text-xs text-muted">Like this before</dt>
      <dd class="mt-1 flex flex-col gap-1">
        {#each precedent as p (p.id)}
          <div class="rounded-lg bg-raise px-2.5 py-1.5 text-xs">
            <div>{p.title}</div>
            <div class="mt-0.5 text-faint">
              {when(p.createdAt)} · {p.reason ? `Your reason: ${p.reason}` : 'No reason given'}
            </div>
          </div>
        {/each}
      </dd>
    </div>
  {/if}
</dl>
{#key open.key}
  <Attachments items={attached('ask', a.id)} ondirty={(d) => (unsaved = d)} />
{/key}
<label class="mt-4 block text-xs text-muted" for="reason"
  >{yesOrNo(a.kind) ? 'Reason' : 'Reason, or what to change'}</label
>
<textarea
  id="reason"
  rows="3"
  class="mt-1 w-full resize-y rounded-lg bg-raise px-3 py-2 text-sm outline-none placeholder:text-faint"
  placeholder={yesOrNo(a.kind)
    ? 'Optional to approve or deny.'
    : 'Optional to approve or deny. Needed to iterate: say what to change.'}
  bind:value={reason}></textarea>
{#if a.kind === 'approval'}
  <label class="mt-2 flex items-center gap-2 text-xs text-muted">
    <input type="checkbox" bind:checked={reportWhenDone} /> Report when done
  </label>
  <p class="mt-1 text-[11px] text-faint">
    {who(a.staffId)?.name ?? 'The Odd'} starts as soon as you approve. You hear back if it fails or needs
    you{reportWhenDone ? ', and when it is done' : ''}.
  </p>
{/if}
<div class="mt-3 flex gap-2">
  <button
    class="flex-1 rounded-lg bg-raise px-3 py-2 text-sm font-medium hover:bg-coral/25 disabled:opacity-40"
    disabled={busy || unsaved}
    onclick={() => decide(a, 'deny')}>{a.kind === 'window' ? 'Pause it' : 'Deny'}</button
  >
  {#if !yesOrNo(a.kind)}
    <button
      class="flex-1 rounded-lg bg-raise px-3 py-2 text-sm font-medium hover:bg-sea/25 disabled:opacity-40"
      disabled={busy || unsaved || !reason.trim()}
      title={reason.trim() ? '' : 'Say what to change in the box above first'}
      onclick={() => decide(a, 'iterate')}>{a.folder ? 'Send back' : 'Iterate'}</button
    >
  {/if}
  {#if a.folder}
    {#if !changing}
      <button
        class="flex-1 rounded-lg bg-raise px-3 py-2 text-sm font-medium hover:bg-sea/25 disabled:opacity-40"
        disabled={busy || unsaved}
        onclick={() => (changing = true)}>Change</button
      >
    {/if}
    <button
      class="flex-[1.4] rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
      disabled={busy || unsaved || !folderPath.trim() || !!folderWarning}
      onclick={() => giveFolder(a)}>Give access</button
    >
  {:else if a.kind === 'hire'}
    <button
      class="flex-[1.4] rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
      disabled={busy || unsaved}
      onclick={() => onhire(a)}>Open hire window</button
    >
  {:else}
    <button
      class="flex-1 rounded-lg bg-sea px-3 py-2 text-sm font-medium text-night disabled:opacity-40"
      disabled={busy || unsaved || (a.kind === 'plan' && !picked(a))}
      onclick={() => (a.kind === 'call' ? makeCall(a) : decide(a, 'approve'))}
      >{yesSaid(a, { picked: picked(a), busy })}</button
    >
  {/if}
</div>
{#if a.access}
  <p class="mt-1.5 text-[11px] text-faint">
    Connect gives {who(a.staffId)?.name ?? 'the Odd'} access. Any steps to connect it open right here.
  </p>
{/if}
{#if a.folder}
  <p class="mt-1.5 text-[11px] text-faint">
    Give access gives {who(a.staffId)?.name ?? 'the Odd'} this folder, and it starts on the work that
    waited for it. Change lets you pick a smaller folder or Can read first.
  </p>
{/if}
{#if !yesOrNo(a.kind)}
  <p class="mt-1.5 text-[11px] text-faint">
    {a.folder ? 'Send back' : 'Iterate'} sends it back to {who(a.staffId)?.name ?? 'the Odd'} with your
    words, and the new version comes back to your desk.
  </p>
{/if}
