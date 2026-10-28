import { requireRole } from "@/lib/auth/helpers";

export default async function PayrollPage() {
  await requireRole("hr_admin");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-[26px] leading-tight text-gray-900">Payroll</h1>
        <p className="text-gray-600">
          Philippine semi-monthly payroll: salaries, benefits, deductions and
          payslips. Shared by all HR admins: changes save for everyone, and
          someone else&apos;s changes show after a reload.
        </p>
      </div>
      <iframe
        src="/payroll-app/index.html"
        title="Payroll"
        className="h-[calc(100vh-13rem)] min-h-[600px] w-full rounded-xl border border-gray-200 bg-white"
      />
    </div>
  );
}
