const api = window.sqliteScope;

const state = {
  sessions: [],
  activeId: null,
  sessionState: new Map(),
  currentView: 'welcome',
  overview: null,
  currentObject: null,
  currentRows: null,
  currentStructure: null,
  page: 1,
  pageSize: 50,
  filter: '',
  sortColumn: '',
  sortDirection: 'asc',
  hiddenColumns: new Set(),
  selected: new Map(),
  theme: 'modern-dashboard',
  density: 'comfortable',
  sidebarCollapsed: false,
  queryHistory: []
};

const THEMES = [
  { id: 'classic-beauty', name: 'Classic Beauty', description: 'Pure white, black text and crisp black borders', swatches: ['#ffffff', '#000000', '#d9d9d9'] },
  { id: 'windows-xp', name: 'Windows XP', description: 'Blue title bars, warm panels and classic controls', swatches: ['#ece9d8', '#245edb', '#ffffff'] },
  { id: 'modern-dashboard', name: 'Modern Dashboard', description: 'The current clean SQLiteScope dashboard style', swatches: ['#f3f5f9', '#4f46e5', '#ffffff'] },
  { id: 'midnight-code', name: 'Midnight Code', description: 'Dark developer workspace with violet accents', swatches: ['#080d1d', '#7c6cff', '#17213b'] },
  { id: 'solarized-sand', name: 'Solarized Sand', description: 'Warm low-glare palette for long sessions', swatches: ['#fdf6e3', '#268bd2', '#eee8d5'] },
  { id: 'high-contrast', name: 'High Contrast', description: 'Maximum separation and keyboard focus visibility', swatches: ['#000000', '#ffff00', '#ffffff'] }
  ,{ id: 'cyber-neon', name: 'Cyber Neon', description: 'Electric cyan and magenta on a deep futuristic canvas', swatches: ['#070b17', '#00e5ff', '#ff3cac'] }
  ,{ id: 'dracula-plum', name: 'Dracula Plum', description: 'Rich aubergine surfaces with lavender highlights', swatches: ['#21182b', '#bd93f9', '#ff79c6'] }
  ,{ id: 'forest-terminal', name: 'Forest Terminal', description: 'Calm woodland greens inspired by classic terminals', swatches: ['#0d1f17', '#55d187', '#183a29'] }
  ,{ id: 'ocean-glass', name: 'Ocean Glass', description: 'Airy blue panels and crisp ocean accents', swatches: ['#eaf7fb', '#087ea4', '#ffffff'] }
  ,{ id: 'rose-quartz', name: 'Rose Quartz', description: 'Soft blush surfaces with elegant berry accents', swatches: ['#fff5f7', '#b83268', '#f8dce5'] }
  ,{ id: 'retro-amber', name: 'Retro Amber', description: 'Warm amber phosphor styling for a vintage workstation', swatches: ['#18120a', '#ffb000', '#33230d'] }
];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const formatNumber = (value) => new Intl.NumberFormat().format(Number(value || 0));
const formatBytes = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes || 0), index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index ? 1 : 0)} ${units[index]}`;
};
const displayValue = (value) => {
  if (value === null) return '<span class="null-value">NULL</span>';
  if (value && value.__type === 'blob') return `<span class="blob-value">BLOB · ${formatBytes(value.size)}</span>`;
  if (value && value.__type === 'bigint') return escapeHtml(value.value);
  if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
  if (value === '') return '<span class="muted">empty</span>';
  return escapeHtml(value);
};

async function call(promise, options = {}) {
  const response = await promise;
  if (!response?.ok) {
    if (!options.silent) toast(response?.error || 'Something went wrong.', 'error');
    throw new Error(response?.error || 'Operation failed');
  }
  return response.data;
}

function toast(message, type = 'success') {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.textContent = message;
  $('#toast-region').append(node);
  setTimeout(() => node.remove(), 4200);
}

function normalizeTheme(theme) {
  const legacy = { light: 'modern-dashboard', dark: 'midnight-code', midnight: 'midnight-code', system: 'modern-dashboard' };
  const candidate = legacy[theme] || theme;
  return THEMES.some((item) => item.id === candidate) ? candidate : 'modern-dashboard';
}

function setTheme(theme, density = state.density) {
  state.theme = normalizeTheme(theme);
  state.density = density === 'compact' ? 'compact' : 'comfortable';
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.dataset.density = state.density;
}

function showView(name) {
  state.currentView = name;
  ['welcome', 'overview', 'table', 'sql'].forEach((view) => $(`#${view}-view`).classList.toggle('hidden', view !== name));
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
  if (name !== 'table') $$('.object-item').forEach((item) => item.classList.remove('active'));
}

async function initialize() {
  const settings = await call(api.getSettings());
  setTheme(settings.theme || 'modern-dashboard', settings.density || 'comfortable');
  setSidebarCollapsed(localStorage.getItem('sqlitescope.sidebarCollapsed') === 'true');
  renderRecents(settings.recentFiles || []);
  wireEvents();
}

function renderRecents(files) {
  const valid = files.slice(0, 5);
  $('#recent-section').classList.toggle('hidden', !valid.length);
  $('#recent-list').innerHTML = valid.map((file) => {
    const parts = file.replace(/\\/g, '/').split('/');
    return `<button class="recent-file" data-path="${escapeHtml(file)}"><span>◫</span><strong>${escapeHtml(parts.pop())}</strong><span>${escapeHtml(parts.join('/'))}</span></button>`;
  }).join('');
  $$('.recent-file').forEach((button) => button.addEventListener('click', () => openDatabase(button.dataset.path)));
}

async function chooseAndOpen() {
  const filePaths = await call(api.chooseDatabase());
  for (const filePath of (Array.isArray(filePaths) ? filePaths : [filePaths]).filter(Boolean)) await openDatabase(filePath);
}

async function chooseAndCreate() {
  const filePath = await call(api.chooseNewDatabase());
  if (filePath) await createDatabase(filePath);
}

async function openDatabase(filePath, readonly = false) {
  const overview = await call(api.openDatabase(filePath, { readonly }));
  applyOverview(overview);
  await refreshSessions();
  toast(`Opened ${overview.fileName}${readonly ? ' in read-only mode' : ''}.`);
}

async function createDatabase(filePath) {
  const overview = await call(api.createDatabase(filePath));
  applyOverview(overview);
  await refreshSessions();
  toast(`Created ${overview.fileName}.`);
  openCreateTableModal();
}

function applyOverview(overview) {
  state.overview = overview;
  state.activeId = overview.id;
  state.currentObject = null;
  state.selected.clear();
  $('#workspace').classList.remove('empty');
  setSidebarCollapsed(state.sidebarCollapsed);
  renderSidebar();
  renderOverview();
  loadQueryHistory();
  showView('overview');
}

async function loadQueryHistory() {
  if (!state.overview) return;
  state.queryHistory = await call(api.queryHistory(state.overview.filePath));
  renderQueryHistory();
}

function renderQueryHistory() {
  const target = $('#query-history-list');
  if (!target) return;
  target.innerHTML = state.queryHistory.length ? state.queryHistory.map((item, index) => `<div class="query-history-item"><div><pre>${escapeHtml(item.sql)}</pre><div class="query-history-meta">${new Date(item.executedAt).toLocaleString()} · ${Number(item.elapsedMs || 0).toFixed(2)} ms · ${item.ok ? 'Success' : 'Failed'}${item.summary ? ` · ${escapeHtml(item.summary)}` : ''}</div></div><div class="query-history-actions"><button class="text-button history-load" data-history="${index}">Load</button><button class="text-button history-run" data-history="${index}">Run</button></div></div>`).join('') : '<div class="result-placeholder">No queries executed yet.</div>';
  $$('.history-load').forEach((button) => button.addEventListener('click', () => { $('#sql-editor').value = state.queryHistory[Number(button.dataset.history)].sql; showView('sql'); $('#sql-editor').focus(); }));
  $$('.history-run').forEach((button) => button.addEventListener('click', async () => { $('#sql-editor').value = state.queryHistory[Number(button.dataset.history)].sql; showView('sql'); await runSql(); }));
}

async function refreshSessions() {
  state.sessions = await call(api.listDatabases());
  const tabs = $('#database-tabs');
  tabs.classList.toggle('visible', state.sessions.length > 0);
  tabs.innerHTML = state.sessions.map((session) => `<button class="database-tab ${session.active ? 'active' : ''}" data-session="${escapeHtml(session.id)}" title="${escapeHtml(session.filePath)}"><span>▤</span><span class="database-tab-name">${escapeHtml(session.fileName)}</span>${session.readonly ? '<span class="database-tab-ro">RO</span>' : ''}<span class="database-tab-close" data-close-session="${escapeHtml(session.id)}" title="Close database">×</span></button>`).join('');
  $$('.database-tab').forEach((tab) => tab.addEventListener('click', (event) => {
    if (!event.target.closest('[data-close-session]')) activateDatabase(tab.dataset.session);
  }));
  $$('[data-close-session]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation();
    closeDatabase(button.dataset.closeSession);
  }));
}

function rememberActiveUi() {
  if (!state.activeId) return;
  state.sessionState.set(state.activeId, {
    currentObject: state.currentObject,
    page: state.page,
    pageSize: state.pageSize,
    filter: state.filter,
    sortColumn: state.sortColumn,
    sortDirection: state.sortDirection,
    currentView: state.currentView,
    sql: $('#sql-editor').value
  });
}

async function activateDatabase(id) {
  if (!id || id === state.activeId) return;
  rememberActiveUi();
  const overview = await call(api.activateDatabase(id));
  const saved = state.sessionState.get(id);
  applyOverview(overview);
  if (saved) {
    Object.assign(state, saved);
    $('#sql-editor').value = saved.sql || '';
    $('#page-size').value = String(saved.pageSize || 50);
    $('#row-filter').value = saved.filter || '';
    if (saved.currentObject && overview.objects.some((item) => item.name === saved.currentObject)) {
      await loadRows();
      await loadStructure();
      renderSidebar();
      showView(saved.currentView === 'sql' ? 'sql' : 'table');
    } else showView(saved.currentView === 'sql' ? 'sql' : 'overview');
  }
  await refreshSessions();
}

async function closeDatabase(id = state.activeId) {
  if (!id) return;
  const session = state.sessions.find((item) => item.id === id);
  if (!session) return;
  const closeNow = async () => {
    closeModal();
    state.sessionState.delete(id);
    const wasActive = id === state.activeId;
    const result = await call(api.closeDatabase(id));
    if (result.active && wasActive) {
      applyOverview(result.active);
      await refreshSessions();
    } else if (result.active) {
      await refreshSessions();
    } else {
      state.overview = null;
      state.activeId = null;
      state.currentObject = null;
      $('#workspace').classList.add('empty');
      await refreshSessions();
      showView('welcome');
    }
    toast(`Closed ${session.fileName}.`);
  };
  confirmDialog(`Close ${session.fileName}?`, 'The database connection will be closed. Changes already made are saved immediately.', 'Close database', closeNow, false);
}

async function refreshOverview(keepView = true) {
  const overview = await call(api.overview());
  state.overview = overview;
  renderSidebar();
  renderOverview();
  if (!keepView) showView('overview');
}

function renderSidebar() {
  const query = $('#object-search').value.trim().toLowerCase();
  const objects = state.overview.objects.filter((item) => item.name.toLowerCase().includes(query));
  const group = (type, title) => {
    const items = objects.filter((item) => item.type === type);
    if (!items.length) return '';
    return `<div class="object-heading">${title} · ${items.length}</div>${items.map((item) => `<button class="object-item ${state.currentObject === item.name ? 'active' : ''}" data-object="${escapeHtml(item.name)}"><span class="object-icon">${type === 'table' ? '▤' : '◈'}</span><span class="object-name">${escapeHtml(item.name)}</span><span class="object-count">${formatNumber(item.rowCount)}</span></button>`).join('')}`;
  };
  $('#object-groups').innerHTML = group('table', 'Tables') + group('view', 'Views') || '<div class="empty-state"><span>No matching objects</span></div>';
  $$('.object-item').forEach((button) => button.addEventListener('click', () => openObject(button.dataset.object)));
}

function renderOverview() {
  const data = state.overview;
  $('#overview-title').textContent = data.fileName;
  $('#overview-path').textContent = data.filePath;
  $('#stat-grid').innerHTML = [
    ['Tables', data.tableCount], ['Views', data.viewCount], ['Indexes', data.indexCount], ['Database size', formatBytes(data.size)],
    ['Triggers', data.triggerCount], ['SQLite version', data.sqliteVersion], ['Page size', formatBytes(data.pageSize)], ['Modified', new Date(data.modifiedAt).toLocaleString()]
  ].map(([label, value]) => `<div class="stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  $('#overview-objects').innerHTML = data.objects.length ? data.objects.map((item) => `<tr><td><button class="object-link" data-object="${escapeHtml(item.name)}">${escapeHtml(item.name)}</button></td><td><span class="badge ${item.type}">${item.type}</span></td><td>${formatNumber(item.rowCount)}</td><td><div class="row-actions"><button class="action-icon browse-object" data-object="${escapeHtml(item.name)}" title="Browse ${escapeHtml(item.name)}" aria-label="Browse ${escapeHtml(item.name)}">${icon('table')}</button><button class="action-icon copy-object-name" data-name="${escapeHtml(item.name)}" title="Copy object name" aria-label="Copy object name">${icon('copy')}</button>${item.type === 'table' && !data.readonly ? `<button class="action-icon danger drop-object" data-object="${escapeHtml(item.name)}" data-type="table" title="Drop table" aria-label="Drop table ${escapeHtml(item.name)}">${icon('trash')}</button>` : ''}</div></td></tr>`).join('') : '<tr><td colspan="4"><div class="empty-state"><strong>No tables yet</strong><span>Create your first table to begin.</span></div></td></tr>';
  $$('.object-link, .browse-object').forEach((button) => button.addEventListener('click', () => openObject(button.dataset.object)));
  $$('.drop-object').forEach((button) => button.addEventListener('click', () => confirmDrop(button.dataset.object, button.dataset.type)));
  $$('.copy-object-name').forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText(button.dataset.name); toast('Object name copied.'); }));
  $$('#new-table-button, #overview-new-table').forEach((button) => button.classList.toggle('hidden', data.readonly));
  $$('.schema-create').forEach((button) => button.classList.toggle('hidden', data.readonly));
}

async function openObject(name) {
  state.currentObject = name;
  state.page = 1;
  state.filter = '';
  state.sortColumn = '';
  state.selected.clear();
  $('#row-filter').value = '';
  await loadRows();
  await loadStructure();
  renderSidebar();
  showTableTab('browse');
  showView('table');
}

async function loadRows() {
  const data = await call(api.rows(state.currentObject, { page: state.page, limit: state.pageSize, filter: state.filter, sortColumn: state.sortColumn, sortDirection: state.sortDirection }));
  state.currentRows = data;
  state.page = Math.min(state.page, data.pages);
  renderRows();
}

async function loadStructure() {
  state.currentStructure = await call(api.structure(state.currentObject));
  renderStructure();
}

function renderRows() {
  const data = state.currentRows;
  $('#table-title').textContent = data.name;
  $('#object-type-label').textContent = data.type.toUpperCase();
  $$('.table-only').forEach((button) => button.classList.toggle('hidden', data.type !== 'table' || state.overview.readonly));
  const visibleColumns = data.columns.map((column) => column.name).filter((name) => !state.hiddenColumns.has(name));
  const identityColumn = data.identity.usesRowid ? ['__sqlitescope_rowid__'] : [];
  $('#data-head').innerHTML = `<tr>${data.editable ? '<th class="sticky-select"><input type="checkbox" id="select-all" aria-label="Select all visible rows"></th><th class="sticky-actions">Actions</th>' : ''}${visibleColumns.map((column) => `<th><button class="sort-button" data-sort="${escapeHtml(column)}">${escapeHtml(column)} ${state.sortColumn === column ? (state.sortDirection === 'asc' ? '↑' : '↓') : ''}</button></th>`).join('')}</tr>`;
  $('#data-body').innerHTML = data.rows.map((row, index) => {
    const identity = Object.fromEntries(data.identity.columns.map((key) => [key, row[key]]));
    const identityJson = escapeHtml(JSON.stringify(identity));
    return `<tr>${data.editable ? `<td class="sticky-select"><input type="checkbox" class="row-select" aria-label="Select row ${index + 1}" data-index="${index}" data-identity="${identityJson}"></td><td class="sticky-actions"><div class="row-actions"><button class="action-icon view-row" data-index="${index}" title="View row details" aria-label="View row details">${icon('eye')}</button><button class="action-icon edit-row" data-index="${index}" title="Edit row" aria-label="Edit row">${icon('edit')}</button><button class="action-icon duplicate-row" data-index="${index}" title="Duplicate row" aria-label="Duplicate row">${icon('copy')}</button><button class="action-icon danger delete-row" data-identity="${identityJson}" title="Delete row" aria-label="Delete row">${icon('trash')}</button></div></td>` : ''}${visibleColumns.map((column) => `<td class="data-cell" data-row="${index}" data-column="${escapeHtml(column)}" title="${escapeHtml(valueAsText(row[column]))}">${displayValue(row[column])}</td>`).join('')}</tr>`;
  }).join('');
  $('#rows-empty').classList.toggle('hidden', data.rows.length > 0);
  $('#row-summary').textContent = `${formatNumber(data.total)} row${Number(data.total) === 1 ? '' : 's'}${state.filter ? ' matching filter' : ''}`;
  $('#page-summary').textContent = `Page ${data.page} of ${data.pages}`;
  $('#prev-page').disabled = data.page <= 1;
  $('#next-page').disabled = data.page >= data.pages;
  $('#selection-bar').classList.add('hidden');
  state.selected.clear();
  $('#select-all')?.addEventListener('change', (event) => {
    $$('.row-select').forEach((checkbox) => { checkbox.checked = event.target.checked; checkbox.dispatchEvent(new Event('change')); });
  });
  $$('.row-select').forEach((checkbox) => checkbox.addEventListener('change', () => {
    const identity = JSON.parse(checkbox.dataset.identity);
    if (checkbox.checked) state.selected.set(checkbox.dataset.index, identity); else state.selected.delete(checkbox.dataset.index);
    updateSelection();
  }));
  $$('.edit-row').forEach((button) => button.addEventListener('click', () => openRowModal('update', data.rows[Number(button.dataset.index)])));
  $$('.view-row').forEach((button) => button.addEventListener('click', () => openRowDetails(data.rows[Number(button.dataset.index)])));
  $$('.duplicate-row').forEach((button) => button.addEventListener('click', () => openDuplicateRow(data.rows[Number(button.dataset.index)])));
  $$('.delete-row').forEach((button) => button.addEventListener('click', () => confirmDeleteRows([JSON.parse(button.dataset.identity)])));
  $$('.data-cell').forEach((cell) => cell.addEventListener('contextmenu', async (event) => { event.preventDefault(); const row = data.rows[Number(cell.dataset.row)]; await navigator.clipboard.writeText(valueAsText(row[cell.dataset.column])); toast(`Copied ${cell.dataset.column}.`); }));
  $$('.sort-button').forEach((button) => button.addEventListener('click', async () => {
    const column = button.dataset.sort;
    if (state.sortColumn === column) state.sortDirection = state.sortDirection === 'asc' ? 'desc' : 'asc';
    else { state.sortColumn = column; state.sortDirection = 'asc'; }
    await loadRows();
  }));
  void identityColumn;
}

function icon(name) {
  const paths = {
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4l11-11-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>',
    columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
    table: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 10v9"/>',
    refresh: '<path d="M20 6v5h-5"/><path d="M18.5 15a7 7 0 1 1-.7-7.7L20 10"/>',
    panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    code: '<path d="m8 9-3 3 3 3m8-6 3 3-3 3m-2-9-4 12"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M5 20h14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>'
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function openRowDetails(row) {
  const body = state.currentRows.columns.map((column) => `<div class="row-detail"><strong>${escapeHtml(column.name)}</strong><div>${displayValue(row[column.name])}</div><button class="action-icon copy-detail" data-column="${escapeHtml(column.name)}" title="Copy value" aria-label="Copy ${escapeHtml(column.name)}">${icon('copy')}</button></div>`).join('');
  openModal({ eyebrow: 'ROW DETAILS', title: `${state.currentRows.name} record`, body: `<div class="row-detail-list">${body}</div>`, actions: '<button class="button secondary" data-modal-cancel>Close</button>', wide: true });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $$('.copy-detail').forEach((button) => button.addEventListener('click', async () => { await navigator.clipboard.writeText(valueAsText(row[button.dataset.column])); toast(`Copied ${button.dataset.column}.`); }));
}

function openDuplicateRow(row) {
  const copy = { ...row };
  const uniqueNames = new Set((state.currentStructure?.indexes || []).filter((index) => index.unique && index.columns?.length === 1).map((index) => index.columns[0].name));
  for (const column of state.currentRows.columns) {
    if (column.pk && /INT/i.test(column.type || '')) copy[column.name] = null;
    else if (uniqueNames.has(column.name) && typeof copy[column.name] === 'string' && copy[column.name]) copy[column.name] = `${copy[column.name]}-copy-${Date.now().toString(36)}`;
  }
  delete copy.__sqlitescope_rowid__;
  openRowModal('insert', copy);
  $('#modal-eyebrow').textContent = 'DUPLICATE RECORD';
  $('#modal-title').textContent = `Duplicate row in ${state.currentRows.name}`;
  if (uniqueNames.size) $('#modal-body').insertAdjacentHTML('afterbegin', `<div class="warning-box">Unique text fields were given conflict-safe copy values. Review them before inserting.</div>`);
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = Boolean(collapsed);
  $('#workspace')?.classList.toggle('sidebar-collapsed', state.sidebarCollapsed);
  $('#sidebar-restore')?.classList.toggle('hidden', !state.sidebarCollapsed || !state.overview);
  localStorage.setItem('sqlitescope.sidebarCollapsed', String(state.sidebarCollapsed));
}

function toggleSidebar() { if (state.overview) setSidebarCollapsed(!state.sidebarCollapsed); }

function openColumnChooser() {
  const columns = state.currentRows?.columns || [];
  openModal({ eyebrow: 'TABLE DISPLAY', title: 'Choose visible columns', body: `<div class="column-visibility-list">${columns.map((column) => `<label><input type="checkbox" data-visible-column="${escapeHtml(column.name)}" ${state.hiddenColumns.has(column.name) ? '' : 'checked'}> <span>${escapeHtml(column.name)}</span><small>${escapeHtml(column.type || '')}</small></label>`).join('')}</div>`, actions: '<button class="button secondary" id="show-all-columns">Show all</button><button class="button primary" id="apply-columns">Apply</button>' });
  $('#show-all-columns').addEventListener('click', () => $$('[data-visible-column]').forEach((item) => { item.checked = true; }));
  $('#apply-columns').addEventListener('click', () => { state.hiddenColumns = new Set($$('[data-visible-column]').filter((item) => !item.checked).map((item) => item.dataset.visibleColumn)); closeModal(); renderRows(); });
}

function valueAsText(value) {
  if (value === null) return 'NULL';
  if (value && value.__type === 'blob') return `BLOB (${value.size} bytes)`;
  if (value && value.__type === 'bigint') return value.value;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function updateSelection() {
  $('#selection-count').textContent = `${state.selected.size} row${state.selected.size === 1 ? '' : 's'} selected`;
  $('#selection-bar').classList.toggle('hidden', state.selected.size === 0);
}

function renderStructure() {
  const data = state.currentStructure;
  const columnRows = data.columns.map((column) => `<tr><td><strong>${escapeHtml(column.name)}</strong></td><td>${escapeHtml(column.type || '—')}</td><td>${column.pk ? `<span class="badge">PK ${column.pk}</span>` : '—'}</td><td>${column.notnull ? 'Yes' : 'No'}</td><td>${column.dflt_value === null ? '<span class="null-value">None</span>' : escapeHtml(column.dflt_value)}</td></tr>`).join('');
  const indexRows = data.indexes.map((index) => `<tr><td>${escapeHtml(index.name)}</td><td>${index.unique ? 'Unique' : 'Non-unique'}</td><td>${escapeHtml(index.columns.map((column) => column.name).join(', '))}</td><td>${escapeHtml(index.origin)}</td></tr>`).join('');
  const foreignRows = data.foreignKeys.map((fk) => `<tr><td>${escapeHtml(fk.from)}</td><td>${escapeHtml(fk.table)}.${escapeHtml(fk.to)}</td><td>${escapeHtml(fk.on_update)}</td><td>${escapeHtml(fk.on_delete)}</td></tr>`).join('');
  $('#structure-tab').innerHTML = `
    <div class="structure-section"><div class="panel-heading"><div><h3>Columns</h3></div>${data.type === 'table' && !state.overview.readonly ? '<button class="button primary small" id="edit-structure">Edit structure</button>' : ''}</div><div class="structure-card table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Key</th><th>Not null</th><th>Default</th></tr></thead><tbody>${columnRows || '<tr><td colspan="5">No columns</td></tr>'}</tbody></table></div></div>
    <div class="structure-section"><div class="panel-heading"><h3>Indexes</h3>${data.type === 'table' && !state.overview.readonly ? '<button class="button secondary small" id="create-index">＋ Create index</button>' : ''}</div><div class="structure-card table-wrap"><table><thead><tr><th>Name</th><th>Kind</th><th>Columns</th><th>Origin</th><th></th></tr></thead><tbody>${data.indexes.map((index) => `<tr><td>${escapeHtml(index.name)}</td><td>${index.unique ? 'Unique' : 'Non-unique'}</td><td>${escapeHtml(index.columns.map((column) => column.name).join(', '))}</td><td>${escapeHtml(index.origin)}</td><td>${index.origin === 'c' && !state.overview.readonly ? `<button class="action-icon danger drop-index" data-index-name="${escapeHtml(index.name)}" title="Drop index" aria-label="Drop index ${escapeHtml(index.name)}">${icon('trash')}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No indexes</td></tr>'}</tbody></table></div></div>
    <div class="structure-section"><div class="panel-heading"><div><h3>Foreign keys</h3><p>Edit these through the safe structure migration.</p></div>${data.type === 'table' && !state.overview.readonly ? '<button class="button secondary small" id="edit-foreign-keys">Edit foreign keys</button>' : ''}</div><div class="structure-card table-wrap"><table><thead><tr><th>Column</th><th>References</th><th>On update</th><th>On delete</th></tr></thead><tbody>${foreignRows || '<tr><td colspan="4" class="muted">No foreign keys</td></tr>'}</tbody></table></div></div>
    <div class="structure-section"><div class="panel-heading"><h3>Triggers</h3>${!state.overview.readonly ? '<button class="button secondary small create-trigger-here">＋ Create trigger</button>' : ''}</div><div class="structure-card table-wrap"><table><thead><tr><th>Name</th><th>SQL</th><th></th></tr></thead><tbody>${data.triggers.map((trigger, index) => `<tr><td>${escapeHtml(trigger.name)}</td><td><code>${escapeHtml(trigger.sql)}</code></td><td>${!state.overview.readonly ? `<div class="row-actions"><button class="action-icon edit-trigger" data-trigger-index="${index}" title="Edit trigger" aria-label="Edit trigger ${escapeHtml(trigger.name)}">${icon('edit')}</button><button class="action-icon danger drop-trigger" data-trigger-name="${escapeHtml(trigger.name)}" title="Drop trigger" aria-label="Drop trigger ${escapeHtml(trigger.name)}">${icon('trash')}</button></div>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">No triggers</td></tr>'}</tbody></table></div></div>
    ${data.type === 'table' && !state.overview.readonly ? `<div class="structure-section"><h3>Table management</h3><div class="structure-card"><div class="panel-heading"><div><p>Rename, empty, or permanently remove this table.</p></div><div class="heading-actions"><button class="button secondary small" id="rename-table">Rename</button><button class="button secondary small" id="empty-table">Empty table</button><button class="button danger small" id="drop-current">Drop table</button></div></div></div></div>` : ''}
    ${data.type === 'view' && !state.overview.readonly ? `<div class="structure-section"><h3>View management</h3><div class="structure-card"><div class="panel-heading"><p>Edit the full view definition or remove it.</p><div class="heading-actions"><button class="button secondary small" id="edit-view">Edit view</button><button class="button danger small" id="drop-view">Drop view</button></div></div></div></div>` : ''}`;
  $('#schema-code').textContent = data.createSql || '-- SQL definition is unavailable.';
  $('#rename-table')?.addEventListener('click', openRenameModal);
  $('#edit-structure')?.addEventListener('click', openStructureEditor);
  $('#edit-foreign-keys')?.addEventListener('click', openStructureEditor);
  $('#create-index')?.addEventListener('click', openIndexEditor);
  $$('.drop-index').forEach((button) => button.addEventListener('click', () => confirmDialog('Drop index?', `Index ${button.dataset.indexName} will be permanently removed.`, 'Drop index', async () => { await call(api.dropIndex(button.dataset.indexName)); closeModal(); await loadStructure(); toast('Index dropped.'); })));
  $('#empty-table')?.addEventListener('click', () => confirmEmpty(data.name));
  $('#drop-current')?.addEventListener('click', () => confirmDrop(data.name, data.type));
  $('#edit-view')?.addEventListener('click', () => openSchemaObjectEditor('view', data.name, data.createSql));
  $('#drop-view')?.addEventListener('click', () => confirmDrop(data.name, 'view'));
  $('.create-trigger-here')?.addEventListener('click', () => openSchemaObjectEditor('trigger'));
  $$('.edit-trigger').forEach((button) => button.addEventListener('click', () => { const trigger = data.triggers[Number(button.dataset.triggerIndex)]; openSchemaObjectEditor('trigger', trigger.name, trigger.sql); }));
  $$('.drop-trigger').forEach((button) => button.addEventListener('click', () => confirmDialog('Drop trigger?', `Trigger ${button.dataset.triggerName} will be permanently removed.`, 'Drop trigger', async () => { await call(api.dropSchemaObject('trigger', button.dataset.triggerName)); closeModal(); await loadStructure(); toast('Trigger dropped.'); })));
}

function openStructureEditor() {
  const data = state.currentStructure;
  openModal({ eyebrow: 'SAFE SCHEMA MIGRATION', title: `Edit structure of ${data.name}`, body: `<p class="muted">Edit columns, constraints, foreign keys, CHECK rules, and table options. SQLiteScope rebuilds the table transactionally and validates references before committing.</p><div class="structure-section" style="margin-top:16px"><h3>Columns</h3><div id="structure-column-list"></div><button class="text-button" id="structure-add-column">＋ Add column</button></div><div class="structure-section"><h3>Foreign keys</h3><div id="foreign-key-list"></div><button class="text-button" id="add-foreign-key">＋ Add foreign key</button></div><div class="structure-section"><h3>CHECK constraints</h3><div id="check-list"></div><button class="text-button" id="add-check">＋ Add CHECK constraint</button></div><div class="structure-card" style="padding:14px"><label><input type="checkbox" id="without-rowid" ${data.withoutRowid ? 'checked' : ''}> WITHOUT ROWID</label>&nbsp;&nbsp;<label><input type="checkbox" id="strict-table" ${data.strict ? 'checked' : ''}> STRICT table</label></div><div id="migration-plan" class="hidden"><div class="warning-box" id="migration-warnings"></div><pre class="code-block migration-preview" id="migration-sql"></pre></div>`, actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button secondary" id="preview-structure">Preview migration</button><button class="button primary" id="apply-structure" disabled>Apply changes</button>', wide: true });
  const addColumn = (column = {}) => {
    const node = document.createElement('div');
    node.className = 'column-builder structure-editor';
    node.dataset.originalName = column.originalName || '';
    const type = column.type || 'TEXT';
    node.innerHTML = `<input class="column-name" aria-label="Column name" placeholder="Column name" value="${escapeHtml(column.name || '')}"><input class="column-type" aria-label="Declared type" placeholder="Type" value="${escapeHtml(type)}"><input class="column-default" aria-label="Default SQL value" placeholder="Default (SQL)" value="${escapeHtml(column.defaultValue ?? '')}"><label><input type="checkbox" class="column-pk" ${column.primaryKey ? 'checked' : ''}> PK</label><label><input type="checkbox" class="column-nn" ${column.notNull ? 'checked' : ''}> Not null</label><label><input type="checkbox" class="column-unique" ${column.unique ? 'checked' : ''}> Unique</label><button class="mini-button remove-column" title="Remove column">×</button>`;
    $('#structure-column-list').append(node);
    node.querySelector('.remove-column').addEventListener('click', () => { node.remove(); $('#apply-structure').disabled = true; });
    node.querySelectorAll('input').forEach((input) => input.addEventListener('input', () => { $('#apply-structure').disabled = true; $('#migration-plan').classList.add('hidden'); }));
  };
  const uniqueColumns = new Set(data.indexes.filter((index) => index.unique && index.origin === 'u' && index.columns.length === 1).map((index) => index.columns[0].name));
  data.columns.forEach((column) => addColumn({ originalName: column.name, name: column.name, type: column.type, primaryKey: Boolean(column.pk), notNull: Boolean(column.notnull), unique: uniqueColumns.has(column.name), defaultValue: column.dflt_value ?? '' }));
  const actions = ['NO ACTION', 'RESTRICT', 'SET NULL', 'SET DEFAULT', 'CASCADE'];
  const addForeignKey = (fk = {}) => {
    const node = document.createElement('div'); node.className = 'column-builder foreign-key-builder';
    const option = (value, selected) => `<option ${value === selected ? 'selected' : ''}>${value}</option>`;
    node.innerHTML = `<input class="fk-columns" placeholder="Local columns (comma-separated)" value="${escapeHtml((fk.columns || []).join(', '))}"><input class="fk-table" placeholder="Referenced table" value="${escapeHtml(fk.referenceTable || '')}"><input class="fk-ref-columns" placeholder="Referenced columns" value="${escapeHtml((fk.referenceColumns || []).join(', '))}"><select class="fk-update" title="ON UPDATE">${actions.map((v) => option(v, fk.onUpdate || 'NO ACTION')).join('')}</select><select class="fk-delete" title="ON DELETE">${actions.map((v) => option(v, fk.onDelete || 'NO ACTION')).join('')}</select><label><input type="checkbox" class="fk-deferred" ${fk.deferred ? 'checked' : ''}> Deferred</label><button class="mini-button remove-fk">×</button>`;
    $('#foreign-key-list').append(node); node.querySelector('.remove-fk').addEventListener('click', () => node.remove());
  };
  const grouped = new Map(); data.foreignKeys.forEach((fk) => { if (!grouped.has(fk.id)) grouped.set(fk.id, { columns: [], referenceColumns: [], referenceTable: fk.table, onUpdate: fk.on_update, onDelete: fk.on_delete }); const item = grouped.get(fk.id); item.columns[fk.seq] = fk.from; item.referenceColumns[fk.seq] = fk.to; });
  [...grouped.values()].forEach(addForeignKey);
  const addCheck = (expression = '') => { const node = document.createElement('div'); node.className = 'column-builder check-builder'; node.innerHTML = `<input class="check-expression" placeholder="e.g. amount >= 0" value="${escapeHtml(expression)}"><button class="mini-button remove-check">×</button>`; $('#check-list').append(node); node.querySelector('.remove-check').addEventListener('click', () => node.remove()); };
  data.checks.forEach((item) => addCheck(item.expression));
  const split = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
  const collect = () => ({ columns: $$('#structure-column-list .column-builder').map((row) => ({ originalName: row.dataset.originalName, name: row.querySelector('.column-name').value, type: row.querySelector('.column-type').value, defaultValue: row.querySelector('.column-default').value, primaryKey: row.querySelector('.column-pk').checked, notNull: row.querySelector('.column-nn').checked, unique: row.querySelector('.column-unique').checked })), foreignKeys: $$('.foreign-key-builder').map((row) => ({ columns: split(row.querySelector('.fk-columns').value), referenceTable: row.querySelector('.fk-table').value, referenceColumns: split(row.querySelector('.fk-ref-columns').value), onUpdate: row.querySelector('.fk-update').value, onDelete: row.querySelector('.fk-delete').value, deferred: row.querySelector('.fk-deferred').checked })), checks: $$('.check-builder').map((row) => ({ expression: row.querySelector('.check-expression').value })), withoutRowid: $('#without-rowid').checked, strict: $('#strict-table').checked });
  let approvedSpec = null;
  $('#structure-add-column').addEventListener('click', () => { addColumn(); $('#apply-structure').disabled = true; });
  $('#add-foreign-key').addEventListener('click', () => addForeignKey());
  $('#add-check').addEventListener('click', () => addCheck());
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $('#preview-structure').addEventListener('click', async () => {
    approvedSpec = collect();
    const plan = await call(api.planTableStructure(data.name, approvedSpec));
    $('#migration-warnings').innerHTML = plan.warnings.length ? plan.warnings.map(escapeHtml).join('<br>') : 'No destructive column removals detected. A transaction and foreign-key validation will protect the migration.';
    $('#migration-sql').textContent = plan.previewSql;
    $('#migration-plan').classList.remove('hidden');
    $('#apply-structure').disabled = false;
  });
  $('#apply-structure').addEventListener('click', async () => {
    if (!approvedSpec) return;
    await call(api.updateTableStructure(data.name, approvedSpec));
    closeModal();
    await refreshOverview(false);
    await openObject(data.name);
    showTableTab('structure');
    toast(`Structure of ${data.name} updated.`);
  });
}

function openIndexEditor() {
  const data = state.currentStructure;
  openModal({ eyebrow: 'INDEX DESIGNER', title: `Create index on ${data.name}`, body: `<div class="form-grid"><div class="form-field"><label>Index name</label><input id="index-name" value="idx_${escapeHtml(data.name)}_"></div><div class="form-field"><label>Columns or expressions</label><input id="index-columns" placeholder="email, lower(name)"></div><div class="form-field"><label>Partial-index WHERE condition (optional)</label><input id="index-where" placeholder="active = 1"></div><div class="form-field"><label><input type="checkbox" id="index-unique"> Unique index</label></div></div>`, actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button primary" id="save-index">Create index</button>', wide: true });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $('#save-index').addEventListener('click', async () => { const terms = $('#index-columns').value.split(',').map((value) => value.trim()).filter(Boolean).map((value) => data.columns.some((c) => c.name === value) ? { name: value } : { expression: value }); await call(api.createIndex({ table: data.name, name: $('#index-name').value, columns: terms, where: $('#index-where').value, unique: $('#index-unique').checked })); closeModal(); await loadStructure(); toast('Index created.'); });
}

function showTableTab(name) {
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tableTab === name));
  ['browse', 'structure', 'schema'].forEach((tab) => $(`#${tab}-tab`).classList.toggle('hidden', tab !== name));
}

function openModal({ eyebrow = '', title, body, actions, wide = false }) {
  $('#modal-eyebrow').textContent = eyebrow;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = body;
  $('#modal-actions').innerHTML = actions;
  $('#modal').style.width = wide ? 'min(960px, 100%)' : '';
  $('#modal-backdrop').classList.remove('hidden');
}

function closeModal() { $('#modal-backdrop').classList.add('hidden'); }

function openRowModal(mode, row = {}) {
  const data = state.currentRows;
  const fields = data.columns.map((column) => {
    const raw = mode === 'update' || Object.prototype.hasOwnProperty.call(row, column.name) ? row[column.name] : (column.dflt_value ?? '');
    const isNull = raw === null;
    const value = raw && raw.__type === 'blob' ? raw.base64 : raw && raw.__type === 'bigint' ? raw.value : raw;
    return `<div class="form-field ${String(value).length > 80 ? 'full' : ''}"><label><span>${escapeHtml(column.name)} <small>${escapeHtml(column.type || '')}</small></span><span class="null-check"><input type="checkbox" class="null-toggle" data-field="${escapeHtml(column.name)}" ${isNull ? 'checked' : ''}> NULL</span></label><textarea class="row-field" data-column="${escapeHtml(column.name)}" ${isNull ? 'disabled' : ''}>${escapeHtml(value ?? '')}</textarea></div>`;
  }).join('');
  openModal({ eyebrow: mode === 'insert' ? 'NEW RECORD' : 'EDIT RECORD', title: `${mode === 'insert' ? 'Add row to' : 'Edit row in'} ${data.name}`, body: `<div class="form-grid">${fields}</div>`, actions: `<button class="button secondary" data-modal-cancel>Cancel</button><button class="button primary" id="save-row">${mode === 'insert' ? 'Insert row' : 'Save changes'}</button>`, wide: true });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $$('.null-toggle').forEach((checkbox) => checkbox.addEventListener('change', () => {
    $(`.row-field[data-column="${CSS.escape(checkbox.dataset.field)}"]`).disabled = checkbox.checked;
  }));
  $('#save-row').addEventListener('click', async () => {
    const values = {};
    $$('.row-field').forEach((field) => {
      const nullToggle = $(`.null-toggle[data-field="${CSS.escape(field.dataset.column)}"]`);
      values[field.dataset.column] = nullToggle.checked ? { __type: 'null' } : field.value;
    });
    const originalIdentity = mode === 'update' ? Object.fromEntries(data.identity.columns.map((key) => [key, row[key]])) : {};
    await call(api.saveRow({ table: data.name, mode, values, originalIdentity }));
    closeModal();
    await refreshOverview();
    await loadRows();
    toast(mode === 'insert' ? 'Row inserted.' : 'Row updated.');
  });
}

function openCreateTableModal() {
  if (!state.overview || state.overview.readonly) return;
  openModal({ eyebrow: 'SCHEMA DESIGNER', title: 'Create a new table', body: `<div class="form-field"><label>Table name</label><input id="new-table-name" placeholder="e.g. customers"></div><div class="structure-section" style="margin-top:18px"><h3>Columns</h3><div id="column-list"></div><button class="text-button" id="add-column">＋ Add column</button></div>`, actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button primary" id="create-table-save">Create table</button>', wide: true });
  const addColumn = (values = {}) => {
    const node = document.createElement('div');
    node.className = 'column-builder';
    node.innerHTML = `<input class="column-name" placeholder="Column name" value="${escapeHtml(values.name || '')}"><select class="column-type"><option>INTEGER</option><option ${values.type === 'TEXT' ? 'selected' : ''}>TEXT</option><option>REAL</option><option>BLOB</option><option>NUMERIC</option></select><label><input type="checkbox" class="column-pk" ${values.pk ? 'checked' : ''}> PK</label><label><input type="checkbox" class="column-ai"> Auto</label><label><input type="checkbox" class="column-nn"> Not null</label><button class="mini-button remove-column">×</button>`;
    $('#column-list').append(node);
    node.querySelector('.remove-column').addEventListener('click', () => node.remove());
  };
  addColumn({ name: 'id', pk: true });
  addColumn({ name: 'name', type: 'TEXT' });
  $('#add-column').addEventListener('click', () => addColumn({ type: 'TEXT' }));
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $('#create-table-save').addEventListener('click', async () => {
    const columns = $$('.column-builder').map((row) => ({ name: row.querySelector('.column-name').value, type: row.querySelector('.column-type').value, primaryKey: row.querySelector('.column-pk').checked, autoIncrement: row.querySelector('.column-ai').checked, notNull: row.querySelector('.column-nn').checked }));
    const name = $('#new-table-name').value.trim();
    await call(api.createTable({ name, columns }));
    closeModal();
    await refreshOverview(false);
    toast(`Table ${name} created.`);
  });
}

function confirmDialog(title, message, confirmText, onConfirm, dangerous = true) {
  openModal({ eyebrow: dangerous ? 'CONFIRM DESTRUCTIVE ACTION' : 'CONFIRM', title, body: `<div class="warning-box">${escapeHtml(message)}</div>`, actions: `<button class="button secondary" data-modal-cancel>Cancel</button><button class="button ${dangerous ? 'danger' : 'primary'}" id="modal-confirm">${escapeHtml(confirmText)}</button>` });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $('#modal-confirm').addEventListener('click', onConfirm);
}

function openSchemaObjectEditor(type, originalName = null, existingSql = '') {
  const label = type === 'view' ? 'view' : 'trigger';
  const sample = type === 'view' ? 'CREATE VIEW "active_users" AS\nSELECT * FROM "users" WHERE "active" = 1;' : 'CREATE TRIGGER "users_updated" AFTER UPDATE ON "users"\nBEGIN\n  UPDATE "users" SET "updated_at" = CURRENT_TIMESTAMP WHERE rowid = NEW.rowid;\nEND;';
  openModal({ eyebrow: 'SCHEMA OBJECT', title: `${originalName ? 'Edit' : 'Create'} ${label}`, body: `<div class="form-field"><label>Complete CREATE ${label.toUpperCase()} SQL</label><textarea id="schema-object-sql" class="schema-sql-editor" spellcheck="false">${escapeHtml(existingSql || sample)}</textarea></div><p class="muted">The definition is applied inside a transaction. Virtual tables and extension-specific objects remain available through the SQL Console.</p>`, actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button primary" id="save-schema-object">Apply definition</button>', wide: true });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $('#save-schema-object').addEventListener('click', async () => { await call(api.saveSchemaObject(type, originalName, $('#schema-object-sql').value, originalName)); closeModal(); await refreshOverview(false); toast(`${label} saved.`); });
}

function confirmDeleteRows(identities) {
  confirmDialog('Delete selected rows?', `${identities.length} row${identities.length === 1 ? '' : 's'} will be permanently deleted from ${state.currentObject}.`, 'Delete rows', async () => {
    const result = await call(api.deleteRows(state.currentObject, identities));
    closeModal();
    await refreshOverview();
    await loadRows();
    toast(`${result.changes} row${result.changes === 1 ? '' : 's'} deleted.`);
  });
}

function confirmEmpty(name) {
  confirmDialog(`Empty ${name}?`, 'Every row will be permanently deleted. The table structure will remain.', 'Delete all rows', async () => {
    const result = await call(api.emptyTable(name));
    closeModal();
    await refreshOverview();
    await loadRows();
    toast(`${result.changes} rows deleted.`);
  });
}

function confirmDrop(name, type) {
  confirmDialog(`Drop ${type} ${name}?`, `The ${type}, its data, and dependent schema objects may be permanently removed.`, `Drop ${type}`, async () => {
    await call(api.dropObject(name, type));
    closeModal();
    state.currentObject = null;
    await refreshOverview(false);
    toast(`${type} ${name} dropped.`);
  });
}

function openRenameModal() {
  openModal({ eyebrow: 'TABLE MANAGEMENT', title: `Rename ${state.currentObject}`, body: `<div class="form-field"><label>New table name</label><input id="rename-value" value="${escapeHtml(state.currentObject)}"></div>`, actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button primary" id="rename-save">Rename table</button>' });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $('#rename-save').addEventListener('click', async () => {
    const newName = $('#rename-value').value.trim();
    await call(api.renameTable(state.currentObject, newName));
    state.currentObject = newName;
    closeModal();
    await refreshOverview();
    await openObject(newName);
    toast(`Table renamed to ${newName}.`);
  });
}

function openExportModal() {
  openModal({ eyebrow: 'EXPORT', title: `Export ${state.currentObject}`, body: '<p class="muted">Choose a format. CSV and JSON export the current table or view. SQL creates a complete database dump.</p>', actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button secondary export-format" data-format="csv">CSV</button><button class="button secondary export-format" data-format="json">JSON</button><button class="button primary export-format" data-format="sql">SQL dump</button>' });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $$('.export-format').forEach((button) => button.addEventListener('click', async () => {
    const destination = await call(api.exportData(button.dataset.format, state.currentObject));
    if (destination) { closeModal(); toast(`Exported to ${destination}`); }
  }));
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows.filter((item) => item.some((value) => value !== ''));
}

async function importCsv(file) {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return toast('The CSV must contain a header and at least one data row.', 'error');
  const [headers, ...data] = rows;
  confirmDialog('Import CSV rows?', `${data.length} row${data.length === 1 ? '' : 's'} will be inserted into ${state.currentObject}. Headers must match table column names.`, 'Import rows', async () => {
    const result = await call(api.importRows(state.currentObject, headers, data));
    closeModal();
    await refreshOverview();
    await loadRows();
    toast(`${result.imported} rows imported${result.ignoredColumns.length ? `; ignored: ${result.ignoredColumns.join(', ')}` : ''}.`);
  }, false);
}

async function runSql() {
  const button = $('#run-sql');
  const sql = $('#sql-editor').value.trim();
  if (!sql) return toast('Enter an SQL query first.', 'error');
  button.disabled = true;
  button.textContent = 'Running…';
  try {
    const result = await call(api.runSql(sql));
    $('#sql-result-meta').textContent = `${result.elapsedMs.toFixed(2)} ms${result.kind === 'rows' ? ` · ${result.rowCount} rows` : result.changes !== null ? ` · ${result.changes} changes` : ''}`;
    if (result.kind === 'rows') {
      $('#sql-result-body').className = 'table-wrap';
      $('#sql-result-body').innerHTML = `<table><thead><tr>${result.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${result.rows.map((row) => `<tr>${result.columns.map((column) => `<td>${displayValue(row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    } else {
      $('#sql-result-body').className = 'result-placeholder';
      $('#sql-result-body').textContent = result.message || `Query completed. ${result.changes} row(s) changed.`;
      await refreshOverview();
    }
    state.queryHistory = await call(api.addQueryHistory(state.overview.filePath, { sql, ok: true, elapsedMs: result.elapsedMs, summary: result.kind === 'rows' ? `${result.rowCount} rows` : `${result.changes ?? 0} changes` }));
    renderQueryHistory();
  } catch (error) {
    state.queryHistory = await call(api.addQueryHistory(state.overview.filePath, { sql, ok: false, elapsedMs: 0, summary: error.message }), { silent: true }).catch(() => state.queryHistory);
    renderQueryHistory();
  } finally {
    button.disabled = false;
    button.textContent = '▶ Run query';
  }
}

function openAppearanceSettings() {
  const choices = THEMES.map((theme) => `<button class="appearance-choice ${state.theme === theme.id ? 'active' : ''}" data-theme-choice="${theme.id}"><span class="theme-preview preview-${theme.id}" aria-hidden="true"><i></i><b></b><em></em><small></small></span><span class="theme-choice-copy"><strong>${theme.name}</strong><small>${theme.description}</small></span><span class="theme-selected">✓</span></button>`).join('');
  openModal({ eyebrow: 'APPEARANCE', title: 'Choose a theme', body: `<p class="muted theme-help">Select one of the installed SQLiteScope themes. Your choice is remembered for future sessions.</p><div class="appearance-grid">${choices}</div><div class="form-field density-field"><label>Layout density</label><select id="density-choice"><option value="comfortable" ${state.density === 'comfortable' ? 'selected' : ''}>Comfortable</option><option value="compact" ${state.density === 'compact' ? 'selected' : ''}>Compact</option></select></div>`, actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button primary" id="save-appearance">Apply theme</button>', wide: true });
  let selected = state.theme;
  $$('[data-theme-choice]').forEach((button) => button.addEventListener('click', () => { selected = button.dataset.themeChoice; $$('[data-theme-choice]').forEach((item) => item.classList.toggle('active', item === button)); setTheme(selected, $('#density-choice').value); }));
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $('#save-appearance').addEventListener('click', async () => { const density = $('#density-choice').value; setTheme(selected, density); await call(api.saveAppearance({ theme: selected, density })); closeModal(); toast('Theme updated.'); });
}

async function openConverter() {
  const source = await call(api.chooseConverterSource());
  if (!source) return;
  const isCsv = source.toLowerCase().endsWith('.csv');
  let preview = null;
  if (isCsv) preview = await call(api.previewCsvConversion(source, { delimiter: 'auto', hasHeader: true }));
  const pathParts = source.replace(/\\/g, '/').split('/');
  const base = pathParts.pop().replace(/\.[^.]+$/, '');
  const previewTable = preview ? `<div class="converter-preview"><table><thead><tr>${preview.columns.map((column) => `<th>${escapeHtml(column.name)}<br><span class="muted">${column.type}</span></th>`).join('')}</tr></thead><tbody>${preview.previewRows.slice(0, 8).map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted">${formatNumber(preview.rowCount)} rows detected · delimiter ${preview.delimiter === '\t' ? 'Tab' : escapeHtml(preview.delimiter)}</p>` : '<div class="warning-box">The SQL script will be executed into a new database. If any statement fails, the incomplete database file is removed.</div>';
  openModal({ eyebrow: 'DATABASE CONVERTER', title: `Convert ${pathParts.length ? '' : ''}${base}`, body: `<p class="path-text muted">${escapeHtml(source)}</p>${isCsv ? `<div class="form-grid"><div class="form-field"><label>Table name</label><input id="converter-table" value="${escapeHtml(base)}"></div><div class="form-field"><label>CSV header</label><select id="converter-header"><option value="yes">First row contains column names</option><option value="no">No header row</option></select></div><div class="form-field"><label>Delimiter</label><select id="converter-delimiter"><option value="auto">Auto detect</option><option value=",">Comma</option><option value=";">Semicolon</option><option value="tab">Tab</option><option value="|">Pipe</option></select></div><div class="form-field"><label>Output format</label><select id="converter-extension"><option>db</option><option>sqlite</option><option>sqlite3</option><option>db3</option></select></div></div>` : '<div class="form-field"><label>Output format</label><select id="converter-extension"><option>db</option><option>sqlite</option><option>sqlite3</option><option>db3</option></select></div>'}${previewTable}<label class="check-field" style="margin-top:14px"><input type="checkbox" id="converter-open" checked> Open the converted database when complete</label>`, actions: '<button class="button secondary" data-modal-cancel>Cancel</button><button class="button primary" id="run-converter">Convert</button>', wide: true });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  const refreshCsvPreview = async () => { if (!isCsv) return; const delimiterValue = $('#converter-delimiter').value; preview = await call(api.previewCsvConversion(source, { delimiter: delimiterValue === 'tab' ? '\t' : delimiterValue, hasHeader: $('#converter-header').value === 'yes' })); toast(`${formatNumber(preview.rowCount)} rows detected.`); };
  $('#converter-delimiter')?.addEventListener('change', refreshCsvPreview);
  $('#converter-header')?.addEventListener('change', refreshCsvPreview);
  $('#run-converter').addEventListener('click', async () => { const button = $('#run-converter'); button.disabled = true; button.textContent = 'Converting…'; try { const delimiterValue = $('#converter-delimiter')?.value; const result = await call(api.runConversion(source, { tableName: $('#converter-table')?.value, delimiter: delimiterValue === 'tab' ? '\t' : delimiterValue, hasHeader: $('#converter-header')?.value !== 'no', outputExtension: $('#converter-extension').value })); if (!result) return; const shouldOpen = $('#converter-open').checked; closeModal(); toast(result.warnings?.length ? `Converted with compatibility warnings: ${result.warnings.join(' ')}` : `Converted successfully to ${result.outputPath}`, result.warnings?.length ? 'warning' : 'success'); if (shouldOpen) await openDatabase(result.outputPath); } finally { if (button.isConnected) { button.disabled = false; button.textContent = 'Convert'; } } });
}

async function openDatabaseTools() {
  if (!state.overview) return;
  const data = await call(api.pragmas());
  const attached = await call(api.attachedDatabases());
  const cards = Object.entries(data).map(([key, value]) => `<div class="stat-card"><span>${escapeHtml(key.replace(/[A-Z]/g, (m) => ` ${m}`).replace(/^./, (m) => m.toUpperCase()))}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const attachedRows = attached.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.file || 'Temporary')}</td><td>${!state.overview.readonly && !['main', 'temp'].includes(item.name) ? `<button class="action-icon danger detach-db" data-schema="${escapeHtml(item.name)}" title="Detach database" aria-label="Detach ${escapeHtml(item.name)}">${icon('close')}</button>` : ''}</td></tr>`).join('');
  openModal({ eyebrow: 'DATABASE TOOLS', title: 'Maintenance, PRAGMAs, and attached databases', body: `<div class="stat-grid">${cards}</div>${state.overview.readonly ? '' : `<div class="structure-section"><h3>Connection settings</h3><div class="form-grid"><div class="form-field"><label>Journal mode</label><select class="pragma-setting" data-pragma="journal_mode">${['DELETE','TRUNCATE','PERSIST','MEMORY','WAL','OFF'].map((v) => `<option ${String(data.journalMode).toUpperCase() === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="form-field"><label>Synchronous</label><select class="pragma-setting" data-pragma="synchronous"><option>OFF</option><option>NORMAL</option><option>FULL</option><option>EXTRA</option></select></div><div class="form-field"><label><input type="checkbox" class="pragma-toggle" data-pragma="foreign_keys" ${data.foreignKeys ? 'checked' : ''}> Enforce foreign keys</label></div></div></div>`}<div class="structure-section"><div class="panel-heading"><h3>Attached databases</h3>${state.overview.readonly ? '' : '<button class="button secondary small" id="attach-database">Attach database</button>'}</div><div class="structure-card table-wrap"><table><thead><tr><th>Schema</th><th>File</th><th></th></tr></thead><tbody>${attachedRows}</tbody></table></div></div><div class="warning-box" style="margin-top:16px">VACUUM can temporarily lock a large database. Create a backup first for important data.</div>`, actions: `<button class="button secondary" data-modal-cancel>Close</button>${state.overview.readonly ? '' : '<button class="button secondary maintenance-action" data-action="checkpoint">WAL checkpoint</button><button class="button secondary maintenance-action" data-action="optimize">Optimize</button><button class="button secondary maintenance-action" data-action="analyze">Analyze</button><button class="button primary maintenance-action" data-action="vacuum">Vacuum</button>'}`, wide: true });
  $$('[data-modal-cancel]').forEach((button) => button.addEventListener('click', closeModal));
  $$('.maintenance-action').forEach((button) => button.addEventListener('click', async () => { button.disabled = true; const result = await call(api.maintenance(button.dataset.action)); closeModal(); await refreshOverview(); toast(`${result.action} completed in ${result.elapsedMs.toFixed(2)} ms.`); }));
  $$('.pragma-setting').forEach((input) => input.addEventListener('change', async () => { await call(api.setPragma(input.dataset.pragma, input.value)); toast(`${input.dataset.pragma} updated.`); }));
  $$('.pragma-toggle').forEach((input) => input.addEventListener('change', async () => { await call(api.setPragma(input.dataset.pragma, input.checked ? '1' : '0')); toast(`${input.dataset.pragma} updated.`); }));
  $$('.detach-db').forEach((button) => button.addEventListener('click', async () => { await call(api.detachDatabase(button.dataset.schema)); closeModal(); await openDatabaseTools(); toast('Database detached.'); }));
  $('#attach-database')?.addEventListener('click', async () => { const paths = await call(api.chooseDatabase()); if (!paths[0]) return; const schema = prompt('Schema alias for the attached database:', 'attached'); if (!schema) return; await call(api.attachDatabase(paths[0], schema)); closeModal(); await openDatabaseTools(); toast(`Database attached as ${schema}.`); });
}

async function fullRefresh(message = true) {
  if (!state.overview) return;
  await refreshOverview();
  if (state.currentObject && state.overview.objects.some((item) => item.name === state.currentObject)) { await loadRows(); await loadStructure(); }
  else if (state.currentObject) { state.currentObject = null; showView('overview'); }
  if (message) toast('Database refreshed.');
}

function wireEvents() {
  $('#refresh-button').innerHTML = icon('refresh');
  $('#sidebar-collapse').innerHTML = icon('panelLeft');
  $('#sidebar-restore').innerHTML = icon('panelLeft');
  $('#welcome-open').addEventListener('click', chooseAndOpen);
  $('#welcome-create').addEventListener('click', chooseAndCreate);
  $('#welcome-convert').addEventListener('click', openConverter);
  $$('#new-table-button, #overview-new-table').forEach((button) => button.addEventListener('click', openCreateTableModal));
  $$('.schema-create').forEach((button) => button.addEventListener('click', () => openSchemaObjectEditor(button.dataset.schemaType)));
  $('#refresh-button').addEventListener('click', () => fullRefresh());
  $('#sidebar-collapse').addEventListener('click', toggleSidebar);
  $('#sidebar-restore').addEventListener('click', toggleSidebar);
  $('#object-search').addEventListener('input', renderSidebar);
  $$('.nav-item').forEach((item) => item.addEventListener('click', () => { showView(item.dataset.view); if (item.dataset.view === 'overview') renderOverview(); }));
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => showTableTab(tab.dataset.tableTab)));
  $('#add-row-button').addEventListener('click', () => openRowModal('insert'));
  $('#filter-form').addEventListener('submit', async (event) => { event.preventDefault(); state.filter = $('#row-filter').value.trim(); state.page = 1; await loadRows(); });
  $('#clear-filter').addEventListener('click', async () => { $('#row-filter').value = ''; state.filter = ''; state.page = 1; await loadRows(); });
  $('#page-size').addEventListener('change', async (event) => { state.pageSize = Number(event.target.value); state.page = 1; await loadRows(); });
  $('#prev-page').addEventListener('click', async () => { if (state.page > 1) { state.page -= 1; await loadRows(); } });
  $('#next-page').addEventListener('click', async () => { if (state.page < state.currentRows.pages) { state.page += 1; await loadRows(); } });
  $('#delete-selected').addEventListener('click', () => confirmDeleteRows([...state.selected.values()]));
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-backdrop').addEventListener('click', (event) => { if (event.target === $('#modal-backdrop')) closeModal(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeModal();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('#sql-view').classList.contains('hidden')) runSql();
  });
  $('#run-sql').addEventListener('click', runSql);
  $('#copy-schema').addEventListener('click', async () => { if (!state.currentStructure?.createSql) return; await navigator.clipboard.writeText(state.currentStructure.createSql); toast('Schema SQL copied.'); });
  $('#query-template').addEventListener('change', async (event) => {
    if (!event.target.value || !state.overview) return;
    const object = state.currentObject || state.overview.objects[0]?.name;
    if (!object) { event.target.value = ''; return toast('Create or open a table first.', 'error'); }
    const templates = await call(api.queryTemplates(object));
    if (!templates[event.target.value]) toast('That template is not available for a view.', 'error');
    else { $('#sql-editor').value = templates[event.target.value]; $('#sql-editor').focus(); }
    event.target.value = '';
  });
  $('#query-history-button').addEventListener('click', () => { $('.query-history-panel').scrollIntoView({ behavior: 'smooth' }); });
  $('#database-tools-button').addEventListener('click', openDatabaseTools);
  $('#clear-query-history').addEventListener('click', () => { if (!state.overview) return; confirmDialog('Clear query history?', 'Saved SQL history for this database will be removed from SQLiteScope.', 'Clear history', async () => { state.queryHistory = await call(api.clearQueryHistory(state.overview.filePath)); closeModal(); renderQueryHistory(); toast('Query history cleared.'); }); });
  $('#sql-clear').addEventListener('click', () => { $('#sql-editor').value = ''; $('#sql-editor').focus(); });
  $('#export-button').addEventListener('click', openExportModal);
  $('#import-button').addEventListener('click', () => $('#csv-input').click());
  $('#column-chooser-button').addEventListener('click', openColumnChooser);
  $('#csv-input').addEventListener('change', async (event) => { if (event.target.files[0]) await importCsv(event.target.files[0]); event.target.value = ''; });
  $('#backup-button').addEventListener('click', async () => { const destination = await call(api.backup()); if (destination) toast(`Backup saved to ${destination}`); });
  $('#integrity-button').addEventListener('click', async () => { const result = await call(api.integrityCheck()); const ok = result.every((row) => Object.values(row).includes('ok')); toast(ok ? 'Integrity check passed: database is OK.' : `Integrity check returned: ${JSON.stringify(result)}`, ok ? 'success' : 'error'); });
  const dropZone = $('#drop-zone');
  ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.add('dragging'); }));
  ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
  dropZone.addEventListener('drop', async (event) => { for (const file of event.dataTransfer.files) { const filePath = api.filePath(file); if (filePath) await openDatabase(filePath); } });
  api.onOpenPath((filePath) => openDatabase(filePath));
  api.onCreatePath((filePath) => createDatabase(filePath));
  api.onBackup(async () => { if (state.overview) { const destination = await call(api.backup()); if (destination) toast(`Backup saved to ${destination}`); } });
  api.onCloseDatabase(() => closeDatabase());
  api.onRecentsChanged(renderRecents);
  api.onRefresh(() => fullRefresh());
  api.onRunQuery(() => { if (state.overview) { showView('sql'); runSql(); } });
  api.onIntegrity(() => $('#integrity-button').click());
  api.onDatabaseTools(openDatabaseTools);
  api.onAppearance(openAppearanceSettings);
  api.onConverter(openConverter);
  api.onExternalChange(async ({ id }) => {
    if (id !== state.activeId) { toast('An open database changed outside SQLiteScope. Switch to its tab to refresh.', 'warning'); return; }
    const editing = !$('#modal-backdrop').classList.contains('hidden');
    const queryDraft = state.currentView === 'sql' && $('#sql-editor').value.trim();
    if (editing || queryDraft) toast('Database changed outside SQLiteScope. Press F5 after finishing the current edit to refresh safely.', 'warning');
    else { await fullRefresh(false); toast('Database changed externally and was refreshed.'); }
  });
}

initialize().catch((error) => toast(error.message, 'error'));
