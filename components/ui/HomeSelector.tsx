'use client';

import type { DenHome } from '@/lib/types';

interface Props {
  homes: DenHome[];
  selectedHome: string;
  onSelectHome: (id: string) => void;
}

export default function HomeSelector({ homes, selectedHome, onSelectHome }: Props) {
  const current = homes.find(h => h.id === selectedHome);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-stone-200 bg-white/80 backdrop-blur">
      <select
        value={selectedHome}
        onChange={(e) => onSelectHome(e.target.value)}
        className="bg-stone-100 border border-stone-200 rounded-md px-3 py-1.5 text-xs text-stone-700 font-medium cursor-pointer hover:bg-stone-200 transition-colors focus:outline-none focus:ring-1 focus:ring-stone-400 min-w-[200px]"
      >
        {homes.map(h => (
          <option key={h.id} value={h.id}>
            {h.model} — {h.sqft}sf — {h.bedBath}
          </option>
        ))}
      </select>
      {current && (
        <span className="text-[10px] text-stone-400">
          {current.footprint.width}&apos;×{current.footprint.depth}&apos; — {current.rooms.length} rooms — {current.roofStyle}
        </span>
      )}
    </div>
  );
}
