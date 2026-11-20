//! The comments and groups of the Plan view (ticket plan-view-selection-comments-and-groups).
//! A comment is an open box around some tickets of the tree; a group is the same box collapsed
//! into one stacked card. Both live in `plan-groups.json` of the task folder of the project, so
//! every window and every computer of the project sees the same. A save sends the whole list;
//! the last save wins (user decision 3). The tickets and their arrows do not change.

use std::collections::HashSet;
use std::fs;

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
/// group without an id or with the id of an earlier group.
fn normalize(groups: Vec<PlanGroup>) -> Vec<PlanGroup> {
    let mut ids = HashSet::new();
    groups
        .into_iter()
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
            })
        })
        .collect()
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
}
