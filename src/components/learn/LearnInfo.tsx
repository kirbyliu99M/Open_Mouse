import type { ReactNode } from "react";
import Link from "next/link";
import { BASE_WEIGHTS } from "@/server/fit/coefficients";
import type { LearnPageCopy } from "@/lib/copy/learn-page";
import { weightBars } from "@/lib/learn/weight-bars";

/**
 * The body of /learn: six cards, then the primary button. A plain component
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
              Decorative: the text above says what each one shows. */}
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
                <figcaption>{copy.grip[grip].name}</figcaption>
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
          {/* Two line drawings of our own (not traced from a photo, not any
              brand's mouse): a symmetrical shell and a one-handed one. */}
          <div className="learn-mice">
            {(["symmetrical", "ergonomic"] as const).map((shape) => (
              <figure key={shape}>
                {/* eslint-disable-next-line @next/next/no-img-element -- our own fixed SVG, no next/image config needed */}
                <img
                  src={`/images/learn/${shape}-top.svg`}
                  alt=""
                  width={300}
                  height={380}
                  loading="lazy"
                  decoding="async"
                />
                <figcaption>{copy.shape[shape]}</figcaption>
              </figure>
            ))}
          </div>
        </>
      ),
    },
    {
      id: "weight",
      title: copy.weightAndConnection.title,
      children: <p>{copy.weightAndConnection.body}</p>,
    },
    // The palm thickness card goes here (not written yet: the engine is not live).
    {
      id: "score",
      title: copy.score.title,
      children: (
        <>
          <p>{copy.score.body}</p>
          <div className="learn-chart">
            <ul className="learn-bars">
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
            </ul>
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
