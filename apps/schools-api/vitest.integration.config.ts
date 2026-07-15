import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    fileParallelism: false,
    root: ".",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/setup/integration-global.ts"],
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/hallpass_test_schools",
      BETTER_AUTH_URL: "http://localhost:3002",
      BETTER_AUTH_SECRET: "test-secret",
      CORS_ORIGIN: "http://localhost:3000",
      REDIS_URL: "redis://localhost:6379",
      REDIS_PREFIX: "test",
      PARENT_TOOL_API_KEY: "test-parent-tool-api-key",
    },
  },
});
