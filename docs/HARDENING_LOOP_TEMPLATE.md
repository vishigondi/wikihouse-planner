# Hardening-loop template

The six hardening loops all shared one shape. This is that shape as a fill-in
template, so the discipline is inherited instead of retyped (and so the
guardrail block can't be forgotten). Paste into `/loop <interval> …`, filling
the three blanks.

> The operating model and guardrails are also in `CLAUDE.md`; this template is
> the loop-shaped version for kicking off a focused hardening run.

---

```
In ~/.openclaw/workspace/projects/wikihouse-planner — <ONE-LINE GOAL>. Work in
my REAL Chrome (tabs_context_mcp, dev localhost:3002). ONE verifiable
capability per fire, in this order:

  <ORDERED LIST OF CAPABILITIES — each a thing that can be shown true/false>

EVERY fire: verify in real Chrome from the angle a defect would hide; read the
canvas envelope evidence (bimEnvelopeMaxExcessFt / bimEnvelopeOffenders) and
read_console_messages after each interaction batch — any new React/WebGL/
network error is a finding; screenshot evidence into
artifacts/customer-readiness/<TAG>-*; delete throwaway gen-* after each fire.

GUARDRAILS (absolute): semantic JSON / compiler / constraint engine untouched;
never loosen envelope/constraint/qa gates (compiled <= 0.25 ft, offenders [],
0 untagged on every plan); traced plans (a-frame-22, a-frame-bunk,
outpost-medium) artifacts untouched and must not regress; keep gen-001 (JSON
untouched); keep every data-* QA hook. If a fix needs a gate change, it must
assert MORE, never less.

GATES before each commit: `npm run gates` (batteries + build) AND `npm run
gates:live` (qa:brochure on prod + interactive sweep) — all green, no
threshold loosening.

STOP when: <STOP CONDITION> verified in Chrome AND the gate ladder is green on
TWO consecutive fires (the second a no-change verification pass) — then update
PROJECT_STATUS.md, push, push notification, CronDelete this job.
```

---

## Why each clause is there

- **One capability per fire** — the unit that can be proven, demoed, and
  reverted cleanly. Two capabilities means a fire you can't cleanly judge.
- **Verify from the angle a bug hides** — the sail-fin defect survived review
  because nobody looked from the fin angle. Pick the orbit/state that would
  expose *this* class of defect.
- **Read evidence, not screenshots** — screenshots lie by omission; the canvas
  data-attributes and console don't.
- **Two consecutive clean fires** — one green run can be green by accident; the
  no-change second pass is what catches it.
- **Gate change asserts more** — the process version of principle P3. A loop
  that loosens a gate to make itself pass has defeated its own purpose.
