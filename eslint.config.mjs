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
  // three.js (about 150 kB gzipped) is for the results page's viewer only, and
  // only through a dynamic import() of src/components/viewer/mouse-viewer.ts.
  // An import of it anywhere else would put it in a shared chunk and in every
  // route's first load. tests/unit/viewer-three-boundary.test.ts checks the same
  // thing, and also that mouse-viewer is reached only through import().
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    ignores: ["src/components/viewer/mouse-viewer.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["three", "three/*"],
              message:
                "three.js is imported only by src/components/viewer/mouse-viewer.ts, which is loaded with a dynamic import().",
            },
          ],
        },
      ],
    },
  },
];

export default config;
