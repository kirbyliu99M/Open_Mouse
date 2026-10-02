/**
 * The held-out rule of the frozen prereg (2026-10-02, section 3), as a pure
 * function. Nothing here is a choice: the seed, the block size and the way the
 * winner of a block is picked are written down in
 * docs/design/learning-kit-v2-proposal-2026-10-02/prereg-2026-10-02.frozen.txt,
 * and a test reproduces the 50 ids that file lists for P001-P200.
 *
 * The rule: participants P### come in blocks of four (P001-P004, P005-P008,
 * ...). In each block the held-out participant is the one whose lowercase hex
 * SHA-256 of `<seed>:<P###>` (UTF-8) is the smallest string; the other three
 * are for calibration. Only complete blocks count, so stopping a collection
 * half-way never turns a participant into held-out after the fact. S0 ids
 * (P901-P912) are never calibration and never held-out.
 *
 * "Complete" is judged on the ids the evaluator is given: a block whose four
 * members are not all present is `pending`, and a pending participant is left
 * out of calibration too, because the missing member could still turn out to
 * be the one with the smallest hash, which would make an earlier look at the
 * others a look at held-out data.
 */
import { createHash } from "node:crypto";
import { isS0Participant } from "../learning/session";

/** Drawn on 2026-10-02 by the operating system's cryptographic random source; frozen by the prereg. */
export const HELD_OUT_SEED = "bec9449f79d85ac5" as const;

export const HELD_OUT_BLOCK_SIZE = 4 as const;

/** Where a participant stands under the rule. */
export type ParticipantRole =
  | "held-out"
  | "calibration"
  /** One of the S0 pilot ids: settles the protocol, never calibration, never held-out. */
  | "s0"
  /** Its block does not have all four members yet, so its role is not decided. */
  | "pending"
  /** Not a P001-P999 id, so it is in no block. */
  | "unnumbered";

const PARTICIPANT_ID = /^P(\d{3})$/;

/** The number in a `P###` id, 1 to 999; `null` for anything else (P000 included: blocks start at P001). */
export function participantNumber(id: string): number | null {
  const m = PARTICIPANT_ID.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
}

export function formatParticipant(n: number): string {
  return `P${String(n).padStart(3, "0")}`;
}

/** Zero-based block of a participant number: P001-P004 are block 0. */
export function blockOf(n: number): number {
  return Math.floor((n - 1) / HELD_OUT_BLOCK_SIZE);
}

/** The four ids of a block, in order. */
export function blockMembers(block: number): string[] {
  return Array.from({ length: HELD_OUT_BLOCK_SIZE }, (_, i) =>
    formatParticipant(block * HELD_OUT_BLOCK_SIZE + i + 1),
  );
}

/** Lowercase hex SHA-256 of `<seed>:<id>`, the UTF-8 bytes of that string. */
export function heldOutHash(id: string, seed: string = HELD_OUT_SEED): string {
  return createHash("sha256").update(`${seed}:${id}`, "utf8").digest("hex");
}

/** The held-out member of a block: the one with the smallest hash string. */
export function heldOutOfBlock(
  block: number,
  seed: string = HELD_OUT_SEED,
): string {
  const [first, ...rest] = blockMembers(block).map((id) => ({
    id,
    hash: heldOutHash(id, seed),
  }));
  let best = first!;
  for (const m of rest) if (m.hash < best.hash) best = m;
  return best.id;
}

/**
 * Every participant's role, from the ids present. S0 ids are `s0` whatever
 * else is known. Each other id in a block with all four members present is
 * `held-out` or `calibration`; in an incomplete block it is `pending`.
 */
export function classifyParticipants(
  ids: Iterable<string>,
  seed: string = HELD_OUT_SEED,
): Map<string, ParticipantRole> {
  const present = new Set(ids);
  const roles = new Map<string, ParticipantRole>();
  const heldOutOf = new Map<number, string>();
  for (const id of [...present].sort()) {
    if (isS0Participant(id)) {
      roles.set(id, "s0");
      continue;
    }
    const n = participantNumber(id);
    if (n === null) {
      roles.set(id, "unnumbered");
      continue;
    }
    const block = blockOf(n);
    const complete = blockMembers(block).every((member) => present.has(member));
    if (!complete) {
      roles.set(id, "pending");
      continue;
    }
    let heldOut = heldOutOf.get(block);
    if (heldOut === undefined) {
      heldOut = heldOutOfBlock(block, seed);
      heldOutOf.set(block, heldOut);
    }
    roles.set(id, id === heldOut ? "held-out" : "calibration");
  }
  return roles;
}

/** The held-out ids among P<first> to P<last>, counting only blocks that lie wholly inside that range. */
export function heldOutIdsInRange(
  first: number,
  last: number,
  seed: string = HELD_OUT_SEED,
): string[] {
  const ids: string[] = [];
  for (let n = Math.max(first, 1); n <= last; n++)
    ids.push(formatParticipant(n));
  const roles = classifyParticipants(ids, seed);
  return ids.filter((id) => roles.get(id) === "held-out");
}
