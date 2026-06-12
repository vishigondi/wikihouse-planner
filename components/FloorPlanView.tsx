'use client';

import React, { useMemo } from 'react';
import type { RoomLayout, RoomFixture, RoomConnection, RoomPart, SourceWallSegment, SourceOpeningSegment, SourceSpaceFace, SourceDimensionLine } from '@/lib/types';
import { roomPartPath } from '@/lib/room-shapes';
import { drawingStyleOrDefault, type DrawingStyleProfile } from '@/lib/drawing-style';

/* ── constants ─────────────────────────────────────────────────────── */
const GRID = 4; // feet per cell
const PX_PER_FT = 15; // scale factor
const MARGIN = 48; // svg padding in px
const WALL_STROKE = 2.0;
const FIXTURE_STROKE = 1;
const FONT = "'Courier New', 'Courier', monospace";
const BG = '#fdfbf7'; // warm cream
const GRID_COLOR = '#e8e4dd';
const WALL_COLOR = '#1a1a1a';
const LABEL_COLOR = '#333';
const FIXTURE_COLOR = '#7f786f';
const WINDOW_COLOR = '#9fb6bd';
const DECK_DASH = '6,4';
const DOOR_RADIUS = 2.5 * PX_PER_FT; // 2.5ft door swing radius (standard 30in door)
const GEOM_EPS = 0.001;
const VOID_ZONE_PATTERN = /void|open.to.below/i;
type DimensionFrame = {
  gx: number;
  gz: number;
  gw: number;
  gd: number;
  showWidthDimension?: boolean;
  showDepthDimension?: boolean;
  widthSourceAnchorId?: string;
  depthSourceAnchorId?: string;
};

const TRACE_STYLE = {
  bg: '#ffffff',
  grid: '#eeeeea',
  wall: '#4a4640',
  exteriorWall: '#2f2f2d',
  interiorWall: '#55504a',
  guard: '#817970',
  fixture: '#827b71',
  fixtureFill: '#fbfaf7',
  opening: '#faf8f3',
  window: '#aebdc0',
  door: '#888177',
  callout: '#b86e63',
  label: '#3d3934',
  dim: '#746d64',
};

function fixtureOpacity(traceMode = false): number {
  return traceMode ? 0.72 : 1;
}

export interface PlanAnnotations {
  planId: string;
  areaSqft?: number;
  bedBath?: string;
  roofStyle?: string;
  jsonOnly?: boolean;
}

interface Props {
  rooms: RoomLayout[];
  footprint: { width: number; depth: number };
  connections?: RoomConnection[];
  sourceWalls?: SourceWallSegment[];
  sourceOpenings?: SourceOpeningSegment[];
  spaceFaces?: SourceSpaceFace[];
  dimensionLines?: SourceDimensionLine[];
  dimensionFrame?: DimensionFrame;
  floorFrames?: Array<DimensionFrame & { floor: number }>;
  /** Trace mode keeps parsed GPT comparisons close to the source proposal style. */
  traceMode?: boolean;
  drawingStyleProfile?: DrawingStyleProfile;
  /** Title block / north arrow / scale bar overlay (Compare + stored renders). */
  annotations?: PlanAnnotations;
}

function drawingStyleCss(profile: DrawingStyleProfile): string {
  const r = profile.rules;
  return `
		    [data-role="exterior-wall"] rect { stroke: ${r.walls.exteriorStroke} !important; stroke-width: ${r.walls.exteriorStrokeWidthPx}px !important; fill: ${r.walls.exteriorBackingStroke} !important; opacity: ${r.walls.exteriorOpacity} !important; stroke-linecap: ${r.walls.cap}; stroke-linejoin: ${r.walls.join}; }
	    [data-role="exterior-wall"] line[data-wall-line="centerline"] { stroke: ${r.walls.exteriorStroke} !important; stroke-width: ${r.walls.exteriorStrokeWidthPx}px !important; opacity: ${r.walls.exteriorOpacity} !important; stroke-linecap: ${r.walls.cap}; stroke-linejoin: ${r.walls.join}; }
	    [data-role="exterior-wall"] line[data-wall-line="backing"] { stroke: ${r.walls.exteriorBackingStroke} !important; stroke-width: ${r.walls.exteriorBackingStrokeWidthPx}px !important; opacity: ${r.walls.exteriorOpacity}; stroke-linecap: ${r.walls.cap}; stroke-linejoin: ${r.walls.join}; }
		    [data-role="interior-wall"] rect { stroke: ${r.walls.interiorStroke} !important; stroke-width: ${r.walls.interiorStrokeWidthPx}px !important; fill: ${r.walls.exteriorBackingStroke} !important; opacity: ${r.walls.interiorOpacity} !important; stroke-linecap: ${r.walls.cap}; stroke-linejoin: ${r.walls.join}; }
	    [data-role="interior-wall"] line { stroke: ${r.walls.interiorStroke} !important; stroke-width: ${r.walls.interiorStrokeWidthPx}px !important; opacity: ${r.walls.interiorOpacity} !important; stroke-linecap: ${r.walls.cap}; stroke-linejoin: ${r.walls.join}; }
    [data-role="exterior-wall"] rect[data-wall-fill-only="true"],
    [data-role="interior-wall"] rect[data-wall-fill-only="true"] {
      stroke: none !important;
      stroke-width: 0 !important;
    }
    [data-role="interior-wall"] rect[data-source-centerline-body="true"],
    [data-role="guardrail"] rect[data-source-centerline-body="true"] {
      display: none !important;
    }
    [data-role="guardrail"] line { stroke: ${r.walls.guardStroke} !important; stroke-width: ${r.walls.guardStrokeWidthPx}px !important; }
    [data-role="opening-gap"] { stroke: ${r.openings.gapStroke} !important; stroke-width: ${r.openings.gapStrokeWidthPx}px !important; }
    [data-role="window"] line:not([data-role="opening-gap"]),
    [data-role="window"] path,
    [data-role="window"] rect,
    [data-role="window"] polyline {
      stroke: ${r.windows.stroke} !important;
      stroke-width: ${r.windows.strokeWidthPx}px !important;
      opacity: ${r.windows.opacity} !important;
    }
    [data-role="door"] path { stroke: ${r.doors.stroke} !important; stroke-width: ${r.doors.arcStrokeWidthPx}px !important; fill: ${r.doors.fill} !important; opacity: ${r.doors.opacity} !important; }
    [data-role="door"] line:not([data-role="opening-gap"]) { stroke: ${r.doors.stroke} !important; stroke-width: ${r.doors.leafStrokeWidthPx}px !important; opacity: ${r.doors.opacity} !important; }
    [data-role="fixture"] rect, [data-role="fixture"] path, [data-role="fixture"] line, [data-role="fixture"] ellipse, [data-role="fixture"] circle, [data-role="fixture"] polyline { stroke: ${r.fixtures.stroke} !important; stroke-width: ${r.fixtures.strokeWidthPx}px !important; opacity: ${r.fixtures.opacity} !important; }
    [data-role="fixture"] rect, [data-role="fixture"] path, [data-role="fixture"] ellipse, [data-role="fixture"] circle { fill-opacity: ${r.fixtures.opacity} !important; }
    [data-role="stair-symbol"] rect, [data-role="stair-symbol"] line, [data-role="stair-symbol"] path, [data-role="stair-symbol"] polyline { stroke: ${r.stairs.stroke} !important; stroke-width: ${r.stairs.strokeWidthPx}px !important; opacity: ${r.stairs.opacity} !important; }
    [data-role="open-to-below"] line,
    [data-role="open-to-below"] rect,
    [data-role="open-to-below"] path,
    [data-drawing-layer="dashedVoid"] line,
    [data-drawing-layer="dashedVoid"] rect,
    [data-drawing-layer="dashedVoid"] path {
      stroke: ${r.voids.stroke} !important;
      stroke-width: ${r.voids.strokeWidthPx}px !important;
      stroke-dasharray: ${r.voids.dasharray} !important;
      opacity: ${r.voids.opacity} !important;
    }
    [data-role="dimension"] line, [data-role="dimension"] path { stroke: ${r.dimensions.stroke} !important; stroke-width: ${r.dimensions.strokeWidthPx}px !important; opacity: ${r.dimensions.opacity} !important; }
    [data-role="dimension"] text { fill: ${r.dimensions.stroke} !important; font-size: ${Math.max(13, r.dimensions.fontSizePx)}px !important; opacity: ${r.dimensions.opacity} !important; }
    [data-source-id] rect,
    [data-source-id] line,
    [data-source-id] path,
    [data-source-id] circle,
    [data-source-id] ellipse,
    [data-source-id] polyline {
      vector-effect: non-scaling-stroke;
    }
    [data-role="callout"] circle, [data-role="callout-legend"] circle { fill: ${r.callouts.fill} !important; r: ${r.callouts.radiusPx}px; opacity: ${r.callouts.opacity}; }
    [data-role="callout"] text, [data-role="callout-legend"] text { font-size: ${r.callouts.fontSizePx}px !important; }
    [data-role="room-label"] text { fill: ${r.labels.fill} !important; font-family: ${r.labels.fontFamily}; font-size: ${r.labels.roomFontSizePx}px; font-weight: ${r.labels.fontWeight}; }
    [data-role="floor-title"] { fill: ${r.labels.fill} !important; font-family: ${r.labels.fontFamily}; font-size: ${r.labels.floorTitleFontSizePx}px; font-weight: ${r.labels.fontWeight}; }
  `;
}

/* ── helpers ───────────────────────────────────────────────────────── */

/** Convert grid coords to pixel coords */
function g2p(gridVal: number): number {
  return gridVal * GRID * PX_PER_FT;
}

function formatFt(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}

function roomParts(r: RoomLayout): RoomPart[] {
  return r.parts?.length
    ? r.parts
    : [{ gx: r.gx, gz: r.gz, gw: r.gw, gd: r.gd }];
}

function isVoidZone(room: Pick<RoomLayout, 'type' | 'label'>): boolean {
  return VOID_ZONE_PATTERN.test(`${room.type} ${room.label}`);
}

function isDeckRoom(room: Pick<RoomLayout, 'type' | 'label'>): boolean {
  return room.type === 'deck' || /deck/i.test(room.label);
}

function isVoidMarkerWall(wall: SourceWallSegment): boolean {
  const semanticText = `${wall.wallKind ?? ''}`.toLowerCase();
  const text = `${semanticText} ${wall.id ?? ''}`.toLowerCase();
  if (/exterior-wall|a-frame-wall|entry-low-wall/.test(semanticText)) return false;
  if (/partition|interior-wall/.test(semanticText)) return false;
  if (/guard|rail/.test(text)) return false;
  if (/stair[\s_-]*void|void[\s_-]*boundary|open[\s_-]*to[\s_-]*below/.test(text) || text.includes('open-void-diagonal')) return true;
  return text.includes('voidmarker');
}

function isVoidAreaMarkerWall(wall: SourceWallSegment): boolean {
  const text = `${wall.wallKind ?? ''} ${wall.id ?? ''}`.toLowerCase();
  return /open[\s_-]*void[\s_-]*diagonal|voidmarker|void[\s_-]*cross|open[\s_-]*to[\s_-]*below[\s_-]*cross/.test(text);
}

function isGuideWall(wall: SourceWallSegment): boolean {
  const text = `${wall.wallKind ?? ''} ${wall.id ?? ''}`.toLowerCase();
  return isVoidMarkerWall(wall) || text.includes('dashed') || text.includes('overhead');
}

function isGuardRailWall(wall: SourceWallSegment): boolean {
  const text = `${wall.wallKind ?? ''} ${wall.id ?? ''}`.toLowerCase();
  return text.includes('guardrail') || text.includes('guard-rail') || text.includes('guard');
}

function traceLegendLabel(label: string): string {
  const text = label.replace(/^Open /, '');
  if (/ladder access/i.test(text) && !/loft above/i.test(text)) return 'Ladder Accessed Loft Above';
  return text;
}

function spaceFaceParts(face: SourceSpaceFace): RoomPart[] {
  return face.parts?.length
    ? face.parts
    : [{ gx: face.gx, gz: face.gz, gw: face.gw, gd: face.gd }];
}

function roomGridBounds(r: RoomLayout) {
  const parts = roomParts(r);
  const gx = Math.min(...parts.map(part => part.gx));
  const gz = Math.min(...parts.map(part => part.gz));
  const maxGx = Math.max(...parts.map(part => part.gx + part.gw));
  const maxGz = Math.max(...parts.map(part => part.gz + part.gd));
  return { gx, gz, gw: maxGx - gx, gd: maxGz - gz };
}

function spaceFaceGridBounds(face: SourceSpaceFace) {
  const parts = spaceFaceParts(face);
  const gx = Math.min(...parts.map(part => part.gx));
  const gz = Math.min(...parts.map(part => part.gz));
  const maxGx = Math.max(...parts.map(part => part.gx + part.gw));
  const maxGz = Math.max(...parts.map(part => part.gz + part.gd));
  return { gx, gz, gw: maxGx - gx, gd: maxGz - gz };
}

function isVoidSpaceFace(face: SourceSpaceFace) {
  const text = `${face.kind ?? ''} ${face.type ?? ''} ${face.symbolVariant ?? ''} ${face.roomId ?? ''} ${face.id ?? ''}`.toLowerCase();
  return /void|open.to.below/.test(text);
}

/** Room pixel bounds (top-left origin) */
function roomRect(r: RoomLayout) {
  const bounds = roomGridBounds(r);
  return {
    x: g2p(bounds.gx),
    y: g2p(bounds.gz),
    w: g2p(bounds.gw),
    h: g2p(bounds.gd),
    cx: g2p(bounds.gx) + g2p(bounds.gw) / 2,
    cy: g2p(bounds.gz) + g2p(bounds.gd) / 2,
  };
}

function partRect(part: RoomPart) {
  return {
    x: g2p(part.gx),
    y: g2p(part.gz),
    w: g2p(part.gw),
    h: g2p(part.gd),
  };
}

function roomVisualCenter(r: RoomLayout) {
  const parts = roomParts(r);
  let areaSum = 0;
  let xSum = 0;
  let ySum = 0;
  let largest = partRect(parts[0]);
  for (const part of parts) {
    const rect = partRect(part);
    const area = Math.max(0, rect.w) * Math.max(0, rect.h);
    areaSum += area;
    xSum += (rect.x + rect.w / 2) * area;
    ySum += (rect.y + rect.h / 2) * area;
    if (rect.w * rect.h > largest.w * largest.h) largest = rect;
  }
  if (
    r.anchor &&
    Number.isFinite(r.anchor.gx) &&
    Number.isFinite(r.anchor.gz)
  ) {
    return { cx: g2p(r.anchor.gx), cy: g2p(r.anchor.gz), labelWidth: largest.w };
  }
  if (areaSum <= GEOM_EPS) {
    const bounds = roomRect(r);
    return { cx: bounds.cx, cy: bounds.cy, labelWidth: bounds.w };
  }
  return {
    cx: xSum / areaSum,
    cy: ySum / areaSum,
    labelWidth: largest.w,
  };
}

type SharedGridEdge = {
  orientation: 'vertical' | 'horizontal';
  fixed: number;
  start: number;
  end: number;
  aSide: 'top' | 'bottom' | 'left' | 'right';
};

function sharedPartEdges(a: RoomPart, b: RoomPart): SharedGridEdge[] {
  const edges: SharedGridEdge[] = [];
  const aL = a.gx, aR = a.gx + a.gw, aT = a.gz, aB = a.gz + a.gd;
  const bL = b.gx, bR = b.gx + b.gw, bT = b.gz, bB = b.gz + b.gd;

  if (Math.abs(aR - bL) < GEOM_EPS && aT < bB - GEOM_EPS && aB > bT + GEOM_EPS) {
    edges.push({ orientation: 'vertical', fixed: aR, start: Math.max(aT, bT), end: Math.min(aB, bB), aSide: 'right' });
  }
  if (Math.abs(bR - aL) < GEOM_EPS && aT < bB - GEOM_EPS && aB > bT + GEOM_EPS) {
    edges.push({ orientation: 'vertical', fixed: aL, start: Math.max(aT, bT), end: Math.min(aB, bB), aSide: 'left' });
  }
  if (Math.abs(aB - bT) < GEOM_EPS && aL < bR - GEOM_EPS && aR > bL + GEOM_EPS) {
    edges.push({ orientation: 'horizontal', fixed: aB, start: Math.max(aL, bL), end: Math.min(aR, bR), aSide: 'bottom' });
  }
  if (Math.abs(bB - aT) < GEOM_EPS && aL < bR - GEOM_EPS && aR > bL + GEOM_EPS) {
    edges.push({ orientation: 'horizontal', fixed: aT, start: Math.max(aL, bL), end: Math.min(aR, bR), aSide: 'top' });
  }

  return edges;
}

function sharedRoomEdges(a: RoomLayout, b: RoomLayout): SharedGridEdge[] {
  return roomParts(a)
    .flatMap(ap => roomParts(b).flatMap(bp => sharedPartEdges(ap, bp)))
    .sort((edgeA, edgeB) => (edgeB.end - edgeB.start) - (edgeA.end - edgeA.start));
}

function edgeKey(edge: SharedGridEdge): string {
  if (edge.orientation === 'vertical') {
    return `${g2p(edge.fixed)},${g2p(edge.start)},${g2p(edge.fixed)},${g2p(edge.end)}`;
  }
  return `${g2p(edge.start)},${g2p(edge.fixed)},${g2p(edge.end)},${g2p(edge.fixed)}`;
}

function edgeMatchesOpening(edge: SharedGridEdge, opening?: RoomConnection['opening']): boolean {
  if (!opening) return true;
  const verticalOpening = Math.abs(opening.x1 - opening.x2) < GEOM_EPS;
  const horizontalOpening = Math.abs(opening.z1 - opening.z2) < GEOM_EPS;
  if (edge.orientation === 'vertical' && verticalOpening) {
    const start = Math.min(opening.z1, opening.z2);
    const end = Math.max(opening.z1, opening.z2);
    return Math.abs(opening.x1 - edge.fixed) < GEOM_EPS
      && Math.abs(opening.x2 - edge.fixed) < GEOM_EPS
      && end > edge.start + GEOM_EPS
      && start < edge.end - GEOM_EPS;
  }
  if (edge.orientation === 'horizontal' && horizontalOpening) {
    const start = Math.min(opening.x1, opening.x2);
    const end = Math.max(opening.x1, opening.x2);
    return Math.abs(opening.z1 - edge.fixed) < GEOM_EPS
      && Math.abs(opening.z2 - edge.fixed) < GEOM_EPS
      && end > edge.start + GEOM_EPS
      && start < edge.end - GEOM_EPS;
  }
  return false;
}

/** Fixture pixel rect */
function fixRect(fix: RoomFixture) {
  return {
    x: fix.x * GRID * PX_PER_FT,
    y: fix.z * GRID * PX_PER_FT,
    w: (fix.w || 1) * GRID * PX_PER_FT,
    h: (fix.d || 1) * GRID * PX_PER_FT,
  };
}

function fixtureText(fix: RoomFixture): string {
  return `${fix.type} ${fix.desc ?? ''} ${fix.symbolVariant ?? ''}`.toLowerCase();
}

function insetRect(r: { x: number; y: number; w: number; h: number }, inset: number) {
  const safeInset = Math.min(inset, Math.max(0, Math.min(r.w, r.h) / 2 - 1));
  return {
    x: r.x + safeInset,
    y: r.y + safeInset,
    w: Math.max(1, r.w - safeInset * 2),
    h: Math.max(1, r.h - safeInset * 2),
  };
}

/* ── fixture renderers ─────────────────────────────────────────────── */

function renderCounter(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  // Source proposals draw casework as light cabinet outlines, not heavy filled bars.
  const railInset = 3;
  let x1 = r.x + railInset;
  let y1 = r.y + railInset;
  let x2 = r.x + r.w - railInset;
  let y2 = y1;
  if (fix.wall === 'back') {
    y1 = r.y + r.h - railInset;
    y2 = y1;
  } else if (fix.wall === 'left') {
    x1 = r.x + railInset;
    x2 = x1;
    y1 = r.y + railInset;
    y2 = r.y + r.h - railInset;
  } else if (fix.wall === 'right') {
    x1 = r.x + r.w - railInset;
    x2 = x1;
    y1 = r.y + railInset;
    y2 = r.y + r.h - railInset;
  }
  return (
    <g key={key}>
      <rect x={r.x + 1.5} y={r.y + 1.5} width={Math.max(1, r.w - 3)} height={Math.max(1, r.h - 3)}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.9} strokeDasharray="5,4" opacity={0.58} />
      <line x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={FIXTURE_COLOR} strokeWidth={1.25} opacity={0.82} />
    </g>
  );
}

function renderIsland(_fix: RoomFixture, key: string) {
  const r = fixRect(_fix);
  const text = fixtureText(_fix);
  const partRender = renderFixtureParts(_fix, `${key}-parts`);
  if (/plain[-_\s]*rectangular[-_\s]*island/.test(text)) {
    const inset = 1.5;
    return (
      <g key={key}>
        <rect
          x={r.x + inset}
          y={r.y + inset}
          width={Math.max(1, r.w - inset * 2)}
          height={Math.max(1, r.h - inset * 2)}
          fill={FIXTURE_COLOR}
          fillOpacity={0.12}
          stroke={FIXTURE_COLOR}
          strokeWidth={0.85}
          opacity={0.58}
        />
      </g>
    );
  }
  const inset = Math.min(8, Math.max(2, Math.min(r.w, r.h) * 0.12));
  const stools = /stool|three/.test(text)
    ? [0.28, 0.5, 0.72].map((x, index) => (
      <circle
        key={`stool-${index}`}
        cx={r.x + r.w * x}
        cy={r.y + r.h + Math.max(4, r.h * 0.2)}
        r={Math.max(2, Math.min(r.w, r.h) * 0.12)}
        fill="none"
        stroke={FIXTURE_COLOR}
        strokeWidth={0.55}
        opacity={0.3}
      />
    ))
    : null;
  return (
    <g key={key}>
      <rect
        x={r.x + inset} y={r.y + inset}
        width={Math.max(1, r.w - inset * 2)} height={Math.max(1, r.h - inset * 2)}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE}
        strokeDasharray="4,3" opacity={0.58} />
      {partRender}
      {stools}
    </g>
  );
}

function renderTub(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 6;
  const ix = r.x + inset, iy = r.y + inset;
  const iw = r.w - inset * 2, ih = r.h - inset * 2;
  const rr = Math.min(iw, ih) * 0.4; // rounded end radius
  // Rectangle with one rounded end (back wall = round bottom)
  let rx = '0', ry = '0';
  if (fix.wall === 'back' || fix.wall === 'right') {
    // round the far corners
    rx = String(rr);
    ry = String(rr);
  }
  return (
    <g key={key}>
      <rect x={ix} y={iy} width={iw} height={ih}
        rx={rx} ry={ry}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE + 0.5} opacity={0.6} />
      {/* Inner oval for basin */}
      <ellipse cx={ix + iw / 2} cy={iy + ih / 2}
        rx={iw * 0.35} ry={ih * 0.35}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
    </g>
  );
}

function renderVanity(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 6;
  return (
    <g key={key}>
      <rect x={r.x + inset} y={r.y + inset}
        width={r.w - inset * 2} height={r.h - inset * 2}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.6} />
      {/* Sink basin circle */}
      <circle cx={r.x + r.w / 2} cy={r.y + r.h / 2}
        r={Math.min(r.w, r.h) * 0.18}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.5} />
    </g>
  );
}

function renderShower(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 4;
  const ix = r.x + inset;
  const iy = r.y + inset;
  const iw = Math.max(1, r.w - inset * 2);
  const ih = Math.max(1, r.h - inset * 2);
  return (
    <g key={key}>
      <rect x={ix} y={iy} width={iw} height={ih} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.55} />
      <line x1={ix} y1={iy} x2={ix + iw} y2={iy + ih} stroke={FIXTURE_COLOR} strokeWidth={0.65} opacity={0.35} />
      <line x1={ix + iw} y1={iy} x2={ix} y2={iy + ih} stroke={FIXTURE_COLOR} strokeWidth={0.65} opacity={0.35} />
    </g>
  );
}

function renderStorage(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 3;
  const ix = r.x + inset;
  const iy = r.y + inset;
  const iw = Math.max(1, r.w - inset * 2);
  const ih = Math.max(1, r.h - inset * 2);
  return (
    <g key={key}>
      <rect x={ix} y={iy} width={iw} height={ih} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.45} />
    </g>
  );
}

function fixturePartRect(part: NonNullable<RoomFixture['parts']>[number]) {
  if (
    typeof part.x !== 'number' ||
    typeof part.z !== 'number' ||
    typeof part.w !== 'number' ||
    typeof part.d !== 'number'
  ) return null;
  return {
    x: part.x * GRID * PX_PER_FT,
    y: part.z * GRID * PX_PER_FT,
    w: part.w * GRID * PX_PER_FT,
    h: part.d * GRID * PX_PER_FT,
  };
}

function partRotationTransform(rect: { x: number; y: number; w: number; h: number }, part: NonNullable<RoomFixture['parts']>[number]) {
  const deg = typeof part.rotationDeg === 'number' && Number.isFinite(part.rotationDeg) ? part.rotationDeg : 0;
  return deg ? `rotate(${deg} ${rect.x + rect.w / 2} ${rect.y + rect.h / 2})` : undefined;
}

function renderFurniturePart(part: NonNullable<RoomFixture['parts']>[number], index: number) {
  const rect = fixturePartRect(part);
  if (!rect) return null;
  const type = `${part.type ?? ''}`.toLowerCase();
  const transform = partRotationTransform(rect, part);
  if (/sofa|sectional/.test(type)) {
    const inset = Math.max(1.5, Math.min(rect.w, rect.h) * 0.08);
    const back = Math.max(2, Math.min(rect.w, rect.h) * 0.18);
    return (
      <g key={index} transform={transform}>
        <rect x={rect.x + inset} y={rect.y + inset} width={Math.max(1, rect.w - inset * 2)} height={Math.max(1, rect.h - inset * 2)}
          rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.46} />
        <rect x={rect.x + inset} y={rect.y + inset} width={Math.max(1, rect.w - inset * 2)} height={back}
          rx="1.5" fill={FIXTURE_COLOR} opacity={0.12} />
        <line x1={rect.x + rect.w / 2} y1={rect.y + inset + back} x2={rect.x + rect.w / 2} y2={rect.y + rect.h - inset}
          stroke={FIXTURE_COLOR} strokeWidth={0.45} opacity={0.28} />
      </g>
    );
  }
  if (/lounge|chair/.test(type)) {
    const inset = Math.max(1, Math.min(rect.w, rect.h) * 0.12);
    return (
      <g key={index} transform={transform}>
        <rect x={rect.x + inset} y={rect.y + inset} width={Math.max(1, rect.w - inset * 2)} height={Math.max(1, rect.h - inset * 2)}
          rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.65} opacity={0.44} />
        <line x1={rect.x + inset} y1={rect.y + rect.h * 0.34} x2={rect.x + rect.w - inset} y2={rect.y + rect.h * 0.34}
          stroke={FIXTURE_COLOR} strokeWidth={0.5} opacity={0.3} />
      </g>
    );
  }
  if (/coffee.*table|table/.test(type)) {
    const inset = Math.max(1, Math.min(rect.w, rect.h) * 0.12);
    const nearSquare = Math.abs(rect.w - rect.h) < Math.max(rect.w, rect.h) * 0.22;
    return nearSquare ? (
      <ellipse key={index} transform={transform} cx={rect.x + rect.w / 2} cy={rect.y + rect.h / 2}
        rx={Math.max(2, rect.w / 2 - inset)} ry={Math.max(2, rect.h / 2 - inset)}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.65} opacity={0.42} />
    ) : (
      <rect key={index} transform={transform} x={rect.x + inset} y={rect.y + inset}
        width={Math.max(1, rect.w - inset * 2)} height={Math.max(1, rect.h - inset * 2)}
        rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.65} opacity={0.42} />
    );
  }
  return null;
}

function renderFixtureParts(fix: RoomFixture, key: string) {
  if (!fix.parts?.length) return null;
  const partElements = fix.parts.map((part, index) => {
    const type = `${part.type ?? ''}`.toLowerCase();
    const furniturePart = renderFurniturePart(part, index);
    if (furniturePart) return furniturePart;
    if (Array.isArray(part.center) && typeof part.radius === 'number') {
      return (
        <circle
          key={index}
          cx={part.center[0] * GRID * PX_PER_FT}
          cy={part.center[1] * GRID * PX_PER_FT}
          r={part.radius * GRID * PX_PER_FT}
          fill="none"
          stroke={FIXTURE_COLOR}
          strokeWidth={0.75}
          opacity={0.42}
        />
      );
    }
    const rect = fixturePartRect(part);
    if (!rect) return null;
    const transform = partRotationTransform(rect, part);
    if (/sink|basin/.test(type)) {
      return (
        <ellipse
          key={index}
          transform={transform}
          cx={rect.x + rect.w / 2}
          cy={rect.y + rect.h / 2}
          rx={Math.max(2, rect.w * 0.32)}
          ry={Math.max(2, rect.h * 0.28)}
          fill="none"
          stroke={FIXTURE_COLOR}
          strokeWidth={0.65}
          opacity={0.44}
        />
      );
    }
    if (/cooktop|range|stove/.test(type)) {
      const burnerR = Math.max(1.6, Math.min(rect.w, rect.h) * 0.16);
      return (
        <g key={index} transform={transform}>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.55} opacity={0.28} />
          {[0.35, 0.65].flatMap((x) => [0.35, 0.65].map((y) => (
            <circle key={`${x}-${y}`} cx={rect.x + rect.w * x} cy={rect.y + rect.h * y} r={burnerR} fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.55} opacity={0.42} />
          )))}
        </g>
      );
    }
    if (/dishwasher|washer|dryer|appliance/.test(type)) {
      return (
        <g key={index} transform={transform}>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} rx="1.5" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.55} opacity={0.32} />
          <text x={rect.x + rect.w / 2} y={rect.y + rect.h / 2 + 2} textAnchor="middle" fontSize="4.5" fill={FIXTURE_COLOR} opacity={0.44}>
            {/dryer|dr\b/.test(type) ? 'DR' : /washer/.test(type) ? 'W' : 'DW'}
          </text>
        </g>
      );
    }
    if (/cabinet|counter|casework|base/.test(type)) {
      return (
        <g key={index} transform={transform}>
          <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.45} strokeDasharray="5,4" opacity={0.3} />
          <line x1={rect.x} y1={rect.y + rect.h * 0.5} x2={rect.x + rect.w} y2={rect.y + rect.h * 0.5} stroke={FIXTURE_COLOR} strokeWidth={0.55} opacity={0.28} />
        </g>
      );
    }
    return (
      <rect
        key={index}
        transform={transform}
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        rx="2"
        fill="none"
        stroke={FIXTURE_COLOR}
        strokeWidth={/sofa|chair|table/.test(type) ? 0.55 : 0.5}
        opacity={/sofa|chair|table/.test(type) ? 0.32 : 0.24}
      />
    );
  }).filter(Boolean);
  if (!partElements.length) return null;
  return <g key={key}>{partElements}</g>;
}

function renderRefrigerator(fix: RoomFixture, key: string) {
  const r = insetRect(fixRect(fix), 2);
  return (
    <g key={key}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.65} opacity={0.38} />
    </g>
  );
}

function renderGenericFixture(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  return (
    <g key={key}>
      <rect
        x={r.x + 3}
        y={r.y + 3}
        width={Math.max(1, r.w - 6)}
        height={Math.max(1, r.h - 6)}
        fill="none"
        stroke={FIXTURE_COLOR}
        strokeWidth={FIXTURE_STROKE}
        opacity={0.38}
      />
    </g>
  );
}

function renderToilet(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = Math.min(r.w, r.h);
  const tankW = Math.max(s * 0.46, r.w * 0.38);
  const tankH = Math.max(s * 0.2, r.h * 0.18);
  // Tank rectangle (at wall side)
  const tankX = cx - tankW / 2;
  let tankY: number;
  if (fix.wall === 'front' || fix.wall === 'left') {
    tankY = r.y + Math.max(2, s * 0.08);
  } else {
    tankY = r.y + r.h - tankH - Math.max(2, s * 0.08);
  }
  return (
    <g key={key}>
      {/* Tank */}
      <rect x={tankX} y={tankY} width={tankW} height={tankH}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.6}
        rx="2" />
      {/* Bowl (oval) */}
      <ellipse cx={cx} cy={cy}
        rx={Math.max(s * 0.24, r.w * 0.22)} ry={Math.max(s * 0.34, r.h * 0.28)}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.6} />
    </g>
  );
}

function renderBed(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 6;
  const ix = r.x + inset, iy = r.y + inset;
  const iw = r.w - inset * 2, ih = r.h - inset * 2;
  const hasSeparatePillowPrimitive = Boolean((fix as RoomFixture & { hasSeparatePillowPrimitive?: boolean }).hasSeparatePillowPrimitive);
  const text = fixtureText(fix);
  const headboardSide = /headboard[-_\s]*north/.test(text)
    ? 'north'
    : /headboard[-_\s]*south/.test(text)
      ? 'south'
      : /headboard[-_\s]*east/.test(text)
        ? 'east'
        : /headboard[-_\s]*west/.test(text)
          ? 'west'
          : undefined;
  // Pillow line at the head (wall side)
  const pillowY = headboardSide === 'north' || (!headboardSide && fix.wall === 'front')
    ? iy + ih * 0.15
    : headboardSide === 'south' || !headboardSide
      ? iy + ih * 0.85
      : iy + ih * 0.15;
  const verticalPillows = headboardSide === 'east' || headboardSide === 'west';
  const pillowX = headboardSide === 'west'
    ? ix + iw * 0.15
    : headboardSide === 'east'
      ? ix + iw * 0.85
      : undefined;
  return (
    <g key={key}>
      <rect x={ix} y={iy} width={iw} height={ih}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.5} />
      {/* Source proposals show bed pillows as light rectangles rather than a heavy headboard line. */}
      {!hasSeparatePillowPrimitive && verticalPillows && typeof pillowX === 'number' ? (
        <>
          <rect x={pillowX - 5} y={iy + 6} width={10} height={ih * 0.35}
            rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
          <rect x={pillowX - 5} y={iy + ih - 6 - ih * 0.35} width={10} height={ih * 0.35}
            rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
        </>
      ) : !hasSeparatePillowPrimitive ? (
        <>
          <rect x={ix + 6} y={pillowY - 5} width={iw * 0.35} height={10}
            rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
          <rect x={ix + iw - 6 - iw * 0.35} y={pillowY - 5} width={iw * 0.35} height={10}
            rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
        </>
      ) : null}
    </g>
  );
}

function renderSoftFurniture(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const label = (fix as RoomFixture & { label?: string }).label;
  const variant = `${fix.symbolVariant ?? ''} ${label ?? ''}`.toLowerCase();
  if (variant.includes('pillow')) {
    const insetX = Math.max(1, Math.min(r.w * 0.08, 4));
    const insetY = Math.max(1, Math.min(r.h * 0.06, 4));
    const gap = Math.max(1, Math.min(r.h * 0.06, 4));
    const pillowH = Math.max(4, (r.h - insetY * 2 - gap) / 2);
    const pillowW = Math.max(4, r.w - insetX * 2);
    return (
      <g key={key}>
        <rect x={r.x + insetX} y={r.y + insetY} width={pillowW} height={pillowH}
          rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.5} />
        <rect x={r.x + insetX} y={r.y + insetY + pillowH + gap} width={pillowW} height={pillowH}
          rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.5} />
      </g>
    );
  }
  return renderSofa(fix, key);
}

function renderSofa(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const text = fixtureText(fix);
  if (text.includes('sofa_chairs_coffee_table')) {
    const partRender = renderFixtureParts(fix, `${key}-parts`);
    if (partRender) return <g key={key}>{partRender}</g>;
    const area = insetRect(r, 2);
    return (
      <g key={key}>
        <rect x={area.x + area.w * 0.18} y={area.y + area.h * 0.18} width={area.w * 0.18} height={area.h * 0.36} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.42} />
        <rect x={area.x + area.w * 0.74} y={area.y + area.h * 0.08} width={area.w * 0.18} height={area.h * 0.38} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.42} />
        <rect x={area.x + area.w * 0.56} y={area.y + area.h * 0.38} width={area.w * 0.16} height={area.h * 0.22} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.34} />
        <rect x={area.x + area.w * 0.62} y={area.y + area.h * 0.72} width={area.w * 0.17} height={area.h * 0.14} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.38} />
      </g>
    );
  }
  const partRender = renderFixtureParts(fix, key);
  if (partRender) return partRender;
  if (text.includes('chair') || text.includes('coffee') || text.includes('living')) {
    const area = insetRect(r, 2);
    const horizontal = area.w >= area.h;
    const pieces: React.ReactElement[] = [];

    if (horizontal) {
      const sofaW = area.w * 0.36;
      const sofaH = area.h * 0.28;
      const coffeeW = area.w * 0.23;
      const coffeeH = area.h * 0.16;
      const chairW = Math.min(area.w * 0.18, area.h * 0.24);
      const chairH = Math.min(area.h * 0.28, area.w * 0.16);
      const cy = area.y + area.h * 0.5;
      pieces.push(
        <rect key="sofa-a" x={area.x + area.w * 0.08} y={area.y + area.h * 0.17} width={sofaW} height={sofaH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.45} />,
        <rect key="sofa-b" x={area.x + area.w * 0.56} y={area.y + area.h * 0.16} width={sofaW} height={sofaH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.45} />,
        <rect key="coffee" x={area.x + area.w / 2 - coffeeW / 2} y={cy - coffeeH / 2} width={coffeeW} height={coffeeH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.38} />,
        <rect key="chair-a" x={area.x + area.w * 0.16} y={area.y + area.h * 0.62} width={chairW} height={chairH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.4} />,
        <rect key="chair-b" x={area.x + area.w * 0.68} y={area.y + area.h * 0.62} width={chairW} height={chairH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.4} />,
      );
    } else {
      const sofaW = area.w * 0.36;
      const sofaH = area.h * 0.32;
      const coffeeW = area.w * 0.22;
      const coffeeH = area.h * 0.18;
      const chairW = area.w * 0.26;
      const chairH = area.h * 0.16;
      const cx = area.x + area.w * 0.5;
      pieces.push(
        <rect key="sofa-a" x={area.x + area.w * 0.12} y={area.y + area.h * 0.07} width={sofaW} height={sofaH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.45} />,
        <rect key="sofa-b" x={area.x + area.w * 0.52} y={area.y + area.h * 0.55} width={sofaW} height={sofaH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.45} />,
        <rect key="coffee" x={cx - coffeeW / 2} y={area.y + area.h / 2 - coffeeH / 2} width={coffeeW} height={coffeeH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.38} />,
        <rect key="chair-a" x={area.x + area.w * 0.58} y={area.y + area.h * 0.18} width={chairW} height={chairH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.4} />,
        <rect key="chair-b" x={area.x + area.w * 0.16} y={area.y + area.h * 0.68} width={chairW} height={chairH} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.4} />,
      );
    }

    return (
      <g key={key}>
        <rect x={area.x} y={area.y} width={area.w} height={area.h} rx="2" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.45} opacity={0.16} />
        {pieces}
      </g>
    );
  }

  const inset = 6;
  const ix = r.x + inset, iy = r.y + inset;
  const iw = r.w - inset * 2, ih = r.h - inset * 2;
  const backH = ih * 0.25;
  return (
    <g key={key}>
      {/* Seat */}
      <rect x={ix} y={iy + backH} width={iw} height={ih - backH}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.5} />
      {/* Back rest (thicker) */}
      <rect x={ix} y={iy} width={iw} height={backH}
        fill={FIXTURE_COLOR} stroke="none" opacity={0.25} />
      <rect x={ix} y={iy} width={iw} height={backH}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE + 0.5} opacity={0.5} />
      {/* Arm rests */}
      <rect x={ix} y={iy + backH} width={iw * 0.08} height={ih - backH}
        fill={FIXTURE_COLOR} opacity={0.2} />
      <rect x={ix + iw - iw * 0.08} y={iy + backH} width={iw * 0.08} height={ih - backH}
        fill={FIXTURE_COLOR} opacity={0.2} />
    </g>
  );
}

function renderChair(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 5;
  const ix = r.x + inset;
  const iy = r.y + inset;
  const iw = r.w - inset * 2;
  const ih = r.h - inset * 2;
  return (
    <g key={key}>
      <rect x={ix} y={iy + ih * 0.25} width={iw} height={ih * 0.75}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.45} rx="2" />
      <rect x={ix} y={iy} width={iw} height={ih * 0.3}
        fill={FIXTURE_COLOR} stroke="none" opacity={0.18} />
    </g>
  );
}

function renderCoffeeTable(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = Math.min(12, Math.max(2, Math.min(r.w, r.h) * 0.3));
  return (
    <rect key={key}
      x={r.x + inset} y={r.y + inset}
      width={r.w - inset * 2} height={r.h - inset * 2}
      fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.4}
      rx="2" />
  );
}

function renderDiningTable(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const text = fixtureText(fix);
  if (text.includes('round') || text.includes('six_chair') || text.includes('six chair')) {
    const area = insetRect(r, 2);
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const tableR = Math.max(4, Math.min(area.w, area.h) * 0.25);
    const chairW = Math.max(3, Math.min(area.w, area.h) * 0.16);
    const chairH = Math.max(3, Math.min(area.w, area.h) * 0.1);
    const chairRadiusX = Math.max(tableR + chairH * 1.6, area.w * 0.4);
    const chairRadiusY = Math.max(tableR + chairH * 1.6, area.h * 0.4);
    const visibleChairCount = text.includes('six') ? 4 : 4;
    const chairs = Array.from({ length: visibleChairCount }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / visibleChairCount;
      const x = cx + Math.cos(angle) * chairRadiusX - chairW / 2;
      const y = cy + Math.sin(angle) * chairRadiusY - chairH / 2;
      const deg = angle * 180 / Math.PI + 90;
      return (
        <rect
          key={`round-chair-${index}`}
          x={x}
          y={y}
          width={chairW}
          height={chairH}
          rx="1"
          transform={`rotate(${deg} ${x + chairW / 2} ${y + chairH / 2})`}
          fill="none"
          stroke={FIXTURE_COLOR}
          strokeWidth={0.7}
          opacity={0.42}
        />
      );
    });
    return (
      <g key={key}>
        <circle cx={cx} cy={cy} r={tableR} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.48} />
        {chairs}
      </g>
    );
  }

  const partRender = renderFixtureParts(fix, key);
  if (partRender) return partRender;

  const inset = 10;
  const ix = r.x + inset, iy = r.y + inset;
  const iw = r.w - inset * 2, ih = r.h - inset * 2;
  // Chair marks: small arcs along long sides
  const chairs: React.ReactElement[] = [];
  const chairSize = 4;
  const numChairsLong = Math.max(2, Math.floor(iw / 20));
  for (let i = 0; i < numChairsLong; i++) {
    const cx = ix + (i + 0.5) * (iw / numChairsLong);
    // Top side
    chairs.push(
      <rect key={`ct-${i}`} x={cx - chairSize} y={iy - chairSize * 2.5}
        width={chairSize * 2} height={chairSize * 1.5}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} rx="1" />
    );
    // Bottom side
    chairs.push(
      <rect key={`cb-${i}`} x={cx - chairSize} y={iy + ih + chairSize}
        width={chairSize * 2} height={chairSize * 1.5}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} rx="1" />
    );
  }
  return (
    <g key={key}>
      <rect x={ix} y={iy} width={iw} height={ih}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.5} rx="2" />
      {chairs}
    </g>
  );
}

function renderShelves(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 4;
  // Parallel lines along the wall
  const isVertical = fix.wall === 'left' || fix.wall === 'right';
  const lines: React.ReactElement[] = [];
  const numLines = 2;
  if (isVertical) {
    const step = (r.w - inset * 2) / (numLines + 1);
    for (let i = 1; i <= numLines; i++) {
      lines.push(
        <line key={i}
          x1={r.x + inset + step * i} y1={r.y + inset}
          x2={r.x + inset + step * i} y2={r.y + r.h - inset}
          stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
      );
    }
  } else {
    const step = (r.h - inset * 2) / (numLines + 1);
    for (let i = 1; i <= numLines; i++) {
      lines.push(
        <line key={i}
          x1={r.x + inset} y1={r.y + inset + step * i}
          x2={r.x + r.w - inset} y2={r.y + inset + step * i}
          stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
      );
    }
  }
  return (
    <g key={key}>
      <rect x={r.x + inset} y={r.y + inset}
        width={r.w - inset * 2} height={r.h - inset * 2}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.3} />
      {lines}
    </g>
  );
}

function renderWindow(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  // Thin blue rectangle along the exterior wall edge
  const thickness = 4;
  let x = r.x, y = r.y, w = r.w, h = thickness;
  if (fix.wall === 'front') { y = r.y + 2; w = r.w; }
  else if (fix.wall === 'back') { y = r.y + r.h - thickness - 2; w = r.w; }
  else if (fix.wall === 'left') { x = r.x + 2; w = thickness; h = r.h; }
  else if (fix.wall === 'right') { x = r.x + r.w - thickness - 2; w = thickness; h = r.h; }
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h}
        fill={WINDOW_COLOR} stroke={WINDOW_COLOR} strokeWidth={0.5} opacity={0.35} />
      {/* Glass pane lines */}
      {w > h ? (
        // Horizontal window — vertical divider lines
        <>
          <line x1={x + w * 0.33} y1={y} x2={x + w * 0.33} y2={y + h}
            stroke={WINDOW_COLOR} strokeWidth={0.5} opacity={0.5} />
          <line x1={x + w * 0.66} y1={y} x2={x + w * 0.66} y2={y + h}
            stroke={WINDOW_COLOR} strokeWidth={0.5} opacity={0.5} />
        </>
      ) : (
        // Vertical window — horizontal divider lines
        <>
          <line x1={x} y1={y + h * 0.33} x2={x + w} y2={y + h * 0.33}
            stroke={WINDOW_COLOR} strokeWidth={0.5} opacity={0.5} />
          <line x1={x} y1={y + h * 0.66} x2={x + w} y2={y + h * 0.66}
            stroke={WINDOW_COLOR} strokeWidth={0.5} opacity={0.5} />
        </>
      )}
    </g>
  );
}

function renderGlassWall(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  // Dashed blue line along the wall
  let x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y;
  if (fix.wall === 'back') { y1 = r.y + r.h; y2 = r.y + r.h; }
  else if (fix.wall === 'left') { x2 = r.x; y2 = r.y + r.h; }
  else if (fix.wall === 'right') { x1 = r.x + r.w; y1 = r.y; x2 = r.x + r.w; y2 = r.y + r.h; }
  return (
    <line key={key}
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={WINDOW_COLOR} strokeWidth={2}
      strokeDasharray="8,4" opacity={0.5} />
  );
}

function renderExteriorDoor(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const horizontal = fix.wall === 'front' || fix.wall === 'back';
  const x1 = horizontal ? r.x : fix.wall === 'left' ? r.x : r.x + r.w;
  const y1 = horizontal ? (fix.wall === 'front' ? r.y : r.y + r.h) : r.y;
  const x2 = horizontal ? r.x + r.w : x1;
  const y2 = horizontal ? y1 : r.y + r.h;
  const hingeX = x1;
  const hingeY = y1;
  const radius = horizontal ? Math.min(r.w, ENTRY_DOOR_RADIUS) : Math.min(r.h, ENTRY_DOOR_RADIUS);
  const sweepX = horizontal ? hingeX : hingeX + (fix.wall === 'left' ? radius : -radius);
  const sweepY = horizontal ? hingeY + (fix.wall === 'front' ? radius : -radius) : hingeY;
  return (
    <g key={key}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={BG} strokeWidth={WALL_STROKE * 4} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={FIXTURE_COLOR} strokeWidth={0.8} opacity={0.5} />
      <path
        d={`M ${hingeX} ${hingeY} L ${sweepX} ${sweepY}`}
        stroke={FIXTURE_COLOR}
        strokeWidth={0.8}
        opacity={0.45}
        fill="none"
      />
    </g>
  );
}

function renderBench(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 6;
  return (
    <rect key={key}
      x={r.x + inset} y={r.y + inset}
      width={r.w - inset * 2} height={r.h - inset * 2}
      fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.4}
      rx="2" />
  );
}

/** Dispatch fixture rendering by type */
/* ── stove: 4 burner circles on counter ─────────────────────────────── */
function renderStove(fix: RoomFixture, key: string) {
  const { x, y, w, h } = fixRect(fix);
  const cr = Math.min(w, h) * 0.18; // burner radius
  const twoBurner = /two[-_\s]*burner|inline/i.test(fixtureText(fix));
  const burners = twoBurner
    ? [
        [x + w * 0.5, y + h * 0.34],
        [x + w * 0.5, y + h * 0.66],
      ]
    : [
        [x + w * 0.3, y + h * 0.35],
        [x + w * 0.7, y + h * 0.35],
        [x + w * 0.3, y + h * 0.65],
        [x + w * 0.7, y + h * 0.65],
      ];
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      {burners.map(([cx, cy], index) => (
        <circle key={index} cx={cx} cy={cy} r={cr} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      ))}
    </g>
  );
}

/* ── sink: rectangle with oval basin ────────────────────────────────── */
function renderSink(fix: RoomFixture, key: string) {
  const { x, y, w, h } = fixRect(fix);
  const pad = 2;
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2 - pad * 2} ry={h / 2 - pad} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE * 0.8} />
    </g>
  );
}

/* ── nightstand: small rectangle ────────────────────────────────────── */
function renderNightstand(fix: RoomFixture, key: string) {
  const { x, y, w, h } = fixRect(fix);
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE * 0.8} />
      {/* drawer line */}
      <line x1={x + 2} y1={y + h / 2} x2={x + w - 2} y2={y + h / 2} stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE * 0.5} />
    </g>
  );
}

/* ── stairs: parallel lines with direction arrow ─────────────────────── */
function renderStairs(fix: RoomFixture, key: string) {
  const { x, y, w, h } = fixRect(fix);
  const text = fixtureText(fix);
  const treadsOnly = /treads|straight[-_\s]*run/i.test(text);
  const steps = Math.max(5, Math.min(14, Math.round(h / 14)));
  const lines = [];
  for (let i = 1; i < steps; i++) {
    const sy = y + (h * i / steps);
    lines.push(<line key={`s${i}`} x1={x + 1} y1={sy} x2={x + w - 1} y2={sy} stroke={FIXTURE_COLOR} strokeWidth={0.5} />);
  }
  // Arrow showing UP direction
  const arrowY = y + 4;
  const arrowX = x + w / 2;
  return (
    <g key={key}>
      {!treadsOnly ? <rect x={x} y={y} width={w} height={h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} /> : null}
      {lines}
      {/* UP arrow */}
      <polygon points={`${arrowX},${arrowY} ${arrowX - 3},${arrowY + 5} ${arrowX + 3},${arrowY + 5}`}
        fill={FIXTURE_COLOR} />
    </g>
  );
}

function renderLadder(fix: RoomFixture, key: string) {
  const { x, y, w, h } = fixRect(fix);
  const vertical = h >= w;
  const text = fixtureText(fix);
  const sourceStyle = /verticalrungladder|ladder/.test(text);
  const railInset = sourceStyle
    ? Math.min(4, Math.max(1.5, (vertical ? w : h) * 0.16))
    : Math.min(6, Math.max(2, (vertical ? w : h) * 0.24));
  const rungCount = Math.max(sourceStyle ? 7 : 4, Math.floor((vertical ? h : w) / (sourceStyle ? 9 : 12)));
  const railStroke = sourceStyle ? 1.45 : 1.25;
  const rungStroke = sourceStyle ? 1.0 : 0.85;
  const symbolOpacity = sourceStyle ? 0.9 : 0.72;
  const rungs: React.ReactElement[] = [];
  for (let index = 1; index < rungCount; index += 1) {
    const t = index / rungCount;
    if (vertical) {
      const yy = y + h * t;
      rungs.push(
        <line
          key={`rung-${index}`}
          x1={x + railInset}
          y1={yy}
          x2={x + w - railInset}
          y2={yy}
          stroke={FIXTURE_COLOR}
          strokeWidth={rungStroke}
          opacity={symbolOpacity}
        />,
      );
    } else {
      const xx = x + w * t;
      rungs.push(
        <line
          key={`rung-${index}`}
          x1={xx}
          y1={y + railInset}
          x2={xx}
          y2={y + h - railInset}
          stroke={FIXTURE_COLOR}
          strokeWidth={rungStroke}
          opacity={symbolOpacity}
        />,
      );
    }
  }
  return (
    <g key={key}>
      {vertical ? (
        <>
          <line x1={x + railInset} y1={y} x2={x + railInset} y2={y + h} stroke={FIXTURE_COLOR} strokeWidth={railStroke} opacity={symbolOpacity} />
          <line x1={x + w - railInset} y1={y} x2={x + w - railInset} y2={y + h} stroke={FIXTURE_COLOR} strokeWidth={railStroke} opacity={symbolOpacity} />
        </>
      ) : (
        <>
          <line x1={x} y1={y + railInset} x2={x + w} y2={y + railInset} stroke={FIXTURE_COLOR} strokeWidth={railStroke} opacity={symbolOpacity} />
          <line x1={x} y1={y + h - railInset} x2={x + w} y2={y + h - railInset} stroke={FIXTURE_COLOR} strokeWidth={railStroke} opacity={symbolOpacity} />
        </>
      )}
      {rungs}
    </g>
  );
}

function renderOpenToBelow(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 2;
  const x = r.x + inset;
  const y = r.y + inset;
  const w = Math.max(1, r.w - inset * 2);
  const h = Math.max(1, r.h - inset * 2);
  const symbolText = `${fix.type ?? ''} ${fix.symbolVariant ?? ''} ${fix.desc ?? ''}`;
  const diagonalOnly = /diagonal[-_\s]*dashed[-_\s]*x|x[-_\s]*void[-_\s]*marker/i.test(symbolText);
  return (
    <g key={key}>
      {!diagonalOnly ? (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill="none"
          stroke={FIXTURE_COLOR}
          strokeWidth={0.7}
          strokeDasharray="5,5"
          opacity={0.48}
        />
      ) : null}
      <line x1={x} y1={y} x2={x + w} y2={y + h} stroke={FIXTURE_COLOR} strokeWidth={0.7} strokeDasharray="5,5" opacity={0.48} />
      <line x1={x + w} y1={y} x2={x} y2={y + h} stroke={FIXTURE_COLOR} strokeWidth={0.7} strokeDasharray="5,5" opacity={0.48} />
    </g>
  );
}

function fixtureRenderType(fix: RoomFixture): string {
  const text = `${fix.type ?? ''} ${fix.category ?? ''} ${fix.desc ?? ''} ${fix.symbolVariant ?? ''} ${fix.bimClass ?? ''}`.toLowerCase();
  if (/open[-_\s]*to[-_\s]*below|void|diagonal[-_\s]*dashed/.test(text)) return 'open_to_below';
  if (/ladder/.test(text)) return 'ladder';
  if (/stair|tread/.test(text)) return 'stairs';
  if (/refrigerator|fridge|\bref\b/.test(text)) return 'refrigerator';
  if (/island/.test(text)) return 'island';
  if (/closet|storage|shelf|shelves|linen|wardrobe/.test(text)) return 'storage';
  if (/counter[-_\s]*run|casework|base[-_\s]*cabinet/.test(text)) return 'counter';
  if (/cooktop|range|stove|oven/.test(text)) return 'stove';
  if (/vanity[-_\s]*sink|vanity/.test(text)) return 'vanity';
  if (/sink|basin/.test(text)) return 'sink';
  if (/washer/.test(text)) return 'washer';
  if (/dryer/.test(text)) return 'dryer';
  if (/toilet|water[-_\s]*closet/.test(text)) return 'toilet';
  if (/tub|bath/.test(text) && !/bathroom/.test(text)) return 'tub';
  if (/shower/.test(text)) return 'shower';
  if (/bed/.test(text)) return 'bed';
  if (/sofa|sectional/.test(text)) return 'sofa';
  if (/dining.*table|table/.test(text)) return 'dining_table';
  if (/chair|lounge/.test(text)) return 'chair';
  return fix.type;
}

/* ── washer/dryer: circle ────────────────────────────────────────────── */
function renderWasherDryer(fix: RoomFixture, key: string) {
  const { x, y, w, h } = fixRect(fix);
  const r = Math.min(w, h) / 2 - 1;
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      <circle cx={x + w / 2} cy={y + h / 2} r={r} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
    </g>
  );
}

function renderFixture(fix: RoomFixture, key: string): React.ReactElement | null {
  if (fix.x === undefined || fix.z === undefined) return null;
  if (fix.type === 'door_swing' || fix.type === 'pocket_door' || fix.type === 'bifold_door' || fix.type === 'sliding_glass') return null;

  switch (fixtureRenderType(fix)) {
    case 'refrigerator': return renderRefrigerator(fix, key);
    case 'counter': return renderCounter(fix, key);
    case 'island': return renderIsland(fix, key);
    case 'stove': return renderStove(fix, key);
    case 'sink': return renderSink(fix, key);
    case 'open_to_below': return renderOpenToBelow(fix, key);
    case 'stair': return renderStairs(fix, key);
    case 'stairs': return renderStairs(fix, key);
    case 'ladder': return renderLadder(fix, key);
    case 'washer': return renderWasherDryer(fix, key);
    case 'dryer': return renderWasherDryer(fix, key);
    case 'shower': return renderShower(fix, key);
    case 'tub': return renderTub(fix, key);
    case 'vanity': return renderVanity(fix, key);
    case 'toilet': return renderToilet(fix, key);
    case 'bed': return renderBed(fix, key);
    case 'soft_furniture': return renderSoftFurniture(fix, key);
    case 'nightstand': return renderNightstand(fix, key);
    case 'sofa': return renderSofa(fix, key);
    case 'chair': return renderChair(fix, key);
    case 'coffee_table': return renderCoffeeTable(fix, key);
    case 'dining_table': return renderDiningTable(fix, key);
    case 'shelves': return renderShelves(fix, key);
    case 'window': return renderWindow(fix, key);
    case 'glass_wall': return renderGlassWall(fix, key);
    case 'exterior_door': return renderExteriorDoor(fix, key);
    case 'bench': return renderBench(fix, key);
    case 'storage': return renderStorage(fix, key);
    default: return renderGenericFixture(fix, key);
  }
}

/* ── door arc builder ──────────────────────────────────────────────── */

const POCKET_DOOR_RADIUS = 1.5 * PX_PER_FT; // smaller arc for pocket/bathroom doors
const ENTRY_DOOR_RADIUS = 3.0 * PX_PER_FT;  // full 36in entry door swing

/** Room types that get pocket doors (smaller arc, no full swing) */
const POCKET_DOOR_TYPES = new Set([
  'bathroom_full', 'bathroom_half', 'walk_in_closet', 'closet', 'pantry', 'utility',
]);

interface DoorInfo {
  x: number;
  y: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  startAngle: number;
  type: 'door' | 'open' | 'sliding';
  /** Door style controls the symbol used at the explicit opening span. */
  style: 'standard' | 'pocket' | 'entry' | 'bifold';
}

function openingAxis(conn: RoomConnection): 'vertical' | 'horizontal' | null {
  if (!conn.opening) return null;
  const eps = 0.001;
  if (Math.abs(conn.opening.x1 - conn.opening.x2) < eps) return 'vertical';
  if (Math.abs(conn.opening.z1 - conn.opening.z2) < eps) return 'horizontal';
  return null;
}

function openingMidpoint(conn: RoomConnection, axis: 'vertical' | 'horizontal'): { x: number; z: number } | null {
  if (!conn.opening || openingAxis(conn) !== axis) return null;
  return {
    x: (conn.opening.x1 + conn.opening.x2) / 2,
    z: (conn.opening.z1 + conn.opening.z2) / 2,
  };
}

function computeDoors(
  connections: RoomConnection[] | undefined,
  rooms: RoomLayout[],
): DoorInfo[] {
  if (!connections) return [];
  const roomMap = new Map(rooms.map(r => [r.label, r]));
  const result: DoorInfo[] = [];

  for (const conn of connections) {
    if (conn.type === 'wall' || conn.type === 'open') continue; // skip walls and open-plan
    const a = roomMap.get(conn.from);
    const b = roomMap.get(conn.to);
    if (!a || !b) continue;

    const style = doorStyleForConnection(conn, a, b);
    const explicitDoor = doorFromOpening(conn, a, b, style);
    if (explicitDoor) {
      result.push(explicitDoor);
      continue;
    }

    const edge = sharedRoomEdges(a, b).find((item) => edgeMatchesOpening(item, conn.opening))
      ?? sharedRoomEdges(a, b)[0];
    if (!edge) continue;

    if (edge.orientation === 'vertical') {
      const midpoint = openingMidpoint(conn, 'vertical');
      const midY = g2p(midpoint?.z ?? (edge.start + edge.end) / 2);
      const edgeX = g2p(midpoint?.x ?? edge.fixed);
      const start = conn.opening && openingAxis(conn) === 'vertical' ? Math.min(conn.opening.z1, conn.opening.z2) : edge.start;
      const end = conn.opening && openingAxis(conn) === 'vertical' ? Math.max(conn.opening.z1, conn.opening.z2) : edge.end;
      result.push({
        x: edgeX,
        y: midY,
        x1: edgeX,
        y1: g2p(start),
        x2: edgeX,
        y2: g2p(end),
        startAngle: edge.aSide === 'right' ? -Math.PI / 2 : Math.PI / 2,
        type: conn.type as DoorInfo['type'],
        style,
      });
    } else {
      const midpoint = openingMidpoint(conn, 'horizontal');
      const midX = g2p(midpoint?.x ?? (edge.start + edge.end) / 2);
      const edgeY = g2p(midpoint?.z ?? edge.fixed);
      const start = conn.opening && openingAxis(conn) === 'horizontal' ? Math.min(conn.opening.x1, conn.opening.x2) : edge.start;
      const end = conn.opening && openingAxis(conn) === 'horizontal' ? Math.max(conn.opening.x1, conn.opening.x2) : edge.end;
      result.push({
        x: midX,
        y: edgeY,
        x1: g2p(start),
        y1: edgeY,
        x2: g2p(end),
        y2: edgeY,
        startAngle: edge.aSide === 'bottom' ? 0 : Math.PI,
        type: conn.type as DoorInfo['type'],
        style,
      });
    }
  }
  return result;
}

function roomGridCenter(room: RoomLayout): { x: number; z: number } {
  if (room.anchor && Number.isFinite(room.anchor.gx) && Number.isFinite(room.anchor.gz)) {
    return { x: room.anchor.gx, z: room.anchor.gz };
  }
  const bounds = roomGridBounds(room);
  return { x: bounds.gx + bounds.gw / 2, z: bounds.gz + bounds.gd / 2 };
}

function doorStyleForConnection(
  conn: RoomConnection,
  a: RoomLayout,
  b: RoomLayout,
): DoorInfo['style'] {
  if (conn.operation === 'bifold') return 'bifold';
  const exteriorLike = a.type === 'deck' || b.type === 'deck';
  if (exteriorLike && conn.operation !== 'slide') return 'entry';
  if (conn.operation === 'slide' || POCKET_DOOR_TYPES.has(a.type) || POCKET_DOOR_TYPES.has(b.type)) {
    return 'pocket';
  }
  return 'standard';
}

function doorFromOpening(
  conn: RoomConnection,
  a: RoomLayout,
  b: RoomLayout,
  style: DoorInfo['style'],
): DoorInfo | null {
  const axis = openingAxis(conn);
  if (!conn.opening || !axis) return null;
  const aCenter = roomGridCenter(a);
  const bCenter = roomGridCenter(b);
  const doorType: DoorInfo['type'] = conn.type === 'sliding' ? 'sliding' : 'door';

  if (axis === 'vertical') {
    const fixed = conn.opening.x1;
    const start = Math.min(conn.opening.z1, conn.opening.z2);
    const end = Math.max(conn.opening.z1, conn.opening.z2);
    const aLeft = aCenter.x <= fixed;
    const bLeft = bCenter.x <= fixed;
    const doorFromLeft = aLeft !== bLeft ? aLeft : aCenter.x <= bCenter.x;
    return {
      x: g2p(fixed),
      y: g2p((start + end) / 2),
      x1: g2p(fixed),
      y1: g2p(start),
      x2: g2p(fixed),
      y2: g2p(end),
      startAngle: doorFromLeft ? -Math.PI / 2 : Math.PI / 2,
      type: doorType,
      style,
    };
  }

  const fixed = conn.opening.z1;
  const start = Math.min(conn.opening.x1, conn.opening.x2);
  const end = Math.max(conn.opening.x1, conn.opening.x2);
  const aAbove = aCenter.z <= fixed;
  const bAbove = bCenter.z <= fixed;
  const doorFromAbove = aAbove !== bAbove ? aAbove : aCenter.z <= bCenter.z;
  return {
    x: g2p((start + end) / 2),
    y: g2p(fixed),
    x1: g2p(start),
    y1: g2p(fixed),
    x2: g2p(end),
    y2: g2p(fixed),
    startAngle: doorFromAbove ? 0 : Math.PI,
    type: doorType,
    style,
  };
}

/** SVG arc path for a quarter-circle door swing */
function doorArcPath(door: DoorInfo): string {
  // Choose radius based on door style
  const r = door.style === 'pocket' ? POCKET_DOOR_RADIUS
    : door.style === 'entry' ? ENTRY_DOOR_RADIUS
    : DOOR_RADIUS;
  const startAngle = door.startAngle;
  const endAngle = startAngle + Math.PI / 2;

  const x1 = door.x + Math.cos(startAngle) * r;
  const y1 = door.y + Math.sin(startAngle) * r;
  const x2 = door.x + Math.cos(endAngle) * r;
  const y2 = door.y + Math.sin(endAngle) * r;

  return `M ${door.x} ${door.y} L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`;
}

function sourceBoxDoorGeometry(
  opening: SourceOpeningSegment,
  sourceBox: { x: number; y: number; w: number; h: number },
  vertical: boolean,
) {
  if (vertical) {
    const hingeX = sourceBox.x;
    const hingeY = sourceBox.y + sourceBox.h;
    const closedX = hingeX;
    const closedY = sourceBox.y;
    const openX = sourceBox.x + sourceBox.w;
    const openY = sourceBox.y + sourceBox.h;
    return {
      hingeX,
      hingeY,
      closedX,
      closedY,
      openX,
      openY,
      radius: Math.max(1, Math.min(sourceBox.w, sourceBox.h)),
      sweep: 1,
    };
  }
  const hingeX = sourceBox.x;
  const hingeY = sourceBox.y;
  const closedX = sourceBox.x + sourceBox.w;
  const closedY = hingeY;
  const openX = sourceBox.x;
  const openY = sourceBox.y + sourceBox.h;
  return {
    hingeX,
    hingeY,
    closedX,
    closedY,
    openX,
    openY,
    radius: Math.max(1, Math.min(sourceBox.w, sourceBox.h)),
    sweep: 1,
  };
}

function explicitDoorGeometry(opening: SourceOpeningSegment) {
  if (!opening.hingePoint || !opening.leafClosedEnd || !opening.leafOpenEnd) return null;
  const rawPoints = [opening.hingePoint, opening.leafClosedEnd, opening.leafOpenEnd];
  const looksLikeSourcePixels = rawPoints.some((point) => Math.abs(point.x) > 50 || Math.abs(point.z) > 50);
  if (looksLikeSourcePixels) return null;
  const hingeX = g2p(opening.hingePoint.x);
  const hingeY = g2p(opening.hingePoint.z);
  const closedX = g2p(opening.leafClosedEnd.x);
  const closedY = g2p(opening.leafClosedEnd.z);
  const openX = g2p(opening.leafOpenEnd.x);
  const openY = g2p(opening.leafOpenEnd.z);
  const radius = Math.max(1, Math.hypot(closedX - hingeX, closedY - hingeY));
  const cross = (closedX - hingeX) * (openY - hingeY) - (closedY - hingeY) * (openX - hingeX);
  return {
    hingeX,
    hingeY,
    closedX,
    closedY,
    openX,
    openY,
    radius,
    sweep: cross > 0 ? 1 : 0,
  };
}

/** Radius for a given door info */
function doorRadius(door: DoorInfo): number {
  return door.style === 'pocket' ? POCKET_DOOR_RADIUS
    : door.style === 'entry' ? ENTRY_DOOR_RADIUS
    : DOOR_RADIUS;
}

/* ── floor level helpers ───────────────────────────────────────────── */

const FLOOR_LABELS: Record<number, string> = {
  [-1]: 'LOWER LEVEL',
  [0]: 'GROUND FLOOR',
  [0.5]: 'SPLIT LEVEL',
  [1]: 'LOFT / UPPER',
  [2]: 'UPPER LEVEL 2',
};

const FLOOR_GAP = 60; // px gap between floor plans
const FLOOR_LABEL_H = 24; // px height for floor label
const TRACE_LEGEND_ROW_H = 18;

function traceLegendRows(count: number): number {
  if (count <= 0) return 0;
  if (count <= 5) return Math.min(4, count);
  return Math.ceil(count / 2);
}

/** LDK open-plan zone types — these rooms flow together without walls.
 *  Also used for unified fill color so the open zone reads as one continuous space.
 *  Entry is intentionally excluded: it's only open when it has an explicit 'open' connection. */
const OPEN_ZONE_TYPES = new Set([
  'kitchen', 'kitchen_open', 'kitchenette', 'open_kitchen', 'eat_in_kitchen',
  'dining', 'dining_room', 'dining_area', 'dining_nook',
  'great_room', 'great_room_open', 'living_room', 'living', 'lounge', 'family_room',
  'common_area', 'open_living', 'ldk',
  'living_dining', 'kitchen_dining', 'living_kitchen', 'open_plan', 'open_living_dining',
  'combined_living', 'combined_dining', 'combined_kitchen',
]);

function proposalCalloutNumber(room: RoomLayout, fallback: number): number | null {
  if (typeof room.proposalNumber === 'number' && Number.isFinite(room.proposalNumber)) return room.proposalNumber;
  const text = `${room.type} ${room.label}`.toLowerCase();
  if (VOID_ZONE_PATTERN.test(text)) return null;
  if (text.includes('entry')) return 1;
  if (text.includes('exterior') || text.includes('eave') || text.includes('deck')) return null;
  if (text.includes('kitchen')) return 2;
  if (text.includes('living') || text.includes('studio') || text.includes('open')) return 3;
  if ((room.floor ?? 0) >= 1 && text.includes('ladder')) return null;
  if (text.includes('ladder') || text.includes('loft above')) return 4;
  if (text.includes('loft sleeping') || text.includes('bedroom')) return 5;
  return fallback;
}

/** Check if a shared edge between two rooms should be open (no wall) */
function isOpenEdge(
  roomA: RoomLayout,
  roomB: RoomLayout,
  connections?: RoomConnection[],
): boolean {
  // Adjacent LDK-type rooms are implicitly open — no wall between them
  if (OPEN_ZONE_TYPES.has(roomA.type) && OPEN_ZONE_TYPES.has(roomB.type)) return true;
  if (!connections) return false;
  for (const conn of connections) {
    if (conn.type !== 'open') continue;
    if (
      (conn.from === roomA.label && conn.to === roomB.label) ||
      (conn.from === roomB.label && conn.to === roomA.label)
    ) {
      return true;
    }
  }
  return false;
}

function connectionBetween(
  roomA: RoomLayout,
  roomB: RoomLayout,
  connections?: RoomConnection[],
): RoomConnection | undefined {
  if (!connections) return undefined;
  return connections.find((conn) => (
    (conn.from === roomA.label && conn.to === roomB.label) ||
    (conn.from === roomB.label && conn.to === roomA.label)
  ));
}

function gapSizeGrid(roomA: RoomLayout, roomB: RoomLayout, conn?: RoomConnection): number | null {
  if (isOpenEdge(roomA, roomB, conn ? [conn] : undefined)) return null;
  if (!conn || conn.type === 'wall') return 0;
  if (conn.type === 'open') return null;

  const closetDoor = POCKET_DOOR_TYPES.has(roomA.type) || POCKET_DOOR_TYPES.has(roomB.type);
  const widthFt = conn.width ?? (conn.type === 'sliding' ? 6 : closetDoor ? 3.5 : 3);
  return Math.max(0.5, widthFt / GRID);
}

function addSharedEdgeGap(
  openEdges: Set<string>,
  roomA: RoomLayout,
  roomB: RoomLayout,
  gapGrid: number | null,
  opening?: RoomConnection['opening'],
): void {
  const addRange = (edge: SharedGridEdge) => {
    const start = edge.start;
    const end = edge.end;
    const vertical = edge.orientation === 'vertical';
    const length = end - start;
    if (length <= 0) return;
    let gapStart = start;
    let gapEnd = end;
    let fixedCoord = edge.fixed;
    if (opening) {
      const openingVertical = Math.abs(opening.x1 - opening.x2) < 0.001;
      const openingHorizontal = Math.abs(opening.z1 - opening.z2) < 0.001;
      if (vertical && openingVertical) {
        fixedCoord = opening.x1;
        gapStart = Math.max(start, Math.min(opening.z1, opening.z2));
        gapEnd = Math.min(end, Math.max(opening.z1, opening.z2));
      } else if (!vertical && openingHorizontal) {
        fixedCoord = opening.z1;
        gapStart = Math.max(start, Math.min(opening.x1, opening.x2));
        gapEnd = Math.min(end, Math.max(opening.x1, opening.x2));
      }
    }
    if (gapGrid !== null && !opening) {
      const size = Math.min(length, gapGrid);
      const mid = (start + end) / 2;
      gapStart = mid - size / 2;
      gapEnd = mid + size / 2;
    }
    if (gapEnd <= gapStart) return;
    if (vertical) openEdges.add(`${g2p(fixedCoord)},${g2p(gapStart)},${g2p(fixedCoord)},${g2p(gapEnd)}`);
    else openEdges.add(`${g2p(gapStart)},${g2p(fixedCoord)},${g2p(gapEnd)},${g2p(fixedCoord)}`);
  };

  const edges = sharedRoomEdges(roomA, roomB);
  const candidates = opening
    ? edges.filter(edge => edgeMatchesOpening(edge, opening))
    : gapGrid === null
      ? edges
      : edges.slice(0, 1);
  candidates.forEach(addRange);
}

/** Build a set of open edges between rooms, keyed by "edge signature".
 *  An edge is identified by its start/end pixel coordinates.
 *  Returns a Set of "x1,y1,x2,y2" strings for edges that should be open. */
function computeOpenEdges(
  rooms: RoomLayout[],
  connections?: RoomConnection[],
): Set<string> {
  const openEdges = new Set<string>();
  // No early return: adjacent LDK rooms are implicitly open even without
  // explicit connections, and door connections need physical wall gaps.

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      const conn = connectionBetween(a, b, connections);
      const implicitOpen = isOpenEdge(a, b, connections);
      if (!implicitOpen && (!conn || conn.type === 'wall')) continue;
      addSharedEdgeGap(
        openEdges,
        a,
        b,
        implicitOpen ? null : gapSizeGrid(a, b, conn),
        conn?.type === 'open' || implicitOpen ? undefined : conn?.opening,
      );
    }
  }
  return openEdges;
}

/** For a room, compute which of its 4 edges (top/bottom/left/right) are partially
 *  or fully open due to open connections. Returns segments to DRAW (i.e., the parts
 *  of each edge that are NOT open). */
function computeRoomWallSegments(
  room: RoomLayout,
  openEdges: Set<string>,
): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const localOpenEdges = new Set(openEdges);
  const parts = roomParts(room);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      for (const edge of sharedPartEdges(parts[i], parts[j])) {
        localOpenEdges.add(edgeKey(edge));
      }
    }
  }

  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  for (const part of parts) {
    const r = partRect(part);
    const sides = [
      { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y },
      { x1: r.x, y1: r.y + r.h, x2: r.x + r.w, y2: r.y + r.h },
      { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h },
      { x1: r.x + r.w, y1: r.y, x2: r.x + r.w, y2: r.y + r.h },
    ];

    for (const side of sides) {
      const isHorizontal = side.y1 === side.y2;
      const openRanges: Array<[number, number]> = [];

      for (const key of localOpenEdges) {
        const [ex1, ey1, ex2, ey2] = key.split(',').map(Number);

        if (isHorizontal) {
          if (ey1 === side.y1 && ey2 === side.y1) {
            const oStart = Math.max(Math.min(ex1, ex2), Math.min(side.x1, side.x2));
            const oEnd = Math.min(Math.max(ex1, ex2), Math.max(side.x1, side.x2));
            if (oEnd > oStart) {
              openRanges.push([oStart, oEnd]);
            }
          }
        } else {
          if (ex1 === side.x1 && ex2 === side.x1) {
            const oStart = Math.max(Math.min(ey1, ey2), Math.min(side.y1, side.y2));
            const oEnd = Math.min(Math.max(ey1, ey2), Math.max(side.y1, side.y2));
            if (oEnd > oStart) {
              openRanges.push([oStart, oEnd]);
            }
          }
        }
      }

      if (openRanges.length === 0) {
        segments.push(side);
      } else {
        openRanges.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [openRanges[0]];
        for (let i = 1; i < openRanges.length; i++) {
          const last = merged[merged.length - 1];
          if (openRanges[i][0] <= last[1]) {
            last[1] = Math.max(last[1], openRanges[i][1]);
          } else {
            merged.push(openRanges[i]);
          }
        }

        if (isHorizontal) {
          const y = side.y1;
          let cursor = Math.min(side.x1, side.x2);
          const end = Math.max(side.x1, side.x2);
          for (const [oStart, oEnd] of merged) {
            if (cursor < oStart) {
              segments.push({ x1: cursor, y1: y, x2: oStart, y2: y });
            }
            cursor = oEnd;
          }
          if (cursor < end) {
            segments.push({ x1: cursor, y1: y, x2: end, y2: y });
          }
        } else {
          const x = side.x1;
          let cursor = Math.min(side.y1, side.y2);
          const end = Math.max(side.y1, side.y2);
          for (const [oStart, oEnd] of merged) {
            if (cursor < oStart) {
              segments.push({ x1: x, y1: cursor, x2: x, y2: oStart });
            }
            cursor = oEnd;
          }
          if (cursor < end) {
            segments.push({ x1: x, y1: cursor, x2: x, y2: end });
          }
        }
      }
    }
  }

  return segments;
}

/** Render a single floor level's plan */
function FloorLevel({
  floorRooms,
  allFloorRooms,
  connections,
  sourceWalls,
  sourceOpenings,
  floorSpaceFaces,
  dimensionLines,
  offsetX,
  offsetY,
  floorNum,
  floorFp,
  dimensionFrame,
  prefix,
  showFloorLabel,
  traceMode = false,
  drawingStyleProfile,
}: {
  floorRooms: RoomLayout[];
  allFloorRooms: RoomLayout[];
  connections?: RoomConnection[];
  sourceWalls?: SourceWallSegment[];
  sourceOpenings?: SourceOpeningSegment[];
  floorSpaceFaces?: SourceSpaceFace[];
  dimensionLines?: SourceDimensionLine[];
  offsetX: number;
  offsetY: number;
  floorNum: number;
  floorFp: { width: number; depth: number };
  dimensionFrame?: DimensionFrame;
  prefix: string;
  /** Override the default floor-label visibility. */
  showFloorLabel?: boolean;
  traceMode?: boolean;
  drawingStyleProfile?: DrawingStyleProfile;
}) {
  const activeDrawingStyleProfile = drawingStyleOrDefault(drawingStyleProfile);
  const drawingStyle = activeDrawingStyleProfile.rules;
  const isDeck = (r: RoomLayout) => r.type === 'deck';
  const doors = computeDoors(connections, allFloorRooms);
  const hasSourceDoors = traceMode && Boolean(sourceOpenings?.some((opening) => opening.kind === 'door'));
  const openEdges = computeOpenEdges(allFloorRooms, connections);
  const useSourceWalls = traceMode && Boolean(sourceWalls?.length);
  const roomByLabel = new Map(allFloorRooms.map((room) => [room.label, room]));
  const voidRoomLabels = new Set(floorRooms.filter(isVoidZone).map((room) => room.label));
  const semanticFaceRoomLabels = new Set(
    (floorSpaceFaces ?? [])
      .filter((face) => (face.roomIds?.length ?? 0) > 1)
      .flatMap((face) => (face.roomIds ?? []).filter((label) => {
        const room = roomByLabel.get(label);
        return room ? OPEN_ZONE_TYPES.has(room.type) : false;
      })),
  );
  const hasSourceVoidAreaMarkers = traceMode && Boolean(sourceWalls?.some((wall) => {
    if (!isVoidAreaMarkerWall(wall)) return false;
    return Number(wall.floor ?? floorNum) === floorNum;
  }));

  // Grid lines
  const gridLines: React.ReactElement[] = [];
  const fw = floorFp.width * PX_PER_FT;
  const fh = floorFp.depth * PX_PER_FT;
  const frame = dimensionFrame ?? { gx: 0, gz: 0, gw: floorFp.width / GRID, gd: floorFp.depth / GRID };
  const dimX = g2p(frame.gx);
  const dimY = g2p(frame.gz);
  const dimW = g2p(frame.gw);
  const dimH = g2p(frame.gd);
  const dimLabelW = formatFt(frame.gw * GRID);
  const dimLabelH = formatFt(frame.gd * GRID);
  const dimLabelWText = traceMode && Number.isInteger(frame.gw * GRID) ? `${dimLabelW}'-0"` : `${dimLabelW}'`;
  const dimLabelHText = traceMode && Number.isInteger(frame.gd * GRID) ? `${dimLabelH}'-0"` : `${dimLabelH}'`;
  const showWidthDimension = !traceMode || frame.showWidthDimension !== false;
  const showDepthDimension = !traceMode || frame.showDepthDimension !== false;
  const sourceEvidenceOnlyDimensions = traceMode && Boolean(sourceWalls?.length || sourceOpenings?.length);
  const hasExplicitDimensionLines = traceMode && Boolean(dimensionLines?.length);
  const showSyntheticDimensionTicks = !sourceEvidenceOnlyDimensions && !hasExplicitDimensionLines;
  const showSyntheticDimensionLabels = !sourceEvidenceOnlyDimensions && !hasExplicitDimensionLines;
  const depthDimensionOpacity = traceMode ? drawingStyle.dimensions.opacity : 0.5;
  const depthDimensionStrokeWidth = traceMode ? drawingStyle.dimensions.strokeWidthPx : 0.7;
  const dimensionStroke = traceMode ? drawingStyle.dimensions.stroke : FIXTURE_COLOR;
  const dimensionStrokeWidth = traceMode ? drawingStyle.dimensions.strokeWidthPx : 0.7;
  const dimensionOpacity = traceMode ? drawingStyle.dimensions.opacity : 0.5;
  const dimensionTick = traceMode ? 7 : 3;
  const dimensionLineY = dimY - MARGIN * 0.55;
  const dimensionLineX = dimX - MARGIN * 0.55;
  const gridOrientation = traceMode ? drawingStyle.grid.orientation ?? 'both' : 'both';
  const gridSpacingFt = traceMode
    ? Math.max(0.5, drawingStyle.grid.spacingFt ?? GRID)
    : GRID;
  if (gridOrientation === 'both' || gridOrientation === 'vertical') {
    for (let ft = 0; ft <= floorFp.width + GEOM_EPS; ft += gridSpacingFt) {
      const x = ft * PX_PER_FT;
      gridLines.push(<line key={`gv-${ft}`} x1={x} y1={0} x2={x} y2={fh} stroke={traceMode ? drawingStyle.grid.color : GRID_COLOR} strokeWidth={traceMode ? drawingStyle.grid.strokeWidthPx : 0.5} opacity={traceMode ? drawingStyle.grid.opacity : 1} />);
    }
  }
  if (gridOrientation === 'both' || gridOrientation === 'horizontal') {
    for (let ft = 0; ft <= floorFp.depth + GEOM_EPS; ft += gridSpacingFt) {
      const y = ft * PX_PER_FT;
      gridLines.push(<line key={`gh-${ft}`} x1={0} y1={y} x2={fw} y2={y} stroke={traceMode ? drawingStyle.grid.color : GRID_COLOR} strokeWidth={traceMode ? drawingStyle.grid.strokeWidthPx : 0.5} opacity={traceMode ? drawingStyle.grid.opacity : 1} />);
    }
  }
  const floorTexture = traceMode ? drawingStyle.floorTexture : undefined;
  const renderFloorTexture = (
    key: string,
    clipId: string,
    shapePath: string,
    bounds: { gx: number; gz: number; gw: number; gd: number },
  ) => {
    if (!floorTexture?.visible) return null;
    const spacingFt = Math.max(0.08, floorTexture.spacingFt);
    const x1 = g2p(bounds.gx);
    const y1 = g2p(bounds.gz);
    const x2 = g2p(bounds.gx + bounds.gw);
    const y2 = g2p(bounds.gz + bounds.gd);
    const lines: React.ReactElement[] = [];
    if (floorTexture.orientation === 'vertical') {
      for (let ft = bounds.gx * GRID; ft <= (bounds.gx + bounds.gw) * GRID + GEOM_EPS; ft += spacingFt) {
        const x = ft * PX_PER_FT;
        lines.push(
          <line
            key={`${key}-texture-v-${ft.toFixed(2)}`}
            x1={x}
            y1={y1}
            x2={x}
            y2={y2}
            stroke={floorTexture.color}
            strokeWidth={floorTexture.strokeWidthPx}
            opacity={floorTexture.opacity}
          />,
        );
      }
    } else {
      for (let ft = bounds.gz * GRID; ft <= (bounds.gz + bounds.gd) * GRID + GEOM_EPS; ft += spacingFt) {
        const y = ft * PX_PER_FT;
        lines.push(
          <line
            key={`${key}-texture-h-${ft.toFixed(2)}`}
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            stroke={floorTexture.color}
            strokeWidth={floorTexture.strokeWidthPx}
            opacity={floorTexture.opacity}
          />,
        );
      }
    }
    return (
      <g key={`${key}-floor-texture`} data-role="floor-texture" data-drawing-layer="floorTexture">
        <defs>
          <clipPath id={clipId}>
            <path d={shapePath} fill="none" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          {lines}
        </g>
      </g>
    );
  };

  // Exterior walls per room
  const maxGx = floorFp.width / GRID;
  const maxGz = floorFp.depth / GRID;

  const label = traceMode
    ? floorNum >= 1 ? 'LOFT LEVEL' : 'MAIN LEVEL'
    : FLOOR_LABELS[floorNum] ?? `LEVEL ${floorNum}`;
  const labelVisible = showFloorLabel ?? true;

  return (
    <g data-role="floor-level" data-source-floor={floorNum} transform={`translate(${offsetX}, ${offsetY})`}>
      {/* Floor level label */}
      {labelVisible && (
        <text
          data-role="floor-title"
          x={fw / 2} y={-10}
          textAnchor="middle" fontFamily={FONT} fontSize={9} fontWeight={700}
          fill={traceMode ? drawingStyle.labels.fill : LABEL_COLOR} opacity={traceMode ? 0.62 : 0.55} letterSpacing="1.5"
        >
          {label}
        </text>
      )}

      {/* Ground floor outline ghost (shown on loft level for context) */}
      {floorNum > 0 && (
        <rect x={0} y={0} width={fw} height={fh}
          fill="none" stroke={GRID_COLOR} strokeWidth={1}
          strokeDasharray="4,4" opacity={0.4} />
      )}

      {(!traceMode || drawingStyle.grid.visible) && <g>{gridLines}</g>}

      {/* Wall-derived physical spaces. In trace mode these are the primary
          space geometry; semantic open-zone rooms only contribute labels and
          fixtures so the parsed plan does not invent rectangular walls. */}
      {traceMode && (floorSpaceFaces ?? []).length > 0 && (
        <g>
          {(floorSpaceFaces ?? []).map((face) => {
            const voidFace = isVoidSpaceFace(face) || (face.roomIds ?? []).some((label) => voidRoomLabels.has(label));
            if (voidFace && hasSourceVoidAreaMarkers) return null;
            const parts = spaceFaceParts(face);
            const shapePath = roomPartPath(parts, (point) => ({ x: g2p(point.gx), y: g2p(point.gz) }));
            const sharedFace = (face.roomIds?.length ?? 0) > 1;
            const bounds = spaceFaceGridBounds(face);
            const x1 = g2p(bounds.gx);
            const y1 = g2p(bounds.gz);
            const x2 = g2p(bounds.gx + bounds.gw);
            const y2 = g2p(bounds.gz + bounds.gd);
            return (
              <g key={`${prefix}-space-face-${face.id}`} data-role={voidFace ? 'open-to-below' : 'room-fill'} data-drawing-layer={voidFace ? 'dashedVoid' : undefined} data-source-id={face.sourceAnchorId ?? face.id} data-source-floor={face.floor ?? floorNum}>
                <path
                  d={shapePath}
                  fill={voidFace ? 'none' : sharedFace ? '#f2eee5' : '#f3f6f6'}
                  fillRule="evenodd"
                  stroke={voidFace ? (traceMode ? drawingStyle.voids.stroke : GRID_COLOR) : 'none'}
                  strokeDasharray={voidFace ? drawingStyle.voids.dasharray : undefined}
                  strokeWidth={voidFace ? drawingStyle.voids.strokeWidthPx : 0}
                  opacity={voidFace ? drawingStyle.voids.opacity : drawingStyle.roomFillOpacity}
                />
                {!voidFace ? renderFloorTexture(
                  `${prefix}-space-face-${face.id}`,
                  `${prefix}-space-face-${face.id}-floor-texture-clip`.replace(/[^a-zA-Z0-9_-]/g, '-'),
                  shapePath,
                  bounds,
                ) : null}
                {voidFace && (
                  <>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={drawingStyle.voids.stroke} strokeWidth={drawingStyle.voids.strokeWidthPx} strokeDasharray={drawingStyle.voids.dasharray} opacity={drawingStyle.voids.opacity} />
                    <line x1={x2} y1={y1} x2={x1} y2={y2} stroke={drawingStyle.voids.stroke} strokeWidth={drawingStyle.voids.strokeWidthPx} strokeDasharray={drawingStyle.voids.dasharray} opacity={drawingStyle.voids.opacity} />
                  </>
                )}
              </g>
            );
          })}
        </g>
      )}

      {/* Room fills */}
      {floorRooms.map((room, i) => {
        if (isVoidZone(room)) return null;
        if (traceMode && semanticFaceRoomLabels.has(room.label)) return null;
        const deck = isDeck(room);
        const isOpenPlan = OPEN_ZONE_TYPES.has(room.type);
        // Open-plan LDK rooms share a single warm fill so they read as one flowing space,
        // not a grid of separate colored boxes. Enclosed rooms keep their individual tint.
        const roomColor = room.color || '#fff';
            const fill = traceMode ? (deck ? 'none' : roomColor !== '#fff' ? `${roomColor}18` : '#f8f8f433')
          : deck ? 'none'
          : isOpenPlan ? '#e8d5a330'  // unified warm LDK tone (~19% opacity)
          : (roomColor !== '#fff' ? roomColor + '1a' : '#fff');
        const shapePath = roomPartPath(roomParts(room), (point) => ({ x: g2p(point.gx), y: g2p(point.gz) }));
        const bounds = roomGridBounds(room);
        return (
          <g key={`${prefix}-fill-${i}`}>
            <path
              data-role="room-fill"
              d={shapePath}
              fill={fill}
              opacity={traceMode && !deck ? drawingStyle.roomFillOpacity : undefined}
              fillRule="evenodd"
              stroke={deck ? FIXTURE_COLOR : 'none'}
              strokeWidth={deck ? 1 : 0}
              strokeDasharray={deck ? DECK_DASH : 'none'}
            />
            {!deck ? renderFloorTexture(
              `${prefix}-room-${room.label}-${i}`,
              `${prefix}-room-${room.label}-${i}-floor-texture-clip`.replace(/[^a-zA-Z0-9_-]/g, '-'),
              shapePath,
              bounds,
            ) : null}
          </g>
        );
      })}

      {/* Open-to-below / void zones: negative space, not floor or wall geometry. */}
      {floorRooms.filter(isVoidZone).filter((room) => {
        if (!traceMode) return true;
        return !(floorSpaceFaces ?? []).some((face) => isVoidSpaceFace(face) && (
          face.id === room.spaceFaceId ||
          face.roomId === room.spaceFaceId ||
          face.roomId === room.label ||
          (face.roomIds ?? []).includes(room.label)
        ));
      }).map((room, i) => {
        const shapePath = roomPartPath(roomParts(room), (point) => ({ x: g2p(point.gx), y: g2p(point.gz) }));
        return (
          <g key={`${prefix}-void-${i}`} data-role="open-to-below">
            <path
              d={shapePath}
              fill="none"
              stroke={drawingStyle.voids.stroke}
              strokeWidth={drawingStyle.voids.strokeWidthPx}
              strokeDasharray={drawingStyle.voids.dasharray}
              opacity={drawingStyle.voids.opacity}
            />
          </g>
        );
      })}

      {/* LDK open-plan zone fill — keep the area visually continuous without
          adding parser-only labels that do not exist in the source plans. */}
      {(() => {
        if (traceMode) return null;
        // Find clusters of rooms connected by open edges
        if (!connections) return null;
        const openPairs: Array<[string, string]> = connections
          .filter(c => c.type === 'open')
          .map(c => [c.from, c.to]);
        if (openPairs.length === 0) return null;

        // Union-find to group connected rooms
        const parent = new Map<string, string>();
        const find = (x: string): string => {
          if (!parent.has(x)) parent.set(x, x);
          if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
          return parent.get(x)!;
        };
        const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
        for (const [a, b] of openPairs) { union(a, b); }

        // Group rooms by cluster
        const clusters = new Map<string, RoomLayout[]>();
        const roomMap = new Map(floorRooms.map(r => [r.label, r]));
        for (const label of parent.keys()) {
          const room = roomMap.get(label);
          if (!room || isDeck(room)) continue;
          const root = find(label);
          if (!clusters.has(root)) clusters.set(root, []);
          clusters.get(root)!.push(room);
        }

        // Draw a single subtle fill for clusters with 2+ rooms.
        return Array.from(clusters.entries())
          .filter(([, rms]) => rms.length >= 2)
          .map(([, rms], ci) => {
            const rects = rms.map(roomRect);
            const minX = Math.min(...rects.map(r => r.x));
            const minY = Math.min(...rects.map(r => r.y));
            const maxX = Math.max(...rects.map(r => r.x + r.w));
            const maxY = Math.max(...rects.map(r => r.y + r.h));
            return (
              <g key={`${prefix}-ldk-zone-${ci}`}>
                <rect
                  x={minX} y={minY} width={maxX - minX} height={maxY - minY}
                  fill="rgba(74, 222, 128, 0.04)" stroke="none" />
              </g>
            );
          });
      })()}

      {/* Room outlines — open connections have no wall line. Trace mode can use
          parsed source wall segments so visual comparison is not constrained to
          room rectangles. */}
      {!useSourceWalls && floorRooms.filter(r => !isDeck(r)).map((room, i) => {
        const wallSegs = computeRoomWallSegments(room, openEdges);
        return (
          <g key={`${prefix}-outline-${i}`}>
            {wallSegs.map((seg, si) => (
              <line key={si}
                x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
                stroke={WALL_COLOR} strokeWidth={WALL_STROKE} />
            ))}
          </g>
        );
      })}

      {useSourceWalls && (
        <g>
          {sourceWalls!.filter((wall) => !isVoidMarkerWall(wall)).map((wall, index) => {
            const guide = isGuideWall(wall);
            const guardRail = isGuardRailWall(wall);
            const glazed = /glaz|window/i.test(`${wall.wallKind ?? ''} ${wall.id ?? ''}`);
            const stroke = guide || guardRail
              ? TRACE_STYLE.guard
              : wall.exterior
                ? TRACE_STYLE.exteriorWall
                : TRACE_STYLE.interiorWall;
            const strokeWidth = wall.exterior ? 1.2 : guardRail ? 0.8 : 0.95;
            const wallX1 = g2p(wall.x1);
            const wallY1 = g2p(wall.z1);
            const wallX2 = g2p(wall.x2);
            const wallY2 = g2p(wall.z2);
            const measuredWallThickness = Number(activeDrawingStyleProfile.validation?.metrics?.sourceAnchorWallThicknessLocalPx ?? 0);
            const useMeasuredWallBody = Number.isFinite(measuredWallThickness) && measuredWallThickness > 0;
            const wallBounds = wall.bounds
              ? {
                  x: g2p(wall.bounds.x),
                  y: g2p(wall.bounds.z),
                  w: g2p(wall.bounds.w),
                  h: g2p(wall.bounds.d),
                }
              : undefined;
            const horizontal = Math.abs(wallX2 - wallX1) >= Math.abs(wallY2 - wallY1);
            const splitWallSegment = /:seg-\d+$/i.test(String(wall.id ?? ''));
            const centerlineWallBody = drawingStyle.walls.wallBodyLineMode === 'centerline';
            const sourcePrimitiveBody = wall.source === 'source-image-primitive-override'
              && Boolean(wallBounds)
              && !guide
              && !guardRail
              && !glazed;
            const sourcePrimitiveEdgeStroke = wall.exterior
              ? drawingStyle.walls.exteriorStrokeWidthPx
              : drawingStyle.walls.interiorStrokeWidthPx;
            const drawSourcePrimitiveBodyEdges = sourcePrimitiveBody
              && !splitWallSegment
              && !centerlineWallBody
              && sourcePrimitiveEdgeStroke >= 0.95;
            const centerlineOnlySourceBody = !sourcePrimitiveBody
              && !wall.exterior
              && !glazed
              && !guide
              && (guardRail || /partition|interior-wall/i.test(`${wall.wallKind ?? ''} ${wall.id ?? ''}`));
            const measuredInteriorWallThickness = Number(activeDrawingStyleProfile.validation?.metrics?.sourceMidRunStrokePx ?? 0);
            const visualThickness = wall.exterior
              ? drawingStyle.walls.exteriorBackingStrokeWidthPx
              : Number.isFinite(measuredInteriorWallThickness) && measuredInteriorWallThickness > 0
                ? measuredInteriorWallThickness
                : Math.max(drawingStyle.walls.interiorStrokeWidthPx * 4.5, drawingStyle.walls.exteriorBackingStrokeWidthPx * 0.58);
            const lineMinX = Math.min(wallX1, wallX2);
            const lineMinY = Math.min(wallY1, wallY2);
            const measuredWallBody = !wallBounds && useMeasuredWallBody && !guide && !guardRail && !glazed
              ? horizontal
                ? {
                    x: lineMinX,
                    y: ((wallY1 + wallY2) / 2) - visualThickness / 2,
                    w: Math.max(0.5, Math.abs(wallX2 - wallX1)),
                    h: visualThickness,
                  }
                : {
                    x: ((wallX1 + wallX2) / 2) - visualThickness / 2,
                    y: lineMinY,
                    w: visualThickness,
                    h: Math.max(0.5, Math.abs(wallY2 - wallY1)),
                  }
              : undefined;
            const wallBody = measuredWallBody ?? wallBounds;
            const useWallBody = !centerlineOnlySourceBody && !guide && Boolean(wallBody && wallBody.w > 0.5 && wallBody.h > 0.5);
            return (
              <g
                key={`${prefix}-source-wall-${wall.id ?? index}`}
                data-role={glazed ? 'window' : guardRail ? 'guardrail' : wall.exterior ? 'exterior-wall' : 'interior-wall'}
                data-drawing-layer={glazed ? 'window' : guide ? 'dashedVoid' : 'wall'}
                data-source-id={wall.id}
                data-source-kind={wall.wallKind}
                data-source-floor={wall.floor ?? 0}
              >
                {useWallBody ? (
                  <>
		                    <rect
		                      x={wallBody!.x}
		                      y={wallBody!.y}
	                      width={wallBody!.w}
	                      height={wallBody!.h}
                      data-wall-fill-only={splitWallSegment && !centerlineWallBody ? 'true' : undefined}
                      data-source-centerline-body={centerlineOnlySourceBody ? 'true' : undefined}
		                      fill={drawingStyle.walls.exteriorBackingStroke}
		                      stroke={centerlineWallBody || sourcePrimitiveBody ? 'none' : wall.exterior ? drawingStyle.walls.exteriorStroke : drawingStyle.walls.interiorStroke}
		                      strokeWidth={centerlineWallBody || sourcePrimitiveBody ? 0 : wall.exterior ? drawingStyle.walls.exteriorStrokeWidthPx : drawingStyle.walls.interiorStrokeWidthPx}
		                      opacity={wall.exterior ? drawingStyle.walls.exteriorOpacity : drawingStyle.walls.interiorOpacity}
		                    />
                      {(centerlineWallBody || centerlineOnlySourceBody) && horizontal ? (
                        <line
                          data-wall-line="centerline"
                          x1={wallBody!.x}
                          y1={wallBody!.y + wallBody!.h / 2}
                          x2={wallBody!.x + wallBody!.w}
                          y2={wallBody!.y + wallBody!.h / 2}
                          stroke={wall.exterior ? drawingStyle.walls.exteriorStroke : drawingStyle.walls.interiorStroke}
                          strokeWidth={wall.exterior ? drawingStyle.walls.exteriorStrokeWidthPx : drawingStyle.walls.interiorStrokeWidthPx}
                          opacity={wall.exterior ? drawingStyle.walls.exteriorOpacity : drawingStyle.walls.interiorOpacity}
                        />
                      ) : null}
                      {(centerlineWallBody || centerlineOnlySourceBody) && !horizontal ? (
                        <line
                          data-wall-line="centerline"
                          x1={wallBody!.x + wallBody!.w / 2}
                          y1={wallBody!.y}
                          x2={wallBody!.x + wallBody!.w / 2}
                          y2={wallBody!.y + wallBody!.h}
                          stroke={wall.exterior ? drawingStyle.walls.exteriorStroke : drawingStyle.walls.interiorStroke}
                          strokeWidth={wall.exterior ? drawingStyle.walls.exteriorStrokeWidthPx : drawingStyle.walls.interiorStrokeWidthPx}
                          opacity={wall.exterior ? drawingStyle.walls.exteriorOpacity : drawingStyle.walls.interiorOpacity}
                        />
                      ) : null}
                      {drawSourcePrimitiveBodyEdges && horizontal ? (
                        <>
                          <line x1={wallBody!.x} y1={wallBody!.y} x2={wallBody!.x + wallBody!.w} y2={wallBody!.y} stroke={wall.exterior ? drawingStyle.walls.exteriorStroke : drawingStyle.walls.interiorStroke} strokeWidth={Math.min(0.65, sourcePrimitiveEdgeStroke)} opacity={(wall.exterior ? drawingStyle.walls.exteriorOpacity : drawingStyle.walls.interiorOpacity) * 0.58} />
                          <line x1={wallBody!.x} y1={wallBody!.y + wallBody!.h} x2={wallBody!.x + wallBody!.w} y2={wallBody!.y + wallBody!.h} stroke={wall.exterior ? drawingStyle.walls.exteriorStroke : drawingStyle.walls.interiorStroke} strokeWidth={Math.min(0.65, sourcePrimitiveEdgeStroke)} opacity={(wall.exterior ? drawingStyle.walls.exteriorOpacity : drawingStyle.walls.interiorOpacity) * 0.58} />
                        </>
                      ) : null}
                      {drawSourcePrimitiveBodyEdges && !horizontal ? (
                        <>
                          <line x1={wallBody!.x} y1={wallBody!.y} x2={wallBody!.x} y2={wallBody!.y + wallBody!.h} stroke={wall.exterior ? drawingStyle.walls.exteriorStroke : drawingStyle.walls.interiorStroke} strokeWidth={Math.min(0.65, sourcePrimitiveEdgeStroke)} opacity={(wall.exterior ? drawingStyle.walls.exteriorOpacity : drawingStyle.walls.interiorOpacity) * 0.58} />
                          <line x1={wallBody!.x + wallBody!.w} y1={wallBody!.y} x2={wallBody!.x + wallBody!.w} y2={wallBody!.y + wallBody!.h} stroke={wall.exterior ? drawingStyle.walls.exteriorStroke : drawingStyle.walls.interiorStroke} strokeWidth={Math.min(0.65, sourcePrimitiveEdgeStroke)} opacity={(wall.exterior ? drawingStyle.walls.exteriorOpacity : drawingStyle.walls.interiorOpacity) * 0.58} />
                        </>
                      ) : null}
                  </>
                ) : wall.exterior && !guide && !guardRail && !glazed ? (
                  <line
                    data-wall-line="backing"
                    x1={wallX1}
                    y1={wallY1}
                    x2={wallX2}
                    y2={wallY2}
                    stroke={drawingStyle.walls.exteriorBackingStroke}
                    strokeWidth={drawingStyle.walls.exteriorBackingStrokeWidthPx}
                    strokeLinecap={drawingStyle.walls.cap}
                    strokeLinejoin={drawingStyle.walls.join}
                    opacity={drawingStyle.walls.exteriorOpacity}
                  />
                ) : null}
                {!useWallBody ? <line
                  x1={wallX1}
                  y1={wallY1}
                  x2={wallX2}
                  y2={wallY2}
                  stroke={glazed ? drawingStyle.windows.stroke : stroke}
                  strokeWidth={glazed ? drawingStyle.windows.strokeWidthPx : strokeWidth}
                  strokeDasharray={guide || guardRail ? drawingStyle.voids.dasharray : undefined}
                  strokeLinecap={drawingStyle.walls.cap}
                  strokeLinejoin={drawingStyle.walls.join}
                  opacity={guide || guardRail ? drawingStyle.voids.opacity : glazed ? drawingStyle.windows.opacity : drawingStyle.walls.interiorOpacity}
                /> : null}
              </g>
            );
          })}
          {sourceWalls!.filter(isVoidMarkerWall).map((wall, index) => (
            <line
              data-role="open-to-below"
              data-drawing-layer="dashedVoid"
              data-source-id={wall.id}
              data-source-kind={wall.wallKind}
              data-source-floor={wall.floor ?? 0}
              key={`${prefix}-source-void-marker-${wall.id ?? index}`}
              x1={g2p(wall.x1)}
              y1={g2p(wall.z1)}
              x2={g2p(wall.x2)}
              y2={g2p(wall.z2)}
              stroke={drawingStyle.voids.stroke}
              strokeWidth={drawingStyle.voids.strokeWidthPx}
              strokeDasharray={drawingStyle.voids.dasharray}
              strokeLinecap={drawingStyle.walls.cap}
              opacity={drawingStyle.voids.opacity}
            />
          ))}
        </g>
      )}

      {traceMode && sourceOpenings?.length ? (
        <g>
          {sourceOpenings.map((opening, index) => {
            const x1 = g2p(opening.x1);
            const y1 = g2p(opening.z1);
            const x2 = g2p(opening.x2);
            const y2 = g2p(opening.z2);
            const vertical = Math.abs(x1 - x2) < 0.001;
            const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
            const midX = (x1 + x2) / 2;
            const isDoor = opening.kind === 'door';
            const isWindow = opening.kind === 'window';
            const sourceBox = opening.sourceBounds
              ? {
                  x: g2p(opening.sourceBounds.x),
                  y: g2p(opening.sourceBounds.z),
                  w: g2p(opening.sourceBounds.w),
                  h: g2p(opening.sourceBounds.d),
                }
              : undefined;
            if (!isDoor && !isWindow) return null;

            if (isWindow) {
              const folding = /fold|glaz/i.test(`${opening.id ?? ''} ${opening.openingType ?? ''}`);
              const foldMidY = (y1 + y2) / 2;
              const foldDepth = 26;
              return (
                <g key={`${prefix}-source-opening-${opening.id ?? index}`} data-role="window" data-drawing-layer="window" data-source-id={opening.id} data-source-kind={opening.openingType ?? opening.kind} data-source-floor={opening.floor ?? 0}>
                  <line
                    data-role="opening-gap"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={drawingStyle.openings.gapStroke}
                    strokeWidth={drawingStyle.openings.gapStrokeWidthPx}
                    strokeLinecap="butt"
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={drawingStyle.windows.stroke}
                    strokeWidth={drawingStyle.windows.strokeWidthPx}
                    opacity={drawingStyle.windows.opacity}
                    strokeLinecap="butt"
                  />
                  {folding && vertical ? (
                    <>
                      <path
                        d={`M ${x1} ${y1} L ${x1 - foldDepth} ${foldMidY - foldDepth * 0.45} L ${x1} ${foldMidY} L ${x1 - foldDepth} ${foldMidY + foldDepth * 0.45} L ${x1} ${y2}`}
                        fill="none"
                        stroke={drawingStyle.doors.stroke}
                        strokeWidth={drawingStyle.doors.strokeWidthPx}
                        strokeDasharray="7,6"
                        opacity={0.5}
                      />
                      <line x1={x1 - 2} y1={y1} x2={x1 - 2} y2={y2} stroke={drawingStyle.fixtures.stroke} strokeWidth={drawingStyle.fixtures.strokeWidthPx} opacity={0.55} />
                    </>
                  ) : null}
                </g>
              );
            }

            if (isDoor && opening.openingType === 'opening') {
              return (
                <g key={`${prefix}-source-opening-${opening.id ?? index}`} data-role="door" data-drawing-layer="door" data-source-id={opening.id} data-source-kind={opening.openingType ?? opening.kind} data-source-floor={opening.floor ?? 0}>
                  <line
                    data-role="opening-gap"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={drawingStyle.openings.gapStroke}
                    strokeWidth={drawingStyle.openings.gapStrokeWidthPx}
                    strokeLinecap="butt"
                  />
                </g>
              );
            }

            if (isDoor && sourceBox && sourceBox.w > 1 && sourceBox.h > 1 && opening.source === 'source-image-primitive-override') {
              const doorGeometry = explicitDoorGeometry(opening) ?? sourceBoxDoorGeometry(opening, sourceBox, sourceBox.h >= sourceBox.w);
              return (
                <g key={`${prefix}-source-opening-${opening.id ?? index}`} data-role="door" data-drawing-layer="door" data-source-id={opening.id} data-source-kind={opening.openingType ?? opening.kind} data-source-floor={opening.floor ?? 0}>
                  <line
                    data-role="opening-gap"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={drawingStyle.openings.gapStroke}
                    strokeWidth={drawingStyle.openings.gapStrokeWidthPx}
                    strokeLinecap="butt"
                  />
                  <path
                    d={`M ${doorGeometry.hingeX} ${doorGeometry.hingeY} L ${doorGeometry.closedX} ${doorGeometry.closedY} A ${doorGeometry.radius} ${doorGeometry.radius} 0 0 ${doorGeometry.sweep} ${doorGeometry.openX} ${doorGeometry.openY}`}
                    fill={drawingStyle.doors.fill}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.arcStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                  <line
                    x1={doorGeometry.hingeX}
                    y1={doorGeometry.hingeY}
                    x2={doorGeometry.openX}
                    y2={doorGeometry.openY}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.leafStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                </g>
              );
            }

            if (opening.hingePoint && opening.leafClosedEnd && opening.leafOpenEnd) {
              const doorGeometry = explicitDoorGeometry(opening);
              if (!doorGeometry) return null;
              return (
                <g key={`${prefix}-source-opening-${opening.id ?? index}`} data-role="door" data-drawing-layer="door" data-source-id={opening.id} data-source-kind={opening.openingType ?? opening.kind} data-source-floor={opening.floor ?? 0}>
                  <line
                    data-role="opening-gap"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={drawingStyle.openings.gapStroke}
                    strokeWidth={drawingStyle.openings.gapStrokeWidthPx}
                    strokeLinecap="butt"
                  />
                  <path
                    d={`M ${doorGeometry.hingeX} ${doorGeometry.hingeY} L ${doorGeometry.closedX} ${doorGeometry.closedY} A ${doorGeometry.radius} ${doorGeometry.radius} 0 0 ${doorGeometry.sweep} ${doorGeometry.openX} ${doorGeometry.openY}`}
                    fill={drawingStyle.doors.fill}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.arcStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                  <line
                    x1={doorGeometry.hingeX}
                    y1={doorGeometry.hingeY}
                    x2={doorGeometry.openX}
                    y2={doorGeometry.openY}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.leafStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                </g>
              );
            }

            if (isDoor && sourceBox && sourceBox.w > 1 && sourceBox.h > 1) {
              const doorGeometry = explicitDoorGeometry(opening) ?? sourceBoxDoorGeometry(opening, sourceBox, sourceBox.h >= sourceBox.w);
              return (
                <g key={`${prefix}-source-opening-${opening.id ?? index}`} data-role="door" data-drawing-layer="door" data-source-id={opening.id} data-source-kind={opening.openingType ?? opening.kind} data-source-floor={opening.floor ?? 0}>
                  <line
                    data-role="opening-gap"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={drawingStyle.openings.gapStroke}
                    strokeWidth={drawingStyle.openings.gapStrokeWidthPx}
                    strokeLinecap="butt"
                  />
                  <path
                    d={`M ${doorGeometry.hingeX} ${doorGeometry.hingeY} L ${doorGeometry.closedX} ${doorGeometry.closedY} A ${doorGeometry.radius} ${doorGeometry.radius} 0 0 ${doorGeometry.sweep} ${doorGeometry.openX} ${doorGeometry.openY}`}
                    fill={drawingStyle.doors.fill}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.arcStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                  <line
                    x1={doorGeometry.hingeX}
                    y1={doorGeometry.hingeY}
                    x2={doorGeometry.openX}
                    y2={doorGeometry.openY}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.leafStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                </g>
              );
            }

            if (vertical) {
              const hingeY = Math.max(y1, y2);
              const closedY = Math.min(y1, y2);
              const openTowardLeft = midX > fw / 2;
              const radius = Math.min(length, ENTRY_DOOR_RADIUS);
              const openX = x1 + (openTowardLeft ? -radius : radius);
              const sweep = openTowardLeft ? 0 : 1;
              return (
                <g key={`${prefix}-source-opening-${opening.id ?? index}`} data-role="door" data-drawing-layer="door" data-source-id={opening.id} data-source-kind={opening.openingType ?? opening.kind} data-source-floor={opening.floor ?? 0}>
                  <line
                    data-role="opening-gap"
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={drawingStyle.openings.gapStroke}
                    strokeWidth={drawingStyle.openings.gapStrokeWidthPx}
                    strokeLinecap="butt"
                  />
                  <path
                    d={`M ${x1} ${hingeY} L ${x1} ${closedY} A ${radius} ${radius} 0 0 ${sweep} ${openX} ${hingeY}`}
                    fill={drawingStyle.doors.fill}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.arcStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                  <line
                    x1={x1}
                    y1={hingeY}
                    x2={openX}
                    y2={hingeY}
                    stroke={drawingStyle.doors.stroke}
                    strokeWidth={drawingStyle.doors.leafStrokeWidthPx}
                    opacity={drawingStyle.doors.opacity}
                  />
                </g>
              );
            }

            const hingeX = Math.min(x1, x2);
            const closedX = Math.max(x1, x2);
            const openTowardUp = (y1 + y2) / 2 > fh / 2;
            const radius = Math.min(length, ENTRY_DOOR_RADIUS);
            const openY = y1 + (openTowardUp ? -radius : radius);
            const sweep = openTowardUp ? 1 : 0;
            return (
              <g key={`${prefix}-source-opening-${opening.id ?? index}`} data-role="door" data-drawing-layer="door" data-source-id={opening.id} data-source-kind={opening.openingType ?? opening.kind} data-source-floor={opening.floor ?? 0}>
                <line
                  data-role="opening-gap"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={drawingStyle.openings.gapStroke}
                  strokeWidth={drawingStyle.openings.gapStrokeWidthPx}
                  strokeLinecap="butt"
                />
                <path
                  d={`M ${hingeX} ${y1} L ${closedX} ${y1} A ${radius} ${radius} 0 0 ${sweep} ${hingeX} ${openY}`}
                  fill={drawingStyle.doors.fill}
                  stroke={drawingStyle.doors.stroke}
                  strokeWidth={drawingStyle.doors.arcStrokeWidthPx}
                  opacity={drawingStyle.doors.opacity}
                />
                <line
                  x1={hingeX}
                  y1={y1}
                  x2={hingeX}
                  y2={openY}
                  stroke={drawingStyle.doors.stroke}
                  strokeWidth={drawingStyle.doors.leafStrokeWidthPx}
                  opacity={drawingStyle.doors.opacity}
                />
              </g>
            );
          })}
        </g>
      ) : null}

      {/* Exterior walls */}
      {!useSourceWalls && floorRooms.filter(r => !isDeck(r)).map((room, i) => {
        const thick = WALL_STROKE * 3;
        return (
          <g key={`${prefix}-ext-${i}`}>
            {roomParts(room).map((part, pi) => {
              const r = partRect(part);
              const ext = {
                top: Math.abs(part.gz) < GEOM_EPS,
                bottom: Math.abs(part.gz + part.gd - maxGz) < GEOM_EPS,
                left: Math.abs(part.gx) < GEOM_EPS,
                right: Math.abs(part.gx + part.gw - maxGx) < GEOM_EPS,
              };
              return (
                <g key={`${prefix}-ext-${i}-${pi}`}>
                  {ext.top && <line x1={r.x} y1={r.y} x2={r.x + r.w} y2={r.y} stroke={WALL_COLOR} strokeWidth={thick} />}
                  {ext.bottom && <line x1={r.x} y1={r.y + r.h} x2={r.x + r.w} y2={r.y + r.h} stroke={WALL_COLOR} strokeWidth={thick} />}
                  {ext.left && <line x1={r.x} y1={r.y} x2={r.x} y2={r.y + r.h} stroke={WALL_COLOR} strokeWidth={thick} />}
                  {ext.right && <line x1={r.x + r.w} y1={r.y} x2={r.x + r.w} y2={r.y + r.h} stroke={WALL_COLOR} strokeWidth={thick} />}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* Fixtures */}
      {floorRooms.map((room) =>
        room.fixtures?.map((fix, fi) => {
          const resolvedFixtureType = fixtureRenderType(fix);
          const stairSymbol = /ladder|stair/i.test(resolvedFixtureType);
          const voidSymbol = resolvedFixtureType === 'open_to_below';
          const voidAlreadyRenderedFromSpaceFace = voidSymbol && (floorSpaceFaces ?? []).some((face) => {
            const faceAnchorIds = [
              face.sourceAnchorId,
              ...(face.sourceAnchorIds ?? []),
            ].filter(Boolean);
            return face.roomId === fix.roomId
              || face.id === fix.roomId
              || faceAnchorIds.includes(fix.sourceAnchorId);
          });
          if (voidAlreadyRenderedFromSpaceFace) return null;
          const fixtureBox = fixRect(fix);
          const symbolText = `${fix.type ?? ''} ${fix.symbolVariant ?? ''} ${resolvedFixtureType}`;
          const variantLocksVertical = /verticalRungLadder|stair[-_\s]*treads|straight[-_\s]*run[-_\s]*treads/i.test(symbolText);
          const rotation = !variantLocksVertical && fix.rotationSource !== 'inferred' && typeof fix.rotationDeg === 'number' && Math.abs(fix.rotationDeg % 360) > 0.001
            ? `rotate(${fix.rotationDeg} ${fixtureBox.x + fixtureBox.w / 2} ${fixtureBox.y + fixtureBox.h / 2})`
            : undefined;
          const hasSeparatePillowPrimitive = /bed/i.test(`${fix.type ?? ''} ${fix.symbolVariant ?? ''}`)
            && Boolean(room.fixtures?.some((other) => {
              if (other === fix) return false;
              const otherText = `${other.type ?? ''} ${other.symbolVariant ?? ''} ${other.sourceAnchorId ?? ''}`.toLowerCase();
              const fixSource = String(fix.sourceAnchorId ?? fix.fixtureId ?? fix.id ?? '');
              const otherSource = String(other.sourceAnchorId ?? other.fixtureId ?? other.id ?? '');
              return otherText.includes('pillow') && Boolean(fixSource) && otherSource.startsWith(fixSource);
            }));
          const fixtureForRender = hasSeparatePillowPrimitive
            ? { ...fix, hasSeparatePillowPrimitive } as RoomFixture & { hasSeparatePillowPrimitive: boolean }
            : fix;
          return (
            <g key={`${prefix}-fix-wrap-${room.label}-${fi}`} data-role={stairSymbol ? 'stair-symbol' : voidSymbol ? 'open-to-below' : 'fixture'} data-drawing-layer={stairSymbol ? 'ladder' : voidSymbol ? 'dashedVoid' : 'fixture'} data-source-id={fix.sourceAnchorId ?? fix.fixtureId ?? fix.id} data-source-kind={fix.symbolVariant ?? fix.type} data-source-floor={room.floor ?? 0} opacity={traceMode ? 1 : fixtureOpacity(traceMode)} transform={rotation}>
              {renderFixture(fixtureForRender, `${prefix}-fix-${room.label}-${fi}`)}
            </g>
          );
        })
      )}

      {/* Door swings (only for rooms on this floor) */}
      {!hasSourceDoors && doors.map((door, i) => {
        // open connections render nothing (gaps handled by wall segments)
        if (door.type === 'open') return null;

        const path = doorArcPath(door);
        const r = doorRadius(door);
        const isPocket = door.style === 'pocket';
        const isEntry = door.style === 'entry';
        const openingMask = door.x1 !== undefined && door.y1 !== undefined && door.x2 !== undefined && door.y2 !== undefined
          ? (
              <line
                data-role="opening-gap"
                x1={door.x1}
                y1={door.y1}
                x2={door.x2}
                y2={door.y2}
                stroke={traceMode ? drawingStyle.openings.gapStroke : BG}
                strokeWidth={traceMode ? drawingStyle.openings.gapStrokeWidthPx : WALL_STROKE * 4}
                strokeLinecap="butt"
              />
            )
          : null;

        if (door.style === 'bifold' && door.x1 !== undefined && door.y1 !== undefined && door.x2 !== undefined && door.y2 !== undefined) {
          const vertical = Math.abs(door.x1 - door.x2) < 0.001;
          const folds = 4;
          const offset = 9;
          const points: string[] = [];
          for (let step = 0; step <= folds; step += 1) {
            const t = step / folds;
            const baseX = door.x1 + (door.x2 - door.x1) * t;
            const baseY = door.y1 + (door.y2 - door.y1) * t;
            const foldOffset = step % 2 === 1 ? offset : 0;
            const x = vertical
              ? baseX + (door.startAngle < 0 ? -foldOffset : foldOffset)
              : baseX;
            const y = vertical
              ? baseY
              : baseY + (Math.abs(door.startAngle) < 0.001 ? foldOffset : -foldOffset);
            points.push(`${x},${y}`);
          }
          return (
            <g key={`${prefix}-door-${i}`} data-role="door">
              {openingMask}
              <polyline
                points={points.join(' ')}
                fill="none"
                stroke={traceMode ? drawingStyle.doors.stroke : FIXTURE_COLOR}
                strokeWidth={traceMode ? drawingStyle.doors.strokeWidthPx : 0.85}
                opacity={traceMode ? drawingStyle.doors.opacity : 0.58}
              />
            </g>
          );
        }

        // Pocket doors: thin parallel lines (sliding pocket indicator) + small dashed arc
        if (isPocket) {
          const startAngle = door.startAngle;
          const endAngle = startAngle + Math.PI / 2;
          const x1 = door.x + Math.cos(startAngle) * r;
          const y1 = door.y + Math.sin(startAngle) * r;
          const x2 = door.x + Math.cos(endAngle) * r;
          const y2 = door.y + Math.sin(endAngle) * r;
          // Just the arc (dashed) and door line (thinner)
          return (
            <g key={`${prefix}-door-${i}`} data-role="door">
              {openingMask}
              <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                fill="none"
                stroke={traceMode ? drawingStyle.doors.stroke : FIXTURE_COLOR}
                strokeWidth={traceMode ? drawingStyle.doors.arcStrokeWidthPx : 0.5} strokeDasharray={traceMode ? drawingStyle.doors.swingDasharray ?? '3,2' : '3,2'} opacity={traceMode ? drawingStyle.doors.opacity : 0.45} />
              <line x1={door.x} y1={door.y}
                x2={x1} y2={y1}
                stroke={traceMode ? drawingStyle.doors.stroke : FIXTURE_COLOR} strokeWidth={traceMode ? drawingStyle.doors.leafStrokeWidthPx : 0.7} opacity={traceMode ? drawingStyle.doors.opacity : 0.4} />
            </g>
          );
        }

        // Entry doors: thicker line, bolder arc fill
        const fillColor = door.type === 'sliding'
          ? (traceMode ? 'rgba(174,189,192,0.10)' : 'rgba(74,144,217,0.1)')
          : isEntry
            ? (traceMode ? drawingStyle.doors.fill : 'rgba(0,0,0,0.08)')
            : (traceMode ? drawingStyle.doors.fill : 'rgba(0,0,0,0.05)');
        const strokeColor = door.type === 'sliding' ? WINDOW_COLOR : (traceMode ? drawingStyle.doors.stroke : FIXTURE_COLOR);
        const lineWidth = isEntry ? (traceMode ? drawingStyle.doors.leafStrokeWidthPx + 0.15 : 1.2) : (traceMode ? drawingStyle.doors.leafStrokeWidthPx : 1);

        return (
          <g key={`${prefix}-door-${i}`} data-role="door">
            {openingMask}
            <path d={path}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={traceMode ? drawingStyle.doors.arcStrokeWidthPx : 0.7} opacity={traceMode ? drawingStyle.doors.opacity : 0.6} />
            <line x1={door.x} y1={door.y}
              x2={door.x + Math.cos(door.startAngle) * r}
              y2={door.y + Math.sin(door.startAngle) * r}
              stroke={traceMode ? drawingStyle.doors.stroke : FIXTURE_COLOR} strokeWidth={lineWidth} opacity={traceMode ? drawingStyle.doors.opacity : 0.5} />
          </g>
        );
      })}

      {/* Room labels / proposal-style callouts. */}
      {(() => {
        // Build set of labels in open-plan zones
        const openZoneLabels = new Set<string>();
        if (connections) {
          for (const conn of connections) {
            if (conn.type === 'open') {
              openZoneLabels.add(conn.from);
              openZoneLabels.add(conn.to);
            }
          }
        }
        return floorRooms.map((room, i) => {
          const r = roomRect(room);
          const center = roomVisualCenter(room);
          const elev = (room.floor ?? 0);
          const isSplit = elev > 0 && elev < 1;
          const elevFt = Math.round(elev * 8);
          const isOpenPlan = openZoneLabels.has(room.label) && !isDeck(room);

          // Short label for open-plan rooms (strip "Open " prefix)
          const shortLabel = isOpenPlan
            ? room.label.replace(/^Open /, '').toLowerCase()
            : room.label;

          // Scale font size based on room width — avoid overflow in narrow rooms
          const roomWidthPx = center.labelWidth;
          const baseFontSize = traceMode ? 8 : isOpenPlan ? 8 : 10;
          const maxChars = shortLabel.length;
          const charWidth = baseFontSize * 0.6;
          const labelWidth = maxChars * charWidth;
          const scaledFontSize = labelWidth > roomWidthPx * 0.85
            ? Math.max(6, baseFontSize * (roomWidthPx * 0.85) / labelWidth)
            : baseFontSize;

          if (traceMode) {
            const number = proposalCalloutNumber(room, i + 1);
            if (number === null) return null;
            const showTraceRoomName = drawingStyle.labels.showTraceRoomNames === true;
            const traceRoomLabel = traceLegendLabel(room.label);
            return (
              <g key={`${prefix}-label-${i}`} data-role="callout">
                <circle
                  cx={center.cx}
                  cy={center.cy}
                  r={drawingStyle.callouts.radiusPx}
                  fill={drawingStyle.callouts.fill}
                  opacity={drawingStyle.callouts.opacity}
                />
                <text
                  x={center.cx}
                  y={center.cy + 0.5}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="Arial, Helvetica, sans-serif"
                  fontSize={drawingStyle.callouts.fontSizePx}
                  fontWeight={700}
                  fill="#fff"
                >
                  {number}
                </text>
                {showTraceRoomName ? (
                  <text
                    x={center.cx}
                    y={center.cy + drawingStyle.callouts.radiusPx + 7}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontFamily={drawingStyle.labels.fontFamily}
                    fontSize={drawingStyle.labels.traceRoomFontSizePx ?? Math.max(5.5, drawingStyle.labels.roomFontSizePx * 0.62)}
                    fontWeight={drawingStyle.labels.fontWeight}
                    fill={drawingStyle.labels.fill}
                    opacity={drawingStyle.labels.traceRoomLabelOpacity ?? 0.55}
                  >
                    {traceRoomLabel}
                  </text>
                ) : null}
              </g>
            );
          }

          return (
          <g key={`${prefix}-label-${i}`} data-role="room-label">
              <text x={center.cx} y={center.cy - (isOpenPlan ? 2 : 4)}
                textAnchor="middle" dominantBaseline="central"
                fontFamily={FONT}
                fontSize={scaledFontSize}
                fontWeight={isOpenPlan ? 400 : 600}
                fill={isOpenPlan ? '#666' : LABEL_COLOR}
                opacity={traceMode ? 0.58 : isOpenPlan ? 0.5 : 0.8}
                fontStyle={isOpenPlan ? 'italic' : 'normal'}>
                {shortLabel}
              </text>
              {!traceMode && !isOpenPlan && (
                <text x={center.cx} y={center.cy + 9}
                  textAnchor="middle" dominantBaseline="central"
                  fontFamily={FONT} fontSize={7.5}
                  fill={LABEL_COLOR} opacity={0.45}>
                  {room.area} sf
                </text>
              )}
              {traceMode && !isOpenPlan && Number.isFinite(room.gw) && Number.isFinite(room.gd) && room.gw * GRID >= 6 && room.gd * GRID >= 4 && (
                <text x={center.cx} y={center.cy + 10}
                  textAnchor="middle" dominantBaseline="central"
                  fontFamily={FONT} fontSize={7}
                  fill={drawingStyle.dimensions.stroke} opacity={0.5}>
                  {formatFt(room.gw * GRID)}&apos; × {formatFt(room.gd * GRID)}&apos;
                </text>
              )}
              {/* Elevation badge for split-level rooms */}
              {isSplit && (
                <g>
                  <rect x={r.x + r.w - 22} y={r.y + 3} width={19} height={11}
                    rx={2} fill="#f0ece5" stroke={FIXTURE_COLOR} strokeWidth={0.5} />
                  <text x={r.x + r.w - 12.5} y={r.y + 10.5}
                    textAnchor="middle" fontFamily={FONT} fontSize={6} fontWeight={700}
                    fill="#666">
                    +{elevFt}&apos;
                  </text>
                </g>
              )}
            </g>
          );
        });
      })()}

      {/* Dimension annotations — width */}
      {hasExplicitDimensionLines ? (
        <g>
          {dimensionLines!.map((line, index) => {
            const x1 = g2p(line.span.x1);
            const y1 = g2p(line.span.z1);
            const x2 = g2p(line.span.x2);
            const y2 = g2p(line.span.z2);
            const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
            const label = line.label ?? (horizontal ? dimLabelWText : dimLabelHText);
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const tick = Math.max(4, dimensionTick * 0.78);
            return (
              <g key={`${prefix}-source-dimension-${line.id ?? index}`} data-role="dimension" data-drawing-layer="dimension" data-source-id={line.sourceAnchorId ?? line.id} data-source-kind={horizontal ? 'width-dimension' : 'depth-dimension'} data-source-floor={floorNum}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
                {horizontal ? (
                  <>
                    <line x1={x1} y1={y1 - tick} x2={x1} y2={y1 + tick} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
                    <line x1={x2} y1={y2 - tick} x2={x2} y2={y2 + tick} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
                    <text x={midX} y={midY - 5} textAnchor="middle" fontFamily={FONT} fontSize={drawingStyle.dimensions.fontSizePx} fill={drawingStyle.dimensions.stroke} opacity={drawingStyle.dimensions.opacity}>
                      {label}
                    </text>
                  </>
                ) : (
                  <>
                    <line x1={x1 - tick} y1={y1} x2={x1 + tick} y2={y1} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
                    <line x1={x2 - tick} y1={y2} x2={x2 + tick} y2={y2} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
                    <text x={midX} y={midY} textAnchor="middle" fontFamily={FONT} fontSize={drawingStyle.dimensions.fontSizePx} fill={drawingStyle.dimensions.stroke} opacity={drawingStyle.dimensions.opacity} transform={`rotate(-90, ${midX}, ${midY})`}>
                      {label}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </g>
      ) : null}

      {/* Dimension annotations — width */}
      {!hasExplicitDimensionLines && showWidthDimension ? <g data-role="dimension" data-drawing-layer="dimension" data-source-id={frame.widthSourceAnchorId} data-source-kind="width-dimension" data-source-floor={floorNum}>
        <line x1={dimX} y1={dimensionLineY} x2={dimX + dimW} y2={dimensionLineY}
          stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity}
          markerStart={traceMode ? undefined : `url(#dim-arrow-${prefix})`} markerEnd={traceMode ? undefined : `url(#dim-arrow-${prefix})`} />
        {traceMode && showSyntheticDimensionTicks ? (
          <>
            <line x1={dimX} y1={dimensionLineY - dimensionTick} x2={dimX} y2={dimensionLineY + dimensionTick} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
            <line x1={dimX + dimW} y1={dimensionLineY - dimensionTick} x2={dimX + dimW} y2={dimensionLineY + dimensionTick} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
          </>
        ) : null}
        {showSyntheticDimensionLabels ? (
          <text x={dimX + dimW / 2} y={dimensionLineY - 5}
            textAnchor="middle" fontFamily={FONT} fontSize={traceMode ? drawingStyle.dimensions.fontSizePx : 8} fill={traceMode ? drawingStyle.dimensions.stroke : LABEL_COLOR} opacity={traceMode ? drawingStyle.dimensions.opacity : 0.5}>
            {dimLabelWText}
          </text>
        ) : null}
      </g> : null}

      {/* Dimension annotations — depth */}
      {!hasExplicitDimensionLines && showDepthDimension ? <g data-role="dimension" data-drawing-layer="dimension" data-source-id={frame.depthSourceAnchorId} data-source-kind="depth-dimension" data-source-floor={floorNum}>
        <line x1={dimensionLineX} y1={dimY} x2={dimensionLineX} y2={dimY + dimH}
          stroke={traceMode ? drawingStyle.dimensions.stroke : FIXTURE_COLOR} strokeWidth={depthDimensionStrokeWidth} opacity={depthDimensionOpacity} />
        {traceMode && showSyntheticDimensionTicks ? (
          <>
            <line x1={dimensionLineX - dimensionTick} y1={dimY} x2={dimensionLineX + dimensionTick} y2={dimY} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
            <line x1={dimensionLineX - dimensionTick} y1={dimY + dimH} x2={dimensionLineX + dimensionTick} y2={dimY + dimH} stroke={dimensionStroke} strokeWidth={dimensionStrokeWidth} opacity={dimensionOpacity} />
          </>
        ) : null}
        {showSyntheticDimensionLabels ? (
          <text x={dimensionLineX} y={dimY + dimH / 2}
            textAnchor="middle" fontFamily={FONT} fontSize={traceMode ? drawingStyle.dimensions.fontSizePx : 8} fill={traceMode ? drawingStyle.dimensions.stroke : LABEL_COLOR} opacity={depthDimensionOpacity}
            transform={`rotate(-90, ${dimensionLineX}, ${dimY + dimH / 2})`}>
            {dimLabelHText}
          </text>
        ) : null}
      </g> : null}

      {/* Chained band dimensions: room cuts along the top and left edges */}
      {traceMode ? (() => {
        const eps = 0.05;
        const segLabel = (ft: number) => (Number.isInteger(ft) ? `${ft}'-0\"` : `${formatFt(ft)}'`);
        const topCutsG = [...new Set(
          floorRooms
            .filter((room) => Number.isFinite(room.gx) && Math.abs((room.gz ?? 0) - frame.gz) < eps)
            .flatMap((room) => [room.gx, room.gx + room.gw]),
        )].filter((g) => g >= frame.gx - eps && g <= frame.gx + frame.gw + eps).sort((a, b) => a - b);
        const leftCutsG = [...new Set(
          floorRooms
            .filter((room) => Number.isFinite(room.gz) && Math.abs((room.gx ?? 0) - frame.gx) < eps)
            .flatMap((room) => [room.gz, room.gz + room.gd]),
        )].filter((g) => g >= frame.gz - eps && g <= frame.gz + frame.gd + eps).sort((a, b) => a - b);
        const chainY = dimensionLineY - 11;
        const chainX = dimensionLineX - 11;
        const tick = 3;
        const renderChain = (cuts: number[], horizontal: boolean) => {
          if (cuts.length < 3) return null;
          const items: React.ReactElement[] = [];
          for (let i = 0; i < cuts.length; i += 1) {
            const p = g2p(cuts[i]);
            items.push(horizontal
              ? <line key={`t${i}`} x1={p} y1={chainY - tick} x2={p} y2={chainY + tick} stroke={dimensionStroke} strokeWidth={0.7} opacity={dimensionOpacity} />
              : <line key={`t${i}`} x1={chainX - tick} y1={p} x2={chainX + tick} y2={p} stroke={dimensionStroke} strokeWidth={0.7} opacity={dimensionOpacity} />);
          }
          for (let i = 0; i + 1 < cuts.length; i += 1) {
            const ft = (cuts[i + 1] - cuts[i]) * GRID;
            if (ft < 3) continue;
            const mid = g2p((cuts[i] + cuts[i + 1]) / 2);
            items.push(horizontal
              ? <text key={`l${i}`} x={mid} y={chainY - 4} textAnchor="middle" fontFamily={FONT} fontSize={Math.max(8, drawingStyle.dimensions.fontSizePx - 3)} fill={dimensionStroke} opacity={dimensionOpacity}>{segLabel(ft)}</text>
              : <text key={`l${i}`} x={chainX - 4} y={mid} textAnchor="middle" fontFamily={FONT} fontSize={Math.max(8, drawingStyle.dimensions.fontSizePx - 3)} fill={dimensionStroke} opacity={dimensionOpacity} transform={`rotate(-90, ${chainX - 4}, ${mid})`}>{segLabel(ft)}</text>);
          }
          const a = g2p(cuts[0]);
          const b = g2p(cuts[cuts.length - 1]);
          items.unshift(horizontal
            ? <line key="base" x1={a} y1={chainY} x2={b} y2={chainY} stroke={dimensionStroke} strokeWidth={0.7} opacity={dimensionOpacity} />
            : <line key="base" x1={chainX} y1={a} x2={chainX} y2={b} stroke={dimensionStroke} strokeWidth={0.7} opacity={dimensionOpacity} />);
          return items;
        };
        const top = renderChain(topCutsG, true);
        const left = renderChain(leftCutsG, false);
        if (!top && !left) return null;
        return (
          <g data-role="dimension" data-drawing-layer="dimension" data-source-kind="band-dimension" data-source-floor={floorNum}>
            {top}
            {left}
          </g>
        );
      })() : null}

      {/* Scale marker */}
      {!traceMode ? <g transform={`translate(${fw - GRID * PX_PER_FT - 8}, ${fh + MARGIN * 0.45})`}>
        <line x1={0} y1={0} x2={GRID * PX_PER_FT} y2={0} stroke={traceMode ? TRACE_STYLE.dim : WALL_COLOR} strokeWidth={1} opacity={0.6} />
        <line x1={0} y1={-3} x2={0} y2={3} stroke={traceMode ? TRACE_STYLE.dim : WALL_COLOR} strokeWidth={1} opacity={0.6} />
        <line x1={GRID * PX_PER_FT} y1={-3} x2={GRID * PX_PER_FT} y2={3} stroke={traceMode ? TRACE_STYLE.dim : WALL_COLOR} strokeWidth={1} opacity={0.6} />
        <text x={GRID * PX_PER_FT / 2} y={-6}
          textAnchor="middle" fontFamily={FONT} fontSize={8} fill={traceMode ? TRACE_STYLE.label : LABEL_COLOR} opacity={0.5}>
          {GRID} ft
        </text>
      </g> : null}

      {/* Arrow marker definition (scoped per floor) */}
	      <defs>
	        <marker id={`dim-arrow-${prefix}`} markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <line x1="0" y1="0" x2="3" y2="3" stroke={traceMode ? drawingStyle.dimensions.stroke : FIXTURE_COLOR} strokeWidth={traceMode ? drawingStyle.dimensions.strokeWidthPx : 0.7} opacity={traceMode ? drawingStyle.dimensions.opacity : 0.7} />
          <line x1="0" y1="6" x2="3" y2="3" stroke={traceMode ? drawingStyle.dimensions.stroke : FIXTURE_COLOR} strokeWidth={traceMode ? drawingStyle.dimensions.strokeWidthPx : 0.7} opacity={traceMode ? drawingStyle.dimensions.opacity : 0.7} />
        </marker>
      </defs>
    </g>
  );
}

function shiftFixture(fixture: RoomFixture, gx: number, gz: number): RoomFixture {
  return {
    ...fixture,
    x: fixture.x - gx,
    z: fixture.z - gz,
    parts: fixture.parts?.map((part) => ({
      ...part,
      x: typeof part.x === 'number' ? part.x - gx : part.x,
	      z: typeof part.z === 'number' ? part.z - gz : part.z,
	      center: Array.isArray(part.center) && part.center.length >= 2
	        ? [part.center[0] - gx, part.center[1] - gz]
	        : part.center,
	    })),
	  };
}

function shiftPart(part: RoomPart, gx: number, gz: number): RoomPart {
  return {
    ...part,
    gx: part.gx - gx,
    gz: part.gz - gz,
  };
}

function shiftAnchor(anchor: RoomLayout['anchor'], gx: number, gz: number): RoomLayout['anchor'] {
  return anchor
    ? {
        gx: anchor.gx - gx,
        gz: anchor.gz - gz,
      }
    : undefined;
}

function shiftConnection(connection: RoomConnection, gx: number, gz: number): RoomConnection {
  return {
    ...connection,
    opening: connection.opening
      ? {
          ...connection.opening,
          x1: connection.opening.x1 - gx,
          z1: connection.opening.z1 - gz,
          x2: connection.opening.x2 - gx,
          z2: connection.opening.z2 - gz,
        }
      : undefined,
  };
}

function shiftSourcePoint<T extends { x: number; z: number } | undefined>(point: T, gx: number, gz: number): T {
  return point
    ? {
        ...point,
        x: point.x - gx,
        z: point.z - gz,
      } as T
    : point;
}

function shiftSourceWall(wall: SourceWallSegment, gx: number, gz: number): SourceWallSegment {
  return {
    ...wall,
    x1: wall.x1 - gx,
    z1: wall.z1 - gz,
    x2: wall.x2 - gx,
    z2: wall.z2 - gz,
    bounds: wall.bounds
      ? {
          ...wall.bounds,
          x: wall.bounds.x - gx,
          z: wall.bounds.z - gz,
        }
      : undefined,
  };
}

function shiftSourceOpening(opening: SourceOpeningSegment, gx: number, gz: number): SourceOpeningSegment {
  return {
    ...opening,
    x1: opening.x1 - gx,
    z1: opening.z1 - gz,
    x2: opening.x2 - gx,
    z2: opening.z2 - gz,
    span: opening.span
      ? {
          x1: opening.span.x1 - gx,
          z1: opening.span.z1 - gz,
          x2: opening.span.x2 - gx,
          z2: opening.span.z2 - gz,
        }
      : undefined,
    hingePoint: shiftSourcePoint(opening.hingePoint, gx, gz),
    leafClosedEnd: shiftSourcePoint(opening.leafClosedEnd, gx, gz),
    leafOpenEnd: shiftSourcePoint(opening.leafOpenEnd, gx, gz),
  };
}

function shiftSpaceFace(face: SourceSpaceFace, gx: number, gz: number): SourceSpaceFace {
  return {
    ...face,
    gx: face.gx - gx,
    gz: face.gz - gz,
    parts: face.parts?.map((part) => shiftPart(part, gx, gz)),
  };
}

function shiftDimensionLine(line: SourceDimensionLine, gx: number, gz: number): SourceDimensionLine {
  return {
    ...line,
    span: {
      x1: line.span.x1 - gx,
      z1: line.span.z1 - gz,
      x2: line.span.x2 - gx,
      z2: line.span.z2 - gz,
    },
  };
}

/* ── main component ────────────────────────────────────────────────── */

export default function FloorPlanView({
  rooms,
  footprint,
  connections,
  sourceWalls,
  sourceOpenings,
  spaceFaces,
  dimensionLines,
  dimensionFrame,
  floorFrames,
  traceMode = false,
  drawingStyleProfile,
  annotations,
}: Props) {
  const activeDrawingStyleProfile = drawingStyleOrDefault(drawingStyleProfile);
  // Group rooms by level: floor < 1 = ground (includes split-level), floor >= 1 = upper
  const floorGroups = useMemo(() => {
    const groups = new Map<number, RoomLayout[]>();
    for (const room of rooms) {
      const floor = room.floor ?? 0;
      // Merge split-level (0.5) into ground (0) for side-by-side display
      const level = floor >= 1 ? floor : 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level)!.push(room);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [rooms]);

  const hasMultipleFloors = floorGroups.length > 1;

  const stackFloors = traceMode && hasMultipleFloors;

  // For single floor: use original footprint.
  // For multi-floor: compute per-floor footprint and lay out side by side.
  const floorLayouts = useMemo(() => {
    if (!hasMultipleFloors) {
      if (traceMode) {
        const floorRooms = floorGroups[0]?.[1] ?? rooms;
        const floorNum = floorGroups[0]?.[0] ?? 0;
        const floorSourceWalls = sourceWalls?.filter((wall) => (wall.floor ?? floorNum) === floorNum);
        const floorSourceOpenings = sourceOpenings?.filter((opening) => (opening.floor ?? floorNum) === floorNum);
        const floorSpaceFaces = spaceFaces?.filter((face) => (face.floor ?? floorNum) === floorNum);
        const floorDimensionLines = dimensionLines?.filter((line) => (line.floor ?? floorNum) === floorNum);
        const roomBounds = floorRooms.map(roomGridBounds);
        const faceBounds = (floorSpaceFaces ?? []).map(spaceFaceGridBounds);
        const wallBounds = (floorSourceWalls ?? []).map((wall) => ({
          gx: Math.min(wall.x1, wall.x2),
          gz: Math.min(wall.z1, wall.z2),
          gw: Math.abs(wall.x2 - wall.x1),
          gd: Math.abs(wall.z2 - wall.z1),
        }));
        const activeFrame = floorFrames?.find((frame) => frame.floor === floorNum) ?? dimensionFrame;
        const frameBounds = activeFrame
          ? [{ gx: activeFrame.gx, gz: activeFrame.gz, gw: activeFrame.gw, gd: activeFrame.gd }]
          : [];
        const bounds = [...roomBounds, ...faceBounds, ...wallBounds, ...frameBounds];
        const minGx = Math.min(...bounds.map((bound) => bound.gx));
        const minGz = Math.min(...bounds.map((bound) => bound.gz));
        const maxGx = Math.max(...bounds.map((bound) => bound.gx + bound.gw));
        const maxGz = Math.max(...bounds.map((bound) => bound.gz + bound.gd));
        const normalizedRooms = floorRooms.map((room) => ({
          ...room,
	          gx: room.gx - minGx,
	          gz: room.gz - minGz,
	          parts: room.parts?.map((part) => shiftPart(part, minGx, minGz)),
	          anchor: shiftAnchor(room.anchor, minGx, minGz),
	          fixtures: room.fixtures?.map((fixture) => shiftFixture(fixture, minGx, minGz)),
        }));
        const normalizedConnections = connections?.map((connection) => shiftConnection(connection, minGx, minGz));
        const normalizedSourceWalls = floorSourceWalls?.map((wall) => shiftSourceWall(wall, minGx, minGz));
        const normalizedSourceOpenings = floorSourceOpenings?.map((opening) => shiftSourceOpening(opening, minGx, minGz));
        const normalizedSpaceFaces = floorSpaceFaces?.map((face) => shiftSpaceFace(face, minGx, minGz));
        const normalizedDimensionLines = floorDimensionLines?.map((line) => shiftDimensionLine(line, minGx, minGz));
        const normalizedFrame = activeFrame
          ? { ...activeFrame, gx: activeFrame.gx - minGx, gz: activeFrame.gz - minGz }
          : { gx: 0, gz: 0, gw: footprint.width / GRID, gd: footprint.depth / GRID };
        return [{
          floorNum,
          rooms: normalizedRooms,
          connections: normalizedConnections,
          sourceWalls: normalizedSourceWalls,
          sourceOpenings: normalizedSourceOpenings,
          spaceFaces: normalizedSpaceFaces,
          dimensionLines: normalizedDimensionLines,
          dimensionFrame: normalizedFrame,
          fp: {
            width: Math.max((maxGx - minGx) * GRID, GRID),
            depth: Math.max((maxGz - minGz) * GRID, GRID),
          },
          offsetX: MARGIN,
          offsetY: MARGIN + FLOOR_LABEL_H,
        }];
      }

      return [{
        floorNum: floorGroups[0]?.[0] ?? 0,
        rooms: rooms,
        connections,
        sourceWalls,
        sourceOpenings,
        spaceFaces,
        dimensionFrame: undefined,
        fp: footprint,
        offsetX: MARGIN,
        offsetY: MARGIN + FLOOR_LABEL_H,
      }];
    }

    const layouts: Array<{
      floorNum: number;
      rooms: RoomLayout[];
      connections?: RoomConnection[];
      sourceWalls?: SourceWallSegment[];
      sourceOpenings?: SourceOpeningSegment[];
      spaceFaces?: SourceSpaceFace[];
      dimensionFrame?: DimensionFrame;
      dimensionLines?: SourceDimensionLine[];
      fp: { width: number; depth: number };
      offsetX: number;
      offsetY: number;
    }> = [];

    // Precompute per-floor footprints first so we can center them consistently
    const perFloorFp = floorGroups.map(([floorNum, floorRooms]) => {
      const bounds = floorRooms.map(roomGridBounds);
      const floorSourceWalls = sourceWalls?.filter((wall) => (wall.floor ?? 0) === floorNum);
      const floorSourceOpenings = sourceOpenings?.filter((opening) => (opening.floor ?? 0) === floorNum);
      const floorSpaceFaces = spaceFaces?.filter((face) => (face.floor ?? 0) === floorNum);
      const floorDimensionLines = dimensionLines?.filter((line) => (line.floor ?? 0) === floorNum);
      const floorDimensionFrame = floorFrames?.find((frame) => frame.floor === floorNum) ?? dimensionFrame;
      const frameBounds = traceMode && floorDimensionFrame
        ? [{ gx: floorDimensionFrame.gx, gz: floorDimensionFrame.gz, gw: floorDimensionFrame.gw, gd: floorDimensionFrame.gd }]
        : [];
      const wallBounds = traceMode
        ? (floorSourceWalls ?? []).map((wall) => ({
            gx: Math.min(wall.x1, wall.x2),
            gz: Math.min(wall.z1, wall.z2),
            gw: Math.abs(wall.x2 - wall.x1),
            gd: Math.abs(wall.z2 - wall.z1),
          }))
        : [];
      const faceBounds = traceMode ? (floorSpaceFaces ?? []).map(spaceFaceGridBounds) : [];
      const traceBounds = traceMode ? [...bounds, ...faceBounds, ...wallBounds, ...frameBounds] : bounds;
      const minGx = Math.min(...traceBounds.map(r => r.gx));
      const minGz = Math.min(...traceBounds.map(r => r.gz));
      const maxGx = Math.max(...traceBounds.map(r => r.gx + r.gw));
      const maxGz = Math.max(...traceBounds.map(r => r.gz + r.gd));
      const normalizedRooms = floorRooms.map((room) => ({
        ...room,
	        gx: room.gx - minGx,
	        gz: room.gz - minGz,
	        parts: room.parts?.map((part) => shiftPart(part, minGx, minGz)),
	        anchor: shiftAnchor(room.anchor, minGx, minGz),
	        fixtures: room.fixtures?.map((fixture) => shiftFixture(fixture, minGx, minGz)),
      }));
      const labels = new Set(floorRooms.map((room) => room.label));
      const normalizedConnections = connections
        ?.filter((connection) => labels.has(connection.from) && labels.has(connection.to))
        .map((connection) => shiftConnection(connection, minGx, minGz));
      const normalizedSourceWalls = floorSourceWalls?.map((wall) => shiftSourceWall(wall, minGx, minGz));
      const normalizedSourceOpenings = floorSourceOpenings?.map((opening) => shiftSourceOpening(opening, minGx, minGz));
      const normalizedSpaceFaces = floorSpaceFaces?.map((face) => shiftSpaceFace(face, minGx, minGz));
      const normalizedDimensionLines = floorDimensionLines?.map((line) => shiftDimensionLine(line, minGx, minGz));
      const fp = {
        width: Math.max((maxGx - minGx) * GRID, GRID),
        depth: Math.max((maxGz - minGz) * GRID, GRID),
      };
      return {
        floorNum,
        floorRooms: normalizedRooms,
        connections: normalizedConnections,
        sourceWalls: normalizedSourceWalls,
        sourceOpenings: normalizedSourceOpenings,
        spaceFaces: normalizedSpaceFaces,
        dimensionLines: normalizedDimensionLines,
        dimensionFrame: traceMode
          ? floorDimensionFrame
            ? { ...floorDimensionFrame, gx: floorDimensionFrame.gx - minGx, gz: floorDimensionFrame.gz - minGz }
            : { gx: 0, gz: 0, gw: footprint.width / GRID, gd: footprint.depth / GRID }
          : undefined,
        fp,
      };
    });

    if (stackFloors) {
      // Vertical stack — width is the widest footprint; each floor centered on it.
      const maxWidthFt = Math.max(...perFloorFp.map(p => p.fp.width));
      const STACKED_FLOOR_GAP = 32;

      let currentY = MARGIN + FLOOR_LABEL_H;
      for (const { floorNum, floorRooms, connections: floorConnections, sourceWalls: floorSourceWalls, sourceOpenings: floorSourceOpenings, spaceFaces: floorSpaceFaces, dimensionFrame: floorDimensionFrame, dimensionLines: floorDimensionLines, fp } of perFloorFp) {
        const offsetX = MARGIN + ((maxWidthFt - fp.width) * PX_PER_FT) / 2;
        layouts.push({
          floorNum,
          rooms: floorRooms,
          connections: floorConnections,
          sourceWalls: floorSourceWalls,
          sourceOpenings: floorSourceOpenings,
          spaceFaces: floorSpaceFaces,
          dimensionLines: floorDimensionLines,
          dimensionFrame: floorDimensionFrame,
          fp,
          offsetX,
          offsetY: currentY,
        });
        currentY += fp.depth * PX_PER_FT + STACKED_FLOOR_GAP + FLOOR_LABEL_H;
      }
    } else {
      // Side-by-side — planner behavior
      let currentX = MARGIN;
      for (const { floorNum, floorRooms, connections: floorConnections, sourceWalls: floorSourceWalls, sourceOpenings: floorSourceOpenings, spaceFaces: floorSpaceFaces, dimensionFrame: floorDimensionFrame, dimensionLines: floorDimensionLines, fp } of perFloorFp) {
        layouts.push({
          floorNum,
          rooms: floorRooms,
          connections: floorConnections,
          sourceWalls: floorSourceWalls,
          sourceOpenings: floorSourceOpenings,
          spaceFaces: floorSpaceFaces,
          dimensionLines: floorDimensionLines,
          dimensionFrame: floorDimensionFrame,
          fp,
          offsetX: currentX,
          offsetY: MARGIN + FLOOR_LABEL_H,
        });
        currentX += fp.width * PX_PER_FT + MARGIN + FLOOR_GAP;
      }
    }

    return layouts;
  }, [connections, dimensionFrame, dimensionLines, floorFrames, floorGroups, hasMultipleFloors, rooms, sourceWalls, sourceOpenings, spaceFaces, footprint, stackFloors, traceMode]);

  const traceLegendEntries = useMemo(() => {
    if (!traceMode) return [];
    const entries = new Map<number, string>();
    const normalized = rooms
      .filter((room) => !isDeckRoom(room))
      .map((room, index) => ({ room, number: proposalCalloutNumber(room, index + 1) }))
      .filter((entry): entry is { room: RoomLayout; number: number } => entry.number !== null)
      .sort((a, b) => a.number - b.number);
    for (const { room, number } of normalized) {
      if (!entries.has(number)) entries.set(number, traceLegendLabel(room.label));
    }
    if (!entries.has(1) && sourceOpenings?.some((opening) => opening.kind === 'door' && (opening.openingType === 'exteriorDoor' || /exterior|entry/i.test(`${opening.id ?? ''} ${opening.fromRoomId ?? ''} ${opening.toRoomId ?? ''}`)))) {
      entries.set(1, 'Entry');
    }
    return [...entries.entries()]
      .sort(([a], [b]) => a - b)
      .map(([number, label]) => ({ number, label }));
  }, [rooms, sourceOpenings, traceMode]);

  // Total SVG dimensions
  const totalW = useMemo(() => {
    if (!hasMultipleFloors) return footprint.width * PX_PER_FT + MARGIN * 2;
    if (stackFloors) {
      const maxWidthFt = Math.max(...floorLayouts.map(l => l.fp.width));
      return maxWidthFt * PX_PER_FT + MARGIN * 2;
    }
    const lastLayout = floorLayouts[floorLayouts.length - 1];
    return lastLayout.offsetX + lastLayout.fp.width * PX_PER_FT + MARGIN;
  }, [floorLayouts, hasMultipleFloors, stackFloors, footprint]);

  const totalH = useMemo(() => {
    const legendRows = traceLegendRows(traceLegendEntries.length);
    const legendHeight = traceLegendEntries.length ? 18 + legendRows * TRACE_LEGEND_ROW_H + MARGIN * 0.35 : 0;
    if (stackFloors) {
      // Sum of all floor depths + labels + gaps
      const lastLayout = floorLayouts[floorLayouts.length - 1];
      return lastLayout.offsetY + lastLayout.fp.depth * PX_PER_FT + MARGIN + legendHeight;
    }
    const maxDepth = Math.max(...floorLayouts.map(l => l.fp.depth));
    return maxDepth * PX_PER_FT + MARGIN * 2 + FLOOR_LABEL_H + legendHeight;
  }, [floorLayouts, stackFloors, traceLegendEntries.length]);

  const traceScale = traceMode && stackFloors ? 1.06 : 1;
  const scaledTotalW = totalW * traceScale;
  const scaledTotalH = totalH * traceScale;
  const svgW = traceMode && stackFloors ? Math.max(totalW, totalH) : totalW;
  const svgH = traceMode && stackFloors ? Math.max(totalW, totalH) : totalH;
  const contentOffsetX = (svgW - scaledTotalW) / 2;
  const contentOffsetY = (svgH - scaledTotalH) / 2;

  const responsiveStyle: React.CSSProperties = {
    background: traceMode ? activeDrawingStyleProfile.rules.background : BG,
    width: '100%',
    height: 'auto',
    display: 'block',
  };

  const annotationBandH = annotations ? 40 : 0;
  return (
    <svg
      data-drawing-style-schema={traceMode ? activeDrawingStyleProfile.schemaVersion : undefined}
      data-drawing-style-profile={traceMode ? activeDrawingStyleProfile.profileId : undefined}
      width={svgW}
      height={svgH + annotationBandH}
      viewBox={`0 0 ${svgW} ${svgH + annotationBandH}`}
      preserveAspectRatio="xMidYMid meet"
      style={responsiveStyle}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform={`translate(${contentOffsetX} ${contentOffsetY}) scale(${traceScale})`}>
      {floorLayouts.map((layout) => (
        <FloorLevel
          key={layout.floorNum}
          floorRooms={layout.rooms}
          allFloorRooms={layout.rooms}
          connections={layout.connections}
          sourceWalls={layout.sourceWalls}
          sourceOpenings={layout.sourceOpenings}
          floorSpaceFaces={layout.spaceFaces}
          dimensionLines={layout.dimensionLines}
          dimensionFrame={layout.dimensionFrame}
          offsetX={layout.offsetX}
          offsetY={layout.offsetY}
          floorNum={layout.floorNum}
          floorFp={layout.fp}
          prefix={`f${layout.floorNum}`}
          traceMode={traceMode}
          drawingStyleProfile={activeDrawingStyleProfile}
          showFloorLabel={traceMode ? floorLayouts.length > 1 : undefined}
        />
      ))}

      {/* Connection arrows between floor levels — side-by-side layout only. */}
      {hasMultipleFloors && floorLayouts.length >= 2 && !stackFloors && (() => {
        const l0 = floorLayouts[0];
        const gapX = l0.offsetX + l0.fp.width * PX_PER_FT + FLOOR_GAP / 2;
        const midY = l0.offsetY + l0.fp.depth * PX_PER_FT * 0.5;
        return (
          <g>
            {/* Arrow from L1 to L2 */}
            <line x1={gapX - 15} y1={midY} x2={gapX + 15} y2={midY}
              stroke={LABEL_COLOR} strokeWidth={1} opacity={0.3}
              markerEnd="url(#floor-arrow)" />
            <text x={gapX} y={midY - 8}
              textAnchor="middle" fontFamily={FONT} fontSize={7}
              fill={LABEL_COLOR} opacity={0.4}>
              STAIRS
            </text>
          </g>
        );
      })()}

      {traceLegendEntries.length ? (() => {
        const lastLayout = floorLayouts[floorLayouts.length - 1];
        const legendY = stackFloors
          ? lastLayout.offsetY + lastLayout.fp.depth * PX_PER_FT + MARGIN * 0.38
          : Math.max(...floorLayouts.map((layout) => layout.offsetY + layout.fp.depth * PX_PER_FT)) + MARGIN * 0.38;
        const columnWidth = Math.min(260, Math.max(160, (totalW - MARGIN * 2) / 2));
        const legendX = Math.max(MARGIN, (totalW - columnWidth * 2) / 2);
        return (
          <g>
            {traceLegendEntries.map((entry, index) => {
              const legendRows = traceLegendRows(traceLegendEntries.length);
              const column = index < legendRows ? 0 : 1;
              const row = column === 0 ? index : index - legendRows;
              const x = legendX + column * columnWidth;
              const y = legendY + row * TRACE_LEGEND_ROW_H;
              return (
                <g key={`trace-legend-${entry.number}`} data-role="callout-legend" transform={`translate(${x} ${y})`}>
                  <circle cx={7} cy={7} r={activeDrawingStyleProfile.rules.callouts.radiusPx} fill={activeDrawingStyleProfile.rules.callouts.fill} opacity={activeDrawingStyleProfile.rules.callouts.opacity} />
                  <text x={7} y={7.4} textAnchor="middle" dominantBaseline="central" fontFamily="Arial, Helvetica, sans-serif" fontSize={activeDrawingStyleProfile.rules.callouts.fontSizePx} fontWeight={700} fill="#fff">
                    {entry.number}
                  </text>
                  <text x={22} y={7.4} dominantBaseline="central" fontFamily={activeDrawingStyleProfile.rules.labels.fontFamily} fontSize={activeDrawingStyleProfile.rules.labels.roomFontSizePx} fill={activeDrawingStyleProfile.rules.labels.fill} opacity={0.9}>
                    {entry.label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })() : null}
      </g>

      <defs>
        {traceMode && <style>{drawingStyleCss(activeDrawingStyleProfile)}</style>}
        <marker id="floor-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0,0 8,3 0,6" fill={LABEL_COLOR} opacity={0.3} />
        </marker>
      </defs>
      {annotations ? (
        <g data-plan-title-block fontFamily={FONT}>
          <line x1={6} y1={svgH + 1} x2={svgW - 6} y2={svgH + 1} stroke="#3d3933" strokeWidth={1.1} />
          <text x={8} y={svgH + 15} fontSize={10} fontWeight={700} fill="#3d3933">
            {annotations.planId.toUpperCase()}
          </text>
          <text x={8} y={svgH + 29} fontSize={7.5} fill="#6f675c">
            {[
              annotations.areaSqft ? `${annotations.areaSqft} sq ft` : null,
              annotations.bedBath ? `${annotations.bedBath} bed/bath` : null,
              annotations.roofStyle ? `${annotations.roofStyle} roof` : null,
              annotations.jsonOnly ? 'JSON-only deterministic' : null,
              'dimensions in feet',
            ].filter(Boolean).join('  ·  ')}
          </text>
          {(() => {
            const pxPerFt = PX_PER_FT * traceScale;
            const barFt = 8;
            const barW = barFt * pxPerFt;
            const bx = svgW - barW - 10;
            const by = svgH + 22;
            return (
              <g data-scale-bar>
                <line x1={bx} y1={by} x2={bx + barW} y2={by} stroke="#3d3933" strokeWidth={1} />
                {[0, 0.5, 1].map((t) => (
                  <line key={t} x1={bx + barW * t} y1={by - 3.5} x2={bx + barW * t} y2={by + 3.5} stroke="#3d3933" strokeWidth={1} />
                ))}
                <rect x={bx} y={by - 2.4} width={barW / 2} height={2.4} fill="#3d3933" opacity={0.85} />
                <text x={bx - 4} y={by + 3} fontSize={6.5} fill="#6f675c" textAnchor="end">0</text>
                <text x={bx + barW / 2} y={by - 6} fontSize={6.5} fill="#6f675c" textAnchor="middle">4&apos;</text>
                <text x={bx + barW} y={by - 6} fontSize={6.5} fill="#6f675c" textAnchor="middle">8&apos;</text>
              </g>
            );
          })()}
          <g data-north-arrow transform={`translate(${svgW - 20}, 22)`}>
            <circle r={11} fill="none" stroke="#3d3933" strokeWidth={1} opacity={0.85} />
            <polygon points="0,-8 3.4,4 0,1.6 -3.4,4" fill="#3d3933" opacity={0.9} />
            <text x={0} y={-13} textAnchor="middle" fontSize={7.5} fontWeight={700} fill="#3d3933">N</text>
          </g>
        </g>
      ) : null}
    </svg>
  );
}
