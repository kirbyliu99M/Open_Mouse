import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NOTICE section 3 lists the npm packages that ship in the deployed app, with
 * version and licence. It is written by hand, so it drifts silently when a
 * package is added or upgraded (`qrcode` was missed once). This test compares
 * the table with `package.json` (which packages) and `package-lock.json`
 * (resolved version and licence), and the js-aruco2 paragraph with the package's
 * own LICENSE.txt (StackBoxBlur was missed once, and it is code that runs).
 */
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

interface LockPackage {
  version: string;
  license?: string;
}
const notice = read("NOTICE").replace(/\r\n/g, "\n");
const pkg = JSON.parse(read("package.json")) as {
  dependencies: Record<string, string>;
};
const lock = JSON.parse(read("package-lock.json")) as {
  packages: Record<string, LockPackage>;
};
const dependencies = Object.keys(pkg.dependencies).sort();

/** The rows of the "Package / Version / Licence" table in NOTICE section 3. */
function noticeTable(): Map<string, { version: string; licence: string }> {
  const lines = notice.split("\n");
  const header = lines.findIndex((line) =>
    /^\s+Package\s+Version\s+Licence\s*$/.test(line),
  );
  expect(header, "the package table header in NOTICE").toBeGreaterThan(-1);
  const rows = new Map<string, { version: string; licence: string }>();
  // header, then a line of dashes, then rows up to the first blank line
  for (let i = header + 2; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "") break;
    const match = /^\s+(\S+)\s+(\S+)\s+(\S+)\s*$/.exec(line);
    expect(match, `table row "${line}"`).not.toBeNull();
    rows.set(match![1]!, { version: match![2]!, licence: match![3]! });
  }
  return rows;
}
const table = noticeTable();

describe("NOTICE npm package table", () => {
  it("lists exactly the packages in package.json dependencies", () => {
    expect([...table.keys()].sort()).toEqual(dependencies);
  });

  it.each(dependencies)(
    "%s: version and licence equal the ones in package-lock.json",
    (name) => {
      const locked = lock.packages[`node_modules/${name}`];
      expect(locked, `${name} in package-lock.json`).toBeDefined();
      expect(locked!.license, `${name} has a license field`).toBeTypeOf(
        "string",
      );
      expect(table.get(name)).toEqual({
        version: locked!.version,
        licence: locked!.license,
      });
    },
  );

  it("names exactly the packages that ship no licence file, and says how many", () => {
    // NOTICE says: "... but four do not: a, b, c and d. For those four ..."
    const claim =
      /but (\w+) do not:\s+([\s\S]*?)\.\s+For those/.exec(notice) ?? null;
    expect(claim, "the 'but N do not:' sentence in NOTICE").not.toBeNull();
    const [, count, list] = claim!;
    const named = list!
      .split(/,|\band\b/)
      .map((part) => part.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .sort();

    const withoutLicenceFile = dependencies.filter((name) => {
      const dir = join(root, "node_modules", name);
      expect(existsSync(dir), `${name} is installed`).toBe(true);
      return !readdirSync(dir).some((file) =>
        /^(licen[cs]e|notice|copying)(\.|$)/i.test(file),
      );
    });

    expect(named).toEqual(withoutLicenceFile);
    const words = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
    ];
    expect(count).toBe(words[withoutLicenceFile.length]);
  });
});

describe("NOTICE js-aruco2 paragraph", () => {
  const licence = readFileSync(
    join(root, "node_modules/js-aruco2/LICENSE.txt"),
    "latin1",
  ).replace(/\r\n/g, "\n");
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();

  it("mentions every work whose licence the package's LICENSE.txt reproduces", () => {
    // Headings look like "OpenCV\n======".
    const works = [...licence.matchAll(/^(.+)\n=+[ \t]*$/gm)].map((m) =>
      m[1]!.trim(),
    );
    expect(works.length).toBeGreaterThanOrEqual(4);
    for (const work of works) {
      expect(notice, `NOTICE mentions ${work}`).toContain(work);
    }
  });

  it("reproduces the MIT and StackBoxBlur licence texts word for word", () => {
    const flat = squash(notice);
    const mit = licence.slice(0, licence.indexOf("\nArUco\n"));
    const stackBlur = licence.slice(
      licence.indexOf("Copyright (c) 2010 Mario"),
    );
    expect(mit).toContain("Damiano Falcioni");
    expect(stackBlur).toContain("Mario Klingemann");
    expect(flat).toContain(squash(mit));
    expect(flat).toContain(squash(stackBlur));
  });

  it("reproduces the OpenCV licence text from LICENSE.txt word for word", () => {
    // From the "License Agreement" line to the next heading (AForge.NET). The
    // "IMPORTANT: READ BEFORE DOWNLOADING" preamble before it is not copied.
    const opencv = licence.slice(
      licence.indexOf("License Agreement"),
      licence.indexOf("\nAForge.NET\n"),
    );
    expect(opencv).toContain("Intel Corporation");
    expect(opencv).toContain("Willow Garage");
    expect(squash(notice)).toContain(squash(opencv));
  });

  it("reproduces the ArUco licence text from the dictionary file's header word for word", () => {
    // LICENSE.txt has only the heading "BSD License" for ArUco; the text is in
    // the comment at the top of the dictionary file the six codes came from.
    const dictionary = readFileSync(
      join(root, "node_modules/js-aruco2/src/dictionaries/aruco_mip_36h12.js"),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const start = dictionary.indexOf("/**") + 3;
    const aruco = dictionary.slice(start, dictionary.indexOf("*/", start));
    expect(aruco).toContain("Rafael Muñoz Salinas");
    expect(aruco).toContain("Redistributions in binary form");
    expect(squash(notice)).toContain(squash(aruco));
  });

  it("says that LICENSE.txt has only a heading for ArUco (so the wording stays true)", () => {
    // If a later js-aruco2 puts the ArUco text into LICENSE.txt, NOTICE's
    // sentence "only a heading ... and no text" becomes false and this fails.
    const afterHeading = licence.slice(licence.indexOf("\nArUco\n"));
    const arucoSection = afterHeading.slice(
      0,
      afterHeading.indexOf("\nOpenCV\n"),
    );
    expect(squash(arucoSection)).toBe("ArUco ==== BSD License");
  });
});
