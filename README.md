# Dispatch

Run [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) like a small team, from one window on Windows and macOS.

You type tasks into one chat, **triage**. Triage writes a brief for each task and starts a **worker** in the background. The worker reads the code and writes a plan; you approve it with one click, with the recommended decisions or your own. Then the worker does the work, with its own agents if it needs them, and reports back. Dispatch tells triage when a worker is done, blocked or failed.

You never sit in a terminal answering prompts: questions, permissions and plans come to you as buttons.

## What it does

- **Triage chat** as formatted text with a message box: images by paste, questions and permission prompts as coloured buttons, commands in code blocks with a ▶ that runs them in a terminal of the project.
- **Tickets** for each project: each message that you type into triage, a question too, becomes a ticket on a board with the columns Scheduled, Planning, Waiting for answer, Working, Done and Canceled. A ticket whose task asks you something stands in Waiting for answer until you answer. Dispatch sends the Scheduled tickets to triage by itself, one by one in their order, unless the project is paused, or, with the switch "Tickets start their plan", writes the brief of a task ticket and starts its plan run itself (a question still goes to triage), or, with the switch "No triage", starts the plan run of every Scheduled ticket itself and tells you only through the task cards and the alerts, and a ticket follows its task to Done; a command of Claude Code (`/clear`) goes at once. A yellow ! at a project says that its tickets wait and do not go. The button "+ Ticket" next to Tickets, and on each Overview card, opens the window New ticket without the board: it names the project and has the Goal box, the level, the type and the optional boxes Why, Done when, Do not change and Context (a fix also has What I see and What I expect), and Ctrl+V pastes an image into it; Add puts the ticket at the end of Scheduled, a filled box goes into the brief or the message to triage, and New ticket on the board opens the same window, and a right-click on the board offers a new ticket in Scheduled or in Backlog. ✎ on a Backlog or Scheduled ticket opens it in the same window to change it, and a click on the title of a Done or Canceled ticket shows its details with its brief, plan, report and log. Each ticket has a level for its plan run: Simple (Opus, effort medium), Medium (Opus, effort high, the default) or Hard (Fable, effort high). A plan can list parts that follow it: Approve puts one linked ticket per part in Backlog, and you can edit, add, remove and reorder them there. The file is `.dispatch/tickets.jsonl`.
- **Tasks** for each project: the plan run and the work run of each task, its plan and its report. A plan waits for **Approve all**, **Decisions** (each decision with its options, or your own words) or **Reject**. The plan advises the model and the effort of the work run; the card shows the advice at Approve, and you can change it. The model lists above Workers count for a task without a ticket level or advice. The parts of a plan run as a chain: each starts its plan when the part before it is done, the parent counts them and goes to Done after the last, and a failed or stopped part stops the chain. The card lists the commands of the work run with their exit codes and last lines, and a done report shows as not verified only when the work run ran no command or a check that you ticked did not run.
- **Focus mode**: one column per project, side by side, each with its triage chat and its tasks; a button in the bar stacks the projects one above the other.
- **Map**: each project as a graph of you, triage, its tasks, their runs and agents; what waits for you is orange. A click on a run opens the **worker view**: its agents, their last tool calls and messages, tokens, files changed and a timeline, read live from the session files.
- **Plan**: the tickets of one project as a tree on a dotted canvas. An arrow from A to B means that B starts when A is done; a ticket stands in the row of its longest chain of arrows. Each card shows its state, and a badge says "Next up" when every ticket before it is done, or "Started early" when work began before that. A side panel lists these tickets and the open tickets without arrows. The arrows stay in the tickets file; "Plan the flow" changes them in a draft, and Confirm saves them and sorts the queue of Scheduled by them without changing any column. You select cards and arrows by click, Shift-click, Ctrl-click or a box, and wrap tickets in comments (open boxes) or groups (one stacked card that collapses and expands), saved per project in `.dispatch/plan-groups.json`.
- **Nightmode**: a Night button per project; work goes on in that project while you are away; each decision takes its recommended option, and you get a list of every default in the morning; a PC stays awake while one of its projects has night mode on.
- **Hosts**: one window shows and controls the projects of one or more other computers over Tailscale, each project with the name of its computer.
- **Setup pipeline**: prepares a project in one click (see below). **Rules** shows every rule that Claude Code gets in the project. Both stand among the buttons of each project in the head of its column in Focus, next to the old sessions of that project and a folder button that opens its workspace.
- A side panel per terminal (git state, session, context use, outputs) behind the Details switch of a column, and the chats of each project in its column, with a search box.

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

Options is the wrench at the right of the top bar. Options and Setup pipeline show their sections in a list at the left, one section at a time.

Options → **Where the work runs** has three modes. **This PC does the work** is the default: everything runs in this window, and nothing listens on the network. **Use hosts**: one or more computers run `dispatch-host`, and this window shows and controls them over Tailscale. **This PC and hosts**: this window does the work of this computer itself and shows and controls the hosts of the list too.

1. On the computer that does the work: Options → **Run the host on this PC** → **Start the host**. The Key box shows its key. That window switches to **Use hosts** with the row `127.0.0.1`.
2. On the other computer: Options → **Use hosts** → **Add host**. Fill in a name, the Tailscale name or `100.x` address, the port (empty is 7470) and the key. The key is also in `host-key.txt` in the data folder of the host.
3. Start Dispatch again; a change of the host list counts at the next start. **+** then opens a folder chooser with the folders of a host.

With several hosts, each project name gets ` · <host name>` after it, so two projects with the same folder name stay apart. Each project keeps its own night mode on the computer that does its work; a click changes only that project. A host that is not reachable gets its own row in a bar below the top bar, and the other hosts keep working. Use **This PC and hosts** to work on this computer and see the projects of your other computers in the same window; no host program runs on this computer then. **?** → **Where the work runs** has the details.

### On your phone

The host also serves a small page with only the Overview: one column of project cards with the tasks in work, the newest finished tasks and the tickets. The button **New ticket** at the bottom of the page opens the New ticket screen: pick a project, write what should be done and tap **Add ticket**; the card of the project then says that the ticket is in Scheduled. Tap the name of a card to fold it to one line, and tap again to open it. The button **Projects** lists all projects; untick one to hide its card.

The switch **Cards | Board** at the top picks the view, and the phone opens on your last choice. **Board** shows the tickets of each project in the seven columns of the tickets board. Tap a column name to open or close it, for every project at once; Waiting for answer and Working are open at first. A ticket in progress shows what its task does now. A task that waits for you shows a button: **Answer** for a question, **Confirm** for a check result, **Review plan** for a ready plan. The button opens a full screen with **Back** at the top and the buttons at the bottom. On the question screen tap an option and **Send**, or write your own reply; a check result waits for **Confirm**. The plan screen shows the plan: its short summary and plain-words lines, each decision with its options and a box for your own answer, the checks, and the model and the effort of the work run. Tap **Approve**, or tap **Reject** and write why; the planner then writes a new plan. While another work run runs, the approval waits, and the computer starts the work run when the project is free. **Cancel approval** in the row of the task takes it back, on the phone or on the computer. The Cards view shows the same buttons and the same screens. An answer from the phone writes no line into the triage chat. The phone keeps these choices on the phone only: the icon on the Home Screen and the browser each keep their own.

The button **Terminal** on each card opens the Terminal of the project as a full screen with **Back** at the top: the same Claude Code session as the Terminal switch on the computer. When no terminal runs, tap **Start terminal**; the computer then shows the same session. The terminal keeps the width of the computer, so you scroll sideways. Type in the box at the bottom and tap **Send**, or tap the keys Enter, Esc, Tab, the arrows and Ctrl+C. Anyone with the phone code can type commands into that terminal; **New phone key** ends that.

1. Install Tailscale on the phone and sign in to the same tailnet as the computer.
2. On the computer: Options → **Phone** → **Start and show the code**. Dispatch restarts, the terminals of this window end, and the code shows.
3. Scan the code with the phone camera. The address and the key come with the code, so you type nothing.
4. On an iPhone in Safari tap Share, then **Add to Home Screen**. On Android in Chrome tap the menu ⋮, then **Add to Home screen**. The icon keeps the key and opens the page full screen.

The phone shows the projects of this computer that are open in a connected Dispatch window, also a window on another computer. A project of another host never shows. A project leaves the phone when its last window closes or disconnects, or after about 3 minutes without contact.

The computer and the host must be on. The phone gives no alerts. An approval from the phone starts its work run only while a Dispatch window runs. A ticket from the phone starts only while a Dispatch window runs. **New phone key** ends the access of the old code and of the old icon; the host and its terminals keep running. Scan the new code and add the page to the Home Screen again.

## What Setup pipeline changes

All in the open, each step listed before you apply it:

- the folder `.dispatch` inside the project, with the briefs, plans, reports, the state of each task, the tickets file, the worker script `worker.ps1` and in `logs` the log of each task (the plan, each command of the worker with its output, and the report); git tracks it and Dispatch commits its files itself, unless "Task files local only" is on, and Apply moves the files of an older `<project>-reports` folder there;
- allow and deny rules, and two read folders, in `.claude/settings.local.json` of the project;
- worktree isolation off, so workers edit the project itself;
- optional, off by default: "Measure before the plan" lets the plan run run listed commands first, and "Task branches" gives each task its own branch `task/<task>`, which Dispatch merges on your click, or by itself in night mode, after a gate command passed (no push), and "Task files local only" puts `.dispatch/` into the root `.gitignore`, so tickets and task files stay on your computer and a clone has none, and "Start plans without decisions" starts a plan that asks you nothing without your click, and "Checks at the gate" runs your chosen checks once, in the gate command at the merge, not in the work run, and "Pick the checks after the work run" lets an agent pick the checks from the change when the worker is done, with one reason each on the task card, where you add or remove checks before they run (in the checkout, or at the merge with Task branches), and "Push after the merge" makes Merge push the base to its upstream branch, never with force, and "Auto-merge finished tasks" merges a task with a done report without your click, after the gate command passed, and "Tickets start their plan" starts the plan run of a Scheduled ticket without triage, with the ticket text as the brief;
- on by default: "No triage" runs the project without a triage chat: every Scheduled ticket starts its plan, and the task cards and the alerts tell you, and in Focus mode the tickets board of the project stands where triage would stand, with the button Open terminal above it; turn it off for a triage chat;
- the checks of the project in `.dispatch/checks.txt` (tests, suites, gates, each a name and a command, and `| covers: …` with what the check tests, for the picker): Dispatch finds the tests in the project files and Apply saves them; a ready plan shows them as checkboxes on the task card, the recommended ones ticked, and the worker runs the ones you keep; with "Pick the checks after the work run" the files of `.dispatch/checks-all.txt` name the changes that run every check; "Full run of all checks" runs every check each night at a set time or after a number of finished tasks, keeps the last run in `.dispatch/checks/full/` (on this computer only), shows it in Setup pipeline, and opens one fix ticket per failed check;
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

In the modes **Use hosts** and **This PC and hosts** the window and each of its hosts talk over your tailnet only, and Tailscale encrypts the traffic. At the start of each connection the window sends the key, the versions and the id of the window; then keystrokes, terminal output, chat texts, task files, the files that the window shows and pasted images travel between them. The host never listens on all addresses: only on the Tailscale address of its computer and on `127.0.0.1`. The window itself listens on nothing in any mode; a computer listens only when you start the host there. It writes `host-key.txt`, `phone-key.txt`, `host.json`, `host.log`, `shared.json` and `workspaces.json` (the projects that each window has open) into its data folder. The window keeps the keys of its hosts in its own `state.json`. Nothing goes to any other place.

The host also answers plain web requests on its port with the phone page, on the same two addresses. The page holds no data of yours. With the phone key the page may read the list of open projects, their tasks and tickets and the list of workers, add a ticket, send a reply to a task, approve or reject a ready plan, and show and type into the Terminal of an open project. The host checks each request for tasks, a new ticket, a reply, an approval or a rejection: the key reaches only the projects on the phone list. Through the Terminal of a project that key can run commands on the computer. It opens no other terminal and no file, and it cannot start or stop a work run: an approval from the phone only writes your choices into the plan, and a Dispatch window starts the work run. The key travels in the part of the link after `#`, and the phone keeps it on the phone.

Dispatch is an independent project. It is not made or endorsed by Anthropic.

## License

[Apache License 2.0](LICENSE)
