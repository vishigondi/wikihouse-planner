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

  // Build adjacency from ALL edges (not just open)
  const edges: Array<{ from: string; to: string; type: string }> = plan.edges || [];
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }

  // Place rooms via BFS from entry
  const placed = new Map<string, Placement>();
  const entry = plan.rooms.find((r: any) => r.type === 'entry') || plan.rooms[0];
  const entryRoom = rooms.get(entry.id)!;

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
      // Fallback: find any non-overlapping position near the anchor
      let found = false;
      for (let dx = -10; dx <= 10 && !found; dx++) {
        for (let dz = -10; dz <= 10 && !found; dz++) {
          const gx = ap.gx + dx;
          const gz = ap.gz + dz;
          if (!overlaps(gx, gz, cur.gw, cur.gd, placed, rooms)) {
            placed.set(curId, { gx, gz });
            found = true;
          }
        }
      }
      if (!found) {
        // Last resort: place at expanding spiral from origin
        placed.set(curId, { gx: placed.size * 3, gz: 0 });
      }
    }

    addNeighbors(curId);
  }

  // Place any rooms not reached by BFS
  for (const r of plan.rooms) {
    if (!placed.has(r.id)) {
      const room = rooms.get(r.id)!;
      // Find non-overlapping spot
      for (let gx = 0; ; gx++) {
        if (!overlaps(gx, 0, room.gw, room.gd, placed, rooms)) {
          placed.set(r.id, { gx, gz: 0 });
          break;
        }
      }
    }
  }

  // Compact: shift everything so min gx/gz = 0
  const allPlacements = [...placed.entries()];
  const minGx = Math.min(...allPlacements.map(([, p]) => p.gx));
  const minGz = Math.min(...allPlacements.map(([, p]) => p.gz));

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
