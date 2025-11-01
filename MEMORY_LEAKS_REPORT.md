# Memory Leaks Analysis Report

## Executive Summary

This codebase contains **multiple critical memory leaks** that prevent proper garbage collection and resource cleanup. The application is a Three.js-based audio-reactive visualization that creates numerous resources (event listeners, WebSockets, audio contexts, animation loops, etc.) but provides **no cleanup mechanism** when the page is unloaded or the application is torn down.

---

## Why Memory Leaks Are Bad

Memory leaks have serious consequences for application performance and user experience:

### 1. **Progressive Performance Degradation**
- Memory usage increases continuously over time
- Browser tab becomes sluggish and unresponsive
- Frame rate drops, causing stuttering visuals
- Eventually leads to browser tab crashes

### 2. **System Resource Exhaustion**
- Leaked resources (audio contexts, WebSockets) consume system memory
- Multiple tabs or repeated page loads compound the problem
- Can affect entire system performance, not just the browser
- May force users to restart their browser or computer

### 3. **Audio-Specific Issues**
- WebAudio contexts have strict limits (typically 6 per browser instance)
- Leaked audio contexts prevent new ones from being created
- Can cause "too many audio contexts" errors in other tabs
- Audio processing continues in the background, wasting CPU cycles

### 4. **Network Resource Waste**
- Leaked WebSocket connections remain open
- Server maintains connections to "zombie" clients
- Wastes bandwidth and server resources
- May hit connection limits on servers

### 5. **GPU Memory Leaks**
- Three.js geometries, materials, and textures consume GPU memory
- GPU memory is more limited than system RAM
- Can cause graphics driver crashes
- Affects other GPU-intensive applications

---

## Identified Memory Leaks

### 1. **Event Listeners Never Removed** (CRITICAL)

#### Location: `src/main.js:327-617`

**Problem:** 10+ event listeners are registered but never cleaned up:

```javascript
// Line 327
window.addEventListener('resize', sceneApi.onResize);

// Line 330
window.addEventListener('mousemove', sceneApi.onMouseMove);

// Line 340
document.addEventListener('visibilitychange', async () => { ... });

// Line 360
window.addEventListener('focus', async () => { ... });

// Line 366
window.addEventListener('pointerdown', async () => { ... });

// Lines 571-576
['dragenter', 'dragover'].forEach(evt => {
  window.addEventListener(evt, (e) => { ... });
});

// Lines 579-584
['dragleave', 'drop'].forEach(evt => {
  window.addEventListener(evt, (e) => { ... });
});

// Line 587
window.addEventListener('drop', async (e) => { ... });

// Line 606
document.getElementById('open-system-audio-help')?.addEventListener('click', () => { ... });
```

**Impact:**
- Event listener callbacks hold references to objects (sceneApi, audio, sync, etc.)
- Prevents garbage collection of entire application state
- Callbacks continue firing even after intended cleanup
- 57 total addEventListener calls vs only 3 removeEventListener calls

---

### 2. **Infinite Animation Loop** (CRITICAL)

#### Location: `src/main.js:400-562`

**Problem:** The `requestAnimationFrame` loop never stops:

```javascript
function animate() {
  requestAnimationFrame(animate); // Line 402 - infinite recursion
  // ... animation logic
}

animate(); // Line 562 - starts the loop
```

**Impact:**
- Animation loop holds references to all application objects
- Prevents garbage collection of scene, audio engine, sync coordinator
- Continues consuming CPU/GPU even when page is in background
- No `cancelAnimationFrame` call exists in the codebase

**Fix Needed:**
```javascript
let animationFrameId = null;

function animate() {
  animationFrameId = requestAnimationFrame(animate);
  // ... animation logic
}

function cleanup() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}
```

---

### 3. **WebSocket Connection Not Closed** (HIGH)

#### Location: `src/main.js:202-264`

**Problem:** WebSocket is created but never explicitly closed:

```javascript
// Line 231
const ws = new WebSocket(FEATURE_WS_URL);

// Has handlers but no cleanup:
ws.onopen = () => { ... };
ws.onclose = () => { ... };
ws.onerror = () => { ... };

// WebSocket reference stored globally at line 202
let featureWs = null;
```

**Impact:**
- WebSocket connection remains open after page unload
- Server continues maintaining connection to dead client
- Network resources wasted
- Connection count may hit server limits

**Fix Needed:**
```javascript
function cleanup() {
  if (featureWs && featureWs.readyState === WebSocket.OPEN) {
    featureWs.close();
    featureWs = null;
  }
}
```

---

### 4. **AudioContext Never Closed** (HIGH)

#### Location: `src/audio.js`

**Problem:** AudioContext is created but never closed:

```javascript
// AudioContext created in AudioEngine class
this.ctx = new StdAudioContext();
```

**Verification:**
- Searched for `ctx.close()` - **0 matches found**
- Searched for `audioContext.close()` - **0 matches found**

**Impact:**
- AudioContext consumes significant system resources
- Browsers limit AudioContext instances (typically 6 per browser)
- Leaked contexts prevent new ones from being created
- Audio processing thread continues running
- Can cause "Failed to create AudioContext" errors

**Fix Needed:**
```javascript
async stop() {
  // ... existing stop logic

  if (this.ctx && this.ctx.state !== 'closed') {
    await this.ctx.close();
    this.ctx = null;
  }
}
```

---

### 5. **BroadcastChannel Not Closed** (MEDIUM)

#### Location: `src/sync.js:234-241`

**Problem:** BroadcastChannel is created but never closed:

```javascript
// Line 236
this.channel = new BroadcastChannel(CHANNEL_NAME);

// Line 237
this.channel.onmessage = (event) => this._handleMessage(event?.data, 'broadcast');
```

**Impact:**
- BroadcastChannel maintains message queue in memory
- Message handlers hold references to SyncCoordinator
- Prevents garbage collection of sync coordinator and scene API

**Fix Needed:**
```javascript
cleanup() {
  if (this.channel) {
    this.channel.close();
    this.channel = null;
  }
}
```

---

### 6. **Event Listeners in SyncCoordinator** (MEDIUM)

#### Location: `src/sync.js:243-256`

**Problem:** Window event listeners never removed:

```javascript
// Line 244
window.addEventListener('message', (event) => {
  this._handleMessage(event?.data, 'postMessage', event.source || null);
});

// Line 247
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY || !event.newValue) return;
  try {
    const parsed = JSON.parse(event.newValue);
    this._handleMessage(parsed, 'storage');
  } catch (_) {}
});
```

**Impact:**
- Message/storage handlers hold references to SyncCoordinator
- Prevents garbage collection of entire sync system
- Handlers continue processing messages after cleanup

---

### 7. **Event Listeners in PerformanceController** (MEDIUM)

#### Location: `src/performance-pads.js:292-405`

**Problem:** Multiple keyboard event listeners never removed:

```javascript
// Line 292
window.addEventListener('keydown', (ev) => { ... });

// Line 368
window.addEventListener('keyup', (ev) => { ... });

// Line 396
window.addEventListener('wheel', (ev) => { ... });

// Line 404
window.addEventListener('blur', () => this.panic());

// Line 405
document.addEventListener('visibilitychange', () => { ... });
```

**Impact:**
- Holds references to PerformanceController, sceneApi, and sync
- Prevents garbage collection of these large objects
- Keyboard handlers continue firing after intended cleanup

---

### 8. **Three.js Resources Potentially Not Disposed** (MEDIUM)

#### Location: `src/scene.js`

**Problem:** While there are some dispose calls, there's no comprehensive cleanup:

**Partial Cleanup Found:**
```javascript
// Lines 1058-1061 - cleanup in rebuildParticles():
state.coreSphere.geometry.dispose();
state.coreSphere.material.dispose();
state.orbitRings.children.forEach(r => {
  r.geometry.dispose();
  r.material.dispose();
});
```

**Issue:** This cleanup only happens during rebuild, not on application teardown.

**Resources That May Leak:**
- `THREE.WebGLRenderer` (line instantiation)
- `EffectComposer` and post-processing effects
- HDR textures (disposed during rebuild but not final cleanup)
- Camera controls
- Scene objects

**Impact:**
- GPU memory not released
- Can cause GPU driver issues
- Prevents browser from reclaiming video memory

---

### 9. **setInterval in OSC Bridge** (LOW - only affects osc-bridge tool)

#### Location: `tools/osc-bridge.js:130`

**Problem:** setInterval never cleared:

```javascript
setInterval(() => {
  // ... heartbeat logic
}, 5000);
```

**Impact:**
- Timer continues running even if bridge is stopped
- Holds references to WebSocket server and connections
- Relatively minor compared to other leaks

---

### 10. **Audio Worklet Node Not Properly Disconnected** (LOW)

#### Location: `src/audio.js:782-784`

**Partial Cleanup Found:**
```javascript
try { this.gainNode.disconnect(); } catch (_) {}
if (this.workletNode) {
  try { this.workletNode.disconnect(); } catch (_) {}
}
```

**Issue:** Disconnect is called in some places but not consistently on final teardown.

---

## Statistics

| Metric | Count |
|--------|-------|
| Total `addEventListener` calls | 57 |
| Total `removeEventListener` calls | 3 |
| **Uncleaned event listeners** | **~54** |
| AudioContext instances | 1 (never closed) |
| WebSocket connections | 1 (not properly closed) |
| BroadcastChannel instances | 1 (never closed) |
| requestAnimationFrame loops | 1 (never cancelled) |

---

## Recommendations

### Immediate Actions (Critical)

1. **Create a Global Cleanup Function**
   ```javascript
   function cleanup() {
     // Cancel animation loop
     if (animationFrameId) cancelAnimationFrame(animationFrameId);

     // Close WebSocket
     if (featureWs) featureWs.close();

     // Close AudioContext
     if (audio.ctx) audio.ctx.close();

     // Close BroadcastChannel
     if (sync.channel) sync.channel.close();

     // Remove all event listeners
     window.removeEventListener('resize', sceneApi.onResize);
     // ... remove all others

     // Dispose Three.js resources
     sceneApi.dispose();
   }
   ```

2. **Register Cleanup on Page Unload**
   ```javascript
   window.addEventListener('beforeunload', cleanup);
   window.addEventListener('pagehide', cleanup);
   ```

3. **Implement Dispose Methods**
   - Add `AudioEngine.dispose()` method
   - Add `SyncCoordinator.dispose()` method
   - Add `PerformanceController.dispose()` method
   - Add `sceneApi.dispose()` method (comprehensive Three.js cleanup)

### Long-term Improvements

1. **Use AbortController for Event Listeners** (Modern approach)
   ```javascript
   const controller = new AbortController();
   window.addEventListener('resize', handler, { signal: controller.signal });

   // Cleanup:
   controller.abort(); // Removes all listeners automatically
   ```

2. **Implement Lifecycle Management**
   - Create `init()` and `dispose()` pairs for all major classes
   - Track all resources in a cleanup registry
   - Ensure dispose methods are called in correct order

3. **Add Memory Leak Tests**
   - Use Chrome DevTools Memory Profiler
   - Monitor heap snapshots before/after page reload
   - Verify all resources are released

4. **Consider Using a Framework**
   - Modern frameworks (React, Vue, Svelte) handle cleanup automatically
   - Component lifecycle hooks ensure proper teardown

---

## Severity Assessment

| Leak Type | Severity | Impact | Priority |
|-----------|----------|--------|----------|
| Event Listeners | **CRITICAL** | Memory + Performance | **P0** |
| Animation Loop | **CRITICAL** | Memory + CPU/GPU | **P0** |
| AudioContext | **HIGH** | System Resources | **P1** |
| WebSocket | **HIGH** | Network Resources | **P1** |
| BroadcastChannel | **MEDIUM** | Memory | **P2** |
| Three.js Resources | **MEDIUM** | GPU Memory | **P2** |

---

## Testing Strategy

To verify memory leaks:

1. **Chrome DevTools Memory Profiler:**
   ```
   1. Open DevTools → Memory tab
   2. Take heap snapshot
   3. Use the application normally
   4. Reload the page
   5. Take another heap snapshot
   6. Compare - detached DOM nodes and retained objects indicate leaks
   ```

2. **Performance Monitor:**
   ```
   1. Open DevTools → Performance Monitor
   2. Watch "JS heap size" and "GPU memory"
   3. Reload page multiple times
   4. If memory doesn't decrease, leaks exist
   ```

3. **Audio Context Test:**
   ```javascript
   // In console after multiple page loads:
   console.log(window.audioContexts); // Should be 1, not accumulating
   ```

---

## Conclusion

This application has **critical memory leaks** that will cause:
- Progressive performance degradation
- Browser tab crashes after extended use
- Audio system resource exhaustion
- Poor user experience

**Immediate action required** to implement cleanup lifecycle for all resources.

---

*Report Generated: 2025-11-01*
*Codebase: reactive-show v0.1.0*
