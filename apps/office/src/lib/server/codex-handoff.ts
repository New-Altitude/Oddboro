// The source prepares a private packet. Its link opens a preview. Only the
// owner's click in the receiving chat keeps the turn.
import { error } from '@sveltejs/kit';
import { allGoals, home, manager } from '@oddboro/ledger';
import { readPacket } from '@oddboro/ledger/codex-handoff';
import { ChatInputError } from './chat-files.ts';
import { history, keepOwnerTurn, type ChatEntry } from './staff.ts';

function packetFor(ticket: string) {
  try {
    return readPacket(home(), ticket);
  } catch {
    error(404, 'This handoff is unavailable. Open a fresh link from Codex.');
  }
}

async function destination() {
  const who = await manager();
  if (!who) error(409, 'Finish choosing your Office Manager, then reopen this link.');
  return who;
}

export async function previewHandoff(ticket: string) {
  const packet = packetFor(ticket);
  const who = await destination();
  const prior = history(who.id).filter(
    (e) => e.from === 'owner' && e.source?.kind === 'Codex' && e.source.id === packet.id
  );
  const saved = prior.find((e) => e.source?.revision === packet.revision);
  const goals = (await allGoals())
    .filter((g) => g.status === 'active')
    .map(({ id, title }) => ({ id, title }));
  // A preview fits on the page even for a long source file. The turn keeps every byte.
  const opening = Buffer.from(packet.files[0].data.slice(0, 8192), 'base64').toString('utf8');
  return {
    ticket,
    staff: who.id,
    title: packet.title,
    revision: packet.revision,
    files: packet.files.map((f) => f.name),
    excerpt: opening.length > 2000 ? opening.slice(0, 2000) + '…' : opening,
    goals,
    previous: prior.at(-1)?.turnId,
    saved: saved?.turnId
  };
}

// Two open tabs can accept together. Only the one that keeps the turn asks for a reply.
const keeping = new Map<string, Promise<ChatEntry>>();

export async function acceptHandoff(
  staff: string,
  ticket: string,
  revision: string,
  goalId: unknown
) {
  const packet = packetFor(ticket);
  if (packet.revision !== revision) error(409, 'The selection changed. Reopen its link.');
  if ((await destination()).id !== staff)
    error(409, 'The Office Manager changed. Reopen the link.');
  // A revision is over the source ID, selected bytes, names, notes and title.
  // Its first 128 bits give this version one repeatable turn ID, even when
  // two tabs accept it together. Older versions keep their own turns.
  const turnId = packet.revision
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  const goal =
    goalId === null
      ? undefined
      : (await allGoals()).find((g) => g.status === 'active' && g.id === goalId);
  const old = history(staff).find(
    (e) =>
      e.from === 'owner' &&
      e.turnId === turnId &&
      e.source?.id === packet.id &&
      e.source.revision === revision
  );
  if (old) return { line: old, added: false };
  const key = staff + ':' + turnId;
  const pending = keeping.get(key);
  if (pending) return { line: await pending, added: false };
  if (goalId !== null && !goal) error(409, 'That goal is no longer active. Reopen the link.');
  const saving = keepOwnerTurn(staff, {
    turnId,
    message: [
      packet.title + ' · from Codex',
      ...(goal ? ['Goal #' + goal.id + ': ' + goal.title] : []),
      'Pick up this work. Read the selected material and carry its decisions and open questions forward.'
    ].join('\n'),
    source: { kind: 'Codex', id: packet.id, revision },
    files: packet.files.map(({ name, data }) => ({ name, bytes: Buffer.from(data, 'base64') }))
  });
  keeping.set(key, saving);
  try {
    return { line: await saving, added: true };
  } catch (e) {
    if (e instanceof ChatInputError) error(400, e.message);
    throw e;
  } finally {
    keeping.delete(key);
  }
}
