/**
 * Performance Pads Controller
 *
 * Lightweight, self-contained controller to trigger short visual bursts from the keyboard.
 * Phase 1 implements Pad "1 — Warp Zoom + RGB split" only, with:
 * - Hold: momentary envelope (attack/decay)
 * - Double-tap: latch toggle
 * - Panic: key "0" to clear all pads
 * - Global toggle: key "P" to enable/disable performance mode
 *
 * The controller exposes a uniform deltas provider so the renderer can blend these
 * bursts non-destructively with the audio-reactive baseline.
 */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export class PerformanceController {
  constructor({ sceneApi, sync } = {}) {
    this.sceneApi = sceneApi;
    this.sync = sync || null;
    this.enabled = false; // performance mode off by default
    this.nowMs = performance.now();
    // Global musical context snapshot
    this._lastBpm = 120;
    this._beatMs = 500;

    // Pad 1 — Manual tunnel zoom (geometry only)
    this.pad1 = {
      name: 'Warp + RGB',
      isDown: false,
      latched: false,
      lastTapMs: 0,
      intensity: 0, // 0..1 envelope
      attackMs: 90,
      decayMs: 220,
      // Geometric motion only (no color/brightness changes)
      zoomAmount: 6.0,             // gentler additive zoom
      travelBoost: 0.18,           // gentler forward motion
      // Release snap (quick zoom pulse when button released)
      releaseSnapMs: 140,
      releaseSnapStrength: 0.8,    // scales snap amount
      releaseSnapZoom: -5.0,       // negative pushes back out briefly
      // Damped bounce after release
      releaseBounceBeats: 0.45,    // shorter musical bounce
      releaseBounceAmp: 3.2,       // smaller oscillation
      shiftMultiplier: 1.5,
      _snapRemainMs: 0,
      _bounceRemainMs: 0,
      gain: 1.0,                   // user-adjustable live intensity 0.2..2.0
      quantize: null,              // '1/4' | '1/2' | '1' | null
      _pendingEngage: false,
      _pendingRelease: false,
    };

    // Pad 2 — Shutter shot (very short pulse)
    this.pad2 = {
      name: 'Shutter Shot',
      type: 'shot',
      durationMs: 120,
      gain: 1.0,
      quantize: '1/4',
      _active: false,
      _t0: 0,
      // pulse shape parameters
      zoomPulse: 5.0,
      travelPulse: 0.12,
    };

    // Pad 3 — Smear (gentle continuous forward drag)
    this.pad3 = {
      name: 'Smear',
      isDown: false,
      latched: false,
      intensity: 0,
      attackMs: 100,
      decayMs: 300,
      gain: 1.0,
      quantize: null,
      exclusivityGroup: 'heavy-post',
      travelBoost: 0.22,
      zoomBias: 1.8,
    };

    // Pad 4 — Stutter Shot (dual micro-pulses)
    this.pad4 = {
      name: 'Stutter Shot',
      type: 'shot',
      durationMs: 160,
      gapMs: 40,
      gain: 1.0,
      quantize: '1/8',
      _active: false,
      _t0: 0,
      zoomPulse: 3.5,
      travelPulse: 0.1,
    };

    // Pad 5 — Swirl morph (twist only)
    this.pad5 = {
      name: 'Swirl',
      isDown: false,
      latched: false,
      intensity: 0,
      attackMs: 120,
      decayMs: 280,
      gain: 1.0,
      quantize: null,
      twistBoost: 0.28,
    };

    this._installHud();
    this._installKeyHandlers();
    try { this.sync?.setPadEventHandler?.((evt) => this._handleRemotePadEvent(evt)); } catch (_) {}
  }

  _broadcast(event) {
    try { this.sync?.sendPadEvent?.(event); } catch (_) {}
  }

  // Public API used by the animation loop
  update(dt /* seconds */, nowMs = performance.now(), features = null) {
    this.nowMs = nowMs;
    if (features && features.bpm && isFinite(features.bpm) && features.bpm > 1) {
      this._lastBpm = features.bpm;
      this._beatMs = 60000 / this._lastBpm;
    }
    const p = this.pad1;
    // Quantize start/stop if requested
    if (this.enabled && p.quantize) {
      if (p._pendingEngage && features?.beat) { p.isDown = true; p._pendingEngage = false; }
      if (p._pendingRelease && features?.beat) { p.isDown = false; p._pendingRelease = false; }
    }
    const target = (this.enabled && (p.isDown || p.latched)) ? 1 : 0;
    const att = p.attackMs > 0 ? clamp(dt * 1000 / p.attackMs, 0, 1) : 1;
    const rel = p.decayMs > 0 ? clamp(dt * 1000 / p.decayMs, 0, 1) : 1;
    const rate = target > p.intensity ? att : rel;
    p.intensity = p.intensity + (target - p.intensity) * rate;
    if (p.intensity < 1e-4 && !p.isDown && !p.latched) p.intensity = 0;
    if (p._snapRemainMs > 0) p._snapRemainMs = Math.max(0, p._snapRemainMs - dt * 1000);
    if (p._bounceRemainMs > 0) p._bounceRemainMs = Math.max(0, p._bounceRemainMs - dt * 1000);

    // Pad 2 quantize scheduling
    if (this.enabled && this.pad2 && this.pad2.quantize && this.pad2._pending && features?.beat) {
      this.pad2._active = true; this.pad2._t0 = this.nowMs; this.pad2._pending = false;
      this._broadcast({ key: '2', action: 'shot', t: this.nowMs });
    }
    // Pad 4 quantize scheduling
    if (this.enabled && this.pad4 && this.pad4.quantize && this.pad4._pending && features?.beat) {
      this.pad4._active = true; this.pad4._t0 = this.nowMs; this.pad4._pending = false;
      this._broadcast({ key: '4', action: 'shot', t: this.nowMs });
    }

    // HUD update (cheap)
    if (this._hudPad1) {
      this._hudPad1.style.setProperty('--fill', String(clamp(p.intensity, 0, 1)));
      this._hud.classList.toggle('on', !!this.enabled);
      this._hudModeText.textContent = this.enabled ? 'Performance: ON' : 'Performance: OFF';
      this._hudPad1.classList.toggle('active', p.isDown || p.latched || p.intensity > 0.001);
    }
  }

  // Scene pulls deltas each frame via sceneApi.setUniformDeltasProvider
  getDeltas() {
    if (!this.enabled) return null;
    const out = {};

    // Pad 1 contribution
    {
      const p = this.pad1;
      const mult = (this._lastShiftHeld ? p.shiftMultiplier : 1);
      const k = clamp(p.intensity, 0, 1) * mult * clamp(p.gain, 0.2, 2.0);
      if (k > 1e-6) {
        const snapT = p._snapRemainMs > 0 ? (p._snapRemainMs / Math.max(1, p.releaseSnapMs)) : 0;
        const snapEnv = snapT > 0 ? 1 - Math.pow(1 - snapT, 3) : 0;
        const bounceTotalMs = clamp(this._beatMs * (p.releaseBounceBeats || 0.6), 80, 1600);
        const br = p._bounceRemainMs > 0 ? (p._bounceRemainMs / Math.max(1, bounceTotalMs)) : 0;
        const bounceEnv = br > 0 ? Math.pow(br, 1.5) : 0;
        const phase = (1 - br) * Math.PI * 2.2; // ~2.2 oscillations over window
        const zoomBounce = bounceEnv * Math.sin(phase) * p.releaseBounceAmp;
        out.dispersionZoom = (out.dispersionZoom || 0) + k * p.zoomAmount;
        out.dispersionTravelBoost = (out.dispersionTravelBoost || 0) + k * p.travelBoost;
        out.zoomSnap = (out.zoomSnap || 0) + snapEnv * p.releaseSnapStrength * p.releaseSnapZoom;
        out.zoomBounce = (out.zoomBounce || 0) + zoomBounce;
        out.centering = Math.max(out.centering || 0, k);
      }
    }

    // Pad 2 contribution (shot)
    {
      const p2 = this.pad2;
      if (p2._active) {
        const t = clamp((this.nowMs - p2._t0) / Math.max(1, p2.durationMs), 0, 1);
        const env = Math.sin(Math.PI * t); // 0→1→0
        const k = env * clamp(p2.gain, 0.2, 2.0);
        out.dispersionZoom = (out.dispersionZoom || 0) + k * p2.zoomPulse;
        out.dispersionTravelBoost = (out.dispersionTravelBoost || 0) + k * p2.travelPulse;
        out.centering = Math.max(out.centering || 0, k);
        if (t >= 1) p2._active = false;
      }
    }

    // Pad 3 contribution (smear)
    {
      const p3 = this.pad3;
      // exclusivity (simple): if another heavy pad is active, ignore
      const heavyBlocked = false; // reserved for future heavy-post collision
      if (!heavyBlocked) {
        const att = p3.attackMs > 0 ? clamp((this.nowMs - (p3._tStart || 0)) / p3.attackMs, 0, 1) : 1;
        const rel = p3.decayMs > 0 ? clamp((this.nowMs - (p3._tRelease || 0)) / p3.decayMs, 0, 1) : 1;
        const target = (p3.isDown || p3.latched) ? 1 : 0;
        if (target && !p3._active) { p3._active = true; p3._tStart = this.nowMs; }
        if (!target && p3._active && !p3._releasing) { p3._releasing = true; p3._tRelease = this.nowMs; }
        if (p3._active) {
          if (target) { p3.intensity = Math.min(1, Math.max(p3.intensity, att)); }
          else { p3.intensity = Math.max(0, 1 - rel); if (p3.intensity <= 1e-3) { p3._active = false; p3._releasing = false; } }
          const k = p3.intensity * clamp(p3.gain, 0.2, 2.0);
          if (k > 1e-6) {
            out.dispersionTravelBoost = (out.dispersionTravelBoost || 0) + k * p3.travelBoost;
            out.dispersionZoom = (out.dispersionZoom || 0) + k * p3.zoomBias;
            out.centering = Math.max(out.centering || 0, 0.4 * k);
          }
        }
      }
    }

    // Pad 4 contribution (dual-pulse stutter)
    {
      const p4 = this.pad4;
      if (p4._active) {
        const dtSince = this.nowMs - p4._t0;
        const pulseLen = Math.max(1, p4.durationMs);
        const gap = Math.max(0, p4.gapMs);
        let env = 0;
        // first pulse window
        if (dtSince <= pulseLen) {
          const t = clamp(dtSince / pulseLen, 0, 1);
          env = Math.sin(Math.PI * t);
        } else if (dtSince > pulseLen + gap && dtSince <= 2 * pulseLen + gap) {
          const t = clamp((dtSince - pulseLen - gap) / pulseLen, 0, 1);
          env = Math.sin(Math.PI * t);
        } else if (dtSince > 2 * pulseLen + gap) {
          p4._active = false;
        }
        if (env > 0) {
          const k = env * clamp(p4.gain, 0.2, 2.0);
          out.dispersionZoom = (out.dispersionZoom || 0) + k * p4.zoomPulse;
          out.dispersionTravelBoost = (out.dispersionTravelBoost || 0) + k * p4.travelPulse;
          out.centering = Math.max(out.centering || 0, k);
        }
      }
    }

    // Pad 5 contribution (swirl twist)
    {
      const p5 = this.pad5;
      const att = p5.attackMs > 0 ? clamp((this.nowMs - (p5._tStart || 0)) / p5.attackMs, 0, 1) : 1;
      const rel = p5.decayMs > 0 ? clamp((this.nowMs - (p5._tRelease || 0)) / p5.decayMs, 0, 1) : 1;
      const target = (p5.isDown || p5.latched) ? 1 : 0;
      if (target && !p5._active) { p5._active = true; p5._tStart = this.nowMs; }
      if (!target && p5._active && !p5._releasing) { p5._releasing = true; p5._tRelease = this.nowMs; }
      if (p5._active) {
        if (target) { p5.intensity = Math.min(1, Math.max(p5.intensity, att)); }
        else { p5.intensity = Math.max(0, 1 - rel); if (p5.intensity <= 1e-3) { p5._active = false; p5._releasing = false; } }
        const k = p5.intensity * clamp(p5.gain, 0.2, 2.0);
        if (k > 1e-6) {
          out.dispersionTwistBoost = (out.dispersionTwistBoost || 0) + k * p5.twistBoost;
        }
      }
    }

    return Object.keys(out).length ? out : null;
  }

  panic() {
    const p = this.pad1;
    p.isDown = false;
    p.latched = false;
    p.intensity = 0;
    if (this._hud) this._hud.classList.remove('on');
  }

  // -----------------
  // Internal helpers
  // -----------------

  _installKeyHandlers() {
    const isEditableTarget = (ev) => {
      const tag = (ev.target?.tagName ?? '').toLowerCase();
      return ['input', 'textarea', 'select', 'button'].includes(tag) || ev.isComposing;
    };

    window.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented) return;
      if (ev.repeat) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (isEditableTarget(ev)) return;
      const k = (ev.key || '').toLowerCase();
      this._lastShiftHeld = !!ev.shiftKey;

      if (k === 'p') {
        ev.preventDefault();
        this.enabled = !this.enabled;
        if (this._hud) this._hud.classList.toggle('on', this.enabled);
        return;
      }
      if (!this.enabled) return;

      if (k === '0') {
        ev.preventDefault();
        this.panic();
        return;
      }

      if (k === '1') {
        ev.preventDefault();
        const p = this.pad1;
        if (p.quantize) { p._pendingEngage = true; } else { p.isDown = true; }
        this._broadcast({ key: '1', action: 'engage', t: this.nowMs });
        const now = this.nowMs || performance.now();
        // Double-tap within 250ms toggles latch
        if (now - (p.lastTapMs || 0) < 250) {
          p.latched = !p.latched;
        }
        p.lastTapMs = now;
      }

      if (k === '2') {
        ev.preventDefault();
        const p2 = this.pad2;
        if (p2.quantize) { p2._pending = true; } else { p2._active = true; p2._t0 = this.nowMs; }
        this._broadcast({ key: '2', action: 'shot', t: this.nowMs });
      }

      if (k === '3') {
        ev.preventDefault();
        const p3 = this.pad3;
        p3.isDown = true;
        this._broadcast({ key: '3', action: 'engage', t: this.nowMs });
      }

      if (k === '4') {
        ev.preventDefault();
        const p4 = this.pad4;
        if (p4.quantize) { p4._pending = true; } else { p4._active = true; p4._t0 = this.nowMs; }
        this._broadcast({ key: '4', action: 'shot', t: this.nowMs });
      }

      if (k === '5') {
        ev.preventDefault();
        const p5 = this.pad5;
        p5.isDown = true;
        this._broadcast({ key: '5', action: 'engage', t: this.nowMs });
      }

      // Live intensity control while holding the pad key
      if (k === 'arrowup') {
        ev.preventDefault();
        if (this.pad1.isDown) this.pad1.gain = clamp(this.pad1.gain + 0.08, 0.2, 2.0);
        if (this.pad3.isDown) this.pad3.gain = clamp(this.pad3.gain + 0.08, 0.2, 2.0);
      }
      if (k === 'arrowdown') {
        ev.preventDefault();
        if (this.pad1.isDown) this.pad1.gain = clamp(this.pad1.gain - 0.08, 0.2, 2.0);
        if (this.pad3.isDown) this.pad3.gain = clamp(this.pad3.gain - 0.08, 0.2, 2.0);
      }
    });

    window.addEventListener('keyup', (ev) => {
      if (ev.defaultPrevented) return;
      const k = (ev.key || '').toLowerCase();
      this._lastShiftHeld = !!ev.shiftKey;
      if (!this.enabled) return;
      if (k === '1') {
        // Release only ends momentary; latched keeps running
        if (this.pad1.quantize) { this.pad1._pendingRelease = true; } else { this.pad1.isDown = false; }
        // Trigger snap-back pulse if not latched
        if (!this.pad1.latched) {
          this.pad1._snapRemainMs = this.pad1.releaseSnapMs;
          this.pad1._bounceRemainMs = this.pad1.releaseBounceMs;
        }
        this._broadcast({ key: '1', action: 'release', t: this.nowMs });
      }

      if (k === '3') {
        this.pad3.isDown = false;
        this._broadcast({ key: '3', action: 'release', t: this.nowMs });
      }

      if (k === '5') {
        this.pad5.isDown = false;
        this._broadcast({ key: '5', action: 'release', t: this.nowMs });
      }
    });

    // Global wheel → live intensity adjust for the last held pad (1 or 3)
    window.addEventListener('wheel', (ev) => {
      if (!this.enabled) return;
      const delta = clamp(ev.deltaY, -200, 200) / 600; // gentle
      if (this.pad1.isDown) this.pad1.gain = clamp(this.pad1.gain - delta, 0.2, 2.0);
      if (this.pad3.isDown) this.pad3.gain = clamp(this.pad3.gain - delta, 0.2, 2.0);
    }, { passive: true });

    // Safety: on blur/visibility change, stop momentary presses
    window.addEventListener('blur', () => this.panic());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') this.panic();
    });
  }

  _handleRemotePadEvent(evt) {
    if (!evt || !this.enabled) return;
    const k = String(evt.key || '');
    const a = String(evt.action || '');
    if (k === '1') {
      if (a === 'engage') this.pad1.isDown = true;
      else if (a === 'release') {
        this.pad1.isDown = false;
        if (!this.pad1.latched) { this.pad1._snapRemainMs = this.pad1.releaseSnapMs; this.pad1._bounceRemainMs = this.pad1.releaseBounceMs; }
      }
    } else if (k === '2') {
      if (a === 'shot') { this.pad2._active = true; this.pad2._t0 = this.nowMs; }
    } else if (k === '3') {
      if (a === 'engage') this.pad3.isDown = true;
      else if (a === 'release') this.pad3.isDown = false;
    } else if (k === '4') {
      if (a === 'shot') { this.pad4._active = true; this.pad4._t0 = this.nowMs; }
    } else if (k === '5') {
      if (a === 'engage') this.pad5.isDown = true;
      else if (a === 'release') this.pad5.isDown = false;
    }
  }

  _installHud() {
    try {
      // Only inject styles once to prevent duplicates
      if (!document.getElementById('perf-hud-styles')) {
        const style = document.createElement('style');
        style.id = 'perf-hud-styles';
        style.textContent = `
          #perf-hud { position: fixed; left: 20px; bottom: 20px; z-index: 46; display: grid; gap: 8px; color: #fff; font: 600 12px Inter, system-ui, sans-serif; pointer-events: none; }
          #perf-hud .row { display: flex; align-items: center; gap: 10px; opacity: 0.85; }
          #perf-hud .mode { padding: 8px 10px; border-radius: 12px; border:1px solid rgba(255,255,255,0.2); background: rgba(255,255,255,0.08); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); pointer-events: auto; }
          #perf-hud .pads { display: flex; gap: 8px; }
          #perf-hud .pad { width: 26px; height: 26px; border-radius: 50%; border:1px solid rgba(255,255,255,0.25); background: rgba(255,255,255,0.06); position: relative; pointer-events: auto; cursor: default; }
          #perf-hud .pad::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: linear-gradient(180deg, #00ffff, #ff6ad5); transform: scale(var(--fill, 0)); transform-origin: center; transition: transform 90ms linear; opacity: 0.9; }
          #perf-hud .label { opacity: 0.85; }
          #perf-hud.on .mode { border-color: #00ffff; }
          #perf-hud .pad.active { box-shadow: 0 0 12px rgba(0,255,255,0.35) inset; }
        `;
        document.head.appendChild(style);
      }

      const root = document.createElement('div');
      root.id = 'perf-hud';
      root.innerHTML = `
        <div class="row">
          <div class="mode"><span id="perf-hud-mode">Performance: OFF</span> · P toggle · 0 panic</div>
        </div>
        <div class="row pads">
          <div class="pad" title="1 — Warp + RGB"></div>
          <div class="label">1: Warp + RGB</div>
        </div>
      `;
      document.body.appendChild(root);
      this._hud = root;
      this._hudPad1 = root.querySelector('.pad');
      this._hudModeText = root.querySelector('#perf-hud-mode');
    } catch (_) {
      // HUD is optional; continue silently if DOM is unavailable
    }
  }
}

export default PerformanceController;


