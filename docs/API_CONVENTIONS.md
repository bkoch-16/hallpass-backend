## HTTP Status Conventions

Semantic status codes for error responses:

- **404** — a genuinely-missing named resource resolved from server-side / authenticated context (not user-supplied body input). Example: `POST /passes` when the school derived from the authenticated user does not exist ("School not found").
- **403** — an authenticated user lacking a required association. Example: `requireSchool` when the user has no school ("User is not associated with a school").
- **422** — a business-rule / validation failure, including a bad reference to an entity named in the **request body** (user-supplied input). Examples: "No active period", "Pass limit reached", "Destination not found" and "Student not found" on `POST /passes` (both `destinationId` and `studentId` come from the request body).
- **409** — the named resource exists but is in the wrong state for the requested transition, including the race where a concurrent request already moved it. Example: approve/deny/return/cancel on a pass that isn't PENDING/ACTIVE/etc.
