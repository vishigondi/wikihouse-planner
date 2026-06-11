#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

async function localEnvValue(name) {
  if (process.env[name]) return process.env[name];
  try {
    const envText = await fs.readFile(path.join(process.cwd(), '.env.local'), 'utf8');
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

const token = await localEnvValue('SKETCHFAB_TOKEN');
const uid = process.argv[2];
const label = process.argv.slice(3).join(' ').trim();

if (!token) {
  console.error('SKETCHFAB_TOKEN is required. Set it in your shell or .env.local, not in source code.');
  process.exit(1);
}

if (!uid) {
  console.error('usage: SKETCHFAB_TOKEN=... npm run bim:sketchfab:download -- <model-uid> [label]');
  process.exit(1);
}

const repoRoot = process.cwd();
const modelDir = path.join(repoRoot, 'public/data/bim-components/providers/sketchfab/models', uid);
const archiveFile = path.join(modelDir, 'source-gltf.zip');
const extractDir = path.join(modelDir, 'gltf');
const manifestFile = path.join(modelDir, 'manifest.json');

const response = await fetch(`https://api.sketchfab.com/v3/models/${uid}/download`, {
  headers: { Authorization: `Token ${token}` },
});
if (!response.ok) {
  console.error(`Sketchfab download lookup failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const data = await response.json();
const gltfUrl = data.gltf?.url;
if (!gltfUrl) {
  console.error('Sketchfab model does not expose a glTF archive URL.');
  process.exit(1);
}

await fs.mkdir(modelDir, { recursive: true });
const archiveResponse = await fetch(gltfUrl);
if (!archiveResponse.ok) {
  console.error(`Sketchfab glTF archive download failed: ${archiveResponse.status} ${archiveResponse.statusText}`);
  process.exit(1);
}
await fs.writeFile(archiveFile, Buffer.from(await archiveResponse.arrayBuffer()));
await fs.rm(extractDir, { recursive: true, force: true });
await fs.mkdir(extractDir, { recursive: true });
const unzip = spawnSync('unzip', ['-o', '-q', archiveFile, '-d', extractDir], { encoding: 'utf8' });
if (unzip.status !== 0) {
  console.error(unzip.stderr || 'unzip failed');
  process.exit(unzip.status ?? 1);
}

const files = await fs.readdir(extractDir, { recursive: true });
const gltfFiles = files.filter((file) => String(file).toLowerCase().endsWith('.gltf') || String(file).toLowerCase().endsWith('.glb'));
const manifest = {
  schemaVersion: 'sketchfab_cached_model_v1',
  cachedAt: new Date().toISOString(),
  uid,
  label: label || uid,
  source: 'sketchfab',
  geometryAuthority: 'semantic-json',
  archiveFile: `/data/bim-components/providers/sketchfab/models/${uid}/source-gltf.zip`,
  extractedDir: `/data/bim-components/providers/sketchfab/models/${uid}/gltf`,
  entrypoints: gltfFiles.map((file) => `/data/bim-components/providers/sketchfab/models/${uid}/gltf/${String(file).split(path.sep).join('/')}`),
  notes: [
    'Cached visual asset only. Semantic paired JSON remains geometry authority.',
    'Before production use, validate license, polygon count, scale normalization, and category fit.',
  ],
};
await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`cached Sketchfab glTF model ${uid} -> ${path.relative(repoRoot, manifestFile)}`);
