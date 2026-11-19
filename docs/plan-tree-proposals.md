# Plan tree: proposals

You want to see the development plan of a project as a tree: its steps in order, the sub-steps under each step, where the project stands, and the open questions that are yours to decide.
Each ticket hangs under the step of the plan that it serves, so you see at a glance which step has work, which step is done, and which step has no record at all.
This file gives three ways to do it. They differ in where the plan comes from, how a ticket joins a step, and where the tree shows in Dispatch.
Each proposal has a picture in the Claude Design canvas (see "Design boards" at the end). Nothing in the app changes until you pick one; a new ticket then builds it.

All examples use one made-up project, `pantry`, a shopping-list app.

## Today

Dispatch has no plan for a whole project. A plan of Dispatch belongs to one ticket (`.dispatch/plans/<ticket-id>.md`).

- The Parts of a ticket plan become child tickets. Each one knows its parent and its number, and the board shows "2 of 4 parts done". That is one level of tree, and only for the parts of one ticket.
- The board shows the tickets in columns by state: Backlog, New, In progress, Done, Canceled. It does not show which goal a ticket serves.
- The Map view draws a tree of project → tasks → runs → agents. It shows the work that runs now, not the plan.
- The Overview shows one card per project with the tasks in work, the newest finished tasks and the tickets.
- A design doc of a project can have a plan (a numbered list, sub-items, "where it stands", "open questions"), but Dispatch does not read it.

What you miss:

- You cannot see which step of the plan a ticket belongs to.
- You cannot see a step that has no ticket and no record, such as test sessions that nobody held.
- You cannot see when work starts on a later step before an earlier step passed.
- The open questions of the plan are only in the doc.

The state of a step, in every proposal:

| Mark | State       | When                                                      |
|------|-------------|-----------------------------------------------------------|
| ●✓   | Done        | every ticket of the step is done                          |
| ◐    | In work     | a ticket of the step is in progress, or some are done     |
| ○    | Not started | the step has tickets, but none started; or a later step   |
| ◌?   | No record   | an earlier step than the current one, with no ticket at all |

## Proposal A: A plan file and a Plan view

The plan is a markdown file in the project, for example `docs/plan.md`, with a numbered list like a design doc.
Each ticket gets one new field, Step. A new view, Plan, next to Focus, Details, Map and Overview, draws the tree.

### Sketch

```
+------------------------------------------------------------------------------------+
| Focus  Details  Map  Overview  [Plan] | Project [pantry ▾]        Tickets  + Ticket |
+--------------------------------------------------------+---------------------------+
| pantry: the plan, in order   docs/plan.md   [Open][Read]| WHERE IT STANDS · 0.4.2   |
| ● Done  ◐ In work  ○ Not started  ◌ No record           | - Part 1 is done.         |
|                                                        | - Step 4 started early.   |
| > ●✓ 1 Prototype, part 1                3 of 3 done    | - Step 3 is not held.     |
| v ◐  2 Prototype, part 2       1 of 3 done · 1 in work |                           |
|   |  ●✓ Shopping list from a recipe                    | OPEN QUESTIONS            |
|   |     [shopping-list  Done]                          | - The app's name [Ask]    |
|   |  ◐  Sync between two phones                        | - Sync needs an account?  |
|   |     [sync-two-phones  Work run] [sync-conflicts New]| - Web before the beta?   |
|   |  [+ Ticket for this step]                          |                           |
| v ◌? 3 Three test sessions         no ticket · no record| TICKETS WITH NO STEP · 2 |
|   |  a tester plans a week alone; ...                  | [:: dark-theme  Backlog]  |
|   |  [+ Ticket for this step]                          | [:: crash-on-empty  Done] |
| v ◐  4 After a pass            started before step 3   |   drag onto a step        |
|   |  ◐ Accounts [accounts  Plan ready]                 |                           |
|   |  ○ A web version   ○ A closed beta                 |                           |
| > ○  5 Sync is the go/no-go point       not started    |                           |
+--------------------------------------------------------+---------------------------+
```

### What you see

- The steps of the plan in order, each with its mark and a count such as "1 of 3 done".
- Under a step: its sub-items from the file, and the tickets of the step as buttons with their state. A click opens the ticket.
- A step with no ticket and no record shows in yellow, so a forgotten step stands out.
- A step that has work while an earlier step is not done says "started before step N".
- At the right: "Where it stands", the open questions, and the tickets with no step.

### Where the plan comes from

A markdown file in the project that you write or that Claude writes for you. Dispatch reads its numbered list: a numbered item is a step, an indented item is a sub-step, a section "Where it stands" and a section "Open questions" fill the right column. The file is the truth: you change the plan in the file, and the tree follows.

### How a ticket joins a step

The ticket gets a Step field. You pick the step in the Add ticket window, or you drag a ticket from "Tickets with no step" onto a step. "+ Ticket for this step" opens the Add ticket window with the step already set. The Parts of a plan inherit the step of their parent ticket.

### What is new to build

- The Plan view (a fifth view) and its project list.
- A reader for the plan file: steps, sub-steps, the two side sections.
- The Step field on a ticket, in the Add ticket window and on the board.
- The rule that gives each step its mark from the states of its tickets.
- Drag from the side list onto a step.

### What stays

The board, the Parts of a plan, the Map and the Overview stay as they are. A project without a plan file shows a short hint in the Plan view and nothing else changes.

## Proposal B: The Parts of a ticket as a tree

No new file and no new field. One big ticket is the plan: its plan has Parts, each Part is a step, and a Part can have Parts of its own.
The Tickets window gets a second tab, Tree, next to Board.

### Sketch

```
+------------------------------------------------------------------------------------+
| Tickets of pantry   [Board] [Tree]        [x] Hide finished branches  + Ticket   x |
+--------------------------------------------------------+---------------------------+
| v PLAN pantry-prototype  [■■□□□]  1 of 5 parts done    | pantry-prototype          |
|   |  Part 1  Recipe list, search, storage     Done     |  Part 3 of 5              |
|   |  Part 2  Shopping list and sync   1 of 3  In work  | Three test sessions       |
|   |  |  2.1  shopping-list                    Done     | Level   medium            |
|   |  |  2.2  sync-two-phones   Work run       In work  | Goal    three testers ... |
|   |  |  2.3  sync-conflicts                   New      | Done when ...             |
|   |  Part 3  Three test sessions  1 question  Backlog  | OPEN QUESTION OF THE PLAN |
|   |  Part 4  After a pass: accounts, ...      Backlog  | Does sync need an account?|
|   |  Part 5  Go/no-go: does sync hold up?     Backlog  | [No: pair with a code]    |
|                                                        | [Yes: needs an account]   |
| TICKETS WITH NO PARENT · 3                             |                           |
|   accounts           Plan ready   Attach to [Part 4 ▾] | [Open the plan]           |
|   dark-theme         Backlog      Attach to [none ▾]   | [Move to New now]         |
|   crash-on-empty     Done         Attach to [none ▾]   |                           |
+--------------------------------------------------------+---------------------------+
```

### What you see

- Each ticket that has Parts is a root of the tree, with a small bar of its parts.
- Under it, its Parts in order with their state; a Part with Parts of its own opens one more level.
- Below the tree, the tickets with no parent, each with an "Attach to" list.
- At the right, the selected ticket: its Goal, Done when, and the questions of its plan that wait for you.

### Where the plan comes from

From the tickets you already have. A plan run that writes Parts makes the tree; nothing else is read. A plan from a design doc goes in only as a ticket ("make the prototype plan") whose plan run writes the Parts.

### How a ticket joins a step

Automatic for Parts: a Part already knows its parent. Any other ticket joins with "Attach to", which makes it a child of that Part.

### What is new to build

- The Tree tab in the Tickets window.
- More than one level of Parts (a Part with Parts of its own).
- "Attach to" for a ticket that has no parent.

### What stays

The Board tab, the Parts flow (Approve opens one Backlog ticket per part, the next part moves to New), and all views.

What it cannot show: a step with no ticket, sub-items that are not tickets, and a "where it stands" text. The tree only knows tickets.

## Proposal C: Claude reads the plan; the Overview shows it

Claude reads a design doc of the project on request and writes the plan tree as data for Dispatch. Claude also suggests which step each ticket belongs to, and you confirm each link.
The tree shows in each Overview card: a row of steps from left to right, with the tickets under each step.

### Sketch

```
+------------------------------------------------------------------------------------+
| Focus  Details  Map  [Overview]                                     + Add project  |
+---------------------------------------------------------------+--------------------+
| ● pantry                                   1 working   ⤡      | ● weather-kit  idle|
| PLAN  Claude read docs/design.md at 11:40  [Read the plan again]| Plan · step 3 of 4 |
|                                                               | [■■■□]             |
|  ●✓---------- ◐------------ ◌?----------- ◐------------ ○     | Now: 3 Rain alerts |
|  1 Prototype  2 Prototype   3 Test        4 After a     5 Go/ | 1 open question    |
|    part 1       part 2        sessions      pass          no-go+--------------------+
|  Done, 3      In work,      No record     Started       Not   | notes-app          |
|               1 of 3        [+ Ticket]    before 3      started| No plan yet.      |
|               [shopping   ]               [accounts           | Design doc [▾]     |
|               [sync-two   ]                suggested]         | [Make the plan]    |
|               [sync-confl ]                                   |                    |
|                                                               |                    |
| CLAUDE SUGGESTS 2 LINKS   | WHERE IT STANDS       | OPEN QUESTIONS · 4             |
| accounts → 4 [Link][Other]| Part 1 is done ...    | - The app's name ...           |
| crash → 1    [Link][Other]|                       |                                |
+---------------------------------------------------------------+--------------------+
```

### What you see

- A wide Overview card shows the steps as a row, each with its mark, its state in words, and its tickets under it.
- A normal card shows one bar of the steps, the current step and the count of open questions.
- A project without a plan shows "Make the plan" with a list of its docs.
- Under the row: the links that Claude suggests, "Where it stands" in Claude's words, and the open questions.

### Where the plan comes from

Claude reads a design doc that you pick and writes the steps, sub-steps, "where it stands" and the open questions into a data file of Dispatch for the project. "Read the plan again" runs it again when the doc changed. The doc stays the truth; the tree is a copy that Claude refreshes.

### How a ticket joins a step

Claude compares each ticket with the steps and suggests a link. You click Link to accept or Other step to change it. A suggested link shows dashed until you accept it. A new ticket made from "+ Ticket for step N" has its link at once.

### What is new to build

- A plan run of a new kind: read a doc, write the plan data and the suggested links.
- The data file of the plan per project, and the link of a ticket to a step.
- The row of steps in the wide Overview card, and the bar in the normal card.
- The "Claude suggests" box with Link and Other step.

### What stays

The board, the Parts flow and the other views. The design doc stays as you wrote it; Claude does not change it.

Cost: each "Read the plan again" is a Claude run with tokens. The tree can be out of date until you run it again.

## Compare

|                                   | Today             | A                           | B                                  | C                                    |
|-----------------------------------|-------------------|-----------------------------|------------------------------------|--------------------------------------|
| Where the plan lives              | in a doc only     | a plan file in the project  | the Parts of one ticket            | a design doc; Claude makes a copy    |
| How a ticket joins a step         | —                 | Step field, or drag         | automatic for Parts; Attach to     | Claude suggests, you confirm         |
| Where you see the tree            | —                 | a new Plan view             | a Tree tab in the Tickets window   | the Overview card                    |
| Step with no ticket ("no record") | not shown         | shown                       | not possible                       | shown                                |
| Where it stands, open questions   | in the doc        | from the file               | only questions of a ticket plan    | in Claude's words                    |
| Claude runs (tokens)              | —                 | none                        | none                               | one per read of the doc              |
| How much changes                  | —                 | medium                      | small                              | large                                |

## Recommendation

Proposal A is the recommended start.
The plan file is the one place of the truth, you can read and change it without Dispatch, and the tree needs no Claude run to stay current.
It shows a step with no ticket, which is the case that matters most: work that nobody started, or a test that nobody held.
Proposal B is the smallest change, but it only knows tickets, so a forgotten step stays invisible.
Proposal C fits best when the plan is already in a long design doc. Its "Make the plan" can come later on top of A: Claude then writes the plan file of A from the doc, and the suggested links fill the Step field.

## Design boards

The pictures are in the Claude Design canvas https://claude.ai/artifact/BJRCfN7xTxR91D4yhHkhCG, in the row "Plan tree: three ideas" under the earlier boards:

- `PlanTreeA.dc.html`: Plan tree A: a plan file and a Plan view (https://claude.ai/artifact/BJRCfN7xTxR91D4yhHkhCG#artboard-PlanTreeA)
- `PlanTreeB.dc.html`: Plan tree B: the parts of a ticket as a tree (https://claude.ai/artifact/BJRCfN7xTxR91D4yhHkhCG#artboard-PlanTreeB)
- `PlanTreeC.dc.html`: Plan tree C: Claude reads the plan, the Overview shows it (https://claude.ai/artifact/BJRCfN7xTxR91D4yhHkhCG#artboard-PlanTreeC)

The boards use the current colours of the app. The canvas is private: only its owner can open it.
