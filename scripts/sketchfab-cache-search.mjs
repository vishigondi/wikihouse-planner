#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
const query = process.argv.slice(2).join(' ').trim();

if (!query) {
  console.error('usage: SKETCHFAB_TOKEN=... npm run bim:sketchfab -- "low poly sofa"');
  process.exit(1);
}

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, 'public/data/bim-components/providers/sketchfab');
const encoded = new URLSearchParams({
  type: 'models',
  q: query,
  downloadable: 'true',
  archives_flavours: 'true',
  sort_by: '-likeCount',
});

const headers = token ? { Authorization: `Token ${token}` } : {};
const response = await fetch(`https://api.sketchfab.com/v3/search?${encoded}`, { headers });
if (!response.ok) {
  console.error(`Sketchfab search failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const data = await response.json();
const models = (data.results ?? []).slice(0, 12).map((model) => ({
  uid: model.uid,
  name: model.name,
  user: model.user?.displayName ?? model.user?.username,
  viewerUrl: model.viewerUrl,
  license: model.license?.label ?? model.license,
  isDownloadable: model.isDownloadable,
  likeCount: model.likeCount,
  faceCount: model.faceCount,
  vertexCount: model.vertexCount,
  thumbnails: model.thumbnails?.images?.slice(0, 3).map((item) => ({
    width: item.width,
    height: item.height,
    url: item.url,
  })) ?? [],
  source: 'sketchfab',
  geometryAuthority: 'semantic-json',
  status: 'candidate',
}));

await fs.mkdir(outputDir, { recursive: true });
const safeQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outputFile = path.join(outputDir, `${safeQuery || 'query'}.search.json`);
await fs.writeFile(outputFile, `${JSON.stringify({
  schemaVersion: 'sketchfab_search_cache_v1',
  generatedAt: new Date().toISOString(),
  query,
  tokenUsed: Boolean(token),
  models,
}, null, 2)}\n`);

console.log(`cached ${models.length} Sketchfab candidate(s) -> ${path.relative(repoRoot, outputFile)}`);
console.log('No model archives were downloaded. Download/ingest should be a separate license-reviewed step.');
