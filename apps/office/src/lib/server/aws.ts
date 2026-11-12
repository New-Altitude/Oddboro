// AWS, signed in to by the office itself through IAM Identity Center. The
// owner signs in once on AWS's own page (a device sign-in), and the office
// keeps the tokens in the system's secret store and renews them until the
// access portal session ends. Each AWS tool picks one role from that sign-in:
//
// - AWS Secrets Manager: the office's own role. The office lists secret names
//   to Odds itself (`secretNamesClient`) and reads a value only to hand
//   another tool its key (`fromAws`). No value ever reaches an Odd.
// - AWS read only and AWS builder: the role AWS's MCP Server runs as for the
//   Odds, which must not read a secret value (`checkNoValueRead`).
import {
  GetSecretValueCommand,
  ListSecretsCommand,
  SecretsManagerClient
} from '@aws-sdk/client-secrets-manager';
import {
  GetRoleCredentialsCommand,
  ListAccountRolesCommand,
  ListAccountsCommand,
  SSOClient
} from '@aws-sdk/client-sso';
import {
  CreateTokenCommand,
  RegisterClientCommand,
  SSOOIDCClient,
  StartDeviceAuthorizationCommand
} from '@aws-sdk/client-sso-oidc';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  AWS_IDS,
  AWS_SECRETS_ID,
  AWS_SIGN_IN,
  connector,
  isAws,
  setConnectorConfig,
  type AwsConfig,
  type AwsSecretRef,
  type ConnectorRow
} from '@oddboro/ledger';
import { asHeader, deleteSecret, getSecret, setSecret } from './keychain.ts';

/** The proxy that signs the Odds' requests to AWS's hosted MCP Server, pinned. */
const PROXY = 'mcp-proxy-for-aws-cli@1.8.0';
/** The Regions AWS's hosted MCP Server runs in. Any other Region's work goes through us-east-1. */
const MCP_REGIONS = [
  'us-east-1',
  'us-west-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-northeast-1',
  'eu-central-1',
  'eu-west-1',
  'eu-west-2'
];
/** Renew a token or credentials this long before they run out. */
const MARGIN_MS = 5 * 60_000;

/** The one sign-in, as the secret store holds it. Where to sign in is not secret; the rest is. */
type SignIn = {
  /** The access portal URL, like https://acme.awsapps.com/start. */
  startUrl: string;
  /** The Region IAM Identity Center runs in. */
  ssoRegion: string;
  clientId: string;
  clientSecret: string;
  /** When the registered client runs out, in ms. */
  clientEnds: number;
  accessToken?: string;
  refreshToken?: string;
  /** When the access token runs out, in ms. */
  tokenEnds?: number;
};

type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** In ms. */
  expiration: number;
};

export type AwsRole = { accountId: string; accountName: string; roleName: string };

const REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;

/** The access portal URL, checked: an https address on AWS or the owner's own domain. */
export function startUrlProblem(url: string): string | undefined {
  try {
    if (new URL(url).protocol === 'https:') return undefined;
  } catch {
    // Not a URL at all.
  }
  return 'Paste the AWS access portal URL, like https://your-company.awsapps.com/start.';
}

export function regionProblem(region: string): string | undefined {
  return REGION.test(region) ? undefined : `"${region}" is not an AWS Region, like us-east-1.`;
}

function loadSignIn(): SignIn | undefined {
  try {
    const raw = getSecret(AWS_SIGN_IN.id, AWS_SIGN_IN.name);
    return raw ? (JSON.parse(raw) as SignIn) : undefined;
  } catch {
    return undefined;
  }
}

function saveSignIn(s: SignIn): void {
  setSecret(AWS_SIGN_IN.id, AWS_SIGN_IN.name, JSON.stringify(s));
  roleCache.clear();
}

/** Where the office signed in last time, so signing in again starts filled in. None of it is secret. */
export function awsSignInPlace(): { startUrl: string; ssoRegion: string } | null {
  const s = loadSignIn();
  return s ? { startUrl: s.startUrl, ssoRegion: s.ssoRegion } : null;
}

/** How AWS read only and builder start: the proxy, AWS's endpoint and the work Region. */
export function proxyArgs(region: string): string[] {
  const endpoint = MCP_REGIONS.includes(region) ? region : 'us-east-1';
  return [PROXY, `https://aws-mcp.${endpoint}.api.aws/mcp`, '--metadata', `AWS_REGION=${region}`];
}

// Signing in

/** The sign-in under way, which the desk waits on. */
let pending: Promise<void> | undefined;
/** AWS's page and code for the sign-in under way, so a desk opened in another tab can show them. */
let approving: AwsApproval | undefined;

export type AwsApproval = { url: string; code: string };

/**
 * Start the owner's sign-in. Registers the office as a client when it has
 * none that still works, and returns AWS's page with the code filled in. The
 * office then waits for the owner to approve it there. Another portal is
 * another sign-in, so every AWS tool's role goes with the old one.
 */
export async function startAwsSignIn(
  startUrl: string,
  ssoRegion: string
): Promise<{ url: string; code: string }> {
  const problem = startUrlProblem(startUrl) ?? regionProblem(ssoRegion);
  if (problem) throw new Error(problem);
  let s = loadSignIn();
  if (s && (s.startUrl !== startUrl || s.ssoRegion !== ssoRegion)) {
    deleteSecret(AWS_SIGN_IN.id, AWS_SIGN_IN.name);
    for (const id of AWS_IDS) {
      const c = await connector(id);
      if (c?.config.aws) await setConnectorConfig(id, { ...c.config, aws: undefined });
    }
    s = undefined;
  }
  const oidc = new SSOOIDCClient({ region: ssoRegion });
  if (!s || s.clientEnds - MARGIN_MS < Date.now()) {
    const r = await oidc.send(
      new RegisterClientCommand({
        clientName: 'Oddboro office',
        clientType: 'public',
        scopes: ['sso:account:access'],
        grantTypes: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token']
      })
    );
    s = {
      startUrl,
      ssoRegion,
      clientId: r.clientId!,
      clientSecret: r.clientSecret!,
      clientEnds: (r.clientSecretExpiresAt ?? 0) * 1000
    };
    saveSignIn(s);
  }
  const d = await oidc.send(
    new StartDeviceAuthorizationCommand({
      clientId: s.clientId,
      clientSecret: s.clientSecret,
      startUrl
    })
  );
  const mine = waitForApproval(oidc, s, d.deviceCode!, d.interval ?? 5, d.expiresIn ?? 600);
  const page = { url: d.verificationUriComplete ?? d.verificationUri!, code: d.userCode ?? '' };
  pending = mine;
  approving = page;
  // A newer sign-in replaces this one, so only this one's end clears it.
  mine
    .catch(() => {})
    .finally(() => {
      if (pending !== mine) return;
      pending = undefined;
      approving = undefined;
    });
  return page;
}

/**
 * Ask AWS for the tokens every few seconds, as it says to, until the owner
 * approves, says no, or the code runs out. It runs only while a sign-in is
 * open, and stops at the code's end.
 */
async function waitForApproval(
  oidc: SSOOIDCClient,
  s: SignIn,
  deviceCode: string,
  intervalS: number,
  expiresInS: number
): Promise<void> {
  const ends = Date.now() + expiresInS * 1000;
  let wait = intervalS * 1000;
  while (Date.now() < ends) {
    await new Promise((r) => setTimeout(r, wait));
    try {
      const t = await oidc.send(
        new CreateTokenCommand({
          clientId: s.clientId,
          clientSecret: s.clientSecret,
          grantType: 'urn:ietf:params:oauth:grant-type:device_code',
          deviceCode
        })
      );
      saveSignIn({
        ...s,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        tokenEnds: Date.now() + (t.expiresIn ?? 3600) * 1000
      });
      return;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'AuthorizationPendingException') continue;
      if (name === 'SlowDownException') {
        wait += 5000;
        continue;
      }
      if (name === 'AccessDeniedException') throw new Error('The sign-in was turned down on AWS.');
      throw e;
    }
  }
  throw new Error('The sign-in code ran out. Click Sign in again.');
}

/** Wait for the sign-in under way to land. Resolves at once when none is. */
export async function awsSignInDone(): Promise<void> {
  if (pending) await pending;
  if (!(await ssoToken())) throw new Error('AWS is not signed in. Click Sign in.');
}

/**
 * AWS's page and code while a sign-in waits on the owner's approval, so a desk
 * opened mid-way, in any tab, waits too and can open the page again.
 */
export const awsSigningIn = (): AwsApproval | null => approving ?? null;

/** Whether the office's AWS sign-in still works. */
export async function awsSignedIn(): Promise<boolean> {
  return !!(await ssoToken());
}

/** A live access token, renewed when close to running out. Undefined once the session ended. */
async function ssoToken(): Promise<string | undefined> {
  const s = loadSignIn();
  if (!s?.accessToken) return undefined;
  if ((s.tokenEnds ?? 0) - MARGIN_MS > Date.now()) return s.accessToken;
  if (!s.refreshToken) return undefined;
  try {
    const t = await new SSOOIDCClient({ region: s.ssoRegion }).send(
      new CreateTokenCommand({
        clientId: s.clientId,
        clientSecret: s.clientSecret,
        grantType: 'refresh_token',
        refreshToken: s.refreshToken
      })
    );
    saveSignIn({
      ...s,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken ?? s.refreshToken,
      tokenEnds: Date.now() + (t.expiresIn ?? 3600) * 1000
    });
    return t.accessToken;
  } catch {
    // The access portal session ended: the owner signs in again.
    return undefined;
  }
}

// Roles

/** Every role the sign-in holds, in every account. */
export async function awsRoles(): Promise<AwsRole[]> {
  const token = await ssoToken();
  const s = loadSignIn();
  if (!token || !s) throw new Error('AWS is not signed in. Click Sign in.');
  const sso = new SSOClient({ region: s.ssoRegion });
  const roles: AwsRole[] = [];
  let next: string | undefined;
  do {
    const page = await sso.send(new ListAccountsCommand({ accessToken: token, nextToken: next }));
    for (const a of page.accountList ?? []) {
      let more: string | undefined;
      do {
        const r = await sso.send(
          new ListAccountRolesCommand({
            accessToken: token,
            accountId: a.accountId,
            nextToken: more
          })
        );
        for (const role of r.roleList ?? [])
          roles.push({
            accountId: a.accountId!,
            accountName: a.accountName ?? a.accountId!,
            roleName: role.roleName!
          });
        more = r.nextToken;
      } while (more);
    }
    next = page.nextToken;
  } while (next);
  return roles;
}

/** Credentials per role, kept in memory until close to running out. */
const roleCache = new Map<string, Credentials>();

async function credentialsFor(accountId: string, roleName: string): Promise<Credentials> {
  const at = `${accountId}/${roleName}`;
  const kept = roleCache.get(at);
  if (kept && kept.expiration - MARGIN_MS > Date.now()) return kept;
  const token = await ssoToken();
  const s = loadSignIn();
  if (!token || !s) throw new Error('The AWS sign-in ran out. The owner needs to sign in again.');
  const r = await new SSOClient({ region: s.ssoRegion }).send(
    new GetRoleCredentialsCommand({ accessToken: token, accountId, roleName })
  );
  const c = r.roleCredentials;
  if (!c?.accessKeyId || !c.secretAccessKey || !c.sessionToken)
    throw new Error(`AWS gave no credentials for ${roleName}.`);
  const creds = {
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    sessionToken: c.sessionToken,
    expiration: c.expiration ?? Date.now() + 3600_000
  };
  roleCache.set(at, creds);
  return creds;
}

async function secretsClient(cfg: AwsConfig): Promise<SecretsManagerClient> {
  const c = await credentialsFor(cfg.accountId, cfg.role);
  return new SecretsManagerClient({
    region: cfg.region,
    credentials: { ...c, expiration: new Date(c.expiration) }
  });
}

/** What checking a role for value reads found. */
export type ReadCheck =
  { ok: true; checked: string } | { ok: true; unchecked: string } | { ok: false; problem: string };

/**
 * Try to read one secret's value with a role, which must fail. A value that
 * comes back is dropped unread. `list` and `read` are the role's own calls.
 */
export async function checkNoValueRead(
  list: () => Promise<string[]>,
  read: (name: string) => Promise<unknown>
): Promise<ReadCheck> {
  let names: string[];
  try {
    names = await list();
  } catch {
    return {
      ok: true,
      unchecked: 'The role cannot list secrets, so the office could not test it.'
    };
  }
  if (!names.length)
    return {
      ok: true,
      unchecked:
        'There are no secrets yet, so the office could not test that the role cannot read one.'
    };
  try {
    await read(names[0]);
  } catch {
    return { ok: true, checked: names[0] };
  }
  return {
    ok: false,
    problem:
      'That role can read secret values, and Odds must never see one. Pick a role that cannot, or deny it secretsmanager:GetSecretValue.'
  };
}

/**
 * The owner picked a role for one AWS tool. For AWS read only and builder,
 * the office first checks the role cannot read a secret value. Keeps the
 * choice; the route then lists the tool's tools, which connects it.
 */
export async function chooseAwsRole(
  id: string,
  accountId: string,
  role: string,
  region: string
): Promise<{ notes: string[] }> {
  const c = await connector(id);
  if (!c || !isAws(id)) throw new Error(`${id} is not an AWS tool.`);
  const problem = regionProblem(region);
  if (problem) throw new Error(problem);
  const roles = await awsRoles();
  if (!roles.some((r) => r.accountId === accountId && r.roleName === role))
    throw new Error('That sign-in does not hold that role in that account.');
  const cfg: AwsConfig = { accountId, role, region };
  const notes: string[] = [];
  if (id === AWS_SECRETS_ID) {
    // The office lists names as this role in this Region, so try it now,
    // while the owner is still at the desk, not on an Odd's first call.
    let found: number;
    try {
      const sm = await secretsClient(cfg);
      found = ((await sm.send(new ListSecretsCommand({ MaxResults: 1 }))).SecretList ?? []).length;
    } catch (e) {
      throw new Error(listProblem(e, region));
    }
    if (!found)
      notes.push(
        `There are no secrets in ${region}. If yours are in another Region, connect again with that one.`
      );
  } else {
    const sm = await secretsClient(cfg);
    const check = await checkNoValueRead(
      async () =>
        ((await sm.send(new ListSecretsCommand({ MaxResults: 1 }))).SecretList ?? []).map(
          (s) => s.Name!
        ),
      (name) => sm.send(new GetSecretValueCommand({ SecretId: name }))
    );
    if (!check.ok) throw new Error(check.problem);
    if ('unchecked' in check) notes.push(check.unchecked);
  }
  await setConnectorConfig(id, {
    ...c.config,
    aws: cfg,
    ...(id === AWS_SECRETS_ID ? {} : { args: proxyArgs(region) })
  });
  return { notes };
}

/**
 * What to tell the owner when the office's role cannot list secrets. An
 * organization that allows only some Regions (AWS's projects sign-up makes
 * one) refuses every other Region with a service control policy.
 */
export function listProblem(e: unknown, region: string): string {
  const why = e instanceof Error ? e.message : String(e);
  if (/service control policy/i.test(why))
    return `Your AWS organization blocks ${region}. Pick the Region your secrets are in.`;
  if (/AccessDenied|not authorized/i.test(why))
    return `That role cannot list secrets in ${region}. Give it secretsmanager:ListSecrets, as the guide's policy does.`;
  return `AWS would not list secrets in ${region}: ${why}`;
}

/** What to tell the owner when AWS's tool would not start. */
export function startProblem(e: unknown): string {
  const why = e instanceof Error ? e.message : String(e);
  return /ENOENT|uvx/.test(why)
    ? "Oddboro starts AWS's tool with uv, and this computer does not have it. Install uv, then click Check and connect again."
    : `AWS's tool did not start: ${why}`;
}

// Use

/** The environment AWS read only or builder starts with: short-lived credentials for its role. */
export async function oddsEnv(c: Pick<ConnectorRow, 'config'>): Promise<Record<string, string>> {
  const cfg = c.config.aws;
  if (!cfg) throw new Error('AWS is not connected yet.');
  const creds = await credentialsFor(cfg.accountId, cfg.role);
  return {
    AWS_ACCESS_KEY_ID: creds.accessKeyId,
    AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
    AWS_SESSION_TOKEN: creds.sessionToken,
    AWS_REGION: cfg.region
  };
}

/** The office's role, from AWS Secrets Manager's connection. */
async function officeSecrets(): Promise<SecretsManagerClient> {
  const cfg = (await connector(AWS_SECRETS_ID))?.config.aws;
  if (!cfg) throw new Error('Connect AWS Secrets Manager first: have an Odd ask you for it.');
  return secretsClient(cfg);
}

/** The names of the owner's secrets, never their values. */
export async function awsSecretNames(): Promise<{ name: string; description: string }[]> {
  const sm = await officeSecrets();
  const out: { name: string; description: string }[] = [];
  let next: string | undefined;
  do {
    const page = await sm.send(new ListSecretsCommand({ MaxResults: 100, NextToken: next }));
    for (const s of page.SecretList ?? [])
      if (s.Name) out.push({ name: s.Name, description: s.Description ?? '' });
    next = page.NextToken;
  } while (next);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * AWS Secrets Manager as the Odds reach it: one tool, answered by the office
 * itself, that lists names and descriptions. There is no tool for a value.
 */
export function secretNamesServer(
  list: () => Promise<{ name: string; description: string }[]>
): Server {
  const server = new Server(
    { name: 'oddboro-aws-secrets', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'list_secret_names',
        description:
          "List the names and descriptions of the owner's secrets in AWS Secrets Manager. Never their values: the office reads a value only to hand another tool its key, when the owner names the secret on that tool's key step.",
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true }
      }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name !== 'list_secret_names')
      return {
        isError: true,
        content: [{ type: 'text', text: `No tool named ${req.params.name}.` }]
      };
    const names = await list();
    const text = names.length
      ? names.map((s) => (s.description ? `${s.name}: ${s.description}` : s.name)).join('\n')
      : 'No secrets in AWS Secrets Manager that the office can see.';
    return { content: [{ type: 'text', text }] };
  });
  return server;
}

/** A client on `secretNamesServer`, in this process, for the gateway and the desk. */
export async function secretNamesClient(list = awsSecretNames): Promise<Client> {
  const [ours, theirs] = InMemoryTransport.createLinkedPair();
  await secretNamesServer(list).connect(theirs);
  const client = new Client({ name: 'oddboro-office', version: '1.0.0' });
  await client.connect(ours);
  return client;
}

/** One value, read with the office's role, for another tool's key. Never for an Odd. */
/** The names inside a key/value secret that hold text, or none when it is one plain value. */
export function jsonKeys(raw: string | undefined): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value)
      .filter(([, v]) => typeof v === 'string')
      .map(([k]) => k);
  } catch {
    return [];
  }
}

/**
 * The key names inside one secret, so the owner picks one instead of typing
 * it. The office reads the value to find them and drops it: only the names
 * leave this function.
 */
export async function awsSecretKeys(secret: string): Promise<string[]> {
  const sm = await officeSecrets();
  const r = await sm.send(new GetSecretValueCommand({ SecretId: secret }));
  return jsonKeys(r.SecretString);
}

export async function awsSecret(ref: AwsSecretRef): Promise<string> {
  const sm = await officeSecrets();
  const r = await sm.send(new GetSecretValueCommand({ SecretId: ref.secret }));
  const raw = r.SecretString;
  if (raw === undefined) throw new Error(`${ref.secret} holds no text value.`);
  if (!ref.key) return raw;
  let value: unknown;
  try {
    value = (JSON.parse(raw) as Record<string, unknown>)[ref.key];
  } catch {
    throw new Error(`${ref.secret} is not JSON, so it has no ${ref.key}.`);
  }
  if (typeof value !== 'string') throw new Error(`${ref.secret} has no text value at ${ref.key}.`);
  return value;
}

/**
 * The keys a tool's server starts with, as environment variables and
 * headers: each from the secret store, or from AWS when the owner named an
 * AWS secret for it. AWS read only and builder get their role's credentials.
 * Throws when AWS cannot answer, such as when its sign-in ran out.
 */
export async function toolKeys(
  c: Pick<ConnectorRow, 'id' | 'config'>
): Promise<{ env: Record<string, string>; headers: Record<string, string> }> {
  const value = async (name: string) => {
    const ref = c.config.fromAws?.[name];
    return ref ? awsSecret(ref) : (getSecret(c.id, name) ?? '');
  };
  const env: Record<string, string> =
    isAws(c.id) && c.id !== AWS_SECRETS_ID ? await oddsEnv(c) : {};
  for (const name of c.config.secrets ?? []) env[name] = await value(name);
  const headers: Record<string, string> = {};
  for (const name of c.config.headers ?? []) headers[name] = asHeader(name, await value(name));
  return { env, headers };
}

/**
 * Whether AWS can still answer for this tool: true when the tool does not use
 * AWS, or the owner's AWS sign-in is still going. Asks AWS only when the token
 * is close to running out.
 */
export async function awsReady(c: Pick<ConnectorRow, 'id' | 'config'>): Promise<boolean> {
  if (!isAws(c.id) && !Object.keys(c.config.fromAws ?? {}).length) return true;
  return awsSignedIn();
}

/**
 * A tool's key comes from an AWS secret from now on, in place of a pasted
 * one. Reads the value once with the office's role to prove it is there, and
 * drops it; any pasted value for that key leaves the secret store.
 */
export async function useAwsSecret(id: string, name: string, ref: AwsSecretRef): Promise<void> {
  const c = await connector(id);
  if (!c) throw new Error(`No connector named ${id}`);
  if (!ref.secret) throw new Error('Pick a secret.');
  await awsSecret(ref);
  await setConnectorConfig(id, {
    ...c.config,
    fromAws: { ...c.config.fromAws, [name]: ref.key ? ref : { secret: ref.secret } }
  });
  deleteSecret(id, name);
}

/** A key the owner pasted replaces one named in AWS. */
export async function forgetAwsSecret(id: string, name: string): Promise<void> {
  const c = await connector(id);
  if (!c?.config.fromAws?.[name]) return;
  const fromAws = { ...c.config.fromAws };
  delete fromAws[name];
  await setConnectorConfig(id, { ...c.config, fromAws });
}
