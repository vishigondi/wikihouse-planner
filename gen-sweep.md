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
- [ ] Inspect requested-sqft fidelity: footprint caps at 36×28 (~1008 sqft); a
      2400-sqft request silently shrank (now moot for >3-bed since it errors, but
      a 3-bed "1400 sqft" still yields 1008 — is that surfaced honestly?).
- [ ] Drive baths/loft/roof program fidelity the same way (does requested output
      match, or silently downgrade without surfacing?).

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
- **Commit:** _(pending push)_
