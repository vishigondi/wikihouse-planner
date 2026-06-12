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
function ceilingProfileForRect(rect, planes, fallbackY) {
  let minFt = Infinity;
  let maxFt = -Infinity;
  let at5 = 0;
  let at7 = 0;
  let cells = 0;
  for (let x = rect.x0 + STEP / 2; x < rect.x1; x += STEP) {
    for (let z = rect.z0 + STEP / 2; z < rect.z1; z += STEP) {
      let y = Infinity;
      for (const plane of planes) {
        if (x < plane.minX - 1e-6 || x > plane.maxX + 1e-6 || z < plane.minZ - 1e-6 || z > plane.maxZ + 1e-6) continue;
        y = Math.min(y, plane.a * x + plane.b * z + plane.c);
      }
      if (!Number.isFinite(y)) y = fallbackY;
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
  const rooms = (artifact.rooms ?? []).map((room) => ({
    id: room.id,
    label: room.label,
    type: room.type,
    floor: 0,
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
      )
      : undefined,
  }));
  const openings = [
    ...(artifact.doors ?? []).map((opening) => ({ opening, defaultKind: 'door' })),
    ...(artifact.windows ?? []).map((opening) => ({ opening, defaultKind: 'window' })),
    ...(artifact.openings ?? []).map((opening) => ({ opening, defaultKind: 'opening' })),
  ].map(({ opening, defaultKind }) => ({
    id: opening.id,
    kind: opening.kind ?? opening.type ?? defaultKind,
    openingType: opening.openingType,
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
];

for (const testCase of CASES) {
  console.log(`case: ${testCase.name} — "${testCase.brief}"`);
  const parsed = parseBrief(testCase.brief);
  const intent = mockIntentFromBrief(parsed);
  const compiled = compileIntent(intent, `battery-${CASES.indexOf(testCase)}`, testCase.brief);

  if (testCase.expectCompileError) {
    check('compile fails (honest validator catch)', !compiled.ok);
    check(
      'failure message names the envelope',
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
  if (Number.isFinite(parsed.maxSqft)) {
    const area = artifact.footprint.widthFt * artifact.footprint.depthFt;
    check(`footprint ${area} sq ft within max ${parsed.maxSqft}`, area <= parsed.maxSqft);
  }
  const unhosted = [...artifact.doors, ...artifact.windows, ...artifact.openings].filter((opening) => !opening.wallId);
  check('every door/window/opening sits on a wall', unhosted.length === 0, unhosted.map((o) => o.id).join(', '));
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

console.log('');
if (failures) {
  console.error(`${failures} generation check(s) failed`);
  process.exit(1);
}
console.log('generation battery clean');
