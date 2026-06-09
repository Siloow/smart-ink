import { useState, useEffect, useRef, useCallback } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
// import { OrbitControls } from '@react-three/drei'
import OrbitControlsWithCmdLock from './OrbitControlsWithCmdLock'
import ModelWithUVTattoo, { type ModelWithUVTattooHandle } from './ModelWithUVTattoo'
import CinematicLights from './CinematicLights'
import TopMenuBar from './TopMenuBar'
import ScenesDashboard from './ScenesDashboard'
import LandingPage from './LandingPage'
import LoginPage from './LoginPage'
import EditorLeftPanel from './EditorLeftPanel'
import type { SceneData } from './types'
import { updateScene } from './sceneStorage'
import { downloadFiles } from './utils/sceneExporter'
import type { LightingPresetKey } from './config/lightingPresets'
import {
  renderContract,
  syncToLiveWatcher,
  checkRenderServer,
  getRenderTargetLabel,
  type RenderStatus,
} from './services/cloudRenderService'
import { bakeInkLayer } from './render/bakeInkLayer'
import { buildRenderContract } from './render/buildContract'
import type { RenderContract } from './render/contract'
import { REGISTRY, findById } from './render/registry'
import { migrateScene } from './sceneStorage'
import * as THREE from 'three'

function previewModelForBody(bodyMeshId: string): 'Monk' | 'FinalBaseMesh' {
  return findById(REGISTRY.bodyMeshes, bodyMeshId)?.previewModel ?? 'FinalBaseMesh'
}

const BG_PRESETS = {
  white: { background: '#fff' },
  dark: { background: '#181818' },
  gray: { background: 'linear-gradient(135deg, #444 0%, #888 100%)' },
  bluepurple: { background: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)' },
  peach: { background: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
};

type BgKey = keyof typeof BG_PRESETS;

const LIGHTING_PRESET_LABELS: Record<LightingPresetKey, string> = {
  studio: 'Studio (3-point)',
  softboxLeft: 'Softbox Left',
  softboxRight: 'Softbox Right',
  backlight: 'Backlight',
  dramatic: 'Dramatic',
  sunset: 'Sunset',
};

// Camera presets for different viewing angles
type CameraPresetKey = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'threeQuarter' | 'profile' | 'closeup' | 'wide';

const CAMERA_PRESETS: Record<CameraPresetKey, { position: [number, number, number], target: [number, number, number], fov: number, name: string }> = {
  front: { position: [0, 0, 8], target: [0, 0, 0], fov: 45, name: 'Front View' },
  back: { position: [0, 0, -8], target: [0, 0, 0], fov: 45, name: 'Back View' },
  left: { position: [-8, 0, 0], target: [0, 0, 0], fov: 45, name: 'Left Side' },
  right: { position: [8, 0, 0], target: [0, 0, 0], fov: 45, name: 'Right Side' },
  top: { position: [0, 8, 0], target: [0, 0, 0], fov: 45, name: 'Top Down' },
  bottom: { position: [0, -8, 0], target: [0, 0, 0], fov: 45, name: 'Bottom Up' },
  threeQuarter: { position: [6, 4, 6], target: [0, 0, 0], fov: 45, name: 'Three Quarter' },
  profile: { position: [8, 2, 0], target: [0, 0, 0], fov: 40, name: 'Profile' },
  closeup: { position: [0, 0, 4], target: [0, 0, 0], fov: 60, name: 'Close Up' },
  wide: { position: [0, 0, 12], target: [0, 0, 0], fov: 35, name: 'Wide Shot' },
};

// Export presets for different platforms
const EXPORT_PRESETS = {
  instagram: { width: 1080, height: 1080, name: 'Instagram Square' },
  instagramStory: { width: 1080, height: 1920, name: 'Instagram Story' },
  instagramPortrait: { width: 1080, height: 1350, name: 'Instagram Portrait' },
  twitter: { width: 1200, height: 675, name: 'Twitter/X Post' },
  facebook: { width: 1200, height: 630, name: 'Facebook Post' },
  portfolio: { width: 1920, height: 1080, name: 'Portfolio HD' },
  print: { width: 3000, height: 2000, name: 'Print Quality' },
};

// Component to access Three.js renderer and scene
function ExportRenderer({ onRendererReady }: { onRendererReady: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void }) {
  const { gl, scene, camera } = useThree()
  
  useEffect(() => {
    onRendererReady(gl, scene, camera)
  }, [gl, scene, camera, onRendererReady])
  
  return null
}

function App() {
  const [currentScene, setCurrentScene] = useState<SceneData | null>(null)
  const [showLandingPage, setShowLandingPage] = useState(true)
  const [showLoginPage, setShowLoginPage] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  // Editor state (mirrors SceneData)
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [model, setModel] = useState<'Monk' | 'FinalBaseMesh'>('FinalBaseMesh')
  const [decalRotation, setDecalRotation] = useState(0)
  const [decalScale, setDecalScale] = useState(1)
  const [decalColor, setDecalColor] = useState('#ffffff') // Default white (no tint)
  const [decalOpacity, setDecalOpacity] = useState(1) // Default full opacity
  const [decalVisible, setDecalVisible] = useState(false)
  const [photoMode, setPhotoMode] = useState(false)
  const [background, setBackground] = useState<BgKey>('white')
  const [lightingPreset, setLightingPreset] = useState<LightingPresetKey>('studio')
  const [cameraPreset, setCameraPreset] = useState<CameraPresetKey>('threeQuarter')
  const [decalPosition, setDecalPosition] = useState<[number, number, number] | null>(null)
  const [decalNormal, setDecalNormal] = useState<[number, number, number] | null>(null)
  const [cameraState, setCameraState] = useState<{ position: [number, number, number], target: [number, number, number], fov: number }>(CAMERA_PRESETS.threeQuarter)
  const [performanceMode, setPerformanceMode] = useState(false)
  const [bodyMeshId, setBodyMeshId] = useState('body_full')
  const [skinToneId, setSkinToneId] = useState('tone_03')
  const [poseId, setPoseId] = useState('neutral')
  const [lookId, setLookId] = useState('studio_softbox')
  const [qualityTier, setQualityTier] = useState<'preview' | 'final'>('final')
  const uvPlacementRef = useRef<ModelWithUVTattooHandle>(null)

  // Export state
  const [showExportModal, setShowExportModal] = useState(false)
  const [exportPreset, setExportPreset] = useState('instagram')
  const [watermarkText, setWatermarkText] = useState('SMART INK')
  const [watermarkEnabled, setWatermarkEnabled] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [threeRenderer, setThreeRenderer] = useState<THREE.WebGLRenderer | null>(null)
  const [threeScene, setThreeScene] = useState<THREE.Scene | null>(null)
  const [threeCamera, setThreeCamera] = useState<THREE.Camera | null>(null)
  const [isExportingBlender, setIsExportingBlender] = useState(false)
  const [cloudRenderStatus, setCloudRenderStatus] = useState<RenderStatus>('idle')
  const [cloudRenderMessage, setCloudRenderMessage] = useState('')
  const [cloudRenderImage, setCloudRenderImage] = useState<string | null>(null)
  const [renderServerOnline, setRenderServerOnline] = useState<boolean | null>(null)
  const [liveSyncStatus, setLiveSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [liveSyncMessage, setLiveSyncMessage] = useState('')

  const canvasContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showExportModal) return
    let cancelled = false
    const poll = () => {
      void checkRenderServer().then((ok) => {
        if (!cancelled) setRenderServerOnline(ok)
      })
    }
    poll()
    const interval = window.setInterval(poll, 3000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [showExportModal])

  // Callback for renderer ready
  const handleRendererReady = useCallback((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    setThreeRenderer(renderer)
    setThreeScene(scene)
    setThreeCamera(camera)
  }, [])

  type Shot = { contract: RenderContract; inkBlob: Blob }

  const buildShot = useCallback(async (): Promise<Shot | null> => {
    const placement = uvPlacementRef.current?.getPlacement()
    if (!placement?.hasPlaced) {
      setCloudRenderStatus('error')
      setCloudRenderMessage('Place the tattoo on the mesh first.')
      return null
    }
    if (!uploadedImage) {
      setCloudRenderStatus('error')
      setCloudRenderMessage('Upload a design image first.')
      return null
    }

    const inkBlob = await bakeInkLayer({
      tattooImage: uploadedImage,
      center: placement.center,
      scaleUV: placement.scaleUV,
      rotationRad: placement.rotationRad,
    })

    const canvas = threeRenderer?.domElement
    const aspect = canvas && canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : 1
    const outHeight = Math.max(1, Math.round(2048 / aspect))

    const contract = buildRenderContract(
      { bodyMeshId, skinToneId, poseId, lookId, qualityTier },
      { position: cameraState.position, target: cameraState.target, fov: cameraState.fov, aspect },
      'ink.png',
      { width: 2048, height: outHeight },
    )
    return { contract, inkBlob }
  }, [uploadedImage, bodyMeshId, skinToneId, poseId, lookId, qualityTier, cameraState, threeRenderer])

  const handleLookChange = useCallback((id: string) => {
    setLookId(id)
    const look = findById(REGISTRY.looks, id)
    if (look) {
      setLightingPreset(look.previewLighting)
      setBackground(look.previewBackground as BgKey)
    }
  }, [])

  const loadScene = (scene: SceneData) => {
    const migrated = migrateScene(scene)
    setCurrentScene(migrated)
    setUploadedImage(migrated.decalImage)
    setBodyMeshId(migrated.bodyMeshId!)
    setSkinToneId(migrated.skinToneId!)
    setPoseId(migrated.poseId!)
    setLookId(migrated.lookId!)
    setQualityTier(migrated.qualityTier!)
    setModel(previewModelForBody(migrated.bodyMeshId!))
    const look = findById(REGISTRY.looks, migrated.lookId!)
    if (look) {
      setLightingPreset(look.previewLighting)
      setBackground(look.previewBackground as BgKey)
    }
    setDecalRotation(migrated.decalRotation)
    setDecalScale(migrated.decalScale)
    setDecalColor(migrated.decalColor ?? '#ffffff')
    setDecalOpacity(migrated.decalOpacity ?? 1)
    setDecalPosition(migrated.decalPosition ?? null)
    setDecalNormal(migrated.decalNormal ?? null)
    if (!look) {
      setBackground(migrated.background as BgKey)
      setLightingPreset(migrated.lightingPreset as LightingPresetKey)
    }
    setShowDashboard(false)
    setCameraState(migrated.camera ?? CAMERA_PRESETS.threeQuarter)
  }

  // Save editor state to current scene (except thumbnail)
  useEffect(() => {
    if (!currentScene) return
    const id = setTimeout(() => {
      const updated: SceneData = {
        ...currentScene,
        decalImage: uploadedImage,
        model,
        decalVisible,
        decalRotation,
        decalScale,
        decalColor,
        decalOpacity,
        decalPosition,
        decalNormal,
        background,
        lightingPreset,
        camera: cameraState,
        bodyMeshId,
        skinToneId,
        poseId,
        lookId,
        qualityTier,
        // thumbnail will be updated in a separate effect
      }
      void updateScene(updated).then(() => setCurrentScene(updated))
    }, 250)
    return () => clearTimeout(id)
  }, [uploadedImage, model, decalVisible, decalRotation, decalScale, decalColor, decalOpacity, decalPosition, decalNormal, background, lightingPreset, cameraState, bodyMeshId, skinToneId, poseId, lookId, qualityTier])

  // Capture thumbnail on every change
  useEffect(() => {
    if (!currentScene || !canvasContainerRef.current) return
    // Wait for next paint to ensure canvas is rendered
    const timeout = setTimeout(() => {
      const canvas = canvasContainerRef.current?.querySelector('canvas') as HTMLCanvasElement | null
      if (canvas) {
        try {
          const dataUrl = canvas.toDataURL('image/png')
          // Fallback: treat blank or very small data URLs as failure
          if (dataUrl && dataUrl.length > 100) {
            if (currentScene.thumbnail !== dataUrl) {
              const updated: SceneData = { ...currentScene, thumbnail: dataUrl }
              void updateScene(updated).then(() => setCurrentScene(updated))
            }
          } else {
            // Fallback: blank or failed
            if (currentScene.thumbnail !== null) {
              const updated: SceneData = { ...currentScene, thumbnail: null }
              void updateScene(updated).then(() => setCurrentScene(updated))
            }
          }
        } catch (e) {
          // Fallback: error
          if (currentScene.thumbnail !== null) {
            const updated: SceneData = { ...currentScene, thumbnail: null }
            void updateScene(updated).then(() => setCurrentScene(updated))
          }
        }
      }
    }, 200)
    return () => clearTimeout(timeout)
  }, [currentScene, uploadedImage, model, decalRotation, decalScale, decalColor, decalOpacity, decalPosition, decalNormal, background, lightingPreset, cameraState])

  // Reset decal transform
  const handleResetDecal = () => {
    setDecalRotation(0)
    setDecalScale(1)
    setDecalColor('#ffffff')
    setDecalOpacity(1)
  }

  const handleCameraPresetChange = (preset: CameraPresetKey) => {
    setCameraPreset(preset)
    setCameraState(CAMERA_PRESETS[preset])
  }

  // Export functionality using Three.js renderer
  const exportImage = async () => {
    if (!threeRenderer || !threeScene || !threeCamera || isExporting) return
    
    setIsExporting(true)
    
    let renderTarget: THREE.WebGLRenderTarget | null = null
    const persp = threeCamera as THREE.PerspectiveCamera
    const hadPerspective = persp.isPerspectiveCamera
    const savedAspect = hadPerspective ? persp.aspect : 0
    
    try {
      const preset = EXPORT_PRESETS[exportPreset as keyof typeof EXPORT_PRESETS]
      const { width, height } = preset
      
      renderTarget = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        generateMipmaps: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      })
      
      // Match projection to export aspect (on-screen canvas aspect caused stretch/squash)
      if (hadPerspective) {
        persp.aspect = width / height
        persp.updateProjectionMatrix()
      }
      
      threeRenderer.setRenderTarget(renderTarget)
      threeRenderer.render(threeScene, threeCamera)
      threeRenderer.setRenderTarget(null)
      
      // Read pixels (WebGL origin is bottom-left; canvas is top-left → flip Y)
      const buffer = new Uint8Array(width * height * 4)
      threeRenderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, buffer)
      
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not get canvas context')
      
      const imageData = ctx.createImageData(width, height)
      const dst = imageData.data
      const rowStride = width * 4
      for (let y = 0; y < height; y++) {
        const srcStart = (height - 1 - y) * rowStride
        dst.set(buffer.subarray(srcStart, srcStart + rowStride), y * rowStride)
      }
      ctx.putImageData(imageData, 0, 0)
      
      // Create final canvas with background and watermark
      const finalCanvas = document.createElement('canvas')
      const finalCtx = finalCanvas.getContext('2d')
      if (!finalCtx) throw new Error('Could not get final canvas context')
      
      finalCanvas.width = width
      finalCanvas.height = height
      
      // Set background
      const bgStyle = BG_PRESETS[background]
      if (typeof bgStyle.background === 'string' && bgStyle.background.startsWith('#')) {
        finalCtx.fillStyle = bgStyle.background
        finalCtx.fillRect(0, 0, width, height)
      } else if (bgStyle.background.includes('gradient')) {
        const gradient = finalCtx.createLinearGradient(0, 0, width, height)
        if (bgStyle.background.includes('bluepurple')) {
          gradient.addColorStop(0, '#3a1c71')
          gradient.addColorStop(0.5, '#d76d77')
          gradient.addColorStop(1, '#ffaf7b')
        } else if (bgStyle.background.includes('peach')) {
          gradient.addColorStop(0, '#ffecd2')
          gradient.addColorStop(1, '#fcb69f')
        } else {
          gradient.addColorStop(0, '#444')
          gradient.addColorStop(1, '#888')
        }
        finalCtx.fillStyle = gradient
        finalCtx.fillRect(0, 0, width, height)
      }
      
      // Draw the rendered 3D content
      finalCtx.drawImage(canvas, 0, 0, width, height)
      
      // Add watermark if enabled
      if (watermarkEnabled && watermarkText) {
        finalCtx.save()
        finalCtx.globalAlpha = 0.3
        finalCtx.fillStyle = '#ffffff'
        finalCtx.font = `bold ${Math.max(24, width / 30)}px Arial, sans-serif`
        finalCtx.textAlign = 'center'
        finalCtx.textBaseline = 'bottom'
        finalCtx.fillText(watermarkText, width / 2, height - 20)
        finalCtx.restore()
      }
      
      // Convert to blob and download
      finalCanvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `smart-ink-${exportPreset}-${Date.now()}.png`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          URL.revokeObjectURL(url)
        }
        setIsExporting(false)
      }, 'image/png', 1.0)
    } catch (error) {
      console.error('Export failed:', error)
      setIsExporting(false)
    } finally {
      threeRenderer.setRenderTarget(null)
      if (hadPerspective) {
        persp.aspect = savedAspect
        persp.updateProjectionMatrix()
      }
      renderTarget?.dispose()
    }
  }

  const exportForBlender = async () => {
    setIsExportingBlender(true)
    try {
      const shot = await buildShot()
      if (!shot) return
      await downloadFiles([
        { filename: 'ink.png', blob: shot.inkBlob },
        { filename: 'contract.json', blob: new Blob([JSON.stringify(shot.contract, null, 2)], { type: 'application/json' }) },
      ])
    } catch (e) {
      console.error('Export failed:', e)
    } finally {
      setIsExportingBlender(false)
    }
  }

  const handleSyncToBlender = async () => {
    setLiveSyncStatus('syncing')
    setLiveSyncMessage('Pushing shot to Blender watcher…')
    try {
      const shot = await buildShot()
      if (!shot) {
        setLiveSyncStatus('error')
        setLiveSyncMessage('Place a tattoo and upload a design first.')
        return
      }
      await syncToLiveWatcher(shot.contract, shot.inkBlob)
      setLiveSyncStatus('done')
      setLiveSyncMessage('Synced — open Blender with watch_dev.py; scene refreshes in ~1s.')
    } catch (e) {
      console.error('Live sync failed:', e)
      setLiveSyncStatus('error')
      setLiveSyncMessage(e instanceof Error ? e.message : 'Sync failed')
    }
  }

  const handleCloudRender = async () => {
    setCloudRenderStatus('uploading')
    setCloudRenderMessage('Preparing scene...')
    setCloudRenderImage(null)

    const onStatusChange = (status: RenderStatus, message?: string) => {
      setCloudRenderStatus(status)
      setCloudRenderMessage(message || '')
    }

    try {
      const shot = await buildShot()
      if (!shot) return
      const imageUrl = await renderContract(shot.contract, shot.inkBlob, { onStatusChange })
      setCloudRenderImage(imageUrl)
    } catch (e) {
      console.error('Render failed:', e)
      setCloudRenderStatus('error')
      setCloudRenderMessage(e instanceof Error ? e.message : 'Unknown error')
    }
  }

  // Exit photo mode on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPhotoMode(false)
        setShowExportModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  if (showLandingPage) {
    return (
      <LandingPage
        onNavigateToApp={() => {
          setShowLandingPage(false)
          setShowLoginPage(true)
        }}
      />
    )
  }

  if (showLoginPage) {
    return (
      <LoginPage
        onNavigateToApp={() => {
          setShowLoginPage(false)
          setShowDashboard(true)
        }}
        onBackToLanding={() => {
          setShowLoginPage(false)
          setShowLandingPage(true)
        }}
      />
    )
  }

  if (showDashboard) {
    return (
      <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
        <ScenesDashboard
          onSelectScene={loadScene}
          onOpenLanding={() => {
            setShowDashboard(false)
            setShowLandingPage(true)
          }}
        />
      </div>
    )
  }

  return (
    <div className="editor-app-root" ref={canvasContainerRef}>
      <header className="editor-toolbar editor-toolbar--main">
        <div className="editor-toolbar-brand" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="nav-logo nav-logo--sm" aria-hidden />
          Smart Ink
        </div>
        <div className="editor-toolbar-center" aria-hidden>
          <span className="editor-toolbar-spacer" />
        </div>
        <div className="editor-toolbar-actions editor-toolbar-actions--spread">
          <button
            type="button"
            className="tool-btn tool-btn--ghost"
            title="Share"
            onClick={() => {}}
          >
            Share
          </button>
          <button type="button" className="tool-btn tool-btn--ghost" onClick={() => setShowExportModal(true)}>
            Export
          </button>
          <button type="button" className="tool-btn-nav tool-btn-nav--purple" onClick={() => setShowLandingPage(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
            </svg>
            Home
          </button>
          <button type="button" className="tool-btn-nav tool-btn-nav--muted" onClick={() => setShowDashboard(true)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
            </svg>
            Scenes
          </button>
          <div className="editor-toolbar-avatar" aria-hidden>
            S
          </div>
        </div>
      </header>

      <div className="editor-body-row">
        <EditorLeftPanel
          sceneName={currentScene?.name ?? 'Untitled'}
          model={model}
          onBack={() => setShowDashboard(true)}
        />

        <div className="editor-canvas-host">
          <div
            className="editor-canvas-bg"
            style={{
              ...(BG_PRESETS[background] || BG_PRESETS.white),
              transition: 'background 0.4s',
            }}
          />
          <div className="editor-canvas-inner">
            <Canvas
              className="editor-r3f-canvas"
              camera={{ position: cameraState.position, fov: cameraState.fov }}
              shadows={!performanceMode}
              dpr={performanceMode ? 0.7 : window.devicePixelRatio}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
            >
        <ExportRenderer onRendererReady={handleRendererReady} />
        <CinematicLights key={lightingPreset} preset={lightingPreset} performanceMode={performanceMode} />
        <ModelWithUVTattoo
          ref={uvPlacementRef}
          key={`uv-${model}`}
          uploadedImage={uploadedImage}
          model={model}
          decalRotation={decalRotation}
          decalScale={decalScale}
          decalColor={decalColor}
          decalOpacity={decalOpacity}
          setDecalVisible={setDecalVisible}
          showSafeZone={true}
        />
        <OrbitControlsWithCmdLock
          cameraState={cameraState}
          setCameraState={setCameraState}
        />
            </Canvas>
          </div>
        </div>

        <TopMenuBar
          setUploadedImage={setUploadedImage}
          uploadedImage={uploadedImage}
          onModelSelect={(m) => setModel(m as 'Monk' | 'FinalBaseMesh')}
          currentModel={model}
          decalVisible={decalVisible}
          decalRotation={decalRotation}
          decalScale={decalScale}
          decalColor={decalColor}
          decalOpacity={decalOpacity}
          onDecalRotationChange={setDecalRotation}
          onDecalScaleChange={setDecalScale}
          onDecalColorChange={setDecalColor}
          onDecalOpacityChange={setDecalOpacity}
          onDecalVisibleChange={setDecalVisible}
          onDecalReset={handleResetDecal}
          photoMode={photoMode}
          setPhotoMode={setPhotoMode}
          background={background}
          setBackground={(bg) => setBackground(bg as BgKey)}
          lightingPreset={lightingPreset}
          setLightingPreset={(preset) => setLightingPreset(preset as LightingPresetKey)}
          LIGHTING_PRESETS={LIGHTING_PRESET_LABELS}
          cameraPreset={cameraPreset}
          onCameraPresetChange={(preset) => handleCameraPresetChange(preset as CameraPresetKey)}
          CAMERA_PRESETS={CAMERA_PRESETS}
          performanceMode={performanceMode}
          setPerformanceMode={setPerformanceMode}
          onExport={() => setShowExportModal(true)}
          lookId={lookId}
          onLookChange={handleLookChange}
          LOOKS={REGISTRY.looks}
        />
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay" role="dialog" aria-labelledby="export-title">
          <div className="modal-card">
            <h2 id="export-title">Export image</h2>
            <label className="modal-label" htmlFor="export-preset">
              Format
            </label>
            <select
              id="export-preset"
              className="modal-select"
              value={exportPreset}
              onChange={(e) => setExportPreset(e.target.value)}
            >
              {Object.entries(EXPORT_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.name} ({preset.width}×{preset.height})
                </option>
              ))}
            </select>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)', fontSize: '0.9rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  id="watermark-enabled"
                  checked={watermarkEnabled}
                  onChange={(e) => setWatermarkEnabled(e.target.checked)}
                />
                Add watermark
              </label>
              {watermarkEnabled && (
                <input
                  type="text"
                  className="modal-input"
                  style={{ marginTop: 10, marginBottom: 0 }}
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="Watermark text"
                />
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-modal-cancel" onClick={() => setShowExportModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-modal-primary"
                onClick={exportImage}
                disabled={isExporting || !threeRenderer || !threeScene || !threeCamera}
              >
                {isExporting ? 'Exporting…' : !threeRenderer || !threeScene || !threeCamera ? 'Loading…' : 'Export'}
              </button>
            </div>

            <div className="modal-blender-divider" />
            <h3 className="modal-blender-title">Export for Blender</h3>
            <p className="modal-blender-desc">
              Download scene data and the Blender script to render this view in Blender (Cycles) for high-quality output.
            </p>
            <div className="modal-blender-actions">
              <button
                type="button"
                className="btn-modal-blender"
                onClick={exportForBlender}
                disabled={isExportingBlender}
              >
                {isExportingBlender ? 'Exporting…' : 'Download for Blender'}
              </button>
              <a
                href="/blender-scripts/sceneImporter.py"
                className="btn-modal-blender btn-modal-blender--secondary"
                download="sceneImporter.py"
              >
                Download Blender script
              </a>
            </div>
            <p className="modal-blender-hint">
              Place <code>contract.json</code>, <code>ink.png</code>, and your body mesh in one folder, then run:{' '}
              <code>blender --background --python sceneImporter.py -- contract.json</code>
            </p>

            {getRenderTargetLabel() === 'local' && (
              <>
                <div className="modal-blender-divider" />
                <h3 className="modal-blender-title">Live Blender preview</h3>
                <p className="modal-blender-desc">
                  Push <code>contract.json</code> + <code>ink.png</code> to{' '}
                  <code>~/smartink-live/</code> for <code>watch_dev.py</code> — no Cycles render, scene rebuilds in the GUI in ~1s.
                </p>
                <div className="modal-blender-actions">
                  <button
                    type="button"
                    className="btn-modal-blender"
                    onClick={handleSyncToBlender}
                    disabled={liveSyncStatus === 'syncing' || renderServerOnline === false}
                  >
                    {liveSyncStatus === 'syncing'
                      ? 'Syncing…'
                      : liveSyncStatus === 'done'
                        ? 'Sync again'
                        : 'Preview in Blender'}
                  </button>
                </div>
                {liveSyncStatus === 'error' && (
                  <p style={{ color: 'var(--red-500, #ef4444)', fontSize: '13px', marginTop: '8px' }}>
                    {liveSyncMessage}
                  </p>
                )}
                {liveSyncStatus === 'done' && (
                  <p style={{ color: 'var(--accent-green, #22c55e)', fontSize: '13px', marginTop: '8px' }}>
                    {liveSyncMessage}
                  </p>
                )}
                {renderServerOnline === false && (
                  <p className="modal-blender-hint" style={{ marginTop: '8px' }}>
                    Start the local server: <code>npm run render-server</code>
                  </p>
                )}
              </>
            )}

            <div className="modal-blender-divider" />
            <h3 className="modal-blender-title">Cloud Render (Cycles)</h3>
            <p className="modal-blender-desc">
              Render this scene with Blender Cycles ({getRenderTargetLabel()} server). Returns a photorealistic image in 15-60 seconds.
            </p>
            {renderServerOnline !== null && (
              <p style={{ fontSize: '13px', marginBottom: '8px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    marginRight: 6,
                    background: renderServerOnline ? '#22c55e' : '#ef4444',
                  }}
                />
                Render server: {getRenderTargetLabel()} — {renderServerOnline ? 'online' : 'offline'}
              </p>
            )}
            <div className="modal-blender-actions">
              <button
                type="button"
                className="btn-modal-blender"
                onClick={handleCloudRender}
                disabled={cloudRenderStatus === 'uploading' || cloudRenderStatus === 'rendering'}
              >
                {cloudRenderStatus === 'uploading' || cloudRenderStatus === 'rendering'
                  ? cloudRenderMessage || 'Rendering...'
                  : cloudRenderStatus === 'done'
                    ? 'Render Again'
                    : 'Render in Cloud'}
              </button>
              {cloudRenderImage && (
                <a
                  href={cloudRenderImage}
                  download={`smart-ink-render-${Date.now()}.png`}
                  className="btn-modal-blender btn-modal-blender--secondary"
                >
                  Download Render
                </a>
              )}
            </div>
            {cloudRenderStatus === 'error' && (
              <p style={{ color: 'var(--red-500, #ef4444)', fontSize: '13px', marginTop: '8px' }}>
                {cloudRenderMessage}
              </p>
            )}
            {cloudRenderImage && (
              <div
                style={{
                  marginTop: '12px',
                  borderRadius: '8px',
                  overflow: 'hidden',
                  border: '1px solid var(--border-color, #333)',
                }}
              >
                <img
                  src={cloudRenderImage}
                  alt="Cycles render"
                  style={{ width: '100%', display: 'block' }}
                />
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  )
}

export default App
