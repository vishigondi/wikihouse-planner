#!/usr/bin/env node
/**
 * Move manifest-archived paired artifacts out of active proposal folders.
 *
 * Archived artifacts remain addressable through proposal-manifest.json, but
 * active paired folders only contain the current working candidates. This keeps
 * the app and repair loop from accidentally treating stale generations, backup
 * snapshots, or debug traces as live evidence.
 */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LOOP_ROOT = resolve(ROOT, 'public/data/den-image-loop');
const MANIFEST_PATH = resolve(LOOP_ROOT, 'proposal-manifest.json');

const URL_FIELDS = [
  'imageUrl',
  'pairedJsonUrl',
  'deterministicRenderUrl',
  'pairedValidationUrl',
  'pairedVisualReviewUrl',
  'pairedVisualDriftUrl',
  'pairedDrawingStyleProfileUrl',
  'pairedRoofElevationUrl',
  'pairedRoofElevationValidationUrl',
  'semanticJsonUrl',
  'semanticSvgUrl',
];

function usage() {
  console.error([
    'usage:',
    '  node scripts/archive-stale-paired-artifacts.mjs [--dry-run]',
    '',
    'Moves files referenced by manifest entries with archived: true to archive/',
    'folders and rewrites those manifest URLs. Also moves stray paired JSON/style',
    'backups to paired/archive/backups/ and debug folders to paired/archive/debug/.',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else usage();
  }
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function archiveUrl(url) {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('archive/')) return url;
  const parts = url.split('/');
  if (parts.includes('archive')) return url;
  if (parts[0] === 'paired') return posix.join('paired', 'archive', ...parts.slice(1));
  if (parts[0] === 'chatgpt-handoff') {
    const file = parts.at(-1);
    return posix.join('chatgpt-handoff', 'archive', file);
  }
  return posix.join('archive', url);
}

async function moveIfPresent(planId, fromUrl, toUrl, dryRun) {
  if (!fromUrl || !toUrl || fromUrl === toUrl) return { moved: false, fromUrl, toUrl };
  const from = resolve(LOOP_ROOT, planId, fromUrl);
  const to = resolve(LOOP_ROOT, planId, toUrl);
  if (!existsSync(from)) {
    return { moved: false, missing: true, fromUrl, toUrl };
  }
  if (existsSync(to)) {
    if (!dryRun) {
      try {
        const [fromBytes, toBytes] = await Promise.all([readFile(from), readFile(to)]);
        if (Buffer.compare(fromBytes, toBytes) === 0) {
          await rm(from, { force: true });
          return { moved: false, removedDuplicate: true, fromUrl, toUrl };
        }
      } catch {
        // Directories or unreadable files should remain in place for manual review.
      }
    }
    return { moved: false, exists: true, fromUrl, toUrl };
  }
  if (!dryRun) {
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  }
  return { moved: true, fromUrl, toUrl };
}

async function moveBackups(planId, dryRun) {
  const pairedDir = resolve(LOOP_ROOT, planId, 'paired');
  if (!existsSync(pairedDir)) return [];
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(pairedDir, { withFileTypes: true });
  const moves = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/(\.bak-\d+|\.before-[^.]+(?:-.+)?|\.sweep-[^.]+(?:-.+)?|\.sweep-runtime-bak)$/.test(entry.name)) continue;
    const fromUrl = posix.join('paired', entry.name);
    const toUrl = posix.join('paired', 'archive', 'backups', entry.name);
    moves.push(await moveIfPresent(planId, fromUrl, toUrl, dryRun));
  }
  return moves;
}

async function moveDebugDirs(planId, dryRun) {
  const pairedDir = resolve(LOOP_ROOT, planId, 'paired');
  if (!existsSync(pairedDir)) return [];
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(pairedDir, { withFileTypes: true });
  const moves = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue;
    if (!/(debug|visual-drift)/i.test(entry.name)) continue;
    const fromUrl = posix.join('paired', entry.name);
    const toUrl = posix.join('paired', 'archive', 'debug', entry.name);
    moves.push(await moveIfPresent(planId, fromUrl, toUrl, dryRun));
  }
  return moves;
}

async function main() {
  const args = parseArgs(process.argv);
  const manifest = await readJson(MANIFEST_PATH);
  const moves = [];
  let manifestChanged = false;

  for (const [planId, options] of Object.entries(manifest.plans ?? {})) {
    for (const option of options) {
      if (!option?.archived) continue;
      for (const field of URL_FIELDS) {
        const current = option[field];
        const archived = archiveUrl(current);
        if (!archived || archived === current) continue;
        const result = await moveIfPresent(planId, current, archived, args.dryRun);
        moves.push({ planId, proposalId: option.id, field, ...result });
        option[field] = archived;
        manifestChanged = true;
      }
    }
    for (const result of await moveBackups(planId, args.dryRun)) {
      moves.push({ planId, proposalId: 'backup', field: 'backup', ...result });
    }
    for (const result of await moveDebugDirs(planId, args.dryRun)) {
      moves.push({ planId, proposalId: 'debug', field: 'debug', ...result });
    }
  }

  if (manifestChanged && !args.dryRun) {
    manifest.generatedAt = new Date().toISOString();
    await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const moved = moves.filter((move) => move.moved).length;
  const removedDuplicate = moves.filter((move) => move.removedDuplicate).length;
  const missing = moves.filter((move) => move.missing).length;
  const existing = moves.filter((move) => move.exists).length;
  console.log(`${args.dryRun ? 'archive dry run' : 'archive complete'}: ${moved} moved, ${removedDuplicate} duplicate(s) removed, ${existing} already archived, ${missing} missing`);
  for (const move of moves.filter((item) => item.moved).slice(0, 80)) {
    console.log(`${move.planId}/${move.proposalId} ${move.field}: ${move.fromUrl} -> ${move.toUrl}`);
  }
  if (moves.filter((item) => item.moved).length > 80) {
    console.log(`... ${moves.filter((item) => item.moved).length - 80} more move(s)`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
