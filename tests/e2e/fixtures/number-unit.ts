import type { Locator } from "@playwright/test";

/** How many "number + unit" pairs were found, and which of them wrapped apart. */
export interface NumberUnitProbe {
  readonly pairs: number;
  readonly split: readonly string[];
}

/**
 * Finds every "84 mm", "13 g" or "40 cm" (a number, one space or no-break space,
 * a unit) in the matched elements, and reports the ones whose number and unit
 * end up on different lines.
 *
 * It does not depend on a font. Each element is squeezed to 1px, so every word
 * sits on its own line: the browser breaks at EVERY break opportunity it has.
 * A plain space is one; a no-break space (U+00A0) is not. A pair that survives
 * this stays whole at any width, in any font; one that does not is only waiting
 * for a wide enough font (CI's, or a user's text size) to split. (Squeezing to
 * `min-content` is not enough: that is the width of the widest word, and a
 * shorter pair like "84 mm" still fits on a line beside it.)
 */
export async function numberUnitPairs(
  locator: Locator,
): Promise<NumberUnitProbe> {
  return locator.evaluateAll((elements) => {
    const pattern = /\d[\d.,]*[\u00A0 ](?:mm|cm|g)(?![A-Za-z])/g;
    let pairs = 0;
    const split: string[] = [];
    for (const element of elements as HTMLElement[]) {
      const before = {
        width: element.style.width,
        minWidth: element.style.minWidth,
        maxWidth: element.style.maxWidth,
      };
      element.style.width = "1px";
      element.style.minWidth = "0";
      element.style.maxWidth = "none";

      // The element's text, and which text node each character sits in.
      const nodes: { node: Text; start: number }[] = [];
      let text = "";
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push({ node: n as Text, start: text.length });
        text += n.textContent ?? "";
      }
      const at = (offset: number, isEnd: boolean) => {
        // The node holding the character before an end offset, or at a start.
        const probe = isEnd ? offset - 1 : offset;
        for (let i = nodes.length - 1; i >= 0; i--) {
          const entry = nodes[i]!;
          if (probe >= entry.start)
            return { node: entry.node, offset: offset - entry.start };
        }
        return { node: nodes[0]!.node, offset: 0 };
      };

      for (const match of text.matchAll(pattern)) {
        pairs += 1;
        const start = at(match.index, false);
        const end = at(match.index + match[0].length, true);
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0);
        const centres = rects.map((r) => r.top + r.height / 2);
        const shortest = Math.min(...rects.map((r) => r.height));
        // Two lines are at least a line height apart; one line's boxes (a
        // smaller font in the same row) differ by far less than half of one.
        if (Math.max(...centres) - Math.min(...centres) > shortest / 2)
          split.push(match[0].replace("\u00A0", "<nbsp>"));
      }

      element.style.width = before.width;
      element.style.minWidth = before.minWidth;
      element.style.maxWidth = before.maxWidth;
    }
    return { pairs, split };
  });
}
