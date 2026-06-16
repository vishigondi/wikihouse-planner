// Import a ChatGPT-browser "look render" as a labeled illustrative asset.
//
// The render is made in the ChatGPT browser (no API key) and downloaded; this
// copies it next to the plan and adds the lookRender* manifest fields (always
// flagged illustrative). It ONLY adds those fields — the deterministic render,
// paired JSON, and sourceKind are never touched, so the dimensioned drawing
// stays the source of truth.
//
// Usage:
//   npm run lookrender:import -- --plan gen-001 --image <path|dataURL> --look earthy
//   npm run lookrender:import -- --plan gen-001 --look earthy --dry-run   (validate only)

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { isLookId, lookRenderAssetPath, lookRenderManifestFields } = await import(join(root, 'lib/look-render.ts'));

const LOOP_ROOT = join(root, 'public', 'data', 'den-image-loop');
const MANIFEST_PATH = join(LOOP_ROOT, 'proposal-manifest.json');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

function fail(msg) {
  console.error(`lookrender:import — ${msg}`);
  process.exit(1);
}

const planId = arg('plan');
const look = arg('look');
const image = arg('image');
const dryRun = has('dry-run');

if (!planId) fail('--plan <id> is required');
if (!look || !isLookId(look)) fail(`--look must be one of the named looks (got ${look ?? 'none'})`);

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
const options = manifest.plans?.[planId];
if (!Array.isArray(options) || !options.length) fail(`plan ${planId} not found in the manifest`);
const option = options.find((o) => o.latestPairedArtifact) ?? options[options.length - 1];

const relUrl = lookRenderAssetPath(planId, look);
const fields = lookRenderManifestFields(look, relUrl);

if (dryRun) {
  // Validate + show the patch without reading the image or writing anything.
  console.log(JSON.stringify({ planId, option: option.id, patch: fields, touchesDeterministic: false }, null, 2));
  process.exit(0);
}

if (!image) fail('--image <path|dataURL> is required (or pass --dry-run)');

const destAbs = join(LOOP_ROOT, planId, relUrl);
await mkdir(dirname(destAbs), { recursive: true });
if (image.startsWith('data:')) {
  const base64 = image.slice(image.indexOf(',') + 1);
  await writeFile(destAbs, Buffer.from(base64, 'base64'));
} else {
  const src = isAbsolute(image) ? image : resolve(process.cwd(), image);
  await copyFile(src, destAbs);
}

// Add ONLY the lookRender* fields; leave everything else byte-identical.
Object.assign(option, fields);
await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`lookrender:import — stored ${relUrl} for ${planId} (look: ${look}, illustrative)`);
