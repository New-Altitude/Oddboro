// The Office Manager's first three questions to a new owner, asked in chat
// one at a time, each with answers the owner taps. The hello ends with the
// first. A first answer in the owner's own words goes straight to the manager.
// With a suggested first answer the office asks the next two; the third answer goes to the
// manager, who reads all three in the chat and carries on. Which question
// waits is read from the chat's last line, so nothing else is stored. The
// first answer to each is the default the office keeps until the owner says
// otherwise. Imports nothing, so the chat panel can read it.

export type FirstQuestion = { ask: string; answers: string[] };

export const FIRST_QUESTIONS: FirstQuestion[] = [
  {
    ask: 'What should we help with first?',
    answers: [
      'Get my inbox under control',
      'Finish a project that keeps slipping',
      'Plan my week',
      'Not sure yet. Show me around.'
    ]
  },
  {
    // Nothing leaves the office without the owner's yes (hard rule 4), so
    // this asks only how far work goes inside it, and says so.
    ask: 'Nothing leaves the office without your yes. Inside it, how much should we do on our own?',
    answers: [
      'Draft things and bring them to me',
      'Finish the work, then show me',
      'Ask me before starting anything'
    ]
  },
  {
    ask: 'My report lands at 7 each morning. Between reports, what should you hear about?',
    answers: ['Only what needs me', 'Everything as it happens', 'Nothing. The report is enough.']
  }
];

/** The first question a chat line asks (its place in `FIRST_QUESTIONS`), or -1. */
export const firstQuestionIn = (text: string): number =>
  FIRST_QUESTIONS.findIndex((q) => text.trimEnd().endsWith(q.ask));

/** How a manager's hello ends: the way to answer, then the first question. */
export const firstAsk = `Three quick questions to start. Tap an answer, or type your own.\n\n${FIRST_QUESTIONS[0].ask}`;
