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

## Open problem — bulk student delivery

You can't ask hundreds of students to self-register and then reconcile them
against a roster. The server-side credential creation this needs now exists:
`POST /api/users/bulk` provisions login-capable `User` + `Account` rows and
returns a per-item result. What's still unsolved is **delivery** — the bulk
route returns a `created`/`failed` summary, not the individual temp passwords,
so there is no mechanism to get a credential into each student's hands. Pick a
delivery mechanism from the options below (set-password link or transactional
email) when the feature is actually on the table.

---

## Future optimizations

Deferred until a concrete need appears. Ordered lightest-first.

### 1. `signUpEmail` + set-password link (no email)

Same creation, but instead of returning a password, return a signed,
short-lived token as a `/set-password?token=...` link. The user sets their own
password via a new public endpoint. This is the correct onboarding primitive and
is forward-compatible with email invites (swap "return link" for "email link").

- **Pro:** user owns the password; token expires; upgrade path to real invites.
- **Con:** a new public endpoint + token verification to build and secure.

### 2. better-auth admin plugin (`createUser`)

`auth.api.createUser({ email, password, role, data: { schoolId } })` creates
User + Account **and** sets role/school in one atomic call.

- **Pro:** cleanest creation semantics; also gives ban / impersonate / list.
- **Con:** adds the plugin's own string `role` field (collides conceptually with
  our `Role` enum) plus `banned`/`banReason`/`banExpires` columns and endpoints
  we don't need — solves problems we don't have yet.

### 3. Transactional email

Password-reset email now exists: `@hallpass/email` sends via Amazon SES
(wired into `sendResetPassword`, see `docs/AUTH.md`). Invite emails for bulk
student onboarding (option 1) can reuse that package when built.
