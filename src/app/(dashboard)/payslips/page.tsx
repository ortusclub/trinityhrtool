import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { totalPayslips } from "@/lib/payslips";
import { releasedSlipsFor } from "@/lib/payslips-store";
import { money } from "@/components/payslips/payslip-view";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PayslipsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  const all = await releasedSlipsFor(await createClient(), user.id);

  // By payout date; this calendar year unless a range is picked.
  const year = new Date().getFullYear();
  const sp = await searchParams;
  const from = DATE.test(sp.from ?? "") ? sp.from! : `${year}-01-01`;
  const to = DATE.test(sp.to ?? "") ? sp.to! : `${year}-12-31`;
  const payslips = all.filter((p) => p.payout_date >= from && p.payout_date <= to);
  const totals = totalPayslips(payslips);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">Payslips</h1>
        <p className="text-gray-600">
          Your payslips, newest first. Pick a date range to see what you were
          paid over it; open a payslip to see the full breakdown or print it.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wider text-gray-500">
          Paid from
          <input type="date" name="from" defaultValue={from} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm normal-case tracking-normal text-gray-900" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wider text-gray-500">
          to
          <input type="date" name="to" defaultValue={to} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm normal-case tracking-normal text-gray-900" />
        </label>
        <button type="submit" className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          Show
        </button>
        <Link href="/payslips" className="py-2 text-sm text-blue-600 hover:underline">This year</Link>
        <Link href="/payslips?from=1900-01-01&to=2999-12-31" className="py-2 text-sm text-blue-600 hover:underline">All</Link>
      </form>

      {totals.map((t) => (
        <section key={t.currency} className="rounded-xl border border-gray-200 bg-white p-6">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg text-gray-900">
              Totals{totals.length > 1 ? ` in ${t.currency}` : ""}
            </h2>
            <p className="text-sm text-gray-500">
              {t.count} payslip{t.count === 1 ? "" : "s"} paid {formatDate(from)} – {formatDate(to)}
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <TotalsTable title="Earnings" rows={t.earnings} total={t.gross} totalLabel="Total earnings" currency={t.currency} />
            <TotalsTable title="Deductions" rows={t.deductions} total={t.deductionsTotal} totalLabel="Total deductions" currency={t.currency} />
          </div>
          <div className="mt-6 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
            <span className="font-medium text-gray-700">Net pay</span>
            <span className="font-display text-xl text-gray-900">{money(t.net, t.currency)}</span>
          </div>
        </section>
      ))}

      {payslips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          {all.length
            ? "No payslips paid in this date range."
            : "No payslips yet. They appear here once payroll releases them."}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white">
          {payslips.map((p) => (
            <Link
              key={p.batch_id}
              href={`/payslips/${p.batch_id}`}
              className="flex items-center justify-between gap-4 border-b border-gray-100 p-5 last:border-b-0 hover:bg-gray-50"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-gray-900">{p.period_label}</p>
                <p className="text-xs text-gray-500">Paid {formatDate(p.payout_date)}</p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums text-gray-900">{money(p.net_pay, p.currency)}</p>
                <p className="text-xs text-gray-500">net · gross {money(p.gross_pay, p.currency)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TotalsTable({
  title,
  rows,
  total,
  totalLabel,
  currency,
}: {
  title: string;
  rows: { label: string; total: number }[];
  total: number;
  totalLabel: string;
  currency: string;
}) {
  return (
    <div>
      <h3 className="mb-2 font-display text-sm uppercase tracking-wider text-gray-500">{title}</h3>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-gray-100">
              <td className="py-1.5 text-gray-700">{r.label}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-900">{money(r.total, currency)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 font-medium text-gray-900">{totalLabel}</td>
            <td className="pt-2 text-right font-medium tabular-nums text-gray-900">{money(total, currency)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
