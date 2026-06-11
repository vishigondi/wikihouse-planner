#!/usr/bin/env node
/**
 * Request a scoped GPT JSON Patch for one brochure repair bundle.
 *
 * This is an optional local handoff helper. It keeps provider secrets out of
 * browser code and keeps local code in the validator/orchestrator role:
 * GPT proposes an RFC 6902 patch, then repair:apply validates scope before
 * the paired semantic JSON can be changed.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const RESPONSES_URL = 'https://api.openai.com/v1/responses';

function usage() {
  console.error([
    'usage:',
    '  npm run repair:gpt -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --out patch.json --yes',
    '',
    'options:',
    '  --bundle <dir>       repair bundle folder containing upload-manifest.json',
    '  --out <path>         patch output path, default: <bundle>/patch.json',
    '  --model <name>       OpenAI model; otherwise OPENAI_REPAIR_MODEL or OPENAI_MODEL',
    '  --max-images <n>     max raster evidence images to attach, default: 8',
    '  --raw-out <path>     write raw API response for debugging',
    '  --yes                actually call the API; without this, only writes a request preview',
    '  --no-validate        skip repair:apply --dry-run validation after writing patch',
    '',
    'environment:',
    '  OPENAI_API_KEY is required for --yes. It may be in the shell or .env.local.',
    '  Never put OPENAI_API_KEY in browser code or committed files.',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = { maxImages: 8, yes: false, validate: true };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--bundle') args.bundle = argv[++index];
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--model') args.model = argv[++index];
    else if (arg === '--max-images') args.maxImages = Number(argv[++index]);
    else if (arg === '--raw-out') args.rawOut = argv[++index];
    else if (arg === '--yes') args.yes = true;
    else if (arg === '--no-validate') args.validate = false;
    else usage();
  }
  if (!args.bundle || !Number.isFinite(args.maxImages) || args.maxImages < 0) usage();
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

function mimeFor(path) {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return '';
}

function patchSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        op: { type: 'string', enum: ['add', 'remove', 'replace', 'test'] },
        path: { type: 'string' },
        value: {},
      },
      required: ['op', 'path'],
    },
  };
}

async function dataUrl(path) {
  const mime = mimeFor(path);
  if (!mime) return '';
  const buffer = await readFile(path);
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function pickRasterEvidence(manifest, maxImages) {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const copied = assets.filter((asset) => asset.status === 'copied' && asset.file && mimeFor(asset.file));
  const priority = [
    'source-gpt-proposal',
    'desktop-review-compare',
    'desktop-review-overlay',
    'desktop-product3d',
    'desktop-cutaway',
    'desktop-plantop',
    'laptop-review-compare',
    'laptop-review-overlay',
    'laptop-product3d',
    'laptop-cutaway',
    'laptop-plantop',
  ];
  return copied
    .map((asset, index) => ({ asset, rank: priority.indexOf(asset.role), index }))
    .sort((a, b) => (a.rank === -1 ? 999 : a.rank) - (b.rank === -1 ? 999 : b.rank) || a.index - b.index)
    .slice(0, maxImages)
    .map((item) => item.asset);
}

async function deterministicSvgContext(manifest) {
  const svgAsset = (manifest.assets ?? []).find((asset) => asset.role === 'deterministic-render' && asset.status === 'copied' && String(asset.file ?? '').toLowerCase().endsWith('.svg'));
  if (!svgAsset?.file) return '';
  const svg = await readFile(svgAsset.file, 'utf8');
  return [
    'Current deterministic render SVG follows. Use it as machine-readable render evidence; do not patch style-only differences unless the selected layer allows it.',
    '',
    '```svg',
    svg.slice(0, 120000),
    '```',
  ].join('\n');
}

async function structuredBundleContext(manifest) {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const wanted = [
    ['current-paired-json', 260000],
    ['drawing-style-profile', 60000],
  ];
  const sections = [];
  for (const [role, maxChars] of wanted) {
    const asset = assets.find((candidate) => candidate.role === role && candidate.status === 'copied' && candidate.file);
    if (!asset?.file) continue;
    const text = await readFile(asset.file, 'utf8');
    const truncated = text.length > maxChars;
    sections.push([
      `${role} follows${truncated ? `, truncated to ${maxChars} characters` : ''}.`,
      '',
      '```json',
      truncated ? text.slice(0, maxChars) : text,
      '```',
    ].join('\n'));
  }
  const localFiles = [
    ['layer-report.json', 90000],
    ['patch-path-index.json', 60000],
  ];
  for (const [fileName, maxChars] of localFiles) {
    try {
      const text = await readFile(resolve(dirname(manifest.prompt), fileName), 'utf8');
      const truncated = text.length > maxChars;
      sections.push([
        `${fileName} follows${truncated ? `, truncated to ${maxChars} characters` : ''}.`,
        '',
        '```json',
        truncated ? text.slice(0, maxChars) : text,
        '```',
      ].join('\n'));
    } catch {
      // Optional bundle context.
    }
  }
  if (!sections.length) return '';
  return [
    'Structured repair context follows. Use this for exact JSON Patch paths and current values.',
    '',
    ...sections,
  ].join('\n\n');
}

async function buildRequest({ manifest, prompt, model, maxImages }) {
  const rasterEvidence = pickRasterEvidence(manifest, maxImages);
  const content = [
    {
      type: 'input_text',
      text: [
        prompt,
        '',
        'You are called through a local validator. Return only an RFC 6902 JSON Patch array. Return [] if the visual evidence is insufficient.',
        '',
        await structuredBundleContext(manifest),
        '',
        await deterministicSvgContext(manifest),
      ].join('\n'),
    },
  ];
  for (const asset of rasterEvidence) {
    content.push({ type: 'input_text', text: `Evidence image: ${asset.role}` });
    content.push({ type: 'input_image', image_url: await dataUrl(asset.file), detail: 'high' });
  }
  return {
    model,
    input: [{ role: 'user', content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'rfc6902_json_patch',
        schema: patchSchema(),
        strict: false,
      },
    },
  };
}

function extractOutputText(responseJson) {
  if (typeof responseJson.output_text === 'string') return responseJson.output_text;
  const chunks = [];
  for (const output of responseJson.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === 'string') chunks.push(content.text);
      if (typeof content.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n').trim();
}

function parseJsonPatchText(text) {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const raw = fenced ? fenced[1].trim() : trimmed;
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('GPT response was not a JSON Patch array');
  for (const [index, operation] of parsed.entries()) {
    if (!operation || typeof operation !== 'object') throw new Error(`patch operation ${index} is not an object`);
    if (!['add', 'remove', 'replace', 'test'].includes(operation.op)) throw new Error(`patch operation ${index} has unsupported op`);
    if (typeof operation.path !== 'string') throw new Error(`patch operation ${index} is missing path`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv);
  const bundleDir = resolve(args.bundle);
  const manifest = await readJson(resolve(bundleDir, 'upload-manifest.json'));
  const prompt = await readFile(manifest.prompt, 'utf8');
  const outPath = resolve(args.out || resolve(bundleDir, 'patch.json'));
  const model = args.model || await localEnvValue('OPENAI_REPAIR_MODEL') || await localEnvValue('OPENAI_MODEL');
  if (!model) {
    throw new Error('Set --model, OPENAI_REPAIR_MODEL, or OPENAI_MODEL before requesting a GPT repair patch.');
  }
  const requestBody = await buildRequest({ manifest, prompt, model, maxImages: args.maxImages });
  if (!args.yes) {
    const previewPath = resolve(bundleDir, 'openai-request-preview.json');
    const preview = {
      ...requestBody,
      input: requestBody.input.map((item) => ({
        ...item,
        content: item.content.map((part) => part.type === 'input_image'
          ? { ...part, image_url: `[data-url omitted: ${String(part.image_url).slice(0, 30)}...]` }
          : part),
      })),
    };
    await writeFile(previewPath, `${JSON.stringify(preview, null, 2)}\n`);
    console.log(`wrote request preview: ${previewPath}`);
    console.log('add --yes to call the OpenAI API and write patch.json');
    return;
  }
  const apiKey = await localEnvValue('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is required. Set it in your shell or .env.local.');

  const response = await fetch(RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  const responseText = await response.text();
  let responseJson;
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    throw new Error(`OpenAI response was not JSON: ${responseText.slice(0, 500)}`);
  }
  if (args.rawOut) await writeFile(resolve(args.rawOut), `${JSON.stringify(responseJson, null, 2)}\n`);
  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status} ${response.statusText}\n${JSON.stringify(responseJson, null, 2).slice(0, 1200)}`);
  }
  const patch = parseJsonPatchText(extractOutputText(responseJson));
  await writeFile(outPath, `${JSON.stringify(patch, null, 2)}\n`);
  console.log(`wrote GPT repair patch: ${outPath}`);
  console.log(`operations: ${patch.length}`);
  if (args.validate) {
    const validation = spawnSync(process.execPath, [
      resolve(ROOT, 'scripts/apply-brochure-repair-patch.mjs'),
      '--bundle',
      bundleDir,
      '--patch',
      outPath,
      '--dry-run',
    ], { cwd: ROOT, encoding: 'utf8' });
    if (validation.stdout) process.stdout.write(validation.stdout);
    if (validation.stderr) process.stderr.write(validation.stderr);
    if (validation.status !== 0) process.exit(validation.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
