import React from 'react';

/**
 * Diagrammatic figures for the landing page pipeline.
 *
 * Drawn as technical illustrations rather than mock screenshots: the same
 * geometry and the same artwork appear at every stage, so the flat artwork →
 * placement → render sequence reads at a glance. Swap in real captures via
 * EXAMPLE_IMAGES in LandingPage.tsx once you have shots you like.
 */

const VIEW_W = 280;
const VIEW_H = 260;

/* Mirrors the design-system tokens. SVG paint attributes can't read CSS custom
   properties reliably across the strokes and gradients used here. */
const C = {
  /** --text-primary */
  fg: '#e8e8ec',
  /** --text-muted */
  fgFaint: '#606070',
  /** --accent-blue, for the placement guides */
  accent: '#4d7cff',
  /** --bg-primary — must match .pipe-figure's background so the scrims blend */
  surface: '#0e0e0e',
  meshFill: '#16161b',
  hairline: '#2a2a32',
  checkerA: '#17171c',
  checkerB: '#1e1e24',
  /** Skin and ink stay representational rather than following the UI palette. */
  inkOnSkin: '#1b0f08',
  rimLight: '#ffe2be',
};

/* A forearm as a tapered tube, cropped by the frame at both ends so it reads as
   part of a body rather than a floating object. */
const AXIS_X = 140;
const TOP_Y = -20;
const BOT_Y = 280;
const HALF_TOP = 62;
const HALF_BOT = 34;
/** Outward bow of the silhouette at mid-length, so the edges aren't dead straight. */
const BOW = 5;

const EMBLEM = { cx: AXIS_X, cy: 104, r: 34 };
/** Horizontal squash of the design, implying it wrapping around the surface. */
const WRAP = 0.85;

const RING_YS = [10, 45, 80, 115, 150, 185, 220, 252];
/** Longitudinal seams as a fraction of the half-width, denser toward the edges. */
const SEAM_FRACTIONS = [-0.84, -0.46, 0, 0.46, 0.84];

function halfWidth(y: number): number {
  const t = (y - TOP_Y) / (BOT_Y - TOP_Y);
  return HALF_TOP + (HALF_BOT - HALF_TOP) * t;
}

const MID_Y = (TOP_Y + BOT_Y) / 2;

const LIMB_PATH = [
  `M ${AXIS_X - HALF_TOP} ${TOP_Y}`,
  `Q ${AXIS_X - halfWidth(MID_Y) - BOW} ${MID_Y} ${AXIS_X - HALF_BOT} ${BOT_Y}`,
  `L ${AXIS_X + HALF_BOT} ${BOT_Y}`,
  `Q ${AXIS_X + halfWidth(MID_Y) + BOW} ${MID_Y} ${AXIS_X + HALF_TOP} ${TOP_Y}`,
  'Z',
].join(' ');

function ringPath(y: number): string {
  const hw = halfWidth(y);
  return `M ${AXIS_X - hw} ${y} A ${hw} ${(hw * 0.26).toFixed(1)} 0 0 0 ${AXIS_X + hw} ${y}`;
}

/** The sample design, reused at every stage to show one artwork moving through. */
const Emblem: React.FC<{
  cx?: number;
  cy?: number;
  r?: number;
  stroke: string;
  opacity?: number;
  wrap?: number;
  strokeWidth?: number;
}> = ({
  cx = EMBLEM.cx,
  cy = EMBLEM.cy,
  r = EMBLEM.r,
  stroke,
  opacity = 1,
  wrap = 1,
  strokeWidth = 1.7,
}) => {
  const tri = [
    [0, -r * 0.56],
    [r * 0.5, r * 0.33],
    [-r * 0.5, r * 0.33],
  ]
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');

  const rays = Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 8 + Math.PI / 8;
    const inner = r * 0.2;
    const outer = r * 0.31;
    return (
      <line
        key={i}
        x1={(Math.cos(angle) * inner).toFixed(1)}
        y1={(Math.sin(angle) * inner).toFixed(1)}
        x2={(Math.cos(angle) * outer).toFixed(1)}
        y2={(Math.sin(angle) * outer).toFixed(1)}
      />
    );
  });

  return (
    <g
      transform={`translate(${cx} ${cy}) scale(${wrap} 1)`}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
      opacity={opacity}
    >
      <circle r={r} />
      <circle r={r * 0.84} strokeWidth={strokeWidth * 0.6} />
      <polygon points={tri} />
      {rays}
      <circle r={r * 0.1} fill={stroke} stroke="none" />
    </g>
  );
};

const LimbWireframe: React.FC<{ showSafeZone?: boolean }> = ({ showSafeZone = true }) => (
  <g clipPath="url(#limb-clip)">
    <path d={LIMB_PATH} fill={C.meshFill} />
    <g stroke={C.fg} fill="none">
      {SEAM_FRACTIONS.map((f, i) => (
        <line
          key={f}
          x1={AXIS_X + f * HALF_TOP}
          y1={TOP_Y}
          x2={AXIS_X + f * HALF_BOT}
          y2={BOT_Y}
          strokeWidth={i === 2 ? 0.9 : 0.7}
          opacity={i === 2 ? 0.38 : 0.2}
        />
      ))}
      {RING_YS.map((y) => (
        <path key={y} d={ringPath(y)} strokeWidth={0.8} opacity={0.3} />
      ))}
    </g>
    {showSafeZone && (
      <rect
        x={EMBLEM.cx - 46}
        y={EMBLEM.cy - 46}
        width={92}
        height={92}
        rx={5}
        fill="none"
        stroke={C.accent}
        strokeWidth={0.8}
        strokeDasharray="4 4"
        opacity={0.55}
      />
    )}
    <Emblem stroke={C.fg} opacity={0.92} wrap={WRAP} />
    <g stroke={C.accent} strokeWidth={0.9} opacity={0.8}>
      <line x1={EMBLEM.cx - 8} y1={EMBLEM.cy} x2={EMBLEM.cx + 8} y2={EMBLEM.cy} />
      <line x1={EMBLEM.cx} y1={EMBLEM.cy - 8} x2={EMBLEM.cx} y2={EMBLEM.cy + 8} />
    </g>
  </g>
);

const LimbRendered: React.FC = () => (
  <g clipPath="url(#limb-clip)">
    <path d={LIMB_PATH} fill="url(#skin-grad)" />
    <Emblem stroke={C.inkOnSkin} opacity={0.94} wrap={WRAP} strokeWidth={2.1} />
    <path d={LIMB_PATH} fill="url(#skin-shade)" />
    <path
      d={`M ${AXIS_X + halfWidth(40) - 5} 40 Q ${AXIS_X + halfWidth(MID_Y) - 1} ${MID_Y} ${AXIS_X + halfWidth(230) - 4} 230`}
      fill="none"
      stroke={C.rimLight}
      strokeWidth={2.2}
      opacity={0.42}
      strokeLinecap="round"
    />
  </g>
);

const FigureDefs: React.FC = () => (
  <defs>
    <clipPath id="limb-clip">
      <path d={LIMB_PATH} />
    </clipPath>
    <linearGradient
      id="skin-grad"
      x1={AXIS_X - HALF_TOP}
      y1="0"
      x2={AXIS_X + HALF_TOP}
      y2="0"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" stopColor="#3b2a20" />
      <stop offset="0.13" stopColor="#8d6b53" />
      <stop offset="0.4" stopColor="#dcb595" />
      <stop offset="0.58" stopColor="#ecd0b6" />
      <stop offset="0.82" stopColor="#a58068" />
      <stop offset="1" stopColor="#433024" />
    </linearGradient>
    <linearGradient id="figure-scrim-top" x1="0" y1="0" x2="0" y2="46" gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor={C.surface} stopOpacity="0.95" />
      <stop offset="1" stopColor={C.surface} stopOpacity="0" />
    </linearGradient>
    <linearGradient
      id="figure-scrim-bottom"
      x1="0"
      y1={VIEW_H - 66}
      x2="0"
      y2={VIEW_H}
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" stopColor={C.surface} stopOpacity="0" />
      <stop offset="0.62" stopColor={C.surface} stopOpacity="0.9" />
      <stop offset="1" stopColor={C.surface} stopOpacity="0.97" />
    </linearGradient>
    <linearGradient id="skin-shade" x1="0" y1="0" x2="0" y2={VIEW_H} gradientUnits="userSpaceOnUse">
      <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
      <stop offset="0.3" stopColor="#000000" stopOpacity="0.04" />
      <stop offset="0.72" stopColor="#000000" stopOpacity="0.1" />
      <stop offset="1" stopColor="#000000" stopOpacity="0.55" />
    </linearGradient>
    <clipPath id="split-left">
      <rect x="0" y="0" width={VIEW_W / 2} height={VIEW_H} />
    </clipPath>
    <clipPath id="split-right">
      <rect x={VIEW_W / 2} y="0" width={VIEW_W / 2} height={VIEW_H} />
    </clipPath>
  </defs>
);

const FigureFrame: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <svg
    className="pipe-figure"
    viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
    role="img"
    aria-label={label}
    preserveAspectRatio="xMidYMid meet"
  >
    <FigureDefs />
    {children}
  </svg>
);

const LimbOutline: React.FC = () => (
  <path d={LIMB_PATH} fill="none" stroke={C.fg} strokeWidth="1" opacity="0.4" />
);

/** Fades the cropped limb into the frame so captions stay legible over it. */
const Scrims: React.FC = () => (
  <>
    <rect x="0" y="0" width={VIEW_W} height="46" fill="url(#figure-scrim-top)" />
    <rect x="0" y={VIEW_H - 66} width={VIEW_W} height="66" fill="url(#figure-scrim-bottom)" />
  </>
);

/** Stage 1 — flat artwork on a transparency checkerboard. */
export const ArtworkFigure: React.FC = () => (
  <FigureFrame label="A tattoo design as a transparent PNG">
    <defs>
      <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">
        <rect width="16" height="16" fill={C.checkerA} />
        <rect width="8" height="8" fill={C.checkerB} />
        <rect x="8" y="8" width="8" height="8" fill={C.checkerB} />
      </pattern>
    </defs>
    <rect x="52" y="44" width="176" height="176" rx="3" fill="url(#checker)" />
    <rect x="52" y="44" width="176" height="176" rx="3" fill="none" stroke={C.hairline} strokeWidth="1" />
    <Emblem cx={140} cy={132} r={58} stroke={C.fg} strokeWidth={2.1} />
    <g stroke={C.fgFaint} strokeWidth="1">
      <line x1="52" y1="36" x2="52" y2="28" />
      <line x1="228" y1="36" x2="228" y2="28" />
      <line x1="52" y1="32" x2="228" y2="32" />
    </g>
    <text x="140" y="252" className="pipe-figure-tick" textAnchor="middle">
      your PNG · transparent
    </text>
  </FigureFrame>
);

/** Stage 2 — the design placed on the mesh, with UV grid and safe zone. */
export const PlacementFigure: React.FC = () => (
  <FigureFrame label="The design placed on a 3D body mesh">
    <LimbWireframe />
    <LimbOutline />
    <Scrims />
    <text x="140" y="252" className="pipe-figure-tick" textAnchor="middle">
      click to place · drag to nudge
    </text>
  </FigureFrame>
);

/** Stage 3 — the same scene lit and rendered. */
export const RenderFigure: React.FC = () => (
  <FigureFrame label="The same scene rendered with Blender Cycles">
    <LimbRendered />
    <Scrims />
    <text x="140" y="252" className="pipe-figure-tick" textAnchor="middle">
      Blender Cycles · 2048 px
    </text>
  </FigureFrame>
);

/** Hero figure — mesh on one side, render on the other, one continuous design. */
export const SplitFigure: React.FC = () => (
  <FigureFrame label="A tattoo design shown as mesh geometry on the left and a lit render on the right">
    <g clipPath="url(#split-left)">
      <LimbWireframe showSafeZone={false} />
      <LimbOutline />
    </g>
    <g clipPath="url(#split-right)">
      <LimbRendered />
    </g>
    <Scrims />
    <line
      x1={VIEW_W / 2}
      y1="26"
      x2={VIEW_W / 2}
      y2={VIEW_H - 44}
      stroke={C.fg}
      strokeWidth="0.7"
      opacity="0.26"
      strokeDasharray="3 5"
    />
    <text x={VIEW_W / 2 - 12} y="252" className="pipe-figure-tick" textAnchor="end">
      mesh
    </text>
    <text x={VIEW_W / 2 + 12} y="252" className="pipe-figure-tick">
      render
    </text>
  </FigureFrame>
);
