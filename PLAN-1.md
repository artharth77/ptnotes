# PLAN-1 — Project Schedule (Planner) with Calendar + AI

## Overview

Add a **Planner** feature to PTNotes: project schedules stored as JSON files, edited in a
10-column grid in the main panel, with project-level calendar config (working days +
holidays) that drives plan-date computation, plus AI tools so the assistant can manage
schedules.

## Confirmed decisions

- **File format**: JSON, one file per schedule at `<project>/planner/<slug>.json`. JSON
  cleanly represents the nested task tree, 10 columns, and computed/rolled-up fields
  (markdown tables cannot). A single shared project calendar lives at
  `<project>/planner/calendar.json`.
- **Sidebar**: new **4th tab "Planner"** (`mdiChartTimeline`) alongside Notes/Todo/Modules.
  The main editor panel is shared.
- **Parent tasks**: roll up from children — `%Complete` = duration-weighted mean,
  `planStart` = min of children, `planEnd` = max of children, `duration` = working days
  between min..max, `status` derived from the rolled-up `%`. Leaves are manual.
- **Date recompute**: keep the end date (deadline) fixed.
  - Edit **start date** → recompute `duration`.
  - Edit **duration** → recompute `end date` (`start + duration - 1`, working days).
  - Edit **end date** → recompute `duration`.
- **Calendar**: project-level config; default **Mon–Fri, no holidays** when
  `calendar.json` is absent. Working-day math applies to **plan** start/end only.
  **Actual start/end** are free-form — never computed.
- **Calendar UI**: toolbar button in the Planner editor → **CalendarModal** with
  weekday-start/end selects + a holiday date list.
- **Status rules**:
  - `On Hold` is manual only — never auto-changed.
  - `%Complete = 0` → `Not Started`
  - `0 < %Complete < 100` → `In Progress`
  - `%Complete = 100` → `Completed`
- **No. column**: derived outline number from tree position — root `1`, `2`, …;
  children `1.1`, `1.2`, …; grandchildren `1.1.1`, … Derived at render time, never stored.
- **Columns**: No. · Title · Status · Owner · Duration · Plan Start Date · Plan End Date ·
  Actual Start Date · Actual End Date · %Complete · Note.

## New / changed files

1. **`src/shared/planner.ts`** (new, pure + unit-testable — mirrors `find.ts` / `slash.ts`)
   - Types: `ScheduleStatus`, `ProjectCalendar`, `ScheduleTask`, `Schedule`, `ScheduleMeta`.
   - `deriveTaskNo(task, parentNo)` → `1`, `1.1`, `1.1.1`.
   - `defaultCalendar()`, `isWorkingDay(date, calendar)`, `isHoliday(date, holidays)`.
   - `computeEndDate(start, duration, calendar)` → skips weekends/holidays (start counts as day 1).
   - `computeDuration(start, end, calendar)` → working-day count (default 1).
   - `applyDateRule(prev, next, calendar)` → end-date-fixed recompute.
   - `deriveStatus(percent, currentStatus)` → auto except `On Hold` preserved.
   - `rollupChildren(children, calendar)` → parent `%`/dates/duration/status.
   - `validateScheduleId`.

2. **`src/shared/types.ts`** (edit) — extend `Tab` union with `'planner'`; re-export schedule/calendar types.

3. **`src/main/service/PTNotesService.ts`** (edit) — `---- Planner ----` + `---- Calendar ----` sections:
   - `plannerDir(project)` → `<project>/planner`, `schedulePath(project, id)`, `calendarPath(project)`.
   - Schedule CRUD: `listSchedules`, `readSchedule`, `saveSchedule` (atomic write+rename like `writeChat`), `createSchedule`, `renameSchedule`, `deleteSchedule`.
   - Calendar: `readCalendar` (default when absent), `saveCalendar` (atomic).
   - Ids slugified + validated with the `validateNoteId` guard.

4. **`src/main/ipc/planner.ts`** (new) — `registerPlannerIpc(service)`:
   `planner:list / read / save / create / rename / delete` + `planner:getCalendar / saveCalendar`.
   Register in `src/main/index.ts`.

5. **`src/preload/index.ts`** (edit) — `window.ptnotes.planner.*` mirroring the handlers; types flow via `PTNotesApi`.

6. **`src/renderer/src/store/useAppStore.ts`** (edit) — state `schedules`, `activeScheduleId`, `scheduleContent`, `calendar`; actions `refreshSchedules`, `selectSchedule`, `saveSchedule`, `createSchedule`, `renameSchedule`, `deleteSchedule`, `loadCalendar`, `saveCalendar`; `selectProject` loads calendar + clears active schedule; `Tab` includes `'planner'`.

7. **`src/renderer/src/components/PlannerPanel.tsx`** (new) — sidebar list following `NoteList.tsx`: `+ New`, refresh, ⋮ rename / delete-with-confirm.

8. **`src/renderer/src/components/PlannerEditor.tsx`** (new) — the 10-column grid editor:
   - Inline inputs per column; `No.` derived read-only.
   - Auto-compute on each edit via `shared/planner.ts` (status, dates, duration, rollups).
   - Row actions: add subtask (indent), add sibling, delete (with child confirmation).
   - Debounced autosave (~800ms) via `saveSchedule`.
   - Calendar toolbar button → `CalendarModal`.

9. **`src/renderer/src/components/CalendarModal.tsx`** (new) — project calendar editor modal (weekday selects + holiday list).

10. **`src/renderer/src/App.tsx`** (edit) — add `'planner'` to `SideTabs` with `mdiChartTimeline` icon; route main area to `PlannerEditor` when `tab === 'planner'` and a schedule is active; empty state otherwise.

11. **`src/renderer/src/assets/main.css`** (edit) — `.planner-panel`, `.planner-grid/table`, compact inputs, status colors, modal. Reuse `.icon-btn`, `.btn`, `.note-menu`.

12. **`src/main/ai/tools.ts`** (edit) — AI tools (all via service): `list_schedules`, `read_schedule`, `create_schedule`, `update_schedule`, `add_task`, `update_task`, `set_calendar`. Update the tool-count note in ARCHITECTURE.md.

13. **`scripts/test-planner.mts`** (new) + **package.json** — tests: task-no derivation, working-day end/duration math (weekend skip + holiday), status (incl. `On Hold`), parent rollup, service CRUD, calendar default/read/save. Add `tsx scripts/test-planner.mts` to the `test` chain.

14. **Docs**:
    - **`docs/ARCHITECTURE.md`** — on-disk layout (`planner/` + `calendar.json`), IPC surface, decisions table, source-tree diagram, tool list/count.
    - **`AGENTS.md`** — planner/calendar conventions + `planner/` folder note.
    - **`README.md`** — **Planner** feature bullet (grid editor, columns, rollup, project calendar) + Storage tree update showing `planner/`.
    - **`CHANGELOG.md`** — prepend a new `## [0.9.0]` entry (version matches `package.json`, which is already `0.9.0`) describing the feature under `### Added`.

## Security invariants (preserved)

- All planner/calendar I/O goes through IPC → main-process service; renderer never touches fs/network.
- Schedule + calendar paths validated with the note-id guard before building paths.
- No new dependencies (`mdiChartTimeline`, native date/weekday inputs from `@mdi/js`).

## Build order

shared engine → service → IPC → preload → store → UI (panel, editor, calendar modal, App, CSS) → AI tools → tests → docs (ARCHITECTURE / AGENTS / README / CHANGELOG). Run `npm run typecheck` and `npm run lint` after changes.
