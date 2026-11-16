// An owner's native client uses the owner's project and provider settings.
// Pass the desktop environment it needs, without the office database or run credentials.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';
import { expandHome } from '@oddboro/ledger';
import {
  claudeCommand,
  npmCommand,
  currentPlatform,
  currentSystem,
  type System
} from '@oddboro/ledger/platform';

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
  let folder: string;
  try {
    folder = await realpath(path);
  } catch (e) {
    // A path through a file says ENOTDIR on a Mac and Linux, and may say
    // ENOENT on Windows: either way, no such folder is there.
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR')
      throw new Error('That folder is not there. Check the path, such as ~/my-project.');
    throw e;
  }
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

/**
 * The systems where connect's `move` ends a conversation's terminal session and
 * resumes it in the background. Add 'windows' when a Windows hand walk shows
 * an idle terminal session, ended from outside, resumes whole under the same id.
 */
export const MOVE_SYSTEMS: ReadonlySet<System> = new Set<System>(['mac', 'linux']);

/** Whether connect's `move` works on this computer: the one test of `MOVE_SYSTEMS`. */
export function canMoveHere(): boolean {
  const system = currentSystem();
  return system !== undefined && MOVE_SYSTEMS.has(system);
}
