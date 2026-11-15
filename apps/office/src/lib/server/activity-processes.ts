import { execFile } from 'node:child_process';
import { readFile, readlink, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { AGENTS, type Agent } from '@oddboro/ledger/agents';
import { currentPlatform } from '@oddboro/ledger/platform';

const execute = promisify(execFile);
const options = {
  timeout: 12000,
  maxBuffer: 16 * 1024 * 1024,
  windowsHide: true,
  env: { ...process.env, LC_ALL: 'C' }
};
export type ProcessRow = {
  pid: number;
  parent: number;
  start: string;
  ms: number;
  bytes: number;
  agent?: Agent;
  launcher?: boolean;
  shared?: boolean;
};
const node = /(?:^|[\\/])node(?:\.exe)?$/i;
const packages: Partial<Record<Agent, string>> = {
  codex: '@openai/codex',
  claude: '@anthropic-ai/claude-code',
  gemini: '@google/gemini-cli'
};

/** Only the executable and Node's entry point identify a tool. Arguments can contain the owner's prompt. */
export function identify(exe: string, entry = ''): Pick<ProcessRow, 'agent' | 'launcher'> {
  const path = exe.replaceAll('\\', '/');
  if (node.test(path)) {
    const script = entry.replaceAll('\\', '/');
    const agent = AGENTS.find(
      (a) => basename(script) === a || (packages[a] && script.includes('/' + packages[a] + '/'))
    );
    return agent ? { agent, launcher: true } : {};
  }
  if (/\/claude\/versions\/[\d.]+$/.test(path)) return { agent: 'claude' };
  const name = basename(path).replace(/\.exe$/i, '');
  return { agent: AGENTS.find((a) => a === name) };
}

function codexRole(row: Pick<ProcessRow, 'agent' | 'shared'>, arg: string | undefined) {
  if (row.agent !== 'codex') return;
  if (arg === 'app-server') row.shared = true;
  if (['exec-server', 'sandbox', 'mcp-server', 'login', '--version', '--help'].includes(arg ?? ''))
    row.agent = undefined;
}

function scriptArg(command: string) {
  return (
    command
      .match(/^(?:"[^"]*"|\S+)\s+(?:"([^"]+)"|(\S+))/)
      ?.slice(1)
      .find(Boolean) ?? ''
  );
}

async function macRows(details: boolean) {
  const uid = String(process.getuid!());
  const { stdout } = await execute(
    '/bin/ps',
    ['-U', uid, '-ww', '-o', 'uid=,pid=,ppid=,lstart=,rss=,time=,comm='],
    options
  );
  const inspect = new Map<number, { row: ProcessRow; exe: string }>();
  const rows: ProcessRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(\d+)\s+(?:(\d+):)?(\d+):([\d.]+)\s+(.+)$/
    );
    if (!m || m[1] !== uid) continue;
    const row = {
      pid: +m[2],
      parent: +m[3],
      start: m[4],
      bytes: +m[5] * 1024,
      ms: ((+(m[6] || 0) * 60 + +m[7]) * 60 + +m[8]) * 1000,
      ...identify(m[9])
    };
    rows.push(row);
    if (details && (node.test(m[9]) || row.agent === 'codex'))
      inspect.set(row.pid, { row, exe: m[9] });
  }
  if (inspect.size) {
    const args = await execute(
      '/bin/ps',
      ['-p', [...inspect.keys()].join(','), '-ww', '-o', 'pid=,args='],
      options
    ).catch(() => null);
    for (const line of args?.stdout.split('\n') ?? []) {
      const m = line.match(/^\s*(\d+)\s+(.+)$/);
      const found = m && inspect.get(+m[1]);
      if (!m || !found) continue;
      const { row, exe } = found;
      const args = m[2].startsWith(exe + ' ')
        ? m[2].slice(exe.length).trimStart()
        : m[2].replace(/^(?:"[^"]*"|\S+)\s*/, '');
      if (node.test(exe)) Object.assign(row, identify(exe, scriptArg('node ' + args)));
      codexRole(row, args.split(/\s+/)[row.launcher ? 1 : 0]);
    }
  }
  return rows;
}

async function linuxRows(details: boolean) {
  const uid = process.getuid!();
  const conf = async (key: string) => Number((await execute('getconf', [key], options)).stdout);
  const [ticks, page, entries] = await Promise.all([
    conf('CLK_TCK'),
    conf('PAGESIZE'),
    readdir('/proc')
  ]);
  const rows: ProcessRow[] = [];
  // Limit concurrent file reads on machines with many processes.
  const dirs = entries.filter((name) => /^\d+$/.test(name));
  for (let i = 0; i < dirs.length; i += 32) {
    await Promise.all(
      dirs.slice(i, i + 32).map(async (id) => {
        const dir = join('/proc', id);
        try {
          if ((await stat(dir)).uid !== uid) return;
          const info = await readFile(join(dir, 'stat'), 'utf8');
          const fields = info.slice(info.lastIndexOf(')') + 2).split(' ');
          const exe = details ? await readlink(join(dir, 'exe')).catch(() => '') : '';
          const args =
            node.test(exe) || identify(exe).agent === 'codex'
              ? (await readFile(join(dir, 'cmdline'), 'utf8').catch(() => '')).split('\0')
              : [];
          const tool = identify(exe, args[1]);
          codexRole(tool, args[tool.launcher ? 2 : 1]);
          rows.push({
            pid: +id,
            parent: +fields[1],
            start: fields[19],
            ms: ((+fields[11] + +fields[12]) * 1000) / ticks,
            bytes: Math.max(0, +fields[21]) * page,
            ...tool
          });
        } catch {
          /* A process can exit or become private between directory and stat reads. */
        }
      })
    );
  }
  return rows;
}

// tasklist filters by account across login sessions in one call.
// Keep prompts and other processes' arguments inside the reader.
const windowsRead = String.raw`
$ErrorActionPreference = 'Stop'
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$owned = @{}
$tasklist = Join-Path ([Environment]::SystemDirectory) 'tasklist.exe'
& $tasklist /FI "USERNAME eq $account" /FO CSV /NH | ConvertFrom-Csv -Header Image,Id,Session,Number,Memory | ForEach-Object { $owned[[string]$_.Id] = $true }
Get-CimInstance Win32_Process | ForEach-Object {
  $p = $_
  if ($p.ExecutablePath -and $owned.ContainsKey([string]$p.ProcessId)) {
    $entry = ''
    $role = ''
    if ($p.Name -eq 'node.exe' -and $p.CommandLine -match '^(?:"[^"]*"|\S+)\s+(?:"([^"]+)"|(\S+))') { $entry = $matches[1] + $matches[2] }
    if ($p.Name -eq 'codex.exe' -and $p.CommandLine -match '^(?:"[^"]*"|\S+)\s+(app-server|exec-server|sandbox|mcp-server|login)(?:\s|$)') { $role = $matches[1] }
    [Console]::WriteLine((@($p.ProcessId,$p.ParentProcessId,$p.CreationDate.Ticks,([decimal]$p.UserModeTime + [decimal]$p.KernelModeTime),$p.WorkingSetSize,$p.ExecutablePath,$entry,$role) -join [char]9))
  }
}`;
async function windowsRows() {
  const shell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const { stdout } = await execute(
    shell,
    ['-NoProfile', '-NonInteractive', '-Command', windowsRead],
    options
  );
  return stdout
    .trimEnd()
    .split(/\r?\n/)
    .flatMap((line) => {
      const [pid, parent, start, cpu, bytes, exe, entry, role] = line.split('\t');
      if (!exe || ![pid, parent, cpu, bytes].every((n) => Number.isFinite(Number(n)))) return [];
      const tool = identify(exe, entry);
      codexRole(tool, role);
      return [{ pid: +pid, parent: +parent, start, ms: +cpu / 10000, bytes: +bytes, ...tool }];
    });
}

export async function processRows(details: boolean) {
  const platform = currentPlatform();
  const rows =
    platform === 'darwin'
      ? await macRows(details)
      : platform === 'linux'
        ? await linuxRows(details)
        : platform === 'win32'
          ? await windowsRows()
          : [];
  if (!rows.some((p) => p.pid === process.pid)) throw new Error('The process list is unavailable.');
  return rows;
}

export type ProcessFiles = { project?: string; sessions: Set<string> };
function fileName(files: ProcessFiles, path: string) {
  const id = basename(path).match(
    /^rollout-.*-([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.jsonl$/i
  )?.[1];
  if (id) files.sessions.add(id);
}

/** Open files identify conversations sharing a Codex server. No transcript is opened or returned. */
export async function processFiles(pids: number[]) {
  const result = new Map<number, ProcessFiles>(pids.map((pid) => [pid, { sessions: new Set() }]));
  if (!pids.length) return result;
  if (currentPlatform() === 'darwin') {
    const args = ['-nP', '-a', '-p', pids.join(','), '-Fpfn'];
    // lsof may exit 1 with valid rows if one process exited during the read.
    const { stdout } = await execute('/usr/sbin/lsof', args, options).catch((e: unknown) => ({
      stdout:
        e && typeof e === 'object' && 'stdout' in e && typeof e.stdout === 'string' ? e.stdout : ''
    }));
    let files: ProcessFiles | undefined,
      fd = '';
    for (const line of stdout.split('\n')) {
      if (line.startsWith('p')) files = result.get(Number(line.slice(1)));
      else if (line.startsWith('f')) fd = line.slice(1);
      else if (files && line.startsWith('n')) {
        if (fd === 'cwd') files.project = basename(line.slice(1));
        else fileName(files, line.slice(1));
      }
    }
  } else if (currentPlatform() === 'linux') {
    for (const [pid, files] of result) {
      const dir = '/proc/' + pid;
      files.project = basename(await readlink(dir + '/cwd').catch(() => ''));
      for (const fd of await readdir(dir + '/fd').catch(() => [])) {
        fileName(files, await readlink(dir + '/fd/' + fd).catch(() => ''));
      }
    }
  }
  return result;
}
