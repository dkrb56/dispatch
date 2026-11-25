//! The comments and groups of the Plan view (ticket plan-view-selection-comments-and-groups).
//! A comment is an open box around some tickets of the tree; a group is the same box collapsed
//! into one stacked card. Both live in `plan-groups.json` of the task folder of the project, so
//! every window and every computer of the project sees the same. A save sends the whole list;
//! the last save wins (user decision 3). The tickets and their arrows do not change.
//! An auto group (ticket i-need-an-autogrouping-function-in-the) is a topic group that Claude made
//! from the titles and words of the tickets: it has a description and stands as its own block.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::err;
use crate::core::pipeline::{write_file, Project};

/// The file of the comments and groups in the task folder.
const FILE: &str = "plan-groups.json";

/// One comment or group. `collapsed` makes it a group card; open, it is a comment box.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanGroup {
    pub id: String,
    pub title: String,
    /// One of the four colours of the view, 0 to 3.
    pub color: i64,
    pub collapsed: bool,
    /// The ids of its tickets, in the order of the user.
    pub tickets: Vec<String>,
    /// A topic group of Auto group: Claude made it. An old file without the field reads false.
    pub auto: bool,
    /// What the group does and what it is for, at most two short paragraphs; empty for a manual one.
    pub description: String,
    /// The count badge of a topic block is open: its counted tickets show as cards in subgroups
    /// inside the box (ticket count-pill-opens-subgroups-inside-a). An old file without the field
    /// reads false, and a closed group writes no field.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub unfolded: bool,
    /// The top-left of a topic block that the user dragged on the Plan board, in canvas px
    /// (ticket drag-topic-groups-on-the-plan-board). None keeps the automatic place.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<PlanSpot>,
    /// The size of the box of a topic block that the user resized by its corner, in canvas px
    /// (ticket issue-ticket-panel-is-only-resizable). None keeps the automatic size.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<PlanSize>,
    /// A section (ticket i-need-an-option-to-create-group-of): the ids of its topic groups and
    /// sections (ticket group-everything-inside-a-selection-box), which it holds as one box on the
    /// Plan board; `collapsed` folds it. Empty: not a section. An old file without the field reads
    /// empty, and a group that is no section writes no field.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<String>,
}

/// A place on the Plan board in canvas px.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanSpot {
    pub x: f64,
    pub y: f64,
}

/// A size on the Plan board in canvas px.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanSize {
    pub width: f64,
    pub height: f64,
}

/// The reply of both commands, and the shape of the file.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanGroups {
    pub groups: Vec<PlanGroup>,
}

/// The comments and groups of the project. No file gives an empty list; a file that is not
/// correct JSON gives an error that names it.
pub fn plan_groups_load(cwd: String) -> Result<PlanGroups, String> {
    load(&Project::find(&cwd)?)
}

/// Writes the comments and groups of the project, normalized, and gives them back.
pub fn plan_groups_save(cwd: String, groups: Vec<PlanGroup>) -> Result<PlanGroups, String> {
    save(&Project::find(&cwd)?, groups)
}

fn load(project: &Project) -> Result<PlanGroups, String> {
    let path = project.reports.join(FILE);
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(PlanGroups::default());
    };
    if text.trim().is_empty() {
        return Ok(PlanGroups::default());
    }
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("{} is not correct JSON: {e}", path.display()))
}

fn save(project: &Project, groups: Vec<PlanGroup>) -> Result<PlanGroups, String> {
    let groups = PlanGroups { groups: normalize(groups) };
    let text = serde_json::to_string_pretty(&groups).map_err(err)?;
    write_file(&project.reports.join(FILE), &format!("{text}\n"))?;
    Ok(groups)
}

/// Trims the titles, keeps the colour in 0..3, drops empty and double ticket ids, and drops a
/// group without an id or with the id of an earlier group. A section keeps only the ids of topic
/// groups and sections of the list (`section_members`) and has no tickets, place or size; a section
/// that another section holds is open; a section that lost its last member goes.
fn normalize(groups: Vec<PlanGroup>) -> Vec<PlanGroup> {
    let mut ids = HashSet::new();
    let mut sections = section_members(&groups);
    let held: HashSet<String> = sections.values().flatten().cloned().collect();
    groups
        .into_iter()
        .filter_map(|group| {
            if group.groups.is_empty() {
                return Some(group);
            }
            let id = group.id.trim().to_string();
            let members = sections.remove(&id)?;
            let collapsed = group.collapsed && !held.contains(&id);
            Some(PlanGroup { auto: false, tickets: Vec::new(), description: String::new(), unfolded: false, place: None, size: None, collapsed, groups: members, ..group })
        })
        .filter_map(|group| {
            let id = group.id.trim().to_string();
            if id.is_empty() || !ids.insert(id.clone()) {
                return None;
            }
            let mut seen = HashSet::new();
            let tickets = group
                .tickets
                .into_iter()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty() && seen.insert(t.clone()))
                .collect();
            Some(PlanGroup {
                id,
                title: group.title.trim().to_string(),
                color: group.color.clamp(0, 3),
                collapsed: group.collapsed,
                tickets,
                auto: group.auto,
                description: group.description.trim().to_string(),
                unfolded: group.unfolded,
                place: group.place.map(|p| PlanSpot { x: if p.x.is_finite() { p.x.max(0.0) } else { 0.0 }, y: if p.y.is_finite() { p.y.max(0.0) } else { 0.0 } }),
                // A size that is not finite or not positive is dropped: the box keeps its automatic size.
                size: group.size.filter(|s| s.width.is_finite() && s.height.is_finite() && s.width > 0.0 && s.height > 0.0),
                groups: group.groups,
            })
        })
        .collect()
}

/// The members of each live section, by section id (ticket group-everything-inside-a-selection-box).
/// A member is a topic group or another section, trimmed, in list order, in the first section only,
/// never the section itself and never a section that holds this section at any depth (no loop). A
/// section lives while it holds a live member; a dead section also leaves its holder.
fn section_members(groups: &[PlanGroup]) -> HashMap<String, Vec<String>> {
    let mut first = HashSet::new();
    let unique: Vec<&PlanGroup> = groups.iter().filter(|g| !g.id.trim().is_empty() && first.insert(g.id.trim().to_string())).collect();
    let topics: HashSet<String> = unique.iter().filter(|g| g.auto && g.groups.is_empty()).map(|g| g.id.trim().to_string()).collect();
    let order: Vec<&PlanGroup> = unique.into_iter().filter(|g| !g.groups.is_empty()).collect();
    let ids: HashSet<String> = order.iter().map(|g| g.id.trim().to_string()).collect();
    let mut held = HashSet::new();
    let mut links: HashMap<String, Vec<String>> = HashMap::new();
    for section in order {
        let id = section.id.trim().to_string();
        let mut members = Vec::new();
        for member in section.groups.iter().map(|m| m.trim().to_string()) {
            let fits = topics.contains(&member) || (ids.contains(&member) && member != id && !reaches(&links, &member, &id));
            if fits && held.insert(member.clone()) {
                members.push(member);
            }
        }
        links.insert(id, members);
    }
    loop {
        let dead: HashSet<String> = links.iter().filter(|(_, m)| m.is_empty()).map(|(id, _)| id.clone()).collect();
        if dead.is_empty() {
            return links;
        }
        links.retain(|id, _| !dead.contains(id));
        for members in links.values_mut() {
            members.retain(|m| !dead.contains(m));
        }
    }
}

/// Whether the section `from` holds `to` at any depth through `links`.
fn reaches(links: &HashMap<String, Vec<String>>, from: &str, to: &str) -> bool {
    let mut stack = vec![from.to_string()];
    let mut seen = HashSet::new();
    while let Some(id) = stack.pop() {
        if id == to {
            return true;
        }
        if seen.insert(id.clone()) {
            stack.extend(links.get(&id).into_iter().flatten().cloned());
        }
    }
    false
}

/// The model, the effort and the time limit in seconds of the Claude call of Auto group.
const AUTO_MODEL: (&str, &str, u64) = ("sonnet", "medium", 300);
/// The characters of the words of a ticket that the prompt holds.
const SUMMARY_CHARS: usize = 300;
/// The longest description of a group, in characters.
const DESCRIPTION_CHARS: usize = 800;

/// One ticket as Auto group sends it to Claude.
#[derive(Clone, Debug, PartialEq, Default)]
pub(crate) struct AutoTicket {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) title: String,
    pub(crate) summary: String,
}

/// One group of the answer of Claude: `group` is the id of an existing auto group or empty.
#[derive(Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
struct Proposal {
    group: String,
    title: String,
    description: String,
    tickets: Vec<String>,
}

/// Sorts the tickets of the project that have no auto group into topic groups (ticket
/// i-need-an-autogrouping-function-in-the). Claude gives each new group a title and a description;
/// it can also put a ticket into an existing auto group, whose title and description stay (user
/// decision 1). Manual comments and groups do not change. Gives the saved list.
pub fn plan_groups_auto(cwd: String) -> Result<PlanGroups, String> {
    let project = Project::find(&cwd)?;
    let tickets: Vec<AutoTicket> = crate::core::tickets::list(&project)
        .into_iter()
        .map(|t| AutoTicket { id: t.id, status: t.status, title: t.title, summary: t.summary })
        .collect();
    let root = project.root.clone();
    auto_with(&project, &tickets, None, &|prompt| crate::core::rules_check::ask(&root, prompt, AUTO_MODEL.0, AUTO_MODEL.1, AUTO_MODEL.2))
}

/// `plan_groups_auto` with the tickets and the model as arguments; a test gives a fake. With `only`
/// (the sort of new tickets, ticket when-i-create-new-ticket-it-should-be), it sends only those ids,
/// and only those that no group holds (a ticket that the user put into a group stays there); a
/// project without a topic group is not sorted and asks nothing (user decision 1).
pub(crate) fn auto_with(project: &Project, tickets: &[AutoTicket], only: Option<&HashSet<String>>, ask: &dyn Fn(&str) -> Result<String, String>) -> Result<PlanGroups, String> {
    let before = load(project)?;
    if only.is_some() && !before.groups.iter().any(|g| g.auto) {
        return Ok(before);
    }
    let grouped: HashSet<String> = match only {
        Some(_) => before.groups.iter().flat_map(|g| g.tickets.iter().cloned()).collect(),
        None => auto_ids(&before.groups),
    };
    let open: Vec<&AutoTicket> = tickets.iter().filter(|t| !grouped.contains(&t.id) && only.is_none_or(|ids| ids.contains(&t.id))).collect();
    if open.is_empty() {
        return Ok(before);
    }
    let existing: Vec<&PlanGroup> = before.groups.iter().filter(|g| g.auto).collect();
    let answer = ask(&auto_prompt(&existing, &open))?;
    let known: HashSet<String> = open.iter().map(|t| t.id.clone()).collect();
    let proposals = parse_answer(&answer, &known)?;
    // The Claude call takes minutes: read the file again, so a save of another window stays.
    let now = load(project)?;
    save(project, merge(now.groups, proposals, &stamp()))
}

/// The new tickets of each project (by its folder) that wait for their sort, and whether a sort of
/// that project runs: one Claude call at a time per project, and a ticket added during a call waits
/// for the next one.
static NEW_SORT: Mutex<Option<HashMap<PathBuf, NewSort>>> = Mutex::new(None);

#[derive(Default)]
struct NewSort {
    ids: Vec<String>,
    running: bool,
}

/// The wait before the sort of new tickets starts: a group that the user chose in the New ticket
/// window is saved by then, and tickets added at once go in one call.
const NEW_SORT_WAIT: Duration = Duration::from_secs(3);

/// Sorts new tickets into topic groups in the background (ticket when-i-create-new-ticket-it-should-be):
/// the New ticket window, the phone, the ticket lists of the chats and Plan the flow call it after
/// they opened tickets. Nothing happens in a project without a topic group (user decision 1). Claude
/// may put a ticket into an existing topic group or make a new one (user decision 2). A failure is
/// logged; the ticket then stays without a group, and Auto group can sort it later.
pub(crate) fn sort_new_tickets(project: &Project, ids: &[String]) {
    if ids.is_empty() || !load(project).is_ok_and(|file| file.groups.iter().any(|g| g.auto)) {
        return;
    }
    let key = project.root.clone();
    // A test only fills the queue: it makes no Claude call.
    if !queue_new(&key, ids) || cfg!(test) {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(NEW_SORT_WAIT);
        let cwd = key.to_string_lossy().into_owned();
        match Project::find(&cwd) {
            Ok(project) => {
                let root = project.root.clone();
                drain_new(&project, &key, &|prompt| crate::core::rules_check::ask(&root, prompt, AUTO_MODEL.0, AUTO_MODEL.1, AUTO_MODEL.2));
            }
            Err(error) => {
                eprintln!("new tickets not sorted into topic groups: {error}");
                while !take_new(&key).is_empty() {}
            }
        }
    });
}

/// Puts the ids into the queue of the project; true when no sort runs, so the caller starts one.
fn queue_new(key: &Path, ids: &[String]) -> bool {
    let mut all = NEW_SORT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = all.get_or_insert_with(HashMap::new).entry(key.to_path_buf()).or_default();
    for id in ids {
        if !entry.ids.contains(id) {
            entry.ids.push(id.clone());
        }
    }
    let start = !entry.running;
    entry.running = true;
    start
}

/// The waiting ids of the project, and the queue empty; an empty list ends the sort of the project.
fn take_new(key: &Path) -> Vec<String> {
    let mut all = NEW_SORT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let map = all.get_or_insert_with(HashMap::new);
    let ids = map.get_mut(key).map(|entry| std::mem::take(&mut entry.ids)).unwrap_or_default();
    if ids.is_empty() {
        map.remove(key);
    }
    ids
}

/// The waiting ids of a project, for the tests of the callers; the queue is then empty.
#[cfg(test)]
pub(crate) fn queued_new(project: &Project) -> Vec<String> {
    take_new(&project.root)
}

/// Sorts the queue of the project until it is empty, one call per round; a test gives a fake model.
fn drain_new(project: &Project, key: &Path, ask: &dyn Fn(&str) -> Result<String, String>) {
    loop {
        let ids: HashSet<String> = take_new(key).into_iter().collect();
        if ids.is_empty() {
            return;
        }
        let tickets: Vec<AutoTicket> = crate::core::tickets::list(project)
            .into_iter()
            .map(|t| AutoTicket { id: t.id, status: t.status, title: t.title, summary: t.summary })
            .collect();
        if let Err(error) = auto_with(project, &tickets, Some(&ids), ask) {
            eprintln!("new tickets not sorted into topic groups: {error}");
        }
    }
}

/// Puts new parts into the topic group of their parent (ticket when-i-create-new-ticket-it-should-be,
/// user decision 3), without Claude: the first topic group that holds the parent takes each part that
/// has no topic group. Writes nothing when no topic group holds the parent.
pub(crate) fn join_parent_group(project: &Project, parent: &str, ids: &[String]) -> Result<(), String> {
    let mut groups = load(project)?.groups;
    let grouped = auto_ids(&groups);
    let Some(group) = groups.iter_mut().find(|g| g.auto && g.tickets.iter().any(|t| t == parent)) else {
        return Ok(());
    };
    let mut changed = false;
    for id in ids {
        if !grouped.contains(id) && !group.tickets.contains(id) {
            group.tickets.push(id.clone());
            changed = true;
        }
    }
    if changed {
        save(project, groups)?;
    }
    Ok(())
}

/// The ids of the tickets that an auto group holds.
fn auto_ids(groups: &[PlanGroup]) -> HashSet<String> {
    groups.iter().filter(|g| g.auto).flat_map(|g| g.tickets.iter().cloned()).collect()
}

/// The prompt of Auto group: the existing auto groups and the tickets to sort.
fn auto_prompt(existing: &[&PlanGroup], tickets: &[&AutoTicket]) -> String {
    let groups: Vec<serde_json::Value> = existing
        .iter()
        .map(|g| serde_json::json!({ "id": g.id, "title": g.title, "description": g.description }))
        .collect();
    let items: Vec<serde_json::Value> = tickets
        .iter()
        .map(|t| {
            let summary: String = t.summary.chars().take(SUMMARY_CHARS).collect();
            serde_json::json!({ "id": t.id, "status": t.status, "title": t.title, "summary": summary })
        })
        .collect();
    let groups = serde_json::to_string_pretty(&groups).unwrap_or_default();
    let items = serde_json::to_string_pretty(&items).unwrap_or_default();
    format!(
        "You sort the tickets of a software project into groups by topic.\n\
         Each ticket has an id, a status, a title and the first words of its text.\n\n\
         Existing groups (keep them; you can add tickets to them by their id):\n{groups}\n\n\
         Tickets to sort:\n{items}\n\n\
         Rules:\n\
         - Put every ticket of the list into exactly one group.\n\
         - Add a ticket to an existing group when it fits its topic: give the id of that group in \"group\".\n\
         - Make a new group for a topic that no existing group covers: give \"group\": \"\".\n\
         - A new group has a title of 2 to 5 words.\n\
         - A new group has a description of at most two short paragraphs: what the group does and what it is for.\n\
         - Make groups of more than one ticket where you can.\n\n\
         Answer with a JSON array only, no other text:\n\
         [{{\"group\": \"<id of an existing group or empty>\", \"title\": \"<title>\", \"description\": \"<description>\", \"tickets\": [\"<ticket id>\"]}}]\n"
    )
}

/// Reads the answer of Claude: drops unknown ids, keeps a ticket in its first group only and
/// drops a group without tickets. An answer without a JSON array is an error.
fn parse_answer(answer: &str, known: &HashSet<String>) -> Result<Vec<Proposal>, String> {
    let bad = || "Claude did not answer with a list of groups. Try Auto group again.".to_string();
    let start = answer.find('[').ok_or_else(bad)?;
    let end = answer.rfind(']').ok_or_else(bad)?;
    if end < start {
        return Err(bad());
    }
    let proposals: Vec<Proposal> = serde_json::from_str(&answer[start..=end]).map_err(|_| bad())?;
    let mut taken = HashSet::new();
    Ok(proposals
        .into_iter()
        .filter_map(|p| {
            let tickets: Vec<String> = p
                .tickets
                .into_iter()
                .map(|t| t.trim().to_string())
                .filter(|t| known.contains(t) && taken.insert(t.clone()))
                .collect();
            if tickets.is_empty() {
                return None;
            }
            Some(Proposal { group: p.group.trim().to_string(), title: p.title.trim().to_string(), description: short_description(&p.description), tickets })
        })
        .collect())
}

/// The description cut to two paragraphs and `DESCRIPTION_CHARS` characters.
fn short_description(text: &str) -> String {
    let text = text.replace("\r\n", "\n");
    let paragraphs: Vec<&str> = text.split("\n\n").map(str::trim).filter(|p| !p.is_empty()).take(2).collect();
    let text = paragraphs.join("\n\n");
    if text.chars().count() <= DESCRIPTION_CHARS {
        return text;
    }
    let cut: String = text.chars().take(DESCRIPTION_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// Puts the proposals into the groups of the file: a ticket into the existing auto group that the
/// proposal names, else a new auto group after the others. A ticket that has an auto group in the
/// file already stays there. Manual groups do not change.
fn merge(mut groups: Vec<PlanGroup>, proposals: Vec<Proposal>, stamp: &str) -> Vec<PlanGroup> {
    let mut grouped = auto_ids(&groups);
    let mut colour = groups.iter().filter(|g| g.auto).count() as i64;
    let mut made = 0;
    for proposal in proposals {
        let tickets: Vec<String> = proposal.tickets.into_iter().filter(|t| grouped.insert(t.clone())).collect();
        if tickets.is_empty() {
            continue;
        }
        if let Some(group) = groups.iter_mut().find(|g| g.auto && !proposal.group.is_empty() && g.id == proposal.group) {
            group.tickets.extend(tickets);
            continue;
        }
        made += 1;
        let title = if proposal.title.is_empty() { format!("Topic {made}") } else { proposal.title };
        groups.push(PlanGroup {
            id: format!("auto-{stamp}-{made}"),
            title,
            color: colour % 4,
            collapsed: false,
            tickets,
            auto: true,
            description: proposal.description,
            unfolded: false,
            place: None,
            size: None,
            groups: Vec::new(),
        });
        colour += 1;
    }
    groups
}

/// The time in milliseconds in base 36, for the ids of new groups.
fn stamp() -> String {
    let mut n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    loop {
        out.push(digits[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    out.reverse();
    String::from_utf8(out).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> (Project, PathBuf) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("dispatch-plangroups-{name}-{nanos}"));
        let root = base.join("proj");
        fs::create_dir_all(&root).unwrap();
        (Project::scratch(root.clone(), root.join(".dispatch")), base)
    }

    fn group(id: &str, tickets: &[&str]) -> PlanGroup {
        PlanGroup {
            id: id.into(),
            title: "Group".into(),
            color: 1,
            collapsed: true,
            tickets: tickets.iter().map(|t| t.to_string()).collect(),
            ..PlanGroup::default()
        }
    }

    #[test]
    fn a_missing_file_gives_no_groups() {
        let (project, base) = scratch("missing");
        assert_eq!(load(&project), Ok(PlanGroups::default()));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_save_reads_back_the_same() {
        let (project, base) = scratch("round");
        let groups = vec![group("g-1", &["a", "b"]), PlanGroup { collapsed: false, ..group("g-2", &["c"]) }];
        let saved = save(&project, groups.clone()).unwrap();
        assert_eq!(saved.groups, groups);
        assert_eq!(load(&project).unwrap(), saved);
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert!(text.ends_with("}\n"), "pretty JSON with a final newline: {text}");
        assert!(text.contains("\"collapsed\": true"), "{text}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn broken_json_names_the_file() {
        let (project, base) = scratch("broken");
        write_file(&project.reports.join(FILE), "{ not json").unwrap();
        let error = load(&project).unwrap_err();
        assert!(error.contains(FILE) && error.contains("not correct JSON"), "{error}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_save_normalizes_the_groups() {
        let (project, base) = scratch("normalize");
        let groups = vec![
            PlanGroup { title: "  Login  ".into(), color: 9, ..group(" g-1 ", &["a", " ", "a", "b "]) },
            PlanGroup { color: -2, ..group("g-2", &[]) },
            group("", &["x"]),
            group("g-1", &["y"]),
        ];
        let saved = save(&project, groups).unwrap().groups;
        assert_eq!(saved.len(), 2, "no empty id and no double id: {saved:?}");
        assert_eq!(saved[0].id, "g-1");
        assert_eq!(saved[0].title, "Login");
        assert_eq!(saved[0].color, 3);
        assert_eq!(saved[0].tickets, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(saved[1].color, 0);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn missing_fields_take_their_defaults() {
        let (project, base) = scratch("defaults");
        write_file(&project.reports.join(FILE), "{\"groups\":[{\"id\":\"g-1\"}]}").unwrap();
        let groups = load(&project).unwrap().groups;
        assert_eq!(groups, vec![PlanGroup { id: "g-1".into(), ..PlanGroup::default() }]);
        let _ = fs::remove_dir_all(base);
    }

    fn ticket(id: &str, status: &str, title: &str) -> AutoTicket {
        AutoTicket { id: id.into(), status: status.into(), title: title.into(), summary: format!("words of {id}") }
    }

    fn board() -> Vec<AutoTicket> {
        vec![ticket("a", "done", "Login page"), ticket("b", "new", "Login error"), ticket("c", "backlog", "Dark theme"), ticket("d", "canceled", "Old idea")]
    }

    #[test]
    fn auto_group_makes_groups_with_title_and_description() {
        let (project, base) = scratch("auto");
        let asked = std::cell::RefCell::new(String::new());
        let answer = r#"[{"group":"","title":"Login","description":"Signs the user in.\n\nKeeps the account safe.","tickets":["a","b"]},{"group":"","title":"Looks","description":"The colours.","tickets":["c","d"]}]"#;
        let saved = auto_with(&project, &board(), None, &|prompt| {
            *asked.borrow_mut() = prompt.to_string();
            Ok(answer.to_string())
        })
        .unwrap()
        .groups;
        let prompt = asked.borrow().clone();
        for id in ["\"a\"", "\"b\"", "\"c\"", "\"d\"", "\"done\"", "\"canceled\"", "words of a", "Login page"] {
            assert!(prompt.contains(id), "the prompt holds {id}: {prompt}");
        }
        assert_eq!(saved.len(), 2);
        assert!(saved.iter().all(|g| g.auto && !g.collapsed && g.id.starts_with("auto-")), "{saved:?}");
        assert_eq!(saved[0].title, "Login");
        assert_eq!(saved[0].description, "Signs the user in.\n\nKeeps the account safe.");
        assert_eq!(saved[0].tickets, vec!["a".to_string(), "b".to_string()]);
        assert_eq!((saved[0].color, saved[1].color), (0, 1));
        assert_ne!(saved[0].id, saved[1].id);
        assert_eq!(load(&project).unwrap().groups, saved, "the groups are saved");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn auto_group_drops_unknown_and_double_ids_and_empty_groups() {
        let (project, base) = scratch("auto-doubles");
        let answer = r#"[{"title":"One","tickets":["a","zzz","a"]},{"title":"Two","tickets":["a","b"]},{"title":"Empty","tickets":["nope"]}]"#;
        let saved = auto_with(&project, &board(), None, &|_| Ok(answer.to_string())).unwrap().groups;
        assert_eq!(saved.len(), 2, "{saved:?}");
        assert_eq!(saved[0].tickets, vec!["a".to_string()]);
        assert_eq!(saved[1].tickets, vec!["b".to_string()]);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn auto_group_reads_a_fenced_answer_and_cuts_the_description() {
        let (project, base) = scratch("auto-fence");
        let long = "x".repeat(2000);
        let answer = format!("Here:\n```json\n[{{\"title\":\" Login \",\"description\":\"One.\\n\\nTwo.\\n\\nThree.\",\"tickets\":[\"a\"]}},{{\"title\":\"\",\"description\":\"{long}\",\"tickets\":[\"b\"]}}]\n```");
        let saved = auto_with(&project, &board(), None, &|_| Ok(answer.clone())).unwrap().groups;
        assert_eq!(saved[0].title, "Login");
        assert_eq!(saved[0].description, "One.\n\nTwo.", "two paragraphs at most");
        assert_eq!(saved[1].title, "Topic 2", "an empty title gets a name");
        assert_eq!(saved[1].description.chars().count(), DESCRIPTION_CHARS);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn auto_group_refuses_an_answer_without_json() {
        let (project, base) = scratch("auto-bad");
        let error = auto_with(&project, &board(), None, &|_| Ok("I cannot do that.".to_string())).unwrap_err();
        assert!(error.contains("did not answer with a list of groups"), "{error}");
        let error = auto_with(&project, &board(), None, &|_| Ok("[{ not json ]".to_string())).unwrap_err();
        assert!(error.contains("did not answer with a list of groups"), "{error}");
        let error = auto_with(&project, &board(), None, &|_| Err("Claude Code gave an empty answer.".to_string())).unwrap_err();
        assert_eq!(error, "Claude Code gave an empty answer.");
        assert_eq!(load(&project).unwrap(), PlanGroups::default(), "nothing saved");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_second_run_keeps_titles_and_manual_groups() {
        let (project, base) = scratch("auto-again");
        let manual = PlanGroup { tickets: vec!["c".into()], ..group("g-1", &["c"]) };
        let topic = PlanGroup { id: "auto-x-1".into(), title: "My login".into(), description: "Mine.".into(), auto: true, color: 2, collapsed: true, tickets: vec!["a".into()], unfolded: true, place: Some(PlanSpot { x: 300.0, y: 450.0 }), size: Some(PlanSize { width: 600.0, height: 400.0 }), groups: Vec::new() };
        save(&project, vec![manual.clone(), topic.clone()]).unwrap();
        let asked = std::cell::RefCell::new(String::new());
        let answer = r#"[{"group":"auto-x-1","title":"Other title","description":"Other.","tickets":["b","a"]},{"group":"","title":"Looks","tickets":["c","d"]}]"#;
        let saved = auto_with(&project, &board(), None, &|prompt| {
            *asked.borrow_mut() = prompt.to_string();
            Ok(answer.to_string())
        })
        .unwrap()
        .groups;
        let prompt = asked.borrow().clone();
        assert!(prompt.contains("auto-x-1") && prompt.contains("My login"), "the prompt names the existing group: {prompt}");
        assert!(!prompt.contains("\"id\": \"a\""), "a ticket with an auto group is not sent again: {prompt}");
        assert_eq!(saved[0], manual, "the manual group does not change");
        assert_eq!(saved[1].title, "My login");
        assert_eq!(saved[1].description, "Mine.");
        assert!(saved[1].collapsed);
        assert_eq!(saved[1].place, Some(PlanSpot { x: 300.0, y: 450.0 }), "the auto run keeps the dragged place");
        assert_eq!(saved[1].size, Some(PlanSize { width: 600.0, height: 400.0 }), "the auto run keeps the size of the box");
        assert!(saved[1].unfolded, "the auto run keeps the open count badge");
        assert_eq!(saved[1].tickets, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(saved[2].title, "Looks");
        assert_eq!(saved[2].tickets, vec!["c".to_string(), "d".to_string()], "a ticket of a manual group can join a topic group");
        assert_eq!(saved[2].color, 1, "the colour goes on after the existing auto group");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn auto_group_without_new_tickets_asks_nothing() {
        let (project, base) = scratch("auto-none");
        let topic = PlanGroup { id: "auto-x-1".into(), auto: true, tickets: vec!["a".into(), "b".into(), "c".into(), "d".into()], ..PlanGroup::default() };
        save(&project, vec![topic]).unwrap();
        let saved = auto_with(&project, &board(), None, &|_| panic!("no call")).unwrap();
        assert_eq!(saved.groups.len(), 1);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn auto_group_keeps_a_save_made_during_the_call() {
        let (project, base) = scratch("auto-race");
        let answer = r#"[{"title":"Login","tickets":["a","b"]}]"#;
        let saved = auto_with(&project, &board(), None, &|_| {
            save(&project, vec![group("g-9", &["d"])]).unwrap();
            Ok(answer.to_string())
        })
        .unwrap()
        .groups;
        assert_eq!(saved.len(), 2, "{saved:?}");
        assert_eq!(saved[0].id, "g-9");
        assert_eq!(saved[1].title, "Login");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn an_old_file_reads_without_auto_and_description() {
        let (project, base) = scratch("auto-old");
        write_file(&project.reports.join(FILE), "{\"groups\":[{\"id\":\"g-1\",\"title\":\"T\",\"tickets\":[\"a\"]}]}").unwrap();
        let groups = load(&project).unwrap().groups;
        assert!(!groups[0].auto);
        assert_eq!(groups[0].description, "");
        assert_eq!(groups[0].place, None);
        save(&project, groups).unwrap();
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert!(!text.contains("\"place\""), "a group without a place writes no place: {text}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_dragged_place_reads_back_the_same() {
        let (project, base) = scratch("place");
        let groups = vec![
            PlanGroup { auto: true, place: Some(PlanSpot { x: 250.0, y: 1200.0 }), ..group("auto-x-1", &["a"]) },
            PlanGroup { auto: true, place: Some(PlanSpot { x: -40.0, y: 100.0 }), ..group("auto-x-2", &["b"]) },
        ];
        let saved = save(&project, groups).unwrap().groups;
        assert_eq!(saved[0].place, Some(PlanSpot { x: 250.0, y: 1200.0 }));
        assert_eq!(saved[1].place, Some(PlanSpot { x: 0.0, y: 100.0 }), "a place left of the board is clamped to 0");
        assert_eq!(load(&project).unwrap().groups, saved);
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert!(text.contains("\"place\""), "{text}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_resized_box_reads_back_the_same() {
        let (project, base) = scratch("size");
        let groups = vec![
            PlanGroup { auto: true, size: Some(PlanSize { width: 724.0, height: 418.5 }), ..group("auto-x-1", &["a"]) },
            PlanGroup { auto: true, size: Some(PlanSize { width: 0.0, height: 300.0 }), ..group("auto-x-2", &["b"]) },
            PlanGroup { auto: true, size: Some(PlanSize { width: 300.0, height: -5.0 }), ..group("auto-x-3", &["c"]) },
            PlanGroup { auto: true, size: Some(PlanSize { width: f64::INFINITY, height: 300.0 }), ..group("auto-x-4", &["d"]) },
        ];
        let saved = save(&project, groups).unwrap().groups;
        assert_eq!(saved[0].size, Some(PlanSize { width: 724.0, height: 418.5 }));
        for dropped in &saved[1..] {
            assert_eq!(dropped.size, None, "{} drops a size that is not finite or not positive", dropped.id);
        }
        assert_eq!(load(&project).unwrap().groups, saved);
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert!(text.contains("\"size\"") && text.contains("\"width\": 724.0"), "{text}");
        assert_eq!(text.matches("\"size\"").count(), 1, "a group without a size writes no size: {text}");
        // The file of an older version has no size: it reads as None.
        write_file(&project.reports.join(FILE), "{\"groups\":[{\"id\":\"g-1\",\"auto\":true,\"tickets\":[\"a\"]}]}").unwrap();
        assert_eq!(load(&project).unwrap().groups[0].size, None);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn an_open_count_badge_reads_back_and_an_old_file_reads_closed() {
        // Ticket count-pill-opens-subgroups-inside-a: the open state stays over a save and a restart.
        let (project, base) = scratch("unfolded");
        let groups = vec![
            PlanGroup { auto: true, unfolded: true, ..group("auto-x-1", &["a"]) },
            PlanGroup { auto: true, ..group("auto-x-2", &["b"]) },
        ];
        let saved = save(&project, groups).unwrap().groups;
        assert!(saved[0].unfolded);
        assert!(!saved[1].unfolded);
        assert_eq!(load(&project).unwrap().groups, saved);
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert_eq!(text.matches("\"unfolded\": true").count(), 1, "{text}");
        assert!(!text.contains("\"unfolded\": false"), "a closed group writes no field: {text}");
        // The file of an older version has no field: it reads closed.
        write_file(&project.reports.join(FILE), "{\"groups\":[{\"id\":\"g-1\",\"auto\":true,\"tickets\":[\"a\"]}]}").unwrap();
        assert!(!load(&project).unwrap().groups[0].unfolded);
        let _ = fs::remove_dir_all(base);
    }
    fn section(id: &str, members: &[&str]) -> PlanGroup {
        PlanGroup { id: id.into(), title: "Section".into(), color: 2, groups: members.iter().map(|m| m.to_string()).collect(), ..PlanGroup::default() }
    }

    #[test]
    fn a_section_reads_back_the_same() {
        // Ticket i-need-an-option-to-create-group-of: a section holds topic groups and can be folded.
        let (project, base) = scratch("section");
        let groups = vec![
            PlanGroup { collapsed: true, ..section("s-1", &["auto-x-1", "auto-x-2"]) },
            PlanGroup { auto: true, collapsed: false, ..group("auto-x-1", &["a"]) },
            PlanGroup { auto: true, collapsed: false, ..group("auto-x-2", &["b"]) },
        ];
        let saved = save(&project, groups.clone()).unwrap().groups;
        assert_eq!(saved, groups);
        assert_eq!(load(&project).unwrap().groups, saved);
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert_eq!(text.matches("\"groups\": [").count(), 2, "the list of the file and the one section: {text}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_save_cleans_the_sections() {
        let (project, base) = scratch("section-clean");
        let groups = vec![
            PlanGroup { tickets: vec!["z".into()], auto: true, description: "No.".into(), place: Some(PlanSpot { x: 50.0, y: 50.0 }), size: Some(PlanSize { width: 400.0, height: 300.0 }), ..section("s-1", &[" auto-x-1 ", "auto-x-1", "unknown", "g-1", "s-2", "auto-x-2"]) },
            section("s-2", &["auto-x-1", "auto-x-3"]),
            section("s-3", &["auto-x-1", "gone"]),
            PlanGroup { auto: true, ..group("auto-x-1", &["a"]) },
            PlanGroup { auto: true, ..group("auto-x-2", &["b"]) },
            PlanGroup { auto: true, ..group("auto-x-3", &["c"]) },
            group("g-1", &["d"]),
        ];
        let saved = save(&project, groups).unwrap().groups;
        let ids: Vec<&str> = saved.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec!["s-1", "s-2", "auto-x-1", "auto-x-2", "auto-x-3", "g-1"], "a section without a topic group of its own goes: {saved:?}");
        assert_eq!(saved[0].groups, vec!["auto-x-1".to_string(), "s-2".to_string(), "auto-x-2".to_string()], "only topic groups and sections, trimmed, once: {saved:?}");
        assert!(saved[0].tickets.is_empty() && !saved[0].auto && saved[0].description.is_empty());
        assert_eq!((saved[0].place.clone(), saved[0].size.clone()), (None, None));
        assert_eq!(saved[1].groups, vec!["auto-x-3".to_string()], "a topic group stays in the first section only");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_nested_section_reads_back_the_same_and_open() {
        // Ticket group-everything-inside-a-selection-box: a section holds topic groups and sections.
        let (project, base) = scratch("section-nested");
        let groups = vec![
            PlanGroup { collapsed: true, ..section("s-1", &["auto-x-1", "s-2"]) },
            section("s-2", &["auto-x-2", "auto-x-3"]),
            PlanGroup { auto: true, ..group("auto-x-1", &["a"]) },
            PlanGroup { auto: true, ..group("auto-x-2", &["b"]) },
            PlanGroup { auto: true, ..group("auto-x-3", &["c"]) },
        ];
        let saved = save(&project, groups.clone()).unwrap().groups;
        assert_eq!(saved, groups);
        assert_eq!(load(&project).unwrap().groups, saved);
        // A held section that comes folded is opened: only the outer section folds (user decision 3).
        let mut folded = groups.clone();
        folded[1].collapsed = true;
        let saved = save(&project, folded).unwrap().groups;
        assert!(saved[0].collapsed && !saved[1].collapsed, "{saved:?}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_loop_of_sections_keeps_only_the_first_link() {
        let (project, base) = scratch("section-loop");
        let groups = vec![
            section("s-1", &["auto-x-1", "s-2"]),
            section("s-2", &["auto-x-2", "s-1", "s-2"]),
            section("s-3", &["s-3", "auto-x-3", "s-1"]),
            PlanGroup { auto: true, ..group("auto-x-1", &["a"]) },
            PlanGroup { auto: true, ..group("auto-x-2", &["b"]) },
            PlanGroup { auto: true, ..group("auto-x-3", &["c"]) },
        ];
        let saved = save(&project, groups).unwrap().groups;
        assert_eq!(saved[0].groups, vec!["auto-x-1".to_string(), "s-2".to_string()]);
        assert_eq!(saved[1].groups, vec!["auto-x-2".to_string()], "no loop and never itself: {saved:?}");
        assert_eq!(saved[2].groups, vec!["auto-x-3".to_string(), "s-1".to_string()], "s-1 had no holder yet: {saved:?}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn an_emptied_inner_section_goes_with_its_empty_holder() {
        let (project, base) = scratch("section-empty");
        let groups = vec![
            section("s-1", &["s-2"]),
            section("s-2", &["gone"]),
            section("s-3", &["auto-x-1", "s-4"]),
            section("s-4", &["gone"]),
            PlanGroup { auto: true, ..group("auto-x-1", &["a"]) },
        ];
        let saved = save(&project, groups).unwrap().groups;
        let ids: Vec<&str> = saved.iter().map(|g| g.id.as_str()).collect();
        assert_eq!(ids, vec!["s-3", "auto-x-1"], "{saved:?}");
        assert_eq!(saved[0].groups, vec!["auto-x-1".to_string()], "no dead id stays in the holder");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn an_old_file_reads_no_section_and_writes_none() {
        let (project, base) = scratch("section-old");
        write_file(&project.reports.join(FILE), "{\"groups\":[{\"id\":\"g-1\",\"auto\":true,\"tickets\":[\"a\"]}]}").unwrap();
        let groups = load(&project).unwrap().groups;
        assert!(groups[0].groups.is_empty());
        save(&project, groups).unwrap();
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert_eq!(text.matches("\"groups\"").count(), 1, "only the list of the file: {text}");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn auto_group_keeps_a_section() {
        let (project, base) = scratch("section-auto");
        let topic = PlanGroup { id: "auto-x-1".into(), title: "Login".into(), auto: true, tickets: vec!["a".into()], ..PlanGroup::default() };
        let held = PlanGroup { collapsed: true, ..section("s-1", &["auto-x-1"]) };
        save(&project, vec![held.clone(), topic]).unwrap();
        let answer = r#"[{"group":"auto-x-1","tickets":["b"]},{"group":"","title":"Looks","tickets":["c","d"]}]"#;
        let saved = auto_with(&project, &board(), None, &|_| Ok(answer.to_string())).unwrap().groups;
        assert_eq!(saved[0], held, "Auto group does not change a section");
        assert_eq!(saved[1].tickets, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(saved[2].title, "Looks");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_new_ticket_sort_asks_nothing_without_a_topic_group() {
        let (project, base) = scratch("new-none");
        let only: HashSet<String> = ["b".to_string()].into();
        let saved = auto_with(&project, &board(), Some(&only), &|_| panic!("no call")).unwrap();
        assert_eq!(saved, PlanGroups::default(), "no file: nothing is sorted");
        save(&project, vec![group("g-1", &["a"])]).unwrap();
        let saved = auto_with(&project, &board(), Some(&only), &|_| panic!("no call")).unwrap();
        assert_eq!(saved.groups.len(), 1, "only a manual group: nothing is sorted");
        sort_new_tickets(&project, &["b".to_string()]);
        assert!(queued_new(&project).is_empty(), "a project without a topic group queues nothing");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_new_ticket_sort_sends_only_the_named_tickets_without_a_group() {
        let (project, base) = scratch("new-only");
        let topic = PlanGroup { id: "auto-x-1".into(), title: "Login".into(), auto: true, tickets: vec!["a".into()], ..PlanGroup::default() };
        save(&project, vec![topic, group("g-1", &["c"])]).unwrap();
        let asked = std::cell::RefCell::new(String::new());
        let only: HashSet<String> = ["b".to_string(), "c".to_string()].into();
        let answer = r#"[{"group":"auto-x-1","tickets":["b"]}]"#;
        let saved = auto_with(&project, &board(), Some(&only), &|prompt| {
            *asked.borrow_mut() = prompt.to_string();
            Ok(answer.to_string())
        })
        .unwrap()
        .groups;
        let prompt = asked.borrow().clone();
        assert!(prompt.contains("\"id\": \"b\""), "the new ticket is sent: {prompt}");
        assert!(prompt.contains("auto-x-1"), "the prompt names the topic group: {prompt}");
        for other in ["a", "c", "d"] {
            assert!(!prompt.contains(&format!("\"id\": \"{other}\"")), "{other} is not sent: {prompt}");
        }
        assert_eq!(saved.len(), 2, "no new group: {saved:?}");
        assert_eq!(saved[0].tickets, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(saved[1], group("g-1", &["c"]), "the manual group does not change");
        assert!(!saved.iter().any(|g| g.tickets.contains(&"d".to_string())), "another loose ticket stays loose");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_queue_of_new_tickets_sorts_each_ticket_once() {
        let (project, base) = scratch("new-queue");
        fs::create_dir_all(&project.reports).unwrap();
        let cwd = project.root.to_string_lossy().into_owned();
        let one = crate::core::tickets::ticket_add(cwd.clone(), "Login with a key".into(), None, None, None).unwrap().id;
        let two = crate::core::tickets::ticket_add(cwd.clone(), "Dark theme for the board".into(), None, None, None).unwrap().id;
        let old = crate::core::tickets::ticket_add(cwd, "An old loose ticket".into(), None, None, None).unwrap().id;
        assert!(queued_new(&project).is_empty(), "no topic group yet: nothing queued");
        save(&project, vec![PlanGroup { id: "auto-x-1".into(), title: "Login".into(), auto: true, tickets: vec!["z".into()], ..PlanGroup::default() }]).unwrap();
        sort_new_tickets(&project, std::slice::from_ref(&one));
        assert!(!queue_new(&project.root, &[two.clone(), one.clone()]), "a sort runs: the second call starts none");
        let calls = std::cell::RefCell::new(Vec::new());
        drain_new(&project, &project.root, &|prompt| {
            calls.borrow_mut().push(prompt.to_string());
            Ok(format!(r#"[{{"group":"auto-x-1","tickets":["{one}"]}},{{"group":"","title":"Looks","tickets":["{two}"]}}]"#))
        });
        let calls = calls.into_inner();
        assert_eq!(calls.len(), 1, "one call for both tickets");
        assert!(calls[0].contains(&one) && calls[0].contains(&two) && !calls[0].contains(&old), "{}", calls[0]);
        let groups = load(&project).unwrap().groups;
        assert_eq!(groups[0].tickets, vec!["z".to_string(), one.clone()]);
        assert_eq!((groups[1].title.as_str(), groups[1].tickets.clone()), ("Looks", vec![two.clone()]), "Claude made a new group");
        assert!(queue_new(&project.root, &[old]), "the sort ended: the next ticket starts a new one");
        let _ = take_new(&project.root);
        assert!(take_new(&project.root).is_empty());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_part_joins_the_topic_group_of_its_parent() {
        let (project, base) = scratch("parts");
        join_parent_group(&project, "p", &["p-1".to_string()]).unwrap();
        assert!(!project.reports.join(FILE).exists(), "no file: nothing is written");
        let topic = PlanGroup { id: "auto-x-1".into(), auto: true, tickets: vec!["p".into()], ..PlanGroup::default() };
        let other = PlanGroup { id: "auto-x-2".into(), auto: true, tickets: vec!["p-2".into()], ..PlanGroup::default() };
        save(&project, vec![group("g-1", &["p"]), topic, other]).unwrap();
        join_parent_group(&project, "p", &["p-1".to_string(), "p-2".to_string()]).unwrap();
        let groups = load(&project).unwrap().groups;
        assert_eq!(groups[0].tickets, vec!["p".to_string()], "a manual group takes no part");
        assert_eq!(groups[1].tickets, vec!["p".to_string(), "p-1".to_string()], "the part joins the group of its parent");
        assert_eq!(groups[2].tickets, vec!["p-2".to_string()], "a part with a topic group stays there");
        join_parent_group(&project, "q", &["q-1".to_string()]).unwrap();
        assert_eq!(load(&project).unwrap().groups, groups, "a parent without a topic group changes nothing");
        let _ = fs::remove_dir_all(base);
    }
}
