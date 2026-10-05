import { FlatCompat } from "@eslint/eslintrc";
import prettier from "eslint-config-prettier";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      ".vercel/**",
      // Vendored, unmodified third-party build output (WASM loader glue) —
      // see public/mediapipe/README for provenance. Not app code.
      "public/mediapipe/**",
      // Vendored, unmodified Draco decoder (see public/draco/README.md).
      "public/draco/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  prettier,
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
];

export default config;
