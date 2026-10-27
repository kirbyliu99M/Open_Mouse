import Link from "next/link";
import type { LegalCopy, LegalSection } from "@/lib/copy/legal";

/**
 * `/privacy` and `/terms` (pre-launch audit 2026-10-28, candidate 未拍板):
 * one heading, the date, the sections, and a link to the other page. The
 * how-it-works page's layout classes, no styles of its own.
 */
export function LegalPage({
  copy,
  title,
  intro,
  sections,
  other,
}: {
  readonly copy: LegalCopy;
  readonly title: string;
  readonly intro?: string;
  readonly sections: readonly LegalSection[];
  readonly other: { readonly href: string; readonly label: string };
}) {
  return (
    <main className="home-main home-how-page">
      <Link className="home-back-link" href="/">
        {copy.back}
      </Link>
      <h1>{title}</h1>
      <p className="home-subhead">{copy.updated}</p>
      {intro ? <p>{intro}</p> : null}
      {sections.map((section) => (
        <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </section>
      ))}
      <p className="home-privacy-link">
        <Link href={other.href}>{other.label}</Link>
      </p>
    </main>
  );
}
