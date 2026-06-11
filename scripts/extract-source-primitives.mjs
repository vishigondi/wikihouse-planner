#!/usr/bin/env node
/**
 * Extract source-image primitive anchors from the GPT proposal image.
 *
 * This does not repair semantic geometry. It uses the existing semantic
 * primitive id/span as a search hint, snaps to visible proposal pixels near that
 * hint, and writes anchors tagged as source-image evidence. Browser QA can then
 * compare semantic/rendered primitives against actual source spans instead of
 * deterministic-plan-bounds.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(import.meta.dirname, '..');

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const planId = argValue('--plan');
const proposalId = argValue('--proposal');
const inPath = argValue('--in');
const outPath = argValue('--out');
const imageArg = argValue('--image');

if (!planId || !proposalId) {
  console.error('usage: node scripts/extract-source-primitives.mjs --plan PLAN --proposal PROPOSAL [--in paired.json] [--out paired.json] [--image source.png]');
  process.exit(2);
}

const pairedPath = resolve(ROOT, inPath ?? `public/data/den-image-loop/${planId}/paired/${planId}-${proposalId}.paired.json`);
const outputPath = resolve(ROOT, outPath ?? pairedPath);
const defaultImage = resolve(ROOT, `public/data/den-image-loop/${planId}/chatgpt-handoff/generated/${planId}-${proposalId}.png`);
const imagePath = resolve(ROOT, imageArg ?? defaultImage);

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function spanValue(value) {
  const span = objectValue(value);
  if (!span) return null;
  if (typeof span.x1 === 'number' && typeof span.z1 === 'number' && typeof span.x2 === 'number' && typeof span.z2 === 'number') {
    return { x1: span.x1, z1: span.z1, x2: span.x2, z2: span.z2 };
  }
  return null;
}

function boundsToSpan(value) {
  const bounds = objectValue(value);
  const x = numberValue(bounds?.x, Number.NaN);
  const z = numberValue(bounds?.z ?? bounds?.y, Number.NaN);
  const w = numberValue(bounds?.w ?? bounds?.width, Number.NaN);
  const d = numberValue(bounds?.d ?? bounds?.h ?? bounds?.height, Number.NaN);
  if (![x, z, w, d].every(Number.isFinite)) return null;
  return { x1: x, z1: z, x2: x + w, z2: z + d };
}

function hasSpan(item) {
  return Boolean(spanValue(item?.span));
}

function sourceAnchorId(item) {
  const anchor = objectValue(item?.sourceAnchor);
  const id = item?.sourceAnchorId ?? anchor?.id ?? item?.id;
  return typeof id === 'string' ? id : null;
}

function semanticExtentForFloor(artifact, floor) {
  const spans = [
    ...arrayValue(artifact.exteriorWalls),
    ...arrayValue(artifact.interiorWalls),
    ...arrayValue(artifact.openings),
    ...arrayValue(artifact.doors),
    ...arrayValue(artifact.windows),
  ]
    .map(objectValue)
    .filter(Boolean)
    .filter((item) => numberValue(item.floor ?? item.levelIndex, 0) === floor)
    .map((item) => spanValue(item.span))
    .filter(Boolean);
  if (!spans.length) return null;
  const xs = spans.flatMap((span) => [span.x1, span.x2]);
  const zs = spans.flatMap((span) => [span.z1, span.z2]);
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const z1 = Math.min(...zs);
  const z2 = Math.max(...zs);
  if (![x1, x2, z1, z2].every(Number.isFinite) || x2 <= x1 || z2 <= z1) return null;
  return { x: x1, z: z1, w: x2 - x1, d: z2 - z1 };
}

function pixelSpanFromAnchor(anchor) {
  const directPixels = anchor?.pixelBounds;
  if (Array.isArray(directPixels) && directPixels.length >= 4) {
    const [x1, z1, x2, z2] = directPixels.map(Number);
    if ([x1, z1, x2, z2].every(Number.isFinite)) return { x1, z1, x2, z2 };
  }
  const sourcePixels = anchor?.sourceAnchor?.pixelBounds;
  if (Array.isArray(sourcePixels) && sourcePixels.length >= 4) {
    const [x1, z1, x2, z2] = sourcePixels.map(Number);
    if ([x1, z1, x2, z2].every(Number.isFinite)) return { x1, z1, x2, z2 };
  }
  return spanValue(anchor?.span) ?? boundsToSpan(anchor?.bounds) ?? boundsToSpan(anchor?.pixelBounds) ?? null;
}

function frameForFloor(artifact, floor) {
  const panels = arrayValue(artifact.floorPanels).map(objectValue).filter(Boolean);
  const panel = panels.find((candidate) => numberValue(candidate.floor ?? candidate.levelIndex, 0) === floor && arrayValue(candidate.sourceAnchors).length)
    ?? panels.find((candidate) => numberValue(candidate.floor ?? candidate.levelIndex, 0) === floor);
  if (!panel) {
    const footprint = objectValue(artifact.footprint);
    const coordinateSystem = objectValue(artifact.coordinateSystem);
    const pixelBounds = pixelSpanFromAnchor(footprint?.sourceAnchor)
      ?? (() => {
        const bounds = arrayValue(coordinateSystem?.planPixelBounds).map(Number);
        if (bounds.length >= 4 && bounds.every(Number.isFinite)) return { x1: bounds[0], z1: bounds[1], x2: bounds[2], z2: bounds[3] };
        return null;
      })();
    const widthFt = numberValue(footprint?.widthFt ?? footprint?.width ?? footprint?.w, 0);
    const depthFt = numberValue(footprint?.depthFt ?? footprint?.depth ?? footprint?.d, 0);
    const xFt = numberValue(footprint?.x, 0);
    const zFt = numberValue(footprint?.z, 0);
    if (!pixelBounds || !widthFt || !depthFt) return null;
    return { sourceFrame: pixelBounds, widthFt, depthFt, xFt, zFt };
  }
  const footprint = objectValue(panel.footprint);
  let widthFt = numberValue(footprint?.widthFt ?? footprint?.width ?? footprint?.w, 0);
  let depthFt = numberValue(footprint?.depthFt ?? footprint?.depth ?? footprint?.d, 0);
  let xFt = numberValue(footprint?.x, 0);
  let zFt = numberValue(footprint?.z, 0);
  const extent = semanticExtentForFloor(artifact, floor);
  if (extent && (extent.x < xFt - 0.5 || extent.z < zFt - 0.5 || extent.w > widthFt + 0.75 || extent.d > depthFt + 0.75)) {
    xFt = extent.x;
    zFt = extent.z;
    widthFt = extent.w;
    depthFt = extent.d;
  }
  const anchors = arrayValue(panel.sourceAnchors).map(objectValue).filter(Boolean);
  const sourceFrame = pixelSpanFromAnchor(anchors.find((anchor) => /generated|source|footprint|frame/i.test(`${anchor?.id ?? ''} ${anchor?.kind ?? ''} ${anchor?.sourceSlot ?? ''}`)))
    ?? pixelSpanFromAnchor(anchors.find(Boolean));
  if (!sourceFrame || !widthFt || !depthFt) return null;
  return { sourceFrame, widthFt, depthFt, xFt, zFt };
}

function ftToPx(point, frame) {
  const widthPx = frame.sourceFrame.x2 - frame.sourceFrame.x1;
  const depthPx = frame.sourceFrame.z2 - frame.sourceFrame.z1;
  return {
    x: frame.sourceFrame.x1 + ((point.x - frame.xFt) / frame.widthFt) * widthPx,
    y: frame.sourceFrame.z1 + ((point.z - frame.zFt) / frame.depthFt) * depthPx,
  };
}

function spanFtToPixelBox(span, frame, pad = 0) {
  const a = ftToPx({ x: span.x1, z: span.z1 }, frame);
  const b = ftToPx({ x: span.x2, z: span.z2 }, frame);
  const x = Math.min(a.x, b.x) - pad;
  const y = Math.min(a.y, b.y) - pad;
  const w = Math.abs(a.x - b.x) + pad * 2;
  const h = Math.abs(a.y - b.y) + pad * 2;
  return { x, y, w: Math.max(w, 1), h: Math.max(h, 1) };
}

function looksLikePixelSpan(span) {
  if (!span) return false;
  return [span.x1, span.z1, span.x2, span.z2].some((value) => Math.abs(numberValue(value, 0)) > 80);
}

function spanToPixelBox(span, pad = 0) {
  const x = Math.min(span.x1, span.x2) - pad;
  const y = Math.min(span.z1, span.z2) - pad;
  const w = Math.abs(span.x2 - span.x1) + pad * 2;
  const h = Math.abs(span.z2 - span.z1) + pad * 2;
  return { x, y, w: Math.max(w, 1), h: Math.max(h, 1) };
}

function breakSpan(value) {
  if (Array.isArray(value)) {
    const [from, to] = value;
    if (Array.isArray(from) && Array.isArray(to)) return { x1: from[0], z1: from[1], x2: to[0], z2: to[1] };
    return null;
  }
  const item = objectValue(value);
  return spanValue(item?.span) ?? spanValue(item) ?? null;
}

function collinearGapInterval(wall, gap, tolerance = 0.35) {
  const horizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const wallMin = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
  const wallMax = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
  const wallLine = horizontal ? (wall.z1 + wall.z2) / 2 : (wall.x1 + wall.x2) / 2;
  const gapLine = horizontal ? (gap.z1 + gap.z2) / 2 : (gap.x1 + gap.x2) / 2;
  if (Math.abs(wallLine - gapLine) > tolerance) return null;
  const gapStart = horizontal ? Math.min(gap.x1, gap.x2) : Math.min(gap.z1, gap.z2);
  const gapEnd = horizontal ? Math.max(gap.x1, gap.x2) : Math.max(gap.z1, gap.z2);
  const start = Math.max(wallMin, gapStart);
  const end = Math.min(wallMax, gapEnd);
  return end - start > 0.05 ? { start, end } : null;
}

function splitWallByGaps(wall, gaps) {
  const horizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const wallStart = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
  const wallEnd = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
  const intervals = gaps
    .map((gap) => collinearGapInterval(wall, gap))
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end + 0.05) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  const line = horizontal ? (wall.z1 + wall.z2) / 2 : (wall.x1 + wall.x2) / 2;
  const segments = [];
  let cursor = wallStart;
  for (const interval of merged) {
    if (interval.start - cursor > 0.05) {
      segments.push(horizontal ? { x1: cursor, z1: line, x2: interval.start, z2: line } : { x1: line, z1: cursor, x2: line, z2: interval.start });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (wallEnd - cursor > 0.05) segments.push(horizontal ? { x1: cursor, z1: line, x2: wallEnd, z2: line } : { x1: line, z1: cursor, x2: line, z2: wallEnd });
  return segments.length ? segments : [wall];
}

function primitiveWallLayer(item) {
  const text = `${item.id ?? ''} ${item.wallKind ?? ''} ${item.kind ?? ''} ${item.type ?? ''}`;
  if (/glaz|window/i.test(text)) return 'window';
  if (/dashed|void|open.to.below|overhead/i.test(text)) return 'dashedVoid';
  return 'wall';
}

function isDashedVoidItem(item) {
  return /dashed|void|open.to.below|open-to-below|open_to_below|overhead|cross/i.test(
    `${item?.id ?? ''} ${item?.kind ?? ''} ${item?.type ?? ''} ${item?.category ?? ''} ${item?.symbolVariant ?? ''} ${item?.sourceKind ?? ''} ${item?.elementType ?? ''}`,
  );
}

function primitiveItems(artifact) {
  const items = [];
  const wallItems = [...arrayValue(artifact.exteriorWalls), ...arrayValue(artifact.interiorWalls)].map(objectValue).filter(Boolean);
  for (const [index, wall] of wallItems.entries()) {
    const span = spanValue(wall.span);
    if (!span) continue;
    const layer = primitiveWallLayer(wall);
    const wallId = wall.id;
    const gaps = layer === 'window' ? [] : [
      ...arrayValue(wall.breaks).map(breakSpan).filter(Boolean),
      ...arrayValue(artifact.doors).map(objectValue).filter((opening) => opening?.wallId === wallId).map((opening) => spanValue(opening.span)).filter(Boolean),
      ...arrayValue(artifact.openings).map(objectValue).filter((opening) => opening?.wallId === wallId).map((opening) => spanValue(opening.span)).filter(Boolean),
      ...arrayValue(artifact.windows).map(objectValue).filter((opening) => opening?.wallId === wallId).map((opening) => spanValue(opening.span)).filter(Boolean),
    ];
    const segments = splitWallByGaps(span, gaps);
    segments.forEach((segment, segmentIndex) => {
      const id = segments.length > 1 ? `${wall.id ?? 'wall'}:seg-${segmentIndex + 1}` : wall.id;
      items.push({ layer, floor: numberValue(wall.floor ?? wall.levelIndex, 0), id, sourceAnchorId: id, item: wall, span: segment, sourceKind: wall.kind ?? wall.type ?? '' });
    });
  }
  for (const [index, door] of arrayValue(artifact.doors).map(objectValue).filter(Boolean).entries()) {
    const span = spanValue(door.span) ?? boundsToSpan(door.bounds);
    if (span) items.push({ layer: 'door', floor: numberValue(door.floor ?? door.levelIndex, 0), id: door.id ?? `door-${index}`, sourceAnchorId: sourceAnchorId(door), item: door, span, sourceKind: door.kind ?? door.type ?? '' });
  }
  for (const [index, win] of arrayValue(artifact.windows).map(objectValue).filter(Boolean).entries()) {
    const span = spanValue(win.span) ?? boundsToSpan(win.bounds);
    if (span) items.push({ layer: 'window', floor: numberValue(win.floor ?? win.levelIndex, 0), id: win.id ?? `window-${index}`, sourceAnchorId: sourceAnchorId(win), item: win, span, sourceKind: win.kind ?? win.type ?? '' });
  }
  for (const [index, spaceFace] of arrayValue(artifact.spaceFaces).map(objectValue).filter(Boolean).entries()) {
    const span = boundsToSpan(spaceFace.bounds) ?? spanValue(spaceFace.span);
    if (span && isDashedVoidItem(spaceFace)) items.push({ layer: 'dashedVoid', floor: numberValue(spaceFace.floor ?? spaceFace.levelIndex, 0), id: spaceFace.id ?? `spaceface-void-${index}`, sourceAnchorId: sourceAnchorId(spaceFace), item: spaceFace, span, sourceKind: spaceFace.symbolVariant ?? spaceFace.type ?? spaceFace.kind ?? 'open-to-below-void' });
  }
  for (const [index, room] of arrayValue(artifact.rooms).map(objectValue).filter(Boolean).entries()) {
    const hasSpaceFace = arrayValue(artifact.spaceFaces).map(objectValue).some((spaceFace) => spaceFace && String(spaceFace.roomId ?? '') === String(room.id ?? ''));
    const span = boundsToSpan(room.bounds) ?? spanValue(room.span);
    if (!hasSpaceFace && span && isDashedVoidItem(room)) items.push({ layer: 'dashedVoid', floor: numberValue(room.floor ?? room.levelIndex, 0), id: room.id ?? `room-void-${index}`, sourceAnchorId: sourceAnchorId(room), item: room, span, sourceKind: room.symbolVariant ?? room.type ?? room.kind ?? 'open-to-below-void' });
  }
  for (const [index, fixture] of arrayValue(artifact.fixtures).map(objectValue).filter(Boolean).entries()) {
    const text = `${fixture.id ?? ''} ${fixture.fixtureKind ?? ''} ${fixture.type ?? ''} ${fixture.symbolVariant ?? ''}`;
    if (/exterior[_\s-]*stoop|deck|porch|patio/i.test(text)) continue;
    if (isDashedVoidItem(fixture)) continue;
    const span = boundsToSpan(fixture.bounds) ?? spanValue(fixture.span);
    if (span) items.push({ layer: /ladder|stair/i.test(text) ? 'ladder' : 'fixture', floor: numberValue(fixture.floor ?? fixture.levelIndex, 0), id: fixture.id ?? `fixture-${index}`, sourceAnchorId: sourceAnchorId(fixture), item: fixture, span, sourceKind: fixture.symbolVariant ?? fixture.fixtureType ?? fixture.type ?? fixture.kind ?? '' });
  }
  for (const [index, dim] of arrayValue(artifact.dimensionLines).map(objectValue).filter(Boolean).entries()) {
    const span = spanValue(dim.span);
    if (span) items.push({ layer: 'dimension', floor: numberValue(dim.floor ?? dim.levelIndex, 0), id: dim.id ?? `dimension-${index}`, sourceAnchorId: sourceAnchorId(dim), item: dim, span, sourceKind: 'dimension' });
  }
  return items.filter((item) => item.sourceAnchorId);
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function cropBox(box, width, height) {
  const x1 = Math.max(0, Math.floor(box.x));
  const y1 = Math.max(0, Math.floor(box.y));
  const x2 = Math.min(width - 1, Math.ceil(box.x + box.w));
  const y2 = Math.min(height - 1, Math.ceil(box.y + box.h));
  return { x1, y1, x2, y2, w: Math.max(0, x2 - x1 + 1), h: Math.max(0, y2 - y1 + 1) };
}

function clampBoxToRaw(box, raw, meta, horizontal) {
  const rawPadByLayer = {
    wall: 18,
    window: 14,
    door: 22,
    ladder: 18,
    dashedVoid: 16,
    fixture: 16,
    dimension: 12,
  };
  const pad = rawPadByLayer[meta.layer] ?? 16;
  const maxMinor = {
    wall: 28,
    window: 18,
    dashedVoid: 18,
    dimension: 16,
  }[meta.layer];
  const clamp = {
    x1: raw.x - pad,
    y1: raw.y - pad,
    x2: raw.x + raw.w + pad,
    y2: raw.y + raw.h + pad,
  };
  let x1 = Math.max(box.x, clamp.x1);
  let y1 = Math.max(box.y, clamp.y1);
  let x2 = Math.min(box.x + box.w, clamp.x2);
  let y2 = Math.min(box.y + box.h, clamp.y2);

  // Line-like primitives should preserve their source center/length signal
  // without letting the minor axis swallow adjacent walls, labels, or fixtures.
  if (maxMinor) {
    if (horizontal && y2 - y1 > maxMinor) {
      const cy = raw.y + raw.h / 2;
      y1 = Math.max(y1, cy - maxMinor / 2);
      y2 = Math.min(y2, cy + maxMinor / 2);
    } else if (!horizontal && x2 - x1 > maxMinor) {
      const cx = raw.x + raw.w / 2;
      x1 = Math.max(x1, cx - maxMinor / 2);
      x2 = Math.min(x2, cx + maxMinor / 2);
    }
  }

  if (x2 <= x1 || y2 <= y1) return box;
  return {
    ...box,
    x: x1,
    y: y1,
    z: y1,
    w: Math.max(1, x2 - x1),
    h: Math.max(1, y2 - y1),
    d: Math.max(1, y2 - y1),
  };
}

function snapBox(raw, meta, image) {
  const horizontal = Math.abs(meta.span.x2 - meta.span.x1) >= Math.abs(meta.span.z2 - meta.span.z1);
  const thin = Math.min(raw.w, raw.h);
  const long = Math.max(raw.w, raw.h);
  const layerPad = {
    wall: Math.max(18, thin * 4),
    window: 18,
    door: 28,
    ladder: 22,
    dashedVoid: 24,
    fixture: 18,
    dimension: 14,
  }[meta.layer] ?? 18;
  const linePad = meta.layer === 'fixture' ? layerPad : Math.max(layerPad, thin * 2);
  const search = cropBox({
    x: raw.x - (horizontal ? 12 : linePad),
    y: raw.y - (horizontal ? linePad : 12),
    w: raw.w + (horizontal ? 24 : linePad * 2),
    h: raw.h + (horizontal ? linePad * 2 : 24),
  }, image.width, image.height);
  if (!search.w || !search.h) return null;

  const threshold = meta.layer === 'dashedVoid' || meta.layer === 'dimension' ? 215 : meta.layer === 'wall' ? 225 : 210;
  const darkThreshold = meta.layer === 'wall' ? 235 : 220;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  const cx = raw.x + raw.w / 2;
  const cy = raw.y + raw.h / 2;
  for (let y = search.y1; y <= search.y2; y += 1) {
    for (let x = search.x1; x <= search.x2; x += 1) {
      const offset = (y * image.width + x) * image.channels;
      const lum = luminance(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
      if (lum > threshold) continue;
      if ((meta.layer === 'wall' || meta.layer === 'window') && lum > darkThreshold) continue;
      if (meta.layer !== 'fixture' && meta.layer !== 'door' && meta.layer !== 'ladder' && meta.layer !== 'dashedVoid') {
        const dist = horizontal ? Math.abs(y - cy) : Math.abs(x - cx);
        if (dist > linePad) continue;
      }
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      count += 1;
    }
  }
  const minPixels = meta.layer === 'fixture' || meta.layer === 'door' ? 8 : meta.layer === 'dashedVoid' ? 5 : Math.max(4, Math.min(80, long * 0.08));
  if (count < minPixels || !Number.isFinite(minX)) return null;
  const w = Math.max(1, maxX - minX + 1);
  const h = Math.max(1, maxY - minY + 1);
  return clampBoxToRaw({ x: minX, y: minY, z: minY, w, h, d: h, pixelCount: count }, raw, meta, horizontal);
}

function anchorFromBox(meta, box) {
  return {
    id: meta.sourceAnchorId,
    sourceAnchorId: meta.sourceAnchorId,
    elementId: meta.id,
    elementType: meta.layer,
    pixelBounds: { x: box.x, y: box.y, z: box.y, w: box.w, h: box.h, d: box.h },
    span: { x1: box.x, z1: box.y, x2: box.x + box.w, z2: box.y + box.h },
    floor: meta.floor,
    anchorKind: 'source-image-primitive',
    source: 'gpt-proposal-image',
    extraction: {
      script: 'scripts/extract-source-primitives.mjs',
      pixelCount: box.pixelCount,
      sourceKind: meta.sourceKind,
    },
    confidence: box.pixelCount > 20 ? 0.82 : 0.62,
  };
}

async function main() {
  if (!existsSync(pairedPath)) throw new Error(`missing paired JSON: ${pairedPath}`);
  if (!existsSync(imagePath)) throw new Error(`missing source image: ${imagePath}`);
  const artifact = JSON.parse(await readFile(pairedPath, 'utf8'));
  const imageRaw = await sharp(imagePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const image = {
    data: imageRaw.data,
    width: imageRaw.info.width,
    height: imageRaw.info.height,
    channels: imageRaw.info.channels,
  };
  const anchors = [];
  const missed = [];
  for (const primitive of primitiveItems(artifact)) {
    const frame = frameForFloor(artifact, primitive.floor);
    if (!frame) {
      missed.push({ id: primitive.sourceAnchorId, reason: 'missing-level-frame' });
      continue;
    }
    const pixelNativeSpan = primitive.layer === 'dimension' && looksLikePixelSpan(primitive.span)
      ? primitive.span
      : primitive.layer === 'dimension' && looksLikePixelSpan(boundsToSpan(primitive.item?.sourceAnchor?.pixelBounds))
        ? boundsToSpan(primitive.item?.sourceAnchor?.pixelBounds)
        : null;
    const rawBox = pixelNativeSpan ? spanToPixelBox(pixelNativeSpan, 0) : spanFtToPixelBox(primitive.span, frame, 0);
    let snapped = snapBox(rawBox, primitive, image);
    if (!snapped && primitive.layer === 'dimension') {
      const horizontal = Math.abs(primitive.span.x2 - primitive.span.x1) >= Math.abs(primitive.span.z2 - primitive.span.z1);
      const source = frame.sourceFrame;
      const fallbackBox = horizontal
        ? {
            x: Math.min(source.x1, source.x2),
            y: Math.min(source.z1, source.z2) - 48,
            w: Math.abs(source.x2 - source.x1),
            h: 42,
          }
        : {
            x: Math.min(source.x1, source.x2) - 48,
            y: Math.min(source.z1, source.z2),
            w: 42,
            h: Math.abs(source.z2 - source.z1),
          };
      snapped = snapBox(fallbackBox, primitive, image);
    }
    if (!snapped) {
      missed.push({ id: primitive.sourceAnchorId, layer: primitive.layer, reason: 'no-visible-pixels-near-semantic-span' });
      continue;
    }
    anchors.push(anchorFromBox(primitive, snapped));
  }
  const oldAnchors = arrayValue(artifact.sourceAnchors)
    .map(objectValue)
    .filter(Boolean)
    .filter((anchor) => !/deterministic-plan-bounds|source-image-primitive/i.test(`${anchor.anchorKind ?? ''}`));
  const deduped = new Map();
  for (const anchor of [...oldAnchors, ...anchors]) deduped.set(String(anchor.id ?? anchor.sourceAnchorId), anchor);
  artifact.sourceAnchors = [...deduped.values()];
  artifact.sourcePrimitiveExtraction = {
    schemaVersion: 'source_primitive_extraction_v1',
    generatedAt: new Date().toISOString(),
    script: 'scripts/extract-source-primitives.mjs',
    sourceImage: imagePath,
    extracted: anchors.length,
    missed,
  };
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({
    pairedPath,
    outputPath,
    imagePath,
    extracted: anchors.length,
    missed: missed.length,
    missedByLayer: missed.reduce((acc, item) => {
      acc[item.layer ?? item.reason] = (acc[item.layer ?? item.reason] ?? 0) + 1;
      return acc;
    }, {}),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
