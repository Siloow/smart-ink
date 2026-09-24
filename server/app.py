"""Smart Ink multipart render API with cancellable, isolated Blender processes."""
from __future__ import annotations

import asyncio
import base64
import anyio
import json
import math
import os
import re
import shutil
import signal
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.background import BackgroundTask
from server.measurement_fit import validate_fit

REPO_ROOT = Path(__file__).resolve().parent.parent
LIVE_DIR = Path(os.environ.get("SMARTINK_LIVE_DIR", REPO_ROOT / "smartink-live")).expanduser()
RENDER_TIMEOUT_SEC = max(1, min(1800, int(os.environ.get("SMARTINK_RENDER_TIMEOUT", "600"))))
MAX_CONCURRENT_RENDERS = max(1, min(4, int(os.environ.get("SMARTINK_MAX_CONCURRENT_RENDERS", "2"))))
MAX_CONTRACT_BYTES = 1024 * 1024
MAX_INK_BYTES = 32 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_777_216
MAX_OUTPUT_DIMENSION = 4096
BODY_ASSETS = {
    "body_full": ("body_full.blend", "body_male_realistic.glb"),
    "body_full_female": ("body_full_female.blend", "body_female_realistic.glb"),
}
BODY_SHAPE_KEYS = {"height", "build", "shoulders", "chest", "waist", "belly", "hips", "arms", "legs", "legLength", "head"}
BODY_POSE_BOUNDS = {
    "leftArmLift": (-10, 40), "rightArmLift": (-10, 40),
    "leftArmForward": (-10, 35), "rightArmForward": (-10, 35),
    "leftElbow": (0, 85), "rightElbow": (0, 85),
    "leftLegSpread": (-5, 15), "rightLegSpread": (-5, 15),
    "leftLegForward": (-15, 30), "rightLegForward": (-15, 30),
    "leftKnee": (0, 55), "rightKnee": (0, 55),
    "headTurn": (-35, 35), "headTilt": (-15, 15),
}
BODY_POSE_IDS = {"neutral", "relaxed", "arms_out", "arm_showcase", "flex", "step", "arm_extended", "custom"}
BODY_APPEARANCE_DEFAULTS = {
    "top": "none", "bottom": "none", "topColor": "#e8e3d9", "bottomColor": "#263449",
    "hairStyle": "none", "hairTone": "dark_brown",
}
BODY_APPEARANCE_OPTIONS = {
    "top": {"none", "tshirt"}, "bottom": {"none", "shorts", "trousers"},
    "hairStyle": {"none", "buzz", "short"},
    "hairTone": {"black", "dark_brown", "brown", "auburn", "blond", "grey"},
}
STUDIO_DEFAULTS = {"mode": "sweep", "color": "#d6cdc1", "shadow": 0.4, "showGuides": False}
BODY_REGIONS = {"head", "torso", "armLeft", "armRight", "legLeft", "legRight"}
_MAC_BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")


def resolve_blender() -> str:
    if configured := os.environ.get("BLENDER"):
        return configured
    return str(_MAC_BLENDER) if _MAC_BLENDER.is_file() else "blender"


BLENDER = resolve_blender()
app = FastAPI(title="Smart Ink Local Render")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3})(:\d+)?",
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)
_active_renders = 0
_live_lock = asyncio.Lock()


def _scene_importer() -> Path:
    live = LIVE_DIR / "sceneImporter.py"
    return live if live.is_file() else REPO_ROOT / "public" / "blender-scripts" / "sceneImporter.py"


def _has_body(body_id: str) -> bool:
    script_dir = _scene_importer().resolve().parent
    roots = (script_dir, script_dir.parent, script_dir.parent.parent / "public" / "models", script_dir.parent / "models")
    return any((root / name).is_file() for root in roots for name in BODY_ASSETS[body_id])


def readiness() -> dict:
    executable = shutil.which(BLENDER)
    checks = {
        "blender": bool(executable),
        "importer": _scene_importer().is_file(),
        "live_directory": LIVE_DIR.is_dir() and os.access(LIVE_DIR, os.W_OK),
        "body_assets": all(_has_body(body_id) for body_id in BODY_ASSETS),
    }
    missing = [name.replace("_", " ") for name, valid in checks.items() if not valid]
    ready = not missing
    return {
        "ok": True, "ready": ready, "checks": checks,
        "message": "Ready to render" if ready else "Render setup missing: " + ", ".join(missing),
        "live_dir": str(LIVE_DIR), "active_renders": _active_renders,
        "max_concurrent_renders": MAX_CONCURRENT_RENDERS,
        "timeout_seconds": RENDER_TIMEOUT_SEC, "cancellation_supported": True,
    }


@app.get("/health")
async def health() -> JSONResponse:
    # Setup readiness is separate from HTTP liveness; older clients retain ok.
    return JSONResponse(readiness())


def _invalid(message: str) -> None:
    raise HTTPException(422, message)


def _number(value, name: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high or not math.isfinite(value):
        _invalid(f"{name} must be a finite number between {low} and {high}")
    return value


def _vector(value, name: str) -> None:
    if not isinstance(value, list) or len(value) != 3:
        _invalid(f"{name} must contain three coordinates")
    for coordinate in value:
        _number(coordinate, name, -100000, 100000)


def validate_contract(data: bytes) -> dict:
    try:
        contract = json.loads(data, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("non-finite number")))
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise HTTPException(422, "The contract must be valid JSON with finite numbers") from exc
    if not isinstance(contract, dict):
        _invalid("The contract must be a JSON object")
    if type(contract.get("schemaVersion")) is not int or contract["schemaVersion"] != 1:
        _invalid("Unsupported schemaVersion; expected 1")
    for name, allowed in (
        ("bodyMeshId", BODY_ASSETS),
        ("skinToneId", {"tone_01", "tone_03", "tone_05", "tone_07"}),
        ("poseId", BODY_POSE_IDS),
        ("lookId", {"studio_softbox", "window_daylight", "dramatic_rim"}),
    ):
        if not isinstance(contract.get(name), str) or contract[name] not in allowed:
            _invalid(f"Unknown {name}")
    if contract.get("inkTextureUrl") != "ink.png":
        _invalid("inkTextureUrl must be ink.png, supplied by the ink_layer upload")
    for name, allowed in (
        ("hairTone", {"black", "dark_brown", "brown", "auburn", "blond", "grey"}),
        ("bodyHair", {"none", "vellus", "light", "medium", "heavy"}),
        ("renderStyle", {"cinematic", "preview"}),
    ):
        if name in contract and (not isinstance(contract[name], str) or contract[name] not in allowed):
            _invalid(f"Unknown {name}")
    if "showEyes" in contract and type(contract["showEyes"]) is not bool:
        _invalid("showEyes must be true or false")
    if "eyeColor" in contract and (not isinstance(contract["eyeColor"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", contract["eyeColor"])):
        _invalid("eyeColor must be a six-digit hex color")
    output = contract.get("output")
    if not isinstance(output, dict) or output.get("qualityTier") not in ("preview", "final"):
        _invalid("output.qualityTier must be preview or final")
    for name in ("width", "height"):
        value = output.get(name)
        if type(value) is not int or not 1 <= value <= MAX_OUTPUT_DIMENSION:
            _invalid(f"output.{name} must be an integer between 1 and {MAX_OUTPUT_DIMENSION}")
    if "samples" in output:
        if type(output["samples"]) is not int:
            _invalid("output.samples must be an integer")
        _number(output["samples"], "output.samples", 64, 1024)
    camera = contract.get("camera")
    if not isinstance(camera, dict):
        _invalid("camera is required")
    _vector(camera.get("position"), "camera.position")
    _vector(camera.get("target"), "camera.target")
    if camera["position"] == camera["target"]:
        _invalid("Camera position and target must differ")
    _number(camera.get("fov"), "camera.fov", 1, 179)
    _number(camera.get("aspect"), "camera.aspect", 0.01, 100)
    if "preserveFraming" in camera and type(camera["preserveFraming"]) is not bool:
        _invalid("camera.preserveFraming must be true or false")
    if "depthOfField" in camera and type(camera["depthOfField"]) is not bool:
        _invalid("camera.depthOfField must be true or false")
    for name, bounds in {"lensMm": (1, 1000), "aperture": (0.1, 128), "focusDistance": (0.001, 100000)}.items():
        if name in camera:
            _number(camera[name], f"camera.{name}", *bounds)
    if contract.get("bodyRegion") is not None and (not isinstance(contract["bodyRegion"], str) or contract["bodyRegion"] not in BODY_REGIONS):
        _invalid("Unknown bodyRegion")
    if "studio" in contract:
        studio = contract["studio"]
        if not isinstance(studio, dict) or any(key not in STUDIO_DEFAULTS and key != 'gradient' for key in studio):
            _invalid("Invalid studio settings")
        studio = {**STUDIO_DEFAULTS, **studio}
        if not isinstance(studio["mode"], str) or studio["mode"] not in ("plain", "sweep"):
            _invalid("Unknown studio mode")
        if not isinstance(studio["color"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", studio["color"]):
            _invalid("studio.color must be a six-digit hex color")
        _number(studio["shadow"], "studio.shadow", 0, 1)
        if type(studio["showGuides"]) is not bool:
            _invalid("studio.showGuides must be true or false")
        if 'gradient' in studio:
            stops = studio['gradient']
            if not isinstance(stops, list) or not 2 <= len(stops) <= 8 or any(not isinstance(c, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', c) for c in stops):
                _invalid('Invalid studio gradient')
        contract["studio"] = {**studio, "color": studio["color"].lower()}
    if "bodyAppearance" in contract:
        appearance = contract["bodyAppearance"]
        if not isinstance(appearance, dict) or any(key not in BODY_APPEARANCE_DEFAULTS for key in appearance):
            _invalid("Invalid bodyAppearance")
        for key, value in appearance.items():
            if key in BODY_APPEARANCE_OPTIONS:
                if not isinstance(value, str) or value not in BODY_APPEARANCE_OPTIONS[key]:
                    _invalid(f"Unknown bodyAppearance.{key}")
            elif not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
                _invalid(f"bodyAppearance.{key} must be a six-digit hex color")
        contract["bodyAppearance"] = {**BODY_APPEARANCE_DEFAULTS, **appearance}
        for key in ("topColor", "bottomColor"):
            contract["bodyAppearance"][key] = contract["bodyAppearance"][key].lower()
    shape = contract.get("bodyShape", {})
    if not isinstance(shape, dict) or any(key not in BODY_SHAPE_KEYS for key in shape):
        _invalid("Invalid bodyShape")
    for key, value in shape.items():
        _number(value, f"bodyShape.{key}", -1, 1)
    if "bodyFit" in contract:
        try:
            validate_fit(contract["bodyFit"], contract["bodyMeshId"])
        except ValueError as exc:
            _invalid(str(exc))
        if any(value != 0 for value in shape.values()):
            _invalid("bodyFit replaces bodyShape; they cannot be combined")
    if "bodyPose" in contract:
        pose = contract["bodyPose"]
        if not isinstance(pose, dict) or any(key not in BODY_POSE_BOUNDS for key in pose):
            _invalid("Invalid bodyPose")
        for key, value in pose.items():
            _number(value, f"bodyPose.{key}", *BODY_POSE_BOUNDS[key])
        for side in ("left", "right"):
            if pose.get(side + "ArmForward", 0) > 35 + min(0, pose.get(side + "ArmLift", 0)):
                _invalid(f"{side} arm forward angle is too large for its lowered shoulder")
            if pose.get(side + "Elbow", 0) + max(pose.get(side + "ArmForward", 0), 0) > 100:
                _invalid(f"{side} arm forward and elbow angles must total at most 100 degrees")
    elif contract["poseId"] == "custom":
        _invalid("Custom pose requires bodyPose angles")
    lighting = contract.get("lighting")
    if lighting is not None:
        if not isinstance(lighting, dict) or not isinstance(lighting.get("lights"), list) or len(lighting["lights"]) > 16:
            _invalid("lighting.lights must be an array of at most 16 lights")
        _number(lighting.get("intensityScale", 1), "lighting.intensityScale", 0, 1000)
        for light in lighting["lights"]:
            if not isinstance(light, dict) or light.get("type") not in ("ambient", "directional", "spot", "point", "area"):
                _invalid("Unknown light type")
            _vector(light.get("position"), "light.position")
            if "target" in light:
                _vector(light["target"], "light.target")
            _number(light.get("intensity"), "light.intensity", 0, 10000)
            for key in ("enabled", "castShadow"):
                if key in light and type(light[key]) is not bool:
                    _invalid(f"light.{key} must be true or false")
            if "name" in light and (not isinstance(light["name"], str) or len(light["name"]) > 80 or any(ord(c) < 32 for c in light["name"])):
                _invalid("light.name must be a short single-line name")
            if "softness" in light:
                _number(light["softness"], "light.softness", 0, 1)
            if not isinstance(light.get("color"), str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", light["color"]):
                _invalid("Light color must be a six-digit hex color")
            for key, bounds in {"angle": (0, math.pi), "penumbra": (0, 1)}.items():
                if key in light:
                    _number(light[key], f"light.{key}", *bounds)
            if "blenderAreaSize" in light:
                sizes = light["blenderAreaSize"]
                if not isinstance(sizes, list) or len(sizes) != 2:
                    _invalid("light.blenderAreaSize must contain width and height")
                for size in sizes:
                    _number(size, "light.blenderAreaSize", 0.001, 1000)
    return contract


def validate_png(data: bytes) -> tuple[int, int]:
    """Check PNG chunks, CRCs and bounded decompression without extra packages.

    Browser canvas exports are non-interlaced PNGs. Validating the actual image
    stream prevents malformed uploads from consuming a Blender process.
    """
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        _invalid("ink_layer must be a PNG image")
    offset, width, height, expected = 8, 0, 0, 0
    compressed = bytearray()
    ended = False
    palette = False
    data_finished = False
    while offset + 12 <= len(data):
        length = struct.unpack_from(">I", data, offset)[0]
        kind = data[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(data):
            _invalid("PNG is truncated")
        payload = data[offset + 8:offset + 8 + length]
        crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            _invalid("PNG checksum is invalid")
        if offset == 8 and kind != b"IHDR":
            _invalid("PNG is missing its image header")
        if kind == b"IHDR":
            if width or length != 13:
                _invalid("Invalid PNG image header")
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if not width or not height or width > 8192 or height > 8192 or width * height > MAX_IMAGE_PIXELS:
                _invalid("PNG dimensions exceed the 16-megapixel ink limit")
            channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}.get(color)
            valid_depths = {0: (1, 2, 4, 8, 16), 2: (8, 16), 3: (1, 2, 4, 8), 4: (8, 16), 6: (8, 16)}
            if channels is None or depth not in valid_depths[color] or compression or filtering or interlace:
                _invalid("Use a standard non-interlaced PNG ink layer")
            expected = height * (1 + (width * channels * depth + 7) // 8)
        elif kind == b"PLTE":
            if palette or compressed or not length or length % 3 or length > 768:
                _invalid("Invalid PNG palette")
            palette = True
        elif kind == b"IDAT":
            if data_finished or (color == 3 and not palette):
                _invalid("Invalid PNG image data order")
            compressed.extend(payload)
        elif kind == b"IEND":
            if length:
                _invalid("Invalid PNG end marker")
            ended = True
            offset = end
            break
        elif not kind[0] & 32:
            _invalid("Unsupported PNG critical chunk")
        if compressed and kind != b"IDAT":
            data_finished = True
        offset = end
    if not ended or offset != len(data) or not compressed:
        _invalid("Incomplete PNG image")
    try:
        decoder = zlib.decompressobj()
        decoded = decoder.decompress(compressed, expected + 1)
        if len(decoded) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
            _invalid("PNG image data has the wrong size")
        row_length = expected // height
        if any(decoded[row] > 4 for row in range(0, expected, row_length)):
            _invalid("PNG contains an invalid scanline filter")
    except zlib.error as exc:
        raise HTTPException(422, "PNG image data is corrupt") from exc
    return width, height


async def _read_shot_uploads(contract: UploadFile, ink_layer: UploadFile) -> tuple[bytes, bytes, dict]:
    contract_bytes = await contract.read(MAX_CONTRACT_BYTES + 1)
    ink_bytes = await ink_layer.read(MAX_INK_BYTES + 1)
    if len(contract_bytes) > MAX_CONTRACT_BYTES or len(ink_bytes) > MAX_INK_BYTES:
        raise HTTPException(413, "Shot upload is too large (contract 1 MB, ink PNG 32 MB maximum)")
    if not contract_bytes or not ink_bytes:
        raise HTTPException(400, "Both contract and ink_layer uploads are required")
    # Decompression/JSON work stays off the event loop so health remains live.
    parsed = await asyncio.to_thread(validate_contract, contract_bytes)
    await asyncio.to_thread(validate_png, ink_bytes)
    return contract_bytes, ink_bytes, parsed


def dump_to_dir(target: Path, contract_bytes: bytes, ink_bytes: bytes) -> Path:
    target.mkdir(parents=True, exist_ok=True)
    (target / "ink.png").write_bytes(ink_bytes)
    contract_path = target / "contract.json"
    contract_path.write_bytes(contract_bytes)
    return contract_path


async def _stop_process(process: asyncio.subprocess.Process) -> None:
    if process.returncode is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(process.wait(), 3)
    except asyncio.TimeoutError:
        pass
    # Kill any remaining members as well: a subprocess can outlive Blender's
    # parent process during cancellation. Each render has its own process group.
    if os.name == "posix" or process.returncode is None:
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            pass
    await process.wait()


class BlenderProgress:
    """Tail bounded log chunks; accept only known phases and a fixed preview path."""
    def __init__(self, directory, emit):
        self.directory, self.emit = directory, emit
        self.offset, self.pending, self.phase, self.last = 0, "", "preparing", None

    def read(self, path):
        with path.open("rb") as log:
            log.seek(self.offset)
            chunk = log.read(256 * 1024)
            self.offset = log.tell()
        lines = (self.pending + chunk.decode("utf-8", errors="replace")).replace("\r", "\n").split("\n")
        self.pending = lines.pop()[-4096:]
        for line in lines:
            if "SMARTINK_PHASE preview" in line or "SMARTINK_PHASE final" in line:
                self.phase = "preview" if "SMARTINK_PHASE preview" in line else "final"
                self.last = None
                self.emit({"type": "progress", "phase": self.phase})
            elif "SMARTINK_PREVIEW_READY" in line:
                preview = self.directory / "renders" / "preview.png"
                if preview.is_file() and preview.stat().st_size <= 8 * 1024 * 1024:
                    data = preview.read_bytes()
                    validate_png(data)
                    self.emit({"type": "preview", "image": base64.b64encode(data).decode("ascii")})
            elif self.phase in {"preview", "final"}:
                match = re.search(r"(?:Sample|Rendered)\s+(\d+)\s*/\s*(\d+)", line, re.I)
                if match:
                    sample, total = map(int, match.groups())
                    if total > 0 and 0 <= sample <= total and (sample, total) != self.last:
                        self.last = (sample, total)
                        self.emit({"type": "progress", "phase": self.phase, "sample": sample, "total": total})


async def stream_render(work_dir, contract_bytes, ink_bytes, request):
    global _active_renders
    events = asyncio.Queue()
    async def produce():
        try:
            path = await asyncio.to_thread(dump_to_dir, work_dir, contract_bytes, ink_bytes)
            events.put_nowait({"type": "progress", "phase": "preparing"})
            output = await run_blender_render(path, request, events.put_nowait)
            image = await asyncio.to_thread(output.read_bytes)
            events.put_nowait({"type": "final", "image": base64.b64encode(image).decode("ascii")})
        except Exception as exc:
            events.put_nowait({"type": "error", "message": exc.detail if isinstance(exc, HTTPException) else "The render could not finish. Please try again."})
        finally:
            events.put_nowait(None)
    worker = asyncio.create_task(produce())
    try:
        while True:
            try:
                event = await asyncio.wait_for(events.get(), 10)
            except asyncio.TimeoutError:
                yield "\n"  # Keep proxies alive during scene preparation.
                continue
            if event is None:
                break
            yield json.dumps(event, separators=(",", ":")) + "\n"
    finally:
        # Starlette cancels the generator on disconnect. Shield cleanup so the
        # process stops before its slot and temporary files are released.
        with anyio.CancelScope(shield=True):
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass
            finally:
                _active_renders -= 1
                await asyncio.to_thread(shutil.rmtree, work_dir, True)


async def run_blender_render(contract_path: Path, request: Request, emit=None) -> Path:
    output_path = contract_path.parent / "renders" / "output.png"
    command = [BLENDER, "-b", "-P", str(_scene_importer()), "--", str(contract_path)]
    if emit:
        # Blender 5.2 hides sample status at the default log level.
        command[1:1] = ["--log", "render", "--log-level", "debug"]
        command.append("--progressive")
    log_path = contract_path.parent / "blender.log"
    progress = BlenderProgress(contract_path.parent, emit) if emit else None
    process = None
    try:
        # A file avoids buffering unbounded Blender output in RAM or blocking
        # on a full stdout pipe. Only a short tail is exposed on failure.
        with log_path.open("wb") as log:
            process = await asyncio.create_subprocess_exec(
                *command, stdout=log, stderr=log, cwd=str(LIVE_DIR),
                start_new_session=os.name == "posix",
            )
            started = time.monotonic()
            while process.returncode is None:
                if progress:
                    progress.read(log_path)
                if not emit and await request.is_disconnected():
                    raise HTTPException(499, "Render cancelled")
                if time.monotonic() - started >= RENDER_TIMEOUT_SEC:
                    raise HTTPException(504, f"Blender timed out after {RENDER_TIMEOUT_SEC}s")
                try:
                    await asyncio.wait_for(process.wait(), 0.2)
                except asyncio.TimeoutError:
                    pass
        if progress:
            progress.read(log_path)
        if process.returncode != 0:
            with log_path.open("rb") as log:
                log.seek(max(0, log_path.stat().st_size - 2000))
                tail = log.read().decode("utf-8", errors="replace").strip()
            print(f"[render-server] Blender failed: {tail}", file=sys.stderr)
            raise HTTPException(500, "Blender could not finish this render. Please try again; details are in the render server log.")
        if not output_path.is_file():
            raise HTTPException(500, "Blender finished without producing a PNG")
        def validate_output():
            if output_path.stat().st_size > 128 * 1024 * 1024:
                raise HTTPException(500, "Blender produced an unexpectedly large image")
            try:
                validate_png(output_path.read_bytes())
            except HTTPException as exc:
                raise HTTPException(500, "Blender produced an invalid PNG image") from exc
        await asyncio.to_thread(validate_output)
        return output_path
    except FileNotFoundError as exc:
        raise HTTPException(503, "Blender could not start. Check the BLENDER path and render setup.") from exc
    finally:
        if process is not None and process.returncode is None:
            await asyncio.shield(_stop_process(process))


@app.post("/sync-live")
async def sync_live(contract: UploadFile = File(...), ink_layer: UploadFile = File(...)) -> JSONResponse:
    contract_bytes, ink_bytes, _ = await _read_shot_uploads(contract, ink_layer)
    # The watcher observes contract mtime. Replace ink first, contract last.
    async with _live_lock:
        def write_live():
            LIVE_DIR.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryDirectory(prefix=".shot-", dir=LIVE_DIR) as temporary:
                shot = dump_to_dir(Path(temporary), contract_bytes, ink_bytes)
                os.replace(shot.parent / "ink.png", LIVE_DIR / "ink.png")
                os.replace(shot, LIVE_DIR / "contract.json")
        await asyncio.to_thread(write_live)
    return JSONResponse({"ok": True, "live_dir": str(LIVE_DIR)})


@app.post("/render-v2")
async def render_v2(request: Request, contract: UploadFile = File(...), ink_layer: UploadFile = File(...)):
    global _active_renders
    contract_bytes, ink_bytes, parsed = await _read_shot_uploads(contract, ink_layer)
    state = readiness()
    if not state["checks"]["blender"] or not state["checks"]["importer"] or not state["checks"]["live_directory"] or not _has_body(parsed["bodyMeshId"]):
        raise HTTPException(503, state["message"] if not state["ready"] else "The selected body asset is unavailable")
    # Reject excess jobs immediately; each accepted render owns its process and
    # files. No hidden queue that keeps running after its browser disappears.
    if _active_renders >= MAX_CONCURRENT_RENDERS:
        raise HTTPException(429, "The render server is busy. Wait for an active render or cancel it and try again.")
    work_dir = Path(tempfile.mkdtemp(prefix="smartink-render-"))
    _active_renders += 1
    if "application/x-ndjson" in request.headers.get("accept", ""):
        return StreamingResponse(stream_render(work_dir, contract_bytes, ink_bytes, request),
                                 media_type="application/x-ndjson",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})
    try:
        contract_path = await asyncio.to_thread(dump_to_dir, work_dir, contract_bytes, ink_bytes)
        output_path = await run_blender_render(contract_path, request)
    except BaseException:
        await asyncio.to_thread(shutil.rmtree, work_dir, True)
        raise
    finally:
        _active_renders -= 1
    return FileResponse(output_path, media_type="image/png", filename="render.png",
                        background=BackgroundTask(shutil.rmtree, work_dir, ignore_errors=True))
