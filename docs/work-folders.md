# Work folders: Dispatch never switches or merges in the project folder

Design written 2026-11-21, after the user's question why the merge fixes do not hold. The user agreed to the five rules the same day. No code change comes with this file. Each task in "Tasks that follow" gets its own brief and plan.

## The problem and the result

With Task branches on, one project folder does four jobs at once, and Dispatch switches it between them by guesses. Each fix closed one order of events, and the next feature opened a new one: 15 fixes in 9 days, 2 more open on 2026-11-21. The result of this design: the project folder stays on the base branch, a work run and a merge happen in a folder that only Dispatch uses, and the base moves in one step or not at all.

## What happens today

The project folder (the main checkout) is at the same time:

1. the work place of the user, with uncommitted changes,
2. the work place of the work run, on `task/<ticket>`,
3. the place of the merge and the gate: `git merge --no-commit`, then the gate for up to hours, then the commit,
4. the store of the card files in `.dispatch`.

Dispatch moves the folder between these jobs with `git checkout`, and decides when by file times, the git reflog and the worker list.

| Cause | Tickets that it produced |
|---|---|
| The folder switches between the base and task branches | `merge-issue`, `local-only-deletes-task-files`, `leftover-files-block-tasks`, `task-branches-blocked-work`, `title-approve-now-its-work-run-starts`, `an-answer-waits-in-the-queue-while`, problem 2 of `bug-report-from-the-project-rockhoppers` |
| The merge stays open in the folder while the gate runs | `title-auto-merge-left-the-main-checkout`, `approve-during-a-merge-is-refused-by-the`, the gate line that left the base changed |
| Card files exist on two branches | `stale-report-loop` (two fixes), `tickets-in-git`, the conflict marks of `board-in-progress` |
| The state is a guess from file times and the reflog | `branch-switch-on-reply`, `stale-report-loop` |
| The base moves under a branch that waits | `bringing-main-into-a-task-branch-can`, `auto-merge-keep-finish-order-and-re-gate` |

Cases of the same kind that are in the code and have no ticket yet:

- `Start-Plan` runs in the project folder on any branch. A plan run that starts during a work run reads the half-done code of that task.
- `Resume-Run` calls `Task-Leftovers -Plan` before `Enter-TaskBranch` waits for the merge lock, as `approve` did.

A project with Task branches off has none of these problems, and no gate before the code reaches the base.

## The five rules

1. **The project folder stays on the base branch.** Dispatch runs no `git checkout` of a branch and no `git merge` of a task there. The only change is one fast-forward.
2. **A work run works in a work folder of Dispatch.** A work folder is a git worktree that Dispatch makes once, keeps and uses again, so the build output stays.
3. **The merge is made and gated in the work folder, as a finished commit.** The base then moves to that commit in one step, or not at all.
4. **Card files exist one time, in `.dispatch` of the project folder.** No task branch changes them, and a work folder holds no copy.
5. **Dispatch writes who uses a work folder into a record.** It does not read the state from file times or the reflog.

The user's decisions of 2026-11-21: the five rules; one work folder at the start; the two open fixes of the old path finish, and after them the old path gets fixes only for data loss.

## How each step works

### The work folder

- A project with the switch on has one work folder. Place: `.dispatch/work/1`, ignored by git (the line `work/` in `.dispatch/.gitignore` when the project tracks `.dispatch`). The proof of 2026-11-21 chose it, because Claude Code trusts it through the project folder and the page already counts a worker there as a worker of the project.
- The folder is a worktree of the project's repository: the branches and commits are shared, the files are separate.
- A set-up command of the project (one line, for example `npm ci`) runs after Dispatch makes the folder. Files that git does not track are absent until then.
- Only Dispatch and its workers write in the folder. Thus Dispatch can clean it without a question: `git merge --abort`, `git reset --hard`, `git clean -fd`. Build output that git ignores stays.
- The record of the folder names its user: the ticket, the kind of use (work run or merge) and the id of the job or process. The folder is free when that job or process has ended. A second user waits; its card says "waits for the work folder" and names the task that has it.
- The switch: `workFolders` in `.dispatch/options.json`, "Work folder" under Task branches in Setup pipeline. It works only with Task branches on.
- The set-up command: `.dispatch/work-setup.txt`, one command line; a first line `# limit <seconds>` sets its time limit (default 3600).
- The record: `.dispatch/work/1.record`, with the lines `ticket:`, `use:` (`work`, `check` or `merge`), `pid:`, `job:` and `since:`.
- The set-up log: `.dispatch/work/1-setup.log`.
- The design holds for more than one folder. More folders permit parallel work runs later; each costs disk space and one first build.

### Plan run

- As today, in the project folder, read-only. The folder is always on the base, so a plan run always reads the base.

### Approve and the work run

- Dispatch takes the work folder and checks out `task/<ticket>` there. A new branch starts from the tip of the base. An existing branch takes the newer commits of the base with a plain `git merge` in the work folder; a conflict is undone and the prompt tells the worker.
- The worker starts with the work folder as its folder. The prompt names the brief, the plan and the report by their full paths in `.dispatch` of the project folder.
- The work run sees only committed work of the base. An uncommitted change of the user in the project folder holds no Approve and no Reply.
- At the end of the run, Dispatch commits what the run left uncommitted in the work folder as `<ticket> WIP`. Every file there is a file of the run, so no time rule is needed. The folder is then free.

### Question, reply, stop, resume, checks

- A reply takes the work folder again, checks out the task branch and resumes the session in the same folder.
- The checks of a task (`check <ticket>`) run in the work folder on the task branch. The full run of all checks runs in the project folder, which is always on the base.

### Merge

1. Dispatch takes the work folder and checks out the tip of the base without a branch (detached). While a work run or a check run of another task has the folder, the merge waits up to a minute, then the card names that task ("the work folder of this project is in use (task <name>)"). That refusal is no try of auto-merge: the card says that auto-merge waits for the work folder, and auto-merge tries again by itself when the folder is free.
2. The merge commit is built as a finished commit, with no index of a folder: the tree of `git merge-tree --write-tree <tip> task/<ticket>`, with `.dispatch` as the tip of the base has it, and a commit with the tip and the branch as parents (as `git merge --no-ff` makes it). The work folder then checks it out. A conflict outside `.dispatch` makes no commit, and the card lists the files. The project folder is not touched.
3. The picked checks and the gate command run in the work folder on the merge commit, in a clean tree.
4. Tracked files that the gate changed follow the decision of ticket `bug-report-from-the-project-rockhoppers`: they are committed on top of the merge commit.
5. The base moves. With the project folder on the base: `git merge --ff-only <commit>` there. Git refuses the step as a whole when a changed file of the user is a file of the merge; the card names the file ("these uncommitted files of the project folder would be overwritten by the merge; commit, stash or undo them, then click Merge again: <paths>"), and the base stays as it was. With the project folder on another branch: `git update-ref` with the old tip as the condition.
6. When the base moved since step 1, Dispatch makes the merge again on the new tip, up to three times. Same code as the gated commit (the files outside `.dispatch` are equal): no new gate, and the commit of the gate files is picked onto the new merge. Different code: the gate runs again. The file `.dispatch/merge/<ticket>.gated` remembers the gated merge (the merge commit, the commit of the gate files or `-`, and the tip of the task branch), so a later Merge of the same code, for example after a stopped step 5, runs no new gate either.
7. The branch file gets `merge: done`, the branch goes, and Push after the merge works as today.

A killed merge leaves its rest in the work folder only. The next user of the folder cleans it.

Proved in a scratch repository on 2026-11-21 (git only, no Claude Code): the merge commit was made in the worktree; the main folder had no `MERGE_HEAD` at any time; a gate line in a tracked file stayed in the worktree; a changed file of the merge in the main folder made `git merge --ff-only` exit with 1 and changed nothing; a changed file outside the merge stayed and the step passed.

### Card files

- The worker writes its report and its log into `.dispatch` of the project folder, by the full path.
- The work folder has no `.dispatch` on the disk (sparse checkout) when git tracks the folder.
- A task branch does not change `.dispatch`, so a merge takes the base side of each card file without a conflict. A card file that a worker committed by mistake is dropped at the merge.
- Dispatch commits card files on the base in the project folder, as today. The folder is always on the base, so such a commit cannot land on a task branch.

## What goes away

When every project uses work folders (the last task below):

- Worker script: the checkout in `Enter-TaskBranch`, `Set-CardFilesAside`, `Put-CardFiles`, `Align-Tasks`, the `.dispatch` tree steps of `Sync-Base`, `Task-Leftovers`, `Own-Changes`, the side choice for card files in `Merge-Branch`, the marker `merge\open`.
- Rust: `return_to_base`, `switch_lock`, `set_card_changes_aside`, `put_card_changes_back`, `report_from_branch`, `checkout_wrote_report`, `cancel_left_merge`, `repair_conflicts`, `untrack_tasks_at`.
- Page: the queue for "the checkout is on the branch of another task". Its place takes one wait: the work folder is in use.

## What stays

- The two runs, the plan, Approve, the questions, the report and its header.
- The branch `task/<ticket>`, the branch file, the gate command, the picked checks, auto-merge in the order of the done reports, Push after the merge, the detection of a merge outside Dispatch.
- One work run per project at a time, while the project has one work folder.
- A project with Task branches off works as today.

## Open points to prove first

Proved on 2026-11-21 by ticket `work-folders-prove-a-work-run-and-a` (Claude Code 2.1.319, git 2.53.0, Windows 11). The script `.dispatch/proof/work-folders-prove-a-work-run-and-a/proof.ps1` builds a scratch project at `src-tauri/target/compact-prompt-proof/proj`, starts real haiku background sessions with the options of `work-flags.txt` in the work folders `.dispatch/work/1` and `/2`, and makes the merges. Its result lines are in `result.txt` next to the script; the names in "Evidence" are the names of these lines. The script and its results stay on this computer, because this repository ignores `.dispatch/`.

1. A real Claude Code background session that starts in a worktree: the trust question, the worker list (`claude agents --json --all`, `--cwd`), the folder of its transcript, a resume in the same folder.
- Answer: It works. The session starts with no trust question, because the work folder is inside a trusted project folder; Claude Code writes no trust record of its own for it. `claude agents --json --all` lists it with `cwd` = the work folder, and `--cwd <project>` lists it too. The transcript folder is named after the work folder; Dispatch finds the file by its session id, as today. A finished session keeps its process (state `done`, status `idle`), so a resume starts a copy with a new job id and a new session id in the same folder; the worker script must take the id after `backgrounded ·`, because the note before it names the original. The living process holds the folder: `git worktree remove` fails while it lives, but checkouts, merges and commits in the folder work.
- Evidence: `case A trust`, `case A worker list`, `agents --cwd` (17 of 813 sessions, the work folder session in them), `case A transcript` (folder `D--dev-projects-dispatch-src-tauri-target-compact-prompt-proof-proj--dispatch-work-1`), `resume` (claude printed "session … is already running in the background, so this started a copy as …"), `resume in the same folder` (commit `t-1-second` on `task/t-1`), `work folder removal while a finished session lives` (exit 255, "Permission denied"); the merges ran in `.dispatch/work/1` while these processes lived.
2. The settings of the session: `.claude/settings.json` and `.claude/settings.local.json` of the project folder (allow rules, `worktree.bgIsolation`), also in a project where git ignores `.claude/`.
- Answer: A session reads `.claude/` of its start folder, the work folder, not of the project folder. Where git tracks `.claude/`, the work folder has a copy and the rules of the project hold. Where git ignores `.claude/`, the work folder has no rules; the normal case on this computer, because the global git ignore file ignores `**/.claude/settings.local.json`. A second `--settings <project>/.claude/settings.local.json` gives the rules back. The session stayed in the work folder in both cases, also with no `worktree.bgIsolation` in the work folder or in the user settings.
- Evidence: `case A rules of the project` (the deny rule refused `echo deny-probe`), `case B without help` (`echo deny-probe` ran), `case B rules by a second --settings` (refused again), `global ignore` (`C:\Users\dani/.config/git/ignore` line 3), the `cwd` of `case B worker entry`.
3. The write of the report into `.dispatch` of the project folder from a session in the work folder (the permission rule and the path form).
- Answer: It works with the full path, for example `D:\…\proj\.dispatch\t-1.md`. The rule form is `Edit(//d/<project path>/.dispatch/**)`. With `--permission-mode auto` of the work run, the write passed also without that rule; the rule is needed only in a mode that asks or refuses, such as `dontAsk`.
- Evidence: `case A report into the project .dispatch` (ALLOWED with the rule), `case B calls` (report write ALLOWED with no rule of the project), the four header lines in the report file of each case.
4. The place of the folder: inside `.dispatch` or next to the project folder. Path length on Windows, tools that scan the project folder, the trust rule of Claude Code.
- Answer: `.dispatch/work/1` works and is the place. It adds 17 characters to each path; the longest tracked path of this repository becomes 86 characters, far below 260. A project that tracks `.dispatch` needs the line `work/` in `.dispatch/.gitignore`, else `git status` of the project lists the folder. Trust comes from the project folder. The page joins the worker to the project by its folder prefix, but the backend (`Project::find`, `git rev-parse --show-toplevel`) gives the work folder as the root, so Dispatch must map a work folder to its project. The place next to the project folder was not tried (user decision 2 of the plan).
- Evidence: `path length in the work folder`, `this repository` (longest tracked path), `work folder ignore line` (`?? .dispatch/work/` without the line), `case A trust`, `case A joins the project by folder prefix`, `work folder roots`.
5. Sparse checkout in a worktree with `.dispatch` tracked.
- Answer: It works with `git sparse-checkout set --no-cone '/*' '!/.dispatch/'` in the work folder. The work folder has no `.dispatch` on the disk, `git status` there is clean, and a card commit on the base merges into the task branch without a conflict. The project folder keeps its full `.dispatch`.
- Evidence: `sparse checkout`, `sparse checkout and a card commit`, `case A report into the project .dispatch` (the project `.dispatch` is still there).
6. Files that git does not track: what a work folder needs (set-up command, local settings, Git LFS files).
- Answer: A new work folder has no ignored file: no dependencies, no local settings, no `.claude/settings.local.json` (see point 2). The set-up command makes the first ones; the local settings of Claude Code go in by `--settings`. Git LFS files arrive with their real content, because the LFS store is shared through the common `.git`.
- Evidence: `ignored files in a new work folder`, `Git LFS file in the work folder` (200 bytes, not the pointer), `this repository` (`node_modules` 86 MB in 820 files, made by `npm ci`).
7. Disk space and the first build of a large project (Unreal). The gate scripts of Starminer and Rockhoppers in another folder.
- Answer: Not run here, because no large project is in this checkout. This repository shows the size: a work folder builds `src-tauri/target/debug` (22.7 GB) and `release` (3.3 GB) once again, so it needs about as much free space as the project folder has build output. The scratch gate ran in the work folder with `DISPATCH_TICKET` and `DISPATCH_CHECKS`, its line was committed on top of the merge commit and reached the base. Trap: a shell of Claude Code has `NoDefaultCurrentDirectoryInExePath=1`, so `cmd /c gate.cmd` does not find a gate in the current folder; call it as `.\gate.cmd` or by its full path.
- Evidence: `this repository` (debug and release lines), `merge and gate in the work folder`, `base moved` (GATE.txt holds "gate t-1 passed checks [none]"), the first run of the script ("'gate.cmd' is not recognized").
8. The mode Use hosts and a second computer.
- Answer: A work folder belongs to one computer. A clone has no work folder, and the `.git` file of a work folder holds an absolute path, so the folder cannot move to another computer. By reasoning, not by a run: each computer that runs work runs makes its own work folder, and the record of the folder names that computer. The mode Use hosts was not run.
- Evidence: `second computer` (the clone lists 1 worktree), `work folder .git file` (`gitdir: D:/…/proj/.git/worktrees/1`).

The merge steps 1 to 5 ran again with real work runs: `project folder` (MERGE_HEAD seen 0 times during the merge), `base moved`, `failed gate` (nothing outside the work folder changed), `blocked fast-forward` (exit 1, HEAD and file unchanged), `change outside the merge` (passed, change kept) and `base on another branch` (`update-ref` with a wrong old tip refused, with the right one passed).

Still untried:

- Unreal or another large build in a work folder, and the time of its first build.
- The gate scripts of Starminer and Rockhoppers in a work folder.
- The mode Use hosts, and a second computer at run time.
- The place next to the project folder.
- Tools that scan the project folder (file watchers, search tools, editors) with a work folder inside it.
- Whether a second `--settings` replaces or adds to the first; the proof showed only that the rules of the second hold.
- The Merge button and auto-merge of the running app with the switch on, also while another task has the work folder; the tests call the same backend command.
- A project folder or a work folder that Claude Code does not trust.

## Tasks that follow

1. **Proof.** A scratch project, one real work run and one gated merge in a work folder; the answers to the open points in this file. No change of the app.
2. **Work run in the work folder** (ticket work-run-in-the-work-folder, 2026-11-21). A project switch (only with Task branches on, off by default): the folder with its set-up command and its record; Approve, reply, stop, resume and the checks there; the report by its full path; the card names the wait for the folder. With the switch off, every text and step is the one of today.
3. **Merge in the work folder** (ticket merge-in-the-work-folder, 2026-11-22). The merge commit, the checks and the gate there; the one-step move of the base; "same code, no new gate"; the cleaning of a left merge; auto-merge and Push after the merge.
4. **Moving a project.** A task that waits on a branch of the old path (with card files on the branch) merges and answers with the switch on; Setup pipeline, the Help and the README say what the switch does.
5. **Removing the old path.** Only on the user's word, after this project, Starminer and Rockhoppers ran with the switch on. The user turns the switch on per project in Setup pipeline.
