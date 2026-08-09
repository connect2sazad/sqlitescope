const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;

function parseDelimited(source, delimiter = ',') {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const text = String(source || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((item) => item.some((value) => value !== ''));
}

function detectDelimiter(text) {
  const first = String(text || '').split(/\r?\n/, 1)[0] || '';
  const candidates = [',', ';', '\t', '|'];
  return candidates.map((delimiter) => ({ delimiter, count: parseDelimited(first, delimiter)[0]?.length || 0 }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ',';
}

function normalizeHeaders(values) {
  const used = new Set();
  return values.map((value, index) => {
    const base = String(value || '').trim() || `column_${index + 1}`;
    let name = base, suffix = 2;
    while (used.has(name.toLowerCase())) name = `${base}_${suffix++}`;
    used.add(name.toLowerCase());
    return name;
  });
}

function inferType(values) {
  const present = values.map((value) => String(value).trim()).filter(Boolean);
  if (!present.length) return 'TEXT';
  if (present.every((value) => /^[+-]?\d+$/.test(value) && Number.isSafeInteger(Number(value)))) return 'INTEGER';
  if (present.every((value) => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) return 'REAL';
  return 'TEXT';
}

function previewCsv(filePath, options = {}) {
  const source = fs.readFileSync(filePath, 'utf8');
  const delimiter = options.delimiter === 'auto' || !options.delimiter ? detectDelimiter(source) : options.delimiter;
  const rows = parseDelimited(source, delimiter);
  if (!rows.length) throw new Error('The source file is empty.');
  const hasHeader = options.hasHeader !== false;
  const width = Math.max(...rows.map((row) => row.length));
  const headers = normalizeHeaders(hasHeader ? rows[0] : Array.from({ length: width }, (_, i) => `column_${i + 1}`));
  const data = (hasHeader ? rows.slice(1) : rows).map((row) => headers.map((_, i) => row[i] ?? ''));
  const columns = headers.map((name, index) => ({ name, type: inferType(data.slice(0, 1000).map((row) => row[index])) }));
  return { delimiter, hasHeader, columns, rowCount: data.length, previewRows: data.slice(0, 20) };
}

function ensureOutput(outputPath) {
  const resolved = path.resolve(outputPath);
  if (fs.existsSync(resolved)) throw new Error('The output file already exists. Choose a new filename.');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

function prepareSqlScript(source) {
  let sql = String(source || '').replace(/^\uFEFF/, '');
  const mysqlLike = /phpMyAdmin|MySQL|MariaDB|`[^`]+`|ENGINE\s*=|CHARSET\s*=|^\s*SET\s+/im.test(sql);
  const warnings = [];
  if (!mysqlLike) return { sql: sql.trim(), dialect: 'sqlite', warnings };

  warnings.push('MySQL/phpMyAdmin compatibility mode was used. Review schema types and constraints after conversion.');
  const primaryKeys = new Map();
  const autoIncrement = new Map();
  const deferredIndexes = [];
  sql.replace(/ALTER\s+TABLE\s+`?([^`\s]+)`?\s+([\s\S]*?);/gi, (_, table, operations) => {
    const primary = operations.match(/ADD\s+PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (primary) primaryKeys.set(table, primary[1].split(',').map((item) => item.replace(/[`"\s]/g, '')));
    const modified = operations.match(/MODIFY\s+`?([^`\s]+)`?[\s\S]*?AUTO_INCREMENT/i);
    if (modified) autoIncrement.set(table, modified[1]);
    for (const match of operations.matchAll(/ADD\s+(UNIQUE\s+)?KEY\s+`?([^`\s]+)`?\s*\(([^)]+)\)/gi)) {
      // SQLite index names are database-wide while MySQL permits the same key
      // name (such as "email") on several tables. Prefix to avoid collisions.
      deferredIndexes.push(`CREATE ${match[1] ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quote(`${table}_${match[2]}`)} ON ${quote(table)} (${match[3].replace(/`/g, '"')});`);
    }
    return _;
  });

  sql = sql
    .replace(/^\s*START\s+TRANSACTION\s*;\s*$/gim, 'BEGIN TRANSACTION;')
    .replace(/^\s*(?:SET|USE|LOCK TABLES|UNLOCK TABLES|DELIMITER)\b[^;]*;\s*$/gim, '')
    .replace(/\/\*!\d+\s+[\s\S]*?\*\//g, '')
    .replace(/`([^`]+)`/g, '"$1"')
    .replace(/\b(?:TINY|SMALL|MEDIUM|BIG)?INT\s*\(\s*\d+\s*\)(?:\s+UNSIGNED)?/gi, 'INTEGER')
    .replace(/\b(?:TINY|SMALL|MEDIUM|BIG)INT\b(?:\s+UNSIGNED)?/gi, 'INTEGER')
    .replace(/\bDOUBLE(?:\s+PRECISION)?\b/gi, 'REAL')
    .replace(/\bFLOAT\b/gi, 'REAL')
    .replace(/\b(?:LONG|MEDIUM|TINY)?TEXT\b/gi, 'TEXT')
    .replace(/\b(?:LONG|MEDIUM|TINY)?BLOB\b/gi, 'BLOB')
    .replace(/\bENUM\s*\([^)]*\)/gi, 'TEXT')
    .replace(/\s+UNSIGNED\b/gi, '')
    .replace(/\s+CHARACTER SET\s+\w+/gi, '')
    .replace(/\s+COLLATE\s+\w+/gi, '')
    .replace(/\s+ON UPDATE\s+CURRENT_TIMESTAMP(?:\(\))?/gi, '')
    .replace(/\bCURRENT_TIMESTAMP\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\)\s*ENGINE\s*=\s*\w+(?:\s+AUTO_INCREMENT\s*=\s*\d+)?(?:\s+DEFAULT)?\s*(?:CHARSET|CHARACTER SET)\s*=\s*\w+(?:\s+COLLATE\s*=\s*\w+)?\s*;/gi, ');')
    .replace(/\)\s*(?:DEFAULT\s+)?(?:CHARSET|CHARACTER SET)\s*=\s*\w+(?:\s+COLLATE\s*=\s*\w+)?\s*;/gi, ');')
    .replace(/\bAUTO_INCREMENT\b/gi, '');

  // phpMyAdmin emits keys and AUTO_INCREMENT as ALTER TABLE statements, which
  // SQLite cannot apply directly. Fold primary keys into CREATE TABLE and turn
  // MySQL keys into SQLite indexes before executing the dump.
  sql = sql.replace(/CREATE\s+TABLE\s+"([^"]+)"\s*\(([\s\S]*?)\)\s*;/gi, (statement, table, body) => {
    const keys = primaryKeys.get(table) || [];
    const autoColumn = autoIncrement.get(table);
    let rewritten = body;
    if (keys.length === 1) {
      const column = keys[0];
      const linePattern = new RegExp(`("${column.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}"\\s+)[^,\\n]+`, 'i');
      rewritten = rewritten.replace(linePattern, (line) => {
        if (autoColumn === column) return `${quote(column)} INTEGER PRIMARY KEY AUTOINCREMENT`;
        return /\bPRIMARY\s+KEY\b/i.test(line) ? line : `${line.trim()} PRIMARY KEY`;
      });
    } else if (keys.length > 1 && !/\bPRIMARY\s+KEY\b/i.test(rewritten)) {
      rewritten = `${rewritten.trimEnd()},\n  PRIMARY KEY (${keys.map(quote).join(', ')})`;
    }
    return `CREATE TABLE ${quote(table)} (${rewritten});`;
  });
  sql = sql.replace(/ALTER\s+TABLE\s+"?([^"\s]+)"?\s+[\s\S]*?;/gi, '');
  sql = `${sql.trim()}\n${deferredIndexes.join('\n')}`;
  return { sql: sql.trim(), dialect: 'mysql-compatible', warnings };
}

function convertCsv(inputPath, outputPath, options = {}) {
  const preview = previewCsv(inputPath, options);
  const source = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseDelimited(source, preview.delimiter);
  const data = (preview.hasHeader ? parsed.slice(1) : parsed).map((row) => preview.columns.map((_, i) => row[i] ?? ''));
  const tableName = String(options.tableName || path.basename(inputPath, path.extname(inputPath))).trim();
  if (!tableName) throw new Error('Enter a table name.');
  const resolved = ensureOutput(outputPath);
  let db;
  try {
    db = new DatabaseSync(resolved, { enableForeignKeyConstraints: true });
    db.exec('BEGIN IMMEDIATE');
    db.exec(`CREATE TABLE ${quote(tableName)} (${preview.columns.map((column) => `${quote(column.name)} ${column.type}`).join(', ')})`);
    const insert = db.prepare(`INSERT INTO ${quote(tableName)} VALUES (${preview.columns.map(() => '?').join(', ')})`);
    for (const row of data) insert.run(...row.map((value, i) => value === '' ? null : preview.columns[i].type === 'INTEGER' ? Number(value) : preview.columns[i].type === 'REAL' ? Number(value) : value));
    db.exec('COMMIT');
    db.close(); db = null;
    return { outputPath: resolved, tableName, rowsImported: data.length, columns: preview.columns.length };
  } catch (error) {
    if (db) { try { db.exec('ROLLBACK'); } catch {} try { db.close(); } catch {} }
    try { fs.unlinkSync(resolved); } catch {}
    throw error;
  }
}

function convertSql(inputPath, outputPath) {
  const prepared = prepareSqlScript(fs.readFileSync(inputPath, 'utf8'));
  const sql = prepared.sql;
  if (!sql) throw new Error('The SQL file is empty.');
  const resolved = ensureOutput(outputPath);
  let db;
  try {
    db = new DatabaseSync(resolved, { enableForeignKeyConstraints: true });
    db.exec(sql);
    const check = db.prepare('PRAGMA integrity_check').get();
    if (!Object.values(check).includes('ok')) throw new Error('The converted database failed its integrity check.');
    const objects = db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get().count;
    db.close(); db = null;
    return { outputPath: resolved, objects: Number(objects), dialect: prepared.dialect, warnings: prepared.warnings };
  } catch (error) {
    if (db) try { db.close(); } catch {}
    try { fs.unlinkSync(resolved); } catch {}
    const hint = prepared.dialect === 'mysql-compatible' ? ' The dump contains MySQL/phpMyAdmin syntax that could not be translated automatically. Export as SQLite SQL when possible, or remove the unsupported statement shown by the error.' : '';
    throw new Error(`SQL conversion failed: ${error.message}.${hint}`);
  }
}

module.exports = { parseDelimited, detectDelimiter, previewCsv, convertCsv, convertSql, prepareSqlScript };
