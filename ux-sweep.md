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
      fire 2; Import JSON bad-payload surfaces a clear parse error (verified good,
      fire 3); copy-to-clipboard feedback fixed fire 3. STILL TODO: Look Render
      mode/look toggles. Modal focus-trap/initial-focus/restore fixed fire 5.
- [x] Drive home-feed search + filters: empty-result state IS handled ("No plans
      match those filters…"). NEW candidate found → backlog item below.
- [x] Filter/search over-filtered state had NO one-click reset — fixed fire 4
      (Clear filters button + result count). Search now has a data-filter-search
      hook; the 6 selects still lack individual hooks (low priority — gate drives
      via search + the shared clear).
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
- **Commit:** `5b12e0f`

### Fire 3 — "Copy" buttons gave no feedback and could fail silently
- **Bug (found by clicking):** clicking the Look Render "Copy" button left the
  label as "Copy" before, immediately after, and 1s later — no "Copied!", no
  confirmation. The user has no idea the copy worked.
- **Class:** _clipboard-copy buttons are fire-and-forget — no success feedback,
  and a SILENT no-op when the clipboard API is unavailable._ Six buttons all
  used the identical bare `navigator.clipboard?.writeText(...)` (the `?.` means
  zero feedback AND silent failure — violates input honesty, principle 5).
- **Failing assertion added (gates assert MORE):** interactive sweep step (7c) —
  the Look Render Copy button starts `data-copy-state="idle"` and, on click,
  must move to "copied" (or at minimum leave "idle" with a "Copy failed" label —
  never a silent no-op). Sweep now grants clipboard permission so the success
  path is deterministic.
- **Root-cause fix:** new shared `CopyButton` component — awaits
  `navigator.clipboard.writeText`, shows "Copied!" for 2s on success, falls back
  to `execCommand('copy')` when the async API is missing, and shows "Copy
  failed" (state `failed`) instead of swallowing the error. `data-copy-state`
  exposes state to gates. Replaced ALL SIX copy sites (2 in Review Tools panel,
  4 across the New Plan / Look Render / Repair dialogs).
- **Verified in real Chrome (:3002):** Look Render Copy → "Copied!"
  (`data-copy-state="copied"`); Playwright pass confirms every modal copy button
  (New Plan 1, Look Render 1, Repair 2) goes idle→copied. No console errors.
  Artifact: `artifacts/customer-readiness/ux-fire3-copy-feedback.png`.
- **Commit:** `bce9363`

### Fire 4 — over-filtering the feed was a dead end (no Clear)
- **Bug (found by clicking):** searching a non-matching term (or stacking filter
  dropdowns) emptied the feed to "No plans match those filters" — and the only
  way back was to manually empty the search and reset up to six dropdowns. The
  empty-state copy literally said "Clear a filter" but there was no such control.
- **Class:** _a filtered/searched list with no one-click route back to "all"._
  Seven independent filter inputs (search + 6 selects) with no aggregate reset.
- **Failing assertion added (gates assert MORE):** interactive sweep step (4c) —
  search a non-matching term → 0 cards AND a `[data-clear-filters]` control
  appears → click it → the full feed is restored and the search input is emptied.
- **Root-cause fix:** a single `filtersActive` flag + `clearFilters()` that
  resets all seven inputs. A "Clear filters" button (with a "Showing N of M
  plans" count) appears in the filter bar whenever any filter is active, and a
  second one in the empty state; the empty-state copy now points to it. Added
  `data-filter-search`, `data-clear-filters`, `data-filter-count` QA hooks.
- **Verified in real Chrome (:3002):** non-matching search → 0 of 6 + Clear
  shown → click restores 6 and empties search; a bed-filter dropdown ("2 bed
  plans", 5 of 6) → Clear resets the select to "all" and restores 6. No console
  errors. Artifact: `artifacts/customer-readiness/ux-fire4-filter-clear.png`.
- **Commit:** `052014c`

### Fire 5 — modals didn't manage keyboard focus
- **Bug (found by driving):** opening any workflow dialog left
  `document.activeElement` on `<body>` — focus was never moved into the dialog —
  and Tab cycled through the page controls hidden BEHIND the modal overlay
  (Playwright baseline: `initialFocusInModal:false`, `focusEscapedDuringTab:true`).
  A keyboard / screen-reader user can't tell a dialog opened and can drive the
  hidden background controls.
- **Class:** _an overlay dialog that doesn't move or trap focus (WCAG 2.4.3 /
  dialog pattern)._ All five dialogs share one `WorkflowModal` shell → one root.
- **Failing assertion added (gates assert MORE):** interactive sweep step (7d) —
  on open, focus is inside `[data-workflow-modal]`; 15 Tabs never escape it; and
  Escape closes the dialog AND restores focus to the trigger button.
- **Root-cause fix (`WorkflowModal`):** one effect (extending the fire-2 Escape
  handler) that on open captures the previously-focused element, moves focus to
  the dialog container (`ref` + `tabIndex={-1}`), traps Tab/Shift-Tab to cycle
  within the dialog, and on close restores focus to the trigger.
- **Verified in real Chrome (:3002):** opening Import puts focus on the dialog
  container (`activeInModal:true`). Playwright pass confirms all five dialogs
  `{initial, trapped, restored}` all true. No console errors. Artifact:
  `artifacts/customer-readiness/ux-fire5-modal-focus.png`.
- **Commit:** _(pending — after gates + gates:live green)_
