import Link from "next/link";
import { requireRole } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/paginate";
import type { Payslip } from "@/types/database";
import { displayName, formatDate } from "@/lib/utils";
import { cutoffLabel, peso } from "@/components/payslips/payslip-view";

type Row = Pick<
  Payslip,
  "id" | "period_id" | "cutoff_start" | "cutoff_end" | "payout_date" | "gross_pay" | "net_pay" | "sent_at"
> & { employee: Parameters<typeof displayName>[0] };

/**
 * Every payslip the payroll site has sent, by cutoff. Payslips arrive from
 * payroll-ortus.vercel.app ("Send to TrinityHR" on its Payroll Run tab);
 * nothing is entered here.
 */
export default async function HRPayslipsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requireRole("hr_admin");
  const { period } = await searchParams;
  const supabase = await createClient();

  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("payslips")
      .select(
        "id, period_id, cutoff_start, cutoff_end, payout_date, gross_pay, net_pay, sent_at, employee:users!payslips_employee_id_fkey(full_name, preferred_name, first_name, last_name, email)"
      )
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  ).catch(() => [] as Row[]);

  const periods = new Map<string, { sample: Row; count: number; net: number; sent: string }>();
  for (const r of rows) {
    const p = periods.get(r.period_id) ?? { sample: r, count: 0, net: 0, sent: r.sent_at };
    p.count += 1;
    p.net += Number(r.net_pay);
    if (r.sent_at > p.sent) p.sent = r.sent_at;
    periods.set(r.period_id, p);
  }
  const list = [...periods.entries()].sort((a, b) =>
    b[1].sample.payout_date.localeCompare(a[1].sample.payout_date)
  );
  const chosen = period
    ? rows
        .filter((r) => r.period_id === period)
        .sort((a, b) => displayName(a.employee).localeCompare(displayName(b.employee)))
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">Payslips</h1>
        <p className="text-gray-600">
          Payslips sent from the payroll site, by cutoff. Employees see their own
          under My Payslips. Sending a cutoff again replaces it.
        </p>
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No payslips have been sent yet.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white">
          {list.map(([id, p]) => (
            <Link
              key={id}
              href={`/admin/payslips?period=${encodeURIComponent(id)}`}
              className={`flex items-center justify-between gap-4 border-b border-gray-100 p-5 last:border-b-0 hover:bg-gray-50 ${period === id ? "bg-blue-50" : ""}`}
            >
              <div className="space-y-1">
                <p className="font-medium text-gray-900">{cutoffLabel(p.sample)}</p>
                <p className="text-xs text-gray-500">
                  Paid {formatDate(p.sample.payout_date)} · sent {formatDate(p.sent.slice(0, 10))}
                </p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums text-gray-900">{peso(p.net)}</p>
                <p className="text-xs text-gray-500">{p.count} employees · net</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {chosen.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display text-sm uppercase tracking-wider text-gray-500">
            {cutoffLabel(chosen[0])}
          </h2>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {chosen.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100 last:border-b-0">
                    <td className="px-4 py-2.5 text-gray-900">{displayName(r.employee)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{peso(r.gross_pay)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{peso(r.net_pay)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/payslips/${r.id}`} className="font-medium text-blue-600 hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
