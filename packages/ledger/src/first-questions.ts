// The Office Manager's first three questions to a new owner, asked in chat
// one at a time, each with answers the owner taps. The hello ends with the
// first. A suggested answer gets a short reply and the next question without
// a run. A typed answer outside the choices, or any answer to the third,
// goes to the manager with what the owner has already said. Which question
// waits is read from the chat's last line, so nothing else is stored. The
// first answer to each is the default the office keeps until the owner says
// otherwise. Imports nothing, so the chat panel can read it.

export type FirstQuestion = { ask: string; answers: string[]; replies?: Record<string, string> };

/** Each suggested answer that leads to another question has its own short reply. */
function question(ask: string, replies: Record<string, string>): FirstQuestion {
  return { ask, answers: Object.keys(replies), replies };
}

export const FIRST_QUESTIONS: FirstQuestion[] = [
  question('What should we help with first?', {
    'Get my inbox under control': "We'll start with your inbox.",
    'Finish a project that keeps slipping': "Let's start with the project that keeps slipping.",
    'Plan my week': "We'll start by planning your week.",
    'Not sure yet. Show me around.': "We'll start with a tour of the office."
  }),
  // This choice covers work inside the office only (hard rule 4).
  question(
    'Nothing leaves the office without your yes. Inside it, how much should we do on our own?',
    {
      'Draft things and bring them to me': "We'll bring you drafts to review.",
      'Finish the work, then show me': "We'll show you finished work inside the office.",
      'Ask me before starting anything': "We'll check with you before starting work."
    }
  ),
  {
    ask: 'My report lands at 7 each morning. Between reports, what should you hear about?',
    answers: ['Only what needs me', 'Everything as it happens', 'Nothing. The report is enough.']
  }
];

/** The first question a chat line asks (its place in `FIRST_QUESTIONS`), or -1. */
export const firstQuestionIn = (text: string): number =>
  FIRST_QUESTIONS.findIndex((q) => text.trimEnd().endsWith(q.ask));

/** What the office can answer without a run. Everything else goes to the manager. */
export function nextFirstQuestion(asked: number, answer: string): string | undefined {
  const q = FIRST_QUESTIONS[asked];
  const choice = answer.trim();
  if (!q?.answers.includes(choice) || !q.replies) return undefined;
  return `${q.replies[choice]}\n\n${FIRST_QUESTIONS[asked + 1].ask}`;
}

/** How a manager's hello ends: the way to answer, then the first question. */
export const firstAsk = `Three quick questions to start. Tap an answer, or type your own.\n\n${FIRST_QUESTIONS[0].ask}`;
