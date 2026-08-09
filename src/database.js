const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const q = (identifier) => `"${String(identifier).replace(/"/g, '""')}"`;

function serializeValue(value) {
  if (Buffer.isBuffer(value)) return { __type: 'blob', size: value.length, base64: value.toString('base64') };
  if (typeof value === 'bigint') return { __type: 'bigint', value: value.toString() };
  return value;
}

function serializeRows(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serializeValue(value)])));
}

function coerce(value, declaredType = '') {
  if (value && typeof value === 'object' && value.__type === 'null') return null;
  if (value && typeof value === 'object' && value.__type === 'blob') return Buffer.from(value.base64 || '', 'base64');
  if (value === null || value === undefined) return null;
  const type = declaredType.toUpperCase();
  if (type.includes('INT')) {
    if (value === '') return null;
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : String(value);
  }
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB') || type.includes('NUM') || type.includes('DEC')) {
    if (value === '') return null;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  }
  return value;
}

class DatabaseManager {
  constructor() {
    this.db = null;
    this.filePath = null;
    this.readonly = false;
  }

  requireOpen() {
    if (!this.db) throw new Error('No database is open.');
  }

  open(filePath, options = {}) {
    if (!filePath || typeof filePath !== 'string') throw new Error('Choose a valid database file.');
    const resolved = path.resolve(filePath);
    if (!options.create && !fs.existsSync(resolved)) throw new Error('The database file does not exist.');
    this.close();
    this.readonly = Boolean(options.readonly);
    this.db = new DatabaseSync(resolved, {
      readOnly: this.readonly,
      enableForeignKeyConstraints: true,
      timeout: 5000
    });
    this.filePath = resolved;
    this.db.exec('PRAGMA foreign_keys = ON');
    return this.overview();
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
    this.filePath = null;
    this.readonly = false;
    return true;
  }

  objects() {
    this.requireOpen();
    const objects = this.db.prepare(`
      SELECT name, type, sql
      FROM sqlite_schema
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name COLLATE NOCASE
    `).all();
    return objects.map((object) => {
      let rowCount = null;
      try { rowCount = this.db.prepare(`SELECT COUNT(*) AS count FROM ${q(object.name)}`).get().count; } catch { /* view may be invalid */ }
      return { ...object, rowCount: typeof rowCount === 'bigint' ? rowCount.toString() : rowCount };
    });
  }

  overview() {
    this.requireOpen();
    const stat = fs.statSync(this.filePath);
    const objects = this.objects();
    const pageSize = this.db.prepare('PRAGMA page_size').get().page_size;
    const pageCount = this.db.prepare('PRAGMA page_count').get().page_count;
    return {
      filePath: this.filePath,
      fileName: path.basename(this.filePath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      readonly: this.readonly,
      sqliteVersion: this.db.prepare('SELECT sqlite_version() AS version').get().version,
      pageSize,
      pageCount,
      objects,
      tableCount: objects.filter((item) => item.type === 'table').length,
      viewCount: objects.filter((item) => item.type === 'view').length,
      indexCount: this.db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").get().count,
      triggerCount: this.db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'trigger'").get().count
    };
  }

  assertObject(name, allowedTypes = ['table', 'view']) {
    this.requireOpen();
    const found = this.db.prepare('SELECT name, type FROM sqlite_schema WHERE name = ?').get(name);
    if (!found || !allowedTypes.includes(found.type)) throw new Error(`Database object “${name}” was not found.`);
    return found;
  }

  tableColumns(name) {
    this.assertObject(name, ['table', 'view']);
    return this.db.prepare(`PRAGMA table_info(${q(name)})`).all();
  }

  identityFor(name) {
    const columns = this.tableColumns(name);
    const primary = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk).map((column) => column.name);
    if (primary.length) return { columns: primary, usesRowid: false };
    const sql = this.db.prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name)?.sql || '';
    return { columns: ['__sqlitescope_rowid__'], usesRowid: !/WITHOUT\s+ROWID/i.test(sql) };
  }

  getRows(name, options = {}) {
    const object = this.assertObject(name, ['table', 'view']);
    const columns = this.tableColumns(name);
    const page = Math.max(1, Number(options.page) || 1);
    const limit = Math.min(500, Math.max(10, Number(options.limit) || 50));
    const offset = (page - 1) * limit;
    const filter = String(options.filter || '').trim();
    const where = filter ? ` WHERE (${filter})` : '';
    let order = '';
    if (options.sortColumn && columns.some((column) => column.name === options.sortColumn)) {
      order = ` ORDER BY ${q(options.sortColumn)} ${options.sortDirection === 'desc' ? 'DESC' : 'ASC'}`;
    }
    const identity = object.type === 'table' ? this.identityFor(name) : { columns: [], usesRowid: false };
    const prefix = identity.usesRowid ? 'rowid AS "__sqlitescope_rowid__", ' : '';
    const count = this.db.prepare(`SELECT COUNT(*) AS count FROM ${q(name)}${where}`).get().count;
    const rows = this.db.prepare(`SELECT ${prefix}* FROM ${q(name)}${where}${order} LIMIT ? OFFSET ?`).all(limit, offset);
    return {
      name,
      type: object.type,
      columns,
      rows: serializeRows(rows),
      identity,
      page,
      limit,
      total: typeof count === 'bigint' ? count.toString() : count,
      pages: Math.max(1, Math.ceil(Number(count) / limit)),
      editable: object.type === 'table' && !this.readonly && (identity.usesRowid || identity.columns[0] !== '__sqlitescope_rowid__')
    };
  }

  getStructure(name) {
    const object = this.assertObject(name, ['table', 'view']);
    const columns = this.tableColumns(name);
    const indexes = object.type === 'table' ? this.db.prepare(`PRAGMA index_list(${q(name)})`).all().map((index) => ({
      ...index,
      columns: this.db.prepare(`PRAGMA index_info(${q(index.name)})`).all()
    })) : [];
    const foreignKeys = object.type === 'table' ? this.db.prepare(`PRAGMA foreign_key_list(${q(name)})`).all() : [];
    const triggers = this.db.prepare("SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? ORDER BY name").all(name);
    const createSql = this.db.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(name)?.sql || '';
    const checks = [...createSql.matchAll(/(?:CONSTRAINT\s+(?:"[^"]+"|\[[^\]]+\]|`[^`]+`|\w+)\s+)?CHECK\s*\(([^]*?)\)(?=\s*(?:,|\)))/gi)].map((match, index) => ({ id: index, expression: match[1].trim() }));
    return { name, type: object.type, columns, indexes, foreignKeys, triggers, checks, createSql, withoutRowid: /\bWITHOUT\s+ROWID\b/i.test(createSql), strict: /\bSTRICT\s*$/i.test(createSql.trim()) };
  }

  ensureWritable() {
    this.requireOpen();
    if (this.readonly) throw new Error('This database is open in read-only mode.');
  }

  saveRow(payload) {
    this.ensureWritable();
    const { table, mode, values = {}, originalIdentity = {} } = payload || {};
    this.assertObject(table, ['table']);
    const columns = this.tableColumns(table);
    const columnMap = new Map(columns.map((column) => [column.name, column]));
    const names = Object.keys(values).filter((name) => columnMap.has(name));
    if (!names.length) throw new Error('No column values were supplied.');
    const params = names.map((name) => coerce(values[name], columnMap.get(name).type));
    if (mode === 'insert') {
      const result = this.db.prepare(`INSERT INTO ${q(table)} (${names.map(q).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params);
      return { changes: result.changes, lastInsertRowid: String(result.lastInsertRowid) };
    }
    const identity = this.identityFor(table);
    const keys = identity.columns;
    if (!keys.every((key) => Object.prototype.hasOwnProperty.call(originalIdentity, key))) throw new Error('This row cannot be identified safely. Refresh the table and try again.');
    const where = keys.map((key) => key === '__sqlitescope_rowid__' ? 'rowid = ?' : `${q(key)} IS ?`).join(' AND ');
    const identityValues = keys.map((key) => originalIdentity[key]);
    const result = this.db.prepare(`UPDATE ${q(table)} SET ${names.map((name) => `${q(name)} = ?`).join(', ')} WHERE ${where}`).run(...params, ...identityValues);
    if (!result.changes) throw new Error('The row no longer exists or was changed.');
    return { changes: result.changes };
  }

  deleteRows(name, identities) {
    this.ensureWritable();
    this.assertObject(name, ['table']);
    if (!Array.isArray(identities) || !identities.length) return { changes: 0 };
    const identity = this.identityFor(name);
    const keys = identity.columns;
    const where = keys.map((key) => key === '__sqlitescope_rowid__' ? 'rowid = ?' : `${q(key)} IS ?`).join(' AND ');
    const statement = this.db.prepare(`DELETE FROM ${q(name)} WHERE ${where}`);
    let changes = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const item of identities) changes += Number(statement.run(...keys.map((key) => item[key])).changes);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { changes };
  }

  runSql(sql) {
    this.requireOpen();
    const source = String(sql || '').trim();
    if (!source) throw new Error('Enter an SQL statement first.');
    if (this.readonly && !/^\s*(SELECT|PRAGMA\s+[^=;]+$|EXPLAIN|WITH\b[^]*\bSELECT\b)/i.test(source)) throw new Error('Only read queries are allowed in read-only mode.');
    const started = process.hrtime.bigint();
    let result;
    try {
      const statement = this.db.prepare(source);
      if (statement.columns().length) {
        const rows = statement.all();
        result = { kind: 'rows', rows: serializeRows(rows), columns: rows.length ? Object.keys(rows[0]) : statement.columns().map((column) => column.name), rowCount: rows.length };
      } else {
        const info = statement.run();
        result = { kind: 'changes', changes: info.changes, lastInsertRowid: String(info.lastInsertRowid) };
      }
    } catch (error) {
      if (/more than one statement|SQL input contains more than one statement|unexpected data after/i.test(error.message)) {
        this.ensureWritable();
        this.db.exec(source);
        result = { kind: 'changes', changes: null, message: 'SQL script executed successfully.' };
      } else throw error;
    }
    result.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    return result;
  }

  createTable(spec) {
    this.ensureWritable();
    const name = String(spec?.name || '').trim();
    const columns = Array.isArray(spec?.columns) ? spec.columns : [];
    if (!name || !columns.length) throw new Error('A table name and at least one column are required.');
    if (this.db.prepare('SELECT 1 FROM sqlite_schema WHERE name = ?').get(name)) throw new Error('An object with that name already exists.');
    const definitions = columns.map((column) => {
      const columnName = String(column.name || '').trim();
      if (!columnName) throw new Error('Every column needs a name.');
      const type = ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'].includes(column.type) ? column.type : 'TEXT';
      return `${q(columnName)} ${type}${column.primaryKey ? ' PRIMARY KEY' : ''}${column.autoIncrement && type === 'INTEGER' && column.primaryKey ? ' AUTOINCREMENT' : ''}${column.notNull ? ' NOT NULL' : ''}${column.unique ? ' UNIQUE' : ''}${column.defaultValue !== undefined && column.defaultValue !== '' ? ` DEFAULT ${column.defaultValue}` : ''}`;
    });
    this.db.exec(`CREATE TABLE ${q(name)} (${definitions.join(', ')})`);
    return this.getStructure(name);
  }

  planTableStructure(name, spec) {
    this.ensureWritable();
    this.assertObject(name, ['table']);
    const current = this.getStructure(name);
    const columns = Array.isArray(spec?.columns) ? spec.columns : [];
    if (!columns.length) throw new Error('A table must contain at least one column.');
    const seen = new Set();
    const oldNames = new Set(current.columns.map((column) => column.name));
    const normalized = columns.map((column, index) => {
      const columnName = String(column.name || '').trim();
      if (!columnName) throw new Error(`Column ${index + 1} needs a name.`);
      if (seen.has(columnName.toLowerCase())) throw new Error(`Column “${columnName}” is duplicated.`);
      seen.add(columnName.toLowerCase());
      const originalName = String(column.originalName || '').trim();
      if (originalName && !oldNames.has(originalName)) throw new Error(`Original column “${originalName}” no longer exists.`);
      const type = String(column.type || '').trim().toUpperCase() || 'TEXT';
      if (!/^[A-Z][A-Z0-9_ ()+,.-]*$/.test(type)) throw new Error(`Column “${columnName}” has an invalid declared type.`);
      const defaultValue = String(column.defaultValue ?? '').trim();
      return { name: columnName, originalName, type, primaryKey: Boolean(column.primaryKey), autoIncrement: Boolean(column.autoIncrement), notNull: Boolean(column.notNull), unique: Boolean(column.unique), defaultValue };
    });
    if (normalized.filter((column) => column.autoIncrement).length > 1) throw new Error('Only one AUTOINCREMENT column is allowed.');
    for (const column of normalized) {
      if (column.autoIncrement && !(column.primaryKey && column.type === 'INTEGER')) throw new Error('AUTOINCREMENT requires an INTEGER PRIMARY KEY column.');
      if (!column.originalName && column.notNull && !column.defaultValue && !column.primaryKey) throw new Error(`New NOT NULL column “${column.name}” requires a default value.`);
    }
    const primary = normalized.filter((column) => column.primaryKey);
    const definitions = normalized.map((column) => {
      const inlinePrimary = primary.length === 1 && column.primaryKey;
      return `${q(column.name)} ${column.type}${inlinePrimary ? ' PRIMARY KEY' : ''}${column.autoIncrement ? ' AUTOINCREMENT' : ''}${column.notNull && !inlinePrimary ? ' NOT NULL' : ''}${column.unique ? ' UNIQUE' : ''}${column.defaultValue ? ` DEFAULT ${column.defaultValue}` : ''}`;
    });
    if (primary.length > 1) definitions.push(`PRIMARY KEY (${primary.map((column) => q(column.name)).join(', ')})`);
    const renamed = new Map(normalized.filter((column) => column.originalName).map((column) => [column.originalName, column.name]));
    const validColumns = new Set(normalized.map((column) => column.name));
    const actions = new Set(['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE']);
    const suppliedFks = Array.isArray(spec?.foreignKeys) ? spec.foreignKeys : current.foreignKeys.map((fk) => ({ columns: [renamed.get(fk.from) || fk.from], referenceTable: fk.table, referenceColumns: [fk.to], onUpdate: fk.on_update, onDelete: fk.on_delete, match: fk.match, deferred: false }));
    const foreignKeys = suppliedFks.map((fk, index) => {
      const columns = (fk.columns || [fk.from]).map((value) => String(value || '').trim()).filter(Boolean);
      const referenceColumns = (fk.referenceColumns || [fk.to]).map((value) => String(value || '').trim()).filter(Boolean);
      const referenceTable = String(fk.referenceTable || fk.table || '').trim();
      if (!columns.length || columns.length !== referenceColumns.length || !referenceTable) throw new Error(`Foreign key ${index + 1} is incomplete.`);
      if (columns.some((column) => !validColumns.has(column))) throw new Error(`Foreign key ${index + 1} uses an unknown local column.`);
      const onUpdate = String(fk.onUpdate || fk.on_update || 'NO ACTION').toUpperCase();
      const onDelete = String(fk.onDelete || fk.on_delete || 'NO ACTION').toUpperCase();
      if (!actions.has(onUpdate) || !actions.has(onDelete)) throw new Error(`Foreign key ${index + 1} has an invalid action.`);
      return { columns, referenceTable, referenceColumns, onUpdate, onDelete, match: String(fk.match || 'NONE').toUpperCase(), deferred: Boolean(fk.deferred) };
    });
    for (const fk of foreignKeys) definitions.push(`FOREIGN KEY (${fk.columns.map(q).join(', ')}) REFERENCES ${q(fk.referenceTable)} (${fk.referenceColumns.map(q).join(', ')}) ON UPDATE ${fk.onUpdate} ON DELETE ${fk.onDelete}${fk.match !== 'NONE' ? ` MATCH ${fk.match}` : ''}${fk.deferred ? ' DEFERRABLE INITIALLY DEFERRED' : ''}`);
    const checks = (Array.isArray(spec?.checks) ? spec.checks : current.checks).map((item) => String(item.expression ?? item).trim()).filter(Boolean);
    for (const expression of checks) {
      if (/[;\u0000]/.test(expression)) throw new Error('CHECK expressions cannot contain semicolons.');
      definitions.push(`CHECK (${expression})`);
    }
    const tempName = `__sqlitescope_rebuild_${Date.now()}`;
    const copied = normalized.filter((column) => column.originalName);
    const statements = [
      `CREATE TABLE ${q(tempName)} (\n  ${definitions.join(',\n  ')}\n)${spec?.withoutRowid ? ' WITHOUT ROWID' : ''}${spec?.strict ? `${spec?.withoutRowid ? ',' : ''} STRICT` : ''}`,
      copied.length ? `INSERT INTO ${q(tempName)} (${copied.map((column) => q(column.name)).join(', ')}) SELECT ${copied.map((column) => q(column.originalName)).join(', ')} FROM ${q(name)}` : null,
      `DROP TABLE ${q(name)}`,
      `ALTER TABLE ${q(tempName)} RENAME TO ${q(name)}`
    ].filter(Boolean);
    const warnings = [];
    const removed = current.columns.filter((column) => !renamed.has(column.name)).map((column) => column.name);
    if (removed.length) warnings.push(`Data in removed column${removed.length === 1 ? '' : 's'} will be deleted: ${removed.join(', ')}.`);
    if (normalized.some((column) => column.originalName && column.originalName !== column.name) && current.triggers.length) warnings.push('Review triggers after renaming columns; trigger SQL is preserved but may reference old names.');
    const indexes = current.indexes.filter((index) => index.origin === 'c' && index.columns.length && index.columns.every((entry) => renamed.has(entry.name))).map((index) => ({ name: index.name, unique: Boolean(index.unique), columns: index.columns.map((entry) => renamed.get(entry.name)) }));
    for (const index of indexes) statements.push(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${q(index.name)} ON ${q(name)} (${index.columns.map(q).join(', ')})`);
    for (const trigger of current.triggers) if (trigger.sql) statements.push(trigger.sql);
    return { name, tempName, columns: normalized, foreignKeys, checks, withoutRowid: Boolean(spec?.withoutRowid), strict: Boolean(spec?.strict), statements, warnings, removed, previewSql: statements.map((sql) => `${sql};`).join('\n\n') };
  }

  updateTableStructure(name, spec) {
    const plan = this.planTableStructure(name, spec);
    const foreignKeys = this.db.prepare('PRAGMA foreign_keys').get().foreign_keys;
    this.db.exec('PRAGMA foreign_keys = OFF');
    try {
      this.db.exec('BEGIN IMMEDIATE');
      for (const statement of plan.statements) this.db.exec(statement);
      const check = this.db.prepare('PRAGMA foreign_key_check').all();
      if (check.length) throw new Error(`Foreign-key validation failed with ${check.length} violation(s).`);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* transaction may already be closed */ }
      throw error;
    } finally {
      this.db.exec(`PRAGMA foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
    return this.getStructure(name);
  }

  renameTable(oldName, newName) {
    this.ensureWritable();
    this.assertObject(oldName, ['table']);
    const trimmed = String(newName || '').trim();
    if (!trimmed) throw new Error('Enter a new table name.');
    this.db.exec(`ALTER TABLE ${q(oldName)} RENAME TO ${q(trimmed)}`);
    return true;
  }

  createIndex(spec) {
    this.ensureWritable();
    const table = String(spec?.table || '').trim();
    const name = String(spec?.name || '').trim();
    this.assertObject(table, ['table']);
    if (!name) throw new Error('Enter an index name.');
    const columns = Array.isArray(spec?.columns) ? spec.columns : [];
    if (!columns.length) throw new Error('Choose at least one indexed column or expression.');
    const terms = columns.map((item) => {
      const value = String(item.name || item.expression || '').trim();
      if (!value) throw new Error('Every index term needs a column or expression.');
      const expression = item.expression ? value : q(value);
      const collation = item.collation ? ` COLLATE ${String(item.collation).replace(/[^A-Za-z0-9_]/g, '')}` : '';
      return `${expression}${collation} ${String(item.order).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`;
    });
    const where = String(spec.where || '').trim();
    if (/[;\u0000]/.test(where)) throw new Error('The partial-index condition cannot contain semicolons.');
    this.db.exec(`CREATE ${spec.unique ? 'UNIQUE ' : ''}INDEX ${q(name)} ON ${q(table)} (${terms.join(', ')})${where ? ` WHERE ${where}` : ''}`);
    return this.getStructure(table);
  }

  dropIndex(name) { this.ensureWritable(); this.db.exec(`DROP INDEX ${q(name)}`); return true; }

  saveSchemaObject(type, name, sql, originalName = null) {
    this.ensureWritable();
    if (!['view', 'trigger'].includes(type)) throw new Error('Only views and triggers can be managed here.');
    const source = String(sql || '').trim();
    if (!source) throw new Error('Enter a complete SQL definition.');
    const expected = type === 'view' ? /^CREATE\s+(?:TEMP\s+)?VIEW\b/i : /^CREATE\s+(?:TEMP\s+)?TRIGGER\b/i;
    if (!expected.test(source)) throw new Error(`The SQL must be a CREATE ${type.toUpperCase()} statement.`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (originalName) this.db.exec(`DROP ${type.toUpperCase()} ${q(originalName)}`);
      this.db.exec(source);
      this.db.exec('COMMIT');
    } catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; }
    return true;
  }

  dropSchemaObject(type, name) {
    this.ensureWritable();
    if (!['view', 'trigger', 'index'].includes(type)) throw new Error('Unsupported schema object type.');
    this.db.exec(`DROP ${type.toUpperCase()} ${q(name)}`);
    return true;
  }

  attachedDatabases() { this.requireOpen(); return this.db.prepare('PRAGMA database_list').all(); }
  attachDatabase(filePath, schema) {
    this.ensureWritable();
    const alias = String(schema || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias) || ['main', 'temp'].includes(alias.toLowerCase())) throw new Error('Enter a valid, unique schema alias.');
    this.db.prepare(`ATTACH DATABASE ? AS ${q(alias)}`).run(path.resolve(filePath));
    return this.attachedDatabases();
  }
  detachDatabase(schema) { this.ensureWritable(); this.db.exec(`DETACH DATABASE ${q(schema)}`); return this.attachedDatabases(); }

  setPragma(name, value) {
    this.ensureWritable();
    const allowed = { foreign_keys: ['0','1'], defer_foreign_keys: ['0','1'], recursive_triggers: ['0','1'], journal_mode: ['DELETE','TRUNCATE','PERSIST','MEMORY','WAL','OFF'], synchronous: ['OFF','NORMAL','FULL','EXTRA'], locking_mode: ['NORMAL','EXCLUSIVE'], temp_store: ['DEFAULT','FILE','MEMORY'] };
    if (!allowed[name] || !allowed[name].includes(String(value).toUpperCase())) throw new Error('Unsupported PRAGMA value.');
    return this.db.prepare(`PRAGMA ${name} = ${String(value).toUpperCase()}`).get() || true;
  }

  dropObject(name, type) {
    this.ensureWritable();
    const object = this.assertObject(name, ['table', 'view']);
    if (object.type !== type) throw new Error('The object type does not match.');
    this.db.exec(`DROP ${type === 'view' ? 'VIEW' : 'TABLE'} ${q(name)}`);
    return true;
  }

  emptyTable(name) {
    this.ensureWritable();
    this.assertObject(name, ['table']);
    const info = this.db.prepare(`DELETE FROM ${q(name)}`).run();
    return { changes: info.changes };
  }

  importRows(name, headers, rows) {
    this.ensureWritable();
    this.assertObject(name, ['table']);
    const valid = new Set(this.tableColumns(name).map((column) => column.name));
    const selected = headers.filter((header) => valid.has(header));
    if (!selected.length) throw new Error('None of the CSV headers match this table.');
    const insert = this.db.prepare(`INSERT INTO ${q(name)} (${selected.map(q).join(', ')}) VALUES (${selected.map(() => '?').join(', ')})`);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) insert.run(...selected.map((header) => row[headers.indexOf(header)] === '' ? null : row[headers.indexOf(header)]));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { imported: rows.length, ignoredColumns: headers.filter((header) => !valid.has(header)) };
  }

  integrityCheck() {
    this.requireOpen();
    return serializeRows(this.db.prepare('PRAGMA integrity_check').all());
  }

  getPragmas() {
    this.requireOpen();
    const scalar = (name) => this.db.prepare(`PRAGMA ${name}`).get()?.[name];
    return { journalMode: scalar('journal_mode'), synchronous: scalar('synchronous'), foreignKeys: Boolean(scalar('foreign_keys')), autoVacuum: scalar('auto_vacuum'), cacheSize: scalar('cache_size'), busyTimeout: scalar('busy_timeout'), userVersion: scalar('user_version'), applicationId: scalar('application_id'), encoding: scalar('encoding'), freelistCount: scalar('freelist_count') };
  }

  maintenance(action) {
    this.ensureWritable();
    const commands = { checkpoint: 'PRAGMA wal_checkpoint(TRUNCATE)', optimize: 'PRAGMA optimize', analyze: 'ANALYZE', vacuum: 'VACUUM' };
    if (!commands[action]) throw new Error('Unknown maintenance action.');
    const started = process.hrtime.bigint();
    this.db.exec(commands[action]);
    return { action, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6, pragmas: this.getPragmas() };
  }

  queryTemplates(name) {
    const object = this.assertObject(name, ['table', 'view']);
    const columns = this.tableColumns(name).map((column) => column.name);
    const list = columns.map(q).join(', ');
    const first = columns[0] ? q(columns[0]) : 'rowid';
    return { select: `SELECT ${list || '*'}\nFROM ${q(name)}\nLIMIT 100;`, count: `SELECT COUNT(*) AS total\nFROM ${q(name)};`, insert: object.type === 'table' ? `INSERT INTO ${q(name)} (${list})\nVALUES (${columns.map(() => '?').join(', ')});` : null, update: object.type === 'table' ? `UPDATE ${q(name)}\nSET ${first} = ?\nWHERE ${first} = ?;` : null, delete: object.type === 'table' ? `DELETE FROM ${q(name)}\nWHERE ${first} = ?;` : null, create: this.getStructure(name).createSql };
  }

  async backup(destination) {
    this.requireOpen();
    if (path.resolve(destination) === this.filePath) throw new Error('Choose a different location for the backup.');
    if (typeof backup === 'function') {
      await backup(this.db, destination);
    } else {
      this.db.exec(`VACUUM INTO '${String(destination).replace(/'/g, "''")}'`);
    }
    return destination;
  }

  exportData(format, objectName) {
    this.requireOpen();
    if (format === 'sql') return this.exportSql();
    this.assertObject(objectName, ['table', 'view']);
    const rows = this.db.prepare(`SELECT * FROM ${q(objectName)}`).all();
    if (format === 'json') return JSON.stringify(serializeRows(rows), null, 2);
    const columns = this.tableColumns(objectName).map((column) => column.name);
    const cell = (value) => {
      if (value === null) return '';
      if (Buffer.isBuffer(value)) value = value.toString('base64');
      const string = String(value);
      return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
    };
    return [columns.map(cell).join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\n');
  }

  exportSql() {
    const schema = this.db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'trigger' THEN 2 ELSE 3 END").all();
    const lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
    for (const item of schema.filter((entry) => entry.type === 'table')) {
      lines.push(`${item.sql};`);
      const rows = this.db.prepare(`SELECT * FROM ${q(item.name)}`).all();
      const columns = this.tableColumns(item.name).map((column) => column.name);
      for (const row of rows) {
        const values = columns.map((column) => {
          const value = row[column];
          if (value === null) return 'NULL';
          if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
          if (typeof value === 'number' || typeof value === 'bigint') return String(value);
          return `'${String(value).replace(/'/g, "''")}'`;
        });
        lines.push(`INSERT INTO ${q(item.name)} (${columns.map(q).join(', ')}) VALUES (${values.join(', ')});`);
      }
    }
    for (const item of schema.filter((entry) => entry.type !== 'table')) lines.push(`${item.sql};`);
    lines.push('COMMIT;', 'PRAGMA foreign_keys=ON;');
    return lines.join('\n');
  }
}

module.exports = { DatabaseManager, q, serializeRows };
