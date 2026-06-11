#!/usr/bin/env node
/**
 * Run one or more explicit brochure repair iterations.
 *
 * This is not a daemon and does not install cron. It sequences the existing
 * product loop: browser QA -> repair bundles -> optional GPT patch request ->
 * scoped dry-run/application -> browser QA again.
 */

import { copyFile, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const DEFAULT_BUNDLE_DIR = 'artifacts/brochure-qa/repair-bundles-all';

function usage() {
  console.error([
    'usage:',
    '  npm run repair:loop -- --url http://127.0.0.1:3001 --iterations 1',
    '',
    'options:',
    '  --url <url>          app URL for browser QA, default BROCHURE_QA_URL or http://127.0.0.1:3000',
    '  --iterations <n>     max repair iterations, default 1',
    '  --bundle-dir <dir>   repair bundle output dir, default artifacts/brochure-qa/repair-bundles-all',
    '  --model <name>       OpenAI model; otherwise OPENAI_REPAIR_MODEL or OPENAI_MODEL',
    '  --yes                call OpenAI and apply accepted patches',
    '  --no-qa-first        skip initial QA and use existing report.json',
    '',
    'Without --yes, this command updates QA/bundles and prints the exact next handoff.',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    url: process.env.BROCHURE_QA_URL || 'http://127.0.0.1:3000',
    iterations: 1,
    bundleDir: DEFAULT_BUNDLE_DIR,
    yes: false,
    qaFirst: true,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--url') args.url = argv[++index];
    else if (arg === '--iterations') args.iterations = Number(argv[++index]);
    else if (arg === '--bundle-dir') args.bundleDir = argv[++index];
    else if (arg === '--model') args.model = argv[++index];
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--no-qa-first') args.qaFirst = false;
    else usage();
  }
  if (!Number.isInteger(args.iterations) || args.iterations < 1) usage();
  return args;
}

async function localEnvValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const envText = await readFile(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.slice(0, index).trim();
      if (key !== name) continue;
      return trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
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

function firstBlockedPacket(report) {
  return (report.repairPackets ?? []).find((packet) => packet.status === 'blocked');
}

function blockedPacketForPlan(report, planId) {
  return (report.repairPackets ?? []).find((packet) => packet.status === 'blocked' && packet.planId === planId) ?? null;
}

function blockerCount(report, planId) {
  return (report.results ?? [])
    .filter((result) => result.planId === planId)
    .reduce((total, result) => total + (result.blockers ?? []).length, 0);
}

function driftScore(packet) {
  const metrics = packet?.visualDrift?.metrics;
  if (!metrics) return null;
  const values = [
    metrics.sourceMissRate,
    metrics.renderExtraRate,
    metrics.edgeSourceMissRate,
    metrics.edgeRenderExtraRate,
  ].map((value) => Number(value)).filter(Number.isFinite);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function scoreLabel(score) {
  return score == null ? 'n/a' : score.toFixed(4);
}

async function main() {
  const args = parseArgs(process.argv);
  const model = args.model || await localEnvValue('OPENAI_REPAIR_MODEL') || await localEnvValue('OPENAI_MODEL');
  const hasApiKey = Boolean(await localEnvValue('OPENAI_API_KEY'));
  if (args.yes && !hasApiKey) throw new Error('OPENAI_API_KEY is required for --yes.');
  if (args.yes && !model) throw new Error('Set --model, OPENAI_REPAIR_MODEL, or OPENAI_MODEL before --yes.');

  for (let iteration = 1; iteration <= args.iterations; iteration += 1) {
    console.log(`\n=== Brochure repair iteration ${iteration}/${args.iterations} ===`);
    if (args.qaFirst || iteration > 1) {
      run('npm', ['run', 'qa:brochure'], { env: { BROCHURE_QA_URL: args.url }, allowFailure: true });
    }
    run('npm', ['run', 'repair:queue', '--', '--out', 'artifacts/brochure-qa/next-repair-prompts.md', '--bundle-dir', args.bundleDir]);

    const report = await readJson(resolve(ROOT, 'artifacts/brochure-qa/report.json'));
    if (report.passed) {
      console.log('brochure QA passed; no repair needed');
      return;
    }
    const packetSummary = firstBlockedPacket(report);
    if (!packetSummary) {
      console.log('no blocked repair packet found; inspect artifacts/brochure-qa/summary.md');
      return;
    }
    const packet = await readJson(packetSummary.path);
    const layer = packet.recommendedSequence?.[0] ?? packet.prompts?.[0]?.layer;
    if (!layer) {
      console.log(`blocked packet has no repair layer: ${packetSummary.path}`);
      return;
    }
    const proposalId = packet.proposalId;
    const bundle = resolve(ROOT, args.bundleDir, `${packet.planId}-${proposalId}-${String(layer).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()}`);
    const patchPath = resolve(bundle, 'patch.json');
    const applyResultPath = resolve(bundle, 'apply-result.json');
    const beforeBlockers = blockerCount(report, packet.planId);
    const beforeDriftScore = driftScore(packet);
    console.log(`next repair: ${packet.planId}/${proposalId}/${layer}`);
    console.log(`bundle: ${bundle}`);
    console.log(`manual upload zip, if generated: ${bundle}.zip`);

    if (!args.yes) {
      console.log('\nmanual/API handoff:');
      console.log(`npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts.md --bundle-dir ${args.bundleDir} --zip`);
      console.log(`npm run repair:gpt -- --bundle ${bundle} --model "$OPENAI_REPAIR_MODEL" --yes`);
      console.log(`npm run repair:apply -- --bundle ${bundle} --patch ${patchPath}`);
      console.log(`npm run qa:brochure`);
      return;
    }

    run('npm', ['run', 'repair:gpt', '--', '--bundle', bundle, '--model', model, '--out', patchPath, '--yes']);
    if (!await exists(patchPath)) throw new Error(`repair:gpt did not write ${patchPath}`);
    run('npm', ['run', 'repair:apply', '--', '--bundle', bundle, '--patch', patchPath, '--result', applyResultPath]);
    const applyResult = await exists(applyResultPath) ? await readJson(applyResultPath) : null;
    if (applyResult?.status !== 'applied') {
      console.log(`repair apply status was ${applyResult?.status ?? 'unknown'}; stopping before QA rerun`);
      return;
    }
    run('npm', ['run', 'render:paired'], { env: { BROCHURE_QA_PLANS: packet.planId } });
    run('npm', ['run', 'drift:paired'], { env: { BROCHURE_QA_PLANS: packet.planId } });
    run('npm', ['run', 'qa:brochure'], { env: { BROCHURE_QA_URL: args.url }, allowFailure: true });
    const afterReport = await readJson(resolve(ROOT, 'artifacts/brochure-qa/report.json'));
    const afterBlockers = blockerCount(afterReport, packet.planId);
    const afterPacketSummary = blockedPacketForPlan(afterReport, packet.planId);
    const afterPacket = afterPacketSummary?.path ? await readJson(afterPacketSummary.path) : null;
    const afterDriftScore = afterPacket ? driftScore(afterPacket) : 0;
    const blockerImproved = afterBlockers < beforeBlockers;
    const driftImproved = beforeDriftScore != null && afterDriftScore != null && afterDriftScore < beforeDriftScore - 0.0001;
    if (!blockerImproved && !driftImproved) {
      await copyFile(applyResult.backup, applyResult.targetJson);
      console.log(`repair did not improve ${packet.planId}: blockers ${beforeBlockers} -> ${afterBlockers}, drift ${scoreLabel(beforeDriftScore)} -> ${scoreLabel(afterDriftScore)}; rolled back ${applyResult.targetJson}`);
      return;
    }
    console.log(`repair retained for ${packet.planId}: blockers ${beforeBlockers} -> ${afterBlockers}, drift ${scoreLabel(beforeDriftScore)} -> ${scoreLabel(afterDriftScore)}`);
  }
  console.log(`completed ${args.iterations} repair iteration(s); run npm run qa:brochure for final status if needed`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
