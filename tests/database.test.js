const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { DatabaseManager } = require('../src/database');

function run() {
  const outputDir = path.join(__dirname, '.tmp');
  fs.mkdirSync(outputDir, { recursive: true });
  const dbPath = path.join(outputDir, 'test.db');
  for (const file of [dbPath, path.join(outputDir, 'test-backup.db')]) if (fs.existsSync(file)) fs.unlinkSync(file);

  const manager = new DatabaseManager();
  assert.strictEqual(manager.open(dbPath, { create: true }).tableCount, 0);
  manager.createTable({ name: 'users', columns: [
    { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
    { name: 'name', type: 'TEXT', notNull: true },
    { name: 'email', type: 'TEXT', unique: true },
    { name: 'score', type: 'REAL' }
  ] });
  manager.saveRow({ table: 'users', mode: 'insert', values: { name: 'Ada Lovelace', email: 'ada@example.com', score: '98.5' } });
  manager.saveRow({ table: 'users', mode: 'insert', values: { name: 'Linus Torvalds', email: 'linus@example.com', score: '95' } });

  let rows = manager.getRows('users', { page: 1, limit: 25 });
  assert.strictEqual(rows.rows.length, 2);
  assert.strictEqual(rows.rows[0].name, 'Ada Lovelace');
  assert.deepStrictEqual(rows.identity.columns, ['id']);
  manager.saveRow({ table: 'users', mode: 'update', values: { name: 'Ada Byron', email: 'ada@example.com', score: '99' }, originalIdentity: { id: 1 } });
  rows = manager.getRows('users', { filter: "name LIKE 'Ada%'" });
  assert.strictEqual(rows.rows[0].name, 'Ada Byron');

  assert.strictEqual(manager.runSql('SELECT COUNT(*) AS total FROM users').rows[0].total, 2);
  assert.ok(manager.exportData('csv', 'users').includes('Ada Byron'));
  assert.ok(manager.exportData('json', 'users').includes('linus@example.com'));
  assert.ok(manager.exportData('sql').includes('CREATE TABLE'));
  assert.deepStrictEqual(manager.integrityCheck(), [{ integrity_check: 'ok' }]);
  assert.ok(manager.getPragmas().journalMode);
  const templates = manager.queryTemplates('users');
  assert.ok(templates.select.includes('FROM "users"'));
  assert.ok(templates.insert.includes('INSERT INTO "users"'));
  assert.strictEqual(manager.maintenance('optimize').action, 'optimize');
  const plan = manager.planTableStructure('users', { columns: [
    { originalName: 'id', name: 'id', type: 'INTEGER', primaryKey: true },
    { originalName: 'name', name: 'full_name', type: 'TEXT', notNull: true },
    { originalName: 'email', name: 'email', type: 'TEXT', unique: true },
    { originalName: 'score', name: 'score', type: 'REAL' },
    { name: 'active', type: 'INTEGER', notNull: true, defaultValue: '1' }
  ] });
  assert.ok(plan.previewSql.includes('CREATE TABLE'));
  manager.updateTableStructure('users', { columns: plan.columns });
  rows = manager.getRows('users');
  assert.strictEqual(rows.rows[0].full_name, 'Ada Byron');
  assert.strictEqual(rows.rows[0].active, 1);
  assert.ok(manager.getStructure('users').columns.some((column) => column.name === 'full_name'));
  manager.createTable({ name: 'teams', columns: [{ name: 'id', type: 'INTEGER', primaryKey: true }, { name: 'name', type: 'TEXT', notNull: true }] });
  manager.saveRow({ table: 'teams', mode: 'insert', values: { id: 7, name: 'Platform' } });
  const peopleSpec = manager.getStructure('users');
  const fkPlan = manager.planTableStructure('users', {
    columns: peopleSpec.columns.map((column) => ({ originalName: column.name, name: column.name, type: column.type, primaryKey: Boolean(column.pk), notNull: Boolean(column.notnull), defaultValue: column.dflt_value ?? '' })).concat([{ name: 'team_id', type: 'INTEGER' }]),
    foreignKeys: [{ columns: ['team_id'], referenceTable: 'teams', referenceColumns: ['id'], onUpdate: 'CASCADE', onDelete: 'SET NULL', deferred: true }],
    checks: [{ expression: 'score IS NULL OR score >= 0' }]
  });
  assert.ok(fkPlan.previewSql.includes('ON UPDATE CASCADE ON DELETE SET NULL'));
  manager.updateTableStructure('users', fkPlan);
  const fkStructure = manager.getStructure('users');
  assert.strictEqual(fkStructure.foreignKeys[0].table, 'teams');
  assert.ok(fkStructure.checks.length >= 1);
  manager.createIndex({ table: 'users', name: 'idx_users_active', columns: [{ name: 'active', order: 'DESC' }], where: 'active = 1' });
  assert.ok(manager.getStructure('users').indexes.some((index) => index.name === 'idx_users_active'));
  manager.dropIndex('idx_users_active');
  manager.saveSchemaObject('view', null, 'CREATE VIEW "active_users" AS SELECT * FROM "users" WHERE active = 1');
  assert.ok(manager.objects().some((object) => object.name === 'active_users' && object.type === 'view'));
  manager.dropSchemaObject('view', 'active_users');
  manager.saveSchemaObject('trigger', null, 'CREATE TRIGGER "users_name_guard" BEFORE UPDATE OF full_name ON users WHEN NEW.full_name = \'\' BEGIN SELECT RAISE(ABORT, \'name required\'); END');
  assert.ok(manager.getStructure('users').triggers.some((trigger) => trigger.name === 'users_name_guard'));
  manager.dropSchemaObject('trigger', 'users_name_guard');
  manager.deleteRows('users', [{ id: 2 }]);
  assert.strictEqual(manager.getRows('users').total, 1);
  manager.renameTable('users', 'people');
  assert.strictEqual(manager.getRows('people').rows.length, 1);
  manager.close();
  console.log('All SQLiteScope database tests passed.');
}

try { run(); }
catch (error) { console.error(error); process.exitCode = 1; }
