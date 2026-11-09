// A one-off run as the office itself, not as any staffer: no MCP, no job
// description, on the tool the office runs on (`officeAgent`, picked at
// setup). Drafting a job description, drawing a look and designing an office
// run this way, so a new office with nobody on staff can still hire its first
// staffer. Usage is recorded with no staffer.
//
// On Claude Code the run has no tools, its pictures go in the message itself,
// and Claude Code keeps no transcript, so a headshot never lands on disk. On
// Grok or Codex it goes through the same launch an Odd's run does (`LAUNCHES`
// in cli.ts), with that tool's sandbox, in a folder of its own that reads
// nothing else, writes only itself, has no MCP, no web and no network, and is
// removed when the run ends, pictures and all. Neither has a shell or a tool
// that reads files: the pictures go in with the message.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_NAMES,
  home,
  OFFICE_ACCOUNT,
  officeAgent,
  ownerName,
  recordUsage,
  runsGoing,
  type Agent,
  type ModelUsage,
  type UsageKind
} from '@oddboro/ledger';
import { notePlan, pluginsOff, staffEnv } from './staff.ts';
import { claudeRunHome, modelArgs, spawnClaude } from './claude.ts';
import { endedEarly, LAUNCHES, stoppedWhy } from './cli.ts';
import { SIGN_IN_WHERE, stopGroups, type RunImage } from './launch.ts';
import { agentCommand } from './agent-sign-in.ts';
import { tooOldLine } from './versions.ts';

const HOME = home('office');
/** Each Grok or Codex office run's own folder, removed when it ends. */
const RUNS = join(HOME, 'runs');

export type OfficeRun = { ok: boolean; text: string };

type OfficeRunOpts = {
  system: string;
  kind: UsageKind;
  timeoutMs: number;
  /** Lower effort answers sooner; the default is the tool's own. */
  effort?: 'low' | 'medium' | 'high';
  /** Pictures sent ahead of the message, as base64. */
  images?: { mediaType: string; data: string }[];
  /** A Claude model other than the owner's pick. Claude Code only. */
  model?: string;
  /** Stops the run, such as when the owner leaves a drawing for parts. */
  signal?: AbortSignal;
};

/** What an office run says when its signal stopped it. */
const STOPPED = 'Stopped.';

/** One office run. Prompts name the owner as {owner}, filled in with this install's name. */
export async function runAsOffice(message: string, opts: OfficeRunOpts): Promise<OfficeRun> {
  const owner = await ownerName();
  const say = (s: string) => s.replaceAll('{owner}', owner);
  const agent = officeAgent();
  const tooOld = await tooOldLine(agent, SIGN_IN_HERE);
  if (tooOld) return { ok: false, text: tooOld };
  const said = { ...opts, system: say(opts.system) };
  return agent === 'claude' ? run(say(message), said) : runOn(agent, say(message), said);
}

/**
 * Said to an office run on Grok or Codex after its own instructions. Claude
 * Code's office run has no tools at all; Grok's has one harmless one, and
 * either tool went looking for files or ran a script before it answered when
 * it could, so the answer comes in this one reply instead.
 */
const ONE_REPLY =
  'You have no tools you need here and no files to read: everything is in this message. Answer in this one reply, in the shape it asks for.';

/** Where an office run's refusal sends the owner to sign its tool in: setup, not an Odd's Settings tab. */
const SIGN_IN_HERE = 'in Setup, under Your AI';

/** Call `stop` once when `signal` aborts, at once if it already has. */
function onStop(signal: AbortSignal | undefined, stop: () => void): void {
  if (!signal) return;
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
}

/** One office run on Grok or Codex. */
async function runOn(
  agent: Exclude<Agent, 'claude'>,
  message: string,
  opts: OfficeRunOpts
): Promise<OfficeRun> {
  mkdirSync(RUNS, { recursive: true, mode: 0o700 });
  const key = `office-${randomUUID()}`;
  const dir = join(RUNS, key);
  mkdirSync(dir, { mode: 0o700 });
  const clear = () => rmSync(dir, { recursive: true, force: true });
  const images = (opts.images ?? []).map((img, i): RunImage => {
    const path = join(dir, `picture-${i + 1}.${img.mediaType.split('/')[1] || 'png'}`);
    writeFileSync(path, Buffer.from(img.data, 'base64'), { mode: 0o600 });
    return { path, mediaType: img.mediaType };
  });
  const launch = await LAUNCHES[agent]({
    key,
    // The office's own runs sign in with each tool's Office account.
    account: OFFICE_ACCOUNT,
    staffId: 'office',
    dir,
    reads: [],
    // `part` gives Grok a sandbox profile for this run alone.
    part: dir,
    writes: [dir],
    granted: [],
    web: false,
    commands: false,
    network: false,
    system: `${opts.system}\n\n${ONE_REPLY}`,
    input: message,
    servers: {},
    allowed: [],
    timeoutMs: opts.timeoutMs,
    images,
    bare: true,
    ...(opts.effort ? { effort: opts.effort } : {})
  });
  if ('refused' in launch) {
    clear();
    return { ok: false, text: launch.refused.replace(SIGN_IN_WHERE, SIGN_IN_HERE) };
  }
  const tool = AGENT_NAMES[agent];
  return new Promise((done) => {
    runsGoing.add(key);
    const [cmd, before] = agentCommand(agent) ?? [agent, []];
    const child = spawn(cmd, [...before, ...launch.args], {
      cwd: dir,
      env: launch.env,
      detached: !!launch.ownGroup,
      windowsHide: true
    });
    const stop = () => {
      if (!launch.ownGroup) child.kill();
      else if (child.pid) stopGroups(child.pid);
    };
    let buffer = '';
    let stderr = '';
    /** The last whole message, which is a Codex run's reply. */
    let last = '';
    let finished = false;
    const finish = (r: OfficeRun) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      runsGoing.delete(key);
      launch.done();
      clear();
      done(r);
    };
    const timer = setTimeout(() => {
      stop();
      finish({ ok: false, text: `No reply after ${opts.timeoutMs / 60_000} minutes.` });
    }, opts.timeoutMs);
    onStop(opts.signal, () => {
      stop();
      finish({ ok: false, text: STOPPED });
    });
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
        if (launch.read) {
          for (const ev of launch.read(e)) {
            if (ev.type === 'message') last = ev.text;
            else if (ev.type === 'usage')
              void recordUsage(null, opts.kind, ev.usage).catch(() => {});
            else if (ev.type === 'done') finish({ ok: true, text: last.trim() });
            else if (ev.type === 'failed') finish({ ok: false, text: ev.message });
            else if (ev.type === 'error') stderr += `${ev.message}\n`;
          }
          continue;
        }
        // Grok streams in Claude Code's shape.
        if (e.type === 'result') {
          if (e.modelUsage)
            void recordUsage(null, opts.kind, e.modelUsage as ModelUsage).catch(() => {});
          if (e.subtype === 'success') finish({ ok: true, text: String(e.result ?? '').trim() });
          else finish({ ok: false, text: endedEarly(agent, e) });
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => (stderr += c));
    child.on('error', (err) =>
      finish({ ok: false, text: `Could not start ${tool}: ${err.message}` })
    );
    child.on('close', (code) => {
      if (launch.ownGroup) stop();
      finish({
        ok: false,
        text: stoppedWhy(agent, code, stderr, true)
      });
    });
    // A run stopped before it read its message closes its input: the stop says so, not this.
    child.stdin.on('error', () => {});
    child.stdin.end(launch.stdin);
  });
}

async function run(message: string, opts: OfficeRunOpts): Promise<OfficeRun> {
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
  // The office's own Claude Code folder, or the owner's login before it is signed in.
  const env = staffEnv(await claudeRunHome(OFFICE_ACCOUNT));
  return new Promise((done) => {
    const child = spawnClaude(args, { cwd: HOME, env });
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
    onStop(opts.signal, () => {
      child.kill();
      finish({ ok: false, text: STOPPED });
    });
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
    child.stdin.on('error', () => {});
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
