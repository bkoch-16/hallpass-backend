-- Session.id and Account.id: TEXT (cuid) -> SERIAL (INT autoincrement).
-- better-auth's generateId: "serial" coerces every where-by-id to a number,
-- so cuid string ids break flows like change-password (Number("cmk...") = NaN).
-- cuids cannot be cast to INTEGER, so ids are regenerated: nothing references
-- Session.id or Account.id, and sessions are ephemeral (users re-authenticate).

-- Session: drop all rows (active users just sign in again), then rebuild id
DELETE FROM "Session";
ALTER TABLE "Session" DROP CONSTRAINT "Session_pkey";
ALTER TABLE "Session" DROP COLUMN "id";
ALTER TABLE "Session" ADD COLUMN "id" SERIAL;
ALTER TABLE "Session" ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("id");

-- Account: rows preserved (credential password hashes live here); only the
-- surrogate id is regenerated
ALTER TABLE "Account" DROP CONSTRAINT "Account_pkey";
ALTER TABLE "Account" DROP COLUMN "id";
ALTER TABLE "Account" ADD COLUMN "id" SERIAL;
ALTER TABLE "Account" ADD CONSTRAINT "Account_pkey" PRIMARY KEY ("id");
