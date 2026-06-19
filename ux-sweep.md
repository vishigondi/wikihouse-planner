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
      (audit every onClick that mutates/deletes/exports/navigates-away). Audited
      fire 7: Import is idempotent; only the dev-only Review-Tools generate lacks
      a double-submit busy guard (low priority).
- [ ] Plan-detail dense review chrome on mobile: `[repair]` status chips (~14px)
      and Compare/Semantic (~23px) are under the 24px touch minimum. Deliberate
      desktop-density tradeoff for now; revisit if mobile review becomes a goal.

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
- **Commit:** `44b025e`

### Fire 6 — an unknown ?home= deep-link silently showed the wrong plan
- **Bug (found by driving):** visiting `?home=<unknown-id>` (a typo, or a link to
  a since-deleted gen-* plan) rendered the FIRST plan (a-frame-bunk) on the full
  detail surface as if it were the requested plan — no error, no indication. A
  user following a stale link believes they're viewing plan X but it's actually a
  different plan. (Note: the real-Chrome extension was unreachable post-restart —
  chrome-error on every navigate — so this fire was driven via Playwright against
  the same live dev server; flagged to the user to re-grant the extension's
  localhost permission.)
- **Class:** _a stale/invalid deep-link silently resolves to a fallback instead
  of being surfaced (input honesty / no silent swap)._
- **Failing assertion added (gates assert MORE):** interactive sweep step (4d) —
  an unknown `?home=` id renders the feed WITH a `[data-plan-not-found]` notice
  that names the id, and shows NO plan-detail surface (no Export button).
- **Root-cause fix:** in the URL-resolution effect, a requested id that matches
  no plan now sets `notFoundId`, falls back to the feed (`showGallery`), and
  resets the URL to `/` — instead of dropping through to the silent
  `setSelectedHomeId(homes[0])` fallback. A dismissible amber banner
  (`data-plan-not-found`) names the missing id; `selectHome` clears it.
- **Verified (Playwright, live :3002):** bogus id → notice names the id, feed
  shown, no detail, URL reset to `/`; Dismiss works; valid id (gen-001) still
  loads its own detail; no console errors. Artifact:
  `artifacts/customer-readiness/ux-fire6-deeplink-notfound.png`.
- **Commit:** `d0effd2`

### Fire 7 — the feed-card "Share" affordance did nothing
- **Bug (found by driving):** the home feed is styled as a social feed with
  Like / Comment / Share on every card. "Share" was a dead `<span>` — clicking it
  did nothing — even though the app HAS real shareable `?home=` deep-links (just
  hardened in fire 6). A user wanting to send a plan to a client clicks Share and
  gets nothing. (Drove the broader surface too — Export downloads, New Plan
  handoff, Repair, plan-selector dropdown URL-sync, double-submit guards,
  generation of extreme briefs — all robust; Share was the one dead control.
  Driven via Playwright; the claude-in-chrome extension is still unreachable
  post-restart — see note to re-grant localhost permission.)
- **Class:** _a labeled control that implies a capability the app actually has
  must perform it (no dead/false affordances)._
- **Failing assertion added (gates assert MORE):** interactive sweep step (4e) —
  the feed-card `[data-feed-action="share"]` is a real button that, on click,
  copies a working `/?home=<id>` deep-link to the clipboard and confirms ("Link
  copied!", `data-copy-state="copied"`).
- **Root-cause fix:** replaced the dead Share span with the shared `CopyButton`
  (fire 3) wired to copy `${origin}/?home=${home.id}`; extended `CopyButton` with
  optional `copiedLabel` ("Link copied!") and pass-through `dataAttr` so the
  `data-feed-action="share"` hook is preserved. Like/Comment stay decorative
  (they map to no real capability; Share does).
- **Verified (Playwright, live :3002):** Share is a button; click → state
  idle→copied, "Link copied!", clipboard = `…/?home=a-frame-bunk`; all 6 cards
  shareable; no console errors. The shared link is exactly the kind fire 6
  hardened (a stale link shows the not-found notice). Artifact:
  `artifacts/customer-readiness/ux-fire7-share-link.png`.
- **Commit:** `518a5e3`

### Fire 8 — icon-only nav buttons had no accessible name
- **Bug (found by driving + scanning):** the plan-detail plan-selector prev/next
  buttons were bare glyphs (`←` / `→`) with no `aria-label`/`title` — a screen
  reader announces "left arrow / right arrow" or nothing, so a non-sighted user
  can't tell what they do. The adjacent plan `<select>` also had no name.
  (Scanned every button/link on home + detail; home was clean, detail had these.
  Driven via Playwright — claude-in-chrome extension still unreachable.)
- **Class:** _icon/glyph-only interactive controls with no accessible name_
  (WCAG 4.1.2 Name, Role, Value).
- **Failing assertion added (gates assert MORE):** interactive sweep step (4f) —
  scans EVERY visible button / link / role=button on both the home feed and the
  plan detail and asserts none lacks an accessible name (text / aria-label /
  title). This guards the whole class, not just today's two buttons.
- **Root-cause fix:** added `aria-label` + `title` ("Previous plan" / "Next
  plan") and `type="button"` to the nav arrows, and `aria-label="Select plan"`
  to the plan `<select>`.
- **Verified (Playwright, live :3002):** nameless-control count home 0 / detail 0
  (was 2); clicking "Next plan" by its accessible name navigates
  (gen-001 → loft-showcase). Artifact:
  `artifacts/customer-readiness/ux-fire8-aria-nav.png`.
- **Commit:** `e0f84a7`

### Fire 9 — feed "Share" was a sub-24px touch target on mobile
- **Bug (found by measuring at 390px):** the fire-7 Share button was a borderless
  text link with no hit padding — 33×17px, under the 24px WCAG 2.5.8 minimum, so
  it's a hard tap target on phones. (Also checked: focus-visible ring present —
  good; all images have alt — good. Driven via Playwright; claude-in-chrome still
  unreachable.)
- **Class:** _customer-facing touch targets under 24px on mobile (WCAG 2.5.8)._
  Scoped to the home feed (the primary browse surface); the dense plan-detail
  review chrome (`[repair]` status chips ~14px, Compare/Semantic ~23px) is a
  deliberate desktop-density tradeoff — logged in Backlog, not forced.
- **Failing assertion added (gates assert MORE):** interactive sweep step (4g) —
  at 390px, every interactive control inside a `[data-feed-card]` is ≥24px tall.
- **Root-cause fix:** gave the Share `CopyButton` a min hit area
  (`min-h-[24px] py-1 -my-1 inline-flex items-center`) — 17→25px tall — without
  growing the engagement-bar row (negative margin absorbs the padding).
- **Verified (Playwright, 390px):** no feed-card control under 24px (was 6 Share
  at 17px); Share now 33×25 and still copies the link. Artifact:
  `artifacts/customer-readiness/ux-fire9-tap-targets.png`.
- **Commit:** _(pending — after gates + gates:live green)_
