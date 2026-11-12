// Only the owner's page can POST. The destination is fixed, and the reviewed
// text travels on stdin so it never appears in the process list.
import { execFile } from 'node:child_process';
import { error, json } from '@sveltejs/kit';
import { BODY_LIMIT, BUG_REPO, ISSUES, TITLE_LIMIT } from '#lib/bug-report.ts';
import { cleanEnv } from '#lib/server/claude.ts';
import { onPath } from '#lib/server/on-path.ts';
import { isStaff, sayInChat } from '#lib/server/staff.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => json({ cli: !!onPath('gh') });

export const POST: RequestHandler = async ({ request, params }) => {
  if (!(await isStaff(params.id))) error(404, 'No such Odd');
  const fields = await request.json().catch(() => null);
  const title = typeof fields?.title === 'string' ? fields.title.trim() : '';
  const body = typeof fields?.body === 'string' ? fields.body.trim() : '';
  if (!title || !body || title.length > TITLE_LIMIT || body.length > BODY_LIMIT)
    error(400, 'Enter a title and details within the limits shown.');

  const gh = onPath('gh');
  if (!gh) error(503, 'GitHub CLI is unavailable. Open the draft on GitHub to file it.');
  // Use the owner's CLI sign-in, even if a build or a job set a token for itself.
  const env = cleanEnv();
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const number = await new Promise<number>((resolve) => {
    const child = execFile(
      gh,
      [
        'api',
        '--hostname',
        'github.com',
        '--method',
        'POST',
        `repos/${BUG_REPO}/issues`,
        '--input',
        '-',
        '--jq',
        '.number'
      ],
      { env: { ...env, GH_PROMPT_DISABLED: '1' }, windowsHide: true, timeout: 30_000 },
      (err, out) => resolve(!err && /^[1-9]\d*$/.test(out.trim()) ? Number(out.trim()) : 0)
    );
    // The CLI can exit before reading, for example when it has no sign-in.
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ title, body }));
  });
  if (!Number.isSafeInteger(number) || number < 1)
    error(
      502,
      'GitHub CLI could not confirm a new issue. Check the issue list before filing again.'
    );
  try {
    sayInChat(params.id, `Filed [Oddboro issue #${number}](${ISSUES}/${number}).`);
  } catch {
    // GitHub already created the issue. Return its link even if the disk is full.
    return json({ number, saved: false }, { status: 201 });
  }
  return json({ number, saved: true }, { status: 201 });
};
