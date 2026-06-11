#!/usr/bin/env node
/**
 * Try bounded drawing-style variants for one paired plan and keep the best one
 * only when it improves visual drift. This is intentionally a renderer/style
 * tool; it does not modify semantic geometry.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOOP_ROOT = resolve(ROOT, 'public/data/den-image-loop');

function parseArgs(argv) {
  const args = { plan: 'a-frame-22', proposal: undefined, url: process.env.BROCHURE_QA_URL ?? 'http://127.0.0.1:3001' };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') args.plan = argv[++index];
    else if (arg === '--proposal') args.proposal = argv[++index];
    else if (arg === '--url') args.url = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function promotedProposal(planId) {
  if (planId === 'a-frame-22') return 'proposal-paired-v10';
  if (planId === 'outpost-medium') return 'proposal-paired-v11';
  if (planId === 'a-frame-bunk') return 'proposal-paired-v1';
  throw new Error(`Pass --proposal for ${planId}`);
}

function metricFor(planId, proposalId) {
  const driftPath = resolve(LOOP_ROOT, planId, 'paired', `${planId}-${proposalId}.visual-drift.json`);
  const drift = JSON.parse(readFileSync(driftPath, 'utf8'));
  const m = drift.metrics ?? {};
  const layers = m.primitiveLayerDrift ?? {};
  return {
    sourceMissRate: m.sourceMissRate,
    renderExtraRate: m.renderExtraRate,
    edgeSourceMissRate: m.edgeSourceMissRate,
    edgeRenderExtraRate: m.edgeRenderExtraRate,
    primitiveSourceMissRate: m.primitiveSourceMissRate,
    primitiveRenderExtraRate: m.primitiveRenderExtraRate,
    primitiveEdgeSourceMissRate: m.primitiveEdgeSourceMissRate,
    primitiveEdgeRenderExtraRate: m.primitiveEdgeRenderExtraRate,
    wallSourceMissRate: layers.wall?.sourceMissRate,
    wallRenderExtraRate: layers.wall?.renderExtraRate,
    wallEdgeRenderExtraRate: layers.wall?.edgeRenderExtraRate,
    doorRenderExtraRate: layers.door?.renderExtraRate,
    fixtureRenderExtraRate: layers.fixture?.renderExtraRate,
    windowRenderExtraRate: layers.window?.renderExtraRate,
    dimensionRenderExtraRate: layers.dimension?.renderExtraRate,
    layerDrift: layers,
  };
}

function score(metric) {
  return (
    (metric.edgeSourceMissRate ?? 1) * 2.8
    + (metric.edgeRenderExtraRate ?? 1) * 3.2
    + (metric.sourceMissRate ?? 1) * 1.1
    + (metric.renderExtraRate ?? 1) * 1.4
    + (metric.primitiveEdgeSourceMissRate ?? 1) * 3
    + (metric.primitiveEdgeRenderExtraRate ?? 1) * 4
    + (metric.primitiveSourceMissRate ?? 1)
    + (metric.primitiveRenderExtraRate ?? 1) * 1.2
    + (metric.wallRenderExtraRate ?? 1) * 0.8
  );
}

function printableMetric(metric) {
  const rest = { ...metric };
  delete rest.layerDrift;
  return rest;
}

function layerRegression(metric, baseline) {
  const currentLayers = metric.layerDrift ?? {};
  const baselineLayers = baseline?.layerDrift ?? {};
  const blockers = [];
  for (const [layer, current] of Object.entries(currentLayers)) {
    const base = baselineLayers[layer] ?? {};
    const sourceMissDelta = (current.sourceMissRate ?? 0) - (base.sourceMissRate ?? 0);
    const renderExtraDelta = (current.renderExtraRate ?? 0) - (base.renderExtraRate ?? 0);
    const edgeSourceDelta = (current.edgeSourceMissRate ?? 0) - (base.edgeSourceMissRate ?? 0);
    const edgeExtraDelta = (current.edgeRenderExtraRate ?? 0) - (base.edgeRenderExtraRate ?? 0);
    if ((current.edgeSourceMissRate ?? 0) > 0.12 && edgeSourceDelta > 0.05) {
      blockers.push(`${layer} edge source miss regressed ${edgeSourceDelta.toFixed(3)}`);
    }
    if ((current.sourceMissRate ?? 0) > 0.45 && sourceMissDelta > 0.08) {
      blockers.push(`${layer} source miss regressed ${sourceMissDelta.toFixed(3)}`);
    }
    if ((current.renderExtraRate ?? 0) > 0.55 && renderExtraDelta > 0.08) {
      blockers.push(`${layer} render extra regressed ${renderExtraDelta.toFixed(3)}`);
    }
    if ((current.edgeRenderExtraRate ?? 0) > 0.18 && edgeExtraDelta > 0.06) {
      blockers.push(`${layer} edge render extra regressed ${edgeExtraDelta.toFixed(3)}`);
    }
  }
  return blockers;
}

function run(cmd, args, env) {
  execFileSync(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });
}

function applyVariant(base, variant) {
  const next = structuredClone(base);
  const rules = next.rules;
  const scale = (object, key, factor, min = 0.1) => {
    if (typeof object?.[key] === 'number') object[key] = Math.max(min, object[key] * factor);
  };
  scale(rules.walls, 'exteriorStrokeWidthPx', variant.wallStroke ?? 1);
  scale(rules.walls, 'interiorStrokeWidthPx', variant.interiorStroke ?? 1);
  scale(rules.walls, 'exteriorBackingStrokeWidthPx', variant.wallBody ?? 1, 2);
  scale(rules.openings, 'gapStrokeWidthPx', variant.gap ?? 1, 1);
  scale(rules.doors, 'leafStrokeWidthPx', variant.door ?? 1);
  scale(rules.doors, 'arcStrokeWidthPx', variant.door ?? 1);
  scale(rules.doors, 'strokeWidthPx', variant.door ?? 1);
  scale(rules.windows, 'strokeWidthPx', variant.window ?? 1);
  scale(rules.windows, 'dividerStrokeWidthPx', variant.window ?? 1);
  scale(rules.fixtures, 'strokeWidthPx', variant.fixture ?? 1);
  scale(rules.stairs, 'strokeWidthPx', variant.stair ?? 1);
  scale(rules.voids, 'strokeWidthPx', variant.void ?? 1);
  scale(rules.dimensions, 'strokeWidthPx', variant.dimension ?? 1);
  if (typeof variant.wallOpacity === 'number') rules.walls.exteriorOpacity = variant.wallOpacity;
  if (typeof variant.interiorOpacity === 'number') rules.walls.interiorOpacity = variant.interiorOpacity;
  if (typeof variant.fixtureOpacity === 'number') rules.fixtures.opacity = variant.fixtureOpacity;
  if (typeof variant.doorOpacity === 'number') rules.doors.opacity = variant.doorOpacity;
  if (typeof variant.windowOpacity === 'number') rules.windows.opacity = variant.windowOpacity;
  if (typeof variant.dimensionOpacity === 'number') rules.dimensions.opacity = variant.dimensionOpacity;
  if (typeof variant.voidOpacity === 'number') rules.voids.opacity = variant.voidOpacity;
  if (typeof variant.gridVisible === 'boolean') rules.grid.visible = variant.gridVisible;
  if (typeof variant.gridOpacity === 'number') rules.grid.opacity = variant.gridOpacity;
  if (typeof variant.floorVisible === 'boolean') rules.floorTexture.visible = variant.floorVisible;
  if (typeof variant.floorOpacity === 'number') rules.floorTexture.opacity = variant.floorOpacity;
  if (typeof variant.floorStroke === 'number') rules.floorTexture.strokeWidthPx = variant.floorStroke;
  if (typeof variant.floorSpacing === 'number') rules.floorTexture.spacingFt = variant.floorSpacing;
  if (typeof variant.floorColor === 'string') rules.floorTexture.color = variant.floorColor;
  next.profileId = `${base.profileId}-sweep-${variant.id}`;
  next.generatedAt = new Date().toISOString();
  next.validation = {
    ...next.validation,
    warnings: [...(next.validation?.warnings ?? []), `temporary style sweep variant ${variant.id}`],
  };
  return next;
}

const args = parseArgs(process.argv);
const proposalId = args.proposal ?? promotedProposal(args.plan);
const stylePath = resolve(LOOP_ROOT, args.plan, 'paired', `${args.plan}-${proposalId}.drawing-style.json`);
const backupPath = `${stylePath}.sweep-runtime-bak`;
copyFileSync(stylePath, backupPath);
const base = JSON.parse(readFileSync(stylePath, 'utf8'));

const variants = [
  { id: 'baseline' },
  { id: 'thin-dark', wallStroke: 0.55, interiorStroke: 0.55, door: 0.75, window: 0.75, fixture: 0.82, stair: 0.82, dimension: 0.65 },
  { id: 'thin-wall-only', wallStroke: 0.55, interiorStroke: 0.55 },
  { id: 'lighter-symbols', door: 0.7, window: 0.72, fixture: 0.72, stair: 0.75, dimension: 0.6, fixtureOpacity: 0.58, dimensionOpacity: 0.78 },
  { id: 'lighter-walls', wallStroke: 0.62, interiorStroke: 0.62, wallOpacity: 0.9, interiorOpacity: 0.82 },
  { id: 'narrow-body', wallBody: 0.82, gap: 0.8, wallStroke: 0.7, interiorStroke: 0.7 },
  { id: 'soft-all', wallStroke: 0.6, interiorStroke: 0.6, door: 0.7, window: 0.72, fixture: 0.75, stair: 0.78, dimension: 0.62, void: 0.72, wallOpacity: 0.9, interiorOpacity: 0.82, fixtureOpacity: 0.62, dimensionOpacity: 0.8, voidOpacity: 0.38 },
  { id: 'dim-light', dimension: 0.42, dimensionOpacity: 0.55 },
  { id: 'dim-hairline', dimension: 0.28, dimensionOpacity: 0.42 },
  { id: 'dim-soft-symbols', door: 0.78, window: 0.82, fixture: 0.82, stair: 0.82, dimension: 0.35, dimensionOpacity: 0.48 },
  { id: 'wall-edge-soft', wallStroke: 0.38, interiorStroke: 0.5, wallOpacity: 0.86, interiorOpacity: 0.78 },
  { id: 'wall-edge-body-soft', wallStroke: 0.45, interiorStroke: 0.55, wallBody: 0.92, gap: 0.9, wallOpacity: 0.88, interiorOpacity: 0.8 },
  { id: 'wall-edge-and-dim', wallStroke: 0.42, interiorStroke: 0.52, dimension: 0.42, dimensionOpacity: 0.55, wallOpacity: 0.88, interiorOpacity: 0.8 },
  { id: 'fixture-edge-soft', door: 0.55, window: 0.58, fixture: 0.48, stair: 0.62, fixtureOpacity: 0.36 },
  { id: 'fixture-edge-dim', door: 0.58, window: 0.62, fixture: 0.42, stair: 0.58, dimension: 0.42, fixtureOpacity: 0.32, dimensionOpacity: 0.55 },
  { id: 'brochure-edge-soft', wallStroke: 0.46, interiorStroke: 0.54, wallBody: 0.9, gap: 0.88, door: 0.56, window: 0.58, fixture: 0.42, stair: 0.58, dimension: 0.42, wallOpacity: 0.88, interiorOpacity: 0.78, fixtureOpacity: 0.34, dimensionOpacity: 0.55 },
  { id: 'fixture-body-125', fixture: 1.25, stair: 1.05, fixtureOpacity: 1 },
  { id: 'fixture-body-150', fixture: 1.5, stair: 1.1, fixtureOpacity: 1 },
  { id: 'fixture-body-180', fixture: 1.8, stair: 1.2, fixtureOpacity: 1 },
  { id: 'fixture-body-220', fixture: 2.2, stair: 1.3, fixtureOpacity: 1 },
  { id: 'fixture-body-260', fixture: 2.6, stair: 1.35, fixtureOpacity: 1 },
  { id: 'door-source-140', door: 1.4, doorOpacity: 1 },
  { id: 'door-source-180', door: 1.8, doorOpacity: 1 },
  { id: 'void-source-140', void: 1.4, voidOpacity: 0.62 },
  { id: 'void-source-180', void: 1.8, voidOpacity: 0.72 },
  { id: 'door-void-source', door: 1.55, void: 1.55, doorOpacity: 1, voidOpacity: 0.68 },
  { id: 'window-source-130', window: 1.3, windowOpacity: 1 },
  { id: 'opening-source-pack', door: 1.45, window: 1.25, void: 1.35, doorOpacity: 1, windowOpacity: 1, voidOpacity: 0.64 },
  { id: 'floor-dense-20', floorSpacing: 0.2, floorOpacity: 0.28, floorStroke: 0.35, gridOpacity: 0.18 },
  { id: 'floor-dense-16', floorSpacing: 0.16, floorOpacity: 0.28, floorStroke: 0.35, gridOpacity: 0.12 },
  { id: 'floor-dense-14', floorSpacing: 0.14, floorOpacity: 0.24, floorStroke: 0.32, gridOpacity: 0.08 },
  { id: 'floor-dense-dark-16', floorSpacing: 0.16, floorOpacity: 0.36, floorStroke: 0.4, gridOpacity: 0.1 },
  { id: 'floor-source-like', floorSpacing: 0.18, floorOpacity: 0.34, floorStroke: 0.38, floorColor: '#cbc4ba', gridVisible: false },
  { id: 'floor-source-like-soft', floorSpacing: 0.18, floorOpacity: 0.28, floorStroke: 0.34, floorColor: '#d1cbc2', gridVisible: false },
  { id: 'floor-source-like-dense', floorSpacing: 0.14, floorOpacity: 0.24, floorStroke: 0.32, floorColor: '#d1cbc2', gridVisible: false },
];

const results = [];
try {
  let baselineMetric = null;
  for (const variant of variants) {
    writeFileSync(stylePath, `${JSON.stringify(applyVariant(base, variant), null, 2)}\n`);
    run('npm', ['run', 'render:paired'], { BROCHURE_QA_URL: args.url, BROCHURE_QA_PLANS: args.plan });
    run('npm', ['run', 'drift:paired'], { BROCHURE_QA_URL: args.url, BROCHURE_QA_PLANS: args.plan });
    const metric = metricFor(args.plan, proposalId);
    if (variant.id === 'baseline') baselineMetric = metric;
    const regressions = variant.id === 'baseline' ? [] : layerRegression(metric, baselineMetric);
    results.push({ variant: variant.id, score: score(metric), metric, regressions, viable: regressions.length === 0 });
    console.log(JSON.stringify({ ...results.at(-1), metric: printableMetric(metric) }));
  }
  const baseline = results.find((item) => item.variant === 'baseline');
  const best = [...results].filter((item) => item.viable).sort((a, b) => a.score - b.score)[0];
  const improved = best && baseline && best.score < baseline.score * 0.985;
  if (improved && best.variant !== 'baseline') {
    const variant = variants.find((item) => item.id === best.variant);
    writeFileSync(stylePath, `${JSON.stringify(applyVariant(base, variant), null, 2)}\n`);
    console.log(`kept ${best.variant}: ${baseline.score.toFixed(4)} -> ${best.score.toFixed(4)}`);
  } else {
    copyFileSync(backupPath, stylePath);
    console.log(`restored baseline: best ${best?.variant ?? 'none'} did not improve enough`);
  }
  run('npm', ['run', 'render:paired'], { BROCHURE_QA_URL: args.url, BROCHURE_QA_PLANS: args.plan });
  run('npm', ['run', 'drift:paired'], { BROCHURE_QA_URL: args.url, BROCHURE_QA_PLANS: args.plan });
} catch (error) {
  copyFileSync(backupPath, stylePath);
  throw error;
}
