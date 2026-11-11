import { randomUUID } from 'node:crypto';
import {
  connection,
  consultation,
  personaAnswerText,
  staffer,
  saveProjectReview,
  projectReview,
  claimProjectReview,
  finishProjectReview
} from '@oddboro/ledger';
import { personaRun } from './persona-run.ts';
import { reviewSource, reviewMessage } from './project-review-source.ts';

async function actors(sessionId: string, personaId: string) {
  const s = await connection(sessionId);
  if (!s?.staffId) throw new Error('Choose the Odd responsible for this project first.');
  const who = await staffer(personaId);
  if (!who || who.leftAt || !who.package || who.package.quiet)
    throw new Error('Choose a connected New Altitude persona.');
  return { s, who };
}
export async function previewProjectReview(p: {
  sessionId: string;
  personaId: string;
  file: string;
  start: number;
  end: number;
  question: string;
}) {
  const { s, who } = await actors(p.sessionId, p.personaId);
  const source = await reviewSource(s.folder, p.file, p.start, p.end);
  return saveProjectReview({
    id: randomUUID(),
    sessionId: s.id,
    staffId: s.staffId!,
    personaId: who.id,
    slug: who.package!.slug,
    source,
    question: p.question,
    message: reviewMessage(p.question, source)
  });
}
export async function askProjectReview(id: string) {
  const r = await projectReview(id);
  if (!r) throw new Error('Review not found.');
  if (r.state === 'answered') return r;
  if (r.state === 'asking') {
    const saved = await consultation(`${r.personaId}/${r.slug}/chat/project-review/${r.id}`);
    if (saved?.answer?.outcome === 'answered') {
      await finishProjectReview(id, personaAnswerText(saved.answer), 'Recovered saved answer.');
      return projectReview(id);
    }
  }

  const { s, who } = await actors(r.sessionId, r.personaId);
  if (s.staffId !== r.staffId || who.package!.slug !== r.slug)
    throw new Error('Project access or persona changed. Preview again.');
  const source = await reviewSource(s.folder, r.source.file, r.source.start, r.source.end);
  if (source.sha256 !== r.source.sha256)
    throw new Error('The source changed. Preview a new review before sending.');
  if (!(await claimProjectReview(id)))
    throw new Error(
      'This review is already running or was interrupted. Inspect its saved answer before starting another consultation.'
    );
  // There are no coding-tool actions to repeat: preparation is the approved excerpt.
  // A server crash leaves "asking" visible and never automatically repeats the call.
  const result = await personaRun(
    who,
    r.message,
    {
      kind: 'chat',
      timeoutMs: 120_000,
      ownerSaid: r.message,
      persona: { key: `project-review/${id}`, required: true, message: r.message }
    },
    async () => ({ ok: true, text: r.source.excerpt })
  );
  if (['failed', 'abandoned', 'interrupted'].includes(result.consultation?.reason ?? 'failed'))
    throw new Error(
      'The persona did not return a confirmed result. This review will not repeat automatically. Inspect the persona’s history before starting another consultation.'
    );
  await finishProjectReview(
    id,
    result.consultation?.state === 'answered' ? result.text : null,
    result.text
  );
  return projectReview(id);
}
