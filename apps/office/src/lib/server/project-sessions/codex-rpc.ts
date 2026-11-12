// One authenticated loopback App Server for the office and its native terminal.
// App Server owns the user's threads. The office owns only its child and this connection.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { stat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { nativeCommand, nativeEnv } from './native.ts';

export type RpcMessage = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message: string };
};
type Waiter = { finish: (value: unknown) => void; fail: (e: Error) => void };
export class CodexRpc {
  private nextId = 0;
  private waiting = new Map<number, Waiter>();
  private socket: WebSocket;
  private child?: ChildProcess;
  readonly url: string;
  private token: string;
  constructor(
    url: string,
    token: string,
    socket: WebSocket,
    child: ChildProcess | undefined,
    receive: (m: RpcMessage) => void,
    closed: () => void
  ) {
    this.url = url;
    this.token = token;
    this.socket = socket;
    this.child = child;
    socket.on('message', (data) => {
      let msg: RpcMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.method) {
        receive(msg);
        return;
      }
      const pending = typeof msg.id === 'number' ? this.waiting.get(msg.id) : undefined;
      if (pending) {
        this.waiting.delete(msg.id as number);
        if (msg.error) pending.fail(new Error(msg.error.message));
        else pending.finish(msg.result);
      }
    });
    socket.once('close', () => {
      for (const w of this.waiting.values()) w.fail(new Error('Codex disconnected.'));
      this.waiting.clear();
      child?.kill();
      closed();
    });
  }
  terminal(id: string) {
    return {
      args: [
        '--remote',
        this.url,
        ...(this.token ? ['--remote-auth-token-env', 'ODDBORO_TERMINAL_LINK'] : []),
        'resume',
        id
      ],
      env: { ODDBORO_TERMINAL_LINK: this.token }
    };
  }
  send(msg: RpcMessage) {
    this.socket.send(JSON.stringify(msg));
  }
  request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.waiting.delete(id);
          reject(new Error(method + ' timed out. Check the session before retrying.'));
        },
        ['thread/start', 'thread/resume', 'thread/list'].includes(method) ? 120_000 : 30_000
      );
      this.waiting.set(id, {
        finish: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        fail: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.waiting.delete(id);
        reject(e);
      }
    });
  }
  close() {
    this.socket.close();
    this.child?.kill();
  }
}
async function loopbackPort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port.');
  return address.port;
}
async function connect(url: string, token: string) {
  const ws = new WebSocket(url, {
    headers: { Authorization: 'Bearer ' + token },
    handshakeTimeout: 900
  });
  await once(ws, 'open');
  return ws;
}
export async function startCodex(receive: (m: RpcMessage) => void, closed: () => void) {
  const url = 'ws://127.0.0.1:' + (await loopbackPort()),
    token = randomBytes(32).toString('hex');
  const [exe, prefix] = nativeCommand('codex');
  const child = spawn(
    exe,
    [
      ...prefix,
      'app-server',
      '--listen',
      url,
      '--ws-auth',
      'capability-token',
      '--ws-token-sha256',
      createHash('sha256').update(token).digest('hex')
    ],
    { env: nativeEnv(), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true }
  );
  const stop = () => {
    child.kill();
  };
  process.once('exit', stop);
  child.once('close', () => process.off('exit', stop));
  let why = '';
  child.on('error', (e) => {
    why = e.message;
  });
  child.stderr?.on('data', (s: Buffer) => {
    why = (why + s.toString()).slice(-1500);
  });
  try {
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null || child.signalCode || !child.pid)
        throw new Error('Codex App Server could not start. ' + why);
      const ws = await connect(url, token).catch(() => undefined);
      if (ws) {
        const rpc = new CodexRpc(url, token, ws, child, receive, closed);
        await rpc.request('initialize', { clientInfo: { name: 'oddboro', version: '1' } });
        rpc.send({ method: 'initialized' });
        return rpc;
      }
      await delay(100);
    }
    throw new Error('The local Codex App Server did not answer.');
  } catch (e) {
    child.kill();
    throw e;
  }
}

/** Connect to a socket the owner selected. Disconnecting closes our client only. */
export async function joinCodex(
  path: string,
  receive: (m: RpcMessage) => void,
  closed: () => void
) {
  if (!isAbsolute(path) || path.includes(':') || process.getuid === undefined)
    throw new Error('Choose a local Codex Unix socket.');
  const socketPath = await realpath(path);
  const [file, parent] = await Promise.all([stat(socketPath), stat(dirname(socketPath))]);
  if (
    !file.isSocket() ||
    file.uid !== process.getuid() ||
    parent.uid !== process.getuid() ||
    (parent.mode & 0o077) !== 0
  )
    throw new Error('Choose a Codex socket in a private folder you own.');
  const ws = new WebSocket('ws+unix://' + socketPath + ':/', { handshakeTimeout: 2000 });
  await once(ws, 'open');
  const rpc = new CodexRpc('unix://' + socketPath, '', ws, undefined, receive, closed);
  try {
    await rpc.request('initialize', { clientInfo: { name: 'oddboro', version: '1' } });
    rpc.send({ method: 'initialized' });
    return rpc;
  } catch (e) {
    rpc.close();
    throw e;
  }
}
