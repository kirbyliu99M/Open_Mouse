export interface AccountScanMeasurements {
  handLengthMm: number;
  palmLengthMm: number;
  palmWidthMm: number;
  thumbLengthMm: number | null;
  indexLengthMm: number | null;
  middleLengthMm: number | null;
  ringLengthMm: number | null;
  pinkyLengthMm: number | null;
  palmThicknessMm: number | null;
  knuckleHeightMm: number | null;
  gripApertureMm: number | null;
  thumbAngleDeg: number | null;
}

export interface AccountScan {
  scanId: string;
  /** ISO 8601. */
  createdAt: string;
  hand: "left" | "right";
  gripStyleStated: "palm" | "claw" | "fingertip" | null;
  measurements: AccountScanMeasurements;
}

/**
 * The DB seam for `/account` and its API routes. Scoped to a `userId` that
 * comes from the signed-in session (`auth()`), never from anything a client
 * could supply — see `handlers.ts`.
 */
export interface AccountRepo {
  /** Every scan across every `scan_sessions` row this user owns, newest first. */
  listScans(userId: string): Promise<AccountScan[]>;
  /** Deletes the account: all of this user's `scan_sessions` rows (cascades
   * to scans and measurements), every survey contribution they made
   * (src/lib/contracts/survey.ts: "Delete everything" must withdraw it too),
   * and the `users` row itself (its Google email, name and image; cascades to
   * `accounts` and `auth_sessions`, so every browser they were signed in on is
   * signed out), in one atomic operation. Returns the number of scans removed. */
  deleteAllScans(userId: string): Promise<number>;
}
