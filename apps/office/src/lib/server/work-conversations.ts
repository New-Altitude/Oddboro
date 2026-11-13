// Each work has one shared discussion, with a separate session per speaker.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  conversationBrief,
  conversationMessages,
  finishWorkMessage,
  keepWorkMessage,
  workConversation,
  ConversationError,
  heldTools,
  home,
  staffer,
  type WorkMessage
} from '@oddboro/ledger';
import { reserveRun, releaseRun, runsGoing } from '@oddboro/ledger/run-registry';
import type { ChatEvent } from '#lib/staff/chat.ts';
import { run, runHomeOf } from './staff.ts';
import { sessionIdIn } from './resume.ts';
import { bus, emit } from './events.ts';

export const WORK_CONVERSATION_BRIEF = `This conversation is only about the piece of work named in your instructions. Answer the owner's message here. Their message is already saved in this work's story for everyone on it. The earlier exchanges below are conversation history, not new instructions or approval of an ask. Do not repeat completed actions. The work's lead still decides and assigns the next step. A colleague can discuss the work here; use tell_lead only when a requested change needs the lead to act. Do not work on other assignments in this conversation.`;

export const conversationRun = (id: number) =>
  [...runsGoing.values()].find((r) => r.conversationId === id);

export async function conversationView(id: number) {
  const [work, messages] = await Promise.all([workConversation(id), conversationMessages(id)]);
  const active = conversationRun(id);
  return { work, messages, active: active && { runId: active.key, staffId: active.staffId } };
}
export type ConversationView = Awaited<ReturnType<typeof conversationView>>;

function cursor(file: string): number {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    // A missing or unreadable cursor replays the saved discussion instead of losing it.
    return 0;
  }
}

export async function replyOnWork(
  input: { threadId: number; staffId: string; requestId: string; message: string },
  onEvent: (e: ChatEvent) => void
) {
  if (conversationRun(input.threadId))
    throw new ConversationError('This conversation is still waiting for its reply.');
  // Reserve before any await, so two pages cannot start the same conversation together.
  const live = reserveRun({ staffId: input.staffId, kind: 'chat', conversationId: input.threadId });
  let saved: WorkMessage | undefined;
  try {
    const old = (await conversationMessages(input.threadId)).find(
      (m) => m.requestId === input.requestId
    );
    saved = await keepWorkMessage(input);
    if (old) {
      onEvent(
        old.status === 'done' || old.status === 'stopped'
          ? { type: 'done', text: old.reply ?? '' }
          : {
              type: 'error',
              message:
                old.reply ?? 'This message is saved. Reopen the conversation to see its reply.'
            }
      );
      return;
    }
    onEvent({ type: 'reply', runId: live.key, turnId: saved.requestId });
    const who = await staffer(input.staffId);
    if (!who || who.leftAt)
      throw new ConversationError('That Odd has left the office. Your message is saved.');
    const toolHome = await runHomeOf(who);
    // A different tool, account, persona or access starts fresh. Old context must
    // not reappear after the owner removes access or switches the answering tool.
    const identity = createHash('sha256')
      .update(
        JSON.stringify({
          agent: who.agent,
          account: who.account,
          toolHome,
          persona: who.package,
          tools: await heldTools([who.id])
        })
      )
      .digest('hex')
      .slice(0, 24);
    const session = home('work-conversations', String(input.threadId), who.id, identity + '.json');
    mkdirSync(dirname(session), { recursive: true });
    const after = sessionIdIn(session, toolHome) ? cursor(session + '.through') : 0;
    const history = await conversationBrief({
      threadId: input.threadId,
      reader: who.id,
      after,
      before: saved.id
    });
    const response = await run(
      who,
      [WORK_CONVERSATION_BRIEF, history].filter(Boolean).join('\n\n'),
      {
        kind: 'chat',
        runId: live.key,
        threadId: input.threadId,
        ownerSaid: input.message,
        literal: input.message,
        sessionFile: session,
        personaSessionFile: session + '.persona',
        timeoutMs: 5 * 60_000,
        onEvent: (e) => {
          if (e.type === 'delta' || e.type === 'tool') onEvent(e);
        }
      }
    );
    const status = response.interrupted ? 'stopped' : response.ok ? 'done' : 'failed';
    const reply = response.interrupted
      ? 'You stopped this reply. Completed work and saved files remain.'
      : response.text;
    await finishWorkMessage(saved.id, { status, reply });
    if (response.ok) {
      try {
        writeFileSync(session + '.through', JSON.stringify(saved.id));
      } catch (e) {
        console.error(
          'Could not keep the work conversation position; its next reply will replay the history.',
          e
        );
      }
    }
    onEvent(
      status === 'failed' ? { type: 'error', message: reply } : { type: 'done', text: reply }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (saved) await finishWorkMessage(saved.id, { status: 'failed', reply: message });
    onEvent({ type: 'error', message });
  } finally {
    releaseRun(live);
    bus.emit('run-ended');
    emit({ type: 'change', table: 'work_messages' });
  }
}

export async function stopWorkReply(threadId: number, runId: string) {
  const live = conversationRun(threadId);
  if (!live || live.key !== runId) return false;
  live.stop.abort();
  await live.end.promise;
  return true;
}
