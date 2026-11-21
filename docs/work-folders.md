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

- A project with the switch on has one work folder. Proposed place: `.dispatch/work/1`, ignored by git. The proof decides the place (see "Open points").
- The folder is a worktree of the project's repository: the branches and commits are shared, the files are separate.
- A set-up command of the project (one line, for example `npm ci`) runs after Dispatch makes the folder. Files that git does not track are absent until then.
- Only Dispatch and its workers write in the folder. Thus Dispatch can clean it without a question: `git merge --abort`, `git reset --hard`, `git clean -fd`. Build output that git ignores stays.
- The record of the folder names its user: the ticket, the kind of use (work run or merge) and the id of the job or process. The folder is free when that job or process has ended. A second user waits; its card says "waits for the work folder" and names the task that has it.
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

1. Dispatch takes the work folder and checks out the tip of the base without a branch (detached).
2. `git merge --no-ff task/<ticket>` makes the merge commit there. A conflict is undone, and the card lists the files. The project folder is not touched.
3. The picked checks and the gate command run in the work folder on the merge commit, in a clean tree.
4. Tracked files that the gate changed follow the decision of ticket `bug-report-from-the-project-rockhoppers`: they are committed on top of the merge commit.
5. The base moves. With the project folder on the base: `git merge --ff-only <commit>` there. Git refuses the step as a whole when a changed file of the user is a file of the merge; the card names the file, and Dispatch tries again when the change is gone. With the project folder on another branch: `git update-ref` with the old tip as the condition.
6. When the base moved since step 1, Dispatch makes the merge again on the new tip. Same code as the gated commit (the files outside `.dispatch` are equal): no new gate. Different code: the gate runs again.
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

Nobody tried these. The first task answers each with evidence and writes the answer here.

1. A real Claude Code background session that starts in a worktree: the trust question, the worker list (`claude agents --json --all`, `--cwd`), the folder of its transcript, a resume in the same folder.
2. The settings of the session: `.claude/settings.json` and `.claude/settings.local.json` of the project folder (allow rules, `worktree.bgIsolation`), also in a project where git ignores `.claude/`.
3. The write of the report into `.dispatch` of the project folder from a session in the work folder (the permission rule and the path form).
4. The place of the folder: inside `.dispatch` or next to the project folder. Path length on Windows, tools that scan the project folder, the trust rule of Claude Code.
5. Sparse checkout in a worktree with `.dispatch` tracked.
6. Files that git does not track: what a work folder needs (set-up command, local settings, Git LFS files).
7. Disk space and the first build of a large project (Unreal). The gate scripts of Starminer and Rockhoppers in another folder.
8. The mode Use hosts and a second computer.

## Tasks that follow

1. **Proof.** A scratch project, one real work run and one gated merge in a work folder; the answers to the open points in this file. No change of the app.
2. **Work run in the work folder.** A project switch (only with Task branches on, off by default): the folder with its set-up command and its record; Approve, reply, stop, resume and the checks there; the report by its full path; the card names the wait for the folder. With the switch off, every text and step is the one of today.
3. **Merge in the work folder.** The merge commit, the checks and the gate there; the one-step move of the base; "same code, no new gate"; the cleaning of a left merge; auto-merge and Push after the merge.
4. **Moving a project.** A task that waits on a branch of the old path (with card files on the branch) merges and answers with the switch on; Setup pipeline, the Help and the README say what the switch does.
5. **Removing the old path.** Only on the user's word, after this project, Starminer and Rockhoppers ran with the switch on. The user turns the switch on per project in Setup pipeline.
