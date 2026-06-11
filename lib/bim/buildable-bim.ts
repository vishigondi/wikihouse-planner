import type { DenHome } from '@/lib/types';
import { semanticBimFromHome, type SemanticBimElement, type SemanticBimModel } from './semantic-bim';

export interface BuildableBimConstraintReport {
  status: 'pass' | 'warning' | 'blocked';
  blockers: string[];
  warnings: string[];
}

export type BuildableBimModel = SemanticBimModel & {
  buildableSchemaVersion: 'buildable_bim_v1';
  constraints: BuildableBimConstraintReport;
};

function cloneElement(element: SemanticBimElement): SemanticBimElement {
  return {
    ...element,
    bounds: element.bounds ? { ...element.bounds } : undefined,
    segment: element.segment ? { ...element.segment } : undefined,
    points: element.points ? element.points.map((point) => ({ ...point })) : undefined,
    metadata: element.metadata ? { ...element.metadata } : undefined,
    component: element.component ? {
      ...element.component,
      dimensions: { ...element.component.dimensions },
      hostConstraints: element.component.hostConstraints.map((host) => ({ ...host, allowedCategories: [...host.allowedCategories] })),
      clearanceRules: element.component.clearanceRules.map((rule) => ({ ...rule })),
      proceduralFallback: { ...element.component.proceduralFallback },
      twoDSymbol: { ...element.component.twoDSymbol },
      marketplaceAssets: element.component.marketplaceAssets.map((asset) => ({ ...asset, preferredFormats: [...asset.preferredFormats] })),
      validationRules: element.component.validationRules.map((rule) => ({ ...rule })),
    } : undefined,
  };
}

function clipWallsToRoof(home: DenHome, elements: SemanticBimElement[]) {
  const roof = home.roofSemantics;
  if (!roof || roof.status !== 'validated') return;

  const eave = roof.eaveHeightFt;
  const ridge = roof.ridgeHeightFt;
  const ridgeAxis = roof.ridgeAxis ?? 'x';
  const depthAcrossSlope = ridgeAxis === 'x' ? home.footprint.depth : home.footprint.width;
  const ridgeCross = depthAcrossSlope / 2;
  const halfSpan = Math.max(0.5, depthAcrossSlope / 2 + (roof.overhangFt ?? 0));
  const roofHeightAtCrossCoord = (coordFt: number) => {
    const normalizedDistance = Math.min(1, Math.abs(coordFt - ridgeCross) / halfSpan);
    return eave + (ridge - eave) * (1 - normalizedDistance);
  };
  const segmentRoofHeights = (element: SemanticBimElement) => {
    if (!element.segment) return [ridge];
    const c1 = ridgeAxis === 'x' ? element.segment.z1 : element.segment.x1;
    const c2 = ridgeAxis === 'x' ? element.segment.z2 : element.segment.x2;
    const midpoint = (c1 + c2) / 2;
    return [roofHeightAtCrossCoord(c1), roofHeightAtCrossCoord(c2), roofHeightAtCrossCoord(midpoint)];
  };
  const maxRoofHeightAtSegment = (element: SemanticBimElement) => Math.max(...segmentRoofHeights(element));
  const roofHeightAtSegmentMidpoint = (element: SemanticBimElement) => {
    if (!element.segment) return ridge;
    const midpointCross = ridgeAxis === 'x'
      ? (element.segment.z1 + element.segment.z2) / 2
      : (element.segment.x1 + element.segment.x2) / 2;
    return roofHeightAtCrossCoord(midpointCross);
  };
  for (const element of elements) {
    if (element.category !== 'wall' || !element.segment) continue;
    const exterior = element.metadata?.exterior === true;
    const aFrame = /a-frame/i.test(`${roof.style ?? ''} ${home.roofStyle ?? ''}`);
    const roofTop = roofHeightAtSegmentMidpoint(element);
    if (exterior && aFrame) {
      const dx = Math.abs(element.segment.x2 - element.segment.x1);
      const dz = Math.abs(element.segment.z2 - element.segment.z1);
      const ridgeAxis = roof.ridgeAxis ?? 'x';
      const parallelToRidge = ridgeAxis === 'x' ? dx >= dz : dz >= dx;
      // A-frame long side/eave wall traces are low bearing/knee walls. Gable-end
      // traces remain full-height vertical walls. Clipping every exterior wall
      // to the eave creates one-foot walls; keeping every exterior wall full
      // height creates a box inside the roof.
      element.metadata = {
        ...element.metadata,
        wallRole: parallelToRidge ? 'aFrameEaveKneeWall' : 'aFrameGableEndWall',
        heightPolicy: parallelToRidge ? 'clip-to-eave-knee-wall' : 'full-height-gable-end',
        // The renderer needs the ridge axis to route walls correctly; without
        // it, ridge-along-z plans get eave walls misread as gables (sail fins).
        roofRidgeAxis: ridgeAxis,
        roofStyle: 'a-frame',
        roofEaveHeightFt: eave,
        roofRidgeHeightFt: ridge,
        roofDepthFt: home.footprint.depth,
        roofWidthFt: home.footprint.width,
        roofProfileHeightAtMidpointFt: roofTop,
        roofProfileMinHeightFt: Math.min(...segmentRoofHeights(element)),
        roofProfileMaxHeightFt: Math.max(...segmentRoofHeights(element)),
      };
      const kneeWallHeight = Math.max(2.8, Math.min(4.2, eave - element.segment.y1));
      element.segment.height = parallelToRidge
        ? kneeWallHeight
        : Math.max(0.45, ridge - element.segment.y1);
      continue;
    }
    const maxClippedHeight = Math.max(0.45, maxRoofHeightAtSegment(element) - element.segment.y1);
    if (!exterior) {
      // Interior partitions should stay at storey height for ordinary gable
      // plans. Clipping every partition to the roof profile creates uneven
      // wall heights and pillar-like artifacts in the product BIM view.
      element.metadata = {
        ...element.metadata,
        wallRole: 'interiorPartition',
        heightPolicy: 'storey-height-below-roof-envelope',
        roofProfileHeightAtMidpointFt: roofTop,
        roofProfileMaxHeightFt: maxRoofHeightAtSegment(element),
      };
      continue;
    }
    element.metadata = {
      ...element.metadata,
      wallRole: 'exteriorWall',
      heightPolicy: 'clip-to-roof-envelope',
      roofProfileHeightAtMidpointFt: roofTop,
      roofProfileMaxHeightFt: maxRoofHeightAtSegment(element),
    };
    element.segment.height = Math.max(0.45, Math.min(element.segment.height, maxClippedHeight));
  }
}

function validateWallRoles(home: DenHome, elements: SemanticBimElement[], warnings: string[]) {
  const aFrame = /a-frame/i.test(`${home.roofSemantics?.style ?? ''} ${home.roofStyle ?? ''}`);
  if (!aFrame) return;
  const unclassifiedAFrameWalls = elements.filter((element) => (
    element.category === 'wall' &&
    !element.metadata?.wallRole &&
    /a-frame|gable|eave|roof/i.test(`${element.metadata?.wallKind ?? ''} ${element.name}`)
  ));
  if (unclassifiedAFrameWalls.length) {
    warnings.push(`${unclassifiedAFrameWalls.length} A-frame wall element(s) lack explicit wallRole metadata`);
  }
}

function validateBuildableBim(home: DenHome, elements: SemanticBimElement[]): BuildableBimConstraintReport {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const solidVoid = elements.some((element) => (
    element.category === 'slab' &&
    /void|open.to.below/i.test(`${element.sourceRoomId ?? ''} ${element.name}`)
  ));
  if (solidVoid) blockers.push('void/open-to-below is represented by solid BIM geometry');

  const roofPlanes = elements.filter((element) => element.category === 'roofPlane');
  if (home.roofSemantics?.status === 'validated' && !roofPlanes.length) {
    blockers.push('validated roof status requires roofPlane BIM elements');
  }
  if (home.roofSemantics?.status !== 'validated') {
    warnings.push('roof/elevation remains provisional until paired roof/elevation JSON is attached');
  }

  const fixturesWithoutAsset = elements.filter((element) => (
    ['sanitaryTerminal', 'furniture', 'equipment', 'fixtureProxy'].includes(element.category) &&
    !element.metadata?.assetKey
  ));
  if (fixturesWithoutAsset.length) warnings.push(`${fixturesWithoutAsset.length} fixture/furniture BIM element(s) are missing asset registry keys`);

  const genericFixtureProxies = elements.filter((element) => element.category === 'fixtureProxy');
  if (genericFixtureProxies.length) {
    blockers.push(
      `${genericFixtureProxies.length} generic fixture proxy BIM element(s) remain; classify fixture type, room, orientation, and component key before product/brochure export`,
    );
  }

  const openingsWithoutWall = elements.filter((element) => (
    ['door', 'window', 'opening'].includes(element.category) &&
    !element.metadata?.wallId
  ));
  if (openingsWithoutWall.length) warnings.push(`${openingsWithoutWall.length} opening BIM element(s) are not explicitly hosted by a wall`);
  validateWallRoles(home, elements, warnings);

  const componentCategories = new Set([
    'wall',
    'guardrail',
    'slab',
    'deck',
    'opening',
    'door',
    'window',
    'stair',
    'roofPlane',
    'sanitaryTerminal',
    'furniture',
    'equipment',
    'fixtureProxy',
  ]);
  const componentElements = elements.filter((element) => componentCategories.has(element.category));
  for (const element of componentElements) {
    const component = element.component;
    if (!component) {
      blockers.push(`${element.id} is missing BIM component resolver output`);
      continue;
    }
    if (!component.ifcClass || component.ifcClass !== element.ifcClass) {
      blockers.push(`${element.id} component IFC class does not match element IFC class`);
    }
    if (!component.dimensions) blockers.push(`${element.id} component is missing standard dimensions`);
    if (!component.hostConstraints?.length) blockers.push(`${element.id} component is missing host constraints`);
    if (!component.proceduralFallback?.renderer || component.proceduralFallback.preservesSemanticBounds !== true) {
      blockers.push(`${element.id} component is missing deterministic procedural fallback geometry`);
    }
    if (!component.twoDSymbol?.symbol) blockers.push(`${element.id} component is missing 2D symbol metadata`);
    if (!component.marketplaceAssets?.length) blockers.push(`${element.id} component is missing marketplace asset metadata`);
    if (!component.validationRules?.length) blockers.push(`${element.id} component is missing validation rules`);
    const requiresHost = component.hostConstraints.some((host) => host.required && host.hostType === 'wall');
    if (requiresHost && !element.metadata?.wallId && !element.metadata?.wallAnchor && !element.sourceAnchorId) {
      warnings.push(`${element.id} requires a wall host but has no explicit wall anchor metadata`);
    }
  }

  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'pass',
    blockers,
    warnings,
  };
}

export function buildableBimFromHome(home: DenHome): BuildableBimModel {
  const semantic = semanticBimFromHome(home);
  const elements = semantic.elements.map(cloneElement);
  clipWallsToRoof(home, elements);
  const constraints = validateBuildableBim(home, elements);

  return {
    ...semantic,
    buildableSchemaVersion: 'buildable_bim_v1',
    elements,
    validation: {
      ...semantic.validation,
      status: semantic.validation.status === 'blocked' || constraints.status === 'blocked'
        ? 'blocked'
        : semantic.validation.status === 'warning' || constraints.status === 'warning'
          ? 'warning'
          : 'pass',
      blockers: [...semantic.validation.blockers, ...constraints.blockers],
      warnings: [...semantic.validation.warnings, ...constraints.warnings],
    },
    constraints,
  };
}

export function buildableBimSummary(model: BuildableBimModel) {
  return {
    schemaVersion: model.buildableSchemaVersion,
    semanticSchemaVersion: model.schemaVersion,
    planId: model.planId,
    proposalId: model.proposalId,
    status: model.validation.status,
    counts: model.validation.counts,
    blockers: model.validation.blockers,
    warnings: [
      ...model.validation.warnings,
      ...model.ifcExport.blockers,
    ],
  };
}
