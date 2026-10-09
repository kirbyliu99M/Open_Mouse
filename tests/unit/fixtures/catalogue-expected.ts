/**
 * The CAT-1 catalogue in numbers, kept in one place: the seed files together
 * produce these rows. A catalogue update changes this file and nothing else.
 * Not a test file itself.
 */
export const CATALOGUE_EXPECTED = {
  /** logitech.json rows. */
  seedRows: 38,
  /** Rows in catalogue.json (the approved candidates). */
  candidates: 406,
  /** Candidates merged into a logitech.json row. */
  merged: 15,
  /** Candidates that became rows of their own. */
  imported: 391,
  /** seedRows + imported. */
  rows: 429,
  /** Rows with listed = true. */
  listed: 411,
  /** Rows with listed = false (Logitech, neither G nor MX). */
  unlisted: 18,
  /** Rows with category = office. */
  office: 23,
  /** data_source = first_party: the 38 seed rows and the 8 `official` candidates. */
  firstParty: 46,
  /** data_source = eloshapes. */
  eloshapes: 383,
  /** Candidates whose descriptors are inferred. */
  inferred: 8,
} as const;
