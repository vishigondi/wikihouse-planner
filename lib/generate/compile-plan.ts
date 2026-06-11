// Compiles constrained generation intent into a full paired_gpt_floorplan_v1
// artifact. The LLM (or mock template) emits only high-level design intent —
// rooms, doors, windows, roof, lot — and this module deterministically derives
// walls, swing geometry, roof planes, elevations, floor panels, and dimension
// lines. The compiler, not the model, owns geometry: same intent in, same
// artifact out.
//
// Single-story V1. All coordinates in feet, rooms expected on the 4 ft grid.

export interface IntentRoom {
  id: string;
  label: string;
  type: string;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface IntentSpan {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

export interface IntentDoor {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  openingType: 'exteriorDoor' | 'interiorDoor' | 'slidingDoor' | 'bifoldDoor';
  span: IntentSpan;
}

export interface IntentWindow {
  id: string;
  roomId: string;
  span: IntentSpan;
}

export interface IntentOpening {
  id: string;
  fromRoomId: string;
  toRoomId: string;
  span: IntentSpan;
}

export interface GenerationIntent {
  name: string;
  footprint: { widthFt: number; depthFt: number };
  roof: { style: 'a-frame' | 'gable'; ridgeAxis: 'x' | 'z'; ridgeHeightFt: number; eaveHeightFt: number };
  lot?: { widthFt: number; depthFt: number; setbacksFt?: { front?: number; rear?: number; left?: number; right?: number }; maxCoverageRatio?: number } | null;
  rooms: IntentRoom[];
  doors: IntentDoor[];
  windows: IntentWindow[];
  openings: IntentOpening[];
}

export interface CompileResult {
  ok: boolean;
  errors: string[];
  artifact?: Record<string, unknown>;
}

const EPS = 1e-6;

function rectsOverlap(a: IntentRoom, b: IntentRoom): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS;
}

function poly(x: number, z: number, w: number, d: number) {
  return [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }];
}

interface WallSegment {
  id: string;
  kind: 'solidExterior' | 'solidInterior';
  facing: string;
  span: IntentSpan;
}

/** Interior walls: maximal shared-edge segments between adjacent rooms. */
function deriveInteriorWalls(rooms: IntentRoom[]): WallSegment[] {
  const walls: WallSegment[] = [];
  let counter = 0;
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      // Vertical shared edge: a's right == b's left (or vice versa)
      for (const [left, right] of [[a, b], [b, a]] as const) {
        if (Math.abs(left.x + left.w - right.x) < EPS) {
          const z0 = Math.max(left.z, right.z);
          const z1 = Math.min(left.z + left.d, right.z + right.d);
          if (z1 - z0 > 0.5) {
            counter += 1;
            walls.push({ id: `iw-${counter}-${left.id}-${right.id}`, kind: 'solidInterior', facing: 'E', span: { x1: right.x, z1: z0, x2: right.x, z2: z1 } });
          }
        }
        if (Math.abs(left.z + left.d - right.z) < EPS) {
          const x0 = Math.max(left.x, right.x);
          const x1 = Math.min(left.x + left.w, right.x + right.w);
          if (x1 - x0 > 0.5) {
            counter += 1;
            walls.push({ id: `iw-${counter}-${left.id}-${right.id}`, kind: 'solidInterior', facing: 'S', span: { x1: x0, z1: right.z, x2: x1, z2: right.z } });
          }
        }
      }
    }
  }
  // De-duplicate identical segments (a-b and b-a directions)
  const seen = new Set<string>();
  return walls.filter((wall) => {
    const key = [wall.span.x1, wall.span.z1, wall.span.x2, wall.span.z2].map((v) => v.toFixed(2)).join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function spanOnWall(span: IntentSpan, wall: WallSegment): boolean {
  const vertical = Math.abs(wall.span.x1 - wall.span.x2) < EPS;
  if (vertical) {
    return Math.abs(span.x1 - wall.span.x1) < 0.26 && Math.abs(span.x2 - wall.span.x1) < 0.26
      && Math.min(span.z1, span.z2) >= Math.min(wall.span.z1, wall.span.z2) - 0.26
      && Math.max(span.z1, span.z2) <= Math.max(wall.span.z1, wall.span.z2) + 0.26;
  }
  return Math.abs(span.z1 - wall.span.z1) < 0.26 && Math.abs(span.z2 - wall.span.z1) < 0.26
    && Math.min(span.x1, span.x2) >= Math.min(wall.span.x1, wall.span.x2) - 0.26
    && Math.max(span.x1, span.x2) <= Math.max(wall.span.x1, wall.span.x2) + 0.26;
}

export function compileIntent(intent: GenerationIntent, planId: string, brief: string): CompileResult {
  const errors: string[] = [];
  const { widthFt, depthFt } = intent.footprint ?? { widthFt: 0, depthFt: 0 };
  if (!(widthFt > 0 && depthFt > 0)) errors.push('footprint must have positive widthFt/depthFt');
  const rooms = intent.rooms ?? [];
  if (rooms.length < 2) errors.push('at least two rooms required');
  const roomIds = new Set(rooms.map((room) => room.id));

  for (const room of rooms) {
    if (room.x < -EPS || room.z < -EPS || room.x + room.w > widthFt + EPS || room.z + room.d > depthFt + EPS) {
      errors.push(`room ${room.id} extends outside the footprint`);
    }
    if (!(room.w > 0 && room.d > 0)) errors.push(`room ${room.id} has non-positive size`);
  }
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      if (rectsOverlap(rooms[i], rooms[j])) errors.push(`rooms ${rooms[i].id} and ${rooms[j].id} overlap`);
    }
  }
  const refOk = (id: string) => id === 'exterior' || roomIds.has(id);
  for (const door of intent.doors ?? []) {
    if (!refOk(door.fromRoomId) || !refOk(door.toRoomId)) errors.push(`door ${door.id} references unknown room`);
  }
  for (const window of intent.windows ?? []) {
    if (!roomIds.has(window.roomId)) errors.push(`window ${window.id} references unknown room`);
  }
  const sleeping = rooms.filter((room) => /bed|sleep|bunk/i.test(`${room.type} ${room.label}`) && !/bath/i.test(room.type));
  for (const bed of sleeping) {
    const hasEgress = (intent.windows ?? []).some((window) => window.roomId === bed.id)
      || (intent.doors ?? []).some((door) => door.openingType === 'exteriorDoor' && (door.fromRoomId === bed.id || door.toRoomId === bed.id));
    if (!hasEgress) errors.push(`sleeping room ${bed.id} has no egress window or exterior door`);
  }
  if (errors.length) return { ok: false, errors };

  const exteriorWalls: WallSegment[] = [
    { id: 'ext-n', kind: 'solidExterior', facing: 'N', span: { x1: 0, z1: 0, x2: widthFt, z2: 0 } },
    { id: 'ext-e', kind: 'solidExterior', facing: 'E', span: { x1: widthFt, z1: 0, x2: widthFt, z2: depthFt } },
    { id: 'ext-s', kind: 'solidExterior', facing: 'S', span: { x1: 0, z1: depthFt, x2: widthFt, z2: depthFt } },
    { id: 'ext-w', kind: 'solidExterior', facing: 'W', span: { x1: 0, z1: 0, x2: 0, z2: depthFt } },
  ];
  const interiorWalls = deriveInteriorWalls(rooms);
  const allWalls = [...exteriorWalls, ...interiorWalls];
  const wallFor = (span: IntentSpan): WallSegment | undefined => allWalls.find((wall) => spanOnWall(span, wall));

  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const wallShape = (wall: WallSegment) => {
    const t = 0.5;
    const vertical = Math.abs(wall.span.x1 - wall.span.x2) < EPS;
    return {
      ...wall,
      levelFrameId: 'floor-0',
      levelIndex: 0,
      wallKind: wall.kind,
      bounds: vertical
        ? { x: wall.span.x1 - t / 2, z: Math.min(wall.span.z1, wall.span.z2), w: t, d: Math.abs(wall.span.z2 - wall.span.z1) }
        : { x: Math.min(wall.span.x1, wall.span.x2), z: wall.span.z1 - t / 2, w: Math.abs(wall.span.x2 - wall.span.x1), d: t },
    };
  };

  const doors = (intent.doors ?? []).map((door) => {
    const wall = wallFor(door.span);
    const vertical = Math.abs(door.span.x1 - door.span.x2) < EPS;
    const into = roomById.get(door.toRoomId === 'exterior' ? door.fromRoomId : door.toRoomId);
    const intoCenter = into ? { x: into.x + into.w / 2, z: into.z + into.d / 2 } : { x: widthFt / 2, z: depthFt / 2 };
    const leafLen = Math.hypot(door.span.x2 - door.span.x1, door.span.z2 - door.span.z1);
    const dir = vertical
      ? { x: Math.sign(intoCenter.x - door.span.x1) || 1, z: 0 }
      : { x: 0, z: Math.sign(intoCenter.z - door.span.z1) || 1 };
    return {
      id: door.id,
      levelFrameId: 'floor-0',
      levelIndex: 0,
      wallId: wall?.id,
      doorKind: door.openingType === 'exteriorDoor' ? 'singleSwingExterior' : 'singleSwingInterior',
      openingType: door.openingType,
      facing: wall?.facing,
      fromRoomId: door.fromRoomId,
      toRoomId: door.toRoomId,
      opensIntoRoomId: door.toRoomId === 'exterior' ? door.fromRoomId : door.toRoomId,
      span: door.span,
      hingePoint: { x: door.span.x1, z: door.span.z1 },
      leafClosedEnd: { x: door.span.x2, z: door.span.z2 },
      leafOpenEnd: { x: door.span.x1 + dir.x * leafLen, z: door.span.z1 + dir.z * leafLen },
      swingDirection: 'in',
      swingArcDeg: 90,
    };
  });

  const windows = (intent.windows ?? []).map((window) => ({
    id: window.id,
    levelFrameId: 'floor-0',
    levelIndex: 0,
    wallId: wallFor(window.span)?.id,
    windowKind: 'fixed',
    facing: wallFor(window.span)?.facing,
    roomIds: [window.roomId, 'exterior'],
    span: window.span,
  }));

  const openings = (intent.openings ?? []).map((opening) => ({
    id: opening.id,
    levelFrameId: 'floor-0',
    levelIndex: 0,
    wallId: wallFor(opening.span)?.id,
    openingType: 'passthrough',
    kind: 'open',
    fromRoomId: opening.fromRoomId,
    toRoomId: opening.toRoomId,
    span: opening.span,
  }));

  const roof = intent.roof ?? { style: 'a-frame', ridgeAxis: 'z', ridgeHeightFt: 18, eaveHeightFt: 1 };
  const overhang = 1;
  const ridge = roof.ridgeHeightFt;
  const eave = roof.eaveHeightFt;
  const ridgeAlongZ = roof.ridgeAxis === 'z';
  const midX = widthFt / 2;
  const midZ = depthFt / 2;
  const planes = ridgeAlongZ
    ? [
      { id: 'roof-plane-west-slope', role: 'roof-plane', points: [{ x: -overhang, y: eave, z: -overhang }, { x: midX, y: ridge, z: -overhang }, { x: midX, y: ridge, z: depthFt + overhang }, { x: -overhang, y: eave, z: depthFt + overhang }] },
      { id: 'roof-plane-east-slope', role: 'roof-plane', points: [{ x: midX, y: ridge, z: -overhang }, { x: widthFt + overhang, y: eave, z: -overhang }, { x: widthFt + overhang, y: eave, z: depthFt + overhang }, { x: midX, y: ridge, z: depthFt + overhang }] },
    ]
    : [
      { id: 'roof-plane-north-slope', role: 'roof-plane', points: [{ x: -overhang, y: eave, z: -overhang }, { x: widthFt + overhang, y: eave, z: -overhang }, { x: widthFt + overhang, y: ridge, z: midZ }, { x: -overhang, y: ridge, z: midZ }] },
      { id: 'roof-plane-south-slope', role: 'roof-plane', points: [{ x: -overhang, y: ridge, z: midZ }, { x: widthFt + overhang, y: ridge, z: midZ }, { x: widthFt + overhang, y: eave, z: depthFt + overhang }, { x: -overhang, y: eave, z: depthFt + overhang }] },
    ];
  const elevations = ridgeAlongZ
    ? [
      { id: 'front-gable', view: 'front', outline: [{ x: -overhang, y: eave }, { x: midX, y: ridge }, { x: widthFt + overhang, y: eave }] },
      { id: 'side-longitudinal', view: 'side', outline: [{ x: -overhang, y: eave }, { x: -overhang, y: ridge }, { x: depthFt + overhang, y: ridge }, { x: depthFt + overhang, y: eave }] },
    ]
    : [
      { id: 'front-longitudinal', view: 'front', outline: [{ x: -overhang, y: eave }, { x: -overhang, y: ridge }, { x: widthFt + overhang, y: ridge }, { x: widthFt + overhang, y: eave }] },
      { id: 'side-gable', view: 'side', outline: [{ x: -overhang, y: eave }, { x: midZ, y: ridge }, { x: depthFt + overhang, y: eave }] },
    ];

  const artifact: Record<string, unknown> = {
    schemaVersion: 'paired_gpt_floorplan_v1',
    planId,
    proposalId: 'proposal-paired-v1',
    gridFt: 1,
    coordinateMode: 'feet',
    brief,
    generator: 'generate-plan-api-v1',
    footprint: {
      units: 'ft', x: 0, z: 0, w: widthFt, d: depthFt, levels: 1,
      roofStyle: roof.style, bounds: { x: 0, z: 0, w: widthFt, d: depthFt },
      widthFt, depthFt, polygon: poly(0, 0, widthFt, depthFt), width: widthFt, depth: depthFt,
    },
    lot: intent.lot ?? null,
    floorPanels: [{
      id: 'floor-0', floor: 0, label: 'MAIN LEVEL', levelIndex: 0,
      footprint: { units: 'ft', x: 0, z: 0, w: widthFt, d: depthFt, width: widthFt, depth: depthFt, widthFt, depthFt },
      span: { x1: 0, z1: 0, x2: widthFt, z2: depthFt },
    }],
    rooms: rooms.map((room) => ({
      id: room.id, levelFrameId: 'floor-0', levelIndex: 0, roomKind: room.type,
      type: room.type, label: room.label,
      bounds: { x: room.x, z: room.z, w: room.w, d: room.d },
      polygon: poly(room.x, room.z, room.w, room.d),
    })),
    exteriorWalls: exteriorWalls.map(wallShape),
    interiorWalls: interiorWalls.map(wallShape),
    doors,
    windows,
    openings,
    fixtures: [],
    dimensionLines: [
      { id: 'dim-width', span: { x1: 0, z1: -2, x2: widthFt, z2: -2 }, label: `${widthFt}'-0"` },
      { id: 'dim-depth', span: { x1: -2, z1: 0, x2: -2, z2: depthFt }, label: `${depthFt}'-0"` },
    ],
    roof: { style: roof.style, ridgeAxis: roof.ridgeAxis, ridgeHeightFt: ridge, eaveHeightFt: eave, overhangFt: overhang, roofThicknessFt: 0.35, planes },
    elevations,
  };

  return { ok: true, errors: [], artifact };
}

/** Deterministic 2-bed template used when no OpenAI key is configured. */
export function mockIntentFromBrief(brief: { bedrooms?: number; roofStyle?: string; lot?: GenerationIntent['lot'] }): GenerationIntent {
  return {
    name: 'mock-2br',
    footprint: { widthFt: 24, depthFt: 28 },
    roof: { style: brief.roofStyle === 'gable' ? 'gable' : 'a-frame', ridgeAxis: 'z', ridgeHeightFt: 18, eaveHeightFt: 1 },
    lot: brief.lot ?? null,
    rooms: [
      { id: 'room-living', label: 'Living Room', type: 'living', x: 0, z: 0, w: 16, d: 12 },
      { id: 'room-kitchen', label: 'Kitchen', type: 'kitchen', x: 16, z: 0, w: 8, d: 12 },
      { id: 'room-bath', label: 'Bath', type: 'bathroom', x: 0, z: 12, w: 8, d: 4 },
      { id: 'room-hall', label: 'Hall', type: 'hall', x: 8, z: 12, w: 8, d: 4 },
      { id: 'room-bed1', label: 'Bedroom 1', type: 'bedroom', x: 0, z: 16, w: 12, d: 12 },
      { id: 'room-bed2', label: 'Bedroom 2', type: 'bedroom', x: 12, z: 16, w: 12, d: 12 },
    ],
    doors: [
      { id: 'door-entry', fromRoomId: 'exterior', toRoomId: 'room-living', openingType: 'exteriorDoor', span: { x1: 4, z1: 0, x2: 7, z2: 0 } },
      { id: 'door-bath', fromRoomId: 'room-hall', toRoomId: 'room-bath', openingType: 'interiorDoor', span: { x1: 8, z1: 13, x2: 8, z2: 15.5 } },
      { id: 'door-bed1', fromRoomId: 'room-hall', toRoomId: 'room-bed1', openingType: 'interiorDoor', span: { x1: 8.5, z1: 16, x2: 11, z2: 16 } },
      { id: 'door-bed2', fromRoomId: 'room-hall', toRoomId: 'room-bed2', openingType: 'interiorDoor', span: { x1: 13, z1: 16, x2: 15.5, z2: 16 } },
    ],
    windows: [
      { id: 'win-living-n', roomId: 'room-living', span: { x1: 10, z1: 0, x2: 14, z2: 0 } },
      { id: 'win-kitchen-e', roomId: 'room-kitchen', span: { x1: 24, z1: 4, x2: 24, z2: 8 } },
      { id: 'win-bed1-w', roomId: 'room-bed1', span: { x1: 0, z1: 20, x2: 0, z2: 24 } },
      { id: 'win-bed2-e', roomId: 'room-bed2', span: { x1: 24, z1: 20, x2: 24, z2: 24 } },
    ],
    openings: [
      { id: 'open-living-hall', fromRoomId: 'room-living', toRoomId: 'room-hall', span: { x1: 9, z1: 12, x2: 15, z2: 12 } },
      { id: 'open-living-kitchen', fromRoomId: 'room-living', toRoomId: 'room-kitchen', span: { x1: 16, z1: 2, x2: 16, z2: 10 } },
    ],
  };
}
