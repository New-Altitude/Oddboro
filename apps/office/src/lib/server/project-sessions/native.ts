// An owner's native client uses the owner's project and provider settings.
// Pass the desktop environment it needs, without the office database or run credentials.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';
import { claudeCommand, npmCommand, currentSystem, type System } from '@oddboro/ledger/platform';

const codexPlain = (): [string, string[]] => ['codex', []];
/** How each system starts Codex. On Windows npm installs it behind a shim. */
const CODEX: Record<System, () => [string, string[]]> = {
  mac: codexPlain,
  linux: codexPlain,
  windows: () => npmCommand('codex', ['@openai', 'codex']) ?? codexPlain()
};

export const nativeCommand = (agent: 'claude' | 'codex'): [string, string[]] =>
  agent === 'claude' ? claudeCommand() : CODEX[currentSystem() ?? 'linux']();
export { nativeProjectEnv as nativeEnv } from '../run-env-allow.ts';
export async function projectFolder(path: string) {
  if (!isAbsolute(path)) throw new Error('Choose an absolute project folder.');
  const folder = await realpath(path);
  if (!(await stat(folder)).isDirectory()) throw new Error('Choose a folder.');
  return folder;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a reference in this worktree again on delivery, including symlinks. */
export async function projectInput(folder: string, prompt: string, file?: string | null) {
  if (!file) return { text: prompt, input: [{ type: 'text', text: prompt }] };
  if (isAbsolute(file)) throw new Error('Use a file path relative to this project.');
  const path = await realpath(resolve(folder, file));
  const name = relative(folder, path);
  if (
    name === '..' ||
    name.startsWith('..' + sep) ||
    isAbsolute(name) ||
    !(await stat(path)).isFile()
  )
    throw new Error('Choose a file inside this project.');
  const text = prompt + '\n\nProject file: ' + JSON.stringify(name);
  const input: ({ type: 'text'; text: string } | { type: 'localImage'; path: string })[] = [
    { type: 'text', text }
  ];
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extname(path).toLowerCase()))
    input.push({ type: 'localImage', path });
  return { text, input };
}
