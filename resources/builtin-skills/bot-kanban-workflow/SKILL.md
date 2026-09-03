---
name: bot-kanban-workflow
description: Mandatory protocol for bots working with kanban cards — claiming unassigned cards from Backlog/To Do, confirming takeovers with the user, moving cards through In Progress → Done, reporting results or failures, and never re-picking failed cards.
enabled: true
---

# Bot Kanban Workflow Skill

This skill defines the exact lifecycle a bot must follow whenever its task involves kanban cards. Follow it without deviation — it exists to keep the board consistent and to prevent infinite retry loops.

## Identity

Your bot name is stated at the top of your task prompt (`You are @<id> (display name "...")`). The **display name** is what you write into the card `assignee` field, exactly as shown there.

## Card Lifecycle

### 1. Inspect before acting

- Always start with `list_kanban_cards` to see the current board state. Never act on assumptions from memory.
- Cards and columns are matched by name (case-insensitive) — pass the card's **exact title** and the column's **exact name**.
- Columns may be renamed on a customized board. Resolve the actual column names from the board output; the default names are `Backlog`, `To Do`, `In Progress`, `Done`.

### 2. Claiming a card (Backlog / To Do → In Progress)

A card may only be claimed if **both** hold:

- it is in the `Backlog` or `To Do` column, **and**
- its `assignee` is **empty** or already **your own display name**.

Never claim a card assigned to another bot or person — silently skip it and mention the skip in your final report.

To claim a card:

1. `update_kanban_card` — pass the card's `title` and set `assignee` to your display name.
2. `move_kanban_card` — move it to `In Progress`.

Claiming and starting are one motion: only claim work you are starting now — never park claimed cards in `Backlog`/`To Do`.

### 3. Orphaned cards (unassigned outside Backlog / To Do) — confirm with the user

A card with **no assignee** sitting in any other column (typically `In Progress`) is never adopted silently: someone may be working on it without having set the assignee, or it was abandoned mid-flight — both are the user's call, not yours.

- If that card **is not required for your task**: do nothing to it — just mention it in your final report.
- If that card **is required for your task**: call `ask_user` and ask to take it over, including the context the user needs to decide — the card title, that it is unassigned and where it sits, and, if it carries the `failed` label, its prior failure comments.
  - **Confirmed** → claim it as above (`assignee` → your display name, work it in `In Progress`).
  - **Refused or dismissed** → skip it and report that in your final result. Do not mutate the card.
- If `ask_user` is unavailable (plain module run, not a bot task), fall back to skipping and reporting.

### 4. Finishing (In Progress → Done)

When the work is complete:

1. `move_kanban_card` — move it to `Done`.
2. `add_kanban_comment` — add the result: what was done, the outcome, and the paths of anything you produced (notes, files, schedules).

### 5. Failing (In Progress → To Do)

If you cannot finish the card (error, missing information, blocking dependency):

1. `move_kanban_card` — move it back to `To Do`.
2. `add_kanban_comment` — explain what failed or what is missing, prefixed with `Attempt N failed:` (N = your attempt number, 1 for a first attempt).
3. `update_kanban_card` — pass the card's `title`, the `labels` list with `failed` appended (labels replace the whole list: include the card's existing labels) and `assignee: null` so the card is claimable again.
4. Stop working on that card. Report the failure in your final result. Never start another attempt on your own.

## Order of Precedence

1. Your task text explicitly names a card → work it as directly assigned (the failed-card retry budget below still applies).
2. Card in `Backlog` or `To Do`, unassigned or already yours → claim it.
3. Card unassigned outside `Backlog`/`To Do`, needed for the task → `ask_user` confirmation gate (section 3).
4. Anything else → skip and report.

## Anti-Loop Rules (no exceptions)

1. **Freeze**: a card in `Backlog` or `To Do` carrying the `failed` label is frozen. Never claim it on your own initiative, even if it is unassigned.
2. **One explicit retry max**: work a failed card only when your task text explicitly names it as a retry (or the user explicitly confirmed the takeover), and only if the previously documented failure cause looks resolvable by you.
3. **No second attempts**: before starting an explicitly assigned retry, read the card's comments. If a prior attempt failed for the same reason, do not retry — add a comment documenting the recurrence and report it in your final result instead.
4. After a retry fails: repeat the failure procedure above and stop. The card now waits for a human.

## General Rules

- To change an existing card, always use `update_kanban_card` — never create a duplicate card for existing work.
- Card details/body belong in `description`; use comments for progress, questions and results — never append free-form notes to the description.
- Attributes are structured key/value metadata only.
