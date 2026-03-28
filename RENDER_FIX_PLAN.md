# Render Fix Plan — Status

All 9 original bugs have been addressed. See git history for implementation details.

| Bug | Status | Commit |
|-----|--------|--------|
| Bug 1 — Interior wall logic inverted | ✅ Fixed | `isOpenConnection` predicate, walls by default |
| Bug 2 — EnvelopeMesh winding | ✅ Fixed | Panel-based walls, envelope = roof only |
| Bug 3 — No door/window openings | ✅ Fixed | Two-pass: collect openings → skip in wall gen |
| Bug 4 — wallOpacity default | ✅ Fixed | Default 0.7, render_health invariant guards it |
| Bug 5 — 2D plan wall thickness | ⚠️ Partial | Door arcs + zone tinting done, no double-line walls |
| Bug 6 — Data pipeline split | ✅ Fixed | Single TS generator for all homes |
| Bug 7 — Loft repositioning | ✅ Fixed | Graph layout level separation + LoftPlatform |
| Bug 8 — spatialToDenHome packing | ✅ Fixed | Graph-based layout from SpatialIR edges |
| Bug 9 — Dead roof placements | ✅ Fixed | No roof placements, EnvelopeMesh handles roof |

## Validation Coverage

The loop (`autoresearch/plan-fidelity/run.py`) now guards against regressions:

- **Step 0**: `tsc --noEmit` — full TypeScript build check
- **Step 1**: Architectural validation — 15 generated plans
- **Step 1b**: 15 render health invariants (EnvelopeMesh, ComponentMesh, generate-placements, graph-layout)
- **Step 1b**: 15 placement data checks (runtime Y positions, wall counts, floor ranges)
- **Step 1c**: 7 layout health invariants (CSS / viewport)
- **Step 1d**: 32 SpatialIR manifest schema checks
- **Step 2**: Visual floor plan score — 8.3/10

## Remaining Work

- Bug 5: SVG wall thickness (double-line walls in FloorPlanView.tsx)
- Live 3D screenshot scoring via Chrome DevTools / Playwright
- Fill open-plan gaps between rooms (passage rooms)
- Per-wing roofing for L-shaped buildings
