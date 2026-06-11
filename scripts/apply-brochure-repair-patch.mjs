#!/usr/bin/env node
/**
 * Apply one scoped GPT JSON Patch from a brochure repair packet.
 *
 * This intentionally does not call GPT. The app/codebase remains the validator
 * and orchestrator: GPT returns a narrow RFC 6902 patch, this script validates
 * the patch scope against the packet, applies it to the paired artifact JSON,
 * and records repair history so drift must be recomputed before promotion.
 */

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

function usage() {
  console.error([
    'usage:',
    '  node scripts/apply-brochure-repair-patch.mjs --packet artifacts/brochure-qa/a-frame-bunk-brochure-repair-packet.json --layer walls --patch /tmp/patch.json',
    '',
    'options:',
    '  --bundle <dir>    repair bundle folder containing upload-manifest.json',
    '  --packet <path>   brochure_repair_packet_v1 JSON from npm run qa:brochure',
    '  --layer <name>    repair layer from packet.reports[].layer',
    '  --patch <path>    RFC 6902 JSON Patch array returned by GPT',
    '  --result <path>   optional JSON result manifest path',
    '  --dry-run         validate and preview without writing',
  ].join('\n'));
  process.exit(2);
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--bundle') {
      args.bundle = argv[++index];
    } else if (arg === '--packet') {
      args.packet = argv[++index];
    } else if (arg === '--layer') {
      args.layer = argv[++index];
    } else if (arg === '--patch') {
      args.patch = argv[++index];
    } else if (arg === '--result') {
      args.result = argv[++index];
    } else {
      usage();
    }
  }
  if (!args.patch || (!args.bundle && (!args.packet || !args.layer))) usage();
  return args;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function startsWithPointer(path, prefix) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isSourceAnchorEvidencePath(path) {
  return startsWithPointer(path, '/sourceAnchors')
    || /^\/floorPanels\/(?:\d+|-)\/sourceAnchors(?:\/|$)/.test(path);
}

function isFloorPanelPath(path) {
  return startsWithPointer(path, '/floorPanels');
}

function decodePointer(path) {
  if (!path.startsWith('/')) throw new Error(`JSON Patch path must start with "/": ${path}`);
  return path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAtPath(target, path) {
  if (path === '') return target;
  let current = target;
  for (const part of decodePointer(path)) {
    if (current == null || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? current[Number(part)] : current[part];
  }
  return current;
}

function setAtPath(target, path, value, add) {
  const parts = decodePointer(path);
  const key = parts.pop();
  if (key === undefined) throw new Error('Cannot patch empty JSON pointer');
  let parent = target;
  for (const part of parts) {
    if (parent == null || typeof parent !== 'object') throw new Error(`Cannot traverse ${path}`);
    parent = Array.isArray(parent) ? parent[Number(part)] : parent[part];
  }
  if (parent == null || typeof parent !== 'object') throw new Error(`Cannot patch ${path}`);
  if (Array.isArray(parent)) {
    if (key === '-') {
      if (!add) throw new Error('"-" array path is only valid for add');
      parent.push(value);
      return;
    }
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid array index in ${path}`);
    if (add) parent.splice(index, 0, value);
    else parent[index] = value;
    return;
  }
  parent[key] = value;
}

function removeAtPath(target, path) {
  const parts = decodePointer(path);
  const key = parts.pop();
  if (key === undefined) throw new Error('Cannot patch empty JSON pointer');
  let parent = target;
  for (const part of parts) {
    if (parent == null || typeof parent !== 'object') throw new Error(`Cannot traverse ${path}`);
    parent = Array.isArray(parent) ? parent[Number(part)] : parent[part];
  }
  if (parent == null || typeof parent !== 'object') throw new Error(`Cannot remove ${path}`);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) throw new Error(`Invalid array index in ${path}`);
    parent.splice(index, 1);
    return;
  }
  delete parent[key];
}

function parsePatch(raw) {
  if (!Array.isArray(raw)) throw new Error('GPT response must be an RFC 6902 JSON Patch array');
  return raw.map((operation, index) => {
    if (!operation || typeof operation !== 'object') throw new Error(`operation ${index} is not an object`);
    if (!['add', 'remove', 'replace', 'test'].includes(operation.op)) throw new Error(`operation ${index} has unsupported op ${operation.op}`);
    if (typeof operation.path !== 'string') throw new Error(`operation ${index} is missing path`);
    return operation;
  });
}

function validateScope(operations, report) {
  const errors = [];
  const primitivePatchRoots = Array.isArray(report.allowedPrimitivePatchPaths)
    ? report.allowedPrimitivePatchPaths
    : Array.isArray(report.primitiveRepairTargets?.[0]?.jsonPointers)
      ? report.primitiveRepairTargets[0].jsonPointers
      : [];
  const styleNumber = (value, path) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      errors.push(`${path}: must be a finite number`);
      return null;
    }
    return value;
  };
  const setNested = (target, parts, value) => {
    let current = target;
    for (const part of parts.slice(0, -1)) {
      current[part] ??= {};
      current = current[part];
    }
    current[parts[parts.length - 1]] = value;
  };
  const transparentText = (value) => typeof value === 'string' && /rgba\([^)]*,\s*0(?:\.0+)?\)|transparent/i.test(value);
  const embeddedSourceAnchorRoots = new Set();
  const semanticGeometryRoots = new Set();
  const dimensionSourceAnchorRoots = new Set();
  const dimensionGeometryRoots = new Set();
  const embeddedSemanticRoot = (path) => {
    const match = path.match(/^\/(fixtures|doors|windows|openings)\/(?:\d+|-)(?:\/|$)/);
    return match ? path.split('/').slice(0, 3).join('/') : null;
  };
  const dimensionRoot = (path) => {
    const match = path.match(/^\/dimensionLines\/(?:\d+|-)(?:\/|$)/);
    return match ? path.split('/').slice(0, 3).join('/') : null;
  };
  const isEmbeddedSourceAnchorPatch = (path) => /^\/(fixtures|doors|windows|openings)\/(?:\d+|-)\/sourceAnchor(?:\/|$)/.test(path);
  const isSemanticGeometryPatch = (path) => {
    const root = embeddedSemanticRoot(path);
    if (!root) return false;
    if (isEmbeddedSourceAnchorPatch(path)) return false;
    if (path === `${root}/sourceAnchorId`) return false;
    return true;
  };
  const isDimensionSourceAnchorPatch = (path) => /^\/dimensionLines\/(?:\d+|-)\/sourceAnchor(?:\/|$)/.test(path);
  const isDimensionGeometryPatch = (path) => {
    const root = dimensionRoot(path);
    if (!root) return false;
    if (isDimensionSourceAnchorPatch(path)) return false;
    return /\/(?:span|from|to|textAnchor|label|value|orientation|floor)(?:\/|$)/.test(path)
      || path === root;
  };
  const validateDrawingRules = (rules, path) => {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) {
      errors.push(`${path}: drawing style rules must be an object`);
      return;
    }
    const minOpacity = [
      ['walls.exteriorOpacity', 0.45],
      ['walls.interiorOpacity', 0.35],
      ['windows.opacity', 0.35],
      ['doors.opacity', 0.35],
      ['fixtures.opacity', 0.35],
      ['stairs.opacity', 0.35],
      ['voids.opacity', 0.25],
      ['dimensions.opacity', 0.35],
      ['callouts.opacity', 0.6],
    ];
    for (const [key, min] of minOpacity) {
      const value = key.split('.').reduce((acc, part) => acc?.[part], rules);
      if (value == null) continue;
      const numeric = styleNumber(value, `${path}/${key.replaceAll('.', '/')}`);
      if (numeric != null && numeric < min) {
        errors.push(`${path}/${key.replaceAll('.', '/')}: ${numeric} hides a visible brochure layer; use a source-matching style, not opacity masking`);
      }
    }
    const minStroke = [
      ['walls.exteriorStrokeWidthPx', 0.6],
      ['walls.exteriorBackingStrokeWidthPx', 3],
      ['walls.interiorStrokeWidthPx', 0.45],
      ['windows.strokeWidthPx', 0.45],
      ['doors.leafStrokeWidthPx', 0.45],
      ['doors.arcStrokeWidthPx', 0.4],
      ['fixtures.strokeWidthPx', 0.45],
      ['stairs.strokeWidthPx', 0.45],
      ['voids.strokeWidthPx', 0.4],
      ['dimensions.strokeWidthPx', 0.4],
    ];
    for (const [key, min] of minStroke) {
      const value = key.split('.').reduce((acc, part) => acc?.[part], rules);
      if (value == null) continue;
      const numeric = styleNumber(value, `${path}/${key.replaceAll('.', '/')}`);
      if (numeric != null && numeric < min) {
        errors.push(`${path}/${key.replaceAll('.', '/')}: ${numeric} is too small for brochure-visible primitives`);
      }
    }
    if (transparentText(rules.labels?.fill)) {
      errors.push(`${path}/labels/fill: labels include visible floor titles/callouts; do not make label text transparent`);
    }
    if (transparentText(rules.fixtures?.fill) && rules.fixtures?.fillOpacity === 0) {
      errors.push(`${path}/fixtures/fill: fixture fills may be light, but must not be explicitly hidden with fillOpacity 0`);
    }
  };
  for (const operation of operations) {
    const semanticRoot = embeddedSemanticRoot(operation.path);
    if (semanticRoot && isEmbeddedSourceAnchorPatch(operation.path)) embeddedSourceAnchorRoots.add(semanticRoot);
    if (semanticRoot && isSemanticGeometryPatch(operation.path)) semanticGeometryRoots.add(semanticRoot);
    const dimRoot = dimensionRoot(operation.path);
    if (dimRoot && isDimensionSourceAnchorPatch(operation.path)) dimensionSourceAnchorRoots.add(dimRoot);
    if (dimRoot && isDimensionGeometryPatch(operation.path)) dimensionGeometryRoots.add(dimRoot);
    const allowed = report.allowedPatchPaths.some((prefix) => startsWithPointer(operation.path, prefix));
    const blocked = report.blockedPatchPaths.some((prefix) => startsWithPointer(operation.path, prefix));
    if (!allowed) errors.push(`${operation.op} ${operation.path}: outside allowed paths for ${report.layer}`);
    if (blocked) errors.push(`${operation.op} ${operation.path}: touches blocked path for ${report.layer}`);
    if (primitivePatchRoots.length && !primitivePatchRoots.some((prefix) => startsWithPointer(operation.path, prefix))) {
      errors.push(`${operation.op} ${operation.path}: outside primitive-specific repair target (${primitivePatchRoots.join(', ')})`);
    }
    if (isFloorPanelPath(operation.path) && !['source primitives', 'level frames', 'dimensions', 'semantic rebuild'].includes(report.layer)) {
      errors.push(`${operation.op} ${operation.path}: floor panel/frame data can only be patched by source primitives, level frames, or dimensions layers`);
    }
    if (isSourceAnchorEvidencePath(operation.path) && !['source primitives', 'semantic rebuild'].includes(report.layer)) {
      errors.push(`${operation.op} ${operation.path}: source image anchor evidence can only be patched by the dedicated source primitives layer`);
    }
    if (startsWithPointer(operation.path, '/sourceWalls') && !['walls', 'source primitive overrides', 'semantic rebuild'].includes(report.layer)) {
      errors.push(`${operation.op} ${operation.path}: source wall override channels can only be patched by walls, source primitive overrides, or semantic rebuild layers`);
    }
    if (startsWithPointer(operation.path, '/sourceOpenings') && !['source primitive overrides', 'semantic rebuild'].includes(report.layer)) {
      errors.push(`${operation.op} ${operation.path}: source opening override channels can only be patched by the dedicated source primitive overrides layer`);
    }
    if (operation.op === 'remove' && /^\/rooms\/\d+$/.test(operation.path)) errors.push(`${operation.path}: deleting whole rooms is not allowed`);
    if (operation.op === 'remove' && /^\/(exteriorWalls|interiorWalls)\/\d+$/.test(operation.path) && report.layer !== 'walls') {
      errors.push(`${operation.path}: deleting walls requires wall repair layer`);
    }
    if (operation.op === 'remove' && /^\/sourceWalls\/\d+$/.test(operation.path) && !['walls', 'source primitive overrides', 'semantic rebuild'].includes(report.layer)) {
      errors.push(`${operation.path}: deleting source wall overrides requires wall or source primitive overrides layer`);
    }
    if (report.layer === 'dimensions') {
      if (operation.op === 'remove' && operation.path === '/dimensionLines') {
        errors.push(`${operation.path}: deleting all dimension lines hides a visible brochure layer; repair dimension geometry instead`);
      }
      if ((operation.op === 'add' || operation.op === 'replace') && operation.path === '/dimensionLines' && Array.isArray(operation.value) && operation.value.length === 0) {
        errors.push(`${operation.path}: replacing dimensionLines with [] hides a visible brochure layer; keep source-visible dimensions and repair their spans/style`);
      }
    }
    if (operation.op !== 'remove' && !Object.prototype.hasOwnProperty.call(operation, 'value') && operation.op !== 'test') {
      errors.push(`${operation.op} ${operation.path}: missing value`);
    }
    if ((operation.op === 'add' || operation.op === 'replace') && operation.path === '/sourceWalls') {
      if (!Array.isArray(operation.value)) {
        errors.push(`${operation.op} ${operation.path}: value must be an array of source wall override segments`);
      } else {
        for (const [index, wall] of operation.value.entries()) {
          if (!wall || typeof wall !== 'object') {
            errors.push(`${operation.op} ${operation.path}/${index}: source wall item must be an object`);
            continue;
          }
          const id = typeof wall.id === 'string' ? wall.id : '';
          const sourceAnchorId = typeof wall.sourceAnchorId === 'string' ? wall.sourceAnchorId : '';
          for (const field of ['id', 'floor', 'x1', 'z1', 'x2', 'z2', 'exterior', 'wallKind', 'sourceAnchorId']) {
            if (!Object.prototype.hasOwnProperty.call(wall, field)) {
              errors.push(`${operation.op} ${operation.path}/${index}: missing required source wall field ${field}`);
            }
          }
          if (id.includes(':seg-') && sourceAnchorId !== id) {
            errors.push(`${operation.op} ${operation.path}/${index}: segmented source wall "${id}" must use the segment id as sourceAnchorId, not parent "${sourceAnchorId}"`);
          }
          for (const field of ['x1', 'z1', 'x2', 'z2']) {
            if (typeof wall[field] !== 'number' || !Number.isFinite(wall[field])) {
              errors.push(`${operation.op} ${operation.path}/${index}: ${field} must be a finite grid-unit number`);
            }
          }
        }
      }
    }
    if (report.layer === 'drawing style profile' && (operation.op === 'add' || operation.op === 'replace')) {
      if (operation.path === '/rules') {
        validateDrawingRules(operation.value, operation.path);
      } else if (operation.path.startsWith('/rules/')) {
        const patchedRoot = {};
        setNested(patchedRoot, decodePointer(operation.path), operation.value);
        validateDrawingRules(patchedRoot.rules, '/rules');
      }
    }
  }
  for (const root of embeddedSourceAnchorRoots) {
    if (!semanticGeometryRoots.has(root) && !['source primitive overrides', 'source primitives', 'semantic rebuild'].includes(report.layer)) {
      errors.push(`${root}/sourceAnchor: embedded source-anchor evidence cannot be patched by itself; change rendered semantic geometry in the same element or use the source primitive overrides layer`);
    }
  }
  if (report.layer === 'dimensions') {
    for (const root of dimensionSourceAnchorRoots) {
      if (!dimensionGeometryRoots.has(root)) {
        errors.push(`${root}/sourceAnchor: dimension source-anchor evidence cannot be patched by itself; change the rendered dimension span/from/to/textAnchor/label/value/orientation in the same element or return [] for renderer-only drift`);
      }
    }
  }
  return errors;
}

function applyPatch(target, operations) {
  const next = JSON.parse(JSON.stringify(target));
  for (const operation of operations) {
    if (operation.op === 'test') {
      const current = getAtPath(next, operation.path);
      if (JSON.stringify(current) !== JSON.stringify(operation.value)) {
        throw new Error(`test failed at ${operation.path}`);
      }
      continue;
    }
    if (operation.op === 'remove') removeAtPath(next, operation.path);
    else setAtPath(next, operation.path, operation.value, operation.op === 'add');
  }
  return next;
}

function repairId(packet, report) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `repair-${packet.planId}-${String(report.layer).replace(/[^a-z0-9]+/gi, '-')}-${stamp}`;
}

async function main() {
  const args = parseArgs(process.argv);
  let bundleLayerReport = null;
  if (args.bundle) {
    const bundleDir = resolve(args.bundle);
    const bundleManifest = await readJson(resolve(bundleDir, 'upload-manifest.json'));
    args.packet ||= bundleManifest.packet;
    args.layer ||= bundleManifest.layer;
    bundleLayerReport = await readJson(resolve(bundleDir, 'layer-report.json')).catch(() => null);
    if (!args.packet || !args.layer) throw new Error(`Bundle ${args.bundle} is missing packet or layer in upload-manifest.json`);
  }
  const packetPath = resolve(args.packet);
  const patchPath = resolve(args.patch);
  const packet = await readJson(packetPath);
  if (packet.artifactVersion !== 'brochure_repair_packet_v1') throw new Error(`Unsupported packet version: ${packet.artifactVersion}`);
  const packetReport = packet.reports?.find((item) => item.layer === args.layer);
  const report = bundleLayerReport?.layer === args.layer
    ? { ...packetReport, ...bundleLayerReport }
    : packetReport;
  if (!report) throw new Error(`Layer "${args.layer}" was not found in ${packetPath}`);
  const operations = parsePatch(await readJson(patchPath));
  const errors = validateScope(operations, report);
  if (errors.length) {
    console.error('repair patch rejected:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  if (operations.length === 0) {
    console.log(`repair patch is an explicit no-op for ${packet.planId}/${packet.proposalId} layer "${report.layer}"`);
    console.log('no files changed');
    if (args.result) {
      await writeFile(resolve(args.result), `${JSON.stringify({
        status: 'noop',
        planId: packet.planId,
        proposalId: packet.proposalId,
        layer: report.layer,
        operationCount: 0,
        targetJson: resolve(report.layer === 'drawing style profile' ? packet.drawingStyleProfile : packet.pairedJson),
      }, null, 2)}\n`);
    }
    return;
  }

  const targetPath = report.layer === 'drawing style profile' ? packet.drawingStyleProfile : packet.pairedJson;
  if (!targetPath) throw new Error(`Repair packet does not include a target JSON file for layer "${report.layer}"`);
  const resolvedTargetPath = resolve(targetPath);
  const artifact = await readJson(resolvedTargetPath);
  const next = applyPatch(artifact, operations);
  const id = repairId(packet, report);
  next.repairHistory = [
    ...Array.isArray(next.repairHistory) ? next.repairHistory : [],
    {
      id,
      appliedAt: new Date().toISOString(),
      layer: report.layer,
      packet: basename(packetPath),
      patch: basename(patchPath),
      operationCount: operations.length,
      note: 'Applied scoped GPT JSON Patch. Visual drift must be recomputed before brochure promotion.',
    },
  ];
  next.patchState = {
    ...(next.patchState && typeof next.patchState === 'object' ? next.patchState : {}),
    lastAppliedRepairId: id,
    visualDriftStale: true,
    requiresRenderRegeneration: true,
  };

  if (args.dryRun) {
    console.log(`repair patch accepted for ${packet.planId}/${packet.proposalId} layer "${report.layer}" (${operations.length} operations)`);
    console.log(`dry-run only; would update ${resolvedTargetPath}`);
    if (args.result) {
      await writeFile(resolve(args.result), `${JSON.stringify({
        status: 'dry-run',
        planId: packet.planId,
        proposalId: packet.proposalId,
        layer: report.layer,
        operationCount: operations.length,
        targetJson: resolvedTargetPath,
      }, null, 2)}\n`);
    }
    return;
  }

  const backupPath = `${resolvedTargetPath}.bak-${Date.now()}`;
  await copyFile(resolvedTargetPath, backupPath);
  await writeFile(resolvedTargetPath, `${JSON.stringify(next, null, 2)}\n`);
  if (args.result) {
    await writeFile(resolve(args.result), `${JSON.stringify({
      status: 'applied',
      repairId: id,
      planId: packet.planId,
      proposalId: packet.proposalId,
      layer: report.layer,
      operationCount: operations.length,
      targetJson: resolvedTargetPath,
      backup: backupPath,
    }, null, 2)}\n`);
  }
  console.log(`repair patch applied: ${id}`);
  console.log(`updated: ${resolvedTargetPath}`);
  console.log(`backup:  ${backupPath}`);
  console.log('next: regenerate deterministic render/visual drift, rebuild app, then run npm run qa:brochure');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
