/**
 * F10 (Kirby's second phone test of the V3.2 preview, 2026-10-21/22,
 * candidate 未拍板): "拍照掃描不需要 loading 畫面". After the shutter there is
 * no full-screen loader and no minimum time any more (F7's particle loader and
 * its 1.5 s are gone): the frozen photo stays on screen with one small
 * 測量中… line (`role="status"`), and the answer (the measured hand or the
 * failure sheet) replaces it the moment it is here. The worker (F8) and the
 * pipeline's yields to the browser (F7) stay, so the frozen photo does not
 * freeze the page. The results page's loader is not this one and keeps its
 * own rule (`fitReveal`: shown only after 300 ms, no minimum).
 */

/**
 * Whether the easy-scan camera shows 測量中…: while the photo is analysed
 * (`processing`), or once the shutter has a photo that the analysis has not
 * taken on yet (`shutterMeasuring`). Never over an answer. Pure.
 */
export function measuringShown(
  resultKind: string,
  shutterMeasuring: boolean,
): boolean {
  return resultKind === "processing" || shutterMeasuring;
}
