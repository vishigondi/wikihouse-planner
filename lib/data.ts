import type { ModularComponent, DenHome, ComponentLibrary, RoomLayout, RoomConnection } from './types';
import { generatePlacements } from './generate-placements';
import { logValidation } from './conversion-validator';
import { graphLayout } from './graph-layout';

// Static import as fallback (available immediately on first render)
import libraryData from '@/public/data/library.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib = libraryData as any as ComponentLibrary;

export let components: ModularComponent[] = lib.components;
// Regenerate placements for all homes using the TypeScript generator (single code path)
export let homes: DenHome[] = lib.homes.map(h => ({
  ...h,
  placements: generatePlacements(h),
}));
export let coverage: Record<string, Record<string, boolean>> = lib.coverage;

// ── SpatialIR → DenHome adapter ─────────────────────────────────────────────

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

const EDGE_MAP: Record<string, string> = {
  open: 'open', door: 'door', pocket_door: 'door', barn_door: 'door',
  bifold_door: 'door', sliding_door: 'sliding', french_door: 'sliding',
  exterior_door: 'door', cased_opening: 'open', stair_connection: 'open',
  wall: 'wall',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function spatialToDenHome(plan: any): DenHome {
  const gridSize = 4;

  // Normalize floor levels — if min level is > 0, shift all down to 0-based
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const minLevel = Math.min(...plan.rooms.map((r: any) => r.level ?? 0));

  // Check if rooms have position data — if so, use it directly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasPositions = plan.rooms.every((r: any) => r.position && typeof r.position.x === 'number');

  let rooms: RoomLayout[];

  if (hasPositions) {
    // Direct placement from SpatialIR positions — no packing needed
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rooms = plan.rooms.map((r: any) => ({
      label: r.label,
      type: r.type,
      gx: Math.round(r.position.x / gridSize),
      gz: Math.round(r.position.z / gridSize),
      gw: Math.max(1, Math.round(r.dimensions.width / gridSize)),
      gd: Math.max(1, Math.round(r.dimensions.depth / gridSize)),
      area: r.area,
      color: ROOM_COLORS[r.type] || '#a8a29e',
      constraints: '',
      floor: (r.level ?? 0) - minLevel,
    }));
  } else {
    // Graph-based layout: BFS through edges, places connected rooms adjacent
    rooms = graphLayout(plan, gridSize);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomLabelMap = new Map(plan.rooms.map((r: any) => [r.id, r.label]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connections: RoomConnection[] = plan.edges
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => EDGE_MAP[e.type])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => ({
      from: roomLabelMap.get(e.from) || e.from,
      to: roomLabelMap.get(e.to) || e.to,
      type: EDGE_MAP[e.type] || 'door',
    }));

  const roofStyle = plan.roofStyle.includes('a-frame') ? 'a-frame' :
                    plan.roofStyle.includes('steep') ? 'steep-gable' :
                    plan.roofStyle.includes('shed') ? 'shed' : 'gable';

  const home: DenHome = {
    id: plan.id,
    model: plan.name,
    sqft: plan.totalArea,
    footprint: plan.footprint,
    height: roofStyle === 'a-frame' ? 21 : roofStyle === 'steep-gable' ? 18 : 16,
    bedBath: plan.bedsBaths,
    roofStyle,
    hasLoft: (plan.levels || 1) > 1,
    loftHeight: (plan.levels || 1) > 1 ? 8 : undefined, // 8ft loft floor elevation
    placements: [],
    componentsUsed: ['wall-ext', 'wall-int', 'floor-std', 'foundation', 'roof-gable', 'roof-steep'],
    rooms,
    connections,
  };

  // Fix footprint to match actual room bounding box — prevents roof/room mismatch
  const groundRooms = rooms.filter(r => !r.floor || r.floor === 0);
  if (groundRooms.length > 0) {
    const minGx = Math.min(...groundRooms.map(r => r.gx));
    const maxGx = Math.max(...groundRooms.map(r => r.gx + r.gw));
    const minGz = Math.min(...groundRooms.map(r => r.gz));
    const maxGz = Math.max(...groundRooms.map(r => r.gz + r.gd));
    home.footprint = {
      width: (maxGx - minGx) * gridSize,
      depth: (maxGz - minGz) * gridSize,
    };
  }

  // Auto-generate 3D placements from room grid
  home.placements = generatePlacements(home);

  // Validate conversion integrity
  logValidation(home);

  return home;
}

// Refresh data — loads SpatialIR manifest and merges with existing library
export async function refreshData(): Promise<void> {
  try {
    // Load SpatialIR manifest (symlinked from dev-compiler)
    const manifestRes = await fetch(`/data/spatial-manifest.json?t=${Date.now()}`, { cache: 'no-store' });
    if (manifestRes.ok) {
      const manifest = await manifestRes.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const spatialHomes = manifest.plans.map((p: any) => spatialToDenHome(p));
      const libIds = new Set(lib.homes.map(h => h.id));

      // library.json is authority for plans it knows about (algorithm.py output).
      // Manifest only adds plans NOT in library.json (Den reference plans).
      const libWithPlacements = lib.homes.map(h => ({ ...h, placements: generatePlacements(h) }));
      const manifestOnly = spatialHomes.filter((h: DenHome) => !libIds.has(h.id));
      homes = [...libWithPlacements, ...manifestOnly].sort((a, b) => a.sqft - b.sqft);
      console.log(`Loaded ${spatialHomes.length} plans from SpatialIR manifest (${homes.length} total)`);
    }

    // Load Kintsugi cabin designs
    try {
      const kintsugiRes = await fetch(`/data/kintsugi-plans.json?t=${Date.now()}`, { cache: 'no-store' });
      if (kintsugiRes.ok) {
        const kintsugiData = await kintsugiRes.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const kintsugiHomes = kintsugiData.plans.map((p: any) => spatialToDenHome(p));
        homes = [...homes, ...kintsugiHomes].sort((a, b) => a.sqft - b.sqft);
        console.log(`Loaded ${kintsugiHomes.length} Kintsugi cabin designs`);
      }
    } catch { /* OK if not available */ }

    // Also try library.json for components
    const libRes = await fetch(`/data/library.json?t=${Date.now()}`, { cache: 'no-store' });
    if (libRes.ok) {
      const data = await libRes.json() as ComponentLibrary;
      components = data.components;
      coverage = data.coverage;
    }
  } catch {
    // Static import fallback is fine
  }
}

export function getHome(id: string): DenHome | undefined {
  return homes.find(h => h.id === id);
}

export function getComponent(id: string): ModularComponent | undefined {
  return components.find(c => c.id === id);
}

export function getComponentsForHome(homeId: string): ModularComponent[] {
  const home = getHome(homeId);
  if (!home) return [];
  return home.componentsUsed
    .map(id => getComponent(id))
    .filter((c): c is ModularComponent => c !== undefined);
}
