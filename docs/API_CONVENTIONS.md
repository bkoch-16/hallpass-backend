## HTTP Status Conventions

Semantic status codes for error responses:

- **404** — a genuinely-missing named resource. Example: `POST /passes` when the referenced school does not exist ("School not found").
- **403** — an authenticated user lacking a required association. Example: `requireSchool` when the user has no school ("User is not associated with a school").
- **422** — a business-rule / validation failure. Examples: "No active period", "Pass limit reached".
