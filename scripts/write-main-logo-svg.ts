/**
 * Writes public/images/brand/palmate-main-logo.svg from the logo's data
 * (src/lib/brand/palmate-main-logo.ts). Run after changing the data:
 * `npm run brand:main-logo`. tests/unit/palmate-main-logo.test.ts fails while
 * the file and the data differ.
 */
import { writeFileSync } from "node:fs";
import { mainLogoSvg } from "../src/lib/brand/palmate-main-logo";

writeFileSync("public/images/brand/palmate-main-logo.svg", mainLogoSvg());
