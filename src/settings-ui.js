// New glass settings UI (drawer + tabs) — no external UI lib
// Exports: initSettingsUI({ sceneApi, audioEngine, onScreenshot, syncCoordinator })

import {
  DISPERSION_DEFAULTS,
  DISPERSION_SECTIONS,
  DISPERSION_PARAM_SCHEMA,
  DISPERSION_STORAGE_KEYS,
  withDispersionDefaults,
  cloneDispersion,
  clampValueForKey,
  sectionKeys,
  pickSection,
  assignSection,
  serializeDispersion,
  deserializeDispersion,
  applyMacroValue,
  DISPERSION_MACROS,
  DISPERSION_STYLES,
  applyStyle,
  randomizeSection,
  getParamSchema,
} from './dispersion-config.js';
import { capturePresetSnapshot, applyPresetSnapshot } from './preset-io.js';
import { showToast } from './toast.js';

export function initSettingsUI({ sceneApi, audioEngine, presetManager, onScreenshot, openPresetLibrary, syncCoordinator }) {
  const root = document.getElementById('settings-root');
  const drawer = document.getElementById('settings-drawer');
  const overlay = document.getElementById('settings-overlay');
  const tabsEl = document.getElementById('settings-tabs');
  const content = document.getElementById('settings-content');
  const btnOpen = document.getElementById('open-settings-btn');
  const btnClose = document.getElementById('settings-close');
  const btnCloseFooter = document.getElementById('settings-close-footer');
  const btnReset = document.getElementById('settings-reset');
  const btnSaveSettings = document.getElementById('settings-save-settings');
  const btnSavePreset = document.getElementById('settings-save-preset');

  // Inject minimal layout/sticky styles once
  (function ensureSettingsUiStyles(){
    try {
      if (document.getElementById('settings-ui-injected-styles')) return;
      const style = document.createElement('style');
      style.id = 'settings-ui-injected-styles';
      style.textContent = `
        /* Two-column grid for rows */
        #settings-content .section .row { display: grid; grid-template-columns: minmax(160px, 1fr) minmax(260px, 2fr); gap: 12px; align-items: center; }
        #settings-content .section .row.compact { grid-template-columns: minmax(140px, 1fr) minmax(220px, 2fr); }
        #settings-content .section .label { align-self: center; }
        #settings-content .section .control { align-self: center; }
        /* Sticky subheaders */
        #settings-content .section .section-title,
        #settings-content .section .shader-subheader { position: sticky; top: 0; z-index: 3; background: rgba(10,10,14,0.85); backdrop-filter: saturate(120%) blur(8px); padding: 6px 8px; }
        /* Shader section headers sticky for long lists */
        #settings-content .shader-sections-container .shader-section-header { position: sticky; top: 0; z-index: 2; background: rgba(10,10,14,0.8); backdrop-filter: blur(6px); padding: 6px 8px; }
        /* Make entire header act like a button */
        #settings-content .shader-section-header { display: flex; align-items: center; justify-content: space-between; cursor: pointer; }
        #settings-content .shader-section-header .actions { display: flex; align-items: center; gap: 6px; }
        #settings-content .shader-section-header .overflow-btn { padding: 2px 8px; border-radius: 6px; }
        /* Overflow menu styling */
        #settings-content .section-overflow-menu { position: absolute; right: 8px; margin-top: 6px; background: rgba(22,22,28,0.98); border-radius: 6px; padding: 6px; display: none; box-shadow: 0 6px 18px rgba(0,0,0,0.35); }
        #settings-content .shader-section-header { position: relative; }
        #settings-content .section-overflow-menu button { display:block; width:100%; text-align:left; }
        /* Session summary */
        #settings-content .session-summary { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        #settings-content .session-summary .fps-pill { padding: 2px 8px; border-radius: 12px; background: rgba(255,255,255,0.08); font-variant-numeric: tabular-nums; }
        #settings-content .session-summary .sync-pill { margin-right: 4px; }
        /* Hotkey help overlay */
        #settings-hotkey-help { position: fixed; inset: 0; background: rgba(8,8,12,0.88); color: #fff; z-index: 10000; display: none; }
        #settings-hotkey-help .inner { max-width: 760px; margin: 10vh auto; padding: 16px 20px; background: rgba(20,20,28,0.9); border-radius: 10px; line-height: 1.6; font-family: system-ui, sans-serif; }
        #settings-hotkey-help h3 { margin: 0 0 8px 0; font-size: 16px; }
        #settings-hotkey-help ul { margin: 8px 0; padding-left: 18px; }
        #settings-hotkey-help .close { float: right; }
      `;
      document.head.appendChild(style);
    } catch(_) {}
  })();

  const tabs = [
    { id: 'quick', label: 'Quick' },
    { id: 'source', label: 'Source' },
    { id: 'audio', label: 'Audio' },
    { id: 'visuals', label: 'Visuals' },
    { id: 'shader', label: 'Shader' },
    { id: 'mapping', label: 'Mapping' },
    { id: 'tempo', label: 'Tempo' },
    { id: 'presets', label: 'Presets' },
    { id: 'session', label: 'Session' },
  ];
  let currentTab = 'quick';
  const SETTINGS_STORAGE_KEY = 'cosmic_saved_settings';
  const showProjectorControls = !!syncCoordinator && syncCoordinator.role === 'control';
  let syncStatusNode = null;
  let syncAutoCheckbox = null;
  let reactiveBoostBaselines = null;

  const clamp01 = (v) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return 0;
    if (num < 0) return 0;
    if (num > 1) return 1;
    return num;
  };

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  };
  const writeJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  };

  const ensureDispersionParams = () => {
    if (!sceneApi.state.params) sceneApi.state.params = {};
    const merged = withDispersionDefaults(sceneApi.state.params.dispersion || {});
    sceneApi.state.params.dispersion = merged;
    return merged;
  };
  ensureDispersionParams();

  const ACTIVE_SECTION_KEY = 'cosmic_active_shader_section';
  const initialActiveSection = (() => {
    try {
      const stored = localStorage.getItem(ACTIVE_SECTION_KEY) || '';
      if (stored && DISPERSION_SECTIONS.some((s) => s.id === stored)) return stored;
    } catch(_) {}
    return DISPERSION_SECTIONS[0]?.id || null;
  })();

  const shaderState = {
    searchQuery: '',
    activeSection: initialActiveSection,
    pinnedKeys: readJson(DISPERSION_STORAGE_KEYS.pinned, []),
    pinnedHud: !!readJson(DISPERSION_STORAGE_KEYS.pinnedHud, false),
    snapshots: readJson(DISPERSION_STORAGE_KEYS.snapshots, {}),
    macroValues: readJson(DISPERSION_STORAGE_KEYS.macros, {}),
    hotkeysEnabled: readJson(DISPERSION_STORAGE_KEYS.hotkeys, true),
    activeSnapshotSlot: '1',
  };

  shaderState.pinnedKeys = Array.isArray(shaderState.pinnedKeys)
    ? Array.from(new Set(shaderState.pinnedKeys)).filter((key) => !!getParamSchema(key))
    : [];

  const macroValues = {};
  DISPERSION_MACROS.forEach((macro) => {
    const stored = shaderState.macroValues && typeof shaderState.macroValues[macro.id] === 'number'
      ? clamp01(shaderState.macroValues[macro.id])
      : macro.defaultValue;
    macroValues[macro.id] = clamp01(stored);
  });
  shaderState.macroValues = macroValues;

  const snapshotSlots = {};
  for (let slot = 1; slot <= 4; slot += 1) {
    const key = String(slot);
    if (shaderState.snapshots && shaderState.snapshots[key]) {
      snapshotSlots[key] = deserializeDispersion(shaderState.snapshots[key]);
    } else {
      snapshotSlots[key] = null;
    }
  }
  shaderState.snapshots = snapshotSlots;

  let sectionPresetStore = readJson(DISPERSION_STORAGE_KEYS.sectionPresets, {});
  if (!sectionPresetStore || typeof sectionPresetStore !== 'object') sectionPresetStore = {};
  const persistSectionPresets = () => writeJson(DISPERSION_STORAGE_KEYS.sectionPresets, sectionPresetStore);

  let shaderPresetStore = readJson(DISPERSION_STORAGE_KEYS.shaderPresets, {});
  if (!shaderPresetStore || typeof shaderPresetStore !== 'object') shaderPresetStore = {};
  const persistShaderPresets = () => writeJson(DISPERSION_STORAGE_KEYS.shaderPresets, shaderPresetStore);

  const formatValue = (schema, value) => {
    if (schema?.type === 'boolean') return value ? 'On' : 'Off';
    if (schema?.type === 'select') return String(value);
    if (!Number.isFinite(value)) return String(value ?? '');
    const step = schema?.fineStep || schema?.step || 0.01;
    let decimals = 2;
    if (typeof step === 'number') {
      const stepStr = String(step);
      if (stepStr.includes('e')) decimals = 4;
      else if (stepStr.includes('.')) decimals = Math.min(4, stepStr.length - stepStr.indexOf('.') - 1);
      else decimals = 0;
    }
    return value.toFixed(decimals);
  };

  let shaderHudTimer = null;
  const ensureShaderHud = () => {
    let hud = document.getElementById('shader-hud-overlay');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'shader-hud-overlay';
      hud.style.position = 'fixed';
      hud.style.top = '12px';
      hud.style.left = '12px';
      hud.style.padding = '8px 12px';
      hud.style.background = 'rgba(10,10,14,0.76)';
      hud.style.color = '#fff';
      hud.style.fontSize = '12px';
      hud.style.fontFamily = 'sans-serif';
      hud.style.borderRadius = '6px';
      hud.style.pointerEvents = 'none';
      hud.style.opacity = '0';
      hud.style.transition = 'opacity 150ms ease';
      hud.style.zIndex = '9999';
      document.body.appendChild(hud);
    }
    return hud;
  };
  const shaderHudNode = ensureShaderHud();
  const showShaderHud = (label, valueText) => {
    if (!shaderHudNode) return;
    shaderHudNode.textContent = label ? `${label}: ${valueText}` : valueText;
    shaderHudNode.style.opacity = '1';
    clearTimeout(shaderHudTimer);
    shaderHudTimer = setTimeout(() => {
      shaderHudNode.style.opacity = shaderState.pinnedHud ? '0.65' : '0';
    }, 1600);
  };

  const ensurePinnedHud = () => {
    let el = document.getElementById('shader-pinned-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'shader-pinned-hud';
      el.style.position = 'fixed';
      el.style.bottom = '16px';
      el.style.left = '16px';
      el.style.padding = '10px 12px';
      el.style.background = 'rgba(6,6,10,0.72)';
      el.style.borderRadius = '8px';
      el.style.color = '#f0f0f0';
      el.style.fontSize = '12px';
      el.style.fontFamily = 'sans-serif';
      el.style.maxWidth = '240px';
      el.style.pointerEvents = 'none';
      el.style.lineHeight = '1.4';
      el.style.zIndex = '9998';
      document.body.appendChild(el);
    }
    return el;
  };
  const pinnedHudNode = ensurePinnedHud();
  const updatePinnedHudOverlay = () => {
    if (!pinnedHudNode) return;
    if (!shaderState.pinnedHud || shaderState.pinnedKeys.length === 0) {
      pinnedHudNode.style.opacity = '0';
      return;
    }
    const dispersion = ensureDispersionParams();
    const lines = shaderState.pinnedKeys.map((key) => {
      const schema = getParamSchema(key);
      if (!schema) return '';
      return `${schema.label}: ${formatValue(schema, dispersion[key])}`;
    }).filter(Boolean);
    pinnedHudNode.textContent = lines.join('\n');
    pinnedHudNode.style.opacity = '1';
  };

  let shaderRenderContext = null;

  // Concise per-section descriptions used in hover tooltips
  const SECTION_HELP = {
    opacity: 'Overall visibility of the Dispersion overlay. Treble adds extra opacity.',
    zoom: 'Depth zoom amount of the overlay. Higher gain = more dramatic in/out pulses.',
    warp: 'Audio-driven distortion. Choose band with Warp Source; Gain controls intensity.',
    parallax: 'Screen parallax offset from spectral centroid and flux (motion).',
    color: 'Color tinting and how much to mix with detected chroma (key/notes).',
    tone: 'Brightness/contrast shaping plus reactive gain.',
    twist: 'Vortex rotation energy from bass/beat/onsets/flux; attack/release shape it.',
    stutter: 'Flip/toggle behaviors and pulse decay for rhythmic effects.',
    travel: 'Forward motion through the field; boost on beats/drops.',
  };

  const notifyRenderAll = () => {
    if (shaderRenderContext && typeof shaderRenderContext.refreshAll === 'function') {
      shaderRenderContext.refreshAll();
    }
  };

  const nudgeParamValue = (key, direction, event) => {
    const schema = getParamSchema(key);
    if (!schema || schema.type !== 'range') return;
    const params = ensureDispersionParams();
    const baseStep = schema.step || ((schema.max - schema.min) / 100);
    const fine = schema.fineStep || baseStep * 0.25;
    const coarse = baseStep * 5;
    const delta = (event?.shiftKey ? coarse : event?.altKey ? fine : baseStep) * direction;
    const next = clampValueForKey(key, (Number(params[key]) || 0) + delta);
    setParamValue(key, next);
  };

  const setParamValue = (key, value, { showHud = true, refresh = true } = {}) => {
    const schema = getParamSchema(key);
    if (!schema) return;
    const params = ensureDispersionParams();
    params[key] = clampValueForKey(key, value);
    updatePinnedHudOverlay();
    if (showHud) showShaderHud(schema.label, formatValue(schema, params[key]));
    if (refresh) {
      notifyRenderAll();
    } else if (shaderRenderContext && typeof shaderRenderContext.refreshValue === 'function') {
      shaderRenderContext.refreshValue(key, params[key]);
    }
  };

  const resetParamToDefault = (key, opts = {}) => {
    const schema = getParamSchema(key);
    if (!schema) return;
    setParamValue(key, schema.default, opts);
  };

  const resetSectionToDefaults = (sectionId) => {
    const keys = sectionKeys(sectionId);
    const params = ensureDispersionParams();
    keys.forEach((key) => {
      const schema = getParamSchema(key);
      if (!schema) return;
      params[key] = schema.default;
    });
    updatePinnedHudOverlay();
    notifyRenderAll();
  };

  const applySectionPreset = (sectionId, values) => {
    if (!values) return;
    const params = ensureDispersionParams();
    assignSection(params, values, sectionId);
    updatePinnedHudOverlay();
    notifyRenderAll();
  };

  const persistPinnedKeys = () => writeJson(DISPERSION_STORAGE_KEYS.pinned, shaderState.pinnedKeys);
  const persistPinnedHud = () => writeJson(DISPERSION_STORAGE_KEYS.pinnedHud, shaderState.pinnedHud);
  const persistSnapshots = () => {
    const toStore = {};
    Object.entries(shaderState.snapshots).forEach(([slot, values]) => {
      if (values) toStore[slot] = serializeDispersion(values);
    });
    writeJson(DISPERSION_STORAGE_KEYS.snapshots, toStore);
  };
  const persistMacroValues = () => writeJson(DISPERSION_STORAGE_KEYS.macros, shaderState.macroValues);
  const persistHotkeys = () => writeJson(DISPERSION_STORAGE_KEYS.hotkeys, shaderState.hotkeysEnabled);
  const persistActiveSection = () => { try { localStorage.setItem(ACTIVE_SECTION_KEY, shaderState.activeSection || ''); } catch(_) {} };
  const AUDIO_SHOW_ADV_KEY = 'cosmic_audio_show_advanced';
  const SNAPSHOTS_COLLAPSED_KEY = 'cosmic_snapshots_collapsed';

  function applyReactiveBoost(factor) {
    const params = sceneApi.state.params;
    const m = params.map || (params.map = {});
    if (!reactiveBoostBaselines) {
      reactiveBoostBaselines = {
        bloomReactiveGain: params.bloomReactiveGain,
        cameraShakeFromBeat: m.cameraShakeFromBeat,
        fovPumpFromBass: m.fovPumpFromBass || 0.6,
        spherePulseFromBass: m.spherePulseFromBass || 0.6,
        lightIntensityFromBass: m.lightIntensityFromBass,
      };
    }
    params.reactiveBoost = factor;
    if (typeof reactiveBoostBaselines.bloomReactiveGain === 'number') {
      params.bloomReactiveGain = Math.max(0, reactiveBoostBaselines.bloomReactiveGain * factor);
    }
    if (typeof reactiveBoostBaselines.cameraShakeFromBeat === 'number') m.cameraShakeFromBeat = reactiveBoostBaselines.cameraShakeFromBeat * factor;
    if (typeof reactiveBoostBaselines.fovPumpFromBass === 'number') m.fovPumpFromBass = reactiveBoostBaselines.fovPumpFromBass * factor;
    if (typeof reactiveBoostBaselines.spherePulseFromBass === 'number') m.spherePulseFromBass = reactiveBoostBaselines.spherePulseFromBass * factor;
    if (typeof reactiveBoostBaselines.lightIntensityFromBass === 'number') m.lightIntensityFromBass = reactiveBoostBaselines.lightIntensityFromBass * factor;
    try { showShaderHud('Reactive Boost', `${Math.round(factor*100)}%`); } catch(_) {}
  }

  const togglePinned = (key) => {
    if (!shaderState.pinnedKeys.includes(key)) {
      shaderState.pinnedKeys.push(key);
    } else {
      shaderState.pinnedKeys = shaderState.pinnedKeys.filter((k) => k !== key);
    }
    shaderState.pinnedKeys = shaderState.pinnedKeys.filter((k) => !!getParamSchema(k));
    persistPinnedKeys();
    updatePinnedHudOverlay();
    notifyRenderAll();
  };

  const storeSnapshot = (slot, values) => {
    shaderState.snapshots[slot] = values ? cloneDispersion(values) : null;
    persistSnapshots();
  };

  const loadSnapshot = (slot, { silent = false } = {}) => {
    const stored = shaderState.snapshots[slot];
    if (!stored) return false;
    const params = ensureDispersionParams();
    Object.assign(params, withDispersionDefaults(stored));
    updatePinnedHudOverlay();
    notifyRenderAll();
    if (!silent) showShaderHud(`Snapshot ${slot}`, 'Loaded');
    return true;
  };

  const captureSnapshot = (slot) => {
    const params = ensureDispersionParams();
    storeSnapshot(slot, serializeDispersion(params));
    showShaderHud(`Snapshot ${slot}`, 'Saved');
  };

  const clearSnapshot = (slot) => {
    shaderState.snapshots[slot] = null;
    storeSnapshot(slot, null);
    showShaderHud(`Snapshot ${slot}`, 'Cleared');
    notifyRenderAll();
  };

  const updateMacro = (macroId, value, { showHud = true } = {}) => {
    const macro = DISPERSION_MACROS.find((m) => m.id === macroId);
    if (!macro) return;
    const params = ensureDispersionParams();
    shaderState.macroValues[macroId] = clamp01(value);
    applyMacroValue(params, macroId, shaderState.macroValues[macroId]);
    persistMacroValues();
    updatePinnedHudOverlay();
    notifyRenderAll();
    if (showHud) showShaderHud(macro.label, `${Math.round(shaderState.macroValues[macroId] * 100)}%`);
  };

  function open() {
    root.style.display = 'block';
    requestAnimationFrame(() => { root.classList.add('open'); });
    try { btnOpen.setAttribute('aria-expanded', 'true'); } catch(_) {}
  }
  function close() {
    root.classList.remove('open');
    setTimeout(() => { root.style.display = 'none'; }, 260);
    try { btnOpen.setAttribute('aria-expanded', 'false'); } catch(_) {}
  }

  // removed buildShaderQuick: merged into buildShader top area

  btnOpen.addEventListener('click', open);
  overlay.addEventListener('click', close);
  btnClose.addEventListener('click', close);
  btnCloseFooter.addEventListener('click', close);

  // Define named handler to prevent duplicate listeners
  const handleGlobalKeydown = (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') close();
    if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (root.style.display === 'block' && root.classList.contains('open')) close(); else open();
    }
    if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.metaKey && !e.ctrlKey) {
      const help = ensureHotkeyHelp();
      help.style.display = help.style.display === 'block' ? 'none' : 'block';
    }
  };

  // Remove before adding to prevent duplicates if initSettingsUI is called multiple times
  window.removeEventListener('keydown', handleGlobalKeydown);
  window.addEventListener('keydown', handleGlobalKeydown);

  // Helpers: showToast centralized in toast.js

  function h(tag, props = {}, children = []) {
    const el = document.createElement(tag);
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v);
    }
    if (!Array.isArray(children)) children = [children];
    for (const c of children) {
      if (c == null) continue;
      if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    }
    return el;
  }

  // Hotkey help overlay
  function ensureHotkeyHelp() {
    let el = document.getElementById('settings-hotkey-help');
    if (!el) {
      el = document.createElement('div');
      el.id = 'settings-hotkey-help';
      const inner = document.createElement('div');
      inner.className = 'inner';
      const close = button('Close (Esc)', () => { el.style.display = 'none'; }, { class: 'ghost close' });
      inner.appendChild(close);
      const title = document.createElement('h3');
      title.textContent = 'Keyboard Shortcuts';
      inner.appendChild(title);
      const list = document.createElement('ul');
      const li = (t) => { const l = document.createElement('li'); l.textContent = t; list.appendChild(l); };
      li('S: Toggle Shader Overlay (when settings open)');
      li('[ / ]: Nudge Warp Gain (Alt=Fine, Shift=Coarse)');
      li("; / ' / \" : Nudge Twist Max");
      li('1–4: Load Snapshot; Shift+Click Snapshot button to Save; Alt+Click to Clear');
      li('Shift+R: Reset Active Section');
      li('Shift+S: Open Shader Quick');
      inner.appendChild(list);
      el.appendChild(inner);
      document.body.appendChild(el);
    }
    return el;
  }

  function fieldRow(label, control) {
    const row = h('div', { class: 'row' }, [
      h('div', { class: 'label' }, label),
      h('div', { class: 'control' }, control),
    ]);
    return row;
  }

  function slider({ min, max, step, value, oninput, onchange, units, precision, resetValue, onreset, showStepper }) {
    const wrap = h('div', { class: 'slider-wrap' });
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    const formatNumber = (v) => {
      const num = Number(v);
      if (!Number.isFinite(num)) return '';
      let decimals = 2;
      if (typeof precision === 'number') {
        decimals = Math.max(0, precision|0);
      } else if (typeof step === 'number') {
        const stepStr = String(step);
        if (stepStr.includes('e')) decimals = 4;
        else if (stepStr.includes('.')) decimals = Math.min(4, stepStr.length - stepStr.indexOf('.') - 1);
        else decimals = 0;
      }
      const base = num.toFixed(decimals);
      return units ? `${base}${units}` : base;
    };
    const valueChip = h('span', { class: 'value-chip' }, formatNumber(value));
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valueChip.textContent = formatNumber(v);
      if (typeof oninput === 'function') oninput(v);
    });
    if (typeof onchange === 'function') {
      input.addEventListener('change', () => onchange(parseFloat(input.value)));
    }
    wrap.appendChild(input);
    wrap.appendChild(valueChip);
    if (showStepper) {
      const toNum = (x, d=0) => { const n = Number(x); return Number.isFinite(n) ? n : d; };
      const minus = h('button', { class: 'stepper minus' }, '−');
      const plus = h('button', { class: 'stepper plus' }, '+');
      minus.addEventListener('click', () => {
        const s = toNum(step, 1);
        const next = Math.max(toNum(min, -Infinity), toNum(input.value, 0) - s);
        input.value = String(next);
        valueChip.textContent = formatNumber(next);
        if (typeof oninput === 'function') oninput(next);
      });
      plus.addEventListener('click', () => {
        const s = toNum(step, 1);
        const next = Math.min(toNum(max, Infinity), toNum(input.value, 0) + s);
        input.value = String(next);
        valueChip.textContent = formatNumber(next);
        if (typeof oninput === 'function') oninput(next);
      });
      wrap.appendChild(minus);
      wrap.appendChild(plus);
    }
    if (resetValue !== undefined) {
      const resetBtn = h('button', { class: 'reset-btn ghost', title: 'Reset to default' }, '↺');
      resetBtn.addEventListener('click', () => {
        input.value = String(resetValue);
        valueChip.textContent = formatNumber(resetValue);
        if (typeof oninput === 'function') oninput(resetValue);
        if (typeof onreset === 'function') onreset(resetValue);
      });
      wrap.appendChild(resetBtn);
    }
    return wrap;
  }

  function select(opts, value, onchange) {
    const s = h('select');
    for (const { label, value: val } of opts) s.appendChild(h('option', { value: String(val), selected: val === value ? 'true' : undefined }, label));
    s.addEventListener('change', () => onchange(s.value));
    return s;
  }

  function button(title, onclick, extra = {}) {
    const props = { onClick: onclick, ...extra };
    return h('button', props, title);
  }

  // Tab builders
  async function buildSource() {
    const container = h('div', { class: 'section' });
    container.appendChild(h('div', { class: 'section-title' }, 'Source'));
    const isMac = (() => { try { const ua = navigator.userAgent || ''; const plat = navigator.platform || ''; return /Mac/i.test(ua) || /Mac/i.test(plat); } catch(_) { return false; } })();
    const systemLabel = isMac ? 'Tab (Chrome)' : 'System';
    container.appendChild(button('Mic', async () => {
      try { await audioEngine.startMic(localStorage.getItem('cosmic_mic_device_id') || undefined); } catch(e){ showToast('Mic denied/unavailable'); }
    }));
    container.appendChild(button(systemLabel, async () => {
      try { await audioEngine.startSystemAudio(); } catch(e){ /* audioEngine shows detailed toasts */ }
    }));
    container.appendChild(button('File', async () => {
      try { const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*'; input.onchange = async () => { const f = input.files?.[0]; if (f) await audioEngine.loadFile(f); }; input.click(); } catch(e){ showToast('File load failed'); }
    }));
    container.appendChild(button('Stop', () => { try { audioEngine.stop(); } catch(_){} }));

    // Inline hint for macOS users
    if (isMac) {
      container.appendChild(h('div', { style: { fontSize: '11px', color: 'rgba(255,255,255,0.75)', marginTop: '6px', marginBottom: '6px' } },
        'macOS: For a single tab, click "Tab (Chrome)" → enable "Share tab audio". For full system audio, select BlackHole as Mic (see below).'));
    }

    // Devices dropdown
    const deviceRow = h('div', { class: 'section' });
    deviceRow.appendChild(h('div', { class: 'section-title' }, 'Input Device'));
    const devices = await audioEngine.getInputDevices().catch(() => []);

    // Detect popular virtual loopback devices (BlackHole, Loopback, Soundflower, VB-CABLE, Background Music)
    const names = ['blackhole', 'loopback', 'soundflower', 'vb-cable', 'background music'];
    const virtual = devices.find(d => names.some(n => (d.label || '').toLowerCase().includes(n)));
    const prettyVirtualName = virtual ? (['BlackHole','Loopback','Soundflower','VB-CABLE','Background Music'].find(n => (virtual.label||'').toLowerCase().includes(n.toLowerCase())) || 'Virtual Device') : null;

    const opts = devices.map((d, i) => ({ label: d.label || `Mic ${i+1}`, value: d.deviceId || '' }));
    let stored = localStorage.getItem('cosmic_mic_device_id') || '';
    if (!stored && virtual?.deviceId) {
      try { localStorage.setItem('cosmic_mic_device_id', virtual.deviceId); stored = virtual.deviceId; } catch(_) {}
    }
    const dd = select(opts, stored || (virtual?.deviceId || ''), async (id) => {
      try { localStorage.setItem('cosmic_mic_device_id', id); await audioEngine.startMic(id || undefined); } catch(_) { showToast('Mic switch failed'); }
    });
    deviceRow.appendChild(dd);
    deviceRow.appendChild(button('Refresh', async () => { render('source'); showToast('Device list refreshed'); }));

    if (virtual) {
      deviceRow.appendChild(button(`Use ${prettyVirtualName || 'BlackHole'}`, async () => {
        try {
          localStorage.setItem('cosmic_mic_device_id', virtual.deviceId || '');
          await audioEngine.startMic(virtual.deviceId || undefined);
          showToast(`${prettyVirtualName || 'BlackHole'} selected`);
        } catch(_) { showToast('Could not start virtual device'); }
      }));
    }

    container.appendChild(deviceRow);
    return container;
  }

  function buildAudio() {
    const st = {
      gain: 1.0,
      sensitivity: audioEngine.sensitivity || 1.0,
      smoothing: audioEngine.smoothing || 0.6,
      fftSize: audioEngine.fftSize || 2048,
      subHz: audioEngine.bandSplit?.sub || 90,
      lowHz: audioEngine.bandSplit?.low || 200,
      midHz: audioEngine.bandSplit?.mid || 2000,
      beatRefractory: (audioEngine.beatRefractoryMs || audioEngine.beatCooldownMs || 350),
      beatEnergyFloor: (audioEngine.beatEnergyFloor ?? 0.28),
      noiseGateEnabled: !!audioEngine.noiseGateEnabled,
      noiseGateThreshold: (audioEngine.noiseGateThreshold ?? 0.10),
      envAttack: audioEngine.envAttack ?? 0.7,
      envRelease: audioEngine.envRelease ?? 0.12,
      agcEnabled: !!audioEngine.bandAGCEnabled,
      agcDecay: audioEngine.bandAGCDecay ?? 0.995,
      dropEnabled: !!audioEngine.dropEnabled,
      dropFluxThresh: audioEngine.dropFluxThresh ?? 1.4,
      dropBassThresh: audioEngine.dropBassThresh ?? 0.55,
      dropCentroidSlopeThresh: audioEngine.dropCentroidSlopeThresh ?? 0.02,
      dropMinBeats: audioEngine.dropMinBeats ?? 4,
      dropCooldownMs: audioEngine.dropCooldownMs ?? 4000,
      dropBarGateEnabled: !!audioEngine.dropBarGatingEnabled,
      dropBeatsPerBar: audioEngine.dropGateBeatsPerBar ?? 4,
      dropDownbeatTolMs: audioEngine.dropDownbeatGateToleranceMs ?? 80,
      dropUseBassFlux: !!audioEngine.dropUseBassFlux,
      autoDropThresholds: !!audioEngine.autoDropThresholdsEnabled,
      lowCpu: !!audioEngine.lowCpuMode,
    };
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Audio') ]);
    // Advanced gating toggle (persisted)
    let showAdv = false;
    try { showAdv = !!JSON.parse(localStorage.getItem(AUDIO_SHOW_ADV_KEY) || 'false'); } catch(_) { showAdv = false; }
    el.appendChild(fieldRow('Show Advanced', checkbox(showAdv, (v)=>{ try { localStorage.setItem(AUDIO_SHOW_ADV_KEY, JSON.stringify(!!v)); } catch(_) {} render('audio'); })));
    el.appendChild(fieldRow('Gain', slider({ min: 0.1, max: 4.0, step: 0.1, value: st.gain, oninput: (v) => audioEngine.setGain(v) })));
    el.appendChild(fieldRow('Beat Sensitivity', slider({ min: 0.0, max: 2.0, step: 0.05, value: st.sensitivity, oninput: (v) => audioEngine.setSensitivity(v) })));
    el.appendChild(fieldRow('Smoothing', slider({ min: 0.0, max: 0.95, step: 0.05, value: st.smoothing, oninput: (v) => audioEngine.setSmoothing(v) })));
    if (showAdv) {
      el.appendChild(fieldRow('FFT Size', select([
        512,1024,2048,4096,8192,16384,32768
      ].map(n => ({ label: String(n), value: n })), st.fftSize, (v) => audioEngine.setFFTSize(parseInt(v,10)) )));
      el.appendChild(fieldRow('Sub Cutoff (Hz)', slider({ min: 40, max: 120, step: 5, value: st.subHz, oninput: (v) => audioEngine.setSubHz(v) })));
      el.appendChild(fieldRow('Bass Cutoff (Hz)', slider({ min: 60, max: 400, step: 10, value: st.lowHz, oninput: (v) => audioEngine.setBandSplit(v, st.midHz=(st.midHz||2000)) })));
      el.appendChild(fieldRow('Mid Cutoff (Hz)', slider({ min: 800, max: 5000, step: 50, value: st.midHz, oninput: (v) => audioEngine.setBandSplit(st.lowHz=(st.lowHz||200), v) })));
    }
    el.appendChild(fieldRow('Beat Refractory (ms)', slider({ min: 100, max: 1500, step: 25, value: st.beatRefractory, oninput: (v) => audioEngine.setBeatRefractory(v) })));
    el.appendChild(fieldRow('Beat Energy Floor', slider({ min: 0.0, max: 1.0, step: 0.02, value: st.beatEnergyFloor, oninput: (v) => audioEngine.setBeatEnergyFloor(v) })));
    el.appendChild(fieldRow('Noise Gate', checkbox(st.noiseGateEnabled, (v)=> audioEngine.setNoiseGateEnabled(v) )));
    if (showAdv) {
      el.appendChild(fieldRow('Noise Gate Threshold', slider({ min: 0.0, max: 1.0, step: 0.01, value: st.noiseGateThreshold, oninput: (v) => audioEngine.setNoiseGateThreshold(v) })));
      el.appendChild(fieldRow('Calibrate Noise Gate (5s)', button('Calibrate', async ()=>{
        try {
          const thr = await audioEngine.calibrateNoiseGate(5000);
          showToast(`Calibrated: ${Number.isFinite(thr) ? thr.toFixed(2) : String(thr)}`);
        } catch(_) { showToast('Calibration failed'); }
      }, { class: 'ghost' })));
      el.appendChild(fieldRow('Envelope Attack', slider({ min: 0.0, max: 1.0, step: 0.01, value: st.envAttack, oninput: (v) => audioEngine.setEnvAttack(v) })));
      el.appendChild(fieldRow('Envelope Release', slider({ min: 0.0, max: 1.0, step: 0.01, value: st.envRelease, oninput: (v) => audioEngine.setEnvRelease(v) })));
      el.appendChild(fieldRow('Band AGC (Auto Gain)', checkbox(st.agcEnabled, (v)=> audioEngine.setBandAgcEnabled(v) )));
      el.appendChild(fieldRow('AGC Decay', slider({ min: 0.90, max: 0.9999, step: 0.0005, value: st.agcDecay, oninput: (v) => audioEngine.setBandAgcDecay(v) })));
    }
    el.appendChild(fieldRow('Low CPU Mode', checkbox(st.lowCpu, (v)=> audioEngine.setLowCpuMode(v) )));

    // Drop Detection section (advanced)
    if (showAdv) {
      el.appendChild(h('div', { class: 'section-title' }, 'Drop Detection'));
      el.appendChild(fieldRow('Enable', checkbox(st.dropEnabled, (v)=> audioEngine.setDropEnabled(v) )));
      el.appendChild(fieldRow('Flux Z Threshold', slider({ min: 0.2, max: 3.0, step: 0.05, value: st.dropFluxThresh, oninput: (v) => audioEngine.setDropFluxThresh(v) })));
      el.appendChild(fieldRow('Bass Threshold', slider({ min: 0.1, max: 1.0, step: 0.02, value: st.dropBassThresh, oninput: (v) => audioEngine.setDropBassThresh(v) })));
      el.appendChild(fieldRow('Centroid Slope Threshold', slider({ min: 0.005, max: 0.1, step: 0.002, value: st.dropCentroidSlopeThresh, oninput: (v) => audioEngine.setDropCentroidSlopeThresh(v) })));
      el.appendChild(fieldRow('Min Build Beats', slider({ min: 1, max: 8, step: 1, value: st.dropMinBeats, oninput: (v) => audioEngine.setDropMinBeats(v) })));
      el.appendChild(fieldRow('Cooldown (ms)', slider({ min: 500, max: 8000, step: 100, value: st.dropCooldownMs, oninput: (v) => audioEngine.setDropCooldownMs(v) })));
      el.appendChild(fieldRow('Gate Drops to Bars', checkbox(st.dropBarGateEnabled, (v)=> audioEngine.setDropBarGatingEnabled(v) )));
      el.appendChild(fieldRow('Beats per Bar', slider({ min: 1, max: 8, step: 1, value: st.dropBeatsPerBar, oninput: (v) => audioEngine.setDropGateBeatsPerBar(v) })));
      el.appendChild(fieldRow('Downbeat Tolerance (ms)', slider({ min: 20, max: 150, step: 5, value: st.dropDownbeatTolMs, oninput: (v) => audioEngine.setDropDownbeatToleranceMs(v) })));
      el.appendChild(fieldRow('Use Bass Flux for Build', checkbox(st.dropUseBassFlux, (v)=> audioEngine.setDropUseBassFlux(v) )));
      el.appendChild(fieldRow('Auto-Adapt Thresholds (25s)', checkbox(st.autoDropThresholds, (v)=> audioEngine.setAutoDropThresholdsEnabled(v) )));
    }

    // Reactivity Profiles
    el.appendChild(h('div', { class: 'section-title' }, 'Reactivity Profiles'));
    const profiles = h('div', { class: 'row' }, [
      h('div', { class: 'label' }, 'Preset'),
      h('div', { class: 'control' }, [
        button('Aggressive', () => {
          try {
            audioEngine.setGain(1.2);
            audioEngine.setSensitivity(1.6);
            audioEngine.setSmoothing(0.35);
            audioEngine.setEnvAttack(0.45);
            audioEngine.setEnvRelease(0.08);
            audioEngine.setBandAgcEnabled(true);
            audioEngine.setBandAgcDecay(0.997);
            showToast('Reactivity: Aggressive');
            render('audio');
          } catch(_) { showToast('Profile apply failed'); }
        }, { class: 'ghost' }),
        button('Balanced', () => {
          try {
            audioEngine.setGain(1.0);
            audioEngine.setSensitivity(1.1);
            audioEngine.setSmoothing(0.6);
            audioEngine.setEnvAttack(0.7);
            audioEngine.setEnvRelease(0.12);
            audioEngine.setBandAgcEnabled(true);
            audioEngine.setBandAgcDecay(0.995);
            showToast('Reactivity: Balanced');
            render('audio');
          } catch(_) { showToast('Profile apply failed'); }
        }, { class: 'ghost' }),
        button('Subtle', () => {
          try {
            audioEngine.setGain(0.9);
            audioEngine.setSensitivity(0.7);
            audioEngine.setSmoothing(0.85);
            audioEngine.setEnvAttack(0.85);
            audioEngine.setEnvRelease(0.2);
            audioEngine.setBandAgcEnabled(false);
            showToast('Reactivity: Subtle');
            render('audio');
          } catch(_) { showToast('Profile apply failed'); }
        }, { class: 'ghost' })
      ])
    ]);
    el.appendChild(profiles);
    return el;
  }

  function buildVisuals() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Visuals') ]);
    // Theme
    const themeOpts = ['nebula','sunset','forest','aurora'].map(t => ({ label: t, value: t }));
    el.appendChild(fieldRow('Theme', select(themeOpts, sceneApi.state.params.theme, (v) => sceneApi.changeTheme(v))));
    el.appendChild(fieldRow('HDR Background', checkbox(sceneApi.state.params.useHdrBackground, (v)=>{ sceneApi.state.params.useHdrBackground = v; sceneApi.changeTheme(sceneApi.state.params.theme); })));
    el.appendChild(fieldRow('Fog Density', slider({ min: 0.0, max: 0.02, step: 0.0005, value: sceneApi.state.params.fogDensity, oninput: (v)=>{ sceneApi.state.scene.fog.density = v; } })));
    el.appendChild(fieldRow('Bloom Strength (Base)', slider({ min: 0.0, max: 3.0, step: 0.05, value: sceneApi.state.params.bloomStrengthBase, oninput: (v)=>{ sceneApi.state.params.bloomStrengthBase = v; } })));
    el.appendChild(fieldRow('Bloom Strength (Reactive)', slider({ min: 0.0, max: 2.5, step: 0.05, value: sceneApi.state.params.bloomReactiveGain, oninput: (v)=>{ sceneApi.state.params.bloomReactiveGain = v; } })));
    // Visual Reactive Boost scales several reactive mapping intensities and bloom reactive
    const boostVal = typeof sceneApi.state.params.reactiveBoost === 'number' ? sceneApi.state.params.reactiveBoost : 1.0;
    el.appendChild(fieldRow('Reactive Boost', slider({ min: 0.5, max: 2.0, step: 0.05, value: boostVal, oninput: (v)=>{ applyReactiveBoost(v); } })));
    el.appendChild(fieldRow('Pixel Ratio Cap', slider({ min: 0.5, max: 2.0, step: 0.1, value: sceneApi.state.params.pixelRatioCap, oninput: (v)=> sceneApi.setPixelRatioCap(v) })));
    el.appendChild(fieldRow('Auto Rotate', slider({ min: 0.0, max: 0.01, step: 0.0001, value: sceneApi.state.params.autoRotate, oninput: (v)=>{ sceneApi.state.params.autoRotate = v; } })));
    el.appendChild(fieldRow('Particle Density', slider({ min: 0.25, max: 1.5, step: 0.05, value: sceneApi.state.params.particleDensity, oninput: (v)=>{ sceneApi.state.params.particleDensity = v; sceneApi.rebuildParticles(); } })));
    el.appendChild(fieldRow('Sparks', checkbox(sceneApi.state.params.enableSparks, (v)=> sceneApi.setEnableSparks(v))));
    el.appendChild(fieldRow('Core Glow (Lens Flare)', checkbox(sceneApi.state.params.useLensflare, (v)=> sceneApi.setUseLensflare(v))));
    el.appendChild(fieldRow('Auto Resolution', checkbox(sceneApi.state.params.autoResolution, (v)=>{ sceneApi.state.params.autoResolution = v; } )));
    el.appendChild(fieldRow('Target FPS', slider({ min: 30, max: 90, step: 1, value: sceneApi.state.params.targetFps, oninput: (v)=>{ sceneApi.state.params.targetFps = v; } })));
    el.appendChild(fieldRow('Min Pixel Ratio', slider({ min: 0.4, max: 1.5, step: 0.05, value: sceneApi.state.params.minPixelRatio, oninput: (v)=>{ sceneApi.state.params.minPixelRatio = v; } })));

    // Effects profile
    const effectsOpts = [
      { label: 'High', value: 'high' },
      { label: 'Medium', value: 'medium' },
      { label: 'Off', value: 'off' },
    ];
    el.appendChild(fieldRow('Effects Profile', select(effectsOpts, sceneApi.state.params.effectsProfile || 'high', (v)=>{ sceneApi.state.params.effectsProfile = v; sceneApi.setEffectsProfile(v); })));

    // Reset visuals pipeline
    el.appendChild(fieldRow('Reset Visuals', button('Reset', ()=> sceneApi.resetVisualPipeline())));

    // Visual Mode (classic / overlay / shader-only)
    const modeOpts = [
      { label: 'Classic (3D only)', value: 'classic' },
      { label: '3D + Dispersion', value: 'overlay' },
      { label: 'Dispersion only', value: 'shader-only' },
    ];
    el.appendChild(fieldRow('Visual Mode', select(modeOpts, sceneApi.state.params.visualMode || 'overlay', (v)=>{ sceneApi.state.params.visualMode = v; if (typeof sceneApi.setVisualMode === 'function') sceneApi.setVisualMode(v); } )));
    // Actions
    el.appendChild(fieldRow('Screenshot', button('Capture', onScreenshot)));
    el.appendChild(fieldRow('Explosion', button('Trigger', ()=> sceneApi.triggerExplosion())));
    return el;
  }

  function checkbox(value, onchange) {
    const c = h('input', { type: 'checkbox' }); c.checked = !!value; c.addEventListener('change', ()=> onchange(!!c.checked)); return c;
  }

  function buildMapping() {
    const m = sceneApi.state.params.map;
    if (!m.shockwave) m.shockwave = { enabled: true, beatIntensity: 0.55, dropIntensity: 1.2, durationMs: 1200 };
    if (!m.chromatic) m.chromatic = { base: 0.00025, treble: 0.0009, beat: 0.0012, drop: 0.0024, lerp: 0.14 };
    if (!m.eye || typeof m.eye !== 'object') {
      m.eye = {
        enabled: true,
        pupilBase: 0.22,
        pupilRange: 0.45,
        pupilAttack: 0.18,
        pupilRelease: 0.35,
        catAspectMax: 0.65,
        hueMixFromChroma: 0.65,
        saturationFromCentroid: 0.5,
        fiberContrast: 1.2,
        fiberNoiseScale: 3.0,
        limbusDarkness: 0.55,
        blinkOnDrop: true,
        blinkDurationMs: 150,
        randomBlinkMinSec: 12,
        randomBlinkMaxSec: 28,
        corneaEnabled: true,
        corneaFresnel: 1.25,
        corneaTintMix: 0.25,
        corneaOpacity: 0.65,
        glintSize: 0.035,
        glintIntensity: 1.2,
        predatorMode: false,
      };
    }
    if (typeof m.cameraRollFromCentroid !== 'number') m.cameraRollFromCentroid = 0.18;
    if (typeof m.mainSwayFromFlux !== 'number') m.mainSwayFromFlux = 0.12;
    if (typeof m.chromaLightInfluence !== 'number') m.chromaLightInfluence = 0.22;
    if (typeof m.ringBrightFromChroma !== 'number') m.ringBrightFromChroma = 0.3;
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Mapping') ]);
    el.appendChild(fieldRow('Sphere Size from RMS', slider({ min: 0.0, max: 1.5, step: 0.05, value: m.sizeFromRms, oninput: (v)=>{ m.sizeFromRms = v; } })));
    el.appendChild(fieldRow('Ring Scale from Bands', slider({ min: 0.0, max: 1.0, step: 0.05, value: m.ringScaleFromBands, oninput: (v)=>{ m.ringScaleFromBands = v; } })));
    el.appendChild(fieldRow('Ring Speed from Bands', slider({ min: 0.0, max: 3.0, step: 0.1, value: m.ringSpeedFromBands, oninput: (v)=>{ m.ringSpeedFromBands = v; } })));
    el.appendChild(fieldRow('Camera Shake from Beat', slider({ min: 0.0, max: 1.0, step: 0.05, value: m.cameraShakeFromBeat, oninput: (v)=>{ m.cameraShakeFromBeat = v; } })));
    el.appendChild(fieldRow('Bloom Color from Centroid', slider({ min: 0.0, max: 1.0, step: 0.05, value: m.colorBoostFromCentroid, oninput: (v)=>{ m.colorBoostFromCentroid = v; } })));
    el.appendChild(fieldRow('Core Brightness from RMS', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.sphereBrightnessFromRms, oninput: (v)=>{ m.sphereBrightnessFromRms = v; } })));
    el.appendChild(fieldRow('Core Noise from Mid', slider({ min: 0.0, max: 2.5, step: 0.05, value: m.sphereNoiseFromMid, oninput: (v)=>{ m.sphereNoiseFromMid = v; } })));
    el.appendChild(fieldRow('Core Pulse from Bass', slider({ min: 0.0, max: 2.0, step: 0.05, value: m.spherePulseFromBass || 0.6, oninput: (v)=>{ m.spherePulseFromBass = v; } })));
    el.appendChild(fieldRow('Core Sparkle from Treble', slider({ min: 0.0, max: 2.0, step: 0.05, value: m.sphereSparkleFromTreble || 0.5, oninput: (v)=>{ m.sphereSparkleFromTreble = v; } })));
    el.appendChild(fieldRow('Rings Noise from Bands', slider({ min: 0.0, max: 1.5, step: 0.05, value: m.ringNoiseFromBands, oninput: (v)=>{ m.ringNoiseFromBands = v; } })));
    el.appendChild(fieldRow('FOV Pump from Bass', slider({ min: 0.0, max: 2.0, step: 0.05, value: m.fovPumpFromBass || 0.6, oninput: (v)=>{ m.fovPumpFromBass = v; } })));
    el.appendChild(fieldRow('Light Intensity from Bass', slider({ min: 0.0, max: 4.0, step: 0.1, value: m.lightIntensityFromBass, oninput: (v)=>{ m.lightIntensityFromBass = v; } })));
    el.appendChild(fieldRow('Bass Weight', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.bandWeightBass, oninput: (v)=>{ m.bandWeightBass = v; } })));
    el.appendChild(fieldRow('Mid Weight', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.bandWeightMid, oninput: (v)=>{ m.bandWeightMid = v; } })));
    el.appendChild(fieldRow('Treble Weight', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.bandWeightTreble, oninput: (v)=>{ m.bandWeightTreble = v; } })));
    el.appendChild(fieldRow('Stars from Treble', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.starTwinkleFromTreble, oninput: (v)=>{ m.starTwinkleFromTreble = v; } })));
    el.appendChild(fieldRow('Ring Tilt from Bass', slider({ min: 0.0, max: 2.0, step: 0.05, value: m.ringTiltFromBass, oninput: (v)=>{ m.ringTiltFromBass = v; } })));
    el.appendChild(fieldRow('Camera Roll from Centroid Δ', slider({ min: 0.0, max: 0.6, step: 0.01, value: m.cameraRollFromCentroid, oninput: (v)=>{ m.cameraRollFromCentroid = v; } })));
    el.appendChild(fieldRow('Group Sway from Flux', slider({ min: 0.0, max: 0.6, step: 0.01, value: m.mainSwayFromFlux, oninput: (v)=>{ m.mainSwayFromFlux = v; } })));
    el.appendChild(fieldRow('Light Hue from Chroma', slider({ min: 0.0, max: 1.0, step: 0.02, value: m.chromaLightInfluence, oninput: (v)=>{ m.chromaLightInfluence = v; } })));
    el.appendChild(fieldRow('Ring Brightness from Chroma', slider({ min: 0.0, max: 1.5, step: 0.05, value: m.ringBrightFromChroma, oninput: (v)=>{ m.ringBrightFromChroma = v; } })));
    const eye = m.eye;
    el.appendChild(h('div', { class: 'section-title' }, 'Eye'));
    el.appendChild(fieldRow('Enable Eye', checkbox(eye.enabled !== false, (v) => { eye.enabled = v; sceneApi.setEyeEnabled(v); } )));
    el.appendChild(fieldRow('Pupil Base', slider({ min: 0.05, max: 0.6, step: 0.01, value: eye.pupilBase ?? 0.22, oninput: (v) => { eye.pupilBase = v; } })));
    el.appendChild(fieldRow('Pupil Range', slider({ min: 0.0, max: 0.7, step: 0.01, value: eye.pupilRange ?? 0.45, oninput: (v) => { eye.pupilRange = v; } })));
    el.appendChild(fieldRow('Pupil Attack (s)', slider({ min: 0.02, max: 1.0, step: 0.01, value: eye.pupilAttack ?? 0.18, oninput: (v) => { eye.pupilAttack = v; } })));
    el.appendChild(fieldRow('Pupil Release (s)', slider({ min: 0.05, max: 1.5, step: 0.01, value: eye.pupilRelease ?? 0.35, oninput: (v) => { eye.pupilRelease = v; } })));
    el.appendChild(fieldRow('Cat Aspect Max', slider({ min: 0.0, max: 1.0, step: 0.01, value: eye.catAspectMax ?? 0.65, oninput: (v) => { eye.catAspectMax = v; } })));
    el.appendChild(fieldRow('Hue Mix from Chroma', slider({ min: 0.0, max: 1.0, step: 0.02, value: eye.hueMixFromChroma ?? 0.65, oninput: (v) => { eye.hueMixFromChroma = v; } })));
    el.appendChild(fieldRow('Saturation from Centroid', slider({ min: 0.0, max: 1.0, step: 0.02, value: eye.saturationFromCentroid ?? 0.5, oninput: (v) => { eye.saturationFromCentroid = v; } })));
    el.appendChild(fieldRow('Fiber Contrast', slider({ min: 0.2, max: 2.5, step: 0.05, value: eye.fiberContrast ?? 1.2, oninput: (v) => { eye.fiberContrast = v; } })));
    el.appendChild(fieldRow('Fiber Noise Scale', slider({ min: 0.4, max: 5.0, step: 0.1, value: eye.fiberNoiseScale ?? 3.0, oninput: (v) => { eye.fiberNoiseScale = v; } })));
    el.appendChild(fieldRow('Limbal Darkness', slider({ min: 0.0, max: 1.5, step: 0.05, value: eye.limbusDarkness ?? 0.55, oninput: (v) => { eye.limbusDarkness = v; } })));
    el.appendChild(fieldRow('Blink on Drop', checkbox(eye.blinkOnDrop !== false, (v) => { eye.blinkOnDrop = v; } )));
    el.appendChild(fieldRow('Blink Duration (ms)', slider({ min: 60, max: 400, step: 5, value: eye.blinkDurationMs ?? 150, oninput: (v) => { eye.blinkDurationMs = v; } })));
    el.appendChild(fieldRow('Random Blink Min (s)', slider({ min: 3, max: 30, step: 1, value: eye.randomBlinkMinSec ?? 12, oninput: (v) => { eye.randomBlinkMinSec = v; } })));
    el.appendChild(fieldRow('Random Blink Max (s)', slider({ min: 5, max: 45, step: 1, value: eye.randomBlinkMaxSec ?? 28, oninput: (v) => { eye.randomBlinkMaxSec = v; } })));
    el.appendChild(fieldRow('Cornea Layer', checkbox(eye.corneaEnabled !== false, (v) => { eye.corneaEnabled = v; sceneApi.setEyeCorneaEnabled(v); } )));
    el.appendChild(fieldRow('Cornea Fresnel', slider({ min: 0.2, max: 3.0, step: 0.05, value: eye.corneaFresnel ?? 1.25, oninput: (v) => { eye.corneaFresnel = v; } })));
    el.appendChild(fieldRow('Cornea Tint Mix', slider({ min: 0.0, max: 1.0, step: 0.02, value: eye.corneaTintMix ?? 0.25, oninput: (v) => { eye.corneaTintMix = v; } })));
    el.appendChild(fieldRow('Cornea Opacity', slider({ min: 0.1, max: 1.0, step: 0.02, value: eye.corneaOpacity ?? 0.65, oninput: (v) => { eye.corneaOpacity = v; } })));
    el.appendChild(fieldRow('Glint Size', slider({ min: 0.01, max: 0.1, step: 0.002, value: eye.glintSize ?? 0.035, oninput: (v) => { eye.glintSize = v; } })));
    el.appendChild(fieldRow('Glint Intensity', slider({ min: 0.0, max: 2.0, step: 0.05, value: eye.glintIntensity ?? 1.2, oninput: (v) => { eye.glintIntensity = v; } })));
    el.appendChild(fieldRow('Predator Mode', checkbox(!!sceneApi.state.eye?.predatorMode, (v) => sceneApi.setEyePredatorMode(v) )));
    el.appendChild(fieldRow('Manual Blink', button('Blink', () => sceneApi.triggerEyeBlink())));

    el.appendChild(h('div', { class: 'section-title' }, 'Shockwave Pulse'));
    el.appendChild(fieldRow('Enable', checkbox(m.shockwave.enabled !== false, (v)=>{ m.shockwave.enabled = v; } )));
    el.appendChild(fieldRow('Beat Strength', slider({ min: 0.0, max: 1.5, step: 0.05, value: m.shockwave.beatIntensity ?? 0.55, oninput: (v)=>{ m.shockwave.beatIntensity = v; } })));
    el.appendChild(fieldRow('Drop Strength', slider({ min: 0.2, max: 3.0, step: 0.05, value: m.shockwave.dropIntensity ?? 1.2, oninput: (v)=>{ m.shockwave.dropIntensity = v; } })));
    el.appendChild(fieldRow('Duration (ms)', slider({ min: 200, max: 2000, step: 20, value: m.shockwave.durationMs ?? 1200, oninput: (v)=>{ m.shockwave.durationMs = v; } })));
    el.appendChild(fieldRow('Preview Pulse', button('Trigger', ()=> sceneApi.triggerShockwave(Math.max(0.6, m.shockwave.dropIntensity ?? 1.0), m.shockwave.durationMs))));
    el.appendChild(h('div', { class: 'section-title' }, 'Chromatic Aberration'));
    el.appendChild(fieldRow('Base Offset', slider({ min: 0.0, max: 0.0025, step: 0.00005, value: m.chromatic.base ?? 0.00025, oninput: (v)=>{ m.chromatic.base = v; } })));
    el.appendChild(fieldRow('Treble Gain', slider({ min: 0.0, max: 0.0035, step: 0.00005, value: m.chromatic.treble ?? 0.0009, oninput: (v)=>{ m.chromatic.treble = v; } })));
    el.appendChild(fieldRow('Beat Boost', slider({ min: 0.0, max: 0.004, step: 0.0001, value: m.chromatic.beat ?? 0.0012, oninput: (v)=>{ m.chromatic.beat = v; } })));
    el.appendChild(fieldRow('Drop Boost', slider({ min: 0.0, max: 0.005, step: 0.0001, value: m.chromatic.drop ?? 0.0024, oninput: (v)=>{ m.chromatic.drop = v; } })));
    el.appendChild(fieldRow('Lerp Smoothness', slider({ min: 0.02, max: 0.4, step: 0.01, value: m.chromatic.lerp ?? 0.14, oninput: (v)=>{ m.chromatic.lerp = v; } })));
    // Advanced Mapping
    el.appendChild(h('div', { class: 'section-title' }, 'Advanced Mapping'));
    el.appendChild(fieldRow('Enable Advanced', checkbox(!!m.advancedMapping, (v)=>{ m.advancedMapping = v; } )));
    const triplet = (label, obj) => h('div', { class: 'row' }, [ h('div', { class: 'label' }, label), h('div', { class: 'control' }, [
      slider({ min: 0.0, max: 2.0, step: 0.05, value: obj.bass, oninput: (v)=>{ obj.bass = v; } }),
      slider({ min: 0.0, max: 2.0, step: 0.05, value: obj.mid, oninput: (v)=>{ obj.mid = v; } }),
      slider({ min: 0.0, max: 2.0, step: 0.05, value: obj.treble, oninput: (v)=>{ obj.treble = v; } }),
    ]) ]);
    if (m.advancedMapping) {
      el.appendChild(triplet('Size Weights (Bass/Mid/Treble)', m.sizeWeights));
      el.appendChild(triplet('Ring Scale Weights (B/M/T)', m.ringScaleWeights));
      el.appendChild(triplet('Ring Speed Weights (B/M/T)', m.ringSpeedWeights));
      el.appendChild(triplet('Core Noise Weights (B/M/T)', m.sphereNoiseWeights));
      el.appendChild(triplet('Ring Noise Weights (B/M/T)', m.ringNoiseWeights));
    }
    return el;
  }

  function buildTempo() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Tempo Assist') ]);
    el.appendChild(fieldRow('Enable', checkbox(audioEngine.tempoAssistEnabled, (v)=> audioEngine.setTempoAssistEnabled(v) )));
    el.appendChild(fieldRow('Auto BPM', h('div', { id: 'auto-bpm' }, String(audioEngine.getBpm() || 0))));
    const initialAutoConf = typeof audioEngine.getBpmConfidence === 'function' ? audioEngine.getBpmConfidence() : 0;
    const confDisplay = Number.isFinite(initialAutoConf) ? initialAutoConf.toFixed(2) : '0.00';
    el.appendChild(fieldRow('Auto Confidence', h('div', { id: 'auto-bpm-conf' }, confDisplay)));
    el.appendChild(fieldRow('Auto Source', h('div', { id: 'auto-bpm-source' }, audioEngine.getBpmSource ? (audioEngine.getBpmSource() || 'none') : 'none')));
    // Live (Aubio) diagnostics for Chrome Tab / BlackHole inputs
    el.appendChild(fieldRow('Live BPM', h('div', { id: 'live-bpm' }, '0')));
    el.appendChild(fieldRow('Confidence', h('div', { id: 'live-conf' }, '0')));
    el.appendChild(button('Recalculate BPM', async ()=>{
      await audioEngine.recalcBpm();
      const auto = document.getElementById('auto-bpm');
      if (auto) auto.textContent = String(audioEngine.getBpm() || 0);
      const confNode = document.getElementById('auto-bpm-conf');
      if (confNode) {
        const confVal = typeof audioEngine.getBpmConfidence === 'function' ? audioEngine.getBpmConfidence() : 0;
        confNode.textContent = Number.isFinite(confVal) ? confVal.toFixed(2) : '0.00';
      }
      const srcNode = document.getElementById('auto-bpm-source');
      if (srcNode) srcNode.textContent = audioEngine.getBpmSource ? (audioEngine.getBpmSource() || 'none') : 'none';
    }));

    const tap = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Tap Tempo') ]);
    tap.appendChild(fieldRow('Tap BPM', h('div', { id: 'tap-bpm' }, '0')));
    tap.appendChild(h('div', {}, [ button('Tap', ()=>{ audioEngine.tapBeat(); document.getElementById('tap-bpm').textContent = String(audioEngine.getTapBpm()||0); }), button('Reset', ()=>{ audioEngine.resetTapTempo(); document.getElementById('tap-bpm').textContent = '0'; }) ]));
    tap.appendChild(h('div', {}, [ button('×0.5', ()=>{ audioEngine.nudgeTapMultiplier(0.5); document.getElementById('tap-bpm').textContent = String(audioEngine.getTapBpm()||0); }), button('×2', ()=>{ audioEngine.nudgeTapMultiplier(2.0); document.getElementById('tap-bpm').textContent = String(audioEngine.getTapBpm()||0); }) ]));
    tap.appendChild(fieldRow('Quantize to Tap', checkbox(audioEngine.tapQuantizeEnabled, (v)=> audioEngine.setTapQuantizeEnabled(v) )));
    tap.appendChild(h('div', {}, [ button('+10 ms', ()=> audioEngine.nudgeQuantizePhase(10)), button('-10 ms', ()=> audioEngine.nudgeQuantizePhase(-10)), button('+25 ms', ()=> audioEngine.nudgeQuantizePhase(25)), button('-25 ms', ()=> audioEngine.nudgeQuantizePhase(-25)), button('Align Now', ()=> audioEngine.alignQuantizePhase()) ]));
    el.appendChild(tap);

    // Auto-apply shader preset by BPM bucket
    let autoApply = false;
    try { autoApply = !!JSON.parse(localStorage.getItem('cosmic_auto_shader_preset') || 'false'); } catch(_) { autoApply = false; }
    const autoApplyToggle = checkbox(autoApply, (checked) => {
      try { localStorage.setItem('cosmic_auto_shader_preset', JSON.stringify(!!checked)); } catch(_) {}
    });
    el.appendChild(fieldRow('Auto-apply Shader Preset by BPM', autoApplyToggle));
    return el;
  }

  function buildShader() {
    ensureDispersionParams();
    const mode = sceneApi.state.params.visualMode || 'overlay';
    const root = h('div', { class: 'section shader-settings' }, [
      h('div', { class: 'section-title' }, 'Shader (Dispersion)'),
    ]);
    if (mode === 'classic') {
      root.appendChild(h('div', {}, 'Shader visuals are disabled in Classic mode. Switch Visual Mode to "3D + Dispersion" or "Dispersion only".'));
      return root;
    }
    if (mode === 'overlay') {
      root.appendChild(fieldRow('Enable Overlay', checkbox(!!sceneApi.state.params.enableDispersion, (v) => { sceneApi.state.params.enableDispersion = v; updatePinnedHudOverlay(); })));
    }

    let renderSnapshots = () => {};
    let renderPinned = () => {};
    let renderSections = () => {};
    let renderShaderPresets = () => {};

    const toolbar = h('div', { class: 'shader-toolbar' });
    // Inline help pill
    const helpPill = h('div', { class: 'shader-toolbar-item help' }, 'Tip: Hover any label for what it does. Double-click to reset.');
    toolbar.appendChild(helpPill);
    const searchInput = h('input', { type: 'search', placeholder: 'Search controls…', value: shaderState.searchQuery || '' });
    searchInput.addEventListener('input', () => {
      shaderState.searchQuery = searchInput.value || '';
      renderSections();
    });
    toolbar.appendChild(h('div', { class: 'shader-toolbar-item search' }, searchInput));
    toolbar.appendChild(button('Clear', () => {
      searchInput.value = '';
      shaderState.searchQuery = '';
      renderSections();
    }, { class: 'ghost' }));
    const hudToggleLabel = h('label', { class: 'shader-toolbar-item toggle' });
    const hudToggle = checkbox(shaderState.pinnedHud, (checked) => {
      shaderState.pinnedHud = checked;
      persistPinnedHud();
      updatePinnedHudOverlay();
    });
    hudToggleLabel.appendChild(hudToggle);
    hudToggleLabel.appendChild(document.createTextNode('Pinned HUD'));
    toolbar.appendChild(hudToggleLabel);
    const hotkeyToggleLabel = h('label', { class: 'shader-toolbar-item toggle' });
    const hotkeyToggle = checkbox(!!shaderState.hotkeysEnabled, (checked) => {
      shaderState.hotkeysEnabled = checked;
      persistHotkeys();
      showToast(checked ? 'Shader hotkeys enabled' : 'Shader hotkeys disabled');
    });
    hotkeyToggleLabel.appendChild(hotkeyToggle);
    hotkeyToggleLabel.appendChild(document.createTextNode('Live Hotkeys'));
    toolbar.appendChild(hotkeyToggleLabel);
    root.appendChild(toolbar);

    // Quick Macros (merged from Shader Quick)
    const macrosWrap = h('div', { class: 'shader-quick-macros' });
    DISPERSION_MACROS.forEach((macro) => {
      const row = h('div', { class: 'row shader-macro-row' });
      const label = h('div', { class: 'label' }, macro.label);
      const control = h('div', { class: 'control shader-macro-control' });
      const sliderEl = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(shaderState.macroValues[macro.id] ?? macro.defaultValue) });
      const valueBadge = h('span', { class: 'shader-value-display' }, `${Math.round((shaderState.macroValues[macro.id] ?? macro.defaultValue) * 100)}%`);
      sliderEl.addEventListener('input', () => {
        const val = clamp01(parseFloat(sliderEl.value));
        valueBadge.textContent = `${Math.round(val * 100)}%`;
        updateMacro(macro.id, val, { showHud: false });
      });
      sliderEl.addEventListener('change', () => {
        const val = clamp01(parseFloat(sliderEl.value));
        valueBadge.textContent = `${Math.round(val * 100)}%`;
        updateMacro(macro.id, val);
      });
      const resetBtn = button('Reset', () => {
        sliderEl.value = String(macro.defaultValue);
        valueBadge.textContent = `${Math.round(macro.defaultValue * 100)}%`;
        updateMacro(macro.id, macro.defaultValue, { showHud: false });
        showToast(`${macro.label} reset`);
      }, { class: 'ghost' });
      control.appendChild(sliderEl);
      control.appendChild(valueBadge);
      control.appendChild(resetBtn);
      row.appendChild(label);
      row.appendChild(control);
      macrosWrap.appendChild(row);
    });
    root.appendChild(macrosWrap);

    // Quick Styles (promoted to top of Shader)
    root.appendChild(h('div', { class: 'shader-subheader' }, 'One-Tap Styles'));
    const quickStylesRow = h('div', { class: 'shader-styles-row' });
    DISPERSION_STYLES.forEach((style) => {
      const btn = button(style.label, () => {
        const params = ensureDispersionParams();
        applyStyle(params, style.id);
        updatePinnedHudOverlay();
        notifyRenderAll();
        showShaderHud(style.label, 'Applied');
      }, { class: 'ghost' });
      btn.title = style.description || '';
      quickStylesRow.appendChild(btn);
    });
    root.appendChild(quickStylesRow);

    const snapshotsContainer = h('div', { class: 'shader-snapshots' });
    const pinnedContainer = h('div', { class: 'shader-pinned-container' });
    const sectionsContainer = h('div', { class: 'shader-sections-container' });
    const presetsContainer = h('div', { class: 'shader-presets-container' });

    root.appendChild(snapshotsContainer);
    root.appendChild(pinnedContainer);
    root.appendChild(sectionsContainer);
    root.appendChild(presetsContainer);

    const controlInstances = new Map();
    const registerInstance = (key, instance) => {
      if (!controlInstances.has(key)) controlInstances.set(key, []);
      controlInstances.get(key).push(instance);
    };
    const refreshValue = (key, value) => {
      const entries = controlInstances.get(key);
      if (!entries) return;
      entries.forEach((inst) => {
        if (inst.slider) inst.slider.value = String(value);
        if (inst.display) inst.display.textContent = formatValue(inst.schema, value);
        if (inst.checkbox) inst.checkbox.checked = !!value;
        if (inst.select) inst.select.value = String(value);
      });
    };

    const matchesQuery = (schema) => {
      const query = (shaderState.searchQuery || '').trim().toLowerCase();
      if (!query) return true;
      const haystack = `${schema.label} ${schema.key} ${(schema.keywords || []).join(' ')}`.toLowerCase();
      return haystack.includes(query);
    };

    renderSnapshots = () => {
      snapshotsContainer.replaceChildren();
      let collapsed = false;
      try { collapsed = !!JSON.parse(localStorage.getItem(SNAPSHOTS_COLLAPSED_KEY) || 'true'); } catch(_) { collapsed = true; }
      const header = h('div', { class: 'shader-subheader' });
      const chevron = collapsed ? '▸' : '▾';
      header.textContent = `${chevron} Snapshots (Shift=save, Alt=clear)`;
      header.style.cursor = 'pointer';
      header.addEventListener('click', () => {
        const next = !collapsed; collapsed = next;
        try { localStorage.setItem(SNAPSHOTS_COLLAPSED_KEY, JSON.stringify(!!next)); } catch(_) {}
        renderSnapshots();
      });
      snapshotsContainer.appendChild(header);
      const row = h('div', { class: 'shader-snapshot-row' });
      for (let slot = 1; slot <= 4; slot += 1) {
        const slotId = String(slot);
        const hasData = !!shaderState.snapshots[slotId];
        const classes = ['ghost', 'snapshot-button'];
        if (shaderState.activeSnapshotSlot === slotId) classes.push('active');
        if (!hasData) classes.push('empty');
        const btn = button(`Slot ${slotId}`, (event) => {
          event.preventDefault();
          shaderState.activeSnapshotSlot = slotId;
          if (event.altKey) {
            clearSnapshot(slotId);
          } else if (event.shiftKey || event.metaKey || event.ctrlKey) {
            captureSnapshot(slotId);
          } else if (!loadSnapshot(slotId)) {
            showToast('Snapshot empty');
          }
          renderSnapshots();
        }, { class: classes.join(' ') });
        btn.title = hasData ? 'Click=load, Shift+Click=save, Alt+Click=clear' : 'Empty slot. Shift+Click to save.';
        row.appendChild(btn);
      }
      const abBtn = button('A ↔ B', () => {
        const next = shaderState.activeSnapshotSlot === '1' ? '2' : '1';
        shaderState.activeSnapshotSlot = next;
        if (!loadSnapshot(next, { silent: true })) showToast(`Snapshot ${next} empty`);
        renderSnapshots();
      }, { class: 'ghost snapshot-toggle' });
      row.appendChild(abBtn);
      if (!collapsed) snapshotsContainer.appendChild(row);
      const activeLabel = h('div', { class: 'shader-snapshot-active' }, `Active Slot: ${shaderState.activeSnapshotSlot || '1'}`);
      if (!collapsed) snapshotsContainer.appendChild(activeLabel);
    };

    const createControlRow = (schema, { compact = false } = {}) => {
      const params = ensureDispersionParams();
      const value = params[schema.key];
      const row = h('div', { class: 'row shader-control-row' + (compact ? ' compact' : '') });
      const labelWrap = h('div', { class: 'label shader-label' });
      const labelText = h('span', { class: 'shader-label-text' }, schema.label);
      labelWrap.appendChild(labelText);
      // Build a helpful tooltip combining section description, range and defaults
      const sectionHelp = SECTION_HELP[schema.section] || '';
      const range = schema.type === 'range' ? `Range: ${schema.min}–${schema.max}` : '';
      const def = (schema.default !== undefined) ? `Default: ${schema.default}` : '';
      const kw = (schema.keywords && schema.keywords.length) ? `Keywords: ${schema.keywords.join(', ')}` : '';
      const baseTip = [sectionHelp, schema.help || '', range, def, kw].filter(Boolean).join('\n');
      const controlsTip = 'Use the value field to set exact numbers. Use reset to default.';
      labelWrap.title = baseTip ? `${baseTip}\n\n${controlsTip}` : controlsTip;
      // Removed hidden dbl/right-click behaviors in favor of explicit controls
      const pinBtn = button(shaderState.pinnedKeys.includes(schema.key) ? 'Unpin' : 'Pin', (event) => {
        event.stopPropagation();
        togglePinned(schema.key);
      }, { class: 'ghost pin-btn' });
      labelWrap.appendChild(pinBtn);
      if (schema.nudgeHotkeys) {
        const hint = h('span', { class: 'shader-hotkey-hint' }, `[${schema.nudgeHotkeys.dec}/${schema.nudgeHotkeys.inc}]`);
        labelWrap.appendChild(hint);
      }
      row.appendChild(labelWrap);
      if (schema.type === 'range') {
        const controlWrap = h('div', { class: 'control shader-control-range' });
        const sliderEl = h('input', { type: 'range', min: String(schema.min), max: String(schema.max), step: String(schema.step || 0.01), value: String(value) });
        const numberEl = h('input', { type: 'number', class: 'shader-number-input', min: String(schema.min), max: String(schema.max), step: String(schema.step || 0.01), value: String(value) });
        const valueDisplay = h('span', { class: 'shader-value-display' }, formatValue(schema, value));
        const resetBtn = button('↺', () => {
          shaderState.activeSection = schema.section; persistActiveSection();
          const defVal = clampValueForKey(schema.key, schema.default);
          sliderEl.value = String(defVal);
          numberEl.value = String(defVal);
          valueDisplay.textContent = formatValue(schema, defVal);
          setParamValue(schema.key, defVal);
        }, { class: 'ghost reset-btn', title: 'Reset to default' });
        sliderEl.addEventListener('input', () => {
          shaderState.activeSection = schema.section;
          const next = parseFloat(sliderEl.value);
          valueDisplay.textContent = formatValue(schema, next);
          numberEl.value = String(next);
          setParamValue(schema.key, next, { showHud: false, refresh: false });
        });
        sliderEl.addEventListener('change', () => {
          shaderState.activeSection = schema.section;
          const next = parseFloat(sliderEl.value);
          numberEl.value = String(next);
          setParamValue(schema.key, next, { showHud: true, refresh: false });
        });
        sliderEl.addEventListener('focus', () => {
          shaderState.activeSection = schema.section;
        });
        sliderEl.addEventListener('keydown', (event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          shaderState.activeSection = schema.section;
          const baseStep = schema.step || ((schema.max - schema.min) / 100);
          const fineStep = schema.fineStep || baseStep * 0.25;
          const coarseStep = baseStep * 5;
          const delta = (event.shiftKey ? coarseStep : event.altKey ? fineStep : baseStep)
            * (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -1 : 1);
          const current = parseFloat(sliderEl.value);
          const next = clampValueForKey(schema.key, current + delta);
          sliderEl.value = String(next);
          valueDisplay.textContent = formatValue(schema, next);
          numberEl.value = String(next);
          setParamValue(schema.key, next, { showHud: false, refresh: false });
        });
        numberEl.addEventListener('input', () => {
          shaderState.activeSection = schema.section;
          const rawStr = String(numberEl.value || '');
          const normalized = rawStr.replace(',', '.');
          const raw = parseFloat(normalized);
          if (!Number.isFinite(raw)) return;
          const next = clampValueForKey(schema.key, raw);
          sliderEl.value = String(next);
          valueDisplay.textContent = formatValue(schema, next);
          setParamValue(schema.key, next, { showHud: false, refresh: false });
        });
        numberEl.addEventListener('change', () => {
          shaderState.activeSection = schema.section;
          const rawStr = String(numberEl.value || '');
          const normalized = rawStr.replace(',', '.');
          const raw = parseFloat(normalized);
          if (!Number.isFinite(raw)) return;
          const next = clampValueForKey(schema.key, raw);
          sliderEl.value = String(next);
          valueDisplay.textContent = formatValue(schema, next);
          setParamValue(schema.key, next, { showHud: true, refresh: false });
        });
        controlWrap.appendChild(sliderEl);
        controlWrap.appendChild(numberEl);
        controlWrap.appendChild(valueDisplay);
        controlWrap.appendChild(resetBtn);
        row.appendChild(controlWrap);
        registerInstance(schema.key, { slider: sliderEl, number: numberEl, display: valueDisplay, schema });
      } else if (schema.type === 'boolean') {
        const controlWrap = h('div', { class: 'control shader-control-boolean' });
        const toggleEl = checkbox(!!value, (checked) => {
          shaderState.activeSection = schema.section;
          setParamValue(schema.key, checked, { refresh: false });
        });
        controlWrap.appendChild(toggleEl);
        row.appendChild(controlWrap);
        registerInstance(schema.key, { checkbox: toggleEl, schema });
      } else if (schema.type === 'select') {
        const controlWrap = h('div', { class: 'control shader-control-select' });
        const selectEl = select(schema.options, value, (val) => {
          shaderState.activeSection = schema.section;
          setParamValue(schema.key, val, { refresh: false });
        });
        controlWrap.appendChild(selectEl);
        row.appendChild(controlWrap);
        registerInstance(schema.key, { select: selectEl, schema });
      }
      row.addEventListener('pointerdown', (ev) => {
        if (ev.target && (ev.target.closest && ev.target.closest('.control'))) return;
        shaderState.activeSection = schema.section; persistActiveSection();
      });
      return row;
    };

    renderPinned = () => {
      pinnedContainer.replaceChildren();
      if (!shaderState.pinnedKeys.length) {
        pinnedContainer.appendChild(h('div', { class: 'shader-empty' }, 'Pin any control to surface it here.'));
        return;
      }
      shaderState.pinnedKeys.forEach((key) => {
        const schema = getParamSchema(key);
        if (!schema) return;
        pinnedContainer.appendChild(createControlRow(schema, { compact: true }));
      });
    };

    renderSections = () => {
      const params = ensureDispersionParams();
      const prevScrollTop = sectionsContainer.scrollTop || 0;
      sectionsContainer.replaceChildren();
      const query = (shaderState.searchQuery || '').trim().toLowerCase();
      let anyMatches = false;
      const hasSection = DISPERSION_SECTIONS.some((sec) => sec.id === shaderState.activeSection);
      if (!hasSection) shaderState.activeSection = DISPERSION_SECTIONS[0]?.id || null;
      DISPERSION_SECTIONS.forEach((section) => {
        const controls = DISPERSION_PARAM_SCHEMA.filter((s) => s.section === section.id);
        const visible = controls.filter(matchesQuery);
        if (query && !visible.length) return;
        anyMatches = true;
        const isActive = shaderState.activeSection === section.id;
        const block = h('div', { class: 'shader-section-block' + (isActive ? ' active' : '') });
        const header = h('div', { class: 'shader-section-header' });
        header.appendChild(h('div', { class: 'title' }, section.label));
        const actions = h('div', { class: 'actions' });
        const overflowBtn = button('⋯', (ev) => {
          ev.stopPropagation();
          const isOpen = menu.style.display === 'block';
          menu.style.display = isOpen ? 'none' : 'block';
          if (!isOpen) {
            const handleOutside = (e) => {
              const t = e.target;
              const inMenu = (menu.contains && menu.contains(t));
              const onBtn = (overflowBtn === t) || (overflowBtn.contains && overflowBtn.contains(t));
              if (!inMenu && !onBtn) {
                menu.style.display = 'none';
                document.removeEventListener('click', handleOutside, true);
              }
            };
            document.addEventListener('click', handleOutside, true);
          }
        }, { class: 'ghost overflow-btn', 'aria-label': 'Section actions' });
        const menu = h('div', { class: 'section-overflow-menu' });
        menu.style.display = 'none';
        menu.appendChild(button('Reset', () => {
          shaderState.activeSection = section.id; persistActiveSection();
          resetSectionToDefaults(section.id);
          renderSections();
        }, { class: 'ghost' }));
        menu.appendChild(button('Save', () => {
          shaderState.activeSection = section.id; persistActiveSection();
          const name = prompt(`Save preset name for ${section.label}`);
          if (!name) return;
          if (!sectionPresetStore[section.id]) sectionPresetStore[section.id] = {};
          sectionPresetStore[section.id][name] = pickSection(ensureDispersionParams(), section.id);
          persistSectionPresets();
          showToast('Section preset saved');
        }, { class: 'ghost' }));
        menu.appendChild(button('Load', () => {
          shaderState.activeSection = section.id; persistActiveSection();
          const presets = sectionPresetStore[section.id] || {};
          const names = Object.keys(presets);
          if (!names.length) { showToast('No section presets'); return; }
          const choice = prompt(`Load preset for ${section.label}:\n${names.join('\n')}`);
          if (!choice || !presets[choice]) return;
          applySectionPreset(section.id, presets[choice]);
        }, { class: 'ghost' }));
        menu.appendChild(button('Random', (event) => {
          shaderState.activeSection = section.id; persistActiveSection();
          randomizeSection(ensureDispersionParams(), section.id, { subtle: event.shiftKey });
          updatePinnedHudOverlay();
          notifyRenderAll();
        }, { class: 'ghost', title: 'Click=randomize, Shift+Click=subtle nudge' }));
        actions.appendChild(overflowBtn);
        actions.appendChild(menu);
        header.appendChild(actions);
        header.addEventListener('click', (ev) => {
          if (ev.target && (ev.target.closest && ev.target.closest('.actions'))) return;
          shaderState.activeSection = section.id; persistActiveSection();
          renderSections();
        });
        block.appendChild(header);
        const body = h('div', { class: 'shader-section-body' });
        visible.forEach((schema) => {
          body.appendChild(createControlRow(schema));
        });
        const shouldOpen = query ? true : isActive;
        if (!shouldOpen) body.style.display = 'none';
        block.appendChild(body);
        sectionsContainer.appendChild(block);
      });
      if (!anyMatches) {
        sectionsContainer.appendChild(h('div', { class: 'shader-empty' }, 'No controls match that search.'));
      }
      // Restore scroll position to avoid jumping to top on refresh
      try { sectionsContainer.scrollTop = prevScrollTop; } catch(_) {}
    };

    renderShaderPresets = () => {
      presetsContainer.replaceChildren();
      presetsContainer.appendChild(h('div', { class: 'shader-subheader' }, 'Styles & Shader Presets'));
      const stylesRow = h('div', { class: 'shader-styles-row' });
      DISPERSION_STYLES.forEach((style) => {
        const btn = button(style.label, () => {
          const params = ensureDispersionParams();
          applyStyle(params, style.id);
          updatePinnedHudOverlay();
          notifyRenderAll();
          showShaderHud(style.label, 'Applied');
        }, { class: 'ghost' });
        btn.title = style.description || '';
        stylesRow.appendChild(btn);
      });
      presetsContainer.appendChild(stylesRow);
      const actions = h('div', { class: 'shader-preset-actions' });
      actions.appendChild(button('Save Shader Preset', () => {
        const name = prompt('Preset name');
        if (!name) return;
        shaderPresetStore[name] = serializeDispersion(ensureDispersionParams());
        persistShaderPresets();
        showToast('Shader preset saved');
        renderShaderPresets();
      }, { class: 'ghost' }));
      actions.appendChild(button('Load Shader Preset', () => {
        const names = Object.keys(shaderPresetStore);
        if (!names.length) { showToast('No shader presets'); return; }
        const choice = prompt(`Load shader preset:\n${names.join('\n')}`);
        if (!choice || !shaderPresetStore[choice]) return;
        Object.assign(ensureDispersionParams(), withDispersionDefaults(shaderPresetStore[choice]));
        updatePinnedHudOverlay();
        notifyRenderAll();
        showShaderHud(choice, 'Loaded');
      }, { class: 'ghost' }));
      actions.appendChild(button('Delete Shader Preset', () => {
        const names = Object.keys(shaderPresetStore);
        if (!names.length) { showToast('No shader presets'); return; }
        const choice = prompt(`Delete shader preset:\n${names.join('\n')}`);
        if (!choice || !shaderPresetStore[choice]) return;
        delete shaderPresetStore[choice];
        persistShaderPresets();
        showToast('Preset deleted');
        renderShaderPresets();
      }, { class: 'ghost' }));
      presetsContainer.appendChild(actions);

      // Built-in BPM shader presets (lazy import)
      try {
        import('./shader-presets.js').then((mod) => {
          const PRESETS = mod?.SHADER_PRESETS || {};
          const names = Object.keys(PRESETS);
          if (!names.length) return;
          presetsContainer.appendChild(h('div', { class: 'shader-subheader' }, 'BPM Shader Presets'));
          const list = h('div', { class: 'shader-preset-list' });
          names.sort().forEach((name) => {
            const row = h('div', { class: 'row' }, [
              h('div', { class: 'label' }, name),
              h('div', { class: 'control' }, [
                button('Apply', () => {
                  const params = ensureDispersionParams();
                  const values = PRESETS[name] || {};
                  Object.assign(params, withDispersionDefaults({ ...params, ...values }));
                  updatePinnedHudOverlay();
                  notifyRenderAll();
                  showShaderHud(name, 'Applied');
                }, { class: 'ghost' }),
              ]),
            ]);
            list.appendChild(row);
          });
          presetsContainer.appendChild(list);
        }).catch(()=>{});
      } catch(_) {}
      if (Object.keys(shaderPresetStore).length) {
        const list = h('div', { class: 'shader-preset-list' });
        Object.keys(shaderPresetStore).sort().forEach((name) => {
          const row = h('div', { class: 'row' }, [
            h('div', { class: 'label' }, name),
            h('div', { class: 'control' }, [
              button('Apply', () => {
                Object.assign(ensureDispersionParams(), withDispersionDefaults(shaderPresetStore[name]));
                updatePinnedHudOverlay();
                notifyRenderAll();
                showShaderHud(name, 'Loaded');
              }, { class: 'ghost' }),
              button('Overwrite', () => {
                shaderPresetStore[name] = serializeDispersion(ensureDispersionParams());
                persistShaderPresets();
                showToast('Preset updated');
              }, { class: 'ghost' }),
              button('Delete', () => {
                delete shaderPresetStore[name];
                persistShaderPresets();
                renderShaderPresets();
              }, { class: 'ghost' }),
            ]),
          ]);
          list.appendChild(row);
        });
        presetsContainer.appendChild(list);
      }
    };

    const refreshAll = () => {
      controlInstances.clear();
      renderSnapshots();
      renderPinned();
      renderSections();
      renderShaderPresets();
      updatePinnedHudOverlay();
    };

    shaderRenderContext = {
      refreshAll,
      refreshValue: (key, value) => {
        const params = ensureDispersionParams();
        const next = value !== undefined ? value : params[key];
        refreshValue(key, next);
      },
    };

    refreshAll();
    return root;
  }

  function buildPresets() {
    const el = h('div', { class: 'section preset-quick' }, [
      h('div', { class: 'section-title' }, 'Preset Control'),
    ]);

    if (!presetManager) {
      el.appendChild(h('div', { class: 'preset-empty' }, 'Preset manager unavailable.')); 
      return el;
    }

    const current = (() => {
      const activeId = presetManager.activePresetId;
      if (!activeId) return null;
      const list = presetManager.list();
      return list.find((item) => item.id === activeId) || null;
    })();

    const header = h('div', { class: 'preset-current' });
    header.appendChild(h('div', { class: 'title' }, current ? current.name : 'No preset loaded'));
    if (current?.tags?.length) {
      header.appendChild(h('div', { class: 'tags' }, current.tags.map((tag) => `#${tag}`).join(' ')));
    }
    el.appendChild(header);

    const actions = h('div', { class: 'preset-actions' });
    const openBtn = button('Open Library (L)', () => {
      if (typeof openPresetLibrary === 'function') openPresetLibrary();
    }, { class: 'ghost' });
    actions.appendChild(openBtn);

    const quickSave = button('Save', () => {
      if (!presetManager.activePresetId) {
        showToast('No active preset to overwrite');
        return;
      }
      const proceed = confirm('Overwrite current preset with live settings?');
      if (!proceed) return;
      try {
        presetManager.save(presetManager.activePresetId);
        showToast('Preset saved');
      } catch (err) {
        console.error(err);
        showToast('Save failed');
      }
    });
    actions.appendChild(quickSave);

    const saveAsBtn = button('Save As…', () => {
      const name = prompt('New preset name');
      if (!name) return;
      try {
        presetManager.saveAs(name.trim());
        showToast(`Saved ${name}`);
      } catch (err) {
        console.error(err);
        showToast(err?.message || 'Save failed');
      }
    }, { class: 'ghost' });
    actions.appendChild(saveAsBtn);

    const dupBtn = button('Duplicate', () => {
      if (!presetManager.activePresetId) {
        showToast('No active preset');
        return;
      }
      const name = prompt('Duplicate preset name', `${current?.name || 'Preset'} Copy`);
      if (!name) return;
      try {
        presetManager.duplicate(presetManager.activePresetId, name.trim());
        showToast('Preset duplicated');
      } catch (err) {
        console.error(err);
        showToast(err?.message || 'Duplicate failed');
      }
    }, { class: 'ghost' });
    actions.appendChild(dupBtn);

    const renameBtn = button('Rename', () => {
      if (!presetManager.activePresetId) {
        showToast('No active preset');
        return;
      }
      const name = prompt('Rename preset', current?.name || 'Preset');
      if (!name) return;
      try {
        presetManager.rename(presetManager.activePresetId, name.trim());
        showToast('Preset renamed');
        render('presets');
      } catch (err) {
        console.error(err);
        showToast(err?.message || 'Rename failed');
      }
    }, { class: 'ghost' });
    actions.appendChild(renameBtn);

    const revertBtn = button('Revert', () => {
      if (!presetManager.activePresetId) {
        showToast('No active preset');
        return;
      }
      const ok = confirm('Revert to last saved version?');
      if (!ok) return;
      try {
        presetManager.revert(presetManager.activePresetId);
        showToast('Preset reverted');
      } catch (err) {
        console.error(err);
        showToast(err?.message || 'Revert failed');
      }
    }, { class: 'ghost' });
    actions.appendChild(revertBtn);

    const rollbackBtn = button('Rollback', () => {
      const restored = presetManager.rollback();
      if (restored) showToast('Rolled back to previous preset'); else showToast('Nothing to roll back');
    }, { class: 'ghost' });
    actions.appendChild(rollbackBtn);

    const compareBtn = button('Quick Compare', () => {
      try {
        presetManager.quickCompare(presetManager.activePresetId);
        showToast('Quick compare toggled');
      } catch (err) {
        console.error(err);
        showToast('Compare failed');
      }
    }, { class: 'ghost' });
    actions.appendChild(compareBtn);

    el.appendChild(actions);

    // Quick apply: Built-in Presets
    try {
      const container = h('div', {});
      container.appendChild(h('div', { class: 'shader-subheader' }, 'Built-in Presets'));
      const list = h('div', { class: 'preset-list' });
      const row = h('div', { class: 'row' }, [
        h('div', { class: 'label' }, 'Rave Mode'),
        h('div', { class: 'control' }, [
          button('Apply', () => {
            import('./presets.js').then((mod) => {
              const p = mod?.BUILT_IN_PRESETS?.['Rave Mode'];
              if (p) applyPresetSnapshot(p, { sceneApi, audioEngine, silent: false });
              showToast('Applied Rave Mode');
            }).catch(()=>{});
          }, { class: 'ghost' }),
          button('Create', () => {
            import('./presets.js').then((mod) => {
              const p = mod?.BUILT_IN_PRESETS?.['Rave Mode'];
              if (!p) return;
              try {
                const id = presetManager.create({ name: 'Rave Mode', tags: ['rave','reactive'], snapshot: p });
                presetManager.setFavorite(id, true);
                render('presets');
                showToast('Rave Mode added to library');
              } catch (_) {}
            }).catch(()=>{});
          }, { class: 'ghost' }),
        ]),
      ]);
      list.appendChild(row);
      container.appendChild(list);
      el.appendChild(container);
    } catch(_) {}

    const recents = presetManager.getRecent(6);
    if (recents.length) {
      el.appendChild(h('div', { class: 'shader-subheader' }, 'Recent'));
      const list = h('div', { class: 'preset-list' });
      recents.forEach((entry) => {
        const row = h('div', { class: 'row' }, [
          h('div', { class: 'label' }, entry.name),
          h('div', { class: 'control' }, [
            button('Load', () => {
              try {
                presetManager.load(entry.id);
                showToast(`Loaded ${entry.name}`);
              } catch (err) {
                console.error(err);
                showToast('Load failed');
              }
            }, { class: 'ghost' }),
          ]),
        ]);
        list.appendChild(row);
      });
      el.appendChild(list);
    }

    const favorites = presetManager.getFavorites();
    if (favorites.length) {
      el.appendChild(h('div', { class: 'shader-subheader' }, 'Favorites'));
      const list = h('div', { class: 'preset-list' });
      favorites.forEach((fav) => {
        const row = h('div', { class: 'row' }, [
          h('div', { class: 'label' }, fav.name),
          h('div', { class: 'control' }, [
            button('Load', () => {
              try {
                presetManager.load(fav.id);
                showToast(`Loaded ${fav.name}`);
              } catch (err) {
                console.error(err);
                showToast('Load failed');
              }
            }, { class: 'ghost' }),
            button('★', () => {
              presetManager.setFavorite(fav.id, !fav.favorite);
              render('presets');
            }, { class: 'ghost' }),
          ]),
        ]);
        list.appendChild(row);
      });
      el.appendChild(list);
    }

    const history = presetManager.getHistory();
    if (history.length > 1) {
      el.appendChild(h('div', { class: 'shader-subheader' }, 'Version History'));
      const list = h('div', { class: 'preset-history' });
      history.forEach((entry) => {
        const label = `${new Date(entry.savedAt).toLocaleTimeString()} ${entry.isCurrent ? '(current)' : ''}`;
        const row = h('div', { class: 'row' }, [
          h('div', { class: 'label' }, label),
          h('div', { class: 'control' }, [
            button('Restore', () => {
              try {
                presetManager.restoreVersion(presetManager.activePresetId, entry.id);
                showToast('Version restored');
              } catch (err) {
                console.error(err);
                showToast('Restore failed');
              }
            }, { class: 'ghost' }),
          ]),
        ]);
        list.appendChild(row);
      });
      el.appendChild(list);
    }

    const exportBtn = button('Export Library', () => {
      try {
        const data = JSON.stringify(presetManager.exportState(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'preset-library.json';
        a.click();
      } catch (err) {
        console.error(err);
        showToast('Export failed');
      }
    }, { class: 'ghost' });

    const importBtn = button('Import Library', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          localStorage.setItem('cosmicPresetLibrary.v1', JSON.stringify(parsed));
          showToast('Library imported - reload to apply');
        } catch (err) {
          console.error(err);
          showToast('Import failed');
        }
      };
      input.click();
    }, { class: 'ghost' });

    const exports = h('div', { class: 'preset-io-actions' }, [exportBtn, importBtn]);
    el.appendChild(exports);

    return el;
  }

  function buildSession() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Session') ]);
    const fpsValue = h('span', { id: 'fps-label' }, '0');
    const fpsPill = h('span', { class: 'fps-pill' }, ['FPS ', fpsValue]);
    const summaryItems = [fpsPill, button('Screenshot', onScreenshot, { class: 'ghost' })];
    if (showProjectorControls) {
      const statusSpan = h('span', { class: 'sync-pill disconnected', id: 'sync-status-pill' }, 'No link');
      syncStatusNode = statusSpan;
      summaryItems.unshift(statusSpan);
      summaryItems.push(button('Open Projector', () => {
        const win = syncCoordinator.openProjectorWindow();
        if (!win) showToast('Pop-up blocked. Allow pop-ups and try again.');
      }, { class: 'ghost' }));
      summaryItems.push(button('Sync Now', () => {
        syncCoordinator.pushNow();
        showToast('Settings pushed to projector');
      }, { class: 'ghost' }));
      const autoCheckbox = checkbox(!!syncCoordinator.autoSync, (checked) => {
        syncCoordinator.setAutoSync(checked);
        updateSyncStatus(syncCoordinator.getStatus());
        showToast(checked ? 'Auto-sync enabled' : 'Auto-sync paused');
      });
      syncAutoCheckbox = autoCheckbox;
      const autoWrap = h('label', { class: 'auto-sync-toggle' });
      autoWrap.appendChild(autoCheckbox);
      autoWrap.appendChild(document.createTextNode(' Auto Sync'));
      summaryItems.push(autoWrap);
      updateSyncStatus(syncCoordinator.getStatus());
    }
    const summary = h('div', { class: 'session-summary' }, summaryItems);
    el.appendChild(fieldRow('Session', summary));
    return el;
  }

  function handleShaderHotkeys(event) {
    if (!shaderState.hotkeysEnabled) return;
    const isDrawerOpen = root.style.display === 'block' && root.classList.contains('open');
    if (!isDrawerOpen) return;
    if (event.defaultPrevented) return;
    const tag = (event.target && event.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
    const key = event.key || '';
    const lower = key.toLowerCase();
    if (lower === 's' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      sceneApi.state.params.enableDispersion = sceneApi.state.params.enableDispersion === false;
      updatePinnedHudOverlay();
      notifyRenderAll();
      showShaderHud('Overlay', sceneApi.state.params.enableDispersion !== false ? 'Enabled' : 'Disabled');
      return;
    }
    if (!event.metaKey && !event.ctrlKey && (key === '[' || key === ']')) {
      event.preventDefault();
      event.stopPropagation();
      nudgeParamValue('warpGain', key === '[' ? -1 : 1, event);
      return;
    }
    if (!event.metaKey && !event.ctrlKey && (key === ';' || key === ':' || key === '\'' || key === '"')) {
      event.preventDefault();
      event.stopPropagation();
      nudgeParamValue('twistMax', (key === ';' || key === ':') ? -1 : 1, event);
      return;
    }
    if (!event.metaKey && !event.ctrlKey && !event.altKey && ['1','2','3','4'].includes(key)) {
      event.preventDefault();
      event.stopPropagation();
      shaderState.activeSnapshotSlot = key;
      if (!loadSnapshot(key)) showToast('Snapshot empty');
      return;
    }
    if (event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && lower === 'r') {
      event.preventDefault();
      event.stopPropagation();
      if (shaderState.activeSection) {
        const sectionLabel = DISPERSION_SECTIONS.find((s) => s.id === shaderState.activeSection)?.label || shaderState.activeSection;
        resetSectionToDefaults(shaderState.activeSection);
        showToast(`Section reset: ${sectionLabel}`);
      }
      return;
    }
    if (event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey && lower === 's') {
      event.preventDefault();
      event.stopPropagation();
      render('shader');
      return;
    }
  }

  function loadSavedSettingsSnapshot() {
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('Failed to parse saved settings snapshot', err);
      return null;
    }
  }
  function persistSettingsSnapshot(snapshot) {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snapshot));
      return true;
    } catch (err) {
      console.error('Failed to save settings snapshot', err);
      return false;
    }
  }

  function buildQuick() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Quick') ]);
    // Audio essentials
    el.appendChild(fieldRow('Gain', slider({ min: 0.1, max: 4.0, step: 0.1, value: (audioEngine.gain || 1.0), oninput: (v) => audioEngine.setGain(v) })));
    el.appendChild(fieldRow('Beat Sensitivity', slider({ min: 0.0, max: 2.0, step: 0.05, value: (audioEngine.sensitivity || 1.0), oninput: (v) => audioEngine.setSensitivity(v) })));
    el.appendChild(fieldRow('Smoothing', slider({ min: 0.0, max: 0.95, step: 0.05, value: (audioEngine.smoothing || 0.6), oninput: (v) => audioEngine.setSmoothing(v) })));

    // Visual essentials
    const modeOpts = [
      { label: 'Classic (3D only)', value: 'classic' },
      { label: '3D + Dispersion', value: 'overlay' },
      { label: 'Dispersion only', value: 'shader-only' },
    ];
    el.appendChild(fieldRow('Visual Mode', select(modeOpts, sceneApi.state.params.visualMode || 'overlay', (v)=>{ sceneApi.state.params.visualMode = v; if (typeof sceneApi.setVisualMode === 'function') sceneApi.setVisualMode(v); render(currentTab); })));
    el.appendChild(fieldRow('Bloom Strength (Base)', slider({ min: 0.0, max: 3.0, step: 0.05, value: sceneApi.state.params.bloomStrengthBase, oninput: (v)=>{ sceneApi.state.params.bloomStrengthBase = v; } })));
    el.appendChild(fieldRow('Bloom Strength (Reactive)', slider({ min: 0.0, max: 2.5, step: 0.05, value: sceneApi.state.params.bloomReactiveGain, oninput: (v)=>{ sceneApi.state.params.bloomReactiveGain = v; } })));

    // One-tap styles (limited)
    el.appendChild(h('div', { class: 'shader-subheader' }, 'One-Tap Styles'));
    const stylesRow = h('div', { class: 'shader-styles-row' });
    (DISPERSION_STYLES.slice(0, 6) || []).forEach((style) => {
      const btn = button(style.label, () => {
        const params = ensureDispersionParams();
        applyStyle(params, style.id);
        updatePinnedHudOverlay();
        notifyRenderAll();
        showShaderHud(style.label, 'Applied');
      }, { class: 'ghost' });
      btn.title = style.description || '';
      stylesRow.appendChild(btn);
    });
    el.appendChild(stylesRow);

    // Snapshots A/B
    el.appendChild(h('div', { class: 'shader-subheader' }, 'Snapshots'));
    const quickSnapshots = h('div', { class: 'shader-snapshot-row' });
    ['1','2'].forEach((slotId) => {
      const btn = button(slotId === '1' ? 'A' : 'B', (event) => {
        event.preventDefault();
        shaderState.activeSnapshotSlot = slotId;
        if (event.altKey) {
          clearSnapshot(slotId);
        } else if (event.shiftKey || event.metaKey || event.ctrlKey) {
          captureSnapshot(slotId);
        } else if (!loadSnapshot(slotId)) {
          showToast('Snapshot empty');
        }
        if (shaderRenderContext) shaderRenderContext.refreshAll();
      }, { class: 'ghost snapshot-button' });
      btn.title = 'Click=load, Shift+Click=save, Alt+Click=clear';
      quickSnapshots.appendChild(btn);
    });
    const abBtn = button('A ↔ B', () => {
      const next = shaderState.activeSnapshotSlot === '1' ? '2' : '1';
      shaderState.activeSnapshotSlot = next;
      if (!loadSnapshot(next, { silent: true })) showToast(`Snapshot ${next} empty`);
    }, { class: 'ghost snapshot-toggle' });
    quickSnapshots.appendChild(abBtn);
    el.appendChild(quickSnapshots);

    return el;
  }

  const builders = {
    quick: buildQuick,
    source: buildSource,
    audio: buildAudio,
    visuals: buildVisuals,
    shader: buildShader,
    mapping: buildMapping,
    tempo: buildTempo,
    presets: buildPresets,
    session: buildSession,
  };

  function render(tabId = 'quick') {
    currentTab = tabId;
    const mode = sceneApi.state.params.visualMode || 'overlay';
    const visibleTabs = tabs.filter((t) => {
      if (t.id === 'visuals') return mode !== 'shader-only';
      if (t.id === 'mapping') return mode !== 'shader-only';
      if (t.id === 'shader') return mode !== 'classic';
      return true;
    });
    if (!visibleTabs.some(t => t.id === tabId)) tabId = visibleTabs[0]?.id || 'quick';
    tabsEl.replaceChildren();
    for (const t of visibleTabs) {
      const b = h('button', { class: 'tab' + (t.id === tabId ? ' active' : ''), onClick: ()=> render(t.id) }, t.label);
      tabsEl.appendChild(b);
    }
    content.replaceChildren();
    const builder = builders[tabId];
    Promise.resolve(builder()).then((node) => { content.appendChild(node); });
  }

  if (presetManager && typeof presetManager.on === 'function') {
    presetManager.on('*', () => {
      if (currentTab === 'presets') render('presets');
    });
  }

  btnReset.addEventListener('click', ()=> { try { window.location.reload(); } catch(_) {} });
  btnSaveSettings.addEventListener('click', ()=> {
    try {
      const snapshot = capturePresetSnapshot({ sceneApi, audioEngine });
      if (persistSettingsSnapshot(snapshot)) showToast('Settings saved'); else showToast('Save failed');
    } catch (err) {
      console.error(err);
      showToast('Save failed');
    }
  });
  btnSavePreset.addEventListener('click', ()=> {
    if (!presetManager) {
      showToast('Preset manager unavailable');
      return;
    }
    const name = prompt('Preset name');
    if (!name) return;
    try {
      presetManager.saveAs(name.trim());
      showToast('Preset saved');
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Preset save failed');
    }
  });

  // Factory reset / startup overrides via query params
  // ?reset or ?factory -> clear saved settings and skip auto-apply
  // ?preset=Name -> apply a built-in preset by name on load
  const qs = new URLSearchParams(location.search || '');
  const doFactoryReset = qs.has('reset') || qs.has('factory');
  if (doFactoryReset) {
    try {
      localStorage.removeItem('cosmic_saved_settings');
      localStorage.removeItem('cosmic_default_preset');
      if (qs.has('factory')) {
        localStorage.removeItem('cosmicPresetLibrary.v1');
        localStorage.removeItem('cosmicPresetLibrary.v1.tmp');
        localStorage.removeItem('cosmicPresetLibrary.v1.bak');
      }
    } catch(_) {}
  }

  if (!doFactoryReset) {
    const savedSettings = loadSavedSettingsSnapshot();
    if (savedSettings) applyPresetSnapshot(savedSettings, { sceneApi, audioEngine, silent: true });
    try {
      const defName = localStorage.getItem('cosmic_default_preset');
      if (defName) {
        import('./presets.js').then((mod) => {
          const p = mod?.BUILT_IN_PRESETS?.[defName];
          if (p) applyPresetSnapshot(p, { sceneApi, audioEngine, silent: true });
        }).catch(()=>{});
      }
    } catch(_) {}
  }

  // Optional preset apply via URL (?preset=Rave%20161)
  try {
    const presetName = qs.get('preset');
    if (presetName) {
      import('./presets.js').then((mod) => {
        const p = mod?.BUILT_IN_PRESETS?.[presetName];
        if (p) applyPresetSnapshot(p, { sceneApi, audioEngine, silent: true });
      }).catch(()=>{});
    }
  } catch(_) {}

  render('quick');

  // Remove before adding to prevent duplicates if initSettingsUI is called multiple times
  window.removeEventListener('keydown', handleShaderHotkeys, true);
  window.addEventListener('keydown', handleShaderHotkeys, true);

  // external labels update (FPS etc.)
  function updateFpsLabel(v) {
    const n = document.getElementById('fps-label'); if (n) n.textContent = String(Math.round(v));
  }
  function updateBeatIndicator(isBeat) {
    const el = document.getElementById('beat-indicator');
    if (!el) return;
    if (isBeat) {
      el.classList.add('on');
      // Clear quickly to make a short pulse
      clearTimeout(updateBeatIndicator._t);
      updateBeatIndicator._t = setTimeout(() => el.classList.remove('on'), 80);
    }
  }
  function updateBpmLabel(info) {
    const isObj = info && typeof info === 'object';
    const bpm = isObj ? info.bpm : info;
    const confidence = isObj ? info.confidence : undefined;
    const source = isObj ? info.source : undefined;
    const bpmNode = document.getElementById('auto-bpm');
    if (bpmNode) bpmNode.textContent = String(Math.round(bpm || 0));
    if (typeof confidence === 'number') {
      const confNode = document.getElementById('auto-bpm-conf');
      if (confNode) confNode.textContent = Number.isFinite(confidence) ? confidence.toFixed(2) : '0.00';
    }
    if (source !== undefined) {
      const srcNode = document.getElementById('auto-bpm-source');
      if (srcNode) srcNode.textContent = source || 'none';
    }

    // Optional: auto-apply BPM shader preset when bucket changes
    try {
      const auto = JSON.parse(localStorage.getItem('cosmic_auto_shader_preset') || 'false');
      if (!auto) return;
    } catch(_) { return; }
    const bpmVal = Number(bpm) || 0;
    if (!(bpmVal > 30 && bpmVal < 300)) return;
    let bucket = 'low';
    if (bpmVal > 180) bucket = 'rave';
    else if (bpmVal >= 160) bucket = 'dnb';
    else if (bpmVal >= 130) bucket = 'techno';
    else if (bpmVal >= 120) bucket = 'house';
    else if (bpmVal >= 100) bucket = 'chill';
    const key = 'cosmic_auto_shader_bucket';
    const last = localStorage.getItem(key) || '';
    if (last === bucket) return;
    try { localStorage.setItem(key, bucket); } catch(_) {}
    try {
      import('./shader-presets.js').then((mod) => {
        const pick = mod?.pickShaderPresetForBpm;
        const presets = mod?.SHADER_PRESETS || {};
        let selection = null;
        if (typeof pick === 'function') selection = pick(bpmVal);
        if (!selection || !selection.values) return;
        const params = ensureDispersionParams();
        Object.assign(params, withDispersionDefaults({ ...params, ...selection.values }));
        updatePinnedHudOverlay();
        notifyRenderAll();
        showShaderHud(selection.name || 'BPM Preset', 'Applied');
      }).catch(()=>{});
    } catch(_) {}
  }
  function updateTapAndDrift({ tapBpm, bpm }) {
    const t = document.getElementById('tap-bpm');
    if (t && typeof tapBpm === 'number') t.textContent = String(Math.round(tapBpm || 0));
    const a = document.getElementById('auto-bpm');
    if (a && typeof bpm === 'number') a.textContent = String(Math.round(bpm || 0));
  }
  function updateDriftDetails({ tapBpm, beatGrid, aubioTempo, aubioConf }) {
    const lb = document.getElementById('live-bpm');
    if (lb && typeof aubioTempo === 'number') lb.textContent = String(Math.round(aubioTempo || 0));
    const lc = document.getElementById('live-conf');
    if (lc && typeof aubioConf === 'number') lc.textContent = (aubioConf || 0).toFixed(2);
  }
  function updateSyncStatus(status = {}) {
    if (!showProjectorControls) return;
    const node = (syncStatusNode && typeof document !== 'undefined' && document.body.contains(syncStatusNode))
      ? syncStatusNode
      : document.getElementById('sync-status-pill');
    const now = Date.now();
    const connected = !!status.connected;
    const auto = status.autoSync !== false;
    if (node) {
      let label = connected ? 'Connected' : 'No link';
      let tone = connected ? 'connected' : 'disconnected';
      const lastFeatures = typeof status.lastFeaturesAt === 'number' ? status.lastFeaturesAt : 0;
      const lastHeartbeat = typeof status.lastHeartbeatAt === 'number' ? status.lastHeartbeatAt : 0;
      if (connected) {
        if (lastFeatures > 0) {
          const ageMs = Math.max(0, now - lastFeatures);
          if (ageMs > 1800) {
            label = 'Connected (idle)';
          } else {
            const ageSec = Math.round(ageMs / 100) / 10;
            label = `Connected (${ageSec.toFixed(1)}s)`;
          }
        }
      } else if (lastHeartbeat > 0) {
        tone = 'pending';
        const ageSec = Math.max(0, Math.round((now - lastHeartbeat) / 1000));
        label = ageSec > 0 ? `Reconnecting (${ageSec}s)` : 'Reconnecting';
      }
      if (!auto) label += ' - Manual';
      node.className = `sync-pill ${tone}`;
      node.textContent = label;
      syncStatusNode = node;
    }
    if (syncAutoCheckbox) {
      syncAutoCheckbox.checked = auto;
    }
  }

  return { open, close, updateFpsLabel, updateBpmLabel, updateTapAndDrift, updateDriftDetails, updateSyncStatus, updateBeatIndicator };
}
