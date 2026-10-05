import { describe, expect, it } from "vitest";
import {
  HOME_STORY_COPY,
  HOME_STORY_LANGUAGE,
  HOME_STORY_NOTE_KEYS,
  homeStoryNotes,
} from "@/lib/copy/home-story";

const languages = Object.keys(
  HOME_STORY_COPY,
) as (keyof typeof HOME_STORY_COPY)[];

describe("the home story's annotation copy", () => {
  it("has English and zh-TW, five annotations each, in the story's order", () => {
    expect(languages.sort()).toEqual(["en", "zh-TW"]);
    expect(HOME_STORY_NOTE_KEYS).toEqual([
      "length",
      "width",
      "knuckles",
      "fingertips",
      "thumb",
    ]);
  });

  it("gives both languages the same keys, down to each annotation's two lines", () => {
    const shape = (language: keyof typeof HOME_STORY_COPY) =>
      Object.fromEntries(
        Object.entries(HOME_STORY_COPY[language]).map(([key, note]) => [
          key,
          Object.keys(note).sort(),
        ]),
      );
    expect(Object.keys(HOME_STORY_COPY.en).sort()).toEqual(
      [...HOME_STORY_NOTE_KEYS].sort(),
    );
    expect(shape("zh-TW")).toEqual(shape("en"));
    for (const language of languages) {
      for (const key of HOME_STORY_NOTE_KEYS) {
        expect(Object.keys(HOME_STORY_COPY[language][key]).sort()).toEqual([
          "title",
          "why",
        ]);
      }
    }
  });

  it("has no empty string, and no digit anywhere (a demo value must never read as a result)", () => {
    for (const language of languages) {
      for (const key of HOME_STORY_NOTE_KEYS) {
        for (const line of Object.values(HOME_STORY_COPY[language][key])) {
          expect(line.trim(), `${language}.${key}`).not.toBe("");
          // ASCII digits, the full-width ones and CJK numerals all count.
          expect(line, `${language}.${key}`).not.toMatch(
            /[0-9０-９]|[零〇一二三四五六七八九十百千萬]/,
          );
        }
      }
    }
  });

  it("keeps each block short: a large line of a few words, a small line of one sentence", () => {
    for (const language of languages) {
      for (const key of HOME_STORY_NOTE_KEYS) {
        const { title, why } = HOME_STORY_COPY[language][key];
        expect(title.length).toBeLessThanOrEqual(20);
        expect(why.length).toBeLessThanOrEqual(70);
      }
    }
  });

  it("shows English for now, in the story's order", () => {
    expect(HOME_STORY_LANGUAGE).toBe("en");
    expect(homeStoryNotes().map((note) => note.key)).toEqual([
      ...HOME_STORY_NOTE_KEYS,
    ]);
    expect(homeStoryNotes().map((note) => note.title)).toEqual([
      "Hand length",
      "Palm width",
      "Knuckles",
      "Fingertips",
      "Thumb",
    ]);
    // The small lines Kirby confirmed (spelling and grammar only touched).
    expect(homeStoryNotes().map((note) => note.why)).toEqual([
      "The right length can reduce hand fatigue.",
      "A close match with the palm means a better grip.",
      "A pressing force at the best intensity reduces stiff fingers.",
      "Easier clicking, with less strain.",
      "Better control and grip.",
    ]);
    expect(homeStoryNotes("zh-TW").map((note) => note.title)).toEqual([
      "手長",
      "掌寬",
      "指根關節",
      "指尖",
      "拇指",
    ]);
  });
});
