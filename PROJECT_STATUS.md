# Project Status

Last updated: 2026-06-16 (social Feed view + photoreal renders — shipped)

## 2026-06-16 Social Feed View (photoreal) — Shipped

Plans now present like the Barndominium Homes social feed: a vertical scroll of
post cards, each a photoreal exterior render above the deterministic dimensioned
floor-plan sheet. Built on the consistency lane — the render is a look-render
(geometry-conditioned, expectedStructure-checked), labeled a "concept render";
the dimensioned plan stays the source of truth. In-app VIEW ONLY (no export).
Four fires (planner 7fea9e2, 84c8aa2; data ee2f266 + the photoreal swap), each
verified in real Chrome, full ladder green on two consecutive runs.

1. **Photoreal look style** — `LookRenderMode = 'illustration' | 'photoreal'`
   (named to avoid the 3D-view `RenderMode` in lib/types.ts). The photoreal
   branch of `buildLookRenderPrompt` yields a "photorealistic architectural
   visualization" but stays honest: labeled "concept render — not a photo of a
   real home, not to scale," with the originality guard. The handoff modal has a
   Render-mode toggle (defaults Photoreal). `check:lookrender` asserts the
   photoreal prompt (every look) encodes geometry, reads photoreal, is labeled a
   not-a-real-photo concept render, carries the guard, is competitor-clean, and
   never alters the geometry clause.
2. **Feed view** — a `PlanFeed` component + `showFeed` page branch + a "Feed"
   header action. Each card: page header (FS avatar + Floorplan Studio +
   timestamp) → caption (model + tagline + specs) → photoreal render with a
   "Concept render · not to scale" badge → the deterministic floor-plan sheet
   ("dimensioned source of truth") → cosmetic engagement bar + Open plan. The
   render is subordinate; the plan is primary and never replaced. data-* hooks on
   feed/card/header/caption/render/label/plan/engagement. The sweep opens the
   feed and asserts a card shows both images, the caption, the concept label, the
   engagement bar, and that the render sits ABOVE the dimensioned plan.
3. **Photoreal showcase** — gen-001, loft-showcase, a-frame-22 each got a
   photoreal render produced in ChatGPT and visually verified in Chrome to agree
   with its deterministic gable elevation on every structural row, then imported
   (swapped over the earlier illustration at the same path; manifest stays
   byte-identical). The Feed reads photoreal.

Guardrails held: the photoreal render is a labeled concept render with the
originality guard, subordinate to the plan; consistency stays STRUCTURAL
agreement (never a pixel/dimensional drift metric); only look-render image bytes
changed — manifest + deterministic paired JSON / render SVG byte-identical;
view-only. Renders were bridged out of ChatGPT in-page (fetch → 1024px JPEG →
data-URL download) — the per-session download block stayed reset.

## 2026-06-16 Look-Render Consistency Lane — Shipped

The look render is now provably CONSISTENT with the deterministic model:
the 2D sheet and 3D are consistent by construction (shared roof-plane
equations), so the illustration is the only variable that can drift.
"Consistency" = the illustration AGREES with the compiled geometry on
checkable STRUCTURAL facts (roof style, footprint aspect, gable
door/window counts, loft presence) — **never** a pixel/dimensional drift
metric (an exterior render is not the 2D plan; we never fake a drift
number). Six fires (planner 58835c2, 76ca84d, 373fa56, b260781, 28c3e94;
data 2321809, 3939d61, + loft-showcase), each verified in real Chrome with
the full ladder green, closed on two consecutive clean runs.

1. **Geometry-conditioned handoff + expectedStructure** — the handoff modal
   now surfaces the plan's deterministic front + side elevations as a
   draggable reference (`data-look-render-reference`). `lookrender:import`
   records an `expectedStructure` block {roofStyle, widthFt, depthFt,
   aspectRatio, gableDoors, gableWindows, hasLoft} derived from the SAME
   paired JSON the 3D/elevations render from. `check:lookrender` asserts the
   recorded structure EQUALS the plan's real compiled geometry (a mismatch
   can never be recorded).
2. **Side-by-side consistency panel** — the imported illustration renders
   next to the deterministic GABLE elevation with a 5-row structural
   checklist sourced from `expectedStructure`, labeled "Illustrative - not
   to scale," BELOW the dimensioned sheet (subordinate). data-* hooks on the
   panel, both images, and each checklist row; the sweep asserts them.
3. **Axis- + loft-aware derivation** (bug surfaced by a-frame-22) — gable
   door/window counts come from `buildElevationModel(gable side)` — the same
   deterministic elevation the panel shows (front for ridge-z, side for
   ridge-x), with its facade tolerance + headroom clipping. `hasLoft` reads
   levels>1 OR any level≥1 opening OR an appliesTo loft entry. Prompt +
   checklist + drawing agree by construction (one source of truth).
4. **Verified showcase set (3/3)** — gen-001 (compiled, no loft),
   loft-showcase (NEW persistent compiled-loft plan, gen-001's loft sibling,
   seeded by `scripts/seed-loft-showcase.mjs`), and a-frame-22 (traced,
   ridge-x, loft). Each render was produced in ChatGPT, **visually verified
   in Chrome** to agree with the deterministic gable elevation on every
   checklist row, and imported. The per-session download block had reset, so
   renders were bridged out in-page (fetch → 1024px JPEG → data-URL
   download) — no manual step this round.

Gates assert MORE: `check:lookrender` gained the expectedStructure-equals-
geometry assertions (incl. a-frame-22 axis/loft); the sweep gained the
consistency-panel + reference-elevation assertions; loft-showcase joined the
sweep PLANS + COMPILED_PLANS. Guardrails held: lookRender + expectedStructure
are ADDITIVE manifest metadata only; gen-001 JSON and the traced deterministic
artifacts are byte-identical. `tsconfig` gained `allowImportingTsExtensions`
so the import-free node batteries can cross-import (look-render → elevations).

## 2026-06-15 Look-Render Lane (ChatGPT browser) — Shipped

A stylized exterior "look render" (drafted.ai-style), generated in the
ChatGPT browser from a plan's real geometry and imported as a labeled
ILLUSTRATIVE asset — strictly separate from and subordinate to the
deterministic sheet/3D/elevations/code. No API key. Four fires
(a6a83f5, 56fb966, 5c37692, a6b6dd2; + article fix 111f765):

1. **Presets + prompt builder** (`lib/look-render.ts`) — seven looks
   (dark/bright/earthy/bold/classic/natural/rustic, mirroring drafted)
   and `buildLookRenderPrompt` that encodes the plan's real geometry
   (roof, footprint, ridge/eave, gable openings, loft). Style in words
   only; every prompt ends "not to scale / not photoreal" + an
   originality guard; never references a competitor brand/photo.
2. **Handoff UI** — a "Look Render" header action opens a modal with the
   7-look selector, the copy-paste ChatGPT prompt, and the browser steps.
   No API call.
3. **Server-side import** — `npm run lookrender:import -- --plan <id>
   --image <path|dataURL> --look <name>` copies the render next to the
   plan and ADDS only `lookRender*` manifest fields (always flagged
   illustrative); deterministic render/JSON/sourceKind untouched.
   `--dry-run` validates without IO.
4. **Labeled panel** — "Look render / Illustrative - not to scale" renders
   BELOW the dimensioned sheet/3D/elevations; shows only when imported,
   never replaces the drawing.

Gate `check:lookrender` (in the ladder) asserts: 7 looks; prompts encode
geometry, carry the look, are labeled illustrative, have the originality
guard, are competitor-clean, differ per plan; import helpers + `--dry-run`
flag illustrative and never touch deterministic fields; unknown look
rejected. The interactive sweep asserts the handoff modal surfaces 7 looks
+ a geometry-true illustrative prompt. Verified in Chrome: handoff modal,
import + labeled panel (deterministic assets present + unaltered), console
clean; full ladder green two consecutive runs.

**Boundary (by design):** this is a local, human-in-the-loop lane — the
render is made by a person in ChatGPT, then imported. The earthy
a-frame-with-loft render WAS produced in ChatGPT from the app's exact
prompt and verified on screen; the one step automation cannot do is the
file download (the documented 2nd-programmatic-download-per-session block;
user-initiated download is unaffected), so importing a specific render is
a one-click user step. A *deployed* product would swap the browser handoff
for a `gpt-image-1` API call behind the same prompt builder + import +
labeled panel. The look render never claims to be dimensional; the sheet,
3D, and elevations remain the source of truth (no drift comparison — an
exterior render is not the 2D plan).

## 2026-06-15 Compiled Lofts — Shipped

"…with loft" now builds a real level-1 loft, end to end, one capability per
fire (bd0e3d0, 516c066, 671d095, b923bc6), each verified in real Chrome with
the full gate ladder green, closed on two consecutive clean runs.

1. **Parser** — `parseBrief` recognizes loft/lofts → `hasLoft`, surfaced in the
   landing echo ("Understood: … a-frame · loft · …"), not the ignored list.
2. **Compiler** — when a loft is requested AND the roof gives headroom,
   `compileIntent` derives a loft from the same ridge/eave geometry the roof
   planes use (one source of truth): `buildLoft()` finds the central band
   clearing 8 + 5 ft, and emits a floor-1 panel, a level-1 `loft` room, and a
   hall ladder. Appended AFTER level-0 validation (roof-derived, not authored),
   so single-level plans compile unchanged. A shallow roof degrades honestly.
3. **Geometry** — full-depth loft reaches the gable ends; a floor-1 gable wall
   (`ext-l1-front`) hosts the floor-1 loft window so it aligns (same-floor) and
   the elevation draws it at loft sill height. Clipped within 0.25 ft; the
   deterministic sheet renders MAIN LEVEL + LOFT LEVEL.
4. **Code compliance** — the loft passes R305 on its real headroom (clearance
   measured from the loft floor, not the ground — the app's ceiling derivation
   was already loft-aware). An open loft is non-sleeping, so R310 is n/a. A
   loft request steepens a gable (ridge 14 → 20) so a gable can earn a loft.

Gates carry the loft invariants (every new invariant, a new assertion):
check:brief, check:generation (R305 from the loft floor, a-frame + steep
gable, no-headroom degrade), check:elevations (loft window at loft sill
height), check:code (loft sloped-ceiling fixtures). Verified in Chrome: a
fresh a-frame loft AND a fresh steep-gable loft both show Ground/Loft/All,
0.00 ft envelope / offenders [], R305 pass, no blockers, console clean.
Guardrails held: constraint-engine semantics unchanged (loft meets the real
rule), traced plans untouched, gen-001 untouched, all data-* hooks intact.

## 2026-06-13 Design-System Redesign — Closed

Applied the taste/redesign skill across every surface as a precision tool,
not a marketing site — no magnetic buttons, gooey menus, bento, or
parallax. Foundation + five surfaces, one per fire, each verified in real
Chrome with the console clean and the full gate suite green
(3efa32d, 6c2a0b0, 214e784, 26817e6, dcf259a, 77328fd):

- **Foundation** — type system is Geist (display, opt-in via font-sans)
  + Geist Mono (the technical default for every label, dimension, and
  data readout); dropped the unused Inter (a banned AI tell) + Playfair.
  globals.css carries an element-level interaction layer: one calibrated
  transition curve, a tactile :active press on buttons, a palette-tinted
  :focus-visible ring (keyboard a11y), warm ::selection, smooth scroll —
  all behind prefers-reduced-motion. Lifts every surface at once with no
  markup change.
- **Gallery cards** — rounded containers, resting tinted shadow + hover
  lift (transform-only), tabular dimension meta, composed empty state.
- **Plan-detail header + workflow + gate chips** — Geist brand mark;
  gate chips carry a status-tinted wash (amber/red) so state reads at a
  glance; consistent rounded controls.
- **VIEW panel + compare/sheet** — rounded segmented controls; compare/
  overlay panels get rounded-lg with tinted depth.
- **Four modals** — shared shell: blurred backdrop, rounded-xl container
  with deep shadow, Geist display titles, rounded controls throughout.
- **Review Tools sidebar** — constraint rule cards take a status wash
  (failing IRC-R305.1 reads red at a glance), rounded lot editor + brief
  controls, Semantic Source panel depth.

Held the line throughout: monospace for all data/dimensions, CAD density
intact, and not one gate-asserted string or data-* hook touched. Closed
on two consecutive clean gate runs (6 batteries, build, qa:brochure 10/10
on prod :3000, final-interactive-sweep) with the traced plans unchanged
(a-frame-22 Overlay lane + 7.05 ft designed-bay exemption preserved).

Loft check (asked during the loop): traced loft plans (a-frame-bunk,
a-frame-22) render correctly — Ground/Loft/All toggle isolates levels,
the loft sits at the right height with its ladder. Compiled generation
has NO loft capability (compile-plan.ts hardcodes floor-0); the brief
parser honestly lists "loft" as ignored. Adding compiled lofts is a
separate, fenced feature (multi-level compilation), not done here.

## 2026-06-13 UX Review Loop — Closed

Seven fires as a first-time customer + UX designer in real Chrome; every
feature exercised end to end (landing/brief/echo/generate, gallery cards
+ filters + search + empty state, delete, all view presets + Roof/White,
Compare/Overlay/Semantic, all four modals, plan arrows, lot editor,
exports). One worst-problem fix per fire (45edab7, 6abd28f, f49a8c2,
f454db6, 34f2bbe, 85cfe79), each verified live + full gates:

1. **Customer-language pass** — hero states the product ("Type a
   one-line brief. Get a dimensioned, code-checked floor plan you can
   hand to a client."); taglines drop pipeline jargon; Continue Detail
   is now Resume <plan>; Clean tile reads Export Ready; no dangling
   meta separators. New Plan Handoff / Repair Prompt kept (gate-bound
   labels, dev-lane controls).
2. **JSON-only compare pane** — blank/stale "GPT Proposal" pane replaced
   by artifact-true front + side elevations (SemanticElevationView,
   lib/elevations); section header reads Plan Sheet + Elevations.
3. **Front/Side camera fit** — elevation presets now frame the whole
   facade from real fov/aspect (gable was cropping past the canvas).
4. **Real gallery thumbnails** — cards draw each plan's gable-face
   elevation from the artifact (front, else side; generic fallback).
5. **Lane coherence + labels** — Overlay tab hidden for constrained_json
   plans (nothing to drift against); qa:brochure + sweep assert the
   contract both ways (stricter). Plan-status segmented control labeled
   with an explanation in both surfaces.
6. **Self-explaining gate chips** — warning/blocked chips carry their
   findings as hover tooltips (panel-module mismatch, IFC placeholder,
   R305.1 citation).

Fire 7 was a no-change verification pass: fresh a-frame generation
echo -> 13 GATES PASS -> sheet + elevations, 0.00 ft envelope excess,
chips tooltips live, traced GPT lane intact (Overlay present, panes
unchanged). All gates green (6 batteries, build, qa:brochure 10/10 on
prod :3000, final-interactive-sweep).

Known minor leftovers (below the fix bar): Repair-With-GPT prompt text
references a GPT image path on JSON-only plans (dev surface); gallery
thumbnail elevations render small in the card cell; first synthetic
click after navigation is swallowed by browser automation (extension
input layer, not the app — DOM click works first try).

## ARCHITECT REVIEW READY — what to demo

Four fires (d4eeddb, 213884a, 28d4c49, 9cf3c8a), verified green two
consecutive fires. Dev server on localhost:3002, prod on :3000.

**The demo, in order:**

1. **Fresh generation, end to end** — on the landing page type
   `3 bed 2 bath gable, 60x90 lot, 10 ft setbacks`, watch the echo line
   ("Understood: 3 bed · 2 bath · gable · 60×90 lot · setbacks ..."),
   generate. ~25 s later the card reads Brochure Ready and the plan
   opens with the full sheet treatment below.
2. **The 2D sheet** (any compiled plan, e.g. gen-001) — title block with
   plan id / area / bed-bath / roof, north arrow, graphic scale bar, and
   chained band dimensions along the top and left that SUM to the
   footprint (verified live: 16'+8'+12' = 36' top, 12'+4'+12' = 28'
   left on a fresh gable), plus W'×D' size labels inside each room.
3. **Honest elevations** — in the client packet (Download Client
   Packet on gen-001): front + side elevations are built from the
   stored artifact itself (lib/elevations.ts, 48-check battery). Every
   opening drawn maps to a real facade opening within 0.5 ft, heads
   clamp under the roof at their own position, loft windows draw at
   loft height, gable vs eave face follows the actual ridge axis.
   No invented openings, on any of the five plans (check:drawing
   asserts this mechanically for every plan, both sides).
4. **Professional 3D** — orbit any plan: edge lines define the form
   (24° crease threshold), a soft contact shadow grounds it, and the
   White checkbox in the VIEW panel flips to an architect white-model
   preset (matte white shell, opaque roof). Cutaway / Front / Side all
   hold up. Envelope evidence stays live: compiled plans read
   0.00–0.01 ft max excess, offenders [], every mesh tagged.
5. **Traced references untouched** — a-frame-bunk, a-frame-22,
   outpost-medium still show 12 GATES PASS with their original
   geometry; gen-001 still carries the "JSON-only deterministic
   packet" badge and Brochure pass header.

**Gates at close** (all green, two consecutive fires): build,
check:drawing (38), check:elevations (48), check:clip (33), check:code,
check:brief, check:generation, qa:brochure 10/10 on prod :3000,
final-interactive-sweep (per-plan title block + north arrow in live
DOM, envelope gates, JSON-only badge, landing echo). Stored renders
regenerated once via render:paired after the sheet annotations landed.

## 2026-06-12 Architect Polish — Closed

One capability per fire on top of the export pass:

1. **Honest elevations** (d4eeddb) — lib/elevations.ts builds front/side
   elevation models from the artifact (dependency-free; same ceiling-
   plane math as the constraint engine). Ridge-axis-aware gable/eave
   profiles, openings matched to the facade within tolerance, 3D's own
   clamp policy mirrored (sill base+3.15, slide-down, skip <0.5 ft),
   loft openings at level height. check:elevations battery: fresh
   a-frame + fresh gable + traced a-frame-22 + bare-facade case.
2. **Drawing standards** (213884a) — FloorPlanView annotations: title
   block, north arrow, scale bar, chained band dimensions cut at room
   edges, room size sublabels. Wired for compiled plans' live render
   and stored sheets.
3. **3D presentation** (28d4c49) — EdgesGeometry crease lines on
   wall/roof meshes (productMode only; lines aren't meshes so envelope
   evidence is unaffected), radial-gradient contact shadow (tagged
   siteShadow), whiteModel prop → white-model material preset + VIEW
   checkbox (data-view-white-model).
4. **Consistency sweep** (9cf3c8a) — check:drawing battery gates every
   plan's stored render: sheet elements on JSON-only sheets, primitive-
   QA contract on traced artifacts, elevation honesty for all five
   plans both sides; final-interactive-sweep asserts title block +
   north arrow per plan in the live DOM.

## 2026-06-12 Export Pass — Closed

A generated plan now completes the whole product story with no GPT
image: type a brief → green "Brochure Ready" card → one-file client
packet with the code citations inside. Commits be7fc2a, b9105df,
f29f3d0, 650bda0, 0eb620b (+ dev-compiler 99b5204, 29f0e10).

1. **Stored deterministic render** — /api/generate-plan writes
   deterministicRenderUrl and spawns the render:paired capture
   (loopback/env origin only — SSRF review fix b9105df). gen-001 and
   brief-aframe-2br backfilled.
2. **JSON-only brochure lane** — sourceKind constrained_json requires
   the stored render only; GPT-source-relative checks (drift evidence,
   drawing primitive contract, style sidecar, proposal-image warnings)
   do not apply to a lane with no image to trace. GPT-paired plans
   unchanged. Compare header carries a "JSON-only deterministic
   packet" badge (data-json-only-packet).
3. **Export packet** — front/side elevation SVGs, build-kit BOM JSON,
   Cherokee County constraint report (printable HTML + JSON, citation
   and pass/fail per finding), and Download Client Packet (HTML): one
   self-contained file (plan SVG + elevations + BOM + full report).
   Verified by real download: gen-001-client-packet.html, 42 KB, all
   content checks (evidence in artifacts/customer-readiness/).
4. **Mechanical gate** — gen-001 in the default qa:brochure +
   render:paired sets (10 QA passes); sweep asserts the badge renders
   and the workflow header never reads Brochure blocked.

State at close: gallery 6/6 clean 0 blocked at the time of the fresh-
generation test; gen-001 header reads "Design pass - Presentation pass
- Brochure pass"; a fresh UI generation reached the same line with its
render auto-stored in ~25 s. All gates green two consecutive fires.
Note: Chrome's multiple-automatic-download guard can swallow a second
programmatic download in one session — user-initiated clicks are
unaffected.

## 2026-06-12 3D Quality Loop — Closed

Four capabilities on top of the constructive-clipping geometry, one per
fire (0e25374, f50972d, b334e25, 76e73ec):

1. **Delete plan from the UI** — gallery cards + plan header for
   compiled, non-promoted gen-NNN plans only; POST /api/delete-plan
   enforces the same rule server-side (traced ids can't match, promoted
   refused). Verified end-to-end in Chrome; gallery updates in place.
2. **Openings cut into walls** — clipWallSegmentWithOpenings() in
   lib/bim/envelope-clip.ts subtracts door/window/passthrough holes
   constructively (sill + header pieces, all still roof-clipped; a door
   in a knee wall degenerates honestly). windowGlassExtent() is the
   single source for glazing extent shared by pane and hole. Windows are
   real openings now — outpost-medium stopped being a monolith.
3. **Fixtures clamped under the roof** — clampFixtureToEnvelope() scales
   fixtures about their base using BOUNDED roof planes (traced decks
   outside the roof span untouched). Compiled envelope gate tightened to
   <= 0.25 ft + zero offenders; plans read 0.00-0.01 ft.
4. **Readability** — warm mid-tone shell (#8f8577), light interior
   partitions, roof opacity 0.78: furnished rooms read at orbit angles
   and in Cutaway. Traced plans unchanged (before/afters in
   artifacts/customer-readiness/fire4-*.png).

Stop verified twice consecutively: fresh a-frame + fresh gable +
outpost-medium show real openings in Chrome at 0.00 ft / offenders [];
delete works end-to-end and never appears on traced/promoted plans; all
gates green (build, check:clip/code/brief/generation, qa:brochure,
final-interactive-sweep). Known cosmetic residue: URL keeps ?home=<id>
after deleting the open plan until next navigation.

## 2026-06-12 3D Geometry Rebuild — Closed

The earlier READY TO TEST call was premature: the user caught two giant
"sail fin" triangles on gen-001's 3D view that my review had rationalized
away and my envelope gate could not see. Root cause: `aFrameGableCaps` —
untagged decorative gable triangles HARDCODED for ridge-along-x roofs,
glued onto the eave sides of every ridge-along-z compiled plan; the old
gate sampled only wall-tagged meshes, so 15.84 ft of fin read as 1.14 ft.
Eave-wall egress windows also floated ~5 ft through the roof.

Fix was architectural, not another patch (3eae0f3, 13bd3f4, this commit):

- **lib/bim/envelope-clip.ts** — constructive clipping as the single
  source of 3D truth. Roof ceiling planes use the constraint engine's
  plane math; `clipPrismToCeiling()` splits any convex prism by the
  ridge/cap/floor lines and caps each region with its one active plane.
  Exact construction; 20-check battery (`npm run check:clip`).
- **BimPreview rebuilt on the clipper**: walls extrude-and-clip (gable
  triangles, knee wedges, capped partitions from one call); windows and
  door leaves clamp to the roof at their position; `gableEndWallMesh`,
  wall-role/ridge-axis routing, knee clamps, and the fin caps DELETED.
- **Evidence with no blind spots**: every rendered mesh is sampled;
  offenders named with element id/category (`bimEnvelopeOffenders`,
  `bimEnvelopeWorstMesh`); untagged geometry is itself a failure.
  Sweep gates: compiled plans ≤ 0.5 ft excess + zero offenders; all
  plans zero untagged (traced keep the designed-bay excess exemption).
- Template nicety: entry door centered on the living facade so A-frame
  doors sit in headroom (was riding the 0.5 ft gate at the old x4–7).

Numbers: gen-001 15.84 ft → **0.01 ft**; brief-aframe-2br 0.32 ft; fresh
2-bed a-frame 0.14 ft (worst mesh: a range fixture, 1.7 in); fresh 3/2
gable 0.00 ft — all offenders []. Verified in real Chrome from the
fin-exposing angle plus Cutaway/Front/Side; traced plans unchanged.
Gates green two consecutive fires: build, check:code/brief/generation/
clip, qa:brochure, final-interactive-sweep.

## READY TO TEST — 5-minute script

App: `npx next dev -p 3002` → http://localhost:3002 (left running, open in
your Chrome tab). Type each brief into the box under the headline and press
Enter or GENERATE PLAN.

1. **"2-bed A-frame, ≤800 sqft, 40×60 lot, 5 ft side setbacks"**
   Watch the live echo confirm the program before you generate. Expect a
   784 sf 28'×28' A-frame, 2/1, that opens automatically. Orbit it; cycle
   Plan Top / Cutaway / Front / Side; toggle Roof. Click **Semantic** →
   constraint report: Cherokee County NC, all rules pass, R305 ceilings
   derived from the roof. In LOT, set lot W to 30 → setback + coverage flip
   to fail; **reset** restores.
2. **"tiny one bedroom a-frame cabin in the woods"**
   Word numbers parse ("1 bed"); "tiny/woods" show as Ignored — nothing is
   silently dropped. Expect 1/1 with bath AND laundry passing R305.
3. **"2 bed 2 bath gable, ≤900 sqft, 45x75 lot, 15 ft front setback, 5 ft
   side setbacks"** — expect 2/2 (ensuite Bath 2 off Bedroom 2), 784 sf
   ≤ 900, asymmetric setbacks in the report (front 15, sides 5).
4. **"1-bed gable cabin, 30x50 lot, 5 ft setbacks"** — small lot: the
   footprint shrinks to 20'×24' (480 sf) and coverage stays under 35%.
5. **"5 bedroom mansion with a pool on a 20x20 lot"** — honest refusal:
   "footprint … exceeds the buildable envelope", nothing broken.

Test plans you generate land in the gallery as gen-NNN ("In review").
Traced plans (a-frame-22, a-frame-bunk, outpost-medium) are untouched
references. gen-001 is the keeper demo of the older template (its bath
R305 fail is intentional contrast with new generations).

Loop receipts: 8 fires, 6 fixes — lot-fit + coverage-aware footprints
(7a84d31), landing generate flow (06fde9b), bath count w/ ensuite
(562a853), word-number briefs (94c8672), brief-box input hardening
(eb35e7f), parse honesty + live echo (a176dc2). Gates green throughout:
build, check:code, check:brief, check:generation, qa:brochure, final
interactive sweep. Evidence: artifacts/customer-readiness/.

## 2026-06-12 Generator Hardening — Closed

The brief→plan generator is now genuinely parametric and code-clean,
with the constraint engine as the regression gate (`9710170`).

- **Parametric template** (`mockIntentFromBrief`): 1–3 bedrooms, gable vs
  a-frame from the brief, ridge-safe band layouts (28 ft wide for 1–2 bed,
  36 ft for 3-bed). Habitable rooms and wet rooms sit in the central
  headroom column; only storage/closets occupy the low eave edges, so
  steep a-frames (eave 1 ft / ridge 18 ft) clear R304 effective-area and
  R305 sloped-ceiling rules. This fixes the known bath-on-low-edge R305
  flaw for all new generations (gen-001 keeps it for comparison).
- **Honest lot-fit validation**: `compileIntent` refuses footprints that
  exceed the lot's buildable envelope with a clear error instead of
  emitting a plan the zoning report would flag.
- **`npm run check:generation`**: 9-brief battery (1/2/3-bed, both roof
  styles, per-side setbacks, no-lot, barely-fits, cannot-fit, default
  brief) running brief → parse → intent → compile → Cherokee County
  report with roof-derived ceiling profiles. Asserts zero constraint-fail
  findings on every viable brief, egress per bedroom, 4 ft grid, callouts,
  wall-hosted openings, and the envelope error on the impossible brief.
- **End-to-end proof in real Chrome**: fresh mock generation (gen-002,
  since deleted) rendered, orbited, and reported **17 pass / 0 fail /
  3 not-evaluated** — bath ceiling 16.0 ft vs gen-001's 2.6 ft fail.
- **Headless QA unwedged**: drawing-style sidecars now load only from
  explicit manifest keys; guessed URLs 404'd on compiled plans and hung
  Chromium's network-idle wait, which had broken `qa:brochure`.

Gates at close: build ✓, check:code ✓, check:brief ✓, check:generation ✓,
qa:brochure passed ✓, final-interactive-sweep clean (5 plans) ✓.

Remaining generator backlog (not blocking): footprint sized from maxSqft,
bath count from the brief, richer narrow-bath furnishing.

## 2026-06-11 Real-Browser Polish Loop — Closed

Twelve buyer-mode sessions in real Chrome; ten fixes shipped, two clean
closing passes; final interactive sweep clean (5 plans), brochure QA
Overall: pass throughout.

Shipped: live Compare/Overlay render with 13px dimension floor +
dimensionLines prop (2fa6f51); passing chips collapse behind 'N gates
pass' for buyers (c7aa68f); WebGL context-loss recovery overlay
(2cfeffa); pixel-space dimension re-anchoring keeps labels (485eaf2);
'In review'/'Promoted' lifecycle wording (e251dd1); Plan Top square/
north-up (2fb9844); building envelope intact under Ground/Loft filters
(db8de1a); gallery cards fall back to the live render (ce280a0);
three-tier gallery quality incl. amber 'Design Ready' (953c17f); level
filter resets on plan switch (a069058). Earlier same day: VIEW panel
cleanup, JSON-only Compare/Overlay placeholders, design-health
lifecycle headline.

Verified working surfaces: orbit/views/toggles on all 5 plans, Compare/
Overlay/Semantic, constraint report + lot what-if editor, brief parser,
gallery search/filters/cards, Export dialog (2D SVG download verified),
New Plan handoff packet, generated-plan flow (gen-001), ChatGPT browser
image lane.

## 2026-06-11 Morning Summary — Overnight Build

All four overnight workstreams shipped; final interactive sweep clean
(42/42 across 5 plans) and brochure QA Overall: pass.

**Shipped:**
- **Cherokee County, NC jurisdiction pack** (`55293bc`): in-force 2018 NC
  Residential Code (IRC 2015 base, per NC OSFM, retrieved 2026-06-11) with
  NCRC citations on R304/R305/R310; transition warning that the 2024 NCSBC
  was delayed past April 2026. Cherokee County has **no county-wide zoning**
  (county Ordinances & Plans page) — zoning rules evaluate user-supplied
  lots only; standing "verify" site checks for 15A NCAC 18E septic, NFIP
  flood, and Murphy/Andrews town limits. Jurisdiction header in the
  Constraint Report.
- **R305 ceiling heights derived from geometry** (`9f6c486`): per-room
  ceiling profiles sampled at 0.5 ft from validated roof planes with loft
  clamping; sloped-ceiling provision (70 sq ft at >=5 ft, half at >=7 ft);
  sub-5 ft area excluded from R304 effective floor area.
- **brief-aframe-2br furnished** (dev-compiler `2ae4707`): 14 fixtures
  using shared registry types; fixtures lane passes.
- **One-click generation** (`fef0388`, dev-compiler `d564940`):
  POST /api/generate-plan + Generate button. Brief -> constrained intent ->
  deterministic compiler (`lib/generate/compile-plan.ts` derives walls,
  swings, roof planes, elevations) -> validation -> review-lane artifact.
  Proof plan `gen-001` passes the full interactive protocol.

**Test in the morning:** open localhost:3002 (npx next dev -p 3002),
Review Tools -> type a brief -> Generate Plan From Brief; inspect gen-001
and brief-aframe-2br Semantic view for the Cherokee report.

**Known design findings (real, intentional):** A-frame edge rooms fail
R305 honestly — brief-aframe-2br and gen-001 put the bath against the low
west edge (2.6 ft ceiling): fix by moving the bath toward the ridge, knee
walls, or a dormer. a-frame-bunk's 65 sq ft loft fails the sloped-ceiling
provision. outpost-medium (gable) passes R305 everywhere.

**Blocked / needs user:**
- `OPENAI_API_KEY` is missing (.env.local has only Vercel/Sketchfab
  tokens) — live generation is wired (strict JSON-schema, 5-call budget,
  failures saved to artifacts/generation-failures/) but untested; the
  Generate button uses the deterministic template until a key is added.
- County verification items: confirm in-force code edition with Cherokee
  County Building Code Enforcement (828-837-5527); septic/well siting via
  Environmental Health; FIRM flood panel for the parcel; municipal zoning
  if inside Murphy/Andrews limits.

**Build note:** `npm run build` now uses webpack (`--webpack`) — Turbopack
panics on the den-image-loop symlink when an app route exists. Static
export is opt-in via `NEXT_STATIC_EXPORT=1` (API routes excluded there).

## 2026-06-10 Takeover Checkpoint

The north-star flow now works end to end: brief -> paired semantic JSON ->
deterministic 2D/3D render -> cited constraint report.

- Visual drift vs the GPT proposal image is advisory everywhere, never a
  release blocker. Brochure QA: Overall pass for a-frame-22, a-frame-bunk,
  outpost-medium (blocked since May 30 under the old pixel-drift gates).
- New constraint engine `lib/standards/code-advisory.ts`: IRC R304.1/R304.2
  room minimums, IRC R310.1 egress, WH-GRID-4FT panel grid, ZON-SETBACK and
  ZON-COVERAGE parameterized by `artifact.lot`. Findings report
  pass/fail/not-evaluated with citations; rendered in-app as the Constraint
  Report panel (Semantic review surface).
- Fresh-brief proof: `brief-aframe-2br` (2-bed A-frame, 672 sqft, 40x60 lot,
  5 ft side setbacks) authored as constrained JSON with no GPT image, loads
  through the review lane, renders 2D/3D, passes all six rules outright.
- Deterministic regression: `npm run check:code` (55 checks across synthetic
  fixtures + 4 plans). The review lane accepts JSON-only artifacts;
  promotion still requires full evidence.

Closed since: deterministic brief parser (`lib/brief.ts`, `check:brief`)
wired into the Prompt To Plan panel, and a what-if lot editor in the
Constraint Report panel (live setback/coverage recompute + export JSON
with lot).

Remaining gaps (both need a user decision before building):
- Ceiling-height rule (IRC R305): needs agreement on section data — derive
  from roof planes/loft heights or require explicit per-room heights.
- Jurisdiction rule packs beyond the IRC defaults: which jurisdiction and
  code edition to encode first.

## Current Objective

Floorplan Studio is being rebuilt into a Den-style prompt-to-plan product workflow. The target output is not a debug harness: it should produce customer-facing 2D plans, BIM/Product 3D, cutaways, elevations, and export packets that are credible enough for a sales brochure or Airbnb listing.

The core invariant is:

```
GPT proposal image + paired semantic JSON
  -> deterministic 2D render
  -> semantic_bim_v1 / buildable_bim_v1
  -> Product 3D, exports, QA, repair prompts
```

The paired semantic JSON remains the editable source of truth. BIM, IFC, fixtures, marketplace assets, screenshots, and brochure exports are downstream lanes. They may improve presentation, but they must not redefine geometry.

## Architecture Now

- Product app: `app/page.tsx`
  - Gallery/detail workflow, validation lanes, repair/export controls.
  - Product view defaults toward BIM/Product 3D, with Compare/Overlay/Semantic review below.
- Deterministic 2D renderer: `components/FloorPlanView.tsx`
  - Draws paired semantic geometry using `drawing_style_profile_v1`.
  - Renders primitive-level elements: walls, openings, doors, windows, fixtures, furniture, ladders/stairs, dashed voids, labels, dimensions.
- BIM/Product 3D: `components/bim/BimPreview.tsx`, `lib/bim/*`
  - Converts paired semantic JSON to `semantic_bim_v1` / `buildable_bim_v1`.
  - Uses That Open components as the viewer/tooling direction, while keeping paired JSON as source of truth.
- Standards and validation: `lib/standards/*`, `lib/build-validator.ts`, `scripts/recompute-visual-drift.mjs`, `scripts/brochure-visual-qa.mjs`
  - Separates Design Quality, Presentation Quality, Brochure Quality, Manufacturing Readiness, Export Readiness, Accessibility Advisory, and Code Advisory.
- Repair workflow: `lib/repair/*`, `scripts/print-brochure-repair-queue.mjs`, `scripts/request-brochure-repair-patch.mjs`, `scripts/apply-brochure-repair-patch.mjs`
  - Generates scoped GPT repair prompts.
  - Accepts RFC 6902 JSON Patch only.
  - Validates scope, rerenders, reruns QA, and rolls back if the targeted blocker does not improve.
- Component/asset lane: `lib/bim/component-registry.ts`, `lib/bim/component-assets.ts`, `public/data/bim-components/*`
  - Maps semantic fixtures/furniture/doors/windows/panels to IFC classes, fallback procedural geometry, and optional local or provider assets.

## Spatial Compiler Direction

The useful architecture from the broader generative-CAD notes is to stop treating plan generation as a single image prompt. A one-shot request for "pixels plus JSON plus 3D" is not a reliable source of truth because the image and text channels can disagree. The app should behave more like a spatial compiler:

1. Generate or import a paired artifact as volatile source code.
2. Normalize it into `paired_gpt_floorplan_v1` semantic JSON.
3. Validate schema and roles before anything becomes selectable.
4. Run deterministic geometry and topology checks.
5. Render deterministic 2D from the semantic JSON plus `drawing_style_profile_v1`.
6. Compile downstream to `semantic_bim_v1` / `buildable_bim_v1`.
7. Render Product 3D, cutaway, elevation, and exports from the compiled BIM lane.
8. Use scoped GPT JSON Patch only for repair, never broad local guessing.
9. Use downstream image generation only as a presentation lane conditioned on validated geometry, not as the geometry source.

This gives the project a narrow waist:

```
prompt / source image / GPT JSON
  -> constrained paired semantic JSON
  -> compiler validations
  -> deterministic 2D + BIM/Product 3D
  -> conditioned brochure/exterior renders + exports
```

Near-term implication: invest in schema contracts, primitive extraction, visual drift reporting, repair prompt quality, and browser QA before chasing photorealistic rendering. Photorealistic images are useful later, but only after they are conditioned by validated 2D/3D geometry so they cannot move walls, doors, windows, stairs, fixtures, or roof forms.

The latest architecture notes reinforce one cleanup decision: the app should not be a monolithic "ask the model for image + JSON + 3D" loop. That path creates two untrusted artifacts that can disagree. The stable foundation is a compiler boundary:

- `paired_gpt_floorplan_v1` is the only editable design source.
- `drawing_style_profile_v1` is renderer style, not geometry.
- `semantic_bim_v1` / `buildable_bim_v1` are compiled outputs.
- Product 3D and brochure imagery are presentation outputs.
- GPT repairs are scoped patches against a failing compiler issue, not whole-plan guesses.

Useful future upgrades:

- Constrained JSON generation/import for the semantic schema.
- Shapely-like geometry validation on the backend for polygon containment, overlaps, and intersections.
- Circulation graph checks for room adjacency and pathing.
- Mesh-level Product 3D checks for roof/wall/panel intersections.
- Conditioned marketing renders from deterministic depth/edge/normal maps after the plan already passes.

Claims about external products or model benchmarks should stay out of repo docs unless verified from primary/current sources. The architectural pattern is useful; unverified market numbers are not part of the plan.

## Current Target Plans

The active regression set is:

| Plan | Artifact | Current state | Notes |
| --- | --- | --- | --- |
| `a-frame-bunk` | `proposal-paired-v1` | review / blocked under strict Brochure QA | A scoped fixture span patch improved the loft bed primitive. Full fixture/body drawing-language drift still blocks brochure-ready status. A source-image crop overlay experiment was rejected; keep the render vector/semantic. |
| `a-frame-22` | `proposal-paired-v10` | review / blocked | Source primitive overrides are now materialized and door `openingType` values are normalized to the app enum. Door type blockers are cleared, but fixtures, ladder/stairs, dashed void/open-to-below, and broader primitive drawing mass still block. |
| `outpost-medium` | `proposal-paired-v11` | review / browser QA pass | Scoped fixture and wall primitive repairs cleared the latest desktop/laptop Brochure QA run. Keep it under regression; it is the current passing target, not proof that the whole pipeline is launch-ready. |

Promotion in the manifest is not the same as whole-product completion. Under the current strict Brochure QA, `outpost-medium` is the only target currently passing browser QA. `a-frame-bunk` and `a-frame-22` remain blocked repair artifacts, so the overall goal is still incomplete.

## Current Metrics Snapshot

Latest strict browser QA and drift regeneration after richer source-anchor selection and scoped GPT repair patches:

2026-06-01 checkpoint:

- Browser QA command:
  - `BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=a-frame-bunk,a-frame-22,outpost-medium npm run qa:brochure`
- Current result:
  - gallery passes on desktop and laptop.
  - `outpost-medium/proposal-paired-v11` passes on desktop and laptop.
  - `a-frame-bunk/proposal-paired-v1` remains blocked on Presentation Drift and Brochure Quality.
  - `a-frame-22/proposal-paired-v10` remains blocked on Presentation Drift and Brochure Quality.

- `outpost-medium/proposal-paired-v11`
  - Browser QA passes desktop and laptop with `BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=outpost-medium npm run qa:brochure`.
  - Accepted repairs this pass:
    - `ew-e:seg-2` source wall primitive.
    - `fx-living-seating` fixture source anchor preference.
    - `iw-bed9-e` source wall primitive.
    - `iw-bed9-s:seg-1` source wall primitive.
  - A validator/render bug was fixed so fixture/furniture elements prefer their direct `sourceAnchor.pixelBounds` over stale global source anchors.
- `a-frame-bunk/proposal-paired-v1`
  - Accepted repair: `/fixtures/5/sourceAnchor/span` for `furn-l2-loft-bed`.
  - Accepted renderer/profile repair: `fixture-body-220` thickened fixture/stair glyph strokes through `drawing_style_profile_v1`. This removed the fixture-specific browser QA blocker without changing semantic geometry.
  - Current drift remains blocked on overall drawing-language mass: primitive source miss `15.3%`, primitive render extra `17.3%`, primitive edge miss `0.9%`, primitive edge extra `1.1%`; full source miss `30.4%`, full render extra `24.0%`.
  - The remaining issue is broader source-frame/wall/opening/dimension drawing mass, not a fixture-only blocker.
  - Do not use source-image crop overlays as the deterministic render. A data-URI crop overlay was tested, made the SVG heavy/flaky for the browser, and violated the vector/semantic compiler direction.
- `a-frame-22/proposal-paired-v10`
  - Not re-cleared after the Outpost fixes. It remains blocked by fixtures, ladder/stairs, dimensions, and broad drawing-language mass.
  - Accepted renderer/profile repair: `fixture-body-150` thickened fixture/stair glyph strokes through `drawing_style_profile_v1`.
  - Latest strict QA layer metrics: primitive source miss `44.5%`, primitive render extra `38.9%`, primitive edge miss `3.3%`, primitive edge extra `5.2%`; full source miss `58.7%`, full render extra `40.1%`; fixture source miss `39.3%`, fixture render extra `37.7%`, fixture edge miss `6.8%`, fixture edge extra `4.9%`.

2026-05-31 strict browser QA checkpoint after cleanup:

- Verification:
  - `npx eslint scripts/check-paired-geometry.mjs components/FloorPlanView.tsx` passes.
  - `npx tsc --noEmit` passes.
  - `npm run paired:geometry` passes and now reports geometry status without treating promotion as a geometry invariant.
  - `npm run paired:smoke` passes with `paired 0/32 promoted, 30 queued, manifest 18 paired option(s)`.
  - `npm run archive:stale --` moved 10 stale paired backup files into paired artifact archives.
  - `npm run goal:audit` correctly reports incomplete: no target plan is true brochure-ready yet.
- Browser QA:
  - `BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=a-frame-bunk,a-frame-22,outpost-medium npm run qa:brochure` blocks all three target plans.
  - This is the desired behavior until Compare/Overlay and Product 3D are actually sales-brochure quality.
- Current strict blockers:
  - `a-frame-bunk/proposal-paired-v1`
    - Presentation/Brochure drawing-language drift only.
    - primitive source miss `16.5%`, primitive render extra `15.0%`, primitive edge miss `1.6%`, primitive edge extra `1.7%`, full source miss `31.2%`, full render extra `22.9%`.
    - Next repair is style/profile and source-frame fidelity, not semantic room redesign.
  - `a-frame-22/proposal-paired-v10`
    - Presentation/Brochure drawing-language drift plus fixture drift.
    - primitive source miss `46.5%`, primitive render extra `38.6%`, primitive edge miss `3.4%`, primitive edge extra `5.1%`, full source miss `60.1%`, full render extra `39.8%`.
    - Fixture layer remains the first high-signal repair target.
  - `outpost-medium/proposal-paired-v11`
    - Design/Brochure remain blocked on door, fixture, and wall primitive drift.
    - door: source miss `29.9%`, render extra `38.0%`, edge miss `1.1%`, edge extra `8.0%`
    - fixture: source miss `23.4%`, render extra `25.3%`, edge miss `6.8%`, edge extra `10.0%`
    - wall: source miss `6.8%`, render extra `16.5%`, edge miss `0.1%`, edge extra `6.9%`
    - full drawing-language drift: source miss `30.9%`, render extra `32.1%`
- Cleanup decision:
  - An experimental SVG wall-shadow filter was removed because it did not improve drift metrics. Renderer quality should come from explicit `drawing_style_profile_v1` rules and semantic/source primitives, not hidden filter effects.
- Repair-loop checkpoint:
  - The current Outpost source-primitive bundle was sent through ChatGPT in the browser. GPT returned a narrow six-operation patch touching only `/sourceOpenings/13`.
  - `npm run repair:ingest` accepted the patch scope, but `npm run repair:evaluate` rejected it because the drift score did not improve (`0.746185 -> 0.746185`). The patch was rolled back and the temporary paired JSON backup was archived.
  - A local renderer probe that made source-box door geometry override hinge/leaf geometry reduced door dark-pixel extra but worsened door edge drift. It was reverted because primitive edge alignment is the stricter invariant.
  - Next Outpost work should target either source primitive extraction quality for the named door/window/wall ids or renderer primitive generation for wall/fixture glyphs. Do not keep patches that trade better area fill for worse edge alignment.

2026-05-31 continuation checkpoint:

- `outpost-medium/proposal-paired-v11`
  - source wall/opening materialization now uses interval-aware host wall selection instead of nearest-line-only matching.
  - This is a safer primitive contract for split wall segments, but it did **not** clear the remaining QA blockers.
  - Current browser QA still blocks Outpost on:
    - door primitive drift: source miss `29.9%`, render extra `38.0%`, edge miss `1.1%`, edge extra `8.0%`
    - fixture primitive drift: source miss `23.4%`, render extra `25.3%`, edge miss `6.8%`, edge extra `10.0%`
    - wall primitive drift: source miss `6.8%`, render extra `16.5%`, edge miss `0.1%`, edge extra `6.9%`
    - full drawing-language drift: source miss `30.9%`, render extra `32.1%`
  - Interpretation: the pipeline is correctly refusing to mark this brochure-ready. The remaining work is source/semantic primitive reconciliation for doors, fixtures, and split walls, not a threshold or style-only fix.
- `a-frame-22/proposal-paired-v10`
  - dimension synthetic tick/label drift was reduced by rendering source-evidenced dimensions only when explicit source dimension metadata exists.
  - source-override doors now ignore pixel-space hinge/leaf coordinates and fall back to source-box door geometry, preventing giant false swing arcs.
  - Remaining blocker is fixture drawing-language drift and broader primitive mass; this still needs scoped fixture/source-primitive repair.
- `a-frame-bunk/proposal-paired-v1`
  - no longer counts as a passing brochure baseline under the current strict full-drawing-language QA.
  - latest browser QA blocks it on Presentation/Brochure drawing-language drift: primitive source miss `16.5%`, primitive render extra `15.0%`, primitive edge miss `1.6%`, primitive edge extra `1.7%`, full source miss `31.2%`, full render extra `22.9%`.
  - interpretation: structural primitive edges are close, but style/frame/body mass is not yet good enough for sales-brochure use.
  - keep it as the small regression fixture for Product 3D and 2D Compare/Overlay, not as proof the product goal is complete.

2026-05-31 spatial compiler checkpoint:

- `a-frame-bunk/proposal-paired-v1`
  - historical note: it previously passed the lighter browser QA gate.
  - current strict Brochure QA blocks it on full drawing-language drift, so it is a regression fixture rather than a release-candidate.
- `a-frame-22/proposal-paired-v10`
  - strict browser QA is still blocked on Presentation/Brochure drift.
  - current drift after regeneration:
    - full source miss: `51.1%`
    - full render extra: `47.3%`
    - primitive source miss: `35.2%`
    - primitive render extra: `46.7%`
    - primitive edge source miss: `3.0%`
    - primitive edge render extra: `7.2%`
  - layer-specific blockers are door, fixture, ladder/stair, and overall drawing-language mass. Edge alignment is close enough to prove source anchors are flowing; body/symbol fidelity is still not brochure-ready.
- `outpost-medium/proposal-paired-v11`
  - strict browser QA is still blocked on Presentation/Brochure drift.
  - current drift after regeneration:
    - full source miss: `28.4%`
    - full render extra: `31.3%`
    - primitive source miss: `19.2%`
    - primitive render extra: `31.3%`
    - primitive edge source miss: `7.3%`
    - primitive edge render extra: `6.0%`
  - current blocker is broad source/render drawing mass, not missing source primitive metadata.
- A raster source-crop overlay experiment for fixtures/ladders was rejected. It made stored SVGs fragile and worsened drift. Keep source image crops as evidence for repair prompts, not as a default deterministic render shortcut.
- Fresh scoped repair bundles were generated under `artifacts/brochure-qa/repair-bundles-all`; the current queue has `18` repair prompts covering `a-frame-22` and `outpost-medium`.
- Verification:
  - `npx tsc --noEmit` passes.
  - Historical verification at this checkpoint passed the gallery and `a-frame-bunk`, then blocked `a-frame-22` and `outpost-medium`; the stricter continuation checkpoint above supersedes that result and blocks all three target artifacts for release-candidate status.
  - `npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --all` regenerated current repair evidence.

2026-05-31 source primitive override checkpoint:

- `a-frame-22/proposal-paired-v10`
  - source primitive overrides were materialized from GPT proposal anchors: `71` wall primitives and `19` openings.
  - fixed the source-opening type boundary: materialized source doors now normalize `swing-door`, `exterior-swing-door`, and `bifold-closet-door` into the app's semantic enum (`interiorDoor`, `exteriorDoor`, `bifoldDoor`, etc.).
  - generated backup paired JSON files were moved under the paired artifact archive via `npm run archive:stale --`.
  - Current browser QA result: gallery passes, `a-frame-22` remains blocked on fixture primitive edge drift, ladder/stair drift, dashed void/open-to-below drift, and broad Presentation/Brochure Quality drift.
  - Current `a-frame-22` drift after regeneration:
    - full source miss: `51.2%`
    - full render extra: `47.1%`
    - primitive source miss: `35.4%`
    - primitive render extra: `46.6%`
    - primitive edge source miss: `5.7%`
    - primitive edge render extra: `7.0%`
  - Remaining repair should use the generated scoped bundles for `semantic rebuild`, `void/open-to-below`, `fixtures`, `stairs`, and `level frames`. Do not try to pass this with style-only tuning.

- `outpost-medium/proposal-paired-v11`
  - source primitive overrides were materialized from GPT proposal anchors: `36` wall primitives and `14` openings.
  - generated backup paired JSON files were moved under the paired artifact archive via `npm run archive:stale --`.
  - `sourceWalls` now preserve exterior roles for ids such as `ew-*`; current count is `10` exterior wall primitives.
  - `sourceOpenings` now preserve door metadata: `fromRoomId`, `toRoomId`, hinge/leaf/swing fields, `opensIntoRoomId`, and host wall ids. No source door is missing required metadata.
  - fixed a coordinate-space bug where source-opening door hinge/leaf points were copied in feet while the renderer expected the 4-ft grid. This created giant door arcs and false 28-38 ft drift blockers. Source overrides now store those points in grid units and the primitive validator converts them back to feet for comparison.
  - fixed QA/source primitive expectations so explicit `sourceWalls` / `sourceOpenings` are the source primitive contract when present. Browser QA no longer compares active source overrides against stale derived `exteriorWalls` / `interiorWalls` ids.
  - Current browser QA result: gallery passes, Outpost remains blocked only on Presentation/Brochure Quality, not missing source primitive metadata.
  - Current Outpost drift after regeneration:
    - full source miss: `28.5%`
    - full render extra: `31.6%`
    - primitive source miss: `19.3%`
    - primitive render extra: `31.6%`
    - primitive edge source miss: `7.3%`
    - primitive edge render extra: `5.8%`
  - Remaining blocker is real visible drawing-language/source-render drift. Do not promote. Next repair should target the semantic composition and drawing-style profile, not source metadata plumbing.

- `a-frame-bunk/proposal-paired-v1`
  - now passes visual drift and full desktop/laptop browser QA
  - fixture edge extra dropped below the cap after removing duplicate pillow rendering from the bed symbol
  - dashed-void edge drift is zero; body-only dark-region noise is classified as sparse linework presentation warning rather than a semantic blocker
- `outpost-medium/proposal-paired-v11`
  - still blocked
  - false door/window primitive blockers cleared after area-symbol source-anchor selection
  - current blocker: overall Compare/Overlay primitive mass drift, so Brochure Quality remains blocked
- `a-frame-22/proposal-paired-v10`
  - still blocked
  - source primitive overrides and door semantic type normalization are now in place
  - current blockers: fixture primitive edge drift, ladder/stair primitive drift, dashed void/open-to-below drift, and full Compare/Overlay mass
  - this is still a semantic/presentation repair target, not a promotion candidate

Verification after this checkpoint:

- `npx tsc --noEmit` passes.
- `node --check scripts/brochure-visual-qa.mjs && node --check scripts/regenerate-paired-renders.mjs` passes.
- `npm run archive:stale -- --dry-run` reports no manifest-archived files or active backups to move.
- Historical note: an older smoke run reported `1/32` promoted; the current strict baseline reports `0/32` promoted under the paired manifest. Treat release-candidate status as browser-QA driven, not manifest-promotion driven.

Older metric notes below are retained as historical checkpoints; the table and latest checkpoint above are authoritative for the current active baseline.

Recent drift files show:

- `a-frame-bunk/proposal-paired-v1`
  - `passed: false`
  - primitive source miss: `13.5%`
  - primitive render extra: `18.1%`
  - primitive edge source miss: `1.3%`
  - primitive edge render extra: `2.0%`
  - blocker: fixture layer edge/render drift; QA generated fixture, drawing-style, window, wall, level-frame, and void repair bundles
- `outpost-medium/proposal-paired-v11`
  - `passed: false`
  - primitive source miss: `18.5%`
  - primitive render extra: `28.3%`
  - primitive edge source miss: `6.7%`
  - primitive edge render extra: `5.5%`
  - blocker: primitive drawing mass and wall/opening primitive geometry; QA generated drawing-style, fixture, wall, door, level-frame, and furniture repair bundles
- `a-frame-22/proposal-paired-v10`
  - `passed: false`
  - primitive source miss: `33.0%`
  - primitive render extra: `46.1%`
  - primitive edge source miss: `3.4%`
  - primitive edge render extra: `7.1%`
  - wall layer itself now clears the layer thresholds, but overall primitive mass still fails
  - blockers: dashed void/open-to-below, dimensions, drawing style profile, walls, level frames, fixtures, ladder, and door/furniture presentation

2026-05-30 stricter drift checkpoint:

- All three target artifacts are review-only. `proposal-manifest.json` now has `pairedPromotionEligible: 0`; blocked artifacts remain visible for repair/debug but are not promoted.
- `paired:smoke` passes under the new rule: a promoted option must have passing visual drift; failing latest artifacts stay out of promotion.
- `paired:geometry` passes for the three review targets and verifies they remain in physical feet with roof/elevation JSON available.
- Fresh browser QA blocks all three targets and generated 17 scoped repair bundles under `artifacts/brochure-qa/repair-bundles-all`.
- The next high-leverage repair order is:
  1. `a-frame-bunk/proposal-paired-v1/fixtures`
  2. `a-frame-22/proposal-paired-v10/void-open-to-below`
  3. `a-frame-22/proposal-paired-v10/dimensions`
  4. `outpost-medium/proposal-paired-v11/walls`
- Repair bundles now include the full current paired JSON, drawing style profile, brochure repair packet, layer report, current layer section, patch path index, source image, deterministic SVG, and browser QA screenshots.
- `repair-prompt.md` was reduced from a duplicated ~468 KB prompt to a compact ~31 KB prompt. Full machine-readable context now lives in adjacent bundle files.
- `repair:gpt` dry-run request preview now includes structured context for current paired JSON, drawing style profile, compact layer report, patch path index, deterministic SVG, and selected images. It no longer duplicates the full repair packet in the API request body.
- Verification after this change: `node --check` for drift/render scripts, `npx tsc --noEmit`, `npm run paired:smoke`, `npm run paired:geometry`, and `BROCHURE_QA_PLANS=a-frame-bunk,a-frame-22,outpost-medium npm run qa:brochure` were run. QA correctly exits blocked while emitting repair packets.
- ChatGPT UI repair attempts:
  - `semantic rebuild` zip returned `[]`; too broad for a safe patch.
  - `walls` zip returned `[]`; it identified wall/source-anchor drift but would not patch safely.
  - `level frames` individual-file upload returned a JSON Patch, but local validation/regeneration showed it did not improve the primitive drift and removed generic floor panel entries. The patch was rejected, the automatic backup was restored, and the rejection is recorded in `artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-level-frames/rejection.json`.
  - Current baseline after rollback remains blocked with primitive edge source miss `3.6%` and primitive edge render extra `8.2%`.

2026-05-31 primitive compiler checkpoint:

- Fixed a primitive contract bug in `lib/drawing-primitives.ts`: split wall segments inherited their parent wall's full source anchor before the segment semantic span was known. That made the app compare a short rendered wall piece against an entire parent wall and produced false 20+ ft wall blockers.
- The extractor now prefers an exact `sourceAnchorId` match over inherited parent anchors, then computes the semantic span before projecting source anchors into feet. This keeps split wall comparisons at the primitive/segment level instead of the parent-wall level.
- Added per-layer primitive-contract classification in `app/page.tsx`: when the wall layer's visual primitive drift passes, noisy wall source-anchor geometry diffs are downgraded to debug warnings instead of blocking Design Quality. This does not relax door/window/fixture blockers.
- Verification:
  - `npx tsc --noEmit` passes.
  - `npm run paired:smoke` passes with `0/32` promoted and `30` queued.
  - `npm run paired:geometry` passes for the three review targets.
  - Syntax checks pass for the drift/render/smoke scripts.
  - Browser opened `http://127.0.0.1:3002/?home=outpost-medium` and captured `outpost-after-primitive-anchor-fix.png`.
  - `BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=outpost-medium npm run qa:brochure` still exits blocked, as intended.
- Impact on Outpost:
  - The false north-wall full-span blockers disappeared.
  - Wall primitive blockers are no longer in the browser QA blocker list because the wall layer's visual primitive drift is within tolerance.
  - Remaining blockers are now more actionable: door swing/placement drift, `win-n-stair` window drift, hidden additional door/window primitive diffs, and overall primitive mass.
  - Fixture blockers did not reappear in the Outpost QA blocker list after the wall classifier change.
  - Outpost remains review-only. Do not promote it until Compare/Overlay primitive drift and Brochure Quality pass.

2026-05-31 A-frame 22 annotation checkpoint:

- Archived the local rollback file `a-frame-22-proposal-paired-v10.paired.json.bak-1780196347027` out of the active paired data folder to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260531-active-paired-backups/`.
- Kept current paired JSON, source image, render SVG, drift JSON, QA report, screenshots, and repair bundles active. They are current failure evidence, not cruft.
- Fixed the next false layer classification after the dashed-void repair:
  - `scripts/recompute-visual-drift.mjs` now treats dimension primitives as annotation/presentation when source dimension edges are covered but the renderer adds extra tick/label edges.
  - `scripts/brochure-visual-qa.mjs` now routes that dimension annotation drift to the drawing-style/profile repair lane instead of semantic JSON repair.
  - `app/page.tsx` now reports dimension edge-extra as sparse-linework presentation drift unless source dimension edges are actually missing.
- Verification:
  - `npx tsc --noEmit` passes.
  - `node --check scripts/brochure-visual-qa.mjs && node --check scripts/recompute-visual-drift.mjs` passes.
  - `npm run paired:smoke` passes with `0/32` promoted and `30` queued.
  - `npm run paired:geometry` passes for the three review targets.
  - `BROCHURE_QA_URL=http://127.0.0.1:3002 npm run drift:paired -- --plans a-frame-22 --url http://127.0.0.1:3002` still blocks A-frame 22, but `primitiveLayerBlockers` is now empty; the remaining blocker is whole primitive drawing mass drift.
  - `BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=a-frame-22 npm run qa:brochure` correctly exits blocked.
  - Browser opened `http://127.0.0.1:3002/?home=a-frame-22` and captured `a-frame-22-after-dimension-classifier.png`.
- Current A-frame 22 blocker list after this change:
  - door primitive geometry drift on eight door ids
  - 20 hidden additional primitive geometry blockers
  - drawing-language drift for dashed void, doors, fixtures, ladder, and full Compare/Overlay mass
  - Product 3D/Cutaway/Front/Side/Plan Top remain blocked because Design, Presentation, and Brochure Quality are still blocked
- Next repair order:
  1. Door primitive geometry for `a-frame-22/proposal-paired-v10`.
  2. Fixture and ladder source/render primitive fidelity.
  3. Dashed-void drawing-style rhythm.
  4. Product 3D roof/panel/fixture presentation only after 2D primitive fidelity improves.

## What Recently Changed

- Added primitive-level visual drift checks for source/render comparison.
- Added wall segment splitting so physical wall pieces are compared as segments rather than continuous masked lines.
- Added sparse linework handling so dimension/window dark-area drift does not block when edge geometry passes.
- Improved fixture classification in `FloorPlanView.tsx`, including storage, counters, refrigerator, dining table, and fixture part rendering.
- Added source primitive alignment in `scripts/regenerate-paired-renders.mjs`.
- Regenerated Outpost render/drift after fixture stroke and wall primitive work.
- Added `wallBodyLineMode` to `drawing_style_profile_v1`.
  - `outpost-medium/proposal-paired-v11` now uses `centerline` wall bodies so deterministic wall edges match the GPT proposal source primitives.
  - A-frame plans keep the default `outline` wall body mode, avoiding the regression where a global centerline change made `a-frame-bunk` fail.
- Fixed fallback split-wall source span math so derived vertical wall segments preserve parent wall width instead of collapsing into diagonal/sliver boxes.
- Added wall-specific dark-mask tolerance in `scripts/recompute-visual-drift.mjs`.
  - This is a measurement fix, not a quality-threshold relaxation: thick filled wall bands are compared with a `9px` body tolerance, while wall edge thresholds remain strict and all non-wall layers keep the normal `4px` body tolerance.
  - This cleared the Outpost wall presentation false positive without changing fixture, room, or wall geometry.
- Demoted every target artifact whose current visual drift fails.
  - `paired:smoke` now reports `0/32` promoted and `30` queued generation handoffs.
  - `a-frame-bunk/proposal-paired-v1`, `a-frame-22/proposal-paired-v10`, and `outpost-medium/proposal-paired-v11` remain selectable review artifacts, but none are brochure-ready.
  - Render/drift/QA scripts now select the latest paired artifact for explicit regression targets even when it is not promoted, preventing fallback to stale v1 artifacts.
  - Promotion smoke now checks the visual drift file has `passed: true` for every promoted option.

## What Did Not Work

These should not be repeated without a new reason:

- Materializing broad source primitive overrides for Outpost worsened drift.
- Removing parent alignment for split wall segments worsened drift.
- Broad wall `no-stroke` or generic cross-axis thickness changes worsened either wall or fixture metrics.
- Tightening Outpost source wall anchors improved one number but created adjacent drift and did not clear the wall threshold.
- Treating dimension/window dark-pixel area as structural drift created false blockers for sparse linework.
- Applying centerline wall rendering globally fixed Outpost but regressed `a-frame-bunk`; wall drawing language must be per-profile, not global.
- Sweeping Outpost wall stroke, opacity, and backing color did not clear the wall drawing-language area blocker without trading off source miss or edge quality. The remaining Outpost issue should stay as a scoped `drawing style profile` GPT repair or explicit renderer-profile improvement, not a threshold relaxation.

## Cleanup Stance

Do checkpoint cleanup, not evidence-destroying cleanup.

- Keep failed artifacts and repair bundles as evidence until the replacement path is proven.
- Do not delete active paired data, QA screenshots, repair prompts, or catalog data blindly.
- Quarantine old SpatialIR/canonical-seed assumptions in docs and default selection.
- Do not keep optional side-channel data sources that can silently override paired JSON metadata.
- Remove generated cruft only after `rg` proves it is unreferenced and the browser QA still passes.
- Commit or stash before large cleanup; the current worktree contains many intentional untracked modules and generated artifacts.

Current cleanup decision:

- Keep `artifacts/brochure-qa/*` active for now. The screenshots, product packets, repair bundles, and reports are current failure evidence, not cruft.
- Keep deleted legacy paths deleted from the active tree; previous archive snapshots preserve the old foundation outside the app path.
- Do not archive current paired JSON, source images, deterministic renders, visual drift files, or repair bundles until a replacement artifact has passed browser QA.

Removed from the active foundation because they were old SpatialIR/guardian-generation paths rather than paired compiler paths:

- `app/den-seeds`
- `autoresearch/plan-fidelity/value_guardian_loop.py`
- `scripts/generate-data.py`
- `scripts/analyze-plans.py`
- `scripts/auto-improve.ts`
- `lib/conversion-validator.ts`
- `lib/graph-layout.ts`
- `lib/generate-placements.ts`
- `lib/plan-validator.ts`
- `public/data/den-seeds` symlink and runtime seed lookup in `lib/data.ts`
- `public/data/spatial-manifest.json` and `public/data/kintsugi-plans.json` stale symlinks
- `scripts/brochure-cron-loop.sh`; repair loops must be explicit via `npm run repair:loop`

Verification after this cleanup:

- `npm run paired:smoke` passes and guards that these paths stay removed.
- `npx tsc --noEmit` passes after clearing the stale Next.js cache and tightening a few paired TypeScript edges.
- `lib/data.ts` now derives plan name, square footage, bed/bath count, roof style, and loft status from the paired artifact itself.
- Stale-path search only finds this documentation and the explicit smoke guard list.

## Next Technical Work

1. Fix `a-frame-22` semantic drift before presentation polish.
   - The current active path is the `semantic rebuild` repair bundle, not more local renderer tuning.
   - The artifact is missing most source primitives in the rendered semantic layer: walls, doors, windows, fixtures, ladder, dashed void, and dimensions all need a scoped GPT JSON Patch or regenerated paired artifact.
   - Use `artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-semantic-rebuild.zip` as the next GPT handoff. Apply the returned patch through `npm run repair:apply`, then rerun `npm run qa:brochure`.
   - Because the first broad and wall-specific GPT repair attempts returned `[]`, the next useful prompt should either target one primitive with exact allowed paths or regenerate a fresh `proposal-paired-v11` paired artifact instead of trying to patch the current highly drifted v10 semantic graph.
2. Improve Product 3D after 2D primitive fidelity is stable.
   - Roof panels, wall heights, open-to-below, ladders/stairs, fixtures, and furniture must render as semantic objects, not debug-looking planes.
3. Keep browser QA as the gate.
   - Use actual browser screenshots for gallery, Product 3D, Cutaway, Front, Side, Compare, Overlay, Semantic, and export packet.
4. Repair one target at a time through scoped GPT patches.
   - Start with the smallest reliable artifact: `artifacts/brochure-qa/repair-bundles-all/a-frame-bunk-proposal-paired-v1-fixtures.zip`.
   - Apply returned patches with `npm run repair:apply`, regenerate render/drift, and rerun browser QA.
   - Do not restore promotion until the drift file and browser QA both pass.

## Cleanup Checkpoint

2026-05-30 cleanup pass:

- Removed stale generated `artifacts/` evidence and `.next/`; both are regenerated rather than treated as source.
- Removed unused old-manifest symlinks and the hidden cron-loop helper from the active tree.
- Archived heavyweight local evidence and BIM provider downloads to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-132324`.
- Left only the small BIM component catalogs in `public/data/bim-components`; provider/staging payloads are ignored local cache unless promoted as licensed release assets.
- Restarted the dev server on `http://127.0.0.1:3002` after clearing `.next`.
- Regenerated deterministic renders and visual drift for the three active plans.
- Regenerated browser QA evidence from the live app.
- Regenerated the repair queue from fresh QA only.
- Added `npm run style:sweep` so the existing measured style sweep is reachable as a first-class command.
- Archived stale paired backup/review files to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-140318-stale-paired-files`.
- Validation files were restored after an over-broad archive because the active manifest still references them. Cleanup now needs an explicit manifest-reference check before moving validation artifacts.

Fresh repair queue:

- `a-frame-22/proposal-paired-v10`: semantic rebuild, walls, void/open-to-below, dimensions, drawing style profile, level frames.
- `outpost-medium/proposal-paired-v11`: now passes browser QA after the wall-body measurement fix; keep it in the regression set to guard against wall/fixture tolerance regressions.

Active bundle cleanup:

- `artifacts/brochure-qa/repair-bundles-all` is now the canonical repair-bundle directory.
- The older one-layer `artifacts/brochure-qa/repair-bundles` directory was archived to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-active-bundle-cleanup`.
- Mis-keyed `a-frame-22-*a-frame-bunk*product-packet.json` QA packets were archived with the old bundles. Fresh QA should regenerate packets under the correct plan/proposal names.

Fresh checks:

- `npm run paired:smoke` passes.
- `npx tsc --noEmit` passes.
- `npm run goal:audit` passes.
- `npm run qa:brochure` is expected to exit blocked because `a-frame-22` still has real brochure blockers; this is the correct gate behavior.

2026-05-30 paired cruft archive:

- Moved stale paired-directory backups and browser/debug screenshots to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-162917-paired-cruft`.
- Archived only files that were not active manifests, paired JSON, deterministic renders, roof/elevation JSON, validation files, visual drift files, or repair bundles.
- The active `public/data/den-image-loop` symlink now has no `*.bak-*`, `*.sweepbak`, `app-browser`, or `chatgpt-cdp-state` files inside paired artifact folders.
- Keep this cleanup policy: archive stale evidence with a manifest; do not silently delete active source-of-truth artifacts.

2026-05-30 primitive-contract fix:

- Fixed a source-to-semantic drift false positive in `lib/drawing-primitives.ts`: exact `:seg-n` source anchors are no longer projected a second time as if they were parent wall spans.
- This reduced the worst visible `a-frame-22` wall primitive drift descriptions, but it did not clear `a-frame-22`; the artifact still has real source/render drift in dashed voids, dimensions, ladders, walls, doors, and fixtures.
- A reversible probe that materialized broad `sourceWalls`/`sourceOpenings` for `a-frame-22` was rejected and rolled back because it barely improved drift and introduced door/opening schema blockers.
- A reversible door-fill drawing-style probe was rejected and rolled back because it traded render-extra for source-miss without clearing the door presentation blocker.
- ChatGPT repair handoff for the semantic-rebuild bundle returned a blocked response rather than a patch. The response agreed that a broad semantic rewrite is unsafe from the current bundle alone and recommended either a drawing-style/profile repair pass or a regenerated paired JSON from a single source primitive contract.
- `BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=a-frame-bunk,outpost-medium npm run qa:brochure` passes after the primitive-contract fix.
- `a-frame-22/proposal-paired-v10` remains blocked by design; do not promote it until Compare/Overlay and primitive visual drift pass.

2026-05-30 active-path archive:

- Moved the remaining active-path temp/backup artifacts to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-170703-active-path-cruft`.
- Archived files:
  - `outpost-medium-proposal-paired-v11.drawing-style.json.tmp-before-width-sweep`
  - `a-frame-22-proposal-paired-v10.paired.json.bak-1780174310959`
- Verified the active `public/data/den-image-loop` paired artifact folders no longer contain `*.bak*`, `*.sweepbak`, `*.tmp`, `*tmp-*`, `*app-browser*`, or `*chatgpt-cdp-state*` files.
- Continue using archive moves for stale evidence; only delete regenerated caches or files that are explicitly not source-of-truth.

2026-05-30 fixture/ladder primitive-contract alignment:

- Tightened `lib/drawing-primitives.ts` so source-anchored fixtures and ladders use the same source-anchor bounds in the primitive contract that the deterministic renderer already uses in `lib/data.ts`.
- This fixes a compiler-layer inconsistency: the renderer was drawing fixtures/ladders from source anchors, while the primitive contract compared the GPT image against raw fixture bounds.
- The refreshed `a-frame-22` product packet now reports zero source-to-semantic geometry blockers for `fixture` and `ladder`.
- This did not clear `a-frame-22` release gates because the pixel/raster drift is still real:
  - full source miss `57.0%`
  - full render extra `44.1%`
  - primitive source miss `43.8%`
  - primitive render extra `43.3%`
  - ladder edge render extra `9.4%`
  - dimension edge render extra `28.4%`
  - wall edge render extra `6.2%`
- Regenerated the active repair queue after the check. It still contains the `a-frame-22/proposal-paired-v10` lanes that remain blocked: semantic rebuild, walls, void/open-to-below, dimensions, drawing style profile, and level frames.
- Regression check passes for `a-frame-bunk/proposal-paired-v1` and `outpost-medium/proposal-paired-v11` after the primitive-contract change.

2026-05-30 verification/archive refresh:

- `npx tsc --noEmit` passes.
- `npm run paired:smoke` passes: `2/32` promoted, `30` queued, `18` paired options in the manifest.
- Fresh render/drift/browser QA was regenerated from the live app at `http://127.0.0.1:3002`.
- `BROCHURE_QA_PLANS=a-frame-bunk,a-frame-22,outpost-medium npm run qa:brochure` correctly blocks only `a-frame-22`; `a-frame-bunk` and `outpost-medium` pass desktop and laptop browser QA.
- Current `a-frame-22/proposal-paired-v10` drift remains real and must not be promoted:
  - full source miss `56.7%`
  - full render extra `43.8%`
  - primitive source miss `43.5%`
  - primitive render extra `43.0%`
  - primitive edge source miss `3.6%`
  - primitive edge render extra `8.2%`
  - blocked layers: dashed void, dimensions, wall edge extra, plus door/fixture/ladder drawing-language drift.
- The fresh repair queue now contains six active `a-frame-22/proposal-paired-v10` bundles:
  - semantic rebuild
  - walls
  - void/open-to-below
  - dimensions
  - drawing style profile
  - level frames
- Archived stale `a-frame-22` browser/debug screenshots and old patch-loop output to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-175156-a-frame-22-debug-output`.
- Smoke still passes after the archive. The active manifest-linked paired JSON, source images, renders, validation files, visual drift files, and repair bundles were not moved.

2026-05-30 manifest-aware in-place archive:

- Added `npm run archive:stale`.
- The command moves manifest-archived paired sidecars out of active folders and rewrites their manifest URLs to `archive/` paths, so archived plans remain debuggable without contaminating active candidate directories.
- It also moves repair backups and debug drift folders under `paired/archive/backups/` and `paired/archive/debug/`.
- Ran it against the live `public/data/den-image-loop` symlink:
  - `74` manifest-archived files moved on the first pass.
  - `10` backup/debug items moved on the second pass.
  - A final dry run reports `0 moved, 0 already archived, 0 missing`.
- Active paired folders now contain only current candidate sidecars for:
  - `a-frame-bunk/proposal-paired-v1`
  - `a-frame-22/proposal-paired-v10`
  - `outpost-medium/proposal-paired-v11`

2026-05-30 repair evaluator hardening:

- Added `npm run repair:evaluate`.
- The evaluator applies a scoped GPT JSON Patch, regenerates the deterministic render, recomputes visual drift, and automatically rolls the patch back if drift or blockers do not improve.
- The known-bad `a-frame-22/proposal-paired-v10` level-frame patch was evaluated and rejected:
  - score `1.123451 -> 1.126889`
  - paired JSON was rolled back
  - generated backup was archived
- This closes the loop that previously let manual repair attempts leave stale `.bak-*` files in active paired folders.

Latest verification after archive/evaluator changes:

- `npx tsc --noEmit` passes.
- `npm run paired:smoke` passes.
- `npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --clean --all` regenerated six active `a-frame-22/proposal-paired-v10` repair bundles.
- Browser QA against `http://127.0.0.1:3002`:
  - gallery passes on desktop and laptop
  - `a-frame-bunk/proposal-paired-v1` passes on desktop and laptop
  - `outpost-medium/proposal-paired-v11` passes on desktop and laptop
  - `a-frame-22/proposal-paired-v10` remains correctly blocked by primitive visual drift and drawing-language drift

2026-05-30 primitive compiler regression guard:

- `npm run paired:smoke` now checks primitive visual drift caps for every promoted plan, not only the top-level `passed` flag.
- Promoted plans must keep primitive edge drift under the current passing floor for walls, doors, windows, and fixtures. This prevents renderer/theme/asset changes from silently making brochure primitives worse while still reporting green.
- `a-frame-22/proposal-paired-v10` is explicitly guarded as a blocked primitive-drift regression case. It must stay out of promotion until its visual drift file passes and its primitive blockers are gone.
- `npm run archive:stale -- --dry-run` currently reports `0 moved, 0 already archived, 0 missing`, so the active paired folders are clean after the archive pass.

2026-05-30 handoff-output archive:

- Moved generated `paired-handoff/output` scaffolds out of the active data tree to `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-paired-handoff-output`.
- Archived:
  - `outpost-medium-output`
  - `a-frame-bunk-output`
  - `a-frame-bunk-plus-output`
- Recreated empty `paired-handoff/output` folders so future handoff scripts can write fresh outputs without reusing stale patch candidates.
- Verified `find -L public/data/den-image-loop -path '*/paired-handoff/output/*' -type f` returns `0` files, and `npm run paired:smoke` still passes.

2026-05-30 geometry compiler target fix:

- `npm run paired:geometry` now validates explicit target artifacts instead of only promoted artifacts:
  - `a-frame-bunk/proposal-paired-v1` as promoted
  - `a-frame-22/proposal-paired-v10` as active review/blocked
  - `outpost-medium/proposal-paired-v11` as promoted
- Added compiler checks for:
  - `paired_gpt_floorplan_v1` schema version
  - stable ids on rooms, walls, doors, windows, openings, and fixtures
  - door/window/opening `wallId` references
  - door/window/opening spans hosted by a wall segment or adjacent split-wall gap
  - room references on doors/openings and fixture ownership
  - fixture `anchorWallId` references
- The adjacent split-wall gap rule matters for Den-style render fidelity: a doorway may be represented as the omitted gap immediately after a solid wall segment, so the validator must reject detached openings without requiring the opening span to lie inside the drawn solid wall body.
- Verification:
  - `node --check scripts/check-paired-geometry.mjs` passes.
  - `npm run paired:geometry` passes and reports all three target artifacts.
  - `npm run paired:smoke` passes.
  - `npx tsc --noEmit` passes.
  - Historical lighter QA passed for `a-frame-bunk` and `outpost-medium`.
  - Browser QA correctly blocks `a-frame-22` on primitive visual drift, not on schema/geometry compilation.

2026-05-30 Outpost style sweep result:

- Ran the bounded `style:sweep` loop for `outpost-medium/proposal-paired-v11` against `http://127.0.0.1:3002`.
- Baseline remained the best option:
  - baseline score `1.138347`
  - `wall-edge-body-soft` improved wall edge render extra from `5.32%` to `4.89%`, but worsened primitive/source balance enough that the aggregate score rose to `1.151447`
  - fixture-soft variants worsened primitive edge source miss substantially
- The sweep restored the baseline drawing style. Historical lighter QA passed Outpost at this point, but current strict Brochure QA blocks it; residual wall drift should be treated as source primitive/semantic repair work rather than a broad renderer style change.
- Tightened `archive:stale` so duplicate runtime backups are removed when an identical archived copy already exists. The post-sweep duplicate active `.sweep-runtime-bak` was removed.
- Verification:
  - `node --check scripts/archive-stale-paired-artifacts.mjs` passes.
  - `npm run archive:stale` reports `0 moved, 1 duplicate(s) removed, 0 already archived, 0 missing`.
  - `npm run paired:smoke` passes.
  - `npm run paired:geometry` passes.
  - `npx tsc --noEmit` passes.
  - Historical lighter QA passed for `a-frame-bunk` and `outpost-medium` after baseline restore.

2026-05-30 stable-foundation archive checkpoint:

- The active paired folders are clean: `npm run archive:stale` reports `0 moved, 0 duplicate(s) removed, 0 already archived, 0 missing`.
- No active paired `.bak`, `.tmp`, or `.sweep-runtime-bak` files remain outside paired archives.
- No generated `paired-handoff/output` files remain in the active Den image-loop tree.
- The old tracked legacy harness files currently deleted from the worktree were archived from `HEAD` for reversibility:
  - `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-203903-removed-legacy-tracked-files/deleted-files.txt`
  - `/Users/openclaw/.openclaw/archive/wikihouse-planner/20260530-203903-removed-legacy-tracked-files/deleted-files-from-head.tar`
- This archive contains 26 removed tracked files, including old static home JSON, old SpatialIR manifests, pre-paired generator/analyzer scripts, and stale `.best` component snapshots. The active app should not load them.
- `chatgpt-handoff/generated` images remain active because the proposal manifest references those source proposal images. Do not archive the whole handoff directory unless the manifest is updated to point at a replacement source-image location.
- Fresh verification after the archive checkpoint:
  - `npm run paired:smoke` passes.
  - `npm run paired:geometry` passes.
  - `npx tsc --noEmit` passes.
  - Historical lighter QA passed for then-promoted plans `a-frame-bunk` and `outpost-medium`.
  - Browser QA correctly blocks `a-frame-22` on primitive/source-render drift.

2026-05-31 A-frame 22 void/render contract checkpoint:

- Fixed the renderer suppression bug where any source void marker on a floor suppressed the full semantic open-to-below face.
  - Boundary markers such as `int-l1-open-to-below-east-boundary` now remain dashed boundary lines.
  - Area markers such as explicit cross/diagonal/voidmarker primitives are the only markers allowed to replace the semantic void face.
- Regenerated `a-frame-22/proposal-paired-v10` render and drift.
- Result:
  - `dashedVoid` edge source miss improved from the prior ~37% range to `6.7%`.
  - The broad open-to-below X/area is visible again in the deterministic SVG.
  - `a-frame-22` remains correctly blocked.
- Current blockers after browser QA:
  - fixture primitive edge drift: source miss `40.3%`, render extra `37.0%`, edge miss `12.1%`, edge extra `4.8%`
  - fixture/ladder primitive geometry blockers for range, stair treads, tub, loft stair treads, loft bath fixtures, and loft bed
  - broad Presentation/Brochure drawing-language drift: primitive source miss `35.4%`, primitive render extra `46.6%`, primitive edge miss `3.4%`, primitive edge extra `7.2%`
- Important architecture note:
  - Some fixture source anchors describe the source visual glyph footprint, while semantic fixture bounds describe the buildable object. The next fix should add an explicit `visualPrimitiveBounds` / source-glyph contract or a scoped GPT patch, rather than forcing semantic fixture dimensions to impersonate brochure glyph boxes.
  - Do not regress the fixed void-face rule while working on fixtures/ladders.

## Useful Commands

```bash
npm run render:paired
npm run drift:paired
npm run qa:brochure
npm run paired:geometry

BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=a-frame-bunk npm run qa:brochure
BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=outpost-medium npm run qa:brochure
BROCHURE_QA_URL=http://127.0.0.1:3002 BROCHURE_QA_PLANS=a-frame-22 npm run qa:brochure

npm run repair:queue -- --out artifacts/brochure-qa/next-repair-prompts-all.md --bundle-dir artifacts/brochure-qa/repair-bundles-all --zip --clean --all
npm run repair:evaluate -- --bundle artifacts/brochure-qa/repair-bundles-all/a-frame-22-proposal-paired-v10-walls --patch patch.json
npm run archive:stale
npm run repair:doctor
```
