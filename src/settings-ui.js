// New glass settings UI (drawer + tabs) — no external UI lib
// Exports: initSettingsUI({ sceneApi, audioEngine, onScreenshot })

export function initSettingsUI({ sceneApi, audioEngine, onScreenshot }) {
  const root = document.getElementById('settings-root');
  const drawer = document.getElementById('settings-drawer');
  const overlay = document.getElementById('settings-overlay');
  const tabsEl = document.getElementById('settings-tabs');
  const content = document.getElementById('settings-content');
  const btnOpen = document.getElementById('open-settings-btn');
  const btnClose = document.getElementById('settings-close');
  const btnCloseFooter = document.getElementById('settings-close-footer');
  const btnReset = document.getElementById('settings-reset');
  const btnSavePreset = document.getElementById('settings-save-preset');

  const tabs = [
    { id: 'quick', label: 'Quick' },
    { id: 'source', label: 'Source' },
    { id: 'audio', label: 'Audio' },
    { id: 'visuals', label: 'Visuals' },
    { id: 'morph', label: 'Morph' },
    { id: 'mapping', label: 'Mapping' },
    { id: 'tempo', label: 'Tempo' },
    { id: 'presets', label: 'Presets' },
    { id: 'session', label: 'Session' },
  ];

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

  btnOpen.addEventListener('click', open);
  overlay.addEventListener('click', close);
  btnClose.addEventListener('click', close);
  btnCloseFooter.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (root.style.display === 'block' && root.classList.contains('open')) close(); else open();
    }
  });

  // Helpers
  function showToast(message) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = message; el.classList.add('visible');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => { el.classList.remove('visible'); }, 2600);
  }

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

  function fieldRow(label, control) {
    const row = h('div', { class: 'row' }, [
      h('div', { class: 'label' }, label),
      h('div', { class: 'control' }, control),
    ]);
    return row;
  }

  function slider({ min, max, step, value, oninput }) {
    const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    input.addEventListener('input', (e) => oninput(parseFloat(input.value)));
    return input;
  }

  function select(opts, value, onchange) {
    const s = h('select');
    for (const { label, value: val } of opts) s.appendChild(h('option', { value: String(val), selected: val === value ? 'true' : undefined }, label));
    s.addEventListener('change', () => onchange(s.value));
    return s;
  }

  function button(title, onclick) { return h('button', { onClick: onclick }, title); }

  // Tab builders
  async function buildSource() {
    const container = h('div', { class: 'section' });
    container.appendChild(h('div', { class: 'section-title' }, 'Source'));
    container.appendChild(button('Mic', async () => {
      try { await audioEngine.startMic(localStorage.getItem('cosmic_mic_device_id') || undefined); } catch(e){ showToast('Mic denied/unavailable'); }
    }));
    container.appendChild(button('System', async () => {
      try { await audioEngine.startSystemAudio(); } catch(e){ showToast('System audio unavailable (Chrome recommended)'); }
    }));
    container.appendChild(button('File', async () => {
      try { const input = document.createElement('input'); input.type = 'file'; input.accept = 'audio/*'; input.onchange = async () => { const f = input.files?.[0]; if (f) await audioEngine.loadFile(f); }; input.click(); } catch(e){ showToast('File load failed'); }
    }));
    container.appendChild(button('Stop', () => { try { audioEngine.stop(); } catch(_){} }));

    // Devices dropdown
    const deviceRow = h('div', { class: 'section' });
    deviceRow.appendChild(h('div', { class: 'section-title' }, 'Input Device'));
    const devices = await audioEngine.getInputDevices().catch(() => []);
    const opts = devices.map((d, i) => ({ label: d.label || `Mic ${i+1}`, value: d.deviceId || '' }));
    const stored = localStorage.getItem('cosmic_mic_device_id') || '';
    const dd = select(opts, stored, async (id) => {
      try { localStorage.setItem('cosmic_mic_device_id', id); await audioEngine.startMic(id || undefined); } catch(_) { showToast('Mic switch failed'); }
    });
    deviceRow.appendChild(dd);
    deviceRow.appendChild(button('Refresh', async () => { render('source'); showToast('Device list refreshed'); }));

    container.appendChild(deviceRow);
    return container;
  }

  function buildAudio() {
    const st = {
      gain: 1.0,
      sensitivity: audioEngine.sensitivity || 1.0,
      smoothing: audioEngine.smoothing || 0.6,
      fftSize: audioEngine.fftSize || 2048,
      lowHz: audioEngine.bandSplit?.low || 200,
      midHz: audioEngine.bandSplit?.mid || 2000,
      beatCooldown: audioEngine.beatCooldownMs || 500,
    };
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Audio') ]);
    el.appendChild(fieldRow('Gain', slider({ min: 0.1, max: 4.0, step: 0.1, value: st.gain, oninput: (v) => audioEngine.setGain(v) })));
    el.appendChild(fieldRow('Beat Sens', slider({ min: 0.0, max: 2.0, step: 0.05, value: st.sensitivity, oninput: (v) => audioEngine.setSensitivity(v) })));
    el.appendChild(fieldRow('Smoothing', slider({ min: 0.0, max: 0.95, step: 0.05, value: st.smoothing, oninput: (v) => audioEngine.setSmoothing(v) })));
    el.appendChild(fieldRow('FFT Size', select([
      512,1024,2048,4096,8192,16384,32768
    ].map(n => ({ label: String(n), value: n })), st.fftSize, (v) => audioEngine.setFFTSize(parseInt(v,10)) )));
    el.appendChild(fieldRow('Bass < Hz', slider({ min: 60, max: 400, step: 10, value: st.lowHz, oninput: (v) => audioEngine.setBandSplit(v, st.midHz=(st.midHz||2000)) })));
    el.appendChild(fieldRow('Mid < Hz', slider({ min: 800, max: 5000, step: 50, value: st.midHz, oninput: (v) => audioEngine.setBandSplit(st.lowHz=(st.lowHz||200), v) })));
    el.appendChild(fieldRow('Beat Cooldown', slider({ min: 100, max: 1500, step: 50, value: st.beatCooldown, oninput: (v) => audioEngine.setBeatCooldown(v) })));
    return el;
  }

  function buildVisuals() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Visuals') ]);
    // Theme
    const themeOpts = ['nebula','sunset','forest','aurora'].map(t => ({ label: t, value: t }));
    el.appendChild(fieldRow('Theme', select(themeOpts, sceneApi.state.params.theme, (v) => sceneApi.changeTheme(v))));
    el.appendChild(fieldRow('HDR Bg', checkbox(sceneApi.state.params.useHdrBackground, (v)=>{ sceneApi.state.params.useHdrBackground = v; sceneApi.changeTheme(sceneApi.state.params.theme); })));
    el.appendChild(fieldRow('Fog', slider({ min: 0.0, max: 0.02, step: 0.0005, value: sceneApi.state.params.fogDensity, oninput: (v)=>{ sceneApi.state.scene.fog.density = v; } })));
    el.appendChild(fieldRow('Bloom Base', slider({ min: 0.0, max: 3.0, step: 0.05, value: sceneApi.state.params.bloomStrengthBase, oninput: (v)=>{ sceneApi.state.params.bloomStrengthBase = v; } })));
    el.appendChild(fieldRow('Bloom Reactive', slider({ min: 0.0, max: 2.5, step: 0.05, value: sceneApi.state.params.bloomReactiveGain, oninput: (v)=>{ sceneApi.state.params.bloomReactiveGain = v; } })));
    el.appendChild(fieldRow('Pixel Ratio', slider({ min: 0.5, max: 2.0, step: 0.1, value: sceneApi.state.params.pixelRatioCap, oninput: (v)=> sceneApi.setPixelRatioCap(v) })));
    el.appendChild(fieldRow('Auto Rotate', slider({ min: 0.0, max: 0.01, step: 0.0001, value: sceneApi.state.params.autoRotate, oninput: (v)=>{ sceneApi.state.params.autoRotate = v; } })));
    el.appendChild(fieldRow('Particles', slider({ min: 0.25, max: 1.5, step: 0.05, value: sceneApi.state.params.particleDensity, oninput: (v)=>{ sceneApi.state.params.particleDensity = v; sceneApi.rebuildParticles(); } })));
    el.appendChild(fieldRow('Sparks', checkbox(sceneApi.state.params.enableSparks, (v)=> sceneApi.setEnableSparks(v))));
    el.appendChild(fieldRow('Lens Flare', checkbox(sceneApi.state.params.useLensflare, (v)=> sceneApi.setUseLensflare(v))));
    el.appendChild(fieldRow('Auto Res', checkbox(sceneApi.state.params.autoResolution, (v)=>{ sceneApi.state.params.autoResolution = v; } )));
    el.appendChild(fieldRow('Target FPS', slider({ min: 30, max: 90, step: 1, value: sceneApi.state.params.targetFps, oninput: (v)=>{ sceneApi.state.params.targetFps = v; } })));
    el.appendChild(fieldRow('Min PR', slider({ min: 0.4, max: 1.5, step: 0.05, value: sceneApi.state.params.minPixelRatio, oninput: (v)=>{ sceneApi.state.params.minPixelRatio = v; } })));
    // Actions
    el.appendChild(fieldRow('Screenshot', button('Capture', onScreenshot)));
    el.appendChild(fieldRow('Explosion', button('Trigger', ()=> sceneApi.triggerExplosion())));
    return el;
  }

  function checkbox(value, onchange) {
    const c = h('input', { type: 'checkbox' }); c.checked = !!value; c.addEventListener('change', ()=> onchange(!!c.checked)); return c;
  }

  function buildMorph() {
    const p = sceneApi.state.params.morph;
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Morph (Webcam)') ]);
    el.appendChild(fieldRow('Webcam', h('div', {}, [
      button('Start', async ()=>{ try { await sceneApi.startWebcam(); } catch(_) { showToast('Webcam denied'); } }),
      button('Stop', ()=>{ try { sceneApi.stopWebcam(); } catch(_) {} })
    ])));
    el.appendChild(fieldRow('Morph on Beat', checkbox(p.onBeat, (v)=> sceneApi.setMorphOnBeat(v))));
    el.appendChild(fieldRow('Amount', slider({ min: 0.0, max: 1.0, step: 0.01, value: p.amount, oninput: (v)=> sceneApi.setMorphAmount(v) })));
    el.appendChild(fieldRow('Duration', slider({ min: 100, max: 2000, step: 25, value: p.durationMs, oninput: (v)=> sceneApi.setMorphDuration(v) })));
    el.appendChild(fieldRow('Hold', slider({ min: 0, max: 1000, step: 25, value: p.holdMs, oninput: (v)=> sceneApi.setMorphHold(v) })));
    el.appendChild(fieldRow('Grid Depth Z', slider({ min: -1.0, max: 1.0, step: 0.01, value: 0.0, oninput: (v)=> sceneApi.setVideoDepth(v) })));
    el.appendChild(fieldRow('Mirror', checkbox(true, (v)=> { try { audioEngine.setWebcamMirror(v); } catch(_) {} } )));
    el.appendChild(fieldRow('Manual', h('div', {}, [ checkbox(p.useManual, (v)=>{ sceneApi.state.params.morph.useManual = v; }), slider({ min: 0, max: 1, step: 0.01, value: p.manual, oninput: (v)=>{ sceneApi.state.params.morph.manual = v; } }) ])));
    return el;
  }

  function buildMapping() {
    const m = sceneApi.state.params.map;
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Mapping') ]);
    el.appendChild(fieldRow('Sphere Size <- RMS', slider({ min: 0.0, max: 1.5, step: 0.05, value: m.sizeFromRms, oninput: (v)=>{ m.sizeFromRms = v; } })));
    el.appendChild(fieldRow('Ring Scale <- Bands', slider({ min: 0.0, max: 1.0, step: 0.05, value: m.ringScaleFromBands, oninput: (v)=>{ m.ringScaleFromBands = v; } })));
    el.appendChild(fieldRow('Ring Speed <- Bands', slider({ min: 0.0, max: 3.0, step: 0.1, value: m.ringSpeedFromBands, oninput: (v)=>{ m.ringSpeedFromBands = v; } })));
    el.appendChild(fieldRow('Cam Shake <- Beat', slider({ min: 0.0, max: 1.0, step: 0.05, value: m.cameraShakeFromBeat, oninput: (v)=>{ m.cameraShakeFromBeat = v; } })));
    el.appendChild(fieldRow('Bloom Color <- Centroid', slider({ min: 0.0, max: 1.0, step: 0.05, value: m.colorBoostFromCentroid, oninput: (v)=>{ m.colorBoostFromCentroid = v; } })));
    el.appendChild(fieldRow('Core Bright <- RMS', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.sphereBrightnessFromRms, oninput: (v)=>{ m.sphereBrightnessFromRms = v; } })));
    el.appendChild(fieldRow('Core Noise <- Mid', slider({ min: 0.0, max: 2.5, step: 0.05, value: m.sphereNoiseFromMid, oninput: (v)=>{ m.sphereNoiseFromMid = v; } })));
    el.appendChild(fieldRow('Rings Noise <- Bands', slider({ min: 0.0, max: 1.5, step: 0.05, value: m.ringNoiseFromBands, oninput: (v)=>{ m.ringNoiseFromBands = v; } })));
    el.appendChild(fieldRow('Light Intensity <- Bass', slider({ min: 0.0, max: 4.0, step: 0.1, value: m.lightIntensityFromBass, oninput: (v)=>{ m.lightIntensityFromBass = v; } })));
    el.appendChild(fieldRow('Bass Weight', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.bandWeightBass, oninput: (v)=>{ m.bandWeightBass = v; } })));
    el.appendChild(fieldRow('Mid Weight', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.bandWeightMid, oninput: (v)=>{ m.bandWeightMid = v; } })));
    el.appendChild(fieldRow('Treble Weight', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.bandWeightTreble, oninput: (v)=>{ m.bandWeightTreble = v; } })));
    el.appendChild(fieldRow('Stars <- Treble', slider({ min: 0.0, max: 3.0, step: 0.05, value: m.starTwinkleFromTreble, oninput: (v)=>{ m.starTwinkleFromTreble = v; } })));
    el.appendChild(fieldRow('Ring Tilt <- Bass', slider({ min: 0.0, max: 2.0, step: 0.05, value: m.ringTiltFromBass, oninput: (v)=>{ m.ringTiltFromBass = v; } })));
    return el;
  }

  function buildTempo() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Tempo Assist') ]);
    el.appendChild(fieldRow('Enable', checkbox(audioEngine.tempoAssistEnabled, (v)=> audioEngine.setTempoAssistEnabled(v) )));
    el.appendChild(fieldRow('Auto BPM', h('div', { id: 'auto-bpm' }, String(audioEngine.getBpm() || 0))));
    el.appendChild(button('Recalculate BPM', async ()=>{ await audioEngine.recalcBpm(); document.getElementById('auto-bpm').textContent = String(audioEngine.getBpm() || 0); }));

    const tap = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Tap Tempo') ]);
    tap.appendChild(fieldRow('Tap BPM', h('div', { id: 'tap-bpm' }, '0')));
    tap.appendChild(h('div', {}, [ button('Tap', ()=>{ audioEngine.tapBeat(); document.getElementById('tap-bpm').textContent = String(audioEngine.getTapBpm()||0); }), button('Reset', ()=>{ audioEngine.resetTapTempo(); document.getElementById('tap-bpm').textContent = '0'; }) ]));
    tap.appendChild(h('div', {}, [ button('×0.5', ()=>{ audioEngine.nudgeTapMultiplier(0.5); document.getElementById('tap-bpm').textContent = String(audioEngine.getTapBpm()||0); }), button('×2', ()=>{ audioEngine.nudgeTapMultiplier(2.0); document.getElementById('tap-bpm').textContent = String(audioEngine.getTapBpm()||0); }) ]));
    tap.appendChild(fieldRow('Quantize to Tap', checkbox(audioEngine.tapQuantizeEnabled, (v)=> audioEngine.setTapQuantizeEnabled(v) )));
    tap.appendChild(h('div', {}, [ button('+10 ms', ()=> audioEngine.nudgeQuantizePhase(10)), button('-10 ms', ()=> audioEngine.nudgeQuantizePhase(-10)), button('+25 ms', ()=> audioEngine.nudgeQuantizePhase(25)), button('-25 ms', ()=> audioEngine.nudgeQuantizePhase(-25)), button('Align Now', ()=> audioEngine.alignQuantizePhase()) ]));
    el.appendChild(tap);
    return el;
  }

  function buildPresets() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Presets') ]);
    el.appendChild(button('Reset to Defaults', ()=> { try { window.location.reload(); } catch(_) {} }));
    el.appendChild(button('Save Preset', ()=> {
      const name = prompt('Preset name'); if (!name) return;
      try {
        const preset = collectPreset();
        const all = loadAllPresets(); all[name] = preset; saveAllPresets(all); showToast('Preset saved');
      } catch(_) { showToast('Save failed'); }
    }));
    el.appendChild(button('Load Preset', ()=> {
      const all = loadAllPresets(); const names = Object.keys(all); if (!names.length) { showToast('No presets'); return; }
      const choice = prompt('Choose preset by name:\n' + names.join('\n')); if (!choice || !all[choice]) return;
      applyPreset(all[choice]); showToast('Preset loaded');
    }));
    el.appendChild(button('Export Presets', ()=> {
      const all = loadAllPresets(); const data = JSON.stringify(all, null, 2);
      const blob = new Blob([data], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cosmic-presets.json'; a.click();
    }));
    el.appendChild(button('Import Presets', ()=> {
      const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/json';
      input.onchange = async ()=> { const f = input.files?.[0]; if (!f) return; const txt = await f.text(); try { const obj = JSON.parse(txt); const all = loadAllPresets(); saveAllPresets({ ...all, ...obj }); showToast('Imported'); } catch { showToast('Invalid JSON'); } };
      input.click();
    }));
    return el;
  }

  function buildSession() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Session') ]);
    const fpsLabel = h('div', { id: 'fps-label' }, '0');
    el.appendChild(fieldRow('FPS', fpsLabel));
    el.appendChild(fieldRow('Screenshot', button('Capture', onScreenshot)));
    return el;
  }

  function collectPreset() {
    const p = sceneApi.state.params;
    return {
      audio: { gain: audioEngine.gainNode?.gain?.value || 1, sensitivity: audioEngine.sensitivity, smoothing: audioEngine.smoothing, fftSize: audioEngine.fftSize, lowHz: audioEngine.bandSplit.low, midHz: audioEngine.bandSplit.mid, beatCooldown: audioEngine.beatCooldownMs },
      visuals: { theme: p.theme, fogDensity: p.fogDensity, bloomBase: p.bloomStrengthBase, bloomReactive: p.bloomReactiveGain, pixelRatio: p.pixelRatioCap, autoRotate: p.autoRotate, particleDensity: p.particleDensity, performanceMode: p.performanceMode, useHdrBackground: p.useHdrBackground },
      mapping: { ...p.map },
      explosion: { onBeat: p.explosion.onBeat, cooldownMs: p.explosion.cooldownMs, durationMs: sceneApi.state.explosionDuration },
    };
  }
  function loadAllPresets() { try { return JSON.parse(localStorage.getItem('cosmic_presets')||'{}'); } catch { return {}; } }
  function saveAllPresets(obj) { localStorage.setItem('cosmic_presets', JSON.stringify(obj)); }
  function applyPreset(p) {
    if (!p) return;
    try {
      if (p.visuals?.theme) sceneApi.changeTheme(p.visuals.theme);
      if (typeof p.visuals?.fogDensity === 'number') sceneApi.state.scene.fog.density = p.visuals.fogDensity;
      if (typeof p.visuals?.bloomBase === 'number') sceneApi.state.params.bloomStrengthBase = p.visuals.bloomBase;
      if (typeof p.visuals?.bloomReactive === 'number') sceneApi.state.params.bloomReactiveGain = p.visuals.bloomReactive;
      if (typeof p.visuals?.pixelRatio === 'number') sceneApi.setPixelRatioCap(p.visuals.pixelRatio);
      if (typeof p.visuals?.autoRotate === 'number') sceneApi.state.params.autoRotate = p.visuals.autoRotate;
      if (typeof p.visuals?.particleDensity === 'number') { sceneApi.state.params.particleDensity = p.visuals.particleDensity; sceneApi.rebuildParticles(); }
      if (typeof p.visuals?.useHdrBackground === 'boolean') { sceneApi.state.params.useHdrBackground = p.visuals.useHdrBackground; sceneApi.changeTheme(sceneApi.state.params.theme); }

      if (p.audio) {
        if (typeof p.audio.gain === 'number') audioEngine.setGain(p.audio.gain);
        if (typeof p.audio.sensitivity === 'number') audioEngine.setSensitivity(p.audio.sensitivity);
        if (typeof p.audio.smoothing === 'number') audioEngine.setSmoothing(p.audio.smoothing);
        if (typeof p.audio.fftSize === 'number') audioEngine.setFFTSize(p.audio.fftSize);
        if (typeof p.audio.lowHz === 'number' && typeof p.audio.midHz === 'number') audioEngine.setBandSplit(p.audio.lowHz, p.audio.midHz);
        if (typeof p.audio.beatCooldown === 'number') audioEngine.setBeatCooldown(p.audio.beatCooldown);
      }

      if (p.mapping) Object.assign(sceneApi.state.params.map, p.mapping);
      if (p.explosion) {
        if (typeof p.explosion.onBeat === 'boolean') sceneApi.state.params.explosion.onBeat = p.explosion.onBeat;
        if (typeof p.explosion.cooldownMs === 'number') sceneApi.state.params.explosion.cooldownMs = p.explosion.cooldownMs;
        if (typeof p.explosion.durationMs === 'number') sceneApi.state.explosionDuration = p.explosion.durationMs;
      }
      showToast('Preset applied');
    } catch(_) { showToast('Apply failed'); }
  }

  function buildQuick() {
    const el = h('div', { class: 'section' }, [ h('div', { class: 'section-title' }, 'Quick') ]);
    el.appendChild(buildAudio());
    el.appendChild(buildVisuals());
    return el;
  }

  const builders = {
    quick: buildQuick,
    source: buildSource,
    audio: buildAudio,
    visuals: buildVisuals,
    morph: buildMorph,
    mapping: buildMapping,
    tempo: buildTempo,
    presets: buildPresets,
    session: buildSession,
  };

  function render(tabId = 'quick') {
    tabsEl.replaceChildren();
    for (const t of tabs) {
      const b = h('button', { class: 'tab' + (t.id === tabId ? ' active' : ''), onClick: ()=> render(t.id) }, t.label);
      tabsEl.appendChild(b);
    }
    content.replaceChildren();
    const builder = builders[tabId];
    Promise.resolve(builder()).then((node) => { content.appendChild(node); });
  }

  btnReset.addEventListener('click', ()=> { try { window.location.reload(); } catch(_) {} });
  btnSavePreset.addEventListener('click', ()=> {
    const name = prompt('Preset name'); if (!name) return;
    const preset = collectPreset(); const all = loadAllPresets(); all[name] = preset; saveAllPresets(all); showToast('Preset saved');
  });

  render('quick');

  // external labels update (FPS etc.)
  function updateFpsLabel(v) {
    const n = document.getElementById('fps-label'); if (n) n.textContent = String(Math.round(v));
  }
  function updateBpmLabel(_) {}
  function updateTapAndDrift(_) {}
  function updateDriftDetails(_) {}

  return { open, close, updateFpsLabel, updateBpmLabel, updateTapAndDrift, updateDriftDetails };
}


