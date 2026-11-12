# Dispatch on a laptop, work on the desktop PC

Design for ticket `remote-client`, written 2026-11-11. No code changes come with this file. Each task in "Tasks that follow" gets its own brief and plan.

The section "Several hosts" (2026-11-12, ticket `remote-multi-host`) extends the design: one window now connects to several hosts. Since then the mode "Use a host" is named "Use hosts". The section "This PC and hosts" (2026-11-12, ticket `remote-mixed-mode`) adds a third mode: the window does the work of this PC and uses hosts at the same time. The other sections keep the original design with one host.

## The problem and the result

The user wants to use Dispatch on a laptop, but the work must run on the desktop PC: the Claude Code sessions, the terminals, git and the project files. Today Dispatch does everything in one window on one PC, so the laptop can only show its own files. The result: a small host program on the desktop does the work, and the Dispatch window on the laptop (or on the desktop) connects to it over Tailscale and shows and controls it.

## How Dispatch works today

- Dispatch is one program (Tauri). The page (TypeScript in `src/`) draws the window. The backend (Rust in `src-tauri/src/`) does the work.
- The page calls the backend with `invoke`. The backend has 46 commands, all listed in `generate_handler` in `src-tauri/src/lib.rs`.
- The backend sends two events to the page: `pty-output` (new text of a terminal) and `pty-exit` (a terminal ended).
- The terminals are pseudo consoles that `portable-pty` opens inside the same program. A terminal ends when the program ends (`close_terminals`).
- The page uses four plugins: the file dialog, the system notification, the opener for links, and the window-state plugin for the window size.
- The backend reads and writes the files of the PC it runs on: the project folders, `~/.claude` (sessions, transcripts, agents), and its own data folder (`state.json`, the terminal screens, pasted images, `rules-off.json`).
- The backend runs programs on the PC it runs on: `claude`, `git`, `gh`, `curl`, PowerShell and the worker script `worker.ps1`.

Thus the split is clean at one line: everything that `invoke` reaches can run on another PC, and everything that the page does itself stays with the window.

## The split

The work moves into a new headless program, the **host** (working name `dispatch-host`). It has no window. It runs on the desktop and keeps running when every window is closed (user decision 1). The Dispatch app becomes a **window** that talks to a host, or, in the default mode, does the work itself as today.

### What runs on the host (the desktop)

| Group | Commands and streams | Note |
|---|---|---|
| Terminals | `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`, the events `pty-output` and `pty-exit` | Each terminal belongs to the window that opened it (see "The mode switch and the lifetime"). |
| Side panel and files | `pane_info`, `context_usage`, `pane_busy`, `file_stat`, `file_read`, `night_morning`, `night_state`, `image_save` | `file_read` answers with raw bytes, up to 50 MB. `image_save` takes the raw image as the body of the call and saves it in the host's `pasted` folder. |
| Chats and workers | `chat_list`, `chat_view`, `session_flow`, `worker_list` | `chat_list` names the pane in which a chat runs; the host gives only the panes of the calling window. |
| Tasks and pipeline | `pipeline_plan`, `pipeline_apply`, `pipeline_commit`, `set_project_options`, `task_list`, `backlog_add`, `backlog_remove`, `backlog_reorder`, `task_approve`, `task_decide`, `task_reject`, `task_reply`, `task_stop`, `triage_handoff`, `project_root`, `worker_flags`, `set_worker_flags` | The worker script, git and PowerShell run on the desktop, as today. |
| Rules | `project_rules`, `set_rule`, `update_rule`, `check_rules` | `rules-off.json` lives in the host's data folder. |
| Status bar | `status_info`, `usage_info` | The bar shows the Claude account and usage of the desktop. |
| Shared window state | the triage chat of each project and the Nightmode switch (today the fields `triage` and `night` of `state.json`) | User decision 3: both windows continue the same triage chat. |
| New | `dir_list` | Lists the folders of a desktop folder for the folder chooser (user decision 4). |

### What stays with the window (the laptop)

| Part | Note |
|---|---|
| The page, xterm.js, the chat view, the file viewer, the Options screen | Unchanged. |
| The layout of tabs and panes and the saved terminal screens (`state_load`, `state_save`, `screen_save`, `screen_load`, without the two shared fields) | User decision 3: each window keeps its own panes. |
| The record of the menu reads of the chat view (`menu_record_save`, folder `menu-reads`) | Ticket menu-read-recorder: the screen is in the xterm.js of the window. |
| localStorage: theme, text size, triage view, alert switches, view mode, focus projects, chat scope, side panel | Per window, as today. |
| The notification, the chime, the taskbar blink, the window title | They reach the person at that window. |
| The window-state plugin, the opener for `http` and `mailto` links | Unchanged. |
| The update check and install (`update_check`, `update_install`, `update_installer_open`) | Each PC updates its own Dispatch. |
| The clipboard | A pasted image travels to the host as bytes; pasted text travels as terminal input. |

## The transport

User decision 5: one WebSocket connection per window.

- **Calls.** A text frame carries JSON: a call id, the command name, and the arguments exactly as the page gives them to `invoke` today. The answer carries the same id and either the value or the error text. Thus the page code that calls a command does not change.
- **Events.** A text frame carries the event name and its payload, for `pty-output` and `pty-exit`.
- **Bytes.** A binary frame carries the image of `image_save` (window to host) and the bytes of `file_read` (host to window). A short header in the frame names the call id.
- **Hello.** The first message of a window carries the protocol version, the app version, the window id and the pairing key. The host answers with its own versions. A different protocol version ends the connection with a clear text, which the window shows.
- **Order.** The host keeps the order of the output of one terminal. Calls can answer out of order, as `invoke` can today.

## Finding the desktop and trusting the caller

- **Address.** The user types the desktop's MagicDNS name (`<pc>.<tailnet>.ts.net`) or its `100.x` address into the window, with a port. The port has one fixed default and can be changed.
- **Binding.** The host listens only on the desktop's Tailscale address, which it finds through `tailscale ip -4`, or else as the network interface in `100.64.0.0/10`. It never listens on all addresses (`0.0.0.0`). The desktop window reaches the same host through `127.0.0.1`; see "Open points" for this second address.
- **Pairing key.** User decision 2. The host makes a random key at its first start, stores it in its data folder, and the desktop window shows it in Options. The laptop window gets the key once and sends it in the hello. The window stores the key in its data folder, not in localStorage, because a forced end of the app loses localStorage writes. The host refuses every call before a valid hello. A "new key" button makes a new key and ends every connection that used the old one.
- **Encryption.** WireGuard already encrypts all traffic on the tailnet, so the WebSocket needs no TLS of its own.
- **Firewall.** Windows Defender Firewall asks once at the host's first listen on a network address. The user allows it for private networks.
- **Not chosen now.** The Tailscale identity through `tailscale whois` needs the Tailscale command on the desktop and a code path per system. Tailscale Serve with HTTPS and the login header needs another running configuration. Either can come later as a second check next to the key.

## The mode switch and the lifetime

The same app runs in one of two modes, chosen in Options.

| Mode | What happens |
|---|---|
| **This PC does the work** (default) | Exactly today's behaviour. The backend runs inside the app, no host starts, nothing listens on the network. |
| **Use hosts** (first "Use a host") | The window takes a list of hosts, each with a name, an address, a port and a key. It opens one WebSocket per host and sends every host call over the connection of the host that owns the pane, the project or the chat. The title bar shows the names of the hosts. |

On the desktop, Options also has **Run the host on this PC**. It starts the host, offers to start it at each Windows sign-in, shows the address and the key, and switches this window to "Use a host" with `127.0.0.1`. Thus the desktop window and the laptop window are two equal windows of one host.

Lifetime rules:

- **A terminal belongs to the window that opened it.** The host keeps the terminals of a window when that window disconnects or closes. While nobody watches, the host keeps the last 256 KB of output of each terminal. When the window connects again with the same window id, it gets that output and the terminals that are still alive, and it does not start them again. Today a start under a known terminal id ends the old shell (the check of a replaced shell in `pty_spawn`); in host mode a reconnect attaches instead.
- **A terminal that ended while nobody watched** is reported at the reconnect, as a `pty-exit`.
- **The two windows never share a pane.** Each window has its own window id, pane ids and layout. They share the projects, the chats, the tasks and the workers through the files on the desktop and the shared window state.
- **The host ends its terminals only when it stops**, as the app does today at its exit. Closing a window no longer ends the terminals of that window; closing a tab still does (`pty_kill`).
- **Workers do not depend on any of this.** They are background sessions of Claude Code, so they keep running whether the host or a window runs.

### One window drives the automatic actions

Some actions run in the page today, on a timer: the lines that Dispatch writes into the triage chat (`tellTriage` and `flushTriageQueue`), auto-approve of plans (`approvePlans`), and the sending of planned backlog entries (`dispatchEntries`). With two windows open, both would do them: each line would reach triage twice, and a plan could be approved twice. The host therefore gives a **driver** lease to one window at a time: the window that the user used last. Only the driver runs these actions. The other window shows the same state and runs them only when it gets the lease. The alerts (notification, chime, blink) are not part of the lease: each window alerts the person who sits at it.

## What changes for the user in client mode

| Thing | In "Use a host" mode |
|---|---|
| Paste an image | Works. The image goes from the laptop clipboard to a file in the host's `pasted` folder, and Claude Code gets that path. |
| Paste text, type, keys | Work as today. Each keystroke makes one round trip on the tailnet, so a slow network shows as typing lag. |
| Project button and focus mode folder | The native folder dialog would show the laptop's folders. A folder chooser inside the page lists the desktop's folders through `dir_list` instead. A text box for a path is in the same chooser. Local mode keeps the native dialog. |
| Links | `http` and `mailto` links open in the laptop's browser. A file link opens the viewer with the desktop's file. A file cannot open in a desktop program from the laptop. |
| Update | The laptop's Dispatch checks and installs its own update. The hello compares versions, and the status bar warns when the window and the host differ. On the desktop, an update first stops the host, because the installer cannot replace a running program, and starts it again after. |
| Notifications, chime, blink | On the laptop, for the tasks of the desktop. |
| Status bar | The Claude account and the weekly usage of the desktop. |
| Rules check, the ▶ button of a command, Setup pipeline | Run on the desktop. |
| Lost connection | A bar says that the host is not reachable, and the window tries again. Typing goes nowhere until it is back; nothing on the desktop stops. |
| Not available | The laptop cannot start the host; somebody starts it on the desktop, or it starts at sign-in. Two windows cannot show the same terminal. |

## Tasks that follow

In this order. Each task keeps the single-PC mode unchanged in behaviour. The first task that gives something to test by hand is task 3, `remote-host`.

1. **Task 1: `remote-backend-shim`.** Scope: one page module `src/backend.ts` with a call function and an event function; every `invoke` and `listen` in `src/` goes through it. Local mode only, no change of behaviour. Proof: `tsc`, the test files, a search that shows `@tauri-apps/api/core` and `@tauri-apps/api/event` imported only in that module, and a run of the app that opens a terminal and the triage chat view as before.
2. **Task 2: `remote-core-split`.** Scope: the bodies of the 46 commands move into a core that does not need a Tauri window. The core holds the state (terminals, transcripts, git cache, chat cache), the data folder and the home folder, and sends events through one event sink. The Tauri commands become thin wrappers. Proof: `cargo test --lib`, `cargo check` for Windows, and the app runs as before.
3. **Task 3: `remote-host`.** Scope: the headless program `dispatch-host`, a second program of the same crate on the same core. It has the WebSocket service, the binding, the hello with the pairing key, calls, events, binary frames, terminal ownership by window id, the 256 KB replay buffer, the attach at reconnect, and `dir_list`. It is started by hand in this task. Proof: a Node script in a scratch folder connects with the key, calls `chat_list`, starts a terminal, sees `pty-output`, disconnects, connects again with the same window id, and the shell still answers; a call with a wrong key is refused.
4. **Task 4: `remote-client-mode`.** Scope: Options gets the two modes; `src/backend.ts` gets the WebSocket transport and the table of the calls that stay local; the host address, port and key live in the window's data folder; the title shows the host; a lost connection shows the bar and reconnects. Proof: a test copy of the app (own identifier) in "Use a host" mode shows the chats and a live terminal of a host on the same PC; the same with the host on the second PC, when the user has one at hand.
5. **Task 5: `remote-host-install`.** Scope: the installer ships the host next to the app; Options gets "Run the host on this PC" with start, stop, the key, the address and "start at sign-in"; one host per user at a time; the update stops and restarts the host. Proof: install of a test build with its own identifier, host start from Options, a reconnect after a window restart, and an update of the test build with the host running.
6. **Task 6: `remote-folder-chooser`.** Scope: the folder chooser inside the page for "Use a host" mode, on `dir_list`; local mode keeps the native dialog. Proof: the Project button and focus mode select a desktop folder from a window in "Use a host" mode.
7. **Task 7: `remote-shared-state`.** Scope: the triage chat of each project and the Nightmode switch move from the window's `state.json` to a file of the host; the driver lease for the automatic actions. Proof: a second window opens the workspace of a project and continues the first window's triage chat; with two windows open, one worker change gives one line in the triage chat, not two.
8. **Task 8: `remote-help-and-readme`.** Scope: the Help window, the README and the Options texts describe both modes, the setup of the host and Tailscale; the Privacy section of the README says what travels between the PCs (only on the tailnet). Proof: reading. This task ran as task 10, `remote-multi-host-help`, after task 9.
9. **Task 9: `remote-multi-host`** (done 2026-11-12, commit `3b36a73`). Scope: one window connects to several hosts; see "Several hosts". Proof: a test copy against two hosts on one PC.
10. **Task 10: `remote-multi-host-help`.** Scope: the texts of task 8 for both modes and several hosts, and the section "Several hosts" of this file. Proof: reading, with a table of the code line behind each statement.
11. **Task 11: `remote-mixed-mode`.** Scope: the third mode "This PC and hosts"; see "This PC and hosts". Proof: a test copy in that mode against one host on the same PC.

## Several hosts

Ticket `remote-multi-host`, 2026-11-12. One window connects to several hosts at once and shows the projects of all of them. The host program and its protocol did not change: a host of version 0.1.52 serves the new window.

- **The host list.** Options has the mode "Use hosts" with one row per host: Name, Address, Port, Key and Remove, and the button "Add host". Each entry has a UUID that the window makes when the user adds it; the id survives a rename and a new address. A change counts at the next start of Dispatch. "Run the host on this PC" adds or updates the row `127.0.0.1`; Stop removes it, and an empty list goes back to "This PC does the work".
- **The modes stay two** (decision 8): "This PC does the work" or "Use hosts" with one or more hosts. A window does not do work itself and use hosts at the same time. Ticket `remote-mixed-mode` changed this decision on the user's request: see "This PC and hosts".
- **The transport.** One WebSocket per entry with an address and a key, each with its own retries (1 s doubled up to 10 s), its own refusal and its own first try. Every hello carries the one window id of this window. The window-only calls stay with the window, as before.
- **Keys.** The key of a project is `<host id>|<path key>` in the mode "Use hosts" and the plain path key in the mode "This PC does the work". Each saved pane and each focus project carries its host; a saved value without a host belongs to the first host of the list.
- **Names.** With more than one host each project name gets ` · <host name>` after it: the pills, the Focus columns, the Map, the Overview cards, the chat groups and the tab labels. With one host nothing changes. The title is "Dispatch · host <name>" or "Dispatch · hosts <name>, <name>".
- **Lists without a project.** `chat_list` and `worker_list` are read from every host and merged, each item with its host. A host whose read fails keeps its last list.
- **Shared state per host.** Each host keeps its own `shared.json`: the Nightmode switch and the triage chat of each of its projects. The driver lease is a lease of one host, so a window can drive one host and not another.
- **The Nightmode switch.** One switch in the top bar: on when every host is on, off when every host is off, and a third look (`aria-checked="mixed"`, the knob in the middle) when they differ; the tooltip names the hosts that are on and off. A click on on turns every host off; a click on off or on the third look turns every host on. A host that is not reachable keeps its switch and is left out of the look.
- **A host that is gone.** The bar below the top bar has one row per host that is not reachable or refused the window, with its name, address and port; a refused row has Try again. The panes and projects of the other hosts keep working.
- **The status bar** follows the focused terminal: it shows the account, the usage and the versions of that terminal's host, with the host name in front when the window has more than one host. It polls every host and keeps the last values of each.
- **New terminals and projects.** The first tab at a start without saved tabs runs on the first host; a split runs on the host of the focused pane; a chat or a worker opens on its host. The folder chooser has a host list box at its top, the host of the focused pane first, hidden with one host.
- **Migration.** The old setting of one host becomes one entry named by its address. The saved focus projects, triage records, triage choices and limits, earlier triage marks, card places and focus sizes of a one-host window are copied once to the key with the host (`migrateStoredKeys`). The file of the mode "This PC does the work" keeps its format.

## This PC and hosts

Ticket `remote-mixed-mode`, 2026-11-12. The user wants to work on this desktop and see the projects of another desktop in the same window, without a host program on this desktop. The host program and its protocol did not change.

- **The mode.** Options has a third radio "This PC and hosts" under the two others. `state.json` saves the word `mixed` in the field `mode`. An older build reads an unknown word as "This PC does the work", so a downgrade keeps the local work and only drops the hosts. The host list and "Add host" count for this mode too.
- **The backends.** `local` comes first, then each host of the list with an address and a key, in the order of the list. `local` calls go to `invoke` of the app, host calls to the connection of the host. The events come from both sources at once: Tauri's `listen` for `local`, the frames for each host.
- **Keys and saved values.** The key of a project of this PC stays the plain path key, and a key of a host stays `<host id>|<path key>`. A saved pane, a focus project or a stored key without a host belongs to the first backend, which is `local` in this mode, so a file of the mode "This PC does the work" opens unchanged and `migrateStoredKeys` moves nothing.
- **Names.** This PC is named "This PC" everywhere the window names a backend: the title "Dispatch · This PC + host <name>" or "Dispatch · This PC + hosts <name>, <name>", the project names " · This PC", the status bar, the tab tooltip and the folder chooser.
- **The folder chooser.** The chooser of the page opens for every backend, "This PC" first in its list box. It lists the folders of this PC through the app command `dir_list`, the same function as the host call.
- **Shared state, lease and keep-awake.** This PC keeps its `shared.json`, its triage chats, its Nightmode switch and its power request in the app, as in the mode "This PC does the work"; each host keeps its own. A key of a host never goes to another backend. The one switch shows this PC and the hosts together. This PC always drives its automatic actions; only the hosts give a lease, and only they are read every 5 seconds.
- **Network.** Nothing on this PC listens; the window only opens connections to its hosts.
- **Run the host on this PC.** Start switches the window to "Use hosts" with the row `127.0.0.1`, also from this mode: the host then does the work of this PC, and the third mode with a host on this PC would show every project of this PC twice.

## Open points

- **A second listen address.** The desktop window reaches the host through `127.0.0.1`, next to the Tailscale address of user decision 2. The key guards both. The alternative is that the desktop window also uses the Tailscale address, which fails when Tailscale is down on the desktop. Task 3 needs the user's yes on this.
- **One terminal in two windows.** This design does not mirror a terminal. If the user wants to continue a desktop terminal on the laptop, a later task can add a "take over" that moves a terminal to another window id.
- **A Mac as the desktop.** The host builds on macOS like the app, but the worker pipeline is Windows-only today, so a Mac host has no tasks.
- **More than one laptop, more than one host.** Several windows at one host are the design, and several hosts in one window are done (`remote-multi-host`). The proof ran two hosts on one PC; a host on a second real PC over Tailscale was not tried yet, also not in the mode "This PC and hosts".
- **Two hosts on one PC.** Both read the same `~/.claude`, so the chat list shows each chat once per host. With two real PCs this does not happen.
- **Tabs in a narrow window.** With the projects of several hosts, tabs can lie outside a narrow top bar, and the longer names make this happen sooner.
- **Night mode with a host that is gone.** The switch leaves that host out of its look and does not change it; nobody tried this by hand.
- **The Tailscale access rules (ACL) of the user's tailnet.** If they limit traffic between the two PCs, the port of the host must be allowed.
- **Install without the app.** A host without the window on a headless PC is possible with this design, but no task ships it alone.

## Sources

| File | Fact used |
|---|---|
| `src-tauri/src/lib.rs` | 46 commands in `generate_handler`; `pump_output` emits `pty-output`; a start under a known terminal id ends the old shell; `close_terminals` ends every terminal at exit. |
| `src-tauri/src/info.rs` | `image_save` takes the raw body of the call; `file_read` answers raw bytes up to 50 MB; `pane_info` reads `~/.claude/sessions` and the transcripts. |
| `src-tauri/src/update.rs` | The update check runs `curl` or `gh`, and the install starts the installer on the PC that runs the command. |
| `src-tauri/src/status.rs` | `status_info` runs `claude --version` and `claude auth status` on the PC of the backend. |
| `src-tauri/src/pipeline.rs` | The task commands run `worker.ps1` through PowerShell and git; the pasted images are in the app data folder. |
| `src-tauri/src/chats.rs`, `context.rs`, `flow.rs` | They read `~/.claude` or run `claude` on the PC of the backend; `chat_list` names the pane of a running chat. |
| `src-tauri/src/rules.rs` | `rules-off.json` is in the app data folder. |
| `src-tauri/tauri.conf.json`, `capabilities/default.json`, `Cargo.toml`, `package.json` | The four plugins; the Windows-only crates are behind `cfg(windows)`, so the core stays buildable on macOS. |
| `src/main.ts` | The `invoke` and `listen` calls; the folder dialog for the project and for focus mode; the notification and the taskbar blink; the image paste in a terminal; `state.json` holds the tabs, the Nightmode switch and the triage chats; `tellTriage`, `flushTriageQueue`, `approvePlans` and `dispatchEntries` run in the page. |
| `src/chatview.ts` | The message box saves a pasted image through `image_save`. |
| `src/files.ts` | The viewer and the thumbnails read files through `file_read` and `file_stat`. |
| `src/options.ts` | The Options screen keeps its switches in localStorage. |
| `.github/workflows/release.yml` | The release builds Windows and macOS, so the host must build on both. |
| `README.md` | The Privacy section says that Dispatch sends nothing but the update check; that text changes in task 8. |
