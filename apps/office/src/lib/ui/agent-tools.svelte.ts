// The coding tools this system offers an Odd, each one's sign-in in the
// office, the tool the office runs on and the tools coming later
// (`/api/agents`), with the calls that pick the office's tool, install a tool
// or change a sign-in (`/api/agents/[tool]`). Setup's Your AI card, the Setup
// window and the "Runs on" picker each make their own, so all show and do the
// same.
//
// Nothing polls. Every one on the page reads the list again when it is made,
// after any of them installs a tool, changes a sign-in or hears a sign-in
// page's address, and, through the component's window focus, while a sign-in
// waits on its page or an install started before a refresh runs.
import type { Agent } from '@oddboro/ledger/agents';
import type { AccountState, AgentTool, LaterTool } from '../../routes/api/agents/+server.ts';
import { call, stream } from './api.ts';
import { magpieRunner } from './magpie-ui.ts';

/** Bumped when an install or a sign-in changed, so every list on the page reads it again. */
let changes = $state(0);

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class AgentTools {
  /** What the server calls this computer: Mac on a Mac, computer elsewhere. */
  computer = $state('computer');
  tools = $state<AgentTool[]>([]);
  /** The tool the office runs on: its own runs and every new hire. */
  office = $state<Agent>('claude');
  /** Whether the owner explicitly chose the office's existing runner. */
  officeConfigured = $state(false);
  officeProblem = $state('');
  /** The explicit gateway route for office runs, or null for a direct account. */
  officeModel = $state<string | null>(null);
  /** An explicit tile choice remains visible while its first route is being configured. */
  modelSource = $state<'direct' | 'magpie'>();
  get magpieSelected() {
    return (
      this.modelSource === 'magpie' ||
      (this.modelSource === undefined &&
        (this.office === 'pi' || !!this.officeModel?.startsWith('magpie:')))
    );
  }
  /** Pending setup can show included Pi before a valid runner/model pair is saved. */
  get selectedOffice(): Agent {
    return this.magpieSelected
      ? (magpieRunner(this.office, this.tools, this.officeConfigured) ?? this.office)
      : this.office;
  }
  /** Whether the office's tool, on its model, draws an Odd's look. Otherwise a hire builds one from parts. */
  drawsLooks = $state(false);
  /** The accounts the owner added beyond each tool's Office account, with their sign-ins. */
  accounts = $state<AccountState[]>([]);
  /** Tools this system does not offer yet, with why. */
  later = $state<LaterTool[]>([]);
  /** Read once, so a card can wait for the real list before it shows one. */
  loaded = $state(false);
  /** Claude Code is installing or updating from setup. */
  installingClaude = $state(false);
  /** Tools whose running command is an update, not an install. */
  updating = $state<Partial<Record<Agent, boolean>>>({});
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
      const a = await call<{
        computer: string;
        office: Agent;
        officeConfigured: boolean;
        officeModel: string | null;
        drawsLooks: boolean;
        tools: AgentTool[];
        accounts: AccountState[];
        later: LaterTool[];
      }>('/api/agents');
      this.computer = a.computer;
      this.office = a.office;
      this.officeConfigured = !!a.officeConfigured;
      this.officeModel = a.officeModel;
      this.drawsLooks = a.drawsLooks;
      this.tools = a.tools;
      this.accounts = a.accounts;
      this.later = a.later;
      this.loaded = true;
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
   * Install the tool with its own installer, or update it with its own
   * updater, which runs to its end. Claude Code goes through setup's own
   * route. Once it ends the list reads it again, so an installed tool moves on
   * to Sign in and an updated one shows its new version, and a failed one
   * stays as it was with the command's last line.
   */
  async install(id: Agent, action: 'install' | 'update' = 'install') {
    const mine = this.#begin(id);
    // The server holds the command from the moment the request lands, so the tile shows it at once.
    const t = this.tools.find((t) => t.id === id);
    if (t?.signIn) t.signIn.installing = true;
    if (id === 'claude') this.installingClaude = true;
    this.updating[id] = action === 'update';
    let last = '';
    let ok = false;
    try {
      await stream<{ line?: string; done?: boolean; ok?: boolean }>(
        id === 'claude' ? '/api/setup/claude' : `/api/agents/${id}`,
        { action },
        (l) => {
          if (l.line) last = l.line;
          if (l.done) ok = !!l.ok;
          if (l.done && !l.ok && mine === this.#attempts[id])
            this.problems[id] = last || `The ${action} stopped.`;
        }
      );
    } catch (e) {
      if (mine === this.#attempts[id]) this.problems[id] = message(e);
    } finally {
      if (id === 'claude') this.installingClaude = false;
      this.updating[id] = false;
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
  async signIn(id: Agent, account?: string) {
    const mine = this.#begin(id);
    // The server holds the sign-in from the moment the request lands, so the row shows Cancel at once.
    const s = account
      ? this.accounts.find((a) => a.id === account)?.signIn
      : this.tools.find((t) => t.id === id)?.signIn;
    if (s) s.waiting = {};
    let last = '';
    try {
      await stream<{ line?: string; url?: string; done?: boolean; ok?: boolean }>(
        `/api/agents/${id}`,
        { action: 'sign-in', ...(account ? { account } : {}) },
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

  /**
   * Add an account for `id` named `label`, then sign it in on its maker's
   * page. Its id, so the caller can move an Odd to it.
   */
  async addAccount(id: Agent, label: string): Promise<string | undefined> {
    this.#begin(id);
    try {
      const a = await call<{ id: string }>('/api/accounts', { agent: id, label });
      await this.load();
      void this.signIn(id, a.id);
      return a.id;
    } catch (e) {
      this.problems[id] = message(e);
      return undefined;
    }
  }

  /** Rename an account the owner added. True when it took the name. */
  async renameAccount(id: Agent, account: string, label: string): Promise<boolean> {
    this.#begin(id);
    try {
      await call('/api/accounts', { id: account, label }, 'PATCH');
      return true;
    } catch (e) {
      this.problems[id] = message(e);
      return false;
    } finally {
      changes++;
    }
  }

  /** Sign an account out and take it away; its Odds go back to the Office account. */
  async removeAccount(id: Agent, account: string) {
    this.#begin(id);
    this.busy = id;
    try {
      await call('/api/accounts', { id: account }, 'DELETE');
    } catch (e) {
      this.problems[id] = message(e);
    } finally {
      this.busy = undefined;
      changes++;
    }
  }

  /** Save an office runner and, when supplied, its source in one server transaction. */
  async pickOffice(id: Agent, model?: string | null) {
    this.officeProblem = '';
    try {
      await call(
        '/api/agents',
        { office: id, ...(model !== undefined ? { magpieModel: model } : {}) },
        'PUT'
      );
      // Only acknowledge a validated pair. Failed requests leave the working choice visible.
      this.office = id;
      if (model !== undefined) this.officeModel = model;
      this.officeConfigured = true;
      await this.load();
      return true;
    } catch (e) {
      this.officeProblem = message(e);
      return false;
    } finally {
      changes++;
    }
  }

  /** Save the selected runner and gateway route together after server validation. */
  async pickMagpieModel(model: string | null) {
    const runner = this.selectedOffice;
    this.busy = runner;
    this.officeProblem = '';
    try {
      await call('/api/agents', { office: runner, magpieModel: model }, 'PUT');
      this.office = runner;
      this.officeModel = model;
      this.officeConfigured = true;
      await this.load();
      return true;
    } catch (e) {
      this.officeProblem = message(e);
      return false;
    } finally {
      this.busy = undefined;
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

  async signOut(id: Agent, account?: string) {
    this.#begin(id);
    this.busy = id;
    try {
      await call(`/api/agents/${id}`, { action: 'sign-out', ...(account ? { account } : {}) });
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
