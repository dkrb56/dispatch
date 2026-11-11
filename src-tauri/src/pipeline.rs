//! Prepares a project for the worker pipeline: a triage session starts background sessions
//! of Claude Code (workers) through a script, and each worker writes a plan and a report to the
//! folder `.dispatch` of the project, which git tracks and Dispatch commits (ticket
//! reports-in-project). A task is two runs of one session: the plan run on the options
//! of `plan-flags.txt`, and after the user's yes the work run on the options of `work-flags.txt`.

use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::info::{file_entry, git, FileEntry, CREATE_NO_WINDOW};
use crate::{err, session_flags};

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
/// The pathspec that leaves the planned entries out of the commit of the task files: they have
/// their own commit (`backlog::keep_committed`).
const NOT_BACKLOG: &str = ":(exclude).dispatch/backlog";

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
}

// A settings file of an older version has a field for answers in the triage chat. Serde drops a
// field it does not know, so such a file reads without an error.
impl Default for Options {
    fn default() -> Self {
        Options { short_reports: true, triage_name: true, auto_approve: false }
    }
}

/// The command that runs the worker script. `reports` is the reports folder with `/`.
fn script_command(reports: &str) -> String {
    format!("powershell -ExecutionPolicy Bypass -File {reports}/{SCRIPT_NAME}")
}

/// A folder with `/` as a permission rule writes it: `D:/folder` is `//d/folder`.
fn rule_form(path: &str) -> Result<String, String> {
    match path.split_once(":/") {
        Some((drive, rest)) if drive.len() == 1 => Ok(format!("//{}/{rest}", drive.to_ascii_lowercase())),
        _ => Err(format!("the project is not on a drive: {path}")),
    }
}

/// The content of `.claude/triage.md` for the settings of a project.
fn triage_prompt(options: Options, reports: &str) -> String {
    let script = script_command(reports);
    let mut text = format!(
        "# Triage session

You are the triage session of this project. The user types tasks here.

- Follow the section \"Background workers\" in CLAUDE.md. You are \"triage\" in that section.
- You do no implementation. For each task, you classify it, write a brief, start the plan run with `{script} plan <ticket-id>`, tell the user when the plan is ready, check the result and report to the user. The user approves or rejects a plan in the task card of Dispatch, never here; Dispatch writes one line into this chat when that happened. Never run `{script} approve` yourself.
- When you need a decision from the user, ask with the tool `AskUserQuestion`: one question, 2 to 4 options, the option that you recommend first. The chat window shows the options as buttons. Use a text question only when the options are not known.
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
pub struct Plan {
    /// The folder of the project.
    root: String,
    /// The project is in a git repository. The button "Commit to git" needs one.
    git: bool,
    options: Options,
    steps: Vec<Step>,
}

/// The paths of one project.
pub(crate) struct Project {
    pub(crate) root: PathBuf,
    reports: PathBuf,
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
        // The task files are in the project, so git tracks them and a clone has them. Dispatch
        // commits them itself (`keep_tasks_committed`), and Approve does not count them as changes.
        let reports = root.join(TASKS_DIR);
        Ok(Project { root, reports, in_git })
    }

    /// The reports folder of the old layout: `<project>-reports` next to the project. The step
    /// "Task files" moves it into `.dispatch`. None for a project without a parent folder.
    fn old_reports(&self) -> Option<PathBuf> {
        let (parent, name) = (self.root.parent()?, self.root.file_name()?);
        Some(parent.join(format!("{}-reports", name.to_string_lossy())))
    }

    fn briefs(&self) -> PathBuf {
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

    /// The planned entries of the project (ticket overview-backlog): one Markdown file each, in
    /// the project, so git can track them.
    pub(crate) fn backlog_dir(&self) -> PathBuf {
        self.root.join(TASKS_DIR).join("backlog")
    }

    /// A project with given folders, for the tests of other modules.
    #[cfg(test)]
    pub(crate) fn scratch(root: PathBuf, reports: PathBuf) -> Project {
        Project { root, reports, in_git: false }
    }

    /// The plans that the plan runs write, one file per ticket.
    fn plans(&self) -> PathBuf {
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

    fn options_file(&self) -> PathBuf {
        self.reports.join("options.json")
    }

    /// The settings of the project. Without the file, each setting is on.
    fn options(&self) -> Options {
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
    fn setup_files(&self) -> [&'static str; 7] {
        [
            "CLAUDE.md",
            ".claude/settings.json",
            ".claude/settings.local.json",
            ".claude/triage.md",
            ".dispatch/worker.ps1",
            ".dispatch/plan-flags.txt",
            ".dispatch/work-flags.txt",
        ]
    }

    /// The reports folder with `/`, as `CLAUDE.md` gives it.
    fn reports_text(&self) -> String {
        self.reports.to_string_lossy().replace('\\', "/")
    }

    /// The reports folder as a permission rule writes it: `D:\folder` is `//d/folder`.
    fn rule_path(&self) -> Result<String, String> {
        rule_form(&self.reports_text())
    }

    /// The texts by which a permission rule names the reports folder of the old layout: the
    /// script path and the rule path, each with a `/` at its end. Empty without an old folder.
    fn old_rule_texts(&self) -> Vec<String> {
        let Some(old) = self.old_reports() else { return Vec::new() };
        let text = old.to_string_lossy().replace('\\', "/");
        let mut texts = vec![format!("{text}/")];
        texts.extend(rule_form(&text).ok().map(|rule| format!("{rule}/")));
        texts
    }

    /// The permission rules that let triage run the worker script and check the workers, and
    /// let each session read and write the reports, without a prompt.
    fn allow_rules(&self) -> Result<Vec<String>, String> {
        let reports = self.reports_text();
        let rule_path = self.rule_path()?;
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
    fn deny_rules(&self) -> Vec<String> {
        vec![format!("Bash({} approve *)", script_command(&self.reports_text()))]
    }

    /// The text of the section under its heading and its mark line.
    pub(crate) fn section_body(&self) -> String {
        let reports = self.reports_text();
        let script = script_command(&reports);
        format!(
            "- A task is two runs of one worker session. The plan run reads the code and writes a plan. The work run executes the approved plan. Triage starts and resumes a worker only with the script `{reports}/{SCRIPT_NAME}`, never with `claude --bg` or `claude --resume` directly. A worker works in the main checkout (`worktree.bgIsolation` is `none`).
- Triage writes each brief to `{reports}/briefs/<ticket-id>.md`: the user's words, the constraints, and the command that proves the work. The brief says nothing about the approach; the plan run decides that.
- `{script} plan <ticket-id>` starts the plan run on the options in `{reports}/plan-flags.txt`: without the Edit tool, without the Agent tool and without a prompt; its Write tool may write only into `{reports}/plans/`. The plan run writes the plan to `{reports}/plans/<ticket-id>.md`, changes nothing else, and ends its turn.
- A plan has these sections: Summary (3 lines maximum: what changes, how many files, how many decisions and whether one is `HOLD`; the task card of Dispatch shows these lines); Goal; Acceptance (commands with the expected output); Files to change (each with the symbol or an anchor line, the change and the reason); Files read (one fact each); Steps; Decisions (each a numbered item with its question, and under it one list item per option, because Dispatch shows each option as a button: first `- Default:` with the recommended choice, or `- HOLD:` instead when only the user takes it, then at least one real alternative as `- Other:`; each option one short line, its reason after it as `Recommended: …` or `Not recommended: …`; the word HOLD stands in no other line of this section); Do not touch; Size (files). No code in a plan.
- When the plan run is done, triage tells the user that the plan is ready. The user reads the plan in the task card of Dispatch and clicks Approve or Reject there; only that click is the yes. Dispatch runs `{script} approve <ticket-id>`, which resumes the same session on the options in `{reports}/work-flags.txt`, and writes one line into the triage chat. Triage never runs approve itself; the local settings deny it that verb. The script refuses when the working tree has uncommitted changes outside `{reports}/` (after Setup pipeline, the user commits the setup files first; Dispatch commits the files of `{reports}/` itself), when the worker still runs, or when the task was stopped.
- The work run follows the plan. A deviation goes into the report, not into the code. The worker ends with one local commit on the current branch, with the ticket id in the message. It never pushes or merges. The user decides the push.
- A worker ends with a report in `{reports}/<ticket-id>.md`. The report starts with four lines, each `key: value`: `state` (`done`, `needs-decision` or `failed`), `needs` (`nothing`, `decision` or `permission`), `files` (the changed files, or `none`) and `plan` (the plan file). Then: what it did, what it verified and how, open questions, where the work is.
- A worker starts no session and sends no message to a chat. It has no question tool. A question for the user goes into the report under the heading `## Questions`: numbered items, each with its options as list items, the recommended option first. Each option is one short line, because Dispatch shows it as a button and sends it back word for word; the details stand above the questions. The worker then writes `state: needs-decision` and `needs: decision` and ends its turn, also when the question is about a permission. `needs: permission` means: a refused tool call stopped the work, the report names the refused call and the rule it needs, and the work goes on with a follow-up `Continue` once the user changed the rule. The user answers in the task card of Dispatch, and the answer arrives as a follow-up `Answer to question N: <option>`.
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

/// The worker script. Setup writes it into the reports folder; triage runs it with PowerShell.
/// The prompt is the first argument of each `claude` command, because `--tools` and
/// `--allowedTools` take a list and would take a prompt that follows them as a list item.
const WORKER_SCRIPT: &str = r##"<#
Dispatch worker script. Triage starts and resumes a worker only through this file.
  plan <ticket-id>              start the plan run (plan-flags.txt); state: planning
  approve <ticket-id>           resume the same session for the work run (work-flags.txt); state: working
  reply <ticket-id> <message>   send the user's words to the worker; the state picks the options
  status                        the tasks with their state and the state of their worker
  stop <ticket-id>              stop the worker of a task; state: stopped
Exit codes: 0 done, 2 refused (the reason is on stderr), other: the exit code of claude.
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('plan', 'approve', 'reply', 'status', 'stop')]
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

# The options of a run, one argument per line. Setup pipeline writes the files.
function Read-Flags([string]$Name) {
  $file = Join-Path $Reports $Name
  if (-not (Test-Path -LiteralPath $file)) { Refuse "$file is missing; run Setup pipeline" }
  @(Get-Content -LiteralPath $file | Where-Object { $_.Trim() -ne '' })
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

# The newest worker of a ticket, of either run.
function Find-Worker($Workers, [string]$Ticket) {
  $names = @($Ticket, "$Ticket [plan]", "$Ticket [work]")
  $mine = @($Workers | Where-Object { $names -contains $_.name } | Sort-Object { $_.startedAt })
  if ($mine.Count -eq 0) { return $null }
  $mine[$mine.Count - 1]
}

# A resume of a session that still runs starts a copy of it. Only a finished session is resumed,
# and never one of a task that was stopped: a stopped task is ended, the next task starts clean.
function Resume-Target {
  if ((Get-State) -eq 'stopped') { Refuse "the task $Id was stopped; start a new task" }
  $worker = Find-Worker (Get-Workers) $Id
  if ($null -eq $worker) { Refuse "no worker named $Id" }
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
# with the exit code of claude; a claude that is not found counts as exit code 1.
function Run-Claude([string[]]$Arguments, [string]$StateOnFailure) {
  Push-Location -LiteralPath $Project
  $global:LASTEXITCODE = 0
  & claude @Arguments
  $ok = $?
  $code = $LASTEXITCODE
  Pop-Location
  if ($ok -and $code -eq 0) { return }
  if ($code -eq 0) { $code = 1 }
  if ($StateOnFailure) { Set-State $StateOnFailure }
  exit $code
}

switch ($Verb) {
  'plan' {
    Need-Id
    $brief = Join-Path $Reports "briefs\$Id.md"
    if (-not (Test-Path -LiteralPath $brief)) { Refuse "no brief at $brief" }
    $plans = Join-Path $Reports 'plans'
    if (-not (Test-Path -LiteralPath $plans)) { New-Item -ItemType Directory -Path $plans | Out-Null }
    $plan = Join-Path $plans "$Id.md"
    $flags = Read-Flags 'plan-flags.txt'
    $prompt = "Plan ticket $Id. Read the brief $brief. Write the plan to $plan with the sections that the section Background workers in CLAUDE.md names. Edit nothing. Then end your turn."
    Set-State 'planning'
    Run-Claude (@($prompt, '--bg', '--name', (Run-Name 'plan')) + $flags)
  }
  'approve' {
    Need-Id
    $plan = Join-Path $Reports "plans\$Id.md"
    if (-not (Test-Path -LiteralPath $plan)) { Refuse "no plan at $plan" }
    if (Test-Path -LiteralPath (Join-Path $Project '.git')) {
      # The task files in .dispatch do not count: Dispatch commits them itself, and triage can
      # write a brief at any time.
      $dirty = @(& git -C $Project status --porcelain -- . ':(exclude).dispatch')
      if ($dirty.Count -gt 0) { Refuse "the working tree of $Project has uncommitted changes; commit or stash them first (after Setup pipeline, these are the setup files: Commit to git in the Setup pipeline window):`n$($dirty -join "`n")" }
    }
    $worker = Resume-Target
    $flags = Read-Flags 'work-flags.txt'
    # The prompt names the report file: a worker planned with the paths of its plan run.
    $report = Join-Path $Reports "$Id.md"
    $prompt = "Plan approved: $plan. Execute it. A deviation goes into the report, not into the code. Write the report to $report."
    Set-State 'approved'
    # A resume with other options than the saved ones of the session starts a copy of it (Claude
    # Code 2.1.319). The name keeps the copy with the task and marks it as the work run: Dispatch and
    # this script find a worker by its name.
    Run-Claude (@($prompt, '--resume', $worker.sessionId, '--bg', '--name', (Run-Name 'work')) + $flags) 'planning'
    Set-State 'working'
  }
  'reply' {
    Need-Id
    # Windows PowerShell 5.1 does not escape a double quote in an argument of a native command, and
    # claude is a command file, so cmd.exe parses the line too. A quote becomes an apostrophe and a
    # line break a space, so the text can never cut or merge the arguments after it.
    $text = ((($Message -join ' ') -replace '"', "'") -replace "`r?`n", ' ').Trim()
    if (-not $text) { Refuse 'reply needs a message' }
    $worker = Resume-Target
    $run = if ((Get-State) -eq 'planning') { 'plan' } else { 'work' }
    $flags = Read-Flags "$run-flags.txt"
    Run-Claude (@($text, '--resume', $worker.sessionId, '--bg', '--name', (Run-Name $run)) + $flags)
  }
  'status' {
    $workers = Get-Workers
    Get-ChildItem -LiteralPath $Reports -Filter '*.state' | ForEach-Object {
      $ticket = $_.BaseName
      $state = (Get-Content -LiteralPath $_.FullName -Raw).Trim()
      "$ticket`t$state`t$(Worker-State (Find-Worker $workers $ticket))"
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
    Ok(RuleChanges {
        missing: project.allow_rules()?.into_iter().filter(|rule| !has(allow, rule)).collect(),
        obsolete,
        missing_deny: project.deny_rules().into_iter().filter(|rule| !has(deny, rule)).collect(),
        obsolete_deny: named_old(deny),
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
                && work_flags_current(project),
            detail: format!(
                "The folder .dispatch in the project for the task files: the reports of the workers, a folder for the briefs, a folder for the plans, and the state of each task. Git tracks it; Dispatch commits its files itself, and Approve does not count them as changes. The options of the two runs go into plan-flags.txt and work-flags.txt, one argument per line; the files start with the defaults (plan run: {} {}, work run: {} {}). The work run names its permission mode ({}) and its tool list, because a copy of the plan session keeps the options it does not name again; an older file gets these lines and the paths of this folder, its choice stays.{}",
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
            done: changes.none(),
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
    ];
    Ok(Plan { root: show(project.root.clone()), git: project.in_git, options, steps })
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
/// reports folder, which would reach a planner that had the tool.
fn plan_fixed_lines(project: &Project) -> Result<Vec<String>, String> {
    let plans = format!("{}/plans/**", project.rule_path()?);
    Ok(vec![
        "--permission-mode".to_string(),
        "dontAsk".to_string(),
        "--tools".to_string(),
        "Read,Grep,Glob,Bash,Write".to_string(),
        "--allowedTools".to_string(),
        format!("Bash(git status*),Bash(git log *),Bash(git diff *),Write({plans})"),
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

/// The fixed part of the work run. The work run is a copy of the plan session (Claude Code
/// 2.1.319), and the copy keeps every option of the plan run that the work run does not name
/// again: so the permission mode and the tool list are named here, or the work run would keep
/// `dontAsk` and the four read tools of the plan run and get every edit refused. `auto`: Claude
/// Code allows the edits and the usual commands itself and asks only for a command it judges
/// risky; that prompt blocks the worker until the user answers it in the agent view (user
/// decision 2026-11-08, over `bypassPermissions` with no prompt at all). No question tool: a
/// worker that asks in its session blocks, and a blocked session cannot be resumed without a
/// copy; a question goes into the report. No SendMessage: a worker sends no message to a chat
/// (cross-session messaging of Claude Code reaches triage and every other session of the user);
/// its questions and results reach the user only through the report and the Tasks card.
const WORK_FIXED_FLAGS: [&str; 6] = ["--permission-mode", "auto", "--tools", "default", "--disallowedTools", "AskUserQuestion,SendMessage"];

/// The work options file has the fixed part of this version. An older file lacks it.
/// A file that names the settings file of the workers must name the one of this project: a file
/// from the old layout names the folder `<project>-reports`.
fn work_flags_current(project: &Project) -> bool {
    let fixed = WORK_FIXED_FLAGS.join("\n");
    let Ok(text) = fs::read_to_string(project.work_flags()) else { return false };
    let text = text.replace("\r\n", "\n");
    let settings = project.worker_settings().to_string_lossy().replace('\\', "/");
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
        // The path has `/`. Thus each shell reads it the same.
        lines.push(file.to_string_lossy().replace('\\', "/"));
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
#[tauri::command(async)]
pub fn worker_flags(cwd: String) -> Result<WorkerFlags, String> {
    Ok(read_worker_flags(&Project::find(&cwd)?))
}

/// Writes the options of the plan run and of the work run, and the agent limit, to the files
/// that the script reads.
#[tauri::command(async)]
pub fn set_worker_flags(cwd: String, plan: Choice, work: Choice, agents: String) -> Result<(), String> {
    write_worker_flags(&Project::find(&cwd)?, &plan, &work, &agents)
}

/// The folder of the project of a folder: the top folder of the git repository, or the folder.
#[tauri::command(async)]
pub fn project_root(cwd: String) -> Result<ProjectRoot, String> {
    let project = Project::find(&cwd)?;
    Ok(ProjectRoot {
        root: project.root.to_string_lossy().into_owned(),
        git: project.in_git,
        triage_prompt: project.triage_prompt().is_file(),
        triage_stamp: project.triage_prompt_text().map(|text| stamp(&text)).unwrap_or_default(),
        triage_name: project.options().triage_name,
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
fn section_lines(text: &str, title: &str) -> Vec<String> {
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
fn parse_brief(text: &str) -> String {
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
    const HEADING: &str = "## User decisions";
    let crlf = plan.contains("\r\n");
    let mut kept: Vec<&str> = Vec::new();
    let mut skipping = false;
    for line in plan.lines() {
        if line.trim_start().starts_with("## ") {
            skipping = line.trim().eq_ignore_ascii_case(HEADING);
        }
        if !skipping {
            kept.push(line);
        }
    }
    while kept.last().is_some_and(|line| line.trim().is_empty()) {
        kept.pop();
    }
    let text = format!("{}\n\n{HEADING}\n\n{}\n", kept.join("\n"), body.trim());
    if crlf { text.replace('\n', "\r\n") } else { text }
}

/// Writes the decisions of the user into the plan of a task, before Approve starts its work run:
/// the work run reads the plan, so it takes them. Gives the new change time of the plan file in
/// milliseconds, so an automatic approval does not take the written plan for a new one.
#[tauri::command(async)]
pub fn task_decide(cwd: String, id: String, text: String) -> Result<u64, String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    let path = project.plans().join(format!("{id}.md"));
    let plan = fs::read_to_string(&path).map_err(|error| format!("no plan at {}: {error}", path.display()))?;
    write_file(&path, &with_user_decisions(&plan, &text))?;
    Ok(file_entry(&path).map_or(0, |entry| entry.modified))
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
}

/// The reply of the `task_list` command.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    tasks: Vec<TaskInfo>,
    /// The lines of `git status --porcelain` of the project. The script refuses an approval while
    /// the list is not empty, so the Approve button shows them as its reason.
    dirty: Vec<String>,
    /// The setting of the project: Dispatch approves a plan without a `HOLD` decision itself.
    auto_approve: bool,
    /// When the project got its Dispatch setup: the creation time of the task folder (or of its
    /// oldest state file, see `setup_time`), which the first Apply makes and a later one keeps, in milliseconds since the Unix epoch. The chat
    /// list folds the chats from before it.
    setup: Option<u64>,
    /// The planned entries of the project in their order (ticket overview-backlog).
    backlog: Vec<crate::backlog::Entry>,
}

/// The files with an extension in a folder: the name without the extension, the path, the entry.
fn files_with(dir: &Path, extension: &str) -> Vec<(String, PathBuf, FileEntry)> {
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
#[tauri::command(async)]
pub fn task_list(cwd: String) -> Result<TaskList, String> {
    let project = Project::find(&cwd)?;
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
        });
        tasks.len() - 1
    }
    for (name, path, _) in files_with(&project.reports, "state") {
        let at = task_at(&mut tasks, &name);
        tasks[at].state = fs::read_to_string(&path).unwrap_or_default().trim().to_string();
    }
    for (name, path, entry) in files_with(&project.plans(), "md") {
        let at = task_at(&mut tasks, &name);
        let text = fs::read_to_string(&path).unwrap_or_default();
        let (summary, hold) = parse_plan(&text);
        // The plan title is the "about" of a task whose brief does not give one.
        tasks[at].about = title_after_colon(&text);
        tasks[at].summary = summary;
        tasks[at].hold = hold;
        tasks[at].decisions = parse_decisions(&text);
        tasks[at].goal = section_lines(&text, "Goal");
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
    // A brief alone makes no task; a task that exists gets its brief.
    for task in tasks.iter_mut() {
        let path = project.briefs().join(format!("{}.md", task.name));
        let Some(entry) = file_entry(&path) else { continue };
        let text = fs::read_to_string(&path).unwrap_or_default();
        let about = parse_brief(&text);
        if !about.is_empty() {
            task.about = about;
        }
        task.words = section_lines(&text, "The user's words");
        task.brief = Some(entry);
    }
    // Dispatch commits the task files, but not while a work run may commit itself: a task approved
    // or working without a report. A failure (an index lock of a git command of the user, no git
    // identity) is logged, and the next task read tries again.
    let work_live = tasks.iter().any(|task| matches!(task.state.as_str(), "approved" | "working") && task.report.is_none());
    if !work_live {
        if let Err(error) = keep_tasks_committed(&project) {
            eprintln!("task files not committed: {error}");
        }
    }
    // The script refuses an approval for these lines; the task files do not count.
    let dirty = if project.in_git {
        git(&project.root, &["status", "--porcelain", "--", ".", NOT_TASKS]).unwrap_or_default().lines().map(str::to_string).collect()
    } else {
        Vec::new()
    };
    let setup = setup_time(&project);
    let backlog = crate::backlog::list(&project);
    Ok(TaskList { tasks, dirty, auto_approve: project.options().auto_approve, setup, backlog })
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
    if report_state == "done" && (needs.is_empty() || needs == "nothing") {
        return None;
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
#[tauri::command(async)]
pub fn triage_handoff(cwd: String, live: Vec<String>, queued: Vec<String>, tokens: u64) -> Result<String, String> {
    let project = Project::find(&cwd)?;
    let list = task_list(cwd)?;
    let reports = project.reports_text();
    Ok(handoff_text(&list.tasks, &live, &queued, tokens, &reports, &script_command(&reports)))
}

/// A ticket id is a file name and an argument of the script. Nothing else is accepted.
fn check_ticket(id: &str) -> Result<(), String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
        return Err(format!("invalid ticket id: {id}"));
    }
    Ok(())
}

/// Runs the worker script with a verb and its arguments. The script's exit code 2 is a refusal,
/// and its reason on stderr is the error; the output of claude is the result.
fn run_script(project: &Project, args: &[&str]) -> Result<String, String> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(project.script())
        .args(args)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
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
#[tauri::command(async)]
pub fn task_approve(cwd: String, id: String) -> Result<String, String> {
    check_ticket(&id)?;
    run_script(&Project::find(&cwd)?, &["approve", &id])
}

/// Sends the plan run back with the reason of the user: the Reject button of the task card.
#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn task_reply(cwd: String, id: String, text: String) -> Result<String, String> {
    check_ticket(&id)?;
    if text.trim().is_empty() {
        return Err("the reply is empty".to_string());
    }
    run_script(&Project::find(&cwd)?, &["reply", &id, text.trim()])
}

/// Stops the worker of a task: the Stop button of the task card. The script stops the newest
/// worker of the task and writes the state `stopped`; a stopped task cannot be resumed.
#[tauri::command(async)]
pub fn task_stop(cwd: String, id: String) -> Result<String, String> {
    check_ticket(&id)?;
    run_script(&Project::find(&cwd)?, &["stop", &id])
}

/// Gives the steps of the setup for the project of a folder. It changes nothing.
#[tauri::command(async)]
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
    }
    if !done(1) {
        add_rules(project)?;
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
    Ok(())
}

/// Does the steps that are not done. It makes no commit. `rules` gives the positions in `RULES`
/// of the checked working rules.
#[tauri::command(async)]
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
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("git did not start: {e}"))?;
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
    args.extend(files);
    let status = run_git(&project.root, &args)?;
    // A line of `--porcelain` is two status letters, a space and the path from the top folder.
    let changed: Vec<&str> =
        files.into_iter().filter(|file| status.lines().any(|line| line.get(3..).is_some_and(|path| path.trim_matches('"') == *file))).collect();
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

/// Commits the changes of the task files in `.dispatch` (briefs, plans, reports, state files,
/// the script and the options files), and no other file. The planned entries in
/// `.dispatch/backlog` keep their own commit. Other staged changes of the user stay staged.
/// Gives the number of changed files, 0 when there was nothing to commit or no git repository.
fn keep_tasks_committed(project: &Project) -> Result<usize, String> {
    if !project.in_git {
        return Ok(0);
    }
    // `--untracked-files=all`: a new folder shows its files, not only the folder.
    let status = run_git(&project.root, &["status", "--porcelain", "--untracked-files=all", "--", TASKS_DIR, NOT_BACKLOG])?;
    let changed = status.lines().filter(|line| !line.trim().is_empty()).count();
    if changed == 0 {
        return Ok(0);
    }
    run_git(&project.root, &["add", "--all", "--", TASKS_DIR, NOT_BACKLOG])?;
    let message = format!("Dispatch: {changed} task {}", if changed == 1 { "file" } else { "files" });
    // A commit with paths takes only these paths.
    run_git(&project.root, &["commit", "-m", &message, "--", TASKS_DIR, NOT_BACKLOG])?;
    Ok(changed)
}

/// Commits the setup files of the project of a folder on the current branch. It makes no push.
#[tauri::command(async)]
pub fn pipeline_commit(cwd: String) -> Result<String, String> {
    commit_setup(&Project::find(&cwd)?)
}

/// Saves the settings of the project of a folder. The steps then show what Apply must change.
#[tauri::command(async)]
pub fn set_project_options(cwd: String, options: Options) -> Result<Plan, String> {
    let project = Project::find(&cwd)?;
    let text = serde_json::to_string_pretty(&options).map_err(err)?;
    write_file(&project.options_file(), &format!("{text}\n"))?;
    plan(&project)
}

#[cfg(test)]
mod tests {
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

    /// Removes the scratch folders of a test that passed. A failed test keeps them for a look.
    fn clean(project: &Project) {
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
        clean(&project);
    }

    /// The fixed part of `work-flags.txt`, as lines.
    const WORK_FIXED: &str = "--permission-mode\nauto\n--tools\ndefault\n--disallowedTools\nAskUserQuestion,SendMessage\n";

    /// The expected text of `plan-flags.txt` for a choice: the choice lines, then the fixed part
    /// with the plans folder of this scratch project in its Write rule.
    fn plan_lines(project: &Project, choice_lines: &str) -> String {
        format!(
            "{choice_lines}--permission-mode\ndontAsk\n--tools\nRead,Grep,Glob,Bash,Write\n--allowedTools\nBash(git status*),Bash(git log *),Bash(git diff *),Write({}/plans/**)\n",
            project.rule_path().unwrap()
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
        assert!(read(&project.plan_flags()).contains("/proj/.dispatch/plans/**)\n"), "the Write rule names the plans folder");
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

        // The task files are in `.dispatch` of the project: the section, the rules, the role and
        // the plan options name that folder, and the script finds the project as its parent.
        let tasks = project.reports_text();
        assert!(tasks.ends_with("/proj/.dispatch"), "{tasks}");
        for path in ["/briefs/<ticket-id>.md", "/plans/<ticket-id>.md", "/<ticket-id>.md", "/<ticket-id>.state", "/worker.ps1 approve <ticket-id>"] {
            assert!(claude_md.contains(&format!("{tasks}{path}")), "{path} missing: {claude_md}");
        }
        assert!(claude_md.contains(&format!("uncommitted changes outside `{tasks}/`")), "{claude_md}");
        let rule_path = project.rule_path().unwrap();
        assert!(rule_path.ends_with("/proj/.dispatch"), "{rule_path}");
        let named: Vec<&&str> = allow.iter().filter(|rule| rule.contains("/proj/.dispatch/")).collect();
        assert_eq!(named.len(), 3, "the script, Edit and Read rules: {allow:?}");
        assert!(deny[0].contains("/proj/.dispatch/worker.ps1 approve *)"), "{deny:?}");
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

        apply(&project, &[]).unwrap();
        assert_eq!(read(&project.work_flags()), format!("--model\nsonnet\n{WORK_FIXED}--settings\n{settings}\n"));
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
        // A planned entry is no task either; the reply lists it apart.
        write_file(&project.backlog_dir().join("e-1.md"), "sent: 1\norder: 1\n\nplanned work\n").unwrap();

        let list = task_list(project.root.to_string_lossy().into_owned()).unwrap();
        let mut names: Vec<&str> = list.tasks.iter().map(|task| task.name.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["t-1", "t-2"]);
        assert_eq!(list.backlog.len(), 1);
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
        assert!(check_ticket("t-1").is_ok() && check_ticket("../t-1").is_err() && check_ticket("").is_err());
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
        clean(&project);
    }

    /// A fake `claude` command for the script: it records its arguments and its folder, answers
    /// `agents` with one worker `t-1` whose state the variable FAKE_STATE gives, and acts as the
    /// planner on a plan prompt: it writes the plan file the prompt names, as the real plan run
    /// does. With a file `fail.txt` next to it, a run (not `agents`) ends with the exit code in that file.
    fn fake_claude(base: &Path) -> PathBuf {
        let dir = base.join("fake-bin");
        write_file(&dir.join("claude.cmd"), "@node \"%~dp0fake-claude.js\" %*\r\n").unwrap();
        write_file(
            &dir.join("fake-claude.js"),
            "const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(__dirname + '/args.txt', JSON.stringify(args) + '\\n');
fs.writeFileSync(__dirname + '/cwd.txt', process.cwd());
if (args[0] === 'agents') {
  const worker = { id: 'bg-1', name: process.env.FAKE_NAME || 't-1', sessionId: 'sess-1', startedAt: 1, state: process.env.FAKE_STATE };
  if (process.env.FAKE_STATUS) worker.status = process.env.FAKE_STATUS;
  process.stdout.write(JSON.stringify([worker]));
} else if (fs.existsSync(__dirname + '/fail.txt')) {
  process.exit(Number(fs.readFileSync(__dirname + '/fail.txt', 'utf8')));
} else if (args[0] === 'stop') {
  process.stdout.write('stopped ' + args[1] + '\\n');
} else {
  const plan = /Write the plan to (.+?) with the sections/.exec(args[0]);
  if (plan) fs.writeFileSync(plan[1], 'plan\\n');
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
        serde_json::from_str(calls.lines().last().unwrap()).unwrap()
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
        assert_eq!(start.last().unwrap(), &format!("Bash(git status*),Bash(git log *),Bash(git diff *),Write({}/plans/**)", project.rule_path().unwrap()));

        // approve: refused while the worker runs or waits at a prompt, then resumed on the work options.
        let (code, out) = run_script(&project, &fake, "working", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("would start a copy"), "{out}");
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
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "working\n");
        let resume = last_call(&fake);
        assert!(resume[0].starts_with("Plan approved: "), "{resume:?}");
        // The name goes with the resume: a resume on other options starts a copy of the session.
        assert_eq!(&resume[1..], ["--resume", "sess-1", "--bg", "--name", "t-1 [work]", "--model", "opus", "--effort", "xhigh", "--permission-mode", "auto", "--tools", "default", "--disallowedTools", "AskUserQuestion,SendMessage"]);
        // claude runs in the project folder, whatever the folder of the caller is.
        assert_eq!(Path::new(read(&fake.join("cwd.txt")).trim()), project.root.as_path());

        // reply: the words of the user first; the state working picks the work options.
        let (code, out) = run_script(&project, &fake, "done", &["reply", "t-1", "yes, go on"]);
        assert_eq!(code, 0, "{out}");
        let reply = last_call(&fake);
        assert_eq!(reply[0], "yes, go on");
        assert_eq!(&reply[1..7], ["--resume", "sess-1", "--bg", "--name", "t-1 [work]", "--model"]);

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
        assert_eq!(count_files(&project.reports), before, "each file moved, none added");
        assert_eq!(read(&project.briefs().join("t-2.md")), "brief two\n");
        assert_eq!(read(&project.reports.join("t-1.state")), "working\n");
        // The options files keep the choice of the user and get the paths of this folder.
        assert_eq!(read(&project.plan_flags()), plan_lines(&project, "--model\nsonnet\n--effort\nhigh\n"));
        assert_eq!(read(&project.work_flags()), format!("--model\nopus\n{WORK_FIXED}--settings\n{}\n", project.worker_settings().to_string_lossy().replace('\\', "/")));
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
        assert_eq!(count_files(&project.reports), before + 1, "the moved files and the planned entry");
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

    /// Makes a git repository of a scratch project, with an identity and no global ignore file.
    fn git_scratch(name: &str) -> Project {
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
        write_file(&project.backlog_dir().join("e-1.md"), "sent: 1\norder: 1\n\nplanned\n").unwrap();

        let list = task_list(cwd.clone()).unwrap();
        assert!(list.dirty.iter().all(|line| !line.contains(".dispatch")), "{:?}", list.dirty);
        assert!(list.dirty.iter().any(|line| line == "A  staged.txt"), "{:?}", list.dirty);
        let subjects = git(&["log", "--format=%s"]);
        let subjects: Vec<&str> = subjects.lines().collect();
        // Newest first: the planned entry, then the task files with the script and the options files.
        assert_eq!(subjects.len(), 2, "{subjects:?}");
        assert!(subjects[0].starts_with("Backlog: "), "{subjects:?}");
        assert!(subjects[1].starts_with("Dispatch: ") && subjects[1].ends_with(" task files"), "{subjects:?}");
        let files = git(&["show", "--name-only", "--format=", "HEAD~1"]);
        let files: Vec<&str> = files.lines().filter(|line| !line.is_empty()).collect();
        assert!(files.iter().all(|file| file.starts_with(".dispatch/") && !file.starts_with(".dispatch/backlog/")), "{files:?}");
        for file in [".dispatch/briefs/t-1.md", ".dispatch/t-1.state", ".dispatch/plans/t-1.md", ".dispatch/worker.ps1"] {
            assert!(files.contains(&file), "{file} missing: {files:?}");
        }
        let status = git(&["status", "--porcelain"]);
        assert!(status.contains("A  staged.txt") && status.contains("?? CLAUDE.md") && !status.contains(".dispatch"), "{status}");

        // A work run without a report may commit itself: Dispatch waits.
        write_file(&project.reports.join("t-1.state"), "working\n").unwrap();
        task_list(cwd.clone()).unwrap();
        assert_eq!(git(&["log", "--format=%s"]).lines().count(), 2);
        assert!(git(&["status", "--porcelain", "--", ".dispatch"]).contains("t-1.state"));
        // The report is there: the next read commits.
        write_file(&project.reports.join("t-1.md"), "state: done\nneeds: nothing\n\ndone\n").unwrap();
        task_list(cwd.clone()).unwrap();
        assert_eq!(git(&["log", "-1", "--format=%s"]).trim(), "Dispatch: 2 task files");
        assert_eq!(git(&["status", "--porcelain", "--", ".dispatch"]), "");
        // Nothing changed: no empty commit.
        assert_eq!(keep_tasks_committed(&project), Ok(0));
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
        // A file of the user refuses the approval, and the reason names only that file.
        write_file(&root.join("user.txt"), "mine\n").unwrap();
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 2, "{out}");
        assert!(out.contains("uncommitted changes") && out.contains("user.txt") && !out.contains(".dispatch"), "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "planning\n");
        fs::remove_file(root.join("user.txt")).unwrap();
        // Only task files are uncommitted: the approval goes on, and the prompt names the report.
        let (code, out) = run_script(&project, &fake, "done", &["approve", "t-1"]);
        assert_eq!(code, 0, "{out}");
        assert_eq!(read(&project.reports.join("t-1.state")), "working\n");
        let resume = last_call(&fake);
        assert!(resume[0].contains("Write the report to ") && resume[0].ends_with("t-1.md."), "{resume:?}");
        // claude runs in the project folder: the parent of `.dispatch`.
        assert_eq!(Path::new(read(&fake.join("cwd.txt")).trim()), project.root.as_path());
        clean(&project);
    }
}
