'use client';

import type { DenHome } from '@/lib/types';

interface Props {
  homes: DenHome[];
  selectedHome: string;
  onSelectHome: (id: string) => void;
}

export default function HomeSelector({ homes, selectedHome, onSelectHome }: Props) {
  return (
    <div className="flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-neutral-800 scrollbar-thin">
      {homes.map(h => {
        const active = h.id === selectedHome;
        return (
          <button
            key={h.id}
            onClick={() => onSelectHome(h.id)}
            className={`shrink-0 px-3 py-1.5 rounded text-left transition-all text-xs ${
              active
                ? 'bg-blue-500/20 border border-blue-500 text-blue-300'
                : 'bg-neutral-900 border border-neutral-700 text-neutral-400 hover:border-neutral-500'
            }`}
          >
            <div className="font-medium text-[11px] whitespace-nowrap">{h.model}</div>
            <div className="flex gap-2 text-[10px] opacity-70 whitespace-nowrap">
              <span>{h.sqft} sqft</span>
              <span>{h.bedBath}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
