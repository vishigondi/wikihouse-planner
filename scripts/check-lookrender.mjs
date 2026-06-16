// Battery for the look-render prompt builder (lib/look-render.ts).
//
// Every look must yield a valid prompt that encodes the plan's REAL geometry
// (so the illustration tracks the actual design, not a generic cabin), always
// carries the illustrative "not to scale" framing + originality guard, and
// never references a competitor brand/photo. Prompts for different plans must
// differ.
//
// Usage: node scripts/check-lookrender.mjs (npm run check:lookrender)

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseBrief } = await import(join(root, 'lib/brief.ts'));
const { mockIntentFromBrief, compileIntent } = await import(join(root, 'lib/generate/compile-plan.ts'));
const { LOOKS, buildLookRenderPrompt, lookRenderSpecFromArtifact, isLookId, lookRenderAssetPath, lookRenderManifestFields, expectedStructureFromSpec } = await import(join(root, 'lib/look-render.ts'));
const { buildElevationModel } = await import(join(root, 'lib/elevations.ts'));
const { execFileSync } = await import('node:child_process');
const { readFile } = await import('node:fs/promises');

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
  const result = compileIntent(mockIntentFromBrief(parseBrief(brief)), 'lookrender-test', brief);
  if (!result.ok) throw new Error(`compile failed: ${result.errors.join('; ')}`);
  return result.artifact;
}

const LOOK_IDS = Object.keys(LOOKS);
check('seven named looks (drafted-style presets)', LOOK_IDS.length === 7 && ['dark', 'bright', 'earthy', 'bold', 'classic', 'natural', 'rustic'].every((id) => isLookId(id)), LOOK_IDS.join(','));

console.log('plan: a-frame with loft');
const aLoft = compiled('2 bed a-frame with loft, 40x60 lot, 5 ft side setbacks');
const aSpec = lookRenderSpecFromArtifact(aLoft);
check('spec carries real geometry', aSpec.roofStyle === 'a-frame' && aSpec.widthFt > 0 && aSpec.depthFt > 0 && aSpec.ridgeFt > 0 && aSpec.hasLoft === true, JSON.stringify(aSpec));

for (const look of LOOK_IDS) {
  const prompt = buildLookRenderPrompt(aSpec, look);
  // Encodes THIS plan's geometry — dims, roof style, ridge, loft.
  const encodesGeometry = prompt.includes(`${aSpec.widthFt} ft wide`)
    && prompt.includes(`${aSpec.depthFt} ft deep`)
    && prompt.includes(aSpec.roofStyle)
    && prompt.includes(`${Math.round(aSpec.ridgeFt)} ft ridge`)
    && /loft/i.test(prompt);
  check(`${look}: prompt encodes the plan's real geometry`, encodesGeometry, prompt.slice(0, 120));
  // Carries the look's own style words.
  check(`${look}: prompt carries the look style`, LOOKS[look].style.split(',').some((frag) => prompt.includes(frag.trim().split(' ')[0])));
  // Illustrative framing + originality guard, never a competitor reference.
  check(`${look}: labeled illustrative / not to scale`, /not to scale/i.test(prompt) && /not photoreal/i.test(prompt));
  check(`${look}: originality guard present`, /do not replicate any specific real building, brand, or photograph/i.test(prompt));
  check(`${look}: no competitor reference`, !/\b(den|denoutdoors|drafted)\b/i.test(prompt), prompt);
}

console.log('plan: gable (no loft) — prompt differs from the a-frame loft');
const gable = compiled('3 bed 2 bath gable, 60x90 lot, 10 ft setbacks');
const gSpec = lookRenderSpecFromArtifact(gable);
check('gable spec has no loft', gSpec.hasLoft === false, JSON.stringify(gSpec));
const aPrompt = buildLookRenderPrompt(aSpec, 'earthy');
const gPrompt = buildLookRenderPrompt(gSpec, 'earthy');
check('different plans produce different prompts', aPrompt !== gPrompt);
check('gable prompt names the gable roof + its dims', gPrompt.includes('gable') && gPrompt.includes(`${gSpec.widthFt} ft wide`), gPrompt.slice(0, 120));
check('gable prompt omits the loft phrase', !/interior loft level/.test(gPrompt));

console.log('expectedStructure: a pure projection of the compiled spec (no mismatch can be authored)');
const aExpected = expectedStructureFromSpec(aSpec);
check('expectedStructure mirrors the spec geometry',
  aExpected.roofStyle === aSpec.roofStyle
  && aExpected.widthFt === aSpec.widthFt
  && aExpected.depthFt === aSpec.depthFt
  && aExpected.gableDoors === aSpec.gableDoors
  && aExpected.gableWindows === aSpec.gableWindows
  && aExpected.hasLoft === aSpec.hasLoft,
  JSON.stringify(aExpected));
check('expectedStructure aspectRatio = round(width/depth, 2)',
  aExpected.aspectRatio === Math.round((aSpec.widthFt / aSpec.depthFt) * 100) / 100, String(aExpected.aspectRatio));
const gExpected = expectedStructureFromSpec(gSpec);
check('expectedStructure tracks the plan: a-frame+loft differs from gable',
  JSON.stringify(aExpected) !== JSON.stringify(gExpected) && aExpected.hasLoft && !gExpected.hasLoft);

console.log('import: helpers + dry-run flag an illustrative asset, never the deterministic fields');
check('isLookId rejects an unknown look', !isLookId('bogus'));
check('asset path lives under look-render/ (png default)', lookRenderAssetPath('gen-001', 'earthy') === 'look-render/gen-001-earthy.png');
check('asset path follows the image extension', lookRenderAssetPath('gen-001', 'earthy', 'jpg') === 'look-render/gen-001-earthy.jpg' && lookRenderAssetPath('gen-001', 'earthy', '.JPG') === 'look-render/gen-001-earthy.jpg');
const fields = lookRenderManifestFields('earthy', 'look-render/gen-001-earthy.png', aExpected);
check('manifest fields flag illustrative + carry expectedStructure', fields.lookRenderIllustrative === true && fields.lookRenderLook === 'earthy' && /look-render\//.test(fields.lookRenderUrl) && fields.lookRenderExpectedStructure.roofStyle === aSpec.roofStyle);
// The import script's dry-run validates args + prints the patch without IO.
let dry = null;
try {
  const out = execFileSync('node', [join(root, 'scripts/lookrender-import.mjs'), '--plan', 'gen-001', '--look', 'earthy', '--dry-run'], { encoding: 'utf8' });
  dry = JSON.parse(out);
} catch (error) {
  dry = { error: String(error.message ?? error) };
}
check('dry-run produces an illustrative patch', Boolean(dry?.patch?.lookRenderIllustrative) && dry.patch.lookRenderLook === 'earthy', JSON.stringify(dry));
check('dry-run never touches the deterministic render', dry?.touchesDeterministic === false && !('deterministicRenderUrl' in (dry?.patch ?? {})) && !('pairedJsonUrl' in (dry?.patch ?? {})) && !('sourceKind' in (dry?.patch ?? {})));

// The recorded expectedStructure must EQUAL the plan's actual compiled geometry,
// derived INDEPENDENTLY here from gen-001's stored paired JSON (the same source
// the deterministic 3D/elevations are drawn from). A mismatch cannot be recorded.
let truth = null;
try {
  const manifest = JSON.parse(await readFile(join(root, 'public/data/den-image-loop/proposal-manifest.json'), 'utf8'));
  const genOpts = manifest.plans?.['gen-001'] ?? [];
  const genOpt = genOpts.find((o) => o.latestPairedArtifact) ?? genOpts[genOpts.length - 1];
  const genPaired = JSON.parse(await readFile(join(root, 'public/data/den-image-loop/gen-001', genOpt.pairedJsonUrl), 'utf8'));
  truth = expectedStructureFromSpec(lookRenderSpecFromArtifact(genPaired));
} catch (error) {
  truth = { error: String(error.message ?? error) };
}
check('dry-run records expectedStructure = the plan\'s real compiled geometry',
  JSON.stringify(dry?.expectedStructure) === JSON.stringify(truth),
  JSON.stringify({ recorded: dry?.expectedStructure, truth }));
check('expectedStructure rides ALONGSIDE the illustrative flag in the patch',
  Boolean(dry?.patch?.lookRenderIllustrative) && JSON.stringify(dry?.patch?.lookRenderExpectedStructure) === JSON.stringify(truth));
check('recorded expectedStructure has all structural fields',
  dry?.expectedStructure && typeof dry.expectedStructure.roofStyle === 'string'
  && Number.isFinite(dry.expectedStructure.widthFt) && Number.isFinite(dry.expectedStructure.depthFt)
  && Number.isFinite(dry.expectedStructure.aspectRatio) && Number.isFinite(dry.expectedStructure.gableDoors)
  && Number.isFinite(dry.expectedStructure.gableWindows) && typeof dry.expectedStructure.hasLoft === 'boolean',
  JSON.stringify(dry?.expectedStructure));
// Traced ridge-along-x plan (a-frame-22): the gable face is the SIDE elevation
// and the plan has a loft. The derivation must read both correctly — the old
// code reported it as single-storey with zero gable openings (ridge-axis +
// loft bugs). Gable counts must equal the deterministic gable elevation.
console.log('traced ridge-along-x + loft (a-frame-22): axis-aware, loft-aware, matches the gable elevation');
let af = null;
try {
  const manifest = JSON.parse(await readFile(join(root, 'public/data/den-image-loop/proposal-manifest.json'), 'utf8'));
  const opts = manifest.plans?.['a-frame-22'] ?? [];
  const opt = opts.find((o) => o.latestPairedArtifact) ?? opts[opts.length - 1];
  const paired = JSON.parse(await readFile(join(root, 'public/data/den-image-loop/a-frame-22', opt.pairedJsonUrl), 'utf8'));
  const spec = lookRenderSpecFromArtifact(paired);
  const es = expectedStructureFromSpec(spec);
  // Independent gable elevation (ridge x -> the gable is the side view).
  const gableSide = (paired.roof?.ridgeAxis === 'x') ? 'side' : 'front';
  const gable = buildElevationModel({
    planId: 'a-frame-22',
    footprint: { widthFt: paired.footprint.widthFt, depthFt: paired.footprint.depthFt },
    roof: { style: paired.roof.style, ridgeAxis: paired.roof.ridgeAxis, ridgeHeightFt: paired.roof.ridgeHeightFt, eaveHeightFt: paired.roof.eaveHeightFt, overhangFt: paired.roof.overhangFt, planes: paired.roof.planes },
    windows: paired.windows, doors: paired.doors,
  }, gableSide);
  const eDoors = gable.openings.filter((o) => o.kind === 'door').length;
  const eWindows = gable.openings.filter((o) => o.kind === 'window').length;
  const out = execFileSync('node', [join(root, 'scripts/lookrender-import.mjs'), '--plan', 'a-frame-22', '--look', 'earthy', '--dry-run'], { encoding: 'utf8' });
  af = { es, gableSide, eDoors, eWindows, recorded: JSON.parse(out).expectedStructure };
} catch (error) {
  af = { error: String(error.message ?? error) };
}
check('a-frame-22 is read as ridge-along-x (gable = side elevation)', af?.gableSide === 'side', JSON.stringify(af));
check('a-frame-22 hasLoft = true (loft read from appliesTo/level, not just levels)', af?.es?.hasLoft === true, JSON.stringify(af?.es));
check('a-frame-22 gable counts come from the gable elevation', af?.es?.gableDoors === af?.eDoors && af?.es?.gableWindows === af?.eWindows, JSON.stringify({ es: af?.es, eDoors: af?.eDoors, eWindows: af?.eWindows }));
check('a-frame-22 has real gable openings (not the old zero)', (af?.es?.gableDoors ?? 0) + (af?.es?.gableWindows ?? 0) > 0, JSON.stringify(af?.es));
check('a-frame-22 import dry-run records that exact structure', JSON.stringify(af?.recorded) === JSON.stringify(af?.es), JSON.stringify({ recorded: af?.recorded, es: af?.es }));

let rejectedUnknown = false;
try {
  execFileSync('node', [join(root, 'scripts/lookrender-import.mjs'), '--plan', 'gen-001', '--look', 'neon', '--dry-run'], { encoding: 'utf8', stdio: 'pipe' });
} catch {
  rejectedUnknown = true;
}
check('import rejects an unknown look', rejectedUnknown);

console.log('');
if (failures) {
  console.error(`${failures} look-render check(s) failed`);
  process.exit(1);
}
console.log('look-render battery clean');
