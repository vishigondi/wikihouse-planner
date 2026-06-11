#!/usr/bin/env node
/**
 * Ingest a ChatGPT repair response into a bundle-local patch.json.
 *
 * The prompt asks GPT for JSON only, but web responses may still include
 * markdown fences or short prose. This helper extracts the first JSON Patch
 * array, writes it as patch.json, and validates scope with repair:apply
 * dry-run. It does not mutate paired JSON.
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');

function usage() {
  console.error([
    'usage:',
    '  npm run repair:ingest -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --response response.txt',
    '',
    'options:',
    '  --bundle <dir>      repair bundle folder containing upload-manifest.json',
    '  --response <path>   copied GPT response text or JSON patch file',
    '  --latest-download   use the newest likely GPT repair response from ~/Downloads',
    '  --out <path>        output patch path, default: <bundle>/patch.json',
    '  --no-validate       skip repair:apply --dry-run validation',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = { validate: true };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--bundle') args.bundle = argv[++index];
    else if (arg === '--response') args.response = argv[++index];
    else if (arg === '--latest-download') args.latestDownload = true;
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--no-validate') args.validate = false;
    else usage();
  }
  if (!args.bundle || (!args.response && !args.latestDownload)) usage();
  return args;
}

async function latestDownloadResponse() {
  const downloads = resolve(homedir(), 'Downloads');
  const entries = await readdir(downloads, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!/\.(json|txt|md)$/i.test(name)) continue;
    if (!/(patch|repair|response|chatgpt|floorplan|gpt)/i.test(name)) continue;
    const path = resolve(downloads, name);
    const info = await stat(path);
    candidates.push({ path, mtimeMs: info.mtimeMs, size: info.size });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const candidate of candidates) {
    if (candidate.size <= 0 || candidate.size > 2_000_000) continue;
    try {
      extractJsonPatch(await readFile(candidate.path, 'utf8'));
      return candidate.path;
    } catch {
      // Try the next likely download.
    }
  }
  throw new Error('No valid JSON Patch response found in ~/Downloads. Use --response <path> instead.');
}

function validatePatch(patch) {
  if (!Array.isArray(patch)) throw new Error('response did not contain a JSON Patch array');
  for (const [index, operation] of patch.entries()) {
    if (!operation || typeof operation !== 'object') throw new Error(`operation ${index} is not an object`);
    if (!['add', 'remove', 'replace', 'test'].includes(operation.op)) throw new Error(`operation ${index} has unsupported op: ${operation.op}`);
    if (typeof operation.path !== 'string' || !operation.path.startsWith('/')) throw new Error(`operation ${index} is missing an absolute JSON pointer path`);
    if (operation.op !== 'remove' && operation.op !== 'test' && !Object.prototype.hasOwnProperty.call(operation, 'value')) {
      throw new Error(`operation ${index} is missing value`);
    }
  }
  return patch;
}

function parseCandidate(candidate) {
  return validatePatch(JSON.parse(candidate));
}

function extractJsonPatch(text) {
  const trimmed = text.trim();
  try {
    return parseCandidate(trimmed);
  } catch {
    // keep trying below
  }

  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fenced) {
    try {
      return parseCandidate(match[1].trim());
    } catch {
      // try next fence
    }
  }

  const start = trimmed.indexOf('[');
  if (start === -1) throw new Error('response did not contain a JSON array');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '[') depth += 1;
    if (char === ']') {
      depth -= 1;
      if (depth === 0) return parseCandidate(trimmed.slice(start, index + 1));
    }
  }
  throw new Error('response JSON array was not closed');
}

async function main() {
  const args = parseArgs(process.argv);
  const bundle = resolve(args.bundle);
  const responsePath = args.response ? resolve(args.response) : await latestDownloadResponse();
  const responseText = await readFile(responsePath, 'utf8');
  const patch = extractJsonPatch(responseText);
  const outPath = resolve(args.out || resolve(bundle, 'patch.json'));
  await writeFile(outPath, `${JSON.stringify(patch, null, 2)}\n`);
  console.log(`ingested response: ${responsePath}`);
  console.log(`wrote ${patch.length} JSON Patch operation${patch.length === 1 ? '' : 's'} to ${outPath}`);
  if (args.validate) {
    const dryRun = spawnSync(process.execPath, [
      resolve(ROOT, 'scripts/apply-brochure-repair-patch.mjs'),
      '--bundle',
      bundle,
      '--patch',
      outPath,
      '--dry-run',
    ], { cwd: ROOT, encoding: 'utf8' });
    if (dryRun.stdout) process.stdout.write(dryRun.stdout);
    if (dryRun.stderr) process.stderr.write(dryRun.stderr);
    if (dryRun.status !== 0) process.exit(dryRun.status ?? 1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
