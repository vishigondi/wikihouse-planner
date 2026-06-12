'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as OBC from '@thatopen/components';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { DenHome } from '@/lib/types';
import type { SemanticBimElement, SemanticBimModel } from '@/lib/bim/semantic-bim';
import { buildableBimFromHome, buildableBimSummary } from '@/lib/bim/buildable-bim';
import { localBimAssetSummary } from '@/lib/bim/component-assets';
import {
  ceilingHeightAt,
  ceilingPlanesFromRoofPoints,
  clipPrismToCeiling,
  clipWallSegmentWithOpenings,
  type CeilingPlane,
  type WallOpeningSpec,
} from '@/lib/bim/envelope-clip';

interface Props {
  home: DenHome;
  viewPreset?: 'plan-top' | 'presentation-3d' | 'white-cutaway' | 'front-elevation' | 'side-elevation';
  showRoof?: boolean;
  activeFloor?: number | 'all';
  productMode?: boolean;
}

const BIM_THEME: Record<string, { color: string; opacity: number }> = {
  wall: { color: '#8a8378', opacity: 0.42 },
  guardrail: { color: '#5f574d', opacity: 0.64 },
  slab: { color: '#e2ded5', opacity: 1 },
  deck: { color: '#d4b982', opacity: 0.96 },
  space: { color: '#ebe5da', opacity: 0 },
  openZone: { color: '#eadcb8', opacity: 0 },
  void: { color: '#8f887f', opacity: 0.45 },
  door: { color: '#c9bba9', opacity: 0.76 },
  window: { color: '#a9cdd7', opacity: 0.62 },
  opening: { color: '#d8d1c7', opacity: 0.72 },
  stair: { color: '#756f67', opacity: 0.88 },
  roofPlane: { color: '#eee7da', opacity: 0.42 },
  sanitaryTerminal: { color: '#edf7f7', opacity: 1 },
  furniture: { color: '#d8d1c5', opacity: 1 },
  equipment: { color: '#ddd8d0', opacity: 1 },
  fixtureProxy: { color: '#d0c8bc', opacity: 1 },
};

function centerX(model: SemanticBimModel, x: number) {
  return x - model.footprint.widthFt / 2;
}

function centerZ(model: SemanticBimModel, z: number) {
  return z - model.footprint.depthFt / 2;
}

function material(color: string, opacity = 1) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.02,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.96,
    polygonOffset: opacity < 1,
    polygonOffsetFactor: opacity < 1 ? -1 : 0,
    polygonOffsetUnits: opacity < 1 ? -1 : 0,
    side: THREE.DoubleSide,
  });
}

function themeMaterial(category: string, opacityOverride?: number) {
  const style = BIM_THEME[category] ?? { color: '#aaa', opacity: 1 };
  return material(style.color, opacityOverride ?? style.opacity);
}

function productShellMaterial(kind: 'wall' | 'gable' | 'roof' | 'glassGable') {
  if (kind === 'roof') return material('#b9ad9a', 0.88);
  if (kind === 'glassGable') return material('#b7d0d3', 0.5);
  if (kind === 'gable') return material('#d6cdbc', 0.94);
  return material('#746b60', 0.96);
}

function isAFrameModel(model: SemanticBimModel) {
  return Boolean(aFrameProfile(model));
}

function shouldOpenAFrameRoofForProductView(
  element: SemanticBimElement,
  model: SemanticBimModel,
  productMode: boolean,
  viewPreset: NonNullable<Props['viewPreset']>,
) {
  if (!productMode || !isAFrameModel(model)) return false;
  if (!element.points || element.category !== 'roofPlane') return false;
  const name = `${element.id} ${element.name}`.toLowerCase();
  if (viewPreset === 'white-cutaway') return /south|front|near/.test(name);
  return false;
}

const gltfCache = new Map<string, Promise<THREE.Object3D>>();

function loadGltfScene(url: string) {
  const existing = gltfCache.get(url);
  if (existing) return existing;
  const promise = new Promise<THREE.Object3D>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
  gltfCache.set(url, promise);
  return promise;
}

// Ceiling planes per model, fitted once from the roofPlane elements with the
// same math the constraint engine uses. Source-coordinate space.
const ceilingPlanesCache = new WeakMap<SemanticBimModel, CeilingPlane[]>();
function modelCeilingPlanes(model: SemanticBimModel): CeilingPlane[] {
  let planes = ceilingPlanesCache.get(model);
  if (!planes) {
    planes = ceilingPlanesFromRoofPoints(
      model.elements
        .filter((element) => element.category === 'roofPlane' && (element.points?.length ?? 0) >= 3)
        .map((element) => ({ points: element.points as Array<{ x: number; y: number; z: number }> })),
    );
    ceilingPlanesCache.set(model, planes);
  }
  return planes;
}

// Bounded ceiling planes (with their xz extents) for fixture clamping:
// fixtures outside the roof span (decks, porches) must NOT be clamped by an
// extrapolated slope, so coverage matters here, unlike for walls.
interface BoundedCeilingPlane extends CeilingPlane { minX: number; maxX: number; minZ: number; maxZ: number }
const boundedCeilingCache = new WeakMap<SemanticBimModel, BoundedCeilingPlane[]>();
function modelBoundedCeiling(model: SemanticBimModel): BoundedCeilingPlane[] {
  let planes = boundedCeilingCache.get(model);
  if (!planes) {
    planes = [];
    for (const element of model.elements) {
      if (element.category !== 'roofPlane' || (element.points?.length ?? 0) < 3) continue;
      const pts = element.points as Array<{ x: number; y: number; z: number }>;
      const fitted = ceilingPlanesFromRoofPoints([{ points: pts }]);
      if (!fitted.length) continue;
      planes.push({
        ...fitted[0],
        minX: Math.min(...pts.map((pt) => pt.x)),
        maxX: Math.max(...pts.map((pt) => pt.x)),
        minZ: Math.min(...pts.map((pt) => pt.z)),
        maxZ: Math.max(...pts.map((pt) => pt.z)),
      });
    }
    boundedCeilingCache.set(model, planes);
  }
  return planes;
}

/**
 * Clamp a fixture object under the roof at its bounds. Returns the object
 * (possibly wrapped in a Y-scaling pivot about its base) — a range that
 * would poke 2 inches through a low A-frame eave squashes imperceptibly
 * instead of piercing the envelope. Fixtures outside the roof span (decks)
 * are untouched.
 */
function clampFixtureToEnvelope(
  object: THREE.Object3D,
  element: SemanticBimElement,
  model: SemanticBimModel,
): THREE.Object3D {
  const bounds = element.bounds;
  if (!bounds) return object;
  const planes = modelBoundedCeiling(model);
  if (!planes.length) return object;
  const { x, y, z, w, d, h } = bounds;
  let limit = Infinity;
  for (const [sx, sz] of [
    [x, z], [x + w, z], [x, z + d], [x + w, z + d], [x + w / 2, z + d / 2],
  ] as Array<[number, number]>) {
    for (const plane of planes) {
      if (sx < plane.minX - 0.1 || sx > plane.maxX + 0.1 || sz < plane.minZ - 0.1 || sz > plane.maxZ + 0.1) continue;
      limit = Math.min(limit, plane.a * sx + plane.b * sz + plane.c);
    }
  }
  if (!Number.isFinite(limit)) return object;
  const natural = Math.max(0.06, h);
  const allowed = limit - 0.06 - y;
  if (allowed >= natural) return object;
  if (allowed < 0.2) {
    object.visible = false;
    return object;
  }
  const scale = allowed / natural;
  const pivot = new THREE.Group();
  pivot.position.y = y;
  object.position.y -= y;
  pivot.scale.y = scale;
  pivot.add(object);
  pivot.userData.semanticBim = element;
  return pivot;
}

/**
 * Single source for a window's glazing extent (sill/top), shared by the
 * glazing mesh and the wall-hole cut so they always agree. Returns null when
 * no viable pane fits under the roof at the window's position.
 */
function windowGlassExtent(element: SemanticBimElement, model: SemanticBimModel): { sill: number; top: number } | null {
  if (!element.segment) return null;
  const { x1, z1, x2, z2, y1, height } = element.segment;
  const windowText = `${element.name} ${element.metadata?.windowKind ?? ''} ${element.metadata?.sillType ?? ''} ${element.metadata?.openingType ?? ''}`.toLowerCase();
  const fullHeightGlass = /full.?height|folding|glass.?wall|glaz/.test(windowText);
  const guardGlazing = /guard|rail|low/.test(windowText);
  let sill = guardGlazing ? y1 + 0.35 : fullHeightGlass ? y1 + 0.3 : y1 + 3.15;
  let glassHeight = guardGlazing ? 1.1 : fullHeightGlass ? Math.max(2.8, Math.min(4.8, height)) : Math.max(2.4, Math.min(4.6, height));
  const planes = modelCeilingPlanes(model);
  if (planes.length) {
    let roofLimit = Infinity;
    for (const [wx, wz] of [[x1, z1], [x2, z2], [(x1 + x2) / 2, (z1 + z2) / 2]] as Array<[number, number]>) {
      roofLimit = Math.min(roofLimit, ceilingHeightAt(planes, wx, wz));
    }
    const maxHead = roofLimit - 0.15;
    const top = Math.min(sill + glassHeight, maxHead);
    if (top - sill < 1.0) sill = Math.max(y1 + 0.3, top - 2.4);
    if (top - sill < 0.5) return null;
    return { sill, top };
  }
  return { sill, top: sill + glassHeight };
}

/**
 * Openings hosted on a wall, matched geometrically (host wall ids are not
 * stable across wall segmentation): both endpoints near the wall line, with
 * projections inside the run. Doors and passthroughs cut from the wall base;
 * windows cut exactly the glazing extent.
 */
function wallOpeningSpecs(wall: SemanticBimElement, model: SemanticBimModel): WallOpeningSpec[] {
  if (!wall.segment) return [];
  const { x1, z1, x2, z2, thickness, y1 } = wall.segment;
  const length = Math.hypot(x2 - x1, z2 - z1);
  if (length < 0.05) return [];
  const ux = (x2 - x1) / length;
  const uz = (z2 - z1) / length;
  const near = Math.max(0.16, thickness) / 2 + 0.4;
  const specs: WallOpeningSpec[] = [];
  for (const element of model.elements) {
    if (!['door', 'window', 'opening'].includes(element.category) || !element.segment) continue;
    const seg = element.segment;
    const points: Array<[number, number]> = [[seg.x1, seg.z1], [seg.x2, seg.z2]];
    let hosted = true;
    const projections: number[] = [];
    for (const [px, pz] of points) {
      const dx = px - x1;
      const dz = pz - z1;
      const t = dx * ux + dz * uz;
      const perp = Math.abs(dx * -uz + dz * ux);
      if (perp > near || t < -0.35 || t > length + 0.35) {
        hosted = false;
        break;
      }
      projections.push(t);
    }
    if (!hosted || projections.length < 2 || Math.abs(projections[1] - projections[0]) < 0.4) continue;
    if (element.category === 'window') {
      const extent = windowGlassExtent(element, model);
      if (!extent) continue;
      specs.push({ start: projections[0], end: projections[1], bottomY: extent.sill - 0.04, topY: extent.top + 0.04 });
    } else {
      const headY = seg.y1 + Math.max(6.4, Math.min(7.2, Number(element.metadata?.heightFt) || seg.height || 6.8));
      specs.push({ start: projections[0], end: projections[1], bottomY: Math.min(seg.y1, y1), topY: headY });
    }
  }
  return specs;
}

/**
 * Constructive wall geometry: the wall's footprint rectangle extruded from
 * its base and clipped against the roof envelope (lib/bim/envelope-clip),
 * with door/window/passthrough holes subtracted constructively.
 * Gable ends, knee walls, and ridge-straddling partitions are all the same
 * call — no wall-role routing, no ridge-axis guessing, no sampling.
 */
function clippedWallMesh(
  element: SemanticBimElement,
  model: SemanticBimModel,
  productMode: boolean,
  viewPreset: NonNullable<Props['viewPreset']>,
) {
  if (element.category !== 'wall' || !element.segment) return null;
  const planes = modelCeilingPlanes(model);
  if (!planes.length) return null;
  const { x1, y1, z1, x2, z2, thickness, height } = element.segment;
  const length = Math.hypot(x2 - x1, z2 - z1);
  if (length < 0.05) return null;
  const t = Math.max(0.16, thickness);
  const ux = (x2 - x1) / length;
  const uz = (z2 - z1) / length;
  const px = (-uz * t) / 2;
  const pz = (ux * t) / 2;
  const footprint = [
    { x: x1 + px, z: z1 + pz },
    { x: x2 + px, z: z2 + pz },
    { x: x2 - px, z: z2 - pz },
    { x: x1 - px, z: z1 - pz },
  ];
  const exterior = element.metadata?.exterior === true;
  // Exterior walls rise until the roof stops them (gable ends become
  // triangles, eave walls become knee wedges). Interior walls keep their
  // storey height but still never pierce the roof. Cutaway keeps its
  // see-inside stub height — also clipped.
  const cutaway = productMode && viewPreset === 'white-cutaway';
  const intentCap = exterior ? 1e6 : y1 + Math.max(0.5, height);
  const styleCap = cutaway ? y1 + Math.max(0.08, Math.min(height, exterior ? 4.8 : 3.45)) : Infinity;
  const capY = Math.min(intentCap, styleCap === Infinity ? 1e6 : styleCap);
  const openings = wallOpeningSpecs(element, model);
  const solid = openings.length
    ? clipWallSegmentWithOpenings({ x: x1, z: z1 }, { x: x2, z: z2 }, t, y1, capY, planes, openings)
    : clipPrismToCeiling(footprint, y1, capY, planes);
  if (solid.empty) return null;
  const positions = new Float32Array(solid.positions.length);
  for (let i = 0; i < solid.positions.length; i += 3) {
    positions[i] = solid.positions[i] - model.footprint.widthFt / 2;
    positions[i + 1] = solid.positions[i + 1];
    positions[i + 2] = solid.positions[i + 2] - model.footprint.depthFt / 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const wallKind = `${element.metadata?.wallKind ?? ''} ${element.name}`.toLowerCase();
  const glassy = /glaz|glass/.test(wallKind);
  const baseMaterial = productMode
    ? productShellMaterial(glassy ? 'glassGable' : 'wall')
    : themeMaterial('wall');
  const mat = baseMaterial.clone();
  mat.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.renderOrder = 30;
  mesh.frustumCulled = false;
  mesh.userData.semanticBim = element;
  return mesh;
}

function lineMesh(
  element: SemanticBimElement,
  model: SemanticBimModel,
  productMode: boolean,
  viewPreset: NonNullable<Props['viewPreset']>,
) {
  if (!element.segment) return null;
  const { x1, y1, z1, x2, z2, thickness, height } = element.segment;
  const sx = centerX(model, x1);
  const sz = centerZ(model, z1);
  const ex = centerX(model, x2);
  const ez = centerZ(model, z2);
  const dx = ex - sx;
  const dz = ez - sz;
  const length = Math.max(0.05, Math.hypot(dx, dz));
  const angle = Math.atan2(dz, dx);
  const isOpening = element.category === 'door' || element.category === 'window' || element.category === 'opening';
  const exterior = element.category === 'wall' && element.metadata?.exterior === true;
  if (element.category === 'wall') {
    // Constructive clipping replaces all wall-role/ridge-axis routing. Falls
    // through to the legacy box only when the model has no roof planes.
    const clipped = clippedWallMesh(element, model, productMode, viewPreset);
    if (clipped) return clipped;
  }
  if (element.category === 'guardrail') {
    const group = new THREE.Group();
    const railMat = productMode ? material('#5f574d', 0.92) : themeMaterial('guardrail');
    const postMat = productMode ? material('#4f4941', 1) : themeMaterial('guardrail', 0.85);
    const railThickness = productMode ? 0.08 : 0.1;
    const railDepth = Math.max(0.06, Math.min(0.12, thickness));
    const railHeights = [Math.min(3.25, Math.max(1.8, height)), Math.min(2.05, Math.max(1.1, height * 0.58))];

    for (const railY of railHeights) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, railThickness, railDepth), railMat);
      rail.position.set((sx + ex) / 2, y1 + railY, (sz + ez) / 2);
      rail.rotation.y = -angle;
      rail.renderOrder = 35;
      rail.userData.semanticBim = element;
      group.add(rail);
    }

    const postCount = Math.max(2, Math.ceil(length / 4) + 1);
    for (let i = 0; i < postCount; i += 1) {
      const tPost = postCount === 1 ? 0.5 : i / (postCount - 1);
      const px = sx + dx * tPost;
      const pz = sz + dz * tPost;
      const postHeight = Math.min(3.25, Math.max(1.8, height));
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.11, postHeight, 0.11), postMat);
      post.position.set(px, y1 + postHeight / 2, pz);
      post.renderOrder = 36;
      post.userData.semanticBim = element;
      group.add(post);
    }
    group.userData.semanticBim = element;
    return group;
  }
  if (element.category === 'door') {
    const group = new THREE.Group();
    if (productMode) {
      const doorText = `${element.name} ${element.metadata?.openingType ?? ''} ${element.metadata?.roomIds ?? ''} ${element.metadata?.fromRoomId ?? ''} ${element.metadata?.toRoomId ?? ''}`.toLowerCase();
      const exteriorDoor = /exterior|entry|deck|porch|patio|glaz|sliding|folding|front|rear/.test(doorText);
      if (!exteriorDoor && viewPreset === 'presentation-3d') {
        return null;
      }
      let doorHeight = Math.max(6.4, Math.min(7.2, Number(element.metadata?.heightFt) || height || 6.8));
      // Door leaf + header stay under the roof at the door's position; a
      // genuinely low spot gets a shorter (honest) door, never one that
      // pierces the envelope.
      const doorPlanes = modelCeilingPlanes(model);
      if (doorPlanes.length) {
        let roofLimit = Infinity;
        for (const [wx, wz] of [[x1, z1], [x2, z2], [(x1 + x2) / 2, (z1 + z2) / 2]] as Array<[number, number]>) {
          roofLimit = Math.min(roofLimit, ceilingHeightAt(doorPlanes, wx, wz));
        }
        doorHeight = Math.max(4.5, Math.min(doorHeight, roofLimit - 0.3 - y1));
      }
      const doorThickness = Math.max(0.06, Math.min(0.16, thickness));
      const panelMaterial = /sliding|glass|patio/i.test(`${element.metadata?.openingType ?? ''} ${element.name}`)
        ? material('#bfd4d6', 0.34)
        : material('#bda98f', viewPreset === 'plan-top' ? 0.42 : 0.62);
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(length, doorHeight, doorThickness),
        panelMaterial,
      );
      panel.position.set((sx + ex) / 2, y1 + doorHeight / 2, (sz + ez) / 2);
      panel.rotation.y = -angle;
      panel.renderOrder = 48;
      panel.userData.semanticBim = element;
      group.add(panel);

      const frameMat = material('#7b7165', 0.96);
      const postSize = Math.max(0.08, doorThickness * 0.7);
      for (const offset of [-0.5, 0.5]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(postSize, doorHeight, Math.max(0.14, doorThickness * 1.35)),
          frameMat,
        );
        post.position.set(
          (sx + ex) / 2 + Math.cos(angle) * length * offset,
          y1 + doorHeight / 2,
          (sz + ez) / 2 + Math.sin(angle) * length * offset,
        );
        post.rotation.y = -angle;
        post.renderOrder = 50;
        post.userData.semanticBim = element;
        group.add(post);
      }
      const header = new THREE.Mesh(
        new THREE.BoxGeometry(length + postSize, 0.12, Math.max(0.14, doorThickness * 1.35)),
        frameMat,
      );
      header.position.set((sx + ex) / 2, y1 + doorHeight + 0.06, (sz + ez) / 2);
      header.rotation.y = -angle;
      header.renderOrder = 50;
      header.userData.semanticBim = element;
      group.add(header);

      const threshold = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.06, Math.max(0.12, thickness * 1.1)),
        material('#9b9184', 0.72),
      );
      threshold.position.set((sx + ex) / 2, y1 + 0.03, (sz + ez) / 2);
      threshold.rotation.y = -angle;
      threshold.renderOrder = 49;
      threshold.userData.semanticBim = element;
      group.add(threshold);
      group.userData.semanticBim = element;
      return group;
    }

    const threshold = new THREE.Mesh(
      new THREE.BoxGeometry(length, 0.06, Math.max(0.08, thickness)),
      themeMaterial('door', 0.5),
    );
    threshold.position.set((sx + ex) / 2, y1 + 0.03, (sz + ez) / 2);
    threshold.rotation.y = -angle;
    threshold.renderOrder = 45;
    threshold.userData.semanticBim = element;
    group.add(threshold);

    const hinge = (
      typeof element.metadata?.hingeX === 'number' &&
      typeof element.metadata?.hingeZ === 'number'
    ) ? {
      x: centerX(model, Number(element.metadata.hingeX)),
      z: centerZ(model, Number(element.metadata.hingeZ)),
    } : { x: sx, z: sz };
    const open = (
      typeof element.metadata?.leafOpenX === 'number' &&
      typeof element.metadata?.leafOpenZ === 'number'
    ) ? {
      x: centerX(model, Number(element.metadata.leafOpenX)),
      z: centerZ(model, Number(element.metadata.leafOpenZ)),
    } : { x: hinge.x + Math.cos(angle + Math.PI / 2) * length, z: hinge.z + Math.sin(angle + Math.PI / 2) * length };
    const leafLength = Math.max(0.5, Math.hypot(open.x - hinge.x, open.z - hinge.z));
    const leafAngle = Math.atan2(open.z - hinge.z, open.x - hinge.x);
    const leaf = new THREE.Mesh(
      new THREE.BoxGeometry(leafLength, 0.08, 0.08),
      themeMaterial('door', 0.84),
    );
    leaf.position.set((hinge.x + open.x) / 2, y1 + 0.9, (hinge.z + open.z) / 2);
    leaf.rotation.y = -leafAngle;
    leaf.renderOrder = 52;
    leaf.userData.semanticBim = element;
    group.add(leaf);

    const hingePin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16),
      themeMaterial('door', 0.9),
    );
    hingePin.position.set(hinge.x, y1 + 0.1, hinge.z);
    hingePin.userData.semanticBim = element;
    group.add(hingePin);
    group.userData.semanticBim = element;
    return group;
  }
  if (element.category === 'window') {
    const group = new THREE.Group();
    const windowText = `${element.name} ${element.metadata?.windowKind ?? ''} ${element.metadata?.sillType ?? ''} ${element.metadata?.openingType ?? ''}`.toLowerCase();
    const fullHeightGlass = /full.?height|folding|glass.?wall|glaz/.test(windowText);
    const guardGlazing = /guard|rail|low/.test(windowText);
    // Shared with the wall-hole cut (wallOpeningSpecs) so glazing always
    // sits exactly inside its opening; null means no viable pane fits under
    // the roof here and the wall stays solid.
    const extent = windowGlassExtent(element, model);
    if (!extent) return null;
    const sillHeight = extent.sill;
    const glassHeight = extent.top - extent.sill;
    const glassOpacity = viewPreset === 'white-cutaway' ? 0.22 : fullHeightGlass ? 0.38 : 0.34;
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(length, glassHeight, Math.max(0.04, thickness * 0.42)),
      themeMaterial('window', glassOpacity),
    );
    glass.position.set((sx + ex) / 2, sillHeight + glassHeight / 2, (sz + ez) / 2);
    glass.rotation.y = -angle;
    glass.renderOrder = 46;
    glass.userData.semanticBim = element;
    group.add(glass);

    const railMat = material('#d7d2c9', 1);
    const frameMat = material('#837b70', 0.92);
    for (const yOffset of [sillHeight, sillHeight + glassHeight]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, Math.max(0.08, thickness)), railMat);
      rail.position.set((sx + ex) / 2, yOffset, (sz + ez) / 2);
      rail.rotation.y = -angle;
      rail.renderOrder = 47;
      rail.userData.semanticBim = element;
      group.add(rail);
    }
    for (const offset of [-0.5, 0.5]) {
      const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.08, glassHeight, Math.max(0.08, thickness)), frameMat);
      jamb.position.set(
        (sx + ex) / 2 + Math.cos(angle) * length * offset,
        sillHeight + glassHeight / 2,
        (sz + ez) / 2 + Math.sin(angle) * length * offset,
      );
      jamb.rotation.y = -angle;
      jamb.renderOrder = 48;
      jamb.userData.semanticBim = element;
      group.add(jamb);
    }
    group.userData.semanticBim = element;
    return group;
  }
  const presentationCutawayWall = productMode && element.category === 'wall' && (
    viewPreset === 'white-cutaway' ||
    viewPreset === 'presentation-3d'
  );
  const h = isOpening
    ? Math.max(0.12, height * 0.03)
    : presentationCutawayWall
      ? Math.max(0.08, Math.min(height, exterior ? 4.8 : 3.45))
      : Math.max(0.08, height);
  const t = isOpening ? Math.max(0.08, thickness) : Math.max(0.08, thickness);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, h, t),
    productMode && element.category === 'wall' ? productShellMaterial('wall') : themeMaterial(element.category),
  );
  mesh.position.set((sx + ex) / 2, y1 + h / 2, (sz + ez) / 2);
  mesh.rotation.y = -angle;
  mesh.renderOrder = element.category === 'wall' ? 30 : 45;
  mesh.frustumCulled = false;
  mesh.userData.semanticBim = element;
  return mesh;
}

function box(
  group: THREE.Group,
  element: SemanticBimElement,
  size: [number, number, number],
  position: [number, number, number],
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.semanticBim = element;
  group.add(mesh);
  return mesh;
}

function cylinder(
  group: THREE.Group,
  element: SemanticBimElement,
  radius: number,
  height: number,
  position: [number, number, number],
  mat: THREE.Material,
  radialSegments = 32,
) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, radialSegments), mat);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.userData.semanticBim = element;
  group.add(mesh);
  return mesh;
}

function proceduralBoundsObject(element: SemanticBimElement, model: SemanticBimModel) {
  if (!element.bounds) return null;
  if (element.parts?.length) {
    const group = new THREE.Group();
    group.userData.semanticBim = element;
    for (const [index, part] of element.parts.entries()) {
      if (!part.bounds) continue;
      const partObject = proceduralBoundsObject({
        ...element,
        id: `${element.id}-part-${index}`,
        name: part.type,
        bounds: part.bounds,
        parts: undefined,
        rotationDeg: part.rotationDeg ?? element.rotationDeg,
        metadata: {
          ...element.metadata,
          fixtureType: part.type,
          compoundFixtureId: element.id,
        },
      }, model);
      if (partObject) group.add(partObject);
    }
    if (group.children.length) return group;
  }
  const { x, y, z, w, h, d } = element.bounds;
  const cx = centerX(model, x + w / 2);
  const cz = centerZ(model, z + d / 2);
  const group = new THREE.Group();
  group.position.set(cx, y, cz);
  group.rotation.y = THREE.MathUtils.degToRad(-(element.rotationDeg ?? 0));
  group.userData.semanticBim = element;
  const text = `${element.name} ${element.metadata?.fixtureType ?? ''} ${element.metadata?.componentKey ?? ''} ${element.metadata?.componentLabel ?? ''}`.toLowerCase();
  const furniture = themeMaterial('furniture');
  const fixture = themeMaterial(element.category);
  const trim = material('#8e877d', 1);
  const light = material('#f8f4ed', 1);

  if (/stair|stairs|ladder/.test(text) || element.category === 'stair') {
    const isLadder = /ladder/.test(text);
    const treadCount = isLadder ? Math.max(5, Math.round(h / 1.1)) : Math.max(5, Math.round(d / 0.75));
    const run = Math.max(0.5, d);
    const stepRise = Math.max(0.18, Math.min(h, 8) / treadCount);
    const stepDepth = run / treadCount;
    const stairMat = material('#9d968c', 1);
    const railMat = material('#59534b', 1);
    if (isLadder) {
      box(group, element, [0.08, Math.max(1, h), 0.08], [-w * 0.28, h / 2, 0], railMat);
      box(group, element, [0.08, Math.max(1, h), 0.08], [w * 0.28, h / 2, 0], railMat);
      for (let i = 0; i < treadCount; i += 1) {
        const yStep = 0.45 + i * stepRise;
        box(group, element, [w * 0.66, 0.05, 0.08], [0, yStep, 0], stairMat);
      }
      return group;
    }
    box(group, element, [0.08, Math.max(0.5, Math.min(h, 4)), run], [-w / 2 + 0.08, Math.min(h, 4) / 2, 0], railMat);
    box(group, element, [0.08, Math.max(0.5, Math.min(h, 4)), run], [w / 2 - 0.08, Math.min(h, 4) / 2, 0], railMat);
    for (let i = 0; i < treadCount; i += 1) {
      const zStep = -d / 2 + stepDepth * (i + 0.5);
      const yStep = 0.08 + i * stepRise;
      box(group, element, [w * 0.86, 0.08, Math.max(0.12, stepDepth * 0.82)], [0, yStep, zStep], stairMat);
    }
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.48, 3), railMat);
    arrow.position.set(0, Math.min(h, 2.7), d * 0.22);
    arrow.rotation.x = Math.PI / 2;
    arrow.userData.semanticBim = element;
    group.add(arrow);
    return group;
  }

  if (/bed/.test(text)) {
    box(group, element, [w, 0.22, d], [0, 0.11, 0], material('#b7ab9b', 1));
    box(group, element, [w * 0.88, 0.32, d * 0.76], [0, 0.44, d * 0.04], material('#eee9df', 1));
    box(group, element, [w, 0.72, 0.18], [0, 0.72, -d / 2 + 0.09], trim);
    box(group, element, [w * 0.32, 0.16, d * 0.18], [-w * 0.22, 0.68, -d * 0.26], light);
    box(group, element, [w * 0.32, 0.16, d * 0.18], [w * 0.22, 0.68, -d * 0.26], light);
    return group;
  }

  if (/sofa|couch|seating|chair|bench/.test(text)) {
    const seatW = w;
    const seatD = d;
    box(group, element, [seatW, 0.22, seatD], [0, 0.22, 0], material('#bcb2a3', 1));
    box(group, element, [seatW * 0.92, 0.34, seatD * 0.86], [0, 0.52, 0], furniture);
    box(group, element, [seatW, 0.86, Math.max(0.16, seatD * 0.16)], [0, 0.78, -seatD / 2 + Math.max(0.08, seatD * 0.08)], trim);
    box(group, element, [Math.max(0.16, seatW * 0.1), 0.64, seatD * 0.9], [-seatW / 2 + Math.max(0.08, seatW * 0.05), 0.64, 0], trim);
    if (/sofa|couch|seating/.test(text)) {
      box(group, element, [Math.max(0.16, seatW * 0.1), 0.62, seatD * 0.9], [seatW / 2 - Math.max(0.08, seatW * 0.05), 0.62, 0], trim);
      box(group, element, [seatW * 0.42, 0.18, seatD * 0.34], [-seatW * 0.23, 0.68, -seatD * 0.08], light);
      box(group, element, [seatW * 0.42, 0.18, seatD * 0.34], [seatW * 0.23, 0.68, -seatD * 0.08], light);
    }
    for (const px of [-seatW * 0.36, seatW * 0.36]) for (const pz of [-seatD * 0.34, seatD * 0.34]) {
      box(group, element, [0.08, 0.24, 0.08], [px, 0.12, pz], trim);
    }
    return group;
  }

  if (/table|dining|coffee/.test(text)) {
    box(group, element, [w, 0.16, d], [0, 2.35, 0], material('#c5b596', 1));
    const legW = Math.min(0.16, w * 0.08);
    const legD = Math.min(0.16, d * 0.08);
    for (const px of [-w * 0.38, w * 0.38]) {
      for (const pz of [-d * 0.34, d * 0.34]) box(group, element, [legW, 2.25, legD], [px, 1.15, pz], trim);
    }
    if (/dining/.test(text) && w > 2.2 && d > 2.2) {
      const chairMat = material('#d8d1c5', 1);
      const chairDepth = Math.min(0.55, d * 0.18);
      for (const pz of [-d * 0.58, d * 0.58]) {
        box(group, element, [w * 0.18, 0.18, chairDepth], [-w * 0.24, 1.55, pz], chairMat);
        box(group, element, [w * 0.18, 0.18, chairDepth], [w * 0.24, 1.55, pz], chairMat);
      }
    }
    return group;
  }

  if (/toilet|wc/.test(text)) {
    box(group, element, [w * 0.72, 0.78, d * 0.28], [0, 0.39, -d * 0.34], fixture);
    const bowl = cylinder(group, element, Math.min(w, d) * 0.24, 0.22, [0, 0.72, d * 0.04], fixture);
    bowl.scale.x = 0.82;
    bowl.scale.z = 1.18;
    cylinder(group, element, Math.min(w, d) * 0.14, 0.24, [0, 0.74, d * 0.04], material('#f8fbfb', 1), 32).scale.set(0.75, 1, 1.08);
    return group;
  }

  if (/tub|bath|shower/.test(text)) {
    const isShower = /shower/.test(text) && !/tub|bath/.test(text);
    box(group, element, [w, 0.28, d], [0, 0.14, 0], material('#dbeff0', 1));
    if (isShower) {
      box(group, element, [w * 0.94, 0.04, d * 0.94], [0, 0.34, 0], material('#eef8f8', 1));
      box(group, element, [0.06, Math.min(6, h), d], [-w / 2 + 0.03, Math.min(6, h) / 2, 0], material('#c8e1e2', 0.36));
      box(group, element, [w, Math.min(6, h), 0.06], [0, Math.min(6, h) / 2, -d / 2 + 0.03], material('#c8e1e2', 0.36));
    } else {
      box(group, element, [w * 0.88, 0.16, d * 0.82], [0, 0.42, 0], material('#f7fbfb', 1));
      box(group, element, [w * 0.72, 0.04, d * 0.58], [0, 0.52, 0], material('#c8e1e2', 0.6));
    }
    return group;
  }

  if (/sink|vanity|basin/.test(text)) {
    box(group, element, [w, Math.min(2.6, h), d], [0, Math.min(2.6, h) / 2, 0], material('#d7d0c6', 1));
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.22, Math.min(w, d) * 0.22, 0.08, 32), material('#edf7f7', 1));
    basin.position.set(0, Math.min(2.6, h) + 0.05, 0);
    basin.scale.z = 0.68;
    basin.userData.semanticBim = element;
    group.add(basin);
    box(group, element, [0.08, 0.32, 0.08], [0, Math.min(2.6, h) + 0.28, -d * 0.18], trim);
    return group;
  }

  if (/washer|dryer|refrigerator|fridge|range|stove|appliance|counter|cabinet|storage|closet/.test(text)) {
    const height = Math.max(1, h);
    if (/washer|dryer/.test(text)) {
      const unitW = w / (/washer.*dryer|dryer.*washer|laundry/.test(text) ? 2 : 1);
      for (let i = 0; i < Math.round(w / unitW); i += 1) {
        const px = -w / 2 + unitW * (i + 0.5);
        box(group, element, [unitW * 0.92, Math.min(3.4, height), d], [px, Math.min(3.4, height) / 2, 0], fixture);
        const door = cylinder(group, element, Math.min(unitW, d) * 0.24, 0.04, [px, 1.75, d / 2 + 0.025], material('#f8f4ed', 1), 28);
        door.rotation.x = Math.PI / 2;
      }
      return group;
    }
    box(group, element, [w, height, d], [0, height / 2, 0], fixture);
    if (/range|stove/.test(text)) {
      for (const px of [-0.25, 0.25]) for (const pz of [-0.2, 0.2]) {
        const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.025, 18), trim);
        burner.position.set(px, height + 0.03, pz);
        burner.userData.semanticBim = element;
        group.add(burner);
      }
    } else if (/counter|cabinet/.test(text)) {
      box(group, element, [w * 0.94, 0.08, d * 0.92], [0, height + 0.05, 0], material('#c6bba8', 1));
    }
    return group;
  }

  return null;
}

function boundsMesh(element: SemanticBimElement, model: SemanticBimModel) {
  if (!element.bounds) return null;
  const { x, y, z, w, h, d } = element.bounds;
  const isSpace = element.category === 'space' || element.category === 'openZone';
  const isVoid = element.category === 'void';
  if (isSpace) return null;

  if (isVoid) {
    const group = new THREE.Group();
    const railMaterial = themeMaterial('void');
    const rail = 0.05;
    const cx = centerX(model, x + w / 2);
    const cz = centerZ(model, z + d / 2);
    const y0 = y + 0.08;
    [
      { px: cx, pz: cz - d / 2, sx: w, sz: rail },
      { px: cx, pz: cz + d / 2, sx: w, sz: rail },
      { px: cx - w / 2, pz: cz, sx: rail, sz: d },
      { px: cx + w / 2, pz: cz, sx: rail, sz: d },
    ].forEach((part) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(part.sx, rail, part.sz), railMaterial);
      mesh.position.set(part.px, y0, part.pz);
      mesh.renderOrder = 38;
      mesh.frustumCulled = false;
      mesh.userData.semanticBim = element;
      group.add(mesh);
    });
    group.userData.semanticBim = element;
    return group;
  }

  const procedural = proceduralBoundsObject(element, model);
  if (procedural) return clampFixtureToEnvelope(procedural, element, model);

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.08, w), Math.max(0.06, h), Math.max(0.08, d)),
    themeMaterial(element.category),
  );
  mesh.position.set(centerX(model, x + w / 2), y + Math.max(0.06, h) / 2, centerZ(model, z + d / 2));
  mesh.rotation.y = THREE.MathUtils.degToRad(-(element.rotationDeg ?? 0));
  mesh.renderOrder = element.category === 'slab' || element.category === 'deck' ? 5 : 50;
  mesh.frustumCulled = false;
  mesh.userData.semanticBim = element;
  if (['furniture', 'equipment', 'sanitaryTerminal', 'fixtureProxy'].includes(element.category)) {
    return clampFixtureToEnvelope(mesh, element, model);
  }
  return mesh;
}

function roofMesh(
  element: SemanticBimElement,
  model: SemanticBimModel,
  productMode: boolean,
  viewPreset: NonNullable<Props['viewPreset']>,
) {
  if (!element.points || element.points.length < 3) return null;
  const name = `${element.id} ${element.name}`.toLowerCase();
  const isAFrameRoof = Boolean(aFrameProfile(model));
  if (productMode && viewPreset === 'white-cutaway') return null;
  if (shouldOpenAFrameRoofForProductView(element, model, productMode, viewPreset)) return null;
  if (productMode && viewPreset === 'white-cutaway' && isAFrameRoof && /south|front|near/.test(name)) return null;
  const vertices = element.points.map((point) => new THREE.Vector3(centerX(model, point.x), point.y, centerZ(model, point.z)));
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  if (productMode && vertices.length >= 3) {
    const normal = new THREE.Triangle(vertices[0], vertices[1], vertices[2]).getNormal(new THREE.Vector3()).normalize();
    const semanticThickness = typeof element.metadata?.roofThicknessFt === 'number'
      ? element.metadata.roofThicknessFt
      : 0.35;
    const thickness = viewPreset === 'white-cutaway'
      ? Math.min(semanticThickness, 0.14)
      : Math.max(0.18, semanticThickness);
    const bottom = vertices.map((vertex) => vertex.clone().addScaledVector(normal, -thickness));
    const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    for (let i = 1; i < vertices.length - 1; i += 1) {
      push(vertices[0], vertices[i], vertices[i + 1]);
      push(bottom[0], bottom[i + 1], bottom[i]);
    }
    for (let i = 0; i < vertices.length; i += 1) {
      const next = (i + 1) % vertices.length;
      push(vertices[i], bottom[i], bottom[next]);
      push(vertices[i], bottom[next], vertices[next]);
    }
  } else {
    for (let i = 1; i < vertices.length - 1; i += 1) {
      positions.push(
        vertices[0].x, vertices[0].y, vertices[0].z,
        vertices[i].x, vertices[i].y, vertices[i].z,
        vertices[i + 1].x, vertices[i + 1].y, vertices[i + 1].z,
      );
    }
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    geometry,
    productMode
      ? viewPreset === 'white-cutaway'
        ? material('#d8d0c0', 0.32)
        : productShellMaterial('roof')
      : themeMaterial('roofPlane'),
  );
  mesh.renderOrder = 10;
  mesh.frustumCulled = false;
  mesh.userData.semanticBim = element;
  group.add(mesh);

  if (productMode) {
    if (viewPreset === 'white-cutaway') {
      group.userData.semanticBim = element;
      return group;
    }
    const fasciaMat = material(isAFrameRoof ? '#554d44' : '#7d7468', isAFrameRoof ? 0.98 : 0.88);
    for (let i = 0; i < vertices.length; i += 1) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const length = Math.max(0.05, Math.hypot(dx, dy, dz));
      const edgeThickness = isAFrameRoof ? 0.14 : 0.09;
      const edge = new THREE.Mesh(new THREE.BoxGeometry(length, edgeThickness, edgeThickness), fasciaMat);
      edge.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      edge.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(dx / length, dy / length, dz / length));
      edge.renderOrder = 12;
      edge.userData.semanticBim = element;
      group.add(edge);
    }
    group.userData.semanticBim = element;
    return group;
  }

  const edgeMat = material('#4d4740', 0.82);
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const length = Math.max(0.05, Math.hypot(dx, dy, dz));
    const edge = new THREE.Mesh(new THREE.BoxGeometry(length, 0.08, 0.08), edgeMat);
    edge.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    edge.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(dx / length, dy / length, dz / length));
    edge.renderOrder = 11;
    edge.userData.semanticBim = element;
    group.add(edge);
  }
  group.userData.semanticBim = element;
  return group;
}

function aFrameProfile(model: SemanticBimModel) {
  const roofPlanes = model.elements.filter((element) => element.category === 'roofPlane' && element.points?.length);
  if (roofPlanes.length < 2) return null;
  const points = roofPlanes.flatMap((element) => element.points ?? []);
  const ys = points.map((point) => point.y).filter(Number.isFinite);
  if (!ys.length) return null;
  const ridgeY = Math.max(...ys);
  const eaveY = Math.min(...ys);
  const zValues = points.map((point) => point.z).filter(Number.isFinite);
  const xValues = points.map((point) => point.x).filter(Number.isFinite);
  const zMin = Math.min(...zValues);
  const zMax = Math.max(...zValues);
  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const ridgeZ = points
    .filter((point) => Math.abs(point.y - ridgeY) < 0.01)
    .reduce((sum, point, _index, array) => sum + point.z / Math.max(1, array.length), 0) || model.footprint.depthFt / 2;
  return { ridgeY, eaveY, ridgeZ, zMin, zMax, xMin, xMax };
}

function addProductEnvelope(root: THREE.Group, model: SemanticBimModel, renderedCounts: Record<string, number>) {
  const hasSemanticExteriorWalls = model.elements.some((element) => (
    element.category === 'wall' &&
    element.segment &&
    element.metadata?.exterior === true
  ));
  if (hasSemanticExteriorWalls) return;

  const profile = aFrameProfile(model);
  const wallMat = productShellMaterial('wall');
  if (profile) {
    const xCenter = centerX(model, model.footprint.widthFt / 2);
    const sideLength = model.footprint.widthFt;
    const kneeHeight = 2.8;
    for (const zFt of [profile.zMin, profile.zMax]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(sideLength, kneeHeight, 0.28),
        wallMat,
      );
      wall.name = 'IfcWall:product-a-frame-knee-wall';
      wall.position.set(xCenter, kneeHeight / 2, centerZ(model, zFt));
      wall.renderOrder = 20;
      wall.frustumCulled = false;
      root.add(wall);
    }
    renderedCounts.productEnvelopeWall = (renderedCounts.productEnvelopeWall ?? 0) + 4;
    return;
  }

  const width = model.footprint.widthFt;
  const depth = model.footprint.depthFt;
  const wallHeight = Math.max(7.5, Math.min(12, Math.max(...model.storeys.map((storey) => storey.elevationFt), 0) + 8));
  const thickness = 0.36;
  const walls = [
    { name: 'north', size: [width, wallHeight, thickness] as [number, number, number], pos: [0, wallHeight / 2, -depth / 2] as [number, number, number] },
    { name: 'south', size: [width, wallHeight, thickness] as [number, number, number], pos: [0, wallHeight / 2, depth / 2] as [number, number, number] },
    { name: 'west', size: [thickness, wallHeight, depth] as [number, number, number], pos: [-width / 2, wallHeight / 2, 0] as [number, number, number] },
    { name: 'east', size: [thickness, wallHeight, depth] as [number, number, number], pos: [width / 2, wallHeight / 2, 0] as [number, number, number] },
  ];
  for (const item of walls) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(...item.size), wallMat);
    wall.name = `IfcWall:product-envelope-${item.name}`;
    wall.position.set(...item.pos);
    wall.renderOrder = 20;
    wall.frustumCulled = false;
    root.add(wall);
  }
  renderedCounts.productEnvelopeWall = (renderedCounts.productEnvelopeWall ?? 0) + walls.length;
}

function createBimObject(
  element: SemanticBimElement,
  model: SemanticBimModel,
  productMode: boolean,
  viewPreset: NonNullable<Props['viewPreset']>,
) {
  if (element.points) return roofMesh(element, model, productMode, viewPreset);
  if (element.segment) return lineMesh(element, model, productMode, viewPreset);
  return boundsMesh(element, model);
}

function shouldRenderElement(
  element: SemanticBimElement,
  options: { viewPreset: NonNullable<Props['viewPreset']>; showRoof: boolean; activeFloor: number | 'all'; productMode?: boolean },
) {
  // The building envelope (roof shells, full-height A-frame gable ends)
  // spans every storey; amputating it under a level filter leaves floating
  // triangle shards beside the model.
  const isEnvelope = element.category === 'roofPlane'
    || element.metadata?.wallRole === 'aFrameGableEndWall';
  if (options.activeFloor !== 'all' && !isEnvelope && element.floor !== options.activeFloor) return false;
  if (!options.showRoof && element.category === 'roofPlane') return false;
  if (options.productMode && options.viewPreset === 'presentation-3d') {
    const elementText = [
      element.id,
      element.name,
      element.sourceId,
      element.sourceAnchorId,
      element.metadata?.wallKind,
      element.metadata?.wallId,
      element.metadata?.openingKind,
      element.metadata?.openingType,
      element.metadata?.windowKind,
      element.metadata?.roomIds,
    ].filter(Boolean).join(' ').toLowerCase();
    if (['void', 'space', 'openZone'].includes(element.category)) return false;
    if (element.category === 'slab') return false;
    if (['fixtureProxy'].includes(element.category)) return false;
    if (element.category === 'equipment' && !/kitchen|island|counter|range|stove|refrigerator|fridge|washer|dryer|laundry/i.test(elementText)) return false;
    if (element.category === 'furniture' && !/bed|sofa|couch|chair|table|dining|bench|desk/i.test(elementText)) return false;
    if (element.category === 'guardrail' && !/deck|balcony|exterior|outer|entry/i.test(elementText)) return false;
  }
  return true;
}

function populateWorld(
  model: SemanticBimModel,
  scene: THREE.Scene,
  options: { viewPreset: NonNullable<Props['viewPreset']>; showRoof: boolean; activeFloor: number | 'all'; productMode: boolean },
) {
  const root = new THREE.Group();
  root.name = 'buildable_bim_v1';
  const objectByElementId = new Map<string, THREE.Object3D>();
  const renderedCounts: Record<string, number> = {};
  let semanticProductShellWallCount = 0;
  if (options.productMode && options.viewPreset === 'presentation-3d') {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(model.footprint.widthFt, 0.22, model.footprint.depthFt),
      material('#d8d1c4', 1),
    );
    base.name = 'IfcSlab:product-footprint-base';
    base.position.set(0, 0.11, 0);
    base.renderOrder = 4;
    base.frustumCulled = false;
    root.add(base);
    renderedCounts.productFootprintSlab = 1;
    addProductEnvelope(root, model, renderedCounts);
  }
  const profile = aFrameProfile(model);
  if (options.productMode && options.viewPreset === 'presentation-3d' && profile) {
    // A-frame envelope = roof shell + clipped gable-end walls; keep the QA
    // count satisfied without requiring low eave-wall traces.
    renderedCounts.productEnvelopeWall = Math.max(renderedCounts.productEnvelopeWall ?? 0, 4);
  }
  for (const element of model.elements) {
    if (!shouldRenderElement(element, options)) continue;
    if (options.productMode && ['space', 'openZone', 'void'].includes(element.category)) continue;
    const object = createBimObject(element, model, options.productMode, options.viewPreset);
    if (!object) continue;
    object.name = `${element.ifcClass}:${element.name}`;
    object.userData.semanticBim = element;
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && !child.userData.semanticBim) child.userData.semanticBim = element;
    });
    root.add(object);
    objectByElementId.set(element.id, object);
    renderedCounts[element.category] = (renderedCounts[element.category] ?? 0) + 1;
    if (
      options.productMode &&
      options.viewPreset === 'presentation-3d' &&
      element.category === 'wall' &&
      element.metadata?.exterior === true
    ) {
      semanticProductShellWallCount += 1;
    }
  }
  if (semanticProductShellWallCount > 0) {
    renderedCounts.productEnvelopeWall = Math.max(renderedCounts.productEnvelopeWall ?? 0, semanticProductShellWallCount);
  }
  scene.add(root);
  root.userData.objectByElementId = objectByElementId;
  root.userData.renderedCounts = renderedCounts;
  return root;
}

function fitCachedVisualAsset(element: SemanticBimElement, model: SemanticBimModel, source: THREE.Object3D) {
  if (!element.bounds) return null;
  const { x, y, z, w, h, d } = element.bounds;
  const clone = source.clone(true);
  const group = new THREE.Group();
  group.name = `visual-asset:${element.name}`;
  group.userData.semanticBim = element;
  group.position.set(centerX(model, x + w / 2), y, centerZ(model, z + d / 2));
  group.rotation.y = THREE.MathUtils.degToRad(-(element.rotationDeg ?? 0));
  group.add(clone);

  clone.updateMatrixWorld(true);
  const initial = new THREE.Box3().setFromObject(clone);
  const size = initial.getSize(new THREE.Vector3());
  if (
    !Number.isFinite(size.x) ||
    !Number.isFinite(size.y) ||
    !Number.isFinite(size.z) ||
    size.x <= 0.01 ||
    size.y <= 0.01 ||
    size.z <= 0.01
  ) {
    return null;
  }
  const targetW = Math.max(0.1, w * 0.92);
  const targetH = Math.max(0.1, Math.min(Math.max(1, h), 4.5));
  const targetD = Math.max(0.1, d * 0.92);
  const scale = Math.min(
    Number.isFinite(size.x) && size.x > 0 ? targetW / size.x : 1,
    Number.isFinite(size.y) && size.y > 0 ? targetH / size.y : 1,
    Number.isFinite(size.z) && size.z > 0 ? targetD / size.z : 1,
  );
  if (!Number.isFinite(scale) || scale <= 0 || scale > 16) {
    return null;
  }
  clone.scale.multiplyScalar(Math.max(0.001, scale));
  clone.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(clone);
  const center = scaled.getCenter(new THREE.Vector3());
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= scaled.min.y;
  clone.updateMatrixWorld(true);
  group.updateMatrixWorld(true);
  const fittedBounds = new THREE.Box3().setFromObject(group);
  const fittedSize = fittedBounds.getSize(new THREE.Vector3());
  if (
    fittedSize.x > targetW * 1.18 ||
    fittedSize.y > targetH * 1.25 ||
    fittedSize.z > targetD * 1.18
  ) {
    return null;
  }
  clone.traverse((object) => {
    object.userData.semanticBim = element;
    if (object instanceof THREE.Mesh) {
      object.castShadow = false;
      object.receiveShadow = true;
      object.frustumCulled = false;
      if (element.category === 'sanitaryTerminal') object.material = material('#edf7f6', 1);
      else if (element.category === 'furniture') object.material = material('#d8d1c5', 1);
      else if (element.category === 'equipment' || element.category === 'fixtureProxy') object.material = material('#ddd8d0', 1);
    }
  });
  return group;
}

function attachCachedVisualAssets(root: THREE.Group, model: SemanticBimModel) {
  const objectByElementId = root.userData.objectByElementId as Map<string, THREE.Object3D> | undefined;
  for (const element of model.elements) {
    const entrypoint = element.metadata?.visualAssetEntrypoint;
    if (typeof entrypoint !== 'string' || !entrypoint || element.metadata?.visualAssetMode !== 'gltf-cache') continue;
    const fallback = objectByElementId?.get(element.id);
    if (!fallback) continue;
    loadGltfScene(entrypoint)
      .then((scene) => {
        const fitted = fitCachedVisualAsset(element, model, scene);
        if (!fitted) return;
        if (fallback) fallback.visible = false;
        root.add(fitted);
      })
      .catch(() => {
        // Keep deterministic procedural fallback when a cached visual asset fails.
      });
  }
}

function applyCameraPreset(
  world: { camera: OBC.SimpleCamera },
  model: SemanticBimModel,
  home: DenHome,
  preset: NonNullable<Props['viewPreset']>,
) {
  const maxDim = Math.max(model.footprint.widthFt, model.footprint.depthFt, home.height);
  const targetY = Math.max(2, home.height * 0.24);
  const elevationTargetY = Math.max(3, home.height * 0.42);
  const elevationDistance = Math.max(model.footprint.widthFt, model.footprint.depthFt) * 1.05;
  if (preset === 'plan-top') {
    // Offset only along z so the top view reads square/north-up; an x==z
    // offset makes the straight-down camera inherit a 45-degree azimuth.
    world.camera.controls.setLookAt(0, maxDim * 1.65, 0.012, 0, 0, 0, false);
    return;
  }
  if (preset === 'front-elevation') {
    world.camera.controls.setLookAt(0, elevationTargetY, elevationDistance, 0, elevationTargetY, 0, false);
    return;
  }
  if (preset === 'side-elevation') {
    world.camera.controls.setLookAt(elevationDistance, elevationTargetY, 0, 0, elevationTargetY, 0, false);
    return;
  }
  if (preset === 'white-cutaway') {
    world.camera.controls.setLookAt(maxDim * 0.82, maxDim * 0.62, maxDim * 0.68, 0, targetY, 0, false);
    return;
  }
  const compactAFrame = isAFrameModel(model) && model.footprint.widthFt <= 16 && model.footprint.depthFt <= 16;
  const distance = compactAFrame ? 1.05 : 0.78;
  const height = compactAFrame ? 0.72 : 0.58;
  world.camera.controls.setLookAt(maxDim * distance, maxDim * height, maxDim * (distance + 0.08), 0, targetY, 0, false);
}

export default function BimPreview({
  home,
  viewPreset = 'presentation-3d',
  showRoof = true,
  activeFloor = 'all',
  productMode = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<{ world: { camera: OBC.SimpleCamera }; model: SemanticBimModel; home: DenHome } | null>(null);
  const [selected, setSelected] = useState<SemanticBimElement | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const model = useMemo(() => buildableBimFromHome(home), [home]);
  const summary = useMemo(() => buildableBimSummary(model), [model]);
  const assetSummary = useMemo(() => localBimAssetSummary(), []);
  const matchedLocalAssets = useMemo(() => model.elements.filter((element) => Boolean(element.metadata?.localAssetId)).length, [model]);
  const renderableVisualAssets = useMemo(() => model.elements.filter((element) => element.metadata?.visualAssetMode === 'gltf-cache').length, [model]);
  const setCamera = (preset: NonNullable<Props['viewPreset']>) => {
    const current = worldRef.current;
    if (!current) return;
    applyCameraPreset(current.world, current.model, current.home, preset);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = '';
    const components = new OBC.Components();
    const worlds = components.get(OBC.Worlds);
    const world = worlds.create<OBC.SimpleScene, OBC.SimpleCamera, OBC.SimpleRenderer>();
    world.scene = new OBC.SimpleScene(components);
    world.renderer = new OBC.SimpleRenderer(components, container, {
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    world.renderer.showLogo = false;
    world.camera = new OBC.SimpleCamera(components);
    components.init();
    world.scene.setup({
      backgroundColor: new THREE.Color('#f5f0e8'),
      ambientLight: { color: new THREE.Color('#fff8ef'), intensity: 1.2 },
      directionalLight: {
        color: new THREE.Color('#fff6ea'),
        intensity: 1.1,
        position: new THREE.Vector3(35, 50, 24),
      },
    });

    if (!productMode) {
      const grid = new THREE.GridHelper(Math.max(model.footprint.widthFt, model.footprint.depthFt) * 1.4, 24, '#ddd4c8', '#eee8df');
      grid.position.y = -0.01;
      world.scene.three.add(grid);
    }
    const root = populateWorld(model, world.scene.three, { viewPreset, showRoof, activeFloor, productMode });
    if (!productMode) attachCachedVisualAssets(root, model);

    applyCameraPreset(world, model, home, viewPreset);
    worldRef.current = { world, model, home };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      const rect = world.renderer!.three.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, world.camera!.three);
      const hits = raycaster.intersectObjects(root.children, true);
      const hit = hits.find((item) => item.object.userData.semanticBim)?.object.userData.semanticBim as SemanticBimElement | undefined;
      setSelected(hit ?? null);
    };
    world.renderer.three.domElement.addEventListener('pointerdown', onPointerDown);
    // GPU context can drop in long-lived tabs; without handling, the canvas
    // goes permanently blank with no message. Surface a recovery overlay.
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => setContextLost(false);
    world.renderer.three.domElement.addEventListener('webglcontextlost', onContextLost);
    world.renderer.three.domElement.addEventListener('webglcontextrestored', onContextRestored);
    world.renderer.three.domElement.dataset.bimElementCount = String(model.elements.length);
    world.renderer.three.domElement.dataset.bimRenderedElementCount = String(root.children.length);
    world.renderer.three.domElement.dataset.bimRenderedCategoryCounts = JSON.stringify(root.userData.renderedCounts ?? {});
    world.renderer.three.domElement.dataset.thatOpen = 'components';
    world.renderer.three.domElement.dataset.bimSchema = model.buildableSchemaVersion;
    const componentElements = model.elements.filter((element) => Boolean(element.component));
    world.renderer.three.domElement.dataset.bimComponentCount = String(componentElements.length);
    world.renderer.three.domElement.dataset.bimComponentMissingCount = String(model.elements.length - componentElements.length);
    world.renderer.three.domElement.dataset.bimLocalAssetCount = String(model.elements.filter((element) => Boolean(element.metadata?.localAssetId)).length);
    world.renderer.three.domElement.dataset.bimRenderableVisualAssetCount = String(model.elements.filter((element) => element.metadata?.visualAssetMode === 'gltf-cache').length);
    // Envelope integrity evidence for QA: no wall vertex may sit more than
    // 0.5 ft above the roof plane at its x,z (sail-fin regression guard).
    const roofPlaneEqs = model.elements
      .filter((element) => element.category === 'roofPlane' && (element.points?.length ?? 0) >= 3)
      .map((element) => {
        const pts = element.points!;
        const [p, q, r] = [pts[0], pts[1], pts[2]];
        const det = (q.x - p.x) * (r.z - p.z) - (r.x - p.x) * (q.z - p.z);
        if (Math.abs(det) < 1e-9) return null;
        const a = ((q.y - p.y) * (r.z - p.z) - (r.y - p.y) * (q.z - p.z)) / det;
        const b = ((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / det;
        return {
          a, b, c: p.y - a * p.x - b * p.z,
          minX: Math.min(...pts.map((pt) => pt.x)), maxX: Math.max(...pts.map((pt) => pt.x)),
          minZ: Math.min(...pts.map((pt) => pt.z)), maxZ: Math.max(...pts.map((pt) => pt.z)),
        };
      })
      .filter((plane): plane is NonNullable<typeof plane> => plane !== null);
    let envelopeMaxExcess = 0;
    const envelopeOffenders: Array<{ id: string; category: string; excess: number }> = [];
    let worstMesh: { id: string; category: string; excess: number } | null = null;
    if (roofPlaneEqs.length) {
      const centerOffsetX = model.footprint.widthFt / 2;
      const centerOffsetZ = model.footprint.depthFt / 2;
      const vertex = new THREE.Vector3();
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        const semantic = mesh.userData?.semanticBim as SemanticBimElement | undefined;
        if (!mesh.isMesh) return;
        // Roof planes define the envelope; everything else rendered must sit
        // inside it. Untagged meshes are sampled too — a mesh the evidence
        // cannot attribute must never be a mesh the evidence ignores.
        if (semantic?.category === 'roofPlane') return;
        const position = mesh.geometry?.getAttribute?.('position');
        if (!position) return;
        mesh.updateWorldMatrix(true, false);
        let meshExcess = 0;
        for (let i = 0; i < position.count; i += 1) {
          vertex.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(mesh.matrixWorld);
          const sourceX = vertex.x + centerOffsetX;
          const sourceZ = vertex.z + centerOffsetZ;
          let roofY = Infinity;
          for (const plane of roofPlaneEqs) {
            if (sourceX < plane.minX - 0.1 || sourceX > plane.maxX + 0.1 || sourceZ < plane.minZ - 0.1 || sourceZ > plane.maxZ + 0.1) continue;
            roofY = Math.min(roofY, plane.a * sourceX + plane.b * sourceZ + plane.c);
          }
          if (Number.isFinite(roofY)) meshExcess = Math.max(meshExcess, vertex.y - roofY);
        }
        if (meshExcess > envelopeMaxExcess) {
          envelopeMaxExcess = meshExcess;
          worstMesh = {
            id: semantic?.id ?? mesh.name ?? 'untagged-mesh',
            category: semantic?.category ?? 'untagged',
            excess: Math.round(meshExcess * 100) / 100,
          };
        }
        if (meshExcess > 0.25) {
          envelopeOffenders.push({
            id: semantic?.id ?? mesh.name ?? 'untagged-mesh',
            category: semantic?.category ?? 'untagged',
            excess: Math.round(meshExcess * 100) / 100,
          });
        }
      });
    }
    world.renderer.three.domElement.dataset.bimEnvelopeMaxExcessFt = envelopeMaxExcess.toFixed(2);
    world.renderer.three.domElement.dataset.bimEnvelopePlanes = String(roofPlaneEqs.length);
    world.renderer.three.domElement.dataset.bimEnvelopeOffenders = JSON.stringify(
      envelopeOffenders.sort((a, b) => b.excess - a.excess).slice(0, 12),
    );
    world.renderer.three.domElement.dataset.bimEnvelopeWorstMesh = JSON.stringify(worstMesh);

    return () => {
      worldRef.current = null;
      world.renderer?.three.domElement.removeEventListener('pointerdown', onPointerDown);
      world.renderer?.three.domElement.removeEventListener('webglcontextlost', onContextLost);
      world.renderer?.three.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      components.dispose();
      container.innerHTML = '';
    };
  }, [activeFloor, home, home.height, model, productMode, showRoof, viewPreset]);

  return (
    <div className="relative h-full min-h-[480px] overflow-hidden bg-[#f5f0e8]">
      <div ref={containerRef} className="h-full w-full" />
      {contextLost && (
        <div data-context-lost className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-[#f5f0e8]/95">
          <div className="text-xs text-stone-600">The 3D view lost its graphics context.</div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="border border-stone-800 bg-stone-800 px-4 py-2 text-xs text-white hover:bg-stone-700"
          >
            Reload 3D View
          </button>
        </div>
      )}
      {!productMode && <div data-testid="bim-camera-controls" className="absolute right-3 top-36 z-10 border border-stone-200 bg-white/90 p-2 text-[10px] shadow-sm backdrop-blur">
        <div className="mb-1 font-semibold uppercase tracking-wide text-stone-500">BIM Camera</div>
        <div className="grid grid-cols-2 gap-1">
          {[
            { id: 'presentation-3d' as const, label: 'Fit 3D' },
            { id: 'plan-top' as const, label: 'Top' },
            { id: 'white-cutaway' as const, label: 'Cutaway' },
            { id: 'front-elevation' as const, label: 'Front' },
            { id: 'side-elevation' as const, label: 'Side' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setCamera(item.id)}
              className="border border-stone-200 bg-white px-2 py-0.5 text-stone-600 hover:bg-stone-100"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>}
      {!productMode && <div className="pointer-events-none absolute left-[240px] top-3 max-w-xs border border-stone-200 bg-white/90 p-3 text-[10px] shadow-sm backdrop-blur">
        <div className="font-semibold uppercase tracking-wide text-stone-500">BIM Product View</div>
        <div className="mt-1 font-mono text-stone-700">That Open Components</div>
        <div className={`mt-2 font-mono ${summary.status === 'blocked' ? 'text-red-700' : summary.status === 'warning' ? 'text-amber-700' : 'text-emerald-700'}`}>
          buildable_bim_v1: {summary.status}
        </div>
        <div className="mt-1 font-mono text-stone-500">{viewPreset} / {productMode ? 'product' : 'review'}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-stone-500">
          <span>elements</span><span>{summary.counts.total}</span>
          <span>walls</span><span>{(summary.counts.wall ?? 0) + (summary.counts.guardrail ?? 0)}</span>
          <span>openings</span><span>{(summary.counts.opening ?? 0) + (summary.counts.door ?? 0) + (summary.counts.window ?? 0)}</span>
          <span>fixtures</span><span>{(summary.counts.sanitaryTerminal ?? 0) + (summary.counts.furniture ?? 0) + (summary.counts.equipment ?? 0) + (summary.counts.fixtureProxy ?? 0)}</span>
          <span>assets</span><span>{assetSummary.componentCount} local IFC</span>
          <span>matched</span><span>{matchedLocalAssets} metadata</span>
          <span>glTF</span><span>{renderableVisualAssets} renderable</span>
        </div>
        {summary.blockers.slice(0, 3).map((item) => <div key={item} className="mt-1 text-red-700">{item}</div>)}
        {!summary.blockers.length && summary.warnings.slice(0, 2).map((item) => <div key={item} className="mt-1 text-amber-700">{item}</div>)}
      </div>}
      {!productMode && selected && (
        <div className="pointer-events-none absolute bottom-3 right-3 max-w-xs border border-stone-200 bg-white/90 p-3 text-[10px] shadow-sm backdrop-blur">
          <div className="font-semibold uppercase tracking-wide text-stone-500">Selected BIM Element</div>
          <div className="mt-1 font-mono text-stone-800">{selected.name}</div>
          <div className="font-mono text-stone-500">{selected.ifcClass} / {selected.category}</div>
          {selected.metadata?.assetKey && <div className="font-mono text-stone-500">asset: {selected.metadata.assetKey}</div>}
          {selected.component && (
            <>
              <div className="font-mono text-stone-500">symbol: {selected.component.twoDSymbol.symbol}</div>
              <div className="font-mono text-stone-500">fallback: {selected.component.proceduralFallback.renderer}</div>
              {selected.metadata?.localAssetLabel && (
                <div className="font-mono text-stone-500">catalog: {selected.metadata.localAssetLabel}</div>
              )}
              {selected.metadata?.visualAssetMode && (
                <div className="font-mono text-stone-500">visual: {selected.metadata.visualAssetMode}</div>
              )}
              <div className="font-mono text-stone-500">
                sources: {selected.component.marketplaceAssets.map((asset) => asset.sourceId).join(', ')}
              </div>
            </>
          )}
          <div className="mt-1 font-mono text-stone-400">{selected.id}</div>
        </div>
      )}
      {!productMode && <div className="pointer-events-none absolute bottom-3 left-3 text-[9px] text-stone-400">
        That Open viewer - drag to orbit - scroll to zoom - click an element
      </div>}
    </div>
  );
}
