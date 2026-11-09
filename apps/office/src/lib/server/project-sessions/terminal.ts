// Terminal bytes go only to the owner's session view. A tab closing detaches
// its listener; the native client stays up. Reopening replays a bounded screen history.
import { EventEmitter, once } from 'node:events';
import { spawn, type IPty } from 'node-pty';
import { nativeCommand, nativeEnv } from './native.ts';

export class ProjectTerminal {
  readonly events = new EventEmitter();
  private child: IPty;
  private history = '';
  private ended = false;
  private writer?: string;
  take(view: string, replace = false) {
    if (!this.writer || replace) {
      this.writer = view;
      this.events.emit('control');
    }
    return this.writer === view;
  }
  controls(view: string) {
    return this.writer === view;
  }
  release(view: string) {
    if (this.writer === view) {
      this.writer = undefined;
      this.events.emit('control');
    }
  }
  requireControl(view: string) {
    if (!this.controls(view)) throw new Error('Take control of the terminal in this window first.');
    return this;
  }

  get screen() {
    return this.history;
  }
  get running() {
    return !this.ended;
  }
  constructor(
    agent: 'codex' | 'claude',
    args: string[],
    cwd: string,
    extra: Record<string, string> = {}
  ) {
    const [exe, prefix] = nativeCommand(agent);
    this.child = spawn(exe, [...prefix, ...args], {
      cwd,
      env: { ...nativeEnv(), ...extra, TERM: 'xterm-256color' },
      cols: 100,
      rows: 30,
      name: 'xterm-256color'
    });
    const stop = () => this.close();
    process.once('exit', stop);
    this.child.onData((s) => {
      this.history = (this.history + s).slice(-240000);
      this.events.emit('data', s);
    });
    this.child.onExit(({ exitCode }) => {
      process.off('exit', stop);
      this.ended = true;
      this.events.emit('exit', exitCode);
    });
  }
  write(text: string) {
    if (this.ended) throw new Error('Reopen this terminal.');
    this.child.write(text);
  }
  resize(cols: number, rows: number) {
    if (!this.ended) this.child.resize(cols, rows);
  }
  async releaseProcess() {
    if (this.ended) return;
    const ended = once(this.events, 'exit', { signal: AbortSignal.timeout(12000) });
    this.close();
    try {
      await ended;
    } catch {
      throw new Error('The native terminal is still closing. Wait before reconnecting.');
    }
  }
  close() {
    if (!this.ended) this.child.kill();
  }
}
