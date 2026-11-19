// Why the work run of an approved task waits, when a HOLD decision of its plan names a step for the
// user (ticket hold-step-action): Dispatch only writes the choice into the plan; it does not do the
// step. When a changed path that holds the start stands in a HOLD decision, the text says that the
// step is the user's. It wraps `waitReason` and gives its result unchanged for a plan without HOLD.
// No imports of the page, so a test can load this file with Node (tests/holdstep.test.ts).
import { type WaitFacts, type WaitReason, waitReason } from "./waitreason.ts";

/** A decision of a plan, as far as this rule needs it. */
export interface HoldDecision {
  number: number;
  title: string;
  /** The recommended option is HOLD: only the user takes it. */
  hold: boolean;
  options: readonly { choice: string }[];
}

/** The line under the options of a HOLD decision in the Decisions window. */
export const HOLD_NOTE = "Dispatch only writes this choice into the plan. A step that it names, you do yourself.";

/** The path of a `git status --porcelain` line: after the status, the new name of a rename, without quotes. */
function dirtyPath(line: string): string {
  let path = line.slice(3);
  const arrow = path.indexOf(" -> ");
  if (arrow >= 0) path = path.slice(arrow + 4);
  return path.replace(/^"(.*)"$/, "$1").replace(/\\/g, "/");
}

/** The text names the path, or the path without its trailing "/". */
function names(text: string, path: string): boolean {
  const plain = text.replace(/\\/g, "/");
  const bare = path.replace(/\/$/, "");
  return (path !== "" && plain.includes(path)) || (bare !== "" && plain.includes(bare));
}

/**
 * The reason, or null when nothing holds the work run back. `picks` holds the answers of the user
 * by decision number; it may be empty.
 */
export function holdWait(
  facts: WaitFacts,
  decisions: readonly HoldDecision[],
  picks: ReadonlyMap<number, string> = new Map(),
): WaitReason | null {
  const base = waitReason(facts);
  const holds = decisions.filter((decision) => decision.hold);
  if (!base || holds.length === 0) return base;
  const paths = facts.dirty.map(dirtyPath).filter(Boolean);
  let match: { decision: HoldDecision; paths: string[] } | null = null;
  for (const decision of holds) {
    const pick = picks.get(decision.number);
    const texts = [decision.title, ...decision.options.map((option) => option.choice), ...(pick ? [pick] : [])];
    const named = paths.filter((path) => texts.some((text) => names(text, path)));
    if (named.length > 0) {
      match = { decision, paths: named };
      break;
    }
  }
  const matchFull = match
    ? `Decision ${match.decision.number} names ${match.paths.join(", ")}, and this change holds the start. Dispatch writes the choice into the plan; it does not do the step:\n` +
      `${picks.get(match.decision.number) || match.decision.title}\n` +
      "Do the step yourself, or commit or stash the change. Then the work run starts."
    : "";
  // A pause, a merge or another work run comes first; the step of the decision is named after it.
  if (facts.paused || facts.merging || facts.editing || facts.checkout) return matchFull ? { short: base.short, full: `${base.full}\n\n${matchFull}` } : base;
  if (match) return { short: `Decision ${match.decision.number} is a step for you: Dispatch does not run it.`, full: matchFull };
  return {
    short: base.short,
    full: `${base.full}\nDecision ${holds[0].number} waits for you. If your choice names a step, do it yourself: Dispatch does not do it.`,
  };
}
