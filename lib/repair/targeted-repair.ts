import type { DenHome } from '@/lib/types';

export type RepairLayer =
  | 'walls'
  | 'openings'
  | 'doors'
  | 'windows'
  | 'fixtures'
  | 'furniture'
  | 'stairs'
  | 'void/open-to-below'
  | 'roof/elevation'
  | 'labels'
  | 'dimensions'
  | 'level frames';

export type RepairSeverity = 'warning' | 'blocked';

export interface LayerDriftReport {
  layer: RepairLayer;
  severity: RepairSeverity;
  sourceAnchorIds: string[];
  semanticElementIds: string[];
  description: string;
  expectedFromSource: string;
  currentInJson: string;
  allowedPatchPaths: string[];
  blockedPatchPaths: string[];
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'test';
  path: string;
  value?: unknown;
}

export interface PatchValidationResult {
  ok: boolean;
  errors: string[];
}

export interface PatchApplyResult {
  ok: boolean;
  home?: DenHome;
  errors: string[];
}

const ROOT_BLOCKED_PATHS = [
  '/id',
  '/model',
  '/sqft',
  '/bedBath',
  '/footprint',
  '/pairedArtifactInfo',
  '/pairedArtifact',
  '/pairedProposalId',
  '/componentsUsed',
  '/buildValidation',
];

export const REPAIR_LAYER_PATHS: Record<RepairLayer, { allowed: string[]; blocked: string[] }> = {
  walls: {
    allowed: ['/sourceWalls'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceOpenings', '/connections', '/roofSemantics'],
  },
  openings: {
    allowed: ['/sourceOpenings', '/connections'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceWalls', '/roofSemantics'],
  },
  doors: {
    allowed: ['/sourceOpenings', '/connections'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceWalls', '/roofSemantics'],
  },
  windows: {
    allowed: ['/sourceOpenings'],
    blocked: [...ROOT_BLOCKED_PATHS, '/rooms', '/sourceWalls', '/connections', '/roofSemantics'],
  },
  fixtures: {
    allowed: ['/rooms'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/sourceOpenings', '/connections', '/roofSemantics'],
  },
  furniture: {
    allowed: ['/rooms'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/sourceOpenings', '/connections', '/roofSemantics'],
  },
  stairs: {
    allowed: ['/rooms', '/connections', '/sourceOpenings'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/roofSemantics'],
  },
  'void/open-to-below': {
    allowed: ['/rooms', '/spaceFaces', '/sourceWalls'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceOpenings', '/connections', '/roofSemantics'],
  },
  'roof/elevation': {
    allowed: ['/roofSemantics', '/height', '/roofStyle'],
    blocked: [...ROOT_BLOCKED_PATHS.filter((path) => path !== '/footprint'), '/rooms', '/sourceWalls', '/sourceOpenings', '/connections'],
  },
  labels: {
    allowed: ['/rooms'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/sourceOpenings', '/connections', '/roofSemantics'],
  },
  dimensions: {
    allowed: ['/dimensionFrame', '/rooms'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/sourceOpenings', '/connections', '/roofSemantics'],
  },
  'level frames': {
    allowed: ['/dimensionFrame', '/rooms', '/spaceFaces'],
    blocked: [...ROOT_BLOCKED_PATHS, '/sourceWalls', '/sourceOpenings', '/connections', '/roofSemantics'],
  },
};

function startsWithPointer(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

function isSourceAnchorEvidencePath(path: string) {
  return startsWithPointer(path, '/sourceAnchors')
    || /^\/floorPanels\/(?:\d+|-)\/sourceAnchors(?:\/|$)/.test(path);
}

function isFloorPanelPath(path: string) {
  return startsWithPointer(path, '/floorPanels');
}

function escapePointerPart(part: string) {
  return part.replace(/~/g, '~0').replace(/\//g, '~1');
}

function decodePointer(path: string) {
  if (!path.startsWith('/')) throw new Error(`JSON Patch path must start with "/": ${path}`);
  return path.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function getAtPath(target: unknown, path: string) {
  if (path === '') return target;
  let current: unknown = target;
  for (const part of decodePointer(path)) {
    if (current == null || typeof current !== 'object') return undefined;
    current = Array.isArray(current) ? current[Number(part)] : (current as Record<string, unknown>)[part];
  }
  return current;
}

function setAtPath(target: unknown, path: string, value: unknown, add: boolean) {
  const parts = decodePointer(path);
  const key = parts.pop();
  if (key === undefined) throw new Error('Cannot patch empty JSON pointer');
  let parent: unknown = target;
  for (const part of parts) {
    if (parent == null || typeof parent !== 'object') throw new Error(`Cannot traverse ${path}`);
    parent = Array.isArray(parent) ? parent[Number(part)] : (parent as Record<string, unknown>)[part];
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
  (parent as Record<string, unknown>)[key] = value;
}

function removeAtPath(target: unknown, path: string) {
  const parts = decodePointer(path);
  const key = parts.pop();
  if (key === undefined) throw new Error('Cannot patch empty JSON pointer');
  let parent: unknown = target;
  for (const part of parts) {
    if (parent == null || typeof parent !== 'object') throw new Error(`Cannot traverse ${path}`);
    parent = Array.isArray(parent) ? parent[Number(part)] : (parent as Record<string, unknown>)[part];
  }
  if (parent == null || typeof parent !== 'object') throw new Error(`Cannot remove ${path}`);
  if (Array.isArray(parent)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0 || index >= parent.length) throw new Error(`Invalid array index in ${path}`);
    parent.splice(index, 1);
    return;
  }
  delete (parent as Record<string, unknown>)[key];
}

export function parseJsonPatch(text: string): JsonPatchOperation[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error('GPT response must be a JSON Patch array');
  return parsed.map((operation, index) => {
    if (!operation || typeof operation !== 'object') throw new Error(`Patch operation ${index} is not an object`);
    const op = operation as Partial<JsonPatchOperation>;
    if (!['add', 'remove', 'replace', 'test'].includes(String(op.op))) throw new Error(`Unsupported JSON Patch op at ${index}: ${String(op.op)}`);
    if (typeof op.path !== 'string') throw new Error(`Patch operation ${index} is missing path`);
    return op as JsonPatchOperation;
  });
}

export function validatePatchScope(operations: JsonPatchOperation[], report: LayerDriftReport): PatchValidationResult {
  const errors: string[] = [];
  for (const operation of operations) {
    if (!operation.path.startsWith('/')) {
      errors.push(`${operation.op} ${operation.path}: path must be an absolute JSON pointer`);
      continue;
    }
    const allowed = report.allowedPatchPaths.some((prefix) => startsWithPointer(operation.path, prefix));
    if (!allowed) errors.push(`${operation.op} ${operation.path}: outside allowed paths for ${report.layer}`);
    const blocked = report.blockedPatchPaths.some((prefix) => startsWithPointer(operation.path, prefix));
    if (blocked) errors.push(`${operation.op} ${operation.path}: touches blocked path for ${report.layer}`);
    if (isFloorPanelPath(operation.path) && !['source primitives', 'level frames', 'dimensions'].includes(String(report.layer))) {
      errors.push(`${operation.op} ${operation.path}: floor panel/frame data can only be patched by source primitives, level frames, or dimensions layers`);
    }
    if (isSourceAnchorEvidencePath(operation.path) && String(report.layer) !== 'source primitives') {
      errors.push(`${operation.op} ${operation.path}: source image anchor evidence can only be patched by the dedicated source primitives layer`);
    }
    if (operation.op === 'remove' && /^\/rooms\/\d+$/.test(operation.path)) errors.push(`${operation.path}: deleting whole rooms is not allowed in targeted repair`);
    if (operation.op === 'remove' && /^\/sourceWalls\/\d+$/.test(operation.path) && report.layer !== 'walls') errors.push(`${operation.path}: deleting walls requires wall repair layer`);
  }
  return { ok: errors.length === 0, errors };
}

export function applyJsonPatchToHome(home: DenHome, operations: JsonPatchOperation[], report: LayerDriftReport): PatchApplyResult {
  const scope = validatePatchScope(operations, report);
  if (!scope.ok) return { ok: false, errors: scope.errors };
  const next = JSON.parse(JSON.stringify(home)) as DenHome;
  try {
    for (const operation of operations) {
      if (operation.op === 'test') {
        const current = getAtPath(next, operation.path);
        if (JSON.stringify(current) !== JSON.stringify(operation.value)) {
          throw new Error(`test failed at ${operation.path}`);
        }
        continue;
      }
      if (operation.op === 'remove') {
        removeAtPath(next, operation.path);
      } else {
        setAtPath(next, operation.path, operation.value, operation.op === 'add');
      }
    }
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'Failed to apply JSON Patch'] };
  }
  return { ok: true, home: next, errors: [] };
}

function idsForLayer(home: DenHome, layer: RepairLayer) {
  if (layer === 'walls') return (home.sourceWalls ?? []).slice(0, 16).map((wall) => wall.id ?? 'wall');
  if (['openings', 'doors', 'windows'].includes(layer)) {
    return (home.sourceOpenings ?? [])
      .filter((opening) => layer === 'openings' || opening.kind === layer.slice(0, -1))
      .slice(0, 16)
      .map((opening) => opening.id ?? opening.kind);
  }
  if (['fixtures', 'furniture'].includes(layer)) {
    return home.rooms.flatMap((room) => (room.fixtures ?? []).map((fixture) => fixture.id ?? `${room.label}:${fixture.type}`)).slice(0, 20);
  }
  return [];
}

export function createLayerDriftReport(home: DenHome, layer: RepairLayer, messages: string[]): LayerDriftReport {
  const paths = REPAIR_LAYER_PATHS[layer];
  return {
    layer,
    severity: messages.some((message) => /blocked|missing|not aligned|outside|overlap|requires/i.test(message)) ? 'blocked' : 'warning',
    sourceAnchorIds: idsForLayer(home, layer),
    semanticElementIds: idsForLayer(home, layer),
    description: messages.length ? messages.join('\n') : `Review and repair ${layer} drift only.`,
    expectedFromSource: 'Match the GPT proposal image exactly for this selected layer. Preserve all unrelated layers.',
    currentInJson: `Current paired JSON appears to have ${layer} drift or missing metadata. Use only the allowed paths below.`,
    allowedPatchPaths: paths.allowed,
    blockedPatchPaths: paths.blocked,
  };
}

function layerSection(home: DenHome, report: LayerDriftReport): unknown {
  const layer = report.layer;
  const pairedArtifact = home.pairedArtifactJson;
  if (layer === 'walls') return { pairedArtifact, converted: { sourceWalls: home.sourceWalls } };
  if (['openings', 'doors', 'windows'].includes(layer)) return { pairedArtifact, converted: { sourceOpenings: home.sourceOpenings, connections: home.connections } };
  if (['fixtures', 'furniture', 'stairs', 'void/open-to-below', 'labels', 'dimensions', 'level frames'].includes(layer)) {
    return { pairedArtifact, converted: { rooms: home.rooms, spaceFaces: home.spaceFaces, dimensionFrame: home.dimensionFrame } };
  }
  if (layer === 'roof/elevation') return { pairedArtifact, converted: { roofSemantics: home.roofSemantics, height: home.height, roofStyle: home.roofStyle } };
  return home;
}

function elementSummary(value: unknown) {
  if (!value || typeof value !== 'object') return {};
  const item = value as Record<string, unknown>;
  const sourceAnchor = item.sourceAnchor && typeof item.sourceAnchor === 'object' ? item.sourceAnchor as Record<string, unknown> : undefined;
  return {
    id: item.id ?? item.fixtureId ?? item.openingId ?? item.wallId ?? item.sourceAnchorId,
    type: item.type ?? item.kind ?? item.category ?? item.roomType ?? item.label,
    label: item.label ?? item.name,
    roomId: item.roomId,
    wallId: item.wallId ?? item.anchorWallId,
    sourceAnchorId: item.sourceAnchorId ?? sourceAnchor?.id,
  };
}

function patchPathIndex(home: DenHome, report: LayerDriftReport) {
  const layer = report.layer;
  if (layer === 'walls') {
    return (home.sourceWalls ?? []).map((wall, index) => ({ path: `/sourceWalls/${index}`, ...elementSummary(wall) }));
  }
  if (['openings', 'doors', 'windows'].includes(layer)) {
    return [
      ...(home.sourceOpenings ?? []).map((opening, index) => ({ path: `/sourceOpenings/${index}`, ...elementSummary(opening) })),
      ...(home.connections ?? []).map((connection, index) => ({ path: `/connections/${index}`, ...elementSummary(connection) })),
    ];
  }
  if (['fixtures', 'furniture', 'stairs', 'void/open-to-below', 'labels'].includes(layer)) {
    return [
      ...home.rooms.map((room, index) => ({ path: `/rooms/${index}`, ...elementSummary(room) })),
      ...home.rooms.flatMap((room, roomIndex) => (room.fixtures ?? []).map((fixture, fixtureIndex) => ({
        path: `/rooms/${roomIndex}/fixtures/${fixtureIndex}`,
        parentPath: `/rooms/${roomIndex}`,
        parentId: (room as unknown as Record<string, unknown>).id ?? room.label,
        ...elementSummary(fixture),
      }))),
      ...(home.spaceFaces ?? []).map((face, index) => ({ path: `/spaceFaces/${index}`, ...elementSummary(face) })),
    ];
  }
  if (layer === 'dimensions' || layer === 'level frames') {
    return [
      { path: '/dimensionFrame', type: 'dimensionFrame' },
      ...(home.rooms ?? []).map((room, index) => ({ path: `/rooms/${index}`, ...elementSummary(room) })),
      ...(home.spaceFaces ?? []).map((face, index) => ({ path: `/spaceFaces/${index}`, ...elementSummary(face) })),
    ];
  }
  if (layer === 'roof/elevation') {
    return [
      { path: '/roofSemantics', type: 'roofSemantics' },
      { path: '/height', type: 'height' },
      { path: '/roofStyle', type: 'roofStyle' },
    ];
  }
  return [];
}

export function buildTargetedRepairPrompt(home: DenHome, report: LayerDriftReport) {
  const image = home.pairedArtifactInfo?.sourceImageUrl ?? 'missing source image URL';
  const render = home.pairedArtifactInfo?.deterministicRenderUrl ?? 'deterministic render is generated in app; use supplied screenshot if attached';
  return [
    '# Targeted paired floorplan JSON repair',
    '',
    'You are repairing one semantic layer of a paired floorplan artifact. Do not regenerate the whole plan.',
    'Return RFC 6902 JSON Patch only. No markdown. No explanation.',
    '',
    `Plan: ${home.id}`,
    `Proposal: ${home.pairedProposalId ?? home.pairedArtifactInfo?.proposalId ?? 'unknown'}`,
    `Repair layer: ${report.layer}`,
    `Severity: ${report.severity}`,
    '',
    'Required visual attachments:',
    '- Attach the source GPT proposal image.',
    '- Attach the current deterministic render or Compare/Overlay screenshot.',
    '- Treat the paths below as identifiers only. If the images are not attached or visible to you, return [] instead of guessing.',
    '',
    'Source GPT proposal image:',
    image,
    '',
    'Current deterministic render image:',
    render,
    '',
    'Drift report:',
    JSON.stringify(report, null, 2),
    '',
    'Current paired artifact JSON and converted semantic section for this layer:',
    JSON.stringify(layerSection(home, report), null, 2),
    '',
    'JSON Patch path index for this layer:',
    JSON.stringify(patchPathIndex(home, report), null, 2),
    '',
    'Allowed JSON Patch paths:',
    ...report.allowedPatchPaths.map((path) => `- ${path}`),
    '',
    'Blocked JSON Patch paths:',
    ...report.blockedPatchPaths.map((path) => `- ${path}`),
    '',
    'Hard rules:',
    '- Patch only the selected repair layer.',
    '- Do not change footprint, scale, proposal metadata, unrelated room geometry, unrelated walls, or unrelated fixtures.',
    '- Do not delete whole rooms, whole plans, or unrelated elements.',
    '- Preserve the source design intent. Do not rectangle-pack or simplify the plan.',
    '- If the source image is bad, return [] and do not attempt a redesign.',
    '- Door patches must preserve or add: openingType, wallId, fromRoomId, toRoomId, span/x1/z1/x2/z2, hingePoint, leafClosedEnd, leafOpenEnd, swingDirection, swingArcDeg, opensIntoRoomId, widthFt, heightFt, sourceAnchorId.',
    '- Sliding/pocket doors must not have swing arcs; hinged doors must have hinge and leaf geometry.',
    '- Fixture/furniture patches must preserve or add: category, type, roomId, bounds/x/z/w/d, rotationDeg, facingDirection, anchorWallId, wallSide, clearance, sourceAnchorId, bimClass, symbolVariant.',
    '- Wall-backed fixtures such as toilets, sinks, tubs, ranges, washers, dryers, counters, and cabinets need anchorWallId and wallSide.',
    '- Use BIM classes such as IfcDoor, IfcWindow, IfcSanitaryTerminal, IfcFurniture, IfcStair, or IfcBuildingElementProxy where appropriate.',
    '',
    'Return only a JSON Patch array like:',
    `[{"op":"replace","path":"/sourceOpenings/0/kind","value":"door"}]`,
  ].join('\n');
}

export function repairLayerFromGroupId(groupId: string): RepairLayer {
  if (groupId === 'geometry') return 'level frames';
  if (groupId === 'openings') return 'openings';
  if (groupId === 'fixtures') return 'fixtures';
  if (groupId === 'roof') return 'roof/elevation';
  if (groupId === 'bim') return 'void/open-to-below';
  if (groupId === 'build') return 'walls';
  if (groupId === 'json') return 'walls';
  return 'labels';
}

export function pointerForRoomFixture(roomIndex: number, fixtureIndex: number, key: string) {
  return `/rooms/${roomIndex}/fixtures/${fixtureIndex}/${escapePointerPart(key)}`;
}
