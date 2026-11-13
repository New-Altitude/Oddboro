// Runs a test step's command and, if it is still going after a set time,
// records what each test process is doing, then stops it. A hung step
// otherwise ends at its timeout with no word on why. CI's test steps run
// through it, with NODE_OPTIONS asking Node for a report on SIGUSR2.
//
// For each test process it records its CPU use and state from ps (busy or
// waiting), its JavaScript stack and the handles keeping it alive from Node's
// report, and on a Mac its native stack from sample. A process with no report
// was blocked outside JavaScript. Prints to the log and, in CI, to the run's
// summary page. Windows has no signals, so there it only runs the command.
//
// Usage: node scripts/hang-report.ts <minutes> <command> [args...]
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [minutesArg, command, ...args] = process.argv.slice(2);
const minutes = Number(minutesArg);
if (!command || !(minutes > 0)) {
  console.error('Usage: node scripts/hang-report.ts <minutes> <command> [args...]');
  process.exit(2);
}
const WIN = process.platform === 'win32';
const MAC = process.platform === 'darwin';
// Where NODE_OPTIONS's --report-directory points.
const REPORTS = /--report-directory=(\S+)/.exec(process.env.NODE_OPTIONS ?? '')?.[1];

const child = spawn(command, args, { stdio: 'inherit', shell: WIN });
const timer = WIN ? undefined : setTimeout(() => void stuck(), minutes * 60_000);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  process.exit(code ?? (signal ? 1 : 0));
});

type Proc = { pid: number; ppid: number; cpu: string; state: string; time: string; cmd: string };

function processes(): Proc[] {
  const out = spawnSync('ps', ['-A', '-o', 'pid=,ppid=,pcpu=,stat=,etime=,command='], {
    encoding: 'utf8'
  }).stdout;
  return out.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.*)$/.exec(line);
    return m ? [{ pid: +m[1], ppid: +m[2], cpu: m[3], state: m[4], time: m[5], cmd: m[6] }] : [];
  });
}

function descendants(all: Proc[], root: number): Proc[] {
  const found: Proc[] = [];
  const parents = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const p of all)
      if (parents.has(p.ppid) && !parents.has(p.pid)) {
        parents.add(p.pid);
        found.push(p);
        grew = true;
      }
  }
  return found;
}

const short = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
const cell = (text: string) => text.replace(/\s+/g, ' ').replaceAll('|', '\\|');
// The runner is `node --test`; each file it starts runs with the file last.
const label = (cmd: string) =>
  /\s--test(\s|$)/.test(cmd) ? 'the test runner' : (/(\S+\.test\.ts)/.exec(cmd)?.[1] ?? cmd);

type Report = {
  header?: { processId?: number; commandLine?: string[] };
  javascriptStack?: { message?: string; stack?: string[] };
  libuv?: { type?: string; is_active?: boolean; is_referenced?: boolean }[];
};

async function stuck(): Promise<void> {
  const lines = [`## Still running after ${minutes} minutes`, ''];
  const all = processes();
  const tree = [...all.filter((p) => p.pid === child.pid), ...descendants(all, child.pid ?? -1)];
  // The runner's own process and one per test file.
  const tests = tree.filter(
    (p) => /^\S*\bnode(\.exe)?\s/.test(p.cmd) && /--test\b|\.test\.ts\b/.test(p.cmd)
  );

  lines.push(
    '| pid | parent | CPU % | state | running for | command |',
    '| --: | --: | --: | --- | --- | --- |'
  );
  for (const p of tree)
    lines.push(
      `| ${p.pid} | ${p.ppid} | ${p.cpu} | ${p.state} | ${p.time} | ${cell(short(p.cmd, 160))} |`
    );
  lines.push(
    '',
    'State R is running, S is waiting. A test file that waits at 0% CPU waits on something.',
    ''
  );

  if (MAC)
    for (const p of tests) {
      const out =
        spawnSync('sample', [String(p.pid), '2', '-mayDie'], { encoding: 'utf8' }).stdout ?? '';
      const graph = out.slice(out.indexOf('Call graph:')).split('\n').slice(0, 40).join('\n');
      console.log(`::group::Native stack of ${p.pid}, ${label(p.cmd)}\n${graph}\n::endgroup::`);
    }

  if (REPORTS) {
    mkdirSync(REPORTS, { recursive: true });
    for (const p of tests) {
      try {
        process.kill(p.pid, 'SIGUSR2');
      } catch {
        // It ended meanwhile.
      }
    }
    await new Promise((done) => setTimeout(done, 10_000));
    const seen = new Set<number>();
    for (const name of existsSync(REPORTS) ? readdirSync(REPORTS) : []) {
      if (!name.endsWith('.json')) continue;
      let r: Report;
      try {
        r = JSON.parse(readFileSync(join(REPORTS, name), 'utf8')) as Report;
      } catch {
        continue;
      }
      const pid = r.header?.processId ?? 0;
      seen.add(pid);
      const kept = new Map<string, number>();
      for (const h of r.libuv ?? [])
        if (h.is_active && h.is_referenced)
          kept.set(h.type ?? '?', (kept.get(h.type ?? '?') ?? 0) + 1);
      const file = label((r.header?.commandLine ?? []).join(' '));
      lines.push(`### ${pid}: ${file}`, '');
      lines.push(
        `Kept alive by: ${[...kept].map(([t, n]) => `${t} ${n}`).join(', ') || 'nothing'}`,
        ''
      );
      const stack = (r.javascriptStack?.stack ?? []).map((s) => s.trim()).filter(Boolean);
      if (stack.length) lines.push('```', ...stack.slice(0, 12), '```', '');
      else lines.push('No JavaScript running: it waits in the event loop.', '');
    }
    for (const p of tests)
      if (!seen.has(p.pid))
        lines.push(
          `### ${p.pid}: ${label(p.cmd)}`,
          '',
          'No report: blocked outside JavaScript.',
          ''
        );
    // A report also holds the process's resource and library lists; the summary is enough.
    rmSync(REPORTS, { recursive: true, force: true });
  }

  const text = lines.join('\n') + '\n';
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  for (const p of tree.reverse()) {
    try {
      process.kill(p.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  child.kill('SIGKILL');
  console.error(`Stopped after ${minutes} minutes.`);
  process.exit(1);
}
