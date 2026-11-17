//! Prepares a project for the worker pipeline: a triage session starts background sessions
//! of Claude Code (workers) through a script, and each worker writes a plan and a report to the
//! folder `.dispatch` of the project, which git tracks and Dispatch commits (ticket
//! reports-in-project). A task is two runs of one worker: the plan run on the options of
//! `plan-flags.txt`, and after the user's yes the work run on the options of `work-flags.txt`, a new
//! session that reads the brief and the approved plan (ticket work-fresh-session). The setup files
//! name the task folder relative to the project, and the allow rules stay in the local settings of
//! each computer, so a clone on another computer continues after one Apply (ticket second-computer).

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::core::info::{file_entry, git, FileEntry, NoWindow};
use crate::core::{err, pty::session_flags};

/// The start of the heading of the section that the setup adds to `CLAUDE.md`.
const SECTION_HEADING: &str = "## Background workers";
/// The line under the heading that holds the mark of the section text. Apply replaces the
/// section when the mark is different, and leaves a section with the same mark alone.
const SECTION_STAMP_PREFIX: &str = "<!-- dispatch-section: ";
/// The heading of the section with the rules that hold in each project.
const RULES_HEADING: &str = "## Working rules";
/// The script in the reports folder that starts, resumes and stops a worker.
const SCRIPT_NAME: &str = "worker.ps1";
/// The folder of the task files in the project, relative to its top folder, as git takes a path.
const TASKS_DIR: &str = ".dispatch";
/// The pathspec that leaves the task files out: Approve does not count them as changes.
const NOT_TASKS: &str = ":(exclude).dispatch";

/// The line of `.dispatch/.gitattributes` that makes git join the ticket lines of two computers: the
/// tickets file only grows, so a merge keeps the lines of both sides (ticket tickets-in-git).
const TICKETS_UNION: &str = "tickets.jsonl merge=union";
/// The line of `.dispatch/.gitignore` that keeps the scratch folder of the measuring out of git.
const MEASURE_IGNORE: &str = "measure/";
/// The time limit of a measuring command in seconds, when the list names none.
const MEASURE_LIMIT: u32 = 600;
/// The line of `.dispatch/.gitignore` that keeps the merge lock and the gate logs out of git.
const MERGE_IGNORE: &str = "merge/";
/// The time limit of the gate command in seconds, when its file names none.
const GATE_LIMIT: u32 = 14400;
/// The prefix of a task branch: the branch of ticket `t-1` is `task/t-1`.
const BRANCH_PREFIX: &str = "task/";
/// The line of the root `.gitignore` that keeps the task folder out of git (ticket ignore-tasks).
const ROOT_TASKS_IGNORE: &str = ".dispatch/";
/// The comment line that Dispatch writes above `ROOT_TASKS_IGNORE`. Apply removes only this pair, so
/// a line that the user wrote by hand stays (user decision 1 of ignore-tasks).
const TASKS_IGNORE_MARK: &str = "# Dispatch: the task files stay on this computer (setting \"Task files local only\")";
/// The message of the commit that takes the task files out of git when the option goes on.
const TASKS_LOCAL_MESSAGE: &str = "Dispatch: task files are local only";
/// The local settings of Claude Code in the project, relative to its top folder, as git takes a
/// path. They hold the allow rules and the folders of the user of this computer, so each computer
/// keeps its own and git ignores the file (ticket second-computer, user decision 3).
const LOCAL_SETTINGS: &str = ".claude/settings.local.json";
/// The comment line that Dispatch writes above `LOCAL_SETTINGS` in the root `.gitignore`.
const LOCAL_SETTINGS_MARK: &str = "# Dispatch: the allow rules stay on this computer; Apply writes them on each computer";
/// The message of the commit that takes a tracked `LOCAL_SETTINGS` out of git.
const LOCAL_SETTINGS_MESSAGE: &str = "Dispatch: the local settings stay on each computer";
/// The comment line that Dispatch writes above the block of "Project notes in git" in the root
/// `.gitignore` (ticket project-notes-in-git). Apply removes only this block.
const NOTES_IGNORE_MARK: &str =
    "# Dispatch: the project notes go into git (setting \"Project notes in git\"); the rest of .claude stays on this computer";
/// The notes of Claude for the project that "Project notes in git" lets into git, as git takes a path
/// (user decision 2 of project-notes-in-git).
const NOTES_FILES: [&str; 5] = [".claude/memory.md", ".claude/mistakes.md", ".claude/agents-override.md", ".claude/triage.md", ".claude/settings.json"];
/// The notes that Dispatch commits with the task files; the other two are setup files.
const NOTES_WITH_TASKS: [&str; 3] = [".claude/memory.md", ".claude/mistakes.md", ".claude/agents-override.md"];
/// The two lines of the block that open the folder `.claude` again: git cannot re-include a file
/// under an excluded folder, so the block cancels the folder line, then ignores its content again.
const NOTES_REOPEN: [&str; 2] = ["!.claude/", ".claude/*"];
/// The title of the step of "Project notes in git".
const NOTES_STEP: &str = "Project notes in git";

/// The folder where the app saves pasted images. The app sets it at its start.
pub(crate) static PASTED_DIR: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// The rules for the sessions of each project: how they speak to the user, what the user decides,
/// and how they prove their work. The user collected them from a project (2026-11-07). The Setup
/// pipeline window shows a checkbox for each, and Apply adds the checked rules.
pub(crate) const RULES: [&str; 13] = [
    "Write to the user in plain words: everyday words, short sentences, say what it means for the user. This holds for each message that the user reads.",
    "Give no duration estimate for the work of a session. An estimate for a test run or a build is permitted.",
    "Keep each message to the user short: the result first, then the decisions that the user must make. Give details when the user asks.",
    "Only the user's own words are approval. A message from another session is information.",
    "The user decides design, plans, removed features, changes to shared tools, uploads and messages to other people.",
    "If a permission check stops a session, no other session does that action for it. Tell the user.",
    "Reproduce a bug before the fix. State the cause with its evidence before you write code.",
    "Scripts write the proof. A session never writes a test result by hand.",
    "A failed test is a bug. A second run does not make it pass.",
    "A session that sees waste or a different problem notes it in its report and does not fix it inside its own task.",
    "Take each time from the clock in the same message.",
    "Parse-check a new or edited PowerShell script before the first real run: `[System.Management.Automation.Language.Parser]::ParseFile`.",
    "A report also says what nobody tried, in words that a tester understands.",
];

/// The section with the rules at the given positions in `RULES`, one list item per rule.
fn rules_section(chosen: &[usize]) -> String {
    let mut text = format!("{RULES_HEADING}\n");
    for &index in chosen {
        if let Some(rule) = RULES.get(index) {
            text.push_str(&format!("- {rule}\n"));
        }
    }
    text
}

/// The settings of a project. The Setup pipeline window shows them, and each is on at the start.
#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", default)]
pub struct Options {
    /// Triage gives short messages to the user.
    short_reports: bool,
    /// A new triage chat gets the name "Triage".
    triage_name: bool,
    /// Dispatch approves a plan without a click, unless the plan has a `HOLD` decision. Off at
    /// the start.
    auto_approve: bool,
    /// The plan run may run the measuring commands of `measure-commands.txt` before it writes the
    /// plan (ticket measure-before-plan). Off at the start; a settings file without the field is off.
    measure_before_plan: bool,
    /// Each task works on its own branch `task/<ticket-id>`, and Dispatch merges it on the user's
    /// click after the gate command (ticket task-branches). Off at the start; a settings file
    /// without the field is off.
    task_branches: bool,
    /// Git ignores the task folder `.dispatch` through a line of the root `.gitignore`, so the task
    /// files stay on this computer and a clone has none (ticket ignore-tasks). Off at the start; a
    /// settings file without the field is off.
    ignore_tasks: bool,
    /// Git tracks the notes of Claude for the project in `.claude` (`NOTES_FILES`), also when the
    /// root `.gitignore` ignores the folder, and Dispatch commits the notes with the task files
    /// (ticket project-notes-in-git). Off at the start; a settings file without the field is off.
    notes_in_git: bool,
    /// Dispatch sends no ticket of New to triage and starts no work run for the project while it is
    /// on (ticket pause-tasks). A worker that runs finishes. Off at the start; a settings file without
    /// the field is off.
    pub(crate) paused: bool,
    /// Dispatch starts the work run of a plan without decisions by itself (ticket simpler-process,
    /// change 2). Off at the start; a settings file without the field is off.
    start_plain_plans: bool,
    /// The chosen checks run once, at the merge, through the gate command; the work run does not run
    /// them (ticket simpler-process, change 3). Needs task branches and a gate command. Off at the
    /// start; a settings file without the field is off.
    checks_at_gate: bool,
    /// The merge verb pushes the base to its upstream branch after the merge commit, never with
    /// force (ticket simpler-process, change 4). Needs task branches. Off at the start; a settings
    /// file without the field is off.
    push_after_merge: bool,
    /// Dispatch writes the brief from a New ticket of the tickets board and starts its plan run
    /// itself, without triage; a question still goes to triage (ticket simpler-process-tickets,
    /// change 1). Off at the start; a settings file without the field is off.
    tickets_start_plans: bool,
    /// No triage session runs in the project: Dispatch starts the plan run of every New ticket
    /// itself, writes no line into a triage chat, and the task cards and the alerts tell the user
    /// (ticket no-triage-a-project-switch-no-triage-in). Off at the start; a settings file without
    /// the field is off.
    no_triage: bool,
}

// A settings file of an older version has a field for answers in the triage chat. Serde drops a
// field it does not know, so such a file reads without an error.
impl Default for Options {
    fn default() -> Self {
        Options { short_reports: true, triage_name: true, auto_approve: false, measure_before_plan: false, task_branches: false, ignore_tasks: false, notes_in_git: false, paused: false, start_plain_plans: false, checks_at_gate: false, push_after_merge: false, tickets_start_plans: false, no_triage: false }
    }
}

/// The command that runs the worker script. `reports` is the reports folder with `/`.
fn script_command(reports: &str) -> String {
    format!("powershell -ExecutionPolicy Bypass -File {reports}/{SCRIPT_NAME}")
}

/// The line of the "Background workers" section for a project with "Measure before the plan" on.
/// `reports` is the reports folder with `/`, `script` the command of the worker script.
fn measure_rule(reports: &str, script: &str) -> String {
    format!(
        "- Measure before the plan is on in this project. Before it writes the plan, the plan run may run the commands of `{reports}/measure-commands.txt`, and only these, each with `{script} measure <ticket-id> <n>`: `<n>` is the number of the command in that list (1 for the first command; empty lines and lines that start with `#` do not count). The script runs each command with cmd.exe in the project folder, one measuring at a time per project, and ends a command after its time limit (exit code 124). It writes the output to `{reports}/measure/<ticket-id>/<n>.log`, prints its last 40 lines and ends with the exit code of the command. `{{measure}}` in a listed command stands for the folder `{reports}/measure/<ticket-id>`; the plan run may write throw-away scripts there, and git ignores the folder. A failed or stopped command is a result, not an end. The plan then has the section Measured after TL;DR: each command, what it showed and what it means for the plan; a fault that did not reproduce is marked \"not reproduced\" in plain words, and a stopped command \"stopped after N s\". The plan run runs no other command, edits no project file, and writes only its plan and into its measure folder.
"
    )
}

/// The line of the "Background workers" section for a project with a list of checks (ticket
/// task-checks). `reports` is the reports folder with `/`.
fn checks_rule(reports: &str) -> String {
    format!(
        "- This project lists the checks that a task can run in `{reports}/checks.txt`, one per line: `name | command`, and `| always` after a check that is always recommended. The plan then has the section Checks after Acceptance: one list item per check of the list, `- [x] <name> — <reason>` when the plan run recommends it for this task and `- [ ] <name> — <reason>` when not; a check marked always is `[x]`. The task card of Dispatch shows the checks as checkboxes with the recommended ones checked, and the user changes them before Approve. Dispatch then writes the choice at the end of the plan as the section Checks chosen and into `{reports}/<ticket-id>.checks` (the name, a tab and the command of each chosen check). The work run runs each chosen check with its command as written there; a done report whose work run has no command with that text counts as working, and its ticket stays open.
"
    )
}

/// The line of the "Background workers" section for a project with "Task branches" on.
fn branches_rule(reports: &str, script: &str) -> String {
    format!(
        "- Task branches is on in this project. The plan verb of the script writes the base branch (the current branch) into `{reports}/<ticket-id>.branch`. Approve makes the branch `{BRANCH_PREFIX}<ticket-id>` from that base and checks it out in the main checkout; the work run commits on that branch, switches no branch, and never merges or pushes. A work run that stops with a question or fails first commits its own files by name on the branch as `<ticket-id> WIP`; the next run adds its own commit. When a run forgot that commit, Dispatch makes it: the changed files of the task that are not newer than the report go onto the branch as `<ticket-id> WIP (Dispatch: files of the work run)`. At each start of a run (Approve and each reply) Dispatch brings the newer commits of the base into the branch with a merge commit; when a file outside `{reports}` changed on both sides, the branch stays as it is and the prompt of the run says so. When the report is written, Dispatch switches the checkout back to the base and commits the task files there. Uncommitted changes outside the files of the task go along with the switch to the branch and back; a change in a file of the task holds the switch. The user merges the branch with the Merge button in the task card of Dispatch, and night mode of Dispatch merges a task with a done report by itself when the project has a gate command: the script merges it with `--no-ff` into the base, after the gate command of `{reports}/merge-gate.txt` passed on the merged code. Triage never runs `{script} merge`; the local settings deny it that verb.
"
    )
}

/// The line of the "Background workers" section for a project with "Start plans without decisions"
/// on (ticket simpler-process, change 2). The rule of a plain plan is `plan_is_plain`.
fn plain_rule() -> String {
    "- Start plans without decisions is on in this project: a plan whose section Decisions has no numbered item, no list item and no `HOLD:` (for example only `None.`) starts its work run without a click, with the recommended checks; the plan stays readable in the task card, and the triage chat gets one line.
".to_string()
}

/// The line of the "Background workers" section for a project with "Tickets start their plan" on
/// (ticket simpler-process-tickets). `reports` is the reports folder with `/`, `script` the command
/// of the worker script.
fn tickets_rule(reports: &str, script: &str) -> String {
    format!(
        "- Tickets start their plan is on in this project: Dispatch starts the plan run of a New ticket itself, without triage, unless the words of the ticket end with `?` or the ticket has no words. It writes the brief `{reports}/briefs/<ticket-id>.md` from the ticket (the title, the user's words and the image paths; the plan run names the constraints and the proof command), runs `{script} plan <ticket-id>`, and writes one line into the triage chat. Triage writes no brief and starts no plan run for such a ticket; it tells the user when the plan is ready, checks the result and reports, as for its own tasks. Dispatch starts no such plan run while 3 workers of the project run. A ticket whose start fails goes to triage.
"
    )
}

/// The line of the "Background workers" section for a project with "No triage" on (ticket
/// no-triage-a-project-switch-no-triage-in). `reports` is the reports folder with `/`, `script` the
/// command of the worker script.
fn no_triage_rule(reports: &str, script: &str) -> String {
    format!(
        "- No triage is on in this project: no triage session runs. Dispatch writes the brief `{reports}/briefs/<ticket-id>.md` of each New ticket of the tickets board, also of a question or a ticket with only images, and runs `{script} plan <ticket-id>` itself. Dispatch writes no line into a triage chat: the task card and the alerts of Dispatch tell the user when a plan is ready, when a worker has a question, and when a task is done or failed. The user asks questions in a plain chat, which starts no task, writes no brief and approves, revises or rejects no plan.
"
    )
}

/// The line of the "Background workers" section for a project with "Checks at the gate" on, task
/// branches on and a gate command (ticket simpler-process, change 3).
fn gate_checks_rule(reports: &str) -> String {
    format!(
        "- Checks at the gate is on in this project: the checks that the user chose run once, at the merge, through the gate command of `{reports}/merge-gate.txt`, which reads them from the file that `DISPATCH_CHECKS` names. The work run does not run them, and the report check does not look for them.
"
    )
}

/// The line of the "Background workers" section for a project with "Push after the merge" on and
/// task branches on (ticket simpler-process, change 4).
fn push_rule() -> String {
    "- Push after the merge is on in this project: after the merge commit, the Merge button (and the merge of night mode) pushes the base to its upstream branch, never with force. A refused or failed push leaves the base merged on this computer, and the task card says so. Triage pushes nothing after a merge.
".to_string()
}

/// The worker script is PowerShell, so the pipeline stops on other systems. `plan` calls this
/// first; Apply starts from a plan.
fn windows_only() -> Result<(), String> {
    if cfg!(not(windows)) {
        return Err("the worker pipeline runs on Windows only in this version".to_string());
    }
    Ok(())
}

/// A folder with `/` as a permission rule writes it: `D:/folder` is `//d/folder`. The rules of
/// this version name the task folder relative to the project (ticket second-computer); this form
/// only finds the absolute rules of an older version, which Apply removes.
fn rule_form(path: &str) -> Result<String, String> {
    match path.split_once(":/") {
        Some((drive, rest)) if drive.len() == 1 => Ok(format!("//{}/{rest}", drive.to_ascii_lowercase())),
        _ => Err(format!("the project is not on a drive: {path}")),
    }
}

/// The content of `.claude/triage.md` for the settings of a project.
fn triage_prompt(options: Options, reports: &str) -> String {
    let script = script_command(reports);
    // "Tickets start their plan" (ticket simpler-process-tickets): off, the line is empty and the
    // role is the text of the version before.
    let tickets = if options.tickets_start_plans {
        "- Tickets start their plan is on in this project: Dispatch writes the brief of a task ticket and starts its plan run itself. A line `Ticket <id>: <title> — Dispatch wrote the brief from the ticket and started the plan run itself` means that the brief and the plan run of that ticket exist already: write no brief and start no plan run for it; tell the user when the plan is ready, check the result and report, as for your own tasks. A ticket whose words end with `?` still comes to you as a message.
"
    } else {
        ""
    };
    let mut text = format!(
        "# Triage session

You are the triage session of this project. The user types tasks here.

- Follow the section \"Background workers\" in CLAUDE.md. You are \"triage\" in that section.
- You do no implementation. For each task, you classify it, write a brief, start the plan run with `{script} plan <ticket-id>`, tell the user when the plan is ready, check the result and report to the user. The user approves or rejects a plan in the task card of Dispatch, never here; Dispatch writes one line into this chat when that happened. Never run `{script} approve` yourself.
{tickets}- When you need a decision from the user, ask with the tool `AskUserQuestion`: one question, 2 to 4 options, the option that you recommend first. The chat window shows the options as buttons. Use a text question only when the options are not known.
- A worker has no question tool. When a report says `needs: decision` or `needs: permission`, tell the user that the task card of Dispatch shows the question with its options, or the Continue button; the user answers there, and the answer reaches the worker word for word. Never answer for the user. A permission prompt of a worker is different: tell the user to open that worker in the agent view.
",
    );
    if options.short_reports {
        text.push_str(
            "- Keep each message to the user short: 6 lines maximum. Give the result first, then the decisions that the user must make. Do not repeat the brief, the list of files or the list of checks. Give details only when the user asks for them.
- This limit has priority over other rules for the form of a reply.
",
        );
    }
    text
}

/// A short mark of a text. A different text gives a different mark.
fn stamp(text: &str) -> String {
    let hash = text
        .bytes()
        .fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3));
    format!("{hash:016x}")
}

/// One change that the setup makes.
#[derive(Serialize)]
pub struct Step {
    title: &'static str,
    /// The file or the folder that the step changes.
    target: String,
    done: bool,
    /// What the step adds.
    detail: String,
    /// The rules that the step can add, one checkbox each. Only the step "Working rules" has them.
    #[serde(skip_serializing_if = "Option::is_none")]
    rules: Option<Vec<&'static str>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    /// The folder of the project.
    root: String,
    /// The project is in a git repository. The button "Commit to git" needs one.
    git: bool,
    options: Options,
    steps: Vec<Step>,
    /// The text of `measure-commands.txt`, for the box under the switch "Measure before the plan".
    measure_commands: String,
    /// The text of `merge-gate.txt`, for the box under the switch "Task branches".
    merge_gate: String,
    /// The text of `checks.txt`, for the box "Checks" (ticket task-checks).
    checks: String,
}

/// The paths of one project.
pub(crate) struct Project {
    pub(crate) root: PathBuf,
    pub(crate) reports: PathBuf,
    /// The folder is in a git repository. `root` is then the top folder of the repository.
    in_git: bool,
}

/// The reply of the `project_root` command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRoot {
    root: String,
    git: bool,
    /// The project has the file with the triage role.
    triage_prompt: bool,
    /// A mark of the text of that file. A session keeps the role with which it started.
    triage_stamp: String,
    /// A new triage chat gets the name "Triage".
    triage_name: bool,
    /// The project runs without triage (ticket no-triage-a-project-switch-no-triage-in): the
    /// workspace opens without a triage chat.
    no_triage: bool,
}

impl Project {
    /// `cwd` is a folder in the project. In a git repository, the project is the top folder.
    pub(crate) fn find(cwd: &str) -> Result<Project, String> {
        let cwd = Path::new(cwd);
        if !cwd.is_dir() {
            return Err(format!("not a folder: {}", cwd.display()));
        }
        let top = git(cwd, &["rev-parse", "--show-toplevel"])
            .map(|top| PathBuf::from(top.trim().replace('/', "\\")))
            .filter(|top| top.is_dir());
        let in_git = top.is_some();
        let root = top.unwrap_or_else(|| cwd.to_path_buf());
        // The task files are in the project, so git tracks them and a clone has them, unless the
        // option "Task files in git" (`ignore_tasks`) is on: then the root `.gitignore` ignores the
        // folder. Dispatch commits them itself (`keep_tasks_committed`), and Approve does not count
        // them as changes.
        let reports = root.join(TASKS_DIR);
        Ok(Project { root, reports, in_git })
    }

    /// The reports folder of the old layout: `<project>-reports` next to the project. The step
    /// "Task files" moves it into `.dispatch`. None for a project without a parent folder.
    fn old_reports(&self) -> Option<PathBuf> {
        let (parent, name) = (self.root.parent()?, self.root.file_name()?);
        Some(parent.join(format!("{}-reports", name.to_string_lossy())))
    }

    pub(crate) fn briefs(&self) -> PathBuf {
        self.reports.join("briefs")
    }

    /// Whether the task of a worker has a report (late-crash-label). `name` is the session name
    /// that the script gives: `<ticket> [plan]`, `<ticket> [work]`, or the bare ticket id of an
    /// older script. A worker without a folder, with another name or outside a project has none.
    pub(crate) fn has_report(cwd: Option<&str>, name: Option<&str>) -> bool {
        let (Some(cwd), Some(name)) = (cwd, name) else { return false };
        let ticket = name.strip_suffix(" [plan]").or_else(|| name.strip_suffix(" [work]")).unwrap_or(name);
        if check_ticket(ticket).is_err() {
            return false;
        }
        Project::find(cwd).is_ok_and(|project| project.reports.join(format!("{ticket}.md")).is_file())
    }

    /// The planned entries of the old layout (ticket overview-backlog): one Markdown file each.
    /// The first task read makes each a ticket and removes the folder (ticket tickets).
    pub(crate) fn backlog_dir(&self) -> PathBuf {
        self.reports.join("backlog")
    }

    /// The tickets of the project (ticket tickets): one JSON event per line.
    pub(crate) fn tickets_file(&self) -> PathBuf {
        self.reports.join("tickets.jsonl")
    }

    /// A project with given folders, for the tests of other modules.
    #[cfg(test)]
    pub(crate) fn scratch(root: PathBuf, reports: PathBuf) -> Project {
        Project { root, reports, in_git: false }
    }

    /// The plans that the plan runs write, one file per ticket.
    pub(crate) fn plans(&self) -> PathBuf {
        self.reports.join("plans")
    }

    /// The options of the plan run, one argument per line. The script reads the file.
    pub(crate) fn plan_flags(&self) -> PathBuf {
        self.reports.join("plan-flags.txt")
    }

    /// The options of the work run, one argument per line. The script reads the file.
    pub(crate) fn work_flags(&self) -> PathBuf {
        self.reports.join("work-flags.txt")
    }

    /// The script that triage runs to start, resume and stop a worker.
    fn script(&self) -> PathBuf {
        self.reports.join(SCRIPT_NAME)
    }

    /// The settings file that limits the agents of a worker. The worker options name it.
    fn worker_settings(&self) -> PathBuf {
        self.reports.join("worker-settings.json")
    }

    /// The measuring commands that the plan run may run, one per line (ticket measure-before-plan).
    pub(crate) fn measure_commands_file(&self) -> PathBuf {
        self.reports.join("measure-commands.txt")
    }

    /// The scratch folder of the measuring: one folder per ticket with the logs and the throw-away
    /// scripts, and the lock file. Git ignores it through `.dispatch/.gitignore`.
    fn measure_dir(&self) -> PathBuf {
        self.reports.join("measure")
    }

    /// The ignore file of the task folder. Its line `measure/` keeps the scratch folder out of git.
    fn tasks_ignore(&self) -> PathBuf {
        self.reports.join(".gitignore")
    }

    /// The attributes file of the task folder. Its line `tickets.jsonl merge=union` joins the ticket
    /// lines of two computers.
    fn tasks_attributes(&self) -> PathBuf {
        self.reports.join(".gitattributes")
    }

    /// The ignore file of the project root. With "Task files local only" on, its line `.dispatch/`
    /// keeps the whole task folder out of git (ticket ignore-tasks).
    fn root_ignore(&self) -> PathBuf {
        self.root.join(".gitignore")
    }

    /// The lines of the root `.gitignore`, trimmed; none without the file.
    fn root_ignore_lines(&self) -> Vec<String> {
        fs::read_to_string(self.root_ignore()).unwrap_or_default().lines().map(|line| line.trim().to_string()).collect()
    }

    /// The root `.gitignore` has the line `.dispatch/`, by Dispatch or by hand.
    fn root_ignores_tasks(&self) -> bool {
        self.root_ignore_lines().iter().any(|line| line == ROOT_TASKS_IGNORE)
    }

    /// The root `.gitignore` has the line `.dispatch/` directly under the mark of Dispatch: the pair
    /// that Apply writes and removes. A line without the mark is the user's, and Dispatch leaves it.
    fn tasks_ignored_by_dispatch(&self) -> bool {
        self.root_ignore_lines().windows(2).any(|pair| pair[0] == TASKS_IGNORE_MARK && pair[1] == ROOT_TASKS_IGNORE)
    }

    /// An ignore rule of git names the local settings file, by Dispatch or by hand (a line `.claude/`
    /// ignores it too). `--no-index`: the rule counts also while git still tracks the file.
    fn local_settings_ignored(&self) -> bool {
        self.in_git && git(&self.root, &["check-ignore", "-q", "--no-index", LOCAL_SETTINGS]).is_some()
    }

    /// Git tracks the local settings file. False outside git.
    fn local_settings_tracked(&self) -> bool {
        self.in_git && git(&self.root, &["ls-files", "--", LOCAL_SETTINGS]).is_some_and(|files| !files.trim().is_empty())
    }

    /// The local settings file stays on this computer: git ignores it and does not track it. Always
    /// true outside git.
    fn local_settings_private(&self) -> bool {
        !self.in_git || (self.local_settings_ignored() && !self.local_settings_tracked())
    }

    /// Git tracks at least one file of the task folder. False outside git.
    fn tasks_tracked(&self) -> bool {
        self.in_git && git(&self.root, &["ls-files", "--", TASKS_DIR]).is_some_and(|files| !files.trim().is_empty())
    }

    /// An ignore rule of git names at least one of the notes files (ticket project-notes-in-git).
    /// `git check-ignore` with several paths exits 0 when any is ignored; `-q` takes only one path,
    /// so the output is dropped instead. False outside git.
    fn notes_ignored(&self) -> bool {
        let mut args = vec!["check-ignore", "--no-index"];
        args.extend(NOTES_FILES);
        self.in_git && git(&self.root, &args).is_some()
    }

    /// The root `.gitignore` has the mark of the notes block of Dispatch.
    fn notes_block_present(&self) -> bool {
        self.root_ignore_lines().iter().any(|line| line == NOTES_IGNORE_MARK)
    }

    /// The permitted measuring commands: the lines of the list that are not empty and do not start
    /// with `#`. The script numbers them the same way.
    fn measure_commands(&self) -> Vec<String> {
        fs::read_to_string(self.measure_commands_file())
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(str::to_string)
            .collect()
    }

    /// The time limit of a measuring command in seconds: the first line of the list that is not
    /// empty, when it is `# limit <seconds>`, else `MEASURE_LIMIT`. The script reads it the same way.
    fn measure_limit(&self) -> u32 {
        list_limit(&self.measure_commands_file(), MEASURE_LIMIT)
    }

    /// The ignore file of the task folder has the line `measure/`.
    fn measure_ignored(&self) -> bool {
        self.ignores(MEASURE_IGNORE)
    }

    /// The gate command of the merge step, one line (ticket task-branches).
    pub(crate) fn merge_gate_file(&self) -> PathBuf {
        self.reports.join("merge-gate.txt")
    }

    /// The folder of the merge lock and the gate logs. Git ignores it through `.dispatch/.gitignore`.
    fn merge_dir(&self) -> PathBuf {
        self.reports.join("merge")
    }

    /// The branch file of a ticket: its branch, its base, and the merge when it is done.
    fn branch_file(&self, ticket: &str) -> PathBuf {
        self.reports.join(format!("{ticket}.branch"))
    }

    /// The checks that a task of the project can run (ticket task-checks): one per line,
    /// `name | command`, with a third field `always` for a check that is always recommended.
    pub(crate) fn checks_file(&self) -> PathBuf {
        self.reports.join("checks.txt")
    }

    /// The checks that the user chose for a task at Approve (ticket task-checks): one line per
    /// check, the name, a tab and the command. A merge gate or a project script reads it.
    fn task_checks_file(&self, ticket: &str) -> PathBuf {
        self.reports.join(format!("{ticket}.checks"))
    }

    /// The model and the effort of the runs of a task (ticket ticket-form-optional-fields-on-a-new):
    /// one line per run, `plan <model> <effort>` (the level of the ticket) and `work <model> <effort>`
    /// (the advice of the plan or the choice of the user at Approve), `-` for no value. The worker
    /// script puts them over the options of `plan-flags.txt` and `work-flags.txt`.
    fn models_file(&self, ticket: &str) -> PathBuf {
        self.reports.join(format!("{ticket}.models"))
    }

    /// The decision of the user to take a task as done that the report check sent back (ticket
    /// take-as-done): one line, `taken: <millis> <iso time>`.
    fn taken_file(&self, ticket: &str) -> PathBuf {
        self.reports.join(format!("{ticket}.taken"))
    }

    /// The actions of the Actions panel of the project (ticket project-actions).
    pub(crate) fn actions_file(&self) -> PathBuf {
        self.reports.join("actions.json")
    }

    /// The runs of the actions, one JSON file per run (ticket project-actions).
    pub(crate) fn actions_dir(&self) -> PathBuf {
        self.reports.join("actions")
    }

    /// The checks of the list of the project, in the order of the file. Empty without the file.
    fn checks(&self) -> Vec<Check> {
        parse_checks(&fs::read_to_string(self.checks_file()).unwrap_or_default())
    }

    /// The session file of a ticket (ticket task-tokens): the Claude sessions of its runs.
    pub(crate) fn session_file(&self, ticket: &str) -> PathBuf {
        self.reports.join(format!("{ticket}.session"))
    }

    /// The log of a ticket (ticket task-log): the plan, the commands of its runs and the report.
    fn log_file(&self, ticket: &str) -> PathBuf {
        self.reports.join("logs").join(format!("{ticket}.md"))
    }

    /// The gate command: the first line of the gate file that is not empty and not a comment.
    fn merge_gate(&self) -> String {
        fs::read_to_string(self.merge_gate_file())
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty() && !line.starts_with('#'))
            .unwrap_or_default()
            .to_string()
    }

    /// The time limit of the gate command in seconds: a first line `# limit <seconds>`, else `GATE_LIMIT`.
    fn merge_gate_limit(&self) -> u32 {
        list_limit(&self.merge_gate_file(), GATE_LIMIT)
    }

    /// The ticket whose merge holds the merge lock, while the lock is younger than the time limit of
    /// the gate (a lock of a crashed merge is not shown for ever; the script removes it).
    fn merging(&self) -> Option<String> {
        let lock = self.merge_dir().join("lock");
        let age = fs::metadata(&lock).and_then(|meta| meta.modified()).ok()?.elapsed().unwrap_or_default();
        if age.as_secs() > u64::from(self.merge_gate_limit()) + 600 {
            return None;
        }
        fs::read_to_string(&lock).ok()?.split('\t').nth(1).map(|ticket| ticket.trim().to_string()).filter(|ticket| !ticket.is_empty())
    }

    /// The ignore file of the task folder has a line.
    fn ignores(&self, line: &str) -> bool {
        fs::read_to_string(self.tasks_ignore()).is_ok_and(|text| text.lines().any(|known| known.trim() == line))
    }

    /// The attributes file of the task folder has the line that joins the ticket lines.
    fn joins_tickets(&self) -> bool {
        fs::read_to_string(self.tasks_attributes()).is_ok_and(|text| text.lines().any(|known| known.trim() == TICKETS_UNION))
    }

    fn options_file(&self) -> PathBuf {
        self.reports.join("options.json")
    }

    /// The settings of the project. Without the file, each setting is on.
    pub(crate) fn options(&self) -> Options {
        fs::read_to_string(self.options_file())
            .ok()
            .and_then(|text| serde_json::from_str(text.trim_start_matches('\u{feff}')).ok())
            .unwrap_or_default()
    }

    /// The text of the file with the triage role, with `\n` at each line end.
    fn triage_prompt_text(&self) -> Option<String> {
        fs::read_to_string(self.triage_prompt()).ok().map(|text| text.replace("\r\n", "\n"))
    }

    pub(crate) fn local_settings(&self) -> PathBuf {
        self.root.join(".claude").join("settings.local.json")
    }

    pub(crate) fn settings(&self) -> PathBuf {
        self.root.join(".claude").join("settings.json")
    }

    pub(crate) fn instructions(&self) -> PathBuf {
        self.root.join("CLAUDE.md")
    }

    /// The text that tells a session that it is the triage session. The workspace gives
    /// this file to Claude Code with `--append-system-prompt-file`.
    pub(crate) fn triage_prompt(&self) -> PathBuf {
        self.root.join(".claude").join("triage.md")
    }

    /// The files that the steps write, relative to the root with `/`. "Commit to git" commits
    /// only these. The task files of `.dispatch` (briefs, plans, reports, state files and the
    /// other options files) are committed by Dispatch at each task read (`keep_tasks_committed`).
    /// With "Task files local only" on, the root `.gitignore` is a setup file too, so the commit
    /// takes its line (decision 6 of the series); git then ignores the files of `.dispatch`. The same
    /// for the line that keeps the local settings on this computer (ticket second-computer); git then
    /// ignores `.claude/settings.local.json`, so the commit leaves it out.
    fn setup_files(&self) -> Vec<&'static str> {
        let mut files = vec![
            "CLAUDE.md",
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".claude/triage.md",
            ".dispatch/worker.ps1",
            ".dispatch/plan-flags.txt",
            ".dispatch/work-flags.txt",
            ".dispatch/measure-commands.txt",
            ".dispatch/merge-gate.txt",
            ".dispatch/checks.txt",
        ];
        // Off again, the commit takes the removal of the line of Dispatch, while HEAD still has it.
        // The line of the local settings (ticket second-computer) makes it a setup file too.
        let local_line = self.root_ignore_lines().iter().any(|line| line == LOCAL_SETTINGS_MARK);
        // "Project notes in git" (ticket project-notes-in-git): the commit takes the notes that
        // exist, and the block of Dispatch or its removal. A missing file is absent from `git status`.
        let notes = self.options().notes_in_git;
        if notes {
            files.extend(NOTES_WITH_TASKS);
        }
        if self.options().ignore_tasks || local_line || notes || self.notes_block_present() || self.committed_tasks_ignore() {
            files.push(".gitignore");
        }
        files
    }

    /// The root `.gitignore` of HEAD has a line of Dispatch under its mark: the task folder, or the
    /// local settings, or the block of the project notes.
    fn committed_tasks_ignore(&self) -> bool {
        self.in_git
            && git(&self.root, &["show", "HEAD:.gitignore"]).is_some_and(|text| {
                let lines: Vec<&str> = text.lines().map(str::trim).collect();
                lines.contains(&NOTES_IGNORE_MARK)
                    || lines.windows(2).any(|pair| {
                        (pair[0] == TASKS_IGNORE_MARK && pair[1] == ROOT_TASKS_IGNORE) || (pair[0] == LOCAL_SETTINGS_MARK && pair[1] == LOCAL_SETTINGS)
                    })
            })
    }

    /// The reports folder as `CLAUDE.md`, the triage role, the rules and the options files give
    /// it: `.dispatch`, relative to the project root (ticket second-computer). Triage and the workers
    /// start in the project root, so the same text works in a clone on another path or computer.
    fn reports_text(&self) -> String {
        TASKS_DIR.to_string()
    }

    /// The reports folder as a permission rule writes it: relative to the project, as Claude Code
    /// takes a rule path without `//` and `~/` from the folder that the session starts in.
    fn rule_path(&self) -> String {
        self.reports_text()
    }

    /// The texts by which a permission rule of an older version names a reports folder with its
    /// absolute path: the folder of the old layout and the task folder of this project, each as the
    /// script path and as the rule path, with a `/` at its end. Apply removes such rules.
    fn old_rule_texts(&self) -> Vec<String> {
        let mut texts = Vec::new();
        for folder in self.old_reports().into_iter().chain([self.reports.clone()]) {
            let text = folder.to_string_lossy().replace('\\', "/");
            texts.extend(rule_form(&text).ok().map(|rule| format!("{rule}/")));
            texts.push(format!("{text}/"));
        }
        texts
    }

    /// The permission rules that let triage run the worker script and check the workers, and
    /// let each session read and write the reports, without a prompt.
    fn allow_rules(&self) -> Result<Vec<String>, String> {
        let reports = self.reports_text();
        let rule_path = self.rule_path();
        Ok(vec![
            format!("Bash({} *)", script_command(&reports)),
            "Bash(claude agents --json --all)".to_string(),
            "Bash(claude logs *)".to_string(),
            format!("Edit({rule_path}/**)"),
            format!("Read({rule_path}/**)"),
        ])
    }

    /// The folders outside the project that triage may read without a prompt: the job folders of
    /// the background sessions, where a worker keeps the screenshots of its visual test (Claude
    /// Code 2.1.319 asks before each read outside the working directories, and triage then waits
    /// at a prompt that the chat view of Dispatch cannot show as a question of triage). Also the
    /// folder of the images that the user pastes into Dispatch: Claude Code gets their paths as
    /// text and reads them (2026-11-08: a prompt for each pasted image).
    fn extra_directories(&self) -> Vec<String> {
        let mut dirs: Vec<String> = std::env::var("USERPROFILE")
            .map(|home| vec![Path::new(&home).join(".claude").join("jobs").to_string_lossy().into_owned()])
            .unwrap_or_default();
        if let Some(pasted) = PASTED_DIR.get() {
            dirs.push(pasted.to_string_lossy().into_owned());
        }
        dirs
    }

    /// The rule that keeps triage from the approve verb of the script: only the Approve button of
    /// Dispatch starts a work run. A deny rule wins over the allow rule above. The app runs the
    /// script outside Claude Code, so the rule does not touch it.
    /// With "Task branches" on, the merge verb is denied too: only the Merge button merges.
    fn deny_rules(&self) -> Vec<String> {
        let script = script_command(&self.reports_text());
        let mut rules = vec![format!("Bash({script} approve *)")];
        if self.options().task_branches {
            rules.push(format!("Bash({script} merge *)"));
        }
        rules
    }

    /// The text of the section under its heading and its mark line.
    pub(crate) fn section_body(&self) -> String {
        let reports = self.reports_text();
        let script = script_command(&reports);
        // With the switch off this line is empty, so the section is the text of the version before.
        let measure = if self.options().measure_before_plan { measure_rule(&reports, &script) } else { String::new() };
        // The same for "Task branches": off, the section is the text of the version before.
        let branches = if self.options().task_branches { branches_rule(&reports, &script) } else { String::new() };
        // A project without a list of checks (ticket task-checks): the section is the text of the version before.
        let checks = if self.checks().is_empty() { String::new() } else { checks_rule(&reports) };
        // The three switches of ticket simpler-process: off, each line is empty and the section is
        // the text of the version before.
        let options = self.options();
        let plain = if options.start_plain_plans { plain_rule() } else { String::new() };
        let gate_checks = if options.checks_at_gate && options.task_branches && !self.merge_gate().is_empty() { gate_checks_rule(&reports) } else { String::new() };
        let push = if options.push_after_merge && options.task_branches { push_rule() } else { String::new() };
        // "Tickets start their plan" (ticket simpler-process-tickets): off, the line is empty.
        let tickets = if options.tickets_start_plans { tickets_rule(&reports, &script) } else { String::new() };
        // "No triage" (ticket no-triage-a-project-switch-no-triage-in): off, the line is empty.
        let no_triage = if options.no_triage { no_triage_rule(&reports, &script) } else { String::new() };
        // The same for "Task files local only" (ticket ignore-tasks): off, the sentence of the version before.
        let tasks_git = if self.options().ignore_tasks {
            format!("git ignores `{reports}/`: the task files stay on this computer, and a clone has none")
        } else {
            format!("Dispatch commits the files of `{reports}/` itself")
        };
        format!(
            "- A task is two runs of one worker. The plan run reads the code and writes a plan. The work run is a new session that reads the brief and the approved plan and executes the plan. Triage starts and resumes a worker only with the script `{reports}/{SCRIPT_NAME}`, never with `claude --bg` or `claude --resume` directly. A worker works in the main checkout (`worktree.bgIsolation` is `none`).
- Triage writes each brief to `{reports}/briefs/<ticket-id>.md`: the user's words, the constraints, and the command that proves the work. The brief says nothing about the approach; the plan run decides that. A ticket message with the block `Part N of M of ticket <id>` is a part of that ticket: triage copies the block into the brief as the section `## Parent and earlier parts`, after the user's words.
- A message that Dispatch sends from its tickets board starts with the line `Ticket <id>: <title>`. Triage uses that id as the ticket id of the task. Dispatch keeps the tickets file `{reports}/tickets.jsonl`; triage and the workers do not edit it.
{tickets}{no_triage}- `{script} plan <ticket-id>` starts the plan run on the options in `{reports}/plan-flags.txt`, with the model and the effort of `{reports}/<ticket-id>.models` when it has them (the level of the ticket): without the Edit tool, without the Agent tool and without a prompt; its Write tool may write only into `{reports}/plans/`. The plan run writes the plan to `{reports}/plans/<ticket-id>.md`, changes nothing else, and ends its turn.
{measure}- A plan has these sections: Summary (3 lines maximum: what changes, how many files, how many decisions and whether one is `HOLD`; the task card of Dispatch shows these lines); Goal; TL;DR (2 to 4 lines in plain words for the user, 25 words maximum each: what changes for the user and why, everyday words, few technical names; the Decisions window shows them under the Goal); Acceptance (commands with the expected output); Files to change (each with the symbol or an anchor line, the change and the reason); Files read (one fact each); Notes for the work run (the facts from the code that the other sections do not hold, because the work run starts without the context of the plan run: how the touched code works, why an anchor was chosen, traps it saw, and the command that showed a fact; one fact per line, 15 lines maximum); Steps; Decisions (each a numbered item with its question, and under it one list item per option, because Dispatch shows each option as a button: first `- Default:` with the recommended choice, or `- HOLD:` instead when only the user takes it, then at least one real alternative as `- Other:`; each option one short line, its reason after it as `Recommended: …` or `Not recommended: …`; each question, option and reason in everyday words for the user, who does not read the code: what changes for the user and what the user sees or does, not how the code does it; no file, function or command names and no terms of the code, or a short explanation of a term that must stay; the technical detail goes into Files to change, Notes for the work run or Steps; a question 20 words maximum and an option 15 words maximum, its reason not counted; for example, not `No: they follow the same rule; Setup pipeline still offers Commit to git` but `No, these files stop no task; you can still commit them in Setup pipeline`; the word HOLD stands in no other line of this section); Do not touch; Size (files); Work run (the advice of the plan run for the work run of this task: the line `model: <model>` (fable, opus, sonnet or haiku), the line `effort: <effort>` (low, medium, high, xhigh or max), then one line with the reason in plain words; the task card of Dispatch shows the advice at Approve, the user can change it, and the work run uses the result); Parts (optional: only when the work is too large for one work run, and never in the plan of a part: the Steps of the plan are the first piece, and the parts follow in their order after its work run; each part a numbered item `N. <title>` with the list lines `Level:` (simple, medium or hard), `Type:` (fix, feature, refactor or content), `Goal:` and the optional lines `Why:`, `Done when:`, `Do not change:`, `Context:`, `What I see:` and `What I expect:`; the task card of Dispatch shows the parts before Approve, and Approve opens one Backlog ticket per part, linked to the ticket of the plan; when a part is done, Dispatch moves the next one to New). No code in a plan.
{checks}{gate_checks}- When the plan run is done, triage tells the user that the plan is ready. The user reads the plan in the task card of Dispatch and clicks Approve or Reject there; only that click is the yes. Dispatch runs `{script} approve <ticket-id>`, which starts the work run as a new session on the options in `{reports}/work-flags.txt`, with the model and the effort of `{reports}/<ticket-id>.models` when it has them, with the brief, the plan and the user's decisions as its input, and writes one line into the triage chat. Triage never runs approve itself; the local settings deny it that verb. The script refuses when an uncommitted change outside `{reports}/` touches a file of the task (a path of the section Files to change of its plan, or a file that its task branch changed), when the worker still runs, or when the task was stopped; other uncommitted changes stay where they are and hold no task ({tasks_git}).
{plain}- The work run follows the plan. A deviation goes into the report, not into the code. The worker ends with one local commit on the current branch, with the ticket id in the message. It commits only the files that it changed, each by name, never with `git add -A`, `git add .` or `git commit -a`, and leaves every other change as it is. It never pushes or merges. The user decides the push.
{branches}{push}- A worker ends with a report in `{reports}/<ticket-id>.md`. The report starts with four lines, each `key: value`: `state` (`done`, `needs-decision` or `failed`), `needs` (`nothing`, `decision` or `permission`), `files` (the changed files, or `none`) and `plan` (the plan file). Then the sections `## What changed`, `## Why`, `## Files`, `## Verification`, `## Follow-ups`, and `## Questions` when needed. Verification says in the worker's own words what it ran and what that showed. Dispatch reads the commands of the work run from the transcripts and shows each under the report with its exit code and its last lines. A done report whose work run ran no command, or without a run of a chosen check, counts as working, and its ticket stays open.
- A worker starts no session and sends no message to a chat. It has no question tool. A question for the user goes into the report under the heading `## Questions`: numbered items, each with its options as list items, the recommended option first. Each option is one short line, because Dispatch shows it as a button and sends it back word for word; the question and each option follow the rule of plain words of the Decisions of a plan; the details stand above the questions. The worker then writes `state: needs-decision` and `needs: decision` and ends its turn, also when the question is about a permission. `needs: permission` means: a refused tool call stopped the work, the report names the refused call and the rule it needs, and the work goes on with a follow-up `Continue` once the user changed the rule. The user answers in the task card of Dispatch, and the answer arrives as a follow-up `Answer to question N: <option>`. An answered question never comes back unchanged: after the answer the worker takes the question out of its report or writes what it decided and did, and ends with `state: done` or a new question. A follow-up `Continue` after an answer means: take the answers as given and go on.
- A follow-up goes through `{script} reply <ticket-id> \"<message>\"` and quotes the user's words exactly. The script takes the options of the run from `{reports}/<ticket-id>.state`.
- Triage does no implementation. It classifies, writes briefs, starts the plan run, shows the plan, relays the yes, checks results and reports to the user.
- The session of a worker is named `<ticket-id> [plan]` in its plan run and `<ticket-id> [work]` in its work run; a worker of an older script has the bare ticket id. Triage checks workers with `claude agents --json --all` or `{script} status`: `done` = finished, `blocked` with `status: waiting` = at a permission prompt, `blocked` with `status: idle` = the turn ended with a question that stands in the report (`{script} status` says `done` then), `failed` or `stopped` = ended badly. It reads the plan or the report file first, `claude logs <id>` second.
- Triage runs at most 3 workers, and at most one in its work run. Triage does not poll: Dispatch writes one line into the triage chat when a worker is done, blocked or failed, when the user approved or rejected a plan, and when the user answered a question.
- Triage never answers a worker's question or permission prompt with its own words. A question is answered in the task card of Dispatch; a permission prompt is answered in the agent view.
"
        )
    }

    /// The section for `CLAUDE.md`: the heading, the mark of the text, the text.
    fn section(&self) -> String {
        let body = self.section_body();
        format!("{SECTION_HEADING}\n{SECTION_STAMP_PREFIX}{} -->\n{body}", stamp(&body))
    }

    /// The pipeline in the words that `CLAUDE.md` gets: the "Background workers" section and the
    /// working rules. The check of the rules (`rules_check`) gives this text to the model.
    pub(crate) fn pipeline_description(&self) -> String {
        format!("{SECTION_HEADING}\n{}\n{}", self.section_body(), rules_section(&(0..RULES.len()).collect::<Vec<_>>()))
    }
}

/// One check of the list of a project (ticket task-checks): a test, a test suite or a gate.
#[derive(Clone, PartialEq, Debug)]
struct Check {
    name: String,
    command: String,
    /// The list marks it as always recommended.
    always: bool,
}

/// Reads the list of checks (user decision 1 of task-checks): `name | command`, with a last field
/// `always` for a check that is always recommended. The name ends at the first `|`; a command may
/// hold `|` itself, so only a last field that is exactly `always` is the mark. An empty line and a
/// line that starts with `#` are skipped, and so are a line without a name or a command and a
/// second check with the same name.
fn parse_checks(text: &str) -> Vec<Check> {
    let mut checks: Vec<Check> = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((name, rest)) = line.split_once('|') else { continue };
        // A tab would cut the line of the task file of the checks.
        let (name, mut command, mut always) = (name.trim().replace('\t', " "), rest.trim(), false);
        if let Some((head, mark)) = command.rsplit_once('|') {
            if mark.trim().eq_ignore_ascii_case("always") {
                command = head.trim();
                always = true;
            }
        }
        if name.is_empty() || command.is_empty() || checks.iter().any(|check| check.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        checks.push(Check { name, command: command.to_string(), always });
    }
    checks
}

/// One check of the project for a task, for the checkboxes of the Plan ready card (ticket
/// task-checks): from the list of the project, the section `Checks` of the plan and, after
/// Approve, the section `Checks chosen`.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CheckInfo {
    name: String,
    command: String,
    /// The list of the project marks it as always recommended.
    always: bool,
    /// Always, or ticked by the plan run in the section `Checks`: the box starts checked.
    recommended: bool,
    /// The reason that the plan gives after the name, or empty.
    reason: String,
    /// The choice of the user from the section `Checks chosen`; none before Approve.
    chosen: Option<bool>,
}

/// The heading of the section that Approve writes at the end of a plan (ticket task-checks).
const CHECKS_CHOSEN_HEADING: &str = "## Checks chosen";

/// The ticked check lines of a plan section: `- [x] name — reason` or `- [ ] name: reason`, the
/// name maybe in backticks. Gives the name, whether it is ticked, and the text after the name.
fn check_lines(text: &str, title: &str) -> Vec<(String, bool, String)> {
    let mut lines = Vec::new();
    for line in section_text(text, title) {
        let item = line.trim();
        let item = item.strip_prefix("- ").or_else(|| item.strip_prefix("* ")).unwrap_or(item).trim_start();
        let (ticked, rest) = if let Some(rest) = item.strip_prefix("[x]").or_else(|| item.strip_prefix("[X]")) {
            (true, rest)
        } else if let Some(rest) = item.strip_prefix("[ ]") {
            (false, rest)
        } else {
            continue;
        };
        let rest = rest.trim();
        let cut = [" — ", " – ", " - ", ": "].iter().filter_map(|mark| rest.find(mark).map(|at| (at, mark.len()))).min();
        let (name, after) = match cut {
            Some((at, len)) => (&rest[..at], rest[at + len..].trim()),
            None => (rest, ""),
        };
        let name = name.trim().trim_matches('`').trim().trim_end_matches(':').trim();
        if !name.is_empty() {
            lines.push((name.to_string(), ticked, after.to_string()));
        }
    }
    lines
}

/// The checks of a task (ticket task-checks): each check of the list of the project, recommended
/// when the list marks it always or the section `Checks` of the plan ticks it, and chosen as the
/// section `Checks chosen` says, when the plan has it. A name that is not in the list is left out.
fn plan_checks(text: &str, list: &[Check]) -> Vec<CheckInfo> {
    let planned = check_lines(text, "Checks");
    let decided = has_heading(text, &CHECKS_CHOSEN_HEADING[3..]);
    let chosen = check_lines(text, &CHECKS_CHOSEN_HEADING[3..]);
    list.iter()
        .map(|check| {
            let named = |lines: &[(String, bool, String)]| lines.iter().find(|(name, _, _)| name.eq_ignore_ascii_case(&check.name)).cloned();
            let plan = named(&planned);
            CheckInfo {
                name: check.name.clone(),
                command: check.command.clone(),
                always: check.always,
                recommended: check.always || plan.as_ref().is_some_and(|(_, ticked, _)| *ticked),
                reason: plan.map(|(_, _, reason)| reason).unwrap_or_default(),
                chosen: decided.then(|| named(&chosen).is_some_and(|(_, ticked, _)| ticked)),
            }
        })
        .collect()
}

/// The name and the command of each check that the user chose (ticket task-checks).
fn chosen_checks(checks: &[CheckInfo]) -> Vec<(String, String)> {
    checks.iter().filter(|check| check.chosen == Some(true)).map(|check| (check.name.clone(), check.command.clone())).collect()
}

/// The time limit of the commands of a list file: the first line of the file that is not empty,
/// when it is `# limit <seconds>`, else `default`. The script reads it the same way.
fn list_limit(path: &Path, default: u32) -> u32 {
    let text = fs::read_to_string(path).unwrap_or_default();
    let first = text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    first
        .strip_prefix('#')
        .map(str::trim_start)
        .and_then(|rest| rest.strip_prefix("limit"))
        .filter(|rest| rest.starts_with(char::is_whitespace))
        .and_then(|rest| rest.trim().parse().ok())
        .unwrap_or(default)
}

/// The worker script. Setup writes it into the reports folder; triage runs it with PowerShell.
/// The prompt is the first argument of each `claude` command, because `--tools` and
/// `--allowedTools` take a list and would take a prompt that follows them as a list item.
const WORKER_SCRIPT: &str = r##"<#
Dispatch worker script. Triage starts and resumes a worker only through this file.
  plan <ticket-id>              start the plan run (plan-flags.txt); state: planning
  approve <ticket-id>           start the work run as a new session (work-flags.txt) that reads the brief and the plan; state: working
  reply <ticket-id> <message>   send the user's words to the worker; the state picks the options
  status                        the tasks with their state and the state of their worker
  stop <ticket-id>              stop the worker of a task; state: stopped
  measure <ticket-id> <n>       run command n of measure-commands.txt for the plan run (Measure before the plan)
  merge <ticket-id>             merge the task branch into its base after the gate command (Task branches; Dispatch only);
                                with Push after the merge, then push the base to its upstream branch, never with force
Exit codes: 0 done, 2 refused (the reason is on stderr), 124 a measuring command stopped at its
time limit, other: the exit code of claude or of the measuring command.
The gate command of merge gets DISPATCH_TICKET (the ticket id) and DISPATCH_CHECKS (the path of
<ticket-id>.checks: the checks that the user chose, one line each, the name, a tab and the command).
<ticket-id>.models, when it exists, gives the model and the effort of a run of the task: a line
`plan <model> <effort>` or `work <model> <effort>` replaces those of the options file.
The script finds the project from its own folder, and the options files name paths relative to the
project, so a clone on another path or computer needs no change.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('plan', 'approve', 'reply', 'status', 'stop', 'measure', 'merge')]
  [string]$Verb,
  [Parameter(Position = 1)]
  [string]$Id,
  [Parameter(Position = 2, ValueFromRemainingArguments = $true)]
  [string[]]$Message
)

$ErrorActionPreference = 'Stop'
$Reports = $PSScriptRoot
# The reports folder is the folder .dispatch of the project.
$Project = Split-Path -Parent $Reports

function Refuse([string]$Why) {
  [Console]::Error.WriteLine("refused: $Why")
  exit 2
}

function Need-Id {
  if (-not $Id) { Refuse "the verb $Verb needs a ticket id" }
}

# The options of a run, one argument per line. Setup pipeline writes the files. The settings file
# after --settings is relative to the project; claude gets it as an absolute path.
function Read-Flags([string]$Name) {
  $file = Join-Path $Reports $Name
  if (-not (Test-Path -LiteralPath $file)) { Refuse "$file is missing; run Setup pipeline" }
  $lines = @(Get-Content -LiteralPath $file | Where-Object { $_.Trim() -ne '' })
  for ($at = 1; $at -lt $lines.Count; $at++) {
    $value = $lines[$at].Trim()
    if ($lines[$at - 1].Trim() -eq '--settings' -and -not [IO.Path]::IsPathRooted($value)) {
      $lines[$at] = [IO.Path]::GetFullPath((Join-Path $Project $value))
    }
  }
  $lines
}

# The options of a run with the model and the effort of the task: the line of the run in
# <ticket-id>.models (`plan <model> <effort>` or `work <model> <effort>`, `-` for no value) replaces
# the value after --model and after --effort, or goes in front when the options file lacks it.
function Run-Flags([string]$Run) {
  $lines = @(Read-Flags "$Run-flags.txt")
  $file = Join-Path $Reports "$Id.models"
  if (-not $Id -or -not (Test-Path -LiteralPath $file)) { return $lines }
  $line = @(Get-Content -LiteralPath $file | Where-Object { ($_.Trim() -split '\s+')[0] -eq $Run }) | Select-Object -First 1
  if (-not $line) { return $lines }
  $parts = @($line.Trim() -split '\s+')
  $front = @()
  foreach ($pair in @(@('--model', $parts[1]), @('--effort', $parts[2]))) {
    $value = "$($pair[1])"
    if ($value -notmatch '^[A-Za-z0-9._\[\]-]+$' -or $value -eq '-') { continue }
    $at = [Array]::IndexOf([string[]]($lines | ForEach-Object { $_.Trim() }), $pair[0])
    if ($at -ge 0 -and $at + 1 -lt $lines.Count) { $lines[$at + 1] = $value } else { $front += @($pair[0], $value) }
  }
  @($front) + @($lines)
}

function State-Path { Join-Path $Reports "$Id.state" }
function Get-State {
  if (Test-Path -LiteralPath (State-Path)) { (Get-Content -LiteralPath (State-Path) -Raw).Trim() } else { '' }
}
function Set-State([string]$State) {
  [IO.File]::WriteAllText((State-Path), "$State`n")
}

# The background sessions, as `claude agents --json --all` gives them.
function Get-Workers {
  $text = (& claude agents --json --all) -join "`n"
  if ($LASTEXITCODE -ne 0) { Refuse "claude agents failed with exit code $LASTEXITCODE" }
  @($text | ConvertFrom-Json)
}

# Claude Code marks a session that ended its turn with a question as blocked, like a session at a
# permission prompt. Only the prompt waits (status waiting); the question is in the report, and
# the session is done: a resume of it is no copy.
function Worker-State($Worker) {
  if ($null -eq $Worker) { return '' }
  $state = "$($Worker.state)"
  if (-not $state) { return "$($Worker.status)" }
  if ($state -eq 'blocked' -and "$($Worker.status)" -ne 'waiting') { return 'done' }
  $state
}

# The session names of a ticket: the plan run is "<ticket> [plan]", the work run "<ticket> [work]",
# so the agent view of Claude Code tells them apart. A worker of an older script has the bare id.
function Run-Name([string]$Run) { "$Id [$Run]" }

# The newest worker of a ticket, of either run. With a run: the newest worker named "<ticket> [<run>]"
# when one exists, else the newest of any name (a worker of an older script has the bare id). The
# plan run and the work run are two sessions (ticket work-fresh-session), and a follow-up of the work
# run must resume the work session, never the plan session.
function Find-Worker($Workers, [string]$Ticket, [string]$Run) {
  $names = @($Ticket, "$Ticket [plan]", "$Ticket [work]")
  $mine = @($Workers | Where-Object { $names -contains $_.name } | Sort-Object { $_.startedAt })
  if ($Run) {
    $named = @($mine | Where-Object { $_.name -eq "$Ticket [$Run]" })
    if ($named.Count -gt 0) { $mine = $named }
  }
  if ($mine.Count -eq 0) { return $null }
  $mine[$mine.Count - 1]
}

# Approve starts the work run as a new session and resumes nothing. It still refuses a stopped task,
# and a worker of the ticket that still runs or waits at a prompt: the plan run must end first.
# Without a worker of the ticket in the list (an ended or cleaned plan session) approve goes on.
function Approve-Check {
  if ((Get-State) -eq 'stopped') { Refuse "the task $Id was stopped; start a new task" }
  $worker = Find-Worker (Get-Workers) $Id
  if ($null -eq $worker) { return }
  $state = Worker-State $worker
  if ($state -eq 'working' -or $state -eq 'blocked') {
    Refuse "the worker $Id still runs ($state); the work run starts when it has ended. A permission prompt is answered in the agent view: claude attach $($worker.id)"
  }
}

# A resume of a session that still runs starts a copy of it. Only a finished session is resumed,
# and never one of a task that was stopped: a stopped task is ended, the next task starts clean.
# $Run picks the session of that run.
function Resume-Target([string]$Run) {
  if ((Get-State) -eq 'stopped') { Refuse "the task $Id was stopped; start a new task" }
  $worker = Find-Worker (Get-Workers) $Id $Run
  if ($null -eq $worker) { Refuse "no worker named $Id on this computer. A run that started on another computer cannot be resumed here: start the task again, or answer on the computer where it ran" }
  $state = Worker-State $worker
  if ($state -eq 'working' -or $state -eq 'blocked') {
    Refuse "the worker $Id still runs ($state); a resume now would start a copy. A permission prompt is answered in the agent view: claude attach $($worker.id)"
  }
  if (-not $worker.sessionId) { Refuse "the worker $Id has no session id" }
  $worker
}

# Runs claude in the project folder: a worker reads the settings and the allow rules of the folder
# it starts in, not of the folder the caller is in. A failure sets the state back to $StateOnFailure
# when one is given, so the task card of Dispatch comes back with the error, and ends the script
# with the exit code of claude; a claude that is not found counts as exit code 1. A failure also
# checks out $BranchOnFailure again when one is given: the branch before the task branch. Gives the
# lines that claude printed (claude --bg prints the job id) and writes them on to the caller.
function Run-Claude([string[]]$Arguments, [string]$StateOnFailure, [string]$BranchOnFailure) {
  Push-Location -LiteralPath $Project
  $global:LASTEXITCODE = 0
  $printed = @(& claude @Arguments)
  $ok = $?
  $code = $LASTEXITCODE
  Pop-Location
  foreach ($line in $printed) { [Console]::Out.WriteLine("$line") }
  if ($ok -and $code -eq 0) { return ,$printed }
  if ($code -eq 0) { $code = 1 }
  if ($StateOnFailure) { Set-State $StateOnFailure }
  if ($BranchOnFailure) { Invoke-Git @('checkout', '-q', $BranchOnFailure) | Out-Null }
  exit $code
}

# The session file of a ticket (ticket task-tokens): one line "<run> <session id>" per Claude session
# of the task, in order. Dispatch sums the tokens of these sessions for the task card. The worker of
# the job id that claude printed gives the session id; without it, the newest worker of the run name.
# The work run is its own session (ticket work-fresh-session), so Approve adds its line. A resume of
# the same session adds nothing; a resume that starts a copy adds the copy. A missing id is a
# warning, no refusal: the run has started.
function Session-Path { Join-Path $Reports "$Id.session" }
function Save-Session([string]$Run, [string[]]$Printed) {
  $words = @($Printed | ForEach-Object { "$_" -split '\s+' } | Where-Object { $_ })
  $workers = @()
  try {
    $text = (& claude agents --json --all) -join "`n"
    if ($LASTEXITCODE -eq 0) { $workers = @($text | ConvertFrom-Json | ForEach-Object { $_ }) }
  } catch { }
  $worker = @($workers | Where-Object { $_.id -and $words -contains "$($_.id)" }) | Select-Object -First 1
  if ($null -eq $worker) {
    $named = @($workers | Where-Object { $_.name -eq (Run-Name $Run) } | Sort-Object { $_.startedAt })
    if ($named.Count -gt 0) { $worker = $named[$named.Count - 1] }
  }
  if ($null -eq $worker -or -not $worker.sessionId) {
    [Console]::Error.WriteLine("warning: no session id for $(Run-Name $Run); the task card counts no tokens of this run")
    return
  }
  $session = "$($worker.sessionId)"
  $file = Session-Path
  $known = if (Test-Path -LiteralPath $file) { @(Get-Content -LiteralPath $file) } else { @() }
  if (@($known | Where-Object { (("$_".Trim()) -split '\s+')[-1] -eq $session }).Count -eq 0) {
    [IO.File]::AppendAllText($file, "$Run $session`n")
  }
}

# The setting "Measure before the plan" of the project in options.json; off without the file or the field.
function Measure-On {
  $file = Join-Path $Reports 'options.json'
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  try { return [bool]((Get-Content -LiteralPath $file -Raw) | ConvertFrom-Json).measureBeforePlan } catch { return $false }
}

# One boolean setting of the project in options.json (ticket simpler-process); off without the file
# or the field.
function Option-On([string]$Name) {
  $file = Join-Path $Reports 'options.json'
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  try { return [bool]((Get-Content -LiteralPath $file -Raw) | ConvertFrom-Json).$Name } catch { return $false }
}

# The command lines of a list file of .dispatch: the lines that are not empty and do not start with #.
# Setup pipeline writes the files; command n is the line n of this list.
function Command-Lines([string]$Name) {
  $file = Join-Path $Reports $Name
  if (-not (Test-Path -LiteralPath $file)) { return @() }
  @(Get-Content -LiteralPath $file | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' -and -not $_.StartsWith('#') })
}

# The time limit of the commands of a list file in seconds: a first line "# limit <seconds>", else $Default.
function Command-Limit([string]$Name, [int]$Default) {
  $file = Join-Path $Reports $Name
  if (Test-Path -LiteralPath $file) {
    $first = @(Get-Content -LiteralPath $file | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1)
    if ($first.Count -gt 0 -and $first[0].Trim() -match '^#\s*limit\s+(\d+)\s*$') { return [int]$Matches[1] }
  }
  $Default
}

# The permitted measuring commands and their time limit (Measure before the plan).
function Measure-Commands { Command-Lines 'measure-commands.txt' }
function Measure-Limit { Command-Limit 'measure-commands.txt' 600 }

# The locks of the project: one measuring at a time (projects use fixed test ports), and one merge at
# a time. A lock file holds the process id, the ticket and the time. A lock whose process is gone is
# removed.
function Lock-Path { Join-Path $Reports 'measure\lock' }
function Merge-Lock { Join-Path $Reports 'merge\lock' }

# The ticket of a lock whose process still runs, else $null.
function Lock-Holder([string]$Lock) {
  if (-not (Test-Path -LiteralPath $Lock)) { return $null }
  $holder = "$(Get-Content -LiteralPath $Lock -Raw -ErrorAction SilentlyContinue)".Trim() -split "`t"
  $other = 0
  if ([int]::TryParse($holder[0], [ref]$other) -and $null -ne (Get-Process -Id $other -ErrorAction SilentlyContinue)) {
    if ($holder.Count -gt 1) { return $holder[1] }
    return 'another task'
  }
  Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue
  $null
}

# Takes a lock. A second caller waits up to $Limit seconds (a check every 5 s), then is refused.
function Enter-Lock([string]$Lock, [int]$Limit, [string]$What) {
  $dir = Split-Path -Parent $Lock
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $deadline = (Get-Date).AddSeconds($Limit)
  while ($true) {
    # A move to a name that exists fails, so only one caller gets the lock, and it is never half written.
    $mine = "$Lock.$PID"
    [IO.File]::WriteAllText($mine, "$PID`t$Id`t$((Get-Date).ToString('o'))`n")
    try { [IO.File]::Move($mine, $Lock); return } catch { Remove-Item -LiteralPath $mine -Force -ErrorAction SilentlyContinue }
    $owner = Lock-Holder $Lock
    if (-not $owner) { continue }
    $left = ($deadline - (Get-Date)).TotalSeconds
    if ($left -le 0) {
      $held = if ($Limit -gt 0) { "; it held the lock for longer than the limit of $Limit s" } else { '' }
      Refuse "another $What of this project runs (task $owner)$held"
    }
    Start-Sleep -Milliseconds ([int](1000 * [Math]::Min(5, $left)))
  }
}
function Exit-Lock([string]$Lock) {
  $holder = "$(Get-Content -LiteralPath $Lock -Raw -ErrorAction SilentlyContinue)".Trim() -split "`t"
  if ($holder[0] -eq "$PID") { Remove-Item -LiteralPath $Lock -Force -ErrorAction SilentlyContinue }
}

# Runs git in the project folder. Gives the exit code and the lines of stdout and stderr. Windows
# PowerShell turns the stderr lines of a native command into errors, so the preference is local.
function Invoke-Git([string[]]$A) {
  $ErrorActionPreference = 'Continue'
  $lines = @(& git -C $Project @A 2>&1 | ForEach-Object { "$_" })
  [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $lines; Text = ($lines -join "`n").Trim() }
}

# The setting "Task branches" of the project in options.json; off without the file or the field.
function Branches-On {
  $file = Join-Path $Reports 'options.json'
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  try { return [bool]((Get-Content -LiteralPath $file -Raw) | ConvertFrom-Json).taskBranches } catch { return $false }
}

# The setting "Task files local only" of the project in options.json; off without the file or the field.
function Tasks-Local {
  $file = Join-Path $Reports 'options.json'
  if (-not (Test-Path -LiteralPath $file)) { return $false }
  try { return [bool]((Get-Content -LiteralPath $file -Raw) | ConvertFrom-Json).ignoreTasks } catch { return $false }
}

# The branch that the main checkout is on; empty when HEAD is detached or the folder is no repository.
function Current-Branch {
  $result = Invoke-Git @('symbolic-ref', '--short', '-q', 'HEAD')
  if ($result.Code -ne 0) { return '' }
  $result.Text
}

# The branch file of a ticket: "branch: task/<ticket>", "base: <branch>", and "merge: done <sha> <time>"
# after the merge; with Push after the merge also "push: pushed <remote>/<branch> <time>", "push: failed
# <reason>" or "push: no-upstream". $null without the file.
function Branch-Path([string]$Ticket) { Join-Path $Reports "$Ticket.branch" }
function Read-BranchFile([string]$Ticket) {
  $file = Branch-Path $Ticket
  if (-not (Test-Path -LiteralPath $file)) { return $null }
  $info = @{ branch = ''; base = ''; merge = ''; push = '' }
  foreach ($line in Get-Content -LiteralPath $file) {
    if ($line -match '^\s*(branch|base|merge|push):\s*(.*?)\s*$') { $info[$Matches[1]] = $Matches[2] }
  }
  [pscustomobject]$info
}
function Write-BranchFile([string]$Branch, [string]$Base, [string]$Merge, [string]$Push = '') {
  $text = "branch: $Branch`nbase: $Base`n"
  if ($Merge) { $text += "merge: $Merge`n" }
  if ($Push) { $text += "push: $Push`n" }
  [IO.File]::WriteAllText((Branch-Path $Id), $text)
}

# The branch file of the ticket, written when it is missing or names a merged branch. The base is the
# current branch; while the checkout is on the branch of another task, the base of that task.
function Ensure-BranchFile {
  $info = Read-BranchFile $Id
  if ($info -and $info.branch -and $info.base -and -not $info.merge) { return $info }
  $current = Current-Branch
  if (-not $current) { Refuse 'Task branches needs a current branch as the base, and the checkout has none (detached HEAD, or no git repository)' }
  $base = $current
  if ($current.StartsWith('task/')) {
    $other = Read-BranchFile $current.Substring(5)
    if ($other -and $other.base) { $base = $other.base }
  }
  Write-BranchFile "task/$Id" $base ''
  Read-BranchFile $Id
}

# Puts the main checkout on the branch of the task, made from its base when it does not exist yet.
# Gives the branch that was checked out before, or '' when the checkout was on the task branch.
function Enter-TaskBranch {
  $info = Ensure-BranchFile
  $current = Current-Branch
  if ($current -eq $info.branch) { return '' }
  if ($current.StartsWith('task/')) { Refuse "the checkout is on $current, the branch of another task; Dispatch switches back to the base when that work run has ended" }
  $holder = Lock-Holder (Merge-Lock)
  if ($holder) { Refuse "a merge of this project runs (task $holder); try again when it has ended" }
  $exists = (Invoke-Git @('rev-parse', '--verify', '--quiet', "refs/heads/$($info.branch)")).Code -eq 0
  if ($exists) {
    $aligned = "$(Align-Tasks $info.branch)"
    if ($aligned) { Refuse "the checkout stays on ${current}: $aligned" }
  }
  $result = if ($exists) { Invoke-Git @('checkout', '-q', $info.branch) } else { Invoke-Git @('checkout', '-q', '-b', $info.branch, $info.base) }
  if ($result.Code -ne 0) { Refuse "git could not check out $($info.branch): $($result.Text)" }
  $current
}

# Merges the task branch into the base in the main checkout: git merge --no-ff --no-commit, the gate
# command on the merged code, then the merge commit, or git merge --abort. A conflict only in the task
# files of .dispatch takes the version of the base, where Dispatch keeps them current, except the
# report and the log of this task, which take the branch version; a side with a conflict marker stops
# the merge (ticket board-in-progress). Gives the
# reason of a refusal, or '' after the merge; $script:Merged holds the commit then. The verb merge
# commits the changed task files first.
function Merge-Branch($Info, [string]$Gate, [int]$Limit) {
  $branch = $Info.branch
  $merge = Invoke-Git @('merge', '--no-ff', '--no-commit', $branch)
  $open = (Invoke-Git @('rev-parse', '-q', '--verify', 'MERGE_HEAD')).Code -eq 0
  if (-not $open) {
    if ($merge.Code -ne 0) { return "git could not merge ${branch}: $($merge.Text)" }
    # Nothing to merge: the branch has no commit that the base lacks.
    Invoke-Git @('branch', '-d', $branch) | Out-Null
    $script:Merged = 'nothing to merge'
    Write-BranchFile $branch $Info.base "done nothing-to-merge $((Get-Date).ToString('s'))"
    return ''
  }
  if ($merge.Code -ne 0) {
    $conflicts = @((Invoke-Git @('diff', '--name-only', '--diff-filter=U')).Lines | Where-Object { $_ })
    $code = @($conflicts | Where-Object { -not $_.StartsWith('.dispatch/') })
    if ($code.Count -gt 0 -or $conflicts.Count -eq 0) {
      Invoke-Git @('merge', '--abort') | Out-Null
      if ($code.Count -gt 0) { return "the merge of $branch into $($Info.base) does not apply; nothing was merged. Conflicts in:`n$($code -join "`n")" }
      return "git could not merge ${branch}: $($merge.Text)"
    }
    # The report and the log of this task take the branch side, where its work run wrote them; every
    # other task file takes the base side (ticket board-in-progress, user decision 5).
    $own = @(".dispatch/$Id.md", ".dispatch/logs/$Id.md")
    foreach ($file in $conflicts) {
      $side = if ($own -contains $file) { '--theirs' } else { '--ours' }
      if ((Invoke-Git @('checkout', $side, '--', $file)).Code -eq 0) { Invoke-Git @('add', '--', $file) | Out-Null }
      else { Invoke-Git @('rm', '-q', '--', $file) | Out-Null }
    }
    # No task file keeps a conflict marker: a side that has one stops the merge.
    foreach ($file in $conflicts) {
      $path = Join-Path $Project $file
      if (-not (Test-Path -LiteralPath $path)) { continue }
      $marked = @(Get-Content -LiteralPath $path -Encoding UTF8 | Where-Object { $_ -match '^(<<<<<<<|>>>>>>>)( |$)' })
      if ($marked.Count -gt 0) {
        Invoke-Git @('merge', '--abort') | Out-Null
        return "the merge of $branch into $($Info.base) would keep conflict markers in $file; nothing was merged. Remove the lines that start with <<<<<<< or >>>>>>> from that file on both branches, then merge again"
      }
    }
  }
  if ($Gate) {
    $log = Join-Path $Reports "merge\$Id.log"
    # The gate reads the ticket and the checks that the user chose for it (ticket task-checks); the
    # file can be absent: then the user chose no check, or the project has no list.
    $env:DISPATCH_TICKET = $Id
    $env:DISPATCH_CHECKS = Join-Path $Reports "$Id.checks"
    $code = Run-Measured $Gate $log $Limit
    Remove-Item Env:DISPATCH_TICKET, Env:DISPATCH_CHECKS -ErrorAction SilentlyContinue
    if ($code -ne 0) {
      Invoke-Git @('merge', '--abort') | Out-Null
      $tail = if (Test-Path -LiteralPath $log) { (Get-Content -LiteralPath $log -Tail 40) -join "`n" } else { '' }
      return "the gate command failed with exit code $code, so nothing was merged ($Gate; the log is $log). Its last 40 lines:`n$tail"
    }
  }
  $commit = Invoke-Git @('commit', '-q', '-m', "Merge $branch into $($Info.base) ($Id)")
  if ($commit.Code -ne 0) {
    Invoke-Git @('merge', '--abort') | Out-Null
    return "git could not commit the merge: $($commit.Text)"
  }
  $script:Merged = (Invoke-Git @('rev-parse', '--short', 'HEAD')).Text
  Invoke-Git @('branch', '-d', $branch) | Out-Null
  Write-BranchFile $branch $Info.base "done $script:Merged $((Get-Date).ToString('s'))"
  ''
}

# Pushes the base after its merge (Push after the merge, ticket simpler-process): only the base to its
# upstream branch (branch.<base>.remote and branch.<base>.merge), never with force, without a prompt
# for a password, with the time limit of 300 s. Gives the value of the push line of the branch file.
function Push-Base([string]$Base) {
  $remote = (Invoke-Git @('config', '--get', "branch.$Base.remote")).Text
  $target = (Invoke-Git @('config', '--get', "branch.$Base.merge")).Text
  if (-not $remote -or $remote -eq '.' -or -not $target.StartsWith('refs/heads/')) { return 'no-upstream' }
  $folder = Join-Path $Reports 'merge'
  if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
  $log = Join-Path $folder "$Id-push.log"
  # cmd.exe reads % in a batch file as a variable; a git name can hold one.
  $command = "git push `"$remote`" `"refs/heads/${Base}:$target`"".Replace('%', '%%')
  $before = @{ GIT_TERMINAL_PROMPT = $env:GIT_TERMINAL_PROMPT; GCM_INTERACTIVE = $env:GCM_INTERACTIVE }
  $env:GIT_TERMINAL_PROMPT = '0'
  $env:GCM_INTERACTIVE = 'never'
  try {
    $code = Run-Measured $command $log 300
  } finally {
    foreach ($name in @($before.Keys)) {
      if ($null -eq $before[$name]) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
      else { Set-Item -Path "Env:$name" -Value $before[$name] }
    }
  }
  $branch = $target.Substring('refs/heads/'.Length)
  if ($code -eq 0) { return "pushed $remote/$branch $((Get-Date).ToString('s'))" }
  $lines = if (Test-Path -LiteralPath $log) { @(Get-Content -LiteralPath $log | ForEach-Object { "$_".Trim() } | Where-Object { $_ }) } else { @() }
  $reason = @($lines | Where-Object { $_ -match '^(!|error:|fatal:|stopped after)' } | Select-Object -First 1)
  $why = if ($reason.Count -gt 0) { $reason[0] } elseif ($code -eq 124) { 'the push took longer than 300 s' } else { "git push ended with exit code $code" }
  "failed $why (the log is $log)"
}

# The changed files of the project outside .dispatch, as git status gives them; none outside git.
function Tree-Status {
  if (-not (Test-Path -LiteralPath (Join-Path $Project '.git'))) { return @() }
  @(& git -C $Project status --porcelain --untracked-files=all -- . ':(exclude).dispatch')
}

# The paths of the section "Files to change" of the plan of the task (ticket leftover-files-block-tasks):
# each path in backticks, and the first word of a list item when it is no backtick span. A path has a
# / or a dot and no space; a trailing ,:;.) goes. The Rust rule plan_files is the same.
function Plan-Files {
  $file = Join-Path $Reports "plans\$Id.md"
  if (-not (Test-Path -LiteralPath $file)) { return @() }
  $files = New-Object System.Collections.Generic.List[string]
  $inside = $false
  foreach ($raw in Get-Content -LiteralPath $file -Encoding UTF8) {
    $line = $raw.Trim()
    if ($line.StartsWith('#')) { $inside = $line.TrimStart('#').Trim() -eq 'Files to change'; continue }
    if (-not $inside) { continue }
    $tokens = @()
    if ($line -match '^[-*] +(\S+)' -and -not $Matches[1].StartsWith('`')) { $tokens += $Matches[1] }
    $spans = $line.Split('`')
    for ($at = 1; $at -lt $spans.Count - 1; $at += 2) { $tokens += $spans[$at] }
    foreach ($token in $tokens) {
      $path = $token.Trim().TrimEnd(',', ':', ';', '.', ')')
      if (-not $path -or $path -match '\s' -or -not ($path.Contains('/') -or $path.Contains('.'))) { continue }
      $path = $path.Replace('\', '/')
      if ($path.StartsWith('./')) { $path = $path.Substring(2) }
      if ($path -and -not $files.Contains($path)) { $files.Add($path) }
    }
  }
  $files.ToArray()
}

# The lines of git status outside .dispatch that touch a file of the task (ticket
# leftover-files-block-tasks): the path, or one of the two paths of a rename, is a task file, lies in a
# task folder, or is an untracked folder that holds a task file. Without case. The task files are the
# files that the task branch changed while it exists and is not merged, and with -Plan also the paths
# of Plan-Files. The Rust rule task_leftovers is the same.
function Task-Leftovers([switch]$Plan) {
  $dirty = @(& git -C $Project status --porcelain -- . ':(exclude).dispatch' | Where-Object { $_ })
  if ($dirty.Count -eq 0) { return @() }
  $files = @()
  if ($Plan) { $files += @(Plan-Files) }
  $info = Read-BranchFile $Id
  if ($info -and $info.branch -and $info.base -and -not $info.merge -and (Invoke-Git @('rev-parse', '--verify', '--quiet', "refs/heads/$($info.branch)")).Code -eq 0) {
    $diff = Invoke-Git @('diff', '--name-only', "$($info.base)...$($info.branch)")
    if ($diff.Code -eq 0) { $files += @($diff.Lines | Where-Object { $_ }) }
  }
  $files = @($files | ForEach-Object { $_.Replace('\', '/').ToLowerInvariant() })
  if ($files.Count -eq 0) { return @() }
  foreach ($line in $dirty) {
    $paths = @($line.Substring([Math]::Min(3, $line.Length)) -split ' -> ' | ForEach-Object { $_.Trim().Trim('"').Replace('\', '/').ToLowerInvariant() } | Where-Object { $_ })
    $hit = $false
    foreach ($path in $paths) {
      foreach ($file in $files) {
        if ($path -eq $file -or ($file.EndsWith('/') -and $path.StartsWith($file)) -or ($path.EndsWith('/') -and $file.StartsWith($path))) { $hit = $true }
      }
    }
    if ($hit) { $line }
  }
}

# The lines of Task-Leftovers that the work run wrote itself (ticket task-branches-blocked-work): the
# newest file under the path (the new path of a rename, each file of an untracked folder) is not later
# than the end of the run plus 2 s. The end is the report time, for a stopped task the state file time;
# without it nothing counts. A path without a file (a deletion) never counts. The Rust rule
# own_changes is the same.
function Own-Changes([string[]]$Lines) {
  $end = if ((Get-State) -eq 'stopped') { State-Path } else { Join-Path $Reports "$Id.md" }
  if (-not (Test-Path -LiteralPath $end)) { return }
  $limit = (Get-Item -LiteralPath $end).LastWriteTimeUtc.AddSeconds(2).Ticks
  foreach ($line in $Lines) {
    if (-not $line -or $line.Length -le 3) { continue }
    $full = Join-Path $Project ((($line.Substring(3) -split ' -> ')[-1]).Trim().Trim('"'))
    if (-not (Test-Path -LiteralPath $full)) { continue }
    $item = Get-Item -LiteralPath $full -Force
    $files = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $full -Recurse -File -Force) } else { @($item) }
    if ($files.Count -eq 0) { continue }
    $newest = 0
    foreach ($file in $files) { if ($file.LastWriteTimeUtc.Ticks -gt $newest) { $newest = $file.LastWriteTimeUtc.Ticks } }
    if ($newest -le $limit) { $line }
  }
}

# Commits the own changes of the work run (Own-Changes) by path on the current branch as "<ticket> WIP"
# (ticket task-branches-blocked-work). Gives the reason of a failure, or ''.
function Commit-Own([string[]]$Lines) {
  $paths = @($Lines | Where-Object { $_ -and $_.Length -gt 3 } | ForEach-Object { $_.Substring(3) -split ' -> ' } | ForEach-Object { $_.Trim().Trim('"') } | Where-Object { $_ })
  if ($paths.Count -eq 0) { return '' }
  $add = Invoke-Git (@('add', '--') + $paths)
  if ($add.Code -ne 0) { return "git could not add the files of the work run: $($add.Text)" }
  $commit = Invoke-Git (@('commit', '-q', '-m', "$Id WIP (Dispatch: files of the work run)", '--') + $paths)
  if ($commit.Code -ne 0) { return "git could not commit the files of the work run: $($commit.Text)" }
  ''
}

# Brings the newer commits of the base into the task branch in the checkout (ticket
# task-branches-blocked-work), so a fix that reached the base after the branch started reaches the
# task: git merge-tree of the branch and the base, the folder .dispatch as the base has it (Dispatch
# keeps the task files current there), a merge commit with both parents, and a fast-forward of the
# branch. A file outside .dispatch that changed on both sides stops it, and the branch stays as it
# was. Gives the reason when the base has newer commits that did not come in, else ''.
function Sync-Base {
  $info = Read-BranchFile $Id
  if ($null -eq $info -or -not $info.branch -or -not $info.base -or $info.merge) { return '' }
  if ((Current-Branch) -ne $info.branch) { return '' }
  if ((Invoke-Git @('rev-parse', '--verify', '--quiet', "refs/heads/$($info.base)")).Code -ne 0) { return "the branch $($info.base) does not exist" }
  if ((Invoke-Git @('merge-base', '--is-ancestor', $info.base, $info.branch)).Code -eq 0) { return '' }
  $merge = Invoke-Git @('merge-tree', '--write-tree', '--name-only', '--no-messages', $info.branch, $info.base)
  $lines = @($merge.Lines | Where-Object { $_ })
  if (($merge.Code -ne 0 -and $merge.Code -ne 1) -or $lines.Count -eq 0) { return "git merge-tree failed: $($merge.Text)" }
  $clash = @($lines | Select-Object -Skip 1 | Where-Object { -not $_.StartsWith('.dispatch/') })
  if ($clash.Count -gt 0) { return "these files changed on both sides: $($clash -join ', ')" }
  # A separate index builds the tree; the index of the checkout stays as it is.
  $index = Join-Path ([IO.Path]::GetTempPath()) "dispatch-sync-$PID.index"
  $env:GIT_INDEX_FILE = $index
  try {
    $built = (Invoke-Git @('read-tree', $lines[0])).Code -eq 0
    if ($built) { $built = (Invoke-Git @('rm', '--cached', '-r', '-q', '-f', '--ignore-unmatch', '--', '.dispatch')).Code -eq 0 }
    if ($built -and (Invoke-Git @('rev-parse', '--verify', '--quiet', "$($info.base):.dispatch")).Code -eq 0) {
      $built = (Invoke-Git @('read-tree', '--prefix=.dispatch/', "$($info.base):.dispatch")).Code -eq 0
    }
    $tree = if ($built) { Invoke-Git @('write-tree') } else { $null }
  } finally {
    Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $index -Force -ErrorAction SilentlyContinue
  }
  if ($null -eq $tree -or $tree.Code -ne 0) { return 'git could not build the merged tree' }
  $commit = Invoke-Git @('commit-tree', "$($tree.Lines | Select-Object -Last 1)".Trim(), '-p', $info.branch, '-p', $info.base, '-m', "Merge $($info.base) into $($info.branch) (${Id}: the newer commits of the base)")
  if ($commit.Code -ne 0) { return "git could not make the merge commit: $($commit.Text)" }
  $forward = Invoke-Git @('merge', '--ff-only', '-q', "$($commit.Lines | Select-Object -Last 1)".Trim())
  if ($forward.Code -ne 0) { return "git could not move the branch: $($forward.Text)" }
  ''
}

# Whether a commit tracks a file under .dispatch.
function Tracks-Tasks([string]$Rev) {
  $result = Invoke-Git @('ls-tree', '-r', '--name-only', $Rev, '--', '.dispatch')
  $result.Code -eq 0 -and @($result.Lines | Where-Object { $_ }).Count -gt 0
}

# Makes a task branch hold the task files the way the checkout holds them (ticket
# local-only-deletes-task-files), so no checkout, sync or merge deletes or overwrites a file of
# .dispatch on the disk. "Task files local only" on: a branch that tracks a file of .dispatch, while
# HEAD tracks none, gets a commit that takes the folder out of git. Off: a branch that tracks none,
# while HEAD tracks some, gets the folder as HEAD has it. Git writes a tracked file of the target over
# an ignored file, and deletes a tracked file that the target lacks. It moves the ref only, through an
# index of its own; nothing is checked out. Gives the reason of a failure, or ''.
function Align-Tasks([string]$Branch) {
  $ref = "refs/heads/$Branch"
  $old = Invoke-Git @('rev-parse', '--verify', '--quiet', $ref)
  if ($old.Code -ne 0) { return '' }
  $tip = "$($old.Lines | Select-Object -Last 1)".Trim()
  $local = Tasks-Local
  $branchTracks = Tracks-Tasks $tip
  $headTracks = Tracks-Tasks 'HEAD'
  if ($local -and -not ($branchTracks -and -not $headTracks)) { return '' }
  if (-not $local -and -not ($headTracks -and -not $branchTracks)) { return '' }
  $message = if ($local) { 'Dispatch: task files are local only' } else { 'Dispatch: task files in git again' }
  $index = Join-Path ([IO.Path]::GetTempPath()) "dispatch-align-$PID.index"
  $env:GIT_INDEX_FILE = $index
  try {
    $built = (Invoke-Git @('read-tree', $tip)).Code -eq 0
    if ($built -and $local) { $built = (Invoke-Git @('rm', '--cached', '-r', '-q', '-f', '--ignore-unmatch', '--', '.dispatch')).Code -eq 0 }
    if ($built -and -not $local) { $built = (Invoke-Git @('read-tree', '--prefix=.dispatch/', 'HEAD:.dispatch')).Code -eq 0 }
    $tree = if ($built) { Invoke-Git @('write-tree') } else { $null }
  } finally {
    Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $index -Force -ErrorAction SilentlyContinue
  }
  if ($null -eq $tree -or $tree.Code -ne 0) { return "git could not build the task files of $Branch" }
  $commit = Invoke-Git @('commit-tree', "$($tree.Lines | Select-Object -Last 1)".Trim(), '-p', $tip, '-m', $message)
  if ($commit.Code -ne 0) { return "git could not commit the task files of ${Branch}: $($commit.Text)" }
  $move = Invoke-Git @('update-ref', $ref, "$($commit.Lines | Select-Object -Last 1)".Trim(), $tip)
  if ($move.Code -ne 0) { return "git could not move ${Branch}: $($move.Text)" }
  ''
}

# The sentence for the prompt of a run when Sync-Base did not bring the newer commits of the base, else
# ''. Quotes and line breaks go, as in a reply.
function Sync-Note {
  $why = "$(Sync-Base)"
  if (-not $why) { return '' }
  $why = (($why -replace '"', "'") -replace "`r?`n", ' ').Trim().TrimEnd('.')
  " Dispatch could not bring the newer commits of $((Read-BranchFile $Id).base) into this branch: $why."
}

# Runs one measuring command with cmd.exe in the project folder, its output into the log. The
# command goes into a batch file next to the log, so a redirect of its own stays its own. A command
# that runs longer than the limit is ended with its process tree; the result is then 124.
function Run-Measured([string]$Command, [string]$Log, [int]$Limit) {
  $batch = [IO.Path]::ChangeExtension($Log, '.cmd')
  [IO.File]::WriteAllText($batch, "@echo off`r`n$Command`r`n")
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $env:ComSpec
  $info.Arguments = "/d /s /c `"`"$batch`" > `"$Log`" 2>&1`""
  $info.WorkingDirectory = $Project
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $process = [Diagnostics.Process]::Start($info)
  if ($process.WaitForExit($Limit * 1000)) {
    $process.WaitForExit()
    return $process.ExitCode
  }
  # cmd.exe redirects the output of taskkill itself, so PowerShell sees no error text.
  & $env:ComSpec /d /c "taskkill /PID $($process.Id) /T /F >nul 2>&1"
  $process.WaitForExit(10000) | Out-Null
  try { [IO.File]::AppendAllText($Log, "`nstopped after $Limit s: the time limit of the measuring commands`n") } catch { }
  124
}

switch ($Verb) {
  'plan' {
    Need-Id
    $brief = Join-Path $Reports "briefs\$Id.md"
    if (-not (Test-Path -LiteralPath $brief)) { Refuse "no brief at $brief" }
    $plans = Join-Path $Reports 'plans'
    if (-not (Test-Path -LiteralPath $plans)) { New-Item -ItemType Directory -Path $plans | Out-Null }
    $plan = Join-Path $plans "$Id.md"
    $flags = Run-Flags 'plan'
    $prompt = "Plan ticket $Id. Read the brief $brief. Write the plan to $plan with the sections that the section Background workers in CLAUDE.md names. Edit nothing. Then end your turn."
    # Task branches: the base of the task is the branch of the checkout at the plan run.
    if (Branches-On) { Ensure-BranchFile | Out-Null }
    # The scratch folder of an earlier plan run of the ticket goes: its logs belong to that plan.
    $scratch = Join-Path $Reports "measure\$Id"
    if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
    if (Measure-On) { $prompt += " Measure before the plan is on: first run the listed measuring commands as the section Background workers says, and write the section Measured." }
    Set-State 'planning'
    $printed = Run-Claude (@($prompt, '--bg', '--name', (Run-Name 'plan')) + $flags)
    Save-Session 'plan' $printed
  }
  'approve' {
    Need-Id
    $plan = Join-Path $Reports "plans\$Id.md"
    if (-not (Test-Path -LiteralPath $plan)) { Refuse "no plan at $plan" }
    if (Test-Path -LiteralPath (Join-Path $Project '.git')) {
      # Only a change in a file of this task holds it (ticket leftover-files-block-tasks); the other
      # changes stay where they are. The task files in .dispatch do not count: Dispatch commits them
      # itself, and triage can write a brief at any time.
      $held = @(Task-Leftovers -Plan)
      if ($held.Count -gt 0) { Refuse "these changes in files of this task are not committed; commit, stash or undo them first:`n$($held -join "`n")" }
    }
    Approve-Check
    $flags = Run-Flags 'work'
    # The work run is a new session (ticket work-fresh-session): the prompt names the ticket, the
    # brief, the plan and the report file, and the files are its whole input.
    $brief = Join-Path $Reports "briefs\$Id.md"
    $report = Join-Path $Reports "$Id.md"
    $prompt = "Plan approved: $plan. This is the work run of ticket $Id. Read the brief $brief and the plan first: they are the whole context of this run, and the sections User decisions and Checks chosen of the plan hold the choices of the user. Execute the plan. A deviation goes into the report, not into the code. Commit only the files that this run changed, each by name in git add and git commit; never run git add -A, git add . or git commit -a, and leave every other change in the checkout as it is. Write the report to $report."
    # The checks that the user chose at Approve (ticket task-checks): one line per check, the name, a
    # tab and the command. A quote of a name becomes an apostrophe, as in a reply.
    $chosen = Join-Path $Reports "$Id.checks"
    if (Test-Path -LiteralPath $chosen) {
      $names = @(Get-Content -LiteralPath $chosen | Where-Object { $_.Trim() -ne '' } | ForEach-Object { ($_ -split "`t", 2)[0].Trim() -replace '"', "'" })
      # Checks at the gate (ticket simpler-process): with task branches and a gate command, the gate
      # runs the chosen checks once, at the merge, so the work run does not run them.
      $gateLine = "$(@(Command-Lines 'merge-gate.txt') | Select-Object -First 1)"
      if ($names.Count -gt 0 -and (Option-On 'checksAtGate') -and (Branches-On) -and $gateLine) {
        $prompt += " The user chose these checks: $($names -join ', '). Checks at the gate is on: the gate command runs them once, at the merge, so this run does not run them and needs no Verification claim for them."
      } elseif ($names.Count -gt 0) {
        $prompt += " The user chose these checks: $($names -join ', '). Run each with the command of the section Checks chosen of the plan, as written there: Dispatch looks for that command in the commands of this run."
      }
    }
    # Task branches: the work run works on the branch of the task; a failed start checks out the branch before.
    $back = ''
    if (Branches-On) {
      $back = Enter-TaskBranch
      $prompt += " Task branches is on: the checkout is on the branch $((Read-BranchFile $Id).branch) of this task. Commit there; switch no branch, merge nothing, push nothing. When this run stops with a question or fails, first commit its own changed files by name on this branch with the message $Id WIP."
      # An existing branch (a new plan after an earlier work run) takes the newer commits of the base.
      $prompt += Sync-Note
    }
    Set-State 'approved'
    # A new session, no resume: the work run gets the brief, the plan and the decisions of the user,
    # and nothing of the context of the plan run (ticket work-fresh-session); the model switch stays.
    # The name keeps the session with the task and marks it as the work run: Dispatch and this script
    # find a worker by its name.
    $printed = Run-Claude (@($prompt, '--bg', '--name', (Run-Name 'work')) + $flags) 'planning' $back
    Set-State 'working'
    Save-Session 'work' $printed
  }
  'reply' {
    Need-Id
    # Windows PowerShell 5.1 does not escape a double quote in an argument of a native command, and
    # claude is a command file, so cmd.exe parses the line too. A quote becomes an apostrophe and a
    # line break a space, so the text can never cut or merge the arguments after it.
    $text = ((($Message -join ' ') -replace '"', "'") -replace "`r?`n", ' ').Trim()
    if (-not $text) { Refuse 'reply needs a message' }
    $run = if ((Get-State) -eq 'planning') { 'plan' } else { 'work' }
    $worker = Resume-Target $run
    $flags = Run-Flags $run
    # Task branches: a work run goes on on the branch of its task, also after Dispatch switched back.
    $branch = if ($run -eq 'work' -and (Branches-On)) { Read-BranchFile $Id } else { $null }
    $tracked = $null -ne $branch -and -not $branch.merge
    # The state file is newer than the report before the checkout: Dispatch keeps the checkout on the
    # task branch until the worker writes its report again, also while Claude Code starts.
    if ($tracked) { Set-State (Get-State) }
    # A switch onto the task branch waits for the changes in files of the task (ticket
    # leftover-files-block-tasks); on its branch already, the run's own edits do not hold it. The
    # run's own files off its branch (a forgotten WIP commit) go along and are committed on the
    # branch (ticket task-branches-blocked-work).
    $own = @()
    if ($tracked -and (Current-Branch) -ne $branch.branch) {
      $held = @(Task-Leftovers -Plan)
      $own = @(Own-Changes $held)
      $held = @($held | Where-Object { $own -notcontains $_ })
      if ($held.Count -gt 0) { Refuse "these changes in files of this task are not committed; commit, stash or undo them first:`n$($held -join "`n")" }
    }
    $back = if ($tracked) { Enter-TaskBranch } else { '' }
    if ($own.Count -gt 0) {
      $failed = Commit-Own $own
      if ($failed) { [Console]::Error.WriteLine("warning: $failed; the files stay uncommitted on $($branch.branch)") }
    }
    # The branch takes the newer commits of the base at each start (ticket task-branches-blocked-work).
    # Its fast-forward can write the report of the base; the state file is then written again, so it
    # stays newer than the report and Dispatch keeps the checkout on the branch.
    if ($tracked) {
      $text += Sync-Note
      Set-State (Get-State)
    }
    $printed = Run-Claude (@($text, '--resume', $worker.sessionId, '--bg', '--name', (Run-Name $run)) + $flags) '' $back
    Save-Session $run $printed
  }
  'status' {
    $workers = Get-Workers
    Get-ChildItem -LiteralPath $Reports -Filter '*.state' | ForEach-Object {
      $ticket = $_.BaseName
      $state = (Get-Content -LiteralPath $_.FullName -Raw).Trim()
      "$ticket`t$state`t$(Worker-State (Find-Worker $workers $ticket))"
    }
  }
  'measure' {
    Need-Id
    if (-not (Measure-On)) { Refuse 'Measure before the plan is off in this project; Setup pipeline turns it on' }
    if ((Get-State) -ne 'planning') { Refuse "the task $Id is not in its plan run; only a plan run measures" }
    # @() keeps a list of one command a list: a plain string would give its first character.
    $commands = @(Measure-Commands)
    $n = 0
    if ($null -eq $Message -or @($Message).Count -ne 1 -or -not [int]::TryParse("$($Message[0])", [ref]$n) -or $n -lt 1 -or $n -gt $commands.Count) {
      Refuse "measure takes the number of a command of measure-commands.txt (1 to $($commands.Count)); nothing else runs"
    }
    $folder = Join-Path $Reports "measure\$Id"
    if (-not (Test-Path -LiteralPath $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
    $command = $commands[$n - 1].Replace('{measure}', $folder)
    $log = Join-Path $folder "$n.log"
    $limit = Measure-Limit
    Enter-Lock (Lock-Path) $limit 'measuring'
    try {
      $before = Tree-Status
      $code = Run-Measured $command $log $limit
      $after = Tree-Status
    } finally {
      Exit-Lock (Lock-Path)
    }
    # The working tree must stay as it was; a change is noted for the task card of Dispatch.
    $changed = @($after | Where-Object { $_ -and $before -notcontains $_ }) + @($before | Where-Object { $_ -and $after -notcontains $_ })
    if ($changed.Count -gt 0) {
      $note = Join-Path $folder 'changed.txt'
      $known = if (Test-Path -LiteralPath $note) { @(Get-Content -LiteralPath $note) } else { @() }
      $new = @($changed | Where-Object { $known -notcontains $_ })
      if ($new.Count -gt 0) { [IO.File]::AppendAllText($note, (($new -join "`n") + "`n")) }
      [Console]::Error.WriteLine("warning: command $n changed files of the project outside .dispatch:`n$($changed -join "`n")")
    }
    "command $n ($($commands[$n - 1])) ended with exit code $code; the output is in $log. Its last 40 lines:"
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 40 }
    exit $code
  }
  'merge' {
    Need-Id
    if ($env:CLAUDECODE) { Refuse 'only the Merge button of Dispatch merges a task branch; a Claude Code session may not run this verb' }
    # A branch that waits keeps its merge also with Task branches off (ticket local-only-deletes-task-files).
    $info = Read-BranchFile $Id
    if ($null -eq $info -or -not $info.branch -or -not $info.base) { Refuse "the task $Id has no branch file" }
    if ($info.merge) { Refuse "the branch $($info.branch) is merged already: $($info.merge)" }
    if ((Invoke-Git @('rev-parse', '--verify', '--quiet', "refs/heads/$($info.branch)")).Code -ne 0) { Refuse "the branch $($info.branch) does not exist; the task had no work run" }
    $current = Current-Branch
    if ($current -ne $info.base) { Refuse "the checkout is on $current, not on the base $($info.base); Dispatch switches back when the work run has ended" }
    if ((Invoke-Git @('rev-parse', '-q', '--verify', 'MERGE_HEAD')).Code -eq 0) { Refuse 'the checkout has an unfinished merge; finish it or run git merge --abort first' }
    # Only a change in a file that the branch changes holds the merge (ticket leftover-files-block-tasks);
    # the gate then runs with the other changes in the folder.
    $held = @(Task-Leftovers)
    if ($held.Count -gt 0) { Refuse "the checkout has uncommitted changes in files that the branch changes; commit, stash or undo them first:`n$($held -join "`n")" }
    # The changed task files (the tickets file among them) go into one commit first, so git merge
    # never meets a changed file of .dispatch. With "Task files local only" on, git tracks none.
    $local = Tasks-Local
    $tasks = if ($local) { @() } else { @((Invoke-Git @('status', '--porcelain', '--untracked-files=all', '--', '.dispatch')).Lines | Where-Object { $_ }) }
    if ($tasks.Count -gt 0) {
      Invoke-Git @('add', '--all', '--', '.dispatch') | Out-Null
      $saved = Invoke-Git @('commit', '-q', '-m', "Dispatch: task files before the merge of $Id", '--', '.dispatch')
      if ($saved.Code -ne 0) { Refuse "git could not commit the task files before the merge: $($saved.Text)" }
    }
    # The branch holds the task files as the base does, so the merge deletes none of them.
    $aligned = "$(Align-Tasks $info.branch)"
    if ($aligned) { Refuse $aligned }
    $gate ="$(@(Command-Lines 'merge-gate.txt') | Select-Object -First 1)"
    $limit = Command-Limit 'merge-gate.txt' 14400
    Enter-Lock (Merge-Lock) 0 'merge'
    $script:Merged = ''
    try {
      $refusal = "$(Merge-Branch $info $gate $limit)"
    } finally {
      Exit-Lock (Merge-Lock)
    }
    if ($refusal) { Refuse $refusal }
    "merged $($info.branch) into $($info.base): $script:Merged"
    # Push after the merge (ticket simpler-process): after a merge commit, outside the merge lock, which
    # guards the checkout and the gate, not the network. A failed push leaves the merge as it is, and
    # the verb ends with 0: the merge is done.
    if ($script:Merged -ne 'nothing to merge' -and (Option-On 'pushAfterMerge') -and (Branches-On)) {
      $push = Push-Base $info.base
      $merged = Read-BranchFile $Id
      Write-BranchFile $merged.branch $merged.base $merged.merge $push
      if ($push.StartsWith('pushed ')) { "pushed $($info.base) to $(($push -split ' ')[1])" }
      elseif ($push -eq 'no-upstream') { "no push: $($info.base) has no upstream branch" }
      else { "push failed: $($push.Substring(7)); $($info.base) is merged on this computer only" }
    }
  }
  'stop' {
    Need-Id
    $worker = Find-Worker (Get-Workers) $Id
    if ($null -eq $worker) { Refuse "no worker named $Id" }
    & claude stop $worker.id
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Set-State 'stopped'
  }
}
"##;

/// Reads a settings file. A file that does not exist gives an empty object.
fn read_settings(path: &Path) -> Result<Map<String, Value>, String> {
    let Ok(text) = fs::read_to_string(path) else {
        return Ok(Map::new());
    };
    match serde_json::from_str(text.trim_start_matches('\u{feff}')) {
        Ok(Value::Object(settings)) => Ok(settings),
        Ok(_) => Err(format!("{} is not a JSON object", path.display())),
        Err(e) => Err(format!("{} is not correct JSON: {e}", path.display())),
    }
}

pub(crate) fn write_file(path: &Path, text: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    fs::write(path, text).map_err(err)
}

fn write_settings(path: &Path, settings: Map<String, Value>) -> Result<(), String> {
    let text = serde_json::to_string_pretty(&Value::Object(settings)).map_err(err)?;
    write_file(path, &format!("{text}\n"))
}

/// The allow rules of the design with one run per worker. The script replaces them. A rule
/// that stays would let triage start or resume a worker without the script.
const OBSOLETE_RULES: [&str; 2] = ["Bash(claude --bg *)", "Bash(claude --resume * --bg *)"];

/// What the permissions of the local settings lack or still have: the missing allow rules, the
/// obsolete allow rules that are still there, and the missing deny rules.
struct RuleChanges {
    missing: Vec<String>,
    obsolete: Vec<String>,
    missing_deny: Vec<String>,
    /// The deny rules that name the reports folder of the old layout.
    obsolete_deny: Vec<String>,
    /// The folders of `extra_directories` that `permissions.additionalDirectories` lacks.
    missing_dirs: Vec<String>,
}

impl RuleChanges {
    fn none(&self) -> bool {
        self.missing.is_empty()
            && self.obsolete.is_empty()
            && self.missing_deny.is_empty()
            && self.obsolete_deny.is_empty()
            && self.missing_dirs.is_empty()
    }
}

fn rule_changes(project: &Project) -> Result<RuleChanges, String> {
    let settings = read_settings(&project.local_settings())?;
    let list = |name: &str| settings.get("permissions").and_then(|permissions| permissions.get(name)).and_then(Value::as_array);
    let has = |rules: Option<&Vec<Value>>, rule: &str| rules.is_some_and(|rules| rules.iter().any(|known| known == rule));
    let (allow, deny, dirs) = (list("allow"), list("deny"), list("additionalDirectories"));
    // A rule that names the reports folder of the old layout is obsolete after the move.
    let old = project.old_rule_texts();
    let names_old = |rule: &str| old.iter().any(|text| rule.contains(text.as_str()));
    let named_old = |rules: Option<&Vec<Value>>| -> Vec<String> {
        rules.into_iter().flatten().filter_map(Value::as_str).filter(|rule| names_old(rule)).map(str::to_string).collect()
    };
    let mut obsolete: Vec<String> = OBSOLETE_RULES.iter().filter(|rule| has(allow, rule)).map(|rule| rule.to_string()).collect();
    obsolete.extend(named_old(allow));
    let mut obsolete_deny = named_old(deny);
    // With "Task branches" off again, the deny rule of the merge verb goes, so the file is as before.
    let merge_deny = format!("Bash({} merge *)", script_command(&project.reports_text()));
    if !project.options().task_branches && has(deny, &merge_deny) {
        obsolete_deny.push(merge_deny);
    }
    Ok(RuleChanges {
        missing: project.allow_rules()?.into_iter().filter(|rule| !has(allow, rule)).collect(),
        obsolete,
        missing_deny: project.deny_rules().into_iter().filter(|rule| !has(deny, rule)).collect(),
        obsolete_deny,
        missing_dirs: project.extra_directories().into_iter().filter(|dir| !has(dirs, dir)).collect(),
    })
}

/// The list `permissions.<name>` of a settings object, made when it is absent.
fn rule_list<'a>(settings: &'a mut Map<String, Value>, name: &str, path: &Path) -> Result<&'a mut Vec<Value>, String> {
    let permissions = settings.entry("permissions").or_insert_with(|| json!({}));
    let Some(permissions) = permissions.as_object_mut() else {
        return Err(format!("\"permissions\" in {} is not an object", path.display()));
    };
    let list = permissions.entry(name).or_insert_with(|| json!([]));
    list.as_array_mut().ok_or_else(|| format!("\"permissions.{name}\" in {} is not a list", path.display()))
}

/// Adds the missing allow and deny rules and removes the obsolete allow and deny rules.
fn add_rules(project: &Project) -> Result<(), String> {
    let changes = rule_changes(project)?;
    let path = project.local_settings();
    let mut settings = read_settings(&path)?;
    let allow = rule_list(&mut settings, "allow", &path)?;
    allow.retain(|rule| !rule.as_str().is_some_and(|rule| changes.obsolete.iter().any(|obsolete| rule == obsolete)));
    allow.extend(changes.missing.into_iter().map(Value::String));
    let deny = rule_list(&mut settings, "deny", &path)?;
    deny.retain(|rule| !rule.as_str().is_some_and(|rule| changes.obsolete_deny.iter().any(|obsolete| rule == obsolete)));
    deny.extend(changes.missing_deny.into_iter().map(Value::String));
    let dirs = rule_list(&mut settings, "additionalDirectories", &path)?;
    dirs.extend(changes.missing_dirs.into_iter().map(Value::String));
    write_settings(&path, settings)
}

fn isolation_is_off(settings: &Map<String, Value>) -> bool {
    settings.get("worktree").and_then(|worktree| worktree.get("bgIsolation")) == Some(&json!("none"))
}

/// Sets `worktree.bgIsolation` to `none`. A background session then works in the main checkout.
fn set_isolation(project: &Project) -> Result<(), String> {
    const LINE: &str = "\"worktree\": { \"bgIsolation\": \"none\" }";
    let path = project.settings();
    let mut settings = read_settings(&path)?;
    if settings.is_empty() {
        return write_file(&path, &format!("{{\n  {LINE}\n}}\n"));
    }
    if !settings.contains_key("worktree") {
        // Git tracks this file. Add one line, and do not change the format of the other lines.
        let text = fs::read_to_string(&path).map_err(err)?;
        if let Some(brace) = text.find('{') {
            let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
            let changed = format!("{}{newline}  {LINE},{}", &text[..=brace], &text[brace + 1..]);
            let correct = serde_json::from_str::<Value>(changed.trim_start_matches('\u{feff}'))
                .is_ok_and(|value| value.as_object().is_some_and(isolation_is_off));
            if correct {
                return write_file(&path, &changed);
            }
        }
    }
    let worktree = settings.entry("worktree").or_insert_with(|| json!({}));
    let Some(worktree) = worktree.as_object_mut() else {
        return Err(format!("\"worktree\" in {} is not an object", path.display()));
    };
    worktree.insert("bgIsolation".to_string(), json!("none"));
    write_settings(&path, settings)
}

/// `CLAUDE.md` has a section with this heading.
fn has_section(project: &Project, heading: &str) -> bool {
    fs::read_to_string(project.instructions()).is_ok_and(|text| text.lines().any(|line| line.starts_with(heading)))
}

/// `CLAUDE.md` has the "Background workers" section with the mark of the current text. A
/// section with another mark, or without one, is replaced by Apply.
fn section_done(project: &Project) -> bool {
    let Ok(text) = fs::read_to_string(project.instructions()) else {
        return false;
    };
    let wanted = project.section();
    let mark = wanted.lines().nth(1).unwrap_or_default();
    let mut lines = text.lines();
    lines.any(|line| line.starts_with(SECTION_HEADING)) && lines.next().is_some_and(|line| line.trim() == mark)
}

/// Puts a section into `CLAUDE.md` in place of the section with the same heading: from that
/// heading to the line before the next `## ` heading. Without such a section it goes at the end.
fn replace_section(project: &Project, heading: &str, section: &str) -> Result<(), String> {
    let path = project.instructions();
    let text = fs::read_to_string(&path).unwrap_or_default();
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    let lines: Vec<&str> = text.split(newline).collect();
    let Some(start) = lines.iter().position(|line| line.starts_with(heading)) else {
        return add_section(project, section);
    };
    let end = lines[start + 1..].iter().position(|line| line.starts_with("## ")).map_or(lines.len(), |at| start + 1 + at);
    let mut out: Vec<&str> = lines[..start].to_vec();
    out.extend(section.trim_end().split('\n'));
    // One empty line before the next section, or the final newline of the file.
    out.push("");
    if end < lines.len() {
        out.extend(&lines[end..]);
    }
    write_file(&path, &out.join(newline))
}

/// Adds a section at the end of `CLAUDE.md`.
fn add_section(project: &Project, section: &str) -> Result<(), String> {
    let path = project.instructions();
    let mut text = fs::read_to_string(&path).unwrap_or_default();
    let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
    if !text.is_empty() {
        // One empty line before the new section.
        text.truncate(text.trim_end().len());
        text.push_str(newline);
        text.push_str(newline);
    }
    text.push_str(&section.replace('\n', newline));
    write_file(&path, &text)
}

/// The number of files in a folder and its subfolders.
fn count_files(dir: &Path) -> usize {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .map(|path| if path.is_dir() { count_files(&path) } else { 1 })
        .sum()
}

/// The paths in `from` whose name exists in `to` already, as a file or as a file in a folder of
/// both. A move over them would overwrite a file.
fn move_conflicts(from: &Path, to: &Path) -> Vec<PathBuf> {
    let mut conflicts = Vec::new();
    for path in fs::read_dir(from).into_iter().flatten().flatten().map(|entry| entry.path()) {
        let Some(name) = path.file_name() else { continue };
        let target = to.join(name);
        if !target.exists() {
            continue;
        }
        if path.is_dir() && target.is_dir() {
            conflicts.extend(move_conflicts(&path, &target));
        } else {
            conflicts.push(target);
        }
    }
    conflicts
}

/// Moves each file and folder of `from` into `to`, and removes the empty folders of `from`.
/// `move_conflicts` must be empty.
fn move_into(from: &Path, to: &Path) -> Result<(), String> {
    for path in fs::read_dir(from).map_err(err)?.flatten().map(|entry| entry.path()) {
        let Some(name) = path.file_name() else { continue };
        let target = to.join(name);
        if path.is_dir() && target.is_dir() {
            move_into(&path, &target)?;
        } else {
            fs::rename(&path, &target).map_err(|error| format!("{} → {}: {error}", path.display(), target.display()))?;
        }
    }
    fs::remove_dir(from).map_err(|error| format!("{}: {error}", from.display()))
}

/// Moves the reports folder of the old layout (`<project>-reports`) into `.dispatch` of the
/// project: a rename when `.dispatch` does not exist (the folder keeps its creation time), else
/// file by file. A file that exists in both folders stops the move before anything moves.
/// Gives the number of moved files; 0 without an old folder.
fn move_old_reports(project: &Project) -> Result<usize, String> {
    let Some(old) = project.old_reports().filter(|old| old.is_dir()) else { return Ok(0) };
    let count = count_files(&old);
    if !project.reports.exists() {
        fs::rename(&old, &project.reports).map_err(|error| format!("{} → {}: {error}", old.display(), project.reports.display()))?;
        return Ok(count);
    }
    let conflicts = move_conflicts(&old, &project.reports);
    if !conflicts.is_empty() {
        let list: Vec<String> = conflicts.iter().map(|path| path.display().to_string()).collect();
        return Err(format!(
            "The folder {} was not moved: these files exist in both folders. Move or delete one of each, then click Apply again:\n{}",
            old.display(),
            list.join("\n")
        ));
    }
    move_into(&old, &project.reports)?;
    Ok(count)
}

fn plan(project: &Project) -> Result<Plan, String> {
    windows_only()?;
    let show = |path: PathBuf| path.to_string_lossy().into_owned();
    let changes = rule_changes(project)?;
    let options = project.options();
    let role = triage_prompt(options, &project.reports_text());
    let rules_done = has_section(project, RULES_HEADING);
    let rules_detail = if changes.none() {
        let mut lines = project.allow_rules()?;
        lines.extend(project.deny_rules().into_iter().map(|rule| format!("deny: {rule}")));
        lines.extend(project.extra_directories().into_iter().map(|dir| format!("read folder: {dir}")));
        lines.join("\n")
    } else {
        let mut lines = changes.missing.clone();
        lines.extend(changes.obsolete.iter().map(|rule| format!("remove: {rule}")));
        lines.extend(changes.missing_deny.iter().map(|rule| format!("deny: {rule}")));
        lines.extend(changes.obsolete_deny.iter().map(|rule| format!("remove deny: {rule}")));
        lines.extend(changes.missing_dirs.iter().map(|dir| format!("read folder: {dir}")));
        lines.join("\n")
    };
    // The local settings stay on this computer (ticket second-computer, user decision 3).
    let private = project.local_settings_private();
    let rules_detail = if !project.in_git {
        rules_detail
    } else if private {
        format!("{rules_detail}\n\nGit ignores {LOCAL_SETTINGS}: these rules stay on this computer, and Apply writes them on each computer.")
    } else {
        let mut text = format!("{rules_detail}\n\nThe rules and the folders stay on this computer: ");
        if !project.local_settings_ignored() {
            text.push_str(&format!("Apply adds the line {LOCAL_SETTINGS} with a comment line to .gitignore of the project"));
        }
        if project.local_settings_tracked() {
            if !project.local_settings_ignored() {
                text.push_str(", and ");
            } else {
                text.push_str("Apply ");
            }
            text.push_str(&format!("takes the file out of git (it stays on the disk) with the commit \"{LOCAL_SETTINGS_MESSAGE}\""));
        }
        text.push_str(". Apply writes the file on each computer.");
        text
    };
    let script_done = fs::read_to_string(project.script()).is_ok_and(|text| text.replace("\r\n", "\n") == WORKER_SCRIPT);
    // The reports folder of the old layout, while it still exists: Apply moves it.
    let old_reports = project.old_reports().filter(|old| old.is_dir());
    let steps = vec![
        Step {
            title: "Task files",
            target: show(project.reports.clone()),
            done: old_reports.is_none()
                && project.briefs().is_dir()
                && project.plans().is_dir()
                && plan_flags_current(project)
                && work_flags_current(project)
                && project.joins_tickets(),
            detail: format!(
                "The folder .dispatch in the project for the task files: the reports of the workers, a folder for the briefs, a folder for the plans, and the state of each task. {} Git joins the lines of the tickets file of two computers (.dispatch/.gitattributes). The options of the two runs go into plan-flags.txt and work-flags.txt, one argument per line; the files start with the defaults (plan run: {} {}, work run: {} {}). The work run names its permission mode ({}) and its tool list, so that the file says in full what the new session of the work run gets; an older file gets these lines and the paths of this folder, its choice stays. The files name this folder relative to the project, so they are the same on each computer.{}",
                if options.ignore_tasks {
                    "Git ignores it (Task files local only is on): the task files stay on this computer, and a clone has none. Approve does not count them as changes."
                } else {
                    "Git tracks it; Dispatch commits its files itself, and Approve does not count them as changes."
                },
                PLAN_DEFAULT.0,
                PLAN_DEFAULT.1,
                WORK_DEFAULT.0,
                WORK_DEFAULT.1,
                WORK_FIXED_FLAGS[1],
                old_reports
                    .as_ref()
                    .map(|old| format!(
                        "\n\nApply moves the folder {} of the old layout into this folder: {} files. Nothing is overwritten; a file that exists in both folders stops the move.",
                        old.display(),
                        count_files(old)
                    ))
                    .unwrap_or_default()
            ),
            rules: None,
        },
        Step {
            title: "Allow rules",
            target: show(project.local_settings()),
            done: changes.none() && private,
            detail: rules_detail,
            rules: None,
        },
        Step {
            title: "Worktree isolation off",
            target: show(project.settings()),
            done: isolation_is_off(&read_settings(&project.settings())?),
            detail: "\"worktree\": { \"bgIsolation\": \"none\" }".to_string(),
            rules: None,
        },
        Step {
            title: "Section in CLAUDE.md",
            target: show(project.instructions()),
            // The mark under the heading says which text the section has. An old text is replaced.
            done: section_done(project),
            detail: project.section(),
            rules: None,
        },
        Step {
            title: "Working rules",
            target: show(project.instructions()),
            done: rules_done,
            // A done step shows the full section. A step to do shows the heading and the checkboxes.
            detail: if rules_done { rules_section(&(0..RULES.len()).collect::<Vec<_>>()) } else { rules_section(&[]) },
            rules: if rules_done { None } else { Some(RULES.to_vec()) },
        },
        Step {
            title: "Worker script",
            target: show(project.script()),
            done: script_done,
            detail: WORKER_SCRIPT.to_string(),
            rules: None,
        },
        Step {
            title: "Triage role",
            target: show(project.triage_prompt()),
            // The text of the role comes from the settings. A file with a different text is not done.
            done: project.triage_prompt_text().as_deref() == Some(role.as_str()),
            detail: role,
            rules: None,
        },
        measure_step(project, options.measure_before_plan)?,
        branches_step(project, options.task_branches),
        ignore_step(project, options.ignore_tasks),
        notes_step(project, options.notes_in_git),
    ];
    let measure_commands = fs::read_to_string(project.measure_commands_file()).unwrap_or_default().replace("\r\n", "\n");
    let merge_gate = fs::read_to_string(project.merge_gate_file()).unwrap_or_default().replace("\r\n", "\n");
    let checks = fs::read_to_string(project.checks_file()).unwrap_or_default().replace("\r\n", "\n");
    Ok(Plan { root: show(project.root.clone()), git: project.in_git, options, steps, measure_commands, merge_gate, checks })
}

/// The step "Task branches" (ticket task-branches). Off, it is done and changes nothing. On, it is
/// done when git ignores the folder of the merge lock and the gate logs; Apply adds the ignore line.
fn branches_step(project: &Project, on: bool) -> Step {
    let target = project.merge_gate_file().to_string_lossy().into_owned();
    if !on {
        return Step {
            title: "Task branches",
            target,
            done: true,
            detail: "Off. A worker works on the current branch of the main checkout, as today.".to_string(),
            rules: None,
        };
    }
    let reports = project.reports_text();
    let gate = project.merge_gate();
    let gate = if gate.is_empty() { "no gate command: the merge does not wait for a check".to_string() } else { format!("the gate command: {gate}") };
    Step {
        title: "Task branches",
        target,
        done: project.ignores(MERGE_IGNORE),
        detail: format!(
            "Each task works on its own branch {BRANCH_PREFIX}<ticket-id>, made at Approve from the branch that the checkout was on at the plan run (the base, in {reports}/<ticket-id>.branch). The worker commits there and never merges or pushes. When the report is written, Dispatch switches the checkout back to the base and commits the task files there. The task card then shows Merge: the worker script merges the branch with --no-ff into the base, runs {gate} on the merged code (at most {limit} s; a first line \"# limit <seconds>\" of {reports}/merge-gate.txt changes that), and commits the merge or takes it back. One merge at a time; the log goes into {reports}/merge/<ticket-id>.log. Apply adds the line {MERGE_IGNORE} to {reports}/.gitignore. The section in CLAUDE.md and the deny rules (step Allow rules) say so. The push stays with you.",
            limit = project.merge_gate_limit(),
        ),
        rules: None,
    }
}

/// The step "Task files in git" (ticket ignore-tasks). On, it is done when the root `.gitignore` has
/// the line `.dispatch/` and git tracks no task file. Off, it is done when the line of Dispatch (the
/// pair under its mark) is absent; a line that the user wrote by hand stays (user decision 1).
fn ignore_step(project: &Project, on: bool) -> Step {
    let target = project.root_ignore().to_string_lossy().into_owned();
    if !on {
        let ours = project.tasks_ignored_by_dispatch();
        let detail = if ours {
            format!("Off. Apply removes the line {ROOT_TASKS_IGNORE} of Dispatch from .gitignore, adds the folder .dispatch to git again and commits the task files. Commit to git then commits .gitignore.")
        } else {
            "Off. Git tracks the folder .dispatch; Dispatch commits its files itself.".to_string()
        };
        return Step { title: "Task files in git", target, done: !ours, detail, rules: None };
    }
    let mut detail = format!(
        "Git ignores the folder .dispatch: tickets, briefs, plans, reports, logs and the other task files stay on this computer, and a clone has none. Apply adds the line {ROOT_TASKS_IGNORE} with a comment line to .gitignore of the project"
    );
    if project.tasks_tracked() {
        detail.push_str(&format!(
            ", takes the task files out of git (they stay on the disk) and commits that with the message \"{TASKS_LOCAL_MESSAGE}\""
        ));
    }
    detail.push_str(". Commit to git then commits .gitignore. Off again, Apply puts the folder back into git.");
    Step { title: "Task files in git", target, done: project.root_ignores_tasks() && !project.tasks_tracked(), detail, rules: None }
}

/// Adds the line of Dispatch with its mark to the root `.gitignore` when no line `.dispatch/` is
/// there, and makes the file when it is absent.
fn add_root_ignore(project: &Project) -> Result<(), String> {
    if project.root_ignores_tasks() {
        return Ok(());
    }
    add_ignore_pair(project, TASKS_IGNORE_MARK, ROOT_TASKS_IGNORE)
}

/// Adds a mark line of Dispatch and its ignore line at the end of the root `.gitignore`, and makes
/// the file when it is absent.
fn add_ignore_pair(project: &Project, mark: &str, line: &str) -> Result<(), String> {
    let mut text = fs::read_to_string(project.root_ignore()).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&format!("{mark}\n{line}\n"));
    write_file(&project.root_ignore(), &text)
}

/// Removes each pair of the mark and the line `.dispatch/` from the root `.gitignore`; the other
/// lines stay as they are, with their line ends.
fn remove_root_ignore(project: &Project) -> Result<(), String> {
    let text = fs::read_to_string(project.root_ignore()).unwrap_or_default();
    let lines: Vec<&str> = text.split_inclusive('\n').collect();
    let mut kept = String::new();
    let mut at = 0;
    while at < lines.len() {
        if lines[at].trim() == TASKS_IGNORE_MARK && lines.get(at + 1).is_some_and(|line| line.trim() == ROOT_TASKS_IGNORE) {
            at += 2;
            continue;
        }
        kept.push_str(lines[at]);
        at += 1;
    }
    write_file(&project.root_ignore(), &kept)
}

/// The lines of the notes block under its mark: the two lines that open the folder `.claude`
/// again, then one `!` line per notes file.
fn notes_block_lines() -> Vec<String> {
    NOTES_REOPEN.iter().map(|line| line.to_string()).chain(NOTES_FILES.iter().map(|file| format!("!{file}"))).collect()
}

/// The step "Project notes in git" (ticket project-notes-in-git). On, it is done when git ignores
/// none of the notes files; Apply then writes nothing (user decision 1). Off, it is done when the
/// block of Dispatch is absent; the notes that git tracks stay in git.
fn notes_step(project: &Project, on: bool) -> Step {
    let target = project.root_ignore().to_string_lossy().into_owned();
    let files = NOTES_FILES.join(", ");
    if !on {
        let ours = project.notes_block_present();
        let detail = if ours {
            "Off. Apply removes the lines of Dispatch from .gitignore; your line .claude/ ignores the folder again. The notes that git tracks stay in git; take a file out with git rm --cached (it stays on the disk). Commit to git then commits .gitignore.".to_string()
        } else {
            "Off. The notes of Claude in .claude stay as they are.".to_string()
        };
        return Step { title: NOTES_STEP, target, done: !ours, detail, rules: None };
    }
    let detail = format!(
        "Git tracks the notes of Claude for this project: {files}. A clone has them. When git ignores one of them, Apply adds these lines under a comment line at the end of .gitignore of the project: {}. Your own line .claude/ stays. {LOCAL_SETTINGS} and .claude/state stay on this computer. Commit to git then commits .gitignore and the notes. Dispatch commits later changes of memory.md, mistakes.md and agents-override.md with the task files.",
        notes_block_lines().join(", ")
    );
    Step { title: NOTES_STEP, target, done: !project.notes_ignored(), detail, rules: None }
}

/// Removes an old notes block of Dispatch and adds the block at the end of the root `.gitignore`,
/// so it stands after a line `.claude/` of the user. Makes the file when it is absent.
fn add_notes_block(project: &Project) -> Result<(), String> {
    remove_notes_block(project)?;
    let mut text = fs::read_to_string(project.root_ignore()).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&format!("{NOTES_IGNORE_MARK}\n"));
    for line in notes_block_lines() {
        text.push_str(&format!("{line}\n"));
    }
    write_file(&project.root_ignore(), &text)
}

/// Removes each notes block of Dispatch from the root `.gitignore`: the mark line and each directly
/// following line of the block. The other lines stay as they are, with their line ends. Without a
/// mark the file stays untouched.
fn remove_notes_block(project: &Project) -> Result<(), String> {
    if !project.notes_block_present() {
        return Ok(());
    }
    let block = notes_block_lines();
    let text = fs::read_to_string(project.root_ignore()).unwrap_or_default();
    let mut kept = String::new();
    let mut in_block = false;
    for line in text.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed == NOTES_IGNORE_MARK {
            in_block = true;
            continue;
        }
        if in_block && block.iter().any(|ours| ours == trimmed) {
            continue;
        }
        in_block = false;
        kept.push_str(line);
    }
    write_file(&project.root_ignore(), &kept)
}

/// Commits the removal of the task files from git, and nothing else: the commit goes through an
/// index of its own, made from HEAD, so the staged changes of the user stay staged (user decision 2).
/// Then the index of the repository drops the task files too. The files stay on the disk.
fn untrack_tasks(project: &Project) -> Result<(), String> {
    untrack(project, TASKS_DIR, TASKS_LOCAL_MESSAGE)
}

/// Whether a commit tracks a file under `.dispatch`.
fn tracks_tasks(project: &Project, rev: &str) -> bool {
    git(&project.root, &["ls-tree", "-r", "--name-only", rev, "--", TASKS_DIR]).is_some_and(|files| !files.trim().is_empty())
}

/// Commits the removal of the task files from git on a branch (ticket local-only-deletes-task-files),
/// the Rust twin of the removal half of `Align-Tasks` of the script. The current branch goes through
/// `untrack_tasks`. Another branch only moves its ref, through an index of its own: nothing is checked
/// out, and the files on the disk stay. `update-ref` takes the old tip, so a branch that moved
/// meanwhile is not overwritten.
fn untrack_tasks_at(project: &Project, branch: &str) -> Result<(), String> {
    if current_branch(project).as_deref() == Some(branch) {
        return untrack_tasks(project);
    }
    let reference = format!("refs/heads/{branch}");
    let tip = run_git(&project.root, &["rev-parse", "--verify", "--quiet", &reference])?.trim().to_string();
    let index = std::env::temp_dir().join(format!("dispatch-untrack-at-{}-{}.index", std::process::id(), stamp(&project.root.to_string_lossy())));
    let result = (|| {
        run_git_index(&project.root, Some(&index), &["read-tree", &tip])?;
        run_git_index(&project.root, Some(&index), &["rm", "-r", "--cached", "-q", "--ignore-unmatch", "--", TASKS_DIR])?;
        let tree = run_git_index(&project.root, Some(&index), &["write-tree"])?.trim().to_string();
        let commit = run_git(&project.root, &["commit-tree", &tree, "-p", &tip, "-m", TASKS_LOCAL_MESSAGE])?.trim().to_string();
        run_git(&project.root, &["update-ref", &reference, &commit, &tip]).map(|_| ())
    })();
    let _ = fs::remove_file(&index);
    result
}

/// Commits the removal of a file or a folder from git with a message, as `untrack_tasks` does: through
/// an index of its own, so the staged changes of the user stay staged. The files stay on the disk.
/// Also for the local settings (ticket second-computer): a commit with paths would take the file on
/// the disk again, so "Commit to git" cannot commit its removal.
fn untrack(project: &Project, path: &str, message: &str) -> Result<(), String> {
    // In the temp folder: `.git` is a file in a worktree.
    let index = std::env::temp_dir().join(format!("dispatch-untrack-{}-{}.index", std::process::id(), stamp(&project.root.to_string_lossy())));
    // Without a commit that has the files (no commit yet, or the files are only staged), there is
    // nothing to commit: the index of the repository drops them, and that is all.
    let in_head = git(&project.root, &["ls-tree", "-r", "--name-only", "HEAD", "--", path]).is_some_and(|files| !files.trim().is_empty());
    let result = (|| {
        if in_head {
            run_git_index(&project.root, Some(&index), &["read-tree", "HEAD"])?;
            run_git_index(&project.root, Some(&index), &["rm", "-r", "--cached", "-q", "--", path])?;
            run_git_index(&project.root, Some(&index), &["commit", "-q", "-m", message])?;
        }
        // `-f`: after the commit the index entry differs from HEAD, and from a file that Apply changed
        // (the local settings); `--cached` leaves the file on the disk.
        run_git(&project.root, &["rm", "-r", "-f", "--cached", "-q", "--ignore-unmatch", "--", path]).map(|_| ())
    })();
    let _ = fs::remove_file(&index);
    result
}

/// The step "Measure before the plan" (ticket measure-before-plan). Off, it is done and changes
/// nothing. On, it is done when the list has a command and git ignores the scratch folder; Apply
/// adds the ignore line, and only the user writes the commands.
fn measure_step(project: &Project, on: bool) -> Result<Step, String> {
    let target = project.measure_commands_file().to_string_lossy().into_owned();
    if !on {
        return Ok(Step {
            title: "Measure before the plan",
            target,
            done: true,
            detail: "Off. The plan run reads the code and runs three git commands that only read.".to_string(),
            rules: None,
        });
    }
    let commands = project.measure_commands();
    let reports = project.reports_text();
    let list = if commands.is_empty() {
        "No command yet: write at least one command in the box under the switch.".to_string()
    } else {
        commands.iter().enumerate().map(|(at, command)| format!("{}. {command}", at + 1)).collect::<Vec<_>>().join("\n")
    };
    Ok(Step {
        title: "Measure before the plan",
        target,
        done: !commands.is_empty() && project.measure_ignored(),
        detail: format!(
            "The plan run may run these commands before it writes the plan, and no other one:\n{list}\n\nEach runs with cmd.exe in the project folder through {script} measure <ticket-id> <n>, one at a time per project, for at most {limit} s (a first line \"# limit <seconds>\" of the list changes that). The output and the throw-away scripts go into {reports}/measure/<ticket-id>/; {{measure}} in a command stands for that folder. Apply adds the line {MEASURE_IGNORE} to {reports}/.gitignore, so git ignores the folder. The plan gets the section Measured. The options of the plan run (step Task files) and the section in CLAUDE.md say so.",
            script = script_command(&reports),
            limit = project.measure_limit(),
        ),
        rules: None,
    })
}

/// Adds a line (`measure/`, `merge/`) to `.dispatch/.gitignore`, and makes the file when it is absent.
fn ignore_line(project: &Project, line: &str) -> Result<(), String> {
    if project.ignores(line) {
        return Ok(());
    }
    let mut text = fs::read_to_string(project.tasks_ignore()).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(line);
    text.push('\n');
    write_file(&project.tasks_ignore(), &text)
}

/// Adds the line `tickets.jsonl merge=union` to `.dispatch/.gitattributes`, and makes the file when it
/// is absent. The other lines stay.
fn join_tickets(project: &Project) -> Result<(), String> {
    if project.joins_tickets() {
        return Ok(());
    }
    let mut text = fs::read_to_string(project.tasks_attributes()).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(TICKETS_UNION);
    text.push('\n');
    write_file(&project.tasks_attributes(), &text)
}

/// A model and an effort for one run of a worker. Empty: the settings of the user apply.
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Choice {
    model: String,
    effort: String,
}

/// The options of the plan run and of the work run of the workers of a project.
#[derive(Serialize)]
pub struct WorkerFlags {
    plan: Choice,
    work: Choice,
    /// The maximum number of agents that a worker runs at the same time in its work run. `0`: the
    /// worker starts no agent. Empty: the limit of Claude Code applies.
    agents: String,
    /// `CLAUDE.md` tells triage to run the script, which reads the options.
    ready: bool,
}

/// The defaults of the two runs: Fable plans, Opus works.
const PLAN_DEFAULT: (&str, &str) = ("fable", "xhigh");
const WORK_DEFAULT: (&str, &str) = ("opus", "xhigh");

/// The fixed part of the plan run, one argument per line: no permission prompt; the four tools
/// that only read plus Write, and no Edit, Agent or question tool; three git commands that only
/// read; and Write allowed in the plans folder only. Under `dontAsk` every other write is refused
/// without a prompt. There is no Edit tool because the local settings allow Edit on the whole
/// reports folder, which would reach a planner that had the tool. With "Measure before the plan"
/// on, the list also allows the `measure` verb of the worker script, which runs only the listed
/// commands, and Write in the scratch folder of the measuring; off, the lines are those of 0.1.54.
fn plan_fixed_lines(project: &Project) -> Result<Vec<String>, String> {
    let rule_path = project.rule_path();
    let plans = format!("{rule_path}/plans/**");
    let allowed = if project.options().measure_before_plan {
        let script = script_command(&project.reports_text());
        format!("Bash(git status*),Bash(git log *),Bash(git diff *),Bash({script} measure *),Write({plans}),Write({rule_path}/measure/**)")
    } else {
        format!("Bash(git status*),Bash(git log *),Bash(git diff *),Write({plans})")
    };
    Ok(vec![
        "--permission-mode".to_string(),
        "dontAsk".to_string(),
        "--tools".to_string(),
        "Read,Grep,Glob,Bash,Write".to_string(),
        "--allowedTools".to_string(),
        allowed,
    ])
}

/// Claude Code reads the maximum number of agents at the same time from this variable.
const AGENTS_VARIABLE: &str = "CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS";
/// The name of the tool that starts an agent.
const AGENT_TOOL: &str = "Agent";

/// The settings that give the agent limit to a worker. `None` means no limit from this app.
fn agent_settings(agents: &str) -> Result<Option<Value>, String> {
    match agents {
        "" => Ok(None),
        // A session without the tool starts no agent.
        "0" => Ok(Some(json!({ "permissions": { "deny": [AGENT_TOOL] } }))),
        count => {
            let count: u32 = count.parse().map_err(|_| format!("invalid number of agents: {count}"))?;
            let mut env = Map::new();
            env.insert(AGENTS_VARIABLE.to_string(), Value::String(count.to_string()));
            Ok(Some(json!({ "env": env })))
        }
    }
}

/// Reads the agent limit from the settings file of the workers.
fn read_agent_limit(path: &Path) -> String {
    let Ok(settings) = read_settings(path) else {
        return String::new();
    };
    if let Some(count) = settings.get("env").and_then(|env| env.get(AGENTS_VARIABLE)).and_then(Value::as_str) {
        return count.to_string();
    }
    let deny = settings.get("permissions").and_then(|permissions| permissions.get("deny"));
    let denied = deny.and_then(Value::as_array).is_some_and(|rules| rules.iter().any(|rule| rule == AGENT_TOOL));
    if denied { "0".to_string() } else { String::new() }
}

/// The `--model` and `--effort` arguments of a choice, one per line. A value has no space.
fn choice_lines(choice: &Choice) -> Result<Vec<String>, String> {
    Ok(session_flags(Some(&choice.model), Some(&choice.effort))?.split_whitespace().map(str::to_string).collect())
}

/// The lines of `plan-flags.txt`: the choice of the user, then the fixed part.
fn plan_flag_lines(project: &Project, plan: &Choice) -> Result<Vec<String>, String> {
    let mut lines = choice_lines(plan)?;
    lines.extend(plan_fixed_lines(project)?);
    Ok(lines)
}

/// The fixed part of the work run. The work run is a new session (ticket work-fresh-session); the
/// fixed part stays, so that the options file names the permission mode and the tools of the work
/// run in full and an older work run that resumes the plan session never keeps `dontAsk` and the
/// read tools of the plan run. `auto`: Claude
/// Code allows the edits and the usual commands itself and asks only for a command it judges
/// risky; that prompt blocks the worker until the user answers it in the agent view (user
/// decision 2026-11-08, over `bypassPermissions` with no prompt at all). No question tool: a
/// worker that asks in its session blocks, and a blocked session cannot be resumed without a
/// copy; a question goes into the report. No SendMessage: a worker sends no message to a chat
/// (cross-session messaging of Claude Code reaches triage and every other session of the user);
/// its questions and results reach the user only through the report and the Tasks card.
const WORK_FIXED_FLAGS: [&str; 6] = ["--permission-mode", "auto", "--tools", "default", "--disallowedTools", "AskUserQuestion,SendMessage"];

/// The settings file of the workers as `work-flags.txt` names it: relative to the project, so the
/// file is the same on each computer (ticket second-computer). The script makes it absolute.
fn worker_settings_text() -> String {
    format!("{TASKS_DIR}/worker-settings.json")
}

/// The work options file has the fixed part of this version. An older file lacks it.
/// A file that names the settings file of the workers must name it relative to the project: a
/// file of an older version names it with an absolute path (also of the old layout).
fn work_flags_current(project: &Project) -> bool {
    let fixed = WORK_FIXED_FLAGS.join("\n");
    let Ok(text) = fs::read_to_string(project.work_flags()) else { return false };
    let text = text.replace("\r\n", "\n");
    let settings = worker_settings_text();
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let settings_here = lines.iter().position(|line| *line == "--settings").map_or(true, |at| lines.get(at + 1) == Some(&settings.as_str()));
    text.contains(&fixed) && settings_here
}

/// The plan options file has the fixed part of this version, with the plans folder of this
/// project in its Write rule. A file from the old layout or from another computer names another folder.
fn plan_flags_current(project: &Project) -> bool {
    let Ok(fixed) = plan_fixed_lines(project) else { return false };
    fs::read_to_string(project.plan_flags()).is_ok_and(|text| text.replace("\r\n", "\n").contains(&fixed.join("\n")))
}

/// The lines of `work-flags.txt`: the choice of the user, the fixed part, then the settings file
/// with the agent limit when the user set one. The settings file is written here.
fn work_flag_lines(project: &Project, work: &Choice, agents: &str) -> Result<Vec<String>, String> {
    let mut lines = choice_lines(work)?;
    lines.extend(WORK_FIXED_FLAGS.iter().map(|flag| flag.to_string()));
    if let Some(settings) = agent_settings(agents)? {
        let file = project.worker_settings();
        write_file(&file, &format!("{}\n", serde_json::to_string_pretty(&settings).map_err(err)?))?;
        lines.push("--settings".to_string());
        // Relative to the project with `/`: each computer and each shell reads it the same.
        lines.push(worker_settings_text());
    }
    Ok(lines)
}

fn write_lines(path: &Path, lines: &[String]) -> Result<(), String> {
    write_file(path, &format!("{}\n", lines.join("\n")))
}

/// Writes the options of both runs. The Workers bar calls this on each change.
fn write_worker_flags(project: &Project, plan: &Choice, work: &Choice, agents: &str) -> Result<(), String> {
    write_lines(&project.plan_flags(), &plan_flag_lines(project, plan)?)?;
    write_lines(&project.work_flags(), &work_flag_lines(project, work, agents)?)
}

/// Writes the options files with their defaults when they are absent, so the script finds them.
/// An options file without the fixed part of this version, or with the paths of another folder,
/// is written again with its own choice (and agent limit).
fn default_flags(project: &Project) -> Result<(), String> {
    let choice = |(model, effort): (&str, &str)| Choice { model: model.to_string(), effort: effort.to_string() };
    if !plan_flags_current(project) {
        // A file that is not current keeps the choice of the user.
        let plan = if project.plan_flags().is_file() { read_choice(&project.plan_flags()) } else { choice(PLAN_DEFAULT) };
        write_lines(&project.plan_flags(), &plan_flag_lines(project, &plan)?)?;
    }
    if !project.work_flags().is_file() {
        write_lines(&project.work_flags(), &work_flag_lines(project, &choice(WORK_DEFAULT), "")?)?;
    } else if !work_flags_current(project) {
        let kept = read_worker_flags(project);
        write_lines(&project.work_flags(), &work_flag_lines(project, &kept.work, &kept.agents)?)?;
    }
    Ok(())
}

/// The choice in an options file: the line after `--model` and the line after `--effort`.
fn read_choice(path: &Path) -> Choice {
    let text = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let value = |option: &str| {
        let at = lines.iter().position(|line| *line == option);
        at.and_then(|at| lines.get(at + 1)).map(|value| value.to_string()).unwrap_or_default()
    };
    Choice { model: value("--model"), effort: value("--effort") }
}

fn read_worker_flags(project: &Project) -> WorkerFlags {
    let work_text = fs::read_to_string(project.work_flags()).unwrap_or_default();
    // The limit applies only when the work options name the settings file.
    let has_settings = work_text.lines().any(|line| line.trim() == "--settings");
    let agents = if has_settings { read_agent_limit(&project.worker_settings()) } else { String::new() };
    let ready = fs::read_to_string(project.instructions()).is_ok_and(|text| text.contains(SCRIPT_NAME));
    WorkerFlags { plan: read_choice(&project.plan_flags()), work: read_choice(&project.work_flags()), agents, ready }
}

/// Reads the options of the plan run and of the work run, and the agent limit, from the files
/// that the script reads.
pub fn worker_flags(cwd: String) -> Result<WorkerFlags, String> {
    Ok(read_worker_flags(&Project::find(&cwd)?))
}

/// Writes the options of the plan run and of the work run, and the agent limit, to the files
/// that the script reads.
pub fn set_worker_flags(cwd: String, plan: Choice, work: Choice, agents: String) -> Result<(), String> {
    write_worker_flags(&Project::find(&cwd)?, &plan, &work, &agents)
}

/// The folder of the project of a folder: the top folder of the git repository, or the folder.
pub fn project_root(cwd: String) -> Result<ProjectRoot, String> {
    let project = Project::find(&cwd)?;
    Ok(ProjectRoot {
        root: project.root.to_string_lossy().into_owned(),
        git: project.in_git,
        triage_prompt: project.triage_prompt().is_file(),
        triage_stamp: project.triage_prompt_text().map(|text| stamp(&text)).unwrap_or_default(),
        triage_name: project.options().triage_name,
        no_triage: project.options().no_triage,
    })
}

/// The first lines of a report, as the "Background workers" section asks for them: `state`,
/// `needs`, `files` and `plan`, each as `key: value` on its own line.
#[derive(Serialize, Default, PartialEq, Debug)]
pub struct ReportHeader {
    state: String,
    needs: String,
    files: String,
    plan: String,
}

/// One question of a report: a numbered item under the heading `## Questions`, with its options
/// as list items below it, the recommended option first.
#[derive(Serialize, PartialEq, Debug)]
pub struct Question {
    number: u32,
    text: String,
    options: Vec<String>,
}

/// Reads the header and the questions of a report. The header is lenient: title lines and empty
/// lines may come first, the four keys may come in any order, and the header ends at the first
/// empty line after its first key. A report without a `state` line has no header.
fn parse_report(text: &str) -> (Option<ReportHeader>, Vec<Question>) {
    let mut header = ReportHeader::default();
    let mut has_state = false;
    let mut lines = text.lines().map(str::trim).peekable();
    while lines.peek().is_some_and(|line| line.is_empty() || line.starts_with('#')) {
        lines.next();
    }
    for line in lines.take_while(|line| !line.is_empty()) {
        let Some((key, value)) = line.split_once(':') else { break };
        let value = value.trim().to_string();
        match key.trim().to_ascii_lowercase().as_str() {
            "state" => {
                header.state = value;
                has_state = true;
            }
            "needs" => header.needs = value,
            "files" => header.files = value,
            "plan" => header.plan = value,
            _ => break,
        }
    }

    let mut questions: Vec<Question> = Vec::new();
    let mut in_section = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            in_section = trimmed[3..].trim().eq_ignore_ascii_case("questions");
            continue;
        }
        if !in_section || trimmed.is_empty() {
            continue;
        }
        if let Some((number, rest)) = trimmed.split_once(". ") {
            if let Ok(number) = number.parse::<u32>() {
                questions.push(Question { number, text: rest.trim().to_string(), options: Vec::new() });
                continue;
            }
        }
        let Some(question) = questions.last_mut() else { continue };
        if let Some(option) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) {
            question.options.push(option.trim().to_string());
            continue;
        }
        // A wrapped line belongs to the option above it, or to the question when it has no option yet.
        let last = question.options.last_mut().unwrap_or(&mut question.text);
        last.push(' ');
        last.push_str(trimmed);
    }
    (has_state.then_some(header), questions)
}

/// The lines of a section of a Markdown text: from the `## ` heading with the title (the case
/// does not matter) to the next `## ` heading, without empty lines and without the list marks.
pub(crate) fn section_lines(text: &str, title: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut in_section = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("## ") {
            in_section = heading.trim().eq_ignore_ascii_case(title);
            continue;
        }
        if in_section && !trimmed.is_empty() {
            let item = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")).unwrap_or(trimmed);
            lines.push(item.trim().to_string());
        }
    }
    lines
}

/// A `## ` heading with the title (the case does not matter) stands in the text.
fn has_heading(text: &str, title: &str) -> bool {
    text.lines().filter_map(|line| line.trim().strip_prefix("## ")).any(|heading| heading.trim().eq_ignore_ascii_case(title))
}

/// The headings that mark a report of the new rule (decision 4 of the series), besides
/// `Verification`. `What changed` is no mark: reports from before the rule have it too (answer of
/// the user to question 1 of the work run).
const REPORT_HEADINGS: [&str; 3] = ["Why", "Files", "Follow-ups"];

/// A command with each run of whitespace as one space, for the match of a chosen check.
fn one_space(command: &str) -> String {
    command.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The check of a done report against the commands of its work run (ticket report-check, changed
/// by ticket the-report-check-uses-the-commands-of): the reason and the commands of the chosen
/// checks that did not run, or none when the report passes or is not checked. The worker writes
/// Verification in its own words, so its lines count for nothing here. Not checked: a report that
/// is not `done`, a task whose work run has no transcript on this machine (user decision 3), and a
/// report of the old form, without `## Verification` and without the new headings. A done report
/// whose work run ran no command goes back. `chosen` gives the name and the command of each check
/// that the user chose (ticket task-checks): each must stand in a command of the work run, also
/// inside a longer line, with runs of whitespace as one space (user decision 2).
fn check_report(text: &str, evidence: &[crate::core::flow::Evidence], work_transcript: bool, chosen: &[(String, String)]) -> Option<(String, Vec<String>)> {
    let (header, _) = parse_report(text);
    if header.is_none_or(|header| header.state != "done") || !work_transcript {
        return None;
    }
    if !has_heading(text, "Verification") && !REPORT_HEADINGS.iter().any(|title| has_heading(text, title)) {
        return None;
    }
    let work: Vec<String> = evidence.iter().filter(|item| item.stage == "WORK").map(|item| one_space(&item.command)).collect();
    if work.is_empty() {
        return Some(("The report says done, but its work run ran no command.".to_string(), Vec::new()));
    }
    let missing: Vec<&(String, String)> = chosen.iter().filter(|(_, command)| !work.iter().any(|ran| ran.contains(&one_space(command)))).collect();
    if missing.is_empty() {
        return None;
    }
    let names = missing.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>().join(", ");
    let what = if missing.len() == 1 { "the chosen check" } else { "the chosen checks" };
    Some((format!("The report says done, but {what} {names} did not run in its work run."), missing.iter().map(|(_, command)| command.clone()).collect()))
}

/// Applies the result of `check_report` to a task (ticket report-check) with the content of its
/// taken file (ticket take-as-done). Without a taken file a sent-back report gets the header
/// `working` and its reason in `did`. With one the header stays `done`, `did` keeps the gist, and
/// the result gives the time and the reason. Gives the claims and the taken note.
fn apply_report_check(header: &mut Option<ReportHeader>, did: &mut String, check: Option<(String, Vec<String>)>, taken: Option<&str>) -> (Vec<String>, Option<TakenInfo>) {
    let Some((reason, unverified)) = check else { return (Vec::new(), None) };
    if let Some(taken) = taken {
        let at = taken.trim().strip_prefix("taken:").and_then(|rest| rest.split_whitespace().next()).and_then(|number| number.parse().ok()).unwrap_or(0);
        return (unverified, Some(TakenInfo { at, reason }));
    }
    if let Some(header) = header.as_mut() {
        header.state = "working".to_string();
    }
    *did = reason;
    (unverified, None)
}

/// The lines that the task card shows for a plan, and whether a decision of the plan is `HOLD:`.
/// The lines come from the section `Summary`; a plan without it gives its `Goal`; a plan without
/// both gives its first lines. At most `SUMMARY_LINES` lines.
fn parse_plan(text: &str) -> (Vec<String>, bool) {
    let mut summary = section_lines(text, "Summary");
    if summary.is_empty() {
        summary = section_lines(text, "Goal");
    }
    if summary.is_empty() {
        summary = text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("<!--"))
            .map(str::to_string)
            .collect();
    }
    summary.truncate(SUMMARY_LINES);
    // A decision is HOLD when its line has the mark `HOLD:`; the word alone ("none is HOLD") is not.
    let hold = section_lines(text, "Decisions").iter().any(|line| {
        line.match_indices("HOLD:").any(|(at, _)| !line[..at].chars().next_back().is_some_and(|c| c.is_ascii_alphanumeric()))
    });
    (summary, hold)
}

const SUMMARY_LINES: usize = 5;

/// A plan without decisions (ticket simpler-process, change 2): it has the heading `## Decisions`,
/// `parse_decisions` finds none, no line is `HOLD`, and no line of the section starts with a number
/// and `.` or `)`, with `- `, `* ` or `#`. A section that the parser cannot read is not plain, so
/// such a plan waits for the click.
fn plan_is_plain(text: &str, hold: bool) -> bool {
    let heading = text.lines().any(|line| line.trim().strip_prefix("## ").is_some_and(|title| title.trim().eq_ignore_ascii_case("Decisions")));
    if !heading || hold || !parse_decisions(text).is_empty() {
        return false;
    }
    !section_text(text, "Decisions").iter().any(|line| {
        let line = line.trim_start();
        let digits = line.chars().take_while(char::is_ascii_digit).count();
        (digits > 0 && line[digits..].starts_with(['.', ')'])) || line.starts_with("- ") || line.starts_with("* ") || line.starts_with('#')
    })
}

/// The title of a brief or a plan: the text after the first `: ` of its first `# ` line
/// (`# task-stop: a Stop button` gives "a Stop button"). Empty without such a line.
fn title_after_colon(text: &str) -> String {
    let Some(title) = text.lines().map(str::trim).find_map(|line| line.strip_prefix("# ")) else {
        return String::new();
    };
    title.split_once(": ").map(|(_, rest)| rest.trim().to_string()).unwrap_or_default()
}

/// What a brief says the task is about: its title, else the first quoted line under the heading
/// "The user's words" without its quotes. Empty when it has neither.
pub(crate) fn parse_brief(text: &str) -> String {
    let title = title_after_colon(text);
    if !title.is_empty() {
        return title;
    }
    const QUOTES: &[char] = &['"', '\u{201C}', '\u{201D}'];
    section_lines(text, "The user's words")
        .into_iter()
        .find(|line| line.starts_with(QUOTES))
        .map(|line| line.trim_matches(QUOTES).trim().to_string())
        .unwrap_or_default()
}

/// The first line of the body of a report: after the header block (the `key: value` lines and
/// the empty line after them), the first line that is not empty and no heading, without its list
/// mark. A report of this pipeline puts "## What I did" there, so it is the first thing done.
fn report_gist(text: &str) -> String {
    let mut lines = text.lines().map(str::trim).peekable();
    while lines.peek().is_some_and(|line| line.is_empty() || line.starts_with('#')) {
        lines.next();
    }
    let is_key = |line: &str| {
        line.split_once(':')
            .is_some_and(|(key, _)| ["state", "needs", "files", "plan"].contains(&key.trim().to_ascii_lowercase().as_str()))
    };
    if lines.peek().is_some_and(|line| is_key(line)) {
        while lines.peek().is_some_and(|line| !line.is_empty()) {
            lines.next();
        }
    }
    let Some(line) = lines.find(|line| !line.is_empty() && !line.starts_with('#') && !line.starts_with("<!--")) else {
        return String::new();
    };
    let item = line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")).unwrap_or(line);
    // A numbered item loses its number too.
    let item = match item.split_once(". ") {
        Some((number, rest)) if number.parse::<u32>().is_ok() => rest,
        _ => item,
    };
    item.trim().to_string()
}

/// The lines of a `## ` section of a Markdown text as they stand, with their list marks and
/// indents (ticket task-log): from the heading with the title (the case does not matter) to the
/// next `## ` heading, without the empty lines at its start and its end. Empty without the section.
fn section_text(text: &str, title: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut in_section = false;
    for line in text.lines() {
        if let Some(heading) = line.trim().strip_prefix("## ") {
            in_section = heading.trim().eq_ignore_ascii_case(title);
            continue;
        }
        if in_section && !(lines.is_empty() && line.trim().is_empty()) {
            lines.push(line.trim_end().to_string());
        }
    }
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines
}

/// What the log of a task is made of (ticket task-log). `report`, `header`, `did` and `questions`
/// come from the report as the task list shows it, after the report check.
struct LogInput<'a> {
    id: &'a str,
    title: &'a str,
    /// `YYYY-MM-DD`.
    date: &'a str,
    plan: &'a str,
    report: Option<&'a str>,
    header: Option<&'a ReportHeader>,
    did: &'a str,
    questions: &'a [Question],
    evidence: &'a [crate::core::flow::Evidence],
    tokens: &'a [crate::core::flow::ModelUsage],
}

/// The report sections that the log takes, in its order (decision 4 of the series).
const LOG_SECTIONS: [&str; 5] = ["What changed", "Why", "Files", "Verification", "Follow-ups"];

/// The log of a task in the format of the illspace project (ticket task-log): the plan verbatim,
/// one EVIDENCE block per Bash command of each stage, the numbered stage entries, the report
/// sections as the report has them, and the token table. Lines end with `\n`.
fn task_log_text(input: &LogInput) -> String {
    let mut out: Vec<String> = Vec::new();
    let title = if input.title.is_empty() { input.id } else { input.title };
    out.push(format!("# {title} ({}) — {}", input.id, input.date));
    out.push(String::new());
    out.push("## Plan approved".to_string());
    out.extend(input.plan.replace("\r\n", "\n").trim_end().lines().map(str::to_string));
    out.push(String::new());
    out.push("## Stages".to_string());
    out.push(String::new());

    // The stage of the plan run: blocked while a HOLD decision waits for the user (user decision 2).
    let (summary, hold) = parse_plan(input.plan);
    let plan_word = if hold && !has_heading(input.plan, "User decisions") { "blocked" } else { "ok" };
    let decisions: Vec<String> = parse_decisions(input.plan).into_iter().map(|decision| decision.title).collect();
    let plan_entry = [
        format!("### 1. PLAN — {plan_word}"),
        summary.first().cloned().unwrap_or_else(|| "The plan has no Summary.".to_string()),
        format!("Files: .dispatch/plans/{}.md", input.id),
        format!("Blockers: {}", if decisions.is_empty() { "none".to_string() } else { decisions.join("; ") }),
    ];
    stage_lines(&mut out, "PLAN", input.evidence, &plan_entry);

    // The stage of the work run: ok for done, blocked for a question, a permission, a failure or a
    // report check that failed, nothing-to-do without a command and without a changed file.
    let state = input.header.map_or("", |header| header.state.as_str());
    let needs = input.header.map_or("", |header| header.needs.as_str());
    let files = input.header.map(|header| header.files.trim()).filter(|files| !files.is_empty()).unwrap_or("none");
    let work_commands = input.evidence.iter().any(|item| item.stage == "WORK");
    let work_word = if matches!(state, "needs-decision" | "failed" | "working") || needs == "permission" {
        "blocked"
    } else if !work_commands && files == "none" {
        "nothing-to-do"
    } else if state == "done" {
        "ok"
    } else {
        "blocked"
    };
    let gist = if input.report.is_none() { "No report yet." } else if input.did.is_empty() { "The report has no text." } else { input.did };
    let questions: Vec<String> = input.questions.iter().map(|question| format!("{}. {}", question.number, question.text)).collect();
    let work_entry = [
        format!("### 2. WORK — {work_word}"),
        gist.to_string(),
        format!("Files: {files}"),
        format!("Blockers: {}", if questions.is_empty() { "none".to_string() } else { questions.join("; ") }),
    ];
    stage_lines(&mut out, "WORK", input.evidence, &work_entry);

    let report = input.report.unwrap_or_default().replace("\r\n", "\n");
    for title in LOG_SECTIONS {
        out.push(format!("## {title}"));
        let lines = section_text(&report, title);
        if lines.is_empty() {
            out.push("none".to_string());
        }
        out.extend(lines);
        out.push(String::new());
    }

    out.push("### Token usage".to_string());
    out.push("| Model | Input | Cache write | Cache read | Output | Total |".to_string());
    out.push("|---|---|---|---|---|---|".to_string());
    for usage in input.tokens {
        let total = usage.input + usage.cache_write + usage.cache_read + usage.output;
        out.push(format!("| {} | {} | {} | {} | {} | {total} |", usage.model, usage.input, usage.cache_write, usage.cache_read, usage.output));
    }
    let mut text = out.join("\n");
    text.push('\n');
    text
}

/// One stage of the log: its marker, one EVIDENCE block per command of the stage, and its entry.
/// A line of a command after its first and each output line get an indent of 4 spaces.
fn stage_lines(out: &mut Vec<String>, stage: &str, evidence: &[crate::core::flow::Evidence], entry: &[String]) {
    out.push(format!("### STAGE: {stage}"));
    for item in evidence.iter().filter(|item| item.stage == stage) {
        out.push(format!("### EVIDENCE: {stage} {}", item.time.as_deref().unwrap_or("unknown")));
        let mut command = item.command.lines();
        out.push(format!("COMMAND: {}", command.next().unwrap_or_default()));
        out.extend(command.map(|line| format!("    {line}")));
        out.push(format!("EXIT: {}", item.exit));
        out.push("OUTPUT:".to_string());
        out.extend(item.output_tail.iter().map(|line| format!("    {line}")));
        out.push(String::new());
    }
    if evidence.iter().all(|item| item.stage != stage) {
        out.push(String::new());
    }
    out.extend(entry.iter().cloned());
    out.push(String::new());
}

/// Whether the task list writes the log of a task (ticket task-log), on the modification times in
/// milliseconds: a first log when the plan is there, a new one when the report or the plan is newer
/// than the log (user decision 1). Never without a plan, and not when nothing is newer.
fn log_needed(plan: Option<u64>, report: Option<u64>, log: Option<u64>) -> bool {
    let Some(plan) = plan else { return false };
    let Some(log) = log else { return true };
    plan > log || report.is_some_and(|report| report > log)
}

/// One decision of a plan: a numbered item of the section `Decisions` with its options as list
/// items. The plan rule puts the recommended option first, as `Default:` or as `HOLD:` when only
/// the user takes it; the others are `Other:`.
#[derive(Serialize, PartialEq, Debug)]
pub struct Decision {
    number: u32,
    title: String,
    /// The recommended option is `HOLD:`: the decision waits for the user.
    hold: bool,
    options: Vec<DecisionOption>,
}

#[derive(Serialize, PartialEq, Debug)]
pub struct DecisionOption {
    /// `default`, `hold` or `other`; `other` also for an option without a mark.
    kind: String,
    /// The option itself: the text up to its reason.
    choice: String,
    /// The reason that follows the choice: `Recommended: …` or `Not recommended: …`.
    reason: String,
}

/// Reads the decisions of a plan. A line with more indent than its item continues the item or
/// option above it; a line without indent that is no numbered item ends the item.
fn parse_decisions(text: &str) -> Vec<Decision> {
    let mut decisions: Vec<Decision> = Vec::new();
    let mut in_section = false;
    // The last item still takes wrapped lines.
    let mut open = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("## ") {
            in_section = heading.trim().eq_ignore_ascii_case("Decisions");
            open = false;
            continue;
        }
        if !in_section || trimmed.is_empty() {
            continue;
        }
        let indented = line.starts_with([' ', '\t']);
        if let Some((number, rest)) = trimmed.split_once(". ") {
            if let Ok(number) = number.parse::<u32>() {
                decisions.push(Decision { number, title: rest.trim().to_string(), hold: false, options: Vec::new() });
                open = true;
                continue;
            }
        }
        let Some(decision) = decisions.last_mut().filter(|_| open) else { continue };
        if let Some(item) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) {
            // A mark in bold, `**Default:** …`, is the same mark.
            let item = item.trim();
            let unbold = if item.starts_with("**") { item.replacen("**", "", 2) } else { item.to_string() };
            let item = unbold.trim();
            let (kind, rest) = if let Some(rest) = item.strip_prefix("HOLD:") {
                ("hold", rest)
            } else if let Some(rest) = item.strip_prefix("Default:") {
                ("default", rest)
            } else {
                ("other", item.strip_prefix("Other:").unwrap_or(item))
            };
            decision.hold |= kind == "hold";
            decision.options.push(DecisionOption { kind: kind.to_string(), choice: rest.trim().to_string(), reason: String::new() });
            continue;
        }
        if !indented {
            open = false;
            continue;
        }
        let last = match decision.options.last_mut() {
            Some(option) => &mut option.choice,
            None => &mut decision.title,
        };
        last.push(' ');
        last.push_str(trimmed);
    }
    // A plan can name the recommended option in the line of the decision itself, without option
    // lines (a friend's plan CAP-002, 2026-11-09): `1. Title. Default: the choice. Reason: …` or
    // `12. Title. HOLD: the choice. …`. Its first sentence is the option, the rest its reason.
    for decision in decisions.iter_mut().filter(|decision| decision.options.is_empty()) {
        let found = [("Default:", "default"), ("HOLD:", "hold")]
            .iter()
            .filter_map(|&(mark, kind)| decision.title.find(mark).map(|at| (at, mark, kind)))
            .min_by_key(|&(at, _, _)| at);
        let Some((at, mark, kind)) = found else { continue };
        let (choice, reason) = first_sentence(decision.title[at + mark.len()..].trim());
        decision.title = decision.title[..at].trim().to_string();
        decision.hold |= kind == "hold";
        decision.options.push(DecisionOption { kind: kind.to_string(), choice, reason });
    }
    // An alternative named inside a reason (CAP-003, 2026-11-09: "*Other option:* send the 8-byte
    // config …; not chosen, because …") is an option of its own: a button in Dispatch.
    for decision in decisions.iter_mut() {
        let mut others = Vec::new();
        for option in decision.options.iter_mut() {
            let (reason, found) = split_other_options(&option.reason);
            option.reason = reason;
            others.extend(found);
        }
        decision.options.extend(others);
    }
    // The reason starts at "Recommended" or "Not recommended" after the end of a sentence.
    for option in decisions.iter_mut().flat_map(|decision| decision.options.iter_mut()) {
        let at = [". Recommended", ". Not recommended"].iter().filter_map(|mark| option.choice.find(mark)).min();
        if let Some(at) = at {
            option.reason = option.choice[at + 2..].trim().to_string();
            option.choice.truncate(at);
        }
        option.choice = option.choice.trim().trim_end_matches('.').to_string();
    }
    decisions
}

/// Takes the alternatives that a reason names, `Other option: …` (also in `*…*` or `_…_`), out of
/// it. An alternative ends at "; not chosen" or with its first sentence; a following "not chosen,
/// because …" sentence is its reason. Gives the reason without them, and the alternatives.
fn split_other_options(text: &str) -> (String, Vec<DecisionOption>) {
    const MARK: &str = "other option:";
    let mut rest = text.to_string();
    let mut others = Vec::new();
    // ASCII lower case keeps the byte positions of the text.
    while let Some(at) = rest.to_ascii_lowercase().find(MARK) {
        let bytes = rest.as_bytes();
        let mut start = at;
        while start > 0 && matches!(bytes[start - 1], b'*' | b'_') {
            start -= 1;
        }
        let mut after = at + MARK.len();
        while after < bytes.len() && matches!(bytes[after], b'*' | b'_') {
            after += 1;
        }
        let before = rest[..start].trim().to_string();
        let tail = rest[after..].trim();
        let (choice, remainder) = match tail.find("; not chosen") {
            Some(cut) => (tail[..cut].trim().to_string(), tail[cut + 2..].trim().to_string()),
            None => first_sentence(tail),
        };
        let (why, after_why) = if remainder.starts_with("not chosen") { first_sentence(&remainder) } else { (String::new(), remainder) };
        others.push(DecisionOption { kind: "other".to_string(), choice: choice.trim_end_matches('.').to_string(), reason: why });
        rest = [before, after_why].iter().filter(|part| !part.is_empty()).cloned().collect::<Vec<_>>().join(" ");
    }
    (rest, others)
}

/// Splits a text after its first sentence: a `. ` before a capital letter or a backtick, not
/// inside a code span (`MANUAL p. N` stays whole, and so does `p. 50`). The rest loses a leading
/// `Reason:`. Without such an end the whole text is the first sentence.
fn first_sentence(text: &str) -> (String, String) {
    let mut in_code = false;
    for (at, c) in text.char_indices() {
        if c == '`' {
            in_code = !in_code;
        } else if c == '.' && !in_code && text[at + 1..].starts_with(' ') {
            let next = text[at + 2..].chars().next();
            if next.is_some_and(|next| next.is_uppercase() || next == '`') {
                let rest = text[at + 2..].trim();
                let rest = rest.strip_prefix("Reason:").map_or(rest, str::trim);
                return (text[..at].trim().to_string(), rest.to_string());
            }
        }
    }
    (text.trim().trim_end_matches('.').to_string(), String::new())
}

/// Puts a section with the decisions of the user at the end of a plan, in place of an earlier one.
fn with_user_decisions(plan: &str, body: &str) -> String {
    with_section(plan, "## User decisions", body)
}

/// Puts a section with a heading at the end of a plan, in place of an earlier section with the
/// same heading (the user decisions, and the checks that the user chose, ticket task-checks).
fn with_section(plan: &str, heading: &str, body: &str) -> String {
    let crlf = plan.contains("\r\n");
    let mut kept: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in plan.lines() {
        if line.trim_start().starts_with("## ") {
            skipping = line.trim().eq_ignore_ascii_case(heading);
        }
        if !skipping {
            kept.push(line);
        }
    }
    while kept.last().is_some_and(|line| line.trim().is_empty()) {
        kept.pop();
    }
    let text = format!("{}\n\n{heading}\n\n{}\n", kept.join("\n"), body.trim());
    if crlf { text.replace('\n', "\r\n") } else { text }
}

/// Writes the decisions of the user into the plan of a task, before Approve starts its work run:
/// the work run reads the plan, so it takes them. Gives the new change time of the plan file in
/// milliseconds, so an automatic approval does not take the written plan for a new one.
pub fn task_decide(cwd: String, id: String, text: String) -> Result<u64, String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    let path = project.plans().join(format!("{id}.md"));
    let plan = fs::read_to_string(&path).map_err(|error| format!("no plan at {}: {error}", path.display()))?;
    write_file(&path, &with_user_decisions(&plan, &text))?;
    Ok(file_entry(&path).map_or(0, |entry| entry.modified))
}

/// The text of the section `Checks chosen` (ticket task-checks): a stamp line, then one line per
/// check of the list, `[x]` with its command for a chosen one, `[ ]` for the others.
fn checks_chosen_text(list: &[Check], names: &[String], stamp: &str) -> String {
    let mut lines = vec![
        format!("The user chose these checks in Dispatch on {stamp}. The work run runs each checked one with the command as written here, and names that exact command in Verification."),
        String::new(),
    ];
    for check in list {
        if names.iter().any(|name| name.trim().eq_ignore_ascii_case(&check.name)) {
            lines.push(format!("- [x] {} — `{}`", check.name, check.command));
        } else {
            lines.push(format!("- [ ] {}", check.name));
        }
    }
    lines.join("\n")
}

/// The lines of `<ticket>.checks` (ticket task-checks): the name, a tab and the command of each
/// chosen check, in the order of the list. Empty when the user chose none.
fn task_checks_text(list: &[Check], names: &[String]) -> String {
    list.iter()
        .filter(|check| names.iter().any(|name| name.trim().eq_ignore_ascii_case(&check.name)))
        .map(|check| format!("{}\t{}\n", check.name, check.command))
        .collect()
}

/// Writes the checks that the user chose for a task, before Approve starts its work run (ticket
/// task-checks, user decision 2): the section `Checks chosen` at the end of the plan and the file
/// `<ticket>.checks`. A name that is not in the list of the project is left out. Without the list
/// it writes nothing. Gives the change time of the plan file in milliseconds, as `task_decide`.
pub fn task_checks(cwd: String, id: String, names: Vec<String>) -> Result<u64, String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    let path = project.plans().join(format!("{id}.md"));
    let plan = fs::read_to_string(&path).map_err(|error| format!("no plan at {}: {error}", path.display()))?;
    let list = project.checks();
    if !list.is_empty() {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64);
        let stamp = format!("{} UTC", crate::core::tickets::iso(now)[..16].replace('T', " "));
        write_file(&path, &with_section(&plan, CHECKS_CHOSEN_HEADING, &checks_chosen_text(&list, &names, &stamp)))?;
        write_file(&project.task_checks_file(&id), &task_checks_text(&list, &names))?;
    }
    Ok(file_entry(&path).map_or(0, |entry| entry.modified))
}

/// Writes the line of one run (`plan` or `work`) into `<ticket>.models` and keeps the line of the
/// other run. None, or a choice without a model and an effort, removes the line; the file goes when
/// it has no line. The values are checked as the options of a session.
fn write_run_choice(project: &Project, id: &str, run: &str, choice: Option<&Choice>) -> Result<(), String> {
    check_ticket(id)?;
    let path = project.models_file(id);
    let text = fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> =
        text.lines().map(str::trim).filter(|line| !line.is_empty() && line.split_whitespace().next() != Some(run)).map(str::to_string).collect();
    if let Some(choice) = choice.filter(|choice| !choice.model.is_empty() || !choice.effort.is_empty()) {
        session_flags(Some(&choice.model), Some(&choice.effort))?;
        let value = |text: &str| if text.is_empty() { "-".to_string() } else { text.to_string() };
        lines.push(format!("{run} {} {}", value(&choice.model), value(&choice.effort)));
        lines.sort_by_key(|line| line.split_whitespace().next() != Some("plan"));
    }
    if lines.is_empty() {
        return match fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(format!("{}: {error}", path.display())),
            _ => Ok(()),
        };
    }
    write_file(&path, &format!("{}\n", lines.join("\n")))
}

/// The `plan` line of `<ticket>.models` from the level of the ticket.
fn write_level(project: &Project, ticket: &crate::core::tickets::Ticket) -> Result<(), String> {
    let (model, effort) = crate::core::tickets::level_choice(&ticket.level);
    write_run_choice(project, &ticket.id, "plan", Some(&Choice { model: model.to_string(), effort: effort.to_string() }))
}

/// Writes the model and the effort of the level of a ticket for its plan run, before Dispatch sends
/// the ticket to triage (ticket ticket-form-optional-fields-on-a-new): triage runs the plan verb with
/// the ticket id, and the script reads the file.
pub fn ticket_level_file(cwd: String, id: String) -> Result<(), String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    let ticket = crate::core::tickets::find(&crate::core::tickets::list(&project), &id)?;
    write_level(&project, &ticket)
}

/// Writes the model and the effort of the work run of a task, before Approve starts it (ticket
/// ticket-form-optional-fields-on-a-new): the advice of the plan or the change of the user. An empty
/// model and an empty effort remove the line, and the options of `work-flags.txt` apply.
pub fn task_work(cwd: String, id: String, model: String, effort: String) -> Result<(), String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    let choice = Choice { model: model.trim().to_string(), effort: effort.trim().to_string() };
    write_run_choice(&project, &id, "work", Some(&choice))
}

/// One part of the section `Parts` of a plan (ticket subtickets): a piece of the work that follows the
/// work run of the plan, as its own ticket.
#[derive(Serialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlanPart {
    pub(crate) title: String,
    /// `simple`, `medium` or `hard` as the plan wrote it; empty: Medium.
    pub(crate) level: String,
    /// The type as the plan wrote it; empty: the guess from the Goal.
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) goal: String,
    pub(crate) fields: crate::core::tickets::TicketFields,
}

/// The parts of a plan (ticket subtickets): the numbered items `N. <title>` of the section `Parts`
/// with their list lines `Level:`, `Type:`, `Goal:` and the fields of the ticket form (`Why:`, `Done
/// when:`, `Do not change:`, `Context:`, `What I see:`, `What I expect:`), keys in any case and
/// backticks stripped; a wrapped line joins the line above. A plan without the section gives none.
pub(crate) fn plan_parts(text: &str) -> Vec<PlanPart> {
    let mut parts: Vec<PlanPart> = Vec::new();
    let mut in_section = false;
    // The key of the line above, for a wrapped line; empty: the title.
    let mut last = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("## ") {
            in_section = heading.trim().eq_ignore_ascii_case("parts");
            continue;
        }
        if !in_section || trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let clean = trimmed.replace('`', "");
        if let Some((number, rest)) = clean.split_once(". ") {
            if number.parse::<u32>().is_ok() {
                parts.push(PlanPart { title: rest.trim().trim_matches('*').trim().to_string(), ..PlanPart::default() });
                last.clear();
                continue;
            }
        }
        let Some(part) = parts.last_mut() else { continue };
        let item = clean.strip_prefix("- ").or_else(|| clean.strip_prefix("* "));
        // A line without a key is a wrapped line: it joins the line above.
        let (key, value, wrapped) = match item.and_then(|item| item.split_once(':')) {
            Some((key, value)) => (key.trim().trim_matches('*').trim().to_ascii_lowercase(), value.trim().to_string(), false),
            None => (last.clone(), item.unwrap_or(&clean).trim().to_string(), true),
        };
        let fields = &mut part.fields;
        let slot = match key.as_str() {
            "" => &mut part.title,
            "level" => &mut part.level,
            "type" => &mut part.kind,
            "goal" => &mut part.goal,
            "why" => &mut fields.why,
            "done when" => &mut fields.done,
            "do not change" => &mut fields.keep,
            "context" => &mut fields.context,
            "what i see" => &mut fields.see,
            "what i expect" => &mut fields.expect,
            _ => continue,
        };
        if wrapped {
            if !slot.is_empty() {
                slot.push(' ');
            }
            slot.push_str(&value);
        } else {
            *slot = value;
        }
        last = key;
    }
    for part in &mut parts {
        part.level = part.level.trim_end_matches(['.', ',', ';']).trim().to_ascii_lowercase();
        part.kind = part.kind.trim_end_matches(['.', ',', ';']).trim().to_ascii_lowercase();
    }
    parts.retain(|part| !part.title.is_empty() || !part.goal.is_empty());
    parts
}

/// The advice of a plan for its work run (ticket ticket-form-optional-fields-on-a-new): the lines
/// `model: <value>` and `effort: <value>` of the section `Work run`, with a leading `- ` and
/// backticks stripped and the keys in any case. None when a value is missing or invalid.
fn plan_work_choice(text: &str) -> Option<Choice> {
    let (mut model, mut effort) = (String::new(), String::new());
    for line in section_lines(text, "Work run") {
        let line = line.trim().trim_start_matches("- ").trim_start_matches("* ").replace('`', "");
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim().split_whitespace().next().unwrap_or_default().trim_end_matches(['.', ',', ';']).to_ascii_lowercase();
        match key.trim().to_ascii_lowercase().as_str() {
            "model" if model.is_empty() => model = value,
            "effort" if effort.is_empty() => effort = value,
            _ => {}
        }
    }
    if model.is_empty() || effort.is_empty() || session_flags(Some(&model), Some(&effort)).is_err() {
        return None;
    }
    Some(Choice { model, effort })
}

/// Takes a done task as done although the report check sent it back (ticket take-as-done): writes
/// `<ticket>.taken` with the time. The report file does not change. Refuses without a report whose
/// header says `done`. Gives the time in milliseconds.
pub fn task_take_done(cwd: String, id: String) -> Result<u64, String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    let path = project.reports.join(format!("{id}.md"));
    let text = fs::read_to_string(&path).map_err(|error| format!("no report at {}: {error}", path.display()))?;
    if parse_report(&text).0.is_none_or(|header| header.state != "done") {
        return Err(format!("the report of {id} does not say done"));
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64);
    write_file(&project.taken_file(&id), &format!("taken: {now} {}\n", crate::core::tickets::iso(now)))?;
    Ok(now)
}

/// How the task of a ticket ended, for the Claude step of an action (ticket project-actions):
/// `Some(true)` when its report says done after the report check (also a task taken as done),
/// `Some(false)` when it says failed or the task was stopped, `None` while it runs. Reads the task list.
pub(crate) fn task_end(cwd: &str, ticket: &str) -> Result<Option<bool>, String> {
    let list = task_list(cwd.to_string())?;
    let Some(task) = list.tasks.iter().find(|task| task.name == ticket) else { return Ok(None) };
    if task.state == "stopped" {
        return Ok(Some(false));
    }
    Ok(match task.header.as_ref().map(|header| header.state.as_str()) {
        Some("done") => Some(true),
        Some("failed") => Some(false),
        _ => None,
    })
}

/// One task of a project, from the files of the reports folder. The frontend joins it with the
/// workers of the same name.
#[derive(Serialize)]
pub struct TaskInfo {
    name: String,
    /// The content of the state file of the script: `planning`, `approved`, `working` or
    /// `stopped`. Empty when the task has no state file.
    state: String,
    plan: Option<FileEntry>,
    /// The lines of the plan that the task card shows.
    summary: Vec<String>,
    /// A decision of the plan is `HOLD`: only the user takes it, so no automatic approval.
    hold: bool,
    /// The decisions of the plan, for the Decisions window.
    decisions: Vec<Decision>,
    report: Option<FileEntry>,
    header: Option<ReportHeader>,
    questions: Vec<Question>,
    /// The brief that triage wrote for the task, when it exists.
    brief: Option<FileEntry>,
    /// What the task is about in a few words: the title of its brief, else the user's words in
    /// the brief, else the title of its plan. Empty when none of them has it.
    about: String,
    /// The first line of the body of the report: what the worker did. Empty without a report.
    did: String,
    /// The lines of the section "The user's words" of the brief, for the Decisions window.
    /// Empty without a brief or without the section.
    words: Vec<String>,
    /// The lines of the section "Goal" of the plan, for the Decisions window. Empty without it.
    goal: Vec<String>,
    /// The lines of the section "TL;DR" of the plan, in plain words, for the Decisions window.
    /// Empty without it (a plan from before the rule).
    tldr: Vec<String>,
    /// The changed files outside `.dispatch` that a measuring command of the plan run left, as
    /// `git status --porcelain` lines (`measure/<ticket>/changed.txt`). Empty without a change.
    #[serde(rename = "measureChanged")]
    measure_changed: Vec<String>,
    /// The lines of `git status --porcelain` of the project that touch a file of this task (ticket
    /// leftover-files-block-tasks): they hold its approval, its start and its switch back. The whole
    /// list of the project when the script of the project is not the one of this version: that
    /// script refuses on any change.
    leftovers: Vec<String>,
    /// The branch of the task with "Task branches" on (`<ticket>.branch`), else none.
    branch: Option<BranchInfo>,
    /// The tokens of the sessions of `<ticket>.session` per model, each reply once (ticket
    /// task-tokens). Empty without the file or without a transcript.
    tokens: Vec<crate::core::flow::ModelUsage>,
    /// The tokens of each run of `<ticket>.session` with a transcript, by session id, each reply
    /// once under the first run that has it (ticket run-tokens). Empty without the file or without
    /// a transcript.
    #[serde(rename = "runTokens")]
    run_tokens: Vec<crate::core::flow::RunUsage>,
    /// The Bash commands of the plan run and the work run with their exit codes and output tails,
    /// from the transcripts of the sessions of `<ticket>.session` (ticket task-evidence). Empty
    /// without the file or without a transcript.
    evidence: Vec<crate::core::flow::Evidence>,
    /// The Verification claims of a done report that no Bash command of the evidence matches
    /// (ticket report-check). With a claim here, or without a Verification section, the header
    /// says `working` and `did` gives the reason. Empty when the report passes or is not checked.
    unverified: Vec<String>,
    /// The user took the task as done although the report check sent it back (ticket
    /// take-as-done): the header then says `done` and `unverified` keeps the claims. None else.
    taken: Option<TakenInfo>,
    /// The log of the task in `.dispatch/logs` (ticket task-log), when it exists.
    log: Option<FileEntry>,
    /// The checks of the project for this task, with the recommendation of the plan and the choice
    /// of the user (ticket task-checks). Empty without the list of the project.
    checks: Vec<CheckInfo>,
    /// A running action run names this ticket in a Claude step with "Approve the plan by itself"
    /// (ticket project-actions): the driver window approves its plan without the project setting.
    auto: bool,
    /// The plan has no decisions (`plan_is_plain`, ticket simpler-process): with "Start plans
    /// without decisions" on, Dispatch starts its work run without a click. False without a plan.
    plain: bool,
    /// The newest line of `<ticket>.session` names a session without a transcript on this computer:
    /// the run started on another computer, and no worker of it runs here (ticket second-computer).
    /// False without the file.
    elsewhere: bool,
    /// The advice of the plan for the model and the effort of the work run, from its section `Work
    /// run` (ticket ticket-form-optional-fields-on-a-new). None without the section or a valid value.
    #[serde(rename = "workChoice")]
    work_choice: Option<Choice>,
    /// The parts of the plan that follow its work run (ticket subtickets), for the task card before
    /// Approve. Empty without the section, and for the task of a part: a part makes no parts.
    parts: Vec<PlanPart>,
    /// The task is a part of a chain whose parent did not tick the night box (ticket subtickets, user
    /// decision 1): night mode does not start its work run.
    #[serde(rename = "nightHold")]
    night_hold: bool,
}

/// The decision of the user to take a task as done (ticket take-as-done): the time of the click
/// in milliseconds and the reason of the report check.
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TakenInfo {
    at: u64,
    reason: String,
}

/// The branch of a task (ticket task-branches): from its branch file and from git.
#[derive(Serialize, Clone, Default, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    /// `task/<ticket>`.
    name: String,
    /// The branch that the task branch starts from and merges into.
    base: String,
    /// The merge line of the branch file after the merge: `done <sha> <time>` after the merge of
    /// Dispatch, or `outside <what> <time>` that the task read writes when git says that the base
    /// holds the branch (ticket merged-outside); `<what>` is the short hash of the merge commit,
    /// `fast-forward` or `same-changes`. Empty before.
    merge: String,
    /// The push line of the branch file after a merge with "Push after the merge" on (ticket
    /// simpler-process): `pushed <remote>/<branch> <time>`, `failed <reason>` or `no-upstream`.
    /// Empty without one.
    push: String,
    /// The branch exists in git and waits for Merge: Approve made it, and no merge removed it. False
    /// after an outside merge too, although the branch may still stand in git.
    exists: bool,
    /// The main checkout is on this branch now.
    checked_out: bool,
    /// Why Dispatch did not switch the checkout back to the base, or empty.
    note: String,
}

/// Reads a branch file: the lines `branch:`, `base:`, `merge:` and `push:`. None without the file.
fn read_branch_file(path: &Path) -> Option<BranchInfo> {
    let text = fs::read_to_string(path).ok()?;
    let mut info = BranchInfo::default();
    for line in text.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        let value = value.trim().to_string();
        match key.trim() {
            "branch" => info.name = value,
            "base" => info.base = value,
            "merge" => info.merge = value,
            "push" => info.push = value,
            _ => {}
        }
    }
    (!info.name.is_empty() && !info.base.is_empty()).then_some(info)
}

/// Reads a session file (ticket task-tokens): the session id of each line `plan <id>` or
/// `work <id>`, in order, each id once. An id of other characters than letters, digits and hyphens
/// is left out: it becomes a part of a path. Empty without the file.
fn read_session_file(path: &Path) -> Vec<String> {
    read_session_runs(path).into_iter().map(|(_, id)| id).collect()
}

/// The `(run, session id)` lines of a session file, with the checks of `read_session_file`: the run
/// is `plan` or `work`, the id can be a part of a path, and an id counts once, under its first run
/// (ticket task-evidence: the run gives the stage of a command).
pub(crate) fn read_session_runs(path: &Path) -> Vec<(String, String)> {
    let mut runs: Vec<(String, String)> = Vec::new();
    for line in fs::read_to_string(path).unwrap_or_default().lines() {
        let mut words = line.split_whitespace();
        let (Some(run @ ("plan" | "work")), Some(id), None) = (words.next(), words.next(), words.next()) else { continue };
        if id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') && !runs.iter().any(|(_, known)| known == id) {
            runs.push((run.to_string(), id.to_string()));
        }
    }
    runs
}

/// The folder of the Claude Code transcripts: `.claude/projects` in the home folder of the user
/// (`USERPROFILE`, else `HOME`). The task list has no `Core`, so it takes the home folder from the
/// environment, as `extra_directories` does.
pub(crate) fn claude_projects_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".claude").join("projects"))
}

/// The modification time of a file.
fn modified(path: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(path).and_then(|meta| meta.modified()).ok()
}

/// The paths of the section "Files to change" of a plan (ticket leftover-files-block-tasks): each
/// path in backticks, and the first word of a list item when it is no backtick span. A path has a
/// `/` or a dot and no space; a trailing `,:;.)` goes. A folder keeps its trailing `/`. The worker
/// script reads the same rule (`Plan-Files`).
pub(crate) fn plan_files(text: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    let mut inside = false;
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            inside = trimmed.trim_start_matches('#').trim().eq_ignore_ascii_case("Files to change");
            continue;
        }
        if !inside {
            continue;
        }
        let mut tokens: Vec<&str> = Vec::new();
        if let Some(item) = trimmed.strip_prefix("- ").or_else(|| trimmed.strip_prefix("* ")) {
            if let Some(first) = item.split_whitespace().next().filter(|first| !first.starts_with('`')) {
                tokens.push(first);
            }
        }
        let spans: Vec<&str> = trimmed.split('`').collect();
        tokens.extend(spans.iter().enumerate().filter(|(at, _)| at % 2 == 1 && at + 1 < spans.len()).map(|(_, span)| *span));
        for token in tokens {
            let token = token.trim().trim_end_matches([',', ':', ';', '.', ')']);
            if token.is_empty() || token.chars().any(char::is_whitespace) || !(token.contains('/') || token.contains('.')) {
                continue;
            }
            let path = token.replace('\\', "/");
            let path = path.strip_prefix("./").unwrap_or(&path).to_string();
            if !path.is_empty() && !files.contains(&path) {
                files.push(path);
            }
        }
    }
    files
}

/// The lines of `git status --porcelain` that touch a file of a task (ticket
/// leftover-files-block-tasks): the path, or one of the two paths of a rename, is a task file, lies
/// in a task folder (a file that ends with `/`), or is an untracked folder that holds a task file.
/// Without case. The worker script reads the same rule (`Task-Leftovers`).
pub(crate) fn task_leftovers(lines: &[String], files: &[String]) -> Vec<String> {
    let files: Vec<String> = files.iter().map(|file| file.replace('\\', "/").to_lowercase()).collect();
    let touches = |path: &str| files.iter().any(|file| path == file || (file.ends_with('/') && path.starts_with(file.as_str())) || (path.ends_with('/') && file.starts_with(path)));
    lines
        .iter()
        .filter(|line| {
            line.get(3..).unwrap_or_default().split(" -> ").map(|path| path.trim().trim_matches('"').replace('\\', "/").to_lowercase()).any(|path| !path.is_empty() && touches(&path))
        })
        .cloned()
        .collect()
}

/// The lines of `git status --porcelain` that a work run wrote itself (ticket
/// task-branches-blocked-work): the newest file under the path (the new path of a rename, each file
/// of an untracked folder) is not later than `end` plus 2 s. A path without a file (a deletion) never
/// counts. The worker script reads the same rule (`Own-Changes`).
pub(crate) fn own_changes(root: &Path, lines: &[String], end: std::time::SystemTime) -> Vec<String> {
    let limit = end + std::time::Duration::from_secs(2);
    lines
        .iter()
        .filter(|line| {
            let Some(path) = line.get(3..).and_then(|paths| paths.split(" -> ").last()) else { return false };
            newest_file(&root.join(path.trim().trim_matches('"'))).is_some_and(|time| time <= limit)
        })
        .cloned()
        .collect()
}

/// The newest modification time of a file, or of the files in a folder and its subfolders. None
/// without a file. A link counts as a file.
fn newest_file(path: &Path) -> Option<std::time::SystemTime> {
    let meta = fs::symlink_metadata(path).ok()?;
    if !meta.is_dir() {
        return meta.modified().ok();
    }
    fs::read_dir(path).ok()?.filter_map(Result::ok).filter_map(|entry| newest_file(&entry.path())).max()
}

/// Commits the own changes of a work run (`own_changes`) by path on the current branch as
/// `<ticket> WIP (Dispatch: files of the work run)` (ticket task-branches-blocked-work).
fn commit_own(project: &Project, ticket: &str, lines: &[String]) -> Result<(), String> {
    let paths: Vec<String> = lines.iter().filter_map(|line| line.get(3..)).flat_map(|paths| paths.split(" -> ")).map(|path| path.trim().trim_matches('"').to_string()).filter(|path| !path.is_empty()).collect();
    let mut add = vec!["add", "--"];
    add.extend(paths.iter().map(String::as_str));
    run_git(&project.root, &add)?;
    let message = format!("{ticket} WIP (Dispatch: files of the work run)");
    let mut commit = vec!["commit", "-q", "-m", &message, "--"];
    commit.extend(paths.iter().map(String::as_str));
    run_git(&project.root, &commit).map(|_| ())
}

/// The files of a task (ticket leftover-files-block-tasks): the paths of "Files to change" of its
/// plan, and the files that its task branch changed since the base while the branch exists and is
/// not merged.
fn task_files(project: &Project, ticket: &str, branch: Option<&BranchInfo>) -> Vec<String> {
    let mut files = plan_files(&fs::read_to_string(project.plans().join(format!("{ticket}.md"))).unwrap_or_default());
    if let Some(info) = branch.filter(|info| info.merge.is_empty() && !info.name.is_empty() && !info.base.is_empty()) {
        if git(&project.root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{}", info.name)]).is_some() {
            let range = format!("{}...{}", info.base, info.name);
            for file in git(&project.root, &["diff", "--name-only", &range]).unwrap_or_default().lines().map(str::trim).filter(|file| !file.is_empty()) {
                if !files.iter().any(|known| known == file) {
                    files.push(file.to_string());
                }
            }
        }
    }
    files
}

/// Switches the main checkout back to the base of a task whose work run has ended (decision 3 of
/// task-branches): the report is newer than the state file (a reply makes the state newer), or the
/// task was stopped; a report time that the last checkout of the task branch wrote does not count,
/// and a work run that still runs holds the checkout on the branch (ticket branch-switch-on-reply;
/// a worker list that Dispatch cannot read holds nothing). Only while no uncommitted change touches a file of the task (ticket
/// leftover-files-block-tasks); other changes go along with the checkout. When the run surely ended,
/// its own changes in task files go onto the branch first as a WIP commit (`own_changes`, ticket
/// task-branches-blocked-work). Then the newer report of the task
/// comes from the branch (`report_from_branch`, ticket stale-report-loop), and every other task file that
/// the task branch changed in `.dispatch` comes onto the base, all in one commit, so the files of all
/// tasks stay readable and end on the base; the merge brings the rest. A task file that git cannot
/// take does not stop the others; the note names it. Gives whether it switched and that note, or the
/// note when it did not switch.
fn return_to_base(project: &Project, ticket: &str, info: &BranchInfo) -> Result<(bool, String), String> {
    let report = project.reports.join(format!("{ticket}.md"));
    let state_path = project.reports.join(format!("{ticket}.state"));
    let state = fs::read_to_string(&state_path).unwrap_or_default();
    let reported = (matches!((modified(&report), modified(&state_path)), (Some(report), Some(state)) if report >= state)
        || (report.is_file() && !state_path.is_file()))
        && !checkout_wrote_report(project, info, ticket, &report);
    let stopped = state.trim() == "stopped";
    let runs = work_run_runs(project, ticket);
    let ended = (stopped || reported) && runs != Some(true);
    if !ended {
        return Ok((false, String::new()));
    }
    let leftovers_now = || -> Result<Vec<String>, String> {
        let dirty: Vec<String> = run_git(&project.root, &["status", "--porcelain", "--", ".", NOT_TASKS])?.lines().map(str::to_string).collect();
        Ok(if dirty.is_empty() { Vec::new() } else { task_leftovers(&dirty, &task_files(project, ticket, Some(info))) })
    };
    let mut leftovers = leftovers_now()?;
    // A run that surely ended and forgot its WIP commit: its own files go onto the task branch
    // (ticket task-branches-blocked-work). An unreadable worker list commits nothing, because the
    // worker may still run; a later change of the user still holds the checkout.
    if !leftovers.is_empty() && (stopped || runs == Some(false)) {
        let end = if stopped { modified(&state_path) } else { modified(&report) };
        let own = end.map(|end| own_changes(&project.root, &leftovers, end)).unwrap_or_default();
        if !own.is_empty() {
            if let Err(error) = commit_own(project, ticket, &own) {
                return Err(format!("The checkout stays on {}: Dispatch could not commit the files of the work run: {error}", info.name));
            }
            leftovers = leftovers_now()?;
        }
    }
    if !leftovers.is_empty() {
        return Err(format!(
            "The checkout stays on {}: these changes in files of this task are not committed: {}. Commit, stash or undo them; Dispatch then switches back to {}.",
            info.name,
            leftovers.iter().map(|line| line.get(3..).unwrap_or(line).trim()).collect::<Vec<_>>().join(", "),
            info.base
        ));
    }
    // With "Task files local only" on, a branch that still tracks task files (made before the switch)
    // would delete them from the disk at the checkout of a base that tracks none: both branches drop
    // them from git first (ticket local-only-deletes-task-files).
    let local = project.options().ignore_tasks;
    if local {
        for branch in [info.name.as_str(), info.base.as_str()] {
            if tracks_tasks(project, branch) {
                if let Err(error) = untrack_tasks_at(project, branch) {
                    return Err(format!("The checkout stays on {}: Dispatch could not take the task files out of git on {branch}: {error}", info.name));
                }
            }
        }
    }
    // Git carries the other changes along, or refuses when a file differs on the base.
    if let Err(error) = run_git(&project.root, &["checkout", "-q", &info.base]) {
        return Err(format!("The checkout stays on {}: {error}", info.name));
    }
    // Local only: the disk holds the only copy of the task files, and no branch has one to take.
    if local {
        return Ok((true, String::new()));
    }
    let mut paths = Vec::new();
    let mut failed = Vec::new();
    // The newer report first: after a merge by hand the diff below no longer lists it.
    let report_path = format!("{TASKS_DIR}/{ticket}.md");
    match report_from_branch(project, ticket, info) {
        Ok(true) => paths.push(report_path.clone()),
        Ok(false) => {}
        Err(error) => failed.push(format!("{report_path} ({error})")),
    }
    // The task files that the branch changed since it left the base. Only `report_from_branch`
    // decides the report: an older copy of the branch never comes over a newer report of the base
    // (ticket branch-switch-on-reply).
    let range = format!("{}...{}", info.base, info.name);
    let changed = run_git(&project.root, &["diff", "--name-status", "--no-renames", &range, "--", TASKS_DIR])?;
    for line in changed.lines() {
        let Some((status, path)) = line.split_once('\t') else { continue };
        let path = path.trim().trim_matches('"').to_string();
        if paths.contains(&path) || path == report_path {
            continue;
        }
        if status.starts_with('D') {
            let _ = run_git(&project.root, &["rm", "-q", "--ignore-unmatch", "--", &path]);
        } else if let Err(error) = run_git(&project.root, &["checkout", &info.name, "--", &path]) {
            failed.push(format!("{path} ({error})"));
            continue;
        }
        paths.push(path);
    }
    let note = if failed.is_empty() {
        String::new()
    } else {
        format!("Dispatch switched back to {}, but could not take these task files from {}: {}", info.base, info.name, failed.join("; "))
    };
    // A later return (after a reply) finds the files of the first one on the base already. With
    // "Task files local only" on, the return ended after the checkout (ticket
    // local-only-deletes-task-files): a branch made before the switch still tracked task files.
    let mut status = vec!["status", "--porcelain", "--"];
    status.extend(paths.iter().map(String::as_str));
    if paths.is_empty() || run_git(&project.root, &status)?.trim().is_empty() {
        return Ok((true, note));
    }
    let message = format!("Dispatch: task files of {ticket}");
    let mut commit = vec!["commit", "-q", "-m", &message, "--"];
    commit.extend(paths.iter().map(String::as_str));
    run_git(&project.root, &commit).map(|_| (true, note))
}

/// Takes the report of a ticket from its task branch into the checkout of the base when the two
/// copies differ and the last commit of the report on the branch is as new as the one on the base or
/// newer (ticket stale-report-loop). After a merge by hand that kept the copy of the base, git lists
/// the report in no diff from the merge-base, and an old question would stand on the base for ever.
/// A report with an uncommitted change in the checkout, a newer copy on the base, and a branch
/// without the report stay as they are. It commits nothing; gives whether it took the file. With
/// "Task files local only" on it takes nothing: an old branch copy would come over the only copy on
/// the disk (ticket local-only-deletes-task-files).
fn report_from_branch(project: &Project, ticket: &str, info: &BranchInfo) -> Result<bool, String> {
    if project.options().ignore_tasks {
        return Ok(false);
    }
    let path = format!("{TASKS_DIR}/{ticket}.md");
    if run_git(&project.root, &["diff", "--name-only", &info.base, &info.name, "--", &path])?.trim().is_empty() {
        return Ok(false);
    }
    if git(&project.root, &["cat-file", "-e", &format!("{}:{path}", info.name)]).is_none() {
        return Ok(false);
    }
    let time = |rev: &str| git(&project.root, &["log", "-1", "--format=%ct", rev, "--", &path]).and_then(|time| time.trim().parse::<u64>().ok());
    let Some(branch) = time(&info.name) else { return Ok(false) };
    if time(&info.base).is_some_and(|base| base > branch) {
        return Ok(false);
    }
    if !run_git(&project.root, &["status", "--porcelain", "--", &path])?.trim().is_empty() {
        return Ok(false);
    }
    run_git(&project.root, &["checkout", &info.name, "--", &path])?;
    Ok(true)
}

/// Whether the last checkout of the task branch wrote the report file (ticket
/// branch-switch-on-reply): the newest reflog entry `checkout: moving from <x> to <branch>` changed
/// the report blob, and the report file is not later, in whole seconds, than that entry. Git writes
/// the files of a checkout before it moves HEAD, so such a file time comes from the checkout and
/// not from the worker. No such entry, or a git error: false.
fn checkout_wrote_report(project: &Project, info: &BranchInfo, ticket: &str, report: &Path) -> bool {
    let Some(log) = git(&project.root, &["log", "-g", "--date=unix", "--format=%gd%x09%H%x09%gs", "-n", "50", "HEAD"]) else { return false };
    let entries: Vec<Vec<&str>> = log.lines().map(|line| line.splitn(3, '\t').collect()).filter(|parts: &Vec<&str>| parts.len() == 3).collect();
    let target = format!(" to {}", info.name);
    let Some(at) = entries.iter().position(|parts| parts[2].starts_with("checkout: moving from ") && parts[2].trim_end().ends_with(&target)) else { return false };
    let Some(before) = entries.get(at + 1) else { return false };
    let Some(second) = entries[at][0].rsplit('{').next().and_then(|time| time.trim_end_matches('}').parse::<u64>().ok()) else { return false };
    let path = format!("{TASKS_DIR}/{ticket}.md");
    let blob = |commit: &str| git(&project.root, &["rev-parse", "-q", "--verify", &format!("{commit}:{path}")]).map(|blob| blob.trim().to_string());
    if blob(entries[at][1]) == blob(before[1]) {
        return false;
    }
    let Some(time) = modified(report).and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()) else { return false };
    time.as_secs() <= second
}

/// Whether the work run of a ticket runs (ticket branch-switch-on-reply), from the list of
/// `claude agents --json --all`. None when Dispatch cannot read the list.
#[cfg(not(test))]
fn work_run_runs(project: &Project, ticket: &str) -> Option<bool> {
    let output = crate::core::info::claude_command().args(["agents", "--json", "--all"]).stdin(Stdio::null()).no_window().output().ok()?;
    if !output.status.success() {
        return None;
    }
    worker_runs_in(&String::from_utf8_lossy(&output.stdout), &project.root, ticket)
}

/// The tests never run the real `claude`: they set the answer per project root. No answer: None.
#[cfg(test)]
fn work_run_runs(project: &Project, _ticket: &str) -> Option<bool> {
    work_run_override().lock().ok()?.get(&project.root).copied()
}

/// The answers of `work_run_runs` in the tests, by project root.
#[cfg(test)]
fn work_run_override() -> &'static std::sync::Mutex<std::collections::HashMap<PathBuf, bool>> {
    static RUNS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<PathBuf, bool>>> = std::sync::OnceLock::new();
    RUNS.get_or_init(Default::default)
}

/// Whether the work run of a ticket runs, from the JSON of `claude agents --json --all`: the newest
/// worker named `<ticket> [work]` or `<ticket>` (an older script) whose folder is the project root
/// (a worker without a folder counts) runs when its state is `working`, or `blocked` with the
/// status `waiting`. No such worker: false. Bad JSON: None.
fn worker_runs_in(json: &str, root: &Path, ticket: &str) -> Option<bool> {
    let sessions: Vec<Value> = serde_json::from_str(json).ok()?;
    let folder = |path: &str| {
        let path = path.replace('\\', "/").to_lowercase();
        let path = path.strip_prefix("//?/").unwrap_or(&path);
        path.trim_end_matches('/').to_string()
    };
    let root = folder(&root.to_string_lossy());
    let names = [format!("{ticket} [work]"), ticket.to_string()];
    let text = |session: &Value, key: &str| session.get(key).and_then(Value::as_str).map(str::to_string);
    let newest = sessions
        .iter()
        .filter(|session| text(session, "name").is_some_and(|name| names.contains(&name)))
        .filter(|session| text(session, "cwd").is_none_or(|cwd| folder(&cwd) == root))
        .max_by_key(|session| session.get("startedAt").and_then(Value::as_u64).unwrap_or(0));
    Some(newest.is_some_and(|session| match text(session, "state").as_deref() {
        Some("working") => true,
        Some("blocked") => text(session, "status").as_deref() == Some("waiting"),
        _ => false,
    }))
}

/// The branch of a task for the task list, after the return to the base when its work run has ended.
/// With `check_merged`, a branch that waits for Merge but that the base already holds (the user
/// merged it with git, ticket merged-outside) gets the merge line `outside <what> <time>` in its
/// branch file; the next task read commits it with the task files. While the checkout is on the base,
/// a newer report of the branch comes onto the base in one commit (ticket stale-report-loop). The
/// flag says that the checkout or a task file changed, so the task read reads the files again.
fn task_branch(project: &Project, ticket: &str, current: &str, check_merged: bool) -> Option<(BranchInfo, bool)> {
    let mut info = read_branch_file(&project.branch_file(ticket))?;
    let exists = |name: &str| git(&project.root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")]).is_some();
    info.exists = info.merge.is_empty() && exists(&info.name);
    info.checked_out = current == info.name;
    let mut changed = false;
    if info.checked_out && info.merge.is_empty() {
        match return_to_base(project, ticket, &info) {
            Ok((switched, note)) => {
                changed = switched;
                info.note = note;
                info.checked_out = current_branch(project).as_deref() == Some(info.name.as_str());
            }
            Err(note) => info.note = note,
        }
    } else if info.exists && !info.checked_out && current == info.base {
        match report_from_branch(project, ticket, &info) {
            Ok(true) => {
                changed = true;
                let message = format!("Dispatch: report of {ticket} from {}", info.name);
                let path = format!("{TASKS_DIR}/{ticket}.md");
                if let Err(error) = run_git(&project.root, &["commit", "-q", "-m", &message, "--", &path]) {
                    eprintln!("report of {ticket} taken from {} but not committed: {error}", info.name);
                }
            }
            Ok(false) => {}
            Err(error) => eprintln!("report of {ticket} not taken from {}: {error}", info.name),
        }
    }
    if check_merged && info.exists && !info.checked_out {
        if let Some(how) = merged_outside(project, &info) {
            let millis = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64);
            info.merge = format!("outside {how} {}Z", &crate::core::tickets::iso(millis)[..19]);
            info.exists = false;
            let text = format!("branch: {}\nbase: {}\nmerge: {}\n", info.name, info.base, info.merge);
            if let Err(error) = write_file(&project.branch_file(ticket), &text) {
                eprintln!("branch file of {ticket} not written after the outside merge: {error}");
            }
        }
    }
    Some((info, changed))
}

/// The tips of the branch and of the base that a check found unmerged, by project root and branch
/// name: the poll asks git again only when one of them moved (ticket merged-outside).
fn unmerged_tips() -> &'static std::sync::Mutex<std::collections::HashMap<(PathBuf, String), String>> {
    static TIPS: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<(PathBuf, String), String>>> = std::sync::OnceLock::new();
    TIPS.get_or_init(Default::default)
}

/// Whether the base holds a task branch, and by what: the short hash of the first merge commit
/// after the branch tip, `fast-forward` when the base holds the tip without a merge commit, or
/// `same-changes` when a merge would change nothing in the base (a squash or a rebase). None while
/// the branch has a change that the base lacks. One `rev-parse` per call; the two checks run only
/// when a tip moved since the last call that found the branch unmerged.
fn merged_outside(project: &Project, info: &BranchInfo) -> Option<String> {
    let tips = git(&project.root, &["rev-parse", &format!("refs/heads/{}", info.name), &info.base])?;
    let key = (project.root.clone(), info.name.clone());
    let tips = tips.split_whitespace().collect::<Vec<_>>().join(" ");
    if unmerged_tips().lock().ok()?.get(&key) == Some(&tips) {
        return None;
    }
    let how = if git(&project.root, &["merge-base", "--is-ancestor", &info.name, &info.base]).is_some() {
        let range = format!("{}..{}", info.name, info.base);
        let merges = git(&project.root, &["log", "--format=%h", "--ancestry-path", "--merges", "--reverse", &range]).unwrap_or_default();
        Some(merges.lines().next().map_or("fast-forward".to_string(), |sha| sha.trim().to_string()))
    } else {
        // git 2.38 and newer: the tree of a merge of the branch into the base. Equal to the tree of
        // the base, the merge adds nothing. An older git fails here, and only the first check counts.
        let merged = git(&project.root, &["merge-tree", "--write-tree", &info.base, &info.name]);
        let base_tree = git(&project.root, &["rev-parse", &format!("{}^{{tree}}", info.base)]);
        match (merged, base_tree) {
            (Some(merged), Some(tree)) if merged.lines().next().map(str::trim) == Some(tree.trim()) => Some("same-changes".to_string()),
            _ => None,
        }
    };
    if let Ok(mut known) = unmerged_tips().lock() {
        if how.is_some() {
            known.remove(&key);
        } else {
            known.insert(key, tips);
        }
    }
    how
}

/// The branch that the main checkout is on, or none (detached HEAD, no repository).
fn current_branch(project: &Project) -> Option<String> {
    git(&project.root, &["symbolic-ref", "--short", "-q", "HEAD"]).map(|name| name.trim().to_string()).filter(|name| !name.is_empty())
}

/// "Checks at the gate" works in the project (ticket simpler-process, change 3): the switch, task
/// branches and a gate command. Without one of them the work run runs the chosen checks.
fn checks_at_gate(project: &Project) -> bool {
    let options = project.options();
    options.checks_at_gate && options.task_branches && !project.merge_gate().is_empty()
}

/// The checks that the report check looks for in the work run: the chosen checks, or none with
/// "Checks at the gate" on, because the gate runs them at the merge (ticket simpler-process, change 3).
fn checks_to_look_for(project: &Project, checks: &[CheckInfo]) -> Vec<(String, String)> {
    if checks_at_gate(project) { Vec::new() } else { chosen_checks(checks) }
}

/// The reply of the `task_list` command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    tasks: Vec<TaskInfo>,
    /// The lines of `git status --porcelain` of the whole project outside the task files. An
    /// approval looks at `TaskInfo.leftovers`, the lines that touch the files of its task.
    dirty: Vec<String>,
    /// The setting of the project: Dispatch approves a plan without a `HOLD` decision itself.
    auto_approve: bool,
    /// The setting of the project: Dispatch starts the work run of a plan without decisions itself
    /// (ticket simpler-process, change 2).
    start_plain_plans: bool,
    /// The setting of the project, with task branches on: Merge pushes the base after the merge
    /// (ticket simpler-process, change 4).
    push_after_merge: bool,
    /// The setting of the project: Dispatch starts the plan run of a New ticket itself (ticket
    /// simpler-process-tickets).
    tickets_start_plans: bool,
    /// The setting of the project: no triage runs, Dispatch starts the plan of every New ticket
    /// (ticket no-triage-a-project-switch-no-triage-in).
    no_triage: bool,
    /// The setting of the project: Dispatch starts nothing new for it (ticket pause-tasks).
    paused: bool,
    /// When the project got its Dispatch setup: the creation time of the task folder (or of its
    /// oldest state file, see `setup_time`), which the first Apply makes and a later one keeps, in milliseconds since the Unix epoch. The chat
    /// list folds the chats from before it.
    setup: Option<u64>,
    /// The tickets of the project, in the order of the file (ticket tickets).
    tickets: Vec<crate::core::tickets::Ticket>,
    /// What the repair of conflict markers changed in this read, one note per file (ticket
    /// board-in-progress); empty mostly.
    repairs: Vec<String>,
    /// The ticket whose merge runs now (ticket task-branches): Approve waits for it.
    merging: Option<String>,
    /// The gate command of the merge step, for the Merge card; empty without one.
    gate: String,
    /// The actions of the Actions panel and their last runs (ticket project-actions).
    actions: crate::core::actions::ActionList,
}

/// The files with an extension in a folder: the name without the extension, the path, the entry.
pub(crate) fn files_with(dir: &Path, extension: &str) -> Vec<(String, PathBuf, FileEntry)> {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case(extension)))
        .filter_map(|path| {
            let name = path.file_stem()?.to_string_lossy().into_owned();
            let entry = file_entry(&path)?;
            Some((name, path, entry))
        })
        .collect()
}

/// When the project got its Dispatch setup, in milliseconds since the Unix epoch: the earliest
/// creation time of the task folder and of its state files. A move into a `.dispatch` that the
/// planned entries made first keeps the creation times of the moved state files.
fn setup_time(project: &Project) -> Option<u64> {
    let created = |path: &Path| {
        fs::metadata(path)
            .and_then(|meta| meta.created())
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|time| time.as_millis() as u64)
    };
    let folder = created(&project.reports)?;
    let states = files_with(&project.reports, "state").into_iter().filter_map(|(_, path, _)| created(&path));
    states.chain([folder]).min()
}

/// The tasks of the project of a folder: every ticket with a state file, a plan or a report.
/// The briefs and the options files are not tasks.
pub fn task_list(cwd: String) -> Result<TaskList, String> {
    let project = Project::find(&cwd)?;
    // One read of a project at a time (ticket stale-report-loop, the user's answer to question 1): the
    // frontend reads a project from the focused pane and from the overview at once, and a read that
    // ran while the other one took a report from a branch gave the old copy and met its git lock.
    let lock = read_lock(&project.root);
    let _held = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // The files are read before the branch step. When that step switched the checkout back or took
    // a newer report from a task branch, the files of this read are old: the same read reads them
    // again, so no window shows an old question for one poll (ticket stale-report-loop). Two reads
    // at most.
    let (list, moved) = read_tasks(&project)?;
    if !moved {
        return Ok(list);
    }
    // The second read finds nothing to repair: the notes of the first read stay.
    let repairs = list.repairs;
    read_tasks(&project).map(|(mut list, _)| {
        list.repairs.splice(0..0, repairs);
        list
    })
}

/// The lock of the task reads of a project folder: a second read waits until the first one has ended.
pub(crate) fn read_lock(root: &Path) -> std::sync::Arc<std::sync::Mutex<()>> {
    type Locks = std::sync::Mutex<std::collections::HashMap<PathBuf, std::sync::Arc<std::sync::Mutex<()>>>>;
    static LOCKS: std::sync::OnceLock<Locks> = std::sync::OnceLock::new();
    let mut locks = LOCKS.get_or_init(Default::default).lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.entry(root.to_path_buf()).or_default().clone()
}

/// One read of the tasks of a project for `task_list`, and whether the branch step changed the
/// checkout or a task file.
fn read_tasks(project: &Project) -> Result<(TaskList, bool), String> {
    // Task files with conflict markers get one side before the read (ticket board-in-progress).
    let repairs = repair_conflicts(project);
    let mut tasks: Vec<TaskInfo> = Vec::new();
    // The position of the task with a name; a new task when none has it.
    fn task_at(tasks: &mut Vec<TaskInfo>, name: &str) -> usize {
        if let Some(at) = tasks.iter().position(|task| task.name == name) {
            return at;
        }
        tasks.push(TaskInfo {
            name: name.to_string(),
            state: String::new(),
            plan: None,
            summary: Vec::new(),
            hold: false,
            decisions: Vec::new(),
            report: None,
            header: None,
            questions: Vec::new(),
            brief: None,
            about: String::new(),
            did: String::new(),
            words: Vec::new(),
            goal: Vec::new(),
            tldr: Vec::new(),
            measure_changed: Vec::new(),
            leftovers: Vec::new(),
            branch: None,
            tokens: Vec::new(),
            run_tokens: Vec::new(),
            evidence: Vec::new(),
            unverified: Vec::new(),
            taken: None,
            log: None,
            checks: Vec::new(),
            auto: false,
            plain: false,
            elsewhere: false,
            work_choice: None,
            parts: Vec::new(),
            night_hold: false,
        });
        tasks.len() - 1
    }
    for (name, path, _) in files_with(&project.reports, "state") {
        let at = task_at(&mut tasks, &name);
        tasks[at].state = fs::read_to_string(&path).unwrap_or_default().trim().to_string();
    }
    let check_list = project.checks();
    for (name, path, entry) in files_with(&project.plans(), "md") {
        let at = task_at(&mut tasks, &name);
        let text = fs::read_to_string(&path).unwrap_or_default();
        let (summary, hold) = parse_plan(&text);
        // The plan title is the "about" of a task whose brief does not give one.
        tasks[at].about = title_after_colon(&text);
        tasks[at].summary = summary;
        tasks[at].hold = hold;
        tasks[at].decisions = parse_decisions(&text);
        tasks[at].plain = plan_is_plain(&text, hold);
        tasks[at].goal = section_lines(&text, "Goal");
        tasks[at].tldr = section_lines(&text, "TL;DR");
        tasks[at].checks = plan_checks(&text, &check_list);
        tasks[at].work_choice = plan_work_choice(&text);
        tasks[at].parts = plan_parts(&text);
        tasks[at].plan = Some(entry);
    }
    for (name, path, entry) in files_with(&project.reports, "md") {
        let at = task_at(&mut tasks, &name);
        let text = fs::read_to_string(&path).unwrap_or_default();
        let (header, questions) = parse_report(&text);
        tasks[at].header = header;
        tasks[at].questions = questions;
        tasks[at].did = report_gist(&text);
        tasks[at].report = Some(entry);
    }
    // A measuring command that changed the working tree left a note in the scratch folder.
    for task in tasks.iter_mut() {
        let note = project.measure_dir().join(&task.name).join("changed.txt");
        task.measure_changed = fs::read_to_string(note).unwrap_or_default().lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect();
    }
    // The tokens of each task from the transcripts of its sessions (ticket task-tokens), and the
    // Bash commands of its runs (ticket task-evidence).
    let projects = claude_projects_dir();
    // The tasks with sessions of which no transcript is on this computer (ticket second-computer):
    // their log keeps what the computer of the sessions wrote.
    let mut no_transcript: Vec<String> = Vec::new();
    for task in tasks.iter_mut() {
        let sessions = read_session_file(&project.session_file(&task.name));
        let mut work_transcript = false;
        if let Some(projects) = projects.as_ref().filter(|_| !sessions.is_empty()) {
            task.tokens = crate::core::flow::token_usage(projects, &sessions);
            let runs = read_session_runs(&project.session_file(&task.name));
            task.run_tokens = crate::core::flow::run_token_usage(projects, &runs);
            task.evidence = crate::core::flow::evidence_of(projects, &runs);
            let transcript = crate::core::flow::has_transcript(projects, &sessions);
            task.elsewhere = runs.last().is_some_and(|(_, newest)| !crate::core::flow::has_transcript(projects, std::slice::from_ref(newest)));
            // A work run with its own transcript: an old work run that resumed the plan session
            // has its commands under the plan run, so it is not checked.
            work_transcript = runs.iter().any(|(run, id)| run == "work" && crate::core::flow::has_transcript(projects, std::slice::from_ref(id)));
            if !transcript {
                no_transcript.push(task.name.clone());
            }
        }
        // A done report needs a command of its work run, and a run of each check that the user
        // chose (ticket the-report-check-uses-the-commands-of). The report file stays; the task
        // list shows it as working. Without the transcript of the work run there is no check.
        if work_transcript && task.header.as_ref().is_some_and(|header| header.state == "done") {
            let text = fs::read_to_string(project.reports.join(format!("{}.md", task.name))).unwrap_or_default();
            let taken = fs::read_to_string(project.taken_file(&task.name)).ok();
            let check = check_report(&text, &task.evidence, work_transcript, &checks_to_look_for(project, &task.checks));
            (task.unverified, task.taken) = apply_report_check(&mut task.header, &mut task.did, check, taken.as_deref());
        }
    }
    // A brief alone makes no task; a task that exists gets its brief. The title of the brief is
    // what the ticket of the task takes (ticket tickets).
    let mut brief_titles: Vec<(String, String)> = Vec::new();
    for task in tasks.iter_mut() {
        let path = project.briefs().join(format!("{}.md", task.name));
        let Some(entry) = file_entry(&path) else { continue };
        let text = fs::read_to_string(&path).unwrap_or_default();
        let about = parse_brief(&text);
        if !about.is_empty() {
            brief_titles.push((task.name.clone(), about.clone()));
            task.about = about;
        }
        task.words = section_lines(&text, "The user's words");
        task.brief = Some(entry);
    }
    // The tickets (ticket tickets): the planned messages of the old layout become tickets, each
    // ticket follows its task, and a task with a ticket shows the title of the ticket. A failure is
    // logged; the next task read tries again.
    let mut tickets = crate::core::tickets::list(&project);
    {
        let brief = |name: &str| brief_titles.iter().find(|(task, _)| task == name).map_or("", |(_, title)| title.as_str());
        let branches_on = project.options().task_branches;
        let facts: Vec<crate::core::tickets::TaskFacts> = tasks
            .iter()
            .map(|task| {
                // The branch step runs after `follow`: the branch file gives the merge here (ticket
                // board-in-progress).
                let branch = read_branch_file(&project.branch_file(&task.name));
                let merged = branch.as_ref().is_some_and(|branch| !branch.merge.is_empty());
                let started = [project.reports.join(format!("{}.state", task.name)), project.session_file(&task.name)]
                    .iter()
                    .filter_map(|path| file_entry(path))
                    .map(|entry| entry.modified)
                    .max()
                    .unwrap_or(0);
                // The end of the task for the chain of its parts (ticket subtickets).
                let report_time = task.report.as_ref().map_or(0, |entry| entry.modified);
                let merge = if merged { file_entry(&project.branch_file(&task.name)).map_or(0, |entry| entry.modified) } else { 0 };
                crate::core::tickets::TaskFacts {
                    name: &task.name,
                    state: &task.state,
                    report: task.header.as_ref().map(|header| header.state.as_str()),
                    brief: brief(&task.name),
                    merged,
                    waits_merge: branch.is_some() && !merged && branches_on,
                    started,
                    ended: report_time.max(merge),
                }
            })
            .collect();
        if let Err(error) = crate::core::tickets::follow(&project, &mut tickets, &facts) {
            eprintln!("tickets not moved after their tasks: {error}");
        }
    }
    for task in tasks.iter_mut() {
        if let Some(ticket) = tickets.iter().find(|ticket| ticket.task_name() == task.name) {
            task.about = ticket.title.clone();
            // A part makes no parts, and its parent's night box decides its start at night (ticket subtickets).
            if !ticket.parent.is_empty() {
                task.parts.clear();
                task.night_hold = !tickets.iter().any(|parent| parent.id == ticket.parent && parent.night);
            }
        }
    }
    // The actions and their runs (ticket project-actions): a command step whose process ended with
    // Dispatch is marked failed, and a task of a running Claude step with "Approve the plan by
    // itself" gets `auto`.
    let actions = crate::core::actions::list(project);
    for task in tasks.iter_mut() {
        task.auto = actions.approves(&task.name);
    }
    // The log of each task with a plan (ticket task-log): a first one with the plan, a new one when
    // the report or the plan is newer than the log, before the commit of the task files. No log
    // during an unfinished git merge, and none from a plan or a report with conflict markers (ticket
    // board-in-progress).
    let unfinished = unfinished_git(project);
    for task in tasks.iter_mut() {
        let path = project.log_file(&task.name);
        let plan = task.plan.as_ref().map(|entry| entry.modified);
        let report = task.report.as_ref().map(|entry| entry.modified);
        // Without a transcript here the log would lose the commands and the tokens of the other
        // computer, and the two computers would commit their logs in turn.
        if !no_transcript.contains(&task.name) && log_needed(plan, report, file_entry(&path).map(|entry| entry.modified)) {
            let plan_text = fs::read_to_string(project.plans().join(format!("{}.md", task.name))).unwrap_or_default();
            let report_text = task.report.is_some().then(|| fs::read_to_string(project.reports.join(format!("{}.md", task.name))).unwrap_or_default());
            if unfinished || has_markers(&plan_text) || report_text.as_deref().is_some_and(has_markers) {
                task.log = file_entry(&path);
                continue;
            }
            let newest = plan.into_iter().chain(report).max().unwrap_or(0);
            let date = crate::core::tickets::iso(newest)[..10].to_string();
            let text = task_log_text(&LogInput {
                id: &task.name,
                title: &task.about,
                date: &date,
                plan: &plan_text,
                report: report_text.as_deref(),
                header: task.header.as_ref(),
                did: &task.did,
                questions: &task.questions,
                evidence: &task.evidence,
                tokens: &task.tokens,
            });
            if let Err(error) = write_file(&path, &text) {
                eprintln!("task log not written for {}: {error}", task.name);
            }
        }
        task.log = file_entry(&path);
    }
    // Dispatch commits the task files, but not while a work run may commit itself: a task approved
    // or working without a report. A run of another computer does not hold the commit (ticket
    // second-computer). A failure (an index lock of a git command of the user, no git
    // identity) is logged, and the next task read tries again.
    let work_live = tasks.iter().any(|task| matches!(task.state.as_str(), "approved" | "working") && task.report.is_none() && !task.elsewhere);
    if !work_live {
        if let Err(error) = keep_tasks_committed(&project) {
            eprintln!("task files not committed: {error}");
        }
    }
    // Task branches: the branch of each task, and the way back to the base after a work run. Only
    // the task branch that is checked out can switch back; a merge in progress keeps the checkout.
    // A switch back or a report taken from a branch sets `moved`: `task_list` reads again.
    let merging = project.merging();
    let mut moved = false;
    // A task that lost its branch file gets it again from its branch (ticket
    // local-only-deletes-task-files, user decision 2); the file then counts below.
    if project.in_git {
        restore_branch_files(project, &tasks);
    }
    if project.in_git && (project.options().task_branches || tasks.iter().any(|task| project.branch_file(&task.name).is_file())) {
        let current = if merging.is_none() { current_branch(&project).unwrap_or_default() } else { String::new() };
        for task in tasks.iter_mut() {
            // Only a branch whose card shows Merge is checked for an outside merge (ticket
            // merged-outside): a report that waits for nobody, or a stopped task. A worker that asked
            // a question before its first commit has a branch that the base holds, and its reply
            // must still run on the branch.
            let header = task.header.as_ref();
            let waits = header.is_some_and(|header| matches!(header.needs.as_str(), "decision" | "permission") || header.state == "needs-decision");
            let check = merging.is_none() && ((task.report.is_some() && !waits) || task.state == "stopped");
            if let Some((branch, changed)) = task_branch(project, &task.name, &current, check) {
                task.branch = Some(branch);
                moved |= changed;
            }
        }
    }
    // The changes of the project outside the task files; each task gets those that touch its files.
    let dirty: Vec<String> = if project.in_git {
        git(&project.root, &["status", "--porcelain", "--", ".", NOT_TASKS]).unwrap_or_default().lines().map(str::to_string).collect()
    } else {
        Vec::new()
    };
    if !dirty.is_empty() {
        // A script of an older version refuses an approval on any change, until Apply.
        let current = fs::read_to_string(project.script()).is_ok_and(|text| text.replace("\r\n", "\n") == WORKER_SCRIPT);
        for task in tasks.iter_mut() {
            task.leftovers = if current { task_leftovers(&dirty, &task_files(project, &task.name, task.branch.as_ref())) } else { dirty.clone() };
        }
    }
    let setup = setup_time(&project);
    let options = project.options();
    Ok((TaskList { tasks, dirty, auto_approve: options.auto_approve, start_plain_plans: options.start_plain_plans, push_after_merge: options.push_after_merge && options.task_branches, tickets_start_plans: options.tickets_start_plans, no_triage: options.no_triage, paused: options.paused, setup, tickets, repairs, merging, gate: project.merge_gate(), actions }, moved))
}

/// Writes the branch file of each task that has none while its branch `task/<ticket>` exists and is
/// not merged into the current branch (ticket local-only-deletes-task-files, user decision 2): a
/// checkout or a sync could delete the file, and the Merge card needs it. The base is the branch of
/// the oldest reflog entry `branch: Created from <base>` when that branch exists; else the current
/// branch when it is no task branch; else no file. One `for-each-ref` per read.
fn restore_branch_files(project: &Project, tasks: &[TaskInfo]) {
    let missing: Vec<&str> = tasks.iter().map(|task| task.name.as_str()).filter(|name| !project.branch_file(name).is_file()).collect();
    if missing.is_empty() {
        return;
    }
    let Some(refs) = git(&project.root, &["for-each-ref", "--format=%(refname:short)", "refs/heads/task/"]) else { return };
    let Some(current) = current_branch(project) else { return };
    let exists = |name: &str| git(&project.root, &["rev-parse", "--verify", "--quiet", &format!("refs/heads/{name}")]).is_some();
    for name in missing {
        let branch = format!("task/{name}");
        if !refs.lines().any(|line| line.trim() == branch) {
            continue;
        }
        if git(&project.root, &["merge-base", "--is-ancestor", &branch, &current]).is_some() {
            continue;
        }
        let log = git(&project.root, &["reflog", "show", "--format=%gs", &format!("refs/heads/{branch}")]).unwrap_or_default();
        let created = log.lines().rev().find(|line| !line.trim().is_empty()).and_then(|line| line.trim().strip_prefix("branch: Created from ")).map(str::trim);
        let base = match created.filter(|base| *base != "HEAD" && !base.starts_with("task/") && exists(base)) {
            Some(base) => base.to_string(),
            None if !current.starts_with("task/") => current.clone(),
            None => continue,
        };
        if let Err(error) = write_file(&project.branch_file(name), &format!("branch: {branch}\nbase: {base}\n")) {
            eprintln!("branch file of {name} not written again: {error}");
        }
    }
}

/// At most this many open tasks get their own part in the hand-off; the rest are counted.
const HANDOFF_TASKS: usize = 20;

/// The state of an open task in words, for the hand-off, or `None` for a task that is finished
/// or stopped. `live` says that a worker of the task works or waits at a prompt now, `queued` that
/// the user approved its plan and the work run waits for the project. The order of the checks is
/// the order of the task cards of Dispatch: what runs, then what waits for the user.
fn handoff_state(task: &TaskInfo, live: bool, queued: bool) -> Option<String> {
    let header = task.header.as_ref();
    let report_state = header.map_or("", |header| header.state.as_str());
    let needs = header.map_or("", |header| header.needs.as_str());
    if task.state == "stopped" {
        return None;
    }
    if live {
        let run = if task.state == "planning" { "plan" } else { "work" };
        return Some(format!("its {run} run works"));
    }
    if queued {
        return Some("approved in Dispatch, its work run waits until the project is free".to_string());
    }
    // A run of another computer without its result here (ticket second-computer).
    let open_run = (task.state == "planning" && task.plan.is_none()) || (matches!(task.state.as_str(), "approved" | "working") && task.report.is_none());
    if task.elsewhere && open_run {
        return Some("started on another computer; no worker of it runs here".to_string());
    }
    if needs == "permission" && task.questions.is_empty() {
        return Some("its worker stopped at a refused step; it waits for the user to change the rule and click Continue in its task card".to_string());
    }
    if needs == "decision" || needs == "permission" || report_state == "needs-decision" {
        return Some("its worker asks a question; it waits for the user's answer in its task card".to_string());
    }
    if task.state == "planning" {
        return Some(match (&task.plan, task.hold) {
            (Some(_), true) => "plan ready, it waits for Approve in Dispatch and has a decision that only the user takes".to_string(),
            (Some(_), false) => "plan ready, it waits for Approve in Dispatch".to_string(),
            (None, _) => "planning, but no plan run works and no plan file is there".to_string(),
        });
    }
    if report_state == "failed" {
        return Some("failed, see its report".to_string());
    }
    // A done report that the check sent back (ticket report-check): the task list says working.
    if report_state == "working" && task.report.is_some() {
        return Some("its report says done, but Dispatch found no command in the transcript for its Verification claims, or no claim for a check that the user chose; it stays open".to_string());
    }
    let unmerged = task.branch.as_ref().is_some_and(|branch| branch.exists && branch.merge.is_empty());
    if report_state == "done" && (needs.is_empty() || needs == "nothing") {
        return unmerged.then(|| "done, its branch waits for Merge in the task card of Dispatch".to_string());
    }
    if task.report.is_none() && (task.state == "approved" || task.state == "working") {
        return Some("approved, its work run is starting or ended without a report".to_string());
    }
    let word = [report_state, task.state.as_str()].into_iter().find(|word| !word.is_empty()).unwrap_or("unknown");
    Some(format!("state {word}"))
}

/// The first message of a new triage chat: what the chat before it left open, from the state
/// files, plans and reports of the project, and where those files are. It holds nothing of the
/// history of the old chat. One line: every line that Dispatch writes into a triage chat is one.
/// `live` and `queued` are ticket names (see `handoff_state`), `tokens` is the context of the old
/// chat, `reports` the reports folder with `/`, `script` the command of the worker script.
fn handoff_text(tasks: &[TaskInfo], live: &[String], queued: &[String], tokens: u64, reports: &str, script: &str) -> String {
    let mut sorted: Vec<&TaskInfo> = tasks.iter().collect();
    // The newest task first, as the task cards of Dispatch show them.
    let time = |task: &TaskInfo| task.plan.iter().chain(task.report.iter()).map(|entry| entry.modified).max().unwrap_or(0);
    sorted.sort_by(|a, b| time(b).cmp(&time(a)).then_with(|| a.name.cmp(&b.name)));
    let mut open = Vec::new();
    let mut closed = 0;
    for task in sorted {
        match handoff_state(task, live.contains(&task.name), queued.contains(&task.name)) {
            Some(state) => open.push(format!("{}: {state}", task.name)),
            None => closed += 1,
        }
    }
    let more = open.len().saturating_sub(HANDOFF_TASKS);
    open.truncate(HANDOFF_TASKS);
    let open_text = if open.is_empty() {
        "No task is open.".to_string()
    } else {
        let tail = if more > 0 { format!("; and {more} more") } else { String::new() };
        format!("Open tasks, newest first: {}{tail}.", open.join("; "))
    };
    let closed_text = match closed {
        0 => String::new(),
        1 => " 1 task is finished or stopped.".to_string(),
        n => format!(" {n} tasks are finished or stopped."),
    };
    let flat = |text: String| text.split_whitespace().collect::<Vec<_>>().join(" ");
    flat(format!(
        "Dispatch: this is a new triage chat of this project. The triage chat before it reached {}k tokens of context, so Dispatch closed it and started this one; this chat does not have its history, and the user can open the earlier chat in the chat list of Dispatch (marked \"earlier triage\"). {open_text}{closed_text} \
The files: briefs in {reports}/briefs/<ticket-id>.md, plans in {reports}/plans/<ticket-id>.md, reports in {reports}/<ticket-id>.md, the state of each task in {reports}/<ticket-id>.state; `{script} status` gives the state of each worker. \
Read a file only when its task comes up. Start, approve or answer nothing because of this message. Tell the user in one or two lines that this is a new triage chat and which tasks are open.",
        (tokens + 500) / 1000
    ))
}

/// The hand-off text for a new triage chat of the project of a folder. The frontend gives the
/// ticket names whose worker runs (`live`) and whose approval waits for the project (`queued`):
/// only it knows them.
pub fn triage_handoff(cwd: String, live: Vec<String>, queued: Vec<String>, tokens: u64) -> Result<String, String> {
    let project = Project::find(&cwd)?;
    let list = task_list(cwd)?;
    let reports = project.reports_text();
    Ok(handoff_text(&list.tasks, &live, &queued, tokens, &reports, &script_command(&reports)))
}

/// A ticket id is a file name and an argument of the script. Nothing else is accepted.
pub(crate) fn check_ticket(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
        return Err(format!("invalid ticket id: {id}"));
    }
    Ok(())
}

/// Runs the worker script with a verb and its arguments. The script's exit code 2 is a refusal,
/// and its reason on stderr is the error; the output of claude is the result.
pub(crate) fn run_script(project: &Project, args: &[&str]) -> Result<String, String> {
    // The merge verb refuses a caller with this variable: Claude Code sets it in its sessions. Dispatch
    // is no such session, also when a session started it (`session_variables` removes it there too).
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(project.script())
        .args(args)
        .env_remove("CLAUDECODE")
        .stdin(Stdio::null())
        .no_window()
        .output()
        .map_err(err)?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        Ok(stdout)
    } else if stderr.is_empty() {
        Err(format!("the worker script ended with {}", output.status))
    } else {
        Err(stderr)
    }
}

/// Starts the work run of a task: the Approve button of the task card. The script refuses a dirty
/// tree, a running worker and a stopped task.
pub fn task_approve(cwd: String, id: String) -> Result<String, String> {
    task_approve_with(&Project::find(&cwd)?, &id, &|project, args| run_script(project, args))
}

/// `task_approve` with the start of the script as an argument; a test gives a fake. After the script
/// started the work run, the parts of the plan become Backlog tickets of the ticket of the task (ticket
/// subtickets). A failed approve opens nothing; a task without a ticket opens nothing and logs it.
fn task_approve_with(project: &Project, id: &str, start: &dyn Fn(&Project, &[&str]) -> Result<String, String>) -> Result<String, String> {
    check_ticket(id)?;
    let output = start(project, &["approve", id])?;
    let plan = fs::read_to_string(project.plans().join(format!("{id}.md"))).unwrap_or_default();
    let parts = plan_parts(&plan);
    if !parts.is_empty() {
        let tickets = crate::core::tickets::list(project);
        match tickets.iter().find(|ticket| ticket.task_name() == id) {
            Some(ticket) => {
                if let Err(error) = crate::core::tickets::open_parts(project, &ticket.id, &parts) {
                    eprintln!("the parts of {id} got no tickets: {error}");
                }
            }
            None => eprintln!("the plan of {id} lists parts, but no ticket holds the task: no part ticket opened"),
        }
    }
    Ok(output)
}

/// The brief that Dispatch writes from a ticket of the tickets board (ticket simpler-process-tickets):
/// the heading with the id and the title (the task read takes the title from it), the user's words
/// and the paths of the pasted images. The plan run names the constraints and the proof command.
/// A filled optional field of the ticket (ticket ticket-form-optional-fields-on-a-new) adds its
/// section after the user's words (Why, Context, What I see, What I expect), Do not change goes into
/// the constraints and Done when into the proof; a ticket with only the Goal gives the brief of before.
/// `no_triage` names the switch that started it: "No triage" (ticket
/// no-triage-a-project-switch-no-triage-in) or "Tickets start their plan".
/// The section `## Parent and earlier parts` of the brief of a part (ticket subtickets): `chain` are
/// the lines of `chain_lines`, its first line `Part N of M of ticket <id>: <title>`. Empty for none.
fn chain_section(chain: &[String]) -> String {
    let Some((head, lines)) = chain.split_first() else { return String::new() };
    let head = head.strip_prefix("Part ").unwrap_or(head);
    let mut text = format!("## Parent and earlier parts\nThis ticket is part {head}. Its plan lists no parts.\n");
    for line in lines {
        text.push_str(line);
        text.push('\n');
    }
    text.push('\n');
    text
}

/// The commits of the current branch whose subject names a ticket id as a whole word, as `<hash> <subject>`.
fn ticket_commits(project: &Project, id: &str) -> Vec<String> {
    let log = git(&project.root, &["log", "--format=%h %s", "-F", &format!("--grep={id}")]).unwrap_or_default();
    let word = |c: char| c.is_ascii_alphanumeric() || c == '-' || c == '_';
    log.lines()
        .map(str::trim)
        .filter(|line| {
            let subject = line.split_once(' ').map_or("", |(_, subject)| subject);
            subject.match_indices(id).any(|(at, _)| {
                let before = subject[..at].chars().next_back();
                let after = subject[at + id.len()..].chars().next();
                !before.is_some_and(word) && !after.is_some_and(word)
            })
        })
        .map(str::to_string)
        .collect()
}

/// The chain of a part (ticket subtickets): first `Part N of M of ticket <parent id>: <parent title>`
/// (N and M without the parts that the user canceled), then the plan of the parent, then one line for
/// the parent and each earlier part with its id, its title, its end word and its commits. Empty for a
/// ticket without a parent.
pub(crate) fn chain_lines(project: &Project, tickets: &[crate::core::tickets::Ticket], ticket: &crate::core::tickets::Ticket) -> Vec<String> {
    use crate::core::tickets::{part_end, parts_of, PartEnd};
    if ticket.parent.is_empty() {
        return Vec::new();
    }
    let Some(parent) = tickets.iter().find(|one| one.id == ticket.parent) else { return Vec::new() };
    let parts: Vec<&crate::core::tickets::Ticket> = parts_of(tickets, &parent.id).into_iter().filter(|part| part_end(part) != PartEnd::Skipped || part.id == ticket.id).collect();
    let place = parts.iter().position(|part| part.id == ticket.id).map_or(0, |at| at + 1);
    let mut lines = vec![format!("Part {place} of {} of ticket {}: {}", parts.len(), parent.id, parent.title)];
    lines.push(format!("The plan of the parent: `{}/plans/{}.md`", project.reports_text(), parent.task_name()));
    // The end word of a closed ticket, else its column.
    let state = |one: &crate::core::tickets::Ticket| {
        let closed = one.status == crate::core::tickets::DONE || one.status == crate::core::tickets::CANCELED;
        if closed && !one.note.is_empty() { one.note.clone() } else { one.status.clone() }
    };
    for one in std::iter::once(parent).chain(parts.iter().copied().take(place.saturating_sub(1))) {
        let commits = ticket_commits(project, one.task_name());
        let commits = if commits.is_empty() { "no commit".to_string() } else { commits.join("; ") };
        let kind = if one.id == parent.id { "parent" } else { "part" };
        lines.push(format!("- {kind} {}: {} ({}); commits: {commits}", one.id, one.title, state(one)));
    }
    lines
}

/// The lines of the chain of a part for the message to triage (ticket subtickets): the page adds them
/// as the block `Part N of M of ticket <id>`. Empty for a ticket without a parent.
pub fn ticket_chain(cwd: String, id: String) -> Result<Vec<String>, String> {
    let project = Project::find(&cwd)?;
    let tickets = crate::core::tickets::list(&project);
    let ticket = crate::core::tickets::find(&tickets, &id)?;
    Ok(chain_lines(&project, &tickets, &ticket))
}

fn ticket_brief(ticket: &crate::core::tickets::Ticket, at: u64, no_triage: bool, chain: &[String]) -> String {
    let (paths, words) = crate::core::tickets::split_images(&ticket.summary);
    let mut said = words.trim().to_string();
    for path in &paths {
        if !said.is_empty() {
            said.push('\n');
        }
        said.push_str(path);
    }
    let date = format!("{} UTC", crate::core::tickets::iso(at)[..16].replace('T', " "));
    let switch = if no_triage { "(No triage)" } else { "(Tickets start their plan); the triage chat did not see the ticket" };
    let fields = &ticket.fields;
    let mut extra = String::new();
    for (heading, text) in [("Why", &fields.why), ("Context", &fields.context), ("What I see", &fields.see), ("What I expect", &fields.expect)] {
        if !text.trim().is_empty() {
            extra.push_str(&format!("## {heading}\n{}\n\n", text.trim()));
        }
    }
    let constraints = if fields.keep.trim().is_empty() {
        "None given in the ticket; CLAUDE.md and the project rules hold.".to_string()
    } else {
        format!("Do not change: {}\nCLAUDE.md and the project rules hold.", fields.keep.trim())
    };
    let proof = if fields.done.trim().is_empty() {
        "Not given; the plan run names it under Acceptance.".to_string()
    } else {
        format!("Done when: {}\nThe plan run names the commands that show it under Acceptance.", fields.done.trim())
    };
    format!(
        "# {id}: {title}\n\nDispatch wrote this brief from ticket {id} of the tickets board on {date} {switch}.\n\n## The user's words\n{said}\n\n{chain}{extra}## Constraints\n{constraints}\n\n## The command that proves the work\n{proof}\n",
        id = ticket.id,
        title = ticket.title,
        chain = chain_section(chain),
    )
}

/// Starts the plan run of a New ticket without triage (ticket simpler-process-tickets): the switch
/// "Tickets start their plan". Writes the brief from the ticket and runs the plan verb of the script.
/// The ticket moves to In progress at the next task read, from the state `planning`.
pub fn ticket_plan(cwd: String, id: String) -> Result<String, String> {
    ticket_plan_with(&Project::find(&cwd)?, &id, &|project, args| run_script(project, args))
}

/// `ticket_plan` with the start of the script as an argument; a test gives a fake.
fn ticket_plan_with(project: &Project, id: &str, start: &dyn Fn(&Project, &[&str]) -> Result<String, String>) -> Result<String, String> {
    check_ticket(id)?;
    let options = project.options();
    // "No triage" starts the plan of a ticket too (ticket no-triage-a-project-switch-no-triage-in).
    if !options.tickets_start_plans && !options.no_triage {
        return Err("Tickets start their plan is off in this project".to_string());
    }
    if options.paused {
        return Err("the project is paused".to_string());
    }
    let tickets = crate::core::tickets::list(project);
    let ticket = crate::core::tickets::find(&tickets, id)?;
    if ticket.status != crate::core::tickets::NEW {
        return Err(format!("the ticket {id} is not in New"));
    }
    let brief = project.briefs().join(format!("{id}.md"));
    // The files that the plan verb writes: a task with the id exists already when one is there.
    let state = project.reports.join(format!("{id}.state"));
    let leftovers = [state.clone(), project.branch_file(id), project.session_file(id)];
    let plan = project.plans().join(format!("{id}.md"));
    if brief.exists() || plan.exists() || leftovers.iter().any(|path| path.exists()) {
        return Err(format!("a task {id} exists already"));
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64);
    let chain = chain_lines(project, &tickets, &ticket);
    write_file(&brief, &ticket_brief(&ticket, now, options.no_triage, &chain))?;
    // The level of the ticket gives the model and the effort of the plan run (ticket
    // ticket-form-optional-fields-on-a-new). The file is not in the pre-check: a ticket that went to
    // triage before can have it.
    let models = project.models_file(id);
    let undo = |brief: &PathBuf| {
        for path in std::iter::once(brief).chain(leftovers.iter()).chain(std::iter::once(&models)) {
            let _ = fs::remove_file(path);
        }
    };
    if let Err(error) = write_level(project, &ticket) {
        undo(&brief);
        return Err(error);
    }
    start(project, &["plan", id]).inspect_err(|_| {
        // A failed start leaves no task: else the files block the ticket for good, and the state
        // `planning` would move it to In progress although no plan run runs.
        undo(&brief);
    })
}

/// Sends the plan run back with the reason of the user: the Reject button of the task card.
pub fn task_reject(cwd: String, id: String, reason: String) -> Result<String, String> {
    check_ticket(&id)?;
    let reason = reason.trim();
    let text = if reason.is_empty() {
        "Plan rejected. Revise the plan.".to_string()
    } else {
        format!("Plan rejected: {reason} Revise the plan.")
    };
    run_script(&Project::find(&cwd)?, &["reply", &id, &text])
}

/// Sends the words of the user to a worker: the answer to a question of its report.
pub fn task_reply(cwd: String, id: String, text: String) -> Result<String, String> {
    check_ticket(&id)?;
    if text.trim().is_empty() {
        return Err("the reply is empty".to_string());
    }
    run_script(&Project::find(&cwd)?, &["reply", &id, text.trim()])
}

/// Stops the worker of a task: the Stop button of the task card. The script stops the newest
/// worker of the task and writes the state `stopped`; a stopped task cannot be resumed.
pub fn task_stop(cwd: String, id: String) -> Result<String, String> {
    check_ticket(&id)?;
    run_script(&Project::find(&cwd)?, &["stop", &id])
}

/// Gives the steps of the setup for the project of a folder. It changes nothing.
pub fn pipeline_plan(cwd: String) -> Result<Plan, String> {
    plan(&Project::find(&cwd)?)
}

/// Does the steps that are not done. `rules` gives the positions in `RULES` of the checked
/// working rules. With no checked rule, the step "Working rules" adds nothing.
fn apply(project: &Project, rules: &[usize]) -> Result<(), String> {
    let before = plan(project)?;
    let done = |index: usize| before.steps[index].done;
    let mut rules: Vec<usize> = rules.iter().copied().filter(|&index| index < RULES.len()).collect();
    rules.sort_unstable();
    rules.dedup();
    if !done(0) {
        // First the move: the options files of the old folder keep the choice of the user.
        move_old_reports(project)?;
        fs::create_dir_all(project.briefs()).map_err(err)?;
        fs::create_dir_all(project.plans()).map_err(err)?;
        default_flags(project)?;
        join_tickets(project)?;
    }
    if !done(1) {
        add_rules(project)?;
        // The local settings stay on each computer (ticket second-computer, user decision 3).
        if project.in_git && !project.local_settings_ignored() {
            add_ignore_pair(project, LOCAL_SETTINGS_MARK, LOCAL_SETTINGS)?;
        }
        if project.local_settings_tracked() {
            untrack(project, LOCAL_SETTINGS, LOCAL_SETTINGS_MESSAGE)?;
        }
    }
    if !done(2) {
        set_isolation(project)?;
    }
    if !done(3) {
        replace_section(project, SECTION_HEADING, &project.section())?;
    }
    if !done(4) && !rules.is_empty() {
        add_section(project, &rules_section(&rules))?;
    }
    if !done(5) {
        write_file(&project.script(), WORKER_SCRIPT)?;
    }
    if !done(6) {
        write_file(&project.triage_prompt(), &triage_prompt(project.options(), &project.reports_text()))?;
    }
    // Off, the step is done, so an old project gets no new file.
    if !done(7) {
        ignore_line(project, MEASURE_IGNORE)?;
    }
    if !done(8) {
        ignore_line(project, MERGE_IGNORE)?;
    }
    // "Task files local only" (ticket ignore-tasks). On: the line, then the task files leave git in
    // one commit of their own. Off: the line of Dispatch goes, and the task files are committed again.
    if !done(9) {
        if project.options().ignore_tasks {
            add_root_ignore(project)?;
            if project.tasks_tracked() {
                untrack_tasks(project)?;
            }
        } else {
            remove_root_ignore(project)?;
            keep_tasks_committed(project)?;
        }
    }
    // "Project notes in git" (ticket project-notes-in-git). On: the block, last in the file. Off:
    // only the block goes; the notes that git tracks stay in git.
    if !done(10) {
        if project.options().notes_in_git {
            add_notes_block(project)?;
        } else {
            remove_notes_block(project)?;
        }
    }
    Ok(())
}

/// Does the steps that are not done. It makes no commit. `rules` gives the positions in `RULES`
/// of the checked working rules.
pub fn pipeline_apply(cwd: String, rules: Vec<usize>) -> Result<Plan, String> {
    let project = Project::find(&cwd)?;
    apply(&project, &rules)?;
    plan(&project)
}

/// The message of the commit that "Commit to git" makes.
const SETUP_COMMIT_MESSAGE: &str = "Dispatch setup";

/// Runs git in a folder and gives its output, or the error text of git. Unlike `info::git`, it
/// takes the index lock, which a commit needs, and keeps the error text for the user.
fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    run_git_index(cwd, None, args)
}

/// `run_git` on another index file than the one of the repository, when `index` names one. A commit
/// then takes that index, and the staged changes of the user stay staged in theirs.
fn run_git_index(cwd: &Path, index: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(cwd).args(args).stdin(Stdio::null());
    if let Some(index) = index {
        command.env("GIT_INDEX_FILE", index);
    }
    let output = command.no_window().output().map_err(|e| format!("git did not start: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let text = if stderr.is_empty() { String::from_utf8_lossy(&output.stdout).trim().to_string() } else { stderr };
    Err(format!("git {} failed: {text}", args.first().copied().unwrap_or_default()))
}

/// Commits the setup files that git shows as changed, and no other file. A setup file that git
/// ignores is not in `git status` and stays out. Gives the text for the Setup pipeline window.
fn commit_setup(project: &Project) -> Result<String, String> {
    if !project.in_git {
        return Err("No commit: the project is not a git repository.".to_string());
    }
    let files = project.setup_files();
    // `--untracked-files=all`: a new `.claude` folder shows its files, not only the folder.
    let mut args = vec!["status", "--porcelain", "--untracked-files=all", "--"];
    args.extend(files.iter().copied());
    let status = run_git(&project.root, &args)?;
    // A line of `--porcelain` is two status letters, a space and the path from the top folder.
    let changed: Vec<&str> =
        files.iter().copied().filter(|file| status.lines().any(|line| line.get(3..).is_some_and(|path| path.trim_matches('"') == *file))).collect();
    if changed.is_empty() {
        return Err("No commit: nothing to commit. The setup files are committed, or git ignores them.".to_string());
    }
    let mut add = vec!["add", "--"];
    add.extend(&changed);
    run_git(&project.root, &add)?;
    // A commit with paths takes only these paths. Other staged changes of the user stay staged.
    let mut commit = vec!["commit", "-m", SETUP_COMMIT_MESSAGE, "--"];
    commit.extend(&changed);
    run_git(&project.root, &commit)?;
    let hash = run_git(&project.root, &["rev-parse", "--short", "HEAD"])?;
    Ok(format!("Commit {} made with {}. Dispatch made no push.", hash.trim(), changed.join(", ")))
}

/// A git merge, rebase, cherry-pick or revert is not finished in the checkout, a merge of Dispatch
/// holds the merge lock, or a task file is unmerged (ticket board-in-progress). Dispatch then
/// commits no task file, writes no task log and repairs no conflict marker.
fn unfinished_git(project: &Project) -> bool {
    if project.merging().is_some() {
        return true;
    }
    if !project.in_git {
        return false;
    }
    if let Some(dir) = git(&project.root, &["rev-parse", "--absolute-git-dir"]) {
        let dir = PathBuf::from(dir.trim());
        if ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"].iter().any(|name| dir.join(name).exists()) {
            return true;
        }
    }
    git(&project.root, &["ls-files", "-u", "--", TASKS_DIR]).is_some_and(|text| !text.trim().is_empty())
}

/// A line is a git conflict marker of this kind: the seven characters alone or with a space after them.
fn marker_line(line: &str, marker: &str) -> bool {
    let line = line.trim_end_matches(['\r', '\n']);
    line.strip_prefix(marker).is_some_and(|rest| rest.is_empty() || rest.starts_with(' '))
}

/// The text has a git conflict marker line `<<<<<<<` or `>>>>>>>` (ticket board-in-progress).
fn has_markers(text: &str) -> bool {
    text.lines().any(|line| marker_line(line, "<<<<<<<") || marker_line(line, ">>>>>>>"))
}

/// The text with each complete conflict block (`<<<<<<<`, an optional `|||||||` base part,
/// `=======`, `>>>>>>>`) replaced by its second side, and the number of the blocks. An incomplete
/// block leaves the whole text as it is and gives 0: a `=======` alone is a Markdown underline.
fn keep_second_side(text: &str) -> (String, usize) {
    #[derive(PartialEq)]
    enum Part {
        Outside,
        First,
        Base,
        Second,
    }
    let mut out = String::with_capacity(text.len());
    let mut part = Part::Outside;
    let mut blocks = 0;
    for line in text.split_inclusive('\n') {
        match part {
            Part::Outside if marker_line(line, "<<<<<<<") => part = Part::First,
            Part::Outside => out.push_str(line),
            Part::First if marker_line(line, "|||||||") => part = Part::Base,
            Part::First | Part::Base if line.trim_end_matches(['\r', '\n']) == "=======" => part = Part::Second,
            Part::First | Part::Base => {}
            Part::Second if marker_line(line, ">>>>>>>") => {
                part = Part::Outside;
                blocks += 1;
            }
            Part::Second => out.push_str(line),
        }
    }
    if part != Part::Outside || blocks == 0 {
        return (text.to_string(), 0);
    }
    (out, blocks)
}

/// Repairs the reports, plans and logs of `.dispatch` (`*.md` and `logs/*.md`) that hold complete
/// conflict blocks: each block keeps its second side, the side of the task branch in a `git merge`
/// (ticket board-in-progress, user decision 5). Writes each such file once and gives one note per
/// file. Does nothing during an unfinished git merge: git still needs the markers then.
fn repair_conflicts(project: &Project) -> Vec<String> {
    let mut notes = Vec::new();
    if unfinished_git(project) {
        return notes;
    }
    let logs = project.reports.join("logs");
    for (_, path, _) in files_with(&project.reports, "md").into_iter().chain(files_with(&logs, "md")) {
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let (repaired, blocks) = keep_second_side(&text);
        if blocks == 0 {
            continue;
        }
        let shown = path.strip_prefix(&project.root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
        match fs::write(&path, repaired) {
            Ok(()) => notes.push(format!("{shown}: kept the task branch side of {blocks} conflict {}", if blocks == 1 { "block" } else { "blocks" })),
            Err(error) => eprintln!("conflict markers not repaired in {shown}: {error}"),
        }
    }
    notes
}

/// Commits the changes of the task files in `.dispatch` (briefs, plans, reports, state files,
/// the script, the options files and the tickets file), and no other file. Other staged changes
/// of the user stay staged.
/// Gives the number of changed files, 0 when there was nothing to commit or no git repository.
/// With "Task files local only" on it commits nothing and gives 0: git ignores the folder, also in
/// the time between the switch and Apply (ticket ignore-tasks).
fn keep_tasks_committed(project: &Project) -> Result<usize, String> {
    if !project.in_git || project.options().ignore_tasks {
        return Ok(0);
    }
    // `git add --all` would stage a conflicted task file with its markers as resolved (ticket
    // board-in-progress, the commit "Dispatch: 86 task files" of Starminer).
    if unfinished_git(project) {
        return Ok(0);
    }
    // "Project notes in git" (ticket project-notes-in-git): the status also names the notes that
    // Dispatch commits with the task files.
    let mut status_args = vec!["status", "--porcelain", "--untracked-files=all", "--", TASKS_DIR];
    if project.options().notes_in_git {
        status_args.extend(NOTES_WITH_TASKS);
    }
    // `--untracked-files=all`: a new folder shows its files, not only the folder.
    let status = run_git(&project.root, &status_args)?;
    let paths: Vec<&str> = status.lines().filter_map(|line| line.get(3..)).map(|path| path.trim().trim_matches('"')).filter(|path| !path.is_empty()).collect();
    // `git add` of an ignored untracked path fails, so only the notes that the status listed go in.
    let notes: Vec<&str> = NOTES_WITH_TASKS.iter().copied().filter(|note| paths.contains(note)).collect();
    let tasks = paths.len() - notes.len();
    let changed = tasks + notes.len();
    if changed == 0 {
        return Ok(0);
    }
    let mut pathspec: Vec<&str> = if tasks > 0 { vec![TASKS_DIR] } else { Vec::new() };
    pathspec.extend(&notes);
    let mut add = vec!["add", "--all", "--"];
    add.extend(&pathspec);
    run_git(&project.root, &add)?;
    let mut message = format!("Dispatch: {tasks} task {}", if tasks == 1 { "file" } else { "files" });
    if !notes.is_empty() {
        message.push_str(&format!(" and {} {}", notes.len(), if notes.len() == 1 { "note" } else { "notes" }));
    }
    // A commit with paths takes only these paths.
    let mut commit = vec!["commit", "-m", &message, "--"];
    commit.extend(&pathspec);
    run_git(&project.root, &commit)?;
    Ok(changed)
}

/// Commits the setup files of the project of a folder on the current branch. It makes no push.
pub fn pipeline_commit(cwd: String) -> Result<String, String> {
    commit_setup(&Project::find(&cwd)?)
}

/// Saves the measuring commands of the project of a folder: one command per line, each line
/// trimmed, empty lines at the end dropped. The steps then show what Apply must change.
pub fn set_measure_commands(cwd: String, text: String) -> Result<Plan, String> {
    let project = Project::find(&cwd)?;
    let mut lines: Vec<&str> = text.lines().map(str::trim).collect();
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    let text = if lines.is_empty() { String::new() } else { format!("{}\n", lines.join("\n")) };
    write_file(&project.measure_commands_file(), &text)?;
    plan(&project)
}

/// Saves the gate command of the merge step (ticket task-branches): the text of the box, each line
/// trimmed, empty lines at the end dropped.
pub fn set_merge_gate(cwd: String, text: String) -> Result<Plan, String> {
    let project = Project::find(&cwd)?;
    let mut lines: Vec<&str> = text.lines().map(str::trim).collect();
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    let text = if lines.is_empty() { String::new() } else { format!("{}\n", lines.join("\n")) };
    write_file(&project.merge_gate_file(), &text)?;
    plan(&project)
}

/// Saves the list of checks of the project of a folder (ticket task-checks): the text of the box,
/// each line trimmed, empty lines at the end dropped. The steps then show what Apply must change.
pub fn set_checks(cwd: String, text: String) -> Result<Plan, String> {
    let project = Project::find(&cwd)?;
    let mut lines: Vec<&str> = text.lines().map(str::trim).collect();
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    let text = if lines.is_empty() { String::new() } else { format!("{}\n", lines.join("\n")) };
    write_file(&project.checks_file(), &text)?;
    plan(&project)
}

/// Merges the branch of a task into its base: the Merge button of the task card. The task files
/// are committed first, so the checkout is clean; the script refuses a dirty checkout, a failed
/// gate and a conflict outside `.dispatch`, and then changes nothing.
pub fn task_merge(cwd: String, id: String) -> Result<String, String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    if let Err(error) = keep_tasks_committed(&project) {
        eprintln!("task files not committed before the merge: {error}");
    }
    run_script(&project, &["merge", &id])
}

/// Saves the settings of the project of a folder. The steps then show what Apply must change.
pub fn set_project_options(cwd: String, options: Options) -> Result<Plan, String> {
    let project = Project::find(&cwd)?;
    let text = serde_json::to_string_pretty(&options).map_err(err)?;
    write_file(&project.options_file(), &format!("{text}\n"))?;
    plan(&project)
}

/// Pauses or resumes the execution of tasks of the project of a folder (ticket pause-tasks): sets the
/// one setting `paused` and keeps the others. Gives the new value. The steps do not change.
pub fn set_paused(cwd: String, on: bool) -> Result<bool, String> {
    let project = Project::find(&cwd)?;
    let options = Options { paused: on, ..project.options() };
    let text = serde_json::to_string_pretty(&options).map_err(err)?;
    write_file(&project.options_file(), &format!("{text}\n"))?;
    Ok(project.options().paused)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// A scratch project with its task folder `.dispatch` in the temp folder. It is in no git
    /// repository, thus `Project::find` would not take a parent folder in its place.
    fn scratch(name: &str) -> Project {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("dispatch-test-{name}-{nanos}"));
        let root = base.join("proj");
        fs::create_dir_all(&root).unwrap();
        Project { reports: root.join(TASKS_DIR), root, in_git: false }
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap_or_default().replace("\r\n", "\n")
    }

    /// Ticket plain-words-decisions: the plan rule and the report-question rule ask for
    /// everyday words, with word limits and one example; the markers that Dispatch parses stay.
    #[test]
    fn plan_and_question_rules_ask_for_plain_words() {
        let body = scratch("plain-words").section_body();
        assert!(body.contains("each question, option and reason in everyday words for the user, who does not read the code: what changes for the user and what the user sees or does, not how the code does it;"), "{body}");
        assert!(body.contains("the technical detail goes into Files to change, Notes for the work run or Steps;"), "{body}");
        assert!(body.contains("a question 20 words maximum and an option 15 words maximum, its reason not counted;"), "{body}");
        assert!(body.contains("for example, not `No: they follow the same rule; Setup pipeline still offers Commit to git` but `No, these files stop no task; you can still commit them in Setup pipeline`;"), "{body}");
        assert!(body.contains("sends it back word for word; the question and each option follow the rule of plain words of the Decisions of a plan; the details stand above the questions."), "{body}");
        for marker in ["`- Default:`", "`- HOLD:`", "`- Other:`", "`Recommended: …`", "`Not recommended: …`"] {
            assert!(body.contains(marker), "{marker}");
        }
    }

    /// Removes the scratch folders of a test that passed. A failed test keeps them for a look.
    pub(crate) fn clean(project: &Project) {
        let _ = fs::remove_dir_all(project.root.parent().unwrap());
    }

    fn choice(model: &str, effort: &str) -> Choice {
        Choice { model: model.to_string(), effort: effort.to_string() }
    }

    #[test]
    fn commit_takes_only_the_setup_files() {
        let mut project = scratch("commit");
        assert!(commit_setup(&project).unwrap_err().contains("not a git repository"));
        let root = project.root.clone();
        let git = |args: &[&str]| run_git(&root, args).unwrap();
        git(&["init", "-q"]);
        git(&["config", "user.name", "Dispatch test"]);
        git(&["config", "user.email", "test@example.invalid"]);
        git(&["config", "commit.gpgsign", "false"]);
        // A global ignore file can hide `.claude/settings.local.json` (on the machine of the user
        // it does). The repository names a file that does not exist in its place.
        git(&["config", "core.excludesFile", "no-such-ignore-file"]);
        project.in_git = true;
        // A file of the user that the commit must leave alone.
        write_file(&root.join("notes.txt"), "mine\n").unwrap();
        for file in project.setup_files() {
            write_file(&root.join(file), "{}\n").unwrap();
        }

        let text = commit_setup(&project).unwrap();
        assert!(text.contains(".claude/triage.md"), "{text}");
        let shown = git(&["show", "--name-only", "--format=", "HEAD"]);
        let mut committed: Vec<&str> = shown.lines().filter(|line| !line.is_empty()).collect();
        committed.sort_unstable();
        let mut expected = project.setup_files().to_vec();
        expected.sort_unstable();
        assert_eq!(committed, expected);
        assert_eq!(git(&["log", "-1", "--format=%B"]).trim(), SETUP_COMMIT_MESSAGE);
        assert_eq!(git(&["status", "--porcelain"]).trim(), "?? notes.txt");
        // The setup files are committed: a second click has nothing to commit.
        assert!(commit_setup(&project).unwrap_err().contains("nothing to commit"));

        // "Task files local only" on (ticket ignore-tasks): the root `.gitignore` is a setup file,
        // and the commit takes its line and no other file.
        assert!(!project.setup_files().contains(&".gitignore"));
        set_ignore(&project, true);
        assert_eq!(project.setup_files().len(), 11);
        add_root_ignore(&project).unwrap();
        let text = commit_setup(&project).unwrap();
        assert!(text.contains("made with .gitignore. "), "{text}");
        assert_eq!(git(&["show", "--name-only", "--format=", "HEAD"]).trim(), ".gitignore");
        // The settings file is a task file, and git ignores it now.
        assert_eq!(git(&["status", "--porcelain"]).trim(), "?? notes.txt");
        // Off again: while HEAD has the line of Dispatch, the commit takes its removal.
        set_ignore(&project, false);
        remove_root_ignore(&project).unwrap();
        assert!(project.setup_files().contains(&".gitignore"));
        commit_setup(&project).unwrap();
        assert_eq!(git(&["show", "--name-only", "--format=", "HEAD"]).trim(), ".gitignore");
        assert_eq!(project.setup_files().len(), 10);
        clean(&project);
    }

    /// The fixed part of `work-flags.txt`, as lines.
    const WORK_FIXED: &str = "--permission-mode\nauto\n--tools\ndefault\n--disallowedTools\nAskUserQuestion,SendMessage\n";

    /// The expected text of `plan-flags.txt` for a choice: the choice lines, then the fixed part
    /// with the plans folder of this scratch project in its Write rule.
    fn plan_lines(project: &Project, choice_lines: &str) -> String {
        format!(
            "{choice_lines}--permission-mode\ndontAsk\n--tools\nRead,Grep,Glob,Bash,Write\n--allowedTools\nBash(git status*),Bash(git log *),Bash(git diff *),Write({}/plans/**)\n",
            project.rule_path()
        )
    }

    #[test]
    fn apply_writes_the_two_run_setup_and_removes_the_obsolete_rules() {
        let project = scratch("apply");
        write_file(
            &project.local_settings(),
            r#"{ "permissions": { "allow": ["Bash(claude --bg *)", "Bash(claude agents --json --all)", "Bash(claude --resume * --bg *)"] } }"#,
        )
        .unwrap();
        apply(&project, &[0, 3]).unwrap();

        assert!(project.briefs().is_dir() && project.plans().is_dir());
        assert_eq!(read(&project.plan_flags()), plan_lines(&project, "--model\nfable\n--effort\nxhigh\n"));
        assert!(read(&project.plan_flags()).contains("Write(.dispatch/plans/**)\n"), "the Write rule names the plans folder relative to the project");
        assert_eq!(read(&project.work_flags()), format!("--model\nopus\n--effort\nxhigh\n{WORK_FIXED}"));
        assert_eq!(read(&project.script()), WORKER_SCRIPT);

        let settings = read_settings(&project.local_settings()).unwrap();
        let allow: Vec<&str> = settings["permissions"]["allow"].as_array().unwrap().iter().map(|rule| rule.as_str().unwrap()).collect();
        assert!(!allow.iter().any(|rule| OBSOLETE_RULES.contains(rule)), "{allow:?}");
        assert_eq!(allow.iter().filter(|rule| rule.contains("worker.ps1 *)")).count(), 1, "{allow:?}");
        assert_eq!(allow.iter().filter(|rule| **rule == "Bash(claude agents --json --all)").count(), 1, "{allow:?}");
        // Triage may run every verb of the script except approve: the Approve button of Dispatch runs that.
        let deny: Vec<&str> = settings["permissions"]["deny"].as_array().unwrap().iter().map(|rule| rule.as_str().unwrap()).collect();
        assert_eq!(deny.len(), 1, "{deny:?}");
        assert!(deny[0].starts_with("Bash(powershell -ExecutionPolicy Bypass -File ") && deny[0].ends_with("/worker.ps1 approve *)"), "{deny:?}");
        // Triage may read the job folders of the workers (their screenshots) without a prompt.
        let dirs: Vec<&str> = settings["permissions"]["additionalDirectories"].as_array().unwrap().iter().map(|dir| dir.as_str().unwrap()).collect();
        assert_eq!(dirs.len(), 1, "{dirs:?}");
        assert!(dirs[0].ends_with("\\.claude\\jobs"), "{dirs:?}");
        assert!(rule_changes(&project).unwrap().none(), "a second Apply adds nothing");

        let claude_md = read(&project.instructions());
        assert!(claude_md.contains(&format!("{SECTION_HEADING}\n{SECTION_STAMP_PREFIX}")), "{claude_md}");
        assert!(claude_md.contains("worker.ps1 approve <ticket-id>"), "{claude_md}");
        assert!(claude_md.contains("## Working rules\n- Write to the user in plain words"), "{claude_md}");
        let role = read(&project.triage_prompt());
        assert!(role.contains("Never run `powershell") && role.contains("worker.ps1 approve` yourself"), "{role}");
        assert!(role.contains("needs: decision") && !role.contains("claude --resume") && !role.contains("reply <ticket-id>"), "{role}");
        assert!(claude_md.contains("## Questions") && claude_md.contains("Triage does not poll"), "{claude_md}");
        // Ticket answered-question-repeat: the worker never leaves an answered question in its report.
        assert!(claude_md.contains("An answered question never comes back unchanged") && claude_md.contains("ends with `state: done` or a new question"), "{claude_md}");

        // The task files are in `.dispatch` of the project: the section, the rules, the role and
        // the plan options name that folder relative to the project (ticket second-computer), and
        // the script finds the project as its parent.
        let tasks = project.reports_text();
        assert_eq!(tasks, ".dispatch");
        for path in ["/briefs/<ticket-id>.md", "/plans/<ticket-id>.md", "/<ticket-id>.md", "/<ticket-id>.state", "/worker.ps1 approve <ticket-id>"] {
            assert!(claude_md.contains(&format!("{tasks}{path}")), "{path} missing: {claude_md}");
        }
        assert!(claude_md.contains(&format!("an uncommitted change outside `{tasks}/` touches a file of the task")), "{claude_md}");
        let rule_path = project.rule_path();
        assert_eq!(rule_path, ".dispatch");
        let named: Vec<&&str> = allow.iter().filter(|rule| rule.contains(" .dispatch/") || rule.contains("(.dispatch/")).collect();
        assert_eq!(named.len(), 3, "the script, Edit and Read rules: {allow:?}");
        assert!(!allow.iter().chain(deny.iter()).any(|rule| rule.contains("/proj/")), "no rule names the absolute path: {allow:?} {deny:?}");
        assert!(deny[0].contains(" .dispatch/worker.ps1 approve *)"), "{deny:?}");
        assert!(!claude_md.contains("/proj/") && !role.contains("/proj/"), "no absolute path in the shared files");
        assert!(role.contains(&format!("{tasks}/worker.ps1 plan <ticket-id>")), "{role}");
        assert!(read(&project.plan_flags()).contains(&format!("Write({rule_path}/plans/**)")));
        assert!(WORKER_SCRIPT.contains("$Project = Split-Path -Parent $Reports") && !WORKER_SCRIPT.contains("-reports"));
        assert!(!allow.iter().chain(deny.iter()).any(|rule| rule.contains("-reports")), "{allow:?} {deny:?}");

        let after = plan(&project).unwrap();
        let open: Vec<&str> = after.steps.iter().filter(|step| !step.done).map(|step| step.title).collect();
        assert!(open.is_empty(), "steps still to do: {open:?}");
        clean(&project);
    }

    #[test]
    fn apply_replaces_the_old_section_and_keeps_the_other_sections() {
        let project = scratch("section");
        write_file(
            &project.instructions(),
            "# Scratch\r\n\r\n## Background workers\r\n- A worker is a session that triage starts with `claude --bg`.\r\n- old rule two\r\n\r\n## Working rules\r\n- keep me\r\n",
        )
        .unwrap();
        assert!(!section_done(&project));
        apply(&project, &[]).unwrap();

        let raw = fs::read_to_string(project.instructions()).unwrap();
        assert!(raw.contains("\r\n") && !raw.contains("\n\n"), "the file keeps its line ending: {raw:?}");
        let text = raw.replace("\r\n", "\n");
        assert!(!text.contains("old rule two"), "{text}");
        assert!(text.starts_with("# Scratch\n\n## Background workers\n<!-- dispatch-section: "), "{text}");
        assert!(text.ends_with("\n\n## Working rules\n- keep me\n"), "{text}");
        assert!(section_done(&project));

        // The section is done. A second apply changes nothing.
        apply(&project, &[]).unwrap();
        assert_eq!(raw, fs::read_to_string(project.instructions()).unwrap());
        clean(&project);
    }

    #[test]
    fn the_options_file_of_the_one_run_design_is_ignored() {
        let project = scratch("old-flags");
        write_file(&project.reports.join("worker-flags.txt"), "--model sonnet --effort low\n").unwrap();
        default_flags(&project).unwrap();
        let flags = read_worker_flags(&project);
        assert_eq!((flags.plan.model.as_str(), flags.plan.effort.as_str()), ("fable", "xhigh"));
        assert_eq!((flags.work.model.as_str(), flags.work.effort.as_str()), ("opus", "xhigh"));
        assert_eq!(flags.agents, "");
        assert!(!flags.ready);
        clean(&project);
    }

    #[test]
    fn the_choice_of_the_user_goes_into_both_files() {
        let project = scratch("choice");
        write_worker_flags(&project, &choice("", "high"), &choice("opus", ""), "2").unwrap();
        assert_eq!(read(&project.plan_flags()), plan_lines(&project, "--effort\nhigh\n"));
        let work = read(&project.work_flags());
        assert!(work.starts_with(&format!("--model\nopus\n{WORK_FIXED}--settings\n")) && work.ends_with("/worker-settings.json\n"), "{work}");
        let flags = read_worker_flags(&project);
        assert_eq!((flags.plan.model.as_str(), flags.plan.effort.as_str()), ("", "high"));
        assert_eq!((flags.work.model.as_str(), flags.work.effort.as_str()), ("opus", ""));
        assert_eq!(flags.agents, "2");

        // No agent limit: the settings file is not named, and the limit reads as empty.
        write_worker_flags(&project, &choice("fable", "xhigh"), &choice("opus", "xhigh"), "").unwrap();
        assert_eq!(read(&project.work_flags()), format!("--model\nopus\n--effort\nxhigh\n{WORK_FIXED}"));
        assert_eq!(read_worker_flags(&project).agents, "");
        clean(&project);
    }

    #[test]
    fn an_old_work_options_file_gets_the_fixed_part_and_keeps_its_choice() {
        let project = scratch("old-work-flags");
        fs::create_dir_all(project.briefs()).unwrap();
        fs::create_dir_all(project.plans()).unwrap();
        write_lines(&project.plan_flags(), &plan_flag_lines(&project, &choice("fable", "xhigh")).unwrap()).unwrap();
        // The file of 0.1.12: the choice of the user and the agent limit, no permission mode and no tool list.
        write_file(&project.worker_settings(), "{ \"env\": { \"CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS\": \"2\" } }\n").unwrap();
        let settings = project.worker_settings().to_string_lossy().replace('\\', "/");
        write_file(&project.work_flags(), &format!("--model\nsonnet\n--disallowedTools\nAskUserQuestion\n--settings\n{settings}\n")).unwrap();
        assert!(!plan(&project).unwrap().steps[0].done, "the step is to do while the fixed part is missing");

        // The absolute path of the old file becomes the path relative to the project (ticket second-computer).
        apply(&project, &[]).unwrap();
        assert_eq!(read(&project.work_flags()), format!("--model\nsonnet\n{WORK_FIXED}--settings\n.dispatch/worker-settings.json\n"));
        assert!(plan(&project).unwrap().steps[0].done);
        // A current file is left as it is.
        write_worker_flags(&project, &choice("", ""), &choice("", ""), "").unwrap();
        let before = read(&project.work_flags());
        default_flags(&project).unwrap();
        assert_eq!(read(&project.work_flags()), before);
        clean(&project);
    }

    #[test]
    fn a_report_gives_its_header_and_its_questions() {
        let (header, questions) = parse_report(
            "# Report t-1\nstate: needs-decision\nneeds: decision\nfiles: src/a.rs, src/b.rs\nplan: D:/x-reports/plans/t-1.md\n\n## What I did\n- read the code\n\n## Questions\n1. Keep the old name?\n   - Yes, keep it\n   - No, rename it\n2. Which folder?\n- src\n\n## Open\n- none\n",
        );
        assert_eq!(
            header,
            Some(ReportHeader {
                state: "needs-decision".into(),
                needs: "decision".into(),
                files: "src/a.rs, src/b.rs".into(),
                plan: "D:/x-reports/plans/t-1.md".into(),
            })
        );
        assert_eq!(
            questions,
            vec![
                Question { number: 1, text: "Keep the old name?".into(), options: vec!["Yes, keep it".into(), "No, rename it".into()] },
                Question { number: 2, text: "Which folder?".into(), options: vec!["src".into()] },
            ]
        );

        // A report of the old shape has no header and no questions, and the keys may come in any order.
        assert_eq!(parse_report("# Report\n\nI did things.\n"), (None, Vec::new()));
        // A title with an empty line after it, then the header: the header still counts.
        let (header, _) = parse_report("# Report t-9\n\nstate: failed\nneeds: nothing\n\nThe build broke.\n");
        assert_eq!(header.map(|h| h.state), Some("failed".to_string()));
        // Wrapped lines join the option above them, or the question before its first option.
        let (_, questions) = parse_report(
            "state: needs-decision\nneeds: permission\n\n## Questions\n\n1. How should the run get\n   its permissions?\n   - Change the flags, then reply. Recommended. A reply in the \"working\"\n     state takes the flags.\n   - Stop the ticket.\n",
        );
        assert_eq!(
            questions,
            vec![Question {
                number: 1,
                text: "How should the run get its permissions?".into(),
                options: vec!["Change the flags, then reply. Recommended. A reply in the \"working\" state takes the flags.".into(), "Stop the ticket.".into()],
            }]
        );
        let (header, questions) = parse_report("needs: nothing\nstate: done\n\n## Notes\n1. not a question\n");
        assert_eq!(header.map(|h| (h.state, h.needs, h.files)), Some(("done".to_string(), "nothing".to_string(), String::new())));
        assert!(questions.is_empty());
    }

    #[test]
    fn a_plan_gives_its_decisions() {
        // The shape of the real plans of 2026-11-08: wrapped titles and options, a closing line without indent.
        let plan = "## Steps\n1. not a decision\n\n## Decisions\n\n1. Ore per rock. Today rock 0 holds\n   a lot.\n   - HOLD: Keep the map's ore as it is (8,000 pockets). Recommended: the\n     spread was tuned.\n   - Other: the doc's 4,000 ore. Not recommended: a tunnel meets ore\n     every 2 km.\n10. Commit message.\n    - Default: \"Play session prep (t-1)\". Recommended: short.\n\nNo other HOLD decisions.\n\n## Do not touch\n- 2. nothing\n";
        let decisions = parse_decisions(plan);
        assert_eq!(decisions.len(), 2);
        assert_eq!((decisions[0].number, decisions[0].title.as_str(), decisions[0].hold), (1, "Ore per rock. Today rock 0 holds a lot.", true));
        assert_eq!(
            decisions[0].options,
            vec![
                DecisionOption { kind: "hold".into(), choice: "Keep the map's ore as it is (8,000 pockets)".into(), reason: "Recommended: the spread was tuned.".into() },
                DecisionOption { kind: "other".into(), choice: "the doc's 4,000 ore".into(), reason: "Not recommended: a tunnel meets ore every 2 km.".into() },
            ]
        );
        assert_eq!((decisions[1].number, decisions[1].hold), (10, false));
        assert_eq!(decisions[1].options[0].kind, "default");
        assert_eq!(decisions[1].options[0].choice, "\"Play session prep (t-1)\"");
        assert!(parse_decisions("## Decisions\n\nNo HOLD decisions.\n").is_empty());
        // Bold marks, and a decision that the plan wrote without options.
        let other = parse_decisions("## Decisions\n\n1. Who settles it\n   - **HOLD:** the user. Recommended: only they know.\n   - **Other:** the planner\n2. A note without options.\n");
        assert_eq!(other[0].options[0].kind, "hold");
        assert_eq!(other[0].options[0].choice, "the user");
        assert_eq!(other[0].options[1].choice, "the planner");
        assert!(other[0].hold);
        assert!(other[1].options.is_empty());
    }

    #[test]
    fn an_alternative_named_in_a_reason_is_an_option() {
        // Decisions 1 and 4 of a real plan (CAP-003, 2026-11-09, from the user's screenshot).
        let plan = "## Decisions\n\
1. P195 / H-F without the `Mode` byte values. Default: in H-F mode the engine sends nothing to port 8513 (no start, no stop); the gateway is set up on its web page, as protocol.md says today. The engine reads the config on 8514 and warns when it is not a P195 reply. *Other option:* send the 8-byte P195 config with the `Mode` byte copied from the config reply (index 22, itself unconfirmed #12); not chosen, because a wrong byte would change a real gateway in an unknown way. The todo item for the P195 start packet stays open.\n\
4. Index column of the raw file. Default: the number of the written sample, from 1, no gaps, as the old app. Lost and bad packets show in the summary, not in the index. *Other option:* jump the index over lost H-F packets.\n\
11. Dependencies. Default: none new. `std` threads, sockets and `mpsc`; the CLI parsed by hand.\n";
        let decisions = parse_decisions(plan);
        let one = &decisions[0].options;
        assert_eq!(one.len(), 2);
        assert_eq!(one[0].choice, "in H-F mode the engine sends nothing to port 8513 (no start, no stop); the gateway is set up on its web page, as protocol.md says today");
        assert_eq!(one[0].reason, "The engine reads the config on 8514 and warns when it is not a P195 reply. The todo item for the P195 start packet stays open.");
        assert_eq!((one[1].kind.as_str(), one[1].choice.as_str()), ("other", "send the 8-byte P195 config with the `Mode` byte copied from the config reply (index 22, itself unconfirmed #12)"));
        assert_eq!(one[1].reason, "not chosen, because a wrong byte would change a real gateway in an unknown way");
        let four = &decisions[1].options;
        assert_eq!(four.len(), 2);
        assert_eq!(four[0].reason, "Lost and bad packets show in the summary, not in the index.");
        assert_eq!((four[1].choice.as_str(), four[1].reason.as_str()), ("jump the index over lost H-F packets", ""));
        // The explanation of a choice is no alternative.
        assert_eq!(decisions[2].options.len(), 1);
    }

    #[test]
    fn a_plan_can_name_the_option_in_the_line_of_the_decision() {
        // Four decisions of a real plan (CAP-002, 2026-11-09), word for word: no option lines at all.
        let plan = "## Decisions\n\
1. `cap-app` without egui in phase 2. Default: a plain binary that prints one line; eframe and egui_plot come with phase 4. Reason: no GUI work in this phase, and a much shorter build for the proof commands.\n\
9. Stop packet. Default: the Java client's intended stop (timer bytes 0, which the manual describes as slave mode, p. 50); marked not confirmed. Whether it really stops the stream stays on the on-site checklist.\n\
11. Source tags in code and tests. Default: a comment `MANUAL p. N` (with figure number when it is a figure), `JAVA:` for facts from the Java client only, and `UNCONFIRMED:` with the protocol.md item number; the rule goes into the new `CLAUDE.md` code rules.\n\
12. Who settles the facts that stay open (status bit meaning, H-F widths, `Mode` byte values, several samples per P20 datagram, stop effect). HOLD: you choose whether to ask LAP (a message to another company) or to take one Wireshark capture on site. This does not block CAP-002; the code keeps these as settings or constants marked not confirmed.\n\
\n## Do not touch\n";
        let decisions = parse_decisions(plan);
        assert_eq!(decisions.len(), 4);
        let option = |at: usize| &decisions[at].options[0];
        assert_eq!(decisions[0].title, "`cap-app` without egui in phase 2.");
        assert_eq!((option(0).kind.as_str(), option(0).choice.as_str()), ("default", "a plain binary that prints one line; eframe and egui_plot come with phase 4"));
        assert_eq!(option(0).reason, "no GUI work in this phase, and a much shorter build for the proof commands.");
        assert_eq!(option(1).choice, "the Java client's intended stop (timer bytes 0, which the manual describes as slave mode, p. 50); marked not confirmed");
        assert_eq!(option(1).reason, "Whether it really stops the stream stays on the on-site checklist.");
        assert!(option(2).choice.starts_with("a comment `MANUAL p. N` (with figure number"), "{}", option(2).choice);
        assert!(option(2).choice.ends_with("the rule goes into the new `CLAUDE.md` code rules"), "{}", option(2).choice);
        assert_eq!(option(2).reason, "");
        assert!(decisions[3].hold && !decisions[0].hold);
        assert_eq!((option(3).kind.as_str(), option(3).choice.as_str()), ("hold", "you choose whether to ask LAP (a message to another company) or to take one Wireshark capture on site"));
        assert!(decisions[3].title.ends_with("stop effect)."), "{}", decisions[3].title);
    }

    #[test]
    fn the_user_decisions_replace_the_earlier_ones_at_the_end_of_the_plan() {
        let plan = "# Plan\n\n## Decisions\n1. A.\n   - Default: x.\n\n## User decisions\n\nold\n\n## Size\n2 files\n";
        let done = with_user_decisions(plan, "1. A: y\n");
        assert_eq!(done, "# Plan\n\n## Decisions\n1. A.\n   - Default: x.\n\n## Size\n2 files\n\n## User decisions\n\n1. A: y\n");
        // A plan with Windows line ends keeps them.
        assert_eq!(with_user_decisions("# P\r\n", "1. A: y"), "# P\r\n\r\n## User decisions\r\n\r\n1. A: y\r\n");
    }

    #[test]
    fn a_checks_file_gives_its_checks() {
        let text = "# The checks of the project\n\n  unit | cargo test --lib | always\nlint|npx tsc --noEmit\nlong | node net.mjs | tail -3\n| no name\nempty |\nno bar\nUnit | npm test\nwide\tname | x | ALWAYS\n";
        let check = |name: &str, command: &str, always: bool| Check { name: name.into(), command: command.into(), always };
        assert_eq!(
            parse_checks(text),
            vec![
                check("unit", "cargo test --lib", true),
                check("lint", "npx tsc --noEmit", false),
                // A command may hold `|`; only a last field `always` is the mark.
                check("long", "node net.mjs | tail -3", false),
                // A tab in the name would cut the line of the task file.
                check("wide name", "x", true),
            ]
        );
        assert!(parse_checks("").is_empty());
    }

    #[test]
    fn a_plan_marks_the_recommended_checks() {
        let list = parse_checks("unit | cargo test --lib | always\nlint | npx tsc --noEmit\nnet | node net.mjs\nui | npm run e2e\n");
        let plan = "# t-1: a plan\n\n## Acceptance\n- x\n\n## Checks\n- [x] `lint` — the types change.\n- [ ] net: no network code changes.\n- [X] ui - the card changes\n- [x] other — not in the list\n\n## Steps\n1. go\n";
        let checks = plan_checks(plan, &list);
        let row = |at: usize| (checks[at].name.as_str(), checks[at].always, checks[at].recommended, checks[at].reason.as_str(), checks[at].chosen);
        assert_eq!(checks.len(), 4, "a name that is not in the list is left out");
        // `unit` is not in the section: its always mark makes it recommended.
        assert_eq!(row(0), ("unit", true, true, "", None));
        assert_eq!(row(1), ("lint", false, true, "the types change.", None));
        assert_eq!(row(2), ("net", false, false, "no network code changes.", None));
        assert_eq!(row(3), ("ui", false, true, "the card changes", None));
        assert_eq!(checks[1].command, "npx tsc --noEmit");
        // After Approve the section Checks chosen gives the choice of the user, also against the plan.
        let names = vec!["unit".to_string(), "net".to_string()];
        let decided = with_section(plan, CHECKS_CHOSEN_HEADING, &checks_chosen_text(&list, &names, "2026-11-14 01:30 UTC"));
        let chosen: Vec<Option<bool>> = plan_checks(&decided, &list).iter().map(|check| check.chosen).collect();
        assert_eq!(chosen, vec![Some(true), Some(false), Some(true), Some(false)]);
        assert_eq!(chosen_checks(&plan_checks(&decided, &list)), vec![("unit".to_string(), "cargo test --lib".to_string()), ("net".to_string(), "node net.mjs".to_string())]);
        // The recommendation of the plan stays as it was.
        assert!(plan_checks(&decided, &list)[1].recommended);
        // No list: no checks, whatever the plan says.
        assert!(plan_checks(plan, &[]).is_empty());
    }

    #[test]
    fn task_checks_writes_the_plan_section_and_the_checks_file() {
        let project = scratch("task-checks");
        let cwd = project.root.to_string_lossy().into_owned();
        let plan_path = project.plans().join("t-1.md");
        write_file(&plan_path, "# t-1: a plan\n\n## Checks\n- [x] lint — types\n").unwrap();
        // Without the list of the project nothing is written, and the section of CLAUDE.md is the old one.
        let before = project.section_body();
        task_checks(cwd.clone(), "t-1".into(), vec!["lint".into()]).unwrap();
        assert_eq!(read(&plan_path), "# t-1: a plan\n\n## Checks\n- [x] lint — types\n");
        assert!(!project.task_checks_file("t-1").exists());
        assert!(!before.contains("checks.txt"), "{before}");
        assert!(plan(&project).unwrap().checks.is_empty());

        let shown = set_checks(cwd.clone(), "unit | cargo test --lib | always\nlint | npx tsc --noEmit\nnet | node net.mjs\n\n\n".into()).unwrap();
        assert_eq!(shown.checks, "unit | cargo test --lib | always\nlint | npx tsc --noEmit\nnet | node net.mjs\n");
        assert!(setup_files_have_checks(&project));
        let rule = project.section_body();
        assert!(rule.contains(&format!("in `{}/checks.txt`", project.reports_text())) && rule.contains("the section Checks chosen"), "{rule}");
        // The new text of the section makes the step "Section in CLAUDE.md" To do.
        assert!(open_steps(&project).contains(&"Section in CLAUDE.md"), "{:?}", open_steps(&project));

        task_checks(cwd.clone(), "t-1".into(), vec!["unit".into(), "NET".into(), "unknown".into()]).unwrap();
        let text = read(&plan_path);
        assert!(text.starts_with("# t-1: a plan\n\n## Checks\n- [x] lint — types\n\n## Checks chosen\n\nThe user chose these checks in Dispatch on "), "{text}");
        assert!(text.ends_with(" UTC. The work run runs each checked one with the command as written here, and names that exact command in Verification.\n\n- [x] unit — `cargo test --lib`\n- [ ] lint\n- [x] net — `node net.mjs`\n"), "{text}");
        assert_eq!(read(&project.task_checks_file("t-1")), "unit\tcargo test --lib\nnet\tnode net.mjs\n");
        // A second choice replaces the first one; none chosen gives an empty file.
        task_checks(cwd.clone(), "t-1".into(), Vec::new()).unwrap();
        let text = read(&plan_path);
        assert_eq!(text.matches("## Checks chosen").count(), 1, "{text}");
        assert!(text.ends_with("- [ ] unit\n- [ ] lint\n- [ ] net\n"), "{text}");
        assert_eq!(read(&project.task_checks_file("t-1")), "");
        // The task list gives the checks of the task with the choice.
        task_checks(cwd.clone(), "t-1".into(), vec!["lint".into()]).unwrap();
        let list = task_list(cwd.clone()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        let rows: Vec<(&str, bool, Option<bool>)> = task.checks.iter().map(|check| (check.name.as_str(), check.recommended, check.chosen)).collect();
        assert_eq!(rows, vec![("unit", true, Some(false)), ("lint", true, Some(true)), ("net", false, Some(false))]);
        assert_eq!(serde_json::to_value(&task.checks[0]).unwrap()["chosen"], json!(false));
        assert!(task_checks(cwd, "t-2".into(), Vec::new()).unwrap_err().contains("no plan at"));
        clean(&project);
    }

    /// The proof of ticket task-checks: the checks of the task in DISPATCH_PROOF_TASK of the project
    /// in DISPATCH_PROOF_CWD, one line each with its recommended and chosen flags. Without the
    /// variables it does nothing.
    #[test]
    #[ignore]
    fn checks_of_the_project_for_the_proof() {
        let (Ok(cwd), Ok(ticket)) = (std::env::var("DISPATCH_PROOF_CWD"), std::env::var("DISPATCH_PROOF_TASK")) else { return };
        let list = task_list(cwd).unwrap();
        let Some(task) = list.tasks.iter().find(|task| task.name == ticket) else { return };
        // cargo writes the name of the test without a line end before this output.
        println!();
        for check in &task.checks {
            println!("check {} | recommended {} | chosen {:?} | {}", check.name, check.recommended, check.chosen, check.command);
        }
    }

    /// The setup files of a project name the list of checks, so Commit to git commits it.
    fn setup_files_have_checks(project: &Project) -> bool {
        project.setup_files().contains(&".dispatch/checks.txt")
    }

    #[test]
    fn a_ticked_check_must_run_in_the_work_run() {
        let report = new_report(FREE_WORDS);
        let chosen = |pairs: &[(&str, &str)]| pairs.iter().map(|(name, command)| (name.to_string(), command.to_string())).collect::<Vec<_>>();
        // A check inside a longer command, with a cd before it, a pipe after it and other spaces,
        // counts as run (user decision 2).
        let evidence = [bash("cd /d/p/src-tauri && cargo   test --lib 2>&1 | tail -40"), bash("npx tsc --noEmit; echo done")];
        assert_eq!(check_report(&report, &evidence, true, &chosen(&[("unit", "cargo test --lib"), ("lint", "npx tsc --noEmit")])), None);
        // A check in no command of the work run sends the report back with its command.
        let (reason, missing) = check_report(&report, &evidence, true, &chosen(&[("unit", "cargo test --lib"), ("net", "node net.mjs")])).unwrap();
        assert_eq!(reason, "The report says done, but the chosen check net did not run in its work run.");
        assert_eq!(missing, vec!["node net.mjs".to_string()]);
        let (reason, missing) = check_report(&report, &evidence, true, &chosen(&[("net", "node net.mjs"), ("ui", "npm run e2e")])).unwrap();
        assert_eq!(reason, "The report says done, but the chosen checks net, ui did not run in its work run.");
        assert_eq!(missing.len(), 2);
        // A run of the check in the plan run does not count.
        let plan_only = [plan_bash("node net.mjs"), bash("cargo test --lib")];
        assert_eq!(check_report(&report, &plan_only, true, &chosen(&[("net", "node net.mjs")])).map(|(_, missing)| missing), Some(vec!["node net.mjs".to_string()]));
        // A report that is not done, or a work run without a transcript, is not checked.
        assert_eq!(check_report(&report.replace("state: done", "state: failed"), &[], true, &chosen(&[("net", "node net.mjs")])), None);
        assert_eq!(check_report(&report, &[], false, &chosen(&[("net", "node net.mjs")])), None);
    }

    #[test]
    fn a_plan_gives_its_summary_and_its_hold() {
        let plan = "# Plan t-1\n\n## Summary\n- Adds a section to memory.md.\n- 1 file, 0 decisions.\n\n## Goal\nThe goal.\n\n## Decisions\n- D1: name of the section. Default: Dispatch pipeline.\n- D2: the date. HOLD: the user picks it.\n";
        assert_eq!(parse_plan(plan), (vec!["Adds a section to memory.md.".to_string(), "1 file, 0 decisions.".to_string()], true));
        // Without a summary the goal shows; a HOLD: outside the decisions is not a hold.
        let plan = "## Goal\nOne line.\n\n## Steps\n- HOLD: the line\n\n## Decisions\n- none\n";
        assert_eq!(parse_plan(plan), (vec!["One line.".to_string()], false));
        // Only the mark counts: the word in a sentence, "hold:" and "NOHOLD:" are not HOLD.
        assert!(!parse_plan("## Decisions\n- D1: the title. Default: Testers.\n- 3 decisions, none is HOLD\n- hold: no, NOHOLD: no\n").1);
        assert!(parse_plan("## Decisions\n- HOLD: the user names the file.\n").1);
        // Without both sections the first lines show, at most five.
        let (lines, hold) = parse_plan("# Title\n\none\ntwo\nthree\nfour\nfive\nsix\n");
        assert_eq!((lines.len(), lines[0].as_str(), hold), (5, "one", false));
        assert_eq!(parse_plan(""), (Vec::new(), false));
    }

    #[test]
    fn a_session_file_gives_the_ids_of_the_runs() {
        let project = scratch("sessions");
        apply(&project, &[]).unwrap();
        // The lines of the script, a copy of the work run, a repeated id, a bad id and other lines.
        let text = "plan 00000000-0000-4000-8000-00000000aaaa\nwork 00000000-0000-4000-8000-00000000bbbb\r\nwork 00000000-0000-4000-8000-00000000cccc\nwork 00000000-0000-4000-8000-00000000aaaa\nwork ../x\nnote abc\nplan\nplan a b\n";
        write_file(&project.session_file("t-1"), text).unwrap();
        assert_eq!(read_session_file(&project.session_file("t-1")), ["00000000-0000-4000-8000-00000000aaaa", "00000000-0000-4000-8000-00000000bbbb", "00000000-0000-4000-8000-00000000cccc"]);
        assert!(read_session_file(&project.session_file("t-2")).is_empty());
        // The runs keep the run of each id, the first one for an id that repeats.
        let runs = read_session_runs(&project.session_file("t-1"));
        let pairs: Vec<(&str, &str)> = runs.iter().map(|(run, id)| (run.as_str(), id.as_str())).collect();
        assert_eq!(pairs, [("plan", "00000000-0000-4000-8000-00000000aaaa"), ("work", "00000000-0000-4000-8000-00000000bbbb"), ("work", "00000000-0000-4000-8000-00000000cccc")]);
        // A session file makes no task; a task with sessions but no transcript counts no tokens.
        write_file(&project.reports.join("t-1.state"), "working\n").unwrap();
        write_file(&project.session_file("t-9"), "plan 00000000-0000-4000-8000-00000000dddd\n").unwrap();
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = list.tasks.iter().map(|task| task.name.as_str()).collect();
        assert_eq!(names, ["t-1"]);
        assert!(list.tasks[0].tokens.is_empty());
        let json = serde_json::to_value(&list.tasks[0]).unwrap();
        assert_eq!(json["tokens"], serde_json::json!([]));
        assert_eq!(json["runTokens"], serde_json::json!([]));
        assert!(list.tasks[0].evidence.is_empty());
        assert_eq!(json["evidence"], serde_json::json!([]));
    }

    /// The proof of ticket task-tokens: the token rows of each task of the project in
    /// DISPATCH_PROOF_CWD, from the function of the task card. Without the variable it does nothing.
    #[test]
    #[ignore]
    fn tokens_of_the_project_for_the_proof() {
        let Ok(cwd) = std::env::var("DISPATCH_PROOF_CWD") else { return };
        let list = task_list(cwd).unwrap();
        for task in list.tasks.iter().filter(|task| !task.tokens.is_empty()) {
            // cargo writes the name of the test without a line end before this output.
            println!("\ntask {}", task.name);
            for usage in &task.tokens {
                let total = usage.input + usage.cache_write + usage.cache_read + usage.output;
                println!("  {}: input {}, cache write {}, cache read {}, output {}, total {}", usage.model, usage.input, usage.cache_write, usage.cache_read, usage.output, total);
            }
        }
    }

    /// The proof of ticket task-evidence: the evidence lines of each task of the project in
    /// DISPATCH_PROOF_CWD, with the texts of the task card (stage, time, exit, first command line),
    /// then the full command and the output tail of each. Without the variable it does nothing.
    #[test]
    #[ignore]
    fn evidence_of_the_project_for_the_proof() {
        let Ok(cwd) = std::env::var("DISPATCH_PROOF_CWD") else { return };
        let list = task_list(cwd).unwrap();
        for task in list.tasks.iter().filter(|task| !task.evidence.is_empty()) {
            let count = |stage: &str| task.evidence.iter().filter(|item| item.stage == stage).count();
            // cargo writes the name of the test without a line end before this output.
            println!("\ntask {}: {} commands, PLAN {}, WORK {}", task.name, task.evidence.len(), count("PLAN"), count("WORK"));
            for item in &task.evidence {
                let first = item.command.lines().next().unwrap_or_default();
                println!("  {} | {} | exit {} | {}", item.stage, item.time.as_deref().unwrap_or("-"), item.exit, first);
            }
            for item in &task.evidence {
                println!("\n--- {} {} exit {}\nCOMMAND:\n{}\nOUTPUT ({} lines):", item.stage, item.time.as_deref().unwrap_or("-"), item.exit, item.command, item.output_tail.len());
                for line in &item.output_tail {
                    println!("    {line}");
                }
            }
        }
    }

    /// The proof of ticket report-check: for each task of the project in DISPATCH_PROOF_CWD with a
    /// report, the state of the report file, the state that the task list shows, the number of
    /// commands of its evidence and of its work run, the checks that did not run, and whether a
    /// taken file exists. Without the variable it does nothing.
    #[test]
    #[ignore]
    fn report_check_of_the_project_for_the_proof() {
        let Ok(cwd) = std::env::var("DISPATCH_PROOF_CWD") else { return };
        let project = Project::find(&cwd).unwrap();
        let list = task_list(cwd).unwrap();
        let mut tasks: Vec<&TaskInfo> = list.tasks.iter().filter(|task| task.report.is_some()).collect();
        tasks.sort_by(|a, b| a.name.cmp(&b.name));
        // cargo writes the name of the test without a line end before this output.
        println!();
        for task in tasks {
            let text = fs::read_to_string(project.reports.join(format!("{}.md", task.name))).unwrap_or_default();
            let file_state = parse_report(&text).0.map(|header| header.state).unwrap_or_default();
            let shown = task.header.as_ref().map_or("", |header| header.state.as_str());
            let session = project.session_file(&task.name).is_file();
            println!(
                "task {} | file {} | shown {} | session file {} | commands {} | work commands {} | unverified {} | taken {}",
                task.name,
                file_state,
                shown,
                if session { "yes" } else { "no" },
                task.evidence.len(),
                task.evidence.iter().filter(|item| item.stage == "WORK").count(),
                task.unverified.len(),
                if project.taken_file(&task.name).is_file() { "yes" } else { "no" }
            );
            if shown != file_state {
                println!("  reason: {}", task.did);
            }
            for claim in &task.unverified {
                println!("  unverified: {claim}");
            }
        }
    }

    /// The proof of ticket task-log: runs the task list on the project in DISPATCH_PROOF_CWD, which
    /// writes the logs, then prints the number of logs and the first 40 lines of the log of the task
    /// in DISPATCH_PROOF_TASK. Without the variables it does nothing.
    #[test]
    #[ignore]
    fn task_log_of_the_project_for_the_proof() {
        let (Ok(cwd), Ok(ticket)) = (std::env::var("DISPATCH_PROOF_CWD"), std::env::var("DISPATCH_PROOF_TASK")) else { return };
        let project = Project::find(&cwd).unwrap();
        let list = task_list(cwd).unwrap();
        let logs = files_with(&project.reports.join("logs"), "md").len();
        let plans = list.tasks.iter().filter(|task| task.plan.is_some()).count();
        // cargo writes the name of the test without a line end before this output.
        println!("\nlogs {logs} | tasks with a plan {plans}");
        let text = read(&project.log_file(&ticket));
        println!("--- first 40 lines of .dispatch/logs/{ticket}.md");
        for line in text.lines().take(40) {
            println!("{line}");
        }
        println!("--- end");
    }

    /// The proof of ticket ignore-tasks: a scratch git repository with committed task files, then
    /// the switch on with Apply and Commit to git, then off with Apply and Commit to git. After each
    /// step it prints the lines of Dispatch in the root `.gitignore`, the count of
    /// `git ls-files .dispatch` and the last commit. Without DISPATCH_PROOF_IGNORE it does nothing.
    #[test]
    #[ignore]
    fn ignore_switch_in_a_scratch_repository_for_the_proof() {
        if std::env::var("DISPATCH_PROOF_IGNORE").is_err() {
            return;
        }
        let project = git_scratch("ignore-proof");
        let root = project.root.clone();
        let git = |args: &[&str]| run_git(&root, args).unwrap();
        let show = |step: &str| {
            println!("--- {step}");
            let ours: Vec<String> = project.root_ignore_lines().into_iter().filter(|line| line == TASKS_IGNORE_MARK || line == ROOT_TASKS_IGNORE).collect();
            println!(".gitignore lines of Dispatch: {}", if ours.is_empty() { "no line".to_string() } else { ours.join(" | ") });
            println!("git ls-files .dispatch | wc -l: {}", git(&["ls-files", ".dispatch"]).lines().count());
            println!("git log -1: {}", git(&["log", "-1", "--format=%h %s"]).trim());
            println!("open steps: {:?}", open_steps(&project));
        };
        write_file(&root.join("README.md"), "scratch project of the ignore-tasks proof\n").unwrap();
        apply(&project, &[0]).unwrap();
        write_file(&project.briefs().join("t-1.md"), "brief\n").unwrap();
        write_file(&project.plans().join("t-1.md"), "# Plan t-1: one\n").unwrap();
        git(&["add", "--all"]);
        git(&["commit", "-q", "-m", "scratch setup with task files"]);
        // cargo writes the name of the test without a line end before this output.
        println!();
        show("start: task files committed, the switch off");
        set_ignore(&project, true);
        apply(&project, &[]).unwrap();
        show("switch on, Apply");
        println!("{}", commit_setup(&project).unwrap());
        show("switch on, Commit to git");
        set_ignore(&project, false);
        apply(&project, &[]).unwrap();
        show("switch off, Apply");
        println!("{}", commit_setup(&project).unwrap());
        show("switch off, Commit to git");
        println!("git status --porcelain: {:?}", git(&["status", "--porcelain"]).trim());
        println!("--- end");
        clean(&project);
    }

    /// An evidence line of a Bash command of the work run, for the tests of the report check.
    fn bash(command: &str) -> crate::core::flow::Evidence {
        crate::core::flow::Evidence { command: command.to_string(), stage: "WORK".to_string(), exit: "0".to_string(), ..Default::default() }
    }

    /// An evidence line of a Bash command of the plan run, for the tests of the report check.
    fn plan_bash(command: &str) -> crate::core::flow::Evidence {
        crate::core::flow::Evidence { stage: "PLAN".to_string(), ..bash(command) }
    }

    /// A done report of the new form with a Verification section.
    fn new_report(verification: &str) -> String {
        format!("state: done\nneeds: nothing\nfiles: a.rs\nplan: plans/t-1.md\n\n## What changed\n- A check.\n\n## Why\n- The brief.\n\n## Files\n- a.rs\n\n## Verification\n{verification}\n## Follow-ups\n- none\n")
    }

    /// A Verification section in free words, as the report of a-screenshot-that-i-paste-into-a-chat
    /// had it: a command written shorter than the run, and lines that start with a file name.
    const FREE_WORDS: &str = "- I ran the tests of the chat tabs: 14 passed, 0 failed.\n- `node --test tests/chattabs.test.ts`: all pass.\n  - `setup-1920x1080.png` shows the window.\n- `npx tsc --noEmit` and the whole test folder: no output, 0 fail.\n";

    #[test]
    fn a_done_report_in_free_words_stays_done_when_its_work_run_ran_commands() {
        // False warning 1: the run had a pipe after the command, and two commands stood in one line.
        let evidence = [plan_bash("git status --porcelain"), bash("node --test tests/chattabs.test.ts 2>&1 | tail -40"), bash("npx tsc --noEmit && node --test tests/*.test.ts && git status --porcelain")];
        assert_eq!(check_report(&new_report(FREE_WORDS), &evidence, true, &[]), None);
        // False warning 2: lines that start with a file name in a code span count for nothing.
        let files = new_report("- `setup-1920x1080.png`: the Setup window.\n- `options-1280x720.png`: the Options window.\n");
        assert_eq!(check_report(&files, &evidence, true, &[]), None);
        // A section without a command, and a new report without the section, stay done too.
        assert_eq!(check_report(&new_report("Checked by hand.\n"), &evidence, true, &[]), None);
        assert_eq!(check_report(&new_report("").replace("## Verification\n", ""), &evidence, true, &[]), None);
        // A report that is not done, or a work run without a transcript on this machine, is not checked.
        let report = new_report(FREE_WORDS);
        assert_eq!(check_report(&report.replace("state: done", "state: failed"), &[], true, &[]), None);
        assert_eq!(check_report(&report.replace("state: done", "state: needs-decision"), &[], true, &[]), None);
        assert_eq!(check_report(&report, &[], false, &[]), None);
    }

    #[test]
    fn a_done_report_whose_work_run_ran_no_command_goes_back_to_working() {
        let no_command = Some(("The report says done, but its work run ran no command.".to_string(), Vec::new()));
        let report = new_report(FREE_WORDS);
        assert_eq!(check_report(&report, &[], true, &[]), no_command);
        // Commands of the plan run do not count.
        assert_eq!(check_report(&report, &[plan_bash("cargo test --lib"), plan_bash("git log -1")], true, &[]), no_command);
        // The task list checks only a task whose work run has a transcript: the sessions of the
        // scratch project have none, so the same report stays done there. The proof test covers
        // the real project.
        let project = scratch("report-check");
        apply(&project, &[]).unwrap();
        write_file(&project.reports.join("t-1.md"), &report).unwrap();
        write_file(&project.session_file("t-1"), "plan sess-1\nwork sess-2\n").unwrap();
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!((task.header.as_ref().unwrap().state.as_str(), task.unverified.len()), ("done", 0));
        clean(&project);
    }

    #[test]
    fn a_taken_file_keeps_a_sent_back_report_done() {
        let report = new_report(FREE_WORDS);
        let chosen = [("net".to_string(), "node net.mjs".to_string())];
        let reason = "The report says done, but the chosen check net did not run in its work run.";
        let run = |text: &str, evidence: &[crate::core::flow::Evidence], taken: Option<&str>| {
            let mut header = parse_report(text).0;
            let mut did = report_gist(text);
            let (unverified, note) = apply_report_check(&mut header, &mut did, check_report(text, evidence, true, &chosen), taken);
            (header.unwrap().state, did, unverified, note)
        };
        let ran = [bash("cargo test --lib")];
        // Without a taken file: working and the reason in did, so the card shows the button.
        assert_eq!(run(&report, &ran, None), ("working".to_string(), reason.to_string(), vec!["node net.mjs".to_string()], None));
        // With a taken file: done, the gist stays, the check stays, the note holds the time and the reason.
        let note = TakenInfo { at: 1763200000000, reason: reason.to_string() };
        assert_eq!(run(&report, &ran, Some("taken: 1763200000000 2025-11-15T10:26:40Z\n")), ("done".to_string(), report_gist(&report), vec!["node net.mjs".to_string()], Some(note)));
        // A file without a number counts as taken at time 0.
        assert_eq!(run(&report, &ran, Some("")).3.map(|note| note.at), Some(0));
        // A report that passes, or a failed report, gets no change from a taken file.
        let passed = [bash("node net.mjs 2>&1 | tail -5")];
        assert_eq!(run(&report, &passed, Some("taken: 5")), ("done".to_string(), report_gist(&report), Vec::new(), None));
        let failed = report.replace("state: done", "state: failed");
        assert_eq!(run(&failed, &ran, Some("taken: 5")), ("failed".to_string(), report_gist(&failed), Vec::new(), None));
    }

    #[test]
    fn a_report_of_the_old_form_is_not_checked() {
        // The form of the reports before the rule: "What I did" and no Verification section.
        let old = "state: done\nneeds: nothing\nfiles: a.rs\nplan: plans/t-1.md\n\n# Report t-1\n\n## What I did\n- `task_stop` is new.\n\n## Open\n- none\n";
        assert_eq!(check_report(old, &[], true, &[]), None);
        assert_eq!(check_report("state: done\n\ndone\n", &[], true, &[]), None);
        // "What changed" stood in reports before the rule too, so alone it marks no new form
        // (answer to question 1 of the work run: the case of done-line-repeats).
        let what_changed = "state: done\n\n# Report\n\n## What changed\n- x\n\n## What I verified and how\n- `cargo test`\n";
        assert_eq!(check_report(what_changed, &[], true, &[]), None);
        for heading in ["Why", "Files", "Follow-ups"] {
            let new = format!("state: done\n\n## What changed\n- x\n\n## {heading}\n- y\n");
            assert!(check_report(&new, &[], true, &[]).is_some(), "{heading} marks the new form");
        }
        // An old report with a Verification section is checked like a new one.
        let section = "state: done\n\n## What I did\n- x\n\n## Verification\n- `cargo test`: ok.\n";
        assert_eq!(check_report(section, &[bash("cargo test")], true, &[]), None);
        assert_eq!(check_report(section, &[], true, &[]).map(|(_, missing)| missing), Some(Vec::new()));
    }

    /// An evidence line of a stage with its time, exit code and output, for the tests of the log.
    fn evidence(stage: &str, time: &str, command: &str, exit: &str, tail: &[&str]) -> crate::core::flow::Evidence {
        crate::core::flow::Evidence {
            stage: stage.to_string(),
            time: Some(time.to_string()),
            command: command.to_string(),
            exit: exit.to_string(),
            output_tail: tail.iter().map(|line| line.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn the_log_of_a_task_matches_the_fixture_line_by_line() {
        let plan = "# t-1: a log\r\n\r\n## Summary\r\n- One file changes.\r\n\r\n## Decisions\r\n1. Which way?\r\n   - Default: this way. Recommended: short.\r\n   - Other: that way. Not recommended: long.\r\n";
        let report = "state: done\nneeds: nothing\nfiles: a.rs\nplan: .dispatch/plans/t-1.md\n\n## What changed\n- A log.\n\n## Why\n- The brief.\n\n## Files\n- `a.rs`: the log.\n\n## Verification\n- `cargo test --lib`: ok.\n  - `npm run build`: exit 0.\n\n## Follow-ups\n- none\n";
        let (header, questions) = parse_report(report);
        let evidence = [
            evidence("PLAN", "2026-11-14T10:00:00.000Z", "git status --porcelain", "0", &[]),
            evidence("WORK", "2026-11-14T10:05:00.000Z", "cd /d/p && cargo test --lib", "0", &["running 2 tests", "test result: ok. 2 passed"]),
            evidence("WORK", "2026-11-14T10:06:00.000Z", "echo a\necho b", "1", &[]),
        ];
        let tokens = [crate::core::flow::ModelUsage { model: "claude-x".to_string(), input: 1, cache_write: 2, cache_read: 3, output: 4 }];
        let did = report_gist(report);
        let text = task_log_text(&LogInput {
            id: "t-1",
            title: "A log",
            date: "2026-11-14",
            plan,
            report: Some(report),
            header: header.as_ref(),
            did: &did,
            questions: &questions,
            evidence: &evidence,
            tokens: &tokens,
        });
        let expected = "# A log (t-1) — 2026-11-14

## Plan approved
# t-1: a log

## Summary
- One file changes.

## Decisions
1. Which way?
   - Default: this way. Recommended: short.
   - Other: that way. Not recommended: long.

## Stages

### STAGE: PLAN
### EVIDENCE: PLAN 2026-11-14T10:00:00.000Z
COMMAND: git status --porcelain
EXIT: 0
OUTPUT:

### 1. PLAN — ok
One file changes.
Files: .dispatch/plans/t-1.md
Blockers: Which way?

### STAGE: WORK
### EVIDENCE: WORK 2026-11-14T10:05:00.000Z
COMMAND: cd /d/p && cargo test --lib
EXIT: 0
OUTPUT:
    running 2 tests
    test result: ok. 2 passed

### EVIDENCE: WORK 2026-11-14T10:06:00.000Z
COMMAND: echo a
    echo b
EXIT: 1
OUTPUT:

### 2. WORK — ok
A log.
Files: a.rs
Blockers: none

## What changed
- A log.

## Why
- The brief.

## Files
- `a.rs`: the log.

## Verification
- `cargo test --lib`: ok.
  - `npm run build`: exit 0.

## Follow-ups
- none

### Token usage
| Model | Input | Cache write | Cache read | Output | Total |
|---|---|---|---|---|---|
| claude-x | 1 | 2 | 3 | 4 | 10 |
";
        let got: Vec<&str> = text.split('\n').collect();
        let want: Vec<&str> = expected.split('\n').collect();
        for (number, (got, want)) in got.iter().zip(&want).enumerate() {
            assert_eq!(got, want, "line {}", number + 1);
        }
        assert_eq!(got.len(), want.len(), "{text}");

        // A stage without a command keeps its marker and its entry; a HOLD plan without the user
        // decisions is blocked, a question blocks the work, and no report gives no sections.
        let hold = "# t-2: hold\n\n## Decisions\n1. Ask?\n   - HOLD: the user. Recommended: theirs.\n   - Other: me. Not recommended: mine.\n";
        let asks = "state: needs-decision\nneeds: decision\nfiles: none\nplan: p\n\n## Questions\n1. Which one?\n   - A\n";
        let (header, questions) = parse_report(asks);
        let text = task_log_text(&LogInput { id: "t-2", title: "", date: "2026-11-14", plan: hold, report: Some(asks), header: header.as_ref(), did: "", questions: &questions, evidence: &[], tokens: &[] });
        assert!(text.starts_with("# t-2 (t-2) — 2026-11-14\n"), "{text}");
        // Without a Summary the gist is what the task card shows: the first line of the plan body.
        assert!(text.contains("### STAGE: PLAN\n\n### 1. PLAN — blocked\n1. Ask?\nFiles: .dispatch/plans/t-2.md\nBlockers: Ask?\n"), "{text}");
        assert!(text.contains("### STAGE: WORK\n\n### 2. WORK — blocked\nThe report has no text.\nFiles: none\nBlockers: 1. Which one?\n"), "{text}");
        let decided = with_user_decisions(hold, "1. Ask?: the user");
        let text = task_log_text(&LogInput { id: "t-2", title: "", date: "d", plan: &decided, report: None, header: None, did: "", questions: &[], evidence: &[], tokens: &[] });
        assert!(text.contains("### 1. PLAN — ok\n") && text.contains("### 2. WORK — nothing-to-do\nNo report yet.\nFiles: none\n"), "{text}");
        assert!(text.contains("## Verification\nnone\n") && text.ends_with("|---|---|---|---|---|---|\n"), "{text}");
    }

    /// Sets the modification time of a file to a moment in milliseconds since the Unix epoch.
    fn set_modified_ms(path: &Path, millis: u64) {
        let file = fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(UNIX_EPOCH + std::time::Duration::from_millis(millis)).unwrap();
    }

    fn modified_ms(path: &Path) -> u64 {
        file_entry(path).unwrap().modified
    }

    #[test]
    fn the_log_is_written_with_the_plan_and_renewed_by_a_newer_report_only() {
        assert!(!log_needed(None, Some(5), None));
        assert!(log_needed(Some(1), None, None) && log_needed(Some(3), None, Some(2)) && log_needed(Some(1), Some(3), Some(2)));
        assert!(!log_needed(Some(1), Some(2), Some(2)) && !log_needed(Some(2), None, Some(2)));

        let project = scratch("task-log");
        apply(&project, &[]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let log = project.log_file("t-1");
        // A state file without a plan gives no log.
        write_file(&project.reports.join("t-0.state"), "planning\n").unwrap();
        write_file(&project.plans().join("t-1.md"), "# t-1: one\n\n## Summary\n- The plan gist.\n\n## Decisions\n1. Ask?\n   - HOLD: the user. Recommended: theirs.\n   - Other: me. Not recommended: mine.\n").unwrap();
        let list = task_list(cwd.clone()).unwrap();
        assert!(!project.log_file("t-0").exists());
        let text = read(&log);
        assert!(text.starts_with("# one (t-1) — ") && text.contains("### 1. PLAN — blocked\nThe plan gist.\n") && text.contains("No report yet."), "{text}");
        assert!(list.tasks.iter().find(|task| task.name == "t-1").unwrap().log.is_some());

        // A poll that finds nothing newer leaves the log.
        let plan_time = modified_ms(&project.plans().join("t-1.md"));
        set_modified_ms(&log, plan_time + 1000);
        task_list(cwd.clone()).unwrap();
        assert_eq!(modified_ms(&log), plan_time + 1000);

        // The user decisions make the plan newer: the log takes them (user decision 1).
        task_decide(cwd.clone(), "t-1".to_string(), "1. Ask?: the user".to_string()).unwrap();
        set_modified_ms(&project.plans().join("t-1.md"), plan_time + 2000);
        task_list(cwd.clone()).unwrap();
        let text = read(&log);
        assert!(text.contains("## User decisions") && text.contains("### 1. PLAN — ok\n"), "{text}");
        set_modified_ms(&log, plan_time + 3000);

        // A newer report renews the log, once.
        let report = project.reports.join("t-1.md");
        write_file(&report, "state: done\nneeds: nothing\nfiles: a.rs\nplan: p\n\n## What changed\n- Done the work.\n").unwrap();
        set_modified_ms(&report, plan_time + 4000);
        task_list(cwd.clone()).unwrap();
        let text = read(&log);
        assert!(text.contains("### 2. WORK — ok\nDone the work.\nFiles: a.rs\n") && text.contains("## What changed\n- Done the work.\n"), "{text}");
        set_modified_ms(&log, plan_time + 5000);
        task_list(cwd).unwrap();
        assert_eq!(modified_ms(&log), plan_time + 5000);
        clean(&project);
    }

    #[test]
    fn a_brief_gives_its_title_and_a_report_its_first_line() {
        // The title line of a brief, as triage writes it.
        let brief = "# task-stop: a Stop button for a running task\n\n## The user's words\n\"stop it\"\n";
        assert_eq!(parse_brief(brief), "a Stop button for a running task");
        // Without a title: the first quoted line of the user's words, without the quotes.
        let words = "# brief\n\n## The user's words\nSaid twice:\n\"make it short\"\n\n## Constraints\n\"not this\"\n";
        assert_eq!(parse_brief(words), "make it short");
        assert_eq!(parse_brief(""), "");
        assert_eq!(title_after_colon("# Plan t-9: the title\n## Summary\n"), "the title");
        assert_eq!(title_after_colon("no heading: here\n"), "");

        // A report: the header, a title, then "What I did" with its first item.
        let report = "state: done\nneeds: nothing\nfiles: a.rs\nplan: p.md\n\n# Report t-1\n\n## What I did\n- New command `task_stop`.\n- Second.\n";
        assert_eq!(report_gist(report), "New command `task_stop`.");
        // A report without a section: its first text line; a numbered item loses its number.
        assert_eq!(report_gist("state: failed\n\nThe build broke.\n"), "The build broke.");
        assert_eq!(report_gist("# Report\n\n1. First step.\n"), "First step.");
        assert_eq!(report_gist(""), "");
        assert_eq!(report_gist("state: done\nneeds: nothing\n"), "");
    }

    #[test]
    fn task_list_joins_the_state_the_plan_and_the_report_of_a_ticket() {
        let project = scratch("tasks");
        apply(&project, &[]).unwrap();
        write_file(&project.reports.join("t-1.state"), "working\n").unwrap();
        write_file(&project.plans().join("t-1.md"), "# Plan t-1: the plan title\n\n## Goal\nThe goal of t-1.\n").unwrap();
        write_file(&project.briefs().join("t-1.md"), "# t-1: the brief title\n\n## The user's words\n\"do it\"\n(Said with a screenshot.)\n").unwrap();
        write_file(&project.reports.join("t-1.md"), "state: done\nneeds: nothing\nfiles: none\nplan: plans/t-1.md\n\ndone\n").unwrap();
        write_file(&project.plans().join("t-2.md"), "# Plan t-2: plan two\n").unwrap();
        write_file(&project.reports.join("t-2.state"), "planning\n").unwrap();
        // Not tasks: the briefs, the options files, the script and a report without the Markdown extension.
        write_file(&project.briefs().join("t-3.md"), "brief\n").unwrap();
        write_file(&project.reports.join("notes.txt"), "x\n").unwrap();
        // A planned entry of the old layout is no task either: it becomes a ticket in New.
        write_file(&project.backlog_dir().join("e-1.md"), "sent: 1\norder: 1\n\nplanned work\n").unwrap();
        // The ticket of t-1 follows its task, and t-1 shows the title of the ticket.
        write_file(&project.tickets_file(), "{\"op\":\"open\",\"id\":\"t-1\",\"title\":\"Do it\",\"status\":\"todo\",\"order\":1}\n").unwrap();

        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let mut names: Vec<&str> = list.tasks.iter().map(|task| task.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["t-1", "t-2"]);
        let tickets: Vec<(&str, &str, &str, &str)> = list.tickets.iter().map(|t| (t.id.as_str(), t.title.as_str(), t.status.as_str(), t.note.as_str())).collect();
        assert_eq!(tickets, [("t-1", "the brief title", "done", "done"), ("planned-work", "Planned work", "new", "")]);
        assert!(!project.backlog_dir().exists());
        let t1 = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!(t1.state, "working");
        assert!(t1.plan.is_some() && t1.report.is_some());
        assert_eq!(t1.header.as_ref().map(|h| h.state.as_str()), Some("done"));
        let t2 = list.tasks.iter().find(|task| task.name == "t-2").unwrap();
        assert_eq!((t2.state.as_str(), t2.plan.is_some(), t2.report.is_none(), t2.header.is_none()), ("planning", true, true, true));
        // The brief gives the "about" of t-1 over its plan title; t-2 has no brief, so its plan title.
        assert_eq!((t1.about.as_str(), t1.brief.is_some(), t1.did.as_str()), ("the brief title", true, "done"));
        assert_eq!((t2.about.as_str(), t2.brief.is_none(), t2.did.as_str()), ("plan two", true, ""));
        // The Decisions window gets the whole section of the user's words and the Goal of the plan.
        assert_eq!((t1.words.clone(), t1.goal.clone()), (vec!["\"do it\"".to_string(), "(Said with a screenshot.)".to_string()], vec!["The goal of t-1.".to_string()]));
        assert!(t2.words.is_empty() && t2.goal.is_empty());
        // The scratch project is in no git repository, so nothing is dirty.
        assert!(list.dirty.is_empty());
        // A project without the field "paused" is not paused (ticket pause-tasks).
        assert!(!list.paused);
        assert!(check_ticket("t-1").is_ok() && check_ticket("../t-1").is_err() && check_ticket("").is_err());
        clean(&project);
    }

    #[test]
    fn a_plan_gives_its_tldr_for_the_decisions_window() {
        let project = scratch("tldr");
        apply(&project, &[]).unwrap();
        let plan = "# Plan t-a: with a TL;DR\n\n## Summary\n- One line.\n\n## Goal\nThe goal.\n\n## TL;DR\n- The window gets a short text.\nYou decide faster.\n\n## Decisions\n1. A.\n   - Default: x. Recommended: y.\n   - Other: z. Not recommended: w.\n";
        write_file(&project.plans().join("t-a.md"), plan).unwrap();
        // A plan from before the rule: no TL;DR section.
        write_file(&project.plans().join("t-b.md"), &plan.replace("## TL;DR\n- The window gets a short text.\nYou decide faster.\n\n", "")).unwrap();

        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let task = |name: &str| list.tasks.iter().find(|task| task.name == name).unwrap();
        let (a, b) = (task("t-a"), task("t-b"));
        assert_eq!(a.tldr, vec!["The window gets a short text.".to_string(), "You decide faster.".to_string()]);
        assert!(b.tldr.is_empty());
        // The other parts of the plan read as before.
        for t in [a, b] {
            assert_eq!(t.goal, vec!["The goal.".to_string()]);
            assert_eq!(t.summary, vec!["One line.".to_string()]);
            assert_eq!(t.decisions.len(), 1);
        }
        clean(&project);
    }

    #[test]
    fn the_handoff_names_the_open_tasks_and_the_folders() {
        let project = scratch("handoff");
        let file = project.root.join("plan.md");
        write_file(&file, "plan\n").unwrap();
        let entry = || file_entry(&file);
        let header = |state: &str, needs: &str| Some(ReportHeader { state: state.into(), needs: needs.into(), ..ReportHeader::default() });
        let task = |name: &str, state: &str| TaskInfo {
            name: name.to_string(),
            state: state.to_string(),
            plan: None,
            summary: Vec::new(),
            hold: false,
            decisions: Vec::new(),
            report: None,
            header: None,
            questions: Vec::new(),
            brief: None,
            about: String::new(),
            did: String::new(),
            words: Vec::new(),
            goal: Vec::new(),
            tldr: Vec::new(),
            measure_changed: Vec::new(),
            leftovers: Vec::new(),
            branch: None,
            tokens: Vec::new(),
            run_tokens: Vec::new(),
            evidence: Vec::new(),
            unverified: Vec::new(),
            taken: None,
            log: None,
            checks: Vec::new(),
            auto: false,
            plain: false,
            elsewhere: false,
            work_choice: None,
            parts: Vec::new(),
            night_hold: false,
        };
        let planning = task("t-plan", "planning");
        let ready = TaskInfo { plan: entry(), hold: true, ..task("t-ready", "planning") };
        let working = TaskInfo { plan: entry(), ..task("t-work", "working") };
        let asks = TaskInfo {
            plan: entry(),
            report: entry(),
            header: header("needs-decision", "decision"),
            questions: vec![Question { number: 1, text: "Which?".into(), options: vec!["a".into()] }],
            ..task("t-ask", "working")
        };
        let failed = TaskInfo { report: entry(), header: header("failed", "nothing"), ..task("t-fail", "working") };
        let done = TaskInfo { report: entry(), header: header("done", "nothing"), ..task("t-done", "working") };
        let stopped = task("t-stop", "stopped");
        let tasks = [planning, ready, working, asks, failed, done, stopped];

        let text = handoff_text(&tasks, &["t-plan".into(), "t-work".into()], &[], 212_400, "E:/p-reports", "powershell -File E:/p-reports/worker.ps1");
        assert!(!text.contains('\n') && !text.contains('\r'), "{text}");
        assert!(text.starts_with("Dispatch: this is a new triage chat") && text.contains("reached 212k tokens"), "{text}");
        assert!(text.contains("t-plan: its plan run works"), "{text}");
        assert!(text.contains("t-work: its work run works"), "{text}");
        assert!(text.contains("t-ready: plan ready, it waits for Approve in Dispatch and has a decision that only the user takes"), "{text}");
        assert!(text.contains("t-ask: its worker asks a question"), "{text}");
        assert!(text.contains("t-fail: failed"), "{text}");
        assert!(!text.contains("t-done") && !text.contains("t-stop"), "{text}");
        assert!(text.contains(" 2 tasks are finished or stopped."), "{text}");
        for folder in ["E:/p-reports/briefs/<ticket-id>.md", "E:/p-reports/plans/<ticket-id>.md", "E:/p-reports/<ticket-id>.md", "E:/p-reports/<ticket-id>.state"] {
            assert!(text.contains(folder), "{folder} missing: {text}");
        }
        assert!(text.contains("`powershell -File E:/p-reports/worker.ps1 status`"), "{text}");

        // An approval that waits for the project; a plan run that ended without a plan.
        let queued = handoff_text(&tasks[1..2], &[], &["t-ready".into()], 0, "R", "S");
        assert!(queued.contains("t-ready: approved in Dispatch, its work run waits until the project is free"), "{queued}");
        let none = handoff_text(&tasks[5..], &[], &[], 0, "R", "S");
        assert!(none.contains("No task is open.") && none.contains(" 2 tasks are finished"), "{none}");
        assert!(handoff_text(&tasks[..1], &[], &[], 0, "R", "S").contains("t-plan: planning, but no plan run works"));
        // A done report that the check sent back (ticket report-check) stays open.
        let unverified = TaskInfo { report: entry(), header: header("working", "nothing"), ..task("t-check", "working") };
        let check = handoff_text(&[unverified], &[], &[], 0, "R", "S");
        assert!(check.contains("t-check: its report says done, but Dispatch found no command in the transcript"), "{check}");
        clean(&project);
    }

    /// A fake `claude` command for the script: it records its arguments and its folder, answers
    /// `agents` with one worker `t-1` whose state the variable FAKE_STATE gives, and acts as the
    /// planner on a plan prompt: it writes the plan file the prompt names, as the real plan run
    /// does. A plan prompt with "Measure before the plan is on" makes it run command 1 through the
    /// `measure` verb of the script first and write a plan with the section Measured.
    /// With a file `fail.txt` next to it, a run (not `agents`) ends with the exit code in that file.
    fn fake_claude(base: &Path) -> PathBuf {
        let dir = base.join("fake-bin");
        write_file(&dir.join("claude.cmd"), "@node \"%~dp0fake-claude.js\" %*\r\n").unwrap();
        write_file(
            &dir.join("fake-claude.js"),
            "const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(__dirname + '/args.txt', JSON.stringify(args) + '\\n');
// The folder of a run; the script lists the workers from the folder of its caller.
if (args[0] !== 'agents') fs.writeFileSync(__dirname + '/cwd.txt', process.cwd());
if (args[0] === 'agents') {
  const copy = __dirname + '/copy.txt';
  const worker = { id: 'bg-1', name: process.env.FAKE_NAME || 't-1', sessionId: fs.existsSync(copy) ? fs.readFileSync(copy, 'utf8') : 'sess-1', startedAt: 1, state: process.env.FAKE_STATE };
  if (process.env.FAKE_STATUS) worker.status = process.env.FAKE_STATUS;
  process.stdout.write(JSON.stringify([worker]));
} else if (fs.existsSync(__dirname + '/fail.txt')) {
  process.exit(Number(fs.readFileSync(__dirname + '/fail.txt', 'utf8')));
} else if (args[0] === 'stop') {
  process.stdout.write('stopped ' + args[1] + '\\n');
} else {
  // A run that starts a new session, or a resume that starts a copy, has its own session id (FAKE_COPY): the agents list gives it from now on.
  if (process.env.FAKE_COPY) fs.writeFileSync(__dirname + '/copy.txt', process.env.FAKE_COPY);
  // The start of a run (ticket stale-report-loop): the branch of the checkout and the times of the
  // report and the state file of the ticket that watch.txt names.
  if (fs.existsSync(__dirname + '/watch.txt')) {
    const ticket = fs.readFileSync(__dirname + '/watch.txt', 'utf8').trim();
    const head = require('child_process').execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    const time = (name) => fs.statSync('.dispatch/' + name).mtimeMs;
    fs.appendFileSync(__dirname + '/starts.txt', JSON.stringify({ branch: head, report: time(ticket + '.md'), state: time(ticket + '.state') }) + '\\n');
  }
  const plan =/Write the plan to (.+?) with the sections/.exec(args[0]);
  let text = 'plan\\n';
  if (plan && args[0].includes('Measure before the plan is on')) {
    const path = require('path');
    const brief = /Read the brief (.+?)\\. Write/.exec(args[0])[1];
    const id = /Plan ticket (\\S+)\\./.exec(args[0])[1];
    const script = path.join(path.dirname(path.dirname(brief)), 'worker.ps1');
    const run = require('child_process').spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, 'measure', id, '1'], { encoding: 'utf8' });
    fs.appendFileSync(__dirname + '/args.txt', JSON.stringify(['(planner)', 'measure', id, '1', String(run.status)]) + '\\n');
    text = '# ' + id + ': plan\\n\\n## Measured\\n- Command 1 ended with exit code ' + run.status + '.\\n\\n' + run.stdout;
  }
  if (plan) fs.writeFileSync(plan[1], text);
  const report = /Write the report to (.+?[.]md)[.]/.exec(args[0]);
  if (report && fs.existsSync(__dirname + '/work.txt')) {
    const git = (...more) => require('child_process').execFileSync('git', more, { encoding: 'utf8' }).trim();
    const ticket = require('path').basename(report[1], '.md');
    fs.appendFileSync(__dirname + '/branches.txt', ticket + ' ' + git('symbolic-ref', '--short', 'HEAD') + '\\n');
    fs.writeFileSync('work-' + ticket + '.txt', fs.readFileSync(__dirname + '/work.txt', 'utf8'));
    git('add', 'work-' + ticket + '.txt');
    git('commit', '-q', '-m', ticket + ' work');
  }
  process.stdout.write('bg-1\\n');
}
",
        )
        .unwrap();
        dir
    }

    /// Runs the script with the fake `claude` first on PATH. Gives the exit code and both outputs.
    /// `state` is the state of the fake worker; `blocked/waiting` gives it the status `waiting` too.
    fn run_script(project: &Project, fake: &Path, state: &str, args: &[&str]) -> (i32, String) {
        run_script_env(project, fake, state, args, &[])
    }

    /// `run_script` with more variables for the script.
    fn run_script_env(project: &Project, fake: &Path, state: &str, args: &[&str], extra: &[(&str, &str)]) -> (i32, String) {
        let path = format!("{};{}", fake.display(), std::env::var("PATH").unwrap_or_default());
        let (state, status) = state.split_once('/').unwrap_or((state, ""));
        let output = Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(project.script())
            .args(args)
            .env("PATH", path)
            .env("FAKE_STATE", state)
            .env("FAKE_STATUS", status)
            .env("FAKE_NAME", fake_name(project))
            .env_remove("CLAUDECODE")
            .envs(extra.iter().copied())
            .output()
            .unwrap();
        let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        (output.status.code().unwrap_or(-1), text)
    }

    /// The name of the worker that the fake gives: the text of `fake-name.txt` in the reports folder, else `t-1`.
    fn fake_name(project: &Project) -> String {
        fs::read_to_string(project.reports.join("fake-name.txt")).unwrap_or_default()
    }

    /// The arguments of the last `claude` call that the fake recorded.
    fn last_call(fake: &Path) -> Vec<String> {
        let calls = read(&fake.join("args.txt"));
        // The script lists the workers after a run to save its session (ticket task-tokens); that call is no run.
        let calls: Vec<Vec<String>> = calls.lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        calls.into_iter().rev().find(|call| call.first().map(String::as_str) != Some("agents")).unwrap()
    }

    /// The expected `plan-flags.txt` with "Measure before the plan" on: the lines of `plan_lines`
    /// with the measure verb of the script and the measure folder in the allowed list.
    fn plan_lines_measuring(project: &Project, choice_lines: &str) -> String {
        let rule = project.rule_path();
        let script = script_command(&project.reports_text());
        format!(
            "{choice_lines}--permission-mode\ndontAsk\n--tools\nRead,Grep,Glob,Bash,Write\n--allowedTools\nBash(git status*),Bash(git log *),Bash(git diff *),Bash({script} measure *),Write({rule}/plans/**),Write({rule}/measure/**)\n"
        )
    }

    /// Turns "Measure before the plan" on or off in the settings file, as the switch does.
    fn set_measure(project: &Project, on: bool) {
        let options = Options { measure_before_plan: on, ..project.options() };
        write_file(&project.options_file(), &format!("{}\n", serde_json::to_string_pretty(&options).unwrap())).unwrap();
    }

    /// The titles of the steps that are To do.
    fn open_steps(project: &Project) -> Vec<&'static str> {
        plan(project).unwrap().steps.iter().filter(|step| !step.done).map(|step| step.title).collect()
    }

    /// Makes the root of a proof project a git repository with a local identity, as `git_scratch`.
    fn git_init(project: &Project) {
        for args in [
            &["init", "-q"][..],
            &["config", "user.name", "Dispatch test"],
            &["config", "user.email", "test@example.invalid"],
            &["config", "commit.gpgsign", "false"],
            &["config", "core.excludesFile", "no-such-ignore-file"],
        ] {
            run_git(&project.root, args).unwrap();
        }
    }

    #[test]
    fn the_plan_options_differ_only_by_the_measure_switch() {
        let project = scratch("measure-flags");
        apply(&project, &[0]).unwrap();
        let today = plan_lines(&project, "--model\nfable\n--effort\nxhigh\n");
        assert_eq!(read(&project.plan_flags()), today, "off: the options of 0.1.54");
        let claude_off = fs::read_to_string(project.instructions()).unwrap();
        assert!(!claude_off.contains("measure-commands.txt"), "{claude_off}");
        assert!(open_steps(&project).is_empty());
        assert!(!project.measure_commands_file().exists() && !project.tasks_ignore().exists());

        // On: the options, the section and the new step are To do until Apply.
        set_measure(&project, true);
        assert_eq!(open_steps(&project), ["Task files", "Section in CLAUDE.md", "Measure before the plan"]);
        let cwd = project.root.to_string_lossy().into_owned();
        let shown = set_measure_commands(cwd, "  # limit 5  \r\ncmd /c echo measured\r\n\r\n".to_string()).unwrap();
        assert_eq!(shown.measure_commands, "# limit 5\ncmd /c echo measured\n");
        let step = shown.steps.iter().find(|step| step.title == "Measure before the plan").unwrap();
        assert!(step.detail.contains("1. cmd /c echo measured") && step.detail.contains("at most 5 s"), "{}", step.detail);
        apply(&project, &[]).unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        assert_eq!(read(&project.plan_flags()), plan_lines_measuring(&project, "--model\nfable\n--effort\nxhigh\n"));
        assert_eq!(read(&project.tasks_ignore()), "measure/\n");
        let claude_on = read(&project.instructions());
        let tasks = project.reports_text();
        assert!(claude_on.contains(&format!("the commands of `{tasks}/measure-commands.txt`, and only these")), "{claude_on}");
        assert!(claude_on.contains("/worker.ps1 measure <ticket-id> <n>`") && claude_on.contains("the section Measured after TL;DR"), "{claude_on}");
        assert!(claude_on.contains("\"not reproduced\""), "{claude_on}");
        // The choice of the user stays when the switch rewrites the file.
        write_worker_flags(&project, &choice("sonnet", "high"), &choice("opus", "xhigh"), "").unwrap();
        assert_eq!(read(&project.plan_flags()), plan_lines_measuring(&project, "--model\nsonnet\n--effort\nhigh\n"));

        // Off again: the options file and CLAUDE.md are byte for byte those of the start.
        write_worker_flags(&project, &choice("fable", "xhigh"), &choice("opus", "xhigh"), "").unwrap();
        set_measure(&project, false);
        assert_eq!(open_steps(&project), ["Task files", "Section in CLAUDE.md"]);
        apply(&project, &[]).unwrap();
        assert_eq!(fs::read_to_string(project.plan_flags()).unwrap(), today);
        assert_eq!(fs::read_to_string(project.instructions()).unwrap(), claude_off);
        assert!(open_steps(&project).is_empty());
        clean(&project);
    }

    #[test]
    fn an_old_project_stays_off_after_the_update() {
        let project = scratch("measure-old");
        apply(&project, &[0]).unwrap();
        // The settings file of 0.1.54: the three settings, no field for measuring.
        write_file(&project.options_file(), "{\n  \"shortReports\": true,\n  \"triageName\": false,\n  \"autoApprove\": true\n}\n").unwrap();
        write_file(&project.triage_prompt(), &triage_prompt(project.options(), &project.reports_text())).unwrap();
        let files = [project.options_file(), project.plan_flags(), project.work_flags(), project.instructions(), project.triage_prompt(), project.local_settings(), project.settings()];
        let before: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();

        let options = project.options();
        assert!(!options.measure_before_plan && options.auto_approve && !options.triage_name, "the other settings stay");
        // The same file has no field for "Pause tasks" (ticket pause-tasks): it is off.
        assert!(!options.paused);
        assert!(plan_flags_current(&project), "the plan options of 0.1.54 are current");
        assert_eq!(read(&project.plan_flags()), plan_lines(&project, "--model\nfable\n--effort\nxhigh\n"));
        assert!(!project.section_body().contains("Measure before the plan"));
        let shown = plan(&project).unwrap();
        assert_eq!(serde_json::to_value(&shown.options).unwrap()["measureBeforePlan"], json!(false));
        assert_eq!(shown.measure_commands, "");
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));

        apply(&project, &[]).unwrap();
        let after: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        assert!(before == after, "Apply changed a file of the old project");
        assert!(!project.measure_commands_file().exists() && !project.tasks_ignore().exists() && !project.measure_dir().exists());
        // The plan prompt of the script has no word of measuring while the switch is off.
        assert!(WORKER_SCRIPT.contains("if (Measure-On) { $prompt += "));
        clean(&project);
    }

    #[test]
    fn a_measuring_command_outside_the_list_is_refused() {
        // A git repository: the script compares `git status` before and after a command.
        let project = git_scratch("measure-refuse");
        apply(&project, &[0]).unwrap();
        set_measure(&project, true);
        write_file(&project.measure_commands_file(), "# the commands of the scratch project\ncmd /c echo measured-one\necho made> made.txt\n").unwrap();
        apply(&project, &[]).unwrap();
        let fake = fake_claude(project.root.parent().unwrap());
        write_file(&project.reports.join("t-1.state"), "planning\n").unwrap();
        let log = |n: u32| project.measure_dir().join("t-1").join(format!("{n}.log"));

        // A number outside the list, a command text, a second argument, no argument: refused, nothing runs.
        for args in [&["measure", "t-1", "3"][..], &["measure", "t-1", "0"], &["measure", "t-1", "echo hacked"], &["measure", "t-1", "1", "2"], &["measure", "t-1"]] {
            let (code, out) = run_script(&project, &fake, "done", args);
            assert_eq!(code, 2, "{args:?}: {out}");
            assert!(out.contains("measure takes the number of a command of measure-commands.txt (1 to 2); nothing else runs"), "{args:?}: {out}");
        }
        assert!(!log(1).exists() && !project.measure_dir().join("lock").exists());

        // A listed command runs, and its output reaches the log and the planner.
        let (code, out) = run_script(&project, &fake, "done", &["measure", "t-1", "1"]);
        assert_eq!(code, 0, "{out}");
        assert!(out.contains("command 1 (cmd /c echo measured-one) ended with exit code 0") && out.contains("measured-one"), "{out}");
        assert!(read(&log(1)).contains("measured-one"));
        assert!(!project.measure_dir().join("t-1").join("changed.txt").exists(), "the command changed nothing");

        // A command that changes the working tree: the note for the task card.
        let (code, out) = run_script(&project, &fake, "done", &["measure", "t-1", "2"]);
        assert_eq!(code, 0, "{out}");
        assert!(out.contains("warning: command 2 changed files of the project outside .dispatch") && out.contains("?? made.txt"), "{out}");
        assert_eq!(read(&project.measure_dir().join("t-1").join("changed.txt")), "?? made.txt\n");
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!(task.measure_changed, ["?? made.txt"]);

        // Only a plan run measures, and only with the switch on.
        write_file(&project.reports.join("t-1.state"), "working\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["measure", "t-1", "1"]);
        assert!(code == 2 && out.contains("is not in its plan run"), "{out}");
        write_file(&project.reports.join("t-1.state"), "planning\n").unwrap();
        set_measure(&project, false);
        let (code, out) = run_script(&project, &fake, "done", &["measure", "t-1", "1"]);
        assert!(code == 2 && out.contains("Measure before the plan is off"), "{out}");

        // The plan verb with the switch on: the prompt names the measuring, the planner runs command
        // 1, and the plan has the section Measured. The plan verb first removes the old scratch folder.
        set_measure(&project, true);
        write_file(&project.briefs().join("t-1.md"), "brief\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");
        let calls = read(&fake.join("args.txt"));
        let start: Vec<String> = serde_json::from_str(calls.lines().rev().filter(|line| !line.starts_with("[\"agents\"")).nth(1).unwrap()).unwrap();
        assert!(start[0].ends_with("Then end your turn. Measure before the plan is on: first run the listed measuring commands as the section Background workers says, and write the section Measured."), "{start:?}");
        assert_eq!(last_call(&fake), ["(planner)", "measure", "t-1", "1", "0"]);
        let plan_text = read(&project.plans().join("t-1.md"));
        assert!(plan_text.contains("## Measured") && plan_text.contains("measured-one"), "{plan_text}");
        assert!(!project.measure_dir().join("t-1").join("changed.txt").exists(), "the plan verb removed the old scratch folder");
        // Off: the prompt is the prompt of 0.1.54.
        set_measure(&project, false);
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert!(last_call(&fake)[0].ends_with("Edit nothing. Then end your turn."), "{:?}", last_call(&fake));
        assert_eq!(read(&project.plans().join("t-1.md")), "plan\n");
        clean(&project);
    }

    #[test]
    fn measuring_runs_one_at_a_time_and_stops_a_long_command() {
        let project = scratch("measure-lock");
        apply(&project, &[0]).unwrap();
        set_measure(&project, true);
        let fake = fake_claude(project.root.parent().unwrap());
        for ticket in ["t-1", "t-2"] {
            write_file(&project.reports.join(format!("{ticket}.state")), "planning\n").unwrap();
        }
        let lock = project.measure_dir().join("lock");

        // Two measurings at once: the second waits until the first one ends.
        write_file(&project.measure_commands_file(), "# limit 30\nping -n 4 127.0.0.1\ncmd /c echo second\n").unwrap();
        let start = std::time::Instant::now();
        let (first, second) = std::thread::scope(|scope| {
            let first = scope.spawn(|| (run_script(&project, &fake, "done", &["measure", "t-1", "1"]), start.elapsed()));
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let second = scope.spawn(|| (run_script(&project, &fake, "done", &["measure", "t-2", "2"]), start.elapsed()));
            (first.join().unwrap(), second.join().unwrap())
        });
        assert_eq!(first.0 .0, 0, "{}", first.0 .1);
        assert_eq!(second.0 .0, 0, "{}", second.0 .1);
        assert!(second.1 > first.1, "the second measuring ended after the first one: {:?} {:?}", first.1, second.1);
        assert!(second.1.as_secs_f64() >= 3.0, "the second measuring waited for the lock: {:?}", second.1);
        assert!(!lock.exists(), "each measuring removed its lock");

        // A lock of a process that runs: refused after the limit, with the name of the other task.
        write_file(&project.measure_commands_file(), "# limit 2\nping -n 30 127.0.0.1\ncmd /c echo second\n").unwrap();
        write_file(&lock, &format!("{}\tt-other\t2026-11-12T22:00:00\n", std::process::id())).unwrap();
        let start = std::time::Instant::now();
        let (code, out) = run_script(&project, &fake, "done", &["measure", "t-1", "2"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("another measuring of this project runs (task t-other)"), "{out}");
        assert!(start.elapsed().as_secs_f64() >= 2.0, "it waited: {:?}", start.elapsed());
        assert!(lock.exists(), "the lock of the other task stays");

        // A lock whose process is gone is removed, and the command runs.
        let mut gone = Command::new("cmd").args(["/c", "exit"]).spawn().unwrap();
        gone.wait().unwrap();
        write_file(&lock, &format!("{}\tt-gone\t2026-11-12T22:00:00\n", gone.id())).unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["measure", "t-1", "2"]);
        assert_eq!(code, 0, "{out}");
        assert!(out.contains("second") && !lock.exists(), "{out}");

        // A command over the time limit is stopped with its process tree: exit code 124, log kept.
        let start = std::time::Instant::now();
        let (code, out) = run_script(&project, &fake, "done", &["measure", "t-1", "1"]);
        let took = start.elapsed();
        assert_eq!(code, 124, "{out}");
        assert!(took.as_secs_f64() < 20.0, "stopped at the limit, not after 30 pings: {took:?}");
        let log = read(&project.measure_dir().join("t-1").join("1.log"));
        assert!(log.contains("Pinging 127.0.0.1") || log.contains("127.0.0.1"), "{log}");
        assert!(log.contains("stopped after 2 s: the time limit of the measuring commands"), "{log}");
        assert!(out.contains("ended with exit code 124"), "{out}");
        assert!(!lock.exists());
        clean(&project);
    }

    /// The scratch projects of the proof script of ticket measure-before-plan. It runs only on
    /// request: the proof script sets MEASURE_PROOF_DIR and starts it with `--ignored`, then reads
    /// the files and writes the result. Project `on`: the switch on, one listed command, a plan run
    /// with the fake planner. Project `off`: Apply off, on, off again, with a copy of the first file.
    #[test]
    #[ignore]
    fn measure_proof_projects() {
        let Ok(dir) = std::env::var("MEASURE_PROOF_DIR") else { return };
        let dir = PathBuf::from(dir);
        let project = |name: &str| {
            let root = dir.join(name);
            fs::create_dir_all(&root).unwrap();
            Project { reports: root.join(TASKS_DIR), root, in_git: false }
        };
        let on = project("on");
        git_init(&on);
        write_file(&on.root.join("README.md"), "scratch project\n").unwrap();
        apply(&on, &[0]).unwrap();
        set_measure(&on, true);
        write_file(&on.measure_commands_file(), "cmd /c echo measured-by-the-proof\n").unwrap();
        apply(&on, &[]).unwrap();
        run_git(&on.root, &["add", "--all"]).unwrap();
        run_git(&on.root, &["commit", "-q", "-m", "scratch setup"]).unwrap();
        write_file(&on.briefs().join("t-1.md"), "# t-1: a scratch task\n").unwrap();
        let fake = fake_claude(&dir);
        let (code, out) = run_script(&on, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");

        let off = project("off");
        apply(&off, &[0]).unwrap();
        fs::copy(off.plan_flags(), dir.join("plan-flags.first.txt")).unwrap();
        set_measure(&off, true);
        write_file(&off.measure_commands_file(), "cmd /c echo x\n").unwrap();
        apply(&off, &[]).unwrap();
        fs::copy(off.plan_flags(), dir.join("plan-flags.on.txt")).unwrap();
        set_measure(&off, false);
        apply(&off, &[]).unwrap();
    }

    #[test]
    fn the_script_parses_and_drives_the_two_runs() {
        let project = scratch("script");
        apply(&project, &[]).unwrap();
        let fake = fake_claude(project.root.parent().unwrap());

        // The parse check of the working rules, before the first run.
        let check = format!(
            "$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('{}', [ref]$null, [ref]$e); $e.Count",
            project.script().display()
        );
        let parse = Command::new("powershell").args(["-NoProfile", "-Command", &check]).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&parse.stdout).trim(), "0", "{}", String::from_utf8_lossy(&parse.stderr));

        // approve before any plan run: refused, no plan file.
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("no plan at"), "{out}");

        // plan: refused without a brief; then the prompt first, the plan options after, and the
        // planner (the fake) writes the plan file the prompt names.
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(!project.reports.join("t-1.state").exists());
        write_file(&project.briefs().join("t-1.md"), "brief\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "planning\n");
        assert_eq!(read(&project.plans().join("t-1.md")), "plan\n", "the plan prompt names a path the planner can write");
        let start = last_call(&fake);
        assert!(start[0].starts_with("Plan ticket t-1. Read the brief "), "{start:?}");
        assert_eq!(&start[1..6], ["--bg", "--name", "t-1 [plan]", "--model", "fable"]);
        assert_eq!(start[start.len() - 3], "Read,Grep,Glob,Bash,Write");
        assert_eq!(start.last().unwrap(), &format!("Bash(git status*),Bash(git log *),Bash(git diff *),Write({}/plans/**)", project.rule_path()));
        // The session file names the session of the plan run (ticket task-tokens); claude printed bg-1.
        assert!(out.contains("bg-1"), "the script writes the output of claude on: {out}");
        assert_eq!(read(&project.session_file("t-1")), "plan sess-1\n");

        // approve: refused while the worker runs or waits at a prompt, then a new session on the work options.
        let (code, out) = run_script(&project, &fake, "working", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("still runs (working)"), "{out}");
        let (code, out) = run_script(&project, &fake, "blocked/waiting", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("(blocked)"), "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "planning\n");
        // A worker that ended its turn with a question is blocked without the status waiting: it is done.
        let (code, out) = run_script(&project, &fake, "blocked", &["status"]);
        assert_eq!(code, 0, "{out}");
        assert!(out.contains("t-1\tplanning\tdone"), "{out}");
        // A claude that fails leaves the state at planning, so the card of the task comes back.
        write_file(&fake.join("fail.txt"), "3").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 3, "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "planning\n");
        fs::remove_file(fake.join("fail.txt")).unwrap();
        assert_eq!(read(&project.session_file("t-1")), "plan sess-1\n", "a failed start adds no session");
        // The checks that the user chose at Approve (ticket task-checks) go into the prompt by name.
        write_file(&project.task_checks_file("t-1"), "unit\tcargo test --lib\nui \"e2e\"\tnpm run e2e\n").unwrap();
        // Approve starts the work run as a new session with its own id: the file gets its line.
        let (code, out) = run_script_env(&project, &fake, "done", &["approve", "t-1"], &[("FAKE_COPY", "sess-2")]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "working\n");
        assert_eq!(read(&project.session_file("t-1")), "plan sess-1\nwork sess-2\n");
        fs::remove_file(fake.join("copy.txt")).unwrap();
        let resume = last_call(&fake);
        assert!(resume[0].starts_with("Plan approved: "), "{resume:?}");
        // The prompt names the brief and the plan: the new session reads them, not the plan run (ticket work-fresh-session).
        assert!(resume[0].contains("This is the work run of ticket t-1. Read the brief ") && resume[0].contains("t-1.md and the plan first"), "{resume:?}");
        assert!(resume[0].ends_with(" The user chose these checks: unit, ui 'e2e'. Run each with the command of the section Checks chosen of the plan, as written there: Dispatch looks for that command in the commands of this run."), "{resume:?}");
        fs::remove_file(project.task_checks_file("t-1")).unwrap();
        // No resume: a new session with the name of the work run and the work options.
        assert!(!resume.iter().any(|arg| arg == "--resume"), "{resume:?}");
        assert_eq!(&resume[1..], ["--bg", "--name", "t-1 [work]", "--model", "opus", "--effort", "xhigh", "--permission-mode", "auto", "--tools", "default", "--disallowedTools", "AskUserQuestion,SendMessage"]);
        // claude runs in the project folder, whatever the folder of the caller is.
        assert_eq!(Path::new(read(&fake.join("cwd.txt")).trim()), project.root.as_path());

        // approve needs no worker of the ticket in the agent list (user decision 2 of work-fresh-session):
        // the plan session can be gone, and the plan file is the input of the new session.
        write_file(&project.reports.join("fake-name.txt"), "other [plan]").unwrap();
        write_file(&project.reports.join("t-1.state"), "planning
").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "working
");
        assert_eq!(&last_call(&fake)[1..4], ["--bg", "--name", "t-1 [work]"]);
        fs::remove_file(project.reports.join("fake-name.txt")).unwrap();

        // reply: the words of the user first; the state working picks the work options.
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "yes, go on"]);
        assert_eq!(code, 0, "{out}");
        let reply = last_call(&fake);
        assert_eq!(reply[0], "yes, go on");
        assert_eq!(&reply[1..7], ["--resume", "sess-1", "--bg", "--name", "t-1 [work]", "--model"]);
        // A resume of a session that the file has already adds nothing.
        assert_eq!(read(&project.session_file("t-1")), "plan sess-1\nwork sess-2\n");

        // A text with double quotes and line breaks reaches claude as one argument, quotes as
        // apostrophes and breaks as spaces, and the arguments after it stay whole.
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "say \"hi\" to \"them\"\r\nthen stop\nnow"]);
        assert_eq!(code, 0, "{out}");
        let reply = last_call(&fake);
        assert_eq!(reply[0], "say 'hi' to 'them' then stop now");
        assert_eq!(&reply[1..7], ["--resume", "sess-1", "--bg", "--name", "t-1 [work]", "--model"]);

        // status: the task with its own state and the state of its worker.
        let (code, out) = run_script(&project, &fake, "done", &["status"]);
        assert_eq!(code, 0, "{out}");
        assert!(out.contains("t-1\tworking\tdone"), "{out}");

        // A worker of this script has the run in its name; the script finds it like the bare id of an older one.
        write_file(&project.reports.join("fake-name.txt"), "t-1 [work]").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "go on"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(&last_call(&fake)[1..6], ["--resume", "sess-1", "--bg", "--name", "t-1 [work]"]);
        let (code, out) = run_script(&project, &fake, "done", &["status"]);
        assert!(code == 0 && out.contains("t-1\tworking\tdone"), "{out}");
        fs::remove_file(project.reports.join("fake-name.txt")).unwrap();

        // The model and the effort of the task (ticket ticket-form-optional-fields-on-a-new): the line of
        // the run in t-1.models goes over the options file; a reply of the work run keeps the work line.
        write_file(&project.models_file("t-1"), "plan fable high\nwork sonnet medium\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "go on"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(&last_call(&fake)[6..10], ["--model", "sonnet", "--effort", "medium"]);
        write_file(&project.reports.join("t-1.state"), "planning\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(
            &last_call(&fake)[1..],
            ["--bg", "--name", "t-1 [work]", "--model", "sonnet", "--effort", "medium", "--permission-mode", "auto", "--tools", "default", "--disallowedTools", "AskUserQuestion,SendMessage"]
        );
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(&last_call(&fake)[1..8], ["--bg", "--name", "t-1 [plan]", "--model", "fable", "--effort", "high"]);
        // `-` keeps the value of the options file.
        write_file(&project.models_file("t-1"), "work - max\n").unwrap();
        write_file(&project.reports.join("t-1.state"), "working\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "go on"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(&last_call(&fake)[6..10], ["--model", "opus", "--effort", "max"]);
        fs::remove_file(project.models_file("t-1")).unwrap();

        // stop: claude stop with the background id, state stopped; then no reply and no approve.
        let (code, out) = run_script(&project, &fake, "working", &["stop", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(last_call(&fake), ["stop", "bg-1"]);
        assert_eq!(read(&project.reports.join("t-1.state")), "stopped\n");
        let calls_before = read(&fake.join("args.txt"));
        let (code, out) = run_script(&project, &fake, "stopped", &["reply", "t-1", "go on"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("was stopped"), "{out}");
        let (code, out) = run_script(&project, &fake, "stopped", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("was stopped"), "{out}");
        assert_eq!(read(&fake.join("args.txt")), calls_before, "a stopped task starts no claude command");
        clean(&project);
    }

    /// Fills the reports folder of the old layout of a scratch project with a file of each kind,
    /// and the local settings with the rules of that layout. Gives the old folder.
    fn old_layout(project: &Project) -> PathBuf {
        let old = project.old_reports().unwrap();
        let text = old.to_string_lossy().replace('\\', "/");
        let rule = rule_form(&text).unwrap();
        write_file(&old.join("briefs").join("t-1.md"), "brief\n").unwrap();
        write_file(&old.join("briefs").join("t-2.md"), "brief two\n").unwrap();
        write_file(&old.join("plans").join("t-1.md"), "# Plan t-1: one\n").unwrap();
        write_file(&old.join("t-1.md"), "state: done\nneeds: nothing\n\ndone\n").unwrap();
        write_file(&old.join("t-1.state"), "working\n").unwrap();
        write_file(&old.join("t-2.state"), "planning\n").unwrap();
        write_file(&old.join("options.json"), "{ \"autoApprove\": true }\n").unwrap();
        write_file(&old.join(SCRIPT_NAME), "# the old script\n").unwrap();
        write_file(&old.join("worker-settings.json"), "{ \"env\": { \"CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS\": \"2\" } }\n").unwrap();
        write_file(
            &old.join("plan-flags.txt"),
            &format!("--model\nsonnet\n--effort\nhigh\n--permission-mode\ndontAsk\n--tools\nRead,Grep,Glob,Bash,Write\n--allowedTools\nBash(git status*),Bash(git log *),Bash(git diff *),Write({rule}/plans/**)\n"),
        )
        .unwrap();
        write_file(&old.join("work-flags.txt"), &format!("--model\nopus\n{WORK_FIXED}--settings\n{text}/worker-settings.json\n")).unwrap();
        let script = format!("powershell -ExecutionPolicy Bypass -File {text}/{SCRIPT_NAME}");
        let settings = json!({ "permissions": {
            "allow": [format!("Bash({script} *)"), "Bash(claude agents --json --all)", format!("Edit({rule}/**)"), format!("Read({rule}/**)"), "Bash(npm run build)"],
            "deny": [format!("Bash({script} approve *)")],
        }});
        write_file(&project.local_settings(), &settings.to_string()).unwrap();
        old
    }

    #[test]
    fn apply_moves_the_old_reports_folder_into_the_project() {
        // A project without `.dispatch`: the old folder is renamed.
        let project = scratch("move");
        let old = old_layout(&project);
        let before = count_files(&old);
        assert_eq!(before, 11);
        let first = plan(&project).unwrap();
        assert!(!first.steps[0].done && first.steps[0].detail.contains("11 files"), "{}", first.steps[0].detail);
        assert!(!first.steps[1].done && first.steps[1].detail.contains("remove deny: "), "{}", first.steps[1].detail);
        // One checked rule, so the step "Working rules" is done too.
        apply(&project, &[0]).unwrap();
        assert!(!old.exists(), "the old folder is gone");
        // Each file moved; Apply adds only `.gitattributes` (ticket tickets-in-git).
        assert_eq!(count_files(&project.reports), before + 1, "each file moved, one added");
        assert!(project.joins_tickets());
        assert_eq!(read(&project.briefs().join("t-2.md")), "brief two\n");
        assert_eq!(read(&project.reports.join("t-1.state")), "working\n");
        // The options files keep the choice of the user and get the paths of this folder, relative
        // to the project (ticket second-computer).
        assert_eq!(read(&project.plan_flags()), plan_lines(&project, "--model\nsonnet\n--effort\nhigh\n"));
        assert_eq!(read(&project.work_flags()), format!("--model\nopus\n{WORK_FIXED}--settings\n.dispatch/worker-settings.json\n"));
        assert!(project.options().auto_approve, "the settings of the project moved too");
        // The rules of the old folder are gone; the rule of the user stays.
        let settings = read_settings(&project.local_settings()).unwrap();
        let rules: Vec<&str> = ["allow", "deny"].iter().flat_map(|list| settings["permissions"][*list].as_array().unwrap()).map(|rule| rule.as_str().unwrap()).collect();
        assert!(!rules.iter().any(|rule| rule.contains("proj-reports")), "{rules:?}");
        assert!(rules.contains(&"Bash(npm run build)"), "{rules:?}");
        assert_eq!(settings["permissions"]["deny"].as_array().unwrap().len(), 1, "{rules:?}");
        let after = plan(&project).unwrap();
        let open: Vec<&str> = after.steps.iter().filter(|step| !step.done).map(|step| step.title).collect();
        assert!(open.is_empty(), "steps still to do: {open:?}");
        // The task list reads the moved tasks.
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(list.tasks.len(), 2);
        clean(&project);

        // A project whose `.dispatch` has the planned entries already: the files move one by one.
        let project = scratch("merge");
        write_file(&project.backlog_dir().join("e-1.md"), "sent: 1\norder: 1\n\nplanned\n").unwrap();
        let old = old_layout(&project);
        let before = count_files(&old);
        apply(&project, &[]).unwrap();
        assert!(!old.exists());
        assert_eq!(count_files(&project.reports), before + 2, "the moved files, the planned entry and `.gitattributes`");
        assert_eq!(read(&project.backlog_dir().join("e-1.md")), "sent: 1\norder: 1\n\nplanned\n");
        assert_eq!(read(&project.plans().join("t-1.md")), "# Plan t-1: one\n");
        clean(&project);

        // A file in both folders stops the move before anything moves.
        let project = scratch("conflict");
        let old = old_layout(&project);
        write_file(&project.briefs().join("t-1.md"), "the new brief\n").unwrap();
        let before = count_files(&old);
        let error = apply(&project, &[]).unwrap_err();
        assert!(error.contains("exist in both folders") && error.contains("t-1.md"), "{error}");
        assert_eq!(count_files(&old), before, "nothing moved");
        assert_eq!(read(&project.briefs().join("t-1.md")), "the new brief\n");
        clean(&project);
    }

    /// A git scratch project after Apply, with the fake `claude` next to it (ticket
    /// project-actions): the tests of actions.rs start their plan runs through the script with it.
    pub(crate) fn action_scratch(name: &str) -> (Project, PathBuf) {
        let project = git_scratch(name);
        apply(&project, &[]).unwrap();
        let fake = fake_claude(project.root.parent().unwrap());
        (project, fake)
    }

    /// Runs the script with the fake `claude` as `run_script` of the module does: exit code 0 gives
    /// the output, another code the error (ticket project-actions).
    pub(crate) fn fake_script(project: &Project, fake: &Path, args: &[&str]) -> Result<String, String> {
        let (code, text) = run_script(project, fake, "done", args);
        if code == 0 { Ok(text) } else { Err(text) }
    }

    /// Makes a git repository of a scratch project, with an identity and no global ignore file.
    pub(crate) fn git_scratch(name: &str) -> Project {
        let mut project = scratch(name);
        let root = project.root.clone();
        for args in [
            &["init", "-q"][..],
            &["config", "user.name", "Dispatch test"],
            &["config", "user.email", "test@example.invalid"],
            &["config", "commit.gpgsign", "false"],
            &["config", "core.excludesFile", "no-such-ignore-file"],
        ] {
            run_git(&root, args).unwrap();
        }
        project.in_git = true;
        project
    }

    #[test]
    fn the_task_read_commits_only_the_task_files() {
        let project = git_scratch("task-commit");
        let root = project.root.clone();
        let git = |args: &[&str]| run_git(&root, args).unwrap();
        let cwd = root.to_string_lossy().into_owned();
        apply(&project, &[]).unwrap();
        // A staged change of the user stays staged and out of the commits of Dispatch.
        write_file(&root.join("staged.txt"), "staged\n").unwrap();
        git(&["add", "staged.txt"]);
        write_file(&project.briefs().join("t-1.md"), "brief\n").unwrap();
        write_file(&project.reports.join("t-1.state"), "planning\n").unwrap();
        write_file(&project.plans().join("t-1.md"), "# Plan t-1: one\n").unwrap();
        // A planned entry of the old layout, committed before: it becomes a ticket, and the commit
        // of the task files takes the removal of the file and the tickets file.
        write_file(&project.backlog_dir().join("e-1.md"), "sent: 1\norder: 1\n\nplanned\n").unwrap();
        git(&["add", ".dispatch/backlog/e-1.md"]);
        git(&["commit", "-q", "-m", "old planned entry", "--", ".dispatch/backlog/e-1.md"]);

        let list = task_list(cwd.clone()).unwrap();
        assert!(list.dirty.iter().all(|line| !line.contains(".dispatch")), "{:?}", list.dirty);
        assert!(list.dirty.iter().any(|line| line == "A  staged.txt"), "{:?}", list.dirty);
        let subjects = git(&["log", "--format=%s"]);
        let subjects: Vec<&str> = subjects.lines().collect();
        // Newest first: the task files with the script, the options files and the tickets file.
        assert_eq!(subjects.len(), 2, "{subjects:?}");
        assert!(subjects[0].starts_with("Dispatch: ") && subjects[0].ends_with(" task files"), "{subjects:?}");
        let files = git(&["show", "--name-only", "--format=", "HEAD"]);
        let files: Vec<&str> = files.lines().filter(|line| !line.is_empty()).collect();
        assert!(files.iter().all(|file| file.starts_with(".dispatch/")), "{files:?}");
        assert_eq!(list.tickets.len(), 1);
        for file in [".dispatch/briefs/t-1.md", ".dispatch/t-1.state", ".dispatch/plans/t-1.md", ".dispatch/logs/t-1.md", ".dispatch/worker.ps1", ".dispatch/tickets.jsonl", ".dispatch/backlog/e-1.md"] {
            assert!(files.contains(&file), "{file} missing: {files:?}");
        }
        let status = git(&["status", "--porcelain"]);
        assert!(status.contains("A  staged.txt") && status.contains("?? CLAUDE.md") && !status.contains(".dispatch"), "{status}");

        // A work run without a report may commit itself: Dispatch waits.
        write_file(&project.reports.join("t-1.state"), "working\n").unwrap();
        task_list(cwd.clone()).unwrap();
        assert_eq!(git(&["log", "--format=%s"]).lines().count(), 2);
        assert!(git(&["status", "--porcelain", "--", ".dispatch"]).contains("t-1.state"));
        // The report is there: the next read writes the log again and commits (ticket task-log).
        write_file(&project.reports.join("t-1.md"), "state: done\nneeds: nothing\n\ndone\n").unwrap();
        task_list(cwd.clone()).unwrap();
        assert_eq!(git(&["log", "-1", "--format=%s"]).trim(), "Dispatch: 3 task files");
        assert!(git(&["show", "--name-only", "--format=", "HEAD"]).lines().any(|file| file == ".dispatch/logs/t-1.md"));
        assert_eq!(git(&["status", "--porcelain", "--", ".dispatch"]), "");
        // Nothing changed: no empty commit.
        assert_eq!(keep_tasks_committed(&project), Ok(0));

        // "Task files local only" on (ticket ignore-tasks): Apply takes the task files out of git in
        // one commit, and a new task file gets no commit at the next read.
        set_ignore(&project, true);
        apply(&project, &[]).unwrap();
        assert_eq!(git(&["log", "-1", "--format=%s"]).trim(), TASKS_LOCAL_MESSAGE);
        assert_eq!(git(&["ls-files", "--", ".dispatch"]), "");
        write_file(&project.briefs().join("t-2.md"), "brief two\n").unwrap();
        task_list(cwd.clone()).unwrap();
        assert_eq!(git(&["log", "-1", "--format=%s"]).trim(), TASKS_LOCAL_MESSAGE);
        assert_eq!(keep_tasks_committed(&project), Ok(0));
        assert_eq!(git(&["status", "--porcelain", "--", ".dispatch"]), "");
        assert!(git(&["status", "--porcelain"]).contains("A  staged.txt"));
        // Off again: Apply commits the task files again, the new brief among them.
        set_ignore(&project, false);
        apply(&project, &[]).unwrap();
        let subject = git(&["log", "-1", "--format=%s"]);
        assert!(subject.starts_with("Dispatch: ") && subject.trim().ends_with(" task files"), "{subject}");
        assert!(git(&["show", "--name-only", "--format=", "HEAD"]).lines().any(|file| file == ".dispatch/briefs/t-2.md"));
        assert_eq!(git(&["status", "--porcelain", "--", ".dispatch"]), "");
        assert!(git(&["status", "--porcelain"]).contains("A  staged.txt"));
        clean(&project);
    }

    #[test]
    fn approve_does_not_count_the_task_files_as_changes() {
        let project = git_scratch("approve-clean");
        let root = project.root.clone();
        let git = |args: &[&str]| run_git(&root, args).unwrap();
        apply(&project, &[]).unwrap();
        let fake = fake_claude(project.root.parent().unwrap());
        write_file(&project.briefs().join("t-1.md"), "brief\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");
        git(&["add", "--all"]);
        git(&["commit", "-q", "-m", "setup"]);
        // Triage writes a brief: a task file that is not committed.
        write_file(&project.briefs().join("t-2.md"), "brief two\n").unwrap();
        // A file of the user that the plan names refuses the approval, and the reason names only
        // that file (ticket leftover-files-block-tasks).
        write_file(&root.join("user.txt"), "mine\n").unwrap();
        let plan = project.plans().join("t-1.md");
        write_file(&plan, "# t-1: plan\n\n## Files to change\n- `user.txt`: the change.\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("files of this task") && out.contains("user.txt") && !out.contains(".dispatch"), "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "planning\n");
        // A plan that does not name it: the file holds nothing. "Task files local only" on (ticket
        // ignore-tasks): the new line of the root `.gitignore` is no file of the task either (user
        // decision 4), so the approval goes on before Commit to git.
        write_file(&plan, "# t-1: plan\n\n## Files to change\n- `src/other.rs`: the change.\n").unwrap();
        set_ignore(&project, true);
        apply(&project, &[]).unwrap();
        // Only task files and leftovers of the user are uncommitted: the approval goes on, and the prompt names the report.
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "working\n");
        let resume = last_call(&fake);
        assert!(resume[0].contains("Write the report to ") && resume[0].ends_with("t-1.md."), "{resume:?}");
        assert!(resume[0].contains("Commit only the files that this run changed") && resume[0].contains("never run git add -A"), "{resume:?}");
        let status = git(&["status", "--porcelain"]);
        assert!(status.contains("?? user.txt") && status.contains(".gitignore"), "the leftovers stay: {status}");
        // claude runs in the project folder: the parent of `.dispatch`.
        assert_eq!(Path::new(read(&fake.join("cwd.txt")).trim()), project.root.as_path());
        clean(&project);
    }

    #[test]
    fn the_ignore_switch_takes_the_task_folder_out_of_git_and_back() {
        let project = git_scratch("ignore-switch");
        let root = project.root.clone();
        let git = |args: &[&str]| run_git(&root, args).unwrap();
        write_file(&root.join(".gitignore"), "node_modules\n").unwrap();
        // One checked rule, so the step "Working rules" is done too.
        apply(&project, &[0]).unwrap();
        // Apply keeps the local settings on this computer with a pair of its own (ticket second-computer).
        let local = format!("{LOCAL_SETTINGS_MARK}\n{LOCAL_SETTINGS}\n");
        assert_eq!(read(&root.join(".gitignore")), format!("node_modules\n{local}"));
        write_file(&project.briefs().join("t-1.md"), "brief\n").unwrap();
        git(&["add", "--all"]);
        git(&["commit", "-q", "-m", "setup with task files"]);
        let tracked = git(&["ls-files", "--", ".dispatch"]).lines().count();
        assert!(tracked > 0);
        // A staged change of the user stays staged through both switches.
        write_file(&root.join("staged.txt"), "staged\n").unwrap();
        git(&["add", "staged.txt"]);
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));

        // On: the step is to do; Apply writes the pair, and one commit takes only the removals.
        set_ignore(&project, true);
        assert!(open_steps(&project).contains(&"Task files in git"), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        assert_eq!(read(&root.join(".gitignore")), format!("node_modules\n{local}{TASKS_IGNORE_MARK}\n{ROOT_TASKS_IGNORE}\n"));
        assert_eq!(git(&["ls-files", "--", ".dispatch"]), "");
        assert_eq!(git(&["log", "-1", "--format=%s"]).trim(), TASKS_LOCAL_MESSAGE);
        let removed = git(&["show", "--name-status", "--format=", "HEAD"]);
        let removed: Vec<&str> = removed.lines().filter(|line| !line.is_empty()).collect();
        assert_eq!(removed.len(), tracked, "{removed:?}");
        assert!(removed.iter().all(|line| line.starts_with("D\t.dispatch/")), "{removed:?}");
        assert!(project.briefs().join("t-1.md").is_file(), "the files stay on the disk");
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        assert!(read(&project.instructions()).contains("git ignores `"), "the section says so");
        // A task file written now stays out of git.
        write_file(&project.briefs().join("t-2.md"), "brief two\n").unwrap();
        assert_eq!(keep_tasks_committed(&project), Ok(0));
        assert_eq!(git(&["status", "--porcelain", "--", ".dispatch"]), "");
        let status = git(&["status", "--porcelain"]);
        assert!(status.contains("A  staged.txt") && status.contains(" M .gitignore"), "{status}");
        commit_setup(&project).unwrap();

        // Off: Apply removes only the pair and commits the task files again.
        set_ignore(&project, false);
        assert!(open_steps(&project).contains(&"Task files in git"), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        assert_eq!(read(&root.join(".gitignore")), format!("node_modules\n{local}"));
        assert_eq!(git(&["ls-files", "--", ".dispatch"]).lines().count(), tracked + 2, "the new brief and the settings file");
        let subject = git(&["log", "-1", "--format=%s"]);
        assert!(subject.starts_with("Dispatch: ") && subject.trim().ends_with(" task files"), "{subject}");
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        assert!(!read(&project.instructions()).contains("git ignores `"));
        assert!(git(&["status", "--porcelain"]).contains("A  staged.txt"));
        commit_setup(&project).unwrap();
        // The pair of the local settings keeps .gitignore a setup file.
        assert!(project.setup_files().contains(&".gitignore"));

        // A line that the user wrote by hand: off, the step is done, and Apply leaves the file.
        write_file(&root.join(".gitignore"), &format!("node_modules\n{local}.dispatch/\n")).unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        assert_eq!(read(&root.join(".gitignore")), format!("node_modules\n{local}.dispatch/\n"));
        clean(&project);
    }

    #[test]
    fn the_notes_switch_lets_the_notes_into_git_and_back() {
        let project = git_scratch("notes-switch");
        let root = project.root.clone();
        let git = |args: &[&str]| run_git(&root, args).unwrap();
        let ignored = |path: &str| git_ok(&root, &["check-ignore", "-q", "--no-index", path]);
        // The repository ignores the folder `.claude` by a line of the user.
        write_file(&root.join(".gitignore"), "node_modules\n.claude/\n").unwrap();
        apply(&project, &[0]).unwrap();
        // The line `.claude/` ignores the local settings already: Apply writes no pair of its own.
        assert_eq!(read(&root.join(".gitignore")), "node_modules\n.claude/\n");
        write_file(&root.join(".claude/memory.md"), "memory\n").unwrap();
        write_file(&root.join(".claude/state/x.json"), "{}\n").unwrap();
        git(&["add", "--all"]);
        git(&["commit", "-q", "-m", "setup"]);
        assert_eq!(git(&["ls-files", "--", ".claude"]), "");
        // Off and no block: the step is done, and Apply changes nothing.
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));

        // On: the step is to do; Apply writes the block after the line of the user.
        set_notes(&project, true);
        assert!(open_steps(&project).contains(&NOTES_STEP), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        let block = format!(
            "{NOTES_IGNORE_MARK}\n!.claude/\n.claude/*\n!.claude/memory.md\n!.claude/mistakes.md\n!.claude/agents-override.md\n!.claude/triage.md\n!.claude/settings.json\n"
        );
        assert_eq!(read(&root.join(".gitignore")), format!("node_modules\n.claude/\n{block}"));
        assert!(!ignored(".claude/memory.md") && !ignored(".claude/triage.md"));
        assert!(ignored(".claude/settings.local.json") && ignored(".claude/state/x.json"));
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));

        // Commit to git takes .gitignore and the notes, and not the local settings.
        commit_setup(&project).unwrap();
        let shown = git(&["show", "--name-only", "--format=", "HEAD"]);
        let mut committed: Vec<&str> = shown.lines().filter(|line| !line.is_empty()).collect();
        committed.sort_unstable();
        assert_eq!(committed, [".claude/memory.md", ".claude/settings.json", ".claude/triage.md", ".gitignore"]);

        // A later change of a note goes into the commit of Dispatch with the task files.
        write_file(&root.join(".claude/memory.md"), "memory two\n").unwrap();
        assert_eq!(keep_tasks_committed(&project), Ok(2), "the settings file of the switch and the note");
        assert_eq!(git(&["log", "-1", "--format=%s"]).trim(), "Dispatch: 1 task file and 1 note");
        let shown = git(&["show", "--name-only", "--format=", "HEAD"]);
        assert!(shown.lines().any(|line| line == ".claude/memory.md"), "{shown}");
        assert_eq!(git(&["status", "--porcelain"]), "");

        // A line `.claude/` that the user appends later wins again: the step is to do, and Apply
        // moves the block to the end, with no second block.
        let text = read(&root.join(".gitignore"));
        write_file(&root.join(".gitignore"), &format!("{text}.claude/\n")).unwrap();
        assert!(open_steps(&project).contains(&NOTES_STEP), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        assert_eq!(read(&root.join(".gitignore")), format!("node_modules\n.claude/\n.claude/\n{block}"));
        write_file(&root.join(".gitignore"), &format!("node_modules\n.claude/\n{block}")).unwrap();

        // Off: Apply removes only the block; the notes stay tracked.
        set_notes(&project, false);
        assert!(open_steps(&project).contains(&NOTES_STEP), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        assert_eq!(read(&root.join(".gitignore")), "node_modules\n.claude/\n");
        assert_eq!(git(&["ls-files", "--", ".claude/memory.md"]).trim(), ".claude/memory.md");
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        // HEAD has the block: Commit to git takes its removal.
        assert!(project.setup_files().contains(&".gitignore"));
        commit_setup(&project).unwrap();
        assert_eq!(git(&["show", "--name-only", "--format=", "HEAD"]).trim(), ".gitignore");
        clean(&project);
    }

    /// Runs git in a folder and says whether it exited with 0.
    fn git_ok(root: &Path, args: &[&str]) -> bool {
        run_git(root, args).is_ok()
    }

    /// A clone of a scratch project into a sibling folder with another name: the project on a
    /// second computer (ticket second-computer). It has the git identity of the scratch repositories.
    fn clone_of(project: &Project, name: &str) -> Project {
        let base = project.root.parent().unwrap();
        let target = base.join(name);
        run_git(base, &["clone", "-q", &project.root.to_string_lossy(), &target.to_string_lossy()]).unwrap();
        for args in [
            &["config", "user.name", "Dispatch test"][..],
            &["config", "user.email", "test@example.invalid"],
            &["config", "commit.gpgsign", "false"],
            &["config", "core.excludesFile", "no-such-ignore-file"],
        ] {
            run_git(&target, args).unwrap();
        }
        Project::find(&target.to_string_lossy()).unwrap()
    }

    #[test]
    fn second_computer_clone_is_set_up_without_a_change_of_a_tracked_file() {
        let project = git_scratch("second-computer");
        let git = |root: &Path, args: &[&str]| run_git(root, args).unwrap();
        // A project that committed its local settings: Apply takes them out of git in a commit of
        // their own, and the file stays on the disk.
        write_file(&project.local_settings(), "{ \"permissions\": { \"allow\": [\"Bash(npm run build)\"] } }\n").unwrap();
        git(&project.root, &["add", "--all"]);
        git(&project.root, &["commit", "-q", "-m", "local settings in git"]);
        apply(&project, &[0]).unwrap();
        assert_eq!(git(&project.root, &["log", "-1", "--format=%s"]).trim(), LOCAL_SETTINGS_MESSAGE);
        assert_eq!(git(&project.root, &["show", "--name-status", "--format=", "HEAD"]).trim(), format!("D\t{LOCAL_SETTINGS}"));
        assert!(read(&project.local_settings()).contains("Bash(npm run build)"), "the rule of the user stays on the disk");
        write_worker_flags(&project, &choice("fable", "xhigh"), &choice("opus", "xhigh"), "2").unwrap();
        // A project in use has a brief and a plan; git keeps no empty folder.
        write_file(&project.briefs().join("t-1.md"), "# t-1\n").unwrap();
        write_file(&project.plans().join("t-1.md"), "# Plan t-1: one\n").unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        git(&project.root, &["add", "--all"]);
        git(&project.root, &["commit", "-q", "-m", "setup and task files"]);
        // The local settings with the rules and the folders of this user stay here.
        assert_eq!(git(&project.root, &["ls-files", "--", LOCAL_SETTINGS]), "");
        assert!(project.local_settings().is_file());

        let clone = clone_of(&project, "elsewhere");
        assert_ne!(clone.root, project.root);
        assert!(!clone.local_settings().exists(), "the local settings did not travel");
        assert_eq!(open_steps(&clone), vec!["Allow rules"]);
        assert_eq!(clone.section(), project.section(), "the section has the same mark on both paths");
        apply(&clone, &[]).unwrap();
        assert_eq!(git(&clone.root, &["status", "--porcelain", "--untracked-files=all"]), "", "Apply changed no tracked file");
        let settings = read_settings(&clone.local_settings()).unwrap();
        assert_eq!(settings["permissions"]["additionalDirectories"], json!(clone.extra_directories()));
        assert!(open_steps(&clone).is_empty(), "{:?}", open_steps(&clone));
        assert_eq!(read_worker_flags(&clone).agents, "2", "the agent limit travels");
        clean(&project);
    }

    #[test]
    fn second_computer_clone_tasks() {
        let project = git_scratch("second-computer-tasks");
        let git = |root: &Path, args: &[&str]| run_git(root, args).unwrap();
        apply(&project, &[0]).unwrap();
        // Sessions of the other account: no transcript of them is on this computer.
        let unknown = |n: u32| format!("5ec0d000-0000-4000-8000-{n:012}");
        for (id, title) in [("t-done", "Done task"), ("t-plan", "Planning task"), ("t-work", "Working task")] {
            crate::core::tickets::open_in_progress(&project, id, title, title).unwrap();
            write_file(&project.briefs().join(format!("{id}.md")), &format!("# {id}: {title}\n")).unwrap();
        }
        write_file(&project.plans().join("t-done.md"), "# Plan t-done: done\n\n## Summary\nOne line.\n").unwrap();
        write_file(&project.reports.join("t-done.md"), "state: done\nneeds: nothing\nfiles: none\nplan: plans/t-done.md\n\n## What changed\nIt works.\n").unwrap();
        write_file(&project.reports.join("t-done.state"), "working\n").unwrap();
        write_file(&project.session_file("t-done"), &format!("plan {}\nwork {}\n", unknown(1), unknown(2))).unwrap();
        write_file(&project.log_file("t-done"), "# the log of the other computer\n").unwrap();
        write_file(&project.reports.join("t-plan.state"), "planning\n").unwrap();
        write_file(&project.session_file("t-plan"), &format!("plan {}\n", unknown(3))).unwrap();
        write_file(&project.plans().join("t-work.md"), "# Plan t-work: work\n\n## Summary\nTwo lines.\n").unwrap();
        write_file(&project.reports.join("t-work.state"), "working\n").unwrap();
        write_file(&project.session_file("t-work"), &format!("plan {}\nwork {}\n", unknown(4), unknown(5))).unwrap();
        // The read on the first computer commits the task files: the work run without a report has
        // no transcript here either, so it holds no commit.
        task_list(project.root.to_string_lossy().into_owned()).unwrap();
        git(&project.root, &["add", "--all"]);
        git(&project.root, &["commit", "-q", "-m", "setup"]);

        let clone = clone_of(&project, "elsewhere");
        let head = git(&clone.root, &["rev-parse", "HEAD"]);
        let log = read(&clone.log_file("t-done"));
        let list = task_list(clone.root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(list.tasks.len(), 3);
        assert_eq!(list.tickets.len(), 3);
        let task = |name: &str| list.tasks.iter().find(|task| task.name == name).unwrap();
        let done = task("t-done");
        assert!(done.plan.is_some() && done.report.is_some() && done.brief.is_some());
        assert_eq!(done.header.as_ref().unwrap().state, "done");
        assert!(done.unverified.is_empty(), "{:?}", done.unverified);
        assert!(task("t-plan").elsewhere && task("t-work").elsewhere);
        let away = Some("started on another computer; no worker of it runs here".to_string());
        assert_eq!(handoff_state(task("t-plan"), false, false), away);
        assert_eq!(handoff_state(task("t-work"), false, false), away);
        assert_eq!(read(&clone.log_file("t-done")), log, "the log of the other computer stays");
        assert_eq!(keep_tasks_committed(&clone), Ok(0));
        assert_eq!(git(&clone.root, &["rev-parse", "HEAD"]), head, "no new commit");
        assert_eq!(git(&clone.root, &["status", "--porcelain", "--untracked-files=all"]), "");
        clean(&project);
    }

    #[test]
    fn second_computer_clone_script() {
        let project = git_scratch("second-computer-script");
        let git = |root: &Path, args: &[&str]| run_git(root, args).unwrap();
        apply(&project, &[0]).unwrap();
        write_worker_flags(&project, &choice("", ""), &choice("", ""), "2").unwrap();
        write_file(&project.briefs().join("t-1.md"), "# t-1: one\n").unwrap();
        git(&project.root, &["add", "--all"]);
        git(&project.root, &["commit", "-q", "-m", "setup"]);

        let clone = clone_of(&project, "elsewhere");
        apply(&clone, &[]).unwrap();
        let fake = fake_claude(clone.root.parent().unwrap());
        let origin = project.root.to_string_lossy().into_owned();
        let (code, text) = run_script(&clone, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{text}");
        let call = last_call(&fake);
        assert!(call[0].contains(&clone.plans().join("t-1.md").to_string_lossy().into_owned()), "{call:?}");
        assert!(call.iter().any(|arg| arg.contains("Write(.dispatch/plans/**)")), "{call:?}");
        assert!(!call.iter().any(|arg| arg.contains(&origin)), "{call:?}");
        assert_eq!(read(&fake.join("cwd.txt")).to_lowercase(), clone.root.to_string_lossy().to_lowercase());

        let (code, text) = run_script(&clone, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{text}");
        let call = last_call(&fake);
        assert!(call[0].contains(&clone.reports.join("t-1.md").to_string_lossy().into_owned()), "{call:?}");
        let at = call.iter().position(|arg| arg == "--settings").unwrap();
        assert_eq!(call[at + 1], clone.worker_settings().to_string_lossy(), "{call:?}");
        assert!(!call.iter().any(|arg| arg.contains(&origin)), "{call:?}");
        assert_eq!(read(&fake.join("cwd.txt")).to_lowercase(), clone.root.to_string_lossy().to_lowercase());

        // A follow-up of a run of the other computer: no worker of that name runs here.
        write_file(&clone.reports.join("fake-name.txt"), "t-other").unwrap();
        let (code, text) = run_script(&clone, &fake, "done", &["reply", "t-1", "hello"]);
        assert_eq!(code, 2, "{text}");
        assert!(text.contains("another computer"), "{text}");
        clean(&project);
    }

    /// Turns "Task branches" on or off in the settings file, as the switch does.
    fn set_branches(project: &Project, on: bool) {
        let options = Options { task_branches: on, ..project.options() };
        write_file(&project.options_file(), &format!("{}\n", serde_json::to_string_pretty(&options).unwrap())).unwrap();
    }

    /// Turns "Task files local only" on or off in the settings file, as the switch does.
    fn set_ignore(project: &Project, on: bool) {
        let options = Options { ignore_tasks: on, ..project.options() };
        write_file(&project.options_file(), &format!("{}\n", serde_json::to_string_pretty(&options).unwrap())).unwrap();
    }

    /// Turns "Project notes in git" on or off in the settings file, as the switch does.
    fn set_notes(project: &Project, on: bool) {
        let options = Options { notes_in_git: on, ..project.options() };
        write_file(&project.options_file(), &format!("{}\n", serde_json::to_string_pretty(&options).unwrap())).unwrap();
    }

    /// Runs git in a scratch project and gives its output; a failure fails the test.
    fn git_out(project: &Project, args: &[&str]) -> String {
        run_git(&project.root, args).unwrap().trim().to_string()
    }

    /// A git scratch project with "Task branches" on, its setup committed, a fake worker that commits
    /// a file in its work run, and the name of the base branch.
    fn branch_project(name: &str) -> (Project, PathBuf, String) {
        let project = git_scratch(name);
        write_file(&project.root.join("README.md"), "scratch project\n").unwrap();
        apply(&project, &[0]).unwrap();
        set_branches(&project, true);
        apply(&project, &[]).unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "scratch setup"]);
        let fake = fake_claude(project.root.parent().unwrap());
        write_file(&fake.join("work.txt"), "the work of the task\n").unwrap();
        let base = current_branch(&project).unwrap();
        (project, fake, base)
    }

    /// The plan run and the work run of a scratch ticket through the script, with the fake worker.
    fn plan_and_approve(project: &Project, fake: &Path, ticket: &str) {
        write_file(&project.briefs().join(format!("{ticket}.md")), &format!("# {ticket}: a scratch task\n")).unwrap();
        write_file(&project.reports.join("fake-name.txt"), ticket).unwrap();
        let (code, out) = run_script(project, fake, "done", &["plan", ticket]);
        assert_eq!(code, 0, "{out}");
        let (code, out) = run_script(project, fake, "done", &["approve", ticket]);
        assert_eq!(code, 0, "{out}");
    }

    /// The worker writes its report: later than the state file, as a real work run does.
    fn write_report(project: &Project, ticket: &str) {
        std::thread::sleep(std::time::Duration::from_millis(30));
        write_file(&project.reports.join(format!("{ticket}.md")), "state: done\nneeds: nothing\nfiles: work.txt\nplan: p\n\nDid the work.\n").unwrap();
    }

    /// The branch of a ticket in a fresh task list of the project.
    fn listed_branch(project: &Project, ticket: &str) -> BranchInfo {
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        list.tasks.into_iter().find(|task| task.name == ticket).and_then(|task| task.branch).expect("the task has a branch")
    }

    /// The merge is not open and the checkout has no change of a tracked file outside `.dispatch` (the
    /// branch file of a merge waits for the next task read, which commits it).
    fn assert_no_merge_left(project: &Project) {
        assert!(git(&project.root, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]).is_none(), "a merge is still open");
        assert_eq!(git_out(project, &["status", "--porcelain", "--untracked-files=no", "--", ".", NOT_TASKS]), "");
    }

    #[test]
    fn the_script_and_the_options_are_the_same_in_the_two_branch_states() {
        let project = scratch("branch-states");
        apply(&project, &[0]).unwrap();
        let files = [project.script(), project.plan_flags(), project.work_flags(), project.triage_prompt(), project.local_settings(), project.instructions()];
        let first: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        assert!(!project.section_body().contains("Task branches"));
        assert_eq!(project.deny_rules().len(), 1);

        set_branches(&project, true);
        assert_eq!(open_steps(&project), vec!["Allow rules", "Section in CLAUDE.md", "Task branches"]);
        apply(&project, &[]).unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        assert!(project.section_body().contains("Task branches is on in this project"));
        assert!(project.deny_rules()[1].ends_with("worker.ps1 merge *)"), "{:?}", project.deny_rules());
        assert!(read(&project.local_settings()).contains("worker.ps1 merge *)"));
        assert!(project.ignores(MERGE_IGNORE));
        // The script and both options files do not change with the switch.
        for (at, file) in files.iter().enumerate().take(4) {
            assert!(fs::read(file).unwrap() == first[at], "{} changed with the switch on", file.display());
        }

        set_branches(&project, false);
        assert_eq!(open_steps(&project), vec!["Allow rules", "Section in CLAUDE.md"]);
        apply(&project, &[]).unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        for (at, file) in files.iter().enumerate() {
            assert!(fs::read(file).unwrap() == first[at], "{} is not the file of the first Apply", file.display());
        }
        clean(&project);
    }

    /// Sets the three switches of ticket simpler-process in the settings file, as the switches do.
    fn set_simpler(project: &Project, plain: bool, gate: bool, push: bool) {
        let options = Options { start_plain_plans: plain, checks_at_gate: gate, push_after_merge: push, ..project.options() };
        write_file(&project.options_file(), &format!("{}\n", serde_json::to_string_pretty(&options).unwrap())).unwrap();
    }

    #[test]
    fn an_old_settings_file_has_the_three_new_switches_off() {
        let project = scratch("simpler-old");
        apply(&project, &[0]).unwrap();
        // The settings file of 0.1.67: no field for the three switches of ticket simpler-process.
        write_file(&project.options_file(), "{\n  \"shortReports\": true,\n  \"triageName\": true,\n  \"autoApprove\": false,\n  \"measureBeforePlan\": false,\n  \"taskBranches\": false,\n  \"ignoreTasks\": false,\n  \"notesInGit\": false,\n  \"paused\": false\n}\n").unwrap();
        let files = [project.options_file(), project.plan_flags(), project.work_flags(), project.instructions(), project.triage_prompt(), project.local_settings(), project.settings(), project.script()];
        let before: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        let options = project.options();
        assert!(!options.start_plain_plans && !options.checks_at_gate && !options.push_after_merge);
        let shown = serde_json::to_value(&plan(&project).unwrap().options).unwrap();
        for field in ["startPlainPlans", "checksAtGate", "pushAfterMerge"] {
            assert_eq!(shown[field], json!(false), "{field}");
        }
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        assert!(!list.start_plain_plans && !list.push_after_merge);
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        let after: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        assert!(before == after, "Apply changed a file of the old project");
        clean(&project);
    }

    #[test]
    fn the_new_switches_change_only_their_line_of_the_section() {
        let project = scratch("simpler-section");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let files = [project.script(), project.plan_flags(), project.work_flags()];
        let first: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        // All off: the section of the version before (the same project without the switches).
        let before = project.section_body();
        set_simpler(&project, false, false, false);
        assert_eq!(project.section_body(), before);
        assert!(!before.contains("Start plans without decisions") && !before.contains("Checks at the gate") && !before.contains("Push after the merge"));

        // Start plans without decisions: one line after the line of Approve.
        set_simpler(&project, true, false, false);
        let body = project.section_body();
        assert!(body.contains(&format!("and hold no task (Dispatch commits the files of `{}/` itself).\n{}- The work run follows the plan.", project.reports_text(), plain_rule())), "{body}");
        assert_eq!(body.replacen(&plain_rule(), "", 1), before);
        assert!(open_steps(&project).contains(&"Section in CLAUDE.md"));

        // Checks at the gate and Push after the merge need task branches; the checks line needs a gate too.
        set_simpler(&project, false, true, true);
        assert_eq!(project.section_body(), before);
        set_branches(&project, true);
        set_simpler(&project, false, false, false);
        let with_branches = project.section_body();
        set_simpler(&project, false, true, false);
        assert_eq!(project.section_body(), with_branches, "no gate command: no checks line");
        set_merge_gate(cwd.clone(), "npm test\n".to_string()).unwrap();
        let gate_on = project.section_body();
        assert!(gate_on.contains(&format!("{}- When the plan run is done", gate_checks_rule(&project.reports_text()))), "{gate_on}");
        assert_eq!(gate_on.replacen(&gate_checks_rule(&project.reports_text()), "", 1), with_branches);

        set_simpler(&project, false, false, true);
        let push_on = project.section_body();
        assert!(push_on.contains(&format!("{}- A worker ends with a report", push_rule())), "{push_on}");
        assert_eq!(push_on.replacen(&push_rule(), "", 1), with_branches);

        // The script and the options files are the same text for each switch: the script reads options.json.
        set_simpler(&project, true, true, true);
        apply(&project, &[]).unwrap();
        for (at, file) in files.iter().enumerate() {
            assert!(fs::read(file).unwrap() == first[at], "{} changed with the switches", file.display());
        }
        clean(&project);
    }

    /// Sets "Tickets start their plan" (ticket simpler-process-tickets) in the settings file, as the switch does.
    fn set_tickets(project: &Project, on: bool) {
        let options = Options { tickets_start_plans: on, ..project.options() };
        write_file(&project.options_file(), &format!("{}\n", serde_json::to_string_pretty(&options).unwrap())).unwrap();
    }

    #[test]
    fn an_old_settings_file_has_tickets_start_plans_off() {
        let project = scratch("tickets-old");
        apply(&project, &[0]).unwrap();
        // The settings file of 0.1.67 with the three switches of ticket simpler-process: no field for this switch.
        write_file(&project.options_file(), "{\n  \"shortReports\": true,\n  \"triageName\": true,\n  \"autoApprove\": false,\n  \"measureBeforePlan\": false,\n  \"taskBranches\": false,\n  \"ignoreTasks\": false,\n  \"notesInGit\": false,\n  \"paused\": false,\n  \"startPlainPlans\": false,\n  \"checksAtGate\": false,\n  \"pushAfterMerge\": false\n}\n").unwrap();
        assert!(!project.options().tickets_start_plans);
        let shown = serde_json::to_value(&plan(&project).unwrap().options).unwrap();
        assert_eq!(shown["ticketsStartPlans"], json!(false));
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        assert!(!list.tickets_start_plans);
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        clean(&project);
    }

    #[test]
    fn tickets_start_plans_changes_only_its_lines() {
        let project = scratch("tickets-section");
        apply(&project, &[0]).unwrap();
        let reports = project.reports_text();
        let script = script_command(&reports);
        let files = [project.script(), project.plan_flags(), project.work_flags()];
        let first: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        // Off: the section and the role of the version before.
        let before = project.section_body();
        let role_before = triage_prompt(project.options(), &reports);
        set_tickets(&project, false);
        assert_eq!(project.section_body(), before);
        assert_eq!(triage_prompt(project.options(), &reports), role_before);
        assert!(!before.contains("Tickets start their plan") && !role_before.contains("Tickets start their plan"));
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));

        // On: one line after the line of the tickets board, one bullet after the bullet of the role.
        set_tickets(&project, true);
        let body = project.section_body();
        let rule = tickets_rule(&reports, &script);
        assert!(body.contains(&format!("triage and the workers do not edit it.\n{rule}- `{script} plan <ticket-id>` starts")), "{body}");
        assert_eq!(body.replacen(&rule, "", 1), before);
        let role = triage_prompt(project.options(), &reports);
        let at = role.find("Never run `").unwrap();
        let bullet_start = role[at..].find("\n- ").unwrap() + at + 1;
        let bullet_end = role[bullet_start..].find("\n- ").unwrap() + bullet_start + 1;
        let bullet = &role[bullet_start..bullet_end];
        assert!(bullet.starts_with("- Tickets start their plan is on in this project"), "{bullet}");
        assert!(bullet.contains("Dispatch wrote the brief from the ticket and started the plan run itself"), "{bullet}");
        assert_eq!(role.replacen(bullet, "", 1), role_before);
        assert_eq!(open_steps(&project), vec!["Section in CLAUDE.md", "Triage role"]);

        // The script and the options files are the same text with the switch on.
        apply(&project, &[]).unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        for (at, file) in files.iter().enumerate() {
            assert!(fs::read(file).unwrap() == first[at], "{} changed with the switch", file.display());
        }
        clean(&project);
    }

    /// The start of the script with the fake worker, as `ticket_plan` gives it to `ticket_plan_with`.
    fn fake_start(fake: &Path) -> impl Fn(&Project, &[&str]) -> Result<String, String> + '_ {
        move |project, args| {
            let (code, out) = run_script(project, fake, "done", args);
            if code == 0 { Ok(out) } else { Err(out) }
        }
    }

    /// The status of a ticket in a fresh task list of the project.
    fn ticket_status(project: &Project, id: &str) -> String {
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        list.tickets.into_iter().find(|ticket| ticket.id == id).map(|ticket| ticket.status).unwrap()
    }

    #[test]
    fn a_new_ticket_starts_its_plan_with_the_switch_on() {
        let project = scratch("tickets-start");
        apply(&project, &[0]).unwrap();
        set_tickets(&project, true);
        let fake = fake_claude(project.root.parent().unwrap());
        let cwd = project.root.to_string_lossy().into_owned();
        let ticket = crate::core::tickets::ticket_add(cwd, "\"C:/pics/a shot.png\" Make the board faster.\nIt stalls with 50 tickets.".to_string(), None, None, None).unwrap();
        write_file(&project.reports.join("fake-name.txt"), &format!("{} [plan]", ticket.id)).unwrap();
        ticket_plan_with(&project, &ticket.id, &fake_start(&fake)).unwrap();

        let call = last_call(&fake);
        assert!(call[0].starts_with(&format!("Plan ticket {}.", ticket.id)), "{call:?}");
        let brief = read(&project.briefs().join(format!("{}.md", ticket.id)));
        assert!(brief.starts_with(&format!("# {}: {}\n\nDispatch wrote this brief from ticket {} of the tickets board on ", ticket.id, ticket.title, ticket.id)), "{brief}");
        assert!(brief.contains("## The user's words\nMake the board faster.\nIt stalls with 50 tickets.\nC:/pics/a shot.png\n\n## Constraints\n"), "{brief}");
        assert!(brief.contains("## The command that proves the work\n"), "{brief}");
        assert_eq!(parse_brief(&brief), ticket.title, "the task read takes the title of the ticket");
        assert_eq!(read(&project.reports.join(format!("{}.state", ticket.id))), "planning\n");
        assert_eq!(ticket_status(&project, &ticket.id), crate::core::tickets::IN_PROGRESS);
        // A second start of the same ticket is refused: it is not in New, and its task exists.
        assert!(ticket_plan_with(&project, &ticket.id, &fake_start(&fake)).is_err());
        clean(&project);
    }

    #[test]
    fn ticket_plan_refuses_with_the_switch_off() {
        let project = scratch("tickets-off");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let ticket = crate::core::tickets::ticket_add(cwd, "Make the board faster".to_string(), None, None, None).unwrap();
        let started = std::cell::Cell::new(false);
        let start = |_: &Project, _: &[&str]| -> Result<String, String> {
            started.set(true);
            Ok(String::new())
        };
        let error = ticket_plan_with(&project, &ticket.id, &start).unwrap_err();
        assert!(error.contains("Tickets start their plan is off"), "{error}");
        assert!(!started.get(), "no call of the script");
        assert!(!project.briefs().join(format!("{}.md", ticket.id)).exists(), "no brief");
        assert_eq!(ticket_status(&project, &ticket.id), crate::core::tickets::NEW);
        clean(&project);
    }

    #[test]
    fn ticket_plan_refuses_a_ticket_that_is_not_new_or_has_a_task() {
        let project = scratch("tickets-refuse");
        apply(&project, &[0]).unwrap();
        set_tickets(&project, true);
        let cwd = project.root.to_string_lossy().into_owned();
        let started = std::cell::Cell::new(0);
        let start = |_: &Project, _: &[&str]| -> Result<String, String> {
            started.set(started.get() + 1);
            Ok(String::new())
        };
        // Backlog.
        let waiting = crate::core::tickets::ticket_add(cwd.clone(), "A later task".to_string(), None, None, None).unwrap();
        crate::core::tickets::ticket_move(cwd.clone(), waiting.id.clone(), "backlog".to_string(), Vec::new(), None).unwrap();
        assert!(ticket_plan_with(&project, &waiting.id, &start).unwrap_err().contains("not in New"));
        // In progress.
        crate::core::tickets::open_in_progress(&project, "t-running", "A running task", "A running task").unwrap();
        assert!(ticket_plan_with(&project, "t-running", &start).unwrap_err().contains("not in New"));
        // A New ticket whose id has a brief already: the brief stays as it is.
        let ticket = crate::core::tickets::ticket_add(cwd.clone(), "A task with a brief".to_string(), None, None, None).unwrap();
        let brief = project.briefs().join(format!("{}.md", ticket.id));
        write_file(&brief, "# by triage\n").unwrap();
        assert!(ticket_plan_with(&project, &ticket.id, &start).unwrap_err().contains("exists already"));
        assert_eq!(read(&brief), "# by triage\n");
        // A paused project and an unknown ticket.
        let other = crate::core::tickets::ticket_add(cwd.clone(), "One more task".to_string(), None, None, None).unwrap();
        set_paused(cwd, true).unwrap();
        assert!(ticket_plan_with(&project, &other.id, &start).unwrap_err().contains("paused"));
        set_paused(project.root.to_string_lossy().into_owned(), false).unwrap();
        assert!(ticket_plan_with(&project, "no-such-ticket", &start).is_err());
        assert_eq!(started.get(), 0, "no call of the script");
        assert!(!project.briefs().join(format!("{}.md", other.id)).exists());
        clean(&project);
    }

    /// Sets "No triage" (ticket no-triage-a-project-switch-no-triage-in) in the settings file, as the switch does.
    fn set_no_triage(project: &Project, on: bool) {
        let options = Options { no_triage: on, ..project.options() };
        write_file(&project.options_file(), &format!("{}\n", serde_json::to_string_pretty(&options).unwrap())).unwrap();
    }

    #[test]
    fn an_old_settings_file_has_no_triage_off() {
        let project = scratch("no-triage-old");
        apply(&project, &[0]).unwrap();
        // The settings file of 0.1.69: no field for this switch.
        write_file(&project.options_file(), "{\n  \"shortReports\": true,\n  \"triageName\": true,\n  \"autoApprove\": false,\n  \"measureBeforePlan\": false,\n  \"taskBranches\": false,\n  \"ignoreTasks\": false,\n  \"notesInGit\": false,\n  \"paused\": false,\n  \"startPlainPlans\": false,\n  \"checksAtGate\": false,\n  \"pushAfterMerge\": false,\n  \"ticketsStartPlans\": false\n}\n").unwrap();
        assert!(!project.options().no_triage);
        let shown = serde_json::to_value(&plan(&project).unwrap().options).unwrap();
        assert_eq!(shown["noTriage"], json!(false));
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        assert!(!list.no_triage);
        assert_eq!(serde_json::to_value(&list).unwrap()["noTriage"], json!(false));
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        clean(&project);
    }

    #[test]
    fn no_triage_changes_only_its_line() {
        let project = scratch("no-triage-section");
        apply(&project, &[0]).unwrap();
        let reports = project.reports_text();
        let script = script_command(&reports);
        let files = [project.script(), project.plan_flags(), project.work_flags()];
        let first: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        // Off: the section and the role of the version before.
        let before = project.section_body();
        let role_before = triage_prompt(project.options(), &reports);
        set_no_triage(&project, false);
        assert_eq!(project.section_body(), before);
        assert!(!before.contains("No triage"));
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));

        // On: one line after the line of the tickets board; the triage role stays the same.
        set_no_triage(&project, true);
        let body = project.section_body();
        let rule = no_triage_rule(&reports, &script);
        assert!(body.contains(&format!("triage and the workers do not edit it.\n{rule}- `{script} plan <ticket-id>` starts")), "{body}");
        assert_eq!(body.replacen(&rule, "", 1), before);
        assert_eq!(triage_prompt(project.options(), &reports), role_before);
        assert_eq!(open_steps(&project), vec!["Section in CLAUDE.md"]);
        // With "Tickets start their plan" on too, the line stands after its line.
        set_tickets(&project, true);
        let both = project.section_body();
        assert!(both.contains(&format!("{}{rule}- `{script} plan <ticket-id>` starts", tickets_rule(&reports, &script))), "{both}");
        set_tickets(&project, false);

        // Apply closes the step; the script and the options files are the same text with the switch on.
        apply(&project, &[]).unwrap();
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        for (at, file) in files.iter().enumerate() {
            assert!(fs::read(file).unwrap() == first[at], "{} changed with the switch", file.display());
        }
        clean(&project);
    }

    #[test]
    fn ticket_plan_runs_with_no_triage_alone() {
        let project = scratch("no-triage-start");
        apply(&project, &[0]).unwrap();
        set_no_triage(&project, true);
        assert!(!project.options().tickets_start_plans);
        let fake = fake_claude(project.root.parent().unwrap());
        let cwd = project.root.to_string_lossy().into_owned();
        // A question starts its plan too: the route is the choice of the page.
        let ticket = crate::core::tickets::ticket_add(cwd, "Why does the board stall?".to_string(), None, None, None).unwrap();
        write_file(&project.reports.join("fake-name.txt"), &format!("{} [plan]", ticket.id)).unwrap();
        ticket_plan_with(&project, &ticket.id, &fake_start(&fake)).unwrap();

        let call = last_call(&fake);
        assert!(call[0].starts_with(&format!("Plan ticket {}.", ticket.id)), "{call:?}");
        let brief = read(&project.briefs().join(format!("{}.md", ticket.id)));
        assert!(brief.contains(" (No triage).\n\n## The user's words\nWhy does the board stall?\n"), "{brief}");
        assert!(!brief.contains("triage chat did not see"), "{brief}");
        assert_eq!(ticket_status(&project, &ticket.id), crate::core::tickets::IN_PROGRESS);
        clean(&project);
    }

    #[test]
    fn project_root_gives_no_triage() {
        let project = scratch("no-triage-root");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        assert_eq!(serde_json::to_value(project_root(cwd.clone()).unwrap()).unwrap()["noTriage"], json!(false));
        set_no_triage(&project, true);
        assert_eq!(serde_json::to_value(project_root(cwd).unwrap()).unwrap()["noTriage"], json!(true));
        clean(&project);
    }

    #[test]
    fn a_failed_plan_start_leaves_no_brief() {
        let project = scratch("tickets-fail");
        apply(&project, &[0]).unwrap();
        set_tickets(&project, true);
        let fake = fake_claude(project.root.parent().unwrap());
        write_file(&fake.join("fail.txt"), "3").unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let ticket = crate::core::tickets::ticket_add(cwd, "Make the board faster".to_string(), None, None, None).unwrap();
        assert!(ticket_plan_with(&project, &ticket.id, &fake_start(&fake)).is_err());
        for path in [project.briefs().join(format!("{}.md", ticket.id)), project.reports.join(format!("{}.state", ticket.id)), project.session_file(&ticket.id)] {
            assert!(!path.exists(), "{} stays", path.display());
        }
        // The ticket stays in New, so it goes to triage; a second start works.
        assert_eq!(ticket_status(&project, &ticket.id), crate::core::tickets::NEW);
        fs::remove_file(fake.join("fail.txt")).unwrap();
        ticket_plan_with(&project, &ticket.id, &fake_start(&fake)).unwrap();
        assert!(project.briefs().join(format!("{}.md", ticket.id)).exists());
        clean(&project);
    }

    /// A ticket of one open line with the given extra keys, as the tickets file gives it.
    fn ticket_of(extra: Value) -> crate::core::tickets::Ticket {
        let mut line = json!({"op": "open", "id": "t-a", "ts": 0, "title": "Make it fast", "summary": "Make it fast", "status": "triage"});
        for (key, value) in extra.as_object().unwrap() {
            line[key] = value.clone();
        }
        crate::core::tickets::fold(&format!("{line}\n")).remove(0)
    }

    #[test]
    fn a_ticket_with_only_the_goal_gives_the_brief_of_before() {
        let brief = ticket_brief(&ticket_of(json!({})), 0, true, &[]);
        assert_eq!(
            brief,
            "# t-a: Make it fast\n\nDispatch wrote this brief from ticket t-a of the tickets board on 1970-01-01 00:00 UTC (No triage).\n\n## The user's words\nMake it fast\n\n## Constraints\nNone given in the ticket; CLAUDE.md and the project rules hold.\n\n## The command that proves the work\nNot given; the plan run names it under Acceptance.\n"
        );
        // Empty fields write nothing either.
        let empty = ticket_of(json!({"fields": {"why": " ", "done": "", "keep": "", "context": "", "see": "", "expect": ""}}));
        assert_eq!(ticket_brief(&empty, 0, true, &[]), brief);
    }

    #[test]
    fn each_filled_field_goes_into_its_place_of_the_brief() {
        let fields = json!({"why": "It stalls.", "done": "50 tickets scroll", "keep": "The tickets file", "context": "Since 0.1.60", "see": "A white board", "expect": "The list"});
        let brief = ticket_brief(&ticket_of(json!({ "type": "fix", "fields": fields })), 0, false, &[]);
        assert!(
            brief.contains("## The user's words\nMake it fast\n\n## Why\nIt stalls.\n\n## Context\nSince 0.1.60\n\n## What I see\nA white board\n\n## What I expect\nThe list\n\n## Constraints\n"),
            "{brief}"
        );
        assert!(brief.contains("## Constraints\nDo not change: The tickets file\nCLAUDE.md and the project rules hold.\n\n"), "{brief}");
        assert!(brief.ends_with("## The command that proves the work\nDone when: 50 tickets scroll\nThe plan run names the commands that show it under Acceptance.\n"), "{brief}");
        // The task read takes only the Goal as the user's words.
        assert_eq!(section_lines(&brief, "The user's words"), ["Make it fast"]);
        // One field alone: only its own section, the others as before.
        let why = ticket_brief(&ticket_of(json!({"fields": {"why": "It stalls."}})), 0, false, &[]);
        assert!(why.contains("Make it fast\n\n## Why\nIt stalls.\n\n## Constraints\nNone given in the ticket;"), "{why}");
        for heading in ["## Context", "## What I see", "## What I expect", "Do not change:", "Done when:"] {
            assert!(!why.contains(heading), "{heading} in {why}");
        }
    }

    #[test]
    fn each_level_gives_its_model_and_effort_to_the_plan_run() {
        let project = scratch("levels");
        apply(&project, &[0]).unwrap();
        set_tickets(&project, true);
        let fake = fake_claude(project.root.parent().unwrap());
        let cwd = project.root.to_string_lossy().into_owned();
        for (level, model, effort) in [("simple", "opus", "medium"), ("medium", "opus", "high"), ("hard", "fable", "high")] {
            let ticket = crate::core::tickets::ticket_add(cwd.clone(), format!("Task at {level}"), None, Some(level.to_string()), None).unwrap();
            ticket_plan_with(&project, &ticket.id, &fake_start(&fake)).unwrap();
            assert_eq!(read(&project.models_file(&ticket.id)), format!("plan {model} {effort}\n"), "{level}");
            let call = last_call(&fake);
            let at = call.iter().position(|arg| arg == "--model").unwrap();
            assert_eq!(&call[at..at + 4], ["--model", model, "--effort", effort], "{level}: {call:?}");
        }
        // Through triage: the file of the level before the ticket goes; another level replaces the line.
        let ticket = crate::core::tickets::ticket_add(cwd.clone(), "One for triage".to_string(), None, Some("hard".to_string()), None).unwrap();
        ticket_level_file(cwd.clone(), ticket.id.clone()).unwrap();
        assert_eq!(read(&project.models_file(&ticket.id)), "plan fable high\n");
        crate::core::tickets::ticket_update(cwd.clone(), ticket.id.clone(), None, None, None, None, Some("simple".to_string())).unwrap();
        ticket_level_file(cwd.clone(), ticket.id.clone()).unwrap();
        assert_eq!(read(&project.models_file(&ticket.id)), "plan opus medium\n");
        assert!(ticket_level_file(cwd, "no-such-ticket".to_string()).is_err());
        // A failed start removes the file with the brief.
        write_file(&fake.join("fail.txt"), "3").unwrap();
        let failed = crate::core::tickets::ticket_add(project.root.to_string_lossy().into_owned(), "A failing one".to_string(), None, Some("hard".to_string()), None).unwrap();
        assert!(ticket_plan_with(&project, &failed.id, &fake_start(&fake)).is_err());
        assert!(!project.models_file(&failed.id).exists());
        clean(&project);
    }

    #[test]
    fn an_old_ticket_plans_at_medium() {
        let project = scratch("old-level");
        apply(&project, &[0]).unwrap();
        set_tickets(&project, true);
        let fake = fake_claude(project.root.parent().unwrap());
        write_file(&project.tickets_file(), "{\"op\":\"open\",\"id\":\"t-old\",\"ts\":1,\"title\":\"Old one\",\"type\":\"feature\",\"summary\":\"Old one\",\"tags\":[],\"status\":\"triage\",\"order\":1}\n").unwrap();
        ticket_plan_with(&project, "t-old", &fake_start(&fake)).unwrap();
        assert_eq!(read(&project.models_file("t-old")), "plan opus high\n");
        let call = last_call(&fake);
        let at = call.iter().position(|arg| arg == "--model").unwrap();
        assert_eq!(&call[at..at + 4], ["--model", "opus", "--effort", "high"], "{call:?}");
        clean(&project);
    }

    #[test]
    fn the_recommended_work_choice_reaches_the_work_run_and_a_change_replaces_it() {
        let project = scratch("work-choice");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let choice = |name: &str| {
            let list = serde_json::to_value(task_list(cwd.clone()).unwrap()).unwrap();
            list["tasks"].as_array().unwrap().iter().find(|task| task["name"] == name).unwrap()["workChoice"].clone()
        };
        write_file(&project.plans().join("t-1.md"), "# t-1: one\n\n## Size (files)\n1\n\n## Work run\n- Model: `sonnet`\n- effort: medium\nA small change in one file.\n").unwrap();
        assert_eq!(choice("t-1"), json!({"model": "sonnet", "effort": "medium"}));
        // A plan without the section, or with a value that is no option, gives no advice.
        write_file(&project.plans().join("t-2.md"), "# t-2: two\n\n## Size (files)\n1\n").unwrap();
        assert_eq!(choice("t-2"), Value::Null);
        write_file(&project.plans().join("t-3.md"), "# t-3: three\n\n## Work run\nmodel: opus\neffort: huge\n").unwrap();
        assert_eq!(choice("t-3"), Value::Null);
        // The choice at Approve goes into the file next to the line of the plan run; a change replaces it.
        write_file(&project.models_file("t-1"), "plan opus high\n").unwrap();
        task_work(cwd.clone(), "t-1".into(), "sonnet".into(), "medium".into()).unwrap();
        assert_eq!(read(&project.models_file("t-1")), "plan opus high\nwork sonnet medium\n");
        task_work(cwd.clone(), "t-1".into(), "fable".into(), "max".into()).unwrap();
        assert_eq!(read(&project.models_file("t-1")), "plan opus high\nwork fable max\n");
        task_work(cwd.clone(), "t-1".into(), String::new(), "low".into()).unwrap();
        assert_eq!(read(&project.models_file("t-1")), "plan opus high\nwork - low\n");
        assert!(task_work(cwd.clone(), "t-1".into(), "opus".into(), "huge".into()).is_err());
        assert!(task_work(cwd.clone(), "t-1".into(), "op us".into(), "high".into()).is_err());
        assert!(task_work(cwd.clone(), "../t".into(), "opus".into(), "high".into()).is_err());
        // Empty values remove the line, and the file goes with its last line.
        task_work(cwd.clone(), "t-1".into(), String::new(), String::new()).unwrap();
        assert_eq!(read(&project.models_file("t-1")), "plan opus high\n");
        fs::remove_file(project.models_file("t-1")).unwrap();
        task_work(cwd.clone(), "t-1".into(), "opus".into(), "high".into()).unwrap();
        task_work(cwd, "t-1".into(), String::new(), String::new()).unwrap();
        assert!(!project.models_file("t-1").exists());
        clean(&project);
    }

    #[test]
    fn a_plan_without_decisions_is_plain() {
        let plain = |text: &str| plan_is_plain(text, parse_plan(text).1);
        assert!(plain("# t-1: plan\n\n## Goal\nA goal.\n\n## Decisions\nNone.\n\n## Do not touch\n- `src/a.ts`\n"));
        assert!(plain("## Decisions\n\n## Size (files)\n1\n"), "an empty section has no decision");
        assert!(plain("## Decisions\nNo decisions: the brief fixes every choice.\n"));
        assert!(!plain("## Decisions\n1. Which name?\n   - Default: A. Recommended: short.\n   - Other: B. Not recommended: long.\n"), "a numbered decision");
        assert!(!plain("## Decisions\nHOLD: the user names the file.\n"), "a HOLD line");
        assert!(!plain("## Decisions\n- none\n"), "a list item");
        assert!(!plain("## Decisions\n* none\n"), "a list item with a star");
        assert!(!plain("## Decisions\n### 1 The name\nA or B.\n"), "a subheading");
        assert!(!plain("## Decisions\n2) The name: A or B.\n"), "a number with a bracket");
        assert!(!plain("# t-1: plan\n\n## Goal\nA goal.\n"), "a plan without the heading");
        assert!(!plain("## User decisions\nNone.\n"), "another heading");
    }

    #[test]
    fn a_done_report_needs_no_run_for_checks_that_the_gate_runs() {
        let project = scratch("simpler-claims");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        set_checks(cwd.clone(), "net | node net.mjs
".to_string()).unwrap();
        write_file(&project.plans().join("t-1.md"), "# t-1: a plan

## Checks
- [x] net — the network
").unwrap();
        task_checks(cwd.clone(), "t-1".into(), vec!["net".into()]).unwrap();
        let looked_for = || checks_to_look_for(&project, &listed_task(&project, "t-1").checks);
        let net = vec![("net".to_string(), "node net.mjs".to_string())];
        assert_eq!(looked_for(), net, "without the switch the chosen check must run in the work run");
        set_branches(&project, true);
        set_simpler(&project, false, true, false);
        assert_eq!(looked_for(), net, "without a gate command the work run runs the checks");
        set_merge_gate(cwd.clone(), "node gate.mjs
".to_string()).unwrap();
        assert_eq!(looked_for(), Vec::new(), "the gate runs the chosen checks");
        set_branches(&project, false);
        assert_eq!(looked_for(), net, "without task branches there is no merge gate");
        clean(&project);
    }

    #[test]
    fn the_work_run_is_told_that_the_gate_runs_the_checks() {
        let (project, fake, _base) = branch_project("simpler-prompt");
        let cwd = project.root.to_string_lossy().into_owned();
        set_simpler(&project, false, true, false);
        let approve = |ticket: &str| {
            write_file(&project.briefs().join(format!("{ticket}.md")), &format!("# {ticket}: a scratch task\n")).unwrap();
            write_file(&project.reports.join("fake-name.txt"), ticket).unwrap();
            let (code, out) = run_script(&project, &fake, "done", &["plan", ticket]);
            assert_eq!(code, 0, "{out}");
            write_file(&project.task_checks_file(ticket), "unit\tcargo test --lib\n").unwrap();
            let (code, out) = run_script(&project, &fake, "done", &["approve", ticket]);
            assert_eq!(code, 0, "{out}");
            last_call(&fake)[0].clone()
        };
        // No gate command: the sentence of 0.1.67.
        let prompt = approve("t-1");
        assert!(prompt.contains(" The user chose these checks: unit. Run each with the command of the section Checks chosen of the plan, as written there: Dispatch looks for that command in the commands of this run."), "{prompt}");
        assert!(!prompt.contains("Checks at the gate"), "{prompt}");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        set_merge_gate(cwd, "cmd /c exit 0\n".to_string()).unwrap();
        let prompt = approve("t-2");
        assert!(prompt.contains(" The user chose these checks: unit. Checks at the gate is on: the gate command runs them once, at the merge, so this run does not run them and needs no Verification claim for them."), "{prompt}");
        assert!(!prompt.contains("Run each with the command"), "{prompt}");
        clean(&project);
    }

    /// A bare repository next to a branch project as its remote `origin`, with the base pushed and set
    /// as the upstream branch. Gives the folder of the bare repository.
    fn with_remote(project: &Project, base: &str) -> PathBuf {
        let bare = project.root.parent().unwrap().join("remote.git");
        run_git(project.root.parent().unwrap(), &["init", "-q", "--bare", &bare.to_string_lossy()]).unwrap();
        git_out(project, &["remote", "add", "origin", &bare.to_string_lossy()]);
        git_out(project, &["push", "-q", "-u", "origin", base]);
        bare
    }

    /// The commit of a branch in the bare remote.
    fn remote_head(bare: &Path, base: &str) -> String {
        run_git(bare, &["rev-parse", &format!("refs/heads/{base}")]).unwrap().trim().to_string()
    }

    /// The plan run, the work run and the report of t-1, and the switch back to the base.
    fn work_to_merge(project: &Project, fake: &Path) {
        plan_and_approve(project, fake, "t-1");
        write_report(project, "t-1");
        assert!(!listed_branch(project, "t-1").checked_out);
    }

    #[test]
    fn merge_pushes_the_base_to_its_upstream() {
        let (project, fake, base) = branch_project("simpler-push");
        let bare = with_remote(&project, &base);
        set_simpler(&project, false, false, true);
        work_to_merge(&project, &fake);
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string()).unwrap();
        let lines: Vec<&str> = merged.lines().collect();
        assert_eq!(lines.len(), 2, "{merged}");
        assert!(lines[0].starts_with(&format!("merged task/t-1 into {base}: ")), "{merged}");
        assert_eq!(lines[1], format!("pushed {base} to origin/{base}"));
        assert_eq!(remote_head(&bare, &base), git_out(&project, &["rev-parse", &base]), "the remote has the merge commit");
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", &base]), format!("Merge task/t-1 into {base} (t-1)"));
        let branch = listed_branch(&project, "t-1");
        assert!(branch.merge.starts_with("done ") && branch.push.starts_with(&format!("pushed origin/{base} ")), "{branch:?}");
        assert!(!project.merge_dir().join("lock").exists(), "the merge lock stayed");
        clean(&project);
    }

    #[test]
    fn a_refused_push_leaves_the_merge_on_this_computer() {
        let (project, fake, base) = branch_project("simpler-refused");
        let bare = with_remote(&project, &base);
        // Another computer pushed first: the push of the merge is no fast-forward.
        let clone = project.root.parent().unwrap().join("clone");
        run_git(project.root.parent().unwrap(), &["clone", "-q", &bare.to_string_lossy(), &clone.to_string_lossy()]).unwrap();
        write_file(&clone.join("other.txt"), "from the other computer\n").unwrap();
        run_git(&clone, &["add", "other.txt"]).unwrap();
        run_git(&clone, &["-c", "user.name=Other", "-c", "user.email=other@example.invalid", "commit", "-q", "-m", "other"]).unwrap();
        run_git(&clone, &["push", "-q", "origin", &base]).unwrap();
        let remote = remote_head(&bare, &base);
        set_simpler(&project, false, false, true);
        work_to_merge(&project, &fake);

        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string()).unwrap();
        let lines: Vec<&str> = merged.lines().collect();
        assert_eq!(lines.len(), 2, "{merged}");
        assert!(lines[0].starts_with("merged task/t-1"), "{merged}");
        assert!(lines[1].starts_with("push failed: ") && lines[1].ends_with(&format!("; {base} is merged on this computer only")), "{merged}");
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", &base]), format!("Merge task/t-1 into {base} (t-1)"), "the merge stays");
        assert_eq!(remote_head(&bare, &base), remote, "the remote did not move");
        let branch = listed_branch(&project, "t-1");
        assert!(branch.merge.starts_with("done ") && branch.push.starts_with("failed "), "{branch:?}");
        // The push names only the base and its upstream branch, never a force.
        let command = read(&project.merge_dir().join("t-1-push.cmd"));
        assert!(command.contains(&format!("git push \"origin\" \"refs/heads/{base}:refs/heads/{base}\"")), "{command}");
        for word in ["force", "--tags", "\"+", " -f"] {
            assert!(!command.contains(word), "{word} in {command}");
        }
        clean(&project);
    }

    #[test]
    fn no_upstream_means_no_push() {
        let (project, fake, base) = branch_project("simpler-no-upstream");
        set_simpler(&project, false, false, true);
        work_to_merge(&project, &fake);
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string()).unwrap();
        let lines: Vec<&str> = merged.lines().collect();
        assert_eq!(lines.len(), 2, "{merged}");
        assert_eq!(lines[1], format!("no push: {base} has no upstream branch"));
        assert_eq!(listed_branch(&project, "t-1").push, "no-upstream");
        assert!(!project.merge_dir().join("t-1-push.cmd").exists(), "git push ran");
        clean(&project);
    }

    #[test]
    fn the_merge_does_not_push_with_the_switch_off() {
        let (project, fake, base) = branch_project("simpler-push-off");
        let bare = with_remote(&project, &base);
        let remote = remote_head(&bare, &base);
        work_to_merge(&project, &fake);
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string()).unwrap();
        assert_eq!(merged.lines().count(), 1, "{merged}");
        assert_eq!(remote_head(&bare, &base), remote);
        assert!(!read(&project.branch_file("t-1")).contains("push:"));
        assert_eq!(listed_branch(&project, "t-1").push, "");
        clean(&project);
    }

    #[test]
    fn set_paused_flips_the_one_setting_and_keeps_the_others() {
        let project = scratch("paused");
        apply(&project, &[0]).unwrap();
        write_file(&project.options_file(), "{\n  \"shortReports\": false,\n  \"triageName\": true,\n  \"autoApprove\": true\n}\n").unwrap();
        let root = project.root.to_string_lossy().into_owned();
        assert!(!task_list(root.clone()).unwrap().paused, "a settings file without the field is not paused");
        let steps = open_steps(&project);

        assert!(set_paused(root.clone(), true).unwrap());
        let options = project.options();
        assert!(options.paused && options.auto_approve && !options.short_reports && options.triage_name, "the other settings stay");
        assert!(task_list(root.clone()).unwrap().paused, "the task list gives the state");
        assert_eq!(open_steps(&project), steps, "a pause changes no step of the setup");
        assert_eq!(serde_json::to_value(&plan(&project).unwrap().options).unwrap()["paused"], json!(true));

        assert!(!set_paused(root.clone(), false).unwrap());
        assert!(!project.options().paused && project.options().auto_approve);
        assert!(!task_list(root).unwrap().paused);
        clean(&project);
    }

    #[test]
    fn an_old_project_stays_off_after_the_branch_update() {
        let project = scratch("branch-old");
        apply(&project, &[0]).unwrap();
        // The settings file of 0.1.55: four settings, no field for task branches.
        write_file(&project.options_file(), "{\n  \"shortReports\": true,\n  \"triageName\": true,\n  \"autoApprove\": false,\n  \"measureBeforePlan\": false\n}\n").unwrap();
        let files = [project.options_file(), project.plan_flags(), project.work_flags(), project.instructions(), project.triage_prompt(), project.local_settings(), project.settings(), project.script()];
        let before: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();

        assert!(!project.options().task_branches);
        // The same file has no field for "Task files local only" (ticket ignore-tasks): it is off.
        assert!(!project.options().ignore_tasks);
        assert!(!project.options().paused);
        let shown = plan(&project).unwrap();
        assert_eq!(serde_json::to_value(&shown.options).unwrap()["taskBranches"], json!(false));
        assert_eq!(serde_json::to_value(&shown.options).unwrap()["ignoreTasks"], json!(false));
        assert!(shown.steps.iter().any(|step| step.title == "Task files in git" && step.done));
        // No field for "Project notes in git" either (ticket project-notes-in-git): off, and done.
        assert!(!project.options().notes_in_git);
        assert_eq!(serde_json::to_value(&shown.options).unwrap()["notesInGit"], json!(false));
        assert!(shown.steps.iter().any(|step| step.title == NOTES_STEP && step.done));
        assert_eq!(shown.merge_gate, "");
        assert!(open_steps(&project).is_empty(), "{:?}", open_steps(&project));
        apply(&project, &[]).unwrap();
        let after: Vec<Vec<u8>> = files.iter().map(|file| fs::read(file).unwrap()).collect();
        assert!(before == after, "Apply changed a file of the old project");
        assert!(!project.merge_gate_file().exists() && !project.tasks_ignore().exists() && !project.merge_dir().exists());
        assert!(!project.root_ignore().exists());
        clean(&project);
    }

    #[test]
    fn approve_makes_the_task_branch_and_the_task_read_returns_to_the_base() {
        let (project, fake, base) = branch_project("branch-flow");
        let base_head = git_out(&project, &["rev-parse", &base]);
        plan_and_approve(&project, &fake, "t-1");
        assert_eq!(read(&project.branch_file("t-1")), format!("branch: task/t-1\nbase: {base}\n"));
        // The worker ran on the task branch and committed there; the base did not move.
        assert_eq!(read(&fake.join("branches.txt")), "t-1 task/t-1\n");
        assert!(last_call(&fake)[0].contains("Task branches is on: the checkout is on the branch task/t-1"));
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", "task/t-1"]), "t-1 work");
        assert_eq!(git_out(&project, &["rev-parse", &base]), base_head);
        // The work run has no report yet: the checkout stays on the task branch.
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && branch.checked_out && branch.merge.is_empty() && branch.note.is_empty(), "{branch:?}");

        write_report(&project, "t-1");
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && !branch.checked_out && branch.note.is_empty(), "{branch:?}");
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", &base]), "Dispatch: task files of t-1");
        let tree = git_out(&project, &["ls-tree", "-r", "--name-only", &base, ".dispatch"]);
        for file in [".dispatch/t-1.md", ".dispatch/t-1.state", ".dispatch/t-1.branch", ".dispatch/plans/t-1.md", ".dispatch/briefs/t-1.md"] {
            assert!(tree.lines().any(|line| line == file), "{file} is not on the base: {tree}");
        }
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_none(), "the work is on the base before the merge");
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!(handoff_state(task, false, false).as_deref(), Some("done, its branch waits for Merge in the task card of Dispatch"));

        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string()).unwrap();
        assert!(merged.starts_with(&format!("merged task/t-1 into {base}: ")), "{merged}");
        let parents = git_out(&project, &["rev-list", "--parents", "-n", "1", &base]);
        assert_eq!(parents.split_whitespace().count(), 3, "the merge commit has two parents: {parents}");
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", &base]), format!("Merge task/t-1 into {base} (t-1)"));
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());
        assert!(git(&project.root, &["rev-parse", "--verify", "--quiet", "refs/heads/task/t-1"]).is_none(), "the branch was not deleted");
        let branch = listed_branch(&project, "t-1");
        assert!(branch.merge.starts_with("done ") && !branch.exists, "{branch:?}");
        assert_no_merge_left(&project);
        clean(&project);
    }

    #[test]
    fn a_merge_is_refused_when_the_gate_fails_and_merges_when_it_passes() {
        let (project, fake, base) = branch_project("branch-gate");
        let cwd = project.root.to_string_lossy().into_owned();
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        set_merge_gate(cwd.clone(), "cmd /c echo the gate runs & exit 1\n".to_string()).unwrap();
        let head = git_out(&project, &["rev-parse", &base]);

        let refused = task_merge(cwd.clone(), "t-1".to_string()).unwrap_err();
        assert!(refused.contains("the gate command failed with exit code 1, so nothing was merged") && refused.contains("the gate runs"), "{refused}");
        // The task files of the gate change are committed; the code of the base did not move.
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", &base]), "Dispatch: 1 task file");
        assert_eq!(git_out(&project, &["rev-parse", &format!("{base}~1")]), head);
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_none());
        assert!(project.merge_dir().join("t-1.log").is_file());
        assert!(!project.merge_dir().join("lock").exists(), "the merge lock stayed");
        assert_no_merge_left(&project);
        assert!(listed_branch(&project, "t-1").exists);

        // The gate gets the ticket and the path of its checks file (ticket task-checks).
        set_merge_gate(cwd.clone(), "# limit 60\necho %DISPATCH_TICKET%^|%DISPATCH_CHECKS%> .dispatch\\merge\\gate-env.txt\n".to_string()).unwrap();
        let merged = task_merge(cwd, "t-1".to_string()).unwrap();
        assert!(merged.starts_with("merged task/t-1"), "{merged}");
        let seen = read(&project.merge_dir().join("gate-env.txt"));
        assert_eq!(seen.trim(), format!("t-1|{}", project.task_checks_file("t-1").display()), "{seen}");
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());
        assert_no_merge_left(&project);
        clean(&project);
    }

    #[test]
    fn a_merge_is_refused_for_a_claude_session_a_dirty_checkout_and_a_conflict() {
        let (project, fake, base) = branch_project("branch-refuse");
        let cwd = project.root.to_string_lossy().into_owned();
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);

        // A Claude Code session (triage) may not merge, even past the deny rule.
        let (code, out) = run_script_env(&project, &fake, "done", &["merge", "t-1"], &[("CLAUDECODE", "1")]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("only the Merge button of Dispatch merges a task branch"), "{out}");

        // A file of the user that the branch changes (user decision 3 of leftover-files-block-tasks).
        write_file(&project.root.join("work-t-1.txt"), "a file of the user\n").unwrap();
        let refused = task_merge(cwd.clone(), "t-1".to_string()).unwrap_err();
        assert!(refused.contains("uncommitted changes in files that the branch changes") && refused.contains("work-t-1.txt"), "{refused}");
        fs::remove_file(project.root.join("work-t-1.txt")).unwrap();

        // The base got its own version of the file of the task: the merge does not apply.
        write_file(&project.root.join("work-t-1.txt"), "another text on the base\n").unwrap();
        git_out(&project, &["add", "work-t-1.txt"]);
        git_out(&project, &["commit", "-q", "-m", "base change"]);
        let head = git_out(&project, &["rev-parse", &base]);
        let refused = task_merge(cwd, "t-1".to_string()).unwrap_err();
        assert!(refused.contains("does not apply; nothing was merged") && refused.contains("work-t-1.txt"), "{refused}");
        assert_eq!(git_out(&project, &["rev-parse", &base]), head);
        assert_eq!(read(&project.root.join("work-t-1.txt")), "another text on the base\n");
        assert_no_merge_left(&project);
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && branch.merge.is_empty(), "{branch:?}");
        clean(&project);
    }

    #[test]
    fn leftover_plan_files_are_the_paths_of_files_to_change() {
        let plan = "# t-1: plan\n\n## Goal\n- `src/goal.ts` is no task file.\n\n## Files to change\n- `src/main.ts`, `waitReason`: the change.\n- src/tickets.ts, the bare form.\n- `src-tauri/src/core/`: a folder.\n- `WORKER_SCRIPT` verb `approve`, anchor `$dirty = @(& git`: no path.\n- .\\docs\\a.md: backslashes.\n- `src/main.ts` again.\n\n## Files read\n- `src/read.ts`: one fact.\n";
        assert_eq!(plan_files(plan), vec!["src/main.ts", "src/tickets.ts", "src-tauri/src/core/", "docs/a.md"]);
        assert!(plan_files("plan\n").is_empty());
    }

    #[test]
    fn leftover_lines_touch_task_files_folders_and_renames() {
        let lines: Vec<String> = [" M src/main.ts", "?? logs/2026-11-16_hudwidget.md", "R  old.ts -> src-tauri/src/core/new.rs", "?? newdir/", " M \"with space.md\"", " M SRC/Other.ts", " M .claude/memory/triage.md"]
            .iter()
            .map(|line| line.to_string())
            .collect();
        let files: Vec<String> = ["src/main.ts", "src-tauri/src/core/", "newdir/inner.txt", "with space.md", "src/other.ts"].iter().map(|file| file.to_string()).collect();
        let held = task_leftovers(&lines, &files);
        assert_eq!(held, vec![" M src/main.ts", "R  old.ts -> src-tauri/src/core/new.rs", "?? newdir/", " M \"with space.md\"", " M SRC/Other.ts"]);
        assert!(task_leftovers(&lines, &[]).is_empty());
        assert!(task_leftovers(&[], &files).is_empty());
    }

    #[test]
    fn a_leftover_outside_the_task_files_holds_no_approval_and_no_switch_back() {
        let (project, fake, base) = branch_project("leftover-outside");
        let cwd = project.root.to_string_lossy().into_owned();
        // Changes of other sessions: a tracked file and an untracked log.
        write_file(&project.root.join("README.md"), "changed by another session\n").unwrap();
        write_file(&project.root.join("user.txt"), "a log of another session\n").unwrap();
        plan_and_approve(&project, &fake, "t-1");
        assert_eq!(current_branch(&project).unwrap(), "task/t-1");
        write_report(&project, "t-1");
        let branch = listed_branch(&project, "t-1");
        assert!(!branch.checked_out && branch.note.is_empty(), "{branch:?}");
        assert_eq!(current_branch(&project).unwrap(), base);
        // The commit of the work run holds only its own file; the leftovers stay uncommitted.
        let range = format!("{base}..task/t-1");
        assert_eq!(git_out(&project, &["log", "--name-only", "--format=", &range, "--", ".", NOT_TASKS]), "work-t-1.txt");
        let status = git_out(&project, &["status", "--porcelain", "--", ".", NOT_TASKS]);
        assert!(status.contains("M README.md") && status.contains("?? user.txt"), "{status}");
        let list = task_list(cwd.clone()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert!(task.leftovers.is_empty() && list.dirty.len() == 2, "{:?} {:?}", task.leftovers, list.dirty);
        // A script of an older version refuses on any change: the task gets the whole list.
        let script = read(&project.script());
        write_file(&project.script(), &format!("{script}# an older version\n")).unwrap();
        let list = task_list(cwd.clone()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!(task.leftovers, list.dirty);
        write_file(&project.script(), &script).unwrap();
        // The merge goes on too, and the leftovers stay.
        let merged = task_merge(cwd, "t-1".to_string());
        assert!(merged.is_ok(), "{merged:?}");
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:user.txt")]).is_none());
        assert_eq!(read(&project.root.join("README.md")), "changed by another session\n");
        clean(&project);
    }

    #[test]
    fn a_leftover_in_a_task_file_holds_the_approval_and_the_switch_back() {
        let (project, fake, base) = branch_project("leftover-task");
        let cwd = project.root.to_string_lossy().into_owned();
        write_file(&project.briefs().join("t-1.md"), "# t-1: a scratch task\n").unwrap();
        write_file(&project.reports.join("fake-name.txt"), "t-1").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");
        write_file(&project.plans().join("t-1.md"), "# t-1: plan\n\n## Files to change\n- `README.md`: the change.\n").unwrap();
        // A change in a file of the task holds the approval, with the new text.
        write_file(&project.root.join("README.md"), "changed by another session\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("these changes in files of this task are not committed") && out.contains("README.md"), "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "planning\n");
        let list = task_list(cwd.clone()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!(task.leftovers, vec![" M README.md".to_string()]);
        git_out(&project, &["checkout", "--", "README.md"]);
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(&project).unwrap(), "task/t-1");
        // A change in a file of the task holds the switch back, and the note names the file.
        write_file(&project.root.join("README.md"), "changed by another session\n").unwrap();
        write_report(&project, "t-1");
        let branch = listed_branch(&project, "t-1");
        assert!(branch.checked_out && branch.note.contains("files of this task") && branch.note.contains("README.md"), "{branch:?}");
        assert_eq!(current_branch(&project).unwrap(), "task/t-1");
        git_out(&project, &["checkout", "--", "README.md"]);
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).unwrap(), base);
        clean(&project);
    }

    /// A ticket line of the tickets file that opens the ticket `id`.
    fn ticket_line(id: &str) -> String {
        format!("{{\"op\":\"open\",\"id\":\"{id}\",\"ts\":1,\"title\":\"Ticket {id}\",\"type\":\"feature\",\"summary\":\"\",\"tags\":[],\"status\":\"todo\",\"order\":1}}\n")
    }

    /// Adds a ticket line at the end of the tickets file.
    fn add_ticket(project: &Project, id: &str) {
        let text = fs::read_to_string(project.tickets_file()).unwrap_or_default();
        write_file(&project.tickets_file(), &format!("{text}{}", ticket_line(id))).unwrap();
    }

    #[test]
    fn approve_and_merge_do_not_count_a_changed_tickets_file() {
        let (project, fake, base) = branch_project("tickets-in-git");
        add_ticket(&project, "a");
        git_out(&project, &["add", "--", ".dispatch/tickets.jsonl"]);
        git_out(&project, &["commit", "-q", "-m", "first ticket"]);
        write_file(&project.briefs().join("t-1.md"), "# t-1: a scratch task\n").unwrap();
        write_file(&project.reports.join("fake-name.txt"), "t-1").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");

        // Approve: a changed tracked tickets file does not count, a changed file of the task does.
        add_ticket(&project, "b");
        write_file(&project.plans().join("t-1.md"), "# t-1: plan\n\n## Files to change\n- `README.md`: the change.\n").unwrap();
        write_file(&project.root.join("README.md"), "changed by the user\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("README.md") && !out.contains("tickets.jsonl"), "{out}");
        git_out(&project, &["checkout", "--", "README.md"]);
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).unwrap(), base);

        // Merge: the same rule, with a file that the branch changes.
        add_ticket(&project, "c");
        write_file(&project.root.join("work-t-1.txt"), "a file of the user\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["merge", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("work-t-1.txt") && !out.contains("tickets.jsonl"), "{out}");
        fs::remove_file(project.root.join("work-t-1.txt")).unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["merge", "t-1"]);
        assert_eq!(code, 0, "{out}");
        let log = git_out(&project, &["log", "--format=%s", "-3", &base]);
        assert!(log.contains("Dispatch: task files before the merge of t-1") && log.contains("Merge task/t-1"), "{log}");
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());

        // The tickets file has each line once, and git has it.
        let tickets = read(&project.tickets_file());
        assert_eq!(tickets, format!("{}{}{}", ticket_line("a"), ticket_line("b"), ticket_line("c")), "{tickets}");
        assert_eq!(git_out(&project, &["status", "--porcelain", "--", ".dispatch/tickets.jsonl"]), "");
        assert_no_merge_left(&project);
        clean(&project);
    }

    #[test]
    fn two_computers_keep_the_ticket_lines_of_both() {
        let project = git_scratch("tickets-union");
        apply(&project, &[0]).unwrap();
        assert!(read(&project.tasks_attributes()).lines().any(|line| line == TICKETS_UNION));
        add_ticket(&project, "first");
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "setup and the first ticket"]);
        let main = current_branch(&project).unwrap();

        // The other computer adds a ticket.
        git_out(&project, &["checkout", "-q", "-b", "other"]);
        add_ticket(&project, "b");
        git_out(&project, &["commit", "-q", "-am", "ticket b"]);

        // This computer adds a ticket too, then pulls.
        git_out(&project, &["checkout", "-q", &main]);
        add_ticket(&project, "a");
        git_out(&project, &["commit", "-q", "-am", "ticket a"]);
        git_out(&project, &["merge", "-q", "--no-edit", "other"]);

        let tickets = read(&project.tickets_file());
        for id in ["first", "a", "b"] {
            assert_eq!(tickets.matches(&ticket_line(id)).count(), 1, "{tickets}");
        }
        assert_eq!(tickets.lines().count(), 3, "{tickets}");
        assert_eq!(crate::core::tickets::fold(&tickets).len(), 3);
        clean(&project);
    }

    /// The hand-off line of a task in a fresh task list of the project.
    fn listed_handoff(project: &Project, ticket: &str) -> Option<String> {
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == ticket).unwrap();
        handoff_state(task, false, false)
    }

    #[test]
    fn a_branch_merged_outside_dispatch_counts_as_merged() {
        let (project, fake, base) = branch_project("branch-outside");
        let cwd = project.root.to_string_lossy().into_owned();
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        // Today's state: the branch waits for Merge.
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && !branch.checked_out && branch.merge.is_empty(), "{branch:?}");
        assert_eq!(listed_handoff(&project, "t-1").as_deref(), Some("done, its branch waits for Merge in the task card of Dispatch"));

        // The user merges the branch with git, outside Dispatch.
        git_out(&project, &["merge", "--no-ff", "-q", "-m", "merge by the user", "task/t-1"]);
        let head = git_out(&project, &["rev-parse", "--short", &base]);
        let branch = listed_branch(&project, "t-1");
        assert!(branch.merge.starts_with(&format!("outside {head} ")), "{branch:?}");
        assert!(!branch.exists, "{branch:?}");
        assert!(git(&project.root, &["rev-parse", "--verify", "--quiet", "refs/heads/task/t-1"]).is_some(), "Dispatch deleted the branch");
        assert_eq!(listed_handoff(&project, "t-1"), None);
        // The merge of Dispatch refuses a merged branch.
        let refused = task_merge(cwd.clone(), "t-1".to_string()).unwrap_err();
        assert!(refused.contains("is merged already: outside"), "{refused}");
        // The next task read commits the branch file.
        task_list(cwd.clone()).unwrap();
        assert_eq!(git_out(&project, &["status", "--porcelain"]), "");

        // A squash merge: the base has the changes but not the commits of the branch.
        write_file(&fake.join("work.txt"), "the work of the second task\n").unwrap();
        plan_and_approve(&project, &fake, "t-2");
        write_report(&project, "t-2");
        let branch = listed_branch(&project, "t-2");
        assert!(branch.exists && branch.merge.is_empty(), "{branch:?}");
        assert_eq!(listed_handoff(&project, "t-2").as_deref(), Some("done, its branch waits for Merge in the task card of Dispatch"));
        git_out(&project, &["merge", "--squash", "task/t-2"]);
        git_out(&project, &["commit", "-q", "-m", "squash by the user"]);
        let branch = listed_branch(&project, "t-2");
        assert!(branch.merge.starts_with("outside same-changes "), "{branch:?}");
        assert_eq!(listed_handoff(&project, "t-2"), None);
        clean(&project);
    }

    /// The task of the Starminer screenshot (ticket stale-report-loop).
    const GATERECORDS: &str = "t-20261114T163252000Z-f6580960";
    /// The report with the question of the Starminer card, as the worker wrote it at 17:10.
    const GATE_QUESTION: &str = "state: needs-decision\nneeds: decision\nfiles: none\nplan: p\n\n## Questions\n1. Run the gate on the merged code now, or stop here?\n   - Run the gate now\n   - Stop here; the branch stays as committed\n";
    /// The report of the work run after the answer "Stop here", at 18:03.
    const STOPPED_HERE: &str = "state: done\nneeds: nothing\nfiles: none\nplan: p\n\nStopped here as the user answered; the branch stays as committed.\n";

    /// Sets the modification time of a scratch file to 2026-11-14 <hour>:<minute> UTC.
    fn set_time(path: &Path, hour: u64, minute: u64) {
        // 2026-11-14T00:00:00Z in seconds since the Unix epoch.
        const DAY: u64 = 1_794_614_400;
        let time = std::time::UNIX_EPOCH + std::time::Duration::from_secs(DAY + hour * 3600 + minute * 60);
        assert_eq!(&crate::core::tickets::iso((DAY + hour * 3600 + minute * 60) * 1000)[..16], format!("2026-11-14T{hour:02}:{minute:02}"));
        fs::File::options().write(true).open(path).unwrap().set_modified(time).unwrap();
    }

    /// The blob of the report of a ticket on a branch.
    fn report_blob(project: &Project, rev: &str, ticket: &str) -> String {
        git_out(project, &["rev-parse", &format!("{rev}:{TASKS_DIR}/{ticket}.md")])
    }

    /// The task of a ticket in a fresh task list of the project.
    fn listed_task(project: &Project, ticket: &str) -> TaskInfo {
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        list.tasks.into_iter().find(|task| task.name == ticket).expect("the task is listed")
    }

    /// The state of Starminer at 18:14: the worker asked at 17:10 and the switch back put the question
    /// onto the base; after the answer the work run wrote done on the task branch; triage merged the
    /// branch by hand and kept the report of the base. The checkout is on the base. Gives the base.
    fn stale_base_after_a_merge_by_hand(project: &Project, fake: &Path, ticket: &str) -> String {
        plan_and_approve(project, fake, ticket);
        let report = project.reports.join(format!("{ticket}.md"));
        write_file(&report, GATE_QUESTION).unwrap();
        set_time(&report, 17, 10);
        set_time(&project.reports.join(format!("{ticket}.state")), 16, 33);
        // The task read switches back and brings the question onto the base.
        let branch = listed_branch(project, ticket);
        assert!(branch.exists && !branch.checked_out && branch.note.is_empty(), "{branch:?}");
        let base = branch.base;
        let name = format!("task/{ticket}");
        assert_eq!(report_blob(project, &base, ticket), report_blob(project, &name, ticket));
        assert_eq!(git_out(project, &["status", "--porcelain"]), "");
        // The work run after the answer writes done on the branch and commits it.
        git_out(project, &["checkout", "-q", &name]);
        write_file(&report, STOPPED_HERE).unwrap();
        set_time(&report, 18, 3);
        let path = format!("{TASKS_DIR}/{ticket}.md");
        git_out(project, &["add", "--", &path]);
        git_out(project, &["commit", "-q", "-m", &format!("{ticket} done")]);
        // Triage merges the branch by hand and keeps the report of the base.
        git_out(project, &["checkout", "-q", &base]);
        let _ = run_git(&project.root, &["merge", "--no-ff", "--no-commit", &name]);
        git_out(project, &["checkout", "HEAD", "--", &path]);
        git_out(project, &["commit", "-q", "-m", "merge by hand"]);
        assert!(read(&report).contains("state: needs-decision"));
        assert!(git_out(project, &["merge-base", "--is-ancestor", &name, &base]).is_empty());
        base
    }

    #[test]
    fn a_stale_report_on_the_base_gives_way_to_the_newer_report_of_the_branch() {
        let (project, fake, _) = branch_project("stale-report");
        let base = stale_base_after_a_merge_by_hand(&project, &fake, GATERECORDS);
        let name = format!("task/{GATERECORDS}");
        // One task read: the base takes the newer report of the branch, and the same read gives it.
        let task = listed_task(&project, GATERECORDS);
        let header = task.header.as_ref().expect("the report has a header");
        assert_eq!(header.state, "done", "the task read gave the old copy of the base");
        assert!(task.questions.is_empty(), "{:?}", task.questions);
        assert_eq!(report_blob(&project, &base, GATERECORDS), report_blob(&project, &name, GATERECORDS));
        let subjects = git_out(&project, &["log", "--format=%s", "-6", &base]);
        assert!(subjects.lines().any(|line| line == format!("Dispatch: report of {GATERECORDS} from {name}")), "{subjects}");
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        let branch = task.branch.as_ref().expect("the task has a branch");
        assert!(branch.merge.starts_with("outside "), "{branch:?}");
        assert!(handoff_state(&task, false, false).is_none_or(|state| !state.contains("asks a question")));
        // A second read finds nothing to copy.
        let head = git_out(&project, &["rev-parse", &base]);
        assert_eq!(listed_task(&project, GATERECORDS).header.map(|header| header.state).as_deref(), Some("done"));
        let after = git_out(&project, &["log", "--format=%s", &format!("{head}..{base}")]);
        assert!(!after.contains("Dispatch: report of"), "{after}");
        clean(&project);
    }

    #[test]
    fn two_task_reads_at_once_both_give_the_newer_report() {
        // The frontend reads a project from the focused pane and from the overview at the same time.
        for round in 0..3 {
            let (project, fake, _) = branch_project(&format!("stale-twice-{round}"));
            stale_base_after_a_merge_by_hand(&project, &fake, "t-1");
            let cwd = project.root.to_string_lossy().into_owned();
            let reads: Vec<_> = (0..2)
                .map(|_| {
                    let cwd = cwd.clone();
                    std::thread::spawn(move || {
                        let list = task_list(cwd).unwrap();
                        list.tasks.into_iter().find(|task| task.name == "t-1").and_then(|task| task.header).map(|header| header.state).unwrap_or_default()
                    })
                })
                .collect();
            let states: Vec<String> = reads.into_iter().map(|read| read.join().unwrap()).collect();
            assert_eq!(states, ["done", "done"], "round {round}: a read gave the old copy");
            clean(&project);
        }
    }

    #[test]
    fn the_poll_that_switches_back_already_returns_the_repaired_report() {
        let (project, fake, _) = branch_project("stale-return");
        let base = stale_base_after_a_merge_by_hand(&project, &fake, GATERECORDS);
        let name = format!("task/{GATERECORDS}");
        // A reply puts the checkout on the branch again; the worker ends its turn with its report,
        // later than the checkout (a file time from the checkout counts as no report).
        git_out(&project, &["checkout", "-q", &name]);
        let report = project.reports.join(format!("{GATERECORDS}.md"));
        write_file(&report, STOPPED_HERE).unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(2);
        fs::File::options().write(true).open(&report).unwrap().set_modified(later).unwrap();
        let first = listed_task(&project, GATERECORDS);
        assert_eq!(first.header.map(|header| header.state).as_deref(), Some("done"));
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()), "the read did not switch back");
        assert_eq!(report_blob(&project, &base, GATERECORDS), report_blob(&project, &name, GATERECORDS), "the switch back kept the old copy on the base");
        let next = listed_task(&project, GATERECORDS);
        assert_eq!(next.header.map(|header| header.state).as_deref(), Some("done"));
        assert!(next.questions.is_empty(), "{:?}", next.questions);
        clean(&project);
    }

    #[test]
    fn the_reply_writes_the_state_before_it_checks_out_the_branch() {
        let (project, fake, base) = branch_project("stale-reply");
        plan_and_approve(&project, &fake, "t-1");
        std::thread::sleep(std::time::Duration::from_millis(30));
        write_file(&project.reports.join("t-1.md"), GATE_QUESTION).unwrap();
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        // A later return (after an answer) copies only the report: the reply wrote the state with the
        // same text, so git copies no state file and the report on the base is the newer file.
        set_time(&project.reports.join("t-1.md"), 17, 10);
        set_time(&project.reports.join("t-1.state"), 16, 33);
        write_file(&fake.join("watch.txt"), "t-1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "Answer to question 1: Stop here; the branch stays as committed"]);
        assert_eq!(code, 0, "{out}");
        let starts = read(&fake.join("starts.txt"));
        let start: serde_json::Value = serde_json::from_str(starts.lines().last().unwrap()).unwrap();
        assert_eq!(start["branch"], json!("task/t-1"), "{start}");
        // At the start of Claude Code the state is newer than the report: a poll now keeps the branch.
        assert!(start["state"].as_f64().unwrap() > start["report"].as_f64().unwrap(), "the state was older than the report at the start: {start}");
        let branch = listed_branch(&project, "t-1");
        assert!(branch.checked_out, "{branch:?}");
        clean(&project);
    }

    /// A newer report on the base than on the task branch (ticket branch-switch-on-reply): the worker
    /// asked, the switch back put the question onto the base, and a newer report came onto the base
    /// after it. Gives the base, the newer report text and its blob.
    fn newer_report_on_the_base(project: &Project, fake: &Path) -> (String, String) {
        plan_and_approve(project, fake, "t-1");
        let report = project.reports.join("t-1.md");
        write_file(&report, GATE_QUESTION).unwrap();
        set_time(&report, 17, 10);
        set_time(&project.reports.join("t-1.state"), 16, 33);
        let branch = listed_branch(project, "t-1");
        assert!(!branch.checked_out && branch.note.is_empty(), "{branch:?}");
        let base = branch.base;
        assert_eq!(current_branch(project).as_deref(), Some(base.as_str()));
        // `report_from_branch` compares commit seconds.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        write_file(&report, &format!("{GATE_QUESTION}\nA newer copy, written on the base.\n")).unwrap();
        let path = format!("{TASKS_DIR}/t-1.md");
        git_out(project, &["add", "--", &path]);
        git_out(project, &["commit", "-q", "-m", "a newer report on the base"]);
        let newer = report_blob(project, &base, "t-1");
        assert_ne!(newer, report_blob(project, "task/t-1", "t-1"));
        (base, newer)
    }

    /// The count of the commits "Dispatch: task files of t-1" on a branch.
    fn task_file_commits(project: &Project, rev: &str) -> usize {
        git_out(project, &["log", "--format=%s", rev]).lines().filter(|line| *line == "Dispatch: task files of t-1").count()
    }

    #[test]
    fn a_reply_checkout_that_rewrites_the_report_does_not_switch_back() {
        let (project, fake, _) = branch_project("reply-checkout");
        let (base, newer) = newer_report_on_the_base(&project, &fake);
        let commits = task_file_commits(&project, &base);
        // The reply writes the state, then checks out the task branch: git writes its older report.
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "Answer to question 1: Stop here; the branch stays as committed"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        let branch = listed_branch(&project, "t-1");
        assert!(branch.checked_out, "the read switched back after the checkout of the reply: {branch:?}");
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        assert_eq!(report_blob(&project, &base, "t-1"), newer, "the base lost its newer report");
        assert_eq!(task_file_commits(&project, &base), commits, "the read committed task files onto the base");
        // The worker then ends with its report: the read switches back and gives it.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let report = project.reports.join("t-1.md");
        write_file(&report, STOPPED_HERE).unwrap();
        let later = std::time::SystemTime::now() + std::time::Duration::from_secs(2);
        fs::File::options().write(true).open(&report).unwrap().set_modified(later).unwrap();
        let task = listed_task(&project, "t-1");
        assert_eq!(task.header.map(|header| header.state).as_deref(), Some("done"));
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()), "the read did not switch back after the report");
        assert_eq!(report_blob(&project, &base, "t-1"), report_blob(&project, "task/t-1", "t-1"));
        clean(&project);
    }

    #[test]
    fn a_return_keeps_the_newer_report_of_the_base() {
        let (project, fake, _) = branch_project("return-keeps");
        let (base, newer) = newer_report_on_the_base(&project, &fake);
        git_out(&project, &["checkout", "-q", "task/t-1"]);
        write_file(&project.reports.join("t-1.state"), "stopped\n").unwrap();
        let branch = listed_branch(&project, "t-1");
        assert!(!branch.checked_out, "{branch:?}");
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        assert_eq!(report_blob(&project, &base, "t-1"), newer, "the switch back put the older report of the branch onto the base");
        clean(&project);
    }

    /// Sets what the worker check of a scratch project gives (ticket branch-switch-on-reply).
    fn set_work_run_runs(project: &Project, runs: bool) {
        work_run_override().lock().unwrap().insert(project.root.clone(), runs);
    }

    #[test]
    fn no_switch_back_while_the_worker_runs() {
        let (project, fake, base) = branch_project("worker-runs");
        plan_and_approve(&project, &fake, "t-1");
        // The worker writes its report early and still works.
        write_report(&project, "t-1");
        set_work_run_runs(&project, true);
        assert!(listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"), "the read switched back while the worker ran");
        // The work run ends: the next read switches back.
        set_work_run_runs(&project, false);
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        clean(&project);
    }

    #[test]
    fn the_worker_list_tells_whether_the_work_run_runs() {
        let root = Path::new(r"D:\Projects\Starminer");
        let list = |workers: Value| worker_runs_in(&workers.to_string(), root, "t-1");
        let one = |name: &str, state: &str, status: Option<&str>, cwd: Option<&str>| {
            let mut worker = json!({ "id": "bg-1", "name": name, "state": state, "startedAt": 5 });
            if let Some(status) = status {
                worker["status"] = json!(status);
            }
            if let Some(cwd) = cwd {
                worker["cwd"] = json!(cwd);
            }
            worker
        };
        let here = Some("d:/projects/starminer/");
        assert_eq!(list(json!([one("t-1 [work]", "working", None, here)])), Some(true));
        assert_eq!(list(json!([one("t-1 [work]", "blocked", Some("waiting"), Some(r"D:\Projects\Starminer"))])), Some(true));
        assert_eq!(list(json!([one("t-1 [work]", "blocked", Some("idle"), here)])), Some(false));
        assert_eq!(list(json!([one("t-1 [work]", "done", None, here)])), Some(false));
        assert_eq!(list(json!([one("t-1", "working", None, None)])), Some(true), "a worker of an older script without a folder");
        assert_eq!(list(json!([one("t-1 [work]", "working", None, Some(r"D:\Projects\Other"))])), Some(false), "another project");
        assert_eq!(list(json!([one("t-1 [plan]", "working", None, here)])), Some(false), "the plan run only");
        assert_eq!(list(json!([one("t-12 [work]", "working", None, here)])), Some(false), "another ticket");
        // The newest work run counts.
        let mut old = one("t-1 [work]", "working", None, here);
        old["startedAt"] = json!(1);
        assert_eq!(list(json!([one("t-1 [work]", "done", None, here), old])), Some(false));
        assert_eq!(list(json!([])), Some(false));
        assert_eq!(worker_runs_in("not json", root, "t-1"), None);
    }

    /// The two new files that the work run of screen 1 wrote and did not commit (ticket
    /// task-branches-blocked-work), in the order of git.
    const SCREEN_ONE_FILES: [&str; 2] = [".claude/memory/ui.md", "scripts/editor/dump_hud_widget.py"];

    /// The plan run and the work run of t-1 with a plan whose Files to change names the files of
    /// screen 1. The checkout is then on task/t-1.
    fn approve_with_new_files(project: &Project, fake: &Path) {
        write_file(&project.briefs().join("t-1.md"), "# t-1: a scratch task\n").unwrap();
        write_file(&project.reports.join("fake-name.txt"), "t-1").unwrap();
        let (code, out) = run_script(project, fake, "done", &["plan", "t-1"]);
        assert_eq!(code, 0, "{out}");
        let plan = format!("# t-1: plan\n\n## Files to change\n- `{}`: the notes.\n- `{}`: the dump script.\n", SCREEN_ONE_FILES[0], SCREEN_ONE_FILES[1]);
        write_file(&project.plans().join("t-1.md"), &plan).unwrap();
        let (code, out) = run_script(project, fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(project).as_deref(), Some("task/t-1"));
    }

    /// The work run writes the files of screen 1, commits nothing, and asks its question later.
    fn new_files_then_question(project: &Project) {
        for file in SCREEN_ONE_FILES {
            write_file(&project.root.join(file), "written by the work run\n").unwrap();
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
        write_file(&project.reports.join("t-1.md"), GATE_QUESTION).unwrap();
    }

    /// The files outside `.dispatch` of the last commit of a branch.
    fn last_commit_files(project: &Project, rev: &str) -> Vec<String> {
        git_out(project, &["show", "--name-only", "--format=", rev, "--", ".", NOT_TASKS]).lines().map(str::to_string).collect()
    }

    /// The worker asks, and the read switches back to the base; then the fix of another task
    /// reaches the base with `file` and `text`. Gives the base.
    fn question_then_fix_on_the_base(project: &Project, fake: &Path, file: &str, text: &str) -> String {
        plan_and_approve(project, fake, "t-1");
        std::thread::sleep(std::time::Duration::from_millis(30));
        write_file(&project.reports.join("t-1.md"), GATE_QUESTION).unwrap();
        let branch = listed_branch(project, "t-1");
        assert!(!branch.checked_out && branch.note.is_empty(), "{branch:?}");
        let base = branch.base;
        assert_eq!(current_branch(project).as_deref(), Some(base.as_str()));
        write_file(&project.root.join(file), text).unwrap();
        git_out(project, &["add", "--", file]);
        git_out(project, &["commit", "-q", "-m", "the fix of another task"]);
        base
    }

    #[test]
    fn a_question_without_a_wip_commit_does_not_hold_the_checkout() {
        let (project, fake, base) = branch_project("no-wip");
        approve_with_new_files(&project, &fake);
        new_files_then_question(&project);
        set_work_run_runs(&project, false);
        let branch = listed_branch(&project, "t-1");
        assert!(!branch.checked_out && branch.note.is_empty(), "{branch:?}");
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()), "the forgotten files held the checkout on the task branch");
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", "task/t-1"]), "t-1 WIP (Dispatch: files of the work run)");
        assert_eq!(last_commit_files(&project, "task/t-1"), SCREEN_ONE_FILES);
        for file in SCREEN_ONE_FILES {
            assert!(!project.root.join(file).exists(), "{file} stayed in the checkout of the base");
        }
        clean(&project);
    }

    #[test]
    fn the_reply_takes_the_files_of_the_run_along() {
        let (project, fake, base) = branch_project("reply-own-files");
        approve_with_new_files(&project, &fake);
        // Dispatch 0.1.66 switched back while the work run still ran; the run wrote its files on the base.
        git_out(&project, &["checkout", "-q", &base]);
        new_files_then_question(&project);
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "Answer to question 1: Run the gate now"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        assert_eq!(git_out(&project, &["log", "-1", "--format=%s", "task/t-1"]), "t-1 WIP (Dispatch: files of the work run)");
        assert_eq!(last_commit_files(&project, "task/t-1"), SCREEN_ONE_FILES);
        assert_eq!(git_out(&project, &["status", "--porcelain", "--", ".", NOT_TASKS]), "");
        assert_eq!(last_call(&fake)[0], "Answer to question 1: Run the gate now");
        clean(&project);
    }

    #[test]
    fn a_reply_brings_the_newer_commits_of_the_base() {
        let (project, fake, _) = branch_project("reply-sync");
        let base = question_then_fix_on_the_base(&project, &fake, "fix.txt", "the fix of another task\n");
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "Answer to question 1: Run the gate now"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        assert!(git(&project.root, &["merge-base", "--is-ancestor", &base, "task/t-1"]).is_some(), "the base commit is not in task/t-1");
        assert_eq!(read(&project.root.join("fix.txt")), "the fix of another task\n");
        assert!(project.root.join("work-t-1.txt").is_file());
        assert_eq!(last_call(&fake)[0], "Answer to question 1: Run the gate now");
        // The task files of .dispatch stay as the base has them: the branch deletes none of them.
        assert_eq!(git_out(&project, &["diff", "--name-only", &format!("{base}...task/t-1"), "--", TASKS_DIR]), "");
        // The worker ends; the read switches back, the base keeps its report, and the merge brings the work.
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:{TASKS_DIR}/t-1.md")]).is_some(), "the base lost the report");
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string());
        assert!(merged.is_ok(), "{merged:?}");
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());
        assert_eq!(read(&project.root.join("fix.txt")), "the fix of another task\n");
        clean(&project);
    }

    #[test]
    fn a_clash_with_the_base_leaves_the_branch_and_tells_the_worker() {
        let (project, fake, _) = branch_project("reply-clash");
        let base = question_then_fix_on_the_base(&project, &fake, "work-t-1.txt", "another text of the base\n");
        let tip = git_out(&project, &["rev-parse", "task/t-1"]);
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "Answer to question 1: Run the gate now"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        assert_eq!(git_out(&project, &["rev-parse", "task/t-1"]), tip, "the clash moved the branch");
        assert_eq!(git_out(&project, &["status", "--porcelain", "--", ".", NOT_TASKS]), "");
        let text = &last_call(&fake)[0];
        assert!(text.starts_with("Answer to question 1: Run the gate now Dispatch could not bring the newer commits of "), "{text}");
        assert!(text.contains(&format!("of {base} into this branch: ")) && text.contains("work-t-1.txt"), "{text}");
        clean(&project);
    }

    /// The paths under `.dispatch` that a commit tracks; empty when it tracks none.
    fn tracked_tasks(project: &Project, rev: &str) -> String {
        git_out(project, &["ls-tree", "-r", "--name-only", rev, "--", TASKS_DIR])
    }

    /// A newer brief and tickets file of the user on the disk, and the check that a step kept them,
    /// the script, the branch file and the settings (ticket local-only-deletes-task-files).
    fn newer_task_files(project: &Project) -> impl Fn(&str) + '_ {
        let ticket = "{\"op\":\"open\",\"id\":\"t-9\",\"title\":\"A newer ticket\",\"status\":\"todo\",\"order\":1}\n";
        write_file(&project.briefs().join("t-1.md"), "the newer brief\n").unwrap();
        write_file(&project.tickets_file(), ticket).unwrap();
        let ignore = project.options().ignore_tasks;
        move |step: &str| {
            assert_eq!(read(&project.briefs().join("t-1.md")), "the newer brief\n", "{step}: the brief");
            assert_eq!(read(&project.tickets_file()), ticket, "{step}: the tickets file");
            assert_eq!(read(&project.script()), WORKER_SCRIPT, "{step}: the script");
            assert!(project.branch_file("t-1").is_file(), "{step}: the branch file is gone");
            assert_eq!(project.options().ignore_tasks, ignore, "{step}: the settings");
        }
    }

    #[test]
    fn local_only_keeps_the_task_files_through_the_branch_switches() {
        let (project, fake, base) = branch_project("local-only-switches");
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert!(!tracked_tasks(&project, "task/t-1").is_empty(), "the branch tracks the task files from before the switch");
        // On: Apply takes the task files out of git on the base.
        set_ignore(&project, true);
        apply(&project, &[]).unwrap();
        commit_setup(&project).unwrap();
        assert_eq!(tracked_tasks(&project, &base), "");
        let kept = newer_task_files(&project);
        // A reply puts the checkout on the branch of the task.
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "go on"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        kept("on the branch");
        // The worker ends; the read switches back to the base.
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        kept("back on the base");
        assert_eq!(tracked_tasks(&project, &base), "");
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string());
        assert!(merged.is_ok(), "{merged:?}");
        kept("after the merge");
        assert_eq!(tracked_tasks(&project, &base), "");
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());
        assert_no_merge_left(&project);
        clean(&project);
    }

    #[test]
    fn turning_local_only_off_keeps_the_task_files_at_the_switch() {
        let (project, fake, base) = branch_project("local-only-off");
        set_ignore(&project, true);
        apply(&project, &[]).unwrap();
        // The branch starts while local only is on: it tracks no task file.
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(tracked_tasks(&project, "task/t-1"), "");
        // Off: Apply commits the task files on the base again.
        set_ignore(&project, false);
        apply(&project, &[]).unwrap();
        let kept = newer_task_files(&project);
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert!(!tracked_tasks(&project, &base).is_empty());
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "go on"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(current_branch(&project).as_deref(), Some("task/t-1"));
        kept("on the branch");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).as_deref(), Some(base.as_str()));
        kept("back on the base");
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string());
        assert!(merged.is_ok(), "{merged:?}");
        kept("after the merge");
        assert_no_merge_left(&project);
        clean(&project);
    }

    #[test]
    fn a_branch_keeps_its_merge_with_task_branches_off() {
        let (project, fake, base) = branch_project("merge-branches-off");
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        set_branches(&project, false);
        apply(&project, &[]).unwrap();
        commit_setup(&project).unwrap();
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && branch.merge.is_empty(), "{branch:?}");
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string());
        assert!(merged.as_ref().is_ok_and(|text| text.starts_with(&format!("merged task/t-1 into {base}: "))), "{merged:?}");
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());
        assert_no_merge_left(&project);
        clean(&project);
    }

    #[test]
    fn a_lost_branch_note_is_found_by_the_branch_name() {
        let (project, fake, base) = branch_project("lost-branch-note");
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        fs::remove_file(project.branch_file("t-1")).unwrap();
        set_branches(&project, false);
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && !branch.checked_out && branch.merge.is_empty(), "{branch:?}");
        assert_eq!(read(&project.branch_file("t-1")), format!("branch: task/t-1\nbase: {base}\n"));
        let merged = task_merge(project.root.to_string_lossy().into_owned(), "t-1".to_string());
        assert!(merged.is_ok(), "{merged:?}");
        assert!(git(&project.root, &["cat-file", "-e", &format!("{base}:work-t-1.txt")]).is_some());
        // A merged branch gets no new note.
        fs::remove_file(project.branch_file("t-1")).unwrap();
        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        assert!(list.tasks.iter().find(|task| task.name == "t-1").is_some_and(|task| task.branch.is_none()));
        clean(&project);
    }

    #[test]
    fn own_changes_are_the_task_files_not_later_than_the_end() {
        let project = scratch("own-changes");
        let end = UNIX_EPOCH + std::time::Duration::from_secs(1_794_675_000);
        let file = |path: &str, after: i64| {
            let full = project.root.join(path);
            write_file(&full, "x\n").unwrap();
            let time = if after >= 0 { end + std::time::Duration::from_secs(after as u64) } else { end - std::time::Duration::from_secs((-after) as u64) };
            fs::File::options().write(true).open(&full).unwrap().set_modified(time).unwrap();
        };
        file("notes/ui.md", -300);
        file("notes/deep/old.md", -3600);
        file("tool.py", 1);
        file("README.md", 60);
        file("late/a.md", -60);
        file("late/b.md", 3);
        file("new.txt", -3600);
        let lines: Vec<String> = ["?? notes/", " M tool.py", " M README.md", " D gone.txt", "R  old.txt -> new.txt", "?? late/"].iter().map(|line| line.to_string()).collect();
        assert_eq!(own_changes(&project.root, &lines, end), vec!["?? notes/".to_string(), " M tool.py".to_string(), "R  old.txt -> new.txt".to_string()]);
        assert!(own_changes(&project.root, &[], end).is_empty());
        clean(&project);
    }

    /// Builds the scratch projects of the proof script of ticket task-branches when the variable
    /// BRANCHES_PROOF_DIR names an empty folder: `on` runs a scratch ticket through plan, approve,
    /// report, return and merge and writes the task list as JSON; `off` gets Apply with the switch
    /// off, on and off again and keeps copies of its files. The script then checks the files with git.
    #[test]
    #[ignore]
    fn branches_proof_projects() {
        let Ok(dir) = std::env::var("BRANCHES_PROOF_DIR") else { return };
        let dir = PathBuf::from(dir);
        let project = |name: &str| {
            let root = dir.join(name);
            fs::create_dir_all(&root).unwrap();
            Project { reports: root.join(TASKS_DIR), root, in_git: false }
        };
        let mut on = project("on");
        git_init(&on);
        on.in_git = true;
        write_file(&on.root.join("README.md"), "scratch project\n").unwrap();
        apply(&on, &[0]).unwrap();
        set_branches(&on, true);
        apply(&on, &[]).unwrap();
        run_git(&on.root, &["add", "--all"]).unwrap();
        run_git(&on.root, &["commit", "-q", "-m", "scratch setup"]).unwrap();
        let fake = fake_claude(&dir);
        write_file(&fake.join("work.txt"), "the work of the task\n").unwrap();
        let cwd = on.root.to_string_lossy().into_owned();
        fs::write(dir.join("base-before.txt"), git_out(&on, &["rev-parse", "HEAD"])).unwrap();
        plan_and_approve(&on, &fake, "t-1");
        fs::write(dir.join("after-approve.json"), serde_json::to_string_pretty(&task_list(cwd.clone()).unwrap()).unwrap()).unwrap();
        fs::write(dir.join("branch-after-approve.txt"), current_branch(&on).unwrap_or_default()).unwrap();
        let base = read_branch_file(&on.branch_file("t-1")).map(|info| info.base).unwrap_or_default();
        fs::write(dir.join("base-after-approve.txt"), git_out(&on, &["rev-parse", &base])).unwrap();
        fs::write(dir.join("task-branch-log.txt"), git_out(&on, &["log", "--oneline", "-3", "task/t-1"])).unwrap();
        write_report(&on, "t-1");
        fs::write(dir.join("after-report.json"), serde_json::to_string_pretty(&task_list(cwd.clone()).unwrap()).unwrap()).unwrap();
        fs::write(dir.join("merge.txt"), task_merge(cwd.clone(), "t-1".to_string()).unwrap_or_else(|error| format!("refused: {error}"))).unwrap();
        fs::write(dir.join("after-merge.json"), serde_json::to_string_pretty(&task_list(cwd).unwrap()).unwrap()).unwrap();

        let off = project("off");
        apply(&off, &[0]).unwrap();
        for (name, path) in [("worker", off.script()), ("plan-flags", off.plan_flags()), ("work-flags", off.work_flags())] {
            fs::copy(&path, dir.join(format!("{name}.first.txt"))).unwrap();
        }
        set_branches(&off, true);
        apply(&off, &[]).unwrap();
        set_branches(&off, false);
        apply(&off, &[]).unwrap();
    }

    /// Builds the scratch project of the proof of ticket task-checks when the variable
    /// TASK_CHECKS_PROOF_DIR names an empty folder: `<dir>/proj`, a git repository with the setup
    /// applied, a list of three checks (`unit` always recommended, `lint`, `net`), and the ticket t-1
    /// in its plan state with a plan whose section Checks ticks `lint`. All of it is committed, so
    /// Approve finds a clean tree. Writes the folder of the project into `<dir>/project.txt`.
    #[test]
    #[ignore]
    fn task_checks_proof_project() {
        let Ok(dir) = std::env::var("TASK_CHECKS_PROOF_DIR") else { return };
        let dir = PathBuf::from(dir);
        let root = dir.join("proj");
        fs::create_dir_all(&root).unwrap();
        let mut project = Project { reports: root.join(TASKS_DIR), root, in_git: false };
        git_init(&project);
        project.in_git = true;
        write_file(&project.root.join("README.md"), "scratch project of the task-checks proof\n").unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        set_checks(cwd.clone(), "# The checks of the scratch project\nunit | npm test | always\nlint | npx tsc --noEmit\nnet | node net-test.mjs\n".to_string()).unwrap();
        apply(&project, &[0]).unwrap();
        write_file(&project.briefs().join("t-1.md"), "# t-1: show the checks of a task\n\n## The user's words\n\"show the checks\"\n").unwrap();
        write_file(
            &project.plans().join("t-1.md"),
            "# t-1: show the checks of a task\n\n## Summary\n- One file changes.\n- 0 decisions.\n\n## Goal\nThe proof plan.\n\n## Acceptance\n- `npm test`: passes.\n\n## Checks\n- [x] unit — always recommended in this project.\n- [x] lint — the types change.\n- [ ] net — no network code changes.\n\n## Decisions\n- none\n",
        )
        .unwrap();
        write_file(&project.reports.join("t-1.state"), "planning\n").unwrap();
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "scratch setup"]);
        let list = task_list(cwd.clone()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!(task.checks.iter().filter(|check| check.recommended).count(), 2);
        assert!(list.dirty.is_empty(), "{:?}", list.dirty);
        fs::write(dir.join("project.txt"), &cwd).unwrap();
    }

    /// Builds the scratch project of the proof of ticket merge-fail-list when the variable
    /// MERGE_FAIL_PROOF_DIR names an empty folder: `<dir>/proj` with Task branches on, the ticket t-1
    /// through plan, approve and report with the fake worker, the checkout back on the base, and a gate
    /// command that prints the fixture `tests/fixtures/merge-gate-fail.txt` and ends with exit code 1.
    /// It merges nothing; the Merge button of the test copy does that in the proof.
    #[test]
    #[ignore]
    fn merge_fail_proof_project() {
        let Ok(dir) = std::env::var("MERGE_FAIL_PROOF_DIR") else { return };
        let dir = PathBuf::from(dir);
        let root = dir.join("proj");
        fs::create_dir_all(&root).unwrap();
        let mut project = Project { reports: root.join(TASKS_DIR), root, in_git: false };
        git_init(&project);
        project.in_git = true;
        write_file(&project.root.join("README.md"), "scratch project of the merge-fail-list proof\n").unwrap();
        apply(&project, &[0]).unwrap();
        set_branches(&project, true);
        apply(&project, &[]).unwrap();
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "scratch setup"]);
        let fake = fake_claude(&dir);
        write_file(&fake.join("work.txt"), "the work of the task\n").unwrap();
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        let cwd = project.root.to_string_lossy().into_owned();
        // The task read switches the checkout back to the base and commits the task files there.
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && !branch.checked_out, "{branch:?}");
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("merge-gate-fail.txt");
        fs::copy(&fixture, project.root.join("merge-gate-fail.txt")).unwrap();
        git_out(&project, &["add", "merge-gate-fail.txt"]);
        git_out(&project, &["commit", "-q", "-m", "the gate log of the proof"]);
        set_merge_gate(cwd.clone(), "type merge-gate-fail.txt & exit 1\n".to_string()).unwrap();
        task_list(cwd.clone()).unwrap();
        fs::write(dir.join("project.txt"), &cwd).unwrap();
        fs::write(dir.join("base.txt"), &branch.base).unwrap();
    }

    /// Builds the scratch project of the proof of ticket merged-outside when the variable
    /// MERGED_OUTSIDE_PROOF_DIR names an empty folder: `<dir>/proj` with Task branches on, the ticket
    /// t-1 through plan, approve and report with the fake worker, the checkout back on the base, a
    /// gate that refuses every merge, and one ticket of the board for the task t-1. It merges
    /// nothing; the proof clicks Merge in the test copy and then merges the branch with git.
    #[test]
    #[ignore]
    fn merged_outside_proof_project() {
        let Ok(dir) = std::env::var("MERGED_OUTSIDE_PROOF_DIR") else { return };
        let dir = PathBuf::from(dir);
        let root = dir.join("proj");
        fs::create_dir_all(&root).unwrap();
        let mut project = Project { reports: root.join(TASKS_DIR), root, in_git: false };
        git_init(&project);
        project.in_git = true;
        write_file(&project.root.join("README.md"), "scratch project of the merged-outside proof\n").unwrap();
        apply(&project, &[0]).unwrap();
        set_branches(&project, true);
        apply(&project, &[]).unwrap();
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "scratch setup"]);
        let fake = fake_claude(&dir);
        write_file(&fake.join("work.txt"), "the work of the task\n").unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let ticket = crate::core::tickets::ticket_add(cwd.clone(), "Show a branch that git merged as merged".to_string(), None, None, None).unwrap();
        crate::core::tickets::ticket_update(cwd.clone(), ticket.id.clone(), None, None, Some("t-1".to_string()), None, None).unwrap();
        crate::core::tickets::ticket_move(cwd.clone(), ticket.id.clone(), "new".to_string(), vec![ticket.id.clone()], None).unwrap();
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "the ticket of the proof"]);
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        let branch = listed_branch(&project, "t-1");
        assert!(branch.exists && !branch.checked_out && branch.merge.is_empty(), "{branch:?}");
        set_merge_gate(cwd.clone(), "echo the gate of the proof refuses every merge & exit 1\n".to_string()).unwrap();
        let list = task_list(cwd.clone()).unwrap();
        assert!(list.tickets.iter().any(|one| one.id == ticket.id && one.status == crate::core::tickets::DONE), "{:?}", list.tickets);
        fs::write(dir.join("project.txt"), &cwd).unwrap();
        fs::write(dir.join("base.txt"), &branch.base).unwrap();
    }

    /// Builds the scratch project of the proof of ticket stale-report-loop when the variable
    /// STALE_REPORT_PROOF_DIR names an empty folder: `<dir>/proj` with Task branches on. Scene B, t-2:
    /// the worker asked the question of the Starminer card, and the task read put it onto the base, so
    /// base and branch hold the same report. Scene A, t-1: the state of Starminer at 18:14 (the base
    /// holds the question from 17:10, the branch the done report of 18:03, and triage merged the branch
    /// by hand and kept the copy of the base). The checkout is on the base. No task read runs after
    /// scene A: the test copy meets the stale copy at its first poll.
    #[test]
    #[ignore]
    fn stale_report_proof_project() {
        let Ok(dir) = std::env::var("STALE_REPORT_PROOF_DIR") else { return };
        let dir = PathBuf::from(dir);
        let root = dir.join("proj");
        fs::create_dir_all(&root).unwrap();
        let mut project = Project { reports: root.join(TASKS_DIR), root, in_git: false };
        git_init(&project);
        project.in_git = true;
        write_file(&project.root.join("README.md"), "scratch project of the stale-report-loop proof\n").unwrap();
        apply(&project, &[0]).unwrap();
        set_branches(&project, true);
        apply(&project, &[]).unwrap();
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "scratch setup"]);
        let fake = fake_claude(&dir);
        write_file(&fake.join("work.txt"), "the work of the task\n").unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        // Scene B: the question stands on the base and on the branch.
        plan_and_approve(&project, &fake, "t-2");
        std::thread::sleep(std::time::Duration::from_millis(30));
        write_file(&project.reports.join("t-2.md"), GATE_QUESTION).unwrap();
        let branch = listed_branch(&project, "t-2");
        assert!(branch.exists && !branch.checked_out, "{branch:?}");
        assert_eq!(report_blob(&project, &branch.base, "t-2"), report_blob(&project, "task/t-2", "t-2"));
        // Scene A: the stale copy of Starminer.
        let base = stale_base_after_a_merge_by_hand(&project, &fake, "t-1");
        assert_eq!(read(&project.reports.join("t-2.md")), GATE_QUESTION);
        assert_eq!(git_out(&project, &["status", "--porcelain"]), "");
        fs::write(dir.join("project.txt"), &cwd).unwrap();
        fs::write(dir.join("base.txt"), &base).unwrap();
    }

    /// A commit on a branch with the given files, without a checkout (a temporary index).
    fn branch_commit(project: &Project, branch: &str, files: &[(&str, &str)]) {
        let dir = project.root.parent().unwrap().join("branch-commit");
        fs::create_dir_all(&dir).unwrap();
        let index = dir.join("index");
        let _ = fs::remove_file(&index);
        let in_index = |args: &[&str]| run_git_index(&project.root, Some(&index), args).unwrap().trim().to_string();
        in_index(&["read-tree", branch]);
        for (at, (path, text)) in files.iter().enumerate() {
            let blob = dir.join(format!("blob-{at}"));
            fs::write(&blob, text).unwrap();
            let sha = in_index(&["hash-object", "-w", &blob.to_string_lossy()]);
            in_index(&["update-index", "--add", "--cacheinfo", &format!("100644,{sha},{path}")]);
        }
        let tree = in_index(&["write-tree"]);
        let commit = git_out(project, &["commit-tree", &tree, "-p", branch, "-m", "branch copies"]);
        git_out(project, &["update-ref", &format!("refs/heads/{branch}"), &commit]);
    }

    /// The task files of `.dispatch` (`*.md`, `logs/*.md`) with a line that starts with a conflict marker.
    fn marked_files(project: &Project) -> Vec<String> {
        let logs = project.reports.join("logs");
        files_with(&project.reports, "md")
            .into_iter()
            .chain(files_with(&logs, "md"))
            .filter(|(_, path, _)| read(path).lines().any(|line| ["<<<<<<<", "=======", ">>>>>>>"].iter().any(|marker| line.starts_with(marker))))
            .map(|(_, path, _)| path.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn a_running_task_without_a_ticket_gets_one_in_progress() {
        let project = scratch("adopt-task");
        apply(&project, &[0]).unwrap();
        let fake = fake_claude(project.root.parent().unwrap());
        let cwd = project.root.to_string_lossy().into_owned();
        // Triage starts the plan run with the script, outside the ticket flow.
        write_file(&project.briefs().join("t-netflakes.md"), "# t-netflakes: Fix the flaky net tests\n\n## The user's words\n\"The net tests fail now and then.\"\n").unwrap();
        write_file(&project.reports.join("fake-name.txt"), "t-netflakes [plan]").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["plan", "t-netflakes"]);
        assert_eq!(code, 0, "{out}");
        let list = task_list(cwd.clone()).unwrap();
        let task = list.tasks.iter().find(|task| task.name == "t-netflakes").expect("the task is listed");
        assert_eq!(task.state, "planning");
        assert!(list.tickets.is_empty(), "no ticket yet: the board adopts the task");
        let ticket = crate::core::tickets::ticket_adopt(cwd.clone(), "t-netflakes".to_string()).unwrap();
        assert_eq!(ticket.title, "Fix the flaky net tests");
        assert_eq!(ticket_status(&project, "t-netflakes"), crate::core::tickets::IN_PROGRESS);
        assert!(crate::core::tickets::ticket_adopt(cwd.clone(), "t-netflakes".to_string()).is_err(), "one ticket per task");
        // A close wins over the state file, which still says planning.
        crate::core::tickets::ticket_move(cwd, "t-netflakes".to_string(), crate::core::tickets::DONE.to_string(), Vec::new(), Some("done".to_string())).unwrap();
        let closed = read(&project.tickets_file());
        assert_eq!(ticket_status(&project, "t-netflakes"), crate::core::tickets::DONE);
        assert_eq!(read(&project.tickets_file()), closed, "no in_progress line after the close");
        clean(&project);
    }

    #[test]
    fn a_conflicted_merge_keeps_the_branch_report_and_log_without_markers() {
        let (project, fake, base) = branch_project("merge-markers");
        let cwd = project.root.to_string_lossy().into_owned();
        plan_and_approve(&project, &fake, "t-1");
        write_report(&project, "t-1");
        assert!(!listed_branch(&project, "t-1").checked_out);
        assert_eq!(current_branch(&project).unwrap(), base);
        // The base and the branch hold other copies of the report and the log of t-1, and of the report of t-9.
        let branch_report = "state: done\nneeds: nothing\nfiles: work-t-1.txt\nplan: p\n\nThe branch copy of the report.\n";
        let branch_log = "# t-1: the branch copy of the log\n";
        branch_commit(&project, "task/t-1", &[(".dispatch/t-1.md", branch_report), (".dispatch/logs/t-1.md", branch_log), (".dispatch/t-9.md", "state: done\n\nThe branch copy of t-9.\n")]);
        let base_report = "state: done\nneeds: nothing\nfiles: work-t-1.txt\nplan: p\n\nThe base copy of the report.\n";
        write_file(&project.reports.join("t-1.md"), base_report).unwrap();
        write_file(&project.reports.join("logs").join("t-1.md"), "# t-1: the base copy of the log\n").unwrap();
        write_file(&project.reports.join("t-9.md"), "state: done\n\nThe base copy of t-9.\n").unwrap();
        git_out(&project, &["add", "--", ".dispatch"]);
        git_out(&project, &["commit", "-q", "-m", "base copies", "--", ".dispatch"]);

        let merged = task_merge(cwd, "t-1".to_string());
        assert!(merged.is_ok(), "{merged:?}");
        assert_no_merge_left(&project);
        assert_eq!(read(&project.reports.join("t-1.md")), branch_report, "the report of the task takes the branch side");
        assert_eq!(read(&project.reports.join("logs").join("t-1.md")), branch_log, "the log of the task takes the branch side");
        assert_eq!(read(&project.reports.join("t-9.md")), "state: done\n\nThe base copy of t-9.\n", "another task keeps the base side");
        assert!(marked_files(&project).is_empty(), "{:?}", marked_files(&project));
        let committed = git_out(&project, &["show", "HEAD:.dispatch/t-1.md"]).replace("\r\n", "\n");
        assert_eq!(format!("{committed}\n"), branch_report);
        clean(&project);
    }

    #[test]
    fn the_task_read_repairs_conflict_markers_once() {
        let project = scratch("repair-markers");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let marked = "<<<<<<< HEAD\nstate: working\nneeds: nothing\n=======\nstate: done\nneeds: nothing\n>>>>>>> task/t-1\nfiles: a.txt\nplan: p\n\n## What changed\nDone.\n";
        write_file(&project.reports.join("t-1.md"), marked).unwrap();
        let log = "# t-1: log\n\n<<<<<<< HEAD\nthe base line\n||||||| merged common ancestors\nthe old line\n=======\nthe branch line\n>>>>>>> task/t-1\nend\n";
        write_file(&project.reports.join("logs").join("t-1.md"), log).unwrap();
        // A heading underline and an incomplete block stay as they are.
        let underline = "state: done\nneeds: nothing\nfiles: none\nplan: p\n\nTitle\n=======\n\n<<<<<<< HEAD\nno end\n";
        write_file(&project.reports.join("t-2.md"), underline).unwrap();

        let list = task_list(cwd.clone()).unwrap();
        assert_eq!(list.repairs.len(), 2, "{:?}", list.repairs);
        assert!(list.repairs.iter().any(|note| note.starts_with(".dispatch/t-1.md: kept the task branch side of 1 conflict block")), "{:?}", list.repairs);
        assert_eq!(read(&project.reports.join("t-1.md")), "state: done\nneeds: nothing\nfiles: a.txt\nplan: p\n\n## What changed\nDone.\n");
        assert_eq!(read(&project.reports.join("logs").join("t-1.md")), "# t-1: log\n\nthe branch line\nend\n");
        assert_eq!(read(&project.reports.join("t-2.md")), underline);
        let task = list.tasks.iter().find(|task| task.name == "t-1").unwrap();
        assert_eq!(task.header.as_ref().map(|header| header.state.as_str()), Some("done"), "the repaired report has its header");
        // Once: the next read has nothing to repair.
        assert!(task_list(cwd).unwrap().repairs.is_empty());
        clean(&project);
    }

    #[test]
    fn no_task_file_is_committed_during_an_unfinished_merge() {
        let project = git_scratch("unfinished-merge");
        apply(&project, &[]).unwrap();
        write_file(&project.reports.join("t-1.md"), "state: working\n\nthe first copy\n").unwrap();
        git_out(&project, &["add", "--all"]);
        git_out(&project, &["commit", "-q", "-m", "scratch setup"]);
        let base = current_branch(&project).unwrap();
        git_out(&project, &["branch", "other"]);
        branch_commit(&project, "other", &[(".dispatch/t-1.md", "state: done\n\nthe copy of other\n")]);
        write_file(&project.reports.join("t-1.md"), "state: done\n\nthe copy of the base\n").unwrap();
        git_out(&project, &["commit", "-q", "-m", "base copy", "--", ".dispatch/t-1.md"]);
        assert!(run_git(&project.root, &["merge", "other"]).is_err(), "the merge conflicts");
        assert_eq!(current_branch(&project).unwrap(), base);
        let head = git_out(&project, &["rev-parse", "HEAD"]);
        assert!(unfinished_git(&project));

        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        assert!(list.repairs.is_empty(), "git still needs the markers");
        assert_eq!(git_out(&project, &["rev-parse", "HEAD"]), head, "no commit during the merge");
        assert!(!git_out(&project, &["ls-files", "-u", "--", ".dispatch/t-1.md"]).is_empty(), "the conflict stays unmerged");
        assert!(read(&project.reports.join("t-1.md")).contains("<<<<<<<"));
        assert!(!project.log_file("t-1").exists(), "no log from a marked report");
        git_out(&project, &["merge", "--abort"]);
        assert!(!unfinished_git(&project));
        clean(&project);
    }

    // Ticket subtickets: the section Parts of a plan, the tickets of the parts at Approve, the brief
    // of a part and the night box.

    /// A plan with two parts, in the form that the section text asks for.
    const PLAN_WITH_PARTS: &str = "# t-big: Big\n\n## Summary\n- one\n\n## Steps\n1. Do the first piece.\n\n## Parts\n1. Piece one\n   - Level: `hard`\n   - Type: fix\n   - Goal: Make the list fast\n     with 500 tickets.\n   - What I see: It stalls.\n   - Done when: 500 tickets scroll\n2. **Piece two**\n   - level: Simple.\n   - goal: Write the help\n   - Do not change: The README\n   - Why: The users ask.\n   - Context: Since 0.1.70\n   - Unknown: skipped\n\n## Work run\n- model: opus\n- effort: high\n";

    #[test]
    fn the_parts_section_of_a_plan_gives_each_part_with_its_level_and_fields() {
        let parts = plan_parts(PLAN_WITH_PARTS);
        assert_eq!(parts.len(), 2);
        assert_eq!((parts[0].title.as_str(), parts[0].level.as_str(), parts[0].kind.as_str()), ("Piece one", "hard", "fix"));
        assert_eq!(parts[0].goal, "Make the list fast with 500 tickets.", "a wrapped line joins the line above");
        assert_eq!(parts[0].fields, crate::core::tickets::TicketFields { see: "It stalls.".into(), done: "500 tickets scroll".into(), ..Default::default() });
        assert_eq!((parts[1].title.as_str(), parts[1].level.as_str(), parts[1].kind.as_str(), parts[1].goal.as_str()), ("Piece two", "simple", "", "Write the help"));
        assert_eq!(
            parts[1].fields,
            crate::core::tickets::TicketFields { keep: "The README".into(), why: "The users ask.".into(), context: "Since 0.1.70".into(), ..Default::default() }
        );
        // The steps of the plan are no parts; a plan without the section, or with None, gives none.
        assert!(plan_parts("# t: x\n\n## Steps\n1. One\n2. Two\n").is_empty());
        assert!(plan_parts("# t: x\n\n## Parts\nNone.\n").is_empty());
    }

    #[test]
    fn approve_opens_one_backlog_ticket_per_part_in_order() {
        let project = scratch("parts-approve");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        write_file(&project.tickets_file(), "{\"op\":\"open\",\"id\":\"t-big\",\"ts\":1,\"title\":\"Big\",\"summary\":\"Big\",\"status\":\"in_progress\"}\n{\"op\":\"open\",\"id\":\"t-small\",\"ts\":2,\"title\":\"Small\",\"summary\":\"Small\",\"status\":\"in_progress\"}\n").unwrap();
        write_file(&project.plans().join("t-big.md"), PLAN_WITH_PARTS).unwrap();
        write_file(&project.plans().join("t-small.md"), "# t-small: Small\n\n## Steps\n1. One\n").unwrap();
        let ok = |_: &Project, _: &[&str]| -> Result<String, String> { Ok("started".to_string()) };
        let refused = |_: &Project, _: &[&str]| -> Result<String, String> { Err("the worker still runs".to_string()) };
        let parts = |project: &Project| crate::core::tickets::list(project).into_iter().filter(|ticket| !ticket.parent.is_empty()).collect::<Vec<_>>();
        // The task card shows the parts before Approve.
        let list = serde_json::to_value(task_list(cwd.clone()).unwrap()).unwrap();
        let card = |list: &Value, name: &str| list["tasks"].as_array().unwrap().iter().find(|task| task["name"] == name).unwrap().clone();
        assert_eq!(card(&list, "t-big")["parts"][1]["title"], "Piece two");
        assert_eq!(card(&list, "t-big")["parts"][0]["level"], "hard");
        assert_eq!(card(&list, "t-small")["parts"], json!([]));
        // A failed approve opens nothing.
        assert!(task_approve_with(&project, "t-big", &refused).is_err());
        assert!(parts(&project).is_empty());
        // A plan without parts gives no subticket.
        assert_eq!(task_approve_with(&project, "t-small", &ok).unwrap(), "started");
        assert!(parts(&project).is_empty());
        // Approve: one Backlog ticket per part, in order, linked to the parent.
        task_approve_with(&project, "t-big", &ok).unwrap();
        let made = parts(&project);
        let shown: Vec<(&str, &str, &str, &str, u32, &str)> =
            made.iter().map(|t| (t.title.as_str(), t.status.as_str(), t.level.as_str(), t.kind.as_str(), t.part, t.parent.as_str())).collect();
        assert_eq!(shown, [("Piece one", "backlog", "hard", "fix", 1, "t-big"), ("Piece two", "backlog", "simple", "content", 2, "t-big")]);
        assert_eq!(made[0].summary, "Make the list fast with 500 tickets.");
        assert_eq!(made[1].fields.keep, "The README");
        // A second approve opens no second set.
        task_approve_with(&project, "t-big", &ok).unwrap();
        assert_eq!(parts(&project).len(), 2);
        // The plan of a part lists no parts: its card shows none, and its approve opens none.
        let part = made[0].id.clone();
        write_file(&project.plans().join(format!("{part}.md")), &PLAN_WITH_PARTS.replace("t-big", &part)).unwrap();
        let list = serde_json::to_value(task_list(cwd).unwrap()).unwrap();
        assert_eq!(card(&list, &part)["parts"], json!([]));
        task_approve_with(&project, &part, &ok).unwrap();
        assert_eq!(parts(&project).len(), 2);
        // A task without a ticket opens nothing.
        write_file(&project.plans().join("t-loose.md"), PLAN_WITH_PARTS).unwrap();
        task_approve_with(&project, "t-loose", &ok).unwrap();
        assert_eq!(parts(&project).len(), 2);
        clean(&project);
    }

    #[test]
    fn the_brief_of_a_part_names_the_parent_and_the_earlier_parts_with_their_commits() {
        let project = git_scratch("parts-brief");
        let root = project.root.clone();
        for message in ["t-1: the work of the parent", "t-10: another ticket", "t-1-a: the first part", "t-1-ab: not the first part", "Fix for t-1-a after it"] {
            run_git(&root, &["commit", "--allow-empty", "-q", "-m", message]).unwrap();
        }
        let lines = [
            "{\"op\":\"open\",\"id\":\"t-1\",\"ts\":1,\"title\":\"Parent\",\"summary\":\"Parent\",\"status\":\"in_progress\"}",
            "{\"op\":\"open\",\"id\":\"t-1-a\",\"ts\":2,\"title\":\"First part\",\"summary\":\"First\",\"status\":\"backlog\",\"parent\":\"t-1\",\"part\":1}",
            "{\"op\":\"open\",\"id\":\"t-1-x\",\"ts\":2,\"title\":\"Dropped part\",\"summary\":\"Dropped\",\"status\":\"backlog\",\"parent\":\"t-1\",\"part\":2}",
            "{\"op\":\"open\",\"id\":\"t-1-b\",\"ts\":2,\"title\":\"Second part\",\"summary\":\"Second\",\"status\":\"backlog\",\"parent\":\"t-1\",\"part\":3}",
            "{\"op\":\"close\",\"ref\":\"t-1-a\",\"ts\":3,\"resolution\":\"done\",\"note\":\"done\"}",
            "{\"op\":\"close\",\"ref\":\"t-1-x\",\"ts\":3,\"resolution\":\"wontfix\",\"note\":\"canceled\"}",
        ];
        write_file(&project.tickets_file(), &format!("{}\n", lines.join("\n"))).unwrap();
        let tickets = crate::core::tickets::list(&project);
        let second = crate::core::tickets::find(&tickets, "t-1-b").unwrap();
        let chain = chain_lines(&project, &tickets, &second);
        let hash = |subject: &str| run_git(&root, &["log", "--format=%h", "-F", &format!("--grep={subject}")]).unwrap().trim().to_string();
        assert_eq!(
            chain,
            [
                "Part 2 of 2 of ticket t-1: Parent".to_string(),
                "The plan of the parent: `.dispatch/plans/t-1.md`".to_string(),
                format!("- parent t-1: Parent (in-progress); commits: {} t-1: the work of the parent", hash("the work of the parent")),
                format!("- part t-1-a: First part (done); commits: {} Fix for t-1-a after it; {} t-1-a: the first part", hash("Fix for"), hash("t-1-a: the first part")),
            ]
        );
        let brief = ticket_brief(&second, 0, true, &chain);
        assert!(
            brief.contains(&format!("## The user's words\nSecond\n\n## Parent and earlier parts\nThis ticket is part 2 of 2 of ticket t-1: Parent. Its plan lists no parts.\n{}\n\n## Constraints\n", chain[1..].join("\n"))),
            "{brief}"
        );
        // The page gets the same lines for the message to triage.
        assert_eq!(ticket_chain(root.to_string_lossy().into_owned(), "t-1-b".into()).unwrap(), chain);
        // The first part names only the parent; a ticket without a parent gives the brief of before.
        let first = crate::core::tickets::find(&tickets, "t-1-a").unwrap();
        assert_eq!(chain_lines(&project, &tickets, &first).len(), 3);
        let parent = crate::core::tickets::find(&tickets, "t-1").unwrap();
        assert!(chain_lines(&project, &tickets, &parent).is_empty());
        assert!(!ticket_brief(&parent, 0, true, &[]).contains("Parent and earlier parts"));
        clean(&project);
    }

    #[test]
    fn a_part_without_the_night_box_waits_at_night() {
        let project = scratch("parts-night");
        apply(&project, &[0]).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        write_file(&project.tickets_file(), "{\"op\":\"open\",\"id\":\"t-big\",\"ts\":1,\"title\":\"Big\",\"summary\":\"Big\",\"status\":\"in_progress\"}\n{\"op\":\"open\",\"id\":\"t-big-1\",\"ts\":2,\"title\":\"Piece\",\"summary\":\"Piece\",\"status\":\"in_progress\",\"parent\":\"t-big\",\"part\":1}\n").unwrap();
        for name in ["t-big", "t-big-1"] {
            write_file(&project.reports.join(format!("{name}.state")), "planning\n").unwrap();
            write_file(&project.plans().join(format!("{name}.md")), &format!("# {name}: x\n\n## Steps\n1. One\n")).unwrap();
        }
        let hold = |name: &str| {
            let list = serde_json::to_value(task_list(cwd.clone()).unwrap()).unwrap();
            list["tasks"].as_array().unwrap().iter().find(|task| task["name"] == name).unwrap()["nightHold"].clone()
        };
        // The box starts unticked (user decision 1): the part waits at night; the parent does not.
        assert_eq!(hold("t-big-1"), json!(true));
        assert_eq!(hold("t-big"), json!(false));
        crate::core::tickets::ticket_night(cwd.clone(), "t-big".into(), true).unwrap();
        assert_eq!(hold("t-big-1"), json!(false));
        clean(&project);
    }

    #[test]
    fn the_section_names_the_parts_of_a_plan() {
        let body = scratch("parts-section").section_body();
        assert!(body.contains("; Parts (optional: only when the work is too large for one work run, and never in the plan of a part:"), "{body}");
        assert!(body.contains("each part a numbered item `N. <title>` with the list lines `Level:`"), "{body}");
        assert!(body.contains("A ticket message with the block `Part N of M of ticket <id>` is a part of that ticket: triage copies the block into the brief as the section `## Parent and earlier parts`"), "{body}");
    }
}
