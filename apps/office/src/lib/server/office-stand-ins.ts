// A stage of office-under-test.ts, not an entry point: the stand-in scripts the
// office runs in place of the real tools.
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { folder, bin, EXIT_BEFORE_READING } from './office-test-home.ts';

// What every stand-in does the same way, after its version and sign-in
// commands. A message whose last line says "Hold until <file> exists." keeps
// the run going until it does. Then "Fail now." says
// "The stand-in failed as told." on stderr, sends the tool's own failed result
// and exits 1, and "Start a command and wait." starts a node process in a
// group of its own, writes its pid to command.pid in the run's folder, and
// never ends. The command needs its own group: in the tool's, the stop on the
// run's end would reach it through that group alone, so a test of the stop
// that walks the tree would pass with no walk.
const SHARED = `if (process.env[${JSON.stringify(EXIT_BEFORE_READING)}]) process.exit(0);
const lastOf = (text) => text.trimEnd().split('\\n').at(-1);
function holdThen(last, go) {
  const hold = /Hold until (\\/[^\\s"\\\\]+) exists/.exec(last)?.[1];
  if (!hold) return go();
  const wait = setInterval(() => fs.existsSync(hold) && (clearInterval(wait), go()), 20);
}
function failNow(result) {
  process.stderr.write('The stand-in failed as told.\\n', () =>
    process.stdout.write(JSON.stringify(result) + '\\n', () => process.exit(1))
  );
}
function startCommand() {
  const command = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { detached: true, stdio: 'ignore' });
  fs.writeFileSync('command.pid', String(command.pid));
  setInterval(() => {}, 60_000);
}`;
writeFileSync(
  join(bin, 'claude'),
  `#!/usr/bin/env node
const fs = require('node:fs');
// "--version" prints versions/claude in the test office, else the oldest the office runs.
if (process.argv[2] === '--version') {
  const v = ${JSON.stringify(join(folder, 'versions', 'claude'))};
  process.stdout.write('' + (fs.existsSync(v) ? fs.readFileSync(v, 'utf8').trim() : '2.1.318') + '\\n');
  process.exit(0);
}
const [verb, sub] = process.argv.slice(2);
if (verb === 'auth' && sub === 'status') {
  // Signed in only in an account's folder holding a "signed-in" file, which names the email.
  const mark = (process.env.CLAUDE_CONFIG_DIR ?? '/nowhere') + '/signed-in';
  process.stdout.write(
    fs.existsSync(mark)
      ? JSON.stringify({ loggedIn: true, email: fs.readFileSync(mark, 'utf8').trim() }) + '\\n'
      : '{"loggedIn":false}\\n'
  );
  process.exit(0);
}
if (verb === 'auth' && sub === 'logout') process.exit(0);
if (verb === 'auth' && sub === 'login') {
  process.stdout.write('Opening https://claude.ai/oauth/authorize?test\\n');
  setInterval(() => {}, 60_000);
  return;
}
${SHARED}
let message = '';
/** What each stream-json user line after the first said, before the result. */
const added = [];
/** What each user line after the result said. */
const late = [];
let answered = false;
const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
/** The owner's words in a chat, or a job's instructions, which come last. */
const lastLine = () => message.trimEnd().split('\\n').at(-1);
const streamed = process.argv.includes('--input-format');
let lines = '';
let started = false;
const textOf = (content) => content.filter((b) => b.type === 'text').map((b) => b.text).join('\\n');
process.stdin.on('data', (d) => {
  if (!streamed) return void (message += d);
  lines += d;
  let nl;
  while ((nl = lines.indexOf('\\n')) >= 0) {
    const line = lines.slice(0, nl);
    lines = lines.slice(nl + 1);
    if (!line.trim()) continue;
    const content = JSON.parse(line).message.content;
    if (started) {
      (answered ? late : added).push(textOf(content));
      continue;
    }
    // A turn with a picture comes back whole, for a test to read its blocks.
    message = content.some((b) => b.type !== 'text') ? line : textOf(content);
    started = true;
    start();
  }
});
process.stdin.on('end', () => {
  if (!streamed) return start();
  // Late words that say "Fail now." get a failed result; any others get a reply of their own.
  for (const words of late)
    line(
      words === 'Fail now.'
        ? { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Failed late.'] }
        : { type: 'result', subtype: 'success', result: 'Then: ' + words }
    );
});
function start() {
  holdThen(lastLine(), answer);
}
/** After any hold, so two runs can be refused at once. */
function answer() {
  if (lastLine().includes('Fail now.'))
    return failNow({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Failed as told.'] });
  if (lastLine().includes('Start a command and wait.')) return startCommand();
  // Ends with an error and no result, as a tool that crashed does.
  if (lastLine().includes('Exit with an error.'))
    return process.stderr.write('The stand-in exited as told.\\n', () => process.exit(3));
  // Only a staff run carries --settings, so it is read only for the trigger.
  if (
    lastLine().includes('Refuse the open network') &&
    settings().sandbox?.network?.allowedDomains?.includes('*')
  ) {
    process.stderr.write('Overly broad patterns like "*" are not allowed\\n');
    if (lastLine().includes('and wait.')) return void setInterval(() => {}, 60_000);
    process.exit(1);
  }
  reply();
}
/** A staff run's settings, from the file --settings names; the office's own runs pass them inline. */
function settings() {
  const v = process.argv[process.argv.indexOf('--settings') + 1];
  return JSON.parse(v.startsWith('{') ? v : fs.readFileSync(v, 'utf8'));
}
function emptyFolder(p) {
  try {
    return fs.readdirSync(p).length === 0;
  } catch {
    return false;
  }
}
function reply() {
  answered = true;
  const args = process.argv.slice(2);
  const after = (flag) => args[args.indexOf(flag) + 1];
  // A staff run passes the servers as a file, read here while the run goes; the office's own runs pass them inline.
  const config = after('--mcp-config');
  const mcp = JSON.parse(config.startsWith('{') ? config : fs.readFileSync(config, 'utf8'));
  const gave = {
    args,
    envNames: Object.keys(process.env).sort(),
    mcp,
    env: mcp.mcpServers.office?.env,
    // A staff run's settings and system prompt come in files, read here while the run goes; the office's own runs pass both inline.
    claudeSettings: settings(),
    system: args.includes('--append-system-prompt-file')
      ? fs.readFileSync(after('--append-system-prompt-file'), 'utf8')
      : after('--append-system-prompt'),
    message,
    added,
    claudeMds: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS ?? null,
    autoMemory: process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY ?? null,
    tmpdir: process.env.CLAUDE_CODE_TMPDIR ?? null,
    git: Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('GIT_'))),
    gitTemplate: emptyFolder(process.env.GIT_TEMPLATE_DIR),
    npm: {
      npm_config_cache: process.env.npm_config_cache ?? null,
      npm_config_userconfig: process.env.npm_config_userconfig ?? null
    },
    nodeOptions: process.env.NODE_OPTIONS ?? null,
    apiKey: process.env.ANTHROPIC_API_KEY ?? null,
    configDir: process.env.CLAUDE_CONFIG_DIR ?? null
  };
  line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'look' } } });
  const aloud = /Think aloud: ([^.]+)\./.exec(message)?.[1];
  if (aloud) line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: aloud } } });
  // Claude Code sends each text block whole as well, after its streamed pieces.
  if (aloud && lastLine().includes('Send it whole too.'))
    line({ type: 'assistant', message: { content: [{ type: 'text', text: aloud }] } });
  // "Plan used: 0.25" reports that share of the five-hour window, as Claude Code's rate_limit_event does.
  const used = /Plan used: (0\\.\\d+)/.exec(lastLine())?.[1];
  if (used) line({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { five_hour: { utilization: Number(used) } } } });
  // A failed result that keeps the run going, so words added after it get their own results.
  if (lastLine().includes('Fail and go on.'))
    return line({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Failed first.'] });
  if (lastLine().includes('Succeed with an error.'))
    return line({ type: 'result', subtype: 'success', is_error: true, result: 'It went wrong.' });
  if (lastLine().includes('Succeed with no text.')) return line({ type: 'result', subtype: 'success' });
  line({ type: 'result', subtype: 'success', result: JSON.stringify(gave) + '\\nOutcome: done' });
}
`
);
chmodSync(join(bin, 'claude'), 0o755);
// The stand-in for Grok, which reads no input: it sends back its arguments, the
// Grok, git and key variables it got, its agent file's MCP servers and the tool
// server's environment from them, and its sandbox profile when it has one (none
// on Windows). Then one MCP call the way Grok streams it
// (through use_tool), and a result. A message that ends "Replay <file>"
// gets that recorded stream instead (only at the end, since a later prompt
// can quote an earlier message that failed), and its arguments go in replay-args.json.
// "grok models", which renews the sign-in, adds a dot to models.log in the
// Grok home, and puts renewed.json there as the sign-in when there is one.
// With hang.pid in the Grok home, it writes its pid there and never ends,
// whatever SIGTERM says. Its arguments go in models-args.json.
// "grok login" logs its arguments and home in logins.jsonl and its pid in
// login.pid, prints its sign-in page, and waits for login.go in its home:
// then it keeps a sign-in for owner@example.com and ends. "grok logout"
// adds a dot to logouts.log. Its message, from a plain-text prompt file
// (`--prompt-file`), takes the markers every stand-in takes (`SHARED`), with
// Claude Code's failed result.
writeFileSync(
  join(bin, 'grok'),
  `#!/usr/bin/env node
const fs = require('node:fs');
// "--version" prints versions/grok in the test office, else the oldest the office runs.
if (process.argv[2] === '--version') {
  const v = ${JSON.stringify(join(folder, 'versions', 'grok'))};
  process.stdout.write('grok ' + (fs.existsSync(v) ? fs.readFileSync(v, 'utf8').trim() : '1.0.77') + '\\n');
  process.exit(0);
}
const args = process.argv.slice(2);
const home = process.env.GROK_HOME;
if (args[0] === 'login') {
  fs.appendFileSync(home + '/logins.jsonl', JSON.stringify({ args, home }) + '\\n');
  fs.writeFileSync(home + '/login.pid', String(process.pid));
  process.stdout.write('Open this URL to sign in: https://auth.x.ai/oauth2/authorize?client_id=test&redirect_uri=http://127.0.0.1:5000/callback\\n');
  setInterval(() => {
    if (!fs.existsSync(home + '/login.go')) return;
    fs.rmSync(home + '/login.go');
    const expires_at = new Date(Date.now() + 86_400_000).toISOString();
    fs.writeFileSync(home + '/auth.json', JSON.stringify({ 'https://auth.x.ai::test': { email: 'owner@example.com', expires_at } }));
    process.stdout.write('Signed in as owner@example.com\\n');
    process.exit(0);
  }, 20);
  return;
}
if (args[0] === 'logout') {
  fs.appendFileSync(home + '/logouts.log', '.');
  process.exit(0);
}
if (args[0] === 'models') {
  fs.writeFileSync(home + '/models-args.json', JSON.stringify(args));
  fs.appendFileSync(process.env.GROK_HOME + '/models.log', '.');
  const hang = process.env.GROK_HOME + '/hang.pid';
  if (fs.existsSync(hang)) {
    fs.writeFileSync(hang, String(process.pid));
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 60_000);
    return;
  }
  const renewed = process.env.GROK_HOME + '/renewed.json';
  if (fs.existsSync(renewed)) fs.copyFileSync(renewed, process.env.GROK_HOME + '/auth.json');
  process.exit(0);
}
// As grok 1.0.46 refuses a value that starts with "- " after its flag (measured).
if (args.some((a) => a.startsWith('- '))) {
  process.stderr.write("error: unexpected argument '- ' found");
  process.exit(2);
}
${SHARED}
const after = (flag) => args[args.indexOf(flag) + 1];
// The message comes in the file --prompt-file names: plain text, or content blocks in a .json file.
const promptPath = after('--prompt-file');
const promptText = fs.readFileSync(promptPath, 'utf8');
const blocks = promptPath.endsWith('.json') ? JSON.parse(promptText) : undefined;
// A message with pictures carries no marker.
const text = blocks ? '' : promptText;
const replay = /Replay (\\/[^\\r\\n]+\\.jsonl)\\s*$/.exec(text)?.[1];
if (replay) {
  fs.writeFileSync(process.env.GROK_HOME + '/replay-args.json', JSON.stringify(args));
  process.stdout.write(fs.readFileSync(replay, 'utf8'));
  process.exit(0);
}
holdThen(lastOf(text), answer);
function answer() {
  const last = lastOf(text);
  if (last.includes('Fail now.'))
    return failNow({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['Failed as told.'] });
  if (last.includes('Start a command and wait.')) return startCommand();
  const agent = fs.readFileSync(after('--agent'), 'utf8');
  const profile = args.includes('--sandbox')
    ? fs
        .readFileSync(process.env.GROK_HOME + '/sandbox.toml', 'utf8')
        .split(/^(?=\\[profiles\\.)/m)
        .find((b) => b.startsWith('[profiles.' + after('--sandbox') + ']'))
    : undefined;
  const servers = Object.assign({}, ...JSON.parse(/^mcpServers: (.*)$/m.exec(agent)[1]));
  const gave = {
    args,
    envNames: Object.keys(process.env).sort(),
    grokEnv: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => /^(GROK_|XAI_|ANTHROPIC_API_KEY|TMPDIR|NODE_OPTIONS|GIT_)/.test(k))
    ),
    env: servers.office?.env,
    servers,
    home: process.env.HOME,
    agentMode: fs.statSync(after('--agent')).mode & 0o777,
    profile,
    // The system prompt is the agent file's body, after its frontmatter.
    system: agent.replace(/^---\\n[\\s\\S]*?\\n---\\n/, '').replace(/\\n$/, ''),
    promptMode: /^prompt_mode: (.*)$/m.exec(agent)?.[1],
    promptFileMode: fs.statSync(promptPath).mode & 0o777,
    message: blocks ? undefined : promptText,
    prompt: blocks
  };
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  line({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'use_tool' } } });
  line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'use_tool', input: { tool_name: 'office__raise_ask', tool_input: {} } }] } });
  line({ type: 'result', subtype: 'success', result: JSON.stringify(gave) + '\\nOutcome: done' });
}
`
);
chmodSync(join(bin, 'grok'), 0o755);
// The stand-in for Codex, which reads the message on stdin: it sends back its
// arguments, the Codex, git and key variables it got, what its `-c` values set
// (the MCP servers, the permission profile, the instructions, its shell's git
// environment), and whether the git template folder that names was there and
// empty as it ran (`done()` removes it after), in the item
// shapes `codex exec --json` prints (exec_events.rs): a shell command, an MCP
// call, a file change, two messages and the turn's tokens. A message that
// ends "Replay <file>" gets that recorded stream instead, and one that says
// "Leave a sleeper at <file>" first starts a `sleep` that outlives it, in its
// process group, and writes its pid there. Every launch's arguments go in
// launches.jsonl, a line each. "codex login" is no launch: it logs its
// arguments, home and whether config.toml was there in logins.jsonl and its
// pid in login.pid, prints its callback server and then its sign-in page, and
// waits for login.go in its home: then it keeps a sign-in whose ID token
// names owner@example.com and ends. "codex logout" adds a dot to logouts.log.
// A launch takes the markers every stand-in takes (`SHARED`), failing with
// turn.failed.
writeFileSync(
  join(bin, 'codex'),
  `#!/usr/bin/env node
const fs = require('node:fs');
// "--version" prints versions/codex in the test office, else the oldest the office runs.
if (process.argv[2] === '--version') {
  const v = ${JSON.stringify(join(folder, 'versions', 'codex'))};
  process.stdout.write('codex-cli ' + (fs.existsSync(v) ? fs.readFileSync(v, 'utf8').trim() : '0.166.0') + '\\n');
  process.exit(0);
}
const args = process.argv.slice(2);
const home = process.env.CODEX_HOME;
if (args[0] === 'login') {
  const configFirst = fs.existsSync(home + '/config.toml');
  fs.appendFileSync(home + '/logins.jsonl', JSON.stringify({ args, home, configFirst }) + '\\n');
  fs.writeFileSync(home + '/login.pid', String(process.pid));
  process.stdout.write('Starting local login server on http://localhost:1455.\\nIf your browser did not open, navigate to this URL to authenticate:\\n\\nhttps://auth.openai.com/oauth/authorize?client_id=test\\n');
  setInterval(() => {
    if (!fs.existsSync(home + '/login.go')) return;
    fs.rmSync(home + '/login.go');
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const id_token = part({ alg: 'none' }) + '.' + part({ email: 'owner@example.com' }) + '.sig';
    fs.writeFileSync(home + '/auth.json', JSON.stringify({ tokens: { id_token } }));
    process.exit(0);
  }, 20);
  return;
}
if (args[0] === 'logout') {
  fs.appendFileSync(home + '/logouts.log', '.');
  process.exit(0);
}
${SHARED}
fs.appendFileSync(process.env.CODEX_HOME + '/launches.jsonl', JSON.stringify(args) + '\\n');
function emptyFolder(p) {
  try {
    return fs.readdirSync(p).length === 0;
  } catch {
    return false;
  }
}
let message = '';
process.stdin.on('data', (d) => (message += d));
process.stdin.on('end', () => holdThen(lastOf(message), answer));
function answer() {
  if (lastOf(message).includes('Fail now.'))
    return failNow({ type: 'turn.failed', error: { message: 'Failed as told.' } });
  if (lastOf(message).includes('Start a command and wait.')) return startCommand();
  const replay = /Replay (\\/[^\\r\\n]+\\.jsonl)\\s*$/.exec(message)?.[1];
  if (replay) return process.stdout.write(fs.readFileSync(replay, 'utf8'));
  const sleeper = /Leave a sleeper at (\\/\\S+)/.exec(message)?.[1];
  if (sleeper) {
    const s = require('node:child_process').spawn('sleep', ['60'], { stdio: 'ignore' });
    fs.writeFileSync(sleeper, String(s.pid));
    s.unref();
  }
  // The office writes each -c value with JSON strings, so an inline table is JSON once its " = " is ": ".
  const set = {};
  args.forEach((a, i) => {
    if (args[i - 1] !== '-c') return;
    const v = a.slice(a.indexOf('=') + 1);
    set[a.slice(0, a.indexOf('='))] = JSON.parse(v.startsWith('{') ? v.replaceAll('" = ', '": ') : v);
  });
  const gave = {
    args,
    envNames: Object.keys(process.env).sort(),
    codexEnv: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => /^(CODEX_|OPENAI_|ANTHROPIC_API_KEY|TMPDIR|NODE_OPTIONS|GIT_)/.test(k))
    ),
    git: set['shell_environment_policy.set'],
    gitTemplate: emptyFolder(set['shell_environment_policy.set']?.GIT_TEMPLATE_DIR),
    env: set.mcp_servers.office?.env,
    servers: set.mcp_servers,
    // Whether each picture was there as the run read it (an office run's).
    pictures: args.filter((a) => a.startsWith('--image=')).map((a) => fs.existsSync(a.slice(8))),
    // None on Windows, where the run has Codex's read-only mode instead.
    permissions: set.permissions?.[set.default_permissions],
    system: set.developer_instructions,
    message,
    temp: fs.existsSync(process.env.TMPDIR)
  };
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  const item = (type, o) => line({ type, item: o });
  line({ type: 'thread.started', thread_id: '019a0000-0000-7000-8000-00000000c0de' });
  line({ type: 'turn.started' });
  item('item.started', { id: 'item_0', type: 'command_execution', command: 'ls', status: 'in_progress' });
  item('item.completed', { id: 'item_0', type: 'command_execution', command: 'ls', exit_code: 0, status: 'completed' });
  item('item.started', { id: 'item_1', type: 'mcp_tool_call', server: 'office', tool: 'raise_ask', status: 'in_progress' });
  item('item.completed', { id: 'item_1', type: 'mcp_tool_call', server: 'office', tool: 'raise_ask', status: 'completed' });
  item('item.completed', { id: 'item_2', type: 'file_change', changes: [{ path: 'notes.md', kind: 'add' }], status: 'completed' });
  item('item.completed', { id: 'item_3', type: 'agent_message', text: 'Looking.' });
  item('item.completed', { id: 'item_4', type: 'agent_message', text: JSON.stringify(gave) + '\\nOutcome: done' });
  line({
    type: 'turn.completed',
    usage: { input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 20 }
  });
}
`
);
chmodSync(join(bin, 'codex'), 0o755);
// The stand-in for Gemini, which reads the message on stdin: like Gemini, it
// runs a message that starts with "/" as a command of its own, and fails it.
// Else it sends back its arguments, the Gemini, git and key variables it got, its
// run folder's policy, settings and instructions, and the message, in the
// event shapes `gemini -o stream-json` prints: the session, an echo of the
// message, a reply in pieces, a file tool and an MCP call, the reply's last
// message in two pieces and the result's tokens. A message that ends "End in
// error" gets a failed result instead (only at the end, since a later prompt
// can quote an earlier message that failed). Each launch adds a dot to launches.log
// in the Gemini home. It takes the markers every stand-in takes (`SHARED`),
// failing with its error result.
writeFileSync(
  join(bin, 'gemini'),
  `#!/usr/bin/env node
const fs = require('node:fs');
// "--version" prints versions/gemini in the test office, else the oldest the office runs.
if (process.argv[2] === '--version') {
  const v = ${JSON.stringify(join(folder, 'versions', 'gemini'))};
  process.stdout.write('' + (fs.existsSync(v) ? fs.readFileSync(v, 'utf8').trim() : '0.66.0') + '\\n');
  process.exit(0);
}
${SHARED}
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.GEMINI_CLI_HOME + '/launches.log', '.');
let message = '';
process.stdin.on('data', (d) => (message += d));
process.stdin.on('end', () => holdThen(lastOf(message), answer));
function answer() {
  if (lastOf(message).includes('Fail now.'))
    return failNow({ type: 'result', status: 'error', error: { type: 'Error', message: 'Failed as told.' } });
  if (lastOf(message).includes('Start a command and wait.')) return startCommand();
  const line = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
  line({ type: 'init', session_id: '0a0a0a0a-0000-4000-8000-00000000ce01', model: 'gemini-test' });
  if (message.startsWith('/'))
    return line({ type: 'result', status: 'error', error: { type: 'Error', message: 'Ran a slash command.' } });
  if (/End in error\\s*$/.test(message))
    return line({ type: 'result', status: 'error', error: { type: 'Error', message: 'Quota used up.' } });
  const settingsPath = process.env.GEMINI_CLI_SYSTEM_SETTINGS_PATH;
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const run = path.dirname(settingsPath);
  const gave = {
    args,
    envNames: Object.keys(process.env).sort(),
    geminiEnv: Object.fromEntries(
      Object.entries(process.env).filter(([k]) => /^(GEMINI_|GOOGLE_|ANTHROPIC_API_KEY|NODE_OPTIONS|GIT_)/.test(k))
    ),
    env: settings.mcpServers.office.env,
    settings,
    settingsMode: fs.statSync(settingsPath).mode & 0o777,
    runMode: fs.statSync(run).mode & 0o777,
    policy: fs.readFileSync(path.join(run, 'policy.toml'), 'utf8'),
    system: fs.readFileSync(process.env.GEMINI_SYSTEM_MD, 'utf8'),
    message
  };
  line({ type: 'message', role: 'user', content: message });
  line({ type: 'message', role: 'assistant', content: 'Look', delta: true });
  line({ type: 'message', role: 'assistant', content: 'ing.', delta: true });
  line({ type: 'tool_use', tool_name: 'read_file', tool_id: 't1', parameters: { file_path: 'x' } });
  line({ type: 'tool_result', tool_id: 't1', status: 'success', output: '' });
  line({ type: 'tool_use', tool_name: 'mcp_office_raise_ask', tool_id: 't2', parameters: {} });
  line({ type: 'tool_result', tool_id: 't2', status: 'success', output: '' });
  const reply = JSON.stringify(gave) + '\\nOutcome: done';
  line({ type: 'message', role: 'assistant', content: reply.slice(0, 20), delta: true });
  line({ type: 'message', role: 'assistant', content: reply.slice(20), delta: true });
  line({
    type: 'result',
    status: 'success',
    stats: { models: { 'gemini-test': { total_tokens: 1050, input_tokens: 1000, output_tokens: 50, cached: 600, input: 400 } } }
  });
}
`
);
chmodSync(join(bin, 'gemini'), 0o755);
