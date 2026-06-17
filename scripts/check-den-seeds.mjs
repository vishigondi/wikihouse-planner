#!/usr/bin/env node
/**
 * Smoke-check the paired GPT floorplan data as the app sees it through public/data.
 *
 * The app now treats paired_gpt_floorplan_v1 image+JSON artifacts as the only
 * selectable proposal source. Legacy parsed seeds, match files, and static
 * proposal IDs must not re-enter app defaults.
 */

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LOOP_ROOT = resolve(ROOT, 'public/data/den-image-loop');
const PROPOSAL_MANIFEST_PATH = resolve(LOOP_ROOT, 'proposal-manifest.json');
const PAIRED_QUEUE_PATH = resolve(LOOP_ROOT, 'paired-generation-queue.json');
const LIBRARY_PATH = resolve(ROOT, 'public/data/library.json');
const COMPONENTS_PATH = resolve(ROOT, 'public/data/components.json');
const COVERAGE_PATH = resolve(ROOT, 'public/data/coverage.json');
const ENV_EXAMPLE_PATH = resolve(ROOT, '.env.example');
const APP_PAGE_PATH = resolve(ROOT, 'app/page.tsx');
const DATA_MODULE_PATH = resolve(ROOT, 'lib/data.ts');
const TYPES_PATH = resolve(ROOT, 'lib/types.ts');
const BUILD_VALIDATOR_PATH = resolve(ROOT, 'lib/build-validator.ts');
const RENDER_THEMES_PATH = resolve(ROOT, 'lib/render-themes.ts');
const SCENE_PATH = resolve(ROOT, 'components/three/Scene.tsx');
const HOME_MODEL_PATH = resolve(ROOT, 'components/three/HomeModel.tsx');
const BROCHURE_QA_PATH = resolve(ROOT, 'scripts/brochure-visual-qa.mjs');
const APPLY_REPAIR_PATCH_PATH = resolve(ROOT, 'scripts/apply-brochure-repair-patch.mjs');
const REQUEST_REPAIR_PATCH_PATH = resolve(ROOT, 'scripts/request-brochure-repair-patch.mjs');
const RUN_REPAIR_LOOP_PATH = resolve(ROOT, 'scripts/run-brochure-repair-loop.mjs');
const INGEST_REPAIR_RESPONSE_PATH = resolve(ROOT, 'scripts/ingest-gpt-repair-response.mjs');
const REPAIR_DOCTOR_PATH = resolve(ROOT, 'scripts/repair-doctor.mjs');
const DRAFTED_PRODUCT_AUDIT_PATH = resolve(ROOT, 'scripts/drafted-product-audit.mjs');
const PRINT_REPAIR_PROMPT_PATH = resolve(ROOT, 'scripts/print-brochure-repair-prompt.mjs');
const PRINT_REPAIR_QUEUE_PATH = resolve(ROOT, 'scripts/print-brochure-repair-queue.mjs');
const REMOVED_LEGACY_PATHS = [
  'app/den-seeds',
  'autoresearch/plan-fidelity/value_guardian_loop.py',
  'scripts/generate-data.py',
  'scripts/analyze-plans.py',
  'scripts/auto-improve.ts',
  'lib/conversion-validator.ts',
  'lib/graph-layout.ts',
  'lib/generate-placements.ts',
  'lib/plan-validator.ts',
];
const TARGET_PROMOTED_PLAN = 'outpost-medium';
const TARGET_PROMOTED_PROPOSAL = 'proposal-paired-v11';
const TARGET_REVIEW_PLAN = 'outpost-medium';
const TARGET_REVIEW_PROPOSAL = 'proposal-paired-v5';
const TARGET_BLOCKED_PLAN = 'a-frame-bunk-plus';
const TARGET_BLOCKED_PROPOSAL = 'proposal-paired-v1';
const TARGET_ROOF_PLAN = 'a-frame-bunk';
const TARGET_ROOF_PROPOSAL = 'proposal-paired-v1';
const TARGET_PRIMITIVE_PROMOTED_PLAN = 'a-frame-22';
const TARGET_PRIMITIVE_PROMOTED_PROPOSAL = 'proposal-paired-v10';
const PROMOTED_PRIMITIVE_DRIFT_CAPS = {
  primitiveEdgeSourceMissRate: 0.09,
  primitiveEdgeRenderExtraRate: 0.06,
  wallEdgeSourceMissRate: 0.01,
  wallEdgeRenderExtraRate: 0.06,
  doorEdgeSourceMissRate: 0.09,
  doorEdgeRenderExtraRate: 0.05,
  fixtureEdgeSourceMissRate: 0.12,
  fixtureEdgeRenderExtraRate: 0.08,
  windowEdgeSourceMissRate: 0.06,
  windowEdgeRenderExtraRate: 0.04,
};

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`paired:smoke failed: ${message}`);
    process.exit(1);
  }
}

function assertRateAtOrBelow(value, cap, label) {
  assert(typeof value === 'number' && Number.isFinite(value), `${label} is missing`);
  assert(value <= cap, `${label} ${value.toFixed(4)} exceeds cap ${cap.toFixed(4)}`);
}

function assertPromotedPrimitiveDriftFloor(option, drift) {
  const label = `${option.planId} ${option.id}`;
  const metrics = drift.metrics ?? {};
  const layerDrift = metrics.primitiveLayerDrift ?? {};
  assertRateAtOrBelow(
    metrics.primitiveEdgeSourceMissRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.primitiveEdgeSourceMissRate,
    `${label} primitive edge source miss`,
  );
  assertRateAtOrBelow(
    metrics.primitiveEdgeRenderExtraRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.primitiveEdgeRenderExtraRate,
    `${label} primitive edge render extra`,
  );
  assertRateAtOrBelow(
    layerDrift.wall?.edgeSourceMissRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.wallEdgeSourceMissRate,
    `${label} wall edge source miss`,
  );
  assertRateAtOrBelow(
    layerDrift.wall?.edgeRenderExtraRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.wallEdgeRenderExtraRate,
    `${label} wall edge render extra`,
  );
  assertRateAtOrBelow(
    layerDrift.door?.edgeSourceMissRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.doorEdgeSourceMissRate,
    `${label} door edge source miss`,
  );
  assertRateAtOrBelow(
    layerDrift.door?.edgeRenderExtraRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.doorEdgeRenderExtraRate,
    `${label} door edge render extra`,
  );
  assertRateAtOrBelow(
    layerDrift.fixture?.edgeSourceMissRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.fixtureEdgeSourceMissRate,
    `${label} fixture edge source miss`,
  );
  assertRateAtOrBelow(
    layerDrift.fixture?.edgeRenderExtraRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.fixtureEdgeRenderExtraRate,
    `${label} fixture edge render extra`,
  );
  assertRateAtOrBelow(
    layerDrift.window?.edgeSourceMissRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.windowEdgeSourceMissRate,
    `${label} window edge source miss`,
  );
  assertRateAtOrBelow(
    layerDrift.window?.edgeRenderExtraRate,
    PROMOTED_PRIMITIVE_DRIFT_CAPS.windowEdgeRenderExtraRate,
    `${label} window edge render extra`,
  );
}

function planDirs() {
  return readdirSync(LOOP_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'schemas')
    .map((entry) => entry.name)
    .sort();
}

assert(existsSync(LOOP_ROOT), `missing public data path: ${LOOP_ROOT}`);
assert(lstatSync(LOOP_ROOT).isSymbolicLink(), `expected symlink at ${LOOP_ROOT}`);
assert(existsSync(PROPOSAL_MANIFEST_PATH), `missing proposal manifest: ${PROPOSAL_MANIFEST_PATH}`);
assert(existsSync(PAIRED_QUEUE_PATH), `missing paired generation queue: ${PAIRED_QUEUE_PATH}`);
assert(!existsSync(resolve(ROOT, 'app/brochure')), 'brochure route should remain removed');
assert(!existsSync(resolve(ROOT, 'public/data/den-seeds')), 'old Den seed symlink/data path should remain removed from the paired compiler foundation');
assert(!existsSync(resolve(ROOT, 'public/data/homes')), 'old static home JSON directory should remain removed');
assert(!existsSync(resolve(ROOT, 'public/data/spatial-manifest.json')), 'old SpatialIR manifest symlink should remain removed');
assert(!existsSync(resolve(ROOT, 'public/data/kintsugi-plans.json')), 'old auxiliary Kintsugi plan symlink should remain removed');
assert(!existsSync(resolve(ROOT, 'scripts/brochure-cron-loop.sh')), 'hidden cron loop helper should remain removed; use npm run repair:loop explicitly');
for (const legacyPath of REMOVED_LEGACY_PATHS) {
  assert(!existsSync(resolve(ROOT, legacyPath)), `${legacyPath} should remain removed from the paired compiler foundation`);
}

const appPageSource = readFileSync(APP_PAGE_PATH, 'utf8');
const dataModuleSource = readFileSync(DATA_MODULE_PATH, 'utf8');
const typesSource = readFileSync(TYPES_PATH, 'utf8');
const buildValidatorSource = readFileSync(BUILD_VALIDATOR_PATH, 'utf8');
const renderThemesSource = readFileSync(RENDER_THEMES_PATH, 'utf8');
const sceneSource = readFileSync(SCENE_PATH, 'utf8');
const homeModelSource = readFileSync(HOME_MODEL_PATH, 'utf8');
const brochureQaSource = readFileSync(BROCHURE_QA_PATH, 'utf8');
const applyRepairPatchSource = readFileSync(APPLY_REPAIR_PATCH_PATH, 'utf8');
const requestRepairPatchSource = readFileSync(REQUEST_REPAIR_PATCH_PATH, 'utf8');
const runRepairLoopSource = readFileSync(RUN_REPAIR_LOOP_PATH, 'utf8');
const ingestRepairResponseSource = readFileSync(INGEST_REPAIR_RESPONSE_PATH, 'utf8');
const repairDoctorSource = readFileSync(REPAIR_DOCTOR_PATH, 'utf8');
const draftedProductAuditSource = readFileSync(DRAFTED_PRODUCT_AUDIT_PATH, 'utf8');
const printRepairPromptSource = readFileSync(PRINT_REPAIR_PROMPT_PATH, 'utf8');
const printRepairQueueSource = readFileSync(PRINT_REPAIR_QUEUE_PATH, 'utf8');
const bimPreviewSource = readFileSync(resolve(ROOT, 'components/bim/BimPreview.tsx'), 'utf8');
const componentRegistrySource = readFileSync(resolve(ROOT, 'lib/bim/component-registry.ts'), 'utf8');
const componentAssetsSource = readFileSync(resolve(ROOT, 'lib/bim/component-assets.ts'), 'utf8');
const semanticBimSource = readFileSync(resolve(ROOT, 'lib/bim/semantic-bim.ts'), 'utf8');
const buildableBimSource = readFileSync(resolve(ROOT, 'lib/bim/buildable-bim.ts'), 'utf8');
const library = readJson(LIBRARY_PATH);
const componentData = readJson(COMPONENTS_PATH);
const coverageData = readJson(COVERAGE_PATH);
const envExampleSource = readFileSync(ENV_EXAMPLE_PATH, 'utf8');
assert(!appPageSource.includes('Den Outdoors'), 'homepage should not show the old brand label');
assert(envExampleSource.includes('OPENAI_API_KEY=') && envExampleSource.includes('OPENAI_REPAIR_MODEL='), '.env.example should document the optional local GPT repair credentials without values');
assert(!appPageSource.includes('href={`/den-seeds'), 'homepage should not link back to the old separate paired harness');
assert(!dataModuleSource.includes('/data/den-seeds'), 'data module should not load the old Den seed side channel');
assert(!dataModuleSource.includes('spatial-manifest'), 'data module should not load the old SpatialIR plan manifest');
assert(!dataModuleSource.includes('kintsugi-plans'), 'data module should not load the old auxiliary plan set');
assert(!dataModuleSource.includes('lib.homes.map'), 'data module should not seed selectable plans from library.json homes');
assert(appPageSource.includes("'presentation3d'") && appPageSource.includes("'debugReview'"), 'homepage should route explicit product/debug render modes');
assert(appPageSource.includes('ProductWorkflowPanel'), 'homepage should expose prompt-to-plan workflow panel');
assert(appPageSource.includes('WorkflowActionBar') && appPageSource.includes('WorkflowModal'), 'homepage should expose product workflow actions and dialogs');
assert(appPageSource.includes('New Plan') && appPageSource.includes('Import JSON') && appPageSource.includes('Repair With GPT'), 'workflow should expose first-class new/import/repair actions');
assert(appPageSource.includes('Import Draft') && appPageSource.includes('Export Packet'), 'workflow panel should support local paired import and product packet export');
assert(appPageSource.includes('Export Semantic JSON') && appPageSource.includes('Export 2D SVG') && appPageSource.includes('Export HTML Brochure'), 'workflow should expose product export formats');
assert(appPageSource.includes('Generate Feedback Prompt'), 'workflow panel should generate repair feedback prompts for blocked artifacts');
assert(appPageSource.includes('validationGroups'), 'workflow should group validation blockers by product concern');
assert(appPageSource.includes("{ id: 'build'") && appPageSource.includes('Modular build validation'), 'workflow should expose modular build validation as a first-class gate');
assert(!appPageSource.includes('<EditorPanel'), 'manual semantic editor should not be mounted in the product approval workflow');
assert(appPageSource.includes('pairedArtifactToLocalHome'), 'workflow import should convert paired GPT JSON into local semantic plan state');
assert(dataModuleSource.includes("import { validateBuildability }") && dataModuleSource.includes('home.buildValidation = buildValidation'), 'paired JSON conversion should run modular build validation');
assert(dataModuleSource.includes('home.componentsUsed = buildValidation.componentsUsed'), 'paired JSON conversion should fill componentsUsed from generated BOM');
assert(dataModuleSource.includes('loadComponentCatalog') && dataModuleSource.includes('/data/components.json'), 'data refresh should load the modular component catalog');
assert(!dataModuleSource.includes('usesImagePixelCoordinates') && !dataModuleSource.includes('buildingPixelBounds') && !dataModuleSource.includes('panelPixelBounds'), 'data conversion should not retain pixel-coordinate fallback paths');
assert(!dataModuleSource.includes('pairedGeometryAudit:'), 'paired conversion should not persist pairedGeometryAudit on DenHome');
assert(!typesSource.includes('abstractLens') && !typesSource.includes('abstractLenses') && !typesSource.includes('dualLoop'), 'DenHome/types should not retain abstract lens or dual-loop research fields');
assert(!dataModuleSource.includes('abstractLens') && !dataModuleSource.includes('abstractLenses') && !dataModuleSource.includes('dualLoop'), 'paired data conversion should not carry abstract lens or dual-loop research artifacts');
assert(!appPageSource.includes('ProductPerspectiveView') && !appPageSource.includes('data-perspective-transform'), 'product 3D should not use the old CSS perspective fallback');
assert(buildValidatorSource.includes('PANEL_WIDTH_FT = 1.2 * FT_PER_M'), 'build validator should use 1.2m panel module');
assert(buildValidatorSource.includes('WALL_HEIGHT_SKUS_FT') && buildValidatorSource.includes('2.4 * FT_PER_M') && buildValidatorSource.includes('3.0 * FT_PER_M'), 'build validator should enforce 2.4m/3.0m wall height SKUs');
assert(buildValidatorSource.includes('MAX_JOIST_SPAN_FT') && buildValidatorSource.includes('ROOF_PITCH_SKUS_DEG'), 'build validator should cover floor span and roof pitch constraints');
assert(buildValidatorSource.includes('fitsOnePanel') && buildValidatorSource.includes('alignsToJoints'), 'build validator should check opening fit/joint alignment');
assert(buildValidatorSource.includes('bom') && buildValidatorSource.includes('componentsUsed'), 'build validator should output BOM and componentsUsed');
assert(appPageSource.includes("useState<ViewPreset>('presentation-3d')"), 'product should default to the rotatable 3D presentation view');
assert(appPageSource.includes('const [roofVisible, setRoofVisible] = useState(true)'), 'product 3D should default to a roofed model, not a blank review floor');
assert(appPageSource.includes('const [roomLabelsVisible, setRoomLabelsVisible] = useState(false)'), 'product 3D should default to clean model presentation without room label overlays');
assert(appPageSource.includes("preset === 'presentation-3d'") && appPageSource.includes('setRoofVisible(true)'), '3D preset should restore the roofed product model');
assert(appPageSource.includes('<BimPreview') && appPageSource.includes('buildableBimFromHome'), 'product canvas should mount the BIM product view from buildable_bim_v1');
assert(bimPreviewSource.includes('if (!fallback) continue'), 'cached glTF assets must only attach when their semantic fallback is rendered in the active view');
assert(bimPreviewSource.includes('scale > 16') && bimPreviewSource.includes('fittedSize.x > targetW * 1.18'), 'cached glTF assets must be rejected when scale normalization cannot preserve semantic bounds');
assert(typesSource.includes('parts?: Array') && semanticBimSource.includes('fixtureParts(fixture') && bimPreviewSource.includes('compoundFixtureId'), 'compound fixtures should preserve semantic parts for BIM rendering instead of one oversized bounds object');
assert(componentAssetsSource.includes('approvedForBrochure === true'), 'marketplace visual assets must be explicitly approved before product/brochure rendering uses them');
assert(componentRegistrySource.includes('BIM_COMPONENT_CATALOG') && componentRegistrySource.includes('hostConstraints') && componentRegistrySource.includes('clearanceRules'), 'BIM component registry should define host constraints and clearance rules');
assert(componentRegistrySource.includes('proceduralFallback') && componentRegistrySource.includes('twoDSymbol') && componentRegistrySource.includes('marketplaceAssets'), 'BIM component registry should define fallback 3D, 2D symbols, and marketplace assets');
assert(componentRegistrySource.includes('fixture.toilet') && componentRegistrySource.includes('opening.door.swing') && componentRegistrySource.includes('opening.window.fixed') && componentRegistrySource.includes('roof.aframe-plane'), 'BIM component registry should cover fixtures, doors, windows, and roof parts');
assert(semanticBimSource.includes('component?: BimComponentDefinition') && semanticBimSource.includes('resolveBimComponent'), 'semantic BIM elements should carry resolved standard component definitions');
assert(buildableBimSource.includes('component IFC class does not match element IFC class') && buildableBimSource.includes('component is missing marketplace asset metadata'), 'buildable BIM validation should enforce component resolver metadata');
assert(appPageSource.includes("viewPreset === 'debug-review'") && appPageSource.includes('<Scene'), 'legacy Three scene should be available only through the debug-review preset');
assert(appPageSource.includes('SemanticElevationView'), 'front/side product views should keep SVG semantic elevation presentations');
assert(appPageSource.includes("useState<ViewPreset>('presentation-3d')") && appPageSource.includes('BIM 3D'), 'product should default to BIM 3D presentation');
assert(appPageSource.includes('ProductGallery') && appPageSource.includes('Prompt-to-plan studio') && appPageSource.includes('Browse Plans'), 'app should expose a product gallery landing page before the harness-style detail view');
assert(appPageSource.includes('All bed/bath') && appPageSource.includes('All baths') && appPageSource.includes('All square feet') && appPageSource.includes('All levels') && appPageSource.includes('All roof types') && appPageSource.includes('All statuses'), 'product gallery should support bed, bath, square footage, levels, roof, and validation status filters');
assert(appPageSource.includes('FeedCard') && appPageSource.includes('data-feed-card') && appPageSource.includes('Concept render') && appPageSource.includes('dimensioned source of truth'), 'home page should render plans as social feed cards — a concept render above the dimensioned floor-plan sheet');
assert(appPageSource.includes('onRepairPlan') && appPageSource.includes('data-feed-open') && appPageSource.includes('data-delete-plan'), 'feed cards should keep the open / repair / delete actions');
assert(appPageSource.includes('data-feed-concept-label') && appPageSource.includes('data-feed-render-placeholder') && appPageSource.includes('Concept render pending'), 'feed cards should label the render and show a pending placeholder when a render is missing (never a broken image)');
assert(appPageSource.includes('Local repair commands') && appPageSource.includes('repair:gpt') && appPageSource.includes('repair:evaluate') && appPageSource.includes('--zip'), 'repair modal should expose the local GPT/evaluate command loop with uploadable zip bundle generation');
assert(appPageSource.includes('Full semantic-layer bundle set') && appPageSource.includes('repair-bundles-all') && appPageSource.includes('--all'), 'repair modal should expose the full semantic-layer GPT repair queue, not only the first blocked layer');
assert(appPageSource.includes('repair:ingest') && appPageSource.includes('--response response.txt'), 'repair modal should expose the manual ChatGPT response ingest path before patch application');
assert(appPageSource.includes('reviewToolsVisible') && appPageSource.includes('Review Tools'), 'detail page should hide harness/review rails by default behind an explicit Review Tools control');
assert(brochureQaSource.includes('VIEW_BUTTONS') && brochureQaSource.includes('BIM 3D') && brochureQaSource.includes('Cutaway') && brochureQaSource.includes('Plan Top'), 'brochure QA should capture product 3D, cutaway, and plan-top screenshots');
assert(brochureQaSource.includes('product-gallery') && brochureQaSource.includes('gallery: no product plan cards rendered'), 'brochure QA should capture and validate the product gallery landing page');
assert(brochureQaSource.includes('gallery: elevation preview missing') && brochureQaSource.includes('gallery: quality lane chips missing'), 'brochure QA should fail if gallery cards lose elevation previews or quality lane chips');
assert(brochureQaSource.includes('new-plan-handoff-modal') && brochureQaSource.includes('GENERATED GPT PROMPT PREVIEW'), 'brochure QA should click New Plan Handoff and verify the GPT prompt handoff modal opens');
assert(brochureQaSource.includes('hasRepairPromptAction') && brochureQaSource.includes('Repair Prompt action'), 'brochure QA should fail if blocked gallery cards lose the repair prompt action');
assert(brochureQaSource.includes('hasNextRepair') && brochureQaSource.includes('next repair target'), 'brochure QA should fail if blocked gallery cards stop showing the next repair target');
assert(brochureQaSource.includes('repair-prompt-modal') && brochureQaSource.includes('hasJsonPatchInstruction'), 'brochure QA should click a gallery Repair Prompt action and verify the scoped JSON Patch workflow opens');
assert(brochureQaSource.includes('REVIEW_TABS') && brochureQaSource.includes('Compare') && brochureQaSource.includes('Overlay') && brochureQaSource.includes('Semantic'), 'brochure QA should capture Compare, Overlay, and Semantic review screenshots');
assert(brochureQaSource.includes("waitForEvent('download'") && brochureQaSource.includes('paired_floorplan_product_packet') && brochureQaSource.includes('brochureHtml'), 'brochure QA should click Export and verify product packet contents');
assert(brochureQaSource.includes('summary.md') && brochureQaSource.includes('Brochure QA Summary') && brochureQaSource.includes('Next Commands'), 'brochure QA should write a human-readable summary with blockers, repair packets, and next commands');
assert(brochureQaSource.includes('firstBlockedRepair') && brochureQaSource.includes('nextRepairLayer') && brochureQaSource.includes('repair:gpt'), 'brochure QA summary next commands should use the current blocked repair layer and optional local GPT handoff');
assert(brochureQaSource.includes('app reports Brochure Quality blocked'), 'brochure QA should fail while the app itself reports brochure blockers');
assert(brochureQaSource.includes('app reports Design Quality blocked') && brochureQaSource.includes('app reports Presentation Quality blocked'), 'brochure QA should surface design and presentation blockers separately');
assert(brochureQaSource.includes('hasDebugLeakText') && brochureQaSource.includes('debug text is visible'), 'brochure QA should flag debug leakage in product screenshots');
assert(brochureQaSource.includes('hasHarnessRailLeak') && brochureQaSource.includes('harness review rail is visible'), 'brochure QA should fail if the old review rail leaks into default product detail');
assert(brochureQaSource.includes('writeRepairPackets') && brochureQaSource.includes('brochure_repair_packet_v1'), 'brochure QA should emit per-plan GPT repair packets from screenshot evidence');
assert(brochureQaSource.includes('packetSummaries.push({ planId, proposalId: paths.option.id'), 'brochure QA repair packet summaries should preserve proposal ids for bundle next commands');
assert(brochureQaSource.includes('recommendedSequence') && brochureQaSource.includes('Return RFC 6902 JSON Patch only'), 'brochure repair packets should include scoped layer order and JSON Patch prompts');
assert(brochureQaSource.includes('Required visual attachments') && brochureQaSource.includes('Treat local paths below as identifiers only'), 'brochure repair prompts should instruct GPT/users to attach source, render, compare, and overlay images');
assert(brochureQaSource.includes('REPAIR_LAYER_PATHS') && brochureQaSource.includes('blockedPatchPaths'), 'brochure repair prompts should carry allowed/blocked patch path constraints');
assert(brochureQaSource.includes('JSON Patch path index for this layer') && brochureQaSource.includes('patchPathIndex'), 'brochure repair prompts should include exact JSON pointer indexes for selected-layer patch operations');
assert(applyRepairPatchSource.includes('brochure_repair_packet_v1') && applyRepairPatchSource.includes('visualDriftStale'), 'repair patch CLI should apply scoped packet patches and mark visual drift stale');
assert(applyRepairPatchSource.includes('validateScope') && applyRepairPatchSource.includes('backupPath'), 'repair patch CLI should validate patch scope and create a backup before writing paired JSON');
assert(applyRepairPatchSource.includes('--bundle <dir>') && applyRepairPatchSource.includes('upload-manifest.json'), 'repair patch CLI should accept upload bundle folders without requiring users to retype packet/layer paths');
assert(requestRepairPatchSource.includes('OPENAI_API_KEY') && requestRepairPatchSource.includes('upload-manifest.json'), 'local GPT repair CLI should use bundle manifests and require an OpenAI API key outside browser code');
assert(requestRepairPatchSource.includes('input_image') && requestRepairPatchSource.includes('image_url') && requestRepairPatchSource.includes('deterministic render SVG'), 'local GPT repair CLI should attach visual evidence and include deterministic SVG context');
assert(requestRepairPatchSource.includes('repair:apply') && requestRepairPatchSource.includes('--dry-run'), 'local GPT repair CLI should validate returned patch scope before users apply it');
assert(runRepairLoopSource.includes('qa:brochure') && runRepairLoopSource.includes('repair:queue') && runRepairLoopSource.includes('repair:gpt') && runRepairLoopSource.includes('repair:apply'), 'repair loop CLI should orchestrate QA, bundle generation, GPT patch request, scoped apply, and rollback-on-worse evaluation');
assert(runRepairLoopSource.includes('rolled back') && runRepairLoopSource.includes('blockerCount') && runRepairLoopSource.includes('driftScore') && applyRepairPatchSource.includes('--result <path>'), 'repair loop should use apply result manifests and roll back patches that fail to improve blocker count or visual drift');
assert(runRepairLoopSource.includes('OPENAI_API_KEY') && runRepairLoopSource.includes('Without --yes'), 'repair loop CLI should stay explicit and avoid hidden background/cron behavior');
assert(ingestRepairResponseSource.includes('extractJsonPatch') && ingestRepairResponseSource.includes('repair:apply') && ingestRepairResponseSource.includes('--dry-run'), 'repair ingest CLI should extract copied ChatGPT JSON Patch responses and dry-run validate scope');
assert(ingestRepairResponseSource.includes('--latest-download') && ingestRepairResponseSource.includes('latestDownloadResponse'), 'repair ingest CLI should find the newest likely ChatGPT patch in Downloads when requested');
assert(repairDoctorSource.includes('OPENAI_API_KEY') && repairDoctorSource.includes('repairSession') && repairDoctorSource.includes('nextCommands') && repairDoctorSource.includes('--latest-download'), 'repair doctor should report API/model/session readiness and the next patch commands');
assert(draftedProductAuditSource.includes('drafted_product_goal_audit_v1') && draftedProductAuditSource.includes('At least one target plan is true brochure-ready') && draftedProductAuditSource.includes('targetPasses'), 'goal audit CLI should map Drafted-style product requirements to concrete QA evidence');
assert(draftedProductAuditSource.includes('repairCoverage') && draftedProductAuditSource.includes('repair-bundles-all') && draftedProductAuditSource.includes('roof-elevation'), 'goal audit should verify full per-layer repair bundle coverage before calling blocked plans actionable');
assert(printRepairPromptSource.includes('packet.prompts') && printRepairPromptSource.includes('--layer'), 'repair prompt CLI should extract one scoped GPT prompt by layer');
assert(printRepairQueueSource.includes('report.repairPackets') && printRepairQueueSource.includes('--all') && printRepairQueueSource.includes('--out') && printRepairQueueSource.includes('--print'), 'repair queue CLI should aggregate next GPT prompts from latest brochure QA packets without forcing noisy stdout');
assert(printRepairQueueSource.includes('--bundle-dir') && printRepairQueueSource.includes('upload-manifest.json') && printRepairQueueSource.includes('review-overlay'), 'repair queue CLI should create uploadable GPT repair bundles with prompt, source/render, compare, overlay, and product screenshots');
assert(printRepairQueueSource.includes('GPT Repair Bundles') && printRepairQueueSource.includes('applyCommand'), 'repair queue bundles should include a README index and exact apply command for returned JSON Patch files');
assert(printRepairQueueSource.includes('--zip') && printRepairQueueSource.includes('Upload one bundle zip at a time to GPT'), 'repair queue CLI should optionally create zip files for ChatGPT upload handoff');
assert(printRepairQueueSource.includes('README_FOR_GPT.md') && printRepairQueueSource.includes('patch.schema.json') && printRepairQueueSource.includes('Return exactly one file named `patch.json`'), 'repair queue bundles should include GPT-facing instructions and a JSON Patch schema');
assert(printRepairQueueSource.includes('Repair Session:') && printRepairQueueSource.includes('Plan Repair Sessions') && printRepairQueueSource.includes('repair:ingest'), 'repair queue should write per-plan repair-session checklists with manual ingest/apply commands');
assert(!appPageSource.includes("{ id: 'proposal', label: 'GPT Proposal'") && !appPageSource.includes("{ id: 'render', label: 'Render'") && !appPageSource.includes("{ id: 'bim', label: 'BIM Preview'"), 'bottom review panel should not expose duplicate proposal/render/BIM tabs');
assert(appPageSource.includes("{ id: 'compare', label: 'Compare'") && appPageSource.includes("{ id: 'overlay', label: 'Overlay'") && appPageSource.includes("{ id: 'semantic', label: 'Semantic'"), 'bottom review panel should keep only Compare, Overlay, and Semantic tabs');
assert(renderThemesSource.includes("'product-presentation'") && !renderThemesSource.includes("'paired-review'") && !renderThemesSource.includes("'white-aframe-cutaway'"), 'render themes should be collapsed to the single product-presentation theme');
assert(sceneSource.includes("renderMode === 'debugReview' && renderTheme.showGrid"), 'scene grid must be debug-only');
assert(sceneSource.includes("renderMode === 'debugReview' && (") && sceneSource.includes('Debug review keeps a large ground plane'), 'large 3D ground plane must be debug-only');
assert(homeModelSource.includes('labelsVisible={roomLabelsVisible}'), 'room label toggle must not suppress presentation floor/fixture geometry');
assert(homeModelSource.includes("renderMode !== 'debugReview'") && homeModelSource.includes('ElevationOutlineGuides'), 'elevation guide helpers must be blocked outside debugReview');
assert(homeModelSource.includes('depthWrite={false}'), 'presentation roof shell must not depth-occlude the interior model');
assert(homeModelSource.includes('showCleanRoofFrame'), 'product roof view should expose clean roof/ridge edges without debug guide geometry');
assert(Array.isArray(library.homes) && library.homes.length === 0, 'library.json should not retain old selectable homes');
assert(Object.keys(library.coverage ?? {}).length === 0, 'library.json should not retain old home coverage');
assert(Object.keys(coverageData ?? {}).length === 0, 'coverage.json should not retain old home coverage');
assert(
  (library.components ?? []).every((component) => (component.usedInHomes ?? []).length === 0)
    && (componentData ?? []).every((component) => (component.usedInHomes ?? []).length === 0),
  'component metadata should not retain old home ids',
);

const manifest = readJson(PROPOSAL_MANIFEST_PATH);
const queue = readJson(PAIRED_QUEUE_PATH);
const ids = planDirs();

assert(manifest.artifactVersion === 'proposal_manifest_v2', `unexpected manifest version: ${manifest.artifactVersion}`);
assert(manifest.summary?.planCount === ids.length, `manifest plan count ${manifest.summary?.planCount} does not match ${ids.length}`);

const allOptions = Object.entries(manifest.plans ?? {}).flatMap(([planId, options]) => (
  (options ?? []).map((option) => ({ planId, ...option }))
));

function pairedNumber(id) {
  const match = /^proposal-paired-v(\d+)$/.exec(String(id ?? ''));
  return match ? Number(match[1]) : 0;
}

function expectedNextProposalId(planId) {
  const latest = Math.max(0, ...(manifest.plans?.[planId] ?? []).map((option) => pairedNumber(option.id)));
  return `proposal-paired-v${latest + 1}`;
}

for (const option of allOptions) {
  assert(/^proposal-paired-v\d+$/.test(option.id), `${option.planId} has non-paired proposal in manifest: ${option.id}`);
  assert(option.pairedArtifact === true, `${option.planId} ${option.id} is missing pairedArtifact=true`);
  assert(option.artifactVersion === 'paired_gpt_floorplan_v1', `${option.planId} ${option.id} uses ${option.artifactVersion}`);
  assert(Boolean(option.pairedJsonUrl), `${option.planId} ${option.id} missing paired JSON URL`);
  assert(Boolean(option.pairedValidationUrl), `${option.planId} ${option.id} missing validation URL`);
  const validation = readJson(resolve(LOOP_ROOT, option.planId, option.pairedValidationUrl));
  if (validation?.passed === true) {
    assert(Boolean(option.deterministicRenderUrl), `${option.planId} ${option.id} missing deterministic render URL`);
  } else {
    assert(option.archived === true, `${option.planId} ${option.id} failed validation but is not archived`);
    assert((option.blockers ?? []).length > 0, `${option.planId} ${option.id} failed validation without blockers`);
  }
  assert(option.parserReady !== true, `${option.planId} ${option.id} reintroduced legacy parser-ready state`);
  assert(option.promotionReady !== true, `${option.planId} ${option.id} reintroduced legacy promotion-ready state`);
}

const promotedOptions = allOptions.filter((option) => option.promotionEligible);
assert(
  promotedOptions.length === (manifest.summary?.pairedPromotionEligible ?? 0),
  'manifest pairedPromotionEligible summary does not match options',
);
for (const option of promotedOptions) {
  assert(option.gptSourceReady !== false, `${option.planId} ${option.id} is promoted without GPT source readiness`);
  assert(option.pairedValidationReady === true, `${option.planId} ${option.id} promoted without paired validation`);
  assert(option.pairedVisualDriftReady === true, `${option.planId} ${option.id} promoted without visual drift audit`);
  assert(option.pairedVisualReviewReady === true, `${option.planId} ${option.id} promoted without visual review`);
  assert(option.archived !== true, `${option.planId} ${option.id} promoted while archived`);
  if (option.pairedVisualDriftUrl) {
    const drift = readJson(resolve(LOOP_ROOT, option.planId, option.pairedVisualDriftUrl));
    assert(drift.passed === true, `${option.planId} ${option.id} promoted while visual drift is failing`);
    assertPromotedPrimitiveDriftFloor(option, drift);
  }
}

const targetBaseline = manifest.plans?.[TARGET_PROMOTED_PLAN]?.find((option) => option.id === TARGET_PROMOTED_PROPOSAL);
assert(targetBaseline, `${TARGET_PROMOTED_PLAN} missing ${TARGET_PROMOTED_PROPOSAL}`);
if (targetBaseline.promotionEligible === true) {
  assert(targetBaseline.pairedReviewStatus === 'passed', `${TARGET_PROMOTED_PLAN} ${TARGET_PROMOTED_PROPOSAL} should expose passed review status when promoted`);
  assert((targetBaseline.blockers ?? []).length === 0, `${TARGET_PROMOTED_PLAN} ${TARGET_PROMOTED_PROPOSAL} should not expose blockers when promoted`);
} else {
  assert(targetBaseline.pairedReviewStatus === 'blocked', `${TARGET_PROMOTED_PLAN} ${TARGET_PROMOTED_PROPOSAL} should expose blocked review status while visual drift fails`);
  assert((targetBaseline.blockers ?? []).some((line) => /drift|primitive|visual/i.test(line)), `${TARGET_PROMOTED_PLAN} ${TARGET_PROMOTED_PROPOSAL} should expose visual drift blockers before promotion`);
}

const outpost = manifest.plans?.[TARGET_REVIEW_PLAN]?.find((option) => option.id === TARGET_REVIEW_PROPOSAL);
assert(outpost, `${TARGET_REVIEW_PLAN} missing ${TARGET_REVIEW_PROPOSAL}`);
assert(outpost.promotionEligible !== true, `${TARGET_REVIEW_PLAN} ${TARGET_REVIEW_PROPOSAL} must not be promoted after visual review failed`);
assert(outpost.pairedReviewStatus === 'blocked', `${TARGET_REVIEW_PLAN} ${TARGET_REVIEW_PROPOSAL} should expose blocked review status`);
assert(outpost.archived === true, `${TARGET_REVIEW_PLAN} ${TARGET_REVIEW_PROPOSAL} should be archived/debug-only`);
assert((outpost.blockers ?? []).some((line) => line.includes('below brochure quality')), `${TARGET_REVIEW_PLAN} should expose source-quality blockers`);

const blocked = manifest.plans?.[TARGET_BLOCKED_PLAN]?.find((option) => option.id === TARGET_BLOCKED_PROPOSAL);
assert(blocked, `${TARGET_BLOCKED_PLAN} missing ${TARGET_BLOCKED_PROPOSAL}`);
assert(blocked.promotionEligible !== true, `${TARGET_BLOCKED_PLAN} ${TARGET_BLOCKED_PROPOSAL} must remain blocked`);
assert(blocked.archived === true, `${TARGET_BLOCKED_PLAN} ${TARGET_BLOCKED_PROPOSAL} should be archived/debug-only`);
assert((blocked.blockers ?? []).length > 0, `${TARGET_BLOCKED_PLAN} ${TARGET_BLOCKED_PROPOSAL} should expose blockers`);

const primitivePromoted = manifest.plans?.[TARGET_PRIMITIVE_PROMOTED_PLAN]?.find((option) => option.id === TARGET_PRIMITIVE_PROMOTED_PROPOSAL);
assert(primitivePromoted, `${TARGET_PRIMITIVE_PROMOTED_PLAN} missing ${TARGET_PRIMITIVE_PROMOTED_PROPOSAL}`);
assert(Boolean(primitivePromoted.pairedVisualDriftUrl), `${TARGET_PRIMITIVE_PROMOTED_PLAN} ${TARGET_PRIMITIVE_PROMOTED_PROPOSAL} missing visual drift evidence`);
const primitivePromotedDrift = readJson(resolve(LOOP_ROOT, TARGET_PRIMITIVE_PROMOTED_PLAN, primitivePromoted.pairedVisualDriftUrl));
assert(primitivePromotedDrift.passed === true, `${TARGET_PRIMITIVE_PROMOTED_PLAN} ${TARGET_PRIMITIVE_PROMOTED_PROPOSAL} must only be promoted after primitive drift passes`);
assert(primitivePromoted.promotionEligible === true, `${TARGET_PRIMITIVE_PROMOTED_PLAN} ${TARGET_PRIMITIVE_PROMOTED_PROPOSAL} should be promotion eligible after primitive drift passes`);
assert(primitivePromoted.pairedReviewStatus === 'passed', `${TARGET_PRIMITIVE_PROMOTED_PLAN} ${TARGET_PRIMITIVE_PROMOTED_PROPOSAL} should expose passed review status`);

const queuedPlans = new Set((queue.queue ?? []).map((item) => item.planId));
assert(queue.artifactVersion === 'paired_generation_queue_v1', `unexpected queue version: ${queue.artifactVersion}`);
assert(queue.promotedPairedPlans === promotedOptions.length, 'queue promoted count does not match manifest');
assert(queue.queuedPlans === (queue.queue ?? []).length, `queue summary should match queued handoff entries, got ${queue.queuedPlans}`);
if (targetBaseline.promotionEligible === true) {
  assert(!queuedPlans.has(TARGET_PROMOTED_PLAN), `${TARGET_PROMOTED_PLAN} should not remain queued after promotion`);
} else {
  assert(targetBaseline.pairedReviewStatus === 'blocked', `${TARGET_PROMOTED_PLAN} should stay blocked until a repair or replacement passes visual drift`);
}
assert(queuedPlans.has(TARGET_BLOCKED_PLAN), `${TARGET_BLOCKED_PLAN} should be queued for repair`);
const blockedQueue = (queue.queue ?? []).find((item) => item.planId === TARGET_BLOCKED_PLAN);
assert(blockedQueue?.proposalId === expectedNextProposalId(TARGET_BLOCKED_PLAN), `${TARGET_BLOCKED_PLAN} should advance to ${expectedNextProposalId(TARGET_BLOCKED_PLAN)}`);
assert(Boolean(blockedQueue?.repairPrompt), `${TARGET_BLOCKED_PLAN} should expose a repair prompt`);
assert(appPageSource.includes('Queue Progress'), 'homepage should expose paired generation queue progress');
assert(appPageSource.includes('not generated'), 'homepage should distinguish queued handoffs from generated artifacts');

const roofIncompletePromotions = [];
const roofCompletePromotions = [];
for (const option of promotedOptions) {
  const artifact = readJson(resolve(LOOP_ROOT, option.planId, option.pairedJsonUrl));
  const hasRoof =
    artifact.roof &&
    typeof artifact.roof === 'object' &&
    Array.isArray(artifact.roof.planes) &&
    artifact.roof.planes.length > 0;
  const hasElevations = Array.isArray(artifact.elevations) && artifact.elevations.length >= 2;
  const key = `${option.planId}/${option.id}`;
  if (!hasRoof || !hasElevations) {
    roofIncompletePromotions.push(key);
  } else {
    roofCompletePromotions.push(key);
    assert(option.pairedRoofElevationReady === true, `${key} has roof/elevation JSON but manifest is not ready`);
    assert(Boolean(option.pairedRoofElevationUrl), `${key} missing roof/elevation artifact URL`);
    assert(Boolean(option.pairedRoofElevationValidationUrl), `${key} missing roof/elevation validation URL`);
    const roofValidation = readJson(resolve(LOOP_ROOT, option.planId, option.pairedRoofElevationValidationUrl));
    assert(roofValidation.passed === true, `${key} roof/elevation validation did not pass`);
  }
}
assert(
  promotedOptions.length === 0 || roofCompletePromotions.includes(`${TARGET_ROOF_PLAN}/${TARGET_ROOF_PROPOSAL}`),
  `${TARGET_ROOF_PLAN}/${TARGET_ROOF_PROPOSAL} should have validated paired roof/elevation semantics when a target plan is promoted`,
);
assert(
  roofIncompletePromotions.length === 0,
  `promoted paired plans must have explicit roof/elevation JSON: ${roofIncompletePromotions.join(', ')}`,
);
assert(
  appPageSource.includes('roof is provisional') || appPageSource.includes('Roof semantics'),
  'homepage should disclose when paired roof/elevation semantics are missing',
);
if (roofIncompletePromotions.length > 0) {
  console.warn(`paired:smoke roof/elevation gap - ${roofIncompletePromotions.join(', ')} are floorplan-promoted but roof-provisional`);
}

const legacyDirs = ids.flatMap((planId) => (
  ['parsed', 'vision-candidates', 'feedback']
    .map((name) => resolve(LOOP_ROOT, planId, name))
    .filter((path) => existsSync(path))
));
assert(legacyDirs.length === 0, `legacy artifact directories remain: ${legacyDirs.slice(0, 5).join(', ')}`);

console.log(
  `paired:smoke ok - paired ${promotedOptions.length}/${ids.length} promoted, `
    + `${queue.queuedPlans ?? 0} queued, manifest ${allOptions.length} paired option(s)`,
);
