export const DRAWING_PRIMITIVE_LAYERS = [
  'wall',
  'ladder',
  'door',
  'window',
  'dashedVoid',
  'dimension',
  'fixture',
] as const;

export type DrawingPrimitiveLayer = typeof DRAWING_PRIMITIVE_LAYERS[number];

export type DrawingPrimitive = {
  id: string;
  layer: DrawingPrimitiveLayer;
  floor: number;
  sourceAnchorId?: string;
  sourceKind?: string;
  role?: string;
  semanticSpan?: PrimitiveSpan;
  sourceSpanFt?: PrimitiveSpan;
};

export type DrawingPrimitiveCounts = Record<DrawingPrimitiveLayer, number>;

export type DrawingPrimitiveDiff = {
  layer: DrawingPrimitiveLayer;
  expected: number;
  rendered: number;
  missing: number;
  extra: number;
  severity: 'pass' | 'warning' | 'blocked';
};

export type PrimitiveSpan = { x1: number; z1: number; x2: number; z2: number };

export type DrawingPrimitiveGeometryDiff = {
  id: string;
  layer: DrawingPrimitiveLayer;
  floor: number;
  sourceAnchorId?: string;
  maxEndpointDriftFt: number;
  centerDriftFt: number;
  lengthDeltaFt: number;
  severity: 'pass' | 'warning' | 'blocked';
  description: string;
};

type Span = { x1?: unknown; z1?: unknown; x2?: unknown; z2?: unknown };
type SourceFrame = { sourceFrame: PrimitiveSpan; widthFt: number; depthFt: number; xFt: number; zFt: number };

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function hasSpan(value: unknown): boolean {
  const span = objectValue(value) as Span | null;
  return typeof span?.x1 === 'number' && typeof span?.z1 === 'number' && typeof span?.x2 === 'number' && typeof span?.z2 === 'number';
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function spanValue(value: unknown): PrimitiveSpan | undefined {
  const span = objectValue(value) as Span | null;
  if (!span || !hasSpan(span)) return undefined;
  return {
    x1: span.x1 as number,
    z1: span.z1 as number,
    x2: span.x2 as number,
    z2: span.z2 as number,
  };
}

function boundsToSpan(value: unknown): PrimitiveSpan | undefined {
  const bounds = objectValue(value);
  const x = numberValue(bounds?.x, Number.NaN);
  const z = numberValue(bounds?.z, Number.NaN);
  const w = numberValue(bounds?.w, Number.NaN);
  const d = numberValue(bounds?.d, Number.NaN);
  if (![x, z, w, d].every(Number.isFinite)) return undefined;
  return { x1: x, z1: z, x2: x + w, z2: z + d };
}

function pixelBoundsToSpan(value: unknown): PrimitiveSpan | undefined {
  if (Array.isArray(value) && value.length >= 4 && value.every((item) => typeof item === 'number' && Number.isFinite(item))) {
    const [x1, z1, x2, z2] = value as number[];
    return { x1, z1, x2, z2 };
  }
  const bounds = objectValue(value);
  if (!bounds) return undefined;
  const x = numberValue(bounds.x, Number.NaN);
  const z = numberValue(bounds.z ?? bounds.y, Number.NaN);
  const w = numberValue(bounds.w ?? bounds.width, Number.NaN);
  const d = numberValue(bounds.d ?? bounds.h ?? bounds.height, Number.NaN);
  if (![x, z, w, d].every(Number.isFinite)) return undefined;
  return { x1: x, z1: z, x2: x + w, z2: z + d };
}

function idFor(prefix: string, item: Record<string, unknown>, index: number): string {
  return String(item.id ?? item.sourceAnchorId ?? `${prefix}-${index}`);
}

function primitiveWallLayer(item: Record<string, unknown>): DrawingPrimitiveLayer {
  const wallText = `${item.id ?? ''} ${item.wallKind ?? ''} ${item.kind ?? ''} ${item.type ?? ''}`;
  if (/glaz|window/i.test(wallText)) return 'window';
  if (/guard|rail/i.test(wallText)) return 'wall';
  if (/partition|interior-wall|exterior-wall|a-frame-wall|entry-low-wall/i.test(`${item.wallKind ?? ''} ${item.kind ?? ''} ${item.type ?? ''}`)) return 'wall';
  if (/dashed|void|open.to.below|overhead/i.test(wallText)) return 'dashedVoid';
  return 'wall';
}

function isSourcePrimitiveOverride(item: Record<string, unknown>): boolean {
  return item.source === 'source-image-primitive-override';
}

function gridSpanValue(item: Record<string, unknown>, scale = 4): PrimitiveSpan | undefined {
  const x1 = numberValue(item.x1, Number.NaN);
  const z1 = numberValue(item.z1, Number.NaN);
  const x2 = numberValue(item.x2, Number.NaN);
  const z2 = numberValue(item.z2, Number.NaN);
  if (![x1, z1, x2, z2].every(Number.isFinite)) return undefined;
  return { x1: x1 * scale, z1: z1 * scale, x2: x2 * scale, z2: z2 * scale };
}

function sourceOverridePrimitiveLayer(item: Record<string, unknown>): DrawingPrimitiveLayer {
  const text = `${item.id ?? ''} ${item.wallKind ?? ''} ${item.kind ?? ''} ${item.openingType ?? ''} ${item.type ?? ''}`;
  const semanticText = `${item.wallKind ?? ''} ${item.kind ?? ''} ${item.type ?? ''}`;
  if (/window|glaz/i.test(text)) return 'window';
  if (/guard|rail|partition|interior-wall|exterior-wall|a-frame-wall|entry-low-wall/i.test(semanticText)) return 'wall';
  if (/door|bifold|sliding|pocket|exterior|interior/i.test(text)) return 'door';
  if (/dashed|void|open.to.below|open-to-below|overhead/i.test(text)) return 'dashedVoid';
  return 'wall';
}

function isDashedVoidPrimitive(item: Record<string, unknown>): boolean {
  const text = `${item.id ?? ''} ${item.kind ?? ''} ${item.type ?? ''} ${item.symbolVariant ?? ''} ${item.role ?? ''} ${item.sourceKind ?? ''} ${item.elementType ?? ''}`.toLowerCase();
  return /dashed|void|open.to.below|open-to-below|open_to_below|overhead|cross/.test(text);
}

function breakSpanValue(value: unknown): PrimitiveSpan | undefined {
  if (Array.isArray(value)) {
    const [from, to] = value;
    if (Array.isArray(from) && Array.isArray(to) && typeof from[0] === 'number' && typeof from[1] === 'number' && typeof to[0] === 'number' && typeof to[1] === 'number') {
      return { x1: from[0], z1: from[1], x2: to[0], z2: to[1] };
    }
    return undefined;
  }
  const item = objectValue(value);
  if (!item) return undefined;
  const direct = spanValue(item.span);
  if (direct) return direct;
  const from = Array.isArray(item.from) ? item.from : undefined;
  const to = Array.isArray(item.to) ? item.to : undefined;
  if (from && to && typeof from[0] === 'number' && typeof from[1] === 'number' && typeof to[0] === 'number' && typeof to[1] === 'number') {
    return { x1: from[0], z1: from[1], x2: to[0], z2: to[1] };
  }
  return spanValue(item);
}

function collinearGapInterval(wall: PrimitiveSpan, gap: PrimitiveSpan, tolerance = 0.35): { start: number; end: number } | undefined {
  const horizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const wallMin = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
  const wallMax = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
  const wallLine = horizontal ? (wall.z1 + wall.z2) / 2 : (wall.x1 + wall.x2) / 2;
  const gapLine = horizontal ? (gap.z1 + gap.z2) / 2 : (gap.x1 + gap.x2) / 2;
  if (Math.abs(wallLine - gapLine) > tolerance) return undefined;
  const gapStart = horizontal ? Math.min(gap.x1, gap.x2) : Math.min(gap.z1, gap.z2);
  const gapEnd = horizontal ? Math.max(gap.x1, gap.x2) : Math.max(gap.z1, gap.z2);
  const start = Math.max(wallMin, gapStart);
  const end = Math.min(wallMax, gapEnd);
  return end - start > 0.05 ? { start, end } : undefined;
}

function splitPrimitiveWallSpan(wall: PrimitiveSpan, gaps: PrimitiveSpan[]): PrimitiveSpan[] {
  const horizontal = Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1);
  const wallStart = horizontal ? Math.min(wall.x1, wall.x2) : Math.min(wall.z1, wall.z2);
  const wallEnd = horizontal ? Math.max(wall.x1, wall.x2) : Math.max(wall.z1, wall.z2);
  const intervals = gaps
    .map((gap) => collinearGapInterval(wall, gap))
    .filter((gap): gap is { start: number; end: number } => Boolean(gap))
    .sort((a, b) => a.start - b.start);
  if (!intervals.length) return [wall];
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end + 0.05) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  const line = horizontal ? (wall.z1 + wall.z2) / 2 : (wall.x1 + wall.x2) / 2;
  const segments: PrimitiveSpan[] = [];
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

function sourceAnchorId(item: Record<string, unknown>): string | undefined {
  const anchor = objectValue(item.sourceAnchor);
  const id = item.sourceAnchorId ?? anchor?.id ?? item.id;
  return typeof id === 'string' ? id : undefined;
}

function isUsableSourceAnchor(anchor: Record<string, unknown> | null | undefined): anchor is Record<string, unknown> {
  if (!anchor) return false;
  const text = `${anchor.anchorKind ?? ''} ${anchor.kind ?? ''} ${anchor.source ?? ''}`.toLowerCase();
  return !/deterministic-plan-bounds|deterministic render|rendered-plan/.test(text);
}

function allSourceAnchors(source: Record<string, unknown>): Record<string, unknown>[] {
  return [
    ...arrayValue(source.sourceAnchors),
    ...floorPanels(source).flatMap((panel) => arrayValue(panel.sourceAnchors)),
  ].map(objectValue).filter((anchor): anchor is Record<string, unknown> => Boolean(anchor));
}

function sourceAnchorSpanFromAnchor(anchor: Record<string, unknown> | null | undefined): PrimitiveSpan | undefined {
  if (!isUsableSourceAnchor(anchor)) return undefined;
  return spanValue(anchor.span)
    ?? boundsToSpan(anchor.bounds)
    ?? pixelBoundsToSpan(anchor.pixelBounds)
    ?? boundsToSpan(anchor.planBounds);
}

function spanArea(span: PrimitiveSpan | undefined): number {
  if (!span) return 0;
  return Math.abs(span.x2 - span.x1) * Math.abs(span.z2 - span.z1);
}

function isAreaPrimitive(item: Record<string, unknown>): boolean {
  const text = `${item.id ?? ''} ${item.sourceAnchorId ?? ''} ${item.kind ?? ''} ${item.type ?? ''} ${item.fixtureKind ?? ''} ${item.symbolVariant ?? ''}`.toLowerCase();
  return /door|window|glaz|ladder|stair|fixture|furn|bed|sofa|chair|table|sink|toilet|tub|shower|range|washer|dryer|counter/.test(text);
}

function richerElementAnchorSpan(item: Record<string, unknown>, anchors: Record<string, unknown>[]): PrimitiveSpan | undefined {
  if (!isAreaPrimitive(item)) return undefined;
  const itemId = typeof item.id === 'string' ? item.id : undefined;
  if (!itemId) return undefined;
  const candidates = anchors
    .filter((anchor) => {
      const ids = [anchor.id, anchor.sourceAnchorId, anchor.elementId, anchor.targetId]
        .filter((id): id is string => typeof id === 'string');
      return ids.includes(itemId) || ids.some((id) => id === `${itemId}-anchor` || id.endsWith(`-${itemId}-anchor`));
    })
    .map((anchor) => sourceAnchorSpanFromAnchor(anchor))
    .filter((span): span is PrimitiveSpan => Boolean(span))
    .sort((a, b) => spanArea(b) - spanArea(a));
  return candidates[0];
}

function exactSourceAnchorSpan(source: Record<string, unknown>, anchorId: string): PrimitiveSpan | undefined {
  const anchor = allSourceAnchors(source)
    .find((candidate) => String(candidate.id ?? candidate.sourceAnchorId ?? candidate.elementId ?? '') === anchorId);
  return sourceAnchorSpanFromAnchor(anchor);
}

function pointValue(value: unknown): { x: number; z: number } | undefined {
  const point = objectValue(value);
  if (typeof point?.x !== 'number' || typeof point.z !== 'number') return undefined;
  return { x: point.x, z: point.z };
}

function mapPointLikeToFt(point: { x: number; z: number }, source: Record<string, unknown>, item: Record<string, unknown>, floor: number): { x: number; z: number } | undefined {
  const footprint = objectValue(source.footprint);
  const widthFt = numberValue(footprint?.widthFt ?? footprint?.width, 0);
  const depthFt = numberValue(footprint?.depthFt ?? footprint?.depth, 0);
  if (item.source === 'source-image-primitive-override') {
    return { x: point.x * 4, z: point.z * 4 };
  }
  const looksLikePixel = widthFt > 0 && depthFt > 0 && (Math.abs(point.x) > widthFt * 2 || Math.abs(point.z) > depthFt * 2);
  if (!looksLikePixel) return point;
  const frame = frameForPrimitive(source, item, floor);
  return frame ? mapSourcePointToFt(point, frame) ?? undefined : undefined;
}

function doorVisualSemanticSpan(item: Record<string, unknown>, source: Record<string, unknown>, floor: number): PrimitiveSpan | undefined {
  if (item.source === 'source-image-primitive-override') {
    const sourceBounds = boundsToSpan(item.sourceBounds);
    if (sourceBounds) {
      return {
        x1: sourceBounds.x1 * 4,
        z1: sourceBounds.z1 * 4,
        x2: sourceBounds.x2 * 4,
        z2: sourceBounds.z2 * 4,
      };
    }
  }
  const points = [
    pointValue(item.hingePoint),
    pointValue(item.leafClosedEnd),
    pointValue(item.leafOpenEnd),
  ]
    .filter((point): point is { x: number; z: number } => Boolean(point))
    .map((point) => mapPointLikeToFt(point, source, item, floor))
    .filter((point): point is { x: number; z: number } => Boolean(point));
  if (points.length < 2) return undefined;
  const minX = Math.min(...points.map((point) => point.x));
  const minZ = Math.min(...points.map((point) => point.z));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxZ = Math.max(...points.map((point) => point.z));
  return { x1: minX, z1: minZ, x2: maxX, z2: maxZ };
}

function visualPrimitiveLayer(layer: DrawingPrimitiveLayer): boolean {
  return layer === 'fixture' || layer === 'ladder';
}

function pushPrimitive(
  primitives: DrawingPrimitive[],
  layer: DrawingPrimitiveLayer,
  prefix: string,
  item: Record<string, unknown>,
  index: number,
  source: Record<string, unknown>,
): void {
  const floor = numberValue(item.floor ?? item.levelIndex, 0);
  const directSemanticSpan = layer === 'dimension'
    ? undefined
    : layer === 'door'
      ? doorVisualSemanticSpan(item, source, floor) ?? spanValue(item.span) ?? boundsToSpan(item.bounds)
      : visualPrimitiveLayer(layer)
        ? boundsToSpan(item.bounds) ?? spanValue(item.span)
        : spanValue(item.span) ?? boundsToSpan(item.bounds);
  const sourceSpanFt = sourceAnchorSpanFt(item, source, directSemanticSpan, floor, layer);
  // Keep source evidence and rendered geometry separate. Source anchors describe
  // the GPT proposal glyph footprint; semantic spans describe what our renderer
  // will draw from JSON. Collapsing them makes fixture/ladder drift invisible.
  const semanticSpan = directSemanticSpan;
  primitives.push({
    id: idFor(prefix, item, index),
    layer,
    floor,
    sourceAnchorId: sourceAnchorId(item),
    sourceKind: String(item.wallKind ?? item.openingKind ?? item.fixtureKind ?? item.kind ?? item.type ?? ''),
    role: String(item.facing ?? item.role ?? ''),
    semanticSpan,
    sourceSpanFt: sourceSpanFt ?? sourceAnchorSpanFt(item, source, semanticSpan, floor, layer),
  });
}

function floorPanels(source: Record<string, unknown>): Record<string, unknown>[] {
  return arrayValue(source.floorPanels).map(objectValue).filter((panel): panel is Record<string, unknown> => Boolean(panel));
}

function semanticExtentForFloor(source: Record<string, unknown>, floor: number): { x: number; z: number; w: number; d: number } | null {
  const spans = [
    ...arrayValue(source.exteriorWalls),
    ...arrayValue(source.interiorWalls),
    ...arrayValue(source.openings),
    ...arrayValue(source.doors),
    ...arrayValue(source.windows),
  ]
    .map(objectValue)
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .filter((value) => numberValue(value.floor ?? value.levelIndex, 0) === floor)
    .map((value) => spanValue(value.span))
    .filter((value): value is PrimitiveSpan => Boolean(value));
  if (!spans.length) return null;
  const xs = spans.flatMap((span) => [span.x1, span.x2]);
  const zs = spans.flatMap((span) => [span.z1, span.z2]);
  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const z1 = Math.min(...zs);
  const z2 = Math.max(...zs);
  if (![x1, x2, z1, z2].every(Number.isFinite) || x2 - x1 <= 0 || z2 - z1 <= 0) return null;
  return { x: x1, z: z1, w: x2 - x1, d: z2 - z1 };
}

function sourceFrameSpanForItem(source: Record<string, unknown>, item: Record<string, unknown>): PrimitiveSpan | undefined {
  const anchorId = sourceAnchorId(item);
  if (!anchorId) return undefined;
  const anchors = [
    ...arrayValue(source.sourceAnchors),
    ...floorPanels(source).flatMap((panel) => arrayValue(panel.sourceAnchors)),
  ];
  const directAnchor = anchors
    .map(objectValue)
    .find((anchor) => anchor && String(anchor.id ?? anchor.sourceAnchorId ?? anchor.elementId ?? '') === anchorId);
  const direct = spanValue(directAnchor?.span)
    ?? boundsToSpan(directAnchor?.bounds)
    ?? pixelBoundsToSpan(directAnchor?.pixelBounds)
    ?? boundsToSpan(directAnchor?.planBounds);
  if (direct) return direct;
  const segmentSpans = anchors
    .map(objectValue)
    .filter((anchor): anchor is Record<string, unknown> => Boolean(anchor))
    .filter((anchor) => String(anchor.id ?? anchor.sourceAnchorId ?? anchor.elementId ?? '').startsWith(`${anchorId}:seg-`))
    .map((anchor) => spanValue(anchor.span) ?? boundsToSpan(anchor.bounds) ?? pixelBoundsToSpan(anchor.pixelBounds) ?? boundsToSpan(anchor.planBounds))
    .filter((span): span is PrimitiveSpan => Boolean(span));
  if (!segmentSpans.length) return undefined;
  const xs = segmentSpans.flatMap((span) => [span.x1, span.x2]);
  const zs = segmentSpans.flatMap((span) => [span.z1, span.z2]);
  return { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
}

function buildingFrameForFloor(source: Record<string, unknown>, floor: number): SourceFrame | null {
  const walls = arrayValue(source.exteriorWalls)
    .map(objectValue)
    .filter((wall): wall is Record<string, unknown> => Boolean(wall))
    .filter((wall) => numberValue(wall.floor ?? wall.levelIndex, 0) === floor)
    .filter((wall) => !/deck-edge|deck-rail|porch-edge|patio-edge|stoop-edge/i.test(`${wall.id ?? ''} ${wall.kind ?? ''} ${wall.type ?? ''} ${wall.symbolVariant ?? ''}`));
  const semanticSpans = walls.map((wall) => spanValue(wall.span)).filter((span): span is PrimitiveSpan => Boolean(span));
  const sourceSpans = walls.map((wall) => sourceFrameSpanForItem(source, wall)).filter((span): span is PrimitiveSpan => Boolean(span));
  if (!semanticSpans.length || !sourceSpans.length) return null;
  const semanticXs = semanticSpans.flatMap((span) => [span.x1, span.x2]);
  const semanticZs = semanticSpans.flatMap((span) => [span.z1, span.z2]);
  const sourceXs = sourceSpans.flatMap((span) => [span.x1, span.x2]);
  const sourceZs = sourceSpans.flatMap((span) => [span.z1, span.z2]);
  const xFt = Math.min(...semanticXs);
  const zFt = Math.min(...semanticZs);
  const widthFt = Math.max(...semanticXs) - xFt;
  const depthFt = Math.max(...semanticZs) - zFt;
  const x1 = Math.min(...sourceXs);
  const z1 = Math.min(...sourceZs);
  const x2 = Math.max(...sourceXs);
  const z2 = Math.max(...sourceZs);
  if (widthFt <= 0 || depthFt <= 0 || x2 <= x1 || z2 <= z1) return null;
  return { sourceFrame: { x1, z1, x2, z2 }, widthFt, depthFt, xFt, zFt };
}

function frameForPrimitive(source: Record<string, unknown>, item: Record<string, unknown>, floor: number): SourceFrame | null {
  const itemText = `${item.id ?? ''} ${item.kind ?? ''} ${item.type ?? ''} ${item.wallKind ?? ''} ${item.symbolVariant ?? ''}`;
  const usesExteriorAuxiliaryFrame = /deck-edge|deck-rail|porch-edge|patio-edge|stoop-edge/i.test(itemText);
  const buildingFrame = usesExteriorAuxiliaryFrame ? null : buildingFrameForFloor(source, floor);
  if (buildingFrame) return buildingFrame;
  const panels = floorPanels(source);
  const levelFrameId = item.levelFrameId;
  const byId = typeof levelFrameId === 'string'
    ? panels.find((panel) => panel.id === levelFrameId)
    : undefined;
  const panel = byId
    ?? panels.find((candidate) => numberValue(candidate.floor ?? candidate.levelIndex, 0) === floor && arrayValue(candidate.sourceAnchors).length > 0)
    ?? panels.find((candidate) => numberValue(candidate.floor ?? candidate.levelIndex, 0) === floor);
  if (!panel) return null;
  const footprint = objectValue(panel.footprint);
  let widthFt = numberValue(footprint?.widthFt ?? footprint?.width ?? footprint?.w, 0);
  let depthFt = numberValue(footprint?.depthFt ?? footprint?.depth ?? footprint?.d, 0);
  let xFt = numberValue(footprint?.x, 0);
  let zFt = numberValue(footprint?.z, 0);
  const semanticExtent = semanticExtentForFloor(source, floor);
  if (
    semanticExtent &&
    (
      semanticExtent.x < xFt - 0.5 ||
      semanticExtent.z < zFt - 0.5 ||
      semanticExtent.w > widthFt + 0.75 ||
      semanticExtent.d > depthFt + 0.75
    )
  ) {
    xFt = semanticExtent.x;
    zFt = semanticExtent.z;
    widthFt = semanticExtent.w;
    depthFt = semanticExtent.d;
  }
  const anchors = arrayValue(panel.sourceAnchors).map(objectValue).filter((anchor): anchor is Record<string, unknown> => Boolean(anchor));
  const footprintAnchor = anchors.find((anchor) => /levelFootprint|footprint/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`));
  const fallbackAnchor = anchors.find((anchor) => spanValue(anchor.span) || boundsToSpan(anchor.bounds) || pixelBoundsToSpan(anchor.pixelBounds));
  const sourceFrame = spanValue(footprintAnchor?.span)
    ?? boundsToSpan(footprintAnchor?.bounds)
    ?? pixelBoundsToSpan(footprintAnchor?.pixelBounds)
    ?? spanValue(fallbackAnchor?.span)
    ?? boundsToSpan(fallbackAnchor?.bounds)
    ?? pixelBoundsToSpan(fallbackAnchor?.pixelBounds);
  if (!widthFt || !depthFt || !sourceFrame) return null;
  return { sourceFrame, widthFt, depthFt, xFt, zFt };
}

function footprintFrameForPrimitive(source: Record<string, unknown>): SourceFrame | null {
  const footprint = objectValue(source.footprint);
  const widthFt = numberValue(footprint?.widthFt ?? footprint?.width ?? footprint?.w, 0);
  const depthFt = numberValue(footprint?.depthFt ?? footprint?.depth ?? footprint?.d, 0);
  const xFt = numberValue(footprint?.x, 0);
  const zFt = numberValue(footprint?.z, 0);
  const sourceFrame = pixelBoundsToSpan(objectValue(footprint?.sourceAnchor)?.pixelBounds)
    ?? pixelBoundsToSpan(objectValue(source.coordinateSystem)?.planPixelBounds);
  if (!widthFt || !depthFt || !sourceFrame) return null;
  return { sourceFrame, widthFt, depthFt, xFt, zFt };
}

function mapSourcePointToFt(point: { x: number; z: number }, frame: SourceFrame) {
  const widthPx = frame.sourceFrame.x2 - frame.sourceFrame.x1;
  const depthPx = frame.sourceFrame.z2 - frame.sourceFrame.z1;
  if (Math.abs(widthPx) < 0.001 || Math.abs(depthPx) < 0.001) return null;
  return {
    x: frame.xFt + ((point.x - frame.sourceFrame.x1) / widthPx) * frame.widthFt,
    z: frame.zFt + ((point.z - frame.sourceFrame.z1) / depthPx) * frame.depthFt,
  };
}

function mapSourceAxisSpanToFt(
  sourceSpan: PrimitiveSpan,
  frame: SourceFrame,
  horizontal: boolean,
): PrimitiveSpan | undefined {
  const xMin = Math.min(sourceSpan.x1, sourceSpan.x2);
  const xMax = Math.max(sourceSpan.x1, sourceSpan.x2);
  const zMin = Math.min(sourceSpan.z1, sourceSpan.z2);
  const zMax = Math.max(sourceSpan.z1, sourceSpan.z2);
  const a = horizontal
    ? mapSourcePointToFt({ x: xMin, z: (zMin + zMax) / 2 }, frame)
    : mapSourcePointToFt({ x: (xMin + xMax) / 2, z: zMin }, frame);
  const b = horizontal
    ? mapSourcePointToFt({ x: xMax, z: (zMin + zMax) / 2 }, frame)
    : mapSourcePointToFt({ x: (xMin + xMax) / 2, z: zMax }, frame);
  if (!a || !b) return undefined;
  return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
}

function projectedSourceSegmentFt(
  fullSourceSpan: PrimitiveSpan,
  frame: SourceFrame,
  originalSpan: PrimitiveSpan | undefined,
  semanticSpan: PrimitiveSpan | undefined,
): PrimitiveSpan | undefined {
  if (!originalSpan || !semanticSpan) return undefined;
  const diagonalOriginal = Math.abs(originalSpan.x2 - originalSpan.x1) > 0.2 && Math.abs(originalSpan.z2 - originalSpan.z1) > 0.2;
  if (diagonalOriginal) return undefined;
  const horizontal = Math.abs(originalSpan.x2 - originalSpan.x1) >= Math.abs(originalSpan.z2 - originalSpan.z1);
  const originalStart = horizontal ? Math.min(originalSpan.x1, originalSpan.x2) : Math.min(originalSpan.z1, originalSpan.z2);
  const originalEnd = horizontal ? Math.max(originalSpan.x1, originalSpan.x2) : Math.max(originalSpan.z1, originalSpan.z2);
  const semanticStart = horizontal ? Math.min(semanticSpan.x1, semanticSpan.x2) : Math.min(semanticSpan.z1, semanticSpan.z2);
  const semanticEnd = horizontal ? Math.max(semanticSpan.x1, semanticSpan.x2) : Math.max(semanticSpan.z1, semanticSpan.z2);
  const originalLength = originalEnd - originalStart;
  if (originalLength <= 0.001) return undefined;
  const full = mapSourceAxisSpanToFt(fullSourceSpan, frame, horizontal);
  if (!full) return undefined;
  const ratioA = Math.max(0, Math.min(1, (semanticStart - originalStart) / originalLength));
  const ratioB = Math.max(0, Math.min(1, (semanticEnd - originalStart) / originalLength));
  const pointAt = (ratio: number) => ({
    x: full.x1 + (full.x2 - full.x1) * ratio,
    z: full.z1 + (full.z2 - full.z1) * ratio,
  });
  const a = pointAt(ratioA);
  const b = pointAt(ratioB);
  return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
}

function sourceAnchorSpan(item: Record<string, unknown>, source: Record<string, unknown>): PrimitiveSpan | undefined {
  const anchorId = sourceAnchorId(item);
  const anchors = allSourceAnchors(source);
  const richElementSpan = richerElementAnchorSpan(item, anchors);
  if (richElementSpan) return richElementSpan;
  if (anchorId) {
    for (const anchor of anchors) {
      if (String(anchor.id ?? anchor.sourceAnchorId ?? anchor.elementId ?? '') !== anchorId) continue;
      const span = sourceAnchorSpanFromAnchor(anchor);
      if (span) return span;
    }
  }
  const direct = objectValue(item.sourceAnchor);
  const directId = direct ? String(direct.id ?? direct.sourceAnchorId ?? direct.elementId ?? '') : '';
  const directSpan = (!anchorId || !directId || directId === anchorId)
    ? sourceAnchorSpanFromAnchor(direct)
    : undefined;
  if (directSpan) return directSpan;
  if (!anchorId) return undefined;
  const segmentSpans = anchors
    .filter((anchor): anchor is Record<string, unknown> => {
      if (!anchor || !isUsableSourceAnchor(anchor)) return false;
      const id = String(anchor.id ?? anchor.sourceAnchorId ?? anchor.elementId ?? '');
      return id.startsWith(`${anchorId}:seg-`);
    })
    .map((anchor) => spanValue(anchor.span) ?? boundsToSpan(anchor.bounds) ?? pixelBoundsToSpan(anchor.pixelBounds) ?? boundsToSpan(anchor.planBounds))
    .filter((span): span is PrimitiveSpan => Boolean(span));
  if (segmentSpans.length) {
    const xs = segmentSpans.flatMap((span) => [span.x1, span.x2]);
    const zs = segmentSpans.flatMap((span) => [span.z1, span.z2]);
    return { x1: Math.min(...xs), z1: Math.min(...zs), x2: Math.max(...xs), z2: Math.max(...zs) };
  }
  const parentAnchorId = anchorId.replace(/:seg-\d+$/, '');
  if (parentAnchorId !== anchorId) {
    for (const anchor of anchors) {
      if (String(anchor.id ?? anchor.sourceAnchorId ?? anchor.elementId ?? '') !== parentAnchorId) continue;
      const span = sourceAnchorSpanFromAnchor(anchor);
      if (span) return span;
    }
  }
  return undefined;
}

function sourceAnchorSpanFt(
  item: Record<string, unknown>,
  source: Record<string, unknown>,
  semanticSpan: PrimitiveSpan | undefined,
  floor: number,
  layer: DrawingPrimitiveLayer,
): PrimitiveSpan | undefined {
  if (isSourcePrimitiveOverride(item)) {
    return semanticSpan ?? gridSpanValue(item) ?? spanValue(item.span) ?? boundsToSpan(item.bounds);
  }
  const span = sourceAnchorSpan(item, source);
  const frame = frameForPrimitive(source, item, floor) ?? footprintFrameForPrimitive(source);
  if (!span || !frame) return undefined;
  const anchorId = sourceAnchorId(item);
  const hasExactSegmentAnchor = typeof anchorId === 'string'
    && /:seg-\d+$/i.test(anchorId)
    && Boolean(exactSourceAnchorSpan(source, anchorId));
  const projectedSegment = hasExactSegmentAnchor
    ? undefined
    : projectedSourceSegmentFt(span, frame, spanValue(item.originalSpan), semanticSpan);
  if (projectedSegment && (layer === 'wall' || layer === 'window' || layer === 'dashedVoid')) {
    return projectedSegment;
  }
  const xMin = Math.min(span.x1, span.x2);
  const xMax = Math.max(span.x1, span.x2);
  const zMin = Math.min(span.z1, span.z2);
  const zMax = Math.max(span.z1, span.z2);
  if (layer === 'fixture' || layer === 'ladder' || layer === 'door') {
    const a = mapSourcePointToFt({ x: xMin, z: zMin }, frame);
    const b = mapSourcePointToFt({ x: xMax, z: zMax }, frame);
    if (!a || !b) return undefined;
    return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
  }
  const diagonal = semanticSpan
    ? Math.abs(semanticSpan.x2 - semanticSpan.x1) > 0.2 && Math.abs(semanticSpan.z2 - semanticSpan.z1) > 0.2
    : Math.abs(xMax - xMin) > 4 && Math.abs(zMax - zMin) > 4;
  if (diagonal) {
    const a = mapSourcePointToFt({ x: span.x1, z: span.z1 }, frame);
    const b = mapSourcePointToFt({ x: span.x2, z: span.z2 }, frame);
    if (!a || !b) return undefined;
    return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
  }
  const horizontal = semanticSpan
    ? Math.abs(semanticSpan.x2 - semanticSpan.x1) >= Math.abs(semanticSpan.z2 - semanticSpan.z1)
    : Math.abs(xMax - xMin) >= Math.abs(zMax - zMin);
  const vertical = semanticSpan
    ? Math.abs(semanticSpan.z2 - semanticSpan.z1) > Math.abs(semanticSpan.x2 - semanticSpan.x1)
    : Math.abs(zMax - zMin) > Math.abs(xMax - xMin);
  const a = vertical
    ? mapSourcePointToFt({ x: (xMin + xMax) / 2, z: zMin }, frame)
    : mapSourcePointToFt({ x: xMin, z: horizontal ? (zMin + zMax) / 2 : zMin }, frame);
  const b = vertical
    ? mapSourcePointToFt({ x: (xMin + xMax) / 2, z: zMax }, frame)
    : mapSourcePointToFt({ x: xMax, z: horizontal ? (zMin + zMax) / 2 : zMax }, frame);
  if (!a || !b) return undefined;
  return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
}

export function emptyDrawingPrimitiveCounts(): DrawingPrimitiveCounts {
  return {
    wall: 0,
    ladder: 0,
    door: 0,
    window: 0,
    dashedVoid: 0,
    dimension: 0,
    fixture: 0,
  };
}

export function countDrawingPrimitives(primitives: DrawingPrimitive[]): DrawingPrimitiveCounts {
  const counts = emptyDrawingPrimitiveCounts();
  for (const primitive of primitives) counts[primitive.layer] += 1;
  return counts;
}

export function extractSourceDrawingPrimitives(artifact: unknown): DrawingPrimitive[] {
  const source = objectValue(artifact);
  if (!source) return [];
  const primitives: DrawingPrimitive[] = [];

  const sourceWallOverrides = arrayValue(source.sourceWalls).map(objectValue).filter((wall): wall is Record<string, unknown> => Boolean(wall));
  if (sourceWallOverrides.length) {
    for (const [index, wall] of sourceWallOverrides.entries()) {
      const span = gridSpanValue(wall);
      if (!span) continue;
      const layer = sourceOverridePrimitiveLayer(wall);
      pushPrimitive(
        primitives,
        layer === 'door' ? 'wall' : layer,
        layer === 'dashedVoid' ? 'source-override-void' : layer === 'window' ? 'source-override-window' : 'source-override-wall',
        { ...wall, span },
        index,
        source,
      );
    }
  }

  const sourceOpeningOverrides = arrayValue(source.sourceOpenings).map(objectValue).filter((opening): opening is Record<string, unknown> => Boolean(opening));
  if (sourceOpeningOverrides.length) {
    for (const [index, opening] of sourceOpeningOverrides.entries()) {
      const span = gridSpanValue(opening) ?? spanValue(opening.span);
      if (!span) continue;
      const layer = sourceOverridePrimitiveLayer(opening);
      if (layer !== 'door' && layer !== 'window') continue;
      pushPrimitive(
        primitives,
        layer,
        `source-override-${layer}`,
        { ...opening, span },
        index,
        source,
      );
    }
  }

  if (!sourceWallOverrides.length) for (const [index, rawWall] of [
    ...arrayValue(source.exteriorWalls),
    ...arrayValue(source.interiorWalls),
  ].entries()) {
    const wall = objectValue(rawWall);
    if (!wall || !hasSpan(wall.span)) continue;
    const layer = primitiveWallLayer(wall);
    const wallId = typeof wall.id === 'string' ? wall.id : undefined;
    const gaps = layer === 'window' ? [] : [
      ...arrayValue(wall.breaks).map(breakSpanValue).filter((span): span is PrimitiveSpan => Boolean(span)),
      ...arrayValue(source.doors).map(objectValue).filter((item): item is Record<string, unknown> => item !== null && item.wallId === wallId).map((item) => spanValue(item.span)).filter((span): span is PrimitiveSpan => Boolean(span)),
      ...arrayValue(source.openings).map(objectValue).filter((item): item is Record<string, unknown> => item !== null && item.wallId === wallId).map((item) => spanValue(item.span)).filter((span): span is PrimitiveSpan => Boolean(span)),
      ...arrayValue(source.windows).map(objectValue).filter((item): item is Record<string, unknown> => item !== null && item.wallId === wallId).map((item) => spanValue(item.span)).filter((span): span is PrimitiveSpan => Boolean(span)),
    ];
    const segments = splitPrimitiveWallSpan(spanValue(wall.span)!, gaps);
    segments.forEach((segment, segmentIndex) => {
      const id = segments.length > 1 ? `${wall.id ?? 'wall'}:seg-${segmentIndex + 1}` : wall.id;
      const segmentSourceAnchorId = segments.length > 1
        ? String(id ?? wall.sourceAnchorId ?? '')
        : typeof wall.sourceAnchorId === 'string'
          ? wall.sourceAnchorId
          : typeof id === 'string'
            ? id
            : undefined;
      pushPrimitive(
        primitives,
        layer,
        layer === 'dashedVoid' ? 'dashed-void' : layer === 'window' ? 'wall-window' : 'wall',
        { ...wall, id, sourceAnchorId: segmentSourceAnchorId, span: segment, originalSpan: wall.span },
        index + segmentIndex,
        source,
      );
    });
  }

  if (!sourceOpeningOverrides.length) for (const [index, rawOpening] of arrayValue(source.openings).entries()) {
    const opening = objectValue(rawOpening);
    if (!opening || !hasSpan(opening.span)) continue;
    const text = `${opening.id ?? ''} ${opening.openingKind ?? ''} ${opening.type ?? ''}`;
    const matchesSemanticDoor = arrayValue(source.doors)
      .map(objectValue)
      .some((door) => door !== null && door.wallId === opening.wallId && JSON.stringify(door.span) === JSON.stringify(opening.span));
    if (matchesSemanticDoor || /travel|clearance|swing.trace/i.test(text)) continue;
    if (/window|glass|glaz/i.test(text)) pushPrimitive(primitives, 'window', 'opening-window', opening, index, source);
    else if (/door/i.test(text)) pushPrimitive(primitives, 'door', 'opening-door', opening, index, source);
  }

  if (!sourceOpeningOverrides.length) for (const [index, rawDoor] of arrayValue(source.doors).entries()) {
    const door = objectValue(rawDoor);
    if (!door || !hasSpan(door.span)) continue;
    pushPrimitive(primitives, 'door', 'door', door, index, source);
  }

  if (!sourceOpeningOverrides.length) for (const [index, rawWindow] of arrayValue(source.windows).entries()) {
    const window = objectValue(rawWindow);
    if (!window || !hasSpan(window.span)) continue;
    pushPrimitive(primitives, 'window', 'window', window, index, source);
  }

  for (const [index, rawSpaceFace] of arrayValue(source.spaceFaces).entries()) {
    const spaceFace = objectValue(rawSpaceFace);
    if (!spaceFace || !isDashedVoidPrimitive(spaceFace)) continue;
    pushPrimitive(primitives, 'dashedVoid', 'spaceface-void', spaceFace, index, source);
  }

  for (const [index, rawRoom] of arrayValue(source.rooms).entries()) {
    const room = objectValue(rawRoom);
    if (!room || !isDashedVoidPrimitive(room)) continue;
    const hasSpaceFace = arrayValue(source.spaceFaces)
      .map(objectValue)
      .some((spaceFace) => spaceFace && String(spaceFace.roomId ?? '') === String(room.id ?? ''));
    if (hasSpaceFace) continue;
    pushPrimitive(primitives, 'dashedVoid', 'room-void', room, index, source);
  }

  for (const [index, rawFixture] of arrayValue(source.fixtures).entries()) {
    const fixture = objectValue(rawFixture);
    if (!fixture) continue;
    const text = `${fixture.id ?? ''} ${fixture.fixtureKind ?? ''} ${fixture.type ?? ''} ${fixture.symbolVariant ?? ''}`;
    if (/exterior[_\s-]*stoop|deck|porch|patio/i.test(text)) continue;
    if (isDashedVoidPrimitive(fixture)) continue;
    pushPrimitive(primitives, /ladder|stair/i.test(text) ? 'ladder' : 'fixture', 'fixture', fixture, index, source);
  }

  const dimensionLines = arrayValue(source.dimensionLines);
  if (!dimensionLines.length) {
    for (const [panelIndex, rawPanel] of arrayValue(source.floorPanels).entries()) {
      const panel = objectValue(rawPanel);
      if (!panel) continue;
      for (const [anchorIndex, rawAnchor] of arrayValue(panel.sourceAnchors).entries()) {
        const anchor = objectValue(rawAnchor);
        if (!anchor) continue;
        if (!/dimension/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`)) continue;
        pushPrimitive(primitives, 'dimension', `floor-${panelIndex}-dimension`, anchor, anchorIndex, source);
      }
    }
  }

  for (const [index, rawDimension] of dimensionLines.entries()) {
    const dimension = objectValue(rawDimension);
    if (!dimension) continue;
    pushPrimitive(primitives, 'dimension', 'dimension', dimension, index, source);
  }

  return primitives;
}

function spanLength(span: PrimitiveSpan): number {
  return Math.hypot(span.x2 - span.x1, span.z2 - span.z1);
}

function center(span: PrimitiveSpan): { x: number; z: number } {
  return { x: (span.x1 + span.x2) / 2, z: (span.z1 + span.z2) / 2 };
}

function spanBox(span: PrimitiveSpan): { x: number; z: number; w: number; d: number } {
  return {
    x: Math.min(span.x1, span.x2),
    z: Math.min(span.z1, span.z2),
    w: Math.abs(span.x2 - span.x1),
    d: Math.abs(span.z2 - span.z1),
  };
}

function endpointDrift(a: PrimitiveSpan, b: PrimitiveSpan): number {
  const direct = Math.max(
    Math.hypot(a.x1 - b.x1, a.z1 - b.z1),
    Math.hypot(a.x2 - b.x2, a.z2 - b.z2),
  );
  const reversed = Math.max(
    Math.hypot(a.x1 - b.x2, a.z1 - b.z2),
    Math.hypot(a.x2 - b.x1, a.z2 - b.z1),
  );
  return Math.min(direct, reversed);
}

function primitiveTolerance(layer: DrawingPrimitiveLayer): number {
  if (layer === 'wall') return 0.35;
  if (layer === 'door' || layer === 'window') return 0.3;
  if (layer === 'ladder' || layer === 'dashedVoid') return 0.4;
  if (layer === 'fixture') return 0.6;
  return 0.75;
}

function isAreaSymbolLayer(layer: DrawingPrimitiveLayer): boolean {
  return layer === 'door' || layer === 'fixture';
}

export function diffSourceToSemanticDrawingPrimitives(artifact: unknown): DrawingPrimitiveGeometryDiff[] {
  return extractSourceDrawingPrimitives(artifact)
    .filter((primitive) => primitive.semanticSpan && primitive.sourceSpanFt)
    .map((primitive) => {
      const semantic = primitive.semanticSpan!;
      const source = primitive.sourceSpanFt!;
      const centerA = center(semantic);
      const centerB = center(source);
      const centerDriftFt = Math.hypot(centerA.x - centerB.x, centerA.z - centerB.z);
      const maxEndpointDriftFt = isAreaSymbolLayer(primitive.layer)
        ? centerDriftFt
        : endpointDrift(semantic, source);
      const lengthDeltaFt = isAreaSymbolLayer(primitive.layer)
        ? (() => {
            const semanticBox = spanBox(semantic);
            const sourceBox = spanBox(source);
            return Math.max(
              Math.abs(semanticBox.w - sourceBox.w),
              Math.abs(semanticBox.d - sourceBox.d),
            );
          })()
        : Math.abs(spanLength(semantic) - spanLength(source));
      const tolerance = primitiveTolerance(primitive.layer);
      const drift = Math.max(maxEndpointDriftFt, centerDriftFt, lengthDeltaFt);
      const severity = drift > tolerance * 2.2
        ? 'blocked'
        : drift > tolerance
          ? 'warning'
          : 'pass';
      return {
        id: primitive.id,
        layer: primitive.layer,
        floor: primitive.floor,
        sourceAnchorId: primitive.sourceAnchorId,
        maxEndpointDriftFt,
        centerDriftFt,
        lengthDeltaFt,
        severity,
        description: `${primitive.layer} ${primitive.id} source/render primitive drift: endpoints ${maxEndpointDriftFt.toFixed(2)} ft, center ${centerDriftFt.toFixed(2)} ft, length ${lengthDeltaFt.toFixed(2)} ft`,
      };
    });
}

export function diffDrawingPrimitiveCounts(
  expected: DrawingPrimitiveCounts,
  rendered: Partial<Record<DrawingPrimitiveLayer, number>>,
): DrawingPrimitiveDiff[] {
  return DRAWING_PRIMITIVE_LAYERS.map((layer) => {
    const expectedCount = expected[layer] ?? 0;
    const renderedCount = rendered[layer] ?? 0;
    const missing = Math.max(0, expectedCount - renderedCount);
    const extra = Math.max(0, renderedCount - expectedCount);
    const tolerance = layer === 'fixture' ? 2 : layer === 'wall' || layer === 'dashedVoid' ? 1 : 0;
    const severity = missing > tolerance
      ? 'blocked'
      : extra > tolerance + 2
        ? 'warning'
        : 'pass';
    return { layer, expected: expectedCount, rendered: renderedCount, missing, extra, severity };
  });
}
