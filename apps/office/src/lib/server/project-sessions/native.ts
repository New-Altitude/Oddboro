// An owner's native client uses the owner's project and provider settings.
// Pass the desktop environment it needs, without the office database or run credentials.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';
import { expandHome } from '@oddboro/ledger';
import { claudeCommand, npmCommand, currentPlatform } from '@oddboro/ledger/platform';

export const nativeCommand = (agent: 'claude' | 'codex'): [string, string[]] =>
  agent === 'claude'
    ? claudeCommand()
    : currentPlatform() === 'win32'
      ? (npmCommand('codex', ['@openai', 'codex']) ?? ['codex', []])
      : ['codex', []];
export { nativeProjectEnv as nativeEnv } from '../run-env-allow.ts';
/** The real path of the project folder the owner typed, `~` read as the home folder. */
export async function projectFolder(typed: string) {
  const path = expandHome(typed);
  if (!isAbsolute(path)) throw new Error('Choose a folder by its full path, such as ~/my-project.');
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
