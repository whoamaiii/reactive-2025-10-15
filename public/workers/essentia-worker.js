self.Module = undefined;

const STATE = {
  ready: false,
  loading: false,
  queue: [],
  module: null,
  essentia: null,
};

function postReady() {
  self.postMessage({ type: 'ready' });
}

async function ensureModule() {
  if (STATE.ready) return STATE.essentia;
  if (STATE.loading) {
    await new Promise((resolve) => {
      STATE.queue.push(resolve);
    });
    return STATE.essentia;
  }

  STATE.loading = true;
  try {
    const module = await import('https://cdn.jsdelivr.net/npm/essentia.js@0.1.0/dist/essentia-wasm.web.js');
    const factory = module.default || module;
    STATE.module = await factory();
    STATE.essentia = STATE.module;
    STATE.ready = true;
    postReady();
  } catch (err) {
    console.error('[EssentiaWorker] failed to load', err);
    STATE.ready = false;
    STATE.loading = false;
    throw err;
  } finally {
    STATE.loading = false;
    const resolvers = STATE.queue;
    STATE.queue = [];
    resolvers.forEach((fn) => fn());
  }
  return STATE.essentia;
}

self.onmessage = async (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === 'init') {
    try {
      await ensureModule();
    } catch (err) {
      self.postMessage({ type: 'error', error: serializeError(err) });
    }
    return;
  }

  if (data.type === 'analyze') {
    const jobId = data.jobId;
    try {
      const essentia = await ensureModule();
      const result = runAnalysis(essentia, data.payload || {});
      self.postMessage({ type: 'result', jobId, result });
    } catch (err) {
      self.postMessage({ type: 'error', jobId, error: serializeError(err) });
    }
    return;
  }
};

// Also catch top-level script load failures and surface to main thread
self.addEventListener('error', (e) => {
  try { self.postMessage({ type: 'error', error: serializeError(e?.error || e?.message || 'Worker error') }); } catch(_) {}
});

function runAnalysis(essentia, payload) {
  const sampleRate = payload.sampleRate || 44100;
  const channelData = payload.channelData;
  const duration = payload.duration || (channelData ? channelData.length / sampleRate : 0);
  if (!channelData || !channelData.length) {
    return { beatTimes: [], bpm: 0, confidence: 0 };
  }

  let mono = channelData;
  if (Array.isArray(channelData[0])) {
    // multi-channel array -> average
    const length = channelData[0].length;
    mono = new Float32Array(length);
    const channels = channelData.length;
    for (let c = 0; c < channels; c++) {
      const data = channelData[c];
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / channels;
      }
    }
  } else if (!(channelData instanceof Float32Array)) {
    mono = Float32Array.from(channelData);
  }

  const rhythm = essentia.RhythmExtractor2013({
    method: 'degara',
    maxTempo: 220,
    minTempo: 60,
  });

  const { bpm, beats, confidence } = rhythm(mono);

  const beatTimes = beats instanceof Float32Array ? Array.from(beats) : beats;

  let downbeats = [];
  try {
    const danceability = essentia.BeatTrackerMultiFeature();
    const { beatLocations, downbeatLocations } = danceability(mono);
    downbeats = downbeatLocations instanceof Float32Array ? Array.from(downbeatLocations) : downbeatLocations;
  } catch (_) {
    downbeats = [];
  }

  let loudness = null;
  try {
    const loudnessExtractor = essentia.BeatsLoudness();
    const { meanLoudness, loudness: loudnessArr } = loudnessExtractor(mono);
    loudness = {
      mean: meanLoudness,
      samples: loudnessArr instanceof Float32Array ? Array.from(loudnessArr) : loudnessArr,
    };
  } catch (_) {
    loudness = null;
  }

  return {
    bpm,
    confidence,
    duration,
    beatTimes,
    downbeats,
    loudness,
  };
}

function serializeError(err) {
  if (!err) return { message: 'Unknown error' };
  if (typeof err === 'string') return { message: err };
  return {
    message: err.message || 'Error',
    stack: err.stack || null,
    name: err.name || 'Error',
  };
}
