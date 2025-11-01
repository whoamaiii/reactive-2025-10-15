# Ops Runbook — Reactive (Interactive Cosmic Anomaly)

Date: 2025-10-29

## Quick Start (Showtime)
1) Terminal A
   - cd /Users/quentinthiessen/Desktop/reactive
   - npm install
   - ./scripts/show-start.sh
   - Open control page if not auto-opened: http://localhost:5173

2) Terminal B (OSC bridge, optional if using TouchDesigner)
   - cd /Users/quentinthiessen/Desktop/reactive/tools
   - npm install
   - node osc-bridge.js

## Operator Checklist
- Source:
  - For Chrome tab audio (Mac): pick Tab (Chrome) and enable “Share tab audio”.
  - For system mix: select BlackHole as Mic; choose the BlackHole device in Settings → Source.
  - For files: drag-and-drop or use File button.

- Audio Controls (Settings → Audio):
  - Beat Refractory (ms): increase to reduce double-triggers (typical 300–400ms).
  - Beat Energy Floor: raise to ignore hats/quiet hits; gates beats unless bass env is strong.
  - Noise Gate: enable to suppress venue rumble; set Threshold 0.05–0.20.
  - Calibrate (5s): learns ambient floor from current input; enables gate and sets threshold.
  - Low CPU Mode: reduces Meyda rate when machine is under load.

- Visuals Safety:
  - Effects Profile: Off / Medium / High — use Off during troubleshooting.
  - Reset Visuals: rebuilds composer/passes; use if postprocessing becomes unstable.
  - Visual Mode: Classic (3D only) is safest; Overlay adds shader; Shader-only for projector-only looks.

- Sync/Projector:
  - Open projector window from Settings → Session.
  - Use Auto Sync to push param updates continuously; Push Now for manual.
  - OSC: bridge should log heartbeat every 5s; expect feature packets ~30Hz.

## PM2 (optional, keep bridge running headless)
1) Install pm2 globally: `npm i -g pm2`
2) Configure env in `tools/.env` (optional)
3) Start bridge with pm2:
   - cd /Users/quentinthiessen/Desktop/reactive/tools
   - npm run pm2
4) Manage:
   - Restart: `npm run pm2:restart`
   - Stop: `npm run pm2:stop`
   - Logs: `npm run pm2:logs`

## Troubleshooting
- No Audio (Tab):
  - In Chrome picker: choose a tab with audio and enable “Share tab audio”.
  - macOS: System Settings → Privacy & Security → Screen Recording → allow Chrome.

- No Audio (System):
  - Use BlackHole (2ch). Create a Multi-Output (BlackHole + speakers) in Audio MIDI Setup. Set system output to Multi-Output. Select BlackHole as Mic in app.

- Beats over-triggering:
  - Increase Beat Refractory (e.g., 350–450ms).
  - Raise Beat Energy Floor to ~0.35–0.55 for DnB; ensure bass is driving beats.
  - Enable Noise Gate and Calibrate (5s) when venue rumble is present.

- Low FPS / Thermal:
  - Effects Profile → Off; Auto Resolution → On; Target FPS 60.
  - Reduce Pixel Ratio; lower Particle Density; disable Sparks.

- Visuals glitchy:
  - Use Reset Visuals; switch Visual Mode to Classic temporarily.

- OSC/TouchDesigner not responding:
  - Check bridge logs (connected clients, heartbeat).
  - Verify WS ws://127.0.0.1:8090 reachable; OSC host/port in tools/.env.
  - Ensure firewall allows local WS/OSC.

## Test Procedures
- Offline Readiness
  - Disconnect network (or run Chrome with offline throttling).
  - Load control page; verify visuals and HDR load from /public/assets.
  - Essentia worker: verify local-first load; expect graceful fallback if absent.

- Performance
  - Toggle Effects Profile (Off/Medium/High) and confirm FPS stabilizes.
  - Stress test by maximizing particles; observe auto-resolution hysteresis.
  - Confirm spark throttling engages when FPS dips.

- Audio Reactivity
  - With venue quiet (mic selected), enable Noise Gate and run Calibrate (5s); beats ≈ 0.
  - Play DnB (file or tab). Tune Beat Refractory (~350ms) and Energy Floor (~0.3–0.5) until downbeats are clean.

- Sync / OSC
  - Start OSC bridge. Confirm 5s heartbeat and client counts.
  - In app, features should send ~30Hz. Validate reception in TouchDesigner.

## Panic Actions
- Effects Profile → Off.
- Reset Visuals.
- Switch Visual Mode → Classic.
- Load a safe preset (Presets → DnB Mode).

## Ports
- Vite: 5173
- Feature WS (bridge): 8090 (configurable via tools/.env)
- OSC: 9000 (configurable via tools/.env)

## Notes
- Use http://localhost (not file://) for audio APIs.
- ?debug adds feature matrix logs; avoid in show unless needed.
- Resume watchdog re-activates audio on focus/pointerdown; if stuck, click inside the page.
