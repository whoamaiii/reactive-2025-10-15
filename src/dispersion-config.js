const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const DISPERSION_DEFAULTS = Object.freeze({
  opacityBase: 0.18,
  opacityTrebleGain: 0.55,
  opacityMin: 0.12,
  opacityMax: 0.8,
  zoomGain: 28.0,
  zoomBias: -10.0,
  zoomLerp: 0.1,
  opacityLerp: 0.12,
  warpFrom: 'bass',
  warpGain: 0.8,
  warpOnBeat: true,
  warpOnDropBoost: 0.6,
  tintHue: 0.0,
  tintSat: 0.0,
  tintMix: 0.0,
  brightness: 1.0,
  brightnessGain: 0.4,
  contrast: 1.0,
  contrastGain: 0.3,
  twistBase: 0.0,
  twistMax: 0.8,
  twistBassGain: 0.6,
  twistBeatGain: 0.35,
  twistOnsetGain: 0.25,
  twistFluxGain: 0.15,
  twistStutterGain: 0.2,
  twistAttack: 0.32,
  twistRelease: 0.14,
  twistFalloff: 1.2,
  stutterWindowMs: 180,
  flipOnStutter: true,
  travelBase: 0.06,
  travelGain: 0.12,
  travelBeatBoost: 0.06,
  travelDropBoost: 0.12,
  travelAttack: 0.20,
  travelRelease: 0.08,
  travelModulo: 400,
  pulseHalfLifeMs: 160,
  parallaxCentroidGain: 0.08,
  parallaxFluxGain: 0.024,
  parallaxLerp: 0.18,
  parallaxClamp: 0.16,
  tintMixBase: 0.0,
  tintMixChromaGain: 0.45,
  tintMixMax: 0.85,
  downbeatTwistBoost: 0.3,
  flipEveryNBeats: 0,
  // Vortex Drill specific defaults
  drillBox: 1.5,
  drillRadius: 1.0,
  repPeriod: 4.0,
  rotDepth: 0.10,
  steps: 300,
});

export const DISPERSION_SECTIONS = [
  { id: 'opacity', label: 'Opacity' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'warp', label: 'Warp / Drive' },
  { id: 'parallax', label: 'Parallax' },
  { id: 'color', label: 'Color' },
  { id: 'tone', label: 'Tone' },
  { id: 'twist', label: 'Twist' },
  { id: 'stutter', label: 'Flip & Decay' },
  { id: 'travel', label: 'Travel' },
  { id: 'drill', label: 'Drill / Tunnel' },
];

export const DISPERSION_PARAM_SCHEMA = [
  { key: 'opacityBase', label: 'Opacity Base', section: 'opacity', type: 'range', min: 0.0, max: 0.8, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.opacityBase, macro: 'opacityRange', keywords: ['opacity', 'base'] },
  { key: 'opacityTrebleGain', label: 'Treble Gain', section: 'opacity', type: 'range', min: 0.0, max: 1.5, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.opacityTrebleGain, macro: 'intensity', keywords: ['opacity', 'gain', 'treble'] },
  { key: 'opacityMin', label: 'Opacity Min', section: 'opacity', type: 'range', min: 0.0, max: 0.8, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.opacityMin, macro: 'opacityRange', keywords: ['opacity', 'min'] },
  { key: 'opacityMax', label: 'Opacity Max', section: 'opacity', type: 'range', min: 0.1, max: 1.0, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.opacityMax, macro: 'opacityRange', keywords: ['opacity', 'max'] },
  { key: 'opacityLerp', label: 'Opacity Lerp', section: 'opacity', type: 'range', min: 0.01, max: 0.5, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.opacityLerp, keywords: ['opacity', 'smooth'] },
  { key: 'zoomGain', label: 'Zoom Gain', section: 'zoom', type: 'range', min: 0.0, max: 60.0, step: 0.5, fineStep: 0.1, default: DISPERSION_DEFAULTS.zoomGain, macro: 'zoomRange', keywords: ['zoom', 'gain'] },
  { key: 'zoomBias', label: 'Zoom Bias', section: 'zoom', type: 'range', min: -40.0, max: 20.0, step: 0.5, fineStep: 0.1, default: DISPERSION_DEFAULTS.zoomBias, macro: 'zoomRange', keywords: ['zoom', 'bias'] },
  { key: 'zoomLerp', label: 'Zoom Lerp', section: 'zoom', type: 'range', min: 0.01, max: 0.5, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.zoomLerp, keywords: ['zoom', 'smooth'] },
  { key: 'warpFrom', label: 'Warp Source', section: 'warp', type: 'select', options: [{ label: 'Bass', value: 'bass' }, { label: 'Mid', value: 'mid' }, { label: 'Treble', value: 'treble' }, { label: 'RMS', value: 'rms' }], default: DISPERSION_DEFAULTS.warpFrom, keywords: ['warp', 'drive', 'source'] },
  { key: 'warpGain', label: 'Warp Gain', section: 'warp', type: 'range', min: 0.0, max: 3.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.warpGain, macro: 'warpDrive', keywords: ['warp', 'drive', 'gain'], nudgeHotkeys: { dec: '[', inc: ']' } },
  { key: 'warpOnBeat', label: 'Pulse on Beat', section: 'warp', type: 'boolean', default: DISPERSION_DEFAULTS.warpOnBeat, macro: 'warpDrive', keywords: ['warp', 'beat'] },
  { key: 'warpOnDropBoost', label: 'Drop Boost', section: 'warp', type: 'range', min: 0.0, max: 2.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.warpOnDropBoost, macro: 'warpDrive', keywords: ['warp', 'drop'] },
  { key: 'parallaxCentroidGain', label: 'Centroid Gain', section: 'parallax', type: 'range', min: 0.0, max: 0.3, step: 0.002, fineStep: 0.0005, default: DISPERSION_DEFAULTS.parallaxCentroidGain, macro: 'parallax', keywords: ['parallax', 'centroid'] },
  { key: 'parallaxFluxGain', label: 'Flux Gain', section: 'parallax', type: 'range', min: 0.0, max: 0.2, step: 0.002, fineStep: 0.0005, default: DISPERSION_DEFAULTS.parallaxFluxGain, macro: 'parallax', keywords: ['parallax', 'flux'] },
  { key: 'parallaxLerp', label: 'Smooth Lerp', section: 'parallax', type: 'range', min: 0.01, max: 0.6, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.parallaxLerp, keywords: ['parallax', 'smooth'] },
  { key: 'parallaxClamp', label: 'Clamp', section: 'parallax', type: 'range', min: 0.02, max: 0.6, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.parallaxClamp, macro: 'parallax', keywords: ['parallax', 'clamp'] },
  { key: 'tintHue', label: 'Tint Hue', section: 'color', type: 'range', min: 0.0, max: 1.0, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.tintHue, macro: 'colorBias', keywords: ['color', 'hue'] },
  { key: 'tintSat', label: 'Tint Saturation', section: 'color', type: 'range', min: 0.0, max: 1.0, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.tintSat, macro: 'colorBias', keywords: ['color', 'saturation'] },
  { key: 'tintMixBase', label: 'Tint Mix Base', section: 'color', type: 'range', min: 0.0, max: 1.0, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.tintMixBase, macro: 'colorBias', keywords: ['color', 'mix'] },
  { key: 'tintMixChromaGain', label: 'Tint Mix Gain', section: 'color', type: 'range', min: 0.0, max: 1.5, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.tintMixChromaGain, macro: 'colorBias', keywords: ['color', 'mix', 'gain'] },
  { key: 'tintMixMax', label: 'Tint Mix Max', section: 'color', type: 'range', min: 0.1, max: 1.0, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.tintMixMax, macro: 'colorBias', keywords: ['color', 'mix', 'max'] },
  { key: 'brightness', label: 'Brightness', section: 'tone', type: 'range', min: 0.2, max: 2.5, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.brightness, keywords: ['tone', 'brightness'] },
  { key: 'brightnessGain', label: 'Brightness Gain', section: 'tone', type: 'range', min: 0.0, max: 2.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.brightnessGain, macro: 'intensity', keywords: ['tone', 'brightness', 'gain'] },
  { key: 'contrast', label: 'Contrast', section: 'tone', type: 'range', min: 0.2, max: 3.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.contrast, keywords: ['tone', 'contrast'] },
  { key: 'contrastGain', label: 'Contrast Gain', section: 'tone', type: 'range', min: 0.0, max: 2.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.contrastGain, macro: 'intensity', keywords: ['tone', 'contrast', 'gain'] },
  { key: 'twistBase', label: 'Twist Base', section: 'twist', type: 'range', min: 0.0, max: 1.0, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.twistBase, macro: 'twistEnergy', keywords: ['twist', 'base'] },
  { key: 'twistMax', label: 'Twist Max', section: 'twist', type: 'range', min: 0.1, max: 1.5, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.twistMax, macro: 'twistEnergy', keywords: ['twist', 'max'], nudgeHotkeys: { dec: ';', inc: '\'' } },
  { key: 'twistBassGain', label: 'Bass Gain', section: 'twist', type: 'range', min: 0.0, max: 2.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.twistBassGain, macro: 'twistEnergy', keywords: ['twist', 'bass'] },
  { key: 'twistBeatGain', label: 'Beat Gain', section: 'twist', type: 'range', min: 0.0, max: 1.5, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.twistBeatGain, macro: 'twistEnergy', keywords: ['twist', 'beat'] },
  { key: 'downbeatTwistBoost', label: 'Downbeat Boost', section: 'twist', type: 'range', min: 0.0, max: 1.5, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.downbeatTwistBoost, macro: 'twistEnergy', keywords: ['twist', 'downbeat'] },
  { key: 'twistOnsetGain', label: 'Onset Gain', section: 'twist', type: 'range', min: 0.0, max: 1.5, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.twistOnsetGain, macro: 'twistEnergy', keywords: ['twist', 'onset'] },
  { key: 'twistFluxGain', label: 'Flux Gain', section: 'twist', type: 'range', min: 0.0, max: 1.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.twistFluxGain, macro: 'twistEnergy', keywords: ['twist', 'flux'] },
  { key: 'twistStutterGain', label: 'Stutter Gain', section: 'twist', type: 'range', min: 0.0, max: 1.0, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.twistStutterGain, macro: 'twistEnergy', keywords: ['twist', 'stutter'] },
  { key: 'twistAttack', label: 'Twist Attack', section: 'twist', type: 'range', min: 0.02, max: 0.9, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.twistAttack, macro: 'twistEnergy', keywords: ['twist', 'attack'] },
  { key: 'twistRelease', label: 'Twist Release', section: 'twist', type: 'range', min: 0.02, max: 0.6, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.twistRelease, macro: 'twistEnergy', keywords: ['twist', 'release'] },
  { key: 'twistFalloff', label: 'Twist Falloff', section: 'twist', type: 'range', min: 0.0, max: 3.0, step: 0.05, fineStep: 0.01, default: DISPERSION_DEFAULTS.twistFalloff, macro: 'twistEnergy', keywords: ['twist', 'falloff'] },
  { key: 'stutterWindowMs', label: 'Stutter Window (ms)', section: 'stutter', type: 'range', min: 80, max: 400, step: 10, fineStep: 2, default: DISPERSION_DEFAULTS.stutterWindowMs, keywords: ['stutter', 'window'] },
  { key: 'flipOnStutter', label: 'Flip on Stutter', section: 'stutter', type: 'boolean', default: DISPERSION_DEFAULTS.flipOnStutter, keywords: ['stutter', 'flip'] },
  { key: 'flipEveryNBeats', label: 'Flip every N Beats', section: 'stutter', type: 'range', min: 0, max: 32, step: 1, fineStep: 1, default: DISPERSION_DEFAULTS.flipEveryNBeats, keywords: ['twist', 'flip'] },
  { key: 'pulseHalfLifeMs', label: 'Pulse Decay (ms)', section: 'stutter', type: 'range', min: 60, max: 400, step: 10, fineStep: 2, default: DISPERSION_DEFAULTS.pulseHalfLifeMs, keywords: ['pulse', 'decay'] },
  { key: 'travelBase', label: 'Base Speed', section: 'travel', type: 'range', min: -0.2, max: 0.4, step: 0.002, fineStep: 0.0005, default: DISPERSION_DEFAULTS.travelBase, macro: 'travel', keywords: ['travel', 'base'] },
  { key: 'travelGain', label: 'Audio Gain', section: 'travel', type: 'range', min: 0.0, max: 0.6, step: 0.005, fineStep: 0.001, default: DISPERSION_DEFAULTS.travelGain, macro: 'travel', keywords: ['travel', 'gain'] },
  { key: 'travelBeatBoost', label: 'Beat Boost', section: 'travel', type: 'range', min: 0.0, max: 0.3, step: 0.005, fineStep: 0.001, default: DISPERSION_DEFAULTS.travelBeatBoost, macro: 'travel', keywords: ['travel', 'beat'] },
  { key: 'travelDropBoost', label: 'Drop Boost', section: 'travel', type: 'range', min: 0.0, max: 0.5, step: 0.005, fineStep: 0.001, default: DISPERSION_DEFAULTS.travelDropBoost, macro: 'travel', keywords: ['travel', 'drop'] },
  { key: 'travelAttack', label: 'Travel Attack', section: 'travel', type: 'range', min: 0.01, max: 0.9, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.travelAttack, macro: 'travel', keywords: ['travel', 'attack'] },
  { key: 'travelRelease', label: 'Travel Release', section: 'travel', type: 'range', min: 0.01, max: 0.6, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.travelRelease, macro: 'travel', keywords: ['travel', 'release'] },
  { key: 'travelModulo', label: 'Wrap Distance', section: 'travel', type: 'range', min: 100, max: 1200, step: 10, fineStep: 2, default: DISPERSION_DEFAULTS.travelModulo, keywords: ['travel', 'wrap'] },
  // Drill / Tunnel (Vortex variant)
  { key: 'drillBox', label: 'Tunnel Box Half-Size', section: 'drill', type: 'range', min: 0.8, max: 2.8, step: 0.02, fineStep: 0.005, default: DISPERSION_DEFAULTS.drillBox, keywords: ['drill', 'tunnel', 'box'] },
  { key: 'drillRadius', label: 'Drill Radius', section: 'drill', type: 'range', min: 0.5, max: 1.8, step: 0.01, fineStep: 0.002, default: DISPERSION_DEFAULTS.drillRadius, keywords: ['drill', 'radius'] },
  { key: 'repPeriod', label: 'Repeat Period', section: 'drill', type: 'range', min: 2.0, max: 8.0, step: 0.05, fineStep: 0.01, default: DISPERSION_DEFAULTS.repPeriod, keywords: ['drill', 'repeat', 'period'] },
  { key: 'rotDepth', label: 'Rotation Depth Factor', section: 'drill', type: 'range', min: 0.0, max: 0.25, step: 0.002, fineStep: 0.0005, default: DISPERSION_DEFAULTS.rotDepth, keywords: ['drill', 'rotate', 'depth'] },
  { key: 'steps', label: 'Iterations', section: 'drill', type: 'range', min: 60, max: 450, step: 5, fineStep: 1, default: DISPERSION_DEFAULTS.steps, keywords: ['drill', 'iterations', 'quality'] },
];

const schemaMap = new Map(DISPERSION_PARAM_SCHEMA.map((item) => [item.key, item]));

export const DISPERSION_STORAGE_KEYS = Object.freeze({
  pinned: 'cosmic_dispersion_pins',
  pinnedHud: 'cosmic_dispersion_pinned_hud',
  snapshots: 'cosmic_dispersion_snapshots',
  sectionPresets: 'cosmic_dispersion_section_presets',
  macros: 'cosmic_dispersion_macros',
  hotkeys: 'cosmic_dispersion_hotkeys_enabled',
  shaderPresets: 'cosmic_dispersion_shader_presets',
});

export function getParamSchema(key) {
  return schemaMap.get(key) || null;
}

export function withDispersionDefaults(input = {}) {
  const result = { ...DISPERSION_DEFAULTS, ...input };
  DISPERSION_PARAM_SCHEMA.forEach(({ key, type, default: def, min, max }) => {
    const value = result[key];
    if (type === 'range') {
      const num = Number.isFinite(value) ? Number(value) : def;
      result[key] = clamp(num, min, max);
    } else if (type === 'boolean') {
      result[key] = value === undefined ? !!def : !!value;
    } else if (type === 'select') {
      const options = schemaMap.get(key)?.options || [];
      const valid = options.some((opt) => opt.value === value);
      result[key] = valid ? value : def;
    } else {
      result[key] = value === undefined ? def : value;
    }
  });
  return result;
}

export function cloneDispersion(params) {
  return withDispersionDefaults(JSON.parse(JSON.stringify(params || {})));
}

export function clampValueForKey(key, value) {
  const schema = schemaMap.get(key);
  if (!schema) return value;
  if (schema.type === 'range') return clamp(Number(value), schema.min, schema.max);
  if (schema.type === 'boolean') return !!value;
  if (schema.type === 'select') {
    return schema.options.some((opt) => opt.value === value) ? value : schema.default;
  }
  return value;
}

export function sectionKeys(sectionId) {
  return DISPERSION_PARAM_SCHEMA.filter((item) => item.section === sectionId).map((item) => item.key);
}

export function pickSection(params, sectionId) {
  const keys = sectionKeys(sectionId);
  const result = {};
  keys.forEach((key) => {
    if (key in params) result[key] = params[key];
  });
  return result;
}

export function assignSection(target, source, sectionId) {
  const keys = sectionKeys(sectionId);
  keys.forEach((key) => {
    if (key in source) target[key] = clampValueForKey(key, source[key]);
  });
}

export function serializeDispersion(params) {
  const cleaned = {};
  const merged = withDispersionDefaults(params);
  Object.keys(DISPERSION_DEFAULTS).forEach((key) => {
    cleaned[key] = merged[key];
  });
  return cleaned;
}

export function deserializeDispersion(raw) {
  if (!raw || typeof raw !== 'object') return withDispersionDefaults({});
  return withDispersionDefaults(raw);
}

export const DISPERSION_MACROS = [
  {
    id: 'intensity',
    label: 'Intensity',
    defaultValue: 0.5,
    apply: (value, params) => {
      const mult = (t) => clamp(lerp(0.4, 2.0, t), 0.2, 3.0);
      const factor = mult(value);
      params.opacityTrebleGain = clampValueForKey('opacityTrebleGain', DISPERSION_DEFAULTS.opacityTrebleGain * factor);
      params.warpGain = clampValueForKey('warpGain', DISPERSION_DEFAULTS.warpGain * lerp(0.5, 1.8, value));
      params.twistMax = clampValueForKey('twistMax', DISPERSION_DEFAULTS.twistMax * lerp(0.6, 1.4, value));
      params.contrastGain = clampValueForKey('contrastGain', DISPERSION_DEFAULTS.contrastGain * factor);
      params.brightnessGain = clampValueForKey('brightnessGain', DISPERSION_DEFAULTS.brightnessGain * lerp(0.5, 2.0, value));
    },
  },
  {
    id: 'colorBias',
    label: 'Warm ←→ Cool',
    defaultValue: 0.5,
    apply: (value, params) => {
      params.tintHue = clampValueForKey('tintHue', lerp(0.65, 0.05, value));
      params.tintSat = clampValueForKey('tintSat', lerp(0.15, 0.65, value));
      params.tintMixBase = clampValueForKey('tintMixBase', lerp(0.0, 0.28, value));
      params.tintMixChromaGain = clampValueForKey('tintMixChromaGain', lerp(0.2, 0.9, value));
      params.tintMixMax = clampValueForKey('tintMixMax', lerp(0.6, 0.95, value));
    },
  },
  {
    id: 'warpDrive',
    label: 'Warp Drive',
    defaultValue: 0.5,
    apply: (value, params) => {
      params.warpGain = clampValueForKey('warpGain', lerp(0.2, 2.4, value));
      params.warpOnDropBoost = clampValueForKey('warpOnDropBoost', lerp(0.0, 1.4, value));
      params.warpOnBeat = value >= 0.2 ? true : params.warpOnBeat;
    },
  },
  {
    id: 'twistEnergy',
    label: 'Twist Energy',
    defaultValue: 0.5,
    apply: (value, params) => {
      const mult = lerp(0.4, 1.8, value);
      params.twistMax = clampValueForKey('twistMax', DISPERSION_DEFAULTS.twistMax * lerp(0.6, 1.5, value));
      params.twistBassGain = clampValueForKey('twistBassGain', DISPERSION_DEFAULTS.twistBassGain * mult);
      params.twistBeatGain = clampValueForKey('twistBeatGain', DISPERSION_DEFAULTS.twistBeatGain * mult);
      params.twistOnsetGain = clampValueForKey('twistOnsetGain', DISPERSION_DEFAULTS.twistOnsetGain * mult);
      params.twistFluxGain = clampValueForKey('twistFluxGain', DISPERSION_DEFAULTS.twistFluxGain * mult);
      params.twistStutterGain = clampValueForKey('twistStutterGain', DISPERSION_DEFAULTS.twistStutterGain * mult);
      params.twistAttack = clampValueForKey('twistAttack', lerp(0.05, 0.8, value));
      params.twistRelease = clampValueForKey('twistRelease', lerp(0.02, 0.4, 1 - value));
    },
  },
  {
    id: 'travel',
    label: 'Travel Speed',
    defaultValue: 0.5,
    apply: (value, params) => {
      params.travelBase = clampValueForKey('travelBase', lerp(-0.05, 0.25, value));
      params.travelGain = clampValueForKey('travelGain', lerp(0.02, 0.35, value));
      params.travelBeatBoost = clampValueForKey('travelBeatBoost', lerp(0.0, 0.22, value));
      params.travelDropBoost = clampValueForKey('travelDropBoost', lerp(0.0, 0.35, value));
      params.travelAttack = clampValueForKey('travelAttack', lerp(0.05, 0.8, value));
      params.travelRelease = clampValueForKey('travelRelease', lerp(0.02, 0.4, 1 - value));
    },
  },
  {
    id: 'parallax',
    label: 'Parallax Amount',
    defaultValue: 0.5,
    apply: (value, params) => {
      const gainFactor = lerp(0.0, 0.3, value);
      params.parallaxCentroidGain = clampValueForKey('parallaxCentroidGain', gainFactor);
      params.parallaxFluxGain = clampValueForKey('parallaxFluxGain', gainFactor * 0.8);
      params.parallaxClamp = clampValueForKey('parallaxClamp', lerp(0.05, 0.35, value));
    },
  },
  {
    id: 'opacityRange',
    label: 'Opacity Range',
    defaultValue: 0.5,
    apply: (value, params) => {
      const maxRange = lerp(0.45, 0.95, value);
      const minRange = lerp(0.05, 0.35, 1 - value);
      params.opacityBase = clampValueForKey('opacityBase', lerp(0.05, 0.45, value));
      params.opacityMin = clampValueForKey('opacityMin', clamp(params.opacityBase - minRange * 0.5, 0, 0.8));
      params.opacityMax = clampValueForKey('opacityMax', clamp(params.opacityBase + maxRange * 0.5, 0.2, 1.0));
    },
  },
  {
    id: 'zoomRange',
    label: 'Zoom Range',
    defaultValue: 0.5,
    apply: (value, params) => {
      params.zoomGain = clampValueForKey('zoomGain', lerp(10, 48, value));
      params.zoomBias = clampValueForKey('zoomBias', lerp(-24, -4, value));
    },
  },
];

export const DISPERSION_STYLES = [
  {
    id: 'monochrome',
    label: 'Monochrome',
    description: 'Low saturation, glassy whites.',
    values: {
      tintSat: 0.0,
      tintMixBase: 0.0,
      tintMixChromaGain: 0.15,
      tintMixMax: 0.45,
      contrast: 1.2,
      contrastGain: 0.18,
      brightness: 1.15,
      brightnessGain: 0.32,
    },
  },
  {
    id: 'psy',
    label: 'Psy',
    description: 'Hypercolor, heavy warp.',
    values: {
      tintHue: 0.85,
      tintSat: 0.8,
      tintMixBase: 0.35,
      tintMixChromaGain: 0.95,
      tintMixMax: 0.95,
      warpGain: 1.6,
      warpOnDropBoost: 1.2,
      twistMax: 1.3,
      contrastGain: 0.55,
    },
  },
  {
    id: 'nebula',
    label: 'Nebulae',
    description: 'Purple-blue gaseous clouds.',
    values: {
      tintHue: 0.62,
      tintSat: 0.55,
      tintMixBase: 0.25,
      tintMixChromaGain: 0.6,
      tintMixMax: 0.9,
      opacityBase: 0.24,
      opacityTrebleGain: 0.65,
      warpGain: 0.95,
      travelBase: 0.08,
      travelGain: 0.2,
    },
  },
  {
    id: 'glass',
    label: 'Glass',
    description: 'High contrast, refractive feel.',
    values: {
      tintHue: 0.1,
      tintSat: 0.15,
      tintMixBase: 0.1,
      tintMixChromaGain: 0.45,
      brightness: 1.25,
      brightnessGain: 0.2,
      contrast: 1.4,
      contrastGain: 0.45,
      twistFalloff: 1.7,
      travelModulo: 800,
    },
  },
];

export function applyMacroValue(params, macroId, value) {
  const macro = DISPERSION_MACROS.find((item) => item.id === macroId);
  if (!macro) return;
  macro.apply(clamp(value, 0, 1), params);
}

export function applyStyle(params, styleId) {
  const style = DISPERSION_STYLES.find((item) => item.id === styleId);
  if (!style) return;
  Object.entries(style.values).forEach(([key, value]) => {
    params[key] = clampValueForKey(key, value);
  });
}

export function randomizeSection(params, sectionId, { subtle = false } = {}) {
  const keys = sectionKeys(sectionId);
  keys.forEach((key) => {
    const schema = schemaMap.get(key);
    if (!schema || schema.type !== 'range') return;
    const current = params[key];
    if (subtle) {
      const span = (schema.max - schema.min) * 0.1;
      const offset = (Math.random() - 0.5) * span * 2;
      params[key] = clampValueForKey(key, current + offset);
    } else {
      params[key] = clampValueForKey(key, schema.min + Math.random() * (schema.max - schema.min));
    }
  });
}

export function runDispersionSchemaSelfTest() {
  const sample = withDispersionDefaults({
    opacityBase: 0.25,
    warpFrom: 'mid',
    warpOnBeat: false,
    travelModulo: 640,
  });
  const serialized = serializeDispersion(sample);
  const hydrated = deserializeDispersion(serialized);
  const mismatches = [];
  Object.keys(serialized).forEach((key) => {
    if (serialized[key] !== hydrated[key]) mismatches.push(key);
  });
  return { mismatches, serialized };
}

try {
  const testResult = runDispersionSchemaSelfTest();
  if (testResult.mismatches.length && typeof console !== 'undefined') {
    console.warn('Dispersion schema self-test mismatches', testResult.mismatches);
  }
} catch (_) {
  // Ignore test failures in production runtime; surfaced via tooling.
}
