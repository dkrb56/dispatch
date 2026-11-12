//! The calls of a window: the command name and the arguments exactly as the page gives them to
//! `invoke` (`commands.rs` of the app has the same list). The app gives the page the argument
//! names in camelCase: `new_text` is `newText`; the other names are one word.

use std::collections::HashMap;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use dispatch_lib::core::{backlog, chats, context, flow, info, pipeline, pty, rules, rules_check, status, store, Core};

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
            if clients.spawn(window, &id)? == Spawn::Attached {
                return json(());
            }
            let started = pty::pty_spawn(
                core,
                id.clone(),
                a.req("shell")?,
                a.opt("cwd")?,
                a.req("cols")?,
                a.req("rows")?,
                a.opt("resume")?,
                a.opt("attach")?,
                a.opt("run")?,
                a.opt("triage")?,
                a.opt("named")?,
                a.opt("model")?,
                a.opt("effort")?,
            );
            if started.is_err() {
                clients.spawn_failed(&id);
            }
            json(started?)
        }
        "pty_write" => {
            let id: String = a.req("id")?;
            clients.check_owner(window, &id)?;
            json(pty::pty_write(core, id, a.req("data")?)?)
        }
        "pty_resize" => {
            let id: String = a.req("id")?;
            clients.check_owner(window, &id)?;
            json(pty::pty_resize(core, id, a.req("cols")?, a.req("rows")?)?)
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
            let foreign = clients.foreign_terminals(window);
            let mut list = serde_json::to_value(chats::chat_list(core)).map_err(|e| e.to_string())?;
            for chat in list.as_array_mut().into_iter().flatten() {
                if chat.get("pane").and_then(Value::as_str).is_some_and(|pane| foreign.contains(pane)) {
                    chat["pane"] = Value::Null;
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
        "set_project_options" => json(pipeline::set_project_options(a.req("cwd")?, a.req("options")?)?),
        "set_measure_commands" => json(pipeline::set_measure_commands(a.req("cwd")?, a.req("text")?)?),
        "task_list" => json(pipeline::task_list(a.req("cwd")?)?),
        "backlog_add" => json(backlog::backlog_add(a.req("cwd")?, a.req("text")?)?),
        "backlog_remove" => json(backlog::backlog_remove(a.req("cwd")?, a.req("id")?)?),
        "backlog_reorder" => json(backlog::backlog_reorder(a.req("cwd")?, a.req("ids")?)?),
        "task_approve" => json(pipeline::task_approve(a.req("cwd")?, a.req("id")?)?),
        "task_decide" => json(pipeline::task_decide(a.req("cwd")?, a.req("id")?, a.req("text")?)?),
        "task_reject" => json(pipeline::task_reject(a.req("cwd")?, a.req("id")?, a.req("reason")?)?),
        "task_reply" => json(pipeline::task_reply(a.req("cwd")?, a.req("id")?, a.req("text")?)?),
        "task_stop" => json(pipeline::task_stop(a.req("cwd")?, a.req("id")?)?),
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
        "dir_list" => json(info::dir_list(core, a.opt("path")?)?),
        // The Nightmode switch and the triage chats that all windows share (remote-shared-state).
        "shared_load" => json(store::shared_load(core)?),
        "shared_set" => json(store::shared_set(core, a.opt("night")?, a.opt("triage")?)?),
        "driver_state" => json(serde_json::json!({ "driver": clients.driver_state(window, a.opt("active")?.unwrap_or(false)) })),
        other if WINDOW_ONLY.contains(&other) => Err("this command runs in the window, not on the host".into()),
        other => Err(format!("unknown command: {other}")),
    }
}
