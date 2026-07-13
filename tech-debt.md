# Tech Debt

Grouped by unit of work — items in the same section share a root cause or a
touch surface and should be fixed together. Severity: 🔴 breaks in production ·
🟠 real bug, bounded blast radius · 🟡 consistency / latent.

Source: repo review 2026-07-09 (supersedes the deleted `tech-debt.md`; overlaps
with `docs/audit-2026-07-06.md`, re-verified against `develop`).

---

## 1. User onboarding — bulk-student delivery 🟡

Touches `apps/user-api/src/routes/user.ts`. Provisioning itself is solved
(`createUserWithCredential`); see `docs/ONBOARDING.md`.

- **No mechanism to deliver credentials at scale.** `POST /api/users/bulk`
  returns a `created`/`failed` summary, not the per-student temp passwords, so
  there's no way to get a credential to each student. A set-password link or
  transactional-email invite is still needed before onboarding a school at scale
  — see the "Future optimizations" (set-password link, transactional email) in
  `docs/ONBOARDING.md`.

---

## 2. Cross-service invariants (schools-api ↔ passes-api) 🟡

No layer owns the invariants passes-api depends on. The sharp destination case
is now closed; what remains is the bounded-staleness case below.

- **`maxOccupancy` shrink / period `endTime` edit leave stale state.** Redis
  counters and already-armed expiry timers aren't updated until the scheduled
  reconcile. Acceptable *if* reconcile runs frequently — write that assumption
  down (`docs/INFRA.md`) rather than leaving it implicit.

---

## 3. Consistency & service drift 🟡

The three apps are copy-paste siblings diverging; converge in
`@hallpass/express-middleware`.

- 🟡 `POST /passes` returns 422 (not 404) for missing `studentId` and
  `destinationId` — both are user-supplied body references, treated as validation
  failures per docs/API_CONVENTIONS.md. Intentional; documented, not deferred.
