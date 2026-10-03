import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HELD_OUT_SEED,
  blockMembers,
  blockOf,
  classifyParticipants,
  formatParticipant,
  heldOutHash,
  heldOutIdsInRange,
  heldOutOfBlock,
  participantNumber,
} from "../../src/lib/m2/heldout";

// The 50 ids the frozen prereg lists for P001-P200, copied here by hand.
const PREREG_HELD_OUT =
  "P004 P006 P010 P013 P020 P023 P026 P031 P036 P039 P043 P045 P051 P053 P060 P064 P067 P070 P074 P078 P083 P086 P089 P093 P100 P104 P107 P112 P115 P119 P121 P125 P132 P135 P137 P141 P145 P150 P155 P159 P161 P167 P170 P174 P177 P181 P187 P189 P196 P199".split(
    " ",
  );

const range = (first: number, last: number) =>
  Array.from({ length: last - first + 1 }, (_, i) =>
    formatParticipant(first + i),
  );

describe("the held-out rule of the frozen prereg", () => {
  it("uses the seed the prereg freezes", () => {
    expect(HELD_OUT_SEED).toBe("bec9449f79d85ac5");
  });

  it("hashes the UTF-8 string <seed>:<P###> with SHA-256, lowercase hex", () => {
    // Worked out outside this code (node's crypto on the literal strings).
    expect(heldOutHash("P001")).toBe(
      "493df7c561b70b151c28e841dc0729302862187ebf7554be0d8315f66c568e05",
    );
    expect(heldOutHash("P004")).toBe(
      "1317d1959cb3411bc641b9335bf83db99e8dbe10413096538f3004a700f75a58",
    );
    expect(heldOutHash("P004", "another-seed")).not.toBe(heldOutHash("P004"));
  });

  it("the first block is P001-P004 and its held-out member is the smallest hash (P004)", () => {
    expect(blockMembers(0)).toEqual(["P001", "P002", "P003", "P004"]);
    expect(heldOutOfBlock(0)).toBe("P004");
    expect(blockMembers(1)).toEqual(["P005", "P006", "P007", "P008"]);
    expect(blockOf(1)).toBe(0);
    expect(blockOf(4)).toBe(0);
    expect(blockOf(5)).toBe(1);
    expect(blockOf(200)).toBe(49);
  });

  it("reproduces exactly the 50 held-out ids the prereg lists for P001-P200", () => {
    expect(PREREG_HELD_OUT).toHaveLength(50);
    expect(heldOutIdsInRange(1, 200)).toEqual(PREREG_HELD_OUT);
    const roles = classifyParticipants(range(1, 200));
    const heldOut = range(1, 200).filter((id) => roles.get(id) === "held-out");
    expect(heldOut).toEqual(PREREG_HELD_OUT);
    // Exactly one in four, the other three for calibration.
    expect([...roles.values()].filter((r) => r === "calibration")).toHaveLength(
      150,
    );
  });

  // Version 1 and version 2 of the prereg both carry the rule and the list:
  // version 2 (Kirby, 2026-10-02) left them unchanged.
  it.each([
    ["version 1", "prereg-2026-10-02.frozen.txt"],
    ["version 2", "prereg-2026-10-02-v2.frozen.txt"],
  ])("agrees with the list in the frozen prereg file, %s", (_version, name) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const file = join(
      resolve(here, "..", ".."),
      "docs",
      "design",
      "learning-kit-v2-proposal-2026-10-02",
      name,
    );
    const text = readFileSync(file, "utf8");
    // The line after "(50 位)：" holds the list.
    const after = text.split(/50 位）：/)[1] ?? "";
    const line = after.split("\n").find((l) => /P\d{3}/.test(l)) ?? "";
    expect(line.match(/P\d{3}/g)).toEqual(PREREG_HELD_OUT);
    // The seed is the one in the code.
    expect(text).toContain(HELD_OUT_SEED);
  });

  it("each block has exactly one held-out member, and it is the smallest hash of the four", () => {
    for (let block = 0; block < 50; block++) {
      const members = blockMembers(block);
      const smallest = [...members].sort((a, b) =>
        heldOutHash(a) < heldOutHash(b) ? -1 : 1,
      )[0];
      expect(heldOutOfBlock(block)).toBe(smallest);
    }
  });
});

describe("only complete blocks count", () => {
  it("a block missing a member is pending: neither calibration nor held-out", () => {
    // P001-P004 complete; P005-P007 are three of four.
    const roles = classifyParticipants(range(1, 7));
    expect(roles.get("P004")).toBe("held-out");
    expect(roles.get("P001")).toBe("calibration");
    expect(roles.get("P002")).toBe("calibration");
    expect(roles.get("P003")).toBe("calibration");
    for (const id of ["P005", "P006", "P007"]) {
      expect(roles.get(id)).toBe("pending");
    }
  });

  it("the member that completes a block decides it; a gap anywhere in the block keeps it pending", () => {
    expect(classifyParticipants(["P005", "P006", "P007"]).get("P006")).toBe(
      "pending",
    );
    const complete = classifyParticipants(["P005", "P006", "P007", "P008"]);
    // Block 1's held-out is P006 (from the prereg list).
    expect(complete.get("P006")).toBe("held-out");
    expect(complete.get("P005")).toBe("calibration");
    // A gap in numbering is a gap: P001, P002, P004 and P005 do not make a block.
    const gap = classifyParticipants(["P001", "P002", "P004", "P005"]);
    expect([...gap.values()]).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("stopping half-way never changes a decided block", () => {
    const early = classifyParticipants(range(1, 10));
    const later = classifyParticipants(range(1, 40));
    for (const id of range(1, 8)) expect(early.get(id)).toBe(later.get(id));
    expect(early.get("P009")).toBe("pending");
    expect(early.get("P010")).toBe("pending");
    expect(later.get("P010")).toBe("held-out");
  });

  it("S0 ids (P901-P912) are never calibration and never held-out, even in a full block", () => {
    const roles = classifyParticipants(range(901, 912));
    for (const id of range(901, 912)) expect(roles.get(id)).toBe("s0");
    // P913 starts a new block, so S0 does not complete or disturb it.
    const next = classifyParticipants([...range(901, 916)]);
    expect(next.get("P912")).toBe("s0");
    const afterS0 = range(913, 916).map((id) => next.get(id));
    expect(afterS0.filter((r) => r === "held-out")).toHaveLength(1);
    expect(afterS0.filter((r) => r === "calibration")).toHaveLength(3);
    expect(next.get("P900")).toBeUndefined();
  });

  it("an id that is not P001-P999 is in no block", () => {
    const roles = classifyParticipants([
      "P000",
      "P1000",
      "x001",
      "P01",
      "P001",
    ]);
    expect(roles.get("P000")).toBe("unnumbered");
    expect(roles.get("P1000")).toBe("unnumbered");
    expect(roles.get("x001")).toBe("unnumbered");
    expect(roles.get("P01")).toBe("unnumbered");
    expect(roles.get("P001")).toBe("pending");
    expect(participantNumber("P000")).toBeNull();
    expect(participantNumber("P001")).toBe(1);
    expect(participantNumber("P999")).toBe(999);
  });

  it("a range that cuts a block in half does not count that block", () => {
    // P003-P010: block 0 has only P003 and P004, block 2 (P009-P012) only P009 and P010.
    expect(heldOutIdsInRange(3, 10)).toEqual(["P006"]);
  });
});
