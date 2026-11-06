"use client";

import { useEffect } from "react";

/** Opens the print dialog once the payslips are on screen. */
export function ExportToolbar({ name, count }: { name: string; count: number }) {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 600);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <div className="mx-auto mb-6 flex max-w-4xl flex-wrap items-center justify-between gap-3 print:hidden">
      <p className="text-sm text-gray-600">
        {count} payslip{count === 1 ? "" : "s"} for <strong>{name}</strong>, one per page. In the print dialog choose{" "}
        <strong>Save as PDF</strong>.
      </p>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Save as PDF
      </button>
    </div>
  );
}
