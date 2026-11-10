import type {
  MagpieAction,
  MagpieDiscovered,
  MagpiePrompt,
  MagpieReply,
  MagpieSignIn,
  MagpieState
} from '../magpie.ts';
import { call } from './api.ts';
import { magpieSignInActive } from './magpie-ui.ts';

/** Shared refresh receipt, with no timer and no credential values. */
let changes = $state(0);

export class MagpieConnection {
  state = $state<MagpieState>();
  signIn = $state<MagpieSignIn>();
  setup = $state<MagpieReply['setup']>();
  discovered = $state<MagpieDiscovered[]>([]);
  prompt = $state<MagpiePrompt | null>(null);
  inputs: Record<string, string> = {};
  candidates = $state<NonNullable<MagpieReply['candidates']>>([]);
  loading = $state(false);
  busy = $state(false);
  problem = $state('');
  #read = 0;

  constructor() {
    $effect(() => {
      void changes;
      void this.load();
    });
  }

  async load() {
    const read = ++this.#read;
    this.loading = true;
    try {
      const state = await call<MagpieState>('/api/magpie');
      if (read !== this.#read) return;
      this.state = state;
      if (state.access === 'use') {
        this.signIn = undefined;
        this.discovered = [];
        this.prompt = null;
        this.inputs = {};
      }
      this.problem = '';
    } catch (error) {
      if (read === this.#read)
        this.problem = error instanceof Error ? error.message : String(error);
    } finally {
      if (read === this.#read) this.loading = false;
    }
  }

  async act(action: MagpieAction): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.problem = '';
    // An older status response must never replace a completed mutation.
    ++this.#read;
    try {
      const reply = await call<MagpieReply>('/api/magpie', action);
      this.state = reply.state;
      if (reply.setup) this.setup = reply.setup;
      else if (
        ['connect', 'connect-gateway', 'disconnect', 'start-managed'].includes(action.action)
      )
        this.setup = undefined;
      if (reply.signIn) this.signIn = reply.signIn;
      if (reply.discovered) this.discovered = reply.discovered;
      if ('prompt' in reply) this.prompt = reply.prompt ?? null;
      if (reply.inputs) this.inputs = reply.inputs;
      if (
        ['import-selected', 'connect', 'connect-gateway', 'disconnect', 'start-managed'].includes(
          action.action
        )
      )
        this.discovered = [];
      if (
        ['signin-start', 'connect', 'connect-gateway', 'disconnect', 'start-managed'].includes(
          action.action
        )
      ) {
        this.prompt = null;
        this.inputs = {};
      }
      if (reply.candidates) this.candidates = reply.candidates;
      else if (
        ['connect', 'connect-gateway', 'disconnect', 'start-managed'].includes(action.action)
      )
        this.candidates = [];
      if (
        ['signin-cancel', 'connect', 'connect-gateway', 'disconnect', 'start-managed'].includes(
          action.action
        )
      )
        this.signIn = undefined;
      if (reply.state.access === 'use') {
        this.signIn = undefined;
        this.discovered = [];
        this.prompt = null;
        this.inputs = {};
      }
      if (action.action !== 'inspect') changes++;
      return true;
    } catch (error) {
      this.problem = error instanceof Error ? error.message : String(error);
      return false;
    } finally {
      this.busy = false;
      this.loading = false;
    }
  }

  async refresh() {
    if (this.busy) return;
    const signIn = this.signIn;
    if (this.state?.access !== 'use' && signIn && magpieSignInActive(signIn.state)) {
      await this.act({ action: 'signin-status', id: signIn.id });
    } else await this.load();
  }
}
