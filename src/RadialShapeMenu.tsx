import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BODY_SHAPE_PARAMS,
  BODY_SHAPE_LIMITS,
  clampShapeValue,
  formatShapeValue,
  type BodyShape,
  type BodyShapeKey,
} from './render/bodyShape';
import { regionDef, type BodyRegionId } from './render/bodyRegions';

/**
 * GTA-style shape wheel, opened by right-pressing a body region.
 *
 * A weapon wheel only has to pick one of N things; a shape control also needs
 * a magnitude, so picking and setting are the same gesture. Flick out to arm
 * a segment, keep pulling along that direction to raise the value (pull back
 * through the centre to lower it), release to commit. The wheel never takes
 * pointer events itself: the press that opened it is still down, so the drag
 * is tracked on the window.
 */

/** No segment is armed inside this radius, so a twitch does not pick one. */
const DEADZONE = 34;
/** Past this radius the armed segment locks, so sculpting cannot re-pick. */
const PICK_OUTER = 98;
const RING_INNER = 44;
const RING_OUTER = 98;
const LABEL_RADIUS = 71;
/** Drag distance that covers a control's full allowed range. */
const RANGE_PX = 210;
const BOX = 300;
/** Keeps the wheel on screen when the press lands near an edge. */
const EDGE_MARGIN = BOX / 2 + 8;

interface RadialShapeMenuProps {
  region: BodyRegionId;
  x: number;
  y: number;
  /** Only the pointer that opened the wheel drives it. */
  pointerId: number;
  shape: BodyShape;
  onChange: (key: BodyShapeKey, value: number) => void;
  onClose: () => void;
}

function polar(r: number, a: number): string {
  return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`;
}

function sectorPath(r0: number, r1: number, a0: number, a1: number): string {
  return [
    `M ${polar(r0, a0)}`,
    `L ${polar(r1, a0)}`,
    `A ${r1} ${r1} 0 0 1 ${polar(r1, a1)}`,
    `L ${polar(r0, a1)}`,
    `A ${r0} ${r0} 0 0 0 ${polar(r0, a0)}`,
    'Z',
  ].join(' ');
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export default function RadialShapeMenu({
  region,
  x,
  y,
  pointerId,
  shape,
  onChange,
  onClose,
}: RadialShapeMenuProps) {
  const def = regionDef(region);
  const params = def.params;
  const step = (Math.PI * 2) / params.length;

  const [armed, setArmed] = useState<BodyShapeKey | null>(null);
  const armRef = useRef<{ key: BodyShapeKey; startValue: number; startT: number } | null>(null);
  /** Every value touched while the wheel is open, for Escape. */
  const originalRef = useRef<Partial<Record<BodyShapeKey, number>>>({});
  const closedRef = useRef(false);
  const shapeRef = useRef(shape);
  shapeRef.current = shape;

  const center = useMemo(
    () => ({
      x: clamp(x, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - EDGE_MARGIN)),
      y: clamp(y, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - EDGE_MARGIN)),
    }),
    [x, y]
  );

  const labels = useMemo(() => {
    const byKey = new Map(BODY_SHAPE_PARAMS.map((p) => [p.key, p.label]));
    return params.map((key) => byKey.get(key) ?? key);
  }, [params]);

  const cancel = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    for (const [key, value] of Object.entries(originalRef.current)) {
      onChange(key as BodyShapeKey, clampShapeValue(key as BodyShapeKey, value as number));
    }
    originalRef.current = {};
    onClose();
  }, [onChange, onClose]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (closedRef.current || e.pointerId !== pointerId) return;
      const dx = e.clientX - center.x;
      const dy = e.clientY - center.y;
      const radius = Math.hypot(dx, dy);
      if (radius < DEADZONE) return;

      // Screen y grows downward, so this angle runs clockwise from straight up.
      const angle = (Math.atan2(dy, dx) * (180 / Math.PI) + 450) % 360;
      const index = Math.round((angle / 360) * params.length) % params.length;
      const key = params[index];

      const current = armRef.current;
      const canRepick = !current || radius < PICK_OUTER;
      if ((!current || current.key !== key) && canRepick) {
        const dir = index * step;
        const t = dx * Math.sin(dir) + dy * -Math.cos(dir);
        const startValue = clampShapeValue(key, shapeRef.current[key]);
        if (!(key in originalRef.current)) originalRef.current[key] = startValue;
        armRef.current = { key, startValue, startT: t };
        setArmed(key);
        return;
      }
      if (!armRef.current) return;

      const dir = params.indexOf(armRef.current.key) * step;
      const t = dx * Math.sin(dir) + dy * -Math.cos(dir);
      const { min, max } = BODY_SHAPE_LIMITS[armRef.current.key];
      const next = clampShapeValue(
        armRef.current.key,
        armRef.current.startValue + ((t - armRef.current.startT) / RANGE_PX) * (max - min)
      );
      onChange(armRef.current.key, next);
    };

    const onUp = (e: PointerEvent) => {
      if (closedRef.current || e.pointerId !== pointerId) return;
      closedRef.current = true;
      originalRef.current = {};
      onClose();
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId === pointerId) cancel();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [center, params, step, pointerId, onChange, onClose, cancel]);

  const armedIndex = armed ? params.indexOf(armed) : -1;
  const armedLabel = armedIndex >= 0 ? labels[armedIndex] : null;

  return (
    <div
      className="radial-menu"
      style={{ left: center.x, top: center.y }}
      role="presentation"
      aria-hidden
    >
      <svg width={BOX} height={BOX} viewBox={`${-BOX / 2} ${-BOX / 2} ${BOX} ${BOX}`}>
        <circle className="radial-ring" cx="0" cy="0" r={(RING_INNER + RING_OUTER) / 2} />
        {params.map((key, i) => {
          const a = i * step;
          const pad = 0.035;
          const isArmed = key === armed;
          const value = clampShapeValue(key, shape[key]);
          return (
            <g key={key} className={`radial-seg${isArmed ? ' radial-seg--armed' : ''}`}>
              <path d={sectorPath(RING_INNER, RING_OUTER, a - step / 2 + pad, a + step / 2 - pad)} />
              <text
                className="radial-seg-label"
                x={LABEL_RADIUS * Math.sin(a)}
                y={-LABEL_RADIUS * Math.cos(a)}
                dy="0.32em"
              >
                {labels[i]}
              </text>
              <text
                className="radial-seg-value"
                x={LABEL_RADIUS * Math.sin(a)}
                y={-LABEL_RADIUS * Math.cos(a) + 14}
                dy="0.32em"
              >
                {formatShapeValue(value)}
              </text>
            </g>
          );
        })}
        <circle className="radial-hub" cx="0" cy="0" r={RING_INNER - 4} />
        {armedLabel ? (
          <>
            <text className="radial-hub-title" x="0" y="-10" dy="0.32em">
              {armedLabel}
            </text>
            <text className="radial-hub-value" x="0" y="12" dy="0.32em">
              {formatShapeValue(clampShapeValue(armed as BodyShapeKey, shape[armed as BodyShapeKey]))}
            </text>
          </>
        ) : (
          <>
            <text className="radial-hub-title" x="0" y="-8" dy="0.32em">
              {def.label}
            </text>
            <text className="radial-hub-hint" x="0" y="10" dy="0.32em">
              flick out
            </text>
          </>
        )}
      </svg>
      <p className="radial-menu-help">
        {armed ? `Less ${formatShapeValue(BODY_SHAPE_LIMITS[armed].min)} · More ${formatShapeValue(BODY_SHAPE_LIMITS[armed].max)} · Adjustment strength` : 'Drag toward a control to adjust'}
        <span>Release to apply · Esc to cancel</span>
      </p>
    </div>
  );
}
