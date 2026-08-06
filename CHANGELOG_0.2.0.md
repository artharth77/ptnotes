# Changelog 0.2.0

## [0.2.0] — 2026-08-06

### Added

- Settings dialog redesign: the standalone *AI Settings* dialog is replaced by a two-panel **Settings**
  dialog with a **Storage** category and an **AI Settings** category.
- Configurable project root: the **Storage** category lets the user change the folder where all
  projects live (default `~/Documents/PTNotes`). Changing it shows an explicit confirmation and moves
  every project folder, `TODO.md`, `notes/`, `chat/` and the project registry (`.ptnotes-projects.json`)
  to the new location, then persists the root in `userData/ptnotes-settings.json` (chmod 600) via a new
  `SettingsStore`.

### Fixed

- Chat now displays an error message when the AI server cannot be reached. Previously the first message in a session could fail silently: the `error` stream event could arrive after `chatStreamProject` had already been reset to `null`, so the renderer dropped it. The handler now falls back to the active project so the error is always applied to the last assistant message. See [#1](https://github.com/artharth77/ptnotes/issues/1).
