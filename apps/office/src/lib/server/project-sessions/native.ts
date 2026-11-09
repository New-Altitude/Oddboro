// An owner's native client uses the owner's project and provider settings.
// Pass the desktop environment it needs, without the office database or run credentials.
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, extname } from 'node:path';
import { claudeCommand, npmCommand } from '@oddboro/ledger/platform';

export const nativeCommand = (agent: 'claude' | 'codex'): [string, string[]] =>
  agent === 'claude'
    ? claudeCommand()
    : process.platform === 'win32'
      ? (npmCommand('codex', ['@openai', 'codex']) ?? ['codex', []])
      : ['codex', []];
export function nativeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LC_.*|TERM.*|COLORTERM|TMP|TEMP|TMPDIR|USERPROFILE|SYSTEMROOT|WINDIR|PATHEXT|COMSPEC|APPDATA|LOCALAPPDATA|PROGRAMFILES.*|HOMEDRIVE|HOMEPATH|XDG_.*|SSH_AUTH_SOCK|DISPLAY|WAYLAND_DISPLAY|DBUS_SESSION_BUS_ADDRESS|HTTPS?_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS|CODEX_HOME|CLAUDE_CONFIG_DIR|ANTHROPIC_API_KEY|OPENAI_API_KEY|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)|AWS_PROFILE|AWS_REGION|GOOGLE_CLOUD_PROJECT)$/i.test(
        key
      )
    )
      env[key] = value;
  }
  return env;
}
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
