import type {
  DenHome,
  DrawingStyleProfile,
  ModularComponent,
  PairedPlanArtifactInfo,
  RoomConnection,
  RoomFixture,
  RoomLayout,
  RoofElevation,
  RoofPlane,
  RoofSemantics,
  SourceOpeningSegment,
  SourceDimensionLine,
  SourceWallSegment,
  SourceSpaceFace,
} from './types';
import { validateBuildability } from './build-validator';

export let components: ModularComponent[] = [];
export let coverage: Record<string, Record<string, boolean>> = {};
export let homes: DenHome[] = [];
export let pairedManifest: ProposalManifest | null = null;
export let pairedGenerationQueue: PairedGenerationQueue | null = null;

const ROOM_COLORS: Record<string, string> = {
  entry: '#d9d1c3',
  kitchen: '#f3e7b6',
  dining: '#e7d3a3',
  living: '#f1ead9',
  great_room: '#f1ead9',
  bedroom: '#dbe7f3',
  primary_bed: '#d3e2f2',
  bathroom_full: '#d9eff0',
  bathroom_half: '#d9eff0',
  ensuite: '#d9eff0',
  closet: '#e7e1d7',
  hallway: '#e5e0d7',
  stairs: '#e1ddd4',
  utility: '#e6e1d7',
  laundry: '#e6e1d7',
  deck: '#ead6b5',
  porch: '#ead6b5',
  office: '#e9ddf2',
};

const EXTERIOR_HELPER_ROOM_PATTERN = /exterior|eave|clearance/i;

type Span = { x1: number; z1: number; x2: number; z2: number };
type PointTuple = [number, number];
type WallBreak = Span | [PointTuple, PointTuple] | { span?: Span; from?: PointTuple; to?: PointTuple; x1?: number; z1?: number; x2?: number; z2?: number };
type PairedWall = {
  id?: string;
  floor?: number;
  span: Span;
  bounds?: { x: number; z: number; w: number; d: number };
  thickness?: number;
  thicknessFt?: number;
  wallKind?: string;
  kind?: string;
  type?: string;
  breaks?: WallBreak[];
  sourceAnchorId?: string;
  sourceAnchor?: { pixelBounds?: unknown; bounds?: { x: number; z: number; w: number; d: number }; span?: Span };
};

type PairedArtifact = {
  schemaVersion?: string;
  planId: string;
  proposalId: string;
  name?: string;
  footprint: {
    width?: number;
    depth?: number;
    widthFt?: number;
    depthFt?: number;
    polygon?: Array<{ x: number; z: number }>;
  };
  floorPanels?: Array<{
    id?: string;
    floor?: number;
    levelIndex?: number;
    footprint?: {
      widthFt?: number;
      depthFt?: number;
      width?: number;
      depth?: number;
      w?: number;
      d?: number;
      polygon?: Array<{ x: number; z: number }>;
    };
    bounds?: { x: number; z: number; w: number; d: number };
    footprintBounds?: { x: number; z: number; w: number; d: number };
    panelBounds?: { x: number; z: number; w: number; d: number };
    drawingBounds?: { x: number; z: number; w: number; d: number };
    interiorBounds?: { x: number; z: number; w: number; d: number };
    span?: Span;
    sourceAnchors?: Array<{
      id?: string;
      kind?: string;
      span?: Span;
      bounds?: { x: number; z: number; w: number; d: number };
    }>;
  }>;
  sourceAnchors?: Array<{
    id?: string;
    sourceAnchorId?: string;
    elementId?: string;
    targetId?: string;
    targetKind?: string;
    elementType?: string;
    label?: string;
    text?: string;
    floor?: number;
    span?: Span;
    bounds?: { x: number; z: number; w: number; d: number };
    pixelBounds?: unknown;
  }>;
  rooms: Array<{
    id: string;
    label: string;
    type: string;
    floor?: number;
    polygon?: Array<{ x: number; z: number }>;
    labelAnchor?: { x: number; z: number };
    bounds?: { x: number; z: number; w: number; d: number };
  }>;
  spaceFaces?: Array<{
    id: string;
    floor?: number;
    levelId?: string;
    roomId?: string;
    roomIds?: string[];
    kind?: string;
    type?: string;
    symbolVariant?: string;
    polygon?: Array<{ x: number; z: number }>;
    bounds?: { x: number; z: number; w: number; d: number };
    parts?: Array<{ gx?: number; gz?: number; gw?: number; gd?: number; x?: number; z?: number; w?: number; d?: number }>;
    sourceAnchorId?: string;
    sourceAnchorIds?: string[];
    source?: string;
  }>;
  exteriorWalls?: PairedWall[];
  interiorWalls?: PairedWall[];
  openings?: Array<{
    id?: string;
    wallId?: string;
    openingKind?: string;
    fromRoomId?: string;
    toRoomId?: string;
    roomIds?: string[];
    type?: string;
    floor?: number;
    span?: Span;
    sourceAnchorId?: string;
  }>;
  doors?: Array<{
    id?: string;
    kind?: string;
    type?: string;
    doorKind?: string;
    wallId?: string;
    fromRoomId?: string;
    toRoomId?: string;
    opensIntoRoomId?: string;
    roomIds?: string[];
    floor?: number;
    span?: Span;
    widthFt?: number;
    heightFt?: number;
    hingePoint?: { x: number; z: number };
    leafClosedEnd?: { x: number; z: number };
    leafOpenEnd?: { x: number; z: number };
    swing?: { direction?: string; angleDegrees?: number; arcSpanDegrees?: number; radius?: number };
    swingDirection?: string;
    sourceAnchorId?: string;
  }>;
  windows?: Array<{
    id?: string;
    wallId?: string;
    roomId?: string;
    roomIds?: string[];
    type?: string;
    windowKind?: string;
    sillType?: string;
    floor?: number;
    span?: Span;
    sourceAnchorId?: string;
  }>;
  fixtures?: Array<{
    id?: string;
    roomId: string;
    type: string;
    category?: string;
    fixtureType?: string;
    kind?: string;
    bounds: { x: number; z: number; w: number; d: number };
    parts?: Array<{
      type: string;
      x?: number;
      z?: number;
      w?: number;
      d?: number;
      center?: [number, number];
      radius?: number;
      rotationDeg?: number;
    }>;
    rotationDeg?: number;
    facingDirection?: string;
    anchorWallId?: string;
    symbolVariant?: string;
    wallAnchor?: { side?: string; wallId?: string; mode?: string; edge?: string; [key: string]: unknown };
    clearance?: { x?: number; z?: number; w?: number; d?: number; [key: string]: unknown };
    sourceAnchorId?: string;
    bimClass?: string;
    floor?: number;
  }>;
  roof?: {
    style?: string;
    ridgeAxis?: 'x' | 'z';
    ridgeHeightFt?: number;
    eaveHeightFt?: number;
    overhangFt?: number;
    roofThicknessFt?: number;
    planes?: RoofPlane[];
  };
  elevations?: RoofElevation[];
  drawingStyleProfile?: DrawingStyleProfile;
  dimensionLines?: Array<{
    id?: string;
    floor?: number;
    label?: string;
    span?: Span;
    sourceAnchorId?: string;
  }>;
  sourceWalls?: SourceWallSegment[];
  sourceOpenings?: SourceOpeningSegment[];
};

type FloorFrame = {
  floor: number;
  bounds?: { x: number; z: number; w: number; d: number };
  widthFt: number;
  depthFt: number;
  showWidthDimension?: boolean;
  showDepthDimension?: boolean;
  widthSourceAnchorId?: string;
  depthSourceAnchorId?: string;
};

type PixelFloorFrame = {
  floor: number;
  span: Span;
  widthFt: number;
  depthFt: number;
  xFt: number;
  zFt: number;
};

type ProposalAvailability = {
  id: string;
  label?: string;
  imageUrl?: string;
  pairedArtifact?: boolean;
  latestPairedArtifact?: boolean;
  latestGptPairedArtifact?: boolean;
  pairedJsonUrl?: string;
  pairedDrawingStyleProfileUrl?: string;
  deterministicRenderUrl?: string;
  pairedValidationUrl?: string;
  pairedVisualReviewUrl?: string;
  pairedVisualDriftUrl?: string;
  artifactVersion?: string | null;
  promotionEligible?: boolean;
  gptSourceReady?: boolean | null;
  pairedValidationReady?: boolean;
  pairedVisualDriftReady?: boolean;
  pairedVisualReviewReady?: boolean;
  pairedReviewStatus?: 'passed' | 'blocked' | 'pending' | null;
  archived?: boolean;
  blockers?: string[];
};

type ProposalManifest = {
  generatedAt?: string;
  artifactVersion?: string;
  summary?: {
    planCount?: number;
    proposalCount?: number;
    pairedPromotionEligible?: number;
    archived?: number;
  };
  plans?: Record<string, ProposalAvailability[]>;
};

type PairedGenerationQueueItem = {
  planId: string;
  proposalId: string;
  prompt: string;
  compactPrompt?: string;
  repairPrompt?: string;
  uploadDir: string;
  outputImage: string;
  outputJson: string;
  importCommand: string;
  acceptCommand?: string;
  promoteCommand?: string;
};

type PairedGenerationQueue = {
  artifactVersion: string;
  generatedAt?: string;
  promotedPairedPlans?: number;
  queuedPlans?: number;
  queue: PairedGenerationQueueItem[];
};

function ftToGrid(value: number): number {
  return value / 4;
}

function gridSpanWidth(span: { x1: number; z1: number; x2: number; z2: number }): number {
  return Math.hypot(span.x2 - span.x1, span.z2 - span.z1) * 4;
}

function normalizedSourceWallOverride(wall: SourceWallSegment): SourceWallSegment {
  return {
    ...wall,
    floor: wall.floor ?? 0,
    sourceAnchorId: wall.sourceAnchorId ?? wall.id,
    source: wall.source ?? 'paired_gpt_floorplan_v1:source-primitive-override',
  };
}

function normalizedSourceOpeningOverride(opening: SourceOpeningSegment): SourceOpeningSegment {
  const span = opening.span ?? {
    x1: opening.x1,
    z1: opening.z1,
    x2: opening.x2,
    z2: opening.z2,
  };
  return {
    ...opening,
    floor: opening.floor ?? 0,
    span,
    x1: opening.x1 ?? span.x1,
    z1: opening.z1 ?? span.z1,
    x2: opening.x2 ?? span.x2,
    z2: opening.z2 ?? span.z2,
    widthFt: opening.widthFt ?? gridSpanWidth(span),
    heightFt: opening.heightFt ?? (opening.kind === 'window' ? 4 : 7),
    sourceAnchorId: opening.sourceAnchorId ?? opening.id,
    source: opening.source ?? 'paired_gpt_floorplan_v1:source-primitive-override',
  };
}

function sourceDimensionLines(artifact: PairedArtifact, toFtSpan: (span: Span, floor?: number) => Span): SourceDimensionLine[] {
  return (artifact.dimensionLines ?? [])
    .map((line): SourceDimensionLine | undefined => {
      if (!line.span) return undefined;
      const floor = line.floor ?? 0;
      const span = toFtSpan(line.span, floor);
      if (![span.x1, span.z1, span.x2, span.z2].every(Number.isFinite)) return undefined;
      return {
        id: line.id,
        floor,
        label: line.label,
        span: {
          x1: ftToGrid(span.x1),
          z1: ftToGrid(span.z1),
          x2: ftToGrid(span.x2),
          z2: ftToGrid(span.z2),
        },
        sourceAnchorId: line.sourceAnchorId ?? line.id,
      };
    })
    .filter((line): line is SourceDimensionLine => Boolean(line));
}

function floorPanelFootprint(panel: NonNullable<PairedArtifact['floorPanels']>[number], fallback: { width: number; depth: number }) {
  const fp = panel.footprint;
  if (fp?.widthFt && fp.depthFt) return { width: fp.widthFt, depth: fp.depthFt };
  if (fp?.width && fp.depth) return { width: fp.width, depth: fp.depth };
  if (fp?.w && fp.d) return { width: fp.w, depth: fp.d };
  if (fp?.polygon?.length) {
    const minX = Math.min(...fp.polygon.map((point) => point.x));
    const maxX = Math.max(...fp.polygon.map((point) => point.x));
    const minZ = Math.min(...fp.polygon.map((point) => point.z));
    const maxZ = Math.max(...fp.polygon.map((point) => point.z));
    return { width: maxX - minX, depth: maxZ - minZ };
  }
  return fallback;
}

function spanToBounds(span?: Span): { x: number; z: number; w: number; d: number } | undefined {
  if (!span) return undefined;
  const minX = Math.min(span.x1, span.x2);
  const minZ = Math.min(span.z1, span.z2);
  const maxX = Math.max(span.x1, span.x2);
  const maxZ = Math.max(span.z1, span.z2);
  const w = maxX - minX;
  const d = maxZ - minZ;
  return w > 0 && d > 0 ? { x: minX, z: minZ, w, d } : undefined;
}

function pixelBoundsToBounds(value: unknown): { x: number; z: number; w: number; d: number } | undefined {
  if (Array.isArray(value) && value.length >= 4) {
    const [x1, z1, x2, z2] = value.map(Number);
    if (![x1, z1, x2, z2].every(Number.isFinite)) return undefined;
    return {
      x: Math.min(x1, x2),
      z: Math.min(z1, z2),
      w: Math.abs(x2 - x1),
      d: Math.abs(z2 - z1),
    };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const x = Number(record.x);
    const z = Number(record.z ?? record.y);
    const w = Number(record.w ?? record.width);
    const d = Number(record.d ?? record.h ?? record.height);
    if ([x, z, w, d].every(Number.isFinite)) return { x, z, w, d };
  }
  return undefined;
}

function sourceFrameForArtifact(
  artifact: PairedArtifact,
  footprint: { width: number; depth: number },
): { x: number; z: number; w: number; d: number; widthFt: number; depthFt: number } | undefined {
  const footprintAnchor = (artifact.footprint as Record<string, unknown> | undefined)?.sourceAnchor as Record<string, unknown> | undefined;
  const coordinateSystem = (artifact as unknown as { coordinateSystem?: { planPixelBounds?: unknown } }).coordinateSystem;
  const bounds = pixelBoundsToBounds(footprintAnchor?.pixelBounds)
    ?? pixelBoundsToBounds(coordinateSystem?.planPixelBounds);
  if (!bounds || bounds.w <= 0 || bounds.d <= 0) return undefined;
  return {
    ...bounds,
    widthFt: artifact.footprint.widthFt ?? artifact.footprint.width ?? footprint.width,
    depthFt: artifact.footprint.depthFt ?? artifact.footprint.depth ?? footprint.depth,
  };
}

function sourceFrameForFloorArtifact(
  artifact: PairedArtifact,
  footprint: { width: number; depth: number },
  floor: number,
): { x: number; z: number; w: number; d: number; widthFt: number; depthFt: number; xFt: number; zFt: number } | undefined {
  const panel = (artifact.floorPanels ?? []).find((item) => {
    const panelFloor = item.floor ?? item.levelIndex ?? 0;
    return panelFloor === floor && (item.sourceAnchors ?? []).length;
  });
  const semanticExtentForFloor = (): { x: number; z: number; w: number; d: number } | undefined => {
    const spans = [
      ...(artifact.exteriorWalls ?? []),
      ...(artifact.interiorWalls ?? []),
      ...(artifact.openings ?? []),
      ...(artifact.doors ?? []),
      ...(artifact.windows ?? []),
    ]
      .filter((item) => ((item as Record<string, unknown>).floor ?? (item as Record<string, unknown>).levelIndex ?? 0) === floor)
      .map((item) => item.span)
      .filter((span): span is Span => Boolean(span));
    if (!spans.length) return undefined;
    const xs = spans.flatMap((span) => [span.x1, span.x2]);
    const zs = spans.flatMap((span) => [span.z1, span.z2]);
    const x1 = Math.min(...xs);
    const x2 = Math.max(...xs);
    const z1 = Math.min(...zs);
    const z2 = Math.max(...zs);
    if (![x1, x2, z1, z2].every(Number.isFinite) || x2 - x1 <= 0 || z2 - z1 <= 0) return undefined;
    return { x: x1, z: z1, w: x2 - x1, d: z2 - z1 };
  };

  const sourceAnchor = [
    panel?.sourceAnchors?.find((anchor) => /footprint|levelFootprint/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`)),
    panel?.sourceAnchors?.find((anchor) => /levelFrame|buildingFrame/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`)),
    panel?.sourceAnchors?.find((anchor) => /dimension/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`)),
    panel?.sourceAnchors?.find((anchor) => {
      const record = anchor as typeof anchor & { pixelBounds?: unknown };
      return pixelBoundsToBounds(record.pixelBounds) ?? spanToBounds(record.span);
    }),
  ].find(Boolean) as ({ span?: Span; bounds?: { x: number; z: number; w: number; d: number }; pixelBounds?: unknown } | undefined);
  const bounds = pixelBoundsToBounds(sourceAnchor?.pixelBounds) ?? spanToBounds(sourceAnchor?.span);
  const panelFootprint = panel?.footprint as ({
    widthFt?: number;
    depthFt?: number;
    width?: number;
    depth?: number;
    x?: number;
    z?: number;
  } | undefined);
  const widthFt =
    panelFootprint?.widthFt ??
    panelFootprint?.width ??
    panel?.bounds?.w ??
    artifact.footprint.widthFt ??
    artifact.footprint.width ??
    footprint.width;
  const depthFt =
    panelFootprint?.depthFt ??
    panelFootprint?.depth ??
    panel?.bounds?.d ??
    artifact.footprint.depthFt ??
    artifact.footprint.depth ??
    footprint.depth;
  const panelX = typeof panelFootprint?.x === 'number' ? panelFootprint.x : 0;
  const panelZ = typeof panelFootprint?.z === 'number' ? panelFootprint.z : 0;
  const semanticExtent = semanticExtentForFloor();
  const useSemanticExtent = semanticExtent && (
    semanticExtent.x < panelX - 0.5 ||
    semanticExtent.z < panelZ - 0.5 ||
    semanticExtent.w > widthFt + 0.75 ||
    semanticExtent.d > depthFt + 0.75
  );
  const xFt = useSemanticExtent ? semanticExtent.x : panelX;
  const zFt = useSemanticExtent ? semanticExtent.z : panelZ;
  if (bounds && bounds.w > 0 && bounds.d > 0 && widthFt && depthFt) {
    return { ...bounds, widthFt: useSemanticExtent ? semanticExtent.w : widthFt, depthFt: useSemanticExtent ? semanticExtent.d : depthFt, xFt, zFt };
  }
  const fallback = sourceFrameForArtifact(artifact, footprint);
  return fallback ? { ...fallback, xFt: 0, zFt: 0 } : undefined;
}

function sourceAnchorPixelBounds(
  artifact: PairedArtifact,
  item: { id?: string; type?: string; fixtureKind?: string; symbolVariant?: string; sourceAnchorId?: string; sourceAnchor?: { pixelBounds?: unknown; span?: Span } },
): { x: number; z: number; w: number; d: number } | undefined {
  const direct = pixelBoundsToBounds(item.sourceAnchor?.pixelBounds) ?? spanToBounds(item.sourceAnchor?.span);
  if (direct) return direct;
  const wanted = new Set([item.sourceAnchorId, item.id].filter((id): id is string => Boolean(id)));
  const sourceAnchors = [
    ...(artifact.sourceAnchors ?? []),
    ...(artifact.floorPanels ?? []).flatMap((panel) => panel.sourceAnchors ?? []),
  ];
  for (const rawAnchor of sourceAnchors) {
    const anchor = rawAnchor as {
      id?: string;
      sourceAnchorId?: string;
      elementId?: string;
      pixelBounds?: unknown;
      bounds?: { x: number; z: number; w: number; d: number };
      span?: Span;
    };
    const ids = [anchor.id, anchor.sourceAnchorId, anchor.elementId].filter((id): id is string => Boolean(id));
    if (!ids.some((id) => wanted.has(id))) continue;
    const bounds = pixelBoundsToBounds(anchor.pixelBounds) ?? anchor.bounds ?? spanToBounds(anchor.span);
    if (bounds) return bounds;
  }
  if (direct) return direct;
  return undefined;
}

function sourcePixelBoundsToFtBounds(
  bounds: { x: number; z: number; w: number; d: number } | undefined,
  frame: { x: number; z: number; w: number; d: number; widthFt: number; depthFt: number; xFt?: number; zFt?: number } | undefined,
): { x: number; z: number; w: number; d: number } | undefined {
  if (!bounds || !frame || frame.w <= 0 || frame.d <= 0) return undefined;
  return {
    x: (frame.xFt ?? 0) + ((bounds.x - frame.x) / frame.w) * frame.widthFt,
    z: (frame.zFt ?? 0) + ((bounds.z - frame.z) / frame.d) * frame.depthFt,
    w: (bounds.w / frame.w) * frame.widthFt,
    d: (bounds.d / frame.d) * frame.depthFt,
  };
}

function pairedFloorFrames(artifact: PairedArtifact, footprint: { width: number; depth: number }): FloorFrame[] {
  const floorPanels = artifact.floorPanels ?? [];
  const anchoredFloors = new Set(
    floorPanels
      .filter((panel) => (panel.sourceAnchors ?? []).length > 0)
      .map((panel) => panel.floor ?? panel.levelIndex ?? 0),
  );
  const framePanels = anchoredFloors.size
    ? floorPanels.filter((panel) => {
      const floor = panel.floor ?? panel.levelIndex ?? 0;
      return !anchoredFloors.has(floor) || (panel.sourceAnchors ?? []).length > 0;
    })
    : floorPanels;
  if (!framePanels.length) {
    const floors = new Set<number>([
      ...(artifact.rooms ?? []).map((room) => room.floor ?? 0),
      ...(artifact.dimensionLines ?? []).map((line) => line.floor ?? 0),
    ]);
    return [...(floors.size ? floors : new Set([0]))].map((floor) => {
      const dimensionLines = artifact.dimensionLines?.filter((line) => (line.floor ?? 0) === floor && line.span) ?? [];
      const horizontalDimension = dimensionLines.find((line) => line.span && Math.abs(line.span.x2 - line.span.x1) >= Math.abs(line.span.z2 - line.span.z1));
      const verticalDimension = dimensionLines.find((line) => line.span && Math.abs(line.span.z2 - line.span.z1) > Math.abs(line.span.x2 - line.span.x1));
      return {
        floor,
        widthFt: footprint.width,
        depthFt: footprint.depth,
        showWidthDimension: Boolean(horizontalDimension),
        showDepthDimension: Boolean(verticalDimension),
        widthSourceAnchorId: horizontalDimension?.sourceAnchorId ?? horizontalDimension?.id,
        depthSourceAnchorId: verticalDimension?.sourceAnchorId ?? verticalDimension?.id,
      };
    }).filter((frame) => frame.widthFt > 0 && frame.depthFt > 0);
  }

  return framePanels
    .map((panel) => {
      const fp = floorPanelFootprint(panel, footprint);
      const dimensionAnchors = panel.sourceAnchors?.filter((anchor) => /dimension/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`)) ?? [];
      const floor = panel.floor ?? panel.levelIndex ?? 0;
      const dimensionLines = artifact.dimensionLines?.filter((line) => (line.floor ?? 0) === floor && line.span) ?? [];
      const horizontalDimension = dimensionLines.find((line) => line.span && Math.abs(line.span.x2 - line.span.x1) >= Math.abs(line.span.z2 - line.span.z1));
      const verticalDimension = dimensionLines.find((line) => line.span && Math.abs(line.span.z2 - line.span.z1) > Math.abs(line.span.x2 - line.span.x1));
      const horizontalAnchor = dimensionAnchors.find((anchor) => /north|south|dimension-n|dimension-s/i.test(`${anchor.id ?? ''}`));
      const verticalAnchor = dimensionAnchors.find((anchor) => /west|east|dimension-w|dimension-e/i.test(`${anchor.id ?? ''}`));
      const hasWidthDimension = dimensionAnchors.some((anchor) => /north|south|dimension-n|dimension-s/i.test(`${anchor.id ?? ''}`));
      const hasDepthDimension = dimensionAnchors.some((anchor) => /west|east|dimension-w|dimension-e/i.test(`${anchor.id ?? ''}`));
      const hasHorizontalDimension = dimensionLines.some((line) => line.span && Math.abs(line.span.x2 - line.span.x1) >= Math.abs(line.span.z2 - line.span.z1));
      const hasVerticalDimension = dimensionLines.some((line) => line.span && Math.abs(line.span.z2 - line.span.z1) > Math.abs(line.span.x2 - line.span.x1));
      return {
        floor,
        bounds: panel.bounds ?? panel.footprintBounds ?? panel.drawingBounds ?? panel.interiorBounds ?? spanToBounds(panel.span) ?? panel.panelBounds,
        widthFt: fp.width,
        depthFt: fp.depth,
        showWidthDimension: hasWidthDimension || hasHorizontalDimension,
        showDepthDimension: hasDepthDimension || hasVerticalDimension,
        widthSourceAnchorId: horizontalDimension?.sourceAnchorId ?? horizontalDimension?.id ?? horizontalAnchor?.id,
        depthSourceAnchorId: verticalDimension?.sourceAnchorId ?? verticalDimension?.id ?? verticalAnchor?.id,
      };
    })
    .filter((frame) => frame.widthFt > 0 && frame.depthFt > 0);
}

function pairedPixelFloorFrames(artifact: PairedArtifact, footprint: { width: number; depth: number }): PixelFloorFrame[] {
  const semanticExtentForFloor = (floor: number): { x: number; z: number; w: number; d: number } | undefined => {
    const spans = [
      ...(artifact.exteriorWalls ?? []),
      ...(artifact.interiorWalls ?? []),
      ...(artifact.openings ?? []),
      ...(artifact.doors ?? []),
      ...(artifact.windows ?? []),
    ]
      .filter((item) => ((item as Record<string, unknown>).floor ?? (item as Record<string, unknown>).levelIndex ?? 0) === floor)
      .map((item) => item.span)
      .filter((span): span is Span => Boolean(span));
    if (!spans.length) return undefined;
    const xs = spans.flatMap((span) => [span.x1, span.x2]);
    const zs = spans.flatMap((span) => [span.z1, span.z2]);
    const x1 = Math.min(...xs);
    const x2 = Math.max(...xs);
    const z1 = Math.min(...zs);
    const z2 = Math.max(...zs);
    if (![x1, x2, z1, z2].every(Number.isFinite) || x2 - x1 <= 0 || z2 - z1 <= 0) return undefined;
    return { x: x1, z: z1, w: x2 - x1, d: z2 - z1 };
  };
  return (artifact.floorPanels ?? [])
    .map((panel) => {
      const fp = floorPanelFootprint(panel, footprint);
      const floor = panel.floor ?? panel.levelIndex ?? 0;
      const panelFootprint = panel.footprint as (typeof panel.footprint & { x?: number; z?: number }) | undefined;
      const panelX = typeof panelFootprint?.x === 'number' ? panelFootprint.x : 0;
      const panelZ = typeof panelFootprint?.z === 'number' ? panelFootprint.z : 0;
      const semanticExtent = semanticExtentForFloor(floor);
      const useSemanticExtent = semanticExtent && (
        semanticExtent.x < panelX - 0.5 ||
        semanticExtent.z < panelZ - 0.5 ||
        semanticExtent.w > fp.width + 0.75 ||
        semanticExtent.d > fp.depth + 0.75
      );
      const footprintAnchor = panel.sourceAnchors?.find((anchor) => /footprint/i.test(`${anchor.kind ?? ''} ${anchor.id ?? ''}`));
      const span = footprintAnchor?.span ?? panel.sourceAnchors?.find((anchor) => anchor.span)?.span;
      if (!span) return null;
      return {
        floor,
        span,
        widthFt: useSemanticExtent ? semanticExtent.w : fp.width,
        depthFt: useSemanticExtent ? semanticExtent.d : fp.depth,
        xFt: useSemanticExtent ? semanticExtent.x : panelX,
        zFt: useSemanticExtent ? semanticExtent.z : panelZ,
      };
    })
    .filter((frame): frame is PixelFloorFrame => Boolean(frame));
}

function sourceAnchorCenterFt(
  anchor: NonNullable<PairedArtifact['sourceAnchors']>[number],
  frames: PixelFloorFrame[],
): { x: number; z: number } | undefined {
  const floor = anchor.floor ?? 0;
  const frame = frames.find((item) => item.floor === floor);
  const bounds = anchor.bounds ?? spanToBounds(anchor.span);
  if (!frame || !bounds) return undefined;
  const cx = bounds.x + bounds.w / 2;
  const cz = bounds.z + bounds.d / 2;
  const frameWidthPx = frame.span.x2 - frame.span.x1;
  const frameDepthPx = frame.span.z2 - frame.span.z1;
  if (Math.abs(frameWidthPx) < 0.001 || Math.abs(frameDepthPx) < 0.001) return undefined;
  return {
    x: frame.xFt + ((cx - frame.span.x1) / frameWidthPx) * frame.widthFt,
    z: frame.zFt + ((cz - frame.span.z1) / frameDepthPx) * frame.depthFt,
  };
}

function calloutAnchorKey(text: string, floor: number): string | undefined {
  const normalized = text.toLowerCase();
  if (normalized.includes('entry')) return 'entry';
  if (normalized.includes('kitchen') || normalized.includes('kitchenette')) return 'kitchen';
  if (normalized.includes('dining')) return 'dining';
  if (normalized.includes('living') || normalized.includes('studio')) return 'living';
  if (normalized.includes('ladder')) return floor >= 1 ? 'ladder-upper' : 'ladder';
  if (normalized.includes('stair')) return 'stair';
  if (normalized.includes('loft sleeping')) return 'loft-sleeping';
  if (normalized.includes('bed')) return 'bedroom';
  if (normalized.includes('bath')) return 'bathroom';
  if (normalized.includes('closet')) return 'closet';
  if (normalized.includes('office')) return 'office';
  if (normalized.includes('laundry') || normalized.includes('utility')) return 'utility';
  if (normalized.includes('deck')) return 'deck';
  if (normalized.includes('hall')) return 'hallway';
  return undefined;
}

function artifactRoomCalloutKey(room: PairedArtifact['rooms'][number]): string | undefined {
  const floor = room.floor ?? 0;
  const text = `${room.type ?? ''} ${room.label ?? ''}`.toLowerCase();
  if (text.includes('exterior') || text.includes('eave') || text.includes('clearance')) return undefined;
  if (floor === 0 && text.includes('entry')) return 'entry';
  if (floor === 0 && text.includes('kitchen')) return 'kitchen';
  if (text.includes('dining')) return 'dining';
  if (text.includes('living') || text.includes('studio') || text.includes('open_plan')) return 'living';
  if (text.includes('ladder')) return floor >= 1 ? 'ladder-upper' : 'ladder';
  if (text.includes('stair')) return 'stair';
  if (floor >= 1 && text.includes('loft_sleeping')) return 'loft-sleeping';
  if (text.includes('bed')) return 'bedroom';
  if (text.includes('bath')) return 'bathroom';
  if (text.includes('closet')) return 'closet';
  if (text.includes('office')) return 'office';
  if (text.includes('laundry') || text.includes('utility')) return 'utility';
  if (text.includes('deck')) return 'deck';
  if (text.includes('hall')) return 'hallway';
  return undefined;
}

function calloutAnchorsByKey(
  artifact: PairedArtifact,
  footprint: { width: number; depth: number },
): Map<string, Array<{ x: number; z: number }>> {
  const frames = pairedPixelFloorFrames(artifact, footprint);
  const anchors = new Map<string, Array<{ x: number; z: number }>>();
  for (const anchor of artifact.sourceAnchors ?? []) {
    if (!/callout/i.test(`${anchor.targetKind ?? ''} ${anchor.id ?? ''}`)) continue;
    const floor = anchor.floor ?? 0;
    const key = calloutAnchorKey(`${anchor.text ?? ''} ${anchor.label ?? ''}`, floor);
    const point = key ? sourceAnchorCenterFt(anchor, frames) : undefined;
    if (key && point) {
      const mapKey = `${floor}:${key}`;
      anchors.set(mapKey, [...(anchors.get(mapKey) ?? []), point]);
    }
  }
  return anchors;
}

function nearestCalloutAnchor(
  anchors: Array<{ x: number; z: number }> | undefined,
  center: { x: number; z: number },
): { x: number; z: number } | undefined {
  return anchors
    ?.map((anchor) => ({ anchor, distance: Math.hypot(anchor.x - center.x, anchor.z - center.z) }))
    .sort((a, b) => a.distance - b.distance)[0]?.anchor;
}

function roomSourceCalloutAnchor(
  room: PairedArtifact['rooms'][number],
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number },
): { x: number; z: number } | undefined {
  const sourceAnchor = (room as Record<string, unknown>).sourceAnchor as
    | {
        pixelBounds?: [number, number, number, number] | number[];
        calloutPixel?: [number, number] | number[];
      }
    | undefined;
  const pixelBounds = sourceAnchor?.pixelBounds;
  const calloutPixel = sourceAnchor?.calloutPixel;
  if (!Array.isArray(pixelBounds) || pixelBounds.length < 4 || !Array.isArray(calloutPixel) || calloutPixel.length < 2) {
    return undefined;
  }
  const [x1, y1, x2, y2] = pixelBounds;
  const [cx, cy] = calloutPixel;
  const width = x2 - x1;
  const height = y2 - y1;
  if (Math.abs(width) < 0.001 || Math.abs(height) < 0.001) return undefined;
  const tx = Math.min(1, Math.max(0, (cx - x1) / width));
  const tz = Math.min(1, Math.max(0, (cy - y1) / height));
  return {
    x: bounds.minX + tx * (bounds.maxX - bounds.minX),
    z: bounds.minZ + tz * (bounds.maxZ - bounds.minZ),
  };
}

function pairedProposalNumber(room: PairedArtifact['rooms'][number]): number | undefined {
  for (const key of ['proposalNumber', 'calloutNumber', 'legendNumber', 'number', 'callout']) {
    const value = (room as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function pairedCoordinateMapper(artifact: PairedArtifact, footprint: { width: number; depth: number }) {
  const frames = pairedFloorFrames(artifact, footprint);
  const toFtPoint = (point: { x: number; z: number }, _floor = 0): { x: number; z: number } => {
    void _floor;
    return point;
  };
  const toFtSpan = (span: Span, floor = 0): Span => {
    const a = toFtPoint({ x: span.x1, z: span.z1 }, floor);
    const b = toFtPoint({ x: span.x2, z: span.z2 }, floor);
    return { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
  };
  const toFtBounds = (bounds: { x: number; z: number; w: number; d: number }, _floor = 0) => {
    void _floor;
    return bounds;
  };
  return { frames, toFtPoint, toFtSpan, toFtBounds };
}

function cleanPlanName(name: string): string {
  return name.replace(/^Den\s+/i, '').replace(/\s+/g, ' ').trim();
}

function cleanLabel(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'label', 'name', 'value']) {
      if (typeof record[key] === 'string') return record[key].replace(/\s+/g, ' ').trim();
    }
  }
  return fallback.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function pairedRoomType(type: string): string {
  const normalized = cleanLabel(type, 'room').toLowerCase().replace(/_open_zone$/, '');
  if (normalized.includes('master') || normalized.includes('primary')) return 'primary_bed';
  if (normalized.includes('ensuite') || normalized.includes('bath')) return 'bathroom_full';
  if (normalized.includes('stair')) return 'stairs';
  if (normalized.includes('laundry') || normalized.includes('utility')) return 'utility';
  if (normalized.includes('closet')) return 'closet';
  if (normalized.includes('living')) return 'great_room';
  if (normalized === 'great_room') return 'great_room';
  if (normalized.includes('deck')) return 'deck';
  if (normalized.includes('porch')) return 'porch';
  if (normalized.includes('office')) return 'office';
  if (normalized.includes('hall')) return 'hallway';
  if (normalized.includes('entry')) return 'entry';
  if (normalized.includes('kitchen')) return 'kitchen';
  if (normalized.includes('dining')) return 'dining';
  if (normalized.includes('bed')) return 'bedroom';
  return normalized;
}

function isExteriorHelperArtifactRoom(room: { id?: string; label?: string; type?: string; roomKind?: string }): boolean {
  return EXTERIOR_HELPER_ROOM_PATTERN.test(`${room.id ?? ''} ${room.label ?? ''} ${room.type ?? ''} ${room.roomKind ?? ''}`);
}

function pairedFixtureType(type: string): string {
  const normalized = type.toLowerCase();
  if (normalized.includes('queen') || normalized.includes('bed')) return 'bed';
  if (normalized.includes('stair')) return 'stairs';
  if (/round.*table|dining.*table|table.*chair/.test(normalized)) return 'dining_table';
  if (normalized.includes('sofa')) return 'sofa';
  if (normalized.includes('coffee')) return 'coffee_table';
  if (normalized.includes('shower')) return 'shower';
  if (normalized.includes('vanity')) return 'vanity';
  if (normalized.includes('closet') || normalized.includes('wardrobe') || normalized.includes('storage')) return 'storage';
  if (/casework|counter|cabinet/.test(normalized)) return 'counter';
  if (normalized === 'range' || normalized.includes('cooktop')) return 'stove';
  if (normalized.includes('ladder')) return 'ladder';
  if (normalized.includes('island')) return 'island';
  if (normalized.includes('dining_table')) return 'dining_table';
  if (normalized.includes('chair')) return 'chair';
  if (normalized.includes('refrigerator') || normalized.includes('fridge')) return 'counter';
  if (normalized.includes('washer')) return 'washer';
  if (normalized.includes('dryer')) return 'dryer';
  return normalized;
}

function pairedFixtureCategory(fixture: { type?: string; fixtureType?: string; kind?: string; category?: string }): RoomFixture['category'] {
  const text = `${fixture.category ?? ''} ${fixture.kind ?? ''} ${fixture.fixtureType ?? ''} ${fixture.type ?? ''}`.toLowerCase();
  if (/toilet|tub|bath|shower|sink|vanity|sanitary/.test(text)) return 'sanitary';
  if (/kitchen|island|counter|range|cooktop|sink/.test(text)) return 'kitchen';
  if (/washer|dryer|laundry/.test(text)) return 'laundry';
  if (/bed|sofa|couch|chair|table|desk|bench|nightstand|furniture/.test(text)) return 'furniture';
  if (/closet|storage|cabinet|shelf|shelves/.test(text)) return 'storage';
  if (/stair|ladder/.test(text)) return 'stair';
  if (/appliance|refrigerator|fridge|equipment/.test(text)) return 'appliance';
  return 'fixture';
}

function pairedFixtureBimClass(category: RoomFixture['category'], type: string): string {
  const text = type.toLowerCase();
  if (category === 'sanitary') return 'IfcSanitaryTerminal';
  if (category === 'furniture') return 'IfcFurniture';
  if (category === 'stair') return 'IfcStair';
  if (category === 'kitchen' || category === 'laundry' || category === 'appliance' || /range|washer|dryer|fridge/.test(text)) {
    return 'IfcBuildingElementProxy';
  }
  return 'IfcBuildingElementProxy';
}

function facingFromWallSide(side?: string, fallback = 'N'): string {
  if (side === 'N') return 'S';
  if (side === 'S') return 'N';
  if (side === 'E') return 'W';
  if (side === 'W') return 'E';
  return fallback;
}

function rotationFromFacing(facing?: string): number {
  if (facing === 'E') return 90;
  if (facing === 'S') return 180;
  if (facing === 'W') return 270;
  return 0;
}

function pairedWall(side?: string): RoomFixture['wall'] {
  if (side === 'N') return 'back';
  if (side === 'S') return 'front';
  if (side === 'W') return 'left';
  if (side === 'E') return 'right';
  return 'center';
}

function pairedOpeningType(value?: string, rooms: string[] = []): NonNullable<SourceOpeningSegment['openingType']> {
  const text = String(value ?? '').toLowerCase();
  const hasExteriorRoom = rooms.some((room) => /exterior|deck|porch|outside/i.test(room));
  if (/sliding/.test(text)) return 'slidingDoor';
  if (/pocket/.test(text)) return 'pocketDoor';
  if (/bifold|bi-fold|closet/.test(text)) return 'bifoldDoor';
  if (/exterior|entry|threshold/.test(text)) return 'exteriorDoor';
  if (/swing|door/.test(text)) return hasExteriorRoom ? 'exteriorDoor' : 'interiorDoor';
  if (/window|glass/.test(text)) return 'window';
  if (/open|cased|pass/.test(text)) return 'passthrough';
  if (hasExteriorRoom) return 'exteriorDoor';
  return 'opening';
}

function footprintDimensions(footprint: PairedArtifact['footprint']): { width: number; depth: number } {
  if (footprint.width && footprint.depth) {
    return { width: footprint.width, depth: footprint.depth };
  }
  if (footprint.widthFt && footprint.depthFt) {
    return { width: footprint.widthFt, depth: footprint.depthFt };
  }
  const polygon = footprint.polygon ?? [];
  if (polygon.length > 0) {
    const minX = Math.min(...polygon.map((point) => point.x));
    const maxX = Math.max(...polygon.map((point) => point.x));
    const minZ = Math.min(...polygon.map((point) => point.z));
    const maxZ = Math.max(...polygon.map((point) => point.z));
    return { width: maxX - minX, depth: maxZ - minZ };
  }
  return { width: 0, depth: 0 };
}

function polygonArea(points: Array<{ x: number; z: number }>): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

function spanWidth(span?: Span): number | undefined {
  if (!span) return undefined;
  return Math.hypot(span.x2 - span.x1, span.z2 - span.z1);
}

function spansMatch(a?: Span, b?: Span, tolerance = 0.15): boolean {
  if (!a || !b) return false;
  const direct =
    Math.abs(a.x1 - b.x1) <= tolerance &&
    Math.abs(a.z1 - b.z1) <= tolerance &&
    Math.abs(a.x2 - b.x2) <= tolerance &&
    Math.abs(a.z2 - b.z2) <= tolerance;
  const reversed =
    Math.abs(a.x1 - b.x2) <= tolerance &&
    Math.abs(a.z1 - b.z2) <= tolerance &&
    Math.abs(a.x2 - b.x1) <= tolerance &&
    Math.abs(a.z2 - b.z1) <= tolerance;
  return direct || reversed;
}

function wallBreakSpan(value: WallBreak | undefined): Span | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const [from, to] = value;
    if (Array.isArray(from) && Array.isArray(to)) {
      return { x1: from[0], z1: from[1], x2: to[0], z2: to[1] };
    }
    return undefined;
  }
  if ('span' in value && value.span) return value.span;
  if ('from' in value && 'to' in value && value.from && value.to) {
    return { x1: value.from[0], z1: value.from[1], x2: value.to[0], z2: value.to[1] };
  }
  if (
    typeof value.x1 === 'number' &&
    typeof value.z1 === 'number' &&
    typeof value.x2 === 'number' &&
    typeof value.z2 === 'number'
  ) {
    return { x1: value.x1, z1: value.z1, x2: value.x2, z2: value.z2 };
  }
  return undefined;
}

function collinearGapInterval(wall: Span, gap: Span, tolerance = 0.35): { start: number; end: number } | undefined {
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

function splitWallSpanByGaps(wall: Span, gaps: Span[]): Span[] {
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
  const segments: Span[] = [];
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

function inferredSwingDirection(
  hinge?: { x: number; z: number },
  closed?: { x: number; z: number },
  open?: { x: number; z: number },
): string | undefined {
  if (!hinge || !closed || !open) return undefined;
  const closedVector = { x: closed.x - hinge.x, z: closed.z - hinge.z };
  const openVector = { x: open.x - hinge.x, z: open.z - hinge.z };
  const cross = closedVector.x * openVector.z - closedVector.z * openVector.x;
  if (Math.abs(cross) < 0.0001) return undefined;
  return cross > 0 ? 'clockwise' : 'counterclockwise';
}

function roomDistanceToPoint(room: PairedArtifact['rooms'][number] | undefined, point?: { x: number; z: number }): number {
  if (!room || !point) return Number.POSITIVE_INFINITY;
  const bounds = room.bounds ?? (() => {
    const points = room.polygon ?? [];
    if (!points.length) return null;
    const minX = Math.min(...points.map((item) => item.x));
    const maxX = Math.max(...points.map((item) => item.x));
    const minZ = Math.min(...points.map((item) => item.z));
    const maxZ = Math.max(...points.map((item) => item.z));
    return { x: minX, z: minZ, w: maxX - minX, d: maxZ - minZ };
  })();
  if (!bounds) return Number.POSITIVE_INFINITY;
  const cx = Math.min(Math.max(point.x, bounds.x), bounds.x + bounds.w);
  const cz = Math.min(Math.max(point.z, bounds.z), bounds.z + bounds.d);
  return Math.hypot(point.x - cx, point.z - cz);
}

function inferredOpensIntoRoomId(
  roomsById: Map<string, PairedArtifact['rooms'][number]>,
  roomIds: string[],
  leafOpenEnd?: { x: number; z: number },
): string | undefined {
  if (!leafOpenEnd) return undefined;
  const candidates = roomIds.filter((id) => id !== 'exterior');
  if (!candidates.length) return roomIds.includes('exterior') ? 'exterior' : undefined;
  return candidates
    .map((id) => ({ id, distance: roomDistanceToPoint(roomsById.get(id), leafOpenEnd) }))
    .sort((a, b) => a.distance - b.distance)[0]?.id;
}

function openingToConnection(
  opening: NonNullable<PairedArtifact['openings']>[number],
  roomLabelById: Map<string, string>,
  mapSpan: (span: Span, floor?: number) => Span,
): RoomConnection | null {
  const fromRoomId = opening.fromRoomId ?? opening.roomIds?.[0];
  const toRoomId = opening.toRoomId ?? opening.roomIds?.[1];
  if (!fromRoomId || !toRoomId || fromRoomId === 'exterior' || toRoomId === 'exterior') return null;
  const from = roomLabelById.get(fromRoomId);
  const to = roomLabelById.get(toRoomId);
  if (!from || !to) return null;
  const openingText = `${opening.type ?? ''} ${opening.openingKind ?? ''} ${opening.id ?? ''}`.toLowerCase();
  const type = /guard|void|open.to.below|open|pass|clearance|travel/.test(openingText)
    ? 'open'
    : opening.type === 'sliding_door'
      ? 'sliding'
      : 'door';
  return {
    from,
    to,
    type,
    opening: opening.span ? (() => {
      const span = mapSpan(opening.span!, opening.floor ?? 0);
      return {
        x1: ftToGrid(span.x1),
        z1: ftToGrid(span.z1),
        x2: ftToGrid(span.x2),
        z2: ftToGrid(span.z2),
        source: opening.id,
      };
    })() : undefined,
    width: spanWidth(opening.span ? mapSpan(opening.span, opening.floor ?? 0) : undefined),
    operation: type === 'sliding' ? 'slide' : type === 'open' ? 'none' : 'swing',
    source: 'parser',
  };
}

function sourceWallSegments(
  artifact: PairedArtifact,
  mapSpan: (span: Span, floor?: number) => Span,
  mapBounds: (bounds: { x: number; z: number; w: number; d: number }, floor?: number) => { x: number; z: number; w: number; d: number },
): SourceWallSegment[] {
  if (artifact.sourceWalls?.length) {
    return artifact.sourceWalls.map(normalizedSourceWallOverride);
  }
  const footprint = {
    width: artifact.footprint.widthFt ?? artifact.footprint.width ?? 0,
    depth: artifact.footprint.depthFt ?? artifact.footprint.depth ?? 0,
  };
  const sourceFrameForFloor = (floor: number) => sourceFrameForFloorArtifact(artifact, footprint, floor);
  const mappedGapSpansForWall = (wall: PairedWall, floor: number): Span[] => {
    const wallText = `${wall.id ?? ''} ${wall.wallKind ?? ''} ${wall.kind ?? ''} ${wall.type ?? ''}`;
    if (/glaz|window/i.test(wallText)) return [];
    const wallBreaks = (wall.breaks ?? [])
      .map(wallBreakSpan)
      .filter((span): span is Span => Boolean(span));
    const semanticOpenings = [
      ...(artifact.doors ?? []),
      ...(artifact.openings ?? []),
      ...(artifact.windows ?? []),
    ].filter((opening) => opening.wallId === wall.id && (opening.floor ?? floor) === floor && opening.span)
      .map((opening) => opening.span!)
      .filter((span): span is Span => Boolean(span));
    return [...wallBreaks, ...semanticOpenings].map((span) => mapSpan(span, floor));
  };
  const wallToSegments = (wall: PairedWall, exterior: boolean): SourceWallSegment[] => {
    const floor = wall.floor ?? 0;
    const sourceFrame = sourceFrameForFloor(floor);
    const span = mapSpan(wall.span, floor);
    const sourcePrimitiveBounds = sourcePixelBoundsToFtBounds(sourceAnchorPixelBounds(artifact, wall), sourceFrame);
    const mappedBounds = sourcePrimitiveBounds
      ? mapBounds(sourcePrimitiveBounds, floor)
      : wall.bounds ? mapBounds(wall.bounds, floor) : undefined;
    const segments = splitWallSpanByGaps(span, mappedGapSpansForWall(wall, floor));
    const wallHorizontal = Math.abs(span.x2 - span.x1) >= Math.abs(span.z2 - span.z1);
    const explicitThickness = typeof wall.thicknessFt === 'number'
      ? wall.thicknessFt
      : typeof wall.thickness === 'number'
        ? wall.thickness
        : undefined;
    const wallThickness = mappedBounds
      ? wallHorizontal ? Math.max(0.05, mappedBounds.d) : Math.max(0.05, mappedBounds.w)
      : explicitThickness
        ? Math.max(0.05, explicitThickness)
        : undefined;
    return segments.map((segment, index) => {
      const id = segments.length > 1 ? `${wall.id ?? (exterior ? 'exterior-wall' : 'interior-wall')}:seg-${index + 1}` : wall.id;
      const horizontal = Math.abs(segment.x2 - segment.x1) >= Math.abs(segment.z2 - segment.z1);
      const axisAligned = Math.abs(segment.x2 - segment.x1) < 0.001 || Math.abs(segment.z2 - segment.z1) < 0.001;
      const minX = Math.min(segment.x1, segment.x2);
      const maxX = Math.max(segment.x1, segment.x2);
      const minZ = Math.min(segment.z1, segment.z2);
      const maxZ = Math.max(segment.z1, segment.z2);
      const exactSourceSegmentBounds = sourcePixelBoundsToFtBounds(sourceAnchorPixelBounds(artifact, { id, sourceAnchorId: id }), sourceFrame);
      const segmentBounds = axisAligned && exactSourceSegmentBounds
        ? mapBounds(exactSourceSegmentBounds, floor)
        : axisAligned && wallThickness
        ? horizontal
          ? { x: minX, z: ((segment.z1 + segment.z2) / 2) - wallThickness / 2, w: maxX - minX, d: wallThickness }
          : { x: ((segment.x1 + segment.x2) / 2) - wallThickness / 2, z: minZ, w: wallThickness, d: maxZ - minZ }
        : undefined;
      const renderLine = axisAligned && exactSourceSegmentBounds && segmentBounds
        ? horizontal
          ? {
              x1: segmentBounds.x,
              z1: segmentBounds.z + segmentBounds.d / 2,
              x2: segmentBounds.x + segmentBounds.w,
              z2: segmentBounds.z + segmentBounds.d / 2,
            }
          : {
              x1: segmentBounds.x + segmentBounds.w / 2,
              z1: segmentBounds.z,
              x2: segmentBounds.x + segmentBounds.w / 2,
              z2: segmentBounds.z + segmentBounds.d,
            }
        : segment;
      return {
        id,
        sourceAnchorId: segments.length > 1 ? id : wall.sourceAnchorId ?? wall.id,
        floor,
        x1: ftToGrid(renderLine.x1),
        z1: ftToGrid(renderLine.z1),
        x2: ftToGrid(renderLine.x2),
        z2: ftToGrid(renderLine.z2),
        bounds: segmentBounds
          ? { x: ftToGrid(segmentBounds.x), z: ftToGrid(segmentBounds.z), w: ftToGrid(segmentBounds.w), d: ftToGrid(segmentBounds.d) }
          : undefined,
        exterior,
        wallKind: wall.wallKind ?? wall.kind ?? wall.type,
        source: 'paired_gpt_floorplan_v1',
      };
    });
  };
  return [
    ...(artifact.exteriorWalls ?? []).flatMap((wall) => wallToSegments(wall, true)),
    ...(artifact.interiorWalls ?? []).flatMap((wall) => wallToSegments(wall, false)),
  ];
}

function sourceOpeningSegments(
  artifact: PairedArtifact,
  mapSpan: (span: Span, floor?: number) => Span,
  footprint: { width: number; depth: number },
): SourceOpeningSegment[] {
  if (artifact.sourceOpenings?.length) {
    return artifact.sourceOpenings.map(normalizedSourceOpeningOverride);
  }
  const source = 'paired_gpt_floorplan_v1';
  const roomsById = new Map(artifact.rooms.map((room) => [room.id, room]));
  const pixelFrames = pairedPixelFloorFrames(artifact, footprint);
  const sourceSpanFromAnchor = (
    item: { id?: string; sourceAnchorId?: string; sourceAnchor?: { pixelBounds?: unknown } },
    floor: number,
  ): Span | undefined => {
    const sourceFrame = sourceFrameForFloorArtifact(artifact, footprint, floor);
    const bounds = sourcePixelBoundsToFtBounds(sourceAnchorPixelBounds(artifact, item), sourceFrame);
    if (!bounds) return undefined;
    const horizontal = bounds.w >= bounds.d;
    return horizontal
      ? { x1: bounds.x, z1: bounds.z + bounds.d / 2, x2: bounds.x + bounds.w, z2: bounds.z + bounds.d / 2 }
      : { x1: bounds.x + bounds.w / 2, z1: bounds.z, x2: bounds.x + bounds.w / 2, z2: bounds.z + bounds.d };
  };
  const sourceBoundsFromAnchor = (
    item: { id?: string; sourceAnchorId?: string; sourceAnchor?: { pixelBounds?: unknown } },
    floor: number,
  ): { x: number; z: number; w: number; d: number } | undefined => {
    const bounds = sourcePixelBoundsToFtBounds(sourceAnchorPixelBounds(artifact, item), sourceFrameForFloorArtifact(artifact, footprint, floor));
    return bounds
      ? { x: ftToGrid(bounds.x), z: ftToGrid(bounds.z), w: ftToGrid(bounds.w), d: ftToGrid(bounds.d) }
      : undefined;
  };
  const mapDoorPoint = (point: { x: number; z: number } | undefined, floor: number) => {
    if (!point) return undefined;
    const looksLikePixel = Math.abs(point.x) > footprint.width * 2 || Math.abs(point.z) > footprint.depth * 2;
    if (!looksLikePixel) return { x: ftToGrid(point.x), z: ftToGrid(point.z) };
    const frame = pixelFrames.find((item) => item.floor === floor);
    if (!frame) return undefined;
    const frameWidthPx = frame.span.x2 - frame.span.x1;
    const frameDepthPx = frame.span.z2 - frame.span.z1;
    if (Math.abs(frameWidthPx) < 0.001 || Math.abs(frameDepthPx) < 0.001) return undefined;
    return {
      x: ftToGrid(frame.xFt + ((point.x - frame.span.x1) / frameWidthPx) * frame.widthFt),
      z: ftToGrid(frame.zFt + ((point.z - frame.span.z1) / frameDepthPx) * frame.depthFt),
    };
  };
  const doorSegments = (artifact.doors ?? [])
    .filter((door) => door.span)
    .map((door) => {
      const floor = door.floor ?? 0;
      const span = sourceSpanFromAnchor(door, floor) ?? mapSpan(door.span!, floor);
      const roomIds = door.roomIds ?? [door.fromRoomId, door.toRoomId].filter((id): id is string => Boolean(id));
      const inferredOpeningType = pairedOpeningType(door.type ?? door.kind ?? door.doorKind ?? door.id, roomIds);
      const openingType = inferredOpeningType === 'opening'
        ? roomIds.includes('exterior') ? 'exteriorDoor' : 'interiorDoor'
        : inferredOpeningType;
      const swingDirection = door.swing?.direction ?? door.swingDirection ?? inferredSwingDirection(door.hingePoint, door.leafClosedEnd, door.leafOpenEnd);
      return {
        id: door.id,
        wallId: door.wallId,
        floor,
        kind: 'door' as const,
        openingType,
        fromRoomId: door.fromRoomId ?? roomIds[0],
        toRoomId: door.toRoomId ?? roomIds[1],
        opensIntoRoomId: door.opensIntoRoomId ?? inferredOpensIntoRoomId(roomsById, roomIds, door.leafOpenEnd),
        x1: ftToGrid(span.x1),
        z1: ftToGrid(span.z1),
        x2: ftToGrid(span.x2),
        z2: ftToGrid(span.z2),
        span: {
          x1: ftToGrid(span.x1),
          z1: ftToGrid(span.z1),
          x2: ftToGrid(span.x2),
          z2: ftToGrid(span.z2),
        },
        hingePoint: mapDoorPoint(door.hingePoint, floor),
        leafClosedEnd: mapDoorPoint(door.leafClosedEnd, floor),
        leafOpenEnd: mapDoorPoint(door.leafOpenEnd, floor),
        swingDirection,
        swingArcDeg: door.swing?.angleDegrees ?? door.swing?.arcSpanDegrees,
        widthFt: door.widthFt ?? spanWidth(span),
        heightFt: door.heightFt ?? 7,
        sourceAnchorId: door.sourceAnchorId ?? door.id,
        roomIds,
        source,
      };
    });

  const openings: SourceOpeningSegment[] = (artifact.openings ?? [])
    .filter((opening) => opening.span)
    .map<SourceOpeningSegment | null>((opening) => {
      const floor = opening.floor ?? 0;
      const span = sourceSpanFromAnchor(opening, floor) ?? mapSpan(opening.span!, floor);
      const text = `${opening.id ?? ''} ${opening.type ?? ''} ${opening.openingKind ?? ''}`.toLowerCase();
      const roomIds = opening.roomIds ?? [opening.fromRoomId, opening.toRoomId].filter((id): id is string => Boolean(id));
      const matchesSemanticDoor = (artifact.doors ?? []).some((door) => door.wallId === opening.wallId && spansMatch(door.span, opening.span));
      if (matchesSemanticDoor || /swing.trace/.test(text)) return null;
      const kind: SourceOpeningSegment['kind'] = /door/.test(text)
        ? 'door'
        : /window|glass|glaz|folding/.test(text)
          ? 'window'
          : /open/.test(text)
            ? 'open'
            : 'opening';
      const isDoorGapOnly = kind === 'door' && (matchesSemanticDoor || /door.?opening|door.?gap/.test(text));
      const openingType = kind === 'window' ? 'window' : isDoorGapOnly ? 'opening' : pairedOpeningType(opening.type ?? opening.openingKind, roomIds);
      return {
        id: opening.id,
        wallId: opening.wallId,
        floor,
        kind,
        openingType,
        windowKind: opening.openingKind,
        fromRoomId: opening.fromRoomId,
        toRoomId: opening.toRoomId,
        x1: ftToGrid(span.x1),
        z1: ftToGrid(span.z1),
        x2: ftToGrid(span.x2),
        z2: ftToGrid(span.z2),
        span: {
          x1: ftToGrid(span.x1),
          z1: ftToGrid(span.z1),
          x2: ftToGrid(span.x2),
          z2: ftToGrid(span.z2),
        },
        widthFt: spanWidth(span),
        heightFt: kind === 'window' ? 4 : 7,
        sourceBounds: sourceBoundsFromAnchor(opening, floor),
        sourceAnchorId: opening.sourceAnchorId ?? opening.id,
        roomIds,
        source,
      };
    })
    .filter((opening): opening is SourceOpeningSegment => opening !== null);

  const windows = (artifact.windows ?? [])
    .filter((window) => window.span)
    .map((window) => {
      const floor = window.floor ?? 0;
      const span = sourceSpanFromAnchor(window, floor) ?? mapSpan(window.span!, floor);
      return {
        id: window.id,
        wallId: window.wallId,
        floor,
        kind: 'window' as const,
        openingType: 'window' as const,
        windowKind: window.windowKind ?? window.type,
        sillType: window.sillType,
        x1: ftToGrid(span.x1),
        z1: ftToGrid(span.z1),
        x2: ftToGrid(span.x2),
        z2: ftToGrid(span.z2),
        span: {
          x1: ftToGrid(span.x1),
          z1: ftToGrid(span.z1),
          x2: ftToGrid(span.x2),
          z2: ftToGrid(span.z2),
        },
        widthFt: spanWidth(span),
        heightFt: 4,
        sourceBounds: sourceBoundsFromAnchor(window, floor),
        sourceAnchorId: window.id,
        roomIds: window.roomIds ?? [window.roomId].filter((id): id is string => Boolean(id)),
        source,
      };
    });

  return [...doorSegments, ...openings, ...windows];
}

function alignSourceOpeningsToSourceWalls(
  openings: SourceOpeningSegment[],
  walls: SourceWallSegment[],
): SourceOpeningSegment[] {
  const tolerance = 0.12;
  const wallVertical = (wall: SourceWallSegment) => (
    Math.abs(wall.x1 - wall.x2) < tolerance ||
    Boolean(wall.bounds && wall.bounds.d > wall.bounds.w * 1.25)
  );
  const wallHorizontal = (wall: SourceWallSegment) => (
    Math.abs(wall.z1 - wall.z2) < tolerance ||
    Boolean(wall.bounds && wall.bounds.w > wall.bounds.d * 1.25)
  );
  const wallCenterX = (wall: SourceWallSegment) => (
    wall.bounds ? wall.bounds.x + wall.bounds.w / 2 : (wall.x1 + wall.x2) / 2
  );
  const wallCenterZ = (wall: SourceWallSegment) => (
    wall.bounds ? wall.bounds.z + wall.bounds.d / 2 : (wall.z1 + wall.z2) / 2
  );
  const wallMinZ = (wall: SourceWallSegment) => (
    wall.bounds ? wall.bounds.z : Math.min(wall.z1, wall.z2)
  );
  const wallMaxZ = (wall: SourceWallSegment) => (
    wall.bounds ? wall.bounds.z + wall.bounds.d : Math.max(wall.z1, wall.z2)
  );
  const wallMinX = (wall: SourceWallSegment) => (
    wall.bounds ? wall.bounds.x : Math.min(wall.x1, wall.x2)
  );
  const wallMaxX = (wall: SourceWallSegment) => (
    wall.bounds ? wall.bounds.x + wall.bounds.w : Math.max(wall.x1, wall.x2)
  );
  const matchesHost = (opening: SourceOpeningSegment, wall: SourceWallSegment) => {
    if (!opening.wallId) return false;
    const wallId = wall.id ?? '';
    const sourceId = wall.sourceAnchorId ?? '';
    const baseWallId = wallId.replace(/:seg-\d+$/i, '');
    const baseSourceId = sourceId.replace(/:seg-\d+$/i, '');
    return opening.wallId === wallId || opening.wallId === sourceId || opening.wallId === baseWallId || opening.wallId === baseSourceId;
  };
  return openings.map((opening) => {
    if (!opening.wallId) return opening;
    const hostWalls = walls.filter((wall) => matchesHost(opening, wall) && (wall.floor ?? 0) === (opening.floor ?? 0));
    if (!hostWalls.length) return opening;
    const verticalHosts = hostWalls.filter(wallVertical);
    const horizontalHosts = hostWalls.filter(wallHorizontal);
    const openingVertical = Math.abs(opening.x1 - opening.x2) < tolerance;
    const openingHorizontal = Math.abs(opening.z1 - opening.z2) < tolerance;
    const openingGridLength = Math.max(
      0.15,
      (opening.widthFt ?? gridSpanWidth(opening.span ?? opening)) / 4,
    );
    const preferVerticalHost = verticalHosts.length > 0 && (
      !horizontalHosts.length ||
      openingVertical ||
      !openingHorizontal
    );
    const preferHorizontalHost = horizontalHosts.length > 0 && (
      !verticalHosts.length ||
      openingHorizontal ||
      !openingVertical
    );
    if (preferVerticalHost) {
      const x = verticalHosts.reduce((sum, wall) => sum + wallCenterX(wall), 0) / verticalHosts.length;
      if (!openingVertical) {
        const minHostZ = Math.min(...verticalHosts.map(wallMinZ));
        const maxHostZ = Math.max(...verticalHosts.map(wallMaxZ));
        const halfLength = openingGridLength / 2;
        const rawCenterZ = (opening.z1 + opening.z2) / 2;
        const centerZ = Math.min(Math.max(rawCenterZ, minHostZ + halfLength), maxHostZ - halfLength);
        const z1 = centerZ - openingGridLength / 2;
        const z2 = centerZ + openingGridLength / 2;
        return {
          ...opening,
          x1: x,
          x2: x,
          z1,
          z2,
          span: { x1: x, z1, x2: x, z2 },
        };
      }
      return {
        ...opening,
        x1: x,
        x2: x,
        span: { ...(opening.span ?? opening), x1: x, x2: x },
      };
    }
    if (preferHorizontalHost) {
      const z = horizontalHosts.reduce((sum, wall) => sum + wallCenterZ(wall), 0) / horizontalHosts.length;
      if (!openingHorizontal) {
        const minHostX = Math.min(...horizontalHosts.map(wallMinX));
        const maxHostX = Math.max(...horizontalHosts.map(wallMaxX));
        const halfLength = openingGridLength / 2;
        const rawCenterX = (opening.x1 + opening.x2) / 2;
        const centerX = Math.min(Math.max(rawCenterX, minHostX + halfLength), maxHostX - halfLength);
        const x1 = centerX - openingGridLength / 2;
        const x2 = centerX + openingGridLength / 2;
        return {
          ...opening,
          x1,
          x2,
          z1: z,
          z2: z,
          span: { x1, z1: z, x2, z2: z },
        };
      }
      return {
        ...opening,
        z1: z,
        z2: z,
        span: { ...(opening.span ?? opening), z1: z, z2: z },
      };
    }
    return opening;
  });
}

function sourceSpaceFaces(
  artifact: PairedArtifact,
  mapPoint: (point: { x: number; z: number }, floor?: number) => { x: number; z: number },
  roomLabelById: Map<string, string> = new Map(),
): SourceSpaceFace[] {
  const roomFaces = artifact.rooms.filter((room) => !isExteriorHelperArtifactRoom(room)).map((room) => {
    const floor = room.floor ?? 0;
    const points = (room.polygon?.length ? room.polygon : [
      { x: room.bounds?.x ?? 0, z: room.bounds?.z ?? 0 },
      { x: (room.bounds?.x ?? 0) + (room.bounds?.w ?? 1), z: room.bounds?.z ?? 0 },
      { x: (room.bounds?.x ?? 0) + (room.bounds?.w ?? 1), z: (room.bounds?.z ?? 0) + (room.bounds?.d ?? 1) },
      { x: room.bounds?.x ?? 0, z: (room.bounds?.z ?? 0) + (room.bounds?.d ?? 1) },
    ]).map((point) => mapPoint(point, floor));
    const minX = Math.min(...points.map((point) => point.x));
    const minZ = Math.min(...points.map((point) => point.z));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxZ = Math.max(...points.map((point) => point.z));
    return {
      id: room.id,
      floor,
      gx: ftToGrid(minX),
      gz: ftToGrid(minZ),
      gw: Math.max(0.05, ftToGrid(maxX - minX)),
      gd: Math.max(0.05, ftToGrid(maxZ - minZ)),
      roomIds: [cleanLabel(room.label, room.id)],
      area: Math.round(polygonArea(points)),
      source: 'paired_gpt_floorplan_v1',
    };
  });
  const explicitFaces = (artifact.spaceFaces ?? []).flatMap((face): SourceSpaceFace[] => {
    const floor = face.floor ?? 0;
    const rawPoints = face.polygon?.length ? face.polygon : face.bounds ? [
      { x: face.bounds.x, z: face.bounds.z },
      { x: face.bounds.x + face.bounds.w, z: face.bounds.z },
      { x: face.bounds.x + face.bounds.w, z: face.bounds.z + face.bounds.d },
      { x: face.bounds.x, z: face.bounds.z + face.bounds.d },
    ] : [];
    const points = rawPoints.map((point) => mapPoint(point, floor));
    const parts = face.parts?.map((part) => {
      if (
        typeof part.gx === 'number' &&
        typeof part.gz === 'number' &&
        typeof part.gw === 'number' &&
        typeof part.gd === 'number'
      ) {
        return { gx: part.gx, gz: part.gz, gw: part.gw, gd: part.gd };
      }
      if (
        typeof part.x === 'number' &&
        typeof part.z === 'number' &&
        typeof part.w === 'number' &&
        typeof part.d === 'number'
      ) {
        const p1 = mapPoint({ x: part.x, z: part.z }, floor);
        const p2 = mapPoint({ x: part.x + part.w, z: part.z + part.d }, floor);
        return {
          gx: ftToGrid(Math.min(p1.x, p2.x)),
          gz: ftToGrid(Math.min(p1.z, p2.z)),
          gw: Math.max(0.05, ftToGrid(Math.abs(p2.x - p1.x))),
          gd: Math.max(0.05, ftToGrid(Math.abs(p2.z - p1.z))),
        };
      }
      return null;
    }).filter((part): part is { gx: number; gz: number; gw: number; gd: number } => Boolean(part));
    const mappedParts = points.length
      ? (() => {
          const minX = Math.min(...points.map((point) => point.x));
          const minZ = Math.min(...points.map((point) => point.z));
          const maxX = Math.max(...points.map((point) => point.x));
          const maxZ = Math.max(...points.map((point) => point.z));
          return [{ gx: ftToGrid(minX), gz: ftToGrid(minZ), gw: Math.max(0.05, ftToGrid(maxX - minX)), gd: Math.max(0.05, ftToGrid(maxZ - minZ)) }];
        })()
      : (parts ?? []);
    if (!mappedParts.length) return [];
    const gx = Math.min(...mappedParts.map((part) => part.gx));
    const gz = Math.min(...mappedParts.map((part) => part.gz));
    const maxGx = Math.max(...mappedParts.map((part) => part.gx + part.gw));
    const maxGz = Math.max(...mappedParts.map((part) => part.gz + part.gd));
    const roomIds = [
      ...(face.roomIds ?? []).map((id) => roomLabelById.get(id) ?? id),
      ...(face.roomId ? [roomLabelById.get(face.roomId) ?? face.roomId] : []),
    ].filter(Boolean);
    return [{
      id: face.id,
      floor,
      kind: face.kind,
      type: face.type,
      roomId: face.roomId,
      gx,
      gz,
      gw: Math.max(0.05, maxGx - gx),
      gd: Math.max(0.05, maxGz - gz),
      parts: mappedParts,
      roomIds: [...new Set(roomIds)],
      area: points.length ? Math.round(polygonArea(points)) : undefined,
      sourceAnchorId: face.sourceAnchorId,
      sourceAnchorIds: face.sourceAnchorIds,
      symbolVariant: face.symbolVariant,
      source: face.source ?? 'paired_gpt_floorplan_v1',
    }];
  });
  return [...roomFaces, ...explicitFaces];
}

function artifactInfo(planId: string, option: ProposalAvailability): PairedPlanArtifactInfo {
  const drawingStyleProfileUrl = option.pairedDrawingStyleProfileUrl
    ?? (option.pairedJsonUrl ? option.pairedJsonUrl.replace(/\.paired\.json$/i, '.drawing-style.json') : undefined);
  return {
    planId,
    proposalId: option.id,
    artifactVersion: option.artifactVersion ?? 'paired_gpt_floorplan_v1',
    sourceImageUrl: `/data/den-image-loop/${planId}/${option.imageUrl}`,
    deterministicRenderUrl: option.deterministicRenderUrl ? `/data/den-image-loop/${planId}/${option.deterministicRenderUrl}` : undefined,
    pairedJsonUrl: `/data/den-image-loop/${planId}/${option.pairedJsonUrl}`,
    drawingStyleProfileUrl: drawingStyleProfileUrl ? `/data/den-image-loop/${planId}/${drawingStyleProfileUrl}` : undefined,
    validationUrl: option.pairedValidationUrl ? `/data/den-image-loop/${planId}/${option.pairedValidationUrl}` : undefined,
    visualReviewUrl: option.pairedVisualReviewUrl ? `/data/den-image-loop/${planId}/${option.pairedVisualReviewUrl}` : undefined,
    visualDriftUrl: option.pairedVisualDriftUrl ? `/data/den-image-loop/${planId}/${option.pairedVisualDriftUrl}` : undefined,
    promotionEligible: option.promotionEligible === true,
    reviewStatus: option.pairedReviewStatus ?? null,
    blockers: option.blockers ?? [],
  };
}

function artifactBedBath(artifact: PairedArtifact): string {
  const counts = artifactProgramCounts(artifact);
  if (counts.bedrooms > 0 && counts.baths > 0) {
    return `${counts.bedrooms}/${Number.isInteger(counts.baths) ? counts.baths : counts.baths.toFixed(1)}`;
  }
  return '';
}

function artifactProgramCounts(artifact: PairedArtifact): { bedrooms: number; baths: number } {
  const bedrooms = artifact.rooms.filter((room) => {
    const text = `${room.type ?? ''} ${room.label ?? ''}`.toLowerCase();
    return text.includes('bedroom') || text.includes('master') || text.includes('primary');
  }).length;
  const baths = artifact.rooms.reduce((total, room) => {
    const text = `${room.type ?? ''} ${room.label ?? ''}`.toLowerCase();
    if (text.includes('half_bath') || text.includes('powder')) return total + 0.5;
    if (text.includes('bath') || text.includes('ensuite')) return total + 1;
    return total;
  }, 0);
  return { bedrooms, baths };
}

function roofSemanticsForArtifact(
  artifact: PairedArtifact,
  roofStyle: string,
  height: number,
): RoofSemantics {
  const roofBlockers: string[] = [];
  if (!artifact.roof?.planes?.length) roofBlockers.push('missing roof planes');
  if (!Array.isArray(artifact.elevations) || artifact.elevations.length < 2) roofBlockers.push('missing front/side elevations');
  for (const plane of artifact.roof?.planes ?? []) {
    const minimumPoints = plane.role === 'roof-plane' ? 3 : 2;
    if (!plane.points?.length || plane.points.length < minimumPoints) {
      roofBlockers.push(`${plane.id ?? 'roof plane'} has fewer than ${minimumPoints} points`);
    }
  }
  if (artifact.elevations?.some((elevation) => !elevation.outline?.length || elevation.outline.length < 3)) {
    roofBlockers.push('elevation outline has fewer than 3 points');
  }
  const hasPairedRoof = Boolean(artifact.roof && roofBlockers.length === 0);
  if (hasPairedRoof && artifact.roof) {
    return {
      source: 'paired-json',
      status: 'validated',
      style: artifact.roof.style ?? roofStyle,
      ridgeAxis: artifact.roof.ridgeAxis ?? 'x',
      ridgeHeightFt: artifact.roof.ridgeHeightFt ?? height,
      eaveHeightFt: artifact.roof.eaveHeightFt ?? (roofStyle === 'a-frame' ? 0.35 : Math.max(7, height * 0.45)),
      overhangFt: artifact.roof.overhangFt ?? 1.25,
      roofThicknessFt: artifact.roof.roofThicknessFt ?? 0.35,
      planes: artifact.roof.planes,
      elevations: artifact.elevations,
      blockers: [],
    };
  }
  return {
    source: 'inferred-provisional',
    status: 'provisional',
    style: roofStyle,
    ridgeAxis: 'x',
    ridgeHeightFt: height,
    eaveHeightFt: roofStyle === 'a-frame' ? 0.35 : Math.max(7, height * 0.45),
    overhangFt: 1.25,
    roofThicknessFt: 0.35,
    blockers: roofBlockers.length ? roofBlockers : ['paired roof/elevation JSON is missing'],
  };
}

function pairedToDenHome(
  artifact: PairedArtifact,
  option: ProposalAvailability,
): DenHome {
  const footprint = footprintDimensions(artifact.footprint);
  const coords = pairedCoordinateMapper(artifact, footprint);
  const calloutAnchors = calloutAnchorsByKey(artifact, footprint);
  const roomById = new Map<string, RoomLayout>();
  const semanticArtifactRooms = artifact.rooms.filter((room) => !isExteriorHelperArtifactRoom(room));
  const rooms = semanticArtifactRooms.map((room) => {
    const floor = room.floor ?? 0;
    const calloutKey = artifactRoomCalloutKey(room);
    const points = (room.polygon?.length ? room.polygon : room.bounds ? [
      { x: room.bounds.x, z: room.bounds.z },
      { x: room.bounds.x + room.bounds.w, z: room.bounds.z },
      { x: room.bounds.x + room.bounds.w, z: room.bounds.z + room.bounds.d },
      { x: room.bounds.x, z: room.bounds.z + room.bounds.d },
    ] : [{ x: 0, z: 0 }]).map((point) => coords.toFtPoint(point, floor));
    const minX = Math.min(...points.map((point) => point.x));
    const minZ = Math.min(...points.map((point) => point.z));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxZ = Math.max(...points.map((point) => point.z));
    const type = pairedRoomType(room.type);
    const roomCenter = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    const calloutAnchor = calloutKey
      ? nearestCalloutAnchor(calloutAnchors.get(`${floor}:${calloutKey}`), roomCenter)
      : undefined;
    const sourceCalloutAnchor = roomSourceCalloutAnchor(room, { minX, minZ, maxX, maxZ });
    const layout: RoomLayout = {
      label: cleanLabel(room.label, room.id),
      type,
      proposalNumber: pairedProposalNumber(room),
      gx: ftToGrid(minX),
      gz: ftToGrid(minZ),
      gw: Math.max(0.25, ftToGrid(maxX - minX)),
      gd: Math.max(0.25, ftToGrid(maxZ - minZ)),
      area: Math.round(polygonArea(points)),
      color: ROOM_COLORS[type] || '#e4ded3',
      constraints: 'paired_gpt_floorplan_v1',
      floor,
      spaceFaceId: room.id,
      anchor: sourceCalloutAnchor
        ? { gx: ftToGrid(sourceCalloutAnchor.x), gz: ftToGrid(sourceCalloutAnchor.z) }
        : calloutAnchor
        ? { gx: ftToGrid(calloutAnchor.x), gz: ftToGrid(calloutAnchor.z) }
        : room.labelAnchor ? (() => {
        const anchor = coords.toFtPoint(room.labelAnchor!, floor);
        return { gx: ftToGrid(anchor.x), gz: ftToGrid(anchor.z) };
      })() : undefined,
      fixtures: [],
    };
    roomById.set(room.id, layout);
    return layout;
  });

  for (const fixture of artifact.fixtures ?? []) {
    const room = roomById.get(fixture.roomId);
    if (!room) continue;
    const fixtureFloor = fixture.floor ?? room.floor ?? 0;
    const sourceFixtureBounds = sourcePixelBoundsToFtBounds(sourceAnchorPixelBounds(artifact, fixture), sourceFrameForFloorArtifact(artifact, footprint, fixtureFloor));
    const usableSourceFixtureBounds = sourceFixtureBounds && sourceFixtureBounds.w >= 0.35 && sourceFixtureBounds.d >= 0.35
      ? sourceFixtureBounds
      : undefined;
    // Paired semantic JSON is the render source of truth. Source anchors are
    // evidence from the GPT proposal and only a fallback for legacy fixtures
    // that do not yet carry semantic bounds.
    const semanticFixtureBounds = fixture.bounds
      ? coords.toFtBounds(fixture.bounds, fixtureFloor)
      : undefined;
    const bounds = semanticFixtureBounds ?? usableSourceFixtureBounds ?? { x: 0, z: 0, w: 0.5, d: 0.5 };
    const category = pairedFixtureCategory(fixture);
    const wallSide = fixture.wallAnchor?.side ?? fixture.wallAnchor?.edge;
    const facingDirection = fixture.facingDirection ?? facingFromWallSide(wallSide, 'N');
    const parts = fixture.parts?.map((part) => {
      if (
        typeof part.x === 'number' &&
        typeof part.z === 'number' &&
        typeof part.w === 'number' &&
        typeof part.d === 'number'
      ) {
        const partBounds = coords.toFtBounds({ x: part.x, z: part.z, w: part.w, d: part.d }, fixture.floor ?? room.floor ?? 0);
        return {
          type: part.type,
          x: ftToGrid(partBounds.x),
          z: ftToGrid(partBounds.z),
          w: ftToGrid(partBounds.w),
          d: ftToGrid(partBounds.d),
          rotationDeg: part.rotationDeg,
        };
      }
      if (Array.isArray(part.center) && typeof part.radius === 'number') {
        const center = coords.toFtPoint({ x: part.center[0], z: part.center[1] }, fixture.floor ?? room.floor ?? 0);
        return {
          type: part.type,
          center: [ftToGrid(center.x), ftToGrid(center.z)] as [number, number],
          radius: ftToGrid(part.radius),
          rotationDeg: part.rotationDeg,
        };
      }
      return { type: part.type, rotationDeg: part.rotationDeg };
    }).filter((part) => (
      typeof part.x === 'number' ||
      Array.isArray(part.center)
    ));
    const mapped: RoomFixture = {
      id: fixture.id,
      fixtureId: fixture.id,
      category,
      type: pairedFixtureType(fixture.type),
      wall: pairedWall(wallSide),
      x: ftToGrid(bounds.x),
      z: ftToGrid(bounds.z),
      w: ftToGrid(bounds.w),
      d: ftToGrid(bounds.d),
      rotationDeg: fixture.rotationDeg ?? rotationFromFacing(facingDirection),
      rotationSource: typeof fixture.rotationDeg === 'number' ? 'explicit' : 'inferred',
      facingDirection,
      anchorWallId: fixture.anchorWallId ?? fixture.wallAnchor?.wallId,
      wallSide,
      symbolVariant: fixture.symbolVariant,
      sourceAnchorId: fixture.sourceAnchorId ?? fixture.id,
      bimClass: fixture.bimClass ?? pairedFixtureBimClass(category, fixture.type),
      desc: fixture.type.replaceAll('_', ' '),
      roomId: fixture.roomId,
      parts,
      clearance: fixture.clearance && typeof fixture.clearance.x === 'number' && typeof fixture.clearance.z === 'number'
        ? {
          x: ftToGrid(fixture.clearance.x),
          z: ftToGrid(fixture.clearance.z),
          w: ftToGrid(fixture.clearance.w ?? 0),
          d: ftToGrid(fixture.clearance.d ?? 0),
        }
        : fixture.clearance,
      source: 'parser',
    };
    room.fixtures = [...(room.fixtures ?? []), mapped];
  }

  const roomLabelById = new Map(semanticArtifactRooms.map((room) => [room.id, cleanLabel(room.label, room.id)]));
  const connectionsByKey = new Map<string, RoomConnection>();
  for (const opening of artifact.openings ?? []) {
    const connection = openingToConnection(opening, roomLabelById, coords.toFtSpan);
    if (!connection) continue;
    connectionsByKey.set(`${connection.from}->${connection.to}:${connection.type}:${connection.opening?.source ?? ''}`, connection);
  }

  const roofStyle = artifact.roof?.style ?? (artifact.rooms.some((room) => (room.floor ?? 0) > 0) ? 'a-frame' : 'gable');
  const height = roofStyle === 'a-frame' ? 21 : roofStyle === 'steep-gable' ? 18 : 16;
  const info = artifactInfo(artifact.planId, option);
  const bedBath = artifactBedBath(artifact);
  const sourceWalls = sourceWallSegments(artifact, coords.toFtSpan, coords.toFtBounds);
  const sourceOpenings = alignSourceOpeningsToSourceWalls(
    sourceOpeningSegments(artifact, coords.toFtSpan, footprint),
    sourceWalls,
  );
  const spaceFaces = sourceSpaceFaces(artifact, coords.toFtPoint, roomLabelById);
  const dimensionLines = sourceDimensionLines(artifact, coords.toFtSpan);
  const floorFrames = coords.frames.map((frame) => ({
    floor: frame.floor,
    gx: 0,
    gz: 0,
    gw: ftToGrid(frame.widthFt),
    gd: ftToGrid(frame.depthFt),
    showWidthDimension: frame.showWidthDimension,
    showDepthDimension: frame.showDepthDimension,
    widthSourceAnchorId: frame.widthSourceAnchorId,
    depthSourceAnchorId: frame.depthSourceAnchorId,
  }));
  const home: DenHome = {
    id: artifact.planId,
    model: cleanPlanName(artifact.name ?? artifact.planId),
    sqft: Math.round(rooms.reduce((sum, room) => sum + room.area, 0)),
    footprint,
    height,
    bedBath,
    roofStyle,
    roofSemantics: roofSemanticsForArtifact(artifact, roofStyle, height),
    hasLoft: rooms.some((room) => (room.floor ?? 0) > 0),
    loftHeight: rooms.some((room) => (room.floor ?? 0) > 0) ? 8 : undefined,
    placements: [],
    componentsUsed: [],
    rooms,
    connections: [...connectionsByKey.values()],
    sourceWalls,
    sourceOpenings,
    spaceFaces,
    dimensionLines,
    dimensionFrame: { gx: 0, gz: 0, gw: ftToGrid(footprint.width), gd: ftToGrid(footprint.depth) },
    floorFrames,
    pairedArtifact: true,
    pairedArtifactJson: artifact,
    drawingStyleProfile: artifact.drawingStyleProfile,
    pairedProposalId: artifact.proposalId,
    pairedArtifactInfo: info,
    parserStatus: info.artifactVersion,
  };
  const buildValidation = validateBuildability(home);
  home.buildValidation = buildValidation;
  home.componentsUsed = buildValidation.componentsUsed;
  return home;
}

export function pairedArtifactToLocalHome(input: unknown, sourceImageUrl = ''): DenHome {
  const artifact = input as PairedArtifact;
  if (!artifact || typeof artifact !== 'object') {
    throw new Error('paired artifact must be a JSON object');
  }
  if (!artifact.planId || !artifact.proposalId || !artifact.footprint || !Array.isArray(artifact.rooms)) {
    throw new Error('paired artifact needs planId, proposalId, footprint, and rooms');
  }
  const option: ProposalAvailability = {
    id: artifact.proposalId,
    imageUrl: '',
    pairedArtifact: true,
    pairedJsonUrl: '',
    artifactVersion: artifact.schemaVersion ?? 'paired_gpt_floorplan_v1',
    promotionEligible: false,
    pairedReviewStatus: 'pending',
    blockers: ['local import needs deterministic validation before promotion'],
  };
  const home = pairedToDenHome(artifact, option);
  home.pairedArtifactInfo = {
    ...home.pairedArtifactInfo!,
    sourceImageUrl,
    deterministicRenderUrl: undefined,
    pairedJsonUrl: '',
    validationUrl: undefined,
    visualReviewUrl: undefined,
    visualDriftUrl: undefined,
    promotionEligible: false,
    reviewStatus: 'pending',
    blockers: ['local import needs deterministic validation before promotion'],
  };
  home.parserStatus = `${home.parserStatus ?? 'paired_gpt_floorplan_v1'} local-import`;
  return home;
}

function promotedOptions(manifest: ProposalManifest | null): Array<{ planId: string; option: ProposalAvailability }> {
  return Object.entries(manifest?.plans ?? {}).flatMap(([planId, options]) => (
    (options ?? [])
      .filter((option) => (
        option.promotionEligible === true
        && option.pairedArtifact === true
        && option.gptSourceReady !== false
        && option.pairedValidationReady === true
        && option.pairedVisualDriftReady === true
        && option.pairedVisualReviewReady === true
        && Boolean(option.imageUrl)
        && Boolean(option.pairedJsonUrl)
        && Boolean(option.deterministicRenderUrl)
      ))
      .map((option) => ({ planId, option }))
  ));
}

function reviewableLatestOptions(manifest: ProposalManifest | null): Array<{ planId: string; option: ProposalAvailability }> {
  // Review lane accepts JSON-only artifacts: the paired semantic JSON is the
  // source of truth, so a GPT proposal image, stored render, and validation
  // sidecar are optional evidence here. In-app validation lanes still gate
  // the plan, and promotedOptions keeps the strict requirements.
  return Object.entries(manifest?.plans ?? {}).flatMap(([planId, options]) => (
    (options ?? [])
      .filter((option) => (
        option.pairedArtifact === true
        && option.archived !== true
        && (option.latestPairedArtifact === true || option.latestGptPairedArtifact === true)
        && option.pairedValidationReady !== false
        && Boolean(option.pairedJsonUrl)
      ))
      .map((option) => ({ planId, option }))
  ));
}

async function loadPromotedPairedHomes(): Promise<DenHome[]> {
  const manifestRes = await fetch(`/data/den-image-loop/proposal-manifest.json?t=${Date.now()}`, { cache: 'no-store' });
  pairedManifest = manifestRes.ok ? await manifestRes.json() : null;

  try {
    const queueRes = await fetch(`/data/den-image-loop/paired-generation-queue.json?t=${Date.now()}`, { cache: 'no-store' });
    pairedGenerationQueue = queueRes.ok ? await queueRes.json() : null;
  } catch {
    pairedGenerationQueue = null;
  }

  const homesOut: DenHome[] = [];
  const byKey = new Map<string, { planId: string; option: ProposalAvailability }>();
  for (const item of [...promotedOptions(pairedManifest), ...reviewableLatestOptions(pairedManifest)]) {
    byKey.set(`${item.planId}/${item.option.id}`, item);
  }
  const selectedOptions = [...byKey.values()];

  for (const { planId, option } of selectedOptions) {
    try {
      if (!option.pairedJsonUrl) continue;
      const artifactRes = await fetch(`/data/den-image-loop/${planId}/${option.pairedJsonUrl}?t=${Date.now()}`, { cache: 'no-store' });
      if (!artifactRes.ok) continue;
      const artifact = await artifactRes.json() as PairedArtifact;
      const home = pairedToDenHome(artifact, option);
      const drawingStyleProfileUrl = option.pairedDrawingStyleProfileUrl
        ?? option.pairedJsonUrl.replace(/\.paired\.json$/i, '.drawing-style.json');
      if (drawingStyleProfileUrl) {
        try {
          const styleRes = await fetch(`/data/den-image-loop/${planId}/${drawingStyleProfileUrl}?t=${Date.now()}`, { cache: 'no-store' });
          if (styleRes.ok) home.drawingStyleProfile = await styleRes.json() as DrawingStyleProfile;
        } catch {
          // Drawing style sidecars are optional for stale/archived artifacts.
        }
      }
      if (option.pairedVisualDriftUrl && home.pairedArtifactInfo) {
        try {
          const driftRes = await fetch(`/data/den-image-loop/${planId}/${option.pairedVisualDriftUrl}?t=${Date.now()}`, { cache: 'no-store' });
          if (driftRes.ok) home.pairedArtifactInfo.visualDrift = await driftRes.json();
        } catch {
          // Visual drift remains optional evidence; validation will warn if missing.
        }
      }
      homesOut.push(home);
    } catch (error) {
      console.error(`Failed to load paired artifact ${planId}/${option.id}`, error);
    }
  }

  return homesOut.sort((a, b) => a.sqft - b.sqft);
}

async function loadComponentCatalog(): Promise<ModularComponent[]> {
  try {
    const res = await fetch(`/data/components.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body as ModularComponent[] : [];
  } catch {
    return [];
  }
}

export async function refreshData(): Promise<void> {
  try {
    const [componentCatalog, pairedHomes] = await Promise.all([
      loadComponentCatalog(),
      loadPromotedPairedHomes(),
    ]);
    homes = pairedHomes;
    components = componentCatalog.map((component) => ({
      ...component,
      usedInHomes: pairedHomes
        .filter((home) => home.componentsUsed.includes(component.id))
        .map((home) => home.id),
    }));
    coverage = Object.fromEntries(pairedHomes.map((home) => [
      home.id,
      Object.fromEntries(components.map((component) => [component.id, home.componentsUsed.includes(component.id)])),
    ]));
  } catch (error) {
    console.error('Failed to refresh paired floorplan data', error);
    homes = [];
    components = [];
    coverage = {};
  }
}

export function getHome(id: string): DenHome | undefined {
  return homes.find((home) => home.id === id);
}

export function getComponent(id: string): ModularComponent | undefined {
  return components.find((component) => component.id === id);
}

export function getComponentsForHome(homeId: string): ModularComponent[] {
  const home = getHome(homeId);
  if (!home) return [];
  return home.componentsUsed
    .map((id) => getComponent(id))
    .filter((component): component is ModularComponent => component !== undefined);
}
