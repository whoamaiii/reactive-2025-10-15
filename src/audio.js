import { AudioContext as StdAudioContext } from 'standardized-audio-context';
import { loadAubio, loadMeyda } from './lazy.js';

// Lazy-load web-audio-beat-detector at runtime with graceful fallbacks.
// Static importing from a CDN can 404 and break the entire app. This keeps the UI alive.
let _guessBpmFn = null;
async function getBeatDetectorGuess() {
  if (_guessBpmFn) return _guessBpmFn;
  const candidates = [
    'https://esm.sh/web-audio-beat-detector@6.3.2',
    'https://cdn.jsdelivr.net/npm/web-audio-beat-detector@6.3.2/+esm',
    'https://cdn.skypack.dev/web-audio-beat-detector@6.3.2',
  ];
  for (const url of candidates) {
    try {
      const mod = await import(/* @vite-ignore */ url);
      const fn = mod?.guess || mod?.default?.guess;
      if (typeof fn === 'function') {
        _guessBpmFn = fn;
        return _guessBpmFn;
      }
    } catch (_) {
      // try next candidate
    }
  }
  // Final fallback: no-op estimator that resolves to null bpm
  _guessBpmFn = async () => ({ bpm: null });
  return _guessBpmFn;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.source = null; // MediaStreamAudioSourceNode or AudioBufferSourceNode
    this.gainNode = null;
    this.analyser = null;
    this.fftSize = 2048;
    this.freqData = null;
    this.timeData = null;
    this.sampleRate = 48000;

    // Feature extraction state
    this.prevMag = null; // previous normalized magnitude spectrum (Float32)
    this.fluxHistory = [];
    this.fluxWindow = 43; // ~0.5s at 86 fps of analyser pulls (approx)
    this.sensitivity = 1.0; // beat threshold multiplier
    this.smoothing = 0.6; // EMA smoothing for RMS/bands
    this.bandSplit = { low: 200, mid: 2000 }; // Hz
    this.beatCooldownMs = 250;
    this._lastBeatMs = -99999;

    this.levels = { rms: 0, rmsEMA: 0, bands: { bass: 0, mid: 0, treble: 0 }, bandsEMA: { bass: 0, mid: 0, treble: 0 }, centroid: 0, centroidEMA: 0 };

    this.timeDataFloat = null;

    this._meydaPromise = null;
    this.meyda = null;
    this._meydaLastExtract = 0;
    this._meydaIntervalMs = 1000 / 75; // ~75 Hz refresh
    this._meydaSmoothing = 0.65;
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

    // Webcam (optional visual input)
    this.webcam = {
      stream: null,
      video: null,
      texture: null,
      width: 0,
      height: 0,
      mirror: true,
      ready: false,
    };
  }

  async ensureContext() {
    if (!this.ctx) {
      let Ctor = StdAudioContext;
      if (typeof Ctor !== 'function') {
        // Fallback to native contexts
        Ctor = window.AudioContext || window.webkitAudioContext;
      }
      this.ctx = new Ctor();
      this.sampleRate = this.ctx.sampleRate;
      // Expose for Safari/iOS unlock helper to resume
      try {
        window.__reactiveCtxs = window.__reactiveCtxs || [];
        if (!window.__reactiveCtxs.includes(this.ctx)) window.__reactiveCtxs.push(this.ctx);
      } catch(_) {}
    }
    if (!this.gainNode) {
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 1.0;
    }
    if (!this.analyser) {
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = this.fftSize;
      this.analyser.smoothingTimeConstant = 0.5;
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
      this.timeData = new Uint8Array(this.analyser.fftSize);
      this.timeDataFloat = new Float32Array(this.analyser.fftSize);
    }

    if (!this._graphConnected && this.gainNode && this.analyser) {
      this._ensureGraph();
      this._graphConnected = true;
    }

    await this._maybeInitWorklet();
  }

  async getInputDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d => d.kind === 'audioinput');
  }

  async startMic(deviceId) {
    await this.ensureContext();
    this.stop();
    const constraints = { audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this._useStream(stream);
    return stream;
  }

  async startSystemAudio() {
    await this.ensureContext();
    this.stop();
    // Chrome: allow audio capture via display media
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: true });
    this._useStream(stream);
    return stream;
  }

  async loadFile(file) {
    await this.ensureContext();
    this.stop();
    const arrayBuf = await file.arrayBuffer();
    const audioBuf = await this.ctx.decodeAudioData(arrayBuf);
    const src = this.ctx.createBufferSource();
    src.buffer = audioBuf; src.loop = true; src.start(0);
    src.connect(this.gainNode);
    this._ensureGraph();
    this.source = src; this.isPlayingFile = true; this.activeStream = null; this._lastAudioBuffer = audioBuf;

    // Fire-and-forget BPM estimation for tempo assist
    this._estimateBpmFromBuffer(audioBuf).catch(() => {});

    this._runEssentiaAnalysis(audioBuf).catch((err) => {
      console.warn('Essentia analysis failed', err);
    });
  }

  stop() {
    try {
      if (this.source && this.source.stop) {
        this.source.stop();
      }
    } catch(_){}
    if (this.activeStream) {
      for (const t of this.activeStream.getTracks()) t.stop();
    }
    this.source = null; this.activeStream = null; this.isPlayingFile = false;
    if (this.workletNode) {
      try { this.workletNode.port.postMessage({ type: 'reset' }); } catch (_) {}
    }
    // Don't clear BPM immediately; allow UI to still show last known value
  }

  // Webcam API (visual only; independent of audio graph)
  async startWebcam(constraints = { video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: 'user' }, audio: false }) {
    // Reuse stream if already running
    if (this.webcam.stream) return this.webcam.texture;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const video = document.createElement('video');
      video.autoplay = true; video.playsInline = true; video.muted = true; video.style.display = 'none';
      video.srcObject = stream;
      await new Promise((res) => {
        const onReady = () => { res(); };
        video.addEventListener('loadedmetadata', onReady, { once: true });
        video.addEventListener('loadeddata', onReady, { once: true });
      });
      document.body.appendChild(video);
      const texture = new (await import('three')).VideoTexture(video);
      texture.minFilter = (await import('three')).LinearFilter;
      texture.magFilter = (await import('three')).LinearFilter;
      texture.generateMipmaps = false;
      this.webcam.stream = stream;
      this.webcam.video = video;
      this.webcam.texture = texture;
      this.webcam.width = video.videoWidth || 320;
      this.webcam.height = video.videoHeight || 240;
      this.webcam.ready = true;
      return texture;
    } catch (e) {
      console.warn('Webcam start failed', e);
      throw e;
    }
  }

  stopWebcam() {
    if (this.webcam.video) {
      try { this.webcam.video.pause(); } catch(_) {}
      try { this.webcam.video.srcObject = null; } catch(_) {}
      try { document.body.removeChild(this.webcam.video); } catch(_) {}
      this.webcam.video = null;
    }
    if (this.webcam.stream) {
      try { for (const t of this.webcam.stream.getTracks()) t.stop(); } catch(_) {}
      this.webcam.stream = null;
    }
    if (this.webcam.texture) {
      try { this.webcam.texture.dispose(); } catch(_) {}
      this.webcam.texture = null;
    }
    this.webcam.ready = false;
  }

  getWebcamTexture() { return this.webcam.texture || null; }
  isWebcamReady() { return !!this.webcam.ready; }
  setWebcamMirror(v) { this.webcam.mirror = !!v; }

  _useStream(stream) {
    if (this.activeStream) {
      for (const t of this.activeStream.getTracks()) t.stop();
    }
    this.activeStream = stream;
    const src = this.ctx.createMediaStreamSource(stream);
    src.connect(this.gainNode);
    this._ensureGraph();
    this.source = src; this.isPlayingFile = false;
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
  setBandSplit(lowHz, midHz) { this.bandSplit.low = lowHz; this.bandSplit.mid = midHz; }
  setBeatCooldown(ms) { this.beatCooldownMs = ms; }

  // Tempo assist API
  setTempoAssistEnabled(v) { this.tempoAssistEnabled = !!v; if (this.tempoAssistEnabled && this.bpmEstimate) { this._lastTempoMs = performance.now(); } }
  getBpm() { return this.bpmEstimate || 0; }
  async recalcBpm() { if (this._lastAudioBuffer) { await this._estimateBpmFromBuffer(this._lastAudioBuffer); } }

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
  setTapQuantizeEnabled(v) { this.tapQuantizeEnabled = !!v; if (this.tapQuantizeEnabled) { this._lastQuantizeMs = performance.now(); } }

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
    if (!deltaMs || !this.tapQuantizeEnabled) return;
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
    try {
      const guess = await getBeatDetectorGuess();
      const result = await guess(buffer);
      const bpm = (typeof result?.bpm === 'number' && isFinite(result.bpm)) ? Math.round(result.bpm) : null;
      if (bpm && bpm > 30 && bpm < 300) {
        this.bpmEstimate = bpm;
        this.tempoIntervalMs = 60000 / bpm;
        this._lastTempoMs = performance.now();
      }
    } catch (e) {
      // Estimation may fail for very short/quiet files; ignore
    }
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
      console.warn('Essentia worker error', data.error);
      try {
        const msg = typeof data.error?.message === 'string' ? data.error.message : 'Beat grid unavailable (worker load failed)';
        this._showToast(msg);
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

  _showToast(message) {
    try {
      let el = document.getElementById('toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.style.position = 'fixed';
        el.style.left = '50%';
        el.style.bottom = '80px';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '70';
        el.style.padding = '10px 14px';
        el.style.borderRadius = '12px';
        el.style.border = '1px solid rgba(255,255,255,0.25)';
        el.style.background = 'rgba(0,0,0,0.6)';
        el.style.color = '#fff';
        el.style.backdropFilter = 'blur(10px)';
        el.style.webkitBackdropFilter = 'blur(10px)';
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.style.opacity = '1';
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { el.style.transition = 'opacity 0.4s ease'; el.style.opacity = '0'; }, 3000);
    } catch(_) {}
  }

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
    let bass = 0, mid = 0, treble = 0; let bC = 0, mC = 0, tC = 0;
    for (let i = 0; i < freqData.length; i++) {
      const f = i * binHz; const v = freqData[i] / 255;
      if (f < this.bandSplit.low) { bass += v; bC++; }
      else if (f < this.bandSplit.mid) { mid += v; mC++; }
      else { treble += v; tC++; }
    }
    bass = bC ? bass / bC : 0; mid = mC ? mid / mC : 0; treble = tC ? treble / tC : 0;
    return { bass, mid, treble };
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

  _detectBeat(flux) {
    if (this.fluxHistory.length < 5) return false;
    const now = performance.now(); if (now - this._lastBeatMs < this.beatCooldownMs) return false;
    // Adaptive threshold: mean + k*std
    const mean = this.fluxHistory.reduce((a,b)=>a+b,0) / this.fluxHistory.length;
    const variance = this.fluxHistory.reduce((a,b)=>a+(b-mean)*(b-mean),0) / this.fluxHistory.length;
    const std = Math.sqrt(variance);
    const threshold = mean + std * (0.8 + 0.8 * this.sensitivity); // sensitivity 0..2
    if (flux > threshold) { this._lastBeatMs = now; return true; }
    return false;
  }

  update() {
    if (!this.analyser) return null;
    this.analyser.getByteTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);

    const useWorkletRms = this.workletEnabled && this._workletFrameId >= 0;
    const rms = useWorkletRms ? this._workletFeatures.rms : this._computeRMS(this.timeData);
    const bands = this._computeBands(this.freqData);
    const centroid = this._computeCentroid(this.freqData);
    const fluxFromWorklet = this._consumeWorkletFlux();
    const flux = fluxFromWorklet ?? this._computeFlux(this.freqData);
    let beat = this._detectBeat(flux);

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
          if (!this.bpmEstimate || Math.abs(rounded - this.bpmEstimate) >= 1) {
            this.bpmEstimate = rounded;
            this.tempoIntervalMs = 60000 / this.bpmEstimate;
            this._lastTempoMs = now;
          }
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

    return {
      rms: rms,
      rmsNorm: Math.min(1, rms * 2.0),
      bands,
      bandsEMA: this.levels.bandsEMA,
      centroidHz: centroid.hz,
      centroidNorm: centroid.norm,
      flux,
      fluxMean: this.workletEnabled ? this._workletFeatures.fluxMean : flux,
      fluxStd: this.workletEnabled ? this._workletFeatures.fluxStd : 0,
      beat,
      bpm: this.bpmEstimate || 0,
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
