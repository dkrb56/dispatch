// The Ask of the Decisions window (ticket i-need-an-option-to-discuss-tasks): the user asks triage
// about a plan or one of its decisions before Approve or Revise. Dispatch sends the question to the
// triage chat as a line (user decision 1); the answer shows in that chat. An Ask approves nothing
// and changes nothing. The footer names each button and says under it what happens after the click
// (user decision 2). No imports of the page, so a test can load this file with Node
// (tests/discuss.test.ts).

/** The decision that a question is about: its number and the first sentence of its title. */
export interface AskDecision {
  number: number;
  name: string;
}

/** The three buttons of the footer of the Decisions window, left to right. */
export const FOOTER_LABELS = {
  ask: "Ask triage about this plan",
  revise: "Revise the plan with my choices",
  approve: "Approve and start the work",
} as const;

/** The line under each footer button: when to use it and what happens after the click. */
export const FOOTER_HINTS = {
  ask: "Not sure? Ask first. Triage answers in its chat. Nothing changes.",
  revise: "The planner writes the plan again with your choices. The card comes back.",
  approve: "Your choices go into the plan. The work starts.",
} as const;

/** The Ask button and its hint in a project with "No triage" on (ticket no-triage-a-project-switch-no-triage-in, user decision 4). */
export const CHAT_ASK_LABEL = "Ask about this plan in a Chat";
export const CHAT_ASK_HINT = "Your question goes to a terminal of this project. Nothing changes.";

/** The question when the user typed none. */
function defaultQuestion(decision?: AskDecision): string {
  return decision ? "Explain this decision and its options in plain words." : "Explain this plan and its decisions in plain words.";
}

/**
 * The line that Dispatch sends to triage for a question of the user. It never starts with `Ticket `:
 * a line of that form is a new ticket for triage. It asks for an explanation only, because only the
 * click in Dispatch approves or revises a plan.
 */
export function askLine(ticket: string, question: string, decision?: AskDecision): string {
  const about = decision ? `, decision ${decision.number} (${decision.name})` : "";
  const text = question.trim().replace(/\s+/g, " ") || defaultQuestion(decision);
  return (
    `Question of the user about plan ${ticket}${about}, from the Decisions window of Dispatch: ${text} ` +
    "Explain in plain words. Do not approve, revise or reject the plan; the user decides in Dispatch."
  );
}

/**
 * The text that Dispatch types into a new plain Chat for a question of the user in a project with
 * "No triage" on (ticket no-triage-a-project-switch-no-triage-in, point 6). It names the plan file,
 * never starts with `Ticket `, and asks for an explanation only: the Chat changes no file and
 * approves, revises or rejects nothing.
 */
export function askChatLine(ticket: string, question: string, decision?: AskDecision): string {
  const about = decision ? `, decision ${decision.number} (${decision.name})` : "";
  const text = question.trim().replace(/\s+/g, " ") || defaultQuestion(decision);
  return (
    `Question of the user about the plan .dispatch/plans/${ticket}.md${about}, from the Decisions window of Dispatch: ${text} ` +
    "Read the plan and explain in plain words. Change no file. Do not approve, revise or reject the plan; the user decides in Dispatch."
  );
}

/** The line over the Ask box: what the question is about. */
export function askAbout(decision?: AskDecision): string {
  return decision ? `Your question about decision ${decision.number}: ${decision.name}` : "Your question about this plan";
}

/** Why the Ask button is off: "" when the project has an open triage chat, else the reason for its tooltip. With "No triage" on, nothing blocks it: the question goes to a new Chat. */
export function askBlocked(triageOpen: boolean, noTriage = false): string {
  return triageOpen || noTriage ? "" : "This project has no open triage chat. Open triage to ask about the plan.";
}
