'use client';

import React, { useMemo } from 'react';
import type { RoomLayout, RoomFixture, RoomConnection } from '@/lib/types';

/* ── constants ─────────────────────────────────────────────────────── */
const GRID = 4; // feet per cell
const PX_PER_FT = 15; // scale factor
const GRID_PX = GRID * PX_PER_FT; // pixels per grid cell
const MARGIN = 48; // svg padding in px
const WALL_STROKE = 2.0;
const FIXTURE_STROKE = 1;
const FONT = "'Courier New', 'Courier', monospace";
const BG = '#fdfbf7'; // warm cream
const GRID_COLOR = '#e8e4dd';
const WALL_COLOR = '#1a1a1a';
const LABEL_COLOR = '#333';
const FIXTURE_COLOR = '#444';
const WINDOW_COLOR = '#4a90d9';
const DECK_DASH = '6,4';
const DOOR_RADIUS = 2.5 * PX_PER_FT; // 2.5ft door swing radius (standard 30in door)

interface Props {
  rooms: RoomLayout[];
  footprint: { width: number; depth: number };
  connections?: RoomConnection[];
}

/* ── helpers ───────────────────────────────────────────────────────── */

/** Convert grid coords to pixel coords */
function g2p(gridVal: number): number {
  return gridVal * GRID * PX_PER_FT;
}

/** Room pixel bounds (top-left origin) */
function roomRect(r: RoomLayout) {
  return {
    x: g2p(r.gx),
    y: g2p(r.gz),
    w: g2p(r.gw),
    h: g2p(r.gd),
    cx: g2p(r.gx) + g2p(r.gw) / 2,
    cy: g2p(r.gz) + g2p(r.gd) / 2,
  };
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

/* ── fixture renderers ─────────────────────────────────────────────── */

function renderCounter(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  // Thick line along the wall side — inset slightly
  const inset = 4;
  const thickness = 8;
  let x = r.x, y = r.y, w = r.w, h = thickness;
  if (fix.wall === 'front') { x += inset; y += inset; w -= inset * 2; }
  else if (fix.wall === 'back') { x += inset; y = r.y + r.h - thickness - inset; w -= inset * 2; }
  else if (fix.wall === 'left') { x += inset; y += inset; w = thickness; h = r.h - inset * 2; }
  else if (fix.wall === 'right') { x = r.x + r.w - thickness - inset; y += inset; w = thickness; h = r.h - inset * 2; }
  return (
    <g key={key}>
      <rect x={r.x + 2} y={r.y + 2} width={r.w - 4} height={r.h - 4}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.3} />
      <rect x={x} y={y} width={w} height={h}
        fill={FIXTURE_COLOR} stroke="none" opacity={0.7} />
    </g>
  );
}

function renderIsland(_fix: RoomFixture, key: string) {
  const r = fixRect(_fix);
  const inset = 8;
  return (
    <rect key={key}
      x={r.x + inset} y={r.y + inset}
      width={r.w - inset * 2} height={r.h - inset * 2}
      fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE}
      strokeDasharray="4,3" opacity={0.6} />
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

function renderToilet(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const s = Math.min(r.w, r.h);
  const tankW = s * 0.3, tankH = s * 0.15;
  // Tank rectangle (at wall side)
  let tankX = cx - tankW / 2, tankY: number;
  if (fix.wall === 'front' || fix.wall === 'left') {
    tankY = r.y + 6;
  } else {
    tankY = r.y + r.h - tankH - 6;
  }
  return (
    <g key={key}>
      {/* Tank */}
      <rect x={tankX} y={tankY} width={tankW} height={tankH}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.6}
        rx="2" />
      {/* Bowl (oval) */}
      <ellipse cx={cx} cy={cy}
        rx={s * 0.16} ry={s * 0.22}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.6} />
    </g>
  );
}

function renderBed(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 6;
  const ix = r.x + inset, iy = r.y + inset;
  const iw = r.w - inset * 2, ih = r.h - inset * 2;
  // Pillow line at the head (wall side)
  let pillowY: number;
  if (fix.wall === 'front') {
    pillowY = iy + ih * 0.15;
  } else {
    // back or default — pillow at the far end
    pillowY = iy + ih * 0.85;
  }
  return (
    <g key={key}>
      <rect x={ix} y={iy} width={iw} height={ih}
        fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} opacity={0.5} />
      {/* Pillow line */}
      <line x1={ix + 4} y1={pillowY} x2={ix + iw - 4} y2={pillowY}
        stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE + 0.5} opacity={0.6} />
      {/* Two pillow rectangles */}
      <rect x={ix + 6} y={pillowY - 5} width={iw * 0.35} height={10}
        rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
      <rect x={ix + iw - 6 - iw * 0.35} y={pillowY - 5} width={iw * 0.35} height={10}
        rx="3" fill="none" stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
    </g>
  );
}

function renderSofa(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
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

function renderCoffeeTable(fix: RoomFixture, key: string) {
  const r = fixRect(fix);
  const inset = 12;
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
  const numLines = 4;
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
  return (
    <g key={key}>
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      {/* 4 burners in 2×2 grid */}
      <circle cx={x + w * 0.3} cy={y + h * 0.35} r={cr} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      <circle cx={x + w * 0.7} cy={y + h * 0.35} r={cr} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      <circle cx={x + w * 0.3} cy={y + h * 0.65} r={cr} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      <circle cx={x + w * 0.7} cy={y + h * 0.65} r={cr} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
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
  const steps = Math.floor(h / 4); // ~4px per step
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
      <rect x={x} y={y} width={w} height={h} fill="none" stroke={FIXTURE_COLOR} strokeWidth={FIXTURE_STROKE} />
      {lines}
      {/* UP arrow */}
      <polygon points={`${arrowX},${arrowY} ${arrowX - 3},${arrowY + 5} ${arrowX + 3},${arrowY + 5}`}
        fill={FIXTURE_COLOR} />
      <text x={arrowX} y={arrowY + 12} textAnchor="middle" fontSize={5} fill={FIXTURE_COLOR} fontFamily={FONT}>UP</text>
    </g>
  );
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

  switch (fix.type) {
    case 'counter': return renderCounter(fix, key);
    case 'island': return renderIsland(fix, key);
    case 'stove': return renderStove(fix, key);
    case 'sink': return renderSink(fix, key);
    case 'stairs': return renderStairs(fix, key);
    case 'washer': return renderWasherDryer(fix, key);
    case 'dryer': return renderWasherDryer(fix, key);
    case 'tub': return renderTub(fix, key);
    case 'vanity': return renderVanity(fix, key);
    case 'toilet': return renderToilet(fix, key);
    case 'bed': return renderBed(fix, key);
    case 'nightstand': return renderNightstand(fix, key);
    case 'sofa': return renderSofa(fix, key);
    case 'coffee_table': return renderCoffeeTable(fix, key);
    case 'dining_table': return renderDiningTable(fix, key);
    case 'shelves': return renderShelves(fix, key);
    case 'window': return renderWindow(fix, key);
    case 'glass_wall': return renderGlassWall(fix, key);
    case 'bench': return renderBench(fix, key);
    default: return null;
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
  startAngle: number;
  type: 'door' | 'open' | 'sliding';
  /** Door style: 'standard' = full swing, 'pocket' = small arc, 'entry' = large swing */
  style: 'standard' | 'pocket' | 'entry';
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

    // Determine door style based on room types
    const aIsPocket = POCKET_DOOR_TYPES.has(a.type);
    const bIsPocket = POCKET_DOOR_TYPES.has(b.type);
    const aIsEntry = a.type === 'entry';
    const bIsEntry = b.type === 'entry';

    let style: DoorInfo['style'] = 'standard';
    if (aIsPocket || bIsPocket) {
      style = 'pocket'; // bedroom→bathroom, closet doors = pocket door
    }
    if (aIsEntry || bIsEntry) {
      style = 'entry'; // entry connections = full entry door swing
    }

    const aL = a.gx, aR = a.gx + a.gw, aT = a.gz, aB = a.gz + a.gd;
    const bL = b.gx, bR = b.gx + b.gw, bT = b.gz, bB = b.gz + b.gd;

    // Shared vertical edge (a right == b left)
    if (aR === bL && aT < bB && aB > bT) {
      const overlapStart = Math.max(aT, bT);
      const overlapEnd = Math.min(aB, bB);
      const midY = g2p((overlapStart + overlapEnd) / 2);
      const edgeX = g2p(aR);
      result.push({ x: edgeX, y: midY, startAngle: -Math.PI / 2, type: conn.type as DoorInfo['type'], style });
    } else if (bR === aL && aT < bB && aB > bT) {
      const overlapStart = Math.max(aT, bT);
      const overlapEnd = Math.min(aB, bB);
      const midY = g2p((overlapStart + overlapEnd) / 2);
      const edgeX = g2p(aL);
      result.push({ x: edgeX, y: midY, startAngle: Math.PI / 2, type: conn.type as DoorInfo['type'], style });
    }
    // Shared horizontal edge (a bottom == b top)
    else if (aB === bT && aL < bR && aR > bL) {
      const overlapStart = Math.max(aL, bL);
      const overlapEnd = Math.min(aR, bR);
      const midX = g2p((overlapStart + overlapEnd) / 2);
      const edgeY = g2p(aB);
      result.push({ x: midX, y: edgeY, startAngle: 0, type: conn.type as DoorInfo['type'], style });
    } else if (bB === aT && aL < bR && aR > bL) {
      const overlapStart = Math.max(aL, bL);
      const overlapEnd = Math.min(aR, bR);
      const midX = g2p((overlapStart + overlapEnd) / 2);
      const edgeY = g2p(aT);
      result.push({ x: midX, y: edgeY, startAngle: Math.PI, type: conn.type as DoorInfo['type'], style });
    }
  }
  return result;
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

/** LDK open-plan zone types — these rooms flow together without walls */
const OPEN_ZONE_TYPES = new Set(['kitchen_open', 'great_room', 'dining', 'living', 'kitchen', 'entry']);

/** Check if a shared edge between two rooms should be open (no wall) */
function isOpenEdge(
  roomA: RoomLayout,
  roomB: RoomLayout,
  connections?: RoomConnection[],
): boolean {
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

/** Build a set of open edges between rooms, keyed by "edge signature".
 *  An edge is identified by its start/end pixel coordinates.
 *  Returns a Set of "x1,y1,x2,y2" strings for edges that should be open. */
function computeOpenEdges(
  rooms: RoomLayout[],
  connections?: RoomConnection[],
): Set<string> {
  const openEdges = new Set<string>();
  if (!connections) return openEdges;

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (!isOpenEdge(a, b, connections)) continue;

      // Find the shared edge segment between rooms a and b
      const aL = a.gx, aR = a.gx + a.gw, aT = a.gz, aB = a.gz + a.gd;
      const bL = b.gx, bR = b.gx + b.gw, bT = b.gz, bB = b.gz + b.gd;

      // Shared vertical edge (a's right == b's left or vice versa)
      if (aR === bL && aT < bB && aB > bT) {
        const overlapStart = Math.max(aT, bT);
        const overlapEnd = Math.min(aB, bB);
        const x = g2p(aR);
        openEdges.add(`${x},${g2p(overlapStart)},${x},${g2p(overlapEnd)}`);
      } else if (bR === aL && aT < bB && aB > bT) {
        const overlapStart = Math.max(aT, bT);
        const overlapEnd = Math.min(aB, bB);
        const x = g2p(aL);
        openEdges.add(`${x},${g2p(overlapStart)},${x},${g2p(overlapEnd)}`);
      }
      // Shared horizontal edge (a's bottom == b's top or vice versa)
      else if (aB === bT && aL < bR && aR > bL) {
        const overlapStart = Math.max(aL, bL);
        const overlapEnd = Math.min(aR, bR);
        const y = g2p(aB);
        openEdges.add(`${g2p(overlapStart)},${y},${g2p(overlapEnd)},${y}`);
      } else if (bB === aT && aL < bR && aR > bL) {
        const overlapStart = Math.max(aL, bL);
        const overlapEnd = Math.min(aR, bR);
        const y = g2p(aT);
        openEdges.add(`${g2p(overlapStart)},${y},${g2p(overlapEnd)},${y}`);
      }
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
  const r = roomRect(room);
  const segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  // Each side of the room rect
  const sides = [
    { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y },          // top
    { x1: r.x, y1: r.y + r.h, x2: r.x + r.w, y2: r.y + r.h }, // bottom
    { x1: r.x, y1: r.y, x2: r.x, y2: r.y + r.h },          // left
    { x1: r.x + r.w, y1: r.y, x2: r.x + r.w, y2: r.y + r.h }, // right
  ];

  for (const side of sides) {
    const isHorizontal = side.y1 === side.y2;
    // Collect all open segments that overlap with this side
    const openRanges: Array<[number, number]> = [];

    for (const key of openEdges) {
      const [ex1, ey1, ex2, ey2] = key.split(',').map(Number);

      if (isHorizontal) {
        // This side is horizontal (top or bottom)
        if (ey1 === side.y1 && ey2 === side.y1) {
          // Same y — check x overlap
          const oStart = Math.max(Math.min(ex1, ex2), Math.min(side.x1, side.x2));
          const oEnd = Math.min(Math.max(ex1, ex2), Math.max(side.x1, side.x2));
          if (oEnd > oStart) {
            openRanges.push([oStart, oEnd]);
          }
        }
      } else {
        // This side is vertical (left or right)
        if (ex1 === side.x1 && ex2 === side.x1) {
          // Same x — check y overlap
          const oStart = Math.max(Math.min(ey1, ey2), Math.min(side.y1, side.y2));
          const oEnd = Math.min(Math.max(ey1, ey2), Math.max(side.y1, side.y2));
          if (oEnd > oStart) {
            openRanges.push([oStart, oEnd]);
          }
        }
      }
    }

    if (openRanges.length === 0) {
      // No open segments — draw the full side
      segments.push(side);
    } else {
      // Sort open ranges and compute the "closed" (wall) segments
      openRanges.sort((a, b) => a[0] - b[0]);
      // Merge overlapping ranges
      const merged: Array<[number, number]> = [openRanges[0]];
      for (let i = 1; i < openRanges.length; i++) {
        const last = merged[merged.length - 1];
        if (openRanges[i][0] <= last[1]) {
          last[1] = Math.max(last[1], openRanges[i][1]);
        } else {
          merged.push(openRanges[i]);
        }
      }

      // Generate wall segments for the non-open parts
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

  return segments;
}

/** Render a single floor level's plan */
function FloorLevel({
  floorRooms,
  allFloorRooms,
  connections,
  offsetX,
  offsetY,
  floorNum,
  floorFp,
  prefix,
}: {
  floorRooms: RoomLayout[];
  allFloorRooms: RoomLayout[];
  connections?: RoomConnection[];
  offsetX: number;
  offsetY: number;
  floorNum: number;
  floorFp: { width: number; depth: number };
  prefix: string;
}) {
  const isDeck = (r: RoomLayout) => r.type === 'deck';
  const doors = computeDoors(connections, allFloorRooms);
  const openEdges = computeOpenEdges(allFloorRooms, connections);

  // Grid lines
  const gridLines: React.ReactElement[] = [];
  const fw = floorFp.width * PX_PER_FT;
  const fh = floorFp.depth * PX_PER_FT;
  for (let ft = 0; ft <= floorFp.width; ft += GRID) {
    const x = ft * PX_PER_FT;
    gridLines.push(<line key={`gv-${ft}`} x1={x} y1={0} x2={x} y2={fh} stroke={GRID_COLOR} strokeWidth={0.5} />);
  }
  for (let ft = 0; ft <= floorFp.depth; ft += GRID) {
    const y = ft * PX_PER_FT;
    gridLines.push(<line key={`gh-${ft}`} x1={0} y1={y} x2={fw} y2={y} stroke={GRID_COLOR} strokeWidth={0.5} />);
  }

  // Exterior walls per room
  const maxGx = floorFp.width / GRID;
  const maxGz = floorFp.depth / GRID;
  const exteriorWalls = floorRooms.map(room => ({
    top: room.gz === 0,
    bottom: room.gz + room.gd === maxGz,
    left: room.gx === 0,
    right: room.gx + room.gw === maxGx,
  }));

  const label = FLOOR_LABELS[floorNum] ?? `LEVEL ${floorNum}`;

  return (
    <g transform={`translate(${offsetX}, ${offsetY})`}>
      {/* Floor level label */}
      <text
        x={fw / 2} y={-10}
        textAnchor="middle" fontFamily={FONT} fontSize={9} fontWeight={700}
        fill={LABEL_COLOR} opacity={0.55} letterSpacing="1.5"
      >
        {label}
      </text>

      {/* Ground floor outline ghost (shown on loft level for context) */}
      {floorNum > 0 && (
        <rect x={0} y={0} width={fw} height={fh}
          fill="none" stroke={GRID_COLOR} strokeWidth={1}
          strokeDasharray="4,4" opacity={0.4} />
      )}

      {/* Grid lines */}
      <g>{gridLines}</g>

      {/* Room fills */}
      {floorRooms.map((room, i) => {
        const r = roomRect(room);
        const deck = isDeck(room);
        // Subtle zone-based tinting from room color
        const roomColor = room.color || '#fff';
        const fill = deck ? 'none' : (roomColor !== '#fff' ? roomColor + '20' : '#fff');
        return (
          <rect key={`${prefix}-fill-${i}`}
            x={r.x} y={r.y} width={r.w} height={r.h}
            fill={fill}
            stroke={deck ? FIXTURE_COLOR : 'none'}
            strokeWidth={deck ? 1 : 0}
            strokeDasharray={deck ? DECK_DASH : 'none'}
          />
        );
      })}

      {/* LDK open-plan zone outline — draw a single bounding rect around
          all rooms connected by "open" edges to show they're one flowing space */}
      {(() => {
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

        // Draw bounding rect + "LDK" label for clusters with 2+ rooms
        return Array.from(clusters.entries())
          .filter(([, rms]) => rms.length >= 2)
          .map(([root, rms], ci) => {
            const minX = Math.min(...rms.map(r => g2p(r.gx)));
            const minY = Math.min(...rms.map(r => g2p(r.gz)));
            const maxX = Math.max(...rms.map(r => g2p(r.gx + r.gw)));
            const maxY = Math.max(...rms.map(r => g2p(r.gz + r.gd)));
            const totalArea = rms.reduce((sum, r) => sum + (r.area || 0), 0);
            return (
              <g key={`${prefix}-ldk-zone-${ci}`}>
                <rect
                  x={minX} y={minY} width={maxX - minX} height={maxY - minY}
                  fill="rgba(74, 222, 128, 0.04)" stroke="none" />
                {/* LDK zone label at top-left */}
                <text
                  x={minX + 6} y={minY + 11}
                  fontFamily={FONT} fontSize={7} fontWeight={700}
                  fill="#22c55e" opacity={0.45} letterSpacing="1.5">
                  OPEN LDK
                </text>
                {/* Total area badge */}
                <text
                  x={maxX - 6} y={minY + 11}
                  textAnchor="end"
                  fontFamily={FONT} fontSize={6.5}
                  fill="#22c55e" opacity={0.35}>
                  {totalArea} sf
                </text>
              </g>
            );
          });
      })()}

      {/* Room outlines — open connections have no wall line */}
      {floorRooms.filter(r => !isDeck(r)).map((room, i) => {
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

      {/* Exterior walls */}
      {floorRooms.filter(r => !isDeck(r)).map((room, i) => {
        const r = roomRect(room);
        const ext = exteriorWalls[i];
        if (!ext) return null;
        const thick = WALL_STROKE * 3;
        return (
          <g key={`${prefix}-ext-${i}`}>
            {ext.top && <line x1={r.x} y1={r.y} x2={r.x + r.w} y2={r.y} stroke={WALL_COLOR} strokeWidth={thick} />}
            {ext.bottom && <line x1={r.x} y1={r.y + r.h} x2={r.x + r.w} y2={r.y + r.h} stroke={WALL_COLOR} strokeWidth={thick} />}
            {ext.left && <line x1={r.x} y1={r.y} x2={r.x} y2={r.y + r.h} stroke={WALL_COLOR} strokeWidth={thick} />}
            {ext.right && <line x1={r.x + r.w} y1={r.y} x2={r.x + r.w} y2={r.y + r.h} stroke={WALL_COLOR} strokeWidth={thick} />}
          </g>
        );
      })}

      {/* Fixtures */}
      {floorRooms.map((room) =>
        room.fixtures?.map((fix, fi) =>
          renderFixture(fix, `${prefix}-fix-${room.label}-${fi}`)
        )
      )}

      {/* Door swings (only for rooms on this floor) */}
      {doors.map((door, i) => {
        // open connections render nothing (gaps handled by wall segments)
        if (door.type === 'open') return null;

        const path = doorArcPath(door);
        const r = doorRadius(door);
        const isPocket = door.style === 'pocket';
        const isEntry = door.style === 'entry';

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
            <g key={`${prefix}-door-${i}`}>
              <path d={`M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`}
                fill="none"
                stroke={FIXTURE_COLOR}
                strokeWidth={0.5} strokeDasharray="3,2" opacity={0.45} />
              <line x1={door.x} y1={door.y}
                x2={x1} y2={y1}
                stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.4} />
            </g>
          );
        }

        // Entry doors: thicker line, bolder arc fill
        const fillColor = door.type === 'sliding'
          ? 'rgba(74,144,217,0.1)'
          : isEntry ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.05)';
        const strokeColor = door.type === 'sliding' ? WINDOW_COLOR : FIXTURE_COLOR;
        const lineWidth = isEntry ? 1.2 : 1;

        return (
          <g key={`${prefix}-door-${i}`}>
            <path d={path}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={0.7} opacity={0.6} />
            <line x1={door.x} y1={door.y}
              x2={door.x + Math.cos(door.startAngle) * r}
              y2={door.y + Math.sin(door.startAngle) * r}
              stroke={FIXTURE_COLOR} strokeWidth={lineWidth} opacity={0.5} />
          </g>
        );
      })}

      {/* Room labels — open-plan rooms get smaller sub-labels */}
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
          const elev = (room.floor ?? 0);
          const isSplit = elev > 0 && elev < 1;
          const elevFt = Math.round(elev * 8);
          const isOpenPlan = openZoneLabels.has(room.label) && !isDeck(room);

          // Short label for open-plan rooms (strip "Open " prefix)
          const shortLabel = isOpenPlan
            ? room.label.replace(/^Open /, '').toLowerCase()
            : room.label;

          // Scale font size based on room width — avoid overflow in narrow rooms
          const roomWidthPx = r.w;
          const baseFontSize = isOpenPlan ? 8 : 10;
          const maxChars = shortLabel.length;
          const charWidth = baseFontSize * 0.6;
          const labelWidth = maxChars * charWidth;
          const scaledFontSize = labelWidth > roomWidthPx * 0.85
            ? Math.max(6, baseFontSize * (roomWidthPx * 0.85) / labelWidth)
            : baseFontSize;

          return (
            <g key={`${prefix}-label-${i}`}>
              <text x={r.cx} y={r.cy - (isOpenPlan ? 2 : 4)}
                textAnchor="middle" dominantBaseline="central"
                fontFamily={FONT}
                fontSize={scaledFontSize}
                fontWeight={isOpenPlan ? 400 : 600}
                fill={isOpenPlan ? '#666' : LABEL_COLOR}
                opacity={isOpenPlan ? 0.5 : 0.8}
                fontStyle={isOpenPlan ? 'italic' : 'normal'}>
                {shortLabel}
              </text>
              {!isOpenPlan && (
                <text x={r.cx} y={r.cy + 9}
                  textAnchor="middle" dominantBaseline="central"
                  fontFamily={FONT} fontSize={7.5}
                  fill={LABEL_COLOR} opacity={0.45}>
                  {room.area} sf
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
      <g>
        <line x1={0} y1={-MARGIN * 0.55} x2={fw} y2={-MARGIN * 0.55}
          stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.5}
          markerStart={`url(#dim-arrow-${prefix})`} markerEnd={`url(#dim-arrow-${prefix})`} />
        <text x={fw / 2} y={-MARGIN * 0.55 - 5}
          textAnchor="middle" fontFamily={FONT} fontSize={8} fill={LABEL_COLOR} opacity={0.5}>
          {floorFp.width}&apos;
        </text>
      </g>

      {/* Dimension annotations — depth */}
      <g>
        <line x1={-MARGIN * 0.55} y1={0} x2={-MARGIN * 0.55} y2={fh}
          stroke={FIXTURE_COLOR} strokeWidth={0.7} opacity={0.5} />
        <text x={-MARGIN * 0.55} y={fh / 2}
          textAnchor="middle" fontFamily={FONT} fontSize={8} fill={LABEL_COLOR} opacity={0.5}
          transform={`rotate(-90, ${-MARGIN * 0.55}, ${fh / 2})`}>
          {floorFp.depth}&apos;
        </text>
      </g>

      {/* Scale marker */}
      <g transform={`translate(${fw - GRID * PX_PER_FT - 8}, ${fh + MARGIN * 0.45})`}>
        <line x1={0} y1={0} x2={GRID * PX_PER_FT} y2={0} stroke={WALL_COLOR} strokeWidth={1} opacity={0.6} />
        <line x1={0} y1={-3} x2={0} y2={3} stroke={WALL_COLOR} strokeWidth={1} opacity={0.6} />
        <line x1={GRID * PX_PER_FT} y1={-3} x2={GRID * PX_PER_FT} y2={3} stroke={WALL_COLOR} strokeWidth={1} opacity={0.6} />
        <text x={GRID * PX_PER_FT / 2} y={-6}
          textAnchor="middle" fontFamily={FONT} fontSize={8} fill={LABEL_COLOR} opacity={0.5}>
          {GRID} ft
        </text>
      </g>

      {/* Arrow marker definition (scoped per floor) */}
      <defs>
        <marker id={`dim-arrow-${prefix}`} markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <line x1="0" y1="0" x2="3" y2="3" stroke={FIXTURE_COLOR} strokeWidth="0.7" />
          <line x1="0" y1="6" x2="3" y2="3" stroke={FIXTURE_COLOR} strokeWidth="0.7" />
        </marker>
      </defs>
    </g>
  );
}

/* ── main component ────────────────────────────────────────────────── */

export default function FloorPlanView({ rooms, footprint, connections }: Props) {
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

  // For single floor: use original footprint
  // For multi-floor: compute per-floor footprint and lay out side by side
  const floorLayouts = useMemo(() => {
    if (!hasMultipleFloors) {
      return [{
        floorNum: floorGroups[0]?.[0] ?? 0,
        rooms: rooms,
        fp: footprint,
        offsetX: MARGIN,
        offsetY: MARGIN + FLOOR_LABEL_H,
      }];
    }

    const layouts: Array<{
      floorNum: number;
      rooms: RoomLayout[];
      fp: { width: number; depth: number };
      offsetX: number;
      offsetY: number;
    }> = [];

    let currentX = MARGIN;
    for (const [floorNum, floorRooms] of floorGroups) {
      // Compute bounding box for this floor's rooms
      const maxGx = Math.max(...floorRooms.map(r => r.gx + r.gw));
      const maxGz = Math.max(...floorRooms.map(r => r.gz + r.gd));
      // Use ground floor footprint as minimum (loft sits within ground envelope)
      const fp = {
        width: floorNum === 0 ? footprint.width : Math.max(maxGx * GRID, footprint.width),
        depth: floorNum === 0 ? footprint.depth : Math.max(maxGz * GRID, footprint.depth),
      };

      layouts.push({
        floorNum,
        rooms: floorRooms,
        fp,
        offsetX: currentX,
        offsetY: MARGIN + FLOOR_LABEL_H,
      });

      currentX += fp.width * PX_PER_FT + MARGIN + FLOOR_GAP;
    }

    return layouts;
  }, [floorGroups, hasMultipleFloors, rooms, footprint]);

  // Total SVG dimensions
  const totalW = useMemo(() => {
    if (!hasMultipleFloors) return footprint.width * PX_PER_FT + MARGIN * 2;
    const lastLayout = floorLayouts[floorLayouts.length - 1];
    return lastLayout.offsetX + lastLayout.fp.width * PX_PER_FT + MARGIN;
  }, [floorLayouts, hasMultipleFloors, footprint]);

  const totalH = useMemo(() => {
    const maxDepth = Math.max(...floorLayouts.map(l => l.fp.depth));
    return maxDepth * PX_PER_FT + MARGIN * 2 + FLOOR_LABEL_H;
  }, [floorLayouts]);

  return (
    <svg
      width={totalW}
      height={totalH}
      viewBox={`0 0 ${totalW} ${totalH}`}
      style={{ background: BG }}
      xmlns="http://www.w3.org/2000/svg"
    >
      {floorLayouts.map((layout, i) => (
        <FloorLevel
          key={layout.floorNum}
          floorRooms={layout.rooms}
          allFloorRooms={layout.rooms}
          connections={connections}
          offsetX={layout.offsetX}
          offsetY={layout.offsetY}
          floorNum={layout.floorNum}
          floorFp={layout.fp}
          prefix={`f${layout.floorNum}`}
        />
      ))}

      {/* Connection arrows between floor levels */}
      {hasMultipleFloors && floorLayouts.length >= 2 && (() => {
        const l0 = floorLayouts[0];
        const l1 = floorLayouts[1];
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

      <defs>
        <marker id="floor-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
          <polygon points="0,0 8,3 0,6" fill={LABEL_COLOR} opacity={0.3} />
        </marker>
      </defs>
    </svg>
  );
}
