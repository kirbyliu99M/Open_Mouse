import type { FitResponse } from "@/lib/contracts/fit";
import type { Locale } from "@/lib/contracts/locale";
import { resultsScreensCopy } from "@/lib/copy/results-screens";
import { dimensionDelta, formatMmValue, formatSignedMmValue } from "./format";

type Targets = FitResponse["targets"];
type Mouse = FitResponse["results"][number]["mouse"];

const ROWS: {
  key: keyof Targets;
  mouseKey: keyof Mouse;
  label: "rowLength" | "rowGripWidth" | "rowHeight";
}[] = [
  { key: "lengthMm", mouseKey: "lengthMm", label: "rowLength" },
  { key: "gripWidthMm", mouseKey: "widthMm", label: "rowGripWidth" },
  { key: "heightMm", mouseKey: "heightMm", label: "rowHeight" },
];

/**
 * "Your ideal mouse" targets next to this mouse's actual dimensions, with
 * the plain actual-minus-target delta. Not a fit-engine reason — just two
 * numbers already in the response, read next to each other.
 */
export function TargetDeltas({
  targets,
  mouse,
  language,
}: {
  targets: Targets;
  mouse: Mouse;
  language: Locale;
}) {
  const copy = resultsScreensCopy(language).targetDeltas;
  return (
    <table className="results-targetDeltas">
      <caption>{copy.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{copy.dimension}</th>
          <th scope="col">{copy.ideal}</th>
          <th scope="col">{copy.thisMouse}</th>
          <th scope="col">{copy.diff}</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map(({ key, mouseKey, label }) => {
          const targetMm = targets[key];
          const actualMm = mouse[mouseKey] as number;
          const delta = dimensionDelta(actualMm, targetMm);
          return (
            <tr key={key}>
              <th scope="row">{copy[label]}</th>
              <td className="results-tabularNum">{formatMmValue(targetMm)}</td>
              <td className="results-tabularNum">{formatMmValue(actualMm)}</td>
              <td className="results-tabularNum">
                {formatSignedMmValue(delta)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
