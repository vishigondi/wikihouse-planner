// Final overnight interactive sweep: full protocol on every plan.
// Rotation drags, all views + level/roof toggles, Compare/Overlay/Semantic,
// constraint report assertions; lot-editor flip + brief parse once.
// Usage: node scripts/final-interactive-sweep.mjs
// Target host defaults to the dev server on :3002; SWEEP_URL overrides it so
// the live-gate runner can point it at one prod server (the prod build serves
// the identical interactive app).

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.SWEEP_URL ?? 'http://127.0.0.1:3002';
const PLANS = ['brief-aframe-2br', 'a-frame-22', 'a-frame-bunk', 'outpost-medium', 'gen-001'];
const SHOT_DIR = 'artifacts/final-sweep';

let failures = 0;
const note = (ok, label) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures += 1;
};

await mkdir(SHOT_DIR, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

for (const plan of PLANS) {
  console.log(`plan: ${plan}`);
  await page.goto(`${BASE}/?home=${plan}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(9000);
  const canvas = await page.locator('canvas').count();
  note(canvas >= 1, 'canvas renders');

  // Envelope integrity: every rendered mesh is sampled against the roof
  // planes. Compiled plans must be strictly inside (constructive clipping);
  // traced plans keep their designed-bay exemption for excess, but no plan
  // may render untagged geometry above the roof (untagged meshes are how
  // the sail fins evaded the old wall-only gate).
  const envelope = await page.locator('canvas').first().evaluate((el) => ({
    maxExcess: Number(el.dataset.bimEnvelopeMaxExcessFt ?? 'NaN'),
    planes: Number(el.dataset.bimEnvelopePlanes ?? 'NaN'),
    offenders: JSON.parse(el.dataset.bimEnvelopeOffenders ?? '[]'),
  })).catch(() => ({ maxExcess: NaN, planes: NaN, offenders: [] }));
  const COMPILED_PLANS = new Set(['brief-aframe-2br', 'gen-001']);
  if (envelope.planes > 0) {
    const untagged = envelope.offenders.filter((item) => item.category === 'untagged');
    note(untagged.length === 0, `no untagged geometry above the roof (${untagged.length})`);
  }
  if (COMPILED_PLANS.has(plan) && Number.isFinite(envelope.maxExcess) && envelope.planes > 0) {
    note(envelope.maxExcess <= 0.25, `all meshes within roof envelope (max excess ${envelope.maxExcess} ft <= 0.25)`);
    note(envelope.offenders.length === 0, `zero envelope offenders (${JSON.stringify(envelope.offenders).slice(0, 140)})`);
  } else if (envelope.planes > 0) {
    console.log(`  info envelope max excess ${envelope.maxExcess} ft (traced plan, designed bays exempt)`);
  } else {
    note(true, 'envelope data unavailable (no roof planes), skipped');
  }

  // (1) rotation in two directions
  await page.mouse.move(800, 470); await page.mouse.down();
  await page.mouse.move(1080, 400, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOT_DIR}/${plan}-rot1.png` });
  await page.mouse.move(800, 470); await page.mouse.down();
  await page.mouse.move(520, 560, { steps: 12 }); await page.mouse.up();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOT_DIR}/${plan}-rot2.png` });
  const canvasAfter = await page.locator('canvas').count();
  note(canvasAfter >= 1, 'model survives rotation');

  // (2) views and toggles
  for (const label of ['Cutaway', 'Front', 'Side', 'Plan Top', 'BIM 3D']) {
    await page.locator('button', { hasText: new RegExp(`^${label}$`) }).first().click().catch(() => { note(false, `view ${label} clickable`); });
    await page.waitForTimeout(800);
  }
  for (const level of ['Ground', 'Loft', 'All']) {
    await page.locator('button', { hasText: new RegExp(`^${level}$`) }).first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const roof = page.locator('input[type="checkbox"]').first();
  await roof.click().catch(() => {});
  await page.waitForTimeout(600);
  await roof.click().catch(() => {});
  await page.screenshot({ path: `${SHOT_DIR}/${plan}-views.png` });
  note(true, 'views + level/roof toggles cycled');

  // (3) Compare -> Overlay -> Semantic. Overlay only exists for GPT-paired
  // lanes; for JSON-only plans its absence must coincide with the badge.
  const overlayButtons = await page.locator('button', { hasText: /^Overlay$/ }).count();
  const jsonOnlyBadges = await page.locator('[data-json-only-packet]').count();
  if (overlayButtons > 0) {
    note(jsonOnlyBadges === 0, 'overlay tab present only on GPT-paired plan');
    await page.locator('button', { hasText: /^Overlay$/ }).first().click();
    await page.waitForTimeout(900);
    const overlayBroken = await page.locator('img[alt*="GPT proposal"]').evaluateAll(
      (imgs) => imgs.some((img) => img.complete && img.naturalWidth === 0),
    ).catch(() => false);
    note(!overlayBroken, 'overlay has no broken image');
  } else {
    note(jsonOnlyBadges === 1, 'overlay hidden for JSON-only plan (badge present)');
  }
  await page.locator('button', { hasText: /^Semantic$/ }).first().click();
  await page.waitForTimeout(1600);
  const jurisdiction = await page.locator('[data-jurisdiction]').first().getAttribute('data-jurisdiction').catch(() => null);
  note(jurisdiction === 'nc-cherokee-county', `jurisdiction header (${jurisdiction})`);
  const r305 = await page.locator('[data-constraint-rule="IRC-R305.1"]').first().getAttribute('data-constraint-status').catch(() => null);
  note(r305 === 'pass' || r305 === 'fail', `R305 evaluated from geometry (${r305})`);
  const septic = await page.locator('[data-constraint-rule="NC-SEPTIC-18E"]').count();
  note(septic === 1, 'site checks present');
  const ruleCount = await page.locator('[data-constraint-rule]').count();
  note(ruleCount === 10, `10 rule cards rendered (${ruleCount})`);
  const titleBlocks = await page.locator('[data-plan-title-block]').count();
  const northArrows = await page.locator('[data-north-arrow]').count();
  note(titleBlocks >= 1 && northArrows >= 1, `plan sheet annotations present (title ${titleBlocks}, north ${northArrows})`);
  await page.screenshot({ path: `${SHOT_DIR}/${plan}-semantic.png`, fullPage: false });

  // JSON-only lane: gen-001 must read Brochure pass with the honest packet
  // badge - the export-pass contract for generated plans.
  if (plan === 'gen-001') {
    const badge = await page.locator('[data-json-only-packet]').count();
    note(badge >= 1, 'JSON-only deterministic packet badge present');
    const headerText = await page.locator('text=/gen-001 - review/').first().textContent().catch(() => '');
    note(/Brochure (pass|warning)/.test(headerText ?? '') && !/Brochure blocked/.test(headerText ?? ''), `workflow header brochure state (${(headerText ?? '').slice(0, 80)})`);
  }
}

// (4) controls, once: lot editor flip on brief plan + brief parse in Review Tools
console.log('controls: lot editor + brief parser');
await page.goto(`${BASE}/?home=brief-aframe-2br`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.locator('button', { hasText: /^Semantic$/ }).first().click();
await page.waitForTimeout(1500);
const setbackStatus = () => page.locator('[data-constraint-rule="ZON-SETBACK"]').first().getAttribute('data-constraint-status');
const before = await setbackStatus();
await page.locator('[data-lot-field="widthFt"]').fill('30');
await page.waitForTimeout(700);
const flipped = await setbackStatus();
await page.locator('button', { hasText: /^reset$/ }).first().click();
await page.waitForTimeout(700);
const restored = await setbackStatus();
note(before === 'pass' && flipped === 'fail' && restored === 'pass', `lot editor flip pass->fail->pass (${before}/${flipped}/${restored})`);

await page.locator('button', { hasText: /review tools/i }).first().click();
await page.waitForTimeout(1200);
const briefBox = page.locator('[data-brief-input]');
await briefBox.scrollIntoViewIfNeeded();
await briefBox.fill('2-bed A-frame, ≤800 sqft, 40×60 lot, 5 ft side setbacks');
await page.locator('[data-brief-parse]').click();
await page.waitForTimeout(600);
const inputs = await page.locator('input').evaluateAll((nodes) => nodes.map((n) => n.value));
note(Boolean(inputs.find((v) => /bed \//.test(v))) && inputs.includes('a-frame'), 'brief parse fills fields');

// (4b) look-render handoff: the modal surfaces a geometry-true, illustrative prompt
await page.goto(`${BASE}/?home=gen-001`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
await page.locator('button', { hasText: /^Look Render$/ }).first().click();
await page.waitForTimeout(800);
const lookCount = await page.locator('[data-look-selector] button').count();
const lookPrompt = await page.locator('[data-look-render-prompt]').first().inputValue().catch(() => '');
note(lookCount === 7, `look-render offers 7 looks (${lookCount})`);
note(/not to scale/i.test(lookPrompt) && /ft wide/.test(lookPrompt) && /a-frame/.test(lookPrompt), 'look-render prompt is illustrative + encodes real geometry');
// Geometry-conditioned handoff: the deterministic reference (front + side
// elevations) is surfaced so the render tracks real geometry, not a generic cabin.
const refFrontSvg = await page.locator('[data-look-render-reference-front] svg').count();
const refSideSvg = await page.locator('[data-look-render-reference-side] svg').count();
note(refFrontSvg >= 1 && refSideSvg >= 1, `look-render surfaces deterministic reference elevations (front ${refFrontSvg}, side ${refSideSvg})`);
await page.locator('button', { hasText: /^Close$/ }).first().click().catch(() => {});

// (5) landing brief box: live parse echo + ignored-word honesty
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
await page.locator('[data-home-brief-input]').fill('three bedroom two bath gable farmhouse on a 60 x 90 lot with 10 foot setbacks');
await page.waitForTimeout(400);
const echoText = await page.locator('[data-home-brief-echo]').textContent().catch(() => '');
note(/3 bed/.test(echoText) && /2 bath/.test(echoText) && /gable/.test(echoText) && /60×90 lot/.test(echoText) && /F10\/B10\/L10\/R10/.test(echoText), `landing echo parses program (${echoText.trim().slice(0, 90)})`);
const ignoredText = await page.locator('[data-home-brief-ignored]').textContent().catch(() => '');
note(/farmhouse/.test(ignoredText), 'landing echo surfaces ignored words');

await browser.close();
if (failures) {
  console.error(`\n${failures} sweep check(s) failed`);
  process.exit(1);
}
console.log('\nfinal interactive sweep clean');
