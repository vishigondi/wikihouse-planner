# Floorplan Studio — Engineering Quality Playbook

*Derived from the system-hardening work of 2026-06-10 → 06-12. This is the
analysis to work from when we want to keep that bar. It is not a changelog —
it is the operating model, the principles, and the rubric that produced the
result, written so they can be repeated.*

---

## 0. Scope: what this documents (and what it doesn't)

A note on attribution first, because the git history is misleading. **Every
commit trailer reads `Co-Authored-By: Claude Fable 5`**, including the later
design-system redesign — the trailer was carried over verbatim and does not
mark the model boundary. The real boundary is by **work phase**:

- **The hardening era (this document)** — commits `7a84d31` → `08638ab`
  (planner) and `cccf537` → `08574f0` (dev-compiler), 06-10 → 06-12. Six
  loops: customer-readiness, geometry rebuild, 3D quality, export pass,
  architect polish, UX review. This is the work that was exceptional in its
  logic and its ability to harden the system.
- **The redesign era (out of scope here)** — commits `3efa32d` → `dc81a68`.
  A cosmetic design-system pass (Geist type, rounded surfaces). Good work,
  but cosmetic; not what this playbook is about.

This playbook is about the hardening era. The whole point is to keep *that*
alive.

---

## 1. The operating model — the loop discipline

Every hardening loop ran the same shape. This shape *is* the quality system;
the code principles below only hold because this process enforced them.

1. **One verifiable capability per fire.** Never two. A fire delivers a
   single thing that can be demonstrated true or false — "openings cut into
   walls," "fixtures clamp under the roof," not "improve 3D."
2. **Verify in the real artifact, from the angle the bug hides.** Not "does
   it compile" — open the actual plan in the user's real Chrome and look at
   it from the orbit where the defect would show (top-down on gen-001,
   eave-side on a fresh a-frame, oblique on outpost-medium). The sail-fin bug
   survived precisely because nobody looked from the fin angle.
3. **Read the evidence, not the screenshot.** After every interaction batch,
   read `bimEnvelopeMaxExcessFt` / `bimEnvelopeOffenders` off the canvas and
   `read_console_messages` for silent React/WebGL errors. Screenshots lie by
   omission; the DOM evidence doesn't.
4. **Full gate suite green before every commit.** No exceptions, no "I'll fix
   the gate after." The suite: `check:drawing check:elevations check:clip
   check:code check:brief check:generation` + `build` + `qa:brochure` (live
   prod on :3000) + `final-interactive-sweep` (live on :3002).
5. **Two consecutive clean fires to stop.** A loop doesn't close on one green
   run — it closes on a *no-change verification pass* that is also green. The
   second run is what catches "green by accident."
6. **Standing guardrails are absolute.** Semantic JSON / compiler /
   constraint engine untouched unless explicitly in scope. Envelope /
   constraint / qa gates never loosen. Traced plans (a-frame-22, a-frame-bunk,
   outpost-medium) never regress visually and their artifacts are never
   edited. All `data-*` QA hooks preserved. Throwaway `gen-*` deleted after
   each fire.
7. **If a fix needs a gate change, the gate must assert MORE, never less.**
   When hiding the Overlay tab for JSON-only plans broke `qa:brochure`, the
   gate wasn't relaxed — it was made stricter in both directions (JSON-only
   *must not* expose Overlay; GPT-paired *must*).

> The discipline that made this work: the model repeatedly caught and
> corrected *its own* premature "done." The first "READY TO TEST" was
> retracted when the user's screenshot showed sail fins the review had
> rationalized away — and the response was to rebuild the geometry, not to
> patch the screenshot. Honest self-correction over a clean-looking result.

---

## 2. The seven hardening principles

Each is stated, then grounded in the code that embodies it.

### P1 — Replace heuristics with constructive geometry. The per-case branch *is* the disease.

The 3D renderer had accumulated per-case logic: `wallRole` routing, ridge-axis
guessing, and hardcoded decorative `aFrameGableCaps` triangles. Those caps,
glued to the eave side of ridge-along-z plans, were the "sail fins." The fix
was not to special-case them away — it was to delete the entire heuristic
layer and derive every wall, gable end, knee wall, and ridge-straddling
partition from **one** function.

`lib/bim/envelope-clip.ts:1`:
> "No per-case heuristics. Gable-end triangles, eave knee wedges,
> ridge-straddling partitions, and window glazing all come out of ONE
> function."

> "Construction is exact, not sampled: the footprint polygon is split by the
> lines where the active ceiling plane changes… Inside each region exactly one
> plane is active, so the top face is planar and side walls have straight top
> edges."

The mechanism: fit ceiling planes from roof points (the *same* math the
constraint engine uses — single source of truth), then split a wall/slab
footprint along the lines where the active plane changes (ridge lines, plane
intersections, the floor-crossing line), cap each convex region with its one
active plane. Doors/windows are subtracted by interval-merging the openings
and emitting sill + header pieces, each itself roof-clipped — so a door in a
low knee wall *honestly degenerates* (the header just vanishes when the
ceiling drops below it). Result: gen-001's envelope error went **15.84 ft →
0.01 ft**.

The lesson generalizes past geometry: when you find yourself adding the Nth
special case, the special cases are the bug. Find the one model they're all
approximations of.

### P2 — Evidence samples *every* mesh. Untagged = failure.

The old envelope gate sampled only wall-tagged meshes, so 15.84 ft of
untagged fin geometry read as 1.14 ft — an 80% blind spot. The rebuilt
evidence walks **every mesh in the scene**, tagged or not, and any mesh it
can't attribute is recorded as an offender, not skipped.

`components/bim/BimPreview.tsx:1441`:
> "Roof planes define the envelope; everything else rendered must sit inside
> it. Untagged meshes are sampled too — a mesh the evidence cannot attribute
> must never be a mesh the evidence ignores."

`scripts/final-interactive-sweep.mjs:33`:
> "no plan may render untagged geometry above the roof (untagged meshes are
> how [the sail fins evaded the wall-only gate])"

This is the single most transferable idea in the whole codebase: **a
measurement that only looks at the things it already knows about cannot catch
the thing that went wrong.** The default must be "everything is in scope and
must be explained," not "known categories are checked." Untagged is a failure
signal, never a gap.

### P3 — Gates assert MORE, never less. Envelope/constraint gates never loosen.

The compiled-plan envelope gate was *tightened* from 0.5 ft to **0.25 ft**
once the geometry was honest enough to hold it (`b334e25`), and it has held
there. When new lanes or features arrived, the response was always to add
assertions, never to carve exemptions. The only exemption in the system —
traced plans' "designed-bay" excess — is explicit, narrow, named in the gate,
and info-logged so it can never be mistaken for a pass it didn't earn
(`final-interactive-sweep.mjs:45-49`).

### P4 — Separate data lanes without faking either.

JSON-only ("constrained_json") plans have no GPT source image, so
GPT-source-relative checks (style-profile drift, drawing-primitive contract,
overlay, proposal-image warnings) genuinely don't apply. The hardening let
those checks **skip** for the JSON-only lane *without* synthesizing a fake
source image to satisfy the old gates, and *without* loosening a single
geometric or constraint gate — those apply identically to both lanes.

The stated rule: **"never fake a GPT lane to satisfy old gates, and never
loosen envelope/constraint gates."** And the gate enforces the lane contract
*both ways*: a JSON-only plan that *does* expose the Overlay tab fails QA
(`brochure-visual-qa.mjs` + `final-interactive-sweep.mjs`).

### P5 — Input honesty. No silent drops. No wiped keystrokes.

The brief parser surfaces an `unparsed[]` list and the landing page echoes it
("Understood: 3 bed · … Ignored: farmhouse"). Bugs fixed here were all
*silent* failures of honesty: "one bedroom" silently became a 2-bed
(word-numbers unparsed); "10 foot setbacks" was silently dropped (unit
pattern lacked `foot`, and the unparsed reporter only flagged whole
comma-segments). Each fix made the drop *visible*, not just correct.

The subtlest one (`eb35e7f`): the landing brief box was a **controlled**
input, so keystrokes typed before hydration were wiped by the first data-load
re-render. It was made **uncontrolled** (`defaultValue`, read via ref at
submit) so the customer's first words always survive. *A controlled input
that re-renders on async data is a keystroke-eating trap.*

> This same honesty later surfaced the loft finding: compiled generation
> can't build lofts (`compile-plan.ts` hardcodes `floor-0`), and rather than
> hide it, the parser lists "loft" as ignored. The system tells the truth
> about its own limits.

### P6 — The server enforces every invariant the UI implies.

The UI only shows a Delete button on compiled, non-promoted `gen-NNN` plans —
and `app/api/delete-plan/route.ts` enforces *exactly that* server-side: a
`/^gen-\d{3}$/` whitelist, a promoted-plan refusal, a 404 for unknowns. The
client gate is a convenience; the server gate is the truth.

Same instinct produced the SSRF fix (`b9105df`). The renderer subprocess was
spawned with `new URL(request.url).origin` — trusting the Host header, a
classic SSRF vector. It now spawns only against a configured
`INTERNAL_RENDER_ORIGIN` or a validated loopback origin, never anything
derived from the request.

`app/api/generate-plan/route.ts:224`:
> "Never hand the renderer a Host-header-derived origin (SSRF vector): only a
> configured internal origin or the loopback port we serve on."

### P7 — One source of truth for shared math.

The ceiling-plane equations are fit the same way in three places — the
constraint engine (which decides legality), `envelope-clip.ts` (which builds
the geometry), and `elevations.ts` (which draws the 2D facade). Because they
share the math, the 2D elevation, the 3D model, and the code-compliance check
**cannot disagree** about where the roof is. Cross-view consistency isn't
tested into existence after the fact; it's structural. `check:elevations`
then guards it: every opening the elevation draws must map to a real artifact
opening within ±0.5 ft, heads clamped under the ridge by the same policy the
3D uses.

---

## 3. The gate ladder

Fast deterministic batteries first, live-browser verification last. A release
requires the whole ladder green, twice.

| Gate | Layer | Enforces | Key thresholds |
|---|---|---|---|
| `check:brief` | in-proc | Brief parses deterministically; canonical output; `unparsed[]` surfaces unknowns | word-numbers, foot-units, sorted keys |
| `check:generation` | in-proc | Brief → intent → valid artifact; footprint fits lot + maxSqft; R305 ceiling derived from roof planes | 0.5 ft roof sampling grid; envelope-exceed must *fail* |
| `check:code` | in-proc | Constraint engine status correct across IRC + NC Cherokee packs; egress proven per sleeping room | R304.1/.2, R305.1, R310.1, ZON-SETBACK/COVERAGE |
| `check:clip` | in-proc | Constructive clipping never escapes the ceiling plane | vertex violation < 1e-6 ft; sliver area > 1e-6 |
| `check:elevations` | in-proc | Elevation shows exactly the artifact's facade openings; no invented openings | opening center ±0.5 ft (compiled), ±1.6 ft (traced); head ≤ ridge |
| `check:drawing` | disk | Stored sheets carry title block / north / scale / band dims; elevation honesty per plan | sheet plans vs traced primitive-QA artifacts |
| `build` | compile | Type + webpack integrity | — |
| `qa:brochure` | live :3000 | No debug/harness leaks; lane statuses; export packet; lane contract (Overlay presence) | 10 passes (5 plans × 2 viewports) |
| `final-interactive-sweep` | live :3002 | Envelope integrity per plan; views/toggles cycle; constraint display; lot editor; brief echo | compiled excess ≤ 0.25 ft, **0 untagged offenders all plans** |

---

## 4. Canonical numeric invariants (the magic numbers, and why)

Don't change these casually — each encodes a decision.

- **0.25 ft** — max envelope excess for a *compiled* plan (tightened from 0.5
  once geometry was honest). Offenders list must be empty.
- **0 untagged offenders** — for *every* plan, traced included. Non-negotiable.
- **±0.5 ft** — elevation opening centerline tolerance for compiled plans.
- **±1.6 ft** — facade-opening tolerance for *traced* plans (wall thickness
  ~0.3 ft + source-trace jitter ~1.2 ft). The reason traced ≠ compiled.
- **1e-6 / 1e-7 / 1e-9 ft** — geometry epsilons: vertex-violation tolerance,
  plane-coefficient compare, collinearity determinant.
- **0.06 ft** — fixture-to-roof clearance; **< 0.2 ft** allowed height → hide
  the fixture rather than render it crushed.
- **< 0.5 ft** pane height → skip the window (too small to draw honestly);
  sill slides down first if 0.5–1.0 ft.
- **0.5 ft** — roof-sampling grid step for R305 ceiling-profile derivation
  (sampled, not point-probed).

---

## 5. Anti-patterns this era killed (keep them dead)

- **Sail fins** — untagged decorative geometry, born of per-case branching,
  invisible to a category-scoped gate. Killed by P1 + P2.
- **Wall-only sampling** — a measurement scoped to known categories. Killed by P2.
- **Controlled input on an async-rendering page** — ate pre-hydration
  keystrokes. Killed by P5.
- **Host-header-trusting subprocess spawn** — SSRF. Killed by P6.
- **Silent parse drops** — "one bedroom" → 2-bed; dropped setbacks. Killed by P5.
- **Rationalizing a screenshot defect** — calling fins "front gable in
  perspective." Killed by the loop discipline (verify from the bug's angle).
- **Loosening a gate to make a feature pass** — killed by P3.

### UX-sweep era (2026-06-19) — usability/a11y anti-patterns

Found only by DRIVING the live app and clicking at the angle a defect hides;
each killed by a class-level interactive-sweep assertion + a root-cause fix.

- **Destructive action on a single unconfirmed click** — Delete fired instantly.
  Killed by a shared two-step `ConfirmButton` (fire 1).
- **Overlay with no standard dismissal / no focus management** — modal ignored
  Escape, backdrop click, and left focus on `<body>`. Killed by one effect on the
  shared `WorkflowModal` (Escape + backdrop + focus-in/trap/restore) (fires 2, 5).
- **Fire-and-forget side effect with no feedback, silent on failure** — copy
  buttons used `navigator.clipboard?.writeText(...)` (the `?.` swallows failure).
  Killed by a shared `CopyButton` (Copied!/Copy failed + execCommand fallback,
  `data-copy-state`) (fire 3).
- **Silent fallback that lies** — an unknown `?home=` id rendered a *different*
  plan as if it were the requested one. Killed by surfacing a not-found notice +
  feed fallback + URL reset (fire 6).
- **Dead / false affordance** — a labeled control ("Share") that does nothing
  though the app has the capability (deep-links). Killed by wiring it up (fire 7).
- **Control with no accessible name; field labeled only by a placeholder** —
  glyph-only nav arrows, six unlabeled filter selects. Killed by aria-labels +
  *scan-every-control / scan-every-field* gates (fires 8, 10).
- **Sub-24px touch target on a customer surface** — the feed Share link. Killed
  by a min hit area + a feed-card mobile tap-target gate (fire 9).
- **Transient UI state cleared by only one of several nav paths** — the
  not-found banner went stale via the repair-from-card path. Killed by clearing
  it in ONE effect when leaving the feed (fire 11).
- **Double-submit guarded only by React state** — state doesn't update within a
  tick, so a synchronous/rapid double-click re-enters and fires the mutation
  twice (duplicate plans). Killed by a synchronous `useRef` guard on both
  generate handlers, gated by an abort-the-POST double-submit test (fire 13).

Methodological lesson: the interactive sweep can assert whole-class invariants by
*scanning* the live DOM (every interactive control has an accessible name; every
form field has a label; every feed-card control is ≥24px on mobile; a synchronous
double-click yields exactly one POST) — not just per-element spot checks. That is
how a single gate guards the class, not the instance.

---

## 6. The "keep it alive" rubric

A capability is **done** only when all of these are true. Use it as the
pre-commit checklist for any new work that touches geometry, gates, or the
generation pipeline.

**Correctness**
- [ ] One verifiable capability, stated as a true/false claim.
- [ ] Verified in the real browser, from the angle a defect would hide.
- [ ] Console read for silent errors after the interaction; clean.
- [ ] Envelope evidence read off the canvas; compiled ≤ 0.25 ft, 0 untagged
      offenders, traced exemption explicit.

**Honesty**
- [ ] No silent drops — anything ignored is surfaced to the user.
- [ ] No faked lane / synthesized input to satisfy an old gate.
- [ ] Shared math (roof planes, clamp policy) reused, not re-derived, so 2D /
      3D / compliance can't disagree.

**Enforcement**
- [ ] Every UI-implied invariant also enforced server-side.
- [ ] If a gate changed, it asserts *more*. New invariant has a new assertion.
- [ ] No network-derived value trusted for an internal action.

**Process**
- [ ] Full gate ladder green (6 batteries + build + qa:brochure + sweep).
- [ ] Guardrails intact: compiler/constraint engine untouched, traced plans
      unchanged, all `data-*` hooks preserved, throwaways deleted.
- [ ] For loop closure: a second, no-change verification pass is also green.

If you can't check a box, the work isn't done — it *looks* done, which is
worse.

---

## 7. Known debts deliberately left

Recording these so they stay visible (and so nobody "discovers" them as bugs):

- **~~Compiled generation cannot build lofts.~~ SHIPPED 2026-06-15.** A brief
  with "loft" on an a-frame or steep gable now compiles a level-1 loft over
  the roof's headroom band (frame + room + gable wall + window + ladder),
  derived from the same ceiling-plane math the roof uses, clipped within the
  0.25 ft envelope, and R305-checked from the loft floor (not the ground).
  Single-level plans compile unchanged; a roof too shallow degrades honestly.
  Gates: `check:brief` (loft recognized), `check:generation` (level-1 frame +
  R305 from the loft floor, a-frame + steep gable, no-headroom degrade),
  `check:elevations` (loft window at loft sill height), `check:code` (loft
  sloped-ceiling fixtures). Commits `bd0e3d0`, `516c066`, `671d095`, `b923bc6`.
- **Chrome blocks a 2nd programmatic download per session** — a constraint,
  not a bug; user-initiated clicks are unaffected. (This is why the
  look-render lane's in-session render import is a one-click user step
  rather than fully automated — see below.)
- **Illustrative lanes stay subordinate and labeled.** The look-render lane
  (`lib/look-render.ts`, `npm run lookrender:import`) is a stylized ChatGPT-
  browser exterior render, NOT a measured drawing: it is always flagged
  illustrative, rendered below the dimensioned sheet/3D/elevations, never
  replaces them, and gets NO drift comparison (an exterior render is not the
  2D plan — faking one would be the "never fake a lane" anti-pattern in
  reverse). The import touches only `lookRender*` manifest fields; the
  deterministic render/JSON/sourceKind stay byte-identical. It's a local,
  human-in-the-loop workflow; a deployed product swaps the browser handoff
  for a `gpt-image-1` call behind the same prompt builder + import + panel.
- **Consistency for an illustration = STRUCTURAL agreement, never pixel drift.**
  The 2D sheet and 3D are consistent *by construction* (P7, shared roof-plane
  equations) — never re-derive or fake a 2D↔3D check. The illustration is the
  only variable that can drift, so it is held to checkable structural facts —
  roof style, footprint aspect, gable door/window counts, loft presence — via
  an `expectedStructure` block the import records from the SAME compiled
  geometry the 3D/elevations draw from (`buildElevationModel(gable side)`, so
  prompt + checklist + drawing agree by construction). The consistency panel
  shows the illustration beside the deterministic gable elevation with that
  checklist; verification is a human reading both in real Chrome and rejecting
  drifters (e.g., an a-frame rendered as a gable cottage). It is NEVER a
  pixel/dimensional drift number — that comparison would be a fabricated metric
  (P4's "never fake a lane"). Shipped 2026-06-16; gated by `check:lookrender`
  (expectedStructure-equals-geometry, incl. ridge-axis + loft) and the sweep
  (panel + reference assertions). Note: traced/loft footprints record levels
  via `appliesTo`/floor, not a `levels` count — derive `hasLoft` from any of
  those, and pick the gable elevation by ridge axis (front for ridge-z, side
  for ridge-x), or the structural facts come out wrong (the a-frame-22 bug).
- **Presentation lanes compose existing assets; they don't relax the source of
  truth.** The home page IS a social feed (`FeedCard`, Browse Plans at "/"):
  every plan is a card that stacks a photoreal look render above the
  deterministic dimensioned floor-plan sheet — but the render keeps its "concept
  render" label + originality guard and is visually subordinate; the dimensioned
  plan stays primary and is never replaced. Photoreal is just a `LookRenderMode`
  flag on the same prompt builder (still geometry-conditioned, still
  expectedStructure-checked); a photoreal concept that could pass for a real
  building gets the *stronger* framing "not a photo of a real home." View-only;
  the import overwrites the look render at the same path so the manifest +
  deterministic artifacts stay byte-identical. A plan with no render shows a
  "concept render pending" placeholder, never a broken image. When the card
  design changed, the gates were UPDATED to assert the new invariants (feed card
  + concept label + source-of-truth + repair/open + engagement, render ABOVE the
  plan) across `check:den-seeds`, `qa:brochure`, and the sweep — not loosened.
  Shipped 2026-06-16.
- **Responsive is gated, not eyeballed.** Standard breakpoints are mobile 390,
  tablet 768, laptop 1024, desktop 1440. The interactive sweep loops them in true
  Playwright viewports and asserts NO horizontal overflow
  (`documentElement.scrollWidth - innerWidth <= 1`) + key landmarks on the home
  feed and the plan detail page (incl. the detail page with Review Tools open),
  and that each workflow modal fits in-bounds at 390/768. Note: claude-in-chrome
  `resize_window` can't shrink below ~500px (window minimum), so true mobile
  review is done via Playwright viewports + reading the screenshots back, with
  the sweep as the authoritative gate. Fixes are layout CSS only — fixed-width
  rails (e.g. the Review Tools `w-80`) must become `w-full lg:w-80` + stack, not
  crush the main view. Shipped 2026-06-17.
- **First synthetic click after navigation can be swallowed** by the browser
  automation input layer (not the app — a DOM `.click()` works first try).

---

## 8. Appendix — the hardening commit map

**Customer-readiness loop** — `7a84d31` footprint fit/coverage/maxSqft ·
`06fde9b` landing brief box · `562a853` bath count · `94c8672` word numbers ·
`eb35e7f` uncontrolled input · `a176dc2` parse honesty/echo · `34a221f` close.

**Geometry rebuild** — `3eae0f3` envelope-clip module + battery + evidence
samples every mesh · `13bd3f4` constructive clipping replaces all heuristics ·
`1f30bcd` worst-mesh evidence + door clamp + close.

**3D quality loop** — `0e25374` delete-plan UI · `f50972d` openings cut into
walls · `b334e25` fixtures clamp + gate → 0.25 ft · `76e73ec` readability ·
`1e1a6a9` close.

**Export pass** — `be7fc2a` stored render at creation · `b9105df` SSRF fix ·
`f29f3d0` JSON-only lane · `650bda0` export packet · `0eb620b` qa gates
JSON-only lane · `ea0b3ca` close. (+ dev-compiler `99b5204`, `29f0e10`.)

**Architect polish** — `d4eeddb` honest elevations · `213884a` drawing
standards · `28d4c49` professional 3D · `9cf3c8a` consistency sweep ·
`83c8f91` close. (+ dev-compiler `2f6c904`, `08574f0`.)

**UX review** — `45edab7` customer language · `6abd28f` JSON-only elevations
pane · `f49a8c2` facade camera fit · `f454db6` real gallery thumbnails ·
`34f2bbe` lane coherence + labels · `85cfe79` self-explaining chips ·
`08638ab` close.

---

## 12. The generation-quality era (2026-06-18 → 06-20) — two phases

A later loop turned the same discipline on the **brief → plan → code-check
generation pipeline** (`gen-sweep.md` is the living log). It ran in two phases,
each closed by two consecutive clean fires with the full ladder green.

### Phase A — defect/honesty sweep (fires 1–13)

Drove diverse briefs through `/api/generate-plan` and INSPECTED the output for
plans that were wrong, misleading, or a "pass that should fail." Twelve+ defects,
each generalized to its class with a failing battery assertion, then root-caused.
The unifying class was **silent program mismatch** (input honesty, P5): the
generator silently misrepresenting the brief. Closed across **bedrooms** (refuse
over-cap), **baths** (surface a downgrade note), **sqft cap**, **orphan
setbacks/coverage** (parser surfaces them), and **roof style** (refuse, don't
substitute) — plus **egress operability** (a `fixed` window is not R310 egress →
emit `egress`, engine rejects fixed), **bathroom lavatory completeness**, and
**loft fall protection** (R312 — a loft open to below must model a guard rail).
Then two clean fires.

### Phase B — constructive frontier (fires 14–19)

Pivoted from "find what's wrong" to "build what it refuses." Same rigor: drive
the refusal, add a FAILING positive test, build with ONE constructive model that
reuses the shared machinery, verify 0 render offenders + R305 + honest elevation.
Shipped, in ascending geometric complexity:

- **flat** (one horizontal plane), **shed** (one mono-pitch plane + a mono-pitch
  elevation), **hip** (4 planes, ridge-inset → pyramid on a square), **gambrel**
  (two-pitch gable, 5-sided end), **barn** (gambrel hipped = two stacked hips via
  ONE `hipBand` helper applied twice, 8 planes). All 7 parser roof styles build.
- **4-bedroom synthesis** — a 48×28 grid-aligned plan; `starterFixtures`, the
  wall builder, and every code check already generalized from room rectangles, so
  only room rects + doors + windows were authored. a-frame 4-bed and 5+ refuse
  honestly.

### What made Phase B clean (the reusable lessons)

1. **One constructive model, degenerating, beats per-case branches.** The hip's
   ridge-inset becomes a pyramid on a square with no special case; the barn is
   the hip applied twice; the flat is the gable machinery with ridge == eave. The
   geometry consumers (`ceilingProfileForRect`, `buildElevationModel`, the clip)
   take any planar roof — give them correct planes and R305/clip/openings come
   free.
2. **Reuse beats author.** The single biggest de-risker was discovering the
   fixture/wall/check layers were already generic over room rectangles — a new
   capability only had to add geometry, not re-implement the pipeline.
3. **Make the new geometry render-legible, then leave the rest alone.** Each new
   elevation silhouette was a new model field + render branch; the gable/a-frame
   paths were never touched, so traced plans never regressed.
4. **Honest refusal is a feature, not a gap.** Where the deterministic model
   genuinely can't build sound geometry (a-frame 4-bed's eave headroom, 5+
   bedrooms, sub-cap sqft), refuse with a specific reason — never ship a plan that
   fails its own code report.
5. **The gate catches your own feature's defects too.** The 4-bed's first-pass
   room widths were off the 4 ft grid; WH-GRID-4FT caught it before commit.
   Defect discipline outranks features even when the defect is in the feature.

Outcome: a one-line brief now compiles to a sound, code-checked, honestly-drawn
plan across **7 roof styles × 1–4 bedrooms** (with optional loft where headroom
clears) — or refuses honestly. Hand-to-an-architect quality across the matrix.
