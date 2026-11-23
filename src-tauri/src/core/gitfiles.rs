//! The facts of a git repository from its files, with no program start (ticket
//! dispatch-starts-the-git-program-for-each). A look of Dispatch at a project asked git about 11
//! small questions, one program each; the branch, the git folder, the refs and the merge markers
//! are plain files, and this module reads them. Git keeps the answers that need the index or the
//! objects (`ls-files`, `rev-parse --short`), and three caches keep those answers while the index
//! did not change. `git_program()` names the git program that every git command of the app starts:
//! the real `git.exe` in place of the small launcher of Git for Windows (user decision 2).

use std::collections::HashMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use crate::core::info::git;

/// A git repository: its top folder, its git folder (the one of the worktree, with `HEAD`, `index`
/// and the merge markers) and the common folder (the refs, `packed-refs` and the objects; the git
/// folder itself in a plain repository).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Repo {
    pub(crate) top: PathBuf,
    pub(crate) git_dir: PathBuf,
    pub(crate) common_dir: PathBuf,
}

/// The refs that live in the git folder of a worktree, not in the common folder.
const WORKTREE_REFS: [&str; 3] = ["refs/bisect/", "refs/worktree/", "refs/rewritten/"];
/// How many `ref: ` lines a ref read follows before it gives up.
const REF_STEPS: usize = 5;

/// A line is a full hash: 40 (SHA-1) or 64 (SHA-256) hex digits.
fn is_hash(text: &str) -> bool {
    (text.len() == 40 || text.len() == 64) && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// The path as git prints it on Windows, in the form of the code: backslashes, the drive letter in
/// upper case, no separator at the end, and the parts `.` and `..` folded (`commondir` of a worktree
/// says `../..`). `fs::canonicalize` is not used: it adds `\\?\`.
fn windows_form(path: &Path) -> PathBuf {
    let text = path.to_string_lossy().replace('/', "\\");
    let mut parts: Vec<&str> = Vec::new();
    for (at, part) in text.split('\\').enumerate() {
        match part {
            "." => {}
            "" if at > 1 => {}
            ".." => match parts.last() {
                // A folder goes; the root of a drive stays; a relative path keeps its `..`.
                Some(last) if !last.is_empty() && !last.ends_with(':') && *last != ".." => {
                    parts.pop();
                }
                Some(last) if last.is_empty() || last.ends_with(':') => {}
                _ => parts.push(part),
            },
            part => parts.push(part),
        }
    }
    let mut text = parts.join("\\");
    if text.len() == 2 && text.ends_with(':') {
        text.push('\\');
    }
    let mut bytes = text.into_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_lowercase() {
        bytes[0] = bytes[0].to_ascii_uppercase();
    }
    PathBuf::from(String::from_utf8(bytes).unwrap_or_default())
}

/// The folder that a `.git` entry names: the folder itself, or the folder of a worktree that the
/// file `.git` names with `gitdir: <path>` (relative to the folder of the file, forward slashes).
/// None for a git folder without `HEAD`.
fn git_dir_of(dot_git: &Path) -> Option<PathBuf> {
    let meta = fs::metadata(dot_git).ok()?;
    let dir = if meta.is_dir() {
        dot_git.to_path_buf()
    } else {
        let text = fs::read_to_string(dot_git).ok()?;
        let target = text.lines().next()?.strip_prefix("gitdir:")?.trim();
        if target.is_empty() {
            return None;
        }
        let target = Path::new(target);
        if target.is_absolute() { windows_form(target) } else { windows_form(&dot_git.parent()?.join(target)) }
    };
    dir.join("HEAD").is_file().then_some(dir)
}

impl Repo {
    /// The repository of a folder: the nearest ancestor of `cwd` (`cwd` first) with a `.git` entry.
    /// None outside a work tree, as `git rev-parse --show-toplevel` fails there.
    pub(crate) fn find(cwd: &Path) -> Option<Repo> {
        let mut folder = Some(windows_form(cwd));
        while let Some(dir) = folder {
            if let Some(git_dir) = git_dir_of(&dir.join(".git")) {
                let common_dir = match fs::read_to_string(git_dir.join("commondir")) {
                    Ok(text) => {
                        let common = Path::new(text.trim());
                        if common.is_absolute() { windows_form(common) } else { windows_form(&git_dir.join(common)) }
                    }
                    Err(_) => git_dir.clone(),
                };
                return Some(Repo { top: dir, git_dir, common_dir });
            }
            folder = dir.parent().map(Path::to_path_buf);
        }
        None
    }

    /// False when the repository keeps its refs in the reftable format: the files below do not hold
    /// them, and the callers ask git as before.
    pub(crate) fn refs_readable(&self) -> bool {
        !self.common_dir.join("reftable").is_dir()
    }

    /// The first line of the file `HEAD` of the worktree.
    fn head_line(&self) -> Option<String> {
        fs::read_to_string(self.git_dir.join("HEAD")).ok()?.lines().next().map(|line| line.trim().to_string())
    }

    /// The branch that `HEAD` names, as `git symbolic-ref --short HEAD` gives it; none for a detached
    /// checkout. A symbolic ref to another kind of ref gives its name after `refs/`.
    pub(crate) fn head_branch(&self) -> Option<String> {
        let line = self.head_line()?;
        let target = line.strip_prefix("ref:")?.trim();
        let name = target.strip_prefix("refs/heads/").or_else(|| target.strip_prefix("refs/"))?;
        (!name.is_empty()).then(|| name.to_string())
    }

    /// The hash of `HEAD`; none for an unborn branch.
    pub(crate) fn head_hash(&self) -> Option<String> {
        self.resolve("HEAD", REF_STEPS)
    }

    /// The hash of a ref by its full name (`refs/heads/main`): the loose file, a `ref: ` line
    /// followed, else the line of `packed-refs`. None when the ref does not exist.
    pub(crate) fn ref_hash(&self, name: &str) -> Option<String> {
        self.resolve(name, REF_STEPS)
    }

    /// The folder of a ref file: `HEAD` and the per-worktree refs in the git folder, the others in
    /// the common folder.
    fn ref_folder(&self, name: &str) -> &Path {
        if name == "HEAD" || WORKTREE_REFS.iter().any(|prefix| name.starts_with(prefix)) { &self.git_dir } else { &self.common_dir }
    }

    fn resolve(&self, name: &str, steps: usize) -> Option<String> {
        if steps == 0 || name.is_empty() || name.contains("..") {
            return None;
        }
        let file = self.ref_folder(name).join(name.replace('/', "\\"));
        match fs::read_to_string(&file) {
            Ok(text) => {
                let line = text.lines().next()?.trim();
                if let Some(target) = line.strip_prefix("ref:") {
                    return self.resolve(target.trim(), steps - 1);
                }
                is_hash(line).then(|| line.to_string())
            }
            Err(_) => self.packed_ref(name),
        }
    }

    /// The hash of a ref in `packed-refs`: the line `<hash> <name>`. The header `# pack-refs` and the
    /// peeled lines `^<hash>` do not count.
    fn packed_ref(&self, name: &str) -> Option<String> {
        let text = fs::read_to_string(self.common_dir.join("packed-refs")).ok()?;
        text.lines().filter(|line| !line.starts_with('#') && !line.starts_with('^')).find_map(|line| {
            let (hash, this) = line.trim_end().split_once(' ')?;
            (this == name && is_hash(hash)).then(|| hash.to_string())
        })
    }

    /// The first line of `MERGE_HEAD`, as `git rev-parse -q --verify MERGE_HEAD` gives it; none
    /// without an open merge.
    pub(crate) fn merge_head(&self) -> Option<String> {
        let text = fs::read_to_string(self.marker("MERGE_HEAD")).ok()?;
        let line = text.lines().next()?.trim();
        is_hash(line).then(|| line.to_string())
    }

    /// The path of a marker of git in the git folder of the worktree: `MERGE_HEAD`, `REBASE_HEAD`,
    /// `rebase-merge` and the others.
    pub(crate) fn marker(&self, name: &str) -> PathBuf {
        self.git_dir.join(name)
    }

    /// The modified time and the length of the index file: a key of the answers that git reads
    /// from the index. None without an index (no `git add` yet).
    pub(crate) fn index_stamp(&self) -> Option<(SystemTime, u64)> {
        let meta = fs::metadata(self.git_dir.join("index")).ok()?;
        Some((meta.modified().ok()?, meta.len()))
    }
}

type Stamp = Option<(SystemTime, u64)>;
type Cache<V> = OnceLock<Mutex<HashMap<(PathBuf, String), (Stamp, V)>>>;

/// A value kept under a key while a stamp is the same: the answer comes from `ask` once per stamp.
/// Without a stamp (`None`) the question goes to `ask` each time.
fn with_stamp<V: Clone>(cache: &'static Cache<V>, stamp: Stamp, key: (PathBuf, String), ask: impl FnOnce() -> V) -> V {
    let map = cache.get_or_init(Default::default);
    if stamp.is_some() {
        if let Some((known, value)) = map.lock().ok().and_then(|map| map.get(&key).cloned()) {
            if known == stamp {
                return value;
            }
        }
    }
    let value = ask();
    if stamp.is_some() {
        if let Ok(mut map) = map.lock() {
            map.insert(key, (stamp, value.clone()));
        }
    }
    value
}

/// One entry of the index file: its path from the top folder and its stage (0 for a plain entry,
/// 1 to 3 for the sides of an unmerged file).
#[derive(Clone, Debug, PartialEq)]
struct IndexEntry {
    path: String,
    stage: u8,
}

/// The varint of the index format version 4: 7 bits per byte, high bit set on all but the last, each
/// further byte adds one (`decode_varint` of git). Gives the value and the bytes read.
fn varint(bytes: &[u8]) -> Option<(usize, usize)> {
    let mut at = 0;
    let mut byte = *bytes.get(at)?;
    at += 1;
    let mut value = usize::from(byte & 127);
    while byte & 128 != 0 {
        byte = *bytes.get(at)?;
        at += 1;
        value = (value + 1).checked_shl(7)? + usize::from(byte & 127);
    }
    Some((value, at))
}

/// The entries of an index file (format versions 2, 3 and 4; SHA-1 or SHA-256 hashes). None for a
/// file that this reader does not take: another version, a split index (extension `link`, whose
/// entries are partly in another file), a sparse index (extension `sdir`, whose folder entries stand
/// for the files below them), or a file that does not parse. The callers then ask git.
fn parse_index(bytes: &[u8], hash_len: usize) -> Option<Vec<IndexEntry>> {
    if bytes.len() < 12 + hash_len || &bytes[..4] != b"DIRC" {
        return None;
    }
    let word = |at: usize| Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?));
    let version = word(4)?;
    if !(2..=4).contains(&version) {
        return None;
    }
    let count = word(8)? as usize;
    let end = bytes.len() - hash_len;
    let mut entries = Vec::with_capacity(count);
    let mut at = 12;
    let mut previous = String::new();
    for _ in 0..count {
        let start = at;
        let flags = u16::from_be_bytes(bytes.get(at + 40 + hash_len..at + 42 + hash_len)?.try_into().ok()?);
        at += 42 + hash_len;
        if version >= 3 && flags & 0x4000 != 0 {
            at += 2;
        }
        let stage = ((flags >> 12) & 3) as u8;
        let path = if version == 4 {
            let (strip, used) = varint(bytes.get(at..)?)?;
            at += used;
            let suffix_end = at + bytes.get(at..end)?.iter().position(|byte| *byte == 0)?;
            let kept = previous.len().checked_sub(strip)?;
            let mut path = previous[..kept].to_string();
            path.push_str(std::str::from_utf8(&bytes[at..suffix_end]).ok()?);
            at = suffix_end + 1;
            path
        } else {
            let name_end = at + bytes.get(at..end)?.iter().position(|byte| *byte == 0)?;
            let path = std::str::from_utf8(&bytes[at..name_end]).ok()?.to_string();
            // The entry is padded with NULs to a multiple of 8 bytes, with at least one NUL.
            at = start + (name_end + 1 - start).div_ceil(8) * 8;
            path
        };
        previous.clone_from(&path);
        entries.push(IndexEntry { path, stage });
    }
    // The extensions: a signature and a size each, up to the hash at the end.
    while at + 8 <= end {
        let signature = &bytes[at..at + 4];
        let size = word(at + 4)? as usize;
        if signature == b"link" || signature == b"sdir" {
            return None;
        }
        at = at.checked_add(8 + size)?;
    }
    (at == end).then_some(entries)
}

/// The entries of the index of a worktree, read from the file and kept while the index stamp is the
/// same; none when the reader does not take the file (the callers then ask git). An empty list
/// without an index file: nothing is tracked and nothing is unmerged before the first `git add`.
fn index_entries(repo: &Repo) -> Option<std::sync::Arc<Vec<IndexEntry>>> {
    static ENTRIES: Cache<Option<std::sync::Arc<Vec<IndexEntry>>>> = OnceLock::new();
    let stamp = repo.index_stamp();
    if stamp.is_none() {
        return Some(std::sync::Arc::new(Vec::new()));
    }
    with_stamp(&ENTRIES, stamp, (repo.git_dir.clone(), String::new()), || {
        let bytes = fs::read(repo.git_dir.join("index")).ok()?;
        let config = fs::read_to_string(repo.common_dir.join("config")).unwrap_or_default().to_ascii_lowercase();
        let hash_len = if config.contains("objectformat") && config.contains("sha256") { 32 } else { 20 };
        parse_index(&bytes, hash_len).map(std::sync::Arc::new)
    })
}

/// A path of the index is under a pathspec of the callers: the spec itself or a folder above it.
fn under(path: &str, spec: &str) -> bool {
    let spec = spec.trim_end_matches('/');
    spec == "." || path == spec || path.strip_prefix(spec).is_some_and(|rest| rest.starts_with('/'))
}

/// The index has an unmerged entry under `path`: from the index file, or from `git ls-files -u` when
/// the reader does not take the file (kept with the index stamp then).
pub(crate) fn unmerged(repo: &Repo, path: &str) -> bool {
    if let Some(entries) = index_entries(repo) {
        return entries.iter().any(|entry| entry.stage != 0 && under(&entry.path, path));
    }
    static UNMERGED: Cache<bool> = OnceLock::new();
    with_stamp(&UNMERGED, repo.index_stamp(), (repo.git_dir.clone(), path.to_string()), || git(&repo.top, &["ls-files", "-u", "--", path]).is_some_and(|text| !text.trim().is_empty()))
}

/// The tracked files under `paths`, from the top folder, as `git ls-files -- <paths>` lists them
/// (an unmerged file once per stage): from the index file, or from one `git ls-files -z` when the
/// reader does not take the file (kept with the index stamp then).
pub(crate) fn tracked(repo: &Repo, paths: &[&str]) -> Vec<String> {
    if let Some(entries) = index_entries(repo) {
        return entries.iter().filter(|entry| paths.iter().any(|spec| under(&entry.path, spec))).map(|entry| entry.path.clone()).collect();
    }
    static TRACKED: Cache<Vec<String>> = OnceLock::new();
    with_stamp(&TRACKED, repo.index_stamp(), (repo.git_dir.clone(), paths.join("\n")), || {
        let mut args = vec!["ls-files", "-z", "--"];
        args.extend(paths);
        git(&repo.top, &args).unwrap_or_default().split('\0').filter(|path| !path.is_empty()).map(str::to_string).collect()
    })
}

/// The ignore files that decide the paths of the callers (the local settings file and the notes
/// files under `.claude`): the root `.gitignore`, `.claude/.gitignore` and `info/exclude` of the
/// repository. The global excludes file of the user is not watched.
const IGNORE_FILES: [&str; 2] = [".gitignore", ".claude/.gitignore"];

/// The modified times and lengths of the ignore files, as one stamp of the ignore rules; a file
/// that does not exist counts as such.
fn ignore_stamp(repo: &Repo) -> Stamp {
    let files = IGNORE_FILES.iter().map(|file| repo.top.join(file)).chain([repo.common_dir.join("info").join("exclude")]);
    let mut time = SystemTime::UNIX_EPOCH;
    let mut length = 0u64;
    for (at, file) in files.enumerate() {
        if let Ok(meta) = fs::metadata(&file) {
            if let Ok(modified) = meta.modified() {
                time = time.max(modified);
            }
            // The lengths and the presence of the files, in one number.
            length = length.wrapping_mul(1_000_003).wrapping_add(meta.len() + 1 + at as u64);
        } else {
            length = length.wrapping_mul(1_000_003);
        }
    }
    Some((time, length))
}

/// The paths among `paths` that an ignore rule of the repository names: the output of one
/// `git check-ignore --no-index` (it prints the ignored paths and exits 1 with no output when none is
/// ignored; `--no-index`: a rule counts also while git still tracks the file), kept while the ignore
/// files did not change.
pub(crate) fn ignored(repo: &Repo, paths: &[&str]) -> Vec<String> {
    static IGNORED: Cache<Vec<String>> = OnceLock::new();
    with_stamp(&IGNORED, ignore_stamp(repo), (repo.top.clone(), paths.join("\n")), || {
        let mut args = vec!["check-ignore", "--no-index"];
        args.extend(paths);
        git(&repo.top, &args).unwrap_or_default().lines().map(|line| line.trim().trim_matches('"').to_string()).filter(|line| !line.is_empty()).collect()
    })
}

/// The short form of a full hash, as `git rev-parse --short` gives it, kept per hash.
pub(crate) fn short_hash(repo: &Repo, hash: &str) -> Option<String> {
    static SHORT: OnceLock<Mutex<HashMap<(PathBuf, String), String>>> = OnceLock::new();
    let key = (repo.common_dir.clone(), hash.to_string());
    let map = SHORT.get_or_init(Default::default);
    if let Some(short) = map.lock().ok().and_then(|map| map.get(&key).cloned()) {
        return Some(short);
    }
    let short = git(&repo.top, &["rev-parse", "--short", hash]).map(|text| text.trim().to_string()).filter(|text| !text.is_empty())?;
    if let Ok(mut map) = map.lock() {
        map.insert(key, short.clone());
    }
    Some(short)
}

/// The tag refs of a repository from its files, sorted by full name: each loose file under
/// `refs/tags` (its first line) and each tag line of `packed-refs` that no loose file covers. A
/// change of this list is a change of the tags. None when the refs are not plain files (reftable).
pub(crate) fn tag_refs(repo: &Repo) -> Option<Vec<(String, String)>> {
    if !repo.refs_readable() {
        return None;
    }
    let mut refs: HashMap<String, String> = HashMap::new();
    let mut folders = vec![(repo.common_dir.join("refs").join("tags"), "refs/tags".to_string())];
    while let Some((folder, prefix)) = folders.pop() {
        for entry in fs::read_dir(&folder).into_iter().flatten().flatten() {
            let name = format!("{prefix}/{}", entry.file_name().to_string_lossy());
            let path = entry.path();
            if path.is_dir() {
                folders.push((path, name));
            } else if !name.ends_with(".lock") {
                let line = fs::read_to_string(&path).ok().and_then(|text| text.lines().next().map(|line| line.trim().to_string())).unwrap_or_default();
                refs.insert(name, line);
            }
        }
    }
    let packed = fs::read_to_string(repo.common_dir.join("packed-refs")).unwrap_or_default();
    for line in packed.lines().filter(|line| !line.starts_with('#') && !line.starts_with('^')) {
        let Some((hash, name)) = line.trim_end().split_once(' ') else { continue };
        if name.starts_with("refs/tags/") && is_hash(hash) {
            refs.entry(name.to_string()).or_insert_with(|| hash.to_string());
        }
    }
    let mut refs: Vec<(String, String)> = refs.into_iter().collect();
    refs.sort();
    Some(refs)
}

/// The output of `git for-each-ref --format=%(refname:short) %(creatordate:unix) refs/tags`, kept
/// per common folder while `tag_refs` gives the same list (user decision 2 of ticket
/// the-side-panel-and-the-token-events-read): the time of a tag is fixed by its object, so the same
/// names and hashes give the same text. Without readable refs git answers each time.
pub(crate) fn tag_dates(repo: &Repo) -> String {
    static DATES: OnceLock<Mutex<HashMap<PathBuf, (Vec<(String, String)>, String)>>> = OnceLock::new();
    let ask = || git(&repo.top, &["for-each-ref", "--format=%(refname:short) %(creatordate:unix)", "refs/tags"]);
    let Some(refs) = tag_refs(repo) else { return ask().unwrap_or_default() };
    let map = DATES.get_or_init(Default::default);
    if let Some((known, text)) = map.lock().ok().and_then(|map| map.get(&repo.common_dir).cloned()) {
        if known == refs {
            return text;
        }
    }
    // A failed call is not kept: the next read asks again.
    let Some(text) = ask() else { return String::new() };
    if let Ok(mut map) = map.lock() {
        map.insert(repo.common_dir.clone(), (refs, text.clone()));
    }
    text
}

/// The git program of the app and the environment of its child (user decision 2 of ticket
/// dispatch-starts-the-git-program-for-each).
pub(crate) struct GitProgram {
    /// `git`, or the real `git.exe` of Git for Windows when PATH names its launcher `cmd\git.exe`.
    pub(crate) program: OsString,
    /// The PATH of the child with `mingw64\bin` and `usr\bin` of Git in front, as the launcher sets
    /// it; none when the program is `git`.
    path: Option<OsString>,
}

impl GitProgram {
    /// A command of the program with its environment. `MSYSTEM` goes: with the real `git.exe` and
    /// without the launcher, `MSYSTEM=MINGW64` of a Git Bash around the app has crashed `git push`.
    pub(crate) fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        if let Some(path) = &self.path {
            command.env("PATH", path);
            command.env_remove("MSYSTEM");
        }
        command
    }
}

/// The git program that every git command of the app starts, found once: the first `git.exe` on
/// PATH. When it is the launcher `<Git>\cmd\git.exe` and `<Git>\mingw64\bin\git.exe` exists, that
/// program runs directly, with `<Git>\mingw64\bin;<Git>\usr\bin` in front of the PATH of the child;
/// each git start of Dispatch then costs one program in place of two. Any other git stays `git`.
pub(crate) fn git_program() -> &'static GitProgram {
    static PROGRAM: OnceLock<GitProgram> = OnceLock::new();
    PROGRAM.get_or_init(|| {
        let plain = GitProgram { program: OsString::from("git"), path: None };
        let Some(path) = std::env::var_os("PATH") else { return plain };
        let found = std::env::split_paths(&path).filter(|dir| !dir.as_os_str().is_empty()).map(|dir| dir.join("git.exe")).find(|exe| exe.is_file());
        let Some(launcher) = found else { return plain };
        let is_cmd = launcher.parent().and_then(|dir| dir.file_name()).and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case("cmd"));
        let Some(git_root) = launcher.parent().and_then(Path::parent).filter(|_| is_cmd) else { return plain };
        let direct = git_root.join("mingw64").join("bin").join("git.exe");
        if !direct.is_file() {
            return plain;
        }
        let mut front = OsString::from(git_root.join("mingw64").join("bin"));
        front.push(";");
        front.push(git_root.join("usr").join("bin"));
        front.push(";");
        front.push(&path);
        GitProgram { program: direct.into_os_string(), path: Some(front) }
    })
}

#[cfg(test)]
thread_local! {
    /// The git starts of this thread in the tests: all of them, and those with `--no-optional-locks`
    /// (the reads of `info::git`). A test resets the pair, runs one look and reads it.
    pub(crate) static STARTS: std::cell::Cell<(usize, usize)> = const { std::cell::Cell::new((0, 0)) };
}

/// Counts one git start of this thread in the tests. With `DISPATCH_TRACE_GIT` set, it also prints
/// the arguments of each start to stderr.
#[cfg(test)]
pub(crate) fn count_start(no_optional_locks: bool, args: &[&str]) {
    STARTS.with(|starts| {
        let (all, reads) = starts.get();
        starts.set((all + 1, reads + usize::from(no_optional_locks)));
    });
    if std::env::var_os("DISPATCH_TRACE_GIT").is_some() {
        eprintln!("git start: {}{}", if no_optional_locks { "--no-optional-locks " } else { "" }, args.join(" "));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::pipeline::tests::{clean, git_scratch};

    /// Runs git in a folder and gives its output; a failed command gives None, as `info::git` does.
    fn ask(cwd: &Path, args: &[&str]) -> Option<String> {
        let output = git_program().command().arg("-C").arg(cwd).args(args).output().unwrap();
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn run(cwd: &Path, args: &[&str]) -> String {
        let output = git_program().command().arg("-C").arg(cwd).args(args).output().unwrap();
        assert!(output.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&output.stderr));
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn commit(root: &Path, name: &str) {
        fs::write(root.join(name), name).unwrap();
        run(root, &["add", "--", name]);
        run(root, &["commit", "-q", "-m", name, "--", name]);
    }

    /// Every fact of the files against the answer of git, in one checkout.
    fn same_as_git(cwd: &Path, label: &str) -> Repo {
        let repo = Repo::find(cwd).unwrap_or_else(|| panic!("{label}: no repository at {}", cwd.display()));
        let top = windows_form(Path::new(&ask(cwd, &["rev-parse", "--show-toplevel"]).unwrap()));
        assert_eq!(repo.top, top, "{label}: the top folder");
        let git_dir = windows_form(Path::new(&ask(cwd, &["rev-parse", "--absolute-git-dir"]).unwrap()));
        assert_eq!(repo.git_dir, git_dir, "{label}: the git folder");
        let common = windows_form(Path::new(&ask(cwd, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).unwrap()));
        assert_eq!(repo.common_dir, common, "{label}: the common folder");
        assert_eq!(repo.head_branch(), ask(cwd, &["symbolic-ref", "--short", "-q", "HEAD"]).filter(|name| !name.is_empty()), "{label}: the branch");
        assert_eq!(repo.head_hash(), ask(cwd, &["rev-parse", "--verify", "--quiet", "HEAD"]), "{label}: the hash of HEAD");
        assert_eq!(repo.merge_head(), ask(cwd, &["rev-parse", "-q", "--verify", "MERGE_HEAD"]), "{label}: MERGE_HEAD");
        for name in ["refs/heads/main", "refs/heads/task/t-1", "refs/heads/task/t-2", "refs/heads/none", "refs/tags/v1", "refs/remotes/origin/main"] {
            assert_eq!(repo.ref_hash(name), ask(cwd, &["rev-parse", "--verify", "--quiet", name]), "{label}: {name}");
        }
        for name in ["MERGE_HEAD", "REBASE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge"] {
            assert_eq!(repo.marker(name).exists(), git_dir.join(name).exists(), "{label}: the marker {name}");
        }
        same_index_as_git(&repo, label);
        repo
    }

    /// The tracked and the unmerged entries from the index file against `git ls-files`, for several
    /// pathspecs, and the ignored paths against `git check-ignore`.
    fn same_index_as_git(repo: &Repo, label: &str) {
        let top = &repo.top;
        for specs in [vec!["."], vec!["one.txt", "deep"], vec![".claude/settings.local.json", ".dispatch"], vec!["none"]] {
            let mut args = vec!["ls-files", "-z", "--"];
            args.extend(&specs);
            let expected: Vec<String> = ask(top, &args).unwrap_or_default().split('\0').filter(|path| !path.is_empty()).map(str::to_string).collect();
            assert_eq!(tracked(repo, &specs), expected, "{label}: tracked {specs:?}");
            for spec in &specs {
                let expected = ask(top, &["ls-files", "-u", "--", spec]).is_some_and(|text| !text.trim().is_empty());
                assert_eq!(unmerged(repo, spec), expected, "{label}: unmerged {spec}");
            }
        }
        let paths = [".claude/settings.local.json", ".claude/memory.md", "deep/er/three.txt", "one.txt", "ignored.txt"];
        let mut args = vec!["check-ignore", "--no-index"];
        args.extend(paths);
        let expected: Vec<String> = ask(top, &args).unwrap_or_default().lines().map(str::to_string).collect();
        assert_eq!(ignored(repo, &paths), expected, "{label}: ignored");
    }

    #[test]
    fn gitfiles_facts_equal_the_answers_of_git() {
        let project = git_scratch("gitfiles");
        let root = project.root.clone();
        // A plain repository: an unborn branch, then commits, a branch, a tag and a folder below the top.
        let repo = same_as_git(&root, "unborn");
        assert!(repo.head_branch().is_some(), "an unborn branch has a name");
        assert_eq!(repo.head_hash(), None);
        run(&root, &["checkout", "-q", "-b", "main"]);
        commit(&root, "one.txt");
        commit(&root, "two.txt");
        run(&root, &["branch", "task/t-1"]);
        run(&root, &["tag", "v1"]);
        let sub = root.join("deep").join("er");
        fs::create_dir_all(&sub).unwrap();
        same_as_git(&root, "plain");
        let repo = same_as_git(&sub, "a folder below the top");
        assert_eq!(repo.top, root);
        // The index stamp changes with `git add`, and `tracked` and `unmerged` follow git.
        assert_eq!(tracked(&repo, &["one.txt", "deep"]), vec!["one.txt".to_string()]);
        let stamp = repo.index_stamp();
        fs::write(sub.join("three.txt"), "3").unwrap();
        run(&root, &["add", "--", "deep/er/three.txt"]);
        assert_ne!(repo.index_stamp(), stamp, "git add rewrites the index");
        assert_eq!(tracked(&repo, &["one.txt", "deep"]), vec!["deep/er/three.txt".to_string(), "one.txt".to_string()]);
        run(&root, &["commit", "-q", "-m", "three", "--", "deep/er/three.txt"]);
        assert!(!unmerged(&repo, "."));
        assert_eq!(short_hash(&repo, &repo.head_hash().unwrap()), ask(&root, &["rev-parse", "--short", "HEAD"]));
        // A branch ref that is a symbolic ref.
        run(&root, &["symbolic-ref", "refs/heads/task/t-2", "refs/heads/task/t-1"]);
        same_as_git(&root, "a symbolic branch ref");
        // The ignore files: the rules change, the answer follows.
        fs::write(root.join("ignored.txt"), "x").unwrap();
        fs::write(root.join(".gitignore"), "ignored.txt\n.claude/\n").unwrap();
        same_as_git(&root, "an ignore file");
        fs::write(root.join(".gitignore"), "ignored.txt\n").unwrap();
        same_as_git(&root, "a changed ignore file");
        fs::create_dir_all(root.join(".claude")).unwrap();
        fs::write(root.join(".claude").join(".gitignore"), "memory.md\n").unwrap();
        same_as_git(&root, "an ignore file in .claude");
        fs::write(repo.common_dir.join("info").join("exclude"), "one.txt\n").unwrap();
        same_as_git(&root, "info/exclude");
        // Index format 4 (compressed paths), the untracked cache extension, and a split index (the
        // reader gives up on it, and git answers).
        run(&root, &["update-index", "--index-version", "4"]);
        assert!(index_entries(&repo).is_some_and(|entries| entries.len() == 3), "format 4 is read");
        same_as_git(&root, "index format 4");
        run(&root, &["update-index", "--untracked-cache"]);
        same_as_git(&root, "an untracked cache extension");
        run(&root, &["update-index", "--split-index"]);
        assert!(index_entries(&repo).is_none(), "a split index is left to git");
        same_as_git(&root, "a split index");
        run(&root, &["update-index", "--no-split-index", "--no-untracked-cache", "--index-version", "2"]);
        assert!(index_entries(&repo).is_some(), "format 2 is read again");
        same_as_git(&root, "index format 2 again");
        // Packed refs: the loose files go, the facts stay.
        run(&root, &["pack-refs", "--all"]);
        assert!(!repo.common_dir.join("refs").join("heads").join("task").join("t-1").exists(), "pack-refs removed the loose file");
        same_as_git(&root, "packed refs");
        commit(&root, "four.txt");
        same_as_git(&root, "a loose ref over a packed one");
        // A detached checkout.
        run(&root, &["checkout", "-q", "--detach", "HEAD~1"]);
        let repo = same_as_git(&root, "detached");
        assert_eq!(repo.head_branch(), None);
        run(&root, &["checkout", "-q", "main"]);
        // An open merge with a conflict: MERGE_HEAD and an unmerged index entry.
        run(&root, &["checkout", "-q", "task/t-1"]);
        fs::write(root.join("one.txt"), "theirs").unwrap();
        run(&root, &["commit", "-q", "-a", "-m", "theirs"]);
        run(&root, &["checkout", "-q", "main"]);
        fs::write(root.join("one.txt"), "ours").unwrap();
        run(&root, &["commit", "-q", "-a", "-m", "ours"]);
        let merge = git_program().command().arg("-C").arg(&root).args(["merge", "-q", "task/t-1"]).output().unwrap();
        assert!(!merge.status.success(), "the merge has a conflict");
        let repo = same_as_git(&root, "an open merge");
        assert!(repo.merge_head().is_some());
        assert!(unmerged(&repo, "."), "the index has an unmerged entry");
        assert!(!unmerged(&repo, "deep"), "no unmerged entry under deep");
        run(&root, &["merge", "--abort"]);
        assert!(!unmerged(&repo, "."), "the abort rewrote the index");
        same_as_git(&root, "after the abort");
        // A work folder: a git worktree, as `.dispatch/work/1` of Dispatch is one.
        let work = root.join("work").join("1");
        run(&root, &["worktree", "add", "-q", "--detach", &work.to_string_lossy(), "main"]);
        let repo_work = same_as_git(&work, "a worktree");
        assert_eq!(repo_work.top, work);
        assert_eq!(repo_work.common_dir, repo.git_dir, "the worktree shares the refs of the main git folder");
        assert_ne!(repo_work.git_dir, repo.git_dir, "the worktree has its own git folder");
        run(&work, &["checkout", "-q", "-b", "task/t-3"]);
        assert_eq!(repo_work.head_branch().as_deref(), Some("task/t-3"));
        assert_eq!(repo.head_branch().as_deref(), Some("main"), "the main checkout keeps its branch");
        assert_eq!(repo.ref_hash("refs/heads/task/t-3"), repo_work.ref_hash("refs/heads/task/t-3"), "both see the new branch");
        assert_eq!(tracked(&repo_work, &["one.txt"]), vec!["one.txt".to_string()], "the worktree has its own index");
        // A sparse checkout.
        run(&work, &["sparse-checkout", "set", "deep"]);
        same_as_git(&work, "a sparse checkout");
        // A folder that is no repository, and a `.git` folder without HEAD.
        let outside = root.parent().unwrap().join("outside");
        fs::create_dir_all(outside.join(".git")).unwrap();
        assert_eq!(Repo::find(&outside), None);
        assert_eq!(ask(&outside, &["rev-parse", "--show-toplevel"]), None);
        fs::remove_dir_all(&outside).unwrap();
        clean(&project);
    }

    /// The index of this repository itself (a real one, with its extensions) against `git ls-files`.
    #[test]
    fn gitfiles_tag_refs_equal_for_each_ref() {
        let project = git_scratch("tag-refs");
        let root = project.root.clone();
        let same = |label: &str| {
            let repo = Repo::find(&root).unwrap();
            let text = ask(&root, &["for-each-ref", "--format=%(refname) %(objectname)", "refs/tags"]).unwrap_or_default();
            let mut expected: Vec<(String, String)> = text.lines().filter_map(|line| line.split_once(' ')).map(|(name, hash)| (name.to_string(), hash.to_string())).collect();
            expected.sort();
            assert_eq!(tag_refs(&repo), Some(expected), "{label}");
        };
        same("no commit, no tag");
        commit(&root, "one.txt");
        same("no tag");
        run(&root, &["tag", "v1.0.0"]);
        run(&root, &["tag", "deep/er/v2"]);
        run(&root, &["tag", "-a", "-m", "annotated", "v1.1.0"]);
        same("loose, nested and annotated");
        run(&root, &["pack-refs", "--all"]);
        same("packed");
        commit(&root, "two.txt");
        run(&root, &["tag", "-f", "v1.0.0"]);
        run(&root, &["tag", "v3"]);
        same("a loose tag over a packed one, and a new one");
        run(&root, &["tag", "-d", "deep/er/v2"]);
        run(&root, &["tag", "-d", "v3"]);
        same("deleted packed and loose tags");
        clean(&project);
    }

    #[test]
    fn gitfiles_reads_the_index_of_this_repository() {
        let here = Path::new(env!("CARGO_MANIFEST_DIR"));
        let Some(repo) = Repo::find(here) else { return };
        let expected: Vec<String> = ask(&repo.top, &["ls-files", "-z", "--", "."]).unwrap_or_default().split('\0').filter(|path| !path.is_empty()).map(str::to_string).collect();
        let Some(entries) = index_entries(&repo) else {
            eprintln!("the index of this repository is left to git (split or sparse)");
            return;
        };
        let paths: Vec<String> = entries.iter().map(|entry| entry.path.clone()).collect();
        assert_eq!(paths.len(), expected.len());
        assert_eq!(paths, expected);
        assert_eq!(tracked(&repo, &["src-tauri/Cargo.toml", "src"]), ask(&repo.top, &["ls-files", "-z", "--", "src-tauri/Cargo.toml", "src"]).unwrap_or_default().split('\0').filter(|path| !path.is_empty()).map(str::to_string).collect::<Vec<_>>());
        assert_eq!(unmerged(&repo, "."), ask(&repo.top, &["ls-files", "-u"]).is_some_and(|text| !text.trim().is_empty()));
    }

    #[test]
    fn gitfiles_varint_follows_git() {
        assert_eq!(varint(&[0]), Some((0, 1)));
        assert_eq!(varint(&[127]), Some((127, 1)));
        // 128 = (0 + 1) << 7 + 0: the first byte 0x80 with the low bits 0, then 0.
        assert_eq!(varint(&[0x80, 0x00]), Some((128, 2)));
        assert_eq!(varint(&[0x81, 0x00]), Some((256, 2)));
        assert_eq!(varint(&[0x80]), None, "a varint that does not end");
    }

    #[test]
    fn gitfiles_paths_take_the_form_of_git() {
        assert_eq!(windows_form(Path::new("d:/a/b/")), PathBuf::from("D:\\a\\b"));
        assert_eq!(windows_form(Path::new("C:\\")), PathBuf::from("C:\\"));
        assert_eq!(windows_form(Path::new("relative/x")), PathBuf::from("relative\\x"));
        assert_eq!(windows_form(Path::new("D:\\a\\.git\\worktrees\\1\\..\\..")), PathBuf::from("D:\\a\\.git"));
        assert_eq!(windows_form(Path::new("D:/a/./b/../c")), PathBuf::from("D:\\a\\c"));
        assert_eq!(windows_form(Path::new("D:\\..")), PathBuf::from("D:\\"));
        assert_eq!(windows_form(Path::new("\\\\server\\share\\x\\")), PathBuf::from("\\\\server\\share\\x"));
        assert!(is_hash("0123456789abcdef0123456789abcdef01234567"));
        assert!(!is_hash("0123456789abcdef0123456789abcdef0123456g"));
        assert!(!is_hash("abc"));
    }

    #[test]
    fn gitfiles_git_program_is_the_real_git_behind_the_launcher() {
        let program = git_program();
        let text = program.program.to_string_lossy().to_lowercase();
        if text.ends_with("mingw64\\bin\\git.exe") {
            assert!(program.path.is_some(), "the direct program has the PATH of the launcher");
            let path = program.path.as_ref().unwrap().to_string_lossy().to_lowercase();
            assert!(path.starts_with(&text.replace("\\git.exe", ";")), "{path}");
            assert!(path.contains("\\usr\\bin;"), "{path}");
        } else {
            assert_eq!(text, "git", "any other git stays `git`");
            assert!(program.path.is_none());
        }
        let output = program.command().arg("--version").output().unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).starts_with("git version"));
    }
}
