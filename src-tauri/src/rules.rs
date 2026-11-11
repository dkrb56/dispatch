//! The rules that Claude Code gets in a project, collected from the files of the project,
//! for the Rules popup. `project_rules` reads files only. `set_rule` switches one rule of an
//! instruction file off (the rule moves to the store `rules-off.json` in the app data folder)
//! or on again, or removes it.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::err;
use crate::pipeline::{write_file, Project};

/// One part of a group: text between the rules, or one rule with its state.
#[derive(Serialize, Clone)]
pub struct RulePart {
    markdown: String,
    /// `None`: text that is not a rule. `Some(false)`: a rule that the user switched off.
    #[serde(skip_serializing_if = "Option::is_none")]
    on: Option<bool>,
}

/// One group of rules: a section of an instruction file, or one kind of setting.
#[derive(Serialize)]
pub struct RuleGroup {
    title: String,
    /// The rules as Markdown text.
    markdown: String,
    /// The number of list items at the top level of the text.
    count: usize,
    /// The text and the rules in order, then the rules that are off.
    parts: Vec<RulePart>,
}

/// A rule that the user switched off. It is not in its file while it is off.
#[derive(Serialize, Deserialize, Clone, PartialEq)]
struct OffRule {
    group: String,
    /// The lines of the list item, joined with `\n`.
    text: String,
}

/// The rules that are off, by the path of their file.
type OffStore = BTreeMap<String, Vec<OffRule>>;

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join("rules-off.json"))
}

fn read_store(app: &AppHandle) -> Result<OffStore, String> {
    let path = store_path(app)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(OffStore::new());
    };
    serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))
}

fn write_store(app: &AppHandle, store: &OffStore) -> Result<(), String> {
    let text = serde_json::to_string_pretty(store).map_err(err)?;
    write_file(&store_path(app)?, &format!("{text}\n"))
}

/// A list item at the top level: `- `, `* ` or `1. `.
fn is_item(line: &str) -> bool {
    let numbered = line.split_once(". ").is_some_and(|(number, _)| !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()));
    line.starts_with("- ") || line.starts_with("* ") || numbered
}

/// The line after the last line of the list item that starts at `start`: the item ends at a
/// blank line or at the next item at the top level. A code block inside the item is part of it.
fn item_end(lines: &[&str], start: usize) -> usize {
    let mut in_code = false;
    let mut end = start + 1;
    while end < lines.len() {
        let line = lines[end];
        if is_fence(line) {
            in_code = !in_code;
        } else if !in_code && (line.trim().is_empty() || is_item(line)) {
            break;
        }
        end += 1;
    }
    end
}

/// Divides the lines of a group into parts: the rules (list items at the top level, with their
/// continuation lines) and the text between them. `off` gives the rules that are off; they come last.
fn parts(lines: &[&str], off: &[&OffRule]) -> Vec<RulePart> {
    let mut parts = Vec::new();
    let mut text: Vec<&str> = Vec::new();
    let push_text = |parts: &mut Vec<RulePart>, text: &mut Vec<&str>| {
        let markdown = text.join("\n").trim().to_string();
        if !markdown.is_empty() {
            parts.push(RulePart { markdown, on: None });
        }
        text.clear();
    };
    let mut in_code = false;
    let mut at = 0;
    while at < lines.len() {
        let line = lines[at];
        if !in_code && is_item(line) {
            let end = item_end(lines, at);
            push_text(&mut parts, &mut text);
            parts.push(RulePart { markdown: lines[at..end].join("\n"), on: Some(true) });
            at = end;
            continue;
        }
        if is_fence(line) {
            in_code = !in_code;
        }
        text.push(line);
        at += 1;
    }
    push_text(&mut parts, &mut text);
    parts.extend(off.iter().map(|rule| RulePart { markdown: rule.text.clone(), on: Some(false) }));
    parts
}

/// The rules of one file or folder.
#[derive(Serialize)]
pub struct RuleSource {
    title: String,
    file: String,
    groups: Vec<RuleGroup>,
}

#[derive(Serialize)]
pub struct Rules {
    /// The folder of the project.
    root: String,
    sources: Vec<RuleSource>,
}

fn is_fence(line: &str) -> bool {
    line.trim_start().starts_with("```")
}

/// Counts the list items at the top level of Markdown text.
fn count_rules(markdown: &str) -> usize {
    let mut in_code = false;
    markdown
        .lines()
        .filter(|line| {
            if is_fence(line) {
                in_code = !in_code;
                return false;
            }
            !in_code && is_item(line)
        })
        .count()
}

/// A group of settings. Its text is one part without buttons: the settings are not in a Markdown file.
fn group(title: &str, markdown: String) -> RuleGroup {
    let parts = if markdown.is_empty() { Vec::new() } else { vec![RulePart { markdown: markdown.clone(), on: None }] };
    RuleGroup { title: title.to_string(), count: count_rules(&markdown), markdown, parts }
}

/// The group of a line: the title of the last `## ` heading, or `General` before the first heading.
const GENERAL: &str = "General";

/// Divides Markdown text at its `## ` headings: the title of each group and its lines. The text
/// before the first heading is the group `General`. The title line of the file is not in a group.
fn sections(text: &str) -> Vec<(String, Vec<&str>)> {
    let mut groups: Vec<(String, Vec<&str>)> = vec![(GENERAL.to_string(), Vec::new())];
    let mut in_code = false;
    for line in text.lines() {
        if is_fence(line) {
            in_code = !in_code;
        }
        match line.strip_prefix("## ").filter(|_| !in_code) {
            Some(title) => groups.push((title.trim().to_string(), Vec::new())),
            // The title of the file is not a rule.
            None if line.starts_with("# ") && !in_code && groups.len() == 1 => {}
            None => groups.last_mut().unwrap().1.push(line),
        }
    }
    groups
}

/// The rules of an instruction file. `only` keeps the sections whose title starts with it.
/// `off` gives the rules of the file that are off. A group without text and without off rules
/// is not in the result.
fn instruction_source(title: &str, path: &Path, only: Option<&str>, off: &[OffRule]) -> Option<RuleSource> {
    let text = fs::read_to_string(path).ok()?;
    let mut groups = Vec::new();
    for (group_title, lines) in sections(text.trim_start_matches('\u{feff}')) {
        if !only.is_none_or(|start| group_title.starts_with(start)) {
            continue;
        }
        let off: Vec<&OffRule> = off.iter().filter(|rule| rule.group == group_title).collect();
        let markdown = lines.join("\n").trim().to_string();
        if markdown.is_empty() && off.is_empty() {
            continue;
        }
        let count = count_rules(&markdown);
        groups.push(RuleGroup { title: group_title, count, markdown, parts: parts(&lines, &off) });
    }
    let file = path.to_string_lossy().into_owned();
    (!groups.is_empty()).then(|| RuleSource { title: title.to_string(), file, groups })
}

/// The group of each line of an instruction file, as `sections` divides it.
fn group_of_lines(lines: &[&str]) -> Vec<String> {
    let mut groups = Vec::with_capacity(lines.len());
    let mut title = GENERAL.to_string();
    let mut in_code = false;
    for line in lines {
        if is_fence(line) {
            in_code = !in_code;
        }
        if let Some(heading) = line.strip_prefix("## ").filter(|_| !in_code) {
            title = heading.trim().to_string();
        }
        groups.push(title.clone());
    }
    groups
}

/// The text of an instruction file as lines, with its newline and its byte order mark.
struct Lines {
    bom: bool,
    newline: &'static str,
    lines: Vec<String>,
}

impl Lines {
    fn read(path: &Path) -> Result<Lines, String> {
        let text = fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let bom = text.starts_with('\u{feff}');
        let newline = if text.contains("\r\n") { "\r\n" } else { "\n" };
        let lines = text.trim_start_matches('\u{feff}').lines().map(str::to_string).collect();
        Ok(Lines { bom, newline, lines })
    }

    fn write(&self, path: &Path) -> Result<(), String> {
        let mut text = if self.bom { "\u{feff}".to_string() } else { String::new() };
        text.push_str(&self.lines.join(self.newline));
        text.push_str(self.newline);
        write_file(path, &text)
    }
}

/// Takes the rule with the lines `text` out of the group of the file.
fn remove_item(path: &Path, group: &str, text: &str) -> Result<(), String> {
    let mut file = Lines::read(path)?;
    let lines: Vec<&str> = file.lines.iter().map(String::as_str).collect();
    let groups = group_of_lines(&lines);
    let item: Vec<&str> = text.lines().collect();
    let start = (0..lines.len())
        .find(|&at| groups[at] == group && lines.len() >= at + item.len() && lines[at..at + item.len()] == item[..])
        .ok_or_else(|| format!("the rule is not in the group \"{group}\" of {}", path.display()))?;
    file.lines.drain(start..start + item.len());
    // The rule was between two blank lines: one is enough.
    let blank = |at: usize| file.lines.get(at).is_some_and(|line| line.trim().is_empty());
    if start > 0 && blank(start - 1) && blank(start) {
        file.lines.remove(start);
    }
    file.write(path)
}

/// Puts a rule with the lines `text` into the group of the file: after the last rule of the
/// group, or at the end of the group when it has no rule.
fn insert_item(path: &Path, group: &str, text: &str) -> Result<(), String> {
    let mut file = Lines::read(path)?;
    let lines: Vec<&str> = file.lines.iter().map(String::as_str).collect();
    let groups = group_of_lines(&lines);
    let start = groups.iter().position(|title| title == group);
    let start = match start {
        Some(start) => start,
        None if group == GENERAL => 0,
        None => return Err(format!("the group \"{group}\" is not in {}", path.display())),
    };
    let end = (start..lines.len()).find(|&at| groups[at] != group).unwrap_or(lines.len());
    let mut in_code = false;
    let mut at = start;
    let mut last_item_end = None;
    while at < end {
        if !in_code && is_item(lines[at]) {
            let item_end = item_end(&lines[..end], at).min(end);
            last_item_end = Some(item_end);
            at = item_end;
            continue;
        }
        if is_fence(lines[at]) {
            in_code = !in_code;
        }
        at += 1;
    }
    let mut item: Vec<String> = text.lines().map(str::to_string).collect();
    let at = match last_item_end {
        Some(at) => at,
        None => {
            let mut at = end;
            while at > start && lines[at - 1].trim().is_empty() {
                at -= 1;
            }
            // One blank line after text. None after the heading of the group.
            if at > 0 && !lines[at - 1].trim().is_empty() && !lines[at - 1].starts_with("## ") {
                item.insert(0, String::new());
            }
            at
        }
    };
    file.lines.splice(at..at, item);
    file.write(path)
}

/// Puts the rule with the lines `new` in place of the rule with the lines `old` in the group of
/// the file, at the same position. The newline and the byte order mark of the file stay.
fn replace_item(path: &Path, group: &str, old: &str, new: &str) -> Result<(), String> {
    let mut file = Lines::read(path)?;
    let lines: Vec<&str> = file.lines.iter().map(String::as_str).collect();
    let groups = group_of_lines(&lines);
    let item: Vec<&str> = old.lines().collect();
    let start = (0..lines.len())
        .find(|&at| groups[at] == group && lines.len() >= at + item.len() && lines[at..at + item.len()] == item[..])
        .ok_or_else(|| format!("the rule is not in the group \"{group}\" of {}", path.display()))?;
    file.lines.splice(start..start + item.len(), new.lines().map(str::to_string));
    file.write(path)
}

/// The text is exactly one list item at the top level, with no heading line: the form that
/// `parts` gives a rule, and the only form that Update may write.
pub(crate) fn is_one_rule(text: &str) -> bool {
    let lines: Vec<&str> = text.lines().collect();
    let headed = lines.iter().any(|line| line.starts_with("# ") || line.starts_with("## "));
    let parts = parts(&lines, &[]);
    !headed && parts.len() == 1 && parts[0].on == Some(true) && parts[0].markdown == text
}

/// Markdown list items, each one as code text.
fn code_list<'a>(items: impl Iterator<Item = &'a str>) -> String {
    items.map(|item| format!("- `{}`", item.replace('`', "'"))).collect::<Vec<_>>().join("\n")
}

/// The permission rules, the hooks and some other settings of a settings file.
fn settings_source(title: &str, path: &Path) -> Option<RuleSource> {
    let text = fs::read_to_string(path).ok()?;
    let settings: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    let texts = |pointer: &str| -> Vec<&str> {
        settings
            .pointer(pointer)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect()
    };
    let mut groups = Vec::new();
    for (key, title) in [("allow", "Allowed without a question"), ("ask", "Ask first"), ("deny", "Not allowed")] {
        groups.push(group(title, code_list(texts(&format!("/permissions/{key}")).into_iter())));
    }

    let mut hooks = Vec::new();
    for (event, entries) in settings.get("hooks").and_then(Value::as_object).into_iter().flatten() {
        for entry in entries.as_array().into_iter().flatten() {
            let matcher = entry.get("matcher").and_then(Value::as_str).filter(|matcher| !matcher.is_empty());
            let on = matcher.map(|matcher| format!(" on `{matcher}`")).unwrap_or_default();
            for hook in entry.get("hooks").and_then(Value::as_array).into_iter().flatten() {
                let command = hook.get("command").and_then(Value::as_str).unwrap_or("(no command)");
                hooks.push(format!("- {event}{on}: `{}`", command.replace('`', "'")));
            }
        }
    }
    groups.push(group("Hooks", hooks.join("\n")));

    let mut other = Vec::new();
    for (pointer, label) in [
        ("/permissions/defaultMode", "Permission mode at the start"),
        ("/worktree/bgIsolation", "Worktree isolation of background sessions"),
        ("/model", "Model"),
        ("/effortLevel", "Effort"),
        ("/agent", "Agent"),
    ] {
        if let Some(value) = settings.pointer(pointer).and_then(Value::as_str) {
            other.push(format!("- {label}: `{value}`"));
        }
    }
    for folder in texts("/permissions/additionalDirectories") {
        other.push(format!("- More folders: `{folder}`"));
    }
    groups.push(group("Other settings", other.join("\n")));

    groups.retain(|group| !group.markdown.is_empty());
    let file = path.to_string_lossy().into_owned();
    (!groups.is_empty()).then(|| RuleSource { title: title.to_string(), file, groups })
}

/// The agents of the project: one list item for each `.md` file in the agents folder.
fn agents_source(dir: &Path) -> Option<RuleSource> {
    let mut agents = Vec::new();
    for path in fs::read_dir(dir).ok()?.flatten().map(|entry| entry.path()) {
        if path.extension().is_none_or(|extension| extension != "md") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else { continue };
        // The file starts with `key: value` lines between two `---` lines.
        let header = text.strip_prefix("---").and_then(|rest| rest.split_once("\n---")).map_or("", |(header, _)| header);
        let value = |key: &str| {
            header.lines().find_map(|line| line.strip_prefix(key)?.strip_prefix(':')).map(str::trim)
        };
        let name = value("name").or(path.file_stem().and_then(|stem| stem.to_str())).unwrap_or("agent");
        let options: Vec<&str> = ["model", "effort", "tools"].into_iter().filter_map(&value).collect();
        let options = if options.is_empty() { String::new() } else { format!(" ({})", options.join(", ")) };
        agents.push(format!("- **{name}**{options}: {}", value("description").unwrap_or("")));
    }
    agents.sort();
    let file = dir.to_string_lossy().into_owned();
    (!agents.is_empty()).then(|| RuleSource {
        title: "Agents".to_string(),
        file,
        groups: vec![group("Agents of the project", agents.join("\n"))],
    })
}

/// An instruction file: its title in the popup, its path, and the start of the titles of the
/// sections to keep.
type InstructionFile = (&'static str, PathBuf, Option<&'static str>);

/// The instruction files of a project in the order of the popup, and then the file of the user
/// for all projects.
fn instruction_files(app: &AppHandle, project: &Project) -> Vec<InstructionFile> {
    let root = &project.root;
    let claude = root.join(".claude");
    let mut files = vec![
        ("Project instructions", project.instructions(), None),
        ("Project instructions", claude.join("CLAUDE.md"), None),
        ("Local instructions", root.join("CLAUDE.local.md"), None),
    ];
    for path in fs::read_dir(claude.join("rules")).into_iter().flatten().flatten().map(|entry| entry.path()) {
        if path.extension().is_some_and(|extension| extension == "md") {
            files.push(("Rule file", path, None));
        }
    }
    files.push(("Agent rules of the project", claude.join("agents-override.md"), None));
    // The file of the mistakes has a list of rules, and then the story of each mistake.
    files.push(("Rules from mistakes", claude.join("mistakes.md"), Some("Rules")));
    files.push(("Triage role", project.triage_prompt(), None));
    if let Ok(home) = app.path().home_dir() {
        files.push((USER_FILE, home.join(".claude").join("CLAUDE.md"), None));
    }
    files
}

/// The title of the instruction file of the user. The popup shows it last.
const USER_FILE: &str = "Your rules for all projects";

/// One rule of an instruction file that is on, with the three values that `set_rule` takes.
pub(crate) struct RuleItem {
    /// The title of the file in the popup.
    pub(crate) source: String,
    pub(crate) file: String,
    pub(crate) group: String,
    pub(crate) text: String,
    /// The file is not in the folder of the project, for example the file of the user for all
    /// projects. The check shows such a rule with a warning and offers no change for it.
    pub(crate) outside: bool,
}

/// The rules that are on in the instruction files of a project, in the order of the popup. The
/// file of the user for all projects comes last.
pub(crate) fn instruction_rules(app: &AppHandle, project: &Project) -> Result<Vec<RuleItem>, String> {
    let store = read_store(app)?;
    let mut items = Vec::new();
    for (title, path, only) in instruction_files(app, project) {
        let file = path.to_string_lossy().into_owned();
        let off = store.get(&file).map(Vec::as_slice).unwrap_or(&[]);
        let Some(source) = instruction_source(title, &path, only, off) else { continue };
        let outside = !path.starts_with(&project.root);
        for group in source.groups {
            for part in group.parts.into_iter().filter(|part| part.on == Some(true)) {
                items.push(RuleItem { source: title.to_string(), file: file.clone(), group: group.title.clone(), text: part.markdown, outside });
            }
        }
    }
    Ok(items)
}

/// Collects the rules that a Claude Code session gets in the project of a folder.
#[tauri::command(async)]
pub fn project_rules(app: AppHandle, cwd: String) -> Result<Rules, String> {
    let project = Project::find(&cwd)?;
    let root = &project.root;
    let claude = root.join(".claude");
    let store = read_store(&app)?;
    let mut sources = Vec::new();

    let files = instruction_files(&app, &project);
    let (project_files, user_file) = files.split_at(files.iter().position(|file| file.0 == USER_FILE).unwrap_or(files.len()));
    let source = |(title, path, only): &InstructionFile| {
        let off = store.get(path.to_string_lossy().as_ref()).map(Vec::as_slice).unwrap_or(&[]);
        instruction_source(title, path, *only, off)
    };
    sources.extend(project_files.iter().filter_map(source));
    // The options of the two runs of a worker, one argument per line in each file.
    for (title, path) in [("Options of the plan run", project.plan_flags()), ("Options of the work run", project.work_flags())] {
        if let Ok(flags) = fs::read_to_string(&path) {
            if !flags.trim().is_empty() {
                sources.push(RuleSource {
                    title: "Workers".to_string(),
                    file: path.to_string_lossy().into_owned(),
                    groups: vec![group(title, code_list(flags.lines().map(str::trim).filter(|line| !line.is_empty())))],
                });
            }
        }
    }
    sources.extend(agents_source(&claude.join("agents")));
    sources.extend(settings_source("Project settings", &project.settings()));
    sources.extend(settings_source("Local settings", &project.local_settings()));
    sources.extend(user_file.iter().filter_map(source));
    Ok(Rules { root: root.to_string_lossy().into_owned(), sources })
}

/// Switches one rule of an instruction file of the project off (`state` "off": the rule goes
/// from the file to the store), on again ("on": back into its group), or removes it ("removed").
/// `text` gives the lines of the rule, as `project_rules` shows them. The reply is the new list.
#[tauri::command(async)]
pub fn set_rule(app: AppHandle, cwd: String, file: String, group: String, text: String, state: String) -> Result<Rules, String> {
    let project = Project::find(&cwd)?;
    let path = instruction_files(&app, &project)
        .into_iter()
        .map(|(_, path, _)| path)
        .find(|path| path.to_string_lossy() == file)
        .ok_or_else(|| format!("not an instruction file of the project: {file}"))?;
    let mut store = read_store(&app)?;
    let rule = OffRule { group: group.clone(), text: text.clone() };
    let off = store.entry(file.clone()).or_default();
    let was_off = off.contains(&rule);
    match state.as_str() {
        "off" => {
            if !was_off {
                remove_item(&path, &group, &text)?;
                off.push(rule);
            }
        }
        "on" => {
            if was_off {
                off.retain(|other| *other != rule);
                insert_item(&path, &group, &text)?;
            }
        }
        "removed" => {
            if was_off {
                off.retain(|other| *other != rule);
            } else {
                remove_item(&path, &group, &text)?;
            }
        }
        other => return Err(format!("unknown rule state: {other}")),
    }
    store.retain(|_, rules| !rules.is_empty());
    write_store(&app, &store)?;
    project_rules(app, cwd)
}

/// Writes `new_text` in place of the rule `text` of an instruction file of the project: the Update
/// button of the check of the rules. The old text goes to the store as a rule that is off, so On
/// in the Rules popup puts it back. A file outside the folder of the project is refused. The reply
/// is the new list.
#[tauri::command(async)]
pub fn update_rule(app: AppHandle, cwd: String, file: String, group: String, text: String, new_text: String) -> Result<Rules, String> {
    let project = Project::find(&cwd)?;
    let path = instruction_files(&app, &project)
        .into_iter()
        .map(|(_, path, _)| path)
        .find(|path| path.to_string_lossy() == file)
        .ok_or_else(|| format!("not an instruction file of the project: {file}"))?;
    if !path.starts_with(&project.root) {
        return Err(format!("the file is not in the project, Dispatch does not change it here: {file}"));
    }
    let new_text = new_text.trim_end().to_string();
    if !is_one_rule(&new_text) {
        return Err("the new text is not one rule (one list item without a heading)".to_string());
    }
    if new_text == text {
        return Err("the new text is the same as the rule".to_string());
    }
    replace_item(&path, &group, &text, &new_text)?;
    let mut store = read_store(&app)?;
    let rule = OffRule { group, text };
    let off = store.entry(file).or_default();
    if !off.contains(&rule) {
        off.push(rule);
    }
    write_store(&app, &store)?;
    project_rules(app, cwd)
}
