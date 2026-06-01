import { useMemo } from 'react'
import type { DebugLightInfo } from './SceneDebugHelpers'

interface DebugDataPanelCameraState {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

interface DebugDataPanelProps {
  cameraState: DebugDataPanelCameraState
  lightingPreset: string // app key (e.g. "studio")
  blenderLightingPreset: string // blender key (e.g. "studio")
  model: string
  decalPosition: [number, number, number] | null
  threeLights: DebugLightInfo[]
  exporterLights: DebugLightInfo[]
}

function toBlender(pos: [number, number, number]): [number, number, number] {
  return [pos[0], -pos[2], pos[1]]
}

function fmtPos(pos: [number, number, number]): string {
  return `(${pos[0].toFixed(2)}, ${pos[1].toFixed(2)}, ${pos[2].toFixed(2)})`
}

function fmtLights(lights: DebugLightInfo[]): string[] {
  return lights.map((l) => {
    const blenderPos = toBlender(l.position)
    const intensityPart = typeof l.intensity === 'number' ? ` @ ${l.intensity}` : ''
    return `${l.type}:${intensityPart} Three ${fmtPos(l.position)}  Blender ${fmtPos(blenderPos)}`
  })
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function sortByPosition(lights: DebugLightInfo[]): DebugLightInfo[] {
  return [...lights].sort((a, b) => {
    if (a.position[0] !== b.position[0]) return a.position[0] - b.position[0]
    if (a.position[1] !== b.position[1]) return a.position[1] - b.position[1]
    return a.position[2] - b.position[2]
  })
}

export default function DebugDataPanel({
  cameraState,
  lightingPreset,
  blenderLightingPreset,
  model,
  decalPosition,
  threeLights,
  exporterLights,
}: DebugDataPanelProps) {
  const mismatch = useMemo(() => {
    const a = sortByPosition(threeLights)
    const b = sortByPosition(exporterLights)

    if (a.length !== b.length) return true
    if (a.length === 0 && b.length === 0) return false

    const threshold = 0.75
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (dist(a[i].position, b[i].position) > threshold) return true
    return false
  }, [threeLights, exporterLights])

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        background: 'rgba(0,0,0,0.85)',
        color: '#e0e0e0',
        padding: '12px 16px',
        borderRadius: 8,
        fontSize: 11,
        fontFamily: 'monospace',
        lineHeight: 1.6,
        zIndex: 100,
        maxWidth: 380,
        pointerEvents: 'none',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: '#00ffff' }}>Render Debug</div>

      <div style={{ color: '#aaa', marginBottom: 4 }}>Camera</div>
      <div>
        <span style={{ color: '#888' }}>Three pos: </span>
        <span style={{ color: '#7df' }}>{fmtPos(cameraState.position)}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>Blender pos: </span>
        <span style={{ color: '#fa5' }}>{fmtPos(toBlender(cameraState.position))}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>Target: </span>
        <span style={{ color: '#7df' }}>{fmtPos(cameraState.target)}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>Target (Blender): </span>
        <span style={{ color: '#fa5' }}>{fmtPos(toBlender(cameraState.target))}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>FOV: </span>
        <span>{cameraState.fov}°</span>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0' }} />

      <div style={{ color: '#aaa', marginBottom: 4 }}>Lighting</div>
      <div>
        <span style={{ color: '#888' }}>Preview preset: </span>
        <span>{lightingPreset}</span>
      </div>
      <div>
        <span style={{ color: '#888' }}>Exporter preset: </span>
        <span>{blenderLightingPreset}</span>
      </div>
      {mismatch ? (
        <div style={{ color: '#ffb37b', fontSize: 10, marginTop: 6 }}>
          ⚠ Preview and Blender exporter light positions likely differ. This can cause coordinate conversion/render mismatches.
        </div>
      ) : (
        <div style={{ color: '#7dd3fc', fontSize: 10, marginTop: 6 }}>Preview + exporter light positions look aligned.</div>
      )}

      <div style={{ marginTop: 8 }}>
        <div style={{ color: '#aaa', marginBottom: 4 }}>Three.js (Y-up) lights</div>
        {threeLights.length === 0 ? (
          <div style={{ color: '#888' }}>No lights found.</div>
        ) : (
          fmtLights(threeLights).map((line, idx) => (
            <div key={`tl-${idx}`} style={{ whiteSpace: 'nowrap' }}>
              {line}
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ color: '#aaa', marginBottom: 4 }}>Exporter lights (Three coords)</div>
        {exporterLights.length === 0 ? (
          <div style={{ color: '#888' }}>No lights found.</div>
        ) : (
          fmtLights(exporterLights).map((line, idx) => (
            <div key={`el-${idx}`} style={{ whiteSpace: 'nowrap' }}>
              {line}
            </div>
          ))
        )}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', margin: '8px 0' }} />

      <div style={{ color: '#aaa', marginBottom: 4 }}>Scene</div>
      <div>
        <span style={{ color: '#888' }}>Model: </span>
        <span>{model}</span>
      </div>
      {decalPosition && (
        <div>
          <span style={{ color: '#888' }}>Decal pos: </span>
          <span style={{ color: '#7df' }}>{fmtPos(decalPosition)}</span>
        </div>
      )}
    </div>
  )
}

