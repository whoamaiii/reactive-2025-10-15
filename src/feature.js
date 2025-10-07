const ua = navigator.userAgent || '';

const isSafari = /safari/i.test(ua) && !/chrome|crios|android/i.test(ua);
const isFirefox = /firefox/i.test(ua);
const isChrome = !isSafari && !isFirefox && /chrome|crios/i.test(ua);

let supportCache = null;

function detectSupport() {
  if (supportCache) return supportCache;
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const hasAudioContext = typeof AudioContextCtor === 'function';
  const audioWorklet = hasAudioContext && 'audioWorklet' in AudioContextCtor.prototype;
  const webgl2 = (() => {
    try {
      const canvas = document.createElement('canvas');
      return !!canvas.getContext('webgl2');
    } catch (_) {
      return false;
    }
  })();
  const webcodecs = typeof window.VideoDecoder === 'function' || typeof window.AudioDecoder === 'function';
  const midi = typeof navigator.requestMIDIAccess === 'function';
  const offscreenCanvas = typeof window.OffscreenCanvas === 'function';

  supportCache = {
    audioContext: hasAudioContext,
    audioWorklet,
    webgl2,
    webcodecs,
    midi,
    offscreenCanvas,
  };
  return supportCache;
}

export function getBrowserFlags() {
  return { isChrome, isSafari, isFirefox };
}

export function getFeatureSupport() {
  return detectSupport();
}

export function printFeatureMatrix() {
  const support = detectSupport();
  const browser = getBrowserFlags();
  const rows = [
    { capability: 'AudioContext', supported: support.audioContext },
    { capability: 'AudioWorklet', supported: support.audioWorklet },
    { capability: 'WebGL2', supported: support.webgl2 },
    { capability: 'WebCodecs', supported: support.webcodecs },
    { capability: 'MIDI', supported: support.midi },
    { capability: 'OffscreenCanvas', supported: support.offscreenCanvas },
  ];
  console.groupCollapsed('Feature support');
  console.log(`Browser: ${browser.isChrome ? 'Chrome' : browser.isSafari ? 'Safari' : browser.isFirefox ? 'Firefox' : 'Other'}`);
  console.table(rows, ['capability', 'supported']);
  console.groupEnd();
}

export const featureSupport = detectSupport();
export const browserFlags = getBrowserFlags();
