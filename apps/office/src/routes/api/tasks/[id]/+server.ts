// The owner works a task: tick a step, undo one, answer a choice,
// run a step's action, or finish it. Finishing writes the ledger row that credits the owner.
import { error, json } from '@sveltejs/kit';
import { AWS_SECRETS_ID, connector, finishTask, task, tickStep, untickStep } from '@oddboro/ledger';
import { confirmTools, hostedSignIn, listTools } from '#lib/server/access.ts';
import {
  awsRoles,
  awsSecretKeys,
  awsSecretNames,
  awsSignedIn,
  awsSigningIn,
  awsSignInDone,
  awsSignInPlace,
  chooseAwsRole,
  forgetAwsSecret,
  startAwsSignIn,
  startProblem,
  useAwsSecret
} from '#lib/server/aws.ts';
import { setSecret } from '#lib/server/keychain.ts';
import type { TaskOp } from '#lib/server/owner-actions.ts';
import type { RequestHandler } from './$types';

type Body = {
  op?: TaskOp;
  index?: number;
  answer?: string;
  value?: string;
  done?: boolean;
  note?: string;
  startUrl?: string;
  ssoRegion?: string;
  region?: string;
  accountId?: string;
  role?: string;
  secret?: string;
  key?: string;
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number(params.id);
  const t = await task(id);
  if (!t) error(404, 'No such task');
  const b = (await request.json().catch(() => ({}))) as Body;
  if (b.op === 'finish') {
    await finishTask(id, b.done !== false, typeof b.note === 'string' ? b.note.trim() : null);
    return json({ ok: true });
  }
  const step = typeof b.index === 'number' ? t.steps[b.index] : undefined;
  if (!step) error(400, 'No such step');
  const action = step.action;
  try {
    if (b.op === 'tick') await tickStep(id, b.index!);
    else if (b.op === 'untick') await untickStep(id, b.index!);
    else if (
      b.op === 'choose' &&
      action?.kind === 'choice' &&
      action.options.includes(b.answer ?? '')
    )
      await tickStep(id, b.index!, b.answer);
    else if (b.op === 'oauth' && action?.kind === 'oauth')
      return json(await hostedSignIn(action.connector));
    else if (b.op === 'secret' && action?.kind === 'secret' && b.value?.trim()) {
      setSecret(action.connector, action.name, b.value.trim());
      await forgetAwsSecret(action.connector, action.name);
      await tickStep(id, b.index!);
    } else if (b.op === 'aws-current' && action?.kind === 'aws')
      // Where the office signed in, whether that still works, and this tool's
      // role so far. None of it is secret.
      return json({
        place: awsSignInPlace(),
        signedIn: await awsSignedIn(),
        signingIn: awsSigningIn(),
        aws: (await connector(action.connector))?.config.aws ?? null
      });
    else if (b.op === 'aws-sign-in' && action?.kind === 'aws')
      return json(await startAwsSignIn(text(b.startUrl), text(b.ssoRegion)));
    else if (b.op === 'aws-roles' && action?.kind === 'aws') {
      // Waits while the owner approves the sign-in on AWS's page, then lists every role it holds.
      await awsSignInDone();
      return json({ roles: await awsRoles() });
    } else if (b.op === 'aws-choose' && action?.kind === 'aws') {
      const { notes } = await chooseAwsRole(
        action.connector,
        text(b.accountId),
        text(b.role),
        text(b.region)
      );
      // Listing its tools connects it, which for AWS read only and builder starts AWS's tool.
      await confirmTools(action.connector).catch((e: unknown) => {
        throw new Error(startProblem(e));
      });
      await tickStep(id, b.index!, notes.join(' ') || undefined);
      return json({ notes });
    } else if (b.op === 'aws-secrets-connected' && action?.kind === 'secret')
      // Whether the office has a role to read keys from AWS with. No AWS call.
      return json({ connected: !!(await connector(AWS_SECRETS_ID))?.config.aws });
    else if (b.op === 'aws-secret-names' && action?.kind === 'secret')
      // Names and descriptions only: the office never sends a value to the page.
      return json({ secrets: await awsSecretNames() });
    else if (b.op === 'aws-secret-keys' && action?.kind === 'secret')
      // The key names inside one secret. The office drops the value unread by the page.
      return json({ keys: await awsSecretKeys(text(b.secret)) });
    else if (b.op === 'aws-secret' && action?.kind === 'secret') {
      await useAwsSecret(action.connector, action.name, {
        secret: text(b.secret),
        key: text(b.key) || undefined
      });
      await tickStep(
        id,
        b.index!,
        `From AWS: ${text(b.secret)}${text(b.key) ? `, ${text(b.key)}` : ''}`
      );
    } else if (b.op === 'tools' && action?.kind === 'tools')
      return json({ tools: await listTools(action.connector) });
    else if (b.op === 'confirm-tools' && action?.kind === 'tools') {
      await confirmTools(action.connector);
      await tickStep(id, b.index!);
    } else error(400, 'That step does not take that');
  } catch (e) {
    if (e && typeof e === 'object' && 'status' in e) throw e;
    error(400, e instanceof Error ? e.message : String(e));
  }
  return json({ ok: true });
};
