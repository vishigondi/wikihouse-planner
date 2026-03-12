export type ComponentCategory =
  | 'wall' | 'roof' | 'floor' | 'structural' | 'opening' | 'specialty';

export interface ModularComponent {
  id: string;
  name: string;
  category: ComponentCategory;
  dimensions: { width: number; height: number; depth: number }; // feet
  geometry: 'box' | 'prism' | 'cylinder' | 'custom';
  pitchAngle?: number;
  material: {
    color: string;
    opacity: number;
    metalness: number;
    roughness: number;
  };
  properties: {
    structural: boolean;
    insulated: boolean;
    exterior: boolean;
    panelType: string;
  };
  usedInHomes: string[];
}

export interface ComponentPlacement {
  componentId: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
  zone?: string;
}

export interface RoomLayout {
  label: string;
  type: string;
  gx: number;
  gz: number;
  gw: number;
  gd: number;
  area: number;
  color: string;
  constraints: string;
}

export interface DenHome {
  id: string;
  model: string;
  sqft: number;
  footprint: { width: number; depth: number };
  height: number;
  bedBath: string;
  roofStyle: string;
  hasLoft: boolean;
  placements: ComponentPlacement[];
  componentsUsed: string[];
  rooms: RoomLayout[];
}

export interface ComponentLibrary {
  version: number;
  components: ModularComponent[];
  homes: DenHome[];
  coverage: Record<string, Record<string, boolean>>;
}

export const CATEGORY_COLORS: Record<ComponentCategory, string> = {
  wall: '#3b82f6',
  roof: '#f59e0b',
  floor: '#8b5cf6',
  structural: '#06b6d4',
  opening: '#10b981',
  specialty: '#ec4899',
};
