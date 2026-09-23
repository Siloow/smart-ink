"""Real HTTP/process lifecycle tests; no Blender installation or network service needed.

Run with a Python that has server/requirements.txt installed:
  PYTHONDONTWRITEBYTECODE=1 server/.venv/bin/python tools/render-server.test.py
All writes and the fake Blender process are isolated in a temporary directory.
"""
import concurrent.futures
import copy
import http.client
import json
import os
from pathlib import Path
import shlex
import socket
import struct
import subprocess
import sys
import tempfile
import time
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.app import validate_contract, validate_png  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def png(width=1, height=1):
    def chunk(kind, payload):
        return struct.pack('>I', len(payload)) + kind + payload + struct.pack('>I', zlib.crc32(kind + payload) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress((b'\x00' + b'\x00\x00\x00\x00' * width) * height)) + chunk(b'IEND', b''))


def contract(width=64):
    return {'schemaVersion': 1, 'bodyMeshId': 'body_full', 'skinToneId': 'tone_03', 'poseId': 'neutral',
            'lookId': 'studio_softbox', 'inkTextureUrl': 'ink.png',
            'camera': {'position': [0, 0, 8], 'target': [0, 0, 0], 'fov': 45, 'aspect': 1},
            'output': {'qualityTier': 'preview', 'width': width, 'height': 64}}


def multipart(shot, ink=None):
    boundary = 'SmartInkTestBoundary'
    contract_bytes = json.dumps(shot).encode() if not isinstance(shot, bytes) else shot
    parts = []
    for name, filename, data, mime in [('contract', 'contract.json', contract_bytes, 'application/json'),
                                       ('ink_layer', 'ink.png', png() if ink is None else ink, 'image/png')]:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode() + data + b'\r\n')
    return b''.join(parts) + f'--{boundary}--\r\n'.encode(), f'multipart/form-data; boundary={boundary}'


class RenderServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='smartink-server-test-')
        cls.live = Path(cls.temp.name)
        (cls.live / 'sceneImporter.py').write_text('# test fixture\n')
        for asset in ('body_male_realistic.glb', 'body_female_realistic.glb'):
            (cls.live / asset).touch()
        (cls.live / 'fixture.png').write_bytes(png())
        fake = cls.live / 'fake-blender'
        script = cls.live / 'fake_blender.py'
        fake.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable) + ' ' + shlex.quote(str(script)) + ' "$@"\n')
        script.write_text('''import json, os, pathlib, signal, sys, time
root = pathlib.Path(os.environ['SMARTINK_LIVE_DIR'])
shot_path = pathlib.Path(sys.argv[sys.argv.index('--') + 1])
width = json.loads(shot_path.read_text())['output']['width']
marker = root / (str(width) + '-' + str(os.getpid()) + '.pid')
marker.write_text(str(os.getpid()))
def cancelled(*args):
    marker.with_suffix('.cancelled').touch()
    sys.exit(0)
signal.signal(signal.SIGTERM, cancelled)
time.sleep(10 if width in (102, 103) else 0.9 if width == 101 else 0.03)
if width == 105:
    print('Controlled Blender failure', flush=True)
    sys.exit(3)
out = shot_path.parent / 'renders'
out.mkdir()
if '--progressive' in sys.argv:
    print('SMARTINK_PHASE preview', flush=True)
    (out / 'preview.png').write_bytes((root / 'fixture.png').read_bytes())
    print('SMARTINK_PREVIEW_READY', flush=True)
    print('SMARTINK_PHASE final', flush=True)
    print('Rendering | Sample 8/64', flush=True)
    time.sleep(0.5)
(out / 'output.png').write_bytes(b'broken' if width == 104 else (root / 'fixture.png').read_bytes())
''')
        fake.chmod(0o755)
        with socket.socket() as reservation:
            reservation.bind(('127.0.0.1', 0))
            cls.port = reservation.getsockname()[1]
        env = {**os.environ, 'SMARTINK_LIVE_DIR': str(cls.live), 'BLENDER': str(fake),
               'SMARTINK_RENDER_TIMEOUT': '2', 'SMARTINK_MAX_CONCURRENT_RENDERS': '2',
               'PYTHONDONTWRITEBYTECODE': '1'}
        cls.log = (cls.live / 'server.log').open('w+')
        cls.server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'server.app:app', '--app-dir', str(ROOT),
                                       '--host', '127.0.0.1', '--port', str(cls.port), '--log-level', 'warning'],
                                      env=env, stdout=cls.log, stderr=cls.log)
        for _ in range(100):
            try:
                if cls.request('/health')[0] == 200:
                    return
            except OSError:
                pass
            if cls.server.poll() is not None:
                break
            time.sleep(0.05)
        cls.log.seek(0)
        raise RuntimeError('Test server failed: ' + cls.log.read())

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait()
        cls.log.close()
        cls.temp.cleanup()

    @classmethod
    def request(cls, path, shot=None, ink=None):
        connection = http.client.HTTPConnection('127.0.0.1', cls.port, timeout=8)
        try:
            if shot is None:
                connection.request('GET', path)
            else:
                body, content_type = multipart(shot, ink)
                connection.request('POST', path, body, {'Content-Type': content_type})
            response = connection.getresponse()
            return response.status, response.read(), response.getheader('content-type')
        finally:
            connection.close()

    def wait_until(self, predicate, seconds=3):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.025)
        self.fail('Timed out waiting for process state')

    def state(self):
        return json.loads(self.request('/health')[1])

    def test_01_png_and_contract_validation(self):
        self.assertEqual(validate_png(png()), (1, 1))
        self.assertEqual(validate_contract(json.dumps(contract()).encode()), contract())
        for transform in [lambda c: c.update(bodyRegion=[]), lambda c: c.update(schemaVersion=True),
                          lambda c: c['output'].update(width=9000), lambda c: c['output'].update(samples=1),
                          lambda c: c['camera'].update(position=[float('nan'), 0, 8]),
                          lambda c: c['camera'].update(position=[10**400, 0, 8]),
                          lambda c: c.update(bodyHair=[]),
                          lambda c: c.update(inkTextureUrl='/etc/passwd'), lambda c: c.update(bodyShape={'waist': 2})]:
            shot = copy.deepcopy(contract())
            transform(shot)
            with self.assertRaises(HTTPException):
                validate_contract(json.dumps(shot).encode())
        for bad in (b'bad', png()[:-4], png() + b'extra', png().replace(b'IDAT', b'BROK')):
            with self.assertRaises(HTTPException):
                validate_png(bad)

    def test_02_rejected_before_process_start(self):
        before = list(self.live.glob('*.pid'))
        for shot, ink in ((b'{broken', png()), (contract(), b'not a PNG'), ({**contract(), 'bodyRegion': []}, png())):
            status, body, _ = self.request('/render-v2', shot, ink)
            self.assertEqual(status, 422, body)
        self.assertEqual(list(self.live.glob('*.pid')), before)

    def test_03_success_and_live_sync(self):
        status, image, content_type = self.request('/render-v2', contract(), png())
        self.assertEqual(status, 200, image)
        self.assertEqual(content_type, 'image/png')
        self.assertEqual(validate_png(image), (1, 1))
        status, _, _ = self.request('/sync-live', contract(), png())
        self.assertEqual(status, 200)
        self.assertEqual(json.loads((self.live / 'contract.json').read_text()), contract())
        self.assertEqual((self.live / 'ink.png').read_bytes(), png())

    def test_04_concurrent_renders_keep_health_responsive(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(self.request, '/render-v2', contract(101)) for _ in range(2)]
            self.wait_until(lambda: self.state()['active_renders'] == 2)
            start = time.monotonic()
            state = self.state()
            self.assertLess(time.monotonic() - start, 0.5)
            self.assertTrue(state['ready'])
            self.assertTrue(state['cancellation_supported'])
            self.assertEqual(self.request('/render-v2', contract())[0], 429)
            self.assertEqual([job.result()[0] for job in jobs], [200, 200])
        self.assertEqual(self.state()['active_renders'], 0)

    def test_05_disconnect_kills_blender_and_releases_slot(self):
        body, content_type = multipart(contract(102))
        connection = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        connection.sendall((f'POST /render-v2 HTTP/1.1\r\nHost: localhost\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n').encode() + body)
        self.wait_until(lambda: bool(list(self.live.glob('102-*.pid'))))
        pid = int(next(self.live.glob('102-*.pid')).read_text())
        start = time.monotonic()
        connection.shutdown(socket.SHUT_RDWR)
        connection.close()
        self.wait_until(lambda: bool(list(self.live.glob('102-*.cancelled'))))
        self.wait_until(lambda: self.state()['active_renders'] == 0)
        self.assertLess(time.monotonic() - start, 1.5)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_06_timeout_kills_blender_and_error_outputs_rejected(self):
        start = time.monotonic()
        status, body, _ = self.request('/render-v2', contract(103))
        self.assertEqual(status, 504, body)
        self.assertLess(time.monotonic() - start, 4)
        self.assertTrue(list(self.live.glob('103-*.cancelled')))
        pid = int(next(self.live.glob('103-*.pid')).read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        for width in (104, 105):
            status, body, _ = self.request('/render-v2', contract(width))
            self.assertEqual(status, 500, body)
        self.assertEqual(self.state()['active_renders'], 0)

    def test_progressive_preview_precedes_final(self):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=8)
        body, content_type = multipart(contract())
        connection.request('POST', '/render-v2', body, {'Content-Type': content_type, 'Accept': 'application/x-ndjson'})
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        events = []
        while line := response.readline():
            if line.strip():
                event = json.loads(line)
                events.append(event)
                if event['type'] == 'preview':
                    self.assertEqual(self.state()['active_renders'], 1)
        connection.close()
        kinds = [event['type'] for event in events]
        self.assertLess(kinds.index('preview'), kinds.index('final'))
        self.assertTrue(any(event.get('sample') == 8 and event.get('total') == 64 for event in events))
        self.wait_until(lambda: self.state()['active_renders'] == 0)

    def test_progressive_disconnect_releases_slot(self):
        for marker in self.live.glob('102-*'):
            marker.unlink()
        body, content_type = multipart(contract(102))
        connection = socket.create_connection(('127.0.0.1', self.port), timeout=5)
        connection.sendall((f'POST /render-v2 HTTP/1.1\r\nHost: localhost\r\nAccept: application/x-ndjson\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n').encode() + body)
        self.wait_until(lambda: bool(list(self.live.glob('102-*.pid'))))
        pid = int(next(self.live.glob('102-*.pid')).read_text())
        connection.shutdown(socket.SHUT_RDWR)
        connection.close()
        self.wait_until(lambda: bool(list(self.live.glob('102-*.cancelled'))))
        self.wait_until(lambda: self.state()['active_renders'] == 0)
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_07_health_reports_missing_setup(self):
        asset = self.live / 'body_female_realistic.glb'
        asset.unlink()
        try:
            state = self.state()
            self.assertTrue(state['ok'])
            self.assertFalse(state['ready'])
            self.assertFalse(state['checks']['body_assets'])
            shot = {**contract(), 'bodyMeshId': 'body_full_female'}
            self.assertEqual(self.request('/render-v2', shot)[0], 503)
        finally:
            asset.touch()


if __name__ == '__main__':
    unittest.main(verbosity=2)
