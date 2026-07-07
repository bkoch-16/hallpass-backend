import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the workspace middleware package to its TS source so vitest
      // processes it and vi.mock("@hallpass/db") applies to its internal
      // imports (the compiled dist is externalized and bypasses mocks).
      "@hallpass/express-middleware": fileURLToPath(
        new URL("../../packages/middleware/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    root: ".",
    exclude: ["**/node_modules/**", "tests/integration/**"],
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hallpass_test",
      BETTER_AUTH_URL: "http://localhost:3002",
      BETTER_AUTH_SECRET: "test-secret",
      CORS_ORIGIN: "http://localhost:3000",
    },
  },
});
