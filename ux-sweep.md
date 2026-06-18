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
- [x] Drive the modals end-to-end: dismissal (Escape / backdrop / Close) fixed
      fire 2. STILL TODO: Import JSON bad-payload error surfacing, Look Render
      copy-to-clipboard + mode/look toggles, focus-trap/initial-focus.
- [x] Drive home-feed search + filters: empty-result state IS handled ("No plans
      match those filters…"). NEW candidate found → backlog item below.
- [ ] Filter/search over-filtered state has NO one-click reset: the empty-state
      copy says "Clear a filter" but there's no Clear-all button; user must
      manually reset the search + up to 6 dropdowns. Add a Clear-filters
      affordance (class: filtered state needs a reset).
- [ ] Search box + all 6 filter selects lack data-* QA hooks (only the brief box
      has one) — add hooks so gates can drive search/filter directly.
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
- **Commit:** `eeb9de2`

### Fire 2 — workflow modals couldn't be dismissed by Escape or backdrop
- **Bug (found by clicking):** opening any workflow dialog (Import JSON shown)
  and pressing **Escape** left it open; **clicking the dimmed backdrop** left it
  open. The only way out was the single "Close" button — every other app trains
  users to press Esc or click outside.
- **Class:** _overlay modal offers no standard dismissal (Escape / click-outside)._
  All five dialogs (New Plan, Import, Export, Look Render, Repair) render through
  ONE shared `WorkflowModal` shell, so the missing affordance was the whole class
  at a single root.
- **Failing assertion added (gates assert MORE):** interactive sweep step (7b) —
  for every one of the five dialogs: Escape closes it, a backdrop click closes
  it, the Close button closes it, AND a click INSIDE the panel does NOT close it
  (stopPropagation guard).
- **Root-cause fix (`WorkflowModal`):** (1) a `keydown`→Escape `useEffect`
  (placed before the `if (!dialog) return null` guard for stable hook order,
  no-ops while closed); (2) `onClick={onClose}` on the `.fixed.inset-0` backdrop
  with `onClick={e => e.stopPropagation()}` on the panel so inside clicks are
  safe; (3) added `role="dialog"`, `aria-modal`, and durable
  `data-modal-backdrop` / `data-workflow-modal` QA hooks.
- **Verified in real Chrome (:3002):** Import + Look Render driven by hand
  (Escape closes, backdrop closes, inside-click stays); Playwright pass confirms
  all 5 dialogs `{esc, backdrop, insideStays}` true. No console errors. Artifact:
  `artifacts/customer-readiness/ux-fire2-modal-dismiss.png`.
- **Commit:** _(pending — after gates + gates:live green)_
