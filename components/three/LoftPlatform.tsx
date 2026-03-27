'use client';

import * as THREE from 'three';

const GRID = 4; // feet per grid unit

interface Props {
  footprint: { width: number; depth: number };
  loftHeight: number;
  rooms: Array<{ gx: number; gz: number; gw: number; gd: number; floor?: number }>;
}

/**
 * Renders a semi-transparent floor platform at the loft height,
 * only under rooms marked as floor=1.
 */
export default function LoftPlatform({ footprint, loftHeight, rooms }: Props) {
  const loftRooms = rooms.filter(r => r.floor === 1);

  if (loftRooms.length === 0) return null;

  const w = footprint.width;
  const d = footprint.depth;
  const edgeColor = new THREE.Color('#a89878');

  // Compute ground floor center for repositioning loft above building
  const groundRooms = rooms.filter(r => (r.floor ?? 0) < 1);
  const groundCenterX = groundRooms.length > 0
    ? groundRooms.reduce((s, r) => s + (r.gx + r.gw / 2), 0) / groundRooms.length * GRID - w / 2
    : 0;
  const groundCenterZ = groundRooms.length > 0
    ? groundRooms.reduce((s, r) => s + (r.gz + r.gd / 2), 0) / groundRooms.length * GRID - d / 2
    : 0;

  // For multiple loft rooms: compute loft group center, then apply relative offsets
  const loftCenterGx = loftRooms.length > 0
    ? loftRooms.reduce((s, r) => s + (r.gx + r.gw / 2), 0) / loftRooms.length
    : 0;
  const loftCenterGz = loftRooms.length > 0
    ? loftRooms.reduce((s, r) => s + (r.gz + r.gd / 2), 0) / loftRooms.length
    : 0;

  return (
    <group>
      {loftRooms.map((room, i) => {
        // Position loft above building center, preserving relative positions between loft rooms
        const relX = ((room.gx + room.gw / 2) - loftCenterGx) * GRID;
        const relZ = ((room.gz + room.gd / 2) - loftCenterGz) * GRID;
        const cx = groundCenterX + relX;
        const cz = groundCenterZ - d * 0.15 + relZ;
        const rw = room.gw * GRID;
        const rd = room.gd * GRID;

        // Edge outline points (rectangle)
        const pts = [
          new THREE.Vector3(-rw / 2, 0, -rd / 2),
          new THREE.Vector3( rw / 2, 0, -rd / 2),
          new THREE.Vector3( rw / 2, 0,  rd / 2),
          new THREE.Vector3(-rw / 2, 0,  rd / 2),
          new THREE.Vector3(-rw / 2, 0, -rd / 2),
        ];
        const edgeGeom = new THREE.BufferGeometry().setFromPoints(pts);

        return (
          <group key={i} position={[cx, loftHeight, cz]}>
            {/* Semi-transparent loft floor plane */}
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[rw, rd]} />
              <meshBasicMaterial
                color="#d4c8b0"
                transparent
                opacity={0.4}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Thin edge line */}
            <lineSegments geometry={edgeGeom}>
              <lineBasicMaterial color={edgeColor} linewidth={1} />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}
