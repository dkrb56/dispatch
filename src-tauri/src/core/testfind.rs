//! Finds the tests of a project from its files, for the list of checks of Setup pipeline. It reads
//! the project folder and its direct subfolders and runs nothing. A command holds only fixed words
//! and names that pass `safe`, so the text of a project file cannot add a command of its own.

use std::fs;
use std::path::Path;

use serde_json::Value;

/// Folders that hold build output or installed packages, not a project of their own.
const SKIPPED: [&str; 9] = ["node_modules", "target", "dist", "build", "out", "vendor", "venv", "coverage", "__pycache__"];

/// The tests found so far, as name and command. A second test with the same name or command is left out.
#[derive(Default)]
struct Found(Vec<(String, String)>);

impl Found {
    fn add(&mut self, name: String, command: String) {
        if !self.0.iter().any(|(known, line)| known.eq_ignore_ascii_case(&name) || *line == command) {
            self.0.push((name, command));
        }
    }
}

/// A folder to read: the project folder, or a direct subfolder with its name in `sub`.
struct Folder<'a> {
    path: &'a Path,
    sub: Option<&'a str>,
    names: Vec<String>,
}

impl<'a> Folder<'a> {
    fn read(path: &'a Path, sub: Option<&'a str>) -> Self {
        Folder { path, sub, names: names_in(path) }
    }

    fn has(&self, name: &str) -> bool {
        self.names.iter().any(|known| known.eq_ignore_ascii_case(name))
    }

    fn has_kind(&self, end: &str) -> bool {
        self.names.iter().any(|known| known.to_ascii_lowercase().ends_with(end))
    }

    fn text(&self, name: &str) -> String {
        fs::read_to_string(self.path.join(name)).unwrap_or_default().trim_start_matches('\u{feff}').to_string()
    }

    /// A path from the project folder. The name of a check of a subfolder has the same form.
    fn relative(&self, path: &str) -> String {
        match self.sub {
            Some(sub) => format!("{sub}/{path}"),
            None => path.to_string(),
        }
    }

    /// A command with `root` in the project folder, and with `sub` and the folder name in a subfolder.
    fn command(&self, root: &str, sub: impl Fn(&str) -> String) -> String {
        self.sub.map_or_else(|| root.to_string(), sub)
    }
}

/// The names in a folder, sorted. Empty for a folder that cannot be read.
fn names_in(path: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(path).into_iter().flatten().flatten().filter_map(|entry| entry.file_name().into_string().ok()).collect();
    names.sort();
    names
}

/// A name that may stand in a command: letters, digits and `.`, `_`, `-`, `:`, with a letter or a digit first.
fn safe(name: &str) -> bool {
    name.chars().next().is_some_and(|first| first.is_ascii_alphanumeric()) && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | ':'))
}

/// A script or target name that runs tests or a gate once. A name for watching or debugging is left
/// out, because it does not end or waits for a person.
fn is_test_name(name: &str) -> bool {
    let name = name.to_ascii_lowercase().replace('_', "-");
    if ["watch", "debug", "update", ":ui", "-ui", ":dev", "-dev"].iter().any(|word| name.contains(word)) {
        return false;
    }
    matches!(name.as_str(), "test" | "tests" | "e2e" | "lint" | "check" | "typecheck" | "type-check")
        || ["test:", "test-", "test.", "tests:", "tests-", "e2e:", "e2e-"].iter().any(|start| name.starts_with(start))
        || [":test", "-test", ".test", ":tests", "-tests", ":e2e", "-e2e"].iter().any(|end| name.ends_with(end))
}

/// The tests of a project as name and command, in a fixed order: the project folder first, then its
/// subfolders by name.
pub fn find_tests(root: &Path) -> Vec<(String, String)> {
    let mut found = Found::default();
    let top = Folder::read(root, None);
    read_folder(&top, true, &mut found);
    // `cargo test` of a workspace already covers the crates in its subfolders.
    let cargo_below = !top.text("Cargo.toml").contains("[workspace]");
    for name in &top.names {
        let path = root.join(name);
        if path.is_dir() && safe(name) && !name.contains(':') && !SKIPPED.contains(&name.to_ascii_lowercase().as_str()) {
            read_folder(&Folder::read(&path, Some(name)), cargo_below, &mut found);
        }
    }
    found.0
}

fn read_folder(folder: &Folder, cargo: bool, found: &mut Found) {
    node_tests(folder, found);
    if cargo && folder.has("Cargo.toml") {
        found.add(folder.relative("cargo tests"), folder.command("cargo test", |sub| format!("cargo test --manifest-path {sub}/Cargo.toml")));
    }
    python_tests(folder, found);
    if folder.has("go.mod") {
        found.add(folder.relative("go tests"), folder.command("go test ./...", |sub| format!("go -C {sub} test ./...")));
    }
    if folder.has_kind(".sln") || folder.has_kind(".slnx") {
        found.add(folder.relative("dotnet tests"), folder.command("dotnet test", |sub| format!("dotnet test {sub}")));
    }
    if folder.has("pom.xml") {
        found.add(folder.relative("maven tests"), folder.command("mvn test", |sub| format!("mvn -f {sub}/pom.xml test")));
    }
    if folder.has("build.gradle") || folder.has("build.gradle.kts") {
        let root = if folder.has("gradlew") { "./gradlew test" } else { "gradle test" };
        found.add(folder.relative("gradle tests"), folder.command(root, |sub| format!("gradle -p {sub} test")));
    }
    make_targets(folder, found);
    script_files(folder, found);
}

/// The test scripts of `package.json`, a test runner without a script, and tests for `node --test`.
fn node_tests(folder: &Folder, found: &mut Found) {
    let package: Value = serde_json::from_str(&folder.text("package.json")).unwrap_or(Value::Null);
    let scripts: Vec<(&str, &str)> = package["scripts"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(name, body)| body.as_str().map(|body| (name.as_str(), body)))
        .filter(|(name, body)| safe(name) && is_test_name(name) && !body.contains("no test specified"))
        .collect();
    let (tool, flag) = if folder.has("pnpm-lock.yaml") {
        ("pnpm", "--dir")
    } else if folder.has("yarn.lock") {
        ("yarn", "--cwd")
    } else if folder.has("bun.lock") || folder.has("bun.lockb") {
        ("bun", "--cwd")
    } else {
        ("npm", "--prefix")
    };
    for (name, _) in &scripts {
        found.add(folder.relative(name), folder.command(&format!("{tool} run {name}"), |sub| format!("{tool} {flag} {sub} run {name}")));
    }
    let used = |word: &str| scripts.iter().any(|(_, body)| body.contains(word));
    if folder.sub.is_none() {
        let depends = |name: &str| ["dependencies", "devDependencies"].iter().any(|group| package[group].get(name).is_some());
        for (dependency, word, command) in [("vitest", "vitest", "npx vitest run"), ("jest", "jest", "npx jest"), ("@playwright/test", "playwright", "npx playwright test")] {
            if depends(dependency) && !used(word) {
                found.add(word.to_string(), command.to_string());
            }
        }
    }
    if used("node --test") {
        return;
    }
    for dir in ["tests", "test"] {
        let path = folder.path.join(dir);
        let first = names_in(&path).into_iter().find_map(|name| {
            let extension = ["ts", "mts", "js", "mjs", "cjs"].into_iter().find(|extension| name.ends_with(&format!(".test.{extension}")))?;
            Some((name, extension))
        });
        if let Some((name, extension)) = first {
            if fs::read_to_string(path.join(name)).is_ok_and(|text| text.contains("node:test")) {
                found.add(folder.relative("node tests"), format!("node --test \"{}/**/*.test.{extension}\"", folder.relative(dir)));
                return;
            }
        }
    }
}

/// pytest when the project configures it, else `unittest` for a folder `tests` with `test_*.py`.
fn python_tests(folder: &Folder, found: &mut Found) {
    let tests = folder.path.join("tests");
    let pytest = folder.has("pytest.ini")
        || folder.has("conftest.py")
        || tests.join("conftest.py").is_file()
        || folder.text("pyproject.toml").contains("[tool.pytest")
        || folder.text("setup.cfg").contains("[tool:pytest]")
        || folder.text("tox.ini").contains("[pytest]");
    if pytest {
        found.add(folder.relative("pytest"), folder.command("python -m pytest", |sub| format!("python -m pytest {sub}")));
    } else if names_in(&tests).iter().any(|name| name.starts_with("test_") && name.ends_with(".py")) {
        found.add(folder.relative("python tests"), format!("python -m unittest discover -s {}", folder.relative("tests")));
    }
}

/// The test targets of a Makefile.
fn make_targets(folder: &Folder, found: &mut Found) {
    let Some(file) = ["GNUmakefile", "Makefile", "makefile"].into_iter().find(|name| folder.names.iter().any(|known| known == name)) else { return };
    for line in folder.text(file).lines() {
        let Some((target, rest)) = line.split_once(':') else { continue };
        if !rest.starts_with('=') && safe(target) && !target.contains(':') && is_test_name(target) {
            found.add(folder.relative(&format!("make {target}")), folder.command(&format!("make {target}"), |sub| format!("make -C {sub} {target}")));
        }
    }
}

/// The test utilities of a folder `scripts`: a file with a test name that a known program runs.
fn script_files(folder: &Folder, found: &mut Found) {
    for name in names_in(&folder.path.join("scripts")) {
        let Some((stem, extension)) = name.rsplit_once('.') else { continue };
        let runner = match extension.to_ascii_lowercase().as_str() {
            "ps1" => "powershell -ExecutionPolicy Bypass -File",
            "js" | "mjs" | "cjs" => "node",
            "py" => "python",
            "sh" => "bash",
            _ => continue,
        };
        if safe(&name) && is_test_name(stem) {
            found.add(folder.relative(&name), format!("{runner} {}", folder.relative(&format!("scripts/{name}"))));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch(name: &str, files: &[(&str, &str)]) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("dispatch-testfind-{name}-{nanos}"));
        for (path, text) in files {
            let file = root.join(path);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, text).unwrap();
        }
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn lines(root: &Path) -> Vec<String> {
        let list = find_tests(root).into_iter().map(|(name, command)| format!("{name} | {command}")).collect();
        fs::remove_dir_all(root).unwrap();
        list
    }

    #[test]
    fn a_folder_without_tests_gives_nothing() {
        assert!(lines(&scratch("empty", &[("README.md", "# x"), ("package.json", r#"{"scripts":{"test":"echo \"Error: no test specified\" && exit 1","dev":"vite"}}"#)])).is_empty());
    }

    #[test]
    fn package_scripts_give_checks_and_scripts_that_do_not_end_stay_out() {
        let root = scratch(
            "node",
            &[
                ("package.json", r#"{"scripts":{"test":"vitest run","test:watch":"vitest","test:e2e":"playwright test","lint":"eslint .","lint:fix":"eslint --fix .","test;rm":"x","build":"vite build"},"devDependencies":{"vitest":"1","@playwright/test":"1","jest":"1"}}"#),
                ("web/package.json", r#"{"scripts":{"test":"jest"}}"#),
                ("web/pnpm-lock.yaml", ""),
                ("node_modules/x/package.json", r#"{"scripts":{"test":"x"}}"#),
            ],
        );
        assert_eq!(lines(&root), ["test | npm run test", "test:e2e | npm run test:e2e", "lint | npm run lint", "jest | npx jest", "web/test | pnpm --dir web run test"]);
    }

    #[test]
    fn node_tests_and_test_utilities_are_found() {
        let root = scratch(
            "utilities",
            &[
                ("tests/a.test.ts", "import { test } from \"node:test\";"),
                ("scripts/test-api.ps1", ""),
                ("scripts/e2e.mjs", ""),
                ("scripts/release.mjs", ""),
                ("scripts/test notes.py", ""),
            ],
        );
        assert_eq!(
            lines(&root),
            ["node tests | node --test \"tests/**/*.test.ts\"", "e2e.mjs | node scripts/e2e.mjs", "test-api.ps1 | powershell -ExecutionPolicy Bypass -File scripts/test-api.ps1"]
        );
    }

    #[test]
    fn the_tools_of_other_languages_are_found() {
        let root = scratch(
            "tools",
            &[
                ("Cargo.toml", "[workspace]\nmembers = [\"core\"]\n"),
                ("core/Cargo.toml", "[package]\n"),
                ("go.mod", "module x\n"),
                ("App.sln", ""),
                ("pom.xml", ""),
                ("build.gradle", ""),
                ("pyproject.toml", "[tool.pytest.ini_options]\n"),
                ("Makefile", "VAR:=1\nbuild:\n\tx\ntest: build\n\tx\ntest-watch:\n\tx\nlint:\n\tx\n"),
                ("api/Cargo.toml", ""),
                ("svc/tests/test_a.py", ""),
            ],
        );
        let found = lines(&root);
        for line in ["cargo tests | cargo test", "pytest | python -m pytest", "go tests | go test ./...", "dotnet tests | dotnet test", "maven tests | mvn test", "gradle tests | gradle test", "make test | make test", "make lint | make lint", "svc/python tests | python -m unittest discover -s svc/tests"] {
            assert!(found.iter().any(|known| known == line), "{line}: {found:?}");
        }
        // The workspace of the project folder covers the crates below it.
        assert!(!found.iter().any(|line| line.contains("--manifest-path")), "{found:?}");
        assert_eq!(found.len(), 9, "{found:?}");
    }

    #[test]
    fn a_crate_in_a_subfolder_names_its_manifest() {
        let root = scratch("crate", &[("src-tauri/Cargo.toml", "[package]\n")]);
        assert_eq!(lines(&root), ["src-tauri/cargo tests | cargo test --manifest-path src-tauri/Cargo.toml"]);
    }
}
