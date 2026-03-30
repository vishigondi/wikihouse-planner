'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { DenHome } from '@/lib/types';

interface Props {
  home: DenHome;
  wallOpacity: number;
  roofVisible: boolean;
}

const GRID = 4; // feet per grid unit — must match generate-placements.ts
const WALL_EXT_H = 10; // wall-ext panel height from library.json — eave is here
const OUTDOOR_TYPES = new Set(['deck', 'porch', 'covered_porch', 'screened_porch']);

interface RoofStrip {
  startGx: number;
  endGx: number;
  minGz: number;
  maxGz: number;
}

/**
 * Roof cross-section profile (ZY plane, centered at z=0).
 *
 * wallHeight = WALL_EXT_H (10ft) for all pitched roofs, so the
 * roof surface starts exactly at the top of the 10ft wall panels.
 * For a-frame, wallHeight = 2 (knee wall).  For flat, wallHeight = peakHeight.
 */
function computeRoofProfile(
  roofStyle: string,
  depth: number,
  wallHeight: number,
  peakHeight: number,
): Array<{ y: number; z: number }> {
  const halfD = depth / 2;

  switch (roofStyle) {
    case 'a-frame': {
      // Full section from ground — no separate wall zone
      const knee = 2;
      return [
        { z: -halfD, y: 0 },
        { z: -halfD, y: knee },
        { z: 0,      y: peakHeight },
        { z: halfD,  y: knee },
        { z: halfD,  y: 0 },
      ];
    }
    case 'steep-gable':
    case 'gable': {
      // Triangle above the eave line
      return [
        { z: -halfD, y: wallHeight },
        { z: 0,      y: peakHeight },
        { z: halfD,  y: wallHeight },
      ];
    }
    case 'shed': {
      // Right-triangle cap: high side (left) to low side (right)
      return [
        { z: -halfD, y: peakHeight },   // high eave
        { z: halfD,  y: wallHeight },   // low eave
        { z: -halfD, y: wallHeight },   // close shape at base
      ];
    }
    case 'flat':
    default: {
      // Thin slab on top of walls
      const slabT = 0.33;
      return [
        { z: -halfD, y: wallHeight + slabT },
        { z: halfD,  y: wallHeight + slabT },
        { z: halfD,  y: wallHeight },
        { z: -halfD, y: wallHeight },
      ];
    }
  }
}

/**
 * Roof-only geometry — the cap surface above the 10ft wall panels.
 *
 * Changes from previous version:
 *   ✦ Removed gable end triangles — they conflicted with wall-ext panels
 *     that already cover the east/west perimeter faces.
 *   ✦ wallHeight fixed to WALL_EXT_H (10ft) so roof sits flush on walls.
 *   ✦ Per-strip geometry: for L-shaped buildings each contiguous group of
 *     X-columns with the same Z extent gets its own roof prism, so the roof
 *     follows the actual footprint instead of the bounding-box rectangle.
 */
export default function EnvelopeMesh({ home, wallOpacity, roofVisible }: Props) {
  const roofStyle = home.roofStyle || 'gable';
  const peakHeight = home.height;

  // Eave height = wall panel height, except a-frame (knee) and flat (no ridge)
  const wallHeight =
    roofStyle === 'a-frame' ? 2
    : roofStyle === 'flat'  ? peakHeight
    : WALL_EXT_H;

  const roofGeometries = useMemo(() => {
    // ── Mirror the coordinate system from generate-placements.ts ───────
    const minFloor = Math.min(...home.rooms.map(r => r.floor ?? 0));
    const groundRooms = home.rooms.filter(r => (r.floor ?? 0) === minFloor);
    const interiorRooms = groundRooms.filter(r => !OUTDOOR_TYPES.has(r.type));

    if (interiorRooms.length === 0) return [];

    const globalMinGx = Math.min(...groundRooms.map(r => r.gx));
    const globalMaxGx = Math.max(...groundRooms.map(r => r.gx + r.gw));
    const globalMinGz = Math.min(...groundRooms.map(r => r.gz));
    const globalMaxGz = Math.max(...groundRooms.map(r => r.gz + r.gd));
    const totalW = (globalMaxGx - globalMinGx) * GRID;
    const totalD = (globalMaxGz - globalMinGz) * GRID;

    // World coords (same origin as generate-placements: centre of full bbox)
    const gxW = (gx: number) => (gx - globalMinGx) * GRID - totalW / 2;
    const gzW = (gz: number) => (gz - globalMinGz) * GRID - totalD / 2;

    // ── Compute per-column Z ranges for interior rooms only ─────────────
    const intMinGx = Math.min(...interiorRooms.map(r => r.gx));
    const intMaxGx = Math.max(...interiorRooms.map(r => r.gx + r.gw));

    const strips: RoofStrip[] = [];
    for (let gx = intMinGx; gx < intMaxGx; gx++) {
      const colRooms = interiorRooms.filter(r => gx >= r.gx && gx < r.gx + r.gw);
      if (colRooms.length === 0) continue;
      const minGz = Math.min(...colRooms.map(r => r.gz));
      const maxGz = Math.max(...colRooms.map(r => r.gz + r.gd));
      const last = strips[strips.length - 1];
      if (last && last.minGz === minGz && last.maxGz === maxGz) {
        last.endGx = gx + 1;
      } else {
        strips.push({ startGx: gx, endGx: gx + 1, minGz, maxGz });
      }
    }

    // ── Merge strips if too many (>3 = BFS scatter, not a real L-shape) ──
    if (strips.length > 3) {
      // Collapse all strips into one unified roof
      const minGz = Math.min(...strips.map(s => s.minGz));
      const maxGz = Math.max(...strips.map(s => s.maxGz));
      const minGx = Math.min(...strips.map(s => s.startGx));
      const maxGx = Math.max(...strips.map(s => s.endGx));
      strips.length = 0;
      strips.push({ startGx: minGx, endGx: maxGx, minGz, maxGz });
    }

    // ── Build one ExtrudeGeometry per strip ─────────────────────────────
    const results: Array<{ geo: THREE.ExtrudeGeometry; edges: THREE.EdgesGeometry }> = [];

    for (const strip of strips) {
      const stripW = (strip.endGx - strip.startGx) * GRID;
      const stripD = (strip.maxGz - strip.minGz) * GRID;
      const profile = computeRoofProfile(roofStyle, stripD, wallHeight, peakHeight);
      if (profile.length < 3) continue;

      const shape = new THREE.Shape();
      shape.moveTo(profile[0].z, profile[0].y);
      for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i].z, profile[i].y);
      shape.closePath();

      const geo = new THREE.ExtrudeGeometry(shape, { depth: stripW, bevelEnabled: false });
      // rotateY(PI/2): extrusion (orig +Z) → +X, shape-X (orig depth axis) → -Z
      geo.rotateY(Math.PI / 2);

      // World centre of this strip
      const xCenter = (gxW(strip.startGx) + gxW(strip.endGx)) / 2;
      const zCenter = (gzW(strip.minGz) + gzW(strip.maxGz)) / 2;
      geo.translate(-stripW / 2 + xCenter, 0, zCenter);

      results.push({ geo, edges: new THREE.EdgesGeometry(geo, 15) });
    }

    return results;
  }, [home.rooms, roofStyle, wallHeight, peakHeight]);

  if (!roofVisible || roofGeometries.length === 0) return null;

  return (
    <group>
      {roofGeometries.map((item, i) => (
        <group key={i}>
          <mesh geometry={item.geo}>
            <meshStandardMaterial
              color="#d8d2c6"
              transparent
              opacity={Math.min(wallOpacity, 0.55)}
              roughness={0.95}
              metalness={0.01}
              side={THREE.DoubleSide}
            />
          </mesh>
          <lineSegments geometry={item.edges}>
            <lineBasicMaterial color="#a09080" transparent opacity={0.3} />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}
