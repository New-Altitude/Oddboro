// Claim one exact edition before Gmail sees it; an unknown send is only read back.
import {
  claimResultSend,
  checkDestination,
  explainResult,
  patchEdition,
  reconnectTask,
  resultIncident,
  scheduledResult,
  staffer,
  type ScheduledResult,
  type ResultEdition
} from '@oddboro/ledger';
import { bearer } from './oauth.ts';
import { sendMail, sentEdition } from './google/gmail.ts';
import { GoogleError } from './google/http.ts';

export async function deliverResult(
  p: ScheduledResult,
  e: ResultEdition,
  { now, maySend }: { now: Date; maySend: boolean }
) {
  if (e.destination.kind !== 'gmail') return;
  const d = e.destination;
  if (e.nextCheck && e.nextCheck > now) return e.nextCheck.getTime();
  const who = await staffer(p.responsibleId);
  try {
    await checkDestination(d, p.responsibleId);
  } catch {
    await explainResult(
      p,
      e,
      'The responsible Odd needs its Gmail write grant restored. No new send was made.'
    );
    return;
  }
  const token = await bearer(d.connector).catch(() => undefined);
  if (!token) {
    await reconnectTask(
      p.responsibleId,
      d.connector,
      'The scheduled result needs this existing Gmail account reconnected.',
      []
    );
    await explainResult(
      p,
      e,
      'Reconnect the existing Gmail account. The same reconnect request is on the Desk.'
    );
    return;
  }
  const fresh = async () => token;
  if (['sending', 'uncertain'].includes(e.delivery)) {
    if (e.checks >= 2) return;
    await patchEdition(e.id, {
      delivery: 'uncertain',
      checks: e.checks + 1,
      nextCheck: new Date(now.getTime() + 60000)
    });
    try {
      const id = await sentEdition(fresh, e.messageId, AbortSignal.timeout(15000));
      if (id) {
        await accepted(p, e, id, now);
        return;
      }
    } catch {
      /* A failed or empty search never makes a resend safe. */
    }
    await explainResult(
      p,
      e,
      'Delivery is uncertain. Sent mail did not yet confirm this edition. Inspect Gmail; the office will not resend it automatically.'
    );
    return e.checks + 1 < 2 ? now.getTime() + 60000 : undefined;
  }
  if (!maySend || !e.evidence.payload) return;
  if (
    !who ||
    who.permission === 'read' ||
    (who.permission === 'draft' && e.approvedHash !== e.evidence.payload.hash)
  ) {
    await explainResult(
      p,
      e,
      who?.permission === 'draft'
        ? 'Review the exact message and destination, then approve this edition.'
        : 'The responsible Odd is at Read. Change its level before sending this edition.'
    );
    return;
  }
  if (!(await scheduledResult(p.id))?.enabled) return;
  const claimed = await claimResultSend(p, e);
  if (!claimed) {
    await explainResult(
      p,
      e,
      'Delivery authority changed or the two-send allowance is used. Inspect this edition.'
    );
    return;
  }
  try {
    const id = await sendMail(
      fresh,
      { to: d.to, ...e.evidence.payload, messageId: e.messageId },
      AbortSignal.timeout(15000)
    );
    if (!id) throw new Error('No provider receipt.');
    await accepted(p, e, id, new Date());
  } catch (error) {
    // Only an explicit rejection proves that this attempt was not accepted.
    const rejected = error instanceof GoogleError && error.status >= 400 && error.status < 500;
    if (rejected) {
      const retry = error.status === 429 && claimed.sendAttempts < 2;
      await patchEdition(e.id, {
        delivery: 'ready',
        nextCheck: retry ? new Date(now.getTime() + 60000) : null,
        sendAttempts: retry ? claimed.sendAttempts : 2
      });
      if (error.status === 401 || error.status === 403)
        await reconnectTask(
          p.responsibleId,
          d.connector,
          'Gmail refused the scheduled delivery sign-in.',
          []
        );
      await explainResult(
        p,
        e,
        retry
          ? 'Gmail rejected the request because it was busy. One retry is allowed in a minute.'
          : 'Gmail rejected the send. Inspect its connection or destination before authorizing another attempt.'
      );
      return retry ? now.getTime() + 60000 : undefined;
    }
    await patchEdition(e.id, { delivery: 'uncertain', nextCheck: new Date(now.getTime() + 30000) });
    await explainResult(
      p,
      e,
      'Gmail may have accepted this edition before the connection ended. The office will check Sent mail and will not resend an uncertain message.'
    );
    return now.getTime() + 30000;
  }
}
async function accepted(p: ScheduledResult, e: ResultEdition, id: string, now: Date) {
  await patchEdition(e.id, {
    delivery: 'accepted',
    receipt: id,
    acceptedAt: now,
    nextCheck: null,
    reason:
      now > e.deadline
        ? 'Gmail acceptance was verified after the deadline. Arrival at the recipient is not established.'
        : null
  });
  await resultIncident(p, '', e);
}
