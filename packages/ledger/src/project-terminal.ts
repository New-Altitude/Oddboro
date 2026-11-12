import { currentPlatform } from './platform.ts';
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

export async function openProjectTerminal(
  file: string,
  args: string[],
  options: IBasePtyForkOptions
): Promise<IPty> {
  const { spawn } = await nodePty();
  if (currentPlatform() !== 'win32') return spawn(file, args, options);
  const terminal = spawn(file, args, { ...options, useConptyDll: true }) as WindowsPty;
  terminal.onExit(() => {
    // The child is already gone. Release its input pipe and output worker
    // without sending a kill to a process ID that Windows could have reused.
    terminal._agent.inSocket.destroy();
    terminal._agent._conoutSocketWorker.dispose();
  });
  return terminal;
}
