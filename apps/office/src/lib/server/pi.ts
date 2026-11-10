// Per-run adapter for Oddboro's bundled Pi worker. The worker owns no global Pi state.
import { FILES_SERVER, home } from '@oddboro/ledger';
import { isAbsolute, resolve } from 'node:path';
import type { CliRun, Launch } from './cli.ts';
import type { RunEvent } from './launch.ts';
import { piWorkerCommand } from './pi-worker-path.ts';

export type PiRun = CliRun & { sourceIdentity: string };
export type PiLaunch = Launch & { command: [string, string[]] };

/** The child gets only operating-system necessities and its inference key, never the office process's provider or admin credentials. */
function piEnv(key: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'PATH',
    'HOME',
    'USERPROFILE',
    'SYSTEMROOT',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'TZ'
  ]) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  env.ODDBORO_PI_API_KEY = key;
  return env;
}

// Staff Pi runs must use the real office file server and its private wall.
// Missing or malformed walls stop the run instead of falling back to a wider
// tool set. Bare Office runs deliberately have no file server or tools.
function hasPrivateFiles(r: PiRun): boolean {
  if (!r.allowed.includes('mcp__files')) return false;
  const files = r.servers.files;
  if (
    !files ||
    Object.keys(files).some((key) => !['command', 'args', 'env'].includes(key)) ||
    files.command !== process.execPath ||
    !Array.isArray(files.args) ||
    files.args.length !== 1 ||
    files.args[0] !== FILES_SERVER ||
    !files.env ||
    typeof files.env !== 'object' ||
    Array.isArray(files.env)
  )
    return false;
  const env = files.env as Record<string, unknown>;
  if (
    Object.keys(env).some((key) => key !== 'ODDBORO_FILES') ||
    typeof env.ODDBORO_FILES !== 'string'
  )
    return false;
  try {
    const walls = JSON.parse(env.ODDBORO_FILES) as { noAccess?: unknown };
    if (
      !Array.isArray(walls.noAccess) ||
      !walls.noAccess.length ||
      walls.noAccess.some(
        (p: unknown) => typeof p !== 'string' || !isAbsolute(p) || p.includes('\0')
      )
    )
      return false;
    const paths = new Set(walls.noAccess.map((p: string) => resolve(p)));
    return ['pi-sessions', 'magpie', 'accounts'].every((name) => paths.has(resolve(home(name))));
  } catch {
    return false;
  }
}

/** A Pi run requires an explicit Magpie connection. The inference key goes in the child environment, never its arguments or stdin. */
export function piLaunch(r: PiRun): PiLaunch | { refused: string } {
  if (!r.connection) return { refused: 'Choose a ready Magpie model for Pi.' };
  if (r.commands) return { refused: 'Pi does not run shell commands in this office.' };
  if (!r.sourceIdentity) return { refused: 'The Magpie source is unavailable.' };
  if (!r.bare && !hasPrivateFiles(r)) return { refused: 'Pi file access is not configured.' };
  const { baseUrl, model, apiKey } = r.connection;
  return {
    command: piWorkerCommand(),
    args: [],
    env: piEnv(apiKey),
    stdin: JSON.stringify({
      staffId: r.staffId,
      sourceIdentity: r.sourceIdentity,
      account: r.account,
      system: r.system,
      input: r.input,
      resume: r.resume,
      sessionDir: home('pi-sessions'),
      baseUrl,
      model,
      servers: r.bare ? {} : r.servers,
      allowed: r.bare ? [] : r.allowed,
      images: r.images ?? [],
      timeoutMs: r.timeoutMs,
      bare: !!r.bare
    }),
    done: () => {},
    read: piReader,
    ownGroup: true
  };
}

/** Convert only the worker's known event shapes to office events. */
export function piReader(e: Record<string, unknown>): RunEvent[] {
  if (e.type === 'session' && typeof e.id === 'string') return [{ type: 'session', id: e.id }];
  if (e.type === 'tool' && typeof e.name === 'string') return [{ type: 'tool', name: e.name }];
  if (e.type === 'delta' && typeof e.text === 'string')
    return [{ type: 'delta', text: e.text } as RunEvent];
  if (e.type === 'message' && typeof e.text === 'string')
    return [{ type: 'message', text: e.text }];
  if (e.type === 'failed' && typeof e.message === 'string')
    return [{ type: 'failed', message: e.message }];
  if (e.type === 'done') return [{ type: 'done' }];
  if (e.type === 'usage' && e.usage && typeof e.usage === 'object' && !Array.isArray(e.usage))
    return [{ type: 'usage', usage: e.usage as Extract<RunEvent, { type: 'usage' }>['usage'] }];
  return [];
}
