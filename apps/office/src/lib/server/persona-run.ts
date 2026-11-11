// A persona Odd's chat, job or follow-up: its own coding tool does the work
// first, as its hands, then the persona answers through its door on New
// Altitude, in its own voice. The door takes no tools, so what the hands found
// reaches it as words. Every word the office sends the door is in this file.
import { randomUUID } from 'node:crypto';
import {
  beginConsultation,
  consultationState,
  forgetFailedPreparation,
  keepPersonaAnswer,
  keepPersonaPreparation,
  ownerName,
  personaAnswerText,
  setQuiet,
  type StaffRow,
  type PersonaPreparation
} from '@oddboro/ledger';
import { QUIET_LINE } from '#lib/persona.ts';
import { askPersona } from './persona.ts';
import { PERSONA_MESSAGE_MAX, type DoorAnswer } from './persona-door.ts';
import type { Run, RunOpts } from './staff.ts';

/** How a follow-up's work ended, the last line of its reply (`followThrough`). */
export const OUTCOME_LINE = /[*_\s]*Outcome:[*_\s]*(done|failed|waiting)\W*$/i;

/** The most of the door's message what was asked may take; the hands' report gets the rest. */
const ASKED_MAX = 1_500;
const REPORT_HEAD = 'What your hands in the office found and did:';
const CUT = ' [cut]';

/** `s`, at most `max` characters, marked where it was cut. */
const cut = (s: string, max: number) =>
  s.length <= max ? s : s.slice(0, max - CUT.length).trimEnd() + CUT;

/** The run kinds the persona answers; drafts, looks and the office's own runs stay with the hands. */
type Voiced = 'chat' | 'job' | 'follow-up';

/** What the persona is told it was asked, by the kind of run. */
const INTRO: Record<Voiced, (owner: string) => string> = {
  chat: (owner) => `${owner} wrote to you in Oddboro, where you work as an Odd in their office:`,
  job: (owner) => `Your job in ${owner}'s Oddboro office just ran. Its instructions:`,
  'follow-up': (owner) => `Work in ${owner}'s Oddboro office:`
};

/** Whether a persona Odd's run of this kind goes on to its persona. */
export const voiced = (kind: RunOpts['kind']): kind is Voiced => Object.hasOwn(INTRO, kind);

/** The door's message: what was asked, then the hands' report, within the door's limit. */
function voiceMessage(p: { kind: Voiced; owner: string; asked: string; report: string }): string {
  const head = `${INTRO[p.kind](p.owner)}\n\n${cut(p.asked, ASKED_MAX)}\n\n${REPORT_HEAD}\n\n`;
  return (head + cut(p.report, PERSONA_MESSAGE_MAX - head.length)).replaceAll('{owner}', p.owner);
}

type Unanswered = Exclude<DoorAnswer, { outcome: 'answered' }>;

/** A wait the door gave in seconds, as the owner reads it: whole minutes or hours, rounded up. */
function waitWords(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const [n, unit] = minutes < 60 ? [minutes, 'minute'] : [Math.ceil(minutes / 60), 'hour'];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** The office's line before the hands' report, when the persona did not answer. */
function note(name: string, a: Unanswered): string {
  const found = `Here is what ${name}'s hands found.`;
  switch (a.outcome) {
    case 'refused_content':
      return `${a.decline ?? `${name} would not take this up.`} ${found}`;
    case 'refused_budget':
      return `${name} has reached New Altitude's limit for now.${a.retryAfterSeconds === undefined ? '' : ` Try again in ${waitWords(a.retryAfterSeconds)}.`} ${found}`;
    case 'failed':
    case 'abandoned':
    case 'interrupted':
      return `${name} could not answer just now. ${found}`;
    case 'refused_access':
      return `${QUIET_LINE.access(name)} ${found}`;
    case 'grant':
      return `${QUIET_LINE.grant(name)} ${found}`;
    default: {
      const missed: never = a;
      return missed;
    }
  }
}

/** Concurrent retries of one request share the answer, even from two page callbacks. */
const answering = new Map<string, Promise<Run>>();

/** Preparation and judgment finish separately. A saved request retries only its judgment. */
export async function personaRun(
  who: StaffRow,
  message: string,
  opts: RunOpts & { kind: Voiced },
  runTool: (who: StaffRow, message: string, opts: RunOpts) => Promise<Run>
): Promise<Run> {
  const key = `${who.id}/${who.package!.slug}/${opts.kind}/${opts.persona?.key ?? opts.runId ?? randomUUID()}`;
  const pending = answering.get(key);
  if (pending) return pending;
  const done = consult(who, message, opts, runTool, key);
  answering.set(key, done);
  try {
    return await done;
  } finally {
    if (answering.get(key) === done) answering.delete(key);
  }
}

async function consult(
  who: StaffRow,
  message: string,
  opts: RunOpts & { kind: Voiced },
  runTool: (who: StaffRow, message: string, opts: RunOpts) => Promise<Run>,
  key: string
): Promise<Run> {
  if (
    opts.persona?.message !== undefined &&
    (opts.persona.message !== message || message.length > PERSONA_MESSAGE_MAX)
  )
    throw new Error(
      'The approved persona message must match the request and fit the service limit.'
    );
  const quiet = who.package?.quiet;
  if (quiet) {
    const text = QUIET_LINE[quiet](who.name);
    opts.onEvent?.({ type: 'error', message: text });
    return {
      ok: false,
      text,
      consultation: {
        key,
        state: 'blocked',
        reason: quiet === 'access' ? 'refused_access' : 'grant'
      }
    };
  }
  const asked =
    opts.kind === 'chat'
      ? (opts.ownerSaid ?? message)
      : opts.kind === 'job'
        ? message
        : (opts.asked ?? message);
  const { row, created } = await beginConsultation({
    key,
    staffId: who.id,
    slug: who.package!.slug,
    kind: opts.kind,
    asked,
    required: opts.persona?.required !== false
  });
  let preparation = row.preparation;
  if (!preparation) {
    if (!created)
      return {
        ok: false,
        text: 'Preparation stopped before its report was saved. Check the completed files before starting this work again.',
        consultation: { key, state: 'pending', reason: 'interrupted' }
      };
    const hands = await runTool(who, message, {
      ...opts,
      onEvent: (e) => void (e.type === 'tool' && opts.onEvent?.(e))
    });
    if (!hands.ok) {
      await forgetFailedPreparation(key);
      opts.onEvent?.({ type: 'error', message: hands.text });
      return hands;
    }
    preparation = { text: hands.text, ...(hands.saved ? { saved: true } : {}) };
    await keepPersonaPreparation(key, preparation);
  }
  let answer = row.answer;
  if (answer?.outcome !== 'answered') {
    const outcome = OUTCOME_LINE.exec(preparation.text);
    const report = outcome ? preparation.text.slice(0, outcome.index).trim() : preparation.text;
    answer = opts.signal?.aborted
      ? { outcome: 'interrupted' }
      : await askPersona(
          who,
          opts.persona?.message ??
            voiceMessage({ kind: opts.kind, owner: await ownerName(), asked, report }),
          opts.kind === 'chat' ? { ownerSaid: asked } : undefined,
          opts.signal
        ).catch((): DoorAnswer => ({ outcome: 'failed' }));
    await keepPersonaAnswer(key, answer);
    if (answer.outcome === 'refused_access') await setQuiet(who.id, 'access');
    if (answer.outcome === 'grant') await setQuiet(who.id, 'grant');
  }
  return result(who.name, opts, key, preparation, answer);
}

function result(
  name: string,
  opts: RunOpts & { kind: Voiced },
  key: string,
  hands: PersonaPreparation,
  answer: DoorAnswer
): Run {
  const outcome = OUTCOME_LINE.exec(hands.text);
  const report = outcome ? hands.text.slice(0, outcome.index).trim() : hands.text;
  const answered = answer.outcome === 'answered';
  const ok = answered || opts.persona?.required === false;
  const reply = answered ? personaAnswerText(answer) : `${note(name, answer)}\n\n${report}`;
  // A required judgment that never arrived cannot keep the preparation's "done".
  const text =
    opts.kind === 'follow-up' && outcome
      ? `${reply}\n\nOutcome: ${ok ? outcome[1].toLowerCase() : 'failed'}`
      : reply;
  opts.onEvent?.({ type: 'delta', text: reply });
  opts.onEvent?.(ok ? { type: 'done', text } : { type: 'error', message: text });
  return {
    ok,
    text,
    ...(hands.saved ? { saved: true } : {}),
    ...(opts.signal?.aborted ? { interrupted: true } : {}),
    consultation: { key, state: consultationState(answer), reason: answer.outcome }
  };
}
