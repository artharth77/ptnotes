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
- Drag & drop PDF files into the Chat panel. A `.pdf` dropped on the chat drawer is copied silently to
  `<project>/files/<slug>.pdf` (`copyPdfToProject`) with no dialog, the file list refreshes, and the
  chat input is pre-filled with `file:<filename>` so the user can reference it without sending anything
  to the AI; a chat message containing `file:<filename>` is handled by the `read_file` tool (local
  `pdf-parse` extraction). If a file with the same name already exists there with the same size and
  SHA-256 hash, the existing file is reused instead of saving a `-2` copy. Long PDFs are truncated to
  `MAX_PDF_CHARS` with a warning; scanned/image-only PDFs show a clear "No text found" message.
- Chat UI: long user messages (over 400 characters) collapse to their head with a "… Show more" button
  to expand the full text. In assistant messages, tool-call bubbles are now rendered above the
  response text. `create_note` / `update_note` tool bubbles show a clickable, truncated `📄 <note>` link
  in the header that opens the note (works while the bubble is collapsed).
- Chat file mention: typing `#` in the chat input opens the project's file picker (same behavior as
  `@` for notes). Selecting a file inserts `file:<filename>`; the AI then calls the new `read_file`
  tool to extract the PDF text locally, so previously dropped files can be referenced again without
  re-dragging and re-dropping them.

### Fixed

- Creating/renaming a note with a non-Latin title (e.g. Thai) no longer produces an "untitled" note:
  slugification now keeps Unicode letters and combining marks for all scripts, stripping only Latin
  combining accents.
- Chat now displays an error message when the AI server cannot be reached. Previously the first message in a session could fail silently: the `error` stream event could arrive after `chatStreamProject` had already been reset to `null`, so the renderer dropped it. The handler now falls back to the active project so the error is always applied to the last assistant message. See [#1](https://github.com/artharth77/ptnotes/issues/1).
- The "+ New Chat" button no longer wraps to a second line when the chat title is long: the header
  actions now stay fixed width while the title truncates with an ellipsis.
