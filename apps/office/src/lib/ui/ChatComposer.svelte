<script lang="ts">
  import { tick } from 'svelte';
  import ChatGoal from './ChatGoal.svelte';
  import ChatFiles from './ChatFiles.svelte';
  import { approveWord } from './chat-approval.ts';
  import { advanced, openProject } from './windows.svelte.ts';
  import { tagFor, withTokens, type Pending } from './chat-attach.ts';
  import { ACCEPT, attachableType, FILES_MAX, isPicture, refusal } from '#lib/attachments.ts';
  import { KIND } from './chat-threads.ts';
  import type { BoxFocus, ChatSession } from './chat-session.svelte.ts';
  import type { StaffProfile } from '../staff/roster.ts';

  // The message box under the chat: what it replies about, the bar that drags
  // it taller, the files going with it, the plus menu and Send. What it writes
  // goes into the chat's session; only its own size, menu and drag state is here.

  type Props = {
    session: ChatSession;
    profile: StaffProfile;
    /** False while another tab covers the chat, when the box has no height to fit. */
    visible: boolean;
    /** The chat's whole panel, whose height caps the box. */
    root: HTMLDivElement | undefined;
    /** The chat's list, kept at its newest line when the box changes height. */
    list: HTMLDivElement | undefined;
    /** Opens Report a bug from the plus menu. */
    onbug: () => void;
  };

  let { session, profile, visible, root, list, onbug }: Props = $props();

  /** Focuses the box, for the session through the panel's view. */
  export function focus(how: BoxFocus) {
    if (how !== 'only') fit();
    box?.focus();
    if (how === 'end') box?.setSelectionRange(session.draft.length, session.draft.length);
  }

  // The input grows with what the owner types, up to most of the panel. Dragging
  // the bar above it sets how tall it is at least, and that height is kept.
  // As tall as the plus button over Send beside it (32 + 6 + 38).
  const MIN_INPUT = 76;
  let box: HTMLTextAreaElement | undefined = $state();
  let floor = $state(MIN_INPUT);
  try {
    floor = Math.max(MIN_INPUT, Number(localStorage.getItem('oddboro.chat.input')) || MIN_INPUT);
  } catch {
    // No storage: start at one line.
  }
  const ceiling = () => Math.max(MIN_INPUT, (root?.clientHeight ?? 600) * 0.6);

  function fit() {
    if (!box) return;
    // Measured first: the brief auto height below scrolls the list on its own.
    const pinned = list ? list.scrollHeight - list.scrollTop - list.clientHeight < 8 : false;
    box.style.blockSize = 'auto';
    // At least as tall as the column beside it: the files, the plus button and Send.
    box.style.blockSize = `${Math.min(ceiling(), Math.max(floor, side, box.scrollHeight))}px`;
    if (pinned && list) list.scrollTop = list.scrollHeight;
  }
  /** The height of the column at the box's end side, which grows as files are attached. */
  let side = $state(0);
  $effect(() => {
    void session.draft;
    void floor;
    void visible;
    void side;
    fit();
  });

  let pull: { y: number; h: number } | undefined;
  function grab(e: PointerEvent) {
    pull = { y: e.clientY, h: box?.offsetHeight ?? floor };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function drag(e: PointerEvent) {
    // The input sits at the bottom, so pulling the bar up makes it taller.
    if (pull)
      floor = Math.round(Math.min(ceiling(), Math.max(MIN_INPUT, pull.h + pull.y - e.clientY)));
  }
  function release() {
    if (!pull) return;
    pull = undefined;
    keep();
  }
  function nudge(e: KeyboardEvent) {
    const step = e.key === 'ArrowUp' ? 24 : e.key === 'ArrowDown' ? -24 : 0;
    if (!step) return;
    e.preventDefault();
    floor = Math.min(ceiling(), Math.max(MIN_INPUT, floor + step));
    keep();
  }
  function keep() {
    try {
      localStorage.setItem('oddboro.chat.input', String(floor));
    } catch {
      // Private window: the height lasts this visit only.
    }
  }

  let dragging = $state(false);
  let picker: HTMLInputElement | undefined = $state();

  // The plus menu beside the box: one list of what the owner can add, each
  // shown where it applies. A new action is one more item here.
  let goalOpen = $state(false);
  let goal: ChatGoal | undefined = $state();
  /** `focuses`: the item puts the caret somewhere itself, so focus does not go back to the message box. */
  type MoreItem = { label: string; shown: () => boolean; run: () => void; focuses?: boolean };
  const MORE: MoreItem[] = [
    { label: 'Attach files', shown: () => true, run: () => picker?.click() },
    {
      label: 'Project sessions',
      shown: () => advanced.on,
      focuses: true,
      run: () => openProject()
    },
    {
      label: 'New goal',
      shown: () => session.canSetGoal,
      focuses: true,
      run: async () => {
        goalOpen = true;
        await tick();
        goal?.focus();
      }
    },
    // The form takes the focus; a failed reply's error starts its details.
    {
      label: 'Report a bug',
      shown: () => true,
      focuses: true,
      run: () => onbug()
    }
  ];
  const more = $derived(MORE.filter((m) => m.shown()));
  let moreOpen = $state(false);
  let moreButton: HTMLButtonElement | undefined = $state();
  let moreMenu: HTMLDivElement | undefined = $state();
  const moreItems = () => [...(moreMenu?.querySelectorAll<HTMLButtonElement>('button') ?? [])];

  async function openMore() {
    moreOpen = true;
    await tick();
    moreItems()[0]?.focus();
  }
  function closeMore(focus?: HTMLElement) {
    moreOpen = false;
    focus?.focus();
  }
  function pickMore(m: MoreItem) {
    closeMore(m.focuses ? undefined : box);
    m.run();
  }
  /** Arrow keys move between the items, Escape closes; Enter picks the focused one as a button does. */
  function moreKey(e: KeyboardEvent) {
    const items = moreItems();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') closeMore(moreButton);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') items[0]?.focus();
    else if (e.key === 'End') items.at(-1)?.focus();
    else return;
    e.preventDefault();
  }
  /** A click outside the menu and its button closes it. */
  function outside(e: PointerEvent) {
    const at = e.target as Node;
    if (moreOpen && !moreMenu?.contains(at) && !moreButton?.contains(at)) closeMore();
  }
  // The menu goes with the box: it closes while the box is disabled.
  $effect(() => {
    if (session.saving) moreOpen = false;
  });
  // The goal field closes where New goal does not show, as it did when it went away.
  $effect(() => {
    if (!session.canSetGoal) goalOpen = false;
  });

  function attach(files: File[], how: 'paste' | 'drop' | 'pick') {
    const taken = [
      ...session.pending.map((p) => p.tag),
      ...(session.waiting?.files.map((f) => f.tag) ?? [])
    ];
    const added: Pending[] = [];
    session.refused = '';
    for (const file of files) {
      const why = refusal(file.name, file.type, file.size);
      if (why) {
        session.refused = why;
        continue;
      }
      if (session.pending.length + added.length >= FILES_MAX) {
        session.refused = `Attach up to ${FILES_MAX} files at a time.`;
        break;
      }
      const mediaType = attachableType(file.name, file.type)!;
      added.push({
        key: session.nextKey++,
        tag: tagFor(file, how === 'paste', [...taken, ...added.map((a) => a.tag)]),
        mediaType,
        size: file.size,
        file,
        url: isPicture(mediaType) ? URL.createObjectURL(file) : undefined,
        inline: how !== 'pick'
      });
    }
    if (!added.length) return;
    session.pending = [...session.pending, ...added];
    const inline = added.filter((a) => a.inline).map((a) => a.tag);
    if (inline.length && box) {
      const put = withTokens(session.draft, box.selectionStart, box.selectionEnd, inline);
      session.draft = put.text;
      void tick().then(() => {
        box?.focus();
        box?.setSelectionRange(put.caret, put.caret);
      });
    }
  }

  function onpaste(e: ClipboardEvent) {
    const data = e.clipboardData;
    const files = [...(data?.files ?? [])];
    // Copied cells or text often bring a picture of themselves: the text wins.
    if (!files.length || data?.getData('text/plain')) return;
    e.preventDefault();
    attach(files, 'paste');
  }
  const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  function ondragover(e: DragEvent) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }
  function ondragleave(e: DragEvent) {
    const into = e.relatedTarget as Node | null;
    if (!into || !(e.currentTarget as HTMLElement).contains(into)) dragging = false;
  }
  function ondrop(e: DragEvent) {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    dragging = false;
    attach([...(e.dataTransfer?.files ?? [])], 'drop');
  }
  function picked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    attach([...(input.files ?? [])], 'pick');
    // The same file can be picked again after it is removed.
    input.value = '';
  }

  async function send(e: SubmitEvent) {
    e.preventDefault();
    await session.submit(false);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    // Ctrl+Enter on every system, as in Claude Code: queue the box and add it to the running reply.
    if (
      e.ctrlKey &&
      (session.sending || session.remoteBusy) &&
      session.active &&
      session.addsToReply
    )
      void session.submit(true);
    else (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions: a focusable separator is the ARIA pattern for a keyboard-resizable pane. -->
<div
  class="grip"
  role="separator"
  aria-orientation="horizontal"
  aria-label="Resize the message box"
  aria-valuenow={floor}
  tabindex="0"
  onpointerdown={grab}
  onpointermove={drag}
  onpointerup={release}
  onpointercancel={release}
  onkeydown={nudge}
></div>
{#if session.decisionMode && !session.replyTo && session.approveTo && session.approveTo.id === session.onlyProposal?.id && approveWord(session.draft)}
  <p class="px-3 pb-1 text-xs text-muted">Approving “{session.approveTo.title}”</p>
{/if}
{#if session.replyTo}
  <div class="flex items-center gap-2 px-3 pb-1.5 text-xs text-muted">
    <span class="min-w-0 flex-1 truncate"
      >{session.intent === 'change' ? 'Asking for changes to' : 'Replying about'}
      {KIND[session.replyTo.kind].toLowerCase()} “{session.replyTo.title}”</span
    >
    <button
      class="shrink-0 px-1 text-faint hover:text-coral"
      aria-label="Stop replying"
      disabled={session.saving}
      onclick={() => {
        session.replyTo = undefined;
        session.intent = 'reply';
        session.refused = '';
      }}>✕</button
    >
  </div>
{/if}
{#if session.about}
  <div class="flex gap-2 px-3 pb-1.5 text-xs text-muted">
    <span>To {session.about.lead} about {session.about.kind}: {session.about.title}</span>
    <button aria-label="Clear work selection" onclick={() => (session.about = undefined)}>✕</button>
  </div>
{/if}
{#if session.canSetGoal}
  <ChatGoal
    bind:this={goal}
    managerId={profile.id}
    onset={() => session.load(profile.id)}
    bind:open={goalOpen}
  />
{/if}
<form
  class="flex items-end gap-2 px-3 {session.refused ? 'pb-2' : 'pb-3'}"
  novalidate
  onsubmit={send}
  {ondragover}
  {ondragleave}
  {ondrop}
>
  <input bind:this={picker} type="file" multiple accept={ACCEPT} class="hidden" onchange={picked} />
  <textarea
    bind:this={box}
    class="min-h-[76px] flex-1 resize-none overflow-y-auto rounded-lg bg-raise px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-faint {dragging
      ? 'ring-1 ring-sea'
      : ''}"
    rows="1"
    placeholder={dragging
      ? 'Drop to attach'
      : session.replyTo
        ? `Reply to ${profile.name}`
        : `Message ${profile.name}`}
    oninput={(e) =>
      session.typed(
        session.decisionMode &&
          e instanceof InputEvent &&
          e.isTrusted &&
          e.inputType !== 'insertFromPaste' &&
          e.inputType !== 'insertFromDrop'
          ? e.currentTarget.value
          : ''
      )}
    disabled={session.saving}
    bind:value={session.draft}
    {onkeydown}
    {onpaste}></textarea>
  <div class="flex shrink-0 flex-col gap-1.5" bind:clientHeight={side}>
    {#if session.pending.length}
      <!-- What goes with the message, over the plus button: three files tall at most, scrolling past that. -->
      <div
        class="tray -me-3 flex justify-center overflow-y-auto overscroll-contain ps-1.5 pe-1.5 pt-1.5"
        aria-label="Attached files"
      >
        <ChatFiles stack files={session.pending} onremove={(key) => session.remove(key)} />
      </div>
    {/if}
    <div class="relative flex flex-col">
      {#if moreOpen}
        <div
          bind:this={moreMenu}
          class="absolute end-0 bottom-full z-20 mb-1 flex min-w-36 flex-col rounded-lg border border-hairline bg-panel-solid py-1"
          role="menu"
          aria-label="More"
          tabindex="-1"
          onkeydown={moreKey}
        >
          {#each more as m (m.label)}
            <button
              type="button"
              role="menuitem"
              tabindex="-1"
              class="px-3 py-1.5 text-start text-sm whitespace-nowrap text-ink outline-none hover:bg-sea/15 focus:bg-sea/15"
              onclick={() => pickMore(m)}>{m.label}</button
            >
          {/each}
        </div>
      {/if}
      <button
        bind:this={moreButton}
        type="button"
        class="flex h-8 items-center justify-center rounded-lg text-muted hover:bg-raise hover:text-ink disabled:opacity-40"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        title="Attach files and more"
        disabled={session.saving}
        onclick={() => (moreOpen ? closeMore() : openMore())}
      >
        <!-- A plus: one stroke down, one across. -->
        <svg
          class="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"><path d="M8 3v10" /><path d="M3 8h10" /></svg
        >
      </button>
    </div>
    <button
      class="flex h-[38px] items-center justify-center gap-1.5 rounded-lg bg-sea px-3 text-sm font-medium text-night disabled:opacity-40"
      disabled={session.saving ||
        (!session.draft.trim() && !session.pending.length) ||
        session.uploading}
    >
      <!-- A paper plane: its wings, and the fold down its middle. -->
      <svg
        class="size-4 shrink-0"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        ><path d="M14.5 1.5 1.5 6.6l5.2 2.2 2.2 5.7z" /><path d="M14.5 1.5 6.7 8.8" /><path
          d="m6.7 8.8.2 3.7 2-1.9"
        /></svg
      >{session.uploading
        ? 'Attaching'
        : session.decisionMode && session.intent === 'change'
          ? 'Send changes'
          : 'Send'}
    </button>
  </div>
</form>
{#if session.refused}
  <p class="px-3 pb-3 text-xs text-coral" role="alert">{session.refused}</p>
{/if}

<svelte:window onpointerdown={outside} />

<style>
  /* Three attached files at most (each 48px square, 2px and a 15px name under
     it, 8px apart, 6px over the first for its ✕); the rest scroll. */
  .tray {
    max-block-size: calc(3 * 65px + 2 * 8px + 6px);
  }
  .grip {
    position: relative;
    block-size: 12px;
    border-block-start: 1px solid var(--color-hairline);
    cursor: row-resize;
    touch-action: none;
  }
  .grip::after {
    content: '';
    position: absolute;
    inset-block-start: 4px;
    inset-inline: calc(50% - 16px);
    block-size: 3px;
    border-radius: 3px;
    background: var(--color-hairline);
  }
  .grip:hover::after,
  .grip:focus-visible::after {
    background: var(--color-muted);
  }
  .grip:focus-visible {
    outline: none;
  }
</style>
