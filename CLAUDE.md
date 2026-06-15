# Floorplan Studio — working agreement

Type a one-line brief → a deterministic, code-checked floor plan an architect
can hand to a client. This file is the bar. The full reasoning behind it is
`docs/QUALITY_PLAYBOOK.md` — read that before any geometry, gate, or
generation-pipeline work.

## Before you commit

Run the gate ladder. It is one command:

```
npm run gates       # fast: batteries + build (also runs on pre-push)
npm run gates:all   # full: + live qa:brochure + interactive sweep
```

Green before commit, no exceptions. The pre-push hook runs `gates` for you;
CI runs `gates:all`. Never bypass with `--no-verify` to ship red.

## Non-negotiables (the seven principles)

1. **Replace heuristics with one constructive model.** When you're adding the
   Nth special case, the special cases are the bug. (The 3D "sail fins" were
   per-case branching; one clipping function killed them.)
2. **Evidence samples everything; untagged = failure.** A measurement scoped
   to known categories can't catch what went wrong. Every mesh is sampled;
   anything unattributable is an offender, never a gap.
3. **Gates assert MORE, never less.** Never loosen an envelope/constraint/qa
   gate to ship a feature. New invariant → new assertion. The only exemption
   (traced-plan designed-bay excess) is explicit, narrow, and logged.
4. **Separate data lanes without faking either.** JSON-only plans skip
   GPT-source checks but take the identical geometry/constraint gates. Never
   synthesize a fake source to satisfy an old gate.
5. **Input honesty — no silent drops.** Anything the parser ignores is
   surfaced to the user (echo line). Controlled inputs that re-render on async
   data eat keystrokes — keep the brief box uncontrolled.
6. **The server enforces every UI-implied invariant.** Delete guard, render
   origin: the client gate is convenience, the server gate is truth. Never
   trust a network-derived value (Host header) for an internal action.
7. **One source of truth for shared math.** Roof-plane equations are fit the
   same way in the constraint engine, the 3D clip, and the 2D elevation — so
   compliance, model, and drawing cannot disagree.

## Guardrails (absolute unless explicitly in scope)

- Semantic JSON / compiler / constraint engine: untouched.
- Traced plans (`a-frame-22`, `a-frame-bunk`, `outpost-medium`): artifacts
  never edited; must not regress visually.
- Keep `gen-001`; its stored render may be regenerated (`render:paired`), its
  JSON not.
- Every `data-*` QA hook preserved (the gates read them).
- Delete throwaway `gen-*` after testing. No deploys without being asked.

## Numeric invariants (don't change casually)

- Compiled envelope excess ≤ **0.25 ft**, **0 untagged offenders** (every plan).
- Elevation opening centers within **±0.5 ft** (compiled), **±1.6 ft** (traced).
- Geometry epsilons 1e-6/1e-7/1e-9 ft; fixture clearance 0.06 ft; skip a
  window under 0.5 ft pane height.

## Operating model for loops

One verifiable capability per fire · verify in real Chrome from the angle a
bug would hide · read canvas evidence + console, not just screenshots · full
gate ladder green before each commit · two consecutive clean fires to close.
Reusable loop prompt: `docs/HARDENING_LOOP_TEMPLATE.md`.

## Known debts (visible on purpose)

Compiled generation has no loft (`compile-plan.ts` hardcodes floor-0; parser
honestly lists "loft" as ignored). Chrome blocks a 2nd programmatic download
per session. See the playbook §7.
