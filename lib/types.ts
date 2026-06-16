export type ComponentCategory =
  | 'wall' | 'roof' | 'floor' | 'structural' | 'opening' | 'specialty';

export type RoofStyle = 'gable' | 'a-frame' | 'steep-gable' | 'shed' | 'flat';

export type RenderThemeId = 'product-presentation';

export type RenderMode =
  | 'presentation3d'
  | 'presentationPlan'
  | 'cutaway'
  | 'elevation'
  | 'debugReview';

export type { DrawingStyleProfile } from './drawing-style';

export interface RenderTheme {
  id: RenderThemeId;
  label: string;
  background: string;
  ground: string;
  gridCell: string;
  gridSection: string;
  exteriorWall: string;
  interiorWall: string;
  deckFloor: string;
  roomFloor: string;
  openPlanFloor: string;
  fixtureMaterial: string;
  labelAccent: string;
  wallOpacity: number;
  fixtureOpacity: number;
  showGrid: boolean;
  softStudio: boolean;
}

export interface ModularComponent {
  id: string;
  name: string;
  category: ComponentCategory;
  dimensions: { width: number; height: number; depth: number }; // feet
  geometry: 'box' | 'prism' | 'cylinder' | 'custom';
  pitchAngle?: number;
  material: {
    color: string;
    opacity: number;
    metalness: number;
    roughness: number;
  };
  properties: {
    structural: boolean;
    insulated: boolean;
    exterior: boolean;
    panelType: string;
  };
  usedInHomes: string[];
}

export interface ComponentPlacement {
  componentId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  zone?: string;
}

export interface RoomFixture {
  id?: string;
  fixtureId?: string;
  category?: 'sanitary' | 'kitchen' | 'laundry' | 'furniture' | 'storage' | 'stair' | 'appliance' | 'fixture';
  type: string;
  wall: string;
  x: number;
  z: number;
  w: number;
  d: number;
  rotationDeg?: number;
  rotationSource?: 'explicit' | 'inferred';
  facingDirection?: string;
  anchorWallId?: string;
  wallSide?: string;
  symbolVariant?: string;
  sourceAnchorId?: string;
  bimClass?: string;
  desc: string;
  roomId?: string;
  parts?: Array<{
    type: string;
    x?: number;
    z?: number;
    w?: number;
    d?: number;
    center?: [number, number];
    radius?: number;
    rotationDeg?: number;
  }>;
  clearance?: { x?: number; z?: number; w?: number; d?: number; [key: string]: unknown };
  source?: 'parser' | 'inferred' | 'debug';
}

export interface RoomPart {
  gx: number;
  gz: number;
  gw: number;
  gd: number;
}

export interface SourceWallSegment {
  id?: string;
  sourceAnchorId?: string;
  floor?: number;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  bounds?: { x: number; z: number; w: number; d: number };
  exterior?: boolean;
  wallKind?: string;
  roomIds?: string[];
  source?: string;
}

export interface SourceOpeningSegment {
  id?: string;
  wallId?: string;
  floor?: number;
  kind: 'door' | 'window' | 'open' | 'opening';
  openingType?: 'exteriorDoor' | 'interiorDoor' | 'slidingDoor' | 'pocketDoor' | 'bifoldDoor' | 'window' | 'passthrough' | 'opening';
  windowKind?: string;
  sillType?: string;
  fromRoomId?: string;
  toRoomId?: string;
  opensIntoRoomId?: string;
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  span?: { x1: number; z1: number; x2: number; z2: number };
  hingePoint?: { x: number; z: number };
  leafClosedEnd?: { x: number; z: number };
  leafOpenEnd?: { x: number; z: number };
  swingDirection?: string;
  swingArcDeg?: number;
  widthFt?: number;
  heightFt?: number;
  sourceBounds?: { x: number; z: number; w: number; d: number };
  sourceAnchorId?: string;
  roomIds?: string[];
  source?: string;
}

export interface SourceSpaceFace {
  id: string;
  floor?: number;
  kind?: string;
  type?: string;
  roomId?: string;
  gx: number;
  gz: number;
  gw: number;
  gd: number;
  parts?: RoomPart[];
  roomIds?: string[];
  area?: number;
  sourceAnchorId?: string;
  sourceAnchorIds?: string[];
  symbolVariant?: string;
  source?: string;
}

export interface SourceDimensionLine {
  id?: string;
  floor?: number;
  label?: string;
  span: { x1: number; z1: number; x2: number; z2: number };
  sourceAnchorId?: string;
}

export interface RoomLayout {
  label: string;
  type: string;
  proposalNumber?: number;
  gx: number;
  gz: number;
  gw: number;
  gd: number;
  parts?: RoomPart[];
  anchor?: { gx: number; gz: number };
  area: number;
  color: string;
  constraints: string;
  floor?: number;
  spaceFaceId?: string;
  physicalBoundary?: boolean;
  semanticZone?: boolean;
  fixtures?: RoomFixture[];
}

// Building envelope — cross-section profile extruded along building length
export interface BuildingEnvelope {
  // 2D cross-section points (y=up, z=across depth), counter-clockwise
  profile: Array<{ y: number; z: number }>;
  wallHeight: number;   // vertical wall portion height (0 for pure A-frame)
  wallThickness: number; // e.g. 0.5 feet
  roofThickness: number; // e.g. 0.33 feet
  overhang: number;      // eave overhang in feet
}

export type ConnectionType = 'open' | 'door' | 'sliding' | 'wall';

export interface OpeningSpan {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  source?: string;
}

export interface RoomConnection {
  from: string;
  to: string;
  type: ConnectionType;
  openingId?: string;
  opening?: OpeningSpan;
  width?: number;
  operation?: 'swing' | 'slide' | 'bifold' | 'none' | 'unknown';
  swingDirection?: 'left' | 'right' | 'in' | 'out' | 'unknown';
  source?: 'parser' | 'inferred' | 'debug';
}

export interface PairedPlanArtifactInfo {
  planId: string;
  proposalId: string;
  artifactVersion: string;
  /** 'constrained_json' marks the JSON-only lane (no GPT image by design). */
  sourceKind?: string | null;
  sourceImageUrl: string;
  deterministicRenderUrl?: string;
  /** Illustrative ChatGPT-browser "look render" — marketing art, not to scale. */
  lookRenderUrl?: string;
  lookRenderLook?: string;
  /**
   * Structural facts the illustration is meant to depict, derived from the same
   * compiled geometry as the deterministic 3D/elevations. Used to show the
   * consistency checklist — NOT a pixel/dimensional drift comparison.
   */
  lookRenderExpectedStructure?: {
    roofStyle: string;
    widthFt: number;
    depthFt: number;
    aspectRatio: number;
    gableDoors: number;
    gableWindows: number;
    hasLoft: boolean;
  };
  pairedJsonUrl: string;
  drawingStyleProfileUrl?: string;
  validationUrl?: string;
  visualReviewUrl?: string;
  visualDriftUrl?: string;
  promotionEligible: boolean;
  reviewStatus?: 'passed' | 'blocked' | 'pending' | null;
  blockers: string[];
  visualDrift?: {
    passed?: boolean;
    reviewedAt?: string;
    coveredRepairIds?: string[];
    metrics?: {
      sourceMissRate?: number;
      renderExtraRate?: number;
      edgeSourceMissRate?: number;
      edgeRenderExtraRate?: number;
      [key: string]: unknown;
    };
    likelySemanticCauses?: string[] | null;
    issues?: Array<unknown>;
  };
}

export interface PairedGeometryAudit {
  status: 'pass' | 'blocked';
  blockers: string[];
  coordinateMode: 'feet';
  frameCount: number;
  activeFloorFrames: Array<{
    floor: number;
    widthFt: number;
    depthFt: number;
    bounds?: { x: number; z: number; w: number; d: number };
  }>;
  semanticBounds: { minX: number; minZ: number; maxX: number; maxZ: number; width: number; depth: number };
  footprint: { width: number; depth: number };
}

export interface BuildBomItem {
  componentId: string;
  description: string;
  category: ComponentCategory;
  quantity: number;
  unit: 'each' | 'linear-ft' | 'sqft';
  notes?: string[];
}

export interface BuildValidationRule {
  id: string;
  label: string;
  status: 'pass' | 'warning' | 'blocked';
  details: string[];
}

export interface BuildValidationReport {
  status: 'pass' | 'warning' | 'blocked';
  blockers: string[];
  warnings: string[];
  rules: BuildValidationRule[];
  bom: BuildBomItem[];
  componentsUsed: string[];
  assumptions: string[];
}

export interface RenderedModelBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  width: number;
  height: number;
  depth: number;
  status: 'pass' | 'blocked';
  blockers: string[];
  objectCount?: number;
  visibleObjectCount?: number;
  semanticObjectCount?: number;
}

export interface RoofPlane {
  id: string;
  role: 'roof-plane' | 'ridge' | 'eave' | 'fascia' | 'soffit';
  points: Array<{ x: number; y: number; z: number }>;
  material?: string;
  sourceAnchorId?: string;
  wallId?: string;
}

export interface RoofElevation {
  id: string;
  view: 'front' | 'rear' | 'left' | 'right' | 'side';
  outline: Array<{ x: number; y: number }>;
  sourceAnchorId?: string;
}

export interface RoofSemantics {
  source: 'paired-json' | 'inferred-provisional';
  status: 'validated' | 'provisional';
  style: RoofStyle | string;
  ridgeAxis: 'x' | 'z';
  ridgeHeightFt: number;
  eaveHeightFt: number;
  overhangFt: number;
  roofThicknessFt: number;
  planes?: RoofPlane[];
  elevations?: RoofElevation[];
  blockers: string[];
}

export interface DenHome {
  id: string;
  model: string;
  sqft: number;
  footprint: { width: number; depth: number };
  height: number;
  bedBath: string;
  roofStyle: string;
  roofSemantics?: RoofSemantics;
  hasLoft: boolean;
  loftHeight?: number;  // Y position of loft floor in feet (e.g. 8)
  envelope?: BuildingEnvelope;
  placements: ComponentPlacement[];
  componentsUsed: string[];
  rooms: RoomLayout[];
  connections?: RoomConnection[];
  sourceWalls?: SourceWallSegment[];
  sourceOpenings?: SourceOpeningSegment[];
  spaceFaces?: SourceSpaceFace[];
  dimensionLines?: SourceDimensionLine[];
  dimensionFrame?: { gx: number; gz: number; gw: number; gd: number; widthSourceAnchorId?: string; depthSourceAnchorId?: string };
  floorFrames?: Array<{ floor: number; gx: number; gz: number; gw: number; gd: number; showWidthDimension?: boolean; showDepthDimension?: boolean; widthSourceAnchorId?: string; depthSourceAnchorId?: string }>;
  pairedArtifact?: boolean;
  pairedArtifactJson?: unknown;
  drawingStyleProfile?: import('./drawing-style').DrawingStyleProfile;
  pairedProposalId?: string;
  pairedArtifactInfo?: PairedPlanArtifactInfo;
  buildValidation?: BuildValidationReport;
  parserStatus?: string;
  navigationOrder?: string[];
}

export interface ComponentLibrary {
  version: number;
  components: ModularComponent[];
  homes: DenHome[];
  coverage: Record<string, Record<string, boolean>>;
}

export const CATEGORY_COLORS: Record<ComponentCategory, string> = {
  wall: '#3b82f6',
  roof: '#f59e0b',
  floor: '#8b5cf6',
  structural: '#06b6d4',
  opening: '#10b981',
  specialty: '#ec4899',
};
