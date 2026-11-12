// A staffer's access: what the owner granted, grant more directly, or revoke.
// Granting creates the task with the steps to connect it, unless it is already connected.
// `another` on Gmail or Google Drive grants a new connector for one more
// Google account (`grantAccess` makes it). A PATCH with `tool` and `standing`
// lets the Odd use that one tool without asking at Draft, or takes it back
// (`setStanding`); one with `tool` and `askFirst` holds each call to it for
// the owner's yes even at Act, or lets it go (`setAskFirst`).
import { error, json } from '@sveltejs/kit';
import {
  capabilities,
  ensureConnector,
  grantAccess,
  isAws,
  reachOf,
  revoke,
  setGrantLevel,
  setAskFirst,
  setStanding,
  staffer,
  type Level
} from '@oddboro/ledger';
import type { RequestHandler } from './$types';

/** Each grant as the Odd's runs find it, from the same `capabilities` the runs load from. */
export const GET: RequestHandler = async ({ params }) => {
  const who = await staffer(params.id);
  if (!who) error(404, 'No such Odd');
  return json(
    (await capabilities(who)).outside.map((a) => ({
      connector: a.connector.id,
      name: a.connector.name,
      level: a.level,
      reach: reachOf(a),
      heldBack: a.heldBack ?? null,
      // The tools it uses without asking at Draft, and the ones that ask first at Act.
      standing: a.standing,
      askFirst: a.askFirst,
      // Every tool its runs reach, those that change something first, since
      // only those can wait for a yes.
      tools: (a.level === 'act' ? a.connector.tools : a.connector.readTools)
        .map((name) => ({
          name,
          changes: !a.connector.readTools.includes(name),
          // What it does, in the service's own words.
          note: a.connector.toolNotes[name] ?? ''
        }))
        .sort((x, y) => Number(y.changes) - Number(x.changes)),
      // An AWS tool once connected can move to another role or Region.
      changes: isAws(a.connector.id) && !!a.connector.readyAt
    }))
  );
};

export const POST: RequestHandler = async ({ params, request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const level = (['read', 'act'] as Level[]).find((l) => l === b.level);
  if (typeof b.connector !== 'string' || !level) error(400, 'Pick a tool and a level');
  // A hosted server named by its address: sent only when the owner chose how it lets the office in.
  const way = b.way as { keyHeader?: unknown } | undefined;
  const found = await ensureConnector(
    b.connector,
    way && typeof way === 'object'
      ? { keyHeader: typeof way.keyHeader === 'string' ? way.keyHeader.trim() : undefined }
      : undefined
  );
  if (!found.connector) error(400, found.problem ?? 'No such tool');
  const product = found.connector.config.google;
  if (b.another === true && !product)
    error(400, 'Only Gmail and Google Drive take another account');
  try {
    const { task } = await grantAccess(params.id, {
      connector: found.connector.id,
      level,
      ...(b.another === true && product ? { another: product } : {})
    });
    // A tool already connected needs no steps, so nothing waits on the desk.
    return json({ ok: true, task });
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
};

/** Change a grant's level in place: no revoke, no new sign-in. Or one tool's standing yes. */
export const PATCH: RequestHandler = async ({ params, request }) => {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const on = b.standing ?? b.askFirst;
  if (typeof b.tool === 'string' && typeof on === 'boolean') {
    if (typeof b.connector !== 'string') error(400, 'Pick a tool');
    try {
      const set = typeof b.standing === 'boolean' ? setStanding : setAskFirst;
      await set(params.id, b.connector, b.tool, on);
    } catch (e) {
      error(400, e instanceof Error ? e.message : String(e));
    }
    return json({ ok: true });
  }
  const level = (['read', 'act'] as const).find((l) => l === b.level);
  if (typeof b.connector !== 'string' || !level) error(400, 'Pick a tool and a level');
  try {
    await setGrantLevel(params.id, b.connector, level);
  } catch (e) {
    error(400, e instanceof Error ? e.message : String(e));
  }
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, url }) => {
  await revoke(params.id, url.searchParams.get('connector') ?? '');
  return json({ ok: true });
};
