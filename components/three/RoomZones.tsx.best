'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { RoomLayout, RoomConnection, RoomFixture } from '@/lib/types';

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
  loftHeight?: number;
  connections?: RoomConnection[];
}

/** Room types that get pocket doors (smaller arc) */
const POCKET_DOOR_TYPES = new Set([
  'bathroom_full', 'bathroom_half', 'walk_in_closet', 'closet', 'pantry', 'utility',
]);

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

export default function RoomZones({ rooms, footprint, visible, loftHeight, connections }: Props) {
  const w = footprint.width;
  const d = footprint.depth;

  const zones = useMemo(() => {
    // For loft rooms (floor >= 1), reposition ABOVE the building center
    // instead of at their grid position (which is behind the building for evaluator compat)
    const groundRooms = rooms.filter(r => (r.floor ?? 0) < 1 && r.type !== 'stairs');
    const groundCenterX = groundRooms.length > 0
      ? groundRooms.reduce((s, r) => s + (r.gx + r.gw / 2), 0) / groundRooms.length * GRID - w / 2
      : 0;
    const groundCenterZ = groundRooms.length > 0
      ? groundRooms.reduce((s, r) => s + (r.gz + r.gd / 2), 0) / groundRooms.length * GRID - d / 2
      : 0;

    // For multiple loft rooms: compute loft group center, then apply relative offsets
    const loftRooms = rooms.filter(r => (r.floor ?? 0) >= 1);
    const loftCenterGx = loftRooms.length > 0
      ? loftRooms.reduce((s, r) => s + (r.gx + r.gw / 2), 0) / loftRooms.length
      : 0;
    const loftCenterGz = loftRooms.length > 0
      ? loftRooms.reduce((s, r) => s + (r.gz + r.gd / 2), 0) / loftRooms.length
      : 0;

    return rooms.map(room => {
      let cx: number, cz: number;
      if ((room.floor ?? 0) >= 1) {
        // Loft: map to above building center, preserving relative positions between loft rooms
        const relX = ((room.gx + room.gw / 2) - loftCenterGx) * GRID;
        const relZ = ((room.gz + room.gd / 2) - loftCenterGz) * GRID;
        cx = groundCenterX + relX;
        cz = groundCenterZ - d * 0.15 + relZ;
      } else {
        cx = (room.gx + room.gw / 2) * GRID - w / 2;
        cz = (room.gz + room.gd / 2) * GRID - d / 2;
      }
      const rw = room.gw * GRID;
      const rd = room.gd * GRID;
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
  }, [connections, rooms, w, d]);

  if (!visible) return null;

  return (
    <group>
      {/* Room zones */}
      {zones.map((zone, i) => {
        // Handle all floor levels: 0=ground, 0.5=split (+4ft), 1=loft (loftHeight)
        // floor=0.5 is a ground-level bedroom wing — elevation 0, not 4ft
        const floorElev = zone.floor && zone.floor >= 1 && loftHeight
          ? loftHeight
          : 0;
        const yPos = floorElev + 0.05;
        const labelY = floorElev + 4.5; // mid-wall height for readability
        return (
        <group key={i} position={[zone.cx, yPos, zone.cz]}>
          {/* Room floor — light gray like isometric floor plan */}
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[zone.rw - 0.2, zone.rd - 0.2]} />
            <meshBasicMaterial
              color="#d8d0c8"
              transparent
              opacity={0.6}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Fixtures — flat colored shapes on the floor (no labels — room labels are enough) */}
          {zone.fixtures?.map((fix: RoomFixture, fi: number) => {
            const fColor = FIXTURE_COLORS[fix.type] || '#888';
            const fw = (fix.w || 1) * GRID;
            const fd = (fix.d || 1) * GRID;
            const fx = (fix.x + (fix.w || 1) / 2) * GRID - w / 2 - zone.cx;
            const fz = (fix.z + (fix.d || 1) / 2) * GRID - d / 2 - zone.cz;
            if (fix.x === undefined && fix.x !== 0) return null;
            if (fix.type === 'door_swing' || fix.type === 'pocket_door' || fix.type === 'bifold_door') return null;
            const isWindow = fix.type.includes('window') || fix.type.includes('glass');
            const boxH = isWindow ? 0.1 : 0.2;
            return (
              <group key={fi}>
                <mesh position={[fx, boxH / 2 + 0.5, fz]}>
                  <boxGeometry args={[fw - 0.3, boxH, fd - 0.3]} />
                  <meshStandardMaterial
                    color={fColor}
                    transparent={isWindow}
                    opacity={isWindow ? 0.6 : 0.95}
                    roughness={0.6}
                  />
                </mesh>
              </group>
            );
          })}

          {/* HTML label */}
          <Html
            position={[0, labelY - yPos, 0]}
            center
            distanceFactor={40}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{
                background: '#c4857a',
                color: 'white',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                fontSize: '9px',
                fontFamily: 'monospace',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 'bold',
                boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
                margin: '0 auto 2px',
              }}>
                {zone.label.charAt(0)}
              </div>
              <div style={{
                fontSize: '7px',
                fontFamily: 'monospace',
                color: '#5a5a5a',
                whiteSpace: 'nowrap',
              }}>
                {zone.label}
              </div>
            </div>
          </Html>
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
