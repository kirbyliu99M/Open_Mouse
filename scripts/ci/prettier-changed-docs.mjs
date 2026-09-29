// Entry point for the docs-only "Prettier on the changed docs" step of
// .github/workflows/ci.yml. Reads the NUL-separated list named by CHANGED_FILE and
// exits with Prettier's status. Details and failure rules: ./lib.mjs.
import { prettierMain } from "./lib.mjs";

process.exitCode = prettierMain();
