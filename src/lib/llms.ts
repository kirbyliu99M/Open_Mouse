/**
 * `/llms.txt` (https://llmstxt.org): a short Markdown map of the site for AI
 * answer engines and agents, so they can describe Palmate correctly and link
 * to the right page (SEO/GEO task, 2026-10-28). English, with the zh-TW URL of
 * each page beside it. Candidate wording (未拍板). Pure.
 *
 * Every statement here repeats something a public page already says (how it
 * works, the privacy notice, the terms). It carries no catalogue data: the
 * terms ask that the data not be republished in bulk.
 */
import { localizedUrl } from "./seo";
import { SITE_NAME } from "./site";

export interface LlmsLink {
  title: string;
  path: string;
  note: string;
}

export interface LlmsSection {
  heading: string;
  links: readonly LlmsLink[];
}

export const LLMS_SECTIONS: readonly LlmsSection[] = [
  {
    heading: "Tool",
    links: [
      {
        title: "Scan your hand",
        path: "/scan/easy",
        note: "The scanner: lay a hand on a blank sheet of A4 and take a photo with a phone; mice are then ranked for that hand.",
      },
      {
        title: "How it works",
        path: "/how-it-works",
        note: "The three steps, and what happens to the photo.",
      },
    ],
  },
  {
    heading: "Guides",
    links: [
      {
        title: "How to choose a mouse that fits",
        path: "/learn",
        note: "Hand length and palm width, grip style, palm thickness, size and shape.",
      },
    ],
  },
  {
    heading: "Catalogue",
    links: [
      {
        title: "All mice",
        path: "/mice",
        note: "Every gaming mouse Palmate compares, with length, width, height, weight, shape and connection.",
      },
    ],
  },
  {
    heading: "Policies",
    links: [
      {
        title: "Privacy",
        path: "/privacy",
        note: "What is collected and for how long.",
      },
      {
        title: "Terms of use",
        path: "/terms",
        note: "Estimates for reference; no brand affiliation.",
      },
    ],
  },
];

const FACTS = [
  "Palmate is a free web tool that helps people choose a gaming mouse by hand size. It is run by a student team from a course at National Taiwan University.",
  "A visitor lays one hand on a blank sheet of A4 paper and photographs it with a phone. The sheet is the scale: its known size turns the photo into millimetres.",
  "The photo is analysed in the browser (MediaPipe hand landmarks) and is never uploaded. Only the derived measurements, such as hand length and palm width, are sent to the server.",
  "Mice are scored against the hand on six parts: length, grip width, height and hump, front width, thumb rest and weight. Length counts most.",
  "Grip style (palm, claw or fingertip) and, optionally, palm thickness change the target size of the mouse.",
  "Rankings and measurements are estimates for reference, not medical or ergonomic advice. Palmate is not affiliated with any mouse brand.",
  "The site is in Traditional Chinese (unprefixed URLs) and English (URLs under /en).",
];

export function llmsTxt(
  sections: readonly LlmsSection[] = LLMS_SECTIONS,
): string {
  const lines: string[] = [
    `# ${SITE_NAME}`,
    "",
    "> Find a gaming mouse that fits your hand: measure your hand with a phone and a sheet of A4, then compare it with mouse dimensions. 依手型挑選電競滑鼠的線上工具。",
    "",
    ...FACTS.map((f) => `- ${f}`),
  ];
  for (const section of sections) {
    lines.push("", `## ${section.heading}`, "");
    for (const link of section.links) {
      lines.push(
        `- [${link.title}](${localizedUrl(link.path, "en")}): ${link.note} 中文：${localizedUrl(link.path, "zh-TW")}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
