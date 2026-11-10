import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const worker = fileURLToPath(new URL('./pi-worker.ts', import.meta.url));
const frame = (data: object) => `data: ${JSON.stringify(data)}\n\n`;

test('actual Pi SDK streams through only the selected local Responses gateway and resumes its own session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-pi-worker-'));
  const requests: { authorization?: string; body: any }[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (part) => {
      body += part;
    });
    req.on('end', () => {
      requests.push({ authorization: req.headers.authorization, body: JSON.parse(body) });
      const truncated = body.includes('Truncate.');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const item = {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Hello from Pi', annotations: [] }]
      };
      const events = [
        { type: 'response.created', response: { id: 'resp_1' } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: { ...item, status: 'in_progress', content: [] }
        },
        {
          type: 'response.output_text.delta',
          output_index: 0,
          content_index: 0,
          item_id: 'msg_1',
          delta: 'Hello from Pi'
        },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: truncated ? 'response.incomplete' : 'response.completed',
          response: {
            id: 'resp_1',
            status: truncated ? 'incomplete' : 'completed',
            ...(truncated ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
            output: [item],
            usage: {
              input_tokens: 9,
              output_tokens: 4,
              total_tokens: 13,
              input_tokens_details: { cached_tokens: 0 }
            }
          }
        }
      ];
      for (const event of events) res.write(frame(event));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const config = {
    staffId: 'one',
    account: 'one',
    sourceIdentity: 'first-source',
    system: 'Test.',
    input: 'First.',
    sessionDir: join(dir, 'sessions'),
    baseUrl: `http://127.0.0.1:${addr.port}`,
    model: 'group/test',
    servers: {},
    allowed: [],
    images: [],
    timeoutMs: 4000,
    bare: false
  };
  async function run(input: object) {
    const child = spawn(process.execPath, [worker], {
      cwd: dir,
      env: { HOME: dir, PATH: process.env.PATH, ODDBORO_PI_API_KEY: 'fixture-key' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0, stderr);
    assert.ok(!stdout.includes('fixture-key'));
    return stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
  }
  try {
    const first = await run(config);
    assert.ok(
      first.some((e) => e.type === 'delta' && e.text === 'Hello from Pi'),
      JSON.stringify(first)
    );
    assert.ok(first.some((e) => e.type === 'message' && e.text === 'Hello from Pi'));
    assert.equal(first.at(-1).type, 'done');
    const session = first.find((e) => e.type === 'session')?.id;
    assert.ok(session);
    assert.equal(first.find((e) => e.type === 'usage').usage['group/test'].costUSD, null);
    const next = await run({ ...config, input: 'Second.', resume: session });
    assert.equal(next.at(-1).type, 'done');
    assert.equal(requests.length, 2);
    assert.equal(requests[0].authorization, 'Bearer fixture-key');
    assert.equal(requests[0].body.model, 'group/test');
    assert.match(JSON.stringify(requests[1].body), /First\./);
    const wrong = await run({ ...config, sourceIdentity: 'other-source', resume: session });
    assert.equal(wrong.at(-1).type, 'failed');
    const otherAccount = await run({ ...config, account: 'other', resume: session });
    const otherStaff = await run({ ...config, staffId: 'other', resume: session });
    assert.equal(otherAccount.at(-1).type, 'failed');
    assert.equal(otherStaff.at(-1).type, 'failed');
    assert.equal(requests.length, 2);
    const bare = await run({ ...config, bare: true, input: 'Office task.' });
    assert.equal(bare.at(-1).type, 'done');
    assert.ok(!bare.some((event) => event.type === 'session'));
    assert.ok(!requests[2].body.tools || requests[2].body.tools.length === 0);
    const short = await run({ ...config, input: 'Truncate.' });
    assert.equal(short.at(-1).type, 'failed');
    assert.ok(!short.some((event) => event.type === 'session'));
    assert.equal(short.find((event) => event.type === 'usage').usage['group/test'].outputTokens, 4);
    assert.equal(short.find((event) => event.type === 'usage').usage['group/test'].costUSD, null);
    const stored = await readFile(
      join(
        config.sessionDir,
        (await import('node:crypto'))
          .createHash('sha256')
          .update(JSON.stringify(['one', 'one', 'first-source', config.baseUrl, config.model]))
          .digest('hex'),
        `${session}.json`
      ),
      'utf8'
    );
    assert.ok(!stored.includes('fixture-key'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pi exposes only granted MCP tools and invokes them without the gateway key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-pi-mcp-'));
  const requests: any[] = [];
  const mcp = `
let buf='';
process.stdin.on('data', (chunk) => { buf+=chunk; for (;;) { const n=buf.indexOf('\\n'); if(n<0) break; const line=buf.slice(0,n); buf=buf.slice(n+1); if(!line) continue; const msg=JSON.parse(line); if(msg.id===undefined) continue; let result={}; if(msg.method==='initialize') result={protocolVersion:msg.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}; if(msg.method==='tools/list') result={tools:[{name:'allowed',description:'Allowed',inputSchema:{type:'object',properties:{},additionalProperties:false}},{name:'denied',description:'Denied',inputSchema:{type:'object',properties:{}}}]}; if(msg.method==='tools/call') result={content:[{type:'text',text:msg.params.name+':'+(process.env.ODDBORO_PI_API_KEY?'leaked':'clean')}]}; process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\\n'); } });`;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (part) => {
      body += part;
    });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const call = requests.length === 1;
      const item = call
        ? {
            id: 'fc_1',
            type: 'function_call',
            call_id: 'call_1',
            name: 'mcp__office__allowed',
            arguments: '{}',
            status: 'completed'
          }
        : {
            id: 'msg_2',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Tool done', annotations: [] }]
          };
      const events: object[] = [
        { type: 'response.created', response: { id: `resp_${requests.length}` } },
        {
          type: 'response.output_item.added',
          output_index: 0,
          item: call
            ? { ...item, arguments: '', status: 'in_progress' }
            : { ...item, content: [], status: 'in_progress' }
        },
        ...(call
          ? [
              {
                type: 'response.function_call_arguments.delta',
                output_index: 0,
                item_id: 'fc_1',
                delta: '{}'
              }
            ]
          : [
              {
                type: 'response.output_text.delta',
                output_index: 0,
                item_id: 'msg_2',
                content_index: 0,
                delta: 'Tool done'
              }
            ]),
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id: `resp_${requests.length}`,
            status: 'completed',
            output: [item],
            usage: {
              input_tokens: 5,
              output_tokens: 2,
              total_tokens: 7,
              input_tokens_details: { cached_tokens: 0 }
            }
          }
        }
      ];
      for (const event of events) res.write(frame(event));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const input = {
    staffId: 'one',
    account: 'one',
    sourceIdentity: 'source',
    system: 'Use the tool.',
    input: 'Run it.',
    sessionDir: join(dir, 'sessions'),
    baseUrl: `http://127.0.0.1:${addr.port}`,
    model: 'group/test',
    servers: { office: { command: process.execPath, args: ['-e', mcp], env: {} } },
    allowed: ['mcp__office__allowed'],
    images: [],
    timeoutMs: 4000,
    bare: false
  };
  try {
    const child = spawn(process.execPath, [worker], {
      cwd: dir,
      env: { HOME: dir, PATH: process.env.PATH, ODDBORO_PI_API_KEY: 'fixture-key' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0, stderr);
    const events = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'done', stdout);
    assert.ok(events.some((e) => e.type === 'tool' && e.name === 'mcp__office__allowed'));
    const wire = JSON.stringify(requests[0]);
    assert.match(wire, /mcp__office__allowed/);
    assert.doesNotMatch(wire, /mcp__office__denied/);
    assert.match(JSON.stringify(requests[1]), /allowed:clean/);
    assert.ok(!stdout.includes('fixture-key'));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('cancel during MCP initialization aborts the worker and retires its child', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-pi-cancel-'));
  const pidFile = join(dir, 'mcp.pid');
  const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  const input = {
    staffId: 'one',
    account: 'one',
    sourceIdentity: 'source',
    system: 'Test',
    input: 'Test',
    sessionDir: join(dir, 'sessions'),
    baseUrl: 'http://127.0.0.1:9',
    model: 'group/test',
    servers: { office: { command: process.execPath, args: ['-e', script], env: {} } },
    allowed: ['mcp__office'],
    images: [],
    timeoutMs: 30000,
    bare: false
  };
  try {
    const child = spawn(process.execPath, [worker], {
      cwd: dir,
      env: { HOME: dir, PATH: process.env.PATH, ODDBORO_PI_API_KEY: 'fixture-key' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stdin.end(JSON.stringify(input));
    const deadline = Date.now() + 5000;
    let pid = 0;
    while (Date.now() < deadline) {
      try {
        pid = Number(await readFile(pidFile, 'utf8'));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    assert.ok(pid, 'MCP child did not start');
    child.kill('SIGTERM');
    const code = await Promise.race([
      new Promise<number | null>((resolve) => child.on('close', resolve)),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Canceled worker did not exit')), 8000).unref();
      })
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /The Pi run was stopped/);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cancel during inference aborts the local provider request without saving a session', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-pi-abort-'));
  let sawRequest!: () => void;
  const requested = new Promise<void>((resolve) => {
    sawRequest = resolve;
  });
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(frame({ type: 'response.created', response: { id: 'resp_pending' } }));
    sawRequest();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const input = {
    staffId: 'one',
    account: 'one',
    sourceIdentity: 'source',
    system: 'Test',
    input: 'Test',
    sessionDir: join(dir, 'sessions'),
    baseUrl: `http://127.0.0.1:${addr.port}`,
    model: 'group/test',
    servers: {},
    allowed: [],
    images: [],
    timeoutMs: 30000,
    bare: false
  };
  try {
    const child = spawn(process.execPath, [worker], {
      cwd: dir,
      env: { HOME: dir, PATH: process.env.PATH, ODDBORO_PI_API_KEY: 'fixture-key' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stdin.end(JSON.stringify(input));
    await requested;
    child.kill('SIGTERM');
    const code = await Promise.race([
      new Promise<number | null>((resolve) => child.on('close', resolve)),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Canceled inference did not exit')), 8000).unref();
      })
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /The Pi run was stopped/);
    assert.doesNotMatch(stdout, /"type":"session"/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('cancel during a granted MCP call stops the tool process', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-pi-tool-abort-'));
  const callFile = join(dir, 'calling');
  const pidFile = join(dir, 'mcp.pid');
  const script = `const fs=require('fs');fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));let buf='';process.stdin.on('data',c=>{buf+=c;for(;;){const n=buf.indexOf('\\n');if(n<0)break;const line=buf.slice(0,n);buf=buf.slice(n+1);if(!line)continue;const m=JSON.parse(line);if(m.id===undefined)continue;if(m.method==='tools/call'){fs.writeFileSync(${JSON.stringify(callFile)},'yes');continue;}const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{tools:[{name:'allowed',description:'Allowed',inputSchema:{type:'object',properties:{}}}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');}});setInterval(()=>{},1000);`;
  const server = createServer((req, res) => {
    req.resume();
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const item = {
      id: 'fc_1',
      type: 'function_call',
      call_id: 'call_1',
      name: 'mcp__office__allowed',
      arguments: '{}',
      status: 'completed'
    };
    for (const event of [
      { type: 'response.created', response: { id: 'resp_1' } },
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { ...item, arguments: '', status: 'in_progress' }
      },
      {
        type: 'response.function_call_arguments.delta',
        output_index: 0,
        item_id: 'fc_1',
        delta: '{}'
      },
      { type: 'response.output_item.done', output_index: 0, item },
      {
        type: 'response.completed',
        response: {
          id: 'resp_1',
          status: 'completed',
          output: [item],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            input_tokens_details: { cached_tokens: 0 }
          }
        }
      }
    ])
      res.write(frame(event));
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const input = {
    staffId: 'one',
    account: 'one',
    sourceIdentity: 'source',
    system: 'Test',
    input: 'Test',
    sessionDir: join(dir, 'sessions'),
    baseUrl: `http://127.0.0.1:${addr.port}`,
    model: 'group/test',
    servers: { office: { command: process.execPath, args: ['-e', script], env: {} } },
    allowed: ['mcp__office__allowed'],
    images: [],
    timeoutMs: 30000,
    bare: false
  };
  try {
    const child = spawn(process.execPath, [worker], {
      cwd: dir,
      env: { HOME: dir, PATH: process.env.PATH, ODDBORO_PI_API_KEY: 'fixture-key' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stdin.end(JSON.stringify(input));
    const deadline = Date.now() + 5000;
    let called = false;
    while (Date.now() < deadline) {
      try {
        await readFile(callFile);
        called = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 20));
      }
    }
    assert.ok(called, 'MCP tool was not called');
    const pid = Number(await readFile(pidFile, 'utf8'));
    child.kill('SIGTERM');
    const code = await Promise.race([
      new Promise<number | null>((resolve) => child.on('close', resolve)),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Canceled tool did not exit')), 8000).unref();
      })
    ]);
    assert.equal(code, 0);
    assert.match(stdout, /The Pi run was stopped/);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('Pi uses the office file server for allowed reads and private and outside denials', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oddboro-pi-files-run-'));
  const work = join(dir, 'work');
  const secret = join(work, 'private');
  const outside = join(dir, 'outside.txt');
  const fs = await import('node:fs/promises');
  await fs.mkdir(secret, { recursive: true });
  await fs.mkdir(work, { recursive: true });
  await fs.writeFile(join(work, 'allowed.txt'), 'allowed-fixture');
  await fs.writeFile(join(secret, 'secret.txt'), 'secret-fixture');
  await fs.writeFile(outside, 'outside-fixture');
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (part) => {
      body += part;
    });
    req.on('end', () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const number = requests.length;
      const call = number < 5;
      const item = call
        ? {
            id: `fc_${number}`,
            type: 'function_call',
            call_id: `call_${number}`,
            name: number === 3 ? 'mcp__files__write_file' : 'mcp__files__read_file',
            arguments: JSON.stringify(
              number === 3
                ? { path: 'AGENTS.md', content: 'must-not-write' }
                : {
                    path:
                      number === 1
                        ? 'allowed.txt'
                        : number === 2
                          ? join(secret, 'secret.txt')
                          : outside
                  }
            ),
            status: 'completed'
          }
        : {
            id: 'msg_5',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Done', annotations: [] }]
          };
      const added = call
        ? { ...item, arguments: '', status: 'in_progress' }
        : { ...item, content: [], status: 'in_progress' };
      const delta = call
        ? {
            type: 'response.function_call_arguments.delta',
            output_index: 0,
            item_id: `fc_${number}`,
            delta: item.arguments
          }
        : {
            type: 'response.output_text.delta',
            output_index: 0,
            item_id: 'msg_5',
            content_index: 0,
            delta: 'Done'
          };
      for (const event of [
        { type: 'response.created', response: { id: `resp_${number}` } },
        { type: 'response.output_item.added', output_index: 0, item: added },
        delta,
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id: `resp_${number}`,
            status: 'completed',
            output: [item],
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
              input_tokens_details: { cached_tokens: 0 }
            }
          }
        }
      ])
        res.write(frame(event));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr !== 'string');
  const input = {
    staffId: 'one',
    account: 'one',
    sourceIdentity: 'source',
    system: 'Test',
    input: 'Read.',
    sessionDir: join(dir, 'sessions'),
    baseUrl: `http://127.0.0.1:${addr.port}`,
    model: 'group/test',
    servers: {
      files: {
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL('../../../../../packages/ledger/src/files-server.ts', import.meta.url)
          )
        ],
        env: {
          ODDBORO_FILES: JSON.stringify({
            cwd: work,
            reads: [work],
            writes: [work],
            noWrite: [join(work, 'AGENTS.md')],
            noAccess: [secret]
          })
        }
      }
    },
    allowed: ['mcp__files'],
    images: [],
    timeoutMs: 5000,
    bare: false
  };
  try {
    const child = spawn(process.execPath, [worker], {
      cwd: work,
      env: { HOME: dir, PATH: process.env.PATH, ODDBORO_PI_API_KEY: 'fixture-key' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise<number | null>((resolve) => child.on('close', resolve));
    assert.equal(code, 0, stderr);
    const events = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(events.at(-1).type, 'done', stdout);
    assert.equal(
      events.filter((e) => e.type === 'tool' && e.name === 'mcp__files__read_file').length,
      3
    );
    assert.equal(
      events.filter((e) => e.type === 'tool' && e.name === 'mcp__files__write_file').length,
      1
    );
    const advertised = JSON.stringify(requests[0].tools);
    assert.match(advertised, /mcp__files__read_file/);
    assert.doesNotMatch(advertised, /"name":"read_file"/);
    assert.match(JSON.stringify(requests[1]), /allowed-fixture/);
    assert.doesNotMatch(JSON.stringify(requests[2]), /secret-fixture/);
    assert.match(JSON.stringify(requests[2]), /error/i);
    assert.match(JSON.stringify(requests[3]), /error/i);
    assert.doesNotMatch(JSON.stringify(requests[4]), /outside-fixture/);
    assert.match(JSON.stringify(requests[4]), /error/i);
    await assert.rejects(fs.readFile(join(work, 'AGENTS.md')));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
