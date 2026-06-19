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

- [x] Drive plan-detail VIEW controls deeply — fire 17 (clean): Roof/White
      toggles flip without error; Ground/Loft/All level switch works on a loft
      plan (active state correct); Plan Top hides Roof/White; White state persists
      consistently across view changes; canvas intact, no console errors.
- [x] Compare ↔ Semantic toggle — verified working (fire 6), and the JSON-only vs
      GPT-paired overlay distinction is already gated in the interactive sweep
      ("overlay hidden for JSON-only plan" / "overlay tab present only on paired").
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
- [x] Drive card Open / Repair / New Plan Handoff — Open (fires 12, 14), Repair
      from card (fires 11, 13), New Plan Handoff copy (fire 16): all clean.
- [x] Confirm no other destructive/irreversible action fires on a single click
      (audit every onClick that mutates/deletes/exports/navigates-away). Audited
      fire 7: Import is idempotent. Fire 13: BOTH generate handlers (home +
      Review-Tools) double-fired on a synchronous double-click — now guarded.
- [x] Plan-detail dense review chrome on mobile: `[repair]` status chips (~14px)
      and Compare/Semantic (~23px) are under the 24px touch minimum. **Accepted
      tradeoff** (not a TODO): the plan-detail review surface is desktop-first
      (3D canvas + dense compliance chrome); these are advanced/status affordances
      used with a mouse. The customer-facing FEED is gated to ≥24px (fire 9).
      Revisit only if mobile plan-review becomes a product goal.

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
- **Commit:** `dea2e2b`

### Fire 10 — form fields had no programmatic labels
- **Bug (found by scanning):** on the home feed, 8 form fields had no
  accessible name — the brief box and search box were labelled only by a
  placeholder (which disappears on input and isn't a label), and all SIX filter
  selects (bed/bath/sqft/levels/roof/status) had no label at all. A screen-reader
  user tabbing the filter row hears "combo box" with no purpose. (Detail page was
  already clean after fire 8. Driven via Playwright; claude-in-chrome still
  unreachable.)
- **Class:** _form fields without a programmatic label (WCAG 3.3.2 / 4.1.2;
  placeholder ≠ label)._
- **Failing assertion added (gates assert MORE):** interactive sweep step (4h) —
  no visible input/select/textarea on home or detail may lack a name from
  aria-label / aria-labelledby / a wrapping or `for=` `<label>` / title.
- **Root-cause fix:** added descriptive `aria-label`s — "Describe your home in
  one line", "Search plans", and "Filter by bedrooms/bathrooms/square feet/
  levels/roof type/status".
- **Verified (Playwright, live :3002):** unlabeled-field count home 0 / detail 0
  (was 8 on home); all eight names present. Artifact:
  `artifacts/customer-readiness/ux-fire10-form-labels.png`.
- **Commit:** `7939d00`

### Fire 11 — the "plan not found" banner went stale (transient state leak)
- **Bug (found by driving):** after a bogus `?home=` showed the not-found banner
  (fire 6), clicking a feed card's **Repair** navigated to that plan and opened
  the repair modal correctly — but returning to the feed ("Browse Plans") showed
  the not-found banner AGAIN, stale, for a plan the user had since opened.
  `selectHome` cleared `notFoundId` (fire 6) but `repairHomeFromGallery` (and the
  prev/next/resume paths) did not. (Driven via Playwright; claude-in-chrome still
  unreachable.)
- **Class:** _transient, surface-scoped UI state not cleared by every path that
  resolves it_ (the banner is feed-only but only one of several nav paths cleared
  it).
- **Failing assertion added (gates assert MORE):** interactive sweep step (4d
  follow-on) — after the not-found banner, drive the previously-broken
  repair-from-card path (card Repair → close → Browse Plans) and assert the
  banner is gone.
- **Root-cause fix:** one effect — `useEffect(() => { if (!showGallery)
  setNotFoundId(null); }, [showGallery])` — clears the banner the moment the user
  views any real plan, covering ALL nav paths (select / repair / prev-next /
  resume) in a single place instead of per-handler.
- **Verified (Playwright, live :3002):** banner present after bogus link → 0
  after the repair path + return (was 1); Open path also clears; repair modal
  still opens; no console errors. Artifact:
  `artifacts/customer-readiness/ux-fire11-notfound-transient.png`.
- **Commit:** `6cfea7a`

### Fire 12 — clean drive (no new bug found)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** the
  full plan lifecycle as feature *combinations*, where the last few real bugs
  hid:
  - generate from brief → land on detail → Browse Plans (shows "Resume gen-002")
    → delete from feed card (two-step) → **count 7→6, no stale "Resume gen-002"
    button, deleted card gone, no console errors.** The post-delete state
    self-corrects cleanly (no dangling reference to the removed plan).
  - filter the feed ("a-frame" → 5) → open a plan → Browse Plans → **filter
    resets to the full feed (6), search box empty, no Clear button** — internally
    consistent (no "box shows a term but feed is unfiltered" desync).
- **Result:** no usability bug surfaced; every gate from fires 1–11 still green.
  Throwaway gen-002 deleted; only gen-001 remains. This is the **first of the two
  consecutive clean fires** the loop needs to close. (`npm run gates` green; no
  app-code change this fire, so `gates:live` is green by identity with fire 11.)
- **Commit:** `682c09e` _(doc-only)_

### Fire 13 — generate buttons double-fired (duplicate-plan hazard)
- **Bug (found by driving):** a rapid/synchronous double-click on "Generate Plan
  From Brief" (Review-Tools panel) fired TWO `POST /api/generate-plan` and could
  create two plans from one intent. Probing further, the prominent home-feed
  "Generate Plan" had the SAME flaw — its `busy` *state* guard doesn't stop a
  synchronous re-entry because React state doesn't update within a tick. (Driven
  via Playwright; claude-in-chrome still unreachable.)
- **Class:** _async-mutation buttons guarded only by React state still
  double-submit on a synchronous/rapid double-click; they need a synchronous ref
  guard._ Spanned BOTH generate handlers.
- **Failing assertion added (gates assert MORE):** interactive sweep step (4i) —
  intercept+abort `POST /api/generate-plan` (so the gate makes no throwaway
  plans) and assert a synchronous double-click on each generate button yields
  exactly ONE POST.
- **Root-cause fix:** a synchronous `useRef` flag (`generatingRef` / `busyRef`)
  set before the await and reset on every error path, in BOTH
  `ProductWorkflowPanel` and `GalleryBriefGenerate`; the button also disables and
  shows "Generating…".
- **Verified (Playwright, live :3002):** double- AND triple-click → 1 POST on
  both buttons (was 2); button disabled + "Generating…" while in flight; no
  throwaway plans created (route-aborted; only gen-001 remains). Artifact:
  `artifacts/customer-readiness/ux-fire13-generate-guard.png`.
- **Commit:** `20a9b26`

### Fire 14 — clean verification drive (no new bug)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** a
  full keyboard + race + console session across every surface:
  - **Keyboard end-to-end on home:** focus search → type "a-frame" → 5 filtered;
    focus a card's "Open plan" → Enter → opened the detail (Export present).
  - **Rapid-nav races:** 8× Next then 8× Previous on the plan selector → ends in
    a consistent plan with the 3D canvas intact, no errors.
  - **All five modals** open → Escape → none left open; **all view presets**
    cycled → canvas intact.
  - **Zero console errors / pageerrors** across the entire session.
- **Result:** no usability bug surfaced. Backlog is now empty of actionable
  TODOs (the only remaining item — dense plan-detail tap targets — is an accepted
  desktop-density tradeoff, above). This is the **first clean sweep after the
  fire-13 fix**; one more clean fire completes the two-consecutive-clean close
  condition. (`npm run gates` green; no app-code change this fire, so `gates:live`
  is green by identity with fire 13.)
- **Commit:** `15541e8` _(doc-only)_

### Fire 15 — clean verification drive (no new bug) — CLOSE
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable) fresh
  angles not covered by fire 14:**
  - **Repair Apply Patch:** Apply disabled when empty; invalid JSON → clear parse
    error; valid-but-bad-path → "outside allowed paths for walls" (server-enforced
    invariant rejecting cleanly); modal stays open; no corruption.
  - **Lifecycle buttons** (draft/review/promoted/exported) cycled → 0 errors.
  - **Nav re-render integrity:** Next then Previous back to gen-001 → 3D canvas +
    plan sheet intact.
  - **Zero console errors** throughout.
- **Result:** no usability bug surfaced — the **second consecutive clean sweep**
  after the fire-13 fix. Close condition met: every surface driven, backlog empty
  of actionable TODOs, would genuinely use the app, full ladder green on two
  consecutive fires. PROJECT_STATUS.md + the playbook updated. Push / CronDelete
  held pending the user's go-ahead (no-push-without-asking guardrail).
- **Commit:** _(doc-only close)_

## Watch mode (post-close)

The sweep met its close condition at fire 15 and shipped to origin/main; the loop
was kept running as a regression watch. Each watch fire drives a fresh angle; a
new bug restarts the normal find→class→gate→fix cycle.

- **Fire 16 — clean.** Drove the angles not yet output-verified: Look Render
  **mode toggle** (photoreal → "architectural visualization"; illustration →
  "architectural illustration" + concept/not-a-photo wording; distinct prompts,
  active state flips) and **New Plan handoff** copy (idle→copied, clipboard holds
  the prompt). No bug, zero console errors. (Playwright, live :3002 —
  claude-in-chrome still unreachable.) No app-code change; gates green by identity.

- **Fire 17 — clean.** Drove the plan-detail VIEW controls deeply on the loft
  plan (loft-showcase) + gen-001: White toggle flips (no error); Ground/Loft/All
  level switch flips active state correctly; Plan Top hides Roof/White; White
  state persists consistently when returning to BIM 3D (no checkbox desync);
  canvas intact; zero console errors. Ticks the last two "drive to verify"
  backlog items. (Playwright, live :3002 — claude-in-chrome still unreachable.)
  No app-code change; gates green by identity.

- **Fire 18 — clean.** Drove the Import valid-payload SUCCESS path (fire 3 only
  covered bad payloads): pasted gen-001's real 22KB paired JSON → "imported draft
  into current plan" (client-side draft overlay), modal stays open, canvas + sheet
  intact, no console errors, and **no disk mutation** (gen-001 JSON untouched —
  import is client-state only). Also attempted the lot editor's input robustness;
  its `[data-lot-field]` wasn't reachable in an isolated probe, but the lot-editor
  flip is gated and green every run — gated+working, not a bug. With this, every
  listed surface has been driven. (Playwright, live :3002 — claude-in-chrome still
  unreachable.) No app-code change; gates green by identity.

### Fire 19 — browser Back left the app instead of returning to the feed
- **Bug (found by driving):** at the feed `history.length=2`; opening a plan from
  a card used `replaceState` (still 2), so **browser Back went to about:blank /
  left the app** instead of returning to the feed. Generate used full nav (Back
  worked), card-Open did not — an inconsistent, stranding navigation model.
- **Class:** _in-app navigation that replaces history strands the user_ (Back/
  Forward don't step between the feed and a plan).
- **Failing assertion added (gates assert MORE):** interactive sweep step (4j) —
  feed → open a card → browser Back shows the feed → Forward shows the plan again.
- **Root-cause fix:** feed↔plan transitions now `pushState` (plan→plan stays
  `replaceState` to avoid history spam, via a `showGalleryRef`), plus a `popstate`
  effect that re-resolves the view (plan / feed / not-found) from the URL —
  mirroring the initial-load logic, so Back/Forward re-render correctly.
- **Verified (Playwright, live :3002 — claude-in-chrome still unreachable):**
  open plan → Back → feed (6 cards, URL `/`) → Forward → plan (URL `?home=…`),
  no console errors. No regression: the fire-6 deep-link-not-found and fire-11
  banner-clears gates stay green. gates + gates:live green.
- **Commit:** _(pending push approval)_

### Fire 20 — tab title was static across every view
- **Bug (found by driving):** `document.title` was a fixed "Floorplan Studio" on
  the feed, gen-001, and loft-showcase alike (set once in `layout.tsx` metadata,
  never updated). Multi-tab users, bookmarks, and browser history can't tell
  plans apart — every entry reads "Floorplan Studio".
- **Class:** _the document title doesn't reflect the current view._
- **Failing assertion added (gates assert MORE):** interactive sweep step (4k) —
  the feed title is the base; each plan's title names that plan; two plans differ.
- **Root-cause fix:** an effect that sets `document.title` from the view —
  `"<plan id> - Floorplan Studio"` on a plan, `"Plan not found - …"` for a bad
  deep-link, base on the feed (deps: showGallery / displayHome / notFoundId).
- **Verified (Playwright, live :3002):** feed "Floorplan Studio"; gen-001
  "gen-001 - Floorplan Studio"; loft "loft-showcase - Floorplan Studio"; returns
  to base via Browse Plans. No regression. gates + gates:live green.
- **Commit:** auto-pushed (gated fix).

### Fire 21 — global Arrow-key plan-nav hijacked text fields
- **Bug (found by driving):** the global ArrowLeft/Right plan-nav guard skipped
  `input`/`select` but NOT `textarea` or contentEditable, and fired even behind an
  open modal. Typing JSON in the Import textarea and pressing arrows to move the
  caret silently switched the plan (gen-001 → a-frame-bunk) behind the dialog.
- **Class:** _a global keyboard shortcut that fires while the user is editing a
  text field / behind a modal._
- **Failing assertion added (gates assert MORE):** interactive sweep step (4l) —
  arrows while typing in the Import textarea do NOT navigate; bare arrows on the
  detail (no field, no modal) DO navigate (the feature still works).
- **Root-cause fix:** expanded the keydown guard to also skip `HTMLTextAreaElement`
  and `isContentEditable`, and to no-op when any `[data-workflow-modal]` is open.
- **Verified (Playwright, live :3002 — claude-in-chrome still unreachable):**
  arrows in the Import textarea (modal stays open, plan unchanged) AND the
  non-modal Review-Tools brief textarea don't navigate; bare ArrowRight on the
  detail still navigates (gen-001 → loft-showcase). No regression. gates +
  gates:live green.
- **Commit:** auto-pushed (gated fix).

### Fire 22 — feed lost the user's scroll position on Back
- **Bug (found by driving):** after fire 19 enabled Back→feed, the browser's
  `scrollRestoration="auto"` mishandled the async SPA re-render — scrolling the
  feed to ~5000px, opening a plan, and pressing Back landed at ~7766px (a wrong
  offset), not where the user was. A long feed loses your place on Back.
- **Class:** _a scrollable list that doesn't restore scroll position on Back._
- **Failing assertion added (gates assert MORE):** interactive sweep step (4m) —
  scroll the feed, open a plan, browser Back → the feed is back at (≈) the same
  scroll offset.
- **Root-cause fix:** take over scroll restoration — `history.scrollRestoration =
  'manual'`; save `window.scrollY` when leaving the feed (selectHome from-feed +
  repair-from-gallery into a `feedScrollYRef`); restore it via a double-rAF when
  the feed re-renders (`showGallery` true).
- **Verified (Playwright, live :3002 — claude-in-chrome still unreachable):**
  scroll to 1200 → open plan → Back → scrollY 1200 (was a wrong offset). No
  regression (Back/Forward, deep-link, title all green). gates + gates:live green.
- **Commit:** auto-pushed (gated fix).

### Fire 23 — clean (adversarial input / XSS robustness)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** the
  brief box with adversarial input — `<img onerror>` + `<script>` + quotes/&,
  and a 40×-repeated long brief. Result: **no script executed** (`window.__xss`
  undefined, no dialog), the parser strips special chars and surfaces the ignored
  words as plain escaped text (React), **zero horizontal overflow** from either
  the evil or the very-long brief, no console errors.
- **Code audit:** the 4 `dangerouslySetInnerHTML` sites render deterministic SVG
  from geometry; `elevationSvgMarkup` embeds no unescaped user text, and the
  SVG/HTML generators use `escapeHtml` on every interpolated field (room labels,
  packet fields). No XSS vector via brief / import / plan fields.
- **Result:** no usability or security bug; input handling is honest and safe.
  No app-code change; gates green by identity.

### Fire 24 — clean (console hygiene: warnings + errors)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** a full
  session — feed, plan detail, all 5 modals (open/Escape), all view presets, the
  loft plan — capturing console **warnings AND errors** (prior fires only checked
  errors). Result: **0 warnings, 0 errors** — no React missing-key warnings, no
  hydration mismatches, no deprecation notices.
- **Result:** no bug; console is clean across every surface. Second consecutive
  clean sweep after fire 22's fix. No app-code change; gates green by identity.

### Fire 25 — plan detail overflowed horizontally at 320px
- **Bug (found by driving):** the responsive gate covered 390+, not 320 (small
  phones). At 320px the plan **detail** overflowed 32px horizontally — the
  plan-selector `<select>` (`min-w-[240px]`, couldn't shrink) and the plan-sheet
  header label (no `min-w-0`, pushed the Compare/Semantic toggle past the edge).
  Home was fine; 360px was fine.
- **Class:** _fixed-width controls that don't shrink below the smallest supported
  viewport (horizontal overflow at 320px)._
- **Failing assertion added (gates assert MORE):** added a `small` 320px
  breakpoint to the responsive loop (home + detail no-overflow + landmarks) and
  to the modal-fit loop (all 5 modals fit @ 320px).
- **Root-cause fix (layout CSS only):** plan-selector select →
  `min-w-0 max-w-[240px] flex-1` (grows to 240, shrinks below); plan-sheet header
  label → `min-w-0` (shrinks/truncates); Compare/Semantic toggle → `shrink-0`
  (stays intact).
- **Verified (Playwright, live :3002 — claude-in-chrome still unreachable):**
  detail overflow 320px 32→0; 360/390/1440 still 0; canvas + sheet intact. No
  regression. gates + gates:live green (320 breakpoint + modal-fit @ 320 all ok).
- **Commit:** auto-pushed (gated fix).

### Fire 26 — clean (short / landscape viewport)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** a
  landscape-phone viewport (740×360, very short height) — plan detail + all 5
  modals. Result: detail no horizontal overflow; every modal panel stays capped
  (height 349 ≤ 360 viewport via `max-h-[78vh]` + scroll-inside) with the Close
  button reachable on-screen; no console errors.
- **Result:** no bug — short/landscape viewports are handled (modals scroll
  inside, controls reachable). No app-code change; gates green by identity.

### Fire 27 — clean (keyboard reachability of the plan detail)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** a
  Tab-only sweep of the plan detail (60 Tab presses). All key controls are
  reachable in a logical order — prev/next, Select plan, every VIEW preset
  (incl. the absolutely-positioned overlay buttons), the full action bar (New
  Plan / Import / Export / Look Render / Repair / Delete), Browse Plans, Review
  Tools, Compare/Semantic (23 tab stops). The one bare `INPUT` is a Roof/White
  checkbox labeled via its wrapping `<label>` (4h gate already asserts detail has
  0 unlabeled fields).
- **Result:** no bug — no unreachable control, no keyboard trap. No app-code
  change; gates green by identity.

### Fire 28 — clean (create → share → recipient opens shared link, end-to-end)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** the
  full value loop as one flow — generate a plan from a brief (gen-002) → Browse
  Plans → Share that card (copy its deep-link) → open the link in a FRESH browser
  context (a recipient with no shared state). Result: recipient lands on the
  gen-002 detail (Export present, tab title "gen-002 - Floorplan Studio"), no
  not-found banner, no console errors. Throwaway gen-002 deleted (only gen-001
  remains).
- **Result:** no bug — the create→share→open chain (fires 1/13 + 7 + 6 + 20)
  coheres end-to-end. No app-code change; gates green by identity.

### Fire 29 — clean (New Plan reference selector re-bases the prompt)
- **Drove (Playwright, live :3002 — claude-in-chrome still unreachable):** the
  New Plan Handoff modal's reference-plan `<select>` — changed it gen-001 →
  a-frame-bunk and compared the copied prompt. The "Selected baseline" section
  updates correctly (`planId: gen-001` → `planId: a-frame-bunk`; prompts differ).
  Changing the reference also navigates the underlying selected plan (URL →
  `?home=a-frame-bunk`, modal stays open) — by-design coupling (baseline = the
  selected plan), not a dead control.
- **Result:** no bug — the reference selector is functional and the prompt
  reflects the chosen baseline. No app-code change; gates green by identity.
