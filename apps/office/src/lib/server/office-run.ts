// A one-off Claude run as the office itself, not as any staffer: no tools, no
// MCP, no job description, on the owner's model. Drafting a job description
// and drawing a look run this way, so a new office with nobody on staff can
// still hire its first staffer. Usage is recorded with no staffer. Images go
// in the message itself, so the run still needs no file tools. Claude Code
// keeps no transcript of an office run, so a headshot never lands on disk.
import { mkdirSync } from 'node:fs';
import { ownerName, recordUsage, type ModelUsage, type UsageKind, home } from '@oddboro/ledger';
import { notePlan, pluginsOff, staffEnv } from './staff.ts';
import { modelArgs, spawnClaude } from './claude.ts';

const HOME = home('office');

export type OfficeRun = { ok: boolean; text: string };

type OfficeRunOpts = {
  system: string;
  kind: UsageKind;
  timeoutMs: number;
  /** Lower effort answers sooner; the default is Claude Code's own. */
  effort?: 'low' | 'medium' | 'high';
  /** Pictures sent ahead of the message, as base64. */
  images?: { mediaType: string; data: string }[];
  /** A model other than the owner's pick. */
  model?: string;
};

/** One office run. Prompts name the owner as {owner}, filled in with this install's name. */
export async function runAsOffice(message: string, opts: OfficeRunOpts): Promise<OfficeRun> {
  const owner = await ownerName();
  const say = (s: string) => s.replaceAll('{owner}', owner);
  return run(say(message), { ...opts, system: say(opts.system) });
}

function run(message: string, opts: OfficeRunOpts): Promise<OfficeRun> {
  mkdirSync(HOME, { recursive: true });
  const args = [
    '-p',
    '--no-session-persistence',
    '--output-format',
    'stream-json',
    '--verbose',
    '--tools',
    '',
    '--strict-mcp-config',
    '--mcp-config',
    JSON.stringify({ mcpServers: {} }),
    '--permission-mode',
    'dontAsk',
    '--disable-slash-commands',
    '--settings',
    JSON.stringify({ enabledPlugins: pluginsOff() }),
    '--append-system-prompt',
    opts.system,
    ...(opts.effort ? ['--effort', opts.effort] : []),
    ...(opts.model ? ['--model', opts.model] : modelArgs()),
    ...(opts.images?.length ? ['--input-format', 'stream-json'] : [])
  ];
  return new Promise((done) => {
    const child = spawnClaude(args, { cwd: HOME, env: staffEnv() });
    let buffer = '';
    let finished = false;
    const finish = (r: OfficeRun) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done(r);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ok: false, text: `No reply after ${opts.timeoutMs / 60_000} minutes.` });
    }, opts.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let e: Record<string, unknown>;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.type === 'rate_limit_event') void notePlan(e.rate_limit_info);
        if (e.type === 'result') {
          if (e.modelUsage)
            void recordUsage(null, opts.kind, e.modelUsage as ModelUsage).catch(() => {});
          if (e.subtype === 'success') finish({ ok: true, text: String(e.result ?? '').trim() });
          else finish({ ok: false, text: `The run ended early (${String(e.subtype)}).` });
        }
      }
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('error', (err) =>
      finish({ ok: false, text: `Could not start Claude Code: ${err.message}` })
    );
    child.on('close', (code) =>
      finish({
        ok: false,
        text: `Claude Code stopped (exit ${code}). ${stderr.trim().split('\n').slice(-2).join(' ')}`
      })
    );
    child.stdin.end(
      opts.images?.length
        ? `${JSON.stringify({
            type: 'user',
            message: {
              role: 'user',
              content: [
                ...opts.images.map((i) => ({
                  type: 'image',
                  source: { type: 'base64', media_type: i.mediaType, data: i.data }
                })),
                { type: 'text', text: message }
              ]
            }
          })}\n`
        : message
    );
  });
}
