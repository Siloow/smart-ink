import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

interface SceneDebugCameraState {
  position: [number, number, number]
  target: [number, number, number]
  fov: number
}

export type DebugLightInfo = {
  type: string
  position: [number, number, number] // Three.js coordinates (Y-up)
  intensity?: number
  colorHex?: string
}

export interface SceneDebugHelpersProps {
  lightingPreset: string
  cameraState: SceneDebugCameraState
  onLightsChange?: (lights: DebugLightInfo[]) => void
}

/**
 * Convert Three.js Y-up position to Blender Z-up position for display.
 * Three:  (x, y, z)
 * Blender: (x, -z, y)
 */
function toBlender(pos: [number, number, number]): [number, number, number] {
  return [pos[0], -pos[2], pos[1]]
}

function toFixed3(n: number): string {
  return n.toFixed(2)
}

export default function SceneDebugHelpers({ lightingPreset, cameraState, onLightsChange }: SceneDebugHelpersProps) {
  const { scene, camera } = useThree()

  // Gather all non-ambient lights from the scene.
  const lights = useMemo(() => {
    const found: DebugLightInfo[] = []
    void lightingPreset // ensure we recompute when the preset changes

    scene.traverse((obj) => {
      if (!(obj instanceof THREE.Light) || obj instanceof THREE.AmbientLight) return

      const light = obj
      const colorHex = `#${light.color.getHexString()}`

      found.push({
        type: light.type,
        position: [light.position.x, light.position.y, light.position.z],
        intensity: light.intensity,
        colorHex,
      })
    })

    return found
  }, [scene, lightingPreset])

  useEffect(() => {
    onLightsChange?.(lights)
  }, [lights, onLightsChange])

  // Camera frustum wireframe (imperative helper object).
  const cameraHelperRef = useRef<THREE.CameraHelper | null>(null)

  useEffect(() => {
    if (!cameraHelperRef.current) {
      const helper = new THREE.CameraHelper(camera as THREE.Camera)

      const lineMaterial = (helper.material as THREE.LineBasicMaterial) || null
      if (lineMaterial) {
        lineMaterial.color = new THREE.Color('#ff00ff')
        lineMaterial.transparent = true
        lineMaterial.opacity = 0.9
      }

      cameraHelperRef.current = helper
      scene.add(helper)
    }

    return () => {
      const helper = cameraHelperRef.current
      if (helper) scene.remove(helper)
      cameraHelperRef.current = null
    }
  }, [scene, camera])

  useFrame(() => {
    cameraHelperRef.current?.update()
  })

  const blenderCam = toBlender(cameraState.position)
  const blenderTarget = toBlender(cameraState.target)

  return (
    <>
      {/* Grid on XZ plane */}
      <gridHelper args={[20, 20, '#666666', '#333333']} position={[0, -0.01, 0]} />

      {/* Axes indicator (X=R, Y=G, Z=B) */}
      <axesHelper args={[4]} />

      {/* Camera frustum label (Blender coordinates) */}
      <Html
        position={cameraState.position}
        center
        style={{
          pointerEvents: 'none',
          background: 'rgba(0,0,0,0.55)',
          color: '#e0e0e0',
          padding: '4px 8px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.12)',
          fontSize: 11,
          fontFamily: 'monospace',
          whiteSpace: 'pre',
        }}
      >
        {`Blender coords\nCam: (${toFixed3(blenderCam[0])}, ${toFixed3(blenderCam[1])}, ${toFixed3(blenderCam[2])})\nTgt: (${toFixed3(blenderTarget[0])}, ${toFixed3(blenderTarget[1])}, ${toFixed3(blenderTarget[2])})`}
      </Html>

      {/* Camera target marker */}
      <mesh position={cameraState.target}>
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshBasicMaterial color="#00ffff" wireframe />
      </mesh>

      {/* Light position markers (yellow spheres with lines to origin) */}
      {lights.map((light, i) => {
        const [x, y, z] = light.position
        return (
          <group key={`${light.type}-${i}-${lightingPreset}`}>
            <mesh position={[x, y, z]}>
              <sphereGeometry args={[0.16, 10, 10]} />
              <meshBasicMaterial color="#ffff00" wireframe />
            </mesh>

            <line>
              <bufferGeometry>
                {/*
                  R3F v9 `bufferAttribute` expects `args` = [array, itemSize].
                  We draw a simple line from the light position to the origin.
                */}
                <bufferAttribute
                  attach="attributes-position"
                  args={[new Float32Array([x, y, z, 0, 0, 0]), 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color="#ffff44" opacity={0.45} transparent />
            </line>
          </group>
        )
      })}
    </>
  )
}

