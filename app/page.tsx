'use client';

import dynamic from 'next/dynamic';
import { useState, useRef, useEffect, useCallback } from 'react';
import { components, homes, refreshData } from '@/lib/data';
import HomeSelector from '@/components/ui/HomeSelector';
import ComponentCatalog from '@/components/ui/ComponentCatalog';
import ComponentDetail from '@/components/ui/ComponentDetail';
import type { SceneHandle } from '@/components/three/Scene';
import FloorPlanView from '@/components/FloorPlanView';
import { validatePlan, airbnbSummary } from '@/lib/plan-validator';

const Scene = dynamic(() => import('@/components/three/Scene'), { ssr: false });

export default function Home() {
  const [selectedHomeId, setSelectedHomeId] = useState(homes[0]?.id ?? '');
  const [selectedComponent, setSelectedComponent] = useState<string | null>(null);
  const [wallOpacity, setWallOpacity] = useState(1.0);
  const [roofVisible, setRoofVisible] = useState(false);
  const [roomLabelsVisible, setRoomLabelsVisible] = useState(true);
  const [, setRefreshCount] = useState(0);
  const sceneRef = useRef<SceneHandle>(null);

  const homeIdx = homes.findIndex(h => h.id === selectedHomeId);
  const prevHome = () => {
    const i = (homeIdx - 1 + homes.length) % homes.length;
    setSelectedHomeId(homes[i].id); setSelectedComponent(null);
  };
  const nextHome = () => {
    const i = (homeIdx + 1) % homes.length;
    setSelectedHomeId(homes[i].id); setSelectedComponent(null);
  };

  // Auto-refresh data when generate-data.py updates the JSON
  const doRefresh = useCallback(async () => {
    await refreshData();
    setRefreshCount(c => c + 1); // trigger re-render with new data
  }, []);

  useEffect(() => {
    doRefresh();
    const interval = setInterval(doRefresh, 10000);
    return () => clearInterval(interval);
  }, [doRefresh]);

  // Keyboard: left/right arrows to cycle homes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'ArrowLeft') prevHome();
      if (e.key === 'ArrowRight') nextHome();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const currentHome = homes.find(h => h.id === selectedHomeId) ?? null;
  const currentComp = selectedComponent ? components.find(c => c.id === selectedComponent) ?? null : null;
  const usedComponents = currentHome?.componentsUsed ?? [];

  return (
    <div className="h-screen flex flex-col bg-[#faf8f5]">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-2.5 border-b border-stone-200 bg-white/90 backdrop-blur">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-stone-800">Heavy Mass — Pattern Book Planner</h1>
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

      {/* Home selector with prev/next */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-stone-200 bg-white/80">
        <button onClick={prevHome} className="px-2 py-1 text-sm rounded hover:bg-stone-100 text-stone-500 font-mono">&larr;</button>
        <button onClick={nextHome} className="px-2 py-1 text-sm rounded hover:bg-stone-100 text-stone-500 font-mono">&rarr;</button>
        <span className="text-[10px] text-stone-400 font-mono">{homeIdx + 1}/{homes.length}</span>
        <div className="flex-1">
          <HomeSelector
            homes={homes}
            selectedHome={selectedHomeId}
            onSelectHome={(id) => { setSelectedHomeId(id); setSelectedComponent(null); }}
          />
        </div>
        {currentHome && (
          <span className="text-[10px] text-stone-400 ml-2 hidden md:inline">
            {currentHome.footprint.width}&apos;×{currentHome.footprint.depth}&apos; — {currentHome.rooms.length} rooms — {currentHome.roofStyle}
          </span>
        )}
      </div>

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

        {/* Right: 3D viewport (top) + floor plan (bottom) — scrollable */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          {/* 3D viewport — fixed height */}
          <div className="relative" style={{ minHeight: '450px', height: '50vh' }}>
            {currentHome && (
              <Scene
                ref={sceneRef}
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
            <div className="absolute top-3 left-3 z-20 bg-white/90 backdrop-blur border border-stone-200 rounded-lg px-3 py-2.5 space-y-2 shadow-sm">
              <div className="text-[10px] text-stone-500 font-medium uppercase tracking-wider">View</div>

              <div className="flex gap-1">
                <button
                  onClick={() => { setRoofVisible(false); setWallOpacity(1); setRoomLabelsVisible(true); setTimeout(() => sceneRef.current?.setTopView(), 50); }}
                  className={`px-2 py-0.5 text-[10px] rounded border ${!roofVisible ? 'bg-stone-800 text-white border-stone-800' : 'bg-stone-100 hover:bg-stone-200 text-stone-600 border-stone-200'}`}
                >
                  Top
                </button>
                <button
                  onClick={() => { setRoofVisible(true); setWallOpacity(1); setRoomLabelsVisible(true); setTimeout(() => sceneRef.current?.set3DView(), 50); }}
                  className={`px-2 py-0.5 text-[10px] rounded border ${roofVisible ? 'bg-stone-800 text-white border-stone-800' : 'bg-stone-100 hover:bg-stone-200 text-stone-600 border-stone-200'}`}
                >
                  3D
                </button>
              </div>

              {/* Wall opacity */}
              <label className="flex items-center gap-2 text-[10px] text-stone-600">
                <span className="w-12">Walls</span>
                <input type="range" min={0} max={1} step={0.05} value={wallOpacity}
                  onChange={(e) => setWallOpacity(parseFloat(e.target.value))}
                  className="w-20 h-1 accent-stone-500" />
                <span className="w-7 text-right font-mono">{Math.round(wallOpacity * 100)}%</span>
              </label>

              {/* Roof toggle */}
              <label className="flex items-center gap-2 text-[10px] text-stone-600 cursor-pointer">
                <input type="checkbox" checked={roofVisible}
                  onChange={(e) => setRoofVisible(e.target.checked)} className="accent-stone-500" />
                Roof
              </label>

              {/* Room labels toggle */}
              <label className="flex items-center gap-2 text-[10px] text-stone-600 cursor-pointer">
                <input type="checkbox" checked={roomLabelsVisible}
                  onChange={(e) => setRoomLabelsVisible(e.target.checked)} className="accent-stone-500" />
                Room Labels
              </label>
            </div>

            {/* Info overlay */}
            {currentHome && (() => {
              const validation = validatePlan(currentHome);
              const summary = airbnbSummary(currentHome);
              return (
                <div className="absolute top-3 right-3 z-20 bg-white/90 backdrop-blur border border-stone-200 rounded-lg px-3 py-2 text-[10px] space-y-1 pointer-events-none shadow-sm max-w-52">
                  <div className="text-stone-700 font-semibold text-xs">{currentHome.model}</div>
                  <div className="text-stone-400 italic">{summary}</div>
                  <div className="text-stone-400">
                    {currentHome.footprint.width}&apos; × {currentHome.footprint.depth}&apos; — {currentHome.height}&apos; peak
                  </div>
                  <div className="text-stone-400">{currentHome.roofStyle} roof</div>
                  <div className="text-stone-400">
                    {currentHome.placements.length} pieces — {currentHome.rooms.length} rooms
                  </div>
                  <div className={`font-medium ${validation.passed === validation.total ? 'text-emerald-600' : 'text-amber-600'}`}>
                    Rules: {validation.passed}/{validation.total}
                    {validation.passed === validation.total ? ' ✓' : ''}
                  </div>
                  {validation.rules.filter(r => !r.passed).map((r, i) => (
                    <div key={i} className="text-red-400 text-[9px]">✗ {r.name}: {r.detail}</div>
                  ))}
                </div>
              );
            })()}

            {/* Controls hint */}
            <div className="absolute bottom-3 left-3 text-[9px] text-stone-400 pointer-events-none">
              Drag to orbit — Scroll to zoom — Click to select
            </div>
          </div>

          {/* Floor plan — scrollable, never cut off */}
          {currentHome && (
            <div className="border-t border-stone-200 bg-[#fdfbf7] flex items-start justify-center p-4" style={{ minHeight: '400px' }}>
              <FloorPlanView
                rooms={currentHome.rooms}
                footprint={currentHome.footprint}
                connections={currentHome.connections}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
