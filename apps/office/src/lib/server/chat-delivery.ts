// The delivery a chat answers. Saving a turn and running it check the same
// ownership and read the same current task, ask or report.
import { ask as askById, task as taskById, report as reportById } from '@oddboro/ledger';
import { fixedError } from '@oddboro/ledger/errors';
import { askReplaced, stepAnswer } from '@oddboro/ledger/desk-answers';
import type { ChatRef } from '#lib/staff/chat.ts';
import { ACT_WRITE } from './house.ts';

/** What the staffer needs to know about the delivery the owner is replying about. */
export async function replyBrief(
  id: string,
  re: Pick<ChatRef, 'kind' | 'id'>
): Promise<{ ref: ChatRef; brief: string }> {
  switch (re.kind) {
    case 'ask': {
      const a = await askById(re.id);
      if (a?.staffId !== id) throw fixedError('No such ask from this Odd');
      return {
        ref: { kind: 'ask', id: a.id, title: a.title },
        brief: [
          `({owner} is replying about your ask #${a.id}, "${a.title}", which is ${a.status === 'open' ? 'still open' : a.status}.`,
          `- Why: ${a.why}`,
          `- If approved: ${a.ifApproved}`,
          // A replaced ask holds the office's words, and this line would say the owner wrote them.
          ...(a.reason && !askReplaced(a) ? [`- Their reason: ${a.reason}`] : []),
          ')'
        ].join('\n')
      };
    }
    case 'task': {
      const t = await taskById(re.id);
      if (t?.staffId !== id) throw fixedError('No such task from this Odd');
      return {
        ref: { kind: 'task', id: t.id, title: t.title },
        brief: [
          `({owner} is replying about the task you gave them, "${t.title}", which is ${t.status === 'open' ? 'still open' : t.status}.`,
          `- Why: ${t.why}`,
          ...t.steps.map((st, i) => {
            const answer = stepAnswer(st);
            return `- Step ${i + 1}: ${st.text}${st.done ? ' (done)' : ''}${answer ? `. Their answer: ${answer}` : ''}`;
          }),
          ...(t.note ? [`- Their note: ${t.note}`] : []),
          ')'
        ].join('\n')
      };
    }
    case 'report': {
      const r = await reportById(re.id);
      if (r?.staffId !== id) throw fixedError('No such report from this Odd');
      return {
        ref: { kind: 'report', id: r.id, title: r.title },
        brief: [
          `({owner} is replying about your report "${r.title}". If it is feedback, act on it: work inside the office now, raise_ask before changing one of your jobs, or anything outside the office ${ACT_WRITE}, and give_owner_a_task for anything only they can do.`,
          '',
          'The report:',
          '',
          r.body.slice(0, 8000),
          ')'
        ].join('\n')
      };
    }
    default: {
      const missed: never = re.kind;
      throw new Error(`No reply brief for a ${String(missed)}`);
    }
  }
}
