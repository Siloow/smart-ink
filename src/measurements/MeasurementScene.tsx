import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { ModelWithUVTattooHandle } from '../ModelWithUVTattoo';
import type { CameraView } from '../render/cameraTransition';
import type { MeasurementGuide } from './geometry';
import type { MeasureStep } from './steps';

export default function MeasurementScene({ model, step, onFrame }: { model: RefObject<ModelWithUVTattooHandle | null>; step: MeasureStep | null; onFrame: (camera: CameraView) => void }) {
  const { camera, gl, size, invalidate } = useThree();
  const [guide, setGuide] = useState<MeasurementGuide | null>(null);
  const offset = useRef({ from: new THREE.Vector2(), to: new THREE.Vector2(), current: new THREE.Vector2(), start: 0 });
  const cardRef = useRef<HTMLElement | null>(null), connectorRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const stage = gl.domElement.closest('.editor-canvas-stage');
    const card = stage?.querySelector<HTMLElement>('.measure-card');
    cardRef.current = card ?? null; connectorRef.current = stage?.querySelector('.measure-connector') ?? null;
    let frame = 0;
    const focus = () => {
      const data = model.current?.getMeasurementGuide(step?.key ?? 'review');
      if (!data || !card) return;
      setGuide(data);
      const bounds = gl.domElement.getBoundingClientRect(), rect = card.getBoundingClientRect(), narrow = bounds.width <= 760;
      const left = 20, top = 74, right = narrow ? bounds.width - 20 : rect.left - bounds.left - 36, bottom = narrow ? rect.top - bounds.top - 20 : bounds.height - 28;
      const width = Math.max(110, right - left), height = Math.max(100, bottom - top);
      const extent = Math.max(data.span * bounds.height / height, data.width * bounds.height / width), fov = 35;
      const distance = extent / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2))), angle = step?.angle ?? 0;
      offset.current.from.copy(offset.current.current); offset.current.to.set(bounds.width / 2 - (left + width / 2), bounds.height / 2 - (top + height / 2)); offset.current.start = performance.now();
      onFrame({ target: data.target.toArray(), position: data.target.clone().add(new THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance)).toArray(), fov });
      invalidate();
    };
    // Wait until the existing model's neutral-pose effect and the overlay have committed.
    frame = requestAnimationFrame(focus);
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(focus); });
    if (card) observer.observe(card);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [model, step, gl, size.width, size.height, onFrame, invalidate]);
  useEffect(() => () => { (camera as THREE.PerspectiveCamera).clearViewOffset(); invalidate(); }, [camera, invalidate]);
  const lines = useMemo(() => guide?.lines.filter(line => line.length > 1).map(points => {
    const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), Math.max(8, points.length * 2), .0045, 6, false);
    const material = new THREE.MeshBasicMaterial({ color: '#5678ed', depthTest: false, transparent: true, opacity: .95 });
    const line = new THREE.Mesh(geometry, material); line.renderOrder = 30; return line;
  }) ?? [], [guide]);
  useEffect(() => () => lines.forEach(line => { line.geometry.dispose(); line.material.dispose(); }), [lines]);
  useFrame(() => {
    const state = offset.current, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = reduced ? 1 : Math.min(1, (performance.now() - state.start) / 700), eased = t * t * t * (t * (t * 6 - 15) + 10);
    state.current.lerpVectors(state.from, state.to, eased);
    (camera as THREE.PerspectiveCamera).setViewOffset(size.width, size.height, state.current.x, state.current.y, size.width, size.height);
    if (t < 1) invalidate();
    const svg = connectorRef.current, card = cardRef.current;
    if (!svg || !card) return;
    svg.style.display = guide?.lines.length ? '' : 'none';
    if (!guide?.lines.length) return;
    camera.updateMatrixWorld();
    const canvas = gl.domElement.getBoundingClientRect(), rect = card.getBoundingClientRect(), narrow = size.width <= 760;
    const input = card.querySelector('input')?.getBoundingClientRect();
    const end = narrow ? { x: rect.left - canvas.left + rect.width / 2, y: rect.top - canvas.top } : { x: rect.left - canvas.left, y: (input?.top ?? rect.top) - canvas.top + (input?.height ?? 0) / 2 };
    const points = guide.lines.flatMap(line => line.flatMap((p, i) => i ? [p, p.clone().lerp(line[i - 1], .5)] : [p])).map(p => p.clone().project(camera)).map(p => ({ x: (p.x + 1) * size.width / 2, y: (1 - p.y) * size.height / 2, z: p.z })).filter(p => p.z > -1 && p.z < 1 && p.y > 65 && p.x > 0 && (narrow ? p.y < end.y - 10 : p.x < end.x - 10));
    if (!points.length) { svg.style.display = 'none'; return; }
    const start = points.reduce((best, p) => Math.hypot(p.x - end.x, p.y - end.y) < Math.hypot(best.x - end.x, best.y - end.y) ? p : best);
    svg.querySelector('path')?.setAttribute('d', narrow ? `M${start.x},${start.y} C${start.x},${start.y + 30} ${end.x},${end.y - 30} ${end.x},${end.y}` : `M${start.x},${start.y} C${start.x + 35},${start.y} ${end.x - 35},${end.y} ${end.x},${end.y}`);
    svg.querySelector('circle')?.setAttribute('cx', String(start.x)); svg.querySelector('circle')?.setAttribute('cy', String(start.y));
  });
  return <>{lines.map((line, i) => <primitive key={i} object={line} />)}</>;
}
