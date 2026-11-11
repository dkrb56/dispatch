//! The files of the window in the data folder: the layout (`state.json`) and the screen text of
//! each terminal (`screens/<id>.txt`).

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

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
