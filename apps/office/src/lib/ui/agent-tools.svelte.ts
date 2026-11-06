// The coding tools this system offers an Odd, and each one's sign-in in the
// office (`/api/agents`), with the calls that install a tool or change a
// sign-in (`/api/agents/[tool]`). Onboarding's Other AI tools card, the Setup
// window and the "Runs on" picker each make their own, so all show and do the
// same.
//
// Nothing polls. Every one on the page reads the list again when it is made,
// after any of them installs a tool, changes a sign-in or hears a sign-in
// page's address, and, through the component's window focus, while a sign-in
// waits on its page or an install started before a refresh runs.
import type { Agent } from '@oddboro/ledger/agents';
import type { AgentTool } from '../../routes/api/agents/+server.ts';
import { call, stream } from './api.ts';

/** Bumped when an install or a sign-in changed, so every list on the page reads it again. */
let changes = $state(0);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class AgentTools {
  /** What the server calls this computer: Mac on a Mac, computer elsewhere. */
  computer = $state('computer');
  tools = $state<AgentTool[]>([]);
  /** The tool whose sign-out or key is being saved. */
  busy = $state<Agent | undefined>();
  /** What went wrong, by tool. */
  problems = $state<Partial<Record<Agent, string>>>({});
  /** Counts each tool's sign-ins, so one started over, cancelled or signed out no longer changes the row. */
  #attempts: Partial<Record<Agent, number>> = {};

  /** Made while a component starts, since it reads the list in an effect of that component. */
  constructor() {
    $effect(() => {
      void changes;
      void this.load();
    });
  }

  async load() {
    try {
      const a = await call<{ computer: string; tools: AgentTool[] }>('/api/agents');
      this.computer = a.computer;
      this.tools = a.tools;
    } catch {
      // The page keeps the list it had; the next change or focus reads it again.
    }
  }

  /** Any tool waiting on its sign-in page or its install, so the owner coming back reads the list again. */
  get waiting() {
    return this.tools.some((t) => !!t.signIn?.waiting || !!t.signIn?.installing);
  }

  /** A new attempt for the tool: an older one's end no longer counts, and its problem clears. */
  #begin(id: Agent) {
    delete this.problems[id];
    return (this.#attempts[id] = (this.#attempts[id] ?? 0) + 1);
  }

  /**
   * Install the tool with its own installer, which runs to its end. Once it
   * ends the list reads it again, so an installed tool moves on to Sign in, and
   * a failed one stays on Install with the installer's last line.
   */
  async install(id: Agent) {
    const mine = this.#begin(id);
    // The server holds the install from the moment the request lands, so the row shows it at once.
    const t = this.tools.find((t) => t.id === id);
    if (t?.signIn) t.signIn.installing = true;
    let last = '';
    let ok = false;
    try {
      await stream<{ line?: string; done?: boolean; ok?: boolean }>(
        `/api/agents/${id}`,
        { action: 'install' },
        (l) => {
          if (l.line) last = l.line;
          if (l.done) ok = !!l.ok;
          if (l.done && !l.ok && mine === this.#attempts[id])
            this.problems[id] = last || 'The install stopped.';
        }
      );
    } catch (e) {
      if (mine === this.#attempts[id]) this.problems[id] = message(e);
    }
    await this.load();
    changes++;
    // Installed where the office cannot see it: a folder its PATH, fixed when it started, lacks.
    const after = this.tools.find((t) => t.id === id);
    if (ok && after && !after.installed && mine === this.#attempts[id])
      this.problems[id] =
        `${after.name} installed, but the office cannot find it yet. Restart Oddboro.`;
  }

  /**
   * Start the tool's browser sign-in; its own page finishes it. Pressed again
   * while one waits, it starts over with a fresh page.
   */
  async signIn(id: Agent) {
    const mine = this.#begin(id);
    // The server holds the sign-in from the moment the request lands, so the row shows Cancel at once.
    const t = this.tools.find((t) => t.id === id);
    if (t?.signIn) t.signIn.waiting = {};
    let last = '';
    try {
      await stream<{ line?: string; url?: string; done?: boolean; ok?: boolean }>(
        `/api/agents/${id}`,
        { action: 'sign-in' },
        (l) => {
          if (l.line) last = l.line;
          if (l.url) changes++;
          if (l.done && !l.ok && mine === this.#attempts[id])
            this.problems[id] = last || 'The sign-in stopped.';
        }
      );
    } catch (e) {
      if (mine === this.#attempts[id]) this.problems[id] = message(e);
    } finally {
      changes++;
    }
  }

  /** Stop a sign-in that waits on its page, from this page or one before a refresh. */
  async cancel(id: Agent) {
    this.#begin(id);
    try {
      await call(`/api/agents/${id}`, undefined, 'DELETE');
    } catch (e) {
      this.problems[id] = message(e);
    }
    changes++;
  }

  async signOut(id: Agent) {
    this.#begin(id);
    this.busy = id;
    try {
      await call(`/api/agents/${id}`, { action: 'sign-out' });
    } catch (e) {
      this.problems[id] = message(e);
    } finally {
      this.busy = undefined;
      changes++;
    }
  }

  /** Give a key tool its API key. True when the office tried it and kept it. */
  async setKey(id: Agent, key: string) {
    this.#begin(id);
    this.busy = id;
    try {
      await call(`/api/agents/${id}`, { key }, 'PUT');
      return true;
    } catch (e) {
      this.problems[id] = message(e);
      return false;
    } finally {
      this.busy = undefined;
      changes++;
    }
  }
}
