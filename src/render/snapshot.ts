import type { RenderContract } from './contract';

export type SnapshotQuality = 'quick' | 'detailed';
export type SnapshotShot = { contract: RenderContract; inkBlob: Blob; sceneName?: string };

/** Keep the viewport's crop, independent of the social-image export format. */
export function snapshotOutput(aspect: number, quality: SnapshotQuality) {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? Math.min(32, Math.max(1 / 32, aspect)) : 1;
  const edge = quality === 'detailed' ? 2560 : 960;
  return {
    qualityTier: 'final' as const,
    width: Math.round(ratio >= 1 ? edge : edge * ratio),
    height: Math.round(ratio >= 1 ? edge / ratio : edge),
    samples: quality === 'detailed' ? 512 : 64,
  };
}

export function snapshotContract(source: RenderContract, quality: SnapshotQuality): RenderContract {
  const contract = structuredClone(source);
  contract.renderStyle = 'cinematic';
  contract.output = snapshotOutput(contract.camera.aspect, quality);
  contract.camera.preserveFraming = true;
  contract.camera.aperture = 8;
  return contract;
}
