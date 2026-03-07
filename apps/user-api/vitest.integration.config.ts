import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: ".",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/setup/integration-global.ts"],
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hallpass_test",
      BETTER_AUTH_URL: "http://localhost:3001",
      BETTER_AUTH_SECRET: "test-secret",
      CORS_ORIGIN: "http://localhost:3000",
    },
  },
});
