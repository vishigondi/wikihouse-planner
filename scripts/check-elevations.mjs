// Battery for honest elevations (lib/elevations.ts).
//
// Compiles a fresh a-frame and a fresh gable through the real pipeline, then
// asserts the elevation model shows EXACTLY the artifact's openings on each
// facade — count and centerline positions within 0.5 ft — with heads clamped
// under the roof (same policy the 3D uses). No invented openings, ever.
//
// Usage: node scripts/check-elevations.mjs (npm run check:elevations)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseBrief } = await import(join(root, 'lib/brief.ts'));
const { mockIntentFromBrief, compileIntent } = await import(join(root, 'lib/generate/compile-plan.ts'));
const { buildElevationModel, elevationSvgString } = await import(join(root, 'lib/elevations.ts'));

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

function compiled(brief) {
  const result = compileIntent(mockIntentFromBrief(parseBrief(brief)), 'elev-test', brief);
  if (!result.ok) throw new Error(`compile failed: ${result.errors.join('; ')}`);
  return result.artifact;
}

function expectedFacadeOpenings(artifact, side) {
  const onFacade = (span) => (side === 'front'
    ? Math.max(Math.abs(span.z1), Math.abs(span.z2)) < 0.35
    : Math.max(Math.abs(span.x1), Math.abs(span.x2)) < 0.35);
  const center = (span) => (side === 'front' ? (span.x1 + span.x2) / 2 : (span.z1 + span.z2) / 2);
  const doors = (artifact.doors ?? []).filter((d) => d.openingType === 'exteriorDoor' && onFacade(d.span)).map((d) => center(d.span));
  const windows = (artifact.windows ?? []).filter((w) => onFacade(w.span)).map((w) => center(w.span));
  return [...doors, ...windows].sort((a, b) => a - b);
}

function assertHonest(label, artifact, side, opts = {}) {
  const model = buildElevationModel(artifact, side);
  const expected = expectedFacadeOpenings(artifact, side);
  const skippable = opts.allowSkippedWindows ?? 0;
  check(`${label}: opening count ${model.openings.length} matches facade (${expected.length}${skippable ? ` -${skippable} skippable` : ''})`,
    model.openings.length === expected.length || (skippable > 0 && expected.length - model.openings.length <= skippable));
  for (const opening of model.openings) {
    const match = expected.some((c) => Math.abs(c - opening.center) <= 0.5);
    check(`${label}: ${opening.id} centered at a real facade opening (${opening.center.toFixed(1)} ft)`, match);
    check(`${label}: ${opening.id} inside the span`, opening.center - opening.widthFt / 2 >= -0.1 && opening.center + opening.widthFt / 2 <= model.spanFt + 0.1);
    check(`${label}: ${opening.id} head above sill under ridge`, opening.headFt > opening.sillFt && opening.headFt <= model.ridgeFt);
  }
  const svg = elevationSvgString(model);
  check(`${label}: svg renders`, svg.includes('<svg') && svg.length > 600);
  return model;
}

console.log('plan: fresh 2-bed a-frame (ridge along z)');
const aframe = compiled('2 bed a-frame, 40x60 lot, 5 ft side setbacks');
const aFront = assertHonest('a-frame front', aframe, 'front');
check('a-frame front is the gable face', aFront.gableFacing === true);
check('a-frame front has entry door + living window', aFront.openings.filter((o) => o.kind === 'door').length === 1 && aFront.openings.filter((o) => o.kind === 'window').length === 1);
const aSide = assertHonest('a-frame side', aframe, 'side');
check('a-frame side is the eave face', aSide.gableFacing === false);
const lowWindow = aSide.openings.find((o) => o.kind === 'window');
check('a-frame side window clamps under the low roof', !lowWindow || lowWindow.headFt < 3.2, lowWindow ? String(lowWindow.headFt) : 'none');

console.log('plan: fresh 3-bed 2-bath gable (ridge along z)');
const gable = compiled('3 bed 2 bath gable, 60x90 lot, 10 ft setbacks');
const gFront = assertHonest('gable front', gable, 'front');
check('gable front is the gable face', gFront.gableFacing === true);
const gSide = assertHonest('gable side', gable, 'side');
const gSideWindow = gSide.openings.find((o) => o.kind === 'window');
check('gable side window keeps normal sill under 8 ft eave', !gSideWindow || (gSideWindow.sillFt > 2.5 && gSideWindow.headFt <= 8), gSideWindow ? `${gSideWindow.sillFt}..${gSideWindow.headFt}` : 'none');

console.log('plan: fresh a-frame with loft (loft window drawn at loft height)');
const aLoftPlan = compiled('2 bed a-frame with loft, 40x60 lot, 5 ft side setbacks');
const aLoftFront = buildElevationModel(aLoftPlan, 'front');
const loftOpening = aLoftFront.openings.find((o) => o.sillFt >= 8);
check('loft window drawn at loft sill height (>= 8 ft)', Boolean(loftOpening), JSON.stringify(aLoftFront.openings.map((o) => [o.id, Math.round(o.sillFt * 10) / 10])));
check('loft window stays under the ridge', !loftOpening || loftOpening.headFt <= aLoftFront.ridgeFt + 1e-6);

console.log('plan: traced a-frame-22 (ridge along x, inset openings, loft level)');
const { readFileSync } = await import('node:fs');
const traced = JSON.parse(readFileSync(join(root, 'public/data/den-image-loop/a-frame-22/paired/a-frame-22-proposal-paired-v10.paired.json'), 'utf8'));
const tracedInput = { planId: 'a-frame-22', footprint: traced.footprint, roof: traced.roof, windows: traced.windows, doors: traced.doors };
const tSide = buildElevationModel(tracedInput, 'side');
check('a-frame-22 side (west) is the gable face', tSide.gableFacing === true);
check('west facade shows the entry door', tSide.openings.filter((o) => o.kind === 'door').length === 1, JSON.stringify(tSide.openings.map((o) => o.id)));
check('west facade shows its real windows (>= 3)', tSide.openings.filter((o) => o.kind === 'window').length >= 3, String(tSide.openings.length));
const expectedWest = expectedFacadeOpeningsTraced(traced, 'side');
for (const opening of tSide.openings) {
  check(`a-frame-22 ${opening.id} centered on a real opening`, expectedWest.some((c) => Math.abs(c - opening.center) <= 0.5));
  check(`a-frame-22 ${opening.id} under the roof`, opening.headFt <= tSide.ridgeFt);
}
const loftWindow = tSide.openings.find((o) => /l1/.test(o.id));
check('loft window draws at loft height (sill >= 8)', !loftWindow || loftWindow.sillFt >= 8, loftWindow ? String(loftWindow.sillFt) : 'none');
const tFront = buildElevationModel(tracedInput, 'front');
check('a-frame-22 front is the eave face', tFront.gableFacing === false);
// The clerestory sits 0.7 ft inboard where the slope allows ~3.95 ft; the
// invariant is "clamped under the roof at its own position", not a number.
check('eave-face openings clamp under the low roof', tFront.openings.every((o) => o.headFt <= 4.2), JSON.stringify(tFront.openings.map((o) => [o.id, o.headFt])));

function expectedFacadeOpeningsTraced(artifact, side) {
  const tol = 1.6;
  const onFacade = (span) => span && (side === 'front'
    ? Math.max(Math.abs(span.z1), Math.abs(span.z2)) < tol
    : Math.max(Math.abs(span.x1), Math.abs(span.x2)) < tol);
  const center = (span) => (side === 'front' ? (span.x1 + span.x2) / 2 : (span.z1 + span.z2) / 2);
  return [...(artifact.doors ?? []), ...(artifact.windows ?? [])].filter((o) => onFacade(o.span)).map((o) => center(o.span));
}

console.log('case: no invented openings on an empty facade');
const bare = { planId: 'bare', footprint: { widthFt: 24, depthFt: 28 }, roof: { ridgeAxis: 'z', ridgeHeightFt: 14, eaveHeightFt: 8, planes: [] }, windows: [], doors: [] };
const bareModel = buildElevationModel(bare, 'front');
check('zero openings drawn', bareModel.openings.length === 0);
check('svg has no window rects', !elevationSvgString(bareModel).includes('#eef4f4'));

console.log('');
if (failures) {
  console.error(`${failures} elevation check(s) failed`);
  process.exit(1);
}
console.log('elevation battery clean');
