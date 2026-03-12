'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import type { DenHome, ModularComponent } from '@/lib/types';
import HomeModel from './HomeModel';

interface Props {
  home: DenHome;
  components: ModularComponent[];
  selectedComponent: string | null;
  onSelectComponent: (id: string | null) => void;
}

export default function Scene({ home, components, selectedComponent, onSelectComponent }: Props) {
  const maxDim = Math.max(home.footprint.width, home.footprint.depth, home.height);
  const camDist = maxDim * 1.2;

  return (
    <Canvas
      camera={{
        position: [camDist * 0.8, camDist * 0.6, camDist * 0.8],
        fov: 45,
        near: 0.1,
        far: 1000,
      }}
      style={{ background: '#0a0a0a' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectComponent(null);
      }}
    >
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[50, 80, 50]} intensity={1} castShadow />
      <directionalLight position={[-30, 40, -20]} intensity={0.3} />
      <Environment preset="city" environmentIntensity={0.2} />

      {/* Ground grid */}
      <Grid
        args={[200, 200]}
        cellSize={4}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={20}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={150}
        position={[0, 0, 0]}
      />

      {/* The home model */}
      <HomeModel
        home={home}
        components={components}
        selectedComponent={selectedComponent}
        onSelectComponent={onSelectComponent}
      />

      {/* Controls */}
      <OrbitControls
        makeDefault
        minDistance={10}
        maxDistance={maxDim * 3}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, home.height / 3, 0]}
      />
    </Canvas>
  );
}
