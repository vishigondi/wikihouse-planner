# Heavy Mass — Pattern Book Planner

3D parametric cabin planner with 40 architecturally validated floor plans from Den Outdoors. Browse, compare, and evaluate cabins with real-time 3D visualization and rule validation.

## Features

- **40 homes** — from 196sqft A-Frame Bunk to 3000sqft Studio House
- **3D visualization** — panel-based walls, roof geometry, deck rendering
- **Japandi palette** — shou-sugi-ban exterior, hinoki interior, cedar decks
- **Live rule validation** — 6 Den Great Room pattern rules per plan
- **Airbnb summary** — brief booking-ready description for each plan
- **Zone-tinted floor plans** — public (warm), private (blue), outdoor (green)
- **A-frame support** — knee walls, steep roof geometry
- **Multi-level** — loft rooms at 8ft elevation, ground + upper split

## Data Sources

```
dev-compiler manifest  →  symlink  →  public/data/spatial-manifest.json
kintsugi-plans.json    →  symlink  →  public/data/kintsugi-plans.json
library.json           →  static   →  13 components + legacy homes
```

The app reads SpatialIR plans directly from the dev-compiler manifest. No converter needed — changes to the manifest appear on page refresh.

## Stack

- **Next.js 16** — App Router, dev server at :3000
- **React Three Fiber + drei** — 3D rendering
- **Tailwind CSS 4** — UI styling
- **TypeScript** — full type safety

## Commands

```bash
npm run dev       # dev server at localhost:3000
npm run build     # static export to out/
npx tsc --noEmit  # typecheck
```

## Architecture

```
lib/data.ts              →  loads SpatialIR manifest + converts to DenHome
lib/generate-placements.ts →  auto-generates 3D wall/floor/roof/door panels
lib/plan-validator.ts    →  6 Den rules + Airbnb summary
components/three/        →  3D scene (Scene, HomeModel, ComponentMesh, EnvelopeMesh)
components/FloorPlanView.tsx →  2D SVG floor plan with zones + fixtures
components/ui/           →  selectors, catalogs, detail panels
```
