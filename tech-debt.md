# Tech Debt

Grouped by unit of work — items in the same section share a root cause or a
touch surface and should be fixed together. Severity: 🔴 breaks in production ·
🟠 real bug, bounded blast radius · 🟡 consistency / latent.

Source: repo review 2026-07-09 (supersedes the deleted `tech-debt.md`; overlaps
with `docs/audit-2026-07-06.md`, re-verified against `develop`).

---

## 1. Rate limiting 🔴

All three services share the `@hallpass/express-middleware` limiters; fix once
there, roll out to all three `app.ts`.

- **General limiter keys per-IP in practice, not per-user.**
  `packages/middleware/src/rateLimit.ts:23-28` documents it: the limiter keys by
  `req.user.id`, but it is mounted before any auth middleware, so `req.user` is
  never set at keying time and it falls back to per-IP. A school behind one NAT
  IP still shares **100 req / 15 min** — product breaks first period, day one.
  (The auth limiter, keyed by email, is correctly fixed.)
- **In-memory store on `user-api` and `schools-api`.** Only `passes-api/app.ts:44-56`
  uses the Redis store. The other two use `createGeneralLimiter()` with no store,
  so counters are per-instance and reset on every scale event.

**Fix:** key authenticated traffic by user id after `requireAuth` (or accept
per-IP knowingly with a much higher limit), and back all three with the Redis
store. Land it in the shared package so policy is uniform.

---

## 2. Authorization & user onboarding 🔴🟠

Both touch `apps/user-api/src/routes/user.ts` and the auth model.

- 🟠 **`PATCH /api/users/:id` is missing the target-rank check that DELETE has**
  (`user.ts:194-249` vs `user.ts:277`). A school ADMIN can edit a **peer ADMIN's
  email** (redirect another admin's login identity), demote a peer ADMIN, or
  promote a STUDENT to ADMIN. PATCH only checks the *assigned* role isn't above
  the caller. Mirror DELETE: non-self targets must be strictly below the caller's
  rank.
- 🔴 **Admin-provisioned users can never log in.** `POST /api/users` and `/bulk`
  (`user.ts:120,154`) create `User` rows with no better-auth credential
  `Account`; better-auth sign-up then refuses their email (row exists). The seed
  works around this by hand-crafting scrypt hashes that must "match better-auth's
  config exactly" (`packages/db/prisma/seed.ts:14-25`) — a version-upgrade
  landmine, and not something the API offers. Needs a real invite / set-password
  flow (or better-auth admin plugin) before onboarding a school.

---

## 3. Cross-service invariants (schools-api ↔ passes-api) 🟠

No layer owns the invariants passes-api depends on. Fix the destination case
(the sharp one) together with the promotion query.

- **Destination delete doesn't guard in-flight passes.**
  `apps/schools-api/src/routes/destination.ts:94` soft-deletes with no check,
  and `promoteFromQueue` (`apps/passes-api/src/lib/slots.ts:197-201`) doesn't
  filter `deletedAt` — a WAITING student is promoted into a destination that no
  longer exists. The pattern to copy exists: `scheduleType` DELETE guards its
  references (`scheduleType.ts:115-122`). Add a 409 guard on destination delete
  while non-terminal passes reference it, and `deletedAt: null` to the promotion
  query.
- **`maxOccupancy` shrink / period `endTime` edit leave stale state.** Redis
  counters and already-armed expiry timers aren't updated until the scheduled
  reconcile. Acceptable *if* reconcile runs frequently — write that assumption
  down (`docs/INFRA.md`) rather than leaving it implicit.

---

## 4. Validation & data integrity 🟠

- **Timezone is unvalidated free text.** `createSchoolSchema` / `updateSchoolSchema`
  (`apps/schools-api/src/schemas/school.ts:18,25`) accept any string. In
  passes-api, `tzOffsetMs` / `localMidnightAsUTC` (`apps/passes-api/src/lib/time.ts:30-56`)
  throw `RangeError` on a bad zone — pass creation 500s *after* the row is
  inserted, and quota checks throw. Validate with `Intl.supportedValuesOf("timeZone")`
  in the schema; the whole failure family disappears at the edge.
- **Bulk calendar upsert is non-atomic.** `apps/schools-api/src/routes/calendar.ts:66-107`
  loops entries and returns a bare 422 mid-loop on a bad `scheduleTypeId` —
  earlier entries are already written and the client can't tell which. Also N+1.
  Wrap in `$transaction`, validate all up front, or adopt `/users/bulk`'s
  per-item result shape.
- **Quota check is read-then-write (TOCTOU).** `apps/passes-api/src/routes/passes.ts:180-203`:
  concurrent create/complete cycles can exceed `maxPerInterval` by one. The
  partial unique index bounds it to one extra — acceptable, but note it.

---

## 5. Consistency & service drift 🟡

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
