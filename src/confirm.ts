// The confirm card of a check step (ticket confirm-a-check-step-s-result-on-the): a work run stops
// with the result of a check step under `## Check result` and one question with two options (keep,
// change). The task card shows the result, a box for changes and a Confirm button. This module holds
// the rule and the texts. No DOM, no imports: tests/confirm.test.ts imports it in Node.

/** A question of a report, as `task_list` gives it. */
export interface ConfirmQuestion {
  number: number;
  text: string;
  options: string[];
}

/**
 * The question of the confirm card: the report has lines under `## Check result`, exactly one
 * question, and that question has two options or more. Null else: the plain question card shows.
 */
export function confirmQuestion(checkResult: readonly string[], questions: readonly ConfirmQuestion[]): ConfirmQuestion | null {
  if (!checkResult.some((line) => line.trim() !== "")) return null;
  if (questions.length !== 1) return null;
  const question = questions[0];
  return question.options.length >= 2 ? question : null;
}

/**
 * The option that goes back to the worker: the first option (keep) for an empty box, else the second
 * option (change), a colon, a space and the words of the box, with line breaks as spaces.
 */
export function confirmChoice(question: ConfirmQuestion, changes: string): string {
  const words = changes.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (words === "") return question.options[0];
  return `${question.options[1]}: ${words}`;
}

/** The line for the triage chat after a confirm, by a click or by the project setting. */
export function confirmLine(task: string, choice: string, auto: boolean): string {
  return auto
    ? `Check result of ${task} confirmed automatically in Dispatch (project setting): ${choice}`
    : `Check result of ${task} confirmed in Dispatch: ${choice}`;
}

/** The title of the confirm card. */
export const CONFIRM_TITLE = "A check step waits for your confirmation";

/** The placeholder of the box for changes. */
export const CONFIRM_PLACEHOLDER = "Leave empty to keep the result, or write what to change";

/** The tooltip of the Confirm button. */
export const CONFIRM_TIP = "Send your answer to the work run: keep the result when the box is empty, else change it with your words";

/** The label of the row that opens the result. */
export const RESULT_LABEL = "Check result";

/** The tooltip of the row that opens the result. */
export const RESULT_TIP = "Open the result of the check step of this task";
