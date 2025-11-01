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
- **Mapping**: Fine-tune audio-reactive mappings—sphere size from RMS, ring scale/speed from frequency bands, camera shake from beat, bloom color boost from spectral centroid, core brightness/noise from audio features, light intensity from bass, band weighting (bass/mid/treble), star twinkle from treble, ring tilt from bass.
- **Tempo**: Tempo assist (auto BPM for files, live Aubio tempo), tap tempo with quantize, phase nudge, and multiplier controls.
- **Presets**: Quick-save/duplicate active presets and launch the separate preset library window (press **L**).
- **Session**: FPS monitor and screenshot capture.

**Quick actions**: Press **S** to toggle settings, **L** to open the preset library (popup with search, tags, favourites, recents, version history), drag-and-drop audio files to load them, click "Learn more" for system audio help, and use the **Save Settings** footer button to persist your current setup (it auto-loads on refresh).

For a full walkthrough of the new preset workflow see [`docs/preset-library.md`](docs/preset-library.md).

## Technical Notes
- **Auto-resolution** is enabled by default and dynamically adjusts pixel ratio to maintain target FPS (default 60 FPS).
- **HDR backgrounds** are loaded from remote Three.js CDN URLs; if CORS blocks them, the scene falls back to black background automatically.
- **System audio** capture depends on browser support; Chrome is recommended. Safari/Firefox may not allow sharing system audio.
- **Particle density** changes trigger geometry rebuilds (heavier operation); adjust sparingly during playback.
- **Import map shim** is included for older Safari/Firefox compatibility.
- **Debug mode**: Add `?debug` to the URL to enable feature detection logging in the console.

## TouchDesigner integration (step-by-step)

This project can stream audio features to TouchDesigner via OSC. The browser sends features over WebSocket to a small Node bridge which rebroadcasts them as OSC.

### 1) Run the visualizer
1. Start a local server from the project root and open the app:
   - Python: `python3 -m http.server 5173` → open `http://localhost:5173`
   - Node: `npx http-server -p 5173` → open `http://localhost:5173`
2. In the UI (⚙️ Settings): pick a source — Mic, System (Chrome tab with audio), or File.

### 2) Start the OSC bridge
1. Open a terminal in `tools/`:
   - `cd tools`
   - Install deps: `npm install`
   - Start bridge: `npm start`
2. Defaults:
   - WebSocket listen: `ws://127.0.0.1:8090`
   - OSC out: `127.0.0.1:9000`
   - Change with env vars if needed: `OSC_HOST`, `OSC_PORT`, `WS_HOST`, `WS_PORT`.

### 3) Verify streaming from the browser
1. With the app playing audio, open DevTools → Console; you should see no WS errors.
2. The bridge terminal should log a client connection.

### 4) TouchDesigner setup (basic)
1. Create a new TD project (build 2022+ recommended).
2. Add a CHOP: `OSC In CHOP`.
   - Network Port: `9000` (match bridge OSC out)
   - Network Protocol: UDP
3. Add a DAT: `OSC In DAT` to inspect address/value pairs (optional for debugging).
4. You should start seeing channels/rows corresponding to these addresses:
   - Scalars: `/reactive/rms`, `/reactive/rmsNorm`, `/reactive/centroid`, `/reactive/flux`, `/reactive/fluxMean`, `/reactive/fluxStd`, `/reactive/bpm`, `/reactive/tapBpm`, `/reactive/pitchHz`, `/reactive/pitchConf`, `/reactive/aubioTempoBpm`, `/reactive/aubioTempoConf`, `/reactive/beat`, `/reactive/drop`, `/reactive/isBuilding`, `/reactive/buildLevel`
   - Bands (EMA): `/reactive/bandsEMA/bass`, `/reactive/bandsEMA/mid`, `/reactive/bandsEMA/treble`
   - Band envelopes: `/reactive/bandEnv/sub`, `/reactive/bandEnv/bass`, `/reactive/bandEnv/mid`, `/reactive/bandEnv/treble`
   - Normalized bands: `/reactive/bandNorm/sub`, `/reactive/bandNorm/bass`, `/reactive/bandNorm/mid`, `/reactive/bandNorm/treble`
   - MFCC: `/reactive/mfcc/0..12`
   - Chroma: `/reactive/chroma/0..11`
   - Beat grid: `/reactive/beatGrid/bpm`, `/reactive/beatGrid/conf`

### 5) Quick mappings in TD
- Beat pulse: Use `/reactive/beat` (0/1) into a `Lag CHOP` to gate effects.
- Bass-driven brightness: `/reactive/bandEnv/bass` → multiply light/geo intensity.
- Camera/geo motion: `/reactive/centroid` to control speed/tilt; `/reactive/flux` for energy.
- Colorization: map `/reactive/chroma/*` or MFCCs into a `TOP Ramp` or `Lookup`.

### 6) Video into TD (optional)
- Use `Web Render TOP` pointed at `http://localhost:5173` (note: may require a click to start audio due to browser policies) or `Screen Grab TOP` to capture the Chrome window. macOS users can also use Syphon via a separate sender.

### 7) Lasers
- Keep TD as the laser brain and map OSC channels to your DAC workflow (Ether Dream/Helios/Pangolin). Typical links:
  - Intensity/blanking: `/reactive/bandEnv/bass` or `/reactive/rmsNorm`
  - Color modulation: centroid/chroma → RGB scaling
  - Beat gating: `/reactive/beat` → chop gate/trigger

### 8) Troubleshooting
- No OSC in TD: confirm the bridge prints `[WS] client connected` and `[OSC] → host:port`.
- Port conflicts: change `OSC_PORT` or `WS_PORT` and match TD’s `OSC In CHOP`.
- Firewall: allow UDP 9000 and local loopback.
- Low response: ensure Chrome tab is focused and system audio is properly shared.
