'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, ContactShadows } from '@react-three/drei';
import type { DenHome, ModularComponent } from '@/lib/types';
import HomeModel from './HomeModel';

interface Props {
  home: DenHome;
  components: ModularComponent[];
  selectedComponent: string | null;
  onSelectComponent: (id: string | null) => void;
  wallOpacity: number;
  roofVisible: boolean;
  roomLabelsVisible: boolean;
}

export default function Scene({
  home, components, selectedComponent, onSelectComponent,
  wallOpacity, roofVisible, roomLabelsVisible
}: Props) {
  const maxDim = Math.max(home.footprint.width, home.footprint.depth, home.height);
  const camDist = maxDim * 1.1;

  return (
    <Canvas
      camera={{
        position: [camDist * 0.7, camDist * 0.5, camDist * 0.7],
        fov: 40,
        near: 0.1,
        far: 1000,
      }}
      style={{ background: '#f5f0eb' }}
      shadows
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectComponent(null);
      }}
    >
      {/* Japandi-inspired warm lighting */}
      <ambientLight intensity={0.5} color="#fef3c7" />
      <directionalLight
        position={[60, 100, 40]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={200}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />
      <directionalLight position={[-40, 60, -30]} intensity={0.3} color="#e0e7ff" />
      <Environment preset="apartment" environmentIntensity={0.15} />

      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color="#e8e0d4" roughness={1} metalness={0} />
      </mesh>

      {/* Grid overlay */}
      <Grid
        args={[200, 200]}
        cellSize={4}
        cellThickness={0.3}
        cellColor="#d4ccc0"
        sectionSize={20}
        sectionThickness={0.6}
        sectionColor="#c4bab0"
        fadeDistance={120}
        position={[0, 0.005, 0]}
      />

      {/* Contact shadows for grounding */}
      <ContactShadows
        position={[0, 0.01, 0]}
        opacity={0.3}
        scale={maxDim * 2}
        blur={2}
        far={20}
      />

      {/* The home model */}
      <HomeModel
        home={home}
        components={components}
        selectedComponent={selectedComponent}
        onSelectComponent={onSelectComponent}
        wallOpacity={wallOpacity}
        roofVisible={roofVisible}
        roomLabelsVisible={roomLabelsVisible}
      />

      {/* Controls */}
      <OrbitControls
        makeDefault
        minDistance={8}
        maxDistance={maxDim * 3}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, home.height / 4, 0]}
        enableDamping
        dampingFactor={0.05}
      />
    </Canvas>
  );
}
