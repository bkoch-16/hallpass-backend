# User Onboarding

How users get an account they can actually log into. Covers the current
supported flow and the constraints behind it. Future optimizations are at the
bottom — don't build them until the case that needs them shows up.

---

## Background: why provisioning isn't a plain insert

Auth is handled by better-auth (`packages/auth`). A user can only log in if they
have both a `User` row **and** a better-auth credential (`Account` row holding
the password hash). Sign-up creates both; a bare `prisma.user.create` creates
only the `User`.

This used to be the sharp edge: `POST /api/users` and `/bulk` inserted a `User`
with no `Account`, so those users could never log in, and better-auth's sign-up
then refused their email because the row already existed.

Provisioning now goes through the `createUserWithCredential` helper
(`packages/auth/src/index.ts:60`), which uses better-auth's own `auth.$context`
(`internalAdapter` + `password.hash`) to create the `User` **and** a
`credential` `Account` in one path — no hand-rolled hashing. Both provisioning
routes use it:

- `POST /api/users` (`apps/user-api/src/routes/user.ts:147`) and
  `POST /api/users/bulk` (`user.ts:181`) create a `User` + credential `Account`
  and return a server-generated one-time `tempPassword` (24 url-safe chars from
  `node:crypto`, `user.ts:31`). Admin/bulk-provisioned users **can** now log in.
- The seed routes through the same helper (`packages/db/prisma/seed.ts:47-64`);
  the hand-rolled scrypt hash and the `@noble/hashes` dependency are gone, so the
  version-upgrade landmine is closed.

Two supporting constraints:

- The better-auth `additionalFields` `role`/`schoolId` are `input:false`
  (`packages/auth/src/index.ts:23-26`), so the public
  `POST /api/auth/sign-up/email` **cannot** set `role`/`schoolId`. Self-signup
  still defaults to `STUDENT`; the helper sets `role`/`schoolId` server-side.
- `createAuth` takes `prisma` via config (`packages/auth/src/index.ts:8-13`) so
  the auth package no longer imports `@hallpass/db`, keeping the workspace
  dependency graph acyclic.

So `POST /api/users` now yields a usable login, not just a directory record.
Self-signup + promote (below) remains a valid alternative for one-off admins.

---

## Current supported flow — school admins

Onboard a school admin with **self-signup + promote**. It uses only endpoints
that already exist and are tested, and no plaintext password ever passes through
our API.

1. **Admin self-signs-up.** They hit `POST /api/auth/sign-up/email` (the app's
   normal sign-up screen) with their school email and a password they choose.
   This creates the `User` + `Account` correctly. They land as a `STUDENT` with
   no `schoolId`.
2. **Super-admin promotes them.** `PATCH /api/users/:id` with
   `{ "role": "ADMIN", "schoolId": <id> }`. The target-rank guard on PATCH
   (`user.ts:259`) permits this: the target is a `STUDENT` (rank 0) and the
   caller is `SUPER_ADMIN` (rank 3), and only a super-admin may set `schoolId`.

In practice: *"Sign up in the app with your school email, then tell me — I'll
grant you admin."*

**Why this over API provisioning for admins:** admins are rare and provisioned
one at a time by a super-admin, so the coordination cost is trivial and the
payoff is no temp password to hand around and no credential that stays valid
forever — the admin owns their own password from the first moment. API
provisioning (`POST /api/users`) is now a working alternative, but it hands back
a one-time `tempPassword` that must be delivered out of band and stays valid
until changed.

**Limits:**
- Relies on open sign-up (currently `emailAndPassword.enabled = true`, no
  allowlist).
- Does **not** scale to bulk student onboarding — see below.

---

## Bulk student delivery

You can't ask hundreds of students to self-register and then reconcile them
against a roster. `POST /api/users/bulk` provisions login-capable `User` +
`Account` rows and returns a per-item result; **delivery** now happens
automatically alongside creation.

Both `POST /api/users` and `POST /api/users/bulk` email each successfully
created user an invite via `@hallpass/email`
(`apps/user-api/src/routes/user.ts:56-59`). The invite carries a set-password
link built from a better-auth reset-password `Verification` token, minted
server-side by `createSetPasswordToken`
(`packages/auth/src/index.ts:111`) with a 7-day expiry (vs. 1 hour for a
self-service reset). The link is consumed by the existing public
`POST /api/auth/reset-password` endpoint — no new endpoint was needed, since
an invite is just a longer-lived reset token redeemed the normal way.

Email failures are logged and never fail provisioning — the `User`/`Account`
rows are already committed by the time the send is attempted, so a bad send
just means the admin has to resend a link. Response shapes are unchanged:
single create still returns `tempPassword`; bulk still returns
`{ created, failed }`. Without SES env configured, the email is logged
instead of sent, same as the password-reset flow.

---

## Future optimizations

Deferred until a concrete need appears. Ordered lightest-first.

### 1. `signUpEmail` + set-password link (no email) — built

Landed as the reset-token mechanism above: a short-lived, server-minted token
lets the user set their own password. It ended up simpler than sketched —
no new public endpoint was needed, since the token is a better-auth
reset-password `Verification` row redeemed by the existing
`POST /api/auth/reset-password`.

### 2. better-auth admin plugin (`createUser`)

`auth.api.createUser({ email, password, role, data: { schoolId } })` creates
User + Account **and** sets role/school in one atomic call.

- **Pro:** cleanest creation semantics; also gives ban / impersonate / list.
- **Con:** adds the plugin's own string `role` field (collides conceptually with
  our `Role` enum) plus `banned`/`banReason`/`banExpires` columns and endpoints
  we don't need — solves problems we don't have yet.

### 3. Transactional email — built

Invite emails for bulk student onboarding now reuse the `@hallpass/email`
package the password-reset flow added, delivering the option 1 set-password
link automatically on creation. See "Bulk student delivery" above and
`docs/AUTH.md`.
