# Floorplan Studio

Product-facing browser viewer for the Den Outdoors paired floorplan loop. The app starts from a Drafted-style gallery, opens each paired artifact as a customer-facing product page, and keeps repair/export/debug tools available without making them the default surface.

## Status Docs

- [PROJECT_STATUS.md](PROJECT_STATUS.md) is the current handoff: active architecture, target plans, current blockers, metrics, cleanup stance, and next work.
- [OPERATING_PRINCIPLES.md](OPERATING_PRINCIPLES.md) captures the relevant engineering principles for this repo: lossless paired artifacts, boundary validation, browser QA, bug-shape audits, and semantic/presentation separation.
- [RENDER_FIX_PLAN.md](RENDER_FIX_PLAN.md) tracks the active source/render fidelity plan.

## Current Role

- Browse paired Den-style plan candidates with bed/bath, square-footage, level, roof, and readiness filters.
- Show gallery cards with plan thumbnail, elevation preview, status, and Design / Presentation / Brochure quality chips.
- Open a product detail page with clean BIM/Product 3D as the primary canvas.
- Keep Compare, Overlay, and Semantic review views for source/render/JSON evidence.
- Keep the old component/review rail hidden behind explicit `Review Tools`.
- Generate scoped GPT repair prompts for blocked artifacts and apply RFC 6902 JSON Patch repairs through validation.
- Export stable product packets while keeping Manufacturing and IFC readiness separate from Design/Brochure quality.

The app is not the generator and should not repair layouts silently. Generation and visual reasoning happen through GPT image+JSON handoffs. Local code validates, scopes, applies, rolls back, renders, and exports.

## Current Reality

The active app has one browser-passing review artifact and two blocked review artifacts. Promotion still does not mean the whole product goal is done:

- `outpost-medium/proposal-paired-v11` currently passes desktop and laptop brochure QA after scoped source-anchor, fixture, and wall primitive repairs.
- `a-frame-bunk/proposal-paired-v1` is still blocked under strict Brochure QA. A scoped bed-span patch and fixture-body profile sweep improved the score and cleared the fixture-specific blocker, but broader drawing-language drift remains. A source-image crop overlay experiment was rejected as too fragile and too heavy for product output.
- `a-frame-22/proposal-paired-v10` remains the hardest source/render drift case. Fixture-body profile tuning improved fixture drift, but door, fixture, ladder, dashed-void, and broader primitive drawing-language drift are still real blockers.

Do not call a plan brochure-ready from manifest status or validation chips alone. A release candidate needs Design Quality, Presentation Quality, Brochure Quality, and browser screenshots to agree.

## Product Workflow

1. Open `/` to browse the product gallery.
2. Filter plans by bedrooms, baths, square footage, levels, roof type, or readiness status.
3. Open a plan for Product 3D, Compare, Overlay, and Semantic review.
4. If the plan is blocked, use `Repair Prompt` from the card or `Repair With GPT` from the detail page.
5. Send the scoped prompt to GPT and request JSON Patch only.
6. Evaluate the returned patch with `npm run repair:evaluate`; it applies, rerenders, recomputes drift, and rolls back if the patch is worse.
7. Re-run `npm run qa:brochure` only when you need a full browser evidence packet.
8. Export the brochure packet only when Design, Presentation, and Brochure quality pass.

Optional local API handoff:

```bash
cp .env.example .env.local
# Fill OPENAI_API_KEY and OPENAI_REPAIR_MODEL in .env.local.
npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all
npm run repair:gpt -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --model "$OPENAI_REPAIR_MODEL" --yes
npm run repair:evaluate -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --patch artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild/patch.json
npm run qa:brochure
```

`repair:gpt` reads `OPENAI_API_KEY` from the shell or `.env.local`, attaches the bundle's visual evidence locally, writes `patch.json`, and runs `repair:apply --dry-run` for scope validation. It never exposes provider keys to browser code.

Manual ChatGPT handoff:

```bash
npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all
# Upload one zip from artifacts/brochure-qa/repair-bundles-all to ChatGPT and save the returned JSON Patch text as response.txt.
npm run repair:ingest -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --response response.txt
npm run repair:evaluate -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --patch artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild/patch.json
npm run qa:brochure
```

To run the same loop explicitly without installing cron:

```bash
npm run repair:loop -- --url http://127.0.0.1:3001 --iterations 1
npm run repair:loop -- --url http://127.0.0.1:3001 --iterations 3 --model "$OPENAI_REPAIR_MODEL" --yes
```

Without `--yes`, `repair:loop` refreshes browser QA, regenerates uploadable repair bundles, and prints the next exact handoff. With `--yes`, it requires `OPENAI_API_KEY`, requests a scoped patch, applies it through the validator, reruns browser QA, and rolls back unless the target plan either loses blockers or improves visual-drift score.

## Paired Artifact Contract

The source of truth is no longer a floorplan alone. A brochure-ready candidate should be a paired architectural artifact:

1. GPT proposal floorplan image
2. deterministic semantic floorplan JSON
3. deterministic floorplan render
4. front and side elevation images or elevation traces
5. semantic roof/elevation JSON

The roof/elevation block must be anchored to the same footprint, wall graph, openings, and floor levels as the plan. The app may render a provisional roof from `roofStyle`, but a plan is not roof-complete until JSON contains explicit roof planes/elevations:

- `roof.style`
- `roof.ridgeDirection`
- `roof.ridgeLine`
- `roof.eaveHeightFt`
- `roof.ridgeHeightFt`
- `roof.pitchDeg`
- `roof.overhangFt`
- `roof.planes[].polygon3d`
- `elevations[].facadeWallIds`
- `elevations[].openings`
- `elevations[].outline`

Validation must catch a roof/elevation that changes footprint width/depth, moves wall openings, invents a different facade, or renders a 3D roof from generic style instead of paired roof geometry.

## Render Themes

Render themes are separate from geometry. The same semantic plan can be drawn as a review model, a Den brochure plan, a soft furnished floorplan, a white A-frame cutaway, or a construction-kit view without changing rooms, walls, fixtures, roof, or elevations.

Theme data may specify materials, wall colors, background, lighting, cutaway mode, fixture detail, furniture style, labels, and camera presets. Theme data must never move geometry or make a blocked plan pass validation.

The default theme is `product-presentation`. Debug guides, anchors, source traces, grids, and legacy component-kit geometry must stay behind explicit Debug/Review mode.

## Data Sources

```
dev-compiler image-loop  ->  symlink  ->  public/data/den-image-loop
proposal-manifest.json   ->  paired artifact selection and promotion state
paired-generation-queue  ->  next GPT repair/regeneration targets
library/components       ->  retained component metadata with no legacy home defaults
```

Legacy SpatialIR home defaults, static home JSON, and old canonical seed paths are intentionally excluded from app selection.

Legacy generator/analyzer files from the pre-paired SpatialIR loop have been removed from the active foundation. The paired smoke check guards that they do not silently return.

## Stack

- Next.js 16 App Router
- React Three Fiber + drei for optional 3D review
- Tailwind CSS 4
- TypeScript

## Commands

```bash
npm run dev          # dev server at localhost:3000
npm run build        # production/static build
npx tsc --noEmit     # typecheck
npm run paired:smoke # paired data/default-selection smoke check
npm run qa:brochure  # browser QA: gallery, repair, product views, compare/overlay, export packet
npm run repair:queue # print next scoped GPT repair prompt for each blocked QA packet
npm run repair:queue -- --bundle-dir artifacts/brochure-qa/repair-bundles-all --all # create uploadable GPT repair folders with prompt + evidence images
npm run repair:queue -- --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all # also create one uploadable zip per repair bundle
npm run repair:gpt -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --model "$OPENAI_REPAIR_MODEL" --yes # optional local OpenAI handoff, writes patch.json
npm run repair:loop -- --url http://127.0.0.1:3001 --iterations 1 # explicit QA -> bundle -> handoff loop, no cron
npm run repair:ingest -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --response response.txt # extract/validate patch.json from copied ChatGPT output
npm run repair:ingest -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild --latest-download # use newest likely ChatGPT patch from ~/Downloads
npm run repair:doctor # report API/model/bundle/session/QA readiness and print the next repair commands
npm run archive:stale # move manifest-archived paired sidecars/backups/debug traces out of active folders
npm run goal:audit # strict completion audit for the Drafted-style product goal
npm run repair:prompt -- --packet artifacts/brochure-qa/a-frame-bunk-brochure-repair-packet.json --layer "level frames"
npm run repair:evaluate -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-walls --patch patch.json # apply, render, drift-check, and rollback if worse
npm run repair:apply -- --packet artifacts/brochure-qa/a-frame-bunk-brochure-repair-packet.json --layer "level frames" --patch patch.json # raw scope-only apply for debugging
```

`artifacts/brochure-qa/repair-bundles-all` is the active repair-bundle directory. Older one-layer bundle output was archived and should be regenerated rather than reused.

## Related Dev-Compiler Commands

```bash
npm run image:paired:queue
npm run image:paired:accept -- <planId> <proposalId> <imagePath> <pairedJsonPath>
npm run image:paired:accept -- <planId> <proposalId> <imagePath> <pairedJsonPath> --review-passed
```
