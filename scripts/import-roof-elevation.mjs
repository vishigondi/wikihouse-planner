#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_ROOT = path.join(ROOT, 'public/data/den-image-loop');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function fail(message) {
  console.error(`paired:roof failed: ${message}`);
  process.exit(1);
}

function validateRoofArtifact(roofArtifact, pairedArtifact) {
  const blockers = [];
  if (roofArtifact.schemaVersion !== 'paired_roof_elevation_v1') blockers.push(`unexpected schemaVersion ${roofArtifact.schemaVersion}`);
  if (roofArtifact.planId !== pairedArtifact.planId) blockers.push(`planId mismatch ${roofArtifact.planId} vs ${pairedArtifact.planId}`);
  if (roofArtifact.proposalId !== pairedArtifact.proposalId) blockers.push(`proposalId mismatch ${roofArtifact.proposalId} vs ${pairedArtifact.proposalId}`);
  if (!roofArtifact.validation?.passed) blockers.push('roof artifact validation did not pass');
  if (!roofArtifact.roof || typeof roofArtifact.roof !== 'object') blockers.push('missing roof object');
  if (!Array.isArray(roofArtifact.roof?.planes) || roofArtifact.roof.planes.length < 2) blockers.push('missing roof planes');
  if (!Array.isArray(roofArtifact.elevations) || roofArtifact.elevations.length < 2) blockers.push('missing front/side elevations');
  if (!Number.isFinite(roofArtifact.roof?.ridgeHeightFt)) blockers.push('missing ridgeHeightFt');
  if (!Number.isFinite(roofArtifact.roof?.eaveHeightFt)) blockers.push('missing eaveHeightFt');
  if ((roofArtifact.roof?.ridgeHeightFt ?? 0) <= (roofArtifact.roof?.eaveHeightFt ?? 0)) blockers.push('ridgeHeightFt must be above eaveHeightFt');
  for (const plane of roofArtifact.roof?.planes ?? []) {
    if (!plane.id) blockers.push('roof plane missing id');
    if (!plane.role) blockers.push(`${plane.id ?? 'roof plane'} missing role`);
    if (!Array.isArray(plane.points) || plane.points.length < (plane.role === 'roof-plane' ? 3 : 2)) blockers.push(`${plane.id ?? 'roof plane'} has too few points`);
    for (const point of plane.points ?? []) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) blockers.push(`${plane.id ?? 'roof plane'} has non-finite point`);
    }
  }
  const elevationViews = new Set((roofArtifact.elevations ?? []).map((elevation) => elevation.view));
  if (!elevationViews.has('front')) blockers.push('missing front elevation');
  if (!elevationViews.has('side') && !elevationViews.has('left') && !elevationViews.has('right')) blockers.push('missing side elevation');
  for (const elevation of roofArtifact.elevations ?? []) {
    if (!Array.isArray(elevation.outline) || elevation.outline.length < 3) blockers.push(`${elevation.id ?? 'elevation'} outline has too few points`);
  }
  return blockers;
}

const [, , planId = 'a-frame-bunk', proposalId = 'proposal-paired-v1'] = process.argv;
const planDir = path.join(DATA_ROOT, planId);
const pairedDir = path.join(planDir, 'paired');
const pairedFile = path.join(pairedDir, `${planId}-${proposalId}.paired.json`);
const roofFile = path.join(pairedDir, `${planId}-${proposalId}.roof-elevation.json`);
const roofValidationFile = path.join(pairedDir, `${planId}-${proposalId}.roof-elevation.validation.json`);
const manifestFile = path.join(DATA_ROOT, 'proposal-manifest.json');

if (!fs.existsSync(pairedFile)) fail(`missing paired JSON ${pairedFile}`);
if (!fs.existsSync(roofFile)) fail(`missing roof/elevation JSON ${roofFile}`);
if (!fs.existsSync(manifestFile)) fail(`missing proposal manifest ${manifestFile}`);

const pairedArtifact = readJson(pairedFile);
const roofArtifact = readJson(roofFile);
const blockers = validateRoofArtifact(roofArtifact, pairedArtifact);
const validation = {
  schemaVersion: 'paired_roof_elevation_validation_v1',
  planId,
  proposalId,
  passed: blockers.length === 0,
  blockers,
  source: path.relative(planDir, roofFile),
  checks: {
    hasRoofPlanes: Array.isArray(roofArtifact.roof?.planes) && roofArtifact.roof.planes.length > 0,
    hasElevations: Array.isArray(roofArtifact.elevations) && roofArtifact.elevations.length >= 2,
    ridgeAboveEaves: (roofArtifact.roof?.ridgeHeightFt ?? 0) > (roofArtifact.roof?.eaveHeightFt ?? 0),
  },
};
writeJson(roofValidationFile, validation);
if (!validation.passed) fail(blockers.join('; '));

pairedArtifact.roof = roofArtifact.roof;
pairedArtifact.elevations = roofArtifact.elevations;
pairedArtifact.roofElevationArtifact = {
  schemaVersion: roofArtifact.schemaVersion,
  source: path.relative(planDir, roofFile),
  validation: path.relative(planDir, roofValidationFile),
  importedAt: new Date().toISOString(),
};
writeJson(pairedFile, pairedArtifact);

const manifest = readJson(manifestFile);
const option = manifest.plans?.[planId]?.find((candidate) => candidate.id === proposalId);
if (!option) fail(`manifest missing ${planId}/${proposalId}`);
option.pairedRoofElevationUrl = path.relative(planDir, roofFile);
option.pairedRoofElevationValidationUrl = path.relative(planDir, roofValidationFile);
option.pairedRoofElevationReady = true;
writeJson(manifestFile, manifest);

console.log(`paired:roof ok - imported ${planId}/${proposalId} roof/elevation semantics`);
