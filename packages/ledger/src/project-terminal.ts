import { currentPlatform } from './platform.ts';
import { spawn, type IBasePtyForkOptions, type IPty } from 'node-pty';

// node-pty 1.1.0 exposes no public release method after a Windows child exits.
// Keep its two internal cleanup calls here. Recheck them before changing the pin.
// See https://github.com/microsoft/node-pty/issues/965.
type WindowsPty = IPty & {
  _agent: { inSocket: { destroy(): void }; _conoutSocketWorker: { dispose(): void } };
};

export function openProjectTerminal(file: string, args: string[], options: IBasePtyForkOptions) {
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
