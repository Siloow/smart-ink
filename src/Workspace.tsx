import MeasurementOverlay from './measurements/MeasurementOverlay'
import MeasurementScene from './measurements/MeasurementScene'
import { loadFitAsset, fitBody } from './measurements/service'
import type { BodyFit, FitAsset } from './measurements/fitter'
import { MEASURE_STEPS, type MeasureStep } from './measurements/steps'
import type { CameraView } from './render/cameraTransition'
import { usesRunpodGateway } from './services/cloudRenderService'
import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, Suspense } from 'react'
import type { CSSProperties } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import ErrorBoundary from './ErrorBoundary'
import CrashScreen from './CrashScreen'
// import { OrbitControls } from '@react-three/drei'
import OrbitControlsWithCmdLock, { type OrbitControlsHandle } from './OrbitControlsWithCmdLock'
import ModelWithUVTattoo, { type ModelWithUVTattooHandle } from './ModelWithUVTattoo'
import CinematicLights from './CinematicLights'
import LightHandles from './LightHandles'
import StudioBackdrop from './StudioBackdrop'
import { DEFAULT_STUDIO, normalizeStudio, studioForExport, type StudioSettings } from './render/studioSettings'
import TopMenuBar, { type InspectorTab } from './TopMenuBar'
import EditorOutputMenu from './EditorOutputMenu'
import ViewportControls from './ViewportControls'
import { FaUndo, FaRedo } from 'react-icons/fa'
import { useEditorHistory } from './hooks/useEditorHistory'
import { bindEditorHistory } from './services/editorHistoryBindings'
import SnapshotOverlay from './SnapshotOverlay'
import SnapshotCameraControls from './SnapshotCameraControls'
import SnapshotPresets from './SnapshotPresets'
import { cinematicPreset, cinematicLights, type CinematicPresetId } from './render/cinematicPresets'
import LightingControls from './LightingControls'
import { DEFAULT_TATTOO_CAMERA_ADJUSTMENT, frameTattoo, regionSnapshotFraming, type TattooFraming, type TattooCameraAdjustment } from './render/tattooCamera'
import { resolveTattooSource } from './render/tattooSource'
import { createSnapshotSession } from './services/snapshotSession'
import { snapshotOutput, type SnapshotQuality } from './render/snapshot'
import ScenesDashboard from './ScenesDashboard'
import EditorLeftPanel from './EditorLeftPanel'
import type { SceneData } from './types'
import { updateScene } from './sceneStorage'
import { downloadFiles, downloadBlob } from './utils/sceneExporter'
import { BACKGROUNDS, EXPORT_PRESETS, exportDimensions, paintExportBackground, withoutEditorHelpers, canvasPng, blankInkLayer, frameRegionCamera, type BackgroundId, type ExportPreset } from './render/exportPresentation'
import { createSceneSaveQueue } from './storage/sceneSaveQueue'
import { LIGHTING_PRESETS, resolveRig, type LightingPresetKey, type LightDefinition } from './config/lightingPresets'
import {
  renderContract,
  syncToLiveWatcher,
  getRenderServerStatus,
  type RenderServerStatus,
  getRenderTargetLabel,
  type RenderStatus,
} from './services/cloudRenderService'
import { bakeInkLayer } from './render/bakeInkLayer'
import { buildRenderContract } from './render/buildContract'
import type { RenderContract } from './render/contract'
import { FINAL_SAMPLES, REGISTRY, findById } from './render/registry'
import { migrateScene } from './sceneStorage'
import { addRenderHistory } from './renderHistoryStorage'
import RenderHistoryModal from './RenderHistoryModal'
import { captureThumbnail } from './storage/dataUrl'
import { DEFAULT_BODY_POSE, normalizePose, poseFromPreset, BODY_POSE_PRESETS, type BodyPose } from './render/bodyPose'
import { levelFocusDirection } from './render/focusCamera'
import { DEFAULT_BODY_APPEARANCE, normalizeAppearance, type BodyAppearance } from './render/bodyAppearance'
import { DEFAULT_BODY_SHAPE, normalizeShape, clampShapeValue, type BodyShapeKey, type BodyShape } from './render/bodyShape'
import { type BodyRegionId } from './render/bodyRegions'
import RadialShapeMenu from './RadialShapeMenu'
import type { RegionFraming } from './ModelWithUVTattoo'
import type { SurfaceAnchor } from './render/surfacePlacement'
import * as THREE from 'three'
import type { BetaSession } from './auth/types'

type BgKey = BackgroundId;

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
// OrbitControls owns camera changes; a changing Canvas camera prop would snap
// to the destination before the view transition can read its starting point.
const INITIAL_CANVAS_CAMERA = { position: [6, 4, 6] as [number, number, number], fov: 45 };

// Component to access Three.js renderer and scene
function ExportRenderer({ onRendererReady }: { onRendererReady: (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void }) {
  const { gl, scene, camera } = useThree()
  useEffect(() => {
    onRendererReady(gl, scene, camera)
  }, [gl, scene, camera, onRendererReady])
  
  return null
}

/**
 * Rendered as a Suspense fallback *inside* the R3F tree while the body mesh
 * loads. It draws nothing; it only flips a flag so the DOM can show a label.
 *
 * Do not move the Suspense boundary outside <Canvas>: R3F propagates
 * suspension to a DOM-level boundary by re-suspending the Canvas component,
 * and that hide/reveal cycle lost the WebGL context here (blank viewport with
 * Chrome's sad-face icon, "THREE.WebGLRenderer: Context Lost").
 */
function LoadingSignal({ onChange }: { onChange: (loading: boolean) => void }) {
  useEffect(() => {
    onChange(true)
    return () => onChange(false)
  }, [onChange])
  return null
}

interface WorkspaceProps {
  session: BetaSession
  /** Leave the workspace for the landing page. */
  onHome: () => void
  /** `everywhere` also revokes the account's sessions on other devices. */
  onSignOut: (opts?: { everywhere?: boolean }) => void
}

/**
 * Everything behind the beta gate: the scene list and the editor. App loads
 * this lazily so the landing and login pages never pay for three.js, drei,
 * or the storage layers.
 */
/** Fills the slider track up to the current sample count. */
function sampleTrackStyle(samples: number): CSSProperties {
  const pct =
    ((samples - FINAL_SAMPLES.min) / (FINAL_SAMPLES.max - FINAL_SAMPLES.min)) * 100;
  return {
    background: `linear-gradient(90deg,
      var(--shape-fill) 0%, var(--shape-fill) ${pct}%,
      var(--shape-track) ${pct}%, var(--shape-track) 100%)`,
  };
}

export default function Workspace({ session, onHome, onSignOut }: WorkspaceProps) {
  const [currentScene, setCurrentScene] = useState<SceneData | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('tattoo')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showDashboard, setShowDashboard] = useState(true)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [sceneSaves] = useState(() => createSceneSaveQueue<SceneData>(updateScene))
  const [saveState, setSaveState] = useState(() => sceneSaves.getState())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigating = useRef(false)
  useEffect(() => sceneSaves.subscribe(() => setSaveState(sceneSaves.getState())), [sceneSaves])
  const stageScene = useCallback((updated: SceneData) => {
    const snapshot = { ...updated, updatedAt: new Date() }
    setCurrentScene((prev) => prev?.id === snapshot.id ? snapshot : prev)
    sceneSaves.stage(snapshot)
  }, [sceneSaves])
  const flushPendingSave = useCallback(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    saveTimer.current = null
    return sceneSaves.flush()
  }, [sceneSaves])
  const afterSaving = useCallback((action: () => void) => {
    if (navigating.current) return
    navigating.current = true
    void (async () => {
      do { await flushPendingSave() } while (sceneSaves.hasPending())
      action()
    })().catch(() => {}).finally(() => { navigating.current = false })
  }, [flushPendingSave, sceneSaves])
  useEffect(() => {
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (sceneSaves.hasPending()) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warnUnsaved)
    return () => {
      window.removeEventListener('beforeunload', warnUnsaved)
      void flushPendingSave().catch(() => {})
    }
  }, [flushPendingSave, sceneSaves])

  // Editor state (mirrors SceneData)
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [decalRotation, setDecalRotation] = useState(0)
  const [decalScale, setDecalScale] = useState(1)
  const [decalColor, setDecalColor] = useState('#ffffff') // Default white (no tint)
  const [decalOpacity, setDecalOpacity] = useState(1) // Default full opacity
  const [decalVisible, setDecalVisible] = useState(false)
  const [surfacePlacement, setSurfacePlacement] = useState<SurfaceAnchor | null>(null)
  const [placementStatus, setPlacementStatus] = useState('Click the skin to place. Drag to orbit. Hold ⌘ / Ctrl and drag to move the tattoo.')
  const [photoMode, setPhotoMode] = useState(false)
  const [background, setBackground] = useState<BgKey>('white')
  const [studio, setStudio] = useState<StudioSettings>(() => ({ ...DEFAULT_STUDIO }))
  const [lightingPreset, setLightingPreset] = useState<LightingPresetKey>('studio')
  const [lights, setLights] = useState<LightDefinition[]>(() => resolveRig('studio'))
  const [selectedLight, setSelectedLight] = useState<number | null>(null)
  const [cameraPreset, setCameraPreset] = useState<CameraPresetKey | 'custom'>('threeQuarter')
  const [decalPosition, setDecalPosition] = useState<[number, number, number] | null>(null)
  const [decalNormal, setDecalNormal] = useState<[number, number, number] | null>(null)
  const [cameraState, setCameraState] = useState<{ position: [number, number, number], target: [number, number, number], fov: number }>(CAMERA_PRESETS.threeQuarter)
  const [cameraRequestId, setCameraRequestId] = useState(0)
  const [showPlacementTips, setShowPlacementTips] = useState(() => {
    try { return localStorage.getItem('smartink:placement-tips') !== 'hidden' }
    catch { return true }
  })
  const togglePlacementTips = (visible: boolean) => {
    setShowPlacementTips(visible)
    try { localStorage.setItem('smartink:placement-tips', visible ? 'shown' : 'hidden') }
    catch { /* The toggle still works when browser storage is unavailable. */ }
  }
  const [performanceMode, setPerformanceMode] = useState(false)
  const [modelLoading, setModelLoading] = useState(false)
  /** False until the viewport container has a real size; see the effect below. */
  const [canvasHostSized, setCanvasHostSized] = useState(false)
  const [viewportAspect, setViewportAspect] = useState(1)
  const [bodyMeshId, setBodyMeshId] = useState('body_full')
  const [skinToneId, setSkinToneId] = useState('tone_03')
  const [poseId, setPoseId] = useState('neutral')
  const [bodyPose, setBodyPose] = useState<BodyPose>(() => ({ ...DEFAULT_BODY_POSE }))
  const [bodyAppearance, setBodyAppearance] = useState<BodyAppearance>(() => ({ ...DEFAULT_BODY_APPEARANCE }))
  const handlePosePreset = useCallback((id: string) => {
    setPoseId(id)
    setBodyPose(poseFromPreset(id))
  }, [])
  const handleBodyPoseChange = useCallback((pose: BodyPose) => {
    const next = normalizePose(pose)
    setBodyPose(next)
    const preset = BODY_POSE_PRESETS.find((p) => {
      const target = poseFromPreset(p.id)
      return Object.keys(next).every((key) => Math.abs(next[key as keyof BodyPose] - target[key as keyof BodyPose]) < 0.001)
    })
    setPoseId(preset?.id ?? 'custom')
  }, [])
  const [bodyFit, setBodyFit] = useState<BodyFit | null>(null)
  const [measureOpen, setMeasureOpen] = useState(false)
  const [measureLoading, setMeasureLoading] = useState(false)
  const [measureAsset, setMeasureAsset] = useState<FitAsset | null>(null)
  const [measureError, setMeasureError] = useState('')
  const [measureStep, setMeasureStep] = useState<MeasureStep | null>(MEASURE_STEPS[0])
  const measureReturnCamera = useRef<CameraView | null>(null)
  const [bodyShape, setBodyShape] = useState<BodyShape>(() => ({ ...DEFAULT_BODY_SHAPE }))
  /** Body part cut out of the viewport, or null for the whole figure. */
  const [isolateRegion, setIsolateRegion] = useState<BodyRegionId | null>(null)
  /** Regions affected by the active inspector control. */
  const [panelRegions, setPanelRegions] = useState<BodyRegionId[]>([])
  const [shapeMenu, setShapeMenu] = useState<{
    region: BodyRegionId
    x: number
    y: number
    pointerId: number
  } | null>(null)

  // Highlight only when a shape control explains what it affects. Passive
  // mesh hover should preserve the skin and tattoo appearance.
  const highlightRegions: BodyRegionId[] = shapeMenu
    ? [shapeMenu.region]
    : panelRegions

  const handleRegionPress = useCallback(
    (region: BodyRegionId, x: number, y: number, pointerId: number) => {
      setShapeMenu({ region, x, y, pointerId })
    },
    []
  )

  const handleShapeValueChange = useCallback((key: BodyShapeKey, value: number) => {
    if (bodyFit) return
    setBodyShape((prev) => ({ ...prev, [key]: clampShapeValue(key, value) }))
  }, [bodyFit])

  const handleFrameRegion = useCallback((framing: RegionFraming | null) => {
    if (!framing) return
    const rect = canvasHostRef.current?.getBoundingClientRect()
    const aspect = rect && rect.height > 0 ? rect.width / rect.height : 1
    const actual = orbitControlsRef.current?.getSnapshot()
    setCameraState((prev) => {
      const from = actual ?? prev
      const direction = from.position.map((n, i) => n - from.target[i]) as [number, number, number]
      return frameRegionCamera(framing, levelFocusDirection(direction), 45, aspect)
    })
    setCameraRequestId((id) => id + 1)
    setCameraPreset('custom')
  }, [])
  const [lookId, setLookId] = useState('studio_softbox')
  const [qualityTier, setQualityTier] = useState<'preview' | 'final'>('preview')
  const [finalSamples, setFinalSamples] = useState<number>(FINAL_SAMPLES.default)
  const uvPlacementRef = useRef<ModelWithUVTattooHandle>(null)
  const orbitControlsRef = useRef<OrbitControlsHandle>(null)

  // Export state
  const [showExportModal, setShowExportModal] = useState(false)
  const [showRenderHistory, setShowRenderHistory] = useState(false)
  const [exportPreset, setExportPreset] = useState<ExportPreset>('instagram')
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
  const [renderServer, setRenderServer] = useState<RenderServerStatus | null>(null)
  const renderServerOnline = renderServer?.online ?? null
  const [exportError, setExportError] = useState('')
  const [historyWarning, setHistoryWarning] = useState('')
  const [renderElapsed, setRenderElapsed] = useState(0)
  const renderController = useRef<AbortController | null>(null)
  const [snapshotSession] = useState(() => createSnapshotSession({
    render: renderContract,
    retain: async (shot, imageUrl) => {
      if (usesRunpodGateway()) return // Gateway already persisted this render.
      const image = await fetch(imageUrl).then((response) => response.blob())
      await addRenderHistory({ source: 'cycles', width: shot.contract.output.width,
        height: shot.contract.output.height, qualityTier: shot.contract.output.qualityTier,
        lookId: shot.contract.lookId, sceneName: shot.sceneName }, image)
    },
  }))
  const snapshot = useSyncExternalStore(snapshotSession.subscribe, snapshotSession.getState)
  const [snapshotElapsed, setSnapshotElapsed] = useState(0)
  const [tattooFraming, setTattooFraming] = useState<TattooFraming | null>(null)
  const [snapshotHasTattoo, setSnapshotHasTattoo] = useState(false)
  const [snapshotFramingHint, setSnapshotFramingHint] = useState('')
  const [snapshotCamera, setSnapshotCamera] = useState<TattooCameraAdjustment>(() => ({ ...DEFAULT_TATTOO_CAMERA_ADJUSTMENT }))
  const [snapshotLook, setSnapshotLook] = useState<CinematicPresetId | null>(null)
  const snapshotReturnCamera = useRef<{ position: [number, number, number]; target: [number, number, number]; fov: number } | null>(null)
  const closeSnapshot = useCallback(() => {
    const restore = snapshotReturnCamera.current
    snapshotReturnCamera.current = null
    snapshotSession.close()
    if (restore) {
      setCameraState(restore)
      setCameraRequestId((value) => value + 1)
      setCameraPreset('custom')
    }
  }, [snapshotSession])
  // Composition controls are the only camera input in Snapshot: the target
  // stays on the posed tattoo, and window resizing refits the same footprint.
  useEffect(() => {
    if (!snapshot.open || snapshot.mode !== 'compose' || !tattooFraming) return
    setCameraState(frameTattoo(tattooFraming, snapshotCamera, viewportAspect, cinematicPreset(snapshotLook)?.fov))
    setCameraRequestId((value) => value + 1)
    setCameraPreset('custom')
  }, [snapshot.open, snapshot.mode, tattooFraming, snapshotCamera, viewportAspect, snapshotLook])
  const snapshotBusy = snapshot.status === 'uploading' || snapshot.status === 'rendering'
  useEffect(() => {
    if (!snapshotBusy) { if (snapshot.mode === 'compose') setSnapshotElapsed(0); return }
    const tick = () => setSnapshotElapsed(Math.max(0, Math.floor((Date.now() - snapshot.startedAt) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [snapshotBusy, snapshot.startedAt, snapshot.mode])
  useEffect(() => {
    if (showDashboard) snapshotSession.close()
    return () => snapshotSession.close()
  }, [snapshotSession, showDashboard, currentScene?.id])
  const [liveSyncStatus, setLiveSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [liveSyncMessage, setLiveSyncMessage] = useState('')

  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const canvasHostRef = useRef<HTMLDivElement>(null)
  const frameMeasurement = useCallback((next: CameraView) => { setCameraState(next); setCameraRequestId(id => id + 1) }, [])
  const closeMeasurement = useCallback(() => {
    setMeasureOpen(false)
    if (measureReturnCamera.current) { setCameraState(measureReturnCamera.current); setCameraRequestId(id => id + 1) }
    measureReturnCamera.current = null
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[aria-label="Body measurements"] button')?.focus())
  }, [])
  const openMeasurement = async () => {
    if (modelLoading || measureLoading || snapshot.open) return
    setMeasureLoading(true); setMeasureError('')
    try {
      const asset = await loadFitAsset(bodyMeshId)
      setMeasureAsset(asset); setMeasureStep(MEASURE_STEPS[0]); setShapeMenu(null); setPanelRegions([])
      measureReturnCamera.current = orbitControlsRef.current?.freezeSnapshot(true) ?? cameraState
      setMeasureOpen(true)
    } catch (error) { setMeasureError(error instanceof Error ? error.message : 'The measurement guide could not load.') }
    finally { setMeasureLoading(false) }
  }


  useEffect(() => {
    if (!showExportModal) return
    let cancelled = false
    const poll = () => {
      void getRenderServerStatus().then((status) => {
        if (!cancelled) setRenderServer(status)
      })
    }
    poll()
    const interval = window.setInterval(poll, 3000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [showExportModal])

  // History includes editable scene content, independently of camera movement,
  // panel navigation, rendering and Focus. Image strings are shared by entries.
  const editValue = useMemo(() => ({ uploadedImage, decalRotation, decalScale, decalColor,
    decalOpacity, decalVisible, surfacePlacement, decalPosition, decalNormal, bodyMeshId,
    skinToneId, bodyShape, bodyFit, bodyPose, poseId, bodyAppearance, studio, background, lightingPreset, lights, lookId }),
  [uploadedImage, decalRotation, decalScale, decalColor, decalOpacity, decalVisible, surfacePlacement,
    decalPosition, decalNormal, bodyMeshId, skinToneId, bodyShape, bodyFit, bodyPose, poseId, bodyAppearance,
    studio, background, lightingPreset, lights, lookId])
  const restoreEdits = useCallback((value: typeof editValue) => {
    setUploadedImage(value.uploadedImage)
    setDecalRotation(value.decalRotation); setDecalScale(value.decalScale)
    setDecalColor(value.decalColor); setDecalOpacity(value.decalOpacity); setDecalVisible(value.decalVisible)
    setSurfacePlacement(value.surfacePlacement); setDecalPosition(value.decalPosition); setDecalNormal(value.decalNormal)
    setBodyMeshId(value.bodyMeshId); setSkinToneId(value.skinToneId)
    setBodyFit(value.bodyFit); setBodyShape(value.bodyShape); setBodyPose(value.bodyPose); setPoseId(value.poseId)
    setBodyAppearance(value.bodyAppearance); setStudio(value.studio); setBackground(value.background)
    setLightingPreset(value.lightingPreset); setLights(value.lights); setLookId(value.lookId)
    setShapeMenu(null); setPanelRegions([]); setSelectedLight(null)
    setPlacementStatus(value.surfacePlacement ? 'Placement restored. Click the skin to move it, or hold ⌘ / Ctrl and drag.' : 'Click the skin to place. Drag to orbit. Hold ⌘ / Ctrl and drag to move the tattoo.')
  }, [])
  const editHistory = useEditorHistory({ value: editValue, onRestore: restoreEdits,
    scopeId: currentScene?.id, enabled: Boolean(currentScene) && !showDashboard })
  const historyBlocked = measureOpen || showDashboard || snapshot.open || showExportModal || showRenderHistory || modelLoading
  const historyCommands = useRef({ ...editHistory, blocked: historyBlocked, gesturesBlocked: measureOpen || showDashboard || modelLoading })
  historyCommands.current = { ...editHistory, blocked: historyBlocked, gesturesBlocked: measureOpen || showDashboard || modelLoading }
  useEffect(() => {
    const root = canvasContainerRef.current
    if (!root || showDashboard) return
    return bindEditorHistory(root, window, () => historyCommands.current)
  }, [showDashboard])

  // Callback for renderer ready
  const handleRendererReady = useCallback((renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => {
    setThreeRenderer(renderer)
    setThreeScene(scene)
    setThreeCamera(camera)
  }, [])

  type Shot = { contract: RenderContract; inkBlob: Blob }

  const buildShot = useCallback(async (options?: { snapshot?: SnapshotQuality; signal?: AbortSignal }): Promise<Shot> => {
    options?.signal?.throwIfAborted()
    if (options?.snapshot && (modelLoading || !uvPlacementRef.current?.getRegionFraming())) {
      throw new Error('Wait for the figure to finish loading before taking a snapshot.')
    }
    const placement = uvPlacementRef.current?.getPlacement()
    if (decalVisible && placement?.imageReady === false) {
      throw new Error('Wait for the design to finish loading before rendering.')
    }
    const snap = (options?.snapshot ? orbitControlsRef.current?.freezeSnapshot(true) : orbitControlsRef.current?.getSnapshot()) ?? {
      position: cameraState.position, target: cameraState.target, fov: cameraState.fov,
      aspect: canvasHostRef.current ? canvasHostRef.current.clientWidth / Math.max(1, canvasHostRef.current.clientHeight) : 1,
    }
    const dims = options?.snapshot ? snapshotOutput(snap.aspect, options.snapshot) : exportDimensions(exportPreset, qualityTier)
    const contract = buildRenderContract(
      { bodyMeshId, skinToneId, poseId, lookId, qualityTier: options?.snapshot ? 'final' : qualityTier, finalSamples: options?.snapshot ? snapshotOutput(snap.aspect, options.snapshot).samples : finalSamples, bodyShape, bodyFit, bodyPose, bodyAppearance, studio: studioForExport(studio, BACKGROUNDS[background].stops[0], BACKGROUNDS[background].stops), bodyRegion: isolateRegion },
      { position: snap.position, target: snap.target, fov: snap.fov, aspect: options?.snapshot ? snap.aspect : dims.width / dims.height },
      'ink.png', dims,
      { presetName: lightingPreset, intensityScale: LIGHTING_PRESETS[lightingPreset].threeIntensityScale, lights: structuredClone(lights) },
    )
    const cinematic = options?.snapshot ? cinematicPreset(snapshotLook) : undefined
    if (cinematic) {
      contract.camera.aperture = cinematic.aperture
      contract.camera.depthOfField = true
      contract.bodyHair = 'vellus'
    }
    // Freeze scene metadata before the asynchronous image bake.
    const frozenContract = structuredClone(contract)
    const inkBlob = decalVisible && placement?.hasPlaced && placement.visible
      ? await bakeInkLayer({ tattooImage: placement.imageSource ?? resolveTattooSource(uploadedImage), center: placement.center,
          scaleUV: placement.scaleUV, rotationRad: placement.rotationRad, surface: placement.surface,
          size: options?.snapshot || qualityTier === 'final' ? 4096 : 2048, signal: options?.signal })
      : await blankInkLayer()
    options?.signal?.throwIfAborted()
    return { contract: frozenContract, inkBlob }
  }, [snapshotLook, bodyFit, uploadedImage, decalVisible, exportPreset, bodyMeshId, skinToneId, poseId, lookId, qualityTier, finalSamples, bodyShape, bodyPose, bodyAppearance, isolateRegion, cameraState, lightingPreset, lights, studio, background, modelLoading])

  const handleLookChange = useCallback((id: string) => {
    setLookId(id)
    const look = findById(REGISTRY.looks, id)
    if (look) {
      setLightingPreset(look.previewLighting)
      setBackground(look.previewBackground as BgKey)
      setLights(resolveRig(look.previewLighting))
      setSelectedLight(null)
    }
  }, [])

  const currentShotBuilder = useRef(buildShot)
  currentShotBuilder.current = buildShot

  const loadScene = (scene: SceneData) => afterSaving(() => {
    const migrated = migrateScene(scene)
    setInspectorTab('tattoo')
    setCurrentScene(migrated)
    setUploadedImage(migrated.decalImage)
    setBodyMeshId(migrated.bodyMeshId!)
    setBodyFit(migrated.bodyFit?.bodyMeshId === migrated.bodyMeshId ? migrated.bodyFit ?? null : null)
    setSkinToneId(migrated.skinToneId!)
    setPoseId(migrated.poseId!)
    setBodyPose(normalizePose(migrated.bodyPose))
    setBodyAppearance(normalizeAppearance(migrated.bodyAppearance))
    setStudio(normalizeStudio(migrated.studio))
    setLookId(migrated.lookId!)
    setQualityTier(migrated.qualityTier!)
    setFinalSamples(migrated.finalSamples ?? FINAL_SAMPLES.default)
    setBodyShape(normalizeShape(migrated.bodyShape))
    setIsolateRegion(migrated.bodyRegion ?? null)
    const look = findById(REGISTRY.looks, migrated.lookId!)
    const preset = Object.hasOwn(LIGHTING_PRESETS, migrated.lightingPreset)
      ? migrated.lightingPreset as LightingPresetKey : look?.previewLighting ?? 'studio'
    setLightingPreset(preset)
    setBackground(Object.hasOwn(BACKGROUNDS, migrated.background) ? migrated.background as BgKey : 'white')
    setLights(migrated.lights ? structuredClone(migrated.lights) : resolveRig(preset))
    setSelectedLight(null)
    setPhotoMode(false)
    setShapeMenu(null)
    setPanelRegions([])
    setSurfacePlacement(migrated.surfacePlacement ?? null)
    setDecalVisible(migrated.decalVisible)
    setPlacementStatus(migrated.surfacePlacement ? 'Placed on the skin. Click to move, or hold ⌘ / Ctrl and drag.' : 'Click the skin to place. Drag to orbit. Hold ⌘ / Ctrl and drag to move the tattoo.')
    setDecalRotation(migrated.decalRotation)
    setDecalScale(migrated.decalScale)
    setDecalColor(migrated.decalColor ?? '#ffffff')
    setDecalOpacity(migrated.decalOpacity ?? 1)
    setDecalPosition(migrated.decalPosition ?? null)
    setDecalNormal(migrated.decalNormal ?? null)
    setShowDashboard(false)
    setCameraState(migrated.camera ?? CAMERA_PRESETS.threeQuarter)
    setCameraPreset('custom')
  })

  // Save editor state to current scene (except thumbnail)
  useEffect(() => {
    if (!currentScene || showDashboard || measureOpen) return
    const updated: SceneData = {
      ...currentScene,
      decalImage: uploadedImage,
      model: 'FinalBaseMesh',
      decalVisible,
      surfacePlacement,
      decalRotation,
      decalScale,
      decalColor,
      decalOpacity,
      decalPosition,
      decalNormal,
      background,
      studio: normalizeStudio(studio),
      lightingPreset,
      lights: structuredClone(lights),
      camera: cameraState,
      bodyMeshId,
      skinToneId,
      poseId,
      bodyPose,
      bodyAppearance,
      lookId,
      qualityTier,
      finalSamples,
      bodyShape,
      bodyFit,
      bodyRegion: isolateRegion,
      // thumbnail will be updated in a separate effect
    }
    stageScene(updated)
    const id = setTimeout(() => { void flushPendingSave().catch(() => {}) }, 600)
    saveTimer.current = id
    return () => clearTimeout(id)
    // currentScene is deliberately not a dependency: this effect writes it, so
    // including it would re-run on every save and loop forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentScene?.id, showDashboard, measureOpen, bodyFit, stageScene, flushPendingSave, uploadedImage, decalVisible, surfacePlacement, decalRotation, decalScale, decalColor, decalOpacity, decalPosition, decalNormal, background, studio, lightingPreset, lights, cameraState, bodyMeshId, skinToneId, poseId, lookId, qualityTier, finalSamples, bodyShape, bodyPose, bodyAppearance, isolateRegion])

  // Capture a dashboard thumbnail once the user pauses. Encoding the full
  // canvas on every change produced multi-megabyte data URLs and a save per
  // slider tick; this waits for 1.5 s of quiet and shrinks to 512 px.
  useEffect(() => {
    if (!currentScene || showDashboard || measureOpen || !canvasContainerRef.current) return
    const timeout = setTimeout(() => {
      if (document.hidden) return
      const canvas = canvasContainerRef.current?.querySelector('canvas') as HTMLCanvasElement | null
      if (!canvas) return
      let dataUrl: string | null = null
      try {
        dataUrl = captureThumbnail(canvas, 512)
      } catch {
        dataUrl = null
      }
      if (currentScene.thumbnail === dataUrl) return
      // A stored (signed URL) thumbnail counts as present; only replace it
      // with a fresh capture, never with null because a capture failed.
      if (dataUrl === null && currentScene.thumbnail !== null) return
      const updated: SceneData = { ...(sceneSaves.peek(currentScene.id) ?? currentScene), thumbnail: dataUrl }
      stageScene(updated)
      void flushPendingSave().catch(() => {})
    }, 1500)
    return () => clearTimeout(timeout)
  }, [currentScene, showDashboard, measureOpen, bodyFit, sceneSaves, stageScene, flushPendingSave, uploadedImage, surfacePlacement, decalRotation, decalScale, decalColor, decalOpacity, decalPosition, decalNormal, background, studio, lightingPreset, lights, cameraState, bodyShape, bodyPose, bodyAppearance, isolateRegion])

  const handleBodyMeshChange = (id: string) => {
    if (id === bodyMeshId || !findById(REGISTRY.bodyMeshes, id)) return
    setBodyMeshId(id)
    setBodyFit(null)
    setSurfacePlacement(null)
    setDecalPosition(null)
    setDecalNormal(null)
    setDecalVisible(false)
    setPanelRegions([])
    setShapeMenu(null)
    setPlacementStatus('Body changed. Click the skin to place your design at the same size.')
  }

  // Reset decal transform
  const handlePhotoModeChange = (enabled: boolean) => {
    setPhotoMode(enabled)
    setShapeMenu(null)
    setPanelRegions([])
  }

  const handleResetDecal = () => {
    setDecalRotation(0)
    setDecalScale(1)
    setDecalColor('#ffffff')
    setDecalOpacity(1)
  }

  const handleOrbitStart = useCallback(() => setCameraPreset('custom'), [])

  const handleCameraPresetChange = (preset: CameraPresetKey) => {
    setCameraPreset(preset)
    const view = CAMERA_PRESETS[preset]
    const framing = uvPlacementRef.current?.getRegionFraming()
    const rect = canvasHostRef.current?.getBoundingClientRect()
    const fitted = framing ? frameRegionCamera(framing, view.position, view.fov,
      rect && rect.height > 0 ? rect.width / rect.height : 1) : view
    const zoom = preset === 'wide' ? 1.3 : preset === 'closeup' ? 0.68 : 1
    setCameraState({ ...fitted, position: fitted.position.map((n, i) =>
      fitted.target[i] + (n - fitted.target[i]) * zoom) as [number, number, number] })
    setCameraRequestId((id) => id + 1)
  }

  // Export functionality using Three.js renderer
  const exportImage = async () => {
    if (!threeRenderer || !threeScene || !threeCamera || isExporting) return
    if (modelLoading || !uvPlacementRef.current?.getRegionFraming()) {
      setExportError('Wait for the body to finish loading, then export again.')
      return
    }
    
    setIsExporting(true)
    setExportError('')
    setHistoryWarning('')
    const previousTarget = threeRenderer.getRenderTarget()
    let renderTarget: THREE.WebGLRenderTarget | null = null
    const persp = threeCamera as THREE.PerspectiveCamera
    const hadPerspective = persp.isPerspectiveCamera
    const savedAspect = hadPerspective ? persp.aspect : 0
    let rendererRestored = false
    const restoreRenderer = () => {
      if (rendererRestored) return
      rendererRestored = true
      threeRenderer.setRenderTarget(previousTarget)
      if (hadPerspective) { persp.aspect = savedAspect; persp.updateProjectionMatrix() }
      renderTarget?.dispose()
    }
    try {
      const preset = EXPORT_PRESETS[exportPreset as keyof typeof EXPORT_PRESETS]
      const { width, height } = preset
      
      renderTarget = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        colorSpace: THREE.SRGBColorSpace,
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
      withoutEditorHelpers(threeScene, () => threeRenderer.render(threeScene, threeCamera))
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
      
      paintExportBackground(finalCtx, width, height, background)
      
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
      
      // Restore the interactive camera before image encoding or history I/O.
      restoreRenderer()
      const blob = await canvasPng(finalCanvas)
      downloadBlob(`smart-ink-${exportPreset}-${Date.now()}.png`, blob)
      try {
        await addRenderHistory({ source: 'canvas', width, height, exportPreset,
          sceneName: currentScene?.name, lookId }, blob)
      } catch {
        setHistoryWarning('Your image was downloaded, but could not be added to history. Keep the downloaded copy.')
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Could not export the image. Please try again.')
    } finally {
      setIsExporting(false)
      restoreRenderer()
    }
  }

  const exportForBlender = async () => {
    setIsExportingBlender(true)
    setExportError('')
    try {
      const shot = await buildShot()
      if (!shot) return
      await downloadFiles([
        { filename: 'ink.png', blob: shot.inkBlob },
        { filename: 'contract.json', blob: new Blob([JSON.stringify(shot.contract, null, 2)], { type: 'application/json' }) },
      ])
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Could not prepare the Blender files.')
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
      setLiveSyncMessage('Scene sent to Blender. The live preview will update if the watcher is running.')
    } catch (e) {
      console.error('Live sync failed:', e)
      setLiveSyncStatus('error')
      setLiveSyncMessage(e instanceof Error ? e.message : 'Sync failed')
    }
  }

  const renderBusy = cloudRenderStatus === 'uploading' || cloudRenderStatus === 'rendering'
  useEffect(() => {
    if (!renderBusy) return
    const started = Date.now()
    const interval = window.setInterval(() => setRenderElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(interval)
  }, [renderBusy])
  useEffect(() => () => { renderController.current?.abort() }, [])
  useEffect(() => () => { if (cloudRenderImage) URL.revokeObjectURL(cloudRenderImage) }, [cloudRenderImage])

  const handleCloudRender = async () => {
    if (renderController.current) return
    const controller = new AbortController()
    renderController.current = controller
    setCloudRenderStatus('uploading')
    setCloudRenderMessage('Preparing scene…')
    setHistoryWarning('')
    setRenderElapsed(0)
    // Keep the previous successful render available while a new one is running.
    try {
      const shot = await buildShot()
      controller.signal.throwIfAborted()
      const imageUrl = await renderContract(shot.contract, shot.inkBlob, {
        signal: controller.signal,
        onStatusChange: (status, message) => {
          if (renderController.current !== controller || controller.signal.aborted) return
          setCloudRenderStatus(status)
          setCloudRenderMessage(message ?? '')
        },
      })
      if (controller.signal.aborted) { URL.revokeObjectURL(imageUrl); return }
      setCloudRenderImage(imageUrl)
      setCloudRenderStatus('done')
      setCloudRenderMessage('Render complete.')
      if (renderController.current === controller) renderController.current = null
      try {
        const renderBlob = await fetch(imageUrl).then((r) => r.blob())
        if (!usesRunpodGateway()) await addRenderHistory({ source: 'cycles', width: shot.contract.output.width,
          height: shot.contract.output.height, qualityTier: shot.contract.output.qualityTier,
          lookId: shot.contract.lookId, sceneName: currentScene?.name }, renderBlob)
      } catch {
        setHistoryWarning('Your render is ready to download, but could not be added to history.')
      }
    } catch (error) {
      const cancelled = controller.signal.aborted && !(error instanceof Error && error.name === 'CancellationUnconfirmedError')
      setCloudRenderStatus(cancelled ? 'cancelled' : 'error')
      setCloudRenderMessage(cancelled ? (renderServer?.cancellationSupported ? 'Render cancelled. You can start again.' : 'Stopped waiting. This server may finish the render in the background.')
        : error instanceof Error ? error.message : 'Rendering failed. Please try again.')
    } finally {
      if (renderController.current === controller) renderController.current = null
    }
  }

  const openSnapshot = () => {
    if (renderBusy || modelLoading || !canvasHostSized || snapshotSession.getState().open) return
    setShapeMenu(null)
    setPanelRegions([])
    setAccountMenuOpen(false)
    snapshotReturnCamera.current = orbitControlsRef.current?.freezeSnapshot() ?? structuredClone(cameraState)
    const tattoo = uvPlacementRef.current?.getTattooFraming() ?? null
    const region = uvPlacementRef.current?.getRegionFraming()
    const view = snapshotReturnCamera.current
    const direction = view.position.map((value, i) => value - view.target[i]) as [number, number, number]
    setTattooFraming(tattoo ?? (region ? regionSnapshotFraming(region, direction) : null))
    setSnapshotHasTattoo(Boolean(tattoo))
    setSnapshotFramingHint(tattoo ? '' : uvPlacementRef.current?.getPlacement().hasPlaced
      ? 'The tattoo is covered or outside this Focus view. The camera is centered on the visible figure.'
      : 'Camera centered on the figure. Return to editing and click the skin to place the example tattoo, or render without ink.')
    setSnapshotCamera({ ...DEFAULT_TATTOO_CAMERA_ADJUSTMENT })
    setSnapshotLook(null)
    snapshotSession.open(async (signal) => ({
      ...await currentShotBuilder.current({ snapshot: snapshotSession.getState().quality, signal }), sceneName: currentScene?.name,
    }))
  }
  const applySnapshotPreset = (id: CinematicPresetId) => {
    const preset = cinematicPreset(id)
    if (!preset || !tattooFraming) return
    const camera = frameTattoo(tattooFraming, preset.adjustment, viewportAspect, preset.fov)
    setSnapshotLook(id)
    setSnapshotCamera({ ...preset.adjustment })
    setLightingPreset('studio')
    setLights(cinematicLights(preset, camera, LIGHTING_PRESETS.studio.threeIntensityScale))
    setStudio(previous => ({ ...previous, mode: 'plain', color: preset.background, gradient: undefined, showGuides: false }))
    setSelectedLight(1)
  }
  const aimSnapshotLights = () => {
    if (!snapshotHasTattoo || !tattooFraming) return
    setLights((previous) => previous.map((light) => light.type === 'ambient' ? light : {
      ...light, target: [...tattooFraming.center] as [number, number, number],
    }))
  }
  const downloadSnapshot = () => {
    if (!snapshot.imageUrl) return
    const link = document.createElement('a')
    link.href = snapshot.imageUrl
    link.download = `smart-ink-snapshot-${Date.now()}.png`
    link.click()
  }

  // R3F measures the canvas container as <Canvas> mounts. Mounting the editor
  // in the same commit that lays the container out can hand it a zero size,
  // which it never re-measures: the drawing buffer stays at the default
  // 300x150 and the viewport is blank until the window is resized. (This
  // predates the region work; it hit roughly the first open of a session.)
  // Waiting for a measured container removes the race instead of nudging it.
  useEffect(() => {
    const el = canvasHostRef.current
    if (!el) return
    const measure = () => {
      const rect = el.getBoundingClientRect()
      setCanvasHostSized(rect.width > 0 && rect.height > 0)
      if (rect.width > 0 && rect.height > 0) setViewportAspect(rect.width / rect.height)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [showDashboard])

  // Exit photo mode / modals on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (snapshot.open) { closeSnapshot(); return }
        setAccountMenuOpen(false)
        if (showRenderHistory) {
          setShowRenderHistory(false)
          return
        }
        setPhotoMode(false)
        setShowExportModal(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showRenderHistory, snapshot.open, closeSnapshot])

  if (showDashboard) {
    return (
      <div style={{ position: 'relative', width: '100%', minHeight: '100vh' }}>
        <ScenesDashboard
          session={session}
          onSignOut={() => onSignOut()}
          onSelectScene={loadScene}
          onOpenLanding={() => afterSaving(onHome)}
        />
      </div>
    )
  }

  return (
    <div className={`editor-app-root${measureOpen ? ' editor-app-root--measuring' : ''}${photoMode ? ' editor-app-root--photo' : ''}`} ref={canvasContainerRef}>
      <header className="editor-toolbar editor-toolbar--main" inert={snapshot.open || measureOpen || measureLoading}>
        <button type="button" className="editor-toolbar-brand editor-home-link" onClick={() => afterSaving(onHome)} aria-label="Smart Ink home">
          <span className="nav-logo nav-logo--sm" aria-hidden />
          Smart Ink
        </button>
        <div className="editor-toolbar-center editor-scene-heading">
          <input key={currentScene?.id} className="editor-scene-name" aria-label="Scene name"
            defaultValue={currentScene?.name ?? 'Untitled Scene'} maxLength={100}
            onBlur={(event) => {
              if (!currentScene) return
              const name = event.currentTarget.value.trim() || currentScene.name
              event.currentTarget.value = name
              if (name === currentScene.name) return
              stageScene({ ...(sceneSaves.peek(currentScene.id) ?? currentScene), name })
              void flushPendingSave().catch(() => {})
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() }
              if (event.key === 'Escape') { event.stopPropagation(); event.currentTarget.value = currentScene?.name ?? ''; event.currentTarget.blur() }
            }} />
          <span className={`scene-save-status scene-save-status--${saveState.status}`} role="status" aria-live="polite">
            {saveState.status === 'saved' ? 'Saved' : saveState.status === 'error' ? 'Not saved' : 'Saving…'}
          </span>
      {saveState.status === 'error' && <button type="button" className="tool-btn tool-btn--ghost" onClick={() => void flushPendingSave().catch(() => {})}>Retry save</button>}
        </div>
        <div className="editor-toolbar-actions editor-toolbar-actions--spread">
          <div className="editor-history-controls" role="group" aria-label="Edit history">
            <button type="button" className="tool-btn tool-btn--ghost" aria-label="Undo edit" title="Undo · ⌘ / Ctrl Z" disabled={historyBlocked || !editHistory.canUndo} onClick={editHistory.undo}><FaUndo aria-hidden="true" /><span>Undo</span></button>
            <button type="button" className="tool-btn tool-btn--ghost" aria-label="Redo edit" title="Redo · ⌘ / Ctrl Shift Z" disabled={historyBlocked || !editHistory.canRedo} onClick={editHistory.redo}><FaRedo aria-hidden="true" /><span>Redo</span></button>
          </div>
          <button type="button" className="tool-btn tool-btn--primary" onClick={openSnapshot} disabled={modelLoading || !canvasHostSized || renderBusy} title="Frame the tattoo and set up a Blender snapshot">Snapshot</button>
          <EditorOutputMenu onExport={() => setShowExportModal(true)} onShare={() => setShowRenderHistory(true)} />
          <button type="button" className="tool-btn-nav tool-btn-nav--muted" onClick={() => afterSaving(() => setShowDashboard(true))}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z" />
            </svg>
            Scenes
          </button>
          <div className="editor-toolbar-account">
            <button
              type="button"
              className="editor-toolbar-avatar"
              title={session.email}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
              aria-label="Account menu"
              onClick={() => setAccountMenuOpen((v) => !v)}
            >
              {(session.displayName?.[0] ?? 'S').toUpperCase()}
            </button>
            {accountMenuOpen && (
              <div className="account-menu" role="menu">
                <div className="account-menu-email">{session.email}</div>
                <button type="button" role="menuitem" onClick={() => afterSaving(() => onSignOut())}>
                  Sign out
                </button>
                <button type="button" role="menuitem" onClick={() => afterSaving(() => onSignOut({ everywhere: true }))}>
                  Sign out everywhere
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {measureError && <div className="editor-notice" role="alert">{measureError}<button type="button" className="ep-btn" onClick={() => setMeasureError('')}>Dismiss</button></div>}
      {saveState.status === 'error' && <div className="editor-notice" role="alert">Your latest changes are still here. Saving failed; retry before leaving this page.</div>}
      {photoMode && <div className="photo-mode-actions" inert={snapshot.open || measureOpen || measureLoading} style={snapshot.open ? { visibility: 'hidden' } : undefined}>
        <button type="button" className="ep-btn" onClick={() => setPhotoMode(false)}>Exit Clean view · Esc</button>
        <button type="button" className="ep-btn ep-btn--primary" onClick={openSnapshot} disabled={modelLoading || !canvasHostSized || renderBusy}>Snapshot</button>
        <button type="button" className="ep-btn" onClick={() => setShowExportModal(true)}>Export</button>
      </div>}
      <div className="editor-body-row">
        <EditorLeftPanel currentImage={uploadedImage}
          onChooseArtwork={(source) => { setUploadedImage(source); setDecalVisible(true); setInspectorTab('tattoo'); setPanelRegions([]); uvPlacementRef.current?.placeInView() }}
          disabled={snapshot.open || measureOpen || measureLoading || modelLoading}
          collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(value => !value)}
          />

        <div className="editor-canvas-host">
          {!photoMode && <ViewportControls disabled={snapshot.open || measureOpen || measureLoading || modelLoading}
            showPlacementTips={showPlacementTips} onPlacementTipsChange={togglePlacementTips}
            cameraPreset={cameraPreset} cameras={CAMERA_PRESETS}
            onCameraChange={(preset) => handleCameraPresetChange(preset as CameraPresetKey)}
            region={isolateRegion} onRegionChange={setIsolateRegion} onHighlightRegions={setPanelRegions}
            onFit={() => handleFrameRegion(uvPlacementRef.current?.getRegionFraming() ?? null)}
            onCleanView={() => handlePhotoModeChange(true)} performanceMode={performanceMode} onPerformanceChange={setPerformanceMode} />}
          <div className="editor-canvas-stage">
          <div
            className="editor-canvas-bg"
            style={{
              background: studio.mode === 'sweep' ? studio.color : BACKGROUNDS[background].css,
              transition: 'background 0.4s',
            }}
          />
          <div className="editor-canvas-inner" ref={canvasHostRef}>
            {canvasHostSized && (
            <>
            {/*
              A loader or WebGL failure is rethrown by the Canvas and caught by
              this boundary. Switching body mesh clears the error so the user
              can recover without leaving the editor. Loading is handled by a
              Suspense boundary *inside* the Canvas (see LoadingSignal).
            */}
            <ErrorBoundary
              resetKeys={[isolateRegion, bodyMeshId]}
              fallback={({ error, reset }) => (
                <CrashScreen
                  inline
                  title="The 3D preview stopped"
                  body="Try again, or go back to your scenes. Your latest edits will be saved before leaving."
                  error={error}
                  actions={[
                    { label: 'Try again', onClick: reset, primary: true },
                    {
                      label: 'Back to scenes',
                      onClick: () => afterSaving(() => {
                        reset()
                        setShowDashboard(true)
                      }),
                    },
                  ]}
                />
              )}
            >
            <Canvas
              className="editor-r3f-canvas"
              camera={INITIAL_CANVAS_CAMERA}
              shadows={!performanceMode}
              dpr={performanceMode ? 0.7 : Math.min(2, window.devicePixelRatio)}
              gl={{ preserveDrawingBuffer: true, antialias: true }}
            >
        <ExportRenderer onRendererReady={handleRendererReady} />
        <CinematicLights
          key={lightingPreset}
          preset={lightingPreset}
          lights={lights}
          scale={LIGHTING_PRESETS[lightingPreset].threeIntensityScale}
          performanceMode={performanceMode}
        />
        <StudioBackdrop studio={studio} isolateRegion={isolateRegion} performanceMode={performanceMode} />
        {!photoMode && !snapshot.open && !measureOpen && studio.showGuides && <LightHandles lights={lights} selectedIndex={selectedLight} onSelect={setSelectedLight} />}
        <Suspense fallback={<LoadingSignal onChange={setModelLoading} />}>
          <ModelWithUVTattoo
            key={`${currentScene?.id}:${bodyMeshId}`}
            ref={uvPlacementRef}
            uploadedImage={uploadedImage}
            skinToneId={skinToneId}
            bodyMeshId={bodyMeshId}
            decalRotation={decalRotation}
            decalScale={decalScale}
            decalColor={decalColor}
            decalOpacity={decalOpacity}
            setDecalVisible={setDecalVisible}
            visible={decalVisible}
            initialPlacement={surfacePlacement}
            onPlacementChange={setSurfacePlacement}
            onPlacementStatus={setPlacementStatus}
            lights={lights}
            intensityScale={LIGHTING_PRESETS[lightingPreset].threeIntensityScale}
            performanceMode={performanceMode}
            bodyShape={bodyShape}
            bodyFit={bodyFit}
            bodyPose={measureOpen ? DEFAULT_BODY_POSE : bodyPose}
            bodyAppearance={measureOpen ? DEFAULT_BODY_APPEARANCE : bodyAppearance}
            isolateRegion={measureOpen ? null : isolateRegion}
            highlightRegions={photoMode || snapshot.open || measureOpen ? [] : highlightRegions}
            editingEnabled={!photoMode && !snapshot.open && !measureOpen}
            onRegionPress={bodyFit ? undefined : handleRegionPress}
            onFrameRegion={measureOpen ? undefined : handleFrameRegion}
          />
        </Suspense>
        {measureOpen && <MeasurementScene model={uvPlacementRef} step={measureStep} onFrame={frameMeasurement} />}
        <OrbitControlsWithCmdLock
          enabled={!snapshot.open && !measureOpen}
          key={currentScene?.id}
          ref={orbitControlsRef}
          cameraState={cameraState}
          cameraRequestId={cameraRequestId}
          setCameraState={setCameraState}
          onOrbitStart={handleOrbitStart}
        />
            </Canvas>
            </ErrorBoundary>
            </>
            )}
            {showPlacementTips && !modelLoading && !photoMode && !snapshot.open && !measureOpen && (
              <div className="placement-help" role="status" aria-live="polite">
                <strong>Surface placement</strong>
                <span>{placementStatus}</span>
              </div>
            )}
            {modelLoading && (
              <div className="editor-canvas-loading" role="status">
                Loading body mesh…
              </div>
            )}
          </div>
          {measureOpen && measureAsset && <MeasurementOverlay initial={bodyFit?.measurements} baseline={measureAsset.baseline}
            onFocus={setMeasureStep} onClose={closeMeasurement} completeLabel="Fit my body"
            onComplete={async values => { const result = await fitBody(bodyMeshId, values); setBodyFit(result.fit); closeMeasurement() }} />}
          {snapshot.open && <SnapshotOverlay
            mode={snapshot.mode} onAdjust={snapshotSession.adjust}
            presetControls={<SnapshotPresets selected={snapshotLook} onSelect={applySnapshotPreset} />}
            cameraControls={<SnapshotCameraControls adjustment={snapshotCamera} onChange={setSnapshotCamera}
              onReset={() => setSnapshotCamera({ ...DEFAULT_TATTOO_CAMERA_ADJUSTMENT })} hasTattoo={snapshotHasTattoo} />}
            lightingControls={<>
              <button type="button" className="snapshot-button" onClick={aimSnapshotLights} disabled={!snapshotHasTattoo}>Aim lights at tattoo</button>
              <LightingControls lights={lights} selectedIndex={selectedLight} onSelectLight={setSelectedLight}
                onChange={setLights} onReset={() => setLights(resolveRig(lightingPreset))}
                preset={lightingPreset} onPresetChange={(preset) => { setLightingPreset(preset); setLights(resolveRig(preset)); setSelectedLight(1) }} />
            </>}
            framingHint={snapshotHasTattoo ? (decalVisible ? 'Camera anchored to your tattoo. Adjust the shot, then render.' : 'Camera anchored to the placement. The tattoo is hidden in this before view.') : snapshotFramingHint}
            previewUrl={snapshot.previewUrl} progress={snapshot.progress}
            status={snapshot.status} imageUrl={snapshot.imageUrl} message={snapshot.message}
            elapsed={snapshotElapsed} quality={snapshot.quality} warning={snapshot.warning}
            comparisonAvailable={snapshot.imageMatchesView && (!snapshot.aspect || Math.abs(viewportAspect / snapshot.aspect - 1) < 0.005)}
            comparisonUnavailableReason={!snapshot.imageMatchesView ? 'This image is from the previous shot. Render the new camera and lighting to compare.' : undefined}
            onQualityChange={snapshotSession.setQuality} onRender={() => void snapshotSession.render()}
            onCancel={snapshotSession.cancel} onClose={closeSnapshot} onDownload={downloadSnapshot}
          />}
          </div>
        </div>

        <TopMenuBar
          onMeasureBody={() => void openMeasurement()} measuringLoading={measureLoading || modelLoading}
          hasBodyFit={!!bodyFit} onClearBodyFit={() => setBodyFit(null)}
          activeTab={inspectorTab} onTabChange={setInspectorTab}
          disabled={snapshot.open || measureOpen || measureLoading}
          key={currentScene?.id}
          bodyMeshId={bodyMeshId}
          onBodyMeshChange={handleBodyMeshChange}
          skinToneId={skinToneId}
          lookId={lookId}
          lights={lights}
          selectedLight={selectedLight}
          lightingPreset={lightingPreset}
          onLightingPresetChange={(preset) => { setLightingPreset(preset); setLights(resolveRig(preset)); setSelectedLight(1) }}
          studio={studio}
          background={background} onBackgroundChange={setBackground}
          onStudioChange={(value) => setStudio(normalizeStudio(value))}
          onSelectLight={setSelectedLight}
          onLightsChange={setLights}
          onSkinChange={setSkinToneId}
          onLookChange={handleLookChange}
          bodyShape={bodyShape}
          poseId={poseId}
          bodyPose={bodyPose}
          bodyAppearance={bodyAppearance}
          onAppearanceChange={(appearance) => setBodyAppearance(normalizeAppearance(appearance))}
          onFramePose={() => handleFrameRegion(uvPlacementRef.current?.getRegionFraming() ?? null)}
          onPosePresetChange={handlePosePreset}
          onBodyPoseChange={handleBodyPoseChange}
          onBodyShapeChange={(shape) => setBodyShape(normalizeShape(shape))}
          isolateRegion={isolateRegion}
          onIsolateRegionChange={setIsolateRegion}
          onHighlightRegions={setPanelRegions}
          setUploadedImage={setUploadedImage}
          uploadedImage={uploadedImage}
          decalVisible={decalVisible}
          hasPlacement={surfacePlacement !== null}
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
          setPhotoMode={handlePhotoModeChange}
          cameraPreset={cameraPreset}
          onCameraPresetChange={(preset) => handleCameraPresetChange(preset as CameraPresetKey)}
          CAMERA_PRESETS={CAMERA_PRESETS}
          performanceMode={performanceMode}
          setPerformanceMode={setPerformanceMode}
          onExport={() => setShowExportModal(true)}
        />
      </div>

      {/* Export Modal */}
      {showExportModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <div className="modal-card">
            <div className="render-history-header">
              <h2 id="export-title">Export image</h2>
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setShowRenderHistory(true)}
              >
                Render history
              </button>
            </div>
            <label className="modal-label" htmlFor="export-preset">
              Format for both exports
            </label>
            <select
              id="export-preset"
              className="modal-select"
              value={exportPreset}
              onChange={(e) => setExportPreset(e.target.value as ExportPreset)}
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
                Add watermark to canvas image
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
            {exportError && <p className="editor-feedback-error" role="alert">{exportError}</p>}
            {historyWarning && <p className="editor-feedback-warning" role="status">{historyWarning}</p>}
            <div className="modal-actions">
              <button type="button" className="btn-modal-cancel" onClick={() => setShowExportModal(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-modal-primary"
                onClick={exportImage}
                disabled={isExporting || modelLoading || !threeRenderer || !threeScene || !threeCamera}
              >
                {isExporting ? 'Exporting…' : modelLoading || !threeRenderer || !threeScene || !threeCamera ? 'Loading…' : 'Download canvas image'}
              </button>
            </div>

            <div className="modal-blender-divider" />
            <label className="modal-label" htmlFor="quality-tier">
              Blender output quality
            </label>
            <select
              id="quality-tier"
              className="modal-select"
              style={{ marginBottom: 16 }}
              value={qualityTier}
              onChange={(e) => setQualityTier(e.target.value as 'preview' | 'final')}
            >
              {REGISTRY.outputTiers.map((tier) => (
                <option key={tier.id} value={tier.id}>
                  {tier.label} ({tier.samples} samples{tier.id === 'preview' ? ', 512px max' : ', full res'})
                </option>
              ))}
            </select>

            {qualityTier === 'final' && (
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 8,
                  }}
                >
                  <label className="modal-label" htmlFor="final-samples" style={{ marginBottom: 0 }}>
                    Final render quality
                  </label>
                  <button
                    type="button"
                    className="shape-value"
                    title="Reset to default"
                    onClick={() => setFinalSamples(FINAL_SAMPLES.default)}
                  >
                    {finalSamples} samples
                  </button>
                </div>
                <input
                  id="final-samples"
                  type="range"
                  className="shape-range"
                  style={sampleTrackStyle(finalSamples)}
                  min={FINAL_SAMPLES.min}
                  max={FINAL_SAMPLES.max}
                  step={FINAL_SAMPLES.step}
                  value={finalSamples}
                  onChange={(e) => setFinalSamples(Number(e.target.value))}
                  onDoubleClick={() => setFinalSamples(FINAL_SAMPLES.default)}
                  aria-label="Final render quality in Cycles samples"
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: 'var(--text-secondary)',
                    fontSize: '0.78rem',
                    marginTop: 6,
                  }}
                >
                  <span>Faster ({FINAL_SAMPLES.min})</span>
                  <span>Cleaner ({FINAL_SAMPLES.max})</span>
                </div>
              </div>
            )}

            <p className="modal-blender-hint">Blender uses the selected format and visible tattoo state. Preview output is limited to 512px; final output uses the full format size. Your studio backdrop and custom lights are included. Simple gradients use their first color in Blender. Watermarks apply only to canvas images.</p>
            <h3 className="modal-blender-title">Export for Blender</h3>
            <p className="modal-blender-desc">
              Download the scene and tattoo files. The importer script is available separately below.
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
                Download sceneImporter.py
              </a>
            </div>
            <p className="modal-blender-hint">
              Put the downloaded files in your existing Blender project folder alongside its importer and body assets.
            </p>

            {getRenderTargetLabel() === 'local' && (
              <>
                <div className="modal-blender-divider" />
                <h3 className="modal-blender-title">Live Blender preview</h3>
                <p className="modal-blender-desc">
                  Update the scene in your open Blender live preview. The local watcher needs to be running.
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
                  <a
                    href="/blender-scripts/watch_dev.py"
                    className="btn-modal-blender btn-modal-blender--secondary"
                    download="watch_dev.py"
                  >
                    Download watch_dev.py
                  </a>
                </div>
                <p className="modal-blender-hint">
                  <code>cd smartink-live && blender --python watch_dev.py</code>
                </p>
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
            <h3 className="modal-blender-title">Blender render</h3>
            <p className="modal-blender-desc">
              Render with Blender Cycles ({getRenderTargetLabel()} server).
              {qualityTier === 'preview'
                ? ' Fast preview — low samples, ~512px; good for iteration.'
                : ` Final quality — full resolution at ${finalSamples} samples; higher is cleaner but slower.`}
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
                    background: renderServer?.ready ? '#22c55e' : '#ef4444',
                  }}
                />
                {renderServer?.message ?? 'Checking Blender…'}
              </p>
            )}
            <div className="modal-blender-actions">
              <button
                type="button"
                className="btn-modal-blender"
                onClick={handleCloudRender}
                disabled={renderBusy || renderServer?.ready === false}
              >
                {renderBusy
                  ? cloudRenderMessage || 'Rendering...'
                  : cloudRenderStatus === 'done'
                    ? 'Render Again'
                    : 'Render with Blender'}
              </button>
              {renderBusy && <button type="button" className="btn-modal-cancel" onClick={() => renderController.current?.abort()}>{renderServer?.cancellationSupported ? 'Cancel render' : 'Stop waiting'}</button>}
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
            {renderBusy && <p className="modal-blender-hint" role="status">Rendering · {renderElapsed}s elapsed. You can keep this dialog open or return to editing.</p>}
            {cloudRenderStatus === 'cancelled' && <p className="modal-blender-hint" role="status">{cloudRenderMessage}</p>}
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

      {shapeMenu && !photoMode && (
        <RadialShapeMenu
          region={shapeMenu.region}
          x={shapeMenu.x}
          y={shapeMenu.y}
          pointerId={shapeMenu.pointerId}
          shape={bodyShape}
          onChange={handleShapeValueChange}
          onClose={() => setShapeMenu(null)}
        />
      )}

      {showRenderHistory && (
        <RenderHistoryModal onClose={() => setShowRenderHistory(false)} />
      )}

    </div>
  )
}
