<!--
The keep-it-alive rubric from docs/QUALITY_PLAYBOOK.md §6. A box you can't
check means the work isn't done — it only looks done, which is worse.
-->

## What & why

<!-- One line: the verifiable capability this PR delivers. -->

## Definition of done

**Correctness**
- [ ] One verifiable capability, stated as a true/false claim.
- [ ] Verified in the real browser, from the angle a defect would hide.
- [ ] Console read for silent errors after interaction; clean.
- [ ] Envelope evidence read off the canvas: compiled ≤ 0.25 ft, 0 untagged offenders; traced exemption explicit.

**Honesty**
- [ ] No silent drops — anything ignored is surfaced to the user.
- [ ] No faked lane / synthesized input to satisfy an old gate.
- [ ] Shared math (roof planes, clamp policy) reused, not re-derived.

**Enforcement**
- [ ] Every UI-implied invariant also enforced server-side.
- [ ] **If a gate changed, it asserts _more_. Any new invariant ships a new assertion.**
- [ ] No network-derived value trusted for an internal action.

**Process**
- [ ] `npm run gates` green (batteries + build).
- [ ] `npm run gates:all` green (+ live qa:brochure + sweep) — or CI green.
- [ ] Guardrails intact: compiler/constraint engine untouched, traced plans unchanged, all `data-*` hooks preserved, throwaways deleted.
