/**
 * A disclosure (Details, Other mice) is opened by the person, or, in a browser
 * without `::details-content`, by `PrintOpenDetails` on `beforeprint`. The
 * second must not count as the person opening it: no `results_list_opened`
 * event, and no 3D viewer download for a page that is only being printed.
 * `PrintOpenDetails` marks such an open with `PRINT_OPENED_ATTRIBUTE` until
 * it has closed the disclosure again. Pure.
 */
export const PRINT_OPENED_ATTRIBUTE = "data-print-opened";

/** Whether a `toggle` event is the person opening a disclosure. */
export function isPersonOpening({
  open,
  printOpened,
}: {
  open: boolean;
  printOpened: boolean;
}): boolean {
  return open && !printOpened;
}
