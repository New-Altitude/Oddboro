export const BUG_REPO = 'New-Altitude/Oddboro';
export const ISSUES = `https://github.com/${BUG_REPO}/issues`;
export const TITLE_LIMIT = 256;
export const BODY_LIMIT = 65536;

/** A request addressed to the office itself. Ordinary conversation goes to the Odd. */
export function bugRequest(message: string, previous: string): string | undefined {
  const words = message.trim();
  const command = /^\/bug(?:\s+([\s\S]*)|$)/i.exec(words);
  if (command) return command[1]?.trim() ?? '';
  const request =
    /^(?:please\s+)?(?:report|file)\s+(?:(this(?:\s+(?:message|error))?)\s+as\s+)?a\s+bug(?:\s+report)?(?:\s*:\s*([\s\S]*)|[.!]?)$/i.exec(
      words
    );
  if (request) return request[2]?.trim() || (request[1] ? previous : '');
}

/** Long or heavily encoded drafts travel by clipboard instead of an oversized URL. */
export function browserDraft(title: string, body: string) {
  const url = new URL(`${ISSUES}/new`);
  url.searchParams.set('title', title);
  url.searchParams.set('body', body);
  if (url.href.length <= 7500) return { url: url.href, copyBody: false };
  url.searchParams.delete('body');
  return { url: url.href, copyBody: true };
}
