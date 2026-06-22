// Manufacturability battery (npm run check:buildable).
//
// Drives every generated plan through lib/build-validator.ts — the WikiHouse
// panel-module / wall-height / openings-fit-panels rules — and asserts the
// PANEL-FIT rules pass. The planner's structural module is the 4 ft grid
// (WH-GRID-4FT); build-validator measures buildability against that same module
// (PANEL_WIDTH_FT = 4), so a 4 ft-grid plan validates as panel-buildable.
//
// Gated rules grow as each class is root-fixed: wall-module + wall-height +
// openings (4 ft module, fire 3) + floor-span (bearing-line joist span, fire 4).
// Still tracked in gen-sweep.md and NOT yet asserted (real, separate):
//   * roof-pitch  — some generated pitches aren't on the rafter-SKU list.
//   * loft walls  — a loft's headroom-band wall isn't 4 ft-aligned.
// As each is fixed, add its rule id to PANEL_FIT_RULES below.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseBrief } = await import(join(root, 'lib/brief.ts'));
const { mockIntentFromBrief, compileIntent } = await import(join(root, 'lib/generate/compile-plan.ts'));
const { validateBuildability } = await import(join(root, 'lib/build-validator.ts'));

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
}

// Minimal artifact -> DenHome adapter for the buildability validator. The real
// app uses lib/data.ts (not Node-loadable here); this maps the same fields the
// validator reads. Wall/opening coords are in 4 ft grid units (build-validator
// multiplies by 4 to get feet), so divide artifact feet by 4.
function toHome(a) {
  const wall = (w, exterior) => ({ id: w.id, exterior, x1: w.span.x1 / 4, z1: w.span.z1 / 4, x2: w.span.x2 / 4, z2: w.span.z2 / 4 });
  const sourceWalls = [
    ...(a.exteriorWalls ?? []).filter((w) => w.span).map((w) => wall(w, true)),
    ...(a.interiorWalls ?? []).filter((w) => w.span).map((w) => wall(w, false)),
  ];
  const sourceOpenings = [
    ...(a.windows ?? []).map((w) => ({ ...w, kind: 'window' })),
    ...(a.doors ?? []).map((d) => ({ ...d, kind: 'door' })),
  ].filter((o) => o.span).map((o) => ({ id: o.id, kind: o.kind, x1: o.span.x1 / 4, z1: o.span.z1 / 4, x2: o.span.x2 / 4, z2: o.span.z2 / 4, roomIds: o.roomIds ?? [o.roomId] }));
  return {
    footprint: { width: a.footprint.w, depth: a.footprint.d },
    height: a.roof.ridgeHeightFt,
    roofStyle: a.roof.style,
    roofSemantics: { ridgeHeightFt: a.roof.ridgeHeightFt, eaveHeightFt: a.roof.eaveHeightFt, ridgeAxis: a.roof.ridgeAxis },
    sourceWalls,
    sourceOpenings,
    rooms: (a.rooms ?? []).map((r) => ({ type: r.type, label: r.label, widthFt: r.bounds?.w, depthFt: r.bounds?.d })),
  };
}

const PANEL_FIT_RULES = ['wall-module', 'wall-height', 'openings', 'floor-span'];

// Every roof style × a representative bedroom span, single level (loft walls are
// a tracked open class). a-frame caps at 3 beds.
const BRIEFS = [];
for (const style of ['a-frame', 'gable', 'flat', 'shed', 'hip', 'gambrel', 'barn']) {
  for (const beds of [1, 2, 3, 4]) {
    if (style === 'a-frame' && beds === 4) continue;
    BRIEFS.push(`${beds} bed ${style} roof, 80x100 lot, 10 ft setbacks`);
  }
}
// Loft plans add a floor-1 gable wall — its length must also be a panel multiple
// (the loft band is snapped to 4 ft). Cover the loft-capable styles.
for (const style of ['a-frame', 'gable', 'gambrel', 'barn']) {
  BRIEFS.push(`2 bed ${style} roof with loft, 40x60 lot, 5 ft setbacks`);
}

for (const brief of BRIEFS) {
  const res = compileIntent(mockIntentFromBrief(parseBrief(brief)), 'buildable-test', brief);
  if (!res.ok) { check(`${brief} — compiles`, false, res.errors.join('; ')); continue; }
  const report = validateBuildability(toHome(res.artifact));
  const ruleStatus = Object.fromEntries((report.rules ?? []).map((r) => [r.id, r]));
  for (const ruleId of PANEL_FIT_RULES) {
    const rule = ruleStatus[ruleId];
    check(`${brief} — ${ruleId} buildable`, rule && rule.status !== 'blocked', rule ? (rule.details ?? []).slice(0, 1).join('') : 'rule missing');
  }
  // The validator must produce a real bill of materials (panels counted).
  check(`${brief} — BOM generated`, Array.isArray(report.bom) && report.bom.length > 0);
}

if (failures) {
  console.error(`\n${failures} buildable check(s) failed`);
  process.exit(1);
}
console.log('\nbuildable battery clean (panel-fit rules)');
