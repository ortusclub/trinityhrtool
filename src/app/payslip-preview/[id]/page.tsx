import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import type { Payslip } from "@/types/database";
import { displayName } from "@/lib/utils";
import { loadPayslipSettings } from "@/lib/payslips-server";
import { PayslipView } from "@/components/payslips/payslip-view";

// Any payslip, released or not, exactly as its employee sees it. Shown in a
// frame on Admin → Payroll → Payslip, so it has no menu of its own.
export default async function PayslipPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireRole("hr_admin");
  const { id } = await params;
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("payslips")
      .select(
        "*, employee:users!payslips_employee_id_fkey(full_name, preferred_name, first_name, last_name, email)"
      )
      .eq("id", id)
      .maybeSingle(),
    loadPayslipSettings(supabase),
  ]);
  if (!data) notFound();

  const payslip = data as Payslip & { employee: Parameters<typeof displayName>[0] };
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <PayslipView payslip={payslip} employeeName={displayName(payslip.employee)} settings={settings} />
    </div>
  );
}
