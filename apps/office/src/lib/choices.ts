// Choices an Odd offers the owner at the end of a chat reply, one a line as
// `[choice] the answer in their words`. The server takes them off the reply
// and keeps them beside it; the page shows them as buttons, and a tap sends
// that answer as the owner's message. Shared by both.

/** One choice line, as a bullet or not. */
const CHOICE = /^\s*(?:[-*]\s+)?\[choice\]\s*(.*?)\s*$/i;
export const CHOICES_MAX = 5;

/** A reply without the choices it ends with, and those choices, in order. */
export function splitChoices(text: string): { text: string; choices: string[] } {
  const lines = text.trimEnd().split('\n');
  const choices: string[] = [];
  let end = lines.length;
  while (end > 0) {
    const m = CHOICE.exec(lines[end - 1]);
    if (m) {
      if (m[1]) choices.unshift(m[1].slice(0, 200));
    } else if (lines[end - 1].trim() || !choices.length) break;
    end--;
  }
  if (!choices.length) return { text, choices: [] };
  return {
    text: lines.slice(0, end).join('\n').trimEnd(),
    choices: [...new Set(choices)].slice(0, CHOICES_MAX)
  };
}

/** A reply still streaming, with any choice lines hidden until it ends. */
export const hideChoiceLines = (text: string): string =>
  text
    .split('\n')
    .filter((l) => !CHOICE.test(l))
    .join('\n');
