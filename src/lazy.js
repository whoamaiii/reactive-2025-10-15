/**
 * Lazy Loading System for External Libraries
 * 
 * This file handles loading optional libraries only when they're needed.
 * Instead of loading everything at startup (which would be slow), we load
 * libraries "on demand" - like ordering food when you're hungry, not pre-ordering everything.
 * 
 * Benefits:
 * - Faster initial page load (smaller download)
 * - Libraries only load if we actually use them
 * - If a library fails to load, the app continues working
 * 
 * Each library has multiple fallback URLs - if one CDN fails, we try the next one.
 */

// Cache to store loaded libraries
// Once a library is loaded, we remember it so we don't load it again
// Think of it like a bookshelf - once you get a book, you keep it
const cache = new Map();

/**
 * Load a library exactly once, using a cache to avoid reloading.
 * 
 * This is like borrowing a book from a library - you only need to get it once,
 * and then you can use it as many times as you want without going back.
 * 
 * @param {string} key - A unique name for this library (used for caching)
 * @param {Function} importer - A function that loads the library (returns a Promise)
 * @param {Function} [transform] - Optional function to transform the loaded library
 * @returns {Promise} A promise that resolves to the loaded library
 */
function loadOnce(key, importer, transform = (value) => value) {
  // If we've already loaded this library, return the cached version
  if (!cache.has(key)) {
    // Load it and transform it, then store in cache
    cache.set(key, importer().then(transform));
  }
  // Return the cached promise (which might still be loading, or already resolved)
  return cache.get(key);
}

/**
 * Load the Aubio audio analysis library.
 * 
 * Aubio is used for detecting beats, tempo, and pitch in audio.
 * It's an optional library - if it fails to load, the app still works,
 * just without some advanced audio features.
 * 
 * This tries multiple CDN sources (content delivery networks) in order:
 * 1. First tries to load from npm (if installed locally)
 * 2. Then tries various CDN URLs as fallbacks
 * 
 * @returns {Promise} A promise that resolves to the Aubio module
 */
export function loadAubio() {
  return loadOnce('aubio', async () => {
    // List of places to try loading from, in order of preference
    const candidates = [
      // Prefer local package via bundler first (fastest, most reliable)
      'aubiojs',
      // If that fails, try CDN versions (from the internet)
      'https://esm.sh/aubiojs@0.0.11',
      'https://esm.sh/aubiojs@0.0.9',
      'https://cdn.jsdelivr.net/npm/aubiojs@0.0.11/+esm',
      'https://cdn.jsdelivr.net/npm/aubiojs@0.0.9/+esm',
    ];
    
    // Try each candidate until one works
    for (const url of candidates) {
      try {
        // Load the module from this URL
        // For local packages, use regular import; for URLs, use dynamic import
        const mod = url === 'aubiojs' ? await import(url) : await import(/* @vite-ignore */ url);
        // Return the module (might be in mod.default or mod itself)
        return mod.default ?? mod;
      } catch (_) {
        // This URL failed, try the next one
        // try next candidate
      }
    }
    // If we get here, all URLs failed
    throw new Error('Aubio module could not be loaded from CDNs');
  });
}

/**
 * Load the Essentia.js audio analysis library.
 * 
 * Essentia is used for advanced beat tracking and tempo detection.
 * It's more accurate than basic beat detection but takes longer to load.
 * 
 * @returns {Promise} A promise that resolves to the Essentia module
 */
export function loadEssentia() {
  return loadOnce('essentia', async () => {
    // Try local vendored build first (if present), then fall back to CDN.
    // Using dynamic specifiers with /* @vite-ignore */ prevents Vite from
    // attempting to resolve the bare import during dev import analysis.
    const localCandidates = [
      // Served by Vite from public/ at runtime if the file exists
      new URL('../public/vendor/essentia/essentia-wasm.web.js', import.meta.url).href,
      '/vendor/essentia/essentia-wasm.web.js',
    ];
    const remoteCandidates = [
      'https://cdn.jsdelivr.net/npm/essentia.js@0.1.0/dist/essentia-wasm.web.js',
      'https://unpkg.com/essentia.js@0.1.0/dist/essentia-wasm.web.js',
    ];

    let mod = null;
    for (const href of [...localCandidates, ...remoteCandidates]) {
      try {
        mod = await import(/* @vite-ignore */ href);
        if (mod) break;
      } catch (_) {
        // try next candidate
      }
    }
    if (!mod) throw new Error('Essentia.js module not found (local/CDN)');

    // Normalize export shapes across distributions (factory function vs object)
    const factories = [
      mod?.default,
      mod?.default?.default,
      mod?.EssentiaWASM,
      mod?.EssentiaModule,
      mod?.createEssentiaModule,
      mod,
    ];

    for (const f of factories) {
      if (typeof f === 'function') {
        try {
          return await f();
        } catch (_) {
          // try the next candidate
        }
      }
    }
    if (mod && typeof mod === 'object') return mod.default ?? mod;
    throw new TypeError('Unsupported Essentia.js export format');
  });
}

/**
 * Load the Meyda audio feature extraction library.
 * 
 * Meyda extracts audio features like MFCC (mel-frequency cepstral coefficients),
 * chroma (musical note information), and spectral features.
 * These features help us understand what kind of music is playing.
 * 
 * @returns {Promise} A promise that resolves to the Meyda module
 */
export function loadMeyda() {
  return loadOnce('meyda', () => import('meyda'), (mod) => mod.default ?? mod);
}

/**
 * Load the ML5 machine learning library.
 * 
 * ML5 provides easy-to-use machine learning features.
 * Currently reserved for future features (not actively used).
 * 
 * @returns {Promise} A promise that resolves to the ML5 module
 */
export function loadMl5() {
  return loadOnce('ml5', async () => {
    const remoteCandidates = [
      'https://esm.sh/ml5@0.12.2?bundle',
      'https://esm.sh/ml5@0.12.2',
    ];
    for (const href of remoteCandidates) {
      try {
        const mod = await import(/* @vite-ignore */ href);
        return mod?.default ?? mod;
      } catch (_) {
        // try next
      }
    }
    throw new Error('ML5 module could not be loaded from CDN');
  });
}

/**
 * Load the Butterchurn music visualizer library.
 * 
 * Butterchurn is a WebGL-based music visualizer (like Milkdrop).
 * Currently reserved for future features (not actively used).
 * 
 * @returns {Promise} A promise that resolves to the Butterchurn module
 */
export function loadButterchurn() {
  return loadOnce('butterchurn', async () => {
    const remoteCandidates = [
      'https://esm.sh/butterchurn@2.6.7?bundle',
      'https://esm.sh/butterchurn@2.6.7',
    ];
    for (const href of remoteCandidates) {
      try {
        const mod = await import(/* @vite-ignore */ href);
        return mod?.default ?? mod;
      } catch (_) {
        // try next
      }
    }
    throw new Error('Butterchurn module could not be loaded from CDN');
  });
}

/**
 * Load the Wavesurfer audio waveform visualization library.
 * 
 * Wavesurfer can display audio waveforms and provides audio analysis features.
 * Currently reserved for future features (not actively used).
 * 
 * @returns {Promise} A promise that resolves to the Wavesurfer module
 */
export function loadWavesurfer() {
  return loadOnce('wavesurfer', async () => {
    const remoteCandidates = [
      'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js',
      'https://esm.sh/wavesurfer.js@7?bundle',
      'https://esm.sh/wavesurfer.js@7',
    ];
    for (const href of remoteCandidates) {
      try {
        const mod = await import(/* @vite-ignore */ href);
        return mod?.default ?? mod;
      } catch (_) {
        // try next
      }
    }
    throw new Error('Wavesurfer module could not be loaded from CDN');
  });
}
