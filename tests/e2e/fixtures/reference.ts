import { expect, type Page } from "@playwright/test";

/**
 * v3.4 (candidate): the reference chip on the easy scan. Flag off it is the
 * old A4 <-> Letter toggle; flag on it opens a small menu (A4 / Letter /
 * Card, role=menu) — or, on a build from before that change, steps through
 * the three. `chooseReference` works with either, so the specs say WHAT is
 * chosen and the chip's own tests say HOW.
 */
export type ReferenceLabel = "A4" | "Letter" | "Card";

export const referenceChip = (page: Page) =>
  page.locator('[data-tour="reference-chip"]');

export const referenceMenu = (page: Page) => page.getByRole("menu");

/** Opens the chip; true when it opened a menu (false: it toggled). */
export async function openReferenceChip(page: Page): Promise<boolean> {
  await referenceChip(page).click();
  return referenceMenu(page)
    .waitFor({ state: "visible", timeout: 1_500 })
    .then(
      () => true,
      () => false,
    );
}

/** The chip's text for a choice, in either language ("Card" is 卡片 in zh-TW). */
const LABELS: Record<ReferenceLabel, readonly string[]> = {
  A4: ["A4"],
  Letter: ["Letter"],
  Card: ["Card", "卡片"],
};
const isLabel = (text: string, target: ReferenceLabel) =>
  LABELS[target].includes(text.trim());

export async function chooseReference(page: Page, target: ReferenceLabel) {
  const chip = referenceChip(page);
  if (isLabel(await chip.innerText(), target)) return;
  if (await openReferenceChip(page)) {
    const key = { A4: "a4", Letter: "letter", Card: "card" }[target];
    await referenceMenu(page)
      .locator(`[role^="menuitem"][data-reference="${key}"]`)
      .click();
    await expect(referenceMenu(page)).toBeHidden();
  } else {
    // A toggle (or a cycling chip): the first tap already stepped once.
    for (let i = 0; i < 3 && !isLabel(await chip.innerText(), target); i++)
      await chip.click();
  }
  await expect
    .poll(async () => isLabel(await chip.innerText(), target))
    .toBe(true);
}
