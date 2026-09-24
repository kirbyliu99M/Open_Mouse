import type { FitResponse } from "@/lib/contracts/fit";
import { dimensionDelta, formatMmValue, formatSignedMmValue } from "./format";

type Targets = FitResponse["targets"];
type Mouse = FitResponse["results"][number]["mouse"];

const ROWS: { key: keyof Targets; mouseKey: keyof Mouse; label: string }[] = [
  { key: "lengthMm", mouseKey: "lengthMm", label: "Length" },
  { key: "gripWidthMm", mouseKey: "widthMm", label: "Grip width" },
  { key: "heightMm", mouseKey: "heightMm", label: "Height" },
];

/**
 * "Your ideal mouse" targets next to this mouse's actual dimensions, with
 * the plain actual-minus-target delta. Not a fit-engine reason — just two
 * numbers already in the response, read next to each other.
 */
export function TargetDeltas({
  targets,
  mouse,
}: {
  targets: Targets;
  mouse: Mouse;
}) {
  return (
    <table className="results-targetDeltas">
      <caption>Your ideal mouse vs. this mouse (mm)</caption>
      <thead>
        <tr>
          <th scope="col">Dimension</th>
          <th scope="col">Your ideal</th>
          <th scope="col">This mouse</th>
          <th scope="col">Diff.</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map(({ key, mouseKey, label }) => {
          const targetMm = targets[key];
          const actualMm = mouse[mouseKey] as number;
          const delta = dimensionDelta(actualMm, targetMm);
          return (
            <tr key={key}>
              <th scope="row">{label}</th>
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
