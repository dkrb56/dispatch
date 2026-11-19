# Simpler tabs in Details: proposals

Details shows many rows of tabs and switches above the terminal, and some of them look alike.
This file draws Details as it is today and gives three ways to make it simpler, from a small clean-up to a larger change.
Each proposal says what you gain, what goes away and what stays.
Focus mode stays as it is in every proposal. Nothing in the app changes until you pick one.

## Today

```
+----------------------------------------------------------------------------------+
| Focus Details Map Overview | [dispatch · This PC] [dispatch · Host 1] [:site:] + | 1
|                              Stack  Chats  Nightmode  [split][split][x][side] ⚙ ? |
+----------------------------------------------------------------------------------+
| ● dispatch  working  2 | Tickets  + Ticket  Tokens  Actions  Setup  3 old  📁 | x | 3
+------------------+---------------------------------------------------------------+
| Search chats     | Triage | Chat  Terminal | fix-login x | old-plan x | model ▾ ...| 4
| [This project]   |---------------------------------------------------------------|
| [All projects]   |                                                               | 5
|                  |   triage terminal  (or the chat whose tab you clicked)        |
| fix-login        |                                                               |
| old-plan         |---------------------------------------------------------------|
| release-notes    | Workers | Back to list | plan model ▾ effort ▾ | work ...  | 3 |
| ...              |   worker list                                                 |
+------------------+---------------------------------------------------------------+
```

The rows of tabs and switches, top to bottom:

1. The view switch: Focus, Details, Map, Overview.
2. The project pills. The open project has a blue frame. A dashed pill is a project with no open workspace; a click starts it. One folder on two computers shows as two pills ("dispatch · This PC" and "dispatch · Host 1").
3. The head row of the open project: its dot, name and state, then Tickets, + Ticket, Tokens, Actions, Setup, N old, the folder button, and × that closes the workspace (not the project).
4. The head of the triage pane: Chat / Terminal, then one tab for each chat you opened, then the model, effort and "new chat at" lists. A chat tab takes the place of the triage terminal while it shows.
5. The Chats panel at the left: search, the switch This project / All projects, and the chat list. A click on a chat there adds one more tab in row 4.

The Workers pane has its own head as well: Back to list and five lists for models and effort.

What makes it confusing:

- Rows 2, 3 and 4 all look like tabs, but each one switches a different thing: the project, the project's tools, and the chat.
- The same chat shows in two places: in the Chats list and as a tab in the triage head.
- One folder on two computers looks like two different projects.
- The project buttons fill the head row, so the few you use often are hard to find.

## Proposal A: Clean up the rows you have

The rows stay where they are, but each row gets fewer and clearer items.

### Sketch

```
+----------------------------------------------------------------------------------+
| Focus Details Map Overview | [dispatch ▣2] [:site:] +    Stack  Chats  Nightmode ⚙ ? |
+----------------------------------------------------------------------------------+
| ● dispatch  working  2  [This PC | Host 1] | Tickets  + Ticket  ⋯ | Chats (2) ▾ | x |
+------------------+---------------------------------------------------------------+
| Search chats     | Triage | Chat  Terminal | model ▾  effort ▾  new chat at ▾      |
| [This project]   |---------------------------------------------------------------|
| [All projects]   |                                                               |
|                  |   triage terminal                                             |
| fix-login        |                                                               |
| old-plan         |---------------------------------------------------------------|
| ...              | Workers | Back to list | ...                                   |
+------------------+---------------------------------------------------------------+

  Chats (2) ▾ opens:   +---------------------+
                       | fix-login         x |
                       | old-plan          x |
                       | Back to triage      |
                       +---------------------+
```

### What changes for you

- One pill for each folder. A small mark (▣2) says that the folder is on two computers.
- You switch the computer in the head row with This PC | Host 1.
- The open chats leave the triage head. They are in one menu "Chats (N) ▾" at the end of the head row.
- Tokens, Actions, Setup, N old and the folder button go into the ⋯ menu. Tickets and + Ticket stay in view.

### What goes away

- The second pill for the same folder.
- The chat tabs in the triage head.
- Five buttons from the head row (they move into ⋯).

### What stays

- The four rows, the Chats panel and its switch This project / All projects.
- Chat / Terminal in the triage head, and the Workers head.
- Focus mode stays exactly as it is.

Size: the project pills, the head row of a project, and the triage head.

## Proposal B: One row of tabs for each project

The head row of the open project becomes its only row of tabs. The workspace and each open chat are tabs side by side in that row.

### Sketch

```
+----------------------------------------------------------------------------------+
| Focus Details Map Overview | [dispatch] [:site:] +       Stack  Chats  Nightmode ⚙ ? |
+----------------------------------------------------------------------------------+
| ● dispatch working | [Workspace] | fix-login x | old-plan x |     Tickets + Ticket ⋯ |
+------------------+---------------------------------------------------------------+
| Search chats     | Triage | Chat  Terminal | model ▾  effort ▾  new chat at ▾      |
| [This project]   |---------------------------------------------------------------|
| [All projects]   |   triage terminal                                             |
|                  |---------------------------------------------------------------|
| fix-login        | Workers | Back to list | ...                                   |
| old-plan         |   worker list                                                 |
+------------------+---------------------------------------------------------------+

  After a click on the tab "fix-login":

| ● dispatch working |  Workspace  | [fix-login x] | old-plan x |   Tickets + Ticket ⋯ |
+------------------+---------------------------------------------------------------+
| Search chats     |                                                               |
| ...              |   the chat fix-login, full width (triage and workers hidden)  |
+------------------+---------------------------------------------------------------+
```

### What changes for you

- All tabs of a project are in one row: Workspace first, then one tab for each open chat.
- A chat opens at full width in place of the workspace. A click on Workspace brings triage and the workers back.
- A click on a chat in the Chats list opens its tab in this row, or shows its tab when it is already open.
- The computer of a project is a small mark on its pill, as in Proposal A.
- Tokens, Actions, Setup, N old and the folder button go into the ⋯ menu.

### What goes away

- The chat tabs in the triage head; the triage head keeps only Chat / Terminal and its lists.
- The second pill for the same folder.
- Five buttons from the head row (they move into ⋯).

### What stays

- The project pills, the Chats panel and its switch This project / All projects.
- Chat / Terminal inside the triage pane, and the Workers head.
- Focus mode stays exactly as it is.

Size: the head row of a project, how a chat opens in Details, the triage head and the project pills.

## Proposal C: One side list for projects and chats

The project pills leave the bar in Details. The Chats panel at the left becomes one list of projects, and under the open project you see its triage, its workers and its open chats.

### Sketch

```
+----------------------------------------------------------------------------------+
| Focus Details Map Overview |                         Stack  Nightmode  ⚙  ?      |
+----------------------------------------------------------------------------------+
| ● dispatch  working  2                         Tickets  + Ticket  ⋯  |  x        |
+--------------------------+-------------------------------------------------------+
| Search                   |                                                       |
| ▾ ● dispatch      This PC|   Triage | Chat  Terminal | model ▾ effort ▾ ...      |
|     Triage               |   ------------------------------------------------    |
|     Workers  (2)         |                                                       |
|     fix-login         x  |   the item you clicked in the list:                   |
|     old-plan          x  |   triage, the workers, a chat or a terminal           |
|     + chat               |                                                       |
| ▸ ● dispatch      Host 1 |                                                       |
| ▸ ○ site                 |                                                       |
| + Add project            |                                                       |
+--------------------------+-------------------------------------------------------+
```

### What changes for you

- One list at the left holds everything: each project is a row, and the open project unfolds.
- Under the open project: Triage, Workers, each open chat and each terminal. A click shows that item in the main area.
- A project on two computers shows as two rows with the computer name at the right, so it does not look like two projects.
- A project with no workspace has a hollow dot (○); a click starts it.
- Search at the top of the list finds chats in all projects.

### What goes away

- The project pills in the bar (in Details only).
- The chat tabs in the triage head.
- The switch This project / All projects; the list always shows all projects, and the open one unfolds.
- The Chats button in the bar; the list is always there in Details.

### What stays

- The view switch, the head row of the open project, and Chat / Terminal in the triage pane.
- Tickets and + Ticket in the head row.
- Focus mode stays exactly as it is, with its own pills.

Size: the bar in Details, the Chats panel, the head row of a project, the triage head, and how Details shows a chat or a terminal.

## Compare

|                                     | Today                        | A                       | B                       | C                       |
|-------------------------------------|------------------------------|-------------------------|-------------------------|-------------------------|
| Rows of tabs above the terminal     | 3 (pills, head, triage head) | 3, with fewer items     | 2 (pills, one tab row)  | 1 (head row)            |
| Where a chat opens                  | tab in the triage head       | menu "Chats (N)"        | tab in the head row, full width | item in the side list |
| How you switch project              | pill in the bar              | pill in the bar         | pill in the bar         | row in the side list    |
| How much changes                    | —                            | small                   | medium                  | large                   |

## Recommendation

Proposal B is the recommended start.
It gives each project one row of tabs, so you always know where a chat is: in the row, next to Workspace.
It fixes the duplicate tabs that started this request, and it keeps the pills and the Chats list that you know.
Proposal A is safer but keeps the chats hidden in a menu, which is one more click each time.
Proposal C is the cleanest, but it changes how you move between projects; you can take it as a later step after B.
