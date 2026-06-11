'use client';

import * as THREE from 'three';

const GRID = 4; // feet per grid unit

const OPEN_PLAN_TYPES = new Set([
  'kitchen', 'kitchen_open', 'kitchenette', 'open_kitchen', 'eat_in_kitchen',
  'dining', 'dining_room', 'dining_area', 'dining_nook',
  'eating_area', 'breakfast_area', 'breakfast_room', 'breakfast_nook',
  'great_room', 'great_room_open', 'living_room', 'living', 'lounge', 'family_room',
  'living_area', 'common_area', 'open_living', 'ldk',
  'living_dining', 'kitchen_dining', 'living_kitchen', 'open_plan', 'open_living_dining',
  'combined_living', 'combined_dining', 'combined_kitchen',
]);

interface Props {
  footprint: { width: number; depth: number };
  loftHeight: number;
  rooms: Array<{ gx: number; gz: number; gw: number; gd: number; floor?: number; type?: string }>;
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

  // Anchor loft above the LDK (open-plan) zone — mirrors RoomZones.tsx so the elevated platform
  // and the loft room zone co-locate over the living area rather than one appearing above bedrooms.
  // Anchoring over private rooms placed the platform directly above the bedroom wing, making
  // ground-floor bedrooms look like loft rooms in the rendered view.
  const groundRooms = rooms.filter(r => (r.floor ?? 0) < 1);
  const ldkGroundRooms = groundRooms.filter(r => r.type && OPEN_PLAN_TYPES.has(r.type));
  const loftAnchorRooms = ldkGroundRooms.length > 0 ? ldkGroundRooms : groundRooms;
  const groundCenterX = loftAnchorRooms.length > 0
    ? loftAnchorRooms.reduce((s, r) => s + (r.gx + r.gw / 2), 0) / loftAnchorRooms.length * GRID - w / 2
    : 0;
  const groundCenterZ = loftAnchorRooms.length > 0
    ? loftAnchorRooms.reduce((s, r) => s + (r.gz + r.gd / 2), 0) / loftAnchorRooms.length * GRID - d / 2
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
        const rw = room.gw * GRID;
        const rd = room.gd * GRID;

        // Mirror RoomZones.tsx: use real grid coords when the loft room sits inside the footprint.
        // Only fall back to LDK-centroid repositioning for out-of-footprint synthetic coords.
        const gWMax = w / GRID;
        const gDMax = d / GRID;
        const withinFootprint = room.gx >= 0 && (room.gx + room.gw) <= gWMax &&
                                room.gz >= 0 && (room.gz + room.gd) <= gDMax;
        let cx: number, cz: number;
        if (withinFootprint) {
          cx = (room.gx + room.gw / 2) * GRID - w / 2;
          cz = (room.gz + room.gd / 2) * GRID - d / 2;
        } else {
          const relX = ((room.gx + room.gw / 2) - loftCenterGx) * GRID;
          const relZ = ((room.gz + room.gd / 2) - loftCenterGz) * GRID;
          cx = groundCenterX + relX;
          cz = groundCenterZ + relZ;
          // Clamp to building boundary to prevent platform from drifting outside
          cx = Math.max(-w / 2 + rw / 2, Math.min(w / 2 - rw / 2, cx));
          cz = Math.max(-d / 2 + rd / 2, Math.min(d / 2 - rd / 2, cz));
        }

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
          <group key={i}>
            {/* Ground shadow — fills the void beneath the loft, anchoring it to the building */}
            <mesh position={[cx, 0.04, cz]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[rw - 0.1, rd - 0.1]} />
              <meshBasicMaterial
                color="#c8bfaf"
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>

            {/* Corner support posts — visually anchor the loft platform to the building floor */}
            {([[-1, -1], [1, -1], [1, 1], [-1, 1]] as [number, number][]).map(([sx, sz], ci) => (
              <mesh key={`post-${ci}`} position={[cx + sx * (rw / 2 - 0.15), loftHeight / 2, cz + sz * (rd / 2 - 0.15)]}>
                <boxGeometry args={[0.3, loftHeight, 0.3]} />
                <meshBasicMaterial color="#a89878" />
              </mesh>
            ))}

            {/* Elevated loft floor platform at loftHeight */}
            <group position={[cx, loftHeight, cz]}>
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
          </group>
        );
      })}
    </group>
  );
}
