"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      className="learn-button"
      onClick={() => window.print()}
    >
      {label}
    </button>
  );
}
