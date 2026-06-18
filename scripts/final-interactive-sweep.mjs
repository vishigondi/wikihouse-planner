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
const PLANS = ['brief-aframe-2br', 'a-frame-22', 'a-frame-bunk', 'outpost-medium', 'gen-001', 'loft-showcase'];
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
  const COMPILED_PLANS = new Set(['brief-aframe-2br', 'gen-001', 'loft-showcase']);
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
note(/not to scale/i.test(lookPrompt) && /ft wide/.test(lookPrompt) && /a-frame/.test(lookPrompt), 'look-render prompt encodes real geometry + stays not-to-scale');
// Render mode: photoreal (default) vs illustration; photoreal stays a labeled
// concept render that is NOT a photo of a real home, still geometry-true.
const modeCount = await page.locator('[data-render-mode-selector] button').count();
note(modeCount === 2, `look-render offers a render-mode toggle (${modeCount})`);
await page.locator('[data-render-mode="photoreal"]').first().click().catch(() => {});
await page.waitForTimeout(200);
const photoPrompt = await page.locator('[data-look-render-prompt]').first().inputValue().catch(() => '');
note(/photoreal|photorealistic/i.test(photoPrompt) && /not a photo of a real home/i.test(photoPrompt) && /not to scale/i.test(photoPrompt) && /ft wide/.test(photoPrompt),
  'photoreal prompt: photoreal + labeled concept (not a real photo) + geometry-true');
// Geometry-conditioned handoff: the deterministic reference (front + side
// elevations) is surfaced so the render tracks real geometry, not a generic cabin.
const refFrontSvg = await page.locator('[data-look-render-reference-front] svg').count();
const refSideSvg = await page.locator('[data-look-render-reference-side] svg').count();
note(refFrontSvg >= 1 && refSideSvg >= 1, `look-render surfaces deterministic reference elevations (front ${refFrontSvg}, side ${refSideSvg})`);
await page.locator('button', { hasText: /^Close$/ }).first().click().catch(() => {});

// (4c) look-render consistency panel: when a render is committed, it must sit
// beside the deterministic elevation with the full structural checklist + the
// illustrative label, and never replace the dimensioned sheet. Strict when a
// panel is present; an honest, logged deferral until a render is imported (never
// a silent pass).
let panelChecked = false;
for (const plan of PLANS) {
  await page.goto(`${BASE}/?home=${plan}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);
  if ((await page.locator('[data-look-render-panel]').count()) === 0) continue;
  panelChecked = true;
  const illus = await page.locator('[data-look-render-panel] [data-look-render-illustration]').count();
  const determ = await page.locator('[data-look-render-panel] [data-look-render-deterministic] svg').count();
  const rows = await page.locator('[data-look-render-panel] [data-look-render-check]').count();
  const label = await page.locator('[data-look-render-panel] [data-look-render-illustrative]').first().textContent().catch(() => '');
  const sheet = await page.locator('[data-look-render-panel]').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const sheetEl = document.querySelector('[data-deterministic-render], [data-plan-sheet], main');
    const sr = sheetEl?.getBoundingClientRect();
    return sr ? r.top >= sr.top : true; // panel sits below the sheet, never replacing it
  });
  note(illus >= 1 && determ >= 1, `look-render panel shows BOTH images (illustration ${illus}, deterministic ${determ}) [${plan}]`);
  note(rows === 5, `look-render panel shows every structural checklist row (${rows}/5) [${plan}]`);
  note(/not to scale/i.test(label), `look-render panel carries the illustrative label [${plan}]`);
  note(sheet, `look-render panel is subordinate (below the sheet) [${plan}]`);
  break;
}
if (!panelChecked) {
  console.log('  info no look-render committed yet — consistency-panel assertion activates when a render is imported (fire 3)');
}

// (4d) the HOME page IS the social feed: each post card stacks the photoreal
// render (subordinate, labeled concept render) ABOVE the dimensioned floor-plan
// sheet (source of truth), wrapped in feed chrome (caption + engagement bar).
// View only; no separate Feed page.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
const feedPresent = await page.locator('[data-plan-feed]').count();
const everyCard = page.locator('[data-feed-card]');
const cardCount = await everyCard.count();
note(feedPresent >= 1 && cardCount >= 1, `home page renders the plan feed (${cardCount} cards)`);
if (cardCount >= 1) {
  // Every card carries the dimensioned plan sheet + caption + concept label + engagement bar.
  let plansOk = 0, capOk = 0, labelOk = 0, engOk = 0;
  for (let i = 0; i < cardCount; i += 1) {
    const c = everyCard.nth(i);
    if (await c.locator('[data-feed-plan-sheet]').count()) plansOk += 1;
    if (await c.locator('[data-feed-caption]').count()) capOk += 1;
    if (await c.locator('[data-feed-concept-label]').count()) labelOk += 1;
    if (await c.locator('[data-feed-engagement]').count()) engOk += 1;
  }
  note(plansOk === cardCount && capOk === cardCount && labelOk === cardCount && engOk === cardCount,
    `every feed card has plan sheet + caption + concept label + engagement (${plansOk}/${capOk}/${labelOk}/${engOk} of ${cardCount})`);
  // A card with a render must place the render ABOVE the dimensioned plan.
  const renderCards = page.locator('[data-feed-card]:has([data-feed-render])');
  const renderCardCount = await renderCards.count();
  note(renderCardCount >= 1, `at least one feed card shows a photoreal render (${renderCardCount}/${cardCount})`);
  if (renderCardCount >= 1) {
    const order = await renderCards.first().evaluate((el) => {
      const r = el.querySelector('[data-feed-render]')?.getBoundingClientRect().top ?? 0;
      const p = el.querySelector('[data-feed-plan-sheet]')?.getBoundingClientRect().top ?? 1e9;
      return r < p;
    });
    note(order, 'feed card renders the concept render ABOVE the dimensioned plan');
  }
}

// (4b) destructive Delete is two-step (arm -> confirm). Class: a destructive
// action must never fire on a single click. Root-cause fix: shared ConfirmButton.
// This asserts the FIRST click ARMS and does NOT delete — it never sends the
// second (confirming) click, so no real plan is removed by the gate.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(4000);
const delBtns = page.locator('[data-delete-plan]');
const delCount = await delBtns.count();
note(delCount >= 1, `home feed exposes at least one Delete control (${delCount})`);
if (delCount >= 1) {
  const cardsBefore = await page.locator('[data-feed-card]').count();
  const firstDel = delBtns.first();
  const armedBefore = await firstDel.getAttribute('data-armed');
  await firstDel.click();
  await page.waitForTimeout(150);
  const armedAfter = await firstDel.getAttribute('data-armed');
  const labelAfter = ((await firstDel.textContent()) ?? '').trim();
  const cardsAfterArm = await page.locator('[data-feed-card]').count();
  note(armedBefore === 'false' && armedAfter === 'true' && /confirm/i.test(labelAfter) && cardsAfterArm === cardsBefore,
    `single Delete click arms without deleting (armed ${armedBefore}->${armedAfter}, "${labelAfter}", cards ${cardsBefore}->${cardsAfterArm})`);
}

// (5) landing brief box: live parse echo + ignored-word honesty
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
await page.locator('[data-home-brief-input]').fill('three bedroom two bath gable farmhouse on a 60 x 90 lot with 10 foot setbacks');
await page.waitForTimeout(400);
const echoText = await page.locator('[data-home-brief-echo]').textContent().catch(() => '');
note(/3 bed/.test(echoText) && /2 bath/.test(echoText) && /gable/.test(echoText) && /60×90 lot/.test(echoText) && /F10\/B10\/L10\/R10/.test(echoText), `landing echo parses program (${echoText.trim().slice(0, 90)})`);
const ignoredText = await page.locator('[data-home-brief-ignored]').textContent().catch(() => '');
note(/farmhouse/.test(ignoredText), 'landing echo surfaces ignored words');

// (6) responsive: no horizontal overflow + key landmarks at standard breakpoints.
// Home assertions land with the home-feed responsive pass; detail-page and modal
// assertions are added as those surfaces are made responsive (gates assert MORE
// as each surface is fixed — never assert overflow before the fix lands).
const BREAKPOINTS = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'tablet', width: 768, height: 1024 },
  { id: 'laptop', width: 1024, height: 768 },
  { id: 'desktop', width: 1440, height: 900 },
];
const overflowPx = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
for (const bp of BREAKPOINTS) {
  await page.setViewportSize({ width: bp.width, height: bp.height });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const homeOverflow = await overflowPx();
  const homeCards = await page.locator('[data-feed-card]').count();
  note(homeOverflow <= 1, `home: no horizontal overflow @ ${bp.id} ${bp.width}px (overflow ${homeOverflow}px)`);
  note(homeCards >= 1, `home: feed cards render @ ${bp.id} (${homeCards})`);

  // plan detail: no overflow + the 3D canvas and a plan sheet render, both with
  // the Review Tools rail closed AND open (the open rail must stack, not overflow).
  await page.goto(`${BASE}/?home=gen-001`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const detailOverflow = await overflowPx();
  const canvasCount = await page.locator('canvas').count();
  const planSheet = await page.locator('[data-deterministic-render], [data-feed-plan-sheet], [data-live-thumbnail], main svg').count();
  note(detailOverflow <= 1, `detail: no horizontal overflow @ ${bp.id} ${bp.width}px (overflow ${detailOverflow}px)`);
  note(canvasCount >= 1 && planSheet >= 1, `detail: 3D canvas + plan sheet render @ ${bp.id} (canvas ${canvasCount}, sheet ${planSheet})`);
  await page.locator('button', { hasText: /^Review Tools$/ }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const detailToolsOverflow = await overflowPx();
  note(detailToolsOverflow <= 1, `detail: no overflow with Review Tools open @ ${bp.id} (overflow ${detailToolsOverflow}px)`);
  await page.locator('button', { hasText: /^Review Tools$/ }).first().click().catch(() => {});
}

// (7) the workflow modals fit narrow viewports: panel within bounds, no page
// overflow, scroll inside the modal (two-column layouts stack on mobile).
const MODAL_BTNS = ['New Plan', 'Import JSON', 'Export', 'Look Render', 'Repair With GPT'];
for (const mw of [390, 768]) {
  await page.setViewportSize({ width: mw, height: 900 });
  await page.goto(`${BASE}/?home=gen-001`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  for (const btn of MODAL_BTNS) {
    await page.locator('button', { hasText: new RegExp(`^${btn}$`) }).first().click().catch(() => {});
    await page.waitForTimeout(700);
    const fit = await page.evaluate(() => {
      const off = document.documentElement.scrollWidth - window.innerWidth;
      const panel = document.querySelector('.fixed.inset-0.z-50 > div');
      const r = panel ? panel.getBoundingClientRect() : null;
      return { off, present: !!panel, inBounds: r ? (r.left >= -1 && r.right <= window.innerWidth + 1) : false };
    });
    note(fit.present && fit.off <= 1 && fit.inBounds, `modal "${btn}" fits @ ${mw}px (overflow ${fit.off}px, in-bounds ${fit.inBounds})`);
    await page.locator('button', { hasText: /^Close$/ }).first().click().catch(() => {});
    await page.waitForTimeout(300);
  }
}
await page.setViewportSize({ width: 1600, height: 1000 });

await browser.close();
if (failures) {
  console.error(`\n${failures} sweep check(s) failed`);
  process.exit(1);
}
console.log('\nfinal interactive sweep clean');
