// The office runs Pi on the same Node that runs its server. In the desktop
// app this is the bundled Node sidecar; development uses Node's TS support.
import * as nativePath from 'node:path';
import { CODE } from '@oddboro/ledger';

/** Resolve either the staged worker or the source entry for a given platform. */
export function piWorkerPath(code: string, packaged: boolean, platform?: NodeJS.Platform): string {
  const path =
    platform === undefined
      ? nativePath
      : platform === 'win32'
        ? nativePath.win32
        : nativePath.posix;
  return packaged
    ? path.join(code, 'apps', 'office', 'build', 'pi-worker.cjs')
    : path.join(code, 'apps', 'office', 'src', 'lib', 'server', 'pi-worker.ts');
}

/** The bundled worker in a staged app, or its source in development. */
export function piWorkerCommand(): [string, string[]] {
  return [process.execPath, [piWorkerPath(CODE, process.env.ODDBORO_APP === '1')]];
}
