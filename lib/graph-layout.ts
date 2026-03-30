/**
 * Graph-based room layout algorithm.
 *
 * Places rooms on a grid by walking the SpatialIR adjacency graph.
 * Rooms connected by edges are placed adjacent on the grid.
 * Facade data biases rooms toward the building perimeter.
 *
 * Algorithm:
 * 1. Start with entry room at bottom-center
 * 2. BFS through ALL edges (not just open), placing neighbors adjacent
 * 3. When placing a neighbor, choose the direction that:
 *    a. Respects facade constraints (S-facade rooms go on south edge)
 *    b. Keeps zone coherence (public rooms cluster together)
 *    c. Avoids overlaps with already-placed rooms
 * 4. Compact the result (shift to origin)
 */

import type { RoomLayout } from './types';

const GRID = 4; // feet per grid unit

interface GridRoom {
  id: string;
  label: string;
  type: string;
  zone: string;
  gw: number;
  gd: number;
  area: number;
  level: number;
  facadeWalls: string[];
}

interface Placement {
  gx: number;
  gz: number;
}

const ROOM_COLORS: Record<string, string> = {
  entry: '#a8a29e', kitchen: '#fbbf24', kitchenette: '#fbbf24',
  dining: '#f59e0b', living: '#d97706', great_room: '#d97706',
  bedroom: '#93c5fd', master_bedroom: '#60a5fa',
  bathroom_full: '#06b6d4', bathroom_half: '#22d3ee', ensuite: '#06b6d4',
  closet: '#78716c', walk_in_closet: '#78716c', pantry: '#a3a3a3',
  hallway: '#d4d4d4', stair: '#d4d4d4', landing: '#d4d4d4',
  loft: '#818cf8', deck: '#86efac', porch: '#86efac',
  covered_porch: '#86efac', screened_porch: '#86efac',
  laundry: '#a3a3a3', laundry_closet: '#a3a3a3', utility: '#a3a3a3',
  mudroom: '#a3a3a3', office: '#c084fc', garage: '#737373',
};

/** Check if a room placement overlaps any existing placements */
function overlaps(
  gx: number, gz: number, gw: number, gd: number,
  placed: Map<string, Placement>, rooms: Map<string, GridRoom>,
): boolean {
  for (const [id, p] of placed) {
    const r = rooms.get(id)!;
    if (gx < p.gx + r.gw && gx + gw > p.gx &&
        gz < p.gz + r.gd && gz + gd > p.gz) {
      return true;
    }
  }
  return false;
}

/** Direction preference based on facade walls */
function facadeScore(dir: string, facadeWalls: string[]): number {
  // If room has S facade and we're placing it on the south side, bonus
  const map: Record<string, string[]> = {
    south: ['S', 'SW', 'SE'],
    north: ['N', 'NW', 'NE'],
    west: ['W', 'SW', 'NW'],
    east: ['E', 'SE', 'NE'],
  };
  const dirFacades = map[dir] || [];
  return facadeWalls.some(f => dirFacades.includes(f)) ? 2 : 0;
}

/** Zone coherence score — prefer placing rooms near same-zone rooms */
function zoneScore(
  gx: number, gz: number, zone: string,
  placed: Map<string, Placement>, rooms: Map<string, GridRoom>,
): number {
  let score = 0;
  for (const [id, p] of placed) {
    const r = rooms.get(id)!;
    if (r.zone === zone) {
      const dist = Math.abs(gx - p.gx) + Math.abs(gz - p.gz);
      score += Math.max(0, 10 - dist); // closer same-zone rooms = better
    }
  }
  return score;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function graphLayout(plan: any, gridSize: number = GRID): RoomLayout[] {
  const minLevel = Math.min(...plan.rooms.map((r: any) => r.level ?? 0));

  // Build room lookup
  const rooms = new Map<string, GridRoom>();
  for (const r of plan.rooms) {
    rooms.set(r.id, {
      id: r.id,
      label: r.label,
      type: r.type,
      zone: r.zone || 'public',
      gw: Math.max(1, Math.round(r.dimensions.width / gridSize)),
      gd: Math.max(1, Math.round(r.dimensions.depth / gridSize)),
      area: r.area,
      level: (r.level ?? 0) - minLevel,
      facadeWalls: r.facadeWalls || [],
    });
  }

  // Separate ground and upper-level rooms
  // Upper-level rooms are laid out independently, centered over the ground floor
  const groundRoomIds = new Set(
    plan.rooms.filter((r: any) => ((r.level ?? 0) - minLevel) === 0).map((r: any) => r.id)
  );
  const upperRoomIds = new Set(
    plan.rooms.filter((r: any) => ((r.level ?? 0) - minLevel) > 0).map((r: any) => r.id)
  );

  // Build adjacency from ALL edges (not just open), but only within same level
  const edges: Array<{ from: string; to: string; type: string }> = plan.edges || [];
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    // Skip stair_connection edges for layout (they connect across levels)
    if (e.type === 'stair_connection') continue;
    // Only connect rooms on the same level
    const fromLevel = rooms.get(e.from)?.level ?? 0;
    const toLevel = rooms.get(e.to)?.level ?? 0;
    if (fromLevel !== toLevel) continue;

    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }

  // Place GROUND rooms via BFS from entry
  const placed = new Map<string, Placement>();
  const groundRoomsList = plan.rooms.filter((r: any) => groundRoomIds.has(r.id));
  const entry = groundRoomsList.find((r: any) => r.type === 'entry') || groundRoomsList[0];
  if (!entry) {
    // No ground rooms — just return all rooms at origin
    return plan.rooms.map((r: any) => ({
      label: rooms.get(r.id)!.label,
      type: rooms.get(r.id)!.type,
      gx: 0, gz: 0,
      gw: rooms.get(r.id)!.gw, gd: rooms.get(r.id)!.gd,
      area: rooms.get(r.id)!.area,
      color: ROOM_COLORS[rooms.get(r.id)!.type] || '#a8a29e',
      constraints: '', floor: rooms.get(r.id)!.level,
    }));
  }

  // Entry at origin (will compact later)
  placed.set(entry.id, { gx: 0, gz: 0 });

  // BFS queue: process rooms in connection order
  // Prioritize open/door connections over wall connections
  const visited = new Set<string>([entry.id]);
  const queue: string[] = [];

  // First add strongly connected neighbors (open, door), then wall connections
  function addNeighbors(roomId: string) {
    const neighbors = adj.get(roomId) || [];
    // Sort: open/door first, wall last
    const sorted = [...neighbors].sort((a, b) => {
      const eA = edges.find(e => (e.from === roomId && e.to === a) || (e.to === roomId && e.from === a));
      const eB = edges.find(e => (e.from === roomId && e.to === b) || (e.to === roomId && e.from === b));
      const scoreA = eA?.type === 'open' || eA?.type === 'cased_opening' ? 0 : eA?.type === 'wall' ? 2 : 1;
      const scoreB = eB?.type === 'open' || eB?.type === 'cased_opening' ? 0 : eB?.type === 'wall' ? 2 : 1;
      return scoreA - scoreB;
    });
    for (const n of sorted) {
      if (!visited.has(n) && rooms.has(n)) {
        visited.add(n);
        queue.push(n);
      }
    }
  }

  addNeighbors(entry.id);

  while (queue.length > 0) {
    const curId = queue.shift()!;
    const cur = rooms.get(curId)!;

    // Find the already-placed room this connects to (anchor)
    const neighbors = adj.get(curId) || [];
    let anchor: { id: string; placement: Placement } | null = null;
    for (const n of neighbors) {
      if (placed.has(n)) {
        anchor = { id: n, placement: placed.get(n)! };
        break;
      }
    }

    if (!anchor) {
      // No placed neighbor — place next to the entry
      anchor = { id: entry.id, placement: placed.get(entry.id)! };
    }

    const anchorRoom = rooms.get(anchor.id)!;
    const ap = anchor.placement;

    // Try all 4 directions: south, north, west, east of the anchor
    const candidates: Array<{ gx: number; gz: number; dir: string; score: number }> = [];

    const dirs = [
      { dir: 'south', gx: ap.gx, gz: ap.gz - cur.gd },                           // below
      { dir: 'north', gx: ap.gx, gz: ap.gz + anchorRoom.gd },                     // above
      { dir: 'west',  gx: ap.gx - cur.gw, gz: ap.gz },                            // left
      { dir: 'east',  gx: ap.gx + anchorRoom.gw, gz: ap.gz },                     // right
      // Offset placements (share partial edge)
      { dir: 'north', gx: ap.gx + anchorRoom.gw - cur.gw, gz: ap.gz + anchorRoom.gd }, // above, right-aligned
      { dir: 'south', gx: ap.gx + anchorRoom.gw - cur.gw, gz: ap.gz - cur.gd },        // below, right-aligned
      { dir: 'east',  gx: ap.gx + anchorRoom.gw, gz: ap.gz + anchorRoom.gd - cur.gd }, // right, top-aligned
      { dir: 'west',  gx: ap.gx - cur.gw, gz: ap.gz + anchorRoom.gd - cur.gd },        // left, top-aligned
    ];

    for (const d of dirs) {
      if (!overlaps(d.gx, d.gz, cur.gw, cur.gd, placed, rooms)) {
        const fScore = facadeScore(d.dir, cur.facadeWalls);
        const zScore = zoneScore(d.gx, d.gz, cur.zone, placed, rooms);
        candidates.push({ gx: d.gx, gz: d.gz, dir: d.dir, score: fScore * 3 + zScore });
      }
    }

    if (candidates.length > 0) {
      // Pick the best candidate
      candidates.sort((a, b) => b.score - a.score);
      placed.set(curId, { gx: candidates[0].gx, gz: candidates[0].gz });
    } else {
      // Fallback: find closest non-overlapping position to any placed room
      // Search outward from building center, prefer adjacency to existing rooms
      let bestPos: { gx: number; gz: number } | null = null;
      let bestDist = Infinity;

      // Compute current building center
      const allP = [...placed.values()];
      const centerX = allP.length > 0 ? allP.reduce((s, p) => s + p.gx, 0) / allP.length : 0;
      const centerZ = allP.length > 0 ? allP.reduce((s, p) => s + p.gz, 0) / allP.length : 0;

      for (let gx = -2; gx <= 20; gx++) {
        for (let gz = -2; gz <= 20; gz++) {
          if (overlaps(gx, gz, cur.gw, cur.gd, placed, rooms)) continue;
          // Prefer positions close to center
          const dist = Math.abs(gx - centerX) + Math.abs(gz - centerZ);
          if (dist < bestDist) {
            bestDist = dist;
            bestPos = { gx, gz };
          }
        }
      }

      if (bestPos) {
        placed.set(curId, bestPos);
      } else {
        placed.set(curId, { gx: 0, gz: 0 });
      }
    }

    addNeighbors(curId);
  }

  // Place any ground rooms not reached by BFS — close to existing rooms
  for (const r of plan.rooms) {
    if (!placed.has(r.id) && groundRoomIds.has(r.id)) {
      const room = rooms.get(r.id)!;
      const allP = [...placed.values()];
      const cx = allP.length > 0 ? Math.round(allP.reduce((s, p) => s + p.gx, 0) / allP.length) : 0;
      const cz = allP.length > 0 ? Math.round(allP.reduce((s, p) => s + p.gz, 0) / allP.length) : 0;
      let bestDist = Infinity;
      let bestPos = { gx: 0, gz: 0 };
      for (let gx = cx - 5; gx <= cx + 10; gx++) {
        for (let gz = cz - 5; gz <= cz + 10; gz++) {
          if (!overlaps(gx, gz, room.gw, room.gd, placed, rooms)) {
            const d = Math.abs(gx - cx) + Math.abs(gz - cz);
            if (d < bestDist) { bestDist = d; bestPos = { gx, gz }; }
          }
        }
      }
      placed.set(r.id, bestPos);
    }
  }

  // Compact ground rooms: shift so min gx/gz = 0
  const groundPlacements = [...placed.entries()].filter(([id]) => groundRoomIds.has(id));
  const minGx = groundPlacements.length > 0
    ? Math.min(...groundPlacements.map(([, p]) => p.gx)) : 0;
  const minGz = groundPlacements.length > 0
    ? Math.min(...groundPlacements.map(([, p]) => p.gz)) : 0;

  // Place upper-level rooms centered over the ground floor
  if (upperRoomIds.size > 0) {
    // Compute ground floor center
    const maxGx = groundPlacements.length > 0
      ? Math.max(...groundPlacements.map(([id, p]) => p.gx + rooms.get(id)!.gw)) : 0;
    const maxGz = groundPlacements.length > 0
      ? Math.max(...groundPlacements.map(([id, p]) => p.gz + rooms.get(id)!.gd)) : 0;
    const groundCenterGx = (minGx + maxGx) / 2;
    const groundCenterGz = (minGz + maxGz) / 2;

    // Layout upper rooms with their own BFS, then center over ground
    const upperPlaced = new Map<string, Placement>();
    const upperRoomsList = plan.rooms.filter((r: any) => upperRoomIds.has(r.id));
    const upperEntry = upperRoomsList[0];
    if (upperEntry) {
      upperPlaced.set(upperEntry.id, { gx: 0, gz: 0 });
      const uVisited = new Set<string>([upperEntry.id]);
      const uQueue: string[] = [];
      const uNeighbors = adj.get(upperEntry.id) || [];
      for (const n of uNeighbors) {
        if (!uVisited.has(n) && upperRoomIds.has(n)) { uVisited.add(n); uQueue.push(n); }
      }
      while (uQueue.length > 0) {
        const curId = uQueue.shift()!;
        const cur = rooms.get(curId)!;
        const neighbors = adj.get(curId) || [];
        let anchor: { id: string; placement: Placement } | null = null;
        for (const n of neighbors) {
          if (upperPlaced.has(n)) { anchor = { id: n, placement: upperPlaced.get(n)! }; break; }
        }
        if (!anchor) anchor = { id: upperEntry.id, placement: upperPlaced.get(upperEntry.id)! };
        const anchorRoom = rooms.get(anchor.id)!;
        const ap = anchor.placement;
        const dirs = [
          { gx: ap.gx, gz: ap.gz - cur.gd },
          { gx: ap.gx, gz: ap.gz + anchorRoom.gd },
          { gx: ap.gx - cur.gw, gz: ap.gz },
          { gx: ap.gx + anchorRoom.gw, gz: ap.gz },
        ];
        let didPlace = false;
        for (const d of dirs) {
          if (!overlaps(d.gx, d.gz, cur.gw, cur.gd, upperPlaced, rooms)) {
            upperPlaced.set(curId, d);
            didPlace = true;
            break;
          }
        }
        if (!didPlace) upperPlaced.set(curId, { gx: upperPlaced.size * 3, gz: 0 });
        const curNeighbors = adj.get(curId) || [];
        for (const n of curNeighbors) {
          if (!uVisited.has(n) && upperRoomIds.has(n)) { uVisited.add(n); uQueue.push(n); }
        }
      }
      // Place remaining upper rooms
      for (const r of upperRoomsList) {
        if (!upperPlaced.has(r.id)) upperPlaced.set(r.id, { gx: upperPlaced.size * 3, gz: 0 });
      }

      // Compute upper room group center and offset to ground center
      const uAll = [...upperPlaced.entries()];
      const uMinGx = Math.min(...uAll.map(([, p]) => p.gx));
      const uMaxGx = Math.max(...uAll.map(([id, p]) => p.gx + rooms.get(id)!.gw));
      const uMinGz = Math.min(...uAll.map(([, p]) => p.gz));
      const uMaxGz = Math.max(...uAll.map(([id, p]) => p.gz + rooms.get(id)!.gd));
      const uCenterGx = (uMinGx + uMaxGx) / 2;
      const uCenterGz = (uMinGz + uMaxGz) / 2;

      // Shift upper rooms so their center aligns with ground center
      const offsetGx = Math.round(groundCenterGx - uCenterGx);
      const offsetGz = Math.round(groundCenterGz - uCenterGz);
      for (const [id, p] of upperPlaced) {
        placed.set(id, { gx: p.gx + offsetGx, gz: p.gz + offsetGz });
      }
    }
  }

  // Convert to RoomLayout
  const result: RoomLayout[] = [];
  for (const r of plan.rooms) {
    const room = rooms.get(r.id)!;
    const p = placed.get(r.id)!;
    result.push({
      label: room.label,
      type: room.type,
      gx: p.gx - minGx,
      gz: p.gz - minGz,
      gw: room.gw,
      gd: room.gd,
      area: room.area,
      color: ROOM_COLORS[room.type] || '#a8a29e',
      constraints: '',
      floor: room.level,
    });
  }

  return result;
}
