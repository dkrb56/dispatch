//! The token window (ticket token-usage): the tokens of a project per hour, consumer, run kind and
//! model from the transcripts that the task card reads, the events of the project for the line of
//! the weekly allowance, and the history of the weekly percent of `/usage` with its trend.
//!
//! The report reads the transcripts through the cache of `flow.rs`, so a second open reads only what
//! grew. It runs only when the window asks; the 5 s task poll does not call it.
//!
//! Privacy: the history file `usage-history.jsonl` of the data folder holds per reading only the
//! time, the weekly percent of all models and the reset text of `/usage`. It stays on this computer.

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::flow::{modified_millis, session_replies};
use crate::core::pipeline::{claude_projects_dir, files_with, read_session_runs, Project};
use crate::core::Core;

const HOUR_MS: u64 = 3_600_000;
/// The history takes a new reading when its newest one is older than this (user decision 4).
const READING_EVERY_MS: u64 = 55 * 60_000;
/// The history drops readings older than this.
const HISTORY_KEEP_MS: u64 = 35 * 24 * HOUR_MS;
/// The window of the trend: the pace of the last 24 hours before the newest reading (user decision 3).
const TREND_MS: u64 = 24 * HOUR_MS;
/// The history file in the data folder of the program.
const HISTORY_FILE: &str = "usage-history.jsonl";

/// The tokens of one hour, one consumer, one run kind and one model.
#[derive(Serialize, Debug, PartialEq, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenRow {
    /// The start of the UTC hour, in milliseconds since the Unix epoch.
    hour: u64,
    /// The ticket id of a task, or the session id of a chat.
    consumer: String,
    /// `work`, `plan`, `agent` (an agent of a run) or `triage` (a chat and its agents, user decision 5).
    kind: &'static str,
    model: String,
    input: u64,
    cache_write: u64,
    cache_read: u64,
    output: u64,
}

/// A task or a chat of the project that used tokens in the range.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Consumer {
    /// The ticket id of a task, or the session id of a chat.
    id: String,
    /// `task` or `chat`.
    kind: &'static str,
    /// The runs of a task in its session file; 0 for a chat.
    runs: usize,
    /// The creation time of the transcript of a chat, in milliseconds; none for a task.
    created: Option<u64>,
}

/// An event of the project for the line of the weekly allowance.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TokenEvent {
    /// The time in milliseconds since the Unix epoch, when the source gives one.
    time: Option<u64>,
    /// A local time `YYYY-MM-DD HH:MM` without a zone, when the source gives only that: the
    /// stamp of the section User decisions comes from the clock of the window. The page reads it.
    local: Option<String>,
    /// `release`, `approved`, `night-on` or `night-off`.
    kind: &'static str,
    text: String,
}

/// The reply of `token_report`.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TokenReport {
    root: String,
    rows: Vec<TokenRow>,
    consumers: Vec<Consumer>,
    events: Vec<TokenEvent>,
}

/// Days since 1970-01-01 of a civil date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// A time `YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)` in milliseconds since the Unix epoch, or none.
pub(crate) fn parse_time(text: &str) -> Option<u64> {
    let text = text.trim();
    let num = |part: &str| part.parse::<i64>().ok();
    let (date, rest) = text.split_once('T')?;
    let mut date_parts = date.split('-');
    let (year, month, day) = (num(date_parts.next()?)?, num(date_parts.next()?)?, num(date_parts.next()?)?);
    let zone_at = rest.find(|c| c == 'Z' || c == 'z' || c == '+' || c == '-')?;
    let (clock, zone) = rest.split_at(zone_at);
    let mut clock_parts = clock.split(':');
    let (hour, minute) = (num(clock_parts.next()?)?, num(clock_parts.next()?)?);
    let seconds = clock_parts.next().unwrap_or("0");
    let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    let second = num(whole)?;
    let millis = format!("{fraction:0<3}").get(..3).and_then(num).unwrap_or(0);
    let offset = match zone {
        "Z" | "z" => 0,
        _ => {
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            let (h, m) = zone[1..].split_once(':').unwrap_or((&zone[1..], "0"));
            sign * (num(h)? * 60 + num(m)?)
        }
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let total = ((days_from_civil(year, month, day) * 24 + hour) * 60 + minute - offset) * 60_000 + second * 1000 + millis;
    u64::try_from(total).ok()
}

/// The folder name that Claude Code makes from a start folder: each character that is no letter or
/// digit becomes `-` (the rule of `chats::is_project_of`).
fn folder_name(root: &Path) -> String {
    root.to_string_lossy().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

/// The sums of the report while it grows: (hour, consumer, kind, model) to the four counts.
type Sums = BTreeMap<(u64, String, &'static str, String), [u64; 4]>;

/// Adds the replies of one session in the range to the sums; a reply counts once over the project.
fn add_session(projects: &Path, session: &str, since: u64, consumer: &str, kind_of: impl Fn(bool) -> &'static str, seen: &mut HashSet<String>, sums: &mut Sums) -> bool {
    let mut any = false;
    for (reply, agent) in session_replies(projects, session, since) {
        let Some(time) = reply.time.as_deref().and_then(parse_time) else { continue };
        if time < since || !seen.insert(reply.id.clone()) {
            continue;
        }
        any = true;
        let model = reply.model.unwrap_or_else(|| "unknown".to_string());
        let sum = sums.entry((time / HOUR_MS * HOUR_MS, consumer.to_string(), kind_of(agent), model)).or_default();
        sum[0] += reply.input;
        sum[1] += reply.cache_write;
        sum[2] += reply.cache_read;
        sum[3] += reply.output;
    }
    any
}

/// The tokens of a project since `since` from the transcripts in `projects` (see `token_report`).
fn report_in(project: &Project, projects: &Path, since: u64) -> TokenReport {
    let mut seen: HashSet<String> = HashSet::new();
    let mut sums = Sums::new();
    let mut consumers = Vec::new();
    let mut known: HashSet<String> = HashSet::new();
    let mut tasks = files_with(&project.reports, "session");
    tasks.sort_by(|a, b| a.0.cmp(&b.0));
    // The sessions of all tasks first: a chat is a session that stands in no session file.
    let task_runs: Vec<(String, Vec<(String, String)>)> = tasks.into_iter().map(|(name, path, _)| (name, read_session_runs(&path))).collect();
    for (_, runs) in &task_runs {
        known.extend(runs.iter().map(|(_, id)| id.clone()));
    }
    for (name, runs) in &task_runs {
        let mut any = false;
        for (run, session) in runs {
            let run_kind: &'static str = if run == "plan" { "plan" } else { "work" };
            any |= add_session(projects, session, since, name, |agent| if agent { "agent" } else { run_kind }, &mut seen, &mut sums);
        }
        if any {
            consumers.push(Consumer { id: name.clone(), kind: "task", runs: runs.len(), created: None });
        }
    }
    // The chats of the project folder (user decision 1); their agents count as triage (user decision 5).
    let folder = folder_name(&project.root);
    let mut chats: Vec<(String, Option<u64>)> = Vec::new();
    for dir in fs::read_dir(projects).into_iter().flatten().flatten() {
        if !dir.file_name().to_string_lossy().eq_ignore_ascii_case(&folder) {
            continue;
        }
        for file in fs::read_dir(dir.path()).into_iter().flatten().flatten() {
            let path = file.path();
            if path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|stem| stem.to_str()).map(str::to_string) else { continue };
            if known.contains(&id) || chats.iter().any(|(known, _)| known == &id) || modified_millis(&path).is_some_and(|modified| modified < since) {
                continue;
            }
            let created = fs::metadata(&path).and_then(|meta| meta.created()).ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|time| time.as_millis() as u64);
            chats.push((id, created));
        }
    }
    chats.sort();
    for (id, created) in chats {
        if add_session(projects, &id, since, &id, |_| "triage", &mut seen, &mut sums) {
            consumers.push(Consumer { id, kind: "chat", runs: 0, created });
        }
    }
    let rows = sums
        .into_iter()
        .map(|((hour, consumer, kind, model), [input, cache_write, cache_read, output])| TokenRow { hour, consumer, kind, model, input, cache_write, cache_read, output })
        .collect();
    TokenReport { root: project.root.to_string_lossy().into_owned(), rows, consumers, events: events_of(project) }
}

/// The stamp of the section User decisions of a plan: `YYYY-MM-DD HH:MM`, local time of the window
/// (user decision 2). A plan without the section or without a stamp of that form gives none.
fn approval_stamp(plan: &str) -> Option<String> {
    let mut in_section = false;
    for line in plan.lines() {
        let line = line.trim();
        if let Some(heading) = line.strip_prefix("## ") {
            in_section = heading.trim().eq_ignore_ascii_case("User decisions");
            continue;
        }
        if !in_section {
            continue;
        }
        let Some((_, rest)) = line.split_once("took these decisions in Dispatch on ") else { continue };
        let stamp = rest.split(". ").next().unwrap_or(rest).trim_end_matches('.').trim();
        let bytes = stamp.as_bytes();
        let form = stamp.len() == 16
            && bytes.iter().enumerate().all(|(at, byte)| match at {
                4 | 7 => *byte == b'-',
                10 => *byte == b' ',
                13 => *byte == b':',
                _ => byte.is_ascii_digit(),
            });
        return form.then(|| stamp.to_string());
    }
    None
}

/// A release tag: `v<n>.<n>.<n>`.
fn is_release(tag: &str) -> bool {
    let Some(version) = tag.strip_prefix('v') else { return false };
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
}

/// The events of a project: the release tags of git, the approvals of the plans, and night mode
/// on and off from the files of the `nightmode` skill.
fn events_of(project: &Project) -> Vec<TokenEvent> {
    let mut events = Vec::new();
    let tags = crate::core::info::git(&project.root, &["for-each-ref", "--format=%(refname:short) %(creatordate:unix)", "refs/tags"]).unwrap_or_default();
    for line in tags.lines() {
        let Some((tag, time)) = line.trim().split_once(' ') else { continue };
        let Ok(seconds) = time.trim().parse::<u64>() else { continue };
        if is_release(tag) {
            events.push(TokenEvent { time: Some(seconds * 1000), local: None, kind: "release", text: format!("release {}", &tag[1..]) });
        }
    }
    let mut plans = files_with(&project.plans(), "md");
    plans.sort_by(|a, b| a.0.cmp(&b.0));
    for (name, path, _) in plans {
        if let Some(stamp) = fs::read_to_string(&path).ok().as_deref().and_then(approval_stamp) {
            events.push(TokenEvent { time: None, local: Some(stamp), kind: "approved", text: format!("plan approved: {name}") });
        }
    }
    let night = project.root.join(".claude").join("state").join("night");
    if let Some(state) = fs::read(night.join("night-mode.json")).ok().and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok()) {
        let time = |key: &str| state.get(key).and_then(serde_json::Value::as_str).and_then(parse_time);
        if let Some(since) = time("since") {
            events.push(TokenEvent { time: Some(since), local: None, kind: "night-on", text: "night mode on".to_string() });
        }
        if let Some(ended) = time("ended") {
            events.push(TokenEvent { time: Some(ended), local: None, kind: "night-off", text: "night mode off".to_string() });
        }
    }
    // An earlier night ended with its morning list.
    let ended = events.iter().filter(|event| event.kind == "night-off").filter_map(|event| event.time).collect::<Vec<_>>();
    let mut mornings: Vec<u64> = fs::read_dir(&night)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            name.starts_with("morning-") && name.ends_with(".md")
        })
        .filter_map(|entry| modified_millis(&entry.path()))
        .filter(|time| !ended.iter().any(|end| end.abs_diff(*time) < HOUR_MS))
        .collect();
    mornings.sort();
    for time in mornings {
        events.push(TokenEvent { time: Some(time), local: None, kind: "night-off", text: "night mode off (morning list)".to_string() });
    }
    events
}

/// The tokens of the project of `cwd` since `since` (milliseconds since the Unix epoch): one row
/// per UTC hour, consumer, kind and model, each reply once over all runs and chats of the project,
/// under the first run that has it; the consumers; the events. A reply without a time is left out.
pub fn token_report(cwd: String, since: u64) -> Result<TokenReport, String> {
    let project = Project::find(&cwd)?;
    let Some(projects) = claude_projects_dir() else {
        return Ok(TokenReport { root: project.root.to_string_lossy().into_owned(), events: events_of(&project), ..TokenReport::default() });
    };
    Ok(report_in(&project, &projects, since))
}

/// One reading of the weekly allowance, one line of the history file.
#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    /// Milliseconds since the Unix epoch.
    at: u64,
    /// The weekly percent of all models.
    percent: f64,
    /// The reset text of `/usage`, for example "Jan 1, 9:00am (Europe/Example)".
    resets: Option<String>,
}

/// The trend of the history: the pace of the window of the trend and when it reaches 100 percent.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Trend {
    /// The reading the pace starts from.
    from: u64,
    /// Percent per hour.
    pace: f64,
    /// When the pace reaches 100 percent; none for a pace of zero or less.
    runs_out: Option<u64>,
}

/// The reply of `usage_history`: the readings of the week (since the last reset), and the trend.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct UsageHistory {
    points: Vec<Reading>,
    trend: Option<Trend>,
}

fn read_history(path: &Path) -> Vec<Reading> {
    let mut list: Vec<Reading> = fs::read_to_string(path).unwrap_or_default().lines().filter_map(|line| serde_json::from_str(line).ok()).collect();
    list.sort_by_key(|reading| reading.at);
    list
}

/// Adds a reading to the history of the folder `dir` when the newest reading is older than
/// `READING_EVERY_MS` or there is none, and drops the readings older than `HISTORY_KEEP_MS`.
/// Gives whether it wrote.
fn record_in(dir: &Path, now: u64, percent: f64, resets: Option<&str>) -> Result<bool, String> {
    let path = dir.join(HISTORY_FILE);
    let list = read_history(&path);
    if list.last().is_some_and(|last| now.saturating_sub(last.at) < READING_EVERY_MS) {
        return Ok(false);
    }
    let reading = Reading { at: now, percent, resets: resets.map(str::to_string) };
    let keep = |reading: &Reading| now.saturating_sub(reading.at) <= HISTORY_KEEP_MS;
    if list.iter().all(keep) {
        let mut file = fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
        writeln!(file, "{}", serde_json::to_string(&reading).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    } else {
        let text: String = list.into_iter().filter(keep).chain([reading]).filter_map(|reading| serde_json::to_string(&reading).ok()).map(|line| line + "\n").collect();
        fs::write(&path, text).map_err(|e| e.to_string())?;
    }
    Ok(true)
}

/// The readings since the last reset (the last drop of the percent) and the trend over the window
/// of the trend before the newest reading. Fewer than two readings give no trend.
fn history_of(list: Vec<Reading>) -> UsageHistory {
    let start = (1..list.len()).rev().find(|&at| list[at].percent < list[at - 1].percent).unwrap_or(0);
    let points: Vec<Reading> = list[start..].to_vec();
    let trend = match (points.first(), points.last()) {
        (Some(_), Some(last)) if points.len() >= 2 => {
            let from = points.iter().rev().find(|reading| reading.at + TREND_MS <= last.at).unwrap_or(&points[0]);
            let hours = (last.at - from.at) as f64 / HOUR_MS as f64;
            (hours > 0.0).then(|| {
                let pace = (last.percent - from.percent) / hours;
                let runs_out = if last.percent >= 100.0 {
                    Some(last.at)
                } else if pace > 0.0 {
                    Some(last.at + ((100.0 - last.percent) / pace * HOUR_MS as f64).round() as u64)
                } else {
                    None
                };
                Trend { from: from.at, pace, runs_out }
            })
        }
        _ => None,
    };
    UsageHistory { points, trend }
}

/// The history folder: the data folder of the program.
fn history_dir(core: &Core) -> Option<PathBuf> {
    core.data_dir().ok()
}

/// Puts a reading of the weekly percent of all models into the history (user decision 4: the read
/// of the bottom bar every 5 minutes gives one reading per hour). It writes nothing without a data
/// folder; a failed write is logged without a value.
pub(crate) fn record_reading(core: &Core, percent: f64, resets: Option<&str>) {
    let Some(dir) = history_dir(core) else { return };
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64);
    if record_in(&dir, now, percent, resets).is_err() {
        eprintln!("the usage history could not be written");
    }
}

/// The history of the weekly allowance of this computer, with its trend.
pub fn usage_history(core: &Core) -> UsageHistory {
    history_dir(core).map(|dir| history_of(read_history(&dir.join(HISTORY_FILE)))).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("dispatch-token-usage-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn reply(id: &str, time: &str, model: &str, counts: [u64; 4], sidechain: bool) -> String {
        format!(
            r#"{{"type":"assistant","isSidechain":{sidechain},"timestamp":"{time}","message":{{"id":"{id}","model":"{model}","content":[{{"type":"text","text":"x"}}],"usage":{{"input_tokens":{},"cache_creation_input_tokens":{},"cache_read_input_tokens":{},"output_tokens":{}}}}}}}"#,
            counts[0], counts[1], counts[2], counts[3]
        )
    }

    /// A scratch project folder with a task folder, and a scratch transcript folder named after it.
    fn project_and_transcripts(name: &str) -> (Project, PathBuf, PathBuf) {
        let base = scratch(name);
        let root = base.join("proj");
        fs::create_dir_all(root.join(".dispatch").join("plans")).unwrap();
        let project = Project::find(&root.to_string_lossy()).unwrap();
        let projects = base.join("projects");
        let folder = projects.join(folder_name(&project.root));
        fs::create_dir_all(&folder).unwrap();
        (project, projects, folder)
    }

    const H10: &str = "2026-11-14T10:15:00Z";
    const H11: &str = "2026-11-14T11:40:00.500Z";

    #[test]
    fn the_times_of_the_transcripts() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("2026-11-14T10:15:00Z"), Some(1_794_651_300_000));
        assert_eq!(parse_time("2026-11-14T11:15:00.250+01:00"), Some(1_794_651_300_250));
        assert_eq!(parse_time("2026-11-14T10:15:00.2Z"), Some(1_794_651_300_200));
        assert_eq!(parse_time("t"), None);
        assert_eq!(parse_time("2026-13-14T10:15:00Z"), None);
    }

    #[test]
    fn tokens_per_hour_from_two_transcripts_and_a_triage_chat() {
        let (project, projects, folder) = project_and_transcripts("hours");
        let (plan, work, chat) = ("aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003");
        fs::write(project.reports.join("t-1.session"), format!("plan {plan}\nwork {work}\n")).unwrap();
        let p1 = reply("msg_p1", H10, "claude-fable-5-1", [1, 10, 100, 5], false);
        // The work run is a copy of the plan session: it repeats msg_p1, which counts under the plan.
        let w1 = reply("msg_w1", H11, "claude-opus-5-5", [2, 20, 200, 6], false);
        let side = reply("msg_s1", H11, "claude-haiku-5-5", [3, 30, 300, 7], true);
        fs::write(folder.join(format!("{plan}.jsonl")), format!("{p1}\n")).unwrap();
        fs::write(folder.join(format!("{work}.jsonl")), format!("{p1}\n{w1}\n{w1}\n{side}\n")).unwrap();
        let agents = folder.join(work).join("subagents");
        fs::create_dir_all(&agents).unwrap();
        let a1 = reply("msg_a1", H11, "claude-haiku-5-5", [4, 40, 400, 8], false);
        // The agent file repeats the sidechain line of the session: it counts once.
        fs::write(agents.join("agent-x.jsonl"), format!("{a1}\n{side}\n")).unwrap();
        // The triage chat of the project folder, with an agent and a reply without a time.
        let c1 = reply("msg_c1", H10, "claude-fable-5-1", [5, 50, 500, 9], false);
        let untimed = r#"{"type":"assistant","message":{"id":"msg_c0","model":"m","content":[],"usage":{"input_tokens":1}}}"#;
        fs::write(folder.join(format!("{chat}.jsonl")), format!("{c1}\n{untimed}\n")).unwrap();
        fs::create_dir_all(folder.join(chat).join("subagents")).unwrap();
        let ca = reply("msg_ca", H11, "claude-haiku-5-5", [6, 60, 600, 10], false);
        fs::write(folder.join(chat).join("subagents").join("agent-y.jsonl"), format!("{ca}\n")).unwrap();

        let report = report_in(&project, &projects, 0);
        let h10 = parse_time(H10).unwrap() / HOUR_MS * HOUR_MS;
        let h11 = h10 + HOUR_MS;
        let row = |hour, consumer: &str, kind, model: &str, counts: [u64; 4]| TokenRow {
            hour,
            consumer: consumer.to_string(),
            kind,
            model: model.to_string(),
            input: counts[0],
            cache_write: counts[1],
            cache_read: counts[2],
            output: counts[3],
        };
        let mut expected = vec![
            row(h10, "t-1", "plan", "claude-fable-5-1", [1, 10, 100, 5]),
            row(h11, "t-1", "work", "claude-opus-5-5", [2, 20, 200, 6]),
            row(h11, "t-1", "agent", "claude-haiku-5-5", [7, 70, 700, 15]),
            row(h10, chat, "triage", "claude-fable-5-1", [5, 50, 500, 9]),
            row(h11, chat, "triage", "claude-haiku-5-5", [6, 60, 600, 10]),
        ];
        let key = |row: &TokenRow| (row.hour, row.consumer.clone(), row.kind, row.model.clone());
        expected.sort_by_key(key);
        let mut rows = report.rows.clone();
        rows.sort_by_key(key);
        assert_eq!(rows, expected);
        assert_eq!(report.consumers.iter().map(|c| (c.id.as_str(), c.kind, c.runs)).collect::<Vec<_>>(), [("t-1", "task", 2), (chat, "chat", 0)]);
        assert!(report.consumers[1].created.is_some());
        // A start after the replies leaves them out.
        let later = report_in(&project, &projects, h11 + HOUR_MS);
        assert!(later.rows.is_empty() && later.consumers.is_empty());
        let from_eleven = report_in(&project, &projects, h11);
        assert!(from_eleven.rows.iter().all(|row| row.hour == h11));
        fs::remove_dir_all(projects.parent().unwrap()).unwrap();
    }

    #[test]
    fn each_message_counts_once_over_the_runs_of_a_project() {
        let (project, projects, folder) = project_and_transcripts("once");
        let (one, two) = ("bbbbbbbb-0000-4000-8000-000000000001", "bbbbbbbb-0000-4000-8000-000000000002");
        // Two tasks name a session each; the second session repeats the reply of the first.
        fs::write(project.reports.join("t-a.session"), format!("work {one}\n")).unwrap();
        fs::write(project.reports.join("t-b.session"), format!("plan {two}\n")).unwrap();
        let shared = reply("msg_x", H10, "claude-opus-5-5", [1, 2, 3, 4], false);
        let own = reply("msg_y", H10, "claude-opus-5-5", [10, 20, 30, 40], false);
        fs::write(folder.join(format!("{one}.jsonl")), format!("{shared}\n{shared}\n")).unwrap();
        fs::write(folder.join(format!("{two}.jsonl")), format!("{shared}\n{own}\n")).unwrap();
        let report = report_in(&project, &projects, 0);
        let total: u64 = report.rows.iter().map(|row| row.input + row.cache_write + row.cache_read + row.output).sum();
        assert_eq!(total, 10 + 100);
        let of = |name: &str| report.rows.iter().filter(|row| row.consumer == name).map(|row| row.output).sum::<u64>();
        assert_eq!((of("t-a"), of("t-b")), (4, 40));
        // No session of a task is a chat.
        assert!(report.consumers.iter().all(|consumer| consumer.kind == "task"));
        fs::remove_dir_all(projects.parent().unwrap()).unwrap();
    }

    fn reading(hours: f64, percent: f64) -> Reading {
        Reading { at: (hours * HOUR_MS as f64) as u64 + 1_000 * HOUR_MS, percent, resets: Some("Jan 1, 9:00am (Europe/Example)".into()) }
    }

    #[test]
    fn the_trend_and_the_run_out_time_from_a_history() {
        // An old week, the reset (a drop), then five readings of the new week.
        let list = vec![reading(-30.0, 80.0), reading(0.0, 2.0), reading(10.0, 10.0), reading(20.0, 20.0), reading(30.0, 30.0), reading(34.0, 40.0)];
        let history = history_of(list);
        assert_eq!(history.points.len(), 5);
        assert_eq!(history.points[0].percent, 2.0);
        let trend = history.trend.unwrap();
        // The newest reading at 24 h or more before the last one (34 h) is the one at 10 h: 30 % in 24 h.
        assert_eq!(trend.from, reading(10.0, 0.0).at);
        assert!((trend.pace - 1.25).abs() < 1e-9, "{}", trend.pace);
        // 60 % left at 1.25 % per hour: 48 hours after the last reading.
        assert_eq!(trend.runs_out, Some(reading(34.0 + 48.0, 0.0).at));
        // Without a reading 24 h before, the oldest reading of the week is the start.
        let short = history_of(vec![reading(0.0, 10.0), reading(5.0, 20.0)]).trend.unwrap();
        assert_eq!((short.from, short.pace), (reading(0.0, 0.0).at, 2.0));
        // A flat pace never runs out; one reading has no trend; a full allowance ran out at once.
        assert_eq!(history_of(vec![reading(0.0, 10.0), reading(5.0, 10.0)]).trend.unwrap().runs_out, None);
        assert_eq!(history_of(vec![reading(0.0, 10.0)]).trend, None);
        assert_eq!(history_of(vec![reading(0.0, 90.0), reading(5.0, 100.0)]).trend.unwrap().runs_out, Some(reading(5.0, 0.0).at));
        assert_eq!(history_of(Vec::new()), UsageHistory::default());
    }

    #[test]
    fn a_reading_goes_into_the_history_once_per_hour() {
        let dir = scratch("history");
        let at = |minutes: u64| 2_000 * HOUR_MS + minutes * 60_000;
        assert!(record_in(&dir, at(0), 10.0, Some("Jan 1")).unwrap());
        assert!(!record_in(&dir, at(5), 11.0, None).unwrap(), "five minutes later: no reading");
        assert!(!record_in(&dir, at(54), 12.0, None).unwrap());
        assert!(record_in(&dir, at(56), 13.0, None).unwrap());
        let list = read_history(&dir.join(HISTORY_FILE));
        assert_eq!(list.iter().map(|reading| reading.percent).collect::<Vec<_>>(), [10.0, 13.0]);
        assert_eq!(list[0].resets.as_deref(), Some("Jan 1"));
        // 36 days later the old readings go.
        let later = at(56) + 36 * 24 * HOUR_MS;
        assert!(record_in(&dir, later, 1.0, None).unwrap());
        assert_eq!(read_history(&dir.join(HISTORY_FILE)).iter().map(|reading| reading.at).collect::<Vec<_>>(), [later]);
        // A broken line counts as none.
        fs::write(dir.join(HISTORY_FILE), "not json\n").unwrap();
        assert!(read_history(&dir.join(HISTORY_FILE)).is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn the_events_of_a_project_from_its_tags_and_its_night_file() {
        let (project, projects, _) = project_and_transcripts("events");
        let root = &project.root;
        let git = |args: &[&str]| {
            let status = std::process::Command::new("git").arg("-C").arg(root).args(args).env("GIT_COMMITTER_DATE", "2026-11-14T10:00:00Z").env("GIT_AUTHOR_DATE", "2026-11-14T10:00:00Z").output().unwrap();
            assert!(status.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&status.stderr));
        };
        git(&["init", "-q"]);
        git(&["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "start"]);
        git(&["tag", "v1.2.3"]);
        git(&["tag", "not-a-release"]);
        let project = Project::find(&root.to_string_lossy()).unwrap();
        let night = root.join(".claude").join("state").join("night");
        fs::create_dir_all(&night).unwrap();
        fs::write(night.join("night-mode.json"), r#"{ "on": false, "since": "2026-11-13T23:50:50Z", "ended": "2026-11-14T06:36:28Z" }"#).unwrap();
        fs::write(
            project.plans().join("t-1.md"),
            "# t-1\n\n## Decisions\n1. q\n\n## User decisions\n\nThe user took these decisions in Dispatch on 2026-11-14 23:12. Each replaces the Default.\n",
        )
        .unwrap();
        fs::write(project.plans().join("t-2.md"), "# t-2\n\n## Decisions\n1. q\n").unwrap();
        let events = events_of(&project);
        let release = events.iter().find(|event| event.kind == "release").unwrap();
        assert_eq!((release.text.as_str(), release.time), ("release 1.2.3", parse_time("2026-11-14T10:00:00Z")));
        assert_eq!(events.iter().filter(|event| event.kind == "release").count(), 1);
        let approved: Vec<_> = events.iter().filter(|event| event.kind == "approved").collect();
        assert_eq!(approved.len(), 1);
        assert_eq!((approved[0].local.as_deref(), approved[0].text.as_str()), (Some("2026-11-14 23:12"), "plan approved: t-1"));
        assert_eq!(events.iter().find(|event| event.kind == "night-on").unwrap().time, parse_time("2026-11-13T23:50:50Z"));
        assert_eq!(events.iter().find(|event| event.kind == "night-off").unwrap().time, parse_time("2026-11-14T06:36:28Z"));
        assert_eq!(approval_stamp("## User decisions\nThe user took these decisions in Dispatch on soon. x\n"), None);
        fs::remove_dir_all(projects.parent().unwrap()).unwrap();
    }
}
