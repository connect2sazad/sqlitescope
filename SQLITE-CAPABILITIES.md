# SQLiteScope capability matrix

## Graphical workflows

- Database files: create, open read/write or read-only, open several files, recent files, backup, attach, detach, refresh on external changes.
- Data: browse, paginate, sort, filter, insert, edit, delete, empty, CSV import, CSV/JSON/SQL export.
- Tables: create, rename, drop, transactional rebuild, STRICT, WITHOUT ROWID.
- Columns: add, rename, remove, declared type, default, primary key, AUTOINCREMENT, NOT NULL, UNIQUE.
- Constraints: composite primary keys, CHECK expressions, composite foreign keys, ON UPDATE, ON DELETE, MATCH, deferred enforcement.
- Indexes: ordinary, unique, expression, ASC/DESC, partial indexes, drop.
- Views and triggers: create, inspect, edit, drop.
- Diagnostics and maintenance: integrity check, foreign-key check during migration, WAL checkpoint, optimize, analyze, vacuum, PRAGMA inspection and safe connection settings.
- SQL: statement/script execution, results, timing, query history, templates, and direct access to the active SQLite runtime.

## SQL Console workflows

SQLite features that require free-form grammar, compiled modules, or application-defined code are intentionally handled through SQL rather than misleading fixed forms. These include virtual tables and FTS/RTree configuration, generated columns, UPSERT/RETURNING, common table expressions, window functions, savepoints, custom extension objects, application-defined functions/collations, and advanced PRAGMAs.

Availability of extension-dependent features is determined by the SQLite runtime bundled with the installed Electron version.
