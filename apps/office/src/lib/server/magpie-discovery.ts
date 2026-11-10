import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { object } from './magpie-http.ts';

export type MagpieAppAccess =
  | { status: 'absent' }
  | { status: 'authorization-required'; managementUrl?: string; reason: 'disabled' | 'unavailable' }
  | { status: 'available'; managementUrl: string; key: string };

/** The official installed app config path. Portable copies require an explicit config directory. */
export function magpieConfigDirectory(): string {
  const configured = process.env.ODDBORO_MAGPIE_CONFIG_DIR;
  if (configured !== undefined) {
    if (!isAbsolute(configured)) throw new Error('Invalid Magpie config directory');
    return configured;
  }
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && isAbsolute(xdg) ? xdg : join(homedir(), '.config'), 'magpie');
}

/** Read only Magpie's official Browser access descriptor, never a credential store or service unit. */
export function magpieAppAccess(directory?: string): MagpieAppAccess {
  let fd: number | undefined;
  try {
    const folder = resolve(directory ?? magpieConfigDirectory());
    // Refuse links in the path too. Windows file ACLs cannot be proved by Node's mode bits.
    let part = folder;
    while (part !== parse(part).root) {
      if (lstatSync(part).isSymbolicLink())
        return { status: 'authorization-required', reason: 'unavailable' };
      part = dirname(part);
    }
    const file = join(folder, 'web-page.json');
    if (!lstatSync(file).isFile())
      return { status: 'authorization-required', reason: 'unavailable' };
    if (process.platform === 'win32')
      return { status: 'authorization-required', reason: 'unavailable' };
    // A file can be replaced after lstat. Nonblocking open avoids a FIFO hang;
    // fstat below checks the opened object before reading any pairing credential.
    fd = openSync(
      file,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0)
    );
    const info = fstatSync(fd);
    if (
      !info.isFile() ||
      info.size > 4096 ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o077) !== 0
    )
      return { status: 'authorization-required', reason: 'unavailable' };
    const buffer = Buffer.alloc(4097);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    if (count > 4096) return { status: 'authorization-required', reason: 'unavailable' };
    const value = object(JSON.parse(buffer.subarray(0, count).toString('utf8')));
    const port = value.port === undefined || value.port === 0 ? 3430 : value.port;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535)
      return { status: 'authorization-required', reason: 'unavailable' };
    const managementUrl = `http://127.0.0.1:${port}`;
    if (value.mode === '' || value.mode === undefined)
      return { status: 'authorization-required', managementUrl, reason: 'disabled' };
    if (
      !['local', 'lan'].includes(String(value.mode)) ||
      typeof value.key !== 'string' ||
      !/^[A-Za-z0-9._~-]{16,4096}$/.test(value.key)
    )
      return { status: 'authorization-required', managementUrl, reason: 'unavailable' };
    return { status: 'available', managementUrl, key: value.key };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'absent' }
      : { status: 'authorization-required', reason: 'unavailable' };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
