'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { DenHome } from '@/lib/types';

interface Props {
  home: DenHome;
  wallOpacity: number;
  roofVisible: boolean;
}

// Compute a cross-section profile from roof style + dimensions
function computeProfile(
  roofStyle: string,
  depth: number,
  wallHeight: number,
  peakHeight: number,
): Array<{ y: number; z: number }> {
  const halfD = depth / 2;

  switch (roofStyle) {
    case 'a-frame': {
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
      const h = wallHeight * 0.6;
      return [
        { z: -halfD, y: 0 },
        { z: -halfD, y: h },
        { z: 0, y: peakHeight },
        { z: halfD, y: h },
        { z: halfD, y: 0 },
      ];
    }
    case 'gable': {
      return [
        { z: -halfD, y: 0 },
        { z: -halfD, y: wallHeight },
        { z: 0, y: peakHeight },
        { z: halfD, y: wallHeight },
        { z: halfD, y: 0 },
      ];
    }
    case 'shed': {
      const rise = peakHeight - wallHeight;
      return [
        { z: -halfD, y: 0 },
        { z: -halfD, y: wallHeight + rise },
        { z: halfD, y: wallHeight },
        { z: halfD, y: 0 },
      ];
    }
    case 'flat':
    default: {
      return [
        { z: -halfD, y: 0 },
        { z: -halfD, y: wallHeight },
        { z: halfD, y: wallHeight },
        { z: halfD, y: 0 },
      ];
    }
  }
}

export default function EnvelopeMesh({ home, wallOpacity, roofVisible }: Props) {
  const { width, depth } = home.footprint;
  const roofStyle = home.roofStyle;
  const peakHeight = home.height;
  const wallHeight = roofStyle === 'flat' ? peakHeight : peakHeight * 0.6;
  const wallThickness = 0.5;

  const activeProfile = useMemo(() => {
    return computeProfile(roofStyle, depth, wallHeight, peakHeight);
  }, [roofStyle, depth, wallHeight, peakHeight]);

  const { shellGeo, edgeGeo } = useMemo(() => {
    const profile = activeProfile;

    // Outer shape
    const outerShape = new THREE.Shape();
    outerShape.moveTo(profile[0].z, profile[0].y);
    for (let i = 1; i < profile.length; i++) {
      outerShape.lineTo(profile[i].z, profile[i].y);
    }
    outerShape.closePath();

    // Inner shape (inset by wall thickness for hollow shell)
    const innerPoints = profile.map(p => {
      if (p.y < 0.1) return p; // ground stays
      const zDir = p.z > 0.01 ? -1 : p.z < -0.01 ? 1 : 0;
      const yOff = (p.y >= peakHeight - 0.5) ? wallThickness : 0;
      return {
        z: p.z + zDir * wallThickness,
        y: Math.max(wallThickness, p.y - yOff),
      };
    });

    // Reverse inner points for opposite winding (Three.js requires holes wound CCW)
    const reversedInner = [...innerPoints].reverse();
    const hole = new THREE.Path();
    hole.moveTo(reversedInner[0].z, reversedInner[0].y);
    for (let i = 1; i < reversedInner.length; i++) {
      hole.lineTo(reversedInner[i].z, reversedInner[i].y);
    }
    hole.closePath();
    outerShape.holes.push(hole);

    // Extrude along building length
    const shell = new THREE.ExtrudeGeometry(outerShape, {
      depth: width,
      bevelEnabled: false,
    });
    shell.rotateY(Math.PI / 2);
    shell.translate(-width / 2, 0, 0);

    const edges = new THREE.EdgesGeometry(shell, 15);

    return { shellGeo: shell, edgeGeo: edges };
  }, [activeProfile, width, wallThickness, peakHeight]);

  // Detect which ends have living/great room for glass treatment (always computed)
  const { frontIsGlass, backIsGlass } = useMemo(() => {
    let front = false;
    let back = false;
    const livingRoom = home.rooms.find(r =>
      r.type === 'great_room' || r.type === 'living' || r.type === 'kitchen_open'
    );
    if (livingRoom) {
      const rz = livingRoom.gz * 4; // grid to feet
      const rzEnd = (livingRoom.gz + livingRoom.gd) * 4;
      const mid = depth / 2;
      // Room coords are 0-based, building is centered at 0
      // gz=0 corresponds to z = -halfD (front)
      if (rz === 0) front = true;
      if (rzEnd * 1 >= depth * 0.9) back = true;
      // Also check if room is at front or back by position
      if (rz < mid * 0.3) front = true;
      if (rzEnd > depth * 0.7) back = true;
    }
    return { frontIsGlass: front, backIsGlass: back };
  }, [home.rooms, depth]);

  // End wall geometry — always rendered with glass detection
  const endWallGeos = useMemo(() => {
    const profile = activeProfile;
    const halfD = depth / 2;

    // Build a Shape from the full cross-section profile for the end wall face.
    // The profile uses (z, y) coordinates; the shape lies in the XY plane,
    // mapping profile z → shape X (so the wall spans the building depth axis)
    // and profile y → shape Y (height). We then position/rotate into place.
    const endShape = new THREE.Shape();
    endShape.moveTo(profile[0].z, profile[0].y);
    for (let i = 1; i < profile.length; i++) {
      endShape.lineTo(profile[i].z, profile[i].y);
    }
    endShape.closePath();

    // Front end wall at x = -width/2 (the extrusion goes along X)
    const frontGeo = new THREE.ShapeGeometry(endShape);
    // ShapeGeometry lies in XY plane facing +Z by default.
    // We need it facing -X at x = -width/2.
    // Rotate 90° around Y so it faces along X axis, then position.
    frontGeo.rotateY(Math.PI / 2);
    frontGeo.translate(-width / 2, 0, 0);

    // Back end wall at x = +width/2
    const backGeo = new THREE.ShapeGeometry(endShape);
    // Rotate -90° around Y so it faces +X direction
    backGeo.rotateY(-Math.PI / 2);
    backGeo.translate(width / 2, 0, 0);

    return { frontGeo, backGeo };
  }, [activeProfile, width, depth]);

  // Walls-only geometry for when roof is hidden: side walls (no end walls here — end walls always rendered separately)
  const wallsOnlyGeo = useMemo(() => {
    if (roofVisible) return null;

    const h = roofStyle === 'a-frame' ? 2 :
              roofStyle === 'steep-gable' ? wallHeight * 0.6 :
              wallHeight;
    const halfW = width / 2;
    const halfD = depth / 2;
    const t = wallThickness;

    const geos: THREE.BufferGeometry[] = [];

    // Left wall (x = -halfW)
    const left = new THREE.BoxGeometry(t, h, depth);
    left.translate(-halfW + t / 2, h / 2, 0);
    geos.push(left);

    // Right wall (x = +halfW)
    const right = new THREE.BoxGeometry(t, h, depth);
    right.translate(halfW - t / 2, h / 2, 0);
    geos.push(right);

    return geos;
  }, [roofVisible, roofStyle, width, depth, wallHeight, wallThickness]);

  // Render end wall meshes (always present)
  const endWallMeshes = (
    <>
      {/* Front end wall */}
      <mesh geometry={endWallGeos.frontGeo}>
        <meshStandardMaterial
          color={frontIsGlass ? '#c8dde8' : '#f5f0e8'}
          transparent
          opacity={frontIsGlass ? 0.3 : wallOpacity}
          roughness={frontIsGlass ? 0.1 : 0.95}
          metalness={frontIsGlass ? 0.05 : 0.02}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Back end wall */}
      <mesh geometry={endWallGeos.backGeo}>
        <meshStandardMaterial
          color={backIsGlass ? '#c8dde8' : '#f5f0e8'}
          transparent
          opacity={backIsGlass ? 0.3 : wallOpacity}
          roughness={backIsGlass ? 0.1 : 0.95}
          metalness={backIsGlass ? 0.05 : 0.02}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );

  if (!roofVisible && wallsOnlyGeo) {
    return (
      <group>
        {/* Side walls only (end walls rendered separately below) */}
        {wallsOnlyGeo.map((geo, i) => (
          <mesh key={i} geometry={geo}>
            <meshStandardMaterial
              color="#f5f0e8"
              transparent
              opacity={wallOpacity}
              roughness={0.95}
              metalness={0.02}
              side={THREE.DoubleSide}
            />
          </mesh>
        ))}
        {/* End walls with glass detection — always visible */}
        {endWallMeshes}
      </group>
    );
  }

  return (
    <group>
      {/* Building shell — walls + roof as one extruded profile (long sides + roof) */}
      <mesh geometry={shellGeo}>
        <meshStandardMaterial
          color="#f5f0e8"
          transparent={wallOpacity < 1}
          opacity={wallOpacity}
          roughness={0.95}
          metalness={0.02}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* End walls with glass detection — always visible */}
      {endWallMeshes}

      {/* Architectural edge lines */}
      <lineSegments geometry={edgeGeo}>
        <lineBasicMaterial color="#a09080" transparent opacity={0.2} />
      </lineSegments>
    </group>
  );
}
