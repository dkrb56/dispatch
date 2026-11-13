// The paths that the viewer turns into links, and the text of the link of a rule finding (ticket
// open-files-from-windows). No DOM access, so Node can test it.

import type { Finding } from "./rulecheck";

/** The header keys of a report (the section "Background workers"). */
const HEADER_KEYS = ["state", "needs", "files", "plan"];

/**
 * The file extensions that make a bare name (no folder) a file. A name with a folder needs only an
 * extension of its own; a bare name like `info.plan` or `window.close` is code, not a file.
 */
const FILE_EXTENSIONS = new Set([
  "md", "markdown", "txt", "log", "json", "jsonl", "toml", "yaml", "yml", "xml", "ini", "cfg", "conf", "csv", "lock",
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "css", "scss", "html", "htm", "svg",
  "rs", "py", "go", "java", "kt", "swift", "c", "h", "cpp", "hpp", "cs", "lua", "sql", "sh", "ps1", "psm1", "cmd", "bat",
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf", "ipynb",
]);

/**
 * The files of the `files:` line of a report: the header at its top (title lines and empty lines
 * first, then `key: value` lines up to the first empty line, as `parse_report` reads it). A note in
 * parentheses goes, `none` and an item that is not a path give nothing. A text without a `state`
 * line has no header.
 */
export function reportFiles(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let at = 0;
  while (at < lines.length && (lines[at] === "" || lines[at].startsWith("#"))) at += 1;
  let files = "";
  let state = false;
  for (; at < lines.length && lines[at] !== ""; at += 1) {
    const colon = lines[at].indexOf(":");
    if (colon < 0) break;
    const key = lines[at].slice(0, colon).trim().toLowerCase();
    if (!HEADER_KEYS.includes(key)) break;
    const value = lines[at].slice(colon + 1).trim();
    if (key === "state") state = true;
    if (key === "files") files = value;
  }
  if (!state) return [];
  return files
    .replace(/\([^)]*\)/g, "")
    .split(",")
    .map((item) => item.trim().replace(/^`(.*)`$/, "$1"))
    .filter((item) => item !== "" && item.toLowerCase() !== "none")
    .map(linkPath)
    .filter((path): path is string => path !== null);
}

/**
 * The path of the text of a code span, or null when the text is not a path: a command, a flag, a
 * URL, a version, a word, a placeholder, a glob or a folder. A `:line` or `:line:column` at the end
 * goes; a drive letter stays.
 */
export function linkPath(code: string): string | null {
  let text = code.trim();
  if (text === "" || text.length > 260) return null;
  if (/\s/.test(text) || text.includes("://") || /[*?<>|"'`%$~{}]/.test(text) || text.startsWith("-")) return null;
  text = text.replace(/:\d+(?:[-:]\d+)?$/, "");
  if (/[\\/]$/.test(text)) return null;
  // A colon only after a drive letter.
  if (text.replace(/^[A-Za-z]:(?=[\\/])/, "").includes(":")) return null;
  const parts = text.split(/[\\/]/);
  const name = parts[parts.length - 1];
  if (parts.length > 1) {
    // A file with an extension, or a dot file such as `.gitignore`.
    return /^[^.]+(?:\.[^.]+)*\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(name) || /^\.[A-Za-z][\w.-]*$/.test(name) ? text : null;
  }
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return FILE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase()) ? text : null;
}

/**
 * The folder that a relative path in a file counts from: the project for a file in its `.dispatch`
 * folder (a report, a plan, a brief), else the folder of the file.
 */
export function linkBase(path: string): string {
  const task = /^(.*?)[\\/]\.dispatch[\\/]/.exec(path);
  if (task) return task[1];
  const end = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return end < 0 ? "" : path.slice(0, end);
}

/** The label and the tooltip of the link that opens the file of a finding. */
export function findingOpen(finding: Pick<Finding, "file" | "outside">): { label: string; title: string } {
  const label = finding.file.split(/[\\/]/).pop() || finding.file;
  const title = finding.outside
    ? `Open ${finding.file}. The file is outside this project. To change the rule yourself, click Open in editor at the top of the view (only for a file of this PC).`
    : `Open ${finding.file}`;
  return { label, title };
}
