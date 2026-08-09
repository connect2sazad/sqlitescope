const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let runtimeLogPath;
function runtimeLog(level, message, error) {
  try {
    if (!runtimeLogPath) {
      const logDir = path.join(app.getPath('userData'), 'logs');
      fs.mkdirSync(logDir, { recursive: true });
      runtimeLogPath = path.join(logDir, 'sqlitescope.log');
    }
    const detail = error && error.stack ? `\n${error.stack}` : error ? `\n${String(error)}` : '';
    fs.appendFileSync(runtimeLogPath, `[${new Date().toISOString()}] [${level}] ${message}${detail}\n`, 'utf8');
  } catch (_) {}
}
const crypto = require('crypto');
const { DatabaseWorkspace } = require('./src/workspace');
const converter = require('./src/converter');

let mainWindow;
const manager = new DatabaseWorkspace();
const watchedFiles = new Map();

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return { recentFiles: [], theme: 'modern-dashboard' };
  }
}

function writeSettings(next) {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2));
}

function rememberFile(filePath) {
  const settings = readSettings();
  settings.recentFiles = [filePath, ...(settings.recentFiles || []).filter((item) => item !== filePath)]
    .filter((item) => fs.existsSync(item))
    .slice(0, 10);
  writeSettings(settings);
  rebuildMenu();
}

function clearRecentFiles() {
  const settings = readSettings();
  settings.recentFiles = [];
  writeSettings(settings);
  rebuildMenu();
  send('app:recents-changed', []);
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function recentMenuItems() {
  const files = (readSettings().recentFiles || []).filter((file) => fs.existsSync(file));
  if (!files.length) return [{ label: 'No Recent Databases', enabled: false }];
  return [
    ...files.map((file) => ({ label: path.basename(file), sublabel: path.dirname(file), click: () => send('menu:open-path', file) })),
    { type: 'separator' },
    { label: 'Clear Recent Databases', click: clearRecentFiles }
  ];
}

function rebuildMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Open Database…', accelerator: 'CmdOrCtrl+O', click: () => openDatabaseDialog() },
        { label: 'Create Database…', accelerator: 'CmdOrCtrl+N', click: () => createDatabaseDialog() },
        { label: 'Convert SQL or CSV to SQLite…', accelerator: 'CmdOrCtrl+Shift+N', click: () => send('menu:converter') },
        { label: 'Recent Databases', submenu: recentMenuItems() },
        { type: 'separator' },
        { label: 'Close Database', accelerator: 'CmdOrCtrl+W', click: () => send('menu:close-database') },
        { label: 'Backup Database…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu:backup') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Database', submenu: [
      { label: 'Refresh', accelerator: 'F5', click: () => send('menu:refresh-database') },
      { label: 'Run Query', accelerator: 'CmdOrCtrl+Enter', click: () => send('menu:run-query') },
      { type: 'separator' },
      { label: 'Check Integrity', click: () => send('menu:integrity') },
      { label: 'Maintenance & Settings…', click: () => send('menu:database-tools') }
    ] },
    { label: 'Appearance', submenu: [
      { label: 'Theme Settings…', click: () => send('menu:appearance') }
    ] },
    { label: 'Help', submenu: [
      { label: 'Documentation', click: () => shell.openExternal('https://connect2sazad.github.io/sqlitescope') },
      { label: 'Open Runtime Logs', click: () => {
        const logDir = path.join(app.getPath('userData'), 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        shell.openPath(logDir);
      } },
      { label: 'Open Startup Logs', click: () => {
        const logDir = path.join(__dirname, 'logs');
        fs.mkdirSync(logDir, { recursive: true });
        shell.openPath(logDir);
      } },
      { type: 'separator' },
      { label: 'About SQLiteScope', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'About SQLiteScope', message: `SQLiteScope ${app.getVersion()}`, detail: 'A local-first desktop SQLite database viewer, editor and manager.\n\nCopyright © 2026 Sazad Ahemad' }) }
    ] }
  ]);
  Menu.setApplicationMenu(menu);
}

function watchDatabase(entry) {
  const filePath = entry.filePath;
  if (watchedFiles.has(filePath)) return;
  let lastNotified = 0;
  const listener = (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
    const now = Date.now();
    if (now - lastNotified < 500) return;
    lastNotified = now;
    const session = manager.list().find((item) => item.filePath === filePath);
    if (session) send('db:external-change', { id: session.id, filePath, modifiedAt: current.mtime.toISOString() });
  };
  fs.watchFile(filePath, { interval: 900 }, listener);
  watchedFiles.set(filePath, listener);
}

function unwatchClosedFiles() {
  const open = new Set(manager.list().map((item) => item.filePath));
  for (const [filePath, listener] of watchedFiles) if (!open.has(filePath)) {
    fs.unwatchFile(filePath, listener);
    watchedFiles.delete(filePath);
  }
}

function createWindow() {
  runtimeLog('INFO', 'Creating main window');
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 880,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#f5f7fb',
    title: 'SQLiteScope',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  });

  const rendererPath = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(rendererPath).catch((error) => {
    runtimeLog('ERROR', `Failed to load renderer: ${rendererPath}`, error);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    dialog.showErrorBox('SQLiteScope startup error', `The application interface could not be loaded.\n\n${error.message}`);
  });
  mainWindow.once('ready-to-show', () => {
    runtimeLog('INFO', 'Main window ready; showing window');
    mainWindow.show();
    mainWindow.focus();
  });
  // Do not leave the application invisible forever if Chromium never emits
  // ready-to-show on a particular graphics/driver configuration.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      runtimeLog('WARN', 'ready-to-show timed out; showing the main window');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 5000);
  mainWindow.webContents.on('did-finish-load', () => runtimeLog('INFO', 'Renderer loaded successfully'));
  mainWindow.webContents.on('did-fail-load', (_event, code, description) => runtimeLog('ERROR', `Renderer load failed (${code}): ${description}`));
  mainWindow.webContents.on('render-process-gone', (_event, details) => runtimeLog('ERROR', `Renderer process ended: ${JSON.stringify(details)}`));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => { mainWindow = null; });

  rebuildMenu();
}

async function openDatabaseDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open SQLite database',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (!result.canceled) for (const filePath of result.filePaths) send('menu:open-path', filePath);
}

async function createDatabaseDialog() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Create SQLite database',
    defaultPath: 'database.db',
    filters: [{ name: 'SQLite database', extensions: ['db'] }]
  });
  if (!result.canceled && result.filePath) send('menu:create-path', result.filePath);
}

function registerIpc() {
  const invoke = (channel, handler) => ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, data: await handler(...args) };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  });

  invoke('app:get-settings', () => readSettings());
  invoke('app:set-theme', (theme, density = 'comfortable') => {
    const settings = readSettings();
    settings.theme = ['classic-beauty', 'windows-xp', 'modern-dashboard', 'midnight-code', 'solarized-sand', 'high-contrast', 'cyber-neon', 'dracula-plum', 'forest-terminal', 'ocean-glass', 'rose-quartz', 'retro-amber'].includes(theme) ? theme : 'modern-dashboard';
    settings.density = density === 'compact' ? 'compact' : 'comfortable';
    writeSettings(settings);
    return { theme: settings.theme, density: settings.density };
  });
  invoke('app:save-appearance', (appearance) => {
    const settings = readSettings();
    settings.theme = ['classic-beauty', 'windows-xp', 'modern-dashboard', 'midnight-code', 'solarized-sand', 'high-contrast', 'cyber-neon', 'dracula-plum', 'forest-terminal', 'ocean-glass', 'rose-quartz', 'retro-amber'].includes(appearance?.theme) ? appearance.theme : 'modern-dashboard';
    settings.density = appearance?.density === 'compact' ? 'compact' : 'comfortable';
    delete settings.customThemes;
    writeSettings(settings);
    return { theme: settings.theme, density: settings.density };
  });
  invoke('converter:choose-source', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Choose SQL or CSV file', properties: ['openFile'], filters: [{ name: 'SQL and CSV', extensions: ['sql', 'csv'] }, { name: 'All files', extensions: ['*'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  invoke('converter:preview-csv', (filePath, options) => converter.previewCsv(filePath, options));
  invoke('converter:run', async (inputPath, options = {}) => {
    const extension = path.extname(inputPath).toLowerCase();
    if (!['.csv', '.sql'].includes(extension)) throw new Error('Choose a .csv or .sql source file.');
    const outputExtension = ['db', 'sqlite', 'sqlite3', 'db3'].includes(options.outputExtension) ? options.outputExtension : 'db';
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Save converted SQLite database', defaultPath: `${path.basename(inputPath, extension)}.${outputExtension}`, filters: [{ name: 'SQLite database', extensions: [outputExtension] }] });
    if (result.canceled || !result.filePath) return null;
    return extension === '.csv' ? converter.convertCsv(inputPath, result.filePath, options) : converter.convertSql(inputPath, result.filePath);
  });
  invoke('app:query-history', (filePath) => (readSettings().queryHistory || {})[filePath] || []);
  invoke('app:add-query-history', (filePath, item) => {
    const settings = readSettings();
    settings.queryHistory ||= {};
    settings.queryHistory[filePath] = [{ ...item, id: crypto.randomUUID(), executedAt: new Date().toISOString() }, ...(settings.queryHistory[filePath] || [])].slice(0, 100);
    writeSettings(settings);
    return settings.queryHistory[filePath];
  });
  invoke('app:clear-query-history', (filePath) => {
    const settings = readSettings();
    settings.queryHistory ||= {};
    settings.queryHistory[filePath] = [];
    writeSettings(settings);
    return [];
  });
  invoke('dialog:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'SQLite databases', extensions: ['db', 'sqlite', 'sqlite3', 'db3'] }, { name: 'All files', extensions: ['*'] }] });
    return result.canceled ? [] : result.filePaths;
  });
  invoke('dialog:create', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: 'database.db', filters: [{ name: 'SQLite database', extensions: ['db'] }] });
    return result.canceled ? null : result.filePath;
  });
  invoke('db:open', (filePath, options) => {
    const data = manager.open(filePath, options);
    rememberFile(filePath);
    watchDatabase(data);
    return data;
  });
  invoke('db:create', (filePath) => {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) throw new Error('A file already exists at that location. Open it instead.');
    const data = manager.open(filePath, { create: true });
    rememberFile(filePath);
    watchDatabase(data);
    return data;
  });
  invoke('db:list', () => manager.list());
  invoke('db:activate', (id) => manager.activate(id));
  invoke('db:close', (id) => { const result = manager.close(id); unwatchClosedFiles(); return result; });
  invoke('db:overview', () => manager.overview());
  invoke('db:rows', (name, options) => manager.getRows(name, options));
  invoke('db:structure', (name) => manager.getStructure(name));
  invoke('db:save-row', (payload) => manager.saveRow(payload));
  invoke('db:delete-rows', (name, identities) => manager.deleteRows(name, identities));
  invoke('db:run-sql', (sql) => manager.runSql(sql));
  invoke('db:create-table', (spec) => manager.createTable(spec));
  invoke('db:plan-table-structure', (name, spec) => manager.planTableStructure(name, spec));
  invoke('db:update-table-structure', (name, spec) => manager.updateTableStructure(name, spec));
  invoke('db:create-index', (spec) => manager.createIndex(spec));
  invoke('db:drop-index', (name) => manager.dropIndex(name));
  invoke('db:save-schema-object', (type, name, sql, originalName) => manager.saveSchemaObject(type, name, sql, originalName));
  invoke('db:drop-schema-object', (type, name) => manager.dropSchemaObject(type, name));
  invoke('db:attached-databases', () => manager.attachedDatabases());
  invoke('db:attach-database', (filePath, schema) => manager.attachDatabase(filePath, schema));
  invoke('db:detach-database', (schema) => manager.detachDatabase(schema));
  invoke('db:set-pragma', (name, value) => manager.setPragma(name, value));
  invoke('db:rename-table', (oldName, newName) => manager.renameTable(oldName, newName));
  invoke('db:drop-object', (name, type) => manager.dropObject(name, type));
  invoke('db:empty-table', (name) => manager.emptyTable(name));
  invoke('db:import-rows', (name, headers, rows) => manager.importRows(name, headers, rows));
  invoke('db:integrity', () => manager.integrityCheck());
  invoke('db:pragmas', () => manager.getPragmas());
  invoke('db:maintenance', (action) => manager.maintenance(action));
  invoke('db:query-templates', (name) => manager.queryTemplates(name));
  invoke('db:backup', async () => {
    manager.requireOpen();
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Backup database', defaultPath: `${path.basename(manager.filePath, path.extname(manager.filePath))}-backup.db`, filters: [{ name: 'SQLite database', extensions: ['db'] }] });
    if (result.canceled) return null;
    await manager.backup(result.filePath);
    return result.filePath;
  });
  invoke('db:export', async (format, objectName) => {
    manager.requireOpen();
    const ext = format === 'json' ? 'json' : format === 'sql' ? 'sql' : 'csv';
    const result = await dialog.showSaveDialog(mainWindow, { title: `Export ${format.toUpperCase()}`, defaultPath: `${objectName || 'database'}.${ext}`, filters: [{ name: `${format.toUpperCase()} file`, extensions: [ext] }] });
    if (result.canceled) return null;
    fs.writeFileSync(result.filePath, manager.exportData(format, objectName), 'utf8');
    return result.filePath;
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch((error) => {
  runtimeLog('ERROR', 'Electron failed before the application window was created', error);
  dialog.showErrorBox('SQLiteScope startup error', error.message || String(error));
  app.quit();
});

app.on('before-quit', () => { runtimeLog('INFO', 'SQLiteScope shutting down'); for (const [file, listener] of watchedFiles) fs.unwatchFile(file, listener); manager.closeAll(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

process.on('uncaughtException', (error) => {
  runtimeLog('ERROR', 'Uncaught exception', error);
  dialog.showErrorBox('SQLiteScope error', error.message || String(error));
});

process.on('unhandledRejection', (reason) => {
  runtimeLog('ERROR', 'Unhandled promise rejection', reason);
});

app.on('ready', () => runtimeLog('INFO', `SQLiteScope ${app.getVersion()} started`));
