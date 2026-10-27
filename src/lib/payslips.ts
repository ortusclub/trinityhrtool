// What every payslip shows, set on Admin → Payroll → Payslip and stored in
// payslip_settings. Applied when a payslip is displayed, so a change reaches
// every payslip already released.
export interface PayslipSettings {
  showCompanyAddress: boolean;
  showCompanyTin: boolean;
  showPosition: boolean;
  showEmployeeCode: boolean;
  showBranch: boolean;
  /** Lines whose amount is 0.00, e.g. "Days Absent Deduction". */
  showZeroLines: boolean;
  /** Rows without an amount, e.g. a loan's installment detail. */
  showLineNotes: boolean;
  showNetTaxable: boolean;
  showRemarks: boolean;
  /** Printed at the bottom of every payslip. */
  note: string;
}

export const DEFAULT_PAYSLIP_SETTINGS: PayslipSettings = {
  showCompanyAddress: true,
  showCompanyTin: true,
  showPosition: true,
  showEmployeeCode: true,
  showBranch: true,
  showZeroLines: true,
  showLineNotes: true,
  showNetTaxable: true,
  showRemarks: true,
  note: "",
};

/** Saved settings over the defaults, ignoring anything unknown. */
export function readPayslipSettings(saved: unknown): PayslipSettings {
  const out = { ...DEFAULT_PAYSLIP_SETTINGS };
  if (!saved || typeof saved !== "object") return out;
  const s = saved as Record<string, unknown>;
  for (const key of Object.keys(out) as (keyof PayslipSettings)[]) {
    const v = s[key];
    if (key === "note") {
      if (typeof v === "string") out.note = v.slice(0, 2000);
    } else if (typeof v === "boolean") {
      out[key] = v;
    }
  }
  return out;
}

/** True when the payslip tables haven't been created yet. */
export function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}
