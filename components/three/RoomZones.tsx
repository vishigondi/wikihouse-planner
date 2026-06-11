'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { RoomLayout, RoomConnection, RoomFixture, RenderTheme } from '@/lib/types';

const GRID = 4;
const DOOR_WIDTH = 3;

/* Fixture colors — isometric floor plan style (blue=water, gray=furniture, dark=counters) */
const FIXTURE_COLORS: Record<string, string> = {
  counter: '#2a2a3a',       // dark navy-gray (like wall color)
  island: '#3a3a4a',        // dark navy-gray
  tub: '#5a9ab8',           // blue (water fixture)
  vanity: '#7a8a9a',        // blue-gray
  toilet: '#8a9aa8',        // blue-gray
  bed: '#b0a898',           // warm light gray
  sofa: '#a0a8a0',          // soft sage gray
  chair: '#a0a8a0',         // soft sage gray
  coffee_table: '#9a9080',  // warm gray
  dining_table: '#9a9080',  // warm gray
  shelves: '#a8a0a0',       // light gray
  bench: '#a09890',         // warm gray
  window: '#6aadcc',        // bright blue (glass)
  glass_wall: '#6aadcc',    // bright blue
  sliding_glass: '#6aadcc', // bright blue
  stove: '#2a2a3a',         // dark (same as counter)
  sink: '#5a8a9a',          // blue-gray (water)
  nightstand: '#9a8a7a',    // warm gray
  stairs: '#5a5a5a',        // gray
  washer: '#7a8a9a',        // blue-gray
  dryer: '#7a8a9a',         // blue-gray
};

interface Props {
  rooms: RoomLayout[];
  footprint: { width: number; depth: number };
  visible: boolean;
  labelsVisible?: boolean;
  loftHeight?: number;
  connections?: RoomConnection[];
  renderTheme: RenderTheme;
}

/** Room types that get pocket doors (smaller arc) */
const POCKET_DOOR_TYPES = new Set([
  'bathroom_full', 'bathroom_half', 'walk_in_closet', 'closet', 'pantry', 'utility',
]);

/** Room types that are functional sleeping spaces — never suppressed even if labeled "Room N" */
const SLEEPING_ROOM_TYPES = new Set([
  'bedroom', 'master_bedroom', 'master', 'loft_bedroom', 'sleeping_loft',
  'guest_bedroom', 'kids_bedroom', 'sleeping_area', 'bunk_room', 'bedroom_loft',
  'primary_bedroom', 'secondary_bedroom', 'cabin_bedroom',
]);

/** Outdoor/exterior room types — rendered flush (zero inset, full opacity) so they sit
 *  seamlessly adjacent to the LDK instead of appearing as inset walled boxes. */
const OUTDOOR_TYPES = new Set([
  'deck', 'outdoor', 'outdoor_living', 'patio', 'covered_patio', 'terrace',
  'balcony', 'veranda', 'lanai', 'screened_porch', 'engawa',
]);

/** Room types that form the open-plan LDK core — rendered as one continuous space.
 *  Entry is intentionally excluded: it's only open-plan when it has an 'open' connection
 *  (handled via openConnectedLabels). Deck is excluded to prevent the slab from spanning
 *  the full house depth and making the kitchen appear walled off from the living area. */
const OPEN_PLAN_TYPES = new Set([
  'kitchen', 'kitchen_open', 'kitchenette', 'open_kitchen', 'eat_in_kitchen',
  'dining', 'dining_room', 'dining_area', 'dining_nook',
  'eating_area', 'breakfast_area', 'breakfast_room', 'breakfast_nook',
  'great_room', 'great_room_open', 'living_room', 'living', 'lounge', 'family_room',
  'living_area', 'common_area', 'open_living', 'ldk',
  'living_dining', 'kitchen_dining', 'living_kitchen', 'open_plan', 'open_living_dining',
  'combined_living', 'combined_dining', 'combined_kitchen',
]);

function isVoidZone(room: Pick<RoomLayout, 'type' | 'label'>): boolean {
  return /void|open.to.below/i.test(`${room.type} ${room.label}`);
}

function clampSpan(start: number, end: number, min: number, max: number): [number, number] {
  return [Math.max(min, start), Math.min(max, end)];
}

function VoidZoneOutline({ width, depth, renderTheme }: { width: number; depth: number; renderTheme: RenderTheme }) {
  const rail = 0.08;
  const y = 0.08;
  return (
    <group>
      <mesh position={[0, y, -depth / 2]}>
        <boxGeometry args={[width, rail, rail]} />
        <meshStandardMaterial color={renderTheme.interiorWall} transparent opacity={0.28} roughness={0.9} />
      </mesh>
      <mesh position={[0, y, depth / 2]}>
        <boxGeometry args={[width, rail, rail]} />
        <meshStandardMaterial color={renderTheme.interiorWall} transparent opacity={0.28} roughness={0.9} />
      </mesh>
      <mesh position={[-width / 2, y, 0]}>
        <boxGeometry args={[rail, rail, depth]} />
        <meshStandardMaterial color={renderTheme.interiorWall} transparent opacity={0.28} roughness={0.9} />
      </mesh>
      <mesh position={[width / 2, y, 0]}>
        <boxGeometry args={[rail, rail, depth]} />
        <meshStandardMaterial color={renderTheme.interiorWall} transparent opacity={0.28} roughness={0.9} />
      </mesh>
    </group>
  );
}

function Fixture3D({
  fixture,
  width,
  depth,
  color,
  renderTheme,
  isWindow,
}: {
  fixture: RoomFixture;
  width: number;
  depth: number;
  color: string;
  renderTheme: RenderTheme;
  isWindow: boolean;
}) {
  const text = `${fixture.type} ${fixture.desc}`.toLowerCase();
  const w = Math.max(0.3, width - 0.18);
  const d = Math.max(0.3, depth - 0.18);
  const fixtureMaterial = (
    <meshStandardMaterial
      color={color}
      transparent={isWindow}
      opacity={isWindow ? 0.55 : renderTheme.fixtureOpacity}
      roughness={0.68}
      metalness={0.02}
    />
  );
  const porcelain = <meshStandardMaterial color="#f4f1ea" roughness={0.52} metalness={0.02} />;
  const glass = <meshStandardMaterial color="#b9d6df" transparent opacity={0.55} roughness={0.18} metalness={0.02} />;
  const dark = <meshStandardMaterial color="#2f2c2a" roughness={0.55} />;
  const wood = <meshStandardMaterial color="#b9ad9d" roughness={0.72} />;
  const fabric = <meshStandardMaterial color="#d6d0c4" roughness={0.86} />;

  if (text.includes('bed')) {
    return (
      <group>
        <mesh position={[0, 0.18, 0]}>
          <boxGeometry args={[w, 0.22, d]} />
          {wood}
        </mesh>
        <mesh position={[0, 0.38, 0.08]}>
          <boxGeometry args={[w * 0.9, 0.22, d * 0.82]} />
          {fabric}
        </mesh>
        <mesh position={[0, 0.68, -d * 0.36]}>
          <boxGeometry args={[w, 0.65, 0.12]} />
          {wood}
        </mesh>
        <mesh position={[-w * 0.22, 0.58, -d * 0.22]}>
          <boxGeometry args={[w * 0.34, 0.13, d * 0.18]} />
          {porcelain}
        </mesh>
        <mesh position={[w * 0.22, 0.58, -d * 0.22]}>
          <boxGeometry args={[w * 0.34, 0.13, d * 0.18]} />
          {porcelain}
        </mesh>
      </group>
    );
  }

  if (text.includes('toilet')) {
    return (
      <group>
        <mesh position={[0, 0.28, -d * 0.32]}>
          <boxGeometry args={[w * 0.78, 0.46, d * 0.22]} />
          {porcelain}
        </mesh>
        <mesh position={[0, 0.2, d * 0.05]} scale={[w * 0.3, 1, d * 0.34]}>
          <cylinderGeometry args={[1, 1, 0.18, 32]} />
          {porcelain}
        </mesh>
        <mesh position={[0, 0.31, d * 0.05]} scale={[w * 0.18, 1, d * 0.22]}>
          <cylinderGeometry args={[1, 1, 0.04, 32]} />
          <meshStandardMaterial color="#d7e6ea" roughness={0.24} />
        </mesh>
      </group>
    );
  }

  if (text.includes('tub') || text.includes('bath')) {
    return (
      <group>
        <mesh position={[0, 0.24, 0]}>
          <boxGeometry args={[w, 0.42, d]} />
          {porcelain}
        </mesh>
        <mesh position={[0, 0.49, 0]} scale={[w * 0.38, 1, d * 0.34]}>
          <cylinderGeometry args={[1, 1, 0.05, 40]} />
          {glass}
        </mesh>
      </group>
    );
  }

  if (text.includes('shower')) {
    return (
      <group>
        <mesh position={[0, 0.08, 0]}>
          <boxGeometry args={[w, 0.12, d]} />
          {porcelain}
        </mesh>
        <mesh position={[0, 1.0, 0]}>
          <boxGeometry args={[w, 1.8, d]} />
          <meshStandardMaterial color="#d5e6ea" transparent opacity={0.25} roughness={0.16} />
        </mesh>
        <mesh position={[0, 1.9, 0]}>
          <boxGeometry args={[w, 0.04, d]} />
          {glass}
        </mesh>
      </group>
    );
  }

  if (text.includes('sink') || text.includes('vanity')) {
    return (
      <group>
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[w, 0.72, d]} />
          {fixtureMaterial}
        </mesh>
        <mesh position={[0, 0.77, 0]} scale={[w * 0.28, 1, d * 0.24]}>
          <cylinderGeometry args={[1, 1, 0.05, 32]} />
          {glass}
        </mesh>
      </group>
    );
  }

  if (text.includes('range') || text.includes('stove')) {
    return (
      <group>
        <mesh position={[0, 0.34, 0]}>
          <boxGeometry args={[w, 0.66, d]} />
          {porcelain}
        </mesh>
        {[-0.22, 0.22].flatMap((x) => [-0.18, 0.18].map((z) => (
          <mesh key={`${x}-${z}`} position={[x * w, 0.69, z * d]} scale={[Math.min(w, d) * 0.08, 1, Math.min(w, d) * 0.08]}>
            <cylinderGeometry args={[1, 1, 0.025, 20]} />
            {dark}
          </mesh>
        )))}
      </group>
    );
  }

  if (text.includes('sofa') || text.includes('couch')) {
    return (
      <group>
        <mesh position={[0, 0.34, 0.08]}>
          <boxGeometry args={[w, 0.42, d * 0.72]} />
          {fabric}
        </mesh>
        <mesh position={[0, 0.72, -d * 0.32]}>
          <boxGeometry args={[w, 0.72, d * 0.18]} />
          {fabric}
        </mesh>
        <mesh position={[-w * 0.48, 0.54, 0.03]}>
          <boxGeometry args={[w * 0.12, 0.54, d * 0.7]} />
          {fabric}
        </mesh>
        <mesh position={[w * 0.48, 0.54, 0.03]}>
          <boxGeometry args={[w * 0.12, 0.54, d * 0.7]} />
          {fabric}
        </mesh>
      </group>
    );
  }

  if (text.includes('chair')) {
    return (
      <group>
        <mesh position={[0, 0.24, 0.08]}>
          <boxGeometry args={[w * 0.82, 0.22, d * 0.7]} />
          {fabric}
        </mesh>
        <mesh position={[0, 0.62, -d * 0.3]}>
          <boxGeometry args={[w * 0.82, 0.68, d * 0.12]} />
          {fabric}
        </mesh>
      </group>
    );
  }

  if (text.includes('dining') || text.includes('table') || text.includes('coffee')) {
    const chairW = Math.min(0.55, w * 0.18);
    return (
      <group>
        <mesh position={[0, 0.58, 0]}>
          <boxGeometry args={[w * 0.74, 0.12, d * 0.58]} />
          {wood}
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[w * 0.12, 0.55, d * 0.12]} />
          {wood}
        </mesh>
        {text.includes('dining') && (
          <>
            <mesh position={[-w * 0.42, 0.28, 0]}><boxGeometry args={[chairW, 0.22, chairW]} />{fabric}</mesh>
            <mesh position={[w * 0.42, 0.28, 0]}><boxGeometry args={[chairW, 0.22, chairW]} />{fabric}</mesh>
            <mesh position={[0, 0.28, -d * 0.42]}><boxGeometry args={[chairW, 0.22, chairW]} />{fabric}</mesh>
            <mesh position={[0, 0.28, d * 0.42]}><boxGeometry args={[chairW, 0.22, chairW]} />{fabric}</mesh>
          </>
        )}
      </group>
    );
  }

  if (text.includes('washer') || text.includes('dryer') || text.includes('laundry')) {
    return (
      <group>
        <mesh position={[0, 0.42, 0]}>
          <boxGeometry args={[w, 0.82, d]} />
          {porcelain}
        </mesh>
        <mesh position={[0, 0.44, d * 0.49]} rotation={[Math.PI / 2, 0, 0]} scale={[Math.min(w, d) * 0.2, 1, Math.min(w, d) * 0.2]}>
          <cylinderGeometry args={[1, 1, 0.04, 24]} />
          {glass}
        </mesh>
      </group>
    );
  }

  return (
    <mesh position={[0, isWindow ? 1.25 : 0.35, 0]}>
      <boxGeometry args={[w, isWindow ? 0.1 : 0.68, d]} />
      {fixtureMaterial}
    </mesh>
  );
}

/* Build a quarter-circle arc for door swing indicator */
function DoorArc({ position, rotation, type, style }: {
  position: [number, number, number];
  rotation: number;
  type: 'door' | 'open' | 'sliding';
  style: 'standard' | 'pocket' | 'entry';
}) {
  const arc = useMemo(() => {
    if (type === 'open') return null; // Open plan — no door at all

    const shape = new THREE.Shape();
    const r = style === 'pocket' ? DOOR_WIDTH * 0.55
      : style === 'entry' ? DOOR_WIDTH * 1.1
      : DOOR_WIDTH * 0.9;
    // Quarter circle arc (door swing)
    shape.moveTo(0, 0);
    const segments = 16;
    for (let i = 0; i <= segments; i++) {
      const angle = (Math.PI / 2) * (i / segments);
      shape.lineTo(Math.cos(angle) * r, Math.sin(angle) * r);
    }
    shape.lineTo(0, 0);
    return shape;
  }, [type, style]);

  const doorLineWidth = style === 'pocket' ? DOOR_WIDTH * 0.55
    : style === 'entry' ? DOOR_WIDTH * 1.1
    : DOOR_WIDTH * 0.9;

  if (!arc) return null;

  return (
    <group position={position} rotation={[- Math.PI / 2, 0, rotation]}>
      <mesh>
        <shapeGeometry args={[arc]} />
        <meshBasicMaterial
          color={type === 'sliding' ? '#60a5fa' : style === 'pocket' ? '#b0a898' : '#a8a29e'}
          transparent
          opacity={style === 'pocket' ? 0.2 : 0.35}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Door line */}
      <mesh position={[doorLineWidth * 0.5, 0, 0.01]}>
        <planeGeometry args={[doorLineWidth, style === 'pocket' ? 0.1 : 0.15]} />
        <meshBasicMaterial color="#78716c" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export default function RoomZones({ rooms, footprint, visible, labelsVisible = true, loftHeight, connections, renderTheme }: Props) {
  const w = footprint.width;
  const d = footprint.depth;

  /* Labels of rooms that have at least one 'open' connection — these get 0 inset
     regardless of type (e.g. an entry that opens directly into the LDK). */
  const openConnectedLabels = useMemo(() => {
    const result = new Set<string>();
    if (!connections) return result;
    for (const conn of connections) {
      if (conn.type === 'open') {
        result.add(conn.from);
        result.add(conn.to);
      }
    }
    return result;
  }, [connections]);

  const zones = useMemo(() => {
    // Loft rooms have out-of-footprint grid coordinates (placed there for evaluator compat).
    // Reposition them above the building's ground center, mirroring LoftPlatform logic.
    const groundRooms = rooms.filter(r => (r.floor ?? 0) < 1);
    const loftRooms = rooms.filter(r => r.floor != null && r.floor >= 1);
    // Anchor loft above the open-plan LDK zone, not the overall ground centroid.
    // Using all-room centroid places the loft in the circulation spine between rooms.
    const ldkGroundRooms = groundRooms.filter(r => OPEN_PLAN_TYPES.has(r.type));
    const loftAnchorRooms = ldkGroundRooms.length > 0 ? ldkGroundRooms : groundRooms;
    const groundCenterX = loftAnchorRooms.length > 0
      ? loftAnchorRooms.reduce((s, r) => s + (r.gx + r.gw / 2), 0) / loftAnchorRooms.length * GRID - w / 2
      : 0;
    const groundCenterZ = loftAnchorRooms.length > 0
      ? loftAnchorRooms.reduce((s, r) => s + (r.gz + r.gd / 2), 0) / loftAnchorRooms.length * GRID - d / 2
      : 0;
    const loftCenterGx = loftRooms.length > 0
      ? loftRooms.reduce((s, r) => s + (r.gx + r.gw / 2), 0) / loftRooms.length
      : 0;
    const loftCenterGz = loftRooms.length > 0
      ? loftRooms.reduce((s, r) => s + (r.gz + r.gd / 2), 0) / loftRooms.length
      : 0;

    return rooms
      .filter(room => room.type !== 'gallery')
      .map(room => {
        const isLoft = room.floor != null && room.floor >= 1;
        let cx: number, cz: number;
        let loftOutOfFootprint = false;
        if (isLoft) {
          // Mirror LoftPlatform.tsx: if the loft room sits inside the building footprint, use
          // real grid coordinates. Only fall back to LDK-centroid repositioning for out-of-footprint
          // synthetic evaluator-compat coords that were never meant to be rendered directly.
          const gWMax = w / GRID;
          const gDMax = d / GRID;
          const withinFootprint = room.gx >= 0 && (room.gx + room.gw) <= gWMax &&
                                  room.gz >= 0 && (room.gz + room.gd) <= gDMax;
          if (withinFootprint) {
            cx = (room.gx + room.gw / 2) * GRID - w / 2;
            cz = (room.gz + room.gd / 2) * GRID - d / 2;
          } else {
            const relX = ((room.gx + room.gw / 2) - loftCenterGx) * GRID;
            const relZ = ((room.gz + room.gd / 2) - loftCenterGz) * GRID;
            cx = groundCenterX + relX;
            cz = groundCenterZ + relZ;
            loftOutOfFootprint = true;
          }
        } else {
          cx = (room.gx + room.gw / 2) * GRID - w / 2;
          cz = (room.gz + room.gd / 2) * GRID - d / 2;
        }
        const rw = room.gw * GRID;
        const rd = room.gd * GRID;
        // Mirror LoftPlatform.tsx: clamp out-of-footprint loft rooms to building boundary so
        // the room zone and the platform always co-locate rather than the zone drifting outside.
        if (loftOutOfFootprint) {
          cx = Math.max(-w / 2 + rw / 2, Math.min(w / 2 - rw / 2, cx));
          cz = Math.max(-d / 2 + rd / 2, Math.min(d / 2 - rd / 2, cz));
        }
        const color = new THREE.Color(room.color);
        return { ...room, cx, cz, rw, rd, color };
      });
  }, [rooms, w, d]);


  /* Compute door positions from connections */
  const doors = useMemo(() => {
    if (!connections) return [];
    const roomMap = new Map(rooms.map(r => [r.label, r]));
    const result: Array<{
      x: number; z: number; rotation: number; type: RoomConnection['type'];
      style: 'standard' | 'pocket' | 'entry';
    }> = [];

    for (const conn of connections) {
      if (conn.type === 'wall' || conn.type === 'open') continue; // walls and open = no door
      const a = roomMap.get(conn.from);
      const b = roomMap.get(conn.to);
      if (!a || !b) continue;
      // Open-plan rooms (kitchen/dining/living) form one continuous space — no door between them
      if (OPEN_PLAN_TYPES.has(a.type) && OPEN_PLAN_TYPES.has(b.type)) continue;

      // Determine door style based on room types
      const aIsPocket = POCKET_DOOR_TYPES.has(a.type);
      const bIsPocket = POCKET_DOOR_TYPES.has(b.type);
      const aIsEntry = a.type === 'entry';
      const bIsEntry = b.type === 'entry';
      let style: 'standard' | 'pocket' | 'entry' = 'standard';
      if (aIsPocket || bIsPocket) style = 'pocket';
      if (aIsEntry || bIsEntry) style = 'entry';

      // Find shared edge between rooms a and b
      const aLeft = a.gx, aRight = a.gx + a.gw;
      const aTop = a.gz, aBottom = a.gz + a.gd;
      const bLeft = b.gx, bRight = b.gx + b.gw;
      const bTop = b.gz, bBottom = b.gz + b.gd;

      // Shared vertical edge (left/right neighbor)
      if (aRight === bLeft && aTop < bBottom && aBottom > bTop) {
        const overlapStart = Math.max(aTop, bTop);
        const overlapEnd = Math.min(aBottom, bBottom);
        const midZ = ((overlapStart + overlapEnd) / 2) * GRID - d / 2;
        const edgeX = aRight * GRID - w / 2;
        result.push({ x: edgeX, z: midZ, rotation: 0, type: conn.type, style });
      } else if (bRight === aLeft && aTop < bBottom && aBottom > bTop) {
        const overlapStart = Math.max(aTop, bTop);
        const overlapEnd = Math.min(aBottom, bBottom);
        const midZ = ((overlapStart + overlapEnd) / 2) * GRID - d / 2;
        const edgeX = aLeft * GRID - w / 2;
        result.push({ x: edgeX, z: midZ, rotation: Math.PI, type: conn.type, style });
      }
      // Shared horizontal edge (top/bottom neighbor)
      else if (aBottom === bTop && aLeft < bRight && aRight > bLeft) {
        const overlapStart = Math.max(aLeft, bLeft);
        const overlapEnd = Math.min(aRight, bRight);
        const midX = ((overlapStart + overlapEnd) / 2) * GRID - w / 2;
        const edgeZ = aBottom * GRID - d / 2;
        result.push({ x: midX, z: edgeZ, rotation: -Math.PI / 2, type: conn.type, style });
      } else if (bBottom === aTop && aLeft < bRight && aRight > bLeft) {
        const overlapStart = Math.max(aLeft, bLeft);
        const overlapEnd = Math.min(aRight, bRight);
        const midX = ((overlapStart + overlapEnd) / 2) * GRID - w / 2;
        const edgeZ = aTop * GRID - d / 2;
        result.push({ x: midX, z: edgeZ, rotation: Math.PI / 2, type: conn.type, style });
      }
    }
    return result;
  }, [connections, rooms, w, d, openConnectedLabels]);

  if (!visible) return null;

  /* LDK warm base slab: covers the bounding box of all open-plan rooms at y=0.02.
     Per-room tiles (y=0.05, inset=0) render on top and exactly fill each open-plan room area.
     Adjacent open-plan tiles share exact edges (zero inset) so they read as one continuous floor.
     The slab shows through only in float-precision hairline gaps between tiles. Deck rooms are excluded. */
  const ldkSlabEl = (() => {
    const openZones = zones.filter(z =>
      !(z.floor != null && z.floor >= 1) &&
      !OUTDOOR_TYPES.has(z.type) &&
      (OPEN_PLAN_TYPES.has(z.type) || openConnectedLabels.has(z.label))
    );
    if (openZones.length === 0) return null;
    const minGx = Math.min(...openZones.map(z => z.gx));
    const minGz = Math.min(...openZones.map(z => z.gz));
    const maxGx = Math.max(...openZones.map(z => z.gx + z.gw));
    const maxGz = Math.max(...openZones.map(z => z.gz + z.gd));
    const [clampedMinGx, clampedMaxGx] = clampSpan(minGx, maxGx, 0, w / GRID);
    const [clampedMinGz, clampedMaxGz] = clampSpan(minGz, maxGz, 0, d / GRID);
    const slabW = (clampedMaxGx - clampedMinGx) * GRID;
    const slabD = (clampedMaxGz - clampedMinGz) * GRID;
    if (slabW <= 0 || slabD <= 0) return null;
    const slabCx = (clampedMinGx + clampedMaxGx) / 2 * GRID - w / 2;
    const slabCz = (clampedMinGz + clampedMaxGz) / 2 * GRID - d / 2;
    return (
      <mesh position={[slabCx, 0.02, slabCz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[slabW, slabD]} />
        <meshBasicMaterial color="#e8d5a3" side={THREE.DoubleSide} />
      </mesh>
    );
  })();

  /* Unified outdoor slab: one seamless plane covering the bounding box of all ground-level outdoor rooms.
     Algorithm often splits a continuous deck/outdoor span into sub-rooms (Deck, Deck (2), Outdoor, etc.).
     A single merged slab eliminates per-section tile seams and suppresses artifact labels.
     Secondary deck/outdoor rooms return null in the render loop below so only the primary label shows.
     Exception: when decks are on OPPOSITE sides of the building (scattered), a single bounding box
     would span the interior — in that case render per-zone slabs so each deck is visually distinct. */
  const deckZonesList = zones.filter(z => OUTDOOR_TYPES.has(z.type) && !(z.floor != null && z.floor >= 1));
  const deckAreScattered = deckZonesList.length > 1 && (() => {
    const totalArea = deckZonesList.reduce((s, z) => s + z.gw * z.gd, 0);
    const minGx = Math.min(...deckZonesList.map(z => z.gx));
    const minGz = Math.min(...deckZonesList.map(z => z.gz));
    const maxGx = Math.max(...deckZonesList.map(z => z.gx + z.gw));
    const maxGz = Math.max(...deckZonesList.map(z => z.gz + z.gd));
    return (maxGx - minGx) * (maxGz - minGz) > totalArea * 1.4;
  })();
  const deckSlabEl = (() => {
    if (deckZonesList.length === 0) return null;
    if (deckAreScattered) {
      // Separate decks on opposite walls — render each as its own slab to avoid spanning the interior
      return (
        <group>
          {deckZonesList.map((z, i) => (
            <mesh key={i} position={[z.cx, 0.03, z.cz]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[z.rw, z.rd]} />
              <meshBasicMaterial color="#d4b47a" side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      );
    }
    const minGx = Math.min(...deckZonesList.map(z => z.gx));
    const minGz = Math.min(...deckZonesList.map(z => z.gz));
    const maxGx = Math.max(...deckZonesList.map(z => z.gx + z.gw));
    const maxGz = Math.max(...deckZonesList.map(z => z.gz + z.gd));
    const slabW = (maxGx - minGx) * GRID;
    const slabD = (maxGz - minGz) * GRID;
    const slabCx = (minGx + maxGx) / 2 * GRID - w / 2;
    const slabCz = (minGz + maxGz) / 2 * GRID - d / 2;
    return (
      <mesh position={[slabCx, 0.03, slabCz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[slabW, slabD]} />
        <meshBasicMaterial color="#d4b47a" side={THREE.DoubleSide} />
      </mesh>
    );
  })();

  return (
    <group>
      {/* LDK unified slab — continuous floor covering all open-plan rooms */}
      {ldkSlabEl}

      {/* Deck unified slab. */}
      {deckSlabEl}

      {/* Room zones */}
      {zones.map((zone, i) => {
        // Handle all floor levels: 0=ground, 0.5=split (+4ft), 1=loft (loftHeight)
        // floor=0.5 is a ground-level bedroom wing — elevation 0, not 4ft
        const floorElev = zone.floor && zone.floor >= 1 && loftHeight
          ? loftHeight
          : 0;
        const yPos = floorElev + 0.05;
        const labelY = floorElev + 4.5; // mid-wall height for readability
        // A room is open-plan if its type is in OPEN_PLAN_TYPES OR if it has at least
        // one 'open' connection — e.g. an entry that opens directly into the LDK.
        const isOpenPlan = !OUTDOOR_TYPES.has(zone.type) && (OPEN_PLAN_TYPES.has(zone.type) || openConnectedLabels.has(zone.label));
        // Loft rooms (floor=1) are elevated platforms — use flush inset so the zone floor
        // covers the LoftPlatform fully rather than appearing as an inset walled box.
        const isLoft = zone.floor != null && zone.floor >= 1;

        // Secondary outdoor rooms ("Deck (2)", "Outdoor (2)", etc.) are algorithm artifacts from
        // splitting a continuous outdoor span. The unified outdoor slab covers them — suppress their
        // individual render so they don't appear as labeled dots inside the outdoor footprint.
        // Generic "Room N" labels and tiny utility-dump rooms are algorithm filler — skip entirely.
        // Only suppress secondary deck labels when decks are contiguous sub-zones of the same deck.
        // When decks are scattered (on opposite walls), each deck is distinct and needs its own label.
        const isDeckSecondary = !deckAreScattered && OUTDOOR_TYPES.has(zone.type) && /\(\d+\)/.test(zone.label);
        // Suppress "Room N" artifacts but keep rooms whose type is a real sleeping space
        // or that contain a bed fixture — the algorithm sometimes labels bedrooms "Room 1".
        const hasBedFixture = zone.fixtures?.some((f: RoomFixture) => f.type === 'bed');
        const isArtifactRoom = /^Room\s+\d+$/i.test(zone.label) && !SLEEPING_ROOM_TYPES.has(zone.type) && !hasBedFixture;
        const isFillerUtility = zone.area < 20 && /laundry|storage/i.test(zone.label);
        if (isDeckSecondary || isArtifactRoom || isFillerUtility) return null;

        const isCloset = zone.type === 'closet' || zone.type === 'walk_in_closet';
        const isOutdoor = OUTDOOR_TYPES.has(zone.type);
        const isVoid = isVoidZone(zone);
        // Outdoor tiles use inset=0 so they're flush with adjacent LDK tiles (no visible seam at LDK/outdoor boundary)
        const inset = isLoft ? 0 : (isOpenPlan || isOutdoor) ? 0 : 0.05;
        const floorOpacity = (isLoft || isOpenPlan || isOutdoor) ? 1.0 : 0.6;
        const floorColor = isOpenPlan ? renderTheme.openPlanFloor : isOutdoor ? renderTheme.deckFloor : renderTheme.roomFloor;
        return (
        <group key={i} position={[zone.cx, yPos, zone.cz]}>
          {isVoid ? (
            <VoidZoneOutline width={zone.rw} depth={zone.rd} renderTheme={renderTheme} />
          ) : (
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[zone.rw - inset, zone.rd - inset]} />
              <meshBasicMaterial color={floorColor} transparent={!isLoft && !isOpenPlan && !isOutdoor} opacity={floorOpacity} side={THREE.DoubleSide} />
            </mesh>
          )}

          {/* Fixtures — semantic 3D symbols rather than generic blocks. */}
          {!isVoid && zone.fixtures?.map((fix: RoomFixture, fi: number) => {
            const fColor = FIXTURE_COLORS[fix.type] || renderTheme.fixtureMaterial;
            const fw = (fix.w || 1) * GRID;
            const fd = (fix.d || 1) * GRID;
            const fx = (fix.x + (fix.w || 1) / 2) * GRID - w / 2 - zone.cx;
            const fz = (fix.z + (fix.d || 1) / 2) * GRID - d / 2 - zone.cz;
            const rotationY = THREE.MathUtils.degToRad(-(fix.rotationDeg ?? 0));
            if (fix.x === undefined && fix.x !== 0) return null;
            if (fix.type === 'door_swing' || fix.type === 'pocket_door' || fix.type === 'bifold_door') return null;
            const isWindow = fix.type.includes('window') || fix.type.includes('glass');
            return (
              <group key={`${fix.id ?? fix.type}-${fi}`} position={[fx, 0, fz]} rotation={[0, rotationY, 0]}>
                <Fixture3D
                  fixture={fix}
                  width={fw}
                  depth={fd}
                  color={fColor}
                  renderTheme={renderTheme}
                  isWindow={isWindow}
                />
              </group>
            );
          })}

          {labelsVisible && (
            <Html
              position={[0, labelY - yPos, 0]}
              center
              distanceFactor={40}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  background: isCloset ? '#9a9490' : renderTheme.labelAccent,
                  color: 'white',
                  width: isCloset ? '14px' : '22px',
                  height: isCloset ? '14px' : '22px',
                  borderRadius: '50%',
                  fontSize: isCloset ? '6px' : '9px',
                  fontFamily: 'monospace',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  margin: '0 auto 2px',
                  opacity: isCloset ? 0.75 : 1,
                }}>
                  {zone.label.charAt(0)}
                </div>
                <div style={{
                  fontSize: isCloset ? '6px' : '7px',
                  fontFamily: 'monospace',
                  color: isCloset ? '#888' : '#5a5a5a',
                  whiteSpace: 'nowrap',
                  opacity: isCloset ? 0.8 : 1,
                }}>
                  {zone.label}
                </div>
              </div>
            </Html>
          )}
        </group>
        );
      })}

      {/* Door swing indicators */}
      {doors.map((door, i) => (
        <DoorArc
          key={`door-${i}`}
          position={[door.x, 0.06, door.z]}
          rotation={door.rotation}
          type={door.type as 'door' | 'open' | 'sliding'}
          style={door.style}
        />
      ))}
    </group>
  );
}
