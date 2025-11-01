# Preset Library Overview

This document explains the live preset system introduced for drum & bass shows.  It is written for both operators (VJs) and developers onboarding to the codebase.

## High-Level Flow

1. `PresetManager` (`src/preset-manager.js`) captures the entire show state (audio, mapping, dispersion, visuals, etc.) using `capturePresetSnapshot`.
2. Presets persist to `localStorage` under the `cosmicPresetLibrary.v1` key.  Writes are atomic: we stage state in `*.tmp`, back up the previous snapshot to `*.bak`, then promote to `*.v1`.
3. The UI (`src/preset-library-window.js`) is launched with the `L` key.  It runs in a dedicated popup so the primary visuals never get obscured.
4. Operators can load, save, duplicate, rename, revert, favourite and search presets.  Unsafe operations confirm before acting.
5. Opacity and colour parameters are locked by default.  They only react to audio if a user explicitly enables modulation from the library UI.
6. Every load records recents and keeps a rollback snapshot so we can undo instantly if something misbehaves live.

## Files & Responsibilities

| File | Role |
| --- | --- |
| `src/preset-manager.js` | Core preset domain logic + persistence. Implements CRUD, duplication, rename, revert, version history, favourites, recents, rollback, modulation/lock API, logging and atomic writes. |
| `src/preset-library-window.js` | Popup control surface opened with `L`. Provides search, tag filters, fast actions, compare, history restore and modulation toggles. |
| `src/preset-io.js` | Pure helpers to capture/apply a snapshot to `sceneApi` and `audioEngine`. Shared between the manager and the settings UI. |
| `src/settings-ui.js` | “Presets” tab now delegates to `PresetManager` (quick load/save) and links to the popup. |
| `src/main.js` | Wires the new manager, registers the `L` keyboard shortcut and exposes a shared library instance. |

## PresetManager API Reference

```text
PresetManager.load(idOrName, { silent })
PresetManager.save(idOrName, { note, tags, snapshot })
PresetManager.saveAs(newName, { tags, snapshot, favorite })
PresetManager.create(opts)
PresetManager.duplicate(idOrName, newName?)
PresetManager.rename(idOrName, newName)
PresetManager.delete(idOrName)
PresetManager.revert(idOrName?)
PresetManager.getHistory(idOrName?)
PresetManager.restoreVersion(idOrName?, versionId)
PresetManager.setFavorite(idOrName, boolean)
PresetManager.getRecent(limit)
PresetManager.list(filter?, tags?)
PresetManager.enableAudioModulation(paramPath, boolean)
PresetManager.isAudioModulationEnabled(paramPath)
PresetManager.lockParam(paramPath)
PresetManager.unlockParam(paramPath)
PresetManager.isParamLocked(paramPath)
PresetManager.rollback()
PresetManager.on(event, handler)
```

### Notes

- `paramPath` strings use dot notation, e.g. `visuals.dispersion.opacityBase`.
- The manager is cautious about show safety: every load grabs the previous live snapshot so `rollback()` is instant and does not drop frames.
- All operations log to the console with the `[PresetManager]` prefix to aid debugging mid-show.

## Persistence & Safety

- **Atomic writes**: `cosmicPresetLibrary.v1.tmp` (staged) → promote to `cosmicPresetLibrary.v1` → archive previous to `cosmicPresetLibrary.v1.bak`.
- **Backups**: if the primary key fails to parse, we fall back to `.tmp` or `.bak` automatically on boot.
- **Recents/Favourites**: stored alongside preset records so the popup can filter quickly without re-computing metadata.
- **Version history**: every save prepends a version entry (`savedAt`, `note`, snapshot clone) capped at 15 entries per preset.
- **Rollback**: before loading a new preset we capture the live state.  `PresetManager.rollback()` reapplies it silently.

## Audio Modulation Guards

- At boot we automatically lock dispersion opacity and tint parameters (`opacityBase`, `opacityTrebleGain`, `opacityMin`, `opacityMax`, `opacityLerp`, `tintHue`, `tintSat`, `tintMix*`).
- Locks override incoming presets so those values stay fixed unless an operator explicitly enables modulation.
- The popup exposes checkboxes for “Opacity modulation” and “Color modulation” which call `PresetManager.enableAudioModulation`.  Enabling removes the lock; disabling (re)captures the live default and re-locks it.

## Operator Workflow (Show Night)

1. **Open the library**: press `L`.  The popup appears on a secondary window – the main canvas remains unobstructed.
2. **Load quickly**: use recents/favourites buttons or double-click in the preset list.  Switching is instant (no frame drop) and the previous state is available in the rollback stack.
3. **Quick compare**: toggle the button in the toolbar to A/B the current preset with the selected one without committing.
4. **Save safely**: `Save` confirms before overwriting.  `Save As…` always creates a new preset entry with a fresh version history.
5. **Version recovery**: use the history list in the detail panel to restore any earlier snapshot if experimentation goes wrong.
6. **Emergency fallback**: hit `Rollback` (popup) or the button in the settings tab to instantly return to the last active preset.

## Developer Tips

- `PresetManager` fires `'*'` events for every mutation.  The settings UI listens when the Presets tab is visible to refresh without manually re-querying state.
- New presets should live entirely in code-free JSON.  Use `PresetManager.exportState()` to produce a human readable backup with comments handled externally.
- DnB defaults live in `DEFAULT_PRESETS` inside the manager.  They emphasise bass‑reaction, geometry modulation and camera motion while leaving colour/opacity untouched.
- For custom automation you can reference the shared instance (`window.__presetManager`) in the browser console.

## Troubleshooting

- **Popup blocked**: browsers may block `window.open`.  Allow popups for the host to use the library or call `openPresetLibrary()` from a trusted gesture.
- **Storage quota**: if saving fails, check browser devtools for quota errors.  The manager logs `PresetManager persist failed` with error details.
- **Corrupt state**: clear `cosmicPresetLibrary.v1`/`.tmp`/`.bak` from devtools Application Storage to reset.  Factory resets via `?factory` query param also wipe these keys.



