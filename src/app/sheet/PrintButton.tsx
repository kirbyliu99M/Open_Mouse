"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="sheet-primary"
      onClick={() => window.print()}
    >
      Print the sheet
    </button>
  );
}
