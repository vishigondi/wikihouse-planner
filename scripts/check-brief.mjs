// Deterministic check for the natural-language brief parser.
// Usage: node scripts/check-brief.mjs — exits non-zero on any mismatch.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseBrief, briefToPromptFields } = await import(join(root, 'lib/brief.ts'));

let failures = 0;
function sortKeys(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]));
  }
  if (Array.isArray(value)) return value.map(sortKeys);
  return value;
}

function check(label, actual, expected) {
  const a = JSON.stringify(sortKeys(actual));
  const e = JSON.stringify(sortKeys(expected));
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}: expected ${e}, got ${a}`);
  }
}

// --- The canonical north-star brief ------------------------------------------
console.log('brief: canonical north-star');
const canonical = parseBrief('2-bed A-frame, ≤800 sqft, 40×60 lot, 5 ft side setbacks');
check('bedrooms', canonical.bedrooms, 2);
check('maxSqft', canonical.maxSqft, 800);
check('roofStyle', canonical.roofStyle, 'a-frame');
check('lot dims', [canonical.lot?.widthFt, canonical.lot?.depthFt], [40, 60]);
check('side setbacks', [canonical.lot?.setbacksFt?.left, canonical.lot?.setbacksFt?.right], [5, 5]);
check('front/rear unset', [canonical.lot?.setbacksFt?.front, canonical.lot?.setbacksFt?.rear], [undefined, undefined]);
check('nothing unparsed', canonical.unparsed, []);

// --- Variants ----------------------------------------------------------------
console.log('brief: verbose variant');
const verbose = parseBrief('3 bedroom 2 bath gable cabin, two stories, under 1,400 sq ft, lot 50 x 100, 20 ft front setback, 5 ft side setbacks, 10 ft rear setback, 35% max coverage');
check('bedrooms', verbose.bedrooms, 3);
check('baths', verbose.baths, 2);
check('roofStyle', verbose.roofStyle, 'gable');
check('levels', verbose.levels, 2);
check('maxSqft', verbose.maxSqft, 1400);
check('lot dims', [verbose.lot?.widthFt, verbose.lot?.depthFt], [50, 100]);
check('setbacks', verbose.lot?.setbacksFt, { left: 5, right: 5, front: 20, rear: 10 });
check('coverage', verbose.lot?.maxCoverageRatio, 0.35);

console.log('brief: uniform setbacks + footprint');
const uniform = parseBrief('1-bed shed-roof ADU, 24x28 footprint, 40x60 lot, 5 ft setbacks');
check('roofStyle', uniform.roofStyle, 'shed');
check('footprint', [uniform.footprintWidthFt, uniform.footprintDepthFt], [24, 28]);
check('uniform setbacks', uniform.lot?.setbacksFt, { front: 5, rear: 5, left: 5, right: 5 });

console.log('brief: sparse input stays sparse');
const sparse = parseBrief('cozy cabin in the woods');
check('no bedrooms', sparse.bedrooms, undefined);
check('no lot', sparse.lot, undefined);
check('unparsed surfaced', sparse.unparsed.length > 0, true);

console.log('brief: word numbers');
const wordy = parseBrief('tiny one bedroom a-frame cabin in the woods');
check('one bedroom', wordy.bedrooms, 1);
check('roofStyle', wordy.roofStyle, 'a-frame');
const wordy2 = parseBrief('three bed gable house, two baths');
check('three bed', wordy2.bedrooms, 3);
check('two baths', wordy2.baths, 2);
check('no number words left unparsed', wordy2.unparsed.some((part) => /two|three/.test(part)), false);

console.log('brief: loft is recognized program intent, not ignored');
const lofty = parseBrief('2 bed a-frame with loft, 40x60 lot, 5 ft side setbacks');
check('hasLoft set', lofty.hasLoft, true);
check('roofStyle', lofty.roofStyle, 'a-frame');
check('loft not in unparsed', lofty.unparsed.some((part) => /loft/i.test(part)), false);
const sleepingLoft = parseBrief('3 bed gable, sleeping loft, 60x90 lot');
check('sleeping loft sets hasLoft', sleepingLoft.hasLoft, true);
const noLoft = parseBrief('2 bed a-frame, 40x60 lot');
check('no loft stays undefined', noLoft.hasLoft, undefined);

console.log('brief: foot-unit setbacks + honest unparsed inside sentences');
const footy = parseBrief('three bedroom two bath gable farmhouse on a 60 x 90 lot with 10 foot setbacks');
check('bedrooms', footy.bedrooms, 3);
check('baths', footy.baths, 2);
check('lot dims', [footy.lot?.widthFt, footy.lot?.depthFt], [60, 90]);
check('foot setbacks parse uniformly', footy.lot?.setbacksFt, { front: 10, rear: 10, left: 10, right: 10 });
check('dropped phrase surfaces', footy.unparsed.includes('farmhouse'), true);

// --- Prompt field rendering ---------------------------------------------------
console.log('briefToPromptFields: canonical');
const fields = briefToPromptFields(canonical);
check('bedBath field', fields.bedBath, '2 bed / ? bath');
check('roof field', fields.roof, 'a-frame');
check('footprint hint from sqft', fields.footprint, 'up to 800 sq ft total');
check('constraints mention lot JSON', /"widthFt":40/.test(fields.constraints ?? ''), true);
check('constraints mention sqft cap', /800 sq ft/.test(fields.constraints ?? ''), true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nall brief checks passed');
