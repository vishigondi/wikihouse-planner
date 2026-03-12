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

  const currentHome = homes.find(h => h.id === selectedHomeId) ?? null;
  const currentComp = selectedComponent ? components.find(c => c.id === selectedComponent) ?? null : null;
  const usedComponents = currentHome?.componentsUsed ?? [];

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
        <div>
          <h1 className="text-sm font-bold tracking-tight">Den Outdoors — Modular Component Planner</h1>
          <span className="text-[10px] text-neutral-500">
            {components.length} components — {homes.length} homes — 3D
          </span>
        </div>
        {currentHome && (
          <div className="text-right">
            <div className="text-xs text-neutral-400">{currentHome.model}</div>
            <div className="text-[10px] text-neutral-500">
              {currentHome.sqft} sqft — {currentHome.footprint.width}&apos;x{currentHome.footprint.depth}&apos; — {currentHome.bedBath}
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
        {/* Left sidebar: component catalog + detail */}
        <div className="w-56 border-r border-neutral-800 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <ComponentCatalog
              components={components}
              selectedComponent={selectedComponent}
              highlightedComponents={usedComponents}
              onSelectComponent={setSelectedComponent}
            />
          </div>
          <div className="border-t border-neutral-800 max-h-56 overflow-y-auto">
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
            />
          )}

          {/* Info overlay */}
          {currentHome && (
            <div className="absolute top-3 right-3 bg-neutral-950/80 backdrop-blur border border-neutral-800 rounded-lg px-3 py-2 text-[10px] space-y-1 pointer-events-none">
              <div className="text-neutral-300 font-semibold text-xs">{currentHome.model}</div>
              <div className="text-neutral-500">
                {currentHome.footprint.width}&apos; x {currentHome.footprint.depth}&apos; — {currentHome.height}&apos; peak
              </div>
              <div className="text-neutral-500">{currentHome.roofStyle} roof</div>
              <div className="text-neutral-500">
                {currentHome.placements.length} pieces — {currentHome.componentsUsed.length} types
              </div>
            </div>
          )}

          {/* Controls hint */}
          <div className="absolute bottom-3 left-3 text-[9px] text-neutral-600 pointer-events-none">
            Drag to orbit — Scroll to zoom — Click component to select
          </div>
        </div>
      </div>
    </div>
  );
}
