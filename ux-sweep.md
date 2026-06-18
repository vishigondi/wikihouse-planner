# UX Sweep

Prime directive: find real usability bugs by **driving the live app and clicking
things**, generalize each to its **class**, add a **failing test/assertion** for
the class, fix the **root cause**, and verify in real Chrome. Continue until the
backlog is empty and the app is genuinely usable. (See memory: ux-bug-prime-directive.)

## Method per fire
1. Drive a real flow in real Chrome (localhost:3002) — click, type, navigate.
2. read_console_messages after each batch (errors are bugs).
3. Found a bug → write its class + a failing gate assertion (offline battery or
   the interactive sweep) → fix the root cause → re-verify → screenshot to
   artifacts/customer-readiness/ux-*.
4. gates + gates:live green before commit. Guardrails: deterministic /
   consistency / responsive / data-* invariants intact; no gate loosening.

## Surfaces to drive
- Home feed `/`: search, filters, brief box → Generate, card Open/Repair/Delete,
  New Plan Handoff.
- Plan detail `/?home=<id>`: plan-selector prev/next + dropdown, VIEW controls
  (Plan Top / BIM 3D / Cutaway / Front / Side / Roof / White, Ground/Loft/All),
  Compare/Semantic, action bar (New Plan, Import JSON, Export, Look Render,
  Repair, Delete), Review Tools panels.
- Modals: New Plan, Import, Export, Look Render (mode/look/copy), Repair.

## Backlog
_(updated each fire)_

- [ ] Drive plan-detail VIEW controls deeply: Side view, Roof/White toggles,
      Ground/Loft/All level switch, Plan Top vs Cutaway parity.
- [ ] Drive Compare ↔ Semantic toggle on a paired plan and a JSON-only plan.
- [ ] Drive the modals end-to-end: New Plan, Import JSON (bad + good payload),
      Export, Look Render (mode/look/copy), Repair — focus traps, escape, copy.
- [ ] Drive home-feed search + the five filter dropdowns (empty-result state).
- [ ] Drive card Open / Repair actions and New Plan Handoff.
- [ ] Confirm no other destructive/irreversible action fires on a single click
      (audit every onClick that mutates/deletes/exports/navigates-away).

## Findings log
_(bug → class → test → root-cause fix → commit)_

### Fire 1 — destructive Delete fired with no confirmation
- **Bug (found by clicking):** "Delete Plan" (plan-detail header) and "Delete"
  (home feed card) removed a plan **instantly on a single click** — one misclick
  = permanent data loss, no undo.
- **Class:** _destructive / irreversible action triggered by a single
  unconfirmed click._ Both delete sites shared the same one-click `onClick`.
- **Failing assertion added (gates assert MORE):** interactive sweep step (4b)
  in `scripts/final-interactive-sweep.mjs` — a single click on a `[data-delete-plan]`
  control must set `data-armed="true"`, relabel to a confirm prompt, and leave
  the feed-card count UNCHANGED (never sends the second/confirming click, so no
  real plan is deleted by the gate).
- **Root-cause fix:** new shared `ConfirmButton` component (two-step arm→confirm,
  3.5s auto-disarm, `onBlur` disarm, `data-armed` attr; preserves the
  `data-delete-plan` hook). Applied to BOTH delete sites — symptom fixed at the
  one place that produced the whole class. NOT a native `confirm()` (that would
  block the MCP extension); inline confirm UI instead.
- **Verified in real Chrome (localhost:3002):** feed card → click once → "Confirm?"
  armed, cards 6→6 (no delete); detail header → click once → "Confirm delete?"
  armed, still on `?home=gen-001`; second click within window → plan deleted →
  routed back to feed. No console errors. Artifacts:
  `artifacts/customer-readiness/ux-fire1-delete-confirm-{detail,feed}.png`.
- **Commit:** _(pending — after gates + gates:live green)_
