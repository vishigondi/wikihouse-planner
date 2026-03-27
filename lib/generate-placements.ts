/**
 * Auto-generates 3D component placements from room grid layout.
 *
 * Takes a DenHome with rooms (gx/gz/gw/gd) and produces placements
 * for foundation, floor, exterior walls, interior walls, and roof.
 */

import type { ComponentPlacement, RoomLayout, DenHome } from './types';

const GRID = 4; // feet per grid unit

// Y positions for components
const Y_FOUNDATION = 0.25;
const Y_FLOOR = 0.83;
const Y_WALL = 5.5;   // center of wall panel
const Y_ROOF = 5.7;   // roof starts above walls

interface BBox {
  minGx: number; maxGx: number;
  minGz: number; maxGz: number;
}

function getBBox(rooms: RoomLayout[]): BBox {
  const ground = rooms.filter(r => !r.floor || r.floor === 0);
  if (ground.length === 0) return { minGx: 0, maxGx: 1, minGz: 0, maxGz: 1 };
  return {
    minGx: Math.min(...ground.map(r => r.gx)),
    maxGx: Math.max(...ground.map(r => r.gx + r.gw)),
    minGz: Math.min(...ground.map(r => r.gz)),
    maxGz: Math.max(...ground.map(r => r.gz + r.gd)),
  };
}

function gridToWorld(gx: number, gz: number, bbox: BBox): { x: number; z: number } {
  const totalW = (bbox.maxGx - bbox.minGx) * GRID;
  const totalD = (bbox.maxGz - bbox.minGz) * GRID;
  return {
    x: (gx - bbox.minGx) * GRID - totalW / 2,
    z: (gz - bbox.minGz) * GRID - totalD / 2,
  };
}

function isOccupied(gx: number, gz: number, rooms: RoomLayout[]): boolean {
  return rooms.some(r =>
    (!r.floor || r.floor === 0) &&
    gx >= r.gx && gx < r.gx + r.gw &&
    gz >= r.gz && gz < r.gz + r.gd
  );
}

export function generatePlacements(home: DenHome): ComponentPlacement[] {
  const placements: ComponentPlacement[] = [];
  const rooms = home.rooms;
  const groundRooms = rooms.filter(r => !r.floor || r.floor === 0);
  const bbox = getBBox(rooms);
  const gridW = bbox.maxGx - bbox.minGx;
  const gridD = bbox.maxGz - bbox.minGz;

  // ── Foundation + Floor ──────────────────────────────────────────────
  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    for (let gz = bbox.minGz; gz < bbox.maxGz; gz++) {
      if (!isOccupied(gx, gz, groundRooms)) continue;
      const { x, z } = gridToWorld(gx, gz, bbox);
      placements.push({
        componentId: 'foundation',
        position: { x, y: Y_FOUNDATION, z },
        rotation: { x: 0, y: 0, z: 0 },
      });
      placements.push({
        componentId: 'floor-std',
        position: { x, y: Y_FLOOR, z },
        rotation: { x: 0, y: 0, z: 0 },
        zone: 'floor',
      });
    }
  }

  // ── Exterior Walls ──────────────────────────────────────────────────
  // North and south walls (rot_y=0, placed along x axis)
  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    // North wall (top edge, z = maxGz)
    if (isOccupied(gx, bbox.maxGz - 1, groundRooms)) {
      const { x } = gridToWorld(gx, 0, bbox);
      const { z } = gridToWorld(0, bbox.maxGz, bbox);
      placements.push({
        componentId: 'wall-ext',
        position: { x, y: Y_WALL, z },
        rotation: { x: 0, y: 0, z: 0 },
        zone: 'walls',
      });
    }
    // South wall (bottom edge, z = minGz)
    if (isOccupied(gx, bbox.minGz, groundRooms)) {
      const { x } = gridToWorld(gx, 0, bbox);
      const { z } = gridToWorld(0, bbox.minGz, bbox);
      placements.push({
        componentId: 'wall-ext',
        position: { x, y: Y_WALL, z },
        rotation: { x: 0, y: 0, z: 0 },
        zone: 'walls',
      });
    }
  }

  // East and west walls (rot_y=90, placed along z axis)
  for (let gz = bbox.minGz; gz < bbox.maxGz; gz++) {
    // West wall (left edge, x = minGx)
    if (isOccupied(bbox.minGx, gz, groundRooms)) {
      const { x } = gridToWorld(bbox.minGx, 0, bbox);
      const { z } = gridToWorld(0, gz, bbox);
      placements.push({
        componentId: 'wall-ext',
        position: { x: x - GRID / 2, y: Y_WALL, z },
        rotation: { x: 0, y: 90, z: 0 },
        zone: 'walls',
      });
    }
    // East wall (right edge, x = maxGx)
    if (isOccupied(bbox.maxGx - 1, gz, groundRooms)) {
      const { x } = gridToWorld(bbox.maxGx, 0, bbox);
      const { z } = gridToWorld(0, gz, bbox);
      placements.push({
        componentId: 'wall-ext',
        position: { x: x - GRID / 2, y: Y_WALL, z },
        rotation: { x: 0, y: 90, z: 0 },
        zone: 'walls',
      });
    }
  }

  // Interior perimeter walls for non-rectangular layouts
  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    for (let gz = bbox.minGz; gz < bbox.maxGz; gz++) {
      if (!isOccupied(gx, gz, groundRooms)) continue;
      // Check if adjacent cell is empty (need exterior wall on that edge)
      if (gz > bbox.minGz && !isOccupied(gx, gz - 1, groundRooms)) {
        const { x } = gridToWorld(gx, 0, bbox);
        const { z } = gridToWorld(0, gz, bbox);
        placements.push({
          componentId: 'wall-ext',
          position: { x, y: Y_WALL, z },
          rotation: { x: 0, y: 0, z: 0 },
          zone: 'walls',
        });
      }
      if (gz < bbox.maxGz - 1 && !isOccupied(gx, gz + 1, groundRooms)) {
        const { x } = gridToWorld(gx, 0, bbox);
        const { z } = gridToWorld(0, gz + 1, bbox);
        placements.push({
          componentId: 'wall-ext',
          position: { x, y: Y_WALL, z },
          rotation: { x: 0, y: 0, z: 0 },
          zone: 'walls',
        });
      }
      if (gx > bbox.minGx && !isOccupied(gx - 1, gz, groundRooms)) {
        const { x } = gridToWorld(gx, 0, bbox);
        const { z } = gridToWorld(0, gz, bbox);
        placements.push({
          componentId: 'wall-ext',
          position: { x: x - GRID / 2, y: Y_WALL, z },
          rotation: { x: 0, y: 90, z: 0 },
          zone: 'walls',
        });
      }
      if (gx < bbox.maxGx - 1 && !isOccupied(gx + 1, gz, groundRooms)) {
        const { x } = gridToWorld(gx + 1, 0, bbox);
        const { z } = gridToWorld(0, gz, bbox);
        placements.push({
          componentId: 'wall-ext',
          position: { x: x - GRID / 2, y: Y_WALL, z },
          rotation: { x: 0, y: 90, z: 0 },
          zone: 'walls',
        });
      }
    }
  }

  // ── Interior Walls (between rooms) ──────────────────────────────────
  for (let i = 0; i < groundRooms.length; i++) {
    const a = groundRooms[i];
    for (let j = i + 1; j < groundRooms.length; j++) {
      const b = groundRooms[j];
      // Check if rooms share an edge
      // Horizontal edge (wall runs along x, faces N/S)
      if (a.gx < b.gx + b.gw && a.gx + a.gw > b.gx) {
        if (a.gz + a.gd === b.gz || b.gz + b.gd === a.gz) {
          const sharedZ = a.gz + a.gd === b.gz ? a.gz + a.gd : b.gz + b.gd;
          const startX = Math.max(a.gx, b.gx);
          const endX = Math.min(a.gx + a.gw, b.gx + b.gw);
          for (let gx = startX; gx < endX; gx++) {
            const { x } = gridToWorld(gx, 0, bbox);
            const { z } = gridToWorld(0, sharedZ, bbox);
            placements.push({
              componentId: 'wall-int',
              position: { x, y: Y_WALL, z },
              rotation: { x: 0, y: 0, z: 0 },
              zone: 'interior',
            });
          }
        }
      }
      // Vertical edge (wall runs along z, faces E/W)
      if (a.gz < b.gz + b.gd && a.gz + a.gd > b.gz) {
        if (a.gx + a.gw === b.gx || b.gx + b.gw === a.gx) {
          const sharedX = a.gx + a.gw === b.gx ? a.gx + a.gw : b.gx + b.gw;
          const startZ = Math.max(a.gz, b.gz);
          const endZ = Math.min(a.gz + a.gd, b.gz + b.gd);
          for (let gz = startZ; gz < endZ; gz++) {
            const { x } = gridToWorld(sharedX, 0, bbox);
            const { z } = gridToWorld(0, gz, bbox);
            placements.push({
              componentId: 'wall-int',
              position: { x: x - GRID / 2, y: Y_WALL, z },
              rotation: { x: 0, y: 90, z: 0 },
              zone: 'interior',
            });
          }
        }
      }
    }
  }

  // ── Roof ────────────────────────────────────────────────────────────
  const roofStyle = home.roofStyle || 'gable';
  const roofComponent = roofStyle === 'a-frame' ? 'roof-steep' :
                        roofStyle === 'steep-gable' ? 'roof-steep' :
                        roofStyle === 'shed' ? 'roof-shed' : 'roof-gable';
  const roofAngle = roofStyle === 'a-frame' ? 60 :
                    roofStyle === 'steep-gable' ? 45 : 25;

  // Two roof planes (north-facing and south-facing)
  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    const hasRoom = Array.from({ length: gridD }, (_, i) =>
      isOccupied(gx, bbox.minGz + i, groundRooms)
    ).some(Boolean);
    if (!hasRoom) continue;

    const { x } = gridToWorld(gx, 0, bbox);
    const halfDepth = (gridD * GRID) / 2;
    const ridgeOffset = halfDepth * 0.4; // ridge position

    // South-facing slope
    placements.push({
      componentId: roofComponent,
      position: { x, y: Y_ROOF, z: -ridgeOffset },
      rotation: { x: -roofAngle, y: 0, z: 0 },
      zone: 'roof',
    });
    // North-facing slope
    placements.push({
      componentId: roofComponent,
      position: { x, y: Y_ROOF, z: ridgeOffset },
      rotation: { x: roofAngle, y: 0, z: 0 },
      zone: 'roof',
    });
  }

  return placements;
}
