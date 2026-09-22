/**
 * Minimal ambient types for js-aruco2's deep, untyped CJS entry points.
 * Used only by tests/unit/aruco-codes.test.ts, which imports the real
 * dependency as ground truth for the vendored codes in
 * src/client/sheet/aruco-codes.ts — see that file for why the app itself
 * doesn't import js-aruco2 directly.
 */
declare module "js-aruco2/src/aruco.js" {
  interface ArucoDictionaryDefinition {
    readonly nBits: number;
    readonly tau: number;
    readonly codeList: readonly number[];
  }
  interface ArucoNamespace {
    readonly DICTIONARIES: Readonly<Record<string, ArucoDictionaryDefinition>>;
  }
  const moduleExports: { readonly AR: ArucoNamespace };
  export default moduleExports;
}

declare module "js-aruco2/src/dictionaries/aruco_mip_36h12.js" {
  // Imported only for its side effect of registering the dictionary on the
  // shared AR namespace above.
  const sideEffectExports: Readonly<Record<string, never>>;
  export default sideEffectExports;
}
