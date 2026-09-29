"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  analyseLearningPhoto,
  type LearningPhotoReport,
} from "@/client/learning/analyse";
import { compareFileNames, type CheckTone } from "@/lib/learning/checks";
import { kitCodeToken, sortPhotos, type SortResult } from "@/lib/learning/kit";

function ToneIcon({ tone }: { tone: CheckTone }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tone === "ok")
    return (
      <svg {...common} className="learn-status" data-tone="ok">
        <polyline points="3,8.5 6.5,12 13,4.5" />
      </svg>
    );
  if (tone === "warn")
    return (
      <svg {...common} className="learn-status" data-tone="warn">
        <line x1="8" y1="3" x2="8" y2="9.5" />
        <line x1="8" y1="12.5" x2="8" y2="12.6" />
      </svg>
    );
  return (
    <svg {...common} className="learn-status" data-tone="bad">
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

const VERDICT: Record<
  LearningPhotoReport["verdict"],
  { label: string; tone: CheckTone }
> = {
  ready: { label: "Ready to file", tone: "ok" },
  slate: { label: "Participant card", tone: "ok" },
  retake: { label: "Retake", tone: "bad" },
  unidentified: { label: "Not identified", tone: "bad" },
};

const mm = (v: number | undefined) => (v === undefined ? "–" : v.toFixed(1));

function buildSort(reports: readonly LearningPhotoReport[]): SortResult {
  const ordered = [...reports].sort((a, b) => compareFileNames(a.file, b.file));
  return sortPhotos(
    ordered.map((r, i) => ({
      file: r.file,
      takenAt: i,
      // A photo to retake is not filed, even if its QR code was read.
      code: r.verdict === "retake" ? null : r.code,
      // See analyse.ts: detected handedness is not trusted until audit
      // finding 0 (inverted for palm-down photos) is fixed.
      detectedHand: null,
    })),
  );
}

export function CheckClient() {
  const [reports, setReports] = useState<LearningPhotoReport[]>([]);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async (files: File[]) => {
    const images = files
      .filter(
        (f) =>
          f.type.startsWith("image/") || /\.(jpe?g|png|heic)$/i.test(f.name),
      )
      .sort((a, b) => compareFileNames(a.name, b.name));
    if (images.length === 0) return;
    setReports([]);
    setProgress({ done: 0, total: images.length });
    const out: LearningPhotoReport[] = [];
    for (const file of images) {
      out.push(await analyseLearningPhoto(file));
      setReports([...out]);
      setProgress({ done: out.length, total: images.length });
    }
    setProgress(null);
  }, []);

  const sort = useMemo(() => buildSort(reports), [reports]);
  const counts = useMemo(() => {
    const c = { ready: 0, slate: 0, retake: 0, unidentified: 0 };
    for (const r of reports) c[r.verdict]++;
    return c;
  }, [reports]);

  const manifest = useMemo(
    () => JSON.stringify({ kitVersion: 1, reports, sort }, null, 2),
    [reports, sort],
  );

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([manifest], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "learning-manifest.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div
        className="learn-drop"
        data-active={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void run([...e.dataTransfer.files]);
        }}
      >
        <button
          type="button"
          className="learn-button"
          onClick={() => inputRef.current?.click()}
          disabled={progress !== null}
        >
          Choose photos
        </button>
        <span className="learn-note">or drop them here</span>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Photos to check"
          data-testid="learning-check-input"
          onChange={(e) => {
            void run([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      <p className="learn-note" role="status" aria-live="polite">
        {progress
          ? `Checking ${progress.done + 1} of ${progress.total}…`
          : reports.length > 0
            ? `Checked ${reports.length} photo${reports.length === 1 ? "" : "s"}.`
            : ""}
      </p>

      {reports.length > 0 && (
        <>
          <div className="learn-summary">
            <span>{counts.ready} ready</span>
            <span>{counts.slate} cards</span>
            <span>{counts.retake} to retake</span>
            <span>{counts.unidentified} not identified</span>
          </div>

          {sort.coverage.length > 0 && (
            <>
              <h2>Coverage</h2>
              <table className="learn-table">
                <thead>
                  <tr>
                    <th scope="col">Participant</th>
                    <th scope="col">Pose</th>
                    <th scope="col">Photos</th>
                  </tr>
                </thead>
                <tbody>
                  {sort.coverage.map((row) => (
                    <tr key={`${row.participant}-${row.gesture}-${row.hand}`}>
                      <td>{row.participant}</td>
                      <td>
                        {row.gesture}
                        {row.hand === "right" ? "R" : "L"}
                      </td>
                      <td data-short={row.got < row.expected}>
                        {row.got} of {row.expected}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h2>Photos</h2>
          <ul className="learn-results">
            {reports.map((r) => {
              const v = VERDICT[r.verdict];
              const filed = sort.photos.find((p) => p.file === r.file);
              return (
                <li key={r.file} className="learn-result">
                  <div className="learn-result-head">
                    <h3>{r.code ? kitCodeToken(r.code) : "No QR code"}</h3>
                    <span className="learn-status" data-tone={v.tone}>
                      {v.label}
                    </span>
                  </div>
                  <p className="learn-file">
                    {r.file}
                    {filed?.destination ? ` → ${filed.destination}` : ""}
                  </p>
                  <ul className="learn-checks">
                    {r.checks.map((c) => (
                      <li key={c.id}>
                        <ToneIcon tone={c.tone} />
                        <span>{c.message}</span>
                      </li>
                    ))}
                  </ul>
                  {(r.markerMm || r.paperMm) && (
                    <p className="learn-measure">
                      Hand length: markers {mm(r.markerMm?.handLengthMm)} mm ·
                      paper edges {mm(r.paperMm?.handLengthMm)} mm. Palm width:
                      markers {mm(r.markerMm?.palmWidthMm)} mm · paper edges{" "}
                      {mm(r.paperMm?.palmWidthMm)} mm.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="learn-actions">
            <button
              type="button"
              className="learn-button-secondary"
              onClick={download}
              disabled={progress !== null}
            >
              Download results (JSON)
            </button>
          </div>
          <p className="learn-note">
            The file holds the measurements and detected points for each photo,
            not the photos.
          </p>
        </>
      )}

      <pre hidden data-testid="learning-check-json">
        {progress === null && reports.length > 0 ? manifest : ""}
      </pre>
    </div>
  );
}
