const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { DatabaseWorkspace } = require('../src/workspace');

const dir = path.join(__dirname, '.tmp');
fs.mkdirSync(dir, { recursive: true });
const first = path.join(dir, 'workspace-first.db');
const second = path.join(dir, 'workspace-second.db');
for (const file of [first, second]) if (fs.existsSync(file)) fs.unlinkSync(file);

const workspace = new DatabaseWorkspace();
const a = workspace.open(first, { create: true });
workspace.createTable({ name: 'alpha', columns: [{ name: 'id', type: 'INTEGER', primaryKey: true }] });
const b = workspace.open(second, { create: true });
workspace.createTable({ name: 'beta', columns: [{ name: 'id', type: 'INTEGER', primaryKey: true }] });

assert.notStrictEqual(a.id, b.id);
assert.strictEqual(workspace.list().length, 2);
assert.strictEqual(workspace.overview().fileName, path.basename(second));
assert.ok(workspace.activate(a.id).objects.some((item) => item.name === 'alpha'));
assert.ok(workspace.activate(b.id).objects.some((item) => item.name === 'beta'));
assert.ok(workspace.getPragmas().journalMode, 'PRAGMA tools must be forwarded to the active database');
assert.ok(workspace.queryTemplates('beta').select.includes('FROM "beta"'));
assert.strictEqual(workspace.maintenance('optimize').action, 'optimize');
assert.strictEqual(workspace.open(first).id, a.id, 'opening the same path should activate the existing connection');
assert.strictEqual(workspace.list().length, 2);
workspace.close(a.id);
assert.strictEqual(workspace.list().length, 1);
workspace.closeAll();
assert.strictEqual(workspace.list().length, 0);
console.log('All SQLiteScope workspace tests passed.');
