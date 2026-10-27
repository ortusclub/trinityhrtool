import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { releasedSlipsFor } from "@/lib/payslips-store";
import { money } from "@/components/payslips/payslip-view";

export default async function PayslipsPage() {
  const user = await getCurrentUser();
  const payslips = await releasedSlipsFor(await createClient(), user.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">Payslips</h1>
        <p className="text-gray-600">
          Your payslips, newest first. Open one to see the full breakdown or
          print it.
        </p>
      </div>

      {payslips.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          No payslips yet. They appear here once payroll releases them.
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
