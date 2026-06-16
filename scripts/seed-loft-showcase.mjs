// Seed a PERSISTENT compiled-loft showcase plan (`loft-showcase`).
//
// gen-001 is the kept compiled plan with no loft; this is its loft sibling, used
// by the look-render consistency showcase to demonstrate the loft structural
// fact on a COMPILED plan. Deterministic + reproducible: same brief in, same
// artifact out (mock intent → compileIntent), persisted exactly like the
// generate route does. Re-running overwrites the paired JSON + manifest entry
// (idempotent). Run the deterministic render afterwards:
//   node scripts/seed-loft-showcase.mjs
//   npm run render:paired -- --plans loft-showcase --url http://127.0.0.1:3002

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { parseBrief } = await import(join(root, 'lib/brief.ts'));
const { mockIntentFromBrief, compileIntent } = await import(join(root, 'lib/generate/compile-plan.ts'));

const PLAN_ID = 'loft-showcase';
const BRIEF = '2 bedroom a-frame with loft, 44x60 lot, 5 ft side setbacks';
const loopDir = join(root, 'public', 'data', 'den-image-loop');
const manifestPath = join(loopDir, 'proposal-manifest.json');

const parsed = parseBrief(BRIEF);
const intent = mockIntentFromBrief(parsed);
intent.hasLoft = parsed.hasLoft;
const compiled = compileIntent(intent, PLAN_ID, BRIEF);
if (!compiled.ok || !compiled.artifact) {
  console.error('seed-loft-showcase — compile failed:', compiled.errors);
  process.exit(1);
}
if ((compiled.artifact.footprint?.levels ?? 1) <= 1) {
  console.error('seed-loft-showcase — expected a loft (levels > 1); got', compiled.artifact.footprint?.levels);
  process.exit(1);
}

const pairedDir = join(loopDir, PLAN_ID, 'paired');
await mkdir(pairedDir, { recursive: true });
await writeFile(
  join(pairedDir, `${PLAN_ID}-proposal-paired-v1.paired.json`),
  `${JSON.stringify(compiled.artifact, null, 2)}\n`,
);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const existing = Array.isArray(manifest.plans[PLAN_ID]) ? manifest.plans[PLAN_ID][0] : null;
manifest.plans[PLAN_ID] = [{
  id: 'proposal-paired-v1',
  label: 'paired v1 (mock — compiled loft showcase)',
  hasImage: false,
  imageUrl: null,
  hasSeed: false,
  hasMatch: false,
  parserReady: false,
  promotionReady: false,
  artifactVersion: 'paired_gpt_floorplan_v1',
  sourceKind: 'constrained_json',
  gptSourceReady: false,
  pairedArtifact: true,
  latestPairedArtifact: true,
  latestGptPairedArtifact: false,
  pairedJsonUrl: `paired/${PLAN_ID}-proposal-paired-v1.paired.json`,
  deterministicRenderUrl: `paired/${PLAN_ID}-proposal-paired-v1.render.svg`,
  promotionEligible: false,
  legacyParserReady: false,
  archived: false,
  archiveReason: null,
  blockers: [],
  hasSemanticJson: false,
  hasSemanticSvg: false,
  reviewStatus: 'passed',
  // Preserve any look-render metadata already attached on a re-seed.
  ...(existing?.lookRenderUrl ? {
    lookRenderUrl: existing.lookRenderUrl,
    lookRenderLook: existing.lookRenderLook,
    lookRenderIllustrative: existing.lookRenderIllustrative,
    lookRenderExpectedStructure: existing.lookRenderExpectedStructure,
  } : {}),
}];
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`seed-loft-showcase — wrote ${PLAN_ID} (a-frame loft, ${compiled.artifact.footprint.widthFt}x${compiled.artifact.footprint.depthFt}, levels ${compiled.artifact.footprint.levels})`);
