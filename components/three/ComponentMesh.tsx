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
}

export default function ComponentMesh({ component, placement, selected, highlighted, onClick }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const { x, y, z } = placement.position;
  const rot = placement.rotation;
  const { width: w, height: h, depth: d } = component.dimensions;
  const scale = placement.scale || { x: 1, y: 1, z: 1 };
  const mat = component.material;

  const baseColor = new THREE.Color(mat.color);
  const emissive = selected ? new THREE.Color('#3b82f6') : hovered ? new THREE.Color('#334155') : new THREE.Color('#000000');
  const emissiveIntensity = selected ? 0.3 : hovered ? 0.15 : 0;
  const opacity = highlighted ? mat.opacity : mat.opacity * 0.4;

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
        castShadow
        receiveShadow
      >
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial
          color={baseColor}
          transparent={opacity < 1}
          opacity={opacity}
          metalness={mat.metalness}
          roughness={mat.roughness}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
