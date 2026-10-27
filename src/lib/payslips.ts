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
  /** Reference, personal no., employer contribution, tax status. */
  showExtraDetails: boolean;
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
  showExtraDetails: true,
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

export interface PayslipTotals {
  currency: string;
  count: number;
  earnings: { label: string; total: number }[];
  deductions: { label: string; total: number }[];
  gross: number;
  deductionsTotal: number;
  net: number;
}

/**
 * Each earning and deduction added up across `slips`, one block per
 * currency. Lines are grouped by label without the quantity after " — "
 * ("Overtime 1.25× — 3 hr" counts as "Overtime 1.25×"); rows without an
 * amount are details and are left out.
 */
export function totalPayslips(
  slips: {
    currency: string;
    gross_pay: number;
    total_deductions: number;
    net_pay: number;
    lines: { earnings: { label: string; amount: number | null }[]; deductions: { label: string; amount: number | null }[] };
  }[],
): PayslipTotals[] {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const add = (into: Map<string, number>, rows: { label: string; amount: number | null }[]) => {
    for (const row of rows) {
      if (row.amount === null) continue;
      const label = row.label.split(" — ")[0].trim();
      into.set(label, (into.get(label) ?? 0) + Number(row.amount));
    }
  };
  const by = new Map<string, { count: number; earn: Map<string, number>; ded: Map<string, number>; gross: number; dt: number; net: number }>();
  for (const s of slips) {
    const t = by.get(s.currency) ?? { count: 0, earn: new Map(), ded: new Map(), gross: 0, dt: 0, net: 0 };
    by.set(s.currency, t);
    t.count++;
    add(t.earn, s.lines.earnings);
    add(t.ded, s.lines.deductions);
    t.gross += Number(s.gross_pay);
    t.dt += Number(s.total_deductions);
    t.net += Number(s.net_pay);
  }
  const list = (m: Map<string, number>) =>
    [...m].map(([label, total]) => ({ label, total: r2(total) })).filter((x) => x.total !== 0);
  return [...by].map(([currency, t]) => ({
    currency,
    count: t.count,
    earnings: list(t.earn),
    deductions: list(t.ded),
    gross: r2(t.gross),
    deductionsTotal: r2(t.dt),
    net: r2(t.net),
  }));
}
