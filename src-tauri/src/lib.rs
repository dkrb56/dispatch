//! The app: one window around the core. It builds the core with the folders of this computer and
//! the version of the app, hands the calls of the page to it (`commands`), and sends the events
//! of the core to the window.

pub mod core;
mod commands;

use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::{err, Core, EventSink};

/// Sends the events of the core to the window.
struct WindowSink(AppHandle);

impl EventSink for WindowSink {
    fn emit(&self, event: &str, payload: Value) {
        let _ = self.0.emit(event, payload);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    for name in core::pty::session_variables() {
        // SAFETY: no other thread runs at this time.
        unsafe { std::env::remove_var(name) };
    }
    #[cfg(not(windows))]
    core::pty::take_login_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::state_load,
            commands::state_save,
            commands::screen_save,
            commands::screen_load,
            commands::menu_record_save,
            commands::shared_load,
            commands::shared_set,
            commands::pane_info,
            commands::context_usage,
            commands::pane_busy,
            commands::file_stat,
            commands::night_morning,
            commands::night_state,
            commands::dir_list,
            commands::file_read,
            commands::image_save,
            commands::chat_list,
            commands::chat_view,
            commands::session_flow,
            commands::worker_list,
            commands::worker_end,
            commands::pipeline_plan,
            commands::pipeline_apply,
            commands::pipeline_commit,
            commands::task_commit_preview,
            commands::git_state,
            commands::git_file_diff,
            commands::task_commit_message,
            commands::task_commit,
            commands::set_project_options,
            commands::set_paused,
            commands::set_measure_commands,
            commands::set_merge_gate,
            commands::set_checks,
            commands::find_checks,
            commands::task_list,
            commands::task_evidence,
            commands::ticket_add,
            commands::ticket_update,
            commands::ticket_move,
            commands::ticket_claim,
            commands::ticket_move_all,
            commands::ticket_add_part,
            commands::ticket_edit,
            commands::ticket_parts,
            commands::ticket_night,
            commands::ticket_chain,
            commands::task_approve,
            commands::ticket_plan,
            commands::ticket_level_file,
            commands::task_work,
            commands::ticket_adopt,
            commands::task_decide,
            commands::task_checks,
            commands::task_take_done,
            commands::task_reject,
            commands::task_reply,
            commands::task_stop,
            commands::task_resume,
            commands::task_merge,
            commands::action_save,
            commands::action_delete,
            commands::action_run,
            commands::action_step,
            commands::triage_handoff,
            commands::project_root,
            commands::worker_flags,
            commands::set_worker_flags,
            commands::project_rules,
            commands::set_rule,
            commands::update_rule,
            commands::check_rules,
            commands::status_info,
            commands::usage_info,
            commands::token_report,
            commands::usage_history,
            commands::build_folders,
            commands::build_clean,
            commands::update_check,
            commands::update_install,
            commands::update_installer_open,
            commands::host_run_status,
            commands::host_run_start,
            commands::host_run_stop,
            commands::host_run_new_key,
            commands::host_run_autostart,
            commands::app_restart
        ])
        .setup(|app| {
            let core = Core::new(
                app.path().app_data_dir().map_err(err),
                app.path().home_dir().map_err(err),
                app.package_info().version.to_string(),
                Arc::new(WindowSink(app.handle().clone())),
            );
            app.manage(core);
            // A host that the update stopped starts again with the new version.
            if let Err(error) = core::hostrun::resume_after_update(&app.state::<Core>()) {
                eprintln!("the host did not start again after the update: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                core::pty::close_terminals(&app.state::<Core>());
            }
        });
}
