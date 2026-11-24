//! The pictures that a worker report names (ticket show-the-pictures-that-a-report-names-on). The
//! task read gives their names with a pure text parse; the call `report_pictures` finds each one in
//! the project folder, in a work folder or on the task branch, and copies a picture from outside the
//! project folder into the data folder of Dispatch, where the viewer reads it.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;

use crate::core::info::{file_entry, FileEntry, NoWindow};
use crate::core::pipeline::{check_ticket, read_branch_file, Project};
use crate::core::{gitfiles, Core};

/// The most pictures that one report gives.
const MAX_PICTURES: usize = 30;
/// The depth below a folder at which a bare name is searched.
const BARE_DEPTH: usize = 3;
const PICTURE_EXTENSIONS: [&str; 7] = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];

/// The names of the pictures of a report and the folders for its bare names.
#[derive(Debug, PartialEq, Default)]
pub(crate) struct ReportPictures {
    /// Paths and bare names in the order of the report, each once, with `/` between the parts.
    pub(crate) names: Vec<String>,
    /// The folders in which a bare name is searched, each once, without an end slash.
    pub(crate) folders: Vec<String>,
}

/// A picture that Dispatch found: the name of the report, where it came from (`project`,
/// `work folder <n>` or `branch <branch>`) and the file that the viewer reads.
#[derive(Serialize)]
pub struct FoundPicture {
    name: String,
    from: String,
    file: FileEntry,
}

/// The reply of `report_pictures`.
#[derive(Serialize)]
pub struct PicturesReply {
    found: Vec<FoundPicture>,
    missing: Vec<String>,
    /// Names whose Git LFS object is not in the local LFS store.
    unavailable: Vec<String>,
}

/// A token of the report text ends at these characters, besides white space.
fn is_split(c: char) -> bool {
    c.is_whitespace() || "`[](){}<>\"',;|".contains(c)
}

fn has_picture_extension(token: &str) -> bool {
    let Some((stem, extension)) = token.rsplit_once('.') else { return false };
    let stem_name = stem.rsplit('/').next().unwrap_or_default();
    !stem_name.is_empty() && PICTURE_EXTENSIONS.iter().any(|known| extension.eq_ignore_ascii_case(known))
}

/// The last part of a path.
fn last_part(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Finds the pictures that a report text names: tokens with a picture extension (no URL), a path
/// with `…` or `...` as its bare name, and a bare name that a path with a folder also names left
/// out. The folders for bare names (and for paths with a slash below a named folder) are those of
/// the found paths, the tokens that end in a slash, and the proof folder of the ticket. Pure text work: the task read runs it on each poll.
pub(crate) fn report_pictures(text: &str, ticket: &str) -> ReportPictures {
    let mut names: Vec<String> = Vec::new();
    let mut folders: Vec<String> = Vec::new();
    let add_folder = |folders: &mut Vec<String>, folder: &str| {
        let folder = folder.trim_end_matches('/');
        if !folder.is_empty() && folder != "." && !folders.iter().any(|known| known == folder) {
            folders.push(folder.to_string());
        }
    };
    for raw in text.split(is_split) {
        let token = raw.trim_start_matches('*').trim_end_matches(|c: char| ".:!?*".contains(c)).replace('\\', "/");
        let token = token.strip_prefix("./").unwrap_or(&token);
        if token.is_empty() || token.contains("://") || token.starts_with("data:") {
            continue;
        }
        if token.ends_with('/') && !token.contains('…') && !token.contains("...") && token.len() > 1 {
            add_folder(&mut folders, token);
            continue;
        }
        if !has_picture_extension(token) {
            continue;
        }
        let name = if token.contains('…') || token.contains("...") { last_part(token) } else { token };
        if name.is_empty() || names.iter().any(|known| known == name) {
            continue;
        }
        if names.len() < MAX_PICTURES {
            names.push(name.to_string());
        }
    }
    for name in &names {
        if let Some((folder, _)) = name.rsplit_once('/') {
            add_folder(&mut folders, folder);
        }
    }
    add_folder(&mut folders, &format!(".dispatch/proof/{ticket}"));
    // A bare name goes when a path with a folder names the same file.
    let paths: Vec<String> = names.iter().filter(|name| name.contains('/')).map(|name| last_part(name).to_ascii_lowercase()).collect();
    names.retain(|name| name.contains('/') || !paths.contains(&name.to_ascii_lowercase()));
    ReportPictures { names, folders }
}

/// A relative path with only normal parts, or none: no `..`, no root, no drive.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let path = Path::new(path);
    let normal = path.components().all(|part| matches!(part, Component::Normal(_) | Component::CurDir));
    (normal && path.components().next().is_some()).then(|| path.to_path_buf())
}

/// The size below which a file can be a Git LFS pointer.
const LFS_POINTER_MAX: usize = 1024;

/// The facts of a Git LFS pointer: the object id (64 hex characters) and the size of the real file,
/// or none when the bytes are no pointer.
fn lfs_pointer(bytes: &[u8]) -> Option<(String, u64)> {
    if bytes.len() >= LFS_POINTER_MAX {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?;
    let mut lines = text.lines();
    if lines.next()?.trim_end() != "version https://git-lfs.github.com/spec/v1" {
        return None;
    }
    let mut oid = None;
    let mut size = None;
    for line in lines {
        if let Some(hex) = line.strip_prefix("oid sha256:") {
            let hex = hex.trim();
            if hex.len() == 64 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
                oid = Some(hex.to_ascii_lowercase());
            }
        } else if let Some(number) = line.strip_prefix("size ") {
            size = number.trim().parse::<u64>().ok();
        }
    }
    Some((oid?, size?))
}

/// Where a picture can be: a folder on the disk with its label, or the task branch.
enum Place {
    Folder(PathBuf, String),
    Branch(String),
}

/// The result of a look at one place.
enum At {
    Found(FileEntry),
    /// The file is a Git LFS pointer and the real file is not in the local LFS store.
    NotLocal,
    Absent,
}

/// The result of the search for one name.
enum Hit {
    Found(String, FileEntry),
    NotLocal,
    Missing,
}

/// The searches of one call: the project folder, the copy folder, and the file list of the branch
/// per folder, read once.
struct Search<'a> {
    root: &'a Path,
    copies: &'a Path,
    /// The common git folder of the project, which holds the LFS store.
    common_dir: Option<PathBuf>,
    branch_lists: HashMap<String, Vec<String>>,
}

/// Runs git in the project folder and gives its output as bytes, or none when git fails.
fn git_bytes(root: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let output = gitfiles::git_program()
        .command()
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(root)
        .args(args)
        .stdin(Stdio::null())
        .no_window()
        .output()
        .ok()?;
    output.status.success().then_some(output.stdout)
}

impl Search<'_> {
    /// Copies bytes into the copy folder under the relative path and gives the copy.
    fn keep(&self, rel: &Path, bytes: &[u8]) -> Option<FileEntry> {
        let target = self.copies.join(rel);
        fs::create_dir_all(target.parent()?).ok()?;
        fs::write(&target, bytes).ok()?;
        file_entry(&target)
    }

    /// The real bytes of a Git LFS pointer from the local LFS store, or none when the object is
    /// not there or its size differs.
    fn lfs_bytes(&self, oid: &str, size: u64) -> Option<Vec<u8>> {
        let object = self.common_dir.as_ref()?.join("lfs").join("objects").join(&oid[0..2]).join(&oid[2..4]).join(oid);
        let bytes = fs::read(object).ok()?;
        (bytes.len() as u64 == size).then_some(bytes)
    }

    /// Copies bytes that may be an LFS pointer: the real bytes when the pointer is known.
    fn keep_bytes(&self, path: &Path, bytes: &[u8]) -> At {
        let bytes = match lfs_pointer(bytes) {
            Some((oid, size)) => match self.lfs_bytes(&oid, size) {
                Some(real) => real,
                None => return At::NotLocal,
            },
            None => bytes.to_vec(),
        };
        self.keep(path, &bytes).map_or(At::Absent, At::Found)
    }

    /// The picture at a relative path in one place: the file itself in the project folder, a copy
    /// from elsewhere (or from the LFS store when the file is a pointer).
    fn at(&self, place: &Place, rel: &str) -> At {
        let Some(path) = safe_relative(rel) else { return At::Absent };
        match place {
            Place::Folder(folder, _) => {
                let full = folder.join(&path);
                if !full.is_file() {
                    return At::Absent;
                }
                let small = fs::metadata(&full).is_ok_and(|meta| meta.len() < LFS_POINTER_MAX as u64);
                if small {
                    let Ok(bytes) = fs::read(&full) else { return At::Absent };
                    if lfs_pointer(&bytes).is_some() {
                        return self.keep_bytes(&path, &bytes);
                    }
                }
                if folder.as_path() == self.root {
                    return file_entry(&full).map_or(At::Absent, At::Found);
                }
                let Ok(bytes) = fs::read(&full) else { return At::Absent };
                self.keep(&path, &bytes).map_or(At::Absent, At::Found)
            }
            Place::Branch(branch) => {
                let Some(bytes) = git_bytes(self.root, &["cat-file", "blob", &format!("{branch}:{rel}")]) else { return At::Absent };
                self.keep_bytes(&path, &bytes)
            }
        }
    }

    /// The relative paths of the files named `name` in a folder of one place, at most
    /// `BARE_DEPTH` levels below it, sorted.
    fn bare(&mut self, place: &Place, folder: &str, name: &str) -> Vec<String> {
        let Some(rel_folder) = safe_relative(folder) else { return Vec::new() };
        match place {
            Place::Folder(base, _) => {
                let mut found = Vec::new();
                walk(&base.join(&rel_folder), folder, name, 0, &mut found);
                found.sort();
                found
            }
            Place::Branch(branch) => {
                let key = format!("{branch}\n{folder}");
                if !self.branch_lists.contains_key(&key) {
                    let text = git_bytes(self.root, &["ls-tree", "-r", "--name-only", branch, "--", folder]).unwrap_or_default();
                    let list = String::from_utf8_lossy(&text).lines().map(str::to_string).collect();
                    self.branch_lists.insert(key.clone(), list);
                }
                let prefix = format!("{folder}/");
                self.branch_lists[&key]
                    .iter()
                    .filter(|path| {
                        let Some(rest) = path.strip_prefix(&prefix) else { return false };
                        last_part(rest).eq_ignore_ascii_case(name) && rest.matches('/').count() <= BARE_DEPTH
                    })
                    .cloned()
                    .collect()
            }
        }
    }
}

/// Collects the paths of the files named `name` below `dir` (whose relative path is `rel`), down to
/// `BARE_DEPTH` levels.
fn walk(dir: &Path, rel: &str, name: &str, depth: usize, found: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.filter_map(Result::ok) {
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_file() && file_name.eq_ignore_ascii_case(name) {
            found.push(format!("{rel}/{file_name}"));
        } else if kind.is_dir() && depth < BARE_DEPTH {
            walk(&entry.path(), &format!("{rel}/{file_name}"), name, depth + 1, found);
        }
    }
}

/// The label of a place for the page.
fn label(place: &Place) -> String {
    match place {
        Place::Folder(_, label) => label.clone(),
        Place::Branch(branch) => format!("branch {branch}"),
    }
}

/// The work folders of the project, `.dispatch/work/<n>`, by number.
fn work_folders(project: &Project) -> Vec<(u8, PathBuf)> {
    let mut list: Vec<(u8, PathBuf)> = fs::read_dir(project.work_dir())
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| Some((entry.file_name().to_str()?.parse::<u8>().ok()?, entry.path())))
        .collect();
    list.sort();
    list
}

/// Finds the pictures of a report text in the places of the task, in this order: the project
/// folder, the work folder whose record names the ticket, the task branch, the other work folders.
/// The copy folder is emptied first.
fn resolve(project: &Project, ticket: &str, text: &str, copies: &Path, data_dir: Option<&Path>) -> Result<PicturesReply, String> {
    match fs::remove_dir_all(copies) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(format!("{}: {error}", copies.display())),
        _ => {}
    }
    let pictures = report_pictures(text, ticket);
    let folders = work_folders(project);
    let mut places = vec![Place::Folder(project.root.clone(), "project".to_string())];
    let own = folders.iter().find(|(n, _)| project.folder_user(*n).as_deref() == Some(ticket));
    if let Some((n, path)) = own {
        places.push(Place::Folder(path.clone(), format!("work folder {n}")));
    }
    if let Some(branch) = read_branch_file(&project.branch_file(ticket)) {
        places.push(Place::Branch(branch.name));
    }
    for (n, path) in &folders {
        if own.is_none_or(|(own, _)| own != n) {
            places.push(Place::Folder(path.clone(), format!("work folder {n}")));
        }
    }
    let common_dir = gitfiles::Repo::find(&project.root).map(|repo| repo.common_dir);
    let mut search = Search { root: &project.root, copies, common_dir, branch_lists: HashMap::new() };
    let mut found = Vec::new();
    let mut missing = Vec::new();
    let mut unavailable = Vec::new();
    for name in &pictures.names {
        let hit = find(&mut search, &places, project, data_dir, name, &pictures.folders);
        match hit {
            Hit::Found(from, file) => found.push(FoundPicture { name: name.clone(), from, file }),
            Hit::NotLocal => unavailable.push(name.clone()),
            Hit::Missing => missing.push(name.clone()),
        }
    }
    Ok(PicturesReply { found, missing, unavailable })
}

/// The paths of a name with a slash below one folder: the plain join, then the join that drops the
/// parts of the folder end that the name starts with (longest overlap first), each once.
fn below_folder(folder: &str, name: &str) -> Vec<String> {
    let mut out = vec![format!("{folder}/{name}")];
    let folder_parts: Vec<&str> = folder.split('/').collect();
    let name_parts: Vec<&str> = name.split('/').collect();
    for overlap in (1..=folder_parts.len().min(name_parts.len() - 1)).rev() {
        if folder_parts[folder_parts.len() - overlap..] == name_parts[..overlap] {
            let rel = format!("{folder}/{}", name_parts[overlap..].join("/"));
            if !out.contains(&rel) {
                out.push(rel);
            }
        }
    }
    out
}

/// Finds one name: a path in each place in order, then below each folder; a bare name in each
/// folder of each place.
fn find(search: &mut Search, places: &[Place], project: &Project, data_dir: Option<&Path>, name: &str, folders: &[String]) -> Hit {
    let path = Path::new(name);
    if path.is_absolute() {
        // An absolute path counts in the project folder (with its work folders) and in the data folder.
        if let Ok(rel) = path.strip_prefix(&project.root) {
            let rel = rel.to_string_lossy().replace('\\', "/");
            return find(search, places, project, data_dir, &rel, folders);
        }
        let inside_data = data_dir.is_some_and(|dir| path.strip_prefix(dir).is_ok_and(|rel| safe_relative(&rel.to_string_lossy()).is_some()));
        return match file_entry(path) {
            Some(file) if inside_data => Hit::Found("data folder".to_string(), file),
            _ => Hit::Missing,
        };
    }
    // A place that holds only a pointer without its object does not stop the search.
    let mut not_local = false;
    if name.contains('/') {
        for place in places {
            match search.at(place, name) {
                At::Found(file) => return Hit::Found(label(place), file),
                At::NotLocal => not_local = true,
                At::Absent => {}
            }
        }
        // A path that the report gives relative to a folder that it named.
        for place in places {
            for folder in folders {
                for rel in below_folder(folder, name) {
                    match search.at(place, &rel) {
                        At::Found(file) => return Hit::Found(label(place), file),
                        At::NotLocal => not_local = true,
                        At::Absent => {}
                    }
                }
            }
        }
        return if not_local { Hit::NotLocal } else { Hit::Missing };
    }
    for place in places {
        for folder in folders {
            for rel in search.bare(place, folder, name) {
                match search.at(place, &rel) {
                    At::Found(file) => return Hit::Found(label(place), file),
                    At::NotLocal => not_local = true,
                    At::Absent => {}
                }
            }
        }
    }
    if not_local { Hit::NotLocal } else { Hit::Missing }
}

/// The pictures that the report of a ticket names, found in the project folder, in a work folder
/// or on the task branch. A picture from outside the project folder is copied into
/// `<data folder>/report-pictures/<project folder name>-<ticket>`.
pub fn report_pictures_call(core: &Core, cwd: String, id: String) -> Result<PicturesReply, String> {
    check_ticket(&id)?;
    let project = Project::find(&cwd)?;
    let report = project.reports.join(format!("{id}.md"));
    let text = fs::read_to_string(&report).map_err(|error| format!("{}: {error}", report.display()))?;
    let data_dir = core.data_dir()?;
    let folder_name = project.root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "project".to_string());
    let copies = data_dir.join("report-pictures").join(format!("{folder_name}-{id}"));
    resolve(&project, &id, &text, &copies, Some(&data_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    /// The path of a file of the reply.
    fn path_of(file: &FileEntry) -> PathBuf {
        PathBuf::from(serde_json::to_value(file).unwrap()["path"].as_str().unwrap())
    }

    fn names(text: &str) -> Vec<String> {
        report_pictures(text, "t1").names
    }

    #[test]
    fn pictures_parser_finds_paths_bare_names_and_links() {
        let text = "Saw `logs/run/shots/a.png`, and ![b](docs/b.JPG). See c.webp in the proof folder.\n\
                    Link [a.png](logs/run/shots/a.png); https://example.com/x.png is a URL.\n\
                    Also logs/…/shots/compare-menu-rock.png and .\\shots\\d.gif: done.";
        assert_eq!(names(text), vec!["logs/run/shots/a.png", "docs/b.JPG", "c.webp", "compare-menu-rock.png", "shots/d.gif"]);
    }

    #[test]
    fn pictures_parser_gives_the_folders_for_bare_names() {
        let found = report_pictures("Shots are in `.dispatch/proof/other/` and logs/x/y.png; card.png too.", "t1");
        assert_eq!(found.names, vec!["logs/x/y.png", "card.png"]);
        assert_eq!(found.folders, vec![".dispatch/proof/other", "logs/x", ".dispatch/proof/t1"]);
    }

    #[test]
    fn pictures_parser_skips_other_files_and_keeps_thirty() {
        assert!(names("notes.md, a.pngx, .png, picture.png.txt").is_empty());
        let many: String = (0..40).map(|n| format!("p{n}.png ")).collect();
        assert_eq!(names(&many).len(), MAX_PICTURES);
        assert_eq!(names("**a.png** a.png! A.png?"), vec!["a.png", "A.png"]);
    }

    fn git(root: &Path, args: &[&str]) {
        let status = Command::new("git").arg("-C").arg(root).args(args).output().unwrap();
        assert!(status.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&status.stderr));
    }

    fn scratch(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("dispatch-pictures-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn pictures_resolve_in_project_work_folder_and_branch() {
        let root = scratch("resolve");
        git(&root, &["init", "-q"]);
        let config = root.join(".git").join("config");
        let mut text = fs::read_to_string(&config).unwrap();
        text.push_str("[user]\n\tname = Dispatch test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\texcludesFile = no-such-ignore-file\n");
        fs::write(&config, text).unwrap();
        fs::write(root.join("readme.txt"), "x").unwrap();
        git(&root, &["add", "readme.txt"]);
        git(&root, &["commit", "-q", "-m", "base"]);
        // A picture only in a commit of the task branch.
        git(&root, &["checkout", "-q", "-b", "task/t1"]);
        fs::create_dir_all(root.join("shots")).unwrap();
        fs::write(root.join("shots").join("branch.png"), b"branch bytes").unwrap();
        fs::create_dir_all(root.join(".dispatch/proof/t1/deep")).unwrap();
        fs::write(root.join(".dispatch/proof/t1/deep/bare-branch.png"), b"bare bytes").unwrap();
        git(&root, &["add", "shots/branch.png", ".dispatch/proof/t1/deep/bare-branch.png"]);
        git(&root, &["commit", "-q", "-m", "shots"]);
        git(&root, &["checkout", "-q", "-"]);
        assert!(!root.join("shots").join("branch.png").exists());
        let project = Project::scratch(root.clone(), root.join(".dispatch"));
        fs::create_dir_all(&project.reports).unwrap();
        fs::write(project.branch_file("t1"), "branch: task/t1\nbase: master\n").unwrap();
        // A picture in the project folder, and one only in the work folder of the task.
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs").join("here.png"), b"here").unwrap();
        let work = root.join(".dispatch").join("work");
        fs::create_dir_all(work.join("1").join("logs")).unwrap();
        fs::write(work.join("1.record"), "ticket: t1\n").unwrap();
        fs::write(work.join("1").join("logs").join("work.png"), b"work bytes").unwrap();
        let copies = root.join("copies");
        fs::create_dir_all(&copies).unwrap();
        fs::write(copies.join("old.png"), b"old").unwrap();
        let report = "Shots: docs/here.png, logs/work.png, shots/branch.png, bare-branch.png and gone/none.png.";
        let reply = resolve(&project, "t1", report, &copies, None).unwrap();
        assert!(!copies.join("old.png").exists(), "the call empties the copy folder");
        let got: Vec<(&str, &str)> = reply.found.iter().map(|found| (found.name.as_str(), found.from.as_str())).collect();
        assert_eq!(got, vec![("docs/here.png", "project"), ("logs/work.png", "work folder 1"), ("shots/branch.png", "branch task/t1"), ("bare-branch.png", "branch task/t1")]);
        assert_eq!(reply.missing, vec!["gone/none.png"]);
        assert_eq!(path_of(&reply.found[0].file), root.join("docs").join("here.png"));
        for (at, rel, bytes) in [(1, "logs/work.png", "work bytes"), (2, "shots/branch.png", "branch bytes"), (3, ".dispatch/proof/t1/deep/bare-branch.png", "bare bytes")] {
            assert_eq!(path_of(&reply.found[at].file), copies.join(rel), "a copy outside the project folder");
            assert_eq!(fs::read_to_string(copies.join(rel)).unwrap(), bytes);
        }
        let _ = fs::remove_dir_all(&root);
    }

    fn pointer(oid: &str, size: usize) -> String {
        format!("version https://git-lfs.github.com/spec/v1\noid sha256:{oid}\nsize {size}\n")
    }

    #[test]
    fn pictures_lfs_pointer_parse() {
        let oid = "a".repeat(64);
        assert_eq!(lfs_pointer(pointer(&oid, 12).as_bytes()), Some((oid.clone(), 12)));
        assert_eq!(lfs_pointer(b"just text"), None);
        assert_eq!(lfs_pointer(&vec![b'x'; 2000]), None);
        assert_eq!(lfs_pointer(pointer("abc", 1).as_bytes()), None, "a short oid is no pointer");
    }

    #[test]
    fn pictures_resolve_lfs_pointers() {
        let root = scratch("lfs");
        git(&root, &["init", "-q"]);
        let config = root.join(".git").join("config");
        let mut text = fs::read_to_string(&config).unwrap();
        text.push_str("[user]\n\tname = Dispatch test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\texcludesFile = no-such-ignore-file\n");
        fs::write(&config, text).unwrap();
        fs::write(root.join("readme.txt"), "x").unwrap();
        git(&root, &["add", "readme.txt"]);
        git(&root, &["commit", "-q", "-m", "base"]);
        let real = b"real picture bytes";
        let oid = "b".repeat(64);
        let object = root.join(".git/lfs/objects").join(&oid[0..2]).join(&oid[2..4]);
        fs::create_dir_all(&object).unwrap();
        fs::write(object.join(&oid), real).unwrap();
        git(&root, &["checkout", "-q", "-b", "task/t1"]);
        fs::create_dir_all(root.join("shots")).unwrap();
        fs::write(root.join("shots/lfs.png"), pointer(&oid, real.len())).unwrap();
        fs::write(root.join("shots/gone.png"), pointer(&"c".repeat(64), 99)).unwrap();
        git(&root, &["add", "shots/lfs.png", "shots/gone.png"]);
        git(&root, &["commit", "-q", "-m", "shots"]);
        git(&root, &["checkout", "-q", "-"]);
        let project = Project::scratch(root.clone(), root.join(".dispatch"));
        fs::create_dir_all(&project.reports).unwrap();
        fs::write(project.branch_file("t1"), "branch: task/t1\nbase: master\n").unwrap();
        fs::create_dir_all(root.join("docs")).unwrap();
        fs::write(root.join("docs/pointer.png"), pointer(&oid, real.len())).unwrap();
        let copies = root.join("copies");
        let reply = resolve(&project, "t1", "Pictures: shots/lfs.png, docs/pointer.png, shots/gone.png.", &copies, None).unwrap();
        let got: Vec<(&str, &str)> = reply.found.iter().map(|found| (found.name.as_str(), found.from.as_str())).collect();
        assert_eq!(got, vec![("shots/lfs.png", "branch task/t1"), ("docs/pointer.png", "project")]);
        assert_eq!(fs::read(copies.join("shots/lfs.png")).unwrap(), real);
        assert_eq!(path_of(&reply.found[1].file), copies.join("docs/pointer.png"));
        assert_eq!(fs::read(copies.join("docs/pointer.png")).unwrap(), real);
        assert_eq!(reply.unavailable, vec!["shots/gone.png"]);
        assert!(reply.missing.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pictures_resolve_paths_below_named_folders() {
        let root = scratch("below");
        git(&root, &["init", "-q"]);
        let config = root.join(".git").join("config");
        let mut text = fs::read_to_string(&config).unwrap();
        text.push_str("[user]\n\tname = Dispatch test\n\temail = test@example.invalid\n[commit]\n\tgpgsign = false\n[core]\n\texcludesFile = no-such-ignore-file\n");
        fs::write(&config, text).unwrap();
        fs::write(root.join("readme.txt"), "x").unwrap();
        git(&root, &["add", "readme.txt"]);
        git(&root, &["commit", "-q", "-m", "base"]);
        git(&root, &["checkout", "-q", "-b", "task/t1"]);
        fs::create_dir_all(root.join("logs/run/shots/before")).unwrap();
        fs::create_dir_all(root.join("logs/run/other")).unwrap();
        fs::write(root.join("logs/run/shots/before/a.png"), b"a bytes").unwrap();
        fs::write(root.join("logs/run/other/b.png"), b"b bytes").unwrap();
        git(&root, &["add", "logs/run/shots/before/a.png", "logs/run/other/b.png"]);
        git(&root, &["commit", "-q", "-m", "shots"]);
        git(&root, &["checkout", "-q", "-"]);
        let project = Project::scratch(root.clone(), root.join(".dispatch"));
        fs::create_dir_all(&project.reports).unwrap();
        fs::write(project.branch_file("t1"), "branch: task/t1\nbase: master\n").unwrap();
        let copies = root.join("copies");
        fs::create_dir_all(&copies).unwrap();
        let report = "Pictures are in logs/run/shots/ and logs/run/. Files: shots/before/a.png and other/b.png.";
        let reply = resolve(&project, "t1", report, &copies, None).unwrap();
        let got: Vec<(&str, &str)> = reply.found.iter().map(|found| (found.name.as_str(), found.from.as_str())).collect();
        assert_eq!(got, vec![("shots/before/a.png", "branch task/t1"), ("other/b.png", "branch task/t1")]);
        assert!(reply.missing.is_empty());
        assert_eq!(path_of(&reply.found[0].file), copies.join("logs/run/shots/before/a.png"));
        assert_eq!(path_of(&reply.found[1].file), copies.join("logs/run/other/b.png"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pictures_skip_paths_outside_the_project() {
        let root = scratch("outside");
        let project = Project::scratch(root.clone(), root.join(".dispatch"));
        let outside = scratch("outside-file");
        fs::write(outside.join("x.png"), b"x").unwrap();
        let report = format!("{} and ../outside/x.png", outside.join("x.png").display());
        let reply = resolve(&project, "t1", &report, &root.join("copies"), None).unwrap();
        assert!(reply.found.is_empty());
        assert_eq!(reply.missing.len(), 2);
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }
}
