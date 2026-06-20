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

- [ ] `doorSwingClear: true` on fixtures is hardcoded, not computed (compile-plan
      line ~265). Latent metadata-honesty item — the field asserts a verified
      property that isn't checked. Low stakes (fire 8 rendered swings are visually
      clear); revisit only if a real swing collision is ever found.

- [ ] Truly synthesize N-bedroom layouts (4+) in the deterministic generator so
      large briefs are honored, not just refused (fire 1 made the refusal honest;
      the constructive model is the bigger win). Needs room-packing + walls/doors/
      windows/dims/code-check for arbitrary N — substantial, gate carefully.
- [x] Requested-sqft fidelity — fire 4: a ≤sqft cap below the smallest template
      was silently exceeded; now refused with a clear message. (A ≤cap ABOVE the
      build, e.g. ≤1400 → 1008, is correct: ≤ is an upper bound, honored.)
- [x] Drive baths/loft/roof program fidelity — fire 3: baths silently downgraded
      (fixed via reconciliation notes); loft + roof are honest. Class closed for
      these dimensions.
- [ ] UX-loop follow-up: render `compiled.notes` (program reconciliations) on the
      plan-detail page so the downgrade is visible in the UI, not just the API.

## Findings log
_(bug → class → test → root-cause fix → commit)_

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
