# SQLiteScope 5.4.0

Documentation: https://connect2sazad.github.io/sqlitescope

SQLiteScope is a desktop SQLite database viewer, editor, and manager built with Electron and Node.js. It uses Electron's built-in SQLite engine, so Windows does not need Python, Visual Studio, C++ build tools, or a separate database server.

## Features

- Open several database files at once and switch between independent tabs
- Select multiple files in the native Open dialog or drag several files into the app
- Preserve the current table, page, filter, sorting, view, and SQL draft while switching databases
- Open, create, close, and remember SQLite database files
- Browse tables and views with pagination, sorting, and SQL filters
- Insert, edit, select, and safely delete rows
- Inspect columns, primary keys, indexes, foreign keys, triggers, and create SQL
- Run SQL queries and multi-statement scripts
- Import CSV rows into an existing table
- Export a table/view as CSV or JSON, or the full database as SQL
- Create consistent backups and run integrity checks
- Create, rename, empty, and drop tables with confirmation dialogs
- Native file dialogs, twelve installed themes, and a normal resizable app window
- Duplicate-path protection: reopening an already-open file activates its existing tab
- Detect external `.db` changes and safely refresh browse screens automatically
- Per-database query history with timestamps, timing, result summaries, load, and rerun
- SQL templates for SELECT, COUNT, INSERT, UPDATE, DELETE, and schema definitions
- Recent Databases in the native File menu
- PRAGMA inspector plus WAL checkpoint, optimize, analyze, and vacuum tools
- phpMyAdmin-style theme selection with compact/comfortable layouts
- Twelve curated themes including Classic Beauty, Windows XP, Modern Dashboard, Cyber Neon, Dracula Plum, Forest Terminal, Ocean Glass, Rose Quartz, and Retro Amber
- Convert `.sql` and `.csv` into `.db`, `.sqlite`, `.sqlite3`, or `.db3` internally
- Edit composite foreign keys, referenced columns, ON UPDATE/ON DELETE actions, and deferred constraints
- Manage CHECK constraints, STRICT tables, and WITHOUT ROWID tables
- Create and remove unique, expression, ordered, and partial indexes
- Create, edit, and drop views and triggers
- Attach/detach databases and edit safe connection PRAGMAs

Specialized features whose availability depends on the SQLite build—virtual-table modules, FTS configuration, generated columns, custom collations, and extension-specific SQL—remain available through the SQL Console. SQLiteScope does not display fake controls for operations the active SQLite runtime cannot execute.

## Run from source

Install Node.js 22 or newer, then run:

```bash
npm install
npm start
```

On Windows, double-click `Start-SQLiteScope.vbs`. Startup remains terminal-free. When dependencies need to be installed, a native progress window remains visible until installation finishes. Timestamped startup and npm diagnostics are written to `logs/sqlitescope-startup.log`; a failed setup offers to open that log immediately. Runtime logs are available from Help → Open Runtime Logs. `Start-SQLiteScope.bat` forwards to the same launcher. On Linux:

```bash
chmod +x start-sqlitescope.sh
./start-sqlitescope.sh
```

## Build installers

```bash
npm run dist:win
npm run dist:linux
```

The build command downloads the packaging tool only when you explicitly build a release; normal installation stays small and avoids its legacy transitive warnings. The Windows build produces an installer and a portable executable. Run `npm run dist:win` on Windows.

Public releases should be built on the target operating system, code-signed, malware-scanned, and tested on a clean machine. See `RELEASE-CHECKLIST.md`. Do not publish an unsigned installer under a commercial brand and then expect Windows users to trust it.

## Sample database

A ready-to-use database is included at `sample/sample-store.db`. Recreate it with `npm run sample`.

## Browse filter examples

The filter accepts a SQLite expression, not a complete `SELECT` statement:

```sql
status = 'active'
price >= 1000 AND stock > 0
name LIKE '%server%'
created_at >= date('now', '-30 days')
```

## Safety

- Back up important databases before schema changes or large updates.
- Row edits use primary keys where available and SQLite `rowid` otherwise.
- Views are browse-only for row editing, but their SQL definitions can be created, edited, or dropped.
- Destructive UI actions ask for confirmation.
- The renderer has no direct filesystem or Node.js access; database work runs through an isolated preload API.
- Every open file has a separate SQLite connection; commands always run against the active tab.
- External changes refresh automatically while browsing. During a row edit or SQL work, SQLiteScope warns and waits for a manual F5 refresh to avoid disrupting work.
- SQLiteScope contains no telemetry, advertising, cloud sync, or automatic upload.

## Support and limitations

- SQLiteScope edits SQLite files only; it is not a MySQL/PostgreSQL server client.
- Changes are committed by SQLite immediately unless your SQL explicitly opens a transaction.
- Encrypted databases require the relevant encryption extension and are not supported by this build.
- Very large result sets should be paginated or constrained in SQL; the SQL Console currently renders the returned result in memory.
- Back up production data before schema changes or bulk SQL operations.

## Structure

```text
SQLiteScope/
├── main.js
├── preload.js
├── src/database.js
├── renderer/
├── scripts/
├── tests/
├── sample/
├── PRIVACY.md
├── SECURITY.md
├── CHANGELOG.md
├── RELEASE-CHECKLIST.md
└── build/
```
