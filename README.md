# Interactive Cosmic Anomaly — Audio Reactive

A local, browser-based Three.js visualizer with an advanced UI and audio-reactive mappings. Works best in Chrome on macOS.

## Run locally
Because ES modules are used, you need a local web server (file:// won’t work):

- Python
  - `python3 -m http.server 5173`
  - Open http://localhost:5173

- Or Node
  - `npx http-server -p 5173`
  - Open http://localhost:5173

## Audio sources
- **Mic**: Select your input (or BlackHole if you routed system audio into it).
- **System (Chrome)**: Click "System" in the UI, select "Entire Screen" and enable "Share system audio". Click "Learn more" in the helper ribbon for detailed instructions.
- **File**: Drag-and-drop an audio file anywhere on the page, or use the File button in the Settings drawer.

## Controls (Settings Drawer)
Open the glass **Settings** drawer by clicking the ⚙️ button (bottom-right) or pressing the **S** key.

**Tabs:**
- **Quick**: Combined audio and visual controls for fast tweaking.
- **Source**: Switch between mic, system audio, or file; refresh input devices.
- **Audio**: Gain, beat sensitivity, smoothing, FFT size, band crossover frequencies, beat cooldown.
- **Visuals**: Theme swatches (nebula/sunset/forest/aurora), HDR background, fog density, bloom (base + reactive), pixel ratio, auto-rotation, particle density, sparks, lens flare, auto-resolution (target FPS, min pixel ratio).
- **Morph**: Webcam integration—morph the sphere into a flat grid showing your webcam feed on beat; control amount, duration, hold time, grid depth, and mirroring.
- **Mapping**: Fine-tune audio-reactive mappings—sphere size from RMS, ring scale/speed from frequency bands, camera shake from beat, bloom color boost from spectral centroid, core brightness/noise from audio features, light intensity from bass, band weighting (bass/mid/treble), star twinkle from treble, ring tilt from bass.
- **Tempo**: Tempo assist (auto BPM for files, live Aubio tempo), tap tempo with quantize, phase nudge, and multiplier controls.
- **Presets**: Save/load/import/export preset configurations; reset to defaults.
- **Session**: FPS monitor and screenshot capture.

**Quick actions**: Press **S** to toggle settings, drag-and-drop audio files to load them, click "Learn more" for system audio help.

## Technical Notes
- **Auto-resolution** is enabled by default and dynamically adjusts pixel ratio to maintain target FPS (default 60 FPS).
- **HDR backgrounds** are loaded from remote Three.js CDN URLs; if CORS blocks them, the scene falls back to black background automatically.
- **System audio** capture depends on browser support; Chrome is recommended. Safari/Firefox may not allow sharing system audio.
- **Particle density** changes trigger geometry rebuilds (heavier operation); adjust sparingly during playback.
- **Import map shim** is included for older Safari/Firefox compatibility.
- **Debug mode**: Add `?debug` to the URL to enable feature detection logging in the console.
