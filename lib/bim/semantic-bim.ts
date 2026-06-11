import type { DenHome, RoomFixture, RoomLayout, RoofPlane, SourceOpeningSegment, SourceWallSegment } from '@/lib/types';
import { resolveBimComponent, type BimComponentDefinition } from './component-registry';
import { resolveLocalBimAsset, resolveVisualAsset, visualAssetMode } from './component-assets';

const GRID_FT = 4;
const FT_TO_M = 0.3048;

export type SemanticBimCategory =
  | 'space'
  | 'openZone'
  | 'void'
  | 'wall'
  | 'guardrail'
  | 'slab'
  | 'deck'
  | 'opening'
  | 'door'
  | 'window'
  | 'stair'
  | 'roofPlane'
  | 'sanitaryTerminal'
  | 'furniture'
  | 'equipment'
  | 'fixtureProxy';

export interface SemanticBimBounds {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface SemanticBimPart {
  type: string;
  bounds?: SemanticBimBounds;
  rotationDeg?: number;
}

export interface SemanticBimSegment {
  x1: number;
  y1: number;
  z1: number;
  x2: number;
  y2: number;
  z2: number;
  thickness: number;
  height: number;
}

export interface SemanticBimElement {
  id: string;
  sourceId?: string;
  sourceRoomId?: string;
  sourceAnchorId?: string;
  floor: number;
  category: SemanticBimCategory;
  ifcClass: string;
  name: string;
  bounds?: SemanticBimBounds;
  parts?: SemanticBimPart[];
  segment?: SemanticBimSegment;
  points?: Array<{ x: number; y: number; z: number }>;
  rotationDeg?: number;
  metadata?: Record<string, string | number | boolean | null | undefined>;
  component?: BimComponentDefinition;
}

export interface SemanticBimStorey {
  id: string;
  floor: number;
  name: string;
  elevationFt: number;
  elevationM: number;
}

export interface SemanticBimModel {
  schemaVersion: 'semantic_bim_v1';
  source: 'paired_semantic_json';
  units: {
    source: 'ft';
    bim: 'm';
    feetToMeters: number;
  };
  planId: string;
  proposalId?: string;
  name: string;
  footprint: { widthFt: number; depthFt: number; widthM: number; depthM: number };
  storeys: SemanticBimStorey[];
  elements: SemanticBimElement[];
  validation: SemanticBimValidation;
  ifcExport: {
    status: 'experimental';
    blockers: string[];
  };
}

export interface SemanticBimValidation {
  status: 'pass' | 'warning' | 'blocked';
  blockers: string[];
  warnings: string[];
  counts: Record<SemanticBimCategory | 'total', number>;
}

function ft(value: number | undefined, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function m(valueFt: number) {
  return Number((valueFt * FT_TO_M).toFixed(4));
}

function roomText(room: Pick<RoomLayout, 'type' | 'label'>) {
  return `${room.type ?? ''} ${room.label ?? ''}`.toLowerCase();
}

function isVoidRoom(room: Pick<RoomLayout, 'type' | 'label'>) {
  return /void|open.to.below/i.test(roomText(room));
}

function isDeckRoom(room: Pick<RoomLayout, 'type' | 'label'>) {
  return /deck|porch|patio|exterior|balcony|terrace/i.test(roomText(room));
}

function isOpenRoom(room: Pick<RoomLayout, 'type' | 'label'>) {
  return /open|living|dining|kitchen|great.room|studio|ldk/i.test(roomText(room));
}

function isStairRoom(room: Pick<RoomLayout, 'type' | 'label'>) {
  return /stair|ladder/i.test(roomText(room));
}

function wallKindText(wall: SourceWallSegment) {
  return `${wall.id ?? ''} ${wall.wallKind ?? ''} ${wall.source ?? ''}`.toLowerCase();
}

function isVoidMarkerWall(wall: SourceWallSegment) {
  return /voidmarker|opentobelow|open.to.below|open-to-below|stair-void-boundary|dashed|overhead/.test(wallKindText(wall));
}

function isGuardrailWall(wall: SourceWallSegment) {
  const explicitKind = `${wall.wallKind ?? ''}`.toLowerCase();
  if (
    /^(solidexterior|glazedexterior|exterior-wall|a-frame-wall-band|source-wall)$/.test(explicitKind) ||
    /partition|door-host/.test(explicitKind)
  ) {
    return false;
  }
  return /guardrail|guard.rail|railing|guard.edge|lowguard|low.guard|deck.*edge|deck.*rail|outer.rail|loft.opening.edge|stair.guardrail|entry.low.wall|low.wall|rail\b/.test(wallKindText(wall));
}

function roomBounds(room: RoomLayout, elevationFt: number, heightFt: number): SemanticBimBounds {
  return {
    x: room.gx * GRID_FT,
    y: elevationFt,
    z: room.gz * GRID_FT,
    w: room.gw * GRID_FT,
    h: heightFt,
    d: room.gd * GRID_FT,
  };
}

function floorElevation(home: DenHome, floor: number) {
  if (floor <= 0) return 0;
  return home.loftHeight ?? 8;
}

function storeyHeight(home: DenHome, floor: number) {
  if (floor <= 0) return Math.max(7.5, home.loftHeight ?? 8);
  return Math.max(6, home.height - (home.loftHeight ?? 8));
}

function fixtureCategory(fixture: RoomFixture): { category: SemanticBimCategory; ifcClass: string } {
  const primary = [
    fixture.category,
    fixture.type,
    fixture.desc,
    fixture.fixtureId,
    fixture.bimClass,
  ].filter(Boolean).join(' ').toLowerCase();
  const variant = `${fixture.symbolVariant ?? ''}`.toLowerCase();
  const text = [
    primary,
    variant,
  ].filter(Boolean).join(' ');
  if (/open.to.below|open-to-below|void/.test(text)) return { category: 'void', ifcClass: 'IfcOpeningElement' };
  if (/stair|ladder/.test(text)) return { category: 'stair', ifcClass: 'IfcStair' };
  if (/range|stove|cooktop|washer|dryer|laundry|refrigerator|fridge|dishwasher|equipment|appliance|casework|counter|island|cabinet/.test(primary)) {
    return { category: 'equipment', ifcClass: 'IfcBuildingElementProxy' };
  }
  if (/toilet|tub|bath|shower|sink|vanity/.test(primary)) return { category: 'sanitaryTerminal', ifcClass: 'IfcSanitaryTerminal' };
  if (/bed|bunk|pillow|sofa|couch|chair|table|desk|bench|nightstand|shelf|shelves|soft.furniture|soft_furniture|seating|closet|wardrobe|storage/.test(text)) return { category: 'furniture', ifcClass: 'IfcFurniture' };
  if (/range|stove|cooktop|washer|dryer|laundry|refrigerator|fridge|dishwasher|equipment|appliance|casework|counter|island|cabinet/.test(variant)) {
    return { category: 'equipment', ifcClass: 'IfcBuildingElementProxy' };
  }
  if (/toilet|tub|bath|shower|sink|vanity/.test(variant)) return { category: 'sanitaryTerminal', ifcClass: 'IfcSanitaryTerminal' };
  return { category: 'fixtureProxy', ifcClass: 'IfcBuildingElementProxy' };
}

function isStairFixture(fixture: RoomFixture) {
  return /stair|ladder/i.test(`${fixture.category ?? ''} ${fixture.type ?? ''} ${fixture.desc ?? ''} ${fixture.id ?? ''} ${fixture.fixtureId ?? ''} ${fixture.symbolVariant ?? ''}`);
}

function fixtureBounds(room: RoomLayout, fixture: RoomFixture, elevationFt: number): SemanticBimBounds {
  return {
    x: fixture.x * GRID_FT,
    y: elevationFt,
    z: fixture.z * GRID_FT,
    w: Math.max(0.5, fixture.w * GRID_FT),
    h: /window|glass/i.test(`${fixture.type} ${fixture.desc}`) ? 4 : 2.5,
    d: Math.max(0.5, fixture.d * GRID_FT),
  };
}

function fixtureParts(fixture: RoomFixture, elevationFt: number): SemanticBimPart[] | undefined {
  const parts = fixture.parts?.map((part): SemanticBimPart | undefined => {
    if (
      typeof part.x === 'number' &&
      typeof part.z === 'number' &&
      typeof part.w === 'number' &&
      typeof part.d === 'number'
    ) {
      return {
        type: part.type,
        rotationDeg: part.rotationDeg,
        bounds: {
          x: part.x * GRID_FT,
          y: elevationFt,
          z: part.z * GRID_FT,
          w: Math.max(0.25, part.w * GRID_FT),
          h: 2.5,
          d: Math.max(0.25, part.d * GRID_FT),
        },
      };
    }
    if (Array.isArray(part.center) && typeof part.radius === 'number') {
      const radius = Math.max(0.1, part.radius * GRID_FT);
      return {
        type: part.type,
        rotationDeg: part.rotationDeg,
        bounds: {
          x: (part.center[0] * GRID_FT) - radius,
          y: elevationFt,
          z: (part.center[1] * GRID_FT) - radius,
          w: radius * 2,
          h: 2.5,
          d: radius * 2,
        },
      };
    }
    return undefined;
  }).filter((part): part is SemanticBimPart => Boolean(part?.bounds));
  return parts?.length ? parts : undefined;
}

function openingCategory(opening: SourceOpeningSegment): { category: SemanticBimCategory; ifcClass: string } {
  if (opening.kind === 'door') return { category: 'door', ifcClass: 'IfcDoor' };
  if (opening.kind === 'window') return { category: 'window', ifcClass: 'IfcWindow' };
  return { category: 'opening', ifcClass: 'IfcOpeningElement' };
}

function elementCounts(elements: SemanticBimElement[]): SemanticBimValidation['counts'] {
  const counts = { total: elements.length } as SemanticBimValidation['counts'];
  for (const element of elements) {
    counts[element.category] = (counts[element.category] ?? 0) + 1;
  }
  return counts;
}

function validateSemanticBim(home: DenHome, elements: SemanticBimElement[]): SemanticBimValidation {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const counts = elementCounts(elements);
  const expectedWalls = home.sourceWalls?.filter((wall) => !isVoidMarkerWall(wall)).length ?? 0;
  const expectedOpenings = home.sourceOpenings?.length ?? 0;
  const expectedFixtures = home.rooms.reduce((sum, room) => sum + (room.fixtures?.filter((fixture) => !/door_swing|pocket_door|bifold_door/.test(fixture.type)).length ?? 0), 0);
  const mappedWallCount = (counts.wall ?? 0) + (counts.guardrail ?? 0);
  const mappedOpeningCount = (counts.opening ?? 0) + (counts.door ?? 0) + (counts.window ?? 0);
  const mappedFixtureCount = elements.filter((element) => (
    ['sanitaryTerminal', 'furniture', 'equipment', 'fixtureProxy'].includes(element.category) ||
    (['stair', 'void'].includes(element.category) && Boolean(element.sourceAnchorId))
  )).length;

  if (!home.pairedArtifact) blockers.push('active source is not a paired semantic artifact');
  if (expectedWalls && mappedWallCount !== expectedWalls) blockers.push(`BIM wall count ${mappedWallCount} does not match semantic source wall count ${expectedWalls}`);
  if (expectedOpenings && mappedOpeningCount !== expectedOpenings) blockers.push(`BIM opening count ${mappedOpeningCount} does not match semantic opening count ${expectedOpenings}`);
  if (mappedFixtureCount !== expectedFixtures) blockers.push(`BIM fixture count ${mappedFixtureCount} does not match semantic fixture count ${expectedFixtures}`);
  if (!elements.some((element) => element.category === 'slab')) blockers.push('BIM model has no floor slab elements');
  if (!elements.some((element) => element.category === 'roofPlane')) warnings.push('BIM model has no explicit roof-plane elements; roof remains provisional');

  const voidRoomIds = new Set(home.rooms.filter(isVoidRoom).map((room) => room.label));
  const voidAsSolid = elements.some((element) => (
    (element.category === 'wall' || element.category === 'slab') &&
    element.sourceRoomId &&
    voidRoomIds.has(element.sourceRoomId)
  ));
  if (voidAsSolid) blockers.push('void/open-to-below mapped as wall or slab');

  const outOfBounds = elements.filter((element) => {
    const b = element.bounds;
    if (!b) return false;
    return b.x < -0.25 || b.z < -0.25 || b.x + b.w > home.footprint.width + 0.25 || b.z + b.d > home.footprint.depth + 0.25;
  });
  if (outOfBounds.length) warnings.push(`${outOfBounds.length} BIM element(s) extend outside the main footprint; decks/overhangs may be intentional`);

  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'pass',
    blockers,
    warnings,
    counts,
  };
}

function withAssetMetadata(element: SemanticBimElement): SemanticBimElement {
  const component = resolveBimComponent(element);
  const assetText = `${element.name} ${element.metadata?.fixtureType ?? ''} ${component.key}`;
  const localAsset = resolveLocalBimAsset(assetText);
  const visualAsset = resolveVisualAsset(assetText);
  return {
    ...element,
    component,
    metadata: {
      ...element.metadata,
      componentKey: component.key,
      componentLabel: component.label,
      assetKey: component.key,
      assetLabel: component.label,
      localAssetId: localAsset?.id,
      localAssetLabel: localAsset?.label,
      localAssetFile: localAsset?.file,
      visualAssetId: visualAsset?.id,
      visualAssetLabel: visualAsset?.label,
      visualAssetSource: visualAsset?.source,
      visualAssetLicense: visualAsset?.license,
      visualAssetEntrypoint: visualAsset?.entrypoint,
      visualAssetMode: visualAssetMode(localAsset, visualAsset),
      ifcClass: component.ifcClass,
      ifcPredefinedType: component.ifcPredefinedType,
      proceduralFallback: component.proceduralFallback.renderer,
      twoDSymbol: component.twoDSymbol.symbol,
      hostTypes: component.hostConstraints.map((host) => host.hostType).join(','),
      clearanceRuleIds: component.clearanceRules.map((rule) => rule.id).join(','),
      assetSourcePriority: component.marketplaceAssets.map((asset) => asset.sourceId).join(','),
      assetPreferredFormats: [...new Set(component.marketplaceAssets.flatMap((asset) => asset.preferredFormats))].join(','),
    },
  };
}

export function semanticBimFromHome(home: DenHome): SemanticBimModel {
  const floors = [...new Set(home.rooms.map((room) => room.floor ?? 0))].sort((a, b) => a - b);
  const storeys = floors.map((floor) => {
    const elevationFt = floorElevation(home, floor);
    return {
      id: `${home.id}-storey-${floor}`,
      floor,
      name: floor === 0 ? 'Ground Floor' : `Level ${floor}`,
      elevationFt,
      elevationM: m(elevationFt),
    };
  });
  const elements: SemanticBimElement[] = [];

  for (const room of home.rooms) {
    const floor = room.floor ?? 0;
    const elevationFt = floorElevation(home, floor);
    const heightFt = storeyHeight(home, floor);
    const bounds = roomBounds(room, elevationFt, heightFt);
    const isVoid = isVoidRoom(room);
    const isDeck = isDeckRoom(room);
    const isStair = isStairRoom(room);
    const spaceCategory: SemanticBimCategory = isVoid ? 'void' : isOpenRoom(room) ? 'openZone' : 'space';

    elements.push({
      id: `${home.id}-space-${floor}-${room.label}`,
      sourceId: room.label,
      sourceRoomId: room.label,
      floor,
      category: spaceCategory,
      ifcClass: isVoid ? 'IfcOpeningElement' : 'IfcSpace',
      name: room.label,
      bounds,
      metadata: {
        roomType: room.type,
        semanticZone: room.semanticZone ?? false,
        physicalBoundary: room.physicalBoundary ?? true,
      },
    });

    if (!isVoid) {
      elements.push({
        id: `${home.id}-${isDeck ? 'deck' : 'slab'}-${floor}-${room.label}`,
        sourceId: room.label,
        sourceRoomId: room.label,
        floor,
        category: isDeck ? 'deck' : 'slab',
        ifcClass: 'IfcSlab',
        name: `${room.label} ${isDeck ? 'deck' : 'floor slab'}`,
        bounds: { ...bounds, h: 0.22 },
        metadata: { slabType: isDeck ? 'DECK' : floor > 0 ? 'FLOOR' : 'BASESLAB' },
      });
    }

    const hasSourcedStairFixture = (room.fixtures ?? []).some(isStairFixture);
    if (isStair && !hasSourcedStairFixture) {
      elements.push({
        id: `${home.id}-stair-${floor}-${room.label}`,
        sourceId: room.label,
        sourceRoomId: room.label,
        floor,
        category: 'stair',
        ifcClass: 'IfcStair',
        name: room.label,
        bounds: { ...bounds, h: Math.max(3, heightFt) },
      });
    }

    for (const fixture of room.fixtures ?? []) {
      if (/door_swing|pocket_door|bifold_door/.test(fixture.type)) continue;
      const { category, ifcClass } = fixtureCategory(fixture);
      elements.push({
        id: `${home.id}-${category}-${floor}-${fixture.id ?? `${room.label}-${fixture.type}-${elements.length}`}`,
        sourceId: fixture.id,
        sourceRoomId: room.label,
        sourceAnchorId: fixture.sourceAnchorId ?? fixture.id,
        floor,
        category,
        ifcClass,
        name: fixture.desc || fixture.type,
        bounds: fixtureBounds(room, fixture, elevationFt),
        parts: fixtureParts(fixture, elevationFt),
        rotationDeg: fixture.rotationDeg ?? 0,
        metadata: {
          fixtureType: fixture.type,
          wallAnchor: fixture.wall,
          wallId: fixture.anchorWallId,
          wallSide: fixture.wallSide,
          facingDirection: fixture.facingDirection,
          symbolVariant: fixture.symbolVariant,
          semanticCategory: fixture.category,
          sourceAnchorId: fixture.sourceAnchorId,
        },
      });
    }
  }

  for (const wall of home.sourceWalls ?? []) {
    const floor = wall.floor ?? 0;
    const elevationFt = floorElevation(home, floor);
    if (isVoidMarkerWall(wall)) {
      elements.push({
        id: `${home.id}-void-marker-${wall.id ?? elements.length}`,
        sourceId: wall.id,
        floor,
        category: 'void',
        ifcClass: 'IfcOpeningElement',
        name: wall.id ?? 'open-to-below marker',
        segment: {
          x1: wall.x1 * GRID_FT,
          y1: elevationFt,
          z1: wall.z1 * GRID_FT,
          x2: wall.x2 * GRID_FT,
          y2: elevationFt,
          z2: wall.z2 * GRID_FT,
          thickness: 0,
          height: 0,
        },
        metadata: { wallKind: wall.wallKind, renderAsSolid: false },
      });
      continue;
    }
    const guardrail = isGuardrailWall(wall);
    elements.push({
      id: `${home.id}-${guardrail ? 'guardrail' : 'wall'}-${wall.id ?? elements.length}`,
      sourceId: wall.id,
      floor,
      category: guardrail ? 'guardrail' : 'wall',
      ifcClass: guardrail ? 'IfcRailing' : 'IfcWall',
      name: wall.id ?? (wall.exterior ? 'Exterior Wall' : 'Interior Wall'),
      segment: {
        x1: wall.x1 * GRID_FT,
        y1: elevationFt,
        z1: wall.z1 * GRID_FT,
        x2: wall.x2 * GRID_FT,
        y2: elevationFt,
        z2: wall.z2 * GRID_FT,
        thickness: wall.exterior ? 0.36 : 0.24,
        height: guardrail ? 3.25 : storeyHeight(home, floor),
      },
      metadata: {
        exterior: wall.exterior ?? false,
        wallKind: wall.wallKind,
        roomIds: wall.roomIds?.join(','),
        roofStyle: home.roofStyle,
        roofRidgeAxis: home.roofSemantics?.ridgeAxis,
      },
    });
  }

  for (const opening of home.sourceOpenings ?? []) {
    const floor = opening.floor ?? 0;
    const elevationFt = floorElevation(home, floor);
    const { category, ifcClass } = openingCategory(opening);
    elements.push({
      id: `${home.id}-${category}-${opening.id ?? elements.length}`,
      sourceId: opening.id,
      sourceAnchorId: opening.wallId,
      floor,
      category,
      ifcClass,
      name: opening.id ?? opening.kind,
      segment: {
        x1: opening.x1 * GRID_FT,
        y1: elevationFt,
        z1: opening.z1 * GRID_FT,
        x2: opening.x2 * GRID_FT,
        y2: elevationFt,
        z2: opening.z2 * GRID_FT,
        thickness: category === 'window' ? 0.18 : 0.12,
        height: category === 'window' ? 4 : 7,
      },
      metadata: {
        openingKind: opening.kind,
        sourceAnchorId: opening.sourceAnchorId,
        wallId: opening.wallId,
        roomIds: opening.roomIds?.join(','),
        openingType: opening.openingType,
        windowKind: opening.windowKind,
        sillType: opening.sillType,
        fromRoomId: opening.fromRoomId,
        toRoomId: opening.toRoomId,
        opensIntoRoomId: opening.opensIntoRoomId,
        swingDirection: opening.swingDirection,
        swingArcDeg: opening.swingArcDeg,
        widthFt: opening.widthFt,
        heightFt: opening.heightFt,
        hingeX: opening.hingePoint ? opening.hingePoint.x * GRID_FT : undefined,
        hingeZ: opening.hingePoint ? opening.hingePoint.z * GRID_FT : undefined,
        leafClosedX: opening.leafClosedEnd ? opening.leafClosedEnd.x * GRID_FT : undefined,
        leafClosedZ: opening.leafClosedEnd ? opening.leafClosedEnd.z * GRID_FT : undefined,
        leafOpenX: opening.leafOpenEnd ? opening.leafOpenEnd.x * GRID_FT : undefined,
        leafOpenZ: opening.leafOpenEnd ? opening.leafOpenEnd.z * GRID_FT : undefined,
      },
    });
  }

  for (const plane of home.roofSemantics?.planes ?? []) {
    if (plane.role !== 'roof-plane') continue;
    elements.push({
      id: `${home.id}-roof-${plane.id}`,
      sourceId: plane.id,
      floor: floors[floors.length - 1] ?? 0,
      category: 'roofPlane',
      ifcClass: 'IfcRoof',
      name: plane.id,
      points: plane.points.map((point) => ({ x: ft(point.x), y: ft(point.y), z: ft(point.z) })),
      sourceAnchorId: plane.sourceAnchorId ?? plane.wallId ?? plane.id,
      metadata: {
        role: plane.role,
        material: plane.material,
        wallId: plane.wallId,
        wallAnchor: plane.sourceAnchorId ?? plane.wallId ?? plane.id,
        roofThicknessFt: home.roofSemantics?.roofThicknessFt,
      },
    });
  }

  const mappedElements = elements.map(withAssetMetadata);
  const validation = validateSemanticBim(home, mappedElements);
  return {
    schemaVersion: 'semantic_bim_v1',
    source: 'paired_semantic_json',
    units: { source: 'ft', bim: 'm', feetToMeters: FT_TO_M },
    planId: home.id,
    proposalId: home.pairedProposalId,
    name: home.model,
    footprint: {
      widthFt: home.footprint.width,
      depthFt: home.footprint.depth,
      widthM: m(home.footprint.width),
      depthM: m(home.footprint.depth),
    },
    storeys,
    elements: mappedElements,
    validation,
    ifcExport: {
      status: 'experimental',
      blockers: [
        'Full IFC STEP writing is not enabled yet; semantic_bim_v1 is the deterministic BIM handoff artifact.',
        'Next step: map semantic_bim_v1 elements through web-ifc entity creation or fragments export.',
      ],
    },
  };
}

export function semanticBimSummary(model: SemanticBimModel) {
  const warnings = [
    ...model.validation.warnings,
    ...model.ifcExport.blockers,
  ];
  return {
    schemaVersion: model.schemaVersion,
    planId: model.planId,
    proposalId: model.proposalId,
    status: model.validation.status,
    counts: model.validation.counts,
    blockers: model.validation.blockers,
    warnings,
  };
}

export type { RoofPlane };
