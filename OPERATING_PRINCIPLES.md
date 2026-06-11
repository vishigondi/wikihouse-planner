# Operating Principles

These are the engineering principles from adjacent projects that apply directly to this floorplan pipeline. They are saved here as repo policy because the same bug shapes are already present in this work: lossy artifacts, validation at the wrong layer, green checks over broken real output, and duplicated stale facts.

## Paired Artifacts Must Round-Trip Losslessly

If semantic JSON writes a plan element, loading and rendering that JSON must preserve it. Truncation, simplification, display capping, and preview-only elision belong in renderers and UI views, not serializers.

For this repo:

- `paired_gpt_floorplan_v1`, `drawing_style_profile_v1`, `semantic_bim_v1`, and `buildable_bim_v1` must be lossless enough to round-trip the plan.
- A fixture, wall, source anchor, source primitive, opening, door swing, roof plane, or callout cannot be dropped because it makes JSON easier to read.
- Marketplace assets can be scaled to semantic bounds, but cannot change the semantic plan geometry.
- Display-friendly caps, thumbnails, or summaries must be generated at the UI/export layer. They must not be written back into paired artifacts.

## Filter At The Boundary

Bad input should be blocked where it enters the system, not patched downstream by every consumer.

For this repo:

- Filter ChatGPT/app screenshots out of reference-image handoffs before prompt generation.
- Reject malformed or broad GPT JSON Patches at the patch-scope validator before applying them.
- Validate imported paired JSON before it can become selectable/promoted.
- Keep secrets and provider tokens server-side; never let browser/provider adapters leak them.
- Remove old side-channel manifests and symlinks instead of letting consumers choose between competing sources of truth.
- Archive cleanup must also be boundary-checked: before moving generated evidence, validation files, manifests, or paired artifacts, grep the active manifest and scripts for references. A file is only cruft after the active source-of-truth graph says it is not reachable.

## Bug Shapes Repeat

When a bug appears, search for its shape across the repo rather than only fixing the visible symptom.

For this repo:

- If one visual drift layer is using full parent wall spans instead of split segment spans, search all primitive layers and QA readers for the same assumption.
- If one sparse linework layer is wrongly blocking on dark-pixel area, audit all sparse layers: dimensions, windows, dashed guides, callouts.
- If one renderer branch treats a void/open-to-below as solid geometry, audit Product 3D, Cutaway, Plan Top, BIM export, and brochure export.

## Real Browser QA Is The Substantive Test

Unit tests catch known regressions. Browser screenshots catch production shape failures: bad framing, broken scroll, hidden panels, debug geometry in product mode, WebGL failures, and source/render mismatch.

For this repo:

- `npm run qa:brochure` is not optional for product claims.
- A plan is not brochure-ready because TypeScript compiles or validation chips are green.
- Compare, Overlay, Product 3D, Cutaway, Front, Side, Semantic, and export packet must be tested in a real browser.
- Sample real promoted artifacts, not only aggregate counters. Measure coverage, fallback use, stale evidence, and whether screenshots actually show the plan surface being claimed.

## Test Fixtures Must Mirror Production Shape

Tiny synthetic plans can hide the same problems that break Den plans.

For this repo:

- Regression fixtures must include multi-level plans, split wall segments, source anchors, dashed voids, doors/windows, fixtures, furniture, decks, roof/elevation, and multiple viewports.
- A one-room fixture is useful for unit tests, but not enough to prove the pipeline.

## Clean Renames Before v1

This product has not shipped as v1.0. Prefer clean names over compatibility aliases while the surface is still moving.

For this repo:

- Rename stale `SpatialIR`, canonical seed, parser, or legacy component-kit concepts when they leak into product UI.
- Do not preserve old names merely because they existed during exploration.
- Once shipped, compatibility matters; before that, clarity matters more.

## Numeric And Status Claims Drift

Counts, pass/fail status, and quality claims in prose go stale quickly.

For this repo:

- Prefer command examples and source paths over prose claims like "32/32 ready."
- If a doc includes current metrics, date it and name the source file.
- Do not call a plan brochure-ready in docs unless browser QA and visual review currently support it.
- Public-facing claims need a guard at the surface that ships them. If the app says Brochure Quality passes, QA must assert that the same lane is visible and backed by current evidence.

## Show Representative Evidence

Summaries alone hide the failure. Use the actual screenshot, issue row, repair bundle, or representative primitive when communicating a drift problem.

For this repo:

- Attach Compare/Overlay/Product 3D screenshots to QA artifacts.
- Repair prompts should include source image, deterministic render, current JSON, exact drift layer, allowed paths, and blocked paths.
- Use BCF-style issues for precise failure coordinates and semantic ids.

## Work At The User's Unit

The user thinks in plans and product views, not individual SVG nodes or Three.js meshes.

For this repo:

- Product readiness is per plan artifact, across all required views.
- Primitive drift is useful only because it explains plan-level mismatch.
- Manufacturing warnings should not be mixed with Design/Brochure quality.

## Archive Evidence, Do Not Erase The Trail

Cleanup is part of reaching a stable foundation, but evidence has value until the replacement path is proven.

For this repo:

- Move stale candidates, old backups, failed repair attempts, and heavyweight provider downloads to `/Users/openclaw/.openclaw/archive/...` instead of deleting them outright.
- Do not archive manifest-referenced validation files, current paired JSON, current source images, current render/drift outputs, repair bundles, or browser QA evidence unless the manifest and scripts are updated in the same pass.
- After cleanup, rerun `npm run paired:smoke` so stale references fail fast.
- The app should never default to archived/stale artifacts; archive status is for traceability, not promotion.

## Shared UI And Style Primitives Are Contracts

When the same visual rule appears in several places, centralize it.

For this repo:

- Drawing style belongs in `drawing_style_profile_v1` and renderer helpers, not one-off SVG tweaks.
- Product/debug mode separation belongs in shared viewer contracts, not scattered conditionals.
- Component asset mappings belong in the component registry, not per-fixture special cases.

## Smoke Selectors Should Be Structural

QA should target stable structure rather than copy that will change.

For this repo:

- Browser QA should use product/data attributes or structural selectors for gallery cards, view tabs, validation lanes, and export buttons.
- Text assertions are okay for critical user-visible blockers, but should not be the only selector.

## Every Shipped Surface Gets A Guard

When a product surface is added or fixed, add a smoke or regression guard in the same pass.

For this repo:

- New tabs, export packet fields, repair flows, render modes, and validation lanes need browser or script checks.
- When extending a guard, update its description so the test remains readable.

## Invalid Geometry Is Worse Than Missing Geometry

One bad geometry primitive can poison an entire render, BIM export, or drift calculation.

For this repo:

- Validate finite numbers, axis-aligned spans where required, nonzero dimensions, and floor/frame ownership at import time.
- Keep consumer-side guards as defense in depth, but treat import/cache/write boundaries as the permanent gate.

## Three Inline Shapes Means A Helper

If the same check is implemented three ways, it is already an abstraction.

For this repo:

- Promote repeated geometry checks, source-anchor normalization, sparse-linework detection, fixture classification, and wall splitting into shared helpers.
- Future bug-shape audits need one helper name to grep.
- This is not premature abstraction when the operation is already copied three times. It is a drift-prevention boundary.

## Pixel Similarity Is Not Semantic Similarity

Embeddings are not structural similarity in text pipelines; likewise, pixels alone are not architectural correctness here.

For this repo:

- Use primitive-level drift to locate mismatch, but classify the issue as semantic drift or presentation drift before fixing.
- Do not change semantic JSON to fix style.
- Do not change renderer style to hide wrong geometry.
- Source anchors are evidence, not executable geometry. If a source anchor is attached to a split wall, door, fixture, or window, the compiler must prove that the anchor maps to the same primitive span before using it as a blocker. Parent-wall anchors must not be treated as child-segment anchors.

## Do Not Make The Image The Source Of Truth

A model can make a good-looking plan image and a plausible JSON block that disagree with each other. That is expected behavior unless generation is constrained by a shared geometry representation.

For this repo:

- Treat source images as visual evidence, not executable geometry.
- Treat GPT JSON as volatile source code until it passes schema, geometry, topology, standards, visual drift, and browser QA checks.
- Keep `paired_gpt_floorplan_v1` as the narrow-waist semantic representation.
- Do not ask one prompt to solve semantics, 2D drawing style, BIM, and photoreal rendering as one inseparable artifact.
- If a later image-generation lane is added, condition it from validated geometry maps so it cannot move the plan.

## Compile Spatial Data Before Rendering It

The product should behave like a compiler pipeline: parse, type-check, unit-test, compile, render, package.

For this repo:

- Schema checks are compile-time type checks.
- Geometry containment, overlap, door swing, fixture clearance, roof/wall intersection, and navigation graph checks are spatial unit tests.
- BCF-style issues are tracebacks.
- Scoped GPT JSON Patch is the repair step.
- Deterministic 2D and BIM/Product 3D are compiled outputs.
- Brochure/exterior imagery is a downstream presentation artifact, not the editable model.

## Primitive Contracts Are The Debugging Surface

The plan cannot become brochure-ready if walls, doors, windows, fixtures, ladders, dashed voids, labels, and dimensions are only compared as whole-image pixels.

For this repo:

- Every visible source primitive should have a semantic/rendered primitive, a source anchor, and a layer-specific tolerance.
- Split walls are physical segments. The compiler should compare each segment, not a continuous parent line hidden by masks.
- Primitive issues should identify the exact layer and id, then generate a scoped GPT JSON Patch prompt for that layer.
- If primitive extraction is noisy, fix the extractor or mark the evidence noisy. Do not promote a plan on the basis of noisy anchors, and do not bury a real visual mismatch under a broad whole-image metric.
- Source primitive overrides are a boundary contract. If `sourceWalls` or `sourceOpenings` exist, renderers and QA must use them as the source primitive channel instead of silently deriving a competing expected graph from older semantic arrays. The semantic graph still matters, but only after the explicit primitive channel is reconciled.
- Coordinate units must be named at the boundary. Source-opening spans are stored in the 4-ft planning grid, source image boxes are pixel evidence, and semantic drift checks run in feet. Copying a point across these layers without conversion creates false geometry blockers that look like design drift.
- Boundary ids can carry stronger evidence than generic kinds, but only within their semantic category. For example, an interior id containing `open-to-below` can be a dashed void guide even if its extracted `wallKind` says partition, while an exterior wall id containing `open-to-below` is still a physical exterior wall if its `wallKind` is `exterior-wall`. Do not let a regex for one layer steal primitives from another layer.
- Normalize vocabulary at the write boundary. Source doors must use app enums such as `interiorDoor`, `exteriorDoor`, and `bifoldDoor`; imported strings like `swing-door` or `exterior-swing-door` are source evidence, not validator-ready schema values.
- Keep semantic object bounds separate from brochure glyph bounds. A toilet, bed, stair, or range may have buildable semantic dimensions while its source proposal glyph includes pillows, wall context, clearance marks, or linework padding. Store that as explicit visual/source-primitive evidence instead of mutating the semantic object to fit the picture or ignoring the source glyph when rendering.
- Do not paste source-image crops into the deterministic render to make drift green. Crops are evidence for repair and reviewer context; the release render should be vector/semantic output. If a raster preservation lane is ever added, it must be explicit, validated, and separate from the deterministic compiler output.

## Annotation Primitives Are Not Structural Geometry

Dimension lines, callout labels, floor labels, and dashed guide rhythms are brochure content, but they are not walls, doors, rooms, or fixtures.

For this repo:

- If source dimension edges are missing, that is semantic/source-frame drift.
- If source dimension edges are covered but the renderer adds extra ticks, labels, or stroke rhythm, that is presentation drift.
- Annotation drift can still block Brochure Quality. It should not trigger broad semantic JSON repair unless the source frame or dimension span is actually wrong.
- Repair prompts for annotation drift should target `drawing_style_profile_v1`, label/dimension bounds, or explicit annotation spans, not walls/rooms/fixtures.
- This prevents the loop from asking GPT to rewrite the plan geometry when the real issue is drawing language.

## Monolithic Spatial Generation Is A Trap

Asking one model pass to produce the authoritative floorplan image, semantic JSON, and 3D rendering creates false confidence. Pixels, JSON, and 3D meshes can each look plausible while disagreeing.

For this repo:

- Use model generation to propose source artifacts, not to bypass validation.
- Keep the semantic JSON as the narrow waist.
- If an image and JSON disagree, neither one wins automatically; the compiler emits issues and the repair loop patches the semantic layer or style profile explicitly.
- Do not add new downstream lanes that can silently redefine geometry.

## Geometry First, Photorealism Later

Beautiful renders are useful only after geometry is validated.

For this repo:

- First pass: source/render primitive alignment, schema, geometry, topology, standards, BIM, and browser QA.
- Second pass: product 3D material quality, fixtures, roof assembly, cutaway, and elevations.
- Later pass: conditioned exterior/interior imagery from deterministic depth, edge, normal, or segmentation maps.
- Never let a photorealistic image repair or mutate the semantic plan.

## Right-Size The Fix And Guard The Exact Invariant

Avoid blunt fixes that create the mirror-image bug.

For this repo:

- Do not globally thicken/thin all walls to fix one plan's wall edge drift.
- Do not relax Brochure Quality because one sparse layer has a false positive.
- Guard the invariant that broke: wall segment alignment, fixture room ownership, door swing direction, roof/panel intersection, or source/render primitive drift.
- Mutation-check important guards manually when possible: remove the fix, confirm the guard fails, then restore it. A substring check that survives a broken runtime is not a guard.

## Fan Out Cheap Probes, Then Prune

Parallel probes are useful when the search space is wide, but only if the pruning signal is explicit.

For this repo:

- Use subagents or scripts for independent wall, fixture, 3D, and QA investigations.
- Keep what improves measured drift or browser-visible quality.
- Discard experiments that improve one metric while regressing a more important gate.
