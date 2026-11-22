//! The build folders of a project (ticket proof-target-cleanup): the cargo target folders, the size
//! of their direct sub folders and of the incremental caches, and the clean that deletes the proof
//! builds and the incremental caches on a click in the Setup window.
//!
//! The kinds of a row: `main` is `debug` or `release` of a target folder (the clean never takes it),
//! `cache` is the `incremental` folder of a main folder, and `proof` is every other sub folder of a
//! target folder: a test copy build of a worker (`test-copy`, `tickets-proof`, ...) or the remainder
//! of an earlier clean (`<name>.cleaning-<nanos>`). Files at the top of a target folder stay.
//!
//! A clean skips a folder in use: when a main folder holds an open `.cargo-lock`, a build runs and
//! every row of that target folder stays; a folder that Windows refuses to rename holds an open file
//! (a running test copy, a compiler) and stays. Nothing here runs without a call of the window.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::core::pipeline::Project;

/// The main build folders of a target folder.
const MAIN: [&str; 2] = ["debug", "release"];
/// The cache folder of a main folder.
const CACHE: &str = "incremental";
/// The mark of a folder that a clean renamed before the delete.
const CLEANING: &str = ".cleaning-";

/// One folder of a target folder.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BuildRow {
    /// The target folder that holds the row.
    target: String,
    /// The path of the row in the target folder, for example `debug` or `debug/incremental`.
    name: String,
    /// `main`, `proof` or `cache`.
    kind: &'static str,
    /// The sum of the file lengths. A main row does not count its incremental cache.
    bytes: u64,
}

/// The build folders of a project.
#[derive(Serialize, Debug, PartialEq, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BuildFolders {
    root: String,
    /// The cargo target folders of the project; empty for a project without cargo.
    targets: Vec<String>,
    rows: Vec<BuildRow>,
}

/// A row that a clean did not delete, and why.
#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    row: BuildRow,
    reason: String,
}

/// The reply of a clean.
#[derive(Serialize, Debug, PartialEq, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    removed: Vec<BuildRow>,
    skipped: Vec<Skipped>,
    /// The bytes of the removed rows.
    freed: u64,
}

/// The cargo target folders of a project: `<root>/target` with a `<root>/Cargo.toml`, and
/// `<root>/<sub>/target` for each direct sub folder with a `Cargo.toml`.
fn target_folders(root: &Path) -> Vec<PathBuf> {
    let mut crates = vec![root.to_path_buf()];
    if let Ok(entries) = fs::read_dir(root) {
        let mut subs: Vec<PathBuf> = entries
            .flatten()
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink()))
            .filter(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                !name.starts_with('.') && name != "node_modules"
            })
            .map(|e| e.path())
            .collect();
        subs.sort();
        crates.extend(subs);
    }
    crates
        .into_iter()
        .filter(|dir| dir.join("Cargo.toml").is_file())
        .map(|dir| dir.join("target"))
        .filter(|target| fs::symlink_metadata(target).is_ok_and(|m| m.is_dir()))
        .collect()
}

/// The sum of the file lengths below `dir`, without the sub folders named in `except`. It follows no
/// symlink or junction; an unreadable entry counts 0.
pub(crate) fn size_of(dir: &Path, except: &[&str]) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    let mut total = 0;
    for entry in entries.flatten() {
        let Ok(meta) = fs::symlink_metadata(entry.path()) else { continue };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if !except.iter().any(|name| entry.file_name().to_string_lossy() == *name) {
                total += size_of(&entry.path(), &[]);
            }
        } else {
            total += meta.len();
        }
    }
    total
}

/// The direct sub folders of a folder, sorted by name.
fn sub_folders(dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink()))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// Whether a name is the incremental cache of a main folder, or the remainder of its clean.
fn is_cache(name: &str) -> bool {
    name == CACHE || name.starts_with(&format!("{CACHE}{CLEANING}"))
}

/// The rows of one target folder.
fn rows_of(target: &Path) -> Vec<BuildRow> {
    let target_text = target.to_string_lossy().into_owned();
    let mut rows = Vec::new();
    for name in sub_folders(target) {
        let dir = target.join(&name);
        if MAIN.contains(&name.as_str()) {
            let caches: Vec<String> = sub_folders(&dir).into_iter().filter(|sub| is_cache(sub)).collect();
            let except: Vec<&str> = caches.iter().map(String::as_str).collect();
            rows.push(BuildRow { target: target_text.clone(), name: name.clone(), kind: "main", bytes: size_of(&dir, &except) });
            for cache in &caches {
                let bytes = size_of(&dir.join(cache), &[]);
                rows.push(BuildRow { target: target_text.clone(), name: format!("{name}/{cache}"), kind: "cache", bytes });
            }
        } else {
            rows.push(BuildRow { target: target_text.clone(), name, kind: "proof", bytes: size_of(&dir, &[]) });
        }
    }
    rows
}

/// The build folders of the project of `cwd`, with their sizes.
pub fn build_folders(cwd: String) -> Result<BuildFolders, String> {
    let project = Project::find(&cwd)?;
    let targets = target_folders(&project.root);
    let rows = targets.iter().flat_map(|target| rows_of(target)).collect();
    Ok(BuildFolders {
        root: project.root.to_string_lossy().into_owned(),
        targets: targets.iter().map(|t| t.to_string_lossy().into_owned()).collect(),
        rows,
    })
}

/// Whether a build runs in a target folder: a main folder holds a `.cargo-lock` that another
/// program has open, so it cannot be opened alone.
#[cfg(windows)]
fn build_runs(target: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    MAIN.iter().map(|name| target.join(name).join(".cargo-lock")).filter(|lock| lock.is_file()).any(|lock| {
        fs::OpenOptions::new().read(true).share_mode(0).open(&lock).is_err()
    })
}

#[cfg(not(windows))]
fn build_runs(_target: &Path) -> bool {
    false
}

/// Deletes the proof builds and the incremental caches of the project of `cwd`. The main builds
/// stay, and so does a folder in use.
pub fn build_clean(cwd: String) -> Result<CleanResult, String> {
    let project = Project::find(&cwd)?;
    Ok(clean_targets(&target_folders(&project.root)))
}

fn clean_targets(targets: &[PathBuf]) -> CleanResult {
    let mut result = CleanResult::default();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    for target in targets {
        let rows: Vec<BuildRow> = rows_of(target).into_iter().filter(|row| row.kind != "main").collect();
        if build_runs(target) {
            result.skipped.extend(rows.into_iter().map(|row| Skipped { row, reason: "a build runs".into() }));
            continue;
        }
        for row in rows {
            let path = target.join(&row.name);
            let renamed = PathBuf::from(format!("{}{CLEANING}{nanos}", path.to_string_lossy()));
            // A remainder of an earlier clean already has the mark and needs no rename.
            let to_remove = if row.name.contains(CLEANING) {
                path
            } else if fs::rename(&path, &renamed).is_ok() {
                renamed
            } else {
                result.skipped.push(Skipped { row, reason: "in use".into() });
                continue;
            };
            match fs::remove_dir_all(&to_remove) {
                Ok(()) => {
                    result.freed += row.bytes;
                    result.removed.push(row);
                }
                Err(_) => result.skipped.push(Skipped { row, reason: "partly removed; the next clean takes the rest".into() }),
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("dispatch-builds-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file(path: &Path, bytes: usize) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, vec![b'x'; bytes]).unwrap();
    }

    /// A scratch project with a crate in `app` and a target folder with main, proof and cache rows.
    fn project(name: &str) -> (PathBuf, PathBuf) {
        let root = scratch(name);
        file(&root.join("app").join("Cargo.toml"), 10);
        file(&root.join("node_modules").join("x").join("Cargo.toml"), 10);
        fs::create_dir_all(root.join("node_modules").join("x").join("target").join("debug")).unwrap();
        let target = root.join("app").join("target");
        file(&target.join("CACHEDIR.TAG"), 5);
        file(&target.join("debug").join("app.exe"), 100);
        file(&target.join("debug").join("incremental").join("a").join("q.bin"), 40);
        file(&target.join("release").join("app.exe"), 200);
        file(&target.join("tickets-proof").join("debug").join("app.exe"), 300);
        file(&target.join("test").join("x.rlib"), 7);
        file(&target.join("held").join("lock.bin"), 9);
        (root, target)
    }

    fn names(rows: &[BuildRow]) -> Vec<(String, &'static str, u64)> {
        rows.iter().map(|r| (r.name.clone(), r.kind, r.bytes)).collect()
    }

    #[test]
    fn the_rows_of_a_target_folder() {
        let (root, target) = project("rows");
        let folders = build_folders(root.to_string_lossy().into_owned()).unwrap();
        assert_eq!(folders.targets, vec![target.to_string_lossy().into_owned()]);
        assert_eq!(
            names(&folders.rows),
            vec![
                ("debug".to_string(), "main", 100),
                ("debug/incremental".to_string(), "cache", 40),
                ("held".to_string(), "proof", 9),
                ("release".to_string(), "main", 200),
                ("test".to_string(), "proof", 7),
                ("tickets-proof".to_string(), "proof", 300),
            ]
        );
        let none = scratch("no-cargo");
        assert_eq!(build_folders(none.to_string_lossy().into_owned()).unwrap().targets, Vec::<String>::new());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(none);
    }

    #[cfg(windows)]
    #[test]
    fn the_clean_takes_proofs_and_the_cache_and_skips_a_folder_in_use() {
        let (root, target) = project("clean");
        let held = fs::File::open(target.join("held").join("lock.bin")).unwrap();
        let result = build_clean(root.to_string_lossy().into_owned()).unwrap();
        drop(held);
        assert_eq!(
            names(&result.removed),
            vec![("debug/incremental".to_string(), "cache", 40), ("test".to_string(), "proof", 7), ("tickets-proof".to_string(), "proof", 300)]
        );
        assert_eq!(result.freed, 347);
        assert_eq!(result.skipped.len(), 1);
        assert_eq!((result.skipped[0].row.name.as_str(), result.skipped[0].reason.as_str()), ("held", "in use"));
        assert!(!target.join("tickets-proof").exists());
        assert!(!target.join("test").exists());
        assert!(!target.join("debug").join("incremental").exists());
        assert!(target.join("debug").join("app.exe").is_file());
        assert!(target.join("release").join("app.exe").is_file());
        assert!(target.join("held").join("lock.bin").is_file());
        assert!(target.join("CACHEDIR.TAG").is_file());
        assert_eq!(fs::read_dir(&target).unwrap().count(), 4, "no renamed remainder stays");
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn the_clean_skips_a_target_folder_with_a_running_build() {
        use std::os::windows::fs::OpenOptionsExt;
        let (root, target) = project("lock");
        file(&target.join("debug").join(".cargo-lock"), 0);
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(target.join("debug").join(".cargo-lock")).unwrap();
        let result = build_clean(root.to_string_lossy().into_owned()).unwrap();
        drop(lock);
        assert!(result.removed.is_empty());
        assert_eq!(result.freed, 0);
        assert_eq!(result.skipped.len(), 4);
        assert!(result.skipped.iter().all(|s| s.reason == "a build runs"));
        assert!(target.join("tickets-proof").is_dir());
        assert!(target.join("debug").join("incremental").is_dir());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn a_remainder_of_an_earlier_clean_is_a_row_and_goes() {
        let (root, target) = project("remainder");
        file(&target.join("old.cleaning-5").join("x.bin"), 3);
        file(&target.join("debug").join("incremental.cleaning-5").join("y.bin"), 4);
        let rows = build_folders(root.to_string_lossy().into_owned()).unwrap().rows;
        assert!(rows.iter().any(|r| r.name == "old.cleaning-5" && r.kind == "proof"));
        assert!(rows.iter().any(|r| r.name == "debug/incremental.cleaning-5" && r.kind == "cache"));
        assert_eq!(rows.iter().find(|r| r.name == "debug").unwrap().bytes, 100);
        let result = build_clean(root.to_string_lossy().into_owned()).unwrap();
        assert!(result.skipped.is_empty());
        assert!(!target.join("old.cleaning-5").exists());
        assert!(!target.join("debug").join("incremental.cleaning-5").exists());
        let _ = fs::remove_dir_all(root);
    }
}
