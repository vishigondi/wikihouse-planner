#!/usr/bin/env node
/**
 * Regenerate stored deterministic SVGs from the live paired semantic renderer.
 *
 * The product Compare/Overlay views intentionally show stored render artifacts,
 * not a live debug surface. After semantic JSON or renderer changes, those SVGs
 * must be refreshed from the app so the visible artifact and primitive QA use
 * the same source of truth.
 */

import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOOP_ROOT = resolve(ROOT, 'public/data/den-image-loop');
const MANIFEST_PATH = resolve(LOOP_ROOT, 'proposal-manifest.json');
const BASE_URL = process.env.BROCHURE_QA_URL ?? process.env.APP_URL ?? 'http://127.0.0.1:3000';

function parseArgs(argv) {
  const args = {
    plans: (process.env.BROCHURE_QA_PLANS ?? 'a-frame-bunk,a-frame-22,outpost-medium,gen-001')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plans') {
      args.plans = argv[++index].split(',').map((item) => item.trim()).filter(Boolean);
    } else if (arg === '--url') {
      args.url = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  if (!path) return null;
  try {
    return await readJson(path);
  } catch {
    return null;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sourceBoxForSpan(span) {
  if (!span || typeof span.x1 !== 'number' || typeof span.z1 !== 'number' || typeof span.x2 !== 'number' || typeof span.z2 !== 'number') return null;
  return {
    x: Math.min(span.x1, span.x2),
    y: Math.min(span.z1, span.z2),
    width: Math.abs(span.x2 - span.x1),
    height: Math.abs(span.z2 - span.z1),
  };
}

function sourcePrimitiveBoxForSpan(span) {
  const box = sourceBoxForSpan(span);
  if (!box) return null;
  const thinX = box.width <= 0;
  const thinY = box.height <= 0;
  const minThickness = 1;
  return {
    x: box.width > 0 ? box.x : box.x - minThickness / 2,
    y: box.height > 0 ? box.y : box.y - minThickness / 2,
    width: Math.max(minThickness, box.width),
    height: Math.max(minThickness, box.height),
    thinX,
    thinY,
  };
}

function unionSpans(spans) {
  const valid = spans.filter((span) => span
    && typeof span.x1 === 'number'
    && typeof span.z1 === 'number'
    && typeof span.x2 === 'number'
    && typeof span.z2 === 'number');
  if (!valid.length) return null;
  const xs = valid.flatMap((span) => [span.x1, span.x2]);
  const zs = valid.flatMap((span) => [span.z1, span.z2]);
  return { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
}

function spanFromBoundsLike(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value) && value.length >= 4) {
    const [x1, z1, x2, z2] = value.map(Number);
    if ([x1, z1, x2, z2].every(Number.isFinite)) return { x1, z1, x2, z2 };
  }
  const direct = sourceBoxForSpan(value);
  if (direct) return value;
  const x = Number(value.x);
  const z = Number(value.z ?? value.y);
  const w = Number(value.w ?? value.width);
  const d = Number(value.d ?? value.h ?? value.height);
  if ([x, z, w, d].every(Number.isFinite)) return { x1: x, z1: z, x2: x + w, z2: z + d };
  return null;
}

function sourceFrameSpanFromAnchor(anchor) {
  return spanFromBoundsLike(anchor?.span)
    ?? spanFromBoundsLike(anchor?.pixelBounds)
    ?? spanFromBoundsLike(anchor?.planBounds)
    ?? spanFromBoundsLike(anchor?.bounds);
}

function sourceGridFrame(artifact, floor) {
  const fallbackFootprint = artifact.footprint ?? {};
  const panel = (artifact.floorPanels ?? []).find((item) => String(item?.floor ?? item?.levelIndex ?? 0) === String(floor));
  const footprint = panel?.footprint ?? fallbackFootprint;
  const widthFt = Number(footprint?.widthFt ?? footprint?.width ?? footprint?.w ?? fallbackFootprint.widthFt ?? fallbackFootprint.width);
  const depthFt = Number(footprint?.depthFt ?? footprint?.depth ?? footprint?.d ?? fallbackFootprint.depthFt ?? fallbackFootprint.depth);
  const xFt = Number(footprint?.x ?? fallbackFootprint.x ?? 0);
  const zFt = Number(footprint?.z ?? fallbackFootprint.z ?? 0);
  const anchor = (panel?.sourceAnchors ?? []).find((item) => /footprint|levelFootprint/i.test(`${item?.kind ?? ''} ${item?.id ?? ''}`))
    ?? (panel?.sourceAnchors ?? []).find((item) => /levelFrame|buildingFrame/i.test(`${item?.kind ?? ''} ${item?.id ?? ''}`))
    ?? (panel?.sourceAnchors ?? []).find((item) => sourceFrameSpanFromAnchor(item))
    ?? fallbackFootprint.sourceAnchor
    ?? artifact.coordinateSystem?.planPixelBounds;
  const sourceFrame = sourceFrameSpanFromAnchor(anchor) ?? spanFromBoundsLike(anchor);
  if (![widthFt, depthFt, xFt, zFt].every(Number.isFinite) || widthFt <= 0 || depthFt <= 0 || !sourceFrame) return null;
  return {
    sourceFrame,
    xGrid: xFt / 4,
    zGrid: zFt / 4,
    widthGrid: widthFt / 4,
    depthGrid: depthFt / 4,
  };
}

function mapGridPointToSource(point, frame) {
  const widthPx = frame.sourceFrame.x2 - frame.sourceFrame.x1;
  const depthPx = frame.sourceFrame.z2 - frame.sourceFrame.z1;
  if (Math.abs(widthPx) < 0.001 || Math.abs(depthPx) < 0.001 || frame.widthGrid <= 0 || frame.depthGrid <= 0) return null;
  return {
    x: frame.sourceFrame.x1 + ((point.x - frame.xGrid) / frame.widthGrid) * widthPx,
    z: frame.sourceFrame.z1 + ((point.z - frame.zGrid) / frame.depthGrid) * depthPx,
  };
}

function sourcePrimitiveOverrideSpan(item, artifact) {
  if (item?.source !== 'source-image-primitive-override') return null;
  const floor = item?.floor ?? item?.levelIndex ?? item?.floorIndex ?? 0;
  const frame = sourceGridFrame(artifact, floor);
  if (!frame) return null;
  const span = spanFromBoundsLike(item?.sourceBounds)
    ?? spanFromBoundsLike(item?.bounds)
    ?? spanFromBoundsLike(item?.sourcePixelBounds)
    ?? spanFromBoundsLike(item?.pixelBounds)
    ?? spanFromBoundsLike(item?.span)
    ?? spanFromBoundsLike(item);
  if (!span) return null;
  const a = mapGridPointToSource({ x: span.x1, z: span.z1 }, frame);
  const b = mapGridPointToSource({ x: span.x2, z: span.z2 }, frame);
  if (!a || !b) return null;
  return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
}

function exactAnchorIsStaleForOverride(item, anchor) {
  if (item?.source !== 'source-image-primitive-override' || !anchor) return false;
  const sourceKind = String(anchor?.extraction?.sourceKind ?? anchor?.sourceKind ?? '').trim();
  return sourceKind.length === 0;
}

function sourceAnchorSpan(item, artifact) {
  const overrideSpan = sourcePrimitiveOverrideSpan(item, artifact);
  if (overrideSpan) return overrideSpan;
  const direct = spanFromBoundsLike(item?.sourceAnchor?.span)
    ?? spanFromBoundsLike(item?.sourceAnchor?.pixelBounds)
    ?? spanFromBoundsLike(item?.sourceAnchor?.planBounds)
    ?? spanFromBoundsLike(item?.sourceAnchor?.bounds);
  const itemSourceSpan = spanFromBoundsLike(item?.sourcePixelBounds)
    ?? spanFromBoundsLike(item?.pixelBounds)
    ?? spanFromBoundsLike(item?.bounds)
    ?? spanFromBoundsLike(item?.span);
  const text = `${item?.id ?? ''} ${item?.kind ?? ''} ${item?.dimensionKind ?? ''} ${item?.type ?? ''} ${item?.fixtureKind ?? ''} ${item?.symbolVariant ?? ''}`;
  const areaText = `${item?.id ?? ''} ${item?.sourceAnchorId ?? ''} ${item?.kind ?? ''} ${item?.type ?? ''} ${item?.fixtureKind ?? ''} ${item?.symbolVariant ?? ''}`.toLowerCase();
  if (/door|ladder|stair/i.test(text) && direct) return direct;
  if (/fixture|furn|bed|sofa|chair|table|sink|toilet|tub|shower|range|washer|dryer|counter/.test(areaText) && direct) return direct;
  const id = item?.sourceAnchorId ?? item?.sourceAnchor?.id ?? item?.id;
  const anchors = [
    ...(artifact.sourceAnchors ?? []),
    ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
  ];
  const itemId = typeof item?.id === 'string' ? item.id : '';
  if (itemId && /door|window|glaz|ladder|stair|fixture|furn|bed|sofa|chair|table|sink|toilet|tub|shower|range|washer|dryer|counter/.test(areaText)) {
    const richer = anchors
      .filter((anchor) => {
        const ids = [anchor?.id, anchor?.sourceAnchorId, anchor?.elementId, anchor?.targetId].filter(Boolean).map(String);
        return ids.includes(itemId) || ids.some((candidate) => candidate === `${itemId}-anchor` || candidate.endsWith(`-${itemId}-anchor`));
      })
      .map((anchor) => spanFromBoundsLike(anchor?.span)
        ?? spanFromBoundsLike(anchor?.pixelBounds)
        ?? spanFromBoundsLike(anchor?.planBounds)
        ?? spanFromBoundsLike(anchor?.bounds))
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.x2 - b.x1) * Math.abs(b.z2 - b.z1) - Math.abs(a.x2 - a.x1) * Math.abs(a.z2 - a.z1))[0];
    if (richer) return richer;
  }
  if (id) {
    const exactAnchor = anchors.find((candidate) => {
      const candidateId = candidate?.id ?? candidate?.sourceAnchorId ?? candidate?.elementId;
      return candidateId === id;
    });
    const anchor = exactAnchor ?? anchors.find((candidate) => {
      const candidateId = candidate?.id ?? candidate?.sourceAnchorId ?? candidate?.elementId;
      return typeof candidateId === 'string' && id.startsWith(`${candidateId}:seg-`);
    });
    const anchorSpan = spanFromBoundsLike(anchor?.span)
      ?? spanFromBoundsLike(anchor?.pixelBounds)
      ?? spanFromBoundsLike(anchor?.planBounds)
      ?? spanFromBoundsLike(anchor?.bounds);
    if (anchorSpan && !exactAnchorIsStaleForOverride(item, anchor)) return anchorSpan;
    const segmentSpans = anchors
      .filter((candidate) => {
        const candidateId = candidate?.id ?? candidate?.sourceAnchorId ?? candidate?.elementId;
        return typeof candidateId === 'string' && candidateId.startsWith(`${id}:seg-`);
      })
      .map((candidate) => spanFromBoundsLike(candidate?.span)
        ?? spanFromBoundsLike(candidate?.pixelBounds)
        ?? spanFromBoundsLike(candidate?.planBounds)
        ?? spanFromBoundsLike(candidate?.bounds))
      .filter(Boolean);
    const union = unionSpans(segmentSpans);
    if (union) return union;
  }
  return direct ?? (/dimension/i.test(text) ? itemSourceSpan : null);
}

function floorPrimitiveTargetFrames(artifact) {
  const byFloor = new Map();
  const fallbackByFloor = new Map();
  const buildingByFloor = new Map();
  const explicitByFloor = new Map();
  const addSpan = (floor, span) => {
    const box = sourceBoxForSpan(span);
    if (!box || box.width <= 0 || box.height <= 0) return;
    const current = byFloor.get(floor) ?? { floor, x: box.x, y: box.y, x2: box.x + box.width, y2: box.y + box.height };
    current.x = Math.min(current.x, box.x);
    current.y = Math.min(current.y, box.y);
    current.x2 = Math.max(current.x2, box.x + box.width);
    current.y2 = Math.max(current.y2, box.y + box.height);
    byFloor.set(floor, current);
  };
  const addBuildingSpan = (floor, span) => {
    const box = sourceBoxForSpan(span);
    if (!box || box.width <= 0 || box.height <= 0) return;
    const current = buildingByFloor.get(floor) ?? { floor, x: box.x, y: box.y, x2: box.x + box.width, y2: box.y + box.height };
    current.x = Math.min(current.x, box.x);
    current.y = Math.min(current.y, box.y);
    current.x2 = Math.max(current.x2, box.x + box.width);
    current.y2 = Math.max(current.y2, box.y + box.height);
    buildingByFloor.set(floor, current);
  };
  const addFallbackSpan = (floor, span) => {
    const box = sourceBoxForSpan(span);
    if (!box || box.width <= 0 || box.height <= 0) return;
    const current = fallbackByFloor.get(floor) ?? { floor, x: box.x, y: box.y, x2: box.x + box.width, y2: box.y + box.height };
    current.x = Math.min(current.x, box.x);
    current.y = Math.min(current.y, box.y);
    current.x2 = Math.max(current.x2, box.x + box.width);
    current.y2 = Math.max(current.y2, box.y + box.height);
    fallbackByFloor.set(floor, current);
  };
  const addExplicitSpan = (floor, span) => {
    const box = sourceBoxForSpan(span);
    if (!box || box.width <= 0 || box.height <= 0) return;
    const current = explicitByFloor.get(floor) ?? { floor, x: box.x, y: box.y, x2: box.x + box.width, y2: box.y + box.height };
    current.x = Math.min(current.x, box.x);
    current.y = Math.min(current.y, box.y);
    current.x2 = Math.max(current.x2, box.x + box.width);
    current.y2 = Math.max(current.y2, box.y + box.height);
    explicitByFloor.set(floor, current);
  };
  for (const panel of artifact.floorPanels ?? []) {
    const floor = panel.floor ?? panel.levelIndex ?? 0;
    for (const anchor of panel.sourceAnchors ?? []) {
      if (/dimension|legend|label/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`)) continue;
      addExplicitSpan(floor, sourceFrameSpanFromAnchor(anchor));
    }
  }
  for (const item of artifact.exteriorWalls ?? []) {
    const floor = item.floor ?? item.levelIndex ?? 0;
    const span = sourceAnchorSpan(item, artifact);
    addSpan(floor, span);
    if (!/deck-edge|deck-rail|porch-edge|patio-edge|stoop-edge/i.test(`${item.kind ?? ''} ${item.type ?? ''} ${item.symbolVariant ?? ''}`)) {
      addBuildingSpan(floor, span);
    }
  }
  const primitiveItems = [
    ...(artifact.interiorWalls ?? []),
    ...(artifact.openings ?? []),
    ...(artifact.doors ?? []),
    ...(artifact.windows ?? []),
    ...(artifact.fixtures ?? []),
    ...(artifact.dimensionLines ?? []),
  ];
  for (const item of primitiveItems) addFallbackSpan(item.floor ?? item.levelIndex ?? 0, sourceAnchorSpan(item, artifact));
  for (const panel of artifact.floorPanels ?? []) {
    for (const anchor of panel.sourceAnchors ?? []) {
      if (/dimension/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`)) addFallbackSpan(panel.floor ?? panel.levelIndex ?? 0, anchor.span);
    }
  }
  for (const [floor, frame] of buildingByFloor) {
    byFloor.set(floor, frame);
  }
  if (artifact.renderHints?.preferExplicitLevelFrames === true) {
    for (const [floor, frame] of explicitByFloor) {
      byFloor.set(floor, frame);
    }
  }
  for (const [floor, frame] of fallbackByFloor) {
    if (!byFloor.has(floor)) byFloor.set(floor, frame);
  }
  return [...byFloor.values()].map((frame) => ({
    floor: String(frame.floor),
    x: frame.x,
    y: frame.y,
    width: frame.x2 - frame.x,
    height: frame.y2 - frame.y,
  }));
}

function sourceLegendAnchorsForArtifact(artifact) {
  const anchors = [
    ...(artifact.sourceAnchors ?? []),
    ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
  ];
  return anchors
    .filter((anchor) => /legend/i.test(`${anchor.targetKind ?? ''} ${anchor.elementType ?? ''} ${anchor.id ?? ''}`))
    .map((anchor) => {
      const span = spanFromBoundsLike(anchor.span)
        ?? spanFromBoundsLike(anchor.pixelBounds)
        ?? spanFromBoundsLike(anchor.planBounds)
        ?? spanFromBoundsLike(anchor.bounds);
      const box = sourceBoxForSpan(span);
      const label = String(anchor.label ?? anchor.text ?? '').trim();
      const match = label.match(/^(\d+)\s+(.+)$/);
      if (!box || box.width <= 0 || box.height <= 0 || !match) return null;
      return {
        id: anchor.id ?? anchor.targetId ?? `legend-${match[1]}`,
        number: match[1],
        label: match[2],
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    })
    .filter(Boolean);
}

function legendNumberForRoom(room) {
  for (const key of ['proposalNumber', 'calloutNumber', 'legendNumber', 'number', 'callout']) {
    const value = room?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function sourceLegendEntriesForArtifact(artifact) {
  if (artifact?.renderHints?.syntheticSourceLegend !== true) return [];
  const entries = new Map();
  for (const room of artifact.rooms ?? []) {
    const number = legendNumberForRoom(room);
    if (!Number.isFinite(number)) continue;
    const label = String(room?.label ?? room?.type ?? '').trim();
    if (!label || /exterior|eave|glazed side/i.test(label)) continue;
    if (!entries.has(number)) entries.set(number, label);
  }
  return [...entries.entries()]
    .sort(([a], [b]) => a - b)
    .map(([number, label]) => ({
      id: `synthetic-source-legend-${number}-${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      number: String(number),
      label,
    }));
}

function sourceLevelLabelAnchorsForArtifact(artifact) {
  const anchors = [
    ...(artifact.sourceAnchors ?? []),
    ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
  ];
  return anchors
    .filter((anchor) => /levelLabel/i.test(`${anchor.kind ?? ''} ${anchor.targetKind ?? ''} ${anchor.id ?? ''}`))
    .map((anchor) => {
      const span = spanFromBoundsLike(anchor.span)
        ?? spanFromBoundsLike(anchor.pixelBounds)
        ?? spanFromBoundsLike(anchor.planBounds)
        ?? spanFromBoundsLike(anchor.bounds);
      const box = sourceBoxForSpan(span);
      if (!box || box.width <= 0 || box.height <= 0) return null;
      const id = String(anchor.id ?? '');
      const label = anchor.label
        ?? (id.includes('loft') ? 'LOFT LEVEL' : id.includes('main') ? 'MAIN LEVEL' : id.includes('ground') ? 'GROUND FLOOR' : '');
      if (!label) return null;
      return {
        id: anchor.id ?? `level-label-${label.toLowerCase().replace(/\W+/g, '-')}`,
        label,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    })
    .filter(Boolean);
}

function sourceDimensionLinesForArtifact(artifact) {
  const anchors = [
    ...(artifact.sourceAnchors ?? []),
    ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
  ];
  const anchorById = new Map();
  for (const anchor of anchors) {
    for (const id of [anchor?.id, anchor?.sourceAnchorId, anchor?.elementId, anchor?.targetId]) {
      if (id) anchorById.set(String(id), anchor);
    }
  }
  const looksLikePixelSpan = (span) => {
    if (!span) return false;
    return [span.x1, span.z1, span.x2, span.z2].some((value) => Math.abs(Number(value)) > 80);
  };
  const firstPixelSpan = (...values) => {
    for (const value of values) {
      const span = spanFromBoundsLike(value);
      if (looksLikePixelSpan(span)) return span;
    }
    return null;
  };
  return (artifact.dimensionLines ?? [])
    .map((line) => {
      const anchor = anchorById.get(String(line?.sourceAnchorId ?? '')) ?? anchorById.get(String(line?.id ?? ''));
      const sourceBoxSpan = firstPixelSpan(
        anchor?.pixelBounds,
        anchor?.planBounds,
        anchor?.bounds,
        anchor?.span,
        line?.sourceAnchor?.pixelBounds,
        line?.sourceAnchor?.planBounds,
        line?.sourceAnchor?.bounds,
        line?.sourceAnchor?.span,
        line?.bounds,
        line?.span,
      );
      const semanticSpan = spanFromBoundsLike(line?.span);
      const boxSpan = firstPixelSpan(line?.bounds, sourceBoxSpan);
      const box = sourcePrimitiveBoxForSpan(boxSpan);
      if (!sourceBoxSpan || !looksLikePixelSpan(sourceBoxSpan) || !box || box.width <= 0 || box.height <= 0) return null;
      const horizontal = box.width >= box.height;
      const span = semanticSpan && looksLikePixelSpan(semanticSpan)
        ? semanticSpan
        : horizontal
          ? { x1: box.x, z1: box.y + box.height / 2, x2: box.x + box.width, z2: box.y + box.height / 2 }
          : { x1: box.x + box.width / 2, z1: box.y, x2: box.x + box.width / 2, z2: box.y + box.height };
      const labelBox = sourceBoxForSpan(firstPixelSpan(line?.labelBounds, anchor?.labelBounds, line?.sourceAnchor?.labelBounds));
      const witnessLines = (line?.witnessLines ?? [])
        .map((witness) => spanFromBoundsLike(witness?.span ?? witness))
        .filter(looksLikePixelSpan)
        .filter(Boolean);
      const tickLines = (line?.tickLines ?? anchor?.tickLines ?? line?.sourceAnchor?.tickLines ?? [])
        .map((tick) => spanFromBoundsLike(tick?.span ?? tick))
        .filter(looksLikePixelSpan)
        .filter(Boolean);
      return {
        id: String(line?.sourceAnchorId ?? line?.id ?? `dimension-${artifact.dimensionLines.indexOf(line)}`),
        floor: String(line?.floor ?? line?.levelIndex ?? anchor?.floor ?? anchor?.levelIndex ?? 0),
        label: String(line?.label ?? ''),
        facing: String(line?.facing ?? anchor?.facing ?? ''),
        span,
        box,
        labelBox,
        witnessLines,
        tickLines,
      };
    })
    .filter(Boolean);
}

function sourcePrimitiveBoxesForArtifact(artifact) {
  const boxes = new Map();
  const anchors = [
    ...(artifact.sourceAnchors ?? []),
    ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
  ];
  const add = (id, span, floor) => {
    if (!id) return;
    const box = sourcePrimitiveBoxForSpan(span);
    if (!box || box.width <= 0 || box.height <= 0) return;
    boxes.set(String(id), {
      ...box,
      floor: floor == null ? null : String(floor),
    });
  };
  for (const anchor of anchors) {
    const span = spanFromBoundsLike(anchor?.span)
      ?? spanFromBoundsLike(anchor?.pixelBounds)
      ?? spanFromBoundsLike(anchor?.planBounds)
      ?? spanFromBoundsLike(anchor?.bounds);
    const floor = anchor?.floor ?? anchor?.levelIndex ?? anchor?.floorIndex ?? null;
    add(anchor?.id, span, floor);
    add(anchor?.sourceAnchorId, span, floor);
    add(anchor?.elementId, span, floor);
    add(anchor?.targetId, span, floor);
  }
  const semanticCollections = [
    ...(artifact.exteriorWalls ?? []),
    ...(artifact.interiorWalls ?? []),
    ...(artifact.openings ?? []),
    ...(artifact.doors ?? []),
    ...(artifact.windows ?? []),
    ...(artifact.fixtures ?? []),
    ...(artifact.furniture ?? []),
    ...(artifact.stairs ?? []),
    ...(artifact.dimensionLines ?? []),
    ...(artifact.sourceWalls ?? []),
    ...(artifact.sourceOpenings ?? []),
  ];
  for (const item of semanticCollections) {
    const floor = item?.floor ?? item?.levelIndex ?? item?.floorIndex ?? null;
    const span = sourceAnchorSpan(item, artifact);
    add(item?.sourceAnchorId, span, floor);
    add(item?.sourceAnchor?.id, span, floor);
    add(item?.id, span, floor);
  }
  return Object.fromEntries(boxes);
}

function promotedOption(manifest, planId) {
  const options = manifest.plans?.[planId] ?? [];
  return options.find((option) => option.promotionEligible === true)
    ?? options.find((option) => option.latestPairedArtifact === true && option.pairedArtifact === true)
    ?? options.find((option) => option.latestGptPairedArtifact === true && option.pairedArtifact === true)
    ?? options.find((option) => option.pairedArtifact === true)
    ?? null;
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

function normalizeSvg(svg, planId, proposalId) {
  const cleaned = svg
    .replace(/\sdata-reactroot="[^"]*"/g, '')
    .replace(/>\s+</g, '><')
    .trim();
  const withArtifactData = cleaned.replace(
    /^<svg\b/,
    `<svg data-artifact-version="paired_gpt_floorplan_v1" data-plan-id="${planId}" data-proposal-id="${proposalId}" xmlns:xlink="http://www.w3.org/1999/xlink"`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${withArtifactData}\n`;
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = args.url ?? BASE_URL;
  const manifest = await readJson(MANIFEST_PATH);
  const browser = await launchBrowser();
  const results = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    for (const planId of args.plans) {
      const option = promotedOption(manifest, planId);
      if (!option?.deterministicRenderUrl) {
        results.push({ planId, status: 'skipped', reason: 'missing deterministicRenderUrl' });
        continue;
      }
      const url = `${baseUrl}/?home=${encodeURIComponent(planId)}`;
      const pairedJsonPath = option.pairedJsonUrl ? resolve(LOOP_ROOT, planId, option.pairedJsonUrl) : null;
      const pairedArtifact = pairedJsonPath ? await readJson(pairedJsonPath) : null;
      const drawingStylePath = option.pairedDrawingStyleProfileUrl
        ? resolve(LOOP_ROOT, planId, option.pairedDrawingStyleProfileUrl)
        : option.pairedJsonUrl
          ? resolve(LOOP_ROOT, planId, option.pairedJsonUrl.replace(/\.paired\.json$/i, '.drawing-style.json'))
          : null;
      const drawingStyleProfile = await readOptionalJson(drawingStylePath);
      const enableSourcePrimitiveAlignment = pairedArtifact?.renderHints?.sourcePrimitiveAlignment !== false;
      const sourceAlignment = {
        floorFrames: pairedArtifact ? floorPrimitiveTargetFrames(pairedArtifact) : [],
        primitiveBoxes: pairedArtifact && enableSourcePrimitiveAlignment ? sourcePrimitiveBoxesForArtifact(pairedArtifact) : {},
        legendAnchors: pairedArtifact ? sourceLegendAnchorsForArtifact(pairedArtifact) : [],
        legendEntries: pairedArtifact ? sourceLegendEntriesForArtifact(pairedArtifact) : [],
        levelLabels: pairedArtifact ? sourceLevelLabelAnchorsForArtifact(pairedArtifact) : [],
        dimensionLines: pairedArtifact ? sourceDimensionLinesForArtifact(pairedArtifact) : [],
        preserveSourceExactPrimitiveOverlays: pairedArtifact?.renderHints?.preserveSourceExactPrimitiveOverlays === true,
        preserveSourceExactPrimitiveOverlayLayers: Array.isArray(pairedArtifact?.renderHints?.preserveSourceExactPrimitiveOverlayLayers)
          ? pairedArtifact.renderHints.preserveSourceExactPrimitiveOverlayLayers
          : ['fixture', 'ladder', 'stair'],
        replaceSourceExactPrimitiveOverlayLayers: Array.isArray(pairedArtifact?.renderHints?.replaceSourceExactPrimitiveOverlayLayers)
          ? pairedArtifact.renderHints.replaceSourceExactPrimitiveOverlayLayers
          : [],
        drawingStyle: drawingStyleProfile?.rules ?? null,
      };
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('svg[data-drawing-style-schema]'), undefined, { timeout: 15_000 });
      const svg = await page.evaluate(async (sourceAlignment) => {
        const sourceFloorFrames = sourceAlignment?.floorFrames ?? [];
        const sourcePrimitiveBoxes = sourceAlignment?.primitiveBoxes ?? {};
        const sourceLegendAnchors = sourceAlignment?.legendAnchors ?? [];
        const sourceLegendEntries = sourceAlignment?.legendEntries ?? [];
        const sourceLevelLabels = sourceAlignment?.levelLabels ?? [];
        const sourceDimensionLines = sourceAlignment?.dimensionLines ?? [];
        const preserveSourceExactPrimitiveOverlays = sourceAlignment?.preserveSourceExactPrimitiveOverlays === true;
        const preserveSourceExactPrimitiveOverlayLayers = new Set((sourceAlignment?.preserveSourceExactPrimitiveOverlayLayers ?? ['fixture', 'ladder', 'stair']).map(String));
        const replaceSourceExactPrimitiveOverlayLayers = new Set((sourceAlignment?.replaceSourceExactPrimitiveOverlayLayers ?? []).map(String));
        const drawingStyle = sourceAlignment?.drawingStyle ?? {};
        const dimensionStyle = drawingStyle.dimensions ?? {};
        const labelStyle = drawingStyle.labels ?? {};
        const calloutStyle = drawingStyle.callouts ?? {};
        const dimStroke = dimensionStyle.stroke ?? '#746d64';
        const dimStrokeWidth = Number.isFinite(Number(dimensionStyle.strokeWidthPx)) ? Number(dimensionStyle.strokeWidthPx) : 0.8;
        const dimOpacity = Number.isFinite(Number(dimensionStyle.opacity)) ? Number(dimensionStyle.opacity) : 0.62;
        const dimFontSize = Number.isFinite(Number(dimensionStyle.fontSizePx)) ? Number(dimensionStyle.fontSizePx) : 10;
        const dimShowTicks = dimensionStyle.showTicks !== false;
        const dimShowLabels = dimensionStyle.showLabels !== false;
        const dimPreserveExactSourceCrop = dimensionStyle.preserveExactSourceCrop === true;
        const labelFill = labelStyle.fill ?? '#3d3934';
        const labelFontFamily = labelStyle.fontFamily ?? 'Arial, Helvetica, sans-serif';
        const floorTitleFontSize = Number.isFinite(Number(labelStyle.floorTitleFontSizePx)) ? Number(labelStyle.floorTitleFontSizePx) : 9;
        const roomFontSize = Number.isFinite(Number(labelStyle.roomFontSizePx)) ? Number(labelStyle.roomFontSizePx) : 10;
        const calloutFill = calloutStyle.fill ?? '#bd766d';
        const calloutRadius = Number.isFinite(Number(calloutStyle.radiusPx)) ? Number(calloutStyle.radiusPx) : 6.4;
        const calloutFontSize = Number.isFinite(Number(calloutStyle.fontSizePx)) ? Number(calloutStyle.fontSizePx) : 6.5;
        const calloutOpacity = Number.isFinite(Number(calloutStyle.opacity)) ? Number(calloutStyle.opacity) : 0.92;
        const drawingBoundsFromImage = async (img) => {
          if (!img) return null;
          if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
            await new Promise((resolve, reject) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', reject, { once: true });
            });
          }
          const width = img.naturalWidth;
          const height = img.naturalHeight;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return null;
          context.drawImage(img, 0, 0, width, height);
          const { data } = context.getImageData(0, 0, width, height);
          let minX = width;
          let minY = height;
          let maxX = 0;
          let maxY = 0;
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const offset = (y * width + x) * 4;
              const alpha = data[offset + 3];
              if (alpha < 12) continue;
              const r = data[offset];
              const g = data[offset + 1];
              const b = data[offset + 2];
              if ((r + g + b) / 3 > 246) continue;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          if (maxX <= minX || maxY <= minY) return null;
          const pad = Math.max(12, Math.round(Math.min(width, height) * 0.012));
          return {
            width,
            height,
            x: Math.max(0, minX - pad),
            y: Math.max(0, minY - pad),
            w: Math.min(width, maxX + pad) - Math.max(0, minX - pad),
            h: Math.min(height, maxY + pad) - Math.max(0, minY - pad),
          };
        };

        const candidates = Array.from(document.querySelectorAll('svg[data-drawing-style-schema]'));
        const best = candidates.find((candidate) => candidate.querySelector('[data-drawing-layer]')) ?? candidates[0];
        if (!best) return '';
        const clone = best.cloneNode(true);
        const sourceImg = Array.from(document.querySelectorAll('img')).find((img) => /GPT proposal/i.test(img.alt ?? '') || /generated/.test(img.currentSrc || img.src));
        const sourceImageHref = sourceImg?.getAttribute('src') || sourceImg?.currentSrc || sourceImg?.src || '';
        const sourceImageDataHref = (() => {
          if (!sourceImg?.naturalWidth || !sourceImg?.naturalHeight) return sourceImageHref;
          try {
            const canvas = document.createElement('canvas');
            canvas.width = sourceImg.naturalWidth;
            canvas.height = sourceImg.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context) return sourceImageHref;
            context.drawImage(sourceImg, 0, 0, canvas.width, canvas.height);
            return canvas.toDataURL('image/png');
          } catch {
            return sourceImageHref;
          }
        })();
        const sourceFrame = await drawingBoundsFromImage(sourceImg);
        const liveBox = best.getBBox();
        const sourceCalloutAnnotations = (() => {
          if (!sourceImg?.naturalWidth || !sourceImg?.naturalHeight || !sourceFloorFrames.length) {
            return { callouts: [], legendCrop: null };
          }
          const width = sourceImg.naturalWidth;
          const height = sourceImg.naturalHeight;
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) return { callouts: [], legendCrop: null };
          context.drawImage(sourceImg, 0, 0, width, height);
          const imageData = context.getImageData(0, 0, width, height);
          const { data } = imageData;
          const visited = new Uint8Array(width * height);
          const isAnnotationPixel = (x, y) => {
            if (x < 0 || y < 0 || x >= width || y >= height) return false;
            const index = (y * width + x) * 4;
            const alpha = data[index + 3];
            if (alpha < 24) return false;
            const r = data[index];
            const g = data[index + 1];
            const b = data[index + 2];
            const avg = (r + g + b) / 3;
            const saturation = Math.max(r, g, b) - Math.min(r, g, b);
            const warmBubble = r > 118 && g > 55 && g < 180 && b > 45 && b < 175 && r > b + 6 && saturation > 18 && avg > 75 && avg < 225;
            const blueBubble = b > 105 && g > 78 && r < 165 && b > r + 10 && g > r + 4 && saturation > 18 && avg > 75 && avg < 230;
            return warmBubble || blueBubble;
          };
          const components = [];
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const start = y * width + x;
              if (visited[start] || !isAnnotationPixel(x, y)) continue;
              let minX = x;
              let minY = y;
              let maxX = x;
              let maxY = y;
              let area = 0;
              const stack = [[x, y]];
              visited[start] = 1;
              while (stack.length) {
                const [cx, cy] = stack.pop();
                area += 1;
                minX = Math.min(minX, cx);
                minY = Math.min(minY, cy);
                maxX = Math.max(maxX, cx);
                maxY = Math.max(maxY, cy);
                const neighbors = [
                  [cx + 1, cy],
                  [cx - 1, cy],
                  [cx, cy + 1],
                  [cx, cy - 1],
                ];
                for (const [nx, ny] of neighbors) {
                  if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                  const offset = ny * width + nx;
                  if (visited[offset] || !isAnnotationPixel(nx, ny)) continue;
                  visited[offset] = 1;
                  stack.push([nx, ny]);
                }
              }
              const boxWidth = maxX - minX + 1;
              const boxHeight = maxY - minY + 1;
              const ratio = boxWidth / Math.max(1, boxHeight);
              const density = area / Math.max(1, boxWidth * boxHeight);
              if (
                area < 35 ||
                area > 1400 ||
                boxWidth < 6 ||
                boxHeight < 6 ||
                boxWidth > 46 ||
                boxHeight > 46 ||
                ratio < 0.45 ||
                ratio > 2.15 ||
                density < 0.22
              ) {
                continue;
              }
              components.push({
                x: minX,
                y: minY,
                width: boxWidth,
                height: boxHeight,
                cx: minX + boxWidth / 2,
                cy: minY + boxHeight / 2,
                area,
              });
            }
          }
          const insideFrame = (component, frame) => (
            component.cx >= frame.x - 12 &&
            component.cx <= frame.x + frame.width + 12 &&
            component.cy >= frame.y - 12 &&
            component.cy <= frame.y + frame.height + 12
          );
          const floorBottom = Math.max(...sourceFloorFrames.map((frame) => frame.y + frame.height));
          const callouts = components
            .filter((component) => component.cy <= floorBottom + 10 && sourceFloorFrames.some((frame) => insideFrame(component, frame)))
            .map((component, index) => {
              const pad = 5;
              const x = Math.max(0, component.x - pad);
              const y = Math.max(0, component.y - pad);
              const x2 = Math.min(width, component.x + component.width + pad);
              const y2 = Math.min(height, component.y + component.height + pad);
              return {
                id: `source-callout-${index + 1}`,
                x,
                y,
                width: x2 - x,
                height: y2 - y,
              };
            });
          const legendBubbles = components.filter((component) => component.cy > floorBottom + 10);
          let legendCrop = null;
          if (legendBubbles.length) {
            const x = Math.max(0, Math.min(...legendBubbles.map((component) => component.x)) - 10);
            const y = Math.max(0, Math.min(...legendBubbles.map((component) => component.y)) - 8);
            const x2 = Math.min(width, Math.max(...legendBubbles.map((component) => component.x + component.width)) + 280);
            const y2 = Math.min(height, Math.max(...legendBubbles.map((component) => component.y + component.height)) + 12);
            if (x2 > x && y2 > y) {
              legendCrop = { id: 'source-callout-legend-crop', x, y, width: x2 - x, height: y2 - y };
            }
          }
          return { callouts, legendCrop };
        })();
        const localBBox = (element) => {
          try {
            const box = element.getBBox();
            return { x: box.x, y: box.y, width: box.width, height: box.height };
          } catch {
            return null;
          }
        };
        const rootBBox = (element) => {
          try {
            const box = element.getBBox();
            const matrix = element.getCTM?.();
            if (!matrix) return null;
            const points = [
              new DOMPoint(box.x, box.y).matrixTransform(matrix),
              new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix),
              new DOMPoint(box.x, box.y + box.height).matrixTransform(matrix),
              new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix),
            ];
            const xs = points.map((point) => point.x);
            const ys = points.map((point) => point.y);
            const x = Math.min(...xs);
            const y = Math.min(...ys);
            const x2 = Math.max(...xs);
            const y2 = Math.max(...ys);
            return { x, y, width: x2 - x, height: y2 - y };
          } catch {
            return null;
          }
        };
        const unionBBox = (elements, mapper = rootBBox) => {
          const boxes = elements.map(mapper).filter(Boolean);
          if (!boxes.length) return null;
          const x = Math.min(...boxes.map((box) => box.x));
          const y = Math.min(...boxes.map((box) => box.y));
          const x2 = Math.max(...boxes.map((box) => box.x + box.width));
          const y2 = Math.max(...boxes.map((box) => box.y + box.height));
          return { x, y, width: x2 - x, height: y2 - y };
        };
        if (sourceFrame && sourceFloorFrames.length) {
          const oldChildren = Array.from(clone.childNodes).filter((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return true;
            const tag = node.tagName.toLowerCase();
            return tag !== 'defs' && tag !== 'style';
          });
          for (const node of oldChildren) node.remove();
          const alignedRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          alignedRoot.setAttribute('data-role', 'source-floor-frame-alignment');
          clone.appendChild(alignedRoot);
          const liveFloorGroups = Array.from(best.querySelectorAll('[data-role="floor-level"]'));
          const exactPrimitiveOverlays = new Map();
          for (const liveGroup of liveFloorGroups) {
            const floor = liveGroup.getAttribute('data-source-floor') ?? '';
            const target = sourceFloorFrames.find((frame) => frame.floor === floor);
            const buildingExteriorWalls = Array.from(liveGroup.querySelectorAll('[data-role="exterior-wall"]'))
              .filter((element) => !/deck-edge|deck-rail|porch-edge|patio-edge|stoop-edge/i.test(`${element.getAttribute('data-source-kind') ?? ''}`));
            const sourceBox = unionBBox(buildingExteriorWalls.length ? buildingExteriorWalls : Array.from(liveGroup.querySelectorAll('[data-role="exterior-wall"]')), localBBox)
              ?? localBBox(liveGroup);
            if (!target || !sourceBox || sourceBox.width <= 0 || sourceBox.height <= 0) continue;
            const scaleX = target.width / sourceBox.width;
            const scaleY = target.height / sourceBox.height;
            const tx = target.x - sourceBox.x * scaleX;
            const ty = target.y - sourceBox.y * scaleY;
            const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrapper.setAttribute('data-role', 'source-floor-frame');
            wrapper.setAttribute('data-source-floor', floor);
            wrapper.setAttribute('data-source-frame', JSON.stringify(target));
            wrapper.setAttribute('transform', `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scaleX.toFixed(6)} ${scaleY.toFixed(6)})`);
            const floorClone = liveGroup.cloneNode(true);
            floorClone.removeAttribute('transform');
            floorClone.querySelectorAll('[data-role="floor-title"]').forEach((element) => element.remove());
            floorClone.querySelectorAll('[data-drawing-layer="dimension"]').forEach((element) => element.remove());
            const alignPrimitive = (element, current) => {
              const layer = element.getAttribute('data-drawing-layer') ?? '';
              if (!/^(wall|door|window|opening|fixture|furniture|ladder|stair|dashedVoid|dimension)$/.test(layer)) return;
              const role = element.getAttribute('data-role') ?? '';
              if (/^(floor-level|room-fill|callout|source-callout-legend|source-floor-title)$/.test(role)) return;
              const sourceId = element.getAttribute('data-source-id') ?? '';
              if (!sourceId) return;
              const exactTargetBox = sourcePrimitiveBoxes[sourceId];
              const parentTargetBox = sourcePrimitiveBoxes[sourceId.replace(/:seg-\d+$/, '')];
              const isSplitWallSegment = layer === 'wall' && /:seg-\d+$/.test(sourceId);
              const splitWallParentId = isSplitWallSegment ? sourceId.replace(/:seg-\d+$/, '') : '';
              const splitWallSiblingBox = () => {
                if (!splitWallParentId) return null;
                const siblings = Array.from(liveGroup.querySelectorAll('[data-drawing-layer="wall"][data-source-id]'))
                  .filter((candidate) => (candidate.getAttribute('data-source-id') ?? '').startsWith(`${splitWallParentId}:seg-`));
                return unionBBox(siblings, localBBox);
              };
              const deriveSplitTargetBox = () => {
                if (!isSplitWallSegment || exactTargetBox || !parentTargetBox || !current) return null;
                const parentCurrent = splitWallSiblingBox();
                if (!parentCurrent || parentCurrent.width <= 0 || parentCurrent.height <= 0) return null;
                const horizontal = parentTargetBox.width >= parentTargetBox.height;
                if (horizontal) {
                  const relX = Math.max(0, Math.min(1, (current.x - parentCurrent.x) / parentCurrent.width));
                  const relW = Math.max(0.001, Math.min(1, current.width / parentCurrent.width));
                  return {
                    ...parentTargetBox,
                    x: parentTargetBox.x + parentTargetBox.width * relX,
                    width: parentTargetBox.width * relW,
                  };
                }
                const relY = Math.max(0, Math.min(1, (current.y - parentCurrent.y) / parentCurrent.height));
                const relH = Math.max(0.001, Math.min(1, current.height / parentCurrent.height));
                return {
                  ...parentTargetBox,
                  y: parentTargetBox.y + parentTargetBox.height * relY,
                  height: parentTargetBox.height * relH,
                };
              };
              const derivedSplitTargetBox = deriveSplitTargetBox();
              const crossAxisWallParent = Boolean(isSplitWallSegment && !exactTargetBox && parentTargetBox && !derivedSplitTargetBox);
              const targetBox = exactTargetBox ?? derivedSplitTargetBox ?? parentTargetBox;
              if (!targetBox) return;
              if (targetBox.floor != null && String(targetBox.floor) !== String(floor)) return;
              if (!current || current.width < 0 || current.height < 0) return;
              const effectiveCurrent = {
                ...current,
                // SVG getBBox() reports a zero cross-axis dimension for true
                // line primitives. Windows, guardrails, and source wall traces
                // are still valid source-backed primitives and need to align
                // against their source boxes.
                width: Math.max(current.width, 0.001),
                height: Math.max(current.height, 0.001),
              };
              const preserveSourcePrimitive = preserveSourceExactPrimitiveOverlayLayers.has(layer)
                && preserveSourceExactPrimitiveOverlays
                && sourceImageHref
                && targetBox.width > 3
                && targetBox.height > 3;
              const registerExactSourcePrimitiveOverlay = () => {
                if (!preserveSourcePrimitive) return;
                if (layer !== 'wall' || replaceSourceExactPrimitiveOverlayLayers.has(layer)) {
                  element.setAttribute('display', 'none');
                  element.setAttribute('data-source-exact-overlay-replaced', 'true');
                } else {
                  element.setAttribute('data-source-exact-overlay-backed-by-vector', 'true');
                }
                exactPrimitiveOverlays.set(`${layer}:${sourceId}`, {
                  id: sourceId,
                  layer,
                  kind: element.getAttribute('data-source-kind') ?? '',
                  floor,
                  box: targetBox,
                });
              };
              const localTarget = {
                x: (targetBox.x - tx) / scaleX,
                y: (targetBox.y - ty) / scaleY,
                width: targetBox.width / scaleX,
                height: targetBox.height / scaleY,
              };
              if (localTarget.width <= 0 || localTarget.height <= 0) return;
              const targetCenterX = localTarget.x + localTarget.width / 2;
              const targetCenterY = localTarget.y + localTarget.height / 2;
              const currentCenterX = effectiveCurrent.x + effectiveCurrent.width / 2;
              const currentCenterY = effectiveCurrent.y + effectiveCurrent.height / 2;
              const currentLinePrimitive = current.width <= 0.001 || current.height <= 0.001;
              if (layer === 'wall' && (currentLinePrimitive || targetBox.thinX || targetBox.thinY)) {
                const horizontal = Boolean(targetBox.thinY) || localTarget.width >= localTarget.height;
                const vertical = Boolean(targetBox.thinX) || localTarget.height > localTarget.width;
                const sx = crossAxisWallParent ? 1 : horizontal ? localTarget.width / effectiveCurrent.width : 1;
                const sy = crossAxisWallParent ? 1 : vertical ? localTarget.height / effectiveCurrent.height : 1;
                if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
                if (sx < 0.12 || sx > 8 || sy < 0.12 || sy > 8) return;
                const snappedTargetCenterX = crossAxisWallParent && horizontal ? currentCenterX : targetCenterX;
                const snappedTargetCenterY = crossAxisWallParent && vertical ? currentCenterY : targetCenterY;
                const dx = snappedTargetCenterX - currentCenterX * sx;
                const dy = snappedTargetCenterY - currentCenterY * sy;
                const existing = element.getAttribute('transform') ?? '';
                element.setAttribute('transform', `translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${sx.toFixed(6)} ${sy.toFixed(6)}) ${existing}`.trim());
                element.setAttribute('data-source-primitive-aligned', 'true');
                element.setAttribute('data-source-target-box', JSON.stringify({
                  x: Number(targetBox.x.toFixed?.(3) ?? targetBox.x),
                  y: Number(targetBox.y.toFixed?.(3) ?? targetBox.y),
                  width: Number(targetBox.width.toFixed?.(3) ?? targetBox.width),
                  height: Number(targetBox.height.toFixed?.(3) ?? targetBox.height),
                  derivedFromParent: Boolean(derivedSplitTargetBox),
                }));
                registerExactSourcePrimitiveOverlay();
                return;
              }
              if (/^(window|opening)$/.test(layer) && (currentLinePrimitive || targetBox.thinX || targetBox.thinY)) {
                const horizontal = Boolean(targetBox.thinY) || localTarget.width >= localTarget.height;
                const vertical = Boolean(targetBox.thinX) || localTarget.height > localTarget.width;
                const sx = horizontal ? localTarget.width / effectiveCurrent.width : 1;
                const sy = vertical ? localTarget.height / effectiveCurrent.height : 1;
                if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
                if (sx < 0.12 || sx > 8 || sy < 0.12 || sy > 8) return;
                const snappedTargetCenterX = horizontal ? targetCenterX : targetCenterX;
                const snappedTargetCenterY = vertical ? targetCenterY : targetCenterY;
                const dx = snappedTargetCenterX - currentCenterX * sx;
                const dy = snappedTargetCenterY - currentCenterY * sy;
                const existing = element.getAttribute('transform') ?? '';
                element.setAttribute('transform', `translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${sx.toFixed(6)} ${sy.toFixed(6)}) ${existing}`.trim());
                element.setAttribute('data-source-primitive-aligned', 'true');
                element.setAttribute('data-source-target-box', JSON.stringify({
                  x: Number(targetBox.x.toFixed?.(3) ?? targetBox.x),
                  y: Number(targetBox.y.toFixed?.(3) ?? targetBox.y),
                  width: Number(targetBox.width.toFixed?.(3) ?? targetBox.width),
                  height: Number(targetBox.height.toFixed?.(3) ?? targetBox.height),
                  derivedFromParent: Boolean(derivedSplitTargetBox),
                }));
                registerExactSourcePrimitiveOverlay();
                return;
              }
              const widthRatio = localTarget.width / effectiveCurrent.width;
              const heightRatio = localTarget.height / effectiveCurrent.height;
              if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio)) return;
              if (widthRatio < 0.12 || widthRatio > 8 || heightRatio < 0.12 || heightRatio > 8) return;
              const preserveSymbolAspect = /^(ladder|stair)$/.test(layer);
              let sx = widthRatio;
              let sy = heightRatio;
              if (preserveSymbolAspect) {
                const targetIsVertical = localTarget.height > localTarget.width * 2;
                const targetIsHorizontal = localTarget.width > localTarget.height * 2;
                const scale = targetIsVertical
                  ? heightRatio
                  : targetIsHorizontal
                    ? widthRatio
                    : Math.sqrt(widthRatio * heightRatio);
                sx = Math.max(0.35, Math.min(2.25, scale));
                sy = sx;
              }
              const dx = targetCenterX - currentCenterX * sx;
              const dy = targetCenterY - currentCenterY * sy;
              const existing = element.getAttribute('transform') ?? '';
              element.setAttribute('transform', `translate(${dx.toFixed(3)} ${dy.toFixed(3)}) scale(${sx.toFixed(6)} ${sy.toFixed(6)}) ${existing}`.trim());
              element.setAttribute('data-source-primitive-aligned', 'true');
              element.setAttribute('data-source-target-box', JSON.stringify({
                x: Number(targetBox.x.toFixed?.(3) ?? targetBox.x),
                y: Number(targetBox.y.toFixed?.(3) ?? targetBox.y),
                width: Number(targetBox.width.toFixed?.(3) ?? targetBox.width),
                height: Number(targetBox.height.toFixed?.(3) ?? targetBox.height),
                derivedFromParent: Boolean(derivedSplitTargetBox),
              }));
              if (preserveSymbolAspect) element.setAttribute('data-source-symbol-aspect-preserved', 'true');
              registerExactSourcePrimitiveOverlay();
            };
            const primitiveKey = (element) => [
              element.getAttribute('data-drawing-layer') ?? '',
              element.getAttribute('data-source-id') ?? '',
              element.getAttribute('data-source-kind') ?? '',
            ].join('::');
            const liveByKey = new Map();
            for (const livePrimitive of Array.from(liveGroup.querySelectorAll('[data-drawing-layer][data-source-id]'))) {
              const key = primitiveKey(livePrimitive);
              const list = liveByKey.get(key) ?? [];
              list.push(livePrimitive);
              liveByKey.set(key, list);
            }
            const clonedPrimitives = Array.from(floorClone.querySelectorAll('[data-drawing-layer][data-source-id]'));
            clonedPrimitives.forEach((element) => {
              const liveMatches = liveByKey.get(primitiveKey(element));
              const liveMatch = liveMatches?.shift();
              alignPrimitive(element, localBBox(liveMatch ?? element));
            });
            wrapper.appendChild(floorClone);
            alignedRoot.appendChild(wrapper);
          }
          const cropSourcePrimitiveDataHref = (box, layer) => {
              if (!sourceImg?.naturalWidth || !sourceImg?.naturalHeight) return sourceImageDataHref;
              const sx = Math.max(0, Math.floor(Number(box.x)));
              const sy = Math.max(0, Math.floor(Number(box.y)));
              const sw = Math.max(1, Math.min(sourceImg.naturalWidth - sx, Math.ceil(Number(box.width))));
              const sh = Math.max(1, Math.min(sourceImg.naturalHeight - sy, Math.ceil(Number(box.height))));
              if (sw <= 0 || sh <= 0) return sourceImageDataHref;
              const canvas = document.createElement('canvas');
              canvas.width = sw;
              canvas.height = sh;
              const context = canvas.getContext('2d', { willReadFrequently: true });
              if (!context) return sourceImageDataHref;
              context.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, sw, sh);
              const imageData = context.getImageData(0, 0, sw, sh);
              const { data } = imageData;
              for (let index = 0; index < data.length; index += 4) {
                const alpha = data[index + 3];
                if (alpha < 12) {
                  data[index + 3] = 0;
                  continue;
                }
                const r = data[index];
                const g = data[index + 1];
                const b = data[index + 2];
                const avg = (r + g + b) / 3;
                const saturation = Math.max(r, g, b) - Math.min(r, g, b);
                const nearlyWhite = avg > 244;
                // Exact primitive overlays should carry architectural strokes only.
                // Colored callout bubbles belong to the semantic callout layer, not
                // fixture/window/wall symbol crops.
                const redCallout = r > 110
                  && g < 175
                  && b < 175
                  && r > Math.max(g, b) + 6
                  && avg > 70;
                const warmCalloutFill = r > 120
                  && g > 70
                  && g < 170
                  && b > 55
                  && b < 165
                  && saturation > 10
                  && avg > 85;
                const neutralWallFill = false;
                const coloredAnnotation = (saturation > 24 && avg > 72) || redCallout || warmCalloutFill;
                if (nearlyWhite || coloredAnnotation || neutralWallFill) data[index + 3] = 0;
              }
              context.putImageData(imageData, 0, 0);
              return canvas.toDataURL('image/png');
            };
          const cropSourceExactDataHref = (box) => {
            if (!sourceImg?.naturalWidth || !sourceImg?.naturalHeight) return sourceImageDataHref;
            const sx = Math.max(0, Math.floor(Number(box.x)));
            const sy = Math.max(0, Math.floor(Number(box.y)));
            const sw = Math.max(1, Math.min(sourceImg.naturalWidth - sx, Math.ceil(Number(box.width))));
            const sh = Math.max(1, Math.min(sourceImg.naturalHeight - sy, Math.ceil(Number(box.height))));
            if (sw <= 0 || sh <= 0) return sourceImageDataHref;
            const canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            const context = canvas.getContext('2d');
            if (!context) return sourceImageDataHref;
            context.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, sw, sh);
            return canvas.toDataURL('image/png');
          };
          const cropSourceFloorTextureDataHref = (box) => {
            if (!sourceImg?.naturalWidth || !sourceImg?.naturalHeight) return sourceImageDataHref;
            const sx = Math.max(0, Math.floor(Number(box.x)));
            const sy = Math.max(0, Math.floor(Number(box.y)));
            const sw = Math.max(1, Math.min(sourceImg.naturalWidth - sx, Math.ceil(Number(box.width))));
            const sh = Math.max(1, Math.min(sourceImg.naturalHeight - sy, Math.ceil(Number(box.height))));
            if (sw <= 0 || sh <= 0) return sourceImageDataHref;
            const canvas = document.createElement('canvas');
            canvas.width = sw;
            canvas.height = sh;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            if (!context) return sourceImageDataHref;
            context.drawImage(sourceImg, sx, sy, sw, sh, 0, 0, sw, sh);
            const imageData = context.getImageData(0, 0, sw, sh);
            const { data } = imageData;
            for (let index = 0; index < data.length; index += 4) {
              const alpha = data[index + 3];
              if (alpha < 12) {
                data[index + 3] = 0;
                continue;
              }
              const r = data[index];
              const g = data[index + 1];
              const b = data[index + 2];
              const avg = (r + g + b) / 3;
              const saturation = Math.max(r, g, b) - Math.min(r, g, b);
              const lightNeutralPlanTexture = avg >= 168 && avg <= 244 && saturation <= 16;
              if (!lightNeutralPlanTexture) {
                data[index + 3] = 0;
                continue;
              }
              data[index + 3] = Math.min(alpha, 150);
            }
            context.putImageData(imageData, 0, 0);
            return canvas.toDataURL('image/png');
          };
          const appendSourceCrop = (root, box, attrs = {}) => {
            const crop = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            crop.setAttribute('x', Number(box.x).toFixed(2));
            crop.setAttribute('y', Number(box.y).toFixed(2));
            crop.setAttribute('width', Number(box.width).toFixed(2));
            crop.setAttribute('height', Number(box.height).toFixed(2));
            crop.setAttribute('viewBox', `0 0 ${Number(box.width).toFixed(2)} ${Number(box.height).toFixed(2)}`);
            crop.setAttribute('overflow', 'hidden');
            for (const [key, value] of Object.entries(attrs)) {
              if (value != null) crop.setAttribute(key, String(value));
            }
            const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
            const cropHref = cropSourceExactDataHref(box);
            image.setAttribute('href', cropHref);
            image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', cropHref);
            image.setAttribute('x', '0');
            image.setAttribute('y', '0');
            image.setAttribute('width', Number(box.width).toFixed(2));
            image.setAttribute('height', Number(box.height).toFixed(2));
            image.setAttribute('preserveAspectRatio', 'none');
            crop.appendChild(image);
            root.appendChild(crop);
          };
          if (sourceImageHref && sourceFloorFrames.length) {
            const textureRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            textureRoot.setAttribute('data-role', 'source-floor-texture-overlays');
            textureRoot.setAttribute('data-drawing-layer', 'floorTexture');
            textureRoot.setAttribute('data-source', 'gpt-proposal-light-plan-texture');
            for (const frame of sourceFloorFrames) {
              const crop = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              crop.setAttribute('data-role', 'source-floor-texture');
              crop.setAttribute('data-drawing-layer', 'floorTexture');
              crop.setAttribute('data-source-id', `source-floor-texture-${frame.floor}`);
              crop.setAttribute('data-source-kind', 'floorHatch');
              crop.setAttribute('data-source-floor', String(frame.floor));
              crop.setAttribute('x', Number(frame.x).toFixed(2));
              crop.setAttribute('y', Number(frame.y).toFixed(2));
              crop.setAttribute('width', Number(frame.width).toFixed(2));
              crop.setAttribute('height', Number(frame.height).toFixed(2));
              crop.setAttribute('viewBox', `0 0 ${Number(frame.width).toFixed(2)} ${Number(frame.height).toFixed(2)}`);
              crop.setAttribute('overflow', 'hidden');
              const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
              const cropHref = cropSourceFloorTextureDataHref(frame);
              image.setAttribute('href', cropHref);
              image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', cropHref);
              image.setAttribute('x', '0');
              image.setAttribute('y', '0');
              image.setAttribute('width', Number(frame.width).toFixed(2));
              image.setAttribute('height', Number(frame.height).toFixed(2));
              image.setAttribute('preserveAspectRatio', 'none');
              crop.appendChild(image);
              textureRoot.appendChild(crop);
            }
            alignedRoot.appendChild(textureRoot);
          }
          if (sourceImageHref && exactPrimitiveOverlays.size) {
            const overlayRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            overlayRoot.setAttribute('data-role', 'source-exact-primitive-overlays');
            overlayRoot.setAttribute('data-source', 'gpt-proposal-image-crops');
            const overlayRole = (layer) => {
              if (layer === 'ladder' || layer === 'stair') return 'stair-symbol';
              if (layer === 'door') return 'door';
              if (layer === 'window') return 'window';
              if (layer === 'dashedVoid') return 'interior-wall';
              if (layer === 'dimension') return 'source-dimension';
              if (layer === 'wall') return 'exterior-wall';
              return 'fixture';
            };
            for (const overlay of exactPrimitiveOverlays.values()) {
              const box = overlay.box;
              const crop = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
              crop.setAttribute('data-role', overlayRole(overlay.layer));
              crop.setAttribute('data-drawing-layer', overlay.layer);
              crop.setAttribute('data-source-id', overlay.id);
              crop.setAttribute('data-source-kind', overlay.kind);
              crop.setAttribute('data-source-floor', String(overlay.floor));
              crop.setAttribute('data-source-exact-overlay', 'true');
              crop.setAttribute('data-source-target-box', JSON.stringify({
                x: Number(box.x.toFixed?.(3) ?? box.x),
                y: Number(box.y.toFixed?.(3) ?? box.y),
                width: Number(box.width.toFixed?.(3) ?? box.width),
                height: Number(box.height.toFixed?.(3) ?? box.height),
                exactOverlay: true,
              }));
              crop.setAttribute('x', Number(box.x).toFixed(2));
              crop.setAttribute('y', Number(box.y).toFixed(2));
              crop.setAttribute('width', Number(box.width).toFixed(2));
              crop.setAttribute('height', Number(box.height).toFixed(2));
              crop.setAttribute('viewBox', `0 0 ${Number(box.width).toFixed(2)} ${Number(box.height).toFixed(2)}`);
              crop.setAttribute('overflow', 'hidden');
              const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
              const cropHref = cropSourcePrimitiveDataHref(box, overlay.layer);
              image.setAttribute('href', cropHref);
              image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', cropHref);
              image.setAttribute('x', '0');
              image.setAttribute('y', '0');
              image.setAttribute('width', Number(box.width).toFixed(2));
              image.setAttribute('height', Number(box.height).toFixed(2));
              image.setAttribute('preserveAspectRatio', 'none');
              crop.appendChild(image);
              overlayRoot.appendChild(crop);
            }
            alignedRoot.appendChild(overlayRoot);
          }
          if (sourceImageHref && (sourceCalloutAnnotations.callouts.length || sourceCalloutAnnotations.legendCrop)) {
            alignedRoot.querySelectorAll('[data-role="callout"], [data-role="callout-legend"], [data-role="source-callout-legend"]').forEach((element) => element.remove());
            const annotationRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            annotationRoot.setAttribute('data-role', 'source-callout-overlays');
            annotationRoot.setAttribute('data-drawing-layer', 'label');
            annotationRoot.setAttribute('data-source', 'gpt-proposal-annotation-crops');
            for (const item of sourceCalloutAnnotations.callouts) {
              appendSourceCrop(annotationRoot, item, {
                'data-role': 'source-callout',
                'data-drawing-layer': 'label',
                'data-source-id': item.id,
                'data-source-kind': 'calloutBubble',
                'data-source-exact-overlay': 'true',
              });
            }
            if (sourceCalloutAnnotations.legendCrop) {
              appendSourceCrop(annotationRoot, sourceCalloutAnnotations.legendCrop, {
                'data-role': 'source-callout-legend',
                'data-drawing-layer': 'label',
                'data-source-id': sourceCalloutAnnotations.legendCrop.id,
                'data-source-kind': 'calloutLegend',
                'data-source-exact-overlay': 'true',
              });
            }
            alignedRoot.appendChild(annotationRoot);
          }
          if (sourceDimensionLines.length) {
            const dimensionRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            dimensionRoot.setAttribute('data-role', 'source-dimensions');
            dimensionRoot.setAttribute('data-source', 'dimension-line-anchors');
            for (const item of sourceDimensionLines) {
              if (exactPrimitiveOverlays.has(`dimension:${item.id}`)) continue;
              if (
                sourceImageHref &&
                sourceImageDataHref &&
                dimPreserveExactSourceCrop &&
                preserveSourceExactPrimitiveOverlayLayers.has('dimension') &&
                item.box &&
                Number(item.box.width) > 3 &&
                Number(item.box.height) > 3
              ) {
                const crop = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                crop.setAttribute('data-role', 'source-dimension');
                crop.setAttribute('data-drawing-layer', 'dimension');
                crop.setAttribute('data-source-id', item.id);
                crop.setAttribute('data-source-kind', 'dimension-line');
                crop.setAttribute('data-source-floor', item.floor);
                crop.setAttribute('data-source-exact-overlay', 'true');
                crop.setAttribute('x', Number(item.box.x).toFixed(2));
                crop.setAttribute('y', Number(item.box.y).toFixed(2));
                crop.setAttribute('width', Number(item.box.width).toFixed(2));
                crop.setAttribute('height', Number(item.box.height).toFixed(2));
                crop.setAttribute('viewBox', `0 0 ${Number(item.box.width).toFixed(2)} ${Number(item.box.height).toFixed(2)}`);
                crop.setAttribute('overflow', 'hidden');
                const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
                const cropHref = cropSourceExactDataHref(item.box);
                image.setAttribute('href', cropHref);
                image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', cropHref);
                image.setAttribute('x', '0');
                image.setAttribute('y', '0');
                image.setAttribute('width', Number(item.box.width).toFixed(2));
                image.setAttribute('height', Number(item.box.height).toFixed(2));
                image.setAttribute('preserveAspectRatio', 'none');
                crop.appendChild(image);
                dimensionRoot.appendChild(crop);
                continue;
              }
              const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              group.setAttribute('data-role', 'source-dimension');
              group.setAttribute('data-drawing-layer', 'dimension');
              group.setAttribute('data-source-id', item.id);
              group.setAttribute('data-source-kind', 'dimension-line');
              group.setAttribute('data-source-floor', item.floor);
              const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
              line.setAttribute('x1', Number(item.span.x1).toFixed(2));
              line.setAttribute('y1', Number(item.span.z1).toFixed(2));
              line.setAttribute('x2', Number(item.span.x2).toFixed(2));
              line.setAttribute('y2', Number(item.span.z2).toFixed(2));
              line.setAttribute('stroke', dimStroke);
              line.setAttribute('stroke-width', String(dimStrokeWidth));
              line.setAttribute('opacity', String(dimOpacity));
              line.setAttribute('stroke-linecap', 'butt');
              group.appendChild(line);
              if (dimShowTicks) {
                for (const tickSpan of item.tickLines ?? []) {
                  const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                  tick.setAttribute('x1', Number(tickSpan.x1).toFixed(2));
                  tick.setAttribute('y1', Number(tickSpan.z1).toFixed(2));
                  tick.setAttribute('x2', Number(tickSpan.x2).toFixed(2));
                  tick.setAttribute('y2', Number(tickSpan.z2).toFixed(2));
                  tick.setAttribute('stroke', dimStroke);
                  tick.setAttribute('stroke-width', String(dimStrokeWidth));
                  tick.setAttribute('opacity', String(dimOpacity));
                  tick.setAttribute('stroke-linecap', 'butt');
                  group.appendChild(tick);
                }
              }
              for (const witness of item.witnessLines ?? []) {
                const witnessLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                witnessLine.setAttribute('x1', Number(witness.x1).toFixed(2));
                witnessLine.setAttribute('y1', Number(witness.z1).toFixed(2));
                witnessLine.setAttribute('x2', Number(witness.x2).toFixed(2));
                witnessLine.setAttribute('y2', Number(witness.z2).toFixed(2));
                witnessLine.setAttribute('stroke', dimStroke);
                witnessLine.setAttribute('stroke-width', String(dimStrokeWidth));
                witnessLine.setAttribute('opacity', String(dimOpacity));
                witnessLine.setAttribute('stroke-linecap', 'butt');
                group.appendChild(witnessLine);
              }
              if (dimShowLabels && item.label && item.labelBox) {
                const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                const vertical = Math.abs(item.span.z2 - item.span.z1) > Math.abs(item.span.x2 - item.span.x1);
                const cx = item.labelBox.x + item.labelBox.width / 2;
                const cy = item.labelBox.y + item.labelBox.height * 0.68;
                label.setAttribute('x', cx.toFixed(2));
                label.setAttribute('y', cy.toFixed(2));
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('font-family', labelFontFamily);
                label.setAttribute('font-size', Math.max(8, Math.min(dimFontSize, item.labelBox.height * 0.75)).toFixed(1));
                label.setAttribute('font-weight', '600');
                label.setAttribute('fill', dimStroke);
                label.setAttribute('opacity', String(dimOpacity));
                if (vertical) label.setAttribute('transform', `rotate(-90 ${cx.toFixed(2)} ${cy.toFixed(2)})`);
                label.textContent = item.label;
                group.appendChild(label);
              }
              dimensionRoot.appendChild(group);
            }
            alignedRoot.appendChild(dimensionRoot);
          }
          if (sourceLevelLabels.length) {
            const labelRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            labelRoot.setAttribute('data-role', 'source-level-labels');
            labelRoot.setAttribute('data-drawing-layer', 'label');
            labelRoot.setAttribute('data-source', 'level-label-anchors');
            for (const item of sourceLevelLabels) {
              const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              label.setAttribute('data-role', 'source-floor-title');
              label.setAttribute('data-source-id', item.id);
              label.setAttribute('data-source-kind', 'levelLabel');
              label.setAttribute('data-drawing-layer', 'label');
              label.setAttribute('x', (item.x + item.width / 2).toFixed(2));
              label.setAttribute('y', (item.y + item.height * 0.72).toFixed(2));
              label.setAttribute('text-anchor', 'middle');
              label.setAttribute('font-family', labelFontFamily);
              label.setAttribute('font-size', Math.max(floorTitleFontSize, Math.min(16, item.height * 0.85)).toFixed(1));
              label.setAttribute('font-weight', '700');
              label.setAttribute('fill', labelFill);
              label.textContent = String(item.label).toUpperCase();
              labelRoot.appendChild(label);
            }
            alignedRoot.appendChild(labelRoot);
          }
          if (sourceLegendAnchors.length && !sourceCalloutAnnotations.legendCrop) {
            const legendRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            legendRoot.setAttribute('data-role', 'source-legend');
            legendRoot.setAttribute('data-drawing-layer', 'label');
            legendRoot.setAttribute('data-source', 'legend-anchors');
            for (const item of sourceLegendAnchors) {
              const row = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              row.setAttribute('data-role', 'source-callout-legend');
              row.setAttribute('data-source-id', item.id);
              row.setAttribute('data-source-kind', 'legendLabel');
              row.setAttribute('data-drawing-layer', 'label');
              const cy = item.y + item.height / 2;
              const radius = Math.max(calloutRadius, Math.min(12, item.height * 0.43));
              const cx = item.x + radius;
              const bubble = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
              bubble.setAttribute('cx', cx.toFixed(2));
              bubble.setAttribute('cy', cy.toFixed(2));
              bubble.setAttribute('r', radius.toFixed(2));
              bubble.setAttribute('fill', calloutFill);
              bubble.setAttribute('opacity', String(calloutOpacity));
              row.appendChild(bubble);
              const number = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              number.setAttribute('x', cx.toFixed(2));
              number.setAttribute('y', (cy + 0.5).toFixed(2));
              number.setAttribute('text-anchor', 'middle');
              number.setAttribute('dominant-baseline', 'middle');
              number.setAttribute('font-family', labelFontFamily);
              number.setAttribute('font-size', Math.max(calloutFontSize, radius * 0.84).toFixed(1));
              number.setAttribute('font-weight', '700');
              number.setAttribute('fill', '#fff');
              number.textContent = item.number;
              row.appendChild(number);
              const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              label.setAttribute('x', (item.x + radius * 2 + 12).toFixed(2));
              label.setAttribute('y', (cy + 0.5).toFixed(2));
              label.setAttribute('dominant-baseline', 'middle');
              label.setAttribute('font-family', labelFontFamily);
              label.setAttribute('font-size', Math.max(roomFontSize, Math.min(13, item.height * 0.5)).toFixed(1));
              label.setAttribute('font-weight', '600');
              label.setAttribute('fill', labelFill);
              label.textContent = item.label;
              row.appendChild(label);
              legendRoot.appendChild(row);
            }
            alignedRoot.appendChild(legendRoot);
          } else if (sourceLegendEntries.length && !sourceCalloutAnnotations.legendCrop) {
            const legendRoot = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            legendRoot.setAttribute('data-role', 'source-legend');
            legendRoot.setAttribute('data-drawing-layer', 'label');
            legendRoot.setAttribute('data-source', 'synthetic-room-callout-list');
            const floorBottom = Math.max(...sourceFloorFrames.map((frame) => frame.y + frame.height));
            const pageWidth = Number(sourceFrame.width);
            const pageHeight = Number(sourceFrame.height);
            const columnCount = sourceLegendEntries.length > 8 ? 3 : sourceLegendEntries.length > 4 ? 2 : 1;
            const rowHeight = Math.max(25, calloutRadius * 2.95);
            const rowsPerColumn = Math.ceil(sourceLegendEntries.length / columnCount);
            const columnWidth = Math.min(270, Math.max(175, pageWidth * 0.18));
            const totalWidth = columnWidth * columnCount;
            const startX = Math.max(36, (pageWidth - totalWidth) / 2);
            const availableY = pageHeight - 34 - rowsPerColumn * rowHeight;
            const startY = Math.max(floorBottom + 28, Math.min(floorBottom + 82, availableY));
            for (const [index, item] of sourceLegendEntries.entries()) {
              const column = Math.floor(index / rowsPerColumn);
              const rowIndex = index % rowsPerColumn;
              const x = startX + column * columnWidth;
              const cy = startY + rowIndex * rowHeight + rowHeight * 0.48;
              const row = document.createElementNS('http://www.w3.org/2000/svg', 'g');
              row.setAttribute('data-role', 'source-callout-legend');
              row.setAttribute('data-source-id', item.id);
              row.setAttribute('data-source-kind', 'syntheticLegendLabel');
              row.setAttribute('data-drawing-layer', 'label');
              const bubble = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
              bubble.setAttribute('cx', x.toFixed(2));
              bubble.setAttribute('cy', cy.toFixed(2));
              bubble.setAttribute('r', calloutRadius.toFixed(2));
              bubble.setAttribute('fill', calloutFill);
              bubble.setAttribute('opacity', String(calloutOpacity));
              row.appendChild(bubble);
              const number = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              number.setAttribute('x', x.toFixed(2));
              number.setAttribute('y', (cy + 0.5).toFixed(2));
              number.setAttribute('text-anchor', 'middle');
              number.setAttribute('dominant-baseline', 'middle');
              number.setAttribute('font-family', labelFontFamily);
              number.setAttribute('font-size', Math.max(calloutFontSize, calloutRadius * 0.84).toFixed(1));
              number.setAttribute('font-weight', '700');
              number.setAttribute('fill', '#fff');
              number.textContent = item.number;
              row.appendChild(number);
              const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              label.setAttribute('x', (x + calloutRadius + 12).toFixed(2));
              label.setAttribute('y', (cy + 0.5).toFixed(2));
              label.setAttribute('dominant-baseline', 'middle');
              label.setAttribute('font-family', labelFontFamily);
              label.setAttribute('font-size', Math.max(roomFontSize, 12).toFixed(1));
              label.setAttribute('font-weight', '600');
              label.setAttribute('fill', labelFill);
              label.textContent = item.label;
              row.appendChild(label);
              legendRoot.appendChild(row);
            }
            alignedRoot.appendChild(legendRoot);
          }
          clone.setAttribute('width', String(sourceFrame.width));
          clone.setAttribute('height', String(sourceFrame.height));
          clone.setAttribute('viewBox', `0 0 ${sourceFrame.width} ${sourceFrame.height}`);
          clone.setAttribute('data-source-page-frame', JSON.stringify(sourceFrame));
          clone.setAttribute('data-source-floor-frames', JSON.stringify(sourceFloorFrames));
          clone.setAttribute('data-source-primitive-box-count', String(Object.keys(sourcePrimitiveBoxes).length));
          clone.setAttribute('data-source-legend-anchors', JSON.stringify(sourceLegendAnchors));
        } else if (sourceFrame && liveBox.width > 0 && liveBox.height > 0) {
          const scale = Math.min(sourceFrame.w / liveBox.width, sourceFrame.h / liveBox.height);
          const tx = sourceFrame.x + (sourceFrame.w - liveBox.width * scale) / 2 - liveBox.x * scale;
          const ty = sourceFrame.y + (sourceFrame.h - liveBox.height * scale) / 2 - liveBox.y * scale;
          const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          wrapper.setAttribute('data-role', 'source-page-frame-alignment');
          wrapper.setAttribute('transform', `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(6)})`);
          const movable = Array.from(clone.childNodes).filter((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return true;
            const tag = node.tagName.toLowerCase();
            return tag !== 'defs' && tag !== 'style';
          });
          for (const node of movable) wrapper.appendChild(node);
          clone.insertBefore(wrapper, clone.firstChild);
          clone.setAttribute('width', String(sourceFrame.width));
          clone.setAttribute('height', String(sourceFrame.height));
          clone.setAttribute('viewBox', `0 0 ${sourceFrame.width} ${sourceFrame.height}`);
          clone.setAttribute('data-source-page-frame', JSON.stringify(sourceFrame));
          clone.setAttribute('data-render-source-bbox', JSON.stringify({
            x: liveBox.x,
            y: liveBox.y,
            w: liveBox.width,
            h: liveBox.height,
          }));
        }
        clone.setAttribute('data-cropped-to-primitives', 'false');
        clone.setAttribute('data-preserves-brochure-page-frame', 'true');
        return clone.outerHTML;
      }, sourceAlignment);
      if (!svg.includes('data-drawing-style-schema="drawing_style_profile_v1"')) {
        throw new Error(`${planId}: live deterministic SVG is missing drawing_style_profile_v1`);
      }
      if (!svg.includes('data-drawing-layer="wall"')) {
        throw new Error(`${planId}: live deterministic SVG has no wall primitives`);
      }
      const outPath = resolve(LOOP_ROOT, planId, option.deterministicRenderUrl);
      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, normalizeSvg(svg, planId, option.id));
      if (pairedJsonPath && pairedArtifact?.patchState?.requiresRenderRegeneration) {
        pairedArtifact.patchState = {
          ...pairedArtifact.patchState,
          requiresRenderRegeneration: false,
          renderRegeneratedAt: new Date().toISOString(),
        };
        await writeJson(pairedJsonPath, pairedArtifact);
      }
      results.push({ planId, proposalId: option.id, status: 'written', path: outPath });
    }
  } finally {
    await browser.close();
  }

  for (const result of results) {
    if (result.status === 'written') console.log(`render regenerated: ${result.planId}/${result.proposalId} -> ${result.path}`);
    else console.log(`render skipped: ${result.planId} (${result.reason})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
