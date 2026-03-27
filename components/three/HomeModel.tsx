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

  // Render ALL placements as individual panels (walls, floors, openings).
  // Roof is handled by EnvelopeMesh. Walls are individual 4ft panels
  // so door/window openings show as gaps.
  const visiblePlacements = home.placements.filter(p => {
    const zone = p.zone || '';
    if (zone === 'roof') return false; // envelope handles roof
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

      {/* All elements: walls (as panels), floors, interior walls, openings */}
      {visiblePlacements.map((placement, i) => {
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
