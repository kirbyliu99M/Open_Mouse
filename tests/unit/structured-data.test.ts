import { describe, expect, it } from "vitest";
import { GET as llmsTxt } from "../../src/app/llms.txt/route";
import { howItWorksCopy } from "../../src/lib/copy/how-it-works";
import { siteMetaCopy } from "../../src/lib/copy/site-meta";
import {
  homeStructuredData,
  howItWorksStructuredData,
  serializeJsonLd,
} from "../../src/lib/structured-data";
import { GITHUB_URL, SITE_URL } from "../../src/lib/site";

type Node = Record<string, unknown>;
const graph = (locale: "zh-TW" | "en") =>
  homeStructuredData(locale)["@graph"] as Node[];

describe("home page JSON-LD", () => {
  it("names the organisation, the site and the app on SITE_URL", () => {
    const types = graph("zh-TW").map((n) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite", "WebApplication"]);
    for (const node of graph("zh-TW")) {
      expect(node.url).toBe(SITE_URL);
      expect(String(node["@id"]).startsWith(`${SITE_URL}/#`)).toBe(true);
    }
    expect(graph("en")[0].sameAs).toEqual([GITHUB_URL]);
  });

  it("describes the app with the approved site description, per locale", () => {
    for (const locale of ["zh-TW", "en"] as const) {
      const app = graph(locale)[2];
      expect(app.description).toBe(siteMetaCopy(locale).description);
      expect(app.inLanguage).toBe(locale);
    }
  });
});

describe("How it works JSON-LD", () => {
  it("lists the page's own three steps, in order", () => {
    const copy = howItWorksCopy("zh-TW");
    const data = howItWorksStructuredData("zh-TW", 408);
    const steps = data.step as Node[];
    expect(data["@type"]).toBe("HowTo");
    expect(steps.map((s) => s.name)).toEqual([
      copy.step1Title,
      copy.step2Title,
      copy.step3Title,
    ]);
    expect(steps[2].text).toBe(copy.step3Body(408));
    expect(steps.map((s) => s.position)).toEqual([1, 2, 3]);
  });

  it("states no mouse count when the catalogue could not be read", () => {
    const steps = howItWorksStructuredData("en", null).step as Node[];
    expect(steps[2].text).toBe(howItWorksCopy("en").step3Body(null));
  });
});

describe("serializeJsonLd", () => {
  it("cannot close the script element early", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out).name).toBe("</script><script>alert(1)</script>");
  });
});

describe("/llms.txt", () => {
  it("is plain text that maps the public pages and no private one", async () => {
    const res = llmsTxt();
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body.startsWith("# Palmate\n")).toBe(true);
    for (const path of ["/scan/easy", "/learn", "/mice", "/how-it-works"]) {
      expect(body).toContain(`(${SITE_URL}${path})`);
    }
    expect(body).not.toMatch(/\/(results|account|l\/|api)/);
  });
});
