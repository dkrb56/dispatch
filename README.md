# Dispatch

Run [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) like a small team, from one window on Windows.

You type tasks into one chat, **triage**. Triage writes a brief for each task and starts a **worker** in the background. The worker reads the code and writes a plan; you approve it with one click, with the recommended decisions or your own. Then the worker does the work, with its own agents if it needs them, and reports back. Dispatch tells triage when a worker is done, blocked or failed.

You never sit in a terminal answering prompts: questions, permissions and plans come to you as buttons.

## What it does

- **Triage chat** as formatted text with a message box: images by paste, questions and permission prompts as coloured buttons, commands in code blocks with a ▶ that runs them in a terminal of the project.
- **Tasks** for each project: the plan run and the work run of each task, its plan and its report. A plan waits for **Approve all**, **Decisions** (each decision with its options, or your own words) or **Reject**.
- **Focus mode**: one column per project, side by side, each with its triage chat and its tasks.
- **Map**: each project as a graph of you, triage, its tasks, their runs and agents; what waits for you is orange. A click on a run opens the **worker view**: its agents, their last tool calls and messages, tokens, files changed and a timeline, read live from the session files.
- **Nightmode**: work goes on while you are away; each decision takes its recommended option, and you get a list of every default in the morning.
- **Setup pipeline**: prepares a project in one click (see below). **Rules** shows every rule that Claude Code gets in the project.
- Terminal tabs and split panes, a side panel per terminal (git state, session, context use, outputs), and a chat list of all your Claude Code chats.

## Requirements

- Windows 10 or 11.
- [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) on the `PATH` as `claude`, with a login. Dispatch was built against Claude Code 2.1.x: it uses `claude agents`, background sessions and the session files in `%USERPROFILE%\.claude\projects`.
- Git, for the projects.

## Install

Download `Dispatch_<version>_x64-setup.exe` from [Releases](https://github.com/dkrb56/dispatch/releases) and run it. It installs for the current user.

The installer is not signed. Windows SmartScreen shows "Windows protected your PC"; click **More info** → **Run anyway**.

Dispatch looks for a new release once an hour (**?** → **Check for update** checks now) and offers **Update to …** in the top bar.

## First steps

1. Click **Project** in the top bar and select your project folder. The Setup pipeline window opens for a project that is not set up.
2. Read the steps, click **Apply**, then **Close**. Commit the change to `CLAUDE.md`.
3. The workspace opens: triage on the left, the agent view of the workers on the right.
4. Give triage a task in its chat. Approve the plan when it is ready.

**?** in the top bar has the full help.

## What Setup pipeline changes

All in the open, each step listed before you apply it:

- the folder `.dispatch` inside the project, with the briefs, plans, reports, the state of each task and the worker script `worker.ps1`; git tracks it, Dispatch commits its files itself, and Apply moves the files of an older `<project>-reports` folder there;
- allow and deny rules, and two read folders, in `.claude/settings.local.json` of the project;
- worktree isolation off, so workers edit the project itself;
- a "Background workers" section and optional working rules in `CLAUDE.md`;
- the triage role in `.claude/triage.md`.

## Build from source

You need Node.js 20 or newer and Rust (stable, via [rustup](https://rustup.rs)).

```bash
npm install
npm run tauri dev
```

```bash
npm run tauri build
```

The installer lands in `src-tauri/target/release/bundle/nsis/`. Run the Rust tests with `cargo test --lib` in `src-tauri`.

## Privacy

Dispatch runs on your computer. It reads the session files of Claude Code in `%USERPROFILE%\.claude` to show chats, workers and context, and it writes only the files that you apply in Setup pipeline and its own state in `%APPDATA%\com.dkrb56.dispatch`. Dispatch itself sends nothing anywhere (Claude Code talks to Anthropic as usual); its only network request of its own is the update check to the GitHub releases of this repository.

Dispatch is an independent project. It is not made or endorsed by Anthropic.

## License

[Apache License 2.0](LICENSE)
