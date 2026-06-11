'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { DenHome, ModularComponent, RenderedModelBounds, RenderMode, RenderTheme, SourceOpeningSegment, SourceWallSegment } from '@/lib/types';
import * as THREE from 'three';
import ComponentMesh from './ComponentMesh';
import RoomZones from './RoomZones';
import EnvelopeMesh from './EnvelopeMesh';
import LoftPlatform from './LoftPlatform';

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

function SourceWallMesh({
  home,
  wallOpacity,
  activeFloor,
  renderTheme,
  renderMode,
}: {
  home: DenHome;
  wallOpacity: number;
  activeFloor: number | 'all';
  renderTheme: RenderTheme;
  renderMode: RenderMode;
}) {
  const walls = (home.sourceWalls ?? []).filter((wall) => activeFloor === 'all' || (wall.floor ?? 0) === activeFloor);
  const openings = (home.sourceOpenings ?? []).filter((opening) => activeFloor === 'all' || (opening.floor ?? 0) === activeFloor);
  // Paired artifacts carry 2D architectural wall traces, not modular panel parts.
  // Render them as readable cutaway walls until explicit roof/elevation JSON
  // provides exact wall plate/knee heights.
  const exteriorWallHeight = home.roofStyle === 'a-frame' ? 6.5 : 8;
  const interiorWallHeight = home.roofStyle === 'a-frame' ? 7.25 : 8;
  const loftHeight = home.loftHeight ?? 8;

  return (
    <group>
      {walls.flatMap((wall, index) => {
        const wallKind = (wall.wallKind ?? '').toLowerCase();
        const isVoidMarker = wallKind.includes('voidmarker') || wallKind.includes('opentobelow');
        const isGuideWall = isVoidMarker || wallKind.includes('dashed') || wallKind.includes('overhead');
        if (renderMode !== 'debugReview' && isGuideWall) return null;
        const x1 = wall.x1 * 4 - home.footprint.width / 2;
        const z1 = wall.z1 * 4 - home.footprint.depth / 2;
        const x2 = wall.x2 * 4 - home.footprint.width / 2;
        const z2 = wall.z2 * 4 - home.footprint.depth / 2;
        const dx = x2 - x1;
        const dz = z2 - z1;
        const length = Math.hypot(dx, dz);
        if (length < 0.05) return null;
        const floorElev = (wall.floor ?? 0) >= 1 ? loftHeight : 0;
        const isGuardRail = wallKind.includes('guardrail') || wallKind.includes('guard');
        const thickness = wall.exterior ? 0.18 : isGuardRail ? 0.08 : 0.1;
        const height = isVoidMarker ? 0.08 : isGuardRail ? 3.2 : wall.exterior ? exteriorWallHeight : interiorWallHeight;
        const segments = splitWallByOpenings(wall, openings);
        return segments.map((segment, segmentIndex) => (
          <group
            key={`${wall.id ?? index}-${segmentIndex}`}
            position={[
              ((segment.x1 + segment.x2) * 4 - home.footprint.width) / 2,
              floorElev + height / 2 + 0.08,
              ((segment.z1 + segment.z2) * 4 - home.footprint.depth) / 2,
            ]}
            rotation={[0, -Math.atan2((segment.z2 - segment.z1) * 4, (segment.x2 - segment.x1) * 4), 0]}
          >
            <mesh>
              <boxGeometry args={[Math.hypot((segment.x2 - segment.x1) * 4, (segment.z2 - segment.z1) * 4), height, thickness]} />
              <meshStandardMaterial
                color={wall.exterior ? renderTheme.exteriorWall : renderTheme.interiorWall}
                transparent={wallOpacity < 1}
                opacity={isGuideWall ? 0.36 : Math.max(0.18, wallOpacity)}
                roughness={0.9}
                side={THREE.DoubleSide}
              />
            </mesh>
          </group>
        ));
      })}
      {openings.filter((opening) => opening.kind === 'window').map((opening, index) => (
        <WindowOpeningMesh
          key={opening.id ?? index}
          opening={opening}
          footprint={home.footprint}
          floorElev={(opening.floor ?? 0) >= 1 ? loftHeight : 0}
        />
      ))}
    </group>
  );
}

function PairedBasePlate({
  home,
  activeFloor,
  renderTheme,
}: {
  home: DenHome;
  activeFloor: number | 'all';
  renderTheme: RenderTheme;
}) {
  const floors = activeFloor === 'all'
    ? [...new Set(home.rooms.map((room) => room.floor ?? 0))]
    : [activeFloor];
  const loftHeight = home.loftHeight ?? 8;
  const isVoidRoom = (room: DenHome['rooms'][number]) => /void|open.to.below/i.test(`${room.type} ${room.label}`);
  const isExteriorRoom = (room: DenHome['rooms'][number]) => /deck|porch|patio|exterior|eave|clearance/i.test(`${room.type} ${room.label}`);

  return (
    <group>
      {floors.flatMap((floor) => {
        const floorRooms = home.rooms.filter((room) => (room.floor ?? 0) === floor && !isVoidRoom(room) && !isExteriorRoom(room));
        if (!floorRooms.length) return null;
        const y = floor >= 1 ? loftHeight + 0.015 : 0.015;
        return floorRooms.map((room, roomIndex) => {
          const width = Math.max(0.1, room.gw * 4);
          const depth = Math.max(0.1, room.gd * 4);
          const cx = (room.gx + room.gw / 2) * 4 - home.footprint.width / 2;
          const cz = (room.gz + room.gd / 2) * 4 - home.footprint.depth / 2;
          return (
            <mesh key={`${floor}-${room.label}-${room.gx}-${room.gz}-${roomIndex}`} position={[cx, y, cz]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2}>
              <planeGeometry args={[width, depth]} />
              <meshBasicMaterial color={renderTheme.roomFloor} side={THREE.DoubleSide} />
            </mesh>
          );
        });
      })}
    </group>
  );
}

function openingOverlapsWall(wall: SourceWallSegment, opening: SourceOpeningSegment): boolean {
  if (opening.wallId && wall.id && opening.wallId !== wall.id) return false;
  if ((opening.floor ?? 0) !== (wall.floor ?? 0)) return false;
  const wallVertical = Math.abs(wall.x1 - wall.x2) < 0.001;
  const openingVertical = Math.abs(opening.x1 - opening.x2) < 0.001;
  if (wallVertical !== openingVertical) return false;
  if (wallVertical) {
    if (Math.abs(wall.x1 - opening.x1) > 0.08) return false;
    return Math.max(Math.min(opening.z1, opening.z2), Math.min(wall.z1, wall.z2)) <
      Math.min(Math.max(opening.z1, opening.z2), Math.max(wall.z1, wall.z2)) - 0.001;
  }
  if (Math.abs(wall.z1 - opening.z1) > 0.08) return false;
  return Math.max(Math.min(opening.x1, opening.x2), Math.min(wall.x1, wall.x2)) <
    Math.min(Math.max(opening.x1, opening.x2), Math.max(wall.x1, wall.x2)) - 0.001;
}

function splitWallByOpenings(wall: SourceWallSegment, openings: SourceOpeningSegment[]): SourceWallSegment[] {
  const wallVertical = Math.abs(wall.x1 - wall.x2) < 0.001;
  const wallStart = wallVertical ? Math.min(wall.z1, wall.z2) : Math.min(wall.x1, wall.x2);
  const wallEnd = wallVertical ? Math.max(wall.z1, wall.z2) : Math.max(wall.x1, wall.x2);
  const cuts = openings
    .filter((opening) => opening.kind !== 'opening' || opening.wallId)
    .filter((opening) => openingOverlapsWall(wall, opening))
    .map((opening) => {
      const start = wallVertical ? Math.min(opening.z1, opening.z2) : Math.min(opening.x1, opening.x2);
      const end = wallVertical ? Math.max(opening.z1, opening.z2) : Math.max(opening.x1, opening.x2);
      return { start: Math.max(wallStart, start), end: Math.min(wallEnd, end) };
    })
    .filter((cut) => cut.end - cut.start > 0.05)
    .sort((a, b) => a.start - b.start);

  if (!cuts.length) return [wall];

  const segments: SourceWallSegment[] = [];
  let cursor = wallStart;
  const pushSegment = (start: number, end: number) => {
    if (end - start < 0.05) return;
    segments.push({
      ...wall,
      x1: wallVertical ? wall.x1 : start,
      z1: wallVertical ? start : wall.z1,
      x2: wallVertical ? wall.x2 : end,
      z2: wallVertical ? end : wall.z2,
    });
  };
  for (const cut of cuts) {
    pushSegment(cursor, cut.start);
    cursor = Math.max(cursor, cut.end);
  }
  pushSegment(cursor, wallEnd);
  return segments.length ? segments : [wall];
}

function WindowOpeningMesh({
  opening,
  footprint,
  floorElev,
}: {
  opening: SourceOpeningSegment;
  footprint: { width: number; depth: number };
  floorElev: number;
}) {
  const x1 = opening.x1 * 4 - footprint.width / 2;
  const z1 = opening.z1 * 4 - footprint.depth / 2;
  const x2 = opening.x2 * 4 - footprint.width / 2;
  const z2 = opening.z2 * 4 - footprint.depth / 2;
  const length = Math.max(0.35, Math.hypot(x2 - x1, z2 - z1));
  const rotation = -Math.atan2(z2 - z1, x2 - x1);
  return (
    <group position={[(x1 + x2) / 2, floorElev + 4.4, (z1 + z2) / 2]} rotation={[0, rotation, 0]}>
      <mesh>
        <boxGeometry args={[length, 2.4, 0.05]} />
        <meshStandardMaterial color="#dceaf1" transparent opacity={0.44} roughness={0.35} />
      </mesh>
      <mesh position={[0, -1.3, 0]}>
        <boxGeometry args={[length, 0.07, 0.12]} />
        <meshStandardMaterial color="#9fb3bc" roughness={0.8} />
      </mesh>
    </group>
  );
}

function PairedRoofShell({
  home,
  roofVisible,
  renderTheme,
  renderMode,
}: {
  home: DenHome;
  roofVisible: boolean;
  renderTheme: RenderTheme;
  renderMode: RenderMode;
}) {
  const roofGeometry = useMemo(() => {
    if (home.roofSemantics?.source === 'paired-json' && home.roofSemantics.planes?.length) {
      const vertices: number[] = [];
      for (const plane of home.roofSemantics.planes) {
        if (plane.points.length < 3) continue;
        if (renderMode === 'cutaway') {
          const avgZ = plane.points.reduce((sum, point) => sum + point.z, 0) / plane.points.length;
          if (avgZ > home.footprint.depth / 2) continue;
        }
        const [first, ...rest] = plane.points;
        for (let index = 0; index < rest.length - 1; index += 1) {
          const tri = [first, rest[index], rest[index + 1]];
          for (const point of tri) {
            vertices.push(point.x - home.footprint.width / 2, point.y, point.z - home.footprint.depth / 2);
          }
        }
      }
      if (vertices.length >= 9) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        geometry.computeVertexNormals();
        return geometry;
      }
    }

    const w = home.footprint.width;
    const d = home.footprint.depth;
    const roof = home.roofSemantics;
    const overhang = roof?.overhangFt ?? 1.25;
    const ridgeY = roof?.ridgeHeightFt ?? home.height;
    const eaveY = roof?.eaveHeightFt ?? (home.roofStyle === 'a-frame' ? 0.35 : Math.max(7, home.height * 0.45));
    const thickness = roof?.roofThicknessFt ?? 0.35;
    const zEave = d / 2 + overhang;
    const x0 = -w / 2 - overhang;
    const x1 = w / 2 + overhang;

    if (home.roofStyle === 'flat') {
      const geometry = new THREE.BoxGeometry(w + overhang * 2, thickness, d + overhang * 2);
      geometry.translate(0, ridgeY, 0);
      return geometry;
    }

    if (home.roofStyle === 'shed') {
      const lowY = Math.min(eaveY, ridgeY);
      const highY = Math.max(eaveY, ridgeY);
      const vertices = new Float32Array([
        x0, lowY, -zEave, x1, lowY, -zEave, x1, highY, zEave,
        x0, lowY, -zEave, x1, highY, zEave, x0, highY, zEave,
      ]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      return geometry;
    }

    const vertices = new Float32Array([
      x0, eaveY, -zEave, x1, eaveY, -zEave, x1, ridgeY, 0,
      x0, eaveY, -zEave, x1, ridgeY, 0, x0, ridgeY, 0,
      x1, eaveY, zEave, x0, eaveY, zEave, x0, ridgeY, 0,
      x1, eaveY, zEave, x0, ridgeY, 0, x1, ridgeY, 0,
    ]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [home.footprint.depth, home.footprint.width, home.height, home.roofSemantics, home.roofStyle, renderMode]);

  const frameSegments = useMemo(() => {
    if (home.roofSemantics?.source === 'paired-json' && home.roofSemantics.planes?.length) {
      const ridgePlanes = home.roofSemantics.planes.filter((plane) => plane.role === 'ridge' || plane.role === 'eave');
      return ridgePlanes.flatMap((plane) => {
        const segments: Array<{ a: [number, number, number]; b: [number, number, number] }> = [];
        for (let index = 0; index < plane.points.length - 1; index += 1) {
          const a = plane.points[index];
          const b = plane.points[index + 1];
          segments.push({
            a: [a.x - home.footprint.width / 2, a.y, a.z - home.footprint.depth / 2],
            b: [b.x - home.footprint.width / 2, b.y, b.z - home.footprint.depth / 2],
          });
        }
        return segments;
      });
    }

    const w = home.footprint.width;
    const d = home.footprint.depth;
    const roof = home.roofSemantics;
    const overhang = roof?.overhangFt ?? 1.25;
    const ridgeY = roof?.ridgeHeightFt ?? home.height;
    const eaveY = roof?.eaveHeightFt ?? (home.roofStyle === 'a-frame' ? 0.35 : Math.max(7, home.height * 0.45));
    const zEave = d / 2 + overhang;
    const x0 = -w / 2 - overhang;
    const x1 = w / 2 + overhang;
    return [
      { a: [x0, eaveY, -zEave], b: [x0, ridgeY, 0] },
      { a: [x0, ridgeY, 0], b: [x0, eaveY, zEave] },
      { a: [x1, eaveY, -zEave], b: [x1, ridgeY, 0] },
      { a: [x1, ridgeY, 0], b: [x1, eaveY, zEave] },
      { a: [x0, ridgeY, 0], b: [x1, ridgeY, 0] },
      { a: [x0, eaveY, -zEave], b: [x1, eaveY, -zEave] },
      { a: [x0, eaveY, zEave], b: [x1, eaveY, zEave] },
    ] as Array<{ a: [number, number, number]; b: [number, number, number] }>;
  }, [home.footprint.depth, home.footprint.width, home.height, home.roofSemantics, home.roofStyle]);

  if (!roofVisible) return null;

  const shellOpacity = renderMode === 'debugReview'
    ? 0.22
    : renderMode === 'cutaway'
      ? 0.3
      : renderMode === 'elevation'
        ? 0.58
        : 0.34;
  const shellColor = renderMode === 'debugReview' ? '#d4c7b5' : '#dfd4c2';
  const frameColor = '#312d28';
  const showCleanRoofFrame = roofVisible && renderMode !== 'debugReview' && renderMode !== 'presentationPlan';

  return (
    <group>
      <mesh geometry={roofGeometry} renderOrder={-1}>
        <meshStandardMaterial
          color={shellColor}
          transparent
          opacity={shellOpacity}
          roughness={0.82}
          metalness={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      {(renderMode === 'debugReview' || showCleanRoofFrame) && home.roofStyle !== 'flat' && frameSegments.map((segment, index) => {
        const a = new THREE.Vector3(...segment.a);
        const b = new THREE.Vector3(...segment.b);
        const midpoint = a.clone().add(b).multiplyScalar(0.5);
        const length = a.distanceTo(b);
        const direction = b.clone().sub(a).normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
        return (
          <mesh key={index} position={midpoint} quaternion={quaternion}>
            <boxGeometry args={[length, renderMode === 'debugReview' ? 0.12 : 0.08, renderMode === 'debugReview' ? 0.12 : 0.08]} />
            <meshStandardMaterial color={frameColor} roughness={0.9} />
          </mesh>
        );
      })}
      {home.roofStyle === 'a-frame' && home.roofSemantics?.source === 'paired-json' && renderMode !== 'debugReview' && (
        <AFrameEndCaps home={home} renderTheme={renderTheme} renderMode={renderMode} />
      )}
    </group>
  );
}

function AFrameEndCaps({ home, renderTheme, renderMode }: { home: DenHome; renderTheme: RenderTheme; renderMode: RenderMode }) {
  const caps = useMemo(() => {
    const roof = home.roofSemantics;
    if (!roof) return [];
    const overhang = roof.overhangFt ?? 1.25;
    const eaveY = roof.eaveHeightFt ?? 0.35;
    const ridgeY = roof.ridgeHeightFt ?? home.height;
    const z0 = -overhang;
    const z1 = home.footprint.depth + overhang;
    const ridgeZ = home.footprint.depth / 2;
    const xs = [-overhang, home.footprint.width + overhang];
    return xs.map((x) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        x - home.footprint.width / 2, eaveY, z0 - home.footprint.depth / 2,
        x - home.footprint.width / 2, eaveY, z1 - home.footprint.depth / 2,
        x - home.footprint.width / 2, ridgeY, ridgeZ - home.footprint.depth / 2,
      ]), 3));
      geometry.computeVertexNormals();
      return geometry;
    });
  }, [home.footprint.depth, home.footprint.width, home.height, home.roofSemantics]);

  const opacity = renderMode === 'cutaway' ? 0.24 : 0.42;
  const color = '#eadfce';

  return (
    <>
      {caps.map((geometry, index) => (
        <mesh key={index} geometry={geometry}>
          <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.86} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

function ElevationOutlineGuides({ home, roofVisible, renderMode }: { home: DenHome; roofVisible: boolean; renderMode: RenderMode }) {
  const segments = useMemo(() => {
    if (renderMode !== 'debugReview' || !roofVisible || home.roofSemantics?.source !== 'paired-json' || !home.roofSemantics.elevations?.length) {
      return [];
    }
    const overhang = home.roofSemantics.overhangFt ?? 0;
    const frontZ = home.footprint.depth / 2 + overhang + 0.09;
    const sideX = home.footprint.width / 2 + overhang + 0.09;
    const result: Array<{ a: [number, number, number]; b: [number, number, number] }> = [];
    for (const elevation of home.roofSemantics.elevations) {
      if (elevation.outline.length < 2) continue;
      const isSide = elevation.view === 'side' || elevation.view === 'left' || elevation.view === 'right';
      for (let index = 0; index < elevation.outline.length; index += 1) {
        const a = elevation.outline[index];
        const b = elevation.outline[(index + 1) % elevation.outline.length];
        result.push(isSide
          ? {
            a: [sideX, a.y, a.x - home.footprint.depth / 2],
            b: [sideX, b.y, b.x - home.footprint.depth / 2],
          }
          : {
            a: [a.x - home.footprint.width / 2, a.y, frontZ],
            b: [b.x - home.footprint.width / 2, b.y, frontZ],
          });
      }
    }
    return result;
  }, [home.footprint.depth, home.footprint.width, home.roofSemantics, roofVisible, renderMode]);

  if (!segments.length) return null;

  return (
    <group>
      {segments.map((segment, index) => {
        const a = new THREE.Vector3(...segment.a);
        const b = new THREE.Vector3(...segment.b);
        const midpoint = a.clone().add(b).multiplyScalar(0.5);
        const length = a.distanceTo(b);
        const direction = b.clone().sub(a).normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
        return (
          <mesh key={index} position={midpoint} quaternion={quaternion}>
            <boxGeometry args={[length, 0.08, 0.08]} />
            <meshStandardMaterial color="#c9b8a2" roughness={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function HomeModel({
  home, components, selectedComponent, onSelectComponent,
  wallOpacity, roofVisible, roomLabelsVisible, activeFloor, renderTheme, renderMode, onModelBounds
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const compMap = new Map(components.map(c => [c.id, c]));
  const pairedMode = home.pairedArtifact === true;

  // Render ALL placements as individual panels (walls, floors, openings).
  // Roof is handled by EnvelopeMesh. Walls are individual 4ft panels
  // so door/window openings show as gaps.
  const visiblePlacements = home.placements.filter(p => {
    const zone = p.zone || '';
    if (zone === 'roof') return false; // envelope handles roof
    return true;
  });

  const pairedRenderStats = {
    roomCount: activeFloor === 'all' ? home.rooms.length : home.rooms.filter((room) => (room.floor ?? 0) === activeFloor).length,
    wallCount: (home.sourceWalls ?? []).filter((wall) => activeFloor === 'all' || (wall.floor ?? 0) === activeFloor).length,
    openingCount: (home.sourceOpenings ?? []).filter((opening) => activeFloor === 'all' || (opening.floor ?? 0) === activeFloor).length,
    fixtureCount: home.rooms
      .filter((room) => activeFloor === 'all' || (room.floor ?? 0) === activeFloor)
      .reduce((count, room) => count + (room.fixtures?.length ?? 0), 0),
  };

  useEffect(() => {
    if (!groupRef.current || !onModelBounds) return;
    const frame = window.requestAnimationFrame(() => {
      if (!groupRef.current) return;
      const box = new THREE.Box3().setFromObject(groupRef.current);
      if (box.isEmpty()) return;
      const width = box.max.x - box.min.x;
      const height = box.max.y - box.min.y;
      const depth = box.max.z - box.min.z;
      let objectCount = 0;
      let visibleObjectCount = 0;
      groupRef.current.traverse((object) => {
        objectCount += 1;
        if (object.visible) visibleObjectCount += 1;
      });
      const blockers: string[] = [];
      const allowance = 2.5;
      const roomExtents = home.rooms.reduce((extents, room) => ({
        minX: Math.min(extents.minX, room.gx * 4),
        minZ: Math.min(extents.minZ, room.gz * 4),
        maxX: Math.max(extents.maxX, (room.gx + room.gw) * 4),
        maxZ: Math.max(extents.maxZ, (room.gz + room.gd) * 4),
      }), { minX: 0, minZ: 0, maxX: home.footprint.width, maxZ: home.footprint.depth });
      const semanticWidth = roomExtents.maxX - roomExtents.minX;
      const semanticDepth = roomExtents.maxZ - roomExtents.minZ;
      const roofOverhang = roofVisible ? (home.roofSemantics?.overhangFt ?? 1.25) * 2 : 0;
      const roofAllowance = roofVisible ? roofOverhang : 0;
      const expectedWidth = Math.max(home.footprint.width, semanticWidth) + roofAllowance;
      const expectedDepth = Math.max(home.footprint.depth, semanticDepth) + roofAllowance;
      if (pairedMode && width > expectedWidth + allowance) {
        blockers.push(`3D width ${width.toFixed(1)} ft exceeds expected ${expectedWidth.toFixed(1)} ft`);
      }
      if (pairedMode && depth > expectedDepth + allowance) {
        blockers.push(`3D depth ${depth.toFixed(1)} ft exceeds expected ${expectedDepth.toFixed(1)} ft`);
      }
      onModelBounds({
        minX: box.min.x,
        minY: box.min.y,
        minZ: box.min.z,
        maxX: box.max.x,
        maxY: box.max.y,
        maxZ: box.max.z,
        width,
        height,
        depth,
        status: blockers.length ? 'blocked' : 'pass',
        blockers,
        objectCount,
        visibleObjectCount,
        semanticObjectCount: pairedMode
          ? pairedRenderStats.roomCount + pairedRenderStats.wallCount + pairedRenderStats.openingCount + pairedRenderStats.fixtureCount
          : visiblePlacements.length,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeFloor, home.footprint.depth, home.footprint.width, home.roofStyle, onModelBounds, pairedMode, roofVisible, wallOpacity]);

  return (
    <group ref={groupRef}>
      {/* Building envelope — proper extruded cross-section */}
      {!pairedMode && (
        <EnvelopeMesh
          home={home}
          wallOpacity={wallOpacity}
          roofVisible={roofVisible}
        />
      )}

      {pairedMode && (
        <PairedBasePlate home={home} activeFloor={activeFloor} renderTheme={renderTheme} />
      )}

      {/* Room zone overlays */}
      <RoomZones
        rooms={activeFloor === 'all' ? home.rooms : home.rooms.filter((room) => (room.floor ?? 0) === activeFloor)}
        footprint={home.footprint}
        visible
        labelsVisible={roomLabelsVisible}
        loftHeight={home.loftHeight}
        connections={home.connections}
        renderTheme={renderTheme}
      />

      {pairedMode && (
        <SourceWallMesh home={home} wallOpacity={wallOpacity} activeFloor={activeFloor} renderTheme={renderTheme} renderMode={renderMode} />
      )}

      {pairedMode && (
        <PairedRoofShell home={home} roofVisible={roofVisible} renderTheme={renderTheme} renderMode={renderMode} />
      )}

      {pairedMode && (
        <ElevationOutlineGuides home={home} roofVisible={roofVisible} renderMode={renderMode} />
      )}

      {pairedMode && renderMode === 'debugReview' && (
        <group userData={{ pairedRenderStats }} />
      )}

      {/* Loft floor platform */}
      {!pairedMode && home.loftHeight != null && (
        <LoftPlatform
          footprint={home.footprint}
          loftHeight={home.loftHeight}
          rooms={home.rooms}
        />
      )}

      {/* All elements: walls (as panels), floors, interior walls, openings */}
      {!pairedMode && visiblePlacements.map((placement, i) => {
        const comp = compMap.get(placement.componentId);
        if (!comp) return null;

        const isSelected = selectedComponent === placement.componentId;
        const isHighlighted = !selectedComponent || isSelected;

        return (
          <ComponentMesh
            key={i}
            component={comp}
            placement={placement}
            selected={isSelected}
            highlighted={isHighlighted}
            onClick={() => onSelectComponent(isSelected ? null : placement.componentId)}
            wallOpacity={wallOpacity}
            roofVisible={roofVisible}
          />
        );
      })}
    </group>
  );
}
