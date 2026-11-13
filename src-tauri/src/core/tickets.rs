// The tickets of a project (ticket tickets): one file `.dispatch/tickets.jsonl`, one JSON event per
// line, in the form of the tickets file of starminer-manager, so its board can read it:
//   {"op":"open","id":…,"ts":…,"title":…,"type":…,"summary":…,"tags":[],"status":…,"order":…}
//   {"op":"status","ref":…,"ts":…,"status":"triage"|"todo"|"in_progress","order":…}
//   {"op":"close","ref":…,"ts":…,"resolution":"done"|"wontfix","note":…}
//   {"op":"update","ref":…,"ts":…,"title":…,"type":…,"order":…,"task":…,"renamed":…}
// A ticket is the fold of its lines. A line that is no JSON, an unknown op or an unknown field is
// skipped, so a file edited by hand still reads. Dispatch is the only writer: a message of the user
// opens a ticket, the board moves and renames it, and the task read moves it after its task
// (`follow`). The task read commits the file with the other task files of `.dispatch`.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::core::pipeline::Project;

/// The longest generated title, in characters.
const TITLE_MAX: usize = 70;
/// The longest generated id, in characters (without a `-2` for a collision).
const ID_MAX: usize = 40;
/// The longest title that the user can give.
const RENAME_MAX: usize = 200;

/// The columns of the board, as the field `status` of a ticket.
pub(crate) const NEW: &str = "new";
pub(crate) const TODO: &str = "todo";
pub(crate) const IN_PROGRESS: &str = "in-progress";
pub(crate) const DONE: &str = "done";
pub(crate) const CANCELED: &str = "canceled";

/// The types of a ticket, as the file writes them.
const KINDS: [&str; 4] = ["fix", "feature", "refactor", "content"];

/// One appended line at a time, in this process (the app or the host).
static WRITE: Mutex<()> = Mutex::new(());

/// One ticket, as the frontend gets it.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub(crate) id: String,
    pub(crate) title: String,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    /// The words of the user, as the box sent them: the paths of pasted images first.
    pub(crate) summary: String,
    /// `new`, `todo`, `in-progress`, `done` or `canceled`.
    pub(crate) status: String,
    /// The place in the Todo column, 1 first; none outside Todo or for a ticket by hand.
    pub(crate) order: Option<u32>,
    /// The name of the task of the ticket when triage gave it another id; empty: the id.
    pub(crate) task: String,
    /// The end word in Done and Canceled (`done`, `failed`, `stopped`, `canceled`, …), else empty.
    pub(crate) note: String,
    /// When the ticket was opened and changed last, in milliseconds since the Unix epoch.
    pub(crate) created: u64,
    pub(crate) updated: u64,
    /// The user gave the title: the title of the brief does not replace it.
    pub(crate) renamed: bool,
}

impl Ticket {
    /// The name of the task that the ticket follows.
    pub(crate) fn task_name(&self) -> &str {
        if self.task.is_empty() { &self.id } else { &self.task }
    }
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64)
}

/// A moment in milliseconds as `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC), as the starminer file writes it.
/// The task log takes its date from it (ticket task-log).
pub(crate) fn iso(millis: u64) -> String {
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
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", rest / 3600, rest % 3600 / 60, rest % 60, millis % 1000)
}

/// The milliseconds of a `ts` value: a number, or a text `YYYY-MM-DDTHH:MM:SS[.fff]Z`; else none.
fn parse_ts(value: Option<&Value>) -> Option<u64> {
    let value = value?;
    if let Some(number) = value.as_u64() {
        return Some(number);
    }
    let text = value.as_str()?;
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let millis = text.get(19..).and_then(|rest| rest.strip_prefix('.')).map_or(0, |rest| {
        let digits: String = rest.chars().take_while(char::is_ascii_digit).take(3).collect();
        format!("{digits:0<3}").parse::<i64>().unwrap_or(0)
    });
    // Days from civil (Howard Hinnant's algorithm).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let total = ((days * 86_400 + hour * 3600 + minute * 60 + second) * 1000) + millis;
    u64::try_from(total).ok()
}

/// The column of a `status` value of the file: the starminer values and the values of the board.
fn column_of(status: &str) -> Option<&'static str> {
    match status {
        "triage" | "backlog" | NEW => Some(NEW),
        TODO => Some(TODO),
        "in_progress" | IN_PROGRESS => Some(IN_PROGRESS),
        DONE => Some(DONE),
        CANCELED => Some(CANCELED),
        _ => None,
    }
}

/// The value that the file writes for a column that a `status` line holds.
fn file_status(column: &str) -> &'static str {
    match column {
        TODO => "todo",
        IN_PROGRESS => "in_progress",
        _ => "triage",
    }
}

/// The tickets of the lines of a file, in the order of their `open` lines.
pub(crate) fn fold(text: &str) -> Vec<Ticket> {
    let text = text.trim_start_matches('\u{feff}');
    let mut tickets: Vec<Ticket> = Vec::new();
    for line in text.lines() {
        let Ok(Value::Object(event)) = serde_json::from_str::<Value>(line.trim()) else { continue };
        let text_of = |key: &str| event.get(key).and_then(Value::as_str).map(str::trim).map(str::to_string);
        let ts = parse_ts(event.get("ts"));
        let op = text_of("op").unwrap_or_default();
        if op == "open" {
            let Some(id) = text_of("id").filter(|id| !id.is_empty()) else { continue };
            if tickets.iter().any(|ticket| ticket.id == id) {
                continue;
            }
            let created = ts.unwrap_or(0);
            let kind = text_of("type").map(|kind| kind.to_ascii_lowercase()).filter(|kind| KINDS.contains(&kind.as_str()));
            tickets.push(Ticket {
                title: text_of("title").filter(|title| !title.is_empty()).unwrap_or_else(|| id.clone()),
                id,
                kind: kind.unwrap_or_else(|| "feature".to_string()),
                summary: text_of("summary").unwrap_or_default(),
                status: text_of("status").as_deref().and_then(column_of).unwrap_or(NEW).to_string(),
                order: event.get("order").and_then(Value::as_u64).and_then(|order| u32::try_from(order).ok()),
                task: text_of("task").unwrap_or_default(),
                note: text_of("note").unwrap_or_default(),
                created,
                updated: created,
                renamed: event.get("renamed").and_then(Value::as_bool).unwrap_or(false),
            });
            continue;
        }
        let Some(id) = text_of("ref").or_else(|| text_of("id")) else { continue };
        let Some(ticket) = tickets.iter_mut().find(|ticket| ticket.id == id) else { continue };
        match op.as_str() {
            "status" => {
                let Some(column) = text_of("status").as_deref().and_then(column_of) else { continue };
                ticket.status = column.to_string();
                ticket.note = text_of("note").unwrap_or_default();
            }
            "close" => {
                let resolution = text_of("resolution").unwrap_or_default();
                ticket.status = if resolution == "done" { DONE } else { CANCELED }.to_string();
                ticket.note = text_of("note").filter(|note| !note.is_empty()).unwrap_or(resolution);
            }
            "update" => {
                if let Some(title) = text_of("title").filter(|title| !title.is_empty()) {
                    ticket.title = title;
                }
                if let Some(kind) = text_of("type").map(|kind| kind.to_ascii_lowercase()).filter(|kind| KINDS.contains(&kind.as_str())) {
                    ticket.kind = kind;
                }
                if let Some(task) = text_of("task") {
                    ticket.task = task;
                }
                if let Some(note) = text_of("note") {
                    ticket.note = note;
                }
                if let Some(renamed) = event.get("renamed").and_then(Value::as_bool) {
                    ticket.renamed = renamed;
                }
            }
            _ => continue,
        }
        // `order` rides on a status line and an update line; null takes it away.
        if let Some(order) = event.get("order") {
            ticket.order = order.as_u64().and_then(|order| u32::try_from(order).ok());
        }
        if let Some(ts) = ts {
            ticket.updated = ticket.updated.max(ts);
        }
    }
    tickets
}

/// The message without the paths of the pasted images at its start, and the number of the images.
fn without_images(text: &str) -> (String, usize) {
    const EXTENSIONS: [&str; 6] = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
    let is_image = |path: &str| EXTENSIONS.iter().any(|ext| path.to_ascii_lowercase().ends_with(ext));
    let mut rest = text.trim_start();
    let mut images = 0;
    loop {
        let (path, after) = if let Some(quoted) = rest.strip_prefix('"') {
            let Some(end) = quoted.find('"') else { break };
            (&quoted[..end], &quoted[end + 1..])
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            (&rest[..end], &rest[end..])
        };
        if path.is_empty() || !is_image(path) || !(after.is_empty() || after.starts_with(char::is_whitespace)) {
            break;
        }
        images += 1;
        rest = after.trim_start();
    }
    (rest.to_string(), images)
}

/// The generated title of a message: its first sentence, one space between the words, the first
/// letter upper case, without a full stop or colon at its end, cut at a word after 70 characters.
pub(crate) fn title_of(text: &str) -> String {
    let (words, images) = without_images(text);
    let first_line = words.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or_default();
    // The first sentence: up to `.`, `!` or `?` with a space after it.
    let chars: Vec<char> = first_line.chars().collect();
    let mut end = chars.len();
    for at in 0..chars.len() {
        if matches!(chars[at], '.' | '!' | '?') && chars.get(at + 1).is_some_and(|next| next.is_whitespace()) {
            end = if chars[at] == '?' { at + 1 } else { at };
            break;
        }
    }
    let sentence: String = chars[..end].iter().collect();
    let sentence = sentence.split_whitespace().collect::<Vec<_>>().join(" ");
    let sentence = sentence.trim_end_matches(['.', ':', ',', ';', ' ']).to_string();
    if sentence.is_empty() {
        return match images {
            0 => "New ticket".to_string(),
            1 => "An image".to_string(),
            n => format!("{n} images"),
        };
    }
    let mut title = String::new();
    for word in sentence.split(' ') {
        let next = if title.is_empty() { word.chars().count() } else { title.chars().count() + 1 + word.chars().count() };
        if next > TITLE_MAX {
            if title.is_empty() {
                title = word.chars().take(TITLE_MAX).collect();
            }
            title.push('…');
            break;
        }
        if !title.is_empty() {
            title.push(' ');
        }
        title.push_str(word);
    }
    let mut chars = title.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => title,
    }
}

/// The generated type of a message, by its words: fix, refactor, content, else feature.
pub(crate) fn kind_of(text: &str) -> &'static str {
    let (words, _) = without_images(text);
    let words = format!(" {} ", words.to_lowercase().replace(|c: char| !c.is_alphanumeric() && c != '\'', " "));
    let has = |list: &[&str]| list.iter().any(|word| words.contains(&format!(" {word} ")));
    if has(&[
        "fix", "fixes", "bug", "bugs", "broken", "breaks", "crash", "crashes", "error", "errors", "wrong", "fails", "failed", "failing",
        "doesn't", "not working", "does not work", "freezes", "hangs", "regression",
    ]) {
        "fix"
    } else if has(&["refactor", "refactoring", "rename", "cleanup", "clean up", "simplify", "restructure", "reorganize", "split up", "dead code"]) {
        "refactor"
    } else if has(&["text", "texts", "wording", "typo", "help", "readme", "docs", "documentation", "changelog", "translation", "translate", "copy"]) {
        "content"
    } else {
        "feature"
    }
}

/// The slug of a title: lower case letters and digits, words joined by `-`, at most 40 characters.
fn slug(title: &str) -> String {
    let mut id = String::new();
    for word in title.split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| !word.is_empty()) {
        let word = word.to_ascii_lowercase();
        if id.len() + usize::from(!id.is_empty()) + word.len() > ID_MAX {
            if id.is_empty() {
                id = word[..ID_MAX].to_string();
            }
            break;
        }
        if !id.is_empty() {
            id.push('-');
        }
        id.push_str(&word);
    }
    if id.is_empty() { "ticket".to_string() } else { id }
}

/// The names that a new id must not take: the tickets and the tasks of the task folder (state
/// files, reports, plans and briefs).
fn taken_names(project: &Project, tickets: &[Ticket]) -> HashSet<String> {
    let mut names: HashSet<String> = tickets.iter().map(|ticket| ticket.id.clone()).collect();
    let dir = project.tickets_file().parent().map(Path::to_path_buf).unwrap_or_default();
    for folder in [dir.clone(), dir.join("plans"), dir.join("briefs")] {
        for entry in fs::read_dir(folder).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "md" || ext == "state" || ext == "branch") {
                if let Some(stem) = path.file_stem() {
                    names.insert(stem.to_string_lossy().into_owned());
                }
            }
        }
    }
    names
}

/// A new id from a title, unique against the tickets and the tasks.
fn new_id(project: &Project, tickets: &[Ticket], title: &str) -> String {
    let taken = taken_names(project, tickets);
    let base = slug(title);
    let mut id = base.clone();
    let mut n = 2;
    while taken.contains(&id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    id
}

/// Adds lines to the tickets file; a new file starts with them.
fn append(project: &Project, events: &[Value]) -> Result<(), String> {
    if events.is_empty() {
        return Ok(());
    }
    let path = project.tickets_file();
    let _guard = WRITE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    // A file edited by hand may end without a line break: the new line must not join it.
    let needs_break = fs::read(&path).ok().is_some_and(|bytes| bytes.last().is_some_and(|last| *last != b'\n'));
    let mut text = String::new();
    if needs_break {
        text.push('\n');
    }
    for event in events {
        text.push_str(&event.to_string());
        text.push('\n');
    }
    let mut file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(text.as_bytes()).map_err(|e| format!("{}: {e}", path.display()))
}

/// The tickets of the file, without the migration.
fn read(project: &Project) -> Vec<Ticket> {
    fold(&fs::read_to_string(project.tickets_file()).unwrap_or_default())
}

/// An event line about a ticket that exists.
fn event(op: &str, id: &str, at: u64, fields: Map<String, Value>) -> Value {
    let mut line = Map::new();
    line.insert("op".into(), json!(op));
    line.insert("ref".into(), json!(id));
    line.insert("ts".into(), json!(iso(at)));
    line.extend(fields);
    Value::Object(line)
}

/// The line that moves a ticket into a column: `status` for New, Todo and In progress, `close` for
/// Done and Canceled with the end word.
fn move_event(id: &str, at: u64, column: &str, note: &str, order: Option<u32>) -> Value {
    let mut fields = Map::new();
    match column {
        DONE | CANCELED => {
            fields.insert("resolution".into(), json!(if column == DONE { "done" } else { "wontfix" }));
            fields.insert("note".into(), json!(note));
            fields.insert("order".into(), Value::Null);
            event("close", id, at, fields)
        }
        _ => {
            fields.insert("status".into(), json!(file_status(column)));
            fields.insert("order".into(), order.map_or(Value::Null, |order| json!(order)));
            if !note.is_empty() {
                fields.insert("note".into(), json!(note));
            }
            event("status", id, at, fields)
        }
    }
}

/// The entries of the Planned list (ticket overview-backlog), in their order: the text and the
/// time of each Markdown file of `.dispatch/backlog/`, with the paths of the files.
fn backlog_entries(dir: &Path) -> Vec<(u32, u64, String, String, std::path::PathBuf)> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("md")) {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
        let modified = fs::metadata(&path)
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |time| time.as_millis() as u64);
        let (mut sent, mut order, mut body_start, mut header) = (None, None, 0, false);
        for line in text.split('\n') {
            let Some((key, value)) = line.split_once(':') else { break };
            match key.trim().to_ascii_lowercase().as_str() {
                "sent" => sent = value.trim().parse::<u64>().ok(),
                "order" => order = value.trim().parse::<u32>().ok(),
                _ => break,
            }
            header = true;
            body_start += line.len() + 1;
        }
        let body = if header { text.get(body_start..).unwrap_or_default() } else { text.as_str() };
        let id = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
        entries.push((order.unwrap_or(u32::MAX), sent.unwrap_or(modified), id, body.trim().to_string(), path));
    }
    entries.sort_by(|a, b| (a.0, a.1, &a.2).cmp(&(b.0, b.1, &b.2)));
    entries
}

/// Each planned message of `.dispatch/backlog/` becomes a ticket in Todo in its order (the Planned
/// list goes, user decision of 2026-11-13); the files and the folder go. Gives the count.
fn migrate_backlog(project: &Project) -> Result<usize, String> {
    let dir = project.backlog_dir();
    if !dir.is_dir() {
        return Ok(0);
    }
    let entries = backlog_entries(&dir);
    let mut tickets = read(project);
    let mut order = tickets.iter().filter(|ticket| ticket.status == TODO).filter_map(|ticket| ticket.order).max().unwrap_or(0);
    for (_, sent, _, text, path) in &entries {
        if !text.is_empty() {
            order += 1;
            let ticket = open_ticket(project, &tickets, text, *sent, TODO, Some(order));
            append(project, &[open_event(&ticket)])?;
            tickets.push(ticket);
        }
        fs::remove_file(path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    // A folder that still holds another file stays.
    let _ = fs::remove_dir(&dir);
    Ok(entries.len())
}

/// A new ticket of a message.
fn open_ticket(project: &Project, tickets: &[Ticket], text: &str, at: u64, status: &str, order: Option<u32>) -> Ticket {
    let title = title_of(text);
    Ticket {
        id: new_id(project, tickets, &title),
        title,
        kind: kind_of(text).to_string(),
        summary: text.trim().to_string(),
        status: status.to_string(),
        order,
        task: String::new(),
        note: String::new(),
        created: at,
        updated: at,
        renamed: false,
    }
}

/// The `open` line of a new ticket.
fn open_event(ticket: &Ticket) -> Value {
    json!({
        "op": "open",
        "id": ticket.id,
        "ts": iso(ticket.created),
        "title": ticket.title,
        "type": ticket.kind,
        "summary": ticket.summary,
        "tags": [],
        "status": file_status(&ticket.status),
        "order": ticket.order,
    })
}

/// The tickets of a project for `task_list`: the planned messages of the old layout become tickets
/// first. A failure of the migration is logged; the next task read tries again.
pub(crate) fn list(project: &Project) -> Vec<Ticket> {
    if let Err(error) = migrate_backlog(project) {
        eprintln!("planned messages not moved into tickets: {error}");
    }
    read(project)
}

/// What the task read knows of a task, for `follow`.
pub(crate) struct TaskFacts<'a> {
    pub(crate) name: &'a str,
    /// The state file of the script: `planning`, `approved`, `working`, `stopped` or empty.
    pub(crate) state: &'a str,
    /// The `state` line of the report, when the task has a report with a header. `working` stands
    /// for a done report whose Verification claims the task list did not find in the transcript
    /// (ticket report-check): such a ticket stays In progress.
    pub(crate) report: Option<&'a str>,
    /// The title of the brief, else the user's words of the brief; empty without a brief.
    pub(crate) brief: &'a str,
}

/// The column and the end word that a task gives its ticket, or none (the task did not start).
fn target(facts: &TaskFacts) -> Option<(&'static str, &'static str)> {
    if facts.state == "stopped" {
        return Some((CANCELED, "stopped"));
    }
    match facts.report {
        Some("done") => Some((DONE, "done")),
        Some("failed") => Some((DONE, "failed")),
        Some(_) => Some((IN_PROGRESS, "")),
        None => matches!(facts.state, "planning" | "approved" | "working").then_some((IN_PROGRESS, "")),
    }
}

/// The end words of the user's own cancel (the × of a card, Ask triage): such a ticket stays in
/// Canceled. A ticket that Dispatch canceled (triage answered without a task) follows a task that
/// starts later.
const USER_CANCELS: [&str; 2] = ["canceled", "asked triage"];

/// Moves each ticket after its task: In progress while the task runs, Done with `done` or `failed`
/// after its report, Canceled with `stopped`. A ticket in New, or canceled by the user, stays. The
/// title of the brief replaces the generated title, unless the user renamed the ticket. Writes one
/// line per change and changes the tickets in place.
pub(crate) fn follow(project: &Project, tickets: &mut [Ticket], facts: &[TaskFacts]) -> Result<(), String> {
    let at = now();
    let mut events = Vec::new();
    for ticket in tickets.iter_mut() {
        if ticket.status == NEW || (ticket.status == CANCELED && USER_CANCELS.contains(&ticket.note.as_str())) {
            continue;
        }
        let Some(task) = facts.iter().find(|facts| facts.name == ticket.task_name()) else { continue };
        let Some((column, note)) = target(task) else { continue };
        if !ticket.renamed && !task.brief.is_empty() && task.brief != ticket.title {
            let mut fields = Map::new();
            fields.insert("title".into(), json!(task.brief));
            events.push(event("update", &ticket.id, at, fields));
            ticket.title = task.brief.to_string();
        }
        if ticket.status != column || ticket.note != note {
            events.push(move_event(&ticket.id, at, column, note, None));
            ticket.status = column.to_string();
            ticket.note = note.to_string();
            ticket.order = None;
        }
    }
    if !events.is_empty() {
        for ticket in tickets.iter_mut().filter(|ticket| events.iter().any(|event| event["ref"] == ticket.id.as_str())) {
            ticket.updated = at;
        }
    }
    append(project, &events)
}

/// A ticket of the file by its id.
fn find(tickets: &[Ticket], id: &str) -> Result<Ticket, String> {
    tickets.iter().find(|ticket| ticket.id == id).cloned().ok_or_else(|| format!("no ticket {id}"))
}

/// Opens a ticket for a message of the user in the column New and gives it.
pub fn ticket_add(cwd: String, text: String) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("the message is empty".to_string());
    }
    let tickets = list(&project);
    let ticket = open_ticket(&project, &tickets, text, now(), NEW, None);
    append(&project, &[open_event(&ticket)])?;
    Ok(ticket)
}

/// Changes the title (the user renamed it), the type, the task or the end word of a ticket.
pub fn ticket_update(cwd: String, id: String, title: Option<String>, kind: Option<String>, task: Option<String>, note: Option<String>) -> Result<Ticket, String> {
    let project = Project::find(&cwd)?;
    let ticket = find(&read(&project), &id)?;
    let mut fields = Map::new();
    if let Some(title) = title {
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        if title.is_empty() {
            return Err("the title is empty".to_string());
        }
        if title.chars().count() > RENAME_MAX {
            return Err(format!("the title is longer than {RENAME_MAX} characters"));
        }
        fields.insert("title".into(), json!(title));
        fields.insert("renamed".into(), json!(true));
    }
    if let Some(kind) = kind {
        let kind = kind.to_ascii_lowercase();
        if !KINDS.contains(&kind.as_str()) {
            return Err(format!("unknown type: {kind}"));
        }
        fields.insert("type".into(), json!(kind));
    }
    if let Some(task) = task {
        if !task.is_empty() && !task.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) {
            return Err(format!("invalid task name: {task}"));
        }
        fields.insert("task".into(), json!(task));
    }
    if let Some(note) = note {
        fields.insert("note".into(), json!(note.trim()));
    }
    if fields.is_empty() {
        return Ok(ticket);
    }
    append(&project, &[event("update", &id, now(), fields)])?;
    find(&read(&project), &id)
}

/// Moves a ticket into New, Todo or Canceled (the board; In progress and Done follow the task),
/// with an end word for Canceled, and saves the order of the Todo column: `ids` names the Todo
/// tickets in their new order; a Todo ticket that it does not name keeps its place after them.
/// Only a ticket whose column or place changed gets a line.
pub fn ticket_move(cwd: String, id: String, status: String, ids: Vec<String>, note: Option<String>) -> Result<Vec<Ticket>, String> {
    let project = Project::find(&cwd)?;
    let column = match status.as_str() {
        NEW => NEW,
        TODO => TODO,
        CANCELED => CANCELED,
        _ => return Err(format!("a ticket moves only into New, Todo or Canceled, not {status}")),
    };
    let tickets = read(&project);
    let moved = find(&tickets, &id)?;
    let note = match column {
        CANCELED => note.map(|note| note.trim().to_string()).filter(|note| !note.is_empty()).unwrap_or_else(|| "canceled".to_string()),
        _ => String::new(),
    };
    // The Todo column after the move, in its new order.
    let mut todo: Vec<&Ticket> = Vec::new();
    for named in &ids {
        if let Some(ticket) = tickets.iter().find(|ticket| &ticket.id == named && (ticket.status == TODO || ticket.id == id)) {
            if !todo.iter().any(|one| one.id == ticket.id) {
                todo.push(ticket);
            }
        }
    }
    let mut rest: Vec<&Ticket> = tickets.iter().filter(|ticket| ticket.status == TODO && !todo.iter().any(|one| one.id == ticket.id)).collect();
    rest.sort_by_key(|ticket| (ticket.order.is_none(), ticket.order, ticket.created));
    todo.extend(rest);
    if column == TODO && !todo.iter().any(|ticket| ticket.id == id) {
        todo.push(&moved);
    }
    todo.retain(|ticket| column == TODO || ticket.id != id);
    let at = now();
    let mut events = Vec::new();
    if moved.status != column || (column != TODO && moved.note != note) {
        let order = todo.iter().position(|ticket| ticket.id == id).map(|at| at as u32 + 1);
        events.push(move_event(&id, at, column, &note, order));
    }
    for (place, ticket) in todo.iter().enumerate() {
        let order = place as u32 + 1;
        if ticket.order == Some(order) || (ticket.id == id && moved.status != column) {
            continue;
        }
        let mut fields = Map::new();
        fields.insert("order".into(), json!(order));
        events.push(event("update", &ticket.id, at, fields));
    }
    append(&project, &events)?;
    Ok(read(&project))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::pipeline::write_file;
    use std::path::PathBuf;

    /// A scratch project in the temp folder, in no git repository, with its task folder.
    fn scratch(name: &str) -> (Project, PathBuf) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("dispatch-tickets-{name}-{nanos}"));
        let root = base.join("proj");
        fs::create_dir_all(root.join(".dispatch")).unwrap();
        (Project::scratch(root.clone(), root.join(".dispatch")), base)
    }

    fn cwd(project: &Project) -> String {
        project.root.to_string_lossy().into_owned()
    }

    #[test]
    fn the_time_goes_into_the_file_and_back() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_794_354_761_070), "2026-11-10T23:52:41.070Z");
        for millis in [0, 951_782_400_000, 1_794_354_761_070, 1_756_110_538_519] {
            assert_eq!(parse_ts(Some(&json!(iso(millis)))), Some(millis));
        }
        assert_eq!(parse_ts(Some(&json!("2026-08-25T08:28:58Z"))), parse_ts(Some(&json!("2026-08-25T08:28:58.000Z"))));
        assert_eq!(parse_ts(Some(&json!(5))), Some(5));
        assert_eq!(parse_ts(Some(&json!("yesterday"))), None);
    }

    #[test]
    fn the_fold_reads_the_lines_and_skips_what_it_does_not_know() {
        let text = concat!(
            "\u{feff}{\"op\":\"open\",\"id\":\"a\",\"ts\":\"2026-11-13T10:00:00.000Z\",\"title\":\"First\",\"type\":\"Fix\",\"summary\":\"fix it\",\"tags\":[],\"status\":\"triage\"}\r\n",
            "not json\r\n",
            "{\"op\":\"open\",\"id\":\"b\",\"ts\":2000,\"title\":\"Second\",\"status\":\"todo\",\"order\":1}\n",
            "{\"op\":\"teleport\",\"ref\":\"a\"}\n",
            "{\"op\":\"update\",\"ref\":\"a\",\"ts\":\"2026-11-13T11:00:00.000Z\",\"title\":\"Renamed\",\"renamed\":true,\"color\":\"red\"}\n",
            "{\"op\":\"status\",\"ref\":\"a\",\"status\":\"in_progress\"}\n",
            "{\"op\":\"close\",\"ref\":\"b\",\"resolution\":\"wontfix\"}\n",
            "{\"op\":\"status\",\"ref\":\"missing\",\"status\":\"todo\"}\n",
            "{\"op\":\"open\",\"id\":\"a\",\"title\":\"a second open of a is no ticket\"}\n",
        );
        let tickets = fold(text);
        assert_eq!(tickets.len(), 2);
        let a = &tickets[0];
        assert_eq!((a.id.as_str(), a.title.as_str(), a.kind.as_str(), a.status.as_str(), a.renamed), ("a", "Renamed", "fix", IN_PROGRESS, true));
        assert_eq!(a.summary, "fix it");
        assert_eq!(a.updated, parse_ts(Some(&json!("2026-11-13T11:00:00.000Z"))).unwrap());
        let b = &tickets[1];
        assert_eq!((b.status.as_str(), b.note.as_str(), b.kind.as_str(), b.created), (CANCELED, "wontfix", "feature", 2000));
        // A close with done goes to Done with its note.
        let done = fold("{\"op\":\"open\",\"id\":\"c\"}\n{\"op\":\"close\",\"ref\":\"c\",\"resolution\":\"done\",\"note\":\"failed\"}\n");
        assert_eq!((done[0].status.as_str(), done[0].note.as_str(), done[0].title.as_str()), (DONE, "failed", "c"));
    }

    #[test]
    fn a_message_gives_a_title_a_type_and_an_id() {
        assert_eq!(title_of("fix the bar: it is too tall. And more."), "Fix the bar: it is too tall");
        assert_eq!(title_of("  why is   the bar tall? I wonder\nmore"), "Why is the bar tall?");
        assert_eq!(title_of("first line\nsecond line"), "First line");
        assert_eq!(title_of("C:/p/paste-1.png \"C:/my files/paste 2.PNG\" look at this"), "Look at this");
        assert_eq!(title_of("C:/p/paste-1.png"), "An image");
        assert_eq!(title_of("C:/p/a.png C:/p/b.jpg"), "2 images");
        assert_eq!(title_of("   "), "New ticket");
        let long = title_of(&"word ".repeat(40));
        assert!(long.chars().count() <= TITLE_MAX + 1 && long.ends_with('…'), "{long}");
        assert_eq!(kind_of("the app crashes at start"), "fix");
        assert_eq!(kind_of("refactor the menu code"), "refactor");
        assert_eq!(kind_of("change the wording of the help"), "content");
        assert_eq!(kind_of("add a tickets board"), "feature");
        assert_eq!(slug("Fix the bar: it is too tall!"), "fix-the-bar-it-is-too-tall");
        assert!(slug(&"abcdefghij ".repeat(10)).len() <= ID_MAX);
        assert_eq!(slug("Ünïcode only ÄÖ"), "n-code-only");
        assert_eq!(slug("…"), "ticket");
    }

    #[test]
    fn add_update_and_move_write_one_line_each_and_read_back() {
        let (project, base) = scratch("add");
        // A task of the folder takes its name: the new id does not collide with it.
        write_file(&project.tickets_file().with_file_name("fix-the-bar.state"), "planning\n").unwrap();
        let a = ticket_add(cwd(&project), "fix the bar".into()).unwrap();
        assert_eq!((a.id.as_str(), a.title.as_str(), a.kind.as_str(), a.status.as_str()), ("fix-the-bar-2", "Fix the bar", "fix", NEW));
        let b = ticket_add(cwd(&project), "fix the bar".into()).unwrap();
        assert_eq!(b.id, "fix-the-bar-3");
        assert!(ticket_add(cwd(&project), "  ".into()).is_err());
        let lines = || fs::read_to_string(project.tickets_file()).unwrap().lines().count();
        assert_eq!(lines(), 2);

        let renamed = ticket_update(cwd(&project), a.id.clone(), Some("  Lower   the bar ".into()), Some("Content".into()), None, None).unwrap();
        assert_eq!((renamed.title.as_str(), renamed.kind.as_str(), renamed.renamed), ("Lower the bar", "content", true));
        assert_eq!(lines(), 3);
        assert!(ticket_update(cwd(&project), a.id.clone(), Some(" ".into()), None, None, None).is_err());
        assert!(ticket_update(cwd(&project), a.id.clone(), None, Some("chore".into()), None, None).is_err());
        assert!(ticket_update(cwd(&project), "nope".into(), Some("x".into()), None, None, None).is_err());
        assert_eq!(lines(), 3);

        // Into Todo: a, then b on top.
        let after = ticket_move(cwd(&project), a.id.clone(), TODO.into(), vec![a.id.clone()], None).unwrap();
        assert_eq!(after.iter().find(|t| t.id == a.id).map(|t| (t.status.as_str(), t.order)), Some((TODO, Some(1))));
        assert_eq!(lines(), 4);
        let after = ticket_move(cwd(&project), b.id.clone(), TODO.into(), vec![b.id.clone(), a.id.clone()], None).unwrap();
        let order = |list: &[Ticket]| {
            let mut todo: Vec<(&str, Option<u32>)> = list.iter().filter(|t| t.status == TODO).map(|t| (t.id.as_str(), t.order)).collect();
            todo.sort_by_key(|one| one.1);
            todo.into_iter().map(|one| one.0.to_string()).collect::<Vec<_>>()
        };
        assert_eq!(order(&after), [b.id.clone(), a.id.clone()]);
        // The move of b and the new place of a: two lines.
        assert_eq!(lines(), 6);
        // The same order again writes nothing.
        ticket_move(cwd(&project), b.id.clone(), TODO.into(), vec![b.id.clone(), a.id.clone()], None).unwrap();
        assert_eq!(lines(), 6);
        // A move inside Todo writes only the places that changed.
        let after = ticket_move(cwd(&project), a.id.clone(), TODO.into(), vec![a.id.clone(), b.id.clone()], None).unwrap();
        assert_eq!(order(&after), [a.id.clone(), b.id.clone()]);
        assert_eq!(lines(), 8);
        // Canceled with an end word; Todo keeps the other ticket at place 1.
        let after = ticket_move(cwd(&project), a.id.clone(), CANCELED.into(), vec![b.id.clone()], Some("asked triage".into())).unwrap();
        let gone = after.iter().find(|t| t.id == a.id).unwrap();
        assert_eq!((gone.status.as_str(), gone.note.as_str(), gone.order), (CANCELED, "asked triage", None));
        assert_eq!(order(&after), [b.id.clone()]);
        assert!(ticket_move(cwd(&project), b.id.clone(), DONE.into(), vec![], None).is_err());
        // The file reads back the same after a new start.
        assert_eq!(read(&project), after);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_ticket_follows_its_task() {
        let (project, base) = scratch("follow");
        let mut tickets = Vec::new();
        for (text, status) in [("one", TODO), ("two", IN_PROGRESS), ("three", TODO), ("four", NEW), ("five", TODO), ("six", TODO), ("seven", TODO), ("eight", TODO)] {
            let ticket = ticket_add(cwd(&project), text.into()).unwrap();
            if status != NEW {
                ticket_move(cwd(&project), ticket.id.clone(), TODO.into(), vec![ticket.id.clone()], None).unwrap();
            }
            tickets.push(ticket.id);
        }
        ticket_update(cwd(&project), tickets[2].clone(), Some("My own name".into()), None, None, None).unwrap();
        // Triage gave the fifth task another name.
        ticket_update(cwd(&project), tickets[4].clone(), None, None, Some("t-other".into()), None).unwrap();
        // Dispatch canceled the sixth (triage answered without a task); the user canceled the seventh.
        ticket_move(cwd(&project), tickets[5].clone(), CANCELED.into(), vec![], Some("triage answered without a task".into())).unwrap();
        ticket_move(cwd(&project), tickets[6].clone(), CANCELED.into(), vec![], None).unwrap();
        let mut list = read(&project);
        let facts = [
            TaskFacts { name: "one", state: "planning", report: None, brief: "The brief of one" },
            TaskFacts { name: "two", state: "working", report: Some("done"), brief: "" },
            TaskFacts { name: "three", state: "working", report: Some("failed"), brief: "The brief of three" },
            TaskFacts { name: "four", state: "planning", report: None, brief: "" },
            TaskFacts { name: "t-other", state: "stopped", report: None, brief: "" },
            TaskFacts { name: "six", state: "planning", report: None, brief: "" },
            TaskFacts { name: "seven", state: "planning", report: None, brief: "" },
            // A done report without evidence for its claims (ticket report-check) does not reach Done.
            TaskFacts { name: "eight", state: "working", report: Some("working"), brief: "" },
        ];
        follow(&project, &mut list, &facts).unwrap();
        let shown: Vec<(&str, &str, &str)> = list.iter().map(|t| (t.title.as_str(), t.status.as_str(), t.note.as_str())).collect();
        assert_eq!(
            shown,
            [
                ("The brief of one", IN_PROGRESS, ""),
                ("Two", DONE, "done"),
                ("My own name", DONE, "failed"),
                // A ticket in New waits for the user, also when a task of its name runs.
                ("Four", NEW, ""),
                ("Five", CANCELED, "stopped"),
                ("Six", IN_PROGRESS, ""),
                ("Seven", CANCELED, "canceled"),
                ("Eight", IN_PROGRESS, ""),
            ]
        );
        assert_eq!(read(&project), list, "the file has the moves");
        // A second follow with the same facts writes nothing.
        let before = fs::read_to_string(project.tickets_file()).unwrap();
        follow(&project, &mut list, &facts).unwrap();
        assert_eq!(fs::read_to_string(project.tickets_file()).unwrap(), before);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_planned_messages_become_todo_tickets_and_their_folder_goes() {
        let (project, base) = scratch("migrate");
        let dir = project.backlog_dir();
        write_file(&dir.join("b.md"), "sent: 5\r\norder: 2\r\n\r\nsecond message\r\n").unwrap();
        write_file(&dir.join("a.md"), "sent: 9\norder: 1\n\nfix the first thing\n").unwrap();
        write_file(&dir.join("hand.md"), "written by hand\n").unwrap();
        let list = list(&project);
        let shown: Vec<(&str, &str, Option<u32>, &str)> = list.iter().map(|t| (t.title.as_str(), t.status.as_str(), t.order, t.kind.as_str())).collect();
        assert_eq!(shown, [("Fix the first thing", TODO, Some(1), "fix"), ("Second message", TODO, Some(2), "feature"), ("Written by hand", TODO, Some(3), "feature")]);
        assert_eq!((list[0].created, list[1].summary.as_str()), (9, "second message"));
        assert!(!dir.exists(), "the folder goes");
        // A second read moves nothing again.
        assert_eq!(super::list(&project), list);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_line_by_hand_without_a_line_break_does_not_join_the_next_line() {
        let (project, base) = scratch("hand");
        write_file(&project.tickets_file(), "{\"op\":\"open\",\"id\":\"by-hand\",\"title\":\"By hand\"}").unwrap();
        let added = ticket_add(cwd(&project), "a new one".into()).unwrap();
        let ids: Vec<String> = read(&project).into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["by-hand".to_string(), added.id]);
        let _ = fs::remove_dir_all(base);
    }
}
