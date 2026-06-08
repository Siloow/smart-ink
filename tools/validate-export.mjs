#!/usr/bin/env node
/**
 * Quick schema pre-flight for scene export JSON files.
 * Usage: node tools/validate-export.mjs path/to/export.json
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node tools/validate-export.mjs <export.json>');
  process.exit(1);
}

const data = JSON.parse(readFileSync(path, 'utf8'));
const errors = [];

function isTattooExport(d) {
  return d.bodyMesh != null && Array.isArray(d.decals) && d.camera && d.lighting && d.renderSettings;
}

function isRenderContract(d) {
  return d.schemaVersion != null && d.bodyMeshId && d.inkTextureUrl && d.camera && d.output;
}

if (isTattooExport(data)) {
  if (!data.version) errors.push('TattooSceneExport: missing version');
  if (!data.camera?.position) errors.push('TattooSceneExport: camera.position required');
  if (!data.camera?.target) errors.push('TattooSceneExport: camera.target required');
  if (!data.lighting?.lights?.length) errors.push('TattooSceneExport: lighting.lights required');
} else if (isRenderContract(data)) {
  if (data.schemaVersion !== 1) errors.push('RenderContract: schemaVersion must be 1');
  if (!data.lookId) errors.push('RenderContract: lookId required');
  if (!data.output?.qualityTier) errors.push('RenderContract: output.qualityTier required');
} else {
  errors.push('Unknown format: expected TattooSceneExport or RenderContract');
}

if (errors.length) {
  console.error('Validation failed:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

console.log('OK:', isTattooExport(data) ? 'TattooSceneExport' : 'RenderContract');
