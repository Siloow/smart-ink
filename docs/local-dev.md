# Local development — what to start

Quick reference for running the browser app, Blender live preview, and the local render server.

## Prerequisites

| Tool | Check |
|------|--------|
| Node.js 18+ | `node -v` |
| npm | `npm -v` |
| Blender 4.x | `blender --version` |
| Python 3 | `python3 -V` (render server only) |

On macOS, Blender is often a shell alias. The render server auto-detects `/Applications/Blender.app/Contents/MacOS/Blender` if `blender` is not on `PATH`.

---

## One-time setup

From the repo root:

```bash
npm install
npm run setup-live    # symlinks ~/smartink-live → ./smartink-live
```

`setup-live` is also run automatically when you start the render server.

---

## Full loop (browser + sync + Blender GUI)

Use **three terminals**. This is the usual workflow when tuning skin materials, lighting, or tattoos.

### Terminal 1 — browser app

```bash
npm run dev
```

Open **http://localhost:5173**

- Pick a **skin tone** in the right Inspector panel (swatches).
- Place a tattoo, adjust camera / look as needed.

### Terminal 2 — local render server

```bash
npm run render-server
```

- API: **http://127.0.0.1:8000**
- In dev, Vite proxies `/health`, `/sync-live`, and `/render-v2` to port 8000 (no `.env` needed).
- Export modal should show **Render server: local — online** (green dot).

First run creates `server/.venv` and installs Python deps.

### Terminal 3 — Blender live watcher

```bash
cd smartink-live
blender --python watch_dev.py
```

Leave Blender open. The viewport rebuilds when `contract.json` or `ink.png` changes.

### In the app

1. **Export** → **Sync to Blender** — writes `smartink-live/contract.json` + `ink.png`.
2. Blender console should print:
   ```
   [smartink] Rebuilding from .../contract.json …
   Loaded skin material 'skin_medium' from .../assets/skins.blend
   [smartink] Scene updated.
   ```
3. Or click **Render with Blender** for a headless Cycles PNG (no Blender GUI needed).

---

## Smaller workflows

### Browser preview only

```bash
npm run dev
```

Skin tone swatches update the Three.js preview. No Blender required.

### Headless render from an existing contract

```bash
./tools/render-local.sh smartink-live/contract.json
```

Opens `smartink-live/renders/output.png` when done (macOS `open`).

Or directly:

```bash
blender -b -P smartink-live/sceneImporter.py -- smartink-live/contract.json
```

### Test with a fixture (no app)

```bash
cp tools/fixtures/dramatic_uv.json smartink-live/contract.json
./tools/render-local.sh smartink-live/contract.json
```

Fixture uses `"skinToneId": "tone_03"` → `skin_medium` in `assets/skins.blend`.

### Rebuild skin materials in `skins.blend`

After editing the generator script or to reset all four tones:

```bash
blender -b smartink-live/assets/skins.blend -P smartink-live/assets/build_skin_materials.py
```

---

## Verification checklist

Run through this when you want to confirm everything works end-to-end.

| Step | Command / action | Expect |
|------|------------------|--------|
| 1 | `npm run typecheck` | No errors |
| 2 | `npm run build` | Build succeeds |
| 3 | `npm run dev` | App loads at :5173 |
| 4 | Change skin tone swatch | Body color updates in viewport |
| 5 | `curl -s http://127.0.0.1:8000/health` | `{"ok":true,"live_dir":"..."}` |
| 6 | Sync to Blender (with watcher running) | Scene rebuilds in Blender GUI |
| 7 | `./tools/render-local.sh smartink-live/contract.json` | `Loaded skin material 'skin_…'` + `output.png` |
| 8 | Switch skin tone → sync again | Different material / color in Blender |

---

## npm scripts

| Script | What it does |
|--------|----------------|
| `npm run dev` | Vite dev server (:5173) |
| `npm run render-server` | FastAPI on :8000 + Blender render/sync |
| `npm run setup-live` | `~/smartink-live` → `./smartink-live` symlink |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint |
| `npm run preview` | Preview production build |

---

## Key paths

| Path | Purpose |
|------|---------|
| `smartink-live/sceneImporter.py` | Blender scene builder (GUI + headless) |
| `smartink-live/watch_dev.py` | Live contract watcher |
| `smartink-live/assets/skins.blend` | Photoreal skin materials |
| `smartink-live/contract.json` | Current shot (written by sync/render) |
| `smartink-live/ink.png` | Baked tattoo layer |
| `smartink-live/renders/output.png` | Last Cycles render |
| `src/render/registry.ts` | Skin tones, looks, body meshes (browser + contract) |

---

## Troubleshooting

**Render server offline in the app**

- Start `npm run render-server` in another terminal.
- Check: `curl http://127.0.0.1:8000/health`

**Procedural tan skin instead of `skins.blend` material**

- Console will say `skins.blend not found` or list available material names.
- Ensure `smartink-live/assets/skins.blend` exists and contains `skin_medium` (etc.).
- Regenerate materials: `blender -b smartink-live/assets/skins.blend -P smartink-live/assets/build_skin_materials.py`

**Blender watcher does nothing**

- Confirm `contract.json` and `ink.png` are in the same folder `watch_dev.py watches (default: `smartink-live/`).
- Run watcher from `smartink-live/`: `cd smartink-live && blender --python watch_dev.py`

**`blender: command not found` in render server**

```bash
export BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
npm run render-server
```

**Skin tone not in Blender output**

- Contract must include `"skinToneId": "tone_03"` (or `tone_01` / `tone_05` / `tone_07`).
- Re-sync after changing the swatch in the browser.
