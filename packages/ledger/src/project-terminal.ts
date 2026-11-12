import { currentSystem, type System } from './platform.ts';
import type { IBasePtyForkOptions, IPty } from 'node-pty';

// node-pty is an optional native library. It loads only when the owner opens a
// project terminal in Advanced mode, so a computer where its build failed
// still installs and runs the office, and only the terminal says it cannot open.
let loading: Promise<typeof import('node-pty')> | undefined;
function nodePty() {
  loading ??= import('node-pty').catch((e: unknown) => {
    loading = undefined;
    throw new Error(
      'The project terminal could not load on this computer. Run npm install in the office folder, then open the terminal again.',
      { cause: e }
    );
  });
  return loading;
}

// node-pty 1.1.0 exposes no public release method after a Windows child exits.
// Keep its two internal cleanup calls here. Recheck them before changing the pin.
// See https://github.com/microsoft/node-pty/issues/965.
type WindowsPty = IPty & {
  _agent: { inSocket: { destroy(): void }; _conoutSocketWorker: { dispose(): void } };
};

type Spawn = typeof import('node-pty').spawn;
type Open = (spawn: Spawn, file: string, args: string[], options: IBasePtyForkOptions) => IPty;

const plain: Open = (spawn, file, args, options) => spawn(file, args, options);

/** How each system opens a terminal. A system the office does not know opens it plainly. */
const OPEN: Record<System, Open> = {
  mac: plain,
  linux: plain,
  windows: (spawn, file, args, options) => {
    const terminal = spawn(file, args, { ...options, useConptyDll: true }) as WindowsPty;
    terminal.onExit(() => {
      // The child is already gone. Release its input pipe and output worker
      // without sending a kill to a process ID that Windows could have reused.
      terminal._agent.inSocket.destroy();
      terminal._agent._conoutSocketWorker.dispose();
    });
    return terminal;
  }
};

export async function openProjectTerminal(
  file: string,
  args: string[],
  options: IBasePtyForkOptions
): Promise<IPty> {
  const { spawn } = await nodePty();
  return OPEN[currentSystem() ?? 'linux'](spawn, file, args, options);
}
