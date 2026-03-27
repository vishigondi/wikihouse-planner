# Wikihouse Planner — Comprehensive Render Fix Plan
**Date:** 2026-03-27
**Author:** Vishi / Analysis by Claude
**Grounded in:** Value Guardian v10 (register separation), Anthropic harness design, Browser-Use auto-research loop pattern

---

## Diagnosis: What's Actually Broken

The screenshot shows floating room labels over gray floor tiles, with no walls and no doors visible. The 2D plan shows rooms as boxes without wall thickness or door openings. Here's the root-cause tree, ordered by severity:

---

## Bug 1 — CRITICAL: Interior Walls Logic is Inverted
**File:** `lib/generate-placements.ts`, lines 184–242
**Symptom:** Zero interior walls between rooms in the 3D view.

**Root cause:** The code currently places a wall ONLY between rooms that have an explicit `door`/`wall`/`sliding` connection:
```ts
if (!hasWallConnection(a.label, b.label)) continue;  // ← WRONG
```
This means: two adjacent bedrooms with no connection at all = no wall between them. Two rooms with a `door` connection = wall placed (correct, the wall hosts the door). But rooms with no connection at all (not even `open`) should STILL have walls. The correct architecture should be: **place a wall on every shared grid edge, UNLESS the connection is `open`** (open plan, cased opening, etc.).

**Fix:** Invert the predicate. The new logic:
```ts
function hasOpenConnection(labelA: string, labelB: string): boolean {
  return connections.some(c =>
    c.type === 'open' && (
      (c.from === labelA && c.to === labelB) ||
      (c.from === labelB && c.to === labelA)
    )
  );
}
// In the loop:
if (hasOpenConnection(a.label, b.label)) continue;  // skip open plan boundaries
// Otherwise: always place interior wall on shared edges
```
This is also more honest to the Value Guardian principle: the wall is the default state (the value), not the exception. Open plan is the exception that gets registered.

---

## Bug 2 — CRITICAL: EnvelopeMesh Hollow Shell — Winding Bug
**File:** `components/three/EnvelopeMesh.tsx`, lines 96–112
**Symptom:** Building shell may render as fully solid (no interior visibility) or corrupt at certain view angles.

**Root cause:** The inner hole Path traces in the **same winding direction** as the outer Shape. In Three.js, a hole must wind in the **opposite** direction to subtract correctly from the shape. Since both outer and inner trace the same sequence of profile points (just inset), they're co-directional. The ExtrudeGeometry may silently ignore the hole or produce Z-fighting.

**Secondary issue:** The inner hole shares both ground points with the outer shape (`p.y < 0.1` returns `p` unchanged). So the hole is "open" at the bottom — this is intentional (the floor plane closes it). But the shared endpoints create a degenerate path that Three.js may triangulate incorrectly.

**Fix option A (minimal):** After building `innerPoints`, reverse the array before creating the hole:
```ts
const hole = new THREE.Path();
const reversed = [...innerPoints].reverse();
hole.moveTo(reversed[0].z, reversed[0].y);
for (let i = 1; i < reversed.length; i++) {
  hole.lineTo(reversed[i].z, reversed[i].y);
}
hole.closePath();
```

**Fix option B (structural, recommended):** Ditch the hollow shell approach entirely. Replace with 4 explicit wall planes (front, back, left, right) as `PlaneGeometry` or `BoxGeometry` with proper thickness. This gives you physical walls you can cut door/window openings through (see Bug 4).

---

## Bug 3 — HIGH: No Door/Window Openings Cut in Walls
**File:** `components/three/EnvelopeMesh.tsx` + `lib/generate-placements.ts`
**Symptom:** Door and window component meshes float inside solid wall surfaces. No actual openings.

**Root cause:** Three.js doesn't natively support CSG (constructive solid geometry) hole-cutting through mesh subtraction. The current code places door/window box meshes at the wall plane position, but since the wall is a continuous extruded shell, the door is hidden inside the geometry. There are no cut-outs.

**Fix options:**

**Option A — Visual trick (no real geometry):** Keep the continuous EnvelopeMesh but set wallOpacity dynamically based on camera angle. When looking from the front, reduce opacity. This is fast but fake.

**Option B — Section-based walls (recommended for correctness):** Replace the monolithic shell with individual wall segments. Generate walls as an array of `BoxGeometry` panels, each 4ft wide × wall_height tall × 0.5ft thick. Skip the 4ft panel where a door/window placement falls. This requires aligning the openings grid to the wall panel grid — which already matches the 4ft GRID system.

```ts
// Wall panel generation (pseudocode for generate-placements.ts):
for each exterior wall cell (4ft segment):
  if cell center overlaps a door or window placement:
    skip (opening)
  else:
    place wall panel box
```

**Option C — Use THREE-CSGMesh or BSP library:** Full CSG subtraction. Overkill for this use case, adds a heavy dependency, but gives photorealistic openings.

**Recommendation:** Option B. It maps cleanly onto the existing 4ft grid and keeps the system deterministic and data-driven.

---

## Bug 4 — HIGH: wallOpacity Default Likely Too Low
**File:** `app/page.tsx` or `components/three/Scene.tsx`
**Symptom:** Walls appear ghosted or invisible even when the shell geometry is correct.

**Root cause:** The `wallOpacity` prop defaults to a low value (probably 0.3–0.5) for aesthetic transparency. But until the interior is properly rendered, opacity < 1 just makes the building look empty.

**Fix:** Default `wallOpacity` to `0.85` in the initial state. Add a UI slider that goes from 0.3 (ghost view) to 1.0 (opaque). Keep the roof visibility toggle. The ghost view is a feature, not the default.

---

## Bug 5 — HIGH: 2D Floor Plan Missing Wall Thickness and Door Symbols
**File:** `components/FloorPlanView.tsx`
**Symptom:** Floor plan looks like colored boxes, not architectural drawings.

**Root causes:**
1. Rooms are drawn as filled `<rect>` with 1.5px stroke — looks like a diagram, not a floor plan
2. No wall thickness rendered — real plans show 4–6in walls as double lines
3. Doors are computed in the `connections` logic but only rendered as arcs in 3D (RoomZones.tsx). The SVG FloorPlanView draws no door symbols.
4. The loft level appears as a separate grid to the right of ground floor — this is correct for the evaluator but confusing in the UI (should be shown as an upper level overlay or separate tab)

**Fix:** Wall thickness rendering in SVG:
```svg
<!-- Instead of one rect per room, draw room fills + a separate wall layer -->
<!-- Room fill (slightly inset) -->
<rect x={x+3} y={y+3} width={w-6} height={h-6} fill={roomColor} />
<!-- Exterior walls as thick lines (3px = ~6in at scale) -->
<!-- Interior walls as slightly thinner lines (2px) -->
<!-- Door opening as gap in wall line + quarter-arc sweep -->
```

The door symbol algorithm:
1. Find the midpoint of the shared edge between two `door`-connected rooms
2. Draw a gap in the wall line at that midpoint (door width = ~2.5ft = ~37px at 15px/ft)
3. Draw a quarter-circle arc from the door hinge point (door swing indicator)
4. For sliding doors: draw two parallel lines instead of arc

---

## Bug 6 — MEDIUM: Data Pipeline Split — Python vs. TypeScript Generators
**File:** `scripts/generate-data.py` vs. `lib/generate-placements.ts`
**Symptom:** Homes from `library.json` use pre-baked placements from Python. Kintsugi homes use runtime TypeScript generation via `spatialToDenHome()`. The two paths produce different quality output.

**Root cause:** Two independent placement generators that can diverge. The Python generator in `generate-data.py` (1396 lines) has complex wall generation logic; the TypeScript `generate-placements.ts` is simpler and doesn't handle L-shaped footprints correctly.

**Fix:** Standardize on the TypeScript runtime generator as the source of truth. Remove baked placements from `library.json` (set `placements: []` in the JSON). Have `lib/data.ts` always call `generatePlacements(home)` at load time. This means one code path, one bug to fix instead of two.

The Python generator remains as the authoritative source for `rooms`, `connections`, `footprint`, `roofStyle`, etc. — just not for `placements`.

```ts
// In data.ts:
export let homes: DenHome[] = lib.homes.map(h => ({
  ...h,
  placements: generatePlacements(h),  // always regenerate
}));
```

---

## Bug 7 — MEDIUM: Loft Room Repositioning Hack
**File:** `components/three/RoomZones.tsx`, lines 104–138
**Symptom:** Loft room labels appear floating in weird positions above the building.

**Root cause:** Loft rooms in the grid are placed at `gz > gridD` (beyond the ground floor footprint) for the Python layout evaluator. At runtime, `RoomZones.tsx` tries to reposition them above the building center using a "relative offset from loft group center" calculation. This math is fragile and produces bad positions when there are multiple loft rooms.

**Fix:** Add a `worldPosition?: {x: number; y: number; z: number}` override field to `RoomLayout`. Populate it in `generate-placements.ts` for loft rooms during placement generation. Then `RoomZones.tsx` simply uses `worldPosition` if present, skipping the reprojection math:
```ts
const yPos = room.worldPosition?.y ?? (floorElev + 0.05);
const cx = room.worldPosition?.x ?? computedCx;
const cz = room.worldPosition?.z ?? computedCz;
```

---

## Bug 8 — MEDIUM: `spatialToDenHome()` Packing Loses Architectural Intent
**File:** `lib/data.ts` (spatialToDenHome function)
**Symptom:** Kintsugi/SpatialIR plans display with wrong room adjacencies — rooms get packed into rows by zone type (public/private), losing the actual spatial relationships.

**Root cause:** The `spatialToDenHome` adapter ignores the explicit `gx`/`gz` coordinates from SpatialIR's room definitions and re-packs rooms into rows by zone. If the SpatialIR rooms already have grid positions, they should be used directly.

**Fix:** Check if rooms have explicit grid coordinates before re-packing:
```ts
const hasGridCoords = plan.rooms.every(r =>
  r.gridX !== undefined && r.gridZ !== undefined
);
if (hasGridCoords) {
  // Use explicit grid positions
  rooms = plan.rooms.map(r => ({ ...r, gx: r.gridX, gz: r.gridZ, ... }));
} else {
  // Fall back to zone-based packing
  rooms = packByZone(plan.rooms);
}
```

---

## Bug 9 — LOW: ComponentMesh Roof Geometry Wrong
**File:** `lib/generate-placements.ts`, lines 244–277
**Symptom:** Roof "panels" appear as flat tilted boxes, not as actual roof planes.

**Root cause:** Roof is generated as individual cell-wide tilted boxes (`rot.x = ±roofAngle`). These don't connect to form a continuous roof surface. The EnvelopeMesh handles the actual roof shell correctly via the extruded profile — so these roof component boxes are redundant AND wrong.

**Fix:** Since `HomeModel.tsx` already filters `zone === 'roof'` placements and delegates to `EnvelopeMesh`, the roof placements are dead code. Simply don't generate them in `generate-placements.ts`. Or keep them for the "component catalog" view but hide them in the main 3D view.

---

## The Auto-Research Loop Architecture

Per the browser-use findings and your Value Guardian paper, the fix process itself should run as an auto-research loop — not as manual trial and error.

**The evaluator (inner loop — objective function):**
```python
# autoresearch/plan-fidelity/evaluate.py
def score_render(screenshot_path: str, spec: dict) -> dict:
    """
    Score a rendered screenshot against the ground truth spec.
    Returns: {walls: bool, doors: bool, rooms_labeled: bool, score: float}
    """
    # Use vision_loop_claude.py pattern — send screenshot to Claude vision
    # Check: are walls visible? are door openings present?
    # are room labels correctly positioned?
    pass
```

**The outer loop (Value Guardian — prevents proxy drift):**
```python
# value_guardian_loop.py pattern
def guardian_check(inner_scores: list[dict], v_spec: str) -> dict:
    """
    Every N=5 inner cycles, question whether score improvements
    reflect actual render quality or just gaming the screenshot metric.
    Returns: {drift_detected: bool, new_focus: str, invalidators: list}
    """
    pass
```

**The debugging CLI (3 hierarchy levels, per browser-use pattern):**
```
Level 1: build_logs        → "Did npm build succeed?"
Level 2: screenshot_diff   → "What changed between renders?"
Level 3: component_trace   → "Which specific Three.js geometry is wrong?"
```

**The key lesson from browser-use (40% token savings):** Use TSV instead of JSON for the render score logs. A score like `outpost\t0.82\t0.91\t0.78` beats `{"model":"outpost","walls":0.82,...}` for token efficiency across 20 cycles.

**The judge (aligned with human judgment):** The auto-research loop must use a vision judge that was calibrated against what YOU think looks correct — not just whether the code compiles. Use `vision_loop_claude.py` from `autoresearch/plan-fidelity/` as the inner-loop evaluator, feeding it screenshots from `npm run build` → Puppeteer/Playwright snapshot.

---

## Implementation Priority Queue

| Priority | Bug | Files Touched | Estimated Effort | Impact |
|----------|-----|---------------|-----------------|--------|
| P0 | Bug 1 — Invert interior wall logic | `generate-placements.ts` | 20 min | Walls appear immediately |
| P0 | Bug 4 — Fix wallOpacity default | `app/page.tsx` or Scene state | 5 min | Walls become visible |
| P1 | Bug 2 — Fix EnvelopeMesh winding | `EnvelopeMesh.tsx` | 30 min | Shell renders correctly |
| P1 | Bug 3 — Section-based wall panels (option B) | `generate-placements.ts` + `EnvelopeMesh.tsx` | 2h | Real door openings |
| P1 | Bug 5 — 2D floor plan walls + doors | `FloorPlanView.tsx` | 1.5h | Plan looks architectural |
| P2 | Bug 6 — Unify generators | `data.ts`, `generate-data.py` | 1h | One truth, fewer regressions |
| P2 | Bug 7 — Loft world positions | `generate-placements.ts`, `RoomZones.tsx` | 45min | Loft labels correct |
| P2 | Bug 8 — spatialToDenHome coords | `data.ts` | 30min | Kintsugi plans correct |
| P3 | Bug 9 — Remove dead roof placements | `generate-placements.ts` | 10min | Cleanup |

---

## The Loop Protocol

Per Value Guardian (your paper): separate the optimization register from the evaluation register.

**Inner loop (optimizer):** Runs `generate-placements.ts` → `npm run build` → Playwright screenshot → score. Makes edits. Does NOT see the Value Guardian spec directly.

**Outer loop (evaluator / Value Guardian):** Every 5 cycles, compares score trajectory against:
- V1: "Does a real architect looking at this screenshot know where the front door is?"
- V2: "Can you tell which rooms are private vs. public?"
- V3: "Does the 3D view match the 2D plan?"

These three value anchors cannot be gamed by the inner loop because they require human-perceptual judgment, not a proxy metric. The outer loop scores against them using vision_loop_claude.py.

**The overfitting guard (from browser-use):** Split the 15 homes into train (10) and holdout (5). Run the fix loop on train only. Validate on holdout. Any "fix" that improves train but hurts holdout is task-specific overfitting — reject it.

**TSV score format for each cycle:**
```
model_id\twalls_score\tdoors_score\tplan_match\tnotes
the-outpost\t0.00\t0.00\t0.45\tno walls visible, labels float
```

---

## The One-Liner Entry Point

After fixing Bugs 1 + 4 (30 minutes of work), run:
```bash
cd workspace/projects/wikihouse-planner
python3 scripts/generate-data.py && npm run build
```

Then snapshot the output and run `autoresearch/plan-fidelity/vision_loop_claude.py` on it. That gives you the baseline score to beat. Every subsequent loop cycle improves against that baseline, with the Value Guardian checking every 5 cycles that you haven't drifted from "actual architectural fidelity" toward "passes the vision test."

This is exactly the architecture the paper describes — and it works here because the render quality problem is a Goodhart problem: easy to optimize for "looks like something" but hard to maintain "looks like a real floor plan."
