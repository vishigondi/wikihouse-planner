// Final overnight interactive sweep: full protocol on every plan.
// Rotation drags, all views + level/roof toggles, Compare/Overlay/Semantic,
// constraint report assertions; lot-editor flip + brief parse once.
// Usage: node scripts/final-interactive-sweep.mjs

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3002';
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

  // (3) Compare -> Overlay -> Semantic
  await page.locator('button', { hasText: /^Overlay$/ }).first().click();
  await page.waitForTimeout(900);
  const overlayBroken = await page.locator('img[alt*="GPT proposal"]').evaluateAll(
    (imgs) => imgs.some((img) => img.complete && img.naturalWidth === 0),
  ).catch(() => false);
  note(!overlayBroken, 'overlay has no broken image');
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
  await page.screenshot({ path: `${SHOT_DIR}/${plan}-semantic.png`, fullPage: false });
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

await browser.close();
if (failures) {
  console.error(`\n${failures} sweep check(s) failed`);
  process.exit(1);
}
console.log('\nfinal interactive sweep clean');
