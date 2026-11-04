/**
 * The words of each tour step, picked from the copy table (pure, tested).
 */
import type { ScanTourCopy } from "@/lib/copy/scan-tour";
import type { TourReference, TourStepDef } from "./tourModel";

type Copy = ScanTourCopy;

const PAPER_LABEL: Record<"a4" | "letter", string> = {
  a4: "A4",
  letter: "Letter",
};

export function stepTitle(
  step: TourStepDef,
  copy: Copy,
  isCard: boolean,
): string {
  switch (step.id) {
    case "reference":
      return step.choice ? copy.referenceTitle : copy.paperSizeTitle;
    case "placement":
      return isCard ? copy.placeCardTitle : copy.placePaperTitle;
    case "cue":
      return copy.cueTitle;
    case "shutter":
      return copy.shutterTitle;
  }
}

export function stepBody(
  step: TourStepDef,
  copy: Copy,
  context: {
    readonly reference: TourReference;
    readonly isCard: boolean;
    readonly noPaperEntry: boolean;
  },
): string[] {
  switch (step.id) {
    case "reference": {
      if (step.choice)
        return [
          context.reference === "card"
            ? copy.referenceBodyCard
            : copy.referenceBodyPaper,
        ];
      const current = context.reference === "letter" ? "letter" : "a4";
      const other = current === "a4" ? "letter" : "a4";
      const lines = [
        copy.paperSizeBody(PAPER_LABEL[current], PAPER_LABEL[other]),
      ];
      if (context.noPaperEntry) lines.push(copy.paperSizeNoPaper);
      return lines;
    }
    case "placement":
      return [context.isCard ? copy.placeCardBody : copy.placePaperBody];
    case "cue":
      return [
        copy.cueBody(
          context.isCard ? copy.cuePerfectCard : copy.cuePerfectPaper,
        ),
      ];
    case "shutter":
      return [
        context.isCard ? copy.shutterBodyCard : copy.shutterBodyPaper,
        copy.shutterHelpAgain,
      ];
  }
}
