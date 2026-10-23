import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import type { Payslip } from "@/types/database";
import { displayName, hasRole } from "@/lib/utils";
import { PayslipView } from "@/components/payslips/payslip-view";
import { PrintButton } from "@/components/payslips/print-button";

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const supabase = await createClient();

  // RLS limits this to the viewer's own payslips, or all of them for HR.
  const { data } = await supabase
    .from("payslips")
    .select(
      "*, employee:users!payslips_employee_id_fkey(full_name, preferred_name, first_name, last_name, email)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  const payslip = data as Payslip & {
    employee: Parameters<typeof displayName>[0];
  };
  const own = payslip.employee_id === user.id;
  const back = own || !hasRole(user.role, "hr_admin")
    ? { href: "/payslips", label: "My payslips" }
    : { href: `/admin/payslips?period=${encodeURIComponent(payslip.period_id)}`, label: "Payslips" };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link href={back.href} className="text-sm font-medium text-blue-600 hover:underline">
          ← {back.label}
        </Link>
        <PrintButton />
      </div>
      <PayslipView payslip={payslip} employeeName={displayName(payslip.employee)} />
    </div>
  );
}
