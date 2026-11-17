// The texts of the Git state window (ticket add-git-state-button-to-the-project): the label chips of a
// commit, the age of a commit, the word of a file status, the head line and the classes of the diff
// lines. No imports and no access to the page, so a test can load this file with Node
// (tests/gitstate.test.ts).

/** The kind of a label chip: HEAD, a local branch, a remote branch, a tag or another name. */
export type ChipKind = "head" | "branch" | "remote" | "tag" | "other";

/** The label chips of the full ref names of a commit, as `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`. */
export function refChips(refs: string): { text: string; kind: ChipKind }[] {
  const chips: { text: string; kind: ChipKind }[] = [];
  for (const part of refs.split(", ")) {
    const name = part.trim();
    if (!name) continue;
    if (name.startsWith("HEAD -> ")) {
      chips.push({ text: "HEAD", kind: "head" });
      chips.push(refChip(name.slice("HEAD -> ".length)));
    } else if (name === "HEAD") {
      chips.push({ text: "HEAD", kind: "head" });
    } else if (name.startsWith("tag: ")) {
      chips.push({ text: `tag ${name.slice("tag: ".length).replace(/^refs\/tags\//, "")}`, kind: "tag" });
    } else {
      chips.push(refChip(name));
    }
  }
  return chips;
}

function refChip(name: string): { text: string; kind: ChipKind } {
  if (name.startsWith("refs/heads/")) return { text: name.slice("refs/heads/".length), kind: "branch" };
  if (name.startsWith("refs/remotes/")) return { text: name.slice("refs/remotes/".length), kind: "remote" };
  return { text: name.replace(/^refs\//, ""), kind: "other" };
}

/** The age of a commit from its time in seconds: "just now", "5 min ago", "2h ago", "3 days ago", or its date after 30 days. */
export function ageText(seconds: number, nowMs: number): string {
  const diff = Math.max(0, Math.floor(nowMs / 1000 - seconds));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days <= 30) return days === 1 ? "1 day ago" : `${days} days ago`;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** The word of the two status letters of `git status --porcelain`. */
export function statusWord(status: string): string {
  if (status === "??") return "untracked";
  if (/U/.test(status) || status === "AA" || status === "DD") return "conflict";
  if (/R/.test(status)) return "renamed";
  if (/C/.test(status)) return "copied";
  if (/A/.test(status)) return "added";
  if (/D/.test(status)) return "deleted";
  if (/[MT]/.test(status)) return "modified";
  return status.trim();
}

/** The one letter of a file status for the Changes list. */
export function statusLetter(status: string): string {
  if (status === "??") return "?";
  const word = statusWord(status);
  return word === "conflict" ? "!" : (status.trim()[0] ?? "");
}

/** The head line of the window: the branch with its ahead and behind counts against its remote branch. */
export function headLine(state: { branch: string | null; upstream: string | null; ahead: number; behind: number }): string {
  if (state.branch === null) return "detached HEAD";
  if (!state.upstream) return `${state.branch} · no remote branch`;
  return `${state.branch} · ↑${state.ahead} ↓${state.behind} against ${state.upstream}`;
}

/** The look of one diff line. */
export type DiffClass = "added" | "removed" | "hunk" | "plain";

/** The most diff lines that the window shows. */
export const DIFF_MAX_LINES = 3000;

/**
 * The lines of a diff text with their look. The header lines before the first hunk (`diff --git`,
 * `index`, `---`, `+++`) are left out when a hunk exists; a text without a hunk shows as it is. After
 * `DIFF_MAX_LINES` lines a note "diff cut here" ends the list.
 */
export function diffRows(text: string): { text: string; cls: DiffClass }[] {
  let lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const first = lines.findIndex((line) => line.startsWith("@@"));
  if (first > 0) lines = lines.slice(first);
  const rows: { text: string; cls: DiffClass }[] = [];
  let inHunk = false;
  for (const line of lines) {
    if (rows.length === DIFF_MAX_LINES) {
      rows.push({ text: "… diff cut here", cls: "plain" });
      break;
    }
    if (line.startsWith("@@")) inHunk = true;
    rows.push({ text: line, cls: diffClass(line, inHunk) });
  }
  return rows;
}

function diffClass(line: string, inHunk: boolean): DiffClass {
  if (line.startsWith("@@")) return "hunk";
  if (inHunk && line.startsWith("+")) return "added";
  if (inHunk && line.startsWith("-")) return "removed";
  return "plain";
}

/** The text of the row on top of the history: "Uncommitted changes · 1 file". */
export function uncommittedText(count: number): string {
  return `Uncommitted changes · ${count} ${count === 1 ? "file" : "files"}`;
}
