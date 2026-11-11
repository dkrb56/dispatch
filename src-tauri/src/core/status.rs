//! The values of the bar at the bottom of the window: the email of the Claude account that Claude
//! Code is signed in with, the version of Claude Code, the version of this app, and the weekly usage
//! of the account for all models and for one model, as `/usage` of Claude Code shows it.
//!
//! Privacy: the reply of `claude auth status` holds more than the bar needs (the organisation, the
//! kind of subscription and more). `read_account` takes only whether somebody is signed in and the
//! email, and drops the rest at once. No error text carries that reply, and nothing here writes a
//! file or a log line.
//!
//! The answer of `/usage` holds more than the bar needs too (the session id, a cost, the usage of
//! the last hours, tips). `read_usage` takes only the weekly lines: their name, the percent used
//! and the reset text. The rest is dropped in the same function.

use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use serde_json::Value;

use crate::core::info::{claude_command, NoWindow};
use crate::core::Core;

/// The reply of the `status_info` command. It has only what the bar shows.
#[derive(Serialize, Debug, PartialEq)]
pub struct StatusInfo {
    /// The version of this app.
    dispatch: String,
    claude: ClaudeInfo,
    account: Account,
}

#[derive(Serialize, Debug, PartialEq)]
struct ClaudeInfo {
    /// `found`, `no-version` (it starts, but its answer holds no version) or `missing` (it does not start).
    state: &'static str,
    version: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
struct Account {
    /// `signed-in`, `signed-out`, `no-email` or `unknown` (the login could not be read).
    state: &'static str,
    /// Only for `signed-in`.
    email: Option<String>,
}

/// The exit code and the standard output of one run of `claude`, or `None` when it did not start.
type Run = Option<(i32, String)>;

/// The version from the answer of `claude --version` ("2.1.322 (Claude Code)"): the first word of
/// the first line that is not empty, when it begins with a digit and holds only digits, letters,
/// dots and hyphens. Anything else, such as an error text of `cmd`, gives no version.
fn read_version(text: &str) -> Option<String> {
    let word = text.lines().map(str::trim).find(|line| !line.is_empty())?.split_whitespace().next()?;
    let plain = word.starts_with(|c: char| c.is_ascii_digit()) && word.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    plain.then(|| word.to_string())
}

/// The longest email that the bar shows (the limit of an address).
const EMAIL_MAX: usize = 254;

/// The account from the answer of `claude auth status`, a JSON object. Only `loggedIn` and `email`
/// are read; the other fields of the answer are dropped here.
fn read_account(text: &str) -> Account {
    let Ok(reply) = serde_json::from_str::<Value>(text.trim()) else {
        return Account { state: "unknown", email: None };
    };
    match reply.get("loggedIn").and_then(Value::as_bool) {
        None => Account { state: "unknown", email: None },
        Some(false) => Account { state: "signed-out", email: None },
        Some(true) => {
            let email = reply
                .get("email")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|email| email.contains('@') && email.len() <= EMAIL_MAX && !email.chars().any(char::is_control));
            match email {
                Some(email) => Account { state: "signed-in", email: Some(email.to_string()) },
                None => Account { state: "no-email", email: None },
            }
        }
    }
}

/// The reply of `status_info` from a runner of `claude` and the version of this app. A test passes
/// a made-up runner.
fn status_from(run: impl Fn(&[&str]) -> Run, dispatch: String) -> StatusInfo {
    let unknown = || Account { state: "unknown", email: None };
    let claude = match run(&["--version"]) {
        Some((0, text)) => match read_version(&text) {
            Some(version) => ClaudeInfo { state: "found", version: Some(version) },
            None => ClaudeInfo { state: "no-version", version: None },
        },
        // Not installed or not found: `cmd` ends with an error code. No login to read then.
        _ => return StatusInfo { dispatch, claude: ClaudeInfo { state: "missing", version: None }, account: unknown() },
    };
    // Nobody signed in: Claude Code ends with code 1 and still writes the JSON; the JSON counts.
    let account = run(&["auth", "status"]).map(|(_, text)| read_account(&text)).unwrap_or_else(unknown);
    StatusInfo { dispatch, claude, account }
}

/// Runs `claude` with the given arguments, in `dir`, without a window and without input.
fn run_claude(dir: Option<&Path>, args: &[&str]) -> Run {
    let mut command = claude_command();
    command.args(args).stdin(Stdio::null()).stderr(Stdio::null()).no_window();
    // The user folder: no setting of a project changes the answer.
    if let Some(dir) = dir {
        command.current_dir(dir);
    }
    let output = command.output().ok()?;
    Some((output.status.code().unwrap_or(-1), String::from_utf8_lossy(&output.stdout).into_owned()))
}

/// The values of the bar. It never fails: a problem is a state in the reply.
pub fn status_info(core: &Core) -> StatusInfo {
    let home = core.home_dir().ok();
    status_from(|args| run_claude(home.as_deref(), args), core.version())
}

/// The reply of the `usage_info` command: only the weekly lines of `/usage`.
#[derive(Serialize, Debug, PartialEq)]
pub struct UsageInfo {
    /// `found` (at least one weekly line), `none` (an answer without a weekly line) or `unknown`.
    state: &'static str,
    weeks: Vec<Week>,
}

#[derive(Serialize, Debug, PartialEq)]
struct Week {
    /// The name in the brackets, as Claude Code writes it: "all models", "Fable".
    name: String,
    /// The percent used.
    percent: f64,
    /// The text after "resets", for example "Jan 1, 9:00am (Europe/Example)".
    resets: Option<String>,
}

/// The longest name and reset text that the bar takes.
const USAGE_TEXT_MAX: usize = 80;

fn usage_unknown() -> UsageInfo {
    UsageInfo { state: "unknown", weeks: Vec::new() }
}

/// A short text without control characters, or nothing.
fn plain_text(text: &str) -> Option<String> {
    let text = text.trim();
    (!text.is_empty() && text.len() <= USAGE_TEXT_MAX && !text.chars().any(char::is_control)).then(|| text.to_string())
}

/// One line of the form "Current week (all models): 41% used · resets Jan 1, 9:00am (Europe/Example)"
/// (Claude Code 2.1.322). Any other line gives nothing.
fn read_week(line: &str) -> Option<Week> {
    let rest = line.trim().strip_prefix("Current week (")?;
    let (name, rest) = rest.split_once("): ")?;
    let (percent, rest) = rest.split_once("% used")?;
    let percent = percent.trim().parse::<f64>().ok().filter(|percent| percent.is_finite() && *percent >= 0.0)?;
    let resets = rest.split_once("resets ").and_then(|(_, resets)| plain_text(resets));
    Some(Week { name: plain_text(name)?, percent, resets })
}

/// What `read_usage` found: the reply, and whether the answer came from a request to the model.
struct UsageRead {
    info: UsageInfo,
    model_asked: bool,
}

/// The weekly lines from the answer of `claude -p /usage --output-format json`. An answer with a
/// turn of the model was no command: then the usage is not known.
fn read_usage(text: &str) -> UsageRead {
    let unknown = |model_asked| UsageRead { info: usage_unknown(), model_asked };
    let Ok(reply) = serde_json::from_str::<Value>(text.trim()) else {
        return unknown(false);
    };
    if reply.get("num_turns").and_then(Value::as_u64).unwrap_or(0) > 0 {
        return unknown(true);
    }
    if reply.get("is_error").and_then(Value::as_bool) == Some(true) {
        return unknown(false);
    }
    let Some(result) = reply.get("result").and_then(Value::as_str) else {
        return unknown(false);
    };
    let weeks: Vec<Week> = result.lines().filter_map(read_week).collect();
    let state = if weeks.is_empty() { "none" } else { "found" };
    UsageRead { info: UsageInfo { state, weeks }, model_asked: false }
}

/// The arguments of the read: `/usage` as a command in print mode, without a saved chat, without MCP
/// servers, without hooks (the settings file), and with the smallest model, in case Claude Code ever
/// sends the word to the model instead.
fn usage_args(settings: &str) -> [&str; 10] {
    ["-p", "/usage", "--no-session-persistence", "--strict-mcp-config", "--model", "haiku", "--output-format", "json", "--settings", settings]
}

/// The reply of `usage_info` from a runner of `claude`. After an answer of the model, `model_asked`
/// stays set and the runner is not asked again, so a broken command does not cost usage every time.
fn usage_from(run: impl Fn(&[&str]) -> Run, settings: &str, model_asked: &AtomicBool) -> UsageInfo {
    if model_asked.load(Ordering::Relaxed) {
        return usage_unknown();
    }
    let Some((_, text)) = run(&usage_args(settings)) else {
        return usage_unknown();
    };
    let read = read_usage(&text);
    if read.model_asked {
        model_asked.store(true, Ordering::Relaxed);
    }
    read.info
}

/// Set when `/usage` came back as an answer of the model. Until the next start of Dispatch, the
/// bar then reads the usage no more.
static USAGE_MODEL_ASKED: AtomicBool = AtomicBool::new(false);

/// The weekly usage of the bar. It never fails: a problem is a state in the reply.
pub fn usage_info(core: &Core) -> UsageInfo {
    let home = core.home_dir().ok();
    // A settings file that turns the hooks off, as `context_usage` does. It holds no value.
    let settings = std::env::temp_dir().join("dispatch-usage-settings.json");
    if std::fs::write(&settings, "{\"disableAllHooks\":true}").is_err() {
        return usage_unknown();
    }
    usage_from(|args| run_claude(home.as_deref(), args), &settings.to_string_lossy(), &USAGE_MODEL_ASKED)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A made-up address; no real one stands in a test.
    const EMAIL: &str = "tester@example.com";

    #[test]
    fn the_version_of_claude_code_from_its_answer() {
        assert_eq!(read_version("2.1.322 (Claude Code)\n").as_deref(), Some("2.1.322"));
        assert_eq!(read_version("\r\n  2.2.0-beta.1 (Claude Code)\r\n").as_deref(), Some("2.2.0-beta.1"));
        assert_eq!(read_version(""), None);
        assert_eq!(read_version("'claude' is not recognized as an internal or external command,\r\n"), None);
        assert_eq!(read_version("v2/1 (Claude Code)"), None);
    }

    #[test]
    fn the_account_keeps_only_the_email() {
        // The form of the answer of `claude auth status` (Claude Code 2.1.322), with made-up values.
        let text = format!(
            "{{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\",\"email\":\"{EMAIL}\",\"orgId\":\"org-made-up\",\"orgName\":\"Made-up Org\",\"subscriptionType\":\"max\",\"loginExpiresAt\":\"2099-01-01T00:00:00Z\"}}\n"
        );
        let account = read_account(&text);
        assert_eq!(account, Account { state: "signed-in", email: Some(EMAIL.to_string()) });
        // The reply to the window has exactly these names, and nothing else of the answer.
        let reply = serde_json::to_value(StatusInfo {
            dispatch: "1.2.3".into(),
            claude: ClaudeInfo { state: "found", version: Some("9.9.9".into()) },
            account,
        })
        .unwrap();
        assert_eq!(
            reply,
            serde_json::json!({ "dispatch": "1.2.3", "claude": { "state": "found", "version": "9.9.9" }, "account": { "state": "signed-in", "email": EMAIL } })
        );
        let written = reply.to_string();
        for other in ["org-made-up", "Made-up Org", "max", "authMethod", "2099"] {
            assert!(!written.contains(other), "{other} must not reach the window");
        }
    }

    #[test]
    fn signed_out_without_email_and_unreadable() {
        assert_eq!(read_account("{\"loggedIn\":false}"), Account { state: "signed-out", email: None });
        assert_eq!(read_account("{\"loggedIn\":true,\"authMethod\":\"api_key\"}"), Account { state: "no-email", email: None });
        assert_eq!(read_account("{\"loggedIn\":true,\"email\":\"no address\"}"), Account { state: "no-email", email: None });
        assert_eq!(read_account("{\"loggedIn\":true,\"email\":\"a@b\\u0007c\"}"), Account { state: "no-email", email: None });
        let long = format!("{{\"loggedIn\":true,\"email\":\"{}@example.com\"}}", "a".repeat(250));
        assert_eq!(read_account(&long).state, "no-email");
        assert_eq!(read_account("Not logged in. Run claude /login"), Account { state: "unknown", email: None });
        assert_eq!(read_account("{\"email\":\"x@y\"}"), Account { state: "unknown", email: None });
    }

    /// The form of the answer of `claude -p /usage --output-format json` (Claude Code 2.1.322),
    /// with made-up numbers and made-up other fields.
    fn usage_answer(result: &str, turns: u64) -> String {
        serde_json::json!({ "type": "result", "subtype": "success", "is_error": false, "num_turns": turns, "session_id": "sess-made-up", "total_cost_usd": 0.123, "result": result }).to_string()
    }

    const USAGE_TEXT: &str = "You are currently using your subscription to power your Claude Code usage\n\nCurrent session: 55% used · resets 3pm (Europe/Example)\nCurrent week (all models): 41% used · resets Jan 1, 9:00am (Europe/Example)\nCurrent week (Fable): 7% used · resets Jan 2, 10:00am (Europe/Example)\n\nWhat's contributing to your usage?\nLast 24h · 99 requests · 3 sessions\n  12%  Start fresh when you switch tasks · run /clear\n";

    #[test]
    fn the_weekly_lines_of_usage() {
        let read = read_usage(&usage_answer(USAGE_TEXT, 0));
        assert!(!read.model_asked);
        assert_eq!(
            read.info,
            UsageInfo {
                state: "found",
                weeks: vec![
                    Week { name: "all models".into(), percent: 41.0, resets: Some("Jan 1, 9:00am (Europe/Example)".into()) },
                    Week { name: "Fable".into(), percent: 7.0, resets: Some("Jan 2, 10:00am (Europe/Example)".into()) },
                ],
            }
        );
        // A line without a reset text, and broken lines.
        assert_eq!(read_week("Current week (Fable): 7.5% used"), Some(Week { name: "Fable".into(), percent: 7.5, resets: None }));
        assert_eq!(read_week("Current week (Fable): many% used"), None);
        assert_eq!(read_week("Current week (\u{7}): 7% used"), None);
    }

    #[test]
    fn usage_without_a_weekly_line_unreadable_or_from_the_model() {
        assert_eq!(read_usage(&usage_answer("You are using an API key.\n", 0)).info, UsageInfo { state: "none", weeks: Vec::new() });
        assert_eq!(read_usage("Not logged in").info, usage_unknown());
        assert_eq!(read_usage("{\"is_error\":true,\"num_turns\":0,\"result\":\"Current week (all models): 41% used\"}").info, usage_unknown());
        let model = read_usage(&usage_answer("Current week (all models): 41% used", 1));
        assert!(model.model_asked);
        assert_eq!(model.info, usage_unknown());
    }

    #[test]
    fn the_usage_comes_from_its_source() {
        let calls = RefCell::new(Vec::new());
        let asked = AtomicBool::new(false);
        let runner = |args: &[&str]| -> Run {
            calls.borrow_mut().push(args.join(" "));
            Some((0, usage_answer(USAGE_TEXT, 0)))
        };
        let usage = usage_from(runner, "s.json", &asked);
        assert_eq!(*calls.borrow(), vec!["-p /usage --no-session-persistence --strict-mcp-config --model haiku --output-format json --settings s.json"]);
        assert_eq!(usage.state, "found");
        assert_eq!(usage.weeks.iter().map(|week| (week.name.as_str(), week.percent)).collect::<Vec<_>>(), vec![("all models", 41.0), ("Fable", 7.0)]);
        // `claude` does not start.
        assert_eq!(usage_from(|_: &[&str]| None, "s.json", &asked), usage_unknown());
        // An answer of the model: unknown, and the runner is not asked again.
        let count = RefCell::new(0);
        let model = |_: &[&str]| -> Run {
            *count.borrow_mut() += 1;
            Some((0, usage_answer("Here is what I found.", 1)))
        };
        assert_eq!(usage_from(&model, "s.json", &asked), usage_unknown());
        assert_eq!(usage_from(&model, "s.json", &asked), usage_unknown());
        assert_eq!(*count.borrow(), 1);
        assert!(asked.load(Ordering::Relaxed));
    }

    #[test]
    fn the_usage_reply_has_only_the_weekly_lines() {
        let reply = serde_json::to_value(read_usage(&usage_answer(USAGE_TEXT, 0)).info).unwrap();
        assert_eq!(
            reply,
            serde_json::json!({ "state": "found", "weeks": [
                { "name": "all models", "percent": 41.0, "resets": "Jan 1, 9:00am (Europe/Example)" },
                { "name": "Fable", "percent": 7.0, "resets": "Jan 2, 10:00am (Europe/Example)" }
            ] })
        );
        let written = reply.to_string();
        for other in ["sess-made-up", "0.123", "Current session", "55", "3pm", "requests", "/clear"] {
            assert!(!written.contains(other), "{other} must not reach the window");
        }
    }

    #[test]
    fn the_three_values_come_from_their_sources() {
        let calls = RefCell::new(Vec::new());
        let runner = |args: &[&str]| -> Run {
            calls.borrow_mut().push(args.join(" "));
            match args {
                ["--version"] => Some((0, "9.9.9 (Claude Code)\n".into())),
                ["auth", "status"] => Some((0, format!("{{\"loggedIn\":true,\"email\":\"{EMAIL}\",\"orgName\":\"x\"}}"))),
                _ => None,
            }
        };
        let status = status_from(runner, "1.2.3".into());
        assert_eq!(*calls.borrow(), vec!["--version", "auth status"]);
        assert_eq!(status.dispatch, "1.2.3");
        assert_eq!(status.claude, ClaudeInfo { state: "found", version: Some("9.9.9".into()) });
        assert_eq!(status.account, Account { state: "signed-in", email: Some(EMAIL.into()) });
        // Signed out: code 1 with JSON.
        let out = status_from(|args: &[&str]| if args == ["--version"] { Some((0, "9.9.9\n".into())) } else { Some((1, "{\"loggedIn\":false}".into())) }, "1.2.3".into());
        assert_eq!(out.account.state, "signed-out");
        // `claude` does not start, or `cmd` does not find it: not found, no login read, the version of Dispatch stays.
        for gone in [None, Some((1, String::new()))] {
            let calls = RefCell::new(0);
            let status = status_from(
                |_: &[&str]| {
                    *calls.borrow_mut() += 1;
                    gone.clone()
                },
                "1.2.3".into(),
            );
            assert_eq!(*calls.borrow(), 1);
            assert_eq!(status.claude, ClaudeInfo { state: "missing", version: None });
            assert_eq!(status.account, Account { state: "unknown", email: None });
            assert_eq!(status.dispatch, "1.2.3");
        }
    }
}
