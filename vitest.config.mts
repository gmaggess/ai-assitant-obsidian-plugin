import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests import src modules that `import ... from "obsidian"`.
    // Swap in a lightweight mock so they run in plain Node.
    alias: {
      obsidian: path.resolve("./tests/mocks/obsidian.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
