import {
  withDispersionDefaults,
  serializeDispersion,
} from './dispersion-config.js';

function ensureDispersionParams(sceneApi) {
  if (!sceneApi?.state) return {};
  if (!sceneApi.state.params) sceneApi.state.params = {};
  const existing = sceneApi.state.params.dispersion || {};
  const merged = withDispersionDefaults(existing);
  sceneApi.state.params.dispersion = merged;
  return merged;
}

export function capturePresetSnapshot({ sceneApi, audioEngine }) {
  if (!sceneApi || !audioEngine) {
    throw new Error('capturePresetSnapshot requires sceneApi and audioEngine');
  }

  ensureDispersionParams(sceneApi);
  const params = sceneApi.state?.params || {};

  return {
    meta: {
      capturedAt: Date.now(),
      visualMode: params.visualMode || 'overlay',
    },
    audio: {
      gain: audioEngine.gainNode?.gain?.value || 1,
      sensitivity: audioEngine.sensitivity,
      smoothing: audioEngine.smoothing,
      fftSize: audioEngine.fftSize,
      lowHz: audioEngine.bandSplit?.low,
      midHz: audioEngine.bandSplit?.mid,
      subHz: audioEngine.bandSplit?.sub,
      beatCooldown: audioEngine.beatCooldownMs || audioEngine.beatRefractoryMs,
      envAttack: audioEngine.envAttack,
      envRelease: audioEngine.envRelease,
      agcEnabled: !!audioEngine.bandAGCEnabled,
      agcDecay: audioEngine.bandAGCDecay,
      drop: {
        enabled: !!audioEngine.dropEnabled,
        flux: audioEngine.dropFluxThresh,
        bass: audioEngine.dropBassThresh,
        centroidSlope: audioEngine.dropCentroidSlopeThresh,
        minBeats: audioEngine.dropMinBeats,
        cooldownMs: audioEngine.dropCooldownMs,
        barGateEnabled: !!audioEngine.dropBarGatingEnabled,
        beatsPerBar: audioEngine.dropGateBeatsPerBar,
        downbeatToleranceMs: audioEngine.dropDownbeatGateToleranceMs,
        useBassFlux: !!audioEngine.dropUseBassFlux,
        autoThresholds: !!audioEngine.autoDropThresholdsEnabled,
      },
    },
    visuals: {
      theme: params.theme,
      fogDensity: params.fogDensity,
      bloomBase: params.bloomStrengthBase,
      bloomReactive: params.bloomReactiveGain,
      pixelRatio: params.pixelRatioCap,
      autoRotate: params.autoRotate,
      particleDensity: params.particleDensity,
      performanceMode: params.performanceMode,
      useHdrBackground: params.useHdrBackground,
      visualMode: params.visualMode,
      enableDispersion: params.enableDispersion,
      dispersion: serializeDispersion(ensureDispersionParams(sceneApi)),
    },
    mapping: { ...(params.map || {}) },
    explosion: {
      onBeat: params.explosion?.onBeat,
      cooldownMs: params.explosion?.cooldownMs,
      durationMs: sceneApi.state?.explosionDuration,
    },
  };
}

export function applyPresetSnapshot(snapshot, { sceneApi, audioEngine, silent = false, notify } = {}) {
  if (!snapshot) return;
  if (!sceneApi || !audioEngine) {
    throw new Error('applyPresetSnapshot requires sceneApi and audioEngine');
  }

  const toast = (!silent && notify) || (!silent && typeof window !== 'undefined' && typeof window.showToast === 'function' && window.showToast);

  try {
    if (snapshot.visuals?.theme) sceneApi.changeTheme(snapshot.visuals.theme);
    if (typeof snapshot.visuals?.fogDensity === 'number') sceneApi.state.scene.fog.density = snapshot.visuals.fogDensity;
    if (typeof snapshot.visuals?.bloomBase === 'number') sceneApi.state.params.bloomStrengthBase = snapshot.visuals.bloomBase;
    if (typeof snapshot.visuals?.bloomReactive === 'number') sceneApi.state.params.bloomReactiveGain = snapshot.visuals.bloomReactive;
    if (typeof snapshot.visuals?.pixelRatio === 'number') sceneApi.setPixelRatioCap(snapshot.visuals.pixelRatio);
    if (typeof snapshot.visuals?.autoRotate === 'number') sceneApi.state.params.autoRotate = snapshot.visuals.autoRotate;
    if (typeof snapshot.visuals?.particleDensity === 'number') {
      sceneApi.state.params.particleDensity = snapshot.visuals.particleDensity;
      sceneApi.rebuildParticles();
    }
    if (typeof snapshot.visuals?.useHdrBackground === 'boolean') {
      sceneApi.state.params.useHdrBackground = snapshot.visuals.useHdrBackground;
      sceneApi.changeTheme(sceneApi.state.params.theme);
    }
    if (typeof snapshot.visuals?.visualMode === 'string') {
      sceneApi.state.params.visualMode = snapshot.visuals.visualMode;
      if (typeof sceneApi.setVisualMode === 'function') sceneApi.setVisualMode(snapshot.visuals.visualMode);
    }
    if (typeof snapshot.visuals?.enableDispersion === 'boolean') sceneApi.state.params.enableDispersion = snapshot.visuals.enableDispersion;
    if (snapshot.visuals?.dispersion && typeof snapshot.visuals.dispersion === 'object') {
      const merged = withDispersionDefaults({
        ...sceneApi.state.params.dispersion,
        ...snapshot.visuals.dispersion,
      });
      sceneApi.state.params.dispersion = merged;
    }

    if (snapshot.audio) {
      if (typeof snapshot.audio.gain === 'number') audioEngine.setGain(snapshot.audio.gain);
      if (typeof snapshot.audio.sensitivity === 'number') audioEngine.setSensitivity(snapshot.audio.sensitivity);
      if (typeof snapshot.audio.smoothing === 'number') audioEngine.setSmoothing(snapshot.audio.smoothing);
      if (typeof snapshot.audio.fftSize === 'number') audioEngine.setFFTSize(snapshot.audio.fftSize);
      if (typeof snapshot.audio.lowHz === 'number' && typeof snapshot.audio.midHz === 'number') audioEngine.setBandSplit(snapshot.audio.lowHz, snapshot.audio.midHz);
      if (typeof snapshot.audio.subHz === 'number') audioEngine.setSubHz(snapshot.audio.subHz);
      if (typeof snapshot.audio.beatCooldown === 'number') audioEngine.setBeatCooldown(snapshot.audio.beatCooldown);
      if (typeof snapshot.audio.envAttack === 'number') audioEngine.setEnvAttack(snapshot.audio.envAttack);
      if (typeof snapshot.audio.envRelease === 'number') audioEngine.setEnvRelease(snapshot.audio.envRelease);
      if (typeof snapshot.audio.noiseGateEnabled === 'boolean') audioEngine.setNoiseGateEnabled(snapshot.audio.noiseGateEnabled);
      if (typeof snapshot.audio.noiseGateThreshold === 'number') audioEngine.setNoiseGateThreshold(snapshot.audio.noiseGateThreshold);
      if (typeof snapshot.audio.agcEnabled === 'boolean') audioEngine.setBandAgcEnabled(snapshot.audio.agcEnabled);
      if (typeof snapshot.audio.agcDecay === 'number') audioEngine.setBandAgcDecay(snapshot.audio.agcDecay);
      if (snapshot.audio.drop) {
        if (typeof snapshot.audio.drop.enabled === 'boolean') audioEngine.setDropEnabled(snapshot.audio.drop.enabled);
        if (typeof snapshot.audio.drop.flux === 'number') audioEngine.setDropFluxThresh(snapshot.audio.drop.flux);
        if (typeof snapshot.audio.drop.bass === 'number') audioEngine.setDropBassThresh(snapshot.audio.drop.bass);
        if (typeof snapshot.audio.drop.centroidSlope === 'number') audioEngine.setDropCentroidSlopeThresh(snapshot.audio.drop.centroidSlope);
        if (typeof snapshot.audio.drop.minBeats === 'number') audioEngine.setDropMinBeats(snapshot.audio.drop.minBeats);
        if (typeof snapshot.audio.drop.cooldownMs === 'number') audioEngine.setDropCooldownMs(snapshot.audio.drop.cooldownMs);
        if (typeof snapshot.audio.drop.barGateEnabled === 'boolean') audioEngine.setDropBarGatingEnabled(snapshot.audio.drop.barGateEnabled);
        if (typeof snapshot.audio.drop.beatsPerBar === 'number') audioEngine.setDropGateBeatsPerBar(snapshot.audio.drop.beatsPerBar);
        if (typeof snapshot.audio.drop.downbeatToleranceMs === 'number') audioEngine.setDropDownbeatToleranceMs(snapshot.audio.drop.downbeatToleranceMs);
        if (typeof snapshot.audio.drop.useBassFlux === 'boolean') audioEngine.setDropUseBassFlux(snapshot.audio.drop.useBassFlux);
        if (typeof snapshot.audio.drop.autoThresholds === 'boolean') audioEngine.setAutoDropThresholdsEnabled(snapshot.audio.drop.autoThresholds);
      }
    }

    if (snapshot.mapping) Object.assign(sceneApi.state.params.map, snapshot.mapping);
    if (snapshot.explosion) {
      if (typeof snapshot.explosion.onBeat === 'boolean') sceneApi.state.params.explosion.onBeat = snapshot.explosion.onBeat;
      if (typeof snapshot.explosion.cooldownMs === 'number') sceneApi.state.params.explosion.cooldownMs = snapshot.explosion.cooldownMs;
      if (typeof snapshot.explosion.durationMs === 'number') sceneApi.state.explosionDuration = snapshot.explosion.durationMs;
    }

    if (typeof toast === 'function') {
      try { toast('Preset applied'); } catch (_) {}
    }
  } catch (err) {
    console.error('Failed to apply preset snapshot', err);
    if (typeof toast === 'function') {
      try { toast('Preset apply failed'); } catch (_) {}
    }
  }
}

