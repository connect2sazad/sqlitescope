# Changelog

## 5.4.0

- Replaced remaining Overview object text actions with consistent accessible SVG icons.
- Added a persistent sidebar collapse/restore control and Ctrl+B shortcut.
- Updated documentation links to the official SQLiteScope website.
- Added copy-object-name and copy-schema workflows.
- Made duplicate-row creation generate conflict-safe values for single-column unique text fields.
- Replaced the application artwork with an original SQLiteScope database-scope mark.

## 5.3.0

- Fixed blank theme preview boxes without weakening the Content Security Policy.
- Replaced row Edit/Delete text with accessible SVG action icons.
- Added row detail viewer, duplicate-row workflow, and one-click value copying.
- Added a visible-column chooser and frozen selection/action columns.
- Added right-click cell copying and improved wide-table navigation.

## 5.2.0

- Expanded the installed gallery from six to twelve themes with Cyber Neon, Dracula Plum, Forest Terminal, Ocean Glass, Rose Quartz, and Retro Amber.
- Added full conversion support for the tested phpMyAdmin/MariaDB dump workflow, including `START TRANSACTION`.
- Folded MySQL `ALTER TABLE` primary keys and auto-increment metadata into valid SQLite table definitions.
- Converted MySQL unique and secondary keys into collision-safe SQLite indexes.
- Normalized MySQL `CURRENT_TIMESTAMP()` defaults and retained integrity validation and atomic cleanup.

## 5.1.0

- Replaced custom color editing with a phpMyAdmin-style installed-theme selector.
- Added six curated themes: Classic Beauty, Windows XP, Modern Dashboard, Midnight Code, Solarized Sand, and High Contrast.
- Added basic MySQL/phpMyAdmin SQL-dump compatibility for common session directives, quoting, data types, and table options.
- Improved SQL conversion errors and compatibility warnings.

## 5.0.0

- Removed the branded top header to increase usable database workspace height.
- Added reusable user-created color themes and comfortable/compact density settings.
- Added SQL/CSV conversion to `.db`, `.sqlite`, `.sqlite3`, and `.db3`.
- Added CSV detection, normalization, type inference, preview, transactional import, and failure cleanup.
- Added SQL conversion with integrity validation and incomplete-output cleanup.

## 4.0.0

- Added complete foreign-key editing, including composite keys, referential actions, and deferred constraints.
- Added CHECK constraints, STRICT tables, and WITHOUT ROWID table options.
- Added index design for unique, expression, ordered, and partial indexes, plus index removal.
- Added create/edit/drop workflows for views and triggers.
- Added attached-database management and editable connection PRAGMAs.
- Expanded transactional schema-migration validation and regression coverage.

## 3.1.0

- Fixed Database Tools failing with `manager.getPragmas is not a function` in multi-database workspaces.
- Added a safe table-structure editor with column add, rename, remove, type, default, primary-key, NOT NULL, and UNIQUE controls.
- Added migration SQL preview, destructive-change warnings, transactional table rebuilds, and foreign-key validation with rollback.

## 3.0.5

- Capture Electron startup output and report immediate crashes instead of failing silently.
- Ignore a machine-wide `ELECTRON_RUN_AS_NODE` setting when launching the desktop app.
- Show the main window after a safe timeout on graphics configurations that omit `ready-to-show`.
- Add detailed main-window and renderer startup diagnostics.

## 3.0.4

- Forced npm lifecycle scripts and development dependencies during first-run setup.
- Cleared environment overrides that can silently skip Electron's runtime download.
- Added an explicit Electron runtime repair when npm installs only the JavaScript package.
- Added detailed runtime-download errors to the startup log.

## 3.0.3

- Fixed a Windows PowerShell compatibility issue where `npm install` completed
  successfully but exposed a blank process exit code.
- Installation success is now determined by verifying Electron's executable and
  package metadata; a missing exit code is retained only as a diagnostic warning.
- Genuine failed or incomplete installations still produce a visible error and
  preserve the startup log.

## 3.0.2 — 2026-08-10

- Fixed a Windows launcher bug that reported a successful `npm install` as a failure with a blank exit code.
- Finalize redirected installer output before evaluating the npm process result.
- Log successful dependency installation explicitly.

## 3.0.1

- Added a native Windows installation progress window.
- Added timestamped startup, npm output, warning, and failure logging.
- Added an Open Log option when startup or installation fails.
- Added persistent runtime crash and unhandled-rejection logging.
- Fixed the silent launcher producing empty or split diagnostic logs.

## 2.0.0 — 2026-08-09

- Added simultaneous multi-database connections and switchable tabs.
- Added multiple-file selection and multiple-file drag and drop.
- Added per-database UI state for table, pagination, filter, sort, view, and SQL draft.
- Added duplicate-path detection and targeted tab closing.
- Added workspace-level integration tests.
- Added publishing, privacy, and security documentation.
- Retained the native-module-free SQLite engine introduced in 1.0.1.

## 1.0.1 — 2026-08-09

- Replaced `better-sqlite3` with Electron's built-in SQLite engine.
- Removed the Visual Studio C++, Python, and `node-gyp` installation requirement.

## 1.0.0

- Initial desktop viewer, editor, SQL console, import/export, backup, and schema management release.
## 3.0.0

- Added safe external database file monitoring and automatic browse refresh.
- Added per-database query history with load and rerun controls.
- Added phpMyAdmin-style SQL templates for SELECT, COUNT, INSERT, UPDATE and DELETE.
- Added File menu recent databases and removed the developer-oriented View menu.
- Added database PRAGMA inspection, WAL checkpoint, optimize, analyze and vacuum tools.
- Added Light, Dark, Midnight and System themes with comfortable/compact density.
- Added a hidden Windows dependency installer and launcher with native error dialogs.
