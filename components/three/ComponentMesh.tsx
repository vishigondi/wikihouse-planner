'use client';

import { useRef, useState } from 'react';
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

export default function ComponentMesh({
  component, placement, selected, highlighted, onClick, wallOpacity, roofVisible
}: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const { x, y, z } = placement.position;
  const rot = placement.rotation;
  const { width: w, height: h, depth: d } = component.dimensions;
  const scale = placement.scale || { x: 1, y: 1, z: 1 };
  const mat = component.material;
  const zone = placement.zone || '';

  // Hide roof when toggled off
  if (zone === 'roof' && !roofVisible) return null;

  const isWall = zone === 'walls' || zone === 'interior';
  const isFloor = zone === 'floor';
  const isOpening = zone === 'openings';

  // Compute opacity based on wall transparency slider
  let opacity = mat.opacity;
  if (isWall) {
    opacity = mat.opacity * wallOpacity;
  } else if (!highlighted && !isFloor) {
    opacity = mat.opacity * 0.4;
  }

  const baseColor = new THREE.Color(mat.color);
  const emissive = selected
    ? new THREE.Color('#4f46e5')
    : hovered
    ? new THREE.Color('#312e81')
    : new THREE.Color('#000000');
  const emissiveIntensity = selected ? 0.25 : hovered ? 0.1 : 0;

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
      <mesh
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHovered(false); document.body.style.cursor = 'default'; }}
        castShadow={!isFloor}
        receiveShadow
      >
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={baseColor}
          transparent={opacity < 1 || isOpening}
          opacity={opacity}
          metalness={mat.metalness}
          roughness={mat.roughness}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Edge lines for architectural look */}
      {(isWall || isOpening) && (
        <lineSegments>
          <edgesGeometry args={[new THREE.BoxGeometry(w, h, d)]} />
          <lineBasicMaterial color="#000000" transparent opacity={0.15} />
        </lineSegments>
      )}
    </group>
  );
}
