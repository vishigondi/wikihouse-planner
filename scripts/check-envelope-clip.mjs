// Battery for the constructive envelope clipper (lib/bim/envelope-clip.ts).
//
// Uses the exact roof plane point arrays compileIntent emits for the
// compiled A-frame (ridge 18 / eave 1, ridge along z, 1 ft overhang) and
// gable (ridge 14 / eave 8). Asserts the one clipping function produces
// gable-end triangles, eave knee wedges, capped partitions, and honest
// window clipping — and that NO output vertex ever exceeds the envelope.
//
// Usage: node scripts/check-envelope-clip.mjs (npm run check:clip)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ceilingPlanesFromRoofPoints, ceilingHeightAt, clipPrismToCeiling, rectFootprint } = await import(
  join(root, 'lib/bim/envelope-clip.ts')
);

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

// Compiled A-frame roof, ridge along z: width 24, depth 28, ridge 18, eave 1.
const W = 24;
const D = 28;
const aFramePlanes = ceilingPlanesFromRoofPoints([
  { points: [{ x: -1, y: 1, z: -1 }, { x: W / 2, y: 18, z: -1 }, { x: W / 2, y: 18, z: D + 1 }, { x: -1, y: 1, z: D + 1 }] },
  { points: [{ x: W / 2, y: 18, z: -1 }, { x: W + 1, y: 1, z: -1 }, { x: W + 1, y: 1, z: D + 1 }, { x: W / 2, y: 18, z: D + 1 }] },
]);
// Compiled gable roof on the same footprint: ridge 14, eave 8.
const gablePlanes = ceilingPlanesFromRoofPoints([
  { points: [{ x: -1, y: 8, z: -1 }, { x: W / 2, y: 14, z: -1 }, { x: W / 2, y: 14, z: D + 1 }, { x: -1, y: 8, z: D + 1 }] },
  { points: [{ x: W / 2, y: 14, z: -1 }, { x: W + 1, y: 8, z: -1 }, { x: W + 1, y: 8, z: D + 1 }, { x: W / 2, y: 14, z: D + 1 }] },
]);

check('a-frame planes fitted', aFramePlanes.length === 2, `got ${aFramePlanes.length}`);
check('gable planes fitted', gablePlanes.length === 2, `got ${gablePlanes.length}`);
check('a-frame ceiling at ridge ~18', Math.abs(ceilingHeightAt(aFramePlanes, 12, 14) - 18) < 1e-6);
const eaveEdgeH = ceilingHeightAt(aFramePlanes, 0, 14); // 1 + 17/13
check('a-frame ceiling at x=0 ~2.31', Math.abs(eaveEdgeH - (1 + 17 / 13)) < 1e-6, String(eaveEdgeH));

function vertexViolations(solid, planes, y0) {
  let worst = 0;
  for (let i = 0; i < solid.positions.length; i += 3) {
    const [x, y, z] = [solid.positions[i], solid.positions[i + 1], solid.positions[i + 2]];
    const limit = ceilingHeightAt(planes, x, z);
    worst = Math.max(worst, y - limit, y0 - y);
  }
  return worst;
}

console.log('case: gable end wall -> full triangle profile');
const gableEnd = clipPrismToCeiling(rectFootprint(0, 0, W, 0.5), 0, 99, aFramePlanes);
check('not empty', !gableEnd.empty);
check('peaks at ridge height', Math.abs(gableEnd.maxY - 18) < 0.1, String(gableEnd.maxY));
check('no vertex above envelope or below floor', vertexViolations(gableEnd, aFramePlanes, 0) < 1e-6, String(vertexViolations(gableEnd, aFramePlanes, 0)));

console.log('case: eave wall -> knee wedge');
const eaveWall = clipPrismToCeiling(rectFootprint(0, 0, 0.5, D), 0, 99, aFramePlanes);
check('not empty', !eaveWall.empty);
check('stays low (knee height)', eaveWall.maxY < 3.2 && eaveWall.maxY > 1.0, String(eaveWall.maxY));
check('no envelope violation', vertexViolations(eaveWall, aFramePlanes, 0) < 1e-6);

console.log('case: ridge-straddling partition capped at 8 ft');
const partition = clipPrismToCeiling(rectFootprint(10, 12, 4, 4), 0, 8, aFramePlanes);
check('not empty', !partition.empty);
check('flat top at cap', Math.abs(partition.maxY - 8) < 1e-6 && Math.abs(partition.minTopY - 8) < 1e-6, `${partition.minTopY}..${partition.maxY}`);

console.log('case: window slab on the low eave wall');
const sunkWindow = clipPrismToCeiling(rectFootprint(0, 10, 0.4, 4), 3, 7, aFramePlanes);
check('fully above-roof glazing clips to nothing', sunkWindow.empty);
const lowWindow = clipPrismToCeiling(rectFootprint(0, 10, 0.4, 4), 1.5, 7, aFramePlanes);
check('partially clipped glazing survives below roof', !lowWindow.empty);
check('clipped glazing never exceeds envelope', vertexViolations(lowWindow, aFramePlanes, 1.5) < 1e-6);
// Tallest surviving sliver: ceiling at the slab's inner face (x=0.4) minus
// the 1.5 ft sill = 1.33 ft. The renderer's skip-pane policy uses the
// minTopY-based height, which is lower still.
check('clipped glazing is a sliver', lowWindow.maxY - 1.5 < 1.4, String(lowWindow.maxY - 1.5));
check('sliver height from minTopY is under 1 ft', lowWindow.minTopY - 1.5 < 1.0, String(lowWindow.minTopY - 1.5));

console.log('case: gable-roof interiors are untouched boxes');
const gablePartition = clipPrismToCeiling(rectFootprint(10, 12, 4, 4), 0, 8, gablePlanes);
check('flat top at 8', Math.abs(gablePartition.maxY - 8) < 1e-6 && Math.abs(gablePartition.minTopY - 8) < 1e-6);
const gableWindow = clipPrismToCeiling(rectFootprint(0, 10, 0.4, 4), 3, 7, gablePlanes);
check('eave-wall window kept whole under 8 ft eave', !gableWindow.empty && Math.abs(gableWindow.maxY - 7) < 1e-6, String(gableWindow.maxY));

console.log('case: solid entirely above the roof');
const floating = clipPrismToCeiling(rectFootprint(0, 10, 0.4, 4), 19, 22, aFramePlanes);
check('clips to empty', floating.empty);

console.log('');
if (failures) {
  console.error(`${failures} envelope-clip check(s) failed`);
  process.exit(1);
}
console.log('envelope-clip battery clean');
