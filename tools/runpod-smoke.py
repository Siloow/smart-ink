"""Render a small scene through the installed RunPod SDK and the real Blender.

python tools/runpod-smoke.py --output /tmp/smartink-smoke.png
Use --write-input /tmp/smartink-job.json to generate a cloud test request only.
"""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_job():
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\x00")) + chunk(b"IEND", b""))
    contract = {"schemaVersion": 1, "bodyMeshId": "body_full", "skinToneId": "tone_03",
                "poseId": "neutral", "lookId": "studio_softbox", "inkTextureUrl": "ink.png",
                "camera": {"position": [0, 0, 8], "target": [0, 0, 0], "fov": 45, "aspect": 1},
                "output": {"qualityTier": "preview", "width": 256, "height": 256, "samples": 64}}
    return {"input": {"contract": contract, "ink_base64": base64.b64encode(png).decode()}}


async def smoke(output):
    os.environ.setdefault("RUNPOD_LOG_LEVEL", "INFO")
    from runpod.serverless.modules.rp_job import run_job_generator
    from server.runpod.handler import handler
    from server.app import validate_png
    job = {"id": "smartink-smoke", **test_job()}
    final = False
    chunks = []
    async for result in run_job_generator(handler, job):
        if "error" in result:
            raise RuntimeError(result["error"])
        event = result["output"]
        print(json.dumps({k: v for k, v in event.items() if k != "image"}), flush=True)
        if event["type"] == "image_chunk":
            assert event["index"] == len(chunks)
            chunks.append(base64.b64decode(event["image"], validate=True))
        if event["type"] == "final":
            if "image" in event:
                image = base64.b64decode(event["image"], validate=True)
            else:
                assert len(chunks) == event["chunkCount"]
                image = b"".join(chunks)
                assert len(image) == event["bytes"]
            assert validate_png(image) == (256, 256)
            output.write_bytes(image)
            final = True
    if not final:
        raise RuntimeError("Worker ended without a final image")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("/tmp/smartink-smoke.png"))
    parser.add_argument("--write-input", type=Path)
    args = parser.parse_args()
    if args.write_input:
        args.write_input.write_text(json.dumps(test_job()))
    else:
        asyncio.run(smoke(args.output))
