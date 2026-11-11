// A consultation keeps completed preparation separately from the persona's answer.
// Retrying the same request can call the persona again without repeating tools.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from './db.ts';
import { personaConsultations } from './schema.ts';

export const PERSONA_OUTCOMES = [
  'answered',
  'refused_access',
  'refused_content',
  'refused_budget',
  'failed',
  'abandoned',
  'interrupted'
] as const;
export type PersonaOutcome = (typeof PERSONA_OUTCOMES)[number];
export type PersonaAnswer =
  | { outcome: 'answered'; frame?: string; reply: string; caveat?: string }
  | { outcome: 'refused_content'; decline?: string }
  | { outcome: 'refused_budget'; retryAfterSeconds?: number }
  | { outcome: Exclude<PersonaOutcome, 'answered' | 'refused_content' | 'refused_budget'> }
  | { outcome: 'grant' };
export type PersonaPreparation = { text: string; saved?: true };
export type ConsultationState = 'answered' | 'pending' | 'blocked' | 'failed';
export type Consultation = typeof personaConsultations.$inferSelect;

export function consultationState(answer: PersonaAnswer): ConsultationState {
  switch (answer.outcome) {
    case 'answered':
      return 'answered';
    case 'refused_content':
    case 'refused_access':
    case 'grant':
      return 'blocked';
    case 'refused_budget':
    case 'interrupted':
      return 'pending';
    case 'failed':
    case 'abandoned':
      return 'failed';
  }
}

export async function beginConsultation(
  input: Pick<Consultation, 'key' | 'staffId' | 'slug' | 'kind' | 'asked' | 'required'>
) {
  const [created] = await db
    .insert(personaConsultations)
    .values(input)
    .onConflictDoNothing()
    .returning();
  if (created) return { row: created, created: true };
  const [row] = await db
    .select()
    .from(personaConsultations)
    .where(eq(personaConsultations.key, input.key));
  if (
    !row ||
    row.staffId !== input.staffId ||
    row.slug !== input.slug ||
    row.kind !== input.kind ||
    row.asked !== input.asked ||
    row.required !== input.required
  )
    throw new Error('That consultation belongs to a different request.');
  return { row, created: false };
}
export async function keepPersonaPreparation(key: string, preparation: PersonaPreparation) {
  await db
    .update(personaConsultations)
    .set({ preparation })
    .where(and(eq(personaConsultations.key, key), isNull(personaConsultations.preparation)));
}
/** A known failed preparation can be retried. A crash before its result was kept stays uncertain. */
export async function forgetFailedPreparation(key: string) {
  await db
    .delete(personaConsultations)
    .where(and(eq(personaConsultations.key, key), isNull(personaConsultations.preparation)));
}
export async function keepPersonaAnswer(key: string, answer: PersonaAnswer) {
  await db.update(personaConsultations).set({ answer }).where(eq(personaConsultations.key, key));
}

export const consultation = async (key: string) =>
  (await db.select().from(personaConsultations).where(eq(personaConsultations.key, key)))[0];
export const personaAnswerText = (answer: Extract<PersonaAnswer, { outcome: 'answered' }>) =>
  [answer.frame, answer.reply, answer.caveat].filter(Boolean).join('\n\n');
