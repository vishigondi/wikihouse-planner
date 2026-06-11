import type { DenHome } from '@/lib/types';
import { buildableBimFromHome } from '@/lib/bim/buildable-bim';
import { BIM_COMPONENT_CATALOG } from '@/lib/bim/component-registry';
import type { SemanticBimCategory, SemanticBimElement } from '@/lib/bim/semantic-bim';
import { REPAIR_LAYER_PATHS, type RepairLayer } from '@/lib/repair/targeted-repair';
import {
  codeAdvisoryReport,
  type CodeAdvisoryInput,
  type CodeAdvisoryLot,
  type CodeAdvisoryOpening,
  type CodeAdvisoryReport,
} from '@/lib/standards/code-advisory';

export const STANDARD_REGISTRY_VERSION = 'paired_floorplan_standards_v1';

export type ValidationChannel = 'design' | 'manufacturing' | 'export' | 'accessibility' | 'codeAdvisory';

export type StandardPackId =
  | 'design-basic'
  | 'doors-openings'
  | 'fixtures-kitchen-bath'
  | 'stairs-guards'
  | 'roof-envelope'
  | 'accessibility-optional'
  | 'manufacturing-panel-grid'
  | 'export-ifc-experimental'
  | 'code-advisory-dimensional';

export type StandardSeverity = 'pass' | 'warning' | 'blocked';

export type SemanticRole =
  | 'room'
  | 'openZone'
  | 'void/openToBelow'
  | 'stair'
  | 'guardrail'
  | 'wall'
  | 'slab/floor'
  | 'roofPlane'
  | 'structuralBeam'
  | 'door'
  | 'window'
  | 'opening'
  | 'fixture'
  | 'furniture'
  | 'appliance'
  | 'deck'
  | 'label'
  | 'dimension';

export interface StandardsRoleDefinition {
  semanticRole: SemanticRole;
  bimCategories: SemanticBimCategory[];
  ifcClasses: string[];
  bsddTerm: string;
  channel: ValidationChannel;
  standardPacks: StandardPackId[];
  requiredFields: string[];
  hostConstraints: string[];
  clearanceRules: string[];
  renderingRequirements: string[];
  exportRequirements: string[];
  repairLayer: RepairLayer;
}

export interface BcfStyleIssue {
  issueId: string;
  standardPack: StandardPackId;
  severity: Exclude<StandardSeverity, 'pass'>;
  channel: ValidationChannel;
  semanticElementIds: string[];
  sourceAnchorIds: string[];
  layer: RepairLayer;
  description: string;
  expected: string;
  actual: string;
  allowedPatchPaths: string[];
  blockedPatchPaths: string[];
  suggestedRepairPrompt: string;
  camera?: {
    view: 'plan' | '3d' | 'cutaway' | 'front' | 'side';
    targetElementIds: string[];
  };
  screenshotReference?: string;
}

export interface StandardsPackResult {
  standardPack: StandardPackId;
  channel: ValidationChannel;
  status: StandardSeverity;
  blockers: string[];
  warnings: string[];
}

export interface StandardsValidationResult {
  registryVersion: typeof STANDARD_REGISTRY_VERSION;
  legalCompliance: 'not-claimed';
  statement: string;
  channels: Record<ValidationChannel, StandardsPackResult[]>;
  packs: StandardsPackResult[];
  issues: BcfStyleIssue[];
  codeAdvisory: CodeAdvisoryReport;
}

const ROLE_DEFINITIONS: StandardsRoleDefinition[] = [
  role('room', ['space'], ['IfcSpace'], 'bSDD:Space.Room', 'design', ['design-basic'], ['id', 'category', 'floor', 'bounds'], ['inside footprint'], [], ['2D fill + 3D room volume/label'], ['semantic JSON, SVG, BIM JSON'], 'labels'),
  role('openZone', ['openZone'], ['IfcSpace'], 'bSDD:Space.OpenPlanZone', 'design', ['design-basic'], ['id', 'category', 'floor', 'bounds'], ['not forced into invented walls'], [], ['open zone remains visually open'], ['semantic JSON, SVG, BIM JSON'], 'void/open-to-below'),
  role('void/openToBelow', ['void'], ['IfcOpeningElement'], 'bSDD:Opening.Void.OpenToBelow', 'design', ['design-basic', 'stairs-guards'], ['id', 'category', 'floor'], ['must not become slab or wall'], ['guard required when exposed'], ['floor cutout / dashed 2D outline only'], ['semantic JSON, BIM JSON'], 'void/open-to-below'),
  role('stair', ['stair'], ['IfcStair'], 'bSDD:TransportElement.Stair', 'design', ['stairs-guards'], ['id', 'category', 'floor', 'bounds'], ['connects levels or landing'], ['clear path advisory'], ['treads, arrow, landing'], ['semantic JSON, BIM JSON'], 'stairs'),
  role('guardrail', ['guardrail'], ['IfcRailing'], 'bSDD:Railing.Guardrail', 'design', ['stairs-guards'], ['id', 'category', 'floor', 'segment'], ['hosts exposed deck/stair/void edge'], ['guard height advisory'], ['rail not wall'], ['semantic JSON, BIM JSON'], 'void/open-to-below'),
  role('wall', ['wall'], ['IfcWall'], 'bSDD:Wall', 'design', ['design-basic'], ['id', 'category', 'floor', 'segment'], ['supported by slab/floor'], [], ['wall thickness and openings preserved'], ['semantic JSON, BIM JSON'], 'walls'),
  role('slab/floor', ['slab'], ['IfcSlab'], 'bSDD:Slab.Floor', 'design', ['design-basic'], ['id', 'category', 'floor', 'bounds'], ['matches level frame'], [], ['floor plate only where semantic space exists'], ['semantic JSON, BIM JSON'], 'level frames'),
  role('roofPlane', ['roofPlane'], ['IfcRoof'], 'bSDD:Roof.Plane', 'design', ['roof-envelope'], ['id', 'category', 'floor', 'points'], ['intersects envelope/walls plausibly'], [], ['ridge, eaves, thickness, end caps'], ['semantic JSON, BIM JSON'], 'roof/elevation'),
  role('structuralBeam', [], ['IfcBeam'], 'bSDD:Beam', 'manufacturing', ['manufacturing-panel-grid'], ['id', 'category', 'floor', 'segment'], ['supported by structure'], [], ['beam shown only when explicit'], ['semantic BIM JSON'], 'walls'),
  role('door', ['door'], ['IfcDoor'], 'bSDD:Door', 'design', ['doors-openings'], ['id', 'category', 'floor', 'segment', 'wallId'], ['hosted by one wall opening'], ['swing clearance'], ['leaf, hinge, swing arc or sliding symbol'], ['semantic JSON, SVG, BIM JSON'], 'doors'),
  role('window', ['window'], ['IfcWindow'], 'bSDD:Window', 'design', ['doors-openings'], ['id', 'category', 'floor', 'segment', 'wallId'], ['hosted by one wall opening'], [], ['wall interruption / glazing'], ['semantic JSON, SVG, BIM JSON'], 'windows'),
  role('opening', ['opening'], ['IfcOpeningElement'], 'bSDD:Opening', 'design', ['doors-openings'], ['id', 'category', 'floor', 'segment', 'wallId'], ['hosted by one wall'], [], ['wall gap only'], ['semantic JSON, SVG, BIM JSON'], 'openings'),
  role('fixture', ['sanitaryTerminal', 'fixtureProxy'], ['IfcSanitaryTerminal', 'IfcBuildingElementProxy'], 'bSDD:Fixture', 'design', ['fixtures-kitchen-bath'], ['id', 'category', 'floor', 'bounds', 'component'], ['correct room and host constraints'], ['fixture clearance'], ['2D symbol + 3D procedural/asset fallback'], ['semantic JSON, SVG, BIM JSON'], 'fixtures'),
  role('furniture', ['furniture'], ['IfcFurniture'], 'bSDD:Furniture', 'design', ['fixtures-kitchen-bath'], ['id', 'category', 'floor', 'bounds', 'component'], ['inside owning room'], ['usable circulation advisory'], ['orientation-preserving 2D/3D symbol'], ['semantic JSON, SVG, BIM JSON'], 'furniture'),
  role('appliance', ['equipment'], ['IfcBuildingElementProxy'], 'bSDD:Equipment.Appliance', 'design', ['fixtures-kitchen-bath'], ['id', 'category', 'floor', 'bounds', 'component'], ['correct room and host constraints'], ['service clearance advisory'], ['2D symbol + 3D procedural/asset fallback'], ['semantic JSON, SVG, BIM JSON'], 'fixtures'),
  role('deck', ['deck'], ['IfcSlab'], 'bSDD:Deck', 'design', ['design-basic', 'stairs-guards'], ['id', 'category', 'floor', 'bounds'], ['outside or attached to footprint'], ['guard advisory when elevated'], ['deck plate/boards/rail where explicit'], ['semantic JSON, SVG, BIM JSON'], 'level frames'),
  role('label', [], ['IfcAnnotation'], 'bSDD:Annotation.Label', 'design', ['design-basic'], ['id', 'text', 'anchor'], ['belongs to semantic element'], [], ['readable in 2D; optional in 3D'], ['SVG, brochure HTML'], 'labels'),
  role('dimension', [], ['IfcAnnotation'], 'bSDD:Annotation.Dimension', 'export', ['export-ifc-experimental'], ['id', 'span', 'text'], ['matches footprint or level frame'], [], ['dimension line in 2D/export'], ['SVG, brochure HTML'], 'dimensions'),
];

function role(
  semanticRole: SemanticRole,
  bimCategories: SemanticBimCategory[],
  ifcClasses: string[],
  bsddTerm: string,
  channel: ValidationChannel,
  standardPacks: StandardPackId[],
  requiredFields: string[],
  hostConstraints: string[],
  clearanceRules: string[],
  renderingRequirements: string[],
  exportRequirements: string[],
  repairLayer: RepairLayer,
): StandardsRoleDefinition {
  return {
    semanticRole,
    bimCategories,
    ifcClasses,
    bsddTerm,
    channel,
    standardPacks,
    requiredFields,
    hostConstraints,
    clearanceRules,
    renderingRequirements,
    exportRequirements,
    repairLayer,
  };
}

const ROLE_BY_CATEGORY = new Map<SemanticBimCategory, StandardsRoleDefinition>();
for (const definition of ROLE_DEFINITIONS) {
  for (const category of definition.bimCategories) ROLE_BY_CATEGORY.set(category, definition);
}

function issuePaths(layer: RepairLayer) {
  return REPAIR_LAYER_PATHS[layer] ?? REPAIR_LAYER_PATHS.labels;
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 72);
}

function pushIssue(
  issues: BcfStyleIssue[],
  input: Omit<BcfStyleIssue, 'issueId' | 'allowedPatchPaths' | 'blockedPatchPaths' | 'suggestedRepairPrompt'>,
) {
  const paths = issuePaths(input.layer);
  const issueId = `${input.standardPack}-${input.severity}-${slug(input.description)}-${issues.length + 1}`;
  issues.push({
    ...input,
    issueId,
    allowedPatchPaths: paths.allowed,
    blockedPatchPaths: paths.blocked,
    suggestedRepairPrompt: [
      `Repair ${input.layer} only for issue ${issueId}.`,
      `Expected: ${input.expected}`,
      `Actual: ${input.actual}`,
      'Return RFC 6902 JSON Patch only and preserve unrelated layers.',
    ].join(' '),
  });
}

function hasGeometry(element: SemanticBimElement) {
  return Boolean(element.bounds || element.segment || element.points?.length);
}

function wallHosted(element: SemanticBimElement) {
  return Boolean(element.metadata?.wallId || element.metadata?.wallAnchor || element.sourceAnchorId);
}

function roleForElement(element: SemanticBimElement) {
  return ROLE_BY_CATEGORY.get(element.category);
}

function emptyPack(standardPack: StandardPackId, channel: ValidationChannel): StandardsPackResult {
  return { standardPack, channel, status: 'pass', blockers: [], warnings: [] };
}

function finalizePack(pack: StandardsPackResult) {
  pack.blockers = [...new Set(pack.blockers)];
  pack.warnings = [...new Set(pack.warnings)];
  pack.status = pack.blockers.length ? 'blocked' : pack.warnings.length ? 'warning' : 'pass';
}

function addPackMessage(
  packs: Map<StandardPackId, StandardsPackResult>,
  standardPack: StandardPackId,
  channel: ValidationChannel,
  severity: Exclude<StandardSeverity, 'pass'>,
  message: string,
) {
  const pack = packs.get(standardPack) ?? emptyPack(standardPack, channel);
  packs.set(standardPack, pack);
  if (severity === 'blocked') pack.blockers.push(message);
  else pack.warnings.push(message);
}

function sourceAnchors(elements: SemanticBimElement[]) {
  return elements.map((element) => element.sourceAnchorId ?? element.sourceId).filter((value): value is string => Boolean(value));
}

export function standardsRegistrySummary() {
  return {
    version: STANDARD_REGISTRY_VERSION,
    sourceOfTruth: 'paired_semantic_json_v1',
    legalCompliance: 'not-claimed' as const,
    statement: 'This app reports configured standards checks only. It does not claim legal code compliance without a jurisdiction-specific rule pack and professional review workflow.',
    roles: ROLE_DEFINITIONS,
    componentCatalogVersion: 'bim_component_catalog_v1',
    componentCount: BIM_COMPONENT_CATALOG.length,
    channels: ['design', 'manufacturing', 'export', 'accessibility', 'codeAdvisory'] as ValidationChannel[],
    standardPacks: [
      'design-basic',
      'doors-openings',
      'fixtures-kitchen-bath',
      'stairs-guards',
      'roof-envelope',
      'accessibility-optional',
      'manufacturing-panel-grid',
      'export-ifc-experimental',
      'code-advisory-dimensional',
    ] as StandardPackId[],
  };
}

const GRID_UNIT_FT = 4;

export function lotFromArtifact(artifactJson: unknown): CodeAdvisoryLot | null {
  if (!artifactJson || typeof artifactJson !== 'object') return null;
  const lot = (artifactJson as Record<string, unknown>).lot;
  if (!lot || typeof lot !== 'object') return null;
  const record = lot as Record<string, unknown>;
  const widthFt = Number(record.widthFt ?? record.width);
  const depthFt = Number(record.depthFt ?? record.depth);
  if (!Number.isFinite(widthFt) || !Number.isFinite(depthFt) || widthFt <= 0 || depthFt <= 0) return null;
  const setbacks = (record.setbacksFt ?? record.setbacks) as Record<string, unknown> | undefined;
  const setback = (key: string) => {
    const value = Number(setbacks?.[key]);
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  };
  const maxCoverage = Number(record.maxCoverageRatio);
  return {
    widthFt,
    depthFt,
    setbacksFt: setbacks
      ? { front: setback('front'), rear: setback('rear'), left: setback('left'), right: setback('right') }
      : undefined,
    maxCoverageRatio: Number.isFinite(maxCoverage) && maxCoverage > 0 && maxCoverage <= 1 ? maxCoverage : undefined,
  };
}

export function codeAdvisoryInputFromHome(home: DenHome): CodeAdvisoryInput {
  const faceRoomIdByFaceId = new Map(
    (home.spaceFaces ?? []).map((face) => [face.id, face.roomId ?? face.id]),
  );
  const rooms = home.rooms.map((room, index) => {
    const id = (room.spaceFaceId && faceRoomIdByFaceId.get(room.spaceFaceId))
      || room.spaceFaceId
      || `${room.label || room.type || 'room'}-${room.floor ?? 0}-${index}`;
    const hasRect = Number.isFinite(room.gw) && Number.isFinite(room.gd) && room.gw > 0 && room.gd > 0;
    return {
      id,
      label: room.label,
      type: room.type,
      floor: room.floor,
      widthFt: hasRect ? room.gw * GRID_UNIT_FT : undefined,
      depthFt: hasRect ? room.gd * GRID_UNIT_FT : undefined,
      parts: (room.parts ?? [])
        .filter((part) => Number.isFinite(part.gw) && Number.isFinite(part.gd) && part.gw > 0 && part.gd > 0)
        .map((part) => ({ widthFt: part.gw * GRID_UNIT_FT, depthFt: part.gd * GRID_UNIT_FT })),
      grid: hasRect
        ? { gx: room.gx, gz: room.gz, gw: room.gw, gd: room.gd, unitFt: GRID_UNIT_FT }
        : undefined,
      physicalBoundary: room.physicalBoundary,
      semanticZone: room.semanticZone,
    };
  });
  const openings: CodeAdvisoryOpening[] = (home.sourceOpenings ?? []).map((opening) => ({
    id: opening.id,
    kind: opening.kind,
    openingType: opening.openingType,
    roomIds: opening.roomIds,
    fromRoomId: opening.fromRoomId,
    toRoomId: opening.toRoomId,
    opensIntoRoomId: opening.opensIntoRoomId,
  }));
  // The render pipeline drops geometry-less semantic windows/doors and keeps
  // image-extracted ones without room references. Join the raw artifact's
  // room attribution back in so egress can evaluate from semantic intent.
  const artifact = (home.pairedArtifactJson ?? null) as Record<string, unknown> | null;
  const rawOpenings: Array<{ raw: Record<string, unknown>; defaultKind: string }> =
    ([['windows', 'window'], ['doors', 'door'], ['openings', 'opening']] as const)
      .flatMap(([key, defaultKind]) => (Array.isArray(artifact?.[key]) ? (artifact?.[key] as Array<Record<string, unknown>>).map((raw) => ({ raw, defaultKind })) : []))
      .filter((entry) => Boolean(entry.raw && typeof entry.raw === 'object'));
  const refList = (raw: Record<string, unknown>): string[] => [
    ...(Array.isArray(raw.roomIds) ? raw.roomIds.filter((id): id is string => typeof id === 'string') : []),
    ...[raw.roomId, raw.fromRoomId, raw.toRoomId, raw.opensIntoRoomId].filter((id): id is string => typeof id === 'string'),
  ];
  const rawRefsById = new Map<string, string[]>();
  for (const { raw } of rawOpenings) {
    const refs = refList(raw);
    if (typeof raw.id === 'string' && refs.length) rawRefsById.set(raw.id, refs);
  }
  const presentIds = new Set(openings.map((opening) => opening.id).filter(Boolean));
  for (const opening of openings) {
    const hasRefs = Boolean(opening.fromRoomId || opening.toRoomId || opening.opensIntoRoomId || (opening.roomIds ?? []).some(Boolean));
    if (!hasRefs && opening.id && rawRefsById.has(opening.id)) {
      opening.roomIds = rawRefsById.get(opening.id);
    }
  }
  for (const { raw, defaultKind } of rawOpenings) {
    if (typeof raw.id === 'string' && presentIds.has(raw.id)) continue;
    const refs = refList(raw);
    if (!refs.length) continue;
    openings.push({
      id: typeof raw.id === 'string' ? raw.id : undefined,
      kind: typeof raw.kind === 'string' ? raw.kind : typeof raw.type === 'string' ? raw.type : defaultKind,
      openingType: typeof raw.openingType === 'string' ? raw.openingType : undefined,
      roomIds: refs,
      fromRoomId: typeof raw.fromRoomId === 'string' ? raw.fromRoomId : undefined,
      toRoomId: typeof raw.toRoomId === 'string' ? raw.toRoomId : undefined,
      opensIntoRoomId: typeof raw.opensIntoRoomId === 'string' ? raw.opensIntoRoomId : undefined,
    });
  }
  return {
    planId: home.id,
    // Paired-artifact footprints are normalized to feet by lib/data.ts.
    footprintWidthFt: home.footprint?.width,
    footprintDepthFt: home.footprint?.depth,
    rooms,
    openings,
    lot: lotFromArtifact(home.pairedArtifactJson),
  };
}

/** Constraint report with an optional what-if lot override (null = no lot). */
export function codeAdvisoryReportForHome(home: DenHome, lotOverride?: CodeAdvisoryLot | null): CodeAdvisoryReport {
  const input = codeAdvisoryInputFromHome(home);
  if (lotOverride !== undefined) input.lot = lotOverride;
  return codeAdvisoryReport(input);
}

export function validateStandards(home: DenHome): StandardsValidationResult {
  const model = buildableBimFromHome(home);
  const issues: BcfStyleIssue[] = [];
  const packs = new Map<StandardPackId, StandardsPackResult>();
  const ensurePack = (standardPack: StandardPackId, channel: ValidationChannel) => {
    if (!packs.has(standardPack)) packs.set(standardPack, emptyPack(standardPack, channel));
  };

  for (const definition of ROLE_DEFINITIONS) {
    for (const pack of definition.standardPacks) ensurePack(pack, definition.channel);
  }

  for (const element of model.elements) {
    const definition = roleForElement(element);
    if (!definition) {
      const message = `${element.id} has unmapped semantic BIM category ${element.category}`;
      addPackMessage(packs, 'design-basic', 'design', 'blocked', message);
      pushIssue(issues, {
        standardPack: 'design-basic',
        severity: 'blocked',
        channel: 'design',
        semanticElementIds: [element.id],
        sourceAnchorIds: sourceAnchors([element]),
        layer: 'labels',
        description: message,
        expected: 'Every semantic BIM category maps to an explicit role definition.',
        actual: element.category,
      });
      continue;
    }

    if (!element.id || !element.category || !Number.isFinite(element.floor)) {
      const message = `${element.id || 'element'} is missing stable id, category, or floor`;
      addPackMessage(packs, 'design-basic', 'design', 'blocked', message);
      pushIssue(issues, {
        standardPack: 'design-basic',
        severity: 'blocked',
        channel: 'design',
        semanticElementIds: [element.id || 'missing-id'],
        sourceAnchorIds: sourceAnchors([element]),
        layer: definition.repairLayer,
        description: message,
        expected: 'Every semantic element has stable id, type/category, floor, and validation channel.',
        actual: JSON.stringify({ id: element.id, category: element.category, floor: element.floor }),
      });
    }

    if (!hasGeometry(element)) {
      const message = `${element.id} has no semantic geometry`;
      addPackMessage(packs, 'design-basic', 'design', 'blocked', message);
      pushIssue(issues, {
        standardPack: 'design-basic',
        severity: 'blocked',
        channel: 'design',
        semanticElementIds: [element.id],
        sourceAnchorIds: sourceAnchors([element]),
        layer: definition.repairLayer,
        description: message,
        expected: 'Each semantic element has bounds, segment, or points geometry from paired JSON.',
        actual: 'missing geometry',
      });
    }

    if (!definition.ifcClasses.includes(element.ifcClass)) {
      const message = `${element.id} IFC class ${element.ifcClass} does not match role ${definition.semanticRole}`;
      addPackMessage(packs, 'design-basic', 'design', 'blocked', message);
      pushIssue(issues, {
        standardPack: 'design-basic',
        severity: 'blocked',
        channel: 'design',
        semanticElementIds: [element.id],
        sourceAnchorIds: sourceAnchors([element]),
        layer: definition.repairLayer,
        description: message,
        expected: definition.ifcClasses.join(', '),
        actual: element.ifcClass,
      });
    }

    if (['door', 'window', 'opening'].includes(element.category) && !wallHosted(element)) {
      const message = `${element.id} is not explicitly hosted by a wall`;
      addPackMessage(packs, 'doors-openings', 'design', 'blocked', message);
      pushIssue(issues, {
        standardPack: 'doors-openings',
        severity: 'blocked',
        channel: 'design',
        semanticElementIds: [element.id],
        sourceAnchorIds: sourceAnchors([element]),
        layer: element.category === 'window' ? 'windows' : element.category === 'door' ? 'doors' : 'openings',
        description: message,
        expected: 'Door/window/opening has wallId or wall anchor and exact wall span.',
        actual: JSON.stringify({ wallId: element.metadata?.wallId, wallAnchor: element.metadata?.wallAnchor, sourceAnchorId: element.sourceAnchorId }),
        camera: { view: 'plan', targetElementIds: [element.id] },
      });
    }

    if (element.category === 'door' && !element.metadata?.swingDirection && !/sliding|pocket|bifold/i.test(`${element.metadata?.openingType ?? ''} ${element.name}`)) {
      const message = `${element.id} hinged door is missing swing direction metadata`;
      addPackMessage(packs, 'doors-openings', 'design', 'warning', message);
      pushIssue(issues, {
        standardPack: 'doors-openings',
        severity: 'warning',
        channel: 'design',
        semanticElementIds: [element.id],
        sourceAnchorIds: sourceAnchors([element]),
        layer: 'doors',
        description: message,
        expected: 'Hinged doors include hinge point, leaf endpoints, swing direction, swing arc, and opensIntoRoomId.',
        actual: JSON.stringify(element.metadata ?? {}),
        camera: { view: 'plan', targetElementIds: [element.id] },
      });
    }

    if (['sanitaryTerminal', 'equipment'].includes(element.category) && !wallHosted(element)) {
      const message = `${element.id} requires wall-backed fixture metadata`;
      addPackMessage(packs, 'fixtures-kitchen-bath', 'design', 'warning', message);
      pushIssue(issues, {
        standardPack: 'fixtures-kitchen-bath',
        severity: 'warning',
        channel: 'design',
        semanticElementIds: [element.id],
        sourceAnchorIds: sourceAnchors([element]),
        layer: 'fixtures',
        description: message,
        expected: 'Kitchen, bath, and laundry fixtures have anchorWallId/wallSide or source wall anchor.',
        actual: JSON.stringify({ wallId: element.metadata?.wallId, wallAnchor: element.metadata?.wallAnchor, wallSide: element.metadata?.wallSide }),
        camera: { view: 'plan', targetElementIds: [element.id] },
      });
    }

    if (['sanitaryTerminal', 'equipment', 'furniture', 'fixtureProxy'].includes(element.category) && !element.component) {
      const message = `${element.id} is missing component registry mapping`;
      addPackMessage(packs, 'fixtures-kitchen-bath', 'design', 'blocked', message);
      pushIssue(issues, {
        standardPack: 'fixtures-kitchen-bath',
        severity: 'blocked',
        channel: 'design',
        semanticElementIds: [element.id],
        sourceAnchorIds: sourceAnchors([element]),
        layer: element.category === 'furniture' ? 'furniture' : 'fixtures',
        description: message,
        expected: 'Every fixture/furniture/appliance maps to IFC class, dimensions, host constraints, fallback geometry, 2D symbol, and asset metadata.',
        actual: 'missing component',
      });
    }
  }

  const solidVoid = model.elements.filter((element) => (
    (element.category === 'wall' || element.category === 'slab') &&
    /void|open.to.below|open-to-below/i.test(`${element.sourceRoomId ?? ''} ${element.name}`)
  ));
  if (solidVoid.length) {
    const message = `${solidVoid.length} void/open-to-below element(s) are represented as solid build geometry`;
    addPackMessage(packs, 'stairs-guards', 'design', 'blocked', message);
    pushIssue(issues, {
      standardPack: 'stairs-guards',
      severity: 'blocked',
      channel: 'design',
      semanticElementIds: solidVoid.map((element) => element.id),
      sourceAnchorIds: sourceAnchors(solidVoid),
      layer: 'void/open-to-below',
      description: message,
      expected: 'Voids render as floor cutouts and optional guardrails, never as walls/slabs.',
      actual: solidVoid.map((element) => `${element.id}:${element.category}`).join(', '),
      camera: { view: 'cutaway', targetElementIds: solidVoid.map((element) => element.id) },
    });
  }

  if (home.roofSemantics?.status === 'validated' && !model.elements.some((element) => element.category === 'roofPlane')) {
    const message = 'Validated roof status requires explicit roofPlane BIM elements';
    addPackMessage(packs, 'roof-envelope', 'design', 'blocked', message);
    pushIssue(issues, {
      standardPack: 'roof-envelope',
      severity: 'blocked',
      channel: 'design',
      semanticElementIds: [],
      sourceAnchorIds: [],
      layer: 'roof/elevation',
      description: message,
      expected: 'Validated roof/elevation JSON emits roofPlane elements with ridge, eaves, thickness, and end caps.',
      actual: 'no roofPlane elements',
      camera: { view: '3d', targetElementIds: [] },
    });
  } else if (home.roofSemantics?.status !== 'validated') {
    const message = 'Roof/elevation remains provisional until paired roof/elevation JSON is attached';
    addPackMessage(packs, 'roof-envelope', 'design', 'warning', message);
    pushIssue(issues, {
      standardPack: 'roof-envelope',
      severity: 'warning',
      channel: 'design',
      semanticElementIds: [],
      sourceAnchorIds: [],
      layer: 'roof/elevation',
      description: message,
      expected: 'Attach explicit paired roof/elevation JSON before claiming validated roof output.',
      actual: home.roofSemantics?.status ?? 'missing roofSemantics',
      camera: { view: '3d', targetElementIds: [] },
    });
  }

  const drift = home.pairedArtifactInfo?.visualDrift;
  if (drift?.metrics) {
    const sourceMissRate = (drift.metrics.primitiveSourceMissRate as number | undefined) ?? drift.metrics.sourceMissRate ?? 0;
    const renderExtraRate = (drift.metrics.primitiveRenderExtraRate as number | undefined) ?? drift.metrics.renderExtraRate ?? 0;
    const edgeSourceMissRate = (drift.metrics.primitiveEdgeSourceMissRate as number | undefined) ?? drift.metrics.edgeSourceMissRate ?? 0;
    const edgeRenderExtraRate = (drift.metrics.primitiveEdgeRenderExtraRate as number | undefined) ?? drift.metrics.edgeRenderExtraRate ?? 0;
    const fullSourceMissRate = drift.metrics.sourceMissRate ?? sourceMissRate;
    const fullRenderExtraRate = drift.metrics.renderExtraRate ?? renderExtraRate;
    const fullEdgeSourceMissRate = drift.metrics.edgeSourceMissRate ?? edgeSourceMissRate;
    const fullEdgeRenderExtraRate = drift.metrics.edgeRenderExtraRate ?? edgeRenderExtraRate;
    const blockedBySemanticDrift =
      edgeSourceMissRate > 0.11 ||
      edgeRenderExtraRate > 0.08;
    const blockedByPresentationDrift =
      !blockedBySemanticDrift &&
      (
        fullSourceMissRate > 0.28 ||
        fullRenderExtraRate > 0.28 ||
        fullEdgeSourceMissRate > 0.11 ||
        fullEdgeRenderExtraRate > 0.08
      );
    if (blockedBySemanticDrift) {
      // Drift vs the GPT proposal image is advisory: paired semantic JSON is
      // the source of truth, so image-imitation distance never blocks.
      const message = `Source proposal and deterministic render drift exceeds the advisory target: primitive source miss ${(sourceMissRate * 100).toFixed(1)}%, primitive render extra ${(renderExtraRate * 100).toFixed(1)}%, edge miss ${(edgeSourceMissRate * 100).toFixed(1)}%, edge extra ${(edgeRenderExtraRate * 100).toFixed(1)}%, full source miss ${(fullSourceMissRate * 100).toFixed(1)}%, full render extra ${(fullRenderExtraRate * 100).toFixed(1)}%, full edge miss ${(fullEdgeSourceMissRate * 100).toFixed(1)}%, full edge extra ${(fullEdgeRenderExtraRate * 100).toFixed(1)}%`;
      addPackMessage(packs, 'design-basic', 'design', 'warning', message);
      pushIssue(issues, {
        standardPack: 'design-basic',
        severity: 'warning',
        channel: 'design',
        semanticElementIds: [],
        sourceAnchorIds: [],
        layer: 'level frames',
        description: message,
        expected: 'Compare/Overlay shows source GPT proposal, semantic JSON, deterministic render, and Product 3D as the same design.',
        actual: JSON.stringify(drift.metrics),
        camera: { view: 'plan', targetElementIds: [] },
      });
    } else if (blockedByPresentationDrift) {
      const message = `Source proposal and deterministic render pass primitive edge drift but still need presentation repair: primitive source miss ${(sourceMissRate * 100).toFixed(1)}%, primitive render extra ${(renderExtraRate * 100).toFixed(1)}%, edge miss ${(edgeSourceMissRate * 100).toFixed(1)}%, edge extra ${(edgeRenderExtraRate * 100).toFixed(1)}%, full source miss ${(fullSourceMissRate * 100).toFixed(1)}%, full render extra ${(fullRenderExtraRate * 100).toFixed(1)}%, full edge miss ${(fullEdgeSourceMissRate * 100).toFixed(1)}%, full edge extra ${(fullEdgeRenderExtraRate * 100).toFixed(1)}%`;
      addPackMessage(packs, 'design-basic', 'design', 'warning', message);
      pushIssue(issues, {
        standardPack: 'design-basic',
        severity: 'warning',
        channel: 'design',
        semanticElementIds: [],
        sourceAnchorIds: [],
        layer: 'labels',
        description: message,
        expected: 'Primitive source/render geometry is aligned; renderer drawing profile then repairs wall weights, dashed lines, labels, and fixture style.',
        actual: JSON.stringify(drift.metrics),
        camera: { view: 'plan', targetElementIds: [] },
      });
    }
  } else {
    const message = 'Source-vs-render visual drift report is missing';
    addPackMessage(packs, 'design-basic', 'design', 'warning', message);
  }

  if (home.buildValidation) {
    for (const message of [...home.buildValidation.blockers, ...home.buildValidation.warnings]) {
      addPackMessage(packs, 'manufacturing-panel-grid', 'manufacturing', 'warning', message);
      pushIssue(issues, {
        standardPack: 'manufacturing-panel-grid',
        severity: 'warning',
        channel: 'manufacturing',
        semanticElementIds: [],
        sourceAnchorIds: [],
        layer: 'walls',
        description: `Manufacturing readiness: ${message}`,
        expected: 'Module grid, panel SKU, spans, and build-kit constraints optimized after design quality passes.',
        actual: message,
      });
    }
  } else {
    const message = 'Manufacturing panel-grid validation has not run';
    addPackMessage(packs, 'manufacturing-panel-grid', 'manufacturing', 'warning', message);
  }

  const ifcMessage = 'Full IFC STEP writing is experimental; semantic_bim_v1/buildable_bim_v1 is the stable BIM handoff';
  addPackMessage(packs, 'export-ifc-experimental', 'export', 'warning', ifcMessage);
  pushIssue(issues, {
    standardPack: 'export-ifc-experimental',
    severity: 'warning',
    channel: 'export',
    semanticElementIds: [],
    sourceAnchorIds: [],
    layer: 'dimensions',
    description: ifcMessage,
    expected: 'Export packet includes stable semantic BIM JSON and marks IFC STEP as experimental.',
    actual: model.ifcExport.status,
  });

  const accessibilityMessage = 'Accessibility checks are optional/advisory until a target accessibility profile is selected';
  addPackMessage(packs, 'accessibility-optional', 'accessibility', 'warning', accessibilityMessage);

  const codeAdvisory = codeAdvisoryReport(codeAdvisoryInputFromHome(home));
  ensurePack('code-advisory-dimensional', 'codeAdvisory');
  for (const item of codeAdvisory.findings) {
    if (item.status === 'pass') continue;
    const where = item.subjectLabel ? `${item.subjectLabel}: ` : '';
    const message = `[${item.ruleId}] ${where}${item.detail} (${item.citation})`;
    addPackMessage(packs, 'code-advisory-dimensional', 'codeAdvisory', 'warning', message);
    if (item.status === 'fail') {
      pushIssue(issues, {
        standardPack: 'code-advisory-dimensional',
        severity: 'warning',
        channel: 'codeAdvisory',
        semanticElementIds: item.subjectId ? [item.subjectId] : [],
        sourceAnchorIds: [],
        layer: 'level frames',
        description: message,
        expected: item.citation,
        actual: item.detail,
        camera: { view: 'plan', targetElementIds: item.subjectId ? [item.subjectId] : [] },
      });
    }
  }

  const packList = [...packs.values()];
  for (const pack of packList) finalizePack(pack);
  const channels: StandardsValidationResult['channels'] = {
    design: [],
    manufacturing: [],
    export: [],
    accessibility: [],
    codeAdvisory: [],
  };
  for (const pack of packList) channels[pack.channel].push(pack);

  return {
    registryVersion: STANDARD_REGISTRY_VERSION,
    legalCompliance: 'not-claimed',
    statement: standardsRegistrySummary().statement,
    channels,
    packs: packList,
    issues,
    codeAdvisory,
  };
}
