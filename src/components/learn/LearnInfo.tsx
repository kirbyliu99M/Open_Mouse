import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { BASE_WEIGHTS } from "@/server/fit/coefficients";
import type { LearnPageCopy } from "@/lib/copy/learn-page";
import {
  markPlacement,
  markPlacementNarrow,
  SHAPE_SKETCHES,
} from "@/lib/learn/shape-sketches";
import { weightBars } from "@/lib/learn/weight-bars";

/**
 * The body of /learn: five cards, then the primary button. A plain component
 * (no cookie, no router) so a unit test can render it in both languages.
 *
 * Adding a card (for example palm thickness, once its engine PR has merged and
 * Kirby has approved the wording): add one entry to `cards()` below, between
 * the two it belongs between. The numbers on the badges come from the
 * position in that list, so the later cards renumber themselves. The wide
 * layout (learn-info.css) places each card in a grid area by its id, so a new
 * card also needs a `.learn-card--<id>` area there.
 */
export function LearnInfo({ copy }: { copy: LearnPageCopy }) {
  const list = cards(copy);
  return (
    <>
      <header className="learn-info-header">
        <h1>{copy.title}</h1>
        <p className="learn-info-lead">{copy.lead}</p>
      </header>

      <ol className="learn-cards">
        {list.map((card, index) => (
          <li key={card.id} className={`learn-card learn-card--${card.id}`}>
            <section
              className="learn-card-body"
              aria-labelledby={`learn-card-${card.id}`}
            >
              <h2 id={`learn-card-${card.id}`} className="learn-card-title">
                <span className="learn-card-number" aria-hidden="true">
                  {index + 1}
                </span>
                {card.title}
              </h2>
              {card.children}
            </section>
          </li>
        ))}
      </ol>

      <Link className="learn-info-cta" href="/scan/easy">
        {copy.scanButton}
      </Link>
    </>
  );
}

interface Card {
  id: string;
  title: string;
  children: ReactNode;
}

function cards(copy: LearnPageCopy): Card[] {
  return [
    {
      id: "hand",
      title: copy.hand.title,
      children: (
        <>
          <p>{copy.hand.body}</p>
          {/* The hand on A4 with its two measurement lines, no numbers: the
              home page's own drawing. Decorative: the text above says it. */}
          <div className="learn-figure learn-figure-hand">
            {/* eslint-disable-next-line @next/next/no-img-element -- our own fixed SVG, no next/image config needed */}
            <img
              src="/images/hand-on-a4.svg"
              alt=""
              width={411}
              height={507}
              decoding="async"
            />
          </div>
          <Link className="learn-link" href="/scan/easy">
            {copy.scanLink} <span aria-hidden="true">›</span>
          </Link>
        </>
      ),
    },
    {
      id: "grip",
      title: copy.grip.title,
      children: (
        <>
          <p>{copy.grip.body}</p>
          <dl className="learn-grips-text">
            {(["palm", "claw", "fingertip"] as const).map((grip) => (
              <div key={grip}>
                <dt>{copy.grip[grip].name}</dt>
                <dd>{copy.grip[grip].text}</dd>
              </div>
            ))}
          </dl>
          {/* Kirby's three grip drawings, resized only (public/images/learn/).
              Decorative: the list above names and describes each one for a
              screen reader, so the visible captions are hidden from it (the
              names would be read twice). */}
          <div className="learn-grips">
            {(["palm", "claw", "fingertip"] as const).map((grip) => (
              <figure key={grip}>
                {/* eslint-disable-next-line @next/next/no-img-element -- our own fixed drawing, no next/image config needed */}
                <img
                  src={`/images/learn/grip-${grip}.webp`}
                  alt=""
                  width={640}
                  height={640}
                  loading="lazy"
                  decoding="async"
                />
                <figcaption aria-hidden="true">
                  {copy.grip[grip].name}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      ),
    },
    {
      id: "size",
      title: copy.size.title,
      children: <p>{copy.size.body}</p>,
    },
    {
      id: "shape",
      title: copy.shape.title,
      children: (
        <>
          <p>{copy.shape.body}</p>
          {/* Four line drawings of our own (LEARN-5, candidate): drawn after
              measuring official product photos, with no photo and no logo in
              them. Each sits on a dark tile with its marks as real text (so they can be read, by a
              screen reader too) placed by percentages of the drawing. The
              images are decorative (empty alt): the marks and the name under
              the tile carry the idea. */}
          <div className="learn-shapes">
            {SHAPE_SKETCHES.map((sketch) => (
              <figure key={sketch.id} className="learn-shape">
                <div className="learn-shape-tile">
                  <div className="learn-shape-art">
                    {/* eslint-disable-next-line @next/next/no-img-element -- our own fixed SVG, no next/image config needed */}
                    <img
                      src={`/images/learn/shape-${sketch.id}.svg`}
                      alt=""
                      width={sketch.viewBox.w}
                      height={sketch.viewBox.h}
                      loading="lazy"
                      decoding="async"
                    />
                    {sketch.arrows ? (
                      // eslint-disable-next-line @next/next/no-img-element -- our own fixed SVG, no next/image config needed
                      <img
                        className="learn-shape-arrows"
                        src={`/images/learn/shape-${sketch.id}-arrows.svg`}
                        alt=""
                        width={sketch.viewBox.w}
                        height={sketch.viewBox.h}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : null}
                    {sketch.marks.map((mark) => {
                      // Placed by CSS variables, not inline, so the stylesheet
                      // can swap in the narrow set on a 320 px phone.
                      const wide = markPlacement(sketch, mark);
                      const narrow = markPlacementNarrow(sketch, mark);
                      return (
                        <span
                          key={mark.key}
                          className="learn-shape-mark"
                          data-mark={mark.key}
                          data-anchor={mark.anchor}
                          data-tone={mark.tone}
                          style={
                            {
                              "--learn-mark-top": wide.top,
                              "--learn-mark-left": wide.left,
                              "--learn-mark-right": wide.right,
                              "--learn-mark-top-narrow": narrow.top,
                              "--learn-mark-left-narrow": narrow.left,
                              "--learn-mark-right-narrow": narrow.right,
                            } as CSSProperties
                          }
                        >
                          {copy.shape.marks[mark.key]}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <figcaption>{copy.shape[sketch.id]}</figcaption>
              </figure>
            ))}
          </div>
        </>
      ),
    },
    // The palm thickness card goes here (not written yet: the engine is not live).
    {
      id: "score",
      title: copy.score.title,
      children: (
        <>
          <p>{copy.score.body}</p>
          <div className="learn-chart">
            {/* An ordered list: the bars run from the largest to the smallest weight, and that order is all a screen reader can say about them without new text. list-style is none, so no numbers show. */}
            <ol className="learn-bars">
              {weightBars(BASE_WEIGHTS).map((bar) => (
                <li key={bar.key}>
                  <span className="learn-bar-label">
                    {copy.score.bars[bar.key]}
                  </span>
                  <span className="learn-bar-track" aria-hidden="true">
                    <span
                      className="learn-bar"
                      style={{ width: `${(bar.ratio * 100).toFixed(2)}%` }}
                    />
                  </span>
                </li>
              ))}
            </ol>
            <p className="learn-chart-note">{copy.score.barsNote}</p>
          </div>
          <Link className="learn-link" href="/how-it-works">
            {copy.howItWorksLink} <span aria-hidden="true">›</span>
          </Link>
        </>
      ),
    },
  ];
}
