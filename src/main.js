import { initScene } from './scene.js';
import { AudioEngine } from './audio.js';
import { initSettingsUI } from './settings-ui.js';
import { printFeatureMatrix } from './feature.js';

// Only print feature matrix when ?debug is present
if (new URLSearchParams(location.search).has('debug')) {
  printFeatureMatrix();
}

const sceneApi = initScene();
const audio = new AudioEngine();
// Expose audio engine globally for scene webcam startup
try { window.__audioEngineRef = audio; } catch(_) {}

// UI hookups (robust against UI load failures)
let ui;
try {
  ui = initSettingsUI({
  sceneApi,
  audioEngine: audio,
  onRequestSystemAudio: async () => {
    try {
      await audio.startSystemAudio();
    } catch (e) {
      // compact toast fallback
      try {
        let el = document.getElementById('toast');
        if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
        el.textContent = 'System audio unavailable. Try Chrome + screen audio, or use BlackHole.';
        el.classList.add('visible');
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => { el.classList.remove('visible'); }, 3200);
      } catch(_) {}
      console.error(e);
    }
  },
  onRequestMic: async () => {
    try {
      const devices = await audio.getInputDevices();
      let deviceId = undefined;
      if (devices && devices.length > 1) {
        const names = devices.map((d, i) => `${i+1}. ${d.label || 'Mic ' + (i+1)}`).join('\n');
        const choice = prompt(`Select input device by number:\n${names}`);
        const idx = parseInt(choice, 10) - 1;
        if (!Number.isNaN(idx) && devices[idx]) deviceId = devices[idx].deviceId;
      }
      await audio.startMic(deviceId);
    } catch (e) {
      try {
        let el = document.getElementById('toast');
        if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
        el.textContent = 'Microphone capture failed or was denied.';
        el.classList.add('visible');
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => { el.classList.remove('visible'); }, 2800);
      } catch(_) {}
      console.error(e);
    }
  },
  // Webcam controls
  onRequestWebcam: async () => {
    try {
      await sceneApi.startWebcam();
    } catch (e) {
      alert('Webcam access failed or was denied.'); console.error(e);
    }
  },
  onStopWebcam: () => {
    try { sceneApi.stopWebcam(); } catch(_) {}
  },
  onRequestFile: async (file) => {
    try {
      if (!file) {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = 'audio/*'; input.onchange = async () => { const f = input.files?.[0]; if (f) await audio.loadFile(f); };
        input.click();
      } else {
        await audio.loadFile(file);
      }
    } catch (e) {
      try {
        let el = document.getElementById('toast');
        if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
        el.textContent = 'Audio file load failed.';
        el.classList.add('visible');
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => { el.classList.remove('visible'); }, 2600);
      } catch(_) {}
      console.error(e);
    }
  },
  onStopAudio: () => audio.stop(),
  onScreenshot: () => {
    try {
      const dataUrl = sceneApi.state.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a'); a.href = dataUrl; a.download = 'cosmic-anomaly.png'; a.click();
    } catch (e) { console.error(e); }
  },
});
} catch (e) {
  console.error('UI failed to initialize, continuing without control panel.', e);
  ui = { updateFpsLabel: () => {}, updateBpmLabel: () => {}, updateTapAndDrift: () => {}, updateDriftDetails: () => {} };
}

// Theme is initialized inside scene init; avoid duplicate initial set

// Resize & mouse
window.addEventListener('resize', sceneApi.onResize);
window.addEventListener('mousemove', sceneApi.onMouseMove);

// Pause rendering/audio when tab is hidden
let isPaused = false;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    isPaused = true;
    lastTime = performance.now();
    try { await audio.ctx?.suspend?.(); } catch (_) {}
  } else {
    isPaused = false;
    lastTime = performance.now();
    try { await audio.ctx?.resume?.(); } catch (_) {}
  }
});

// Main loop
let lastTime = performance.now();
let fpsFrames = 0, fpsElapsedMs = 0, fpsLast = performance.now();
let autoFrames = 0, autoElapsedMs = 0, autoLast = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  if (isPaused) {
    lastTime = now; fpsLast = now; autoLast = now;
    return;
  }
  const dt = (now - lastTime) / 1000; lastTime = now;

  const features = audio.update();
  sceneApi.update(features);

  // Ensure the core visuals exist (defensive safety if anything failed earlier)
  if (!sceneApi.state.coreSphere || !sceneApi.state.orbitRings) {
    try { sceneApi.rebuildParticles(); } catch(_) {}
  }

  // Update BPM label and tap/drift (if available)
  if (features && ui.updateBpmLabel) ui.updateBpmLabel(features.bpm);
  if (features && ui.updateTapAndDrift) ui.updateTapAndDrift({ tapBpm: features.tapBpm, bpm: features.bpm });
  if (features && ui.updateDriftDetails) {
    ui.updateDriftDetails({
      tapBpm: features.tapBpm,
      beatGrid: features.beatGrid,
      aubioTempo: features.aubioTempoBpm,
      aubioConf: features.aubioTempoConf,
    });
  }

  // FPS tracking (separate counters)
  fpsFrames += 1; const frameMs = (now - fpsLast); fpsElapsedMs += frameMs; fpsLast = now;
  if (fpsElapsedMs > 500) { ui.updateFpsLabel((fpsFrames * 1000) / fpsElapsedMs); fpsFrames = 0; fpsElapsedMs = 0; }

  // Auto resolution every ~2s
  autoFrames += 1; const autoMs = (now - autoLast); autoElapsedMs += autoMs; autoLast = now;
  if (sceneApi.state.params.autoResolution && autoElapsedMs > 2000) {
    const fpsApprox = (autoFrames * 1000) / autoElapsedMs;
    const target = sceneApi.state.params.targetFps || 60;
    const currentPR = sceneApi.getPixelRatio();
    const desiredMaxPR = sceneApi.state.params.pixelRatioCap;
    let newPR = currentPR;
    if (fpsApprox < target - 5) newPR = Math.max(sceneApi.state.params.minPixelRatio, currentPR - 0.1);
    else if (fpsApprox > target + 5) newPR = Math.min(desiredMaxPR, currentPR + 0.1);
    if (Math.abs(newPR - currentPR) > 0.01) sceneApi.setPixelRatioCap(parseFloat(newPR.toFixed(2)));
    autoFrames = 0; autoElapsedMs = 0;
  }
}

animate();

// Drag-and-drop to load audio files
const dropOverlay = document.getElementById('drop-overlay');
['dragenter', 'dragover'].forEach(evt => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    if (dropOverlay) dropOverlay.classList.add('active');
  });
});
['dragleave', 'drop'].forEach(evt => {
  window.addEventListener(evt, (e) => {
    e.preventDefault();
    if (dropOverlay) dropOverlay.classList.remove('active');
  });
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('audio/')) {
    try {
      await audio.loadFile(file);
    } catch (err) {
      console.error('Drop load failed', err);
      try {
        let el = document.getElementById('toast');
        if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
        el.textContent = 'Audio file load failed.';
        el.classList.add('visible');
        clearTimeout(window.__toastTimer);
        window.__toastTimer = setTimeout(() => { el.classList.remove('visible'); }, 2600);
      } catch(_) {}
    }
  }
});

// System audio help button
document.getElementById('open-system-audio-help')?.addEventListener('click', () => {
  const msg = 'Chrome: Click "System" in the UI → select "Entire Screen" → enable "Share system audio".\n\nIf unavailable, install BlackHole (virtual audio device), set Mac output to BlackHole, then select BlackHole as your Mic input in the UI.';
  try {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => { el.classList.remove('visible'); }, 5200);
  } catch (_) {
    alert(msg);
  }
});
