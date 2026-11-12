// The texts of the bar at the bottom of the window, the weekly usage among them. No imports, so a test can load this file
// without a browser (tests/status.test.ts). `src/statusbar.ts` writes them into the page.

/** The reply of the `status_info` command. */
export interface StatusInfo {
  /** The version of this app. */
  dispatch: string;
  /** `found` with its version, `no-version` (it starts, its answer holds no version), `missing` (it does not start). */
  claude: { state: "found" | "no-version" | "missing"; version: string | null };
  /** The email only for `signed-in`. `unknown`: the login could not be read. */
  account: { state: "signed-in" | "signed-out" | "no-email" | "unknown"; email: string | null };
}

/** One part of the bar. `missing` marks a value that is not there, in the colour of a wait. */
export interface StatusPart {
  text: string;
  title: string;
  missing: boolean;
}

const ACCOUNT_TITLE = "The Claude account that Claude Code is signed in with on this computer (claude auth status). It stays on this computer.";
/** The label before the email in the bar. The other account texts say what they are and get no label. */
export const ACCOUNT_LABEL = "Claude account: ";
const CLAUDE_TITLE = "The version of Claude Code that is installed (claude --version)";
const DISPATCH_TITLE = "The version of Dispatch that runs";
const WAITING = "…";

function part(text: string, title: string, missing = false): StatusPart {
  return { text, title, missing };
}

/** The versions of Dispatch in this window and on the host, in the mode "Use a host" (remote-client-mode). */
export interface HostVersions {
  window: string;
  host: string;
}

/**
 * The Dispatch part: in the mode "Use hosts" it warns when the window and the host run different
 * versions; with `hostName` the warning names the host (remote-multi-host).
 */
function dispatchPart(version: string, host: HostVersions | null | undefined, hostName: string | null | undefined): StatusPart {
  if (!host) return part(`Dispatch ${version}`, DISPATCH_TITLE);
  if (host.window !== host.host) {
    const which = hostName ? `host ${hostName}` : "host";
    return part(
      `Dispatch ${host.window} · ${which} ${host.host}`,
      `This window runs Dispatch ${host.window}, the ${which} runs Dispatch ${host.host}. Update both to the same version.`,
      true,
    );
  }
  return part(`Dispatch ${version}`, `${DISPATCH_TITLE}. The host runs the same version.`);
}

/**
 * The three parts of the bar for a reply, or "…" in each part before the first reply. `host`
 * gives the two versions in the mode "Use hosts". `hostName` names the host whose values the bar
 * shows when the window has more than one (remote-multi-host): the account part starts with it.
 */
export function statusParts(
  info: StatusInfo | null,
  host?: HostVersions | null,
  hostName?: string | null,
): { account: StatusPart; claude: StatusPart; dispatch: StatusPart } {
  if (!info) {
    return { account: part(WAITING, ACCOUNT_TITLE), claude: part(WAITING, CLAUDE_TITLE), dispatch: part(WAITING, DISPATCH_TITLE) };
  }
  const named =
    info.account.state === "signed-in" && info.account.email
      ? part(`${ACCOUNT_LABEL}${info.account.email}`, ACCOUNT_TITLE)
      : info.account.state === "signed-out"
        ? part("Not signed in to Claude Code", ACCOUNT_TITLE, true)
        : info.account.state === "no-email" || info.account.state === "signed-in"
          ? part("Signed in without an email", ACCOUNT_TITLE)
          : part("Account not known", ACCOUNT_TITLE, true);
  const claude =
    info.claude.state === "found" && info.claude.version
      ? part(`Claude Code ${info.claude.version}`, CLAUDE_TITLE)
      : info.claude.state === "missing"
        ? part("Claude Code not found", CLAUDE_TITLE, true)
        : part("Claude Code, version not known", CLAUDE_TITLE);
  const account = hostName ? { ...named, text: `${hostName} · ${named.text}` } : named;
  return { account, claude, dispatch: dispatchPart(info.dispatch, host, hostName) };
}

/** One weekly line of `/usage` of Claude Code: its name as Claude Code writes it ("all models", "Fable"), the percent used and the reset text. */
export interface UsageWeek {
  name: string;
  percent: number;
  resets: string | null;
}

/** The reply of the `usage_info` command. `none`: the answer has no weekly line. `unknown`: the usage could not be read. */
export interface UsageInfo {
  state: "found" | "none" | "unknown";
  weeks: UsageWeek[];
}

/**
 * The model of the second usage value: the weekly line whose name holds this word, without regard
 * to capital letters. The word is the one of the model list of the triage bar and of `/usage` of
 * Claude Code 2.1.322 ("Current week (Fable)"). When a new model gets its own weekly line, change it here.
 */
export const USAGE_MODEL = "Fable";
const ALL_MODELS = "all models";
const USAGE_SOURCE = "as /usage of Claude Code shows it. The numbers stay on this computer.";

function clock(at: Date | null): string {
  return at ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` : "";
}

function weekTitle(what: string, week: UsageWeek, at: Date | null): string {
  return [`The weekly usage of the Claude account for ${what}, ${USAGE_SOURCE}`, week.resets ? `Resets ${week.resets}.` : "", at ? `Read at ${clock(at)}.` : ""]
    .filter(Boolean)
    .join(" ");
}

const RESET_TITLE = `When the weekly usage of the Claude account starts again, ${USAGE_SOURCE}`;

/** The reset text of Claude Code without its trailing bracket group, the time zone. A text without one stays whole. */
function shortReset(resets: string): string {
  return resets.replace(/\s*\([^()]*\)\s*$/, "") || resets;
}

/**
 * The reset part of the bar from the weekly lines that the bar shows. One text when all reset texts
 * are the same, else each with its name as Claude Code writes it. The tooltip keeps the full texts.
 */
function resetPart(weeks: (UsageWeek | undefined)[], at: Date | null): StatusPart {
  const timed = weeks.filter((week): week is UsageWeek & { resets: string } => Boolean(week?.resets));
  if (timed.length === 0) return part("", RESET_TITLE);
  const short = timed.map((week) => shortReset(week.resets));
  const text = short.every((text) => text === short[0])
    ? `Resets ${short[0]}`
    : `Resets: ${timed.map((week, i) => `${week.name} ${short[i]}`).join(" · ")}`;
  const title = [RESET_TITLE, ...timed.map((week) => `${week.name}: ${week.resets}.`), at ? `Read at ${clock(at)}.` : ""]
    .filter(Boolean)
    .join(" ");
  return part(text, title);
}

/**
 * The three usage parts of the bar: all models, the model `USAGE_MODEL`, and when the weekly usage
 * starts again. `account` and `claude` are the states of the last reply of `status_info`, `null`
 * before it; `at` is the time of the read. Without a login or without Claude Code all parts are
 * empty: the account part says why. The reset part is empty when no shown line has a reset text.
 */
export function usageParts(
  usage: UsageInfo | null,
  account: StatusInfo["account"]["state"] | null,
  claude: StatusInfo["claude"]["state"] | null,
  at: Date | null,
): { week: StatusPart; model: StatusPart; reset: StatusPart } {
  const title = `The weekly usage of the Claude account, ${USAGE_SOURCE}`;
  const noReset = part("", RESET_TITLE);
  if (claude === "missing" || account === "signed-out") {
    return { week: part("", title), model: part("", title), reset: noReset };
  }
  if (!usage) {
    return { week: part(WAITING, title), model: part(WAITING, title), reset: noReset };
  }
  if (usage.state === "unknown") {
    return { week: part("Usage not known", `${title} It could not be read.${at ? ` Last try at ${clock(at)}.` : ""}`), model: part("", title), reset: noReset };
  }
  if (usage.state === "none" || usage.weeks.length === 0) {
    return { week: part("No weekly limit", `${title} The usage screen has no weekly line for this account.`), model: part("", title), reset: noReset };
  }
  const has = (week: UsageWeek, word: string) => week.name.toLowerCase().includes(word.toLowerCase());
  const all = usage.weeks.find((week) => has(week, ALL_MODELS));
  const model = usage.weeks.find((week) => week !== all && has(week, USAGE_MODEL));
  const names = usage.weeks.map((week) => week.name).join(", ");
  const percent = (week: UsageWeek) => `${Math.round(week.percent)} %`;
  return {
    week: all
      ? part(`Week: all models ${percent(all)}`, weekTitle("all models", all, at))
      : part("All models: no weekly limit", `${title} The usage screen has no weekly line for all models. Its weekly lines: ${names}.`),
    model: model
      ? part(`${model.name} ${percent(model)}`, weekTitle(`the model ${model.name}`, model, at))
      : part(`${USAGE_MODEL}: no weekly limit`, `${title} The usage screen has no weekly line for ${USAGE_MODEL}. Its weekly lines: ${names}.`),
    reset: resetPart([all, model], at),
  };
}
