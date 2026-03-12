'use client';

import type { DenHome, ModularComponent } from '@/lib/types';
import ComponentMesh from './ComponentMesh';
import RoomZones from './RoomZones';

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

  return (
    <group>
      {/* Room zone overlays */}
      <RoomZones
        rooms={home.rooms}
        footprint={home.footprint}
        visible={roomLabelsVisible}
      />

      {/* All component placements */}
      {home.placements.map((placement, i) => {
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
