# Changelog

What each update of Dispatch brought, in plain words. The newest version comes first. After an update, Dispatch shows the entries since the version you had before; **?** → **What's new** shows them all. The versions before 0.1.46 are in the git history of the repository.

## 0.2.1 (2026-11-28)
- Dispatch commits the task files on its own branch dispatch/tasks through an index of its own, with no checkout, so the user's branches get no Dispatch commits; Apply moves the tracked task files off the current and the other local branches in one commit per branch and writes the ignore pair of the branch; a clone takes the branch and its files from the remote copy at its first read; the notes still go onto the user's branch; local only keeps working.
- After the disk commit, a task read joins the newer remote copy of dispatch/tasks into the local branch without a checkout (merge-tree; the union rule keeps the ticket lines of both computers, a file that changed on both sides keeps the local version, a deletion of the other computer holds here too, a branch without own work takes the remote state without a commit) and writes the files of the other computer into .dispatch; a pair that was settled starts no git on an idle read; help text and README.
- Tasks whose plans name the same file work at the same time; the worker script and the window no longer hold a start or a reply for the same files; when a branch in a work folder cannot take the newer base without a conflict, the prompt tells the work run to merge the base itself, join both sides, commit the merge on its task branch and ask only when the sides disagree.
- After a commit or a join on dispatch/tasks, Dispatch pushes the branch to the remote that already has a copy of it, never with force, in the background with a time limit of 60 s; no push before the user pushed the branch once; a failed push (offline, refused) writes a log line and the next commit tries again; help text and README.

## 0.2.0 (2026-11-27)
- An answer that waits for a busy project no longer stops the window: Setup, Actions, New ticket, the merges and the queue work again.
- A bin on each ticket that does not run deletes it after a second click, with its parts; a delete line in the tickets file, and the id stays taken.

## 0.1.101 (2026-11-27)
- The gate refusal parser accepts the missing session log sentence and the card shows it.
- The step Task files also waits for a running worker with a bare ticket id that has task files.
- A script removes a lock of an ended process only under a system mutex and only when it is still the lock it read; the pick lock polls every 250 ms.
- A merge in the project folder puts the session-log pointer back as it was, also after a good merge.
- The added computers of the phone page come from the storage once it exists, the address only when nothing is stored.
- The keys of the added computers go after # in the page address, not into the query.

## 0.1.100 (2026-11-27)
- Worker alerts name the project, not the work folder number.
- The merge card says that a pause holds the auto-merge until Run queue is on.
- Setup waits with the old folder while a worker runs, shows a broken git on its steps, and adds an ignore line once.
- No commit of an empty or zero-filled task file, and the task card names it.
- The task row and card of a waiting reply name the rule that holds it, also an earlier approval and the full run; the automatic Continue says so.
- A failed check or gate keeps a copy of its output and the files it wrote, undoes the merge fully, and the card links the copy.
- The merge gate and a work run on a task branch point .claude/state/session-log at the log of that task, a refused merge puts it back, and a missing log gets a clear sentence.
- One phone page connects to several Dispatch hosts, shows the projects of each with its computer name, asks each PIN in its own box, and Projects gets Add computer and Remove.
- The worker script picks a work folder and claims it with a start record under one lock, so two starts in the same moment never share a folder.

## 0.1.99 (2026-11-25)
- The open Actions panel draws each new task list of its project at once, the poll reads that project, and an older reply cannot bring back running for an ended run.
- A show step opens the viewer with a file, a folder or the output of the step before; HTML without scripts, links open in the browser.
- A show step with an http(s) address loads the page on the host into a copy and the viewer shows it by its content type; an error answer, a load error or a page above 50 MB fails the step with the reason.
- The merge tests stop the script before its gate, so a busy computer no longer lets the script cancel the open merge before it dies.

## 0.1.98 (2026-11-25)
- Clearer texts on the three Where the work runs cards.
- A newer running run hides the old waiting state of the report row.

## 0.1.97 (2026-11-25)
- No merge before the work run reports done or while an answer waits; a new work run skips the folder of a task that waits for an answer.
- Topic group boxes are as wide as their title bar; a dragged group keeps a slot of its normal size, so its resize moves no other group.
- The host listens on 127.0.0.1 at once and adds Tailscale later; the window starts a missing host of this PC; host.log keeps each start; plainer mode and host texts.
- Sections on the Plan board: a box with a title around several topic groups; drag a group onto it to add, out of it to take out; the title bar moves it with its groups; fold button; Remove keeps the groups.
- Discuss button on each ticket card opens a Claude Code terminal with the ticket.
- The selection box catches topic groups and sections; Make a section (S) puts them into one new section; a section can hold sections and its drag moves everything inside.
- The selection box also catches tickets of the tree and of Not in the flow and comment boxes; Make a section (S) puts them into the section where they stand; a section drag moves them and saves their places.

## 0.1.96 (2026-11-24)
- The report opens on top of the Questions window; text files show in a framed window with their own scroll bar.
- Group title bars show the percentage of finished tickets.
- The voice and alerts speak when an action run ends.

## 0.1.95 (2026-11-24)
- Arrow keys step through the pictures of the gallery, the wheel zooms toward the pointer.

## 0.1.94 (2026-11-24)
- Look for a new version every 10 minutes and when Help opens; Looking line; time with seconds.
- A Pictures button in the Questions window opens the Pictures window of the task card.
- A picture path with a slash is also tried below the folders that the report names.
- One more try after a failed connection to the voice service, inside the 30-second limit.
- The Pictures window reads the real picture of a Git LFS pointer from the local LFS store.
- An approved plan that waits locks its card except Cancel approval.

## 0.1.93 (2026-11-24)
- A box for your own words on the question card and in the Questions window, Send only my words; Ctrl+V adds pictures there, in the check result box and in the plan Ask box.
- A reply that waits for a work folder, the same files or another task's branch is kept in <ticket>.reply; the task read gives it as kept, the window queues it with Take back and sends it when free; task_reply_cancel.
- A Pictures row on the task card opens the pictures that the report names; report_pictures finds each in the project, a work folder or the task branch and copies an outside one into the data folder.

## 0.1.92 (2026-11-24)
- A – button in the head of each Overview card folds it to its head bar, + opens it again; the fold is kept per project (overview-folded).
- A plan time that Dispatch writes at Approve counts as seen; no plan alert while the task starts.
- The voice says the project before the ticket title; Options switch Project name (on by default); Listen follows it.

## 0.1.91 (2026-11-24)
- The terminal panels of Focus mode get a 1px frame (var(--line)).
- The end alert of a done work run follows the state line of its report (done, failed, waiting; needs-decision stays quiet); reportState in Worker, merge-wait event.
- The natural voice waits up to 30 s for a line (the service sometimes takes 11 s; the 10 s limit sent the line to the Windows voice); error texts name the cause; live tests for each event line and the token window.
- A run that stopped at a usage limit of Claude shows a flashing "Limit stop: N" in the bottom bar (tooltip with tasks and reset text, click opens the first task card); the card says "stopped at a usage limit" with its Continue.

## 0.1.90 (2026-11-24)
- Options > Look gets a Terminal font row (five fonts), applied to all panes and kept in localStorage.
- The Plan board shows a spinner (Reading the groups…) until the groups of the project are read, then draws with its groups at once.
- The Plan board shows the run spinner in place of the dot and the state of a card in its frame; finished and failed tickets get their own frame colour; Options > Look gets Ticket colours (one colour per state, both boards, kept in localStorage).
- The work-folder bar gets a text label (Worktrees 1/2) and a clearer tooltip.

## 0.1.89 (2026-11-24)
- The worker script takes only a worker of its own project (Own-Worker: cwd is the project folder or a work folder, or no cwd); Find-Worker and the Save-Session fallback filter by it, so stop, resume, reply, approve and status never act on a worker of another project with the same ticket id; fake claude prints agents.json when present; test stop_takes_the_worker_of_its_own_project.
- The cards of the count badge window get the resize handle (looseCard: planCardGrip(key, card !== null), not scaled by the zoom; CSS position relative); a topic group box gets a corner handle (planGroupGrip: live width and height, never below its automatic size, cards stay, planGroupDragging guard, save as size in plan-groups.json; menu item Back to automatic size keeps the place); planBlocks takes a saved size per block (box width and height at least that, span counts the covered columns) and a description height function (rows at the automatic width, whole grid rows); renderPlan measures the description with a hidden element (planAboutHeight, cached), no 3-line clamp; the ticket window and its line stand on the canvas, so the pan and the zoom move and scale it (planWindowCanvas, planWindowScale, clamp and fallback in canvas px, title bar drag divided by the zoom).
- Script Worker-State returns idle unless Job-InFlight, Record-Holder holds the folder for idle; script test expects idle).
- Join_parent_group for parts without Claude).
- A click on the count pill of a topic group opens its counted tickets as cards in subgroups inside the group box (Done, Canceled, Backlog, In the tree), a second click closes them; topicBlocks keeps the ids per kind (folded), topicSubgroups gives the subgroups, planBlocks places the sub boxes under the badge on the grid (PLAN_SUB_PAD, block columns count the largest subgroup, description rows at the width without them), placeTopicBlocks and the shift move them; renderPlan draws the sub boxes, titles and cards (looseCard sub mode: click opens the ticket window only, no select, class plan-sub-card) and the title bar drag moves them; planGroupGrip counts them; planDrawWire prefers the card that is not in a subgroup; the list window of the pill is removed (user decision 1); CSS plan-sub-box, plan-sub-title, plan-fold.open.
- The tab row of a Focus column and its dividers use var(--hairline), as the project buttons do.
- A small bar after the project name shows the work folders in use (Focus head, Overview card, Map head).

## 0.1.88 (2026-11-23)
- The wheel zooms the Plan board around the pointer (planZooms, clampZoom, zoomAround; planPlaceCanvas scales the canvas and the dots; at() divides by the zoom; Centre the tree sets it back to 1); the ticket window keeps its place and size over a close and a restart (PlanFrame spot in localStorage plan-window-spot) and resizes by its corner (resize: both, ResizeObserver); a click on a count badge opens a list window (renderPlanList, plan-list-window, plan-list-spot) with the Plan cards of the counted tickets, and a click on one opens its ticket window; shared title bar planFrameHead; Help and tests updated.
- Volume slider for the voice alert (parseVolume, voiceVolume; audio.volume and utterance.volume) and 14 more English voices; tests updated.
- The pointer on a card of a parent-and-parts family dims every other card (linkedTickets, markLinked, data-family, .linking); Help and test added.
- A drag of the title bar moves a topic group on the Plan board (window pointermove from the press, translate by the zoom, snapBlockPlace on the drop, planGroupDragging guard, click after a drop swallowed); the place is kept in plan-groups.json (Rust PlanSpot/place, parsePlanGroups place); placeTopicBlocks puts dragged blocks at their place and grows the canvas, undragged blocks keep their automatic place; menu item Put back in its place; grab cursor.
- A drag of the corner handle of any Plan card sizes every card of the project (PlanCardSize, clampCardSize, parseCardSize, planSteps; planLayout, planShelf, planBlocks, groupBox, boxHits and planCentre take the size); CSS cards and list grid from the variables, taller card shows more title lines.
- Plan_describe sends tickets without a line or with a changed title in batches of 40 through rules_check::ask, sonnet, saves after each batch, reload before save; plan_descriptions_load; commands, lib and host calls); --plan-card-about-lines from the card size; CSS: a described card keeps a one-line title and the short line takes the extra lines.

## 0.1.87 (2026-11-23)
- A topic block shows its description under the title bar (new PLAN_ABOUT_HEIGHT row and PlanBlockPlace.about in planBlocks); a click on the title of a box or on the description edits it in place (planEditBox, planGroupName; Enter or blur saves, Esc cancels; renderPlan waits while a board input has focus); the side panel drops the description; ticket cards are 84 px and show the ticket title (plan-card-title); a right click on a group opens planGroupMenu with its four colours and the board items (planBoardItems); Help updated; new test of the description row.
- A right click on a topic group or group card offers New ticket in this group (Scheduled or Backlog); the ticket joins the group after Add (withTicketInGroup, addTicketGroup, planGroupMenu); Help and tests updated.
- A plain click on a ticket card of the Plan view opens a window on the board with its Tickets board card (ticketCard with the new still parameter: no drag); a line (planJoin, plan-wire) joins the card to the nearest border of the window and follows a pan (planDrawWire in planPlaceCanvas); the title bar drags the window, - folds it, x closes it (planWindow, renderPlanWindow, planOpenWindow, planCloseWindow); renderPlan and renderTickets put it back after a redraw and hold it while a text box in it has the keyboard; the board keys, pan, wheel and menu skip the window; Shift or Ctrl click only selects; Help and tests updated.
- With Work folders on, the checks and the gate run on an open merge in the work folder (Gate-InWorkFolder: HEAD on the base tip, MERGE_HEAD, MERGE_MODE and MERGE_MSG written after the checkout of the merge commit; a failure runs merge --abort; a check or gate that committed or cancelled the open merge stops the merge; after they pass HEAD moves to the merge commit before the commit of the gate files); new test a_gate_sees_an_open_merge_with_and_without_the_work_folder; the killed-merge test expects the open merge as its rest.

## 0.1.86 (2026-11-23)
- The test helpers start fewer programs: one git init and the identity written into .git/config in place of five git calls per scratch repository, and the fake claude.cmd answers agents and stop itself without Node.
- A card whose run works now (also a running merge) shows a turning green spinner beside its title.
- Setup pipeline has no Triage part and Options has no Triage chat part; Help and README follow.
- The Run queue switch changes at the click.
- Every project reads No triage as on, a saved off value too; tests follow.
- A work run that is done without its report and with nothing in flight shows failed · the work run ended without a report on the task card, the tickets board, the map and the phone, with the needs text of its state.json as the reason; the No-triage alert fires once, also for a run first seen ended; a Continue button sends Continue through the reply path of an answer, which now works without a report file.
- The 0.1.85 entry names no file and has no internal lines.
- A ticket card on the board and in the Plan view shows Folder N while its work run or merge runs in work folder N.
- An arrow to a ticket in work, and a move of a Done or Canceled ticket back while a ticket after it works, show a warning; nothing is refused.
- A look at a project reads the branch, the git folder, the refs, the merge markers, the tracked and the unmerged files from the files of git (new module gitfiles) and starts git only for the two status calls; every git start runs the real git.exe behind the launcher; tests compare each fact with git.
- Auto group in the Plan view asks Claude to sort the tickets without a topic group into topic groups with a title and a description of at most two paragraphs; a topic group stands as a block under the tree with cards for its scheduled and working tickets and one count badge for done, canceled, Backlog and tree tickets; a second run keeps the groups and titles; the side panel shows the description and all tickets of the group.
- A plan run or work run whose transcript ends with an API error of Claude Code (login, limit) shows failed · the run stopped at an error, the message and Continue on the task card, the ticket card and the phone, also after its session was stopped; a plan run keeps Plan again beside Continue; the host reads the error from the transcript tail of the newest run of its name.
- A plan run or work run at a permission prompt shows a box on its task card with the tool, the command, the description and the countdown until Claude Code refuses it by itself, and a button to the agent view; the backend reads the last prompt box from claude logs of a session that waits; the window keeps the first deadline of a prompt; the box goes away when the run no longer waits.
- The worker script reads the branch, the refs, the open merge and the worktrees from the files of git, takes one status per run for the uncommitted changes, reads the task files of two commits as tables and batches the card checkouts; a plan run starts git 0 times, an Approve of a new branch 2, a reply from the base 5 and on the branch 1; the full test run starts git 935 times from the script in place of 2431; new test the_script_starts_git_at_most_five_times_per_run with a counting stand-in git.
- An answered report stops to hide its card when the run of the reply ended and the report stayed the same; the answered record keeps the worker ids of the task from before the send, a new id is the run of the reply; reportWaits and the Report row chip use answerStands; a record of an older version stands as before.
- A plan run or work run that Claude Code marks failed shows failed · the run stopped at an error with the message of Claude Code, or The session died while it worked, at <time> for a job that the daemon found dead (reapedMidWorkAt of its state.json), and Continue on the task card, the ticket card and the phone; a failed plan run keeps Plan again beside Continue; the backend reads the error and the reaped time of the newest failed run of its name.
- The side panel of a folder with no changed tracked entry starts git once per refresh (status only, no diff HEAD --shortstat); the token events take the tag times from a cache per git folder that asks git for-each-ref only when the tag refs of the files change (new gitfiles::tag_refs and tag_dates); new tests compare the values with git and count the git starts.
- The voice says each alert in a queue with the ticket title, the project and a phrase for the event.
- Update-ref of a ref other than the checked-out branch keeps the one status of the run; a second Merge click after a moved base reads the gated commits and the first parent in one cat-file --batch-check and takes the first parent of the new merge from Build-Merge; a reply or check in the work folder skips the detach, the sync and the checkout when the branch holds its base and the folder is on it (new Sync-Needed, its merge-base answer handed to Sync-Commit); the session list is read once before the claude start and once after it (Listed-Workers in Approve-Check, Resume-Target and Session-Folder; Save-Session keeps its list for Work-Job); new test the_work_folder_runs_start_git_at_most_three_times.
- The page plays the bytes in a queue and falls back to the system voice, then the chime; Options > Alerts gets a list of six voices (default Ava multilingual) and a Listen button.
- The set-up helpers of the tests (git_scratch, git_init, action_scratch, branch_project) copy a ready git project in place of git init, Apply, add and commit; each test run builds the kinds git, applied and branch once (ready_project, a create_new lock across the nextest processes keyed by NEXTEST_RUN_ID, or the pid and start time under cargo test) under %TEMP%\dispatch-ready-<run>, and copy_tree keeps the modified and created time of each file so git sees the same stat data; a build removes ready folders older than one day; DISPATCH_TRACE_SETUP writes the git starts of each helper call and build; new tests two_copies_of_a_ready_project_share_no_file and the_set_up_of_a_test_starts_git_at_most_once.
- The worker script trusts the process id of a work folder record or a lock only when that process started before the time of the file (new Owner-Runs in Record-Holder and Lock-Holder); Windows gave the id of an ended script to a new process under the load of the test step, and Approve took work folder 2 in place of the free folder 1 (release step 1 failed on a_merge_takes_a_free_work_folder_while_a_work_run_runs); the test records and locks with a live id write the time now; new test a_record_whose_process_id_came_back_holds_no_folder and a reused-id case in measuring_runs_one_at_a_time_and_stops_a_long_command.
- Switch_lock trusts the process id of the merge lock only when that process started before the time of the lock (new lock_owner_runs, as Owner-Runs of the worker script; lock_time_ms reads the Z time of Dispatch and the offset time of the script; new info::process_started_ms with GetProcessTimes on Windows, none elsewhere); parse_ts is pub(crate); the_switch_back_holds_the_merge_lock_and_the_script_waits_for_it gets the cases of a reused id and of a live one.

## 0.1.85 (2026-11-22)
- In the Cards view each task of In work is one coloured tile with a dot and a short line; a tap on a waiting tile opens its plan, question or check result screen, and Cancel approval stays in the tile.
- The top bar of the phone home stays fixed, covers the status bar area with the page colour, and Projects scrolls the page to the top.
- The New ticket button of the phone home is filled accent blue with dark text and a plus sign.
- Auto-merge takes finished tasks in the order of their done reports, asks the work run for a new gate run once per base commit when only the fresh check failed, and the card shows the old refusal as old.
- Each phone card ends with one line 'Tickets · N scheduled · M in backlog' and a Board link that opens the Board view.
- Answers, a Confirm and a Continue wait in the queue while the checkout is on the branch of another task; the card names the wait, has Take back, and Dispatch sends the reply once when the checkout is back on the base.
- The merge commits the files that the gate wrote, a blocked switch to a task branch names the file, and a task that a refused tool call stopped asks for the permission, not a question.
- An Approve during a merge waits for the merge commit before the check of uncommitted task files, and a click or queued approval that a merge refuses waits in the queue again.
- The project switch Work folder (with Task branches) runs Approve, a reply, a resume and the checks of a task in a separate work folder of the project; the project folder stays on the base, the report goes into the project, and the task card names the wait for the folder.
- In Focus the Terminal switch hides and shows the terminal panel and the terminals keep running; the panel shows up to 4 terminals at once (+ opens one more, each has its own ×), a chat of the Chats list joins it, and the list and the hidden state hold after a restart.
- In Focus a click on the project name in the head of a column makes it a strip, or gives the layout back, with the same rules as – and ⤢.
- The amber part of Token usage is named Chats in the legend and chats in the tooltips and the biggest-user text.
- With Work folder on, Merge builds the merge commit and runs the checks and the gate in the work folder, then moves the base in one step (fast-forward, or a guarded ref update when the project folder is on another branch); the same code gets no new gate, a changed file of the user stops the move, a killed merge leaves its rest in the work folder, and auto-merge waits for a busy work folder without counting a try.
- A Scheduled ticket waits while a ticket it comes after (an arrow of the Plan view) is open or failed; other tickets still start; its card says what it waits for, the stuck sign ignores it, and the Plan view badges follow the same rule; a chat can write After: lines in its new-tickets file to link a series.
- With Work folder on, a task of the old path that waits goes on: an answer to a session that started in the project folder starts a new worker in the work folder with the plan, the report and the answer; an old task branch takes the newer commits of the base without a conflict on its task files; a newer report on an old branch reaches the base; a project folder still on the task branch gets a plain refusal for the answer and Merge; Setup pipeline, the Help and the README explain the switch.
- A task shows answered from the click that sends its answers.
- A step of a work run counts only the work; the wait for the user's answer (end of a turn to the next prompt) shows apart, e.g. "22 min (+8 h 12 min waiting)", and in the tooltip.
- A Voice alert switch says which project waits, in place of the chime.
- The merge test reads the merge file of git and counts the looks during the merge.
- Tests no longer fail on a busy computer: each upper time limit only guards a hang, a command that must outlive a wait runs longer than the wait, and the measuring test starts the second run once the first holds the lock.
- A work run that waits for the merge of other tasks says so in its report; the card names the tasks, and Dispatch sends Continue by itself when they are merged.
- A project has 1 to 4 work folders; each work run takes a free folder, a reply and a check run go into the folder of their session, a merge takes any free folder, and two tasks whose plans name the same file do not work at the same time.
- With N work folders the page starts up to N work runs; a task beyond the number waits and its card names the tasks that use the folders; a task whose plan names a file of a running task waits and its card names the file; an answer waits for the folder of its session; a merge runs beside work runs, one at a time; a start or an answer that the script refuses for a folder or the same files goes back into the queue.
- Setup pipeline shows the size of work folder 1 under the number of work folders, measured in the background when the window opens.
- A failed action run gets Run from step N; the new run copies the earlier steps with their result and time, keeps the values of the failed run, and asks first when the project got a new commit or uncommitted changes since that step started.

## 0.1.84 (2026-11-21)
- The window waits up to 15 s at start for the host of this PC before it shows the error.
- The phone page opens the Terminal of a project, starts it when none runs, and types into it.
- The host asks the phone for a PIN before any phone call, Options sets and unlocks it, the page asks again before it types.
- The phone page becomes a home with a fixed New ticket button and full screens for a plan, a question and a new ticket, with Back at the top and the buttons at the bottom; the Terminal view uses the same frame.

## 0.1.83 (2026-11-21)
- The Map shows the same token total as the task card, with the written tokens under it. Tooltips say what each number counts.
- A finished worker that still looks busy no longer stops night mode in its project.
- A change that you commit while Dispatch updates a task branch is no longer lost when the task merges.
- The rules that Dispatch writes into a project now say that night mode can approve a plan.
- Workers load only the tools they use, so each run uses fewer tokens.
- Workers start without your claude.ai connectors, such as Gmail or Slack, so a run uses fewer tokens. Your own chats keep them.
- The Terminal panel has a small left margin and less space under its title.

## 0.1.82 (2026-11-21)
- In progress card frame shows its state: flashing bold green when a run works, blue when approved.
- Setup pipeline and Options windows grow to 1120 by 820 px at most.
- Overview cards get a Setup button; the bar loses Rules and Setup pipeline there.
- No Triage parts while a project loads; a spinner until it is read.
- Controls without a look of their own get the dark look of the New ticket window.
- Terminal switch beside the tabs; each panel has its own Details switch above it.
- Running tasks first in the Tasks list and In progress; a parent that waits for its parts gets a dashed frame.
- Details band takes the height of its rows, at most a third.
- Only numbered items with options count as questions.
- Card and Questions window wait only for questions with options; a held send shows its reason.
- In progress cards hold the task card; the left panel keeps Chats behind a Chats switch, off at first.
- Phone Board view with folding ticket columns; the phone answers questions and confirms check results.
- Run queue and Night switches stand in the tab row after Chats and Terminal, explained by tooltips.
- Board columns Backlog, Scheduled, Planning, In progress, Done, Canceled; a ticket stays in Planning until Approve.
- A parent and its parts stand together inside one frame in a colour of their own on the board.
- Board column Waiting for answer between Planning and Working; In progress is now Working.
- A ticket whose plan waits for Approve stands in Waiting for answer, desktop and phone; a queued approval stands in Working.
- Each board column has Minimize, Regular and Custom width buttons and a drag edge; the width stays after a restart.
- Questions, Decisions, Commit and Check result windows show the project first in the title.
- The Decisions footer buttons line up on one top line; the hints start under them.
- A ready plan shows on the phone with its decisions, checks and work run pickers; Approve queues the start through a marker the desktop queue adopts, Reject sends the reason.
- The Plan view centres the tree, shows tickets without arrows as cards under it, moves the board by drag and wheel, and opens a right-click menu.
- Board column widths are saved per project; the old shared width is the start value.
- The test command waits for go.txt, so it still runs during the checks.
- With night mode on, a ready plan that night mode approves says so and names what it waits for; a plan it will not approve says why.
- The night-mode check of a ready plan reads the tasks unsorted, so the board no longer loops without end.
- The board trusts the running worker before the task file, so an approved ticket goes straight to Working (desktop and phone).

## 0.1.81 (2026-11-20)
- A click on a commit in the Git state window shows its full message, its changed files in the Changes list and the diff of the picked file; a merge shows its changes against the first parent; the Uncommitted changes line and a Back button show the open changes again; new read-only host commands git_commit and git_commit_diff.
- The strip above the tickets board explains both switches and refreshes on a Night click; Auto-start is now Run queue.
- A work run can stop at a check step; the task card shows the result with a box for changes and Confirm, and the answer goes to the same run; a Check result row opens the result later; new project switch Confirm check results automatically (the run does not stop, and Dispatch confirms a result that still arrives).
- Phone tab, Help and README say phone and give the Android Home Screen step.
- Phone page folds a card by a tap on its head and hides projects in a Projects list; the phone keeps both choices.

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
