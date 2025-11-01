// Dedicated popup UI to operate the preset library without covering the main show viewport.
const WINDOW_FEATURES = 'width=960,height=720,left=32,top=32,resizable=yes,scrollbars=yes';
const OPACITY_PARAMS = [
  'visuals.dispersion.opacityBase',
  'visuals.dispersion.opacityTrebleGain',
  'visuals.dispersion.opacityMin',
  'visuals.dispersion.opacityMax',
  'visuals.dispersion.opacityLerp',
];
const COLOR_PARAMS = [
  'visuals.dispersion.tintHue',
  'visuals.dispersion.tintSat',
  'visuals.dispersion.tintMixBase',
  'visuals.dispersion.tintMixChromaGain',
  'visuals.dispersion.tintMixMax',
];

function createButton(doc, label, onClick, { variant = 'primary', title } = {}) {
  const btn = doc.createElement('button');
  btn.textContent = label;
  btn.className = `pl-btn ${variant}`;
  if (title) btn.title = title;
  btn.addEventListener('click', (event) => {
    event.preventDefault();
    onClick?.(event);
  });
  return btn;
}

function fmtTime(ms) {
  return new Date(ms).toLocaleString();
}

export class PresetLibraryWindow {
  constructor({ presetManager, onClose } = {}) {
    this.manager = presetManager;
    this.onClose = onClose;
    this.win = null;
    this.state = {
      search: '',
      activeTags: new Set(),
      favoritesOnly: false,
      selectedId: presetManager ? presetManager.activePresetId : null,
    };
    this.detach = null;
    this.elements = {};
  }

  open() {
    if (!this.manager) throw new Error('Preset manager required');
    if (this.win && !this.win.closed) {
      this.win.focus();
      this.render();
      return;
    }
    if (typeof this.detach === 'function') {
      this.detach();
      this.detach = null;
    }
    this.win = window.open('', 'PresetLibrary', WINDOW_FEATURES);
    if (!this.win) {
      throw new Error('Preset library popup blocked');
    }
    this._mount();
    this.render();
    this.detach = this.manager.on('*', () => this.render());
    this.win.addEventListener('beforeunload', () => {
      if (typeof this.detach === 'function') this.detach();
      this.detach = null;
      this.win = null;
      if (typeof this.onClose === 'function') this.onClose();
    });
  }

  close() {
    if (this.win && !this.win.closed) this.win.close();
  }

  _mount() {
    const doc = this.win.document;
    doc.title = 'Preset Library';
    doc.body.innerHTML = '';
    const style = doc.createElement('style');
    style.textContent = getStyles();
    doc.head.appendChild(style);

    const app = doc.createElement('div');
    app.id = 'preset-library-app';
    doc.body.appendChild(app);

    app.appendChild(this._buildHeader(doc));
    app.appendChild(this._buildToolbar(doc));
    const layout = doc.createElement('div');
    layout.className = 'pl-layout';
    this.elements.layout = layout;
    this.elements.list = doc.createElement('div');
    this.elements.list.className = 'pl-list';
    layout.appendChild(this.elements.list);
    this.elements.detail = doc.createElement('div');
    this.elements.detail.className = 'pl-detail';
    layout.appendChild(this.elements.detail);
    app.appendChild(layout);

    this.elements.status = doc.createElement('div');
    this.elements.status.className = 'pl-status';
    app.appendChild(this.elements.status);
  }

  _buildHeader(doc) {
    const header = doc.createElement('header');
    header.className = 'pl-header';
    const title = doc.createElement('div');
    title.className = 'pl-title';
    title.textContent = 'Preset Library';
    header.appendChild(title);
    const actions = doc.createElement('div');
    actions.className = 'pl-header-actions';
    actions.appendChild(createButton(doc, 'Load', () => this._handleLoad()));
    actions.appendChild(createButton(doc, 'Save', () => this._handleSave(), { variant: 'ghost', title: 'Overwrite selected preset' }));
    actions.appendChild(createButton(doc, 'Save As…', () => this._handleSaveAs(), { variant: 'ghost' }));
    actions.appendChild(createButton(doc, 'Rollback', () => this._handleRollback(), { variant: 'ghost' }));
    actions.appendChild(createButton(doc, 'Close', () => this.close(), { variant: 'ghost' }));
    header.appendChild(actions);
    return header;
  }

  _buildToolbar(doc) {
    const bar = doc.createElement('div');
    bar.className = 'pl-toolbar';

    const searchWrap = doc.createElement('div');
    searchWrap.className = 'pl-search';
    const searchInput = doc.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Search presets or tags';
    searchInput.value = this.state.search;
    searchInput.addEventListener('input', () => {
      this.state.search = searchInput.value || '';
      this.render();
    });
    this.elements.searchInput = searchInput;
    searchWrap.appendChild(searchInput);
    bar.appendChild(searchWrap);

    const tagWrap = doc.createElement('div');
    tagWrap.className = 'pl-tags';
    this.elements.tagWrap = tagWrap;
    bar.appendChild(tagWrap);

    const favToggle = doc.createElement('label');
    favToggle.className = 'pl-toggle';
    const favCheckbox = doc.createElement('input');
    favCheckbox.type = 'checkbox';
    favCheckbox.checked = this.state.favoritesOnly;
    favCheckbox.addEventListener('change', () => {
      this.state.favoritesOnly = favCheckbox.checked;
      this.render();
    });
    favToggle.appendChild(favCheckbox);
    favToggle.appendChild(doc.createTextNode('Favorites only'));
    bar.appendChild(favToggle);

    const compareBtn = createButton(doc, 'Quick Compare', () => this._handleQuickCompare(), { variant: 'ghost' });
    bar.appendChild(compareBtn);

    return bar;
  }

  render() {
    if (!this.win || this.win.closed) return;
    this._renderTags();
    this._renderLists();
    this._renderDetail();
  }

  _renderTags() {
    const doc = this.win.document;
    const wrap = this.elements.tagWrap;
    if (!wrap) return;
    wrap.innerHTML = '';
    const tags = new Set();
    this.manager.list().forEach((preset) => {
      (preset.tags || []).forEach((tag) => tags.add(tag));
    });
    if (!tags.size) {
      wrap.appendChild(doc.createTextNode('No tags yet'));
      return;
    }
    tags.forEach((tag) => {
      const btn = doc.createElement('button');
      btn.className = `pl-tag ${this.state.activeTags.has(tag) ? 'active' : ''}`;
      btn.textContent = `#${tag}`;
      btn.addEventListener('click', () => {
        if (this.state.activeTags.has(tag)) this.state.activeTags.delete(tag);
        else this.state.activeTags.add(tag);
        this.render();
      });
      wrap.appendChild(btn);
    });
  }

  _renderLists() {
    const listWrap = this.elements.list;
    if (!listWrap) return;
    const doc = this.win.document;
    listWrap.innerHTML = '';

    const recents = this.manager.getRecent(6);
    if (recents.length) {
      listWrap.appendChild(this._sectionTitle(doc, 'Recent'));
      listWrap.appendChild(this._buildPresetGroup(doc, recents, { condensed: true }));
    }

    const favorites = this.manager.getFavorites();
    if (favorites.length) {
      listWrap.appendChild(this._sectionTitle(doc, 'Favorites'));
      listWrap.appendChild(this._buildPresetGroup(doc, favorites, { condensed: true }));
    }

    const filters = Array.from(this.state.activeTags);
    const items = this.manager.list(this.state.search, filters);
    const filtered = this.state.favoritesOnly ? items.filter((p) => p.favorite) : items;

    listWrap.appendChild(this._sectionTitle(doc, 'All Presets'));
    const group = this._buildPresetGroup(doc, filtered, { showMeta: true });
    listWrap.appendChild(group);
  }

  _sectionTitle(doc, label) {
    const el = doc.createElement('div');
    el.className = 'pl-section-title';
    el.textContent = label;
    return el;
  }

  _buildPresetGroup(doc, presets, { condensed = false, showMeta = false } = {}) {
    const group = doc.createElement('div');
    group.className = 'pl-group';
    if (!presets.length) {
      const empty = doc.createElement('div');
      empty.className = 'pl-empty';
      empty.textContent = 'No presets yet';
      group.appendChild(empty);
      return group;
    }
    presets.forEach((preset) => {
      const row = doc.createElement('button');
      row.className = `pl-row ${preset.id === this.state.selectedId ? 'active' : ''}`;
      row.addEventListener('click', () => {
        this.state.selectedId = preset.id;
        this.render();
      });
      const name = doc.createElement('div');
      name.className = 'pl-row-name';
      name.textContent = preset.name;
      row.appendChild(name);
      if (preset.favorite) {
        const star = doc.createElement('span');
        star.className = 'pl-star';
        star.textContent = '★';
        row.appendChild(star);
      }
      if (!condensed && preset.tags?.length) {
        const tags = doc.createElement('div');
        tags.className = 'pl-row-tags';
        tags.textContent = preset.tags.map((tag) => `#${tag}`).join(' ');
        row.appendChild(tags);
      }
      if (showMeta) {
        const meta = doc.createElement('div');
        meta.className = 'pl-row-meta';
        meta.textContent = `Updated ${fmtTime(preset.updatedAt)}`;
        row.appendChild(meta);
      }
      group.appendChild(row);
    });
    return group;
  }

  _renderDetail() {
    const detail = this.elements.detail;
    if (!detail) return;
    const doc = this.win.document;
    detail.innerHTML = '';
    const preset = this.state.selectedId ? this.manager.list().find((p) => p.id === this.state.selectedId) : null;
    if (!preset) {
      detail.appendChild(doc.createTextNode('Select a preset to see details.'));
      return;
    }
    const title = doc.createElement('div');
    title.className = 'pl-detail-title';
    title.textContent = preset.name;
    detail.appendChild(title);

    const info = doc.createElement('div');
    info.className = 'pl-detail-meta';
    info.innerHTML = `Created ${fmtTime(preset.createdAt)}<br>Updated ${fmtTime(preset.updatedAt)}`;
    detail.appendChild(info);

    if (preset.tags?.length) {
      const tagLine = doc.createElement('div');
      tagLine.className = 'pl-detail-tags';
      tagLine.textContent = preset.tags.map((tag) => `#${tag}`).join(' ');
      detail.appendChild(tagLine);
    }

    if (preset.blurb) {
      const blurb = doc.createElement('p');
      blurb.className = 'pl-detail-blurb';
      blurb.textContent = preset.blurb;
      detail.appendChild(blurb);
    }

    const actionRow = doc.createElement('div');
    actionRow.className = 'pl-detail-actions';
    actionRow.appendChild(createButton(doc, preset.favorite ? 'Unfavorite' : 'Favorite', () => this._toggleFavorite(preset)));
    actionRow.appendChild(createButton(doc, 'Duplicate', () => this._handleDuplicate(preset), { variant: 'ghost' }));
    actionRow.appendChild(createButton(doc, 'Rename', () => this._handleRename(preset), { variant: 'ghost' }));
    actionRow.appendChild(createButton(doc, 'Delete', () => this._handleDelete(preset), { variant: 'ghost' }));
    detail.appendChild(actionRow);

    const guardControls = doc.createElement('div');
    guardControls.className = 'pl-guard-controls';
    guardControls.appendChild(this._sectionTitle(doc, 'Audio Modulation'));
    guardControls.appendChild(this._buildGuardToggle(doc, 'Opacity', OPACITY_PARAMS));
    guardControls.appendChild(this._buildGuardToggle(doc, 'Color', COLOR_PARAMS));
    detail.appendChild(guardControls);

    const versions = this.manager.getHistory(preset.id);
    if (versions.length) {
      const history = doc.createElement('div');
      history.className = 'pl-history';
      history.appendChild(this._sectionTitle(doc, 'Version History'));
      versions.forEach((version) => {
        const row = doc.createElement('div');
        row.className = `pl-history-row ${version.isCurrent ? 'current' : ''}`;
        const label = doc.createElement('div');
        label.textContent = `${fmtTime(version.savedAt)} ${version.note || ''}`;
        row.appendChild(label);
        if (!version.isCurrent) {
          const restore = createButton(doc, 'Restore', () => this._handleRestoreVersion(preset, version), { variant: 'ghost' });
          row.appendChild(restore);
        }
        history.appendChild(row);
      });
      detail.appendChild(history);
    }
  }

  _toggleFavorite(preset) {
    this.manager.setFavorite(preset.id, !preset.favorite);
    this._setStatus(preset.favorite ? 'Removed from favorites' : 'Marked favorite');
  }

  _buildGuardToggle(doc, label, params) {
    const row = doc.createElement('label');
    row.className = 'pl-guard-toggle';
    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    const enabled = params.every((param) => this.manager.isAudioModulationEnabled(param));
    checkbox.checked = enabled;
    checkbox.addEventListener('change', () => {
      params.forEach((param) => this.manager.enableAudioModulation(param, checkbox.checked));
      this._setStatus(`${label} modulation ${checkbox.checked ? 'enabled' : 'locked'}`);
      this.render();
    });
    row.appendChild(checkbox);
    row.appendChild(doc.createTextNode(`${label} modulation`));
    return row;
  }

  _handleDuplicate(preset) {
    const name = prompt('Duplicate name', `${preset.name} Copy`);
    if (!name) return;
    try {
      const id = this.manager.duplicate(preset.id, name.trim());
      this.state.selectedId = id;
      this._setStatus('Preset duplicated');
    } catch (err) {
      this._setStatus(err?.message || 'Duplicate failed');
    }
    this.render();
  }

  _handleRename(preset) {
    const name = prompt('Rename preset', preset.name);
    if (!name) return;
    try {
      this.manager.rename(preset.id, name.trim());
      this._setStatus('Preset renamed');
    } catch (err) {
      this._setStatus(err?.message || 'Rename failed');
    }
    this.render();
  }

  _handleDelete(preset) {
    const ok = confirm(`Delete preset "${preset.name}"?`);
    if (!ok) return;
    try {
      this.manager.delete(preset.id);
      if (this.state.selectedId === preset.id) this.state.selectedId = this.manager.activePresetId;
      this._setStatus('Preset deleted');
    } catch (err) {
      this._setStatus(err?.message || 'Delete failed');
    }
    this.render();
  }

  _handleRestoreVersion(preset, version) {
    try {
      this.manager.restoreVersion(preset.id, version.id);
      this._setStatus('Version restored');
    } catch (err) {
      this._setStatus(err?.message || 'Restore failed');
    }
    this.render();
  }

  _handleLoad() {
    if (!this.state.selectedId) {
      this._setStatus('Select a preset first');
      return;
    }
    try {
      this.manager.load(this.state.selectedId);
      this._setStatus('Preset loaded');
    } catch (err) {
      this._setStatus(err?.message || 'Load failed');
    }
  }

  _handleSave() {
    if (!this.state.selectedId) {
      this._setStatus('Select a preset');
      return;
    }
    const ok = confirm('Overwrite selected preset with live settings?');
    if (!ok) return;
    try {
      this.manager.save(this.state.selectedId);
      this._setStatus('Preset saved');
    } catch (err) {
      this._setStatus(err?.message || 'Save failed');
    }
  }

  _handleSaveAs() {
    const name = prompt('New preset name');
    if (!name) return;
    try {
      const id = this.manager.saveAs(name.trim());
      this.state.selectedId = id;
      this._setStatus('Preset saved');
    } catch (err) {
      this._setStatus(err?.message || 'Save failed');
    }
    this.render();
  }

  _handleRollback() {
    const ok = this.manager.rollback();
    this._setStatus(ok ? 'Rolled back to previous' : 'Nothing to roll back');
  }

  _handleQuickCompare() {
    try {
      this.manager.quickCompare(this.state.selectedId || this.manager.activePresetId);
      this._setStatus('Quick compare toggled');
    } catch (err) {
      this._setStatus(err?.message || 'Compare failed');
    }
  }

  _setStatus(message) {
    if (!this.elements.status) return;
    this.elements.status.textContent = message;
  }
}

export function openPresetLibraryWindow(manager, opts = {}) {
  const instance = openPresetLibraryWindow._instance || new PresetLibraryWindow({ presetManager: manager, ...opts });
  instance.manager = manager;
  try {
    instance.open();
  } catch (err) {
    if (opts.onError) opts.onError(err);
    else console.error(err);
  }
  openPresetLibraryWindow._instance = instance;
  return instance;
}

function getStyles() {
  return `
    :root {
      color-scheme: dark;
      font-family: "Inter", "Segoe UI", sans-serif;
    }
    body {
      margin: 0;
      background: #060708;
      color: #f5f7fa;
      font-size: 13px;
    }
    #preset-library-app {
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 16px;
      box-sizing: border-box;
      gap: 12px;
    }
    .pl-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .pl-title {
      font-size: 18px;
      font-weight: 600;
    }
    .pl-header-actions {
      display: flex;
      gap: 8px;
    }
    .pl-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      background: rgba(255,255,255,0.05);
      padding: 8px 12px;
      border-radius: 10px;
    }
    .pl-search input {
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.12);
      color: inherit;
      padding: 6px 10px;
      border-radius: 8px;
      min-width: 220px;
    }
    .pl-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .pl-tag {
      background: rgba(0,0,0,0.2);
      border: 1px solid rgba(255,255,255,0.1);
      color: inherit;
      padding: 4px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    .pl-tag.active {
      background: rgba(0,153,255,0.24);
      border-color: rgba(0,153,255,0.6);
    }
    .pl-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .pl-btn {
      background: #1890ff;
      color: white;
      border: none;
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
      font-size: 12px;
    }
    .pl-btn.ghost {
      background: rgba(255,255,255,0.08);
      color: #f5f5f5;
    }
    .pl-btn:hover {
      filter: brightness(1.1);
    }
    .pl-layout {
      flex: 1;
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 16px;
      min-height: 0;
    }
    .pl-list {
      background: rgba(255,255,255,0.04);
      border-radius: 10px;
      padding: 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pl-detail {
      background: rgba(255,255,255,0.06);
      border-radius: 10px;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pl-section-title {
      font-weight: 600;
      opacity: 0.75;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.1em;
    }
    .pl-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pl-row {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      background: rgba(0,0,0,0.16);
      border: 1px solid transparent;
      padding: 8px 10px;
      border-radius: 8px;
      color: inherit;
      cursor: pointer;
      text-align: left;
    }
    .pl-row:hover {
      border-color: rgba(24,144,255,0.6);
    }
    .pl-row.active {
      border-color: rgba(24,144,255,0.8);
      background: rgba(24,144,255,0.18);
    }
    .pl-row-name {
      font-weight: 600;
    }
    .pl-row-tags {
      font-size: 11px;
      opacity: 0.7;
    }
    .pl-row-meta {
      font-size: 11px;
      opacity: 0.6;
    }
    .pl-star {
      margin-left: auto;
      color: #ffd666;
    }
    .pl-empty {
      font-size: 12px;
      opacity: 0.6;
    }
    .pl-detail-title {
      font-size: 20px;
      font-weight: 600;
    }
    .pl-detail-meta {
      font-size: 12px;
      opacity: 0.7;
      line-height: 1.4;
    }
    .pl-detail-tags {
      font-size: 12px;
      opacity: 0.75;
    }
    .pl-detail-blurb {
      font-size: 13px;
      line-height: 1.4;
    }
    .pl-detail-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .pl-guard-controls {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pl-guard-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
    }
    .pl-history {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pl-history-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      background: rgba(0,0,0,0.2);
      padding: 6px 8px;
      border-radius: 6px;
    }
    .pl-history-row.current {
      opacity: 0.6;
    }
    .pl-status {
      min-height: 18px;
      font-size: 12px;
      opacity: 0.8;
    }
  `;
}

