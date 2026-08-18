# PLAN_GOAL3 — Redesign AI Trace Dialog

The dialog is currently `TraceViewerModal.tsx`, a raw JSON dump. Redesign it into a 3-panel
interactive trace browser.

## Layout & Sizing

- Make the modal **90% of the main window's width and height**. The `Modal` component uses fixed
  percentages of the viewport; set CSS `width: 90vw; max-width: none; height: 90vh` and make
  `.modal-body` `display: flex; flex-direction: column; flex: 1; min-height: 0`.
- 3 panels inside `.modal-body`:
  1. **Top** — timeline (fixed height, flex-none).
  2. **Middle** — a flex row containing **left** (item list) + **right** (detail).
  3. Right = `flex: 1`, left = fixed width (e.g. 280px).

## Timeline (top panel)

- 3 stacked rows: **Prompts** (system + user), **Assistance** (assistant), **Tools** (tool results).
- Assign each trace entry to a row: system/user → Prompts, assistant → Assistance, tool → Tools.
  Assistant `toolCalls` belong to the assistance row (they are part of the assistant record).
- Each row is a horizontal, **left-to-right scrollable** flex container of colored boxes — one box
  per entry in that row. Box shows a short label (role / tool name) and uses a **role-color reference**.
- Boxes are clickable; the selected box gets a highlight ring.
- Clicking a box selects the entry and syncs selection to list + detail.

Role-color reference (shared across timeline boxes and list tags):
- system = dim/neutral
- user = accent-blue
- assistant = green
- tool = orange

## Left panel (item list)

- One row per trace entry, chronologically ordered.
- Each row shows a **role label tag** — a colored, all-caps tag (`SYSTEM`, `USER`, `ASSISTANT`,
  `TOOL`) whose background/border color carries the role-color reference (no separate dot).
- After the tag, a one-line truncated preview of the entry content (or tool name) with
  `text-overflow: ellipsis; overflow: hidden; white-space: nowrap`.
- Clicking selects and syncs to timeline + detail; selected row highlighted.
- Scrollable.

## Right panel (detail)

- Shows the **selected** trace item in human-readable form (not raw JSON).
- Rendered per role:
  - **system / user**: role label + timestamp + content (whitespace preserved). Include `file`
    attachment name if present.
  - **assistant**: model/baseUrl, duration, finishReason, content, and any `reasoning` in a
    collapsible/separate block; list `toolCalls` (name + args).
  - **tool**: tool `name`, `toolCallId`, duration, and content result.
  - Show `error`, `usage`, and timing (`ts`, `durationMs`) where present.
- Scrollable; empty state when no selection.

## Files to change

1. `src/renderer/src/components/TraceViewerModal.tsx` — rewrite content rendering into the 3-panel
   layout; add selection state (`selectedSeq`); add helper to bucket entries into rows; render
   timeline, list, and readable detail. Keep existing load/error/meta logic and the
   "Reveal in Finder" / "Copy JSON" actions (relocate into header/meta row).
2. `src/renderer/src/assets/main.css` — replace the `.trace-modal`, `.trace-meta`, `.trace-json`
   block (lines 3103-3151) with new CSS: 90% sizing, panel grid, timeline rows + boxes + role
   colors, list truncation, role tag styling, detail styling.

## Notes / decisions

- No new dependencies; plain CSS + existing `Modal` component.
- Role colors use existing theme vars (`--accent`, `--danger`, `--bg-hover`, etc.) via semantic
  classes so light/dark themes work.
- Timeline boxes only render when entries exist; the existing "No AI exchanges" empty state remains.

## Verification

- Run `npm run typecheck` and `npm run lint` after changes.
- Manual: open a chat/module with a multi-turn trace, confirm 90% sizing, 3-row timeline scrolling
  left→right, click-sync across timeline/list/detail, truncated list rows with role tags, and
  readable detail for all role types.