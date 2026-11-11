// The texts at the top of the Decisions window (tickets decisions-context and decisions-tldr): the
// user's words of the brief, the Goal of the plan, and the TL;DR of the plan in plain words. No
// imports and no access to the page, so a test can load this file with Node
// (tests/decisions-context.test.ts). main.ts renders the blocks.

/** One text block of the window: its label and its lines. */
export interface ContextBlock {
  label: string;
  lines: string[];
}

/** The parts of a task that the window shows; `task_list` gives them. */
export interface ContextSource {
  words?: string[];
  goal?: string[];
  tldr?: string[];
}

/** The label above the TL;DR of the plan (decision 3 of the plan decisions-tldr). */
export const TLDR_LABEL = "TL;DR";

/** The blocks of the scrolling box: "Your words" and "Goal of the plan", without the empty ones. */
export function contextBlocks(info: ContextSource | null | undefined): ContextBlock[] {
  const blocks: ContextBlock[] = [
    { label: "Your words", lines: info?.words ?? [] },
    { label: "Goal of the plan", lines: info?.goal ?? [] },
  ];
  return blocks.filter((block) => block.lines.length > 0);
}

/** The TL;DR block under the box, or null when the plan has no TL;DR (a plan from before the rule). */
export function tldrBlock(info: ContextSource | null | undefined): ContextBlock | null {
  const lines = info?.tldr ?? [];
  return lines.length > 0 ? { label: TLDR_LABEL, lines } : null;
}
