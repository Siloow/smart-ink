"""RunPod queue worker. Run from the repository root: python -m server.runpod.handler."""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import tempfile
import time
from pathlib import Path

from fastapi import HTTPException
from server import app as renderer

# Leave headroom for base64 and JSON within RunPod's request/result limits.
MAX_INK_BYTES = 6 * 1024 * 1024
MAX_RESULT_BYTES = 5 * 1024 * 1024
MAX_PREVIEW_BYTES = 512 * 1024


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


async def handler(job):
    """Stream the same events as /render-v2; aggregate them in the final job result.

    One render per worker. Cancellation closes the producer and the renderer
    terminates Blender's process group before temporary files are removed.
    """
    contract, ink = validate_input(job)
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
                if output.stat().st_size > MAX_RESULT_BYTES:
                    raise ValueError("Rendered PNG exceeds 5 MiB; reduce output dimensions")
                emit({"type": "final", "mimeType": "image/png",
                      "image": base64.b64encode(output.read_bytes()).decode("ascii")})
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
