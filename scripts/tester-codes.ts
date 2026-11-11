/**
 * Prints N tester codes (P01-XXXXXX ...), crypto random, for Kirby to hand
 * out one per person and to put, comma-separated, in the server env
 * `TESTER_CODES` (candidate 未拍板; contract src/lib/contracts/tester.ts).
 *
 *   npx tsx scripts/tester-codes.ts 20
 *
 * Nothing is stored or sent: the codes exist only in this output.
 */
import { randomBytes } from "node:crypto";
import { generateTesterCodes } from "./tester-lib";

const n = Number(process.argv[2] ?? "");
try {
  const codes = generateTesterCodes(n, (size) => randomBytes(size));
  for (const code of codes) console.log(code);
  console.log("");
  console.log(`TESTER_CODES=${codes.join(",")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Usage: npx tsx scripts/tester-codes.ts <N>");
  process.exit(1);
}
