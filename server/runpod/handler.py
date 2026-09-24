"""RunPod queue worker. Run from the repository root: python -m server.runpod.handler."""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import re
import struct
from urllib.parse import urlsplit

import aiohttp
import tempfile
import time
from pathlib import Path

from fastapi import HTTPException
from server import app as renderer

# Leave headroom for base64 and JSON within RunPod's request/result limits.
MAX_INK_BYTES = 6 * 1024 * 1024
MAX_RESULT_BYTES = 5 * 1024 * 1024  # Legacy inline results only.
MAX_STORED_BYTES = 50 * 1024 * 1024
MAX_PREVIEW_BYTES = 512 * 1024
MAX_INLINE_BYTES = 512 * 1024  # RunPod limits each streamed message to 1 MB.


def validate_input(job):
    data = job.get("input") if isinstance(job, dict) else None
    if not isinstance(data, dict) or not isinstance(data.get("contract"), dict):
        raise ValueError("input.contract must be a scene contract object")
    try:
        raw = json.dumps(data["contract"], allow_nan=False).encode()
    except (ValueError, TypeError, RecursionError) as exc:
        raise ValueError("Invalid scene contract") from exc
    if len(raw) > renderer.MAX_CONTRACT_BYTES:
        raise ValueError("Scene contract is too large")
    try:
        contract = renderer.validate_contract(raw)
        ink = data.get("ink_base64")
        if not isinstance(ink, str) or len(ink) > 4 * ((MAX_INK_BYTES + 2) // 3):
            raise ValueError("ink_base64 must be a PNG of at most 6 MiB")
        ink = base64.b64decode(ink, validate=True)
        if len(ink) > MAX_INK_BYTES:
            raise ValueError("Ink texture is too large")
        renderer.validate_png(ink)
    except HTTPException as exc:
        raise ValueError(exc.detail) from exc
    except (binascii.Error, UnicodeError) as exc:
        raise ValueError("ink_base64 must contain valid base64") from exc
    return json.dumps(contract, allow_nan=False).encode(), ink


def upload_destination(job):
    destination = job["input"].get("result_upload")
    if destination is None:
        return None
    if not isinstance(destination, dict):
        raise ValueError("Invalid image storage destination")
    url, path = destination.get("url"), destination.get("path")
    if not isinstance(url, str) or not isinstance(path, str):
        raise ValueError("Invalid image storage destination")
    parsed = urlsplit(url)
    uuid = r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    if (parsed.scheme != "https" or not re.fullmatch(r"[a-z0-9]+\.supabase\.co", parsed.netloc)
            or not re.fullmatch(uuid + "/" + uuid + r"\.png", path)
            or parsed.path != "/storage/v1/object/upload/sign/renders/" + path
            or not parsed.query.startswith("token=") or parsed.fragment):
        raise ValueError("Invalid image storage destination")
    return {"url": url, "path": path}


async def upload_result(output, destination):
    size = output.stat().st_size
    if not 45 <= size <= MAX_STORED_BYTES:
        raise ValueError("Rendered PNG exceeds the 50 MiB storage limit")
    with output.open("rb") as file:
        header = file.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n" or header[12:16] != b"IHDR":
        raise ValueError("Invalid rendered PNG")
    width, height = struct.unpack(">II", header[16:24])
    # Retries are safe: this capability only overwrites this job's one object.
    # No redirects, and never log an exception containing the signed URL.
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=25)) as client:
        for attempt in range(2):
            try:
                with output.open("rb") as file:
                    async with client.put(destination["url"], data=file,
                                          headers={"Content-Type": "image/png", "x-upsert": "true"},
                                          allow_redirects=False) as response:
                        if 200 <= response.status < 300:
                            return {"type": "final", "path": destination["path"],
                                    "mimeType": "image/png", "bytes": size,
                                    "width": width, "height": height}
                        retryable = response.status in (408, 429) or response.status >= 500
                        if not retryable:
                            break
            except (aiohttp.ClientError, asyncio.TimeoutError):
                pass
            if attempt == 0:
                await asyncio.sleep(1)
    raise RuntimeError("Rendered image could not be uploaded to private storage") from None


async def handler(job):
    """Stream the same events as /render-v2; aggregate them in the final job result.

    One render per worker. Cancellation closes the producer and the renderer
    terminates Blender's process group before temporary files are removed.
    """
    contract, ink = validate_input(job)
    destination = upload_destination(job)
    events = asyncio.Queue()
    last_progress = 0.0

    def emit(event):
        nonlocal last_progress
        if event["type"] == "preview":
            # A preview is optional; omit large ones instead of failing a render.
            if len(event["image"]) > 4 * ((MAX_PREVIEW_BYTES + 2) // 3):
                return
        elif "sample" in event:
            now = time.monotonic()
            if now - last_progress < 1 and event["sample"] != event["total"]:
                return
            last_progress = now
        events.put_nowait(event)

    with tempfile.TemporaryDirectory(prefix="smartink-job-") as temporary:
        async def produce():
            try:
                path = renderer.dump_to_dir(Path(temporary), contract, ink)
                emit({"type": "progress", "phase": "preparing"})
                # With an emit callback, the renderer uses task cancellation
                # rather than an HTTP connection to track job lifetime.
                output = await renderer.run_blender_render(path, None, emit)
                if destination is not None:
                    emit(await upload_result(output, destination))
                    return
                if output.stat().st_size > MAX_RESULT_BYTES:
                    raise ValueError("Rendered PNG exceeds 5 MiB; reduce output dimensions")
                image = output.read_bytes()
                if len(image) <= MAX_INLINE_BYTES:
                    emit({"type": "final", "mimeType": "image/png",
                          "image": base64.b64encode(image).decode("ascii")})
                else:
                    count = (len(image) + MAX_INLINE_BYTES - 1) // MAX_INLINE_BYTES
                    for index in range(count):
                        chunk = image[index * MAX_INLINE_BYTES:(index + 1) * MAX_INLINE_BYTES]
                        emit({"type": "image_chunk", "index": index, "total": count,
                              "image": base64.b64encode(chunk).decode("ascii")})
                    emit({"type": "final", "mimeType": "image/png", "chunkCount": count,
                          "bytes": len(image)})
            finally:
                events.put_nowait(None)

        task = asyncio.create_task(produce())
        try:
            while (event := await events.get()) is not None:
                yield event
            await task  # Preserve errors so RunPod marks the job FAILED.
        except HTTPException as exc:
            raise RuntimeError(exc.detail) from exc
        finally:
            if not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            elif not task.cancelled():
                task.exception()  # Retrieve a failure if the stream closed early.


if __name__ == "__main__":
    import runpod
    runpod.serverless.start({"handler": handler, "return_aggregate_stream": True})
