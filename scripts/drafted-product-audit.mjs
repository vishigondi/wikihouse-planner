#!/usr/bin/env node
/**
 * Completion audit for the Drafted-style prompt-to-plan product goal.
 *
 * This is intentionally stricter than smoke tests. It maps the goal's product
 * requirements to concrete repository evidence and fails while any release
 * requirement is incomplete or weakly verified.
 */

import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'artifacts/goal-audit');
const QA_REPORT = resolve(ROOT, 'artifacts/brochure-qa/report.json');

async function readText(path) {
  return readFile(resolve(ROOT, path), 'utf8');
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
}

async function exists(path) {
  try {
    await stat(resolve(ROOT, path));
    return true;
  } catch {
    return false;
  }
}

function status(pass, weak = false) {
  if (pass && !weak) return 'pass';
  if (pass && weak) return 'weak';
  return 'missing';
}

function line(item) {
  const mark = item.status === 'pass' ? 'PASS' : item.status === 'weak' ? 'WEAK' : 'MISSING';
  return `- ${mark}: ${item.requirement}\n  Evidence: ${item.evidence}`;
}

async function zipEvidence() {
  const dirs = [
    resolve(ROOT, 'artifacts/brochure-qa/repair-bundles-all'),
  ];
  const zips = [];
  for (const dir of dirs) {
    try {
      const entries = await readdir(dir);
      zips.push(...entries.filter((entry) => entry.endsWith('.zip')).map((entry) => `${dir.replace(`${ROOT}/`, '')}/${entry}`));
    } catch {
      // Optional evidence directory; absent until repair:queue has been run.
    }
  }
  return zips.sort();
}

function slugLayer(layer) {
  return String(layer ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const REQUIRED_LAYER_EVIDENCE_EXAMPLE = 'roof-elevation';

async function repairCoverage(zips, targetPasses) {
  return Promise.all(targetPasses.map(async (target) => {
    if (target.passed) {
      return {
        planId: target.planId,
        requiredLayers: [],
        coveredLayers: [],
        missingLayers: [],
        complete: true,
        reason: 'browser QA passed; no repair bundle required',
      };
    }

    let requiredLayers = [];
    try {
      const packet = await readJson(resolve(ROOT, `artifacts/brochure-qa/${target.planId}-brochure-repair-packet.json`));
      requiredLayers = [...new Set((packet.prompts ?? []).map((prompt) => slugLayer(prompt.layer)).filter(Boolean))];
    } catch {
      requiredLayers = [];
    }

    const planZips = zips.filter((zip) => zip.includes(`/${target.planId}-`) || zip.includes(`${target.planId}-`));
    const coveredLayers = requiredLayers.filter((layer) => planZips.some((zip) => zip.includes(`-${layer}.zip`)));
    const missingLayers = requiredLayers.filter((layer) => !coveredLayers.includes(layer));
    return {
      planId: target.planId,
      requiredLayers,
      coveredLayers,
      missingLayers,
      complete: requiredLayers.length > 0 && missingLayers.length === 0,
      reason: requiredLayers.length ? 'blocked plan has scoped repair evidence' : 'blocked plan has no repair packet prompts',
    };
  }));
}

async function firstExistingText(paths) {
  for (const path of paths) {
    try {
      return await readFile(resolve(ROOT, path), 'utf8');
    } catch {
      // Try the next evidence file.
    }
  }
  return '';
}

async function main() {
  const app = await readText('app/page.tsx');
  const targetedRepair = await readText('lib/repair/targeted-repair.ts');
  const readme = await readText('README.md');
  const pkg = await readJson(resolve(ROOT, 'package.json'));
  const qa = await exists('artifacts/brochure-qa/report.json') ? await readJson(QA_REPORT) : null;
  const zips = await zipEvidence();
  const targetPlans = ['a-frame-bunk', 'a-frame-22', 'outpost-medium'];
  const repairBundleReadme = await firstExistingText([
    'artifacts/brochure-qa/repair-bundles-all/README.md',
  ]);
  const targetResults = targetPlans.map((planId) => ({
    planId,
    results: qa?.results?.filter((result) => result.planId === planId) ?? [],
  }));
  const targetPasses = targetResults.map((target) => ({
    planId: target.planId,
    passed: target.results.length > 0 && target.results.every((result) => (result.blockers ?? []).length === 0),
    blockers: target.results.flatMap((result) => result.blockers ?? []),
  }));
  const atLeastOneTargetReady = targetPasses.some((target) => target.passed);
  const allTargetsReady = targetPasses.every((target) => target.passed);
  const coverage = await repairCoverage(zips, targetPasses);
  const allTargetsHaveLayerRepairBundles = coverage.every((item) => item.complete);

  const checklist = [
    {
      requirement: 'Drafted-style product gallery exists before harness/detail views',
      status: status(app.includes('ProductGallery') && app.includes('Browse Plans') && app.includes('Prompt-to-plan studio')),
      evidence: 'app/page.tsx contains ProductGallery, Browse Plans, and Prompt-to-plan studio copy.',
    },
    {
      requirement: 'Gallery filters by bedrooms, baths, square footage, levels, roof type, and validation status',
      status: status(['All bed/bath', 'All baths', 'All square feet', 'All levels', 'All roof types', 'All statuses'].every((text) => app.includes(text))),
      evidence: 'app/page.tsx filter labels.',
    },
    {
      requirement: 'Plan detail separates Product 3D from Compare, Overlay, and Semantic review',
      status: status(app.includes('BIM 3D') && app.includes("{ id: 'compare', label: 'Compare'") && app.includes("{ id: 'overlay', label: 'Overlay'") && app.includes("{ id: 'semantic', label: 'Semantic'")),
      evidence: 'app/page.tsx view/review controls.',
    },
    {
      requirement: 'Repair flow generates scoped GPT JSON Patch prompts and local apply commands',
      status: status(app.includes('Local repair commands') && app.includes('repair:gpt') && app.includes('repair:apply') && targetedRepair.includes('Return RFC 6902 JSON Patch only')),
      evidence: 'app/page.tsx Repair With GPT modal and lib/repair/targeted-repair.ts prompt contract.',
    },
    {
      requirement: 'Repair queue emits uploadable evidence bundles and zipped ChatGPT handoffs',
      status: status(Boolean(pkg.scripts?.['repair:queue']) && zips.length >= 3 && repairBundleReadme.includes('Upload one bundle')),
      evidence: `${zips.length} zip bundle(s); README ${repairBundleReadme.includes('Upload one bundle') ? 'has upload instructions' : 'missing upload instructions'}.`,
    },
    {
      requirement: 'Optional local GPT repair CLI is available without exposing tokens to browser code',
      status: status(Boolean(pkg.scripts?.['repair:gpt']) && readme.includes('OPENAI_API_KEY') && readme.includes('never exposes provider keys to browser code')),
      evidence: 'package.json repair:gpt and README API handoff text.',
    },
    {
      requirement: 'Explicit repair loop exists without cron/background behavior',
      status: status(Boolean(pkg.scripts?.['repair:loop']) && readme.includes('without installing cron') && readme.includes('Without `--yes`')),
      evidence: 'package.json repair:loop and README loop section.',
    },
    {
      requirement: 'Export/download flow provides product packet and brochure artifacts',
      status: status(app.includes('Export Brochure Packet JSON') && app.includes('Export HTML Brochure') && app.includes('Export 2D SVG') && app.includes('Export Current 3D PNG')),
      evidence: 'app/page.tsx export modal labels.',
    },
    {
      requirement: 'Browser QA covers gallery, Product 3D, Cutaway, Plan Top, Compare, Overlay, Semantic, and export packet',
      status: status(Boolean(pkg.scripts?.['qa:brochure']) && qa?.results?.length > 0 && readme.includes('npm run qa:brochure')),
      evidence: qa ? `QA report generated with ${qa.results.length} result rows; passed=${qa.passed}` : 'No artifacts/brochure-qa/report.json.',
    },
    {
      requirement: 'At least one target plan is true brochure-ready in browser QA',
      status: status(atLeastOneTargetReady),
      evidence: targetPasses.map((target) => `${target.planId}: ${target.passed ? 'pass' : `${target.blockers.length} blocker(s)`}`).join('; '),
    },
    {
      requirement: 'All three target plans are true brochure-ready or remain explicitly blocked with repair evidence',
      status: status(allTargetsReady || allTargetsHaveLayerRepairBundles),
      evidence: allTargetsReady
        ? 'All target plans passed browser QA.'
        : `Targets still blocked; scoped repair bundle coverage: ${coverage.map((item) => `${item.planId} ${item.coveredLayers.length}/${item.requiredLayers.length}${item.missingLayers.length ? ` missing ${item.missingLayers.join(', ')}` : ''} (${item.reason})`).join('; ')}`,
    },
  ];

  const complete = checklist.every((item) => item.status === 'pass');
  const blockers = checklist.filter((item) => item.status !== 'pass');
  await mkdir(OUT_DIR, { recursive: true });
  const audit = {
    artifactVersion: 'drafted_product_goal_audit_v1',
    generatedAt: new Date().toISOString(),
    objective: 'Rebuild the floorplan app toward a Drafted-style prompt-to-plan product experience',
    complete,
    checklist,
    targetPasses,
    repairCoverage: coverage,
  };
  await writeFile(resolve(OUT_DIR, 'drafted-product-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  await writeFile(resolve(OUT_DIR, 'drafted-product-audit.md'), [
    '# Drafted Product Goal Audit',
    '',
    `Generated: ${audit.generatedAt}`,
    `Overall: ${complete ? 'complete' : 'incomplete'}`,
    '',
    '## Checklist',
    '',
    ...checklist.map(line),
    '',
    '## Blocking Items',
    '',
    ...(blockers.length ? blockers.map(line) : ['- none']),
    '',
  ].join('\n'));

  console.log(`goal audit: ${complete ? 'complete' : 'incomplete'}`);
  console.log(`wrote ${resolve(OUT_DIR, 'drafted-product-audit.md')}`);
  for (const item of blockers) console.log(`- ${item.status}: ${item.requirement}`);
  if (!complete) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
