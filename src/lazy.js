const cache = new Map();

function loadOnce(key, importer, transform = (value) => value) {
  if (!cache.has(key)) {
    cache.set(key, importer().then(transform));
  }
  return cache.get(key);
}

export function loadAubio() {
  return loadOnce('aubio', () => import('aubiojs'), (mod) => mod.default ?? mod);
}

export function loadEssentia() {
  return loadOnce('essentia', () => import('essentia.js'));
}

export function loadMeyda() {
  return loadOnce('meyda', () => import('meyda'), (mod) => mod.default ?? mod);
}

export function loadMl5() {
  return loadOnce('ml5', () => import('ml5'), (mod) => mod.default ?? mod);
}

export function loadButterchurn() {
  return loadOnce('butterchurn', () => import('butterchurn'), (mod) => mod.default ?? mod);
}

export function loadWavesurfer() {
  return loadOnce('wavesurfer', () => import('wavesurfer.js'), (mod) => mod.default ?? mod);
}
