/**
 * The CAT-1 catalogue in numbers, kept in one place: the seed files together
 * produce these rows. A catalogue update changes this file and nothing else.
 * Not a test file itself.
 */
export const CATALOGUE_EXPECTED = {
  /** logitech.json rows. */
  seedRows: 38,
  /** Rows in catalogue.json (the approved candidates). */
  candidates: 409,
  /** Candidates merged into a logitech.json row. */
  merged: 18,
  /** Candidates that became rows of their own. */
  imported: 391,
  /** seedRows + imported. */
  rows: 429,
  /** Rows with listed = true. */
  listed: 408,
  /** Rows with listed = false: 18 other Logitech mice and 3 unsupported forms. */
  unlisted: 21,
  /** Rows with category = office. */
  office: 23,
  /** data_source = first_party: the 38 seed rows and the 8 `official` candidates. */
  firstParty: 46,
  /** data_source = public_compilation. */
  publicCompilation: 383,
  /** Candidates whose descriptors are inferred. */
  inferred: 11,
  /** Candidates whose shape values the site owner described (Kirby's 2026-10-20 MX rows), all merged into a Logitech row. */
  byOwner: 3,
  /** CAT-2: candidates by connectivity (wireless includes wired-and-wireless mice). */
  candidateConnectivity: { wired: 78, wireless: 330, unknown: 1 },
  /** CAT-2: every built row (seed rows + imported). */
  rowConnectivity: { wired: 79, wireless: 349, unknown: 1 },
  /** CAT-2: the listed rows only. */
  listedConnectivity: { wired: 78, wireless: 329, unknown: 1 },
} as const;
