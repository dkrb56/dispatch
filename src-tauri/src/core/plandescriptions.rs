//! The short lines of the Plan view (ticket show-a-short-description-on-each-ticket). Claude
//! writes one short line per ticket that says what the ticket does; each card of the Plan view
//! shows it under the title. The lines live in `plan-descriptions.json` of the task folder, a map
//! from the ticket id to the line and the title that it was made from. A line whose title is no
//! longer the title of the ticket is stale: it still shows, and the next Describe replaces it.

use std::collections::{BTreeMap, HashSet};
use std::fs;

use serde::{Deserialize, Serialize};

use crate::core::err;
use crate::core::pipeline::{write_file, Project};

/// The file of the lines in the task folder.
const FILE: &str = "plan-descriptions.json";
/// The model, the effort and the time limit in seconds of one Claude call of Describe.
const MODEL: (&str, &str, u64) = ("sonnet", "medium", 300);
/// The tickets of one Claude call: a call for all tickets of a large project takes too long.
const BATCH: usize = 40;
/// The characters of the words of a ticket and of the goal of its plan that the prompt holds.
const WORDS_CHARS: usize = 400;
/// The longest line, in characters.
const LINE_CHARS: usize = 100;

/// The line of one ticket and the title of the ticket when Claude wrote it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PlanDescription {
    pub text: String,
    pub title: String,
}

/// The lines of a project by ticket id: the reply of both commands and the shape of the file.
pub type PlanDescriptions = BTreeMap<String, PlanDescription>;

/// The lines of the project. No file gives an empty map; a file that is not correct JSON gives
/// an error that names it.
pub fn plan_descriptions_load(cwd: String) -> Result<PlanDescriptions, String> {
    load(&Project::find(&cwd)?)
}

fn load(project: &Project) -> Result<PlanDescriptions, String> {
    let path = project.reports.join(FILE);
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(PlanDescriptions::new());
    };
    if text.trim().is_empty() {
        return Ok(PlanDescriptions::new());
    }
    serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("{} is not correct JSON: {e}", path.display()))
}

fn save(project: &Project, lines: &PlanDescriptions) -> Result<(), String> {
    let text = serde_json::to_string_pretty(lines).map_err(err)?;
    write_file(&project.reports.join(FILE), &format!("{text}\n"))
}

/// One ticket as Describe sends it to Claude.
#[derive(Clone, Debug, PartialEq, Default)]
pub(crate) struct DescribeTicket {
    pub(crate) id: String,
    pub(crate) status: String,
    pub(crate) title: String,
    pub(crate) summary: String,
    /// The start of the section Goal of the plan of the ticket; empty without a plan.
    pub(crate) goal: String,
}

/// One line of the answer of Claude.
#[derive(Deserialize, Clone, Debug, PartialEq, Default)]
#[serde(default)]
struct Answer {
    id: String,
    text: String,
}

/// Asks Claude for a short line for each ticket of the project that has none or whose title
/// changed, done and canceled tickets too (user decision 1). The tickets go in batches; each batch
/// is saved, so a later failure keeps the lines of the earlier batches. Gives the saved lines.
pub fn plan_describe(cwd: String) -> Result<PlanDescriptions, String> {
    let project = Project::find(&cwd)?;
    let plans = project.plans();
    let tickets: Vec<DescribeTicket> = crate::core::tickets::list(&project)
        .into_iter()
        .map(|t| {
            let task = if t.task.is_empty() { t.id.clone() } else { t.task.clone() };
            let goal = fs::read_to_string(plans.join(format!("{task}.md"))).map(|text| goal_of(&text)).unwrap_or_default();
            DescribeTicket { id: t.id, status: t.status, title: t.title, summary: t.summary, goal }
        })
        .collect();
    let root = project.root.clone();
    describe_with(&project, &tickets, &|prompt| crate::core::rules_check::ask(&root, prompt, MODEL.0, MODEL.1, MODEL.2))
}

/// `plan_describe` with the tickets and the model as arguments; a test gives a fake.
pub(crate) fn describe_with(project: &Project, tickets: &[DescribeTicket], ask: &dyn Fn(&str) -> Result<String, String>) -> Result<PlanDescriptions, String> {
    let before = load(project)?;
    let open: Vec<&DescribeTicket> = tickets
        .iter()
        .filter(|t| before.get(&t.id).map_or(true, |line| line.text.trim().is_empty() || line.title != t.title))
        .collect();
    for batch in open.chunks(BATCH) {
        let answer = ask(&prompt(batch))?;
        let lines = parse_answer(&answer, batch)?;
        // The Claude call takes minutes: read the file again, so a save made meanwhile stays.
        let mut now = load(project)?;
        now.extend(lines);
        save(project, &now)?;
    }
    load(project)
}

/// The prompt of one batch of Describe.
fn prompt(tickets: &[&DescribeTicket]) -> String {
    let items: Vec<serde_json::Value> = tickets
        .iter()
        .map(|t| {
            let words: String = without_image_paths(&t.summary).chars().take(WORDS_CHARS).collect();
            let goal: String = t.goal.chars().take(WORDS_CHARS).collect();
            serde_json::json!({ "id": t.id, "status": t.status, "title": t.title, "words": words, "goal": goal })
        })
        .collect();
    let items = serde_json::to_string_pretty(&items).unwrap_or_default();
    format!(
        "You write one short line for each ticket of a software project: what the ticket does for the user.\n\
         Each ticket has an id, a status, a title, the first words of the user and the goal of its plan when it has one.\n\
         The title is often the first raw words of the user; the line must be clearer than the title.\n\n\
         Tickets:\n{items}\n\n\
         Rules:\n\
         - One sentence of at most 12 words for each ticket of the list.\n\
         - Plain everyday words; say what changes for the user.\n\
         - No ticket id, no file names, no code.\n\n\
         Answer with a JSON array only, no other text:\n\
         [{{\"id\": \"<ticket id>\", \"text\": \"<line>\"}}]\n"
    )
}

/// The words of a ticket without the paths of pasted images, which the box puts first.
fn without_image_paths(summary: &str) -> String {
    let image = |word: &str| {
        let lower = word.to_ascii_lowercase();
        (lower.contains('\\') || lower.contains('/')) && [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"].iter().any(|e| lower.ends_with(e))
    };
    summary
        .lines()
        .map(|line| line.split_whitespace().filter(|w| !image(w)).collect::<Vec<_>>().join(" "))
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// The text of the section `## Goal` of a plan, without its heading.
fn goal_of(plan: &str) -> String {
    let mut lines = plan.lines().skip_while(|l| l.trim() != "## Goal");
    if lines.next().is_none() {
        return String::new();
    }
    lines.take_while(|l| !l.starts_with("## ")).collect::<Vec<_>>().join("\n").trim().to_string()
}

/// Reads the answer of Claude for one batch: drops unknown ids and empty lines, keeps the first
/// line of an id, cuts a long line and stores the title of the ticket. An answer without a JSON
/// array is an error.
fn parse_answer(answer: &str, batch: &[&DescribeTicket]) -> Result<PlanDescriptions, String> {
    let bad = || "Claude did not answer with a list of lines. Try Describe again.".to_string();
    let start = answer.find('[').ok_or_else(bad)?;
    let end = answer.rfind(']').ok_or_else(bad)?;
    if end < start {
        return Err(bad());
    }
    let answers: Vec<Answer> = serde_json::from_str(&answer[start..=end]).map_err(|_| bad())?;
    let mut seen = HashSet::new();
    let mut lines = PlanDescriptions::new();
    for a in answers {
        let id = a.id.trim();
        let Some(ticket) = batch.iter().find(|t| t.id == id) else { continue };
        let text = short_line(&a.text);
        if text.is_empty() || !seen.insert(id.to_string()) {
            continue;
        }
        lines.insert(id.to_string(), PlanDescription { text, title: ticket.title.clone() });
    }
    Ok(lines)
}

/// The line on one line, cut to `LINE_CHARS` characters.
fn short_line(text: &str) -> String {
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().count() <= LINE_CHARS {
        return text;
    }
    let cut: String = text.chars().take(LINE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str) -> (Project, PathBuf) {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("dispatch-plandescriptions-{name}-{nanos}"));
        let root = base.join("proj");
        fs::create_dir_all(&root).unwrap();
        (Project::scratch(root.clone(), root.join(".dispatch")), base)
    }

    fn line(text: &str, title: &str) -> PlanDescription {
        PlanDescription { text: text.into(), title: title.into() }
    }

    fn ticket(id: &str, status: &str, title: &str) -> DescribeTicket {
        DescribeTicket { id: id.into(), status: status.into(), title: title.into(), summary: format!("words of {id}"), goal: String::new() }
    }

    fn board() -> Vec<DescribeTicket> {
        vec![ticket("a", "done", "Login page"), ticket("b", "new", "Login error"), ticket("c", "backlog", "Dark theme"), ticket("d", "canceled", "Old idea")]
    }

    /// A fake Claude that answers "line of <id>" for each id of the prompt.
    fn echo(prompt: &str) -> Result<String, String> {
        let ids: Vec<String> = prompt
            .lines()
            .filter_map(|l| l.trim().strip_prefix("\"id\": \"").and_then(|r| r.split('"').next()).map(str::to_string))
            .filter(|id| id != "<ticket id>")
            .collect();
        let items: Vec<serde_json::Value> = ids.iter().map(|id| serde_json::json!({ "id": id, "text": format!("line of {id}") })).collect();
        Ok(serde_json::to_string(&items).unwrap())
    }

    #[test]
    fn a_missing_file_gives_no_lines() {
        let (project, base) = scratch("missing");
        assert_eq!(load(&project), Ok(PlanDescriptions::new()));
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_save_reads_back_the_same() {
        let (project, base) = scratch("round");
        let mut lines = PlanDescriptions::new();
        lines.insert("a".into(), line("Signs the user in.", "Login page"));
        lines.insert("b".into(), line("Shows a clear login error.", "Login error"));
        save(&project, &lines).unwrap();
        assert_eq!(load(&project).unwrap(), lines);
        let text = fs::read_to_string(project.reports.join(FILE)).unwrap();
        assert!(text.ends_with("}\n"), "pretty JSON with a final newline: {text}");
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
    fn describe_fills_only_tickets_without_a_line_or_with_a_changed_title() {
        let (project, base) = scratch("fill");
        let mut lines = PlanDescriptions::new();
        lines.insert("a".into(), line("Signs the user in.", "Login page"));
        lines.insert("b".into(), line("Old line.", "Login eror"));
        lines.insert("gone".into(), line("A deleted ticket.", "Gone"));
        save(&project, &lines).unwrap();
        let asked = RefCell::new(String::new());
        let saved = describe_with(&project, &board(), &|prompt| {
            *asked.borrow_mut() = prompt.to_string();
            echo(prompt)
        })
        .unwrap();
        let prompt = asked.borrow().clone();
        assert!(!prompt.contains("\"id\": \"a\""), "a ticket with a current line is not sent: {prompt}");
        for part in ["\"id\": \"b\"", "\"id\": \"c\"", "\"id\": \"d\"", "\"canceled\"", "words of c", "Dark theme"] {
            assert!(prompt.contains(part), "the prompt holds {part}: {prompt}");
        }
        assert_eq!(saved["a"], line("Signs the user in.", "Login page"));
        assert_eq!(saved["b"], line("line of b", "Login error"), "a changed title gets a new line");
        assert_eq!(saved["c"], line("line of c", "Dark theme"));
        assert_eq!(saved["d"], line("line of d", "Old idea"));
        assert_eq!(saved["gone"], line("A deleted ticket.", "Gone"), "lines of deleted tickets stay");
        assert_eq!(load(&project).unwrap(), saved, "the lines are saved");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn describe_without_open_tickets_asks_nothing() {
        let (project, base) = scratch("none");
        let lines: PlanDescriptions = board().into_iter().map(|t| (t.id.clone(), line("A line.", &t.title))).collect();
        save(&project, &lines).unwrap();
        let saved = describe_with(&project, &board(), &|_| panic!("no call")).unwrap();
        assert_eq!(saved, lines);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn unknown_ids_and_empty_lines_are_dropped_and_a_long_line_is_cut() {
        let (project, base) = scratch("drop");
        let long = "word ".repeat(60);
        let answer = format!("Here:\n```json\n[{{\"id\":\"a\",\"text\":\"  Signs\\nthe user in.  \"}},{{\"id\":\"zzz\",\"text\":\"No ticket.\"}},{{\"id\":\"b\",\"text\":\"  \"}},{{\"id\":\"c\",\"text\":\"{long}\"}},{{\"id\":\"a\",\"text\":\"Second line of a.\"}}]\n```");
        let saved = describe_with(&project, &board(), &|_| Ok(answer.clone())).unwrap();
        assert_eq!(saved["a"].text, "Signs the user in.", "the first line of an id, on one line");
        assert!(!saved.contains_key("zzz") && !saved.contains_key("b"), "{saved:?}");
        assert_eq!(saved["c"].text.chars().count(), LINE_CHARS);
        assert!(saved["c"].text.ends_with('…'), "{}", saved["c"].text);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn an_answer_without_json_is_an_error_and_saves_nothing() {
        let (project, base) = scratch("bad");
        let error = describe_with(&project, &board(), &|_| Ok("I cannot do that.".to_string())).unwrap_err();
        assert!(error.contains("did not answer with a list of lines"), "{error}");
        let error = describe_with(&project, &board(), &|_| Ok("[{ not json ]".to_string())).unwrap_err();
        assert!(error.contains("did not answer with a list of lines"), "{error}");
        let error = describe_with(&project, &board(), &|_| Err("Claude Code gave an empty answer.".to_string())).unwrap_err();
        assert_eq!(error, "Claude Code gave an empty answer.");
        assert_eq!(load(&project).unwrap(), PlanDescriptions::new(), "nothing saved");
        assert!(!project.reports.join(FILE).exists());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn a_save_made_during_the_call_stays() {
        let (project, base) = scratch("race");
        let saved = describe_with(&project, &board(), &|prompt| {
            let mut other = PlanDescriptions::new();
            other.insert("x".into(), line("Written meanwhile.", "X"));
            save(&project, &other).unwrap();
            echo(prompt)
        })
        .unwrap();
        assert_eq!(saved["x"], line("Written meanwhile.", "X"));
        assert_eq!(saved["a"].text, "line of a");
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn tickets_go_in_batches_and_each_batch_is_saved() {
        let (project, base) = scratch("batches");
        let tickets: Vec<DescribeTicket> = (0..BATCH * 2 + 5).map(|n| ticket(&format!("t{n:03}"), "new", &format!("Title {n}"))).collect();
        let calls = RefCell::new(0);
        let error = describe_with(&project, &tickets, &|prompt| {
            *calls.borrow_mut() += 1;
            if *calls.borrow() == 3 {
                return Err("Claude Code stopped.".to_string());
            }
            let count = prompt.matches("\"status\": \"new\"").count();
            assert_eq!(count, BATCH, "a full batch");
            echo(prompt)
        })
        .unwrap_err();
        assert_eq!(error, "Claude Code stopped.");
        assert_eq!(*calls.borrow(), 3);
        let saved = load(&project).unwrap();
        assert_eq!(saved.len(), BATCH * 2, "the first two batches are saved: {}", saved.len());
        let again = describe_with(&project, &tickets, &|prompt| {
            assert_eq!(prompt.matches("\"status\": \"new\"").count(), 5, "only the rest is sent");
            echo(prompt)
        })
        .unwrap();
        assert_eq!(again.len(), tickets.len());
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn the_prompt_drops_image_paths_and_holds_the_goal() {
        let mut t = ticket("a", "new", "C:\\p\\paste-1.png why");
        t.summary = "C:\\Users\\dani\\pasted\\paste-1.png C:/x/paste-2.PNG why is the list empty\nsecond line".into();
        t.goal = "Show the list again.".into();
        let text = prompt(&[&t]);
        assert!(text.contains("why is the list empty\\nsecond line"), "{text}");
        assert!(!text.contains("paste-2"), "{text}");
        assert!(text.contains("Show the list again."), "{text}");
    }

    #[test]
    fn the_goal_is_read_from_the_plan() {
        let plan = "# Plan: x\n\n## Summary\nS.\n\n## Goal\nThe goal line.\nSecond line.\n\n## TL;DR\n- t\n";
        assert_eq!(goal_of(plan), "The goal line.\nSecond line.");
        assert_eq!(goal_of("# Plan\n\n## Summary\nS.\n"), "");
    }
}
