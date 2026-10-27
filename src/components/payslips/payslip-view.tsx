import type { Payslip, PayslipLine } from "@/types/database";
import type { PayslipSettings } from "@/lib/payslips";
import { formatDate } from "@/lib/utils";

/** Peso amounts, two decimals. */
export function peso(n: number | string | null | undefined): string {
  const v = Number(n);
  return "₱" + (Number.isFinite(v) ? v : 0).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function cutoffLabel(p: Pick<Payslip, "cutoff_start" | "cutoff_end">): string {
  return `${formatDate(p.cutoff_start)} – ${formatDate(p.cutoff_end)}`;
}

/**
 * A payslip laid out the way the payroll app prints it: earnings on the
 * left, deductions on the right, net pay below. The lines are the payroll
 * app's own; `settings` only decides which of them are shown, never the
 * totals.
 */
export function PayslipView({
  payslip,
  employeeName,
  settings,
}: {
  payslip: Payslip;
  employeeName: string;
  settings: PayslipSettings;
}) {
  const { lines } = payslip;
  const company = lines.company ?? {};
  const visible = (rows: PayslipLine[]) =>
    rows.filter((r) => {
      if (r.kind === "head") return true;
      if (r.amount === null) return settings.showLineNotes;
      return settings.showZeroLines || Number(r.amount) !== 0;
    });
  const sub = [
    settings.showCompanyAddress ? company.address : "",
    settings.showCompanyTin && company.tin ? `TIN ${company.tin}` : "",
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 print:border-0 print:p-0">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 pb-4">
        <div>
          <p className="font-display text-lg text-gray-900">
            {company.name ?? "Trinity Outsourcing Solutions Inc."}
          </p>
          {sub.length > 0 && <p className="text-xs text-gray-500">{sub.join(" · ")}</p>}
        </div>
        <p className="font-display text-sm uppercase tracking-wider text-gray-500">Payslip</p>
      </div>

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
        <Field label="Employee" value={employeeName} />
        {settings.showPosition && <Field label="Position" value={lines.employee?.position || "—"} />}
        {settings.showEmployeeCode && <Field label="Employee code" value={lines.employee?.code || "—"} />}
        <Field label="Payroll period" value={cutoffLabel(payslip)} />
        <Field label="Payout date" value={formatDate(payslip.payout_date)} />
        {settings.showBranch && <Field label="Branch" value={lines.employee?.branch || "—"} />}
      </dl>

      <div className="grid gap-6 md:grid-cols-2">
        <LineTable title="Earnings" rows={visible(lines.earnings)} total={payslip.gross_pay} totalLabel="Total earnings" />
        <LineTable title="Deductions" rows={visible(lines.deductions)} total={payslip.total_deductions} totalLabel="Total deductions" />
      </div>

      <div className="mt-6 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
        <span className="font-medium text-gray-700">Net pay</span>
        <span className="font-display text-xl text-gray-900">{peso(payslip.net_pay)}</span>
      </div>

      {((settings.showNetTaxable && typeof lines.net_taxable === "number") ||
        (settings.showRemarks && payslip.remarks)) && (
        <p className="mt-4 text-xs text-gray-500">
          {settings.showNetTaxable && typeof lines.net_taxable === "number" && (
            <>Net taxable amount: {peso(lines.net_taxable)}. </>
          )}
          {settings.showRemarks && payslip.remarks && <>Remarks: {payslip.remarks}</>}
        </p>
      )}
      {settings.note.trim() && (
        <p className="mt-4 whitespace-pre-line text-sm text-gray-700">{settings.note.trim()}</p>
      )}
      <p className="mt-2 text-xs text-gray-400">This payslip is system-generated.</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-gray-500">{label}</dt>
      <dd className="text-gray-900">{value}</dd>
    </div>
  );
}

function LineTable({
  title,
  rows,
  total,
  totalLabel,
}: {
  title: string;
  rows: PayslipLine[];
  total: number;
  totalLabel: string;
}) {
  return (
    <div>
      <h3 className="mb-2 font-display text-sm uppercase tracking-wider text-gray-500">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td
                className={
                  r.kind === "head"
                    ? "py-1.5 font-medium text-gray-700"
                    : r.kind === "sub"
                      ? "py-1.5 pl-4 text-gray-600"
                      : "py-1.5 text-gray-700"
                }
              >
                {r.label}
              </td>
              <td className="py-1.5 text-right tabular-nums text-gray-900">
                {r.amount === null ? "" : peso(r.amount)}
              </td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-medium text-gray-900">{totalLabel}</td>
            <td className="pt-2 text-right font-medium tabular-nums text-gray-900">{peso(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
