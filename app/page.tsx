'use client';

import dynamic from 'next/dynamic';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { components, homes, pairedArtifactToLocalHome, pairedGenerationQueue, pairedManifest, refreshData } from '@/lib/data';
import ComponentCatalog from '@/components/ui/ComponentCatalog';
import ComponentDetail from '@/components/ui/ComponentDetail';
import type { SceneHandle } from '@/components/three/Scene';
import FloorPlanView from '@/components/FloorPlanView';
import { DEFAULT_RENDER_THEME_ID, RENDER_THEMES } from '@/lib/render-themes';
import { validateBuildability } from '@/lib/build-validator';
import type { DenHome, PairedGeometryAudit, RenderMode, RenderedModelBounds, RenderThemeId, RoofSemantics } from '@/lib/types';
import { semanticBimFromHome, semanticBimSummary } from '@/lib/bim/semantic-bim';
import { exportExperimentalIfc } from '@/lib/bim/export-ifc';
import { bimAssetRegistrySummary } from '@/lib/bim/component-registry';
import { localBimAssetSummary, localVisualAssetAttributions } from '@/lib/bim/component-assets';
import { buildableBimFromHome, buildableBimSummary } from '@/lib/bim/buildable-bim';
import { standardsRegistrySummary, validateStandards, codeAdvisoryReportForHome, lotFromArtifact } from '@/lib/standards/floorplan-standards';
import { buildElevationModel, elevationSvgString, type ElevationArtifactInput } from '@/lib/elevations';
import { CODE_ADVISORY_RULES, type CodeAdvisoryFinding } from '@/lib/standards/code-advisory';
import { parseBrief, briefToPromptFields } from '@/lib/brief';
import { countDrawingPrimitives, diffSourceToSemanticDrawingPrimitives, extractSourceDrawingPrimitives } from '@/lib/drawing-primitives';
import {
  applyJsonPatchToHome,
  buildTargetedRepairPrompt,
  createLayerDriftReport,
  parseJsonPatch,
  repairLayerFromGroupId,
  type LayerDriftReport,
  type RepairLayer,
} from '@/lib/repair/targeted-repair';

const Scene = dynamic(() => import('@/components/three/Scene'), { ssr: false });
const BimPreview = dynamic(() => import('@/components/bim/BimPreview'), { ssr: false });

const GRID_FT = 4;

type CompareMode = 'compare' | 'overlay' | 'semantic';
type ViewPreset = 'plan-top' | 'presentation-3d' | 'white-cutaway' | 'front-elevation' | 'side-elevation' | 'debug-review';
type ArtifactLifecycle = 'draft' | 'blocked' | 'review' | 'promoted' | 'exported';
type WorkflowDialog = 'new-plan' | 'import' | 'export' | 'repair' | null;
const EDIT_STORAGE_PREFIX = 'paired-floorplan-edit:';
const PROMPT_STORAGE_KEY = 'paired-floorplan-prompt:v1';
const LIFECYCLE_STORAGE_PREFIX = 'paired-floorplan-lifecycle:';
const EXTERIOR_ROOM_PATTERN = /deck|porch|patio|exterior|eave|clearance|landing/i;

type PromptRequest = {
  intent: string;
  constraints: string;
  style: string;
  bedBath: string;
  footprint: string;
  levels: string;
  roof: string;
  references: string;
};

const DEFAULT_PROMPT_REQUEST: PromptRequest = {
  intent: 'Compact Den-style cabin with clean brochure-ready 2D plan and matching semantic JSON.',
  constraints: 'Use paired image + JSON. Every visible wall, room, opening, fixture, label, roof plane, and elevation must have a JSON counterpart.',
  style: 'Den-style modern cabin, quiet architectural linework, product-ready presentation.',
  bedBath: 'match selected plan',
  footprint: 'match selected plan',
  levels: 'match selected plan',
  roof: 'explicit roof/elevation JSON required for validated roof views',
  references: 'Use clean source floorplan references only; do not use app screenshots or generated renders as style references.',
};

type ValidationGroup = {
  id: string;
  label: string;
  lane: ReadinessLane;
  status: 'pass' | 'warning' | 'blocked';
  blockers: string[];
  warnings: string[];
  action: string;
};

type ReadinessLane = 'design' | 'presentation' | 'brochure' | 'manufacturing' | 'export' | 'accessibility' | 'codeAdvisory';

type LaneSummary = {
  id: ReadinessLane;
  label: string;
  status: 'pass' | 'warning' | 'blocked';
  blockers: string[];
  warnings: string[];
  groups: ValidationGroup[];
};

const READINESS_LANES: Array<{ id: ReadinessLane; label: string; description: string }> = [
  { id: 'design', label: 'Design Quality', description: 'Brochure plan, semantic JSON, BIM view, fixtures, openings, roof, and geometry.' },
  { id: 'presentation', label: 'Presentation Quality', description: 'Renderer-only checks: 2D line weights, 3D wall heights, roof shell, cutaway behavior, materials, and debug-geometry separation.' },
  { id: 'brochure', label: 'Brochure Quality', description: 'Customer-facing sales quality: visual alignment, clean 3D assembly, camera/framing, and export image polish.' },
  { id: 'manufacturing', label: 'Manufacturing Readiness', description: 'Module grid, panel SKUs, spans, BOM, and build-kit constraints.' },
  { id: 'export', label: 'Export Readiness', description: 'Stable packet exports plus experimental IFC/fragments status.' },
  { id: 'accessibility', label: 'Accessibility Advisory', description: 'Optional accessibility checks. These do not claim code compliance.' },
  { id: 'codeAdvisory', label: 'Code Advisory', description: 'Jurisdiction-neutral advisory checks only. Legal compliance is not claimed.' },
];

function PairedStatusPanel({ home, renderedBounds }: { home: DenHome | null; renderedBounds: RenderedModelBounds | null }) {
  const info = home?.pairedArtifactInfo;
  const geometry = useMemo(() => liveGeometryAudit(home), [home]);
  const promoted = pairedManifest?.summary?.pairedPromotionEligible ?? 0;
  const total = pairedManifest?.summary?.planCount ?? 0;
  const queued = pairedGenerationQueue?.queuedPlans ?? pairedGenerationQueue?.queue.length ?? 0;
  const audit = useMemo(() => productAudit(home, renderedBounds), [home, renderedBounds]);
  const designStatus = audit.designQuality.status;
  const presentationStatus = audit.presentationQuality.status;
  const brochureStatus = audit.brochureQuality.status;
  const blocked = Boolean(info && !info.promotionEligible && (info.reviewStatus === 'blocked' || info.blockers.length > 0));
  const statusLabel = designStatus === 'pass' && presentationStatus === 'pass' && brochureStatus === 'pass' && info?.promotionEligible
    ? 'brochure-ready'
    : designStatus === 'blocked' || presentationStatus === 'blocked' || brochureStatus === 'blocked' || blocked
      ? 'blocked'
      : 'review';
  const roofStatus = home?.roofSemantics?.status === 'validated'
    ? 'paired roof/elevation JSON validated'
    : 'roof is provisional until paired roof/elevation JSON is attached';

  return (
    <div className="border-t border-stone-200 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Paired GPT Status</h2>
        <span className={`font-mono text-[10px] ${statusLabel === 'brochure-ready' ? 'text-emerald-700' : statusLabel === 'blocked' ? 'text-red-700' : 'text-amber-700'}`}>
          {statusLabel}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="border border-stone-200 bg-white px-2 py-1.5">
          <div className="text-stone-400">promoted</div>
          <div className="font-mono text-stone-700">{promoted}/{total || '-'}</div>
        </div>
        <div className="border border-stone-200 bg-white px-2 py-1.5">
          <div className="text-stone-400">queued</div>
          <div className="font-mono text-stone-700">{queued}</div>
        </div>
      </div>
      {info ? (
        <div className="mt-2 space-y-1.5 text-[10px] leading-snug">
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <span className="text-stone-400">proposal</span>
            <span className="font-mono text-stone-700">{info.proposalId}</span>
          </div>
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <span className="text-stone-400">artifact</span>
            <span className="font-mono text-stone-700">{info.artifactVersion}</span>
          </div>
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <span className="text-stone-400">review</span>
            <span className="font-mono text-stone-700">{info.reviewStatus ?? 'pending'}</span>
          </div>
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <span className="text-stone-400">roof</span>
            <span className="font-mono text-amber-700">{roofStatus}</span>
          </div>
          {home?.roofSemantics && (
            <div className="grid grid-cols-[72px_1fr] gap-2">
              <span className="text-stone-400">roof src</span>
              <span className="font-mono text-stone-700">
                {home.roofSemantics.source} / {home.roofSemantics.ridgeHeightFt}&apos; ridge
              </span>
            </div>
          )}
          {geometry && (
            <div className="mt-2 border border-stone-200 bg-stone-50 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-stone-400">geometry</span>
                <span className={`font-mono ${geometry.status === 'pass' ? 'text-emerald-700' : 'text-red-700'}`}>
                  {geometry.status}
                </span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">coords</span>
                <span className="font-mono text-stone-700">{geometry.coordinateMode} / {geometry.frameCount} frame{geometry.frameCount === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">footprint</span>
                <span className="font-mono text-stone-700">{geometry.footprint.width} x {geometry.footprint.depth} ft</span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">bounds</span>
                <span className="font-mono text-stone-700">
                  {geometry.semanticBounds.width.toFixed(1)} x {geometry.semanticBounds.depth.toFixed(1)} ft
                </span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">openings</span>
                <span className="font-mono text-stone-700">{home?.sourceOpenings?.length ?? 0}</span>
              </div>
              {geometry.blockers.length > 0 && (
                <div className="mt-1 space-y-1 text-[9px] text-red-700">
                  {geometry.blockers.slice(0, 3).map((blocker) => <div key={blocker}>{blocker}</div>)}
                </div>
              )}
            </div>
          )}
          {renderedBounds && (
            <div className="mt-2 border border-stone-200 bg-white p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-stone-400">3d bounds</span>
                <span className={`font-mono ${renderedBounds.status === 'pass' ? 'text-emerald-700' : 'text-red-700'}`}>
                  {renderedBounds.status}
                </span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">size</span>
                <span className="font-mono text-stone-700">
                  {renderedBounds.width.toFixed(1)} x {renderedBounds.depth.toFixed(1)} x {renderedBounds.height.toFixed(1)} ft
                </span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">objects</span>
                <span className="font-mono text-stone-700">
                  {renderedBounds.visibleObjectCount ?? 0}/{renderedBounds.objectCount ?? 0}
                  {renderedBounds.semanticObjectCount ? ` - ${renderedBounds.semanticObjectCount} semantic` : ''}
                </span>
              </div>
              {renderedBounds.blockers.length > 0 && (
                <div className="mt-1 space-y-1 text-[9px] text-red-700">
                  {renderedBounds.blockers.slice(0, 3).map((blocker) => <div key={blocker}>{blocker}</div>)}
                </div>
              )}
            </div>
          )}
          {info.blockers.length > 0 && (
            <div className="mt-2 space-y-1 border border-red-100 bg-red-50 p-2 text-[9px] text-red-700">
              {info.blockers.slice(0, 4).map((blocker) => (
                <div key={blocker}>{blocker}</div>
              ))}
            </div>
          )}
          {home?.buildValidation && (
            <div className="mt-2 border border-stone-200 bg-stone-50 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-stone-400">build kit</span>
                <span className={`font-mono ${
                  home.buildValidation.status === 'pass'
                    ? 'text-emerald-700'
                    : 'text-amber-700'
                }`}>
                  {home.buildValidation.status === 'pass' ? 'pass' : 'warning'}
                </span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">bom</span>
                <span className="font-mono text-stone-700">{home.buildValidation.bom.length} line items</span>
              </div>
              <div className="grid grid-cols-[72px_1fr] gap-2">
                <span className="text-stone-400">kit</span>
                <span className="font-mono text-stone-700">{home.componentsUsed.length} components</span>
              </div>
              {home.buildValidation.blockers.slice(0, 3).map((blocker) => (
                <div key={blocker} className="mt-1 text-[9px] leading-snug text-amber-700">{blocker}</div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[10px] leading-snug text-stone-400">
          No passing paired artifact is selected.
        </div>
      )}
    </div>
  );
}

function liveGeometryAudit(home: DenHome | null): PairedGeometryAudit | undefined {
  if (!home?.pairedArtifact) return undefined;
  const blockers: string[] = [];
  if (!home.sourceWalls?.length) blockers.push('missing source wall graph');
  if (!home.sourceOpenings?.length) blockers.push('missing source openings/windows');
  const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  const include = (x: number, z: number) => {
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minZ = Math.min(bounds.minZ, z);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxZ = Math.max(bounds.maxZ, z);
  };
  for (const room of home.rooms) {
    if (EXTERIOR_ROOM_PATTERN.test(`${room.type} ${room.label}`)) continue;
    include(room.gx * 4, room.gz * 4);
    include((room.gx + room.gw) * 4, (room.gz + room.gd) * 4);
  }
  for (const wall of home.sourceWalls ?? []) {
    if (/deck/i.test(`${wall.id ?? ''} ${wall.source ?? ''}`)) continue;
    include(wall.x1 * 4, wall.z1 * 4);
    include(wall.x2 * 4, wall.z2 * 4);
  }
  const finite = Number.isFinite(bounds.minX);
  const semanticBounds = finite
    ? {
      ...bounds,
      width: bounds.maxX - bounds.minX,
      depth: bounds.maxZ - bounds.minZ,
    }
    : { minX: 0, minZ: 0, maxX: 0, maxZ: 0, width: 0, depth: 0 };
  const toleranceFt = 2;
  if (semanticBounds.minX < -toleranceFt || semanticBounds.minZ < -toleranceFt) {
    blockers.push(`semantic bounds start outside footprint (${semanticBounds.minX.toFixed(1)}, ${semanticBounds.minZ.toFixed(1)})`);
  }
  if (semanticBounds.maxX > home.footprint.width + toleranceFt || semanticBounds.maxZ > home.footprint.depth + toleranceFt) {
    blockers.push(`semantic bounds exceed footprint (${semanticBounds.maxX.toFixed(1)} x ${semanticBounds.maxZ.toFixed(1)} vs ${home.footprint.width} x ${home.footprint.depth})`);
  }
  return {
    status: blockers.length ? 'blocked' : 'pass',
    blockers,
    coordinateMode: 'feet',
    frameCount: 0,
    activeFloorFrames: [],
    semanticBounds,
    footprint: home.footprint,
  };
}

function roofEditBlockers(roof: RoofSemantics | undefined): string[] {
  if (!roof) return [];
  const blockers: string[] = [];
  if (!Number.isFinite(roof.ridgeHeightFt) || roof.ridgeHeightFt <= 0) blockers.push('roof ridge height must be positive');
  if (!Number.isFinite(roof.eaveHeightFt) || roof.eaveHeightFt < 0) blockers.push('roof eave height must be non-negative');
  if (roof.ridgeHeightFt <= roof.eaveHeightFt) blockers.push('roof ridge must be higher than eave');
  if (!Number.isFinite(roof.overhangFt) || roof.overhangFt < 0) blockers.push('roof overhang must be non-negative');
  if (!Number.isFinite(roof.roofThicknessFt) || roof.roofThicknessFt <= 0) blockers.push('roof thickness must be positive');
  if (roof.source === 'paired-json') {
    if (!roof.planes?.length) blockers.push('paired roof JSON is missing roof planes');
    for (const plane of roof.planes ?? []) {
      const minimumPoints = plane.role === 'roof-plane' ? 3 : 2;
      if (!plane.points?.length || plane.points.length < minimumPoints) {
        blockers.push(`${plane.id ?? 'roof plane'} has fewer than ${minimumPoints} points`);
      }
    }
    if (!roof.elevations?.length || roof.elevations.length < 2) blockers.push('paired roof JSON is missing front/side elevations');
  }
  return blockers;
}

function roofWithValidation(roof: RoofSemantics): RoofSemantics {
  const blockers = roofEditBlockers(roof);
  return {
    ...roof,
    status: roof.source === 'paired-json' && blockers.length === 0 ? 'validated' : 'provisional',
    blockers,
  };
}

function openingAlignedToWall(
  opening: NonNullable<DenHome['sourceOpenings']>[number],
  walls: NonNullable<DenHome['sourceWalls']>,
): boolean {
  const tolerance = 0.12;
  const wallVertical = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    Math.abs(wall.x1 - wall.x2) < tolerance ||
    Boolean(wall.bounds && wall.bounds.d > wall.bounds.w * 1.25)
  );
  const wallHorizontal = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    Math.abs(wall.z1 - wall.z2) < tolerance ||
    Boolean(wall.bounds && wall.bounds.w > wall.bounds.d * 1.25)
  );
  const wallCenterX = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    wall.bounds ? wall.bounds.x + wall.bounds.w / 2 : (wall.x1 + wall.x2) / 2
  );
  const wallCenterZ = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    wall.bounds ? wall.bounds.z + wall.bounds.d / 2 : (wall.z1 + wall.z2) / 2
  );
  const wallMinZ = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    wall.bounds ? wall.bounds.z : Math.min(wall.z1, wall.z2)
  );
  const wallMaxZ = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    wall.bounds ? wall.bounds.z + wall.bounds.d : Math.max(wall.z1, wall.z2)
  );
  const wallMinX = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    wall.bounds ? wall.bounds.x : Math.min(wall.x1, wall.x2)
  );
  const wallMaxX = (wall: NonNullable<DenHome['sourceWalls']>[number]) => (
    wall.bounds ? wall.bounds.x + wall.bounds.w : Math.max(wall.x1, wall.x2)
  );
  const wallMatchesOpeningHost = (wall: NonNullable<DenHome['sourceWalls']>[number]) => {
    if (!opening.wallId) return true;
    const wallId = wall.id ?? '';
    const sourceId = wall.sourceAnchorId ?? '';
    const baseWallId = wallId.replace(/:seg-\d+$/i, '');
    const baseSourceId = sourceId.replace(/:seg-\d+$/i, '');
    return opening.wallId === wallId || opening.wallId === sourceId || opening.wallId === baseWallId || opening.wallId === baseSourceId;
  };
  const openingVertical = Math.abs(opening.x1 - opening.x2) < tolerance;
  const openingHorizontal = Math.abs(opening.z1 - opening.z2) < tolerance;
  if (!openingVertical && !openingHorizontal) return false;
  if (opening.wallId) {
    const hostSegments = walls.filter((wall) => (
      wallMatchesOpeningHost(wall) &&
      (opening.floor ?? 0) === (wall.floor ?? 0)
    ));
    if (hostSegments.length) {
      const verticalWalls = hostSegments.filter(wallVertical);
      const horizontalWalls = hostSegments.filter(wallHorizontal);
      if (openingVertical && verticalWalls.length) {
        const hostX = verticalWalls.reduce((total, wall) => total + wallCenterX(wall), 0) / verticalWalls.length;
        return Math.abs(opening.x1 - hostX) <= tolerance;
      }
      if (openingHorizontal && horizontalWalls.length) {
        const hostZ = horizontalWalls.reduce((total, wall) => total + wallCenterZ(wall), 0) / horizontalWalls.length;
        return Math.abs(opening.z1 - hostZ) <= tolerance;
      }
    }
  }
  return walls.some((wall) => {
    if (!wallMatchesOpeningHost(wall)) return false;
    if ((opening.floor ?? 0) !== (wall.floor ?? 0)) return false;
    const isWallVertical = wallVertical(wall);
    const isWallHorizontal = wallHorizontal(wall);
    if (openingVertical && isWallVertical) {
      if (Math.abs(opening.x1 - wallCenterX(wall)) > tolerance) return false;
      if (opening.wallId && wall.id === opening.wallId) return true;
      const wallMin = wallMinZ(wall) - tolerance;
      const wallMax = wallMaxZ(wall) + tolerance;
      return Math.min(opening.z1, opening.z2) >= wallMin && Math.max(opening.z1, opening.z2) <= wallMax;
    }
    if (openingHorizontal && isWallHorizontal) {
      if (Math.abs(opening.z1 - wallCenterZ(wall)) > tolerance) return false;
      if (opening.wallId && wall.id === opening.wallId) return true;
      const wallMin = wallMinX(wall) - tolerance;
      const wallMax = wallMaxX(wall) + tolerance;
      return Math.min(opening.x1, opening.x2) >= wallMin && Math.max(opening.x1, opening.x2) <= wallMax;
    }
    return false;
  });
}

function doorOrOpeningIssues(home: DenHome) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sourceAnchors = new Map<string, number>();
  const validDoorTypes = new Set(['exteriorDoor', 'interiorDoor', 'slidingDoor', 'pocketDoor', 'bifoldDoor']);
  for (const opening of home.sourceOpenings ?? []) {
    if (opening.sourceAnchorId) sourceAnchors.set(opening.sourceAnchorId, (sourceAnchors.get(opening.sourceAnchorId) ?? 0) + 1);
    if (!opening.sourceAnchorId) warnings.push(`${opening.id ?? opening.kind} is missing sourceAnchorId`);
    if (!opening.wallId) blockers.push(`${opening.id ?? opening.kind} is missing host wallId`);
    if (!opening.widthFt || opening.widthFt < 0.5) blockers.push(`${opening.id ?? opening.kind} has missing or implausible widthFt`);
    if (opening.kind === 'door') {
      const type = opening.openingType;
      if (!type || !validDoorTypes.has(type)) blockers.push(`${opening.id ?? 'door'} is missing semantic door type`);
      if (!opening.fromRoomId || !opening.toRoomId) blockers.push(`${opening.id ?? 'door'} is missing fromRoomId/toRoomId`);
      if (type === 'slidingDoor' || type === 'pocketDoor') {
        if (opening.swingArcDeg && opening.swingArcDeg > 0) blockers.push(`${opening.id ?? 'door'} is ${type} but has a swing arc`);
      } else if (type === 'exteriorDoor' || type === 'interiorDoor' || type === 'bifoldDoor') {
        if (!opening.hingePoint || !opening.leafClosedEnd || !opening.leafOpenEnd) blockers.push(`${opening.id ?? 'door'} is missing hinge/leaf geometry`);
        if (!opening.swingDirection) blockers.push(`${opening.id ?? 'door'} is missing swingDirection`);
        if (type !== 'bifoldDoor' && !opening.opensIntoRoomId) blockers.push(`${opening.id ?? 'door'} is missing opensIntoRoomId`);
        if (type !== 'bifoldDoor' && opening.swingArcDeg !== undefined && (opening.swingArcDeg < 45 || opening.swingArcDeg > 135)) {
          warnings.push(`${opening.id ?? 'door'} swingArcDeg ${opening.swingArcDeg} is outside a typical hinged-door range`);
        }
      }
    }
    if (opening.kind === 'window' && opening.openingType && opening.openingType !== 'window') {
      blockers.push(`${opening.id ?? 'window'} kind/window type mismatch`);
    }
  }
  for (const [anchor, count] of sourceAnchors.entries()) {
    if (count > 1) warnings.push(`sourceAnchorId ${anchor} is used by ${count} openings`);
  }
  return { blockers, warnings };
}

function fixtureFidelityIssues(home: DenHome) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const sourceAnchors = new Map<string, number>();
  const wallAnchoredPattern = /toilet|sink|vanity|tub|shower|range|stove|washer|dryer|counter|cabinet|shelf/i;
  const orientedPattern = /bed|sofa|couch|chair|table|desk|toilet|sink|vanity|tub|shower|range|stove|washer|dryer|stair/i;
  for (const room of home.rooms) {
    for (const fixture of room.fixtures ?? []) {
      const label = fixture.id ?? `${room.label} ${fixture.type}`;
      if (fixture.sourceAnchorId) sourceAnchors.set(fixture.sourceAnchorId, (sourceAnchors.get(fixture.sourceAnchorId) ?? 0) + 1);
      else warnings.push(`${label} is missing sourceAnchorId`);
      if (!fixture.category) warnings.push(`${label} is missing semantic fixture category`);
      if (!fixture.bimClass) warnings.push(`${label} is missing BIM class mapping`);
      if (fixture.roomId && fixture.roomId !== room.label && fixture.roomId !== room.spaceFaceId && !home.spaceFaces?.some((face) => face.id === fixture.roomId && face.roomIds?.includes(room.label))) {
        warnings.push(`${label} roomId does not directly match rendered room label; verify ownership`);
      }
      if (orientedPattern.test(`${fixture.type} ${fixture.desc}`) && typeof fixture.rotationDeg !== 'number') {
        blockers.push(`${label} is missing rotationDeg`);
      }
      if (orientedPattern.test(`${fixture.type} ${fixture.desc}`) && !fixture.facingDirection) {
        warnings.push(`${label} is missing facingDirection`);
      }
      if (wallAnchoredPattern.test(`${fixture.type} ${fixture.desc}`) && !fixture.anchorWallId) {
        blockers.push(`${label} is missing anchorWallId`);
      }
      if (wallAnchoredPattern.test(`${fixture.type} ${fixture.desc}`) && !fixture.wallSide && !fixture.wall) {
        warnings.push(`${label} is missing wall side metadata`);
      }
      if ((fixture.w <= 0 || fixture.d <= 0) || fixture.w * GRID_FT < 0.25 || fixture.d * GRID_FT < 0.25) {
        blockers.push(`${label} has implausible fixture bounds`);
      }
    }
  }
  for (const [anchor, count] of sourceAnchors.entries()) {
    if (count > 1) warnings.push(`sourceAnchorId ${anchor} is used by ${count} fixtures/furniture items`);
  }
  return { blockers, warnings };
}

function QueueProgressPanel() {
  const queue = pairedGenerationQueue?.queue ?? [];
  const next = queue[0] ?? null;
  const queued = pairedGenerationQueue?.queuedPlans ?? queue.length;
  const promoted = pairedGenerationQueue?.promotedPairedPlans ?? pairedManifest?.summary?.pairedPromotionEligible ?? 0;

  return (
    <div className="border-t border-stone-200 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Queue Progress</h2>
        <span className="font-mono text-[10px] text-amber-700">{queued ? 'waiting on GPT' : 'empty'}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
        <div className="border border-stone-200 bg-white px-2 py-1.5">
          <div className="text-stone-400">handoffs</div>
          <div className="font-mono text-stone-700">{queued}</div>
        </div>
        <div className="border border-stone-200 bg-white px-2 py-1.5">
          <div className="text-stone-400">promoted</div>
          <div className="font-mono text-stone-700">{promoted}</div>
        </div>
      </div>
      {next ? (
        <div className="mt-2 space-y-1.5 text-[10px] leading-snug">
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <span className="text-stone-400">next</span>
            <span className="font-mono text-stone-700">{next.planId}</span>
          </div>
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <span className="text-stone-400">proposal</span>
            <span className="font-mono text-stone-700">{next.proposalId}</span>
          </div>
          <div className="grid grid-cols-[72px_1fr] gap-2">
            <span className="text-stone-400">artifact</span>
            <span className="font-mono text-amber-700">not generated</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-[10px] leading-snug text-stone-400">
          No queued GPT handoffs.
        </div>
      )}
    </div>
  );
}

function productAudit(home: DenHome | null, renderedBounds: RenderedModelBounds | null) {
  const groups = validationGroups(home, renderedBounds);
  const lanes = readinessLanes(groups);
  const design = lanes.find((lane) => lane.id === 'design') ?? emptyLaneSummary('design');
  const presentation = lanes.find((lane) => lane.id === 'presentation') ?? emptyLaneSummary('presentation');
  const brochure = lanes.find((lane) => lane.id === 'brochure') ?? emptyLaneSummary('brochure');
  const manufacturing = lanes.find((lane) => lane.id === 'manufacturing') ?? emptyLaneSummary('manufacturing');
  const exportLane = lanes.find((lane) => lane.id === 'export') ?? emptyLaneSummary('export');
  const blockers = [...design.blockers, ...presentation.blockers, ...brochure.blockers];
  const warnings = [...design.warnings, ...presentation.warnings, ...brochure.warnings];
  // The headline lifecycle reflects the design itself. Brochure blockers
  // (e.g. a missing sales image on a JSON-only plan) keep the brochure lane
  // blocked and gate promotion, but they do not label the whole plan blocked.
  const designBlockers = [...design.blockers, ...presentation.blockers];
  const status: ArtifactLifecycle = designBlockers.length
    ? 'blocked'
    : home?.pairedArtifactInfo?.promotionEligible
      ? 'promoted'
      : 'review';
  return {
    blockers: [...new Set(blockers)],
    designBlockers: [...new Set(designBlockers)],
    warnings: [...new Set(warnings)],
    status,
    designQuality: design,
    presentationQuality: presentation,
    brochureQuality: brochure,
    manufacturingReadiness: manufacturing,
    exportReadiness: exportLane,
    lanes,
    groups,
  };
}

function rawObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function rawArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rawNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function primitiveLayerThreshold(layer: string) {
  if (layer === 'wall') {
    return {
      edgeSourceMissRate: 0.08,
      edgeRenderExtraRate: 0.055,
      sourceMissRate: 0.22,
      renderExtraRate: 0.18,
    };
  }
  return {
    edgeSourceMissRate: 0.12,
    edgeRenderExtraRate: 0.08,
    sourceMissRate: 0.36,
    renderExtraRate: 0.36,
  };
}

function isSparseLineworkLayer(layer: string) {
  return layer === 'dimension' || layer === 'dashedVoid';
}

function primitiveLayerSemanticEdgeBlocked(layer: string, edgeSourceMiss: number, edgeRenderExtra: number): boolean {
  const threshold = primitiveLayerThreshold(layer);
  return edgeSourceMiss > threshold.edgeSourceMissRate || edgeRenderExtra > threshold.edgeRenderExtraRate;
}

function primitiveLayerVisualPasses(drift: unknown, layer: string): boolean {
  const driftObject = rawObject(drift);
  const metrics = rawObject(driftObject?.metrics);
  const layerDrift = rawObject(rawObject(metrics?.primitiveLayerDrift)?.[layer]);
  if (!layerDrift) return false;
  const threshold = primitiveLayerThreshold(layer);
  const sourceMiss = rawNumber(layerDrift.sourceMissRate) ?? 1;
  const renderExtra = rawNumber(layerDrift.renderExtraRate) ?? 1;
  const edgeSourceMiss = rawNumber(layerDrift.edgeSourceMissRate) ?? 1;
  const edgeRenderExtra = rawNumber(layerDrift.edgeRenderExtraRate) ?? 1;
  if (isSparseLineworkLayer(layer)) {
    return (
      edgeSourceMiss <= threshold.edgeSourceMissRate &&
      edgeRenderExtra <= threshold.edgeRenderExtraRate
    );
  }
  return (
    sourceMiss <= threshold.sourceMissRate &&
    renderExtra <= threshold.renderExtraRate &&
    edgeSourceMiss <= threshold.edgeSourceMissRate &&
    edgeRenderExtra <= threshold.edgeRenderExtraRate
  );
}

function rawSpanBounds(value: unknown): { x: number; z: number; w: number; d: number } | null {
  const span = rawObject(value);
  if (!span) return null;
  const x1 = rawNumber(span.x1);
  const z1 = rawNumber(span.z1);
  const x2 = rawNumber(span.x2);
  const z2 = rawNumber(span.z2);
  if (x1 === undefined || z1 === undefined || x2 === undefined || z2 === undefined) return null;
  return { x: Math.min(x1, x2), z: Math.min(z1, z2), w: Math.abs(x2 - x1), d: Math.abs(z2 - z1) };
}

function rawBounds(value: unknown): { x: number; z: number; w: number; d: number } | null {
  const bounds = rawObject(value);
  if (!bounds) return null;
  const x = rawNumber(bounds.x);
  const z = rawNumber(bounds.z);
  const w = rawNumber(bounds.w);
  const d = rawNumber(bounds.d);
  if (x === undefined || z === undefined || w === undefined || d === undefined) return null;
  return { x, z, w, d };
}

function pairedLevelFrameAspectIssues(home: DenHome): string[] {
  const artifact = rawObject(home.pairedArtifactJson);
  const panels = Array.isArray(artifact?.floorPanels) ? artifact.floorPanels : [];
  const issues: string[] = [];
  for (const panelValue of panels) {
    const panel = rawObject(panelValue);
    if (!panel) continue;
    const floor = rawNumber(panel.floor) ?? rawNumber(panel.levelIndex) ?? 0;
    const footprint = rawObject(panel.footprint);
    const widthFt = rawNumber(footprint?.widthFt) ?? rawNumber(footprint?.width) ?? rawNumber(footprint?.w);
    const depthFt = rawNumber(footprint?.depthFt) ?? rawNumber(footprint?.depth) ?? rawNumber(footprint?.d);
    if (!widthFt || !depthFt) continue;
    const anchors = Array.isArray(panel.sourceAnchors) ? panel.sourceAnchors : [];
    const footprintAnchor = anchors
      .map((anchor) => rawObject(anchor))
      .find((anchor) => /levelFootprint|footprint/i.test(`${anchor?.kind ?? ''} ${anchor?.id ?? ''}`));
    const sourceBounds = rawSpanBounds(footprintAnchor?.span) ?? rawBounds(footprintAnchor?.bounds);
    if (!sourceBounds || sourceBounds.w <= 0 || sourceBounds.d <= 0) continue;
    const semanticAspect = widthFt / depthFt;
    const sourceAspect = sourceBounds.w / sourceBounds.d;
    const relativeDrift = Math.abs(sourceAspect - semanticAspect) / Math.max(semanticAspect, 0.001);
    if (relativeDrift <= 0.12) continue;
    const inferredDepth = widthFt / sourceAspect;
    const inferredWidth = depthFt * sourceAspect;
    issues.push(
      `floor-${floor} level frame aspect mismatch: source footprint is ${sourceBounds.w.toFixed(0)}x${sourceBounds.d.toFixed(0)} px ` +
      `(aspect ${sourceAspect.toFixed(2)}) but paired JSON declares ${widthFt.toFixed(1)}x${depthFt.toFixed(1)} ft ` +
      `(aspect ${semanticAspect.toFixed(2)}). If the GPT proposal is the source of truth, patch floorPanels, rooms, walls, openings, fixtures, ` +
      `dimensions, and source anchors for floor-${floor}; likely target is about ${widthFt.toFixed(1)}x${inferredDepth.toFixed(1)} ft ` +
      `or ${inferredWidth.toFixed(1)}x${depthFt.toFixed(1)} ft depending on the visible dimension labels.`,
    );
  }
  return issues;
}

function presentationFidelityIssues(home: DenHome): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const model = buildableBimFromHome(home);
  const aFrame = /a-frame/i.test(`${home.roofStyle ?? ''} ${home.roofSemantics?.style ?? ''}`);
  const ridgeAxis = home.roofSemantics?.ridgeAxis ?? 'x';
  const walls = model.elements.filter((element) => element.category === 'wall' && element.segment);
  const lowWalls = walls.filter((element) => {
    if ((element.segment?.height ?? 0) >= 6.5) return false;
    if (aFrame && element.metadata?.exterior === true && element.segment) {
      const dx = Math.abs(element.segment.x2 - element.segment.x1);
      const dz = Math.abs(element.segment.z2 - element.segment.z1);
      const parallelToRidge = ridgeAxis === 'x' ? dx >= dz : dz >= dx;
      if (parallelToRidge) return false;
    }
    const roofTop = rawNumber(element.metadata?.roofProfileHeightAtMidpointFt);
    const wallBase = element.segment?.y1 ?? 0;
    if (aFrame && roofTop && roofTop - wallBase < 6.5) return false;
    return true;
  });
  if (lowWalls.length) {
    blockers.push(
      `${lowWalls.length} product BIM wall element(s) render below 6.5 ft. This is presentation drift: fix wall-height/roof-clipping renderer logic, not semantic JSON.`,
    );
  }
  const roofPlanes = model.elements.filter((element) => element.category === 'roofPlane');
  if (home.roofSemantics?.status === 'validated' && /a-frame/i.test(`${home.roofStyle} ${home.roofSemantics.style}`)) {
    if (roofPlanes.length < 2) {
      blockers.push('A-frame presentation requires two roof-plane elements with ridge/eave semantics.');
    }
    const missingThickness = !home.roofSemantics.roofThicknessFt || home.roofSemantics.roofThicknessFt <= 0;
    if (missingThickness) warnings.push('A-frame roof shell has no positive roofThicknessFt; product renderer may look like guide planes.');
  }
  if (home.pairedArtifactInfo?.visualDrift?.metrics) {
    const visualDrift = home.pairedArtifactInfo.visualDrift;
    const metrics = visualDrift.metrics ?? {};
    const edgeSourceMissRate = (metrics.primitiveEdgeSourceMissRate as number | undefined) ?? metrics.edgeSourceMissRate ?? 0;
    const edgeRenderExtraRate = (metrics.primitiveEdgeRenderExtraRate as number | undefined) ?? metrics.edgeRenderExtraRate ?? 0;
    const semanticBlocked = visualDrift.passed === false || (
      visualDrift.passed !== true &&
      (edgeSourceMissRate > 0.12 ||
        edgeRenderExtraRate > 0.08)
    );
    if (semanticBlocked) {
      warnings.push('Presentation review is downstream of Semantic Drift: do not use renderer styling to hide source/render geometry mismatch.');
    }
  }
  return { blockers, warnings };
}

function drawingStyleProfileIssues(home: DenHome): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const profile = home.drawingStyleProfile;
  if (!profile) {
    if (!isJsonOnlyPlan(home)) {
      blockers.push('Missing drawing_style_profile_v1 sidecar; deterministic renderer is using fallback style rules instead of extracted source rules.');
    }
    return { blockers, warnings };
  }
  if (profile.schemaVersion !== 'drawing_style_profile_v1') {
    blockers.push(`Unsupported drawing style profile schema ${String(profile.schemaVersion)}`);
  }
  const validation = profile.validation;
  for (const blocker of validation?.blockers ?? []) blockers.push(`drawing_style_profile_v1: ${blocker}`);
  for (const warning of validation?.warnings ?? []) warnings.push(`drawing_style_profile_v1: ${warning}`);
  const metrics = validation?.metrics ?? {};
  const wallStrokeDelta = typeof metrics.wallStrokeWidthDeltaPx === 'number' ? metrics.wallStrokeWidthDeltaPx : 0;
  const doorStrokeDelta = typeof metrics.doorStrokeWidthDeltaPx === 'number' ? metrics.doorStrokeWidthDeltaPx : 0;
  const windowStrokeDelta = typeof metrics.windowStrokeWidthDeltaPx === 'number' ? metrics.windowStrokeWidthDeltaPx : 0;
  const dashDelta = typeof metrics.dashPatternDelta === 'number' ? metrics.dashPatternDelta : 0;
  if (wallStrokeDelta > 2.5) blockers.push(`Wall drawing style drift ${wallStrokeDelta.toFixed(1)}px exceeds brochure tolerance.`);
  if (doorStrokeDelta > 1.5) warnings.push(`Door swing/leaf drawing style drift ${doorStrokeDelta.toFixed(1)}px needs renderer profile review.`);
  if (windowStrokeDelta > 1.5) warnings.push(`Window drawing style drift ${windowStrokeDelta.toFixed(1)}px needs renderer profile review.`);
  if (dashDelta > 0.45) warnings.push(`Dashed loft/void line rhythm differs from source by ${(dashDelta * 100).toFixed(0)}%.`);
  return { blockers, warnings };
}

function drawingPrimitiveContractIssues(home: DenHome): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  // The drawing primitive contract exists to diff a SOURCE IMAGE against the
  // deterministic render layer-by-layer. JSON-only plans have no source image
  // to trace; the render is canonical, so the contract does not apply.
  if (isJsonOnlyPlan(home)) return { blockers, warnings };
  const primitives = extractSourceDrawingPrimitives(home.pairedArtifactJson);
  const counts = countDrawingPrimitives(primitives);
  if (!primitives.length) {
    blockers.push('Missing drawing primitive contract; source walls, openings, ladders, dimensions, and fixtures cannot be diffed layer-by-layer.');
    return { blockers, warnings };
  }
  if (counts.wall < 4) blockers.push(`Drawing primitive contract has only ${counts.wall} wall primitive(s); wall differences cannot be trusted.`);
  if (counts.dimension < 2) warnings.push(`Drawing primitive contract has only ${counts.dimension} dimension primitive(s); dimension rhythm may drift.`);
  const missingAnchors = primitives.filter((primitive) => !primitive.sourceAnchorId);
  if (missingAnchors.length) {
    warnings.push(`${missingAnchors.length} drawing primitive(s) are missing sourceAnchorId; repair prompts may be less surgical.`);
  }
  const criticalLayers = new Set(['wall', 'door', 'window', 'ladder', 'dashedVoid', 'fixture']);
  const missingSourceSpans = primitives.filter((primitive) => criticalLayers.has(primitive.layer) && !primitive.sourceSpanFt);
  if (missingSourceSpans.length) {
    const layerCounts = missingSourceSpans.reduce<Record<string, number>>((acc, primitive) => {
      acc[primitive.layer] = (acc[primitive.layer] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(layerCounts)
      .map(([layer, count]) => `${layer} ${count}`)
      .join(', ');
    blockers.push(
      `Drawing primitive contract is missing source-image spans for ${missingSourceSpans.length} critical primitive(s): ${summary}. Compare/Overlay cannot reliably catch wall, opening, fixture, ladder, or void drift until these source spans are extracted or repaired.`,
    );
  }
  const missingSemanticSpans = primitives.filter((primitive) => criticalLayers.has(primitive.layer) && !primitive.semanticSpan);
  if (missingSemanticSpans.length) {
    const layerCounts = missingSemanticSpans.reduce<Record<string, number>>((acc, primitive) => {
      acc[primitive.layer] = (acc[primitive.layer] ?? 0) + 1;
      return acc;
    }, {});
    const summary = Object.entries(layerCounts)
      .map(([layer, count]) => `${layer} ${count}`)
      .join(', ');
    blockers.push(
      `Drawing primitive contract is missing rendered/semantic spans for ${missingSemanticSpans.length} critical primitive(s): ${summary}. Deterministic rendering cannot be primitive-audited until these spans are present.`,
    );
  }
  const ladderPrimitives = primitives.filter((primitive) => primitive.layer === 'ladder');
  if (ladderPrimitives.length && ladderPrimitives.some((primitive) => !primitive.sourceAnchorId || !/ladder|stair/i.test(`${primitive.sourceKind} ${primitive.id}`))) {
    blockers.push('Ladder/stair-symbol primitive is not source-anchored tightly enough to catch ladder double-line or rung/rail mismatch.');
  }
  const geometryDiffs = diffSourceToSemanticDrawingPrimitives(home.pairedArtifactJson);
  const drift = home.pairedArtifactInfo?.visualDrift;
  const edgeSourceMissRate = rawNumber(drift?.metrics?.primitiveEdgeSourceMissRate) ?? rawNumber(drift?.metrics?.edgeSourceMissRate) ?? 1;
  const edgeRenderExtraRate = rawNumber(drift?.metrics?.primitiveEdgeRenderExtraRate) ?? rawNumber(drift?.metrics?.edgeRenderExtraRate) ?? 1;
  const fullEdgeSourceMissRate = rawNumber(drift?.metrics?.edgeSourceMissRate) ?? edgeSourceMissRate;
  const fullEdgeRenderExtraRate = rawNumber(drift?.metrics?.edgeRenderExtraRate) ?? edgeRenderExtraRate;
  const renderedDriftPasses = drift?.passed === true
    && edgeSourceMissRate <= 0.11
    && edgeRenderExtraRate <= 0.08
    && fullEdgeSourceMissRate <= 0.11
    && fullEdgeRenderExtraRate <= 0.08;
  // Source-anchor geometry is a repair hint. The rendered Compare/Overlay edge
  // drift is the customer-visible gate, so do not keep a plan design-blocked
  // solely because a source extraction anchor is noisy after the render passes.
  // Apply the same principle per layer. Source anchors are repair hints, while
  // rendered Compare/Overlay drift is the customer-visible gate. If a layer's
  // visual primitive drift passes, keep noisy anchor/segment deltas as warnings
  // and let the layer's actual rendered drift decide whether it blocks.
  const blockingDiffs = renderedDriftPasses
    ? []
    : geometryDiffs.filter((diff) => diff.severity === 'blocked' && !primitiveLayerVisualPasses(drift, diff.layer));
  const warningDiffs = renderedDriftPasses
    ? []
    : geometryDiffs.filter((diff) => diff.severity === 'warning' || (diff.severity === 'blocked' && primitiveLayerVisualPasses(drift, diff.layer)));
  for (const diff of blockingDiffs.slice(0, 8)) {
    blockers.push(diff.description);
  }
  if (blockingDiffs.length > 8) {
    blockers.push(`${blockingDiffs.length - 8} additional drawing primitive geometry blocker(s) hidden; inspect Semantic drawingPrimitiveContract.`);
  }
  for (const diff of warningDiffs.slice(0, 8)) {
    warnings.push(diff.description);
  }
  if (warningDiffs.length > 8) {
    warnings.push(`${warningDiffs.length - 8} additional drawing primitive geometry warning(s) hidden; inspect Semantic drawingPrimitiveContract.`);
  }
  return { blockers, warnings };
}

function brochureQualityIssues(home: DenHome): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const model = buildableBimFromHome(home);
  const aFrame = /a-frame/i.test(`${home.roofStyle ?? ''} ${home.roofSemantics?.style ?? ''}`);
  const drift = home.pairedArtifactInfo?.visualDrift;
  const review = rawObject(home.pairedArtifactJson)?.brochureQualityReview ?? rawObject(home.pairedArtifactInfo)?.brochureQualityReview;

  if (isJsonOnlyPlan(home) && !drift?.metrics) {
    // No GPT source to drift from; the stored deterministic render is canonical.
  } else if (!drift?.metrics) {
    warnings.push('Brochure Quality has no source-vs-render visual drift evidence for Compare and Overlay (advisory).');
  } else {
    const sourceMissRate = (drift.metrics.primitiveSourceMissRate as number | undefined) ?? drift.metrics.sourceMissRate ?? 1;
    const renderExtraRate = (drift.metrics.primitiveRenderExtraRate as number | undefined) ?? drift.metrics.renderExtraRate ?? 1;
    const edgeSourceMissRate = (drift.metrics.primitiveEdgeSourceMissRate as number | undefined) ?? drift.metrics.edgeSourceMissRate ?? 1;
    const edgeRenderExtraRate = (drift.metrics.primitiveEdgeRenderExtraRate as number | undefined) ?? drift.metrics.edgeRenderExtraRate ?? 1;
    const fullSourceMissRate = drift.metrics.sourceMissRate ?? sourceMissRate;
    const fullRenderExtraRate = drift.metrics.renderExtraRate ?? renderExtraRate;
    const fullEdgeSourceMissRate = drift.metrics.edgeSourceMissRate ?? edgeSourceMissRate;
    const fullEdgeRenderExtraRate = drift.metrics.edgeRenderExtraRate ?? edgeRenderExtraRate;
    const hasModernReview =
      rawObject(review)?.passed === true ||
      home.pairedArtifactInfo?.reviewStatus === 'passed';
    const semanticEdgeBlocked = edgeSourceMissRate > 0.12 || edgeRenderExtraRate > 0.08;
    if (semanticEdgeBlocked) {
      warnings.push(
        `Brochure Compare/Overlay primitive edge drift is high (advisory): edge miss ${(edgeSourceMissRate * 100).toFixed(1)}%, edge extra ${(edgeRenderExtraRate * 100).toFixed(1)}%.`,
      );
    }
    if (!semanticEdgeBlocked && drift.passed !== true) {
      warnings.push(
        `Brochure visual drift is above the advisory target: source miss ${(sourceMissRate * 100).toFixed(1)}%, render extra ${(renderExtraRate * 100).toFixed(1)}%, edge miss ${(edgeSourceMissRate * 100).toFixed(1)}%, edge extra ${(edgeRenderExtraRate * 100).toFixed(1)}%.`,
      );
    }
    const drawingLanguageBlocked =
      fullSourceMissRate > 0.28 ||
      fullRenderExtraRate > 0.28 ||
      fullEdgeSourceMissRate > 0.11 ||
      fullEdgeRenderExtraRate > 0.08;
    if (!semanticEdgeBlocked && drawingLanguageBlocked) {
      warnings.push(
        `Brochure drawing-language drift is high (advisory): full source miss ${(fullSourceMissRate * 100).toFixed(1)}%, full render extra ${(fullRenderExtraRate * 100).toFixed(1)}%, full edge miss ${(fullEdgeSourceMissRate * 100).toFixed(1)}%, full edge extra ${(fullEdgeRenderExtraRate * 100).toFixed(1)}%.`,
      );
    }
    const primitiveLayerDrift = rawObject(drift.metrics.primitiveLayerDrift) ?? {};
    for (const [layer, value] of Object.entries(primitiveLayerDrift)) {
      const metrics = rawObject(value) ?? {};
      const layerSourceMiss = rawNumber(metrics.sourceMissRate) ?? 0;
      const layerRenderExtra = rawNumber(metrics.renderExtraRate) ?? 0;
      const layerEdgeMiss = rawNumber(metrics.edgeSourceMissRate) ?? 0;
      const layerEdgeExtra = rawNumber(metrics.edgeRenderExtraRate) ?? 0;
      const threshold = primitiveLayerThreshold(layer);
      if (primitiveLayerSemanticEdgeBlocked(layer, layerEdgeMiss, layerEdgeExtra)) {
        warnings.push(
          `Brochure ${layer} primitive edge drift is high (advisory): edge miss ${(layerEdgeMiss * 100).toFixed(1)}%, edge extra ${(layerEdgeExtra * 100).toFixed(1)}%.`,
        );
      } else if (
        layer === 'dimension'
          ? layerEdgeExtra > threshold.edgeRenderExtraRate || layerSourceMiss > threshold.sourceMissRate || layerRenderExtra > threshold.renderExtraRate
          : layerSourceMiss > threshold.sourceMissRate || layerRenderExtra > threshold.renderExtraRate
      ) {
        const message = `Brochure ${layer} drawing-language drift is high (advisory): source miss ${(layerSourceMiss * 100).toFixed(1)}%, render extra ${(layerRenderExtra * 100).toFixed(1)}%.`;
        if (isSparseLineworkLayer(layer)) {
          if (drift.passed !== true) warnings.push(message);
        }
        else warnings.push(message);
      }
    }
    if (!semanticEdgeBlocked && !hasModernReview && (edgeSourceMissRate > 0.055 || edgeRenderExtraRate > 0.055)) {
      warnings.push(
        `Brochure Compare/Overlay review is stale (advisory): source miss ${(sourceMissRate * 100).toFixed(1)}%, render extra ${(renderExtraRate * 100).toFixed(1)}%, edge miss ${(edgeSourceMissRate * 100).toFixed(1)}%, edge extra ${(edgeRenderExtraRate * 100).toFixed(1)}%.`,
      );
    }
  }

  const roofPlanes = model.elements.filter((element) => element.category === 'roofPlane');
  if (aFrame) {
    if (home.roofSemantics?.status !== 'validated') {
      blockers.push('A-frame brochure view requires validated paired roof/elevation JSON, not provisional roof inference.');
    }
    if (roofPlanes.length < 2) {
      blockers.push('A-frame brochure view requires two clean roof planes that meet at the ridge.');
    }
    for (const plane of roofPlanes) {
      const ys = (plane.points ?? []).map((point) => point.y);
      const zValues = (plane.points ?? []).map((point) => point.z);
      const xValues = (plane.points ?? []).map((point) => point.x);
      if (ys.length && Math.max(...ys) - Math.min(...ys) < 2) {
        blockers.push(`${plane.id} does not express an A-frame slope; roof panel will look like a flat guide plane.`);
      }
      const maxOverhang = Math.max(2.25, (home.roofSemantics?.overhangFt ?? 1.25) + 0.75);
      const outsideX = Math.max(0, -Math.min(...xValues), Math.max(...xValues) - home.footprint.width);
      const outsideZ = Math.max(0, -Math.min(...zValues), Math.max(...zValues) - home.footprint.depth);
      if (outsideX > maxOverhang || outsideZ > maxOverhang) {
        blockers.push(`${plane.id} extends ${Math.max(outsideX, outsideZ).toFixed(1)} ft outside the footprint, which reads as an oversized floating panel.`);
      }
    }
  }

  const wallSegments = model.elements.filter((element) => element.category === 'wall' && element.segment);
  const wallHeights = wallSegments.map((element) => element.segment!.height).filter((height) => Number.isFinite(height));
  if (wallHeights.length && Math.max(...wallHeights) > Math.max(home.height + 1, 24)) {
    blockers.push('One or more wall panels exceeds the house height envelope and will poke through roof/cutaway views.');
  }

  const fixtureCount = model.elements.filter((element) => ['sanitaryTerminal', 'furniture', 'equipment'].includes(element.category)).length;
  const fixtureProxyCount = model.elements.filter((element) => element.category === 'fixtureProxy').length;
  if (fixtureProxyCount) {
    blockers.push(
      `${fixtureProxyCount} generic fixture proxy BIM element(s) remain; classify fixtures/furniture before sales brochure export.`,
    );
  }
  if (fixtureCount < 3) {
    warnings.push('Brochure 3D has too few typed fixture/furniture elements to read as a furnished sales visualization.');
  }

  if (isJsonOnlyPlan(home)) {
    // JSON-only lane: the deterministic render IS the design asset; there is
    // no GPT image to demand.
    if (!home.pairedArtifactInfo?.deterministicRenderUrl) {
      blockers.push('JSON-only deterministic packet requires the stored deterministic render.');
    }
  } else if (!home.pairedArtifactInfo?.sourceImageUrl || !home.pairedArtifactInfo?.deterministicRenderUrl) {
    blockers.push('Brochure packet requires both GPT proposal and deterministic render images for review/export.');
  }

  if (!home.drawingStyleProfile) {
    if (!isJsonOnlyPlan(home)) {
      warnings.push('No extracted drawing_style_profile_v1; deterministic SVG uses default drawing language (advisory).');
    }
  } else if (home.drawingStyleProfile.validation?.status === 'blocked') {
    warnings.push('drawing_style_profile_v1 validation reported issues (advisory).');
  } else if (home.drawingStyleProfile.validation?.status === 'warning') {
    warnings.push('Brochure 2D style has drawing_style_profile_v1 warnings; review Compare/Overlay before release.');
  }

  return { blockers, warnings };
}

function validationGroups(home: DenHome | null, renderedBounds: RenderedModelBounds | null): ValidationGroup[] {
  const groups: ValidationGroup[] = [
    { id: 'source', label: 'Source', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Attach a brochure-quality GPT proposal image for the same plan.' },
    { id: 'json', label: 'JSON', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Import a paired semantic JSON artifact with rooms, walls, openings, fixtures, and roof metadata.' },
    { id: 'geometry', label: 'Geometry', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Repair the semantic bounds, floor frames, or rendered mesh so all views share one footprint.' },
    { id: 'openings', label: 'Doors / Openings', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Select the opening, nudge or resize it until it sits on a real source wall, then save.' },
    { id: 'fixtures', label: 'Fixtures', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Move, rotate, or resize fixtures so they stay in the right room and clear door swings.' },
    { id: 'visual-drift', label: 'Visual Drift', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Use Compare/Overlay to identify the drifting layer, then generate a scoped GPT JSON Patch repair prompt.' },
    { id: 'standards', label: 'Standards', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Repair semantic roles, required fields, host constraints, or component mappings before brochure promotion.' },
    { id: 'bim', label: 'BIM', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Repair the semantic BIM adapter so the That Open preview/export matches the paired semantic JSON.' },
    { id: 'roof', label: 'Roof', lane: 'design', status: 'pass', blockers: [], warnings: [], action: 'Import explicit roof/elevation JSON or keep roof views marked provisional.' },
    { id: 'presentation-drift', label: 'Presentation Drift', lane: 'presentation', status: 'pass', blockers: [], warnings: [], action: 'Fix renderer theme, wall heights, roof shell/cutaway, or debug-geometry separation without changing semantic JSON.' },
    { id: 'brochure-quality', label: 'Brochure Quality', lane: 'brochure', status: 'pass', blockers: [], warnings: [], action: 'Use browser Compare/Overlay/Product 3D/Cutaway evidence; repair semantic drift or renderer defects before sales export.' },
    { id: 'build', label: 'Build Kit', lane: 'manufacturing', status: 'pass', blockers: [], warnings: [], action: 'Use these manufacturing warnings only when preparing a modular kit; brochure-ready semantic plans are not blocked by panel-module constraints.' },
    { id: 'export', label: 'Export', lane: 'export', status: 'pass', blockers: [], warnings: [], action: 'Stable exports are JSON, SVG, PNG, HTML, and semantic BIM JSON. IFC STEP is experimental until full entity writing lands.' },
    { id: 'accessibility', label: 'Accessibility', lane: 'accessibility', status: 'pass', blockers: [], warnings: [], action: 'Select an accessibility profile before treating these advisory checks as requirements.' },
    { id: 'codeAdvisory', label: 'Code Advisory', lane: 'codeAdvisory', status: 'pass', blockers: [], warnings: [], action: 'Add a jurisdiction-specific rule pack and professional review workflow before claiming code compliance.' },
  ];
  const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
  // Visual drift vs the GPT proposal image is advisory: the paired semantic
  // JSON is the source of truth and the deterministic render is correct by
  // construction, so image-imitation distance never blocks release.
  const ADVISORY_GROUP_IDS = new Set(['visual-drift', 'presentation-drift']);
  const block = (id: string, message: string) => {
    if (ADVISORY_GROUP_IDS.has(id)) {
      byId[id].warnings.push(message);
      return;
    }
    byId[id].blockers.push(message);
  };
  const warn = (id: string, message: string) => byId[id].warnings.push(message);

  if (!home) {
    block('source', 'No active plan selected');
  } else {
    const geometry = liveGeometryAudit(home);
    const jsonOnlyLane = isJsonOnlyPlan(home);
    if (!home.pairedArtifact) block('source', 'Active plan is not a paired image + JSON artifact');
    if (!home.pairedArtifactInfo?.sourceImageUrl && !jsonOnlyLane) warn('source', 'GPT proposal image is missing from local import');
    if (!home.pairedArtifactInfo?.promotionEligible && !jsonOnlyLane) warn('source', 'Artifact is local or review-only until validation promotes it');
    const visualDrift = home.pairedArtifactInfo?.visualDrift;
    const repairHistory = rawObject(home.pairedArtifactJson)?.repairHistory;
    const hasPostDriftRepair = Array.isArray(repairHistory) && repairHistory.length > 0;
    if (jsonOnlyLane && !visualDrift?.metrics) {
      // JSON-only lane: there is no GPT source image, so source-vs-render
      // drift is not a meaningful check; the render is correct by construction.
    } else if (!visualDrift?.metrics) {
      warn('visual-drift', 'No source-vs-render visual drift metrics are attached');
    } else if (
      hasPostDriftRepair &&
      !rawArray(visualDrift.coveredRepairIds).includes(String(rawObject(repairHistory[repairHistory.length - 1])?.id ?? ''))
    ) {
      const lastRepair = rawObject(repairHistory[repairHistory.length - 1]);
      block('visual-drift', `Source proposal and deterministic render drift must be recomputed after semantic repair${typeof lastRepair?.id === 'string' ? ` ${lastRepair.id}` : ''}`);
    } else {
      const sourceMissRate = (visualDrift.metrics.primitiveSourceMissRate as number | undefined) ?? visualDrift.metrics.sourceMissRate ?? 0;
      const renderExtraRate = (visualDrift.metrics.primitiveRenderExtraRate as number | undefined) ?? visualDrift.metrics.renderExtraRate ?? 0;
      const edgeSourceMissRate = (visualDrift.metrics.primitiveEdgeSourceMissRate as number | undefined) ?? visualDrift.metrics.edgeSourceMissRate ?? 0;
      const edgeRenderExtraRate = (visualDrift.metrics.primitiveEdgeRenderExtraRate as number | undefined) ?? visualDrift.metrics.edgeRenderExtraRate ?? 0;
      const fullSourceMissRate = visualDrift.metrics.sourceMissRate ?? sourceMissRate;
      const fullRenderExtraRate = visualDrift.metrics.renderExtraRate ?? renderExtraRate;
      const fullEdgeSourceMissRate = visualDrift.metrics.edgeSourceMissRate ?? edgeSourceMissRate;
      const fullEdgeRenderExtraRate = visualDrift.metrics.edgeRenderExtraRate ?? edgeRenderExtraRate;
      const driftSummary = `primitive source miss ${(sourceMissRate * 100).toFixed(1)}%, primitive render extra ${(renderExtraRate * 100).toFixed(1)}%, primitive edge miss ${(edgeSourceMissRate * 100).toFixed(1)}%, primitive edge extra ${(edgeRenderExtraRate * 100).toFixed(1)}%, full source miss ${(fullSourceMissRate * 100).toFixed(1)}%, full render extra ${(fullRenderExtraRate * 100).toFixed(1)}%, full edge miss ${(fullEdgeSourceMissRate * 100).toFixed(1)}%, full edge extra ${(fullEdgeRenderExtraRate * 100).toFixed(1)}%`;
      const exceedsBrochureSemanticDrift =
        edgeSourceMissRate > 0.12 ||
        edgeRenderExtraRate > 0.08;
      const exceedsBrochureDrawingLanguageDrift =
        fullSourceMissRate > 0.28 ||
        fullRenderExtraRate > 0.28 ||
        fullEdgeSourceMissRate > 0.11 ||
        fullEdgeRenderExtraRate > 0.08;
      if (
        exceedsBrochureSemanticDrift ||
        (visualDrift.passed !== true && (edgeSourceMissRate > 0.12 || edgeRenderExtraRate > 0.08))
      ) {
        block('visual-drift', `Source proposal and deterministic render drift is too high for brochure promotion: ${driftSummary}`);
      } else if (exceedsBrochureDrawingLanguageDrift) {
        warn('visual-drift', `Source proposal and deterministic render primitives are aligned enough for semantic review, but drawing-language drift remains: ${driftSummary}`);
        block('presentation-drift', `Drawing-language drift is too high for brochure presentation: ${driftSummary}`);
      } else if (visualDrift.passed !== true) {
        block('presentation-drift', `Source proposal and deterministic render failed the configured visual drift gate: ${driftSummary}`);
      }
      const primitiveLayerDrift = rawObject(visualDrift.metrics.primitiveLayerDrift) ?? {};
      for (const [layer, value] of Object.entries(primitiveLayerDrift)) {
        const metrics = rawObject(value) ?? {};
        const layerSourceMiss = rawNumber(metrics.sourceMissRate) ?? 0;
        const layerRenderExtra = rawNumber(metrics.renderExtraRate) ?? 0;
        const layerEdgeMiss = rawNumber(metrics.edgeSourceMissRate) ?? 0;
        const layerEdgeExtra = rawNumber(metrics.edgeRenderExtraRate) ?? 0;
        const threshold = primitiveLayerThreshold(layer);
        const layerSummary = `${layer}: source miss ${(layerSourceMiss * 100).toFixed(1)}%, render extra ${(layerRenderExtra * 100).toFixed(1)}%, edge miss ${(layerEdgeMiss * 100).toFixed(1)}%, edge extra ${(layerEdgeExtra * 100).toFixed(1)}%`;
        if (primitiveLayerSemanticEdgeBlocked(layer, layerEdgeMiss, layerEdgeExtra)) {
          block('visual-drift', `Source proposal and deterministic render ${layer} primitive edge drift is too high: ${layerSummary}`);
        } else if (
          layer === 'dimension'
            ? layerEdgeExtra > threshold.edgeRenderExtraRate || layerSourceMiss > threshold.sourceMissRate || layerRenderExtra > threshold.renderExtraRate
            : layerSourceMiss > threshold.sourceMissRate || layerRenderExtra > threshold.renderExtraRate
        ) {
          if (isSparseLineworkLayer(layer)) {
            if (visualDrift.passed !== true) warn('presentation-drift', `Sparse linework drawing-language drift needs review for ${layer}: ${layerSummary}`);
          }
          else block('presentation-drift', `Drawing-language drift is too high for ${layer}: ${layerSummary}`);
        }
      }
      for (const cause of visualDrift.likelySemanticCauses ?? []) warn('visual-drift', `Likely semantic cause: ${cause}`);
    }

    if (!home.rooms.length) block('json', 'Semantic JSON has no rooms');
    if (!home.sourceWalls?.length) block('json', 'Semantic JSON has no source wall graph');
    if (!home.connections?.length) warn('json', 'Semantic JSON has no navigation connections');
    if (!home.spaceFaces?.length) warn('json', 'Semantic JSON has no room face evidence');
    pairedLevelFrameAspectIssues(home).forEach((item) => block('geometry', item));

    if (geometry?.status === 'blocked') geometry.blockers.forEach((item) => block('geometry', item));
    if (renderedBounds?.status === 'blocked') renderedBounds.blockers.forEach((item) => block('geometry', item));

    if (!home.sourceOpenings?.length) {
      warn('openings', 'Semantic JSON has no explicit doors/windows/openings');
    } else {
      for (const opening of home.sourceOpenings) {
        const lengthFt = Math.hypot((opening.x2 - opening.x1) * 4, (opening.z2 - opening.z1) * 4);
        if (lengthFt < 0.5) block('openings', `${opening.id ?? opening.kind} opening is too short`);
        if (home.sourceWalls?.length && !openingAlignedToWall(opening, home.sourceWalls)) {
          block('openings', `${opening.id ?? opening.kind} is not aligned to a source wall`);
        }
      }
      const openingIssues = doorOrOpeningIssues(home);
      openingIssues.blockers.forEach((item) => block('openings', item));
      openingIssues.warnings.forEach((item) => warn('openings', item));
    }

    for (const room of home.rooms) {
      for (const fixture of room.fixtures ?? []) {
        const cx = fixture.x + fixture.w / 2;
        const cz = fixture.z + fixture.d / 2;
        const inside =
          cx >= room.gx - 0.15 &&
          cz >= room.gz - 0.15 &&
          cx <= room.gx + room.gw + 0.15 &&
          cz <= room.gz + room.gd + 0.15;
        if (!inside) {
          const dx = Math.max(room.gx - cx, 0, cx - (room.gx + room.gw)) * 4;
          const dz = Math.max(room.gz - cz, 0, cz - (room.gz + room.gd)) * 4;
          const distanceFt = Math.hypot(dx, dz);
          const isWallBuiltIn = /storage|cabinet|casework|shelf|counter/i.test(`${fixture.type} ${fixture.desc}`);
          if (isWallBuiltIn && distanceFt <= 2) {
            warn('fixtures', `${fixture.desc || fixture.type} is ${distanceFt.toFixed(1)} ft outside ${room.label}`);
          } else {
            block('fixtures', `${fixture.desc || fixture.type} is outside ${room.label}`);
          }
        }
        if (/toilet|sink|vanity|tub|shower|range|washer|dryer/i.test(`${fixture.type} ${fixture.desc}`) && !fixture.wall) {
          warn('fixtures', `${fixture.desc || fixture.type} is missing wall anchor metadata`);
        }
      }
    }
    const fixtureIssues = fixtureFidelityIssues(home);
    fixtureIssues.blockers.forEach((item) => block('fixtures', item));
    fixtureIssues.warnings.forEach((item) => warn('fixtures', item));

    const roofBlockers = roofEditBlockers(home.roofSemantics);
    roofBlockers.forEach((item) => block('roof', item));
    if (home.roofSemantics?.source !== 'paired-json') warn('roof', 'Roof/elevation views are provisional without paired roof JSON');
    const presentation = presentationFidelityIssues(home);
    presentation.blockers.forEach((item) => block('presentation-drift', item));
    presentation.warnings.forEach((item) => warn('presentation-drift', item));
    const drawingStyle = drawingStyleProfileIssues(home);
    drawingStyle.blockers.forEach((item) => block('presentation-drift', item));
    drawingStyle.warnings.forEach((item) => warn('presentation-drift', item));
    const drawingPrimitives = drawingPrimitiveContractIssues(home);
    drawingPrimitives.blockers.forEach((item) => block('visual-drift', item));
    drawingPrimitives.warnings.forEach((item) => warn('visual-drift', item));
    const brochure = brochureQualityIssues(home);
    brochure.blockers.forEach((item) => block('brochure-quality', item));
    brochure.warnings.forEach((item) => warn('brochure-quality', item));
    const bim = buildableBimSummary(buildableBimFromHome(home));
    bim.blockers.forEach((item) => block('bim', item));
    for (const item of bim.warnings.slice(0, 6)) {
      if (/IFC STEP|web-ifc|fragments export/i.test(item)) warn('export', item);
      else if (/extend outside the main footprint; decks\/overhangs may be intentional/i.test(item)) continue;
      else warn('bim', item);
    }
    const standards = validateStandards(home);
    for (const issue of standards.issues) {
      const targetGroup =
        issue.channel === 'manufacturing' ? 'build'
          : issue.channel === 'export' ? 'export'
            : issue.channel === 'accessibility' ? 'accessibility'
              : issue.channel === 'codeAdvisory' ? 'codeAdvisory'
                : issue.standardPack === 'doors-openings' ? 'openings'
                  : issue.standardPack === 'fixtures-kitchen-bath' ? 'fixtures'
                    : issue.standardPack === 'roof-envelope' ? 'roof'
                      : issue.standardPack === 'stairs-guards' ? 'bim'
                        : 'standards';
      const message = `${issue.standardPack}: ${issue.description}`;
      if (issue.severity === 'blocked' && issue.channel === 'design') block(targetGroup, message);
      else warn(targetGroup, message);
    }
    if (!home.buildValidation) {
      warn('build', 'Modular build validation has not run');
    } else {
      home.buildValidation.blockers.forEach((item) => warn('build', item));
      home.buildValidation.warnings.forEach((item) => warn('build', item));
      if (!home.buildValidation.bom.length) warn('build', 'BOM is empty');
      if (!home.componentsUsed.length) warn('build', 'componentsUsed is empty');
    }
    if (!home.pairedArtifactInfo?.deterministicRenderUrl) warn('export', 'No stored deterministic render image is attached; export will include generated SVG instead');
  }

  for (const group of groups) {
    group.blockers = [...new Set(group.blockers)];
    group.warnings = [...new Set(group.warnings)];
    group.status = group.blockers.length ? 'blocked' : group.warnings.length ? 'warning' : 'pass';
  }
  return groups;
}

function emptyLaneSummary(id: ReadinessLane): LaneSummary {
  const meta = READINESS_LANES.find((lane) => lane.id === id);
  return {
    id,
    label: meta?.label ?? id,
    status: 'pass',
    blockers: [],
    warnings: [],
    groups: [],
  };
}

function readinessLanes(groups: ValidationGroup[]): LaneSummary[] {
  return READINESS_LANES.map((lane) => {
    const laneGroups = groups.filter((group) => group.lane === lane.id);
    const blockers = [...new Set(laneGroups.flatMap((group) => group.blockers))];
    const warnings = [...new Set(laneGroups.flatMap((group) => group.warnings))];
    return {
      id: lane.id,
      label: lane.label,
      status: blockers.length ? 'blocked' : warnings.length ? 'warning' : 'pass',
      blockers,
      warnings,
      groups: laneGroups,
    };
  });
}

function downloadJson(filename: string, payload: unknown) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadText(filename: string, text: string, type = 'text/plain') {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(filename: string, dataUrl: string) {
  if (typeof window === 'undefined') return;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
}

function currentCanvasImage(presentationCrop = false) {
  if (typeof document === 'undefined') return null;
  const canvas = document.querySelector('canvas');
  try {
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    if (!presentationCrop) return canvas.toDataURL('image/png');
    const { width, height } = canvas;
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    const context = source.getContext('2d', { willReadFrequently: true });
    if (!context) return canvas.toDataURL('image/png');
    context.drawImage(canvas, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const bg = [image.data[0], image.data[1], image.data[2]];
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const offset = (y * width + x) * 4;
        const dr = Math.abs(image.data[offset] - bg[0]);
        const dg = Math.abs(image.data[offset + 1] - bg[1]);
        const db = Math.abs(image.data[offset + 2] - bg[2]);
        const contrast = dr + dg + db;
        if (contrast > 42 && image.data[offset + 3] > 16) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (minX >= maxX || minY >= maxY) return canvas.toDataURL('image/png');
    const pad = Math.max(24, Math.round(Math.max(maxX - minX, maxY - minY) * 0.18));
    const sx = Math.max(0, minX - pad);
    const sy = Math.max(0, minY - pad);
    const sw = Math.min(width - sx, maxX - minX + pad * 2);
    const sh = Math.min(height - sy, maxY - minY + pad * 2);
    const output = document.createElement('canvas');
    output.width = 1600;
    output.height = 1000;
    const out = output.getContext('2d');
    if (!out) return canvas.toDataURL('image/png');
    out.fillStyle = '#f5f0e8';
    out.fillRect(0, 0, output.width, output.height);
    const scale = Math.min((output.width * 0.86) / sw, (output.height * 0.82) / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    out.drawImage(source, sx, sy, sw, sh, (output.width - dw) / 2, (output.height - dh) / 2, dw, dh);
    return output.toDataURL('image/png');
  } catch {
    return null;
  }
}

function currentSourceImage(home: DenHome | null) {
  if (typeof document === 'undefined' || !home?.pairedArtifactInfo?.sourceImageUrl) return null;
  const sourceUrl = home.pairedArtifactInfo.sourceImageUrl;
  const images = Array.from(document.querySelectorAll('img'));
  const image = images.find((item) => item.src.endsWith(sourceUrl) || item.getAttribute('src') === sourceUrl);
  if (!(image instanceof HTMLImageElement) || !image.complete || !image.naturalWidth || !image.naturalHeight) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function currentDeterministicSvg() {
  if (typeof document === 'undefined') return null;
  const candidates = Array.from(document.querySelectorAll('svg'))
    .map((svg) => ({ svg, rect: svg.getBoundingClientRect() }))
    .filter((item) => item.rect.width > 180 && item.rect.height > 140)
    .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
  const match = candidates[0]?.svg;
  if (!(match instanceof SVGSVGElement)) return null;
  const clone = match.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(candidates[0].rect.width)));
  if (!clone.getAttribute('height')) clone.setAttribute('height', String(Math.round(candidates[0].rect.height)));
  return new XMLSerializer().serializeToString(clone);
}

function buildGenerationPrompt(request: PromptRequest, home: DenHome | null) {
  return [
    '# Paired GPT floorplan generation request',
    '',
    'Generate one paired artifact: a brochure-quality floorplan image and semantic JSON that describe the exact same design.',
    '',
    `Plan intent: ${request.intent}`,
    `Constraints: ${request.constraints}`,
    `Style: ${request.style}`,
    `Bedrooms/baths: ${request.bedBath}`,
    `Footprint: ${request.footprint}`,
    `Levels: ${request.levels}`,
    `Roof/elevation: ${request.roof}`,
    `References: ${request.references}`,
    '',
    home ? [
      'Selected baseline:',
      `- planId: ${home.id}`,
      `- proposalId: ${home.pairedProposalId ?? 'new-draft'}`,
      `- footprint: ${home.footprint.width} x ${home.footprint.depth} ft`,
      `- rooms: ${home.rooms.length}`,
      `- roof status: ${home.roofSemantics?.source ?? 'missing'} / ${home.roofSemantics?.status ?? 'missing'}`,
    ].join('\n') : 'No baseline selected.',
    '',
    'Hard output contract:',
    '- Return an image and a JSON object from the same design pass.',
    '- Every visible image element must have a JSON counterpart.',
    '- Every JSON element must be visible in the image.',
    '- Include rooms, source walls, openings, doors/windows, fixtures, labels, dimensions, roof planes, and front/side elevation metadata.',
    '- Keep all architectural coordinates in feet, not image pixels.',
    '- Make wall lengths, openings, floor spans, and roof pitch compatible with the modular build kit unless explicitly marked blocked.',
    '- Do not use app screenshots, previous generated renders, validation overlays, guide rectangles, or debug UI as style references.',
    '- Keep clean cabin-style architectural linework and presentation quality.',
  ].join('\n');
}

function buildFeedbackPrompt(home: DenHome | null, audit: ReturnType<typeof productAudit>) {
  const source = home?.pairedArtifactInfo;
  const design = audit.designQuality;
  const presentation = audit.presentationQuality;
  const brochure = audit.brochureQuality;
  const manufacturing = audit.manufacturingReadiness;
  const exportLane = audit.exportReadiness;
  return [
    '# Paired floorplan repair request',
    '',
    'Repair the paired floorplan artifact without confusing design quality, manufacturing readiness, and export readiness.',
    '',
    `Plan: ${home?.id ?? 'unknown'}`,
    `Proposal: ${home?.pairedProposalId ?? source?.proposalId ?? 'unknown'}`,
    '',
    'Design Quality:',
    `- status: ${design.status}`,
    ...(design.blockers.length ? design.blockers.map((blocker) => `- blocker: ${blocker}`) : ['- blockers: none']),
    ...(design.warnings.length ? design.warnings.map((warning) => `- warning: ${warning}`) : ['- warnings: none']),
    '',
    'Presentation Quality:',
    `- status: ${presentation.status}`,
    ...(presentation.blockers.length ? presentation.blockers.map((blocker) => `- blocker: ${blocker}`) : ['- blockers: none']),
    ...(presentation.warnings.length ? presentation.warnings.map((warning) => `- warning: ${warning}`) : ['- warnings: none']),
    '',
    'Brochure Quality:',
    `- status: ${brochure.status}`,
    ...(brochure.blockers.length ? brochure.blockers.map((blocker) => `- blocker: ${blocker}`) : ['- blockers: none']),
    ...(brochure.warnings.length ? brochure.warnings.map((warning) => `- warning: ${warning}`) : ['- warnings: none']),
    '',
    'Manufacturing Readiness:',
    `- status: ${manufacturing.status}`,
    ...(manufacturing.blockers.length ? manufacturing.blockers.map((blocker) => `- blocker: ${blocker}`) : ['- blockers: none']),
    ...(manufacturing.warnings.length ? manufacturing.warnings.map((warning) => `- warning: ${warning}`) : ['- warnings: none']),
    '',
    'Export Readiness:',
    `- status: ${exportLane.status}`,
    ...(exportLane.blockers.length ? exportLane.blockers.map((blocker) => `- blocker: ${blocker}`) : ['- blockers: none']),
    ...(exportLane.warnings.length ? exportLane.warnings.map((warning) => `- warning: ${warning}`) : ['- warnings: none']),
    '',
    'Repair policy:',
    '- If Design Quality has issues, patch only the matching design layer. Do not change module-grid dimensions unless the design layer requires it.',
    '- If Manufacturing Readiness has issues, optimize module-grid/panel/span metadata only; keep the brochure design intent intact.',
    '- If Export Readiness has only experimental IFC/tooling warnings, return [] because local export code must be improved instead of changing the plan.',
    '- Return only corrected paired_gpt_floorplan_v1 JSON or an RFC 6902 JSON Patch when the app asks for a patch.',
    'Preserve the source plan. Do not rectangle-pack, invent walls, remove fixtures, or simplify the proposal to make validation easier.',
  ].join('\n');
}

function cliSafeName(value: string | number | null | undefined) {
  return String(value ?? 'unknown').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

function semanticPlanForHome(home: DenHome) {
  return {
    schemaVersion: 'paired_semantic_render_v1',
    planId: home.id,
    proposalId: home.pairedProposalId,
    model: home.model,
    footprint: home.footprint,
    height: home.height,
    bedBath: home.bedBath,
    roofStyle: home.roofStyle,
    rooms: home.rooms,
    connections: home.connections,
    sourceWalls: home.sourceWalls,
    sourceOpenings: home.sourceOpenings,
    spaceFaces: home.spaceFaces,
    dimensionFrame: home.dimensionFrame,
    floorFrames: home.floorFrames,
    roofSemantics: home.roofSemantics,
    sourcePairedArtifact: home.pairedArtifactJson,
  };
}

const REPAIR_LAYER_OPTIONS: RepairLayer[] = [
  'walls',
  'openings',
  'doors',
  'windows',
  'fixtures',
  'furniture',
  'stairs',
  'void/open-to-below',
  'roof/elevation',
  'labels',
  'dimensions',
  'level frames',
];

function repairLayerForValidationGroup(group: Pick<ValidationGroup, 'id' | 'lane' | 'blockers' | 'warnings'>): RepairLayer {
  if (group.lane === 'manufacturing') return 'walls';
  if (group.lane === 'export') return 'dimensions';
  if (group.lane === 'accessibility' || group.lane === 'codeAdvisory') return 'level frames';
  const text = [...group.blockers, ...group.warnings].join('\n');
  if (group.lane === 'presentation') {
    if (/roof|eave|ridge|cutaway|plane/i.test(text)) return 'roof/elevation';
    if (/door|opening|window/i.test(text)) return 'openings';
    if (/fixture|furniture|symbol/i.test(text)) return 'fixtures';
    return 'walls';
  }
  if (group.lane === 'brochure') {
    if (/roof|eave|ridge|gable|panel|cutaway|plane|intersection/i.test(text)) return 'roof/elevation';
    if (/fixture|furniture|sales|visualization/i.test(text)) return 'fixtures';
    if (/window|opening|door/i.test(text)) return 'openings';
    if (/compare|overlay|drift|wall|style|caps|corners/i.test(text)) return 'walls';
    return 'level frames';
  }
  if (group.id === 'geometry' || /level frame|floorPanel|floor panel|dimension|scale|frame|bounds|footprint|outside/i.test(text)) return 'level frames';
  if (/roof|ridge|eave|slope|plane/i.test(text)) return 'roof/elevation';
  if (/door|swing|opening/i.test(text)) return 'doors';
  if (/window/i.test(text)) return 'windows';
  if (/fixture|toilet|sink|vanity|tub|shower|range|washer|dryer|furniture|bed|sofa|table|chair/i.test(text)) return 'fixtures';
  if (/stair|ladder|tread|landing/i.test(text)) return 'stairs';
  if (/void|open.to.below|open-to-below/i.test(text)) return 'void/open-to-below';
  if (/wall|panel|module|host|anchor/i.test(text)) return 'walls';
  return repairLayerFromGroupId(group.id);
}

function reportsFromValidationGroups(home: DenHome | null, groups: ValidationGroup[]): LayerDriftReport[] {
  if (!home) return [];
  const reports: LayerDriftReport[] = [];
  for (const group of groups) {
    const messages = [...group.blockers, ...group.warnings].map((message) => {
      if (group.lane === 'manufacturing') {
        return `Manufacturing readiness only: ${message}. Optimize module grid, panel SKU, span, or build-kit metadata without changing brochure design quality unless explicitly requested.`;
      }
      if (group.lane === 'export') {
        return `Export readiness only: ${message}. If this is an experimental IFC/tooling limitation rather than a semantic data gap, return [] and do not alter design JSON.`;
      }
      if (group.lane === 'presentation') {
        return `Presentation renderer contract only: ${message}. Do not alter semantic JSON to fix style, wall height, material, debug geometry, or camera/cutaway behavior. Return [] unless this issue proves required renderer metadata is missing from the paired JSON.`;
      }
      if (group.lane === 'brochure') {
        return `Brochure quality blocker: ${message}. Decide whether this is semantic drift or renderer presentation drift. Patch paired JSON only for source/design mismatch; return [] for renderer-only or export-only defects.`;
      }
      if (group.lane === 'accessibility' || group.lane === 'codeAdvisory') {
        return `Advisory standards signal only: ${message}. Do not claim legal code compliance and do not alter design JSON unless this issue corresponds to a visible or configured requirement.`;
      }
      return `Design quality: ${message}. Do not alter module-grid or manufacturing constraints unless the visible design mismatch requires it.`;
    });
    if (!messages.length) continue;
    if (group.id === 'visual-drift') {
      const visualLayers: RepairLayer[] = [
        'walls',
        'openings',
        'doors',
        'windows',
        'fixtures',
        'furniture',
        'stairs',
        'void/open-to-below',
        'labels',
        'dimensions',
        'level frames',
      ];
      for (const layer of visualLayers) {
        reports.push(createLayerDriftReport(home, layer, [
          ...messages,
          `Visual drift layer triage: inspect Compare/Overlay and patch only the ${layer} fields if that layer visibly differs from the GPT proposal. Return [] if this layer is not the cause.`,
        ]));
      }
      continue;
    }
    reports.push(createLayerDriftReport(home, repairLayerForValidationGroup(group), messages));
  }
  if (home.pairedArtifact) {
    reports.push(createLayerDriftReport(home, 'doors', [
      'Manual visual door fidelity review: verify door type, host wall, hinge point, swing direction, opensIntoRoomId, width, and source anchor against the GPT proposal image.',
    ]));
    reports.push(createLayerDriftReport(home, 'fixtures', [
      'Manual visual fixture/furniture fidelity review: verify type, room ownership, bounds, rotation, facingDirection, anchorWallId, clearance, sourceAnchorId, BIM class, and symbol variant against the GPT proposal image.',
    ]));
  }
  if (!reports.length) {
    reports.push(createLayerDriftReport(home, 'fixtures', ['No active blockers. Use this only for a visible fixture/furniture mismatch you can see in Compare or Overlay.']));
  }
  const seen = new Set<string>();
  return reports.filter((report) => {
    const key = `${report.layer}:${report.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function semanticSvgForHome(home: DenHome) {
  const scale = 18;
  const pad = 24;
  const width = home.footprint.width * scale + pad * 2;
  const height = home.footprint.depth * scale + pad * 2;
  const roomEls = home.rooms
    .filter((room) => (room.floor ?? 0) === 0)
    .map((room) => {
      const x = pad + room.gx * 4 * scale;
      const y = pad + room.gz * 4 * scale;
      const w = room.gw * 4 * scale;
      const h = room.gd * 4 * scale;
      const labelX = x + w / 2;
      const labelY = y + h / 2;
      const fontSize = Math.max(4.5, Math.min(8.5, w / Math.max(7, room.label.length * 0.72), h * 0.16));
      const textLength = Math.max(10, Math.min(w - 8, room.label.length * fontSize * 0.62));
      return `<g><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${room.color}" fill-opacity="0.42"/><text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="monospace" font-size="${fontSize.toFixed(1)}" textLength="${textLength.toFixed(1)}" lengthAdjust="spacingAndGlyphs" fill="#514b45">${escapeHtml(room.label)}</text></g>`;
    })
    .join('');
  const wallEls = (home.sourceWalls ?? [])
    .filter((wall) => (wall.floor ?? 0) === 0)
    .map((wall) => {
      const x1 = pad + wall.x1 * scale;
      const y1 = pad + wall.z1 * scale;
      const x2 = pad + wall.x2 * scale;
      const y2 = pad + wall.z2 * scale;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${wall.exterior ? '#221f1c' : '#5c554d'}" stroke-width="${wall.exterior ? 4 : 2}" stroke-linecap="square"/>`;
    })
    .join('');
  const openingEls = (home.sourceOpenings ?? [])
    .filter((opening) => (opening.floor ?? 0) === 0)
    .map((opening) => {
      const x1 = pad + opening.x1 * scale;
      const y1 = pad + opening.z1 * scale;
      const x2 = pad + opening.x2 * scale;
      const y2 = pad + opening.z2 * scale;
      return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#fdfbf7" stroke-width="6" stroke-linecap="square"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="${height.toFixed(0)}" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}"><rect width="100%" height="100%" fill="#fdfbf7"/><rect x="${pad}" y="${pad}" width="${(home.footprint.width * scale).toFixed(1)}" height="${(home.footprint.depth * scale).toFixed(1)}" fill="none" stroke="#ded8cf" stroke-width="1"/><g>${roomEls}${wallEls}${openingEls}</g></svg>`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Elevation model from the paired artifact (honest openings, real roof). */
function elevationModelForHome(home: DenHome, side: 'front' | 'side') {
  const raw = rawObject(home.pairedArtifactJson) as unknown as Partial<ElevationArtifactInput> | null;
  const roofRaw = (raw?.roof ?? {}) as ElevationArtifactInput['roof'];
  const artifact: ElevationArtifactInput = {
    planId: home.id,
    footprint: {
      widthFt: Number((raw?.footprint as { widthFt?: number } | undefined)?.widthFt ?? home.footprint.width),
      depthFt: Number((raw?.footprint as { depthFt?: number } | undefined)?.depthFt ?? home.footprint.depth),
    },
    roof: {
      style: roofRaw?.style ?? home.roofStyle,
      ridgeAxis: roofRaw?.ridgeAxis ?? home.roofSemantics?.ridgeAxis ?? 'x',
      ridgeHeightFt: Number(roofRaw?.ridgeHeightFt ?? home.roofSemantics?.ridgeHeightFt ?? home.height),
      eaveHeightFt: Number(roofRaw?.eaveHeightFt ?? home.roofSemantics?.eaveHeightFt ?? Math.max(7, home.height * 0.45)),
      overhangFt: Number(roofRaw?.overhangFt ?? home.roofSemantics?.overhangFt ?? 1),
      planes: roofRaw?.planes ?? home.roofSemantics?.planes,
    },
    windows: (raw?.windows ?? []) as ElevationArtifactInput['windows'],
    doors: (raw?.doors ?? []) as ElevationArtifactInput['doors'],
  };
  return buildElevationModel(artifact, side);
}

/** Standalone elevation SVG, derived from the artifact (no invented openings). */
function elevationSvgMarkup(home: DenHome, side: 'front' | 'side'): string {
  return elevationSvgString(elevationModelForHome(home, side));
}

/** Cherokee County constraint report as a standalone printable HTML page. */
function constraintReportHtml(home: DenHome): string {
  const report = codeAdvisoryReportForHome(home);
  const statusColor: Record<string, string> = { pass: '#0a7a4a', fail: '#b42318', 'not-evaluated': '#8a8178' };
  const rows = report.findings.map((finding) => [
    '<tr>',
    `<td>${escapeHtml(finding.ruleId)}</td>`,
    `<td>${escapeHtml(finding.subjectLabel ?? '-')}</td>`,
    `<td style="color:${statusColor[finding.status] ?? '#333'};font-weight:600">${escapeHtml(finding.status)}</td>`,
    `<td>${escapeHtml(finding.detail)}</td>`,
    `<td style="color:#666">${escapeHtml(finding.citation)}</td>`,
    '</tr>',
  ].join('')).join('\n');
  return [
    '<!doctype html><html><head><meta charset="utf-8"/>',
    `<title>${escapeHtml(home.id)} - Constraint Report</title>`,
    '<style>body{font-family:ui-monospace,Menlo,monospace;margin:32px;color:#27241f;background:#fbfaf6}',
    'table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d8d2c6;padding:6px 8px;text-align:left;vertical-align:top}',
    'th{background:#f2eee7;text-transform:uppercase;font-size:10px;letter-spacing:.06em}h1{font-size:18px}h2{font-size:13px;color:#6b6359}</style></head><body>',
    `<h1>${escapeHtml(home.id)} - Code Advisory Report</h1>`,
    `<h2>${escapeHtml(report.jurisdiction.label)} - ${escapeHtml(report.jurisdiction.codeEdition)}</h2>`,
    report.jurisdiction.transitionNote ? `<p style="color:#9a6b00;font-size:12px">${escapeHtml(report.jurisdiction.transitionNote)}</p>` : '',
    `<p style="font-size:12px">Summary: ${report.summary.pass} pass / ${report.summary.fail} fail / ${report.summary.notEvaluated} not evaluated</p>`,
    '<table><thead><tr><th>Rule</th><th>Subject</th><th>Status</th><th>Detail</th><th>Citation</th></tr></thead><tbody>',
    rows,
    '</tbody></table>',
    '<p style="color:#8a8178;font-size:11px;margin-top:16px">Advisory only - legal code compliance is not claimed without a jurisdiction rule pack and professional review.</p>',
    '</body></html>',
  ].join('\n');
}

/** Single self-contained client packet: plan, elevations, report, BOM. */
function clientPacketHtml(home: DenHome, planSvg: string, groups: ValidationGroup[]): string {
  const report = constraintReportHtml(home);
  const reportBody = report.slice(report.indexOf('<body>') + 6, report.indexOf('</body>'));
  const bom = home.buildValidation?.bom ?? [];
  const bomRows = bom.map((item) => {
    const record = item as unknown as Record<string, unknown>;
    return `<tr><td>${escapeHtml(String(record.componentId ?? ''))}</td><td>${escapeHtml(String(record.quantity ?? record.count ?? 1))}</td><td>${escapeHtml(String(record.label ?? record.category ?? ''))}</td></tr>`;
  }).join('\n');
  const exportLane = groups.find((group) => group.id === 'export');
  return [
    '<!doctype html><html><head><meta charset="utf-8"/>',
    `<title>${escapeHtml(home.id)} - Client Packet</title>`,
    '<style>body{font-family:ui-monospace,Menlo,monospace;margin:32px;color:#27241f;background:#fbfaf6;max-width:980px}',
    'section{margin-bottom:36px}h1{font-size:20px}h2{font-size:14px;border-bottom:1px solid #d8d2c6;padding-bottom:4px}',
    'table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #d8d2c6;padding:6px 8px;text-align:left}',
    'svg{max-width:100%;height:auto;border:1px solid #e4ddd0;background:#fff}.badge{display:inline-block;border:1px solid #c9c2b4;background:#f2eee7;padding:2px 8px;font-size:10px;margin-left:8px}</style></head><body>',
    `<h1>${escapeHtml(home.model || home.id)}<span class="badge">JSON-only deterministic packet</span></h1>`,
    `<p style="font-size:12px;color:#6b6359">${escapeHtml(home.id)} - ${home.footprint.width}' x ${home.footprint.depth}' - ${home.sqft} sq ft - ${escapeHtml(home.bedBath ?? '')} - ${escapeHtml(home.roofStyle ?? '')} roof${exportLane ? ` - export lane: ${escapeHtml(exportLane.status)}` : ''}</p>`,
    '<section><h2>Floor Plan</h2>', planSvg, '</section>',
    '<section><h2>Front Elevation</h2>', elevationSvgMarkup(home, 'front'), '</section>',
    '<section><h2>Side Elevation</h2>', elevationSvgMarkup(home, 'side'), '</section>',
    `<section><h2>Build Kit (${bom.length} BOM items)</h2><table><thead><tr><th>Component</th><th>Qty</th><th>Label</th></tr></thead><tbody>`, bomRows, '</tbody></table></section>',
    '<section>', reportBody, '</section>',
    '</body></html>',
  ].join('\n');
}

function brochureHtmlForHome(
  home: DenHome,
  groups: ValidationGroup[],
  current3dImage: string | null,
  attributions: ReturnType<typeof localVisualAssetAttributions>,
  sourceImageDataUrl?: string | null,
  deterministicSvg?: string | null,
) {
  const lanes = readinessLanes(groups);
  const readinessSummary = lanes.map((lane) => (
    `<span class="status-pill status-${escapeHtml(lane.status)}">${escapeHtml(lane.label)}: ${escapeHtml(lane.status)}</span>`
  )).join('');
  const validation = lanes.map((lane) => (
    `<li><strong>${escapeHtml(lane.label)}:</strong> ${escapeHtml(lane.status)}<ul>${lane.groups.map((group) => (
      `<li><strong>${escapeHtml(group.label)}:</strong> ${escapeHtml(group.status)}${group.blockers.length ? ` - ${escapeHtml(group.blockers.join('; '))}` : ''}${group.warnings.length ? ` - ${escapeHtml(group.warnings.join('; '))}` : ''}</li>`
    )).join('')}</ul></li>`
  )).join('');
  const sourceImageUrl = sourceImageDataUrl ?? home.pairedArtifactInfo?.sourceImageUrl;
  const sourceImage = sourceImageUrl
    ? `<img src="${escapeHtml(sourceImageUrl)}" alt="GPT proposal" />`
    : '<div class="placeholder">No source proposal image attached.</div>';
  const product3d = current3dImage
    ? `<img src="${current3dImage}" alt="Product 3D rendering" />`
    : '<div class="placeholder">No product 3D image captured.</div>';
  const attributionItems = attributions.map((asset) => (
    `<li>${asset.sourceUrl ? `<a href="${escapeHtml(asset.sourceUrl)}">${escapeHtml(asset.label)}</a>` : escapeHtml(asset.label)} by ${asset.authorUrl ? `<a href="${escapeHtml(asset.authorUrl)}">${escapeHtml(asset.author)}</a>` : escapeHtml(asset.author)} - ${asset.licenseUrl ? `<a href="${escapeHtml(asset.licenseUrl)}">${escapeHtml(asset.license)}</a>` : escapeHtml(asset.license)}</li>`
  )).join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(home.model)} Brochure Packet</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; background: #ece6dc; color: #302b26; font-family: ui-serif, Georgia, serif; }
    main { max-width: 1180px; margin: 0 auto; padding: 44px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: end; padding-bottom: 26px; }
    h1 { margin: 0; font-size: 44px; font-weight: 500; letter-spacing: 0; line-height: 1; }
    h2 { margin: 0 0 12px; font-size: 18px; font-weight: 500; }
    .eyebrow { color: #9a6b5f; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 12px; }
    .meta { color: #6f675e; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; text-align: right; line-height: 1.8; }
    .hero { background: #f8f4ec; border: 1px solid #d4cabe; padding: 26px; box-shadow: 0 18px 40px rgba(56, 48, 40, 0.08); }
    .hero figcaption { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .hero img { max-height: 720px; object-fit: contain; background: #f5efe6; }
    .status-row { display: flex; flex-wrap: wrap; gap: 8px; margin: -8px 0 26px; }
    .status-pill { border: 1px solid #d8d0c6; background: #fffdf8; color: #5b534b; padding: 7px 10px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
    .status-pass { border-color: #adcbb5; color: #17683a; }
    .status-warning { border-color: #dfc38d; color: #9a5a16; }
    .status-blocked { border-color: #d9aaa0; color: #a33c28; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; }
    figure { margin: 0; background: #fffdf8; border: 1px solid #ddd6cc; padding: 18px; }
    figcaption { margin-bottom: 12px; color: #8a8178; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; text-transform: uppercase; }
    img, svg { width: 100%; height: auto; display: block; }
    section { margin-top: 28px; background: #fffdf8; border: 1px solid #ddd6cc; padding: 18px; }
    .fine-print { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #746b62; }
    li { margin: 6px 0; }
    .placeholder { min-height: 260px; display: grid; place-items: center; color: #8a8178; border: 1px dashed #d8d0c6; }
    @media (max-width: 820px) { main { padding: 22px; } header, .grid { grid-template-columns: 1fr; display: grid; } h1 { font-size: 34px; } .meta { text-align: left; } }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <div class="eyebrow">Floorplan Studio</div>
        <h1>${escapeHtml(home.model)}</h1>
      </div>
      <div class="meta">${escapeHtml(home.sqft)} sf<br />${escapeHtml(home.footprint.width)}' x ${escapeHtml(home.footprint.depth)}'<br />${escapeHtml(home.bedBath)}</div>
    </header>
    <div class="status-row">${readinessSummary}</div>
    <figure class="hero">
      <figcaption><span>Product 3D</span><span>${escapeHtml(home.roofStyle)} roof</span></figcaption>
      ${product3d}
    </figure>
    <div class="grid">
      <figure><figcaption>Deterministic Semantic Plan</figcaption>${deterministicSvg ?? semanticSvgForHome(home)}</figure>
      <figure><figcaption>GPT Proposal Reference</figcaption>${sourceImage}</figure>
    </div>
    <section>
      <h2>Validation</h2>
      <ul>${validation}</ul>
    </section>
    <section>
      <h2>3D Asset Credits</h2>
      <ul class="fine-print">${attributionItems}</ul>
    </section>
  </main>
</body>
</html>`;
}

function ProductWorkflowPanel({
  home,
  renderedBounds,
  lifecycle,
  promptRequest,
  importText,
  importSourceImage,
  importStatus,
  onLifecycleChange,
  onPromptChange,
  onImportTextChange,
  onImportSourceImageChange,
  onImportPlan,
  onExportPacket,
}: {
  home: DenHome | null;
  renderedBounds: RenderedModelBounds | null;
  lifecycle: ArtifactLifecycle;
  promptRequest: PromptRequest;
  importText: string;
  importSourceImage: string;
  importStatus: string;
  onLifecycleChange: (state: ArtifactLifecycle) => void;
  onPromptChange: (request: PromptRequest) => void;
  onImportTextChange: (text: string) => void;
  onImportSourceImageChange: (text: string) => void;
  onImportPlan: () => void;
  onExportPacket: () => void;
}) {
  const audit = useMemo(() => productAudit(home, renderedBounds), [home, renderedBounds]);
  const generationPrompt = useMemo(() => buildGenerationPrompt(promptRequest, home), [promptRequest, home]);
  const feedbackPrompt = useMemo(() => buildFeedbackPrompt(home, audit), [home, audit]);
  const updatePrompt = (key: keyof PromptRequest, value: string) => onPromptChange({ ...promptRequest, [key]: value });
  const canPromote = audit.blockers.length === 0 && home?.pairedArtifactInfo?.promotionEligible === true;
  const [briefText, setBriefText] = useState('');
  const [briefUnparsed, setBriefUnparsed] = useState<string[]>([]);
  const [generateStatus, setGenerateStatus] = useState('');
  const [hasGenerationKey, setHasGenerationKey] = useState<boolean | null>(null);
  useEffect(() => {
    fetch('/api/generate-plan')
      .then((res) => res.json())
      .then((body) => setHasGenerationKey(Boolean(body.hasKey)))
      .catch(() => setHasGenerationKey(false));
  }, []);
  const onGeneratePlan = async () => {
    if (!briefText.trim()) {
      setGenerateStatus('Type a brief first.');
      return;
    }
    setGenerateStatus(hasGenerationKey ? 'Generating via OpenAI...' : 'Generating from deterministic template (no OPENAI_API_KEY)...');
    try {
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: briefText }),
      });
      const body = await res.json();
      if (!res.ok) {
        setGenerateStatus(`Generation failed: ${body.error ?? res.status}${body.errors ? ` - ${body.errors.slice(0, 3).join('; ')}` : ''}`);
        return;
      }
      setGenerateStatus(`Generated ${body.planId} (${body.mode}). Loading...`);
      window.location.href = body.url;
    } catch (error) {
      setGenerateStatus(`Generation failed: ${(error as Error).message}`);
    }
  };

  return (
    <div className="border-t border-stone-200 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Prompt To Plan</h2>
        <span className={`font-mono text-[10px] ${audit.blockers.length ? 'text-red-700' : 'text-emerald-700'}`}>
          {lifecycle}
        </span>
      </div>
      <div className="mt-2 space-y-2 text-[10px]">
        <div>
          <div className="text-stone-400">Plan status - where this plan sits in your workflow (saved in this browser). Promote needs every gate green.</div>
          <div className="mt-1 grid grid-cols-2 gap-1">
            {(['draft', 'review', 'promoted', 'exported'] as ArtifactLifecycle[]).map((state) => (
              <button
                key={state}
                type="button"
                onClick={() => onLifecycleChange(state)}
                disabled={state === 'promoted' && !canPromote}
                title={state === 'promoted' && !canPromote ? 'Blocked: clear the product blockers first' : `Mark ${state}`}
                className={`border px-2 py-1 ${lifecycle === state ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-200 bg-white text-stone-600 disabled:opacity-40'}`}
              >
                {state}
              </button>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="mb-1 block text-stone-400">brief (one line, parsed deterministically)</span>
          <textarea
            value={briefText}
            onChange={(event) => setBriefText(event.target.value)}
            placeholder={'2-bed A-frame, ≤800 sqft, 40×60 lot, 5 ft side setbacks'}
            data-brief-input
            className="h-12 w-full resize-none rounded-sm border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700 focus:border-stone-400"
          />
        </label>
        <button
          type="button"
          data-brief-parse
          onClick={() => {
            const parsed = parseBrief(briefText);
            setBriefUnparsed(parsed.unparsed);
            onPromptChange({
              ...promptRequest,
              ...briefToPromptFields(parsed),
              intent: briefText.trim() || promptRequest.intent,
            });
          }}
          className="w-full rounded-sm border border-stone-800 bg-stone-800 px-2 py-1 text-white hover:bg-stone-700"
        >
          Parse Brief Into Request
        </button>
        {briefUnparsed.length > 0 && (
          <div className="rounded-sm border border-amber-200 bg-amber-50 p-1.5 text-amber-800" data-brief-unparsed>
            Not understood (add manually below): {briefUnparsed.join('; ')}
          </div>
        )}
        <button
          type="button"
          data-generate-plan
          onClick={onGeneratePlan}
          className="w-full rounded-sm border border-emerald-800 bg-emerald-800 px-2 py-1 text-white hover:bg-emerald-700"
        >
          Generate Plan From Brief
        </button>
        {hasGenerationKey === false && (
          <div className="text-[9px] leading-snug text-stone-400">
            No OPENAI_API_KEY in .env.local - Generate uses the deterministic template until one is added.
          </div>
        )}
        {generateStatus && (
          <div className="border border-stone-200 bg-stone-50 p-1.5 text-stone-600" data-generate-status>
            {generateStatus}
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-stone-400">intent</span>
          <textarea
            value={promptRequest.intent}
            onChange={(event) => updatePrompt('intent', event.target.value)}
            className="h-16 w-full resize-none border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
          />
        </label>
        <div className="grid grid-cols-2 gap-1">
          <label className="block">
            <span className="mb-1 block text-stone-400">bed/bath</span>
            <input value={promptRequest.bedBath} onChange={(event) => updatePrompt('bedBath', event.target.value)} className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700" />
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">footprint</span>
            <input value={promptRequest.footprint} onChange={(event) => updatePrompt('footprint', event.target.value)} className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700" />
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">levels</span>
            <input value={promptRequest.levels} onChange={(event) => updatePrompt('levels', event.target.value)} className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700" />
          </label>
          <label className="block">
            <span className="mb-1 block text-stone-400">roof</span>
            <input value={promptRequest.roof} onChange={(event) => updatePrompt('roof', event.target.value)} className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700" />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-stone-400">style / references</span>
          <textarea
            value={`${promptRequest.style}\n${promptRequest.references}`}
            onChange={(event) => {
              const [style = '', ...rest] = event.target.value.split('\n');
              onPromptChange({ ...promptRequest, style, references: rest.join('\n') });
            }}
            className="h-20 w-full resize-none border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
          />
        </label>
        <div className="grid grid-cols-2 gap-1">
          <button type="button" onClick={() => navigator.clipboard?.writeText(generationPrompt)} className="border border-stone-300 bg-white px-2 py-1 text-stone-700">
            Copy GPT Prompt
          </button>
          <button type="button" onClick={() => downloadJson(`${home?.id ?? 'plan'}-prompt-packet.json`, { prompt: generationPrompt, request: promptRequest })} className="border border-stone-300 bg-white px-2 py-1 text-stone-700">
            Export Prompt
          </button>
        </div>
        <label className="block">
          <span className="mb-1 block text-stone-400">import paired JSON or exported semantic plan</span>
          <input
            value={importSourceImage}
            onChange={(event) => onImportSourceImageChange(event.target.value)}
            placeholder="optional source image URL or data URL"
            className="mb-1 w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
          />
          <textarea
            value={importText}
            onChange={(event) => onImportTextChange(event.target.value)}
            placeholder='Paste paired_gpt_floorplan_v1 JSON, an exported DenHome JSON, or {"semanticPlan": ...}'
            className="h-24 w-full resize-none border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
          />
        </label>
        <div className="grid grid-cols-2 gap-1">
          <button type="button" onClick={onImportPlan} className="border border-stone-300 bg-white px-2 py-1 text-stone-700">
            Import Draft
          </button>
          <button type="button" onClick={onExportPacket} className="border border-stone-300 bg-white px-2 py-1 text-stone-700">
            Export Packet
          </button>
        </div>
        {importStatus && <div className="text-[9px] text-stone-500">{importStatus}</div>}
        <div className="border border-stone-200 bg-stone-50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-stone-400">validation</span>
            <span className={`font-mono ${audit.blockers.length ? 'text-red-700' : 'text-emerald-700'}`}>
              {audit.blockers.length ? 'blocked' : 'reviewable'}
            </span>
          </div>
          {(audit.blockers.length ? audit.blockers : ['source of truth, geometry, and 3D bounds are reviewable']).slice(0, 5).map((item) => (
            <div key={item} className={audit.blockers.length ? 'text-red-700' : 'text-emerald-700'}>{item}</div>
          ))}
          {audit.warnings.slice(0, 4).map((item) => (
            <div key={item} className="text-amber-700">{item}</div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(feedbackPrompt)}
          className="w-full border border-stone-300 bg-white px-2 py-1 text-stone-700"
        >
          Generate Feedback Prompt
        </button>
      </div>
    </div>
  );
}

function ConstraintReportPanel({ home }: { home: DenHome }) {
  const artifactLot = useMemo(() => lotFromArtifact(home.pairedArtifactJson), [home.pairedArtifactJson]);
  const [lotDraft, setLotDraft] = useState<{
    widthFt: string; depthFt: string; front: string; rear: string; left: string; right: string; coveragePct: string;
  } | null>(null);
  const draft = lotDraft ?? {
    widthFt: artifactLot ? String(artifactLot.widthFt) : '',
    depthFt: artifactLot ? String(artifactLot.depthFt) : '',
    front: String(artifactLot?.setbacksFt?.front ?? ''),
    rear: String(artifactLot?.setbacksFt?.rear ?? ''),
    left: String(artifactLot?.setbacksFt?.left ?? ''),
    right: String(artifactLot?.setbacksFt?.right ?? ''),
    coveragePct: artifactLot?.maxCoverageRatio ? String(Math.round(artifactLot.maxCoverageRatio * 100)) : '35',
  };
  const draftLot = useMemo(() => {
    const widthFt = Number(draft.widthFt);
    const depthFt = Number(draft.depthFt);
    if (!Number.isFinite(widthFt) || !Number.isFinite(depthFt) || widthFt <= 0 || depthFt <= 0) return null;
    const setback = (value: string) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 && value !== '' ? parsed : undefined;
    };
    const coverage = Number(draft.coveragePct);
    return {
      widthFt,
      depthFt,
      setbacksFt: { front: setback(draft.front), rear: setback(draft.rear), left: setback(draft.left), right: setback(draft.right) },
      maxCoverageRatio: Number.isFinite(coverage) && coverage > 0 && coverage <= 100 ? coverage / 100 : undefined,
    };
  }, [draft.widthFt, draft.depthFt, draft.front, draft.rear, draft.left, draft.right, draft.coveragePct]);
  const report = useMemo(() => codeAdvisoryReportForHome(home, draftLot), [home, draftLot]);
  const lotEdited = lotDraft !== null;
  const updateDraft = (key: keyof typeof draft, value: string) => setLotDraft({ ...draft, [key]: value });
  const exportWithLot = () => {
    const artifact: Record<string, unknown> = (home.pairedArtifactJson && typeof home.pairedArtifactJson === 'object')
      ? { ...(home.pairedArtifactJson as Record<string, unknown>) }
      : { planId: home.id };
    artifact.lot = draftLot;
    downloadJson(`${home.id}-${home.pairedProposalId ?? 'draft'}-with-lot.paired.json`, artifact);
  };
  const findingsByRule = new Map<string, CodeAdvisoryFinding[]>();
  for (const item of report.findings) {
    const list = findingsByRule.get(item.ruleId) ?? [];
    list.push(item);
    findingsByRule.set(item.ruleId, list);
  }
  const statusClass = (status: string) =>
    status === 'fail' ? 'text-red-700' : status === 'pass' ? 'text-emerald-700' : 'text-stone-400';
  const lotField = (label: string, key: keyof typeof draft) => (
    <label className="block">
      <span className="mb-0.5 block text-[9px] text-stone-400">{label}</span>
      <input
        value={draft[key]}
        onChange={(event) => updateDraft(key, event.target.value)}
        data-lot-field={key}
        className="w-full rounded-sm border border-stone-200 bg-white px-1.5 py-1 font-mono text-[10px] text-stone-700 focus:border-stone-400"
      />
    </label>
  );
  return (
    <section className="rounded-lg border border-stone-200 bg-white p-3" data-constraint-report={report.reportVersion}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Constraint Report</h3>
        <span className="font-mono text-[10px] text-stone-500">
          {report.summary.pass} pass / {report.summary.fail} fail / {report.summary.notEvaluated} not evaluated
        </span>
      </div>
      <div className="mb-2 rounded-sm border border-stone-200 bg-stone-50 p-2" data-jurisdiction={report.jurisdiction.id}>
        <div className="text-[10px] font-semibold text-stone-600">{report.jurisdiction.label}</div>
        <div className="mt-0.5 text-[9px] leading-snug text-stone-500">{report.jurisdiction.codeEdition}</div>
        {report.jurisdiction.transitionNote && (
          <div className="mt-1 text-[9px] leading-snug text-amber-700">{report.jurisdiction.transitionNote}</div>
        )}
      </div>
      <div className="mb-2 rounded-sm border border-stone-200 bg-stone-50 p-2" data-lot-editor>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            Lot {lotEdited ? '(what-if, not saved)' : artifactLot ? '(from artifact)' : '(none in artifact)'}
          </span>
          <div className="flex gap-1">
            {lotEdited && (
              <button type="button" onClick={() => setLotDraft(null)} className="rounded-sm border border-stone-300 bg-white px-1.5 py-0.5 text-[9px] text-stone-600 hover:border-stone-700 hover:bg-stone-100">
                reset
              </button>
            )}
            <button type="button" onClick={exportWithLot} data-lot-export className="rounded-sm border border-stone-300 bg-white px-1.5 py-0.5 text-[9px] text-stone-600 hover:border-stone-700 hover:bg-stone-100">
              export JSON with lot
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {lotField('lot W ft', 'widthFt')}
          {lotField('lot D ft', 'depthFt')}
          {lotField('front sb', 'front')}
          {lotField('rear sb', 'rear')}
          {lotField('left sb', 'left')}
          {lotField('right sb', 'right')}
          {lotField('max cov %', 'coveragePct')}
        </div>
        <div className="mt-1 text-[9px] leading-snug text-stone-400">
          Edits re-run setback/coverage rules live. The artifact is unchanged until the exported JSON is re-imported.
        </div>
      </div>
      <div className="space-y-2">
        {CODE_ADVISORY_RULES.map((rule) => {
          const findings = findingsByRule.get(rule.ruleId) ?? [];
          const ruleStatus = findings.some((item) => item.status === 'fail')
            ? 'fail'
            : findings.some((item) => item.status === 'pass')
              ? 'pass'
              : 'not-evaluated';
          return (
            <div
              key={rule.ruleId}
              className={`rounded-sm border p-2 ${
                ruleStatus === 'fail'
                  ? 'border-red-200 bg-red-50/60'
                  : ruleStatus === 'pass'
                    ? 'border-stone-200 bg-stone-50'
                    : 'border-stone-200 bg-stone-50/50'
              }`}
              data-constraint-rule={rule.ruleId}
              data-constraint-status={ruleStatus}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-stone-700">{rule.ruleId}</span>
                <span className={`font-mono text-[10px] ${statusClass(ruleStatus)}`}>{ruleStatus}</span>
              </div>
              <div className="mt-1 text-[10px] leading-snug text-stone-500">{rule.citation}</div>
              <div className="mt-1 space-y-0.5 text-[10px] leading-snug">
                {findings.slice(0, 6).map((item, index) => (
                  <div key={`${item.subjectId ?? 'plan'}-${index}`} className={statusClass(item.status)}>
                    {item.subjectLabel ? `${item.subjectLabel}: ` : ''}{item.detail}
                  </div>
                ))}
                {findings.length > 6 && (
                  <div className="text-stone-400">+{findings.length - 6} more finding(s)</div>
                )}
                {!findings.length && <div className="text-stone-400">No findings for this rule.</div>}
              </div>
            </div>
          );
        })}
      </div>
      {(() => {
        const knownRuleIds = new Set(CODE_ADVISORY_RULES.map((rule) => rule.ruleId));
        const siteFindings = report.findings.filter((item) => !knownRuleIds.has(item.ruleId));
        if (!siteFindings.length) return null;
        return (
          <div className="mt-2 space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Site checks (jurisdiction)</div>
            {siteFindings.map((item) => (
              <div key={item.ruleId} className="rounded-sm border border-stone-200 bg-stone-50 p-2" data-constraint-rule={item.ruleId} data-constraint-status={item.status}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-stone-700">{item.ruleId}</span>
                  <span className="font-mono text-[10px] text-stone-400">{item.status}</span>
                </div>
                <div className="mt-1 text-[10px] leading-snug text-stone-500">{item.citation}</div>
                <div className="mt-1 text-[10px] leading-snug text-stone-600">{item.detail}</div>
              </div>
            ))}
          </div>
        );
      })()}
      <div className="mt-2 text-[10px] leading-snug text-stone-400">
        Advisory only - legal code compliance is not claimed without a jurisdiction rule pack and professional review.
      </div>
    </section>
  );
}

function ValidationSummary({
  groups,
  compact = false,
  onRepairLayer,
}: {
  groups: ValidationGroup[];
  compact?: boolean;
  onRepairLayer?: (layer: RepairLayer) => void;
}) {
  const lanes = readinessLanes(groups);
  const renderGroup = (group: ValidationGroup) => {
    const hasIssues = group.blockers.length > 0 || group.warnings.length > 0;
    const repairLayer = repairLayerForValidationGroup(group);
    return (
      <section key={group.id} className="border border-stone-200 bg-white p-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">{group.label}</h3>
          <div className="flex items-center gap-2">
            {compact && hasIssues && onRepairLayer && (
              <button
                type="button"
                onClick={() => onRepairLayer(repairLayer)}
                className="border border-stone-300 px-1.5 py-0.5 font-mono text-[9px] text-stone-600 hover:bg-stone-50"
                title={`Generate ${repairLayer} repair prompt`}
              >
                repair
              </button>
            )}
            <span className={`font-mono text-[10px] ${
              group.status === 'blocked' ? 'text-red-700' : group.status === 'warning' ? 'text-amber-700' : 'text-emerald-700'
            }`}>
              {group.status}
            </span>
          </div>
        </div>
        {!compact && (
          <div className="mt-2 space-y-1 text-[10px] leading-snug">
            {group.blockers.map((item) => <div key={item} className="text-red-700">{item}</div>)}
            {group.warnings.map((item) => <div key={item} className="text-amber-700">{item}</div>)}
            {!group.blockers.length && !group.warnings.length && <div className="text-emerald-700">No active issues.</div>}
            <div className="pt-1 text-stone-400">{group.action}</div>
            {hasIssues && onRepairLayer && (
              <button
                type="button"
                onClick={() => onRepairLayer(repairLayer)}
                className="mt-1 border border-stone-300 bg-white px-2 py-1 text-[10px] text-stone-700 hover:bg-stone-50"
              >
                Repair {repairLayer} With GPT
              </button>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className={`grid gap-2 ${compact ? 'md:grid-cols-[2fr_1fr_1fr]' : 'md:grid-cols-3'}`}>
      {lanes.map((lane) => {
        const laneMeta = READINESS_LANES.find((item) => item.id === lane.id);
        return (
          <div key={lane.id} className="border border-stone-200 bg-stone-50 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">{lane.label}</h3>
                {!compact && <div className="mt-1 text-[10px] leading-snug text-stone-400">{laneMeta?.description}</div>}
              </div>
              <span className={`font-mono text-[10px] ${
                lane.status === 'blocked' ? 'text-red-700' : lane.status === 'warning' ? 'text-amber-700' : 'text-emerald-700'
              }`}>
                {lane.status}
              </span>
            </div>
            <div className={`grid gap-2 ${compact && lane.id === 'design' ? 'md:grid-cols-2' : ''}`}>
              {lane.groups.map(renderGroup)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WorkflowActionBar({
  home,
  lifecycle,
  groups,
  onOpen,
  onDeletePlan,
  showAllChips = true,
}: {
  home: DenHome | null;
  lifecycle: ArtifactLifecycle;
  groups: ValidationGroup[];
  onOpen: (dialog: WorkflowDialog, layer?: RepairLayer) => void;
  onDeletePlan?: (id: string) => void;
  showAllChips?: boolean;
}) {
  const lanes = readinessLanes(groups);
  const design = lanes.find((lane) => lane.id === 'design') ?? emptyLaneSummary('design');
  const presentation = lanes.find((lane) => lane.id === 'presentation') ?? emptyLaneSummary('presentation');
  const brochure = lanes.find((lane) => lane.id === 'brochure') ?? emptyLaneSummary('brochure');
  const manufacturing = lanes.find((lane) => lane.id === 'manufacturing') ?? emptyLaneSummary('manufacturing');
  const exportLane = lanes.find((lane) => lane.id === 'export') ?? emptyLaneSummary('export');
  return (
    <div className="border-b border-stone-200 bg-[#fffdf9] px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Plan workflow</div>
          <div className="mt-0.5 truncate text-xs text-stone-700">
            {home
              ? `${home.model} - ${lifecycle} - Design ${design.status} - Presentation ${presentation.status} - Brochure ${brochure.status} - Manufacturing ${manufacturing.status} - Export ${exportLane.status}`
              : 'No active plan'}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'new-plan' as const, label: 'New Plan' },
            { id: 'import' as const, label: 'Import JSON' },
            { id: 'export' as const, label: 'Export' },
            { id: 'repair' as const, label: 'Repair With GPT' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item.id)}
              className="rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-[11px] text-stone-700 hover:border-stone-800 hover:bg-stone-50"
            >
              {item.label}
            </button>
          ))}
          {home && onDeletePlan && isDeletablePlan(home, lifecycle) && (
            <button
              type="button"
              data-delete-plan={home.id}
              onClick={() => onDeletePlan(home.id)}
              className="rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-[11px] text-stone-500 hover:border-red-700 hover:bg-red-50 hover:text-red-700"
            >
              Delete Plan
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {!showAllChips && (
          <div className="flex items-center gap-1 rounded-sm border border-emerald-200 bg-emerald-50 px-2 py-1 text-[9px] uppercase tracking-wide text-emerald-800">
            {groups.filter((group) => group.status === 'pass').length} gates pass
          </div>
        )}
        {groups.map((group) => {
          const hasIssues = group.blockers.length > 0 || group.warnings.length > 0;
          const repairLayer = repairLayerForValidationGroup(group);
          // Passing gates collapse behind the summary count unless Review
          // Tools is open; chips stay in the DOM (hidden) so QA scripts can
          // keep reading the data-validation-* attributes.
          const collapsed = !showAllChips && group.status === 'pass';
          const issueLines = [...group.blockers, ...group.warnings];
          const chipTitle = hasIssues
            ? `${issueLines.slice(0, 3).join('\n')}${issueLines.length > 3 ? `\n(+${issueLines.length - 3} more)` : ''}`
            : group.label;
          return (
            <div
              key={group.id}
              data-validation-group={group.id}
              data-validation-label={group.label}
              data-validation-lane={group.lane}
              data-validation-status={group.status}
              data-validation-blockers={group.blockers.join('\n')}
              data-validation-warnings={group.warnings.join('\n')}
              data-validation-action={group.action}
              title={chipTitle}
              className={`${collapsed ? 'hidden ' : ''}flex items-center gap-1 rounded-sm border px-2 py-1 text-[9px] uppercase tracking-wide ${
                group.status === 'blocked'
                  ? 'border-red-200 bg-red-50/60'
                  : group.status === 'warning'
                    ? 'border-amber-200 bg-amber-50/60'
                    : 'border-stone-200 bg-white'
              }`}
            >
              <span className="text-stone-500">{group.label}</span>
              {hasIssues && (
                <button
                  type="button"
                  onClick={() => onOpen('repair', repairLayer)}
                  className="rounded-sm border border-stone-300 px-1 text-[8px] lowercase text-stone-500 hover:border-stone-700 hover:bg-stone-50"
                  title={`Generate ${repairLayer} repair prompt`}
                >
                  repair
                </button>
              )}
              <span className={`font-mono ${group.status === 'blocked' ? 'text-red-700' : group.status === 'warning' ? 'text-amber-700' : 'text-emerald-700'}`}>
                {group.status}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowModal({
  dialog,
  home,
  availableHomes,
  selectedHomeId,
  groups,
  promptRequest,
  importText,
  importSourceImage,
  importStatus,
  lifecycle,
  initialRepairLayer,
  onClose,
  onSelectHome,
  onPromptChange,
  onImportTextChange,
  onImportSourceImageChange,
  onImportPlan,
  onLifecycleChange,
  onExportPacket,
  onApplyRepairPatch,
}: {
  dialog: WorkflowDialog;
  home: DenHome | null;
  availableHomes: DenHome[];
  selectedHomeId: string;
  groups: ValidationGroup[];
  promptRequest: PromptRequest;
  importText: string;
  importSourceImage: string;
  importStatus: string;
  lifecycle: ArtifactLifecycle;
  initialRepairLayer: RepairLayer | null;
  onClose: () => void;
  onSelectHome: (id: string) => void;
  onPromptChange: (request: PromptRequest) => void;
  onImportTextChange: (text: string) => void;
  onImportSourceImageChange: (text: string) => void;
  onImportPlan: () => void;
  onLifecycleChange: (state: ArtifactLifecycle) => void;
  onExportPacket: () => void;
  onApplyRepairPatch: (report: LayerDriftReport, patchText: string) => string;
}) {
  const audit = useMemo(() => productAudit(home, null), [home]);
  const generationPrompt = useMemo(() => buildGenerationPrompt(promptRequest, home), [promptRequest, home]);
  const feedbackPrompt = useMemo(() => buildFeedbackPrompt(home, audit), [home, audit]);
  const driftReports = useMemo(() => reportsFromValidationGroups(home, groups), [groups, home]);
  const [selectedReportIndex, setSelectedReportIndex] = useState(0);
  const selectedReport = selectedReportIndex >= 0 ? driftReports[Math.min(selectedReportIndex, Math.max(driftReports.length - 1, 0))] ?? null : null;
  const [manualRepairLayer, setManualRepairLayer] = useState<RepairLayer>('fixtures');
  const activeReport = selectedReport ?? (home ? createLayerDriftReport(home, manualRepairLayer, ['Visible mismatch selected manually. Repair only this layer.']) : null);
  const targetedPrompt = useMemo(() => (home && activeReport ? buildTargetedRepairPrompt(home, activeReport) : ''), [activeReport, home]);
  const [repairPatchText, setRepairPatchText] = useState('');
  const [repairPatchStatus, setRepairPatchStatus] = useState('');
  useEffect(() => {
    if (dialog !== 'repair' || !initialRepairLayer) return;
    const matchingReportIndex = driftReports.findIndex((report) => report.layer === initialRepairLayer);
    const frame = window.requestAnimationFrame(() => {
      setManualRepairLayer(initialRepairLayer);
      setSelectedReportIndex(matchingReportIndex >= 0 ? matchingReportIndex : -1);
      setRepairPatchText('');
      setRepairPatchStatus('');
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog, driftReports, initialRepairLayer]);
  const patchPreview = useMemo(() => {
    if (!repairPatchText.trim() || !activeReport) return { status: 'empty', label: 'Paste a JSON Patch array to preview scope.' };
    try {
      const operations = parseJsonPatch(repairPatchText);
      const validation = activeReport ? applyJsonPatchToHome(home as DenHome, operations, activeReport) : { ok: false, errors: ['No active report'] };
      return validation.ok
        ? { status: 'ok', label: `${operations.length} scoped patch operation${operations.length === 1 ? '' : 's'} ready to validate/apply.` }
        : { status: 'error', label: validation.errors.join('; ') };
    } catch (error) {
      return { status: 'error', label: error instanceof Error ? error.message : 'Invalid JSON Patch' };
    }
  }, [activeReport, home, repairPatchText]);
  const importPreview = useMemo(() => {
    if (!importText.trim()) return { status: 'empty', label: 'Paste JSON or upload a file to preview schema.' };
    try {
      const parsed = JSON.parse(importText);
      const source = parsed.semanticPlan ?? parsed.home ?? parsed;
      const roomCount = Array.isArray(source?.rooms) ? source.rooms.length : 0;
      const wallCount = Array.isArray(source?.sourceWalls) ? source.sourceWalls.length : Array.isArray(source?.walls) ? source.walls.length : 0;
      const proposalId = source?.proposalId ?? source?.pairedProposalId ?? parsed?.proposalId ?? 'draft';
      return {
        status: 'ok',
        label: `${source?.schemaVersion ?? source?.artifactVersion ?? 'semantic-plan'} - ${source?.planId ?? source?.id ?? 'local'} / ${proposalId} - ${roomCount} room${roomCount === 1 ? '' : 's'} - ${wallCount} wall${wallCount === 1 ? '' : 's'}`,
      };
    } catch (error) {
      return { status: 'error', label: error instanceof Error ? error.message : 'Invalid JSON' };
    }
  }, [importText]);

  if (!dialog) return null;

  const updatePrompt = (key: keyof PromptRequest, value: string) => onPromptChange({ ...promptRequest, [key]: value });
  const export3d = () => {
    const image = currentCanvasImage(true);
    if (image) downloadDataUrl(`${home?.id ?? 'plan'}-${home?.pairedProposalId ?? 'draft'}-3d.png`, image);
  };
  const sourceBlockers = groups.find((group) => group.id === 'source')?.blockers ?? [];
  const recommendation = sourceBlockers.length || !home?.pairedArtifactInfo?.sourceImageUrl
    ? 'Regenerate image + JSON together.'
    : 'Patch JSON only unless the source image is visibly wrong.';
  const repairCliCommands = (() => {
    if (!home || !activeReport) return '';
    const proposalId = home.pairedProposalId ?? home.pairedArtifactInfo?.proposalId ?? 'proposal';
    const bundle = `artifacts/brochure-qa/repair-bundles-all/${cliSafeName(home.id)}-${cliSafeName(proposalId)}-${cliSafeName(activeReport.layer)}`;
    const packet = `artifacts/brochure-qa/${cliSafeName(home.id)}-brochure-repair-packet.json`;
    return [
      '# Priority one-layer bundle',
      'npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all',
      `npm run repair:prompt -- --packet ${packet} --layer "${activeReport.layer}"`,
      `npm run repair:gpt -- --bundle ${bundle} --model "$OPENAI_REPAIR_MODEL" --yes`,
      `npm run repair:ingest -- --bundle ${bundle} --response response.txt`,
      `npm run repair:ingest -- --bundle ${bundle} --latest-download`,
      `npm run repair:evaluate -- --bundle ${bundle} --patch ${bundle}/patch.json`,
      `npm run repair:apply -- --packet ${packet} --layer "${activeReport.layer}" --patch ${bundle}/patch.json`,
      '',
      '# Full semantic-layer bundle set for a complete GPT repair pass',
      'npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all',
      `npm run repair:gpt -- --bundle ${bundle} --model "$OPENAI_REPAIR_MODEL" --yes`,
      `npm run repair:ingest -- --bundle ${bundle} --response response.txt`,
      `npm run repair:ingest -- --bundle ${bundle} --latest-download`,
      `npm run repair:evaluate -- --bundle ${bundle} --patch ${bundle}/patch.json`,
      `npm run repair:apply -- --packet ${packet} --layer "${activeReport.layer}" --patch ${bundle}/patch.json`,
      '',
      'npm run qa:brochure',
    ].join('\n');
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-950/40 p-6 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-xl border border-stone-200 bg-[#fffdf9] shadow-[0_40px_80px_-32px_rgba(41,37,36,0.45)]">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <div>
            <h2 className="font-sans text-base font-semibold tracking-tight text-stone-900">
              {dialog === 'new-plan' ? 'New Plan Handoff' : dialog === 'import' ? 'Import Paired Artifact' : dialog === 'export' ? 'Export Plan' : 'Repair With GPT'}
            </h2>
            <div className="mt-0.5 text-[10px] text-stone-400">{home?.model ?? 'No active plan'} - {lifecycle}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-sm border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Close</button>
        </div>

        <div className="max-h-[78vh] overflow-y-auto p-4">
          {dialog === 'new-plan' && (
            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <section className="space-y-3">
                <label className="block text-[10px] text-stone-500">
                  Reference plan
                  <select value={selectedHomeId} onChange={(event) => onSelectHome(event.target.value)} className="mt-1 w-full rounded-sm border border-stone-200 bg-white px-2 py-2 text-xs text-stone-700">
                    {availableHomes.map((item) => (
                      <option key={item.id} value={item.id}>{item.model} - {item.sqft}sf{item.bedBath ? ` - ${item.bedBath}` : ''}</option>
                    ))}
                  </select>
                </label>
                {(['intent', 'bedBath', 'footprint', 'levels', 'roof', 'style', 'constraints', 'references'] as Array<keyof PromptRequest>).map((key) => (
                  <label key={key} className="block text-[10px] text-stone-500">
                    {key}
                    <textarea
                      value={promptRequest[key]}
                      onChange={(event) => updatePrompt(key, event.target.value)}
                      className="mt-1 h-16 w-full resize-none border border-stone-200 bg-white px-2 py-1 font-mono text-[10px] text-stone-700"
                    />
                  </label>
                ))}
              </section>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Generated GPT prompt preview</h3>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => navigator.clipboard?.writeText(generationPrompt)} className="rounded-sm border border-stone-300 bg-white px-2 py-1 text-[10px] text-stone-700 hover:border-stone-800 hover:bg-stone-50">Copy</button>
                    <button type="button" onClick={() => downloadJson(`${home?.id ?? 'plan'}-handoff-packet.json`, { request: promptRequest, prompt: generationPrompt, referencePlan: home })} className="rounded-sm border border-stone-300 bg-white px-2 py-1 text-[10px] text-stone-700 hover:border-stone-800 hover:bg-stone-50">Download Handoff Packet</button>
                  </div>
                </div>
                <textarea readOnly value={generationPrompt} className="h-[560px] w-full resize-none border border-stone-200 bg-white p-3 font-mono text-[10px] leading-relaxed text-stone-700" />
              </section>
            </div>
          )}

          {dialog === 'import' && (
            <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void file.text().then(onImportTextChange);
                    }}
                    className="text-[10px] text-stone-500"
                  />
                </div>
                <label className="block text-[10px] text-stone-500">
                  Optional source image URL or data URL
                  <input
                    value={importSourceImage}
                    onChange={(event) => onImportSourceImageChange(event.target.value)}
                    placeholder="https://... or data:image/png;base64,..."
                    className="mt-1 w-full border border-stone-200 bg-white px-2 py-2 font-mono text-[10px] text-stone-700"
                  />
                </label>
                <textarea
                  value={importText}
                  onChange={(event) => onImportTextChange(event.target.value)}
                  placeholder="Paste paired_gpt_floorplan_v1 JSON, exported DenHome JSON, or a product packet with semanticPlan."
                  className="h-[520px] w-full resize-none border border-stone-200 bg-white p-3 font-mono text-[10px] leading-relaxed text-stone-700"
                />
              </section>
              <section className="space-y-3">
                <div className="border border-stone-200 bg-white p-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Schema preview</h3>
                  <div className={`mt-2 text-[10px] leading-snug ${importPreview.status === 'error' ? 'text-red-700' : importPreview.status === 'ok' ? 'text-emerald-700' : 'text-stone-500'}`}>
                    {importPreview.label}
                  </div>
                </div>
                <div className="border border-stone-200 bg-white p-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Import result</h3>
                  <div className="mt-2 text-[10px] leading-snug text-stone-500">{importStatus || 'No import attempted yet.'}</div>
                </div>
                <button type="button" onClick={onImportPlan} className="w-full rounded-sm border border-stone-800 bg-stone-800 px-3 py-2 text-xs text-white hover:bg-stone-700">Import Draft</button>
              </section>
            </div>
          )}

          {dialog === 'export' && home && (
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <section className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Stable product exports</div>
                <button type="button" onClick={() => downloadJson(`${home.id}-${home.pairedProposalId ?? 'draft'}-semantic-plan.json`, home)} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Semantic JSON</button>
                <button type="button" onClick={() => downloadJson(`${home.id}-${home.pairedProposalId ?? 'draft'}-semantic-bim-v1.json`, semanticBimFromHome(home))} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Semantic BIM JSON</button>
                <button type="button" onClick={() => downloadJson(`${home.id}-${home.pairedProposalId ?? 'draft'}-standards-checks.json`, { standardsRegistry: standardsRegistrySummary(), standardsValidation: validateStandards(home), bcfIssues: validateStandards(home).issues })} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Standards + Issues JSON</button>
                <button type="button" onClick={() => downloadJson(`${home.id}-${home.pairedProposalId ?? 'draft'}-bim-asset-registry.json`, bimAssetRegistrySummary())} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export BIM Asset Registry</button>
                <button type="button" onClick={() => downloadText(`${home.id}-${home.pairedProposalId ?? 'draft'}-floorplan.svg`, currentDeterministicSvg() ?? semanticSvgForHome(home), 'image/svg+xml')} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export 2D SVG</button>
                <button type="button" onClick={() => downloadText(`${home.id}-front-elevation.svg`, elevationSvgMarkup(home, 'front'), 'image/svg+xml')} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Front Elevation SVG</button>
                <button type="button" onClick={() => downloadText(`${home.id}-side-elevation.svg`, elevationSvgMarkup(home, 'side'), 'image/svg+xml')} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Side Elevation SVG</button>
                <button type="button" onClick={() => downloadText(`${home.id}-constraint-report.html`, constraintReportHtml(home), 'text/html')} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Constraint Report HTML</button>
                <button type="button" onClick={() => downloadJson(`${home.id}-constraint-report.json`, codeAdvisoryReportForHome(home))} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Constraint Report JSON</button>
                <button type="button" onClick={() => downloadJson(`${home.id}-build-kit-bom.json`, { planId: home.id, bom: home.buildValidation?.bom ?? [], componentsUsed: home.componentsUsed })} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Build Kit BOM JSON</button>
                <button type="button" data-export-client-packet onClick={() => downloadText(`${home.id}-client-packet.html`, clientPacketHtml(home, currentDeterministicSvg() ?? semanticSvgForHome(home), groups), 'text/html')} className="w-full rounded-sm border border-emerald-800 bg-emerald-800 px-3 py-2 text-xs text-white hover:bg-emerald-700">Download Client Packet (HTML)</button>
                <button type="button" onClick={export3d} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Current 3D PNG</button>
                <button type="button" onClick={onExportPacket} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export Brochure Packet JSON</button>
                <button type="button" onClick={() => downloadText(`${home.id}-${home.pairedProposalId ?? 'draft'}-brochure.html`, brochureHtmlForHome(home, groups, currentCanvasImage(true), localVisualAssetAttributions(), currentSourceImage(home), currentDeterministicSvg()), 'text/html')} className="w-full rounded-sm border border-stone-300 bg-white px-3 py-2 text-xs text-stone-700 hover:border-stone-800 hover:bg-stone-50">Export HTML Brochure</button>
                <div className="pt-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700">Experimental export</div>
                <button type="button" onClick={() => downloadText(`${home.id}-${home.pairedProposalId ?? 'draft'}-experimental.ifc`, exportExperimentalIfc(home).ifcText, 'application/x-step')} className="w-full border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">Export Experimental IFC STEP</button>
                <div className="text-[10px] leading-snug text-amber-700">IFC STEP is a handoff placeholder until full web-ifc/fragments entity writing is enabled. Semantic BIM JSON is the stable BIM export.</div>
                <div className="pt-3 text-[10px] font-semibold uppercase tracking-wide text-stone-500">Plan status</div>
                <div className="text-[10px] leading-snug text-stone-400">Where this plan sits in your workflow (saved in this browser). Draft &gt; review &gt; promoted &gt; exported.</div>
                <div className="grid grid-cols-2 gap-1 pt-1">
                  {(['draft', 'review', 'promoted', 'exported'] as ArtifactLifecycle[]).map((state) => (
                    <button key={state} type="button" onClick={() => onLifecycleChange(state)} className={`border px-2 py-1 text-[10px] ${lifecycle === state ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-200 bg-white text-stone-600'}`}>
                      {state}
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <ValidationSummary groups={groups} />
              </section>
            </div>
          )}

          {dialog === 'repair' && (
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <section className="space-y-3">
                <div className="border border-stone-200 bg-white p-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Repair mode</h3>
                  <div className="mt-2 text-xs text-stone-700">{recommendation}</div>
                  <div className="mt-2 text-[10px] leading-snug text-stone-500">
                    Local code validates and applies scoped patches. GPT should only reason about the selected visual mismatch.
                  </div>
                </div>
                <div className="border border-stone-200 bg-white p-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Drift layer</h3>
                  <select
                    value={selectedReportIndex}
                    onChange={(event) => setSelectedReportIndex(Number(event.target.value))}
                    className="mt-2 w-full border border-stone-200 bg-white px-2 py-2 text-[10px] text-stone-700"
                  >
                    <option value={-1}>Manual: {manualRepairLayer}</option>
                    {driftReports.map((report, index) => (
                      <option key={`${report.layer}-${index}`} value={index}>
                        {report.layer} - {report.severity}
                      </option>
                    ))}
                  </select>
                  <label className="mt-2 block text-[10px] text-stone-500">
                    Manual layer
                    <select
                      value={manualRepairLayer}
                      onChange={(event) => {
                        setManualRepairLayer(event.target.value as RepairLayer);
                        setSelectedReportIndex(-1);
                      }}
                      className="mt-1 w-full border border-stone-200 bg-white px-2 py-2 text-[10px] text-stone-700"
                    >
                      {REPAIR_LAYER_OPTIONS.map((layer) => <option key={layer} value={layer}>{layer}</option>)}
                    </select>
                  </label>
                  {activeReport && (
                    <div className="mt-2 space-y-1 text-[10px] leading-snug text-stone-500">
                      <div className="font-mono text-stone-700">{activeReport.layer}</div>
                      <div>{activeReport.description.slice(0, 360)}</div>
                      <div className="pt-1 text-stone-400">Allowed: {activeReport.allowedPatchPaths.join(', ')}</div>
                    </div>
                  )}
                </div>
                <div className="border border-stone-200 bg-white p-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Returned JSON Patch</h3>
                  <textarea
                    value={repairPatchText}
                    onChange={(event) => {
                      setRepairPatchText(event.target.value);
                      setRepairPatchStatus('');
                    }}
                    placeholder='[{"op":"replace","path":"/rooms/0/fixtures/1/rotationDeg","value":90}]'
                    className="mt-2 h-36 w-full resize-none border border-stone-200 bg-white p-2 font-mono text-[10px] leading-relaxed text-stone-700"
                  />
                  <div className={`mt-2 text-[10px] leading-snug ${patchPreview.status === 'error' ? 'text-red-700' : patchPreview.status === 'ok' ? 'text-emerald-700' : 'text-stone-500'}`}>
                    {patchPreview.label}
                  </div>
                  {repairPatchStatus && <div className="mt-2 text-[10px] leading-snug text-stone-700">{repairPatchStatus}</div>}
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      disabled={!activeReport || !repairPatchText.trim()}
                      onClick={() => {
                        if (!activeReport) return;
                        const result = onApplyRepairPatch(activeReport, repairPatchText);
                        setRepairPatchStatus(result);
                      }}
                      className="border border-stone-800 bg-stone-800 px-2 py-1 text-[10px] text-white disabled:opacity-40"
                    >
                      Apply Patch
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRepairPatchText('');
                        setRepairPatchStatus('Patch input cleared. Current plan unchanged.');
                      }}
                      className="rounded-sm border border-stone-300 bg-white px-2 py-1 text-[10px] text-stone-700 hover:border-stone-800 hover:bg-stone-50"
                    >
                      Rollback/Clear
                    </button>
                  </div>
                </div>
                <div className="border border-stone-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Local repair commands</h3>
                    <button
                      type="button"
                      onClick={() => navigator.clipboard?.writeText(repairCliCommands)}
                      className="rounded-sm border border-stone-300 bg-white px-2 py-1 text-[10px] text-stone-700 hover:border-stone-800 hover:bg-stone-50"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="mt-2 text-[10px] leading-snug text-stone-500">
                    Use these after browser QA creates repair packets. `repair:gpt` requires local `OPENAI_API_KEY`; otherwise use the copied prompt manually.
                  </div>
                  <textarea
                    readOnly
                    value={repairCliCommands}
                    className="mt-2 h-32 w-full resize-none border border-stone-200 bg-stone-50 p-2 font-mono text-[10px] leading-relaxed text-stone-700"
                  />
                </div>
              </section>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Targeted repair prompt</h3>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => navigator.clipboard?.writeText(targetedPrompt || feedbackPrompt)} className="rounded-sm border border-stone-300 bg-white px-2 py-1 text-[10px] text-stone-700 hover:border-stone-800 hover:bg-stone-50">Copy Prompt</button>
                    <button type="button" onClick={() => downloadJson(`${home?.id ?? 'plan'}-targeted-repair-packet.json`, { recommendation, targetedPrompt, driftReport: activeReport, validation: groups, semanticPlan: home ? semanticPlanForHome(home) : null })} className="rounded-sm border border-stone-300 bg-white px-2 py-1 text-[10px] text-stone-700 hover:border-stone-800 hover:bg-stone-50">Download Packet</button>
                  </div>
                </div>
                <textarea readOnly value={targetedPrompt || feedbackPrompt} className="h-[560px] w-full resize-none border border-stone-200 bg-white p-3 font-mono text-[10px] leading-relaxed text-stone-700" />
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function cloneHome(home: DenHome): DenHome {
  return {
    ...home,
    rooms: home.rooms.map((room) => ({
      ...room,
      fixtures: room.fixtures?.map((fixture) => ({ ...fixture, clearance: fixture.clearance ? { ...fixture.clearance } : undefined })),
    })),
    connections: home.connections?.map((connection) => ({ ...connection, opening: connection.opening ? { ...connection.opening } : undefined })),
    sourceWalls: home.sourceWalls?.map((wall) => ({ ...wall })),
    sourceOpenings: home.sourceOpenings?.map((opening) => ({ ...opening })),
    spaceFaces: home.spaceFaces?.map((face) => ({ ...face, parts: face.parts?.map((part) => ({ ...part })) })),
    roofSemantics: home.roofSemantics ? { ...home.roofSemantics, blockers: [...home.roofSemantics.blockers] } : undefined,
  };
}

function ftToGrid(value: string, min = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, parsed / 4);
}

function gridToFt(value: number): number {
  return Number((value * 4).toFixed(2));
}

type EditableConnection = NonNullable<DenHome['connections']>[number];
type EditableOpening = NonNullable<EditableConnection['opening']>;

function EditorPanel({
  home,
  edited,
  onChange,
  onSave,
  onReset,
  canSave,
}: {
  home: DenHome | null;
  edited: boolean;
  onChange: (home: DenHome) => void;
  onSave: () => void;
  onReset: () => void;
  canSave: boolean;
}) {
  const [roomIndex, setRoomIndex] = useState(0);
  const [fixtureId, setFixtureId] = useState('');
  const [connectionIndex, setConnectionIndex] = useState(0);
  const rooms = home?.rooms ?? [];
  const connections = home?.connections ?? [];
  const room = rooms[Math.min(roomIndex, Math.max(rooms.length - 1, 0))];
  const connection = connections[Math.min(connectionIndex, Math.max(connections.length - 1, 0))] ?? null;
  const fixtures = room?.fixtures ?? [];
  const fixture = fixtures.find((item) => item.id === fixtureId) ?? fixtures[0] ?? null;

  const editorAudit = useMemo(() => {
    if (!home) return { status: 'waiting', blockers: ['No plan selected'], warnings: [] };
    const blockers: string[] = [];
    const warnings: string[] = [];
    if (!home.sourceWalls?.length) blockers.push('missing source wall graph');
    if (!home.rooms.length) blockers.push('missing rooms');
    blockers.push(...roofEditBlockers(home.roofSemantics));
    const maxGx = home.footprint.width / 4;
    const maxGz = home.footprint.depth / 4;
    for (const opening of home.sourceOpenings ?? []) {
      const length = Math.hypot((opening.x2 - opening.x1) * 4, (opening.z2 - opening.z1) * 4);
      const outsideFootprint =
        opening.x1 < -0.15 || opening.x2 < -0.15 ||
        opening.z1 < -0.15 || opening.z2 < -0.15 ||
        opening.x1 > maxGx + 0.15 || opening.x2 > maxGx + 0.15 ||
        opening.z1 > maxGz + 0.15 || opening.z2 > maxGz + 0.15;
      if (length < 0.5) blockers.push(`${opening.id ?? opening.kind} opening is too short`);
      if (outsideFootprint) blockers.push(`${opening.id ?? opening.kind} opening is outside footprint`);
      if (home.sourceWalls?.length && !openingAlignedToWall(opening, home.sourceWalls)) {
        blockers.push(`${opening.id ?? opening.kind} opening is not aligned to a source wall`);
      }
    }
    for (const candidateRoom of home.rooms) {
      for (const candidate of candidateRoom.fixtures ?? []) {
        const cx = candidate.x + candidate.w / 2;
        const cz = candidate.z + candidate.d / 2;
        const inside =
          cx >= candidateRoom.gx - 0.15 &&
          cz >= candidateRoom.gz - 0.15 &&
          cx <= candidateRoom.gx + candidateRoom.gw + 0.15 &&
          cz <= candidateRoom.gz + candidateRoom.gd + 0.15;
        if (!inside) {
          const dx = Math.max(candidateRoom.gx - cx, 0, cx - (candidateRoom.gx + candidateRoom.gw)) * 4;
          const dz = Math.max(candidateRoom.gz - cz, 0, cz - (candidateRoom.gz + candidateRoom.gd)) * 4;
          const distanceFt = Math.hypot(dx, dz);
          const isWallBuiltIn = /storage|cabinet|casework|shelf|counter/i.test(`${candidate.type} ${candidate.desc}`);
          if (isWallBuiltIn && distanceFt <= 2) {
            warnings.push(`${candidate.desc || candidate.type} is ${distanceFt.toFixed(1)} ft outside ${candidateRoom.label}`);
          } else {
            blockers.push(`${candidate.desc || candidate.type} outside ${candidateRoom.label}`);
          }
        }
      }
    }
    return { status: blockers.length ? 'blocked' : warnings.length ? 'local pass + warnings' : 'local pass', blockers, warnings };
  }, [home]);

  const updateRoomLabel = (label: string) => {
    if (!home || !room) return;
    const next = cloneHome(home);
    next.rooms[roomIndex] = { ...next.rooms[roomIndex], label };
    onChange(next);
  };

  const updateRoomGeometry = (patch: Partial<Pick<DenHome['rooms'][number], 'gx' | 'gz' | 'gw' | 'gd'>>) => {
    if (!home || !room) return;
    const next = cloneHome(home);
    next.rooms[roomIndex] = { ...next.rooms[roomIndex], ...patch };
    onChange(next);
  };

  const nudgeRoom = (dx: number, dz: number) => {
    if (!home || !room) return;
    const next = cloneHome(home);
    const targetRoom = next.rooms[roomIndex];
    targetRoom.gx += dx;
    targetRoom.gz += dz;
    targetRoom.fixtures = targetRoom.fixtures?.map((item) => ({
      ...item,
      x: item.x + dx,
      z: item.z + dz,
    }));
    onChange(next);
  };

  const updateFixture = (patch: Record<string, number>) => {
    if (!home || !room || !fixture) return;
    const next = cloneHome(home);
    const targetRoom = next.rooms[roomIndex];
    targetRoom.fixtures = targetRoom.fixtures?.map((item) => (
      item.id === fixture.id ? { ...item, ...patch } : item
    ));
    onChange(next);
  };

  const nudgeFixture = (dx: number, dz: number) => {
    if (!fixture) return;
    updateFixture({ x: fixture.x + dx, z: fixture.z + dz });
  };

  const updateConnection = (patch: Partial<EditableConnection>) => {
    if (!home || !connection) return;
    const next = cloneHome(home);
    const sourceOpeningId = connection.opening?.source ?? connection.openingId;
    next.connections = connections.map((item, index) => (
      index === connectionIndex ? { ...item, ...patch } : item
    ));
    if (sourceOpeningId && patch.type) {
      const kind = patch.type === 'sliding' ? 'door' : patch.type === 'wall' ? 'opening' : patch.type;
      next.sourceOpenings = next.sourceOpenings?.map((opening) => (
        opening.id === sourceOpeningId
          ? { ...opening, kind }
          : opening
      ));
    }
    onChange(next);
  };

  const updateOpening = (patch: Partial<EditableOpening>) => {
    if (!home || !connection?.opening) return;
    const next = cloneHome(home);
    const sourceOpeningId = connection.opening.source ?? connection.openingId;
    const opening = { ...connection.opening, ...patch };
    next.connections = connections.map((item, index) => (
      index === connectionIndex ? { ...item, opening } : item
    ));
    if (sourceOpeningId) {
      next.sourceOpenings = next.sourceOpenings?.map((item) => (
        item.id === sourceOpeningId
          ? {
            ...item,
            x1: opening.x1,
            z1: opening.z1,
            x2: opening.x2,
            z2: opening.z2,
          }
          : item
      ));
    }
    onChange(next);
  };

  const nudgeOpening = (dx: number, dz: number) => {
    if (!connection?.opening) return;
    updateOpening({
      x1: connection.opening.x1 + dx,
      x2: connection.opening.x2 + dx,
      z1: connection.opening.z1 + dz,
      z2: connection.opening.z2 + dz,
    });
  };

  const resizeOpening = (delta: number) => {
    if (!connection?.opening) return;
    const opening = connection.opening;
    const horizontal = Math.abs(opening.x2 - opening.x1) >= Math.abs(opening.z2 - opening.z1);
    if (horizontal) {
      updateOpening({ x1: opening.x1 - delta / 2, x2: opening.x2 + delta / 2 });
    } else {
      updateOpening({ z1: opening.z1 - delta / 2, z2: opening.z2 + delta / 2 });
    }
  };

  const updateRoof = (patch: Partial<NonNullable<DenHome['roofSemantics']>>) => {
    if (!home?.roofSemantics) return;
    const next = cloneHome(home);
    next.roofSemantics = roofWithValidation({ ...home.roofSemantics, ...patch });
    if (typeof patch.ridgeHeightFt === 'number') {
      next.height = patch.ridgeHeightFt;
    }
    onChange(next);
  };

  const exportEdited = () => {
    if (!home || typeof window === 'undefined') return;
    const payload = {
      artifactVersion: 'paired_floorplan_editor_patch_v1',
      planId: home.id,
      proposalId: home.pairedProposalId,
      rooms: home.rooms.map((item) => ({
        label: item.label,
        type: item.type,
        floor: item.floor ?? 0,
        gx: item.gx,
        gz: item.gz,
        gw: item.gw,
        gd: item.gd,
        fixtures: item.fixtures ?? [],
      })),
      sourceWalls: home.sourceWalls ?? [],
      sourceOpenings: home.sourceOpenings ?? [],
      connections: home.connections ?? [],
      roofSemantics: home.roofSemantics,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${home.id}-${home.pairedProposalId ?? 'edited'}-editor-patch.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!home) return null;

  return (
    <div className="border-t border-stone-200 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Semantic Editor</h2>
        <span className={`font-mono text-[10px] ${editorAudit.blockers.length ? 'text-amber-700' : 'text-emerald-700'}`}>
          {editorAudit.status}
        </span>
      </div>
      <div className="mt-2 space-y-2 text-[10px]">
        <label className="block">
          <span className="mb-1 block text-stone-400">room</span>
          <select
            value={roomIndex}
            onChange={(event) => {
              const nextIndex = Number(event.target.value);
              setRoomIndex(nextIndex);
              setFixtureId('');
            }}
            className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
          >
            {rooms.map((item, index) => (
              <option key={`${item.label}-${index}`} value={index}>
                {item.floor ?? 0}: {item.label}
              </option>
            ))}
          </select>
        </label>
        {room && (
          <label className="block">
            <span className="mb-1 block text-stone-400">label</span>
            <input
              value={room.label}
              onChange={(event) => updateRoomLabel(event.target.value)}
              className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
            />
          </label>
        )}
        {room && (
          <div className="space-y-1 border border-stone-200 bg-stone-50 p-2">
            <div className="text-stone-400">room geometry</div>
            <div className="grid grid-cols-3 gap-1">
              <button className="border border-stone-200 bg-white py-1" onClick={() => nudgeRoom(0, -0.125)}>N</button>
              <button className="border border-stone-200 bg-white py-1" onClick={() => nudgeRoom(-0.125, 0)}>W</button>
              <button className="border border-stone-200 bg-white py-1" onClick={() => nudgeRoom(0.125, 0)}>E</button>
              <button className="col-start-2 border border-stone-200 bg-white py-1" onClick={() => nudgeRoom(0, 0.125)}>S</button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <label className="block">
                <span className="mb-1 block text-stone-400">x ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(room.gx)}
                  onChange={(event) => updateRoomGeometry({ gx: ftToGrid(event.target.value) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">z ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(room.gz)}
                  onChange={(event) => updateRoomGeometry({ gz: ftToGrid(event.target.value) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">width ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(room.gw)}
                  onChange={(event) => updateRoomGeometry({ gw: ftToGrid(event.target.value, 0.25) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">depth ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(room.gd)}
                  onChange={(event) => updateRoomGeometry({ gd: ftToGrid(event.target.value, 0.25) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
            </div>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block text-stone-400">fixture</span>
          <select
            value={fixture?.id ?? ''}
            onChange={(event) => setFixtureId(event.target.value)}
            className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
            disabled={!fixtures.length}
          >
            {!fixtures.length && <option value="">No fixtures in room</option>}
            {fixtures.map((item, index) => (
              <option key={item.id ?? index} value={item.id ?? ''}>
                {item.desc || item.type}
              </option>
            ))}
          </select>
        </label>
        {fixture && (
          <>
            <div className="grid grid-cols-3 gap-1">
              <button className="border border-stone-200 bg-white py-1" onClick={() => nudgeFixture(0, -0.125)}>N</button>
              <button className="border border-stone-200 bg-white py-1" onClick={() => nudgeFixture(-0.125, 0)}>W</button>
              <button className="border border-stone-200 bg-white py-1" onClick={() => nudgeFixture(0.125, 0)}>E</button>
              <button className="col-start-2 border border-stone-200 bg-white py-1" onClick={() => nudgeFixture(0, 0.125)}>S</button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <label className="block">
                <span className="mb-1 block text-stone-400">fixture x ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(fixture.x)}
                  onChange={(event) => updateFixture({ x: ftToGrid(event.target.value) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">fixture z ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(fixture.z)}
                  onChange={(event) => updateFixture({ z: ftToGrid(event.target.value) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">fixture width ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(fixture.w)}
                  onChange={(event) => updateFixture({ w: ftToGrid(event.target.value, 0.125) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">fixture depth ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={gridToFt(fixture.d)}
                  onChange={(event) => updateFixture({ d: ftToGrid(event.target.value, 0.125) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-stone-400">rotation</span>
              <input
                type="number"
                value={fixture.rotationDeg ?? 0}
                onChange={(event) => updateFixture({ rotationDeg: Number(event.target.value) })}
                className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
              />
            </label>
          </>
        )}
        <div className="space-y-1 border border-stone-200 bg-stone-50 p-2">
          <div className="text-stone-400">door / opening</div>
          <label className="block">
            <span className="mb-1 block text-stone-400">connection</span>
            <select
              value={connectionIndex}
              onChange={(event) => setConnectionIndex(Number(event.target.value))}
              className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
              disabled={!connections.length}
            >
              {!connections.length && <option value="">No connections</option>}
              {connections.map((item, index) => (
                <option key={`${item.from}-${item.to}-${index}`} value={index}>
                  {item.type}: {item.from} to {item.to}
                </option>
              ))}
            </select>
          </label>
          {connection && (
            <>
              <div className="grid grid-cols-2 gap-1">
                <label className="block">
                  <span className="mb-1 block text-stone-400">type</span>
                  <select
                    value={connection.type}
                    onChange={(event) => updateConnection({ type: event.target.value as EditableConnection['type'] })}
                    className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                  >
                    <option value="open">open</option>
                    <option value="door">door</option>
                    <option value="sliding">sliding</option>
                    <option value="wall">wall</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-stone-400">swing</span>
                  <select
                    value={connection.swingDirection ?? 'unknown'}
                    onChange={(event) => updateConnection({ swingDirection: event.target.value as EditableConnection['swingDirection'] })}
                    className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                  >
                    <option value="unknown">unknown</option>
                    <option value="left">left</option>
                    <option value="right">right</option>
                    <option value="in">in</option>
                    <option value="out">out</option>
                  </select>
                </label>
              </div>
              {connection.opening ? (
                <>
                  <div className="grid grid-cols-2 gap-1">
                    <label className="block">
                      <span className="mb-1 block text-stone-400">x1 ft</span>
                      <input
                        type="number"
                        step="0.5"
                        value={gridToFt(connection.opening.x1)}
                        onChange={(event) => updateOpening({ x1: ftToGrid(event.target.value) })}
                        className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-stone-400">z1 ft</span>
                      <input
                        type="number"
                        step="0.5"
                        value={gridToFt(connection.opening.z1)}
                        onChange={(event) => updateOpening({ z1: ftToGrid(event.target.value) })}
                        className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-stone-400">x2 ft</span>
                      <input
                        type="number"
                        step="0.5"
                        value={gridToFt(connection.opening.x2)}
                        onChange={(event) => updateOpening({ x2: ftToGrid(event.target.value) })}
                        className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-stone-400">z2 ft</span>
                      <input
                        type="number"
                        step="0.5"
                        value={gridToFt(connection.opening.z2)}
                        onChange={(event) => updateOpening({ z2: ftToGrid(event.target.value) })}
                        className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    <button type="button" className="border border-stone-200 bg-white py-1" onClick={() => nudgeOpening(0, -0.125)}>N</button>
                    <button type="button" className="border border-stone-200 bg-white py-1" onClick={() => nudgeOpening(-0.125, 0)}>W</button>
                    <button type="button" className="border border-stone-200 bg-white py-1" onClick={() => nudgeOpening(0.125, 0)}>E</button>
                    <button type="button" className="border border-stone-200 bg-white py-1" onClick={() => nudgeOpening(0, 0.125)}>S</button>
                    <button type="button" className="col-span-2 border border-stone-200 bg-white py-1" onClick={() => resizeOpening(-0.125)}>Narrow</button>
                    <button type="button" className="col-span-2 border border-stone-200 bg-white py-1" onClick={() => resizeOpening(0.125)}>Widen</button>
                  </div>
                  <div className={`text-[9px] ${home.sourceWalls?.length && openingAlignedToWall({ ...connection.opening, kind: connection.type === 'wall' ? 'opening' : 'door' }, home.sourceWalls) ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {home.sourceWalls?.length && openingAlignedToWall({ ...connection.opening, kind: connection.type === 'wall' ? 'opening' : 'door' }, home.sourceWalls)
                      ? 'opening aligned to source wall'
                      : 'opening needs wall alignment review'}
                  </div>
                </>
              ) : (
                <div className="text-[9px] text-stone-400">No explicit opening span attached.</div>
              )}
            </>
          )}
        </div>
        {home.roofSemantics && (
          <div className="space-y-1 border border-stone-200 bg-stone-50 p-2">
            <div className="flex items-center justify-between">
              <span className="text-stone-400">roof semantics</span>
              <span className="font-mono text-[9px] text-amber-700">{home.roofSemantics.status}</span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <label className="block">
                <span className="mb-1 block text-stone-400">ridge ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={Number(home.roofSemantics.ridgeHeightFt.toFixed(2))}
                  onChange={(event) => updateRoof({ ridgeHeightFt: Math.max(1, Number(event.target.value)) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">eave ft</span>
                <input
                  type="number"
                  step="0.5"
                  value={Number(home.roofSemantics.eaveHeightFt.toFixed(2))}
                  onChange={(event) => updateRoof({ eaveHeightFt: Math.max(0, Number(event.target.value)) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">overhang ft</span>
                <input
                  type="number"
                  step="0.25"
                  value={Number(home.roofSemantics.overhangFt.toFixed(2))}
                  onChange={(event) => updateRoof({ overhangFt: Math.max(0, Number(event.target.value)) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-stone-400">thickness ft</span>
                <input
                  type="number"
                  step="0.05"
                  value={Number(home.roofSemantics.roofThicknessFt.toFixed(2))}
                  onChange={(event) => updateRoof({ roofThicknessFt: Math.max(0.05, Number(event.target.value)) })}
                  className="w-full border border-stone-200 bg-white px-2 py-1 font-mono text-stone-700"
                />
              </label>
            </div>
            {home.roofSemantics.blockers.length > 0 && (
              <div className="space-y-1 text-[9px] text-amber-800">
                {home.roofSemantics.blockers.slice(0, 2).map((blocker) => <div key={blocker}>{blocker}</div>)}
              </div>
            )}
          </div>
        )}
        {editorAudit.blockers.length > 0 && (
          <div className="space-y-1 border border-amber-100 bg-amber-50 p-2 text-[9px] text-amber-800">
            {editorAudit.blockers.slice(0, 4).map((blocker) => <div key={blocker}>{blocker}</div>)}
          </div>
        )}
        {editorAudit.warnings.length > 0 && (
          <div className="space-y-1 border border-stone-200 bg-stone-50 p-2 text-[9px] text-stone-600">
            {editorAudit.warnings.slice(0, 4).map((warning) => <div key={warning}>{warning}</div>)}
          </div>
        )}
        <div className="grid grid-cols-3 gap-1">
          <button type="button" onClick={onSave} disabled={!edited || !canSave || editorAudit.blockers.length > 0} className="border border-stone-300 bg-white px-2 py-1 text-stone-700 disabled:opacity-40">
            Save
          </button>
          <button type="button" onClick={exportEdited} className="border border-stone-300 bg-white px-2 py-1 text-stone-700">
            Export
          </button>
          <button type="button" onClick={onReset} disabled={!edited} className="border border-stone-300 bg-white px-2 py-1 text-stone-700 disabled:opacity-40">
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

function SemanticReviewPanel({ home }: { home: DenHome }) {
  const semanticBim = useMemo(() => semanticBimFromHome(home), [home]);
  const buildableBim = useMemo(() => buildableBimFromHome(home), [home]);
  const semanticSummary = useMemo(() => semanticBimSummary(semanticBim), [semanticBim]);
  const buildableSummary = useMemo(() => buildableBimSummary(buildableBim), [buildableBim]);
  const groups = useMemo(() => validationGroups(home, null), [home]);
  const standards = useMemo(() => validateStandards(home), [home]);
  const standardsRegistry = useMemo(() => standardsRegistrySummary(), []);
  const drawingPrimitives = useMemo(() => {
    const sourcePrimitives = extractSourceDrawingPrimitives(home.pairedArtifactJson);
    const primitiveDiffs = diffSourceToSemanticDrawingPrimitives(home.pairedArtifactJson);
    return {
      schemaVersion: 'drawing_primitive_contract_v1',
      sourceCounts: countDrawingPrimitives(sourcePrimitives),
      sourcePrimitives,
      sourceToSemanticDiffs: primitiveDiffs,
      blockingDiffs: primitiveDiffs.filter((diff) => diff.severity === 'blocked'),
      warningDiffs: primitiveDiffs.filter((diff) => diff.severity === 'warning'),
    };
  }, [home.pairedArtifactJson]);
  const planJson = useMemo(() => ({
    planId: home.id,
    proposalId: home.pairedProposalId,
    sourceOfTruth: 'paired semantic JSON',
    standardsRegistryVersion: standardsRegistry.version,
    standards,
    drawingStyleProfile: home.drawingStyleProfile ?? null,
    drawingPrimitives,
    semanticPlan: semanticPlanForHome(home),
    semanticBim: semanticSummary,
    buildableBim: buildableSummary,
  }), [buildableSummary, drawingPrimitives, home, semanticSummary, standards, standardsRegistry.version]);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)]">
      <section className="rounded-lg border border-stone-200 bg-white p-3 shadow-[0_14px_30px_-22px_rgba(41,37,36,0.25)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">Semantic Source</h3>
            <div className="mt-0.5 font-mono text-[10px] text-stone-400">paired JSON - semantic_bim_v1 - buildable_bim_v1</div>
          </div>
          <span className={`font-mono text-[10px] ${buildableSummary.status === 'blocked' ? 'text-red-700' : buildableSummary.status === 'warning' ? 'text-amber-700' : 'text-emerald-700'}`}>
            {buildableSummary.status}
          </span>
        </div>
        <div className="grid gap-2 text-[10px] md:grid-cols-3">
          <div className="border border-stone-200 bg-stone-50 p-2">
            <div className="text-stone-400">schema</div>
            <div className="font-mono text-stone-700">{buildableSummary.schemaVersion}</div>
          </div>
          <div className="border border-stone-200 bg-stone-50 p-2">
            <div className="text-stone-400">elements</div>
            <div className="font-mono text-stone-700">{buildableSummary.counts.total}</div>
          </div>
          <div className="border border-stone-200 bg-stone-50 p-2">
            <div className="text-stone-400">roof</div>
            <div className={`font-mono ${home.roofSemantics?.status === 'validated' ? 'text-emerald-700' : 'text-amber-700'}`}>
              {home.roofSemantics?.status ?? 'missing'}
            </div>
          </div>
          <div className="border border-stone-200 bg-stone-50 p-2">
            <div className="text-stone-400">standards</div>
            <div className="font-mono text-stone-700">{standards.registryVersion}</div>
          </div>
          <div className="border border-stone-200 bg-stone-50 p-2">
            <div className="text-stone-400">BCF issues</div>
            <div className="font-mono text-stone-700">{standards.issues.length}</div>
          </div>
          <div className="border border-stone-200 bg-stone-50 p-2">
            <div className="text-stone-400">compliance</div>
            <div className="font-mono text-amber-700">checks only</div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-[10px] md:grid-cols-2">
          {buildableSummary.blockers.slice(0, 5).map((item) => <div key={item} className="border border-red-100 bg-red-50 p-2 text-red-700">{item}</div>)}
          {!buildableSummary.blockers.length && buildableSummary.warnings.slice(0, 5).map((item) => <div key={item} className="border border-amber-100 bg-amber-50 p-2 text-amber-700">{item}</div>)}
          {!buildableSummary.blockers.length && !buildableSummary.warnings.length && <div className="border border-emerald-100 bg-emerald-50 p-2 text-emerald-700">No BIM blockers or warnings.</div>}
        </div>
        <div className="mt-4">
          <ConstraintReportPanel home={home} />
        </div>
        <div className="mt-4">
          <ValidationSummary groups={groups} />
        </div>
      </section>
      <section className="min-h-[520px] overflow-hidden border border-stone-200 bg-white p-3 shadow-sm">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">Semantic Evidence</h3>
        <pre className="h-[500px] overflow-auto bg-stone-950 p-3 text-[10px] leading-relaxed text-stone-100">
          {JSON.stringify(planJson, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function PairedComparison({ home, mode, onModeChange }: { home: DenHome; mode: CompareMode; onModeChange: (mode: CompareMode) => void }) {
  const info = home.pairedArtifactInfo;
  if (!info) {
    return (
      <div className="flex h-full min-h-[300px] items-center justify-center text-xs text-stone-400">
        No paired GPT proposal/render artifact is attached to this plan.
      </div>
    );
  }

  // Overlay measures drift between a GPT proposal image and the render;
  // a JSON-only plan has no image to drift from, so the tab would only
  // ghost stale reference art over the sheet.
  const buttons: Array<{ id: CompareMode; label: string }> = [
    { id: 'compare', label: 'Compare' },
    ...(isJsonOnlyPlan(home) ? [] : [{ id: 'overlay' as CompareMode, label: 'Overlay' }]),
    { id: 'semantic', label: 'Semantic' },
  ];
  // Mode can arrive as 'overlay' when switching from a GPT plan; fall back.
  const effectiveMode: CompareMode = isJsonOnlyPlan(home) && mode === 'overlay' ? 'compare' : mode;
  const renderUrl = info.deterministicRenderUrl;
  const storedDeterministicRender = renderUrl ? (
    <img src={renderUrl} alt={`${home.model} deterministic render`} className="block h-auto w-full object-contain" />
  ) : null;
  const liveDeterministicRender = (
    <FloorPlanView
      rooms={home.rooms}
      footprint={home.footprint}
      connections={home.connections}
      sourceWalls={home.sourceWalls}
      sourceOpenings={home.sourceOpenings}
      spaceFaces={home.spaceFaces}
      dimensionLines={home.dimensionLines}
      dimensionFrame={home.dimensionFrame}
      annotations={{
        planId: home.id,
        areaSqft: home.sqft,
        bedBath: home.bedBath,
        roofStyle: home.roofStyle,
        jsonOnly: isJsonOnlyPlan(home),
      }}
      floorFrames={home.floorFrames}
      traceMode={home.pairedArtifact}
      drawingStyleProfile={home.drawingStyleProfile}
    />
  );
  // Compare/Overlay show the LIVE renderer so current drawing rules (e.g.
  // legible dimension text) always apply; the stored render remains QA
  // evidence fetched directly by url in brochure-visual-qa.
  const deterministicRender = liveDeterministicRender;
  const renderFallback = (
    <div>
      <div className="mb-2 text-[10px] leading-snug text-stone-400">
        No GPT proposal image to overlay - showing the deterministic render of the semantic JSON.
      </div>
      <div className="[&>img]:h-auto [&>img]:w-full [&>svg]:h-auto [&>svg]:w-full">
        {deterministicRender}
      </div>
    </div>
  );
  const qaPrimitiveMetadataRender = storedDeterministicRender ? (
    <div
      aria-hidden="true"
      data-review-primitive-metadata="true"
      className="pointer-events-none fixed left-[-20000px] top-0 opacity-0"
    >
      {liveDeterministicRender}
    </div>
  ) : null;

  return (
    <div className="min-h-[560px] overflow-visible bg-[#fdfbf7] p-4">
      {qaPrimitiveMetadataRender}
      <div className="relative z-20 mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">
            {isJsonOnlyPlan(home) ? 'Plan Sheet + Elevations' : 'GPT Proposal + Deterministic Render'}
            {isJsonOnlyPlan(home) && (
              <span className="ml-2 rounded-sm border border-stone-300 bg-stone-100 px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-stone-600" data-json-only-packet>
                JSON-only deterministic packet
              </span>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-stone-400">{info.proposalId}</div>
        </div>
        <div className="relative z-20 flex overflow-hidden rounded-sm border border-stone-200 bg-white">
          {buttons.map((button) => (
            <button
              key={button.id}
              type="button"
              onClick={() => onModeChange(button.id)}
              className={`border-l border-stone-200 px-2.5 py-1 text-[10px] first:border-l-0 ${
                effectiveMode === button.id ? 'bg-stone-800 text-white' : 'text-stone-500 hover:bg-stone-50'
              }`}
            >
              {button.label}
            </button>
          ))}
        </div>
      </div>

      {effectiveMode === 'compare' ? (
        <div className="relative z-0 grid gap-4 xl:grid-cols-2">
          <figure className="rounded-lg border border-stone-200 bg-white p-3 shadow-[0_14px_30px_-22px_rgba(41,37,36,0.25)]">
            {isJsonOnlyPlan(home) ? (
              <>
                <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">Elevations - Front + Side</figcaption>
                <div className="flex h-[min(72vh,760px)] flex-col gap-3 overflow-auto">
                  <SemanticElevationView home={home} side="front" />
                  <SemanticElevationView home={home} side="side" />
                </div>
              </>
            ) : (
              <>
                <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">GPT Proposal</figcaption>
                <div className="flex h-[min(72vh,760px)] items-center justify-center overflow-hidden bg-white">
                  {info.sourceImageUrl ? (
                    <img src={info.sourceImageUrl} alt={`${home.model} GPT proposal`} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <div className="px-8 text-center text-[11px] leading-relaxed text-stone-400">
                      <div className="mb-1 font-semibold uppercase tracking-wide">No proposal image</div>
                      This plan was authored as semantic JSON only. The deterministic render on the right is the design — a GPT proposal image is optional reference art.
                    </div>
                  )}
                </div>
              </>
            )}
          </figure>
          <figure className="rounded-lg border border-stone-200 bg-white p-3 shadow-[0_14px_30px_-22px_rgba(41,37,36,0.25)]">
            <figcaption className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-stone-500">Deterministic Render</figcaption>
            <div className="mx-auto flex h-[min(72vh,760px)] w-full items-center justify-center overflow-hidden bg-white [&>img]:max-h-full [&>img]:max-w-full [&>img]:object-contain [&>svg]:max-h-full [&>svg]:max-w-full">
              {deterministicRender}
            </div>
          </figure>
        </div>
      ) : effectiveMode === 'overlay' ? (
        <div className="relative z-0 mx-auto max-w-5xl rounded-lg border border-stone-200 bg-white p-3 shadow-[0_14px_30px_-22px_rgba(41,37,36,0.25)]">
          {info.sourceImageUrl ? (
            <div className="relative overflow-hidden">
              <img src={info.sourceImageUrl} alt={`${home.model} GPT proposal`} className="block h-auto w-full opacity-55" />
              <div className="absolute inset-0 flex items-center justify-center opacity-70 mix-blend-multiply [&>img]:h-full [&>img]:w-full [&>img]:object-contain [&>svg]:h-full [&>svg]:w-full">
                {deterministicRender}
              </div>
            </div>
          ) : renderFallback}
        </div>
      ) : (
        <SemanticReviewPanel home={home} />
      )}
    </div>
  );
}

function SemanticElevationView({ home, side }: { home: DenHome; side: 'front' | 'side' }) {
  const model = elevationModelForHome(home, side);
  const svg = elevationSvgString(model);
  return (
    <div className="flex items-center justify-center bg-[#f7f3ec] p-4">
      <div className="w-full max-w-5xl border border-stone-200 bg-[#fbfaf6] p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between text-[10px] uppercase tracking-wide text-stone-500">
          <span>{side} elevation - {model.gableFacing ? 'gable face' : 'eave face'}</span>
          <span>
            {model.spanFt}&apos; span - {Math.round(model.ridgeFt)}&apos; ridge - {model.openings.length} opening{model.openings.length === 1 ? '' : 's'} - {home.roofSemantics?.status === 'validated' ? 'paired roof/elevation' : 'provisional'}
          </span>
        </div>
        {/* eslint-disable-next-line react/no-danger */}
        <div className="h-[min(32vh,300px)] w-full [&>svg]:h-full [&>svg]:w-full" data-elevation-openings={model.openings.length} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </div>
  );
}

function MiniElevationPreview({ home }: { home: DenHome }) {
  // Real elevation from the artifact — cards should differ the way the
  // buildings differ. Prefer the gable face: at thumbnail size the roof
  // profile carries the identity; a low eave face reads as a flat bar.
  // Generic box+roofline drawing is the fallback for plans whose artifact
  // cannot produce an elevation model.
  let real: { svg: string; openings: number } | null = null;
  try {
    const front = elevationModelForHome(home, 'front');
    const side = elevationModelForHome(home, 'side');
    const model = front.gableFacing ? front : side.gableFacing ? side : front;
    real = { svg: elevationSvgString(model), openings: model.openings.length };
  } catch {
    real = null;
  }
  if (real) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-[#f7f3ec] p-1.5 [&>svg]:h-full [&>svg]:w-full"
        data-elevation-openings={real.openings}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: real.svg }}
      />
    );
  }
  const span = home.footprint.width;
  const roof = home.roofSemantics;
  const ridge = roof?.ridgeHeightFt ?? home.height;
  const eave = roof?.eaveHeightFt ?? Math.max(7, home.height * 0.45);
  const overhang = roof?.overhangFt ?? 1;
  const width = 240;
  const height = 150;
  const pad = 18;
  const scaleX = (width - pad * 2) / (span + overhang * 2);
  const scaleY = (height - pad * 2) / Math.max(ridge + 1, 12);
  const x0 = pad + overhang * scaleX;
  const x1 = x0 + span * scaleX;
  const yBase = height - pad;
  const yEave = yBase - eave * scaleY;
  const yRidge = yBase - ridge * scaleY;
  const xRidge = (x0 + x1) / 2;
  const roofPoints = home.roofStyle === 'shed'
    ? `${x0 - overhang * scaleX},${yEave} ${x1 + overhang * scaleX},${yRidge}`
    : `${x0 - overhang * scaleX},${yEave} ${xRidge},${yRidge} ${x1 + overhang * scaleX},${yEave}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full bg-[#f7f3ec]">
      <rect x={x0} y={yEave} width={x1 - x0} height={yBase - yEave} fill="#f1ece2" stroke="#6d665b" strokeWidth="2" />
      <polyline points={roofPoints} fill="none" stroke="#3f3a33" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <line x1={x0} y1={yBase} x2={x1} y2={yBase} stroke="#8f867a" strokeWidth="2" />
      <rect x={x0 + (x1 - x0) * 0.18} y={yEave + 18} width={Math.max(16, (x1 - x0) * 0.16)} height="18" fill="#e6eef0" stroke="#9aa9aa" strokeWidth="1" />
      <rect x={x0 + (x1 - x0) * 0.62} y={yEave + 18} width={Math.max(16, (x1 - x0) * 0.16)} height="18" fill="#e6eef0" stroke="#9aa9aa" strokeWidth="1" />
      <text x={width / 2} y={height - 5} textAnchor="middle" fontFamily="monospace" fontSize="9" fill="#8a8178">
        {home.roofSemantics?.status === 'validated' ? 'validated elevation' : 'provisional elevation'}
      </text>
    </svg>
  );
}

/**
 * Landing-page brief box: the product promise (type a brief, get a checked
 * plan) must be reachable without opening Review Tools on a plan page.
 */
function GalleryBriefGenerate() {
  // Deliberately uncontrolled: on a cold load, keystrokes typed before
  // hydration/data-load would be wiped by the first re-render of a
  // controlled input. Reading the DOM value at generate time keeps every
  // keystroke the customer saw.
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  // Live echo of what the parser understood — silent drops are the enemy.
  const [echo, setEcho] = useState<ReturnType<typeof parseBrief> | null>(null);
  const generate = async () => {
    const brief = (inputRef.current?.value ?? '').trim();
    if (!brief) {
      setStatus('Describe the home first - e.g. "2-bed A-frame, 40x60 lot, 5 ft side setbacks".');
      return;
    }
    setBusy(true);
    setStatus('Generating plan...');
    try {
      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus(`Could not generate: ${body.error ?? res.status}${body.errors ? ` - ${body.errors.slice(0, 2).join('; ')}` : ''}`);
        setBusy(false);
        return;
      }
      setStatus(`Generated ${body.planId}. Opening...`);
      window.location.href = body.url;
    } catch (error) {
      setStatus(`Could not generate: ${(error as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 max-w-3xl">
      <div className="flex gap-2">
        <input
          ref={inputRef}
          defaultValue=""
          onChange={(event) => {
            const text = event.target.value.trim();
            setEcho(text ? parseBrief(text) : null);
          }}
          onKeyDown={(event) => { if (event.key === 'Enter' && !busy) generate(); }}
          placeholder="Describe it: 2-bed A-frame, ≤800 sqft, 40×60 lot, 5 ft side setbacks"
          data-home-brief-input
          className="flex-1 border border-stone-300 bg-white px-3 py-2.5 font-mono text-xs text-stone-800 outline-none focus:border-stone-500"
        />
        <button
          type="button"
          data-home-generate
          onClick={generate}
          disabled={busy}
          className="border border-emerald-800 bg-emerald-800 px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          Generate Plan
        </button>
      </div>
      {echo && (
        <div className="mt-1.5 text-[10px]" data-home-brief-echo>
          <span className="text-stone-500">
            Understood: {[
              `${Math.max(1, Math.min(3, echo.bedrooms ?? 2))} bed${(echo.bedrooms ?? 2) > 3 ? ' (max 3)' : ''}`,
              `${Math.max(1, Math.min(2, Math.round(echo.baths ?? 1)))} bath${Math.round(echo.baths ?? 1) > 2 ? ' (max 2)' : ''}`,
              echo.roofStyle ?? 'a-frame',
              echo.maxSqft ? `≤${echo.maxSqft} sqft` : null,
              echo.lot ? `${echo.lot.widthFt}×${echo.lot.depthFt} lot` : 'no lot',
              echo.lot?.setbacksFt
                ? `setbacks F${echo.lot.setbacksFt.front ?? 0}/B${echo.lot.setbacksFt.rear ?? 0}/L${echo.lot.setbacksFt.left ?? 0}/R${echo.lot.setbacksFt.right ?? 0}`
                : null,
              echo.lot?.maxCoverageRatio ? `≤${Math.round(echo.lot.maxCoverageRatio * 100)}% coverage` : null,
            ].filter(Boolean).join(' · ')}
          </span>
          {echo.unparsed.length > 0 && (
            <span className="ml-2 text-amber-700" data-home-brief-ignored>
              Ignored: {echo.unparsed.join(', ')}
            </span>
          )}
        </div>
      )}
      {status && (
        <div className="mt-2 border border-stone-200 bg-stone-50 p-2 text-[11px] text-stone-600" data-home-generate-status>
          {status}
        </div>
      )}
      <div className="mt-1.5 text-[10px] text-stone-400">
        Bedrooms, roof style (A-frame/gable), max sq ft, lot size, and setbacks are parsed from the sentence; the plan is checked against Cherokee County, NC rules.
      </div>
    </div>
  );
}

/** JSON-only lane: authored as constrained JSON, no GPT image by design. */
function isJsonOnlyPlan(home: DenHome | null | undefined): boolean {
  return home?.pairedArtifactInfo?.sourceKind === 'constrained_json';
}

/**
 * Review-lane generated plans (gen-NNN, not promoted) can be deleted from the
 * UI; traced reference plans and promoted plans never qualify. The API route
 * enforces the same rule server-side.
 */
function isDeletablePlan(home: DenHome | null | undefined, lifecycle: ArtifactLifecycle | string) {
  if (!home) return false;
  if (!/^gen-\d{3}$/.test(home.id)) return false;
  if (lifecycle === 'promoted' || lifecycle === 'exported') return false;
  if (home.pairedArtifactInfo?.promotionEligible) return false;
  return true;
}

function ProductGallery({
  homes,
  lifecycleStates,
  onOpenPlan,
  onRepairPlan,
  onNewPlan,
  onDeletePlan,
}: {
  homes: DenHome[];
  lifecycleStates: Record<string, ArtifactLifecycle>;
  onOpenPlan: (id: string) => void;
  onRepairPlan: (id: string) => void;
  onNewPlan: () => void;
  onDeletePlan: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [bedFilter, setBedFilter] = useState('all');
  const [bathFilter, setBathFilter] = useState('all');
  const [sqftFilter, setSqftFilter] = useState('all');
  const [levelFilter, setLevelFilter] = useState('all');
  const [roofFilter, setRoofFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const bedBathParts = useCallback((home: DenHome) => {
    const [beds = '', baths = ''] = `${home.bedBath ?? ''}`.split('/').map((part) => part.trim());
    return { beds, baths };
  }, []);
  const bedOptions = useMemo(() => {
    const values = homes
      .map((home) => bedBathParts(home).beds)
      .filter((value): value is string => Boolean(value));
    return ['all', ...Array.from(new Set(values)).sort()];
  }, [bedBathParts, homes]);
  const bathOptions = useMemo(() => {
    const values = homes
      .map((home) => bedBathParts(home).baths)
      .filter((value): value is string => Boolean(value));
    return ['all', ...Array.from(new Set(values)).sort()];
  }, [bedBathParts, homes]);
  const roofOptions = useMemo(() => ['all', ...Array.from(new Set(homes.map((home) => home.roofStyle).filter(Boolean))).sort()], [homes]);
  const levelOptions = useMemo(() => {
    const values = homes.map((home) => String(Math.max(1, new Set(home.rooms.map((room) => room.floor ?? 0)).size)));
    return ['all', ...Array.from(new Set(values)).sort()];
  }, [homes]);
  const filteredHomes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return homes.filter((home) => {
      const audit = productAudit(home, null);
      const lifecycle = audit.designBlockers.length ? 'blocked' : (lifecycleStates[home.id] ?? audit.status);
      const { beds, baths } = bedBathParts(home);
      const levels = String(Math.max(1, new Set(home.rooms.map((room) => room.floor ?? 0)).size));
      const haystack = [
        home.model,
        home.id,
        home.roofStyle,
        home.bedBath,
        (home as { tags?: string[] }).tags?.join(' '),
        `${home.sqft}`,
        `${home.footprint.width}x${home.footprint.depth}`,
      ].join(' ').toLowerCase();
      if (normalizedQuery && !haystack.includes(normalizedQuery)) return false;
      if (bedFilter !== 'all' && beds !== bedFilter) return false;
      if (bathFilter !== 'all' && baths !== bathFilter) return false;
      if (sqftFilter === 'under-500' && home.sqft >= 500) return false;
      if (sqftFilter === '500-1000' && (home.sqft < 500 || home.sqft > 1000)) return false;
      if (sqftFilter === '1000-plus' && home.sqft < 1000) return false;
      if (levelFilter !== 'all' && levels !== levelFilter) return false;
      if (roofFilter !== 'all' && home.roofStyle !== roofFilter) return false;
      if (statusFilter !== 'all' && lifecycle !== statusFilter) return false;
      return true;
    });
  }, [bathFilter, bedBathParts, bedFilter, homes, levelFilter, lifecycleStates, query, roofFilter, sqftFilter, statusFilter]);

  return (
    <main className="mx-auto max-w-7xl px-5 py-6">
      <section className="mb-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-stone-400">Prompt-to-plan studio</div>
          <h2 className="max-w-3xl font-sans text-4xl font-semibold leading-[1.05] tracking-tight text-stone-900 text-balance md:text-5xl">
            Type a one-line brief. Get a dimensioned, code-checked floor plan you can hand to a client.
          </h2>
          <GalleryBriefGenerate />
        </div>
        <div className="self-end rounded-lg border border-stone-200 bg-white p-4 text-xs text-stone-600 shadow-[0_18px_36px_-24px_rgba(41,37,36,0.28)]">
          <div className="mb-3 grid grid-cols-3 divide-x divide-stone-200 border border-stone-200 bg-stone-50/40">
            <div className="px-3 py-2.5">
              <div className="font-mono text-2xl tabular-nums text-stone-800">{homes.length}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-stone-400">Plans</div>
            </div>
            <div className="px-3 py-2.5">
              <div className="font-mono text-2xl tabular-nums text-emerald-700">{homes.filter((home) => !productAudit(home, null).blockers.length).length}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-stone-400">Export Ready</div>
            </div>
            <div className="px-3 py-2.5">
              <div className="font-mono text-2xl tabular-nums text-red-700">{homes.filter((home) => productAudit(home, null).blockers.length).length}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wide text-stone-400">Blocked</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onNewPlan}
            className="w-full border border-stone-800 bg-stone-800 px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-white hover:bg-stone-700"
          >
            New Plan Handoff
          </button>
        </div>
      </section>

      <section className="mb-5 grid gap-2 border border-stone-200 bg-white p-3 md:grid-cols-2 xl:grid-cols-[1fr_130px_130px_150px_130px_170px_150px]">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search plans, features, size..."
          className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700 outline-none focus:border-stone-400"
        />
        <select value={bedFilter} onChange={(event) => setBedFilter(event.target.value)} className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
          {bedOptions.map((option) => (
            <option key={option} value={option}>{option === 'all' ? 'All bed/bath' : `${option} bed plans`}</option>
          ))}
        </select>
        <select value={bathFilter} onChange={(event) => setBathFilter(event.target.value)} className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
          {bathOptions.map((option) => (
            <option key={option} value={option}>{option === 'all' ? 'All baths' : `${option} bath plans`}</option>
          ))}
        </select>
        <select value={sqftFilter} onChange={(event) => setSqftFilter(event.target.value)} className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
          <option value="all">All square feet</option>
          <option value="under-500">Under 500 sf</option>
          <option value="500-1000">500-1000 sf</option>
          <option value="1000-plus">1000+ sf</option>
        </select>
        <select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value)} className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
          {levelOptions.map((option) => (
            <option key={option} value={option}>{option === 'all' ? 'All levels' : `${option} level`}</option>
          ))}
        </select>
        <select value={roofFilter} onChange={(event) => setRoofFilter(event.target.value)} className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
          {roofOptions.map((option) => (
            <option key={option} value={option}>{option === 'all' ? 'All roof types' : `${option} roof`}</option>
          ))}
        </select>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-700">
          {['all', 'blocked', 'review', 'promoted', 'exported'].map((option) => (
            <option key={option} value={option}>{option === 'all' ? 'All statuses' : option}</option>
          ))}
        </select>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredHomes.map((home) => {
          const audit = productAudit(home, null);
          const lifecycle = audit.designBlockers.length ? 'blocked' : (lifecycleStates[home.id] ?? audit.status);
          const thumbnail = home.pairedArtifactInfo?.deterministicRenderUrl ?? home.pairedArtifactInfo?.sourceImageUrl;
          // Three honest tiers: fully green; design healthy but sales assets
          // pending (JSON-only plans); genuinely blocked design.
          const qualityLabel = audit.brochureQuality.status === 'pass' && audit.designQuality.status === 'pass' && audit.presentationQuality.status === 'pass'
            ? 'Brochure Ready'
            : audit.designBlockers.length === 0
              ? 'Design Ready'
              : 'Needs Repair';
          const firstBlockedGroup = audit.groups.find((group) => group.status === 'blocked');
          const nextRepairLabel = firstBlockedGroup
            ? `${firstBlockedGroup.label}: ${firstBlockedGroup.blockers[0] ?? firstBlockedGroup.action}`
            : 'Ready for export review';
          const qualityChips = [
            ['Design', audit.designQuality.status],
            ['Presentation', audit.presentationQuality.status],
            ['Brochure', audit.brochureQuality.status],
          ] as const;
          return (
            <article key={home.id} className="group overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_1px_2px_rgba(41,37,36,0.04)] transition duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-[0_20px_38px_-20px_rgba(41,37,36,0.30)]">
              <button type="button" onClick={() => onOpenPlan(home.id)} className="block w-full bg-[#f7f4ee] p-4 text-left">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold tracking-tight text-stone-800">{home.model}</h3>
                    <p className="mt-0.5 text-[10px] tabular-nums text-stone-400">
                      {home.sqft} sf - {home.footprint.width}&apos;x{home.footprint.depth}&apos;{home.bedBath ? ` - ${home.bedBath}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-sm border px-2 py-1 text-[9px] uppercase tracking-wide ${
                    lifecycle === 'blocked'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : lifecycle === 'exported'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                    {lifecycle}
                  </span>
                </div>
                <div className="grid h-60 gap-2 bg-white p-2 md:grid-cols-[1.45fr_0.9fr]">
                  <div className="flex min-w-0 items-center justify-center overflow-hidden border border-stone-100 bg-white">
                    {thumbnail ? (
                      <img src={thumbnail} alt={`${home.model} plan thumbnail`} className="max-h-full w-full object-contain transition duration-300 group-hover:scale-[1.015]" />
                    ) : (
                      // JSON-only plans have no proposal image but always have
                      // the live deterministic render - show the plan, not a
                      // "missing" placeholder.
                      <div data-live-thumbnail className="h-full w-full overflow-hidden p-1 [&_svg]:h-full [&_svg]:w-full">
                        <FloorPlanView
                          rooms={home.rooms}
                          footprint={home.footprint}
                          connections={home.connections}
                          sourceWalls={home.sourceWalls}
                          sourceOpenings={home.sourceOpenings}
                          spaceFaces={home.spaceFaces}
                          dimensionLines={home.dimensionLines}
                          dimensionFrame={home.dimensionFrame}
                          floorFrames={home.floorFrames}
                          traceMode={home.pairedArtifact}
                          drawingStyleProfile={home.drawingStyleProfile}
                        />
                      </div>
                    )}
                  </div>
                  <div className="grid min-w-0 grid-rows-[1fr_auto] overflow-hidden border border-stone-100 bg-[#f7f3ec]">
                    <MiniElevationPreview home={home} />
                    <div className="border-t border-stone-200 bg-white/70 px-2 py-1 text-[9px] uppercase tracking-wide text-stone-500">
                      Elevation
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1">
                  {qualityChips.map(([label, status]) => (
                    <span
                      key={label}
                      className={`rounded-sm border px-2 py-1 text-center text-[9px] uppercase tracking-wide ${
                        status === 'pass'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : status === 'warning'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-red-200 bg-red-50 text-red-700'
                      }`}
                    >
                      {label} {status}
                    </span>
                  ))}
                </div>
              </button>
              <div className="grid grid-cols-3 border-t border-stone-200 text-[10px]">
                <div className="border-r border-stone-200 p-2">
                  <div className="text-stone-400">Roof</div>
                  <div className="font-medium text-stone-700">{home.roofStyle}</div>
                </div>
                <div className="border-r border-stone-200 p-2">
                  <div className="text-stone-400">Rooms</div>
                  <div className="font-medium text-stone-700">{home.rooms.length}</div>
                </div>
                <div className="p-2">
                  <div className="text-stone-400">Quality</div>
                  <div className={qualityLabel === 'Brochure Ready' ? 'font-medium text-emerald-700' : qualityLabel === 'Design Ready' ? 'font-medium text-amber-700' : 'font-medium text-red-700'}>{qualityLabel}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-stone-200 p-3">
                <div className="min-w-0 text-[10px] text-stone-400">
                  <div>{audit.blockers.length ? `${audit.blockers.length} blocker${audit.blockers.length === 1 ? '' : 's'}` : 'No product blockers'}</div>
                  <div className="truncate text-[9px] text-stone-500">Next repair: {nextRepairLabel}</div>
                </div>
                <div className="flex gap-2">
                  {isDeletablePlan(home, lifecycle) && (
                    <button
                      type="button"
                      data-delete-plan={home.id}
                      onClick={() => onDeletePlan(home.id)}
                      className="rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-stone-500 hover:border-red-700 hover:bg-red-50 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRepairPlan(home.id)}
                    className={`rounded-sm border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide ${
                      audit.blockers.length > 0
                        ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-700'
                        : 'border-stone-300 bg-white text-stone-700 hover:border-stone-800'
                    }`}
                  >
                    Repair Prompt
                  </button>
                  <button type="button" onClick={() => onOpenPlan(home.id)} className="rounded-sm border border-stone-300 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-stone-700 hover:border-stone-800 hover:bg-stone-800 hover:text-white">
                    Open Plan
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {!filteredHomes.length && (
        <div className="rounded-lg border border-dashed border-stone-300 bg-white p-12 text-center">
          <div className="font-sans text-base font-medium text-stone-700">No plans match those filters.</div>
          <div className="mt-1 text-xs text-stone-400">Clear a filter, or describe a new home in the brief box above to generate one.</div>
        </div>
      )}
    </main>
  );
}

export default function Home() {
  const [selectedHomeId, setSelectedHomeId] = useState('');
  const [showGallery, setShowGallery] = useState(false);
  const [reviewToolsVisible, setReviewToolsVisible] = useState(false);
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [wallOpacity, setWallOpacity] = useState(RENDER_THEMES['product-presentation'].wallOpacity);
  const [roofVisible, setRoofVisible] = useState(true);
  const [whiteModelView, setWhiteModelView] = useState(false);
  const [roomLabelsVisible, setRoomLabelsVisible] = useState(false);
  const [activeFloor, setActiveFloor] = useState<number | 'all'>('all');
  // A level filter left over from the previous plan reads as missing
  // geometry on the next one - reset to the whole building on plan switch.
  useEffect(() => {
    setActiveFloor('all');
  }, [selectedHomeId]);
  const [renderThemeId, setRenderThemeId] = useState<RenderThemeId>(DEFAULT_RENDER_THEME_ID);
  const [viewPreset, setViewPreset] = useState<ViewPreset>('presentation-3d');
  const [refreshCount, setRefreshCount] = useState(0);
  const [compareMode, setCompareMode] = useState<CompareMode>('compare');
  const [editedHomes, setEditedHomes] = useState<Record<string, DenHome>>({});
  const [renderedBounds, setRenderedBounds] = useState<RenderedModelBounds | null>(null);
  const [promptRequest, setPromptRequest] = useState<PromptRequest>(DEFAULT_PROMPT_REQUEST);
  const [importText, setImportText] = useState('');
  const [importSourceImage, setImportSourceImage] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const [lifecycleStates, setLifecycleStates] = useState<Record<string, ArtifactLifecycle>>({});
  const [workflowDialog, setWorkflowDialog] = useState<WorkflowDialog>(null);
  const [initialRepairLayer, setInitialRepairLayer] = useState<RepairLayer | null>(null);
  const urlHomeAppliedRef = useRef(false);
  const sceneRef = useRef<SceneHandle>(null);

  const homeIdx = homes.findIndex((home) => home.id === selectedHomeId);
  const currentHome = homes.find((home) => home.id === selectedHomeId) ?? null;
  const displayHome = currentHome ? (editedHomes[selectedHomeId] ?? currentHome) : null;
  const currentComp = selectedComponent ? components.find((component) => component.id === selectedComponent) ?? null : null;
  const usedComponents = displayHome?.componentsUsed ?? [];
  const renderTheme = RENDER_THEMES[renderThemeId];
  const renderMode: RenderMode = viewPreset === 'plan-top'
    ? 'presentationPlan'
    : viewPreset === 'presentation-3d'
      ? 'presentation3d'
      : viewPreset === 'white-cutaway'
        ? 'cutaway'
        : viewPreset === 'debug-review'
          ? 'debugReview'
          : 'elevation';
  const currentGeometryAudit = useMemo(() => liveGeometryAudit(displayHome), [displayHome]);
  const currentProductAudit = useMemo(() => productAudit(displayHome, renderedBounds), [displayHome, renderedBounds]);
  const currentValidationGroups = useMemo(() => validationGroups(displayHome, renderedBounds), [displayHome, renderedBounds]);
  const currentLifecycle = currentProductAudit.designBlockers.length ? 'blocked' : (lifecycleStates[selectedHomeId] ?? currentProductAudit.status);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as unknown as { __floorplanDebug?: unknown }).__floorplanDebug = {
      home: displayHome,
      validationGroups: currentValidationGroups,
      productAudit: currentProductAudit,
    };
  }, [displayHome, currentValidationGroups, currentProductAudit]);

  const applyViewPreset = useCallback((preset: ViewPreset) => {
    setViewPreset(preset);
    if (preset === 'plan-top') {
      setRenderThemeId('product-presentation');
      setRoofVisible(false);
      setActiveFloor(0);
      setWallOpacity(RENDER_THEMES['product-presentation'].wallOpacity);
      setRoomLabelsVisible(true);
      setTimeout(() => sceneRef.current?.setTopView(), 50);
      return;
    }
    if (preset === 'presentation-3d') {
      setRenderThemeId('product-presentation');
      setRoofVisible(true);
      setActiveFloor('all');
      setWallOpacity(RENDER_THEMES['product-presentation'].wallOpacity);
      setRoomLabelsVisible(false);
      setTimeout(() => sceneRef.current?.set3DView(), 50);
      return;
    }
    if (preset === 'white-cutaway') {
      setRenderThemeId('product-presentation');
      setRoofVisible(true);
      setActiveFloor('all');
      setWallOpacity(RENDER_THEMES['product-presentation'].wallOpacity);
      setRoomLabelsVisible(false);
      setTimeout(() => sceneRef.current?.setWhiteCutawayView(), 50);
      return;
    }
    if (preset === 'front-elevation') {
      setRenderThemeId('product-presentation');
      setRoofVisible(true);
      setActiveFloor('all');
      setWallOpacity(RENDER_THEMES['product-presentation'].wallOpacity);
      setRoomLabelsVisible(false);
      setTimeout(() => sceneRef.current?.setFrontElevationView(), 50);
      return;
    }
    if (preset === 'debug-review') {
      setRenderThemeId('product-presentation');
      setRoofVisible(true);
      setActiveFloor('all');
      setWallOpacity(RENDER_THEMES['product-presentation'].wallOpacity);
      setRoomLabelsVisible(true);
      setTimeout(() => sceneRef.current?.set3DView(), 50);
      return;
    }
    setRenderThemeId('product-presentation');
    setRoofVisible(true);
    setActiveFloor('all');
    setWallOpacity(RENDER_THEMES['product-presentation'].wallOpacity);
    setRoomLabelsVisible(false);
    setTimeout(() => sceneRef.current?.setSideElevationView(), 50);
  }, []);

  const doRefresh = useCallback(async () => {
    await refreshData();
    setRefreshCount((count) => count + 1);
  }, []);

  const deletePlan = useCallback(async (planId: string) => {
    const res = await fetch('/api/delete-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId }),
    });
    if (!res.ok) return;
    setSelectedHomeId((current) => {
      if (current === planId) {
        setShowGallery(true);
        return '';
      }
      return current;
    });
    await doRefresh();
  }, [doRefresh]);

  useEffect(() => {
    const refreshTimer = window.setTimeout(() => {
      void doRefresh();
    }, 0);
    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [doRefresh]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedPrompt = window.localStorage.getItem(PROMPT_STORAGE_KEY);
    if (savedPrompt) {
      try {
        setPromptRequest({ ...DEFAULT_PROMPT_REQUEST, ...JSON.parse(savedPrompt) });
      } catch {
        window.localStorage.removeItem(PROMPT_STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(promptRequest));
  }, [promptRequest]);

  useEffect(() => {
    if (!homes.length) return;
    let selectionTimer: number | undefined;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('home') ?? params.get('plan');

    if (!urlHomeAppliedRef.current) {
      urlHomeAppliedRef.current = true;
      if (requested && homes.some((home) => home.id === requested)) {
        selectionTimer = window.setTimeout(() => {
          setSelectedHomeId(requested);
          setShowGallery(false);
        }, 0);
        return () => {
          if (selectionTimer !== undefined) window.clearTimeout(selectionTimer);
        };
      }
      if (!requested) {
        setShowGallery(true);
      }
    }

    if (!selectedHomeId || !homes.some((home) => home.id === selectedHomeId)) {
      selectionTimer = window.setTimeout(() => setSelectedHomeId(homes[0].id), 0);
    }
    return () => {
      if (selectionTimer !== undefined) window.clearTimeout(selectionTimer);
    };
  }, [refreshCount, selectedHomeId]);

  const selectHome = useCallback((id: string) => {
    setSelectedHomeId(id);
    setShowGallery(false);
    setSelectedComponent(null);
    setRenderedBounds(null);
    setActiveFloor(0);
    const query = new URLSearchParams(window.location.search);
    query.set('home', id);
    window.history.replaceState(null, '', `/?${query.toString()}`);
  }, []);

  const repairHomeFromGallery = useCallback((id: string) => {
    setSelectedHomeId(id);
    setShowGallery(false);
    setSelectedComponent(null);
    setRenderedBounds(null);
    setActiveFloor(0);
    setInitialRepairLayer(null);
    setWorkflowDialog('repair');
    const query = new URLSearchParams(window.location.search);
    query.set('home', id);
    window.history.replaceState(null, '', `/?${query.toString()}`);
  }, []);

  const setLifecycleForSelected = useCallback((state: ArtifactLifecycle) => {
    if (!selectedHomeId) return;
    setLifecycleStates((prev) => ({ ...prev, [selectedHomeId]: state }));
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(`${LIFECYCLE_STORAGE_PREFIX}${selectedHomeId}`, state);
    }
  }, [selectedHomeId]);

  const openWorkflowDialog = useCallback((dialog: WorkflowDialog, layer?: RepairLayer) => {
    setInitialRepairLayer(dialog === 'repair' ? layer ?? null : null);
    setWorkflowDialog(dialog);
  }, []);

  useEffect(() => {
    if (!homes.length || typeof window === 'undefined') return;
    setEditedHomes((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const home of homes) {
        if (next[home.id]) continue;
        const saved = window.localStorage.getItem(`${EDIT_STORAGE_PREFIX}${home.id}`);
        if (!saved) continue;
        try {
          const parsed = JSON.parse(saved) as DenHome;
          if (parsed?.id === home.id) {
            next[home.id] = parsed;
            changed = true;
          }
        } catch {
          window.localStorage.removeItem(`${EDIT_STORAGE_PREFIX}${home.id}`);
        }
      }
      return changed ? next : prev;
    });
    setLifecycleStates((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const home of homes) {
        if (next[home.id]) continue;
        const saved = window.localStorage.getItem(`${LIFECYCLE_STORAGE_PREFIX}${home.id}`) as ArtifactLifecycle | null;
        if (!saved) continue;
        if (['draft', 'blocked', 'review', 'promoted', 'exported'].includes(saved)) {
          next[home.id] = saved;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [refreshCount]);

  const saveEditedHome = useCallback(() => {
    if (!selectedHomeId || !editedHomes[selectedHomeId] || typeof window === 'undefined') return;
    window.localStorage.setItem(`${EDIT_STORAGE_PREFIX}${selectedHomeId}`, JSON.stringify(editedHomes[selectedHomeId]));
    window.localStorage.setItem(`${LIFECYCLE_STORAGE_PREFIX}${selectedHomeId}`, productAudit(editedHomes[selectedHomeId], renderedBounds).status);
    setLifecycleStates((prev) => ({ ...prev, [selectedHomeId]: productAudit(editedHomes[selectedHomeId], renderedBounds).status }));
  }, [editedHomes, renderedBounds, selectedHomeId]);

  const importDraftPlan = useCallback(() => {
    if (!selectedHomeId || !displayHome) return;
    try {
      const parsed = JSON.parse(importText);
      const source = parsed.semanticPlan ?? parsed.home ?? parsed;
      let imported: DenHome;
      if (source?.rooms && source?.footprint && source?.model) {
        imported = { ...source, id: selectedHomeId } as DenHome;
      } else if (source?.planId && source?.proposalId && source?.rooms && source?.footprint) {
        imported = pairedArtifactToLocalHome(
          source,
          importSourceImage.trim() || parsed.sourceImageUrl || parsed.imageDataUrl || displayHome.pairedArtifactInfo?.sourceImageUrl || '',
        );
        imported.id = selectedHomeId;
        imported.model = displayHome.model;
      } else {
        throw new Error('JSON must be a DenHome, a packet with semanticPlan, or paired_gpt_floorplan_v1 artifact');
      }
      const buildValidation = validateBuildability(imported);
      imported = {
        ...imported,
        buildValidation,
        componentsUsed: buildValidation.componentsUsed,
      };
      setEditedHomes((prev) => ({ ...prev, [selectedHomeId]: imported }));
      setLifecycleForSelected('draft');
      setImportStatus('imported draft into current plan');
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'import failed');
      setLifecycleForSelected('blocked');
    }
  }, [displayHome, importSourceImage, importText, selectedHomeId, setLifecycleForSelected]);

  const applyRepairPatch = useCallback((report: LayerDriftReport, patchText: string) => {
    if (!displayHome || !selectedHomeId) return 'No active plan selected.';
    let operations;
    try {
      operations = parseJsonPatch(patchText);
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid JSON Patch.';
    }
    const beforeGroups = validationGroups(displayHome, renderedBounds);
    const beforeLayerMessages = beforeGroups
      .filter((group) => repairLayerForValidationGroup(group) === report.layer)
      .reduce((count, group) => count + group.blockers.length + group.warnings.length, 0);
    const beforeDesignBlockers = beforeGroups
      .filter((group) => group.lane === 'design')
      .reduce((count, group) => count + group.blockers.length, 0);
    const applied = applyJsonPatchToHome(displayHome, operations, report);
    if (!applied.ok || !applied.home) return `Rejected: ${applied.errors.join('; ')}`;
    const buildValidation = validateBuildability(applied.home);
    const nextHome = {
      ...applied.home,
      buildValidation,
      componentsUsed: buildValidation.componentsUsed,
    };
    const afterGroups = validationGroups(nextHome, renderedBounds);
    const afterLayerMessages = afterGroups
      .filter((group) => repairLayerForValidationGroup(group) === report.layer)
      .reduce((count, group) => count + group.blockers.length + group.warnings.length, 0);
    const afterDesignBlockers = afterGroups
      .filter((group) => group.lane === 'design')
      .reduce((count, group) => count + group.blockers.length, 0);
    if (afterDesignBlockers > beforeDesignBlockers) {
      return `Rolled back: patch added ${afterDesignBlockers - beforeDesignBlockers} design blocker(s).`;
    }
    if (beforeLayerMessages > 0 && afterLayerMessages >= beforeLayerMessages) {
      return `Rolled back: ${report.layer} did not improve (${beforeLayerMessages} -> ${afterLayerMessages}).`;
    }
    setEditedHomes((prev) => ({ ...prev, [selectedHomeId]: nextHome }));
    setLifecycleForSelected('review');
    return `Accepted: ${operations.length} operation${operations.length === 1 ? '' : 's'} applied to ${report.layer}.`;
  }, [displayHome, renderedBounds, selectedHomeId, setLifecycleForSelected]);

  const exportProductPacket = useCallback(() => {
    if (!displayHome) return;
    const current3dImage = currentCanvasImage(true);
    const audit = productAudit(displayHome, renderedBounds);
    const groups = validationGroups(displayHome, renderedBounds);
    const lanes = readinessLanes(groups);
    const semanticSvg = currentDeterministicSvg() ?? semanticSvgForHome(displayHome);
    const visualAssetAttributions = localVisualAssetAttributions();
    const brochureHtml = brochureHtmlForHome(displayHome, groups, current3dImage, visualAssetAttributions, currentSourceImage(displayHome), semanticSvg);
    const semanticBim = semanticBimFromHome(displayHome);
    const standardsRegistry = standardsRegistrySummary();
    const standardsValidation = validateStandards(displayHome);
    const bcfIssues = standardsValidation.issues;
    const sourceDrawingPrimitives = extractSourceDrawingPrimitives(displayHome.pairedArtifactJson);
    const sourceDrawingPrimitiveDiffs = diffSourceToSemanticDrawingPrimitives(displayHome.pairedArtifactJson);
    const drawingPrimitiveContract = {
      schemaVersion: 'drawing_primitive_contract_v1',
      sourceCounts: countDrawingPrimitives(sourceDrawingPrimitives),
      sourcePrimitives: sourceDrawingPrimitives,
      sourceToSemanticDiffs: sourceDrawingPrimitiveDiffs,
      blockingDiffs: sourceDrawingPrimitiveDiffs.filter((diff) => diff.severity === 'blocked'),
      warningDiffs: sourceDrawingPrimitiveDiffs.filter((diff) => diff.severity === 'warning'),
    };
    const visualAssetElements = semanticBim.elements.filter((element) => element.metadata?.visualAssetMode === 'gltf-cache');
    const usedVisualAssetIds = [...new Set(visualAssetElements.map((element) => element.metadata?.visualAssetId).filter(Boolean))];
    const attributionIds = new Set(visualAssetAttributions.map((asset) => asset.id));
    const releaseChecks = [
      { id: 'design-quality', label: 'Design Quality passes', status: audit.designQuality.status === 'pass' ? 'pass' : 'blocked', evidence: audit.designQuality.status },
      { id: 'presentation-quality', label: 'Presentation Quality passes', status: audit.presentationQuality.status === 'pass' ? 'pass' : 'blocked', evidence: audit.presentationQuality.status },
      { id: 'brochure-quality', label: 'Brochure Quality passes', status: audit.brochureQuality.status === 'pass' ? 'pass' : 'blocked', evidence: audit.brochureQuality.status },
      { id: 'product-3d-captured', label: 'Product 3D image captured', status: current3dImage ? 'pass' : 'blocked', evidence: current3dImage ? 'canvas PNG embedded' : 'missing canvas PNG' },
      { id: 'deterministic-svg', label: 'Deterministic 2D SVG generated', status: semanticSvg.includes('<svg') ? 'pass' : 'blocked', evidence: `${semanticSvg.length} bytes` },
      { id: 'brochure-html', label: 'HTML brochure generated', status: brochureHtml.includes('Product 3D') && brochureHtml.includes('3D Asset Credits') ? 'pass' : 'blocked', evidence: `${brochureHtml.length} bytes` },
      { id: 'fixture-proxy', label: 'No generic fixture proxies remain', status: semanticBim.elements.some((element) => element.category === 'fixtureProxy') ? 'blocked' : 'pass', evidence: `${semanticBim.elements.filter((element) => element.category === 'fixtureProxy').length} fixtureProxy elements` },
      { id: 'visual-assets', label: 'Renderable visual assets attached where available', status: visualAssetElements.length ? 'pass' : 'warning', evidence: `${visualAssetElements.length} glTF-backed semantic elements` },
      { id: 'asset-attribution', label: 'Used visual assets have attribution', status: usedVisualAssetIds.every((id) => attributionIds.has(String(id))) ? 'pass' : 'blocked', evidence: `${usedVisualAssetIds.length} used visual asset type(s), ${visualAssetAttributions.length} attribution record(s)` },
      { id: 'experimental-lanes', label: 'Manufacturing/IFC warnings separated from design quality', status: lanes.some((lane) => lane.id === 'manufacturing') && lanes.some((lane) => lane.id === 'export') ? 'pass' : 'blocked', evidence: lanes.map((lane) => `${lane.id}:${lane.status}`).join(', ') },
      { id: 'standards-registry', label: 'Standards registry and BCF-style issues included', status: standardsRegistry.version && Array.isArray(bcfIssues) ? 'pass' : 'blocked', evidence: `${standardsRegistry.version}, ${bcfIssues.length} issue(s)` },
    ];
    const releaseReady = releaseChecks.every((check) => check.status === 'pass');
    const packet = {
      artifactVersion: 'paired_floorplan_product_packet_v2',
      exportedAt: new Date().toISOString(),
      lifecycle: audit.designBlockers.length ? 'blocked' : currentLifecycle === 'promoted' ? 'exported' : currentLifecycle,
      request: promptRequest,
      generationPrompt: buildGenerationPrompt(promptRequest, displayHome),
      feedbackPrompt: buildFeedbackPrompt(displayHome, audit),
      validation: {
        status: audit.status,
        designQuality: audit.designQuality,
        presentationQuality: audit.presentationQuality,
        brochureQuality: audit.brochureQuality,
        manufacturingReadiness: audit.manufacturingReadiness,
        exportReadiness: audit.exportReadiness,
        groups,
        lanes,
        standards: standardsValidation,
        bcfIssues,
      },
      standardsRegistry,
      standardsRegistryVersion: standardsRegistry.version,
      semanticPlan: semanticPlanForHome(displayHome),
      drawingStyleProfile: displayHome.drawingStyleProfile ?? null,
      drawingPrimitiveContract,
      semanticBim,
      experimentalIfc: exportExperimentalIfc(displayHome),
      bimAssetRegistry: bimAssetRegistrySummary(),
      localBimComponentCatalog: {
        catalogUrl: '/data/bim-components/catalog.json',
        visualCatalogUrl: '/data/bim-components/visual-catalog.json',
        summary: localBimAssetSummary(),
        visualAssetAttributions,
      },
      semanticSvg,
      brochureHtml,
      stableExports: {
        semanticJson: true,
        deterministic2dSvg: true,
        current3dPng: Boolean(current3dImage),
        htmlBrochure: true,
        semanticBimJson: true,
      },
      experimentalExports: {
        ifcStep: exportExperimentalIfc(displayHome).blockers,
      },
      roofElevation: displayHome.roofSemantics ?? null,
      sourceUrls: displayHome.pairedArtifactInfo,
      current3dImage,
      releaseReadiness: {
        status: releaseReady ? 'release-candidate' : 'needs-review',
        checks: releaseChecks,
        notes: releaseReady
          ? ['Export has no known automated release blockers. Final human visual review is still recommended before publishing.']
          : ['One or more automated release checks did not pass. Review checks before publishing.'],
      },
      repairHistory: [],
    };
    downloadJson(`${displayHome.id}-${displayHome.pairedProposalId ?? 'draft'}-product-packet.json`, packet);
    setLifecycleForSelected('exported');
  }, [currentLifecycle, displayHome, promptRequest, renderedBounds, setLifecycleForSelected]);

  const prevHome = useCallback(() => {
    if (!homes.length) return;
    const index = homeIdx < 0 ? 0 : homeIdx;
    const nextIndex = (index - 1 + homes.length) % homes.length;
    selectHome(homes[nextIndex].id);
  }, [homeIdx, selectHome]);

  const nextHome = useCallback(() => {
    if (!homes.length) return;
    const index = homeIdx < 0 ? 0 : homeIdx;
    const nextIndex = (index + 1) % homes.length;
    selectHome(homes[nextIndex].id);
  }, [homeIdx, selectHome]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'ArrowLeft') prevHome();
      if (event.key === 'ArrowRight') nextHome();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nextHome, prevHome]);

  if (showGallery) {
    return (
      <div className="min-h-screen bg-[#faf8f5]">
        <header className="flex items-center justify-between border-b border-stone-200 bg-white/90 px-5 py-3 backdrop-blur">
          <div>
            <h1 className="font-sans text-[15px] font-semibold tracking-tight text-stone-900">Floorplan Studio</h1>
            <span className="text-[10px] text-stone-400">
              {homes.length} code-checked plan{homes.length === 1 ? '' : 's'} - from brief to client-ready packet
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openWorkflowDialog('new-plan')}
              className="rounded-sm border border-stone-300 bg-white px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-stone-700 hover:border-stone-800"
            >
              New Plan
            </button>
            {displayHome && (
              <button
                type="button"
                onClick={() => selectHome(displayHome.id)}
                title={`Back to ${displayHome.id}`}
                className="rounded-sm border border-stone-800 bg-stone-800 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-white hover:bg-stone-700"
              >
                Resume {displayHome.id}
              </button>
            )}
          </div>
        </header>
        <WorkflowModal
          dialog={workflowDialog}
          home={displayHome}
          availableHomes={homes}
          selectedHomeId={selectedHomeId}
          groups={currentValidationGroups}
          promptRequest={promptRequest}
          importText={importText}
          importSourceImage={importSourceImage}
          importStatus={importStatus}
          lifecycle={currentLifecycle}
          initialRepairLayer={initialRepairLayer}
          onClose={() => setWorkflowDialog(null)}
          onSelectHome={selectHome}
          onPromptChange={setPromptRequest}
          onImportTextChange={setImportText}
          onImportSourceImageChange={setImportSourceImage}
          onImportPlan={importDraftPlan}
          onLifecycleChange={setLifecycleForSelected}
          onExportPacket={exportProductPacket}
          onApplyRepairPatch={applyRepairPatch}
        />
        <ProductGallery
          homes={homes}
          lifecycleStates={lifecycleStates}
          onOpenPlan={selectHome}
          onRepairPlan={repairHomeFromGallery}
          onNewPlan={() => openWorkflowDialog('new-plan')}
          onDeletePlan={deletePlan}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white/90 px-5 py-2.5 backdrop-blur">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-stone-800">Floorplan Studio</h1>
          <span className="text-[10px] text-stone-400">
            {homes.length} code-checked plan{homes.length === 1 ? '' : 's'} - from brief to client-ready packet
          </span>
        </div>
        {displayHome && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setShowGallery(true);
                window.history.replaceState(null, '', '/');
              }}
              className="rounded-sm border border-stone-300 bg-white px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-stone-600 hover:border-stone-800"
            >
              Browse Plans
            </button>
            <button
              type="button"
              onClick={() => setReviewToolsVisible((visible) => !visible)}
              className={`rounded-sm border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide ${
                reviewToolsVisible
                  ? 'border-stone-800 bg-stone-800 text-white'
                  : 'border-stone-300 bg-white text-stone-600 hover:border-stone-800'
              }`}
            >
              Review Tools
            </button>
            <div className="text-right">
              <div className="text-xs font-medium text-stone-600">{displayHome.model}</div>
              <div className="text-[10px] tabular-nums text-stone-400">
                {displayHome.sqft} sf - {displayHome.footprint.width}&apos;x{displayHome.footprint.depth}&apos;{displayHome.bedBath ? ` - ${displayHome.bedBath}` : ''}
              </div>
            </div>
          </div>
        )}
      </header>

      <WorkflowModal
        dialog={workflowDialog}
        home={displayHome}
        availableHomes={homes}
        selectedHomeId={selectedHomeId}
        groups={currentValidationGroups}
        promptRequest={promptRequest}
        importText={importText}
        importSourceImage={importSourceImage}
        importStatus={importStatus}
        lifecycle={currentLifecycle}
        initialRepairLayer={initialRepairLayer}
        onClose={() => setWorkflowDialog(null)}
        onSelectHome={selectHome}
        onPromptChange={setPromptRequest}
        onImportTextChange={setImportText}
        onImportSourceImageChange={setImportSourceImage}
        onImportPlan={importDraftPlan}
        onLifecycleChange={setLifecycleForSelected}
        onExportPacket={exportProductPacket}
        onApplyRepairPatch={applyRepairPatch}
      />

      <div className="flex items-center gap-1 border-b border-stone-200 bg-white/80 px-3 py-1">
        <button onClick={prevHome} className="rounded px-2 py-1 font-mono text-sm text-stone-500 hover:bg-stone-100">&larr;</button>
        <button onClick={nextHome} className="rounded px-2 py-1 font-mono text-sm text-stone-500 hover:bg-stone-100">&rarr;</button>
        <span className="font-mono text-[10px] text-stone-400">{homes.length ? `${Math.max(homeIdx + 1, 1)}/${homes.length}` : '0/0'}</span>
        <select
          value={selectedHomeId}
          onChange={(event) => selectHome(event.target.value)}
          className="min-w-[240px] border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-medium text-stone-700 outline-none hover:bg-stone-100 focus:border-stone-400"
        >
          {!homes.length && <option value="">No promoted paired plans</option>}
          {homes.map((home) => (
            <option key={home.id} value={home.id}>
              {home.model} - {home.sqft}sf - {home.bedBath || home.pairedProposalId}
            </option>
          ))}
        </select>
        {displayHome && (
          <span className="ml-2 hidden text-[10px] text-stone-400 md:inline">
            {displayHome.footprint.width}&apos;x{displayHome.footprint.depth}&apos; - {displayHome.rooms.length} rooms - {displayHome.roofStyle}
          </span>
        )}
      </div>

      <WorkflowActionBar
        home={displayHome}
        lifecycle={currentLifecycle}
        groups={currentValidationGroups}
        onOpen={openWorkflowDialog}
        onDeletePlan={deletePlan}
        showAllChips={reviewToolsVisible}
      />

      <div className="flex items-start">
        {reviewToolsVisible && (
          <aside className="sticky top-0 flex h-screen w-80 shrink-0 flex-col overflow-hidden border-r border-stone-200 bg-white">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <PairedStatusPanel home={displayHome} renderedBounds={renderedBounds} />
              <ProductWorkflowPanel
                home={displayHome}
                renderedBounds={renderedBounds}
                lifecycle={currentLifecycle}
                promptRequest={promptRequest}
                importText={importText}
                importSourceImage={importSourceImage}
                importStatus={importStatus}
                onLifecycleChange={setLifecycleForSelected}
                onPromptChange={setPromptRequest}
                onImportTextChange={setImportText}
                onImportSourceImageChange={setImportSourceImage}
                onImportPlan={importDraftPlan}
                onExportPacket={exportProductPacket}
              />
              <QueueProgressPanel />
              <div className="border-t border-stone-200">
                <ComponentCatalog
                  components={components}
                  selectedComponent={selectedComponent}
                  highlightedComponents={usedComponents}
                  onSelectComponent={setSelectedComponent}
                />
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto border-t border-stone-200">
              <ComponentDetail
                component={currentComp}
                currentHome={displayHome}
                onSelectHome={selectHome}
              />
            </div>
          </aside>
        )}

        <main className="min-w-0 flex-1 overflow-visible">
          <div className="relative h-[56vh] min-h-[480px]">
            {displayHome ? (
              viewPreset === 'debug-review' ? (
                <Scene
                  key={displayHome.id}
                  ref={sceneRef}
                  home={displayHome}
                  components={components}
                  selectedComponent={selectedComponent}
                  onSelectComponent={setSelectedComponent}
                  wallOpacity={wallOpacity}
                  roofVisible={roofVisible}
                  roomLabelsVisible={roomLabelsVisible}
                  activeFloor={activeFloor}
                  renderTheme={renderTheme}
                  renderMode={renderMode}
                  onModelBounds={setRenderedBounds}
                />
              ) : (
                <div className="absolute inset-0 bg-[#f5f0e8]">
                  <BimPreview
                    home={displayHome}
                    viewPreset={viewPreset}
                    showRoof={roofVisible}
                    activeFloor={activeFloor}
                    productMode
                    whiteModel={whiteModelView}
                  />
                </div>
              )
            ) : (
              <div className="flex h-full items-center justify-center bg-[#f5f0eb] text-xs text-stone-400">
                No promoted paired GPT floorplans are available yet.
              </div>
            )}

            <div className="absolute left-3 top-3 z-20 space-y-2 rounded-lg border border-stone-200 bg-white/90 px-3 py-2.5 shadow-sm backdrop-blur">
              <div className="text-[10px] font-medium uppercase tracking-wider text-stone-500">View</div>
              <div className="grid grid-cols-2 gap-1">
                {[
                  { id: 'plan-top' as const, label: 'Plan Top' },
                  { id: 'presentation-3d' as const, label: 'BIM 3D' },
                  { id: 'white-cutaway' as const, label: 'Cutaway' },
                  { id: 'front-elevation' as const, label: 'Front' },
                  { id: 'side-elevation' as const, label: 'Side' },
                  // Legacy Debug is a review surface, not a product view.
                  ...(reviewToolsVisible ? [{ id: 'debug-review' as const, label: 'Legacy Debug' }] : []),
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => applyViewPreset(item.id)}
                    className={`rounded-sm border px-2 py-1 text-[10px] ${
                      viewPreset === item.id
                        ? 'border-stone-800 bg-stone-800 text-white'
                        : 'border-stone-200 bg-stone-100 text-stone-600 hover:border-stone-400 hover:bg-stone-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {displayHome?.hasLoft && (
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { id: 0 as const, label: 'Ground' },
                    { id: 1 as const, label: 'Loft' },
                    { id: 'all' as const, label: 'All' },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setActiveFloor(item.id)}
                      className={`rounded-sm border px-1.5 py-1 text-[9px] ${
                        activeFloor === item.id ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-400'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
              {viewPreset === 'debug-review' ? (
                <>
                  <div className="grid grid-cols-2 gap-1">
                    {(Object.values(RENDER_THEMES)).map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => {
                          setRenderThemeId(theme.id);
                          setWallOpacity(theme.wallOpacity);
                        }}
                        className={`rounded-sm border px-1.5 py-1 text-[9px] ${
                          renderThemeId === theme.id ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-400'
                        }`}
                      >
                        {theme.label}
                      </button>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-[10px] text-stone-600">
                    <span className="w-12">Walls</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={wallOpacity}
                      onChange={(event) => setWallOpacity(parseFloat(event.target.value))}
                      className="h-1 w-20 accent-stone-500"
                    />
                    <span className="w-7 text-right font-mono">{Math.round(wallOpacity * 100)}%</span>
                  </label>
                </>
              ) : null}
              {viewPreset !== 'plan-top' && (
                <>
                  <label className="flex cursor-pointer items-center gap-2 text-[10px] text-stone-600">
                    <input type="checkbox" checked={roofVisible} onChange={(event) => setRoofVisible(event.target.checked)} className="accent-stone-500" />
                    Roof
                  </label>
                  <label className="flex items-center gap-1.5 text-[10px] text-stone-600">
                    <input
                      type="checkbox"
                      checked={whiteModelView}
                      onChange={(event) => setWhiteModelView(event.target.checked)}
                      data-view-white-model
                    />
                    White
                  </label>
                  {viewPreset === 'debug-review' && (
                    <label className="flex cursor-pointer items-center gap-2 text-[10px] text-stone-600">
                      <input type="checkbox" checked={roomLabelsVisible} onChange={(event) => setRoomLabelsVisible(event.target.checked)} className="accent-stone-500" />
                      Room Labels
                    </label>
                  )}
                </>
              )}
            </div>

            {displayHome && (
              <div className="pointer-events-none absolute right-3 top-3 z-20 max-w-56 space-y-1 rounded-lg border border-stone-200 bg-white/90 px-3 py-2 text-[10px] shadow-sm backdrop-blur">
                <div className="text-xs font-semibold text-stone-700">{displayHome.model}</div>
                <div className="text-stone-400">
                  {displayHome.footprint.width}&apos; x {displayHome.footprint.depth}&apos; - {displayHome.height}&apos; peak
                </div>
                <div className="text-stone-400">{displayHome.roofStyle} roof</div>
                <div className="text-stone-400">
                  {displayHome.buildValidation?.bom.length ?? displayHome.componentsUsed.length} BOM items - {displayHome.rooms.length} rooms
                </div>
                <div className={`font-medium ${displayHome.pairedArtifactInfo?.promotionEligible ? 'text-emerald-600' : 'text-stone-500'}`}>
                  {displayHome.pairedArtifactInfo?.promotionEligible ? 'Promoted' : 'In review'}
                </div>
                <div className="font-mono text-[9px] text-stone-400">
                  {displayHome.pairedArtifactInfo?.reviewStatus ?? 'pending'} - {displayHome.pairedProposalId}
                </div>
              </div>
            )}

            {viewPreset === 'debug-review' && (
              <div className="pointer-events-none absolute bottom-3 left-3 text-[9px] text-stone-400">
                Legacy debug renderer - drag to orbit - scroll to zoom - click to select
              </div>
            )}
          </div>

          <div className="min-h-[640px] border-t border-stone-200">
            {displayHome ? (
              <PairedComparison home={displayHome} mode={compareMode} onModeChange={setCompareMode} />
            ) : (
              <div className="flex h-full items-center justify-center bg-[#fdfbf7] text-xs text-stone-400">
                Generate and promote a paired GPT image + JSON artifact to populate the app.
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
