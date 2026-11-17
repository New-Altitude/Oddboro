// The local office owns these connections, across tabs. A page disconnect
// unsubscribes that page; only an explicit action stops a session or a turn.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { rmSync, type FSWatcher } from 'node:fs';
import {
  claudeConfigDir,
  defaultClaudeFolder,
  home,
  connectProject,
  PAIR_SELF,
  hideProject,
  claimProject,
  nextProjectRequest,
  changeProjectRequest,
  finishProject,
  projectConnections,
  activeProjectRequest,
  type ProjectSession,
  type ProjectAgent,
  type ProjectRequest,
  type ProjectStatus
} from '@oddboro/ledger';
import { ProjectTerminal } from './terminal.ts';
import { startCodex, joinCodex, type CodexRpc, type RpcMessage } from './codex-rpc.ts';
import { projectFolder, projectInput, UUID } from './native.ts';
import {
  claudeProjectsIn,
  inTerminal,
  markedClaudeProjects,
  prepareClaude,
  checkClaudeReceiver,
  postClaude,
  clearClaude,
  correctClaude,
  hearClaude
} from './claude-project.ts';
import {
  ClaudeNeedsTrust,
  requireBackground,
  resumeInBackground,
  startInBackground
} from './claude-background.ts';
import {
  copyToOpen,
  openInTerminal,
  runnableClaudeFolder,
  sessionFolder,
  startedSession
} from './controller-claude.ts';
import { PROJECT_WORDS } from '../../project-words.ts';
import { bus, listen } from '../events.ts';

type Thread = {
  id: string;
  cwd: string;
  name?: string;
  preview?: string;
  updatedAt: number;
  status?: { type: string };
  turns?: { id: string; status: string; items?: { type: string; text?: string }[] }[];
};
type Question = {
  key: string;
  id: number | string;
  method: string;
  params: Record<string, unknown>;
};
type Runtime = {
  session: ProjectSession;
  account?: string;
  connected: boolean;
  terminal?: ProjectTerminal;
  watch?: FSWatcher;
  turn?: string;
  request?: ProjectRequest;
  reply: string;
  questions: Map<number | string, Question>;
  note: string;
  /**
   * What the last connect told the owner about the session's Claude folder
   * (`FOLDER_NOTICE`), or null. Its own field, since later events overwrite `note`.
   */
  folderNotice: string | null;
  socket?: string;
  market?: string;
  plugin?: string;
  openingTerminal?: Promise<ProjectTerminal>;
  busy?: Promise<void>;
  arrival?: ReturnType<typeof setTimeout>;
  tail: Promise<void>;
};
type View = {
  id: string;
  connected: boolean;
  terminal: boolean;
  turn?: string;
  requestId?: string;
  question?: Question;
  account?: string;
  note: string;
  folderNotice: string | null;
  reply: string;
  market?: string;
};
type Listed = {
  id: string;
  title: string;
  updated: number;
  live: boolean;
  job?: string;
  /** Claude only: the Claude folder that holds it, null while not known. */
  configDir?: string | null;
  /** Claude only, the continue path's list only: that folder's name and login. */
  mark?: string | null;
  /** Claude only: the process of a running one, and what it is doing. */
  pid?: number;
  status?: string;
  /** Claude only: open in a terminal, and connect's `move` can bring it in on this computer. */
  movable?: boolean;
};
/** What every project route answers while Advanced mode is off. */
export const ADVANCED_OFF =
  'Project sessions need advanced mode. Turn it on in Setup, under Advanced.';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class ProjectController {
  readonly events = new EventEmitter().setMaxListeners(100);
  private sessions = new Map<string, Runtime>();
  private servers = new Map<string, Promise<CodexRpc>>();
  private creating = new Map<string, Promise<Runtime>>();
  /**
   * Terminals opened only so Claude Code can ask the owner to trust a folder,
   * by an id of their own, which the terminal routes take as a session's.
   */
  private setups = new Map<string, { folder: string; dir: string; terminal: ProjectTerminal }>();
  constructor() {
    listen();
    bus.on('event', (e) => {
      if (
        e.type === 'change' &&
        (e.table === 'project_requests' || e.table === 'project_sessions')
      ) {
        this.events.emit('list');
        for (const c of this.sessions.values()) void this.pump(c).catch((err) => this.warn(c, err));
      }
    });
  }
  private warn(c: Runtime, e: unknown) {
    c.note = message(e);
    this.changed(c);
  }
  private changed(c: Runtime) {
    this.events.emit(c.session.id, this.view(c.session.id));
  }
  view(id: string): View {
    const c = this.sessions.get(id);
    return {
      id,
      connected: c?.connected ?? false,
      terminal: !!c?.terminal?.running,
      turn: c?.turn,
      requestId: c?.request?.id,
      reply: c?.reply ?? '',
      question: c?.questions.values().next().value,
      note: c?.note ?? 'Disconnected',
      folderNotice: c?.folderNotice ?? null,
      account: c?.account,
      market: c?.market
    };
  }
  /** A session's dot in the Projects list: the stored status, or what its live connection is doing now. */
  status(id: string, stored: ProjectStatus): ProjectStatus {
    const c = this.sessions.get(id);
    if (c?.questions.size) return 'waiting';
    if (stored === 'waiting') return stored;
    if (c?.turn || c?.request) return 'working';
    return stored;
  }
  private codex(socket = '') {
    const existing = this.servers.get(socket);
    if (existing) return existing;
    const receive = (m: RpcMessage) => this.receive(socket, m);
    const closed = () => {
      this.servers.delete(socket);
      for (const c of this.sessions.values())
        if (c.session.agent === 'codex' && (c.socket ?? '') === socket) {
          c.connected = false;
          c.questions.clear();
          c.note = 'Codex disconnected. Reconnect to inspect the conversation.';
          this.changed(c);
        }
    };
    const rpc = (socket ? joinCodex(socket, receive, closed) : startCodex(receive, closed)).catch(
      (e) => {
        this.servers.delete(socket);
        throw e;
      }
    );
    this.servers.set(socket, rpc);
    return rpc;
  }
  async list(agent: ProjectAgent, path: string, socket?: string): Promise<Listed[]> {
    const cwd = await projectFolder(path);
    if (agent === 'claude') return markedClaudeProjects(cwd);
    const rpc = await this.codex(socket);
    const live = new Set((await rpc.request<{ data: string[] }>('thread/loaded/list')).data);
    const rows: Listed[] = [];
    let cursor: string | null = null;
    if (!socket)
      do {
        const page: { data: Thread[]; nextCursor: string | null } = await rpc.request(
          'thread/list',
          {
            cwd,
            cursor,
            limit: 100,
            modelProviders: [],
            useStateDbOnly: true,
            sourceKinds: ['cli', 'vscode', 'appServer', 'exec', 'unknown']
          }
        );
        for (const t of page.data)
          if (t.cwd === cwd)
            rows.push({
              id: t.id,
              title: t.name || t.preview || 'Codex',
              updated: t.updatedAt * 1000,
              live: live.has(t.id)
            });
        cursor = page.nextCursor;
      } while (cursor);
    // A new turn can be live before its transcript is indexed in saved history.
    const indexed = new Set(rows.map((row) => row.id));
    for (const id of live) {
      if (indexed.has(id)) continue;
      const { thread } = await rpc.request<{ thread: Thread }>('thread/read', { threadId: id });
      if (thread.cwd === cwd)
        rows.unshift({
          id,
          title: thread.name || thread.preview || 'Codex',
          updated: thread.updatedAt * 1000,
          live: true
        });
    }
    return rows;
  }
  /**
   * Connect a session of the project at `path`: the conversation `nativeId`,
   * else a new one. `configDir` is the Claude folder the page picked, in the
   * continue path's list or in Account when starting one. For a known session, its own stored folder
   * is no pick: Reconnect sends it back. `move` is the owner's yes to end a
   * Claude conversation's terminal session so it opens here; it is ignored for
   * one not open in a terminal.
   */
  async connect(
    agent: ProjectAgent,
    path: string,
    options: {
      nativeId?: string;
      title?: string;
      handedOver?: boolean;
      socket?: string;
      configDir?: string;
      move?: boolean;
    } = {}
  ) {
    const { handedOver = false, socket, move = false } = options;
    let { nativeId: id, title, configDir } = options;
    // Projects runs every Claude conversation in the background, so a Claude
    // Code without background sessions is refused before anything is read.
    if (agent === 'claude') await requireBackground();
    const folder = await projectFolder(path);
    const titled = (t?: string) =>
      (t || 'New ' + (agent === 'codex' ? 'Codex' : 'Claude Code') + ' session').slice(0, 200);
    /** The session row's id, when it must match a plugin prepared before the row exists. */
    let key: string | undefined;
    let started: Thread | undefined;
    let folderNotice: string | null = null;
    // Codex keeps no Claude folder: the one sent is neither checked nor used.
    if (agent === 'codex') configDir = undefined;
    else if (configDir !== undefined) runnableClaudeFolder(configDir);

    if (id && !UUID.test(id)) throw new Error('Choose a valid conversation ID.');
    if (id) {
      let saved: Listed | undefined;
      const known = (await projectConnections()).find(
        (s) => s.agent === agent && s.folder === folder && s.nativeId === id
      );
      if (agent === 'codex') {
        const rpc = await this.codex(socket);
        const [{ thread }, loaded] = await Promise.all([
          rpc.request<{ thread: Thread }>('thread/read', { threadId: id }),
          rpc.request<{ data: string[] }>('thread/loaded/list')
        ]);
        if (thread.cwd !== folder)
          throw new Error('That conversation belongs to a different project.');
        saved = {
          id: thread.id,
          title: thread.name || thread.preview || 'Codex',
          updated: thread.updatedAt * 1000,
          live: loaded.data.includes(id)
        };
      } else {
        ({ saved, configDir, folderNotice } = await copyToOpen(folder, id, {
          known,
          configDir,
          move
        }));
      }
      if (!saved && !known) throw new Error('That conversation was not found in this project.');
      if (agent === 'codex' && !saved?.live && !handedOver)
        throw new Error(
          'Finish or stop the turn in its original window, then choose Hand over this conversation.'
        );
      title = title || saved?.title;
    } else if (agent === 'codex') {
      const { thread } = await (
        await this.codex(socket)
      ).request<{ thread: Thread }>('thread/start', { cwd: folder });
      id = thread.id;
      started = thread;
    } else {
      configDir ??= defaultClaudeFolder();
      title = titled(title);
      ({ id, key } = await this.startClaude(folder, configDir, title));
    }
    const s = await connectProject(agent, id, folder, titled(title), configDir, { id: key });
    const c = await this.attach(s, socket, started);
    // Opening emitted its view before this was known, and connecting again
    // emits none: emit it now. The next connect replaces or clears it.
    c.folderNotice = folderNotice;
    this.changed(c);
    return s;
  }
  /**
   * Starts a new Claude conversation in the background in `folder`, under the
   * Claude folder `dir`, and returns its id and the key its plugin was
   * prepared under, which becomes the session row's id. The plugin pairs with
   * the session that loads it, since the conversation has no id until it runs.
   */
  private async startClaude(folder: string, dir: string, title: string) {
    for (const [id, setup] of this.setups)
      if (setup.folder === folder && setup.dir === dir) await this.closeSetup(id);
    const key = randomUUID();
    const p = prepareClaude({ id: key, nativeId: PAIR_SELF, folder });
    try {
      const short = await startInBackground(folder, dir, ['-n', title, '--plugin-dir', p.plugin]);
      return { id: await startedSession(folder, dir, short), key };
    } catch (e) {
      // No session will read this plugin.
      rmSync(home('project-sessions', key), { recursive: true, force: true });
      if (e instanceof ClaudeNeedsTrust) e.setup = await this.trustTerminal(folder, dir);
      throw e;
    }
  }
  /**
   * Opens Claude Code in a terminal in `folder`, under the Claude folder
   * `dir`, so it can ask the owner to trust the folder, and returns the
   * terminal's id. Quit before any message, it saves no conversation.
   */
  private async trustTerminal(folder: string, dir: string): Promise<string> {
    const id = randomUUID();
    const terminal = await ProjectTerminal.open('claude', [], folder, {
      CLAUDE_CONFIG_DIR: claudeConfigDir(dir)
    });
    this.setups.set(id, { folder, dir, terminal });
    terminal.events.on('exit', () => {
      if (this.setups.get(id)?.terminal === terminal) this.setups.delete(id);
    });
    return id;
  }
  private async closeSetup(id: string) {
    const setup = this.setups.get(id);
    this.setups.delete(id);
    await setup?.terminal.releaseProcess();
  }
  private attach(s: ProjectSession, socket?: string, started?: Thread) {
    const existing = this.sessions.get(s.id);
    if (existing?.connected) {
      if (existing.socket !== socket)
        throw new Error('Disconnect the previous Codex server first.');
      // Connect may have just stored the session's Claude folder: the terminal reads this row.
      existing.session = s;
      return Promise.resolve(existing);
    }
    const inflight = this.creating.get(s.id);
    if (inflight) return inflight;
    const promise = this.open(s, socket, started).finally(() => this.creating.delete(s.id));
    this.creating.set(s.id, promise);
    return promise;
  }
  private async open(s: ProjectSession, socket?: string, started?: Thread) {
    const c: Runtime = {
      session: s,
      connected: false,
      reply: '',
      note: 'Connected',
      folderNotice: null,
      tail: Promise.resolve(),
      questions: new Map(),
      socket
    };
    this.sessions.set(s.id, c);
    try {
      c.request = await activeProjectRequest(s.id);
      if (s.agent === 'claude') {
        const dir = sessionFolder(s);
        const p = prepareClaude(s);
        c.market = p.market;
        c.plugin = p.plugin;
        c.watch = hearClaude(
          s,
          async (id, answer) => {
            if (answer === undefined) {
              if (await changeProjectRequest(id, s.id, ['sending'], 'working')) {
                clearTimeout(c.arrival);
                c.note = 'Claude is working';
              }
            } else if (typeof answer === 'string' && answer.length <= 100000) {
              const finished = await finishProject(id, s.id, answer);
              if (!finished) return;
              clearTimeout(c.arrival);
              clearClaude(s, id);
              if (c.request?.id === id) c.request = undefined;
              c.reply = answer;
              c.note = 'Finished';
              await this.pump(c);
            }
            this.changed(c);
          },
          (id) => {
            if (c.request?.id === id) {
              c.note = 'Claude read your correction';
              this.changed(c);
            }
          },
          (e) => this.warn(c, e)
        );
        if (c.request) {
          const active = (await claudeProjectsIn(s.folder, dir)).find(
            (row) => row.id === s.nativeId && row.live
          );
          if (!active)
            await changeProjectRequest(c.request.id, s.id, ['sending', 'working'], 'uncertain', {
              answer:
                'Claude closed before the office received its answer. Inspect the conversation.'
            });
          else if (c.request.state === 'sending') this.waitForClaude(c, c.request.id);
          c.note = 'Inspect the native conversation before sending more work.';
        }
      } else {
        const rpc = await this.codex(c.socket);
        const account = await rpc
          .request<{ account?: { type: string; email?: string } | null }>('account/read', {
            refreshToken: false
          })
          .catch(() => undefined);
        c.account = account?.account?.email || account?.account?.type;
        let thread = started;
        if (!thread) {
          // Resume subscribes this client to notifications. Read the live turn
          // separately: a resume response may contain only persisted history.
          ({ thread } = await rpc.request<{ thread: Thread }>('thread/resume', {
            threadId: s.nativeId
          }));
          const current = await rpc.request<{ thread: Thread }>('thread/read', {
            threadId: s.nativeId,
            includeTurns: true
          });
          thread = current.thread;
        }
        if (thread.cwd !== s.folder || thread.id !== s.nativeId)
          throw new Error('Codex returned a different conversation or project.');
        c.turn = thread.turns?.find((t) => t.status === 'inProgress')?.id;
        if (c.request) {
          const old = thread.turns?.find((t) => t.id === c.request?.turn);
          if (old?.status === 'completed') {
            const text =
              old.items
                ?.filter((i) => i.type === 'agentMessage')
                .map((i) => i.text)
                .join('\n') || '';
            if (text) {
              await finishProject(c.request.id, s.id, text);
              c.request = undefined;
            }
          }
          if (c.request && (!c.turn || c.request.turn !== c.turn))
            await changeProjectRequest(c.request.id, s.id, ['sending', 'working'], 'uncertain', {
              answer: 'Inspect the saved conversation before clearing this request.'
            });
        }
      }
      c.connected = true;
      this.changed(c);
      await this.pump(c);
      return c;
    } catch (e) {
      clearTimeout(c.arrival);
      c.watch?.close();
      this.sessions.delete(s.id);
      throw e;
    }
  }
  private runtime(id: string) {
    const c = this.sessions.get(id);
    if (!c?.connected) throw new Error('Connect this session first.');
    return c;
  }
  async terminal(id: string) {
    const c = this.runtime(id);
    if (c.terminal?.running) return c.terminal;
    return (c.openingTerminal ??= this.launchTerminal(c).finally(() => {
      c.openingTerminal = undefined;
    }));
  }
  private async launchTerminal(c: Runtime) {
    const s = c.session;
    if (s.agent === 'codex') {
      const start = (await this.codex(c.socket)).terminal(s.nativeId);
      c.terminal = await ProjectTerminal.open('codex', start.args, s.folder, start.env);
    } else {
      await requireBackground();
      const dir = sessionFolder(s);
      const row = (await claudeProjectsIn(s.folder, dir)).find((r) => r.id === s.nativeId);
      if (inTerminal(row)) throw openInTerminal();
      // A conversation with a background session attaches to it, running or
      // stopped; any other resumes as one first. The plugin was prepared as
      // this session opened.
      const short =
        row?.job ||
        (await resumeInBackground(s.folder, dir, s.nativeId, c.plugin!).catch((e: unknown) => {
          // Start again means nothing for a saved conversation, whose folder
          // this account no longer trusts.
          throw e instanceof ClaudeNeedsTrust ? new Error(PROJECT_WORDS.startFailed) : e;
        }));
      c.terminal = await ProjectTerminal.open('claude', ['attach', short], s.folder, {
        CLAUDE_CONFIG_DIR: claudeConfigDir(dir)
      });
    }
    c.terminal.events.on('exit', () => {
      c.note = 'Terminal closed. You can reopen the conversation.';
      this.changed(c);
    });
    this.changed(c);
    return c.terminal;
  }
  /** The running terminal of `id`: a folder's trust terminal, else the session's. */
  openTerminal(id: string) {
    const setup = this.setups.get(id)?.terminal;
    if (setup?.running) return setup;
    const t = this.runtime(id).terminal;
    if (!t?.running) throw new Error('Open the native terminal first.');
    return t;
  }
  async resolve(id: string, key: string) {
    const c = this.runtime(id);
    if (c.turn || c.request?.id !== key) throw new Error('Inspect the current request first.');
    if (
      !(await changeProjectRequest(key, id, ['uncertain'], 'stopped', {
        answer: 'Owner inspected the native conversation and cleared delivery.'
      }))
    )
      throw new Error('That request does not need reconciliation.');
    if (c.session.agent === 'claude') clearClaude(c.session, key);
    clearTimeout(c.arrival);
    c.request = undefined;
    await this.pump(c);
    this.changed(c);
  }
  async checkInput(id: string, prompt: string, file?: string) {
    const c = this.runtime(id);
    if (file) await projectInput(c.session.folder, prompt, file);
  }
  async work(id: string) {
    return this.pump(this.runtime(id));
  }
  private pump(c: Runtime): Promise<void> {
    if (!c.connected || c.turn || c.request) return Promise.resolve();
    if (c.busy) return c.busy;
    c.busy = this.dispatch(c).finally(() => {
      c.busy = undefined;
    });
    return c.busy;
  }
  private async dispatch(c: Runtime) {
    const before = c.note;
    if (c.session.agent === 'claude') {
      const next = await nextProjectRequest(c.session.id);
      if (!next) return;
      c.note = 'Checking Claude’s office connection';
      this.changed(c);
      try {
        await this.terminal(c.session.id);
        await checkClaudeReceiver(c.session);
      } catch (e) {
        // No offer has been written: retry can safely use the same saved request.
        const failed = await changeProjectRequest(
          next.id,
          c.session.id,
          ['queued', 'authorized'],
          'failed',
          { answer: message(e) }
        );
        if (failed) c.note = message(e);
        this.changed(c);
        return;
      }
      if (!c.connected) return;
    }
    const r = await claimProject(c.session.id);
    if (!r) {
      // The claim sent nothing, so the readiness note no longer applies.
      if (c.note !== before) {
        c.note = before;
        this.changed(c);
      }
      return;
    }
    c.request = r;
    c.reply = '';
    c.note = 'Sending assignment';
    this.changed(c);
    try {
      const content = await projectInput(c.session.folder, r.prompt, r.file);
      if (c.session.agent === 'claude') {
        postClaude(c.session, { ...r, prompt: content.text });
        c.note = 'Waiting for Claude to take the assignment';
        this.waitForClaude(c, r.id);
      } else {
        const { turn } = await (
          await this.codex(c.socket)
        ).request<{ turn: { id: string } }>('turn/start', {
          threadId: c.session.nativeId,
          input: content.input
        });
        if (c.request?.id === r.id) {
          c.turn = turn.id;
          c.request.turn = turn.id;
          await changeProjectRequest(r.id, c.session.id, ['sending'], 'working', { turn: turn.id });
        }
      }
    } catch (e) {
      await changeProjectRequest(r.id, c.session.id, ['sending', 'working'], 'uncertain', {
        answer: message(e)
      });
      c.note = message(e);
    }
    this.changed(c);
  }
  /** An offered assignment may have reached Claude. Never resend it on a timeout. */
  private waitForClaude(c: Runtime, id: string) {
    clearTimeout(c.arrival);
    c.arrival = setTimeout(() => {
      const answer =
        'Claude has not acknowledged this assignment. Check its terminal for a trust, sign-in or plugin prompt before clearing it. Nothing will be sent again automatically.';
      void changeProjectRequest(id, c.session.id, ['sending'], 'uncertain', { answer })
        .then((row) => {
          if (!row) return;
          c.note = answer;
          this.changed(c);
        })
        .catch((e) => this.warn(c, e));
    }, 60_000);
    c.arrival.unref();
  }
  private receive(socket: string, m: RpcMessage) {
    const p = m.params ?? {};
    const c = [...this.sessions.values()].find(
      (v) =>
        v.connected &&
        (v.socket ?? '') === socket &&
        v.session.agent === 'codex' &&
        v.session.nativeId === p.threadId
    );
    if (!c) return; // Another client may own a different thread on this server.
    // A very short turn may finish before turn/start's response records its ID.
    const sending = c.busy;
    c.tail = c.tail
      .then(async () => {
        await sending;
        await this.event(c, m, p);
      })
      .catch((e) => this.warn(c, e));
  }
  private async event(c: Runtime, m: RpcMessage, p: Record<string, unknown>) {
    if (m.id !== undefined && m.method) {
      c.questions.set(m.id, { key: randomUUID(), id: m.id, method: m.method, params: p });
      c.note = 'Waiting for you';
      this.changed(c);
      return;
    }
    const t = p.turn as { id: string; status: string; error?: { message: string } } | undefined;
    if (m.method === 'turn/started' && t) {
      c.turn = t.id;
      c.note = 'Working';
      c.reply = '';
    } else if (m.method === 'item/agentMessage/delta' && typeof p.delta === 'string')
      c.reply += p.delta;
    else if (m.method === 'item/completed') {
      const item = p.item as { type: string; text?: string };
      if (item?.type === 'agentMessage' && item.text) c.reply = item.text;
    } else if (m.method === 'turn/completed' && t) {
      if (c.turn && t.id !== c.turn) return;
      if (c.request && c.request.turn === t.id) {
        if (t.status === 'completed')
          await finishProject(c.request.id, c.session.id, c.reply || 'Turn completed.');
        else
          await changeProjectRequest(
            c.request.id,
            c.session.id,
            ['sending', 'working'],
            'stopped',
            { answer: t.error?.message || t.status }
          );
      }
      c.turn = undefined;
      if (c.request?.turn === t.id) c.request = undefined;
      c.questions.clear();
      c.note = t.error?.message || t.status;
      await this.pump(c);
    } else if (m.method === 'serverRequest/resolved')
      c.questions.delete(p.requestId as number | string);
    else return;
    this.changed(c);
  }
  async steer(id: string, turn: string, text: string, file?: string) {
    const c = this.runtime(id);
    const content = await projectInput(c.session.folder, text, file);
    if (c.session.agent === 'claude') {
      if (c.request?.id !== turn) throw new Error('That assignment has ended.');
      correctClaude(c.session, turn, content.text);
      c.note = 'Correction waiting for Claude';
      this.changed(c);
      return;
    }
    if (c.turn !== turn) throw new Error('That turn is no longer active.');
    await (
      await this.codex(c.socket)
    ).request('turn/steer', {
      threadId: c.session.nativeId,
      expectedTurnId: turn,
      input: content.input
    });
  }
  async stop(id: string, expected: string) {
    const c = this.runtime(id);
    if (c.session.agent === 'codex') {
      if (!c.turn || c.turn !== expected) throw new Error('That turn has already ended.');
      await (
        await this.codex(c.socket)
      ).request('turn/interrupt', { threadId: c.session.nativeId, turnId: expected });
      return;
    }
    if (!c.request || c.request.id !== expected)
      throw new Error('That assignment is no longer active.');
    clearClaude(c.session, expected);
    clearTimeout(c.arrival);
    c.terminal?.write('\x1b');
    await changeProjectRequest(expected, id, ['sending', 'working'], 'uncertain', {
      answer:
        'The owner withdrew the assignment and requested an interrupt. Check the native terminal for work already done.'
    });
    c.note = 'Interrupt requested. Inspect the native terminal, then clear the assignment.';
    this.changed(c);
  }
  async answer(
    id: string,
    request: string | number,
    key: string,
    pick: 'accept' | 'decline',
    answers?: Record<string, string[]>
  ) {
    const c = this.runtime(id),
      q = c.questions.get(request);
    if (!q || q.key !== key || q.id !== request)
      throw new Error('That question has been resolved.');
    let result: unknown;
    if (
      q.method === 'item/commandExecution/requestApproval' ||
      q.method === 'item/fileChange/requestApproval'
    )
      result = { decision: pick };
    else if (q.method === 'item/permissions/requestApproval')
      result = { permissions: pick === 'accept' ? q.params.permissions : {}, scope: 'turn' };
    else if (q.method === 'item/tool/requestUserInput' && answers)
      result = {
        answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { answers: v }]))
      };
    else throw new Error('Answer this request in the native terminal.');
    (await this.codex(c.socket)).send({ id: q.id, result });
    c.questions.delete(request);
    this.changed(c);
  }
  /** Disconnect the session `id`, or close the trust terminal `id`. */
  async disconnect(id: string) {
    if (this.setups.has(id)) return this.closeSetup(id);
    const c = this.sessions.get(id);
    if (!c) return;
    if (c.request || c.turn)
      throw new Error('Finish or stop the active work before disconnecting.');
    await this.release(c);
  }
  /**
   * Remove a disconnected session from the owner's list (`hideProject`). A
   * runtime kept after its Codex server closed is let go first, active work or
   * not: with the server gone, the owner has no way to stop that turn.
   */
  async remove(id: string) {
    if (this.creating.has(id) || this.sessions.get(id)?.connected)
      throw new Error('Disconnect it first.');
    const c = this.sessions.get(id);
    if (c) await this.release(c);
    await hideProject(id);
  }
  private async release(c: Runtime) {
    c.connected = false;
    clearTimeout(c.arrival);
    c.watch?.close();
    await c.terminal?.releaseProcess();
    this.sessions.delete(c.session.id);
    this.changed(c);
  }
}
const g = globalThis as unknown as { officeProjectController?: ProjectController };
export const projectController = () => (g.officeProjectController ??= new ProjectController());
/**
 * Advanced mode went off: every open project view and terminal stream ends.
 * The native clients and their turns keep running in the provider; nothing
 * new reaches them, since the routes refuse and no request can be claimed.
 */
export const detachProjectViews = () => g.officeProjectController?.events.emit('off');
