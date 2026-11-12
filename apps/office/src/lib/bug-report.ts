export const BUG_REPO = 'New-Altitude/Oddboro';
export const ISSUES = `https://github.com/${BUG_REPO}/issues`;
export const TITLE_LIMIT = 256;
export const BODY_LIMIT = 65536;

/** A line of a chat, as far as the report form reads it. */
type ChatLine = { from: 'owner' | 'staff'; text: string; failed?: true; runFailed?: true };

/**
 * What Report a bug starts its details with: the error of the chat's last
 * Odd line when that line is a failed reply, else nothing.
 */
export function failedReply(lines: readonly ChatLine[]): string {
  const last = lines.findLast((l) => l.from === 'staff');
  return last && (last.failed || last.runFailed) ? last.text.trim() : '';
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
