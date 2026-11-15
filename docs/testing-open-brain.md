# Test Open Brain with Oddboro

Run the regression tests from the Oddboro checkout you want to test. To check compatibility with a real Brain, start the published OB1 server on the developer machine or CI runner. Each runner creates its own database and access key. The examples use Bash on macOS or Linux, including WSL with Docker integration.

## Run the regression tests

Use Node 24 and npm. From the root of the PR checkout, run these commands. The tests use temporary files and test doubles. They run without Docker, OpenRouter or a signed-in office AI.

```sh
npm ci --no-audit --no-fund
node --test --experimental-test-module-mocks \
  apps/office/src/lib/server/brain-pages.test.ts \
  apps/office/src/lib/server/brain-project.test.ts \
  apps/office/src/lib/server/brain-recent.test.ts \
  apps/office/src/lib/server/dream-review.test.ts \
  apps/office/src/lib/server/open-brain.test.ts
```

Expect zero failures. These tests cover both project hooks, assignment matching, the recent-list limit and resuming an interrupted review.

## Start a stock Brain on the runner

Install Docker, curl and the Supabase CLI (tested with 2.101.0). The first start downloads the Supabase images and the function's dependencies. Run the blocks below in the same Bash shell, starting at the Oddboro repo root. They use the default local Supabase ports and a fresh directory outside the checkout. [Supabase local development](https://supabase.com/docs/guides/local-development)

```sh
oddboro_repo="$PWD"
brain_dir=$(mktemp -d "${TMPDIR:-/tmp}/oddboro-brain-XXXXXXXX")
cd "$brain_dir"
supabase init
mkdir -p supabase/functions/open-brain-mcp supabase/migrations
ob1_src=https://raw.githubusercontent.com/NateBJones-Projects/OB1/238df6cefd307745d1fe49d10b96797903bf25ac
curl -fsSL "$ob1_src/server/index.ts" -o supabase/functions/open-brain-mcp/index.ts
curl -fsSL "$ob1_src/server/deno.json" -o supabase/functions/open-brain-mcp/deno.json
curl -fsSL "$ob1_src/docs/01-getting-started.md" -o ob1-setup.md
```

Create the database migration from the five SQL blocks in the pinned OB1 guide. Generate a Brain access key and seed one public test record. The function authenticates clients with that key, so its local Supabase configuration disables the separate JWT check.

````sh
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const guide = readFileSync('ob1-setup.md', 'utf8');
const sql = [...guide.matchAll(/^```sql\r?\n([\s\S]*?)^```/gm)].map(m => m[1]);
if (sql.length !== 5) throw new Error('Expected the five SQL blocks from the pinned OB1 guide');
writeFileSync('supabase/migrations/20260101000000_open_brain.sql',
  'create extension if not exists vector with schema public;\n' + sql.join('\n'));
writeFileSync('supabase/functions/.env', 'MCP_ACCESS_KEY=' + randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
JS
cat >> supabase/config.toml <<'EOF'

[functions.open-brain-mcp]
verify_jwt = false
EOF
cat > supabase/seed.sql <<'EOF'
insert into public.thoughts (id, content)
values ('11111111-1111-4111-8111-111111111111', 'Stock Open Brain read check.');
EOF
````

For the capture and search check or the [live job test](#check-which-odd-gets-a-decision), also add `OPENROUTER_API_KEY` to `$brain_dir/supabase/functions/.env` using a staging credential. The read check below only needs the generated `MCP_ACCESS_KEY`. In CI, supply the optional provider key from the runner’s secret store and keep the env file out of build artifacts. Start Supabase and wait for it to report ready.

```sh
supabase start --exclude analytics,imgproxy,inbucket,meta,realtime,storage,studio,vector
```

## Check the real connection

Use the MCP client installed by `npm ci` to connect to the new server, read its advertised tools and fetch the seeded record by ID. For a model-backed check, set `export OB1_TEST_CAPTURE=1` in this shell after configuring OpenRouter. That check saves a sample record and makes billed requests through the test Brain’s provider account.

```sh
cd "$oddboro_repo"
node --env-file="$brain_dir/supabase/functions/.env" --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'oddboro-read-check', version: '1' });
const url = new URL('http://127.0.0.1:54321/functions/v1/open-brain-mcp');
await client.connect(new StreamableHTTPClientTransport(url, {
  requestInit: { headers: { 'x-brain-key': process.env.MCP_ACCESS_KEY } }
}));
try {
  const { tools } = await client.listTools();
  assert.ok(tools.some(t => t.name === 'list_thoughts' && t.annotations?.readOnlyHint));
  const id = '11111111-1111-4111-8111-111111111111';
  const reply = await client.callTool({ name: 'fetch', arguments: { id } });
  assert.ok(!reply.isError, 'Stock fetch failed');
  const record = JSON.parse(reply.content[0].text);
  assert.equal(record.id, id);
  assert.equal(record.text, 'Stock Open Brain read check.');
  console.log('Stock Brain returned the seeded record.');
  if (process.env.OB1_TEST_CAPTURE === '1') {
    const text = 'The test workshop opens at 9:30 on Monday.';
    const saved = await client.callTool({ name: 'capture_thought', arguments: { content: text } });
    assert.ok(!saved.isError, 'Capture failed');
    const hits = await client.callTool({ name: 'search', arguments: { query: text } });
    assert.ok(!hits.isError, 'Semantic search failed');
    let found = false;
    for (const hit of JSON.parse(hits.content[0].text).results) {
      const fetched = await client.callTool({ name: 'fetch', arguments: { id: hit.id } });
      assert.ok(!fetched.isError, 'Fetching a search result failed');
      if (JSON.parse(fetched.content[0].text).text === text) { found = true; break; }
    }
    assert.ok(found, 'Search did not find the captured text');
    console.log('Capture, search and fetch passed.');
  }
} finally {
  await client.close();
}
JS
```

Expect `Stock Brain returned the seeded record.` With `OB1_TEST_CAPTURE=1`, also expect `Capture, search and fetch passed.` A connection refusal means the local endpoint is unavailable. If it reports an authentication error, check that the client and the running function have the same Brain key.

## Check which Odd gets a decision

This test uses OpenRouter for OB1 capture and semantic search, and a signed-in office AI for deciding which jobs need the record. Use an isolated test office on the PR build and a disposable project folder. Follow the [source setup](../README.md#get-started) in a test user account if you need a fresh office.

1. Create two enabled recurring jobs on different Odds. Give the first job the instruction “Draft a Saturday member pickup reminder. The current notice sends members to the North Desk.” Give the second “Report the balance of invoice 382: $180 less the $60 deposit.”
2. In **Services → Open Brain**, enter `http://127.0.0.1:54321/functions/v1/open-brain-mcp` and the generated `MCP_ACCESS_KEY` from the test function's env file. Choose **Connect Open Brain**. Stock OB1 should report that the office checks recent captures.
3. Choose **Use in Codex** or **Use in Claude Code** and select the disposable project. Open a new chat in that project and accept the client's hook trust prompt if it asks. Write “Saturday member pickup has moved from the North Desk to the Willow Room. This is the confirmed location for the member reminder.”
4. Leave the office running. In Services, wait for **Decision received** and a completed review. Expand the pickup job under **Why … changed**. Its evidence should include the new location. The invoice job should receive no pickup evidence.
5. Choose **Run now** on each job. The member reminder should direct members to the Willow Room. The invoice should report $120 outstanding. Record the actual drafts if either check fails.

If capture or search fails, check the function's OpenRouter credential. If the project still says **Waiting for first decision**, check the selected folder and the chat client's hook trust settings.

## Check a large offline backlog

To exercise the provider limit, stop the test office while the Brain keeps running. Use a separate MCP client connected to the same test Brain to capture a new pickup location. Insert 1,248 ordinary records using the test database's SQL client, then capture a new invoice payment through MCP. The SQL client URL is in the output of `supabase start`.

```sql
insert into public.thoughts (content)
select 'Archive reading ' || n from generate_series(1, 1248) as n;
```

Start the office on its saved connection. With the default 1,000-row cap, stock OB1 cannot expose the whole gap. Expect Services to report the gap and preserve its place.

To test recovery on the **same** endpoint, apply the PR's provider patch to this disposable copy and restart the local function. Run the following in a separate terminal in the test project, with `oddboro_repo` set to the PR checkout. The function server stays in the foreground.

```sh
patch -d supabase/functions/open-brain-mcp -p2 < "$oddboro_repo/apps/office/scripts/open-brain-capture-pages.patch"
supabase functions serve open-brain-mcp --no-verify-jwt --env-file supabase/functions/.env
```

The next office clock check should discover paging and finish the backlog without reconnecting. Run the two jobs again. The pickup and invoice drafts should each reflect their own new decision.

## Stop the test Brain

Stop any foreground function server with Ctrl+C. From `$brain_dir`, run `supabase stop` to keep the test data for another session. Use `supabase stop --no-backup` in that disposable project when you want to discard its data. The temporary directory also contains its test credentials.
