#!/usr/bin/env node
/**
 * Apply a scoped repair patch, regenerate deterministic outputs, measure drift,
 * and keep the patch only if it improves the selected plan.
 *
 * This is the manual repair counterpart to repair:loop. It is intentionally
 * conservative: a syntactically valid JSON Patch is not enough. The patch must
 * move browser/visual evidence in the right direction without introducing new
 * browser QA blockers or it is rolled back.
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST_PATH = resolve(ROOT, 'public/data/den-image-loop/proposal-manifest.json');

function usage() {
  console.error([
    'usage:',
    '  npm run repair:evaluate -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-walls --patch patch.json',
    '',
    'options:',
    '  --bundle <dir>       repair bundle folder containing upload-manifest.json',
    '  --patch <path>       RFC 6902 JSON Patch array returned by GPT',
    '  --url <url>          app URL for browser render/drift/QA, default BROCHURE_QA_URL or http://127.0.0.1:3002',
    '  --skip-qa            skip browser QA; only use for renderer/debug experiments, default false',
    '  --keep-on-equal      keep patch when score is exactly unchanged, default false',
    '',
    'The evaluator always runs repair:apply, render:paired, and drift:paired.',
    'It rolls back automatically if the drift score does not improve.',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    url: process.env.BROCHURE_QA_URL || 'http://127.0.0.1:3002',
    qa: true,
    keepOnEqual: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--bundle') args.bundle = argv[++index];
    else if (arg === '--patch') args.patch = argv[++index];
    else if (arg === '--url') args.url = argv[++index];
    else if (arg === '--qa') args.qa = true;
    else if (arg === '--skip-qa') args.qa = false;
    else if (arg === '--keep-on-equal') args.keepOnEqual = true;
    else usage();
  }
  if (!args.bundle || !args.patch) usage();
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function run(command, args, options = {}) {
  console.log(`$ ${[command, ...args].join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
  }
  return result.status ?? 0;
}

function pairedEnv(args, planId) {
  return { BROCHURE_QA_URL: args.url, BROCHURE_QA_PLANS: planId };
}

function manifestOption(manifest, planId, proposalId) {
  const options = manifest.plans?.[planId] ?? [];
  return options.find((option) => option.id === proposalId) ?? null;
}

function driftPathFor(packet) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const option = manifestOption(manifest, packet.planId, packet.proposalId);
  if (!option?.pairedVisualDriftUrl) return null;
  return resolve(ROOT, 'public/data/den-image-loop', packet.planId, option.pairedVisualDriftUrl);
}

function driftScore(drift) {
  const metrics = drift?.metrics;
  if (!metrics) return null;
  const values = [
    metrics.primitiveEdgeSourceMissRate,
    metrics.primitiveEdgeRenderExtraRate,
    metrics.sourceMissRate,
    metrics.renderExtraRate,
  ].map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function blockerCount(report, planId) {
  return (report.results ?? [])
    .filter((result) => result.planId === planId)
    .reduce((total, result) => total + (result.blockers ?? []).length, 0);
}

function blockerMessages(report, planId) {
  return new Set((report.results ?? [])
    .filter((result) => result.planId === planId)
    .flatMap((result) => result.blockers ?? [])
    .map((blocker) => String(blocker)
      .replace(/\b\d+(?:\.\d+)?\s*%/g, '<pct>')
      .replace(/\b\d+(?:\.\d+)?\s*ft\b/g, '<ft>')
      .replace(/\b\d+(?:\.\d+)?\s*px\b/g, '<px>')
      .replace(/\b\d+(?:\.\d+)?\b/g, '<num>')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean));
}

function rawBlockerMessages(report, planId) {
  return (report.results ?? [])
    .filter((result) => result.planId === planId)
    .flatMap((result) => result.blockers ?? [])
    .map((blocker) => String(blocker).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function setDifference(after, before) {
  return [...after].filter((value) => !before.has(value)).sort();
}

function scoreLabel(value) {
  return value == null ? 'n/a' : value.toFixed(6);
}

function normalizePrimitiveId(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/^anchor[-_]/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function readLayerReport(bundleDir) {
  try {
    return await readJson(resolve(bundleDir, 'layer-report.json'));
  } catch {
    return null;
  }
}

function targetPrimitiveIds(layerReport) {
  return new Set((layerReport?.primitiveRepairTargets ?? [])
    .flatMap((target) => [target.sourceId, target.normalizedSourceId])
    .map(normalizePrimitiveId)
    .filter(Boolean));
}

function primitiveRegionScore(region) {
  if (!region) return null;
  const layer = String(region.layer ?? '');
  const sparse = ['dashedVoid', 'dimension', 'door', 'ladder', 'window'].includes(layer);
  const values = sparse
    ? [region.edgeSourceMissRate, region.edgeRenderExtraRate]
    : [region.edgeSourceMissRate, region.edgeRenderExtraRate, region.sourceMissRate, region.renderExtraRate];
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? Math.max(...finite) : null;
}

function targetPrimitiveRegionScore(drift, targetIds) {
  if (!targetIds.size) return null;
  const scores = (drift?.metrics?.primitiveRegionDrift ?? [])
    .filter((region) => targetIds.has(normalizePrimitiveId(region.id)))
    .map(primitiveRegionScore)
    .filter(Number.isFinite);
  return scores.length ? Math.max(...scores) : null;
}

function targetPrimitiveBlockerScore(messages, targetIds) {
  if (!targetIds.size) return null;
  let matched = false;
  let total = 0;
  for (const message of messages) {
    const normalized = normalizePrimitiveId(message);
    const containsTarget = [...targetIds].some((id) => normalized.includes(id));
    if (!containsTarget) continue;
    const feet = [...message.matchAll(/\b(?:endpoints|center|length)\s+(\d+(?:\.\d+)?)\s*ft\b/gi)]
      .map((match) => Number(match[1]))
      .filter(Number.isFinite);
    if (!feet.length) continue;
    matched = true;
    total += feet.reduce((sum, value) => sum + value, 0);
  }
  return matched ? total : null;
}

async function main() {
  const args = parseArgs(process.argv);
  const bundleDir = resolve(ROOT, args.bundle);
  const manifest = await readJson(resolve(bundleDir, 'upload-manifest.json'));
  const layerReport = await readLayerReport(bundleDir);
  const targetIds = targetPrimitiveIds(layerReport);
  const packet = await readJson(manifest.packet);
  const patchPath = resolve(ROOT, args.patch);
  const beforeDriftPath = driftPathFor(packet);
  const beforeDrift = beforeDriftPath ? await readJson(beforeDriftPath) : packet.visualDrift;
  const beforeScore = driftScore(beforeDrift);
  const beforeTargetRegionScore = targetPrimitiveRegionScore(beforeDrift, targetIds);
  let beforeBlockers = null;
  let beforeBlockerMessages = new Set();
  let beforeTargetBlockerScore = null;
  try {
    if (args.qa) {
      run('npm', ['run', 'qa:brochure'], {
        env: pairedEnv(args, packet.planId),
        allowFailure: true,
      });
    }
    const beforeReport = await readJson(resolve(ROOT, 'artifacts/brochure-qa/report.json'));
    beforeBlockers = blockerCount(beforeReport, packet.planId);
    beforeBlockerMessages = blockerMessages(beforeReport, packet.planId);
    beforeTargetBlockerScore = targetPrimitiveBlockerScore(rawBlockerMessages(beforeReport, packet.planId), targetIds);
  } catch {
    beforeBlockers = null;
  }

  const resultPath = resolve(bundleDir, 'evaluate-apply-result.json');
  const statusPath = resolve(bundleDir, 'evaluation-result.json');
  run('npm', ['run', 'repair:apply', '--', '--bundle', bundleDir, '--patch', patchPath, '--result', resultPath]);
  const applyResult = await readJson(resultPath);
  if (applyResult.status !== 'applied') {
    await writeFile(statusPath, `${JSON.stringify({
      status: applyResult.status,
      planId: packet.planId,
      proposalId: packet.proposalId,
      layer: manifest.layer,
      beforeScore,
      reason: 'Patch was a no-op or was not applied.',
    }, null, 2)}\n`);
    console.log(`repair evaluation stopped: apply status ${applyResult.status}`);
    return;
  }

  let kept = false;
  let afterScore = null;
  let afterTargetRegionScore = null;
  let afterBlockers = null;
  let afterTargetBlockerScore = null;
  let reason = '';
  let evaluationError = null;
  let newBlockers = [];
  try {
    run('npm', ['run', 'render:paired'], { env: pairedEnv(args, packet.planId) });
    run('npm', ['run', 'drift:paired'], { env: pairedEnv(args, packet.planId) });
    const afterDrift = beforeDriftPath ? await readJson(beforeDriftPath) : null;
    afterScore = driftScore(afterDrift);
    afterTargetRegionScore = targetPrimitiveRegionScore(afterDrift, targetIds);
    if (args.qa) {
      run('npm', ['run', 'qa:brochure'], {
        env: pairedEnv(args, packet.planId),
        allowFailure: true,
      });
      const afterReport = await readJson(resolve(ROOT, 'artifacts/brochure-qa/report.json'));
      afterBlockers = blockerCount(afterReport, packet.planId);
      newBlockers = setDifference(blockerMessages(afterReport, packet.planId), beforeBlockerMessages);
      afterTargetBlockerScore = targetPrimitiveBlockerScore(rawBlockerMessages(afterReport, packet.planId), targetIds);
    }
    const scoreImproved = beforeScore != null && afterScore != null && (
      afterScore < beforeScore - 0.0001 || (args.keepOnEqual && afterScore <= beforeScore + 0.000001)
    );
    const blockersImproved = beforeBlockers != null && afterBlockers != null && afterBlockers < beforeBlockers;
    const qaClean = !args.qa || newBlockers.length === 0;
    const targetBlockerImproved = beforeTargetBlockerScore == null
      || afterTargetBlockerScore == null
      || afterTargetBlockerScore < beforeTargetBlockerScore - 0.01;
    const targetRegionNotWorse = beforeTargetRegionScore == null
      || afterTargetRegionScore == null
      || afterTargetRegionScore <= beforeTargetRegionScore + 0.025;
    kept = qaClean && targetBlockerImproved && targetRegionNotWorse && (scoreImproved || blockersImproved);
    reason = kept
      ? `accepted: score ${scoreLabel(beforeScore)} -> ${scoreLabel(afterScore)}, blockers ${beforeBlockers ?? 'n/a'} -> ${afterBlockers ?? 'n/a'}`
      : `rejected: score ${scoreLabel(beforeScore)} -> ${scoreLabel(afterScore)}, blockers ${beforeBlockers ?? 'n/a'} -> ${afterBlockers ?? 'n/a'}${newBlockers.length ? `, new blockers ${newBlockers.length}` : ''}${!targetBlockerImproved ? ', target blocker did not improve' : ''}${!targetRegionNotWorse ? ', target primitive region worsened' : ''}`;
  } catch (error) {
    evaluationError = error instanceof Error ? error.message : String(error);
    reason = `rejected: evaluation failed after apply (${evaluationError})`;
  } finally {
    if (!kept) {
      await copyFile(applyResult.backup, applyResult.targetJson);
      run('npm', ['run', 'render:paired'], { env: pairedEnv(args, packet.planId), allowFailure: true });
      run('npm', ['run', 'drift:paired'], { env: pairedEnv(args, packet.planId), allowFailure: true });
    }
  }

  await writeFile(statusPath, `${JSON.stringify({
    status: kept ? 'accepted' : 'rejected',
    planId: packet.planId,
    proposalId: packet.proposalId,
    layer: manifest.layer,
    patch: patchPath,
    applyResult,
    beforeScore,
    afterScore,
    beforeTargetRegionScore,
    afterTargetRegionScore,
    beforeTargetBlockerScore,
    afterTargetBlockerScore,
    beforeBlockers,
    afterBlockers,
    newBlockers,
    reason,
    evaluationError,
    rolledBack: !kept,
  }, null, 2)}\n`);
  console.log(`repair evaluation ${kept ? 'accepted' : 'rejected'}: ${reason}`);
  if (!kept) console.log(`rolled back: ${applyResult.targetJson}`);
  console.log(`evaluation result: ${statusPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
