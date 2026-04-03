'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import type { DenHome, ModularComponent } from '@/lib/types';
import HomeModel from './HomeModel';
import * as THREE from 'three';

interface Props {
  home: DenHome;
  components: ModularComponent[];
  selectedComponent: string | null;
  onSelectComponent: (id: string | null) => void;
  wallOpacity: number;
  roofVisible: boolean;
  roomLabelsVisible: boolean;
}

export interface SceneHandle {
  setTopView: () => void;
  set3DView: () => void;
}

/* Inner component that has access to Three.js context */
function CameraControls({ home, onRef }: { home: DenHome; onRef: (api: SceneHandle) => void }) {
  const controlsRef = useRef<any>(null);
  // Keep a stable ref to the latest api so useEffect can access it without re-running
  const latestApiRef = useRef<SceneHandle | null>(null);
  const w = home.footprint.width;
  const d = home.footprint.depth;
  const h = home.height;
  const maxDim = Math.max(w, d, h);
  const diagonal = Math.sqrt(w * w + d * d);

  // Expose camera control methods
  const api: SceneHandle = {
    setTopView: () => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const cam = ctrl.object;
      // Use a wide FOV and compute distance so the entire footprint diagonal fits
      const fov = 50;
      const halfAngle = (fov * Math.PI / 180) / 2;
      // Account for aspect ratio — use the larger span
      const aspect = cam.aspect || 1;
      const hFov = 2 * Math.atan(Math.tan(halfAngle) * aspect);
      const fitDist = (diagonal / 2) / Math.tan(Math.min(halfAngle, hFov / 2));
      const dist = fitDist * 1.4;
      cam.position.set(0, Math.max(dist, 20), 0.01);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      ctrl.target.set(0, 0, 0);
      ctrl.update();
    },
    set3DView: () => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const cam = ctrl.object;
      // Architectural presentation angle — low enough to show facade
      const fov = 35;
      const halfAngle = (fov * Math.PI / 180) / 2;
      const bboxRadius = Math.sqrt(w * w + d * d + h * h) / 2;
      const fitDist = bboxRadius / Math.sin(halfAngle);
      const dist = fitDist * 1.5;
      cam.position.set(dist * 0.45, dist * 0.65, dist * 0.45);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      ctrl.target.set(0, 0, 0);
      ctrl.update();
    },
  };

  // Keep latestApiRef current on every render (used by the effect below)
  latestApiRef.current = api;

  // Run AFTER React commits: OrbitControls ref callback has already fired,
  // so controlsRef.current is guaranteed non-null. This is the reliable place
  // to snap the camera to the correct 3D position after a plan switch.
  useEffect(() => {
    latestApiRef.current?.set3DView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps — runs once after mount (Canvas remounts on plan change via key=)

  return (
    <OrbitControls
      ref={(ref) => {
        controlsRef.current = ref;
        if (ref) onRef(api);
      }}
      makeDefault
      minDistance={5}
      maxDistance={maxDim * 6}
      maxPolarAngle={Math.PI / 2.0}
      target={[0, h * 0.3, 0]}
      enableDamping
      dampingFactor={0.05}
    />
  );
}

const Scene = forwardRef<SceneHandle, Props>(function Scene({
  home, components, selectedComponent, onSelectComponent,
  wallOpacity, roofVisible, roomLabelsVisible
}, ref) {
  const w = home.footprint.width;
  const d = home.footprint.depth;
  const h = home.height;
  const bboxRadius = Math.sqrt(w * w + d * d + h * h) / 2;
  const fov = 35;
  const halfAngle = (fov * Math.PI / 180) / 2;
  const fitDist = bboxRadius / Math.sin(halfAngle);
  const camDist = fitDist * 0.85;
  const maxDim = Math.max(w, d, h);
  const apiRef = useRef<SceneHandle | null>(null);

  useImperativeHandle(ref, () => ({
    setTopView: () => apiRef.current?.setTopView(),
    set3DView: () => apiRef.current?.set3DView(),
  }));

  return (
    <Canvas
      camera={{
        position: [camDist * 0.45, camDist * 0.65, camDist * 0.45],
        fov: 35,
        near: 0.1,
        far: 1000,
      }}
      style={{ background: '#f5f0eb' }}
      gl={{
        powerPreference: 'high-performance',
        antialias: true,
        alpha: false,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor('#f5f0eb');
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          console.warn('WebGL context lost — will attempt restore');
        });
        gl.domElement.addEventListener('webglcontextrestored', () => {
          console.log('WebGL context restored');
          gl.setClearColor('#f5f0eb');
        });
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectComponent(null);
      }}
    >
      {/* Clean architectural lighting */}
      <ambientLight intensity={0.7} color="#faf5ee" />
      <directionalLight position={[50, 80, 30]} intensity={1.0} color="#fff8f0" castShadow />
      <directionalLight position={[-30, 40, -20]} intensity={0.3} color="#e8e4f0" />
      <hemisphereLight args={['#faf5ee', '#e0dcd4', 0.3]} />

      {/* Ground — subtle warm */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#ebe5db" roughness={1} metalness={0} />
      </mesh>

      {/* Subtle grid */}
      <Grid
        args={[120, 120]}
        cellSize={4}
        cellThickness={0.3}
        cellColor="#ddd6ca"
        sectionSize={20}
        sectionThickness={0.4}
        sectionColor="#d0c9bd"
        fadeDistance={80}
        position={[0, 0.005, 0]}
      />

      {/* Home model */}
      <HomeModel
        home={home}
        components={components}
        selectedComponent={selectedComponent}
        onSelectComponent={onSelectComponent}
        wallOpacity={wallOpacity}
        roofVisible={roofVisible}
        roomLabelsVisible={roomLabelsVisible}
      />

      {/* Orbit controls with API — set3DView() is called via useEffect inside CameraControls */}
      <CameraControls home={home} onRef={(api) => {
        apiRef.current = api;
      }} />
    </Canvas>
  );
});

export default Scene;
