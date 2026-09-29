// Entry point for the "Classify changed paths" step of .github/workflows/ci.yml.
// Rules, outputs and why: ./lib.mjs. It always runs `classifyMain` (no "am I the
// main module?" guess, so it cannot exit 0 having done nothing), and any error
// ends the process non-zero.
import { classifyMain } from "./lib.mjs";

classifyMain();
