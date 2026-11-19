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

/** One part of a formatted text: a kind and its text (a field has a label and a value). */
export type TextPart =
  | { kind: "gap" }
  | { kind: "heading"; text: string }
  | { kind: "field"; label: string; value: string }
  | { kind: "number"; mark: string; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "text"; text: string };

/** Sorts each line into one kind of part, for the look of the texts of the window. */
export function formatLines(lines: string[]): TextPart[] {
  return lines.map((raw): TextPart => {
    const line = raw.trim();
    if (line === "") return { kind: "gap" };
    const bullet = /^(?:[-*•])\s+(.*)$/.exec(line);
    if (bullet) return { kind: "bullet", text: bullet[1] };
    const number = /^(\d+[.)])\s+(.*)$/.exec(line);
    if (number) return { kind: "number", mark: number[1], text: number[2] };
    if (line.endsWith(":") && line.split(/\s+/).length <= 5) {
      return { kind: "heading", text: line.slice(0, -1).trim() };
    }
    const field = /^([\p{L}\p{N}][\p{L}\p{N} ]*?):\s+(\S.*)$/u.exec(line);
    if (field && field[1].trim().split(/\s+/).length <= 4) {
      return { kind: "field", label: field[1].trim(), value: field[2] };
    }
    return { kind: "text", text: line };
  });
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
