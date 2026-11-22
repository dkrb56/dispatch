// The lines of the next changelog entry, for the step prepare of .dispatch/release.ps1 (ticket
// the-changelog-entry-of-0-1-85-names-a). Run: node scripts/changelog-lines.ts <from-tag> [<to-ref>]
// Prints each line `- …`, then one `Left out of the changelog: …` line per skipped subject. A subject
// that gives no line that keeps the rules of src/changelog.ts prints `STOP: <subject> (<rule>)`, and
// the exit code is then 1. Everything goes to stdout: the release script hides stderr.
import { execFileSync } from "node:child_process";
import { changelogLines } from "../src/changelog.ts";

const [from, to = "HEAD"] = process.argv.slice(2);
if (!from) {
  console.log("STOP: usage: node scripts/changelog-lines.ts <from-tag> [<to-ref>]");
  process.exit(2);
}
let log: string;
try {
  log = execFileSync("git", ["log", "--no-merges", "--reverse", "--format=%s", `${from}..${to}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  const stderr = String((error as { stderr?: unknown }).stderr ?? "").trim().split(/\r?\n/)[0];
  console.log(`STOP: git log ${from}..${to} failed: ${stderr || String(error)}`);
  process.exit(2);
}
const subjects = log.split(/\r?\n/).filter((line) => line.trim() !== "");
const result = changelogLines(subjects);
for (const stop of result.stops) console.log(`STOP: ${stop.subject} (${stop.rule})`);
if (result.stops.length > 0) process.exit(1);
for (const line of result.lines) console.log(line);
for (const subject of result.skipped) console.log(`Left out of the changelog: ${subject}`);
