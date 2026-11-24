// An answered question that comes back (ticket answered-question-repeat): the worker got the answer
// of the user and wrote its report again with the same question. Dispatch then shows no new question
// with buttons, but what the user answered and a conscious next step. This module holds the rule,
// the texts and the store. No DOM, no imports: tests/repeat.test.ts imports it in Node.

/** A question of a report, as `task_list` gives it. */
export interface RepeatQuestion {
  number: number;
  text: string;
  options: string[];
}

/** A question that the user answered, with the chosen option. */
export interface AnsweredQuestion extends RepeatQuestion {
  answer: string;
}

/**
 * The record of an answered report: the time of the report then, its questions with the answers,
 * and the reply that went to the worker, word for word. A Continue for a permission has no questions.
 */
export interface AnsweredReport {
  modified: number;
  questions: AnsweredQuestion[];
  reply: string;
  /**
   * The ids of the workers of the task when the reply went out (ticket
   * continue-comes-back-on-the-task-card). A worker id that is not in this list is the run of the
   * reply. A record of an older version has no list.
   */
  workers?: string[];
}

/** The key of the store in localStorage (decision 1 of the plan). */
export const ANSWERED_KEY = "answered-reports";

/** The store keeps the newest records only, by report time. */
const KEEP = 200;

/** The record of a reply: each question of the report with its chosen option. */
export function answeredRecord(
  modified: number,
  questions: readonly RepeatQuestion[],
  choices: ReadonlyMap<number, string>,
  reply: string,
): AnsweredReport {
  return {
    modified,
    questions: questions.map((question) => ({ number: question.number, text: question.text, options: [...question.options], answer: choices.get(question.number) ?? "" })),
    reply,
  };
}

/** The same question: the same number, text and options, without white space at their ends. */
function same(answered: RepeatQuestion, asked: RepeatQuestion): boolean {
  const options = (question: RepeatQuestion) => question.options.map((option) => option.trim());
  return (
    answered.number === asked.number &&
    answered.text.trim() === asked.text.trim() &&
    JSON.stringify(options(answered)) === JSON.stringify(options(asked))
  );
}

/**
 * The answered questions that a report asks again, in the order of the report, or null. Null
 * without a record, for the answered report itself (it waits for the worker), for a report without
 * questions, and when one question of the report is not an answered one: then it shows as a new
 * question with buttons for all (decision 4 of the plan).
 */
export function repeatedQuestions(
  record: AnsweredReport | undefined,
  modified: number,
  questions: readonly RepeatQuestion[],
): AnsweredQuestion[] | null {
  if (!record || record.modified === modified || questions.length === 0) return null;
  const repeats: AnsweredQuestion[] = [];
  for (const question of questions) {
    const answered = record.questions.find((known) => same(known, question));
    if (!answered) return null;
    repeats.push(answered);
  }
  return repeats;
}

/** A worker of a task as the answered rule needs it: its job id and its state. */
export interface AnswerWorker {
  id: string;
  state: string | null;
}

/**
 * True when the answered record still hides the report of this time (ticket
 * continue-comes-back-on-the-task-card): the record is for this report time and the run of the reply
 * has not ended. The run of the reply ended when a worker id that was not there at the send is in
 * the list and no worker of the list is working or blocked. Then the report did not change and its
 * card comes back. A record without worker ids (an older version) stands (decision 1 of the plan).
 */
export function answerStands(
  record: AnsweredReport | undefined,
  modified: number,
  workers: readonly AnswerWorker[],
): boolean {
  if (!record || record.modified !== modified) return false;
  if (!record.workers) return true;
  const before = new Set(record.workers);
  const started = workers.some((worker) => !before.has(worker.id));
  const live = workers.some((worker) => worker.state === "working" || worker.state === "blocked");
  return !started || live;
}

/** The texts of the repeat card. */
export interface RepeatCard {
  title: string;
  /** One line per question: the question and the answer of the user. */
  lines: string[];
  note: string;
}

export function repeatCardText(repeats: readonly AnsweredQuestion[]): RepeatCard {
  const several = repeats.length > 1;
  return {
    title: "The worker asks again what you answered",
    lines: repeats.map((question) => `${question.number}. ${question.text.trim()} Your answer: ${question.answer}`),
    note: several
      ? "Your answers went to the worker. It wrote its report again with the same questions. Choose what happens now."
      : "Your answer went to the worker. It wrote its report again with the same question. Choose what happens now.",
  };
}

/** The buttons of the repeat card (decision 3 of the plan). */
export type RepeatAction = "continue" | "again" | "stop";

/**
 * The line for the triage chat of a click in the repeat card. It is no "answered in Dispatch"
 * line: triage hears about an answer once, at the first click.
 */
export function repeatLine(task: string, action: RepeatAction): string {
  const kept = `The worker of ${task} left the answered question in its report.`;
  switch (action) {
    case "continue":
      return `${kept} The user clicked Continue in Dispatch: the worker goes on with the answers it has.`;
    case "again":
      return `${kept} The user sent the same answer again in Dispatch.`;
    case "stop":
      return `Task ${task} stopped in Dispatch: the worker left the answered question in its report and the user stopped the task. The task is ended until the user clicks Resume.`;
  }
}

/** The stored records, by task name. A missing or broken value gives an empty map; a broken record is left out. */
export function parseAnswered(stored: string | null | undefined): Map<string, AnsweredReport> {
  const records = new Map<string, AnsweredReport>();
  let saved: unknown;
  try {
    saved = stored ? JSON.parse(stored) : {};
  } catch {
    return records;
  }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return records;
  for (const [task, value] of Object.entries(saved as Record<string, unknown>)) {
    const record = value as Partial<AnsweredReport> | null;
    if (!record || typeof record.modified !== "number" || !Array.isArray(record.questions)) continue;
    const questions = record.questions.filter(
      (question): question is AnsweredQuestion =>
        !!question &&
        typeof question.number === "number" &&
        typeof question.text === "string" &&
        typeof question.answer === "string" &&
        Array.isArray(question.options) &&
        question.options.every((option: unknown) => typeof option === "string"),
    );
    const kept: AnsweredReport = { modified: record.modified, questions, reply: typeof record.reply === "string" ? record.reply : "" };
    if (Array.isArray(record.workers) && record.workers.every((id: unknown) => typeof id === "string")) kept.workers = [...record.workers];
    records.set(task, kept);
  }
  return records;
}

/** The text that `parseAnswered` reads back: the newest records by report time. */
export function serializeAnswered(records: ReadonlyMap<string, AnsweredReport>): string {
  const newest = [...records].sort((a, b) => b[1].modified - a[1].modified).slice(0, KEEP);
  return JSON.stringify(Object.fromEntries(newest));
}

/**
 * A reply of the user that waits in the queue of its project (ticket an-answer-waits-in-the-queue-while):
 * answers, a Confirm or a Continue that came while the checkout was on the branch of another task.
 * Dispatch sends `text` word for word when the checkout is back on the base, then keeps `record`.
 */
export interface QueuedReply {
  /** The project key and the task name, as `queueKey` of main.ts. */
  key: string;
  /** The record of the answered report that the send keeps (`markAnswered`). */
  record: AnsweredReport;
  /** The text that goes to the worker, word for word. */
  text: string;
  /** The line for triage of the click. */
  line: string;
  /** The time of the click: its place among the queued approvals. */
  at: number;
}

/** The key of the waiting replies in localStorage. */
export const QUEUED_REPLIES_KEY = "queued-replies";

/** The stored waiting replies in the order of the clicks. A missing or broken value gives none; a broken entry is left out. */
export function parseQueuedReplies(stored: string | null | undefined): QueuedReply[] {
  let saved: unknown;
  try {
    saved = stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(saved)) return [];
  const replies: QueuedReply[] = [];
  for (const entry of saved as Partial<QueuedReply>[]) {
    if (!entry || typeof entry.key !== "string" || typeof entry.text !== "string" || typeof entry.line !== "string" || typeof entry.at !== "number") continue;
    // The record goes through the reader of the answered reports, which drops a broken one.
    const record = parseAnswered(JSON.stringify({ reply: entry.record })).get("reply");
    if (!record) continue;
    replies.push({ key: entry.key, record, text: entry.text, line: entry.line, at: entry.at });
  }
  return replies;
}

/** The text that `parseQueuedReplies` reads back. */
export function serializeQueuedReplies(replies: Iterable<QueuedReply>): string {
  return JSON.stringify([...replies]);
}

/**
 * A reply that the worker script kept because the project was busy (ticket
 * keep-a-reply-that-the-worker-script): the file `<ticket>.reply` of the host, as `kept` of the task read.
 */
export interface KeptReply {
  /** The reply word for word, as the script cleaned it. */
  text: string;
  /** The time of the refusal, in ms. */
  at: number;
  /** The time of the report that the reply answers, in ms; 0 without a report. */
  report: number;
}

/**
 * The queued reply that a kept reply of the host becomes (ticket keep-a-reply-that-the-worker-script),
 * or null: when there is none, when it answers another report than `report`, when the key has a
 * queued reply already (a reply of the card or the Questions window, refused by the script too), or
 * when the user took back this kept reply (`cancelled`: the time `at` of it, by key).
 */
export function keptToQueue(
  key: string,
  kept: KeptReply | null | undefined,
  report: number,
  queued: ReadonlyMap<string, unknown>,
  cancelled: ReadonlyMap<string, number>,
): QueuedReply | null {
  if (!kept || !kept.text.trim() || kept.report !== report || queued.has(key) || cancelled.get(key) === kept.at) return null;
  const task = key.slice(key.lastIndexOf("\n") + 1);
  return {
    key,
    record: { modified: kept.report, questions: [], reply: kept.text },
    text: kept.text,
    line: `The user replied to ${task} in a chat or on the phone while the project was busy, and the worker script kept the reply: ${kept.text}`,
    at: kept.at,
  };
}
