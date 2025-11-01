/**
 * PresetManager orchestrates capture, persistence, and recall of live show presets.
 *
 * Responsibilities
 * - CRUD operations with version history and duplication
 * - Atomic persistence with rolling backup + recent/favorite tracking
 * - Guard rails for sensitive parameters (opacity/color) and audio modulation toggles
 * - Fast rollback to the previously active preset for show safety
 * - Event notifications for UI layers
 */

import { capturePresetSnapshot, applyPresetSnapshot } from './preset-io.js';

const STORAGE_KEYS = {
  primary: 'cosmicPresetLibrary.v1',
  working: 'cosmicPresetLibrary.v1.tmp',
  backup: 'cosmicPresetLibrary.v1.bak',
};

const VERSION_LIMIT = 15;
const RECENT_LIMIT = 12;

const DEFAULT_LOCK_PARAMS = [
  'visuals.dispersion.opacityBase',
  'visuals.dispersion.opacityTrebleGain',
  'visuals.dispersion.opacityMin',
  'visuals.dispersion.opacityMax',
  'visuals.dispersion.opacityLerp',
  'visuals.dispersion.tintHue',
  'visuals.dispersion.tintSat',
  'visuals.dispersion.tintMixBase',
  'visuals.dispersion.tintMixChromaGain',
  'visuals.dispersion.tintMixMax',
];

function makeId(prefix = 'preset') {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) {}
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

const DEFAULT_PRESETS = [
  {
    name: 'bizzuirh',
    tags: ['drums', 'bass', '114bpm', 'reactive'],
    blurb: '114 BPM drum & bass-heavy reactive preset. Colors untouched.',
    snapshot: (base = {}) => ({
      ...base,
      audio: {
        smoothing: 0.56,
        sensitivity: 1.12,
        lowHz: 175,
        midHz: 2350,
        subHz: 85,
        beatCooldown: 410,
        envAttack: 0.66,
        envRelease: 0.16,
        agcEnabled: true,
        agcDecay: 0.995,
        drop: {
          enabled: true,
          flux: 1.45,
          bass: 0.58,
          centroidSlope: 0.022,
          minBeats: 6,
          cooldownMs: 6200,
        },
      },
      visuals: {
        bloomBase: 1.2,
        bloomReactive: 0.88,
        autoRotate: 0.0020,
        particleDensity: 1.05,
        enableDispersion: true,
      },
      mapping: {
        sizeFromRms: 0.58,
        sphereBrightnessFromRms: 1.8,
        sphereNoiseFromMid: 1.3,
        spherePulseFromBass: 1.12,
        sphereSparkleFromTreble: 0.95,
        ringScaleFromBands: 0.48,
        ringSpeedFromBands: 2.0,
        ringNoiseFromBands: 0.56,
        ringTiltFromBass: 0.72,
        cameraShakeFromBeat: 0.40,
        lightIntensityFromBass: 2.7,
        fovPumpFromBass: 0.78,
        bandWeightBass: 1.34,
        bandWeightMid: 1.12,
        bandWeightTreble: 1.08,
        cameraRollFromCentroid: 0.22,
        mainSwayFromFlux: 0.20,
        starTwinkleFromTreble: 1.32,
        advancedMapping: true,
        sizeWeights: { bass: 1.10, mid: 0.58, treble: 0.24 },
        ringScaleWeights: { bass: 0.90, mid: 0.62, treble: 0.24 },
        ringSpeedWeights: { bass: 0.36, mid: 1.12, treble: 0.42 },
        sphereNoiseWeights: { bass: 0.22, mid: 1.04, treble: 0.42 },
        ringNoiseWeights: { bass: 0.34, mid: 0.68, treble: 0.34 },
      },
      explosion: {
        onBeat: true,
        cooldownMs: 3000,
        durationMs: 950,
      },
    }),
  },
  {
    name: 'Rave Mode',
    tags: ['rave', '160-180bpm', 'reactive'],
    blurb: 'Aggressive rave-reactive preset with bar-gated drops and boosted visuals.',
    snapshot: (base = {}) => ({
      ...base,
      audio: {
        smoothing: 0.58,
        sensitivity: 1.20,
        lowHz: 180,
        midHz: 2400,
        subHz: 85,
        beatCooldown: 320,
        envAttack: 0.70,
        envRelease: 0.12,
        agcEnabled: true,
        agcDecay: 0.995,
        noiseGateEnabled: true,
        noiseGateThreshold: 0.12,
        beatEnergyFloor: 0.30,
        drop: {
          enabled: true,
          flux: 1.45,
          bass: 0.60,
          centroidSlope: 0.020,
          minBeats: 6,
          cooldownMs: 6500,
          barGateEnabled: true,
          beatsPerBar: 4,
          downbeatToleranceMs: 80,
          useBassFlux: true,
          autoThresholds: true,
        },
      },
      visuals: {
        bloomBase: 1.25,
        bloomReactive: 0.95,
        autoRotate: 0.0025,
        particleDensity: 1.10,
        enableDispersion: true,
      },
      mapping: {
        sizeFromRms: 0.62,
        sphereBrightnessFromRms: 1.95,
        sphereNoiseFromMid: 1.35,
        spherePulseFromBass: 1.18,
        sphereSparkleFromTreble: 1.00,
        ringScaleFromBands: 0.52,
        ringSpeedFromBands: 2.2,
        ringNoiseFromBands: 0.60,
        ringTiltFromBass: 0.76,
        cameraShakeFromBeat: 0.50,
        lightIntensityFromBass: 2.9,
        fovPumpFromBass: 0.85,
        bandWeightBass: 1.40,
        bandWeightMid: 1.15,
        bandWeightTreble: 1.10,
        cameraRollFromCentroid: 0.26,
        mainSwayFromFlux: 0.22,
        starTwinkleFromTreble: 1.35,
        advancedMapping: true,
        sizeWeights: { bass: 1.16, mid: 0.60, treble: 0.24 },
        ringScaleWeights: { bass: 0.94, mid: 0.66, treble: 0.26 },
        ringSpeedWeights: { bass: 0.38, mid: 1.16, treble: 0.46 },
        sphereNoiseWeights: { bass: 0.24, mid: 1.06, treble: 0.44 },
        ringNoiseWeights: { bass: 0.36, mid: 0.70, treble: 0.36 },
        drop: { intensity: 1.6, bloomBoost: 0.75, shake: 0.60, ringBurst: 0.80 },
      },
      explosion: {
        onBeat: true,
        cooldownMs: 2400,
        durationMs: 1000,
      },
    }),
  },
];

function deepClone(value) {
  if (value === null || value === undefined) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (_) {
    // structuredClone not available or failed, fall back to JSON
  }
  return JSON.parse(JSON.stringify(value));
}

function createEmptyState() {
  return {
    version: 2,
    presets: {},
    order: [],
    favorites: [],
    recents: [],
    lockedParams: {},
    audioModulation: {},
    lastActiveId: null,
  };
}

function createPresetRecord({ id, name, tags = [], snapshot, blurb }) {
  const now = Date.now();
  const versionEntry = {
    id: makeId('version'),
    savedAt: now,
    note: 'Initial version',
    data: deepClone(snapshot),
  };
  return {
    id,
    name,
    tags,
    blurb,
    favorite: false,
    createdAt: now,
    updatedAt: now,
    data: deepClone(snapshot),
    versions: [versionEntry],
  };
}

export class PresetManager {
  constructor({ sceneApi, audioEngine, storage = window.localStorage } = {}) {
    this.sceneApi = sceneApi;
    this.audioEngine = audioEngine;
    this.storage = storage;
    this._listeners = new Set();
    this._previousSnapshot = null;
    this._activePresetId = null;
    this._compareSnapshot = null;

    this._state = this._loadState();
    if (!this._state || typeof this._state !== 'object') {
      this._state = createEmptyState();
    }

    // Versioned reset to delete existing presets and bootstrap only the new default set
    const EXPECTED_VERSION = 2;
    if ((this._state.version || 0) !== EXPECTED_VERSION) {
      this._state = createEmptyState();
    }

    if (Object.keys(this._state.presets).length === 0) {
      this._bootstrapDefaults();
    }

    this._ensureDefaultLocks();

    window.__presetManager = this;
    this._log('ready', { presetCount: Object.keys(this._state.presets).length });
  }

  get activePresetId() {
    return this._activePresetId || this._state.lastActiveId || null;
  }

  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    const wrapped = { event, handler };
    this._listeners.add(wrapped);
    return () => this._listeners.delete(wrapped);
  }

  off(handler) {
    for (const entry of this._listeners) {
      if (entry.handler === handler) this._listeners.delete(entry);
    }
  }

  list(filter = '', tags = []) {
    const query = (filter || '').trim().toLowerCase();
    const tagSet = new Set((tags || []).map((t) => t.toLowerCase()));
    const results = this._state.order.map((id) => this._state.presets[id]).filter(Boolean);
    return results.filter((preset) => {
      const matchesQuery = !query
        || preset.name.toLowerCase().includes(query)
        || (preset.tags || []).some((tag) => tag.toLowerCase().includes(query));
      const matchesTags = tagSet.size === 0
        || (preset.tags || []).some((tag) => tagSet.has(tag.toLowerCase()));
      return matchesQuery && matchesTags;
    }).map((preset) => this._toPublicPreset(preset));
  }

  getRecent(limit = RECENT_LIMIT) {
    const filtered = this._state.recents.filter((entry) => this._state.presets[entry.id]);
    return filtered.slice(0, limit).map((entry) => {
      const preset = this._state.presets[entry.id];
      return {
        id: entry.id,
        name: preset.name,
        lastUsedAt: entry.usedAt,
        tags: preset.tags,
        favorite: !!preset.favorite,
      };
    });
  }

  getFavorites() {
    return this._state.favorites
      .map((id) => this._state.presets[id])
      .filter(Boolean)
      .map((preset) => this._toPublicPreset(preset));
  }

  save(identifier, options = {}) {
    const target = this._resolvePreset(identifier || this.activePresetId);
    if (!target) throw new Error('Preset not found for save');

    const snapshot = options.snapshot || capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
    this._writeVersion(target, snapshot, options.note);
    if (options.tags) target.tags = Array.from(new Set(options.tags));
    if (typeof options.favorite === 'boolean') target.favorite = options.favorite;
    target.updatedAt = Date.now();

    this._persist();
    this._notify('saved', { preset: this._toPublicPreset(target) });
    this._log('save', { id: target.id, name: target.name });
    return target.id;
  }

  saveAs(newName, options = {}) {
    if (!newName || typeof newName !== 'string') throw new Error('Preset name required');
    if (this._findByName(newName)) throw new Error('Preset name already exists');
    const snapshot = options.snapshot || capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
    const id = makeId();
    const preset = createPresetRecord({ id, name: newName.trim(), tags: options.tags || [], snapshot, blurb: options.blurb });
    this._state.presets[id] = preset;
    this._state.order.unshift(id);
    if (options.favorite) this._ensureFavorite(id, true);
    this._setActive(id, { snapshot });
    this._persist();
    this._notify('created', { preset: this._toPublicPreset(preset) });
    this._log('saveAs', { id, name: newName });
    return id;
  }

  create({ name, tags = [], snapshot, blurb }) {
    if (!name) throw new Error('Preset name required');
    if (this._findByName(name)) throw new Error('Preset name already exists');
    const data = snapshot || capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
    const id = makeId();
    const preset = createPresetRecord({ id, name: name.trim(), tags, snapshot: data, blurb });
    this._state.presets[id] = preset;
    this._state.order.unshift(id);
    this._setActive(id, { snapshot: data });
    this._persist();
    this._notify('created', { preset: this._toPublicPreset(preset) });
    this._log('create', { id, name });
    return id;
  }

  duplicate(identifier, newName) {
    const source = this._resolvePreset(identifier);
    if (!source) throw new Error('Preset not found for duplicate');
    const name = newName || `${source.name} Copy`;
    if (this._findByName(name)) throw new Error('Preset name already exists');
    const snapshot = deepClone(source.data);
    const id = makeId();
    const preset = createPresetRecord({ id, name, tags: source.tags, snapshot, blurb: source.blurb });
    preset.favorite = source.favorite;
    this._state.presets[id] = preset;
    this._state.order.unshift(id);
    if (source.favorite) this._ensureFavorite(id, true);
    this._persist();
    this._notify('duplicated', { preset: this._toPublicPreset(preset), from: source.id });
    this._log('duplicate', { from: source.id, to: id });
    return id;
  }

  rename(identifier, newName) {
    if (!newName) throw new Error('New name required');
    const target = this._resolvePreset(identifier);
    if (!target) throw new Error('Preset not found for rename');
    const existing = this._findByName(newName);
    if (existing && existing.id !== target.id) throw new Error('Preset name already exists');
    const prevName = target.name;
    target.name = newName.trim();
    target.updatedAt = Date.now();
    this._persist();
    this._notify('renamed', { id: target.id, name: target.name });
    this._log('rename', { id: target.id, from: prevName, to: target.name });
    return target.id;
  }

  delete(identifier) {
    const target = this._resolvePreset(identifier);
    if (!target) throw new Error('Preset not found for delete');
    delete this._state.presets[target.id];
    this._state.order = this._state.order.filter((id) => id !== target.id);
    this._state.favorites = this._state.favorites.filter((id) => id !== target.id);
    this._state.recents = this._state.recents.filter((entry) => entry.id !== target.id);
    if (this._activePresetId === target.id) this._activePresetId = null;
    if (this._state.lastActiveId === target.id) this._state.lastActiveId = null;
    this._persist();
    this._notify('deleted', { id: target.id });
    this._log('delete', { id: target.id, name: target.name });
  }

  revert(identifier) {
    const target = this._resolvePreset(identifier || this.activePresetId);
    if (!target) throw new Error('Preset not found for revert');
    if (!target.versions || target.versions.length < 2) throw new Error('No previous version to revert to');
    const previous = target.versions[1];
    target.data = deepClone(previous.data);
    target.updatedAt = Date.now();
    this._writeVersion(target, previous.data, 'Revert to prior version');
    this._persist();
    this.load(target.id, { silent: true });
    this._notify('reverted', { id: target.id });
    this._log('revert', { id: target.id });
    return target.id;
  }

  load(identifier, options = {}) {
    const target = this._resolvePreset(identifier || this.activePresetId);
    if (!target) throw new Error('Preset not found for load');
    const snapshot = this._applyGuards(deepClone(target.data));
    if (!options.skipRollbackCapture) {
      this._previousSnapshot = capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
    }
    applyPresetSnapshot(snapshot, { sceneApi: this.sceneApi, audioEngine: this.audioEngine, silent: !!options.silent });
    this._setActive(target.id, { snapshot });
    this._recordRecent(target.id);
    this._persist();
    this._notify('loaded', { preset: this._toPublicPreset(target) });
    this._log('load', { id: target.id, name: target.name });
    return target.id;
  }

  quickCompare(identifier) {
    const target = this._resolvePreset(identifier || this.activePresetId);
    if (!target) throw new Error('Preset not found for quick compare');
    if (!this._compareSnapshot) {
      this._compareSnapshot = capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
      this.load(target.id, { silent: true, skipRollbackCapture: true });
    } else {
      applyPresetSnapshot(this._compareSnapshot, { sceneApi: this.sceneApi, audioEngine: this.audioEngine, silent: true });
      this._compareSnapshot = null;
      this._notify('compareRestored', { id: target.id });
    }
  }

  setFavorite(identifier, isFavorite) {
    const target = this._resolvePreset(identifier);
    if (!target) throw new Error('Preset not found for favorite toggle');
    target.favorite = !!isFavorite;
    this._ensureFavorite(target.id, target.favorite);
    this._persist();
    this._notify('favoriteChanged', { id: target.id, favorite: target.favorite });
    this._log('favorite', { id: target.id, favorite: target.favorite });
  }

  enableAudioModulation(param, enabled) {
    if (!param) return;
    this._state.audioModulation[param] = !!enabled;
    if (enabled) this.unlockParam(param, { silent: true });
    else this.lockParam(param, { silent: true });
    this._notify('modulationChanged', { param, enabled: !!enabled });
    this._log('modulation', { param, enabled: !!enabled });
  }

  isAudioModulationEnabled(param) {
    return !!this._state.audioModulation[param];
  }

  lockParam(param, { silent = false } = {}) {
    if (!param) return;
    try {
      const snapshot = capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
      const value = getByPath(snapshot, param);
      this._state.lockedParams[param] = { value, lockedAt: Date.now() };
      this._persist();
      if (!silent) this._notify('paramLocked', { param, value });
      this._log('lock', { param, value });
    } catch (err) {
      console.warn('Failed to lock param', param, err);
    }
  }

  unlockParam(param, { silent = false } = {}) {
    if (!param) return;
    if (this._state.lockedParams[param]) {
      delete this._state.lockedParams[param];
      this._persist();
      if (!silent) this._notify('paramUnlocked', { param });
      this._log('unlock', { param });
    }
  }

  isParamLocked(param) {
    return !!this._state.lockedParams[param];
  }

  rollback() {
    if (!this._previousSnapshot) return false;
    applyPresetSnapshot(this._previousSnapshot, { sceneApi: this.sceneApi, audioEngine: this.audioEngine, silent: true });
    this._notify('rollback', {});
    this._log('rollback', { restored: true });
    this._previousSnapshot = null;
    return true;
  }

  getHistory(identifier) {
    const target = this._resolvePreset(identifier || this.activePresetId);
    if (!target) return [];
    return target.versions.map((entry, idx) => ({
      id: entry.id,
      savedAt: entry.savedAt,
      note: entry.note,
      isCurrent: idx === 0,
    }));
  }

  restoreVersion(identifier, versionId) {
    const target = this._resolvePreset(identifier || this.activePresetId);
    if (!target) throw new Error('Preset not found for restore');
    const entry = target.versions.find((v) => v.id === versionId);
    if (!entry) throw new Error('Version not found');
    target.data = deepClone(entry.data);
    target.updatedAt = Date.now();
    this._writeVersion(target, entry.data, `Restore version ${new Date(entry.savedAt).toLocaleString()}`);
    this._persist();
    this.load(target.id, { silent: true });
    this._notify('versionRestored', { id: target.id, versionId });
    this._log('restoreVersion', { id: target.id, versionId });
  }

  exportState() {
    return deepClone(this._state);
  }

  _bootstrapDefaults() {
    const baseSnapshot = capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
    DEFAULT_PRESETS.forEach((presetDefinition) => {
      try {
        const id = makeId();
        const snapshot = presetDefinition.snapshot(baseSnapshot);
        const preset = createPresetRecord({ id, name: presetDefinition.name, tags: presetDefinition.tags, snapshot, blurb: presetDefinition.blurb });
        preset.favorite = presetDefinition.tags.includes('headline');
        this._state.presets[id] = preset;
        this._state.order.push(id);
        if (preset.favorite) this._state.favorites.push(id);
      } catch (err) {
        console.warn('Failed to bootstrap preset', presetDefinition?.name, err);
      }
    });
    if (this._state.order.length) {
      const firstId = this._state.order[0];
      this._setActive(firstId, { snapshot: this._state.presets[firstId].data });
    }
    this._persist();
  }

  _writeVersion(preset, snapshot, note = 'Saved') {
    const entry = {
      id: makeId('version'),
      savedAt: Date.now(),
      note,
      data: deepClone(snapshot),
    };
    preset.data = deepClone(snapshot);
    preset.versions.unshift(entry);
    if (preset.versions.length > VERSION_LIMIT) preset.versions = preset.versions.slice(0, VERSION_LIMIT);
  }

  _ensureFavorite(id, shouldExist) {
    const set = new Set(this._state.favorites);
    if (shouldExist) set.add(id); else set.delete(id);
    this._state.favorites = Array.from(set);
  }

  _applyGuards(snapshot) {
    const locks = this._state.lockedParams || {};
    Object.entries(locks).forEach(([path, meta]) => {
      if (!meta || typeof meta.value === 'undefined') return;
      setByPath(snapshot, path, meta.value);
    });
    return snapshot;
  }

  _recordRecent(id) {
    const now = Date.now();
    const filtered = this._state.recents.filter((entry) => entry.id !== id);
    filtered.unshift({ id, usedAt: now });
    this._state.recents = filtered.slice(0, RECENT_LIMIT * 2);
  }

  _resolvePreset(identifier) {
    if (!identifier) return null;
    if (this._state.presets[identifier]) return this._state.presets[identifier];
    const byName = this._findByName(identifier);
    return byName || null;
  }

  _findByName(name) {
    if (!name) return null;
    const lower = name.trim().toLowerCase();
    return Object.values(this._state.presets).find((preset) => preset.name.trim().toLowerCase() === lower) || null;
  }

  _setActive(id, { snapshot }) {
    this._activePresetId = id;
    this._state.lastActiveId = id;
    this._recordRecent(id);
    if (snapshot) this._state.presets[id].data = deepClone(snapshot);
  }

  _ensureDefaultLocks() {
    const missing = DEFAULT_LOCK_PARAMS.filter((param) => !this._state.lockedParams[param]);
    if (!missing.length) return;
    let snapshot = null;
    try {
      snapshot = capturePresetSnapshot({ sceneApi: this.sceneApi, audioEngine: this.audioEngine });
    } catch (err) {
      console.warn('Unable to capture snapshot for default locks', err);
      return;
    }
    let changed = false;
    missing.forEach((param) => {
      const value = getByPath(snapshot, param);
      if (typeof value !== 'undefined') {
        this._state.lockedParams[param] = { value, lockedAt: Date.now(), auto: true };
        changed = true;
      }
    });
    if (changed) this._persist();
  }

  _loadState() {
    if (!this.storage) return createEmptyState();
    const tryParse = (raw) => {
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_) { return null; }
    };
    const primary = tryParse(this.storage.getItem(STORAGE_KEYS.primary));
    if (primary) return primary;
    const working = tryParse(this.storage.getItem(STORAGE_KEYS.working));
    if (working) return working;
    const backup = tryParse(this.storage.getItem(STORAGE_KEYS.backup));
    if (backup) return backup;
    return createEmptyState();
  }

  _persist() {
    if (!this.storage) return;
    const payload = JSON.stringify(this._state, null, 2);
    try {
      this.storage.setItem(STORAGE_KEYS.working, payload);
      const previous = this.storage.getItem(STORAGE_KEYS.primary);
      if (previous) this.storage.setItem(STORAGE_KEYS.backup, previous);
      this.storage.setItem(STORAGE_KEYS.primary, payload);
      this.storage.removeItem(STORAGE_KEYS.working);
    } catch (err) {
      console.error('PresetManager persist failed', err);
    }
  }

  _notify(event, detail) {
    for (const listener of this._listeners) {
      if (listener.event === event || listener.event === '*') {
        try { listener.handler({ event, detail }); } catch (err) { console.error('PresetManager listener error', err); }
      }
    }
  }

  _toPublicPreset(raw) {
    return {
      id: raw.id,
      name: raw.name,
      tags: raw.tags,
      blurb: raw.blurb,
      favorite: !!raw.favorite,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      isActive: raw.id === this.activePresetId,
    };
  }

  _log(action, detail) {
    try {
      console.info('[PresetManager]', action, detail || {});
    } catch (_) {}
  }

  /**
   * Dispose and cleanup preset manager resources.
   *
   * This method properly cleans up the PresetManager to prevent memory leaks:
   * - Clears all event listeners
   * - Removes references to scene and audio engine
   *
   * Call this when the application is shutting down.
   */
  dispose() {
    // Clear all event listeners
    if (this._listeners) {
      this._listeners.clear();
      this._listeners = null;
    }

    // Clear references
    this.sceneApi = null;
    this.audioEngine = null;
    this.storage = null;
    this._previousSnapshot = null;
    this._compareSnapshot = null;

    // Remove global reference
    if (typeof window !== 'undefined') {
      delete window.__presetManager;
    }
  }
}

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((acc, key) => (acc && Object.prototype.hasOwnProperty.call(acc, key) ? acc[key] : undefined), obj);
}

function setByPath(obj, path, value) {
  if (!obj || !path) return;
  const keys = path.split('.');
  let cursor = obj;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (cursor[key] === null || cursor[key] === undefined || typeof cursor[key] !== 'object') cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
}

