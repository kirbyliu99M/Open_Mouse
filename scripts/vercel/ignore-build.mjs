// vercel.json `ignoreCommand`. Exit 0 = Vercel skips the build, exit 1 = it
// builds. Rules and why: ./lib.mjs. Always runs `ignoreBuildMain` (no "am I the
// main module?" guess), and any unexpected error builds rather than skips.
import { ignoreBuildMain } from "./lib.mjs";

await ignoreBuildMain();
