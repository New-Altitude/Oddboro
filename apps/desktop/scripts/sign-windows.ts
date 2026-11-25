// Signs one Windows file with New Altitude's certificate in Azure Artifact
// Signing. Tauri runs it for each file it signs (`signCommand`, which
// release.ts sets): the app, the installer and its uninstaller.
//
// No signing secret is stored anywhere. GitHub's OIDC token proves the run
// is this repo's release, and Azure trusts it for the client AZURE_CLIENT_ID
// names. The token lasts minutes and a build takes longer, so each file
// fetches a fresh one, and the signing client (DefaultAzureCredential)
// trades it through AZURE_FEDERATED_TOKEN_FILE.
//
// Env: ODDBORO_SIGNTOOL (signtool.exe), ODDBORO_SIGN_DLIB (the client's
// Azure.CodeSigning.Dlib.dll), ODDBORO_SIGN_METADATA (its metadata.json),
// AZURE_CLIENT_ID and AZURE_TENANT_ID, and the two ACTIONS_ID_TOKEN_REQUEST
// variables GitHub sets when a job may ask for a token.
//
//   node apps/desktop/scripts/sign-windows.ts <file>
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const file = process.argv[2];
const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`sign-windows: ${name} is not set`);
  return v;
};
if (!file) throw new Error('sign-windows: name the file to sign');

/** A fresh GitHub OIDC token for Azure's token exchange. */
async function oidcToken(): Promise<string> {
  const url = new URL(need('ACTIONS_ID_TOKEN_REQUEST_URL'));
  url.searchParams.set('audience', 'api://AzureADTokenExchange');
  const res = await fetch(url, {
    headers: { authorization: `bearer ${need('ACTIONS_ID_TOKEN_REQUEST_TOKEN')}` }
  });
  if (!res.ok) throw new Error(`sign-windows: GitHub gave no token (${res.status})`);
  const { value } = (await res.json()) as { value?: string };
  if (!value) throw new Error('sign-windows: GitHub gave an empty token');
  return value;
}

/**
 * Trades the token with Azure the way the signing client will, so a refusal
 * says why in Azure's own words (an AADSTS code) instead of signtool's bare
 * exit code. Nothing it gets back is kept or printed.
 */
async function checkAzure(assertion: string): Promise<void> {
  const tenant = need('AZURE_TENANT_ID');
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: need('AZURE_CLIENT_ID'),
      scope: 'https://codesigning.azure.net/.default',
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion
    })
  });
  if (res.ok) return;
  const why = (await res.json().catch(() => ({}))) as {
    error?: string;
    error_description?: string;
  };
  throw new Error(
    `sign-windows: Azure refused the sign-in (${res.status}): ${why.error_description ?? why.error ?? 'no reason given'}`
  );
}

const dir = mkdtempSync(join(tmpdir(), 'oddboro-sign-'));
try {
  // The service now and then drops a request: three tries, each with its own token.
  for (let n = 1; ; n++) {
    const token = join(dir, 'token');
    // The check spends a token of its own, so the client gets a fresh one.
    if (n === 1) await checkAzure(await oidcToken());
    writeFileSync(token, await oidcToken());
    try {
      execFileSync(
        need('ODDBORO_SIGNTOOL'),
        [
          'sign',
          '/v',
          '/debug',
          '/fd',
          'SHA256',
          '/tr',
          'http://timestamp.acs.microsoft.com',
          '/td',
          'SHA256',
          '/dlib',
          need('ODDBORO_SIGN_DLIB'),
          '/dmdf',
          need('ODDBORO_SIGN_METADATA'),
          file
        ],
        {
          // Tauri shows a failed command's stderr and nothing else, so
          // signtool's own words go there.
          stdio: ['ignore', process.stderr, process.stderr],
          env: {
            ...process.env,
            AZURE_CLIENT_ID: need('AZURE_CLIENT_ID'),
            AZURE_TENANT_ID: need('AZURE_TENANT_ID'),
            AZURE_FEDERATED_TOKEN_FILE: token
          }
        }
      );
      break;
    } catch (e) {
      if (n === 3) throw e;
      console.error(`Signing ${file} failed, try ${n} of 3. Trying again in ${n * 10} seconds.`);
      await new Promise((r) => setTimeout(r, n * 10_000));
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
