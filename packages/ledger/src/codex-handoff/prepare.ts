// A portable Codex skill. Its input is the owner's selection on stdin and the
// named files. The office reads one private packet by its random ticket.
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = 86_400_000;
// The receiving chat accepts 8 MiB including the message. Leave room for its title and goal.
const MAX = 8 * 1024 * 1024 - 2048;
type FileCopy = { name: string; data: string };
type Packet = { id: string; title: string; files: FileCopy[] };

function regularFile(path: string, limit: number): Buffer {
  if (process.platform === 'win32' && /^[\\/]{2}/.test(path)) throw Error('Choose a local file.');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit)
    throw Error('Choose one regular file within the handoff size limit.');
  const fd = openSync(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK
  );
  try {
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > limit ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev
    )
      throw Error('The file changed. Select it again.');
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function inbox(office: string): string {
  const dir = join(office, 'codex-handoffs');
  if (!lstatSync(dir).isDirectory()) throw Error('The handoff folder is unavailable.');
  return dir;
}

/** The office reads only the packet named by a source-created link. */
export function readPacket(office: string, ticket: string) {
  if (!UUID.test(ticket)) throw Error('Invalid handoff link.');
  const path = join(inbox(office), ticket);
  if (Date.now() - lstatSync(path).mtimeMs > DAY) throw Error('The handoff link expired.');
  const bytes = regularFile(path, MAX * 2);
  const packet: Packet = JSON.parse(bytes.toString('utf8'));
  if (
    typeof packet?.id !== 'string' ||
    typeof packet.title !== 'string' ||
    !Array.isArray(packet.files) ||
    !packet.files.length ||
    packet.files.length > 8 ||
    packet.files.some((f) => typeof f?.name !== 'string' || typeof f.data !== 'string')
  )
    throw Error('Unreadable handoff.');
  return { ...packet, revision: createHash('sha256').update(bytes).digest('hex') };
}

async function prepare() {
  const thread = process.env.CODEX_THREAD_ID ?? '';
  if (!UUID.test(thread)) throw Error('Run this in the Codex chat holding the selection.');
  const input: Buffer[] = [];
  let size = 0;
  for await (const part of process.stdin) {
    size += part.length;
    if (size > MAX * 6 + 2048) throw Error('The selection is too large.');
    input.push(part);
  }
  const { key, title, text, notes } = JSON.parse(Buffer.concat(input).toString('utf8'));
  if (typeof key !== 'string' || !/^[a-z0-9][a-z0-9-]{0,59}$/.test(key))
    throw Error('Give this selection a short name in lowercase letters, numbers and hyphens.');
  if (typeof title !== 'string' || !title.trim() || title.length > 140 || /[\r\n]/.test(title))
    throw Error('Give the handoff a one-line title.');
  if (typeof text !== 'string' || !text.trim() || typeof notes !== 'string')
    throw Error('Supply the exact selected text and its handoff notes.');
  const files: FileCopy[] = [];
  let total = 0;
  function add(name: string, bytes: Buffer) {
    if (files.length === 8)
      throw Error('Choose up to eight files including the selection and notes.');
    total += bytes.length;
    if (total > MAX) throw Error('Fit the selection, notes and files into one 8 MiB chat turn.');
    if (files.some((f) => f.name.toLowerCase() === name.toLowerCase()))
      throw Error('Two selected files have the same name.');
    files.push({ name, data: bytes.toString('base64') });
  }
  add('Selected text.md', Buffer.from(text));
  if (notes) add('Handoff notes.md', Buffer.from(notes));
  for (const path of process.argv.slice(2)) {
    if (!/\.(md|markdown|txt|png|jpe?g|webp)$/i.test(path))
      throw Error('Choose a text file, Markdown file or screenshot.');
    add(basename(path), regularFile(path, MAX - total));
  }
  const port = Number(process.env.ODDBORO_PORT || 4500);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid office port.');
  const office = process.env.ODDBORO_HOME || join(homedir(), '.oddboro');
  mkdirSync(join(office, 'codex-handoffs'), { recursive: true, mode: 0o700 });
  const dir = inbox(office);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !UUID.test(entry.name)) continue;
    const path = join(dir, entry.name);
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (stat && Date.now() - stat.mtimeMs > DAY) {
      try {
        unlinkSync(path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
  }
  const ticket = randomUUID();
  const packet: Packet = { id: thread + '/' + key, title, files };
  writeFileSync(join(dir, ticket), JSON.stringify(packet), { flag: 'wx', mode: 0o600 });
  console.log('http://127.0.0.1:' + port + '/?handoff=' + ticket);
}

if (import.meta.main)
  prepare().catch((e: Error) => {
    console.error(e.message);
    process.exitCode = 1;
  });
