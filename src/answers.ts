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

/** The questions that the user can answer: those with options. Items without options never block a send. */
export function answerable(questions: AnswerQuestion[]): AnswerQuestion[] {
  return questions.filter((question) => question.options.length > 0);
}

/**
 * The reason why no reply goes, or null when nothing is held back. No question has options: answer
 * in the report's chat. Some questions have no choice while another has one: name the open ones.
 */
export function holdReason(questions: AnswerQuestion[], choices: ReadonlyMap<number, string>): string | null {
  const real = answerable(questions);
  if (real.length === 0) return "The report lists no options for its questions. Answer in the report's chat.";
  const open = real.filter((question) => !choices.has(question.number)).map((question) => question.number);
  if (open.length === 0 || open.length === real.length) return null;
  const names = open.length === 1 ? `question ${open[0]}` : `questions ${open.slice(0, -1).join(", ")} and ${open[open.length - 1]}`;
  return `Choose an answer for ${names} too; then all answers go to the worker.`;
}

/**
 * The reply to the worker: one `Answer to question N: <option>` per question, in the order of the
 * questions, joined with spaces (the worker script joins a message to one line). Null while a
 * question has no choice: then nothing goes to the worker.
 */
export function replyText(questions: AnswerQuestion[], choices: ReadonlyMap<number, string>): string | null {
  const real = answerable(questions);
  if (real.length === 0) return null;
  const answers: string[] = [];
  for (const question of real) {
    const choice = choices.get(question.number);
    if (choice === undefined) return null;
    answers.push(answerText(question.number, choice));
  }
  return answers.join(" ");
}

/** The line for the triage chat: one line per report, with each question and its option. */
export function answeredLine(task: string, questions: AnswerQuestion[], choices: ReadonlyMap<number, string>): string {
  const real = answerable(questions);
  if (real.length === 1) {
    const question = real[0];
    return `Question ${question.number} of ${task} answered in Dispatch: ${choices.get(question.number) ?? ""}`;
  }
  const parts = real.map((question) => `question ${question.number}: ${choices.get(question.number) ?? ""}`);
  return `Questions of ${task} answered in Dispatch: ${parts.join("; ")}`;
}

/** How many questions have a choice, for the title of the card: `1 of 2 chosen`. */
export function chosenCount(questions: AnswerQuestion[], choices: ReadonlyMap<number, string>): string {
  const real = answerable(questions);
  const chosen = real.filter((question) => choices.has(question.number)).length;
  return `${chosen} of ${real.length} chosen`;
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

/** The title of the window: `<project> · Question of <task>` for one question, `<project> · <N> questions of <task>` for several. */
export function windowTitle(task: string, questions: AnswerQuestion[], project: string): string {
  const count = answerable(questions).length;
  return `${project} · ` + (count === 1 ? `Question of ${task}` : `${count} questions of ${task}`);
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

// A reply in flight (ticket this-task-was-waiting-for-my-answers-i): from the click that sends the
// answers until the worker shows as running, the task shows "answered", not "has a question".

/** A reply that goes out: the time of the report it answers, and the time it went (null while the call runs). */
export interface SendingReply {
  modified: number;
  sentAt: number | null;
}

/** The status text while a reply is sending or has just gone. */
export const SENDING_STATUS = "answered · the worker starts again";

/** How long "answered" stays after the reply went, when no worker shows. */
export const SENDING_LIMIT_MS = 30_000;

/**
 * Whether the task shows "answered": the entry belongs to the report that stands now, no worker of
 * the task is live, and (after the call) the time limit has not passed.
 */
export function replySending(entry: SendingReply | undefined, reportModified: number | undefined, live: boolean, now: number): boolean {
  if (!entry || live || entry.modified !== reportModified) return false;
  return entry.sentAt === null || now - entry.sentAt < SENDING_LIMIT_MS;
}
