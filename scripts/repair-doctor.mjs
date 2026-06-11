#!/usr/bin/env node
/**
 * Report the current repair-loop readiness.
 *
 * This does not mutate plans. It gives the operator one concise place to see
 * what is blocking the next prompt-to-plan repair pass.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const QA_REPORT = resolve(ROOT, 'artifacts/brochure-qa/report.json');
const BUNDLES_ALL = resolve(ROOT, 'artifacts/brochure-qa/repair-bundles-all');
const BUNDLES_PRIORITY = BUNDLES_ALL;
const TARGET_PLANS = ['a-frame-bunk', 'a-frame-22', 'outpost-medium'];

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function envValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const text = await readFile(resolve(ROOT, '.env.local'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equals = trimmed.indexOf('=');
      if (equals === -1) continue;
      const key = trimmed.slice(0, equals).trim();
      if (key === name) return trimmed.slice(equals + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  } catch {
    return '';
  }
  return '';
}

async function listFiles(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

function normalizeLayer(layer) {
  return String(layer).replace(/\//g, '-').replace(/\s+/g, '-').toLowerCase();
}

function expectedLayersForPlan(report, planId) {
  const packetLayers = (report?.repairPackets ?? [])
    .filter((packet) => packet.planId === planId)
    .flatMap((packet) => packet.layers ?? [])
    .map(normalizeLayer);
  const uniquePacketLayers = [...new Set(packetLayers)].filter(Boolean);
  if (uniquePacketLayers.length) return uniquePacketLayers;
  return [
    'walls',
    'doors',
    'windows',
    'fixtures',
    'stairs',
    'void-open-to-below',
    'dimensions',
    'level-frames',
    'drawing-style-profile',
  ];
}

function planCoverage(files, planId, expectedLayers) {
  const covered = expectedLayers.filter((layer) => files.some((file) => file === `${planId}-proposal-paired-v1-${layer}.zip` || file.includes(`${planId}-`) && file.endsWith(`-${layer}.zip`)));
  const missing = expectedLayers.filter((layer) => !covered.includes(layer));
  return { covered, missing };
}

function nextBlockedPlan(report) {
  const rows = report?.results ?? [];
  for (const planId of TARGET_PLANS) {
    const result = rows.find((row) => row.planId === planId && (row.blockers ?? []).length);
    if (result) return result;
  }
  return null;
}

async function main() {
  const preferredPlan = argValue('--plan');
  const qa = await exists(QA_REPORT) ? await readJson(QA_REPORT) : null;
  const allFiles = await listFiles(BUNDLES_ALL);
  const priorityFiles = await listFiles(BUNDLES_PRIORITY);
  const apiKey = await envValue('OPENAI_API_KEY');
  const model = await envValue('OPENAI_REPAIR_MODEL') || await envValue('OPENAI_MODEL');
  const blocked = nextBlockedPlan(qa);
  const targetPlan = preferredPlan || blocked?.planId || TARGET_PLANS[0];
  const session = allFiles.find((file) => file.startsWith(`${targetPlan}-`) && file.endsWith('-repair-session.md'));
  const expectedLayers = expectedLayersForPlan(qa, targetPlan);
  const preferredLayer = expectedLayers.includes('semantic-rebuild') ? 'semantic-rebuild' : expectedLayers[0];
  const firstZip = allFiles.find((file) => file.startsWith(`${targetPlan}-`) && file.endsWith(`-${preferredLayer}.zip`))
    ?? priorityFiles.find((file) => file.startsWith(`${targetPlan}-`) && file.endsWith(`-${preferredLayer}.zip`))
    ?? allFiles.find((file) => file.startsWith(`${targetPlan}-`) && file.endsWith('.zip'));
  const firstBundle = firstZip ? firstZip.replace(/\.zip$/, '') : '';
  const coverage = planCoverage(allFiles, targetPlan, expectedLayers);
  const latestBlockers = (qa?.results ?? [])
    .filter((row) => row.planId === targetPlan)
    .flatMap((row) => row.blockers ?? []);

  const report = {
    targetPlan,
    qaReport: qa ? 'present' : 'missing',
    qaPassed: qa?.passed === true,
    openaiApiKey: apiKey ? 'present' : 'missing',
    openaiRepairModel: model || 'missing',
    allLayerBundles: `${coverage.covered.length}/${expectedLayers.length}`,
    expectedLayers,
    missingLayers: coverage.missing,
    repairSession: session ? resolve(BUNDLES_ALL, session) : 'missing',
    firstBundle: firstBundle ? resolve(BUNDLES_ALL, firstBundle) : 'missing',
    latestBlockerCount: latestBlockers.length,
    latestBlockers: latestBlockers.slice(0, 5),
    nextCommands: firstBundle ? [
      `npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all`,
      apiKey && model
        ? `npm run repair:gpt -- --bundle ${resolve(BUNDLES_ALL, firstBundle)} --model "$OPENAI_REPAIR_MODEL" --yes`
        : `# Upload ${resolve(BUNDLES_ALL, `${firstBundle}.zip`)} to ChatGPT, save response as response.txt`,
      `npm run repair:ingest -- --bundle ${resolve(BUNDLES_ALL, firstBundle)} --response response.txt`,
      `npm run repair:ingest -- --bundle ${resolve(BUNDLES_ALL, firstBundle)} --latest-download`,
      `npm run repair:apply -- --bundle ${resolve(BUNDLES_ALL, firstBundle)} --patch ${resolve(BUNDLES_ALL, firstBundle, 'patch.json')}`,
      `npm run qa:brochure`,
      `npm run goal:audit`,
    ] : [],
  };

  console.log(JSON.stringify(report, null, 2));
  if (!qa || coverage.missing.length || latestBlockers.length || !apiKey || !model) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
