import { siteMetaCopy } from "@/lib/copy/site-meta";
import { absoluteUrl } from "@/lib/seo";
import { GITHUB_URL, SITE_NAME } from "@/lib/site";

/**
 * `/llms.txt` (llmstxt.org): a plain map of the public pages for language
 * models (AEO, Kirby 2026-10-28). The two descriptions are the approved site
 * descriptions; the page lines restate what each page already says. The page
 * lines and the "not a medical tool" line (the README's) are CANDIDATE
 * wording (未拍板). Private pages (`/results/**`, `/account`) are never listed.
 */
export const dynamic = "force-static";

export function GET(): Response {
  const lines = [
    `# ${SITE_NAME}`,
    "",
    `> ${siteMetaCopy("en").description}`,
    "",
    siteMetaCopy("zh-TW").description,
    "",
    "The hand photo is measured in the browser; only the measurements are sent to the server. Palmate is a buying aid, not a medical or health tool.",
    "",
    "## Pages",
    "",
    `- [Home](${absoluteUrl("/")}): what Palmate does, and where to start a scan.`,
    `- [Scan your hand](${absoluteUrl("/scan/easy")}): photograph your hand on a blank sheet of A4, or type your hand length and width.`,
    `- [How to choose a mouse that fits](${absoluteUrl("/learn")}): hand size, grip style, palm thickness, mouse shape, and how each mouse is scored.`,
    `- [All mice](${absoluteUrl("/mice")}): every mouse Palmate compares, with its dimensions and weight.`,
    `- [How it works](${absoluteUrl("/how-it-works")}): the three steps of a scan, and what happens to your data.`,
    "",
    "## Optional",
    "",
    `- [Privacy policy](${absoluteUrl("/privacy")})`,
    `- [Terms of use](${absoluteUrl("/terms")})`,
    `- [Source code](${GITHUB_URL})`,
    "",
  ];
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
