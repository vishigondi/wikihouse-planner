#!/usr/bin/env node
/**
 * Print the next scoped GPT repair prompt for each release-blocking brochure QA packet.
 *
 * This is intentionally a handoff tool, not a local heuristic repairer. It
 * keeps GPT responsible for visual reasoning and keeps local code responsible
 * for scope validation, patch application, rollback, and QA.
 */

import { copyFile, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = resolve(ROOT, 'artifacts/brochure-qa');
const REPORT_PATH = resolve(OUT_DIR, 'report.json');
const PATCH_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'RFC 6902 JSON Patch response',
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: true,
    required: ['op', 'path'],
    properties: {
      op: { type: 'string', enum: ['add', 'remove', 'replace', 'test'] },
      path: { type: 'string', pattern: '^/' },
      value: {},
    },
  },
};

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
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

function safeName(value) {
  return String(value ?? 'unknown').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function localEvidencePath(path) {
  if (!path) return '';
  const text = String(path);
  try {
    const url = new URL(text);
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && url.pathname.startsWith('/data/')) {
      return resolve(ROOT, 'public', url.pathname.slice(1));
    }
  } catch {
    // Not a URL; treat as a normal file path below.
  }
  return resolve(text);
}

function firstPrompt(packet, preferredLayer) {
  if (!Array.isArray(packet.prompts) || packet.prompts.length === 0) return null;
  if (preferredLayer) {
    const match = packet.prompts.find((prompt) => prompt.layer === preferredLayer);
    if (match) return match;
  }
  const recommended = Array.isArray(packet.recommendedSequence) ? packet.recommendedSequence : [];
  for (const layer of recommended) {
    const match = packet.prompts.find((prompt) => prompt.layer === layer);
    if (match) return match;
  }
  return packet.prompts[0] ?? null;
}

function groupByPlan(items) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.planId}/${item.proposalId}`;
    const existing = groups.get(key) ?? [];
    existing.push(item);
    groups.set(key, existing);
  }
  return [...groups.entries()].map(([key, entries]) => ({ key, entries }));
}

function compactLayerReport(report) {
  if (!report || typeof report !== 'object') return null;
  const compact = { ...report };
  delete compact.layerSection;
  delete compact.patchPathIndex;
  return compact;
}

async function run() {
  const preferredLayer = argValue('--layer');
  const includeAll = process.argv.includes('--all');
  const printBody = process.argv.includes('--print') || !process.argv.includes('--out');
  const outPath = argValue('--out');
  const bundleDir = argValue('--bundle-dir');
  const writeZip = process.argv.includes('--zip');
  const report = await readJson(REPORT_PATH);
  const summaries = [];

  const releaseBlockingPaths = new Set((report.releaseBlockingPackets ?? [])
    .map((packet) => packet.path)
    .filter(Boolean));
  for (const summary of report.repairPackets ?? []) {
    if (!summary.path) continue;
    const packet = await readJson(summary.path);
    const releaseBlocking = releaseBlockingPaths.size
      ? releaseBlockingPaths.has(summary.path)
      : packet.status !== 'pass';
    if (!releaseBlocking) continue;
    const prompts = includeAll ? packet.prompts ?? [] : [firstPrompt(packet, preferredLayer)].filter(Boolean);
    for (const prompt of prompts) {
      summaries.push({
        planId: packet.planId,
        proposalId: packet.proposalId,
        layer: prompt.layer,
        packetPath: summary.path,
        sourceImage: packet.sourceImage,
        deterministicRender: packet.deterministicRender,
        pairedJson: packet.pairedJson,
        drawingStyleProfile: packet.drawingStyleProfile,
        report: packet.reports?.find((report) => report.layer === prompt.layer) ?? null,
        browserEvidence: packet.browserEvidence ?? [],
        prompt: prompt.prompt,
      });
    }
  }

  const body = summaries.length
    ? summaries.map((item, index) => [
      `# ${index + 1}. ${item.planId} / ${item.proposalId} / ${item.layer}`,
      '',
      `Packet: ${item.packetPath}`,
      '',
      item.prompt,
    ].join('\n')).join('\n\n---\n\n')
    : 'No release-blocking brochure repair prompts found. Run npm run qa:brochure first.\n';

  if (outPath) {
    const resolvedOut = resolve(ROOT, outPath);
    await writeFile(resolvedOut, `${body}\n`);
    console.log(`wrote ${summaries.length} repair prompt${summaries.length === 1 ? '' : 's'} to ${resolvedOut}`);
  }
  if (bundleDir) {
    const resolvedBundleRoot = resolve(ROOT, bundleDir);
    if (process.argv.includes('--clean')) {
      await rm(resolvedBundleRoot, { recursive: true, force: true });
    }
    await mkdir(resolvedBundleRoot, { recursive: true });
    const bundleSummaries = [];
    for (const item of summaries) {
      const folder = resolve(resolvedBundleRoot, `${safeName(item.planId)}-${safeName(item.proposalId)}-${safeName(item.layer)}`);
      await mkdir(folder, { recursive: true });
      const assets = [
        { role: 'source-gpt-proposal', path: item.sourceImage },
        { role: 'deterministic-render', path: item.deterministicRender },
        { role: 'current-paired-json', path: item.pairedJson },
        { role: 'drawing-style-profile', path: item.drawingStyleProfile },
        { role: 'brochure-repair-packet', path: item.packetPath },
        ...item.browserEvidence
          .filter((evidence) => ['review-compare', 'review-overlay', 'product3d', 'plantop', 'cutaway'].includes(evidence.kind))
          .map((evidence) => ({ role: `${evidence.viewport}-${evidence.kind}`, path: evidence.path })),
      ];
      const copied = [];
      for (const asset of assets) {
        if (!asset.path) {
          copied.push({ ...asset, status: 'missing' });
          continue;
        }
        const source = localEvidencePath(asset.path);
        if (!await exists(source)) {
          copied.push({ ...asset, status: 'missing' });
          continue;
        }
        const target = resolve(folder, `${safeName(asset.role)}-${safeName(source.split('/').pop())}`);
        await copyFile(source, target);
        copied.push({ ...asset, status: 'copied', file: target });
      }
      await writeFile(resolve(folder, 'repair-prompt.md'), `${item.prompt}\n`);
      if (item.report) {
        await writeFile(resolve(folder, 'layer-report.json'), `${JSON.stringify(compactLayerReport(item.report), null, 2)}\n`);
        await writeFile(resolve(folder, 'current-layer-section.json'), `${JSON.stringify(item.report.layerSection ?? null, null, 2)}\n`);
        await writeFile(resolve(folder, 'patch-path-index.json'), `${JSON.stringify(item.report.patchPathIndex ?? [], null, 2)}\n`);
      }
      const evaluateCommand = `npm run repair:evaluate -- --bundle ${folder} --patch patch.json`;
      const applyCommand = `npm run repair:apply -- --bundle ${folder} --patch patch.json`;
      await writeFile(resolve(folder, 'patch.schema.json'), `${JSON.stringify(PATCH_SCHEMA, null, 2)}\n`);
      await writeFile(resolve(folder, 'README_FOR_GPT.md'), [
        '# Floorplan Repair Bundle',
        '',
        'Task: inspect the attached source proposal, deterministic render, Compare/Overlay screenshots, current paired JSON, and repair-prompt.md.',
        '',
        'Return exactly one file named `patch.json`.',
        '',
        'Rules:',
        '- Return RFC 6902 JSON Patch only.',
        '- No markdown, prose, comments, or full rewritten plan.',
        '- Use only paths allowed by repair-prompt.md.',
        '- Patch current-paired-json only, unless this is explicitly a drawing style profile repair.',
        '- If the visual evidence is insufficient or the issue is renderer-only, return `[]`.',
        '- Do not change unrelated rooms, walls, fixtures, metadata, footprint, scale, or proposal id.',
        '- Use layer-report.json, current-layer-section.json, and patch-path-index.json as machine-readable context.',
        '',
        'The expected response shape is described in patch.schema.json.',
        '',
      ].join('\n'));
      await writeFile(resolve(folder, 'upload-manifest.json'), `${JSON.stringify({
        planId: item.planId,
        proposalId: item.proposalId,
        layer: item.layer,
        packet: item.packetPath,
        prompt: resolve(folder, 'repair-prompt.md'),
        applyCommand,
        instructions: [
          'Upload this whole folder or zip to GPT, including repair-prompt.md, README_FOR_GPT.md, patch.schema.json, and evidence images.',
          'GPT must return RFC 6902 JSON Patch only.',
          `Evaluate the returned patch with: ${evaluateCommand}`,
          'repair:evaluate applies, rerenders, recomputes drift, and rolls back if the patch does not improve the plan.',
          `Use raw apply only for debugging: ${applyCommand}`,
        ],
        assets: copied,
      }, null, 2)}\n`);
      let zipFile = '';
      if (writeZip) {
        zipFile = `${folder}.zip`;
        await unlink(zipFile).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        });
        const zip = spawnSync('zip', ['-qr', zipFile, basename(folder)], { cwd: dirname(folder), encoding: 'utf8' });
        if (zip.status !== 0) {
          throw new Error(`zip failed for ${folder}: ${zip.stderr || zip.stdout || 'unknown error'}`);
        }
      }
      bundleSummaries.push({
        ...item,
        folder,
        zipFile,
        applyCommand,
        evaluateCommand,
        copied: copied.filter((asset) => asset.status === 'copied').length,
        missing: copied.filter((asset) => asset.status === 'missing').length,
      });
      console.log(`bundled ${item.planId}/${item.proposalId}/${item.layer}: ${folder}`);
      if (zipFile) console.log(`zipped ${item.planId}/${item.proposalId}/${item.layer}: ${zipFile}`);
    }
    const sessionSummaries = [];
    for (const group of groupByPlan(bundleSummaries)) {
      const first = group.entries[0];
      const sessionPath = resolve(
        resolvedBundleRoot,
        `${safeName(first.planId)}-${safeName(first.proposalId)}-repair-session.md`,
      );
      await writeFile(sessionPath, [
        `# Repair Session: ${first.planId} / ${first.proposalId}`,
        '',
        'Use this as the plan-level repair checklist. Work one semantic layer at a time so local scope validation can reject unrelated edits.',
        '',
        'Recommended loop for each layer:',
        '',
        '1. Upload the layer zip/folder to GPT.',
        '2. Ask for exactly one `patch.json` RFC 6902 JSON Patch response.',
        '3. Save the copied web response as `response.txt`, or use `repair:gpt` if `OPENAI_API_KEY` is available.',
        '4. Run `repair:ingest`, then `repair:evaluate`.',
        '5. Continue to the next layer only if the patch is accepted or QA still reports source/render drift.',
        '',
        '## Layer Queue',
        '',
        ...group.entries.map((item, index) => [
          `### ${index + 1}. ${item.layer}`,
          '',
          `Folder: ${item.folder}`,
          item.zipFile ? `Zip: ${item.zipFile}` : '',
          `Prompt: ${resolve(item.folder, 'repair-prompt.md')}`,
          '',
          'Manual ChatGPT response path:',
          '',
          '```bash',
          `npm run repair:ingest -- --bundle ${item.folder} --response response.txt`,
          `npm run repair:evaluate -- --bundle ${item.folder} --patch ${resolve(item.folder, 'patch.json')}`,
          '```',
          '',
          'Local API path:',
          '',
          '```bash',
          `npm run repair:gpt -- --bundle ${item.folder} --model "$OPENAI_REPAIR_MODEL" --yes`,
          `npm run repair:evaluate -- --bundle ${item.folder} --patch ${resolve(item.folder, 'patch.json')}`,
          '```',
          '',
        ].join('\n')),
      ].join('\n'));
      sessionSummaries.push({ planId: first.planId, proposalId: first.proposalId, sessionPath, layers: group.entries.length });
    }
    await writeFile(resolve(resolvedBundleRoot, 'README.md'), [
      '# GPT Repair Bundles',
      '',
      writeZip
        ? 'Upload one bundle zip at a time to GPT. Start with the first item because the queue is ordered by current repair priority.'
        : 'Upload one bundle folder at a time to GPT. Start with the first item because the queue is ordered by current repair priority.',
      '',
      '## Plan Repair Sessions',
      '',
      ...sessionSummaries.map((item, index) => [
        `${index + 1}. ${item.planId} / ${item.proposalId}`,
        `   Session: ${item.sessionPath}`,
        `   Layers: ${item.layers}`,
      ].join('\n')),
      '',
      '## Layer Bundles',
      '',
      ...bundleSummaries.map((item, index) => [
        `## ${index + 1}. ${item.planId} / ${item.proposalId} / ${item.layer}`,
        '',
        `Folder: ${item.folder}`,
        item.zipFile ? `Zip: ${item.zipFile}` : '',
        `Prompt: ${resolve(item.folder, 'repair-prompt.md')}`,
        `Evidence files copied: ${item.copied}`,
        item.missing ? `Missing evidence files: ${item.missing}` : 'Missing evidence files: 0',
        '',
        'After GPT returns `patch.json`:',
        '',
        '```bash',
        item.evaluateCommand,
        '```',
        '',
        'Use raw `repair:apply` only for debugging after a patch already passed evaluation.',
        '',
      ].join('\n')),
    ].join('\n'));
  }
  if (printBody) {
    console.log(body);
  } else if (summaries.length) {
    for (const item of summaries) {
      console.log(`- ${item.planId}/${item.proposalId}: ${item.layer}`);
    }
  } else {
    console.log('No blocked brochure repair prompts found. Run npm run qa:brochure first.');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
