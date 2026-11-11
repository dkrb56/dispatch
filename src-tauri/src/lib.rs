mod backlog;
mod chats;
mod context;
mod flow;
mod info;
mod pipeline;
mod rules;
mod rules_check;
mod status;
mod update;

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

/// The cmd prompt reports the current folder with OSC 9;9 before the usual `path>` text.
#[cfg_attr(not(windows), allow(dead_code))]
const CMD_PROMPT: &str = "$E]9;9;$P$E\\$P$G";

/// Wraps the PowerShell prompt (the profile can define one) so that it reports the
/// current folder with OSC 9;9.
#[cfg_attr(not(windows), allow(dead_code))]
const POWERSHELL_INIT: &str = r#"
$global:__dispatch_prompt = $function:prompt
function global:prompt {
    $loc = $executionContext.SessionState.Path.CurrentLocation
    $osc = ''
    if ($loc.Provider.Name -eq 'FileSystem') {
        $osc = "$([char]27)]9;9;$($loc.ProviderPath)$([char]27)\"
    }
    $osc + (& $global:__dispatch_prompt)
}
"#;

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    /// The process id of the shell.
    pid: Option<u32>,
}

#[derive(Default)]
struct Sessions(Mutex<HashMap<String, Session>>);

#[derive(Serialize, Clone)]
struct Output<'a> {
    id: &'a str,
    data: String,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The start files of zsh in the folder `zsh` of the app data folder. Each one reads the file of the
/// same name of the user: in the home folder, or in the folder that the user's `.zshenv` names as
/// `ZDOTDIR`. `.zshrc` gives zsh back that folder (for `.zlogin` and for the shells of programs),
/// reports the current folder with OSC 9;9 before each prompt, and runs the start command of the
/// terminal once.
#[cfg(not(windows))]
const ZSH_FILES: [(&str, &str); 3] = [
    (
        ".zshenv",
        r#"__dispatch_zdotdir=$ZDOTDIR
ZDOTDIR=$HOME
[[ -f "$HOME/.zshenv" ]] && source "$HOME/.zshenv"
__dispatch_user=${ZDOTDIR:-$HOME}
ZDOTDIR=$__dispatch_zdotdir
"#,
    ),
    (".zprofile", "[[ -f \"$__dispatch_user/.zprofile\" ]] && source \"$__dispatch_user/.zprofile\"\n"),
    (
        ".zshrc",
        r#"if [[ "$__dispatch_user" == "$HOME" ]]; then unset ZDOTDIR; else ZDOTDIR=$__dispatch_user; fi
[[ -f "$__dispatch_user/.zshrc" ]] && source "$__dispatch_user/.zshrc"
__dispatch_osc() { printf '\e]9;9;%s\e\\' "$PWD"; }
autoload -Uz add-zsh-hook
add-zsh-hook precmd __dispatch_osc
if [[ -n "$DISPATCH_START" ]]; then
  __dispatch_start=$DISPATCH_START
  unset DISPATCH_START
  eval "$__dispatch_start"
  unset __dispatch_start
fi
"#,
    ),
];

/// The login shell of the user for a terminal, with the start command of the terminal. zsh (the
/// default of macOS) gets the start files of `ZSH_FILES`; another shell runs the start command
/// first and then itself, and reports no folder.
#[cfg(not(windows))]
fn login_shell(app: &AppHandle, start: &str) -> Result<CommandBuilder, String> {
    let shell = std::env::var("SHELL").ok().filter(|shell| !shell.is_empty()).unwrap_or_else(|| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    if Path::new(&shell).file_name().is_some_and(|name| name == "zsh") {
        let dir = data_dir(app)?.join("zsh");
        fs::create_dir_all(&dir).map_err(err)?;
        for (name, text) in ZSH_FILES {
            fs::write(dir.join(name), text).map_err(err)?;
        }
        cmd.arg("-l");
        cmd.env("ZDOTDIR", &dir);
        if !start.is_empty() {
            cmd.env("DISPATCH_START", start);
        }
    } else if start.is_empty() {
        cmd.arg("-l");
    } else {
        cmd.args(["-l", "-c", &format!("{start}; exec {shell} -l")]);
    }
    // An app from the Finder has no terminal type; the terminal of the app is xterm.js.
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    Ok(cmd)
}

/// An app that the Finder starts has only the system folders in its `PATH`. The login shell of
/// the user knows the folders of `claude`, `gh` and `git`; the app takes its `PATH` once at start.
#[cfg(not(windows))]
fn take_login_path() {
    let shell = std::env::var("SHELL").ok().filter(|shell| !shell.is_empty()).unwrap_or_else(|| "/bin/zsh".to_string());
    let Ok(output) = std::process::Command::new(&shell)
        .args(["-l", "-c", "echo $PATH"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
    else {
        return;
    };
    // The last line: a profile can print text before it.
    let text = String::from_utf8_lossy(&output.stdout);
    if let Some(path) = text.lines().map(str::trim).filter(|line| !line.is_empty()).last() {
        // SAFETY: no other thread runs at this time.
        unsafe { std::env::set_var("PATH", path) };
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
fn powershell_exe() -> &'static str {
    let has_pwsh = std::env::var_os("PATH")
        .is_some_and(|path| std::env::split_paths(&path).any(|dir| dir.join("pwsh.exe").is_file()));
    if has_pwsh {
        "pwsh.exe"
    } else {
        "powershell.exe"
    }
}

/// `-EncodedCommand` takes base64 of UTF-16LE text. It needs no quoting and no execution policy.
#[cfg_attr(not(windows), allow(dead_code))]
fn encode_powershell(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

/// Length of the prefix that does not end inside a multi-byte character.
fn utf8_cut(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Err(e) if e.error_len().is_none() => e.valid_up_to(),
        _ => bytes.len(),
    }
}

fn pump_output(mut reader: Box<dyn Read + Send>, app: AppHandle, id: String) {
    let mut buf = [0u8; 8192];
    let mut pending: Vec<u8> = Vec::new();
    loop {
        let n = match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => n,
        };
        pending.extend_from_slice(&buf[..n]);
        let cut = utf8_cut(&pending);
        if cut == 0 {
            continue;
        }
        // At the exit the output is only drained: closing a pseudo console on Windows 10 waits
        // until its last output is read, and an event needs the main thread, which closes it.
        if EXITING.load(Ordering::Relaxed) {
            pending.clear();
            continue;
        }
        let data = String::from_utf8_lossy(&pending[..cut]).into_owned();
        pending.drain(..cut);
        let _ = app.emit("pty-output", Output { id: &id, data });
    }
}

/// The effort levels that Claude Code accepts.
const EFFORTS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// The `--model` and `--effort` options of Claude Code for a model and an effort.
/// An empty value or no value gives no option: Claude Code then uses the settings of the user.
fn session_flags(model: Option<&str>, effort: Option<&str>) -> Result<String, String> {
    let mut flags = String::new();
    if let Some(model) = model.filter(|model| !model.is_empty()) {
        if !model.chars().all(|c| c.is_ascii_alphanumeric() || "-._[]".contains(c)) {
            return Err(format!("invalid model: {model}"));
        }
        flags.push_str(&format!(" --model {model}"));
    }
    if let Some(effort) = effort.filter(|effort| !effort.is_empty()) {
        if !EFFORTS.contains(&effort) {
            return Err(format!("invalid effort: {effort}"));
        }
        flags.push_str(&format!(" --effort {effort}"));
    }
    Ok(flags)
}

#[tauri::command]
fn pty_spawn(
    app: AppHandle,
    sessions: State<Sessions>,
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
    // `resume` is the id of a Claude Code chat. The shell then starts Claude Code with that chat.
    // `attach` is the id of a background session. The shell then opens that session.
    // `run` is one of two fixed commands: a new session, or the agent view.
    let start = match (resume, attach) {
        (None, None) => match run.as_deref() {
            None => String::new(),
            Some(command @ ("claude" | "claude agents")) => command.to_string(),
            Some(other) => return Err(format!("unknown start command: {other}")),
        },
        (Some(id), _) | (None, Some(id))
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') =>
        {
            return Err(format!("invalid chat id: {id}"));
        }
        (Some(id), _) => format!("claude --resume {id}"),
        (None, Some(id)) => format!("claude attach {id}"),
    };
    // The other parameters are for a new session and for a chat that continues.
    let mut start = start;
    if start == "claude" || start.starts_with("claude --resume ") {
        // `named` gives a new session the name that the chat list shows for triage.
        let name = if start == "claude" && named == Some(true) { " --name Triage" } else { "" };
        start.push_str(&session_flags(model.as_deref(), effort.as_deref())?);
        start.push_str(name);
        // `triage` gives the session the triage role from a file of the project.
        if triage == Some(true) {
            start.push_str(" --append-system-prompt-file .claude/triage.md");
        }
    }
    // The agent view lists the background sessions of all projects. With the folder of the
    // terminal, it lists only the sessions that started in that folder or below it.
    if start == "claude agents" {
        if let Some(dir) = cwd.as_deref().filter(|dir| std::path::Path::new(dir).is_dir()) {
            let quoted = if shell == "cmd" { format!("\"{dir}\"") } else { format!("'{}'", dir.replace('\'', "''")) };
            start.push_str(&format!(" --cwd {quoted}"));
        }
    }
    // Outside Windows both shell names of the frontend start the login shell of the user.
    #[cfg(not(windows))]
    let mut cmd = match shell.as_str() {
        "cmd" | "powershell" => login_shell(&app, &start)?,
        other => return Err(format!("unknown shell: {other}")),
    };
    #[cfg(windows)]
    let mut cmd = match shell.as_str() {
        "cmd" => {
            let mut cmd = CommandBuilder::new("cmd.exe");
            cmd.env("PROMPT", CMD_PROMPT);
            if !start.is_empty() {
                cmd.args(["/K", start.as_str()]);
            }
            cmd
        }
        "powershell" => {
            let mut cmd = CommandBuilder::new(powershell_exe());
            cmd.args(["-NoLogo", "-NoExit", "-EncodedCommand"]);
            cmd.arg(encode_powershell(&format!("{POWERSHELL_INIT}{start}")));
            cmd
        }
        other => return Err(format!("unknown shell: {other}")),
    };
    let dir = cwd
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .or_else(|| app.path().home_dir().ok());
    if let Some(dir) = dir {
        cmd.cwd(dir);
    }
    // Command-line tools then write file links as OSC 8 hyperlinks. The terminal opens them.
    cmd.env("FORCE_HYPERLINK", "1");

    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)?;
    let mut child = pair.slave.spawn_command(cmd).map_err(err)?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(err)?;
    let writer = pair.master.take_writer().map_err(err)?;
    let killer = child.clone_killer();
    let pid = child.process_id();
    sessions
        .0
        .lock()
        .unwrap()
        .insert(id.clone(), Session { master: pair.master, writer, killer, pid });

    let output_app = app.clone();
    let output_id = id.clone();
    std::thread::spawn(move || pump_output(reader, output_app, output_id));

    // ConPTY gives no end-of-file while the pseudo console is open. Wait for the shell,
    // then drop the session. That closes the pseudo console and stops the output thread.
    std::thread::spawn(move || {
        let _ = child.wait();
        // A page that loads again starts a new shell under the same id, which ends this one.
        // The session of the new shell stays, and the page gets no exit for it.
        let replaced = {
            let state = app.state::<Sessions>();
            let mut sessions = state.0.lock().unwrap();
            let replaced = sessions.get(&id).is_some_and(|session| session.pid != pid);
            if !replaced {
                sessions.remove(&id);
            }
            replaced
        };
        if !replaced {
            let _ = app.emit("pty-exit", &id);
        }
    });
    Ok(())
}

#[tauri::command]
fn pty_write(sessions: State<Sessions>, id: String, data: String) -> Result<(), String> {
    let mut sessions = sessions.0.lock().unwrap();
    let session = sessions.get_mut(&id).ok_or("no such terminal")?;
    session.writer.write_all(data.as_bytes()).map_err(err)?;
    session.writer.flush().map_err(err)
}

#[tauri::command]
fn pty_resize(sessions: State<Sessions>, id: String, cols: u16, rows: u16) -> Result<(), String> {
    let sessions = sessions.0.lock().unwrap();
    let session = sessions.get(&id).ok_or("no such terminal")?;
    session
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(err)
}

#[tauri::command]
fn pty_kill(sessions: State<Sessions>, id: String) {
    let session = sessions.0.lock().unwrap().remove(&id);
    if let Some(mut session) = session {
        let _ = session.killer.kill();
    }
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(dir.join("screens")).map_err(err)?;
    Ok(dir)
}

fn screen_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("invalid tab id: {id}"));
    }
    Ok(dir.join("screens").join(format!("{id}.txt")))
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

#[tauri::command]
fn state_load(app: AppHandle) -> Result<Value, String> {
    let dir = data_dir(&app)?;
    Ok(fs::read(dir.join("state.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null))
}

/// The frontend owns the layout format. `pane_ids` lists the open terminals.
#[tauri::command]
fn state_save(app: AppHandle, state: Value, pane_ids: Vec<String>) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let json = serde_json::to_vec_pretty(&state).map_err(err)?;
    write_atomic(&dir.join("state.json"), &json)?;

    // Remove the screen text of closed terminals.
    if let Ok(entries) = fs::read_dir(dir.join("screens")) {
        for path in entries.flatten().map(|entry| entry.path()) {
            let open = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(|stem| pane_ids.iter().any(|id| id == stem));
            if !open {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn screen_save(app: AppHandle, id: String, data: String) -> Result<(), String> {
    let dir = data_dir(&app)?;
    write_atomic(&screen_path(&dir, &id)?, data.as_bytes())
}

#[tauri::command]
fn screen_load(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let dir = data_dir(&app)?;
    Ok(fs::read_to_string(screen_path(&dir, &id)?).ok())
}

/// The variables that a Claude session gave to this app. With them, Claude Code in a terminal
/// runs as a child session: it saves no transcript and shows no colors.
/// A variable that the user saved in Windows is not in the list.
fn session_variables() -> Vec<String> {
    let names: Vec<String> = std::env::vars_os().filter_map(|(name, _)| name.into_string().ok()).collect();
    // Only a Claude session sets these two variables.
    let from_session = |name: &String| {
        name.eq_ignore_ascii_case("CLAUDECODE") || name.eq_ignore_ascii_case("CLAUDE_CODE_CHILD_SESSION")
    };
    if !names.iter().any(from_session) {
        return Vec::new();
    }
    // Other systems have no saved variables of the user to keep.
    #[cfg(not(windows))]
    let saved: Vec<String> = Vec::new();
    #[cfg(windows)]
    let saved: Vec<String> = saved_variables();
    names
        .into_iter()
        .filter(|name| {
            let upper = name.to_ascii_uppercase();
            (upper.starts_with("CLAUDE") || upper == "NO_COLOR") && !saved.contains(&upper)
        })
        .collect()
}

/// The names of the variables that the user saved in Windows (registry), in upper case.
#[cfg(windows)]
fn saved_variables() -> Vec<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    [
        (HKEY_CURRENT_USER, "Environment"),
        (HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"),
    ]
    .into_iter()
    .filter_map(|(root, path)| winreg::RegKey::predef(root).open_subkey(path).ok())
    .flat_map(|key| key.enum_values().flatten().map(|(name, _)| name.to_ascii_uppercase()).collect::<Vec<_>>())
    .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    for name in session_variables() {
        // SAFETY: no other thread runs at this time.
        unsafe { std::env::remove_var(name) };
    }
    #[cfg(not(windows))]
    take_login_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Sessions::default())
        .manage(info::Transcripts::default())
        .manage(info::GitCache::default())
        .manage(chats::ChatCache::default())
        .invoke_handler(tauri::generate_handler![
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            state_load,
            state_save,
            screen_save,
            screen_load,
            info::pane_info,
            context::context_usage,
            info::pane_busy,
            info::file_stat,
            info::night_morning,
            info::night_state,
            info::file_read,
            info::image_save,
            chats::chat_list,
            chats::chat_view,
            flow::session_flow,
            chats::worker_list,
            pipeline::pipeline_plan,
            pipeline::pipeline_apply,
            pipeline::pipeline_commit,
            pipeline::set_project_options,
            pipeline::task_list,
            backlog::backlog_add,
            backlog::backlog_remove,
            backlog::backlog_reorder,
            pipeline::task_approve,
            pipeline::task_decide,
            pipeline::task_reject,
            pipeline::task_reply,
            pipeline::task_stop,
            pipeline::triage_handoff,
            pipeline::project_root,
            pipeline::worker_flags,
            pipeline::set_worker_flags,
            rules::project_rules,
            rules::set_rule,
            rules::update_rule,
            rules_check::check_rules,
            status::status_info,
            status::usage_info,
            update::update_check,
            update::update_install,
            update::update_installer_open
        ])
        .setup(|app| {
            // The same folder as `image_save` uses. Setup pipeline lets triage read it.
            if let Ok(dir) = app.path().app_data_dir() {
                let _ = pipeline::PASTED_DIR.set(dir.join("pasted"));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                close_terminals(app);
            }
        });
}

/// Ends every terminal of the app: its shell, then its pseudo console. Without this, the exit of
/// the app left each pseudo console's host (`conhost.exe --headless`) running with nothing in it,
/// and such a host can keep a CPU core busy (measured 2026-11-09: dozens of them at 2-6 % each).
fn close_terminals(app: &AppHandle) {
    EXITING.store(true, Ordering::Relaxed);
    let mut sessions = std::mem::take(&mut *app.state::<Sessions>().0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()));
    // Every shell first: a close below that waits must not keep the other shells alive.
    for session in sessions.values_mut() {
        let _ = session.killer.kill();
    }
    // Dropping a master closes its pseudo console (ClosePseudoConsole), which ends its host. That
    // can wait for the host forever (measured 2026-11-09: two of three hosts, their shells already
    // ended), so the app waits at most `CLOSE_WAIT` and then ends the hosts that are still there.
    let (done, finished) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        drop(sessions);
        let _ = done.send(());
    });
    if finished.recv_timeout(CLOSE_WAIT).is_err() {
        info::end_own_console_hosts();
    }
}

/// The app exits: the readers of the terminals only drain their output.
static EXITING: AtomicBool = AtomicBool::new(false);
/// How long the exit waits for the pseudo consoles to close.
const CLOSE_WAIT: Duration = Duration::from_millis(1500);
