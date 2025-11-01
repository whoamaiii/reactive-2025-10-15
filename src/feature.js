/**
 * Browser Feature Detection System
 * 
 * This file checks what capabilities the user's browser supports.
 * Different browsers support different features, so we need to detect
 * what's available before trying to use it.
 * 
 * Think of it like checking what tools you have in your toolbox before
 * starting a project - you need to know what's available!
 * 
 * Features we check:
 * - AudioContext: Can we process audio? (required for the whole app)
 * - AudioWorklet: Can we do audio processing in the background? (for better performance)
 * - WebGL2: Can we do advanced 3D graphics? (required for the visualizations)
 * - WebCodecs: Can we decode video/audio efficiently? (for future features)
 * - MIDI: Can we connect to MIDI devices? (for future features)
 * - OffscreenCanvas: Can we do graphics processing off-screen? (for future features)
 */

// Get the browser's "user agent" string - this tells us which browser it is
// This is like reading the label on a box to see what's inside
const ua = navigator.userAgent || '';

// Detect which browser family we're using
// We check these because different browsers have different quirks and capabilities
const isSafari = /safari/i.test(ua) && !/chrome|crios|android/i.test(ua);
const isFirefox = /firefox/i.test(ua);
const isChrome = !isSafari && !isFirefox && /chrome|crios/i.test(ua);

// Cache for feature detection results
// Once we check, we remember the results so we don't have to check again
let supportCache = null;

/**
 * Detects which browser features are available.
 * 
 * This runs tests to see what the browser can do. It's like checking
 * if your car has air conditioning, GPS, backup camera, etc.
 * 
 * The results are cached so we only check once.
 * 
 * @returns {Object} An object with boolean flags for each feature
 */
function detectSupport() {
  // If we've already checked, return the cached results
  if (supportCache) return supportCache;
  
  // Check if AudioContext is available (the basic audio processing API)
  // This is required for the app to work at all
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const hasAudioContext = typeof AudioContextCtor === 'function';
  
  // Check if AudioWorklet is available (advanced audio processing)
  // This allows us to do audio processing in a separate thread for better performance
  const audioWorklet = hasAudioContext && 'audioWorklet' in AudioContextCtor.prototype;
  
  // Check if WebGL2 is available (advanced 3D graphics)
  // We need this for the 3D particle visualizations
  const webgl2 = (() => {
    try {
      // Try to create a WebGL2 context (this is how we test if it's supported)
      const canvas = document.createElement('canvas');
      return !!canvas.getContext('webgl2');
    } catch (_) {
      // If that fails, WebGL2 isn't available
      return false;
    }
  })();
  
  // Check if WebCodecs API is available (for efficient video/audio decoding)
  // Reserved for future features
  const webcodecs = typeof window.VideoDecoder === 'function' || typeof window.AudioDecoder === 'function';
  
  // Check if MIDI API is available (for connecting to MIDI keyboards/devices)
  // Reserved for future features
  const midi = typeof navigator.requestMIDIAccess === 'function';
  
  // Check if OffscreenCanvas is available (for doing graphics work off-screen)
  // Reserved for future features
  const offscreenCanvas = typeof window.OffscreenCanvas === 'function';

  // Store all the results in a cache object
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

/**
 * Get information about which browser family we're using.
 * 
 * This is useful because different browsers sometimes need different code.
 * For example, Safari handles audio differently than Chrome.
 * 
 * @returns {Object} An object with browser flags: { isChrome, isSafari, isFirefox }
 */
export function getBrowserFlags() {
  return { isChrome, isSafari, isFirefox };
}

/**
 * Get the feature support detection results.
 * 
 * This is the main function other files use to check what features are available.
 * 
 * @returns {Object} An object with boolean flags for each feature
 */
export function getFeatureSupport() {
  return detectSupport();
}

/**
 * Print a helpful table showing which features are supported.
 * 
 * This is useful for debugging - if something doesn't work, you can check
 * if the browser supports the required feature.
 * 
 * You can call this by adding ?debug to the URL.
 * 
 * The output looks like:
 *   Browser: Chrome
 *   ┌───────────────┬───────────┐
 *   │ capability    │ supported │
 *   ├───────────────┼───────────┤
 *   │ AudioContext  │ true      │
 *   │ AudioWorklet  │ true      │
 *   │ WebGL2        │ true      │
 *   └───────────────┴───────────┘
 */
export function printFeatureMatrix() {
  const support = detectSupport();
  const browser = getBrowserFlags();
  
  // Create a table of features and whether they're supported
  const rows = [
    { capability: 'AudioContext', supported: support.audioContext },
    { capability: 'AudioWorklet', supported: support.audioWorklet },
    { capability: 'WebGL2', supported: support.webgl2 },
    { capability: 'WebCodecs', supported: support.webcodecs },
    { capability: 'MIDI', supported: support.midi },
    { capability: 'OffscreenCanvas', supported: support.offscreenCanvas },
  ];
  
  // Print it to the browser console in a nice format
  console.groupCollapsed('Feature support');
  console.log(`Browser: ${browser.isChrome ? 'Chrome' : browser.isSafari ? 'Safari' : browser.isFirefox ? 'Firefox' : 'Other'}`);
  console.table(rows, ['capability', 'supported']);
  console.groupEnd();
}

// Pre-detect features when this file loads (so they're ready immediately)
export const featureSupport = detectSupport();
export const browserFlags = getBrowserFlags();
