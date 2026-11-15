// The owner attaches the text of one SKILL.md. A run gets no extra tools or files.
const SKILL_BYTES = 32 * 1024;

export function skillSizeProblem(bytes: number): string | undefined {
  if (bytes > SKILL_BYTES) return `Choose a SKILL.md of ${SKILL_BYTES / 1024} KB or less.`;
  return undefined;
}

export function skillProblem(text: string): string | undefined {
  if (!text.trim()) return 'Choose a skill that contains instructions.';
  if (text.includes('\0')) return 'Save the skill as UTF-8 text.';
  return skillSizeProblem(new TextEncoder().encode(text).length);
}
