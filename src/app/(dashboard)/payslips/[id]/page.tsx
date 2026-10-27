import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/utils";
import { getSlip, isReleased, loadPayslipSettings } from "@/lib/payslips-store";
import { PayslipView } from "@/components/payslips/payslip-view";
import { PrintButton } from "@/components/payslips/print-button";

// The viewer's own payslip from a released batch; nobody else's, ever.
export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const db = await createClient();
  const [slip, released, settings] = await Promise.all([
    getSlip(db, id, user.id),
    isReleased(db, id),
    loadPayslipSettings(db),
  ]);
  if (!slip || !released) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link href="/payslips" className="text-sm font-medium text-blue-600 hover:underline">
          ← Payslips
        </Link>
        <PrintButton />
      </div>
      <PayslipView payslip={slip} employeeName={displayName(user)} settings={settings} />
    </div>
  );
}
