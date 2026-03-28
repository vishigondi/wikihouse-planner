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

// Japandi palette — shou-sugi-ban exterior, hinoki interior
const ARCH_COLORS: Record<string, string> = {
  'wall-ext': '#8a7e6e',   // shou-sugi-ban — dark charred wood exterior
  'wall-int': '#d5cbb8',   // hinoki — warm light interior
  'roof-gable': '#9a9080', // standing seam metal — warm gray
  'roof-steep': '#9a9080',
  'roof-shed': '#9a9080',
  'roof-flat': '#a09688',
  'floor-std': '#e8dcc8',  // warm natural wood floor
  'floor-deck': '#b09870', // western red cedar deck
  'door-ext': '#5a4a35',   // dark wood entry door
  'door-sliding': '#c8dde8', // glass tint
  'window-std': '#c8dde8',
  'door-int': '#c5b9a5',   // lighter interior doors
  'foundation': '#9a948a',
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

  const isExtWall = zone === 'walls';
  const isIntWall = zone === 'interior';
  const isWall = isExtWall || isIntWall;
  const isFloor = zone === 'floor';
  const isOpening = zone === 'openings';
  const isGlass = cid === 'window-std' || cid === 'door-sliding';

  // Architectural model color
  const color = ARCH_COLORS[cid] || '#e0d8cc';
  let opacity = ARCH_OPACITY[cid] || 1;
  if (isWall) opacity *= wallOpacity;

  const boxGeo = useMemo(() => getBoxGeo(w, h, d), [w, h, d]);

  // Edge lines only on: exterior walls (shows panel joints) + openings (defines frames).
  // Interior walls and floors get NO edge lines — avoids the "wire cage" pattern
  // from hundreds of 4ft segment seam lines through the building interior.
  // Selected components always show edges for feedback.
  const showEdges = (isExtWall || isOpening) && !isGlass || selected;
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
            castShadow={isExtWall}
            receiveShadow={isFloor || isExtWall}
          >
            <meshStandardMaterial
              color={color}
              transparent={opacity < 1}
              opacity={opacity}
              metalness={isIntWall ? 0.0 : 0.02}
              roughness={isIntWall ? 1.0 : 0.95}
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
              <lineBasicMaterial color="#706050" transparent opacity={highlighted ? 0.5 : 0.2} />
            </lineSegments>
          )}
        </>
      )}
    </group>
  );
}
