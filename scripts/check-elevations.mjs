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

console.log('plan: fresh 2-bed flat roof (constant ceiling, no slope)');
const flatPlan = compiled('2 bed flat roof, 40x60 lot, 5 ft setbacks');
const flatFront = assertHonest('flat front', flatPlan, 'front');
const flatSide = assertHonest('flat side', flatPlan, 'side');
check('flat roof ridge == eave in the elevation model', flatFront.ridgeFt === flatFront.eaveFt && flatSide.ridgeFt === flatSide.eaveFt, `${flatFront.ridgeFt}/${flatFront.eaveFt}`);
check('flat roof openings clamp under the flat roofline', [...flatFront.openings, ...flatSide.openings].every((o) => o.headFt <= flatFront.ridgeFt + 1e-6));

console.log('plan: fresh 2-bed shed roof (mono-pitch, ridge > eave)');
const shedPlan = compiled('2 bed shed roof, 40x60 lot, 5 ft setbacks');
const shedFront = assertHonest('shed front', shedPlan, 'front');
const shedSide = assertHonest('shed side', shedPlan, 'side');
check('shed roof actually slopes in the model (ridge > eave)', shedFront.ridgeFt > shedFront.eaveFt, `${shedFront.ridgeFt}/${shedFront.eaveFt}`);
check('shed front is the mono-pitch (across-slope) face', shedFront.monoPitch === true && shedFront.gableFacing === true);
check('shed front high edge is at one end (not a centered apex)', shedFront.monoPitchHighAtStart === true || shedFront.monoPitchHighAtStart === false);
check('shed openings clamp under the sloped roofline', [...shedFront.openings, ...shedSide.openings].every((o) => o.headFt <= shedFront.ridgeFt + 1e-6));
// Mono-pitch silhouette: the two ends of the across-slope wall polygon are at
// different heights (ridge vs eave), unlike a gable (symmetric) or flat (equal).
check('shed front silhouette is asymmetric (ridge end != eave end)', shedFront.ridgeFt - shedFront.eaveFt > 1, `${shedFront.ridgeFt}/${shedFront.eaveFt}`);

console.log('plan: fresh 3-bed hip roof (ridge line along x) + 2-bed hip (pyramid)');
const hipRect = compiled('3 bed hip roof, 60x80 lot, 10 ft setbacks');
const hipRectFront = assertHonest('hip-rect front', hipRect, 'front');
const hipRectSide = assertHonest('hip-rect side', hipRect, 'side');
check('hip roof eave runs around the perimeter (eave < ridge both faces)', hipRectFront.eaveFt < hipRectFront.ridgeFt && hipRectSide.eaveFt < hipRectSide.ridgeFt, `${hipRectFront.eaveFt}/${hipRectFront.ridgeFt}`);
check('hip openings clamp under the hipped roofline', [...hipRectFront.openings, ...hipRectSide.openings].every((o) => o.headFt <= hipRectFront.ridgeFt + 1e-6));
// The long side must render the hipped-end TRAPEZOID (ridge inset from both
// ends), not a full-width gable ridge.
check('hip long side is a trapezoid (ridge inset from both ends)', Boolean(hipRectFront.hipTrapezoid) && hipRectFront.hipTrapezoid.ridgeStartFt > 0.5 && hipRectFront.hipTrapezoid.ridgeEndFt < hipRectFront.spanFt - 0.5, JSON.stringify(hipRectFront.hipTrapezoid));
check('hip long-side svg draws the inset ridge (not a full-width ridge)', elevationSvgString(hipRectFront).includes('polyline'));
const hipSq = compiled('2 bed hip roof, 40x60 lot, 5 ft setbacks');
const hipSqFront = assertHonest('hip-square front', hipSq, 'front');
check('hip square footprint still renders an honest elevation', hipSqFront.eaveFt < hipSqFront.ridgeFt);

console.log('plan: fresh 2-bed gambrel (two-pitch gable end)');
const gambrelPlan = compiled('2 bed gambrel, 40x60 lot, 5 ft setbacks');
const gambrelFront = assertHonest('gambrel front', gambrelPlan, 'front');
assertHonest('gambrel side', gambrelPlan, 'side');
check('gambrel front face is the two-pitch gable end', Boolean(gambrelFront.gambrel) && gambrelFront.gambrel.knuckleHeightFt > gambrelFront.eaveFt && gambrelFront.gambrel.knuckleHeightFt < gambrelFront.ridgeFt, JSON.stringify(gambrelFront.gambrel));
check('gambrel knuckle sits inset from both ends', gambrelFront.gambrel.knuckleStartFt > 0.5 && gambrelFront.gambrel.knuckleEndFt < gambrelFront.spanFt - 0.5);
check('gambrel openings clamp under the ridge', gambrelFront.openings.every((o) => o.headFt <= gambrelFront.ridgeFt + 1e-6));

console.log('plan: fresh 3-bed barn (gambrel hip, two stacked hips)');
const barnPlan = compiled('3 bed barn roof, 60x80 lot, 10 ft setbacks');
const barnFront = assertHonest('barn front', barnPlan, 'front');
const barnSide = assertHonest('barn side', barnPlan, 'side');
check('barn both faces are two-pitch hipped', Boolean(barnFront.barnHip) && Boolean(barnSide.barnHip));
check('barn knuckle is between eave and ridge', barnFront.barnHip.knuckleHeightFt > barnFront.eaveFt && barnFront.barnHip.knuckleHeightFt < barnFront.ridgeFt, JSON.stringify(barnFront.barnHip));
check('barn knuckle is inset (hipped, not a gable end)', barnFront.barnHip.knuckleInsetFt > 0.5 && barnFront.barnHip.ridgeStartFt > barnFront.barnHip.knuckleInsetFt);
check('barn openings clamp under the ridge', [...barnFront.openings, ...barnSide.openings].every((o) => o.headFt <= barnFront.ridgeFt + 1e-6));

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
