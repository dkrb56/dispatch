// The answers of a report with questions (ticket questions-answer-all): a click on an option is a
// choice, and the answers of a report go to the worker in one reply once every question has its
// choice. This module holds the rule and the texts. No DOM, no imports: tests/answers.test.ts
// imports it in Node.

/** A question of a report, as `task_list` gives it. */
export interface AnswerQuestion {
  number: number;
  text: string;
  options: string[];
}

/** The text per answer that a worker understands (CLAUDE.md, section Background workers). */
function answerText(number: number, option: string): string {
  return `Answer to question ${number}: ${option}`;
}

/**
 * The reply to the worker: one `Answer to question N: <option>` per question, in the order of the
 * questions, joined with spaces (the worker script joins a message to one line). Null while a
 * question has no choice: then nothing goes to the worker.
 */
export function replyText(questions: AnswerQuestion[], choices: ReadonlyMap<number, string>): string | null {
  if (questions.length === 0) return null;
  const answers: string[] = [];
  for (const question of questions) {
    const choice = choices.get(question.number);
    if (choice === undefined) return null;
    answers.push(answerText(question.number, choice));
  }
  return answers.join(" ");
}

/** The line for the triage chat: one line per report, with each question and its option. */
export function answeredLine(task: string, questions: AnswerQuestion[], choices: ReadonlyMap<number, string>): string {
  if (questions.length === 1) {
    const question = questions[0];
    return `Question ${question.number} of ${task} answered in Dispatch: ${choices.get(question.number) ?? ""}`;
  }
  const parts = questions.map((question) => `question ${question.number}: ${choices.get(question.number) ?? ""}`);
  return `Questions of ${task} answered in Dispatch: ${parts.join("; ")}`;
}

/** How many questions have a choice, for the title of the card: `1 of 2 chosen`. */
export function chosenCount(questions: AnswerQuestion[], choices: ReadonlyMap<number, string>): string {
  const chosen = questions.filter((question) => choices.has(question.number)).length;
  return `${chosen} of ${questions.length} chosen`;
}

// The Questions window (ticket question-window): it shows the questions of one report with their
// options, like the Decisions window of a plan, and sends all answers in one reply.

/**
 * The choices of the window when it opens: for each question the choice that the card kept, else
 * the recommended option (the first one). A question without options gets no choice.
 */
export function windowChoices(questions: AnswerQuestion[], saved: ReadonlyMap<number, string>): Map<number, string> {
  const choices = new Map<number, string>();
  for (const question of questions) {
    const kept = saved.get(question.number);
    if (kept !== undefined && question.options.includes(kept)) choices.set(question.number, kept);
    else if (question.options.length > 0) choices.set(question.number, question.options[0]);
  }
  return choices;
}

/** The title of the window: `Question of <task>` for one question, `<N> questions of <task>` for several. */
export function windowTitle(task: string, questions: AnswerQuestion[]): string {
  return questions.length === 1 ? `Question of ${task}` : `${questions.length} questions of ${task}`;
}

/** A wait that alerted, as far as the window needs it: its kind and its key. */
export interface WaitRef {
  kind: string;
  key: string;
}

/**
 * The wait whose window opens by itself: the key of the first new wait of the kind `question`, or
 * null. Null also while a window of the app is open, so the window never covers another one.
 */
export function questionWaitToOpen(found: WaitRef[], dialogOpen: boolean): string | null {
  if (dialogOpen) return null;
  return found.find((wait) => wait.kind === "question")?.key ?? null;
}
