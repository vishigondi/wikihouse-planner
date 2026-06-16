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
const { LOOKS, buildLookRenderPrompt, lookRenderSpecFromArtifact, isLookId } = await import(join(root, 'lib/look-render.ts'));

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

console.log('');
if (failures) {
  console.error(`${failures} look-render check(s) failed`);
  process.exit(1);
}
console.log('look-render battery clean');
