const FRAME_SIZE = 512;
const MAX_CHANNELS = 4;
const FLUX_HISTORY = 64;
const DC_ALPHA = 0.995;

const hannWindow = new Float32Array(FRAME_SIZE);
for (let i = 0; i < FRAME_SIZE; i++) {
  hannWindow[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME_SIZE - 1));
}

const cosTable = new Float32Array(FRAME_SIZE / 2);
const sinTable = new Float32Array(FRAME_SIZE / 2);
for (let i = 0; i < FRAME_SIZE / 2; i++) {
  const angle = (2 * Math.PI * i) / FRAME_SIZE;
  cosTable[i] = Math.cos(angle);
  sinTable[i] = Math.sin(angle);
}

function fft(re, im) {
  const n = re.length;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tempRe = re[i]; re[i] = re[j]; re[j] = tempRe;
      const tempIm = im[i]; im[i] = im[j]; im[j] = tempIm;
    }
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
  }

  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const tableStep = FRAME_SIZE / size;
    for (let start = 0; start < n; start += size) {
      for (let i = 0; i < halfSize; i++) {
        const k = i * tableStep;
        const tRe = cosTable[k] * re[start + i + halfSize] + sinTable[k] * im[start + i + halfSize];
        const tIm = -sinTable[k] * re[start + i + halfSize] + cosTable[k] * im[start + i + halfSize];
        const uRe = re[start + i];
        const uIm = im[start + i];
        re[start + i] = uRe + tRe;
        im[start + i] = uIm + tIm;
        re[start + i + halfSize] = uRe - tRe;
        im[start + i + halfSize] = uIm - tIm;
      }
    }
  }
}

class AnalysisProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._dcState = new Float32Array(MAX_CHANNELS);
    this._frameBuffer = new Float32Array(FRAME_SIZE);
    this._frameOffset = 0;
    this._fftRe = new Float32Array(FRAME_SIZE);
    this._fftIm = new Float32Array(FRAME_SIZE);
    this._prevMagnitudes = new Float32Array(FRAME_SIZE / 2);
    this._fluxRing = new Float32Array(FLUX_HISTORY);
    this._fluxIndex = 0;
    this._fluxCount = 0;
    this._frameCounter = 0;

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'reset') {
        this._prevMagnitudes.fill(0);
        this._fluxRing.fill(0);
        this._fluxIndex = 0;
        this._fluxCount = 0;
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0]) {
      return true;
    }

    const output = outputs && outputs[0] ? outputs[0] : null;
    const channelCount = Math.min(input.length, MAX_CHANNELS);

    const frameBuf = this._frameBuffer;

    for (let i = 0; i < input[0].length; i++) {
      let mix = 0;
      for (let ch = 0; ch < channelCount; ch++) {
        const sample = input[ch][i];
        const dc = this._dcState[ch] + DC_ALPHA * (sample - this._dcState[ch]);
        this._dcState[ch] = dc;
        const filtered = sample - dc;
        mix += filtered;
      }

      const mono = mix / channelCount;
      frameBuf[this._frameOffset++] = mono;

      if (output && output[0]) {
        output[0][i] = mono;
      }

      if (this._frameOffset >= FRAME_SIZE) {
        this._analyzeFrame(frameBuf);
        this._frameOffset = 0;
      }
    }

    return true;
  }

  _analyzeFrame(frame) {
    const re = this._fftRe;
    const im = this._fftIm;
    let energy = 0;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const sample = frame[i];
      energy += sample * sample;
      re[i] = sample * hannWindow[i];
      im[i] = 0;
    }

    fft(re, im);

    let flux = 0;
    const prev = this._prevMagnitudes;
    for (let i = 0; i < FRAME_SIZE / 2; i++) {
      const mag = Math.hypot(re[i], im[i]);
      const diff = mag - prev[i];
      if (diff > 0) flux += diff;
      prev[i] = mag;
    }
    flux /= FRAME_SIZE / 2;

    this._fluxRing[this._fluxIndex] = flux;
    this._fluxIndex = (this._fluxIndex + 1) % FLUX_HISTORY;
    if (this._fluxCount < FLUX_HISTORY) this._fluxCount++;

    let fluxMean = 0;
    for (let i = 0; i < this._fluxCount; i++) fluxMean += this._fluxRing[i];
    fluxMean = this._fluxCount ? fluxMean / this._fluxCount : 0;
    let fluxVar = 0;
    for (let i = 0; i < this._fluxCount; i++) {
      const d = this._fluxRing[i] - fluxMean;
      fluxVar += d * d;
    }
    fluxVar = this._fluxCount ? fluxVar / this._fluxCount : 0;

    const frameCopy = new Float32Array(FRAME_SIZE);
    frameCopy.set(frame);

    this.port.postMessage({
      type: 'frame',
      frameId: this._frameCounter++,
      rms: Math.sqrt(energy / FRAME_SIZE),
      flux,
      fluxMean,
      fluxStd: Math.sqrt(Math.max(fluxVar, 0)),
      dc: this._dcState[0] || 0,
      samples: frameCopy.buffer,
    }, [frameCopy.buffer]);
  }
}

registerProcessor('analysis-processor', AnalysisProcessor);
