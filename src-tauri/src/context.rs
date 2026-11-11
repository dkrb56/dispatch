//! The context of a Claude Code session by category, as the `/context` command of Claude Code
//! gives it. Print mode runs `/context` locally, without a request to the model: a fork of the
//! session that is not saved, without hooks and without MCP servers, so nothing of the session
//! changes and no server starts. The MCP tools are thus not in the table; the side panel shows
//! them with the rest as the difference to the real total of the session.

use std::process::Stdio;

use serde::Serialize;
use serde_json::Value;

use crate::info::{claude_command, NoWindow};

#[derive(Serialize, PartialEq, Debug)]
pub struct Category {
    name: String,
    tokens: u64,
}

#[derive(Serialize, PartialEq, Debug, Default)]
pub struct ContextUsage {
    model: String,
    /// The tokens in use, and the size of the context window.
    used: u64,
    window: u64,
    categories: Vec<Category>,
}

/// "130.2k" gives 130200, "1m" gives 1000000, "82" gives 82.
fn tokens(text: &str) -> Option<u64> {
    let text = text.trim().to_ascii_lowercase();
    let (number, factor) = match text.chars().last()? {
        'k' => (&text[..text.len() - 1], 1e3),
        'm' => (&text[..text.len() - 1], 1e6),
        _ => (text.as_str(), 1.0),
    };
    number.trim().replace(',', "").parse::<f64>().ok().map(|value| (value * factor).round() as u64)
}

/// Reads the text of `/context`: the model, the line `**Tokens:** <used> / <window>`, and the
/// rows of the first table, "Estimated usage by category".
fn parse_context(text: &str) -> ContextUsage {
    let mut usage = ContextUsage::default();
    let mut in_table = false;
    for line in text.lines() {
        let line = line.trim();
        if let Some(model) = line.strip_prefix("**Model:**") {
            usage.model = model.trim().to_string();
        } else if let Some(rest) = line.strip_prefix("**Tokens:**") {
            let rest = rest.split('(').next().unwrap_or_default();
            if let Some((used, window)) = rest.split_once('/') {
                usage.used = tokens(used).unwrap_or(0);
                usage.window = tokens(window).unwrap_or(0);
            }
        } else if line.starts_with("### ") {
            // The table of the categories ends where the next section starts.
            if !usage.categories.is_empty() {
                break;
            }
            in_table = line.contains("by category");
        } else if in_table && line.starts_with('|') {
            let cells: Vec<&str> = line.trim_matches('|').split('|').map(str::trim).collect();
            if let [name, count, ..] = cells.as_slice() {
                if let Some(count) = tokens(count) {
                    usage.categories.push(Category { name: name.to_string(), tokens: count });
                }
            }
        }
    }
    usage
}

/// Runs `/context` for a session in the folder of its terminal. `model` is the model of the
/// session; without it, Claude Code counts for its default model.
#[tauri::command(async)]
pub fn context_usage(cwd: String, session: String, model: Option<String>) -> Result<ContextUsage, String> {
    let plain = |text: &str, extra: &[char]| !text.is_empty() && text.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || extra.contains(&c));
    if !plain(&session, &[]) {
        return Err(format!("invalid session id: {session}"));
    }
    // A settings file that turns the hooks off; a JSON text as argument would pass through cmd.exe
    // on Windows.
    let settings = std::env::temp_dir().join("dispatch-context-settings.json");
    std::fs::write(&settings, "{\"disableAllHooks\":true}").map_err(|error| error.to_string())?;
    let mut command = claude_command();
    command.args(["-p", "/context", "--resume", &session]);
    command.args(["--fork-session", "--no-session-persistence", "--strict-mcp-config", "--output-format", "json"]);
    command.arg("--settings").arg(&settings);
    if let Some(model) = model.filter(|model| plain(model, &['.', '[', ']'])) {
        command.args(["--model", &model]);
    }
    let output = command
        .current_dir(&cwd)
        .stdin(Stdio::null())
        .no_window()
        .output()
        .map_err(|error| error.to_string())?;
    let reply: Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| format!("/context gave no answer: {}", String::from_utf8_lossy(&output.stderr).trim()))?;
    // A turn would be a request to the model: then the command was not run as a command.
    if reply["num_turns"].as_u64().unwrap_or(0) > 0 {
        return Err("Claude Code did not run /context as a command".to_string());
    }
    let usage = parse_context(reply["result"].as_str().unwrap_or_default());
    if usage.categories.is_empty() {
        return Err("the reply of /context has no table".to_string());
    }
    Ok(usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_text_of_context_gives_the_categories() {
        let text = "## Context Usage\n\n**Model:** claude-opus-5-5  \n**Tokens:** 130.2k / 1m (13%)\n\n### Estimated usage by category\n\n| Category | Tokens | Percentage |\n|----------|--------|------------|\n| System prompt | 5.3k | 0.5% |\n| Custom agents | 82 | 0.0% |\n| Messages | 93.7k | 9.4% |\n| Free space | 836.8k | 83.7% |\n\n### Skills\n\n| Skill | Source | Tokens |\n|-------|--------|--------|\n| nightmode | User | ~130 |\n";
        let usage = parse_context(text);
        assert_eq!((usage.model.as_str(), usage.used, usage.window), ("claude-opus-5-5", 130_200, 1_000_000));
        let names: Vec<(&str, u64)> = usage.categories.iter().map(|c| (c.name.as_str(), c.tokens)).collect();
        assert_eq!(names, vec![("System prompt", 5300), ("Custom agents", 82), ("Messages", 93_700), ("Free space", 836_800)]);
        assert_eq!(tokens("1.2m"), Some(1_200_000));
        assert_eq!(tokens("x"), None);
    }
}
