/**
 * Minimal ambient declaration for js-aruco2's other untyped CJS entry
 * point. `src/client/photo/card.ts` is the one caller and types the
 * `CV` surface it actually uses locally (see that file's header for why —
 * same reasoning as `src/types/js-aruco2.d.ts` for `aruco.js`), so this
 * only needs to make the import resolvable to TypeScript, not describe its
 * shape.
 */
declare module "js-aruco2/src/cv.js" {
  const cvModuleExports: unknown;
  export default cvModuleExports;
}
