import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig.json says "jsx": "preserve" (Next compiles the JSX itself), which
  // vite refuses to transform. Say how to compile it here so a unit test can
  // render a component (tests/unit/error-screens.test.ts).
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*", which only affects
    // type-checking; vite/vitest needs its own runtime alias.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
