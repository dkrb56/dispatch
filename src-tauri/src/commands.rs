//! The commands of the page. Each one hands its call to the function of the same name in the core
//! and gives the reply back. The names, the arguments and the replies are the contract with the
//! page; they do not change here.

use std::collections::HashMap;

use serde_json::{Map, Value};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, State};

use crate::core::tickets::{self, Ticket, TicketFields};
use crate::core::actions::{self, Action, ActionList, ActionRun};
use crate::core::builds::{self, BuildFolders, CleanResult};
use crate::core::chats::{self, Chat, ChatView, Worker};
use crate::core::context::{self, ContextUsage};
use crate::core::flow::{self, FlowFile};
use crate::core::info::{self, DirList, FileEntry, GitState, PaneInfo};
use crate::core::pipeline::{self, Choice, Options, Plan, ProjectRoot, TaskCommitPreview, TaskList, WorkerFlags};
use crate::core::rules::{self, Rules};
use crate::core::rules_check::{self, RulesCheck};
use crate::core::status::{self, StatusInfo, UsageInfo};
use crate::core::tokens::{self, TokenReport, UsageHistory};
use crate::core::update::{self, Update};
use crate::core::hostrun::{self, HostRun};
use crate::core::{pty, store, Core};

#[tauri::command]
pub fn pty_spawn(
    core: State<Core>,
    id: String,
    shell: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
    resume: Option<String>,
    attach: Option<String>,
    run: Option<String>,
    triage: Option<bool>,
    named: Option<bool>,
    model: Option<String>,
    effort: Option<String>,
) -> Result<(), String> {
    pty::pty_spawn(&core, id, shell, cwd, cols, rows, resume, attach, run, triage, named, model, effort)
}

#[tauri::command]
pub fn pty_write(core: State<Core>, id: String, data: String) -> Result<(), String> {
    pty::pty_write(&core, id, data)
}

#[tauri::command]
pub fn pty_resize(core: State<Core>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    pty::pty_resize(&core, id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(core: State<Core>, id: String) {
    pty::pty_kill(&core, id)
}

#[tauri::command]
pub fn state_load(core: State<Core>) -> Result<Value, String> {
    store::state_load(&core)
}

#[tauri::command]
pub fn state_save(core: State<Core>, state: Value, pane_ids: Vec<String>) -> Result<(), String> {
    store::state_save(&core, state, pane_ids)
}

#[tauri::command]
pub fn screen_save(core: State<Core>, id: String, data: String) -> Result<(), String> {
    store::screen_save(&core, id, data)
}

#[tauri::command]
pub fn screen_load(core: State<Core>, id: String) -> Result<Option<String>, String> {
    store::screen_load(&core, id)
}

#[tauri::command]
pub fn menu_record_save(core: State<Core>, name: String, data: String) -> Result<(), String> {
    store::menu_record_save(&core, name, data)
}

#[tauri::command]
pub fn shared_load(core: State<Core>) -> Result<Value, String> {
    store::shared_load(&core)
}

#[tauri::command]
pub fn shared_set(core: State<Core>, night: Option<bool>, triage: Option<Map<String, Value>>) -> Result<Value, String> {
    store::shared_set(&core, night, triage)
}

#[tauri::command(async)]
pub fn pane_info(core: State<Core>, id: String, cwd: Option<String>) -> PaneInfo {
    info::pane_info(&core, id, cwd)
}

#[tauri::command(async)]
pub fn context_usage(cwd: String, session: String, model: Option<String>) -> Result<ContextUsage, String> {
    context::context_usage(cwd, session, model)
}

#[tauri::command]
pub fn pane_busy(core: State<Core>, id: String) -> bool {
    info::pane_busy(&core, id)
}

#[tauri::command]
pub fn file_stat(base: Option<String>, path: String) -> Option<FileEntry> {
    info::file_stat(base, path)
}

/// The folders of a folder of this PC for the folder chooser of the page in the mode "This PC and
/// hosts" (ticket remote-mixed-mode); the host has the same call.
#[tauri::command(async)]
pub fn dir_list(core: State<Core>, path: Option<String>) -> Result<DirList, String> {
    info::dir_list(&core, path)
}

#[tauri::command]
pub fn night_morning(root: String) -> Option<FileEntry> {
    info::night_morning(root)
}

#[tauri::command]
pub fn night_state(root: String) -> Option<bool> {
    info::night_state(root)
}

#[tauri::command(async)]
pub fn file_read(path: String) -> Result<Response, String> {
    info::file_read(path).map(Response::new)
}

/// The body of the request is the image file.
#[tauri::command]
pub fn image_save(core: State<Core>, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("the request has no image bytes".into());
    };
    info::image_save(&core, bytes)
}

#[tauri::command(async)]
pub fn chat_list(core: State<Core>) -> Vec<Chat> {
    chats::chat_list(&core)
}

#[tauri::command(async)]
pub fn chat_view(
    core: State<Core>,
    pane: String,
    shown: Option<String>,
    from: Option<u64>,
    fallback: Option<String>,
) -> Result<ChatView, String> {
    chats::chat_view(&core, pane, shown, from, fallback)
}

#[tauri::command(async)]
pub fn session_flow(core: State<Core>, session: String, from: HashMap<String, u64>) -> Result<Vec<FlowFile>, String> {
    flow::session_flow(&core, session, from)
}

#[tauri::command(async)]
pub fn worker_list(core: State<Core>) -> Result<Vec<Worker>, String> {
    chats::worker_list(&core)
}

#[tauri::command(async)]
pub fn worker_end(id: String) -> Result<String, String> {
    chats::end_session(id)
}

#[tauri::command(async)]
pub fn pipeline_plan(cwd: String) -> Result<Plan, String> {
    pipeline::pipeline_plan(cwd)
}

#[tauri::command(async)]
pub fn pipeline_apply(cwd: String, rules: Vec<usize>) -> Result<Plan, String> {
    pipeline::pipeline_apply(cwd, rules)
}

#[tauri::command(async)]
pub fn pipeline_commit(cwd: String) -> Result<String, String> {
    pipeline::pipeline_commit(cwd)
}

#[tauri::command(async)]
pub fn task_commit_preview(cwd: String, id: String) -> Result<TaskCommitPreview, String> {
    pipeline::task_commit_preview(cwd, id)
}

#[tauri::command(async)]
pub fn git_state(cwd: String) -> Result<GitState, String> {
    info::git_state(cwd)
}

#[tauri::command(async)]
pub fn git_file_diff(cwd: String, path: String, untracked: bool) -> Result<String, String> {
    info::git_file_diff(cwd, path, untracked)
}

#[tauri::command(async)]
pub fn task_commit_message(cwd: String, id: String, files: Vec<String>) -> Result<String, String> {
    pipeline::task_commit_message(cwd, id, files)
}

#[tauri::command(async)]
pub fn task_commit(cwd: String, id: String, message: String, files: Vec<String>) -> Result<String, String> {
    pipeline::task_commit(cwd, id, message, files)
}

#[tauri::command(async)]
pub fn set_project_options(cwd: String, options: Options) -> Result<Plan, String> {
    pipeline::set_project_options(cwd, options)
}

#[tauri::command(async)]
pub fn set_paused(cwd: String, on: bool) -> Result<bool, String> {
    pipeline::set_paused(cwd, on)
}

#[tauri::command(async)]
pub fn set_measure_commands(cwd: String, text: String) -> Result<Plan, String> {
    pipeline::set_measure_commands(cwd, text)
}

#[tauri::command(async)]
pub fn set_merge_gate(cwd: String, text: String) -> Result<Plan, String> {
    pipeline::set_merge_gate(cwd, text)
}

#[tauri::command(async)]
pub fn set_checks(cwd: String, text: String) -> Result<Plan, String> {
    pipeline::set_checks(cwd, text)
}

#[tauri::command(async)]
pub fn find_checks(cwd: String, text: String) -> Result<Plan, String> {
    pipeline::find_checks(cwd, text)
}

#[tauri::command(async)]
pub fn task_list(cwd: String) -> Result<TaskList, String> {
    pipeline::task_list(cwd)
}

#[tauri::command(async)]
pub fn task_evidence(cwd: String, id: String) -> Result<Vec<flow::Evidence>, String> {
    pipeline::task_evidence(cwd, id)
}

#[tauri::command(async)]
pub fn ticket_add(
    cwd: String,
    text: String,
    kind: Option<String>,
    level: Option<String>,
    fields: Option<TicketFields>,
    column: Option<String>,
) -> Result<Ticket, String> {
    tickets::ticket_add_in(cwd, text, kind, level, fields, column)
}

#[tauri::command(async)]
pub fn ticket_update(
    cwd: String,
    id: String,
    title: Option<String>,
    kind: Option<String>,
    task: Option<String>,
    note: Option<String>,
    level: Option<String>,
) -> Result<Ticket, String> {
    tickets::ticket_update(cwd, id, title, kind, task, note, level)
}

#[tauri::command(async)]
pub fn ticket_move(cwd: String, id: String, status: String, ids: Vec<String>, note: Option<String>) -> Result<Vec<Ticket>, String> {
    tickets::ticket_move(cwd, id, status, ids, note)
}

#[tauri::command(async)]
pub fn ticket_claim(core: State<Core>, cwd: String, id: String, release: bool) -> Result<bool, String> {
    tickets::ticket_claim(&core, cwd, id, release)
}

#[tauri::command(async)]
pub fn ticket_move_all(cwd: String, ids: Vec<String>, status: String) -> Result<Vec<Ticket>, String> {
    tickets::ticket_move_all(cwd, ids, status)
}

/// A part at the end of the chain of a parent, in Backlog (ticket subtickets).
#[tauri::command(async)]
pub fn ticket_add_part(
    cwd: String,
    parent: String,
    text: String,
    title: Option<String>,
    kind: Option<String>,
    level: Option<String>,
    fields: Option<TicketFields>,
) -> Result<Ticket, String> {
    tickets::ticket_add_part(cwd, parent, text, title, kind, level, fields)
}

/// Changes a part that waits in Backlog (ticket subtickets).
#[tauri::command(async)]
pub fn ticket_edit(
    cwd: String,
    id: String,
    title: Option<String>,
    summary: Option<String>,
    kind: Option<String>,
    level: Option<String>,
    fields: Option<TicketFields>,
) -> Result<Ticket, String> {
    tickets::ticket_edit(cwd, id, title, summary, kind, level, fields)
}

/// The new order of the parts of a parent in Backlog (ticket subtickets).
#[tauri::command(async)]
pub fn ticket_parts(cwd: String, parent: String, ids: Vec<String>) -> Result<Vec<Ticket>, String> {
    tickets::ticket_parts(cwd, parent, ids)
}

/// The night box of a parent (ticket subtickets, user decision 1).
#[tauri::command(async)]
pub fn ticket_night(cwd: String, id: String, on: bool) -> Result<Ticket, String> {
    tickets::ticket_night(cwd, id, on)
}

/// The chain of a part for the message to triage (ticket subtickets).
#[tauri::command(async)]
pub fn ticket_chain(cwd: String, id: String) -> Result<Vec<String>, String> {
    pipeline::ticket_chain(cwd, id)
}

#[tauri::command(async)]
pub fn task_approve(cwd: String, id: String) -> Result<String, String> {
    pipeline::task_approve(cwd, id)
}

/// Opens a ticket in In progress for a running task without one (ticket board-in-progress).
#[tauri::command(async)]
pub fn ticket_adopt(cwd: String, id: String) -> Result<Ticket, String> {
    tickets::ticket_adopt(cwd, id)
}

/// Starts the plan run of a New ticket without triage (ticket simpler-process-tickets).
#[tauri::command(async)]
pub fn ticket_plan(cwd: String, id: String) -> Result<String, String> {
    pipeline::ticket_plan(cwd, id)
}

/// Writes the plan model of the level of a ticket before it goes to triage (ticket ticket-form-optional-fields-on-a-new).
#[tauri::command(async)]
pub fn ticket_level_file(cwd: String, id: String) -> Result<(), String> {
    pipeline::ticket_level_file(cwd, id)
}

/// Writes the model and the effort of the work run of a task before Approve (ticket ticket-form-optional-fields-on-a-new).
#[tauri::command(async)]
pub fn task_work(cwd: String, id: String, model: String, effort: String) -> Result<(), String> {
    pipeline::task_work(cwd, id, model, effort)
}

#[tauri::command(async)]
pub fn task_decide(cwd: String, id: String, text: String) -> Result<u64, String> {
    pipeline::task_decide(cwd, id, text)
}

#[tauri::command(async)]
pub fn task_checks(cwd: String, id: String, names: Vec<String>) -> Result<u64, String> {
    pipeline::task_checks(cwd, id, names)
}

#[tauri::command(async)]
pub fn task_take_done(cwd: String, id: String) -> Result<u64, String> {
    pipeline::task_take_done(cwd, id)
}

#[tauri::command(async)]
pub fn task_reject(cwd: String, id: String, reason: String) -> Result<String, String> {
    pipeline::task_reject(cwd, id, reason)
}

#[tauri::command(async)]
pub fn task_reply(cwd: String, id: String, text: String) -> Result<String, String> {
    pipeline::task_reply(cwd, id, text)
}

#[tauri::command(async)]
pub fn task_stop(cwd: String, id: String) -> Result<String, String> {
    pipeline::task_stop(cwd, id)
}

#[tauri::command(async)]
pub fn task_resume(cwd: String, id: String) -> Result<String, String> {
    pipeline::task_resume(cwd, id)
}

#[tauri::command(async)]
pub fn task_merge(cwd: String, id: String) -> Result<String, String> {
    pipeline::task_merge(cwd, id)
}

#[tauri::command(async)]
pub fn action_save(cwd: String, action: Action) -> Result<ActionList, String> {
    actions::action_save(cwd, action)
}

#[tauri::command(async)]
pub fn action_delete(cwd: String, id: String) -> Result<ActionList, String> {
    actions::action_delete(cwd, id)
}

#[tauri::command(async)]
pub fn action_run(cwd: String, id: String) -> Result<ActionRun, String> {
    actions::action_run(cwd, id)
}

#[tauri::command(async)]
pub fn action_step(cwd: String, run: String) -> Result<ActionRun, String> {
    actions::action_step(cwd, run)
}

#[tauri::command(async)]
pub fn triage_handoff(cwd: String, live: Vec<String>, queued: Vec<String>, tokens: u64) -> Result<String, String> {
    pipeline::triage_handoff(cwd, live, queued, tokens)
}

#[tauri::command(async)]
pub fn project_root(cwd: String) -> Result<ProjectRoot, String> {
    pipeline::project_root(cwd)
}

#[tauri::command(async)]
pub fn worker_flags(cwd: String) -> Result<WorkerFlags, String> {
    pipeline::worker_flags(cwd)
}

#[tauri::command(async)]
pub fn set_worker_flags(cwd: String, plan: Choice, work: Choice, agents: String) -> Result<(), String> {
    pipeline::set_worker_flags(cwd, plan, work, agents)
}

#[tauri::command(async)]
pub fn project_rules(core: State<Core>, cwd: String) -> Result<Rules, String> {
    rules::project_rules(&core, cwd)
}

#[tauri::command(async)]
pub fn set_rule(core: State<Core>, cwd: String, file: String, group: String, text: String, state: String) -> Result<Rules, String> {
    rules::set_rule(&core, cwd, file, group, text, state)
}

#[tauri::command(async)]
pub fn update_rule(core: State<Core>, cwd: String, file: String, group: String, text: String, new_text: String) -> Result<Rules, String> {
    rules::update_rule(&core, cwd, file, group, text, new_text)
}

#[tauri::command(async)]
pub fn check_rules(core: State<Core>, cwd: String, scope: String, limit: u64, model: String, effort: String) -> Result<RulesCheck, String> {
    rules_check::check_rules(&core, cwd, scope, limit, model, effort)
}

#[tauri::command(async)]
pub fn status_info(core: State<Core>) -> StatusInfo {
    status::status_info(&core)
}

#[tauri::command(async)]
pub fn usage_info(core: State<Core>) -> UsageInfo {
    status::usage_info(&core)
}

/// The tokens of a project since `since` for the window Token usage (ticket token-usage).
#[tauri::command(async)]
pub fn token_report(cwd: String, since: u64) -> Result<TokenReport, String> {
    tokens::token_report(cwd, since)
}

/// The history of the weekly allowance of this computer (ticket token-usage).
#[tauri::command(async)]
pub fn usage_history(core: State<Core>) -> UsageHistory {
    tokens::usage_history(&core)
}

/// The cargo build folders of a project with their sizes (ticket proof-target-cleanup).
#[tauri::command(async)]
pub fn build_folders(cwd: String) -> Result<BuildFolders, String> {
    builds::build_folders(cwd)
}

/// Deletes the proof builds and the incremental caches of a project (ticket proof-target-cleanup).
#[tauri::command(async)]
pub fn build_clean(cwd: String) -> Result<CleanResult, String> {
    builds::build_clean(cwd)
}

#[tauri::command(async)]
pub fn update_check(core: State<Core>) -> Update {
    update::update_check(&core)
}

#[tauri::command(async)]
pub fn update_install(core: State<Core>) -> Result<String, String> {
    update::update_install(&core)
}

#[tauri::command]
pub fn update_installer_open() -> bool {
    update::update_installer_open()
}

#[tauri::command(async)]
pub fn host_run_status(core: State<Core>) -> HostRun {
    hostrun::host_run_status(&core)
}

#[tauri::command(async)]
pub fn host_run_start(core: State<Core>, port: Option<u16>) -> Result<HostRun, String> {
    hostrun::host_run_start(&core, port)
}

#[tauri::command(async)]
pub fn host_run_stop(core: State<Core>) -> Result<HostRun, String> {
    hostrun::host_run_stop(&core)
}

#[tauri::command(async)]
pub fn host_run_new_key(core: State<Core>, port: Option<u16>) -> Result<HostRun, String> {
    hostrun::host_run_new_key(&core, port)
}

#[tauri::command(async)]
pub fn host_run_autostart(core: State<Core>, on: bool, port: Option<u16>) -> Result<HostRun, String> {
    hostrun::host_run_autostart(&core, on, port)
}

/// Ends the app the usual way (the terminals close, the window state is saved) and starts it again.
#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.request_restart();
}
