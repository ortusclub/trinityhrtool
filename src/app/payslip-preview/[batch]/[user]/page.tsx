import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { displayName } from "@/lib/utils";
import { getSlip, loadPayslipSettings } from "@/lib/payslips-store";
import { PayslipView } from "@/components/payslips/payslip-view";

// Any payslip, released or not, exactly as its employee sees it. Shown in a
// frame on Admin → Payroll → Payslip, so it has no menu of its own.
export default async function PayslipPreviewPage({
  params,
}: {
  params: Promise<{ batch: string; user: string }>;
}) {
  await requireRole("hr_admin");
  const { batch, user } = await params;
  const [slip, settings, { data: employee }] = await Promise.all([
    getSlip(batch, user),
    loadPayslipSettings(),
    createAdminClient()
      .from("users")
      .select("full_name, preferred_name, first_name, last_name, email")
      .eq("id", user)
      .maybeSingle(),
  ]);
  if (!slip) notFound();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <PayslipView payslip={slip} employeeName={displayName(employee)} settings={settings} />
    </div>
  );
}
