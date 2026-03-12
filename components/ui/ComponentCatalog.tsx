'use client';

import type { ModularComponent, ComponentCategory } from '@/lib/types';
import { CATEGORY_COLORS } from '@/lib/types';

interface Props {
  components: ModularComponent[];
  selectedComponent: string | null;
  highlightedComponents: string[];
  onSelectComponent: (id: string | null) => void;
}

const CATEGORY_ORDER: ComponentCategory[] = ['wall', 'roof', 'floor', 'structural', 'opening', 'specialty'];

export default function ComponentCatalog({ components, selectedComponent, highlightedComponents, onSelectComponent }: Props) {
  const grouped = new Map<ComponentCategory, ModularComponent[]>();
  for (const cat of CATEGORY_ORDER) {
    grouped.set(cat, components.filter(c => c.category === cat));
  }

  return (
    <div className="h-full overflow-y-auto p-2 space-y-3">
      <h2 className="text-xs font-bold text-neutral-300 uppercase tracking-wider px-1">
        Components ({components.length})
      </h2>
      {CATEGORY_ORDER.map(cat => {
        const items = grouped.get(cat) || [];
        if (items.length === 0) return null;
        const color = CATEGORY_COLORS[cat];
        return (
          <div key={cat}>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-1 px-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span style={{ color }}>{cat}</span>
              <span className="text-neutral-600">({items.length})</span>
            </h3>
            <div className="space-y-0.5">
              {items.map(c => {
                const isActive = selectedComponent === c.id;
                const isUsed = highlightedComponents.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => onSelectComponent(isActive ? null : c.id)}
                    className={`w-full text-left px-2 py-1 rounded text-[10px] transition-all flex items-center gap-2 ${
                      isActive
                        ? 'bg-blue-500/20 border border-blue-500 text-blue-300'
                        : isUsed
                        ? 'bg-neutral-900 border border-neutral-700 text-neutral-300 hover:border-neutral-500'
                        : 'bg-transparent border border-transparent text-neutral-600 hover:bg-neutral-900/50'
                    }`}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: isUsed ? color : '#334155' }}
                    />
                    <span className="truncate">{c.name}</span>
                    <span className="ml-auto text-neutral-600 shrink-0">
                      {c.dimensions.width}x{c.dimensions.height}&apos;
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
