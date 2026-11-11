//! Looks for a new version of the app in the releases of its GitHub repository.

use std::fs;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use crate::core::{err, Core};
use crate::core::info::NoWindow;

/// The repository of the app. A public repository answers without a login, through the web API
/// with `curl` (part of Windows 10 and 11, and of macOS). A private one answers only through the
/// GitHub command-line tool `gh`, with the login of the user; the app holds no token.
const REPOSITORY: &str = "dkrb56/dispatch";

/// The program that fetches the web API and the installer.
#[cfg(windows)]
const CURL: &str = "curl.exe";
#[cfg(not(windows))]
const CURL: &str = "curl";

/// The end of the name of the installer in a release for this system: the NSIS installer on
/// Windows, the disk image on macOS.
fn installer_end() -> &'static str {
    if cfg!(windows) { "-setup.exe" } else { ".dmg" }
}

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
        .no_window()
        .output()
        .map_err(|error| format!("could not start {program}: {error}"))
}

/// The latest release from the web API. A private repository, and one without a release, give 404.
fn latest_public() -> Result<Option<Release>, String> {
    let url = format!("https://api.github.com/repos/{REPOSITORY}/releases/latest");
    let agent = format!("User-Agent: {USER_AGENT}");
    // The status comes on a line of its own after the body.
    let output = run(CURL, &["-sSL", "-H", "Accept: application/vnd.github+json", "-H", &agent, "-w", "\n%{http_code}", &url])?;
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

/// The installer of a release whose name ends with `end` (see `installer_end`).
fn installer<'a>(release: &'a Release, end: &str) -> Option<&'a Asset> {
    release
        .assets
        .iter()
        // The name becomes a file name. It must not have a folder.
        .find(|asset| asset.name.ends_with(end) && Path::new(&asset.name).file_name().is_some_and(|file| file == asset.name.as_str()))
}

fn is_newer(core: &Core, release: &Release) -> bool {
    installer(release, installer_end()).is_some() && numbers(&release.tag_name) > numbers(&core.version())
}

/// The version of this app and the latest release. A failed check gives the version and the error.
pub fn update_check(core: &Core) -> Update {
    let current = core.version();
    match latest() {
        Ok(release) => Update {
            current,
            newer: release.as_ref().is_some_and(|release| is_newer(core, release)),
            latest: release.map(|release| release.tag_name.trim_start_matches('v').to_string()),
            error: None,
        },
        Err(error) => Update { current, newer: false, latest: None, error: Some(error) },
    }
}

/// Downloads the installer of the latest release and starts it. Gives the version of the installer.
/// On Windows the installer closes the app and installs in one step. On macOS the disk image opens
/// in the Finder; the user drags Dispatch to Applications and starts it again.
pub fn update_install(core: &Core) -> Result<String, String> {
    let release = latest()?.ok_or("the repository has no release")?;
    if !is_newer(core, &release) {
        return Err("there is no new version".into());
    }
    let asset = installer(&release, installer_end()).ok_or("the release has no installer")?;
    let dir = std::env::temp_dir().join("dispatch-update");
    fs::create_dir_all(&dir).map_err(err)?;
    let file = dir.join(&asset.name);
    let output = match (&asset.browser_download_url, release.public) {
        (Some(url), true) => {
            let agent = format!("User-Agent: {USER_AGENT}");
            run(CURL, &["-sSLf", "-H", &agent, "-o", &file.to_string_lossy(), url])?
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
    #[cfg(windows)]
    let child = Command::new(&file).args(INSTALLER_ARGS).spawn().map_err(err)?;
    // The Finder mounts the disk image and shows it; nothing installs without the user.
    #[cfg(not(windows))]
    let child = Command::new("open").arg(&file).spawn().map_err(err)?;
    *INSTALLER.lock().map_err(err)? = Some(child);
    Ok(release.tag_name.trim_start_matches('v').to_string())
}

/// The switches of the installer for an update in one step.
#[cfg(windows)]
const INSTALLER_ARGS: [&str; 3] = ["/P", "/UPDATE", "/R"];

/// The installer that `update_install` started. The app still runs after it ended when the user
/// cancelled it (or it failed); then the update buttons must work again.
static INSTALLER: Mutex<Option<Child>> = Mutex::new(None);

/// Whether the installer that the app started is still open.
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
        #[cfg(windows)]
        let child = Command::new("ping").args(["-n", "2", "127.0.0.1"]).stdout(Stdio::null()).no_window().spawn().unwrap();
        #[cfg(not(windows))]
        let child = Command::new("sleep").arg("1").stdout(Stdio::null()).spawn().unwrap();
        *INSTALLER.lock().unwrap() = Some(child);
        assert!(update_installer_open());
        let ended = (0..50).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            !update_installer_open()
        });
        assert!(ended, "the closed installer is no longer open");
        assert!(INSTALLER.lock().unwrap().is_none());
    }

    #[test]
    fn the_installer_of_a_release_by_platform() {
        let asset = |name: &str| Asset { name: name.to_string(), browser_download_url: None };
        let release = Release {
            tag_name: "v1.2.3".to_string(),
            assets: vec![
                asset("../Dispatch_1.2.3_x64-setup.exe"),
                asset("Dispatch_1.2.3_x64-setup.exe"),
                asset("x/Dispatch_1.2.3_universal.dmg"),
                asset("Dispatch_1.2.3_universal.dmg"),
            ],
            public: true,
        };
        assert_eq!(installer(&release, "-setup.exe").unwrap().name, "Dispatch_1.2.3_x64-setup.exe", "Windows");
        assert_eq!(installer(&release, ".dmg").unwrap().name, "Dispatch_1.2.3_universal.dmg", "macOS");
        let windows_only = Release { tag_name: "v1.2.3".to_string(), assets: vec![asset("Dispatch_1.2.3_x64-setup.exe")], public: true };
        assert!(installer(&windows_only, ".dmg").is_none(), "a release without a dmg has no Mac installer");
        assert_eq!(installer_end(), if cfg!(windows) { "-setup.exe" } else { ".dmg" });
    }
}
