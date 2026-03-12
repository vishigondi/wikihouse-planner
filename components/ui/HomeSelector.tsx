'use client';

import type { DenHome } from '@/lib/types';

interface Props {
  homes: DenHome[];
  selectedHome: string;
  onSelectHome: (id: string) => void;
}

export default function HomeSelector({ homes, selectedHome, onSelectHome }: Props) {
  return (
    <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-stone-200 bg-white/80 backdrop-blur scrollbar-thin">
      {homes.map(h => {
        const active = h.id === selectedHome;
        return (
          <button
            key={h.id}
            onClick={() => onSelectHome(h.id)}
            className={`shrink-0 px-3 py-1.5 rounded-md text-left transition-all text-xs ${
              active
                ? 'bg-stone-800 text-stone-100 shadow-sm'
                : 'bg-stone-100 text-stone-500 hover:bg-stone-200 hover:text-stone-700'
            }`}
          >
            <div className="font-medium text-[11px] whitespace-nowrap">{h.model}</div>
            <div className="flex gap-2 text-[10px] opacity-70 whitespace-nowrap">
              <span>{h.sqft} sf</span>
              <span>{h.bedBath}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
