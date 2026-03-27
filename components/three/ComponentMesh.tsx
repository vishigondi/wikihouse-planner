'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import type { ModularComponent, ComponentPlacement } from '@/lib/types';

interface Props {
  component: ModularComponent;
  placement: ComponentPlacement;
  selected: boolean;
  highlighted: boolean;
  onClick: () => void;
  wallOpacity: number;
  roofVisible: boolean;
}

// Architectural model palette — warm, minimal
const ARCH_COLORS: Record<string, string> = {
  'wall-ext': '#f5f0e8',   // warm white
  'wall-int': '#ebe5d9',   // slightly warmer
  'roof-gable': '#d6d0c4', // warm light gray
  'roof-steep': '#d6d0c4',
  'roof-shed': '#d6d0c4',
  'roof-flat': '#ccc6ba',
  'floor-std': '#e8dcc8',  // warm natural
  'floor-deck': '#c9b896', // cedar hint
  'door-ext': '#8b7355',   // wood accent
  'door-sliding': '#d4e4ec', // glass tint
  'window-std': '#d4e4ec',
  'door-int': '#ddd5c5',
  'foundation': '#bbb5a9',
};

const ARCH_OPACITY: Record<string, number> = {
  'door-sliding': 0.35,
  'window-std': 0.3,
};

// Cache geometries
const geoCache = new Map<string, THREE.BoxGeometry>();
const edgeCache = new Map<string, THREE.EdgesGeometry>();

function getBoxGeo(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w},${h},${d}`;
  let geo = geoCache.get(key);
  if (!geo) { geo = new THREE.BoxGeometry(w, h, d); geoCache.set(key, geo); }
  return geo;
}

function getEdgeGeo(w: number, h: number, d: number): THREE.EdgesGeometry {
  const key = `${w},${h},${d}`;
  let geo = edgeCache.get(key);
  if (!geo) { geo = new THREE.EdgesGeometry(getBoxGeo(w, h, d)); edgeCache.set(key, geo); }
  return geo;
}

/* Window / glass door mesh — simple transparent pane, no frame */
function WindowMesh({ w, h, d, selected, onClick }: {
  w: number; h: number; d: number; selected: boolean; onClick: () => void;
}) {
  return (
    <mesh onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <boxGeometry args={[w, h, d * 0.3]} />
      <meshStandardMaterial
        color="#d4e8f0"
        transparent
        opacity={selected ? 0.4 : 0.2}
        roughness={0.1}
        metalness={0.05}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export default function ComponentMesh({
  component, placement, selected, highlighted, onClick, wallOpacity, roofVisible
}: Props) {
  const { x, y, z } = placement.position;
  const rot = placement.rotation;
  const { width: w, height: h, depth: d } = component.dimensions;
  const scale = placement.scale || { x: 1, y: 1, z: 1 };
  const zone = placement.zone || '';
  const cid = component.id;

  if (zone === 'roof' && !roofVisible) return null;

  const isWall = zone === 'walls' || zone === 'interior';
  const isFloor = zone === 'floor';
  const isOpening = zone === 'openings';
  const isGlass = cid === 'window-std' || cid === 'door-sliding';

  // Architectural model color
  const color = ARCH_COLORS[cid] || '#e0d8cc';
  let opacity = ARCH_OPACITY[cid] || 1;
  if (isWall) opacity *= wallOpacity;

  const boxGeo = useMemo(() => getBoxGeo(w, h, d), [w, h, d]);
  const showEdges = (isWall || isOpening || zone === 'roof') && !isGlass;
  const edgeGeo = useMemo(() => showEdges ? getEdgeGeo(w, h, d) : null, [w, h, d, showEdges]);

  // Subtle selection highlight
  const emissive = selected ? '#e8dcc8' : '#000000';
  const emissiveIntensity = selected ? 0.15 : 0;

  return (
    <group
      position={[x, y, z]}
      rotation={[
        THREE.MathUtils.degToRad(rot.x),
        THREE.MathUtils.degToRad(rot.y),
        THREE.MathUtils.degToRad(rot.z),
      ]}
      scale={[scale.x, scale.y, scale.z]}
    >
      {isGlass ? (
        /* Window / glass door with frame and transparent glass */
        <WindowMesh w={w} h={h} d={d} selected={selected} onClick={onClick} />
      ) : (
        <>
          <mesh
            geometry={boxGeo}
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            castShadow={!isFloor}
            receiveShadow
          >
            <meshStandardMaterial
              color={color}
              transparent={opacity < 1}
              opacity={opacity}
              metalness={0.02}
              roughness={0.95}
              emissive={emissive}
              emissiveIntensity={emissiveIntensity}
              side={THREE.DoubleSide}
              polygonOffset={isOpening}
              polygonOffsetFactor={isOpening ? -1 : 0}
              polygonOffsetUnits={isOpening ? -1 : 0}
            />
          </mesh>

          {/* Architectural edge lines */}
          {edgeGeo && (
            <lineSegments geometry={edgeGeo}>
              <lineBasicMaterial color="#a09080" transparent opacity={highlighted ? 0.25 : 0.1} />
            </lineSegments>
          )}
        </>
      )}
    </group>
  );
}
