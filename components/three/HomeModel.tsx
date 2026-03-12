'use client';

import type { DenHome, ModularComponent } from '@/lib/types';
import ComponentMesh from './ComponentMesh';

interface Props {
  home: DenHome;
  components: ModularComponent[];
  selectedComponent: string | null;
  onSelectComponent: (id: string | null) => void;
}

export default function HomeModel({ home, components, selectedComponent, onSelectComponent }: Props) {
  const compMap = new Map(components.map(c => [c.id, c]));

  return (
    <group>
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
          />
        );
      })}
    </group>
  );
}
