// The planned entries of a project (ticket overview-backlog): a message of the user to triage that
// triage has not taken yet. One Markdown file per entry in `.dispatch/backlog/` of the project:
// two header lines `sent:` and `order:`, an empty line, then the message as typed. The user can edit
// or delete a file in an editor; Dispatch reads the folder at each task poll and follows.
// Dispatch commits each change of the folder at once, with only its files (user decision
// 2026-11-11): a clone has the entries, and the project stays clean for Approve.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::core::info::{file_entry, FileEntry, NoWindow};
use crate::core::pipeline::{write_file, Project};

/// The folder of the entries, relative to the top folder of the repository, as git takes a path.
const BACKLOG_PATH: &str = ".dispatch/backlog";

/// The longest id: the date, the time and the first words of the message.
const ID_MAX: usize = 60;

/// One planned entry, as the frontend gets it.
#[derive(Serialize)]
pub struct Entry {
    /// The file name without `.md`.
    id: String,
    /// The message as the box sent it: the paths of pasted images first, then the text.
    text: String,
    /// When the user sent it, in milliseconds since the Unix epoch; the change time for a file
    /// without the header.
    sent: u64,
    /// The place in the order of the user, 1 first; none for a file without the header.
    order: Option<u32>,
    file: FileEntry,
}

/// The header and the message of an entry file. A file whose first line is no `sent:` or `order:`
/// line is all message. The header ends at the first empty line.
fn parse(text: &str) -> (Option<u64>, Option<u32>, String) {
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let mut sent = None;
    let mut order = None;
    let mut lines = text.split('\n');
    let mut body_start = 0;
    let mut header = false;
    for line in lines.by_ref() {
        let Some((key, value)) = line.split_once(':') else { break };
        match key.trim().to_ascii_lowercase().as_str() {
            "sent" => sent = value.trim().parse().ok(),
            "order" => order = value.trim().parse().ok(),
            _ => break,
        }
        header = true;
        body_start += line.len() + 1;
    }
    if !header {
        return (None, None, text.trim().to_string());
    }
    (sent, order, text.get(body_start..).unwrap_or_default().trim().to_string())
}

/// The text of an entry file.
fn render(sent: u64, order: u32, text: &str) -> String {
    format!("sent: {sent}\norder: {order}\n\n{}\n", text.trim())
}

fn read_entry(path: &Path) -> Option<Entry> {
    let file = file_entry(path)?;
    let (sent, order, text) = parse(&fs::read_to_string(path).ok()?);
    Some(Entry { id: path.file_stem()?.to_string_lossy().into_owned(), text, sent: sent.unwrap_or(file.modified), order, file })
}

/// The entries of a project in their order, for `task_list`. A change of the folder that is not
/// committed yet (a file that the user edited or deleted in an editor) is committed first.
pub(crate) fn list(project: &Project) -> Vec<Entry> {
    if project.backlog_dir().is_dir() {
        commit_logged(project);
    }
    entries(project)
}

/// The entries of a project in their order: by `order`, then by time, then by id; an entry without
/// `order` comes after the ones with it.
fn entries(project: &Project) -> Vec<Entry> {
    let mut entries: Vec<Entry> = fs::read_dir(project.backlog_dir())
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")))
        .filter_map(|path| read_entry(&path))
        .collect();
    entries.sort_by(|a, b| {
        (a.order.is_none(), a.order, a.sent, &a.id).cmp(&(b.order.is_none(), b.order, b.sent, &b.id))
    });
    entries
}

/// An entry id is a file name. Letters, digits and `-` only.
fn check_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > ID_MAX + 4 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("invalid entry id: {id}"));
    }
    Ok(())
}

/// The date and the time of a moment in UTC as `YYYY-MM-DD-HHMMSS`.
fn stamp(millis: u64) -> String {
    let secs = millis / 1000;
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}-{:02}{:02}{:02}", rest / 3600, rest % 3600 / 60, rest % 60)
}

/// The id of a new entry: the time and the first words of the message (not the image paths).
fn new_id(millis: u64, text: &str) -> String {
    let mut id = stamp(millis);
    let words = text
        .split_whitespace()
        .filter(|word| !word.contains(['\\', '/']) && !word.starts_with('"'))
        .map(|word| word.chars().filter(char::is_ascii_alphanumeric).collect::<String>().to_ascii_lowercase())
        .filter(|word| !word.is_empty());
    for word in words {
        if id.len() + 1 + word.len() > ID_MAX {
            break;
        }
        id.push('-');
        id.push_str(&word);
    }
    id
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64)
}

/// Writes a new entry at the end of the order and gives it.
pub(crate) fn add(project: &Project, text: &str, sent: u64) -> Result<Entry, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("the entry is empty".to_string());
    }
    let dir = project.backlog_dir();
    let order = entries(project).iter().filter_map(|entry| entry.order).max().unwrap_or(0) + 1;
    let base = new_id(sent, text);
    let mut id = base.clone();
    let mut n = 2;
    while dir.join(format!("{id}.md")).exists() {
        id = format!("{base}-{n}");
        n += 1;
    }
    let path = dir.join(format!("{id}.md"));
    write_file(&path, &render(sent, order, text))?;
    read_entry(&path).ok_or_else(|| format!("the entry {} cannot be read back", path.display()))
}

/// Deletes the file of an entry. An entry that is gone already is no error.
pub(crate) fn remove(project: &Project, id: &str) -> Result<(), String> {
    check_id(id)?;
    let path = project.backlog_dir().join(format!("{id}.md"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("{}: {error}", path.display())),
    }
}

/// Writes `order` 1..N into the files in the order of `ids`; an entry that `ids` does not name
/// keeps its place after them. A file whose order is right already is not written.
pub(crate) fn reorder(project: &Project, ids: &[String]) -> Result<(), String> {
    for id in ids {
        check_id(id)?;
    }
    let all = entries(project);
    let named = ids.iter().filter_map(|id| all.iter().find(|entry| &entry.id == id));
    let rest = all.iter().filter(|entry| !ids.contains(&entry.id));
    for (at, entry) in named.chain(rest).enumerate() {
        let order = at as u32 + 1;
        if entry.order == Some(order) {
            continue;
        }
        let path = project.backlog_dir().join(format!("{}.md", entry.id));
        write_file(&path, &render(entry.sent, order, &entry.text))?;
    }
    Ok(())
}

/// Runs git in the top folder of a project and gives its output, or the error text of git. It takes
/// the index lock, which a commit needs (the same as `run_git` of the Setup commit).
fn git(project: &Project, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&project.root)
        .args(args)
        .stdin(Stdio::null())
        .no_window()
        .output()
        .map_err(|e| format!("git did not start: {e}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(format!("git {} failed: {stderr}", args.first().copied().unwrap_or_default()))
}

/// Commits the changes of the entry folder, and no other file: a new, changed or deleted entry.
/// Other staged changes of the user stay staged. Gives the number of changed files, 0 when there
/// was nothing to commit; a project in no git repository gives 0 too.
pub(crate) fn keep_committed(project: &Project) -> Result<usize, String> {
    // `--untracked-files=all`: a new folder shows its files, not only the folder.
    let Ok(status) = git(project, &["status", "--porcelain", "--untracked-files=all", "--", BACKLOG_PATH]) else {
        return Ok(0);
    };
    let changed = status.lines().filter(|line| !line.trim().is_empty()).count();
    if changed == 0 {
        return Ok(0);
    }
    git(project, &["add", "--all", "--", BACKLOG_PATH])?;
    let message = format!("Backlog: {changed} planned {}", if changed == 1 { "message" } else { "messages" });
    // A commit with a path takes only that path.
    git(project, &["commit", "-m", &message, "--", BACKLOG_PATH])?;
    Ok(changed)
}

/// Commits the entry folder; a failure (an index lock of a git command of the user, no git
/// identity) is logged, and the next task poll tries again.
fn commit_logged(project: &Project) {
    if let Err(error) = keep_committed(project) {
        eprintln!("planned entries not committed: {error}");
    }
}

/// Writes a planned entry for the message of the user, commits it and gives it.
pub fn backlog_add(cwd: String, text: String) -> Result<Entry, String> {
    let project = Project::find(&cwd)?;
    let entry = add(&project, &text, now())?;
    commit_logged(&project);
    Ok(entry)
}

/// Removes a planned entry and commits that: the × of its card, or triage took it.
pub fn backlog_remove(cwd: String, id: String) -> Result<(), String> {
    let project = Project::find(&cwd)?;
    remove(&project, &id)?;
    commit_logged(&project);
    Ok(())
}

/// Saves the order of the planned entries that the user set, and commits it.
pub fn backlog_reorder(cwd: String, ids: Vec<String>) -> Result<(), String> {
    let project = Project::find(&cwd)?;
    reorder(&project, &ids)?;
    commit_logged(&project);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A scratch project in the temp folder, in no git repository.
    fn scratch(name: &str) -> (Project, PathBuf) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("dispatch-backlog-{name}-{nanos}"));
        let root = base.join("proj");
        fs::create_dir_all(&root).unwrap();
        (Project::scratch(root, base.join("proj-reports")), base)
    }

    fn ids(project: &Project) -> Vec<String> {
        entries(project).into_iter().map(|entry| entry.text).collect()
    }

    #[test]
    fn an_entry_is_written_and_read_back() {
        let (project, base) = scratch("add");
        let t = 1_762_820_607_000; // 2025-11-11 00:23:27 UTC
        let entry = add(&project, "  Fix the bar:\nit is too tall  ", t).unwrap();
        assert_eq!(entry.id, "2025-11-11-002327-fix-the-bar-it-is-too-tall");
        assert_eq!((entry.text.as_str(), entry.sent, entry.order), ("Fix the bar:\nit is too tall", t, Some(1)));
        let text = fs::read_to_string(project.backlog_dir().join(format!("{}.md", entry.id))).unwrap();
        assert_eq!(text, format!("sent: {t}\norder: 1\n\nFix the bar:\nit is too tall\n"));
        // The same second and words: a second file, not an overwrite; it comes after the first.
        let first = add(&project, "fix the bar", t).unwrap();
        let second = add(&project, "Fix the BAR!", t).unwrap();
        assert_eq!((first.id.as_str(), first.order), ("2025-11-11-002327-fix-the-bar", Some(2)));
        assert_eq!((second.id.as_str(), second.order), ("2025-11-11-002327-fix-the-bar-2", Some(3)));
        // A long message gives an id of at most 60 characters plus the number.
        assert!(add(&project, &"word ".repeat(40), t).unwrap().id.len() <= ID_MAX);
        // Image paths at the start do not go into the id.
        let image = add(&project, "C:/p/paste-1.png look at this", t).unwrap();
        assert_eq!(image.id, "2025-11-11-002327-look-at-this");
        assert!(add(&project, "   ", t).is_err());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_file_by_hand_and_a_file_with_windows_line_ends_are_read() {
        let (project, base) = scratch("hand");
        let dir = project.backlog_dir();
        write_file(&dir.join("b.md"), "sent: 5\r\norder: 2\r\n\r\nsecond\r\nline two\r\n").unwrap();
        write_file(&dir.join("a.md"), "sent: 9\norder: 1\n\nfirst\n").unwrap();
        write_file(&dir.join("hand.md"), "written by hand: no header\n").unwrap();
        write_file(&dir.join("note.txt"), "not an entry\n").unwrap();
        let entries = entries(&project);
        let shown: Vec<(&str, &str, Option<u32>)> = entries.iter().map(|e| (e.id.as_str(), e.text.as_str(), e.order)).collect();
        assert_eq!(shown, [("a", "first", Some(1)), ("b", "second\nline two", Some(2)), ("hand", "written by hand: no header", None)]);
        // A file without the header has the time of the file.
        assert_eq!(entries[2].sent, entries[2].file.modified);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn reorder_writes_the_order_and_remove_deletes_the_file() {
        let (project, base) = scratch("order");
        for (at, text) in ["one", "two", "three"].iter().enumerate() {
            add(&project, text, 1_000 + at as u64).unwrap();
        }
        write_file(&project.backlog_dir().join("zz-hand.md"), "by hand\n").unwrap();
        let all: Vec<String> = entries(&project).into_iter().map(|entry| entry.id).collect();
        // The third to the top; the entry by hand is not named and keeps its place at the end.
        reorder(&project, &[all[2].clone(), all[0].clone(), all[1].clone()]).unwrap();
        assert_eq!(ids(&project), ["three", "one", "two", "by hand"]);
        assert_eq!(entries(&project).iter().map(|entry| entry.order).collect::<Vec<_>>(), [Some(1), Some(2), Some(3), Some(4)]);
        // The list stays in that order after a new read, and the text of each file is kept.
        assert!(fs::read_to_string(project.backlog_dir().join(format!("{}.md", all[2]))).unwrap().ends_with("\n\nthree\n"));
        remove(&project, &all[0]).unwrap();
        assert!(!project.backlog_dir().join(format!("{}.md", all[0])).exists());
        assert_eq!(ids(&project), ["three", "two", "by hand"]);
        // A second remove is no error; a path is no id.
        assert!(remove(&project, &all[0]).is_ok());
        assert!(remove(&project, "../x").is_err() && reorder(&project, &["a/b".to_string()]).is_err());
        // A new entry goes after the highest order.
        assert_eq!(add(&project, "four", 2_000).unwrap().order, Some(5));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn each_change_of_the_folder_is_committed_alone_and_the_tree_stays_clean() {
        let (scratch, base) = scratch("git");
        let root = scratch.root.clone();
        let run = |args: &[&str]| {
            let output = Command::new("git").arg("-C").arg(&root).args(args).output().unwrap();
            assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
            String::from_utf8_lossy(&output.stdout).into_owned()
        };
        run(&["init", "-q"]);
        run(&["config", "user.name", "Dispatch test"]);
        run(&["config", "user.email", "test@example.invalid"]);
        run(&["config", "commit.gpgsign", "false"]);
        run(&["config", "core.excludesFile", "no-such-ignore-file"]);
        write_file(&root.join("notes.txt"), "mine\n").unwrap();
        // A staged change of the user stays staged and out of the commits of Dispatch.
        write_file(&root.join("staged.txt"), "staged\n").unwrap();
        run(&["add", "staged.txt"]);
        let project = Project::find(&root.to_string_lossy()).unwrap();
        let clean = || run(&["status", "--porcelain", "--", BACKLOG_PATH]);
        let commits = || run(&["log", "--format=%s"]).lines().map(str::to_string).collect::<Vec<_>>();

        // The three commands, as the frontend calls them.
        let a = backlog_add(root.to_string_lossy().into_owned(), "first".into()).unwrap();
        let b = backlog_add(root.to_string_lossy().into_owned(), "second".into()).unwrap();
        assert_eq!(clean(), "");
        backlog_reorder(root.to_string_lossy().into_owned(), vec![b.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(clean(), "");
        backlog_remove(root.to_string_lossy().into_owned(), a.id.clone()).unwrap();
        assert_eq!(clean(), "");
        // Newest first: the remove, the reorder (two files change their order), the two adds.
        assert_eq!(commits(), ["Backlog: 1 planned message", "Backlog: 2 planned messages", "Backlog: 1 planned message", "Backlog: 1 planned message"]);
        // Each commit holds only files of the folder; the files of the user are where they were.
        let files = run(&["log", "--name-only", "--format="]);
        assert!(files.lines().filter(|line| !line.is_empty()).all(|line| line.starts_with(".dispatch/backlog/")), "{files}");
        let status = run(&["status", "--porcelain"]);
        assert!(status.contains("A  staged.txt") && status.contains("?? notes.txt"), "{status}");

        // A file that the user edits or deletes in an editor is committed at the next read.
        write_file(&project.backlog_dir().join(format!("{}.md", b.id)), "sent: 1\norder: 1\n\nsecond, edited\n").unwrap();
        write_file(&project.backlog_dir().join("by-hand.md"), "written by hand\n").unwrap();
        assert_eq!(list(&project).len(), 2);
        assert_eq!(clean(), "");
        assert_eq!(commits()[0], "Backlog: 2 planned messages");
        // Nothing changed: no empty commit.
        assert_eq!(keep_committed(&project), Ok(0));
        assert_eq!(commits().len(), 5);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_project_without_git_commits_nothing() {
        let (project, base) = scratch("nogit");
        add(&project, "one", 1).unwrap();
        assert_eq!(keep_committed(&project), Ok(0));
        assert_eq!(list(&project).len(), 1);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_stamp_is_the_utc_date_and_time() {
        assert_eq!(stamp(0), "1970-01-01-000000");
        assert_eq!(stamp(951_782_400_000), "2000-02-29-000000");
        assert_eq!(stamp(1_794_354_761_070), "2026-11-10-235241");
    }
}
