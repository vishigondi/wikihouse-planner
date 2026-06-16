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
const { isLookId, lookRenderAssetPath, lookRenderManifestFields, lookRenderSpecFromArtifact, expectedStructureFromSpec } = await import(join(root, 'lib/look-render.ts'));

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

// expectedStructure is DERIVED from the same paired JSON the deterministic
// 3D/elevations are drawn from — never a free-form flag — so the recorded
// structure can never disagree with the plan's actual compiled geometry.
if (!option.pairedJsonUrl) fail(`plan ${planId} option ${option.id} has no pairedJsonUrl — cannot derive expectedStructure`);
const pairedPath = join(LOOP_ROOT, planId, option.pairedJsonUrl);
let paired;
try {
  paired = JSON.parse(await readFile(pairedPath, 'utf8'));
} catch (error) {
  fail(`could not read paired JSON at ${option.pairedJsonUrl}: ${error.message ?? error}`);
}
const spec = lookRenderSpecFromArtifact(paired);
if (!spec.roofStyle || !(spec.widthFt > 0) || !(spec.depthFt > 0)) {
  fail(`paired JSON for ${planId} did not yield valid geometry (roof ${spec.roofStyle}, ${spec.widthFt}x${spec.depthFt})`);
}
const expectedStructure = expectedStructureFromSpec(spec);

// The stored extension follows the actual image bytes (JPEG marketing renders
// are ~7x smaller than PNG). Dry-run has no image, so it reports the png default.
function imageExt(img) {
  if (!img) return 'png';
  if (img.startsWith('data:')) {
    const mime = img.slice(5, img.indexOf(';') >= 0 ? img.indexOf(';') : img.indexOf(','));
    return mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
  }
  const m = img.toLowerCase().match(/\.(jpe?g|png|webp)$/);
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : 'png';
}

const ext = imageExt(image);
const relUrl = lookRenderAssetPath(planId, look, ext);
const fields = lookRenderManifestFields(look, relUrl, expectedStructure);

if (dryRun) {
  // Validate + show the patch (incl. derived expectedStructure) without reading
  // the image or writing anything.
  console.log(JSON.stringify({ planId, option: option.id, patch: fields, expectedStructure, touchesDeterministic: false }, null, 2));
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
