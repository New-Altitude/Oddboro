// Which of a task's steps hold up Mark done. Safe to import in the browser.
export { mustDo, stepsToGo } from '@oddboro/ledger/tools';

/**
 * A step's text as the desk renders it: a bare email address becomes inline
 * code, which copies on a click, instead of a mail link. A step says to type an
 * address far more often than to write to it. Addresses already in code or
 * inside a link stay as they are.
 */
export function stepText(text: string): string {
  // Code spans and Markdown links first, so the address inside one is skipped.
  return text.replace(
    /(`[^`]*`|\[[^\]]*\]\([^)]*\)|<[^>]*>)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g,
    (all, kept: string | undefined, email: string | undefined) => (kept ? kept : `\`${email}\``)
  );
}
