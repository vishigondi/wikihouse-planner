'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { components, homes } from '@/lib/data';
import HomeSelector from '@/components/ui/HomeSelector';
import ComponentCatalog from '@/components/ui/ComponentCatalog';
import ComponentDetail from '@/components/ui/ComponentDetail';

const Scene = dynamic(() => import('@/components/three/Scene'), { ssr: false });

export default function Home() {
  const [selectedHomeId, setSelectedHomeId] = useState(homes[0]?.id ?? '');
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [wallOpacity, setWallOpacity] = useState(1);
  const [roofVisible, setRoofVisible] = useState(true);
  const [roomLabelsVisible, setRoomLabelsVisible] = useState(true);

  const currentHome = homes.find(h => h.id === selectedHomeId) ?? null;
  const currentComp = selectedComponent ? components.find(c => c.id === selectedComponent) ?? null : null;
  const usedComponents = currentHome?.componentsUsed ?? [];

  return (
    <div className="h-screen flex flex-col bg-[#faf8f5]">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-stone-800">Den Outdoors — Retreat Planner</h1>
          <span className="text-[10px] text-stone-400">
            {components.length} components — {homes.length} homes — Japandi
          </span>
        </div>
        {currentHome && (
          <div className="text-right">
            <div className="text-xs text-stone-600 font-medium">{currentHome.model}</div>
            <div className="text-[10px] text-stone-400">
              {currentHome.sqft} sf — {currentHome.footprint.width}&apos;×{currentHome.footprint.depth}&apos; — {currentHome.bedBath}
            </div>
          </div>
        )}
      </header>

      {/* Home selector */}
      <HomeSelector
        homes={homes}
        selectedHome={selectedHomeId}
        onSelectHome={(id) => { setSelectedHomeId(id); setSelectedComponent(null); }}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <div className="w-56 border-r border-stone-200 bg-white flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ComponentCatalog
              components={components}
              selectedComponent={selectedComponent}
              highlightedComponents={usedComponents}
              onSelectComponent={setSelectedComponent}
            />
          </div>
          <div className="border-t border-stone-200 max-h-56 overflow-y-auto">
            <ComponentDetail
              component={currentComp}
              currentHome={currentHome}
              onSelectHome={(id) => { setSelectedHomeId(id); setSelectedComponent(null); }}
            />
          </div>
        </div>

        {/* 3D viewport */}
        <div className="flex-1 relative">
          {currentHome && (
            <Scene
              home={currentHome}
              components={components}
              selectedComponent={selectedComponent}
              onSelectComponent={setSelectedComponent}
              wallOpacity={wallOpacity}
              roofVisible={roofVisible}
              roomLabelsVisible={roomLabelsVisible}
            />
          )}

          {/* View controls */}
          <div className="absolute top-3 left-3 bg-white/90 backdrop-blur border border-stone-200 rounded-lg px-3 py-2.5 space-y-2 shadow-sm">
            <div className="text-[10px] text-stone-500 font-medium uppercase tracking-wider">View</div>

            {/* Wall opacity */}
            <label className="flex items-center gap-2 text-[10px] text-stone-600">
              <span className="w-12">Walls</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={wallOpacity}
                onChange={(e) => setWallOpacity(parseFloat(e.target.value))}
                className="w-20 h-1 accent-stone-500"
              />
              <span className="w-7 text-right font-mono">{Math.round(wallOpacity * 100)}%</span>
            </label>

            {/* Roof toggle */}
            <label className="flex items-center gap-2 text-[10px] text-stone-600 cursor-pointer">
              <input
                type="checkbox"
                checked={roofVisible}
                onChange={(e) => setRoofVisible(e.target.checked)}
                className="accent-stone-500"
              />
              Roof
            </label>

            {/* Room labels toggle */}
            <label className="flex items-center gap-2 text-[10px] text-stone-600 cursor-pointer">
              <input
                type="checkbox"
                checked={roomLabelsVisible}
                onChange={(e) => setRoomLabelsVisible(e.target.checked)}
                className="accent-stone-500"
              />
              Floor Plan
            </label>
          </div>

          {/* Info overlay */}
          {currentHome && (
            <div className="absolute top-3 right-3 bg-white/90 backdrop-blur border border-stone-200 rounded-lg px-3 py-2 text-[10px] space-y-1 pointer-events-none shadow-sm">
              <div className="text-stone-700 font-semibold text-xs">{currentHome.model}</div>
              <div className="text-stone-400">
                {currentHome.footprint.width}&apos; × {currentHome.footprint.depth}&apos; — {currentHome.height}&apos; peak
              </div>
              <div className="text-stone-400">{currentHome.roofStyle} roof</div>
              <div className="text-stone-400">
                {currentHome.placements.length} pieces — {currentHome.rooms.length} rooms
              </div>
              {/* Room legend */}
              <div className="pt-1 border-t border-stone-200 space-y-0.5 max-h-40 overflow-y-auto">
                {currentHome.rooms.map((room, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ background: room.color }}
                    />
                    <span className="text-stone-500 truncate">{room.label}</span>
                    <span className="ml-auto text-stone-400 font-mono shrink-0">{room.area}sf</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls hint */}
          <div className="absolute bottom-3 left-3 text-[9px] text-stone-400 pointer-events-none">
            Drag to orbit — Scroll to zoom — Click to select
          </div>
        </div>
      </div>
    </div>
  );
}
