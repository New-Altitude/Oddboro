// The conversation belongs to the work. Its messages never enter the main chat.
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db.ts';
import { staff, workMessages } from './schema.ts';
import { thread } from './threads.ts';
import { fileReaders, heldTools, lacking } from './sharing.ts';

export type WorkMessage = typeof workMessages.$inferSelect;
export class ConversationError extends Error {}

export async function workConversation(id: number) {
  const work = await thread(id);
  if (!work) throw new ConversationError('That piece of work no longer exists.');
  const { readers } = await fileReaders(work);
  const people = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(and(inArray(staff.id, [...readers]), isNull(staff.leftAt)))
    .orderBy(asc(staff.hiredAt));
  return { id, title: work.title, lead: work.hubId, stopped: work.status === 'stopped', people };
}

export async function conversationMessages(id: number): Promise<WorkMessage[]> {
  return db
    .select()
    .from(workMessages)
    .where(eq(workMessages.threadId, id))
    .orderBy(asc(workMessages.id));
}

/** The request ID is global so a delayed retry cannot become a message on another work. */
export async function keepWorkMessage(input: {
  threadId: number;
  staffId: string;
  requestId: string;
  message: string;
}): Promise<WorkMessage> {
  const [old] = await db
    .select()
    .from(workMessages)
    .where(eq(workMessages.requestId, input.requestId));
  if (old) {
    if (
      old.threadId !== input.threadId ||
      old.staffId !== input.staffId ||
      old.message !== input.message
    )
      throw new ConversationError('This message ID already belongs to another message.');
    return old;
  }
  const work = await workConversation(input.threadId);
  if (work.stopped)
    throw new ConversationError('This work is stopped. Its conversation is still here to read.');
  if (!work.people.some((p) => p.id === input.staffId))
    throw new ConversationError('Choose an Odd who works on this.');
  const tools = (await heldTools([input.staffId])).map(({ id, name }) => ({ id, name }));
  const [saved] = await db
    .insert(workMessages)
    .values({ ...input, tools })
    .onConflictDoNothing()
    .returning();
  // Concurrent submissions of the same ID must agree too.
  return saved ?? keepWorkMessage(input);
}

export async function finishWorkMessage(
  id: number,
  result: { status: WorkMessage['status']; reply: string }
) {
  await db
    .update(workMessages)
    .set({ ...result, endedAt: new Date() })
    .where(eq(workMessages.id, id));
}

/** A stopped process never starts the same work again on the next launch. */
export async function closeStaleConversations() {
  await db
    .update(workMessages)
    .set({
      status: 'failed',
      reply: 'The office closed before this reply finished. Your message is saved.',
      endedAt: new Date()
    })
    .where(eq(workMessages.status, 'replying'));
}

/** Every participant's next run hears the latest owner messages, without another run. */
export async function conversationSaid(id: number) {
  const rows = await db
    .select({ message: workMessages.message, createdAt: workMessages.createdAt })
    .from(workMessages)
    .where(eq(workMessages.threadId, id))
    .orderBy(desc(workMessages.id))
    .limit(10);
  return rows.reverse();
}

export const CONVERSATION_CHARS = 24_000;

/** Only exchanges not already in this participant's session. Access is checked on every read. */
export async function conversationBrief(input: {
  threadId: number;
  reader: string;
  after: number;
  before: number;
}) {
  const rows = (await conversationMessages(input.threadId)).filter(
    (r) => r.id > input.after && r.id < input.before
  );
  const people = await db.select({ id: staff.id, name: staff.name }).from(staff);
  const current = await heldTools([...new Set([input.reader, ...rows.map((r) => r.staffId)])]);
  const blocks = rows.map((r) => {
    const tools = [
      ...current,
      ...r.tools.map((t) => ({ ...t, staffId: r.staffId, inForce: false }))
    ];
    const withheld = r.staffId !== input.reader && lacking(tools, input.reader, [r.staffId]).length;
    const name = people.find((p) => p.id === r.staffId)?.name ?? r.staffId;
    return `Owner: ${r.message}\n${name}: ${r.status !== 'done' ? '(No completed reply.)' : withheld ? '(Reply withheld because it may contain tools you do not have.)' : (r.reply ?? '')}`;
  });
  const kept: string[] = [];
  let size = 0;
  for (const block of blocks.reverse()) {
    if (size + block.length > CONVERSATION_CHARS) {
      if (!kept.length) kept.unshift(block.slice(-CONVERSATION_CHARS));
      break;
    }
    kept.unshift(block);
    size += block.length;
  }
  return kept.join('\n\n');
}
