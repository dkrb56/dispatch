//! Looks for a new version of the app in the releases of its GitHub repository.

use std::fs;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::err;
use crate::info::CREATE_NO_WINDOW;

/// The repository of the app. A public repository answers without a login, through the web API
/// with `curl.exe` (part of Windows 10 and 11). A private one answers only through the GitHub
/// command-line tool `gh`, with the login of the user; the app holds no token.
const REPOSITORY: &str = "dkrb56/dispatch";

/// The end of the name of the installer in a release.
const INSTALLER_END: &str = "-setup.exe";

/// GitHub refuses a request without a user agent. A plain name of the app, nothing of the user.
const USER_AGENT: &str = "dispatch-update-check";

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    assets: Vec<Asset>,
    /// The release came from the web API: its installer downloads without `gh`.
    #[serde(skip)]
    public: bool,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: Option<String>,
}

/// The reply of the `update_check` command.
#[derive(Serialize)]
pub struct Update {
    /// The version of this app.
    current: String,
    /// The version of the latest release. The repository can have no release.
    latest: Option<String>,
    /// The latest release is newer than this app and has an installer.
    newer: bool,
    /// Why the check gave no release: no network, or a private repository without `gh`.
    error: Option<String>,
}

fn run(program: &str, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("could not start {program}: {error}"))
}

/// The latest release from the web API. A private repository, and one without a release, give 404.
fn latest_public() -> Result<Option<Release>, String> {
    let url = format!("https://api.github.com/repos/{REPOSITORY}/releases/latest");
    let agent = format!("User-Agent: {USER_AGENT}");
    // The status comes on a line of its own after the body.
    let output = run("curl.exe", &["-sSL", "-H", "Accept: application/vnd.github+json", "-H", &agent, "-w", "\n%{http_code}", &url])?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let (body, status) = text.rsplit_once('\n').unwrap_or(("", text.as_ref()));
    match status.trim() {
        "200" => {
            let mut release: Release = serde_json::from_str(body).map_err(err)?;
            release.public = true;
            Ok(Some(release))
        }
        "404" => Ok(None),
        other => Err(format!("GitHub answered {other}")),
    }
}

/// The latest release through `gh`, for a private repository.
fn latest_gh() -> Result<Option<Release>, String> {
    let output = run("gh", &["api", &format!("repos/{REPOSITORY}/releases/latest")])?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        // The repository has no release.
        return if message.contains("HTTP 404") { Ok(None) } else { Err(message) };
    }
    serde_json::from_slice(&output.stdout).map(Some).map_err(err)
}

/// The latest release of the repository: from the web API, else through `gh`. GitHub answers 404
/// for a private repository as for one without a release; then only `gh` can tell.
fn latest() -> Result<Option<Release>, String> {
    match latest_public() {
        Ok(Some(release)) => Ok(Some(release)),
        public => latest_gh().map_err(|gh_error| match public {
            Err(error) => format!("{error}; {gh_error}"),
            _ => format!("GitHub shows no public release, and gh could not look further: {gh_error}"),
        }),
    }
}

/// The numbers of a version: `v0.2.1` gives 0, 2, 1.
fn numbers(version: &str) -> Vec<u64> {
    version
        .trim_start_matches('v')
        .split('.')
        .map_while(|part| part.parse().ok())
        .collect()
}

fn installer(release: &Release) -> Option<&Asset> {
    release
        .assets
        .iter()
        // The name becomes a file name. It must not have a folder.
        .find(|asset| asset.name.ends_with(INSTALLER_END) && Path::new(&asset.name).file_name().is_some_and(|file| file == asset.name.as_str()))
}

fn is_newer(app: &AppHandle, release: &Release) -> bool {
    installer(release).is_some() && numbers(&release.tag_name) > numbers(&app.package_info().version.to_string())
}

/// The version of this app and the latest release. A failed check gives the version and the error.
#[tauri::command(async)]
pub fn update_check(app: AppHandle) -> Update {
    let current = app.package_info().version.to_string();
    match latest() {
        Ok(release) => Update {
            current,
            newer: release.as_ref().is_some_and(|release| is_newer(&app, release)),
            latest: release.map(|release| release.tag_name.trim_start_matches('v').to_string()),
            error: None,
        },
        Err(error) => Update { current, newer: false, latest: None, error: Some(error) },
    }
}

/// Downloads the installer of the latest release and starts it. The installer asks the user
/// to close the app. Gives the version of the installer.
#[tauri::command(async)]
pub fn update_install(app: AppHandle) -> Result<String, String> {
    let release = latest()?.ok_or("the repository has no release")?;
    if !is_newer(&app, &release) {
        return Err("there is no new version".into());
    }
    let asset = installer(&release).ok_or("the release has no installer")?;
    let dir = std::env::temp_dir().join("dispatch-update");
    fs::create_dir_all(&dir).map_err(err)?;
    let file = dir.join(&asset.name);
    let output = match (&asset.browser_download_url, release.public) {
        (Some(url), true) => {
            let agent = format!("User-Agent: {USER_AGENT}");
            run("curl.exe", &["-sSLf", "-H", &agent, "-o", &file.to_string_lossy(), url])?
        }
        _ => run(
            "gh",
            &["release", "download", &release.tag_name, "--repo", REPOSITORY, "--pattern", &asset.name, "--dir", &dir.to_string_lossy(), "--clobber"],
        )?,
    };
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    // One step, no questions (Tauri's NSIS installer): `/P` shows only the progress bar and closes
    // the running app itself, `/UPDATE` skips the page that offers to uninstall the old version
    // first, `/R` starts the new version when it is done.
    let child = Command::new(&file).args(INSTALLER_ARGS).spawn().map_err(err)?;
    *INSTALLER.lock().map_err(err)? = Some(child);
    Ok(release.tag_name.trim_start_matches('v').to_string())
}

/// The switches of the installer for an update in one step.
const INSTALLER_ARGS: [&str; 3] = ["/P", "/UPDATE", "/R"];

/// The installer that `update_install` started. The app still runs after it ended when the user
/// cancelled it (or it failed); then the update buttons must work again.
static INSTALLER: Mutex<Option<Child>> = Mutex::new(None);

/// Whether the installer that the app started is still open.
#[tauri::command]
pub fn update_installer_open() -> bool {
    let Ok(mut installer) = INSTALLER.lock() else { return false };
    let open = installer.as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None)));
    if !open {
        *installer = None;
    }
    open
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_installer_counts_as_open_until_it_ends() {
        assert!(!update_installer_open(), "no installer was started");
        // A stand-in for the installer that ends by itself after about a second.
        let child = Command::new("ping").args(["-n", "2", "127.0.0.1"]).stdout(Stdio::null()).creation_flags(CREATE_NO_WINDOW).spawn().unwrap();
        *INSTALLER.lock().unwrap() = Some(child);
        assert!(update_installer_open());
        let ended = (0..50).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            !update_installer_open()
        });
        assert!(ended, "the closed installer is no longer open");
        assert!(INSTALLER.lock().unwrap().is_none());
    }
}
