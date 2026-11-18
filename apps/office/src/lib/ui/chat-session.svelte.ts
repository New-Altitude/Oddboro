// One Odd's conversation in its chat: the lines, what the owner is writing and
// what about, the files going with it, a message waiting on the reply, and the
// actions that load, send, stop and decide. ChatPanel makes one as it starts,
// so the effects here are the panel's and stop with it. It never reads an
// element: the panel's view focuses the message box and scrolls the list.
import { onMount, tick, untrack } from 'svelte';
import type { AskRow, PokeRow } from '@oddboro/ledger';
import { FIRST_QUESTIONS, firstQuestionIn } from '@oddboro/ledger/first-questions';
import { current, drafts, saved, type SavedResponse } from './task-response.svelte.ts';
import { cardText } from './task-card.ts';
import { approvalTarget, approveWord, yesWord } from './chat-approval.ts';
import { chatAnswer } from './task-steps.ts';
import { newTurnId } from '#lib/staff/chat-input.ts';
import { call, sendFile, failure, type ApiUrl } from './api.ts';
import { hasToken, withoutToken, type Pending } from './chat-attach.ts';
import { isPicture, type ChatFile } from '#lib/attachments.ts';
import { chatRequest, takeDraft, type Delivered } from './chat-about.svelte.ts';
import { KIND, keyOf, type Line } from './chat-threads.ts';
import type { StaffProfile } from '../staff/roster.ts';
import type { ReaderProps } from '../staff/odd-now.ts';
import { toolWords, type WorkAbout } from '../staff/work.ts';
import type { ChatEntry, ChatEvent, ChatSignIn } from '../staff/chat.ts';
import { serviceNames } from './service-names.svelte.ts';

/**
 * ChatPanel's props the session reads. The panel passes each as a getter, so
 * every read is live and an effect tracks only the props it reads.
 */
export type SessionProps = Pick<ReaderProps, 'desk' | 'onplan'> & {
  profile: StaffProfile;
  /** Bumps when the office changes, e.g. a poke lands or is set. */
  version: number;
  /** Fires when a message goes out, so the floor can send the staffer to the owner's office. */
  onstart: () => void;
  /** Fires when the reply is complete or fails. */
  onend: () => void;
  /** False while another tab covers the chat. It stays mounted either way. */
  visible: boolean;
  /** Opens something the staffer delivered, on the start side. */
  onitem: (item: Delivered) => void;
};

/** How the message box takes the focus: as it is, fitted to its text, or fitted with the caret at the end. */
export type BoxFocus = 'only' | 'fit' | 'end';

/** What the panel does with its elements when the session asks. */
export type ChatView = { focus: (how: BoxFocus) => void; scrollDown: () => void };

type Intent = 'reply' | 'proposal' | 'change';
// The office already holds the text, files and reply target under this turn id.
type Blocked = { turnId: string; signIn: ChatSignIn };
/**
 * What the owner sent while a reply was still coming: it goes once that
 * reply ends. A second Send while one waits joins it, so the Odd answers
 * both in one turn.
 */
type Waiting = { text: string; re?: Delivered; files: ChatFile[]; about?: WorkAbout };

/** Let go of a picture's preview made on this page. */
function unpreview(p: Pending) {
  if (p.url && p.file) URL.revokeObjectURL(p.url);
}

export class ChatSession {
  #props: SessionProps;
  #view: ChatView;

  // A field that reads `#props` derives in a closure: fields are set before the
  // constructor gives the session its props.
  /** The delivery selected here, e.g. opened on the desk. */
  selected = $derived.by(() =>
    chatRequest.focus?.staff === this.#props.profile.id ? keyOf(chatRequest.focus.item) : undefined
  );
  /** The delivery the next message replies about. */
  replyTo = $state<Delivered | undefined>();

  intent = $state<Intent>('reply');
  saving = $state(false);
  // Two plans can wait in the same chat. Each keeps its own checkboxes.
  skipped = $state<Record<number, Record<number, boolean>>>({});
  picks = (a: AskRow) => a.plan?.items.map((_, i) => i).filter((i) => !this.skipped[a.id]?.[i]);
  proposal = (d: Delivered) =>
    d.kind === 'ask' &&
    this.#props.desk.asks.find(
      (a) =>
        a.staffId === this.#props.profile.id &&
        a.id === d.id &&
        ((a.kind === 'goal' && a.goal) || (a.kind === 'plan' && a.plan))
    );
  /**
   * An open task of this Odd's the owner answers here with one response, and
   * how (`chatAnswer`): a tap on its choice, or its response editor.
   */
  question = (d: Delivered) => {
    if (d.kind !== 'task') return undefined;
    const t = this.#props.desk.tasks.find(
      (t) => t.staffId === this.#props.profile.id && t.id === d.id
    );
    if (!t) return undefined;
    const files = this.#props.desk.attachments.filter((f) => f.taskId === t.id);
    const how = chatAnswer({ ...t, response: current(t).response }, files.length > 0);
    return how && { ...how, why: t.why, task: t, files };
  };
  /** A finished task's saved response, read when the owner opens it on its card. */
  unread = $state<Record<number, string>>({});

  lines = $state<Line[]>([]);
  waitingAsks = $derived(
    this.lines.flatMap(({ item }) => (item?.kind === 'ask' && item.status === 'open' ? [item] : []))
  );
  onlyProposal = $derived(
    this.waitingAsks.length === 1 && this.proposal(this.waitingAsks[0])
      ? this.waitingAsks[0]
      : undefined
  );
  // Remember what was on screen when the owner typed. A replacement arriving
  // before Send, a prefilled draft or a line replayed from history is no yes.
  writtenDecision = $state('');
  approveTo = $state<Delivered>();
  draft = $state('');
  sending = $state(false);
  blocked = $state<Blocked>();
  #signInKey = () => `oddboro-chat-sign-in-${this.#props.profile.id}`;
  remoteBusy = $state(false);
  active = $state<{ runId: string; turnId: string }>();
  stopping = $state(false);
  adding = $state(false);
  about = $state<WorkAbout>();
  #newest = 0;
  waiting = $state<Waiting | undefined>();
  /**
   * Send now adds a waiting message to the reply that is running, in the same
   * turn. Only Claude Code reads more words while it works; Codex, Grok and
   * Gemini read their message once, and a persona hears only the first. A
   * message about a desk item or a job goes as its own message, with its brief.
   */
  addsToReply = $derived.by(
    () => this.#props.profile.agent === 'claude' && !this.#props.profile.persona
  );
  offersNow = (w: Waiting) => this.addsToReply && !!this.active && !w.re && !w.about;
  status = $state('');
  loaded = $state(false);

  /** Whether Open on Desk has somewhere to go: an ask or task still waiting there, or any report. */
  opens = (d: Delivered) =>
    d.kind === 'report' ||
    (d.kind === 'ask' ? this.#props.desk.asks : this.#props.desk.tasks).some((r) => r.id === d.id);

  /** Pokes the staffer set that have not landed yet. */
  upcoming = $state<PokeRow[]>([]);
  #seen = 0;

  /**
   * The answers to tap under the manager's first questions (`FIRST_QUESTIONS`):
   * only while the question is the chat's last line. Typing an answer works too.
   */
  answers = $derived.by((): { list: readonly string[]; first: boolean } => {
    const last = this.lines.at(-1);
    if (
      this.saving ||
      this.remoteBusy ||
      this.sending ||
      !last ||
      last.from !== 'staff' ||
      last.pending ||
      last.failed
    )
      return { list: [], first: false };
    // Choices the Odd ended its reply with (`splitChoices`), else the manager's first questions.
    if (last.choices?.length) return { list: last.choices, first: false };
    return { list: FIRST_QUESTIONS[firstQuestionIn(last.text)]?.answers ?? [], first: true };
  });

  // Files the owner attaches. Pasting or dropping puts each one's tag, like
  // [Image #1], at the caret; Attach files in the plus menu adds them to the
  // tray alone. The tray over the plus button shows everything that will go.
  pending = $state<Pending[]>([]);
  nextKey = 0;
  uploading = $state(false);
  decisionMode = $derived(
    !this.pending.length &&
      !this.about &&
      !this.active &&
      !this.sending &&
      !this.remoteBusy &&
      !this.uploading &&
      !this.stopping
  );

  /** Why the last file was turned away, under the tray. */
  refused = $state('');
  canSetGoal = $derived.by(
    () => this.#props.profile.role === 'Office Manager' && !this.replyTo && this.decisionMode
  );

  attachmentUrl = (f: ChatFile) =>
    `/api/staff/${this.#props.profile.id}/attachments/${encodeURIComponent(f.name)}`;

  /** Made while ChatPanel starts, so its effects belong to the panel. */
  constructor(props: SessionProps, view: ChatView) {
    this.#props = props;
    this.#view = view;

    // Reply on the desk or a report window arrives here once the chat shows.
    $effect(() => {
      const r = chatRequest.reply;
      if (r?.staff !== this.#props.profile.id || !this.#props.visible) return;
      chatRequest.reply = undefined;
      void this.reply(r.item);
    });

    onMount(() => {
      try {
        const value = sessionStorage.getItem(this.#signInKey());
        if (value) this.blocked = JSON.parse(value);
      } catch {
        /* The open chat still holds the request when storage is unavailable. */
      }
    });

    $effect(() => {
      if (!this.#props.visible || chatRequest.work?.leadId !== this.#props.profile.id) return;
      this.typed('');
      this.intent = 'reply';
      this.about = chatRequest.work;
      chatRequest.work = undefined;
      void tick().then(() => this.#view.focus('only'));
    });

    $effect(() => {
      this.loaded = false;
      this.load(this.#props.profile.id);
    });
    // A poke landing or being set changes the office: catch up, unless a reply
    // is streaming into the list right now.
    $effect(() => {
      if (this.#props.version === this.#seen) return;
      this.#seen = this.#props.version;
      if (!this.sending) this.load(this.#props.profile.id);
    });

    // The chat on screen means its pokes are read; the page then lets the staffer go.
    // Also when one lands while the chat is open: it shows, so it is read.
    $effect(() => {
      void this.lines.length;
      if (this.#props.visible && this.loaded)
        void call(`/api/staff/${this.#props.profile.id}/pokes`, {}).catch(() => {});
    });

    // A saved queue also waits for a reply started in another office window.
    $effect(() => {
      if (this.sending || this.remoteBusy || !this.waiting) return;
      const next = this.waiting;
      this.waiting = undefined;
      void this.say(next.text, next.re, next.files, undefined, { about: next.about });
    });

    // A chat started from a report arrives as a draft: add it to the box and
    // put the cursor at the end, for the owner to say what the owner wants. One
    // started from the agents search arrives empty and only takes the cursor.
    $effect(() => {
      if (chatRequest.drafts[this.#props.profile.id] === undefined || !this.#props.visible) return;
      const d = takeDraft(this.#props.profile.id) ?? '';
      if (d) this.typed('');
      // A draft the box already holds, say from pressing Use in chat twice, goes in once.
      if (d && !this.draft.includes(d.trim()))
        this.draft = this.draft.trim() ? `${this.draft.trimEnd()}\n\n${d}` : d;
      void tick().then(() => this.#view.focus('end'));
    });

    // Deleting a tag from the text drops its file, as in Claude Code.
    $effect(() => {
      const text = this.draft;
      const gone = untrack(() => this.pending.filter((p) => p.inline && !hasToken(text, p.tag)));
      if (!gone.length) return;
      gone.forEach(unpreview);
      this.pending = untrack(() => this.pending.filter((p) => !gone.includes(p)));
    });
  }

  async readResponse(id: number) {
    if (saved[id]) return;
    try {
      saved[id] = await call<SavedResponse>(`/api/tasks/${id}`);
    } catch (err) {
      this.unread[id] = err instanceof Error ? err.message : String(err);
    }
  }

  typed(text: string) {
    const words = text.trim();
    if (!approveWord(this.writtenDecision) && approveWord(words))
      this.approveTo = this.onlyProposal;
    if (!approveWord(words)) this.approveTo = undefined;
    this.writtenDecision = approveWord(words) || yesWord(words) ? words : '';
  }

  pick(d: Delivered) {
    chatRequest.focus = { staff: this.#props.profile.id, item: d };
    this.#props.onitem(d);
  }
  async reply(d: Delivered, how: Intent = 'reply') {
    if (this.saving) return;
    this.refused = '';
    this.intent = how === 'reply' && this.proposal(d) ? 'proposal' : how;
    chatRequest.focus = { staff: this.#props.profile.id, item: d };
    this.replyTo = d;
    await tick();
    this.#view.focus('only');
  }

  hold(value?: Blocked) {
    this.blocked = value;
    try {
      if (value) sessionStorage.setItem(this.#signInKey(), JSON.stringify(value));
      else sessionStorage.removeItem(this.#signInKey());
    } catch {
      /* Storage is optional in the desktop window. */
    }
  }
  continueChat(turnId: string) {
    const request = this.blocked?.signIn;
    if (this.blocked?.turnId !== turnId || !request || this.sending || this.remoteBusy) return;
    this.hold();
    if (
      this.#props.profile.agent === request.agent &&
      (this.#props.profile.account ?? 'office') === request.account
    ) {
      const line = this.lines.find((l) => l.from === 'owner' && l.turnId === turnId);
      if (line) void this.say(line.text, line.re, line.files ?? [], line);
    }
  }

  async stop() {
    if (!this.active || this.stopping) return;
    const selected = this.active.runId;
    this.stopping = true;
    try {
      await call(`/api/staff/${this.#props.profile.id}/chat`, { runId: selected }, 'DELETE');
      if (this.active?.runId === selected) this.active = undefined;
      if (!this.sending) this.load(this.#props.profile.id);
    } catch (err) {
      this.refused = err instanceof Error ? err.message : String(err);
    } finally {
      this.stopping = false;
    }
  }

  /** Add the waiting message to the running reply; one the reply can no longer take stays queued. */
  async sendNow() {
    const next = this.waiting;
    const reply = this.active;
    if (!next || !reply || this.adding || next.files.length || !this.offersNow(next)) return;
    this.adding = true;
    this.waiting = undefined;
    try {
      const { added } = await call<{ added: boolean }>(
        `/api/staff/${this.#props.profile.id}/chat`,
        { runId: reply.runId, message: next.text },
        'PATCH'
      );
      if (!added) throw new Error();
      const line: Line = {
        from: 'owner',
        text: next.text,
        turnId: reply.turnId,
        source: { kind: 'added' },
        at: new Date().toISOString()
      };
      // Above the reply it joins, when this window shows that reply.
      const at = this.lines.findLastIndex((l) => l.pending && l.turnId === reply.turnId);
      this.lines.splice(at < 0 ? this.lines.length : at, 0, line);
      this.#view.scrollDown();
    } catch (err) {
      // Too late for this reply: it goes as the next message, with anything the box queued since.
      const since = this.waiting as Waiting | undefined;
      this.waiting = since
        ? { ...since, text: [next.text, since.text].filter(Boolean).join('\n\n') }
        : next;
      if (err instanceof Error && err.message) this.refused = err.message;
    } finally {
      this.adding = false;
    }
  }

  /** A card's words for Copy: its title, and why, steps and response while the desk holds them. */
  cardCopy(d: Delivered): string {
    const a = d.kind === 'ask' ? this.#props.desk.asks.find((r) => r.id === d.id) : undefined;
    const t = d.kind === 'task' ? this.#props.desk.tasks.find((r) => r.id === d.id) : undefined;
    return cardText({
      kind: KIND[d.kind],
      title: d.title,
      why: (a ?? t)?.why,
      steps: t?.steps,
      response:
        d.kind === 'task'
          ? (drafts[d.id]?.text ?? (t ? current(t).response : saved[d.id]?.response))
          : undefined
    });
  }

  load(id: string) {
    fetch(`/api/staff/${id}/chat` satisfies ApiUrl)
      .then((r) => r.json())
      .then(
        (d: { history: ChatEntry[]; busy: boolean; reply?: { runId: string; turnId: string } }) => {
          // A message that started meanwhile is streaming into the list: keep it.
          if (this.sending) return;
          this.remoteBusy = d.busy;
          this.active = d.reply;
          this.lines = d.history.map((h) => ({ ...h }));
          this.loaded = true;
          this.#view.scrollDown();
        }
      )
      .catch(() => (this.loaded = true));
    call<PokeRow[]>(`/api/staff/${id}/pokes`)
      .then((p) => (this.upcoming = p))
      .catch(() => {});
  }

  async pokeNow(p: PokeRow) {
    await call(`/api/pokes/${p.id}`, {}).catch(() => {});
    this.upcoming = this.upcoming.filter((x) => x.id !== p.id);
  }

  async cancel(p: PokeRow) {
    await call(`/api/pokes/${p.id}`, undefined, 'DELETE').catch(() => {});
    this.upcoming = this.upcoming.filter((x) => x.id !== p.id);
  }

  /**
   * The Desk's own operations. Only a card the owner picked can supply the
   * target. Each says it came from this chat, so the Odd's reply comes back here.
   */
  async decide(d: Delivered, act: 'approve' | 'change' | 'choose', words = '') {
    if (this.saving || !this.decisionMode) return false;
    this.saving = true;
    this.refused = '';
    try {
      if (act === 'choose') {
        const how = this.question(d);
        if (!how?.choice) throw new Error('This task is no longer waiting for this answer.');
        // A tap answers the choice as the Desk does, then finishes the task.
        await call(`/api/tasks/${d.id}`, {
          op: 'choose',
          index: how.choice.index,
          answer: words
        });
        await call(`/api/tasks/${d.id}`, { op: 'finish', done: true, chat: true });
      } else {
        const a = this.proposal(d);
        if (!a) throw new Error('This proposal is no longer open.');
        if (act === 'change' && words.length > 2000)
          throw new Error('Keep the changes to 2,000 characters.');
        const result = await call<{ hires?: AskRow[] }>(`/api/asks/${a.id}`, {
          decision: act === 'change' ? 'iterate' : 'approve',
          reason: words,
          picks: this.picks(a),
          chat: true
        });
        if (result.hires?.length) this.#props.onplan(result.hires);
      }
      return true;
    } catch (err) {
      this.refused = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      this.saving = false;
      this.load(this.#props.profile.id);
    }
  }

  /** Send the box, or queue it while a reply runs; `now` also adds it to that reply (Ctrl+Enter). */
  async submit(now: boolean) {
    if (this.saving || this.uploading) return;
    const words = this.draft.trim();
    if (!words && !this.pending.length) return;
    if (this.decisionMode) {
      const re = this.replyTo;
      const explicit = approveWord(words);
      const approved = approvalTarget(
        words,
        this.writtenDecision,
        this.intent === 'proposal' ? re : undefined,
        this.approveTo,
        re ? undefined : this.onlyProposal
      );
      const action = this.intent === 'change' ? this.intent : approved ? 'approve' : undefined;
      const target = re ?? approved;
      if (target && action) {
        if (!(await this.decide(target, action, action === 'approve' ? '' : words))) return;
        this.draft = '';
        this.writtenDecision = '';
        this.approveTo = undefined;
        this.replyTo = undefined;
        this.intent = 'reply';
        return;
      }
      if (
        explicit &&
        (re?.kind === 'ask' || (!re && (this.approveTo || this.waitingAsks.length)))
      ) {
        this.refused = re
          ? 'Open this ask to see the action it needs.'
          : 'Choose Reply under the proposal you want to approve.';
        return;
      }
      this.writtenDecision = '';
      this.approveTo = undefined;
    }
    this.typed('');
    this.intent = 'reply';
    const message = this.draft;
    const target = this.about;
    if ((!message.trim() && !this.pending.length) || this.uploading) return;
    let files: ChatFile[] = [];
    if (this.pending.length) {
      // Each file goes to the Odd's attachments folder first; the message names them.
      this.uploading = true;
      try {
        files = await this.toAttachments(this.pending);
      } catch (err) {
        this.refused = err instanceof Error ? err.message : String(err);
        return;
      } finally {
        this.uploading = false;
      }
    }
    const re = this.replyTo;
    this.draft = '';
    this.replyTo = undefined;
    this.clearTray();
    this.about = undefined;
    if (this.sending || this.remoteBusy) {
      this.waiting = this.waiting
        ? {
            text: [this.waiting.text, message].filter(Boolean).join('\n\n'),
            re: this.waiting.re ?? re,
            files: [...this.waiting.files, ...files],
            about: this.waiting.about ?? target
          }
        : { text: message, re, files, about: target };
      this.#view.scrollDown();
      if (now) await this.sendNow();
      return;
    }
    await this.say(message, re, files, undefined, { about: target });
  }

  /**
   * Retry under the owner's message while no reply answered its turn, a stopped
   * one included, even after later messages. Not while that turn's reply still
   * runs: a reopened card has no line of it yet, and learns it runs only from
   * its load (`active`). Not under words added to a turn: Retry on the turn's
   * first message sends them too.
   */
  retryable(line: Line, i: number): boolean {
    if (this.sending || line.from !== 'owner' || !line.turnId || line.source?.kind === 'added')
      return false;
    if (this.active?.turnId === line.turnId) return false;
    const answered = (l: Line) =>
      l.from === 'staff' && !l.failed && !l.pending && l.turnId === line.turnId;
    return !this.lines.slice(i + 1).some(answered);
  }

  /** Take back the message waiting to go: it returns to the box. */
  unwait() {
    if (!this.waiting) return;
    this.draft = [this.waiting.text, this.draft.trim() && this.draft].filter(Boolean).join('\n\n');
    this.replyTo ??= this.waiting.re;
    this.about ??= this.waiting.about;
    // Its files go back in the tray, already kept in the Odd's attachments folder.
    const text = this.draft;
    this.pending = [
      ...this.waiting.files.map((f) => ({
        key: this.nextKey++,
        tag: f.tag,
        mediaType: f.mediaType,
        size: f.size,
        kept: f,
        url: isPicture(f.mediaType) ? this.attachmentUrl(f) : undefined,
        inline: hasToken(text, f.tag)
      })),
      ...this.pending
    ];
    this.waiting = undefined;
    void tick().then(() => this.#view.focus('fit'));
  }

  /** Send one message and stream the reply into the chat. */
  async say(
    message: string,
    re?: Delivered,
    files: ChatFile[] = [],
    retry?: Line,
    context: { about?: WorkAbout } = {}
  ) {
    const generation = ++this.#newest;
    const turnId = retry?.turnId ?? newTurnId();
    this.sending = true;
    this.status = 'Thinking';
    if (!retry)
      this.lines.push({
        from: 'owner',
        turnId,
        source: { kind: 'chat' },
        about: context.about,
        // Files alone are a message too: their tags say it, as the server writes it.
        text: message || files.map((f) => `[${f.tag}]`).join(' '),
        re,
        at: new Date().toISOString(),
        ...(files.length ? { files } : {})
      });
    this.lines.push({ from: 'staff', text: '', pending: true, turnId });
    const reply = this.lines[this.lines.length - 1];
    this.#view.scrollDown();
    this.#props.onstart();
    try {
      const res = await fetch(`/api/staff/${this.#props.profile.id}/chat` satisfies ApiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          retry?.inputHash
            ? { turnId }
            : {
                turnId,
                message,
                about: context.about?.key ?? retry?.about?.key,
                re: re && { kind: re.kind, id: re.id },
                ...(files.length ? { files: files.map(({ tag, name }) => ({ tag, name })) } : {})
              }
        )
      });
      if (!res.ok || !res.body) throw await failure(res);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (!chunk.startsWith('data: ')) continue;
          const ev = JSON.parse(chunk.slice(6)) as ChatEvent;
          if (generation !== this.#newest) {
            if (ev.type === 'done' || ev.type === 'error') {
              reply.text = ev.type === 'done' ? ev.text : ev.message;
              reply.pending = false;
              reply.failed = ev.type === 'error' ? true : undefined;
            }
            continue;
          }
          if (ev.type === 'reply') this.active = ev;
          else if (ev.type === 'delta') {
            reply.text += ev.text;
            this.status = '';
          } else if (ev.type === 'tool') this.status = toolWords(ev.name, serviceNames.byId);
          else if (ev.type === 'done') {
            reply.text = ev.text;
            if (ev.choices?.length) reply.choices = ev.choices;
            if (ev.bug) reply.bug = ev.bug;
            if (ev.updates) reply.updates = ev.updates;
            reply.pending = false;
            reply.at = new Date().toISOString();
          } else if (ev.type === 'error') {
            if (ev.signIn) this.hold({ turnId, signIn: ev.signIn });
            reply.text = ev.message;
            reply.pending = false;
            reply.failed = true;
          }
          this.#view.scrollDown();
        }
      }
      if (reply.pending)
        throw new Error(
          'The connection closed before the reply arrived. Check the chat before sending again.'
        );
    } catch (err) {
      reply.text = err instanceof Error ? err.message : String(err);
      reply.failed = true;
    } finally {
      reply.pending = false;
      if (generation === this.#newest) {
        this.sending = false;
        this.remoteBusy = false;
        this.active = undefined;
        this.status = '';
        this.#props.onend();
        this.#view.scrollDown();
        this.load(this.#props.profile.id);
      }
    }
  }

  remove(key: string | number) {
    const p = this.pending.find((x) => x.key === key);
    if (!p) return;
    unpreview(p);
    this.pending = this.pending.filter((x) => x !== p);
    if (p.inline) this.draft = withoutToken(this.draft, p.tag);
  }
  clearTray() {
    this.pending.forEach(unpreview);
    this.pending = [];
    this.refused = '';
  }

  /** Keep each file in the Odd's attachments folder, in the tray's order. */
  toAttachments(items: Pending[]): Promise<ChatFile[]> {
    return Promise.all(
      items.map(async (p) => {
        if (p.kept) return p.kept;
        const file = p.file!;
        const kept = await sendFile<Omit<ChatFile, 'tag'>>(
          `/api/staff/${this.#props.profile.id}/attachments`,
          file,
          file.name || p.tag,
          p.mediaType
        );
        return { ...kept, tag: p.tag };
      })
    );
  }
}
