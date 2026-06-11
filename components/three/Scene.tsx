'use client';

import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import type { DenHome, ModularComponent, RenderedModelBounds, RenderMode, RenderTheme } from '@/lib/types';
import HomeModel from './HomeModel';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

interface Props {
  home: DenHome;
  components: ModularComponent[];
  selectedComponent: string | null;
  onSelectComponent: (id: string | null) => void;
  wallOpacity: number;
  roofVisible: boolean;
  roomLabelsVisible: boolean;
  activeFloor: number | 'all';
  renderTheme: RenderTheme;
  renderMode: RenderMode;
  onModelBounds?: (bounds: RenderedModelBounds) => void;
}

export interface SceneHandle {
  setTopView: () => void;
  set3DView: () => void;
  setWhiteCutawayView: () => void;
  setFrontElevationView: () => void;
  setSideElevationView: () => void;
}

function SceneBackground({ color }: { color: string }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.setClearColor(color);
  }, [color, gl]);
  return null;
}

function perspectiveCamera(camera: THREE.Camera): THREE.PerspectiveCamera | null {
  return camera instanceof THREE.PerspectiveCamera ? camera : null;
}

/* Inner component that has access to Three.js context */
function CameraControls({
  home,
  renderMode,
  onRef,
}: {
  home: DenHome;
  renderMode: RenderMode;
  onRef: (api: SceneHandle) => void;
}) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const initializedRef = useRef(false);
  const manualDragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    theta: number;
    phi: number;
    radius: number;
    target: THREE.Vector3;
  } | null>(null);
  // Keep a stable ref to the latest api so useEffect can access it without re-running
  const latestApiRef = useRef<SceneHandle | null>(null);
  const w = home.footprint.width;
  const d = home.footprint.depth;
  const h = home.height;
  const maxDim = Math.max(w, d, h);
  const diagonal = Math.sqrt(w * w + d * d);
  const recordCameraState = (cam: THREE.Camera, target: THREE.Vector3) => {
    // eslint-disable-next-line react-hooks/immutability
    gl.domElement.dataset.orbitCamera = [
      cam.position.x,
      cam.position.y,
      cam.position.z,
      target.x,
      target.y,
      target.z,
    ].map((value) => value.toFixed(3)).join(',');
  };

  const setCamera = (
    position: [number, number, number],
    target: [number, number, number],
    fov: number,
    up: [number, number, number] = [0, 1, 0],
  ) => {
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const cam = perspectiveCamera(ctrl.object);
    if (!cam) return;
    cam.up.set(up[0], up[1], up[2]);
    cam.position.set(position[0], position[1], position[2]);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    ctrl.target.set(target[0], target[1], target[2]);
    cam.lookAt(ctrl.target);
    cam.updateMatrixWorld();
    ctrl.update();
    recordCameraState(cam, ctrl.target);
  };

  // Expose camera control methods
  const api: SceneHandle = {
    setTopView: () => {
      const ctrl = controlsRef.current;
      if (!ctrl) return;
      const cam = perspectiveCamera(ctrl.object);
      if (!cam) return;
      // Use a wide FOV and compute distance so the entire footprint diagonal fits
      const fov = 50;
      const halfAngle = (fov * Math.PI / 180) / 2;
      // Account for aspect ratio — use the larger span
      const aspect = cam.aspect || 1;
      const hFov = 2 * Math.atan(Math.tan(halfAngle) * aspect);
      const fitDist = (diagonal / 2) / Math.tan(Math.min(halfAngle, hFov / 2));
      const dist = fitDist * 1.4;
      cam.up.set(0, 0, -1);
      cam.position.set(0, Math.max(dist, 20), 0);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      ctrl.target.set(0, 0, 0);
      cam.lookAt(ctrl.target);
      cam.updateMatrixWorld();
      ctrl.update();
    },
    set3DView: () => {
      // Architectural presentation angle — low enough to show facade
      const fov = 35;
      const halfAngle = (fov * Math.PI / 180) / 2;
      const bboxRadius = Math.sqrt(w * w + d * d + h * h) / 2;
      const fitDist = bboxRadius / Math.sin(halfAngle);
      const dist = fitDist * 1.5;
      setCamera([dist * 0.45, dist * 0.65, dist * 0.45], [0, h * 0.22, 0], fov, [0, 1, 0]);
    },
    setWhiteCutawayView: () => {
      const fov = 32;
      const span = Math.max(w, d);
      const dist = span * 4.2;
      // Look into the short side from a slight height so the A-frame shell reads
      // as a cutaway without the near roof plane hiding the rooms.
      if (home.roofStyle === 'a-frame' || home.roofSemantics?.ridgeAxis === 'x') {
        setCamera([dist, h * 0.54, dist * 0.12], [0, h * 0.3, 0], fov, [0, 1, 0]);
      } else {
        setCamera([0, h * 0.58, dist], [0, h * 0.28, 0], fov, [0, 1, 0]);
      }
    },
    setFrontElevationView: () => {
      const fov = 32;
      const dist = Math.max(w, d, h) * 3.0;
      if (home.roofStyle === 'a-frame' || home.roofSemantics?.ridgeAxis === 'x') {
        setCamera([dist, h * 0.5, 0], [0, h * 0.48, 0], fov, [0, 1, 0]);
      } else {
        setCamera([0, h * 0.5, dist], [0, h * 0.48, 0], fov, [0, 1, 0]);
      }
    },
    setSideElevationView: () => {
      const fov = 32;
      const dist = Math.max(w, d, h) * 3.0;
      if (home.roofStyle === 'a-frame' || home.roofSemantics?.ridgeAxis === 'x') {
        setCamera([0, h * 0.5, dist], [0, h * 0.48, 0], fov, [0, 1, 0]);
      } else {
        setCamera([dist, h * 0.5, 0], [0, h * 0.48, 0], fov, [0, 1, 0]);
      }
    },
  };

  // Keep latestApiRef current on every render (used by the effect below)
  latestApiRef.current = api;

  const snapToRenderMode = () => {
    if (renderMode === 'presentationPlan') {
      latestApiRef.current?.setTopView();
      return;
    }
    if (renderMode === 'cutaway') {
      latestApiRef.current?.setWhiteCutawayView();
      return;
    }
    if (renderMode === 'debugReview' || renderMode === 'presentation3d') {
      latestApiRef.current?.set3DView();
      return;
    }
    latestApiRef.current?.set3DView();
  };

  // Run AFTER React commits: OrbitControls ref callback has already fired,
  // so controlsRef.current is guaranteed non-null. This is the reliable place
  // to snap the camera to the correct 3D position after a plan switch.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      snapToRenderMode();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [home.id, renderMode]);

  useEffect(() => {
    const element = gl.domElement;
    // eslint-disable-next-line react-hooks/immutability
    element.style.touchAction = 'none';
    const isInteractiveMode = () => (
      renderMode === 'presentation3d' ||
      renderMode === 'cutaway' ||
      renderMode === 'debugReview'
    );
    const currentTarget = () => {
      const ctrl = controlsRef.current;
      if (ctrl?.target) return ctrl.target.clone();
      return new THREE.Vector3(0, h * 0.3, 0);
    };
    const applySpherical = (target: THREE.Vector3, spherical: THREE.Spherical) => {
      const next = new THREE.Vector3().setFromSpherical(spherical).add(target);
      camera.position.copy(next);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      const ctrl = controlsRef.current;
      if (ctrl?.target) {
        ctrl.target.copy(target);
        ctrl.update();
      }
      recordCameraState(camera, target);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!isInteractiveMode() || event.button !== 0) return;
      const target = currentTarget();
      const offset = camera.position.clone().sub(target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      manualDragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        theta: spherical.theta,
        phi: spherical.phi,
        radius: spherical.radius,
        target,
      };
      element.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = manualDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const next = new THREE.Spherical(
        drag.radius,
        Math.max(0.18, Math.min(Math.PI / 2.02, drag.phi - dy * 0.006)),
        drag.theta - dx * 0.007,
      );
      applySpherical(drag.target, next);
      event.preventDefault();
    };
    const endPointer = (event: PointerEvent) => {
      const drag = manualDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      manualDragRef.current = null;
      if (element.hasPointerCapture?.(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!isInteractiveMode()) return;
      const target = currentTarget();
      const spherical = new THREE.Spherical().setFromVector3(camera.position.clone().sub(target));
      spherical.radius = Math.max(5, Math.min(maxDim * 6, spherical.radius * Math.exp(event.deltaY * 0.001)));
      applySpherical(target, spherical);
      event.preventDefault();
    };
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endPointer);
    element.addEventListener('pointercancel', endPointer);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endPointer);
      element.removeEventListener('pointercancel', endPointer);
      element.removeEventListener('wheel', onWheel);
    };
  }, [camera, gl.domElement, h, maxDim, renderMode]);

  return (
    <OrbitControls
      ref={(ref) => {
        controlsRef.current = ref;
        if (ref) {
          onRef(api);
          if (!initializedRef.current) {
            initializedRef.current = true;
            window.requestAnimationFrame(() => {
              snapToRenderMode();
            });
          }
        }
      }}
      makeDefault
      minDistance={5}
      maxDistance={maxDim * 6}
      maxPolarAngle={Math.PI / 2.0}
      target={[0, h * 0.3, 0]}
      enableDamping
      dampingFactor={0.05}
      enableRotate={false}
      enableZoom={false}
      enablePan={false}
    />
  );
}

const Scene = forwardRef<SceneHandle, Props>(function Scene({
  home, components, selectedComponent, onSelectComponent,
  wallOpacity, roofVisible, roomLabelsVisible, activeFloor, renderTheme, renderMode, onModelBounds
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
    setWhiteCutawayView: () => apiRef.current?.setWhiteCutawayView(),
    setFrontElevationView: () => apiRef.current?.setFrontElevationView(),
    setSideElevationView: () => apiRef.current?.setSideElevationView(),
  }));

  return (
    <Canvas
      camera={{
        position: [camDist * 0.45, camDist * 0.65, camDist * 0.45],
        fov: 35,
        near: 0.1,
        far: 1000,
      }}
      style={{ background: renderTheme.background }}
      gl={{
        powerPreference: 'high-performance',
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(renderTheme.background);
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          console.warn('WebGL context lost — will attempt restore');
        });
        gl.domElement.addEventListener('webglcontextrestored', () => {
          console.log('WebGL context restored');
          gl.setClearColor(renderTheme.background);
        });
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onSelectComponent(null);
      }}
    >
      {/* Clean architectural lighting */}
      <SceneBackground color={renderTheme.background} />
      <ambientLight intensity={renderTheme.softStudio ? 1.35 : 0.7} color="#faf5ee" />
      <directionalLight position={[50, 80, 30]} intensity={renderTheme.softStudio ? 0.82 : 1.0} color="#fff8f0" castShadow />
      <directionalLight position={[-30, 40, -20]} intensity={renderTheme.softStudio ? 0.62 : 0.3} color="#e8e4f0" />
      <hemisphereLight args={['#faf5ee', '#e0dcd4', renderTheme.softStudio ? 0.68 : 0.3]} />

      {/* Debug review keeps a large ground plane for scale; product modes stay clean. */}
      {renderMode === 'debugReview' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[200, 200]} />
          <meshStandardMaterial color={renderTheme.ground} roughness={1} metalness={0} />
        </mesh>
      )}

      {/* Subtle grid */}
      {renderMode === 'debugReview' && renderTheme.showGrid && (
        <Grid
          args={[120, 120]}
          cellSize={4}
          cellThickness={0.3}
          cellColor={renderTheme.gridCell}
          sectionSize={20}
          sectionThickness={0.4}
          sectionColor={renderTheme.gridSection}
          fadeDistance={80}
          position={[0, 0.005, 0]}
        />
      )}

      {/* Home model */}
      <HomeModel
        home={home}
        components={components}
        selectedComponent={selectedComponent}
        onSelectComponent={onSelectComponent}
        wallOpacity={wallOpacity}
        roofVisible={roofVisible}
        roomLabelsVisible={roomLabelsVisible}
        activeFloor={activeFloor}
        renderTheme={renderTheme}
        renderMode={renderMode}
        onModelBounds={onModelBounds}
      />

      {/* Orbit controls with API — set3DView() is called via useEffect inside CameraControls */}
      <CameraControls home={home} renderMode={renderMode} onRef={(api) => {
        apiRef.current = api;
      }} />
    </Canvas>
  );
});

export default Scene;
