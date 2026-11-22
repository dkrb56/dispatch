//! The actions of a project (ticket project-actions): the buttons of the Actions panel. An action
//! has a name and one or more steps. A step is a command on the computer of the project in the
//! project folder, or a Claude task: a brief that goes through the pipeline as a ticket (plan run,
//! work run, report) without the triage chat. A click on Run starts the first step; the driver
//! window calls `action_step` when a step ended well, and the chain stops at the first step that
//! fails. Nothing here runs at a start or on a timer.
//!
//! The definitions live in `.dispatch/actions.json`, each run in `.dispatch/actions/<run>.json`.
//! The reads and writes of a run file take the read lock of the task list, so a poll never sees
//! a half-written file.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::err;
use crate::core::info::{git, NoWindow};
use crate::core::pipeline::{self, write_file, Project};
use crate::core::tickets;

/// The most steps of one action.
const MAX_STEPS: usize = 10;
/// The longest name of an action, in characters.
const NAME_MAX: usize = 80;
/// The output tail of a command step: this many lines, each cut to `LINE_CHARS` characters.
const OUTPUT_LINES: usize = 200;
const LINE_CHARS: usize = 400;
/// The time limit of a command step without its own, in seconds.
const DEFAULT_LIMIT: u64 = 3600;
/// The runs of an action that the panel gets, newest first.
const RUNS_SHOWN: usize = 10;
/// The most commits that `{commits}` gives; a line names the rest.
const COMMITS_MAX: usize = 200;
/// The note of a command step whose process ended with Dispatch.
const ORPHAN_NOTE: &str = "Dispatch ended while the command ran";
/// The note of a Claude step that waits for Resume.
const HELD_NOTE: &str = "held: the project is paused";

/// One step of an action, as the definitions file and the editor write it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Step {
    /// A shell command in the project folder: `cmd.exe /d /s /c` on Windows, `sh -c` elsewhere.
    Command {
        command: String,
        /// The time limit in seconds; none: `DEFAULT_LIMIT`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        limit: Option<u64>,
    },
    /// A task through the pipeline: the brief text and the ticket id, both with placeholders.
    Claude {
        brief: String,
        ticket: String,
        /// "Approve the plan by itself": the driver approves a plan without a HOLD decision.
        #[serde(default)]
        auto: bool,
    },
}

/// One action of the Actions panel.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Action {
    pub id: String,
    pub name: String,
    pub steps: Vec<Step>,
}

/// The definitions file.
#[derive(Serialize, Deserialize, Default)]
struct Definitions {
    #[serde(default)]
    actions: Vec<Action>,
}

/// One step of a run: the step of the definition at the click, with the placeholders expanded,
/// and what happened.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RunStep {
    /// `command` or `claude`.
    kind: String,
    /// The command, or the brief text.
    text: String,
    /// The ticket of a Claude step; empty for a command.
    ticket: String,
    auto: bool,
    /// The time limit of a command step in seconds.
    limit: u64,
    /// `waiting`, `running`, `done` or `failed`.
    state: String,
    started: Option<u64>,
    ended: Option<u64>,
    /// The exit code of a command step, `timeout` after the limit; none before the end.
    exit: Option<String>,
    /// The last lines of the output of a command step, stdout and stderr together.
    output: String,
    /// Why the step failed or waits, in words; empty else.
    note: String,
    /// The process of Dispatch that runs the command, while it runs.
    owner: Option<u32>,
}

/// One run of an action.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ActionRun {
    /// The name of the run file: `<action-id>-<yyyyMMdd-HHmmss>`.
    id: String,
    action: String,
    name: String,
    started: u64,
    ended: Option<u64>,
    /// `running`, `held`, `done` or `failed`.
    state: String,
    /// The index of the current step.
    step: usize,
    /// The placeholders, expanded once at the click.
    values: BTreeMap<String, String>,
    steps: Vec<RunStep>,
    /// Why the run failed, in words; empty else.
    note: String,
}

/// The actions of a project and the last runs of each, for the task list.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActionList {
    actions: Vec<Action>,
    /// At most `RUNS_SHOWN` runs per action, newest first.
    runs: Vec<ActionRun>,
    /// Why the definitions file could not be read; empty else.
    error: String,
}

impl ActionList {
    /// A running run is at a Claude step of this ticket with "Approve the plan by itself".
    pub(crate) fn approves(&self, ticket: &str) -> bool {
        self.runs.iter().any(|run| {
            run.state == "running" && run.steps.get(run.step).is_some_and(|step| step.kind == "claude" && step.auto && step.state == "running" && step.ticket == ticket)
        })
    }
}

/// The command steps that this process runs now, by the path of their run file.
static RUNNING: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64)
}

/// A moment as `yyyyMMdd-HHmmss` (UTC), for the name of a run file.
fn stamp(millis: u64) -> String {
    let digits: String = tickets::iso(millis).chars().filter(char::is_ascii_digit).take(14).collect();
    format!("{}-{}", &digits[..8], &digits[8..])
}

/// The id of an action is a file name: letters, digits, `-`, `_`, `.`, at most 64 characters.
fn check_id(id: &str) -> Result<(), String> {
    if id.chars().count() > 64 {
        return Err(format!("the action id {id} is longer than 64 characters"));
    }
    pipeline::check_ticket(id).map_err(|_| format!("invalid action id: {id}"))
}

/// The rules of a definition: a name, 1 to `MAX_STEPS` steps, each with text; a command of one
/// line; a ticket id of letters, digits, `-`, `_`, `.` and `{...}` placeholders.
fn check_action(action: &Action) -> Result<(), String> {
    check_id(&action.id)?;
    let name = action.name.trim();
    if name.is_empty() {
        return Err("the action has no name".to_string());
    }
    if name.chars().count() > NAME_MAX {
        return Err(format!("the name is longer than {NAME_MAX} characters"));
    }
    if action.steps.is_empty() || action.steps.len() > MAX_STEPS {
        return Err(format!("an action has 1 to {MAX_STEPS} steps"));
    }
    for (at, step) in action.steps.iter().enumerate() {
        let number = at + 1;
        match step {
            Step::Command { command, limit } => {
                if command.trim().is_empty() {
                    return Err(format!("step {number} has no command"));
                }
                if command.contains(['\n', '\r']) {
                    return Err(format!("the command of step {number} has more than one line; join the commands with &&"));
                }
                if limit.is_some_and(|limit| limit == 0 || limit > 86_400) {
                    return Err(format!("the time limit of step {number} is 1 to 86400 seconds"));
                }
            }
            Step::Claude { brief, ticket, .. } => {
                if brief.trim().is_empty() {
                    return Err(format!("step {number} has no brief"));
                }
                if ticket.is_empty() || !ticket.chars().all(|c| c.is_ascii_alphanumeric() || "-_.{}".contains(c)) {
                    return Err(format!("the ticket of step {number} has letters, digits, -, _, . and {{placeholders}} only"));
                }
            }
        }
    }
    Ok(())
}

/// The definitions of a project; none without the file. A file that is not correct JSON is an error.
fn read_definitions(project: &Project) -> Result<Vec<Action>, String> {
    let path = project.actions_file();
    let Ok(text) = fs::read_to_string(&path) else { return Ok(Vec::new()) };
    serde_json::from_str::<Definitions>(text.trim_start_matches('\u{feff}'))
        .map(|definitions| definitions.actions)
        .map_err(|error| format!("{} is not correct JSON: {error}", path.display()))
}

fn write_definitions(project: &Project, actions: Vec<Action>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&Definitions { actions }).map_err(err)?;
    write_file(&project.actions_file(), &format!("{text}\n"))
}

fn run_path(project: &Project, id: &str) -> PathBuf {
    project.actions_dir().join(format!("{id}.json"))
}

fn read_run(project: &Project, id: &str) -> Result<ActionRun, String> {
    check_id(id).map_err(|_| format!("invalid run id: {id}"))?;
    let path = run_path(project, id);
    let text = fs::read_to_string(&path).map_err(|error| format!("no run {id}: {error}"))?;
    serde_json::from_str(&text).map_err(|error| format!("{} is not correct JSON: {error}", path.display()))
}

/// Writes a run file through a temporary file and a rename: a reader sees the old or the new one.
fn write_run(project: &Project, run: &ActionRun) -> Result<(), String> {
    let path = run_path(project, &run.id);
    let temp = path.with_extension("tmp");
    let text = serde_json::to_string_pretty(run).map_err(err)?;
    write_file(&temp, &format!("{text}\n"))?;
    fs::rename(&temp, &path).map_err(|error| format!("{}: {error}", path.display()))
}

/// Every run of the project that reads.
fn read_runs(project: &Project) -> Vec<ActionRun> {
    pipeline::files_with(&project.actions_dir(), "json")
        .into_iter()
        .filter_map(|(_, path, _)| serde_json::from_str::<ActionRun>(&fs::read_to_string(path).ok()?).ok())
        .collect()
}

/// Whether a process lives.
fn alive(pid: u32) -> bool {
    crate::core::info::parent_pids().contains_key(&pid)
}

/// Marks a command step `failed` whose process ended with Dispatch: this process does not run it,
/// and the process of Dispatch that started it ended. Writes the changed run files.
fn mark_orphans(project: &Project, runs: &mut [ActionRun]) {
    let own = std::process::id();
    let running = RUNNING.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone();
    for run in runs.iter_mut().filter(|run| run.state == "running") {
        let path = run_path(project, &run.id);
        let Some(step) = run.steps.get_mut(run.step) else { continue };
        if step.kind != "command" || step.state != "running" {
            continue;
        }
        let orphan = match step.owner {
            Some(owner) if owner == own => !running.contains(&path),
            Some(owner) => !alive(owner),
            None => true,
        };
        if !orphan {
            continue;
        }
        let at = now();
        step.state = "failed".to_string();
        step.ended = Some(at);
        step.owner = None;
        step.note = ORPHAN_NOTE.to_string();
        run.state = "failed".to_string();
        run.ended = Some(at);
        run.note = format!("step {}: {ORPHAN_NOTE}", run.step + 1);
        if let Err(error) = write_run(project, run) {
            eprintln!("action run not marked failed: {error}");
        }
    }
}

/// The actions of a project and their last runs, for `task_list`. The caller holds the read lock.
pub(crate) fn list(project: &Project) -> ActionList {
    let (actions, error) = match read_definitions(project) {
        Ok(actions) => (actions, String::new()),
        Err(error) => (Vec::new(), error),
    };
    let mut runs = read_runs(project);
    mark_orphans(project, &mut runs);
    runs.retain(|run| actions.iter().any(|action| action.id == run.action));
    runs.sort_by(|a, b| b.started.cmp(&a.started).then_with(|| b.id.cmp(&a.id)));
    let mut count: HashMap<String, usize> = HashMap::new();
    runs.retain(|run| {
        let seen = count.entry(run.action.clone()).or_default();
        *seen += 1;
        *seen <= RUNS_SHOWN
    });
    ActionList { actions, runs, error }
}

/// The next version after a tag: the tag without `v` with its last number plus one; `0.0.1`
/// without a tag; empty when the last part is no number.
fn next_version(tag: &str) -> String {
    let bare = tag.strip_prefix('v').unwrap_or(tag);
    if bare.is_empty() {
        return "0.0.1".to_string();
    }
    let (head, last) = bare.rsplit_once('.').map_or(("", bare), |(head, last)| (head, last));
    match last.parse::<u64>() {
        Ok(number) if head.is_empty() => (number + 1).to_string(),
        Ok(number) => format!("{head}.{}", number + 1),
        Err(_) => String::new(),
    }
}

/// The placeholders of a run: `{date}` (UTC, `YYYY-MM-DD`), `{last_tag}`, `{next}`, `{commits}`
/// since the last tag (`%h %s`, the whole log without a tag) and `{project}` (the root folder).
fn placeholder_values(project: &Project, at: u64) -> BTreeMap<String, String> {
    let last_tag = git(&project.root, &["describe", "--tags", "--abbrev=0"]).map(|tag| tag.trim().to_string()).unwrap_or_default();
    let range = if last_tag.is_empty() { "HEAD".to_string() } else { format!("{last_tag}..HEAD") };
    let log = git(&project.root, &["log", &range, "--format=%h %s"]).unwrap_or_default();
    let lines: Vec<&str> = log.lines().map(str::trim_end).filter(|line| !line.is_empty()).collect();
    let mut commits = lines.iter().take(COMMITS_MAX).copied().collect::<Vec<_>>().join("\n");
    if lines.len() > COMMITS_MAX {
        commits.push_str(&format!("\n… and {} more commits", lines.len() - COMMITS_MAX));
    }
    BTreeMap::from([
        ("date".to_string(), tickets::iso(at)[..10].to_string()),
        ("next".to_string(), next_version(&last_tag)),
        ("last_tag".to_string(), last_tag),
        ("commits".to_string(), commits),
        ("project".to_string(), project.root.display().to_string()),
    ])
}

/// A text with each `{name}` of the values replaced in one pass; an unknown `{word}` stays.
pub(crate) fn expand(text: &str, values: &BTreeMap<String, String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        match after.find('}').map(|close| (close, &after[..close])) {
            Some((close, key)) if values.contains_key(key) => {
                out.push_str(&values[key]);
                rest = &after[close + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Saves an action: a new id adds it, a known id replaces it (a rename keeps the id and the runs).
/// Gives the actions with their runs.
pub fn action_save(cwd: String, action: Action) -> Result<ActionList, String> {
    let project = Project::find(&cwd)?;
    let action = Action { name: action.name.trim().to_string(), ..action };
    check_action(&action)?;
    let lock = pipeline::read_lock(&project.root);
    let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut actions = read_definitions(&project)?;
    match actions.iter_mut().find(|known| known.id == action.id) {
        Some(known) => *known = action,
        None => actions.push(action),
    }
    write_definitions(&project, actions)?;
    Ok(list(&project))
}

/// Deletes an action and its run files. Refused while a run of it runs or waits.
pub fn action_delete(cwd: String, id: String) -> Result<ActionList, String> {
    let project = Project::find(&cwd)?;
    let lock = pipeline::read_lock(&project.root);
    let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut actions = read_definitions(&project)?;
    let Some(at) = actions.iter().position(|action| action.id == id) else { return Err(format!("no action {id}")) };
    let runs = read_runs(&project);
    if runs.iter().any(|run| run.action == id && matches!(run.state.as_str(), "running" | "held")) {
        return Err(format!("the action {} runs now", actions[at].name));
    }
    actions.remove(at);
    write_definitions(&project, actions)?;
    for run in runs.iter().filter(|run| run.action == id) {
        let _ = fs::remove_file(run_path(&project, &run.id));
    }
    Ok(list(&project))
}

/// Starts the plan run of a ticket through the worker script; a test gives a fake.
type Start<'a> = &'a dyn Fn(&Project, &[&str]) -> Result<String, String>;

fn script_start(project: &Project, args: &[&str]) -> Result<String, String> {
    pipeline::run_script(project, args)
}

/// Runs an action: the click on Run. Expands the placeholders, writes the run file and starts
/// the first step. Refused while a run of the same action runs or waits.
pub fn action_run(cwd: String, id: String) -> Result<ActionRun, String> {
    run_with(&cwd, &id, &script_start)
}

/// Moves a run on: the driver window calls it when the current step waits, or when the task of a
/// running Claude step ended. A Claude step that ended well is closed and the next step starts; a
/// step that failed stops the run. Refused while the current step still runs, and for a run that
/// ended, so two windows start nothing twice.
pub fn action_step(cwd: String, run: String) -> Result<ActionRun, String> {
    advance(&cwd, &run, &script_start)
}

fn run_with(cwd: &str, id: &str, start: Start) -> Result<ActionRun, String> {
    let project = Project::find(cwd)?;
    let run = {
        let lock = pipeline::read_lock(&project.root);
        let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let actions = read_definitions(&project)?;
        let action = actions.iter().find(|action| action.id == id).ok_or_else(|| format!("no action {id}"))?;
        if read_runs(&project).iter().any(|run| run.action == action.id && matches!(run.state.as_str(), "running" | "held")) {
            return Err(format!("the action {} runs already", action.name));
        }
        let at = now();
        let values = placeholder_values(&project, at);
        let steps = action
            .steps
            .iter()
            .map(|step| match step {
                Step::Command { command, limit } => RunStep {
                    kind: "command".to_string(),
                    text: expand(command, &values),
                    limit: limit.unwrap_or(DEFAULT_LIMIT),
                    state: "waiting".to_string(),
                    ..RunStep::default()
                },
                Step::Claude { brief, ticket, auto } => RunStep {
                    kind: "claude".to_string(),
                    text: expand(brief, &values),
                    ticket: expand(ticket, &values),
                    auto: *auto,
                    state: "waiting".to_string(),
                    ..RunStep::default()
                },
            })
            .collect();
        let base = format!("{}-{}", action.id, stamp(at));
        let mut run_id = base.clone();
        let mut n = 2;
        while run_path(&project, &run_id).exists() {
            run_id = format!("{base}-{n}");
            n += 1;
        }
        let run = ActionRun { id: run_id, action: action.id.clone(), name: action.name.clone(), started: at, state: "running".to_string(), values, steps, ..ActionRun::default() };
        write_run(&project, &run)?;
        run
    };
    advance(cwd, &run.id, start)
}

/// What `advance` starts after it released the lock.
enum Todo {
    Nothing,
    Command(usize),
    Claude(usize),
}

fn advance(cwd: &str, run_id: &str, start: Start) -> Result<ActionRun, String> {
    let project = Project::find(cwd)?;
    // The end of the task of a running Claude step comes from the task list, which takes the
    // read lock itself: it is read before the lock.
    let peek = {
        let lock = pipeline::read_lock(&project.root);
        let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        read_run(&project, run_id)?
    };
    let peek_ticket = peek.steps.get(peek.step).filter(|step| step.kind == "claude" && step.state == "running").map(|step| step.ticket.clone());
    let end = match &peek_ticket {
        Some(ticket) => pipeline::task_end(cwd, ticket)?,
        None => None,
    };
    let (run, todo) = {
        let lock = pipeline::read_lock(&project.root);
        let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut run = read_run(&project, run_id)?;
        if !matches!(run.state.as_str(), "running" | "held") {
            return Err(format!("the run {run_id} has ended"));
        }
        let at = now();
        let index = run.step;
        let Some(step) = run.steps.get_mut(index) else { return Err(format!("the run {run_id} has no step {}", index + 1)) };
        if step.state == "running" {
            if step.kind != "claude" || peek_ticket.as_deref() != Some(step.ticket.as_str()) {
                return Err(format!("step {} still runs", index + 1));
            }
            match end {
                Some(true) => step.state = "done".to_string(),
                Some(false) => {
                    step.state = "failed".to_string();
                    step.note = format!("the task {} failed or was stopped", step.ticket);
                }
                None => return Err(format!("step {} still runs", index + 1)),
            }
            step.ended = Some(at);
        }
        let state = step.state.clone();
        let todo = match state.as_str() {
            "failed" => {
                let note = format!("step {} failed", index + 1);
                run.state = "failed".to_string();
                run.ended = Some(at);
                run.note = note;
                Todo::Nothing
            }
            "done" if index + 1 == run.steps.len() => {
                run.state = "done".to_string();
                run.ended = Some(at);
                Todo::Nothing
            }
            _ => {
                if run.steps[index].state == "done" {
                    run.step = index + 1;
                }
                start_next(&project, &mut run, at)
            }
        };
        write_run(&project, &run)?;
        (run, todo)
    };
    match todo {
        Todo::Nothing => Ok(run),
        Todo::Command(index) => {
            spawn_command(&project, &run, index);
            Ok(run)
        }
        Todo::Claude(index) => match start_claude(&project, &run, index, start) {
            Ok(()) => Ok(run),
            Err(error) => {
                let lock = pipeline::read_lock(&project.root);
                let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
                let mut run = read_run(&project, run_id)?;
                let at = now();
                if let Some(step) = run.steps.get_mut(index) {
                    step.state = "failed".to_string();
                    step.ended = Some(at);
                    step.note = error;
                }
                run.state = "failed".to_string();
                run.ended = Some(at);
                run.note = format!("step {} failed", index + 1);
                write_run(&project, &run)?;
                Ok(run)
            }
        },
    }
}

/// Marks the current step of a run as started, under the lock, and says what to start. A Claude
/// step waits while the project is paused: the run is `held`.
fn start_next(project: &Project, run: &mut ActionRun, at: u64) -> Todo {
    let index = run.step;
    let paused = project.options().paused;
    let path = run_path(project, &run.id);
    let Some(step) = run.steps.get_mut(index) else { return Todo::Nothing };
    if step.state != "waiting" {
        return Todo::Nothing;
    }
    if step.kind == "claude" && paused {
        run.state = "held".to_string();
        step.note = HELD_NOTE.to_string();
        return Todo::Nothing;
    }
    run.state = "running".to_string();
    step.note.clear();
    step.state = "running".to_string();
    step.started = Some(at);
    if step.kind == "command" {
        step.owner = Some(std::process::id());
        RUNNING.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(path);
        Todo::Command(index)
    } else {
        Todo::Claude(index)
    }
}

/// Starts the task of a Claude step: opens its ticket in In progress, writes the brief and starts
/// the plan run through the worker script. A ticket id that a ticket or a task has is refused.
fn start_claude(project: &Project, run: &ActionRun, index: usize, start: Start) -> Result<(), String> {
    let step = &run.steps[index];
    let ticket = step.ticket.as_str();
    pipeline::check_ticket(ticket)?;
    tickets::open_in_progress(project, ticket, &run.name, &step.text)?;
    let clicked = format!("{} UTC", tickets::iso(run.started)[..16].replace('T', " "));
    let brief = format!(
        "# {ticket}: {}\n\nDispatch wrote this brief from the action {} of the Actions panel, clicked by the user on {clicked}; the triage chat did not see it.\n\n{}\n",
        run.name,
        run.name,
        step.text.trim()
    );
    write_file(&project.briefs().join(format!("{ticket}.md")), &brief)?;
    start(project, &["plan", ticket]).map(|_| ())
}

/// The shell of a command step in the project folder.
#[cfg(windows)]
fn shell(command: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut shell = Command::new("cmd.exe");
    shell.raw_arg(format!("/d /s /c \"{command}\""));
    shell
}

#[cfg(not(windows))]
fn shell(command: &str) -> Command {
    let mut shell = Command::new("sh");
    shell.arg("-c").arg(command);
    shell
}

/// Runs a command in a folder with a time limit. Gives the exit code (`timeout` after the limit)
/// and the output tail, stdout and stderr together.
fn run_command(root: &Path, command: &str, limit: u64) -> (String, String) {
    let (reader, writer) = match std::io::pipe() {
        Ok(pipe) => pipe,
        Err(error) => return ("error".to_string(), format!("no pipe for the output: {error}")),
    };
    let writer_copy = match writer.try_clone() {
        Ok(copy) => copy,
        Err(error) => return ("error".to_string(), format!("no pipe for the output: {error}")),
    };
    let mut command_line = shell(command);
    command_line.current_dir(root).stdin(Stdio::null()).stdout(writer_copy).stderr(writer).no_window();
    let spawned = command_line.spawn();
    // The command keeps copies of the pipe ends; without them the reader ends with the process.
    drop(command_line);
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => return ("error".to_string(), format!("not started: {error}")),
    };
    let tail: Arc<Mutex<VecDeque<String>>> = Arc::default();
    let lines = tail.clone();
    let reading = std::thread::spawn(move || {
        for line in BufReader::new(reader).split(b'\n').map_while(Result::ok) {
            let line = String::from_utf8_lossy(&line).trim_end().chars().take(LINE_CHARS).collect::<String>();
            let mut lines = lines.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            lines.push_back(line);
            if lines.len() > OUTPUT_LINES {
                lines.pop_front();
            }
        }
    });
    let began = Instant::now();
    let exit = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code().map_or_else(|| "signal".to_string(), |code| code.to_string()),
            Ok(None) if began.elapsed() >= Duration::from_secs(limit) => {
                crate::core::rules_check::end_tree(child.id());
                let _ = child.wait();
                break "timeout".to_string();
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => break format!("error: {error}"),
        }
    };
    // A program that the command left running can keep the pipe open: the tail waits 5 s at most.
    let deadline = Instant::now() + Duration::from_secs(5);
    while !reading.is_finished() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(50));
    }
    let output = tail.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).iter().cloned().collect::<Vec<_>>().join("\n");
    (exit, output)
}

/// Runs a command step in a thread without the lock, and writes its result under the lock.
fn spawn_command(project: &Project, run: &ActionRun, index: usize) {
    let root = project.root.clone();
    let cwd = root.to_string_lossy().into_owned();
    let run_id = run.id.clone();
    let step = run.steps[index].clone();
    let thread = std::thread::Builder::new().name(format!("action {run_id}")).spawn(move || {
        let (exit, output) = run_command(&root, &step.text, step.limit);
        finish_command(&cwd, &run_id, index, exit, output, step.limit);
    });
    if let Err(error) = thread {
        finish_command(&project.root.to_string_lossy(), &run.id, index, "error".to_string(), format!("no thread: {error}"), 0);
    }
}

/// Writes the end of a command step: exit code 0 moves the run to the next step (the driver starts
/// it) or ends it done; another code fails the run.
fn finish_command(cwd: &str, run_id: &str, index: usize, exit: String, output: String, limit: u64) {
    let Ok(project) = Project::find(cwd) else { return };
    let path = run_path(&project, run_id);
    let lock = pipeline::read_lock(&project.root);
    let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match read_run(&project, run_id) {
        Ok(mut run) => {
            let at = now();
            let last = index + 1 == run.steps.len();
            if let Some(step) = run.steps.get_mut(index) {
                step.ended = Some(at);
                step.owner = None;
                step.output = output;
                if exit == "0" {
                    step.state = "done".to_string();
                } else {
                    step.state = "failed".to_string();
                    if exit == "timeout" {
                        step.note = format!("stopped after the time limit of {limit} s");
                    }
                }
                step.exit = Some(exit);
            }
            if run.steps.get(index).is_some_and(|step| step.state == "done") {
                if last {
                    run.state = "done".to_string();
                    run.ended = Some(at);
                } else {
                    run.step = index + 1;
                }
            } else {
                run.state = "failed".to_string();
                run.ended = Some(at);
                run.note = format!("step {} failed", index + 1);
            }
            if let Err(error) = write_run(&project, &run) {
                eprintln!("action run not written: {error}");
            }
        }
        Err(error) => eprintln!("action run not read after its command: {error}"),
    }
    RUNNING.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).retain(|known| *known != path);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::pipeline::tests::{action_scratch, clean, fake_script, git_scratch};

    fn cwd_of(project: &Project) -> String {
        project.root.to_string_lossy().into_owned()
    }

    fn git_ok(root: &Path, args: &[&str]) -> String {
        let output = Command::new("git").arg("-C").arg(root).args(args).stdin(Stdio::null()).output().unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn commit(root: &Path, file: &str, subject: &str) {
        write_file(&root.join(file), subject).unwrap();
        git_ok(root, &["add", "--all"]);
        git_ok(root, &["commit", "-q", "-m", subject]);
    }

    fn command(text: &str) -> Step {
        Step::Command { command: text.to_string(), limit: None }
    }

    fn save(cwd: &str, id: &str, steps: Vec<Step>) -> Action {
        let action = Action { id: id.to_string(), name: format!("Action {id}"), steps };
        action_save(cwd.to_string(), action.clone()).unwrap();
        action
    }

    /// The run file after its command step ended: polls up to 10 minutes. The limit only guards a
    /// hang; on a busy computer the start of one process can take seconds.
    fn wait_step(cwd: &str, run_id: &str, index: usize) -> ActionRun {
        wait_step_for(cwd, run_id, index, Duration::from_secs(600))
    }

    /// The run file after its command step ended: polls up to `most`.
    fn wait_step_for(cwd: &str, run_id: &str, index: usize, most: Duration) -> ActionRun {
        let project = Project::find(cwd).unwrap();
        let began = Instant::now();
        loop {
            let run = read_run(&project, run_id).unwrap();
            if run.steps[index].state != "running" {
                return run;
            }
            assert!(began.elapsed() < most, "step {index} of {run_id} still runs after {most:?}");
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    #[test]
    fn definitions_are_written_read_renamed_and_deleted() {
        let project = git_scratch("actions-defs");
        let cwd = cwd_of(&project);
        let action = Action {
            id: "build".to_string(),
            name: " Build ".to_string(),
            steps: vec![command("echo built"), Step::Claude { brief: "Check {date}".to_string(), ticket: "check-{date}".to_string(), auto: true }],
        };
        let list = action_save(cwd.clone(), action.clone()).unwrap();
        let saved = Action { name: "Build".to_string(), ..action.clone() };
        assert_eq!(list.actions, vec![saved.clone()]);
        let text = fs::read_to_string(project.actions_file()).unwrap();
        assert!(text.contains("\"kind\": \"claude\"") && text.contains("\"auto\": true"), "{text}");
        // A rename keeps the id; the list has one action.
        let renamed = Action { name: "Build all".to_string(), ..saved.clone() };
        let list = action_save(cwd.clone(), renamed.clone()).unwrap();
        assert_eq!(list.actions, vec![renamed.clone()]);
        assert_eq!(read_definitions(&Project::find(&cwd).unwrap()).unwrap(), vec![renamed.clone()]);
        // The rules of a definition.
        let refused = |action: Action| action_save(cwd.clone(), action).unwrap_err();
        assert!(refused(Action { name: "  ".to_string(), ..renamed.clone() }).contains("no name"));
        assert!(refused(Action { steps: Vec::new(), ..renamed.clone() }).contains("1 to 10 steps"));
        assert!(refused(Action { id: "a b".to_string(), ..renamed.clone() }).contains("invalid action id"));
        assert!(refused(Action { steps: vec![command("echo a\necho b")], ..renamed.clone() }).contains("more than one line"));
        assert!(refused(Action { steps: vec![Step::Claude { brief: "b".to_string(), ticket: "a b".to_string(), auto: false }], ..renamed.clone() }).contains("ticket of step 1"));
        // A second action, then the delete of the first.
        save(&cwd, "other", vec![command("echo other")]);
        let list = action_delete(cwd.clone(), "build".to_string()).unwrap();
        assert_eq!(list.actions.iter().map(|action| action.id.as_str()).collect::<Vec<_>>(), ["other"]);
        assert!(action_delete(cwd.clone(), "build".to_string()).unwrap_err().contains("no action build"));
        // A definitions file that is not JSON: the list says why, and a save does not overwrite it.
        write_file(&project.actions_file(), "{ not json").unwrap();
        let shown = super::list(&Project::find(&cwd).unwrap());
        assert!(shown.actions.is_empty() && shown.error.contains("is not correct JSON"), "{shown:?}");
        assert!(action_save(cwd.clone(), renamed).unwrap_err().contains("is not correct JSON"));
        clean(&project);
    }

    #[test]
    fn command_step_records_exit_code_and_output() {
        let project = git_scratch("actions-command");
        let cwd = cwd_of(&project);
        // stdout and stderr together, and the exit code; a failed step ends the run.
        // The command waits for go.txt (at most 60 s), so it still runs during the checks below.
        save(&cwd, "fail", vec![command("echo first&& echo second 1>&2&& (for /l %i in (1,1,60) do @if not exist go.txt @ping -n 2 127.0.0.1 >nul)& exit /b 3"),command("echo never> never.txt")]);
        let run = action_run(cwd.clone(), "fail".to_string()).unwrap();
        assert_eq!((run.state.as_str(), run.steps[0].state.as_str(), run.steps[0].owner), ("running", "running", Some(std::process::id())));
        assert!(action_step(cwd.clone(), run.id.clone()).unwrap_err().contains("step 1 still runs"));
        assert!(action_run(cwd.clone(), "fail".to_string()).unwrap_err().contains("runs already"));
        write_file(&project.root.join("go.txt"), "go").unwrap();
        let run = wait_step(&cwd, &run.id, 0);
        assert_eq!(run.steps[0].exit.as_deref(), Some("3"));
        assert_eq!(run.steps[0].output, "first\nsecond");
        assert_eq!((run.state.as_str(), run.steps[0].state.as_str(), run.steps[1].state.as_str()), ("failed", "failed", "waiting"));
        assert!(run.ended.is_some() && run.note == "step 1 failed", "{run:?}");
        assert!(action_step(cwd.clone(), run.id.clone()).unwrap_err().contains("has ended"));
        assert!(!project.root.join("never.txt").exists());
        // A chain of two commands: the first ends well, the run waits at step 2 for the driver, and
        // `action_step` starts it.
        save(&cwd, "two", vec![command("echo one"), command("echo two> two.txt")]);
        let run = action_run(cwd.clone(), "two".to_string()).unwrap();
        let run = wait_step(&cwd, &run.id, 0);
        assert_eq!((run.state.as_str(), run.step, run.steps[0].exit.as_deref(), run.steps[1].state.as_str()), ("running", 1, Some("0"), "waiting"));
        let run = action_step(cwd.clone(), run.id).unwrap();
        assert_eq!(run.steps[1].state, "running");
        let run = wait_step(&cwd, &run.id, 1);
        assert_eq!((run.state.as_str(), run.steps[1].output.as_str()), ("done", ""));
        assert!(project.root.join("two.txt").is_file());
        // The output tail: the last 200 lines.
        save(&cwd, "long", vec![command("for /l %i in (1,1,250) do @echo line %i")]);
        let run = action_run(cwd.clone(), "long".to_string()).unwrap();
        let run = wait_step(&cwd, &run.id, 0);
        let lines: Vec<&str> = run.steps[0].output.lines().collect();
        assert_eq!((lines.len(), lines[0], lines[199]), (200, "line 51", "line 250"));
        // The time limit ends the process tree; the exit is `timeout`. The command sleeps about
        // 15 minutes; the bound of 5 minutes proves that the limit stopped the step long before the
        // command could end by itself. The span also holds about 9 process starts (git, cmd, ping,
        // taskkill), and one start took up to 11 s on a busy computer, so the bound keeps a wide margin.
        let action = Action { id: "slow".to_string(), name: "Slow".to_string(), steps: vec![Step::Command { command: "ping -n 900 127.0.0.1 >nul".to_string(), limit: Some(1) }] };
        action_save(cwd.clone(), action).unwrap();
        let began = Instant::now();
        let bound = Duration::from_secs(300);
        let run = action_run(cwd.clone(), "slow".to_string()).unwrap();
        let run = wait_step_for(&cwd, &run.id, 0, Duration::from_secs(600));
        assert!(began.elapsed() < bound, "the step ended after {:?}, the bound is {bound:?}", began.elapsed());
        assert_eq!((run.steps[0].exit.as_deref(), run.state.as_str()), (Some("timeout"), "failed"));
        assert!(run.steps[0].note.contains("time limit of 1 s"), "{run:?}");
        // A command step of this process that no thread runs (Dispatch ended): the list marks it failed.
        let project = Project::find(&cwd).unwrap();
        let mut orphan = run.clone();
        orphan.id = "slow-orphan".to_string();
        orphan.state = "running".to_string();
        orphan.steps[0].state = "running".to_string();
        orphan.steps[0].owner = Some(std::process::id());
        write_run(&project, &orphan).unwrap();
        let shown = list(&project);
        let marked = shown.runs.iter().find(|run| run.id == "slow-orphan").unwrap();
        assert_eq!((marked.state.as_str(), marked.steps[0].note.as_str()), ("failed", ORPHAN_NOTE));
        assert_eq!(read_run(&project, "slow-orphan").unwrap().state, "failed");
        clean(&project);
    }

    #[test]
    fn placeholders_take_the_tag_and_the_commits() {
        let project = git_scratch("actions-values");
        let root = project.root.clone();
        let at = now();
        let values = placeholder_values(&project, at);
        assert_eq!((values["last_tag"].as_str(), values["next"].as_str(), values["commits"].as_str()), ("", "0.0.1", ""));
        assert_eq!(values["date"], tickets::iso(at)[..10]);
        assert_eq!(values["project"], root.display().to_string());
        commit(&root, "a.txt", "first change");
        git_ok(&root, &["tag", "v1.2.9"]);
        commit(&root, "b.txt", "second change");
        let values = placeholder_values(&project, at);
        assert_eq!((values["last_tag"].as_str(), values["next"].as_str()), ("v1.2.9", "1.2.10"));
        assert!(values["commits"].ends_with(" second change") && !values["commits"].contains("first"), "{values:?}");
        assert_eq!(values["commits"].lines().count(), 1);
        // One pass: a value with braces stays as it is, and an unknown word stays.
        let mut with_braces = values.clone();
        with_braces.insert("commits".to_string(), "abc {next}".to_string());
        assert_eq!(expand("v{next} {unknown} {commits} {", &with_braces), "v1.2.10 {unknown} abc {next} {");
        assert_eq!((next_version("v7"), next_version("1.0"), next_version("v1.0-beta")), ("8".to_string(), "1.1".to_string(), String::new()));
        clean(&project);
    }

    #[test]
    fn release_chain_runs_the_command_after_the_done_task() {
        let (project, fake) = action_scratch("actions-release");
        let root = project.root.clone();
        let cwd = cwd_of(&project);
        let start = |project: &Project, args: &[&str]| fake_script(project, &fake, args);
        // A repository with a tag and a bare clone as origin: the push goes only there.
        commit(&root, "start.txt", "start");
        git_ok(&root, &["tag", "v0.0.1"]);
        let origin = root.parent().unwrap().join("origin.git");
        git_ok(&root, &["init", "-q", "--bare", &origin.to_string_lossy()]);
        git_ok(&root, &["remote", "add", "origin", &origin.to_string_lossy()]);
        commit(&root, "feature.txt", "feature x");
        let branch = git_ok(&root, &["symbolic-ref", "--short", "HEAD"]).trim().to_string();
        save(
            &cwd,
            "release",
            vec![
                Step::Claude { brief: "Release version {next}. The commits since {last_tag}:\n{commits}".to_string(), ticket: "release-{next}".to_string(), auto: true },
                command(&format!("git tag v{{next}} && git push -q origin {branch} v{{next}}")),
            ],
        );
        let run = run_with(&cwd, "release", &start).unwrap();
        assert_eq!((run.state.as_str(), run.steps[0].state.as_str(), run.steps[0].ticket.as_str()), ("running", "running", "release-0.0.2"));
        assert_eq!(run.steps[1].text, format!("git tag v0.0.2 && git push -q origin {branch} v0.0.2"));
        // The brief, the ticket in In progress and the plan run through the script.
        let brief = fs::read_to_string(project.briefs().join("release-0.0.2.md")).unwrap();
        assert!(brief.starts_with("# release-0.0.2: Action release\n\nDispatch wrote this brief from the action Action release of the Actions panel"), "{brief}");
        assert!(brief.contains("Release version 0.0.2. The commits since v0.0.1:\n") && brief.contains(" feature x"), "{brief}");
        assert_eq!(fs::read_to_string(project.reports.join("release-0.0.2.state")).unwrap().trim(), "planning");
        assert!(project.plans().join("release-0.0.2.md").is_file());
        let tickets = fs::read_to_string(project.tickets_file()).unwrap();
        assert!(tickets.contains("\"id\":\"release-0.0.2\"") && tickets.contains("\"status\":\"in_progress\""), "{tickets}");
        // The task runs: the step waits.
        assert!(advance(&cwd, &run.id, &start).unwrap_err().contains("step 1 still runs"));
        // The work run ends done (the test writes the report as the pipeline tests do): the next
        // call closes the Claude step and starts the command, which tags and pushes.
        write_file(&project.reports.join("release-0.0.2.md"), "state: done\nneeds: nothing\nfiles: none\nplan: x\n\ndone\n").unwrap();
        let run = advance(&cwd, &run.id, &start).unwrap();
        assert_eq!((run.steps[0].state.as_str(), run.step, run.steps[1].state.as_str()), ("done", 1, "running"));
        let run = wait_step(&cwd, &run.id, 1);
        assert_eq!((run.state.as_str(), run.steps[1].exit.as_deref()), ("done", Some("0")), "{run:?}");
        assert_eq!(git_ok(&origin, &["tag"]).trim(), "v0.0.2");
        assert!(git_ok(&origin, &["log", "--format=%s", &branch]).contains("feature x"));
        // The ticket followed its task to Done.
        let list = pipeline::task_list(cwd.clone()).unwrap();
        let value = serde_json::to_value(&list).unwrap();
        let ticket = value["tickets"].as_array().unwrap().iter().find(|ticket| ticket["id"] == "release-0.0.2").unwrap();
        assert_eq!(ticket["status"], "done");
        clean(&project);
    }

    #[test]
    fn failed_claude_step_stops_the_chain() {
        let (project, fake) = action_scratch("actions-failed");
        let root = project.root.clone();
        let cwd = cwd_of(&project);
        let start = |project: &Project, args: &[&str]| fake_script(project, &fake, args);
        commit(&root, "start.txt", "start");
        save(&cwd, "fix", vec![Step::Claude { brief: "Fix it".to_string(), ticket: "t-fix".to_string(), auto: false }, command("echo never> never.txt")]);
        // Pause holds the Claude step: the run is held and starts nothing.
        pipeline::set_paused(cwd.clone(), true).unwrap();
        let run = run_with(&cwd, "fix", &start).unwrap();
        assert_eq!((run.state.as_str(), run.steps[0].state.as_str(), run.steps[0].note.as_str()), ("held", "waiting", HELD_NOTE));
        assert!(!project.briefs().join("t-fix.md").exists());
        let run = advance(&cwd, &run.id, &start).unwrap();
        assert_eq!(run.state, "held");
        // Resume: the next call starts the plan run.
        pipeline::set_paused(cwd.clone(), false).unwrap();
        let run = advance(&cwd, &run.id, &start).unwrap();
        assert_eq!((run.state.as_str(), run.steps[0].state.as_str(), run.steps[0].note.as_str()), ("running", "running", ""));
        // The task fails: the chain stops before the command, and the panel gets the failed run.
        write_file(&project.reports.join("t-fix.md"), "state: failed\nneeds: nothing\nfiles: none\nplan: x\n\nfailed\n").unwrap();
        let run = advance(&cwd, &run.id, &start).unwrap();
        assert_eq!((run.state.as_str(), run.steps[0].state.as_str(), run.steps[1].state.as_str()), ("failed", "failed", "waiting"));
        assert_eq!((run.note.as_str(), run.steps[0].note.as_str()), ("step 1 failed", "the task t-fix failed or was stopped"));
        assert!(advance(&cwd, &run.id, &start).unwrap_err().contains("has ended"));
        assert!(!root.join("never.txt").exists());
        let shown = list(&Project::find(&cwd).unwrap());
        assert_eq!(shown.runs.first().map(|run| run.state.as_str()), Some("failed"));
        // A second run takes the same ticket id: refused, and the run fails with the reason.
        let again = run_with(&cwd, "fix", &start).unwrap();
        assert_eq!(again.state, "failed");
        assert!(again.steps[0].note.contains("the ticket t-fix exists already"), "{again:?}");
        // A refusal of the script fails the run with its text.
        save(&cwd, "refused", vec![Step::Claude { brief: "x".to_string(), ticket: "t-refused".to_string(), auto: false }]);
        let refuse = |_: &Project, _: &[&str]| Err::<String, String>("no brief at somewhere".to_string());
        let run = run_with(&cwd, "refused", &refuse).unwrap();
        assert_eq!((run.state.as_str(), run.steps[0].note.as_str()), ("failed", "no brief at somewhere"));
        clean(&project);
    }

    #[test]
    fn task_list_marks_the_ticket_of_an_auto_step() {
        let (project, fake) = action_scratch("actions-auto");
        let cwd = cwd_of(&project);
        let start = |project: &Project, args: &[&str]| fake_script(project, &fake, args);
        save(&cwd, "auto", vec![Step::Claude { brief: "By itself".to_string(), ticket: "t-auto".to_string(), auto: true }]);
        save(&cwd, "manual", vec![Step::Claude { brief: "With a click".to_string(), ticket: "t-manual".to_string(), auto: false }]);
        run_with(&cwd, "auto", &start).unwrap();
        run_with(&cwd, "manual", &start).unwrap();
        let value = serde_json::to_value(pipeline::task_list(cwd.clone()).unwrap()).unwrap();
        let auto = |name: &str| value["tasks"].as_array().unwrap().iter().find(|task| task["name"] == name).unwrap()["auto"].clone();
        assert_eq!((auto("t-auto"), auto("t-manual")), (serde_json::json!(true), serde_json::json!(false)));
        assert_eq!(value["actions"]["actions"].as_array().unwrap().len(), 2);
        assert_eq!(value["actions"]["runs"].as_array().unwrap().len(), 2);
        // The task ended: the run is no longer at a running step, so the mark goes.
        write_file(&project.reports.join("t-auto.md"), "state: done\nneeds: nothing\nfiles: none\nplan: x\n\ndone\n").unwrap();
        let run_id = list(&Project::find(&cwd).unwrap()).runs.iter().find(|run| run.action == "auto").unwrap().id.clone();
        let run = advance(&cwd, &run_id, &start).unwrap();
        assert_eq!(run.state, "done");
        let value = serde_json::to_value(pipeline::task_list(cwd.clone()).unwrap()).unwrap();
        let task = value["tasks"].as_array().unwrap().iter().find(|task| task["name"] == "t-auto").unwrap().clone();
        assert_eq!(task["auto"], serde_json::json!(false));
        clean(&project);
    }
}
