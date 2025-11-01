/**
 * Main Application Entry Point
 *
 * This is the central file that orchestrates the entire application.
 * Think of it like the conductor of an orchestra - it coordinates all the different
 * parts (audio engine, 3D scene, settings UI, synchronization) to work together.
 *
 * What this file does:
 * 1. Imports and initializes all major components (scene, audio, settings UI, sync)
 * 2. Sets up event handlers (window resize, mouse movement, drag-and-drop)
 * 3. Runs the main animation loop that updates everything every frame
 * 4. Handles WebSocket connection for sending audio features to TouchDesigner
 * 5. Manages pause/resume behavior when the browser tab is hidden/shown
 *
 * Data Flow:
 * - AudioEngine analyzes audio and produces features (beats, frequencies, etc.)
 * - These features flow to Scene (to animate visuals) and SyncCoordinator (to sync multiple windows)
 * - Features are also sent over WebSocket to OSC bridge (for TouchDesigner integration)
 * - Settings UI controls parameters and displays status information
 */

// Import all the major components we need
import { initScene } from './scene.js';           // 3D scene and rendering
import { AudioEngine } from './audio.js';          // Audio analysis and processing
import { initSettingsUI } from './settings-ui.js'; // Settings panel UI
import { SyncCoordinator } from './sync.js';      // Multi-window synchronization
import { printFeatureMatrix } from './feature.js'; // Browser capability detection
import { showToast } from './toast.js';           // Temporary notification messages
import { PresetManager } from './preset-manager.js';
import { openPresetLibraryWindow } from './preset-library-window.js';
import { PerformanceController } from './performance-pads.js';

// Debug mode: print browser feature support matrix when ?debug is in the URL
// This helps developers understand what capabilities are available
if (new URLSearchParams(location.search).has('debug')) {
  printFeatureMatrix();
}

// Initialize the 3D scene and get its API
// The scene handles all the visual rendering (particles, shaders, etc.)
const sceneApi = initScene();

// Create the audio engine that processes audio and extracts features
const audio = new AudioEngine();

// Create the sync coordinator for multi-window synchronization
// This allows multiple browser windows to stay in sync (control + projector mode)
const sync = new SyncCoordinator({ role: 'control', sceneApi });
// Webcam feature removed; no global exposure needed

// Preset manager orchestrates capture, persistence, and live preset operations
const presetManager = new PresetManager({ sceneApi, audioEngine: audio });

let presetLibraryUI = null;
const openPresetLibrary = () => {
  try {
    presetLibraryUI = openPresetLibraryWindow(presetManager, {
      onClose: () => { presetLibraryUI = null; },
      onError: (err) => {
        console.error('Failed to open preset library', err);
        try { showToast('Preset library popup blocked'); } catch (_) {}
      },
    });
  } catch (err) {
    console.error('Failed to open preset library', err);
    try { showToast('Preset library unavailable'); } catch (_) {}
  }
};
// Performance Pads (Phase 1: Pad 1 only)
// --------------------------------------
let performancePads;
try {
  performancePads = new PerformanceController({ sceneApi, sync });
  // Provide a per-frame deltas getter to the scene so it can blend with audio baseline
  sceneApi.setUniformDeltasProvider(() => performancePads.getDeltas());
} catch (_) {
  performancePads = { update: () => {}, getDeltas: () => null };
}


window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (event.repeat) return;
  const key = event.key || '';
  if (key !== 'L' && key !== 'l') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = (event.target && event.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
  event.preventDefault();
  openPresetLibrary();
});

// Initialize the settings UI
// This creates the settings panel that slides in from the right side
// We wrap it in a try-catch so the app continues working even if UI fails to load
let ui;
try {
  ui = initSettingsUI({
    sceneApi,           // Pass scene API so UI can control visuals
    audioEngine: audio, // Pass audio engine so UI can control audio
    syncCoordinator: sync, // Pass sync coordinator so UI can control synchronization
    presetManager,
    openPresetLibrary,
    
    // Callback: User clicked "Start System Audio" button
    // This attempts to capture system audio (what's playing on the computer)
    onRequestSystemAudio: async () => {
      try {
        await audio.startSystemAudio();
      } catch (e) {
        // If it fails, show a helpful error message
        try { showToast('System audio unavailable. Try Chrome + screen audio, or use BlackHole.', 3200); } catch(_) {}
        console.error(e);
      }
    },
    
    // Callback: User clicked "Start Microphone" button
    // This starts capturing audio from the microphone
    onRequestMic: async () => {
      try {
        // Use Settings → Source device list for selection (no prompts during show)
        // undefined means use default device
        await audio.startMic(undefined);
      } catch (e) {
        // If microphone access is denied or fails, show error
        try { showToast('Microphone capture failed or was denied.', 2800); } catch(_) {}
        console.error(e);
      }
    },
    
    // Callback: User wants to load an audio file
    // This either opens a file picker or loads a dropped file
    onRequestFile: async (file) => {
      try {
        if (!file) {
          // No file provided, so open a file picker dialog
          const input = document.createElement('input');
          input.type = 'file';           // File input
          input.accept = 'audio/*';      // Only accept audio files
          input.onchange = async () => {
            const f = input.files?.[0]; // Get the selected file
            if (f) await audio.loadFile(f); // Load it
          };
          input.click(); // Trigger the file picker
        } else {
          // File was provided (e.g., from drag-and-drop), load it directly
          await audio.loadFile(file);
        }
      } catch (e) {
        // If file loading fails, show error
        try { showToast('Audio file load failed.', 2600); } catch(_) {}
        console.error(e);
      }
    },
    
    // Callback: User clicked "Stop Audio" button
    // This stops all audio processing
    onStopAudio: () => audio.stop(),
    
    // Callback: User clicked "Screenshot" button
    // This captures the current frame as a PNG image
    onScreenshot: () => {
      try {
        // Get the canvas element from Three.js renderer
        const dataUrl = sceneApi.state.renderer.domElement.toDataURL('image/png');
        // Create a download link and trigger it
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'cosmic-anomaly.png'; // Filename
        a.click(); // Trigger download
      } catch (e) { console.error(e); }
    },
  });
} catch (e) {
  // If UI initialization fails, create a minimal stub so the app doesn't break
  console.error('UI failed to initialize, continuing without control panel.', e);
  ui = { 
    updateFpsLabel: () => {},      // No-op functions
    updateBpmLabel: () => {}, 
    updateTapAndDrift: () => {}, 
    updateDriftDetails: () => {} 
  };
}

// Theme is initialized inside scene init; avoid duplicate initial set

// WebSocket Feature Broadcaster
// =============================
// This section handles sending audio features to TouchDesigner via the OSC bridge.
// The bridge runs on localhost:8090 and converts WebSocket messages to OSC.
//
// Features sent include:
// - RMS (volume levels)
// - Frequency bands
// - Beat detection
// - BPM (tempo)
// - MFCC (audio characteristics)
// - Chroma (musical notes)
// - Pitch information

// WebSocket connection state tracking
let featureWs = null;                    // The WebSocket connection object
let featureWsConnected = false;          // Is the connection currently open?
let featureWsConnecting = false;         // Are we currently trying to connect?
let featureWsLastAttemptMs = 0;          // Timestamp of last connection attempt
let featureWsLastSendMs = 0;             // Timestamp of last feature send
let featureWsBackoffMs = 2500;           // Delay before retrying (exponential backoff, capped)
const FEATURE_WS_URL = 'ws://127.0.0.1:8090'; // WebSocket server URL (OSC bridge)

/**
 * Ensures the WebSocket connection is established.
 * 
 * This function tries to connect to the OSC bridge if we're not already connected
 * or connecting. It uses exponential backoff to avoid spamming connection attempts.
 *
 * @param {number} [nowMs] - Current timestamp (for rate limiting)
 */
function ensureFeatureWs(nowMs) {
  // Don't try if already connected or currently connecting
  if (featureWsConnected || featureWsConnecting) return;
  
  // Rate limit: don't try too often (respect backoff delay)
  if (nowMs && nowMs - featureWsLastAttemptMs < featureWsBackoffMs) return;
  
  // Record this attempt
  featureWsLastAttemptMs = nowMs || performance.now();
  
  try {
    featureWsConnecting = true;
    // Create new WebSocket connection
    const ws = new WebSocket(FEATURE_WS_URL);
    
    // Connection opened successfully
    ws.onopen = () => {
      featureWsConnected = true;
      featureWsConnecting = false;
      featureWsLastSendMs = 0; // Reset send timer
      featureWsBackoffMs = 2500; // Reset backoff on success
    };
    
    // Connection closed (will retry with backoff)
    ws.onclose = () => {
      featureWsConnected = false;
      featureWsConnecting = false;
      featureWs = null;
      // Increase backoff delay (exponential backoff, capped at 20 seconds)
      featureWsBackoffMs = Math.min(20000, Math.max(2500, featureWsBackoffMs * 1.6));
    };
    
    // Connection error - close it cleanly
    ws.onerror = () => { 
      try { ws.close(); } catch(_) {} 
    };
    
    featureWs = ws;
  } catch (_) {
    // If connection fails, reset state
    featureWsConnected = false;
    featureWsConnecting = false;
    featureWs = null;
  }
}

/**
 * Sends audio features over WebSocket to the OSC bridge.
 * 
 * This packages up all the audio analysis features and sends them to TouchDesigner.
 * Features are throttled to ~30Hz (33ms between sends) to avoid overwhelming the connection.
 *
 * @param {Object} features - Audio features object from AudioEngine
 * @param {number} nowMs - Current timestamp (for rate limiting)
 */
function sendFeaturesOverWs(features, nowMs) {
  // Don't send if not connected or no WebSocket
  if (!featureWsConnected || !featureWs) return;
  if (!features) return;
  
  // Rate limit: only send ~30 times per second (once every 33ms)
  if (nowMs - featureWsLastSendMs < 33) return;
  featureWsLastSendMs = nowMs;
  
  try {
    // Package up all the features we want to send
    const payload = {
      rms: features.rms,                    // Root mean square (overall volume)
      rmsNorm: features.rmsNorm,             // Normalized RMS (0-1)
      bandsEMA: features.bandsEMA,           // Frequency bands (exponentially smoothed)
      bandEnv: features.bandEnv,            // Frequency band envelopes
      bandNorm: features.bandNorm,          // Normalized frequency bands
      centroidNorm: features.centroidNorm,  // Spectral centroid (brightness, normalized)
      flux: features.flux,                  // Spectral flux (how much frequencies are changing)
      fluxMean: features.fluxMean,           // Average flux
      fluxStd: features.fluxStd,             // Standard deviation of flux
      beat: !!features.beat,                // Beat detected (boolean)
      drop: !!features.drop,                // Drop detected (boolean)
      isBuilding: !!features.isBuilding,    // Energy building up (boolean)
      buildLevel: features.buildLevel,      // How much energy is building (0-1)
      bpm: features.bpm,                    // Beats per minute (tempo)
      bpmConfidence: features.bpmConfidence, // How confident we are in the BPM (0-1)
      bpmSource: features.bpmSource,         // Where BPM came from ('tap', 'beatGrid', etc.)
      tapBpm: features.tapBpm,              // Manually tapped BPM
      mfcc: features.mfcc,                   // Mel-frequency cepstral coefficients (audio characteristics)
      chroma: features.chroma,               // Chroma features (musical note information)
      pitchHz: features.pitchHz,             // Detected pitch in Hz
      pitchConf: features.pitchConf,         // Pitch detection confidence (0-1)
      aubioTempoBpm: features.aubioTempoBpm, // BPM from Aubio library
      aubioTempoConf: features.aubioTempoConf, // Aubio confidence
      beatGrid: features.beatGrid ? {        // Beat grid information (if available)
        bpm: features.beatGrid.bpm,
        confidence: features.beatGrid.confidence
      } : null,
    };
    
    // Send as JSON message
    featureWs.send(JSON.stringify({ type: 'features', payload }));
  } catch (_) {
    // If send fails, silently ignore (connection will retry)
  }
}

// Window Event Handlers
// =====================

// Handle window resize - update the 3D scene to match new window size
window.addEventListener('resize', sceneApi.onResize);

// Handle mouse movement - update camera/interaction based on mouse position
window.addEventListener('mousemove', sceneApi.onMouseMove);

// Pause/Resume Management
// ======================
// When the browser tab is hidden, pause audio processing to save resources.
// When it becomes visible again, resume everything.

let isPaused = false; // Track if we're currently paused

// Listen for visibility changes (tab hidden/shown)
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    // Tab was hidden - pause everything
    isPaused = true;
    lastTime = performance.now(); // Reset time tracking
    try { await audio.ctx?.suspend?.(); } catch (_) {} // Suspend audio context
  } else {
    // Tab became visible - resume everything
    isPaused = false;
    lastTime = performance.now(); // Reset time tracking
    try { await audio.ctx?.resume?.(); } catch (_) {} // Resume audio context
  }
});

// Resume Watchdog
// ===============
// Some browsers (especially Safari) can suspend the audio context unexpectedly.
// These event handlers aggressively resume it when the user interacts with the page.

// Resume on window focus (user clicks back into the tab)
window.addEventListener('focus', async () => {
  try { await audio.ctx?.resume?.(); } catch (_) {}
});

// Resume on pointer down (user clicks/taps anywhere)
window.addEventListener('pointerdown', async () => {
  try { await audio.ctx?.resume?.(); } catch (_) {}
});

// Main Animation Loop
// ===================
// This is the heart of the application - it runs every frame (~60 times per second)
// and updates all components (audio, visuals, sync, WebSocket, UI).

let lastTime = performance.now(); // Last frame timestamp (for delta time calculation)

// FPS tracking variables
let fpsFrames = 0;        // Frame counter
let fpsElapsedMs = 0;     // Elapsed time accumulator
let fpsLast = performance.now(); // Last FPS calculation time

// Auto-resolution tracking variables
let autoFrames = 0;        // Frame counter for auto-resolution
let autoElapsedMs = 0;    // Elapsed time accumulator
let autoLast = performance.now(); // Last auto-resolution check time

// Resume watchdog tracking
let resumeWatchLastAttempt = 0; // Last time we tried to resume audio context

/**
 * Main animation loop function.
 * 
 * This function runs continuously, updating:
 * - Audio analysis (extracting features from audio)
 * - 3D scene (animating visuals based on audio features)
 * - Synchronization (keeping multiple windows in sync)
 * - WebSocket communication (sending features to TouchDesigner)
 * - UI updates (FPS counter, BPM display, beat indicator)
 * - Auto-resolution (adjusting quality based on performance)
 */
function animate() {
  // Schedule the next frame (this creates the loop)
  requestAnimationFrame(animate);
  
  const now = performance.now();
  
  // If paused, skip updating and reset timers
  if (isPaused) {
    lastTime = now;
    fpsLast = now;
    autoLast = now;
    return;
  }
  
  // Resume watchdog: if tab is visible but audio context is suspended, try to resume it
  // Only try every 400ms to avoid spamming
  if (document.visibilityState === 'visible' && audio.ctx && audio.ctx.state === 'suspended') {
    if (now - resumeWatchLastAttempt > 400) {
      resumeWatchLastAttempt = now;
      try { audio.ctx.resume(); } catch (_) {}
    }
  }
  
  // Calculate delta time (time since last frame) in seconds
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  
  // Update audio engine and get features
  // This analyzes the audio and extracts beat, frequency, tempo, etc.
  let features = audio.update();
  if (!features) {
    // Receiver windows can render using remote features from sync
    try { features = sync.getRemoteFeatures(now); } catch (_) {}
  }
  try { performancePads.update(dt, now, features); } catch (_) {}
  
  // Update 3D scene with audio features
  // This animates the particles and visuals based on the audio
  sceneApi.update(features);
  
  // Update synchronization coordinator
  // This handles syncing between multiple windows (control + projector mode)
  try { sync.tick(now); } catch (_) {}
  
  // Send local features to sync coordinator
  // This allows other windows to see what's happening here
  try { if (features) sync.handleLocalFeatures(features, now); } catch (_) {}
  
  // Send parameter snapshots periodically
  // This syncs settings changes between windows
  try { sync.maybeSendParamSnapshot(now); } catch (_) {}
  
  // Maintain WebSocket connection and broadcast features
  // Try to connect if not connected
  if (!featureWsConnected) ensureFeatureWs(now);
  // Send features to TouchDesigner if connected
  if (features) sendFeaturesOverWs(features, now);
  
  // Defensive safety check: ensure core visuals exist
  // If something failed earlier, try to rebuild particles
  if (!sceneApi.state.coreSphere || !sceneApi.state.orbitRings) {
    try { sceneApi.rebuildParticles(); } catch(_) {}
  }
  
  // Update UI Labels
  // ================
  // These update the settings panel with current values
  
  // Update BPM label (shows detected tempo)
  if (features && ui.updateBpmLabel) {
    ui.updateBpmLabel({ 
      bpm: features.bpm, 
      confidence: features.bpmConfidence, 
      source: features.bpmSource 
    });
  }
  
  // Update tap BPM and drift display
  if (features && ui.updateTapAndDrift) {
    ui.updateTapAndDrift({ 
      tapBpm: features.tapBpm, 
      bpm: features.bpm 
    });
  }
  
  // Update drift details (more advanced tempo information)
  if (features && ui.updateDriftDetails) {
    ui.updateDriftDetails({
      tapBpm: features.tapBpm,
      beatGrid: features.beatGrid,
      aubioTempo: features.aubioTempoBpm,
      aubioConf: features.aubioTempoConf,
    });
  }
  
  // Update beat indicator (small pulsing dot in settings header)
  if (ui.updateBeatIndicator) {
    ui.updateBeatIndicator(!!(features && features.beat));
  }
  
  // FPS Tracking
  // ============
  // Calculate and display frames per second
  // We update the UI every 500ms with the average FPS
  
  fpsFrames += 1; // Increment frame counter
  const frameMs = (now - fpsLast); // Time since last calculation
  fpsElapsedMs += frameMs; // Accumulate elapsed time
  fpsLast = now;
  
  // If 500ms have passed, calculate and display FPS
  if (fpsElapsedMs > 500) {
    // Calculate: (frames / milliseconds) * 1000 = frames per second
    ui.updateFpsLabel((fpsFrames * 1000) / fpsElapsedMs);
    fpsFrames = 0; // Reset counters
    fpsElapsedMs = 0;
  }
  
  // Auto-Resolution System
  // ======================
  // Automatically adjusts rendering quality (pixel ratio) based on performance
  // If FPS is too low, reduce quality. If FPS is high, increase quality.
  // This ensures smooth performance on different hardware.
  
  if (sceneApi.state.params.autoResolution) {
    autoFrames += 1; // Increment frame counter
    const autoMs = (now - autoLast); // Time since last check
    autoElapsedMs += autoMs; // Accumulate elapsed time
    autoLast = now;
    
    // Check every ~3 seconds
    if (autoElapsedMs > 3000) {
      // Estimate current FPS
      const fpsApprox = (autoFrames * 1000) / autoElapsedMs;
      const target = sceneApi.state.params.targetFps || 60; // Target FPS (default 60)
      const currentPR = sceneApi.getPixelRatio(); // Current pixel ratio (quality)
      const desiredMaxPR = sceneApi.state.params.pixelRatioCap; // Maximum allowed quality
      
      let newPR = currentPR; // Start with current value
      
      // If FPS is too low, reduce quality (lower pixel ratio)
      if (fpsApprox < target - 8) {
        newPR = Math.max(sceneApi.state.params.minPixelRatio, currentPR - 0.05);
      }
      // If FPS is too high, increase quality (higher pixel ratio)
      else if (fpsApprox > target + 8) {
        newPR = Math.min(desiredMaxPR, currentPR + 0.05);
      }
      
      // Only update if change is significant (avoids tiny adjustments)
      if (Math.abs(newPR - currentPR) > 0.01) {
        sceneApi.setPixelRatioCap(parseFloat(newPR.toFixed(2)));
      }
      
      // Reset counters
      autoFrames = 0;
      autoElapsedMs = 0;
    }
  }
}

// Start the animation loop
animate();

// Drag-and-Drop File Loading
// ===========================
// Allows users to drag audio files onto the window to load them

const dropOverlay = document.getElementById('drop-overlay');

// Show overlay when dragging files over the window
['dragenter', 'dragover'].forEach(evt => {
  window.addEventListener(evt, (e) => {
    e.preventDefault(); // Prevent default browser behavior
    if (dropOverlay) dropOverlay.classList.add('active'); // Show overlay
  });
});

// Hide overlay when dragging leaves or file is dropped
['dragleave', 'drop'].forEach(evt => {
  window.addEventListener(evt, (e) => {
    e.preventDefault(); // Prevent default browser behavior
    if (dropOverlay) dropOverlay.classList.remove('active'); // Hide overlay
  });
});

// Handle file drop
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0]; // Get first dropped file
  
  // Only process audio files
  if (file && file.type.startsWith('audio/')) {
    try {
      await audio.loadFile(file);
    } catch (err) {
      console.error('Drop load failed', err);
      try { showToast('Audio file load failed.', 2600); } catch(_) {}
    }
  }
});

// System Audio Help Button
// ========================
// Shows helpful instructions for capturing system audio on different platforms

document.getElementById('open-system-audio-help')?.addEventListener('click', () => {
  // Detect if we're on macOS
  const isMac = /Mac/i.test(navigator.userAgent || '') || /Mac/i.test(navigator.platform || '');
  
  // Show platform-specific instructions
  const msg = isMac
    ? 'macOS: For one tab, click "Tab (Chrome)" then enable "Share tab audio".\n\nFor full system audio: Install BlackHole 2ch → in Audio MIDI Setup make a Multi-Output (BlackHole + your speakers) → set Mac Output to that device → in the app pick Mic → BlackHole.\n\nIf capture fails, allow Chrome in System Settings → Privacy & Security → Screen Recording.'
    : 'Click System, then select a tab/window with audio and enable audio sharing. If capture is blocked, allow screen recording permissions for your browser.';
  
  // Try to show as toast, fall back to alert if toast fails
  try { showToast(msg, 5200); } catch (_) { alert(msg); }
});
