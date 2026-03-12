'use client';

import type { ModularComponent, DenHome } from '@/lib/types';
import { CATEGORY_COLORS } from '@/lib/types';

interface Props {
  component: ModularComponent | null;
  currentHome: DenHome | null;
  onSelectHome: (id: string) => void;
}

export default function ComponentDetail({ component, currentHome, onSelectHome }: Props) {
  if (!component) {
    return (
      <div className="p-3 text-neutral-500 text-[11px]">
        Click a component to view details
      </div>
    );
  }

  const color = CATEGORY_COLORS[component.category];
  const d = component.dimensions;
  const instanceCount = currentHome
    ? currentHome.placements.filter(p => p.componentId === component.id).length
    : 0;

  return (
    <div className="p-3 space-y-2">
      <div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <h3 className="text-xs font-semibold text-neutral-200">{component.name}</h3>
        </div>
        <div className="text-[10px] text-neutral-500 mt-0.5 pl-4">
          {component.category} — {component.properties.panelType}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <div className="bg-neutral-900 rounded px-2 py-1">
          <div className="text-neutral-500">W</div>
          <div className="text-neutral-300 font-mono">{d.width}&apos;</div>
        </div>
        <div className="bg-neutral-900 rounded px-2 py-1">
          <div className="text-neutral-500">H</div>
          <div className="text-neutral-300 font-mono">{d.height}&apos;</div>
        </div>
        <div className="bg-neutral-900 rounded px-2 py-1">
          <div className="text-neutral-500">D</div>
          <div className="text-neutral-300 font-mono">{d.depth}&apos;</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {component.properties.structural && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">structural</span>
        )}
        {component.properties.insulated && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">insulated</span>
        )}
        {component.properties.exterior && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">exterior</span>
        )}
      </div>

      {instanceCount > 0 && (
        <div className="text-[10px] text-neutral-400">
          <span className="text-neutral-200 font-mono">{instanceCount}</span> instances in this home
        </div>
      )}

      {component.usedInHomes.length > 0 && (
        <div>
          <div className="text-[10px] text-neutral-500 mb-1">Used in {component.usedInHomes.length} homes:</div>
          <div className="flex flex-wrap gap-1">
            {component.usedInHomes.map(hid => (
              <button
                key={hid}
                onClick={() => onSelectHome(hid)}
                className="text-[9px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                {hid}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
