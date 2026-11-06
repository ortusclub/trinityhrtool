import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth/helpers";
import { createClient } from "@/lib/supabase/server";
import { displayName } from "@/lib/utils";
import { BATCH_ID, getSlip, loadPayslipSettings } from "@/lib/payslips-store";
import { PayslipView } from "@/components/payslips/payslip-view";
import { payslipDetails } from "@/lib/payslip-details";
import { ExportToolbar } from "./toolbar";

// Admin → Payroll → Payslip → Payslips by employee: the chosen payslips of
// one person, one per printed page, saved as a single PDF from the print
// dialog. Drafts included, since only admins can open it.

type Props = {
  params: Promise<{ user: string }>;
  searchParams: Promise<{ batches?: string }>;
};

const batchIds = (v: string | undefined) =>
  [...new Set(String(v ?? "").split(",").filter((id) => BATCH_ID.test(id)))].slice(0, 120);

async function employee(user: string) {
  const db = await createClient();
  const { data } = await db
    .from("users")
    .select("full_name, preferred_name, first_name, last_name, email, company")
    .eq("id", user)
    .maybeSingle();
  return data;
}

// The page title is the file name Chrome suggests: "Payslips - Ana Cruz".
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  await requireRole("hr_admin");
  const { user } = await params;
  const emp = await employee(user).catch(() => null);
  return { title: emp ? `Payslips - ${displayName(emp)}` : "Payslips" };
}

export default async function PayslipExportPage({ params, searchParams }: Props) {
  await requireRole("hr_admin");
  const [{ user }, { batches }] = await Promise.all([params, searchParams]);
  const ids = batchIds(batches);
  const db = await createClient();
  const [emp, settings, slips] = await Promise.all([
    employee(user),
    loadPayslipSettings(db),
    Promise.all(ids.map((id) => getSlip(db, id, user))),
  ]);
  const found = slips
    .filter((s): s is NonNullable<typeof s> => !!s)
    .sort((a, b) => a.payout_date.localeCompare(b.payout_date) || a.batch_id.localeCompare(b.batch_id));
  if (!emp || !found.length) notFound();

  // Trinity payslips carry the account and government numbers; they're the
  // same for every payslip of one person, so look them up once per code.
  const detailsByCode = new Map<string, Awaited<ReturnType<typeof payslipDetails>>>();
  for (const s of found) {
    if (!/trinity/i.test(s.lines.company?.name ?? "")) continue;
    const code = s.lines.employee?.code ?? "";
    if (!detailsByCode.has(code)) {
      detailsByCode.set(code, await payslipDetails({ email: emp.email, code, userCompany: emp.company }));
    }
  }
  const name = displayName(emp);

  return (
    <div className="min-h-screen bg-gray-50 p-6 print:bg-white print:p-0">
      <ExportToolbar name={name} count={found.length} />
      <div className="mx-auto max-w-4xl space-y-6 print:max-w-none print:space-y-0">
        {found.map((s) => (
          <div key={s.batch_id} className="break-after-page break-inside-avoid last:break-after-auto">
            <PayslipView
              payslip={s}
              employeeName={name}
              settings={settings}
              details={/trinity/i.test(s.lines.company?.name ?? "") ? detailsByCode.get(s.lines.employee?.code ?? "") : null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
