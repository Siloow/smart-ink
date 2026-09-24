"""Worker integration tests with a real subprocess; no GPU or RunPod account needed."""
import asyncio
import base64
import importlib.util
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.runpod import handler as worker
from server import app as renderer

spec = importlib.util.spec_from_file_location("render_fixtures", ROOT / "tools/render-server.test.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)


class WorkerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        (self.root / "fixture.png").write_bytes(fixtures.png())
        script = self.root / "fake.py"
        script.write_text('''import json, pathlib, sys, time
root = pathlib.Path(__file__).parent
shot = pathlib.Path(sys.argv[sys.argv.index('--') + 1])
(root / 'shot-path').write_text(str(shot))
width = json.loads(shot.read_text())['output']['width']
if width == 105: sys.exit(3)
if width == 106: time.sleep(30)
out = shot.parent / 'renders'
out.mkdir()
print('SMARTINK_PHASE preview', flush=True)
(out / 'preview.png').write_bytes((root / 'fixture.png').read_bytes())
print('SMARTINK_PREVIEW_READY', flush=True)
print('SMARTINK_PHASE final', flush=True)
print('Rendering | Sample 8/64', flush=True)
(out / 'output.png').write_bytes((root / 'fixture.png').read_bytes())
''')
        executable = self.root / "blender"
        executable.write_text("#!/bin/sh\nexec " + shlex.quote(sys.executable) + " " + shlex.quote(str(script)) + ' "$@"\n')
        executable.chmod(0o755)
        for name, value in (("LIVE_DIR", self.root), ("BLENDER", str(executable))):
            p = patch.object(renderer, name, value)
            p.start()
            self.addCleanup(p.stop)

    def job(self, width=64):
        return {"input": {"contract": fixtures.contract(width),
                          "ink_base64": base64.b64encode(fixtures.png()).decode()}}

    async def collect(self, job):
        return [event async for event in worker.handler(job)]

    async def test_real_process_events_and_cleanup(self):
        events = await self.collect(self.job())
        self.assertEqual(events[0], {"type": "progress", "phase": "preparing"})
        self.assertTrue(any(e["type"] == "preview" for e in events))
        self.assertTrue(any(e.get("sample") == 8 for e in events))
        self.assertEqual(events[-1]["type"], "final")
        self.assertEqual(base64.b64decode(events[-1]["image"]), fixtures.png())
        self.assertFalse(Path((self.root / "shot-path").read_text()).parent.exists())

    async def test_invalid_input_never_launches_blender(self):
        for job in ({}, self.job()):
            if "input" in job:
                job["input"]["ink_base64"] = "not a PNG"
            with self.assertRaises(ValueError):
                await self.collect(job)
        job = self.job()
        job["input"]["contract"]["inkTextureUrl"] = "../../etc/passwd"
        with self.assertRaises(ValueError):
            await self.collect(job)
        self.assertFalse((self.root / "shot-path").exists())

    async def test_timeout_kills_process_and_cleans_files(self):
        with patch.object(renderer, "RENDER_TIMEOUT_SEC", 1):
            with self.assertRaisesRegex(Exception, "timed out"):
                await self.collect(self.job(106))
        self.assertFalse(Path((self.root / "shot-path").read_text()).parent.exists())

    async def test_cancel_stops_process_before_cleanup(self):
        stream = worker.handler(self.job(106))
        await stream.__anext__()
        for _ in range(100):
            if (self.root / "shot-path").exists():
                break
            await asyncio.sleep(0.01)
        with patch.object(renderer, "_stop_process", wraps=renderer._stop_process) as stop:
            await stream.aclose()
            stop.assert_awaited_once()
            self.assertIsNotNone(stop.call_args.args[0].returncode)
        self.assertFalse(Path((self.root / "shot-path").read_text()).parent.exists())

    async def test_failure_is_not_a_success_event(self):
        with self.assertRaises(Exception):
            await self.collect(self.job(105))

    async def test_output_cap(self):
        with patch.object(worker, "MAX_RESULT_BYTES", 1):
            with self.assertRaisesRegex(ValueError, "exceeds"):
                await self.collect(self.job())

    async def test_nonfinite_contract_and_oversized_ink(self):
        job = self.job()
        job["input"]["contract"]["camera"]["fov"] = float("nan")
        with self.assertRaises(ValueError):
            await self.collect(job)
        with patch.object(worker, "MAX_INK_BYTES", 1):
            with self.assertRaises(ValueError):
                await self.collect(self.job())

    async def test_large_image_chunks_reassemble_exactly(self):
        with patch.object(worker, "MAX_INLINE_BYTES", 16):
            result = await self.collect(self.job())
        chunks = [event for event in result if event["type"] == "image_chunk"]
        self.assertEqual([event["index"] for event in chunks], list(range(len(chunks))))
        self.assertEqual(b"".join(base64.b64decode(event["image"]) for event in chunks), fixtures.png())
        self.assertEqual(result[-1]["chunkCount"], len(chunks))
        self.assertEqual(result[-1]["bytes"], len(fixtures.png()))

    def destination(self):
        path = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png"
        return {"path": path, "url": "https://project.supabase.co/storage/v1/object/upload/sign/renders/" + path + "?token=secret"}

    async def test_invalid_destination_rejected_before_render(self):
        for url in ["http://127.0.0.1/", "https://evil.test/", "https://project.supabase.co.evil.test/", "https://project.supabase.co/storage/v1/object/upload/sign/renders/other?token=secret"]:
            job = self.job()
            job["input"]["result_upload"] = {**self.destination(), "url": url}
            with self.assertRaisesRegex(ValueError, "storage destination"):
                await self.collect(job)
        self.assertFalse((self.root / "shot-path").exists())

    async def test_direct_upload_preserves_large_png_without_chunks(self):
        # Real valid PNG > 5 MiB; incompressible pixels reproduce the failed render.
        import struct, zlib
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
        width, height = 2560, 640
        pixels = b"".join(b"\x00" + os.urandom(width * 4) for _ in range(height))
        image = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")
        self.assertGreater(len(image), 5 * 1024 * 1024)
        (self.root / "fixture.png").write_bytes(image)
        job = self.job(width)
        job["input"]["result_upload"] = self.destination()
        uploaded = []
        class Response:
            status = 200
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            def put(self, url, *, data, headers, allow_redirects):
                uploaded.append((url, data.read(), headers, allow_redirects))
                return Response()
        with patch.object(worker.aiohttp, "ClientSession", Client):
            events = await self.collect(job)
        self.assertEqual(uploaded[0][1], image)
        self.assertFalse(uploaded[0][3])
        self.assertEqual(events[-1], {"type": "final", "path": self.destination()["path"], "mimeType": "image/png", "bytes": len(image), "width": width, "height": height})
        self.assertFalse(any(e["type"] == "image_chunk" for e in events))
        self.assertNotIn("secret", json.dumps(events))

    async def test_upload_failure_never_emits_success_or_leaks_url(self):
        job = self.job()
        job["input"]["result_upload"] = self.destination()
        class Response:
            status = 403
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
        class Client:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            def put(self, *args, **kwargs): return Response()
        with patch.object(worker.aiohttp, "ClientSession", Client):
            with self.assertRaisesRegex(RuntimeError, "could not be uploaded") as error:
                await self.collect(job)
        self.assertNotIn("secret", str(error.exception))
        self.assertFalse(Path((self.root / "shot-path").read_text()).parent.exists())

    async def test_sdk_consumes_stream_and_reports_failures(self):
        from runpod.serverless.modules.rp_job import run_job_generator
        from runpod.serverless.modules.rp_logger import RunPodLogger
        RunPodLogger().set_level("ERROR")
        result = [event async for event in run_job_generator(worker.handler, {"id": "test", **self.job()})]
        self.assertEqual(result[-1]["output"]["type"], "final")
        result = [event async for event in run_job_generator(worker.handler, {"id": "invalid"})]
        self.assertIn("error", result[-1])


if __name__ == "__main__":
    unittest.main()
