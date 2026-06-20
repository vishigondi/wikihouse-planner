// Generation battery: varied briefs through the full deterministic pipeline.
//
// For each brief: parseBrief -> mockIntentFromBrief -> compileIntent ->
// codeAdvisoryReport (jurisdiction nc-cherokee-county) with ceiling profiles
// derived from the compiled roof planes — the same derivation the app adapter
// uses — so R305 (the historical A-frame bath flaw) is asserted here, offline.
//
// Viable briefs must compile and produce ZERO constraint-fail findings.
// A brief whose footprint cannot fit its lot envelope must fail compile
// validation with a clear error instead of producing a broken plan.
//
// Usage: node scripts/check-generation.mjs (wired as npm run check:generation)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseBrief } = await import(join(root, 'lib/brief.ts'));
const { mockIntentFromBrief, compileIntent } = await import(join(root, 'lib/generate/compile-plan.ts'));
const { codeAdvisoryReport } = await import(join(root, 'lib/standards/code-advisory.ts'));

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

// --- Ceiling profile derivation (mirrors lib/standards/floorplan-standards) --
function planeEquation(points) {
  if (!points || points.length < 3) return null;
  for (let i = 0; i < points.length - 2; i += 1) {
    const [p, q, r] = [points[i], points[i + 1], points[i + 2]];
    const d = (q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z);
    if (Math.abs(d) < 1e-9) continue;
    const a = ((q.y - p.y) * (r.z - p.z) - (r.y - p.y) * (q.z - p.z)) / d;
    const b = ((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / d;
    const c = p.y - a * p.x - b * p.z;
    return {
      a, b, c,
      minX: Math.min(...points.map((pt) => pt.x)),
      maxX: Math.max(...points.map((pt) => pt.x)),
      minZ: Math.min(...points.map((pt) => pt.z)),
      maxZ: Math.max(...points.map((pt) => pt.z)),
    };
  }
  return null;
}

const STEP = 0.5;
// floorElevationFt mirrors the app's loft-aware ceiling derivation: a loft
// room's clearance is measured from the loft floor, not the ground — so the
// loft satisfies R305 on its real headroom, never via a ground-referenced
// shortcut.
function ceilingProfileForRect(rect, planes, fallbackY, floorElevationFt = 0) {
  let minFt = Infinity;
  let maxFt = -Infinity;
  let at5 = 0;
  let at7 = 0;
  let cells = 0;
  for (let x = rect.x0 + STEP / 2; x < rect.x1; x += STEP) {
    for (let z = rect.z0 + STEP / 2; z < rect.z1; z += STEP) {
      let ceilingY = Infinity;
      for (const plane of planes) {
        if (x < plane.minX - 1e-6 || x > plane.maxX + 1e-6 || z < plane.minZ - 1e-6 || z > plane.maxZ + 1e-6) continue;
        ceilingY = Math.min(ceilingY, plane.a * x + plane.b * z + plane.c);
      }
      if (!Number.isFinite(ceilingY)) ceilingY = fallbackY;
      const y = ceilingY - floorElevationFt;
      minFt = Math.min(minFt, y);
      maxFt = Math.max(maxFt, y);
      cells += 1;
      if (y >= 5) at5 += STEP * STEP;
      if (y >= 7) at7 += STEP * STEP;
    }
  }
  if (!cells) return undefined;
  return {
    minFt: Math.max(0, minFt),
    maxFt: Math.max(0, maxFt),
    areaAtOrAbove5FtSqFt: at5,
    areaAtOrAbove7FtSqFt: at7,
    source: 'roof-planes',
  };
}

function reportForArtifact(artifact) {
  const planes = (artifact.roof?.planes ?? [])
    .map((plane) => planeEquation(plane.points ?? []))
    .filter(Boolean);
  const fallbackY = artifact.roof?.ridgeHeightFt ?? 8;
  const loftFloorY = 8;
  const rooms = (artifact.rooms ?? []).map((room) => {
    const floor = room.levelIndex ?? room.floor ?? 0;
    return {
      id: room.id,
      label: room.label,
      type: room.type,
      floor,
      widthFt: room.bounds?.w,
      depthFt: room.bounds?.d,
      grid: room.bounds
        ? { gx: room.bounds.x, gz: room.bounds.z, gw: room.bounds.w, gd: room.bounds.d, unitFt: 1 }
        : undefined,
      ceiling: room.bounds && planes.length
        ? ceilingProfileForRect(
          { x0: room.bounds.x, z0: room.bounds.z, x1: room.bounds.x + room.bounds.w, z1: room.bounds.z + room.bounds.d },
          planes,
          fallbackY,
          floor >= 1 ? loftFloorY : 0,
        )
        : undefined,
    };
  });
  const openings = [
    ...(artifact.doors ?? []).map((opening) => ({ opening, defaultKind: 'door' })),
    ...(artifact.windows ?? []).map((opening) => ({ opening, defaultKind: 'window' })),
    ...(artifact.openings ?? []).map((opening) => ({ opening, defaultKind: 'opening' })),
  ].map(({ opening, defaultKind }) => ({
    id: opening.id,
    kind: opening.kind ?? opening.type ?? defaultKind,
    openingType: opening.openingType,
    windowKind: opening.windowKind,
    roomIds: opening.roomIds,
    fromRoomId: opening.fromRoomId,
    toRoomId: opening.toRoomId,
    opensIntoRoomId: opening.opensIntoRoomId,
  }));
  return codeAdvisoryReport({
    planId: artifact.planId,
    jurisdictionId: 'nc-cherokee-county',
    footprintWidthFt: artifact.footprint?.widthFt,
    footprintDepthFt: artifact.footprint?.depthFt,
    rooms,
    openings,
    lot: artifact.lot ?? null,
  });
}

function statusOf(report, ruleId, subjectId) {
  const match = report.findings.find(
    (item) => item.ruleId === ruleId && (subjectId === undefined || item.subjectId === subjectId),
  );
  return match?.status ?? 'missing';
}

// --- Battery -----------------------------------------------------------------
const CASES = [
  { name: 'canonical 2-bed a-frame', brief: '2-bed A-frame, ≤800 sqft, 40×60 lot, 5 ft side setbacks', bedrooms: 2, style: 'a-frame', hasLot: true, expectWidth: 28 },
  { name: '1-bed gable', brief: '1-bed gable cabin, 40×60 lot, 5 ft setbacks', bedrooms: 1, style: 'gable', hasLot: true, expectWidth: 28 },
  { name: '3-bed a-frame', brief: '3-bed a-frame ≤1200 sqft, 80×60 lot, 10 ft setbacks', bedrooms: 3, style: 'a-frame', hasLot: true, expectWidth: 36 },
  { name: '1-bed a-frame, no lot', brief: '1-bed a-frame', bedrooms: 1, style: 'a-frame', hasLot: false, expectWidth: 28 },
  { name: '2-bed gable', brief: '2-bed gable, lot 40x60, 5 ft side setbacks', bedrooms: 2, style: 'gable', hasLot: true, expectWidth: 28 },
  { name: '3-bed gable, per-side setbacks', brief: '3-bed gable ≤1200 sqft, 50 x 100 lot, 20 ft front setback, 5 ft side setbacks, 10 ft rear setback', bedrooms: 3, style: 'gable', hasLot: true, expectWidth: 36 },
  { name: 'barely fits envelope', brief: '2-bed a-frame, 40×58 lot, 5 ft setbacks', bedrooms: 2, style: 'a-frame', hasLot: true, expectWidth: 28 },
  { name: 'cannot fit envelope', brief: '3-bed a-frame ≤1200 sqft, 30×40 lot, 5 ft setbacks', expectCompileError: /exceeds the buildable envelope/ },
  { name: 'default brief (no program)', brief: 'cozy cabin near the creek', bedrooms: 2, style: 'a-frame', hasLot: false, expectWidth: 28 },
  // Footprint-fit capability: gables shrink to the lot envelope / maxSqft.
  { name: 'small-lot 1-bed gable shrinks to 20x24', brief: '1-bed gable cabin, 30x50 lot, 5 ft setbacks', bedrooms: 1, style: 'gable', hasLot: true, expectWidth: 20, expectDepth: 24 },
  { name: 'maxSqft shrinks 2-bed gable to 24 ft', brief: '2-bed gable, ≤700 sqft', bedrooms: 2, style: 'gable', hasLot: false, expectWidth: 24 },
  { name: 'small-lot 3-bed gable shrinks to 28 ft', brief: '3-bed gable, 40x70 lot, 5 ft setbacks', bedrooms: 3, style: 'gable', hasLot: true, expectWidth: 28 },
  { name: 'a-frame cannot shrink below headroom', brief: '2-bed a-frame, 30x50 lot, 5 ft setbacks', expectCompileError: /exceeds the buildable envelope/ },
  // Bath count capability: 2-bath on primary footprints, honest downgrade
  // when only a narrow single-bath variant fits the size limit.
  { name: '2-bed 2-bath a-frame ensuite', brief: '2 bed 2 bath a-frame, 40x60 lot, 5 ft side setbacks', bedrooms: 2, style: 'a-frame', hasLot: true, expectWidth: 28, expectBaths: 2 },
  { name: '3-bed 2-bath a-frame', brief: '3 bed 2 bath a-frame ≤1200 sqft, 80x60 lot, 10 ft setbacks', bedrooms: 3, style: 'a-frame', hasLot: true, expectWidth: 36, expectBaths: 2 },
  { name: '2-bath downgrades when only narrow fits', brief: '2 bed 2 bath gable, ≤700 sqft', bedrooms: 2, style: 'gable', hasLot: false, expectWidth: 24, expectBaths: 1, expectBathNote: true },

  // Program honesty: a bedroom count beyond the template ceiling (3) must be
  // refused with a clear message, NOT silently collapsed to a 3-bedroom plan.
  { name: '4-bed exceeds template ceiling', brief: '4 bed 2 bath gable, 1600 sqft, 80x100 lot, 10 ft setbacks', expectCompileError: /builds at most 3|requested 4 bedrooms/i },
  { name: '5-bed exceeds template ceiling', brief: '5 bed 3 bath gable, 2400 sqft, 80x120 lot, 10 ft setbacks', expectCompileError: /builds at most 3|requested 5 bedrooms/i },

  // Coverage honesty: a footprint that fits the setback envelope but exceeds the
  // 35% lot-coverage cap must be refused, not shipped as a plan that fails its
  // own ZON-COVERAGE report. (38x38 lot -> 28x28 fits envelope but 54% coverage.)
  { name: 'fits envelope but over coverage cap (a-frame)', brief: '2 bed a-frame, 38x38 lot, 5 ft setbacks', expectCompileError: /coverage cap|over the 35% coverage/i },
  { name: 'fits envelope but over coverage cap (gable)', brief: '2 bed gable, 40x40 lot, 5 ft setbacks', expectCompileError: /coverage cap|over the 35% coverage/i },

  // Sqft-cap honesty: a ≤sqft cap no template can meet must be refused, not
  // silently exceeded by shipping a larger footprint (smallest 2-bed gable is
  // 672 sqft; ≤500 is unbuildable). ≤700 (which 672 satisfies) still compiles.
  { name: 'maxSqft cap below smallest template (gable)', brief: '2 bed gable, ≤500 sqft', expectCompileError: /exceeds the requested ≤500 sq ft cap/i },
  { name: 'maxSqft cap below smallest template (a-frame)', brief: '2 bed a-frame, ≤600 sqft', expectCompileError: /exceeds the requested ≤600 sq ft cap/i },

  // Roof-style honesty: a recognized style the generator does not BUILD must be
  // REFUSED, never silently substituted. Flat + shed + hip + gambrel ARE built
  // now (blocks below); barn is still refused until built.
  { name: 'barn roof unsupported -> refused', brief: '2 bed barn roof, 60x80 lot, 10 ft setbacks', expectCompileError: /builds only .*roofs/i },

  // Gambrel roof — BUILT (fire 17): two-pitch gable (steep lower, shallow upper),
  // four planes meeting at a ridge. style 'gambrel'; R305 passes (eave ≥ 7 ft).
  { name: '2-bed gambrel', brief: '2 bed gambrel, 40x60 lot, 5 ft setbacks', bedrooms: 2, style: 'gambrel', hasLot: true, expectWidth: 28 },
  { name: '3-bed gambrel', brief: '3 bed gambrel, 60x80 lot, 10 ft setbacks', bedrooms: 3, style: 'gambrel', hasLot: true, expectWidth: 36 },
  { name: '1-bed gambrel, no lot', brief: '1 bed gambrel', bedrooms: 1, style: 'gambrel', hasLot: false, expectWidth: 28 },

  // Hip roof — BUILT (fire 16): four planes to a central ridge (a pyramid on a
  // square footprint). style 'hip'; R305 passes (eave runs around the whole
  // perimeter ≥ 7 ft).
  { name: '2-bed hip roof (square -> pyramid)', brief: '2 bed hip roof, 40x60 lot, 5 ft setbacks', bedrooms: 2, style: 'hip', hasLot: true, expectWidth: 28 },
  { name: '3-bed hip roof (rect -> ridge line)', brief: '3 bed hip roof, 60x80 lot, 10 ft setbacks', bedrooms: 3, style: 'hip', hasLot: true, expectWidth: 36 },
  { name: '1-bed hip roof, no lot', brief: '1 bed hip roof', bedrooms: 1, style: 'hip', hasLot: false, expectWidth: 28 },

  // Flat roof — BUILT (fire 14): a flat-roof brief produces a sound plan, not a
  // refusal. style 'flat', single horizontal plane, R305 passes on the flat
  // ceiling (driven through the shared report below like every other case).
  { name: '2-bed flat roof', brief: '2 bed flat roof, 40x60 lot, 5 ft setbacks', bedrooms: 2, style: 'flat', hasLot: true, expectWidth: 28 },
  { name: '3-bed flat roof', brief: '3 bed flat roof, 60x80 lot, 10 ft setbacks', bedrooms: 3, style: 'flat', hasLot: true, expectWidth: 36 },
  { name: '1-bed flat roof, no lot', brief: '1 bed flat roof', bedrooms: 1, style: 'flat', hasLot: false, expectWidth: 28 },

  // Shed roof — BUILT (fire 15): single mono-pitch slope. style 'shed', one
  // sloped plane, R305 passes (the low eave still clears 7 ft).
  { name: '2-bed shed roof', brief: '2 bed shed roof, 40x60 lot, 5 ft setbacks', bedrooms: 2, style: 'shed', hasLot: true, expectWidth: 28 },
  { name: '3-bed shed roof', brief: '3 bed shed roof, 60x80 lot, 10 ft setbacks', bedrooms: 3, style: 'shed', hasLot: true, expectWidth: 36 },
  { name: '1-bed shed roof, no lot', brief: '1 bed shed roof', bedrooms: 1, style: 'shed', hasLot: false, expectWidth: 28 },
];

for (const testCase of CASES) {
  console.log(`case: ${testCase.name} — "${testCase.brief}"`);
  const parsed = parseBrief(testCase.brief);
  const intent = mockIntentFromBrief(parsed);
  const compiled = compileIntent(intent, `battery-${CASES.indexOf(testCase)}`, testCase.brief);

  if (testCase.expectCompileError) {
    check('compile fails (honest validator catch)', !compiled.ok);
    check(
      'failure message matches expected reason',
      compiled.errors.some((error) => testCase.expectCompileError.test(error)),
      compiled.errors.join('; ') || 'no errors reported',
    );
    continue;
  }

  check('compiles cleanly', compiled.ok, compiled.errors.join('; '));
  if (!compiled.ok) continue;
  const artifact = compiled.artifact;

  // Structural assertions.
  const bedroomsInPlan = artifact.rooms.filter((room) => room.type === 'bedroom');
  check(`bedroom count ${testCase.bedrooms}`, bedroomsInPlan.length === testCase.bedrooms, `got ${bedroomsInPlan.length}`);
  check(`roof style ${testCase.style}`, artifact.roof.style === testCase.style, artifact.roof.style);
  if (testCase.expectWidth) {
    check(`footprint width ${testCase.expectWidth} ft`, artifact.footprint.widthFt === testCase.expectWidth, `got ${artifact.footprint.widthFt}`);
  }
  if (testCase.expectDepth) {
    check(`footprint depth ${testCase.expectDepth} ft`, artifact.footprint.depthFt === testCase.expectDepth, `got ${artifact.footprint.depthFt}`);
  }
  if (testCase.expectBaths) {
    const bathsInPlan = artifact.rooms.filter((room) => room.type === 'bathroom').length;
    check(`bath count ${testCase.expectBaths}`, bathsInPlan === testCase.expectBaths, `got ${bathsInPlan}`);
  }
  if (testCase.expectBathNote) {
    // A dropped 2nd bath must be SURFACED (no silent program mismatch) — same
    // input-honesty class as the bedroom over-cap refusal.
    check('bath downgrade surfaced as a note (not silent)',
      (compiled.notes || []).some((note) => /bath/i.test(note)),
      JSON.stringify(compiled.notes) || 'no notes');
  }
  if (Number.isFinite(parsed.maxSqft)) {
    const area = artifact.footprint.widthFt * artifact.footprint.depthFt;
    check(`footprint ${area} sq ft within max ${parsed.maxSqft}`, area <= parsed.maxSqft);
  }
  const unhosted = [...artifact.doors, ...artifact.windows, ...artifact.openings].filter((opening) => !opening.wallId);
  check('every door/window/opening sits on a wall', unhosted.length === 0, unhosted.map((o) => o.id).join(', '));
  // Every bathroom must have a lavatory — a toilet-only room is not a bathroom
  // (architectural completeness; compact second baths used to ship toilet-only).
  for (const bathroom of artifact.rooms.filter((room) => room.type === 'bathroom')) {
    const fxTypes = (artifact.fixtures ?? []).filter((f) => f.roomId === bathroom.id).map((f) => f.type ?? '');
    check(`bathroom ${bathroom.id} has a lavatory`, fxTypes.some((t) => /sink|vanity/i.test(t)), JSON.stringify(fxTypes));
  }
  const badCallouts = artifact.rooms.filter((room, index) => room.calloutNumber !== index + 1);
  check('callout numbers are 1..N', badCallouts.length === 0);

  // Constraint report: the fitness function.
  const report = reportForArtifact(artifact);
  const failFindings = report.findings.filter((finding) => finding.status === 'fail');
  check(
    'zero constraint-fail findings',
    failFindings.length === 0,
    failFindings.map((finding) => `[${finding.ruleId}] ${finding.subjectLabel ?? ''} ${finding.detail}`).join(' | '),
  );
  for (const bedroom of bedroomsInPlan) {
    check(`egress proves for ${bedroom.id}`, statusOf(report, 'IRC-R310.1', bedroom.id) === 'pass');
    // A sleeping room's egress window must be operable — a fixed window cannot
    // open and so cannot serve as an emergency escape opening (IRC R310.1).
    const bedWindows = (artifact.windows ?? []).filter((win) => (win.roomIds ?? [win.roomId]).includes(bedroom.id));
    check(
      `egress window operable (not fixed) for ${bedroom.id}`,
      bedWindows.length > 0 && bedWindows.every((win) => win.windowKind && win.windowKind !== 'fixed'),
      bedWindows.map((win) => `${win.id}:${win.windowKind}`).join(', '),
    );
  }
  check('4 ft grid passes', statusOf(report, 'WH-GRID-4FT') === 'pass');
  const lotExpectation = testCase.hasLot ? 'pass' : 'not-evaluated';
  check(`setbacks ${lotExpectation}`, statusOf(report, 'ZON-SETBACK') === lotExpectation, statusOf(report, 'ZON-SETBACK'));
  check(`coverage ${lotExpectation}`, statusOf(report, 'ZON-COVERAGE') === lotExpectation, statusOf(report, 'ZON-COVERAGE'));

  // R305 must genuinely evaluate from roof geometry — and pass — for every
  // wet room and habitable room. This is the named A-frame bath fix.
  const wetRooms = artifact.rooms.filter((room) => /bath|laundry/i.test(`${room.type} ${room.label}`));
  for (const wetRoom of wetRooms) {
    check(`R305 ceiling passes for ${wetRoom.id}`, statusOf(report, 'IRC-R305.1', wetRoom.id) === 'pass', statusOf(report, 'IRC-R305.1', wetRoom.id));
  }
  const r305NotEvaluated = report.findings.filter((finding) => finding.ruleId === 'IRC-R305.1' && finding.status === 'not-evaluated');
  check('R305 evaluated for every ceiling-ruled room', r305NotEvaluated.length === 0, r305NotEvaluated.map((f) => f.subjectId).join(', '));
}

// --- Loft generation ---------------------------------------------------------
// A loft level is emitted when the roof supports it, stays absent otherwise,
// never disturbs single-level plans, and passes R305 on its REAL headroom
// (clearance measured from the loft floor, not the ground).
console.log('loft: a-frame with loft yields a level-1 loft');
const aLoft = compileIntent(mockIntentFromBrief(parseBrief('2 bed a-frame with loft, 40x60 lot, 5 ft side setbacks')), 'battery-loft-a', 'a-frame loft');
check('compiles cleanly', aLoft.ok, aLoft.errors.join('; '));
check('footprint reports 2 levels', aLoft.artifact?.footprint?.levels === 2);
check('a floor-1 loft panel is emitted', (aLoft.artifact?.floorPanels ?? []).some((panel) => panel.floor === 1));
const loftRoom = (aLoft.artifact?.rooms ?? []).find((room) => room.levelIndex === 1);
check('loft room sits at level 1', loftRoom?.type === 'loft', JSON.stringify(loftRoom ?? null));
check('loft band stays inside the footprint', Boolean(loftRoom) && loftRoom.bounds.x >= 0 && loftRoom.bounds.x + loftRoom.bounds.w <= aLoft.artifact.footprint.widthFt + 1e-6);
check('loft access ladder is emitted', (aLoft.artifact?.fixtures ?? []).some((fx) => fx.type === 'loft_access_ladder'));
// The loft window must host on a same-floor loft wall (alignment requires it),
// and be named/leveled so the elevation draws it at loft sill height.
const loftWall = (aLoft.artifact?.exteriorWalls ?? []).find((wall) => wall.floor === 1);
check('a floor-1 loft wall is emitted', Boolean(loftWall), JSON.stringify(loftWall ?? null));
const loftWindow = (aLoft.artifact?.windows ?? []).find((win) => win.id === 'win-l1-loft');
check('loft window emitted at level 1', loftWindow?.floor === 1 && loftWindow?.levelIndex === 1, JSON.stringify(loftWindow ?? null));
check('loft window hosts on the loft wall', Boolean(loftWall) && loftWindow?.wallId === loftWall.id);
// R305 on the loft's true headroom (measured from the loft floor).
const aLoftReport = reportForArtifact(aLoft.artifact);
check('loft room R305 evaluated', statusOf(aLoftReport, 'IRC-R305.1', loftRoom?.id) !== 'missing' && statusOf(aLoftReport, 'IRC-R305.1', loftRoom?.id) !== 'not-evaluated', statusOf(aLoftReport, 'IRC-R305.1', loftRoom?.id));
check('loft room passes R305 from the loft floor', statusOf(aLoftReport, 'IRC-R305.1', loftRoom?.id) === 'pass', statusOf(aLoftReport, 'IRC-R305.1', loftRoom?.id));
// Fall protection (IRC R312): the loft is open to below along its long edges
// (~8 ft above the level below). The plan MUST model a guard rail on each open
// edge — a loft handed to a builder without fall protection is a real hazard.
const loftGuards = (aLoft.artifact?.interiorWalls ?? []).filter((wall) => (wall.floor ?? wall.levelIndex) === 1 && /guard|rail/i.test(`${wall.wallKind ?? ''} ${wall.kind ?? ''}`));
check('loft models a guard rail on each open edge (R312)', loftGuards.length >= 2, `${loftGuards.length} guard walls: ${loftGuards.map((w) => w.id).join(', ')}`);
check('loft guard rails stay inside the footprint', loftGuards.every((w) => w.span.x1 >= -1e-6 && w.span.x2 <= aLoft.artifact.footprint.widthFt + 1e-6 && w.span.z1 >= -1e-6 && w.span.z2 <= aLoft.artifact.footprint.depthFt + 1e-6));
// The guard is surfaced to the user as a note too (what's modeled vs what still
// needs shop-drawing detail), never silently shipped (input honesty, P5).
check('loft surfaces a fall-protection note', (aLoft.notes ?? []).some((note) => /guard|R312|fall protection/i.test(note)), JSON.stringify(aLoft.notes ?? null));

console.log('loft: a steep gable earns a loft too');
const gLoft = compileIntent(mockIntentFromBrief(parseBrief('2 bed gable with loft, 40x60 lot, 5 ft side setbacks')), 'battery-loft-g', 'gable loft');
check('compiles cleanly', gLoft.ok, gLoft.errors.join('; '));
check('steep gable yields a floor-1 loft', (gLoft.artifact?.floorPanels ?? []).some((panel) => panel.floor === 1));
const gLoftRoom = (gLoft.artifact?.rooms ?? []).find((room) => room.levelIndex === 1);
const gLoftReport = reportForArtifact(gLoft.artifact);
check('steep-gable loft passes R305 from the loft floor', statusOf(gLoftReport, 'IRC-R305.1', gLoftRoom?.id) === 'pass', statusOf(gLoftReport, 'IRC-R305.1', gLoftRoom?.id));

console.log('loft: single-level plan unchanged when no loft requested');
const noLoft = compileIntent(mockIntentFromBrief(parseBrief('2 bed a-frame, 40x60 lot, 5 ft side setbacks')), 'battery-noloft', 'a-frame');
check('stays single level', noLoft.artifact?.footprint?.levels !== 2);
check('no floor-1 panel', !(noLoft.artifact?.floorPanels ?? []).some((panel) => panel.floor === 1));
check('no level-1 rooms', !(noLoft.artifact?.rooms ?? []).some((room) => room.levelIndex === 1));
check('single-level plan has no fall-protection note', !(noLoft.notes ?? []).some((note) => /guard|R312|fall protection/i.test(note)), JSON.stringify(noLoft.notes ?? null));
check('single-level plan has no loft guard walls', !(noLoft.artifact?.interiorWalls ?? []).some((wall) => /guard|rail/i.test(`${wall.wallKind ?? ''} ${wall.kind ?? ''}`)));

// --- Flat roof (fire 14): built, not refused -------------------------------
// A flat roof is ONE horizontal plane at a constant ceiling height — the same
// plane-fit / clip / ceiling-profile machinery, with no rise. It must compile,
// expose a single horizontal roof plane, a flat ceiling for every habitable
// room, and pass R305 from that ceiling.
console.log('flat roof: a flat-roof brief builds a sound single-level plan');
const flat = compileIntent(mockIntentFromBrief(parseBrief('2 bed flat roof, 40x60 lot, 5 ft setbacks')), 'battery-flat', 'flat roof');
check('compiles cleanly', flat.ok, flat.errors.join('; '));
check('roof style is flat', flat.artifact?.roof?.style === 'flat', flat.artifact?.roof?.style);
check('flat roof has exactly one roof plane', (flat.artifact?.roof?.planes ?? []).length === 1, `${(flat.artifact?.roof?.planes ?? []).length} planes`);
const flatPlane = (flat.artifact?.roof?.planes ?? [])[0];
const flatYs = (flatPlane?.points ?? []).map((p) => p.y);
check('flat roof plane is horizontal (ridge == eave)', flatYs.length > 0 && Math.max(...flatYs) - Math.min(...flatYs) < 1e-6 && flat.artifact.roof.ridgeHeightFt === flat.artifact.roof.eaveHeightFt, `${flat.artifact?.roof?.ridgeHeightFt}/${flat.artifact?.roof?.eaveHeightFt}`);
check('flat roof stays single level (no loft band under a flat roof)', flat.artifact?.footprint?.levels !== 2);
check('flat roof elevations are valid outlines (>=3 pts)', (flat.artifact?.elevations ?? []).length === 2 && (flat.artifact?.elevations ?? []).every((e) => (e.outline ?? []).length >= 3));
const flatReport = reportForArtifact(flat.artifact);
const flatBeds = flat.artifact.rooms.filter((r) => r.type === 'bedroom');
for (const bed of flatBeds) {
  check(`flat-roof ${bed.id} R305 passes on the flat ceiling`, statusOf(flatReport, 'IRC-R305.1', bed.id) === 'pass', statusOf(flatReport, 'IRC-R305.1', bed.id));
}
check('flat roof has zero constraint-fail findings', flatReport.findings.filter((f) => f.status === 'fail').length === 0, flatReport.findings.filter((f) => f.status === 'fail').map((f) => f.ruleId).join(', '));

// --- Shed roof (fire 15): built, not refused -------------------------------
// A shed roof is ONE sloped plane (high edge ridge -> low edge eave). Same
// plane-fit / clip / ceiling-profile machinery; the slope is real (ridge > eave)
// but both heights clear 7 ft, so R305 passes across the whole floor.
console.log('shed roof: a shed-roof brief builds a sound single-slope plan');
const shed = compileIntent(mockIntentFromBrief(parseBrief('2 bed shed roof, 40x60 lot, 5 ft setbacks')), 'battery-shed', 'shed roof');
check('compiles cleanly', shed.ok, shed.errors.join('; '));
check('roof style is shed', shed.artifact?.roof?.style === 'shed', shed.artifact?.roof?.style);
check('shed roof has exactly one roof plane', (shed.artifact?.roof?.planes ?? []).length === 1, `${(shed.artifact?.roof?.planes ?? []).length} planes`);
check('shed roof actually slopes (ridge > eave)', shed.artifact?.roof?.ridgeHeightFt > shed.artifact?.roof?.eaveHeightFt, `${shed.artifact?.roof?.ridgeHeightFt}/${shed.artifact?.roof?.eaveHeightFt}`);
const shedPlaneYs = ((shed.artifact?.roof?.planes ?? [])[0]?.points ?? []).map((p) => p.y);
check('shed plane spans ridge..eave', shedPlaneYs.length > 0 && Math.abs(Math.max(...shedPlaneYs) - shed.artifact.roof.ridgeHeightFt) < 1e-6 && Math.abs(Math.min(...shedPlaneYs) - shed.artifact.roof.eaveHeightFt) < 1e-6);
check('shed roof stays single level', shed.artifact?.footprint?.levels !== 2);
check('shed roof elevations are valid outlines (>=3 pts)', (shed.artifact?.elevations ?? []).length === 2 && (shed.artifact?.elevations ?? []).every((e) => (e.outline ?? []).length >= 3));
// The across-slope (front) elevation must be ASYMMETRIC: one end at ridge, the
// other at eave — not a centered gable apex.
const shedFront = (shed.artifact?.elevations ?? []).find((e) => e.view === 'front');
const frontYs = (shedFront?.outline ?? []).map((p) => p.y);
check('shed front elevation is mono-pitch (spans ridge..eave)', frontYs.length > 0 && Math.max(...frontYs) >= shed.artifact.roof.ridgeHeightFt - 1e-6 && Math.min(...frontYs) <= shed.artifact.roof.eaveHeightFt + 1e-6);
const shedReport = reportForArtifact(shed.artifact);
for (const bed of shed.artifact.rooms.filter((r) => r.type === 'bedroom')) {
  check(`shed-roof ${bed.id} R305 passes under the slope`, statusOf(shedReport, 'IRC-R305.1', bed.id) === 'pass', statusOf(shedReport, 'IRC-R305.1', bed.id));
}
check('shed roof has zero constraint-fail findings', shedReport.findings.filter((f) => f.status === 'fail').length === 0, shedReport.findings.filter((f) => f.status === 'fail').map((f) => f.ruleId).join(', '));

// --- Hip roof (fire 16): built, not refused --------------------------------
// A hip is FOUR planes rising to a central ridge (a pyramid on a square
// footprint). The eave runs around the whole perimeter at 8 ft, so the ceiling
// is >= 8 everywhere -> R305 passes across the floor. Same plane machinery.
console.log('hip roof: square footprint -> pyramid; rectangle -> ridge line');
for (const [label, brief, expectSquare] of [['2-bed hip (square)', '2 bed hip roof, 40x60 lot, 5 ft setbacks', true], ['3-bed hip (rect)', '3 bed hip roof, 60x80 lot, 10 ft setbacks', false]]) {
  const hip = compileIntent(mockIntentFromBrief(parseBrief(brief)), 'battery-hip', brief);
  check(`${label}: compiles cleanly`, hip.ok, hip.errors.join('; '));
  if (!hip.ok) continue;
  check(`${label}: roof style is hip`, hip.artifact.roof.style === 'hip', hip.artifact.roof.style);
  check(`${label}: hip has four roof planes`, (hip.artifact.roof.planes ?? []).length === 4, `${(hip.artifact.roof.planes ?? []).length} planes`);
  check(`${label}: ridge along the longer axis`, hip.artifact.roof.ridgeAxis === (hip.artifact.footprint.widthFt >= hip.artifact.footprint.depthFt ? 'x' : 'z'));
  // Eave around the whole perimeter: every plane reaches the eave height.
  const reachesEave = (hip.artifact.roof.planes ?? []).every((p) => (p.points ?? []).some((pt) => Math.abs(pt.y - hip.artifact.roof.eaveHeightFt) < 1e-6));
  check(`${label}: every hip plane reaches the eave (perimeter eave)`, reachesEave);
  check(`${label}: stays single level`, hip.artifact.footprint.levels !== 2);
  check(`${label}: elevations are valid outlines (>=3 pts)`, (hip.artifact.elevations ?? []).every((e) => (e.outline ?? []).length >= 3));
  const hipReport = reportForArtifact(hip.artifact);
  for (const bed of hip.artifact.rooms.filter((r) => r.type === 'bedroom')) {
    check(`${label}: ${bed.id} R305 passes (perimeter eave >= 7 ft)`, statusOf(hipReport, 'IRC-R305.1', bed.id) === 'pass', statusOf(hipReport, 'IRC-R305.1', bed.id));
  }
  check(`${label}: zero constraint-fail findings`, hipReport.findings.filter((f) => f.status === 'fail').length === 0, hipReport.findings.filter((f) => f.status === 'fail').map((f) => f.ruleId).join(', '));
}

// --- Gambrel roof (fire 17): built, not refused -----------------------------
// A gambrel is a two-pitch gable: a steep lower plane (eave -> knuckle) and a
// shallow upper plane (knuckle -> ridge) per side = four planes. Eave 8 ft so
// R305 passes; the gable end is a 5-sided silhouette.
console.log('gambrel roof: a gambrel-roof brief builds a sound two-pitch plan');
const gambrel = compileIntent(mockIntentFromBrief(parseBrief('2 bed gambrel, 40x60 lot, 5 ft setbacks')), 'battery-gambrel', 'gambrel roof');
check('compiles cleanly', gambrel.ok, gambrel.errors.join('; '));
check('roof style is gambrel', gambrel.artifact?.roof?.style === 'gambrel', gambrel.artifact?.roof?.style);
check('gambrel has four roof planes (two per side)', (gambrel.artifact?.roof?.planes ?? []).length === 4, `${(gambrel.artifact?.roof?.planes ?? []).length} planes`);
// The lower slope must be STEEPER than the upper slope (the gambrel signature).
const gPlanes = gambrel.artifact?.roof?.planes ?? [];
const slopeOf = (id) => { const p = gPlanes.find((q) => q.id === id); if (!p) return 0; const ys = p.points.map((pt) => pt.y); const xs = p.points.map((pt) => pt.x); return (Math.max(...ys) - Math.min(...ys)) / Math.max(1e-6, Math.max(...xs) - Math.min(...xs)); };
check('gambrel lower slope is steeper than the upper slope', slopeOf('roof-plane-west-lower') > slopeOf('roof-plane-west-upper'), `${slopeOf('roof-plane-west-lower').toFixed(2)} vs ${slopeOf('roof-plane-west-upper').toFixed(2)}`);
check('gambrel stays single level', gambrel.artifact?.footprint?.levels !== 2);
const gFront = (gambrel.artifact?.elevations ?? []).find((e) => e.view === 'front');
check('gambrel front elevation is a 5-sided two-pitch silhouette', (gFront?.outline ?? []).length === 5, `${(gFront?.outline ?? []).length} pts`);
const gReport = reportForArtifact(gambrel.artifact);
for (const bed of gambrel.artifact.rooms.filter((r) => r.type === 'bedroom')) {
  check(`gambrel ${bed.id} R305 passes`, statusOf(gReport, 'IRC-R305.1', bed.id) === 'pass', statusOf(gReport, 'IRC-R305.1', bed.id));
}
check('gambrel has zero constraint-fail findings', gReport.findings.filter((f) => f.status === 'fail').length === 0, gReport.findings.filter((f) => f.status === 'fail').map((f) => f.ruleId).join(', '));

console.log('loft: a roof with no headroom degrades honestly (no loft built)');
// Direct intent with a near-flat roof: buildLoft must refuse rather than fake
// a loft under a roof that cannot clear one.
const flatRoofLoft = compileIntent({
  name: 'flat-loft', footprint: { widthFt: 28, depthFt: 28 }, hasLoft: true,
  roof: { style: 'gable', ridgeAxis: 'z', ridgeHeightFt: 9, eaveHeightFt: 8 },
  rooms: [
    { id: 'room-living', label: 'Living', type: 'living', x: 0, z: 0, w: 28, d: 16 },
    { id: 'room-bed1', label: 'Bedroom 1', type: 'bedroom', x: 0, z: 16, w: 28, d: 12 },
  ],
  doors: [{ id: 'door-entry', fromRoomId: 'exterior', toRoomId: 'room-living', openingType: 'exteriorDoor', span: { x1: 12, z1: 0, x2: 15, z2: 0 } }],
  windows: [{ id: 'win-bed1', roomId: 'room-bed1', span: { x1: 0, z1: 20, x2: 0, z2: 24 } }],
  openings: [],
}, 'battery-flatloft', 'flat loft');
check('compiles cleanly', flatRoofLoft.ok, flatRoofLoft.errors.join('; '));
check('no loft under a no-headroom roof', !(flatRoofLoft.artifact?.floorPanels ?? []).some((panel) => panel.floor === 1));
check('stays single level', flatRoofLoft.artifact?.footprint?.levels !== 2);

console.log('');
if (failures) {
  console.error(`${failures} generation check(s) failed`);
  process.exit(1);
}
console.log('generation battery clean');
