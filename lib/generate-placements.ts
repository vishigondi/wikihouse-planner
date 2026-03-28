/**
 * Auto-generates 3D component placements from room grid layout.
 *
 * Two-pass approach:
 * Pass 1: Collect all opening positions (doors, windows, entry)
 * Pass 2: Generate wall panels, skipping panels that overlap openings
 *
 * This produces walls with actual door/window cutouts.
 */

import type { ComponentPlacement, RoomLayout, RoomConnection, DenHome } from './types';

const GRID = 4; // feet per grid unit

const Y_FOUNDATION = 0.25;
const Y_FLOOR = 0.83;

// Component heights (must match library.json dimensions)
// Wall center Y = height / 2 so base sits flush at y=0 (ground plane)
const WALL_EXT_H = 10;   // wall-ext height in feet
const WALL_INT_H = 9;    // wall-int height in feet
const WALL_EXT_Y = WALL_EXT_H / 2;   // = 5.0 — center at half-height
const WALL_INT_Y = WALL_INT_H / 2;   // = 4.5

// A-frame knee wall is shorter (foot of the A, ~2ft knee + slope starts)
const WALL_EXT_Y_AFRAME = 3.0;

function wallY(roofStyle: string): number {
  return roofStyle === 'a-frame' ? WALL_EXT_Y_AFRAME : WALL_EXT_Y;
}

function intWallY(): number {
  return WALL_INT_Y;
}

interface BBox {
  minGx: number; maxGx: number;
  minGz: number; maxGz: number;
}

/** A wall segment position key: "gx,gz,orientation" */
type WallKey = string;

/** An opening that should cut through a wall panel */
interface Opening {
  key: WallKey;
  componentId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
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
    gx >= r.gx && gx < r.gx + r.gw &&
    gz >= r.gz && gz < r.gz + r.gd
  );
}

function hKey(gx: number, gz: number): WallKey { return `${gx},${gz},h`; }
function vKey(gx: number, gz: number): WallKey { return `${gx},${gz},v`; }

export function generatePlacements(home: DenHome): ComponentPlacement[] {
  const placements: ComponentPlacement[] = [];
  const rooms = home.rooms;
  // Use the minimum floor level as "ground" (some plans use level 1 as main floor)
  const minFloor = Math.min(...rooms.map(r => r.floor ?? 0));
  const groundRooms = rooms.filter(r => (r.floor ?? 0) === minFloor);
  const bbox = getBBox(rooms);
  const isAFrame = (home.roofStyle || 'gable') === 'a-frame';
  const yWall = wallY(home.roofStyle || 'gable');
  // A-frame exterior walls are scaled to 30% height (knee walls only)
  const extWallScale = isAFrame ? { x: 1, y: 0.3, z: 1 } : undefined;
  const connections = home.connections || [];

  // ── Pass 0: Foundation + Floor ──────────────────────────────────────
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

  // ── Pass 1: Collect all openings ────────────────────────────────────
  const openings = new Map<WallKey, Opening>();

  // Windows: one per facade-facing room
  for (const room of groundRooms) {
    if (room.type === 'closet' || room.type === 'walk_in_closet' ||
        room.type === 'pantry' || room.type === 'hallway' ||
        room.type === 'stair' || room.type === 'landing') continue;

    const midGx = Math.floor(room.gx + room.gw / 2);
    const midGz = Math.floor(room.gz + room.gd / 2);

    // North facade
    if (room.gz + room.gd >= bbox.maxGz || !isOccupied(midGx, room.gz + room.gd, groundRooms)) {
      const key = hKey(midGx, room.gz + room.gd);
      if (!openings.has(key)) {
        const { x } = gridToWorld(midGx, 0, bbox);
        const { z } = gridToWorld(0, room.gz + room.gd, bbox);
        openings.set(key, { key, componentId: 'window-std', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 } });
      }
      continue;
    }
    // South facade
    if (room.gz <= bbox.minGz || !isOccupied(midGx, room.gz - 1, groundRooms)) {
      const key = hKey(midGx, room.gz);
      if (!openings.has(key)) {
        const { x } = gridToWorld(midGx, 0, bbox);
        const { z } = gridToWorld(0, room.gz, bbox);
        openings.set(key, { key, componentId: 'window-std', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 } });
      }
    }
  }

  // Entry door
  const entryRoom = groundRooms.find(r => r.type === 'entry');
  if (entryRoom) {
    const key = hKey(entryRoom.gx, entryRoom.gz);
    const { x } = gridToWorld(entryRoom.gx, 0, bbox);
    const { z } = gridToWorld(0, entryRoom.gz, bbox);
    openings.set(key, { key, componentId: 'door-ext', position: { x, y: 3.5, z }, rotation: { x: 0, y: 0, z: 0 } });
  }

  // Interior doors (from connections)
  for (const conn of connections) {
    if (conn.type !== 'door' && conn.type !== 'sliding') continue;
    const doorComp = conn.type === 'sliding' ? 'door-sliding' : 'door-int';
    const roomA = groundRooms.find(r => r.label === conn.from);
    const roomB = groundRooms.find(r => r.label === conn.to);
    if (!roomA || !roomB) continue;

    const sharedHoriz = (roomA.gz + roomA.gd === roomB.gz || roomB.gz + roomB.gd === roomA.gz) &&
                        roomA.gx < roomB.gx + roomB.gw && roomA.gx + roomA.gw > roomB.gx;
    const sharedVert = (roomA.gx + roomA.gw === roomB.gx || roomB.gx + roomB.gw === roomA.gx) &&
                       roomA.gz < roomB.gz + roomB.gd && roomA.gz + roomA.gd > roomB.gz;

    if (sharedHoriz) {
      const sharedZ = roomA.gz + roomA.gd === roomB.gz ? roomA.gz + roomA.gd : roomB.gz + roomB.gd;
      const midX = Math.floor((Math.max(roomA.gx, roomB.gx) + Math.min(roomA.gx + roomA.gw, roomB.gx + roomB.gw)) / 2);
      const key = hKey(midX, sharedZ);
      const { x } = gridToWorld(midX, 0, bbox);
      const { z } = gridToWorld(0, sharedZ, bbox);
      openings.set(key, { key, componentId: doorComp, position: { x, y: 3.5, z }, rotation: { x: 0, y: 0, z: 0 } });
    } else if (sharedVert) {
      const sharedX = roomA.gx + roomA.gw === roomB.gx ? roomA.gx + roomA.gw : roomB.gx + roomB.gw;
      const midZ = Math.floor((Math.max(roomA.gz, roomB.gz) + Math.min(roomA.gz + roomA.gd, roomB.gz + roomB.gd)) / 2);
      const key = vKey(sharedX, midZ);
      const { x } = gridToWorld(sharedX, 0, bbox);
      const { z } = gridToWorld(0, midZ, bbox);
      openings.set(key, { key, componentId: doorComp, position: { x: x - GRID / 2, y: 3.5, z }, rotation: { x: 0, y: 90, z: 0 } });
    }
  }

  // ── Pass 2: Exterior wall panels (skip where openings exist) ────────

  // Horizontal walls (N/S edges, rot_y=0)
  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    // North perimeter
    if (isOccupied(gx, bbox.maxGz - 1, groundRooms)) {
      const key = hKey(gx, bbox.maxGz);
      if (openings.has(key)) {
        placements.push({ ...openings.get(key)!, zone: 'openings' });
      } else {
        const { x } = gridToWorld(gx, 0, bbox);
        const { z } = gridToWorld(0, bbox.maxGz, bbox);
        placements.push({ componentId: 'wall-ext', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
      }
    }
    // South perimeter
    if (isOccupied(gx, bbox.minGz, groundRooms)) {
      const key = hKey(gx, bbox.minGz);
      if (openings.has(key)) {
        placements.push({ ...openings.get(key)!, zone: 'openings' });
      } else {
        const { x } = gridToWorld(gx, 0, bbox);
        const { z } = gridToWorld(0, bbox.minGz, bbox);
        placements.push({ componentId: 'wall-ext', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
      }
    }
  }

  // Vertical walls (E/W edges, rot_y=90)
  for (let gz = bbox.minGz; gz < bbox.maxGz; gz++) {
    // West perimeter
    if (isOccupied(bbox.minGx, gz, groundRooms)) {
      const key = vKey(bbox.minGx, gz);
      const { x } = gridToWorld(bbox.minGx, 0, bbox);
      const { z } = gridToWorld(0, gz, bbox);
      if (openings.has(key)) {
        placements.push({ ...openings.get(key)!, zone: 'openings' });
      } else {
        placements.push({ componentId: 'wall-ext', position: { x: x - GRID / 2, y: yWall, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
      }
    }
    // East perimeter
    if (isOccupied(bbox.maxGx - 1, gz, groundRooms)) {
      const key = vKey(bbox.maxGx, gz);
      const { x } = gridToWorld(bbox.maxGx, 0, bbox);
      const { z } = gridToWorld(0, gz, bbox);
      if (openings.has(key)) {
        placements.push({ ...openings.get(key)!, zone: 'openings' });
      } else {
        placements.push({ componentId: 'wall-ext', position: { x: x - GRID / 2, y: yWall, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
      }
    }
  }

  // Interior perimeter walls (for non-rectangular layouts)
  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    for (let gz = bbox.minGz; gz < bbox.maxGz; gz++) {
      if (!isOccupied(gx, gz, groundRooms)) continue;
      if (gz > bbox.minGz && !isOccupied(gx, gz - 1, groundRooms)) {
        const key = hKey(gx, gz);
        if (!openings.has(key)) {
          const { x } = gridToWorld(gx, 0, bbox);
          const { z } = gridToWorld(0, gz, bbox);
          placements.push({ componentId: 'wall-ext', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
        }
      }
      if (gz < bbox.maxGz - 1 && !isOccupied(gx, gz + 1, groundRooms)) {
        const key = hKey(gx, gz + 1);
        if (!openings.has(key)) {
          const { x } = gridToWorld(gx, 0, bbox);
          const { z } = gridToWorld(0, gz + 1, bbox);
          placements.push({ componentId: 'wall-ext', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
        }
      }
      if (gx > bbox.minGx && !isOccupied(gx - 1, gz, groundRooms)) {
        const key = vKey(gx, gz);
        if (!openings.has(key)) {
          const { x } = gridToWorld(gx, 0, bbox);
          const { z } = gridToWorld(0, gz, bbox);
          placements.push({ componentId: 'wall-ext', position: { x: x - GRID / 2, y: yWall, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
        }
      }
      if (gx < bbox.maxGx - 1 && !isOccupied(gx + 1, gz, groundRooms)) {
        const key = vKey(gx + 1, gz);
        if (!openings.has(key)) {
          const { x } = gridToWorld(gx + 1, 0, bbox);
          const { z } = gridToWorld(0, gz, bbox);
          placements.push({ componentId: 'wall-ext', position: { x: x - GRID / 2, y: yWall, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
        }
      }
    }
  }

  // ── Pass 3: Interior walls (shared edges, skip open connections) ────
  function isOpenConnection(labelA: string, labelB: string): boolean {
    return connections.some((c: RoomConnection) =>
      c.type === 'open' && (
        (c.from === labelA && c.to === labelB) ||
        (c.from === labelB && c.to === labelA)
      )
    );
  }

  for (let i = 0; i < groundRooms.length; i++) {
    const a = groundRooms[i];
    for (let j = i + 1; j < groundRooms.length; j++) {
      const b = groundRooms[j];
      if (isOpenConnection(a.label, b.label)) continue;

      // Horizontal shared edge
      if (a.gx < b.gx + b.gw && a.gx + a.gw > b.gx) {
        if (a.gz + a.gd === b.gz || b.gz + b.gd === a.gz) {
          const sharedZ = a.gz + a.gd === b.gz ? a.gz + a.gd : b.gz + b.gd;
          const startX = Math.max(a.gx, b.gx);
          const endX = Math.min(a.gx + a.gw, b.gx + b.gw);
          for (let gx = startX; gx < endX; gx++) {
            const key = hKey(gx, sharedZ);
            if (openings.has(key)) {
              // Door opening — already placed in pass 1
            } else {
              const { x } = gridToWorld(gx, 0, bbox);
              const { z } = gridToWorld(0, sharedZ, bbox);
              placements.push({ componentId: 'wall-int', position: { x, y: intWallY(), z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'interior' });
            }
          }
        }
      }
      // Vertical shared edge
      if (a.gz < b.gz + b.gd && a.gz + a.gd > b.gz) {
        if (a.gx + a.gw === b.gx || b.gx + b.gw === a.gx) {
          const sharedX = a.gx + a.gw === b.gx ? a.gx + a.gw : b.gx + b.gw;
          const startZ = Math.max(a.gz, b.gz);
          const endZ = Math.min(a.gz + a.gd, b.gz + b.gd);
          for (let gz = startZ; gz < endZ; gz++) {
            const key = vKey(sharedX, gz);
            if (openings.has(key)) {
              // Door opening — already placed
            } else {
              const { x } = gridToWorld(sharedX, 0, bbox);
              const { z } = gridToWorld(0, gz, bbox);
              placements.push({ componentId: 'wall-int', position: { x: x - GRID / 2, y: intWallY(), z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'interior' });
            }
          }
        }
      }
    }
  }

  // Roof is handled by EnvelopeMesh — no placement boxes needed.

  return placements;
}
