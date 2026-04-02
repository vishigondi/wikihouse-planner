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
// A-frame knee wall: 10ft panel × 0.3 scale = 3ft tall, centered at 1.5ft so base touches ground
const WALL_EXT_Y_AFRAME = 1.5;

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
  const ground = rooms.filter(r => (r.floor ?? 0) < 1);
  if (ground.length === 0) return { minGx: 0, maxGx: 1, minGz: 0, maxGz: 1 };
  return {
    minGx: Math.min(...ground.map(r => r.gx)),
    maxGx: Math.max(...ground.map(r => r.gx + r.gw)),
    minGz: Math.min(...ground.map(r => r.gz)),
    maxGz: Math.max(...ground.map(r => r.gz + r.gd)),
  };
}

/**
 * Unified coordinate system. Building is centered at world origin (0,0).
 *
 * cellX(gx) → world X of cell center (for floors, room labels)
 * cellZ(gz) → world Z of cell center
 * edgeX(gx) → world X of the LEFT edge of cell gx (for vertical walls between gx-1 and gx)
 * edgeZ(gz) → world Z of the SOUTH edge of cell gz (for horizontal walls between gz-1 and gz)
 */
function makeCoords(bbox: BBox) {
  const totalW = (bbox.maxGx - bbox.minGx) * GRID;
  const totalD = (bbox.maxGz - bbox.minGz) * GRID;
  const ox = -totalW / 2; // world X of bbox.minGx left edge
  const oz = -totalD / 2; // world Z of bbox.minGz south edge
  return {
    cellX: (gx: number) => (gx - bbox.minGx) * GRID + ox + GRID / 2,
    cellZ: (gz: number) => (gz - bbox.minGz) * GRID + oz + GRID / 2,
    edgeX: (gx: number) => (gx - bbox.minGx) * GRID + ox,
    edgeZ: (gz: number) => (gz - bbox.minGz) * GRID + oz,
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
  // floor=0.5 is used for bedroom wings that are physically at ground level.
  // Include all rooms with floor < 1 as "ground" for wall/opening generation.
  const groundRooms = rooms.filter(r => (r.floor ?? 0) < 1);
  const bbox = getBBox(rooms);
  const { cellX, cellZ, edgeX, edgeZ } = makeCoords(bbox);
  const isAFrame = (home.roofStyle || 'gable') === 'a-frame';
  const yWall = wallY(home.roofStyle || 'gable');
  // A-frame exterior walls are scaled to 30% height (knee walls only)
  const extWallScale = isAFrame ? { x: 1, y: 0.3, z: 1 } : undefined;
  const connections = home.connections || [];

  // ── Pass 0: Foundation + Floor ──────────────────────────────────────
  const OUTDOOR_TYPES = new Set(['deck', 'porch', 'covered_porch', 'screened_porch']);

  function getRoomAt(gx: number, gz: number): RoomLayout | undefined {
    return groundRooms.find(r => gx >= r.gx && gx < r.gx + r.gw && gz >= r.gz && gz < r.gz + r.gd);
  }

  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    for (let gz = bbox.minGz; gz < bbox.maxGz; gz++) {
      if (!isOccupied(gx, gz, groundRooms)) continue;
      const x = cellX(gx), z = cellZ(gz); // cell center
      const room = getRoomAt(gx, gz);
      const isDeck = room && OUTDOOR_TYPES.has(room.type);

      placements.push({
        componentId: 'foundation',
        position: { x, y: Y_FOUNDATION, z },
        rotation: { x: 0, y: 0, z: 0 },
      });
      placements.push({
        componentId: isDeck ? 'floor-deck' : 'floor-std',
        position: { x, y: Y_FLOOR, z },
        rotation: { x: 0, y: 0, z: 0 },
        zone: 'floor',
      });
    }
  }

  // ── Pass 0b: Loft floor panels (at loftHeight elevation) ───────────
  const loftHeight = home.loftHeight || 8;
  // True lofts are floor >= 1 (elevated, above ground level)
  const loftRooms = rooms.filter(r => (r.floor ?? 0) >= 1);
  if (loftRooms.length > 0) {
    for (const room of loftRooms) {
      for (let gx = room.gx; gx < room.gx + room.gw; gx++) {
        for (let gz = room.gz; gz < room.gz + room.gd; gz++) {
          const x = cellX(gx), z = cellZ(gz); // cell center
          placements.push({
            componentId: 'floor-std',
            position: { x, y: loftHeight + Y_FLOOR, z },
            rotation: { x: 0, y: 0, z: 0 },
            zone: 'loft',
          });
        }
      }
    }
  }

  // ── Pass 1: Collect all openings ────────────────────────────────────
  const openings = new Map<WallKey, Opening>();

  // Windows: one per facade-facing room
  for (const room of groundRooms) {
    if (room.type === 'closet' || room.type === 'walk_in_closet' ||
        room.type === 'pantry' || room.type === 'hallway' ||
        room.type === 'stair' || room.type === 'landing' ||
        OUTDOOR_TYPES.has(room.type)) continue; // no windows on outdoor rooms

    // Clamp window midpoint away from building corners to avoid overlap with perpendicular walls
    const midGx = Math.max(bbox.minGx + 1, Math.min(bbox.maxGx - 2, Math.floor(room.gx + room.gw / 2)));
    const midGz = Math.max(bbox.minGz + 1, Math.min(bbox.maxGz - 2, Math.floor(room.gz + room.gd / 2)));

    // North facade
    if (room.gz + room.gd >= bbox.maxGz || !isOccupied(midGx, room.gz + room.gd, groundRooms)) {
      const key = hKey(midGx, room.gz + room.gd);
      if (!openings.has(key)) {
        const x = cellX(midGx);
        const z = edgeZ(room.gz + room.gd);
        openings.set(key, { key, componentId: 'window-std', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 } });
      }
      continue;
    }
    // South facade
    if (room.gz <= bbox.minGz || !isOccupied(midGx, room.gz - 1, groundRooms)) {
      const key = hKey(midGx, room.gz);
      if (!openings.has(key)) {
        const x = cellX(midGx);
        const z = edgeZ(room.gz);
        openings.set(key, { key, componentId: 'window-std', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 } });
      }
      continue;
    }
    // East facade
    if (room.gx + room.gw >= bbox.maxGx || !isOccupied(room.gx + room.gw, midGz, groundRooms)) {
      const key = vKey(room.gx + room.gw, midGz);
      if (!openings.has(key)) {
        const x = edgeX(room.gx + room.gw);
        const z = cellZ(midGz);
        openings.set(key, { key, componentId: 'window-std', position: { x, y: yWall, z }, rotation: { x: 0, y: 90, z: 0 } });
      }
      continue;
    }
    // West facade
    if (room.gx <= bbox.minGx || !isOccupied(room.gx - 1, midGz, groundRooms)) {
      const key = vKey(room.gx, midGz);
      if (!openings.has(key)) {
        const x = edgeX(room.gx);
        const z = cellZ(midGz);
        openings.set(key, { key, componentId: 'window-std', position: { x, y: yWall, z }, rotation: { x: 0, y: 90, z: 0 } });
      }
    }
  }

  // Entry door
  // Entry door — place on whichever exterior face the entry room touches
  const entryRoom = groundRooms.find(r => r.type === 'entry');
  if (entryRoom) {
    const e = entryRoom;
    const distS = e.gz - bbox.minGz;
    const distN = bbox.maxGz - (e.gz + e.gd);
    const distW = e.gx - bbox.minGx;
    const distE = bbox.maxGx - (e.gx + e.gw);
    const minDist = Math.min(distS, distN, distW, distE);

    if (minDist === distS) {
      // South face
      const key = hKey(e.gx, e.gz);
      openings.set(key, { key, componentId: 'door-ext', position: { x: cellX(e.gx), y: 3.5, z: edgeZ(e.gz) }, rotation: { x: 0, y: 0, z: 0 } });
    } else if (minDist === distN) {
      // North face
      const key = hKey(e.gx, e.gz + e.gd);
      openings.set(key, { key, componentId: 'door-ext', position: { x: cellX(e.gx), y: 3.5, z: edgeZ(e.gz + e.gd) }, rotation: { x: 0, y: 0, z: 0 } });
    } else if (minDist === distW) {
      // West face
      const key = vKey(e.gx, e.gz);
      openings.set(key, { key, componentId: 'door-ext', position: { x: edgeX(e.gx), y: 3.5, z: cellZ(e.gz) }, rotation: { x: 0, y: 90, z: 0 } });
    } else {
      // East face
      const key = vKey(e.gx + e.gw, e.gz);
      openings.set(key, { key, componentId: 'door-ext', position: { x: edgeX(e.gx + e.gw), y: 3.5, z: cellZ(e.gz) }, rotation: { x: 0, y: 90, z: 0 } });
    }
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
      const x = cellX(midX);
      const z = edgeZ(sharedZ);
      openings.set(key, { key, componentId: doorComp, position: { x, y: 3.5, z }, rotation: { x: 0, y: 0, z: 0 } });
    } else if (sharedVert) {
      const sharedX = roomA.gx + roomA.gw === roomB.gx ? roomA.gx + roomA.gw : roomB.gx + roomB.gw;
      const midZ = Math.floor((Math.max(roomA.gz, roomB.gz) + Math.min(roomA.gz + roomA.gd, roomB.gz + roomB.gd)) / 2);
      const key = vKey(sharedX, midZ);
      const x = edgeX(sharedX);
      const z = cellZ(midZ);
      openings.set(key, { key, componentId: doorComp, position: { x, y: 3.5, z }, rotation: { x: 0, y: 90, z: 0 } });
    }
  }

  // ── Pass 2: Exterior wall panels ────────────────────────────────────
  // Place a wall on ANY cell edge where one side is occupied (non-deck)
  // and the other side is empty or out of bounds. This correctly handles
  // non-rectangular building shapes from the graph layout.

  function isDeckCell(gx: number, gz: number): boolean {
    const room = getRoomAt(gx, gz);
    return !!room && OUTDOOR_TYPES.has(room.type);
  }

  function needsExtWall(occupiedGx: number, occupiedGz: number, emptyGx: number, emptyGz: number): boolean {
    // An exterior wall is needed when an occupied non-deck cell faces an empty or out-of-bounds cell
    if (!isOccupied(occupiedGx, occupiedGz, groundRooms)) return false;
    if (isDeckCell(occupiedGx, occupiedGz)) return false;
    // The other side must be empty (not occupied, or a deck cell)
    if (!isOccupied(emptyGx, emptyGz, groundRooms)) return true;
    if (isDeckCell(emptyGx, emptyGz)) return true;
    return false;
  }

  // Check every cell edge for occupied↔empty boundaries
  for (let gx = bbox.minGx; gx < bbox.maxGx; gx++) {
    for (let gz = bbox.minGz; gz <= bbox.maxGz; gz++) {
      // Horizontal edge at (gx, gz): cell below is (gx, gz-1), cell above is (gx, gz)
      const belowOccupied = gz > bbox.minGz && needsExtWall(gx, gz - 1, gx, gz);
      const aboveOccupied = gz < bbox.maxGz && needsExtWall(gx, gz, gx, gz - 1);

      if (belowOccupied || aboveOccupied) {
        const key = hKey(gx, gz);
        if (openings.has(key)) {
          const opening = openings.get(key)!;
          placements.push({ ...opening, zone: 'openings' });
          const x = cellX(gx);
          const z = edgeZ(gz);
          if (opening.componentId.includes('door')) {
            // Header above door (7ft door in 10ft wall)
            placements.push({ componentId: 'wall-ext', position: { x, y: 8.5, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', scale: { x: 1, y: 0.3, z: 1 } });
          } else if (opening.componentId.includes('window')) {
            // Sill below window + head above (4ft window centered at 5ft in 10ft wall)
            placements.push({ componentId: 'wall-ext', position: { x, y: 1.5, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', scale: { x: 1, y: 0.3, z: 1 } });
            placements.push({ componentId: 'wall-ext', position: { x, y: 8.5, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', scale: { x: 1, y: 0.3, z: 1 } });
          }
        } else {
          const x = cellX(gx);
          const z = edgeZ(gz);
          placements.push({ componentId: 'wall-ext', position: { x, y: yWall, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
        }
      }
    }
  }

  for (let gz = bbox.minGz; gz < bbox.maxGz; gz++) {
    for (let gx = bbox.minGx; gx <= bbox.maxGx; gx++) {
      // Vertical edge at (gx, gz): cell left is (gx-1, gz), cell right is (gx, gz)
      const leftOccupied = gx > bbox.minGx && needsExtWall(gx - 1, gz, gx, gz);
      const rightOccupied = gx < bbox.maxGx && needsExtWall(gx, gz, gx - 1, gz);

      if (leftOccupied || rightOccupied) {
        const key = vKey(gx, gz);
        if (openings.has(key)) {
          const opening = openings.get(key)!;
          placements.push({ ...opening, zone: 'openings' });
          const x = edgeX(gx);
          const z = cellZ(gz);
          if (opening.componentId.includes('door')) {
            placements.push({ componentId: 'wall-ext', position: { x, y: 8.5, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', scale: { x: 1, y: 0.3, z: 1 } });
          } else if (opening.componentId.includes('window')) {
            placements.push({ componentId: 'wall-ext', position: { x, y: 1.5, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', scale: { x: 1, y: 0.3, z: 1 } });
            placements.push({ componentId: 'wall-ext', position: { x, y: 8.5, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', scale: { x: 1, y: 0.3, z: 1 } });
          }
        } else {
          const x = edgeX(gx);
          const z = cellZ(gz);
          placements.push({ componentId: 'wall-ext', position: { x, y: yWall, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'walls', ...(extWallScale ? { scale: extWallScale } : {}) });
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
              // Door opening + header panel above door (fills 7ft-9ft gap)
              const x = cellX(gx);
              const z = edgeZ(sharedZ);
              placements.push({ componentId: 'wall-int', position: { x, y: 8, z }, rotation: { x: 0, y: 0, z: 0 }, zone: 'interior', scale: { x: 1, y: 0.22, z: 1 } });
            } else {
              const x = cellX(gx);
              const z = edgeZ(sharedZ);
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
              // Door opening + header panel above door
              const x = edgeX(sharedX);
              const z = cellZ(gz);
              placements.push({ componentId: 'wall-int', position: { x, y: 8, z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'interior', scale: { x: 1, y: 0.22, z: 1 } });
            } else {
              const x = edgeX(sharedX);
              const z = cellZ(gz);
              placements.push({ componentId: 'wall-int', position: { x, y: intWallY(), z }, rotation: { x: 0, y: 90, z: 0 }, zone: 'interior' });
            }
          }
        }
      }
    }
  }

  // ── Pass 4: Corner posts — fill gaps where H and V walls meet ────────
  // At each exterior corner, place a small post (0.5ft × wallHeight × 0.5ft)
  // to close the gap between perpendicular wall panels.
  const cornerSet = new Set<string>();
  for (let gx = bbox.minGx; gx <= bbox.maxGx; gx++) {
    for (let gz = bbox.minGz; gz <= bbox.maxGz; gz++) {
      // A corner exists where occupancy changes in both X and Z directions
      const tl = isOccupied(gx - 1, gz, groundRooms) && !isDeckCell(gx - 1, gz);
      const tr = isOccupied(gx, gz, groundRooms) && !isDeckCell(gx, gz);
      const bl = isOccupied(gx - 1, gz - 1, groundRooms) && !isDeckCell(gx - 1, gz - 1);
      const br = isOccupied(gx, gz - 1, groundRooms) && !isDeckCell(gx, gz - 1);
      // Corner if exactly 1 or 3 of the 4 quadrants are occupied (convex or concave corner)
      const count = [tl, tr, bl, br].filter(Boolean).length;
      if (count === 1 || count === 3) {
        const key = `${gx},${gz}`;
        if (!cornerSet.has(key)) {
          cornerSet.add(key);
          const x = edgeX(gx);
          const z = edgeZ(gz);
          placements.push({
            componentId: 'wall-ext',
            position: { x, y: yWall, z },
            rotation: { x: 0, y: 0, z: 0 },
            zone: 'walls',
            scale: { x: 0.12, y: 1, z: 0.12 }, // thin post
          });
        }
      }
    }
  }

  // Roof is handled by EnvelopeMesh — no placement boxes needed.

  return placements;
}
