// Compiles constrained generation intent into a full paired_gpt_floorplan_v1
// artifact. The LLM (or mock template) emits only high-level design intent —
// rooms, doors, windows, roof, lot — and this module deterministically derives
// walls, swing geometry, roof planes, elevations, floor panels, and dimension
// lines. The compiler, not the model, owns geometry: same intent in, same
// artifact out.
//
// Single-story V1. All coordinates in feet, rooms expected on the 4 ft grid.

// Coverage cap is owned by the constraint engine; the compiler imports it so a
// generated footprint is refused on the SAME threshold the report would fail
// (one source of truth — never two 0.35s that can drift apart).
import { DEFAULT_MAX_COVERAGE_RATIO } from '../standards/code-advisory.ts';

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
  /** Brief asked for a loft. A loft level is emitted only if the roof gives headroom. */
  hasLoft?: boolean;
  /** Bedrooms the brief asked for, BEFORE any template clamp — so the compiler can
   * refuse (rather than silently misrepresent) a program it can't build. */
  requestedBedrooms?: number;
  /** Baths the brief asked for, BEFORE any fit downgrade — so the compiler can
   * SURFACE (rather than silently drop) a 2nd bath that didn't fit the size/lot. */
  requestedBaths?: number;
  /** The ≤ sqft cap the brief asked for — so the compiler can refuse (rather than
   * silently exceed) a cap no template is small enough to meet. */
  requestedMaxSqft?: number;
  rooms: IntentRoom[];
  doors: IntentDoor[];
  windows: IntentWindow[];
  openings: IntentOpening[];
}

export interface CompileResult {
  ok: boolean;
  errors: string[];
  /** Non-fatal program reconciliations the user must be told about — e.g. a
   * requested 2nd bath that the fitting footprint couldn't host. Honest output:
   * an accommodation is surfaced here, never silently applied. */
  notes?: string[];
  artifact?: Record<string, unknown>;
}

const EPS = 1e-6;

/** The deterministic (no-API) generator hand-authors layouts for 1–3 bedrooms
 * only. A brief asking for more is refused at compile with a clear message
 * rather than silently collapsed to a 3-bedroom plan that misrepresents it. */
export const MAX_TEMPLATE_BEDROOMS = 3;

function rectsOverlap(a: IntentRoom, b: IntentRoom): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.z < b.z + b.d - EPS && b.z < a.z + a.d - EPS;
}

function poly(x: number, z: number, w: number, d: number) {
  return [{ x, z }, { x: x + w, z }, { x: x + w, z: z + d }, { x, z: z + d }];
}

const LOFT_BASE_FT = 8;          // loft floor height above the ground floor
const MIN_LOFT_HEADROOM_FT = 5;  // clearance needed before a band counts as a loft
const MIN_LOFT_SPAN_FT = 6;      // a central band narrower than this isn't usable

interface LoftBuild {
  bounds: { x: number; z: number; w: number; d: number };
  baseFt: number;
}

/**
 * A loft is compiler-derived, not authored: it occupies the central band where
 * the roof clears LOFT_BASE_FT + MIN_LOFT_HEADROOM_FT, computed from the same
 * ridge/eave geometry the roof planes use (one source of truth). Returns null
 * when the roof is too low to give honest headroom — the plan stays single
 * level rather than fake a loft under a roof that can't hold one.
 */
function buildLoft(
  roof: { ridgeAxis: 'x' | 'z'; ridgeHeightFt: number; eaveHeightFt: number },
  widthFt: number,
  depthFt: number,
): LoftBuild | null {
  const ridge = roof.ridgeHeightFt;
  const eave = roof.eaveHeightFt;
  const target = LOFT_BASE_FT + MIN_LOFT_HEADROOM_FT;
  if (ridge < target + EPS || ridge <= eave + EPS) return null;
  const overhang = 1;
  const ridgeAlongZ = roof.ridgeAxis === 'z';
  const span = ridgeAlongZ ? widthFt : depthFt; // axis the slope varies along
  const mid = span / 2;
  // Ceiling at inboard distance c from the low edge:
  //   h(c) = eave + (ridge - eave) * (c + overhang) / (mid + overhang)
  // Solve h = target for the offset where usable headroom begins; round the
  // band inward (low up, high down) so the whole loft clears the target.
  const offset = ((target - eave) / (ridge - eave)) * (mid + overhang) - overhang;
  const low = Math.max(0, Math.ceil(offset * 2) / 2);
  const high = Math.min(span, span - low);
  if (high - low < MIN_LOFT_SPAN_FT) return null; // central band too narrow
  // The loft runs the full depth in the headroom band so it reaches the gable
  // ends — that's where its window gets daylight at loft height. The long
  // sides of the band stay open to the floor below (mezzanine).
  const bounds = ridgeAlongZ
    ? { x: low, z: 0, w: high - low, d: depthFt }
    : { x: 0, z: low, w: widthFt, d: high - low };
  return { bounds, baseFt: LOFT_BASE_FT };
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

interface StarterFixture {
  id: string;
  roomId: string;
  type: string;
  floor: number;
  bounds: { x: number; z: number; w: number; d: number };
  clearance: { frontFt: number; doorSwingClear: boolean; note: string };
  sourceAnchorId: string;
  wallAnchor?: { wallId?: string; side: string; span: [number, number] };
}

/**
 * Deterministic starter furnishing per room type, using only component
 * registry ids already proven in shipped plans. Placement is recipe-based
 * (beds on the far edge, wet fixtures on the near edge, kitchen run on the
 * perimeter side) so the same intent always furnishes identically.
 */
function starterFixtures(intent: GenerationIntent, walls: WallSegment[]): StarterFixture[] {
  const { widthFt } = intent.footprint;
  const fixtures: StarterFixture[] = [];
  const nearestWall = (px: number, pz: number): WallSegment | undefined => {
    let best: WallSegment | undefined;
    let bestDist = Infinity;
    for (const wall of walls) {
      const vertical = Math.abs(wall.span.x1 - wall.span.x2) < EPS;
      const dist = vertical
        ? Math.abs(px - wall.span.x1) + (pz < Math.min(wall.span.z1, wall.span.z2) || pz > Math.max(wall.span.z1, wall.span.z2) ? 100 : 0)
        : Math.abs(pz - wall.span.z1) + (px < Math.min(wall.span.x1, wall.span.x2) || px > Math.max(wall.span.x1, wall.span.x2) ? 100 : 0);
      if (dist < bestDist) {
        bestDist = dist;
        best = wall;
      }
    }
    return bestDist < 1.5 ? best : undefined;
  };
  const anchor = (px: number, pz: number, fixtureCenter: { x: number; z: number }, span: [number, number]) => {
    const wall = nearestWall(px, pz);
    if (!wall) return undefined;
    const vertical = Math.abs(wall.span.x1 - wall.span.x2) < EPS;
    const side = vertical
      ? (fixtureCenter.x >= wall.span.x1 ? 'E' : 'W')
      : (fixtureCenter.z >= wall.span.z1 ? 'S' : 'N');
    return { wallId: wall.id, side, span };
  };
  const add = (
    id: string,
    roomId: string,
    type: string,
    x: number,
    z: number,
    w: number,
    d: number,
    note: string,
    wallPoint?: { x: number; z: number },
  ) => {
    const fixture: StarterFixture = {
      id,
      roomId,
      type,
      floor: 0,
      bounds: { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, w, d },
      clearance: { frontFt: 2, doorSwingClear: true, note },
      sourceAnchorId: id,
    };
    if (wallPoint) {
      const center = { x: x + w / 2, z: z + d / 2 };
      const span: [number, number] = Math.abs(wallPoint.x - center.x) < Math.abs(wallPoint.z - center.z)
        ? [z, z + d]
        : [x, x + w];
      fixture.wallAnchor = anchor(wallPoint.x, wallPoint.z, center, span);
      if (!fixture.wallAnchor) delete fixture.wallAnchor;
    }
    fixtures.push(fixture);
  };

  for (const room of intent.rooms) {
    const text = `${room.type} ${room.label}`.toLowerCase();
    const cx = room.x + room.w / 2;
    const slug = room.id.replace(/^room-/, '');
    if (/bed/.test(text) && !/bath/.test(text)) {
      if (room.w >= 7 && room.d >= 8) {
        add(`fx-${slug}-bed`, room.id, 'queen_bed', cx - 2.5, room.z + room.d - 6.5, 5, 6.5, 'foot and sides clear', { x: cx, z: room.z + room.d });
        // Wardrobe needs ~2 ft beyond the bed's 6.5 ft; skip in shallow rooms.
        if (room.w >= 9 && room.d >= 9) {
          add(`fx-${slug}-wardrobe`, room.id, 'closet_wardrobe', room.x + 1, room.z + 0.3, Math.min(4.5, room.w - 2), 1.9, 'sliding storage', { x: cx, z: room.z });
        }
      }
    } else if (/bath|wc|toilet/.test(text)) {
      if (room.w < 6 && room.d >= 6) {
        // Narrow bath: stack fixtures along the depth against the west wall.
        add(`fx-${slug}-toilet`, room.id, 'toilet', room.x + 0.5, room.z + 0.3, 2.2, 2.2, 'front clear', { x: room.x, z: room.z + 1.4 });
        add(`fx-${slug}-vanity`, room.id, 'vanity_sink', room.x + 0.5, room.z + 3.0, 2.4, 1.7, 'front clear', { x: room.x, z: room.z + 3.85 });
        if (room.d >= 8) {
          add(`fx-${slug}-shower`, room.id, 'shower', room.x + 0.5, room.z + room.d - 2.9, 2.4, 2.6, 'door clear', { x: room.x, z: room.z + room.d - 1.6 });
        }
      } else if (room.w < 6) {
        // Compact powder room (e.g. 4x4 second bath): toilet against the north
        // wall + a small lavatory below it. Every bathroom requires a sink — a
        // toilet-only room is not a bathroom — so the vanity is unconditional here.
        add(`fx-${slug}-toilet`, room.id, 'toilet', room.x + 0.3, room.z + 0.3, 1.9, 1.9, 'front clear', { x: room.x + 1.25, z: room.z });
        add(`fx-${slug}-vanity`, room.id, 'vanity_sink', room.x + 0.3, room.z + room.d - 1.5, Math.min(1.8, room.w - 0.6), 1.2, 'front clear', { x: room.x, z: room.z + room.d - 0.9 });
      } else {
        add(`fx-${slug}-toilet`, room.id, 'toilet', room.x + 0.5, room.z + 0.3, 2.2, 2.2, 'front clear', { x: room.x + 1.6, z: room.z });
        if (room.w >= 6) {
          add(`fx-${slug}-vanity`, room.id, 'vanity_sink', room.x + 3.0, room.z + 0.3, 2.4, 1.7, 'front clear', { x: room.x + 4.2, z: room.z });
        }
        if (room.w >= 8) {
          add(`fx-${slug}-shower`, room.id, 'shower', room.x + room.w - 2.5, room.z + 0.3, 2.4, 2.6, 'door clear', { x: room.x + room.w - 1.3, z: room.z });
        }
      }
    } else if (/kitchen/.test(text)) {
      const onRightPerimeter = Math.abs(room.x + room.w - widthFt) < EPS;
      const runX = onRightPerimeter ? room.x + room.w - 2 : room.x + 0.2;
      const wallX = onRightPerimeter ? room.x + room.w : room.x;
      const runDepth = Math.min(7, room.d - 2);
      add(`fx-${slug}-counter`, room.id, 'counter_run', runX, room.z + 1, 1.8, runDepth, 'work aisle clear', { x: wallX, z: room.z + 1 + runDepth / 2 });
      add(`fx-${slug}-sink`, room.id, 'sink', runX + 0.1, room.z + 1 + runDepth / 2 - 0.75, 1.6, 1.5, 'under window where possible', { x: wallX, z: room.z + 1 + runDepth / 2 });
      add(`fx-${slug}-range`, room.id, 'range', runX - 0.1, room.z + 1 + runDepth + 0.3, 2.0, 1.8, 'landing space beside', { x: wallX, z: room.z + 1 + runDepth + 1.2 });
      add(`fx-${slug}-fridge`, room.id, 'refrigerator', room.x + 0.4, room.z + 0.4, 2.8, 2.6, 'door swing clear', { x: room.x + 1.8, z: room.z });
    } else if (/living|great/.test(text)) {
      if (room.w >= 12 && room.d >= 9) {
        add(`fx-${slug}-sofa`, room.id, 'sofa_chairs_coffee_table', room.x + 1.5, room.z + 1.5, Math.min(8, room.w - 4), Math.min(6, room.d - 3), 'circulation around');
        add(`fx-${slug}-dining`, room.id, 'round_table_six_chairs', room.x + room.w - 5, room.z + room.d / 2 - 2, 4, 4, 'chairs pull out');
      }
    }
  }
  return fixtures;
}

export function compileIntent(intent: GenerationIntent, planId: string, brief: string): CompileResult {
  const errors: string[] = [];
  const notes: string[] = [];
  const { widthFt, depthFt } = intent.footprint ?? { widthFt: 0, depthFt: 0 };
  if (!(widthFt > 0 && depthFt > 0)) errors.push('footprint must have positive widthFt/depthFt');
  const rooms = intent.rooms ?? [];
  if (rooms.length < 2) errors.push('at least two rooms required');
  const roomIds = new Set(rooms.map((room) => room.id));

  // A requested bedroom count beyond the deterministic template ceiling is a
  // program the generator cannot honestly build: refuse rather than silently
  // ship a 3-bedroom plan that misrepresents the brief (input honesty, P5).
  if (typeof intent.requestedBedrooms === 'number' && intent.requestedBedrooms > MAX_TEMPLATE_BEDROOMS) {
    errors.push(
      `requested ${intent.requestedBedrooms} bedrooms; the deterministic generator builds at most ${MAX_TEMPLATE_BEDROOMS} `
      + `— reduce the bedroom count or supply an OPENAI_API_KEY for full generation`,
    );
  }

  // A ≤ sqft cap no template can meet is an unbuildable program: refuse rather
  // than silently ship a footprint larger than the user allowed (same input-
  // honesty class — fits() prefers a footprint within the cap; this catches the
  // case where even the smallest exceeds it).
  if (typeof intent.requestedMaxSqft === 'number' && widthFt > 0 && depthFt > 0
    && widthFt * depthFt > intent.requestedMaxSqft + EPS) {
    errors.push(
      `footprint ${widthFt}x${depthFt} ft (${widthFt * depthFt} sq ft) exceeds the requested ≤${intent.requestedMaxSqft} sq ft cap `
      + `— the smallest template for this program is larger; raise the cap or reduce the program`,
    );
  }

  // A footprint that cannot sit inside the lot's buildable envelope is a hard
  // design failure, not an advisory: refuse to compile rather than emit a plan
  // the zoning report would immediately flag.
  const lot = intent.lot;
  if (lot && Number.isFinite(lot.widthFt) && Number.isFinite(lot.depthFt)) {
    const setbacks = lot.setbacksFt ?? {};
    const envelopeW = lot.widthFt - (setbacks.left ?? 0) - (setbacks.right ?? 0);
    const envelopeD = lot.depthFt - (setbacks.front ?? 0) - (setbacks.rear ?? 0);
    if (widthFt > envelopeW + EPS || depthFt > envelopeD + EPS) {
      errors.push(
        `footprint ${widthFt}x${depthFt} ft exceeds the buildable envelope ${envelopeW}x${envelopeD} ft `
        + `(lot ${lot.widthFt}x${lot.depthFt} ft minus setbacks)`,
      );
    }
    // Likewise refuse a footprint over the lot-coverage cap — the SAME threshold
    // (and tolerance) the ZON-COVERAGE report uses — so the generator never ships
    // a plan that fails its own coverage report. Smaller templates have already
    // been tried by mockIntentFromBrief; reaching here means none fit this lot.
    const maxRatio = lot.maxCoverageRatio ?? DEFAULT_MAX_COVERAGE_RATIO;
    const coverage = (widthFt * depthFt) / (lot.widthFt * lot.depthFt);
    if (coverage > maxRatio + 1e-6) {
      errors.push(
        `footprint ${widthFt}x${depthFt} ft covers ${(coverage * 100).toFixed(1)}% of the `
        + `${lot.widthFt}x${lot.depthFt} ft lot, over the ${(maxRatio * 100).toFixed(0)}% coverage cap `
        + `— enlarge the lot or lower the program`,
      );
    }
  }

  // Program reconciliation (no silent mismatch): a bath count the fitting
  // footprint couldn't host is a valid plan, but the dropped bath MUST be
  // surfaced — never silently delivered as if the brief were honored.
  if (typeof intent.requestedBaths === 'number') {
    const builtBaths = rooms.filter((room) => room.type === 'bathroom').length;
    if (builtBaths < intent.requestedBaths) {
      notes.push(
        `requested ${intent.requestedBaths} baths; built ${builtBaths} — only a single-bath footprint `
        + `fits this size/lot. Enlarge the footprint for a second bath.`,
      );
    }
  }

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

  // A sleeping room's exterior window is its emergency escape opening (IRC
  // R310.1), so it must be operable; all other glazing is fixed. One rule, no
  // per-room special cases — and the engine fails any bedroom left with only a
  // fixed window, so this can't silently regress.
  const sleepingRoomIds = new Set(sleeping.map((room) => room.id));
  const windowKindFor = (roomId: string | undefined) =>
    roomId && sleepingRoomIds.has(roomId) ? 'egress' : 'fixed';
  const windows = (intent.windows ?? []).map((window) => ({
    id: window.id,
    levelFrameId: 'floor-0',
    levelIndex: 0,
    wallId: wallFor(window.span)?.id,
    windowKind: windowKindFor(window.roomId),
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
    rooms: rooms.map((room, index) => ({
      id: room.id, levelFrameId: 'floor-0', levelIndex: 0, roomKind: room.type,
      type: room.type, label: room.label,
      // Stable shared callout numbering: render legend and proposal image
      // must both use 1..N in intent order.
      calloutNumber: index + 1,
      bounds: { x: room.x, z: room.z, w: room.w, d: room.d },
      polygon: poly(room.x, room.z, room.w, room.d),
    })),
    exteriorWalls: exteriorWalls.map(wallShape),
    interiorWalls: interiorWalls.map(wallShape),
    doors,
    windows,
    openings,
    fixtures: starterFixtures(intent, allWalls),
    dimensionLines: [
      { id: 'dim-width', span: { x1: 0, z1: -2, x2: widthFt, z2: -2 }, label: `${widthFt}'-0"` },
      { id: 'dim-depth', span: { x1: -2, z1: 0, x2: -2, z2: depthFt }, label: `${depthFt}'-0"` },
    ],
    roof: { style: roof.style, ridgeAxis: roof.ridgeAxis, ridgeHeightFt: ridge, eaveHeightFt: eave, overhangFt: overhang, roofThicknessFt: 0.35, planes },
    elevations,
  };

  // Loft level: appended after validation (it is derived from the roof, not an
  // authored room, so it never participates in the level-0 overlap/footprint
  // checks). Single-level plans are untouched — this block only runs when a
  // loft was requested AND the roof gives headroom.
  if (intent.hasLoft) {
    const loft = buildLoft(roof, widthFt, depthFt);
    if (loft) {
      const { bounds } = loft;
      (artifact.footprint as Record<string, unknown>).levels = 2;
      (artifact.floorPanels as unknown[]).push({
        id: 'floor-1', floor: 1, label: 'LOFT LEVEL', levelIndex: 1,
        footprint: { units: 'ft', x: bounds.x, z: bounds.z, w: bounds.w, d: bounds.d, width: bounds.w, depth: bounds.d, widthFt: bounds.w, depthFt: bounds.d },
        span: { x1: bounds.x, z1: bounds.z, x2: bounds.x + bounds.w, z2: bounds.z + bounds.d },
        baseFt: loft.baseFt,
      });
      (artifact.rooms as unknown[]).push({
        id: 'room-loft', levelFrameId: 'floor-1', levelIndex: 1, floor: 1, roomKind: 'loft',
        type: 'loft', label: 'Loft', calloutNumber: rooms.length + 1,
        bounds: { x: bounds.x, z: bounds.z, w: bounds.w, d: bounds.d },
        polygon: poly(bounds.x, bounds.z, bounds.w, bounds.d),
      });
      // Loft gable-end wall (floor 1) at the front gable, so the loft window
      // has a same-floor source wall to align to and the renderer clips it to
      // the roof from the loft floor up. Coincident with the gable plane, so
      // it stays inside the envelope.
      const loftGableSpan = ridgeAlongZ
        ? { x1: bounds.x, z1: 0, x2: bounds.x + bounds.w, z2: 0 }
        : { x1: 0, z1: bounds.z, x2: 0, z2: bounds.z + bounds.d };
      const loftGableBounds = ridgeAlongZ
        ? { x: bounds.x, z: -0.25, w: bounds.w, d: 0.5 }
        : { x: -0.25, z: bounds.z, w: 0.5, d: bounds.d };
      (artifact.exteriorWalls as unknown[]).push({
        id: 'ext-l1-front', levelFrameId: 'floor-1', levelIndex: 1, floor: 1,
        kind: 'solidExterior', wallKind: 'solidExterior', facing: ridgeAlongZ ? 'N' : 'W',
        sourceAnchorId: 'ext-l1-front', span: loftGableSpan, bounds: loftGableBounds,
      });
      // Loft daylight window, hosted on the loft gable wall, drawn at loft sill
      // height (the elevation reads levelIndex/the win-l1 id -> loft base).
      const loftCtr = ridgeAlongZ ? bounds.x + bounds.w / 2 : bounds.z + bounds.d / 2;
      (artifact.windows as unknown[]).push({
        id: 'win-l1-loft', levelFrameId: 'floor-1', levelIndex: 1, floor: 1,
        wallId: 'ext-l1-front', windowKind: windowKindFor('room-loft'), facing: ridgeAlongZ ? 'N' : 'W',
        roomIds: ['room-loft', 'exterior'],
        span: ridgeAlongZ
          ? { x1: loftCtr - 2, z1: 0, x2: loftCtr + 2, z2: 0 }
          : { x1: 0, z1: loftCtr - 2, x2: 0, z2: loftCtr + 2 },
      });
      // Ladder up from the hall (present in every program) at the loft band edge.
      (artifact.fixtures as unknown[]).push({
        id: 'fx-loft-ladder', roomId: 'room-hall', type: 'loft_access_ladder', floor: 0,
        bounds: { x: Math.min(bounds.x, widthFt - 3), z: 12.5, w: 3, d: 3 },
        clearance: { frontFt: 3, doorSwingClear: true, note: 'ladder up to loft' },
        sourceAnchorId: 'fx-loft-ladder',
      });
    }
  }

  return { ok: true, errors: [], notes: notes.length ? notes : undefined, artifact };
}

/**
 * Deterministic parametric template used when no OpenAI key is configured.
 * Band layout: front band (living/kitchen, plus bath for 3-bed), full-width
 * hall band, rear bedroom band. All coordinates on the 4 ft grid.
 *
 * Footprint width is chosen from per-program candidates: the largest that
 * fits the lot's buildable envelope (lot minus setbacks) and the brief's
 * max square footage. A-frames have a single width per program because the
 * steep profile (eave 1 ft, ridge 18 ft) leaves usable headroom only in the
 * central column — habitable rooms span toward the ridge and wet rooms
 * (bath/laundry, which R305 holds to 6'8" minimum everywhere) sit in the
 * center; only storage/closets occupy the low eave edges. Gables (eave 8 ft)
 * have headroom everywhere, so they offer narrower variants for small lots.
 * If even the smallest candidate cannot fit, the smallest is emitted and
 * compileIntent reports the honest envelope failure.
 */
export function mockIntentFromBrief(brief: { bedrooms?: number; baths?: number; roofStyle?: string; maxSqft?: number; hasLoft?: boolean; lot?: GenerationIntent['lot'] }): GenerationIntent {
  const bedrooms = Math.max(1, Math.min(3, brief.bedrooms ?? 2));
  const style: 'a-frame' | 'gable' = brief.roofStyle === 'gable' ? 'gable' : 'a-frame';
  // Second bath is supported on the primary footprints only (2-bed at 28 ft,
  // 3-bed at 36 ft); 1-bed programs stay single-bath.
  const bathsRequested = bedrooms === 1 ? 1 : Math.max(1, Math.min(2, Math.round(brief.baths ?? 1)));
  const hostsTwoBaths = (w: number) => (bedrooms === 2 && w === 28) || (bedrooms === 3 && w === 36);

  // Candidate footprints, largest first. Gables offer narrow/shallow variants
  // for small lots; the constraint engine's default 35% coverage cap counts
  // as a fit criterion so generated plans never fail their own report.
  const CANDIDATE_FOOTPRINTS: Record<number, Record<'a-frame' | 'gable', Array<[number, number]>>> = {
    1: { 'a-frame': [[28, 28]], gable: [[28, 28], [24, 28], [20, 28], [20, 24]] },
    2: { 'a-frame': [[28, 28]], gable: [[28, 28], [24, 28]] },
    3: { 'a-frame': [[36, 28]], gable: [[36, 28], [28, 28]] },
  };
  const candidates = CANDIDATE_FOOTPRINTS[bedrooms][style];
  const setbacks = brief.lot?.setbacksFt ?? {};
  const lotValid = brief.lot && Number.isFinite(brief.lot.widthFt) && Number.isFinite(brief.lot.depthFt);
  const envelope = lotValid
    ? {
      w: brief.lot!.widthFt - (setbacks.left ?? 0) - (setbacks.right ?? 0),
      d: brief.lot!.depthFt - (setbacks.front ?? 0) - (setbacks.rear ?? 0),
    }
    : null;
  const maxCoverageSqft = lotValid
    ? brief.lot!.widthFt * brief.lot!.depthFt * (brief.lot!.maxCoverageRatio ?? DEFAULT_MAX_COVERAGE_RATIO)
    : null;
  const fits = ([w, d]: [number, number]) =>
    (!envelope || (w <= envelope.w + EPS && d <= envelope.d + EPS))
    && (!brief.maxSqft || w * d <= brief.maxSqft + EPS)
    && (!maxCoverageSqft || w * d <= maxCoverageSqft + EPS);
  // Prefer a footprint that can host the requested bath count; if none fits
  // the lot/size limits, fall back to the best single-bath fit.
  const twoBathChoice = bathsRequested === 2 ? candidates.filter(([w]) => hostsTwoBaths(w)).find(fits) : undefined;
  const [widthFt, depthFt] = twoBathChoice ?? candidates.find(fits) ?? candidates[candidates.length - 1];
  const baths = bathsRequested === 2 && hostsTwoBaths(widthFt) ? 2 : 1;

  const rooms: IntentRoom[] = [];
  const doors: IntentDoor[] = [];
  const windows: IntentWindow[] = [];
  const openings: IntentOpening[] = [];

  // Front band (z 0-12) and full-width hall band (z 12-16). The living room
  // takes the west column; its width shrinks with the footprint.
  const livingW = (bedrooms === 3 ? widthFt === 36 : widthFt > 20) ? 16 : 12;
  if (bedrooms === 3) {
    rooms.push(
      { id: 'room-living', label: 'Living Room', type: 'living', x: 0, z: 0, w: livingW, d: 12 },
      { id: 'room-bath', label: 'Bath', type: 'bathroom', x: livingW, z: 0, w: 8, d: 12 },
      { id: 'room-kitchen', label: 'Kitchen', type: 'kitchen', x: livingW + 8, z: 0, w: widthFt - livingW - 8, d: 12 },
    );
    doors.push({ id: 'door-bath', fromRoomId: 'room-hall', toRoomId: 'room-bath', openingType: 'interiorDoor', span: { x1: livingW + 2, z1: 12, x2: livingW + 4.5, z2: 12 } });
    openings.push({ id: 'open-kitchen-hall', fromRoomId: 'room-kitchen', toRoomId: 'room-hall', span: { x1: livingW + 10, z1: 12, x2: widthFt - 2, z2: 12 } });
  } else {
    rooms.push(
      { id: 'room-living', label: 'Living Room', type: 'living', x: 0, z: 0, w: livingW, d: 12 },
      { id: 'room-kitchen', label: 'Kitchen', type: 'kitchen', x: livingW, z: 0, w: widthFt - livingW, d: 12 },
    );
    openings.push({ id: 'open-living-kitchen', fromRoomId: 'room-living', toRoomId: 'room-kitchen', span: { x1: livingW, z1: 2, x2: livingW, z2: 10 } });
  }
  windows.push({ id: 'win-kitchen-e', roomId: 'room-kitchen', span: { x1: widthFt, z1: 4, x2: widthFt, z2: 8 } });
  rooms.push({ id: 'room-hall', label: 'Hall', type: 'hall', x: 0, z: 12, w: widthFt, d: 4 });
  // Entry sits on the inner (ridge-side) half of the living facade so the
  // door clears A-frame headroom; the living window takes the outer half.
  const entryMid = livingW * 0.75;
  doors.push({ id: 'door-entry', fromRoomId: 'exterior', toRoomId: 'room-living', openingType: 'exteriorDoor', span: { x1: entryMid - 1.5, z1: 0, x2: entryMid + 1.5, z2: 0 } });
  windows.push({ id: 'win-living-n', roomId: 'room-living', span: livingW === 16 ? { x1: 4, z1: 0, x2: 8, z2: 0 } : { x1: 3, z1: 0, x2: 6, z2: 0 } });
  openings.push({ id: 'open-living-hall', fromRoomId: 'room-living', toRoomId: 'room-hall', span: { x1: 4, z1: 12, x2: livingW - 2, z2: 12 } });

  // Rear band (z 16 to depth; 12 ft deep on the standard 28 ft plans, 8 ft on
  // the compact 20x24 variant).
  const rearD = depthFt - 16;
  if (bedrooms === 1) {
    rooms.push(
      { id: 'room-bed1', label: 'Bedroom 1', type: 'bedroom', x: 0, z: 16, w: 12, d: rearD },
      { id: 'room-bath', label: 'Bath', type: 'bathroom', x: 12, z: 16, w: 8, d: 4 },
    );
    doors.push(
      { id: 'door-bed1', fromRoomId: 'room-hall', toRoomId: 'room-bed1', openingType: 'interiorDoor', span: { x1: 4, z1: 16, x2: 6.5, z2: 16 } },
      { id: 'door-bath', fromRoomId: 'room-hall', toRoomId: 'room-bath', openingType: 'interiorDoor', span: { x1: 14, z1: 16, x2: 16.5, z2: 16 } },
    );
    windows.push({ id: 'win-bed1-w', roomId: 'room-bed1', span: { x1: 0, z1: 16 + rearD / 2 - 2, x2: 0, z2: 16 + rearD / 2 + 2 } });
    if (widthFt === 20) {
      rooms.push({ id: 'room-storage', label: 'Storage', type: 'storage', x: 12, z: 20, w: 8, d: depthFt - 20 });
      doors.push({ id: 'door-storage', fromRoomId: 'room-bath', toRoomId: 'room-storage', openingType: 'interiorDoor', span: { x1: 14, z1: 20, x2: 16.5, z2: 20 } });
    } else {
      rooms.push(
        { id: 'room-laundry', label: 'Laundry', type: 'laundry', x: 12, z: 20, w: 8, d: 4 },
        { id: 'room-storage', label: 'Storage', type: 'storage', x: 12, z: 24, w: 8, d: 4 },
        { id: 'room-closet', label: 'Closet', type: 'storage', x: 20, z: 16, w: widthFt - 20, d: 12 },
      );
      doors.push(
        { id: 'door-laundry', fromRoomId: 'room-bath', toRoomId: 'room-laundry', openingType: 'interiorDoor', span: { x1: 14, z1: 20, x2: 16.5, z2: 20 } },
        { id: 'door-storage', fromRoomId: 'room-laundry', toRoomId: 'room-storage', openingType: 'interiorDoor', span: { x1: 14, z1: 24, x2: 16.5, z2: 24 } },
        { id: 'door-closet', fromRoomId: 'room-hall', toRoomId: 'room-closet', openingType: 'interiorDoor', span: { x1: (20 + widthFt) / 2 - 1.25, z1: 16, x2: (20 + widthFt) / 2 + 1.25, z2: 16 } },
      );
    }
  } else if (bedrooms === 2) {
    if (widthFt === 28) {
      rooms.push(
        { id: 'room-bed1', label: 'Bedroom 1', type: 'bedroom', x: 0, z: 16, w: 12, d: 12 },
        { id: 'room-bath', label: 'Bath', type: 'bathroom', x: 12, z: 16, w: 4, d: 8 },
        baths === 2
          ? { id: 'room-bath2', label: 'Bath 2', type: 'bathroom', x: 12, z: 24, w: 4, d: 4 }
          : { id: 'room-storage', label: 'Storage', type: 'storage', x: 12, z: 24, w: 4, d: 4 },
        { id: 'room-bed2', label: 'Bedroom 2', type: 'bedroom', x: 16, z: 16, w: 12, d: 12 },
      );
      doors.push(
        { id: 'door-bed1', fromRoomId: 'room-hall', toRoomId: 'room-bed1', openingType: 'interiorDoor', span: { x1: 4, z1: 16, x2: 6.5, z2: 16 } },
        { id: 'door-bath', fromRoomId: 'room-hall', toRoomId: 'room-bath', openingType: 'interiorDoor', span: { x1: 12.75, z1: 16, x2: 15.25, z2: 16 } },
        { id: 'door-bed2', fromRoomId: 'room-hall', toRoomId: 'room-bed2', openingType: 'interiorDoor', span: { x1: 18.5, z1: 16, x2: 21, z2: 16 } },
        baths === 2
          // Ensuite: Bath 2 opens from Bedroom 2 through the shared wall.
          ? { id: 'door-bath2', fromRoomId: 'room-bed2', toRoomId: 'room-bath2', openingType: 'interiorDoor', span: { x1: 16, z1: 24.75, x2: 16, z2: 27.25 } }
          : { id: 'door-storage', fromRoomId: 'room-bath', toRoomId: 'room-storage', openingType: 'interiorDoor', span: { x1: 13, z1: 24, x2: 15.5, z2: 24 } },
      );
    } else {
      // 24 ft gable: bedrooms 8 ft wide (96 sq ft) with the wet column centered.
      rooms.push(
        { id: 'room-bed1', label: 'Bedroom 1', type: 'bedroom', x: 0, z: 16, w: 8, d: 12 },
        { id: 'room-bath', label: 'Bath', type: 'bathroom', x: 8, z: 16, w: 8, d: 4 },
        { id: 'room-storage', label: 'Storage', type: 'storage', x: 8, z: 20, w: 8, d: 8 },
        { id: 'room-bed2', label: 'Bedroom 2', type: 'bedroom', x: 16, z: 16, w: 8, d: 12 },
      );
      doors.push(
        { id: 'door-bed1', fromRoomId: 'room-hall', toRoomId: 'room-bed1', openingType: 'interiorDoor', span: { x1: 3, z1: 16, x2: 5.5, z2: 16 } },
        { id: 'door-bath', fromRoomId: 'room-hall', toRoomId: 'room-bath', openingType: 'interiorDoor', span: { x1: 10.5, z1: 16, x2: 13, z2: 16 } },
        { id: 'door-bed2', fromRoomId: 'room-hall', toRoomId: 'room-bed2', openingType: 'interiorDoor', span: { x1: 18.5, z1: 16, x2: 21, z2: 16 } },
        { id: 'door-storage', fromRoomId: 'room-bath', toRoomId: 'room-storage', openingType: 'interiorDoor', span: { x1: 10, z1: 20, x2: 12.5, z2: 20 } },
      );
    }
    windows.push(
      { id: 'win-bed1-w', roomId: 'room-bed1', span: { x1: 0, z1: 20, x2: 0, z2: 24 } },
      { id: 'win-bed2-e', roomId: 'room-bed2', span: { x1: widthFt, z1: 20, x2: widthFt, z2: 24 } },
    );
  } else {
    // With a second bath (36 ft only), Bedroom 2 narrows to 8 ft and the
    // freed 4 ft column hosts Bath 2 (toward the ridge) plus a walk-in
    // closet for Bedroom 3.
    const bed2W = widthFt === 36 ? (baths === 2 ? 8 : 12) : 8;
    const bed3X = baths === 2 ? 24 : 12 + bed2W;
    rooms.push(
      { id: 'room-bed1', label: 'Bedroom 1', type: 'bedroom', x: 0, z: 16, w: 12, d: 12 },
      { id: 'room-bed2', label: 'Bedroom 2', type: 'bedroom', x: 12, z: 16, w: bed2W, d: 12 },
      { id: 'room-bed3', label: 'Bedroom 3', type: 'bedroom', x: bed3X, z: 16, w: widthFt - bed3X, d: 12 },
    );
    const bed2Mid = 12 + bed2W / 2;
    const bed3Mid = (bed3X + widthFt) / 2;
    doors.push(
      { id: 'door-bed1', fromRoomId: 'room-hall', toRoomId: 'room-bed1', openingType: 'interiorDoor', span: { x1: 4, z1: 16, x2: 6.5, z2: 16 } },
      { id: 'door-bed2', fromRoomId: 'room-hall', toRoomId: 'room-bed2', openingType: 'interiorDoor', span: { x1: bed2Mid - 1.25, z1: 16, x2: bed2Mid + 1.25, z2: 16 } },
      { id: 'door-bed3', fromRoomId: 'room-hall', toRoomId: 'room-bed3', openingType: 'interiorDoor', span: { x1: bed3Mid - 1.25, z1: 16, x2: bed3Mid + 1.25, z2: 16 } },
    );
    if (baths === 2) {
      rooms.push(
        { id: 'room-bath2', label: 'Bath 2', type: 'bathroom', x: 20, z: 16, w: 4, d: 4 },
        { id: 'room-closet', label: 'Closet', type: 'storage', x: 20, z: 20, w: 4, d: 8 },
      );
      doors.push(
        { id: 'door-bath2', fromRoomId: 'room-hall', toRoomId: 'room-bath2', openingType: 'interiorDoor', span: { x1: 20.75, z1: 16, x2: 23.25, z2: 16 } },
        { id: 'door-closet', fromRoomId: 'room-bed3', toRoomId: 'room-closet', openingType: 'interiorDoor', span: { x1: 24, z1: 22.75, x2: 24, z2: 25.25 } },
      );
    }
    windows.push(
      { id: 'win-bed1-w', roomId: 'room-bed1', span: { x1: 0, z1: 20, x2: 0, z2: 24 } },
      { id: 'win-bed2-s', roomId: 'room-bed2', span: { x1: bed2Mid - 2, z1: depthFt, x2: bed2Mid + 2, z2: depthFt } },
      { id: 'win-bed3-e', roomId: 'room-bed3', span: { x1: widthFt, z1: 20, x2: widthFt, z2: 24 } },
    );
  }

  return {
    name: `mock-${bedrooms}br-${style}`,
    footprint: { widthFt, depthFt },
    // A gable earns a loft only when it is steep enough to clear loft headroom;
    // a loft request raises the gable ridge so the central band qualifies.
    roof: { style, ridgeAxis: 'z', ridgeHeightFt: style === 'a-frame' ? 18 : (brief.hasLoft ? 20 : 14), eaveHeightFt: style === 'a-frame' ? 1 : 8 },
    lot: brief.lot ?? null,
    hasLoft: brief.hasLoft,
    // Carry the RAW request (unclamped) so compile can refuse an unbuildable
    // bedroom count instead of silently shipping the clamped 3-bed layout.
    requestedBedrooms: brief.bedrooms,
    // Carry the intended bath count so compile can SURFACE a downgrade (e.g. a
    // 2nd bath that the size/lot-constrained footprint couldn't host).
    requestedBaths: bathsRequested,
    // Carry the ≤ sqft cap so compile can refuse a cap no template can meet,
    // instead of silently shipping a footprint larger than the user allowed.
    requestedMaxSqft: brief.maxSqft,
    rooms,
    doors,
    windows,
    openings,
  };
}
