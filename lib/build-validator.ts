import type {
  BuildBomItem,
  BuildValidationReport,
  BuildValidationRule,
  ComponentCategory,
  DenHome,
  SourceWallSegment,
} from './types';

const FT_PER_M = 3.280839895;
const PANEL_WIDTH_FT = 1.2 * FT_PER_M;
const PANEL_TOLERANCE_FT = 0.16;
const WALL_HEIGHT_SKUS_FT = [2.4 * FT_PER_M, 3.0 * FT_PER_M];
const WALL_HEIGHT_TOLERANCE_FT = 0.18;
const MAX_JOIST_SPAN_FT = 16;
const ROOF_PITCH_SKUS_DEG = [0, 12, 25, 45, 60, 72];
const ROOF_PITCH_TOLERANCE_DEG = 2.5;

type RuleDraft = {
  id: string;
  label: string;
  blockers: string[];
  warnings: string[];
  passes: string[];
};

function createRule(id: string, label: string): RuleDraft {
  return { id, label, blockers: [], warnings: [], passes: [] };
}

function finalizeRule(rule: RuleDraft): BuildValidationRule {
  return {
    id: rule.id,
    label: rule.label,
    status: rule.blockers.length ? 'blocked' : rule.warnings.length ? 'warning' : 'pass',
    details: [...rule.blockers, ...rule.warnings, ...rule.passes],
  };
}

function wallLengthFt(wall: SourceWallSegment): number {
  return Math.hypot((wall.x2 - wall.x1) * 4, (wall.z2 - wall.z1) * 4);
}

function nearestMultipleDelta(value: number, module: number): { count: number; delta: number } {
  const count = Math.max(1, Math.round(value / module));
  return { count, delta: Math.abs(value - count * module) };
}

function isOnModule(value: number, module = PANEL_WIDTH_FT, tolerance = PANEL_TOLERANCE_FT): boolean {
  return nearestMultipleDelta(Math.abs(value), module).delta <= tolerance;
}

function nearestSku(value: number, skus: number[]): { sku: number; delta: number } {
  return skus.reduce((best, sku) => {
    const delta = Math.abs(value - sku);
    return delta < best.delta ? { sku, delta } : best;
  }, { sku: skus[0], delta: Math.abs(value - skus[0]) });
}

function inferredWallHeight(home: DenHome, wall: SourceWallSegment): { height: number; source: string } {
  if (wall.exterior) {
    const eave = home.roofSemantics?.eaveHeightFt;
    if (Number.isFinite(eave) && (eave ?? 0) > 1) return { height: eave!, source: 'roof eave' };
    if (home.roofStyle === 'a-frame') return { height: WALL_HEIGHT_SKUS_FT[1], source: 'a-frame default wall module' };
    return { height: WALL_HEIGHT_SKUS_FT[1], source: 'default exterior wall module' };
  }
  return { height: WALL_HEIGHT_SKUS_FT[0], source: 'default interior wall module' };
}

function wallAxis(wall: SourceWallSegment): 'x' | 'z' {
  if (wall.bounds) {
    if (wall.bounds.w > wall.bounds.d * 1.25) return 'x';
    if (wall.bounds.d > wall.bounds.w * 1.25) return 'z';
  }
  return Math.abs(wall.x2 - wall.x1) >= Math.abs(wall.z2 - wall.z1) ? 'x' : 'z';
}

function openingOffsetAlongWall(wall: SourceWallSegment, point: { x: number; z: number }): number {
  if (wallAxis(wall) === 'x') return Math.abs(point.x - wall.x1) * 4;
  return Math.abs(point.z - wall.z1) * 4;
}

function matchingWall(home: DenHome, opening: NonNullable<DenHome['sourceOpenings']>[number]): SourceWallSegment | undefined {
  const walls = home.sourceWalls ?? [];
  if (opening.wallId) {
    const byId = walls.find((wall) => wall.id === opening.wallId);
    if (byId) return byId;
    const hostSegments = walls.filter((wall) => {
      if ((wall.floor ?? 0) !== (opening.floor ?? 0)) return false;
      const ids = [wall.id, wall.sourceAnchorId].filter(Boolean);
      return ids.some((id) => id === opening.wallId || String(id).startsWith(`${opening.wallId}:seg-`));
    });
    if (hostSegments.length) {
      const vertical = hostSegments.every((wall) => wallAxis(wall) === 'z');
      const horizontal = hostSegments.every((wall) => wallAxis(wall) === 'x');
      if (vertical || horizontal) {
        return {
          ...hostSegments[0],
          id: opening.wallId,
          x1: vertical
            ? hostSegments.reduce((sum, wall) => sum + (wall.bounds ? wall.bounds.x + wall.bounds.w / 2 : (wall.x1 + wall.x2) / 2), 0) / hostSegments.length
            : Math.min(...hostSegments.map((wall) => wall.bounds ? wall.bounds.x : Math.min(wall.x1, wall.x2))),
          x2: vertical
            ? hostSegments.reduce((sum, wall) => sum + (wall.bounds ? wall.bounds.x + wall.bounds.w / 2 : (wall.x1 + wall.x2) / 2), 0) / hostSegments.length
            : Math.max(...hostSegments.map((wall) => wall.bounds ? wall.bounds.x + wall.bounds.w : Math.max(wall.x1, wall.x2))),
          z1: horizontal
            ? hostSegments.reduce((sum, wall) => sum + (wall.bounds ? wall.bounds.z + wall.bounds.d / 2 : (wall.z1 + wall.z2) / 2), 0) / hostSegments.length
            : Math.min(...hostSegments.map((wall) => wall.bounds ? wall.bounds.z : Math.min(wall.z1, wall.z2))),
          z2: horizontal
            ? hostSegments.reduce((sum, wall) => sum + (wall.bounds ? wall.bounds.z + wall.bounds.d / 2 : (wall.z1 + wall.z2) / 2), 0) / hostSegments.length
            : Math.max(...hostSegments.map((wall) => wall.bounds ? wall.bounds.z + wall.bounds.d : Math.max(wall.z1, wall.z2))),
        };
      }
    }
  }
  const ox1 = opening.x1;
  const oz1 = opening.z1;
  const ox2 = opening.x2;
  const oz2 = opening.z2;
  const openingHorizontal = Math.abs(oz1 - oz2) < 0.02;
  return walls.find((wall) => {
    if ((wall.floor ?? 0) !== (opening.floor ?? 0)) return false;
    const wallHorizontal = wallAxis(wall) === 'x';
    if (wallHorizontal !== openingHorizontal) return false;
    const centerX = wall.bounds ? wall.bounds.x + wall.bounds.w / 2 : wall.x1;
    const centerZ = wall.bounds ? wall.bounds.z + wall.bounds.d / 2 : wall.z1;
    if (wallHorizontal) {
      if (Math.abs(centerZ - oz1) > 0.08) return false;
      const minX = wall.bounds ? wall.bounds.x : Math.min(wall.x1, wall.x2);
      const maxX = wall.bounds ? wall.bounds.x + wall.bounds.w : Math.max(wall.x1, wall.x2);
      return Math.max(Math.min(ox1, ox2), Math.min(wall.x1, wall.x2)) <=
        Math.min(Math.max(ox1, ox2), maxX) + 0.02 &&
        Math.max(Math.min(ox1, ox2), minX) <= Math.min(Math.max(ox1, ox2), maxX) + 0.02;
    }
    if (Math.abs(centerX - ox1) > 0.08) return false;
    const minZ = wall.bounds ? wall.bounds.z : Math.min(wall.z1, wall.z2);
    const maxZ = wall.bounds ? wall.bounds.z + wall.bounds.d : Math.max(wall.z1, wall.z2);
    return Math.max(Math.min(oz1, oz2), minZ) <=
      Math.min(Math.max(oz1, oz2), maxZ) + 0.02;
  });
}

function addBom(map: Map<string, BuildBomItem>, item: BuildBomItem) {
  const existing = map.get(item.componentId);
  if (existing) {
    existing.quantity += item.quantity;
    existing.notes = [...new Set([...(existing.notes ?? []), ...(item.notes ?? [])])];
    return;
  }
  map.set(item.componentId, { ...item, notes: item.notes ? [...item.notes] : undefined });
}

function componentForRoof(home: DenHome, pitchDeg: number): string {
  if (home.roofStyle === 'flat' || pitchDeg < 4) return 'roof-flat';
  if (home.roofStyle === 'shed') return 'roof-shed';
  if (home.roofStyle === 'steep-gable' || pitchDeg >= 38) return 'roof-steep';
  return 'roof-gable';
}

function roofPitchDeg(home: DenHome): number {
  if (home.roofStyle === 'flat') return 0;
  const ridge = home.roofSemantics?.ridgeHeightFt ?? home.height;
  const eave = home.roofSemantics?.eaveHeightFt ?? Math.max(7, home.height * 0.45);
  const axis = home.roofSemantics?.ridgeAxis ?? 'x';
  const run = Math.max(0.1, (axis === 'x' ? home.footprint.depth : home.footprint.width) / 2);
  return Math.atan(Math.max(0, ridge - eave) / run) * 180 / Math.PI;
}

function statusFrom(blockers: string[], warnings: string[]): BuildValidationReport['status'] {
  if (blockers.length) return 'blocked';
  if (warnings.length) return 'warning';
  return 'pass';
}

export function validateBuildability(home: DenHome): BuildValidationReport {
  const assumptions = [
    `module panel width: 1.2m / ${PANEL_WIDTH_FT.toFixed(2)}ft`,
    `wall height SKUs: ${WALL_HEIGHT_SKUS_FT.map((sku) => `${sku.toFixed(2)}ft`).join(', ')}`,
    `maximum simple floor joist span: ${MAX_JOIST_SPAN_FT}ft`,
  ];
  const bom = new Map<string, BuildBomItem>();
  const rules = {
    wallModule: createRule('wall-module', 'Wall length follows 1.2m panel module'),
    wallHeight: createRule('wall-height', 'Wall heights use 2.4m or 3.0m SKU'),
    openings: createRule('openings', 'Openings fit panels or align to joints'),
    floorSpan: createRule('floor-span', 'Floor span is within joist limit'),
    roofPitch: createRule('roof-pitch', 'Roof pitch matches rafter SKU'),
    bom: createRule('bom', 'BOM and componentsUsed are generated'),
  };

  const walls = home.sourceWalls ?? [];
  if (!walls.length) {
    rules.wallModule.blockers.push('No source wall graph is available for modular wall validation.');
  }

  let exteriorWallPanels = 0;
  let interiorWallPanels = 0;
  for (const wall of walls) {
    const length = wallLengthFt(wall);
    if (length < 0.05) continue;
    const moduleDelta = nearestMultipleDelta(length, PANEL_WIDTH_FT);
    const label = wall.id ?? `${wall.exterior ? 'exterior' : 'interior'} wall`;
    if (moduleDelta.delta > PANEL_TOLERANCE_FT) {
      rules.wallModule.blockers.push(`${label} is ${length.toFixed(2)}ft, not N x 1.2m (nearest ${moduleDelta.count} panels is ${(moduleDelta.count * PANEL_WIDTH_FT).toFixed(2)}ft).`);
    }
    const panelCount = Math.max(1, Math.ceil(length / PANEL_WIDTH_FT));
    if (wall.exterior) exteriorWallPanels += panelCount;
    else interiorWallPanels += panelCount;

    const inferred = inferredWallHeight(home, wall);
    const sku = nearestSku(inferred.height, WALL_HEIGHT_SKUS_FT);
    if (sku.delta > WALL_HEIGHT_TOLERANCE_FT) {
      rules.wallHeight.blockers.push(`${label} ${inferred.source} height ${inferred.height.toFixed(2)}ft is not a 2.4m/3.0m wall SKU.`);
    }
  }
  if (walls.length && !rules.wallModule.blockers.length) rules.wallModule.passes.push(`${walls.length} source walls align with panel multiples.`);
  if (walls.length && !rules.wallHeight.blockers.length) rules.wallHeight.passes.push(`${walls.length} source walls map to known wall height SKUs or explicit assumptions.`);

  addBom(bom, {
    componentId: 'wall-ext',
    description: 'Exterior wall panel, 1.2m module',
    category: 'wall',
    quantity: exteriorWallPanels,
    unit: 'each',
    notes: exteriorWallPanels ? ['Derived from source exterior wall graph.'] : ['No exterior wall panels found.'],
  });
  if (interiorWallPanels) {
    addBom(bom, {
      componentId: 'wall-int',
      description: 'Interior wall panel, 1.2m module',
      category: 'wall',
      quantity: interiorWallPanels,
      unit: 'each',
      notes: ['Derived from source interior wall graph.'],
    });
  }

  const openings = home.sourceOpenings ?? [];
  for (const opening of openings) {
    const length = Math.hypot((opening.x2 - opening.x1) * 4, (opening.z2 - opening.z1) * 4);
    const label = opening.id ?? `${opening.kind} opening`;
    const wall = matchingWall(home, opening);
    if (!wall) {
      rules.openings.blockers.push(`${label} is not tied to a source wall.`);
      continue;
    }
    const startOffset = openingOffsetAlongWall(wall, { x: opening.x1, z: opening.z1 });
    const endOffset = openingOffsetAlongWall(wall, { x: opening.x2, z: opening.z2 });
    const alignsToJoints = isOnModule(startOffset) && isOnModule(endOffset);
    const fitsOnePanel = length <= PANEL_WIDTH_FT + PANEL_TOLERANCE_FT;
    if (!alignsToJoints && !fitsOnePanel) {
      rules.openings.blockers.push(`${label} is ${length.toFixed(2)}ft and does not fit one panel or align to module joints.`);
    }
    if (opening.kind === 'door') {
      addBom(bom, {
        componentId: opening.roomIds?.includes('exterior') ? 'door-ext' : 'door-int',
        description: opening.roomIds?.includes('exterior') ? 'Exterior door unit' : 'Interior door unit',
        category: 'opening',
        quantity: 1,
        unit: 'each',
      });
    }
    if (opening.kind === 'window') {
      addBom(bom, {
        componentId: 'window-std',
        description: 'Window unit',
        category: 'opening',
        quantity: 1,
        unit: 'each',
      });
    }
  }
  if (openings.length && !rules.openings.blockers.length) rules.openings.passes.push(`${openings.length} openings fit panel/opening constraints.`);
  if (!openings.length) rules.openings.warnings.push('No source openings were available for opening-module validation.');

  const structuralSpan = Math.min(home.footprint.width, home.footprint.depth);
  if (structuralSpan > MAX_JOIST_SPAN_FT) {
    rules.floorSpan.blockers.push(`Simple floor span ${structuralSpan.toFixed(1)}ft exceeds ${MAX_JOIST_SPAN_FT}ft max joist span; add beams or split the floor system.`);
  } else {
    rules.floorSpan.passes.push(`Simple floor span ${structuralSpan.toFixed(1)}ft is within the ${MAX_JOIST_SPAN_FT}ft joist limit.`);
  }
  addBom(bom, {
    componentId: 'floor-std',
    description: 'Floor cassette, 1.2m grid',
    category: 'floor',
    quantity: Math.ceil(home.footprint.width / PANEL_WIDTH_FT) * Math.ceil(home.footprint.depth / PANEL_WIDTH_FT),
    unit: 'each',
  });
  addBom(bom, {
    componentId: 'foundation',
    description: 'Foundation sill module',
    category: 'structural',
    quantity: Math.ceil((home.footprint.width * 2 + home.footprint.depth * 2) / PANEL_WIDTH_FT),
    unit: 'each',
  });

  const deckPanels = home.rooms
    .filter((room) => /deck|porch|patio/i.test(`${room.type} ${room.label}`))
    .reduce((count, room) => count + Math.ceil((room.gw * 4) / PANEL_WIDTH_FT) * Math.ceil((room.gd * 4) / PANEL_WIDTH_FT), 0);
  if (deckPanels) {
    addBom(bom, {
      componentId: 'floor-deck',
      description: 'Exterior deck panel, 1.2m grid',
      category: 'floor',
      quantity: deckPanels,
      unit: 'each',
    });
  }

  const pitch = roofPitchDeg(home);
  const pitchSku = nearestSku(pitch, ROOF_PITCH_SKUS_DEG);
  if (pitchSku.delta > ROOF_PITCH_TOLERANCE_DEG) {
    rules.roofPitch.blockers.push(`Roof pitch ${pitch.toFixed(1)}deg does not match available rafter SKUs (${ROOF_PITCH_SKUS_DEG.join(', ')}deg).`);
  } else {
    rules.roofPitch.passes.push(`Roof pitch ${pitch.toFixed(1)}deg matches ${pitchSku.sku}deg rafter SKU.`);
  }
  const roofComponent = componentForRoof(home, pitch);
  addBom(bom, {
    componentId: roofComponent,
    description: 'Roof panel/rafter module',
    category: 'roof',
    quantity: Math.max(1, Math.ceil(home.footprint.width / PANEL_WIDTH_FT) * (home.roofStyle === 'flat' ? Math.ceil(home.footprint.depth / PANEL_WIDTH_FT) : 2)),
    unit: 'each',
    notes: [home.roofSemantics?.status === 'validated' ? 'Uses paired roof/elevation semantics.' : 'Roof quantity is provisional until roof/elevation JSON is validated.'],
  });

  const bomItems = [...bom.values()].filter((item) => item.quantity > 0);
  if (!bomItems.length) rules.bom.blockers.push('No BOM items were generated.');
  else rules.bom.passes.push(`${bomItems.length} BOM line items generated.`);

  const finalized = Object.values(rules).map(finalizeRule);
  const blockers = [...new Set(Object.values(rules).flatMap((rule) => rule.blockers))];
  const warnings = [...new Set(Object.values(rules).flatMap((rule) => rule.warnings))];
  const componentsUsed = [...new Set(bomItems.map((item) => item.componentId))].sort();
  return {
    status: statusFrom(blockers, warnings),
    blockers,
    warnings,
    rules: finalized,
    bom: bomItems.sort((a, b) => a.componentId.localeCompare(b.componentId)),
    componentsUsed,
    assumptions,
  };
}
