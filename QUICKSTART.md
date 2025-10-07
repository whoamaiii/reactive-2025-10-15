# Quick Start Guide

## 🚀 Start the App

```bash
cd /Users/quentinthiessen/desktop/reactive
python3 -m http.server 5173
```

Then open: **http://localhost:5173**

---

## ✅ Test the New Features

### 1. Drag-and-Drop (NEW!)
- Drag any audio file (MP3, WAV, M4A, etc.) onto the page
- Blue overlay appears saying "Drop an audio file to visualize"
- Drop the file → it starts playing immediately

### 2. System Audio Help (NEW!)
- Look at the bottom helper ribbon: "Tip: For system audio on macOS..."
- Click the **"Learn more"** button
- Toast appears with detailed Chrome + BlackHole instructions

### 3. Clean Console (NEW!)
- Open Developer Console (⌘+Option+J)
- Should be clean with no logs
- Add `?debug` to URL to see feature detection logs

### 4. Settings Drawer
- Click **⚙️ Settings** button (bottom-right)
- Or press **S** key
- All tabs should load without errors

### 5. Auto-Resolution (NEW!)
- Watch the FPS in Settings → Session tab
- Should stabilize around 60 FPS after ~2 seconds
- Pixel ratio adjusts automatically

---

## 🎨 Quick Actions

| Action | Shortcut |
|--------|----------|
| Toggle Settings | **S** key |
| Drag & Drop | Drop audio file anywhere |
| Screenshot | Settings → Session → Capture |
| Fullscreen | Browser native (F11 or ⌘+Ctrl+F) |

---

## 🎵 Audio Sources

### Microphone
1. Settings → Source → **Mic**
2. Allow microphone access
3. Select device from dropdown

### System Audio (Chrome)
1. Settings → Source → **System**
2. Select "Entire Screen"
3. Enable "Share system audio"

### Audio File
1. Drag-and-drop onto page (easiest!)
2. Or Settings → Source → **File**

---

## 🔧 Performance Tips

- **Auto-resolution is ON** by default
- If laggy: Settings → Visuals → lower Particle Density
- If choppy: Settings → Visuals → lower Pixel Ratio manually
- If still slow: Disable Sparks or Lens Flare

---

## 🐛 Troubleshooting

### Audio not working
- Check browser permissions (mic/system audio)
- Try different audio source
- Check volume/gain in Settings → Audio

### Low FPS
- Auto-resolution should kick in after 2 seconds
- Manually lower particle density in Settings → Visuals
- Close other GPU-heavy apps

### No visuals
- Check if audio is playing (gain > 0)
- Try beat sensitivity adjustment in Settings → Audio
- Make sure audio source is selected

### Drag-and-drop not working
- Check file is audio format (MP3, WAV, M4A, etc.)
- Try using Settings → Source → File button instead
- Check browser console for errors (`?debug`)

---

## 📊 What Changed?

See **CHANGES.md** for full technical details.

**Quick summary:**
- ✅ Drag-and-drop audio files
- ✅ System audio help instructions
- ✅ Auto-resolution enabled (better perf)
- ✅ 10% fewer particles (faster)
- ✅ Import map shim (older browsers)
- ✅ Clean console (no debug spam)
- ✅ Safer code (no innerHTML)
- ✅ Pinned CDN versions (stable)
- ✅ Standalone Git repo (safe commits)

---

## 🎯 Keyboard Shortcuts

- **S** - Toggle settings drawer
- **Escape** - Close settings drawer
- **⌘+Option+J** - Open browser console

---

## 📁 Project Structure

```
reactive/
├── .git/              # Git repository
├── .gitignore         # Ignore rules
├── README.md          # Full documentation
├── CHANGES.md         # Implementation details
├── QUICKSTART.md      # This file
├── index.html         # Entry point
├── src/
│   ├── main.js        # App initialization
│   ├── audio.js       # Audio engine
│   ├── scene.js       # Three.js visuals
│   ├── settings-ui.js # Settings drawer
│   ├── feature.js     # Feature detection
│   └── lazy.js        # Lazy loading helpers
└── public/
    ├── workers/       # Web Workers (Essentia)
    └── worklets/      # AudioWorklet (analysis)
```

---

## 🎬 Next Steps

1. **Test all features** (use checklist in CHANGES.md)
2. **Adjust settings** to your preferences
3. **Save presets** (Settings → Presets → Save)
4. **Report issues** if any bugs found

---

**Enjoy the cosmic visualizer! 🌌✨**
