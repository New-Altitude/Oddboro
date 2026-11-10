// Verify the exact worker and notices the office build hands the desktop.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function assertPiBundle(build: string): void {
  const read = (name: string) => readFileSync(join(build, name));
  const manifest = JSON.parse(read('pi-worker-integrity.json').toString()) as {
    version?: unknown;
    workerSha256?: unknown;
    licensesSha256?: unknown;
  };
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const worker = read('pi-worker.cjs');
  const notices = read('pi-worker-licenses.json');
  if (
    !worker.length ||
    manifest.version !== 1 ||
    manifest.workerSha256 !== sha(worker) ||
    manifest.licensesSha256 !== sha(notices)
  )
    throw new Error('The bundled Pi worker or its license notices do not match the office build.');
  const packages = JSON.parse(notices.toString()) as {
    name?: string;
    version?: string;
    notices?: unknown[];
  }[];
  for (const [name, version] of [
    ['@earendil-works/pi-agent-core', '1.5.0'],
    ['@earendil-works/pi-ai', '1.5.0'],
    ['@modelcontextprotocol/sdk', '1.32.2']
  ])
    if (!packages.some((p) => p.name === name && p.version === version && p.notices?.length))
      throw new Error(`The Pi worker license inventory is missing ${name}@${version}.`);
}
