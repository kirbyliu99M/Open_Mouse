/**
 * V3.2 motion pass #7 (review fix, candidate / 未拍板): a change that arrives
 * while the shape toggle's change is still fading out first applies the held
 * one. Nothing is dropped, each `filter_applied` fires once, in order, and a
 * change computed from the filters on screen is rebased onto the held one.
 *
 * The page is simulated the way ResultsView wires it: `latest` is what was
 * last applied, `onScreen` what the page has rendered (it lags until React
 * renders), and `events` the `filter_applied` sources in order.
 */
import { describe, expect, it } from "vitest";
import { createChangeGate } from "../../src/lib/results/changeGate";

type F = { shape: string | null; brands: string[] };

function page(start: F) {
  const gate = createChangeGate<F>();
  let latest = start;
  let onScreen = start;
  const events: Array<{ source: string; prev: F; next: F }> = [];
  const commit = (next: F, source: string) => {
    events.push({ source, prev: latest, next });
    latest = next;
  };
  const withShape = (f: F, shape: string | null): F => ({ ...f, shape });
  return {
    gate,
    events,
    latest: () => latest,
    /** React renders what was applied. */
    render: () => {
      onScreen = latest;
    },
    /** The toggle: held for its fade-out, computed when applied. */
    toggle(shape: string | null) {
      return gate.hold({
        apply: () => commit(withShape(latest, shape), "shape_toggle"),
        rebase: (f) => withShape(f, shape),
      });
    },
    /** A chip (or the sidebar, the sheet): computed from the page on screen, applied at once. */
    removeBrand(brand: string) {
      const next = {
        ...onScreen,
        brands: onScreen.brands.filter((b) => b !== brand),
      };
      const under = gate.flush();
      commit(under(next), "chips");
    },
  };
}

const START: F = { shape: null, brands: ["Razer", "Logitech"] };

describe("createChangeGate", () => {
  it("a held change is applied when its fade-out ends, once", () => {
    const p = page(START);
    const id = p.toggle("ergonomic");
    expect(p.events).toHaveLength(0);
    expect(p.gate.holds(id)).toBe(true);
    expect(p.gate.release(id)).toBe(true);
    expect(p.gate.release(id)).toBe(false);
    expect(p.events.map((e) => e.source)).toEqual(["shape_toggle"]);
    expect(p.latest().shape).toBe("ergonomic");
  });

  it("toggle → chip within 160 ms: the toggle applies first, the chip builds on it, both fire in order", () => {
    const p = page(START);
    const id = p.toggle("ergonomic");
    // The chip is pressed before the fade-out ends and before any render.
    p.removeBrand("Razer");
    expect(p.events.map((e) => e.source)).toEqual(["shape_toggle", "chips"]);
    expect(p.events[1]!.prev).toEqual({
      shape: "ergonomic",
      brands: ["Razer", "Logitech"],
    });
    expect(p.latest()).toEqual({ shape: "ergonomic", brands: ["Logitech"] });
    // The toggle's own fade-out ends later: nothing more happens.
    expect(p.gate.holds(id)).toBe(false);
    expect(p.gate.release(id)).toBe(false);
    expect(p.events).toHaveLength(2);
  });

  it("chip → chip: each applies at once, the second on top of the first", () => {
    const p = page(START);
    p.removeBrand("Razer");
    p.render();
    p.removeBrand("Logitech");
    expect(p.events.map((e) => e.source)).toEqual(["chips", "chips"]);
    expect(p.latest()).toEqual({ shape: null, brands: [] });
  });

  it("toggle → toggle within 160 ms: the first is applied, then the second, both fire", () => {
    const p = page(START);
    const first = p.toggle("ergonomic");
    const second = p.toggle("symmetrical");
    expect(p.events.map((e) => e.next.shape)).toEqual(["ergonomic"]);
    expect(p.gate.release(first)).toBe(false);
    expect(p.gate.release(second)).toBe(true);
    expect(p.events.map((e) => e.source)).toEqual([
      "shape_toggle",
      "shape_toggle",
    ]);
    expect(p.events.map((e) => e.next.shape)).toEqual([
      "ergonomic",
      "symmetrical",
    ]);
  });

  it("chip → toggle: the toggle is computed from the latest filters when it applies", () => {
    const p = page(START);
    p.removeBrand("Razer");
    const id = p.toggle("ergonomic");
    p.gate.release(id);
    expect(p.latest()).toEqual({ shape: "ergonomic", brands: ["Logitech"] });
  });

  it("flush with nothing held changes nothing and returns identity", () => {
    const gate = createChangeGate<number>();
    expect(gate.flush()(5)).toBe(5);
  });
});
