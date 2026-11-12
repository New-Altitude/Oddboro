// The owner works a task: tick a step, undo one, answer a choice,
// run a step's action, save its response, or finish it. Finishing writes the ledger row that credits the owner.
// `chat` on a finish says the owner answered on the task's card in its Odd's
// chat, so the run the answer starts replies there too.
import { error, json } from '@sveltejs/kit';
import {
  AWS_SECRETS_ID,
  connector,
  finishTask,
  saveTaskResponse,
  TaskResponseConflict,
  taskFiles,
  task,
  tickStep,
  untickStep
} from '@oddboro/ledger';
import { readStaffFile } from '#lib/server/files.ts';
import { workPath } from '@oddboro/ledger/work-paths';
import { confirmTools, hostedSignIn, listTools, postalSetup } from '#lib/server/access.ts';
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
  chat?: boolean;
  response?: string;
  version?: number;
  from?: string;
  startUrl?: string;
  ssoRegion?: string;
  region?: string;
  accountId?: string;
  role?: string;
  secret?: string;
  key?: string;
};

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const GET: RequestHandler = async ({ params }) => {
  const t = await task(Number(params.id));
  if (!t) error(404, 'No such task');
  return json({ response: t.response, responseVersion: t.responseVersion });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const id = Number(params.id);
  const t = await task(id);
  if (!t) error(404, 'No such task');
  const b = (await request.json().catch(() => ({}))) as Body;
  try {
    if ((b.op === 'start-response' || b.op === 'response') && (!t.staffId || t.askId))
      error(400, 'This task uses its own steps.');
    if (b.op === 'start-response') {
      // A response starts empty on its first save, so starting one is only ever from a file.
      let content = '';
      if (t.response === null) {
        if (
          typeof b.from !== 'string' ||
          !workPath(b.from) ||
          !t.staffId ||
          !(await taskFiles(id)).includes(b.from)
        )
          error(400, 'Choose a shared file attached to this task.');
        try {
          content = (await readStaffFile(t.staffId, b.from)).content;
        } catch {
          error(400, 'Could not open the attached file.');
        }
        if (content.length > 64000) error(400, 'This file is too long for a task response.');
      }
      const started = await saveTaskResponse(id, 'start', content);
      return json({ response: started.response, responseVersion: started.responseVersion });
    }
    if (b.op === 'response') {
      if (typeof b.response !== 'string' || !b.response.trim() || b.response.length > 64000)
        error(400, 'Write a response of up to 64,000 characters.');
      if (!Number.isSafeInteger(b.version) || b.version! < 0)
        error(400, 'Open the response first.');
      const saved = await saveTaskResponse(id, b.version!, b.response);
      return json({ response: saved.response, responseVersion: saved.responseVersion });
    }
    if (b.op === 'finish') {
      const finished = await finishTask(id, b.done !== false, text(b.note) || null, {
        inChat: b.chat === true,
        responseVersion: b.version
      });
      if (!finished) error(409, 'This task was already answered');
      return json({ ok: true });
    }
  } catch (e) {
    if (e instanceof TaskResponseConflict) error(409, e.message);
    throw e;
  }
  const step = typeof b.index === 'number' ? t.steps[b.index] : undefined;
  if (!step) error(400, 'No such step');
  const action = step.action;
  try {
    if (action?.kind === 'postal') {
      if (t.status !== 'open' || step.done) error(400, 'This mailbox setup is closed.');
      if (b.op === 'postal-inboxes') return json(await postalSetup(id));
      if (b.op !== 'postal-select' || !text(b.value)) error(400, 'Choose a mailbox.');
      const pmb = text(b.value);
      await postalSetup(id, pmb);
      await tickStep(id, b.index!, `PMB ${pmb}`);
      return json({ ok: true });
    }
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
