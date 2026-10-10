/**
 * The 3D size illustration inside the results page's Details section (#126) is
 * hidden until it is finished (hotfix, 2026-10-10). Nothing mounts, loads
 * `three` or the Draco decoder, or calls the measurements route while this is
 * false. The viewer's code, its unit tests and its e2e spec stay in the repo;
 * switching this to true brings the illustration back, and the viewer e2e specs
 * run again with it.
 */
export const RESULTS_VIEWER_ENABLED = false;
