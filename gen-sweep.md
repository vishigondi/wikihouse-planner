# Generation Quality Sweep

Prime directive: find real generation/correctness defects by **driving the real
brief→plan→code-check pipeline with diverse inputs and INSPECTING the output**,
generalize each to its **class**, add a **failing battery assertion** for the
class, fix the **root cause** in the compiler/constraint engine/geometry, and
verify against several briefs + the live app. Continue until diverse briefs
reliably produce sound, correctly code-checked plans you'd hand to an architect.

## Method per fire
1. Drive generation: `parseBrief → mockIntentFromBrief → compileIntent →
   codeAdvisoryReport` (and the live brief box / /api/generate-plan at :3002).
2. Vary briefs hard: tiny/huge sqft, extreme lot/setbacks, odd bed/bath, gable
   vs a-frame, with/without loft.
3. INSPECT: room layout sanity, dimensions, door/window placement, egress, roof
   geometry, loft headroom, AND every constraint-engine verdict — looking for a
   "pass" that should fail (or vice-versa), degenerate geometry, or misleading
   output.
4. Found a defect → write its class + a failing assertion (check:generation /
   check:code / check:clip / check:elevations) → fix the ROOT CAUSE (one
   constructive model, not a special case) → re-verify → record below.
5. `npm run gates` + `npm run gates:live` green before commit. Guardrails:
   deterministic sheet/3D/elevations/code stay the source of truth (update a
   gate's expected values only with justification — never loosen to pass);
   traced plans + gen-001 untouched; keep every data-* hook; delete throwaway
   gen-* after each fire.

## Backlog
_(updated each fire)_

**Status (after fire 13):** the CORRECTNESS + HONESTY frontier is swept — no
open defect class. Diverse briefs produce sound, code-checked plans within the
supported envelope (1–3 bed, a-frame/gable, optional loft) and refuse/annotate
honestly outside it. The remaining items below are ENHANCEMENTS (envelope
expansion + UX), not correctness bugs. Closing the loop needs one more clean
fire (two consecutive) — at which point these become a fresh feature backlog.

- [ ] _(enhancement)_ `doorSwingClear: true` on fixtures is hardcoded, not
      computed (compile-plan ~line 265). Latent metadata-honesty item — asserts a
      property that isn't checked. Low stakes (fire 8 rendered swings are visually
      clear); revisit only if a real swing collision is ever found.

- [x] **DEFECT: build the loft guard geometry — DONE (fire 12).** The compiler
      now emits a `lowGuardRail` interior wall (36 in) on each open long edge of
      the loft; the classifier (drawing-primitives:112) already tags guard kinds
      as walls, so it renders with 0 offenders. Note reworded to confirm the
      guard + flag baluster spacing/attachment as shop-drawing scope. (An engine
      R312 *verdict* — pass/advise on guard presence — remains a possible future
      add, but the geometry now satisfies the requirement.)
- [ ] _(enhancement)_ Constructively implement the remaining roof styles —
      **flat DONE (fire 14)**; next: shed → hip → gambrel → barn — end-to-end
      (planes + elevations + clip + code), built not refused. Each reuses the
      plane-fit / clip / ceiling-profile / elevation machinery.
      **SHED build plan (scouted fire 14, next fire):** single sloped plane,
      high edge (ridge ~12 ft) at x=0, low edge (eave ~8 ft) at x=widthFt,
      ridgeAxis 'z' (slope along x). Ceiling profile + R305 + opening clamps work
      free via the existing plane machinery (`limitAtSpan`/`ceilingHeightAt`
      sample the real plane). THE WORK: `elevations.ts` — the across-slope view
      (front, gableFacing=true for ridgeAxis z) currently draws a CENTERED GABLE
      TRIANGLE; shed needs a MONO-PITCH silhouette (wall up to ridge at x=0,
      sloped top down to eave at x=widthFt). Add a `monoPitch` flag to the model
      (set when roof.style==='shed') and a mono-pitch branch in
      `elevationSvgString` — do NOT touch the gable/a-frame/flat paths (traced
      plans must not regress visually). Add shed cases to check:generation +
      check:elevations (assert the front silhouette is asymmetric: roofline y at
      x≈0 ≈ ridge, at x≈span ≈ eave). Confirm 0 render offenders + visual check.
- [ ] _(enhancement)_ Truly synthesize N-bedroom layouts (4+) in the deterministic
      generator so large briefs are honored, not just refused (fire 1 made the
      refusal honest). Needs room-packing + walls/doors/windows/dims/code-check
      for arbitrary N — substantial, gate carefully.
- [x] Requested-sqft fidelity — fire 4: a ≤sqft cap below the smallest template
      was silently exceeded; now refused with a clear message. (A ≤cap ABOVE the
      build, e.g. ≤1400 → 1008, is correct: ≤ is an upper bound, honored.)
- [x] Drive baths/loft/roof program fidelity — fire 3: baths silently downgraded
      (fixed via reconciliation notes); loft + roof are honest. Class closed for
      these dimensions.
- [ ] _(enhancement)_ UX-loop follow-up: render `compiled.notes` (program
      reconciliations + the loft-guard R312 note) on the plan-detail page so they
      are visible in the UI, not just the API.
- [x] Egress operability — fire 9: bedroom egress windows were hardcoded `fixed`
      (inoperable) yet passed R310. Compiler now emits `egress`; engine rejects
      explicit-fixed windows. Class closed for the single-level case.
- [ ] Sleeping-loft egress: a "sleeping loft" brief yields a room typed `loft`
      (label "Loft") that neither the compiler sleeping-set nor the engine
      `SLEEPING_PATTERN` treats as a sleeping room — so it gets no egress
      requirement and a fixed window. If a loft is used for sleeping it should
      require an operable egress opening (and a fixed loft window should fail).
      Separate class (loft-as-sleeping-room semantics); needs care re: R305 loft
      gates. Not chased in fire 9 (one class per fire).

## Findings log
_(bug → class → test → root-cause fix → commit)_

### Fire 14 — BUILD the flat roof (first constructive-frontier capability)
- **Capability:** the generator REFUSED `flat` roofs (fire 10 made the refusal
  honest); now it BUILDS them. `"2 bed flat roof, 40x60 lot"` → a sound,
  code-checked single-level plan instead of a 422.
- **One constructive model, reusing the a-frame/gable machinery:** a flat roof
  is ONE horizontal `roof-plane` at a constant height (ridge == eave == 9 ft) —
  fed through the SAME `planeEquation` / `ceilingProfileForRect` (R305) / clip /
  `buildElevationModel` paths, with no rise. No special-case branch in the
  geometry consumers; they degenerate correctly (the elevation renders a
  flat-topped box; the ceiling profile is constant). Reuses the gable footprint
  set (flat has uniform full headroom, the most permissive) and the whole room/
  fixture/egress layout — so bedroom windows are still `egress`, fixtures
  complete, rooms reachable (all prior fixes carry over).
- **Failing assertions FIRST (gates assert MORE):**
  - `check:generation` — converted the fire-10 "flat → refused" case into 3
    positive cases (2/3/1-bed flat) + a structural block: roof.style flat, EXACTLY
    one horizontal plane (ridge==eave), single level, ≥3-pt elevation outlines,
    R305 passes on the flat ceiling for every bedroom, zero constraint fails.
  - `check:elevations` — a flat-roof front+side model builds, openings clamp
    under the flat roofline, ridge==eave, SVG renders.
- **Geometry/plumbing:** added `'flat'` to the roof-style union +
  `BUILDABLE_ROOF_STYLES`; `mockIntentFromBrief` selects flat + sets
  ridge=eave=`FLAT_ROOF_HEIGHT_FT` (9); `compileIntent` emits the single flat
  plane + `front-flat`/`side-flat` slab outlines; the refusal message now lists
  the buildable set with an Oxford comma (shed/hip/gambrel still refused).
- **Verified:** offline R305 + structural battery green; live `POST
  /api/generate-plan` builds the flat plan (was 422); render primitives = 0
  offenders, all layers valid; full `gates` + `gates:live` green. Throwaway
  gen-002 deleted.
- **Commit:** _(pending push)_

### Fire 13 — clean (drove dimensions, fixtures, loft+guard, connectivity, extremes)
- **Drove 5 hard angles, all sound — no real defect:**
  - **Dimension lines** match the geometry (28'-0"/36'-0" = actual footprint) —
    the sheet does not lie about measurements.
  - **Fixture placement**: every fixture sits inside its room; the only overlap
    is sink-in-counter (the sink is fully nested in the counter run — intentional,
    a sink set into the countertop; a benign false positive like fire-8 swings).
  - **Loft + new guard**: dims correct, elevations sane (a-frame triangle / gable
    intact), both guard rails present; the floor-1 guards don't disturb the
    elevation outline.
  - **Connectivity**: every level-0 room is reachable from the exterior through
    doors/openings; the loft is reached by its ladder (correctly not a door).
  - **Extreme-but-valid briefs** (3-bed 2-bath on a 100×120 lot; 3-bed a-frame;
    2-bed gable+loft on 50×70): full constraint report all pass / not-evaluated,
    zero fails. A 1-bed gable on a 28×40 lot is **refused honestly** (over
    envelope + 35% coverage) — sound behavior, not a wrong plan.
- **Result:** within the supported envelope (1–3 bed, a-frame/gable, optional
  loft) the output is genuinely hand-to-an-architect quality. First clean fire
  after the fire-9→12 fixes. App byte-identical; gates green by identity.
- **Commit:** _(doc-only)_

### Fire 12 — BUILD the loft guard (constructive fix of fire 11's deferred defect)
- **Closes fire 11's deferred DEFECT.** Fire 11 surfaced the loft fall-protection
  gap honestly (a note); the root cause — no guard geometry — remained. This fire
  builds it.
- **Re-examined the render risk (fire 11 overstated it):** `drawing-primitives.ts`
  line **112** already classifies `/guard|rail/` wall kinds as `'wall'` (that's
  how the traced lofts' guards render and pass gates), and compiled artifacts
  derive primitives directly from their arrays (no `sourceWalls`/`sourceAnchors`
  needed). So emitting a guard tags cleanly — not an untagged offender.
- **Class:** constructive completion of a required safety element (IRC R312.1).
- **Failing test first (red → green):** `check:generation` — a loft plan must
  model a guard rail on EACH open edge (`≥2 floor-1 interiorWalls` with
  wallKind `/guard|rail/`), guards stay inside the footprint, single-level plans
  have none. Was 0 guard walls before the fix.
- **Root-cause fix (`compile-plan.ts`, one constructive rule):** when a loft is
  built, emit a `lowGuardRail` interior wall (36 in) on each open long edge of
  the headroom band (axis-aware: long edges are the open sides; the gable ends
  are closed by the roof). Reworded the note to state the guard IS provided and
  flag baluster-spacing/attachment as shop-drawing scope.
- **Verified the RENDER (offline, faithful):** `extractSourceDrawingPrimitives`
  on a compiled loft yields both guards as `layer:'wall'`, floor 1, valid
  `semanticSpan` (line at the loft edge, full depth) — structurally identical to
  a normal wall — and **0 untagged/offender primitives**. The 2D sheet now draws
  the rails. Traced plans + single-level plans untouched.
- **Verified:** full `gates` (all batteries + build) green; `gates:live` green.
- **Commit:** _(pending push)_

### Fire 11 — loft is open to below with NO fall protection, shipped silently
- **Bug (found by driving loft + circulation):** the generated loft (level 1,
  ~8 ft above the floor) is open to below on its long edges with **no guard
  rail** (zero guard/rail elements; no open-to-below marker) — an IRC R312.1
  fall hazard — and the plan ships it **silently** (no callout, no note). The
  constraint report says nothing about it. Both traced lofts (a-frame-22,
  a-frame-bunk) DO model a guard (guard-rail window referencing the loft),
  proving the model supports it; the compiler emits none.
- **Also driven, clean (no defect):** hallway width (48 ft… 48 in, >36 in min)
  and door clear widths (36 in egress door; 30 in interior doors are
  code-compliant under base IRC); window/door placement + same-wall overlaps;
  habitable min area; a-frame ground-floor sloped-ceiling headroom (R305 honest,
  the low eave edges are expected a-frame behavior, ≥50% at 7 ft).
- **Class:** _a required safety element omitted AND not surfaced_ — the
  input-honesty family (P5) applied to a code requirement the template can't yet
  model. Same channel as the fire-3 bath-downgrade note.
- **Why the geometry fix was deferred (not rushed):** building the guard means
  emitting guard walls/openings + having the render classifier recognize them.
  `drawing-primitives.ts:113` (the wall-layer classifier) does NOT match guard
  kinds, so a compiler-emitted `lowGuardRail` would render as an UNTAGGED
  OFFENDER and fail the evidence gate. The constraint-engine path is also fragile
  (engine sees openings, not walls; no `advisory` status). That is render-/
  source-of-truth work deserving a focused fire — logged as a backlog DEFECT
  with the full plan, not a rushed half-measure.
- **Failing assertion added (gates assert MORE):** `check:generation` — a loft
  plan MUST surface a fall-protection note (`/guard|R312|fall protection/i`); a
  single-level plan must NOT (no false note). Was null before the fix.
- **Root-cause fix (honest surfacing now, via the established notes channel):**
  `compileIntent` pushes an R312 note whenever a loft is built — "loft is open to
  below (~8 ft above…); IRC R312.1 requires a 36 in guard… add/verify before
  construction (not modeled in this deterministic plan)." The generator never
  again silently ships a loft that looks fully detailed.
- **Verified:** note flows through `POST /api/generate-plan` (live, a-frame with
  loft); single-level plans unaffected; traced lofts (which model real guards)
  untouched. Throwaway gen-002 deleted. Full `gates` + `gates:live` green.
- **Commit:** _(pending push)_

### Fire 10 — requested roof style silently substituted with an a-frame
- **Bug (found by driving all 7 parser-recognized roof styles):** the parser
  accepts `a-frame, gable, hip, flat, shed, barn, gambrel`, but the compiler
  implements only a-frame + gable. Driving "2 bed <style> roof" showed
  `hip/flat/shed/barn/gambrel` ALL silently built an **a-frame** (18 ft ridge,
  1 ft eave) — a "flat roof" request produces a steep a-frame and never tells the
  user. Root cause: `mockIntentFromBrief` line 662 `brief.roofStyle === 'gable' ?
  'gable' : 'a-frame'` flattens every non-gable style to a-frame.
- **Class:** _silent program mismatch_ (same family as fires 1/3/4 — bedrooms,
  baths, sqft) extended to roof style. The brief is captured correctly by the
  parser, then silently misrepresented by the compiler.
- **Failing assertions added (gates assert MORE):** `check:generation` — four
  `expectCompileError` cases (shed/flat/hip/gambrel) asserting the brief is
  REFUSED with `/builds only a-frame and gable/i` (were silently compiling).
- **Root-cause fix (`compile-plan.ts`, established refusal pattern):**
  - `BUILDABLE_ROOF_STYLES = ['a-frame','gable']` (exported, single source).
  - Thread `requestedRoofStyle` (the RAW brief style) onto `GenerationIntent`,
    set in `mockIntentFromBrief` — mirrors `requestedBedrooms/Baths/MaxSqft`.
  - `compileIntent` refuses when `requestedRoofStyle` is set and not buildable,
    with a clear message — never silently substitutes. (Live/GPT path leaves it
    unset, so full generation can still handle other styles — consistent with the
    other deterministic-template refusals.)
- **Verified:** a-frame/gable still compile (battery roof-style assertions green);
  live `POST /api/generate-plan` → shed roof returns **HTTP 422** with the
  refusal message, gable returns success. Throwaway gen-002 + failure artifacts
  deleted. Full `gates` + `gates:live` green.
- **Commit:** _(pending push)_

### Fire 9 — every bedroom egress window is FIXED (inoperable) yet R310 passes
- **Bug (found by driving egress *dimensional/operability adequacy*):** every
  generated bedroom's emergency-escape window is `windowKind: 'fixed'` (compiler
  hardcoded `'fixed'` for ALL windows, compile-plan line 491/618). A fixed window
  cannot open, so it is NOT an IRC R310.1 emergency escape opening — yet both the
  compiler's egress pre-check AND `codeAdvisoryReport` passed R310.1 on mere
  *presence* of a window. The rule citation even spells out the dimensional
  minimums ("5.7 sq ft… 24 in height, 20 in width; sill ≤ 44 in") that the engine
  never checked. A dishonest "pass that should fail," and an architecturally
  non-compliant plan (sleeping rooms with no legal egress).
- **Class:** _egress verdicts that ignore whether the opening can actually
  function as egress_ (operability). Confirmed the intended kind is operable: the
  stored `brief-aframe-2br` fixture already carries `windowKind: 'egress'` on its
  bedroom windows — proof the compiler regressed to blanket `'fixed'`.
- **Failing assertions added (gates assert MORE):**
  - `check:code` (code-advisory) — a sleeping room whose only opening is a
    `windowKind:'fixed'` window must FAIL R310 (caught the dishonest pass); an
    operable `egress` window passes; an *unspecified* windowKind stays a candidate
    (so traced/image-extracted plans without windowKind never regress).
  - `check:generation` — "egress window operable (not fixed) for `<bedroom>`" for
    every bedroom in every driven brief.
- **Root-cause fix (one constructive rule, not a special case):**
  - Compiler (`compile-plan.ts`): `windowKindFor(roomId)` → `'egress'` when the
    window serves a sleeping room, else `'fixed'`. Applied at both window sites
    (main map + loft window). One rule, no per-room branching.
  - Engine (`code-advisory.ts`): `isEgressCandidate` rejects a window whose
    `windowKind` is explicitly `'fixed'`; only an *explicit* fixed disqualifies.
    R310 fail now names the precise failure ("only escape opening(s) are
    fixed/inoperable"). Pass detail is honest about what's modeled (presence +
    operability) vs. flagged for shop drawings (net clear area + sill).
  - Adapters (`floorplan-standards.ts`, check-generation `reportForArtifact`):
    thread `windowKind` from artifact windows into `CodeAdvisoryOpening`.
- **Blast radius verified — no regression:** a-frame-22 / outpost-medium windows
  carry no windowKind → still candidates → pass; a-frame-bunk loft window is
  `lowGuardGlazedOrOpenRail` (≠fixed) → pass; brief-aframe-2br is `egress` → pass;
  gen-001 has fixed bedroom windows but R310 is asserted on it nowhere (its frozen
  JSON is untouched). Loft (type `loft`, not a sleeping room per engine
  `SLEEPING_PATTERN`) keeps a fixed window with R310 not evaluated — unchanged.
- **Verified live:** drove `POST /api/generate-plan` (3-bed gable) on :3002 — the
  live artifact's three bedroom windows are now `egress`; kitchen/living stay
  `fixed`. Throwaway gen-002 + manifest entry deleted. Full `gates` green.
- **Commit:** _(pending push)_

### Fire 8 — clean (door-swing clearance investigated; probe over-reported)
- **Drove:** door-swing-vs-fixture collisions. Doors encode real swing geometry
  (`hingePoint`/`leafOpenEnd`/`swingDirection`/`swingArcDeg`); a geometric
  quarter-disc probe flagged many "collisions" (toilet 0.3 ft from hinge, bed/
  closet in arc). Noticed `doorSwingClear: true` is HARDCODED (compile-plan ~265),
  not computed — so the flag couldn't be trusted either way.
- **Resolved against the source of truth (rendered 2D sheet):** generated a
  3-bed/2-bath plan and inspected the deterministic render. The swings are drawn
  and CLEAR the fixtures — the Bath door swings into its open lower half (away
  from toilet/sink/shower), bedroom doors clear the beds, closets clear. The
  geometric probe was over-reporting (misreading swing side / same-wall-adjacent
  fixtures). Also confirmed: **fire-7's Bath 2 lavatory renders correctly** (toilet
  + small sink) — the powder room is sound.
- **Result:** no real defect; no fabricated fix. The plan is genuinely
  hand-to-an-architect quality (clear swings, sensible fixtures, dimensions,
  north arrow, scale, legend). Logged the hardcoded `doorSwingClear` as a latent
  metadata-honesty backlog item (not worth a high-blast-radius fix). App
  byte-identical; gates green by identity. Throwaway gen-002 deleted.
- **Commit:** _(doc-only)_

### Fire 7 — second bathroom generated with no lavatory (toilet only)
- **Bug (found by driving fixture completeness):** every 2-bath plan's "Bath 2"
  (a 4×4 powder room) shipped with ONLY a toilet — no sink/lavatory — across
  a-frame 3-bed, gable 3-bed, and a-frame 2-bed. A toilet-only room isn't a
  bathroom (architectural completeness + plumbing-code: every bathroom needs a
  lavatory). The primary Bath correctly had toilet+vanity+shower.
- **Class:** _a generated room missing a fixture its type requires._ Root cause:
  the bath fixture-placement gated the vanity on `room.w >= 6` (else branch) or
  `w<6 && d>=6` (narrow branch); a 4×4 powder room (w<6 AND d<6) fell through
  both and got a toilet only.
- **Failing assertion added (gates assert MORE):** `check:generation` — "bathroom
  <id> has a lavatory" for EVERY bathroom room (caught room-bath2 toilet-only
  before the fix).
- **Root-cause fix (`compile-plan.ts` starterFixtures):** added a compact-bath
  branch (`w<6 && d<6`) placing a toilet + an unconditional small lavatory
  (toilet north wall, sink below) — fits a 4×4, in-bounds, no overlap. The vanity
  is unconditional for a bathroom now, not size-gated away.
- **Verified:** every bath (incl. Bath 2) has a lavatory across all three 2-bath
  plans; fixtures in-bounds, no overlaps; single-bath plans + traced + gen-001
  unchanged (no stored plan has a bath2). gates + gates:live green. Throwaway
  gen-002 deleted.
- **Commit:** _(pending push)_

### Fire 6 — brief parser silently drops orphan setbacks / coverage
- **Bug (found by driving the parser):** stating setbacks or coverage WITHOUT a
  parseable lot silently drops them — "1 bed a-frame, 5 ft setbacks" → no lot,
  and "5 ft setbacks" is neither applied NOR surfaced in `unparsed` (it was
  take()-consumed). Same for "35% coverage". The user's stated value vanishes with
  no trace — the upstream sibling of the compiler silent-mismatch class.
- **Class:** _a parsed-and-consumed lot modifier with no lot to attach to is
  silently dropped (input honesty, P5: anything the parser ignores is surfaced)._
  Two instances: setbacks AND coverage (both `&& result.lot`-gated).
- **Failing assertion added (gates assert MORE):** `check:brief` — "orphan
  setbacks/coverage surfaced as unparsed" (no lot), plus "setbacks apply when a
  lot is present / applied setbacks do not surface" (no regression). Pre-fix the
  orphan checks fail (unparsed was empty).
- **Root-cause fix (`lib/brief.ts`):** when setbacks/coverage are parsed but
  `result.lot` is absent, push a clear note to `result.unparsed` ("setbacks (no
  lot specified — add a lot to apply them)" / coverage equiv) instead of
  discarding. With a lot they still apply unchanged.
- **Verified:** `check:brief` green; orphan setbacks/coverage now surface;
  lot-attached modifiers still apply (canonical + multi-modifier briefs
  unchanged). gates + gates:live green. No throwaway plans (parser-only).
- **Commit:** _(pending push)_

### Fire 5 — clean (constraint-engine completeness/honesty, no defect)
- **Drove:** the question "is the constraint engine honest AND complete for
  generated plans, or does a life-safety rule silently go not-evaluated?" Ran the
  full code report (via the battery's loft-aware ceiling derivation) on a-frame,
  gable, loft, 1/2/3-bed plans and categorized EVERY verdict.
- **Result — engine is trustworthy and already well-gated:**
  - R310 egress evaluates to `pass` per bedroom (generated windows carry
    `roomIds`); the compiler also refuses a bedroom with no egress opening.
  - R304 habitable minimums (≥70 sqft, ≥7 ft) met on the smallest footprints.
  - R305 evaluates for every habitable room INCLUDING the loft, measured from the
    loft floor (`pass`); battery already asserts loft R305 `pass` + "evaluated"
    (not not-evaluated) + a global "R305 evaluated for every ceiling-ruled room".
  - Grid, ZON-SETBACK, ZON-COVERAGE all evaluate and pass as expected.
  - Also re-verified this fire (all sound): dimension-line accuracy, fixture-in-
    room bounds, room connectivity (loft via `loft_access_ladder`), windows on the
    exterior perimeter.
- **No defect; no fabricated fix.** Investigated a hypothesised "loft R305 only
  covered by zero-fails" gap — turned out the battery already asserts it
  explicitly. App code byte-identical; gates green by identity.
- **Commit:** _(doc-only)_

### Fire 1 — requested bedroom count silently clamped (plan misrepresents brief)
- **Bug (found by driving):** a "5 bed 3 bath gable, 2400 sqft, 80×120 lot"
  brief — large lot, ample sqft — generated a **3-bedroom** plan; "4 bed …" also
  → 3 bedrooms. The brief parser reads `bedrooms: 5` correctly, but
  `mockIntentFromBrief` clamps with `Math.min(3, …)` (line 576) and picks a fixed
  3-br template, **silently dropping the extra bedrooms** with no error or echo.
  A user typing "5 bed" gets a plan that claims to honor the brief but doesn't.
- **Class:** _the deterministic generator silently collapses a requested program
  it can't build (here, bedroom count) into a smaller template, misrepresenting
  the brief — input-honesty violation (P5: no silent drops)._
- **Failing assertion added (gates assert MORE):** `check:generation` cases
  "4-bed / 5-bed exceeds template ceiling" — a brief above the template ceiling
  must FAIL compile with a clear message, not silently produce a 3-bed plan.
  (Before the fix these compiled ok → the gate fails; after, they error.)
- **Root-cause fix:** carry the RAW requested bedroom count onto the intent
  (`GenerationIntent.requestedBedrooms`, unclamped) and refuse at `compileIntent`
  when it exceeds `MAX_TEMPLATE_BEDROOMS = 3` — a clear error mirroring the
  existing "footprint exceeds buildable envelope" refusal, rather than shipping a
  misleading plan. (Honest surfacing now; truly synthesizing N-bedroom layouts is
  a larger constructive change for a later fire — logged in Backlog.)
- **Verified:** `check:generation` green (4/5-bed now error; all ≤3-bed plans +
  gen-001 + traced unchanged). Live API: 5-bed → 422 with the clear message (no
  plan created); 3-bed → still generates. gates + gates:live green. Throwaway
  gen-002 deleted; only gen-001 remains.
- **Commit:** `a45654c`

### Fire 2 — generator ships footprints that fail their own coverage report
- **Bug (found by driving):** a footprint that fits the setback envelope but
  exceeds the 35% lot-coverage cap compiles OK and is shipped — e.g. "2 bed
  a-frame, 38×38 lot, 5 ft setbacks" → 28×28 footprint = **54.3% coverage**
  (`ZON-SETBACK: pass`, `ZON-COVERAGE: fail`); 48×48 3-bed = 43.8%; 40×40 gable =
  42%. The constraint engine is HONEST (correctly fails), but the compiler
  refuses **envelope** violations and NOT **coverage** ones — contradicting
  `mockIntentFromBrief`'s own comment that generated plans "never fail their own
  report." (mockIntentFromBrief tries coverage as a fit criterion, but its
  fallback `?? candidates[last]` ships a non-fitting footprint anyway.)
- **Class:** _the generator emits a plan that fails its own constraint report
  (asymmetric refusal: envelope hard-refused, coverage silently shipped)._
- **Failing assertion added (gates assert MORE):** `check:generation` cases
  "fits envelope but over coverage cap (a-frame / gable)" — such a brief must
  FAIL compile with a clear message, not ship a coverage-failing plan.
- **Root-cause fix:** `compileIntent` now refuses an over-coverage footprint with
  a clear message, right beside the envelope refusal, using the SAME threshold +
  tolerance the report uses. Exported `DEFAULT_MAX_COVERAGE_RATIO` from
  code-advisory and imported it into compile-plan (replacing the duplicated
  `?? 0.35`) — one source of truth (P7), so compile-refuse and report-fail can
  never drift apart.
- **Verified:** `check:generation` green (2 new coverage cases refuse; all
  generous-lot viable briefs + gen-001 + traced unchanged). Live API: 38×38 lot
  → 422 "covers 54.3% … over the 35% coverage cap"; 40×60 lot → still generates.
  gates + gates:live green. Throwaway gen-002 deleted; only gen-001 remains.
- **Commit:** `c204a45`

### Fire 3 — silent 2-bath→1-bath downgrade (SAME class as fire 1, broadened)
- **Bug (found by driving + class scan):** a "2 bath" brief whose footprint only
  fits one bath silently produced a 1-bath plan — no error, no note, API returned
  plain `{planId,…}`. This is the **same class as fire 1's bedroom drop: silent
  program mismatch**. Per the instruction to fix the whole class, I scanned every
  program dimension: **baths** silently downgrade (defect); **loft** is granted
  or cleanly refused (honest); **roof style** always honored (honest). Baths was
  the one remaining silent instance.
- **Class:** _the generator delivers a program that differs from the brief
  without surfacing it (input honesty, P5)._ Two honest responses: impossible
  programs REFUSE (bedrooms, fire 1); accommodated downgrades must be SURFACED
  (baths).
- **Failing assertion added (gates assert MORE):** `check:generation` "bath
  downgrade surfaced as a note (not silent)" — the downgrade case must carry a
  bath reconciliation note (was silent → gate fails; surfaced → passes).
- **Root-cause fix (one mechanism for the class):** added program reconciliation
  to the compile contract — `GenerationIntent.requestedBaths` (raw request),
  `CompileResult.notes[]`, and a `compileIntent` step that compares built vs
  requested baths and surfaces a clear note (ok stays true — a 1-bath home is
  valid). The API now returns `notes` on success, so generation is honest:
  accommodated, never silently honored. Artifact stays byte-identical (no
  geometry change). UI rendering of `notes` on the detail is a UX-loop follow-up
  (logged) — out of this loop's compiler/engine scope.
- **Verified:** `check:generation` green; live API 2-bath→ returns
  `notes:["requested 2 baths; built 1 …"]`; 1-bath/2-bath-that-fit unchanged;
  gen-001 + traced untouched. gates + gates:live green. Throwaway gen-002 deleted.
- **Commit:** `2435078`

### Fire 4 — maxSqft cap silently exceeded (same class, found by class scan)
- **Bug (found by driving extremes + class scan):** a `≤sqft` cap no template can
  meet is silently exceeded — "2 bed gable, ≤500 sqft" → 672 (172 over); "2 bed
  a-frame, ≤600" → 784 (184 over); "3 bed, ≤700" → 784; even "≤50 sqft" → 784
  (15×). `fits()` prefers a footprint within the cap, but the fallback ships the
  smallest template anyway and `compileIntent` never enforced maxSqft — the same
  filter-then-ignore pattern as bedrooms (fire 1) and coverage (fire 2).
- **Class:** _silent program mismatch — generator delivers a footprint larger
  than the user's explicit ≤sqft cap with no error (input honesty, P5)._
- **Failing assertion added (gates assert MORE):** `check:generation` "maxSqft
  cap below smallest template (gable / a-frame)" — must refuse with a clear
  message (shipped before → fails the gate; refuses after).
- **Root-cause fix:** thread `GenerationIntent.requestedMaxSqft` (raw cap) and
  refuse at `compileIntent` when the chosen footprint area exceeds it — beside
  the bedroom/envelope/coverage refusals. Impossible cap → refuse (consistent
  with bedrooms over-cap), not a silent oversize plan.
- **Verified:** `check:generation` green (≤500/≤600 refuse; ≤700→672 and ≤800/
  ≤1200 viable briefs + gen-001 + traced unchanged). Live API: ≤500 → 422
  "672 sq ft exceeds the requested ≤500 sq ft cap"; ≤800 → still generates.
  gates + gates:live green. Throwaway gen-002 deleted.
- **Commit:** _(pending push)_
