# Changelog

What each update of Dispatch brought, in plain words. The newest version comes first. After an update, Dispatch shows the entries since the version you had before; **?** → **What's new** shows them all. The versions before 0.1.46 are in the git history of the repository.

## 0.1.68 (2026-11-17)
- Setup pipeline has the new switch Start plans without decisions, off by default. With it on, a plan that asks you nothing starts its work run by itself, with the recommended checks; a plan with a decision still waits for your click.
- Setup pipeline has the new switch Checks at the gate, off by default. It needs Task branches and a gate command. With it on, the checks that you tick on the task card run once, at the merge, through the gate command, and the worker does not run them.
- Setup pipeline has the new switch Push after the merge, off by default. It needs Task branches. With it on, Merge, also the merge of night mode, pushes your branch to its upstream branch, never with force. The task card shows whether the push worked, and a failed push leaves the merge on this computer.
- Setup pipeline has the new switch Tickets start their plan, off by default. With it on, Dispatch writes the brief of a New ticket from its text and starts its plan itself, without triage, and writes one line into the triage chat. A ticket that ends with a question mark, or has only images, still goes to triage. A new plan starts only while fewer than 3 workers of the project run. With Start plans without decisions on too, a ticket can run to its report without a click.

## 0.1.67 (2026-11-17)
- Keys that you type into a terminal window now arrive in their order. A Backspace no longer overtakes its letter, so the first letter of a line no longer sticks.
- With Task branches on, Dispatch switches the project back to your branch only when the work run has ended. An answer to a worker's question no longer brings back an older report of the task.
- With Task branches on, a worker's own files that it forgot to commit before it asked no longer stop your answer: Dispatch commits them on the task branch as WIP. At each start of the worker the task branch takes the newer commits of your branch; when a file changed on both sides, the task branch stays as it was and the worker is told.
- Night mode now merges a task with a done report by itself when the gate command passes, and writes Night mode merged into the triage chat. Without a gate command it does not merge, a failed gate waits for you, and nothing is pushed.
- With Task files local only on, a branch switch, an update of a task branch or a merge no longer deletes or overwrites the task files on your disk. A task branch that waits keeps Merge also after you turn Task branches off, and a task that lost the note of its branch gets Merge back. On another computer, turn Task files local only on and Apply there before you pull, or git deletes the task files there.

## 0.1.66 (2026-11-16)
- The Decisions window gets an Ask box. Click Ask about this at a decision, or Ask on the plan card, and type your question; Ask triage about this plan sends it to the triage chat, and the answer shows there. An Ask approves nothing and changes nothing. The buttons now read Ask triage about this plan, Revise the plan with my choices and Approve and start the work, each with a line that says what happens. Your picks in the window stay until the plan changes.
- A project has one triage chat, however many windows of the same host show it. A second window shows the chat of the first, and you can type in either. When the chat ends, one click on Start triage continues the same chat. A New ticket goes to triage only once, also with two windows open. When the host of this PC runs but a window does the work of this PC itself, a bar offers Use the host.
- An uncommitted change now holds only the task whose files it touches. Changes in other files no longer stop a work run from starting, a switch back to your branch or a merge. The card names only the files of the task: commit, stash or undo them to go on. A worker commits only its own files, and on a task branch it commits them as WIP when it stops with a question or fails.
- Plans and worker questions now ask in everyday words: what changes for you, without names from the code, with short questions and short buttons. A project gets this rule after Setup pipeline → Apply.

## 0.1.65 (2026-11-16)
- When a decision that waits for you names a step, such as a file or folder that must leave the working tree before the start, Dispatch now says that it does not do that step. The task card, the task row and the Decisions window show your choice and what to do: do the step yourself, or commit or stash the change. The Decisions window also shows this note under each option that waits for you.

## 0.1.64 (2026-11-16)
- The tickets board gets the column Backlog, left of New. Dispatch never sends a ticket of Backlog to triage: drag it to New, or click → New on its card, when it should go. All → Backlog in the head of New and All → New in the head of Backlog move the shown cards at once.
- A ticket card drags by its whole body: drop it at another place in New to change the order, or on Backlog, New, Done or Canceled to change its status. A ticket that you put on Done shows "done by hand". A ticket that is In progress or sent to triage does not drag. Drag the bottom-right corner of the tickets window to resize it; Dispatch keeps the size, and a double-click on the corner gives the usual size.
- The tickets board reads the ticket lines of other tools better: a closed ticket is Canceled only when it was closed as wontfix, duplicate, superseded or canceled, else Done. Types such as bug read as Fix, docs as Content, and cleanup or test as Refactor. A ticket of the old Todo column and an open ticket without a status show in Backlog.
- While a project is paused, Dispatch writes no ticket lines by itself; the first task read after Resume writes the changes. Your own moves, renames and new tickets still write.
- The compaction of the triage chat after a task now really runs. Before, Dispatch read the empty input line as text, in the Terminal view and with a chat tab open, and waited forever. Grey text of Claude Code on the input line, such as a suggestion, counts as empty.
- After you answer a question of a task or click Continue in Dispatch, the Report row of the task card shows Answered instead of Needs-Decision, until the worker writes its new report.

## 0.1.63 (2026-11-15)
- The Setup window gets the section Build folders: it lists the build folders of a Rust project with the size of each. The button Clean build folders deletes the proof builds and the incremental cache; the main build (debug and release) and a folder in use stay.
- A run whose session Dispatch ended after the run finished shows the grey chip Ended on the task card, not the red Stopped. Stopped stays red for a task that you stopped and for a session that ended before its result.
- The chat tabs leave the top bar: a chat of the Chats list, the Chat of a project and a plain shell stand in the head of the triage pane after Chat and Terminal, each with its own ×. A click shows the chat inside the triage pane; Chat or Terminal brings the triage chat back. The + of the top bar adds a project. Without a workspace, and in Focus, Map and Overview, a chat fills the window as before.
- The tooltip of the context line on the Triage card shows the checks of the triage chat: the last task end that Dispatch noted, the last check, and the last failed check with its time, its step and its error, until Dispatch restarts. A check that does not end names the step where it stopped. A compaction that shows no summary within 3 minutes leaves a line that says when it was sent, until the next one. Without a context line, the tooltip of the Triage row shows these lines.
- Merge no longer refuses because of changed task files: it commits them first in one commit, then merges. When two computers add tickets, a pull keeps the lines of both. Because of this, Setup pipeline shows the step Task files as To do after this update in each project that is set up: click Apply once per project.
- In Focus, the left panel of each column shows a Tasks section and a Chats section under the Triage card. Each shows its 5 newest items, and the others fold into "Older tasks" and "Older chats"; click a heading to fold or open it. A task that waits for you or runs never folds away, and a folded Tasks heading shows "N wait" in orange. Dispatch keeps the folds per project, and a click on a chat opens it in Details.

## 0.1.62 (2026-11-15)
- Each project gets a button Actions next to Tickets, in the bar and in the Focus column head. It opens a panel where you define your own buttons: a name and 1 to 10 steps, each a command on your computer in the project folder or a Claude task through the pipeline as a ticket, without the triage chat. Run starts the first step; the next step starts when a step ends well, and the chain stops at the first step that fails. The switch "Approve the plan by itself" on a Claude task starts its work run without your click; a plan with a HOLD decision still waits for you. Pause tasks holds the Claude steps; a command runs at your click. The button "Release example" fills in a Release action; nothing exists until Save. Each card shows the last run with its time, its result and the output of its commands.
- A project goes on on a second computer: push on one, clone or pull on the other, click Apply once in Setup pipeline, and go on. The files that git shares name no path of your computer, so the setup is the same on each computer; the allow rules of this computer stay out of git, and Apply adds an ignore line for them. A task that ran on the other computer says "ran on another computer · no worker here" on its card, blocks nothing, and its plan gets Approve again. Because the setup files changed, Setup pipeline shows steps To do after this update in each project that is set up: click Apply, then Commit to git, once per project.
- Setup pipeline gets the switch "Project notes in git", off by default. On, Apply lets the notes of Claude in the folder .claude of the project into git, also when the project ignores that folder: it adds marked exception lines to the ignore file. Commit to git takes the ignore file and the notes, and Dispatch commits later changes of the notes with the task files. The local settings and the state folder stay on this computer. Off again, Apply removes only its lines; the notes that git tracks stay in git.

## 0.1.61 (2026-11-15)
- After a task of a project ends, Dispatch compacts the triage chat of that project: the window that drives the host sends /compact at a quiet moment, when triage was idle for 30 seconds, no card or line is on its way, no menu is open and you did not type or click in Dispatch for 30 seconds. In the Terminal view it sends only when the prompt line is empty and you did not type a moment ago. It also runs in night mode. The lines of Dispatch and the tickets wait while it runs; the chat then shows the summary note of Claude Code. The switch "Compact triage after each task" in Options turns it off for all projects.
- A done task whose report check found a command that the transcripts do not have gets the button "Take as done" on its card. One click closes the task without a question: the ticket goes to Done, the status reads "done · taken as done", and the chip of the report row keeps the count and shows the time of your click in its tooltip. The button also shows for a done report without a Verification section or without a command in it. The report file does not change.

## 0.1.60 (2026-11-15)
- Dispatch ends an old worker session by itself 10 minutes after its run ended, from the window that drives the host. A run in progress, a plan that waits for Approve, a question and a permission prompt stay. When an end fails, the row shows the error, Dispatch tries again after 5 minutes and stops after 3 tries. The window Old sessions lists "Ended by Dispatch" for this run.
- Approve starts the work run as a new session. It reads the brief, the plan and your decisions, and carries nothing of the plan run. A plan has the new section "Notes for the work run" with the facts from the code that the work run needs. Approve goes on when the plan session is gone, and refuses while a worker of the task still runs.
- The section Background workers and the worker script of the pipeline changed, so Setup pipeline shows the step for the section in the instructions file and the step Worker script as To do once in a project that is set up. Apply them once.
- The top bar is one row: the tab strip of Details goes, and the project pills are the one list. In Details the bar lists the focus projects first, then the other workspaces in the order they opened. A project without a workspace is a dashed pill with an empty dot, and a click starts it as + does. The open group ends with a divider and × that closes its workspace. A chat or a plain shell is a plain pill after the projects with its own ×; the × of the last tab opens a plain shell tab. Chats stands next to Nightmode.
- The weekly allowance graph in Token usage always draws a line from 0 at the reset to the newest reading, also with one reading. A piece between two readings at most 2 hours apart is measured and solid; every other piece is rebuilt from the tokens of the transcripts of all projects and drawn thinner and dotted. The trend and the run-out label come from the drawn line, the pace of the last 24 hours. The Table view lists each rebuilt piece, and the legend and the note explain the dotted piece.

## 0.1.59 (2026-11-14)
- A task card that waits for you pulses with a glow of its frame and a dot until you press the pointer in it. Its project pulses too in the pills, the tabs, the Focus column heads, the Overview and the Map. The switch Pulse in Options and the system setting for reduced motion leave a still mark instead.
- Each run row of the task card shows the tokens and the model of its run on a second line. The exact numbers per model stay in the tooltip. The Tokens blocks per model and the WORK and PLAN command lines leave the card; the task log keeps the commands.
- The ⤢ button of an Overview card makes the card twice as wide, lists the 15 newest finished tasks and shows both lines of each task in full. ⤡ gives the usual size back. Dispatch keeps the size per project.
- Each Focus column has – and ⤢ after Workers. – folds the column to a narrow strip with its name, its state and the signal of a waiting card, and a click on the strip brings it back. ⤢ gives the column the whole width, and a second click gives the layout back. Dispatch keeps the state per project. In a narrow column the project buttons give their room first, so – ⤢ × always show.
- The Setup button of a project pulses while the project has a setup step To do, in the bar, the Focus column head, the Map and the Overview. Its tooltip names the steps. A click calms it to a still mark until the steps change, and Apply ends the mark. Dispatch asks the steps every 30 seconds.
- A button Tokens next to Tickets opens the window Token usage: four tiles, the tokens per hour or per day by work runs, plan runs, agents and triage chat, the weekly allowance as a line with its events and its trend, the list "Who used the most", a table per model and a Table view. Dispatch writes the weekly percent once per hour into a history file in its data folder.
- In the Verification section of a report only a line without indent is a claim. The indented lines under it are the results of that command, and Dispatch does not compare them with the transcript. A task whose report had such lines showed as working and now shows as done.
- The section Background workers of the pipeline has a new sentence about these claim lines, so Setup pipeline shows the step for the section in the instructions file as To do once in a project that is set up. Apply it once.
- The × of a Focus column asks first "Remove <project> from focus mode?". The window says that the project and its workers keep running and that + adds the project back. Enter confirms; Cancel, Esc, the × of the window or a click outside leaves it.
- Every message to triage is a ticket in New, and New is the queue: Dispatch sends the New tickets to triage by itself, one at a time in their order, unless Pause tasks is on. The Todo column, the question rule and Ask triage go; a command of Claude Code still goes at once. After the update Dispatch sends every ticket that stands in New, so look at that column or turn on Pause tasks before the first start. On the board, → New puts a canceled ticket back.
- A yellow ! after the project name shows when tickets wait and do not go: at once when the project is paused or has no triage, after a minute when triage took none. A click opens the board and calms it. A button Chat after Tickets opens a plain Claude Code chat in the project folder for a question without a ticket.

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
