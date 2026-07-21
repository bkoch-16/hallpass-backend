# Web-Client Auth

How a browser SPA authenticates against the three APIs. This is the
supported flow — do not build cookie-based auth for the web client without
revisiting the decision below.

---

## Why Bearer, not cookies

`user-api`, `schools-api`, and `passes-api` deploy to three separate
`*.run.app` Cloud Run hosts. `run.app` is on the Public Suffix List, so it is
treated as a registrable-domain boundary — a cookie set by one `*.run.app`
host is never sent to another. There is no cookie a browser can attach that
covers all three origins.

The alternative — fronting all three services with one shared custom domain
so a single httpOnly cookie works everywhere — needs a load balancer (or
equivalent path-based routing) plus a domain, which is a real recurring cost.
Given this project's cost posture (scale-to-zero, free-tier infra
everywhere), that was deferred. Instead, the `bearer()` plugin
(`packages/auth/src/index.ts`) is enabled and the web client carries its own
session token instead of relying on cookies. See **Future option** below for
the upgrade path if the project outgrows this.

---

## Sign-in

Accounts are provisioned by admins (see `docs/ONBOARDING.md`) —
`POST /api/auth/sign-up/email` is disabled
(`emailAndPassword.disableSignUp: true`, `packages/auth/src/index.ts`) and
rejects with `BAD_REQUEST`. Only `POST /api/auth/sign-in/email` is used
client-side.

Sign in against the **user-api** origin (the only service that mounts
`/api/auth/*` — `apps/user-api/src/app.ts`):

```
POST https://user-api-<env>.<region>.run.app/api/auth/sign-in/email
Content-Type: application/json

{ "email": "...", "password": "..." }
```

better-auth's `bearer()` plugin reads the session cookie the request would
otherwise set and echoes it back as a response header:

```
set-auth-token: <token>
Access-Control-Expose-Headers: set-auth-token, ...
```

(the plugin adds `set-auth-token` to `Access-Control-Expose-Headers` itself —
`corsOptions` does not set `exposedHeaders`, so nothing needs to change on the
CORS side for the browser to read it.)

Capture `set-auth-token` from the sign-in response and store it. This is the
only credential the client needs going forward — the session cookie set-auth-token
is derived from is not otherwise usable across origins.

**Session refresh note:** better-auth also re-issues `set-auth-token` on any
response where it renews the session cookie — this includes `get-session`
calls that land inside the `updateAge` window (see below), not only
sign-in. Sign-out never re-issues it (`deleteSessionCookie` sets `max-age: 0`,
which the plugin explicitly skips).

---

## Storage: the XSS trade-off

Because the token must be attached manually to every request, it has to live
somewhere JS can read it (memory, `sessionStorage`, or similar) — it cannot be
httpOnly. That means it is exfiltratable from JS if the page is ever
compromised by injected script.

Mitigations expected of the client:

- A strict CSP — no inline scripts, no unvetted third-party script tags.
- No third-party script injection (ad tags, unaudited widgets, etc.).
- Accept the blast radius as bounded by the session lifetime: `expiresIn` is
  7 days (`packages/auth/src/index.ts`), so a stolen token is not a permanent
  compromise.

This is a deliberate trade-off, not an oversight — see **Decision context**
above for why cookies aren't an option here.

---

## REST requests

Attach the token to every request, to all three services:

```
Authorization: Bearer <token>
```

Check whether a session is still valid the same way:

```
GET https://user-api-<env>.<region>.run.app/api/auth/get-session
Authorization: Bearer <token>
```

`schools-api` and `passes-api` don't expose `/api/auth/*` themselves — they
validate the Bearer token against the same better-auth instance config
(shared `BETTER_AUTH_SECRET`/`BETTER_AUTH_URL`/DB) via `requireAuth` /
`resolveSessionUser` (`packages/middleware/src/auth.ts`). Sign-in / sign-out /
get-session calls always go to the user-api origin; the resulting token is
what authorizes requests everywhere.

Rate limiting note: the strict auth limiter only wraps
`sign-in/sign-up/request-password-reset/reset-password/change-password` on
user-api (`apps/user-api/src/app.ts`); `GET /api/auth/get-session` and all
other requests ride the general limiter.

---

## Password reset

`POST /api/auth/request-password-reset` (user-api) with `{ "email": "..." }`
always returns 200; if the account exists, better-auth generates a single-use
token (1-hour expiry, stored in the `Verification` table) and the
`sendResetPassword` hook (`packages/auth/src/index.ts`, wired in
`apps/user-api/src/auth.ts`) emails a link via `@hallpass/email` (Amazon
SES). The link points at `WEB_APP_URL`/reset-password.html?token=…— today
the demo UI's static page — which submits
`POST /api/auth/reset-password` with `{ "newPassword": "...", "token": "..." }`.

Without SES env configured (local dev, tests), the email is logged instead of
sent, with the reset URL in the log line. Both endpoints ride the strict auth
rate limiter (see note above).

### Invites

Provisioning (`POST /api/users` and `POST /api/users/bulk`, user-api) emails
each successfully created user an invite via `@hallpass/email` — same
mechanism as password reset above: a `Verification` token redeemed by the
existing `POST /api/auth/reset-password`. The difference is the token is
minted server-side by `createSetPasswordToken`
(`packages/auth/src/index.ts:111`) rather than by better-auth's own
request-password-reset flow, with a 7-day expiry instead of 1 hour. See
`docs/ONBOARDING.md` for the full provisioning flow.

Browsers cannot set an `Authorization` header on a WebSocket upgrade, so
`socket.io-client` carries the token through its `auth` option instead, which
works on every transport including `websocket`:

```js
import { io } from "socket.io-client";

const socket = io(PASSES_API_URL, {
  auth: { token },
});
```

Server-side, `passes-api` reads `handshake.auth.token` and synthesizes it into
a Bearer `authorization` header before resolving the session — but only when
no `Authorization` header is already present on the handshake
(`apps/passes-api/src/lib/socket.ts`):

```ts
const token = socket.handshake.auth?.token;
const headers =
  typeof token === "string" && token && !socket.handshake.headers.authorization
    ? { ...socket.handshake.headers, authorization: `Bearer ${token}` }
    : socket.handshake.headers;
```

If a client can set a real `Authorization` header on the handshake (e.g. a
non-browser client using `extraHeaders`), that takes precedence over `auth.token`.

---

## Sign-out

```
POST /api/auth/sign-out
Authorization: Bearer <token>
```

Then discard the stored token client-side. The server deletes the session row
and expires the cookie; no new `set-auth-token` is issued on this response.

---

## Future option: shared custom domain

If the project outgrows scale-to-zero/free-tier constraints, the upgrade path
is to front all three services under one custom domain (e.g.
`api.example.com/user`, `/schools`, `/passes` via a load balancer or
path-based router) and rely on the session cookie alone. The cookie is
already httpOnly today — it is just undeliverable across the three
`*.run.app` origins; one shared origin makes it reach every service. That
would mean:

- Provisioning a load balancer (or equivalent) and a domain — ongoing cost,
  which is why this is deferred rather than done now.
- Routing all three services under that one origin so a single cookie covers
  them.
- Removing the `bearer()` plugin and the client-side token handling above,
  including the Socket.io `auth.token` bridge (the cookie would ride the
  WebSocket upgrade automatically).

Not planned until the cost/complexity is justified.
