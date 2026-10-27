import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import type { Payslip } from "@/types/database";
import { displayName } from "@/lib/utils";
import { loadPayslipSettings } from "@/lib/payslips-server";
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

  const [{ data }, settings] = await Promise.all([
    supabase
      .from("payslips")
      .select(
        "*, employee:users!payslips_employee_id_fkey(full_name, preferred_name, first_name, last_name, email)"
      )
      .eq("id", id)
      .eq("employee_id", user.id)
      .maybeSingle(),
    loadPayslipSettings(supabase),
  ]);
  if (!data) notFound();

  // Admins can read drafts; nobody's own page shows one before release.
  const { data: release } = await supabase
    .from("payslip_releases")
    .select("published_at")
    .eq("period_id", data.period_id)
    .maybeSingle();
  if (!release?.published_at) notFound();

  const payslip = data as Payslip & { employee: Parameters<typeof displayName>[0] };
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link href="/payslips" className="text-sm font-medium text-blue-600 hover:underline">
          ← Payslips
        </Link>
        <PrintButton />
      </div>
      <PayslipView payslip={payslip} employeeName={displayName(payslip.employee)} settings={settings} />
    </div>
  );
}
