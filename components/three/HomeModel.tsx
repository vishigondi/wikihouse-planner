'use client';

import type { DenHome, ModularComponent } from '@/lib/types';
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
}

export default function HomeModel({
  home, components, selectedComponent, onSelectComponent,
  wallOpacity, roofVisible, roomLabelsVisible
}: Props) {
  const compMap = new Map(components.map(c => [c.id, c]));

  // Filter placements: envelope handles exterior walls + roof,
  // so only render floors, interior walls, and openings as boxes
  const interiorPlacements = home.placements.filter(p => {
    const zone = p.zone || '';
    // Skip exterior walls and roof — envelope handles these
    if (zone === 'walls') return false;
    if (zone === 'roof') return false;
    return true;
  });

  return (
    <group>
      {/* Building envelope — proper extruded cross-section */}
      <EnvelopeMesh
        home={home}
        wallOpacity={wallOpacity}
        roofVisible={roofVisible}
      />

      {/* Room zone overlays */}
      <RoomZones
        rooms={home.rooms}
        footprint={home.footprint}
        visible={roomLabelsVisible}
        loftHeight={home.loftHeight}
        connections={home.connections}
      />

      {/* Loft floor platform */}
      {home.loftHeight != null && (
        <LoftPlatform
          footprint={home.footprint}
          loftHeight={home.loftHeight}
          rooms={home.rooms}
        />
      )}

      {/* Interior elements only: floors, interior walls, openings */}
      {interiorPlacements.map((placement, i) => {
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
