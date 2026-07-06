import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: ".",
    exclude: ["**/node_modules/**", "tests/integration/**"],
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hallpass_test",
      BETTER_AUTH_URL: "http://localhost:3003",
      BETTER_AUTH_SECRET: "test-secret",
      CORS_ORIGIN: "http://localhost:3000",
      REDIS_URL: "redis://localhost:6379",
      REDIS_PREFIX: "test",
      INTERNAL_SECRET: "test-internal-secret",
    },
  },
});
