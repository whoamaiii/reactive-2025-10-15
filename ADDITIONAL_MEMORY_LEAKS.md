# Additional Memory Leaks - Deep Analysis

## Executive Summary

After implementing the initial memory leak fixes, a **deep analysis** revealed **7 additional memory leaks** that were missed in the first pass. While the critical leaks (AudioContext, animation loop, major event listeners) were fixed, several subtle leaks remain that can cause issues over extended use.

---

## Newly Discovered Memory Leaks

### 1. **Untracked Keydown Listener in main.js** (MEDIUM)

#### Location: `src/main.js:81-91`

**Problem:** A keydown event listener for the 'L' key is registered but never tracked or cleaned up:

```javascript
// Line 81
window.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (event.repeat) return;
  const key = event.key || '';
  if (key !== 'L' && key !== 'l') return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const tag = (event.target && event.target.tagName || '').toLowerCase();
  if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
  event.preventDefault();
  openPresetLibrary();
});
```

**Impact:**
- Event listener holds references to `openPresetLibrary` function
- Prevents garbage collection of preset library code
- Listener continues firing after intended cleanup

**Current Status:**
- ❌ Not stored in `eventHandlers` object
- ❌ Not removed in cleanup function

---

### 2. **Shader HUD Timer Not Cleared on Dispose** (LOW-MEDIUM)

#### Location: `src/settings-ui.js:196, 225`

**Problem:** `shaderHudTimer` is a module-level variable that's cleared when a new timer is set but never on dispose:

```javascript
// Line 196
let shaderHudTimer = null;

// Line 224-227
clearTimeout(shaderHudTimer);
shaderHudTimer = setTimeout(() => {
  shaderHud.classList.remove('visible');
}, 1800);
```

**Impact:**
- Timer continues running after UI disposal
- Holds references to DOM elements
- Callback executes on destroyed elements

**Note:** This timer is relatively short-lived (1800ms) so impact is low, but it should still be cleared.

---

### 3. **Blob URL Not Revoked** (MEDIUM)

#### Location: `src/settings-ui.js:1776`

**Problem:** `URL.createObjectURL(blob)` creates object URLs that are never revoked:

```javascript
// Line 1776
a.href = URL.createObjectURL(blob);
```

**Impact:**
- Blob URLs remain in browser memory until page reload
- Each export creates a new blob URL that's never released
- Browser keeps blob data in memory indefinitely
- Can consume significant memory if user exports many times

**Fix Needed:**
```javascript
const url = URL.createObjectURL(blob);
a.href = url;
// After download completes or element is removed:
setTimeout(() => URL.revokeObjectURL(url), 100);
```

---

### 4. **Document Click Handler May Not Be Removed** (LOW)

#### Location: `src/settings-ui.js:1335-1344`

**Problem:** `handleOutside` click handler is added to document but only removed when clicked outside, not on dispose:

```javascript
// Line 1335-1344
const handleOutside = (e) => {
  if (!menu.contains(e.target)) {
    if (menu.parentNode) {
      menu.parentNode.removeChild(menu);
      document.removeEventListener('click', handleOutside, true);
    }
  }
};
document.addEventListener('click', handleOutside, true);
```

**Impact:**
- If user doesn't click outside (e.g., navigates away), listener remains
- Holds references to menu element and surrounding closures
- Listener continues firing on every click

**Likelihood:** Low - most users will click outside, triggering cleanup

---

### 5. **Toast Timer Not Cleared on Cleanup** (LOW)

#### Location: `src/toast.js:15, 81`

**Problem:** `toastTimer` is a module-level variable that's never cleared on app cleanup:

```javascript
// Line 15
let toastTimer = null;

// Line 81-84
toastTimer = setTimeout(() => {
  try { el.classList.remove('visible'); } catch(_) {}
}, ms);
```

**Impact:**
- Timer continues running after page unload
- Holds reference to toast element
- Very short-lived (max 5200ms) so minimal impact

**Note:** The cleanup function `clearTimeout(toastTimer)` is called when a new toast appears but not on app disposal.

---

### 6. **Start Audio Button Listener in index.html** (LOW)

#### Location: `index.html:647`

**Problem:** Event listener on start-audio-btn is never removed:

```javascript
// Line 647
btn.addEventListener('click', async () => {
  // ... unlock audio contexts
  btn.style.display = 'none';
});
```

**Impact:**
- Listener remains active after page unload
- Holds references to window.__reactiveCtxs array
- Only affects Safari/iOS users (where button is shown)

**Likelihood:** Low - button is hidden after first click and only exists on Safari/iOS

---

### 7. **PresetManager Listeners Not Cleaned Up** (MEDIUM)

#### Location: `src/preset-manager.js:238, 268-273`

**Problem:** The `_listeners` Set stores event listeners, but relies on callers to remove them:

```javascript
// Line 238
this._listeners = new Set();

// Line 268-273
on(event, handler) {
  if (typeof handler !== 'function') return () => {};
  const wrapped = { event, handler };
  this._listeners.add(wrapped);
  return () => this._listeners.delete(wrapped); // Returns detach function
}
```

**Impact:**
- If callers don't call the detach function, listeners leak
- Holds references to handler functions and their closures
- `PresetLibraryWindow` calls `on('*')` but only detaches when window closes
- If main window closes without popup closing, listener leaks

**Current Usage:**
```javascript
// preset-library-window.js:66
this.detach = this.manager.on('*', () => this.render());

// preset-library-window.js:67-69
this.win.addEventListener('beforeunload', () => {
  if (typeof this.detach === 'function') this.detach();
});
```

**Issue:** If main window closes while popup is open, the beforeunload on popup won't fire.

---

## Additional Patterns Found (Not Leaks)

### ✅ **lazy.js Module Cache** (SAFE)

**Location:** `src/lazy.js:19`

```javascript
const cache = new Map();
```

**Analysis:** This is **intentional caching**, not a leak:
- Caches loaded libraries (Aubio, Meyda, Essentia, etc.)
- Maximum ~6 entries (one per library)
- Never needs to be cleared (libraries should stay loaded)
- **Conclusion:** Not a memory leak ✅

---

### ✅ **stutterTimes Array** (SAFE)

**Location:** `src/scene.js:446, 1801, 1805`

```javascript
state.dispersion.stutterTimes.push(nowMs);
// ...
state.dispersion.stutterTimes = state.dispersion.stutterTimes.filter(t0 => t0 >= cutoff);
```

**Analysis:** Array is **self-cleaning**:
- Items are filtered every frame (line 1805)
- Only keeps items from last 200ms window
- Never grows beyond a few entries
- **Conclusion:** Not a memory leak ✅

---

## Summary Statistics

| Category | Count |
|----------|-------|
| **New Memory Leaks Found** | **7** |
| Event listeners not cleaned | 3 |
| Timers not cleared | 1 |
| Blob URLs not revoked | 1 |
| Event emitter listeners | 1 |
| Click handlers in closure | 1 |
| **Patterns Analyzed (Safe)** | 2 |
| **Total Issues** | **7 leaks** |

---

## Severity Assessment

| Leak | Severity | Frequency | Impact | Priority |
|------|----------|-----------|--------|----------|
| Blob URL not revoked | **MEDIUM** | Per export | Memory growth | **P1** |
| PresetManager listeners | **MEDIUM** | Rare | Closure leak | **P1** |
| Untracked 'L' key listener | **MEDIUM** | Always | Event leak | **P2** |
| Shader HUD timer | **LOW** | Frequent | Short-lived | **P3** |
| Document click handler | **LOW** | Rare | Conditional | **P3** |
| Toast timer | **LOW** | Frequent | Very short | **P4** |
| Start audio button | **LOW** | iOS/Safari | Rare case | **P4** |

---

## Recommended Fixes

### High Priority (P1)

**1. Fix Blob URL Leak:**
```javascript
// In settings-ui.js around line 1776
const url = URL.createObjectURL(blob);
a.href = url;
a.download = filename;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
// Clean up blob URL after use
setTimeout(() => URL.revokeObjectURL(url), 100);
```

**2. Add PresetManager.dispose() method:**
```javascript
dispose() {
  // Call all detach functions
  for (const wrapped of this._listeners) {
    // Notify listeners we're shutting down if needed
  }
  this._listeners.clear();
  this.sceneApi = null;
  this.audioEngine = null;
}
```

### Medium Priority (P2)

**3. Track 'L' key listener:**
```javascript
// In main.js
eventHandlers.presetLibraryKey = (event) => {
  if (event.defaultPrevented) return;
  // ... existing logic
};
window.addEventListener('keydown', eventHandlers.presetLibraryKey);

// In cleanup()
window.removeEventListener('keydown', eventHandlers.presetLibraryKey);
```

### Lower Priority (P3-P4)

**4. Clear shader HUD timer on dispose:**
```javascript
// In settings-ui dispose()
if (shaderHudTimer) {
  clearTimeout(shaderHudTimer);
  shaderHudTimer = null;
}
```

**5. Handle document click listener edge case:**
```javascript
// Store reference to handler for cleanup
let activeOutsideHandler = null;

// When adding:
activeOutsideHandler = handleOutside;
document.addEventListener('click', handleOutside, true);

// In dispose():
if (activeOutsideHandler) {
  document.removeEventListener('click', activeOutsideHandler, true);
  activeOutsideHandler = null;
}
```

---

## Testing Strategy

### Blob URL Leak Test:
1. Open settings
2. Export preset 100 times
3. Check browser's Blob URLs (chrome://blob-internals)
4. Should see URLs being revoked, not accumulating

### PresetManager Listener Test:
1. Open preset library popup
2. Close main window (don't close popup first)
3. Check memory profile
4. Listener should be cleaned up

### Event Listener Test:
1. Use Chrome DevTools → Memory → Heap Snapshot
2. Look for detached event listeners
3. After cleanup, should see zero detached listeners

---

## Impact Analysis

### Current State (After First Fix Round):
- ✅ Critical leaks fixed (AudioContext, animation loop, major listeners)
- ⚠️ **7 subtle leaks remain**
- 🔄 Application functional but has minor memory issues

### After Fixing Additional Leaks:
- ✅ All event listeners properly managed
- ✅ All timers cleared on disposal
- ✅ Blob URLs properly revoked
- ✅ Event emitters cleaned up
- ✅ Production-ready memory management

---

## Comparison: Before vs After All Fixes

| Metric | Original | After First Fix | After All Fixes |
|--------|----------|-----------------|-----------------|
| Untracked event listeners | 54 | 0 | **0** |
| Timers not cleared | Multiple | 0 | **0** |
| Blob URLs leaked | All | All | **0** |
| Event emitter leaks | Yes | Yes | **0** |
| Memory leak severity | 🔴 Critical | 🟡 Minor | 🟢 **None** |

---

## Conclusion

The initial fix addressed the **critical** memory leaks (AudioContext, animation loop, 54+ event listeners), making the application **stable** for production use.

These **7 additional leaks** are more subtle and have **lower impact**, but should still be fixed for optimal memory management:

**Must Fix (P1):**
- Blob URL leak (grows with exports)
- PresetManager listener leak (rare but significant)

**Should Fix (P2-P3):**
- Untracked 'L' key listener
- Shader HUD timer
- Document click handler edge case

**Nice to Fix (P4):**
- Toast timer
- Start audio button (iOS/Safari only)

**Recommendation:** Fix P1 issues immediately, P2-P3 in next iteration, P4 as time permits.

---

*Deep Analysis Report Generated: 2025-11-01*
*Codebase: reactive-show v0.1.0*
