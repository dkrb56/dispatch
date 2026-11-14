# Changelog

What each update of Dispatch brought, in plain words. The newest version comes first. After an update, Dispatch shows the entries since the version you had before; **?** → **What's new** shows them all. The versions before 0.1.46 are in the git history of the repository.

## 0.1.58 (2026-11-14)
- Each project has a switch "Pause tasks": a button in the top bar, a banner with Resume on the tickets board and a checkbox in Setup pipeline. While it is on, Dispatch sends no Todo ticket to triage and starts no work run; your Approve waits until Resume. The switch survives a restart.
- The bar of the Workers pane has a button "Back to list" that brings the list of the agent view back from an opened worker.
- A task branch that you merged with git yourself shows as merged at the next task read: no Merge button, no old refusal, the ticket goes to Done, and triage gets one line.
- With Task branches on, Dispatch takes the newer report of the task branch into your branch, so a question that you answered no longer comes back after a switch of the branch.
- Dispatch reads the tasks of a project one read at a time, so a read during a branch switch no longer shows an old report.
- The worker script has a new part, so Setup pipeline shows the step Worker script as To do once in a project that is set up. Apply it once.
- Each run row of the task card shows the tokens of its run after the duration. The tooltip shows the exact numbers per model, and the rows sum to the total of the task.

## 0.1.57 (2026-11-14)
- Each project has a tickets board with the columns New, Todo, In progress, Done and Canceled. A message to triage becomes a ticket, and the Todo column is the queue.
- The top bar groups the buttons of each project. The tab Tabs is now named Details, and "+" adds a project.
- The Help is short: each section starts with a one-line summary and a short list, and the long texts open behind a click on Details.
- The task card shows the tokens that a task used, per model.
- The task card shows each command of the plan run and the work run, with its exit code, its time and the end of its output.
- Each task has one log file in the task folder of the project, and the task card has a Log row that opens it.
- A done report needs a command of the run for each claim in its Verification section. A chip on the Report row counts the claims without one, and the task stays in work until they have one.
- You pick per task which checks run, from checkboxes with the recommended ones prefilled.
- A question that you already answered does not come back as new when the worker leaves it in its report. The card offers Continue, Send the answer again and Stop.
- The question card of the Chat view shows the question and its options only, never the screen text above them.
- A line of Dispatch for triage waits while you type in the triage terminal, so your half sentence is not sent with it.
- The triage chat hears the end of a worker once, not again after each later turn.
- A merge that the gate refuses shows the failed checks as a short list. The whole gate log opens behind a click.
- Setup pipeline has the switch "Task files local only": on, the task files stay out of git; off, Dispatch commits them as before.
- Dispatch starts one work run per project at a time, also when two approvals come close together.

## 0.1.56 (2026-11-13)
- Each finding of the rules check (Setup pipeline and the Rules window) has a link with the name of its file, also for a rule outside the project. A click shows the file in the viewer.
- In a report or a plan, the files of the line "files:" show as a row of links above the text, and a path in a code span is a link too. A file that is not there marks its link, and the view stays.
- The file viewer is now a dialog above the other windows; Esc closes only the viewer. Its button "Open in editor" opens the shown file in the program of this PC, for a file of this PC.

## 0.1.55 (2026-11-12)
- Setup pipeline has the switch "Task branches": a task works on its own branch, and a Merge card merges it into your branch when you click Merge. A gate command of your choice must pass first.
- Setup pipeline has the switch "Measure before the plan": the plan run may run the commands you list, one at a time, and the plan shows what it measured.
- A window "What's new" opens once after an update and lists what the new versions brought. **?** → **What's new** shows the whole list.
- The worker script has new parts, so Setup pipeline shows the step Worker script as To do once in a project that is set up. Apply it once.

## 0.1.54 (2026-11-12)
- The Environment panel has a switch for Remote Control: a click turns it on or off for the session of the pane, on this PC or on a host.
- The top bar shows "N old sessions" while Claude Code still keeps worker sessions of finished tasks open. Its window lists them, and End closes one session; its task does not change.
- The Plan row of an open task card has no state chip any more, so it no longer looks like a second run.
- The download for macOS contains the host program for both kinds of Mac again.

## 0.1.53 (2026-11-12)
- Work on another computer: a host program does the work on one computer, and the window of another computer shows and controls it over Tailscale. Options → Where the work runs has the modes This PC does the work, Use hosts, and This PC and hosts.
- One window connects to several hosts at once, and a folder chooser picks the project folders of a host.
- The triage chats and the Nightmode switch live on the computer that does the work, so every window sees the same ones.
- A worker question opens a Questions window like the Decisions window. Send the answers sends every answer in one reply.
- The question menus of the triage chat show the right text and every option, also when a menu is taller than the terminal.
- A plan has a short TL;DR in plain words, and the Decisions window shows it under the Goal.
- A task that you approved while its project was busy shows what it waits for.
- While Nightmode is on, the computer that does the work does not go to sleep.
- The bar at the bottom shows the Claude account and when the weekly usage starts again.

## 0.1.52 (2026-11-11)
- Triage that runs only a background command counts as free, so Dispatch sends it the next planned message.
- Changes inside the app prepare the work on another computer; nothing changes for you yet.

## 0.1.51 (2026-11-11)
- The line above the message box of the triage chat says how many messages wait for triage.

## 0.1.50 (2026-11-11)
- Dispatch runs on macOS: each release has a disk image for the Mac next to the Windows installer.
- A task that starts to wait for you alerts you once: a system notification, a short chime and a blinking taskbar button, each with its own switch in the new Options window behind the gear. The lists for the theme and the text size moved there.
- The Overview card shows the tasks in work, the newest finished tasks and the planned messages. A message to triage waits as a planned entry until triage is free, and you set the order of the entries.
- The project cards of the Overview can be dragged. They snap to a dotted grid, and Dispatch keeps their places.
- A report with several questions is answered in one reply, after you chose an option for each question.
- The Decisions window starts with your words from the brief and the Goal of the plan.
- The rules check of the Rules window has its own time limit, model and effort.
- The task files move into the folder .dispatch of the project, so git keeps the briefs, plans and reports. Dispatch commits them itself.
- The Nightmode switch stays on or off over a restart, and the triage chats follow it.
- Both copies of Dispatch on one computer continue the same triage chat.
- A work run that ended with a question stays done when Claude Code marks it as crashed hours later.
- A reload of the page no longer closes the app.
- The Options window takes the height of its content.
- Dispatch has a new app identifier. An update from an older install starts with empty tabs and settings.

## 0.1.49 (2026-11-11)
- The model and effort lists of the Triage and Workers heads stand together at the right edge of the head.
- A temporary task card shows your whole message with its line breaks, up to six lines.
- The Map folds finished tasks again.
- Temporary task cards stay over a restart of Dispatch, for up to 10 minutes after the message.

## 0.1.48 (2026-11-10)
- A message to triage shows at once as a temporary task card. The real card takes its place when the plan run starts.
- A theme list switches the colours of the window and the terminals: Slate, or Graphite with a blue, indigo, teal or amber accent.
- The Overview hides the projects group of the top bar.

## 0.1.47 (2026-11-10)
- Each task shows two short lines: what it is about, and what was done or is in work.
- A running task has a Stop row. Two clicks end its worker.
- The projects group of the top bar shows in every mode.
- The groups of the top bar have a visible frame.

## 0.1.46 (2026-11-10)
- The top bar shows the modes, the projects and the setup as framed groups, and + adds a project.
- The Setup pipeline window has a Commit to git button that commits only the setup files.
- Dispatch checks the rules of a project: Setup pipeline lists the conflicts, and the Rules window has Analyse rules.
- Dispatch keeps the position and size of its window. Project opens Setup pipeline first for a project that is not set up, and the workspace opens after it.
