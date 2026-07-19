import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./src/test/vitestSetup.ts"],
    include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
    clearMocks: true,
    restoreMocks: true,
    fileParallelism: false,
    pool: "threads",
    maxWorkers: 1,
  },
});
