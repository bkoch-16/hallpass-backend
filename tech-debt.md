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

- `passes-api/app.ts` lacks the explicit `app.options` preflight handler the
  other two register; PORT env schemas differ across apps.
- `GET /passes` orders by `id asc` (`passes.ts:325`) — a live pass board wants
  newest/in-flight first; awkward to retrofit onto cursor pagination later.
- Socket auth swallows DB errors as "Unauthorized" (`apps/passes-api/src/lib/socket.ts:42-44`)
  while the HTTP path surfaces them as 500 — same inconsistency the HTTP auth fix
  already removed.
- Status-code conventions drift: school-not-found is 404 in policy PUT but 422 in
  pass create; `requireSchool` uses 422 where 403 is arguable. Pick one
  convention, document it.
- **Partial unique index landmine.** `one_active_pass_per_student` exists only in
  a migration; the schema comment (`packages/db/prisma/schema.prisma:188-197`)
  warns every `prisma migrate dev` regenerates a `DROP INDEX` that must be
  hand-deleted. passes-api's 409 duplicate-pass contract silently degrades if
  applied. Add a CI grep / post-migrate assertion so the failure is loud.
