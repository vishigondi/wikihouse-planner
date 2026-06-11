#!/usr/bin/env node
/**
 * Materialize source primitive anchors into explicit sourceWalls/sourceOpenings.
 *
 * This preserves paired semantic JSON as the source of truth while giving the
 * deterministic renderer a primitive wall/opening channel that is tied directly
 * to the GPT proposal image evidence. It does not alter rooms, fixtures, or
 * high-level metadata.
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const planId = argValue('--plan');
const proposalId = argValue('--proposal');
const dryRun = process.argv.includes('--dry-run');

if (!planId || !proposalId) {
  console.error('usage: node scripts/materialize-source-primitive-overrides.mjs --plan PLAN --proposal PROPOSAL [--dry-run]');
  process.exit(2);
}

const pairedPath = resolve(ROOT, `public/data/den-image-loop/${planId}/paired/${planId}-${proposalId}.paired.json`);

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function numberValue(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boundsFromAnchor(anchor) {
  const arrayBounds = Array.isArray(anchor?.pixelBounds)
    ? anchor.pixelBounds
    : Array.isArray(anchor?.bounds)
      ? anchor.bounds
      : null;
  if (arrayBounds?.length >= 4) {
    const [x, z, w, d] = arrayBounds.map(Number);
    if ([x, z, w, d].every(Number.isFinite)) return { x, z, w, d };
  }
  const pixel = objectValue(anchor?.pixelBounds);
  if (pixel) {
    const x = numberValue(pixel.x, Number.NaN);
    const z = numberValue(pixel.z ?? pixel.y, Number.NaN);
    const w = numberValue(pixel.w ?? pixel.width, Number.NaN);
    const d = numberValue(pixel.d ?? pixel.h ?? pixel.height, Number.NaN);
    if ([x, z, w, d].every(Number.isFinite)) return { x, z, w, d };
  }
  const span = objectValue(anchor?.span);
  if (span) {
    const x1 = numberValue(span.x1, Number.NaN);
    const z1 = numberValue(span.z1, Number.NaN);
    const x2 = numberValue(span.x2, Number.NaN);
    const z2 = numberValue(span.z2, Number.NaN);
    if ([x1, z1, x2, z2].every(Number.isFinite)) {
      return { x: Math.min(x1, x2), z: Math.min(z1, z2), w: Math.abs(x2 - x1), d: Math.abs(z2 - z1) };
    }
  }
  return null;
}

function boundsFromFrameAnchor(anchor) {
  const arrayBounds = Array.isArray(anchor?.pixelBounds)
    ? anchor.pixelBounds
    : Array.isArray(anchor?.bounds)
      ? anchor.bounds
      : null;
  if (arrayBounds?.length >= 4) {
    const [x1, z1, x2, z2] = arrayBounds.map(Number);
    if ([x1, z1, x2, z2].every(Number.isFinite) && x2 > x1 && z2 > z1) {
      return { x: x1, z: z1, w: x2 - x1, d: z2 - z1 };
    }
  }
  return boundsFromAnchor(anchor);
}

function panelFootprint(panel, fallback) {
  const fp = objectValue(panel?.footprint);
  return {
    x: numberValue(fp?.x, 0),
    z: numberValue(fp?.z, 0),
    w: numberValue(fp?.widthFt ?? fp?.width ?? fp?.w ?? panel?.bounds?.w, fallback.width),
    d: numberValue(fp?.depthFt ?? fp?.depth ?? fp?.d ?? panel?.bounds?.d, fallback.depth),
  };
}

function semanticExtent(artifact, floor) {
  const spans = [
    ...(artifact.exteriorWalls ?? []),
    ...(artifact.interiorWalls ?? []),
    ...(artifact.openings ?? []),
    ...(artifact.doors ?? []),
    ...(artifact.windows ?? []),
  ]
    .filter((item) => numberValue(item.floor ?? item.levelIndex, 0) === floor)
    .map((item) => objectValue(item.span))
    .filter(Boolean);
  if (!spans.length) return null;
  const xs = spans.flatMap((span) => [span.x1, span.x2].map(Number));
  const zs = spans.flatMap((span) => [span.z1, span.z2].map(Number));
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const z1 = Math.min(...zs);
  const z2 = Math.max(...zs);
  if (![x1, x2, z1, z2].every(Number.isFinite) || x2 <= x1 || z2 <= z1) return null;
  return { x: x1, z: z1, w: x2 - x1, d: z2 - z1 };
}

function frameForFloor(artifact, floor) {
  const fallback = {
    width: numberValue(artifact.footprint?.widthFt ?? artifact.footprint?.width, 0),
    depth: numberValue(artifact.footprint?.depthFt ?? artifact.footprint?.depth, 0),
  };
  const footprintBounds = boundsFromFrameAnchor(artifact.footprint?.sourceAnchor);
  if (footprintBounds && (!artifact.floorPanels?.length)) {
    return {
      ...footprintBounds,
      xFt: numberValue(artifact.footprint?.x, 0),
      zFt: numberValue(artifact.footprint?.z, 0),
      widthFt: fallback.width,
      depthFt: fallback.depth,
    };
  }
  const panel = (artifact.floorPanels ?? []).find((item) => numberValue(item.floor ?? item.levelIndex, 0) === floor && (item.sourceAnchors ?? []).length);
  if (!panel) return null;
  const fp = panelFootprint(panel, fallback);
  const extent = semanticExtent(artifact, floor);
  const allowSemanticExtentFrame = artifact.renderHints?.preferExplicitLevelFrames !== true
    && artifact.renderHints?.materializeSourcePrimitivesUseSemanticExtent !== false;
  const useExtent = allowSemanticExtentFrame
    && extent
    && (extent.x < fp.x - 0.5 || extent.z < fp.z - 0.5 || extent.w > fp.w + 0.75 || extent.d > fp.d + 0.75);
  const anchor = (panel.sourceAnchors ?? []).find((item) => /footprint|levelFootprint/i.test(`${item.kind ?? ''} ${item.id ?? ''}`))
    ?? (panel.sourceAnchors ?? []).find((item) => /levelFrame|buildingFrame/i.test(`${item.kind ?? ''} ${item.id ?? ''}`))
    ?? (panel.sourceAnchors ?? []).find((item) => /dimension/i.test(`${item.kind ?? ''} ${item.id ?? ''}`))
    ?? (panel.sourceAnchors ?? []).find((item) => boundsFromAnchor(item));
  const bounds = boundsFromFrameAnchor(anchor);
  if (!bounds) return null;
  return {
    ...bounds,
    xFt: useExtent ? extent.x : fp.x,
    zFt: useExtent ? extent.z : fp.z,
    widthFt: useExtent ? extent.w : fp.w,
    depthFt: useExtent ? extent.d : fp.d,
  };
}

function pxBoundsToFt(bounds, frame) {
  if (!bounds || !frame || frame.w <= 0 || frame.d <= 0) return null;
  return {
    x: frame.xFt + ((bounds.x - frame.x) / frame.w) * frame.widthFt,
    z: frame.zFt + ((bounds.z - frame.z) / frame.d) * frame.depthFt,
    w: (bounds.w / frame.w) * frame.widthFt,
    d: (bounds.d / frame.d) * frame.depthFt,
  };
}

function pxPointToFt(point, frame) {
  if (!point || !frame || frame.w <= 0 || frame.d <= 0) return null;
  const x = numberValue(point.x, Number.NaN);
  const z = numberValue(point.z ?? point.y, Number.NaN);
  if (![x, z].every(Number.isFinite)) return null;
  return {
    x: frame.xFt + ((x - frame.x) / frame.w) * frame.widthFt,
    z: frame.zFt + ((z - frame.z) / frame.d) * frame.depthFt,
  };
}

function pxSpanToFt(span, frame) {
  const value = objectValue(span);
  if (!value) return null;
  const p1 = pxPointToFt({ x: value.x1, z: value.z1 }, frame);
  const p2 = pxPointToFt({ x: value.x2, z: value.z2 }, frame);
  if (!p1 || !p2) return null;
  return { x1: p1.x, z1: p1.z, x2: p2.x, z2: p2.z };
}

function sourceSpanIsDiagonal(span) {
  const value = objectValue(span);
  if (!value) return false;
  const dx = Math.abs(numberValue(value.x2, Number.NaN) - numberValue(value.x1, Number.NaN));
  const dz = Math.abs(numberValue(value.z2, Number.NaN) - numberValue(value.z1, Number.NaN));
  return Number.isFinite(dx) && Number.isFinite(dz) && dx > 2 && dz > 2;
}

function centerline(bounds) {
  const horizontal = bounds.w >= bounds.d;
  return horizontal
    ? { x1: bounds.x, z1: bounds.z + bounds.d / 2, x2: bounds.x + bounds.w, z2: bounds.z + bounds.d / 2 }
    : { x1: bounds.x + bounds.w / 2, z1: bounds.z, x2: bounds.x + bounds.w / 2, z2: bounds.z + bounds.d };
}

function toGridSpan(span) {
  return { x1: span.x1 / 4, z1: span.z1 / 4, x2: span.x2 / 4, z2: span.z2 / 4 };
}

function toGridBounds(bounds) {
  return { x: bounds.x / 4, z: bounds.z / 4, w: bounds.w / 4, d: bounds.d / 4 };
}

function toGridPoint(point) {
  const value = objectValue(point);
  const x = numberValue(value?.x, Number.NaN);
  const z = numberValue(value?.z, Number.NaN);
  if (![x, z].every(Number.isFinite)) return undefined;
  return { x: x / 4, z: z / 4 };
}

function pointToGrid(point, frame) {
  const value = objectValue(point);
  const x = numberValue(value?.x, Number.NaN);
  const z = numberValue(value?.z, Number.NaN);
  if (![x, z].every(Number.isFinite)) return undefined;
  const looksLikePixel = frame && (Math.abs(x) > frame.widthFt * 2 || Math.abs(z) > frame.depthFt * 2);
  if (!looksLikePixel) return toGridPoint(value);
  if (!frame || frame.w <= 0 || frame.d <= 0) return undefined;
  return {
    x: (frame.xFt + ((x - frame.x) / frame.w) * frame.widthFt) / 4,
    z: (frame.zFt + ((z - frame.z) / frame.d) * frame.depthFt) / 4,
  };
}

function hasExteriorRoom(rooms = []) {
  return rooms.some((room) => /exterior|deck|porch|outside/i.test(String(room ?? '')));
}

function sourceAnchorKeys(anchor) {
  return [anchor?.id, anchor?.elementId, anchor?.sourceAnchorId]
    .filter(Boolean)
    .map(String);
}

function looseExtractedAnchor(anchor) {
  if (anchor?.anchorKind !== 'source-image-primitive') return false;
  const sourceKind = String(anchor?.extraction?.sourceKind ?? anchor?.sourceKind ?? '').trim();
  return sourceKind.length === 0;
}

function sourceAnchorRank(anchor) {
  return looseExtractedAnchor(anchor) ? 0 : 1;
}

function boundsFromFixtureSourceAnchor(anchor) {
  const arrayBounds = Array.isArray(anchor?.pixelBounds)
    ? anchor.pixelBounds
    : Array.isArray(anchor?.bounds)
      ? anchor.bounds
      : null;
  if (arrayBounds?.length >= 4) {
    const [x1, z1, x2, z2] = arrayBounds.map(Number);
    if ([x1, z1, x2, z2].every(Number.isFinite) && x2 > x1 && z2 > z1) {
      return { x: x1, z: z1, w: x2 - x1, d: z2 - z1 };
    }
  }
  return boundsFromAnchor(anchor);
}

function scaleFixtureParts(parts, previousBounds, nextBounds) {
  if (!Array.isArray(parts) || !previousBounds || !nextBounds || previousBounds.w <= 0 || previousBounds.d <= 0) return parts;
  return parts.map((part) => {
    const item = objectValue(part);
    if (!item) return part;
    const x = numberValue(item.x, Number.NaN);
    const z = numberValue(item.z, Number.NaN);
    const w = numberValue(item.w, Number.NaN);
    const d = numberValue(item.d, Number.NaN);
    if (![x, z, w, d].every(Number.isFinite)) return part;
    return {
      ...item,
      x: nextBounds.x + ((x - previousBounds.x) / previousBounds.w) * nextBounds.w,
      z: nextBounds.z + ((z - previousBounds.z) / previousBounds.d) * nextBounds.d,
      w: (w / previousBounds.w) * nextBounds.w,
      d: (d / previousBounds.d) * nextBounds.d,
    };
  });
}

function wallKind(anchor) {
  return [anchor.extraction?.sourceKind, anchor.sourceKind, anchor.kind, anchor.type, 'source-wall']
    .map((value) => String(value ?? '').trim())
    .find(Boolean) ?? 'source-wall';
}

function normalizedOpeningType(value, rooms = []) {
  const text = String(value ?? '').toLowerCase();
  if (/sliding/.test(text)) return 'slidingDoor';
  if (/pocket/.test(text)) return 'pocketDoor';
  if (/bifold|bi-fold|closet/.test(text)) return 'bifoldDoor';
  if (/window|glaz|glass/.test(text)) return 'window';
  if (/pass|cased|open/.test(text)) return 'passthrough';
  if (/exterior|entry|threshold|deck/.test(text)) return 'exteriorDoor';
  if (/swing|door/.test(text)) return hasExteriorRoom(rooms) ? 'exteriorDoor' : 'interiorDoor';
  if (hasExteriorRoom(rooms)) return 'exteriorDoor';
  return 'opening';
}

function openingKind(anchor) {
  if (anchor.elementType === 'window') return 'window';
  if (anchor.elementType === 'door') return 'door';
  return /window|glaz/i.test(`${anchor.id ?? ''} ${wallKind(anchor)}`) ? 'window' : 'opening';
}

function intervalForSpan(span, horizontal) {
  return horizontal
    ? [Math.min(span.x1, span.x2), Math.max(span.x1, span.x2)]
    : [Math.min(span.z1, span.z2), Math.max(span.z1, span.z2)];
}

function intervalOverlap(a, b) {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

function intervalGap(a, b) {
  if (a[1] < b[0]) return b[0] - a[1];
  if (b[1] < a[0]) return a[0] - b[1];
  return 0;
}

function nearestWallId(opening, walls) {
  const horizontal = Math.abs(opening.x2 - opening.x1) >= Math.abs(opening.z2 - opening.z1);
  const line = horizontal ? (opening.z1 + opening.z2) / 2 : (opening.x1 + opening.x2) / 2;
  const openingInterval = intervalForSpan(opening, horizontal);
  const candidates = walls
    .filter((wall) => wall.floor === opening.floor)
    .map((wall) => {
      const wallHorizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
      const wallLine = wallHorizontal ? (wall.z1 + wall.z2) / 2 : (wall.x1 + wall.x2) / 2;
      const sameAxis = wallHorizontal === horizontal;
      const wallInterval = intervalForSpan(wall, horizontal);
      const overlap = sameAxis ? intervalOverlap(openingInterval, wallInterval) : 0;
      const gap = sameAxis ? intervalGap(openingInterval, wallInterval) : 99;
      const distance = Math.abs(wallLine - line) + (sameAxis ? 0 : 10);
      return { wall, sameAxis, distance, overlap, gap };
    })
    .sort((a, b) => {
      if (a.sameAxis !== b.sameAxis) return a.sameAxis ? -1 : 1;
      if (a.gap !== b.gap) return a.gap - b.gap;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return b.overlap - a.overlap;
    });
  return candidates[0]?.wall.id;
}

const artifact = JSON.parse(await readFile(pairedPath, 'utf8'));
const sourceWalls = [];
const sourceOpenings = [];
const sourceAnchorById = new Map();
for (const anchor of artifact.sourceAnchors ?? []) {
  for (const key of sourceAnchorKeys(anchor)) {
    const current = sourceAnchorById.get(key);
    if (!current || sourceAnchorRank(anchor) >= sourceAnchorRank(current)) sourceAnchorById.set(key, anchor);
  }
}
const curatedAnchorElementIds = new Set(
  (artifact.sourceAnchors ?? [])
    .filter((anchor) => !looseExtractedAnchor(anchor))
    .flatMap((anchor) => [anchor?.elementId, anchor?.targetId].filter(Boolean).map(String)),
);
const semanticExteriorWallIds = new Set((artifact.exteriorWalls ?? []).map((wall) => String(wall.id ?? '')));
const semanticWallById = new Map([
  ...(artifact.exteriorWalls ?? []).map((wall) => [String(wall.id ?? ''), { ...wall, exterior: true }]),
  ...(artifact.interiorWalls ?? []).map((wall) => [String(wall.id ?? ''), { ...wall, exterior: false }]),
]);
const semanticOpeningById = new Map();
for (const opening of [
  ...(artifact.doors ?? []),
  ...(artifact.windows ?? []),
  ...(artifact.openings ?? []),
]) {
  const keys = [opening.id, opening.sourceAnchorId].filter(Boolean).map(String);
  for (const key of keys) {
    if (!semanticOpeningById.has(key)) semanticOpeningById.set(key, opening);
  }
}

function sourceWallBaseId(id) {
  return String(id ?? '').replace(/:seg-\d+$/i, '');
}

function semanticWallForId(id) {
  const value = String(id ?? '');
  return semanticWallById.get(value) ?? semanticWallById.get(sourceWallBaseId(value)) ?? null;
}

function inferredExteriorWall(id, anchor) {
  const semanticWall = semanticWallForId(id);
  if (semanticWall) return Boolean(semanticWall.exterior) || semanticExteriorWallIds.has(sourceWallBaseId(id));
  const text = `${id} ${anchor.elementType ?? ''} ${wallKind(anchor)}`;
  return /^ew[-_:]/i.test(String(id)) || /exteriorWall|exterior-wall|a-frame|deck|rail|glaz|window|exterior/i.test(text);
}

function inferredWallKind(id, anchor) {
  const semanticWall = semanticWallForId(id);
  return semanticWall?.wallKind ?? semanticWall?.kind ?? semanticWall?.type ?? wallKind(anchor) ?? (inferredExteriorWall(id, anchor) ? 'exterior-wall' : 'interior-wall');
}

for (const anchor of artifact.sourceAnchors ?? []) {
  const elementType = String(anchor.elementType ?? '');
  const normalizedElementType = elementType === 'exteriorWall' || elementType === 'interiorWall'
    ? 'wall'
    : elementType === 'opening'
      ? openingKind(anchor)
      : elementType;
  if (!['wall', 'door', 'window'].includes(normalizedElementType)) continue;
  const floor = numberValue(anchor.floor, 0);
  const frame = frameForFloor(artifact, floor);
  const ftBounds = pxBoundsToFt(boundsFromAnchor(anchor), frame);
  if (!ftBounds) continue;
  const id = String(anchor.elementId ?? anchor.id ?? `${normalizedElementType}-${sourceWalls.length + sourceOpenings.length}`);
  if (looseExtractedAnchor(anchor) && curatedAnchorElementIds.has(id)) continue;
  if (normalizedElementType === 'wall') {
    const exterior = inferredExteriorWall(id, anchor);
    const kind = inferredWallKind(id, anchor) || (exterior ? 'exterior-wall' : 'interior-wall');
    const preserveDiagonalSpan = sourceSpanIsDiagonal(anchor.span)
      && /diagonal|void|open.?to.?below/i.test(`${id} ${kind}`);
    const spanFt = preserveDiagonalSpan ? (pxSpanToFt(anchor.span, frame) ?? centerline(ftBounds)) : centerline(ftBounds);
    sourceWalls.push({
      id,
      sourceAnchorId: id,
      floor,
      ...toGridSpan(spanFt),
      bounds: toGridBounds(ftBounds),
      exterior,
      wallKind: kind,
      source: 'source-image-primitive-override',
    });
  } else {
    const kind = openingKind(anchor);
    const semanticOpening = semanticOpeningById.get(id) ?? null;
    const semanticSpan = kind === 'door' && semanticOpening?.span
      ? objectValue(semanticOpening.span)
      : null;
    const spanFt = semanticSpan
      ? {
          x1: numberValue(semanticSpan.x1, Number.NaN),
          z1: numberValue(semanticSpan.z1, Number.NaN),
          x2: numberValue(semanticSpan.x2, Number.NaN),
          z2: numberValue(semanticSpan.z2, Number.NaN),
        }
      : centerline(ftBounds);
    if (![spanFt.x1, spanFt.z1, spanFt.x2, spanFt.z2].every(Number.isFinite)) continue;
    const span = toGridSpan(spanFt);
    const openingRooms = semanticOpening ? [semanticOpening.fromRoomId, semanticOpening.toRoomId].filter(Boolean) : [];
    const semanticOpeningType = semanticOpening?.openingType || semanticOpening?.type || semanticOpening?.kind || (kind === 'door' ? 'door' : wallKind(anchor));
    const openingType = kind === 'window'
      ? 'window'
      : normalizedOpeningType(semanticOpeningType, openingRooms);
    const semanticDoorFields = kind === 'door' && semanticOpening
      ? {
          openingType,
          fromRoomId: semanticOpening.fromRoomId,
          toRoomId: semanticOpening.toRoomId,
          hingePoint: pointToGrid(semanticOpening.hingePoint, frame),
          leafClosedEnd: pointToGrid(semanticOpening.leafClosedEnd, frame),
          leafOpenEnd: pointToGrid(semanticOpening.leafOpenEnd, frame),
          swingDirection: semanticOpening.swingDirection,
          swingArcDeg: semanticOpening.swingArcDeg ?? 90,
          opensIntoRoomId: semanticOpening.opensIntoRoomId ?? semanticOpening.swingRoomId,
        }
      : {};
    sourceOpenings.push({
      id,
      floor,
      kind,
      openingType,
      ...semanticDoorFields,
      ...span,
      span,
      widthFt: semanticOpening?.widthFt ?? Math.hypot(spanFt.x2 - spanFt.x1, spanFt.z2 - spanFt.z1),
      heightFt: kind === 'window' ? 4 : 7,
      sourceBounds: toGridBounds(ftBounds),
      sourceAnchorId: id,
      wallId: semanticOpening?.wallId,
      source: 'source-image-primitive-override',
    });
  }
}

const segmentedWallBases = new Set(
  sourceWalls
    .map((wall) => String(wall.id ?? ''))
    .filter((id) => /:seg-\d+$/i.test(id))
    .map((id) => id.replace(/:seg-\d+$/i, '')),
);
const finalSourceWallsById = new Map();
for (const wall of sourceWalls.filter((wall) => {
  const id = String(wall.id ?? '');
  return /:seg-\d+$/i.test(id) || !segmentedWallBases.has(id);
})) {
  finalSourceWallsById.set(String(wall.id ?? `wall-${finalSourceWallsById.size}`), wall);
}
const finalSourceWalls = [...finalSourceWallsById.values()];

const finalSourceOpeningsById = new Map();
for (const opening of sourceOpenings) {
  finalSourceOpeningsById.set(String(opening.id ?? `opening-${finalSourceOpeningsById.size}`), opening);
}
const finalSourceOpenings = [...finalSourceOpeningsById.values()];

for (const opening of finalSourceOpenings) {
  opening.wallId = opening.wallId ?? nearestWallId(opening, finalSourceWalls);
}

const nextFixtures = (artifact.fixtures ?? []).map((fixture) => {
  const floor = numberValue(fixture.floor ?? fixture.levelIndex, 0);
  const frame = frameForFloor(artifact, floor);
  const anchor = sourceAnchorById.get(String(fixture.sourceAnchorId ?? ''))
    ?? sourceAnchorById.get(String(fixture.id ?? ''))
    ?? sourceAnchorById.get(String(fixture.fixtureId ?? ''))
    ?? objectValue(fixture.sourceAnchor);
  const pxBounds = boundsFromFixtureSourceAnchor(anchor);
  const ftBounds = pxBoundsToFt(pxBounds, frame);
  if (!ftBounds || ftBounds.w < 0.25 || ftBounds.d < 0.25) return fixture;
  const nextBounds = {
    x: Number(ftBounds.x.toFixed(4)),
    z: Number(ftBounds.z.toFixed(4)),
    w: Number(ftBounds.w.toFixed(4)),
    d: Number(ftBounds.d.toFixed(4)),
  };
  const previousBounds = objectValue(fixture.bounds);
  return {
    ...fixture,
    bounds: nextBounds,
    parts: scaleFixtureParts(fixture.parts, previousBounds, nextBounds),
    sourceAnchorId: fixture.sourceAnchorId ?? anchor?.id ?? anchor?.elementId ?? fixture.id,
    repairNote: 'bounds aligned to source image primitive for source/render fidelity',
  };
});

const next = {
  ...artifact,
  sourceWalls: finalSourceWalls,
  sourceOpenings: finalSourceOpenings,
  fixtures: nextFixtures,
};

console.log(JSON.stringify({ planId, proposalId, sourceWalls: finalSourceWalls.length, sourceOpenings: finalSourceOpenings.length, dryRun }, null, 2));
if (!dryRun) {
  await copyFile(pairedPath, `${pairedPath}.bak-${Date.now()}`);
  await writeFile(pairedPath, `${JSON.stringify(next, null, 2)}\n`);
}
