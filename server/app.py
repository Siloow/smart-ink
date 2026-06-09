"""
Local Smart Ink render server — POST /render-v2 (contract + ink_layer).

Writes uploads to smartink-live/ for watch_dev.py, then headless Blender render.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

REPO_ROOT = Path(__file__).resolve().parent.parent
LIVE_DIR = Path(
    os.environ.get("SMARTINK_LIVE_DIR", REPO_ROOT / "smartink-live")
).expanduser()
RENDER_TIMEOUT_SEC = int(os.environ.get("SMARTINK_RENDER_TIMEOUT", "180"))

_MAC_BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")


def resolve_blender() -> str:
    """Subprocess cannot use shell aliases — resolve a real Blender binary."""
    if env := os.environ.get("BLENDER"):
        return env
    if _MAC_BLENDER.is_file():
        return str(_MAC_BLENDER)
    return "blender"


BLENDER = resolve_blender()

app = FastAPI(title="Smart Ink Local Render")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _scene_importer() -> Path:
    live_importer = LIVE_DIR / "sceneImporter.py"
    if live_importer.is_file():
        return live_importer
    return REPO_ROOT / "public" / "blender-scripts" / "sceneImporter.py"


def dump_to_live_dir(contract_bytes: bytes, ink_bytes: bytes) -> Path:
    LIVE_DIR.mkdir(parents=True, exist_ok=True)
    contract_path = LIVE_DIR / "contract.json"
    ink_path = LIVE_DIR / "ink.png"
    contract_path.write_bytes(contract_bytes)
    ink_path.write_bytes(ink_bytes)
    print(f"[render-server] wrote {contract_path} ({len(contract_bytes)} B)", file=sys.stderr)
    print(f"[render-server] wrote {ink_path} ({len(ink_bytes)} B)", file=sys.stderr)
    return contract_path


def run_blender_render(contract_path: Path) -> Path:
    importer = _scene_importer()
    if not importer.is_file():
        raise HTTPException(500, f"sceneImporter.py not found: {importer}")

    output_path = LIVE_DIR / "renders" / "output.png"
    cmd = [
        BLENDER,
        "-b",
        "-P",
        str(importer),
        "--",
        str(contract_path),
    ]
    print(f"[render-server] {' '.join(cmd)}", file=sys.stderr)
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=RENDER_TIMEOUT_SEC,
            cwd=str(LIVE_DIR),
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, f"Blender timed out after {RENDER_TIMEOUT_SEC}s") from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            500,
            f"Blender not found ({BLENDER}). Set BLENDER=/path/to/blender.",
        ) from exc

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "Blender failed").strip()
        print(f"[render-server] blender stderr:\n{proc.stderr}", file=sys.stderr)
        raise HTTPException(500, err[-2000:])

    if not output_path.is_file():
        raise HTTPException(500, f"Expected render output missing: {output_path}")

    return output_path


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"ok": True, "live_dir": str(LIVE_DIR)})


async def _read_shot_uploads(
    contract: UploadFile,
    ink_layer: UploadFile,
) -> tuple[bytes, bytes]:
    contract_bytes = await contract.read()
    ink_bytes = await ink_layer.read()
    if not contract_bytes:
        raise HTTPException(400, "Missing contract upload")
    if not ink_bytes:
        raise HTTPException(400, "Missing ink_layer upload")
    return contract_bytes, ink_bytes


@app.post("/sync-live")
async def sync_live(
    contract: UploadFile = File(...),
    ink_layer: UploadFile = File(...),
) -> JSONResponse:
    """Write contract + ink to smartink-live for watch_dev.py (no Cycles render)."""
    contract_bytes, ink_bytes = await _read_shot_uploads(contract, ink_layer)
    contract_path = dump_to_live_dir(contract_bytes, ink_bytes)
    print(f"[render-server] sync-live → {contract_path}", file=sys.stderr)
    return JSONResponse({"ok": True, "live_dir": str(LIVE_DIR)})


@app.post("/render-v2")
async def render_v2(
    contract: UploadFile = File(...),
    ink_layer: UploadFile = File(...),
) -> FileResponse:
    contract_bytes, ink_bytes = await _read_shot_uploads(contract, ink_layer)
    contract_path = dump_to_live_dir(contract_bytes, ink_bytes)
    output_path = run_blender_render(contract_path)
    return FileResponse(output_path, media_type="image/png", filename="render.png")
