import { describe, expect, it } from "vitest";
import { timePromises } from "../e2e/fixtures/time-promise";

describe("timePromises", () => {
  it.each([
    "Scans without an account are deleted within 24 hours.",
    "Your result is kept for 24 hours.",
    "A scan is deleted after two days.",
    "We keep it for a few hours.",
    "Deleted after 24h.",
    "Removed after 30 minutes.",
    "Your scan is gone by tomorrow.",
    "Stored for a week.",
    "It expires overnight.",
    "Scans are kept for a couple of weeks.",
    "Scans are erased after 7 days.",
    "Deleted within a day.",
    "Kept for one hour.",
  ])("flags %j", (sentence) => {
    expect(timePromises(sentence)).toHaveLength(1);
  });

  it.each([
    "Scans without an account expire automatically after a while.",
    "Your result is kept for a while, then expires automatically.",
    "Scans without an account expire automatically.",
    "It may have expired, or the link isn't yours.",
    "Takes about a minute.",
    "One blank sheet is all you need",
    "Your photo never leaves your phone. Only measurements are sent.",
    "By default your photo is analysed only on your phone, and only the measurements are sent. It is uploaded only if you choose to send it after a failed scan or to report wrong numbers.",
    "A photo you sent is deleted separately, with its deletion code.",
    "Delete this scan now",
    "Print at actual size — 100%",
  ])("leaves %j alone", (sentence) => {
    expect(timePromises(sentence)).toEqual([]);
  });

  it("finds the promise in one sentence among several", () => {
    const text =
      "Sign in is optional. Without an account, a scan is deleted within 24 hours. Start now.";
    expect(timePromises(text)).toEqual([
      "Without an account, a scan is deleted within 24 hours.",
    ]);
  });
});
