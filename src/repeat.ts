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
      return `Task ${task} stopped in Dispatch: the worker left the answered question in its report and the user stopped the task. The task is ended; the rest needs a new task.`;
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
    records.set(task, { modified: record.modified, questions, reply: typeof record.reply === "string" ? record.reply : "" });
  }
  return records;
}

/** The text that `parseAnswered` reads back: the newest records by report time. */
export function serializeAnswered(records: ReadonlyMap<string, AnsweredReport>): string {
  const newest = [...records].sort((a, b) => b[1].modified - a[1].modified).slice(0, KEEP);
  return JSON.stringify(Object.fromEntries(newest));
}
