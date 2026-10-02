import { SHEET } from "@/lib/contracts/measurement";
import {
  ARUCO_MARKER_MODULES,
  markerBitGrid,
} from "@/client/sheet/aruco-codes";
import type { MarkerLayout } from "@/client/sheet/layout";

/**
 * One printed ArUco marker, drawn in sheet millimetres. Shared by the
 * calibration sheet (`/sheet`) and the learning kit (`/learn/print`) so both
 * print byte-identical markers.
 */
export function MarkerGlyph({
  marker,
  label = true,
}: {
  marker: MarkerLayout;
  /** Print the small "id N" caption. Kit v2 sheets leave it out: they keep every printed element clear of the hand area. */
  label?: boolean;
}) {
  const grid = markerBitGrid(marker.id);
  const moduleSizeMm = marker.sizeMm / ARUCO_MARKER_MODULES;
  const outerTopLeft = marker.corners[0];
  const isFlat = (SHEET.flatMarkerIds as readonly number[]).includes(marker.id);
  // Point the id label into the marker square's interior so it never
  // strays into the page margin.
  const labelY = isFlat
    ? marker.id === SHEET.flatMarkerIds[2] ||
      marker.id === SHEET.flatMarkerIds[3]
      ? marker.corners[0].y - 2
      : marker.corners[3].y + 4.5
    : marker.corners[3].y + 4.5;

  return (
    <g>
      <rect
        x={outerTopLeft.x}
        y={outerTopLeft.y}
        width={marker.sizeMm}
        height={marker.sizeMm}
        fill="black"
      />
      {grid.map((row, gy) =>
        row.map(
          (isWhite, gx) =>
            isWhite && (
              <rect
                key={`${marker.id}-${gx}-${gy}`}
                x={outerTopLeft.x + (gx + 1) * moduleSizeMm}
                y={outerTopLeft.y + (gy + 1) * moduleSizeMm}
                width={moduleSizeMm}
                height={moduleSizeMm}
                fill="white"
              />
            ),
        ),
      )}
      {label && (
        <text
          x={marker.centre.x}
          y={labelY}
          fontSize={3.2}
          textAnchor="middle"
          fill="black"
        >
          id {marker.id}
        </text>
      )}
    </g>
  );
}
