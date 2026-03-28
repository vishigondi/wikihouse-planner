'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { DenHome } from '@/lib/types';

interface Props {
  home: DenHome;
  wallOpacity: number;
  roofVisible: boolean;
}

/**
 * Roof-only geometry — the triangular/shed cap above the eave line.
 * Individual wall panels (ComponentMesh) handle all 4 exterior walls now.
 * EnvelopeMesh only adds:
 *   1. The roof cap surface (closed triangular prism, visible when roofVisible=true)
 *   2. The gable end triangles (the portion above eave height on east/west faces)
 *      which rectangular wall panels can't fill.
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
      // A-frame: the whole section IS the roof (no separate wall zone)
      const knee = 2;
      return [
        { z: -halfD, y: 0 },
        { z: -halfD, y: knee },
        { z: 0, y: peakHeight },
        { z: halfD, y: knee },
        { z: halfD, y: 0 },
      ];
    }
    case 'steep-gable': {
      const eave = wallHeight * 0.6;
      return [
        { z: -halfD, y: eave },
        { z: 0, y: peakHeight },
        { z: halfD, y: eave },
      ];
    }
    case 'gable': {
      // Roof triangle above the eave line
      return [
        { z: -halfD, y: wallHeight },
        { z: 0, y: peakHeight },
        { z: halfD, y: wallHeight },
      ];
    }
    case 'shed': {
      // Shed cap: a right triangle connecting the two eave heights
      // Left side is high, right side is low, close at the low eave height
      const rise = peakHeight - wallHeight;
      return [
        { z: -halfD, y: wallHeight + rise },  // left eave (high)
        { z: halfD,  y: wallHeight },           // right eave (low)
        { z: -halfD, y: wallHeight },           // base of triangle (close shape)
      ];
    }
    case 'flat':
    default: {
      // Flat roof: a thin rectangular slab at the top of the walls
      const slabThickness = 0.33;
      return [
        { z: -halfD, y: wallHeight + slabThickness },
        { z: halfD,  y: wallHeight + slabThickness },
        { z: halfD,  y: wallHeight },
        { z: -halfD, y: wallHeight },
      ];
    }
  }
}

/** Build gable-end triangle geometry — the triangular portion ABOVE the eave.
 *  Rectangular wall panels cover the rectangular base; this fills the triangle. */
function buildGableEnd(
  profile: Array<{ y: number; z: number }>,
  xPos: number,
  faceDir: number, // +1 = face right (+X), -1 = face left (-X)
): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(profile[0].z, profile[0].y);
  for (let i = 1; i < profile.length; i++) {
    shape.lineTo(profile[i].z, profile[i].y);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  // ShapeGeometry lies in XY plane facing +Z. Rotate to face along X, then translate.
  geo.rotateY(faceDir > 0 ? -Math.PI / 2 : Math.PI / 2);
  geo.translate(xPos, 0, 0);
  return geo;
}

export default function EnvelopeMesh({ home, wallOpacity, roofVisible }: Props) {
  const { width, depth } = home.footprint;
  const roofStyle = home.roofStyle;
  const peakHeight = home.height;
  // Eave height = where vertical wall meets roof slope
  const wallHeight = roofStyle === 'flat' ? peakHeight
    : roofStyle === 'a-frame' ? 2
    : peakHeight * 0.6;

  const roofProfile = useMemo(() =>
    computeRoofProfile(roofStyle, depth, wallHeight, peakHeight),
    [roofStyle, depth, wallHeight, peakHeight]
  );

  // ── Roof cap — extruded along building length ───────────────────────
  const { roofGeo, roofEdgeGeo } = useMemo(() => {
    const profile = roofProfile;
    if (profile.length < 2) return { roofGeo: null, roofEdgeGeo: null };

    const shape = new THREE.Shape();
    shape.moveTo(profile[0].z, profile[0].y);
    for (let i = 1; i < profile.length; i++) {
      shape.lineTo(profile[i].z, profile[i].y);
    }
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: width,
      bevelEnabled: false,
    });
    geo.rotateY(Math.PI / 2);
    geo.translate(-width / 2, 0, 0);

    const edges = new THREE.EdgesGeometry(geo, 15);
    return { roofGeo: geo, roofEdgeGeo: edges };
  }, [roofProfile, width]);

  // ── Gable end triangles — fills the triangular zone above the eave ──
  const { frontGableGeo, backGableGeo } = useMemo(() => {
    const profile = roofProfile;
    // A-frame includes the full section; gable/steep only need the triangle
    // For a-frame, wall panels don't cover the angled portion, so we render
    // the full profile. For others, render only the triangle above eave.
    return {
      frontGableGeo: buildGableEnd(profile, -width / 2, -1),
      backGableGeo: buildGableEnd(profile, width / 2, 1),
    };
  }, [roofProfile, width]);

  // Detect glass end walls (living room on end)
  const { frontIsGlass, backIsGlass } = useMemo(() => {
    let front = false;
    let back = false;
    const livingRoom = home.rooms.find(r =>
      r.type === 'great_room' || r.type === 'living' || r.type === 'kitchen_open'
    );
    if (livingRoom) {
      const rz = livingRoom.gz * 4;
      const rzEnd = (livingRoom.gz + livingRoom.gd) * 4;
      if (rz < depth * 0.3) front = true;
      if (rzEnd > depth * 0.7) back = true;
    }
    return { frontIsGlass: front, backIsGlass: back };
  }, [home.rooms, depth]);

  const gableColor = '#f5f0e8';
  const gableOpacity = wallOpacity;

  return (
    <group>
      {/* Roof cap — only shown when roofVisible is true */}
      {roofVisible && roofGeo && (
        <>
          <mesh geometry={roofGeo}>
            <meshStandardMaterial
              color="#d8d2c6"
              transparent
              opacity={Math.min(wallOpacity, 0.55)}
              roughness={0.95}
              metalness={0.01}
              side={THREE.DoubleSide}
            />
          </mesh>
          {roofEdgeGeo && (
            <lineSegments geometry={roofEdgeGeo}>
              <lineBasicMaterial color="#a09080" transparent opacity={0.3} />
            </lineSegments>
          )}
        </>
      )}

      {/* Gable end triangles — always shown (fill the area above the eave) */}
      <mesh geometry={frontGableGeo}>
        <meshStandardMaterial
          color={frontIsGlass ? '#c8dde8' : gableColor}
          transparent
          opacity={frontIsGlass ? 0.25 : gableOpacity}
          roughness={frontIsGlass ? 0.1 : 0.95}
          metalness={frontIsGlass ? 0.05 : 0.02}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh geometry={backGableGeo}>
        <meshStandardMaterial
          color={backIsGlass ? '#c8dde8' : gableColor}
          transparent
          opacity={backIsGlass ? 0.25 : gableOpacity}
          roughness={backIsGlass ? 0.1 : 0.95}
          metalness={backIsGlass ? 0.05 : 0.02}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
