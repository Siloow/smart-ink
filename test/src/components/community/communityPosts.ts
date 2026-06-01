export type CommunityPost = {
  id: string;
  title: string;
  artistName: string;
  artistHandle: string;
  tags: string[];
  likes: number;
  createdAt: string; // ISO
  description: string;
  model: 'Monk' | 'FinalBaseMesh';
  renderSrc: string; // data URL (dummy render preview)
  renderAlt: string;
};

function svgToDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function makeDummyRenderSvg(opts: {
  bg1: string;
  bg2: string;
  ink1: string;
  ink2: string;
  label: string;
}) {
  const { bg1, bg2, ink1, ink2, label } = opts;
  // Simple placeholder “render”: gradient background + flowing stroke lines.
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="750" viewBox="0 0 1200 750">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${bg1}"/>
        <stop offset="1" stop-color="${bg2}"/>
      </linearGradient>
      <linearGradient id="ink" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${ink1}"/>
        <stop offset="1" stop-color="${ink2}"/>
      </linearGradient>
      <filter id="softGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="8" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <pattern id="grain" width="120" height="120" patternUnits="userSpaceOnUse">
        <circle cx="12" cy="18" r="1.3" fill="rgba(255,255,255,0.18)"/>
        <circle cx="54" cy="26" r="1.1" fill="rgba(0,0,0,0.18)"/>
        <circle cx="82" cy="72" r="1.2" fill="rgba(255,255,255,0.12)"/>
        <circle cx="26" cy="86" r="1.0" fill="rgba(0,0,0,0.12)"/>
      </pattern>
    </defs>

    <rect width="1200" height="750" fill="url(#bg)"/>
    <rect width="1200" height="750" fill="url(#grain)" opacity="0.55"/>

    <!-- Tattoo-ish stroke -->
    <g filter="url(#softGlow)" fill="none" stroke="url(#ink)" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.95">
      <path d="M180 500 C 240 370, 320 300, 410 310 C 520 325, 570 455, 680 455 C 780 455, 820 335, 920 320 C 1010 308, 1080 380, 1120 470" />
      <path d="M210 520 C 270 425, 350 360, 430 370 C 530 385, 585 520, 700 520 C 795 520, 850 410, 950 395 C 1025 384, 1090 425, 1140 500" opacity="0.55"/>
      <path d="M260 560 C 325 485, 395 450, 470 470 C 565 495, 615 590, 720 590 C 815 590, 870 515, 980 500 C 1045 491, 1100 520, 1140 560" opacity="0.35"/>
    </g>

    <!-- “Tattoo” micro marks -->
    <g opacity="0.65" fill="${ink1}">
      <circle cx="320" cy="360" r="5"/>
      <circle cx="350" cy="410" r="3.8"/>
      <circle cx="420" cy="335" r="4.3"/>
      <circle cx="540" cy="445" r="4.7"/>
      <circle cx="610" cy="420" r="3.6"/>
      <circle cx="700" cy="455" r="4.1"/>
      <circle cx="760" cy="410" r="3.9"/>
      <circle cx="860" cy="340" r="4.4"/>
      <circle cx="980" cy="370" r="4.0"/>
    </g>

    <g opacity="0.9">
      <text x="70" y="115" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" font-size="34" fill="rgba(255,255,255,0.82)" font-weight="700">${label}</text>
      <text x="70" y="160" font-family="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" font-size="16" fill="rgba(255,255,255,0.64)">Smart Ink • dummy render</text>
    </g>
  </svg>
  `.trim();

  return svgToDataUrl(svg);
}

export const DUMMY_COMMUNITY_POSTS: CommunityPost[] = [
  {
    id: 'post-001',
    title: 'Velvet Blackwork',
    artistName: 'Ava Winters',
    artistHandle: '@ava_winters',
    tags: ['Blackwork', 'Portrait', 'Fine lines'],
    likes: 128,
    createdAt: '2026-03-02T12:30:00.000Z',
    description: 'High-contrast blackwork with a soft flow for natural skin transitions.',
    model: 'FinalBaseMesh',
    renderSrc: makeDummyRenderSvg({
      bg1: '#2a1535',
      bg2: '#0e0e22',
      ink1: '#ff4da6',
      ink2: '#4d7cff',
      label: 'Velvet Blackwork',
    }),
    renderAlt: 'Dummy render preview for Velvet Blackwork',
  },
  {
    id: 'post-002',
    title: 'Neon Floral Drift',
    artistName: 'Noah Kim',
    artistHandle: '@noah.kim',
    tags: ['Floral', 'Color', 'Neotrad'],
    likes: 214,
    createdAt: '2026-03-11T09:10:00.000Z',
    description: 'A bright floral concept built for crisp exports and vibrant lighting.',
    model: 'Monk',
    renderSrc: makeDummyRenderSvg({
      bg1: '#0b3a4a',
      bg2: '#1a1a2e',
      ink1: '#00d084',
      ink2: '#ff8c42',
      label: 'Neon Floral Drift',
    }),
    renderAlt: 'Dummy render preview for Neon Floral Drift',
  },
  {
    id: 'post-003',
    title: 'Geometric Pulse',
    artistName: 'Maya Torres',
    artistHandle: '@maya.torres',
    tags: ['Geometric', 'Minimal', 'Blackwork'],
    likes: 87,
    createdAt: '2026-02-24T17:45:00.000Z',
    description: 'Clean geometry that stays readable at any camera angle.',
    model: 'FinalBaseMesh',
    renderSrc: makeDummyRenderSvg({
      bg1: '#15151e',
      bg2: '#2b0f3a',
      ink1: '#7b5cff',
      ink2: '#4d7cff',
      label: 'Geometric Pulse',
    }),
    renderAlt: 'Dummy render preview for Geometric Pulse',
  },
  {
    id: 'post-004',
    title: 'Micro Realism Study',
    artistName: 'Ethan Park',
    artistHandle: '@ethanpark',
    tags: ['Micro realism', 'Fineline', 'Study'],
    likes: 301,
    createdAt: '2026-03-17T21:05:00.000Z',
    description: 'A micro-realism style render tuned for fine line detail.',
    model: 'Monk',
    renderSrc: makeDummyRenderSvg({
      bg1: '#101820',
      bg2: '#1a2030',
      ink1: '#ff8c42',
      ink2: '#ff4da6',
      label: 'Micro Realism Study',
    }),
    renderAlt: 'Dummy render preview for Micro Realism Study',
  },
  {
    id: 'post-005',
    title: 'Orchid Type',
    artistName: 'Sophia Reed',
    artistHandle: '@sophia.reed',
    tags: ['Typography', 'Floral', 'Color'],
    likes: 142,
    createdAt: '2026-03-08T13:25:00.000Z',
    description: 'A typography-forward floral layout for poster-like exports.',
    model: 'FinalBaseMesh',
    renderSrc: makeDummyRenderSvg({
      bg1: '#2f1b4e',
      bg2: '#0e0e0e',
      ink1: '#4d7cff',
      ink2: '#ff4da6',
      label: 'Orchid Type',
    }),
    renderAlt: 'Dummy render preview for Orchid Type',
  },
  {
    id: 'post-006',
    title: 'Sunset Script',
    artistName: 'Liam Chen',
    artistHandle: '@liam.chen',
    tags: ['Typography', 'Neotrad', 'Warm'],
    likes: 96,
    createdAt: '2026-03-05T06:40:00.000Z',
    description: 'Warm script strokes with a soft glow to match sunset palettes.',
    model: 'Monk',
    renderSrc: makeDummyRenderSvg({
      bg1: '#1a1a2e',
      bg2: '#3a1c71',
      ink1: '#ffaf7b',
      ink2: '#ff4da6',
      label: 'Sunset Script',
    }),
    renderAlt: 'Dummy render preview for Sunset Script',
  },
  {
    id: 'post-007',
    title: 'Calm Mandala',
    artistName: 'Zoe Malik',
    artistHandle: '@zoe.malik',
    tags: ['Geometric', 'Mandala', 'Minimal'],
    likes: 176,
    createdAt: '2026-03-13T19:02:00.000Z',
    description: 'A mandala layout designed to look balanced across rotations.',
    model: 'FinalBaseMesh',
    renderSrc: makeDummyRenderSvg({
      bg1: '#0e0e11',
      bg2: '#1122aa',
      ink1: '#00d084',
      ink2: '#4d7cff',
      label: 'Calm Mandala',
    }),
    renderAlt: 'Dummy render preview for Calm Mandala',
  },
  {
    id: 'post-008',
    title: 'Rose Shadow',
    artistName: 'Isabella Ford',
    artistHandle: '@isabella.f',
    tags: ['Floral', 'Blackwork', 'Fine lines'],
    likes: 122,
    createdAt: '2026-02-28T10:20:00.000Z',
    description: 'Rose shadows with blackwork shading for a classic tattoo feel.',
    model: 'Monk',
    renderSrc: makeDummyRenderSvg({
      bg1: '#1a2030',
      bg2: '#15151e',
      ink1: '#ff4da6',
      ink2: '#7b5cff',
      label: 'Rose Shadow',
    }),
    renderAlt: 'Dummy render preview for Rose Shadow',
  },
  {
    id: 'post-009',
    title: 'Ocean Lines',
    artistName: 'Daniel Xu',
    artistHandle: '@danielxu',
    tags: ['Minimal', 'Study', 'Fine lines'],
    likes: 204,
    createdAt: '2026-03-16T04:55:00.000Z',
    description: 'A minimal line-study tuned for clean contrast and readability.',
    model: 'FinalBaseMesh',
    renderSrc: makeDummyRenderSvg({
      bg1: '#0b3a4a',
      bg2: '#101820',
      ink1: '#4d7cff',
      ink2: '#00d084',
      label: 'Ocean Lines',
    }),
    renderAlt: 'Dummy render preview for Ocean Lines',
  },
  {
    id: 'post-010',
    title: 'Bold Letterform',
    artistName: 'Olivia Grant',
    artistHandle: '@olivia.grant',
    tags: ['Typography', 'Blackwork', 'Minimal'],
    likes: 159,
    createdAt: '2026-03-01T15:12:00.000Z',
    description: 'Bold letterforms with crisp edges for studio-ready exports.',
    model: 'Monk',
    renderSrc: makeDummyRenderSvg({
      bg1: '#0e0e0e',
      bg2: '#2a1535',
      ink1: '#ff8c42',
      ink2: '#4d7cff',
      label: 'Bold Letterform',
    }),
    renderAlt: 'Dummy render preview for Bold Letterform',
  },
  {
    id: 'post-011',
    title: 'Geometric Halo',
    artistName: 'Henry Wu',
    artistHandle: '@henry.wu',
    tags: ['Geometric', 'Mandala', 'Color'],
    likes: 84,
    createdAt: '2026-02-19T08:05:00.000Z',
    description: 'A geometric halo with subtle color accents for depth.',
    model: 'FinalBaseMesh',
    renderSrc: makeDummyRenderSvg({
      bg1: '#1122aa',
      bg2: '#1a1a2e',
      ink1: '#7b5cff',
      ink2: '#ff8c42',
      label: 'Geometric Halo',
    }),
    renderAlt: 'Dummy render preview for Geometric Halo',
  },
  {
    id: 'post-012',
    title: 'Fineline Whisper',
    artistName: 'Grace Liu',
    artistHandle: '@grace.liu',
    tags: ['Fineline', 'Micro realism', 'Minimal'],
    likes: 247,
    createdAt: '2026-03-14T12:00:00.000Z',
    description: 'Fineline whisper strokes with careful spacing for skin contour.',
    model: 'Monk',
    renderSrc: makeDummyRenderSvg({
      bg1: '#252535',
      bg2: '#ffecd2',
      ink1: '#00d084',
      ink2: '#ff4da6',
      label: 'Fineline Whisper',
    }),
    renderAlt: 'Dummy render preview for Fineline Whisper',
  },
];

export function getAllCommunityTags(posts: CommunityPost[]) {
  const set = new Set<string>();
  for (const p of posts) for (const t of p.tags) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

