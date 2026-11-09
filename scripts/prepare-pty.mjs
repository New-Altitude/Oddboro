// node-pty loads a local build first, then the prebuild for this machine.
import { chmodSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

function runtimeFiles(pkg) {
  const windows = process.platform === 'win32';
  const names = windows
    ? [
        'conpty.node',
        'conpty/conpty.dll',
        'conpty/OpenConsole.exe',
        'conpty_console_list.node',
        'pty.node',
        'winpty-agent.exe',
        'winpty.dll'
      ]
    : process.platform === 'darwin'
      ? ['pty.node', 'spawn-helper']
      : ['pty.node'];
  const folder = ['build/Release', `prebuilds/${process.platform}-${process.arch}`].find((name) =>
    existsSync(join(pkg, name, names[0]))
  );
  if (!folder) throw new Error(`No terminal library for ${process.platform}-${process.arch}`);
  return names.map((name) => {
    const file = join(pkg, folder, name);
    if (!existsSync(file)) throw new Error(`Missing terminal runtime file: ${file}`);
    if (name === 'spawn-helper') chmodSync(file, 0o755);
    return file;
  });
}

// Fix the Mac helper's execute bit after npm install. At release these are also
// the exact files the app signs before packaging.
export function preparePty(root) {
  return runtimeFiles(join(root, 'node_modules', 'node-pty'));
}

// Only trim the staged copy. Keep the JS loader, licenses and this machine's binaries.
export function stagePty(stage) {
  const pkg = join(stage, 'node_modules', 'node-pty');
  const files = preparePty(stage);
  const keep = [
    ...files,
    ...['package.json', 'lib', 'LICENSE', 'deps/winpty/LICENSE'].map((p) => join(pkg, p))
  ];
  function trim(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (keep.includes(file)) continue;
      if (entry.isDirectory() && keep.some((p) => p.startsWith(file + sep))) trim(file);
      else rmSync(file, { recursive: true, force: true });
    }
  }
  trim(pkg);
  return files;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) preparePty(process.cwd());
