# WikiHouse Planner

3D parametric home planner for Den Outdoors modular homes. Browse 15 architecturally validated floor plans with real-time 3D visualization.

## Stack

- **NextJS 16** — App Router, static export
- **React Three Fiber + drei** — 3D rendering (walls, floors, roofs, openings)
- **Tailwind CSS 4** — UI styling
- **Python generator** — `scripts/generate-data.py` produces all home/component JSON

## Architecture

```
scripts/generate-data.py   →  public/data/  (15 home JSONs + components + library)
                                    ↓
lib/types.ts + data.ts     →  typed data loader
                                    ↓
components/three/          →  3D scene (Scene, HomeModel, ComponentMesh)
components/ui/             →  selectors, catalogs, detail panels
                                    ↓
app/page.tsx               →  main page (split-panel: 3D left, UI right)
```

## Data Generator

`scripts/generate-data.py` (962 lines) encodes:

- **22 room types** with IRC/NKBA/ADA/IECC constraints
- **4ft grid system** — all dimensions snap to 4ft increments
- **13 component types** — 2 walls, 4 roofs, 2 floors, 4 openings, 1 foundation
- **8 architectural validators** — wet wall clustering, intimacy gradient, noise isolation, room proportions, storage/circulation budgets
- **100% envelope tiling** — no void cells, explicit L-shape support

```bash
python3 scripts/generate-data.py
```

## Development

```bash
npm install
python3 scripts/generate-data.py   # generate home data
npm run dev                         # dev server at localhost:3000
npm run build                       # static export to out/
```

## 15 Home Plans

Ascent ADU · Modern Alpine 2025 · Outpost Plus · Barnhouse 1.1 · Barnhouse 2.1 · Barnhouse Plus · Modern Treehouse · Barnhouse 2.2 · Eastern Farmhouse · L Barnhouse · Barnhouse 3.3 · A-Frame House Plus · Outpost Medium · Studio House · Barndo
