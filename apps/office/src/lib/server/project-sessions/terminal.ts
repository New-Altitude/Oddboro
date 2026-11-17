// Terminal bytes go only to the owner's session view. A tab closing detaches
// its listener; the native client stays up. Reopening replays a bounded screen history.
import { EventEmitter, once } from 'node:events';
import { openProjectTerminal } from '@oddboro/ledger/project-terminal';
import { nativeCommand, nativeEnv } from './native.ts';

type Pty = Awaited<ReturnType<typeof openProjectTerminal>>;

export class ProjectTerminal {
  readonly events = new EventEmitter();
  private child: Pty;
  private history = '';
  private ended = false;
  private writer?: string;
  /** A redraw's restore to the page's size, while it holds the wider one. */
  private restore?: ReturnType<typeof setTimeout>;
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
  /**
   * Open the native client in a terminal. The terminal library loads here, the
   * first time. A key `extra` sets to undefined is taken out of the office's
   * own environment, so the client never sees it.
   */
  static async open(
    agent: 'codex' | 'claude',
    args: string[],
    cwd: string,
    extra: Record<string, string | undefined> = {}
  ) {
    const [exe, prefix] = nativeCommand(agent);
    const env = Object.fromEntries(
      Object.entries({ ...nativeEnv(), ...extra, TERM: 'xterm-256color' }).filter(
        (e): e is [string, string] => e[1] !== undefined
      )
    );
    return new ProjectTerminal(
      await openProjectTerminal(exe, [...prefix, ...args], {
        cwd,
        env,
        cols: 100,
        rows: 30,
        name: 'xterm-256color'
      })
    );
  }
  private constructor(child: Pty) {
    this.child = child;
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
    // A size from the page is the newest, so a redraw's pending restore to an
    // older one is dropped.
    clearTimeout(this.restore);
    this.restore = undefined;
    if (!this.ended) this.child.resize(cols, rows);
  }
  /**
   * Draws the program again for this window at the size it already has: one
   * column wider, then back to `cols` 30 ms later. An equal size sends the
   * program no resize signal. A program that draws again when the size it
   * reads changes sees no change if the wider size is undone in the same
   * moment, as terminal.test.ts shows with a Node child, so the wider size is
   * held. A size that comes during the hold is newer and replaces the restore.
   */
  redraw(cols: number, rows: number) {
    this.resize(cols + 1, rows);
    this.restore = setTimeout(() => this.resize(cols, rows), 30);
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
    clearTimeout(this.restore);
    if (!this.ended) this.child.kill();
  }
}
