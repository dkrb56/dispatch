# Dispatch

Run [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) like a small team, from one window on Windows and macOS.

You type tasks into one chat, **triage**. Triage writes a brief for each task and starts a **worker** in the background. The worker reads the code and writes a plan; you approve it with one click, with the recommended decisions or your own. Then the worker does the work, with its own agents if it needs them, and reports back. Dispatch tells triage when a worker is done, blocked or failed.

You never sit in a terminal answering prompts: questions, permissions and plans come to you as buttons.

## What it does

- **Triage chat** as formatted text with a message box: images by paste, questions and permission prompts as coloured buttons, commands in code blocks with a ▶ that runs them in a terminal of the project.
- **Tickets** for each project: each message that you type into triage becomes a ticket on a board with the columns New, Todo, In progress, Done and Canceled. Dispatch sends the Todo tickets to triage in their order, and a ticket follows its task to Done; a question to triage goes at once. The file is `.dispatch/tickets.jsonl`.
- **Tasks** for each project: the plan run and the work run of each task, its plan and its report. A plan waits for **Approve all**, **Decisions** (each decision with its options, or your own words) or **Reject**.
- **Focus mode**: one column per project, side by side, each with its triage chat and its tasks.
- **Map**: each project as a graph of you, triage, its tasks, their runs and agents; what waits for you is orange. A click on a run opens the **worker view**: its agents, their last tool calls and messages, tokens, files changed and a timeline, read live from the session files.
- **Nightmode**: work goes on while you are away; each decision takes its recommended option, and you get a list of every default in the morning; each PC that does the work stays awake.
- **Hosts**: one window shows and controls the projects of one or more other computers over Tailscale, each project with the name of its computer.
- **Setup pipeline**: prepares a project in one click (see below). **Rules** shows every rule that Claude Code gets in the project. Both stand among the buttons of each project: in its group in the top bar in **Details**, and in the head of its column in Focus, next to the old sessions of that project and a folder button that opens its workspace.
- Terminal tabs and split panes, a side panel per terminal (git state, session, context use, outputs), and a chat list of all your Claude Code chats.

## Requirements

- Windows 10 or 11, or macOS 11 or newer (Apple silicon or Intel). The Mac build is new: GitHub builds it, and it was not yet run on a Mac by the project. On a Mac the worker pipeline (Setup pipeline and the tasks) does not run yet; the terminals, chats, side panel and update check do.
- [Claude Code](https://docs.claude.com/en/docs/claude-code/setup) on the `PATH` as `claude`, with a login. Dispatch was built against Claude Code 2.1.x: it uses `claude agents`, background sessions and the session files in `%USERPROFILE%\.claude\projects`.
- Git, for the projects.
- Optional, to work on another computer: [Tailscale](https://tailscale.com) on both computers.

## Install

Download `Dispatch_<version>_x64-setup.exe` from [Releases](https://github.com/dkrb56/dispatch/releases) and run it. It installs for the current user.

The installer is not signed. Windows SmartScreen shows "Windows protected your PC"; click **More info** → **Run anyway**.

On a Mac, download `Dispatch_<version>_universal.dmg`, open it and drag Dispatch to Applications. The app is not signed, so macOS says that it is damaged. Run this once in Terminal before the first start:

```bash
xattr -cr /Applications/Dispatch.app
```

Dispatch looks for a new release once an hour (**?** → **Check for update** checks now) and offers **Update to …** in the top bar. **?** → **What's new** lists what each version brought, and the list opens once by itself after an update.

## First steps

1. Click **+** in the projects group of the top bar and select your project folder. The Setup pipeline window opens for a project that is not set up.
2. Read the steps, click **Apply**, then **Close**. Commit the change to `CLAUDE.md`.
3. The workspace opens: triage on the left, the agent view of the workers on the right.
4. Give triage a task in its chat. Approve the plan when it is ready.

**?** in the top bar has the full help.

## Work on another computer

Options → **Where the work runs** has three modes. **This PC does the work** is the default: everything runs in this window, and nothing listens on the network. **Use hosts**: one or more computers run `dispatch-host`, and this window shows and controls them over Tailscale. **This PC and hosts**: this window does the work of this computer itself and shows and controls the hosts of the list too.

1. On the computer that does the work: Options → **Run the host on this PC** → **Start the host**. The Key box shows its key. That window switches to **Use hosts** with the row `127.0.0.1`.
2. On the other computer: Options → **Use hosts** → **Add host**. Fill in a name, the Tailscale name or `100.x` address, the port (empty is 7470) and the key. The key is also in `host-key.txt` in the data folder of the host.
3. Start Dispatch again; a change of the host list counts at the next start. **+** then opens a folder chooser with the folders of a host.

With several hosts, each project name gets ` · <host name>` after it, so two projects with the same folder name stay apart. Each host keeps its own Nightmode switch; the one switch in the top bar shows a third look when the hosts differ. A host that is not reachable gets its own row in a bar below the top bar, and the other hosts keep working. Use **This PC and hosts** to work on this computer and see the projects of your other computers in the same window; no host program runs on this computer then. **?** → **Where the work runs** has the details.

## What Setup pipeline changes

All in the open, each step listed before you apply it:

- the folder `.dispatch` inside the project, with the briefs, plans, reports, the state of each task, the tickets file and the worker script `worker.ps1`; git tracks it, Dispatch commits its files itself, and Apply moves the files of an older `<project>-reports` folder there;
- allow and deny rules, and two read folders, in `.claude/settings.local.json` of the project;
- worktree isolation off, so workers edit the project itself;
- optional, off by default: "Measure before the plan" lets the plan run run listed commands first, and "Task branches" gives each task its own branch `task/<task>`, which Dispatch merges on your click after a gate command passed (no push);
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

The installer lands in `src-tauri/target/release/bundle/nsis/`; on a Mac, `npm run tauri build -- --bundles dmg` puts the disk image in `src-tauri/target/release/bundle/dmg/`. A tag `v<version>` makes GitHub Actions build both and attach them to the release (`.github/workflows/release.yml`). Run the Rust tests with `cargo test --lib` in `src-tauri`.

## Privacy

Dispatch runs on your computer. It reads the session files of Claude Code in `%USERPROFILE%\.claude` to show chats, workers and context, and it writes only the files that you apply in Setup pipeline and its own state in `%APPDATA%\com.dkrb56.dispatch`. Dispatch itself sends nothing anywhere (Claude Code talks to Anthropic as usual); its only request to the internet is the update check to the GitHub releases of this repository.

In the modes **Use hosts** and **This PC and hosts** the window and each of its hosts talk over your tailnet only, and Tailscale encrypts the traffic. At the start of each connection the window sends the key, the versions and the id of the window; then keystrokes, terminal output, chat texts, task files, the files that the window shows and pasted images travel between them. The host never listens on all addresses: only on the Tailscale address of its computer and on `127.0.0.1`. The window itself listens on nothing in any mode; a computer listens only when you start the host there. It writes `host-key.txt`, `host.json`, `host.log` and `shared.json` into its data folder. The window keeps the keys of its hosts in its own `state.json`. Nothing goes to any other place.

Dispatch is an independent project. It is not made or endorsed by Anthropic.

## License

[Apache License 2.0](LICENSE)
