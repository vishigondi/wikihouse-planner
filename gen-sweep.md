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
