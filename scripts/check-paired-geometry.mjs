import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_ROOT = path.join(ROOT, 'public/data/den-image-loop');
const TARGET_ARTIFACTS = [
  { planId: 'a-frame-bunk', proposalId: 'proposal-paired-v1' },
  { planId: 'a-frame-22', proposalId: 'proposal-paired-v10' },
  { planId: 'outpost-medium', proposalId: 'proposal-paired-v11' },
];
const TARGET_VALIDATED_ROOF_PLAN = 'a-frame-bunk';
const TOLERANCE_FT = 2;
const EXTERIOR_ROOM_PATTERN = /deck|porch|patio|exterior|eave|clearance|landing/i;
const EXTERNAL_ROOM_IDS = new Set(['exterior', 'outside', 'outdoor']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function footprintDimensions(footprint = {}) {
  if (footprint.width && footprint.depth) return { width: footprint.width, depth: footprint.depth };
  if (footprint.widthFt && footprint.depthFt) return { width: footprint.widthFt, depth: footprint.depthFt };
  if (footprint.w && footprint.d) return { width: footprint.w, depth: footprint.d };
  const polygon = footprint.polygon ?? [];
  if (polygon.length) {
    const xs = polygon.map((point) => point.x);
    const zs = polygon.map((point) => point.z);
    return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...zs) - Math.min(...zs) };
  }
  return { width: 0, depth: 0 };
}

function maxArtifactCoordinate(artifact) {
  const values = [];
  for (const room of artifact.rooms ?? []) {
    for (const point of room.polygon ?? []) values.push(Math.abs(point.x), Math.abs(point.z));
    if (room.bounds) values.push(Math.abs(room.bounds.x), Math.abs(room.bounds.z), Math.abs(room.bounds.x + room.bounds.w), Math.abs(room.bounds.z + room.bounds.d));
  }
  for (const wall of [...(artifact.exteriorWalls ?? []), ...(artifact.interiorWalls ?? [])]) {
    values.push(Math.abs(wall.span.x1), Math.abs(wall.span.z1), Math.abs(wall.span.x2), Math.abs(wall.span.z2));
  }
  return Math.max(0, ...values);
}

function spanToBounds(span) {
  if (!span) return undefined;
  const x = Math.min(span.x1, span.x2);
  const z = Math.min(span.z1, span.z2);
  const w = Math.abs(span.x2 - span.x1);
  const d = Math.abs(span.z2 - span.z1);
  return w > 0 && d > 0 ? { x, z, w, d } : undefined;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function numberValue(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sourceAnchorBounds(anchor) {
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
  return null;
}

function sourceFrameBounds(anchor) {
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
  return sourceAnchorBounds(anchor);
}

function sourceBoundsToGrid(bounds, frame, footprint) {
  if (!bounds || !frame || frame.w <= 0 || frame.d <= 0 || !footprint.width || !footprint.depth) return null;
  return {
    x: (((bounds.x - frame.x) / frame.w) * footprint.width) / 4,
    z: (((bounds.z - frame.z) / frame.d) * footprint.depth) / 4,
    w: ((bounds.w / frame.w) * footprint.width) / 4,
    d: ((bounds.d / frame.d) * footprint.depth) / 4,
  };
}

function validateSourcePrimitiveOverrides(artifact, footprint, blockers) {
  const frame = sourceFrameBounds(artifact.footprint?.sourceAnchor);
  if (!frame) return;
  const anchors = new Map((artifact.sourceAnchors ?? [])
    .filter((anchor) => anchor?.id || anchor?.elementId || anchor?.sourceAnchorId)
    .flatMap((anchor) => [anchor.id, anchor.elementId, anchor.sourceAnchorId].filter(Boolean).map((id) => [String(id), anchor])));
  for (const opening of artifact.sourceOpenings ?? []) {
    if (!opening?.sourceBounds || !opening?.sourceAnchorId) continue;
    const anchor = anchors.get(String(opening.sourceAnchorId));
    const expected = sourceBoundsToGrid(sourceAnchorBounds(anchor), frame, footprint);
    if (!expected) continue;
    const actual = opening.sourceBounds;
    const delta = Math.max(
      Math.abs(numberValue(actual.x) - expected.x),
      Math.abs(numberValue(actual.z) - expected.z),
      Math.abs(numberValue(actual.w) - expected.w),
      Math.abs(numberValue(actual.d) - expected.d),
    );
    if (delta > 0.08) blockers.push(`sourceOpening ${opening.id ?? opening.sourceAnchorId} sourceBounds drift from sourceAnchor by ${delta.toFixed(2)} grid units`);
  }
}

function floorPanelFootprint(panel, fallback) {
  const fp = panel.footprint ?? {};
  if (fp.widthFt && fp.depthFt) return { width: fp.widthFt, depth: fp.depthFt };
  if (fp.width && fp.depth) return { width: fp.width, depth: fp.depth };
  if (fp.w && fp.d) return { width: fp.w, depth: fp.d };
  return fallback;
}

function floorFrames(artifact, footprint) {
  return (artifact.floorPanels ?? [])
    .map((panel) => {
      const fp = floorPanelFootprint(panel, footprint);
      return {
        floor: panel.floor ?? panel.levelIndex ?? 0,
        bounds: panel.bounds ?? panel.footprintBounds ?? panel.drawingBounds ?? panel.interiorBounds ?? spanToBounds(panel.span) ?? panel.panelBounds,
        widthFt: fp.width,
        depthFt: fp.depth,
      };
    })
    .filter((frame) => frame.widthFt > 0 && frame.depthFt > 0);
}

function mapper(artifact, footprint) {
  const frames = floorFrames(artifact, footprint);
  const point = (input) => {
    return input;
  };
  return { frames, point };
}

function uniqueById(items, label, blockers) {
  const seen = new Set();
  for (const [index, item] of (items ?? []).entries()) {
    if (!item?.id) {
      blockers.push(`${label}[${index}] is missing a stable id`);
      continue;
    }
    if (seen.has(item.id)) blockers.push(`${label} duplicate id ${item.id}`);
    seen.add(item.id);
  }
  return seen;
}

function wallOrientation(span) {
  if (!span) return 'unknown';
  return Math.abs(span.x2 - span.x1) >= Math.abs(span.z2 - span.z1) ? 'horizontal' : 'vertical';
}

function spanHostedByWall(span, wallSpan, tolerance = 0.85) {
  if (!span || !wallSpan) return false;
  const openingOrientation = wallOrientation(span);
  const hostOrientation = wallOrientation(wallSpan);
  if (openingOrientation !== hostOrientation) return false;
  if (hostOrientation === 'horizontal') {
    const wallLine = (wallSpan.z1 + wallSpan.z2) / 2;
    const spanLine = (span.z1 + span.z2) / 2;
    if (Math.abs(wallLine - spanLine) > tolerance) return false;
    const hostStart = Math.min(wallSpan.x1, wallSpan.x2) - tolerance;
    const hostEnd = Math.max(wallSpan.x1, wallSpan.x2) + tolerance;
    const spanStart = Math.min(span.x1, span.x2);
    const spanEnd = Math.max(span.x1, span.x2);
    const insideSolid = spanStart >= hostStart && spanEnd <= hostEnd;
    const adjacentGap = Math.abs(spanStart - (hostEnd - tolerance)) <= tolerance || Math.abs(spanEnd - (hostStart + tolerance)) <= tolerance;
    return insideSolid || adjacentGap;
  }
  const wallLine = (wallSpan.x1 + wallSpan.x2) / 2;
  const spanLine = (span.x1 + span.x2) / 2;
  if (Math.abs(wallLine - spanLine) > tolerance) return false;
  const hostStart = Math.min(wallSpan.z1, wallSpan.z2) - tolerance;
  const hostEnd = Math.max(wallSpan.z1, wallSpan.z2) + tolerance;
  const spanStart = Math.min(span.z1, span.z2);
  const spanEnd = Math.max(span.z1, span.z2);
  const insideSolid = spanStart >= hostStart && spanEnd <= hostEnd;
  const adjacentGap = Math.abs(spanStart - (hostEnd - tolerance)) <= tolerance || Math.abs(spanEnd - (hostStart + tolerance)) <= tolerance;
  return insideSolid || adjacentGap;
}

function validRoomRef(roomId, roomIds) {
  if (!roomId) return true;
  const normalized = String(roomId).toLowerCase();
  return roomIds.has(roomId) || EXTERNAL_ROOM_IDS.has(normalized) || normalized.startsWith('exterior-');
}

function validateSemanticGraph(artifact, blockers) {
  const roomIds = uniqueById(artifact.rooms, 'room', blockers);
  const wallIds = new Set([
    ...[...(artifact.exteriorWalls ?? []), ...(artifact.interiorWalls ?? [])].flatMap((wall, index) => {
      if (!wall?.id) {
        blockers.push(`wall[${index}] is missing a stable id`);
        return [];
      }
      if (!wall.span) blockers.push(`${wall.id} is missing a physical wall span`);
      return [wall.id];
    }),
  ]);
  const wallsById = new Map([
    ...(artifact.exteriorWalls ?? []),
    ...(artifact.interiorWalls ?? []),
  ].filter((wall) => wall?.id).map((wall) => [wall.id, wall]));

  for (const collection of ['doors', 'windows', 'openings']) {
    uniqueById(artifact[collection], collection.slice(0, -1), blockers);
    for (const item of artifact[collection] ?? []) {
      if (!item.wallId) {
        blockers.push(`${collection} ${item.id ?? '(missing id)'} is missing wallId`);
      } else if (!wallIds.has(item.wallId)) {
        blockers.push(`${collection} ${item.id ?? '(missing id)'} references missing wall ${item.wallId}`);
      } else if (item.span && !spanHostedByWall(item.span, wallsById.get(item.wallId)?.span)) {
        blockers.push(`${collection} ${item.id ?? '(missing id)'} span is not hosted by wall ${item.wallId}`);
      }
      for (const roomId of [item.fromRoomId, item.toRoomId, ...(item.roomIds ?? [])]) {
        if (!validRoomRef(roomId, roomIds)) blockers.push(`${collection} ${item.id ?? '(missing id)'} references missing room ${roomId}`);
      }
    }
  }

  uniqueById(artifact.fixtures, 'fixture', blockers);
  for (const fixture of artifact.fixtures ?? []) {
    const roomId = fixture.roomId ?? fixture.roomIds?.[0];
    if (!validRoomRef(roomId, roomIds)) blockers.push(`fixture ${fixture.id ?? fixture.fixtureId ?? '(missing id)'} references missing room ${roomId}`);
    if (fixture.anchorWallId && !wallIds.has(fixture.anchorWallId)) blockers.push(`fixture ${fixture.id ?? fixture.fixtureId ?? '(missing id)'} references missing anchor wall ${fixture.anchorWallId}`);
  }
}

function include(bounds, point) {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minZ = Math.min(bounds.minZ, point.z);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxZ = Math.max(bounds.maxZ, point.z);
}

function mappedBounds(artifact, map) {
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const room of artifact.rooms ?? []) {
    // Decks, exterior landings, eave markers, and clearance zones may sit outside
    // the conditioned footprint by design. They are validated by visual drift, but
    // they should not make the core building geometry look oversized.
    if (EXTERIOR_ROOM_PATTERN.test(`${room.type ?? ''} ${room.label ?? ''}`)) continue;
    const floor = room.floor ?? 0;
    const points = room.polygon?.length ? room.polygon : room.bounds ? [
      { x: room.bounds.x, z: room.bounds.z },
      { x: room.bounds.x + room.bounds.w, z: room.bounds.z },
      { x: room.bounds.x + room.bounds.w, z: room.bounds.z + room.bounds.d },
      { x: room.bounds.x, z: room.bounds.z + room.bounds.d },
    ] : [];
    for (const point of points) include(bounds, map.point(point, floor));
  }
  for (const wall of [...(artifact.exteriorWalls ?? []), ...(artifact.interiorWalls ?? [])]) {
    if (/deck/i.test(`${wall.id ?? ''} ${wall.wallKind ?? ''}`)) continue;
    const floor = wall.floor ?? 0;
    include(bounds, map.point({ x: wall.span.x1, z: wall.span.z1 }, floor));
    include(bounds, map.point({ x: wall.span.x2, z: wall.span.z2 }, floor));
  }
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minZ: 0, maxX: 0, maxZ: 0, width: 0, depth: 0 };
  return { ...bounds, width: bounds.maxX - bounds.minX, depth: bounds.maxZ - bounds.minZ };
}

const manifest = readJson(path.join(DATA_ROOT, 'proposal-manifest.json'));
const failures = [];
const summaries = [];

for (const target of TARGET_ARTIFACTS) {
  const { planId, proposalId } = target;
  const option = (manifest.plans?.[planId] ?? []).find((candidate) => candidate.id === proposalId && candidate.pairedArtifact);
  if (!option) {
    failures.push(`${planId}: missing target paired artifact ${proposalId}`);
    continue;
  }
  if (option.archived === true) failures.push(`${planId}/${proposalId}: target artifact is archived`);
  const artifact = readJson(path.join(DATA_ROOT, planId, option.pairedJsonUrl));
  const footprint = footprintDimensions(artifact.footprint);
  const map = mapper(artifact, footprint);
  const bounds = mappedBounds(artifact, map);
  const blockers = [];
  if (artifact.schemaVersion !== 'paired_gpt_floorplan_v1') blockers.push(`unexpected schemaVersion ${artifact.schemaVersion}`);
  if (!footprint.width || !footprint.depth) blockers.push('missing footprint dimensions');
  if (maxArtifactCoordinate(artifact) > Math.max(footprint.width, footprint.depth, 1) * 8) blockers.push('promoted paired artifact still uses pixel coordinates');
  if (!(artifact.exteriorWalls?.length || artifact.interiorWalls?.length)) blockers.push('missing wall graph');
  if (!((artifact.openings?.length ?? 0) + (artifact.windows?.length ?? 0))) blockers.push('missing source openings/windows');
  validateSemanticGraph(artifact, blockers);
  validateSourcePrimitiveOverrides(artifact, footprint, blockers);
  const roofReady = Boolean(artifact.roof?.planes?.length && artifact.elevations?.length >= 2);
  if (planId === TARGET_VALIDATED_ROOF_PLAN && !roofReady) blockers.push('missing validated paired roof/elevation semantics');
  if (bounds.minX < -TOLERANCE_FT || bounds.minZ < -TOLERANCE_FT) blockers.push(`mapped bounds start outside footprint (${bounds.minX.toFixed(1)}, ${bounds.minZ.toFixed(1)})`);
  if (bounds.maxX > footprint.width + TOLERANCE_FT || bounds.maxZ > footprint.depth + TOLERANCE_FT) blockers.push(`mapped bounds exceed footprint (${bounds.maxX.toFixed(1)} x ${bounds.maxZ.toFixed(1)} vs ${footprint.width} x ${footprint.depth})`);
  const status = option.promotionEligible === true
    ? 'promoted'
    : option.pairedReviewStatus ?? option.reviewStatus ?? 'review';
  summaries.push(`${planId}/${option.id}: ${status}, feet, ${map.frames.length} frame(s), ${(artifact.openings?.length ?? 0) + (artifact.windows?.length ?? 0)} opening(s), roof ${roofReady ? 'paired-json' : 'provisional'}, ${bounds.width.toFixed(1)}x${bounds.depth.toFixed(1)}ft bounds`);
  for (const blocker of blockers) failures.push(`${planId}: ${blocker}`);
}

if (failures.length) {
  console.error('paired:geometry failed');
  for (const summary of summaries) console.error(`  ${summary}`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`paired:geometry ok - ${summaries.join('; ')}`);
