import { describe, expect, it } from "vitest";
import {
  listPhotoFiles,
  skippedFilesLine,
} from "../../src/lib/learning/inputfiles";

describe("listPhotoFiles", () => {
  it("counts every image-like file, any case, in natural file-name order", () => {
    const { photos, skipped } = listPhotoFiles([
      "IMG_0010.JPG",
      "IMG_0002.heic",
      "IMG_0009.jpeg",
      "IMG_0003.HEIF",
      "IMG_0004.png",
      "IMG_0005.jfif",
    ]);
    expect(photos).toEqual([
      "IMG_0002.heic",
      "IMG_0003.HEIF",
      "IMG_0004.png",
      "IMG_0005.jfif",
      "IMG_0009.jpeg",
      "IMG_0010.JPG",
    ]);
    expect(skipped).toEqual([]);
  });

  it("a folder holding only a .heic has a photo (it is not 'no photos')", () => {
    expect(listPhotoFiles(["IMG_0001.heic"])).toEqual({
      photos: ["IMG_0001.heic"],
      skipped: [],
    });
  });

  it("names what it skips, so a .webp cannot vanish", () => {
    const { photos, skipped } = listPhotoFiles([
      "a.webp",
      "IMG_1.jpg",
      "notes.txt",
      "Thumbs.db",
      "clip.mov",
    ]);
    expect(photos).toEqual(["IMG_1.jpg"]);
    expect(skipped).toEqual(["a.webp", "clip.mov", "notes.txt", "Thumbs.db"]);
    expect(skippedFilesLine(skipped)).toBe(
      "Skipped 4 files that are not photos (.jpg, .jpeg, .jfif, .png, .heic, .heif): a.webp, clip.mov, notes.txt, Thumbs.db.",
    );
  });

  it("says nothing when nothing is skipped, and caps the names at ten", () => {
    expect(skippedFilesLine([])).toBeNull();
    expect(skippedFilesLine(["x.webp"])).toMatch(/^Skipped 1 file that is not/);
    const many = Array.from({ length: 13 }, (_, i) => `f${i}.webp`);
    expect(skippedFilesLine(many)).toMatch(/f9\.webp and 3 more\.$/);
  });
});
