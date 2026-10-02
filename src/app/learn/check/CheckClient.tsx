"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  analyseLearningPhoto,
  type LearningPhotoReport,
} from "@/client/learning/analyse";
import { PAPER_SIZES_MM, type PaperSize } from "@/lib/contracts/measurement";
import { analyseBatch } from "@/lib/learning/batch";
import { compareFileNames, type CheckTone } from "@/lib/learning/checks";
import { LEARNING_KIT_VERSION, kitCodeToken } from "@/lib/learning/kit";
import {
  NO_PROVENANCE,
  buildRunLog,
  sortReports,
  sortReportsV2,
} from "@/lib/learning/runlog";
import { KIT_V2_SHEETS, type KitV2Sheet } from "@/lib/learning/session";
import { REVIEW_REASON_TEXT } from "@/lib/learning/sortv2";

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

const PAPER_LABEL: Record<PaperSize, string> = {
  a4: "A4",
  letter: "US Letter",
};

export function CheckClient({
  initialPaperSize = "a4",
  initialSheet = null,
}: {
  initialPaperSize?: PaperSize;
  /** A kit v2 sheet to analyse the photos as; `null` is kit v1 (a pose page with its own QR code). */
  initialSheet?: KitV2Sheet | null;
}) {
  const [reports, setReports] = useState<LearningPhotoReport[]>([]);
  // The size chosen for the next run, and the size the shown results used.
  const [paperSize, setPaperSize] = useState<PaperSize>(initialPaperSize);
  const [ranWith, setRanWith] = useState<PaperSize>(initialPaperSize);
  // The same for the kit: v1 (null) or a v2 sheet.
  const [sheet, setSheet] = useState<KitV2Sheet | null>(initialSheet);
  const [ranSheet, setRanSheet] = useState<KitV2Sheet | null>(initialSheet);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (files: File[], size: PaperSize, kit: KitV2Sheet | null) => {
      const images = files
        .filter(
          (f) =>
            f.type.startsWith("image/") ||
            /\.(jpe?g|png|heic|heif)$/i.test(f.name),
        )
        .sort((a, b) => compareFileNames(a.name, b.name));
      if (images.length === 0) return;
      setReports([]);
      setRanWith(size);
      setRanSheet(kit);
      setProgress({ done: 0, total: images.length });
      try {
        // One report per photo, in order; a photo that cannot be analysed gets a
        // failed report and the rest go on.
        await analyseBatch(
          images,
          (file) =>
            analyseLearningPhoto(file, {
              paperSize: size,
              ...(kit ? { sheet: kit } : {}),
            }),
          {
            paperSize: size,
            kitVersion: kit ? LEARNING_KIT_VERSION : undefined,
            onProgress: (done) => {
              setReports([...done]);
              setProgress({ done: done.length, total: images.length });
            },
          },
        );
      } finally {
        setProgress(null);
      }
    },
    [],
  );

  // Kit v1 files by each page's own QR code; kit v2 by the participant card
  // and the shooting order.
  const sort = useMemo(
    () => (ranSheet ? sortReportsV2(reports) : sortReports(reports)),
    [reports, ranSheet],
  );
  const v2 = useMemo(
    () => (ranSheet ? sortReportsV2(reports) : null),
    [reports, ranSheet],
  );
  const counts = useMemo(() => {
    const c = { ready: 0, slate: 0, retake: 0, unidentified: 0 };
    for (const r of reports) c[r.verdict]++;
    return c;
  }, [reports]);

  // The download is the same run log `learn:sort` writes, without the
  // folder name and the commit (a page cannot know either).
  const manifest = useMemo(
    () =>
      JSON.stringify(
        buildRunLog({
          reports,
          sort,
          paperSize: ranWith,
          input: null,
          provenance: NO_PROVENANCE,
          now: new Date(),
          ...(ranSheet ? { kitV2: { session: null, sheet: ranSheet } } : {}),
        }),
        null,
        2,
      ),
    [reports, sort, ranWith, ranSheet],
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
          void run([...e.dataTransfer.files], paperSize, sheet);
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
            void run([...(e.target.files ?? [])], paperSize, sheet);
            e.target.value = "";
          }}
        />
      </div>

      <div className="learn-field">
        <label htmlFor="learn-paper-size">Sheet size of the pages</label>
        <select
          id="learn-paper-size"
          className="learn-select"
          value={paperSize}
          onChange={(e) => setPaperSize(e.target.value as PaperSize)}
          disabled={progress !== null}
          data-testid="learning-check-paper"
        >
          {(Object.keys(PAPER_SIZES_MM) as PaperSize[]).map((size) => (
            <option key={size} value={size}>
              {PAPER_LABEL[size]}
            </option>
          ))}
        </select>
      </div>
      <p className="learn-note">
        Applies to the photos you choose next. The kit is designed for A4.
      </p>

      <div className="learn-field">
        <label htmlFor="learn-kit">Kit</label>
        <select
          id="learn-kit"
          className="learn-select"
          value={sheet ?? "v1"}
          onChange={(e) =>
            setSheet(KIT_V2_SHEETS.find((s) => s === e.target.value) ?? null)
          }
          disabled={progress !== null}
          data-testid="learning-check-sheet"
        >
          <option value="v1">Kit v1: pose pages with their own QR code</option>
          {KIT_V2_SHEETS.map((s) => (
            <option key={s} value={s}>
              Kit v2: sheet {s}, participant card in the slot
            </option>
          ))}
        </select>
      </div>
      {sheet && (
        <p className="learn-note">
          Kit v2 files by the participant card and the shooting order, and keeps
          every photo that names a participant. The verdicts below are the
          product&apos;s own: do not look at them before you have labelled the
          session&apos;s photos good or bad (docs/learning/README.md, &ldquo;Kit
          v2&rdquo;).
        </p>
      )}

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
                        {v2 ? "" : row.hand === "right" ? "R" : "L"}
                      </td>
                      <td data-short={row.got < row.expected}>
                        {row.got} of {row.expected}
                        {v2 && row.got > row.expected ? " (extra shot)" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {v2 && v2.participants.some((p) => p.status === "needs-review") && (
            <>
              <h2>Needs review</h2>
              <ul className="learn-checks">
                {v2.participants
                  .filter((p) => p.status === "needs-review")
                  .map((p) => (
                    <li key={p.participant}>
                      <ToneIcon tone="warn" />
                      <span>
                        {p.participant}, {p.photos} photos:{" "}
                        {p.reason ? REVIEW_REASON_TEXT[p.reason] : ""}. None of
                        them is filed.
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}

          <h2>Photos</h2>
          <ul className="learn-results">
            {reports.map((r) => {
              const v = VERDICT[r.verdict];
              const filed = sort.photos.find((p) => p.file === r.file);
              const filedV2 = v2?.photos.find((p) => p.file === r.file);
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
                    {filedV2?.gesture
                      ? ` (${filedV2.gesture}, shot ${filedV2.shot}${
                          filedV2.extraShot ? ", extra" : ""
                        })`
                      : ""}
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
