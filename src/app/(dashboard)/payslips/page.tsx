import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import type { Payslip } from "@/types/database";
import { formatDate } from "@/lib/utils";
import { cutoffLabel, peso } from "@/components/payslips/payslip-view";

export default async function PayslipsPage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("payslips")
    .select("id, period_id, cutoff_start, cutoff_end, payout_date, gross_pay, net_pay")
    .eq("employee_id", user.id)
    .order("payout_date", { ascending: false });

  const payslips = (data ?? []) as Pick<
    Payslip,
    "id" | "period_id" | "cutoff_start" | "cutoff_end" | "payout_date" | "gross_pay" | "net_pay"
  >[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">My Payslips</h1>
        <p className="text-gray-600">
          Your payslips from Trinity payroll, newest first. Open one to see the
          full breakdown or print it.
        </p>
      </div>

      {payslips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No payslips yet. They appear here once payroll sends them.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white">
          {payslips.map((p) => (
            <Link
              key={p.id}
              href={`/payslips/${p.id}`}
              className="flex items-center justify-between gap-4 border-b border-gray-100 p-5 last:border-b-0 hover:bg-gray-50"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium text-gray-900">{cutoffLabel(p)}</p>
                <p className="text-xs text-gray-500">Paid {formatDate(p.payout_date)}</p>
              </div>
              <div className="text-right">
                <p className="font-medium tabular-nums text-gray-900">{peso(p.net_pay)}</p>
                <p className="text-xs text-gray-500">net · gross {peso(p.gross_pay)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
