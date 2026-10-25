/**
 * V3.2 motion pass (candidate / 未拍板): the rules behind "nothing pops in or
 * out". `presenceStep` is what `<Presence>` follows when its owner shows and
 * hides it; `createLeave` is the leave of a dialog that closes itself; and
 * `enteringRowsFrom` picks the rows of the all-mice list that fade in.
 */
import { describe, expect, it, vi } from "vitest";
import { leaveMs } from "../../src/lib/motion";
import {
  createLeave,
  enteringRowsFrom,
  presenceStep,
  type PresencePhase,
} from "../../src/lib/presence";

describe("presenceStep", () => {
  it("opens on show from every phase (a show in the middle of leaving interrupts it)", () => {
    for (const phase of ["closed", "open", "leaving"] as PresencePhase[])
      expect(presenceStep(phase, "show")).toBe("open");
  });

  it("starts leaving on hide only from open", () => {
    expect(presenceStep("open", "hide")).toBe("leaving");
    expect(presenceStep("leaving", "hide")).toBe("leaving");
    expect(presenceStep("closed", "hide")).toBe("closed");
  });

  it("ends only a leave: a late timer does nothing to something shown again", () => {
    expect(presenceStep("leaving", "done")).toBe("closed");
    expect(presenceStep("open", "done")).toBe("open");
    expect(presenceStep("closed", "done")).toBe("closed");
  });

  it("show, hide, done: the whole life", () => {
    let phase: PresencePhase = "closed";
    for (const event of ["show", "hide", "done"] as const)
      phase = presenceStep(phase, event);
    expect(phase).toBe("closed");
  });
});

function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  return {
    pending,
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        pending.set(id, { fn, ms });
        return id;
      },
      clear: (id: unknown) => {
        pending.delete(id as number);
      },
    },
    runAll() {
      const run = [...pending.values()];
      pending.clear();
      run.forEach((t) => t.fn());
    },
  };
}

describe("createLeave", () => {
  const setup = (reduced = false) => {
    const t = fakeTimers();
    const finish = vi.fn();
    const onLeaving = vi.fn();
    const leave = createLeave({
      wait: () => leaveMs("sheet", reduced),
      finish,
      onLeaving,
      timers: t.timers,
    });
    return { t, finish, onLeaving, leave };
  };

  it("marks it leaving at once and finishes after leaveMs", () => {
    const { t, finish, onLeaving, leave } = setup();
    expect(leave.request()).toBe(true);
    expect(onLeaving).toHaveBeenCalledWith(true);
    expect(leave.leaving).toBe(true);
    expect(finish).not.toHaveBeenCalled();
    expect([...t.pending.values()][0]!.ms).toBe(240);
    t.runAll();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("waits the reduced-motion fade (120 ms) when asked for reduced motion", () => {
    const { t, leave } = setup(true);
    leave.request();
    expect([...t.pending.values()][0]!.ms).toBe(120);
  });

  it("a second request while leaving (Esc twice, the scrim during the slide) does nothing", () => {
    const { t, finish, leave } = setup();
    leave.request();
    expect(leave.request()).toBe(false);
    expect(t.pending.size).toBe(1);
    t.runAll();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("cancel stops the leave and says so; it can leave again later", () => {
    const { t, finish, onLeaving, leave } = setup();
    leave.request();
    leave.cancel();
    expect(onLeaving).toHaveBeenLastCalledWith(false);
    expect(leave.leaving).toBe(false);
    expect(t.pending.size).toBe(0);
    expect(leave.request()).toBe(true);
    t.runAll();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("never finishes after dispose (the owner unmounted it meanwhile)", () => {
    const { t, finish, leave } = setup();
    leave.request();
    leave.dispose();
    t.runAll();
    expect(finish).not.toHaveBeenCalled();
    expect(leave.request()).toBe(false);
  });
});

describe("enteringRowsFrom", () => {
  const base = { previousKey: "a", key: "a", previousShown: 20, shown: 20 };

  it("a new filter: every row from the top", () => {
    expect(enteringRowsFrom({ ...base, key: "b", shown: 20 })).toBe(0);
    expect(enteringRowsFrom({ ...base, key: "b", shown: 40 })).toBe(0);
  });

  it("「顯示更多」: the rows it added", () => {
    expect(enteringRowsFrom({ ...base, shown: 40 })).toBe(20);
  });

  it("nothing else (a search keystroke on the same filter, a re-render)", () => {
    expect(enteringRowsFrom(base)).toBeNull();
    expect(enteringRowsFrom({ ...base, shown: 10 })).toBeNull();
  });
});
