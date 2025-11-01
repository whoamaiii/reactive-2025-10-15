/**
 * Audio Engine
 *
 * This is the core audio processing system that analyzes audio input and extracts
 * musical features. Think of it like a music analyst that listens to audio and tells
 * you things like "there's a beat here", "this is a bass sound", "the tempo is 128 BPM".
 *
 * What this file does:
 * 1. Captures audio from various sources (microphone, system audio, audio files)
 * 2. Processes audio using FFT (Fast Fourier Transform) to analyze frequencies
 * 3. Extracts features like beats, tempo, pitch, frequency bands, spectral characteristics
 * 4. Provides real-time analysis that updates every frame
 * 5. Integrates with external libraries (Aubio, Meyda, Essentia) for advanced analysis
 *
 * Key Concepts:
 * - RMS (Root Mean Square): Overall volume/energy level
 * - Frequency Bands: Dividing audio into bass, mid, treble ranges
 * - Spectral Flux: How quickly frequencies are changing (used for beat detection)
 * - BPM (Beats Per Minute): Tempo detection
 * - AudioWorklet: Advanced audio processing in a separate thread for better performance
 *
 * Data Flow:
 * - Audio input → AudioContext → AnalyserNode → Feature extraction → Features object
 * - Features are used by the 3D scene to animate visuals
 * - Features are also sent to TouchDesigner via WebSocket
 */

import { AudioContext as StdAudioContext } from 'standardized-audio-context';
import { loadAubio, loadMeyda } from './lazy.js';
import { showToast } from './toast.js';

/**
 * Lazy-load web-audio-beat-detector at runtime with graceful fallbacks.
 * 
 * Instead of bundling this library (which can fail to load from CDNs), we load it
 * dynamically when needed. This keeps the app working even if the CDN is down.
 * 
 * We try multiple CDN sources to increase reliability.
 * 
 * @returns {Promise<Function>} A promise that resolves to the BPM detection function
 */
async function getBeatDetectorGuess() {
  // If we've already loaded it, return the cached function
  if (_guessBpmFn) return _guessBpmFn;
  const candidates = [
    'https://esm.sh/web-audio-beat-detector@6.3.2',
    'https://cdn.jsdelivr.net/npm/web-audio-beat-detector@6.3.2/+esm',
    'https://cdn.skypack.dev/web-audio-beat-detector@6.3.2',
  ];
  for (const url of candidates) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      // Support different export shapes across CDNs:
      // 1) named export: { guess }
      // 2) default export is the function itself
      // 3) default export object with .guess
      let fn = null;
      if (typeof mod?.guess === 'function') fn = mod.guess;
      else if (typeof mod?.default === 'function') fn = mod.default;
      else if (mod?.default && typeof mod.default.guess === 'function') fn = mod.default.guess;
      if (typeof fn === 'function') {
        _guessBpmFn = fn;
        return _guessBpmFn;
      }
    } catch (_) {
      // try next candidate
    }
  }
  // Final fallback: no-op estimator that resolves to null bpm
  // This ensures the app continues working even if all CDNs fail
  _guessBpmFn = async () => ({ bpm: null });
  return _guessBpmFn;
}

/**
 * AudioEngine Class
 * 
 * The main class that handles all audio processing and feature extraction.
 * This is instantiated once in main.js and used throughout the application.
 * 
 * Main responsibilities:
 * - Setup and manage AudioContext (the audio processing environment)
 * - Capture audio from microphone, system audio, or files
 * - Analyze audio in real-time using FFT and various algorithms
 * - Extract musical features (beats, tempo, frequency bands, pitch, etc.)
 * - Integrate with external analysis libraries (Aubio, Meyda, Essentia)
 * - Provide features to the 3D scene for visual animation
 */
export class AudioEngine {
  /**
   * Constructor - Initializes all audio processing state variables.
   * 
   * Sets up defaults for all the analysis parameters and state tracking.
   * The actual audio context and nodes are created lazily when audio starts.
   */
  constructor() {
    // Core audio nodes (created when ensureContext() is called)
    this.ctx = null;                    // AudioContext - the audio processing environment
    this.source = null;                 // MediaStreamAudioSourceNode or AudioBufferSourceNode - the audio input
    this.gainNode = null;               // GainNode - controls volume
    this.analyser = null;               // AnalyserNode - extracts frequency and time domain data
    this.fftSize = 2048;                // FFT size - determines frequency resolution (higher = more detail, more CPU)
    this.freqData = null;               // Uint8Array - frequency data (0-255 for each frequency bin)
    this.timeData = null;               // Uint8Array - waveform data (0-255 for each sample)
    this.sampleRate = 48000;            // Audio sample rate (samples per second)

    // Feature extraction state
    this.prevMag = null; // previous normalized magnitude spectrum (Float32)
    this.fluxHistory = [];
    this.fluxWindow = 43; // ~0.5s at 86 fps of analyser pulls (approx)
    this.sensitivity = 1.0; // beat threshold multiplier
    this.smoothing = 0.55; // EMA smoothing for RMS/bands (rave tuned)
    this.bandSplit = { sub: 90, low: 180, mid: 2500 }; // Hz (rave tuned)
    this.beatCooldownMs = 350;
    // Beat gating & noise gate (production-hardening)
    this.beatRefractoryMs = 350; // minimum time between beats (ms)
    this.beatEnergyFloor = 0.28; // 0..1 energy floor on bass env to accept beat
    this.noiseGateEnabled = false; // attenuate low-level noise before extraction
    this.noiseGateThreshold = 0.10; // 0..1 amplitude/energy threshold for gate
    this._noiseGateCalibrating = false; // guard concurrent calibrations
    this._lastBeatMs = -99999;

    this.levels = { rms: 0, rmsEMA: 0, bands: { bass: 0, mid: 0, treble: 0 }, bandsEMA: { bass: 0, mid: 0, treble: 0 }, centroid: 0, centroidEMA: 0 };

    // Per-band adaptive envelopes for punchy yet stable visual mapping
    this.bandEnv = { sub: 0, bass: 0, mid: 0, treble: 0 };
    this.bandPeak = { sub: 0.2, bass: 0.2, mid: 0.2, treble: 0.2 }; // rolling maxima for AGC
    this.envAttack = 0.7;   // 0..1 per-frame attack (rise) speed
    this.envRelease = 0.12; // 0..1 per-frame release (fall) speed
    this.bandAGCDecay = 0.995; // decay factor for rolling maxima
    this.bandAGCEnabled = true;

    // Drop/build detection state
    this.dropEnabled = false;
    this.dropFluxThresh = 1.4; // z-flux threshold to consider build
    this.dropBassThresh = 0.55; // bass env threshold near drop
    this.dropCentroidSlopeThresh = 0.02; // negative slope magnitude
    this.dropMinBeats = 4;
    this.dropCooldownMs = 4000;
    this._buildBeats = 0;
    this._buildLevel = 0; // EMA of positive z-flux
    this._centroidPrev = 0;
    this._centroidSlopeEma = 0;
    this._centroidSlopeAlpha = 0.6; // EMA factor
    this._lastDropMs = -99999;

    // Optional: gate drops to bar downbeats
    this.dropBarGatingEnabled = false;
    this.dropGateBeatsPerBar = 4;
    this._beatIndexForDrop = -1;
    this.dropDownbeatGateToleranceMs = 80; // how close to a downbeat to allow drop

    // Bass-only spectral flux (for build detection)
    this.dropUseBassFlux = false; // can be enabled via presets (Rave Mode)
    this.bassFluxHistory = [];
    this.bassFluxWindow = 43;
    this._prevMagBass = null;

    // Adaptive thresholds (learn per-track in warmup period)
    this.autoDropThresholdsEnabled = false;
    this.autoDropCalDurationMs = 25000;
    this._autoThrStartMs = 0;
    this._autoThrApplied = false;
    this._autoBassOnBeats = [];
    this._autoCentroidNegOnBeats = [];

    // File playback timeline tracking (for downbeat gating)
    this._fileStartCtxTimeSec = 0;
    this._fileDurationSec = 0;

    this.timeDataFloat = null;

    this._meydaPromise = null;
    this.meyda = null;
    this._meydaLastExtract = 0;
    this._meydaIntervalMs = 1000 / 75; // ~75 Hz refresh
    this._meydaSmoothing = 0.65;
    this.lowCpuMode = false;
    this.meydaFeatures = {
      mfcc: new Array(13).fill(0.5),
      chroma: new Array(12).fill(0),
      flatness: 0,
      rolloff: 0,
    };

    this.workletNode = null;
    this.workletEnabled = false;
    this._workletInitPromise = null;
    this._workletFrame = null;
    this._workletFrameId = -1;
    this._lastFluxFrameId = -1;
    this._lastMeydaFrameId = -1;
    this._workletFeatures = { rms: 0, flux: 0, fluxMean: 0, fluxStd: 0 };
    this._graphConnected = false;
    this._workletInitAttempted = false;
    this._workletFrameTimestamp = 0;

    this._aubioPromise = null;
    this._aubioModule = null;
    this._aubio = { onset: null, tempo: null, pitch: null };
    this._aubioQueue = [];
    this._aubioLastFrameId = -1;
    this._aubioConfiguredSampleRate = null;
    this.aubioFeatures = {
      pitchHz: 0,
      pitchConf: 0,
      tempoBpm: 0,
      tempoConf: 0,
      lastOnsetMs: 0,
    };
    this._aubioFallbackCounter = 0;

    this._essentiaWorker = null;
    this._essentiaReady = false;
    this._essentiaReadyPromise = null;
    this._essentiaReadyResolver = null;
    this._essentiaCurrentJobId = 0;
    this._essentiaPendingJobId = 0;
    this.beatGrid = {
      bpm: 0,
      confidence: 0,
      beatTimes: [],
      downbeats: [],
      loudness: null,
      source: null,
      updatedAt: 0,
    };

    this.activeStream = null; // to stop tracks when switching
    this.isPlayingFile = false;

    // Tempo assist (optional, for file playback)
    this.bpmEstimate = null; // number | null
    this.bpmEstimateConfidence = 0;
    this.bpmEstimateSource = null;
    this.tempoAssistEnabled = false;
    this.tempoIntervalMs = 0;
    this._lastTempoMs = 0;
    this._lastAudioBuffer = null; // only set for file playback

    // Tap-tempo & quantization
    this.tapTimestamps = [];
    this.tapBpm = null;
    this.tapTempoIntervalMs = 0;
    this.tapQuantizeEnabled = false;
    this._lastQuantizeMs = 0;
    this._tapMultiplier = 1;

    // Rolling live-audio buffer (for BPM recalc on live sources)
    this._liveBufferSec = 20; // keep ~20s of recent audio
    this._liveBuffer = null; // Float32Array ring buffer (mono)
    this._liveBufferWrite = 0;
    this._liveBufferFilled = 0;

    // Webcam feature removed
  }

  /**
   * Ensures the audio context and analysis nodes are created and ready.
   * 
   * This is called automatically before starting any audio source.
   * Creates the AudioContext, GainNode, AnalyserNode, and sets up the audio graph.
   * Also attempts to initialize AudioWorklet for better performance.
   * 
   * Exposes the context to window.__reactiveCtxs for Safari/iOS unlock helper.
   * 
   * @returns {Promise<void>} Resolves when context is ready
   */
  async ensureContext() {
    // Create AudioContext if it doesn't exist
    if (!this.ctx) {
      let Ctor = StdAudioContext;
      if (typeof Ctor !== 'function') {
        // Fallback to native contexts if standardized-audio-context isn't available
        Ctor = window.AudioContext || window.webkitAudioContext;
      }
      this.ctx = new Ctor();
      this.sampleRate = this.ctx.sampleRate;
      
      // Expose for Safari/iOS unlock helper to resume
      // Safari requires a user gesture to start audio, so we store contexts globally
      try {
        window.__reactiveCtxs = window.__reactiveCtxs || [];
        if (!window.__reactiveCtxs.includes(this.ctx)) window.__reactiveCtxs.push(this.ctx);
      } catch(_) {}
    }
    
    // Try to resume context on user gestures; harmless if already running
    // Some browsers suspend audio contexts until user interaction
    try {
      if (this.ctx && this.ctx.state !== 'running') {
        await this.ctx.resume();
      }
    } catch(_) {}
    
    // Create gain node (volume control)
    if (!this.gainNode) {
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 1.0; // Default: full volume
    }
    
    // Create analyser node (extracts frequency and time domain data)
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.5; // Smooths frequency data over time
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.timeDataFloat = new Float32Array(this.analyser.fftSize);
    }

    // Connect audio graph: source → gain → worklet (optional) → analyser
    if (!this._graphConnected && this.gainNode && this.analyser) {
      this._ensureGraph();
      this._graphConnected = true;
    }

    // Initialize AudioWorklet if available (for better performance)
    await this._maybeInitWorklet();
    
    // Ensure live ring buffer exists once we know actual sampleRate
    // This buffer stores recent audio for BPM recalculation on live sources
    this._ensureLiveBuffer();
  }

  async getInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  /**
   * Start capturing audio from the microphone.
   * 
   * Requests microphone access from the browser and starts capturing audio.
   * Stops any existing audio source first.
   * 
   * Note: Requires HTTPS or localhost (secure origin) for browser security.
   * 
   * @param {string} [deviceId] - Optional device ID from getInputDevices(). If not provided, uses default device.
   * @returns {Promise<MediaStream>} The audio stream
   * @throws {Error} If getUserMedia is unavailable or permission is denied
   */
  async startMic(deviceId) {
    await this.ensureContext();
    this.stop(); // Stop any existing audio source
    
    // Check if getUserMedia is available (requires secure origin)
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      showToast('Mic requires a secure origin (https or http://localhost).');
      throw new Error('getUserMedia unavailable');
    }
    
    // Configure audio constraints
    // Disable echo cancellation, noise suppression, and auto gain control
    // to get raw audio for music analysis
    const constraints = { 
      audio: { 
        deviceId: deviceId ? { exact: deviceId } : undefined, // Use specific device or default
        echoCancellation: false,   // Disabled for music analysis
        noiseSuppression: false,    // Disabled for music analysis
        autoGainControl: false      // Disabled for music analysis
      } 
    };
    
    // Request microphone access
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this._useStream(stream);
    return stream;
  }

  async startSystemAudio() {
    await this.ensureContext();
    this.stop();
    const isMac = (() => {
      try {
        const ua = navigator.userAgent || '';
        const plat = navigator.platform || '';
        return /Mac/i.test(ua) || /Mac/i.test(plat);
      } catch (_) { return false; }
    })();
    try {
      const md = (typeof navigator !== 'undefined') ? navigator.mediaDevices : null;
      const rawGetDisplay = (md && md.getDisplayMedia) || (typeof navigator !== 'undefined' ? navigator.getDisplayMedia : null);
      // Debug info to aid environment diagnosis without breaking UX
      try {
        const isDebug = new URLSearchParams(location.search || '').has('debug');
        if (isDebug) console.info('DisplayMedia support:', { hasMediaDevices: !!md, hasGetDisplayMedia: !!(md && md.getDisplayMedia), hasLegacyGetDisplayMedia: !!(navigator && navigator.getDisplayMedia), protocol: location.protocol, host: location.hostname });
      } catch(_) {}
      if (!rawGetDisplay) {
        const ua = (navigator.userAgent || '').toLowerCase();
        const isChromium = ua.includes('chrome') || ua.includes('edg') || ua.includes('brave');
        const hostOk = (location.protocol === 'https:') || (location.hostname === 'localhost') || (location.hostname === '127.0.0.1');
        const hint = !isChromium ? 'Open in Chrome and try "Tab (Chrome)".' : (!hostOk ? 'Use https or http://localhost.' : '');
        showToast(`System/Tab capture unavailable. ${hint}`.trim());
        throw new Error('getDisplayMedia unavailable');
      }
      // Chrome tab/window/screen capture. On macOS, this usually only provides tab audio.
      const stream = await (rawGetDisplay.call ? rawGetDisplay.call(md || navigator, { video: { frameRate: 1 }, audio: true }) : rawGetDisplay({ video: { frameRate: 1 }, audio: true }));
      const hasAudio = !!(stream && typeof stream.getAudioTracks === 'function' && stream.getAudioTracks().length);
      if (!hasAudio) {
        try { for (const t of stream.getTracks()) t.stop(); } catch (_) {}
        const msg = isMac
          ? 'No audio captured. In Chrome, pick a "Chrome Tab" and enable "Share tab audio". For full Mac audio, use BlackHole and select it as Mic.'
          : 'No audio captured. Choose a tab with audio and enable audio sharing.';
        showToast(msg);
        const err = new Error('No audio track captured from display media');
        try { err.__reactiveNotified = true; } catch(_) {}
        throw err;
      }
      this._useStream(stream);
      return stream;
    } catch (e) {
      // Provide targeted guidance
      try {
        const name = e?.name || e?.code || '';
        const msg = String(e?.message || '').toLowerCase();
        let notified = false;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          if (isMac) {
            showToast('Allow Screen Recording for Chrome: System Settings → Privacy & Security → Screen Recording.');
          } else {
            showToast('Capture permission denied. Allow screen + audio capture in your browser.');
          }
          notified = true;
        } else if (name === 'NotFoundError') {
          showToast('No capture sources available. Try selecting a specific tab with audio.');
          notified = true;
        } else if (name === 'OverconstrainedError') {
          showToast('System audio unsupported with current constraints. Use Chrome tab audio or BlackHole.');
          notified = true;
        } else if (!name && msg.includes('audio') && msg.includes('not')) {
          showToast('No audio track captured. Choose Chrome Tab and enable "Share tab audio".');
          notified = true;
        }
        if (notified) { try { e.__reactiveNotified = true; } catch (_) {} }
      } catch (_) {}
      throw e;
    }
  }

  /**
   * Load and play an audio file.
   * 
   * Decodes the audio file, creates a looping AudioBufferSourceNode,
   * and triggers BPM estimation and Essentia analysis in the background.
   * 
   * @param {File} file - The audio file to load
   * @returns {Promise<void>} Resolves when file is loaded and playing
   */
  async loadFile(file) {
    await this.ensureContext();
    this.stop(); // Stop any existing audio
    
    // Decode the audio file into an AudioBuffer
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
    
    // Create a buffer source node and start looping playback
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuf;
    src.loop = true;        // Loop the audio
    src.start(0);           // Start immediately
    src.connect(this.gainNode);
    this._ensureGraph();
    this.source = src;
    this.isPlayingFile = true;
    this.activeStream = null;
    this._lastAudioBuffer = audioBuf; // Store for BPM recalculation
    // Track playback timeline for downbeat gating
    this._fileStartCtxTimeSec = this.ctx.currentTime;
    this._fileDurationSec = audioBuf.duration || 0;

    // Fire-and-forget BPM estimation for tempo assist
    // This runs in the background and updates bpmEstimate when done
    this._estimateBpmFromBuffer(audioBuf).catch(() => {});

    // Run Essentia analysis for beat grid detection
    // This provides precise beat tracking and tempo information
    this._runEssentiaAnalysis(audioBuf).catch((err) => {
      console.warn('Essentia analysis failed', err);
    });
  }

  /**
   * Stops all audio playback and capture.
   * 
   * Stops the current audio source (file playback or microphone/system capture),
   * but keeps the audio context alive so it can be resumed quickly.
   * Does not clear BPM estimate (allows UI to still show last known value).
   */
  stop() {
    // Stop audio file playback if active
    try {
      if (this.source && this.source.stop) {
        this.source.stop();
      }
    } catch(_){}
    
    // Stop media stream tracks (microphone/system audio)
    if (this.activeStream) {
      for (const t of this.activeStream.getTracks()) t.stop();
    }
    
    // Clear source references
    this.source = null;
    this.activeStream = null;
    this.isPlayingFile = false;
    this._fileStartCtxTimeSec = 0;
    this._fileDurationSec = 0;
    
    // Reset worklet state
    if (this.workletNode) {
      try { this.workletNode.port.postMessage({ type: 'reset' }); } catch (_) {}
    }
    
    // Don't clear BPM immediately; allow UI to still show last known value
  }

  // Webcam feature removed: startWebcam/stopWebcam et al removed

  _useStream(stream) {
    // Defensive check: ensure context exists before creating nodes
    if (!this.ctx) {
      console.error('Audio context not initialized');
      showToast('Audio system not ready. Please refresh the page.', 3000);
      return;
    }

    // Stop existing stream
    if (this.activeStream) {
      for (const t of this.activeStream.getTracks()) t.stop();
    }

    this.activeStream = stream;

    try {
      const src = this.ctx.createMediaStreamSource(stream);
      src.connect(this.gainNode);
      this._ensureGraph();
      this.source = src;
      this.isPlayingFile = false;
    } catch (err) {
      console.error('Failed to connect audio stream', err);
      showToast('Failed to connect audio source.', 2500);
      // Clean up the stream if connection failed
      for (const t of stream.getTracks()) t.stop();
      this.activeStream = null;
      throw err;
    }
  }

  setGain(v) { if (this.gainNode) this.gainNode.gain.value = v; }
  setFFTSize(size) {
    this.fftSize = size;
    if (this.analyser) {
      this.analyser.fftSize = size;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.timeDataFloat = new Float32Array(this.analyser.fftSize);
    }
  }
  setSensitivity(v) { this.sensitivity = v; }
  setSmoothing(v) {
    this.smoothing = v;
    this._meydaSmoothing = this._clamp(v, 0.1, 0.9);
  }
  setLowCpuMode(enabled) {
    this.lowCpuMode = !!enabled;
    // Reduce Meyda extraction rate when enabled
    this._meydaIntervalMs = this.lowCpuMode ? (1000 / 50) : (1000 / 75);
  }
  setBandSplit(lowHz, midHz) { this.bandSplit.low = lowHz; this.bandSplit.mid = midHz; }
  setSubHz(hz) { this.bandSplit.sub = Math.max(20, Math.min(200, hz)); }
  /**
   * Set the refractory window for beat detection.
   * Alias maintained via setBeatCooldown for backward compatibility.
   * @param {number} ms - Minimum milliseconds between accepted beats.
   */
  setBeatRefractory(ms) {
    const v = Math.max(60, Math.floor(ms || 0));
    this.beatRefractoryMs = v;
    // Keep legacy field in sync for presets/loaders referring to beatCooldown
    this.beatCooldownMs = v;
  }
  /** @deprecated Use setBeatRefractory */
  setBeatCooldown(ms) { this.setBeatRefractory(ms); }
  /**
   * Set the minimum bass energy required to accept a beat (0..1).
   * Gates hats/snares in noisy venues; only strong downbeats fire.
   */
  setBeatEnergyFloor(v) { this.beatEnergyFloor = this._clamp(v, 0, 1); }
  /** Enable/disable the input noise gate. */
  setNoiseGateEnabled(v) { this.noiseGateEnabled = !!v; }
  /** Set the noise gate threshold (0..1). Typical: 0.05–0.20. */
  setNoiseGateThreshold(v) { this.noiseGateThreshold = this._clamp(v, 0, 0.95); }
  setEnvAttack(v) { this.envAttack = this._clamp(v, 0.0, 1.0); }
  setEnvRelease(v) { this.envRelease = this._clamp(v, 0.0, 1.0); }
  setBandAgcEnabled(v) { this.bandAGCEnabled = !!v; }
  setBandAgcDecay(v) { this.bandAGCDecay = this._clamp(v, 0.90, 0.9999); }
  setDropEnabled(v) { this.dropEnabled = !!v; }
  setDropFluxThresh(v) { this.dropFluxThresh = this._clamp(v, 0.2, 5); }
  setDropBassThresh(v) { this.dropBassThresh = this._clamp(v, 0.1, 1.0); }
  setDropCentroidSlopeThresh(v) { this.dropCentroidSlopeThresh = this._clamp(v, 0.005, 0.2); }
  setDropMinBeats(v) { this.dropMinBeats = Math.max(1, Math.floor(v)); }
  setDropCooldownMs(v) { this.dropCooldownMs = Math.max(500, Math.floor(v)); }

  // Drop bar-gating controls
  setDropBarGatingEnabled(v) {
    this.dropBarGatingEnabled = !!v;
    if (this.dropBarGatingEnabled) this._beatIndexForDrop = -1;
  }
  setDropGateBeatsPerBar(v) {
    this.dropGateBeatsPerBar = Math.max(1, Math.floor(v || 4));
  }
  setDropDownbeatToleranceMs(v) { this.dropDownbeatGateToleranceMs = Math.max(10, Math.floor(v || 80)); }
  setDropUseBassFlux(v) { this.dropUseBassFlux = !!v; }
  setAutoDropThresholdsEnabled(v) {
    this.autoDropThresholdsEnabled = !!v;
    this._autoThrApplied = false;
    this._autoBassOnBeats = [];
    this._autoCentroidNegOnBeats = [];
    this._autoThrStartMs = performance.now();
  }

  /**
   * Calibrate the ambient noise floor for the noise gate by sampling bass-band
   * energy from the current input for a short window.
   * The resulting threshold is slightly above the 90th percentile of measured
   * ambient bass energy, with a small safety margin.
   *
   * Failure modes: if no analyser or sampleRate is available, resolves to 0.
   * @param {number} durationMs - Sampling duration in ms (default 5000ms)
   * @returns {Promise<number>} resolved gate threshold (0..1)
   */
  async calibrateNoiseGate(durationMs = 5000) {
    if (this._noiseGateCalibrating) return this.noiseGateThreshold;
    await this.ensureContext();
    if (!this.analyser || !this.sampleRate) return 0;
    this._noiseGateCalibrating = true;
    const wasEnabled = !!this.noiseGateEnabled;
    const scratch = new Uint8Array(this.analyser.frequencyBinCount);
    const sr = this.sampleRate || 44100;
    const binHz = sr / 2 / scratch.length;
    const lowHz = Math.max(80, this.bandSplit.low || 180);
    const subHz = Math.max(20, Math.min(this.bandSplit.sub || 90, (this.bandSplit.low || 180) - 5));
    const samples = [];
    const start = performance.now();

    // Temporarily disable the gate to get raw floor
    this.noiseGateEnabled = false;

    while (performance.now() - start < durationMs) {
      try { this.analyser.getByteFrequencyData(scratch); } catch (_) { break; }
      let sum = 0, count = 0;
      for (let i = 0; i < scratch.length; i++) {
        const f = i * binHz;
        if (f >= subHz && f < lowHz) { sum += scratch[i] / 255; count++; }
      }
      const avg = count ? (sum / count) : 0;
      samples.push(this._clamp(avg, 0, 1));
      // ~50Hz sampling without blocking the UI thread
      await new Promise(r => setTimeout(r, 20));
    }

    this.noiseGateEnabled = wasEnabled;
    this._noiseGateCalibrating = false;
    if (!samples.length) return this.noiseGateThreshold;
    samples.sort((a, b) => a - b);
    const p90 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.90))];
    // Add a margin and clamp to sane upper bound so music still comes through
    const threshold = this._clamp(p90 * 1.15 + 0.02, 0.01, 0.5);
    this.noiseGateThreshold = threshold;
    this.noiseGateEnabled = true;
    try { showToast(`Noise gate calibrated: ${threshold.toFixed(2)}`); } catch (_) {}
    return threshold;
  }

  // Tempo assist API
  setTempoAssistEnabled(v) {
    this.tempoAssistEnabled = !!v;
    const now = performance.now();
    if (this.tempoAssistEnabled) {
      if (this.bpmEstimate && this.bpmEstimate > 0) {
        this.tempoIntervalMs = 60000 / this.bpmEstimate;
        this._lastTempoMs = now;
        this._lastQuantizeMs = now; // align grid phase when enabling
      }
    }
  }
  getBpm() { return this.bpmEstimate || 0; }
  getBpmConfidence() { return this.bpmEstimateConfidence || 0; }
  getBpmSource() { return this.bpmEstimateSource || ''; }
  async recalcBpm() {
    if (this._lastAudioBuffer) {
      await this._estimateBpmFromBuffer(this._lastAudioBuffer);
      // Also compute/refresh beat grid via Essentia to backfill BPM if guess failed
      try { this._runEssentiaAnalysis(this._lastAudioBuffer); } catch(_) {}
      return;
    }
    const live = this._buildLiveAudioBuffer(12);
    if (live) {
      await this._estimateBpmFromBuffer(live);
      try { this._runEssentiaAnalysis(live); } catch(_) {}
    } else {
      try { showToast('Need a few seconds of live audio before recalculating BPM.'); } catch(_) {}
    }
  }

  // Tap tempo API
  tapBeat() {
    const now = performance.now();
    const taps = this.tapTimestamps;
    // debounce taps that are too close (<120ms)
    if (taps.length && now - taps[taps.length - 1] < 120) return;
    taps.push(now);
    // keep last 8 taps
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      // compute intervals between consecutive taps
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);
      // remove outliers using median absolute deviation
      const median = intervals.slice().sort((a,b)=>a-b)[Math.floor(intervals.length/2)];
      const mads = intervals.map(v => Math.abs(v - median));
      const mad = mads.slice().sort((a,b)=>a-b)[Math.floor(mads.length/2)] || 0;
      const filtered = mad > 0 ? intervals.filter(v => Math.abs(v - median) <= 3 * mad) : intervals;
      const avg = filtered.reduce((a,b)=>a+b,0) / filtered.length;
      if (isFinite(avg) && avg > 200 && avg < 2000) {
        const bpm = 60000 / avg;
        const adjustedBpm = bpm * this._tapMultiplier;
        this.tapBpm = Math.round(adjustedBpm);
        this.tapTempoIntervalMs = 60000 / (this.tapBpm || 1);
        this._lastQuantizeMs = now; // reset phase to last tap
      }
    }
  }
  resetTapTempo() { this.tapTimestamps = []; this.tapBpm = null; this.tapTempoIntervalMs = 0; }
  getTapBpm() { return this.tapBpm || 0; }
  setTapQuantizeEnabled(v) { this.tapQuantizeEnabled = !!v; if (this.tapQuantizeEnabled) { this._lastQuantizeMs = performance.now(); if (this.dropBarGatingEnabled) this._beatIndexForDrop = -1; } }

  nudgeTapMultiplier(mult) {
    if (!mult || !isFinite(mult)) return;
    this._tapMultiplier = this._clamp(this._tapMultiplier * mult, 0.25, 4);
    const base = this.tapTempoIntervalMs > 0 ? 60000 / this.tapTempoIntervalMs : this.getBpm();
    if (base) {
      const updated = base * this._tapMultiplier;
      this.tapBpm = Math.round(updated);
      this.tapTempoIntervalMs = this.tapBpm ? 60000 / this.tapBpm : 0;
    }
  }

  nudgeQuantizePhase(deltaMs) {
    if (!deltaMs) return;
    const gridActive = (this.tapQuantizeEnabled && this.tapTempoIntervalMs > 0)
      || (this.tempoAssistEnabled && this.tempoIntervalMs > 0);
    if (!gridActive) return;
    this._lastQuantizeMs += deltaMs;
  }

  alignQuantizePhase() {
    this._lastQuantizeMs = performance.now();
  }

  _ensureGraph() {
    if (!this.gainNode || !this.analyser) return;
    try { this.gainNode.disconnect(); } catch (_) {}
    if (this.workletNode) {
      try { this.workletNode.disconnect(); } catch (_) {}
      this.gainNode.connect(this.workletNode);
      this.workletNode.connect(this.analyser);
    } else {
      this.gainNode.connect(this.analyser);
    }
  }

  async _maybeInitWorklet() {
    if (!this.ctx || !this.ctx.audioWorklet || typeof this.ctx.audioWorklet.addModule !== 'function') {
      this.workletEnabled = false;
      return null;
    }
    if (this.workletNode) {
      return this.workletNode;
    }
    if (this._workletInitPromise) {
      return this._workletInitPromise;
    }
    if (this._workletInitAttempted && !this.workletEnabled) {
      return null;
    }
    this._workletInitAttempted = true;
    const workletUrl = new URL('../public/worklets/analysis-processor.js', import.meta.url);
    this._workletInitPromise = this.ctx.audioWorklet.addModule(workletUrl.href)
      .then(() => {
        const node = new AudioWorkletNode(this.ctx, 'analysis-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = (event) => this._handleWorkletMessage(event);
        node.onprocessorerror = (err) => {
          console.error('Analysis processor error', err);
          this.workletEnabled = false;
        };
        this.workletNode = node;
        this.workletEnabled = true;
        this._ensureGraph();
        return node;
      })
      .catch((err) => {
        console.warn('AudioWorklet unavailable, using ScriptProcessor fallback.', err);
        this.workletNode = null;
        this.workletEnabled = false;
        return null;
      })
      .finally(() => {
        this._workletInitPromise = null;
      });
    return this._workletInitPromise;
  }

  _handleWorkletMessage(event) {
    const data = event?.data;
    if (!data || data.type !== 'frame') return;
    const frameId = typeof data.frameId === 'number' ? data.frameId : this._workletFrameId + 1;
    this._workletFrameId = frameId;
    this._workletFrameTimestamp = performance.now();

    let frameArray = null;
    if (data.samples) {
      frameArray = new Float32Array(data.samples);
      this._workletFrame = frameArray;
    }
    if (typeof data.rms === 'number') this._workletFeatures.rms = data.rms;
    if (typeof data.flux === 'number') this._workletFeatures.flux = data.flux;
    if (typeof data.fluxMean === 'number') this._workletFeatures.fluxMean = data.fluxMean;
    if (typeof data.fluxStd === 'number') this._workletFeatures.fluxStd = data.fluxStd;

    if (frameArray) {
      this._enqueueAubioFrame(frameArray, frameId);
      // Append to rolling live buffer for later BPM estimation
      this._appendToLiveBuffer(frameArray);
    }
  }

  _consumeWorkletFlux() {
    if (!this.workletEnabled || this._workletFrameId < 0) {
      return null;
    }
    const frameId = this._workletFrameId;
    const flux = this._workletFeatures.flux ?? 0;
    if (frameId !== this._lastFluxFrameId) {
      this._lastFluxFrameId = frameId;
      this.fluxHistory.push(flux);
      if (this.fluxHistory.length > this.fluxWindow) this.fluxHistory.shift();
      this.prevMag = null; // reset FFT state when using worklet
    }
    return flux;
  }

  async _estimateBpmFromBuffer(buffer) {
    if (!buffer) return null;
    const sampleRate = buffer.sampleRate || this.sampleRate || 44100;
    const mono = this._extractMonoBuffer(buffer);
    if (!mono || !mono.length) return null;

    const segments = this._buildBpmAnalysisSegments(buffer, mono, sampleRate);
    if (!segments.length) return null;

    const candidates = [];
    const recordCandidate = (value, source, weight = 1) => {
      const normalized = this._normalizeBpmCandidate(value);
      if (!normalized) return;
      candidates.push({ bpm: normalized, source, weight: Math.max(0.1, weight) });
    };

    let guessFn = null;
    try {
      guessFn = await getBeatDetectorGuess();
    } catch (_) {
      guessFn = null;
    }

    if (typeof guessFn === 'function') {
      for (const segment of segments) {
        try {
          const result = await guessFn(segment.audioBuffer);
          const bpmVal = this._extractBpmValue(result);
          recordCandidate(bpmVal, 'detector', segment.weight ?? 1);
        } catch (_) {
          // per-segment failures are expected for very short/quiet slices
        }
      }
    }

    for (const segment of segments) {
      try {
        const nativeBpm = this._estimateBpmNativeFromMono(segment.mono, sampleRate);
        recordCandidate(nativeBpm, 'native', (segment.weight ?? 1) * 0.75);
      } catch (_) {
        // ignore native estimator failures on individual slices
      }
    }

    const selection = this._selectBestBpmCandidate(candidates);
    if (selection && selection.bpm && selection.bpm > 0) {
      this.bpmEstimate = selection.bpm;
      this.tempoIntervalMs = 60000 / selection.bpm;
      this._lastTempoMs = performance.now();
      this.bpmEstimateConfidence = selection.confidence;
      this.bpmEstimateSource = selection.source;
      return selection.bpm;
    }

    return null;
  }

  _buildBpmAnalysisSegments(buffer, mono, sampleRate) {
    const segments = [];
    const sr = sampleRate || this.sampleRate || 44100;
    if (!mono || !mono.length || !sr) {
      return segments;
    }

    segments.push({
      label: 'full',
      mono,
      audioBuffer: buffer,
      weight: mono.length >= sr * 30 ? 2 : 1.5,
    });

    const totalSamples = mono.length;
    const minSliceSec = 10;
    const maxSliceSec = 24;
    const minSliceSamples = Math.floor(minSliceSec * sr);
    const maxSliceSamples = Math.floor(maxSliceSec * sr);

    if (totalSamples <= minSliceSamples * 2) {
      return segments;
    }

    const sliceSamples = Math.min(maxSliceSamples, totalSamples);
    if (sliceSamples <= 0 || sliceSamples >= totalSamples) {
      return segments;
    }

    const desiredSamples = Math.max(minSliceSamples, Math.min(sliceSamples, Math.floor(totalSamples * 0.45)));
    if (desiredSamples <= 0 || desiredSamples >= totalSamples) {
      return segments;
    }

    const ratios = totalSamples >= desiredSamples * 3 ? [0.2, 0.5, 0.8] : [0.33, 0.66];
    const usedStarts = new Set();
    for (const ratio of ratios) {
      let start = Math.floor(totalSamples * ratio) - Math.floor(desiredSamples / 2);
      if (start < 0) start = 0;
      if (start > totalSamples - desiredSamples) start = totalSamples - desiredSamples;
      if (start < 0 || start >= totalSamples - 4) continue;
      const startKey = Math.round(start / Math.max(1, sr / 5));
      if (usedStarts.has(startKey)) continue;
      usedStarts.add(startKey);
      const monoSegment = mono.subarray(start, start + desiredSamples);
      const audioSegment = this._createAudioBufferFromMonoSegment(monoSegment, sr);
      if (audioSegment) {
        segments.push({
          label: `slice-${Math.round(ratio * 100)}`,
          mono: monoSegment,
          audioBuffer: audioSegment,
          weight: 1,
        });
      }
    }

    return segments;
  }

  _createAudioBufferFromMonoSegment(monoSegment, sampleRate) {
    if (!monoSegment || !monoSegment.length || !this.ctx) return null;
    try {
      const audioBuffer = this.ctx.createBuffer(1, monoSegment.length, sampleRate || this.sampleRate || 44100);
      try {
        audioBuffer.copyToChannel(monoSegment, 0, 0);
      } catch (_) {
        const channel = audioBuffer.getChannelData(0);
        channel.set(monoSegment);
      }
      return audioBuffer;
    } catch (err) {
      console.warn('Failed to create BPM slice buffer', err);
      return null;
    }
  }

  _extractBpmValue(result) {
    if (typeof result === 'number' && isFinite(result)) return result;
    if (result && typeof result.bpm === 'number' && isFinite(result.bpm)) return result.bpm;
    const tempo = result?.tempo;
    if (tempo && typeof tempo.bpm === 'number' && isFinite(tempo.bpm)) return tempo.bpm;
    return null;
  }

  _normalizeBpmCandidate(value) {
    if (typeof value !== 'number' || !isFinite(value) || value <= 0) return null;
    let bpm = value;
    while (bpm > 0 && bpm < 30) bpm *= 2;
    while (bpm > 300) bpm *= 0.5;
    if (bpm < 30 || bpm > 300) return null;
    if (bpm < 60) bpm *= 2;
    if (bpm > 200) bpm *= 0.5;
    if (bpm < 60 || bpm > 200) return null;
    if (bpm < 80 && bpm * 2 <= 180) bpm *= 2;
    if (bpm > 180 && bpm * 0.5 >= 80) bpm *= 0.5;
    return bpm;
  }

  _selectBestBpmCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const tolerance = 1.25;
    const totalWeight = candidates.reduce((sum, c) => sum + (c.weight || 0), 0) || 1;
    const buckets = [];

    for (const cand of candidates) {
      if (!cand || !cand.bpm || !isFinite(cand.bpm)) continue;
      let bucket = null;
      for (const existing of buckets) {
        if (Math.abs(existing.center - cand.bpm) <= tolerance) {
          bucket = existing;
          break;
        }
      }
      if (!bucket) {
        bucket = {
          center: cand.bpm,
          weight: 0,
          values: [],
          sources: new Map(),
        };
        buckets.push(bucket);
      }
      const currentCount = bucket.values.length;
      bucket.center = (bucket.center * currentCount + cand.bpm) / (currentCount + 1);
      bucket.weight += cand.weight || 0;
      bucket.values.push(cand.bpm);
      bucket.sources.set(cand.source || 'unknown', (bucket.sources.get(cand.source || 'unknown') || 0) + (cand.weight || 0));
    }

    buckets.sort((a, b) => (b.weight - a.weight) || (a.center - b.center));
    const best = buckets[0];
    if (!best) return null;
    const avg = best.values.reduce((sum, v) => sum + v, 0) / best.values.length;
    const primarySource = Array.from(best.sources.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
    const confidence = this._clamp(best.weight / totalWeight, 0, 1);
    return { bpm: Math.round(avg), confidence, source: primarySource };
  }

  // Minimal, dependency-free BPM estimator using energy-onset autocorrelation.
  _estimateBpmNativeFromBuffer(buffer) {
    if (!buffer) return 0;
    const sr = buffer.sampleRate || this.sampleRate || 44100;
    const mono = this._extractMonoBuffer(buffer);
    if (!mono || !mono.length) return 0;
    return this._estimateBpmNativeFromMono(mono, sr);
  }

  _estimateBpmNativeFromMono(mono, sampleRate) {
    if (!mono || mono.length < 4096) return 0;
    const sr = sampleRate || this.sampleRate || 44100;
    const hop = 512; // ~11.6ms @ 44.1k
    const size = 1024;
    if (mono.length < size * 4) return 0;

    // Build positive-onset envelope from log-energy differences
    const frames = Math.max(1, Math.floor((mono.length - size) / hop));
    const onset = new Float32Array(frames);
    let prev = 0;
    for (let i = 0; i < frames; i++) {
      const off = i * hop;
      let e = 0;
      const limit = Math.min(size, mono.length - off);
      for (let j = 0; j < limit; j++) {
        const v = mono[off + j]; e += v * v;
      }
      const loge = Math.log(1e-9 + e);
      const d = loge - prev; prev = loge;
      onset[i] = d > 0 ? d : 0;
    }
    // Normalize and remove DC
    let mean = 0; for (let i = 0; i < onset.length; i++) mean += onset[i]; mean /= Math.max(1, onset.length);
    for (let i = 0; i < onset.length; i++) onset[i] = Math.max(0, onset[i] - mean);
    let maxv = 0; for (let i = 0; i < onset.length; i++) maxv = Math.max(maxv, onset[i]);
    if (maxv > 0) { for (let i = 0; i < onset.length; i++) onset[i] /= maxv; }

    const fps = sr / hop; // envelope frames per second
    const minBpm = 60, maxBpm = 200;
    const minLag = Math.max(1, Math.round(fps * 60 / maxBpm));
    const maxLag = Math.min(onset.length - 1, Math.round(fps * 60 / minBpm));
    if (maxLag <= minLag + 1) return 0;

    // Autocorrelation in BPM search window
    let bestLag = 0; let bestScore = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let acc = 0;
      for (let i = lag; i < onset.length; i++) acc += onset[i] * onset[i - lag];
      // Penalize likely double/half tempos by checking harmonic lags
      const half = lag >> 1; const dbl = lag << 1;
      if (half >= minLag) acc *= 1.0 - 0.1 * (onset[half] || 0);
      if (dbl <= maxLag) acc *= 1.0 - 0.05 * (onset[dbl] || 0);
      if (acc > bestScore) { bestScore = acc; bestLag = lag; }
    }
    if (bestLag <= 0) return 0;
    let bpm = 60 * fps / bestLag;
    // Snap to musically plausible octave (prefer 80..180)
    while (bpm < 80) bpm *= 2;
    while (bpm > 180) bpm *= 0.5;
    return bpm;
  }

  _ensureLiveBuffer() {
    const sr = this.sampleRate || 44100;
    const desiredLength = Math.max(1, Math.floor(sr * this._liveBufferSec));
    if (!this._liveBuffer || this._liveBuffer.length !== desiredLength) {
      this._liveBuffer = new Float32Array(desiredLength);
      this._liveBufferWrite = 0;
      this._liveBufferFilled = 0;
    }
  }

  _appendToLiveBuffer(samples) {
    if (!samples || !samples.length) return;
    this._ensureLiveBuffer();
    const buf = this._liveBuffer;
    const N = buf.length;
    let w = this._liveBufferWrite;
    for (let i = 0; i < samples.length; i++) {
      buf[w++] = samples[i];
      if (w >= N) w = 0;
    }
    this._liveBufferWrite = w;
    this._liveBufferFilled = Math.min(N, this._liveBufferFilled + samples.length);
  }

  _buildLiveAudioBuffer(seconds = 12) {
    if (!this.ctx || !this._liveBuffer || !this._liveBufferFilled) return null;
    const sr = this.sampleRate || 44100;
    const want = Math.max(0, Math.floor(seconds * sr));
    const N = Math.min(want, this._liveBufferFilled);
    if (N < sr * 4) { // need at least ~4s to get a stable guess
      return null;
    }
    const out = new Float32Array(N);
    const ring = this._liveBuffer;
    const R = ring.length;
    let start = this._liveBufferWrite - N;
    while (start < 0) start += R;
    const firstLen = Math.min(N, R - start);
    out.set(ring.subarray(start, start + firstLen), 0);
    const remaining = N - firstLen;
    if (remaining > 0) {
      out.set(ring.subarray(0, remaining), firstLen);
    }
    const audioBuf = this.ctx.createBuffer(1, N, sr);
    try {
      audioBuf.copyToChannel(out, 0, 0);
    } catch (_) {
      const ch0 = audioBuf.getChannelData(0);
      ch0.set(out);
    }
    return audioBuf;
  }

  _ensureMeydaLoaded() {
    if (!this._meydaPromise) {
      this._meydaPromise = loadMeyda()
        .then((mod) => {
          this.meyda = mod;
          return mod;
        })
        .catch((err) => {
          console.warn('Meyda failed to load', err);
          this.meyda = null;
          this._meydaPromise = null;
          return null;
        });
    }
    return this._meydaPromise;
  }

  _ensureAubioLoaded() {
    if (this._aubioPromise) {
      return this._aubioPromise;
    }
    this._aubioPromise = loadAubio()
      .then(async (factory) => {
        if (typeof factory === 'function') {
          const module = await factory();
          this._aubioModule = module;
          this._setupAubioNodes();
          return module;
        }
        this._aubioModule = factory;
        this._setupAubioNodes();
        return factory;
      })
      .catch((err) => {
        console.warn('Aubio failed to load', err);
        this._aubioModule = null;
        this._aubioPromise = null;
        return null;
      });
    return this._aubioPromise;
  }

  _setupAubioNodes() {
    const module = this._aubioModule;
    if (!module) return;
    const sr = this.sampleRate || 44100;
    if (this._aubioConfiguredSampleRate === sr && this._aubio.onset && this._aubio.pitch && this._aubio.tempo) {
      return;
    }

    const bufferSize = 512;
    const hopSize = 512;

    try {
      this._aubio.onset = new module.Onset('default', bufferSize, hopSize, sr);
    } catch (err) {
      console.warn('Aubio onset unavailable', err);
      this._aubio.onset = null;
    }
    try {
      this._aubio.tempo = new module.Tempo('default', bufferSize, hopSize, sr);
    } catch (err) {
      console.warn('Aubio tempo unavailable', err);
      this._aubio.tempo = null;
    }
    try {
      this._aubio.pitch = new module.Pitch('yin', bufferSize, hopSize, sr);
      if (this._aubio.pitch.setTolerance) this._aubio.pitch.setTolerance(0.2);
    } catch (err) {
      console.warn('Aubio pitch unavailable', err);
      this._aubio.pitch = null;
    }

    this._aubioConfiguredSampleRate = sr;

    if (this._aubioQueue.length) {
      const queued = this._aubioQueue.slice();
      this._aubioQueue.length = 0;
      for (const item of queued) {
        this._processAubioFrame(item.buffer, item.frameId);
      }
    }
  }

  _enqueueAubioFrame(buffer, frameId = -1) {
    if (!buffer) return;
    if (this._aubioModule && this._aubio.onset && this._aubio.pitch) {
      if (frameId === this._aubioLastFrameId) return;
      this._processAubioFrame(buffer, frameId);
      return;
    }

    if (this._aubioQueue.length > 12) {
      this._aubioQueue.shift();
    }
    this._aubioQueue.push({ buffer: buffer.slice(0), frameId });
    this._ensureAubioLoaded();
  }

  _processAubioFrame(buffer, frameId = -1) {
    if (!buffer || !buffer.length) return;
    if (frameId === this._aubioLastFrameId) return;
    this._aubioLastFrameId = frameId;

    this._ensureAubioLoaded();
    if (!this._aubioModule) return;
    this._setupAubioNodes();

    try {
      if (this._aubio.onset) {
        const onset = this._aubio.onset.do(buffer);
        if (onset) {
          this.aubioFeatures.lastOnsetMs = performance.now();
        }
      }
    } catch (err) {
      // ignore individual frame errors
    }

    try {
      if (this._aubio.tempo) {
        this._aubio.tempo.do(buffer);
        const bpm = typeof this._aubio.tempo.getBpm === 'function' ? this._aubio.tempo.getBpm() : null;
        const conf = typeof this._aubio.tempo.getConfidence === 'function' ? this._aubio.tempo.getConfidence() : 0;
        if (typeof bpm === 'number' && isFinite(bpm) && bpm > 30 && bpm < 300) {
          this.aubioFeatures.tempoBpm = bpm;
          this.aubioFeatures.tempoConf = conf || 0;
        }
      }
    } catch (err) {
      // ignore
    }

    try {
      if (this._aubio.pitch) {
        const pitch = this._aubio.pitch.do(buffer);
        const conf = typeof this._aubio.pitch.getConfidence === 'function' ? this._aubio.pitch.getConfidence() : 0;
        if (typeof pitch === 'number' && isFinite(pitch) && pitch > 0) {
          this.aubioFeatures.pitchHz = pitch;
          this.aubioFeatures.pitchConf = conf || 0;
        } else {
          this.aubioFeatures.pitchConf = conf || this.aubioFeatures.pitchConf;
        }
      }
    } catch (err) {
      // ignore
    }
  }

  async _initEssentiaWorker() {
    if (this._essentiaWorker && this._essentiaReady) {
      return this._essentiaWorker;
    }
    if (this._essentiaWorker && this._essentiaReadyPromise) {
      await this._essentiaReadyPromise;
      return this._essentiaWorker;
    }

    const workerUrl = new URL('../public/workers/essentia-worker.js', import.meta.url);
    this._essentiaWorker = new Worker(workerUrl.href, { type: 'module' });
    this._essentiaReady = false;
    this._essentiaReadyPromise = new Promise((resolve) => {
      this._essentiaReadyResolver = resolve;
    });
    this._essentiaWorker.onmessage = (event) => this._handleEssentiaMessage(event);
    this._essentiaWorker.onerror = (err) => {
      console.error('Essentia worker error', err);
      this._essentiaReady = false;
    };
    try {
      this._essentiaWorker.postMessage({ type: 'init' });
    } catch (err) {
      console.warn('Failed to init Essentia worker', err);
      throw err;
    }
    await this._essentiaReadyPromise;
    return this._essentiaWorker;
  }

  _handleEssentiaMessage(event) {
    const data = event?.data;
    if (!data) return;
    if (data.type === 'ready') {
      this._essentiaReady = true;
      if (this._essentiaReadyResolver) {
        this._essentiaReadyResolver();
        this._essentiaReadyResolver = null;
      }
      this._essentiaReadyPromise = Promise.resolve(this._essentiaWorker);
      return;
    }
    if (data.type === 'error') {
      // Keep console details for developers, but show a concise toast to users
      console.warn('Essentia worker error', data.error);
      try {
        showToast('Beat grid unavailable (analysis module failed). Playback continues.');
      } catch(_) {}
      return;
    }
    if (data.type === 'result') {
      const { jobId, result } = data;
      if (jobId && jobId === this._essentiaCurrentJobId) {
        this._applyEssentiaResult(result);
      }
    }
  }

  // toast handled via centralized helper in toast.js

  async _runEssentiaAnalysis(buffer) {
    try {
      await this._initEssentiaWorker();
    } catch (err) {
      return;
    }
    if (!this._essentiaWorker) return;

    const mono = this._extractMonoBuffer(buffer);
    if (!mono) return;

    const jobId = ++this._essentiaCurrentJobId;
    this._essentiaPendingJobId = jobId;
    try {
      this._essentiaWorker.postMessage({
        type: 'analyze',
        jobId,
        payload: {
          sampleRate: buffer.sampleRate,
          duration: buffer.duration,
          channelData: mono,
        },
      }, [mono.buffer]);
    } catch (err) {
      console.warn('Failed to post Essentia job', err);
    }
  }

  _extractMonoBuffer(buffer) {
    if (!buffer) return null;
    const length = buffer.length;
    const channels = buffer.numberOfChannels || 1;
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const channelData = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        mono[i] += channelData[i] / channels;
      }
    }
    return mono;
  }

  _applyEssentiaResult(result) {
    if (!result) return;
    this.beatGrid = {
      bpm: result.bpm || 0,
      confidence: result.confidence || 0,
      beatTimes: Array.isArray(result.beatTimes) ? result.beatTimes.slice() : [],
      downbeats: Array.isArray(result.downbeats) ? result.downbeats.slice() : [],
      loudness: result.loudness || null,
      source: 'essentia',
      updatedAt: performance.now(),
      duration: result.duration || 0,
    };

    // Also propagate BPM estimate from analysis so UI updates even if guess() failed.
    const bpm = typeof result.bpm === 'number' && isFinite(result.bpm) ? Math.round(result.bpm) : 0;
    if (bpm > 30 && bpm < 300) {
      this.bpmEstimate = bpm;
      this.tempoIntervalMs = 60000 / bpm;
      this._lastTempoMs = performance.now();
      this.bpmEstimateConfidence = this._clamp(result.confidence || 0, 0, 1);
      this.bpmEstimateSource = 'essentia';
    }
  }

  quantizeToGrid(timeSeconds, grid = this.beatGrid) {
    if (!grid || !Array.isArray(grid.beatTimes) || grid.beatTimes.length === 0) {
      return null;
    }
    const beats = grid.beatTimes;
    let lo = 0;
    let hi = beats.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < timeSeconds) lo = mid + 1;
      else hi = mid - 1;
    }
    const idx = Math.min(beats.length - 1, Math.max(0, lo));
    const prevIdx = Math.max(0, idx - 1);
    const candidateA = beats[idx];
    const candidateB = beats[prevIdx];
    const target = (Math.abs(candidateA - timeSeconds) <= Math.abs(candidateB - timeSeconds)) ? { time: candidateA, index: idx } : { time: candidateB, index: prevIdx };
    const interval = grid.bpm ? 60 / grid.bpm : (target.index + 1 < beats.length ? beats[target.index + 1] - beats[target.index] : 0);
    const driftSec = timeSeconds - target.time;
    return {
      quantizedTime: target.time,
      beatIndex: target.index,
      driftSeconds: driftSec,
      driftMs: driftSec * 1000,
      intervalSeconds: interval,
      bpm: grid.bpm,
      confidence: grid.confidence,
    };
  }

  _maybeRunMeyda(now) {
    if (!this.analyser) return this.meydaFeatures;
    this._ensureMeydaLoaded();
    if (!this.meyda || typeof this.meyda.extract !== 'function') return this.meydaFeatures;

    if (now - this._meydaLastExtract < this._meydaIntervalMs) {
      return this.meydaFeatures;
    }

    let bufferForAnalysis = null;
    let bufferSize = 0;
    let frameIdForMeyda = -1;
    let aubioCandidate = null;

    if (this.workletEnabled && this._workletFrame && this._workletFrameId !== this._lastMeydaFrameId) {
      bufferForAnalysis = this._workletFrame;
      bufferSize = bufferForAnalysis.length;
      frameIdForMeyda = this._workletFrameId;
    } else {
      if (!this.timeDataFloat || this.timeDataFloat.length !== this.analyser.fftSize) {
        this.timeDataFloat = new Float32Array(this.analyser.fftSize);
      }
      try {
        this.analyser.getFloatTimeDomainData(this.timeDataFloat);
      } catch (err) {
        return this.meydaFeatures;
      }
      bufferForAnalysis = this.timeDataFloat;
      bufferSize = bufferForAnalysis.length;
      aubioCandidate = this._makeAubioBuffer(bufferForAnalysis);
    }

    this._meydaLastExtract = now;
    if (frameIdForMeyda >= 0) {
      this._lastMeydaFrameId = frameIdForMeyda;
      if (!aubioCandidate) {
        aubioCandidate = this._makeAubioBuffer(bufferForAnalysis);
      }
    }

    const params = {
      bufferSize,
      sampleRate: this.sampleRate || 44100,
      numberOfMFCCCoefficients: 13,
    };

    let result;
    try {
      result = this.meyda.extract(
        ['mfcc', 'chroma', 'spectralFlatness', 'spectralRolloff'],
        bufferForAnalysis,
        params,
      );
    } catch (err) {
      // Meyda may throw if fed denormal data; skip frame
      return this.meydaFeatures;
    }

    if (aubioCandidate) {
      const frameId = frameIdForMeyda >= 0 ? frameIdForMeyda : ++this._aubioFallbackCounter;
      this._enqueueAubioFrame(aubioCandidate, frameId);
    }

    // If worklet is unavailable, still accumulate a best-effort live buffer
    if (!this.workletEnabled && bufferForAnalysis) {
      this._appendToLiveBuffer(bufferForAnalysis);
    }

    if (!result) return this.meydaFeatures;

    const mfccRaw = Array.isArray(result.mfcc) ? result.mfcc.slice(0, 13) : [];
    while (mfccRaw.length < 13) mfccRaw.push(0);
    const chromaRaw = Array.isArray(result.chroma) ? result.chroma.slice(0, 12) : [];
    while (chromaRaw.length < 12) chromaRaw.push(0);

    const normalizedMfcc = mfccRaw.map((v) => 0.5 + 0.5 * Math.tanh((Number.isFinite(v) ? v : 0) / 20));
    const normalizedChroma = chromaRaw.map((v) => this._clamp(Number.isFinite(v) ? v : 0, 0, 1));
    const flatness = this._clamp(Number.isFinite(result.spectralFlatness) ? result.spectralFlatness : 0, 0, 1);
    const rolloffNorm = this._clamp(
      Number.isFinite(result.spectralRolloff) && this.sampleRate
        ? result.spectralRolloff / (this.sampleRate / 2)
        : 0,
      0,
      1,
    );

    const alpha = this._clamp(this._meydaSmoothing, 0, 0.95);
    const inv = 1 - alpha;
    for (let i = 0; i < this.meydaFeatures.mfcc.length; i++) {
      this.meydaFeatures.mfcc[i] = this.meydaFeatures.mfcc[i] * alpha + (normalizedMfcc[i] ?? 0.5) * inv;
    }
    for (let i = 0; i < this.meydaFeatures.chroma.length; i++) {
      this.meydaFeatures.chroma[i] = this.meydaFeatures.chroma[i] * alpha + (normalizedChroma[i] ?? 0) * inv;
    }
    this.meydaFeatures.flatness = this.meydaFeatures.flatness * alpha + flatness * inv;
    this.meydaFeatures.rolloff = this.meydaFeatures.rolloff * alpha + rolloffNorm * inv;

    return this.meydaFeatures;
  }

  _clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  _makeAubioBuffer(source) {
    if (!source || !source.length) return null;
    const targetSize = 512;
    if (source.length === targetSize) {
      return source.slice(0);
    }
    const target = new Float32Array(targetSize);
    const stride = source.length / targetSize;
    for (let i = 0; i < targetSize; i++) {
      const idx = Math.min(source.length - 1, Math.floor(i * stride));
      target[i] = source[idx];
    }
    return target;
  }

  _computeRMS(timeData) {
    // timeData 0..255, center ~128
    let sumSq = 0; const N = timeData.length;
    for (let i = 0; i < N; i++) { const v = (timeData[i] - 128) / 128; sumSq += v * v; }
    const rms = Math.sqrt(sumSq / N);
    return rms; // 0..~1
  }

  _computeBands(freqData) {
    // freqData 0..255, linear bins up to Nyquist
    const sr = this.sampleRate; const binHz = sr / 2 / freqData.length; // freq per bin
    let sub = 0, bass = 0, mid = 0, treble = 0; let sC = 0, bC = 0, mC = 0, tC = 0;
    const subHz = Math.max(20, Math.min(this.bandSplit.sub || 90, (this.bandSplit.low || 180) - 5));
    for (let i = 0; i < freqData.length; i++) {
      const f = i * binHz; const v = freqData[i] / 255;
      if (f < subHz) { sub += v; sC++; }
      else if (f < this.bandSplit.low) { bass += v; bC++; }
      else if (f < this.bandSplit.mid) { mid += v; mC++; }
      else { treble += v; tC++; }
    }
    sub = sC ? sub / sC : 0; bass = bC ? bass / bC : 0; mid = mC ? mid / mC : 0; treble = tC ? treble / tC : 0;

    // Adaptive gain control (rolling peak) for rave music dynamics
    if (this.bandAGCEnabled) {
      this.bandPeak.sub = Math.max(this.bandPeak.sub * this.bandAGCDecay, sub);
      this.bandPeak.bass = Math.max(this.bandPeak.bass * this.bandAGCDecay, bass);
      this.bandPeak.mid = Math.max(this.bandPeak.mid * this.bandAGCDecay, mid);
      this.bandPeak.treble = Math.max(this.bandPeak.treble * this.bandAGCDecay, treble);
    }

    // Normalize by current peaks to get 0..1 responsiveness across tracks
    const ns = this.bandAGCEnabled && this.bandPeak.sub > 1e-6 ? this._clamp(sub / this.bandPeak.sub, 0, 1) : this._clamp(sub, 0, 1);
    const nb = this.bandAGCEnabled && this.bandPeak.bass > 1e-6 ? this._clamp(bass / this.bandPeak.bass, 0, 1) : this._clamp(bass, 0, 1);
    const nm = this.bandAGCEnabled && this.bandPeak.mid > 1e-6 ? this._clamp(mid / this.bandPeak.mid, 0, 1) : this._clamp(mid, 0, 1);
    const nt = this.bandAGCEnabled && this.bandPeak.treble > 1e-6 ? this._clamp(treble / this.bandPeak.treble, 0, 1) : this._clamp(treble, 0, 1);

    // Attack/Release envelope for each band to keep motion musical
    const attack = this.envAttack; const release = this.envRelease;
    const stepEnv = (env, val) => (val > env) ? (env + (val - env) * attack) : (env + (val - env) * release);
    this.bandEnv.sub = stepEnv(this.bandEnv.sub, ns);
    this.bandEnv.bass = stepEnv(this.bandEnv.bass, nb);
    this.bandEnv.mid = stepEnv(this.bandEnv.mid, nm);
    this.bandEnv.treble = stepEnv(this.bandEnv.treble, nt);

    return { sub, bass, mid, treble, norm: { sub: ns, bass: nb, mid: nm, treble: nt }, env: { ...this.bandEnv } };
  }

  _computeCentroid(freqData) {
    const sr = this.sampleRate; const N = freqData.length; const binHz = sr / 2 / N;
    let num = 0, den = 0;
    for (let i = 0; i < N; i++) { const mag = freqData[i] / 255; const f = i * binHz; num += f * mag; den += mag; }
    const centroidHz = den > 0 ? num / den : 0; // 0..Nyquist
    // Normalize roughly to 0..1 over 0..8000 Hz for music brightness (cap)
    const norm = Math.min(1, centroidHz / 8000);
    return { hz: centroidHz, norm };
  }

  _computeFlux(freqData) {
    // Normalize spectrum to 0..1
    const N = freqData.length; const mag = new Float32Array(N);
    for (let i = 0; i < N; i++) mag[i] = freqData[i] / 255;
    let flux = 0;
    if (this.prevMag) {
      for (let i = 0; i < N; i++) {
        const d = mag[i] - this.prevMag[i]; if (d > 0) flux += d;
      }
    }
    this.prevMag = mag;
    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > this.fluxWindow) this.fluxHistory.shift();
    return flux;
  }

  _computeBassFlux(freqData) {
    const N = freqData.length;
    const sr = this.sampleRate || 48000;
    const binHz = sr / 2 / N;
    const cutoffHz = Math.max(40, Math.min(this.bandSplit.low || 180, 600));
    const cutoffBin = Math.max(1, Math.min(N >> 1, Math.floor(cutoffHz / binHz)));
    if (!this._prevMagBass || this._prevMagBass.length !== cutoffBin) {
      this._prevMagBass = new Float32Array(cutoffBin);
    }
    let flux = 0;
    for (let i = 0; i < cutoffBin; i++) {
      const mag = (freqData[i] / 255);
      const diff = mag - this._prevMagBass[i];
      if (diff > 0) flux += diff;
      this._prevMagBass[i] = mag;
    }
    flux /= cutoffBin;
    this.bassFluxHistory.push(flux);
    if (this.bassFluxHistory.length > this.bassFluxWindow) this.bassFluxHistory.shift();
    return flux;
  }

  _getPlaybackTimeSeconds() {
    if (!this.isPlayingFile || !this.ctx) return null;
    const dur = this._fileDurationSec || 0;
    if (!(dur > 0)) return null;
    const t = (this.ctx.currentTime - (this._fileStartCtxTimeSec || 0));
    if (!(t >= 0)) return null;
    return t % dur;
  }

  _isNearDownbeat(nowSec, toleranceMs = 80) {
    const grid = this.beatGrid;
    if (!grid || !Array.isArray(grid.downbeats) || grid.downbeats.length === 0) return false;
    const db = grid.downbeats;
    // binary search nearest
    let lo = 0, hi = db.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (db[mid] < nowSec) lo = mid + 1; else hi = mid - 1;
    }
    const idx = Math.min(db.length - 1, Math.max(0, lo));
    const prevIdx = Math.max(0, idx - 1);
    const nearest = Math.abs(db[idx] - nowSec) <= Math.abs(db[prevIdx] - nowSec) ? db[idx] : db[prevIdx];
    const deltaMs = Math.abs(nowSec - nearest) * 1000;
    return deltaMs <= Math.max(10, toleranceMs);
  }

  _percentile(sortedArray, p) {
    const arr = (sortedArray || []).slice().sort((a,b)=>a-b);
    if (!arr.length) return 0;
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))));
    return arr[idx];
  }

  _detectBeat(flux, bands) {
    if (this.fluxHistory.length < 5) return false;
    const now = performance.now();
    const refractory = Number.isFinite(this.beatRefractoryMs) && this.beatRefractoryMs > 0 ? this.beatRefractoryMs : this.beatCooldownMs;
    if (now - this._lastBeatMs < refractory) return false;
    // Energy gate: require sufficient bass envelope to accept any beat.
    const bassEnv = bands && bands.env ? (bands.env.bass ?? 0) : 0;
    if (bassEnv < (this.beatEnergyFloor ?? 0)) return false;
    // Adaptive threshold: mean + k*std
    const mean = this.fluxHistory.reduce((a,b)=>a+b,0) / this.fluxHistory.length;
    const variance = this.fluxHistory.reduce((a,b)=>a+(b-mean)*(b-mean),0) / this.fluxHistory.length;
    const std = Math.sqrt(variance);
    const threshold = mean + std * (0.8 + 0.8 * this.sensitivity); // sensitivity 0..2
    if (flux > threshold) { this._lastBeatMs = now; return true; }
    return false;
  }

  /**
   * Main update function - called every frame to extract audio features.
   * 
   * This is the heart of the audio analysis. It:
   * 1. Reads current audio data from the analyser
   * 2. Processes it through various algorithms (RMS, frequency bands, flux, etc.)
   * 3. Detects beats, drops, and other musical events
   * 4. Integrates results from external libraries (Aubio, Meyda, Essentia)
   * 5. Returns a comprehensive features object
   * 
   * This function is called every frame (~60 times per second) from main.js.
   * 
   * @returns {Object|null} Features object with all extracted audio features, or null if analyser not ready
   */
  update() {
    // Must have analyser node to extract data
    if (!this.analyser) return null;
    
    // Get current audio data from analyser
    // These update the timeData and freqData arrays with current values
    this.analyser.getByteTimeDomainData(this.timeData);   // Waveform data (time domain)
    this.analyser.getByteFrequencyData(this.freqData);    // Frequency spectrum data (frequency domain)

    // Optional front-end noise gate: attenuate low-level ambient energy before
    // feature extraction. Helps reduce false-positive beats in noisy venues.
    if (this.noiseGateEnabled) {
      const thr = this._clamp(this.noiseGateThreshold || 0, 0, 0.95);
      // Time-domain gate (map 0..255 -> [-1,1], apply soft gate, map back)
      const td = this.timeData;
      for (let i = 0; i < td.length; i++) {
        let v = (td[i] - 128) / 128;
        const sign = v < 0 ? -1 : 1;
        const a = Math.abs(v);
        const out = a <= thr ? 0 : sign * ((a - thr) / (1 - thr));
        td[i] = Math.max(0, Math.min(255, Math.round(128 + 128 * out)));
      }
      // Frequency-domain gate (normalize, gate below threshold, renormalize)
      const fd = this.freqData;
      for (let i = 0; i < fd.length; i++) {
        const v = fd[i] / 255;
        const out = v <= thr ? 0 : (v - thr) / (1 - thr);
        fd[i] = Math.max(0, Math.min(255, Math.round(out * 255)));
      }
    }

    const useWorkletRms = this.workletEnabled && this._workletFrameId >= 0;
    const rms = useWorkletRms ? this._workletFeatures.rms : this._computeRMS(this.timeData);
    const bands = this._computeBands(this.freqData);
    const centroid = this._computeCentroid(this.freqData);
    const fluxFromWorklet = this._consumeWorkletFlux();
    const flux = fluxFromWorklet ?? this._computeFlux(this.freqData);
    const bassFlux = this._computeBassFlux(this.freqData);
    let beat = this._detectBeat(flux, bands);

    // Live tempo assist: prefer file BPM; else use Aubio tempo for live sources
    const now = performance.now();
    if (this.tempoAssistEnabled) {
      if (this.isPlayingFile) {
        // keep bpmEstimate from file analysis if available
        if (this.bpmEstimate && this.bpmEstimate > 0) {
          this.tempoIntervalMs = 60000 / this.bpmEstimate;
        }
      } else {
        const liveBpm = this.aubioFeatures.tempoBpm;
        const liveConf = this.aubioFeatures.tempoConf;
        if (typeof liveBpm === 'number' && isFinite(liveBpm) && liveBpm > 30 && liveBpm < 300 && (liveConf ?? 0) >= 0.05) {
          const rounded = Math.round(liveBpm);
          const intervalMs = rounded > 0 ? 60000 / rounded : 0;
          if (!this.bpmEstimate || Math.abs(rounded - this.bpmEstimate) >= 1) {
            this.bpmEstimate = rounded;
          }
          if (intervalMs > 0) {
            this.tempoIntervalMs = intervalMs;
          }
          this._lastTempoMs = now;
          this.bpmEstimateSource = 'aubio-live';
          this.bpmEstimateConfidence = this._clamp(liveConf || 0, 1e-3, 1);
        }
      }
    }

    // Tempo-assist beat pulse (file playback or live) and/or Tap-Quantized grid
    let quantBeat = false;
    const gridInterval = (this.tapQuantizeEnabled && this.tapTempoIntervalMs > 0)
      ? this.tapTempoIntervalMs
      : (this.tempoAssistEnabled && this.tempoIntervalMs > 0 ? this.tempoIntervalMs : 0);
    if (gridInterval > 0) {
      if (now - this._lastQuantizeMs >= gridInterval) {
        const steps = Math.floor((now - this._lastQuantizeMs) / gridInterval);
        this._lastQuantizeMs += steps * gridInterval;
        quantBeat = true;
      }
    }

    // Align detected onsets to grid by resetting phase on real beat
    if (beat && gridInterval > 0) {
      this._lastQuantizeMs = now;
      // Reset bar phase so the next quantized beat is treated as downbeat for gating
      if (this.dropBarGatingEnabled) this._beatIndexForDrop = -1;
    }
    const aubioOnsetPulse = this.aubioFeatures.lastOnsetMs > 0 && (now - this.aubioFeatures.lastOnsetMs) < 150;

    beat = beat || quantBeat || aubioOnsetPulse;

    // Smooth
    const a = this.smoothing; const inv = 1 - a;
    this.levels.rmsEMA = this.levels.rmsEMA * a + rms * inv;
    this.levels.bandsEMA.bass = this.levels.bandsEMA.bass * a + bands.bass * inv;
    this.levels.bandsEMA.mid = this.levels.bandsEMA.mid * a + bands.mid * inv;
    this.levels.bandsEMA.treble = this.levels.bandsEMA.treble * a + bands.treble * inv;
    this.levels.centroidEMA = this.levels.centroidEMA * a + centroid.norm * inv;

    const meyda = this._maybeRunMeyda(now);

    // Build/Drop detection (beat-aware)
    let drop = false;
    let isBuilding = false;
    let buildLevel = this._buildLevel;
    let centroidSlope = this._centroidSlopeEma;
    if (this.dropEnabled) {
      // Choose flux source for build metric
      let posZ = 0;
      if (this.dropUseBassFlux && this.bassFluxHistory.length >= 5) {
        const m = this.bassFluxHistory.reduce((a,b)=>a+b,0) / this.bassFluxHistory.length;
        const v = this.bassFluxHistory.reduce((a,b)=>{ const d=b-m; return a + d*d; },0) / this.bassFluxHistory.length;
        const s = Math.sqrt(Math.max(v, 1e-6));
        posZ = Math.max(0, (bassFlux - m) / s);
      } else {
        const z = this._workletFeatures && this._workletFeatures.fluxStd > 0
          ? (flux - this._workletFeatures.fluxMean) / Math.max(1e-3, this._workletFeatures.fluxStd)
          : 0;
        posZ = Math.max(0, z);
      }
      buildLevel = buildLevel * 0.8 + posZ * 0.2;
      const cDelta = centroid.norm - (this._centroidPrev || centroid.norm);
      this._centroidPrev = centroid.norm;
      centroidSlope = centroidSlope * (1 - this._centroidSlopeAlpha) + cDelta * this._centroidSlopeAlpha;

      if (beat || quantBeat) {
        // Collect samples for adaptive thresholding (during warmup)
        if (this.autoDropThresholdsEnabled && !this._autoThrApplied) {
          const negSlope = Math.max(0, -cDelta);
          this._autoBassOnBeats.push(bands.env?.bass ?? 0);
          if (negSlope > 0) this._autoCentroidNegOnBeats.push(negSlope);
        }
        // Maintain bar-phase state for optional drop gating
        if (this.dropBarGatingEnabled) {
          if (this._beatIndexForDrop == null || this._beatIndexForDrop < 0) {
            this._beatIndexForDrop = 0; // treat this beat as downbeat
          } else {
            const nBeats = Math.max(1, Math.floor(this.dropGateBeatsPerBar || 4));
            this._beatIndexForDrop = (this._beatIndexForDrop + 1) % nBeats;
          }
        }
        if (posZ > this.dropFluxThresh) {
          this._buildBeats += 1; isBuilding = true;
        } else {
          this._buildBeats = Math.max(0, this._buildBeats - 1);
          isBuilding = this._buildBeats > 0;
        }

        const nowMs = performance.now();
        const canDrop = (nowMs - this._lastDropMs) > this.dropCooldownMs;
        let passesGating = true;
        if (this.dropBarGatingEnabled) {
          if (this.isPlayingFile && this.beatGrid && Array.isArray(this.beatGrid.downbeats) && this.beatGrid.downbeats.length) {
            const nowSec = this._getPlaybackTimeSeconds();
            passesGating = nowSec != null ? this._isNearDownbeat(nowSec, this.dropDownbeatGateToleranceMs) : false;
          } else {
            passesGating = (this._beatIndexForDrop === 0);
          }
        }
        if (canDrop && this._buildBeats >= this.dropMinBeats && passesGating) {
          if (centroidSlope < -this.dropCentroidSlopeThresh && (bands.env?.bass ?? 0) > this.dropBassThresh) {
            drop = true; this._lastDropMs = nowMs; this._buildBeats = 0; isBuilding = false;
          }
        }
      }
      this._buildLevel = buildLevel; this._centroidSlopeEma = centroidSlope;
      // Apply adaptive thresholds once warmup window passes
      if (this.autoDropThresholdsEnabled && !this._autoThrApplied) {
        const started = this._autoThrStartMs || (this._autoThrStartMs = performance.now());
        if (performance.now() - started >= this.autoDropCalDurationMs) {
          if (this._autoBassOnBeats.length >= 6) {
            const p70 = this._percentile(this._autoBassOnBeats, 0.70);
            this.dropBassThresh = this._clamp(p70, 0.35, 0.85);
          }
          if (this._autoCentroidNegOnBeats.length >= 6) {
            const p60 = this._percentile(this._autoCentroidNegOnBeats, 0.60);
            this.dropCentroidSlopeThresh = this._clamp(p60, 0.008, 0.05);
          }
          this._autoThrApplied = true;
        }
      }
    }

    return {
      rms: rms,
      rmsNorm: Math.min(1, rms * 2.0),
      bands,
      bandsEMA: this.levels.bandsEMA,
      bandEnv: bands.env,
      bandNorm: bands.norm,
      centroidHz: centroid.hz,
      centroidNorm: centroid.norm,
      flux,
      fluxMean: this.workletEnabled ? this._workletFeatures.fluxMean : flux,
      fluxStd: this.workletEnabled ? this._workletFeatures.fluxStd : 0,
      beat,
      drop,
      isBuilding,
      buildLevel,
      lastDropMs: this._lastDropMs,
      bpm: this.bpmEstimate || 0,
      bpmConfidence: this.bpmEstimateConfidence || 0,
      bpmSource: this.bpmEstimateSource || '',
      tapBpm: this.tapBpm || 0,
      mfcc: meyda.mfcc,
      chroma: meyda.chroma,
      flatness: meyda.flatness,
      rolloff: meyda.rolloff,
      pitchHz: this.aubioFeatures.pitchHz,
      pitchConf: this.aubioFeatures.pitchConf,
      aubioTempoBpm: this.aubioFeatures.tempoBpm,
      aubioTempoConf: this.aubioFeatures.tempoConf,
      aubioOnset: aubioOnsetPulse,
      beatGrid: this.beatGrid,
    };
  }
}
