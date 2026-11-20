# Changelog

What each update of Dispatch brought, in plain words. The newest version comes first. After an update, Dispatch shows the entries since the version you had before; **?** → **What's new** shows them all. The versions before 0.1.46 are in the git history of the repository.

## 0.1.80 (2026-11-20)
- A merge that stops halfway never leaves the checkout open; the merge verb writes a marker and aborts in its finally, the task read and Merge cancel a merge that a killed script left (only one that Dispatch started), Setup commit, the switch back, untrack and the switch to a task branch stage nothing during an open merge; the card says why nothing was merged and auto-merge does not try again.
- Approve waits in the queue while the checkout is on the branch of another task; the card names the wait and hides Commit files.
- A new task log keeps the commands and token rows of the old log and adds only the new ones.
- Reject of a plan whose plan run is not on this computer starts a new plan run here with the old plan and the reason; an old project script gives the Apply hint.
- Approve and Revise grey while the question box has text, Ask is the main button; help text and Goal fold behind Show more, your words bold.
- A chat click in the Chats list of a Focus column opens the chat in the terminal panel of the column and the window stays in Focus; an earlier terminal keeps running; rule chatSlotStep, Help, tests.
- Three proposals with sketches for simpler tabs in Details; recommends one row of tabs.
- Revise sends the text of the question box to the planner with the choices; Revise works with only text; label 'Your question or change to this plan'.
- The Commit files window lists every changed file when the project worker script is old, with a hint to Apply.
- Each Focus column has the tabs Tickets and Workers (Triage first with a triage chat), with counts, remembered per project; the Workers button of the head and the × of the Workers bar go; the terminal panel has a Details switch, off at the start, that shows Environment, Context and Outputs.
- Your words, Goal and TL; DR in the Decisions and Questions windows show headings, bold labels, numbers, bullets and gaps.
- No triage is on at the start, also for a set-up project without a settings file; the first Apply writes the settings file.
- Three proposals for a plan tree (plan file + Plan view, Parts as a Tree tab, Claude-read plan in the Overview) with sketches, Compare and Recommendation; boards PlanTreeA/B/C in the Claude Design canvas.
- A thin project rail at the left edge of Focus, Map and Overview replaces the project pills there: one square per project with two letters, Focus above a line in column order, Other below, bars, badges, computer tags, clicks, drags, right-click menus and + at the bottom; known projects stored; Remove project asks first.
- A chat writes tickets into .dispatch/new-tickets/ and the task read puts each item at the end of New (one parser with Parts of a plan); a new rule line in the section tells the chats; right-click on selected terminal text opens New ticket with it.
- Details panel of the Focus terminal is a slim two-column band above the terminal.
- The copy button of a task card copies the ticket id; tooltip, Help, test.
- A narrow Focus column keeps room for its board: the task panel and the terminal shrink to their minimums first, then the row scrolls sideways; column and panel drags respect the room.
- A dropped ticket card stands in its new column at once with a spinner until the move is saved; a copy of the card follows the pointer during the drag; the board shows the ticket_move reply and runs the full task read without a wait; a task read that began before the move keeps the board's tickets.
- Night mode is a setting of each project: a Night button next to Pause; the Nightmode switch of the top bar is gone; shared.json keeps a map of projects with night mode on and a click writes only its own project; the old switch of a whole PC turns no project on; a PC stays awake while one of its projects is on.
- An In progress ticket whose task waits for the user has an orange frame.
- Setup pipeline and Options get the look of the design canvas: a section list at the left, a header with icon, subtitle and the count of open steps, switch rows in cards with captions and dimmed dependent rows, step rows with a progress bar, mode and theme cards, a text size row; 880 px wide; the host list hides in the mode This PC does the work.
- The tickets board of each Focus column has a search box in its head; it narrows the five columns with the rule of the Tickets window search; the count says '<shown> of <all> tickets' while the box has text; each column keeps its own search until a restart.
- The Plan ready card gets a Cancel button with a confirm; the stop step of the worker script also ends a finished plan run without a listed worker.
- Night button moves into the Auto-start strip before Pause; Pause and Night leave the project buttons.
- A new ticket, an edit and a new part show on the board from the save reply and the window closes at once; the task read runs in the background.
- A fifth view Plan shows the tickets of one project as a tree on the dots of the Overview; each ticket gets the field after (the arrows) in tickets.jsonl; rows by the longest chain, order by the mean x of the tickets before, badges Next up, Started early and waits; side panel with Next up, Started early and Not in the flow; read-only in this step.
- The Plan view selects cards (click, Shift, Ctrl, box with a menu) and arrows; keys C, G, X/Del and Esc on the board only; comments (open boxes) and groups (stacked cards with progress, counts and badge, merged thicker arrows) with title, 4 colours, Collapse/Expand, Remove; Collapse all and Expand all; kept per project in .dispatch/plan-groups.json through the host commands plan_groups_load and plan_groups_save.
- Plan the flow edits the arrows of the Plan view in a draft (+ under each card, Place of Not in the flow, x in Comes after and Comes before, From and To selects, Turn it around, Remove the arrow, + Ticket after this, Take out of the flow); loops, doubles and self-arrows are refused with the reason; new arrows green, removed ones faded and dashed; a bar with N changes, Discard (asks first) and Confirm; the side panel lists the changes and the queue after Confirm with up, down and new; Confirm writes all after, order and open lines at once through the new host command plan_confirm, sorts New by a stable topological sort, changes no column and starts nothing, and says how many tickets moved.
- The project rail is 2x bigger (squares 56px, rail 72px, letters, badges, tag, + button); size assertions in the rail test.
- The project rail is 25% smaller (squares 42px, rail 54px); badges and tag sit inside the rail so the edge does not cut them; size assertions in the rail test.
- The Details view goes; the view switch is Focus, Map, Overview and Plan; the project pills, the chat panel, the pane tools, the head row above the workspace and the chat tabs go; a saved start in Details opens Focus; a chat, a worker, a project and the Chat of an Overview card open in Focus, in the column of the project (a project without a column joins Focus); the Details switch stands at the right of the tabs and shows the side panels of the Triage, Workers and terminal panes; the Chats section of a column has a search box; Remove project of a square below the line also ends its triage chat and agent view.
- A pipeline run that Claude Code keeps at working but that is idle and wrote its plan or report in this run counts as done (worker list and Worker-State of the worker script), so the card shows Done and no Stop row; a plan step without its own step line before a started step shows as done.
- A plan run that ended for good without its plan (done, no plan file, nothing in flight in its job state) shows a red Failed card with the reason, alerts with No triage, and offers Plan again (new host command task_replan, a new plan session); the worker script gives claude each relative Edit rule with the project folder in front, so a cd of the plan run no longer takes away its plan write.
- The Auto-start and Night buttons above the tickets board become switches like Details; the strip and the Focus board head wrap when narrow.

## 0.1.79 (2026-11-19)
- A terminal of a Windows folder shows SI (0x0F) of the host as one column, as the host console counts it, so the first typed letter stands after the prompt mark and its space and Backspace removes it.
- In Focus a Below button on the terminal panel puts the terminal under the tickets board with the full width, Beside puts it back; the line between them drags the height (double-click for the usual height); each project keeps the choice and the height.

## 0.1.78 (2026-11-19)
- A project switch lets an agent pick the checks after the work run; the task card shows the picks with one reason each as checkboxes, Run checks (or the merge with Task branches) runs the ticked ones through the new verb check and shows each exit code and log; a run-everything list picks every check; a failed check keeps the task open; night mode runs the picks.
- A click on Run clears the last run of the card and shows a spinner with Starting… on Run until the new run shows.
- A project can schedule a full run of every check, each night at a set time or after a number of finished tasks; the verb check full runs the list on the base branch under the measure lock, keeps results and logs in .dispatch/checks/full, Setup pipeline shows the last run, and each failed check opens one fix ticket in New while none is open.

## 0.1.77 (2026-11-19)
- Options gets a Phone tab with one button and the code; the phone page keeps its key in the address, so the Home Screen icon stays connected.
- Card files are never committed on a task branch; each switch between the base and a task branch carries the uncommitted card files and puts them back, so no plan, report or branch file goes missing; the switch back to the base holds the merge lock, and Approve, Reply and Merge wait up to 60 s for it; a "no plan" or "no branch file" error clears when the file is back.

## 0.1.76 (2026-11-19)
- The permission card gets Stop; the first click asks, Stop now ends the task, Keep waiting steps back.
- The phone lists only this computer's projects open in a live window, and the host refuses task_list and ticket_add for every other folder.
- The New ticket and Edit ticket window no longer blocks Dispatch; its title bar moves it and the place is kept, text behind it can be copied, an open edit stays until it is saved or closed.

## 0.1.75 (2026-11-19)
- The Dispatch host now serves a small phone page with only the Overview: project cards with their tasks and tickets, and a box for a new ticket. In Options, under Run the host on this PC, scan the code with an iPhone that has Tailscale, then add the page to the Home Screen. New phone key ends the access of the old code.
- Focus has a new button in the top bar that stacks the projects as full-width rows. Drag the lower edge of a project to change its height, – makes it a thin bar, and ⤢ gives it the whole height. Dispatch keeps the layout and the heights after a restart.
- A terminal that is shared with a larger window now opens at its newest lines in a smaller window, and you can scroll to every line.
- A restarted window now redraws its terminals, and a size change during the start of a terminal is no longer lost. Both faults could remove the prompt mark. A terminal also has a new Save record button at the top right: if letters stick, click it at once. It saves the last output, the last keys and the screen into a file, which can hold what you typed.
- A question about a plan in Focus now goes to the Open terminal terminal of the project, and the window stays in Focus. The Chat button of a project is gone. Two project buttons with the same name now show their folder.
- In the Token usage window, a project that cannot be read now gets its own red message. The other projects keep their numbers and the weekly line.
- The task card now lists the steps of a work run under its row, with a check mark and the time of each finished step and a running time for the current step. You see this for work runs that you approve after the update.
- This PC now runs its projects one time: This PC and hosts skips the row of the host of this PC, and Use hosts puts that row first. A terminal shows only under a project of its own computer. The host warning can now stop the host, and a new bar offers to move tabs from a host back to this PC.
- Done and Canceled on the tickets board show their newest 10 tickets, with a Show all button for the rest. The count and the search still include all tickets, and the lists keep their scroll place at a redraw.
- Each task card has a copy button after its name that copies the ticket title.
- A plan run can now write only its plan, and it can read a web page that its ticket names. Each project needs Setup pipeline → Apply for this.

## 0.1.74 (2026-11-18)
- The commits that Dispatch makes for its task files now say what changed and for which task, instead of only counting files.
- Dispatch now finds the tests of a project in its files, without running anything. Setup pipeline lists them in the Checks box, and Apply saves them, so a project with tests and no saved list shows the step Checks as open. The new Find tests button adds later tests and keeps your lines.
- Dispatch does less work while a project is open, because the pulsing signs no longer make the window redraw itself at each screen refresh. They still pulse. A minimized window that you have not used for 1 minute, and that does not do the automatic work of the host, updates its lists about every 30 seconds.
- Setup pipeline has a new switch, Auto-merge finished tasks, on the tab Branches and checks. It is off at the start and needs Task branches and a gate command. With it on, Dispatch merges a task with a done report without your click, after the gate command passed, one merge at a time. A failed merge stays on the task card with its reason, and the card says why a branch still waits.

## 0.1.73 (2026-11-18)
- In a No triage project on a host, Open terminal in a second window now shows the terminal that another window opened for the project, with its history and live output, instead of a new session. The × there closes it only in that window.
- After a restart or a reconnect, a terminal on a host takes the size of its pane again, so its text fits.
- A project that waits for you no longer has an orange frame in the top bar. The orange dot and the word "waits" stay. In Details, the project buttons and × moved to a row above the workspace, and the current project has a blue frame.
- The Nightmode switch now follows a change that another Dispatch program makes on this PC. When this PC and a host differ, the switch reads "Nightmode: mixed".
- The bar at the bottom shows the usage and versions of the computer of the project that you click or type in. In Map and Overview, a click in a project makes it the current project.

## 0.1.72 (2026-11-17)
- When Approve waits because files of the task have changes that are not saved in git, the plan card offers Commit files…. Its window lists those files and a commit message that Claude writes and you can edit. Commit saves only those files in one local commit and sends nothing to GitHub.
- A stopped task shows Resume in its card. Resume starts the stopped plan or work run again where it stopped.
- A new Git state button among the project buttons opens a window that only shows: the history of all branches as a graph, how far the branch is ahead of or behind GitHub, the files with changes, and the changes of the file you pick.
- You can resize the Git state window at its corner, like the tickets board. It keeps its size, and a double-click gives the usual size.
- This version has a Mac disk image again. A Mac with an older version now gets the update.

## 0.1.71 (2026-11-17)
- Each project has a "+ Ticket" button next to Tickets, and each Overview card has one too. It opens a New ticket window without the board, with every field at once.
- A right-click on a tickets board opens a small menu: New ticket in New or New ticket in Backlog.
- You can paste an image into the New ticket window with Ctrl+V. A ticket with only images is allowed.
- The ✎ button on a Backlog or New ticket opens it for editing. While you edit a New ticket, Dispatch does not start its plan. A click on the title of a Done or Canceled ticket shows its details, with its brief, plan, report and log.
- A coloured strip above the tickets board always shows whether auto-start is on or paused, with one large Pause or Resume button.
- An approved task shows a blue "✓ Approved" mark until its work run starts, on the task, on the plan card and on its ticket.
- In Focus mode, a project with No triage shows its tickets board where the triage chat would be.
- With No triage on, a project opens without its triage pane, and an open triage pane of the project closes.
- Setup pipeline and Options show one section at a time behind a row of tabs.
- A worker no longer has to copy its commands into its report. The task card lists each command of the work run, and a click shows its exit code and its last lines. A done report stays open only when the work run ran no command or skipped a chosen check.
- A screenshot that you paste into a chat tab inside the triage pane now goes to that chat, not to triage.
- A project with No triage no longer shows a Triage heading or card in Focus mode or in the Details list. Its old triage chat stays hidden, and the empty Tasks note tells you to add a ticket on the board.
- The New ticket window shows a spinner in Add (Saving… in Edit) and locks its fields while the ticket saves. A failed save unlocks them and keeps your text.
- A stopped ticket that you move back to New or Backlog stays there and starts its plan again.
- The level list in the New ticket window now says "Plan level", so it is clear that the level is for the plan.
- The Decisions window (Approve, Revise) and the Questions window (Send the answers) lock and show a spinner in the clicked button while they send. A failed send unlocks them and keeps your choices.
- The button on the tickets board is now Open terminal. It sits at the left side, has a frame, and each project has one terminal.
- In Focus mode, Open terminal keeps Focus mode and shows the terminal between the task list and the tickets board. Drag its right edge to change its width; a double-click resets it. The × above it closes it and ends its session.
- While the project terminal is open, the board button says Terminal open and is disabled.
- The rules of the workers changed for the report check, so each project needs Setup pipeline → Apply.

## 0.1.70 (2026-11-17)
- The triage chat now hears that a worker is done only when the worker wrote its plan or its report in that run. A worker that stops early gives one line about it, once.
- Setup pipeline has the new switch No triage, off by default. With it on, Dispatch starts the plan of every New ticket itself, also a question or a ticket with only images, and writes nothing into a triage chat. The task card and the alerts tell you when a plan is ready, when a worker asks, and when a task is done or failed. A failed plan start stays in New with its error and a Retry button. The project opens without a triage chat and with a Chat button, and Ask about this plan in a Chat opens a plain Chat.
- The New ticket form has a level: Simple plans with Opus at medium effort, Medium, the default, with Opus at high effort, and Hard with Fable at high effort. A click on the level tag of a waiting ticket gives the next level. The hint at the Goal follows the level. A type button and More add the optional fields Why, Done when, Do not change, Context, and What I see and What I expect for a fix; each filled field goes into the brief.
- Each plan now ends with its advice for the work run. The Plan ready card shows it with a model list and an effort list, and Approve starts the work run with your choice.
- A plan can list parts that follow. The Plan ready card lists them before Approve, with a box that lets the chain run at night without your click. Approve makes one Backlog ticket per part, in order. When a part is done, the next part moves to New and starts its plan; a failed or stopped part stops the chain. The parent counts its done parts and goes to Done after the last part. In Backlog you can edit, add, remove and reorder the waiting parts.
- The rules of the workers changed for the level, the work advice, the parts and No triage, so each project needs Setup pipeline → Apply.

## 0.1.69 (2026-11-17)
- The tickets board now shows every running task in In progress. A task that runs without a ticket gets its own ticket there. A finished task stays in In progress until you click Merge, and a merged task moves to Done. A closed ticket stays closed; only a new run after the close moves it back to In progress.
- Dispatch no longer commits task files while a git merge is not finished. At Merge, the report and the log of the task keep the version of the task branch, and a side with conflict markers stops the merge. A task file that already has conflict markers keeps the task branch side, once, and the triage chat gets one line about it.
- The new rule for the report and the log at Merge needs Setup pipeline → Apply in each project.

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
