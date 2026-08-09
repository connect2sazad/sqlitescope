const path = require('path');
const crypto = require('crypto');
const { DatabaseManager } = require('./database');

class DatabaseWorkspace {
  constructor(factory = () => new DatabaseManager()) {
    this.factory = factory;
    this.connections = new Map();
    this.activeId = null;
  }

  get active() {
    const entry = this.connections.get(this.activeId);
    if (!entry) throw new Error('No database is active.');
    return entry.manager;
  }

  get filePath() { return this.active.filePath; }

  open(filePath, options = {}) {
    const resolved = path.resolve(filePath);
    const existing = [...this.connections.values()].find((entry) => entry.manager.filePath === resolved);
    if (existing) {
      this.activeId = existing.id;
      return this.describe(existing);
    }
    const manager = this.factory();
    const overview = manager.open(resolved, options);
    const entry = { id: crypto.randomUUID(), manager };
    this.connections.set(entry.id, entry);
    this.activeId = entry.id;
    return { ...overview, id: entry.id };
  }

  describe(entry) { return { ...entry.manager.overview(), id: entry.id }; }

  list() {
    return [...this.connections.values()].map((entry) => ({
      id: entry.id,
      filePath: entry.manager.filePath,
      fileName: path.basename(entry.manager.filePath),
      readonly: entry.manager.readonly,
      active: entry.id === this.activeId
    }));
  }

  activate(id) {
    const entry = this.connections.get(id);
    if (!entry) throw new Error('That database is no longer open.');
    this.activeId = id;
    return this.describe(entry);
  }

  close(id = this.activeId) {
    const entry = this.connections.get(id);
    if (!entry) return { closedId: id, active: null, sessions: this.list() };
    entry.manager.close();
    this.connections.delete(id);
    if (this.activeId === id) this.activeId = this.connections.size ? [...this.connections.keys()].at(-1) : null;
    return {
      closedId: id,
      active: this.activeId ? this.describe(this.connections.get(this.activeId)) : null,
      sessions: this.list()
    };
  }

  closeAll() {
    for (const entry of this.connections.values()) entry.manager.close();
    this.connections.clear();
    this.activeId = null;
  }

  overview() { return { ...this.active.overview(), id: this.activeId }; }
}

for (const method of ['getRows', 'getStructure', 'saveRow', 'deleteRows', 'runSql', 'createTable', 'planTableStructure', 'updateTableStructure', 'renameTable', 'dropObject', 'emptyTable', 'importRows', 'integrityCheck', 'getPragmas', 'maintenance', 'queryTemplates', 'backup', 'exportData', 'requireOpen', 'createIndex', 'dropIndex', 'saveSchemaObject', 'dropSchemaObject', 'attachedDatabases', 'attachDatabase', 'detachDatabase', 'setPragma']) {
  DatabaseWorkspace.prototype[method] = function (...args) { return this.active[method](...args); };
}

module.exports = { DatabaseWorkspace };
