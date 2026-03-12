'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import type { RoomLayout } from '@/lib/types';

const GRID = 4;

interface Props {
  rooms: RoomLayout[];
  footprint: { width: number; depth: number };
  visible: boolean;
}

export default function RoomZones({ rooms, footprint, visible }: Props) {
  const w = footprint.width;
  const d = footprint.depth;

  const zones = useMemo(() =>
    rooms.map(room => {
      const cx = (room.gx + room.gw / 2) * GRID - w / 2;
      const cz = (room.gz + room.gd / 2) * GRID - d / 2;
      const rw = room.gw * GRID;
      const rd = room.gd * GRID;
      const color = new THREE.Color(room.color);
      return { ...room, cx, cz, rw, rd, color };
    }),
    [rooms, w, d]
  );

  if (!visible) return null;

  return (
    <group>
      {zones.map((zone, i) => (
        <group key={i} position={[zone.cx, 1.05, zone.cz]}>
          {/* Colored floor zone */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[zone.rw - 0.2, zone.rd - 0.2]} />
            <meshStandardMaterial
              color={zone.color}
              transparent
              opacity={0.35}
              roughness={0.9}
              metalness={0}
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Room border */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <planeGeometry args={[zone.rw - 0.05, zone.rd - 0.05]} />
            <meshBasicMaterial
              color={zone.color}
              transparent
              opacity={0.6}
              wireframe
              side={THREE.DoubleSide}
            />
          </mesh>

          {/* Room label */}
          <Text
            position={[0, 0.02, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={Math.min(zone.rw, zone.rd) * 0.18}
            color="white"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.05}
            outlineColor="black"
            maxWidth={zone.rw - 1}
          >
            {zone.label}
          </Text>

          {/* Area label */}
          <Text
            position={[0, 0.02, Math.min(zone.rd, zone.rw) * 0.25]}
            rotation={[-Math.PI / 2, 0, 0]}
            fontSize={Math.min(zone.rw, zone.rd) * 0.11}
            color="#aaa"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.03}
            outlineColor="black"
            maxWidth={zone.rw - 1}
          >
            {zone.area} sf
          </Text>
        </group>
      ))}
    </group>
  );
}
