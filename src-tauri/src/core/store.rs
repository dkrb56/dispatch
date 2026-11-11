//! The files of the window in the data folder: the layout (`state.json`) and the screen text of
//! each terminal (`screens/<id>.txt`). Also the state that every window of this data folder shares
//! (`shared.json`, ticket remote-shared-state): the Nightmode switch and the triage chat of each
//! project. In the mode "Use a host" the host reads and writes that file in its data folder.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::{json, Map, Value};

use crate::core::{err, Core};

fn screen_path(dir: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("invalid tab id: {id}"));
    }
    Ok(dir.join("screens").join(format!("{id}.txt")))
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

pub fn state_load(core: &Core) -> Result<Value, String> {
    let dir = core.data_dir()?;
    Ok(fs::read(dir.join("state.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or(Value::Null))
}

/// The frontend owns the layout format. `pane_ids` lists the open terminals.
pub fn state_save(core: &Core, state: Value, pane_ids: Vec<String>) -> Result<(), String> {
    let dir = core.data_dir()?;
    let json = serde_json::to_vec_pretty(&state).map_err(err)?;
    write_atomic(&dir.join("state.json"), &json)?;

    // Remove the screen text of closed terminals.
    if let Ok(entries) = fs::read_dir(dir.join("screens")) {
        for path in entries.flatten().map(|entry| entry.path()) {
            let open = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(|stem| pane_ids.iter().any(|id| id == stem));
            if !open {
                let _ = fs::remove_file(path);
            }
        }
    }
    Ok(())
}

pub fn screen_save(core: &Core, id: String, data: String) -> Result<(), String> {
    let dir = core.data_dir()?;
    write_atomic(&screen_path(&dir, &id)?, data.as_bytes())
}

pub fn screen_load(core: &Core, id: String) -> Result<Option<String>, String> {
    let dir = core.data_dir()?;
    Ok(fs::read_to_string(screen_path(&dir, &id)?).ok())
}

/// The folder of the records of the menu reads of the Chat view (ticket menu-read-recorder).
pub const MENU_RECORDS_DIR: &str = "menu-reads";
/// Each write keeps the newest records up to this number and removes the older ones.
pub const MENU_RECORDS_KEPT: usize = 50;

/// A record name: `menu-` and letters, digits and `-`, then `.json`. The page makes it from the time
/// and the pane id, so the order of the names is the order of the times.
fn menu_record_name(name: &str) -> Result<&str, String> {
    let stem = name.strip_prefix("menu-").and_then(|rest| rest.strip_suffix(".json"));
    match stem {
        Some(stem) if !stem.is_empty() && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => Ok(name),
        _ => Err(format!("invalid menu record name: {name}")),
    }
}

/// Writes the record `name` into `menu-reads` of the folder `dir`, then removes the oldest records
/// until `MENU_RECORDS_KEPT` remain. Other files in the folder stay.
fn save_menu_record_in(dir: &Path, name: &str, data: &str) -> Result<(), String> {
    let name = menu_record_name(name)?;
    let folder = dir.join(MENU_RECORDS_DIR);
    fs::create_dir_all(&folder).map_err(err)?;
    write_atomic(&folder.join(name), data.as_bytes())?;
    let mut records: Vec<String> = fs::read_dir(&folder)
        .map_err(err)?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|file| menu_record_name(file).is_ok())
        .collect();
    records.sort();
    let extra = records.len().saturating_sub(MENU_RECORDS_KEPT);
    for old in &records[..extra] {
        let _ = fs::remove_file(folder.join(old));
    }
    Ok(())
}

/// Writes a record of the menu reads of the Chat view into the data folder of the window.
pub fn menu_record_save(core: &Core, name: String, data: String) -> Result<(), String> {
    save_menu_record_in(&core.data_dir()?, &name, &data)
}

const SHARED_FILE: &str = "shared.json";
/// Two windows can change `shared.json` at the same time (the host runs each call on its own
/// thread): a read and its write happen under this lock, so no change is lost.
static SHARED_LOCK: Mutex<()> = Mutex::new(());

/// `night` as a boolean and `triage` as an object of `{ chat, role }` records; a missing or broken
/// field takes `false` and `{}`, and a record without a `chat` string is dropped.
fn clean_shared(value: &Value) -> Value {
    let night = value.get("night").and_then(Value::as_bool).unwrap_or(false);
    let mut triage = Map::new();
    if let Some(records) = value.get("triage").and_then(Value::as_object) {
        for (key, record) in records {
            let Some(chat) = record.get("chat").and_then(Value::as_str) else { continue };
            let role = record.get("role").and_then(Value::as_str).map_or(Value::Null, |role| Value::String(role.into()));
            triage.insert(key.clone(), json!({ "chat": chat, "role": role }));
        }
    }
    json!({ "night": night, "triage": triage })
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

/// The shared state of the data folder `dir`. Without `shared.json` it takes `night` and `triage`
/// of `state.json` (the format before this ticket) and writes them as `shared.json`.
fn load_in(dir: &Path) -> Result<Value, String> {
    let path = dir.join(SHARED_FILE);
    if let Some(saved) = read_json(&path) {
        return Ok(clean_shared(&saved));
    }
    let shared = clean_shared(&read_json(&dir.join("state.json")).unwrap_or(Value::Null));
    write_atomic(&path, &serde_json::to_vec_pretty(&shared).map_err(err)?)?;
    Ok(shared)
}

/// Puts `night` when given and each record of `triage` (a `null` record removes the project).
fn set_in(dir: &Path, night: Option<bool>, triage: Option<Map<String, Value>>) -> Result<Value, String> {
    let _guard = SHARED_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut shared = load_in(dir)?;
    if let Some(night) = night {
        shared["night"] = Value::Bool(night);
    }
    for (key, record) in triage.unwrap_or_default() {
        let records = shared["triage"].as_object_mut().expect("clean_shared gives an object");
        if record.is_null() {
            records.remove(&key);
        } else {
            records.insert(key, record);
        }
    }
    let shared = clean_shared(&shared);
    write_atomic(&dir.join(SHARED_FILE), &serde_json::to_vec_pretty(&shared).map_err(err)?)?;
    Ok(shared)
}

/// The Nightmode switch and the triage chats that every window of this data folder shares.
pub fn shared_load(core: &Core) -> Result<Value, String> {
    let dir = core.data_dir()?;
    let _guard = SHARED_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    load_in(&dir)
}

/// Changes the shared state and gives it back.
pub fn shared_set(core: &Core, night: Option<bool>, triage: Option<Map<String, Value>>) -> Result<Value, String> {
    set_in(&core.data_dir()?, night, triage)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dispatch-shared-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn the_first_load_takes_the_fields_of_an_old_state_json() {
        let dir = scratch("migrate");
        let old = r#"{"tabs":[],"active":null,"night":true,"triage":{"d:\\p":{"chat":"X","role":"r1"},"d:\\q":{"chat":"Y"}}}"#;
        fs::write(dir.join("state.json"), old).unwrap();
        let shared = load_in(&dir).unwrap();
        assert_eq!(shared, json!({ "night": true, "triage": { "d:\\p": { "chat": "X", "role": "r1" }, "d:\\q": { "chat": "Y", "role": null } } }));
        assert_eq!(read_json(&dir.join(SHARED_FILE)).unwrap(), shared, "the file is written");
        // From now on the file counts, not state.json.
        fs::write(dir.join("state.json"), r#"{"night":false}"#).unwrap();
        assert_eq!(load_in(&dir).unwrap()["night"], true);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn without_any_file_the_switch_is_off_and_no_chat_is_known() {
        let dir = scratch("empty");
        assert_eq!(load_in(&dir).unwrap(), json!({ "night": false, "triage": {} }));
        fs::write(dir.join(SHARED_FILE), "{ broken").unwrap();
        assert_eq!(load_in(&dir).unwrap(), json!({ "night": false, "triage": {} }), "a broken file counts as none");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_change_keeps_the_other_field_and_a_null_record_removes_a_project() {
        let dir = scratch("merge");
        let records = |value: Value| value.as_object().cloned();
        set_in(&dir, None, records(json!({ "a": { "chat": "1", "role": null } }))).unwrap();
        set_in(&dir, Some(true), None).unwrap();
        let shared = set_in(&dir, None, records(json!({ "b": { "chat": "2", "role": "m" } }))).unwrap();
        assert_eq!(shared, json!({ "night": true, "triage": { "a": { "chat": "1", "role": null }, "b": { "chat": "2", "role": "m" } } }));
        let shared = set_in(&dir, Some(false), records(json!({ "a": null, "c": { "role": "no chat" } }))).unwrap();
        assert_eq!(shared, json!({ "night": false, "triage": { "b": { "chat": "2", "role": "m" } } }));
        assert_eq!(load_in(&dir).unwrap(), shared);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_menu_record_name_must_be_menu_letters_digits_dashes_json() {
        let dir = scratch("record-names");
        for bad in ["menu-../x.json", "menu-a/b.json", "menu-a\\b.json", "menu-a.b.json", "menu-.json", "other-1.json", "menu-1.txt", "menu-1.json.tmp"] {
            assert!(save_menu_record_in(&dir, bad, "{}").is_err(), "{bad} is refused");
        }
        assert!(!dir.join(MENU_RECORDS_DIR).join("x.json").exists());
        save_menu_record_in(&dir, "menu-20261112-001705-042-0f3c9a2e-1b2c.json", "{\"reads\":[]}").unwrap();
        let written = fs::read_to_string(dir.join(MENU_RECORDS_DIR).join("menu-20261112-001705-042-0f3c9a2e-1b2c.json")).unwrap();
        assert_eq!(written, "{\"reads\":[]}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_menu_record_write_keeps_the_newest_fifty_and_other_files() {
        let dir = scratch("record-keep");
        fs::create_dir_all(dir.join(MENU_RECORDS_DIR)).unwrap();
        fs::write(dir.join(MENU_RECORDS_DIR).join("notes.txt"), "mine").unwrap();
        for index in 0..MENU_RECORDS_KEPT + 2 {
            save_menu_record_in(&dir, &format!("menu-20261112-0000{index:02}-000-p.json"), "{}").unwrap();
        }
        let mut names: Vec<String> =
            fs::read_dir(dir.join(MENU_RECORDS_DIR)).unwrap().flatten().map(|entry| entry.file_name().into_string().unwrap()).collect();
        names.sort();
        assert_eq!(names.len(), MENU_RECORDS_KEPT + 1, "50 records and notes.txt");
        assert!(names.contains(&"notes.txt".to_string()));
        assert!(!names.contains(&"menu-20261112-000000-000-p.json".to_string()), "the oldest record is gone");
        assert!(!names.contains(&"menu-20261112-000001-000-p.json".to_string()), "the second oldest record is gone");
        assert!(names.contains(&"menu-20261112-000002-000-p.json".to_string()));
        assert!(names.contains(&format!("menu-20261112-0000{:02}-000-p.json", MENU_RECORDS_KEPT + 1)));
        fs::remove_dir_all(&dir).unwrap();
    }
}
