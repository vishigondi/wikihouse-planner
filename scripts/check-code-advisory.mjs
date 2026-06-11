// Deterministic check for the Code Advisory constraint engine.
//
// Part 1 exercises every rule against synthetic fixtures with known-correct
// expected statuses. Part 2 runs the engine against the real paired JSON
// regression set and asserts the report stays structurally sound (egress
// evaluates for every sleeping room, all rules are represented).
//
// Usage: node scripts/check-code-advisory.mjs
// Exits non-zero on any mismatch.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { codeAdvisoryReport, CODE_ADVISORY_RULES } = await import(
  join(root, 'lib/standards/code-advisory.ts')
);

let failures = 0;
function check(label, actual, expected) {
  if (actual === expected) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}: expected ${expected}, got ${actual}`);
  }
}

function statusOf(report, ruleId, subjectId) {
  const match = report.findings.find(
    (item) => item.ruleId === ruleId && (subjectId === undefined || item.subjectId === subjectId),
  );
  return match?.status ?? 'missing';
}

// --- Part 1a: compliant synthetic plan -------------------------------------
console.log('fixture: compliant 2-bed cottage on 40x60 lot');
const goodLot = { widthFt: 40, depthFt: 60, setbacksFt: { front: 20, rear: 5, left: 5, right: 5 } };
const good = codeAdvisoryReport({
  planId: 'fixture-good',
  footprintWidthFt: 24,
  footprintDepthFt: 32,
  lot: goodLot,
  rooms: [
    { id: 'bed-1', label: 'Bedroom 1', type: 'bedroom', widthFt: 12, depthFt: 10, grid: { gx: 0, gz: 0, gw: 3, gd: 2.5, unitFt: 4 } },
    { id: 'bed-2', label: 'Bedroom 2', type: 'bedroom', widthFt: 8, depthFt: 12, grid: { gx: 3, gz: 0, gw: 2, gd: 3, unitFt: 4 } },
    { id: 'living', label: 'Living Room', type: 'living', widthFt: 16, depthFt: 12, grid: { gx: 0, gz: 3, gw: 4, gd: 3, unitFt: 4 } },
    { id: 'kitchen', label: 'Kitchen', type: 'kitchen', widthFt: 8, depthFt: 10, grid: { gx: 4, gz: 3, gw: 2, gd: 2.5, unitFt: 4 } },
    { id: 'bath', label: 'Bath', type: 'bathroom', widthFt: 6, depthFt: 8 },
  ],
  openings: [
    { id: 'win-bed-1', kind: 'window', roomIds: ['bed-1', 'exterior'] },
    { id: 'door-bed-2-patio', kind: 'door', openingType: 'exteriorDoor', fromRoomId: 'bed-2', toRoomId: 'exterior' },
    { id: 'win-living', kind: 'window', roomIds: ['living', 'exterior'] },
    { id: 'door-bed-1', kind: 'door', openingType: 'interiorDoor', fromRoomId: 'hall', toRoomId: 'bed-1' },
  ],
});
check('R304.1 bed-1', statusOf(good, 'IRC-R304.1', 'bed-1'), 'pass');
check('R304.2 bed-2', statusOf(good, 'IRC-R304.2', 'bed-2'), 'pass');
check('R310.1 bed-1 (window)', statusOf(good, 'IRC-R310.1', 'bed-1'), 'pass');
check('R310.1 bed-2 (exterior door)', statusOf(good, 'IRC-R310.1', 'bed-2'), 'pass');
check('grid compliance', statusOf(good, 'WH-GRID-4FT'), 'fail'); // 2.5-grid rooms are intentionally off-grid
check('setbacks 24x32 in 30x35 envelope', statusOf(good, 'ZON-SETBACK'), 'pass');
check('coverage 768/2400 = 32%', statusOf(good, 'ZON-COVERAGE'), 'pass');
check('bath not treated as habitable', good.findings.some((f) => f.subjectId === 'bath' && f.ruleId.startsWith('IRC-R304')), false);

// --- Part 1b: violating synthetic plan -------------------------------------
console.log('fixture: violating plan on the same lot');
const bad = codeAdvisoryReport({
  planId: 'fixture-bad',
  footprintWidthFt: 36,
  footprintDepthFt: 40,
  lot: goodLot,
  rooms: [
    { id: 'bed-small', label: 'Small Bedroom', type: 'bedroom', widthFt: 6, depthFt: 10, grid: { gx: 0, gz: 0, gw: 1.5, gd: 2.5, unitFt: 4 } },
    { id: 'bed-trapped', label: 'Trapped Bedroom', type: 'bedroom', widthFt: 12, depthFt: 12, grid: { gx: 2, gz: 0, gw: 3, gd: 3, unitFt: 4 } },
    { id: 'bed-unknown', label: 'Unmeasured Bedroom', type: 'bedroom' },
  ],
  openings: [
    { id: 'door-bed-small', kind: 'door', openingType: 'interiorDoor', fromRoomId: 'hall', toRoomId: 'bed-small' },
    { id: 'win-bed-small', kind: 'window', roomIds: ['bed-small', 'exterior'] },
    { id: 'door-bed-trapped', kind: 'door', openingType: 'interiorDoor', fromRoomId: 'hall', toRoomId: 'bed-trapped' },
  ],
});
check('R304.1 60 sq ft fails', statusOf(bad, 'IRC-R304.1', 'bed-small'), 'fail');
check('R304.2 6 ft fails', statusOf(bad, 'IRC-R304.2', 'bed-small'), 'fail');
check('R304.1 missing geometry not-evaluated', statusOf(bad, 'IRC-R304.1', 'bed-unknown'), 'not-evaluated');
check('R310.1 interior-only bedroom fails', statusOf(bad, 'IRC-R310.1', 'bed-trapped'), 'fail');
check('R310.1 window bedroom passes', statusOf(bad, 'IRC-R310.1', 'bed-small'), 'pass');
check('setbacks 36 ft > 30 ft envelope fails', statusOf(bad, 'ZON-SETBACK'), 'fail');
check('coverage 1440/2400 = 60% fails', statusOf(bad, 'ZON-COVERAGE'), 'fail');

// --- Part 1c: unattributed windows cannot decide egress ----------------------
console.log('fixture: windows without room references');
const unattributed = codeAdvisoryReport({
  planId: 'fixture-unattributed',
  rooms: [{ id: 'bed-x', label: 'Bedroom', type: 'bedroom', widthFt: 12, depthFt: 10 }],
  openings: [
    { id: 'door-bed-x', kind: 'door', openingType: 'interiorDoor', fromRoomId: 'hall', toRoomId: 'bed-x' },
    { id: 'win-orphan', kind: 'window' },
  ],
});
check('R310.1 not-evaluated when windows lack room refs', statusOf(unattributed, 'IRC-R310.1', 'bed-x'), 'not-evaluated');

// --- Part 1d: no lot specified ----------------------------------------------
console.log('fixture: no lot');
const noLot = codeAdvisoryReport({ planId: 'fixture-no-lot', footprintWidthFt: 24, footprintDepthFt: 32, rooms: [], openings: [] });
check('setbacks not-evaluated without lot', statusOf(noLot, 'ZON-SETBACK'), 'not-evaluated');
check('coverage not-evaluated without lot', statusOf(noLot, 'ZON-COVERAGE'), 'not-evaluated');

// --- Part 2: real paired regression set -------------------------------------
const PLANS = [
  'public/data/den-image-loop/a-frame-22/paired/a-frame-22-proposal-paired-v10.paired.json',
  'public/data/den-image-loop/a-frame-bunk/paired/a-frame-bunk-proposal-paired-v1.paired.json',
  'public/data/den-image-loop/outpost-medium/paired/outpost-medium-proposal-paired-v11.paired.json',
];

for (const relativePath of PLANS) {
  const artifact = JSON.parse(readFileSync(join(root, relativePath), 'utf8'));
  const rooms = (artifact.rooms ?? []).map((room) => ({
    id: room.id,
    label: room.label,
    type: room.type,
    floor: room.floor,
  }));
  const openings = [
    ...(artifact.doors ?? []).map((opening) => ({ opening, defaultKind: 'door' })),
    ...(artifact.windows ?? []).map((opening) => ({ opening, defaultKind: 'window' })),
    ...(artifact.openings ?? []).map((opening) => ({ opening, defaultKind: 'opening' })),
    ...(artifact.sourceOpenings ?? []).map((opening) => ({ opening, defaultKind: 'opening' })),
  ].map(({ opening, defaultKind }) => ({
    id: opening.id,
    kind: opening.kind ?? opening.type ?? defaultKind,
    openingType: opening.openingType,
    roomIds: opening.roomIds ?? (typeof opening.roomId === 'string' ? [opening.roomId] : undefined),
    fromRoomId: opening.fromRoomId,
    toRoomId: opening.toRoomId,
    opensIntoRoomId: opening.opensIntoRoomId,
  }));
  const report = codeAdvisoryReport({
    planId: artifact.planId,
    footprintWidthFt: artifact.footprint?.widthFt ?? artifact.footprint?.width,
    footprintDepthFt: artifact.footprint?.depthFt ?? artifact.footprint?.depth,
    rooms,
    openings,
    lot: artifact.lot ?? null,
  });

  console.log(`plan: ${artifact.planId} — pass ${report.summary.pass}, fail ${report.summary.fail}, not-evaluated ${report.summary.notEvaluated}`);
  for (const item of report.findings.filter((f) => f.status === 'fail')) {
    console.log(`    fail [${item.ruleId}] ${item.subjectLabel ?? ''} ${item.detail}`);
  }

  const sleeping = rooms.filter((room) => /bed|bunk|sleep/i.test(`${room.type} ${room.label}`) && !/bath/i.test(`${room.type} ${room.label}`));
  const egressFindings = report.findings.filter((item) => item.ruleId === 'IRC-R310.1');
  check(`${artifact.planId}: egress evaluated for every sleeping room (${sleeping.length})`, egressFindings.length, sleeping.length);
  check(`${artifact.planId}: every sleeping room proves egress`, egressFindings.every((item) => item.status === 'pass'), true);
  const ruleIdsInReport = new Set(report.findings.map((item) => item.ruleId));
  const lotRules = ['ZON-SETBACK', 'ZON-COVERAGE'];
  check(`${artifact.planId}: lot rules reported`, lotRules.every((ruleId) => ruleIdsInReport.has(ruleId)), true);
  check(`${artifact.planId}: grid rule reported`, ruleIdsInReport.has('WH-GRID-4FT'), true);
}

check('rule registry has 6 rules', CODE_ADVISORY_RULES.length, 6);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall code-advisory checks passed');
