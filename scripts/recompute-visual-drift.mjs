#!/usr/bin/env node
/**
 * Recompute source-vs-deterministic visual drift for paired artifacts.
 *
 * This intentionally uses a browser canvas instead of local raster libraries so
 * PNG, WEBP, JPG, and SVG all follow the same rendering path as the app.
 */

import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOOP_ROOT = resolve(ROOT, 'public/data/den-image-loop');
const MANIFEST_PATH = resolve(LOOP_ROOT, 'proposal-manifest.json');
const BASE_URL = process.env.BROCHURE_QA_URL ?? process.env.APP_URL ?? 'http://127.0.0.1:3000';

function parseArgs(argv) {
  const args = {
    plans: (process.env.BROCHURE_QA_PLANS ?? 'a-frame-bunk,a-frame-22,outpost-medium')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    canvasSize: 1254,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plans') args.plans = argv[++index].split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg === '--url') args.url = argv[++index];
    else if (arg === '--canvas-size') args.canvasSize = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function promotedOption(manifest, planId) {
  const options = manifest.plans?.[planId] ?? [];
  return options.find((option) => option.promotionEligible === true && option.latestPairedArtifact === true)
    ?? options.find((option) => option.promotionEligible === true)
    ?? options.find((option) => option.latestPairedArtifact === true && option.pairedArtifact === true)
    ?? options.find((option) => option.latestGptPairedArtifact === true && option.pairedArtifact === true)
    ?? options.find((option) => option.pairedArtifact === true)
    ?? null;
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

function unionBoxes(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  const xs = valid.flatMap((box) => [box.x, box.x + box.width]);
  const ys = valid.flatMap((box) => [box.y, box.y + box.height]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
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
  const floorPanels = (artifact.floorPanels ?? []).filter((item) => String(item?.floor ?? item?.levelIndex ?? 0) === String(floor));
  const panel = floorPanels.find((item) => (item?.sourceAnchors ?? []).some((anchor) => sourceFrameSpanFromAnchor(anchor)))
    ?? floorPanels[0];
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

function sourceFtFrame(artifact, floor) {
  const fallbackFootprint = artifact.footprint ?? {};
  const floorPanels = (artifact.floorPanels ?? []).filter((item) => String(item?.floor ?? item?.levelIndex ?? 0) === String(floor));
  const panel = floorPanels.find((item) => (item?.sourceAnchors ?? []).some((anchor) => sourceFrameSpanFromAnchor(anchor)))
    ?? floorPanels[0];
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
  return { sourceFrame, xFt, zFt, widthFt, depthFt };
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

function mapFtPointToSource(point, frame) {
  const widthPx = frame.sourceFrame.x2 - frame.sourceFrame.x1;
  const depthPx = frame.sourceFrame.z2 - frame.sourceFrame.z1;
  if (Math.abs(widthPx) < 0.001 || Math.abs(depthPx) < 0.001 || frame.widthFt <= 0 || frame.depthFt <= 0) return null;
  return {
    x: frame.sourceFrame.x1 + ((point.x - frame.xFt) / frame.widthFt) * widthPx,
    z: frame.sourceFrame.z1 + ((point.z - frame.zFt) / frame.depthFt) * depthPx,
  };
}

function mapFtSpanToSource(span, frame) {
  if (!span || !frame) return null;
  const a = mapFtPointToSource({ x: span.x1, z: span.z1 }, frame);
  const b = mapFtPointToSource({ x: span.x2, z: span.z2 }, frame);
  if (!a || !b) return null;
  return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
}

function spanLooksLikeSourcePixels(span) {
  if (!span) return false;
  const values = [span.x1, span.z1, span.x2, span.z2].map(Number);
  if (!values.every(Number.isFinite)) return false;
  return Math.max(...values.map(Math.abs)) > 80;
}

function sourceBoxForSemanticSpan(item, layer, artifact) {
  if (item?.source === 'source-image-primitive-override') return null;
  if (layer === 'dimension') return null;
  const floor = item?.floor ?? item?.levelIndex ?? item?.floorIndex ?? 0;
  const frame = sourceFtFrame(artifact, floor);
  const rawSpan = layer === 'fixture' || layer === 'ladder'
    ? spanFromBoundsLike(item?.bounds) ?? (spanLooksLikeSourcePixels(spanFromBoundsLike(item?.span)) ? null : spanFromBoundsLike(item?.span))
    : spanFromBoundsLike(item?.span) ?? spanFromBoundsLike(item?.bounds);
  if (!rawSpan) return null;
  const sourceSpan = spanLooksLikeSourcePixels(rawSpan)
    ? rawSpan
    : mapFtSpanToSource(rawSpan, frame);
  return sourceBoxForSpan(sourceSpan);
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
  const direct = spanFromBoundsLike(item?.sourceAnchor?.span)
    ?? spanFromBoundsLike(item?.sourceAnchor?.pixelBounds)
    ?? spanFromBoundsLike(item?.sourceAnchor?.planBounds)
    ?? spanFromBoundsLike(item?.sourceAnchor?.bounds);
  const itemSourceSpan = spanFromBoundsLike(item?.sourcePixelBounds)
    ?? spanFromBoundsLike(item?.pixelBounds)
    ?? spanFromBoundsLike(item?.bounds)
    ?? spanFromBoundsLike(item?.span);
  const text = `${item?.id ?? ''} ${item?.kind ?? ''} ${item?.dimensionKind ?? ''} ${item?.type ?? ''} ${item?.fixtureKind ?? ''} ${item?.symbolVariant ?? ''}`;
  if (/door|ladder|stair/i.test(text) && direct) return direct;
  const id = item?.sourceAnchorId ?? item?.sourceAnchor?.id ?? item?.id;
  const anchors = [
    ...(artifact.sourceAnchors ?? []),
    ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
  ];
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
  return direct ?? overrideSpan ?? (/dimension/i.test(text) ? itemSourceSpan : null);
}

function sourceDimensionVisibleSpan(item, artifact) {
  const lineSpan = sourceAnchorSpan(item, artifact);
  const lineBox = sourceBoxForSpan(lineSpan);
  if (!lineBox) return null;
  const labelSpan = spanFromBoundsLike(item?.labelBounds)
    ?? spanFromBoundsLike(item?.sourceAnchor?.labelBounds);
  const labelBox = sourceBoxForSpan(labelSpan);
  const witnessSpans = (item?.witnessLines ?? [])
    .map((witness) => spanFromBoundsLike(witness?.span ?? witness))
    .filter(Boolean);
  const tickSpans = (item?.tickLines ?? item?.sourceAnchor?.tickLines ?? [])
    .map((tick) => spanFromBoundsLike(tick?.span ?? tick))
    .filter(Boolean);
  const boxes = [lineBox, labelBox, ...witnessSpans.map(sourceBoxForSpan), ...tickSpans.map(sourceBoxForSpan)].filter(Boolean);
  const xs = boxes.flatMap((box) => [box.x, box.x + box.width]);
  const ys = boxes.flatMap((box) => [box.y, box.y + box.height]);
  return { x1: Math.min(...xs), z1: Math.min(...ys), x2: Math.max(...xs), z2: Math.max(...ys) };
}

function hasSpan(item) {
  return item?.span
    && typeof item.span.x1 === 'number'
    && typeof item.span.z1 === 'number'
    && typeof item.span.x2 === 'number'
    && typeof item.span.z2 === 'number';
}

function breakSpan(item) {
  if (hasSpan(item)) return item.span;
  return spanFromBoundsLike(item);
}

function splitWallByGaps(wall, gaps) {
  if (!wall || !hasSpan({ span: wall })) return [wall];
  const horizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const line = horizontal ? wall.z1 : wall.x1;
  const wallStart = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
  const wallEnd = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
  const intervals = gaps
    .map((gap) => {
      if (!gap) return null;
      const start = horizontal ? Math.min(gap.x1, gap.x2) : Math.min(gap.z1, gap.z2);
      const end = horizontal ? Math.max(gap.x1, gap.x2) : Math.max(gap.z1, gap.z2);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
      return { start: Math.max(wallStart, start), end: Math.min(wallEnd, end) };
    })
    .filter((gap) => gap && gap.end - gap.start > 0.05)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end + 0.05) last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  const segments = [];
  let cursor = wallStart;
  for (const interval of merged) {
    if (interval.start - cursor > 0.05) {
      segments.push(horizontal
        ? { x1: cursor, z1: line, x2: interval.start, z2: line }
        : { x1: line, z1: cursor, x2: line, z2: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (wallEnd - cursor > 0.05) {
    segments.push(horizontal
      ? { x1: cursor, z1: line, x2: wallEnd, z2: line }
      : { x1: line, z1: cursor, x2: line, z2: wallEnd });
  }
  return segments.length ? segments : [wall];
}

function sourceSpanForWallSegment(wall, segment, artifact) {
  const segmentId = segment?.sourceAnchorId ?? segment?.id;
  if (segmentId && wall?.id && segmentId === wall.id) return sourceAnchorSpan(wall, artifact);
  if (segmentId) {
    const anchors = [
      ...(artifact.sourceAnchors ?? []),
      ...(artifact.floorPanels ?? []).flatMap((panel) => panel?.sourceAnchors ?? []),
    ];
    const exactSegmentAnchor = anchors.some((anchor) => {
      const id = anchor?.id ?? anchor?.sourceAnchorId ?? anchor?.elementId;
      return id === segmentId;
    });
    if (exactSegmentAnchor || !/:seg-\d+$/i.test(String(segmentId))) {
      const direct = sourceAnchorSpan({ id: segmentId, sourceAnchorId: segmentId, floor: wall?.floor }, artifact);
      if (direct) return direct;
    }
  }
  const full = sourceAnchorSpan(wall, artifact);
  if (!full || !wall?.span || !segment) return full;
  const horizontal = Math.abs(wall.span.x2 - wall.span.x1) >= Math.abs(wall.span.z2 - wall.span.z1);
  const wallStart = horizontal ? Math.min(wall.span.x1, wall.span.x2) : Math.min(wall.span.z1, wall.span.z2);
  const wallEnd = horizontal ? Math.max(wall.span.x1, wall.span.x2) : Math.max(wall.span.z1, wall.span.z2);
  const segmentStart = horizontal ? Math.min(segment.x1, segment.x2) : Math.min(segment.z1, segment.z2);
  const segmentEnd = horizontal ? Math.max(segment.x1, segment.x2) : Math.max(segment.z1, segment.z2);
  const length = wallEnd - wallStart;
  if (!Number.isFinite(length) || length <= 0.001) return full;
  const t1 = Math.max(0, Math.min(1, (segmentStart - wallStart) / length));
  const t2 = Math.max(0, Math.min(1, (segmentEnd - wallStart) / length));
  if (horizontal) {
    return {
      x1: full.x1 + (full.x2 - full.x1) * t1,
      z1: full.z1,
      x2: full.x1 + (full.x2 - full.x1) * t2,
      z2: full.z2,
    };
  }
  return {
    x1: full.x1,
    z1: full.z1 + (full.z2 - full.z1) * t1,
    x2: full.x2,
    z2: full.z1 + (full.z2 - full.z1) * t2,
  };
}

function primitiveLayerForItem(item) {
  const text = `${item?.id ?? ''} ${item?.wallKind ?? ''} ${item?.openingKind ?? ''} ${item?.fixtureKind ?? ''} ${item?.kind ?? ''} ${item?.type ?? ''} ${item?.category ?? ''} ${item?.symbolVariant ?? ''}`;
  const semanticText = `${item?.wallKind ?? ''} ${item?.kind ?? ''} ${item?.type ?? ''}`;
  if (/guard|rail/i.test(semanticText)) return 'wall';
  if (/partition|interior-wall|exterior-wall|a-frame-wall|entry-low-wall/i.test(semanticText)) return 'wall';
  if (/ladder|stair/i.test(text)) return 'ladder';
  if (/window|glaz|glass/i.test(text)) return 'window';
  if (/door/i.test(text)) return 'door';
  if (/dashed|void|open.to.below|overhead/i.test(text)) return 'dashedVoid';
  return 'fixture';
}

function isDashedVoidItem(item) {
  return /dashed|void|open.to.below|open-to-below|open_to_below|overhead|cross/i.test(
    `${item?.id ?? ''} ${item?.kind ?? ''} ${item?.type ?? ''} ${item?.category ?? ''} ${item?.symbolVariant ?? ''} ${item?.sourceKind ?? ''} ${item?.elementType ?? ''}`,
  );
}

function primitiveLayerThreshold(layer) {
  if (layer === 'wall') {
    return {
      edgeSourceMissRate: 0.08,
      edgeRenderExtraRate: 0.055,
      sourceMissRate: 0.22,
      renderExtraRate: 0.18,
    };
  }
  return {
    edgeSourceMissRate: 0.12,
    edgeRenderExtraRate: 0.08,
    sourceMissRate: 0.36,
    renderExtraRate: 0.36,
  };
}

function primitiveLayerBlocked(layer, value) {
  const threshold = primitiveLayerThreshold(layer);
  const sparseLineLayer = ['dashedVoid', 'dimension', 'door', 'ladder', 'window'].includes(layer);
  const darkMassBlocked =
    (value.sourceMissRate ?? 0) > threshold.sourceMissRate ||
    (value.renderExtraRate ?? 0) > threshold.renderExtraRate;
  if (sparseLineLayer) {
    return (
      (value.edgeSourceMissRate ?? 0) > threshold.edgeSourceMissRate ||
      (value.edgeRenderExtraRate ?? 0) > threshold.edgeRenderExtraRate
    );
  }
  return (
    (value.edgeSourceMissRate ?? 0) > threshold.edgeSourceMissRate ||
    (value.edgeRenderExtraRate ?? 0) > threshold.edgeRenderExtraRate ||
    darkMassBlocked
  );
}

function primitiveLayerSeverity(layer, value) {
  const threshold = primitiveLayerThreshold(layer);
  if (layer === 'dimension') {
    return (value.edgeSourceMissRate ?? 0) > threshold.edgeSourceMissRate
      ? 'semantic'
      : 'presentation';
  }
  return (value.edgeSourceMissRate ?? 0) > threshold.edgeSourceMissRate || (value.edgeRenderExtraRate ?? 0) > threshold.edgeRenderExtraRate
    ? 'semantic'
    : 'presentation';
}

function primitiveSourceRegions(artifact) {
  const hasMaterializedSourceWalls = Array.isArray(artifact.sourceWalls) && artifact.sourceWalls.length > 0;
  const hasMaterializedSourceOpenings = Array.isArray(artifact.sourceOpenings) && artifact.sourceOpenings.length > 0;
  const wallItems = (hasMaterializedSourceWalls ? artifact.sourceWalls : [...(artifact.exteriorWalls ?? []), ...(artifact.interiorWalls ?? [])]).flatMap((wall, wallIndex) => {
    const layer = primitiveLayerForItem(wall) === 'window' ? 'window' : primitiveLayerForItem(wall) === 'dashedVoid' ? 'dashedVoid' : 'wall';
    if (hasMaterializedSourceWalls) return [{ item: wall, layer, sourceSpan: sourceAnchorSpan(wall, artifact), wallIndex }];
    if (layer !== 'wall' || !hasSpan(wall)) return [{ item: wall, layer }];
    const gaps = [
      ...(wall.breaks ?? []).map(breakSpan).filter(Boolean),
      ...(artifact.doors ?? []).filter((opening) => opening.wallId === wall.id && hasSpan(opening)).map((opening) => opening.span),
      ...(artifact.openings ?? []).filter((opening) => opening.wallId === wall.id && hasSpan(opening)).map((opening) => opening.span),
      ...(artifact.windows ?? []).filter((opening) => opening.wallId === wall.id && hasSpan(opening)).map((opening) => opening.span),
    ];
    const segments = splitWallByGaps(wall.span, gaps);
    return segments.map((segment, segmentIndex) => {
      const id = segments.length > 1 ? `${wall.id ?? 'wall'}:seg-${segmentIndex + 1}` : wall.id;
      return {
        item: { ...wall, id, sourceAnchorId: id, span: segment, sourceAnchor: undefined },
        layer,
        sourceSpan: sourceSpanForWallSegment(wall, { ...segment, id, sourceAnchorId: id }, artifact),
        wallIndex,
      };
    });
  });
  const openingItems = hasMaterializedSourceOpenings
    ? (artifact.sourceOpenings ?? []).map((item) => ({ item, layer: item.kind === 'window' ? 'window' : item.kind === 'door' ? 'door' : primitiveLayerForItem(item) }))
    : [
        ...(artifact.openings ?? []).map((item) => ({ item, layer: primitiveLayerForItem(item) })),
        ...(artifact.doors ?? []).map((item) => ({ item, layer: 'door' })),
        ...(artifact.windows ?? []).map((item) => ({ item, layer: 'window' })),
      ];
  const items = [
    ...wallItems,
    ...openingItems,
    ...(artifact.spaceFaces ?? []).filter(isDashedVoidItem).map((item) => ({ item, layer: 'dashedVoid' })),
    ...(artifact.rooms ?? [])
      .filter(isDashedVoidItem)
      .filter((room) => !(artifact.spaceFaces ?? []).some((spaceFace) => String(spaceFace?.roomId ?? '') === String(room?.id ?? '')))
      .map((item) => ({ item, layer: 'dashedVoid' })),
    ...(artifact.fixtures ?? []).filter((item) => !isDashedVoidItem(item)).map((item) => ({ item, layer: primitiveLayerForItem(item) })),
    ...(artifact.dimensionLines ?? []).map((item) => ({ item, layer: 'dimension' })),
  ];
  const regions = [];
  for (const { item, layer, sourceSpan } of items) {
    const sourceBox = sourceBoxForSpan(layer === 'dimension'
      ? sourceDimensionVisibleSpan(item, artifact)
      : sourceSpan ?? sourceAnchorSpan(item, artifact));
    const semanticBox = sourceBoxForSemanticSpan(item, layer, artifact);
    const box = unionBoxes([sourceBox, semanticBox]);
    if (!box || box.width <= 0 || box.height <= 0) continue;
    regions.push({
      ...box,
      layer,
      id: item?.id ?? item?.sourceAnchorId ?? '',
      sourceBox,
      semanticBox,
    });
  }
  return regions;
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = args.url ?? BASE_URL;
  const manifest = await readJson(MANIFEST_PATH);
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  const now = new Date().toISOString();
  const results = [];

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    for (const planId of args.plans) {
      const option = promotedOption(manifest, planId);
      if (!option?.imageUrl || !option?.deterministicRenderUrl || !option?.pairedVisualDriftUrl || !option?.pairedJsonUrl) {
        results.push({ planId, status: 'skipped', reason: 'missing paired image/render/drift/json URL' });
        continue;
      }
      const pairedJsonPath = resolve(LOOP_ROOT, planId, option.pairedJsonUrl);
      const artifact = await readJson(pairedJsonPath);
      const repairHistory = Array.isArray(artifact.repairHistory) ? artifact.repairHistory : [];
      const coveredRepairIds = repairHistory
        .map((item) => item && typeof item === 'object' ? String(item.id ?? '') : '')
        .filter(Boolean);
      const sourceUrl = `${baseUrl}/data/den-image-loop/${planId}/${option.imageUrl}`;
      const renderUrl = `${baseUrl}/data/den-image-loop/${planId}/${option.deterministicRenderUrl}`;
      const primitiveRegions = primitiveSourceRegions(artifact);
      const metrics = await page.evaluate(async ({ sourceUrl, renderUrl, size, primitiveRegions }) => {
        function loadImage(url) {
          return new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(`failed to load ${url}`));
            image.src = url;
          });
        }

        function contentCrop(image) {
          const temp = document.createElement('canvas');
          temp.width = image.naturalWidth;
          temp.height = image.naturalHeight;
          const ctx = temp.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, temp.width, temp.height);
          ctx.drawImage(image, 0, 0);
          const imageData = ctx.getImageData(0, 0, temp.width, temp.height);
          const data = imageData.data;
          let x1 = temp.width;
          let y1 = temp.height;
          let x2 = 0;
          let y2 = 0;
          for (let y = 0; y < temp.height; y += 1) {
            for (let x = 0; x < temp.width; x += 1) {
              const index = (y * temp.width + x) * 4;
              const alpha = data[index + 3] / 255;
              const lum = luminanceAt(data, index);
              if (alpha > 0.05 && lum < 246) {
                x1 = Math.min(x1, x);
                y1 = Math.min(y1, y);
                x2 = Math.max(x2, x);
                y2 = Math.max(y2, y);
              }
            }
          }
          if (x2 <= x1 || y2 <= y1) return { x: 0, y: 0, width: temp.width, height: temp.height };
          const pad = Math.max(12, Math.min(temp.width, temp.height) * 0.025);
          const x = Math.max(0, x1 - pad);
          const y = Math.max(0, y1 - pad);
          const right = Math.min(temp.width, x2 + pad);
          const bottom = Math.min(temp.height, y2 + pad);
          return { x, y, width: right - x, height: bottom - y };
        }

        function drawContained(image, size) {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, size, size);
          const crop = contentCrop(image);
          const scale = Math.min(size / crop.width, size / crop.height) * 0.94;
          const width = crop.width * scale;
          const height = crop.height * scale;
          const x = (size - width) / 2;
          const y = (size - height) / 2;
          ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, x, y, width, height);
          return ctx.getImageData(0, 0, size, size);
        }

        function drawPageAligned(image, size, targetAspect) {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, size, size);
          const sourceAspect = image.naturalWidth / Math.max(1, image.naturalHeight);
          const aspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : sourceAspect;
          let width = size;
          let height = size;
          if (aspect >= 1) height = size / aspect;
          else width = size * aspect;
          const x = (size - width) / 2;
          const y = (size - height) / 2;
          ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight, x, y, width, height);
          return {
            imageData: ctx.getImageData(0, 0, size, size),
            placement: { x, y, width, height, sourceWidth: image.naturalWidth, sourceHeight: image.naturalHeight },
          };
        }

        function luminanceAt(data, index) {
          return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
        }

        function isColoredAnnotationPixel(data, index) {
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];
          const avg = (r + g + b) / 3;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          const redOrBlueCallout = saturation > 24
            && avg > 58
            && avg < 235
            && (r > Math.max(g, b) + 8 || b > Math.max(r, g) + 8);
          const warmCallout = r > 115
            && g > 60
            && g < 180
            && b > 45
            && b < 175
            && saturation > 10
            && avg > 75
            && avg < 225;
          return redOrBlueCallout || warmCallout;
        }

        function darkMask(imageData, threshold) {
          const data = imageData.data;
          const mask = new Uint8Array(imageData.width * imageData.height);
          for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
            mask[pixel] = !isColoredAnnotationPixel(data, index) && luminanceAt(data, index) < threshold ? 1 : 0;
          }
          return mask;
        }

        function edgeMask(imageData, threshold) {
          const width = imageData.width;
          const height = imageData.height;
          const data = imageData.data;
          const luma = new Float32Array(width * height);
          const mask = new Uint8Array(width * height);
          for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
            luma[pixel] = isColoredAnnotationPixel(data, index) ? 255 : luminanceAt(data, index);
          }
          for (let y = 1; y < height - 1; y += 1) {
            for (let x = 1; x < width - 1; x += 1) {
              const i = y * width + x;
              const gx = Math.abs(luma[i - 1] - luma[i + 1]);
              const gy = Math.abs(luma[i - width] - luma[i + width]);
              mask[i] = gx + gy > threshold ? 1 : 0;
            }
          }
          return mask;
        }

        function dilate(mask, width, height, radius) {
          if (radius <= 0) return mask;
          const horizontal = new Uint8Array(mask.length);
          const output = new Uint8Array(mask.length);
          for (let y = 0; y < height; y += 1) {
            let count = 0;
            for (let x = -radius; x < width; x += 1) {
              const add = x + radius;
              if (add >= 0 && add < width) count += mask[y * width + add];
              const remove = x - radius - 1;
              if (remove >= 0 && remove < width) count -= mask[y * width + remove];
              if (x >= 0) horizontal[y * width + x] = count > 0 ? 1 : 0;
            }
          }
          for (let x = 0; x < width; x += 1) {
            let count = 0;
            for (let y = -radius; y < height; y += 1) {
              const add = y + radius;
              if (add >= 0 && add < height) count += horizontal[add * width + x];
              const remove = y - radius - 1;
              if (remove >= 0 && remove < height) count -= horizontal[remove * width + x];
              if (y >= 0) output[y * width + x] = count > 0 ? 1 : 0;
            }
          }
          return output;
        }

        function count(mask) {
          let total = 0;
          for (const value of mask) total += value;
          return total;
        }

        function unmatched(a, bDilated) {
          let total = 0;
          for (let index = 0; index < a.length; index += 1) {
            if (a[index] && !bDilated[index]) total += 1;
          }
          return total;
        }

        function countWithin(mask, include) {
          let total = 0;
          for (let index = 0; index < mask.length; index += 1) {
            if (mask[index] && include[index]) total += 1;
          }
          return total;
        }

        function unmatchedWithin(a, bDilated, include) {
          let total = 0;
          for (let index = 0; index < a.length; index += 1) {
            if (include[index] && a[index] && !bDilated[index]) total += 1;
          }
          return total;
        }

        function primitiveRegionPad(region, width, height) {
          const base = Math.max(10, Math.round(Math.min(width, height) * 0.012));
          if (region?.layer === 'dimension') return 2;
          if (region?.layer === 'window') return 4;
          if (region?.layer === 'dashedVoid' || region?.layer === 'ladder') return Math.max(4, Math.round(base * 0.45));
          if (region?.layer === 'door' || region?.layer === 'fixture') return Math.max(6, Math.round(base * 0.6));
          return base;
        }

        function primitiveRegionMask(width, height, spans, placement) {
          const mask = new Uint8Array(width * height);
          if (!placement || !Array.isArray(spans)) return mask;
          const sx = placement.width / Math.max(1, placement.sourceWidth);
          const sy = placement.height / Math.max(1, placement.sourceHeight);
          for (const span of spans) {
            if (!span || typeof span.x !== 'number' || typeof span.y !== 'number') continue;
            const pad = primitiveRegionPad(span, width, height);
            const x1 = Math.max(0, Math.floor(placement.x + span.x * sx - pad));
            const y1 = Math.max(0, Math.floor(placement.y + span.y * sy - pad));
            const x2 = Math.min(width - 1, Math.ceil(placement.x + (span.x + Math.max(1, span.width)) * sx + pad));
            const y2 = Math.min(height - 1, Math.ceil(placement.y + (span.y + Math.max(1, span.height)) * sy + pad));
            for (let y = y1; y <= y2; y += 1) {
              const row = y * width;
              for (let x = x1; x <= x2; x += 1) mask[row + x] = 1;
            }
          }
          return mask;
        }

        const [sourceImage, renderImage] = await Promise.all([loadImage(sourceUrl), loadImage(renderUrl)]);
        const sourceAspect = sourceImage.naturalWidth / Math.max(1, sourceImage.naturalHeight);
        const renderAspect = renderImage.naturalWidth / Math.max(1, renderImage.naturalHeight);
        const usePageAligned =
          Math.abs(sourceAspect - renderAspect) <= 0.01 &&
          Math.min(sourceImage.naturalWidth, sourceImage.naturalHeight, renderImage.naturalWidth, renderImage.naturalHeight) > 0;
        const sourceFrame = usePageAligned ? drawPageAligned(sourceImage, size, sourceAspect) : { imageData: drawContained(sourceImage, size), placement: null };
        const renderFrame = usePageAligned ? drawPageAligned(renderImage, size, sourceAspect) : { imageData: drawContained(renderImage, size), placement: null };
        const source = sourceFrame.imageData;
        const render = renderFrame.imageData;
        const width = source.width;
        const height = source.height;
        const sourceDark = darkMask(source, 170);
        const renderDark = darkMask(render, 170);
        const sourceEdge = edgeMask(source, 20);
        const renderEdge = edgeMask(render, 20);
        const defaultDarkTolerancePx = 4;
        const wallDarkTolerancePx = 9;
        const renderDarkDilated = dilate(renderDark, width, height, defaultDarkTolerancePx);
        const sourceDarkDilated = dilate(sourceDark, width, height, defaultDarkTolerancePx);
        const renderEdgeDilated = dilate(renderEdge, width, height, 14);
        const sourceEdgeDilated = dilate(sourceEdge, width, height, 14);
        const darkDilationCache = new Map();
        function darkDilationsForLayer(layer) {
          const tolerance = layer === 'wall' ? wallDarkTolerancePx : defaultDarkTolerancePx;
          if (!darkDilationCache.has(tolerance)) {
            darkDilationCache.set(tolerance, {
              source: tolerance === defaultDarkTolerancePx ? sourceDarkDilated : dilate(sourceDark, width, height, tolerance),
              render: tolerance === defaultDarkTolerancePx ? renderDarkDilated : dilate(renderDark, width, height, tolerance),
              tolerance,
            });
          }
          return darkDilationCache.get(tolerance);
        }
        const primitiveSpans = primitiveRegions.map((region) => ({
          x: region.x,
          y: region.y,
          width: region.width,
          height: region.height,
          layer: region.layer,
        }));
        const primitiveMask = primitiveRegionMask(width, height, primitiveSpans, sourceFrame.placement);
        const layers = [...new Set(primitiveRegions.map((region) => region.layer).filter(Boolean))].sort();
        const sourceDarkPixels = count(sourceDark);
        const renderDarkPixels = count(renderDark);
        const sourceEdgePixels = count(sourceEdge);
        const renderEdgePixels = count(renderEdge);
        const primitiveSourceDarkPixels = countWithin(sourceDark, primitiveMask);
        const primitiveRenderDarkPixels = countWithin(renderDark, primitiveMask);
        const primitiveSourceEdgePixels = countWithin(sourceEdge, primitiveMask);
        const primitiveRenderEdgePixels = countWithin(renderEdge, primitiveMask);
        const unmatchedSourceDarkPixels = unmatched(sourceDark, renderDarkDilated);
        const unmatchedRenderDarkPixels = unmatched(renderDark, sourceDarkDilated);
        const unmatchedSourceEdgePixels = unmatched(sourceEdge, renderEdgeDilated);
        const unmatchedRenderEdgePixels = unmatched(renderEdge, sourceEdgeDilated);
        const primitiveUnmatchedSourceDarkPixels = unmatchedWithin(sourceDark, renderDarkDilated, primitiveMask);
        const primitiveUnmatchedRenderDarkPixels = unmatchedWithin(renderDark, sourceDarkDilated, primitiveMask);
        const primitiveUnmatchedSourceEdgePixels = unmatchedWithin(sourceEdge, renderEdgeDilated, primitiveMask);
        const primitiveUnmatchedRenderEdgePixels = unmatchedWithin(renderEdge, sourceEdgeDilated, primitiveMask);
        const primitiveLayerDrift = {};
        for (const layer of layers) {
          const layerRegions = primitiveRegions.filter((region) => region.layer === layer);
          const layerMask = primitiveRegionMask(width, height, layerRegions, sourceFrame.placement);
          const layerSourceDarkPixels = countWithin(sourceDark, layerMask);
          const layerRenderDarkPixels = countWithin(renderDark, layerMask);
          const layerSourceEdgePixels = countWithin(sourceEdge, layerMask);
          const layerRenderEdgePixels = countWithin(renderEdge, layerMask);
          const layerDarkDilations = darkDilationsForLayer(layer);
          const layerUnmatchedSourceDarkPixels = unmatchedWithin(sourceDark, layerDarkDilations.render, layerMask);
          const layerUnmatchedRenderDarkPixels = unmatchedWithin(renderDark, layerDarkDilations.source, layerMask);
          const layerUnmatchedSourceEdgePixels = unmatchedWithin(sourceEdge, renderEdgeDilated, layerMask);
          const layerUnmatchedRenderEdgePixels = unmatchedWithin(renderEdge, sourceEdgeDilated, layerMask);
          primitiveLayerDrift[layer] = {
            primitiveCount: layerRegions.length,
            darkTolerancePx: layerDarkDilations.tolerance,
            sourceDarkPixels: layerSourceDarkPixels,
            renderDarkPixels: layerRenderDarkPixels,
            sourceMissRate: layerUnmatchedSourceDarkPixels / Math.max(1, layerSourceDarkPixels),
            renderExtraRate: layerUnmatchedRenderDarkPixels / Math.max(1, layerRenderDarkPixels),
            sourceEdgePixels: layerSourceEdgePixels,
            renderEdgePixels: layerRenderEdgePixels,
            edgeSourceMissRate: layerUnmatchedSourceEdgePixels / Math.max(1, layerSourceEdgePixels),
            edgeRenderExtraRate: layerUnmatchedRenderEdgePixels / Math.max(1, layerRenderEdgePixels),
          };
        }
        const primitiveRegionDrift = primitiveRegions.map((region) => {
          const regionMask = primitiveRegionMask(width, height, [{
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
          }], sourceFrame.placement);
          const regionSourceDarkPixels = countWithin(sourceDark, regionMask);
          const regionRenderDarkPixels = countWithin(renderDark, regionMask);
          const regionSourceEdgePixels = countWithin(sourceEdge, regionMask);
          const regionRenderEdgePixels = countWithin(renderEdge, regionMask);
          const regionDarkDilations = darkDilationsForLayer(region.layer);
          const regionUnmatchedSourceDarkPixels = unmatchedWithin(sourceDark, regionDarkDilations.render, regionMask);
          const regionUnmatchedRenderDarkPixels = unmatchedWithin(renderDark, regionDarkDilations.source, regionMask);
          const regionUnmatchedSourceEdgePixels = unmatchedWithin(sourceEdge, renderEdgeDilated, regionMask);
          const regionUnmatchedRenderEdgePixels = unmatchedWithin(renderEdge, sourceEdgeDilated, regionMask);
          return {
            id: region.id ?? '',
            layer: region.layer ?? 'unknown',
            box: {
              x: region.x,
              y: region.y,
              width: region.width,
              height: region.height,
            },
            sourceMissRate: regionUnmatchedSourceDarkPixels / Math.max(1, regionSourceDarkPixels),
            renderExtraRate: regionUnmatchedRenderDarkPixels / Math.max(1, regionRenderDarkPixels),
            edgeSourceMissRate: regionUnmatchedSourceEdgePixels / Math.max(1, regionSourceEdgePixels),
            edgeRenderExtraRate: regionUnmatchedRenderEdgePixels / Math.max(1, regionRenderEdgePixels),
            darkTolerancePx: regionDarkDilations.tolerance,
            sourceDarkPixels: regionSourceDarkPixels,
            renderDarkPixels: regionRenderDarkPixels,
            sourceEdgePixels: regionSourceEdgePixels,
            renderEdgePixels: regionRenderEdgePixels,
          };
        }).sort((a, b) => (
          (b.edgeRenderExtraRate + b.edgeSourceMissRate + b.renderExtraRate * 0.25 + b.sourceMissRate * 0.25)
          - (a.edgeRenderExtraRate + a.edgeSourceMissRate + a.renderExtraRate * 0.25 + a.sourceMissRate * 0.25)
        ));

        return {
          widthPx: width,
          heightPx: height,
          sourceDarkPixels,
          renderDarkPixels,
          unmatchedSourceDarkPixels,
          unmatchedRenderDarkPixels,
          sourceMissRate: unmatchedSourceDarkPixels / Math.max(1, sourceDarkPixels),
          renderExtraRate: unmatchedRenderDarkPixels / Math.max(1, renderDarkPixels),
          sourceEdgePixels,
          renderEdgePixels,
          unmatchedSourceEdgePixels,
          unmatchedRenderEdgePixels,
          edgeSourceMissRate: unmatchedSourceEdgePixels / Math.max(1, sourceEdgePixels),
          edgeRenderExtraRate: unmatchedRenderEdgePixels / Math.max(1, renderEdgePixels),
          primitiveSourceDarkPixels,
          primitiveRenderDarkPixels,
          primitiveUnmatchedSourceDarkPixels,
          primitiveUnmatchedRenderDarkPixels,
          primitiveSourceMissRate: primitiveUnmatchedSourceDarkPixels / Math.max(1, primitiveSourceDarkPixels),
          primitiveRenderExtraRate: primitiveUnmatchedRenderDarkPixels / Math.max(1, primitiveRenderDarkPixels),
          primitiveSourceEdgePixels,
          primitiveRenderEdgePixels,
          primitiveUnmatchedSourceEdgePixels,
          primitiveUnmatchedRenderEdgePixels,
          primitiveEdgeSourceMissRate: primitiveUnmatchedSourceEdgePixels / Math.max(1, primitiveSourceEdgePixels),
          primitiveEdgeRenderExtraRate: primitiveUnmatchedRenderEdgePixels / Math.max(1, primitiveRenderEdgePixels),
          primitiveRegionCount: primitiveSpans.length,
          primitiveLayerDrift,
          primitiveRegionDrift,
          darkTolerancePx: defaultDarkTolerancePx,
          wallDarkTolerancePx,
          alignmentMode: usePageAligned ? 'page-aligned' : 'content-crop',
          sourceNaturalWidth: sourceImage.naturalWidth,
          sourceNaturalHeight: sourceImage.naturalHeight,
          renderNaturalWidth: renderImage.naturalWidth,
          renderNaturalHeight: renderImage.naturalHeight,
        };
      }, { sourceUrl, renderUrl, size: args.canvasSize, primitiveRegions });

      const primitiveEdgeSourceMissRate = metrics.primitiveEdgeSourceMissRate ?? metrics.edgeSourceMissRate;
      const primitiveEdgeRenderExtraRate = metrics.primitiveEdgeRenderExtraRate ?? metrics.edgeRenderExtraRate;
      const primitiveSourceMissRate = metrics.primitiveSourceMissRate ?? metrics.sourceMissRate;
      const primitiveRenderExtraRate = metrics.primitiveRenderExtraRate ?? metrics.renderExtraRate;
      const fullSourceMissRate = metrics.sourceMissRate;
      const fullRenderExtraRate = metrics.renderExtraRate;
      const fullEdgeSourceMissRate = metrics.edgeSourceMissRate;
      const fullEdgeRenderExtraRate = metrics.edgeRenderExtraRate;
      const semanticDriftBlocked =
        primitiveEdgeSourceMissRate > 0.12 ||
        primitiveEdgeRenderExtraRate > 0.08;
      const primitiveDarkDriftBlocked =
        primitiveSourceMissRate > 0.18 ||
        primitiveRenderExtraRate > 0.24;
      const drawingLanguageDriftBlocked =
        fullSourceMissRate > 0.28 ||
        fullRenderExtraRate > 0.28 ||
        fullEdgeSourceMissRate > 0.11 ||
        fullEdgeRenderExtraRate > 0.08;
      const layerEntries = Object.entries(metrics.primitiveLayerDrift ?? {});
      const layerBlockers = layerEntries
        .filter(([layer, value]) => primitiveLayerBlocked(layer, value))
        .map(([layer, value]) => ({
          layer,
          severity: primitiveLayerSeverity(layer, value),
          sourceMissRate: value.sourceMissRate,
          renderExtraRate: value.renderExtraRate,
          edgeSourceMissRate: value.edgeSourceMissRate,
          edgeRenderExtraRate: value.edgeRenderExtraRate,
          thresholds: primitiveLayerThreshold(layer),
          topPrimitiveIds: (metrics.primitiveRegionDrift ?? [])
            .filter((region) => region.layer === layer)
            .slice(0, 8)
            .map((region) => region.id),
        }));
      const passed = !semanticDriftBlocked && !primitiveDarkDriftBlocked && !drawingLanguageDriftBlocked && layerBlockers.length === 0;
      const drift = {
        artifactVersion: 'paired_visual_drift_v1',
        planId,
        proposalId: option.id,
        sourceImage: sourceUrl,
        deterministicRender: renderUrl,
        passed,
        reviewedAt: now,
        reviewSource: 'scripts/recompute-visual-drift.mjs browser canvas comparison',
        coveredRepairIds,
        thresholds: {
          darkThreshold: 170,
          tolerancePx: 4,
          wallDarkTolerancePx: 9,
          edgeThreshold: 20,
          edgeTolerancePx: 14,
          sourceMissRateMax: 0.3,
          renderExtraRateMax: 0.3,
          edgeSourceMissRateMax: 0.12,
          edgeRenderExtraRateMax: 0.08,
          primitiveSourceMissRateMax: 0.18,
          primitiveRenderExtraRateMax: 0.24,
          primitiveEdgeSourceMissRateMax: 0.12,
          primitiveEdgeRenderExtraRateMax: 0.08,
          fullSourceMissRateMax: 0.28,
          fullRenderExtraRateMax: 0.28,
          fullEdgeSourceMissRateMax: 0.11,
          fullEdgeRenderExtraRateMax: 0.08,
          primitiveLayerThresholds: {
            default: primitiveLayerThreshold('default'),
            wall: primitiveLayerThreshold('wall'),
          },
        },
        metrics,
        primitiveLayerBlockers: layerBlockers,
        likelySemanticCauses: passed ? [] : [
          semanticDriftBlocked
            ? 'primitive geometry or source/render scale drift'
            : primitiveDarkDriftBlocked
              ? 'primitive drawing mass drift: source/render wall bands, fixtures, furniture, dimensions, or dashed voids do not occupy the same pixels'
              : 'drawing style drift: wall thickness/caps, openings, fixtures, ladder, dimensions, or dashed void rhythm',
          ...layerBlockers.map((issue) => `${issue.layer} layer ${issue.severity} drift`),
        ],
        issues: passed ? [] : [
          {
            layer: semanticDriftBlocked ? 'source/render primitives' : primitiveDarkDriftBlocked ? 'primitive drawing mass' : 'drawing style profile',
            severity: 'blocked',
            description: `source miss ${(metrics.sourceMissRate * 100).toFixed(1)}%, render extra ${(metrics.renderExtraRate * 100).toFixed(1)}%, primitive source miss ${(primitiveSourceMissRate * 100).toFixed(1)}%, primitive render extra ${(primitiveRenderExtraRate * 100).toFixed(1)}%, edge miss ${(metrics.edgeSourceMissRate * 100).toFixed(1)}%, edge extra ${(metrics.edgeRenderExtraRate * 100).toFixed(1)}%`,
          },
          ...layerBlockers.map((issue) => ({
            layer: issue.layer,
            severity: 'blocked',
            description: `${issue.layer} visual drift: source miss ${((issue.sourceMissRate ?? 0) * 100).toFixed(1)}%, render extra ${((issue.renderExtraRate ?? 0) * 100).toFixed(1)}%, edge miss ${((issue.edgeSourceMissRate ?? 0) * 100).toFixed(1)}%, edge extra ${((issue.edgeRenderExtraRate ?? 0) * 100).toFixed(1)}%`,
            semanticElementIds: issue.topPrimitiveIds,
            topPrimitives: (metrics.primitiveRegionDrift ?? [])
              .filter((region) => region.layer === issue.layer)
              .slice(0, 8)
              .map((region) => ({
                id: region.id,
                edgeSourceMissRate: region.edgeSourceMissRate,
                edgeRenderExtraRate: region.edgeRenderExtraRate,
                sourceMissRate: region.sourceMissRate,
                renderExtraRate: region.renderExtraRate,
                box: region.box,
              })),
          })),
        ],
      };
      await writeFile(resolve(LOOP_ROOT, planId, option.pairedVisualDriftUrl), `${JSON.stringify(drift, null, 2)}\n`);
      if (artifact?.patchState?.visualDriftStale) {
        artifact.patchState = {
          ...artifact.patchState,
          visualDriftStale: false,
          visualDriftRecomputedAt: now,
        };
        await writeJson(pairedJsonPath, artifact);
      }
      results.push({ planId, proposalId: option.id, status: passed ? 'pass' : 'blocked', metrics });
    }
  } finally {
    await browser.close();
  }

  for (const result of results) {
    if (result.status === 'skipped') console.log(`visual drift skipped: ${result.planId} (${result.reason})`);
    else {
      const m = result.metrics;
      console.log(
        `visual drift ${result.status}: ${result.planId}/${result.proposalId} ` +
        `source ${(m.sourceMissRate * 100).toFixed(1)}%, render ${(m.renderExtraRate * 100).toFixed(1)}%, ` +
        `edge source ${(m.edgeSourceMissRate * 100).toFixed(1)}%, edge render ${(m.edgeRenderExtraRate * 100).toFixed(1)}%`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
