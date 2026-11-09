// npm's macOS prebuild carries spawn-helper as data. It has to be executable
// before the native terminal starts and before the desktop bundle is signed.
import { chmodSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export function preparePty(root) {
  if (process.platform === 'win32') return [];
  const req = createRequire(join(resolve(root), 'package.json'));
  const pkg = dirname(req.resolve('node-pty/package.json'));
  const files = [];
  for (const folder of ['build/Release', 'prebuilds/' + process.platform + '-' + process.arch]) {
    const helper = join(pkg, folder, 'spawn-helper'),
      lib = join(pkg, folder, 'pty.node');
    if (existsSync(helper)) {
      chmodSync(helper, 0o755);
      files.push(helper);
    }
    if (existsSync(lib)) files.push(lib);
  }
  return files;
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) preparePty(process.cwd());
