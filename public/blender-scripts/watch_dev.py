#!/usr/bin/env python3
"""
GUI live-reload watcher for Smart Ink contract exports.

Setup ~/smartink-live/ with body meshes + sceneImporter.py, then:
  blender --python watch_dev.py

Re-export contract.json + ink.png from the demo (or let the local server write
them on Render) and the scene rebuilds automatically.

Override watch directory:
  SMARTINK_LIVE_DIR=~/Downloads blender --python watch_dev.py
"""

from __future__ import annotations

import importlib.util
import os
import time
from pathlib import Path

import bpy

LIVE_DIR = Path(
    os.environ.get("SMARTINK_LIVE_DIR", os.path.expanduser("~/smartink-live"))
).expanduser()
CONTRACT = LIVE_DIR / "contract.json"
INK = LIVE_DIR / "ink.png"
POLL_SEC = 1.0

_here = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("sceneImporter", _here / "sceneImporter.py")
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)


def _signature() -> float:
    mtimes = []
    for p in (CONTRACT, INK):
        if p.exists():
            mtimes.append(p.stat().st_mtime)
    return max(mtimes) if mtimes else 0.0


_state = {"last": 0.0}


def _tick() -> float:
    if not CONTRACT.exists():
        return POLL_SEC
    sig = _signature()
    if sig and sig != _state["last"]:
        _state["last"] = sig
        print(f"[smartink] Rebuilding from {CONTRACT} …")
        try:
            _mod.build_scene(str(CONTRACT))
            print("[smartink] Scene updated.")
        except Exception as exc:
            print(f"[smartink] Rebuild error: {exc}")
    return POLL_SEC


LIVE_DIR.mkdir(parents=True, exist_ok=True)
print(f"[smartink] Watching {LIVE_DIR} — drop contract.json + ink.png to refresh.")
bpy.app.timers.register(_tick, first_interval=0.5)
