# Agent Notes

This repo is currently the Den paired floorplan product workflow, not the old SpatialIR/WikiHouse algorithm harness. Work from the paired artifact architecture unless a task explicitly says otherwise.

## Source Of Truth

The editable design source is paired semantic JSON:

```
paired_gpt_floorplan_v1
  + drawing_style_profile_v1
  + paired roof/elevation JSON when available
  -> deterministic SVG
  -> semantic_bim_v1 / buildable_bim_v1
  -> Product 3D / exports / QA
```

Do not make IFC, Product 3D meshes, marketplace assets, screenshots, or legacy home JSON the source of truth.

## Hard Rules

- Preserve the GPT proposal image as the design intent.
- Do not rectangle-pack, canonical-seed, or silently redesign the plan.
- Do not change semantic JSON to fix renderer-only style.
- Do not change renderer style to hide semantic drift.
- Do not lower thresholds or remove details to make tests pass.
- Product mode must hide debug guides, source anchors, validation rectangles, and raw traces.
- Debug/Review mode may show evidence, issue objects, source anchors, and guide geometry.
- Browser QA is required before claiming brochure or product quality.

## Quality Lanes

Keep validation signals separated:

- Design Quality: source image, semantic JSON, geometry, doors/openings, fixtures, standards, BIM, roof.
- Presentation Quality: deterministic 2D style, Product 3D cleanliness, camera/framing, debug separation.
- Brochure Quality: customer-facing Compare/Overlay/Product 3D/Cutaway/Front/Side/export screenshot quality.
- Manufacturing Readiness: module grid, build kit, panel spans, SKUs.
- Export Readiness: SVG/PNG/HTML packet, semantic BIM JSON, experimental IFC.
- Accessibility and Code Advisory: advisory only unless a jurisdiction-specific rule pack exists.

Manufacturing and IFC warnings must not masquerade as design failures. Design/Brochure blockers must block release-candidate export.

## Repair Workflow

Local code validates and orchestrates. GPT performs visual reasoning only through scoped repair prompts.

1. Generate a BCF-style issue or layer drift report.
2. Generate a targeted GPT repair prompt with:
   - source proposal image
   - deterministic render image
   - current paired JSON
   - exact failed layer
   - allowed JSON paths
   - blocked JSON paths
3. Accept RFC 6902 JSON Patch only.
4. Validate patch scope.
5. Apply, rerender, rerun drift/standards/BIM/browser QA.
6. Keep patch only if the target blocker improves and no new Design Quality blocker appears.

## Relevant Docs

- [PROJECT_STATUS.md](PROJECT_STATUS.md): current state and next work.
- [OPERATING_PRINCIPLES.md](OPERATING_PRINCIPLES.md): engineering rules learned from this and adjacent projects.
- [RENDER_FIX_PLAN.md](RENDER_FIX_PLAN.md): active source/render fidelity plan.
- [DESIGN_PRINCIPLES.md](DESIGN_PRINCIPLES.md): architectural design constraints and standards background.

## Current Regression Plans

- `a-frame-bunk/proposal-paired-v1`
- `a-frame-22/proposal-paired-v10`
- `outpost-medium/proposal-paired-v11`

Do not call any plan release-candidate unless browser QA screenshots show Compare, Overlay, Product 3D, Cutaway, Front, Side, Semantic, and export packet are customer-ready.

## Cleanup Policy

Use checkpoint cleanup, not destructive cleanup:

- Keep failed artifacts and repair bundles until a better path is proven.
- Delete only after `rg` proves the file/path is unreferenced and QA still passes.
- Prefer clean names over backward-compatible cruft before v1.0.
- Do not preserve old SpatialIR/canonical-seed terms in product UI.
- Do not reintroduce the removed pre-paired generator/analyzer paths guarded by `npm run paired:smoke`.
