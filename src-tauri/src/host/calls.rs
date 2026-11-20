//! The calls of a window: the command name and the arguments exactly as the page gives them to
//! `invoke` (`commands.rs` of the app has the same list, without `pty_join`, `pty_leave` and
//! `pty_find`: only a host has terminals of other windows). The app gives the page the argument
//! names in camelCase: `new_text` is `newText`; the other names are one word.

use std::collections::HashMap;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use dispatch_lib::core::{actions, builds, chats, context, flow, info, pipeline, plangroups, pty, rules, rules_check, status, store, tickets, tokens, Core};

use crate::clients::{Clients, Spawn};

/// The reply of a call.
pub enum Reply {
    Json(Value),
    /// The bytes of `file_read`, sent as a binary frame.
    Bytes(Vec<u8>),
}

/// The commands of the page that stay with the window (docs/remote-client.md, "What stays with
/// the window").
const WINDOW_ONLY: [&str; 8] =
    ["state_load", "state_save", "screen_save", "screen_load", "menu_record_save", "update_check", "update_install", "update_installer_open"];

struct Args<'a>(&'a Map<String, Value>);

impl Args<'_> {
    fn req<T: DeserializeOwned>(&self, key: &str) -> Result<T, String> {
        let value = self.0.get(key).filter(|value| !value.is_null()).ok_or_else(|| format!("missing argument: {key}"))?;
        T::deserialize(value).map_err(|e| format!("argument {key}: {e}"))
    }

    fn opt<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        match self.0.get(key) {
            None | Some(Value::Null) => Ok(None),
            Some(value) => T::deserialize(value).map(Some).map_err(|e| format!("argument {key}: {e}")),
        }
    }
}

fn json(value: impl Serialize) -> Result<Reply, String> {
    serde_json::to_value(value).map(Reply::Json).map_err(|e| e.to_string())
}

/// Runs the call `command` of `window` on the core. `body` is the binary frame of the call.
pub fn run(
    core: &Core,
    clients: &Clients,
    window: &str,
    command: &str,
    args: &Map<String, Value>,
    body: Option<&[u8]>,
) -> Result<Reply, String> {
    let a = Args(args);
    match command {
        "pty_spawn" => {
            let id: String = a.req("id")?;
            let label: Option<String> = a.opt("label")?;
            if clients.spawn(window, &id)? == Spawn::Attached {
                // The terminal keeps the size of its last pane, and the pane of the page can have
                // another size now (a restart or a reconnect): the page compares and resizes.
                return json(clients.size_of(&id).map(|(cols, rows)| serde_json::json!({ "cols": cols, "rows": rows })));
            }
            let (cols, rows): (u16, u16) = (a.req("cols")?, a.req("rows")?);
            let started = pty::pty_spawn(
                core,
                id.clone(),
                a.req("shell")?,
                a.opt("cwd")?,
                cols,
                rows,
                a.opt("resume")?,
                a.opt("attach")?,
                a.opt("run")?,
                a.opt("triage")?,
                a.opt("named")?,
                a.opt("model")?,
                a.opt("effort")?,
            );
            match &started {
                Ok(_) => {
                    clients.sized(&id, cols, rows);
                    if let Some(label) = &label {
                        clients.label(&id, label);
                    }
                }
                Err(_) => clients.spawn_failed(&id),
            }
            json(started?)
        }
        // A window shows the terminal of another window: the one triage chat of a project (ticket
        // why-are-there-two-chats). The reply is the size of the terminal.
        "pty_join" => {
            let (cols, rows) = clients.join(window, &a.req::<String>("id")?)?;
            json(serde_json::json!({ "cols": cols, "rows": rows }))
        }
        "pty_find" => json(clients.find(window, &a.req::<String>("label")?)),
        "pty_leave" => {
            clients.leave(window, &a.req::<String>("id")?);
            json(())
        }
        "pty_write" => {
            let id: String = a.req("id")?;
            clients.check_writer(window, &id)?;
            json(pty::pty_write(core, id, a.req("data")?)?)
        }
        "pty_resize" => {
            let id: String = a.req("id")?;
            clients.check_owner(window, &id)?;
            let (cols, rows): (u16, u16) = (a.req("cols")?, a.req("rows")?);
            let resized = pty::pty_resize(core, id.clone(), cols, rows)?;
            clients.sized(&id, cols, rows);
            json(resized)
        }
        "pty_kill" => {
            let id: String = a.req("id")?;
            clients.check_owner(window, &id)?;
            clients.killed(&id);
            json(pty::pty_kill(core, id))
        }
        "pane_info" => json(info::pane_info(core, a.req("id")?, a.opt("cwd")?)),
        "context_usage" => json(context::context_usage(a.req("cwd")?, a.req("session")?, a.opt("model")?)?),
        "pane_busy" => json(info::pane_busy(core, a.req("id")?)),
        "file_stat" => json(info::file_stat(a.opt("base")?, a.req("path")?)),
        "night_morning" => json(info::night_morning(a.req("root")?)),
        "night_state" => json(info::night_state(a.req("root")?)),
        "file_read" => info::file_read(a.req("path")?).map(Reply::Bytes),
        "image_save" => json(info::image_save(core, body.ok_or("the request has no image bytes")?)?),
        "chat_list" => {
            // The pane of a chat that runs in a terminal of another window is not the caller's.
            // `foreignPane` names that terminal: the caller can join it (why-are-there-two-chats).
            let foreign = clients.foreign_terminals(window);
            let mut list = serde_json::to_value(chats::chat_list(core)).map_err(|e| e.to_string())?;
            for chat in list.as_array_mut().into_iter().flatten() {
                let pane = chat.get("pane").and_then(Value::as_str).filter(|pane| foreign.contains(*pane)).map(str::to_string);
                if let Some(pane) = pane {
                    chat["pane"] = Value::Null;
                    chat["foreignPane"] = Value::String(pane);
                }
            }
            Ok(Reply::Json(list))
        }
        "chat_view" => {
            json(chats::chat_view(core, a.req("pane")?, a.opt("shown")?, a.opt("from")?, a.opt("fallback")?)?)
        }
        "session_flow" => json(flow::session_flow(core, a.req("session")?, a.req::<HashMap<String, u64>>("from")?)?),
        "worker_list" => json(chats::worker_list(core)?),
        "worker_end" => json(chats::end_session(a.req("id")?)?),
        "pipeline_plan" => json(pipeline::pipeline_plan(a.req("cwd")?)?),
        "pipeline_apply" => json(pipeline::pipeline_apply(a.req("cwd")?, a.req("rules")?)?),
        "pipeline_commit" => json(pipeline::pipeline_commit(a.req("cwd")?)?),
        "task_commit_preview" => json(pipeline::task_commit_preview(a.req("cwd")?, a.req("id")?)?),
        "git_state" => json(info::git_state(a.req("cwd")?)?),
        "git_file_diff" => json(info::git_file_diff(a.req("cwd")?, a.req("path")?, a.req("untracked")?)?),
        "git_commit" => json(info::git_commit(a.req("cwd")?, a.req("hash")?)?),
        "git_commit_diff" => json(info::git_commit_diff(a.req("cwd")?, a.req("hash")?, a.req("path")?, a.opt("old")?)?),
        "task_commit_message" => json(pipeline::task_commit_message(a.req("cwd")?, a.req("id")?, a.req("files")?)?),
        "task_commit" => json(pipeline::task_commit(a.req("cwd")?, a.req("id")?, a.req("message")?, a.req("files")?)?),
        "set_project_options" => json(pipeline::set_project_options(a.req("cwd")?, a.req("options")?)?),
        "set_paused" => json(pipeline::set_paused(a.req("cwd")?, a.req("on")?)?),
        "set_measure_commands" => json(pipeline::set_measure_commands(a.req("cwd")?, a.req("text")?)?),
        "set_merge_gate" => json(pipeline::set_merge_gate(a.req("cwd")?, a.req("text")?)?),
        "set_checks" => json(pipeline::set_checks(a.req("cwd")?, a.req("text")?)?),
        "set_checks_all" => json(pipeline::set_checks_all(a.req("cwd")?, a.req("text")?)?),
        "find_checks" => json(pipeline::find_checks(a.req("cwd")?, a.req("text")?)?),
        "task_list" => json(pipeline::task_list(a.req("cwd")?)?),
        "task_evidence" => json(pipeline::task_evidence(a.req("cwd")?, a.req("id")?)?),
        "ticket_add" => json(tickets::ticket_add_in(
            a.req("cwd")?,
            a.req("text")?,
            a.opt("kind")?,
            a.opt("level")?,
            a.opt("fields")?,
            a.opt("column")?,
        )?),
        "ticket_update" => json(tickets::ticket_update(
            a.req("cwd")?,
            a.req("id")?,
            a.opt("title")?,
            a.opt("kind")?,
            a.opt("task")?,
            a.opt("note")?,
            a.opt("level")?,
        )?),
        "ticket_move" => json(tickets::ticket_move(a.req("cwd")?, a.req("id")?, a.req("status")?, a.req("ids")?, a.opt("note")?)?),
        "ticket_claim" => json(tickets::ticket_claim(core, a.req("cwd")?, a.req("id")?, a.opt("release")?.unwrap_or(false))?),
        "ticket_move_all" => json(tickets::ticket_move_all(a.req("cwd")?, a.req("ids")?, a.req("status")?)?),
        "ticket_add_part" => json(tickets::ticket_add_part(
            a.req("cwd")?,
            a.req("parent")?,
            a.req("text")?,
            a.opt("title")?,
            a.opt("kind")?,
            a.opt("level")?,
            a.opt("fields")?,
        )?),
        "ticket_edit" => json(tickets::ticket_edit(
            a.req("cwd")?,
            a.req("id")?,
            a.opt("title")?,
            a.opt("summary")?,
            a.opt("kind")?,
            a.opt("level")?,
            a.opt("fields")?,
        )?),
        "ticket_parts" => json(tickets::ticket_parts(a.req("cwd")?, a.req("parent")?, a.req("ids")?)?),
        "ticket_night" => json(tickets::ticket_night(a.req("cwd")?, a.req("id")?, a.req("on")?)?),
        "ticket_chain" => json(pipeline::ticket_chain(a.req("cwd")?, a.req("id")?)?),
        "task_approve" => json(pipeline::task_approve(a.req("cwd")?, a.req("id")?)?),
        "task_approve_queue" => json(pipeline::task_approve_queue(a.req("cwd")?, a.req("id")?, a.req("decisions")?, a.req("checks")?, a.opt("model")?, a.opt("effort")?)?),
        "task_approve_cancel" => json(pipeline::task_approve_cancel(a.req("cwd")?, a.req("id")?)?),
        "ticket_plan" => json(pipeline::ticket_plan(a.req("cwd")?, a.req("id")?)?),
        "ticket_level_file" => json(pipeline::ticket_level_file(a.req("cwd")?, a.req("id")?)?),
        "task_work" => json(pipeline::task_work(a.req("cwd")?, a.req("id")?, a.req("model")?, a.req("effort")?)?),
        "ticket_adopt" => json(tickets::ticket_adopt(a.req("cwd")?, a.req("id")?)?),
        "plan_groups_load" => json(plangroups::plan_groups_load(a.req("cwd")?)?),
        "plan_groups_save" => json(plangroups::plan_groups_save(a.req("cwd")?, a.req("groups")?)?),
        "plan_confirm" => json(tickets::plan_confirm(a.req("cwd")?, a.req("arrows")?, a.req("queue")?, a.req("added")?)?),
        "task_decide" => json(pipeline::task_decide(a.req("cwd")?, a.req("id")?, a.req("text")?)?),
        "task_checks" => json(pipeline::task_checks(a.req("cwd")?, a.req("id")?, a.req("names")?)?),
        "task_pick_checks" => json(pipeline::task_pick_checks(a.req("cwd")?, a.req("id")?)?),
        "task_pick_choice" => json(pipeline::task_pick_choice(a.req("cwd")?, a.req("id")?, a.req("names")?)?),
        "task_run_checks" => json(pipeline::task_run_checks(a.req("cwd")?, a.req("id")?)?),
        "full_check_run" => json(pipeline::full_check_run(a.req("cwd")?, a.req("offset")?)?),
        "task_take_done" => json(pipeline::task_take_done(a.req("cwd")?, a.req("id")?)?),
        "task_reject" => json(pipeline::task_reject(a.req("cwd")?, a.req("id")?, a.req("reason")?)?),
        "task_reply" => json(pipeline::task_reply(a.req("cwd")?, a.req("id")?, a.req("text")?)?),
        "task_stop" => json(pipeline::task_stop(a.req("cwd")?, a.req("id")?)?),
        "task_resume" => json(pipeline::task_resume(a.req("cwd")?, a.req("id")?)?),
        "task_replan" => json(pipeline::task_replan(a.req("cwd")?, a.req("id")?)?),
        "task_merge" => json(pipeline::task_merge(a.req("cwd")?, a.req("id")?)?),
        "action_save" => json(actions::action_save(a.req("cwd")?, a.req("action")?)?),
        "action_delete" => json(actions::action_delete(a.req("cwd")?, a.req("id")?)?),
        "action_run" => json(actions::action_run(a.req("cwd")?, a.req("id")?)?),
        "action_step" => json(actions::action_step(a.req("cwd")?, a.req("run")?)?),
        "triage_handoff" => {
            json(pipeline::triage_handoff(a.req("cwd")?, a.req("live")?, a.req("queued")?, a.req("tokens")?)?)
        }
        "project_root" => json(pipeline::project_root(a.req("cwd")?)?),
        "worker_flags" => json(pipeline::worker_flags(a.req("cwd")?)?),
        "set_worker_flags" => {
            json(pipeline::set_worker_flags(a.req("cwd")?, a.req("plan")?, a.req("work")?, a.req("agents")?)?)
        }
        "project_rules" => json(rules::project_rules(core, a.req("cwd")?)?),
        "set_rule" => json(rules::set_rule(
            core,
            a.req("cwd")?,
            a.req("file")?,
            a.req("group")?,
            a.req("text")?,
            a.req("state")?,
        )?),
        "update_rule" => json(rules::update_rule(
            core,
            a.req("cwd")?,
            a.req("file")?,
            a.req("group")?,
            a.req("text")?,
            a.req("newText")?,
        )?),
        "check_rules" => json(rules_check::check_rules(
            core,
            a.req("cwd")?,
            a.req("scope")?,
            a.req("limit")?,
            a.req("model")?,
            a.req("effort")?,
        )?),
        "status_info" => json(status::status_info(core)),
        "usage_info" => json(status::usage_info(core)),
        "token_report" => json(tokens::token_report(a.req("cwd")?, a.req("since")?)?),
        "usage_history" => json(tokens::usage_history(core)),
        "build_folders" => json(builds::build_folders(a.req("cwd")?)?),
        "build_clean" => json(builds::build_clean(a.req("cwd")?)?),
        "dir_list" => json(info::dir_list(core, a.opt("path")?)?),
        // Night mode of each project and the triage chats that all windows share (remote-shared-state).
        "shared_load" => json(store::shared_load(core)?),
        "shared_set" => json(store::shared_set(core, a.opt("nights")?, a.opt("triage")?)?),
        // The open projects of each window: the phone page shows the union of the live windows.
        "workspaces_set" => json(store::workspaces_set(core, window, a.req("roots")?)?),
        "workspaces_get" => json(store::workspaces_get(core, &clients.live_windows())?),
        "driver_state" => json(serde_json::json!({ "driver": clients.driver_state(window, a.opt("active")?.unwrap_or(false)) })),
        other if WINDOW_ONLY.contains(&other) => Err("this command runs in the window, not on the host".into()),
        other => Err(format!("unknown command: {other}")),
    }
}
