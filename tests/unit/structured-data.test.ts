import { describe, expect, it } from "vitest";
import { llmsTxt } from "../../src/lib/llms";
import {
  breadcrumbLd,
  faqPageLd,
  serializeJsonLd,
} from "../../src/lib/structured-data";
import { SITE_URL } from "../../src/lib/site";

describe("structured data", () => {
  it("numbers breadcrumb items from 1 with absolute, localized URLs", () => {
    const ld = breadcrumbLd("en", [
      ["Home", "/"],
      ["All mice", "/mice"],
    ]);
    expect(ld.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: `${SITE_URL}/en`,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "All mice",
        item: `${SITE_URL}/en/mice`,
      },
    ]);
  });

  it("builds an FAQPage of questions with accepted answers", () => {
    const ld = faqPageLd("zh-TW", "/faq", [{ question: "Q?", answer: "A." }]);
    expect(ld).toMatchObject({
      "@type": "FAQPage",
      url: `${SITE_URL}/faq`,
      inLanguage: "zh-TW",
      mainEntity: [
        {
          "@type": "Question",
          name: "Q?",
          acceptedAnswer: { "@type": "Answer", text: "A." },
        },
      ],
    });
  });

  it("can never close its script element", () => {
    const out = serializeJsonLd({ "@type": "Thing", name: "</script><b>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out).name).toBe("</script><b>");
  });
});

describe("llms.txt", () => {
  it("starts with the site name and a summary, and links both languages", () => {
    const txt = llmsTxt();
    expect(txt.startsWith("# Palmate\n\n> ")).toBe(true);
    expect(txt).toContain(`(${SITE_URL}/en/mice)`);
    expect(txt).toContain(`中文：${SITE_URL}/mice`);
    expect(txt).toContain("never uploaded");
  });
});
