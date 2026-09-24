"""Replay the versioned browser fit on the renderer; never solve a second fit.

Pure Python, shared by request validation and Blender. The immutable basis is
the same asset used by src/measurements/fitter.ts (metres, side/up/front).
"""
import gzip
import json
import math
from functools import lru_cache
from pathlib import Path

ASSET_DIR = Path(__file__).resolve().parent.parent / 'public' / 'measurements'
MODELS = {'body_full': 'male', 'body_full_female': 'female'}


@lru_cache(maxsize=2)
def load_asset(body_mesh_id):
    if body_mesh_id not in MODELS:
        raise ValueError('Unsupported measurement body model')
    with gzip.open(ASSET_DIR / (MODELS[body_mesh_id] + '-v1.bin'), 'rt') as source:
        asset = json.load(source)
    if asset['version'] != 1 or asset['sex'] != MODELS[body_mesh_id]:
        raise ValueError('Unsupported measurement asset version')
    return asset


def _number(value, low, high):
    return type(value) in (int, float) and math.isfinite(value) and low <= value <= high


def validate_fit(fit, body_mesh_id):
    if not isinstance(fit, dict) or type(fit.get('version')) is not int or fit['version'] != 1:
        raise ValueError('Unsupported bodyFit version')
    if fit.get('bodyMeshId') != body_mesh_id or body_mesh_id not in MODELS:
        raise ValueError('bodyFit must match the body model')
    asset = load_asset(body_mesh_id)
    values = fit.get('measurements')
    if not isinstance(values, dict) or set(values) != set(asset['baseline']):
        raise ValueError('bodyFit requires all 15 measurements')
    for key, base in asset['baseline'].items():
        if not _number(values[key], base * .75, base * 1.4):
            raise ValueError('bodyFit measurement outside supported range: ' + key)
    if not .38 < values['inseam'] / values['height'] < .55:
        raise ValueError('Invalid bodyFit height / inseam combination')
    for key, length, limit in [('parameters', 20, .85), ('armDeltas', 2, .5)]:
        entries = fit.get(key)
        if not isinstance(entries, list) or len(entries) != length or not all(_number(n, -limit, limit) for n in entries):
            raise ValueError('Invalid bodyFit.' + key)
    if not _number(fit.get('maxErrorMm'), 0, 2):
        raise ValueError('Invalid bodyFit.maxErrorMm')
    return fit


def height_warp(height, target_height, inseam):
    """The browser's monotone cubic Hermite interpolation, including endpoints."""
    scale = target_height / (height * 100)
    x = [0, .07 * height, .47 * height, .84 * height, height]
    y = [0, .07 * height * scale, inseam / 100, .84 * height * scale, height * scale]
    h = [x[i + 1] - x[i] for i in range(4)]
    d = [(y[i + 1] - y[i]) / h[i] for i in range(4)]
    def end(h0, h1, d0, d1):
        n = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1)
        if n * d0 <= 0:
            return 0
        if d0 * d1 <= 0 and abs(n) > abs(3 * d0):
            return 3 * d0
        return n
    m = [end(h[0], h[1], d[0], d[1]), 0, 0, 0, end(h[3], h[2], d[3], d[2])]
    for i in range(1, 4):
        w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
        m[i] = 0 if d[i - 1] * d[i] <= 0 else (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    def sample(n):
        i = 0
        while i < 3 and n > x[i + 1]:
            i += 1
        t = (n - x[i]) / h[i]
        return ((2*t**3 - 3*t**2 + 1)*y[i] + (t**3 - 2*t**2 + t)*h[i]*m[i]
                + (-2*t**3 + 3*t**2)*y[i + 1] + (t**3 - t**2)*h[i]*m[i + 1])
    return scale, sample


def deform_fit(asset, fit):
    """Return fitted browser vertices; coefficients are frozen at shot capture."""
    out = list(asset['positions'])
    for arm, delta in zip(asset['arms'], fit['armDeltas']):
        for i, weight in enumerate(arm['shift']):
            for k in range(3):
                out[i*3 + k] += weight * delta * arm['axis'][k]
    for descriptor, parameter in zip(asset['descriptors'], fit['parameters']):
        amount = math.expm1(parameter)
        for i, vertex in enumerate(descriptor['ids']):
            for k in range(3):
                out[vertex*3 + k] += amount * descriptor['delta'][i*3 + k]
    scale, sample = height_warp(asset['H'], fit['measurements']['height'], fit['measurements']['inseam'])
    for i in range(0, len(out), 3):
        out[i] *= scale
        out[i + 1] = sample(out[i + 1])
        out[i + 2] *= scale
    return out
