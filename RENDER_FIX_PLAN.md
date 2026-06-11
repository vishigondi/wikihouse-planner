# Paired Render Fix Plan

## Current Status

The old SpatialIR/render-health bug list is superseded for the Den Outdoors paired artifact loop. The active renderer target is now:

1. GPT proposal image is brochure-quality.
2. `paired_gpt_floorplan_v1` JSON describes that exact image.
3. `drawing_style_profile_v1` captures the proposal's drawing language without changing geometry.
4. Deterministic render matches the GPT proposal in primitive geometry and presentation style.
5. Roof/elevation semantics describe the same footprint, ridge, facade openings, and levels.
6. BIM/Product 3D renders downstream from paired semantic JSON, not from legacy component placement.
7. App release-candidate status is blocked until validation, visual drift, roof/elevation review, browser QA, and human review pass.

## Current Baseline

The current regression set has three review artifacts under the strict Brochure QA gate:

| Plan | Artifact | State |
| --- | --- | --- |
| `a-frame-bunk` | `proposal-paired-v1` | Review / blocked under strict Brochure QA. One scoped bed primitive patch improved drift, but fixture/body drawing-language drift still blocks sales-brochure status. |
| `a-frame-22` | `proposal-paired-v10` | Review / blocked. Source primitive overrides, door type normalization, and the void-face suppression fix are in place. Current visual drift fails at primitive scale: fixtures, ladder/stairs, dimensions, and broader primitive drawing mass remain mismatched. |
| `outpost-medium` | `proposal-paired-v11` | Browser QA pass. Scoped source-anchor, fixture, and wall primitive repairs cleared the current desktop/laptop QA run. Keep it as the passing regression target. |

Older candidates remain blocked/debug-only and must not become defaults. Manifest promotion is not a release-candidate claim.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for current metrics and next work.

## Latest Fix Checkpoint

Current strict QA checkpoint:

- Fast checks are green: lint for touched renderer/geometry files, TypeScript, and paired geometry smoke.
- `npm run archive:stale --` moved stale paired backups out of active paired folders.
- Browser QA now passes `outpost-medium` and still blocks the A-frame plans, which means the gates are doing useful discrimination:
  - `a-frame-bunk` remains blocked by overall drawing-language drift after accepted bed-span and fixture-body profile repairs. Latest strict QA reports full source miss `30.4%`, full render extra `24.0%`; the fixture-specific blocker is cleared.
  - `a-frame-22` is blocked by drawing-language drift and fixture primitive drift. Latest strict QA reports full source miss `58.7%`, full render extra `40.1%`, fixture source miss `39.3%`, and fixture render extra `37.7%` after a fixture-body profile repair.
  - `outpost-medium` is the current passing regression target after scoped wall and fixture repairs.
- A renderer experiment that added a soft SVG wall-shadow filter was removed because it did not move drift metrics. Continue with explicit style/profile extraction and primitive repair rather than hidden post-processing.
- `npm run goal:audit` remains incomplete until at least one target plan reaches true brochure-ready status in browser QA.
- Browser-assisted repair was tested on `outpost-medium/proposal-paired-v11` source primitive overrides:
  - ChatGPT returned a narrow patch for `/sourceOpenings/13`.
  - Scope ingestion passed, evaluation rejected, and rollback succeeded because the patch did not improve drift.
  - A local source-box door renderer probe was also reverted because it improved area drift while worsening edge drift.
- The current lesson is that the scoped repair/evaluation loop can improve real drift when the failing primitive is correctly isolated; broad or wrong-layer patches still get rejected.

The active Outpost work uncovered a source-of-truth split:

- The renderer was consuming `sourceWalls` / `sourceOpenings`.
- Browser QA and primitive validation were still partly deriving expected primitives from older semantic wall/opening arrays.
- The source primitive materializer also copied source-opening door hinge points in feet, while the renderer expected grid units.

Current fixes:

- `scripts/materialize-source-primitive-overrides.mjs`
  - preserves semantic door metadata when materializing source openings.
  - infers exterior roles and wall kind for source wall ids such as `ew-*`.
  - stores source-opening door hinge/leaf points in 4-ft grid units.
  - archives generated paired JSON backups out of the active paired folder.
- `lib/drawing-primitives.ts`
  - treats explicit `sourceWalls` / `sourceOpenings` as the expected source primitive contract when present.
  - converts source-override door points back to feet for semantic drift validation.
  - validates source-override doors from source bounds first so door QA measures the actual proposal primitive rather than stale semantic swing metadata.
- `scripts/brochure-visual-qa.mjs`
  - uses explicit source primitive overrides for expected wall/opening primitives when they exist.
- `components/FloorPlanView.tsx`
  - renders source-override doors from their source bounds first, avoiding giant arcs from mismatched coordinate units.
  - treats explicit interior open-to-below/void boundary source ids as dashed void primitives while preserving exterior wall ids as physical walls.

Result:

- Outpost no longer fails from missing source wall/opening roles or giant false door geometry.
- Outpost still fails Presentation/Brochure Quality because the deterministic render visibly differs from the GPT proposal.
- Do not solve the remaining failure with style thresholds. The next pass must classify the remaining mismatch as either semantic composition drift or drawing-style drift, then repair that layer only.

Follow-up checkpoint:

- `a-frame-22/proposal-paired-v10` now has `71` materialized source wall primitives and `19` source openings.
- The materializer now normalizes door strings like `swing-door`, `exterior-swing-door`, and `bifold-closet-door` to the app's door enum before validation.
- This cleared the missing semantic door type blockers.
- The renderer now distinguishes dashed void boundary markers from area/cross markers. Boundary markers no longer suppress the full semantic open-to-below face, so the loft void X/area renders again and dashed-void edge drift is back near the passing range.
- Remaining `a-frame-22` blockers are real primitive drift: fixtures, ladder/stairs, dimensions, and broad Compare/Overlay mass. The generated repair queue now starts with semantic rebuild / fixtures / style / walls / stairs / level frames.
- The next fixture fix should introduce an explicit source visual glyph/primitive footprint lane instead of forcing semantic fixture bounds to match source-image glyph boxes. Semantic bounds remain buildable geometry; visual primitive bounds drive brochure comparison.

## Render Work Queue

- Preserve the GPT source image as the design intent; do not redesign in the renderer.
- Use paired JSON geometry, source anchors, source primitives, and drawing style profiles to improve wall, door, window, fixture, label, and dimension placement.
- Split physical wall primitives into actual rendered segments; do not draw continuous lines and mask them with white gaps.
- Classify drift before fixing:
  - semantic/frame drift -> scoped GPT JSON Patch
  - presentation/style drift -> renderer or `drawing_style_profile_v1`
  - product 3D drift -> BIM/Product renderer or component registry
- Add paired roof/elevation JSON to every new artifact; do not rely on `roofStyle` alone for 3D roof geometry.
- Keep render themes separate from geometry: presentation style can change materials, lighting, camera, labels, and cutaway mode, but cannot move rooms/walls/fixtures.
- Validate front/side elevations against the floorplan wall graph before calling a plan brochure-ready.
- Prefer structural edge/source-anchor-aware drift checks over global dark-pixel comparisons when evaluating structural match.
- Use layer-aware body comparison where the drawing primitive demands it: thick wall bands may need wider body tolerance than sparse fixtures/dimensions, but edge checks remain the structural gate.
- Treat sparse linework dark-area drift for dimensions/windows as warning-level when primitive edge geometry passes; do not let sparse-line area metrics create false structural blockers.
- Keep blocked artifacts visible for review/debug, never brochure-ready.
- Re-test in the browser Compare and Overlay views before any `--review-passed` promotion.

## Compiler Roadmap

The next stable architecture is a decoupled spatial compiler, not a monolithic prompt that asks one model to produce JSON, 2D pixels, and 3D presentation at once.

### What We Are Explicitly Not Building

- Do not rely on a single multimodal prompt to produce authoritative pixels, semantic JSON, and 3D geometry in one pass.
- Do not treat a good-looking generated image as proof that the JSON is correct.
- Do not treat plausible JSON as proof that the pixels match it.
- Do not run endless broad regeneration loops when a deterministic compiler error can identify the failing primitive.
- Do not let photorealistic/exterior rendering happen before the vector layout, BIM lane, and presentation views pass validation.

The model output is volatile source code. It can be useful, but it must compile.

### Stage 1: Constrained Semantic Layout

- Treat `paired_gpt_floorplan_v1` as the compile target.
- Prefer schema-constrained generation/import when available.
- Long-term: evaluate constrained decoding for paired semantic JSON so malformed keys, invalid roles, and out-of-bounds fields are rejected during generation rather than after parsing.
- Required roles: walls, rooms/open zones, voids, doors, windows, openings, fixtures, furniture, stairs/ladders, dimensions, source anchors, level frames, roof/elevation.
- Reject malformed JSON at the boundary. Do not let malformed artifacts enter the gallery or default plan selection.

### Stage 2: Geometry And Topology Unit Tests

- Use deterministic geometry checks for containment, overlap, adjacency, wall/opening ownership, fixture room ownership, and door swing collisions.
- Use graph checks for circulation and room-to-room connectivity.
- Use real physical units as the canonical coordinate substrate. Pixel coordinates are source evidence; feet/inches are the compiled design space.
- Normalize 2D canvas/SVG and Three.js coordinates through one mapper so Y-axis inversion, scale, and level offsets cannot diverge per renderer.
- Keep these checks separate from presentation checks. Geometry pass does not mean brochure-ready.

### Stage 3: Self-Healing Repair Loop

- A failed check creates a BCF-style issue with exact semantic ids, primitive ids, expected/actual values, allowed patch paths, and blocked patch paths.
- GPT repairs return RFC 6902 JSON Patch only.
- The app validates patch scope, applies, rerenders, reruns drift/standards/BIM checks, and rolls back if the targeted issue does not improve.
- Broad local heuristics are not the default repair mechanism.
- Repair prompts should be layer-scoped tracebacks: one failing wall segment, door swing, fixture anchor, void span, roof plane, or drawing-style rule at a time.

### Stage 4: Deterministic 2D And BIM/Product 3D

- Deterministic 2D consumes semantic JSON plus `drawing_style_profile_v1`.
- Product 3D consumes `buildable_bim_v1`.
- BIM fixtures and marketplace assets are presentation/detail assets only. They must fit semantic bounds and cannot redefine geometry.
- Roof/elevation must be explicit semantic data before it can be validated.

### Stage 5: Conditioned Brochure Rendering

- Photorealistic or exterior images are downstream from validated geometry.
- If an image model is used for brochure/exterior renderings, feed it geometry-derived condition maps such as depth, normal, edge, or segmentation maps.
- Never use an unconstrained presentation image as authoritative geometry.
- A render can be visually beautiful and still be blocked if it changes the validated plan.
- A future image-rendering lane should consume deterministic viewport captures, depth/normal/edge maps, and material prompts. It must output marketing imagery only, not edited geometry.

## Standards To Extract Into Code

The useful pieces from the generative-CAD architecture notes map to concrete repo work:

| Principle | Repo action |
| --- | --- |
| Token/schema enforcement | Strengthen `paired_gpt_floorplan_v1` validation and eventually add constrained-generation import support. |
| Geometry unit tests | Keep expanding containment, overlap, wall/opening, fixture, roof, and mesh-intersection validators. |
| Topology tests | Treat circulation and room adjacency as graph checks, not visual inspection. |
| Traceback repair | Emit BCF-style issues with ids, coordinates, expected/actual, and allowed patch paths. |
| Compile to CAD/BIM | Keep `semantic_bim_v1` / `buildable_bim_v1` as downstream compiled artifacts. |
| Deterministic 3D | Fix 3D from the semantic/BIM lane before adding photorealistic rendering. |
| Conditioned imagery | Add depth/edge/normal-map based brochure rendering later, after deterministic views pass. |

## Current Focus

0. Keep `outpost-medium/proposal-paired-v11` as the current passing regression target.
   - Browser QA passes after scoped repairs.
   - Do not extrapolate this to launch readiness for all plans.
   - If it regresses, start from the latest wall/fixture repair bundles and direct source-anchor preference fix.
1. Repair `a-frame-22` presentation/source primitive drift layer by layer.
   - Source anchors are flowing into the stored render alignment path; the remaining failures are drawing-language and symbol-body mismatches.
   - Start from fixtures, doors, ladder/stairs, and drawing style profile repair bundles.
   - The reusable `style:sweep` script now includes thicker fixture-body variants because both A-frame targets benefited from that profile shape.
2. Repair `a-frame-bunk` fixture/body presentation drift.
   - The loft bed span patch and fixture-body profile sweep improved the score and cleared the fixture-specific blocker.
   - Next useful work is source-frame/wall/opening/dimension primitive alignment plus vector glyph/body refinement, not more raster source crops.
   - Do not use source-image crop overlays. That experiment made the stored SVG heavy and browser-fragile.
3. Keep source-image crops as repair evidence only.
   - If a future raster-preservation lane is added, it must be explicit, separate from deterministic vector output, and validated for browser/export performance.
4. Only after the 2D primitive basis is clean, improve Product 3D roof panels, wall heights, fixtures, cutaway, and camera presets.

Do not use source-image crop overlays to force a pass. That experiment made the stored SVG fragile and worsened drift. Source crops belong in repair evidence; the deterministic render must remain compiled vector/semantic output unless a future explicit raster-preservation lane is designed and validated.

## Validation Commands

```bash
npx tsc --noEmit
npm run paired:smoke
npm run render:paired
npm run drift:paired
npm run qa:brochure
npm run build
```

Dev-compiler side:

```bash
npm run typecheck
npm test
npm run image:paired:accept -- <planId> <proposalId> <imagePath> <pairedJsonPath>
```
