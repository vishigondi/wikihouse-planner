import type { SemanticBimCategory, SemanticBimElement } from './semantic-bim';

export type BimAssetFormat = 'procedural' | 'ifc' | 'rfa' | 'rvt' | 'glb' | 'gltf' | 'skp' | 'obj' | 'fbx';
export type HostType = 'none' | 'wall' | 'floor' | 'ceiling' | 'roof' | 'space' | 'slab';

export interface BimMarketplaceSource {
  id: string;
  label: string;
  role: 'bim-manufacturer' | 'visual-asset' | 'internal-procedural';
  preferredFormats: BimAssetFormat[];
  notes: string;
}

export interface BimComponentDimensions {
  widthFt?: number;
  depthFt?: number;
  heightFt?: number;
  thicknessFt?: number;
  minWidthFt?: number;
  minDepthFt?: number;
  minHeightFt?: number;
}

export interface BimHostConstraint {
  hostType: HostType;
  required: boolean;
  allowedCategories: SemanticBimCategory[];
  relationship: string;
}

export interface BimClearanceRule {
  id: string;
  label: string;
  frontFt?: number;
  sideFt?: number;
  rearFt?: number;
  radiusFt?: number;
}

export interface BimProceduralFallback {
  renderer: string;
  lod: 'symbol' | 'simple' | 'detailed';
  preservesSemanticBounds: true;
  notes: string;
}

export interface BimTwoDSymbol {
  symbol: string;
  layer: 'wall' | 'opening' | 'fixture' | 'furniture' | 'roof' | 'structure';
  stroke: string;
  fill: string;
}

export interface BimMarketplaceAssetRef {
  sourceId: string;
  sourceLabel: string;
  role: 'bim-manufacturer' | 'visual-asset' | 'internal-procedural';
  query: string;
  preferredFormats: BimAssetFormat[];
  status: 'adapter-pending' | 'procedural-ready';
  geometryAuthority: 'semantic-json';
}

export interface BimComponentValidationRule {
  id: string;
  severity: 'blocker' | 'warning';
  label: string;
}

export interface BimComponentDefinition {
  key: string;
  label: string;
  category: SemanticBimCategory;
  ifcClass: string;
  ifcPredefinedType?: string;
  dimensions: BimComponentDimensions;
  hostConstraints: BimHostConstraint[];
  clearanceRules: BimClearanceRule[];
  proceduralFallback: BimProceduralFallback;
  twoDSymbol: BimTwoDSymbol;
  marketplaceAssets: BimMarketplaceAssetRef[];
  validationRules: BimComponentValidationRule[];
}

const SOURCE_INTERNAL = {
  sourceId: 'internal-procedural',
  sourceLabel: 'Internal Procedural Symbols',
  role: 'internal-procedural' as const,
  preferredFormats: ['procedural'] as BimAssetFormat[],
  status: 'procedural-ready' as const,
  geometryAuthority: 'semantic-json' as const,
};

export const BIM_MARKETPLACE_SOURCES: BimMarketplaceSource[] = [
  {
    id: 'internal-procedural',
    label: 'Internal Procedural Symbols',
    role: 'internal-procedural',
    preferredFormats: ['procedural'],
    notes: 'Deterministic fallback symbols generated from semantic dimensions and orientation.',
  },
  {
    id: 'nbs-source',
    label: 'NBS Source',
    role: 'bim-manufacturer',
    preferredFormats: ['ifc', 'rfa', 'rvt'],
    notes: 'Spec-grade BIM objects for doors, windows, fixtures, sanitary terminals, appliances, and construction products.',
  },
  {
    id: 'bimobject',
    label: 'BIMobject',
    role: 'bim-manufacturer',
    preferredFormats: ['ifc', 'rfa', 'rvt', 'gltf', 'glb'],
    notes: 'Manufacturer-specific BIM products and metadata. Imported assets may never resize semantic plan geometry.',
  },
  {
    id: 'manufacturer-direct',
    label: 'Manufacturer Direct',
    role: 'bim-manufacturer',
    preferredFormats: ['ifc', 'rfa', 'rvt', 'glb', 'gltf'],
    notes: 'First-party BIM/GLB product files when a specified product line is selected.',
  },
  {
    id: 'sketchfab',
    label: 'Sketchfab',
    role: 'visual-asset',
    preferredFormats: ['glb', 'gltf'],
    notes: 'Presentation furniture/decor only after license, scale, and LOD checks pass.',
  },
  {
    id: 'sketchup-3d-warehouse',
    label: 'SketchUp 3D Warehouse',
    role: 'visual-asset',
    preferredFormats: ['skp', 'gltf', 'glb'],
    notes: 'Visual furniture source. Use semantic bounds as authority; mesh scale is adapted to the plan, not the reverse.',
  },
];

function marketplace(sourceId: string, query: string, formats?: BimAssetFormat[]): BimMarketplaceAssetRef {
  const source = BIM_MARKETPLACE_SOURCES.find((item) => item.id === sourceId) ?? BIM_MARKETPLACE_SOURCES[0];
  return {
    sourceId: source.id,
    sourceLabel: source.label,
    role: source.role,
    query,
    preferredFormats: formats ?? source.preferredFormats,
    status: source.id === 'internal-procedural' ? 'procedural-ready' : 'adapter-pending',
    geometryAuthority: 'semantic-json',
  };
}

function component(
  key: string,
  label: string,
  category: SemanticBimCategory,
  ifcClass: string,
  options: Omit<BimComponentDefinition, 'key' | 'label' | 'category' | 'ifcClass'>,
): BimComponentDefinition {
  return { key, label, category, ifcClass, ...options };
}

const WALL_HOST: BimHostConstraint = {
  hostType: 'floor',
  required: true,
  allowedCategories: ['slab', 'deck'],
  relationship: 'wall baseline is supported by a floor/deck slab',
};

const WALL_OPENING_HOST: BimHostConstraint = {
  hostType: 'wall',
  required: true,
  allowedCategories: ['wall'],
  relationship: 'opening must cut one source wall segment',
};

const FLOOR_HOST: BimHostConstraint = {
  hostType: 'floor',
  required: true,
  allowedCategories: ['slab', 'deck'],
  relationship: 'component is placed on the semantic floor/room slab',
};

const WALL_BACKED: BimHostConstraint = {
  hostType: 'wall',
  required: true,
  allowedCategories: ['wall'],
  relationship: 'component must be wall-backed or have explicit wallAnchor metadata',
};

const NO_HOST: BimHostConstraint = {
  hostType: 'none',
  required: false,
  allowedCategories: [],
  relationship: 'freestanding semantic component',
};

const COMMON_RULES: BimComponentValidationRule[] = [
  { id: 'semantic-bounds-authority', severity: 'blocker', label: 'marketplace mesh cannot change semantic bounds' },
  { id: 'ifc-class-required', severity: 'blocker', label: 'component must keep its IFC class' },
  { id: 'procedural-fallback-required', severity: 'blocker', label: 'component must render without network marketplace access' },
];

export const BIM_COMPONENT_CATALOG: BimComponentDefinition[] = [
  component('wall.exterior.panelized', 'Exterior Wall / Panel', 'wall', 'IfcWall', {
    ifcPredefinedType: 'STANDARD',
    dimensions: { thicknessFt: 0.36, heightFt: 8, minHeightFt: 7 },
    hostConstraints: [WALL_HOST],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-wall-panel', lod: 'simple', preservesSemanticBounds: true, notes: 'extrude wall segment with semantic thickness/height' },
    twoDSymbol: { symbol: 'thick-wall-line', layer: 'wall', stroke: '#221f1c', fill: '#221f1c' },
    marketplaceAssets: [marketplace('internal-procedural', 'exterior wall panel'), marketplace('manufacturer-direct', 'panelized exterior wall IFC')],
    validationRules: [...COMMON_RULES, { id: 'wall-height-roof-clip', severity: 'warning', label: 'wall should clip to roof underside when roof is validated' }],
  }),
  component('wall.interior.partition', 'Interior Partition Wall', 'wall', 'IfcWall', {
    ifcPredefinedType: 'PARTITIONING',
    dimensions: { thicknessFt: 0.24, heightFt: 8, minHeightFt: 7 },
    hostConstraints: [WALL_HOST],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-partition-wall', lod: 'simple', preservesSemanticBounds: true, notes: 'extrude interior wall segment only when it is a real wall' },
    twoDSymbol: { symbol: 'thin-wall-line', layer: 'wall', stroke: '#5c554d', fill: '#5c554d' },
    marketplaceAssets: [marketplace('internal-procedural', 'interior partition wall')],
    validationRules: [...COMMON_RULES, { id: 'not-void-marker', severity: 'blocker', label: 'void/open-to-below markers cannot resolve to partition walls' }],
  }),
  component('opening.door.swing', 'Swing Door', 'door', 'IfcDoor', {
    ifcPredefinedType: 'DOOR',
    dimensions: { widthFt: 3, heightFt: 6.67, thicknessFt: 0.12, minWidthFt: 2.5 },
    hostConstraints: [WALL_OPENING_HOST],
    clearanceRules: [{ id: 'door-swing-clear', label: 'door swing clearance', radiusFt: 3 }],
    proceduralFallback: { renderer: 'procedural-swing-door', lod: 'simple', preservesSemanticBounds: true, notes: 'draw wall cut, door leaf, hinge side, and swing arc from semantic opening' },
    twoDSymbol: { symbol: 'swing-door-arc', layer: 'opening', stroke: '#6b6258', fill: 'none' },
    marketplaceAssets: [marketplace('internal-procedural', 'swing door'), marketplace('nbs-source', 'single swing internal external door IFC'), marketplace('bimobject', 'single swing door IFC Revit')],
    validationRules: [...COMMON_RULES, { id: 'host-wall-required', severity: 'blocker', label: 'door must be hosted by one wall' }, { id: 'swing-clearance', severity: 'blocker', label: 'door swing cannot intersect fixtures or walls' }],
  }),
  component('opening.window.fixed', 'Window', 'window', 'IfcWindow', {
    ifcPredefinedType: 'WINDOW',
    dimensions: { widthFt: 4, heightFt: 3.5, thicknessFt: 0.18, minWidthFt: 1.5 },
    hostConstraints: [WALL_OPENING_HOST],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-window', lod: 'simple', preservesSemanticBounds: true, notes: 'draw transparent wall interruption along semantic wall span' },
    twoDSymbol: { symbol: 'window-gap', layer: 'opening', stroke: '#8fbccb', fill: '#d9eef2' },
    marketplaceAssets: [marketplace('internal-procedural', 'fixed window'), marketplace('nbs-source', 'window IFC'), marketplace('bimobject', 'window IFC Revit')],
    validationRules: [...COMMON_RULES, { id: 'host-wall-required', severity: 'blocker', label: 'window must be hosted by one wall' }],
  }),
  component('opening.generic', 'Generic Opening', 'opening', 'IfcOpeningElement', {
    dimensions: { widthFt: 3, heightFt: 7, thicknessFt: 0.12, minWidthFt: 0.5 },
    hostConstraints: [WALL_OPENING_HOST],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-wall-opening', lod: 'symbol', preservesSemanticBounds: true, notes: 'subtract or show a semantic wall gap' },
    twoDSymbol: { symbol: 'wall-gap', layer: 'opening', stroke: '#fdfbf7', fill: '#fdfbf7' },
    marketplaceAssets: [marketplace('internal-procedural', 'wall opening')],
    validationRules: [...COMMON_RULES, { id: 'host-wall-required', severity: 'blocker', label: 'opening must be hosted by one wall' }],
  }),
  component('fixture.toilet', 'Toilet', 'sanitaryTerminal', 'IfcSanitaryTerminal', {
    ifcPredefinedType: 'WC',
    dimensions: { widthFt: 1.5, depthFt: 2.4, heightFt: 2.6, minWidthFt: 1.25, minDepthFt: 2 },
    hostConstraints: [WALL_BACKED],
    clearanceRules: [{ id: 'toilet-front', label: 'toilet front clearance', frontFt: 1.75 }, { id: 'toilet-side', label: 'toilet side clearance', sideFt: 1.25 }],
    proceduralFallback: { renderer: 'procedural-toilet', lod: 'simple', preservesSemanticBounds: true, notes: 'wall-backed bowl and tank aligned to fixture facing direction' },
    twoDSymbol: { symbol: 'toilet', layer: 'fixture', stroke: '#8aa5a7', fill: '#edf7f7' },
    marketplaceAssets: [marketplace('internal-procedural', 'toilet WC'), marketplace('nbs-source', 'WC sanitary terminal IFC'), marketplace('bimobject', 'toilet WC BIM')],
    validationRules: [...COMMON_RULES, { id: 'wall-backed', severity: 'blocker', label: 'toilet must be wall-backed' }, { id: 'bathroom-only', severity: 'blocker', label: 'toilet must belong to a bathroom/wc room' }],
  }),
  component('fixture.tub-shower', 'Tub / Shower', 'sanitaryTerminal', 'IfcSanitaryTerminal', {
    ifcPredefinedType: 'BATH',
    dimensions: { widthFt: 2.5, depthFt: 5, heightFt: 2.2, minWidthFt: 2.5, minDepthFt: 3 },
    hostConstraints: [WALL_BACKED],
    clearanceRules: [{ id: 'bath-front', label: 'bath/shower access clearance', frontFt: 2.5 }],
    proceduralFallback: { renderer: 'procedural-tub-shower', lod: 'simple', preservesSemanticBounds: true, notes: 'rectangular tub or shower tray constrained to semantic bounds' },
    twoDSymbol: { symbol: 'tub-shower', layer: 'fixture', stroke: '#8aa5a7', fill: '#edf7f7' },
    marketplaceAssets: [marketplace('internal-procedural', 'bathtub shower'), marketplace('nbs-source', 'bath shower IFC'), marketplace('bimobject', 'bathtub shower BIM')],
    validationRules: [...COMMON_RULES, { id: 'bathroom-only', severity: 'blocker', label: 'bath/shower must belong to a bathroom room' }],
  }),
  component('fixture.sink-vanity', 'Sink / Vanity', 'sanitaryTerminal', 'IfcSanitaryTerminal', {
    ifcPredefinedType: 'SINK',
    dimensions: { widthFt: 2.5, depthFt: 2, heightFt: 3, minWidthFt: 1.5, minDepthFt: 1.5 },
    hostConstraints: [WALL_BACKED],
    clearanceRules: [{ id: 'sink-front', label: 'sink front clearance', frontFt: 2.5 }],
    proceduralFallback: { renderer: 'procedural-sink-vanity', lod: 'simple', preservesSemanticBounds: true, notes: 'sink basin/counter aligned to semantic wall anchor' },
    twoDSymbol: { symbol: 'sink', layer: 'fixture', stroke: '#8aa5a7', fill: '#edf7f7' },
    marketplaceAssets: [marketplace('internal-procedural', 'sink vanity'), marketplace('nbs-source', 'sink sanitary terminal IFC'), marketplace('bimobject', 'sink vanity BIM')],
    validationRules: [...COMMON_RULES, { id: 'wall-backed', severity: 'warning', label: 'sink/vanity should be wall-backed unless island-mounted' }],
  }),
  component('equipment.kitchen-counter-appliance', 'Kitchen Counter / Appliance', 'equipment', 'IfcBuildingElementProxy', {
    dimensions: { depthFt: 2, heightFt: 3, minDepthFt: 1.8 },
    hostConstraints: [WALL_BACKED],
    clearanceRules: [{ id: 'kitchen-aisle', label: 'kitchen aisle clearance', frontFt: 3 }],
    proceduralFallback: { renderer: 'procedural-kitchen-equipment', lod: 'simple', preservesSemanticBounds: true, notes: 'counter/appliance block within semantic bounds' },
    twoDSymbol: { symbol: 'counter-appliance', layer: 'fixture', stroke: '#9d958a', fill: '#ddd8d0' },
    marketplaceAssets: [marketplace('internal-procedural', 'kitchen counter appliance'), marketplace('bimobject', 'kitchen appliance BIM'), marketplace('manufacturer-direct', 'kitchen appliance GLB IFC')],
    validationRules: [...COMMON_RULES, { id: 'kitchen-only', severity: 'warning', label: 'kitchen equipment should belong to kitchen/service zone' }],
  }),
  component('equipment.laundry', 'Washer / Dryer', 'equipment', 'IfcBuildingElementProxy', {
    dimensions: { widthFt: 2.5, depthFt: 2.5, heightFt: 3.3 },
    hostConstraints: [WALL_BACKED],
    clearanceRules: [{ id: 'laundry-front', label: 'laundry front clearance', frontFt: 3 }],
    proceduralFallback: { renderer: 'procedural-laundry-equipment', lod: 'simple', preservesSemanticBounds: true, notes: 'washer/dryer box with face direction' },
    twoDSymbol: { symbol: 'washer-dryer', layer: 'fixture', stroke: '#9d958a', fill: '#ddd8d0' },
    marketplaceAssets: [marketplace('internal-procedural', 'washer dryer'), marketplace('bimobject', 'washer dryer BIM'), marketplace('manufacturer-direct', 'laundry appliance BIM')],
    validationRules: [...COMMON_RULES, { id: 'service-zone', severity: 'warning', label: 'laundry equipment should belong to service/laundry zone' }],
  }),
  component('furniture.bed', 'Bed', 'furniture', 'IfcFurniture', {
    dimensions: { widthFt: 5, depthFt: 6.7, heightFt: 2.6, minWidthFt: 3, minDepthFt: 6 },
    hostConstraints: [FLOOR_HOST],
    clearanceRules: [{ id: 'bed-side', label: 'bed side clearance', sideFt: 2 }, { id: 'bed-front', label: 'bed foot clearance', frontFt: 2 }],
    proceduralFallback: { renderer: 'procedural-bed', lod: 'simple', preservesSemanticBounds: true, notes: 'headboard and pillows preserve rotation/headwall semantics' },
    twoDSymbol: { symbol: 'bed', layer: 'furniture', stroke: '#aaa39a', fill: '#d8d1c5' },
    marketplaceAssets: [marketplace('internal-procedural', 'bed furniture'), marketplace('sketchfab', 'bed low poly glb'), marketplace('sketchup-3d-warehouse', 'bed furniture model')],
    validationRules: [...COMMON_RULES, { id: 'bedroom-zone', severity: 'warning', label: 'bed should belong to sleeping room' }],
  }),
  component('furniture.seating', 'Sofa / Chair', 'furniture', 'IfcFurniture', {
    dimensions: { widthFt: 6, depthFt: 3, heightFt: 3 },
    hostConstraints: [FLOOR_HOST],
    clearanceRules: [{ id: 'seating-walkway', label: 'seating circulation clearance', frontFt: 2.5 }],
    proceduralFallback: { renderer: 'procedural-seating', lod: 'simple', preservesSemanticBounds: true, notes: 'supports rotated seating symbols and simple 3D cushions' },
    twoDSymbol: { symbol: 'seating', layer: 'furniture', stroke: '#aaa39a', fill: '#d8d1c5' },
    marketplaceAssets: [marketplace('internal-procedural', 'sofa chair furniture'), marketplace('sketchfab', 'sofa chair low poly glb'), marketplace('sketchup-3d-warehouse', 'sofa chair model')],
    validationRules: [...COMMON_RULES, { id: 'freestanding-rotation', severity: 'warning', label: 'freestanding furniture rotation should be preserved' }],
  }),
  component('furniture.table', 'Dining / Coffee Table', 'furniture', 'IfcFurniture', {
    dimensions: { widthFt: 3, depthFt: 6, heightFt: 2.5 },
    hostConstraints: [FLOOR_HOST],
    clearanceRules: [{ id: 'table-chair-clearance', label: 'table chair clearance', frontFt: 3 }],
    proceduralFallback: { renderer: 'procedural-table', lod: 'simple', preservesSemanticBounds: true, notes: 'table footprint and optional chairs stay within semantic bounds' },
    twoDSymbol: { symbol: 'table', layer: 'furniture', stroke: '#aaa39a', fill: '#d8d1c5' },
    marketplaceAssets: [marketplace('internal-procedural', 'dining coffee table'), marketplace('sketchfab', 'dining table low poly glb'), marketplace('sketchup-3d-warehouse', 'table model')],
    validationRules: [...COMMON_RULES, { id: 'table-clearance', severity: 'warning', label: 'table should preserve chair/circulation clearance' }],
  }),
  component('vertical.stair', 'Stair / Ladder', 'stair', 'IfcStair', {
    dimensions: { widthFt: 3, depthFt: 10, heightFt: 8, minWidthFt: 2 },
    hostConstraints: [FLOOR_HOST],
    clearanceRules: [{ id: 'stair-clear-width', label: 'stair clear width', sideFt: 0 }],
    proceduralFallback: { renderer: 'procedural-stair-flight', lod: 'simple', preservesSemanticBounds: true, notes: 'draws treads, direction arrow, and floor-to-floor connection' },
    twoDSymbol: { symbol: 'stair-treads-arrow', layer: 'structure', stroke: '#756f67', fill: '#d8d1c7' },
    marketplaceAssets: [marketplace('internal-procedural', 'stair flight ladder'), marketplace('bimobject', 'stair BIM'), marketplace('manufacturer-direct', 'stair ladder BIM')],
    validationRules: [...COMMON_RULES, { id: 'connects-storeys', severity: 'blocker', label: 'stair must connect two semantic levels or be marked ladder' }],
  }),
  component('roof.aframe-plane', 'A-frame / Gable Roof Plane', 'roofPlane', 'IfcRoof', {
    ifcPredefinedType: 'GABLE_ROOF',
    dimensions: { thicknessFt: 0.5, minHeightFt: 7 },
    hostConstraints: [{ hostType: 'wall', required: true, allowedCategories: ['wall'], relationship: 'roof plane bears on exterior wall/eave line' }],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-roof-plane', lod: 'simple', preservesSemanticBounds: true, notes: 'triangulates semantic roof points with translucent product material' },
    twoDSymbol: { symbol: 'roof-plane-outline', layer: 'roof', stroke: '#5d574f', fill: '#d8d1c7' },
    marketplaceAssets: [marketplace('internal-procedural', 'gable roof plane'), marketplace('manufacturer-direct', 'roof panel IFC')],
    validationRules: [...COMMON_RULES, { id: 'roof-plane-points', severity: 'blocker', label: 'roof plane must have at least three semantic points' }, { id: 'roof-wall-intersection', severity: 'warning', label: 'walls should clip to roof underside' }],
  }),
  component('slab.floor', 'Floor / Loft Slab', 'slab', 'IfcSlab', {
    ifcPredefinedType: 'FLOOR',
    dimensions: { thicknessFt: 0.22 },
    hostConstraints: [NO_HOST],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-slab', lod: 'simple', preservesSemanticBounds: true, notes: 'room slab generated directly from semantic room bounds' },
    twoDSymbol: { symbol: 'floor-fill', layer: 'structure', stroke: '#ded8cf', fill: '#e2ded5' },
    marketplaceAssets: [marketplace('internal-procedural', 'floor slab panel')],
    validationRules: [...COMMON_RULES, { id: 'slab-not-void', severity: 'blocker', label: 'void/open-to-below must not resolve to slab geometry' }],
  }),
  component('deck.platform', 'Deck Platform', 'deck', 'IfcSlab', {
    ifcPredefinedType: 'FLOOR',
    dimensions: { thicknessFt: 0.22 },
    hostConstraints: [NO_HOST],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-deck', lod: 'simple', preservesSemanticBounds: true, notes: 'deck boards/platform generated from semantic deck bounds' },
    twoDSymbol: { symbol: 'deck-fill', layer: 'structure', stroke: '#b79c65', fill: '#d4b982' },
    marketplaceAssets: [marketplace('internal-procedural', 'deck platform panel')],
    validationRules: [...COMMON_RULES, { id: 'deck-exterior', severity: 'warning', label: 'deck may intentionally extend beyond main footprint' }],
  }),
  component('guardrail.deck', 'Guardrail / Railing', 'guardrail', 'IfcRailing', {
    dimensions: { heightFt: 3.25, thicknessFt: 0.12 },
    hostConstraints: [{ hostType: 'floor', required: true, allowedCategories: ['deck', 'slab'], relationship: 'guardrail sits on deck/loft/slab edge' }],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-guardrail', lod: 'simple', preservesSemanticBounds: true, notes: 'rail segment from semantic source wall/railing segment' },
    twoDSymbol: { symbol: 'guardrail-line', layer: 'structure', stroke: '#5c554d', fill: 'none' },
    marketplaceAssets: [marketplace('internal-procedural', 'guardrail railing'), marketplace('bimobject', 'railing BIM')],
    validationRules: [...COMMON_RULES],
  }),
  component('fixture.generic-proxy', 'Generic Fixture Proxy', 'fixtureProxy', 'IfcBuildingElementProxy', {
    dimensions: { widthFt: 2, depthFt: 2, heightFt: 2.5 },
    hostConstraints: [FLOOR_HOST],
    clearanceRules: [{ id: 'proxy-clearance', label: 'generic fixture clearance', frontFt: 2 }],
    proceduralFallback: { renderer: 'procedural-fixture-proxy', lod: 'symbol', preservesSemanticBounds: true, notes: 'generic BIM proxy box until fixture is classified' },
    twoDSymbol: { symbol: 'fixture-proxy', layer: 'fixture', stroke: '#9d958a', fill: '#d0c8bc' },
    marketplaceAssets: [marketplace('internal-procedural', 'generic fixture proxy')],
    validationRules: [...COMMON_RULES, { id: 'classify-proxy', severity: 'warning', label: 'generic proxy should be classified before final export' }],
  }),
];

function byKey(key: string): BimComponentDefinition {
  const item = BIM_COMPONENT_CATALOG.find((definition) => definition.key === key);
  if (!item) throw new Error(`Missing BIM component definition: ${key}`);
  return item;
}

export function resolveBimComponent(element: Pick<SemanticBimElement, 'category' | 'ifcClass' | 'name' | 'metadata'>): BimComponentDefinition {
  const text = `${element.name} ${element.metadata?.fixtureType ?? ''} ${element.metadata?.openingKind ?? ''}`.toLowerCase();
  if (element.category === 'door') return byKey('opening.door.swing');
  if (element.category === 'window') return byKey('opening.window.fixed');
  if (element.category === 'opening') return byKey('opening.generic');
  if (element.category === 'stair') return byKey('vertical.stair');
  if (element.category === 'roofPlane') return byKey('roof.aframe-plane');
  if (element.category === 'slab') return byKey('slab.floor');
  if (element.category === 'deck') return byKey('deck.platform');
  if (element.category === 'guardrail') return byKey('guardrail.deck');
  if (element.category === 'wall') return byKey(element.metadata?.exterior ? 'wall.exterior.panelized' : 'wall.interior.partition');
  if (element.category === 'sanitaryTerminal') {
    if (/toilet|wc/.test(text)) return byKey('fixture.toilet');
    if (/tub|bath|shower/.test(text)) return byKey('fixture.tub-shower');
    return byKey('fixture.sink-vanity');
  }
  if (element.category === 'equipment') {
    if (/washer|dryer|laundry/.test(text)) return byKey('equipment.laundry');
    return byKey('equipment.kitchen-counter-appliance');
  }
  if (element.category === 'furniture') {
    if (/bed/.test(text)) return byKey('furniture.bed');
    if (/sofa|couch/.test(text)) return byKey('furniture.seating');
    if (/table|dining|coffee/.test(text)) return byKey('furniture.table');
    if (/chair|bench|seating/.test(text)) return byKey('furniture.seating');
    return byKey('furniture.seating');
  }
  if (element.category === 'fixtureProxy') return byKey('fixture.generic-proxy');
  return component(`${element.category}.procedural`, element.category, element.category, element.ifcClass, {
    dimensions: {},
    hostConstraints: [NO_HOST],
    clearanceRules: [],
    proceduralFallback: { renderer: 'procedural-generic', lod: 'symbol', preservesSemanticBounds: true, notes: 'generic semantic object fallback' },
    twoDSymbol: { symbol: 'generic', layer: 'structure', stroke: '#999', fill: '#ddd' },
    marketplaceAssets: [marketplace('internal-procedural', `${element.category} semantic object`)],
    validationRules: COMMON_RULES,
  });
}

export const resolveBimAsset = resolveBimComponent;

export function bimAssetRegistrySummary() {
  return {
    sources: BIM_MARKETPLACE_SOURCES,
    assets: BIM_COMPONENT_CATALOG,
    policy: [
      'paired semantic JSON remains the geometry authority for every component',
      'internal procedural components render first and must always be available',
      'BIM/manufacturer sources are preferred for doors, windows, plumbing fixtures, appliances, panels, roof parts, and construction products',
      'visual libraries are presentation-only for furniture/decor and must pass scale, license, and LOD checks',
      'marketplace assets may be adapted to semantic bounds but must never change plan geometry',
    ],
  };
}
